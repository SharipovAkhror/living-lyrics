import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { formatTime, getSong, loadLyrics, loadPeaks } from '@/data/library';
import { coverExt, coverUrl } from '@/data/covers';
import { rememberSong } from '@/app/continue';
import { marksFor, momentAt } from '@/app/marks';
import type { Lyrics, Peaks } from '@/data/schema';
import { buildTimeline, commentFor, type Cue } from '@/data/timeline';
import { useSettings, setSettings } from '@/app/settings';
import { useSongAccent } from '@/app/theme';
import { enableSongFonts } from '@/app/fontCatalog';
import { nextSlug, prefetchLyrics, prefetchRecording, recordingUrl } from '@/app/prefetch';
import { linkHandler } from '@/app/router';
import { followHeader, hasFlight, motionBlocked, playRise } from '@/app/morph';
import { bindPress } from '@/ui/press';
import { PlayPause } from '@/ui/playglyph';
import { GlassLayers } from '@/ui/glass/Glass';
import { AudioEngine } from '@/player/engine';
import { preloadMode, readNetHint } from '@/player/preload';
import { RESUME_AUTO_MS, readResume, writeResume } from '@/player/resume';
import { Scrubber } from '@/player/Scrubber';
import { Scene } from '@/scene/Scene';
import { coverStage } from '@/scene/cover';
import { Field } from '@/scene/Field';
import { LEAD, flowPosition, planFlow } from '@/scene/flow';
import { Icon } from '@/ui/icons';
import { RichText } from '@/components/RichText';
import { Status } from '@/components/Status';
import { showHarakatText, stripHarakat } from '@/data/harakat';
import { stageFrame, type StageFrame } from '@/scene/columns';
import { parseAudioFeatures, type AudioFeatures } from '@/instruments/animation';
import { headerLine } from './parts';

const SettingsSheet = lazy(() => import('./SettingsSheet').then((m) => ({ default: m.SettingsSheet })));
const TextSheet = lazy(() => import('./TextSheet').then((m) => ({ default: m.TextSheet })));
const InfoSheet = lazy(() => import('./InfoSheet').then((m) => ({ default: m.InfoSheet })));

/** Keep a sheet mounted after its first open so the close spring can finish. */
function useHeld(open: boolean) {
  const [held, setHeld] = useState(open);
  if (open && !held) setHeld(true);
  return held;
}

type SheetName = 'settings' | 'text' | 'info' | null;

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

