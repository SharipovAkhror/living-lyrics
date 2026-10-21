/**
 * One underdamped spring. Mass, stiffness and damping are the motion.
 * The step is the closed form, so a 32 ms frame cannot throw it off, and
 * the velocity already on the state is kept when the target changes.
 * Sheets use it: about 2% overshoot and a settle near 300 ms.
 * The CSS twin is --ease-spring, sampled from this same spring.
 */

export interface SpringSpec {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface SpringState {
  x: number;
  v: number;
}

/** Sheet, card and the settings stack. Peak about 1.025, settled by ~320 ms. */
export const SPRING: SpringSpec = { stiffness: 900, damping: 46, mass: 1 };
export const SPRING_MS = 320;

/**
 * Cover flight, library to the header. One object along the whole path.
 * Mass 1, a little overshoot, about half a second so a 100 ms contact sheet
 * still catches the artwork between the card and the header.
 */
export const FLIGHT_SPRING: SpringSpec = { stiffness: 200, damping: 24, mass: 1 };

/**
 * Sheet open. Slower than {@link SPRING} so the few pixels of overshoot
 * stay on screen. The tested sheet spring is still {@link SPRING}.
 */
export const SHEET_OPEN: SpringSpec = { stiffness: 280, damping: 24, mass: 1 };

/**
 * Phone used to carry a stiffer critically damped spring. The analytic step
 * is stable, so the phone sheet now uses {@link SPRING} and still only writes
 * a transform. Kept so older call sites have a name.
 */
export const PHONE_SPRING: SpringSpec = SPRING;

/** Play button press. Fast approach, no bounce. The caller picks the scale. */
export const PRESS_SPRING: SpringSpec = { stiffness: 2500, damping: 100, mass: 1 };

/**
 * Play button release, from the held 0.80 back to 1.
 * Zeta about 0.54, so the peak is near 1.027. Not retargeted on the way up.
 */
export const RELEASE_SPRING: SpringSpec = { stiffness: 380, damping: 21, mass: 1 };

/** Sheet close. Critically damped, so it does not bounce back onto the page. */
export const SHEET_CLOSE: SpringSpec = { stiffness: 1600, damping: 80, mass: 1 };

/** CSS linear() of {@link SPRING}, from rest at 0 to rest at 1, over {@link SPRING_MS}. */
export const SPRING_EASE =
  'linear(0, 0.21 8.3%, 0.549 16.7%, 0.806 25%, 0.948 33.3%, 1.009 41.7%, 1.023 50%, 1.019 58.3%, 1.011 66.7%, 1.005 75%, 1.001 83.3%, 1 91.7%, 1)';

function advance(x0: number, v0: number, dt: number, spring: SpringSpec): SpringState {
  const w0 = Math.sqrt(spring.stiffness / spring.mass);
  const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
  if (zeta < 0.999) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-zeta * w0 * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    const a = x0;
    const b = (v0 + zeta * w0 * a) / wd;
    const x = e * (a * cos + b * sin);
    const v = -zeta * w0 * x + e * wd * (-a * sin + b * cos);
    return { x, v };
  }
  if (zeta > 1.001) {
    const disc = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - disc);
    const r2 = -w0 * (zeta + disc);
    const b = (v0 - r1 * x0) / (r2 - r1);
    const a = x0 - b;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    return { x: a * e1 + b * e2, v: a * r1 * e1 + b * r2 * e2 };
  }
  const e = Math.exp(-w0 * dt);
  const a = x0;
  const b = v0 + w0 * a;
  const x = e * (a + b * dt);
  return { x, v: e * (b - w0 * (a + b * dt)) };
}

/** Recording only. `?slowmo=4` makes one second of motion take four seconds. */
let motionScale = 1;

export function setMotionScale(scale: number) {
  motionScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Recording stretch. 1 in ordinary use, 4 when a clip is shot with `?slowmo=4`. */
export function getMotionScale(): number {
  return motionScale;
}

/**
 * Advance toward `target`. `dt` is seconds and is capped so a stalled frame
 * cannot leap. Velocity on `state` is the velocity after the step's start,
 * so a finger flick and a retarget both continue the motion in flight.
 * A motion scale above 1 stretches that step across more frames (recordings).
 */
export function stepSpring(state: SpringState, target: number, dt: number, spring: SpringSpec = SPRING): SpringState {
  const total = Math.min(Math.max(dt, 0), 0.05) / motionScale;
  if (total === 0) return state;
  const next = advance(state.x - target, state.v, total, spring);
  return { x: next.x + target, v: next.v };
}

export function springSettled(state: SpringState, target: number, eps = 0.6, velocity = 24): boolean {
  return Math.abs(state.x - target) < eps && Math.abs(state.v) < velocity;
}
