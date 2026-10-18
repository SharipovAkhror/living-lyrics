/**
 * Instrument catalogue. Keys are used in lyrics.json (`instruments: ["qanun", "oud"]`).
 * Each key needs an engraving in src/instruments/svg/<key>.svg (drawn by scripts/art/build-instruments.mjs,
 * spec in docs/methodology/09-instruments.md). Add new instruments here first.
 */
// Engravings are loaded on demand (≈ 15–80 KB each) and cached.
const loaders = import.meta.glob('/src/instruments/svg/*.svg', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const cache = new Map<string, string>();

import { INSTRUMENTS } from './list';
import artMeta from './art.json';
export { INSTRUMENTS, type InstrumentInfo } from './list';

const byKey = new Map(INSTRUMENTS.map((i) => [i.key, i]));

/**
 * Recognition names that share another key's engraving. One hop: the target is a real catalog key.
 * `guitar-acoustic` is the label on the Karitas frames; those frames are a classical nylon guitar.
 */
const ALIASES: Record<string, string> = {
  'guitar-acoustic': 'guitar-classical',
};

function resolveKey(key: string): string {
  return ALIASES[key] ?? key;
}

export function instrument(key: string) {
  return byKey.get(resolveKey(key));
}

function pathOf(key: string) {
  const p = `/src/instruments/svg/${resolveKey(key)}.svg`;
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
  return `/src/instruments/svg/${resolveKey(key)}.svg` in loaders;
}

/**
 * Width / height of an engraving's viewBox, known before the SVG loads (from src/instruments/art.json,
 * written by `npm run art`). Unknown keys fall back to the ensemble drawing, like the loader.
 */
export function instrumentAspect(key: string): number {
  const resolved = resolveKey(key);
  const m = (artMeta as Record<string, { w: number; h: number }>)[hasArt(key) ? resolved : 'ensemble'];
  return m && m.h > 0 ? m.w / m.h : 1;
}

/**
 * Makes the ids inside an engraving unique for one copy on the page (clip paths and masks are referenced
 * by id; two copies of the same drawing, one of them hidden, would otherwise break each other).
 */
export function scopeSvgIds(svg: string, suffix: string): string {
  if (!svg || !suffix) return svg;
  return svg.replace(/\bid="([^"]+)"/g, `id="$1-${suffix}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${suffix})`);
}
