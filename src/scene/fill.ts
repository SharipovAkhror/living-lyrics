/**
 * Word fill is a pure function of playback time. Seeking to the same moment
 * paints the same frame: there is no transition and no clock besides `t`.
 *
 * The sung part is opaque ink. The rest of the word stays at the element
 * opacity of an unsung word (`--dim-op`), applied as a mask on the word box
 * after the glyphs are painted. A translucent colour on the glyphs themselves
 * would paint joined Arabic and Persian letters twice and darken the joins.
 */

export const FILL_MAX_S = 1.6;
/** How far the moving edge stays in from each side of the word box, in em. */
export const FILL_PAD_EM = 0.21;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0 before the word, 1 once it has been sung (a held note does not crawl past FILL_MAX_S). */
export function wordFillFraction(t: number, start: number, end: number): number {
  const span = Math.min(FILL_MAX_S, Math.max(0.08, end - start));
  return clamp01((t - start) / span);
}

/**
 * Where the sung part ends, as a percent of the word's border box, measured
 * from the start of the writing direction (left for LTR, right for RTL).
 */
export function fillEdgePercent(fraction: number, widthPx: number, fontPx: number): number {
  const W = widthPx > 0 ? widthPx : 1;
  let pad = FILL_PAD_EM * (fontPx > 0 ? fontPx : 0);
  if (!(pad > 0) || pad * 2 >= W) pad = 0;
  return ((pad + clamp01(fraction) * (W - 2 * pad)) / W) * 100;
}

/** The mask runs toward the end of the line, so RTL fills from the right. */
export function fillMaskDirection(rtl: boolean): 'to left' | 'to right' {
  return rtl ? 'to left' : 'to right';
}

/** `?fill=1` draws word fill on a draft song. It does not change stored timing. */
export function fillQuery(search: string): boolean {
  const q = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(q).get('fill') === '1';
}

export function wordSyncOn(status: string, search: string): boolean {
  return status !== 'draft' || fillQuery(search);
}

/** A line flagged timing-draft stays whole, unless this page load forced fill for a test. */
export function lineWordSync(songOn: boolean, draftLine: boolean, forced: boolean): boolean {
  if (!songOn) return false;
  if (forced) return true;
  return !draftLine;
}
