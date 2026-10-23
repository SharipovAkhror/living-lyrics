import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import type { Song } from '@/data/schema';
import type { Timeline } from '@/data/timeline';
import type { AudioFeatures } from '@/instruments/animation';
import { effectiveMotion, type Settings } from '@/app/settings';
import { showHarakatText } from '@/data/harakat';
import { fillQuery, lineWordSync, wordSyncOn } from './fill';
import { LineBlock, type BlockUpdater } from './LineBlock';
import { InstBlock } from './InstBlock';
import { stageCovered, watchCover } from './cover';
import { bisect } from '@/app/bisect';
import { isPhone } from '@/ui/phone';
import { sceneProbeArmed } from './probe';

/** False in the Vercel production build, so `?ll-render-error=1` is compiled out. See vite.config.ts. */
declare const __SCENE_PROBE__: boolean | undefined;
import { PHONE_INST_SLOTS, PHONE_LINE_SLOTS, assignSlots, sameSlots, type PhoneSlot } from './slots';
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
export const Scene = memo(function Scene({ song, timeline, settings, features, clock, onOwnerChange, onPick }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [mounted, setMounted] = useState<number[]>([INTRO, 0, 1, 2]);
  // Phone hosts are created once and then only change which cue they show.
  const [lineSlots, setLineSlots] = useState<(PhoneSlot | null)[]>(() => Array.from({ length: PHONE_LINE_SLOTS }, () => null));
  const [instSlots, setInstSlots] = useState<(PhoneSlot | null)[]>(() => Array.from({ length: PHONE_INST_SLOTS }, () => null));
  const lineSlotsRef = useRef(lineSlots);
  const instSlotsRef = useRef(instSlots);
  const blocks = useRef(new Map<number, { fn: BlockUpdater; m: Measure }>());
  // Bumps when a block reports a new box. A paused clock does not restyle, but a
  // line can still change height after the first read (web fonts, text-wrap balance).
  const measureGen = useRef(0);
  const placedGen = useRef(0);
  const ownerRef = useRef(-2);
  const motion = effectiveMotion(settings);
  const entrance = settings.lineEntrance;
  // Word-by-word fill only for measured and checked timing: a fill that runs ahead of or behind the
  // voice is worse than none (docs/methodology/05-alignment.md). `?fill=1` forces it for a test
  // and does not write the song.
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const forcedFill = fillQuery(search);
  const wordSync = wordSyncOn(song.timing.status, search);
  const plan = useMemo(() => planFlow(timeline, motion === 'off'), [timeline, motion]);

  const register = useCallback((idx: number, fn: BlockUpdater | null, m?: Measure) => {
    if (fn && m) {
      const prev = blocks.current.get(idx);
      const same = prev && prev.m.main === m.main && prev.m.sub === m.sub && prev.m.compact === m.compact && prev.m.full === m.full && prev.fn === fn;
      blocks.current.set(idx, { fn, m });
      if (!same) measureGen.current += 1;
    } else if (blocks.current.delete(idx)) measureGen.current += 1;
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
    let lastIntro = '';
    const fn: BlockUpdater = (_t, d, top) => {
      const s = blockState(d);
      const transform = `translate3d(0, ${top.toFixed(1)}px, 0)`;
      const opacity = (d < 0 ? s.opacity * Math.max(0, 1 + d * 1.4) : s.opacity).toFixed(3);
      const visibility = s.opacity < 0.01 ? 'hidden' : 'visible';
      const key = `${transform}|${opacity}|${visibility}`;
      if (key === lastIntro) return;
      lastIntro = key;
      el.style.transform = transform;
      el.style.opacity = opacity;
      el.style.visibility = visibility;
    };
    register(INTRO, fn, { main: el.offsetHeight, sub: 0, compact: el.offsetHeight, full: el.offsetHeight });
  }, [register, stage]);

  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    let pool = '';
    let lastPlate = '';
    let lastT = Number.NaN;
    let lastPaintMs = 0;
    const loop = () => {
      raf = 0;
      if (stageCovered()) return;
      raf = requestAnimationFrame(loop);
      // Phone lyric layers restyled every frame grew the working set about 13 MB/min
      // even with the sky and the word opacity stopped (T27). 8 Hz still seeks to the
      // same frame: the paint is a function of the clock, not of how many frames ran.
      if (isPhone()) {
        const now = performance.now();
        if (lastPaintMs !== 0 && now - lastPaintMs < 120) return;
        lastPaintMs = now;
      }
      const t = clock();
      // A paused clock used to restyle the stage anyway. WebKit kept that working set.
      // A new box still has to be placed: the first read can precede font load and
      // text-wrap balance, and the lyric would stay a line too high.
      const measuresMoved = measureGen.current !== placedGen.current;
      if (t === lastT && !measuresMoved) return;
      lastT = t;
      const pos = flowPosition(plan, t);
      const list = windowAround(timeline, pos, entrance);
      const key = list.join(',');
      if (key !== lastKey) {
        lastKey = key;
        // Measurement only: leave the phone hosts empty, so lyric text is never
        // committed. Those commits were the floor that kept climbing after the
        // sky, the placement and the chrome had been stopped (T27).
        if (bisect('slots')) {
          /* no lyric hosts */
        } else if (isPhone()) {
          const lineWant: number[] = [];
          const instWant: number[] = [];
          for (const k of list) {
            if (k === INTRO) continue;
            const c = timeline.cues[k];
            if (!c) continue;
            if (c.kind === 'line') lineWant.push(k);
            else instWant.push(k);
          }
          const nextLines = assignSlots(lineSlotsRef.current, lineWant);
          const nextInst = assignSlots(instSlotsRef.current, instWant);
          const linesChanged = !sameSlots(nextLines, lineSlotsRef.current);
          const instChanged = !sameSlots(nextInst, instSlotsRef.current);
          if (linesChanged) lineSlotsRef.current = nextLines;
          if (instChanged) instSlotsRef.current = nextInst;
          if (linesChanged || instChanged) {
            // Drop the line layer before React writes the new lyric. A text
            // change inside a transformed line kept a WebKit backing store.
            // Taking the host out of the document and writing there did not
            // lower the slope (still about 5 MB/min, T27).
            const stageEl = stageRef.current;
            if (linesChanged && stageEl) {
              for (const el of stageEl.querySelectorAll<HTMLElement>('.fb--line')) {
                el.style.transform = 'none';
                el.style.filter = 'none';
                el.style.opacity = '1';
              }
              void stageEl.offsetWidth;
            }
            flushSync(() => {
              if (linesChanged) setLineSlots(nextLines);
              if (instChanged) setInstSlots(nextInst);
            });
          }
        } else {
          setMounted(list);
        }
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
      if (p && !bisect('placement')) {
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
        const nextPool = shown?.kind === 'line' && shown.rtl ? 'rtl' : 'ltr';
        if (nextPool !== pool) {
          pool = nextPool;
          stageRef.current?.parentElement?.setAttribute('data-pool', nextPool);
        }
        const opacity = (o * 0.95).toFixed(3);
        const visibility = o < 0.01 ? 'hidden' : 'visible';
        const transform = `translate3d(0, ${(top + h / 2 - glow / 2).toFixed(1)}px, 0)`;
        const height = `${glow.toFixed(1)}px`;
        const plateKey = `${opacity}|${visibility}|${transform}|${height}`;
        if (plateKey !== lastPlate) {
          lastPlate = plateKey;
          p.style.opacity = opacity;
          p.style.visibility = visibility;
          p.style.transform = transform;
          p.style.height = height;
        }
      }

      placedGen.current = measureGen.current;
      const owner = Math.max(-1, Math.min(timeline.cues.length - 1, Math.round(pos)));
      if (owner !== ownerRef.current) {
        ownerRef.current = owner;
        if (bisect('react')) {
          /* the header and the note stay on the first line */
        } else if (isPhone()) {
          const comment = document.querySelector('.comment');
          if (comment instanceof HTMLElement) {
            comment.style.transform = 'none';
            comment.style.filter = 'none';
            void comment.offsetWidth;
          }
          flushSync(() => onOwnerChange(owner));
        } else {
          onOwnerChange(owner);
        }
      }
    };
    const unwatch = watchCover(() => {
      if (!stageCovered() && !raf) raf = requestAnimationFrame(loop);
    });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unwatch();
    };
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

  // Phone lines take their size from --lyric-* so a seek never writes font-size.
  // The slider scales those variables once, on the scene, not per line.
  const phoneLyric =
    isPhone() && settings.textScale !== 1
      ? ({
          '--lyric-latin': `max(13px, calc(33 * 100dvh / 852 * ${settings.textScale}))`,
          '--lyric-arab': `max(13px, calc(40 * 100dvh / 852 * ${settings.textScale}))`,
          '--lyric-tr': `max(13px, calc(20 * 100dvh / 852 * ${settings.textScale}))`,
        } as CSSProperties)
      : undefined;

  // After every hook. The production build constant-folds this away.
  // Stays armed across React's retry so the boundary, not the retry, records it.
  if (typeof __SCENE_PROBE__ !== 'undefined' && __SCENE_PROBE__ && sceneProbeArmed(search)) {
    throw new Error('ll-render-error');
  }

  return (
    <div className="scene" data-align={settings.textAlign} data-enter={entrance} style={phoneLyric}>
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
        {isPhone()
          ? lineSlots.map((slot, i) => {
              const cue = slot ? timeline.cues[slot.idx] : undefined;
              if (!slot || !cue || cue.kind !== 'line') return <div key={`pl-${i}`} hidden />;
              return (
                <LineBlock
                  key={`pl-${i}`}
                  parked={!slot.live}
                  cue={cue}
                  wordSync={lineWordSync(wordSync, !!cue.line.flags?.includes('timing-draft'), forcedFill)}
                  settings={textSettings}
                  entrance={entrance}
                  motion={motion}
                  stage={stage}
                  register={register}
                  onPick={onPick}
                />
              );
            })
          : null}
        {isPhone()
          ? instSlots.map((slot, i) => {
              const cue = slot ? timeline.cues[slot.idx] : undefined;
              if (!slot || !cue || cue.kind !== 'inst') return <div key={`pi-${i}`} hidden />;
              return (
                <InstBlock
                  key={`pi-${i}`}
                  parked={!slot.live}
                  cue={cue}
                  timeline={timeline}
                  timed={wordSync}
                  entrance={entrance}
                  motion={motion}
                  stage={stage}
                  features={features}
                  register={register}
                  onPick={onPick}
                />
              );
            })
          : null}
        {!isPhone() &&
          mounted.map((idx) => {
            if (idx === INTRO) return null;
            const c = timeline.cues[idx];
            if (!c) return null;
            return c.kind === 'line' ? (
              <LineBlock
                key={`${idx}-${settings.fontPersian}-${settings.fontOriginal}-${settings.fontTranslation}`}
                cue={c}
                wordSync={lineWordSync(wordSync, !!c.line.flags?.includes('timing-draft'), forcedFill)}
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
});
