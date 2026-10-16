import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '@/data/schema';
import type { Timeline } from '@/data/timeline';
import { effectiveMotion, type Settings } from '@/app/settings';
import { LineBlock, type BlockUpdater } from './LineBlock';
import { InstBlock } from './InstBlock';
import { Field } from './Field';
import { WAIT_ROOM, blockState, flowPosition, layoutAt, lerp, planFlow, waitHint, windowAround, type Measure } from './flow';

interface Props {
  song: Song;
  timeline: Timeline;
  settings: Settings;
  dark: boolean;
  /** Current playback time. */
  clock: () => number;
  /** The cue nearest to the current position changed (top bar label, commentary). */
  onOwnerChange: (idx: number) => void;
  /** The reader tapped a line or an instrumental block. */
  onPick: (idx: number) => void;
}

const INTRO = -1;

/**
 * The stage. One clock read per frame computes the flow position, lays the mounted blocks out
 * around it and hands each block its distance and top; blocks style themselves imperatively.
 */
export function Scene({ song, timeline, settings, dark, clock, onOwnerChange, onPick }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [mounted, setMounted] = useState<number[]>([INTRO, 0, 1, 2]);
  const blocks = useRef(new Map<number, { fn: BlockUpdater; m: Measure }>());
  const ownerRef = useRef(-2);
  const energyRef = useRef(0);
  const motion = effectiveMotion(settings);
  const plan = useMemo(() => planFlow(timeline, motion === 'off'), [timeline, motion]);

  const register = useCallback((idx: number, fn: BlockUpdater | null, m?: Measure) => {
    if (fn && m) blocks.current.set(idx, { fn, m });
    else blocks.current.delete(idx);
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-measure once web fonts have arrived (line heights change).
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setStage((s) => ({ ...s })));
    return () => {
      alive = false;
    };
  }, []);

  // The title card is block −1: measured like any other block.
  useLayoutEffect(() => {
    const el = intro.current;
    if (!el) return;
    const fn: BlockUpdater = (_t, d, top) => {
      const s = blockState(d);
      el.style.transform = `translate3d(0, ${top.toFixed(1)}px, 0)`;
      el.style.opacity = (d < 0 ? s.opacity * Math.max(0, 1 + d * 1.4) : s.opacity).toFixed(3);
      el.style.visibility = s.opacity < 0.01 ? 'hidden' : 'visible';
    };
    register(INTRO, fn, { main: el.offsetHeight, sub: 0, compact: el.offsetHeight, full: el.offsetHeight });
  }, [register, stage]);

  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock();
      energyRef.current = timeline.energyAt(t);
      const pos = flowPosition(plan, t);
      const list = windowAround(timeline, pos);
      const key = list.join(',');
      if (key !== lastKey) {
        lastKey = key;
        setMounted(list);
      }
      if (!stage.h) return;

      // Positions for the two integer anchors around pos, blended: motion and scale stay continuous.
      const measures = new Map<number, Measure>();
      for (const k of list) {
        const b = blocks.current.get(k);
        if (b) measures.set(k, b.m);
      }
      const a = Math.floor(pos);
      const f = pos - a;
      const centerY = stage.h * 0.36;
      const waits = new Map<number, number>();
      for (const k of list) waits.set(k, waitHint(timeline, k, t));
      const room = (k: number) => (waits.get(k) ?? 0) * WAIT_ROOM;
      const A = layoutAt(a, list, measures, centerY, 8, room);
      const B = layoutAt(a + 1, list, measures, centerY, 8, room);
      for (const k of list) {
        const b = blocks.current.get(k);
        if (!b) continue;
        b.fn(t, k - pos, lerp(A.get(k) ?? 0, B.get(k) ?? 0, f), waits.get(k) ?? 0);
      }

      // The material plate follows the current line (not the title card or an instrumental block,
      // which carry their own plates).
      const p = plate.current;
      if (p) {
        const box = (k: number) => {
          const b = blocks.current.get(k);
          const c = timeline.cues[k];
          if (!b || !c || c.kind !== 'line') return null;
          const s = blockState(k - pos);
          const top = lerp(A.get(k) ?? 0, B.get(k) ?? 0, f);
          return { top, h: (b.m.main + b.m.sub * s.subRoom) * s.scale };
        };
        const b0 = box(a);
        const b1 = box(a + 1);
        const o = (b0 ? 1 - f : 0) + (b1 ? f : 0);
        const top = b0 && b1 ? lerp(b0.top, b1.top, f) : (b0 ?? b1)?.top ?? 0;
        const h = b0 && b1 ? lerp(b0.h, b1.h, f) : (b0 ?? b1)?.h ?? 0;
        p.style.opacity = o.toFixed(3);
        p.style.visibility = o < 0.01 ? 'hidden' : 'visible';
        p.style.transform = `translate3d(0, ${(top - 18).toFixed(1)}px, 0)`;
        p.style.height = `${(h + 36).toFixed(1)}px`;
      }

      const owner = Math.max(-1, Math.min(timeline.cues.length - 1, Math.round(pos)));
      if (owner !== ownerRef.current) {
        ownerRef.current = owner;
        onOwnerChange(owner);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timeline, plan, clock, onOwnerChange, stage]);

  const getEnergy = useCallback(() => energyRef.current, []);
  const poets = song.poets?.map((p) => p.name).join(' · ');
  const textSettings = useMemo(
    () => ({
      persianStyle: settings.persianStyle,
      showTranslation: settings.showTranslation,
      showTranslit: settings.showTranslit,
      showAlt: settings.showAlt,
      textScale: settings.textScale,
    }),
    [settings.persianStyle, settings.showTranslation, settings.showTranslit, settings.showAlt, settings.textScale],
  );

  return (
    <div className="scene">
      <Field colors={song.palette.field} dark={dark} energy={getEnergy} still={motion !== 'full'} />
      <div ref={stageRef} className="scene-stage">
        <div ref={plate} className="flow-plate" aria-hidden style={{ visibility: 'hidden' }} />
        <div ref={intro} className="fb fb--intro" style={{ visibility: 'hidden' }}>
          <div className="intro-title">{song.title}</div>
          {song.titleOriginal && (
            <div className="intro-original f-mushaf" dir="rtl">
              {song.titleOriginal}
            </div>
          )}
          <div className="intro-meta t-subhead">
            {song.artist}
            {song.performance?.event ? ` · ${song.performance.event}` : ''}
          </div>
          {poets && <div className="intro-poets t-footnote">{poets}</div>}
        </div>
        {mounted.map((idx) => {
          if (idx === INTRO) return null;
          const c = timeline.cues[idx];
          if (!c) return null;
          return c.kind === 'line' ? (
            <LineBlock key={`${idx}-${settings.persianStyle}`} cue={c} settings={textSettings} motion={motion} stage={stage} register={register} onPick={onPick} />
          ) : (
            <InstBlock key={idx} cue={c} timeline={timeline} motion={motion} stage={stage} register={register} onPick={onPick} />
          );
        })}
      </div>
    </div>
  );
}
