/**
 * Lyrics flow, in the manner of Apple Music: the current line large in the upper third, the next
 * lines below it (readable before they are sung), the previous line drifting up. Everything here is
 * a pure function of time, so a seek, a pause or a slow device always lands on a consistent frame.
 */
import type { Timeline } from '@/data/timeline';

/** A line becomes current this long before its first word, so the eye gets there first. */
export const LEAD = 0.6;
/** An instrumental passage takes the stage a little before it starts. */
const INST_LEAD = 0.3;
const MOVE_MAX = 0.6;
const MOVE_MIN = 0.16;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

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

/** Size of a non-current line relative to the current one. */
export const SMALL = 0.62;

/** Visual state of a block at distance d from the current position (d = index − position). */
export function blockState(d: number) {
  const a = Math.abs(d);
  const scale = a >= 1 ? SMALL : 1 - (1 - SMALL) * a;
  let opacity: number;
  if (d >= 0) opacity = d <= 1 ? 1 : d <= 3 ? 1 - 0.3 * (d - 1) : Math.max(0, 0.4 - 0.4 * (d - 3));
  else opacity = a <= 1 ? 1 - 0.6 * a : Math.max(0, 0.4 - 0.4 * (a - 1));
  const blur = d < -0.3 ? Math.min(2, (a - 0.3) * 2) : d > 1.3 ? Math.min(1.2, (d - 1.3) * 1.2) : 0;
  /** Translation: full for the current line, readable for the next one, gone for the rest. */
  const sub = d >= 0 ? (d <= 1 ? 1 - 0.4 * d : Math.max(0, 0.6 * (2 - d))) : clamp01(1 + d * 1.6);
  /** Share of the translation's height the layout reserves (it fades inside that room). */
  const subRoom = d >= 0 ? clamp01(2 - d) : clamp01(1 + d);
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

export const GAP = 26;

export function blockHeight(m: Measure | undefined, d: number) {
  const s = blockState(d);
  if (!m) return 80 * s.scale;
  if (m.full != null) return lerp(m.compact ?? 56, m.full, s.presence);
  return m.main * s.scale + m.sub * s.subRoom * s.scale;
}

/**
 * Tops of the blocks when `anchor` is exactly current: the current block's centre sits at
 * `centerY` (but never above `minTop`); the others stack below and above it.
 */
export function layoutAt(anchor: number, indices: number[], m: Map<number, Measure>, centerY: number, minTop: number, room: (k: number) => number = () => 0) {
  const tops = new Map<number, number>();
  if (!indices.length) return tops;
  const first = indices[0];
  const last = indices[indices.length - 1];
  const cur = Math.max(first, Math.min(last, anchor));
  const h = (k: number) => blockHeight(m.get(k), k - anchor);
  tops.set(cur, Math.max(minTop, centerY - h(cur) / 2));
  for (let k = cur + 1; k <= last; k++) tops.set(k, tops.get(k - 1)! + h(k - 1) + GAP + room(k));
  for (let k = cur - 1; k >= first; k--) tops.set(k, tops.get(k + 1)! - GAP - room(k + 1) - h(k));
  return tops;
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
export function windowAround(tl: Timeline, pos: number): number[] {
  const out: number[] = [];
  const base = Math.floor(pos);
  for (let k = Math.max(-1, base - 1); k <= Math.min(tl.cues.length - 1, base + 5); k++) out.push(k);
  return out;
}
