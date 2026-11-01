/**
 * Lyrics flow. The position of every block is a pure function of playback time, so a seek, a pause
 * or a slow device always lands on the same frame. Three entrances share that clock:
 * `flow` travels down the stage, `script` also slides along the writing direction,
 * `settle` keeps a short column and fades in place.
 */
import type { LineEntrance } from '@/app/settings';
import type { Timeline } from '@/data/timeline';

/** A line becomes current this long before its first word, so the eye gets there first. */
export const LEAD = 0.6;
/** An instrumental passage takes the stage a little before it starts. */
const INST_LEAD = 0.3;
const MOVE_MAX = 0.6;
const MOVE_MIN = 0.16;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/**
 * Ink of a line at distance `a` from the position.
 * The nearer line stays at full ink. Just past the handoff the other one
 * drops, so the two are equal only at |d| = 0.5 and neither spends the
 * move dim. Far lines fade out; a ghost over the title is not a second line.
 */
function inkAt(a: number): number {
  if (a <= 0.5) return 1;
  if (a <= 0.72) return lerp(1, 0.62, easeOut((a - 0.5) / 0.22));
  if (a <= 1) return lerp(0.62, 0.58, (a - 0.72) / 0.28);
  if (a <= 2.5) return lerp(0.58, 0.34, (a - 1) / 1.5);
  if (a <= 2.8) return lerp(0.34, 0, (a - 2.5) / 0.3);
  return 0;
}

export interface FlowPlan {
  /** When each cue starts to become current. Non-decreasing. */
  begins: number[];
  /** How long the move onto each cue takes; always ends before the next cue begins. */
  moves: number[];
}

export function planFlow(tl: Timeline, instant = false): FlowPlan {
  const begins: number[] = [];
  for (const c of tl.cues) {
    const b = c.start - (c.kind === 'inst' ? INST_LEAD : LEAD);
    begins.push(begins.length ? Math.max(b, begins[begins.length - 1] + 0.01) : b);
  }
  const moves = begins.map((b, i) => {
    if (instant) return 0.001;
    const room = (begins[i + 1] ?? Infinity) - b;
    return Math.min(MOVE_MAX, Math.max(Math.min(MOVE_MIN, room * 0.9), room * 0.85));
  });
  return { begins, moves };
}

/**
 * Continuous position in the cue list: 3 means cue 3 is current, 3.4 means we are 40 % of the way
 * from cue 3 to cue 4. Before the first cue it is −1 (title card on stage, first line waiting below).
 */
export function flowPosition(plan: FlowPlan, t: number): number {
  const { begins, moves } = plan;
  let lo = 0;
  let hi = begins.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (begins[mid] <= t) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (i < 0) return -1;
  return i - 1 + easeInOut(clamp01((t - begins[i]) / moves[i]));
}

/** Size of the nearest non-current line. The current line is the only large object; the ones after it step down. */
export const SMALL = 0.58;
/** Size once a line is two steps away. Still present, no longer a second verse. */
const FAR = 0.44;

/**
 * How much of an instrumental passage is the picture.
 * Before `start` the flow eases it in. Once the passage has started it is fully
 * on stage, and once it has ended it leaves. A move that straddles `start`
 * used to freeze both captions on the shared boundary.
 */
export function instPresence(t: number, start: number, end: number, flow: number): number {
  if (t >= end) return 0;
  if (t >= start) return 1;
  return flow;
}

/** Visual state of a block at distance d from the current position (d = index − position). */
export function blockState(d: number) {
  const a = Math.abs(d);
  // Full size while this line holds the accent. It shrinks only after the
  // accent has moved, and it has the neighbour's size by the next integer.
  // Both lines are full size only at the single point |d| = 0.5.
  const scale = a >= 2 ? FAR : a >= 1 ? lerp(SMALL, FAR, a - 1) : a <= 0.5 ? 1 : lerp(1, SMALL, (a - 0.5) / 0.5);
  const opacity = inkAt(a);
  const blur = a < 1.15 ? 0 : d < 0 ? Math.min(1.6, (a - 1.15) * 1.4) : Math.min(1, (a - 1.15) * 0.8);
  // The translation stays with the accent and leaves with it, not while the line is still being read.
  const sub = a <= 0.5 ? 1 : a <= 0.9 ? lerp(1, 0, (a - 0.5) / 0.4) : 0;
  /** Share of the translation's height the layout reserves (it fades inside that room). */
  const subRoom = a <= 0.5 ? 1 : a <= 1.05 ? lerp(1, 0, (a - 0.5) / 0.55) : 0;
  /** Instrument blocks: 1 = full stage, 0 = the compact "next" chip. */
  const presence = clamp01(1 - a);
  return { scale, opacity, blur, sub, subRoom, presence };
}

