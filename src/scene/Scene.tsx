import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '@/data/schema';
import type { Timeline } from '@/data/timeline';
import type { AudioFeatures } from '@/instruments/animation';
import { effectiveMotion, type Settings } from '@/app/settings';
import { showHarakatText } from '@/data/harakat';
import { LineBlock, type BlockUpdater } from './LineBlock';
import { InstBlock } from './InstBlock';
import { WAIT_ROOM, blockHeight, blockState, compressStack, flowPosition, layoutAt, lerp, planFlow, stackCompress, waitHint, windowAround, type Measure } from './flow';

interface Props {
  song: Song;
  timeline: Timeline;
  settings: Settings;
  /** Precomputed audio features for instrument motion. Null until loaded. */
  features: AudioFeatures | null;
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
export function Scene({ song, timeline, settings, features, clock, onOwnerChange, onPick }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [mounted, setMounted] = useState<number[]>([INTRO, 0, 1, 2]);
  const blocks = useRef(new Map<number, { fn: BlockUpdater; m: Measure }>());
  const ownerRef = useRef(-2);
  const motion = effectiveMotion(settings);
  const entrance = settings.lineEntrance;
  // Word-by-word fill only for measured and checked timing: a fill that runs ahead of or behind the
  // voice is worse than none (docs/methodology/05-alignment.md).
  const wordSync = song.timing.status !== 'draft';
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
      const pos = flowPosition(plan, t);
      const list = windowAround(timeline, pos, entrance);
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
      const deck = stage.w >= 640 && stage.h <= 420;
      const centerY = stage.h * (deck ? 0.42 : 0.36);
      const waits = new Map<number, number>();
      for (const k of list) waits.set(k, wordSync ? waitHint(timeline, k, t) : 0);
      const room = (k: number) => (waits.get(k) ?? 0) * WAIT_ROOM;
      const compress = stackCompress(entrance);
      const clampAnchor = (anchor: number) => (list.length ? Math.max(list[0], Math.min(list[list.length - 1], anchor)) : anchor);
      const heightsAt = (anchor: number) => {
        const h = new Map<number, number>();
        for (const k of list) h.set(k, blockHeight(measures.get(k), k - anchor));
        return h;
      };
      const A = compressStack(layoutAt(a, list, measures, centerY, 8, room), clampAnchor(a), compress, heightsAt(a));
      const B = compressStack(layoutAt(a + 1, list, measures, centerY, 8, room), clampAnchor(a + 1), compress, heightsAt(a + 1));
      for (const k of list) {
        const b = blocks.current.get(k);
        if (!b) continue;
        b.fn(t, k - pos, lerp(A.get(k) ?? 0, B.get(k) ?? 0, f), waits.get(k) ?? 0);
      }
      // The title card is always in the DOM; once it leaves the window nothing updates it, so hide it
      // explicitly (otherwise a seek from the start leaves it frozen over the lyrics).
      if (!list.includes(INTRO) && intro.current && intro.current.style.visibility !== 'hidden') intro.current.style.visibility = 'hidden';

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
        const glow = Math.min(stage.h * 0.5, 380);
        const shown = f < 0.5 ? timeline.cues[a] : timeline.cues[a + 1];
        stageRef.current?.parentElement?.setAttribute('data-pool', shown?.kind === 'line' && shown.rtl ? 'rtl' : 'ltr');
        p.style.opacity = (o * 0.95).toFixed(3);
        p.style.visibility = o < 0.01 ? 'hidden' : 'visible';
        p.style.transform = `translate3d(0, ${(top + h / 2 - glow / 2).toFixed(1)}px, 0)`;
        p.style.height = `${glow.toFixed(1)}px`;
        // The margin note shares this frame: its top is the active line's top. A seek lands both together.
        const host = stageRef.current?.closest('.song') as HTMLElement | null;
        if (host && (b0 || b1)) {
          const y = (stageRef.current?.offsetTop ?? 0) + top + 2;
          host.style.setProperty('--note-y', `${y.toFixed(1)}px`);
        }
      }

      const owner = Math.max(-1, Math.min(timeline.cues.length - 1, Math.round(pos)));
      if (owner !== ownerRef.current) {
        ownerRef.current = owner;
        onOwnerChange(owner);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timeline, plan, clock, onOwnerChange, stage, wordSync, entrance]);

  const poets = song.poets?.map((p) => p.name).join(' · ');
  const textSettings = useMemo(
    () => ({
      fontPersian: settings.fontPersian,
      showTranslation: settings.showTranslation,
      showTranslit: settings.showTranslit,
      showAlt: settings.showAlt,
      showHarakat: settings.showHarakat,
      textScale: settings.textScale,
    }),
    [settings.fontPersian, settings.fontOriginal, settings.fontTranslation, settings.showTranslation, settings.showTranslit, settings.showAlt, settings.showHarakat, settings.textScale],
  );

  return (
    <div className="scene" data-align={settings.textAlign} data-enter={entrance}>
      <div ref={stageRef} className="scene-stage">
        <div ref={plate} className="flow-plate" aria-hidden style={{ visibility: 'hidden' }} />
        <div ref={intro} className="fb fb--intro" style={{ visibility: 'hidden' }}>
          <div className="intro-title">{song.title}</div>
          {song.titleOriginal && (
            <div className="intro-original f-mushaf" dir="rtl">
              {showHarakatText(song.titleOriginal, settings.showHarakat)}
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
            <LineBlock
              key={`${idx}-${settings.fontPersian}-${settings.fontOriginal}-${settings.fontTranslation}`}
              cue={c}
              wordSync={wordSync && !c.line.flags?.includes('timing-draft')}
              settings={textSettings}
              entrance={entrance}
              motion={motion}
              stage={stage}
              register={register}
              onPick={onPick}
            />
          ) : (
            <InstBlock key={idx} cue={c} timeline={timeline} timed={wordSync} entrance={entrance} motion={motion} stage={stage} features={features} register={register} onPick={onPick} />
          );
        })}
      </div>
    </div>
  );
}
