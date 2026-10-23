/**
 * Per-song playback position on this device.
 * T27 seeks here after a reload. T28 can build the continue prompt on the same record.
 * localStorage only, and every call swallows quota and private-mode errors.
 */

const KEY = 'living-lyrics.resume.v1';

/** Automatic resume is for a reload during a listen, not for a visit days later. */
export const RESUME_AUTO_MS = 3 * 60 * 60 * 1000;

export interface ResumePoint {
  /** Seconds from the start of the song. */
  t: number;
  /** True when the song was playing at the last save. */
  playing: boolean;
  /** Date.now() at the save. */
  savedAt: number;
}

type Store = Record<string, ResumePoint>;

function readAll(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeAll(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode, or the quota is full */
  }
}

function point(value: unknown): ResumePoint | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<ResumePoint>;
  if (typeof row.t !== 'number' || !Number.isFinite(row.t) || row.t < 0) return null;
  return {
    t: row.t,
    playing: row.playing === true,
    savedAt: typeof row.savedAt === 'number' && Number.isFinite(row.savedAt) ? row.savedAt : 0,
  };
}

export interface ReadResumeOpts {
  /** A point past the song is discarded. Omit when the duration is not known yet. */
  duration?: number;
  /** Clock for the future-timestamp check. Defaults to Date.now(). */
  now?: number;
}

/**
 * The stored point, or null when the record is missing or unusable.
 * Malformed JSON, wrong types, NaN, a time past `duration`, and a `savedAt`
 * in the future are ignored. Nothing here throws.
 */
export function readResume(slug: string, opts: ReadResumeOpts = {}): ResumePoint | null {
  if (!slug) return null;
  const row = point(readAll()[slug]);
  if (!row) return null;
  const now = opts.now ?? Date.now();
  if (row.savedAt > now) return null;
  const duration = opts.duration;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && row.t > duration) return null;
  return row;
}

/** A point the page may seek to and offer. Stale, tiny, and future points are not. */
export function usableResume(slug: string, duration: number, now = Date.now()): ResumePoint | null {
  const saved = readResume(slug, { duration, now });
  if (!saved || saved.t < 1) return null;
  if (now - saved.savedAt > RESUME_AUTO_MS) return null;
  return saved;
}

export function writeResume(slug: string, next: ResumePoint): void {
  if (!slug || !Number.isFinite(next.t) || next.t < 0) return;
  const all = readAll();
  all[slug] = { t: next.t, playing: next.playing === true, savedAt: Number.isFinite(next.savedAt) ? next.savedAt : Date.now() };
  writeAll(all);
}

export function clearResume(slug: string): void {
  if (!slug) return;
  const all = readAll();
  if (!(slug in all)) return;
  delete all[slug];
  writeAll(all);
}
