/**
 * Choreography: how each word enters, is sung and leaves. Every value is a pure function of time,
 * so scrubbing backwards, pausing mid-animation or jumping to a line always lands on the right frame.
 *
 * Two appearance families:
 *  - "line": the whole phrase appears (dim), words light up as they are sung (karaoke);
 *  - "word": each word arrives at the moment it is sung, then fills with ink.
 * Arabic-script lines never animate per letter or with letter-spacing (it breaks the joins);
 * they get word-level motion and a right-to-left ink reveal.
 */
import type { LineCue, ResolvedFx } from '@/data/timeline';
import type { MotionPref } from '@/app/settings';

export interface WordStyle {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rot: number;
  blur: number;
  /** Karaoke fill 0..1 in reading direction. */
  fill: number;
  /** Ink reveal 0..1 (mask) for the "ink" entrance; 1 = fully visible. */
  reveal: number;
  /** 0..1 accent glow while sung (emphasis words, bloom). */
  glow: number;
}

export interface LineStyle {
  opacity: number;
  y: number;
  scale: number;
  blur: number;
  /** Secondary layers (translation, transliteration). */
  sub: number;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
export const easeInCubic = (t: number) => t * t * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Under-damped spring settling at 1 (≈ iOS "bouncy" spring). */
export const spring = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6.2 * t) * Math.cos(8.4 * t));

