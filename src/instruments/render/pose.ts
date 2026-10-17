/**
 * Pose of a 3D instrument from playback time. Pure: the same (drive, time) is the same pose,
 * so seeking does not depend on the frames that were shown before.
 *
 * String influence is a cosine, so time 0 is a peak rather than a dead centre.
 * Skin and jingles follow pulse; the root leans with the beat and stands straight at beat 0 and 1.
 */
import type { InstrumentDrive } from '@/instruments/animation';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Morph influence for `vibrate` on `part-string-<n>`, n starting at 1. Range −1…1. */
export function stringWeight(drive: InstrumentDrive, time: number, index: number): number {
  const amp = Math.min(1, drive.sustain * 0.8 + drive.pulse * 0.35);
  return amp * Math.cos(time * (6.5 + index * 0.45) + index * 0.4);
}

/** Morph influence for `hit` on `part-skin`. Range 0…1. */
export function skinWeight(drive: InstrumentDrive, time: number): number {
  return clamp01(drive.pulse * (0.82 + 0.18 * Math.cos(time * 23)));
}

/**
 * Signed offset for a jingle node, in fractions of the model height, before the renderer
 * scales it. `phase` is 0…1 around the hoop (node extras).
 */
export function jingleShift(drive: InstrumentDrive, time: number, phase: number): number {
  return Math.cos(time * 14 + phase * Math.PI * 2) * drive.pulse;
}

/** Radians. x is a small pitch, z is the visible lean. Both are zero at beat 0 and beat 1. */
export function sway(drive: InstrumentDrive): { x: number; z: number } {
  const lean = Math.sin(drive.beat * Math.PI) * (0.02 + 0.045 * clamp01(drive.energy));
  return { x: lean * 0.25, z: lean };
}

/** A short synthetic passage, used by the gallery's «Сыграть пример». */
export function exampleDrive(t: number): InstrumentDrive {
  const period = 0.55;
  const beat = (t % period) / period;
  const pulse = Math.exp(-beat * 7);
  const sustain = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.2));
  const breath = 0.5 + 0.5 * Math.sin(t * 1.3);
  const energy = Math.min(1, 0.25 + 0.5 * pulse + 0.35 * sustain);
  return { draw: 1, hatch: 1, energy, pulse, sustain, breath, beat };
}

export const DRIVE_KEYS = ['pulse', 'sustain', 'breath', 'energy', 'beat'] as const;
export type DriveKey = (typeof DRIVE_KEYS)[number];

export const DRIVE_LABELS: Record<DriveKey, string> = {
  pulse: 'Удар',
  sustain: 'Тянуть',
  breath: 'Дыхание',
  energy: 'Громкость',
  beat: 'Доля',
};
