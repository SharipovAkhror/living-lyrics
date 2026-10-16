/**
 * Instrument catalogue. Keys are used in lyrics.json (`instruments: ["qanun", "oud"]`).
 * Each key needs an engraving in src/instruments/svg/<key>.svg (drawn by scripts/art/build-instruments.mjs,
 * spec in docs/methodology/09-instruments.md). Add new instruments here first.
 */
const svgs = import.meta.glob('/src/instruments/svg/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

import { INSTRUMENTS } from './list';
export { INSTRUMENTS, type InstrumentInfo } from './list';

const byKey = new Map(INSTRUMENTS.map((i) => [i.key, i]));

export function instrument(key: string) {
  return byKey.get(key);
}

export function instrumentSvg(key: string): string {
  return svgs[`/src/instruments/svg/${key}.svg`] ?? svgs['/src/instruments/svg/ensemble.svg'] ?? '';
}

export function hasArt(key: string) {
  return `/src/instruments/svg/${key}.svg` in svgs;
}