/** Portrait note. Not a dialog: the settings test takes the first one, and the grabber class is theirs. */
function NoteCard({
  text,
  textKey,
  showHarakat,
  onClose,
}: {
  text: string;
  textKey: number;
  showHarakat: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; id: number } | null>(null);
  const move = (clientY: number) => {
    const card = ref.current;
    const d = drag.current;
    if (!card || !d) return;
    const dy = Math.max(0, clientY - d.y);
    card.style.transform = dy > 0 ? `translate3d(0, ${dy.toFixed(1)}px, 0)` : '';
  };
  return (
    <aside
      ref={ref}
      className="note-card"
      role="region"
      aria-label="Пояснение"
      onPointerDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest('button, a, .comment-body')) return;
        drag.current = { y: e.clientY, id: e.pointerId };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current || e.pointerId !== drag.current.id) return;
        move(e.clientY);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.id) return;
        drag.current = null;
        if (e.clientY - d.y > 48) onClose();
        else if (ref.current) ref.current.style.transform = '';
      }}
      onPointerCancel={() => {
        drag.current = null;
        if (ref.current) ref.current.style.transform = '';
      }}
    >
      <div className="note-grab" aria-hidden="true" />
      <div className="note-card-head">
        <span className="comment-kicker">Пояснение</span>
        <button type="button" className="btn btn-circle btn-plain" style={{ marginInlineStart: 'auto' }} aria-label="Закрыть пояснение" onClick={onClose}>
          <Icon name="xmark" size={20} />
        </button>
      </div>
      <RichText key={textKey} text={text} showHarakat={showHarakat} className="comment-body" />
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
    const apply = () => setBox(read());
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [noteOpen]);
  return box;
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
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [textAttempt, setTextAttempt] = useState(0);
  // Armed only after the restored seek, so a save cannot write 0 over a position we just read.
  const [clockArmed, setClockArmed] = useState(false);
  // Set when a reload restored a playing point and the browser refused play().
  const [resumeAt, setResumeAt] = useState<number | null>(null);

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
    rememberSong(song.slug);
  }, [song]);

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
        // The next song's text is a large parse. Doing it in this frame kept the
        // first line off the stage past the 300 ms geometry sample.
        const next = nextSlug(song.slug);
        if (next) window.setTimeout(() => alive && prefetchLyrics(next), 1600);
      });
    });
    const s = settings;
    void engine.init({ quality: s.quality, rate: s.rate, volume: s.volume, normalize: s.normalize }).then(() => {
      if (!alive) return;
      if (s.eqEnabled) engine.setEffects(true, s.eqBands, s.eqPreamp);
      // Deep link to a moment: /song/<slug>?t=95. It wins over the saved position.
      const deep = parseFloat(new URLSearchParams(location.search).get('t') ?? '');
      if (Number.isFinite(deep)) {
        engine.seek(deep);
      } else {
        const saved = readResume(song.slug);
        const fresh = saved != null && Date.now() - saved.savedAt <= RESUME_AUTO_MS;
        if (saved && fresh && saved.t >= 1) {
          engine.seek(saved.t);
          // A reload may block play() until the next tap. Stay paused on that second
          // and offer the button. Do not leave a failed play() looking like silence.
          if (saved.playing) {
            void engine.play().then(() => {
              if (alive && !engine.playing) setResumeAt(saved.t);
            });
          }
        }
      }
      if (alive) setClockArmed(true);
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

  // Registered after init: React runs this cleanup first, while the element still exists.
  useEffect(() => {
    if (!song || !engine || !clockArmed) return;
    const save = () => {
      const dur = engine.state.duration || song.duration;
      let t = engine.currentTime();
      if (engine.state.error && t < 1) return;
      if (dur > 1 && t > dur - 1.5) t = 0;
      writeResume(song.slug, { t, playing: engine.playing, savedAt: Date.now() });
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    const id = window.setInterval(save, 2000);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [song, engine, clockArmed]);

  // Peaks, engravings and the feature file are not on the first frame. They wait until the text is up and the browser is idle.
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
  const deepLink = useMemo(() => {
    const deep = parseFloat(new URLSearchParams(window.location.search).get('t') ?? '');
    return Number.isFinite(deep) ? deep : null;
  }, []);
  // Until the engine has applied ?t=, paint that moment. Otherwise the first
  // phone frame is the intro and the geometry sample reads the wrong block.
  const clock = useCallback(() => {
    if (deepLink != null && !clockArmed) return deepLink;
    return engine?.currentTime() ?? 0;
  }, [engine, deepLink, clockArmed]);

  const [owner, setOwner] = useState(-1);
  // A deep link (?t=) knows its line before the stage clock ticks. Placing the
  // note in that same commit keeps the first phone frame on the settled stage.
  useLayoutEffect(() => {
    if (!timeline) return;
    if (deepLink == null) return;
    const pos = flowPosition(planFlow(timeline), deepLink);
    const next = Math.max(-1, Math.min(timeline.cues.length - 1, Math.round(pos)));
    setOwner((prev) => (prev === next ? prev : next));
  }, [timeline, deepLink]);
  const [sheet, setSheet] = useState<SheetName>(null);
  const settingsHeld = useHeld(sheet === 'settings');
  const infoHeld = useHeld(sheet === 'info');
  const textHeld = useHeld(sheet === 'text');
  const playing = !!state?.playing;
  const noteText = timeline && owner >= 0 ? commentFor(timeline, owner) : null;
  const shortLand = useShortLandscape();
  const toggleComment = useCallback(() => {
    // Landscape keeps a single icon. It opens the drawer; it does not add a second pill.
    if (shortLand && noteText) setSettings({ showComment: true, commentOpen: !settings.commentOpen });
    else setSettings({ showComment: !settings.showComment });
  }, [shortLand, noteText, settings.commentOpen, settings.showComment]);
  const columns = useStageFrame(settings.showComment && !!noteText);
  // Landscape keeps the drawer inside the player. Portrait and the tablet get a card above the floor.
  const floorNote = noteText && settings.showComment && !columns.frame.marginNote && shortLand ? noteText : null;
  const portraitNote = noteText && settings.showComment && !columns.frame.marginNote && !shortLand ? noteText : null;
  useEffect(() => {
    if (playing) setResumeAt(null);
  }, [playing]);

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
  const openSheet = useCallback((name: SheetName) => {
    coverStage();
    setSheet(name);
  }, []);

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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Keys wait until a sheet is gone, so a letter does not also hit a focused control underneath.
      if (sheet) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
        if (e.code === 'Space') return; // let the focused control handle it
      }
      if (e.code === 'Space') togglePlay();
      else if (e.key === 'ArrowRight') (e.shiftKey ? engine?.skip(10) : nav(1));
      else if (e.key === 'ArrowLeft') (e.shiftKey ? engine?.skip(-10) : nav(-1));
      else if (e.key === 't' || e.key === 'е') setSettings({ showTranslation: !settings.showTranslation });
      else if (e.key === 'k' || e.key === 'л') toggleComment();
      else if (e.code === 'KeyM') {
        if (!e.repeat) placeMark();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, togglePlay, nav, engine, settings.showTranslation, toggleComment, placeMark]);

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
    const apply = () => {
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
        if (box.height > 8) coverTop = Math.min(coverTop, box.top);
      }
      const note = floor.querySelector('.comment');
      if (note) {
        const box = note.getBoundingClientRect();
        if (box.height > 8) coverTop = Math.min(coverTop, box.top);
      }
      root.style.setProperty('--player-h', `${Math.max(0, rootBox.bottom - coverTop)}px`);
      const banner = root.querySelector('.player-alert');
      const bannerH = banner instanceof HTMLElement ? Math.ceil(banner.getBoundingClientRect().height) + 14 : 0;
      root.style.setProperty('--banner-h', `${bannerH}px`);
    };
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
  }, [song, lyrics, state?.error, state?.source, columns.frame, shortLand, settings.showComment, portraitNote?.text]);

  useLayoutEffect(() => {
    const root = songRef.current;
    const img = artRef.current;
    // No route fade: the song is opaque from the first frame. Only the header art waits for the flyer.
    if (!root || !img || !hasFlight() || motionBlocked()) return;
    // The song itself stays opaque. Only the header art hides until the flyer overlaps it.
    root.classList.add('is-arriving', 'is-flying');
    const dest = () => {
      const art = img.getBoundingClientRect();
      if (art.width < 1 || art.height < 1) return null;
      const raw = getComputedStyle(img).borderTopLeftRadius;
      let radius = parseFloat(raw) || 0;
      if (raw.trim().endsWith('%')) radius = (radius / 100) * Math.min(art.width, art.height);
      return { left: art.left, top: art.top, width: art.width, height: art.height, radius };
    };
    const stopFollow = followHeader(dest, () => root.classList.remove('is-flying'));
    const stopRise = playRise(root, () => root.classList.remove('is-arriving'));
    const guard = window.setTimeout(() => root.classList.remove('is-flying', 'is-arriving'), 1600);
    return () => {
      stopFollow();
      stopRise();
      window.clearTimeout(guard);
      root.classList.remove('is-arriving', 'is-flying');
    };
  }, [song?.slug]);

  useEffect(() => {
    const el = playRef.current;
    if (!el || motionBlocked()) return;
    return bindPress(el);
  }, [song?.slug]);

  useLayoutEffect(() => {
    const root = songRef.current;
    if (!root) return;
    const f = columns.frame;
    root.style.setProperty('--col-left', `${f.colLeft}px`);
    root.style.setProperty('--col-right', `${f.colRight}px`);
    root.style.setProperty('--stage-w', `${f.stageW}px`);
    root.style.setProperty('--note-w', `${f.noteW}px`);
    root.style.setProperty('--lyric-w', `${f.lyricW}px`);
    root.style.setProperty('--note-inset', `${f.panelInset}px`);
  }, [columns.frame]);

  if (!song || !engine) return <NotFound />;

  const poets = song.poets?.map((p) => p.name).join(' · ');
  const buffering = !!state?.buffering;
  const playLabel = buffering ? (playing ? 'Буферизация' : 'Загрузка записи') : playing ? 'Пауза' : 'Воспроизвести';
  const ownerCue = timeline && owner >= 0 ? timeline.cues[owner] : null;
  const partLabel = headerLine(song, ownerCue);
  const partExtra = partLabel && partLabel !== song.artist && partLabel !== song.version.label ? partLabel : '';
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
      className={`song${columns.frame.marginNote ? ' has-margin' : ''}`}
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

      <header className="topbar lg-host lg-host--bar" ref={topbarRef}>
        <GlassLayers />
        <a className="btn btn-circle btn-plain" href="/" onClick={linkHandler('/')} aria-label="К списку песен">
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
              {partExtra ? <span className="topbar-part"> · {partExtra}</span> : null}
            </div>
          </div>
        </div>
        <button className="btn btn-circle btn-plain" onClick={() => openSheet('info')} aria-label="О песне">
          <Icon name="info.circle" size={22} />
        </button>
      </header>

      {portraitNote && (
        <NoteCard
          text={portraitNote.text}
          textKey={portraitNote.from.idx}
          showHarakat={settings.showHarakat}
          onClose={() => setSettings({ showComment: false })}
        />
      )}

      {state?.error && (
        <div className="player-alert" role="alert">
          <p>{state.error}</p>
          <button type="button" className="floor-retry" onClick={() => engine.retry()}>
            Повторить
          </button>
        </div>
      )}
      {state?.source === 'silent' && !playing && !song.audio.high && !song.audio.saver && (
        <button type="button" className="hint" onClick={() => setSheet('settings')}>
          Аудио не подключено
        </button>
      )}

      <footer className={`player floor lg-host lg-host--floor${state?.error ? ' has-error' : ''}`} ref={floorRef}>
        <GlassLayers />
        {floorNote && (
          <aside className={`comment${settings.commentOpen ? ' is-open' : ''}`} aria-label="Пояснение">
            <button
              type="button"
              className="comment-head"
              onClick={() => setSettings({ commentOpen: !settings.commentOpen })}
              aria-expanded={settings.commentOpen}
            >
              <span className="comment-kicker">Пояснение</span>
              {!settings.commentOpen && (
                <span className="comment-preview">
                  {(settings.showHarakat ? floorNote.text : stripHarakat(floorNote.text)).replace(/\*+/g, '').replace(/\s+/g, ' ').trim()}
                </span>
              )}
              <Icon name="chevron.down" size={16} className="comment-chevron" />
            </button>
            <div className="comment-fold">
              <RichText key={floorNote.from.idx} text={floorNote.text} showHarakat={settings.showHarakat} className="comment-body" />
            </div>
          </aside>
        )}
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
            colors={song.palette.field}
            accessory={
              <div className="mark-bar">
                <button
                  type="button"
                  className="mark-btn"
                  onClick={placeMark}
                  aria-label="Не совпадает"
                  title="Не совпадает"
                  aria-keyshortcuts="M"
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
        {resumeAt != null && !playing && (
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
            <button className="btn btn-plain btn-lg-hit" {...back} aria-label="Предыдущая строка (удерживайте — перемотка назад)">
              <Icon name="backward" size={24} />
            </button>
            <button
              ref={playRef}
              className={`btn btn-circle btn-xl btn-ring${playing ? ' is-live' : ''}${buffering ? ' is-buffering' : ''}${state?.error ? ' is-error' : ''}`}
              onClick={togglePlay}
              aria-label={playLabel}
              aria-busy={buffering}
            >
              {buffering && !playing ? (
                <span className="btn-buffer" aria-hidden="true" />
              ) : (
                <span className="play-glyph">
                  <PlayPause playing={playing} size={28} />
                </span>
              )}
            </button>
            <button className="btn btn-plain btn-lg-hit" {...fwd} aria-label="Следующая строка (удерживайте — перемотка вперёд)">
              <Icon name="forward" size={24} />
            </button>
          </div>
          <div className="utility" role="group" aria-label="Действия с песней">
            <button className="util" aria-label="Перевод" aria-pressed={settings.showTranslation} onClick={() => setSettings({ showTranslation: !settings.showTranslation })}>
              <Icon name="character.bubble" size={20} />
              <span className="util-label">Перевод</span>
            </button>
            <button
              className={`util${noteText && !settings.showComment ? ' has-note' : ''}`}
              aria-label={noteText ? 'Пояснение к этой строке' : 'Пояснение'}
              aria-pressed={shortLand ? settings.commentOpen : settings.showComment}
              aria-keyshortcuts="K"
              onClick={toggleComment}
            >
              <Icon name="book.closed" size={20} />
              <span className="util-label">Пояснение</span>
            </button>
            <button className="util" aria-label="Весь текст" aria-pressed={sheet === 'text'} onClick={() => openSheet('text')}>
              <Icon name="list.bullet" size={20} />
              <span className="util-label">Весь текст</span>
            </button>
            <button className="util" aria-label="Настройки" aria-pressed={sheet === 'settings'} onClick={() => openSheet('settings')}>
              <Icon name="slider.horizontal.3" size={20} />
              <span className="util-label">Настройки</span>
            </button>
          </div>
        </div>
      </footer>

      {columns.frame.marginNote && noteText && (
        <aside className="comment is-margin lg-host lg-host--note" aria-label="Пояснение">
          <GlassLayers />
          <div className="comment-head">
            <span className="comment-kicker">Пояснение</span>
            <button type="button" className="comment-close" aria-label="Закрыть пояснение" onClick={() => setSettings({ showComment: false })}>
              <Icon name="xmark" size={20} />
            </button>
          </div>
          <RichText key={noteText.from.idx} text={noteText.text} showHarakat={settings.showHarakat} className="comment-body" />
        </aside>
      )}

      <Suspense fallback={null}>
        {settingsHeld && (
          <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} song={song} engine={engine} state={state} settings={settings} has={has} />
        )}
        {infoHeld && (
          <InfoSheet
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
        {textHeld && (
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
        )}
      </Suspense>
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
