/**
 * Who is on the instrument stage at a playback time. Pure: the same inputs are the same cast,
 * so a seek paints the same plates. No DOM.
 *
 * Order of the plates is prominence: `instruments` first, then keys that exist only in
 * `entries`. The roster is capped (3 under 1000 CSS px, 4 on a wide box) and reserved for
 * the whole section, so a new entrance fades in its own place and a seek paints the same
 * frame. Presence is 0 before the entrance and after the exit; the slot stays.
 * A passage whose keys are only `voice` and `choir` holds those engravings for the whole
 * section: no invented orchestra and no fake turn-taking.
 * An empty key list and no entries is an empty stage (applause). It is not ensemble.
 */
import type { MotionPref } from '@/app/settings';
import { prominenceLimit } from '@/instruments/layout';

export const NARROW_MAX = 560;

export interface CastSection {
  start: number;
  end: number;
  instruments: string[];
  entries?: { key: string; at: number; until?: number }[];
}

export interface CastMember {
  key: string;
  /** Index into `instruments` for the performer line. −1 when the key exists only in `entries`. */
  source: number;
  /** Entrance, seconds. Passed to `driveAt` as the draw-in start. */
  at: number;
  /** When the plate has left. */
  until: number;
  /** 0…1 plate presence at the queried time, including the handoff. */
  presence: number;
  /**
   * `hero` is laid out. `echo` is the plate a narrow screen is replacing:
   * it is drawn in the hero's rectangle and only fades, so two captions never sit side by side.
   */
  place: 'hero' | 'echo';
  /** Voice or choir: breathe, don't strike. */
  calm: boolean;
}

const VOICE = new Set(['voice', 'choir']);

export function isVoiceKey(key: string) {
  return VOICE.has(key);
}

export function isVoicePassage(keys: string[]) {
  return keys.length > 0 && keys.every(isVoiceKey);
}

interface Span {
  key: string;
  source: number;
  at: number;
  until: number;
  calm: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Symmetric 0…1. Ease-out would make a crossfade lopsided. */
function smooth(v: number) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

/** Entrance schedule for the whole section, independent of the clock and the box. */
export function scheduleOf(section: CastSection): Span[] {
  if (!section.instruments.length && !(section.entries && section.entries.length)) return [];
  const keys = section.instruments.length ? section.instruments : ['ensemble'];
  const start = section.start;
  const end = Math.max(section.end, start + 0.05);
  const claim = () => {
    const used = new Set<number>();
    return (key: string) => {
      const i = keys.findIndex((k, j) => k === key && !used.has(j));
      if (i >= 0) used.add(i);
      return i;
    };
  };

  if (isVoicePassage(keys)) {
    return keys.map((key, source) => ({ key, source, at: start, until: end, calm: true }));
  }

  const entries = section.entries;
  if (entries?.length) {
    const take = claim();
    return [...entries]
      .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
      .map((e) => ({
        key: e.key,
        source: take(e.key),
        at: e.at,
        until: e.until != null && e.until > e.at ? Math.min(e.until, end) : end,
        calm: isVoiceKey(e.key),
      }));
  }

  const step = (end - start) / keys.length;
  return keys.map((key, source) => ({
    key,
    source,
    at: start + source * step,
    until: end,
    calm: isVoiceKey(key),
  }));
}

function timings(motion: MotionPref) {
  if (motion === 'off') return { enter: 0.04, lead: 0, exit: 0.04 };
  if (motion === 'calm') return { enter: 0.5, lead: 0.1, exit: 0.4 };
  return { enter: 0.74, lead: 0.16, exit: 0.5 };
}

/**
 * Plates to mount at `t`. `boxWidth` is the stage box in CSS px. The roster does not change with `t`.
 */
function byProminence(spans: Span[]) {
  return [...spans].sort((a, b) => {
    const as = a.source < 0 ? 1000 + a.at : a.source;
    const bs = b.source < 0 ? 1000 + b.at : b.source;
    return as - bs || a.at - b.at;
  });
}

export function castAt(section: CastSection, t: number, boxWidth: number, motion: MotionPref = 'full'): CastMember[] {
  const spans = byProminence(scheduleOf(section));
  if (!spans.length) return [];
  const { enter, lead, exit } = timings(motion);
  const fadeIn = (at: number) => smooth((t - (at - lead)) / enter);
  const fadeOut = (until: number) => smooth((until + exit * 0.15 - t) / exit);
  return spans.slice(0, prominenceLimit(boxWidth)).map((s) => ({
    ...s,
    presence: Math.min(fadeIn(s.at), fadeOut(s.until)),
    place: 'hero' as const,
  }));
}

export function castSignature(members: CastMember[]) {
  return members.map((m) => `${m.place}:${m.source}:${m.key}`).join('|');
}
