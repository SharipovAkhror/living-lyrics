/**
 * Timing editor: listen, tap Space on each word's onset, nudge with arrows, download lyrics.json.
 * Edits are kept as a draft in this browser until downloaded and committed.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getSong, loadLyrics, loadPeaks, formatTime } from '@/data/library';
import type { Lyrics, Peaks } from '@/data/schema';
import { AudioEngine } from '@/player/engine';
import { useSongAccent } from '@/app/theme';
import { linkHandler } from '@/app/router';
import { Icon } from '@/icons/Icon';
import { Segmented } from '@/components/controls';

interface Ref {
  si: number;
  li: number;
  wi: number;
}

const DRAFT_KEY = (slug: string) => `living-lyrics.editor.${slug}`;
const WINDOW = 10; // seconds visible in the waveform

function flatten(l: Lyrics): Ref[] {
  const out: Ref[] = [];
  l.sections.forEach((s, si) => {
    if (s.kind !== 'vocal') return;
    s.lines.forEach((line, li) => line.words.forEach((_, wi) => out.push({ si, li, wi })));
  });
  return out;
}

function wordAt(l: Lyrics, r: Ref) {
  const s = l.sections[r.si];
  if (s.kind !== 'vocal') throw new Error('not vocal');
  return s.lines[r.li].words[r.wi];
}

export function EditorPage({ slug }: { slug: string }) {
  const song = getSong(slug);
  useSongAccent(song);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [history, setHistory] = useState<Lyrics[]>([]);
  const [sel, setSel] = useState(0);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [rate, setRate] = useState('1');
  const [dirty, setDirty] = useState(0);
  const [clearFlags, setClearFlags] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const engine = useMemo(
    () =>
      song
        ? new AudioEngine({ slug: song.slug, title: song.title, artist: song.artist, duration: song.duration, urls: { high: song.audio.high, saver: song.audio.saver } })
        : null,
    [song],
  );
  const state = useSyncExternalStore(
    useCallback((fn: () => void) => engine?.subscribe(fn) ?? (() => {}), [engine]),
    () => engine?.state ?? null,
  );

  useEffect(() => {
    if (!song || !engine) return;
    void engine.init({ quality: 'high', rate: 1, volume: 1, normalize: false });
    let draft: Lyrics | null = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY(slug));
      if (raw) draft = JSON.parse(raw);
    } catch {
      /* no draft */
    }
    void loadLyrics(slug).then((l) => setLyrics(draft ?? l));
    if (draft) setDirty(1);
    if (song.audio.peaks) void loadPeaks(song.audio.peaks).then(setPeaks);
    return () => engine.destroy();
  }, [song, engine, slug]);

  useEffect(() => {
    if (state?.source === 'local' && engine && !song?.audio.peaks) void engine.computePeaks().then((p) => p && setPeaks(p));
  }, [state?.source, engine, song]);

  const flat = useMemo(() => (lyrics ? flatten(lyrics) : []), [lyrics]);

  const commit = useCallback(
    (fn: (draft: Lyrics) => void) => {
      if (!lyrics) return;
      const next = structuredClone(lyrics);
      fn(next);
      setHistory((h) => [...h.slice(-80), lyrics]);
      setLyrics(next);
      setDirty((d) => d + 1);
      try {
        localStorage.setItem(DRAFT_KEY(slug), JSON.stringify(next));
      } catch {
        /* storage full: keep in memory */
      }
    },
    [lyrics, slug],
  );

  const markEdited = useCallback(
    (draft: Lyrics, r: Ref) => {
      if (!clearFlags) return;
      const s = draft.sections[r.si];
      if (s.kind !== 'vocal') return;
      const line = s.lines[r.li];
      if (line.flags) line.flags = line.flags.filter((f) => f !== 'timing-draft');
    },
    [clearFlags],
  );

  /** Tap: the selected word starts now; the previous word ends just before. */
  const tap = useCallback(() => {
    if (!engine || !flat[sel]) return;
    const t = +engine.currentTime().toFixed(2);
    commit((d) => {
      const r = flat[sel];
      const w = wordAt(d, r);
      const len = Math.max(0.12, w.e - w.s);
      w.s = t;
      w.e = +(t + Math.min(len, 1.2)).toFixed(2);
      const prev = flat[sel - 1];
      if (prev && prev.si === r.si) {
        const pw = wordAt(d, prev);
        if (pw.e > t - 0.02 || (prev.li === r.li && t - pw.e < 0.6)) pw.e = +Math.max(pw.s + 0.05, t - 0.02).toFixed(2);
      }
      const next = flat[sel + 1];
      if (next && next.si === r.si) {
        const nw = wordAt(d, next);
        if (nw.s < w.e) w.e = +Math.max(w.s + 0.05, nw.s - 0.02).toFixed(2);
      }
      markEdited(d, r);
    });
    setSel((i) => Math.min(flat.length - 1, i + 1));
  }, [engine, flat, sel, commit, markEdited]);

  const nudge = useCallback(
    (delta: number, which: 's' | 'e' | 'both') => {
      if (!flat[sel]) return;
      commit((d) => {
        const w = wordAt(d, flat[sel]);
        if (which !== 'e') w.s = +Math.max(0, w.s + delta).toFixed(3);
        if (which !== 's') w.e = +Math.max(w.s + 0.03, w.e + delta).toFixed(3);
        markEdited(d, flat[sel]);
      });
    },
    [flat, sel, commit, markEdited],
  );

  const setEnd = useCallback(() => {
    if (!engine || !flat[sel]) return;
    const t = +engine.currentTime().toFixed(2);
    commit((d) => {
      const w = wordAt(d, flat[sel]);
      if (t > w.s) w.e = t;
      markEdited(d, flat[sel]);
    });
  }, [engine, flat, sel, commit, markEdited]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setLyrics(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const playFromSelected = useCallback(() => {
    if (!engine || !lyrics || !flat[sel]) return;
    const r = flat[sel];
    const s = lyrics.sections[r.si];
    if (s.kind !== 'vocal') return;
    engine.seek(Math.max(0, s.lines[r.li].words[0].s - 0.6));
    void engine.play();
  }, [engine, lyrics, flat, sel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          undo();
        }
        return;
      }
      const step = e.shiftKey ? 0.01 : 0.05;
      if (e.code === 'Space') tap();
      else if (e.key === 'Enter') playFromSelected();
      else if (e.key === 'k' || e.key === 'л') engine?.toggle();
      else if (e.key === 'ArrowLeft') nudge(-step, e.altKey ? 'e' : 's');
      else if (e.key === 'ArrowRight') nudge(step, e.altKey ? 'e' : 's');
      else if (e.key === 'ArrowUp') setSel((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowDown') setSel((i) => Math.min(flat.length - 1, i + 1));
      else if (e.key === 'e' || e.key === 'у') setEnd();
      else if (e.key === 'z' || e.key === 'я') undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tap, nudge, setEnd, undo, playFromSelected, engine, flat.length]);

  // Keep the selected word in view.
  useEffect(() => {
    listRef.current?.querySelector('.ed-word.is-selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  // Waveform with word boxes, centred on the playhead.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c || !lyrics || !engine) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = engine.currentTime();
      const t0 = t - WINDOW / 2;
      const x = (sec: number) => ((sec - t0) / WINDOW) * w;
      const css = getComputedStyle(c);
      const ink = css.getPropertyValue('--label').trim() || '#000';
      const accent = css.getPropertyValue('--accent').trim() || '#06f';
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ink;
      if (peaks) {
        const step = Math.max(1, Math.floor(peaks.rate / 40));
        for (let i = Math.max(0, Math.floor(t0 * peaks.rate)); i < Math.min(peaks.rms.length, (t0 + WINDOW) * peaks.rate); i += step) {
          const v = peaks.rms[i];
          const px = x(i / peaks.rate);
          ctx.fillRect(px, h * 0.62 - v * h * 0.5, Math.max(1, (w / WINDOW / peaks.rate) * step - 1), v * h * 0.5 * 2 * 0.6);
        }
      }
      ctx.globalAlpha = 1;
      ctx.font = '600 13px -apple-system, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      flat.forEach((r, i) => {
        const wd = wordAt(lyrics, r);
        if (wd.e < t0 || wd.s > t0 + WINDOW) return;
        const a = x(wd.s);
        const b = x(wd.e);
        ctx.fillStyle = i === sel ? accent : 'rgba(127,127,127,0.28)';
        ctx.globalAlpha = i === sel ? 0.9 : 1;
        ctx.beginPath();
        ctx.roundRect(a, 10, Math.max(3, b - a), 26, 6);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = i === sel ? '#fff' : ink;
        ctx.save();
        ctx.beginPath();
        ctx.rect(a, 10, Math.max(3, b - a), 26);
        ctx.clip();
        ctx.fillText(wd.w, a + 5, 23);
        ctx.restore();
      });
      ctx.fillStyle = accent;
      ctx.fillRect(w / 2 - 1, 0, 2, h);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [lyrics, engine, flat, sel, peaks]);

  if (!song || !engine) return <div className="empty">Песня не найдена</div>;

  const download = () => {
    if (!lyrics) return;
    const blob = new Blob([JSON.stringify(lyrics, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lyrics.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const reset = async () => {
    try {
      localStorage.removeItem(DRAFT_KEY(slug));
    } catch {
      /* nothing stored */
    }
    setLyrics(await loadLyrics(slug));
    setHistory([]);
    setDirty(0);
  };

  const cur = flat[sel];
  const curWord = lyrics && cur ? wordAt(lyrics, cur) : null;

  return (
    <div className="editor">
      <header className="ed-top">
        <a className="btn btn-circle glass" href={`/song/${slug}`} onClick={linkHandler(`/song/${slug}`)} aria-label="К песне">
          <Icon name="chevron.left" size={20} weight={2.2} />
        </a>
        <div className="ed-title">
          <div className="t-headline">Тайм-коды</div>
          <div className="t-footnote secondary">
            {song.title} · {state?.source === 'silent' ? 'нет аудио — подключите файл на странице песни' : formatTime(state?.duration ?? 0)}
          </div>
        </div>
        <button className="btn btn-capsule btn-tinted" onClick={download} disabled={!lyrics}>
          <Icon name="square.and.arrow.down" size={18} />
          Скачать
        </button>
      </header>

      <canvas
        ref={canvas}
        className="ed-wave"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          engine.seek(engine.currentTime() + ((e.clientX - r.left) / r.width - 0.5) * WINDOW);
        }}
      />

      <div className="ed-controls">
        <button className="btn btn-circle btn-lg btn-prominent" onClick={() => engine.toggle()} aria-label={state?.playing ? 'Пауза' : 'Воспроизвести'}>
          <Icon name={state?.playing ? 'pause' : 'play'} size={24} />
        </button>
        <button className="btn btn-capsule glass" onClick={tap}>
          Начало слова · пробел
        </button>
        <button className="btn btn-capsule glass" onClick={setEnd}>
          Конец · E
        </button>
        <button className="btn btn-capsule glass" onClick={undo} disabled={!history.length}>
          Отменить · Z
        </button>
        <div className="ed-rate">
          <Segmented
            label="Скорость"
            value={rate}
            options={[
              { value: '0.5', label: '0,5×' },
              { value: '0.75', label: '0,75×' },
              { value: '1', label: '1×' },
            ]}
            onChange={(v) => {
              setRate(v);
              engine.setRate(parseFloat(v));
            }}
          />
        </div>
      </div>

      <div className="ed-status t-footnote secondary">
        {curWord ? (
          <>
            Выбрано: <b className="ed-sel">{curWord.w}</b> {curWord.s.toFixed(2)}–{curWord.e.toFixed(2)} с.{' '}
          </>
        ) : null}
        ← → — сдвиг начала на 50 мс (с Shift — 10 мс, с Option — конец) · ↑ ↓ — слово · Enter — проиграть строку · K — пауза.
        {dirty > 0 && (
          <>
            {' '}
            Черновик сохранён в этом браузере.{' '}
            <button className="ed-link" onClick={() => void reset()}>
              Сбросить к файлу
            </button>
          </>
        )}
        <label className="ed-check">
          <input type="checkbox" checked={clearFlags} onChange={(e) => setClearFlags(e.target.checked)} /> снимать пометку «черновое время» с исправленных строк
        </label>
      </div>

      <div ref={listRef} className="ed-list">
        {lyrics?.sections.map((s, si) =>
          s.kind !== 'vocal' ? (
            <div key={s.id} className="ed-inst t-footnote tertiary">
              {formatTime(s.start)} · {s.label}
            </div>
          ) : (
            <section key={s.id} className="ed-section">
              <h3 className="t-footnote ed-section-title">{s.label}</h3>
              {s.lines.map((line, li) => (
                <div key={line.id} className="ed-line" dir={line.script === 'Arab' ? 'rtl' : 'ltr'}>
                  {line.words.map((w, wi) => {
                    const idx = flat.findIndex((r) => r.si === si && r.li === li && r.wi === wi);
                    return (
                      <button
                        key={wi}
                        className={`ed-word${idx === sel ? ' is-selected' : ''}${line.script === 'Arab' ? ' f-mushaf' : ''}`}
                        onClick={() => {
                          setSel(idx);
                          engine.seek(Math.max(0, w.s - 0.3));
                        }}
                      >
                        <span>{w.w}</span>
                        <span className="ed-time tabular">{w.s.toFixed(2)}</span>
                      </button>
                    );
                  })}
                  {line.flags?.includes('timing-draft') && <span className="ed-flag t-caption2">черновое</span>}
                </div>
              ))}
            </section>
          ),
        )}
      </div>
    </div>
  );
}
