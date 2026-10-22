/**
 * Who is on the instrument stage at a playback time. Pure: the same inputs are the same cast,
 * so a seek paints the same plates. No DOM.
 *
 * The roster is prominence order, capped by the box (four on a phone and a wide box, three
 * on a medium one). Every place is filled from the moment the roster begins, not when the
 * player enters. The roster changes only at a section boundary, and not when the previous
 * change was under eight seconds ago: a short section keeps the plates already standing.
 * An instrument shared with the previous roster keeps its place in the order and does not enter again.
 * A hole is closed, so a plate to the right of an empty slot can shift left.
 * `playAt` is the musical entrance. Before it the plate is only dim; that lives in `plateLife`.
 * A short wide page uses the same roster. Its chrome lives in CSS.
 * `ensemble` is kept only when fewer than two other instruments are in the roster.
 * It never sits between named instruments and never takes one of their places.
 * A passage whose keys are only `voice` and `choir` holds those engravings for the whole
 * section: no invented orchestra and no fake turn-taking.
 * An empty key list and no entries is an empty stage (applause). It is not ensemble.
 */
import type { MotionPref } from '@/app/settings';
import { prominenceLimit } from '@/instruments/layout';

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
  /** When this plate joined the standing roster. The cascade starts here, not at the musical entrance. */
  at: number;
  /** Musical entrance (`entries`). Before this the plate stands dim and still. */
  playAt: number;
  /** When the plate has left. */
  until: number;
  /** 0…1 plate presence at the queried time. The cascade, not the musical entrance. */
  presence: number;
  /**
   * `hero` is laid out in its own place. `echo` would fade inside the hero's rectangle;
   * the cast does not emit it, so a new entrance never shares a caption with the previous one.
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

/** A roster is not replaced again until this many seconds after the last replacement. */
export const CAST_HOLD_S = 8;

function plateMotion(motion: MotionPref) {
  // The last of four plates finishes its fade near one second (0.1×3 + 0.7).
  if (motion === 'off') return { enter: 0.05, stagger: 0 };
  if (motion === 'calm') return { enter: 0.7, stagger: 0.08 };
  return { enter: 0.7, stagger: 0.1 };
}

/**
 * `ensemble` is a stand-in. Once two named instruments are in the roster it drops out,
 * so it cannot sit between them or spend one of their places.
 */
export function stageRoster<T extends { key: string }>(spans: T[]): T[] {
  let named = 0;
  for (const s of spans) if (s.key !== 'ensemble') named++;
  if (named < 2) return spans;
  return spans.filter((s) => s.key !== 'ensemble');
}

/**
 * Plates in prominence order. `boxWidth` does not change who is inside one section.
 */
function byProminence(spans: Span[]) {
  return [...spans].sort((a, b) => {
    const as = a.source < 0 ? 1000 + a.at : a.source;
    const bs = b.source < 0 ? 1000 + b.at : b.source;
    return as - bs || a.at - b.at;
  });
}

function uniqueKeys(keys: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** The plates this section would stand on its own, most prominent first. */
export function desiredKeys(section: CastSection, limit: number): string[] {
  return uniqueKeys(stageRoster(byProminence(scheduleOf(section))).map((s) => s.key)).slice(0, Math.max(0, limit));
}

/** Musical entrance. A key with no `entries` row stands from the section start: the time is not invented later. */
export function playTime(section: CastSection, key: string): number {
  const entry = section.entries?.find((e) => e.key === key);
  if (entry) return entry.at;
  return section.start;
}

interface Standing {
  keys: string[];
  joined: Map<string, number>;
  playAt: Map<string, number>;
  changedAt: number;
}

/**
 * Walk the sections in order. A different roster is taken only when the previous change
 * was at least {@link CAST_HOLD_S} seconds earlier. A key shared with the roster already
 * standing keeps its slot and is not entered again. A newcomer fills the first free slot.
 * An empty slot is then closed, so a plate that stood to the right of a hole can shift left:
 * the row has no spacers. A key that leaves is forgotten, so a later return is a new entrance.
 */
export function standingKeys(sections: CastSection[], limit: number): Standing {
  let keys: string[] = [];
  const joined = new Map<string, number>();
  const playAt = new Map<string, number>();
  let changedAt = Number.NEGATIVE_INFINITY;
  for (const section of sections) {
    const next = desiredKeys(section, limit);
    const same = keys.length === next.length && keys.every((key, i) => key === next[i]);
    if (keys.length && (same || section.start - changedAt < CAST_HOLD_S)) continue;
    const slots: (string | null)[] = keys.map((key) => (next.includes(key) ? key : null));
    for (const key of next) {
      if (keys.includes(key)) continue;
      const hole = slots.indexOf(null);
      if (hole >= 0) slots[hole] = key;
      else if (slots.length < limit) slots.push(key);
    }
    keys = slots.filter((key): key is string => key != null).slice(0, limit);
    changedAt = section.start;
    for (const key of joined.keys()) {
      if (!keys.includes(key)) {
        joined.delete(key);
        playAt.delete(key);
      }
    }
    for (const key of keys) {
      if (joined.has(key)) continue;
      joined.set(key, section.start);
      playAt.set(key, playTime(section, key));
    }
  }
  return { keys, joined, playAt, changedAt };
}

/**
 * Plates to mount at `t`. `boxWidth` is the stage box in CSS px.
 * `earlier` is every instrumental section that starts before this one, in time order.
 * The roster does not change with `t`.
 */
export function castAt(
  section: CastSection,
  t: number,
  boxWidth: number,
  motion: MotionPref = 'full',
  earlier: CastSection[] = [],
): CastMember[] {
  const limit = prominenceLimit(boxWidth);
  const standing = standingKeys([...earlier, section], limit);
  if (!standing.keys.length) return [];
  const { enter, stagger } = plateMotion(motion);
  const listed = section.instruments;
  return standing.keys.map((key, slot) => {
    const joined = standing.joined.get(key) ?? section.start;
    const playAt = standing.playAt.get(key) ?? section.start;
    const source = listed.indexOf(key);
    // Past the end of this section the block is no longer the current one. Inside it, a plate
    // only fades in (the cascade). It does not fade out while its neighbours are still playing.
    // The opening section is already the picture at t = 0. A cascade that starts at section.start
    // is still 0 on that frame, so the first engraving never appeared. Later sections keep the cascade.
    const lead = earlier.length === 0 ? enter + slot * stagger : 0;
    const presence = t >= section.end ? 0 : smooth((t - joined - slot * stagger + lead) / enter);
    return {
      key,
      source,
      at: joined,
      playAt,
      until: section.end,
      presence,
      place: 'hero' as const,
      calm: isVoiceKey(key),
    };
  });
}

export function castSignature(members: CastMember[]) {
  return members.map((m) => `${m.place}:${m.source}:${m.key}`).join('|');
}
