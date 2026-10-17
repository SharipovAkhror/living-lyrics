/**
 * The contract between audio analysis, the scene and instrument art. Instrument drawings are going
 * to be redrawn (and may become Lottie, Rive or 3D models); whatever the format, they receive the
 * same few numbers per frame, derived from precomputed audio features. Spec for artists and agents:
 * docs/instruments/animation-contract.md. Nothing here depends on React or on a drawing format.
 */
import type { InstrumentInfo } from './list';

/** Feature tracks precomputed per song (scripts/pipeline/features.py → public/audio/<slug>/features.json). */
export type FeatureTrack =
  /** Overall loudness, 0…1. */
  | 'loud'
  /** Onset strength (attacks: plucks, hits, consonants), 0…1. */
  | 'onset'
  /** Spectral brightness (centroid, normalised), 0…1. */
  | 'bright'
  /** Loudness of separated stems, 0…1 each. */
  | 'drums'
  | 'bass'
  | 'other'
  | 'vocals';

export interface AudioFeatures {
  /**
   * Values per second in every track (20–50). The writer uses 20, the same rate as peaks.json,
   * and stores each sample as a 0…1 number with two decimal places (one, if that is what keeps
   * the file under about 900 KB). The file is compact JSON: seven tracks pretty-printed would
   * be megabytes.
   */
  rate: number;
  duration: number;
  tracks: Partial<Record<FeatureTrack, number[]>>;
  /** Beat times in seconds. Absent when no steady pulse was found, including free rhythm. */
  beats?: number[];
}

/**
 * What an instrument drawing receives every frame. All values 0…1 and pure functions of playback
 * time, so seeking gives the same frame.
 */
export interface InstrumentDrive {
  /** Appearance: contours draw in (SVG: stroke-dashoffset of `.d` paths). */
  draw: number;
  /** Secondary detail appears after the contours (SVG: `.h` hatching). */
  hatch: number;
  /** Overall energy of the passage. */
  energy: number;
  /** Short attacks: drum hits, plucked notes (SVG: `.skin` pulse, `.str` snap). */
  pulse: number;
  /** Held sound: bowing, singing, sustained notes (SVG: `.str` vibration, `.part-bow` travel). */
  sustain: number;
  /** Air: wind instruments and voices (SVG: `.breath` particles). */
  breath: number;
  /** Beat phase 0…1 inside the current beat (for gentle sway); 0 when no beat was found. */
  beat: number;
}

/** Which feature drives which motion, by instrument family (list.ts → family). */
export const FAMILY_DRIVE: Record<InstrumentInfo['family'], { pulse: FeatureTrack; sustain: FeatureTrack; breath?: FeatureTrack }> = {
  'струнные щипковые': { pulse: 'onset', sustain: 'other' },
  'струнные ударные': { pulse: 'onset', sustain: 'other' },
  смычковые: { pulse: 'onset', sustain: 'other' },
  духовые: { pulse: 'onset', sustain: 'other', breath: 'other' },
  ударные: { pulse: 'drums', sustain: 'drums' },
  клавишные: { pulse: 'onset', sustain: 'other' },
  голоса: { pulse: 'onset', sustain: 'vocals', breath: 'vocals' },
  ансамбль: { pulse: 'onset', sustain: 'loud' },
};

export function featureAt(f: AudioFeatures | null, track: FeatureTrack, t: number): number {
  const arr = f?.tracks[track];
  if (!f || !arr?.length) return 0;
  const x = t * f.rate;
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(x)));
  const j = Math.min(arr.length - 1, i + 1);
  return arr[i] + (arr[j] - arr[i]) * (x - i);
}

function beatPhase(beats: number[] | undefined, t: number) {
  if (!beats || beats.length < 2) return 0;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = beats[lo];
  const b = beats[lo + 1];
  return b && t >= a ? (t - a) / (b - a) : 0;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The drive for one instrument at time t of a passage that started at `start`. */
export function driveAt(f: AudioFeatures | null, family: InstrumentInfo['family'], t: number, start: number): InstrumentDrive {
  const map = FAMILY_DRIVE[family];
  const appear = clamp01((t - (start - 0.3)) / 2.6);
  return {
    draw: 1 - Math.pow(1 - appear, 3),
    hatch: clamp01((t - start - 0.9) / 1.6),
    energy: featureAt(f, 'loud', t),
    pulse: featureAt(f, map.pulse, t),
    sustain: featureAt(f, map.sustain, t),
    breath: map.breath ? featureAt(f, map.breath, t) : 0,
    beat: beatPhase(f?.beats, t),
  };
}

/**
 * Any drawing format plugs in through this interface: today SVG (CSS variables on the plate),
 * later Lottie (segments/markers), Rive (state-machine inputs with the same names) or glTF.
 */
const FEATURE_TRACKS: readonly FeatureTrack[] = ['loud', 'onset', 'bright', 'drums', 'bass', 'other', 'vocals'];

function trackArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = value[0];
  const last = value[value.length - 1];
  if (typeof first !== 'number' || typeof last !== 'number' || !Number.isFinite(first) || !Number.isFinite(last)) return null;
  return value as number[];
}

/**
 * Accept a `features.json` body. Returns null when the shape is not the contract, so a missing
 * or half-written file leaves the drawings still instead of throwing on the song page.
 * Samples the ends of each track; the file is produced by the pipeline and can be hundreds of kilobytes.
 */
export function parseAudioFeatures(raw: unknown): AudioFeatures | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const rate = body.rate;
  const duration = body.duration;
  if (typeof rate !== 'number' || typeof duration !== 'number' || !(rate > 0) || !(duration > 0)) return null;
  const tracksIn = body.tracks;
  if (!tracksIn || typeof tracksIn !== 'object' || Array.isArray(tracksIn)) return null;
  const tracks: AudioFeatures['tracks'] = {};
  for (const name of FEATURE_TRACKS) {
    const arr = trackArray((tracksIn as Record<string, unknown>)[name]);
    if (arr) tracks[name] = arr;
  }
  if (!tracks.loud) return null;
  let beats: number[] | undefined;
  if (body.beats != null) {
    const arr = trackArray(body.beats);
    if (!arr) return null;
    beats = arr;
  }
  return { rate, duration, tracks, beats };
}

export interface InstrumentRenderer {
  readonly kind: 'svg' | 'lottie' | 'rive' | 'gltf';
  mount(container: HTMLElement, key: string): Promise<void> | void;
  /**
   * `time` is seconds of playback. Pose is a pure function of `(drive, time)`, so a seek to the
   * same second is the same frame. Omit it only when the drawing has no clock of its own.
   */
  update(drive: InstrumentDrive, time?: number): void;
  dispose(): void;
}
