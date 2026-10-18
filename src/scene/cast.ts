/**
 * Who is on the instrument stage at a playback time. Pure: the same inputs are the same cast,
 * so a seek paints the same plates. No DOM.
 *
 * Order follows `entries` by `at`. Without entries the section is split into equal slices,
 * one per key, and they are not shown all at the first instant. A narrow box keeps a single
 * large plate — the latest entrance — and lets the previous one fade in that same place.
 * A wider box reserves a place for everyone who will enter. A newcomer fades in there;
 * the others do not move. How many places are drawn is `castCap` (1, 4 or 8).
 * A passage whose keys are only `voice` and `choir` holds those engravings for the whole
 * section: no invented orchestra and no fake turn-taking.
 * An empty key list and no entries is an empty stage (applause). It is not ensemble.
 */
import type { MotionPref } from '@/app/settings';

export const NARROW_MAX = 560;
/** Below this stage width the scene shows at most four plates. Wider boxes may show eight. */
export const MEDIUM_MAX = 880;

/** Plates the scene may draw. The layout can still fold some into the chip when the box is short. */
export function castCap(boxWidth: number): number {
  if (boxWidth < NARROW_MAX) return 1;
  if (boxWidth < MEDIUM_MAX) return 4;
  return 8;
}

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
 * Plates to mount at `t`. `boxWidth` is the stage box in CSS px (the phone test is under `NARROW_MAX`).
 */
export function castAt(section: CastSection, t: number, boxWidth: number, motion: MotionPref = 'full'): CastMember[] {
  const spans = scheduleOf(section);
  if (!spans.length) return [];
  const { enter, lead, exit } = timings(motion);
  const narrow = boxWidth < NARROW_MAX;
  const fadeIn = (at: number) => smooth((t - (at - lead)) / enter);
  const fadeOut = (until: number) => smooth((until + exit * 0.15 - t) / exit);
  const alive = (s: Span) => t >= s.at - lead && t < s.until + exit;

  const voiceGroup = spans.every((s) => s.calm && s.at === spans[0].at && s.until === spans[0].until);
  if (voiceGroup) {
    const shown = narrow ? spans.slice(0, 1) : spans;
    const members = shown.map((s) => ({ ...s, presence: Math.min(fadeIn(s.at), fadeOut(s.until)), place: 'hero' as const }));
    // The phone drops an empty plate. A wide box keeps the roster, so the places do not jump.
    return narrow ? members.filter((m) => m.presence > 0.02) : members;
  }

  if (!narrow) {
    return spans
      .map((s) => ({ ...s, presence: Math.min(fadeIn(s.at), fadeOut(s.until)), place: 'hero' as const }))
      .sort((a, b) => {
        const as = a.source < 0 ? 1000 + a.at : a.source;
        const bs = b.source < 0 ? 1000 + b.at : b.source;
        return as - bs || a.at - b.at;
      });
  }

  const visible = spans.filter(alive);
  if (!visible.length) return [];
  const hero = visible.reduce((a, b) => (b.at >= a.at ? b : a));
  const heroP = Math.min(fadeIn(hero.at), fadeOut(hero.until));
  const members: CastMember[] = [];
  const prev = spans.filter((s) => s !== hero && s.at < hero.at).sort((a, b) => b.at - a.at)[0];
  const u = clamp01((t - (hero.at - lead)) / enter);
  // The previous plate only yields if it was still on stage when this one entered.
  if (prev && prev.until > hero.at - 0.08 && u < 1) {
    const echoP = (1 - smooth(u)) * fadeOut(prev.until);
    if (echoP > 0.02) members.push({ ...prev, presence: echoP, place: 'echo' });
  }
  if (heroP > 0.02) members.push({ ...hero, presence: heroP, place: 'hero' });
  return members;
}

export function castSignature(members: CastMember[]) {
  return members.map((m) => `${m.place}:${m.source}:${m.key}`).join('|');
}
