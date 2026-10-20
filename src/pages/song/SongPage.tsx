import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { formatTime, getSong, loadLyrics, loadPeaks } from '@/data/library';
import { marksFor, momentAt } from '@/app/marks';
import type { Lyrics, Peaks } from '@/data/schema';
import { buildTimeline, commentFor, type Cue } from '@/data/timeline';
import { useSettings, setSettings } from '@/app/settings';
import { useSongAccent } from '@/app/theme';
import { enableSongFonts } from '@/app/fontCatalog';
import { nextSlug, prefetchLyrics, prefetchRecording, recordingUrl } from '@/app/prefetch';
import { linkHandler } from '@/app/router';
import { AudioEngine } from '@/player/engine';
import { preloadMode, readNetHint } from '@/player/preload';
import { Scrubber } from '@/player/Scrubber';
import { Scene } from '@/scene/Scene';
import { Field } from '@/scene/Field';
import { LEAD } from '@/scene/flow';
import { Icon } from '@/ui/icons';
import { RichText } from '@/components/RichText';
import { Status } from '@/components/Status';
import { showHarakatText, stripHarakat } from '@/data/harakat';
import { parseAudioFeatures, type AudioFeatures } from '@/instruments/animation';
import { preloadInstruments } from '@/instruments/catalog';
import { SettingsSheet } from './SettingsSheet';
import { TextSheet } from './TextSheet';
import { InfoSheet } from './InfoSheet';
import { headerLine } from './parts';

type SheetName = 'settings' | 'text' | 'info' | null;

