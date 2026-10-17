/**
 * The drive one plate receives. `driveAt` is the contract; this only quiets it.
 * `off` (including the OS reduce-motion switch) draws the engraving and then holds still.
 * A voice or choir plate keeps a little air and loses the attack.
 */
import type { MotionPref } from '@/app/settings';
import type { AudioFeatures, InstrumentDrive } from '@/instruments/animation';
import { driveAt } from '@/instruments/animation';
import { instrument } from '@/instruments/catalog';

export function stageDrive(
  features: AudioFeatures | null,
  key: string,
  at: number,
  calm: boolean,
  t: number,
  motion: MotionPref,
): InstrumentDrive {
  const family = instrument(key)?.family ?? 'ансамбль';
  const raw = driveAt(features, family, t, at);
  if (motion === 'off') {
    const on = t + 0.02 >= at;
    return { draw: on ? 1 : 0, hatch: on ? 1 : 0, energy: 0, pulse: 0, sustain: 0, breath: 0, beat: 0 };
  }
  const amp = motion === 'calm' ? 0.45 : 1;
  return {
    draw: raw.draw,
    hatch: raw.hatch,
    energy: raw.energy * (calm ? amp * 0.4 : amp),
    pulse: raw.pulse * (calm ? amp * 0.2 : amp),
    sustain: raw.sustain * (calm ? amp * 0.35 : amp),
    breath: raw.breath * (calm ? 0.55 : amp),
    beat: calm ? raw.beat * 0.3 : raw.beat,
  };
}
