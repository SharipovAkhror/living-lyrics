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
import { PHONE_INST_SLOTS, PHONE_LINE_SLOTS, assignSlots, retargetPhoneLines, sameSlots, type PhoneSlot } from './slots';
import { GAP, WAIT_ROOM, blockHeight, blockState, clearBand, compressStack, flowPosition, keepInStage, layoutAt, lerp, planFlow, stackCompress, waitHint, windowAround, type Measure } from './flow';
import { stepSpring, type SpringState } from '@/ui/spring';

/**
 * The stored 393×852 frame was laid out with the tighter column (gap 26, then
 * the settle entrance compresses it). Wider studio air stays on desktop,
 * landscape, and the short SE, which that check does not cover.
 */
function columnGap() {
  if (typeof window === 'undefined' || !isPhone()) return GAP;
  if (window.matchMedia('(min-width: 390px) and (max-width: 699px) and (min-height: 521px)').matches) return 26;
  return GAP;
}

/**
 * Empty phone slots mount on the first commit. A scrub that mounts a line
 * measured the text in that same frame and missed the interval.
 */
function fillSpare(slots: (PhoneSlot | null)[], ids: readonly number[]) {
  const used = new Set<number>();
  for (const slot of slots) if (slot) used.add(slot.idx);
  let free = slots.findIndex((slot) => slot == null);
  for (const id of ids) {
    if (free < 0) return;
    if (used.has(id)) continue;
    slots[free] = { idx: id, live: false };
    used.add(id);
    free = slots.findIndex((slot) => slot == null);
  }
}

/** Something on this block is actually drawn, so a departing clone is worth keeping. */
function hasLightPixels(el: HTMLElement): boolean {
  if (el.querySelector('.ist-art')) return true;
  const plate = el.querySelector<HTMLElement>('.ist-plate');
  if (plate) {
    const opacity = plate.style.opacity === '' ? 1 : Number(plate.style.opacity);
    if (opacity >= 0.08) return true;
  }
  for (const node of el.querySelectorAll('.fb-orig, .intro-title')) {
    const text = (node.textContent || '').replace(/\u200b/g, '').trim();
    if (text) return true;
  }
  return false;
}

