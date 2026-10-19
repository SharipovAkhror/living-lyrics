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
  /**
   * Engraving brightness, about 0.35 before the musical entrance, then 0.60…1 with the stem.
   * Omitted on the gallery and the example clip, which stay fully lit.
   */
  life?: number;
  /** Soft halo, 0…1, the stem's loudness after the entrance. A hit adds a short flash on top. */
  halo?: number;
  /**
   * Attack impulse, 0…1. The drawing scales by `1 + 0.04 * hit` and the halo flashes.
   * Zero when motion is off, including the system reduce-motion switch. Omitted means no impulse.
   */
  hit?: number;
}

/**
 * Which feature drives which motion, by instrument family (list.ts → family).
 * Demucs writes four stems. Life and sustain read one of them (`stemTrack`):
 * percussion reads `drums`, voices read `vocals`, the ensemble plate reads the mix (`loud`),
 * and every other family reads `other`. Two instruments of one family therefore brighten together.
 * `pulse` for a non-drum is the mix onset, and the stage multiplies it by that family's stem
 * so a silent family does not strike on someone else's attack.
 */
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

/** Brightness before the musical entrance. */
export const LIFE_DIM = 0.35;
/** Brightness after the entrance while this family's stem is silent. */
export const LIFE_REST = 0.6;
/** How far a hit may scale the drawing: 1 + this. */
export const HIT_SCALE = 0.04;

/**
 * The stem that stands for a family. There are four. Plucked, hammered, bowed, wind and keys
 * share `other`: the separator does not name them apart, and the stage does not pretend to.
 */
export function stemTrack(family: InstrumentInfo['family']): FeatureTrack {
  if (family === 'ударные') return 'drums';
  if (family === 'голоса') return 'vocals';
  if (family === 'ансамбль') return 'loud';
  return 'other';
}

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

function smooth01(v: number) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

/**
 * How hard this family's stem just rose, 0…1. Reads two samples of the precomputed track,
 * so a seek to the same second is the same impulse. Nothing is stored between frames.
 */
export function stemAttack(f: AudioFeatures | null, family: InstrumentInfo['family'], t: number): number {
  const track = stemTrack(family);
  const now = featureAt(f, track, t);
  const prev = featureAt(f, track, Math.max(0, t - 0.08));
  return clamp01((now - prev) / 0.2);
}

export interface PlateLife {
  /** 0 before `playAt`, 1 after a short ramp. */
  awake: number;
  /** This family's stem, 0…1. */
  stem: number;
  /** Engraving brightness. */
  brightness: number;
  /** Halo strength, with the attack flash included unless motion is off. */
  halo: number;
  /** Attack impulse. Zero when motion is off. */
  hit: number;
}

/**
 * Brightness and halo for one plate. `playAt` is the musical entrance (`entries`), not the
 * moment the plate was placed. Before it the plate is dim and still. After it, brightness
 * rests near 0.60 and rises to 1 with the stem. `motionOff` keeps the brightness and drops the hit.
 */
export function plateLife(
  f: AudioFeatures | null,
  family: InstrumentInfo['family'],
  t: number,
  playAt: number,
  motionOff = false,
): PlateLife {
  const stem = clamp01(featureAt(f, stemTrack(family), t));
  const awake = Number.isFinite(playAt) ? smooth01((t - playAt) / 0.4) : 0;
  const lit = LIFE_REST + (1 - LIFE_REST) * stem;
  const brightness = LIFE_DIM + (lit - LIFE_DIM) * awake;
  const hit = motionOff ? 0 : awake * stemAttack(f, family, t);
  // Reduced motion keeps the brightness and drops the glow: the halo is part of the living motion.
  const halo = motionOff ? 0 : Math.min(1, awake * stem + hit * 0.55);
  return { awake, stem, brightness, halo, hit };
}

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

/**
 * Any drawing format plugs in through this interface: today SVG (CSS variables on the plate),
 * later Lottie (segments/markers), Rive (state-machine inputs with the same names) or glTF.
 */
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
