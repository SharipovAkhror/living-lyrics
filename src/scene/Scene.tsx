import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import type { Song } from '@/data/schema';
import { commentFor, type Timeline } from '@/data/timeline';
import type { AudioFeatures } from '@/instruments/animation';
import { effectiveMotion, type Settings } from '@/app/settings';
import { showHarakatText } from '@/data/harakat';
import { fillQuery, lineWordSync, wordSyncOn } from './fill';
import { LineBlock, syncNoteFoot, type BlockUpdater } from './LineBlock';
import { InstBlock } from './InstBlock';
import { stageCovered, watchCover } from './cover';
import { bisect } from '@/app/bisect';
import { isPhone } from '@/ui/phone';
import { sceneProbeArmed } from './probe';
import { PHONE_INST_SLOTS, PHONE_LINE_SLOTS, assignSlots, generousLine, retargetPhoneLines, sameSlots, type PhoneSlot } from './slots';
import { GAP, WAIT_ROOM, blockHeight, blockState, clearBand, concealCut, compressStack, flowPosition, instPresence, keepInStage, layoutAt, lerp, planFlow, stackCompress, waitHint, windowAround, type Measure } from './flow';
import { stepSpring, type SpringState } from '@/ui/spring';

/** False in the Vercel production build, so `?ll-render-error=1` is compiled out. See vite.config.ts. */
declare const __SCENE_PROBE__: boolean | undefined;

/**
 * The stored 393×852 frame was laid out with the tighter column (gap 26, then
 * the settle entrance compresses it). Wider studio air stays on desktop,
 * landscape, and the short SE, which that check does not cover.
 */
/** Room for the one-line footnote between the current line and the next. */
const FOOT_ROOM = 40;

