/**
 * Turns lyrics.json into a list of cues the Scene can render: when each line or instrumental
 * section appears, holds and leaves. Everything here is a pure function of the data,
 * so seeking backwards renders exactly like playing forwards.
 */
import type { Fx, InstrumentalSection, Line, Lyrics, Peaks, VocalSection } from './schema';

export type ResolvedFx = Exclude<Fx, 'auto'>;

export interface LineCue {
  kind: 'line';
  idx: number;
  line: Line;
  section: VocalSection;
  /** First word start / last word end (seconds). */
  start: number;
  end: number;
  /** When the line becomes visible and when it has fully left. */
  show: number;
  hide: number;
  fx: ResolvedFx;
  rtl: boolean;
  /** Number of the line inside the song, 1-based (for the text list). */
  n: number;
}

export interface InstCue {
  kind: 'inst';
  idx: number;
  section: InstrumentalSection;
  start: number;
  end: number;
  show: number;
  hide: number;
}

export type Cue = LineCue | InstCue;

export interface Timeline {
  cues: Cue[];
  lines: LineCue[];
  duration: number;
  /** Index of the cue that "owns" time t (latest cue whose start ≤ t), or −1 before the first. */
  ownerAt(t: number): number;
  /** Cues visible at time t (at most two during a crossover). */
  visibleAt(t: number): Cue[];
  energyAt(t: number): number;
}

const HOLD_MAX = 4.2; // a line stays at most this long after its last word
const EXIT = 0.55;

const RTL_SCRIPTS = new Set(['Arab']);

/** Entrance families. Calm ones suit slow, sparse passages; lively ones suit dense or loud passages. */
const CALM: ResolvedFx[] = ['focus', 'ink', 'rise', 'whisper', 'spotlight'];
const LIVELY: ResolvedFx[] = ['assemble', 'drop', 'bloom', 'cascade', 'stack', 'rise'];
const RTL_UNSAFE = new Set<ResolvedFx>(['cascade', 'whisper']);

export function leadFor(fx: ResolvedFx) {
  switch (fx) {
    case 'focus':
    case 'rise':
    case 'spotlight':
    case 'whisper':
      return 0.55;
    case 'assemble':
      return 0.7;
    default:
      return 0.35;
  }
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function lineText(line: Line) {
  return line.words.map((w) => w.w).join(' ');
}

function meanEnergy(peaks: Peaks | null, a: number, b: number) {
  if (!peaks) return -1;
  const i0 = Math.max(0, Math.floor(a * peaks.rate));
  const i1 = Math.min(peaks.rms.length, Math.ceil(b * peaks.rate));
  if (i1 <= i0) return -1;
  let s = 0;
  for (let i = i0; i < i1; i++) s += peaks.rms[i];
  return s / (i1 - i0);
}

function pickFx(line: Line, rtl: boolean, prev: ResolvedFx | null, energy: number, wordsPerSec: number): ResolvedFx {
  if (line.fx && line.fx !== 'auto') {
    return rtl && RTL_UNSAFE.has(line.fx) ? 'rise' : line.fx;
  }
  const text = lineText(line);
  const lively = energy >= 0 ? energy > 0.42 : wordsPerSec > 2.2;
  let pool = (lively ? LIVELY : CALM).filter((f) => !(rtl && RTL_UNSAFE.has(f)));
  // Vertical stacks only read well for short phrases.
  if (line.words.length > 4 || text.length > 30) pool = pool.filter((f) => f !== 'stack');
  // Per-letter cascade needs time per word to be legible.
  if (wordsPerSec > 3) pool = pool.filter((f) => f !== 'cascade');
  const candidates = pool.filter((f) => f !== prev);
  const list = candidates.length ? candidates : pool;
  return list[hash(line.id + text) % list.length];
}

export function buildTimeline(lyrics: Lyrics, duration: number, peaks: Peaks | null = null): Timeline {
  type Draft = { kind: 'line'; line: Line; section: VocalSection } | { kind: 'inst'; section: InstrumentalSection };
  const drafts: Draft[] = [];
  for (const section of lyrics.sections) {
    if (section.kind === 'instrumental') drafts.push({ kind: 'inst', section });
    else for (const line of section.lines) drafts.push({ kind: 'line', line, section });
  }

  const startOf = (d: Draft) => (d.kind === 'inst' ? d.section.start : d.line.words[0].s);
  drafts.sort((a, b) => startOf(a) - startOf(b));

  const cues: Cue[] = [];
  let prevFx: ResolvedFx | null = null;
  let n = 0;
  drafts.forEach((d, idx) => {
    if (d.kind === 'inst') {
      cues.push({ kind: 'inst', idx, section: d.section, start: d.section.start, end: d.section.end, show: d.section.start, hide: d.section.end });
      prevFx = null;
      return;
    }
    const start = d.line.words[0].s;
    const end = d.line.words.at(-1)!.e;
    const rtl = RTL_SCRIPTS.has(d.line.script);
    const span = Math.max(0.5, end - start);
    const fx = pickFx(d.line, rtl, prevFx, meanEnergy(peaks, start, end), d.line.words.length / span);
    prevFx = fx;
    n += 1;
    cues.push({ kind: 'line', idx, line: d.line, section: d.section, start, end, show: start - leadFor(fx), hide: end, fx, rtl, n });
  });

  // Hide times depend on the next cue: the outgoing line starts leaving as the next one arrives.
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.kind !== 'line') continue;
    const next = cues[i + 1];
    if (!next) {
      c.hide = c.end + HOLD_MAX;
      continue;
    }
    const arrival = next.show;
    c.hide = Math.min(Math.max(c.end + 0.35, arrival + EXIT * 0.6), c.end + HOLD_MAX);
    if (next.kind === 'inst') c.hide = Math.min(c.hide, next.start + EXIT);
  }

  const lines = cues.filter((c): c is LineCue => c.kind === 'line');
  const starts = cues.map((c) => c.start);

  function ownerAt(t: number) {
    let lo = 0;
    let hi = starts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  function visibleAt(t: number) {
    const out: Cue[] = [];
    const o = Math.max(0, ownerAt(t + 1.5));
    for (let i = Math.max(0, o - 3); i <= Math.min(cues.length - 1, o + 2); i++) {
      const c = cues[i];
      if (t >= c.show && t < c.hide) out.push(c);
    }
    return out;
  }

  function energyAt(t: number) {
    if (!peaks) return 0;
    const i = Math.floor(t * peaks.rate);
    return peaks.rms[Math.max(0, Math.min(peaks.rms.length - 1, i))] ?? 0;
  }

  return { cues, lines, duration, ownerAt, visibleAt, energyAt };
}

/** The commentary that applies at a cue: its own, else the latest earlier line in the same section, else the section's. */
export function sharhFor(timeline: Timeline, cueIdx: number): { text: string; from: Cue } | null {
  const cue = timeline.cues[cueIdx];
  if (!cue) return null;
  if (cue.kind === 'inst') return cue.section.sharh ? { text: cue.section.sharh, from: cue } : null;
  for (let i = cueIdx; i >= 0; i--) {
    const c = timeline.cues[i];
    if (c.kind !== 'line' || c.section.id !== cue.section.id) break;
    if (c.line.sharh) return { text: c.line.sharh, from: c };
  }
  return cue.section.sharh ? { text: cue.section.sharh, from: cue } : null;
}
