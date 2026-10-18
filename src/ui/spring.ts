/**
 * One underdamped spring for sheets, switches and the settings stack.
 * Stiffness 400 and damping 30 settle in about 420 ms with a small overshoot.
 * The CSS twin is --ease-spring in tokens.css, sampled from the same motion
 * and squeezed into 420 ms so a transition and a finger-driven spring agree.
 */

export const SPRING = { stiffness: 400, damping: 30, mass: 1 };
export const SPRING_MS = 420;

/** CSS linear() of this spring, from rest at 0 to rest at 1. */
export const SPRING_EASE =
  'linear(0, 0.0988 5.6%, 0.2945 11.1%, 0.5049 16.7%, 0.6833 22.2%, 0.8242 27.8%, 0.9212 33.3%, 0.981 38.9%, 1.013 44.4%, 1.0263 50%, 1.0285 55.6%, 1.025 61.1%, 1.0191 66.7%, 1.0132 72.2%, 1.0081 77.8%, 1.0044 83.3%, 1.0019 88.9%, 1.0003 94.4%, 1)';

export interface SpringState {
  x: number;
  v: number;
}

/** Semi-implicit step. `dt` is seconds. Returns a new state. */
export function stepSpring(state: SpringState, target: number, dt: number, spring = SPRING): SpringState {
  const step = Math.min(Math.max(dt, 0), 0.032);
  const acc = (-spring.stiffness * (state.x - target) - spring.damping * state.v) / spring.mass;
  const v = state.v + acc * step;
  return { x: state.x + v * step, v };
}

export function springSettled(state: SpringState, target: number, eps = 0.6, velocity = 24): boolean {
  return Math.abs(state.x - target) < eps && Math.abs(state.v) < velocity;
}