/** Press-and-hold repeats an action (seek) while a tap does something else (go to a line), as on iOS. */
function useHold(onTap: () => void, onHold: () => void) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const stop = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      held.current = false;
      const repeat = (delay: number) => {
        timer.current = window.setTimeout(() => {
          held.current = true;
          onHold();
          repeat(350);
        }, delay);
      };
      repeat(450);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: () => {
      if (!held.current) onTap();
      held.current = false;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

export function SongPage({ slug, dark, leaving = null }: { slug: string; dark: boolean; leaving?: string[] | null }) {
  const song = getSong(slug);
  useSongAccent(song);
  const settings = useSettings();
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [textAttempt, setTextAttempt] = useState(0);

  const engine = useMemo(
    () =>
      song
        ? new AudioEngine({
            slug: song.slug,
            title: song.title,
            artist: song.artist,
            album: song.version.label,
            duration: song.duration,
            urls: { high: song.audio.high, saver: song.audio.saver },
            gainDb: song.audio.gainDb,
            coverExt: song.cover?.ext,
          })
        : null,
    [song],
  );
  const state = useSyncExternalStore(
    useCallback((fn: () => void) => engine?.subscribe(fn) ?? (() => {}), [engine]),
    () => engine?.state ?? null,
  );

  useEffect(() => {
    if (!song) return;
    let alive = true;
    setLoadError(null);
    loadLyrics(song.slug)
      .then((l) => {
        if (alive) setLyrics(l);
      })
      .catch(() => {
        if (!alive) return;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        setLoadError(offline ? 'Нет сети. Проверьте соединение и повторите.' : 'Не удалось открыть текст этой песни.');
      });
    return () => {
      alive = false;
    };
  }, [song, textAttempt]);

  useEffect(() => {
    if (!song || !engine) return;
    let alive = true;
    const net = readNetHint(navigator);
    // Metadata at most until the sky has painted. A slow connection fetches nothing yet.
    engine.setPreload(preloadMode('first', net));
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!alive) return;
        engine.setPreload(preloadMode('settle', net));
        enableSongFonts();
        const next = nextSlug(song.slug);
        if (next) prefetchLyrics(next);
      });
    });
    const s = settings;
    void engine.init({ quality: s.quality, rate: s.rate, volume: s.volume, normalize: s.normalize }).then(() => {
      if (!alive) return;
      if (s.eqEnabled) engine.setEffects(true, s.eqBands, s.eqPreamp);
      // Deep link to a moment: /song/<slug>?t=95
      const t = parseFloat(new URLSearchParams(location.search).get('t') ?? '');
      if (Number.isFinite(t)) engine.seek(t);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      engine.destroy();
    };
    // Settings are read once at start; later changes go through the settings sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, engine]);

  // Peaks, engravings and the feature file are not on the first frame. They wait until the text is up and the browser is idle.
  useEffect(() => {
    if (!song || !lyrics) return;
    let alive = true;
    const ctrl = new AbortController();
    const run = () => {
      if (!alive) return;
      void preloadInstruments(lyrics.sections.flatMap((s) => (s.kind === 'instrumental' ? s.instruments : [])));
      if (song.audio.peaks) void loadPeaks(song.audio.peaks).then((p) => alive && p && setPeaks(p));
      fetch(`/audio/${song.slug}/features.json`, { signal: ctrl.signal, priority: 'low' })
        .then((res) => (res.ok ? res.json() : null))
        .then((raw) => {
          if (alive) setFeatures(parseAudioFeatures(raw));
        })
        .catch(() => {
          /* aborted, or no file: the drawings stay still */
        });
    };
    const host = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleWasCallback = typeof host.requestIdleCallback === 'function';
    const idle = idleWasCallback ? host.requestIdleCallback!(run, { timeout: 1500 }) : window.setTimeout(run, 80);
    return () => {
      alive = false;
      ctrl.abort();
      if (idleWasCallback) host.cancelIdleCallback?.(idle);
      else clearTimeout(idle);
    };
  }, [song, lyrics]);

  useEffect(() => {
    if (!song || !state?.canPlay) return;
    const next = nextSlug(song.slug);
    const following = next ? getSong(next) : undefined;
    if (following) prefetchRecording(recordingUrl(following, settings.quality));
  }, [song, state?.canPlay, settings.quality]);

  // A file attached on this device has no peaks.json: compute an envelope once.
  useEffect(() => {
    if (state?.source === 'local' && !song?.audio.peaks && engine) void engine.computePeaks().then((p) => p && setPeaks(p));
  }, [state?.source, state?.localName, engine, song]);

  const duration = state?.duration || song?.duration || 0;
  const timeline = useMemo(() => (lyrics ? buildTimeline(lyrics, duration, peaks) : null), [lyrics, duration, peaks]);
  const clock = useCallback(() => engine?.currentTime() ?? 0, [engine]);

  const [owner, setOwner] = useState(-1);
  const [sheet, setSheet] = useState<SheetName>(null);
  const playing = !!state?.playing;

  const seekToCue = useCallback(
    (c: Cue) => {
      if (!engine) return;
      engine.seek(Math.max(0, c.start - (c.kind === 'line' ? LEAD : 0)));
    },
    [engine],
  );

  // Tapping a line plays from it (as in Apple Music).
  const pick = useCallback(
    (idx: number) => {
      const c = timeline?.cues[idx];
      if (!c || !engine) return;
      seekToCue(c);
      if (!engine.playing) engine.toggle();
    },
    [timeline, engine, seekToCue],
  );

  const nav = useCallback(
    (dir: -1 | 1) => {
      if (!timeline || !engine) return;
      const t = engine.currentTime();
      const cur = timeline.ownerAt(t + LEAD);
      // "Back" first returns to the start of the current line if we are well into it.
      if (dir === -1 && cur >= 0 && t - timeline.cues[cur].start > 2.5) return seekToCue(timeline.cues[cur]);
      const next = timeline.cues[Math.max(0, Math.min(timeline.cues.length - 1, cur + dir))];
      if (next) seekToCue(next);
    },
    [timeline, engine, seekToCue],
  );

  useEffect(() => {
    if (engine) engine.onLineNav = nav;
  }, [engine, nav]);

  // "Pause after each line": stop once the line being sung has ended (and only once per line).
  const armed = useRef(-1);
  const done = useRef(-1);
  useEffect(() => {
    if (!timeline || !engine || !settings.pauseAfterLine || !playing) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = engine.currentTime();
      const cues = timeline.cues;
      if (done.current >= 0 && t < cues[done.current].start - 0.5) done.current = -1;
      if (armed.current >= 0) {
        const c = cues[armed.current];
        if (t < c.start - 1) armed.current = -1;
        else if (t >= c.end + 0.12) {
          done.current = armed.current;
          armed.current = -1;
          engine.pause();
          return;
        }
      }
      const i = timeline.ownerAt(t);
      const c = cues[i];
      if (armed.current < 0 && c && c.kind === 'line' && i !== done.current && t < c.end) armed.current = i;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timeline, engine, settings.pauseAfterLine, playing]);

  const togglePlay = useCallback(() => engine?.toggle(), [engine]);

  // A mismatch mark records the clock and the line on stage. It does not pause, seek, or open a sheet.
  const [toast, setToast] = useState<{ id: string; t: number } | null>(null);
  const placeMark = useCallback(() => {
    if (!song || !timeline || !engine) return;
    const mark = marksFor(song.slug).add(momentAt(timeline.cues, owner, engine.currentTime()));
    setToast({ id: mark.id, t: mark.t });
  }, [song, timeline, engine, owner]);
  const undoToast = useCallback(() => {
    if (!song || !toast) return;
    marksFor(song.slug).remove(toast.id);
    setToast(null);
  }, [song, toast]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  // Keyboard: Space play/pause, ←/→ lines, Shift+←/→ ±10 s, T translation, K commentary.
  // M (same physical key as ь) drops a mismatch mark. Repeat is ignored so a held key is one mark.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
        if (e.code === 'Space') return; // let the focused control handle it
      }
      if (e.code === 'Space') togglePlay();
      else if (e.key === 'ArrowRight') (e.shiftKey ? engine?.skip(10) : nav(1));
      else if (e.key === 'ArrowLeft') (e.shiftKey ? engine?.skip(-10) : nav(-1));
      else if (e.key === 't' || e.key === 'е') setSettings({ showTranslation: !settings.showTranslation });
      else if (e.key === 'k' || e.key === 'л') setSettings({ showComment: !settings.showComment });
      else if (e.code === 'KeyM') {
        if (!e.repeat) placeMark();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, togglePlay, nav, engine, settings.showTranslation, settings.showComment, placeMark]);

  const back = useHold(
    () => nav(-1),
    () => engine?.skip(-5),
  );
  const fwd = useHold(
    () => nav(1),
    () => engine?.skip(5),
  );

  if (!song || !engine) return <NotFound />;

  const poets = song.poets?.map((p) => p.name).join(' · ');
  const buffering = !!state?.buffering;
  const playLabel = buffering ? (playing ? 'Буферизация' : 'Загрузка записи') : playing ? 'Пауза' : 'Воспроизвести';
  const ownerCue = timeline && owner >= 0 ? timeline.cues[owner] : null;
  const partLabel = headerLine(song, ownerCue);
  const metaLabel = partLabel && partLabel !== song.version.label ? `${song.version.label} · ${partLabel}` : song.version.label;
  const comment = timeline && settings.showComment && owner >= 0 ? commentFor(timeline, owner) : null;
  const allLines = lyrics?.sections.flatMap((s) => (s.kind === 'vocal' ? s.lines : [])) ?? [];
  const arabScript = /[\u0600-\u06FF]/;
  const has = {
    translit: allLines.some((l) => l.translit),
    alt: allLines.some((l) => l.alt),
    persian: allLines.some((l) => l.lang === 'fa'),
    arab:
      arabScript.test(song.titleOriginal ?? '') ||
      allLines.some((l) => l.script === 'Arab' || l.script === 'Aran' || l.alt?.script === 'Arab' || l.alt?.script === 'Aran' || arabScript.test(l.comment ?? '')) ||
      (lyrics?.sections.some((s) => arabScript.test(s.comment ?? '')) ?? false),
  };

  return (
    <div
      className={`song${comment ? ' has-comment' : ''}${settings.commentOpen ? ' comment-open' : ''}`}
      style={{ background: dark ? '#07060c' : (song.palette.field[2] ?? song.palette.field[0]) }}
    >
      <Field colors={song.palette.field} dark={dark} clock={timeline ? clock : undefined} t={0} still={!timeline} />
      {leaving && (
        <div className="sky-leave" aria-hidden>
          <Field colors={leaving} dark={dark} t={0} still />
        </div>
      )}
      {timeline ? (
        <Scene song={song} timeline={timeline} settings={settings} features={features} clock={clock} onOwnerChange={setOwner} onPick={pick} />
      ) : (
        <div className="scene scene--hold">
          <div className="scene-stage">
            <div className="fb fb--intro is-held">
              <div className="intro-title">{song.title}</div>
              {song.titleOriginal && (
                <div className="intro-original f-mushaf" dir="rtl">
                  {showHarakatText(song.titleOriginal, settings.showHarakat)}
                </div>
              )}
              <div className="intro-meta t-subhead">{song.version.label}</div>
              <div className="intro-meta t-subhead">{song.artist}</div>
              {poets && <div className="intro-poets t-footnote">{poets}</div>}
              {loadError && (
                <Status
                  className="load-error glass"
                  icon="book.closed"
                  live="alert"
                  action={
                    <button type="button" className="btn btn-capsule btn-tinted" onClick={() => setTextAttempt((n) => n + 1)}>
                      Повторить
                    </button>
                  }
                >
                  {loadError}
                </Status>
              )}
            </div>
          </div>
        </div>
      )}

      <header className="topbar glass">
        <a className="btn btn-circle btn-plain" href="/" onClick={linkHandler('/')} aria-label="К списку песен">
          <Icon name="chevron.left" size={22} />
        </a>
        <div className="topbar-title">
          <div className="topbar-song">{song.title}</div>
          <div className="topbar-meta" title={metaLabel}>
            {metaLabel}
          </div>
        </div>
        <button className="btn btn-circle btn-plain" onClick={() => setSheet('info')} aria-label="О песне">
          <Icon name="info.circle" size={22} />
        </button>
      </header>

      {comment && (
        <aside className={`comment glass${settings.commentOpen ? ' is-open' : ''}`} aria-label="Пояснение">
          <button className="comment-head" onClick={() => setSettings({ commentOpen: !settings.commentOpen })} aria-expanded={settings.commentOpen}>
            <span className="comment-kicker">Пояснение</span>
            <span className="comment-preview">{settings.commentOpen ? '' : (settings.showHarakat ? comment.text : stripHarakat(comment.text)).replace(/\*+/g, '')}</span>
            <Icon name="chevron.down" size={20} className="comment-chevron" />
          </button>
          <div className="comment-fold">
            <RichText key={comment.from.idx} text={comment.text} showHarakat={settings.showHarakat} className="comment-body" />
          </div>
        </aside>
      )}

      {state?.error && (
        <Status
          className="player-alert glass"
          icon="music.note"
          live="alert"
          action={
            <button type="button" className="btn btn-capsule btn-tinted" onClick={() => engine.retry()}>
              Повторить
            </button>
          }
        >
          {state.error}
        </Status>
      )}
      {state?.source === 'silent' && !playing && !song.audio.high && !song.audio.saver && (
        <button className="hint" onClick={() => setSheet('settings')}>
          <Icon name="music.note" size={16} />
          Аудио не подключено — подключить
        </button>
      )}

      <footer className="player glass">
        {timeline ? (
          <Scrubber
            timeline={timeline}
            duration={duration}
            clock={clock}
            onSeek={(t) => engine.seek(t)}
            accessory={
              <div className="mark-bar">
                {toast && (
                  <div className="mark-toast" role="status">
                    <span>Отмечено {formatTime(toast.t)}</span>
                    <button type="button" className="mark-toast-undo" onClick={undoToast}>
                      Отменить
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="mark-btn"
                  onClick={placeMark}
                  disabled={!timeline}
                  aria-label="Не совпадает"
                  title="Не совпадает"
                  aria-keyshortcuts="M"
                >
                  <Icon name="flag" size={20} />
                </button>
                <kbd className="mark-kbd" aria-hidden="true">
                  M
                </kbd>
              </div>
            }
          />
        ) : (
          <div className="scrub scrub--hold" aria-hidden="true">
            <div className="scrub-top" />
            <div className="scrub-track">
              <div className="scrub-rail" />
            </div>
            <div className="scrub-meta">
              <span className="scrub-remain"> </span>
            </div>
          </div>
        )}
        <div className="transport">
          <button className="btn btn-plain btn-lg-hit" {...back} aria-label="Предыдущая строка (удерживайте — перемотка назад)">
            <Icon name="backward" size={24} />
          </button>
          <button
            className={`btn btn-circle btn-xl btn-ring${buffering ? ' is-buffering' : ''}`}
            onClick={togglePlay}
            aria-label={playLabel}
            aria-busy={buffering}
          >
            {buffering && !playing ? (
              <span className="btn-buffer" aria-hidden="true" />
            ) : (
              <Icon name={playing ? 'pause' : 'play'} size={28} />
            )}
          </button>
          <button className="btn btn-plain btn-lg-hit" {...fwd} aria-label="Следующая строка (удерживайте — перемотка вперёд)">
            <Icon name="forward" size={24} />
          </button>
        </div>
        <div className="utility">
          <button className="util" aria-label="Перевод" aria-pressed={settings.showTranslation} onClick={() => setSettings({ showTranslation: !settings.showTranslation })}>
            <Icon name="character.bubble" size={24} />
            <span className="util-label" aria-hidden="true">Перевод</span>
          </button>
          <button className="util" aria-label="Пояснение" aria-pressed={settings.showComment} onClick={() => setSettings({ showComment: !settings.showComment })}>
            <Icon name="book.closed" size={24} />
            <span className="util-label" aria-hidden="true">Пояснение</span>
          </button>
          <button className="util" aria-label="Весь текст" aria-pressed={sheet === 'text'} onClick={() => setSheet('text')}>
            <Icon name="list.bullet" size={24} />
            <span className="util-label" aria-hidden="true">Весь текст</span>
          </button>
          <button className="util" aria-label="Настройки" aria-pressed={sheet === 'settings'} onClick={() => setSheet('settings')}>
            <Icon name="slider.horizontal.3" size={24} />
            <span className="util-label" aria-hidden="true">Настройки</span>
          </button>
        </div>
      </footer>

      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} song={song} engine={engine} state={state} settings={settings} has={has} />
      <InfoSheet
        open={sheet === 'info'}
        onClose={() => setSheet(null)}
        song={song}
        lyrics={lyrics}
        showHarakat={settings.showHarakat}
        fontPersian={settings.fontPersian}
        pendingNote={!lyrics ? (loadError ?? 'Подробности строк ещё открываются') : null}
        onSeek={(t) => {
          engine.seek(t);
          setSheet(null);
        }}
      />
      <TextSheet
        open={sheet === 'text'}
        onClose={() => setSheet(null)}
        timeline={timeline}
        owner={owner}
        settings={settings}
        error={loadError}
        onRetry={() => setTextAttempt((n) => n + 1)}
        onPick={(idx) => {
          setSheet(null);
          pick(idx);
        }}
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="empty">
      <p className="empty-title">Песня не найдена</p>
      <p className="t-body secondary">В библиотеке нет песни с таким адресом.</p>
      <a className="btn btn-capsule btn-tinted" href="/" onClick={linkHandler('/')}>
        К списку песен
      </a>
    </div>
  );
}
