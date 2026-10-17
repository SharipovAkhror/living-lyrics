/**
 * CSS variables for one SVG plate. A pure function of (drive, time): seeking to the same
 * second writes the same variables. The 3D pose (pose.ts) uses the same phase, so the first
 * string, the skin and the jingles agree across the two looks.
 */
import type { InstrumentDrive } from '@/instruments/animation';
import { jingleShift, skinWeight, sway } from './pose';

const RAD = 180 / Math.PI;

export function svgMotionVars(drive: InstrumentDrive, time: number): Record<string, string> {
  const amp = Math.min(3.2, drive.sustain * 1.05 + drive.pulse * 2.35);
  const wave = Math.cos(time * 6.5);
  const skin = 1 + skinWeight(drive, time) * 0.055;
  const breath = drive.breath * (0.28 + 0.72 * (0.5 + 0.5 * Math.sin(time * 1.55)));
  const jingle = jingleShift(drive, time, 0) * 2.2;
  const bowPhase = (((time * (0.32 + drive.sustain * 0.7)) % 2) + 2) % 2;
  const tri = bowPhase < 1 ? bowPhase : 2 - bowPhase;
  const bow = (tri * 2 - 1) * drive.sustain * 5;
  return {
    '--draw': drive.draw.toFixed(4),
    '--hatch': drive.hatch.toFixed(3),
    '--energy': drive.energy.toFixed(3),
    '--pulse': drive.pulse.toFixed(3),
    '--sustain': drive.sustain.toFixed(3),
    '--breath': drive.breath.toFixed(3),
    '--beat': drive.beat.toFixed(3),
    '--str-x': `${(amp * wave * 0.42).toFixed(3)}px`,
    '--str-y': `${(amp * wave).toFixed(3)}px`,
    '--skin': skin.toFixed(4),
    '--breath-o': breath.toFixed(3),
    '--jingle': `${jingle.toFixed(3)}px`,
    '--bow': `${bow.toFixed(2)}px`,
    '--sway': `${(sway(drive).z * RAD).toFixed(3)}deg`,
  };
}
