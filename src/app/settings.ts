/** Reader preferences. Per-device conveniences only, so localStorage is fine (wrapped: it can throw). */
import { useSyncExternalStore } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type MotionPref = 'full' | 'calm' | 'off';

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
  persianStyle: 'nastaliq' | 'naskh';
  /** Stop at the end of every line (for learning a text line by line). */
  pauseAfterLine: boolean;
  quality: 'high' | 'saver';
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
  persianStyle: 'nastaliq',
  pauseAfterLine: false,
  quality: 'high',
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

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    // v1 settings carry over; keys that no longer exist are dropped.
    const legacyRaw = raw ?? localStorage.getItem('living-lyrics.settings.v1');
    const parsed: unknown = JSON.parse(legacyRaw ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    const saved = parsed as Record<string, unknown>;
    const migrated = migrateCommentKeys(saved);
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (k in saved) (out as Record<string, unknown>)[k] = saved[k];
    if (migrated) {
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
  state = { ...state, ...patch };
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
