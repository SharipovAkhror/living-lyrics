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

/**
 * The library-to-song move is a transform of one plate and the cover.
 * A view-transition snapshot of the glass was a long frame and left the
 * title fading across the stage, so it stays off.
 */
export function sharedTransition(): boolean {
  return false;
}
