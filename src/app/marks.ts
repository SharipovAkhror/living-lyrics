/**
 * Owner marks for moments where the picture does not match the sound.
 * One list per song in localStorage. If storage throws, the list stays in memory
 * and the sheet says so. Nothing here touches playback.
 */
import { useSyncExternalStore } from 'react';
import { lineText, type Cue } from '@/data/timeline';

export const INSTRUMENTAL_MARK = 'проигрыш';
/** Shown when the stage is still on the title card, before the first cue. */
export const BEFORE_MARK = 'до первой строки';

export interface Mark {
  id: string;
  /** When the owner pressed the button (ms), so “undo last” is not “latest in the song”. */
  at: number;
  /** Playback position in seconds. */
  t: number;
  /** Sung line id. Null for an instrumental passage or the title card. */
  lineId: string | null;
  text: string;
  sectionId: string;
  sectionLabel: string;
}

export interface MarkDraft {
  t: number;
  lineId: string | null;
  text: string;
  sectionId: string;
  sectionLabel: string;
}

export interface MarkSnapshot {
  marks: Mark[];
  /** True when this list cannot be written to localStorage. */
  memoryOnly: boolean;
}

export interface MarkStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface MarkBook {
  add(draft: MarkDraft): Mark;
  remove(id: string): void;
  /** Removes the most recently added mark, wherever it sits in the song. */
  undoLast(): Mark | null;
  clear(): void;
  subscribe(fn: () => void): () => void;
  getSnapshot(): MarkSnapshot;
  getServerSnapshot(): MarkSnapshot;
}

const EMPTY_SNAP: MarkSnapshot = { marks: [], memoryOnly: false };

export function marksStorageKey(slug: string) {
  return `living-lyrics.marks.v1.${slug}`;
}

/** The cue the stage treats as current, plus the exact playback time. */
export function momentAt(cues: readonly Cue[], ownerIdx: number, t: number): MarkDraft {
  const cue = ownerIdx >= 0 && ownerIdx < cues.length ? cues[ownerIdx] : undefined;
  if (!cue) {
    return { t, lineId: null, text: BEFORE_MARK, sectionId: '', sectionLabel: 'Начало' };
  }
  if (cue.kind === 'inst') {
    return {
      t,
      lineId: null,
      text: INSTRUMENTAL_MARK,
      sectionId: cue.section.id,
      sectionLabel: cue.section.label,
    };
  }
  return {
    t,
    lineId: cue.line.id,
    text: lineText(cue.line),
    sectionId: cue.section.id,
    sectionLabel: cue.section.label,
  };
}

export function clockLabel(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Local calendar date, YYYY-MM-DD. Used when the client has no commit hash. */
export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Commit injected at build time as VITE_COMMIT, when that variable is set.
 * This build does not set it (vite.config.ts is outside this change), so callers
 * fall back to a date.
 */
export function clientCommit(): string | null {
  try {
    const env = import.meta.env as { VITE_COMMIT?: string } | undefined;
    const raw = env?.VITE_COMMIT?.trim() ?? '';
    return /^[0-9a-f]{7,40}$/i.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Plain text an agent can apply. Marks are printed in the order given (the book sorts by time). */
export function formatMarksReport(opts: {
  title: string;
  slug: string;
  marks: readonly Mark[];
  commit: string | null;
  date: string;
}) {
  const version = opts.commit && /^[0-9a-f]{7,40}$/i.test(opts.commit) ? opts.commit : opts.date;
  const lines = [
    'Отметки «не совпадает»',
    `Песня: ${opts.title} (${opts.slug})`,
    `Версия данных: ${version}`,
    '',
  ];
  opts.marks.forEach((m, i) => {
    const section = m.sectionId ? `${m.sectionId} — ${m.sectionLabel}` : m.sectionLabel;
    lines.push(
      `${i + 1}. ${m.t.toFixed(2)} с (${clockLabel(m.t)})`,
      `   строка: ${m.lineId ?? '—'}`,
      `   текст: ${m.text}`,
      `   секция: ${section}`,
      '',
    );
  });
  return lines.join('\n').replace(/\n$/, '') + '\n';
}

function roundSec(t: number) {
  if (!Number.isFinite(t) || t < 0) return 0;
  return Math.round(t * 1000) / 1000;
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isMark(x: unknown): x is Mark {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.at === 'number' &&
    Number.isFinite(m.at) &&
    typeof m.t === 'number' &&
    Number.isFinite(m.t) &&
    m.t >= 0 &&
    (m.lineId === null || typeof m.lineId === 'string') &&
    typeof m.text === 'string' &&
    typeof m.sectionId === 'string' &&
    typeof m.sectionLabel === 'string'
  );
}

export function parseMarks(raw: string | null): Mark[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const marks = (data as { marks?: unknown }).marks;
    if (!Array.isArray(marks)) return [];
    return marks.filter(isMark);
  } catch {
    return [];
  }
}

export function createMarkBook(slug: string, storage: MarkStorage, now: () => number = () => Date.now()): MarkBook {
  const key = marksStorageKey(slug);
  let memoryOnly = false;
  let marks: Mark[] = [];
  try {
    marks = parseMarks(storage.get(key));
  } catch {
    memoryOnly = true;
    marks = [];
  }
  const listeners = new Set<() => void>();
  let snap: MarkSnapshot = { marks: marks.slice(), memoryOnly };

  function publish() {
    snap = { marks: marks.slice(), memoryOnly };
    listeners.forEach((fn) => fn());
  }

  function persist() {
    if (memoryOnly) return;
    try {
      storage.set(key, JSON.stringify({ v: 1, marks }));
    } catch {
      memoryOnly = true;
    }
  }

  return {
    add(draft) {
      const mark: Mark = {
        id: newId(),
        at: now(),
        t: roundSec(draft.t),
        lineId: draft.lineId,
        text: draft.text,
        sectionId: draft.sectionId,
        sectionLabel: draft.sectionLabel,
      };
      marks.push(mark);
      marks.sort((a, b) => a.t - b.t || a.at - b.at);
      persist();
      publish();
      return mark;
    },
    remove(id) {
      const next = marks.filter((m) => m.id !== id);
      if (next.length === marks.length) return;
      marks = next;
      persist();
      publish();
    },
    undoLast() {
      if (!marks.length) return null;
      let i = 0;
      for (let k = 1; k < marks.length; k++) if (marks[k].at >= marks[i].at) i = k;
      const removed = marks[i];
      marks = marks.filter((_, idx) => idx !== i);
      persist();
      publish();
      return removed;
    },
    clear() {
      if (!marks.length) return;
      marks = [];
      persist();
      publish();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot() {
      return snap;
    },
    getServerSnapshot() {
      return EMPTY_SNAP;
    },
  };
}

const books = new Map<string, MarkBook>();

function browserStorage(): MarkStorage {
  return {
    get(key) {
      return localStorage.getItem(key);
    },
    set(key, value) {
      localStorage.setItem(key, value);
    },
  };
}

export function marksFor(slug: string): MarkBook {
  let book = books.get(slug);
  if (!book) {
    book = createMarkBook(slug, browserStorage());
    books.set(slug, book);
  }
  return book;
}

export function useMarks(slug: string): MarkSnapshot {
  const book = marksFor(slug);
  return useSyncExternalStore(book.subscribe, book.getSnapshot, book.getServerSnapshot);
}
