/**
 * Shared-element fallback when the View Transition snapshot is not used.
 * The phone path skips that snapshot: it is one long frame and a large layer.
 * The cover still flies, as a transform on the one image.
 */

export interface FlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

let box: FlightBox | null = null;

export function armFlight(el: Element | null): void {
  if (!el) {
    box = null;
    return;
  }
  const r = el.getBoundingClientRect();
  box = { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function takeFlight(): FlightBox | null {
  const held = box;
  box = null;
  return held;
}

/** Desktop glass uses the browser transition. Everywhere else, the cover flies in script. */
export function sharedTransition(): boolean {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const off = document.documentElement.dataset.motion === 'off';
  const lens = document.documentElement.dataset.glass === 'lens';
  const start = (document as Document & { startViewTransition?: unknown }).startViewTransition;
  return !reduced && !off && lens && typeof start === 'function';
}
