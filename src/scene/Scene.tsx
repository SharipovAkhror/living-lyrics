import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Song } from '@/data/schema';
import type { Cue, Timeline } from '@/data/timeline';
import { effectiveMotion, type Settings } from '@/app/settings';
import { LineView, type Updater } from './LineView';
import { InstView } from './InstView';
import { Field } from './Field';
import { clamp01 } from './choreo';

interface Props {
  song: Song;
  timeline: Timeline;
  settings: Settings;
  dark: boolean;
  /** Current playback time. */
  clock: () => number;
  /** In manual reading mode, show this cue fully sung and nothing else. */
  frozen: number | null;
  onOwnerChange: (idx: number) => void;
  onTap: () => void;
  onSwipe: (dir: -1 | 1) => void;
}

/** Cues mounted at time t: visible ones plus the next one shortly before it appears (so it can measure itself). */
function mountedAt(tl: Timeline, t: number): number[] {
  const out: number[] = [];
  const o = Math.max(0, tl.ownerAt(t + 2));
  for (let i = Math.max(0, o - 3); i <= Math.min(tl.cues.length - 1, o + 2); i++) {
    const c = tl.cues[i];
    if (t >= c.show - 0.9 && t < c.hide + 0.05) out.push(i);
  }
  return out;
}

export function Scene({ song, timeline, settings, dark, clock, frozen, onOwnerChange, onTap, onSwipe }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [mounted, setMounted] = useState<number[]>([]);
  const updaters = useRef(new Map<number, Updater>());
  const breath = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const ownerRef = useRef(-2);
  const energyRef = useRef(0);
  const motion = effectiveMotion(settings);

  const register = useCallback((idx: number, fn: Updater | null) => {
    if (fn) updaters.current.set(idx, fn);
    else updaters.current.delete(idx);
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-measure once web fonts have arrived (line widths change).
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setStage((s) => ({ ...s })));
    return () => {
      alive = false;
    };
  }, []);

  // The frame loop: one clock read per frame drives every mounted view.
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const frozenCue = frozen != null ? timeline.cues[frozen] : null;
      const t = frozenCue ? (frozenCue.kind === 'line' ? frozenCue.end + 0.02 : frozenCue.start + 3) : clock();
      const energy = timeline.energyAt(t);
      energyRef.current = energy;

      const list = frozenCue ? [frozenCue.idx] : mountedAt(timeline, t);
      const key = list.join(',');
      if (key !== lastKey) {
        lastKey = key;
        setMounted(list);
      }
      for (const idx of list) {
        const fn = updaters.current.get(idx);
        if (!fn) continue;
        const c = timeline.cues[idx];
        // A frozen line is shown settled: entrance done, nothing leaving.
        fn(frozenCue ? Math.min(t, c.hide - 0.7) : t, energy);
      }

      const owner = frozenCue ? frozenCue.idx : timeline.ownerAt(t);
      if (owner !== ownerRef.current) {
        ownerRef.current = owner;
        onOwnerChange(owner);
      }

      // Breathing dots between distant lines (as in Apple Music), and the title card before the first cue.
      const first = timeline.cues[0];
      const introO = !frozenCue && first ? 1 - clamp01((t - (first.show - 0.6)) / 0.6) : 0;
      if (intro.current) {
        intro.current.style.opacity = String(introO);
        intro.current.style.visibility = introO > 0.01 ? 'visible' : 'hidden';
      }
      if (breath.current) {
        const cur = timeline.cues[owner] as Cue | undefined;
        const next = timeline.cues[owner + 1] as Cue | undefined;
        let b = 0;
        let p = 0;
        if (!frozenCue && cur && next && cur.kind === 'line' && t > cur.hide - 0.2 && next.show - cur.hide > 1.6) {
          const span = next.show - cur.hide;
          p = clamp01((t - cur.hide) / span);
          b = clamp01((t - cur.hide + 0.2) / 0.5) * (1 - clamp01((t - (next.show - 0.4)) / 0.4));
        }
        breath.current.style.opacity = String(b);
        breath.current.style.setProperty('--p', p.toFixed(3));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timeline, clock, frozen, onOwnerChange]);

  // Gestures: tap toggles chrome, horizontal swipe moves between lines.
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) onSwipe(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && performance.now() - d.t < 400) onTap();
  };

  const getEnergy = useCallback(() => energyRef.current, []);
  const first = song.poets?.map((p) => p.name).join(' · ');

  return (
    <div className="scene">
      <Field colors={song.palette.field} dark={dark} energy={getEnergy} still={motion !== 'full'} />
      <div ref={stageRef} className="scene-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div ref={intro} className="intro">
          <div className="intro-title">{song.title}</div>
          {song.titleOriginal && (
            <div className="intro-original f-mushaf" dir="rtl">
              {song.titleOriginal}
            </div>
          )}
          <div className="intro-meta t-subhead secondary">
            {song.artist}
            {song.performance?.event ? ` · ${song.performance.event}` : ''}
          </div>
          {first && <div className="intro-poets t-footnote tertiary">{first}</div>}
        </div>
        {mounted.map((idx) => {
          const c = timeline.cues[idx];
          return c.kind === 'line' ? (
            <LineView key={`${idx}-${settings.persianStyle}`} cue={c} settings={settings} motion={motion} stage={stage} register={register} />
          ) : (
            <InstView key={idx} cue={c} timeline={timeline} motion={motion} register={register} />
          );
        })}
        <div ref={breath} className="breath" style={{ opacity: 0 }} aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

