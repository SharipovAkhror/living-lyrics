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
import { LEAD } from '@/scene/flow';
import { Icon } from '@/icons/Icon';
import { RichText } from '@/components/RichText';
import { preloadInstruments } from '@/instruments/catalog';
import { SettingsSheet } from './SettingsSheet';
import { TextSheet } from './TextSheet';
import { InfoSheet } from './InfoSheet';

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
      .then((l) => {
        if (!alive) return;
        setLyrics(l);
        void preloadInstruments(l.sections.flatMap((s) => (s.kind === 'instrumental' ? s.instruments : [])));
      })
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
    // Settings are read once at start; later changes go through the settings sheet.
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

  // Keyboard: Space play/pause, ←/→ lines, Shift+←/→ ±10 s, T translation, K commentary.
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
      else if (e.key === 'k' || e.key === 'л') setSettings({ showSharh: !settings.showSharh });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, togglePlay, nav, engine, settings.showTranslation, settings.showSharh]);

  const back = useHold(
    () => nav(-1),
    () => engine?.skip(-5),
  );
  const fwd = useHold(
    () => nav(1),
    () => engine?.skip(5),
  );

  if (!song || !engine) return <NotFound />;

  const ownerCue = timeline && owner >= 0 ? timeline.cues[owner] : null;
  const sectionLabel = ownerCue ? ownerCue.section.label : song.artist;
  const sharh = timeline && settings.showSharh && owner >= 0 ? sharhFor(timeline, owner) : null;
  const allLines = lyrics?.sections.flatMap((s) => (s.kind === 'vocal' ? s.lines : [])) ?? [];
  const has = { translit: allLines.some((l) => l.translit), alt: allLines.some((l) => l.alt), persian: allLines.some((l) => l.lang === 'fa') };

  return (
    <div className={`song${sharh ? ' has-sharh' : ''}${settings.sharhOpen ? ' sharh-open' : ''}`}>
      {timeline ? (
        <Scene song={song} timeline={timeline} settings={settings} dark={dark} clock={clock} onOwnerChange={setOwner} onPick={pick} />
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
        <button className="btn btn-circle glass" onClick={() => setSheet('info')} aria-label="О песне: кто поёт и играет">
          <Icon name="info.circle" size={21} />
        </button>
      </header>

      {sharh && (
        <aside className={`sharh material material--thick${settings.sharhOpen ? ' is-open' : ''}`} aria-label="Пояснение">
          <button className="sharh-head" onClick={() => setSettings({ sharhOpen: !settings.sharhOpen })} aria-expanded={settings.sharhOpen}>
            <Icon name="book.closed" size={17} className="sharh-icon" />
            <span className="sharh-kicker t-footnote">Пояснение</span>
            <span className="sharh-preview t-footnote secondary">{settings.sharhOpen ? '' : sharh.text.replace(/\*+/g, '')}</span>
            <Icon name={settings.sharhOpen ? 'chevron.down' : 'chevron.up'} size={15} weight={2.2} className="sharh-chevron tertiary" />
          </button>
          <RichText key={sharh.from.idx} text={sharh.text} className="sharh-body t-callout" />
        </aside>
      )}

      {state?.source === 'silent' && !playing && (
        <button className="hint glass t-footnote" onClick={() => setSheet('settings')}>
          <Icon name="music.note" size={15} />
          Аудио не подключено — подключить
        </button>
      )}

      <footer className="player glass">
        {timeline && <Scrubber timeline={timeline} duration={duration} clock={clock} onSeek={(t) => engine.seek(t)} />}
        <div className="transport">
          <button className="btn btn-plain btn-lg-hit" {...back} aria-label="Предыдущая строка (удерживайте — перемотка назад)">
            <Icon name="backward" size={30} />
          </button>
          <button className="btn btn-circle btn-xl btn-prominent" onClick={togglePlay} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>
            <Icon name={playing ? 'pause' : 'play'} size={30} style={playing ? undefined : { marginLeft: 3 }} />
          </button>
          <button className="btn btn-plain btn-lg-hit" {...fwd} aria-label="Следующая строка (удерживайте — перемотка вперёд)">
            <Icon name="forward" size={30} />
          </button>
        </div>
        <div className="utility">
          <button className="util" aria-pressed={settings.showTranslation} onClick={() => setSettings({ showTranslation: !settings.showTranslation })}>
            <Icon name="character.bubble" size={22} />
            <span>Перевод</span>
          </button>
          <button className="util" aria-pressed={settings.showSharh} onClick={() => setSettings({ showSharh: !settings.showSharh })}>
            <Icon name="book.closed" size={21} />
            <span>Пояснение</span>
          </button>
          <button className="util" onClick={() => setSheet('text')}>
            <Icon name="list.bullet" size={22} />
            <span>Весь текст</span>
          </button>
          <button className="util" onClick={() => setSheet('settings')}>
            <Icon name="slider.horizontal.3" size={22} />
            <span>Настройки</span>
          </button>
        </div>
      </footer>

      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} song={song} engine={engine} state={state} settings={settings} has={has} />
      <InfoSheet open={sheet === 'info'} onClose={() => setSheet(null)} song={song} lyrics={lyrics} />
      {timeline && (
        <TextSheet
          open={sheet === 'text'}
          onClose={() => setSheet(null)}
          timeline={timeline}
          owner={owner}
          settings={settings}
          onPick={(idx) => {
            setSheet(null);
            pick(idx);
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
