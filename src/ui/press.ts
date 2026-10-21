/**
 * Press and release for the play control.
 * Down springs to 0.80 and stays there long enough for a 100 ms contact sheet.
 * A short tap snaps to that scale, holds, then returns with RELEASE_SPRING.
 * From 0.80 that spring peaks near 1.027 and settles on 1. One spring
 * carries the peak. Only `transform`
 * is written. Velocity is kept when the target changes, except the snap that
 * makes a fast click visible.
 */
import { getMotionScale, PRESS_SPRING, RELEASE_SPRING, springSettled, stepSpring, type SpringState } from './spring';

const PRESSED = 0.8;
/** Wall time at the pressed scale. Slow recordings stretch it with the springs. */
const HOLD_MS = 150;

export function bindPress(el: HTMLElement): () => void {
  let state: SpringState = { x: 1, v: 0 };
  let target = 1;
  let mode: 'idle' | 'down' | 'hold' | 'over' = 'idle';
  let holdUntil = 0;
  let raf = 0;
  let last = 0;

  const paint = () => {
    if (mode === 'idle' && Math.abs(state.x - 1) < 0.0015 && Math.abs(state.v) < 0.02) {
      el.style.transform = '';
      el.style.transition = '';
      return;
    }
    el.style.transition = 'none';
    el.style.transform = `scale(${state.x.toFixed(4)})`;
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const tick = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    if (mode === 'hold') {
      state = stepSpring(state, PRESSED, dt, PRESS_SPRING);
      if (now >= holdUntil) {
        mode = 'over';
        target = 1;
      }
      paint();
      raf = requestAnimationFrame(tick);
      return;
    }
    const spec = mode === 'down' ? PRESS_SPRING : mode === 'over' ? RELEASE_SPRING : PRESS_SPRING;
    state = stepSpring(state, target, dt, spec);
    paint();
    const eps = mode === 'down' ? 0.004 : 0.002;
    if (springSettled(state, target, eps, 0.05)) {
      state = { x: target, v: 0 };
      paint();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    stop();
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    mode = 'down';
    target = PRESSED;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* the button can still follow the pointer events it does receive */
    }
    start();
  };

  const up = (event: PointerEvent) => {
    if (mode !== 'down' && mode !== 'hold') return;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    // A click is over before the press spring moves. Snap, or the sheet misses it.
    if (state.x > 0.9) state = { x: PRESSED, v: 0 };
    mode = 'hold';
    target = PRESSED;
    holdUntil = performance.now() + HOLD_MS * getMotionScale();
    start();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    stop();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.style.transform = '';
    el.style.transition = '';
  };
}
