/** Reader preferences. Per-device conveniences only, so localStorage is fine (wrapped: it can throw). */
import { useSyncExternalStore } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type MotionPref = 'full' | 'calm' | 'off';
/**
 * Song-page instruments. `drawing` is the SVG engraving and the default.
 * `engraving` and `materials` are the volume model.
 */
export type InstrumentStyle = 'drawing' | 'engraving' | 'materials';
/** Persian verse. `naskh` here is Noto Naskh Arabic, not the Mushaf file. */
export type FontPersian = 'amiri' | 'naskh' | 'scheherazade' | 'nastaliq';
/** Latin and Cyrillic original. */
export type FontOriginal = 'source-serif' | 'cormorant' | 'eb-garamond' | 'literata';
/** Russian translation and transliteration. */
export type FontTranslation = 'source-serif' | 'inter';

const INSTRUMENT_STYLES: readonly InstrumentStyle[] = ['drawing', 'engraving', 'materials'];
const FONT_PERSIAN: readonly FontPersian[] = ['amiri', 'naskh', 'scheherazade', 'nastaliq'];
const FONT_ORIGINAL: readonly FontOriginal[] = ['source-serif', 'cormorant', 'eb-garamond', 'literata'];
const FONT_TRANSLATION: readonly FontTranslation[] = ['source-serif', 'inter'];

export interface Settings {
  theme: ThemePref;
  showTranslation: boolean;
  showTranslit: boolean;
  showAlt: boolean;
  /** Commentary panel visible at all. */
  showComment: boolean;
  /** Commentary panel expanded (vs. one-line preview). */
  commentOpen: boolean;
  textScale: number;
  motion: MotionPref;
  fontPersian: FontPersian;
  fontOriginal: FontOriginal;
  fontTranslation: FontTranslation;
  /** Stop at the end of every line (for learning a text line by line). */
  pauseAfterLine: boolean;
  quality: 'high' | 'saver';
  /** Song pages. The instruments gallery previews the volume model on its own. */
  instrumentStyle: InstrumentStyle;
  rate: number;
  volume: number;
  normalize: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqBands: number[];
  eqPreamp: number;
}

export const DEFAULTS: Settings = {
  theme: 'auto',
  showTranslation: true,
  showTranslit: false,
  showAlt: false,
  showComment: true,
  commentOpen: false,
  textScale: 1,
  motion: 'full',
  fontPersian: 'amiri',
  fontOriginal: 'source-serif',
  fontTranslation: 'source-serif',
  pauseAfterLine: false,
  quality: 'high',
  instrumentStyle: 'drawing',
  rate: 1,
  volume: 1,
  normalize: true,
  eqEnabled: false,
  eqPreset: 'flat',
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqPreamp: 0,
};

const KEY = 'living-lyrics.settings.v2';

/**
 * Commentary used to be stored as `showSharh` / `sharhOpen` (Arabic sharh, شرح).
 * Copy a saved choice onto the current names. Returns true when the stored object changed.
 */
function migrateCommentKeys(saved: Record<string, unknown>): boolean {
  let changed = false;
  if ('showSharh' in saved) {
    if (!('showComment' in saved)) saved.showComment = saved.showSharh;
    delete saved.showSharh;
    changed = true;
  }
  if ('sharhOpen' in saved) {
    if (!('commentOpen' in saved)) saved.commentOpen = saved.sharhOpen;
    delete saved.sharhOpen;
    changed = true;
  }
  return changed;
}

/**
 * Persian used to be `persianStyle`: `nastaliq` or `naskh`.
 * Nastaliq stays nastaliq. The old naskh was the Mushaf file, which is no longer a Persian choice,
 * so a saved naskh becomes Amiri (the classical naskh). Arabic lines keep the Mushaf either way.
 */
function migrateFontKeys(saved: Record<string, unknown>): boolean {
  if (!('persianStyle' in saved)) return false;
  if (!('fontPersian' in saved)) saved.fontPersian = saved.persianStyle === 'nastaliq' ? 'nastaliq' : 'amiri';
  delete saved.persianStyle;
  return true;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function sanitize(out: Settings): Settings {
  out.instrumentStyle = oneOf(out.instrumentStyle, INSTRUMENT_STYLES, 'drawing');
  out.fontPersian = oneOf(out.fontPersian, FONT_PERSIAN, DEFAULTS.fontPersian);
  out.fontOriginal = oneOf(out.fontOriginal, FONT_ORIGINAL, DEFAULTS.fontOriginal);
  out.fontTranslation = oneOf(out.fontTranslation, FONT_TRANSLATION, DEFAULTS.fontTranslation);
  return out;
}

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    // v1 settings carry over; keys that no longer exist are dropped.
    const legacyRaw = raw ?? localStorage.getItem('living-lyrics.settings.v1');
    const parsed: unknown = JSON.parse(legacyRaw ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    const saved = parsed as Record<string, unknown>;
    const commentMoved = migrateCommentKeys(saved);
    const fontMoved = migrateFontKeys(saved);
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (k in saved) (out as Record<string, unknown>)[k] = saved[k];
    const before = JSON.stringify(out);
    sanitize(out);
    if (commentMoved || fontMoved || JSON.stringify(out) !== before) {
      try {
        localStorage.setItem(KEY, JSON.stringify(out));
      } catch {
        /* private mode: keep the migrated choice in memory */
      }
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

let state: Settings = read();
const listeners = new Set<() => void>();

export function getSettings() {
  return state;
}

export function setSettings(patch: Partial<Settings>) {
  state = sanitize({ ...state, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function subscribeSettings(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

/** Respect the OS "Reduce Motion" switch on top of the in-app preference. */
export function effectiveMotion(s: Settings): MotionPref {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
  return s.motion;
}
