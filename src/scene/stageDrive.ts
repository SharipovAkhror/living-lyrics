/**
 * The drive one plate receives. `driveAt` is the contract; this quiets it and adds life.
 * Before `playAt` the engraving is dim (`life` near 0.35) and nothing moves.
 * After it, brightness rests near 0.60 and rises with that family's stem. Hits scale the
 * drawing; a silent stem settles the motion. `off` (including the OS reduce-motion switch)
 * keeps the brightness and drops the impulse. A voice or choir plate keeps a little air
 * and loses the attack. The contour is already drawn: the cascade is the plate's opacity.
 */
import type { MotionPref } from '@/app/settings';
import type { AudioFeatures, InstrumentDrive } from '@/instruments/animation';
import { FAMILY_DRIVE, driveAt, plateLife, stemTrack } from '@/instruments/animation';
import { instrument } from '@/instruments/catalog';

export function stageDrive(
  features: AudioFeatures | null,
  key: string,
  playAt: number,
  calm: boolean,
  t: number,
  motion: MotionPref,
): InstrumentDrive {
  const family = instrument(key)?.family ?? 'ансамбль';
  const life = plateLife(features, family, t, playAt, motion === 'off');
  const raw = driveAt(features, family, t, playAt);
  const still = {
    draw: 1,
    hatch: 1,
    energy: 0,
    pulse: 0,
    sustain: 0,
    breath: 0,
    beat: 0,
    life: life.brightness,
    halo: life.halo,
    hit: 0,
  };
  if (motion === 'off') return still;
  const amp = motion === 'calm' ? 0.45 : 1;
  const move = life.awake * amp;
  // The mix onset is shared. A family whose pulse is not its own stem stays still while that stem is quiet.
  const gate = stemTrack(family) === FAMILY_DRIVE[family].pulse ? 1 : life.stem;
  return {
    draw: 1,
    hatch: 1,
    energy: raw.energy * move * (calm ? 0.4 : 1),
    pulse: raw.pulse * move * gate * (calm ? 0.2 : 1),
    sustain: raw.sustain * move * (calm ? 0.35 : 1),
    breath: raw.breath * move * (calm ? 0.55 : 1),
    beat: (calm ? raw.beat * 0.3 : raw.beat) * move,
    life: life.brightness,
    halo: life.halo,
    hit: life.hit * amp,
  };
}
