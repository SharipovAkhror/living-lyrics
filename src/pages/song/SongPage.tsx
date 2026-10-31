import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { formatTime, getSong, loadLyrics, loadPeaks, peekLyrics } from '@/data/library';
import { coverExt, coverUrl } from '@/data/covers';
import { rememberSong } from '@/app/continue';
import { marksFor, momentAt } from '@/app/marks';
import type { Lyrics, Peaks, Song } from '@/data/schema';
import { buildTimeline, commentFor, type Cue, type Timeline } from '@/data/timeline';
import { useSettings, setSettings, type Settings } from '@/app/settings';
import { useSongAccent } from '@/app/theme';
import { enableSongFonts } from '@/app/fontCatalog';
import { nextSlug, prefetchLyrics, prefetchRecording, recordingUrl } from '@/app/prefetch';
import { linkHandler } from '@/app/router';
import { followHeader, hasFlight, motionBlocked, playRise } from '@/app/morph';
import { SPRING, stepSpring, type SpringState } from '@/ui/spring';
import { bindPress } from '@/ui/press';
import { PlayPause } from '@/ui/playglyph';
import { GlassLayers } from '@/ui/glass/Glass';
import { AudioEngine, type EngineState } from '@/player/engine';
import { preloadMode, readNetHint } from '@/player/preload';
import { writeResume, usableResume } from '@/player/resume';
import { recordLastError } from '@/player/lastError';
import { Scrubber } from '@/player/Scrubber';
import { Scene } from '@/scene/Scene';
import { SHEET_SHELL_MS, coverStage } from '@/scene/cover';
import { fitNote } from '@/scene/noteFit';
import { Field } from '@/scene/Field';
import { LEAD, flowPosition, planFlow } from '@/scene/flow';
import { Icon } from '@/ui/icons';
import { RichText } from '@/components/RichText';
import { Status } from '@/components/Status';
import { showHarakatText, stripHarakat } from '@/data/harakat';
import { stageFrame, type StageFrame } from '@/scene/columns';
import { parseAudioFeatures, type AudioFeatures } from '@/instruments/animation';
import { SceneBoundary } from './SceneBoundary';
import { headerLine } from './parts';
import { keyAction } from '@/app/keys';
import { KeysHelp } from '@/ui/KeysHelp';

type LoadedSheets = {
  Settings: typeof import('./SettingsSheet').SettingsSheet;
  Text: typeof import('./TextSheet').TextSheet;
  Info: typeof import('./InfoSheet').InfoSheet;
  Note: typeof import('./NoteSheet').NoteSheet;
};

/**
 * The sheets stay in their own chunks. React.lazy still suspends on the first
 * render, and React then holds that reveal for 300 ms (FALLBACK_THROTTLE_MS),
 * so the glass did not exist until well after the tap. The import is started
 * with the page and the component rendered is the function itself.
 */
function useSheets(): LoadedSheets | null {
  const [sheets, setSheets] = useState<LoadedSheets | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      import('./SettingsSheet').then((m) => m.SettingsSheet),
      import('./TextSheet').then((m) => m.TextSheet),
      import('./InfoSheet').then((m) => m.InfoSheet),
      import('./NoteSheet').then((m) => m.NoteSheet),
    ]).then(([Settings, Text, Info, Note]) => {
      if (alive) setSheets({ Settings, Text, Info, Note });
    });
    return () => {
      alive = false;
    };
  }, []);
  return sheets;
}

/** Keep a sheet mounted after its first open so the close spring can finish. */
function useHeld(open: boolean) {
  const [held, setHeld] = useState(open);
  if (open && !held) setHeld(true);
  return held;
}

type SheetName = 'settings' | 'text' | 'info' | 'note' | null;

/** The landscape query that used to turn the floor note into a second «Пояснение» pill. */
const SHORT_LAND =
  '(min-width: 700px) and (max-height: 640px), (max-width: 699px) and (max-height: 520px) and (orientation: landscape)';

