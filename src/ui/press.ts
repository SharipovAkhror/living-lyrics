/**
 * Press and release for the play control.
 * Down springs to 0.92. Up springs toward 1.04 (stiffness 450, damping 18),
 * then retargets to 1 without dropping the velocity. Only `transform` is written.
 */
import { PRESS_SPRING, RELEASE_SPRING, SPRING, springSettled, stepSpring, type SpringState } from './spring';

export function bindPress(el: HTMLElement): () => void {
  let state: SpringState = { x: 1, v: 0 };
  let target = 1;
  let mode: 'idle' | 'down' | 'over' = 'idle';
  let raf = 0;
  let last = 0;

  const paint = () => {
    if (mode === 'idle' && Math.abs(state.x - 1) < 0.0015 && Math.abs(state.v) < 0.02) {
      el.style.transform = '';
      return;
    }
    el.style.transform = `scale(${state.x.toFixed(4)})`;
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const tick = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    const spec = mode === 'down' ? PRESS_SPRING : mode === 'over' ? RELEASE_SPRING : SPRING;
    state = stepSpring(state, target, dt, spec);
    if (mode === 'over' && state.x >= 1.035 && state.v >= 0) {
      mode = 'idle';
      target = 1;
    }
    paint();
    const eps = mode === 'down' ? 0.004 : 0.002;
    if (mode !== 'over' && springSettled(state, target, eps, 0.05)) {
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
    target = 0.92;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* the button can still follow the pointer events it does receive */
    }
    start();
  };

  const up = (event: PointerEvent) => {
    if (mode !== 'down') return;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    mode = 'over';
    target = 1.04;
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
  };
}