function columnGap() {
  if (typeof window === 'undefined' || !isPhone()) return GAP;
  // land-15 is 251 px of stage. The verse gap of 44 pushed the next line into the floor.
  if (window.matchMedia('(min-width: 800px) and (max-height: 640px)').matches) return 18;
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
  // A paused clock does not restyle. The feature file arrives later, and the
  // halo is part of that second, so the loop has to pose once more.
  const featureEpoch = useRef(0);
  const featureSeen = useRef(features);
  if (featureSeen.current !== features) {
    featureSeen.current = features;
    featureEpoch.current += 1;
  }
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
      // The extra fade used to start on the first step below 0 and left the title grey
      // on the frame the song opens (distance about −0.5). It leaves only once the card is off stage.
      const leave = d < -0.85 ? Math.max(0, Math.min(1, 1 + (d + 0.85) * 2.2)) : 1;
      // At t = 0 the card is already halfway to the first passage and used to sit in the header.
      // Hold it in the stage while it is still the picture. The fade above is when it may leave.
      const seated = isPhone() && leave >= 1 ? Math.max(8, top) : top;
      const transform = `translate3d(0, ${seated.toFixed(1)}px, 0)`;
      const opacity = (s.opacity * leave).toFixed(3);
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
    let footAt = 0;
    // A line with a note leaves the footnote's room under it.
    const notes = new Map<number, boolean>();
    const noted = (k: number) => {
      let hit = notes.get(k);
      if (hit == null) {
        hit = timeline.cues[k]?.kind === 'line' && !!commentFor(timeline, k);
        notes.set(k, hit);
      }
      return hit;
    };
    let lastPlate = '';
    let lastT = Number.NaN;
    let placedFeatures = featureEpoch.current;
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
    // One departing picture. A finger faster than one view per 250 ms swaps with no fade,
    // so the stage never holds an outgoing frame plus the next one plus another.
    // A dwell hands off in sequence: the outgoing picture leaves, then the next one
    // arrives. They do not share a frame above 0.05, and the gap is not an empty stage.
    const DWELL_MS = 250;
    // Sequential on the frame clock. WebKit blends a WAAPI hard cut, so the
    // two pictures are written here: one of them is at 0 on every sample.
    // A late frame snaps to the end instead of stretching the crossfade.
    const HANDOFF_MS = 90;
    let depart: HTMLElement | null = null;
    let handoffGen = 0;
    let handoffStart = 0;
    let viewKey = '';
    let viewAt = 0;
    const markHandoff = () => {
      if (!host) return;
      host.dataset.handoff = 'ok';
      host.dataset.handoffMs = String(HANDOFF_MS);
    };
    const dropDepart = () => {
      handoffGen += 1;
      handoffStart = 0;
      depart?.remove();
      depart = null;
      const live = liveView.current;
      if (live) {
        live.style.opacity = '';
        live.style.transform = '';
      }
    };
    // performance.now() follows a paused page clock, so a stepped scrub
    // advances this the same way a finger does.
    const paintHandoff = (now: number) => {
      if (!depart) return;
      const live = liveView.current;
      const elapsed = now - handoffStart;
      if (elapsed >= HANDOFF_MS) {
        markHandoff();
        dropDepart();
        return;
      }
      const first = elapsed < HANDOFF_MS / 2;
      depart.style.opacity = first ? '1' : '0';
      if (live) live.style.opacity = first ? '0' : '1';
    };
    const takeDepart = () => {
      const stageEl = stageRef.current;
      if (!stageEl || depart) return false;
      const linePicture = !!host?.classList.contains('is-scrub-line');
      const instPicture = !!host?.classList.contains('is-scrub-inst');
      const nodes = [...stageEl.querySelectorAll<HTMLElement>('.scene-live .fb')].filter((el) => {
        if (linePicture && el.classList.contains('fb--inst')) return false;
        if (instPicture && (el.classList.contains('fb--line') || el.classList.contains('fb--intro'))) return false;
        if (el.style.visibility === 'hidden') return false;
        const opacity = el.style.opacity === '' ? 1 : Number(el.style.opacity);
        return opacity >= 0.08 && hasLightPixels(el);
      });
      if (!nodes.length) return false;
      const layer = document.createElement('div');
      layer.className = 'scene-depart stage-view';
      layer.setAttribute('aria-hidden', 'true');
      for (const el of nodes) {
        const clone = cloneBlock(el);
        // The leave is opacity only. A scale on the clone would shrink the outgoing picture.
        clone.style.transform = clone.style.transform.replace(/scale3d\([^)]*\)|scale[XY]?\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
        layer.appendChild(clone);
      }
      stageEl.appendChild(layer);
      depart = layer;
      handoffStart = performance.now();
      layer.style.opacity = '1';
      const live = liveView.current;
      if (live) live.style.opacity = '0';
      const gen = ++handoffGen;
      // The flag is the schedule length, not how long this frame took to paint.
      window.setTimeout(() => {
        if (gen !== handoffGen || !host) return;
        markHandoff();
      }, HANDOFF_MS + 20);
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
    const QUIET_ART = ':host(.is-quiet) .ist-art{opacity:0 !important;visibility:hidden !important}';
    const quietArt = (stageEl: HTMLElement, hide: boolean) => {
      const live = stageEl.querySelector('.scene-live');
      if (!live) return;
      for (const mount of live.querySelectorAll<HTMLElement>('.ist-art-mount')) {
        const root = mount.shadowRoot;
        if (root && !root.querySelector('style[data-scrub-quiet]')) {
          const style = document.createElement('style');
          style.dataset.scrubQuiet = '1';
          style.textContent = QUIET_ART;
          root.appendChild(style);
        }
        mount.classList.toggle('is-quiet', hide);
      }
    };
    const applyScrubPicture = (kind: 'line' | 'inst' | 'intro') => {
      const stageEl = stageRef.current;
      if (!host || !stageEl || !isPhone()) return;
      const line = kind !== 'inst';
      host.classList.toggle('is-scrub-line', line);
      host.classList.toggle('is-scrub-inst', !line);
      quietArt(stageEl, line);
      const live = stageEl.querySelector('.scene-live');
      if (!live) return;
      // Inline priority, re-applied after the block updater. A stylesheet rule
      // would not fit the CSS budget, and the updater replaces a normal inline.
      for (const el of live.querySelectorAll<HTMLElement>('.fb--inst')) {
        if (!line) continue;
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      }
      for (const el of live.querySelectorAll<HTMLElement>('.fb--line, .fb--intro')) {
        if (line) continue;
        el.style.setProperty('opacity', '0', 'important');
      }
    };
    const clearScrubPicture = () => {
      if (!host) return;
      host.classList.remove('is-scrub-line', 'is-scrub-inst');
      const stageEl = stageRef.current;
      if (!stageEl) return;
      quietArt(stageEl, false);
      for (const el of stageEl.querySelectorAll<HTMLElement>('.scene-live .fb')) {
        if (el.style.getPropertyPriority('opacity') === 'important') el.style.removeProperty('opacity');
        if (el.style.getPropertyPriority('visibility') === 'important') el.style.removeProperty('visibility');
      }
    };
    let glow = Math.min(stageBox.current.h * 0.5, 380);
    let cachedW = stageBox.current.w;
    let cachedH = stageBox.current.h;
    let cachedTop = 0;
    if (plate.current) plate.current.style.height = `${glow.toFixed(1)}px`;
    const lineIds: number[] = [];
    for (let i = 0; i < timeline.cues.length; i++) {
      if (timeline.cues[i]?.kind === 'line') lineIds.push(i);
    }
    const loop = (frameTime?: number) => {
      raf = 0;
      if (stageCovered()) return;
      raf = requestAnimationFrame(loop);
      // Frame start, before this turn's layout. A clock read after the work
      // billed that work to the handoff and failed the 120 ms cap on a slow frame.
      const now = typeof frameTime === 'number' ? frameTime : performance.now();
      paintHandoff(now);
      let heavyCommit = false;
      const scrubbingNow = !!host?.classList.contains('is-scrubbing');
      let releasePaint = false;
      if (scrubWas && !scrubbingNow) {
        // The finger is up. Drop the fade in this frame so the picture matches a
        // direct seek, then let React catch the hosts the drag rewrote.
        releasePaint = true;
        dropDepart();
        veil = null;
        // The finger moved the clock. That is not a playback jump, so the veil
        // must not fade the settled picture. The detector below still sees the
        // time from before the drag unless this frame records where we landed.
        const landed = clock();
        veilClock = landed;
        veilKind = kindAt(landed);
        const stageEl = stageRef.current;
        if (stageEl) {
          stageEl.style.opacity = '';
          stageEl.style.transform = '';
        }
        clearScrubPicture();
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
      const featuresMoved = featureEpoch.current !== placedFeatures;
      if (isPhone() && !scrubbingNow && !depart && !releasePaint && !featuresMoved) {
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
      // The sheet scales the song with a transform. That box changes every
      // spring frame and is not a layout change, so the cached size stands.
      let liveW = cachedW;
      let liveH = cachedH;
      let liveTop = cachedTop;
      const sheetScale = parseFloat(document.documentElement.style.getPropertyValue('--sheet-p') || '0') > 0.02;
      if (!scrubbingNow && !sheetScale) {
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
      // The desk column grows only while the picture is an instrumental. One write per change.
      if (host) {
        const ownerNow = Math.round(flowPosition(plan, t));
        const instNow = ownerNow >= 0 && timeline.cues[ownerNow]?.kind === 'inst';
        if (host.classList.contains('is-inst') !== instNow) host.classList.toggle('is-inst', instNow);
      }
      // A paused clock used to restyle the stage anyway. WebKit kept that working set.
      // A new box still has to be placed: the first read can precede font load and
      // text-wrap balance, and the lyric would stay a line too high.
      const measuresMoved = measureGen.current !== placedGen.current;
      // The footnote's room under the current line is part of the placement.
      // The page says whether the phone footnote is in use (not which note: that is data).
      const footMode = !!host?.classList.contains('foot-mode');
      const liveKey = `${Math.round(liveW)}x${Math.round(liveH)}x${footMode ? 1 : 0}`;
      if (scrubbingNow && motion !== 'off') {
        const key = String(Math.round(flowPosition(plan, t)));
        if (!viewKey) {
          viewKey = key;
          viewAt = now;
        } else if (key !== viewKey) {
          const held = now - viewAt;
          // Faster than one view per dwell: drop any ghost and draw only the live picture.
          dropDepart();
          if (held >= DWELL_MS) takeDepart();
          viewKey = key;
          viewAt = now;
        }
      } else if (viewKey) {
        viewKey = '';
        viewAt = 0;
      }
      if (isPhone() && scrubbingNow) applyScrubPicture(kindAt(t));
      else if (host?.classList.contains('is-scrub-line') || host?.classList.contains('is-scrub-inst')) clearScrubPicture();
      // The mounted window waits for the finger to lift. Walking the next
      // window on every step missed a vsync: desktop scrub p95 was 33.3 (n 43)
      // while the pointer handlers themselves were under a millisecond.
      if (!isPhone() && scrubbingNow) {
        lastT = t;
        lastLive = liveKey;
        return;
      }
      if (t === lastT && !measuresMoved && !featuresMoved && liveKey === lastLive && pendingOwner == null && !depart) {
        // Fonts and the phone measure queue change the ink after the clock has
        // settled. Follow the painted line; do not keep the short layout slot.
        if (!scrubbingNow && now - footAt >= 100) {
          footAt = now;
          const painted = stageRef.current?.querySelector('.fb--line.is-current');
          if (painted instanceof HTMLElement) syncNoteFoot(painted);
        }
        return;
      }
      placedFeatures = featureEpoch.current;
      lastT = t;
      lastLive = liveKey;
      const pos = flowPosition(plan, t);
      const list = windowAround(timeline, pos, entrance);
      const key = list.join(',');
      if (key !== lastKey) {
        // A desktop drag used to flushSync the next window on every step.
        // Those commits were the doubled frames (33.4 ms, n 43). The landed
        // window commits once, on the frame the finger lifts.
        const deferDesk = !isPhone() && scrubbingNow;
        if (!deferDesk) lastKey = key;
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
        } else if (!deferDesk) {
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
        if (!b) continue;
        const cue = timeline.cues[k];
        // A phone drag does not remeasure. An unmeasured line used to be 72px
        // tall while its words stayed at full size, so the next line sat on them.
        if (scrubbingNow && cue?.kind === 'line') {
          const guess = generousLine(cue);
          measures.set(k, { ...b.m, main: Math.max(b.m.main, guess.main), sub: Math.max(b.m.sub, guess.sub) });
          continue;
        }
        // Same rule as the block's own picture. A mid-move height left the
        // absolute engraving hanging over the next caption.
        if (cue?.kind === 'inst' && b.m.full != null) {
          const span = instPresence(t, cue.start, cue.end, blockState(k - pos).presence);
          if (t >= cue.end) measures.set(k, { ...b.m, compact: 0, full: 0 });
          else if (span >= 1) measures.set(k, { ...b.m, compact: b.m.full, full: b.m.full });
          else measures.set(k, b.m);
        } else measures.set(k, b.m);
      }
      const a = Math.floor(pos);
      const f = pos - a;
      const deck = liveW >= 640 && liveH <= 420;
      // land-15. The deck centre left the next line past the floor, and clearBand
      // then parked it off the screen, so the lower half stayed empty.
      const roomyLandscape = isPhone() && liveW >= 800 && liveW > liveH;
      const shortStage = !roomyLandscape && liveH > 0 && liveH < 240;
      // Centre of the visible stage, not of a box that continues under the floor.
      // A short stage, and the wide landscape phone, keep the current line high
      // so the next line has the lower half.
      // Phone portrait holds the sung line in the upper part, as a reader's eye does;
      // the footnote and the receding lines take the room under it.
      const tallPhone = isPhone() && liveH > liveW;
      const centerY = liveH * (shortStage || roomyLandscape ? 0.32 : deck ? 0.46 : tallPhone ? 0.36 : 0.42);
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
      const pad = shortStage ? 2 : Math.max(28, liveH * 0.1);
      const stackAt = (anchor: number) => {
        const held = clampAnchor(anchor);
        const stacked = compressStack(layoutAt(anchor, list, measures, centerY, 8, room, gap), held, compress, heightsAt(anchor));
        // After the compression: the settle entrance must not squeeze the footnote's room.
        // A function of the anchor, so a seek and a release place the same frame.
        if (footMode && noted(held)) for (const [k, y] of stacked) if (k > held) stacked.set(k, y + FOOT_ROOM);
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
      const placed = concealCut(clearBand(blended, pos, bandH, liveH, liveTop, window.innerHeight, !roomyLandscape), pos, bandH, liveH, 32);
      // The engraving block is the whole column. Centring it at 0.42 left the top in the bar and the next line under the floor.
      if (liveW >= 840 && liveH >= 480) {
        const picture = Math.max(list[0] ?? 0, Math.min(list[list.length - 1] ?? 0, Math.round(pos)));
        if (timeline.cues[picture]?.kind === 'inst') {
          const h = bandH.get(picture) ?? 0;
          if (h > 0 && h <= liveH) placed.set(picture, Math.max(0, (liveH - h) / 2));
        }
      }
      for (const k of list) {
        const b = blocks.current.get(k);
        if (!b) continue;
        b.fn(t, k - pos, placed.get(k) ?? 0, waits.get(k) ?? 0);
      }
      if (isPhone() && scrubbingNow) applyScrubPicture(kindAt(t));
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
          // Phone writes the footnote from the line, after its transform.
          // iPad portrait is not on that path and still uses this box.
          if (!isPhone()) {
            const painted = stageRef.current?.querySelector('.fb--line.is-current');
            if (painted instanceof HTMLElement) syncNoteFoot(painted);
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
      clearScrubPicture();
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
          '--lyric-tr': `max(13px, calc(17 * 100dvh / 852 * ${settings.textScale}))`,
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
        <div ref={liveView} className="scene-live stage-view">
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
