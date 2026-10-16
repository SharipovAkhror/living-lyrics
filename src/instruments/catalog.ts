/**
 * Instrument catalogue. Keys are used in lyrics.json (`instruments: ["qanun", "oud"]`).
 * Each key needs an engraving in src/instruments/svg/<key>.svg (drawn by scripts/art/build-instruments.mjs,
 * spec in docs/methodology/09-instruments.md). Add new instruments here first.
 */
// Engravings are loaded on demand (≈ 15–80 KB each) and cached.
const loaders = import.meta.glob('/src/instruments/svg/*.svg', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const cache = new Map<string, string>();

import { INSTRUMENTS } from './list';
export { INSTRUMENTS, type InstrumentInfo } from './list';

const byKey = new Map(INSTRUMENTS.map((i) => [i.key, i]));

export function instrument(key: string) {
  return byKey.get(key);
}

function pathOf(key: string) {
  const p = `/src/instruments/svg/${key}.svg`;
  return p in loaders ? p : '/src/instruments/svg/ensemble.svg';
}

/** Synchronous read of an already loaded engraving ('' if not loaded yet). */
export function instrumentSvg(key: string): string {
  return cache.get(pathOf(key)) ?? '';
}

export async function loadInstrumentSvg(key: string): Promise<string> {
  const p = pathOf(key);
  const hit = cache.get(p);
  if (hit) return hit;
  const svg = await loaders[p]();
  cache.set(p, svg);
  return svg;
}

/** Warm the cache for every instrument a song uses, right after its lyrics load. */
export function preloadInstruments(keys: string[]) {
  return Promise.all(keys.map((k) => loadInstrumentSvg(k).catch(() => '')));
}

export function hasArt(key: string) {
  return `/src/instruments/svg/${key}.svg` in loaders;
}
