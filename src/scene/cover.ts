/**
 * The stage is covered by a sheet, or the tab is hidden.
 * Callers stop their frame loops. A sheet over a moving sky is what makes Safari
 * rebuild backdrop layers, and it is what makes the sheet itself drop frames.
 */

export function stageCovered(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden || document.documentElement.dataset.sheet === '1';
}

/** Mark the stage covered before React commits the sheet, so the next frame is already still. */
export function coverStage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.sheet = '1';
}

export function watchCover(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sheet'] });
  document.addEventListener('visibilitychange', onChange);
  return () => {
    mo.disconnect();
    document.removeEventListener('visibilitychange', onChange);
  };
}
