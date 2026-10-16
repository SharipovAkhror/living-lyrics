/** Reader preferences. Per-device conveniences only, so localStorage is fine (wrapped: it can throw). */
import { useSyncExternalStore } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type MotionPref = 'full' | 'calm' | 'off';
export type FollowMode = 'auto' | 'manual';

export interface Settings {
  theme: ThemePref;
  showTranslation: boolean;
  showTranslit: boolean;
  showAlt: boolean;
  /** Commentary panel visible at all. */
  showSharh: boolean;
  /** Commentary panel expanded (vs. one-line preview). */
  sharhOpen: boolean;
  textScale: number;
  motion: MotionPref;
  persianStyle: 'nastaliq' | 'naskh';
  follow: FollowMode;
  /** Manual mode: stop at the end of each line. */
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
  showSharh: true,
  sharhOpen: false,
  textScale: 1,
  motion: 'full',
  persianStyle: 'nastaliq',
  follow: 'auto',
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

const KEY = 'living-lyrics.settings.v1';

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
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