function useShortLandscape() {
  const [on, setOn] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(SHORT_LAND).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(SHORT_LAND);
    const apply = () => setOn(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return on;
}

/** A quiet round control. The mark is the set's stroke, not a painted cross. */
function CloseDisc({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="close-disc" aria-label={label} onClick={onClick}>
      <Icon name="xmark" size={16} />
    </button>
  );
}

/** Portrait note. Not a dialog: the settings test takes the first one, and the grabber class is theirs. */

function NoteCard({
  text,
  showHarakat,
  onOpen,
  fading,
  suppressed,
}: {
  text: string;
  showHarakat: boolean;
  onOpen: () => void;
  /** The sheet is opening. Hidden before paint, still mounted so the floor height holds. */
  fading?: boolean;
  /** Whole scrub. One fade, not a new one each time the sung line changes. */
  suppressed?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const preview = (showHarakat ? text : stripHarakat(text)).replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  useLayoutEffect(() => {
    const host = ref.current?.closest('.song');
    if (host instanceof HTMLElement) fitNote(host);
  }, [preview]);
  useLayoutEffect(() => {
    const card = ref.current;
    const root = document.documentElement;
    if (!card || !fading) {
      delete root.dataset.noteFade;
      return;
    }
    // The sheet stays off-screen while this flag is set. The card fades on the
    // clock, across several plateaus, and is gone before the sheet can reach it.
    card.style.pointerEvents = 'none';
    card.style.transition = 'none';
    if (motionBlocked()) {
      card.style.opacity = '0';
      card.style.visibility = 'hidden';
      card.style.transform = 'none';
      delete root.dataset.noteFade;
      return;
    }
    root.dataset.noteFade = '1';
    const home = card.getBoundingClientRect();
    // One clock. A recording slows the frame timestamp and leaves performance.now()
    // alone; mixing them kept this flag set and the sheet off-screen.
    let started = -1;
    let raf = 0;
    let alive = true;
    const paint = (now: number) => {
      if (!alive) return;
      if (started < 0) started = now;
      const sheet = document.querySelector('.sheet');
      const sheetTop = sheet instanceof HTMLElement ? sheet.getBoundingClientRect().top : window.innerHeight + 80;
      const elapsed = now - started;
      let t = 0;
      if (elapsed >= 160) t = 1;
      else if (elapsed >= 120) t = 0.75;
      else if (elapsed >= 80) t = 0.5;
      else if (elapsed >= 40) t = 0.25;
      if (sheetTop < home.bottom + 8) t = 1;
      card.style.opacity = (1 - t).toFixed(3);
      card.style.transform = `translate3d(0, ${(t * 18).toFixed(1)}px, 0)`;
      card.style.visibility = t >= 0.98 ? 'hidden' : 'visible';
      if (t >= 1) {
        delete root.dataset.noteFade;
        return;
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      alive = false;
      delete root.dataset.noteFade;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [fading]);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || fading) return;
    const raw = parseFloat(card.style.opacity);
    const from = Number.isFinite(raw) ? raw : 1;
    const target = suppressed ? 0 : 1;
    if (!suppressed && from > 0.98) {
      card.style.opacity = '';
      card.style.visibility = '';
      card.style.pointerEvents = '';
      card.style.transform = '';
      card.style.transition = '';
      return;
    }
    if (motionBlocked()) {
      card.style.transition = 'none';
      card.style.opacity = target ? '' : '0';
      card.style.visibility = target ? '' : 'hidden';
      card.style.pointerEvents = target ? '' : 'none';
      return;
    }
    let spring: SpringState = { x: from, v: 0 };
    let last = 0;
    let raf = 0;
    let alive = true;
    card.style.transition = 'none';
    card.style.pointerEvents = target ? '' : 'none';
    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
      last = now;
      spring = stepSpring(spring, target, dt, SPRING);
      const t = Math.max(0, Math.min(1, spring.x));
      card.style.opacity = t.toFixed(3);
      card.style.visibility = t < 0.04 ? 'hidden' : 'visible';
      if (Math.abs(spring.x - target) < 0.012 && Math.abs(spring.v) < 0.05) {
        card.style.opacity = target ? '' : '0';
        card.style.visibility = target ? '' : 'hidden';
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [suppressed, fading]);
  return (
    <aside ref={ref} className="note-card" role="region" aria-label="Пояснение">
      <button type="button" className="note-line" onClick={onOpen}>
        {/* Keyed: fitNote rewrites the text to a whole clause, a new note is a new node. */}
        <span key={preview} className="note-line-text" data-full={preview}>
          {preview}
        </span>
        <span className="note-more">ещё</span>
      </button>
    </aside>
  );
}

/** The stage width follows one geometry, including the margin note when it is open. */
function useStageFrame(noteOpen: boolean) {
  const read = (): { frame: StageFrame; columnFits: boolean } => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return { frame: stageFrame(vw, vh, noteOpen), columnFits: stageFrame(vw, vh, true).marginNote };
  };
  const [box, setBox] = useState(read);
  useLayoutEffect(() => {
    const apply = () => {
      const next = read();
      // A phone frame ignores the note. Skip the render when the numbers did not move.
      setBox((prev) => (sameStageBox(prev, next) ? prev : next));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [noteOpen]);
  return box;
}

function sameStageBox(
  a: { frame: StageFrame; columnFits: boolean },
  b: { frame: StageFrame; columnFits: boolean },
) {
  if (a.columnFits !== b.columnFits) return false;
  const left = a.frame;
  const right = b.frame;
  return (
    left.colLeft === right.colLeft &&
    left.colRight === right.colRight &&
    left.noteW === right.noteW &&
    left.panelInset === right.panelInset &&
    left.noteRight === right.noteRight &&
    left.gap === right.gap &&
    left.stageW === right.stageW &&
    left.lyricW === right.lyricW &&
    left.padX === right.padX &&
    left.marginNote === right.marginNote
  );
}

/**
 * The sung line changes many times a second. Holding that index on the page
 * reconciled the player on the same frame as the route, and the phone missed
 * its interval. Subscribers are the header, the note and the column only.
 */
interface OwnerStore {
  get: () => number;
  set: (next: number) => void;
  subscribe: (listener: () => void) => () => void;
}

function createOwnerStore(): OwnerStore {
  let owner = -1;
  const listeners = new Set<() => void>();
  return {
    get: () => owner,
    set: (next: number) => {
      if (next === owner) return;
      owner = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useOwner(store: OwnerStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * The note object for this cue. The same text keeps the same reference, so a
 * line change that does not change the commentary does not render the card.
 */
function useNoteSnapshot(store: OwnerStore, timeline: Timeline | null) {
  const cache = useRef<{ key: string; note: { text: string; from: Cue } | null }>({ key: '\u0000', note: null });
  const get = useCallback(() => {
    const note = noteAt(timeline, store.get());
    const key = note ? `${note.from.idx}\u0000${note.text}` : '';
    const box = cache.current;
    if (box.key === key) return box.note;
    box.key = key;
    box.note = note;
    return note;
  }, [store, timeline]);
  return useSyncExternalStore(store.subscribe, get, get);
}

function noteAt(timeline: Timeline | null, owner: number) {
  return timeline && owner >= 0 ? commentFor(timeline, owner) : null;
}

function PartExtra({ song, timeline, store }: { song: Song; timeline: Timeline | null; store: OwnerStore }) {
  const owner = useOwner(store);
  const cue = timeline && owner >= 0 ? timeline.cues[owner] : null;
  const partLabel = headerLine(song, cue);
  const partExtra = partLabel && partLabel !== song.artist && partLabel !== song.version.label ? partLabel : '';
  if (!partExtra) return null;
  return <span className="topbar-part"> · {partExtra}</span>;
}

/** Writes the stage column. A phone width does not grow a margin, so this stays quiet there. */
function StageVars({
  songRef,
  store,
  timeline,
  showComment,
}: {
  songRef: RefObject<HTMLDivElement | null>;
  store: OwnerStore;
  timeline: Timeline | null;
  showComment: boolean;
}) {
  const note = useNoteSnapshot(store, timeline);
  const noteOpen = !!(showComment && note);
  const { frame } = useStageFrame(noteOpen);
  // A cold instrumental open left --stage-w at the stylesheet default: the
  // stage was the full window and the plate was the large tier. A scrub that
  // started on a lyric kept the 868 column, so the two pictures differed.
  // Writing only when `frame` changed never corrected that first open. Apply
  // again whenever this child commits and the inline values are missing.
  useLayoutEffect(() => {
    const root = songRef.current;
    if (!root) return;
    const want = {
      '--col-left': `${frame.colLeft}px`,
      '--col-right': `${frame.colRight}px`,
      '--stage-w': `${frame.stageW}px`,
      '--note-w': `${frame.noteW}px`,
      '--lyric-w': `${frame.lyricW}px`,
      '--note-inset': `${frame.panelInset}px`,
      '--note-right': `${frame.noteRight}px`,
    } as const;
    const keys = Object.keys(want) as (keyof typeof want)[];
    const stale = keys.some((key) => root.style.getPropertyValue(key) !== want[key]);
    if (!stale && root.classList.contains('has-margin') === frame.marginNote) return;
    root.classList.toggle('has-margin', frame.marginNote);
    for (const key of keys) root.style.setProperty(key, want[key]);
  });
  return null;
}

function PortraitNote({
  songRef,
  topRef,
  floorRef,
  store,
  timeline,
  showComment,
  showHarakat,
  shortLand,
  sheet,
  scrubbing,
  onOpen,
}: {
  songRef: RefObject<HTMLDivElement | null>;
  topRef: RefObject<HTMLElement | null>;
  floorRef: RefObject<HTMLElement | null>;
  store: OwnerStore;
  timeline: Timeline | null;
  showComment: boolean;
  showHarakat: boolean;
  shortLand: boolean;
  sheet: boolean;
  scrubbing: boolean;
  onOpen: () => void;
}) {
  const noteText = useNoteSnapshot(store, timeline);
  const margin = !!noteText && stageFrame(window.innerWidth, window.innerHeight, true).marginNote;
  const live = showComment && noteText && !margin && !shortLand ? noteText : null;
  const held = useRef(live);
  if (!scrubbing) held.current = live;
  const current = scrubbing ? held.current : live;
  const fadeHold = useRef(current);
  if (!sheet) fadeHold.current = current;
  const shown = sheet ? fadeHold.current : current;
  const had = useRef(false);
  // The stage leaves a footnote's room under each line that has a note, while the phone footnote is in use.
  const footMode = showComment && !shortLand && !stageFrame(window.innerWidth, window.innerHeight, true).marginNote;
  // Passive: a child's layout effect runs before the page's own ref is attached.
  useEffect(() => {
    songRef.current?.classList.toggle('foot-mode', footMode);
  }, [footMode, songRef]);
  useLayoutEffect(() => {
    const show = !!shown;
    if (!show && !had.current) return;
    had.current = show;
    const root = songRef.current;
    const top = topRef.current;
    const floor = floorRef.current;
    if (!root || !top || !floor) return;
    measureChrome(root, top, floor);
  }, [shown?.text, shown?.from.idx, songRef, topRef, floorRef]);
  if (!shown) return null;
  return (
    <NoteCard
      text={shown.text}
      showHarakat={showHarakat}
      onOpen={onOpen}
      fading={sheet}
      suppressed={scrubbing}
    />
  );
}

function FloorNote({
  store,
  timeline,
  showComment,
  showHarakat,
  commentOpen,
  shortLand,
}: {
  store: OwnerStore;
  timeline: Timeline | null;
  showComment: boolean;
  showHarakat: boolean;
  commentOpen: boolean;
  shortLand: boolean;
}) {
  const noteText = useNoteSnapshot(store, timeline);
  const margin = !!noteText && stageFrame(window.innerWidth, window.innerHeight, true).marginNote;
  const floor = showComment && noteText && !margin && shortLand ? noteText : null;
  if (!floor) return null;
  return (
    <aside className={`comment${commentOpen ? ' is-open' : ''}`} aria-label="Пояснение">
      <button
        type="button"
        className="comment-head"
        onClick={() => setSettings({ commentOpen: !commentOpen })}
        aria-expanded={commentOpen}
      >
        <span className="comment-kicker">Пояснение</span>
        {!commentOpen && (
          <span className="comment-preview">
            {(showHarakat ? floor.text : stripHarakat(floor.text)).replace(/\*+/g, '').replace(/\s+/g, ' ').trim()}
          </span>
        )}
        <Icon name="chevron.down" size={16} className="comment-chevron" />
      </button>
      <div className="comment-fold">
        <RichText key={floor.from.idx} text={floor.text} showHarakat={showHarakat} className="comment-body" />
      </div>
    </aside>
  );
}

function MarginNote({
  store,
  timeline,
  showComment,
  showHarakat,
}: {
  store: OwnerStore;
  timeline: Timeline | null;
  showComment: boolean;
  showHarakat: boolean;
}) {
  const noteText = useNoteSnapshot(store, timeline);
  const margin = !!noteText && stageFrame(window.innerWidth, window.innerHeight, true).marginNote;
  if (!showComment || !noteText || !margin) return null;
  return (
    <aside className="comment is-margin lg-host lg-host--note" aria-label="Пояснение">
      <GlassLayers />
      <div className="comment-head">
        <span className="comment-kicker">Пояснение</span>
        <CloseDisc label="Закрыть пояснение" onClick={() => setSettings({ showComment: false })} />
      </div>
      <RichText key={noteText.from.idx} text={noteText.text} showHarakat={showHarakat} className="comment-body" />
    </aside>
  );
}

function ExplainButton({
  store,
  timeline,
  showComment,
  commentOpen,
  shortLand,
  onToggle,
  live,
}: {
  store: OwnerStore;
  timeline: Timeline | null;
  showComment: boolean;
  commentOpen: boolean;
  shortLand: boolean;
  onToggle: () => void;
  live: boolean;
}) {
  const noteText = useNoteSnapshot(store, timeline);
  return (
    <button
      className={`util util--mark${live ? ' is-live-task' : ''}${noteText && !showComment ? ' has-note' : ''}`}
      aria-label={noteText ? 'Пояснение к этой строке' : 'Пояснение'}
      aria-pressed={shortLand ? commentOpen : showComment}
      aria-keyshortcuts="C"
      data-tip="Пояснение · C"
      onClick={onToggle}
    >
      <Icon name="book.closed" size={24} />
      <span className="util-label">Пояснение</span>
    </button>
  );
}

function OwnedNote({
  View,
  store,
  open,
  onClose,
  timeline,
  showHarakat,
}: {
  View: LoadedSheets['Note'];
  store: OwnerStore;
  open: boolean;
  onClose: () => void;
  timeline: Timeline | null;
  showHarakat: boolean;
}) {
  const note = useNoteSnapshot(store, timeline);
  const last = useRef('');
  if (note?.text) last.current = note.text;
  return <View open={open} onClose={onClose} text={note?.text || last.current} showHarakat={showHarakat} />;
}

function OwnedText({
  View,
  store,
  open,
  onClose,
  timeline,
  settings,
  error,
  onRetry,
  onPick,
}: {
  View: LoadedSheets['Text'];
  store: OwnerStore;
  open: boolean;
  onClose: () => void;
  timeline: Timeline | null;
  settings: Settings;
  error: string | null;
  onRetry: () => void;
  onPick: (idx: number) => void;
}) {
  const owner = useOwner(store);
  return (
    <View
      open={open}
      onClose={onClose}
      timeline={timeline}
      owner={owner}
      settings={settings}
      error={error}
      onRetry={onRetry}
      onPick={onPick}
    />
  );
}

/** Fields that rebuild the page. Play, buffering and the error stay on the controls. */
function useEngineSlice(engine: AudioEngine | null) {
  const cache = useRef<{ key: string; slice: EngineState | null }>({ key: '\u0000', slice: null });
  const subscribe = useCallback((fn: () => void) => engine?.subscribe(fn) ?? (() => {}), [engine]);
  const get = useCallback(() => {
    const s = engine?.state;
    if (!s) {
      if (cache.current.key === '' ) return cache.current.slice;
      cache.current = { key: '', slice: null };
      return null;
    }
    // Play, errors and the source render their own controls. Duration is the
    // only field that rebuilds the timeline.
    const key = `${s.duration}`;
    if (key === cache.current.key) return cache.current.slice;
    cache.current = { key, slice: s };
    return s;
  }, [engine]);
  return useSyncExternalStore(subscribe, get, get);
}

function useEngineView(engine: AudioEngine, keyOf: (s: EngineState) => string) {
  const cache = useRef<{ key: string; state: EngineState }>({ key: '\u0000', state: engine.state });
  const subscribe = useCallback((fn: () => void) => engine.subscribe(fn), [engine]);
  const get = useCallback(() => {
    const key = keyOf(engine.state);
    if (key === cache.current.key) return cache.current.state;
    cache.current = { key, state: engine.state };
    return engine.state;
  }, [engine, keyOf]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The time label, ahead of the scrubber frame. A heavy seek must not leave 0:42 up for 100 ms. */
function paintClock(t: number) {
  const node = document.querySelector('.scrub-now');
  if (node) node.textContent = formatTime(Math.max(0, t));
}

function playKey(s: EngineState) {
  return `${s.playing ? 1 : 0}|${s.buffering ? 1 : 0}|${s.error ?? ''}`;
}

function alertKey(s: EngineState) {
  return `${s.error ?? ''}|${s.source}|${s.playing ? 1 : 0}|${s.localName ?? ''}`;
}

const PlayButton = function PlayButton({
  engine,
  playRef,
  onToggle,
}: {
  engine: AudioEngine;
  playRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}) {
  const state = useEngineView(engine, playKey);
  const playing = state.playing;
  const buffering = state.buffering;
  const playLabel = buffering ? (playing ? 'Буферизация' : 'Загрузка записи') : playing ? 'Пауза' : 'Воспроизвести';
  return (
    <button
      ref={playRef}
      className={`btn btn-circle btn-xl btn-ring${playing ? ' is-live' : ''}${buffering ? ' is-buffering' : ''}${state.error ? ' is-error' : ''}`}
      onClick={onToggle}
      aria-label={playLabel}
      aria-busy={buffering}
      data-tip="Пуск и пауза · Пробел"
    >
      {buffering && !playing ? <span className="btn-buffer" aria-hidden="true" /> : <PlayPause playing={playing} size={28} />}
    </button>
  );
};

function EngineAlerts({
  engine,
  floorRef,
  songHasAudio,
  onRetry,
  onOpenSettings,
}: {
  engine: AudioEngine;
  floorRef: RefObject<HTMLElement | null>;
  songHasAudio: boolean;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const state = useEngineView(engine, alertKey);
  useLayoutEffect(() => {
    const floor = floorRef.current;
    if (!floor) return;
    floor.classList.toggle('has-error', !!state.error);
    const root = floor.closest('.song');
    const top = root?.querySelector('.topbar');
    if (root instanceof HTMLElement && top instanceof HTMLElement) measureChrome(root, top, floor);
  }, [floorRef, state.error, state.source]);
  return (
    <>
      {state.error && (
        <div className="player-alert" role="alert">
          <p>{state.error}</p>
          <button type="button" className="floor-retry" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}
      {state.source === 'silent' && !state.playing && !songHasAudio && (
        <button type="button" className="hint" onClick={onOpenSettings}>
          Аудио не подключено
        </button>
      )}
    </>
  );
}

function LiveSettings({
  View,
  engine,
  open,
  onClose,
  song,
  settings,
  has,
}: {
  View: LoadedSheets['Settings'];
  engine: AudioEngine;
  open: boolean;
  onClose: () => void;
  song: Song;
  settings: Settings;
  has: { translit: boolean; alt: boolean; persian: boolean; arab: boolean };
}) {
  const state = useSyncExternalStore(
    useCallback((fn: () => void) => engine.subscribe(fn), [engine]),
    () => engine.state,
  );
  return <View open={open} onClose={onClose} song={song} engine={engine} state={state} settings={settings} has={has} />;
}

function measureChrome(root: HTMLElement, top: HTMLElement, floor: HTMLElement) {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const big = px >= 24;
  if (root.classList.contains('is-big-type') !== big) root.classList.toggle('is-big-type', big);
  root.style.setProperty('--chrome-top', `${top.offsetTop + top.offsetHeight + 10}px`);
  const rootBox = root.getBoundingClientRect();
  const floorBox = floor.getBoundingClientRect();
  // The card is positioned from the floor only, so measuring the floor cannot chase the card.
  root.style.setProperty('--floor-h', `${Math.max(0, rootBox.bottom - floorBox.top)}px`);
  let coverTop = floorBox.top;
  const card = root.querySelector('.note-card');
  if (card instanceof HTMLElement && getComputedStyle(card).display !== 'none') {
    const box = card.getBoundingClientRect();
    // A one-line footnote lives in the stage. Only a card sitting on the floor shortens it.
    if (box.height > 80 && box.top > floorBox.top - 80) coverTop = Math.min(coverTop, box.top);
  }
  const note = floor.querySelector('.comment');
  if (note) {
    const box = note.getBoundingClientRect();
    if (box.height > 8) coverTop = Math.min(coverTop, box.top);
  }
  root.style.setProperty('--player-h', `${Math.max(0, rootBox.bottom - coverTop)}px`);
  const banner = root.querySelector('.player-alert');
  const bannerH = banner instanceof HTMLElement ? Math.ceil(banner.getBoundingClientRect().height) + 8 : 0;
  root.style.setProperty('--banner-h', `${bannerH}px`);
}

/** Where to put the playhead on open. A `?t=` link wins over the saved point. */
function restorePlan(slug: string, duration: number, search: string): { seek: number; offer: number | null; playing: boolean } | null {
  const deep = parseFloat(new URLSearchParams(search).get('t') ?? '');
  if (Number.isFinite(deep)) return { seek: deep, offer: null, playing: false };
  const saved = usableResume(slug, duration);
  if (!saved) return null;
  return { seek: saved.t, offer: saved.t, playing: saved.playing };
}

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
  const songRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const artRef = useRef<HTMLImageElement>(null);
  const floorRef = useRef<HTMLElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const [lyrics, setLyrics] = useState<Lyrics | null>(() => peekLyrics(slug));
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [textAttempt, setTextAttempt] = useState(0);
  // Armed only after the restored seek, so a save cannot write 0 over a position we just read.
  // A ref, not state: arming the clock used to render the whole page again
  // while the cover was still in the air.
  const clockArmed = useRef(false);
  // Shown on the first paint when a point is already in localStorage. Init must not gate it.
  const [resumeAt, setResumeAt] = useState<number | null>(() => {
    if (!song || typeof location === 'undefined') return null;
    return restorePlan(song.slug, song.duration, location.search)?.offer ?? null;
  });

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
  const state = useEngineSlice(engine);

  useEffect(() => {
    if (!song) return;
    rememberSong(song.slug);
  }, [song]);

  useEffect(() => {
    if (!song) return;
    let alive = true;
    setLoadError(null);
    loadLyrics(song.slug)
      .then((l) => {
        if (!alive) return;
        // The same object the page already painted. A second render was a missed frame.
        setLyrics((prev) => (prev === l ? prev : l));
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
        // The next song's text is a large parse. Doing it in this frame kept the
        // first line off the stage past the 300 ms geometry sample.
        const next = nextSlug(song.slug);
        if (next) window.setTimeout(() => alive && prefetchLyrics(next), 1600);
      });
    });
    const s = settings;
    // The point is in localStorage. Seek before init: IndexedDB must not gate it.
    // The offer button was already set while rendering, from the same plan.
    const plan = restorePlan(song.slug, song.duration, location.search);
    if (plan) engine.seek(plan.seek);
    void engine
      .init({ quality: s.quality, rate: s.rate, volume: s.volume, normalize: s.normalize })
      .then(() => {
        if (!alive) return;
        if (s.eqEnabled) engine.setEffects(true, s.eqBands, s.eqPreamp);
        if (plan) {
          // The element may have ignored the early seek until it had a source.
          engine.seek(plan.seek);
          // A reload may block play() until the next tap. Stay paused on that second
          // and keep the button. Do not leave a failed play() looking like silence.
          if (plan.playing) {
            void engine.play().then(() => {
              if (alive && !engine.playing) setResumeAt(plan.seek);
            });
          }
        }
        if (alive) clockArmed.current = true;
      })
      .catch(() => {
        // init failed or the file store hung. The scene and the saved point stay.
        if (alive) clockArmed.current = true;
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

  const savePoint = useCallback(() => {
    if (!song || !engine) return;
    const dur = engine.state.duration || song.duration;
    let t = engine.currentTime();
    if (engine.state.error && t < 1) return;
    if (dur > 1 && t > dur - 1.5) t = 0;
    if (!Number.isFinite(t) || t < 0) return;
    writeResume(song.slug, { t, playing: engine.playing, savedAt: Date.now() });
  }, [song, engine]);

  // Registered after init: React runs this cleanup first, while the element still exists.
  useEffect(() => {
    if (!song || !engine) return;
    const save = () => {
      if (!clockArmed.current) return;
      savePoint();
    };
    engine.onTransport = save;
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    const id = window.setInterval(save, 2000);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      if (engine.onTransport === save) engine.onTransport = null;
      window.clearInterval(id);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [song, engine, savePoint]);

  // Peaks and the feature file wait out the opening second. Loading them in
  // the idle gap re-rendered the page while the cover was still in the air.
  useEffect(() => {
    if (!song || !lyrics) return;
    let alive = true;
    const ctrl = new AbortController();
    const run = () => {
      if (!alive) return;
      const names = lyrics.sections.flatMap((s) => (s.kind === 'instrumental' ? s.instruments : []));
      void import('@/instruments/catalog').then((m) => m.preloadInstruments(names));
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
    const idle = window.setTimeout(run, 1200);
    return () => {
      alive = false;
      ctrl.abort();
      clearTimeout(idle);
    };
  }, [song, lyrics]);

  useEffect(() => {
    if (!song || !engine) return;
    let once = false;
    const go = () => {
      if (once || !engine.state.canPlay) return;
      once = true;
      const next = nextSlug(song.slug);
      const following = next ? getSong(next) : undefined;
      if (following) prefetchRecording(recordingUrl(following, settings.quality));
    };
    go();
    const unsub = engine.subscribe(go);
    return () => {
      unsub();
    };
  }, [song, engine, settings.quality]);

  // A file attached on this device has no peaks.json: compute an envelope once.
  useEffect(() => {
    if (!song || !engine || song.audio.peaks) return;
    let once = false;
    const go = () => {
      if (once || engine.state.source !== 'local') return;
      once = true;
      void engine.computePeaks().then((p) => p && setPeaks(p));
    };
    go();
    const unsub = engine.subscribe(go);
    return () => {
      unsub();
    };
  }, [engine, song]);

  const duration = state?.duration || song?.duration || 0;
  const timeline = useMemo(() => (lyrics ? buildTimeline(lyrics, duration, peaks) : null), [lyrics, duration, peaks]);
  const deepLink = useMemo(() => {
    const deep = parseFloat(new URLSearchParams(window.location.search).get('t') ?? '');
    return Number.isFinite(deep) ? deep : null;
  }, []);
  // Until the engine has applied ?t=, paint that moment. Otherwise the first
  // phone frame is the intro and the geometry sample reads the wrong block.
  // The scrubber writes this while a finger or a coast is on the rail.
  // Seeking on every move would notify the engine; the scene just reads the ref.
  const scrubAt = useRef<number | null>(null);
  const clock = useCallback(() => {
    if (scrubAt.current != null) return scrubAt.current;
    if (deepLink != null && !clockArmed.current) return deepLink;
    return engine?.currentTime() ?? 0;
  }, [engine, deepLink]);
  const [scrubbing, setScrubbing] = useState(false);
  const onScrubPreview = useCallback((t: number | null) => {
    scrubAt.current = t;
    const on = t != null;
    songRef.current?.classList.toggle('is-scrubbing', on);
    // Edge only. A preview frame must not render the page again.
    setScrubbing((prev) => (prev === on ? prev : on));
  }, []);

  // The cue index lives outside this page. See createOwnerStore.
  const owners = useRef<OwnerStore>(null!);
  if (owners.current == null) owners.current = createOwnerStore();
  const ownerStore = owners.current;
  // A deep link (?t=) knows its line before the stage clock ticks. Placing the
  // note in that same commit keeps the first phone frame on the settled stage.
  useLayoutEffect(() => {
    if (!timeline) return;
    if (deepLink == null) return;
    const pos = flowPosition(planFlow(timeline), deepLink);
    const next = Math.max(-1, Math.min(timeline.cues.length - 1, Math.round(pos)));
    ownerStore.set(next);
  }, [timeline, deepLink, ownerStore]);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [help, setHelp] = useState(false);
  const sheets = useSheets();
  const settingsHeld = useHeld(sheet === 'settings');
  const infoHeld = useHeld(sheet === 'info');
  const textHeld = useHeld(sheet === 'text');
  const noteHeld = useHeld(sheet === 'note');
  const shortLand = useShortLandscape();
  const toggleComment = useCallback(() => {
    const note = noteAt(timeline, ownerStore.get());
    // Landscape keeps a single icon. It opens the drawer; it does not add a second pill.
    if (shortLand && note) setSettings({ showComment: true, commentOpen: !settings.commentOpen });
    else setSettings({ showComment: !settings.showComment });
  }, [timeline, ownerStore, shortLand, settings.commentOpen, settings.showComment]);
  useEffect(() => {
    if (!engine) return;
    const unsub = engine.subscribe(() => {
      if (engine.state.playing) setResumeAt(null);
    });
    return () => {
      unsub();
    };
  }, [engine]);

  const seekToCue = useCallback(
    (c: Cue) => {
      if (!engine) return;
      // Land inside the cue. A lead before the start still belongs to the previous
      // line, so the drawn row would not move.
      engine.seek(Math.max(0, c.kind === 'line' ? c.start + 0.05 : c.start));
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
    if (!timeline || !engine || !settings.pauseAfterLine) return;
    let raf = 0;
    const loop = () => {
      raf = 0;
      if (!engine.state.playing) return;
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
    const unsub = engine.subscribe(() => {
      if (engine.state.playing && !raf) raf = requestAnimationFrame(loop);
    });
    if (engine.state.playing) raf = requestAnimationFrame(loop);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [timeline, engine, settings.pauseAfterLine]);

  const togglePlay = useCallback(() => engine?.toggle(), [engine]);
  const openSheet = useCallback(
    (name: SheetName, tab?: HTMLElement) => {
      if (shortLand && settings.commentOpen) setSettings({ commentOpen: false });
      // The note stays mounted and hides in the same commit as the sheet.
      // Unmounting first collapsed --player-h and the lyrics jumped.
      // The sky stops with the rows. Stopping it on the tap repainted the
      // stage into the shell's cast frame and that frame arrived later.
      document.getElementById('ll-sheet-off')?.remove();
      window.setTimeout(() => {
        if (!document.querySelector('.sheet')) return;
        coverStage();
      }, SHEET_SHELL_MS);
      if (!tab) {
        setSheet(name);
        return;
      }
      // The tab and the sheet commit in this same turn. Waiting one frame for the
      // sheet left WebKit's next delivered frame more than 100 ms later, so the
      // bottom edge was late even though the glass was already parked.
      tab.classList.add('is-live-task');
      setSheet(name);
    },
    [shortLand, settings.commentOpen],
  );

  // The sheet scales the song. A layer from the tap keeps that scale on the
  // compositor; restyling the tree each frame dropped the entrance.
  useEffect(() => {
    const root = songRef.current;
    if (!root) return;
    root.style.willChange = sheet ? 'transform' : '';
  }, [sheet]);

  // A mismatch mark records the clock and the line on stage. It does not pause, seek, or open a sheet.
  const [toast, setToast] = useState<{ id: string; t: number } | null>(null);
  const placeMark = useCallback(() => {
    if (!song || !timeline || !engine) return;
    const mark = marksFor(song.slug).add(momentAt(timeline.cues, ownerStore.get(), engine.currentTime()));
    setToast({ id: mark.id, t: mark.t });
  }, [song, timeline, engine, ownerStore]);
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

  // Space and K play, J/L and Shift+arrows ±10 s, arrows change line, Home and 0
  // restart, 1–9 jump by tenths. T translation, C commentary, M a mismatch mark.
  // Physical codes, so йцукен hits the same keys. A focused button keeps Space.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(e, help || sheet != null);
      if (!action) return;
      if (action.type === 'escape') {
        e.preventDefault();
        if (help) {
          setHelp(false);
          e.stopImmediatePropagation();
          return;
        }
        if (sheet) {
          // The sheet springs shut and React may rebuild the node in this same
          // turn. A style rule outlives that node, so the drawn frame is gone now.
          let tag = document.getElementById('ll-sheet-off');
          if (!tag) {
            tag = document.createElement('style');
            tag.id = 'll-sheet-off';
            tag.textContent = '.sheet-root{display:none!important}';
            document.head.appendChild(tag);
          }
          setSheet(null);
          e.stopImmediatePropagation();
          return;
        }
        const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
        if (document.fullscreenElement || doc.webkitFullscreenElement) {
          e.stopImmediatePropagation();
          void document.exitFullscreen?.().catch(() => {});
          doc.webkitExitFullscreen?.();
        }
        return;
      }
      e.preventDefault();
      if (action.type === 'play') togglePlay();
      else if (action.type === 'skip') {
        const t = Math.max(0, (engine?.currentTime() ?? 0) + action.by);
        paintClock(t);
        engine?.skip(action.by);
      } else if (action.type === 'start') {
        paintClock(0);
        engine?.seek(0);
      } else if (action.type === 'fraction') {
        const d = engine?.state.duration || 0;
        if (d > 0) {
          paintClock((d * action.n) / 10);
          engine?.seek((d * action.n) / 10);
        }
      } else if (action.type === 'line') nav(action.dir);
      else if (action.type === 'translation') setSettings({ showTranslation: !settings.showTranslation });
      else if (action.type === 'comment') toggleComment();
      else if (action.type === 'mark') placeMark();
      else if (action.type === 'help') setHelp(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [help, sheet, togglePlay, nav, engine, settings.showTranslation, toggleComment, placeMark]);

  // One notch over the stage is one line. The scrubber has its own wheel.
  useEffect(() => {
    const stage = songRef.current?.querySelector('.scene');
    if (!(stage instanceof HTMLElement)) return;
    let locked = 0;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const size = Math.abs(event.deltaY);
      const big = event.deltaMode === 1 || size >= 50;
      if (!big && size < 8) return;
      const now = performance.now();
      if (now < locked) {
        event.preventDefault();
        return;
      }
      locked = now + (big ? 450 : 280);
      event.preventDefault();
      nav(event.deltaY > 0 ? 1 : -1);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [nav, timeline]);

  const back = useHold(
    () => nav(-1),
    () => engine?.skip(-5),
  );
  const fwd = useHold(
    () => nav(1),
    () => engine?.skip(5),
  );

  // The stage starts under the header and stops at the floor. Both wrap, so their height is measured.
  useEffect(() => {
    const top = topbarRef.current;
    const floor = floorRef.current;
    const root = top?.closest('.song');
    if (!(root instanceof HTMLElement) || !top || !floor) return;
    const apply = () => measureChrome(root, top, floor);
    const ro = new ResizeObserver(apply);
    ro.observe(top);
    ro.observe(floor);
    const card = root.querySelector('.note-card');
    if (card instanceof HTMLElement) ro.observe(card);
    window.addEventListener('resize', apply);
    apply();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [song, lyrics, shortLand, settings.showComment]);

  useLayoutEffect(() => {
    const root = songRef.current;
    const img = artRef.current;
    // No route fade: the song is opaque from the first frame. Only the header art waits for the flyer.
    if (!root || !img || !hasFlight() || motionBlocked()) return;
    // The song itself stays opaque. Only the header art hides until the flyer overlaps it.
    root.classList.add('is-arriving', 'is-flying');
    // Inline, so the reduced-motion rule that restores the thumbnail cannot win early.
    img.style.opacity = '0';
    // The radius does not change during the flight. Reading it every frame
    // forced a style pass on top of the scene.
    let radius = 0;
    let radiusReady = false;
    // One box for the whole rise. Reading the header on every flight frame
    // forced a layout of the page the cover was crossing.
    let cached: { left: number; top: number; width: number; height: number; radius: number } | null = null;
    const dest = () => {
      if (cached) return cached;
      const art = img.getBoundingClientRect();
      if (art.width < 1 || art.height < 1) return null;
      if (!radiusReady) {
        const raw = getComputedStyle(img).borderTopLeftRadius;
        radius = parseFloat(raw) || 0;
        if (raw.trim().endsWith('%')) radius = (radius / 100) * Math.min(art.width, art.height);
        radiusReady = true;
      }
      cached = { left: art.left, top: art.top, width: art.width, height: art.height, radius };
      return cached;
    };
    const reveal = () => {
      img.style.opacity = '';
      root.classList.remove('is-flying');
    };
    const stopFollow = followHeader(dest, reveal);
    const stopRise = playRise(root, () => root.classList.remove('is-arriving'));
    return () => {
      stopFollow();
      stopRise();
      img.style.opacity = '';
      root.classList.remove('is-arriving', 'is-flying');
    };
  }, [song?.slug]);

  useEffect(() => {
    const el = playRef.current;
    if (!el || motionBlocked()) return;
    return bindPress(el);
  }, [song?.slug]);

  if (!song || !engine) return <NotFound />;

  const poets = song.poets?.map((p) => p.name).join(' · ');
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
      ref={songRef}
      className="song"
      style={{ background: dark ? '#07060c' : (song.palette.field[2] ?? song.palette.field[0]) }}
    >
      <Field colors={song.palette.field} dark={dark} clock={timeline ? clock : undefined} t={0} still={!timeline} />
      {leaving && (
        <div className="sky-leave" aria-hidden>
          <Field colors={leaving} dark={dark} t={0} still />
        </div>
      )}
      <StageVars songRef={songRef} store={ownerStore} timeline={timeline} showComment={settings.showComment} />
      {timeline ? (
        <SceneBoundary
          onCrash={(error) => {
            if (clockArmed.current) savePoint();
            recordLastError(error, song.slug);
          }}
        >
          <Scene song={song} timeline={timeline} settings={settings} features={features} clock={clock} onOwnerChange={ownerStore.set} onPick={pick} />
        </SceneBoundary>
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

      <header className="topbar lg-host" ref={topbarRef}>
        <GlassLayers />
        <a className="btn btn-circle btn-plain" href="/" onClick={linkHandler('/')} aria-label="К списку песен" data-tip="К списку песен">
          <Icon name="chevron.left" size={22} />
        </a>
        <img
          ref={artRef}
          className="now-art"
          alt=""
          width={96}
          height={96}
          src={coverUrl(song.slug, 192, coverExt(song))}
        />
        <div className="topbar-title">
          <div className="topbar-song">{song.title}</div>
          <div className="topbar-sub">
            <div className="topbar-version">{song.version.label}</div>
            <div className="topbar-who">
              {song.artist}
              <PartExtra song={song} timeline={timeline} store={ownerStore} />
            </div>
          </div>
        </div>
        <button className="btn btn-circle btn-plain" onClick={() => openSheet('info')} aria-label="О песне" data-tip="О песне">
          <Icon name="info.circle" size={22} />
        </button>
      </header>

      <PortraitNote
        songRef={songRef}
        topRef={topbarRef}
        floorRef={floorRef}
        store={ownerStore}
        timeline={timeline}
        showComment={settings.showComment}
        showHarakat={settings.showHarakat}
        shortLand={shortLand}
        sheet={sheet != null}
        scrubbing={scrubbing}
        onOpen={() => openSheet('note')}
      />

      <EngineAlerts
        engine={engine}
        floorRef={floorRef}
        songHasAudio={!!(song.audio.high || song.audio.saver)}
        onRetry={() => engine.retry()}
        onOpenSettings={() => openSheet('settings')}
      />

      <footer className="player floor lg-host lg-host--floor" ref={floorRef}>
        <GlassLayers />
        <FloorNote
          store={ownerStore}
          timeline={timeline}
          showComment={settings.showComment}
          showHarakat={settings.showHarakat}
          commentOpen={settings.commentOpen}
          shortLand={shortLand}
        />
        {toast && (
          <div className="mark-toast" role="status">
            <span>Отмечено {formatTime(toast.t)}</span>
            <button type="button" className="mark-toast-undo" onClick={undoToast}>
              Отменить
            </button>
          </div>
        )}
        {timeline ? (
          <Scrubber
            timeline={timeline}
            duration={duration}
            clock={clock}
            onSeek={(t) => engine.seek(t)}
            onPreview={onScrubPreview}
            colors={song.palette.field}
            accessory={
              <div className="mark-bar">
                <button
                  type="button"
                  className="mark-btn"
                  onClick={placeMark}
                  aria-label="Не совпадает"
                  aria-keyshortcuts="M"
                  data-tip="Не совпадает · M"
                >
                  <Icon name="flag" size={20} />
                </button>
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
        {resumeAt != null && (
          <button
            type="button"
            className="resume-offer"
            onClick={() => {
              setResumeAt(null);
              void engine.play();
            }}
          >
            Продолжить с {formatTime(resumeAt)}
          </button>
        )}
        <div className="player-row">
          <div className="transport">
            <button className="btn btn-plain btn-lg-hit" {...back} aria-label="Предыдущая строка (удерживайте — перемотка назад)" data-tip="Предыдущая строка · ←">
              <Icon name="backward" size={28} />
            </button>
            <PlayButton engine={engine} playRef={playRef} onToggle={togglePlay} />
            <button className="btn btn-plain btn-lg-hit" {...fwd} aria-label="Следующая строка (удерживайте — перемотка вперёд)" data-tip="Следующая строка · →">
              <Icon name="forward" size={28} />
            </button>
          </div>
          <div className="utility" role="group" aria-label="Действия с песней">
            <button className="util util--mark" aria-label="Перевод" aria-pressed={settings.showTranslation} aria-keyshortcuts="T" data-tip="Перевод · T" onClick={() => setSettings({ showTranslation: !settings.showTranslation })}>
              <Icon name="character.bubble" size={24} />
              <span className="util-label">Перевод</span>
            </button>
            <ExplainButton
              store={ownerStore}
              timeline={timeline}
              showComment={settings.showComment}
              commentOpen={settings.commentOpen}
              shortLand={shortLand}
              onToggle={toggleComment}
              live={sheet === 'note'}
            />
            <button className={`util${sheet === 'text' ? ' is-live-task' : ''}`} aria-label="Весь текст" aria-pressed={sheet === 'text'} data-tip="Весь текст" onClick={(e) => openSheet('text', e.currentTarget)}>
              <Icon name="list.bullet" size={24} />
              <span className="util-label">Весь текст</span>
            </button>
            <button
              className={`util${sheet === 'settings' ? ' is-live-task' : ''}`}
              aria-label="Настройки"
              aria-pressed={sheet === 'settings'}
              data-tip="Настройки"
              onPointerDown={(e) => {
                // The press, not the click that follows it. A frame can be
                // committed between the two, and on WebKit that frame was the
                // one that arrived inside 100 ms — without the sheet.
                if (e.button !== 0) return;
                openSheet('settings', e.currentTarget);
              }}
              onClick={(e) => openSheet('settings', e.currentTarget)}
            >
              <Icon name="slider.horizontal.3" size={24} />
              <span className="util-label">Настройки</span>
            </button>
          </div>
        </div>
      </footer>

      <MarginNote
        store={ownerStore}
        timeline={timeline}
        showComment={settings.showComment}
        showHarakat={settings.showHarakat}
      />

      <Suspense fallback={null}>
        {sheets && settingsHeld && (
          <LiveSettings View={sheets.Settings} engine={engine} open={sheet === 'settings'} onClose={() => setSheet(null)} song={song} settings={settings} has={has} />
        )}
        {sheets && infoHeld && (
          <sheets.Info
            open={sheet === 'info'}
            onClose={() => setSheet(null)}
            song={song}
            lyrics={lyrics}
            showHarakat={settings.showHarakat}
            fontPersian={settings.fontPersian}
            pendingNote={!lyrics ? (loadError ?? 'Подробности строк ещё открываются') : null}
            onMark={placeMark}
            onSeek={(t) => {
              engine.seek(t);
              setSheet(null);
            }}
          />
        )}
        {sheets && noteHeld && (
          <OwnedNote
            View={sheets.Note}
            store={ownerStore}
            open={sheet === 'note'}
            onClose={() => setSheet(null)}
            timeline={timeline}
            showHarakat={settings.showHarakat}
          />
        )}
        {sheets && textHeld && (
          <OwnedText
            View={sheets.Text}
            store={ownerStore}
            open={sheet === 'text'}
            onClose={() => setSheet(null)}
            timeline={timeline}
            settings={settings}
            error={loadError}
            onRetry={() => setTextAttempt((n) => n + 1)}
            onPick={(idx) => {
              setSheet(null);
              pick(idx);
            }}
          />
        )}
      </Suspense>
      <KeysHelp open={help} onClose={() => setHelp(false)} />
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
