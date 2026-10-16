/**
 * Lyrics flow, in the manner of Apple Music: the current line in the middle, the next lines below
 * (readable in advance), the previous line drifting up. Everything is a pure function of time, so a
 * seek or a pause always lands on a consistent frame.
 */
import type { Cue, Timeline } from '@/data/timeline';

/** A line becomes current this long before its first word, so the eye gets there first. */
export const LEAD = 0.7;
/** Duration of the move from one line to the next. */
export const MOVE = 0.55;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Continuous position in the cue list: 3 means cue 3 is current, 3.4 means we are 40 % of the way
 * from cue 3 to cue 4. Before the first cue it is −1 (title card on stage, first line waiting below).
 */
export function flowPosition(tl: Timeline, t: number): number {
  const cues = tl.cues;
  if (!cues.length) return -1;
  const i = tl.ownerAt(t + LEAD);
  if (i < 0) return -1;
  const begin = cues[i].start - LEAD;
  return i - 1 + easeInOut(clamp01((t - begin) / MOVE));
}

/** Visual state for a cue at distance d from the current position (d = index − position). */
export function blockState(d: number) {
  const a = Math.abs(d);
  let scale: number;
  if (a <= 1) scale = 1 - 0.42 * a;
  else scale = 0.58 - 0.04 * Math.min(1, a - 1);
  let opacity: number;
  if (d >= 0) opacity = d <= 1 ? 1 - 0.5 * d : d <= 2 ? 0.5 - 0.28 * (d - 1) : Math.max(0, 0.22 - 0.22 * (d - 2));
  else opacity = a <= 1 ? 1 - 0.72 * a : Math.max(0, 0.28 - 0.28 * (a - 1) * 1.6);
  const blur = d < 0 ? Math.min(3, a * 1.6) : d > 1 ? Math.min(2, (d - 1) * 1.4) : 0;
  /** Translation and transliteration belong to the current line only. */
  const sub = clamp01(1 - a * 1.8);
  return { scale, opacity, blur, sub };
}

export interface Measure {
  orig: number;
  sub: number;
}

const GAP = 22;

/**
 * Tops of the visible blocks for an integer anchor (the cue that is exactly current).
 * The current block is centred at `centerY`; the others stack below and above it.
 */
export function layoutAt(anchor: number, indices: number[], m: Map<number, Measure>, centerY: number) {
  const tops = new Map<number, number>();
  const h = (k: number) => {
    const mm = m.get(k) ?? { orig: 80, sub: 0 };
    const s = blockState(k - anchor);
    return mm.orig * s.scale + mm.sub * s.sub;
  };
  const cur = Math.max(indices[0], Math.min(indices[indices.length - 1], anchor));
  tops.set(cur, centerY - h(cur) / 2);
  for (let k = cur + 1; k <= indices[indices.length - 1]; k++) tops.set(k, tops.get(k - 1)! + h(k - 1) + GAP);
  for (let k = cur - 1; k >= indices[0]; k--) tops.set(k, tops.get(k + 1)! - GAP - h(k));
  return tops;
}

/** Cues worth mounting around the current position. */
export function windowAround(tl: Timeline, pos: number): number[] {
  const out: number[] = [];
  const from = Math.max(0, Math.floor(pos) - 1);
  const to = Math.min(tl.cues.length - 1, Math.floor(pos) + 3);
  for (let k = from; k <= to; k++) out.push(k);
  return out;
}

/** The instrumental card is on stage while its cue is current (with soft edges). */
export function instPresence(tl: Timeline, pos: number): { cue: Cue | null; presence: number } {
  const k = Math.round(pos);
  const cue = tl.cues[k];
  if (!cue || cue.kind !== 'inst') return { cue: null, presence: 0 };
  return { cue, presence: clamp01(1 - Math.abs(pos - k) * 2.2) };
}
