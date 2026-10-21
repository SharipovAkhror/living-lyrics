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

/** Size of a non-current line relative to the current one. Close enough to read, clearly smaller than the line in the light. */
export const SMALL = 0.78;

/** Visual state of a block at distance d from the current position (d = index − position). */
export function blockState(d: number) {
  const a = Math.abs(d);
  const scale = a >= 1 ? SMALL : 1 - (1 - SMALL) * a;
  // Neighbours stay readable and secondary. The floor stays at half so a pastel field cannot wash them out.
  let opacity: number;
  if (d >= 0) opacity = d <= 1 ? 1 : d <= 3 ? 1 - 0.16 * (d - 1) : Math.max(0.5, 0.68 - 0.05 * (d - 3));
  else opacity = a <= 1 ? 1 - 0.22 * a : Math.max(0.5, 0.78 - 0.08 * (a - 1));
  const blur = a < 1.15 ? 0 : d < 0 ? Math.min(1.6, (a - 1.15) * 1.4) : Math.min(1, (a - 1.15) * 0.8);
  // The translation belongs to its line. The current cluster and the nearest neighbours keep it;
  // lines further down the stage show the original only, so the column does not become a wall of glosses.
  const sub = a <= 0.2 ? 1 : a <= 1.25 ? lerp(1, 0.72, (a - 0.2) / 1.05) : 0;
  /** Share of the translation's height the layout reserves (it fades inside that room). */
  const subRoom = a <= 1.3 ? 1 : 0;
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
 * Tops of the blocks when `anchor` is exactly current: the current block's centre sits at
 * `centerY` (but never above `minTop`); the others stack below and above it.
 */
export function layoutAt(anchor: number, indices: number[], m: Map<number, Measure>, centerY: number, minTop: number, room: (k: number) => number = () => 0, gap = GAP) {
  const tops = new Map<number, number>();
  if (!indices.length) return tops;
  const first = indices[0];
  const last = indices[indices.length - 1];
  const cur = Math.max(first, Math.min(last, anchor));
  const h = (k: number) => blockHeight(m.get(k), k - anchor);
  tops.set(cur, Math.max(minTop, centerY - h(cur) / 2));
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
 * Opacity for the short column. Flow keeps the wider preview curve from `blockState`.
 * Still a function of distance, which is a function of time.
 */
export function entranceOpacity(d: number, entrance: LineEntrance, flowOpacity: number): number {
  if (entrance === 'flow') return flowOpacity;
  const a = Math.abs(d);
  // Settle: the current line is the light. The lines beside it stay readable, the ones further back step down, none of them vanish.
  if (entrance === 'settle') {
    if (a <= 0.28) return 1;
    if (a <= 1.15) return lerp(1, 0.72, (a - 0.28) / 0.87);
    return Math.max(0.55, 0.72 - 0.08 * (a - 1.15));
  }
  // Script: the line travelling in from the writing side stays readable until it arrives.
  if (a <= 0.35) return 1;
  if (a <= 1.05) return 0.62 + 0.38 * (1 - (a - 0.35) / 0.7);
  return Math.max(0.5, 0.62 - 0.08 * (a - 1.05));
}
