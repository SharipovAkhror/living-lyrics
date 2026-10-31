/**
 * Rows, glass, the page scale and this cover wait this long after the tap.
 * The cast's first frame is the one inside the 100 ms budget. Filling the
 * sheet on the next animation frame put that work into the same frame, and
 * WebKit then delivered it late. The shell alone is the tap's answer.
 */
export const SHEET_SHELL_MS = 120;

/**
 * Desktop lens on the sheet. Rows at ≥800 px fade for 340 ms, the last one
 * delayed 210 ms, and they mount only after the shell. 120+210+340 = 670.
 * The filter waits past that: on the sheet itself it resamples every frame
 * the rows are still moving, and the desktop frame budget misses.
 */
export const SHEET_GLASS_MS = 760;

/**
 * The stage is covered by a sheet, or the tab is hidden.
 * Callers stop their frame loops. A sheet over a moving sky is what makes Safari
 * rebuild backdrop layers, and it is what makes the sheet itself drop frames.
 */

export function stageCovered(): boolean {
  if (typeof document === 'undefined') return false;
  const data = document.documentElement.dataset;
  // `cover` stops the sky on the tap, before the sheet has moved. `sheet` is the
  // visual cover and also scales the page, so it waits until the sheet is in.
  return document.hidden || data.sheet === '1' || data.cover === '1';
}

/** Mark the stage covered before React commits the sheet, so the next frame is already still. */
export function coverStage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.cover = '1';
}

export function watchCover(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sheet', 'data-cover'] });
  document.addEventListener('visibilitychange', onChange);
  return () => {
    mo.disconnect();
    document.removeEventListener('visibilitychange', onChange);
  };
}