export interface Measure {
  /** Height of the line block at scale 1, without the translation. */
  main: number;
  /** Height of the translation and transliteration. */
  sub: number;
  /** Instrument blocks: compact and full heights (main/sub unused). */
  compact?: number;
  full?: number;
}

/** Space between clusters. The translation sits inside its line, so this gap is the verse break. */
export const GAP = 44;

export function blockHeight(m: Measure | undefined, d: number) {
  const s = blockState(d);
  if (!m) return 80 * s.scale;
  if (m.full != null) return lerp(m.compact ?? 56, m.full, s.presence);
  return m.main * s.scale + m.sub * s.subRoom * s.scale;
}

/**
 * Top of the line being read. It does not depend on the line's height:
 * centring a taller line used to lift the words the reader was already on.
 */
export function readingTop(centerY: number, minTop: number): number {
  return Math.max(minTop, Math.min(centerY * 0.72, centerY - 24));
}

/**
 * Tops of the blocks when `anchor` is exactly current.
 * A lyric line is pinned by its top (`pinTop`): the centre used to move
 * that top whenever the line's height changed. An engraving stays centred.
 */
export function layoutAt(anchor: number, indices: number[], m: Map<number, Measure>, centerY: number, minTop: number, room: (k: number) => number = () => 0, gap = GAP, pinTop = false) {
  const tops = new Map<number, number>();
  if (!indices.length) return tops;
  const first = indices[0];
  const last = indices[indices.length - 1];
  const cur = Math.max(first, Math.min(last, anchor));
  const h = (k: number) => blockHeight(m.get(k), k - anchor);
  tops.set(cur, pinTop ? readingTop(centerY, minTop) : Math.max(minTop, centerY - h(cur) / 2));
  for (let k = cur + 1; k <= last; k++) tops.set(k, tops.get(k - 1)! + h(k - 1) + gap + room(k));
  for (let k = cur - 1; k >= first; k--) tops.set(k, tops.get(k + 1)! - gap - room(k + 1) - h(k));
  return tops;
}

/**
 * Pull a stack up so the anchor block ends inside the stage.
 * A line centred in a box that runs under the dock was cut by the floor.
 * The top of the anchor never goes above 8 px. Returns the same map when it already fits.
 */
export function keepInStage(tops: Map<number, number>, anchor: number, height: number, stageH: number, pad = 16): Map<number, number> {
  const top = tops.get(anchor);
  if (top == null || !(stageH > 0) || !(height > 0)) return tops;
  const overflow = top + height - (stageH - pad);
  if (overflow <= 0) return tops;
  const shift = Math.min(overflow, Math.max(0, top - 8));
  if (shift <= 0) return tops;
  const out = new Map<number, number>();
  for (const [k, y] of tops) out.set(k, y - shift);
  return out;
}

/**
 * On a short stage the verse gap parks the previous compact block (a section
 * kicker) above the stage, where the status pill sits. Seat that neighbour
 * back inside when the anchor can move down, and park any block that still
 * crosses the pill or the floor note off the viewport. Tall stages are unchanged.
 */