/** Deterministic per-word pseudo-random in [−1, 1]. */
export function rand(seed: string, k: number) {
  let h = 2166136261 ^ k;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

interface PresetDef {
  appear: 'line' | 'word';
  /** Seconds before a word's start when it begins to arrive (word mode). */
  pre: number;
  /** Duration of a word's (or the line's) entrance. */
  enterDur: number;
  stagger: number;
  exitDur: number;
  enter(a: number, ctx: Ctx): Partial<WordStyle>;
  exit(x: number, ctx: Ctx): Partial<WordStyle>;
  active?(k: number, ctx: Ctx): Partial<WordStyle>;
  line?(a: number, x: number): Partial<LineStyle>;
}

interface Ctx {
  i: number;
  n: number;
  rtl: boolean;
  seed: string;
  em: boolean;
  /** Section energy 0..1 (0 when unknown). */
  energy: number;
}

const PRESETS: Record<ResolvedFx, PresetDef> = {
  rise: {
    appear: 'line',
    pre: 0,
    enterDur: 0.6,
    stagger: 0.035,
    exitDur: 0.5,
    enter: (a) => {
      const e = easeOutQuint(a);
      return { opacity: e, y: (1 - e) * 26, blur: (1 - e) * 6 };
    },
    exit: (x) => {
      const e = easeInCubic(x);
      return { opacity: 1 - e, y: -e * 30, blur: e * 8 };
    },
  },
  focus: {
    appear: 'line',
    pre: 0,
    enterDur: 0.75,
    stagger: 0,
    exitDur: 0.55,
    enter: () => ({}),
    exit: () => ({}),
    line: (a, x) => {
      const e = easeOutCubic(a);
      const o = easeInCubic(x);
      return { opacity: e * (1 - o), scale: 1.05 - 0.05 * e - 0.03 * o, blur: (1 - e) * 14 + o * 12 };
    },
  },
  ink: {
    appear: 'word',
    pre: 0.04,
    enterDur: 0.55,
    stagger: 0,
    exitDur: 0.6,
    enter: (a) => ({ reveal: easeInOut(a), opacity: 1 }),
    exit: (x) => {
      const e = easeInCubic(x);
      return { opacity: 1 - e, y: -e * 12, blur: e * 5 };
    },
  },
  assemble: {
    appear: 'word',
    pre: 0.6,
    enterDur: 0.62,
    stagger: 0,
    exitDur: 0.55,
    enter: (a, c) => {
      const e = easeOutCubic(a);
      const k = 1 - e;
      return {
        opacity: clamp01(a * 1.6),
        x: k * rand(c.seed, c.i * 3 + 1) * 90,
        y: k * rand(c.seed, c.i * 3 + 2) * 60,
        rot: k * rand(c.seed, c.i * 3 + 3) * 14,
        scale: 0.82 + 0.18 * e,
        blur: k * 8,
      };
    },
    exit: (x, c) => {
      const e = easeInCubic(x);
      return {
        opacity: 1 - e,
        x: e * rand(c.seed, c.i * 5 + 7) * 70,
        y: e * (-30 + rand(c.seed, c.i * 5 + 8) * 30),
        rot: e * rand(c.seed, c.i * 5 + 9) * 10,
        blur: e * 6,
      };
    },
  },
  drop: {
    appear: 'word',
    pre: 0.22,
    enterDur: 0.7,
    stagger: 0,
    exitDur: 0.5,
    enter: (a) => ({ opacity: clamp01(a * 3), y: (1 - spring(a)) * -48 }),
    exit: (x) => {
      const e = easeInCubic(x);
      return { opacity: 1 - e, y: e * 34, blur: e * 4 };
    },
  },
  bloom: {
    appear: 'word',
    pre: 0.16,
    enterDur: 0.6,
    stagger: 0,
    exitDur: 0.55,
    enter: (a) => ({ opacity: clamp01(a * 2.2), scale: 0.55 + 0.45 * spring(a), blur: (1 - easeOutCubic(a)) * 10 }),
    exit: (x) => {
      const e = easeInCubic(x);
      return { opacity: 1 - e, scale: 1 + e * 0.22, blur: e * 7 };
    },
    active: (k) => ({ glow: Math.sin(Math.PI * clamp01(k)) * 0.8 }),
  },
  cascade: {
    // Per-letter motion is handled in the view; at word level it behaves like a soft rise.
    appear: 'word',
    pre: 0.08,
    enterDur: 0.5,
    stagger: 0,
    exitDur: 0.5,
    enter: (a) => ({ opacity: clamp01(a * 4) }),
    exit: (x) => {
      const e = easeInCubic(x);
      return { opacity: 1 - e, y: e * 22, blur: e * 4 };
    },
  },
  spotlight: {
    appear: 'line',
    pre: 0,
    enterDur: 0.6,
    stagger: 0.02,
    exitDur: 0.5,
    enter: (a) => {
      const e = easeOutCubic(a);
      return { opacity: e, blur: (1 - e) * 5 };
    },
    exit: (x) => {
      const e = easeInCubic(x);
      return { opacity: 1 - e, blur: e * 8, y: -e * 10 };
    },
    active: (k) => {
      const s = Math.sin(Math.PI * clamp01(k));
      return { scale: 1 + 0.1 * s, y: -5 * s, glow: s * 0.6 };
    },
  },
  stack: {
    appear: 'word',
    pre: 0.24,
    enterDur: 0.55,
    stagger: 0,
    exitDur: 0.5,
    enter: (a, c) => {
      const e = easeOutQuint(a);
      const side = c.i % 2 === 0 ? -1 : 1;
      return { opacity: clamp01(a * 2), x: (1 - e) * side * 90 * (c.rtl ? -1 : 1), blur: (1 - e) * 6 };
    },
    exit: (x, c) => {
      const e = easeInCubic(x);
      const side = c.i % 2 === 0 ? 1 : -1;
      return { opacity: 1 - e, x: e * side * 70 * (c.rtl ? -1 : 1), blur: e * 6 };
    },
  },
  whisper: {
    appear: 'line',
    pre: 0,
    enterDur: 1.2,
    stagger: 0.06,
    exitDur: 0.9,
    enter: (a) => {
      const e = easeOutCubic(a);
      return { opacity: e * 0.95, blur: (1 - e) * 4 };
    },
    exit: (x) => ({ opacity: 1 - easeInOut(x) }),
  },
};

export function presetOf(fx: ResolvedFx) {
  return PRESETS[fx];
}

const BASE: WordStyle = { opacity: 1, x: 0, y: 0, scale: 1, rot: 0, blur: 0, fill: 0, reveal: 1, glow: 0 };

/**
 * Style of word i of a line at time t. `motion` = 'calm' keeps karaoke and soft fades only;
 * 'off' keeps karaoke only.
 */
export function wordStyleAt(cue: LineCue, i: number, t: number, motion: MotionPref, energy: number): WordStyle {
  const w = cue.line.words[i];
  const n = cue.line.words.length;
  const fx: ResolvedFx = motion === 'full' ? cue.fx : motion === 'calm' ? (cue.fx === 'whisper' ? 'whisper' : 'focus') : 'focus';
  const p = PRESETS[fx];
  const ctx: Ctx = { i, n, rtl: cue.rtl, seed: cue.line.id, em: !!w.em, energy };
  const style: WordStyle = { ...BASE };

  // Karaoke fill: linear through the word's duration.
  const dur = Math.max(0.08, w.e - w.s);
  const k = clamp01((t - w.s) / dur);
  style.fill = k;

  // Entrance
  let a: number;
  if (p.appear === 'line') {
    a = clamp01((t - cue.show - i * p.stagger) / p.enterDur);
  } else {
    const begin = w.s - p.pre;
    const len = fx === 'ink' ? Math.min(Math.max(dur, 0.25), p.enterDur) : p.enterDur;
    a = clamp01((t - begin) / len);
  }
  if (motion !== 'off') Object.assign(style, p.enter(a, ctx));
  else style.opacity = clamp01((t - cue.show) / 0.3);

  // While sung
  if (p.active && t >= w.s && t <= w.e + 0.15 && motion === 'full') Object.assign(style, p.active(k, ctx));
  if (w.em && t >= w.s) style.glow = Math.max(style.glow, 0.5 * Math.sin(Math.PI * Math.min(1, (t - w.s) / Math.max(0.6, dur * 1.4))));

  // Exit
  const exitStart = cue.hide - p.exitDur - (n - 1 - i) * 0;
  const x = clamp01((t - exitStart) / p.exitDur);
  if (x > 0) {
    if (motion !== 'off') {
      const ex = p.exit(x, ctx);
      // Exit composes with the settled entrance state.
      style.opacity = Math.min(style.opacity, ex.opacity ?? 1);
      style.x += ex.x ?? 0;
      style.y += ex.y ?? 0;
      style.rot += ex.rot ?? 0;
      style.blur = Math.max(style.blur, ex.blur ?? 0);
      if (ex.scale) style.scale *= ex.scale;
    } else {
      style.opacity = Math.min(style.opacity, 1 - x);
    }
  }
  return style;
}

export function lineStyleAt(cue: LineCue, t: number, motion: MotionPref): LineStyle {
  const fx: ResolvedFx = motion === 'full' ? cue.fx : 'focus';
  const p = PRESETS[fx];
  const a = clamp01((t - cue.show) / p.enterDur);
  const x = clamp01((t - (cue.hide - p.exitDur)) / p.exitDur);
  const base: LineStyle = { opacity: 1, y: 0, scale: 1, blur: 0, sub: 0 };
  if (p.line && motion !== 'off') Object.assign(base, p.line(a, x));
  else if (motion === 'off') base.opacity = clamp01((t - cue.show) / 0.3) * (1 - x);
  // Translation and transliteration: arrive a beat after the line, leave with it.
  const subIn = clamp01((t - cue.show - 0.18) / 0.5);
  base.sub = easeOutCubic(subIn) * (1 - easeInCubic(x));
  if (motion === 'off') base.blur = 0;
  return base;
}

/** For the per-letter cascade: style of letter j (of m) in a word that started at ws. */
export function letterStyleAt(j: number, m: number, t: number, wordStart: number, wordDur: number, exitX: number) {
  const span = Math.max(0.18, Math.min(0.9, wordDur));
  const begin = wordStart - 0.08 + (j / Math.max(1, m)) * span * 0.75;
  const a = clamp01((t - begin) / 0.32);
  const e = easeOutQuint(a);
  const out = easeInCubic(clamp01(exitX * 1.4 - (j / Math.max(1, m)) * 0.4));
  return { opacity: e * (1 - out), y: (1 - e) * 18 + out * 16, blur: (1 - e) * 3 };
}

/** Exit progress of a line at time t (0 before the exit starts). */
export function exitProgress(cue: LineCue, t: number, motion: MotionPref) {
  const fx: ResolvedFx = motion === 'full' ? cue.fx : 'focus';
  const p = PRESETS[fx];
  return clamp01((t - (cue.hide - p.exitDur)) / p.exitDur);
}
