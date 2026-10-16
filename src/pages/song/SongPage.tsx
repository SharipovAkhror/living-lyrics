import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getSong, loadLyrics, loadPeaks } from '@/data/library';
import type { Lyrics, Peaks } from '@/data/schema';
import { buildTimeline, sharhFor, type Cue } from '@/data/timeline';
import { useSettings, setSettings } from '@/app/settings';
import { useSongAccent } from '@/app/theme';
import { linkHandler } from '@/app/router';
import { AudioEngine } from '@/player/engine';
import { Scrubber } from '@/player/Scrubber';
import { Scene } from '@/scene/Scene';
import { Icon } from '@/icons/Icon';
import { RichText } from '@/components/RichText';
import { SoundSheet } from './SoundSheet';
import { DisplaySheet } from './DisplaySheet';
import { TextSheet } from './TextSheet';

type SheetName = 'sound' | 'display' | 'text' | null;

export function SongPage({ slug, dark }: { slug: string; dark: boolean }) {
  const song = getSong(slug);
  useSongAccent(song);
  const settings = useSettings();
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const engine = useMemo(
    () =>
      song
        ? new AudioEngine({
            slug: song.slug,
            title: song.title,
            artist: song.artist,
            album: song.release?.album,
            duration: song.duration,
            urls: { high: song.audio.high, saver: song.audio.saver },
            gainDb: song.audio.gainDb,
          })
        : null,
    [song],
  );
  const state = useSyncExternalStore(
    useCallback((fn: () => void) => engine?.subscribe(fn) ?? (() => {}), [engine]),
    () => engine?.state ?? null,
  );

  useEffect(() => {
    if (!song || !engine) return;
    let alive = true;
    loadLyrics(song.slug)
      .then((l) => alive && setLyrics(l))
      .catch((e) => alive && setLoadError(String(e)));
    if (song.audio.peaks) void loadPeaks(song.audio.peaks).then((p) => alive && p && setPeaks(p));
    const s = settings;
    void engine.init({ quality: s.quality, rate: s.rate, volume: s.volume, normalize: s.normalize }).then(() => {
      if (s.eqEnabled) engine.setEffects(true, s.eqBands, s.eqPreamp);
      // Deep link to a moment: /song/<slug>?t=95
      const t = parseFloat(new URLSearchParams(location.search).get('t') ?? '');
      if (Number.isFinite(t)) engine.seek(t);
    });
    return () => {
      alive = false;
      engine.destroy();
    };
    // Settings are read once at start; later changes go through the sheets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, engine]);

  // A file attached on this device has no peaks.json: compute an envelope once.
  useEffect(() => {
    if (state?.source === 'local' && !song?.audio.peaks && engine) void engine.computePeaks().then((p) => p && setPeaks(p));
  }, [state?.source, state?.localName, engine, song]);

  const duration = state?.duration || song?.duration || 0;
  const timeline = useMemo(() => (lyrics ? buildTimeline(lyrics, duration, peaks) : null), [lyrics, duration, peaks]);
  const clock = useCallback(() => engine?.currentTime() ?? 0, [engine]);

  const [owner, setOwner] = useState(-1);
  const [manualIdx, setManualIdx] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<SheetName>(null);
  const playing = !!state?.playing;
  const manual = settings.follow === 'manual';
  const frozen = manual && !playing && timeline ? Math.min(manualIdx, timeline.cues.length - 1) : null;

  const onOwnerChange = useCallback(
    (idx: number) => {
      setOwner(idx);
      if (engine?.playing) setManualIdx(Math.max(0, idx));
    },
    [engine],
  );

  // Switching to manual pins the line that is on stage now.
  const prevFollow = useRef(settings.follow);
  useEffect(() => {
    if (prevFollow.current !== settings.follow && settings.follow === 'manual') setManualIdx(Math.max(0, owner));
    prevFollow.current = settings.follow;
  }, [settings.follow, owner]);

  // Manual mode with "pause after line": stop when the current line has been sung.
  useEffect(() => {
    if (!timeline || !engine || !manual || !settings.pauseAfterLine || !playing) return;
    const target = timeline.cues[manualIdx];
    if (!target) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (engine.currentTime() >= target.end + 0.3) {
        engine.pause();
        setManualIdx(target.idx);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timeline, engine, manual, settings.pauseAfterLine, playing, manualIdx]);

  const seekToCue = useCallback(
    (c: Cue) => {
      if (!engine) return;
      const lead = c.kind === 'line' ? Math.min(0.5, c.start - c.show) : 0;
      engine.seek(Math.max(0, c.start - lead - 0.05));
    },
    [engine],
  );

  const nav = useCallback(
    (dir: -1 | 1) => {
      if (!timeline || !engine) return;
      const base = manual && !playing ? manualIdx : owner;
      // "Back" first returns to the start of the current line if we are well into it.
      if (dir === -1 && !manual && base >= 0) {
        const cur = timeline.cues[base];
        if (engine.currentTime() - cur.start > 2.5) return seekToCue(cur);
      }
      const nextIdx = Math.max(0, Math.min(timeline.cues.length - 1, base + dir));
      const target = timeline.cues[nextIdx];
      if (manual) setManualIdx(nextIdx);
      if (!manual || playing) seekToCue(target);
      else engine.seek(target.start);
    },
    [timeline, engine, manual, playing, manualIdx, owner, seekToCue],
  );

  useEffect(() => {
    if (engine) engine.onLineNav = nav;
  }, [engine, nav]);

  const togglePlay = useCallback(() => {
    if (!engine || !timeline) return;
    if (manual && !playing) {
      const c = timeline.cues[manualIdx];
      if (c) seekToCue(c);
    }
    engine.toggle();
  }, [engine, timeline, manual, playing, manualIdx, seekToCue]);

  // Keyboard: Space play/pause, ←/→ lines, Shift+←/→ ±10 s, T translation, K commentary, F full screen chrome.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') togglePlay();
      else if (e.key === 'ArrowRight') (e.shiftKey ? engine?.skip(10) : nav(1));
      else if (e.key === 'ArrowLeft') (e.shiftKey ? engine?.skip(-10) : nav(-1));
      else if (e.key === 't' || e.key === 'е') setSettings({ showTranslation: !settings.showTranslation });
      else if (e.key === 'k' || e.key === 'л') setSettings({ showSharh: !settings.showSharh });
      else if (e.key === 'f' || e.key === 'а') setChrome((c) => !c);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, togglePlay, nav, engine, settings.showTranslation, settings.showSharh]);

  if (!song || !engine) return <NotFound />;

  const ownerCue = timeline && owner >= 0 ? timeline.cues[frozen ?? owner] : null;
  const sectionLabel = ownerCue ? ownerCue.section.label : song.artist;
  const sharh = timeline && settings.showSharh ? sharhFor(timeline, frozen ?? owner) : null;
  const allLines = lyrics?.sections.flatMap((s) => (s.kind === 'vocal' ? s.lines : [])) ?? [];
  const hasTranslit = allLines.some((l) => l.translit);
  const hasAlt = allLines.some((l) => l.alt);
  const hasPersian = allLines.some((l) => l.lang === 'fa');

  return (
    <div className={`song${chrome ? '' : ' is-immersive'}${sharh ? ' has-sharh' : ''}${settings.sharhOpen ? ' sharh-open' : ''}`}>
      {timeline ? (
        <Scene
          song={song}
          timeline={timeline}
          settings={settings}
          dark={dark}
          clock={clock}
          frozen={frozen}
          onOwnerChange={onOwnerChange}
          onTap={() => setChrome((c) => !c)}
          onSwipe={nav}
        />
      ) : (
        <div className="scene scene--loading">{loadError ? <p className="t-body secondary">{loadError}</p> : null}</div>
      )}

      <header className="topbar">
        <a className="btn btn-circle glass" href="/" onClick={linkHandler('/')} aria-label="К списку песен">
          <Icon name="chevron.left" size={20} weight={2.2} />
        </a>
        <div className="topbar-title">
          <div className="t-headline topbar-song">{song.title}</div>
          <div className="t-footnote secondary topbar-section">{sectionLabel}</div>
        </div>
        <button
          className="btn btn-capsule glass mode-btn"
          onClick={() => setSettings({ follow: manual ? 'auto' : 'manual' })}
          aria-label={manual ? 'Режим: вручную. Переключить на ведение за музыкой' : 'Режим: за музыкой. Переключить на ручное листание'}
        >
          <Icon name={manual ? 'hand.raised' : 'wand'} size={18} />
          <span className="mode-label mode-label--long">{manual ? 'Вручную' : 'За музыкой'}</span>
          <span className="mode-label mode-label--short">{manual ? 'Руками' : 'Авто'}</span>
        </button>
      </header>

      {sharh && (
        <aside className={`sharh material material--thick${settings.sharhOpen ? ' is-open' : ''}`} aria-label="Шарх">
          <button className="sharh-head" onClick={() => setSettings({ sharhOpen: !settings.sharhOpen })} aria-expanded={settings.sharhOpen}>
            <Icon name="book.closed" size={17} className="sharh-icon" />
            <span className="sharh-kicker t-footnote">Шарх</span>
            <span className="sharh-preview t-footnote secondary">{settings.sharhOpen ? '' : sharh.text.replace(/\*+/g, '')}</span>
            <Icon name={settings.sharhOpen ? 'chevron.down' : 'chevron.up'} size={15} weight={2.2} className="sharh-chevron tertiary" />
          </button>
          <RichText key={sharh.from.idx} text={sharh.text} className="sharh-body t-callout" />
        </aside>
      )}

      {state?.source === 'silent' && !playing && (
        <button className="hint glass t-footnote" onClick={() => setSheet('sound')}>
          <Icon name="music.note" size={15} />
          Аудио не подключено — подключить
        </button>
      )}

      <footer className="player glass">
        {timeline && <Scrubber timeline={timeline} duration={duration} clock={clock} onSeek={(t) => engine.seek(t)} />}
        <div className="transport">
          <button className="btn btn-plain" onClick={() => engine.skip(-10)} aria-label="Назад на 10 секунд">
            <Icon name="gobackward.10" size={26} weight={1.8} />
          </button>
          <button className="btn btn-plain btn-lg-hit" onClick={() => nav(-1)} aria-label="Предыдущая строка">
            <Icon name="backward" size={30} />
          </button>
          <button className="btn btn-circle btn-xl btn-prominent" onClick={togglePlay} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>
            <Icon name={playing ? 'pause' : 'play'} size={30} style={playing ? undefined : { marginLeft: 3 }} />
          </button>
          <button className="btn btn-plain btn-lg-hit" onClick={() => nav(1)} aria-label="Следующая строка">
            <Icon name="forward" size={30} />
          </button>
          <button className="btn btn-plain" onClick={() => engine.skip(10)} aria-label="Вперёд на 10 секунд">
            <Icon name="goforward.10" size={26} weight={1.8} />
          </button>
        </div>
        <div className="utility">
          <button className="btn btn-plain" aria-pressed={settings.showSharh} onClick={() => setSettings({ showSharh: !settings.showSharh })} aria-label="Шарх">
            <Icon name="book.closed" size={21} />
          </button>
          <button className="btn btn-plain" onClick={() => setSheet('text')} aria-label="Весь текст">
            <Icon name="quote.bubble" size={21} />
          </button>
          <button className="btn btn-plain" onClick={() => setSheet('display')} aria-label="Вид">
            <Icon name="textformat" size={23} />
          </button>
          <button className="btn btn-plain" onClick={() => setSheet('sound')} aria-label="Звук" aria-pressed={settings.eqEnabled}>
            <Icon name="slider.vertical.3" size={21} />
          </button>
        </div>
      </footer>

      {state && (
        <SoundSheet open={sheet === 'sound'} onClose={() => setSheet(null)} song={song} engine={engine} state={state} settings={settings} />
      )}
      <DisplaySheet
        open={sheet === 'display'}
        onClose={() => setSheet(null)}
        song={song}
        settings={settings}
        hasTranslit={hasTranslit}
        hasAlt={hasAlt}
        hasPersian={hasPersian}
      />
      {timeline && (
        <TextSheet
          open={sheet === 'text'}
          onClose={() => setSheet(null)}
          timeline={timeline}
          owner={frozen ?? owner}
          settings={settings}
          onPick={(idx) => {
            setSheet(null);
            setManualIdx(idx);
            const c = timeline.cues[idx];
            if (!manual || playing) seekToCue(c);
            else engine.seek(c.start);
          }}
        />
      )}
    </div>
  );
}

function NotFound() {
  return (
    <div className="empty">
      <p className="t-title3">Песня не найдена</p>
      <a className="btn btn-capsule btn-tinted" href="/" onClick={linkHandler('/')}>
        К списку песен
      </a>
    </div>
  );
}