export function clearBand(
  tops: Map<number, number>,
  pos: number,
  heights: Map<number, number>,
  stageH: number,
  stageTop: number,
  viewH: number,
  parkOverflow = true,
): Map<number, number> {
  if (!(stageH > 0) || stageH >= 280 || tops.size === 0) return tops;
  const out = new Map(tops);
  let held = 0;
  let best = Infinity;
  for (const k of out.keys()) {
    const d = Math.abs(k - pos);
    if (d < best) {
      best = d;
      held = k;
    }
  }
  const heldH = heights.get(held) ?? 0;
  let heldTop = out.get(held) ?? 0;
  const floor = stageH - 12;
  let above: number | null = null;
  for (const k of out.keys()) {
    if (k < held && (above == null || k > above)) above = k;
  }
  if (above != null) {
    const aboveH = heights.get(above) ?? 0;
    const aboveTop = out.get(above) ?? 0;
    // Only a compact neighbour (the section kicker). A full line stays on the stack.
    if (aboveTop < 0 && aboveH > 0 && aboveH <= 72) {
      const gap = 8;
      const wantHeld = 8 + aboveH + gap;
      const delta = wantHeld - heldTop;
      if (delta <= 0) out.set(above, heldTop - gap - aboveH);
      else if (heldTop + delta + heldH <= floor) {
        for (const [k, y] of out) {
          if (k === above) out.set(k, 8);
          else if (y >= heldTop - 0.5) out.set(k, y + delta);
        }
        heldTop += delta;
      } else out.set(above, -stageTop - aboveH - 8);
    }
  }
  const belowAt = viewH - stageTop + 8;
  for (const [k, y] of [...out]) {
    if (k === held) continue;
    const h = heights.get(k) ?? 0;
    const top = out.get(k) ?? y;
    // The floor note starts about 40 px under the stage. A block past that band covers it.
    // A wide landscape phone opts out: that band is the lower half, and the next line belongs there.
    if (parkOverflow && top > heldTop && top + h > stageH + 32) out.set(k, belowAt);
    else if (top < -6) out.set(k, -stageTop - h - 8);
  }
  return out;
}

/**
 * A block the stage would cut is parked fully outside. The current block stays:
 * the caller seats it. `mask` is the top fade; a line in that fade is cut too.
 * Tall stages used to return the stack unchanged, and the next line left letter tops.
 */
export function concealCut(
  tops: Map<number, number>,
  pos: number,
  heights: Map<number, number>,
  stageH: number,
  mask = 32,
): Map<number, number> {
  if (!(stageH > 0) || tops.size === 0) return tops;
  let held = 0;
  let best = Infinity;
  for (const k of tops.keys()) {
    const d = Math.abs(k - pos);
    if (d < best) {
      best = d;
      held = k;
    }
  }
  const out = new Map(tops);
  for (const [k, y] of tops) {
    if (k === held) continue;
    const h = heights.get(k) ?? 0;
    if (!(h > 1)) continue;
    const bottom = y + h;
    if (bottom <= 0.5 || y >= stageH - 0.5) continue;
    if (y >= mask - 0.5 && bottom <= stageH + 0.5) continue;
    out.set(k, y + h * 0.5 < stageH * 0.5 ? -h - 16 : stageH + 16);
  }
  return out;
}

/** Extra space above a block for the "next line in N s" hint. */
export const WAIT_ROOM = 24;

/**
 * Visibility (0…1) of the waiting hint above cue k: shown while the previous line is over and this
 * line is still more than 4 s away. Smooth in time, so the layout never jumps.
 */
export function waitHint(tl: Timeline, k: number, t: number) {
  const c = tl.cues[k];
  const prev = tl.cues[k - 1];
  if (!c || c.kind !== 'line') return 0;
  const sinceEnd = prev ? t - prev.end : t;
  const until = c.start - t;
  return clamp01(Math.min(sinceEnd - 0.4, until - 4) / 0.5);
}

/** Cues worth mounting around the current position (−1 is the title card). */
export function windowAround(tl: Timeline, pos: number, entrance: LineEntrance = 'flow'): number[] {
  const out: number[] = [];
  const base = Math.floor(pos);
  // Flow previews the lines still coming. The other entrances keep a short column: previous, current, next.
  const ahead = entrance === 'flow' ? 5 : 2;
  for (let k = Math.max(-1, base - 1); k <= Math.min(tl.cues.length - 1, base + ahead); k++) out.push(k);
  return out;
}

/** How much of the full vertical travel an entrance keeps. 1 is the long flow down the stage. */
export function stackCompress(entrance: LineEntrance): number {
  if (entrance === 'flow') return 1;
  if (entrance === 'script') return 0.72;
  return 0.56;
}

