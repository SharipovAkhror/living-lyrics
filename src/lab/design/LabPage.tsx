/**
 * T5 design lab. Three directions at /lab/design/a|b|c. Nothing here is mounted on the library or the song page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSong, loadLyrics, songs } from '@/data/library';
import { buildTimeline, lineText, type Timeline } from '@/data/timeline';
import { useSettings } from '@/app/settings';
import { useAppliedTheme, useSongAccent } from '@/app/theme';
import { preloadInstruments } from '@/instruments/catalog';
import { Manuscript } from './Manuscript';
import { Cosmos } from './Cosmos';
import { InstrumentView } from './Instrument';
import {
  LabProvider,
  momentFor,
  readLabQuery,
  type DirId,
  type LabApi,
  type LabView,
  type Mark,
  type Moment,
  type Panel,
} from './shared';
import './lab.css';

export function LabPage({ dir }: { dir: DirId }) {
  const settings = useSettings();
  const dark = useAppliedTheme(settings.theme);
  const initial = useMemo(() => readLabQuery(), []);
  const [view, setView] = useState<LabView>(initial.view);
  const [slug, setSlug] = useState(initial.song);
  const [playing, setPlaying] = useState(initial.play);
  const [showTr, setShowTr] = useState(true);
  const [showComment, setShowComment] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [toast, setToast] = useState<Mark | null>(null);
  const [query, setQuery] = useState('');
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const song = getSong(slug) ?? songs[0];
  useSongAccent(view === 'library' ? undefined : song);

  const tRef = useRef(initial.t);
  const [t, setT] = useState(initial.t);
  const lockTime = useRef(initial.lockTime);
  const pendingAt = useRef<Moment>(initial.at);
  const markSeq = useRef(1);

  const seek = useCallback(
    (next: number) => {
      const c = Math.max(0, Math.min(song.duration, next));
      tRef.current = c;
      setT(c);
    },
    [song.duration],
  );

  useEffect(() => {
    let alive = true;
    setTimeline(null);
    setError(null);
    void loadLyrics(song.slug)
      .then((lyrics) => {
        if (!alive) return;
        const tl = buildTimeline(lyrics, song.duration, null);
        setTimeline(tl);
        void preloadInstruments(lyrics.sections.flatMap((s) => (s.kind === 'instrumental' ? s.instruments : [])));
        if (!lockTime.current) seek(momentFor(tl, pendingAt.current));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [song.slug, song.duration, seek]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = tRef.current + dt;
      if (next >= song.duration) {
        tRef.current = song.duration;
        setT(song.duration);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, song.duration]);

  const skip = useCallback(
    (dir: -1 | 1) => {
      if (!timeline) return;
      const now = tRef.current;
      const cur = timeline.ownerAt(now);
      if (dir === -1 && cur >= 0 && now - timeline.cues[cur].start > 2.5) {
        seek(timeline.cues[cur].start);
        return;
      }
      const i = Math.max(0, Math.min(timeline.cues.length - 1, cur + dir));
      const cue = timeline.cues[i];
      if (cue) seek(cue.start);
    },
    [timeline, seek],
  );

  const placeMark = useCallback(() => {
    if (!timeline) return;
    const now = tRef.current;
    const cue = timeline.cues[timeline.ownerAt(now)];
    const line = !cue ? song.title : cue.kind === 'line' ? lineText(cue.line) : cue.section.label;
    const mark = { id: `m${markSeq.current++}`, t: now, line };
    setMarks((list) => [...list, mark]);
    setToast(mark);
  }, [timeline, song.title]);

  const undoMark = useCallback(() => {
    setToast((current) => {
      if (current) setMarks((list) => list.filter((m) => m.id !== current.id));
      return null;
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        setPanel(null);
        return;
      }
      if (panel) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skip(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skip(-1);
      } else if (e.code === 'KeyM') {
        if (!e.repeat) placeMark();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, skip, placeMark]);

  const openSong = useCallback((next: string) => {
    lockTime.current = false;
    pendingAt.current = 'vocal';
    setSlug(next);
    setView('stage');
    setPanel(null);
  }, []);

  const pick = useCallback(
    (cue: { start: number }) => {
      seek(cue.start);
      setPlaying(true);
      setView('stage');
      setPanel(null);
    },
    [seek],
  );

  const api = useMemo<LabApi>(
    () => ({
      dir,
      view,
      dark,
      song,
      catalog: songs,
      timeline,
      t,
      playing,
      showTr,
      showComment,
      panel,
      marks,
      toast,
      query,
      setView,
      openSong,
      setQuery,
      toggle: () => setPlaying((v) => !v),
      seek,
      skip,
      pick,
      setShowTr,
      setShowComment,
      setPanel,
      placeMark,
      undoMark,
    }),
    [dir, view, dark, song, timeline, t, playing, showTr, showComment, panel, marks, toast, query, openSong, seek, skip, pick, placeMark, undoMark],
  );

  const ready = view === 'library' || !!timeline;
  const Frame = dir === 'a' ? Manuscript : dir === 'b' ? Cosmos : InstrumentView;

  return (
    <LabProvider value={api}>
      <div className={`lab d-${dir}`} data-scheme={dark ? 'dark' : 'light'} data-ready={ready ? '1' : '0'} data-view={view}>
        {ready ? (
          <Frame />
        ) : (
          <div className="lab-wait">
            <p>{error ?? 'Открываю текст…'}</p>
          </div>
        )}
      </div>
    </LabProvider>
  );
}