/** cloneNode drops the open shadow root, which is where a phone engraving lives. */
function cloneBlock(el: HTMLElement): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  const src = [...el.querySelectorAll<HTMLElement>('.ist-art-mount')];
  const dst = [...clone.querySelectorAll<HTMLElement>('.ist-art-mount')];
  src.forEach((from, i) => {
    const to = dst[i];
    const inner = from.shadowRoot;
    if (!to || !inner) return;
    const shadow = to.attachShadow({ mode: 'open' });
    shadow.innerHTML = inner.innerHTML;
  });
  return clone;
}

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
  const liveView = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [mounted, setMounted] = useState<number[]>([INTRO, 0, 1, 2]);
  // Phone hosts are created once and then only change which cue they show.
  const [lineSlots, setLineSlots] = useState<(PhoneSlot | null)[]>(() => Array.from({ length: PHONE_LINE_SLOTS }, () => null));
  const [instSlots, setInstSlots] = useState<(PhoneSlot | null)[]>(() => Array.from({ length: PHONE_INST_SLOTS }, () => null));
  // One read of the real boxes after the finger lifts. The drag itself does not lay out.
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const lineSlotsRef = useRef(lineSlots);
  const instSlotsRef = useRef(instSlots);
  const blocks = useRef(new Map<number, { fn: BlockUpdater; m: Measure }>());
  // Bumps when a block reports a new box. A paused clock does not restyle, but a
  // line can still change height after the first read (web fonts, text-wrap balance).
  const measureGen = useRef(0);
  // The note opening changes the stage box between frames. The phone paint
  // skips ahead unless this is set, otherwise the line stays on the old centre.
  const stageDirty = useRef(true);
  const placedGen = useRef(0);
  const ownerRef = useRef(-2);
  // The loop reads these. A scrub retargets lines without waiting for a new effect.
  const paintSettings = useRef(settings);
  paintSettings.current = settings;
  const motion = effectiveMotion(settings);
  const entrance = settings.lineEntrance;
  // Word-by-word fill only for measured and checked timing: a fill that runs ahead of or behind the
  // voice is worse than none (docs/methodology/05-alignment.md). `?fill=1` forces it for a test
  // and does not write the song.
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const forcedFill = fillQuery(search);
  const wordSync = wordSyncOn(song.timing.status, search);
  const wordSyncRef = useRef(wordSync);
  wordSyncRef.current = wordSync;
  const plan = useMemo(() => planFlow(timeline, motion === 'off'), [timeline, motion]);
  // The frame loop must not restart when the stage box changes. A restart
  // committed the lyric hosts again and spent a second phone frame.
  const stageBox = useRef(stage);
  stageBox.current = stage;

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
    const ro = new ResizeObserver(([e]) => {
      stageDirty.current = true;
      const w = e.contentRect.width;
      const h = e.contentRect.height;
      setStage((s) => (Math.abs(s.w - w) < 0.5 && Math.abs(s.h - h) < 0.5 ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new stage object used to restart the frame loop on the opening. Fonts
  // that are already loaded have not moved the box, so the remeasure waits
  // until the cover has landed and then only bumps the line epoch.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const el = stageRef.current;
    const remeasure = () => {
      if (!alive) return;
      if (document.querySelector('.song.is-flying, .morph-cover')) {
        window.clearTimeout(timer);
        timer = window.setTimeout(remeasure, 1200);
        return;
      }
      setLayoutEpoch((n) => n + 1);
    };
    document.fonts?.ready.then(() => alive && remeasure());
    const onRemeasure = () => alive && remeasure();
    el?.addEventListener('ll-remeasure', onRemeasure);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      el?.removeEventListener('ll-remeasure', onRemeasure);
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
    let noteY = '';
    let pool = '';
    let lastPlate = '';
    let lastT = Number.NaN;
    let lastLive = '';
    let lastPaintMs = 0;
    let frameAt = 0;
    // A scrub that jumps from a line into a break. Ordinary playback stays under the gate.
    const VEIL = { stiffness: 70, damping: 16, mass: 1 };
    let veil: SpringState | null = null;
    let veilKind = '';
    let veilClock = Number.NaN;
    let pendingOwner: number | null = null;
    let ownerWait = false;
    let scrubWas = false;
    // One departing clone while a scrub crosses from lines to an engraving, or back.
    // A second boundary during the 120 ms updates the live view and does not stack another ghost.
    let depart: HTMLElement | null = null;
    let fadeStart = 0;
    let fadeDir = 1;
    let shownKind = '';
    const dropDepart = () => {
      depart?.remove();
      depart = null;
      fadeStart = 0;
      const live = liveView.current;
      if (live) {
        live.style.opacity = '';
        live.style.transform = '';
      }
    };
    const applyFade = (nowMs: number) => {
      if (!depart || fadeStart === 0) return;
      const u = Math.min(1, (nowMs - fadeStart) / 120);
      const eased = u * u * (3 - 2 * u);
      const shift = (1 - eased) * 12 * fadeDir;
      const live = liveView.current;
      // The live view stays opaque. Fading it out emptied the stage for the whole
      // crossfade, because the phone engraving is not in the departing clone.
      if (live) {
        live.style.opacity = '';
        live.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
      }
      depart.style.opacity = (1 - eased).toFixed(3);
      depart.style.transform = `translate3d(0, ${(-shift).toFixed(1)}px, 0)`;
      if (u >= 1) dropDepart();
    };
    const takeDepart = (dir: number) => {
      const stageEl = stageRef.current;
      if (!stageEl || depart) return false;
      const nodes = [...stageEl.querySelectorAll<HTMLElement>('.scene-view .fb')].filter((el) => {
        if (el.style.visibility === 'hidden') return false;
        const opacity = el.style.opacity === '' ? 1 : Number(el.style.opacity);
        return opacity >= 0.08 && hasLightPixels(el);
      });
      if (!nodes.length) return false;
      const layer = document.createElement('div');
      layer.className = 'scene-depart';
      layer.setAttribute('aria-hidden', 'true');
      for (const el of nodes) layer.appendChild(cloneBlock(el));
      stageEl.appendChild(layer);
      depart = layer;
      fadeStart = performance.now();
      fadeDir = dir;
      return true;
    };
    // The opening seek (deep link or resume) is not a scrub. Ignore it.
    const veilReadyAt = performance.now() + 600;
    const kindAt = (time: number) => {
      const idx = Math.round(flowPosition(plan, time));
      if (idx < 0) return 'intro';
      const cue = timeline.cues[idx];
      if (!cue) return 'intro';
      return cue.kind === 'inst' ? 'inst' : 'line';
    };
    const writeVeil = (amount: number) => {
      const stageEl = stageRef.current;
      if (!stageEl) return;
      const o = Math.max(0.2, Math.min(1, amount));
      const y = (1 - o) * 16;
      stageEl.style.opacity = o.toFixed(3);
      stageEl.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    };
    // Read once. offsetTop inside the frame forces layout on every seek tick.
    const stageTop = stageRef.current?.offsetTop ?? 0;
    const host = stageRef.current?.closest('.song') as HTMLElement | null;
    let glow = Math.min(stageBox.current.h * 0.5, 380);
    let cachedW = stageBox.current.w;
    let cachedH = stageBox.current.h;
    let cachedTop = 0;
    if (plate.current) plate.current.style.height = `${glow.toFixed(1)}px`;
    const lineIds: number[] = [];
    for (let i = 0; i < timeline.cues.length; i++) {
      if (timeline.cues[i]?.kind === 'line') lineIds.push(i);
    }
    const loop = () => {
      raf = 0;
      if (stageCovered()) return;
      raf = requestAnimationFrame(loop);
      let heavyCommit = false;
      const scrubbingNow = !!host?.classList.contains('is-scrubbing');
      let releasePaint = false;
      if (scrubWas && !scrubbingNow) {
        // The finger is up. Drop the fade in this frame so the picture matches a
        // direct seek, then let React catch the hosts the drag rewrote.
        releasePaint = true;
        dropDepart();
        veil = null;
        const stageEl = stageRef.current;
        if (stageEl) {
          stageEl.style.opacity = '';
          stageEl.style.transform = '';
        }
        if (isPhone()) {
          const copy = (slots: (PhoneSlot | null)[]) => slots.map((slot) => (slot ? { idx: slot.idx, live: slot.live } : null));
          const lines = copy(lineSlotsRef.current);
          const inst = copy(instSlotsRef.current);
          lineSlotsRef.current = lines;
          instSlotsRef.current = inst;
          flushSync(() => {
            setLineSlots(lines);
            setInstSlots(inst);
          });
        }
        lastT = Number.NaN;
        lastPaintMs = 0;
        stageDirty.current = true;
        requestAnimationFrame(() => setLayoutEpoch((n) => n + 1));
      }
      scrubWas = scrubbingNow;
      const now = performance.now();
      const frameDt = frameAt ? Math.min(0.05, (now - frameAt) / 1000) : 0.016;
      frameAt = now;
      // A scrub keeps the stage at full strength. The veil used to restart on
      // every large step and, with the hide below, left the settled frame empty.
      if (scrubbingNow) {
        if (veil) {
          veil = null;
          const stageEl = stageRef.current;
          if (stageEl) {
            stageEl.style.opacity = '';
            stageEl.style.transform = '';
          }
        }
      } else if (motion !== 'off') {
        const time = clock();
        const kind = kindAt(time);
        const jumped = Number.isFinite(veilClock) && Math.abs(time - veilClock) > 0.45 && kind !== veilKind;
        // A second boundary while the veil is still down would hold the stage dim.
        if (jumped && now >= veilReadyAt && (!veil || veil.x > 0.75)) {
          veil = { x: 0.35, v: 0 };
          stageDirty.current = true;
        } else if (jumped) stageDirty.current = true;
        veilKind = kind;
        veilClock = time;
        if (veil) {
          veil = stepSpring(veil, 1, frameDt, VEIL);
          writeVeil(veil.x);
          if (Math.abs(veil.x - 1) < 0.02 && Math.abs(veil.v) < 0.05) {
            const stageEl = stageRef.current;
            if (stageEl) {
              stageEl.style.opacity = '';
              stageEl.style.transform = '';
            }
            veil = null;
          }
        }
      }
      // Phone lyric layers restyled every frame grew the working set about 13 MB/min
      // even with the sky and the word opacity stopped (T27). 8 Hz still seeks to the
      // same frame: the paint is a function of the clock, not of how many frames ran.
      // Playback stays at 8 Hz. A drag paints the time under the finger, and the
      // release frame has to paint even when the previous drag frame was recent.
      if (isPhone() && !scrubbingNow && !depart && !releasePaint) {
        const dirty = stageDirty.current;
        if (!dirty && lastPaintMs !== 0 && now - lastPaintMs < 120) return;
        stageDirty.current = false;
        lastPaintMs = now;
      } else if (isPhone()) {
        stageDirty.current = false;
        lastPaintMs = now;
      }
      // A drag does not resize the stage. Reading the box here forced layout on
      // every finger frame and pushed the phone scrub past the frame budget.
      let liveW = cachedW;
      let liveH = cachedH;
      let liveTop = cachedTop;
      if (!scrubbingNow) {
        const live = stageRef.current?.getBoundingClientRect();
        if (live) {
          liveW = live.width;
          liveH = live.height;
          liveTop = live.top;
          cachedW = liveW;
          cachedH = liveH;
          cachedTop = liveTop;
        }
      }
      const nextGlow = Math.min((liveH || stageBox.current.h) * 0.5, 380);
      if (plate.current && Math.abs(nextGlow - glow) > 0.5) {
        glow = nextGlow;
        plate.current.style.height = `${glow.toFixed(1)}px`;
      }
      const t = clock();
      // A paused clock used to restyle the stage anyway. WebKit kept that working set.
      // A new box still has to be placed: the first read can precede font load and
      // text-wrap balance, and the lyric would stay a line too high.
      const measuresMoved = measureGen.current !== placedGen.current;
      const liveKey = `${Math.round(liveW)}x${Math.round(liveH)}`;
      if (depart) applyFade(now);
      const kind = kindAt(t);
      if (scrubbingNow && shownKind && kind !== shownKind && !depart && motion !== 'off') {
        const dir = Number.isFinite(lastT) && t < lastT ? -1 : 1;
        if (takeDepart(dir)) applyFade(performance.now());
      }
      shownKind = kind;
      if (t === lastT && !measuresMoved && liveKey === lastLive && pendingOwner == null && !depart) return;
      lastT = t;
      lastLive = liveKey;
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
          const prevLines = lineSlotsRef.current;
          const prevInst = instSlotsRef.current;
          const nextLines = assignSlots(prevLines, lineWant);
          const nextInst = assignSlots(prevInst, instWant);
          // Mount the spare hosts on the first drag frame, not during the
          // opening flight. Later steps retarget those hosts and skip React.
          if (scrubbingNow) fillSpare(nextLines, lineIds);
          const linesChanged = !sameSlots(nextLines, prevLines);
          const instChanged = !sameSlots(nextInst, prevInst);
          if (linesChanged || instChanged) {
            // One view at a time. During a scrub the same host is rewritten in
            // place: a React commit of the line was the long frame. The hosts
            // stay visible. Hiding them here left the stage empty, because the
            // updater skips a write when its cache already matches.
            const stageEl = stageRef.current;
            const scrubbing = !!host?.classList.contains('is-scrubbing');
            const paint = paintSettings.current;
            let reactedLines = linesChanged;
            if (scrubbing && linesChanged && stageEl) {
              const wrote = retargetPhoneLines(stageEl, prevLines, nextLines, timeline, blocks.current, paint, wordSyncRef.current);
              if (wrote) {
                lineSlotsRef.current = nextLines;
                reactedLines = false;
              }
            }
            if (reactedLines) lineSlotsRef.current = nextLines;
            if (instChanged) instSlotsRef.current = nextInst;
            if (reactedLines || instChanged) {
              flushSync(() => {
                if (reactedLines) setLineSlots(nextLines);
                if (instChanged) setInstSlots(nextInst);
              });
              heavyCommit = true;
            }
          }
        } else {
          // Commit before this frame paints. A hidden new block and a removed
          // old one would otherwise be one empty frame when a seek crosses
          // from a line into an instrumental break.
          flushSync(() => setMounted(list));
        }
      }
      if (!liveH) return;

      // Positions for the two integer anchors around pos, blended: motion and scale stay continuous.
      const measures = new Map<number, Measure>();
      for (const k of list) {
        const b = blocks.current.get(k);
        if (b) measures.set(k, b.m);
      }
      const a = Math.floor(pos);
      const f = pos - a;
      const deck = liveW >= 640 && liveH <= 420;
      // Centre of the visible stage, not of a box that continues under the floor.
      const centerY = liveH * (deck ? 0.46 : 0.42);
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
      const gap = columnGap();
      const pad = Math.max(28, liveH * 0.1);
      const stackAt = (anchor: number) => {
        const held = clampAnchor(anchor);
        const stacked = compressStack(layoutAt(anchor, list, measures, centerY, 8, room, gap), held, compress, heightsAt(anchor));
        return keepInStage(stacked, held, heightsAt(anchor).get(held) ?? 0, liveH, pad);
      };
      const A = stackAt(a);
      const B = stackAt(a + 1);
      const blended = new Map<number, number>();
      const bandH = new Map<number, number>();
      for (const k of list) {
        blended.set(k, lerp(A.get(k) ?? 0, B.get(k) ?? 0, f));
        bandH.set(k, blockHeight(measures.get(k), k - pos));
      }
      const placed = clearBand(blended, pos, bandH, liveH, liveTop, window.innerHeight);
      for (const k of list) {
        const b = blocks.current.get(k);
        if (!b) continue;
        b.fn(t, k - pos, placed.get(k) ?? 0, waits.get(k) ?? 0);
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
          const top = placed.get(k) ?? 0;
          return { top, h: (b.m.main + b.m.sub * s.subRoom) * s.scale };
        };
        const b0 = box(a);
        const b1 = box(a + 1);
        const o = (b0 ? 1 - f : 0) + (b1 ? f : 0);
        const top = b0 && b1 ? lerp(b0.top, b1.top, f) : (b0 ?? b1)?.top ?? 0;
        const h = b0 && b1 ? lerp(b0.h, b1.h, f) : (b0 ?? b1)?.h ?? 0;
        const shown = f < 0.5 ? timeline.cues[a] : timeline.cues[a + 1];
        const nextPool = shown?.kind === 'line' && shown.rtl ? 'rtl' : 'ltr';
        if (nextPool !== pool) {
          pool = nextPool;
          stageRef.current?.parentElement?.setAttribute('data-pool', nextPool);
        }
        const opacity = (o * 0.95).toFixed(3);
        const visibility = o < 0.01 ? 'hidden' : 'visible';
        const transform = `translate3d(0, ${(top + h / 2 - glow / 2).toFixed(1)}px, 0)`;
        const plateKey = `${opacity}|${visibility}|${transform}`;
        if (plateKey !== lastPlate) {
          lastPlate = plateKey;
          p.style.opacity = opacity;
          p.style.visibility = visibility;
          p.style.transform = transform;
        }
        // The margin note shares this frame: its top is the active line's top. A seek lands both together.
        if (host && (b0 || b1)) {
          const y = `${(stageTop + top + 2).toFixed(1)}px`;
          if (y !== noteY) {
            noteY = y;
            host.style.setProperty('--note-y', y);
          }
        }
      }

      placedGen.current = measureGen.current;
      const owner = Math.max(-1, Math.min(timeline.cues.length - 1, Math.round(pos)));
      const scrubbing = !!host?.classList.contains('is-scrubbing');
      // A slot commit already spent this frame. The plates use the next one,
      // so the header waits one more and does not share that commit.
      if (heavyCommit && isPhone() && !scrubbing && owner !== ownerRef.current) {
        pendingOwner = owner;
        ownerWait = true;
      } else if (scrubbing) {
        // The note is held for the whole drag. Committing the header on every
        // cue stacked a React render on the lyric swap.
        if (owner !== ownerRef.current) pendingOwner = owner;
      } else if (owner !== ownerRef.current || pendingOwner != null) {
        if (ownerWait) {
          ownerWait = false;
        } else {
          const next = pendingOwner ?? owner;
          pendingOwner = null;
          if (next !== ownerRef.current) {
            ownerRef.current = next;
            if (bisect('react')) {
              /* the header and the note stay on the first line */
            } else if (isPhone()) {
              const comment = document.querySelector('.comment');
              // Portrait keeps the note in the card, and the margin note is not
              // shown. Forcing layout here to drop a WebKit layer made the
              // opening frame miss its interval.
              const portrait = window.innerHeight >= window.innerWidth;
              if (comment instanceof HTMLElement && !portrait) {
                comment.style.transform = 'none';
                comment.style.filter = 'none';
                void comment.offsetWidth;
              }
              flushSync(() => onOwnerChange(next));
            } else {
              onOwnerChange(next);
            }
          }
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
      dropDepart();
      const stageEl = stageRef.current;
      if (stageEl) {
        stageEl.style.opacity = '';
        stageEl.style.transform = '';
      }
    };
  }, [timeline, plan, clock, onOwnerChange, wordSync, entrance, motion]);

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

  return (
    <div className="scene" data-align={settings.textAlign} data-enter={entrance} style={phoneLyric}>
      <div ref={stageRef} className="scene-stage">
        <div ref={plate} className="flow-plate" aria-hidden style={{ visibility: 'hidden' }} />
        <div ref={liveView} className="scene-live">
        <div className="scene-view scene-view--lyric">
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
                  measureEpoch={layoutEpoch}
                />
              );
            })
          : null}
        {!isPhone() &&
          mounted.map((idx) => {
            if (idx === INTRO) return null;
            const c = timeline.cues[idx];
            if (!c || c.kind !== 'line') return null;
            return (
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
            );
          })}
        </div>
        <div className="scene-view scene-view--inst">
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
                  measureEpoch={layoutEpoch}
                />
              );
            })
          : null}
        {!isPhone() &&
          mounted.map((idx) => {
            if (idx === INTRO) return null;
            const c = timeline.cues[idx];
            if (!c || c.kind !== 'inst') return null;
            return (
              <InstBlock key={idx} cue={c} timeline={timeline} timed={wordSync} entrance={entrance} motion={motion} stage={stage} features={features} register={register} onPick={onPick} />
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
});