/**
 * Shorten the gaps around the anchor so a softer entrance does not march the whole way down the stage.
 * The anchor block itself keeps its height: neighbours are pulled toward its edges, never into it.
 * `compress` is 1 for the untouched stack. A missing anchor or missing heights leaves the stack alone.
 */
export function compressStack(tops: Map<number, number>, anchor: number, compress: number, heights?: Map<number, number>) {
  if (compress >= 0.999) return tops;
  const at = tops.get(anchor);
  if (!heights || at == null || !heights.has(anchor)) return tops;
  const anchorH = heights.get(anchor)!;
  const keys = [...tops.keys()].sort((a, b) => a - b);
  const out = new Map(tops);
  // Walk outward so each gap shrinks against its neighbour, not through it.
  let prevKey = anchor;
  let prevBottom = at + anchorH;
  for (const k of keys) {
    if (k <= anchor) continue;
    const prevTop = tops.get(prevKey)!;
    const prevH = prevKey === anchor ? anchorH : (heights.get(prevKey) ?? 0);
    const gap = tops.get(k)! - (prevTop + prevH);
    const kept = gap > 0 ? Math.max(12, gap * compress) : 12;
    const next = prevBottom + kept;
    out.set(k, next);
    prevBottom = next + (heights.get(k) ?? 0);
    prevKey = k;
  }
  prevKey = anchor;
  let prevTopEdge = at;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (k >= anchor) continue;
    const h = heights.get(k) ?? 0;
    const belowTop = tops.get(prevKey)!;
    const gap = belowTop - (tops.get(k)! + h);
    const kept = gap > 0 ? Math.max(12, gap * compress) : 12;
    const next = prevTopEdge - h - kept;
    out.set(k, next);
    prevTopEdge = next;
    prevKey = k;
  }
  return out;
}

/**
 * Horizontal offset in CSS pixels. Positive is to the right.
 * An upcoming line (d > 0) waits on the start side of the writing direction and reaches 0 when current.
 * Latin and Cyrillic start on the left. Arabic script starts on the right.
 * Reduced motion leaves the line where it is read. `d` comes from the flow position, so a seek matches.
 */
export function scriptShift(d: number, rtl: boolean, stageW: number, motionOff: boolean): number {
  if (motionOff) return 0;
  const travel = Math.min(240, Math.max(88, stageW * 0.38));
  const clamped = Math.max(-1.35, Math.min(1.35, d));
  return (rtl ? 1 : -1) * travel * clamped;
}

/**
 * How far the column has scrolled between the two stacks around `pos`.
 * The line that holds the accent does not move: the next line arrives
 * before the handoff, and the line that lost the accent leaves after it.
 * Leaving the title, the first line is already on its anchor.
 */
export function handoffBlend(pos: number, indices: number[], topsA: Map<number, number>, topsB: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  const a = Math.floor(pos);
  const f = pos - a;
  if (a < 0) {
    for (const k of indices) out.set(k, (k >= 0 ? topsB : topsA).get(k) ?? 0);
    return out;
  }
  const u = f <= 0.5 ? easeInOut(clamp01(f / 0.5)) : easeInOut(clamp01((f - 0.5) / 0.5));
  for (const k of indices) {
    const from = topsA.get(k) ?? 0;
    const to = topsB.get(k) ?? 0;
    if (f <= 0.5) out.set(k, k <= a ? from : lerp(from, to, u));
    else out.set(k, k >= a + 1 ? to : lerp(from, to, u));
  }
  return out;
}

/**
 * Distance for the first line while the title still holds the stage.
 * The line is already on the anchor; this only fades it. At and after
 * −0.55 it matches the real distance, so the handoff does not jump.
 * Returns null once the real distance should be used.
 */
export function introLineDistance(pos: number): number | null {
  if (pos >= -0.55) return null;
  const u = clamp01((pos + 1) / 0.45);
  return lerp(3.2, 0.55, easeInOut(u));
}

/**
 * Opacity for the short column. Flow keeps the wider preview curve from `blockState`.
 * Still a function of distance, which is a function of time.
 */
export function entranceOpacity(d: number, entrance: LineEntrance, flowOpacity: number): number {
  if (entrance === 'flow') return flowOpacity;
  return inkAt(Math.abs(d));
}
