import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { InstCue, Timeline } from '@/data/timeline';
import type { AudioFeatures } from '@/instruments/animation';
import type { LineEntrance, MotionPref } from '@/app/settings';
import { formatTime } from '@/data/library';
import { instrument } from '@/instruments/catalog';
import { blockState, clamp01, entranceOpacity, type Measure } from './flow';
import type { BlockUpdater } from './LineBlock';
import { InstrumentStage, assignPerformers, type InstrumentStageHandle, type StagePose } from './InstrumentStage';
import { castAt, castSignature, isVoicePassage, type CastMember } from './cast';
import { stageDrive } from './stageDrive';
import { bisect } from '@/app/bisect';
import { isPhone } from '@/ui/phone';

/** Compact height already read. A phone scrub reuses it and does not lay out. */
const instCompact = new Map<number, number>();

interface Props {
  cue: InstCue;
  /** Phone slot that has left the window. The host and its engravings stay mounted. */
  parked?: boolean;
  timeline: Timeline;
  /** Timing is measured: countdowns like «Голос через 0:12» can be trusted. */
  timed: boolean;
  entrance: LineEntrance;
  motion: MotionPref;
  stage: { w: number; h: number };
  /** Song-level audio features. Null until the file arrives, or when the song has none. */
  features: AudioFeatures | null;
  register: (idx: number, fn: BlockUpdater | null, m?: Measure) => void;
  onPick: (idx: number) => void;
  /** Bumps once when a scrub ends, so a passage that used a cached box is read again. */
  measureEpoch?: number;
}

function passageTitle(keys: string[]) {
  if (!isVoicePassage(keys)) return null;
  const voice = keys.includes('voice');
  const choir = keys.includes('choir');
  if (voice && choir) return 'Голос и хор';
  if (choir) return 'Хор';
  return 'Голос';
}

function frameFor(members: CastMember[], features: AudioFeatures | null, t: number, motion: MotionPref): StagePose {
  const heroes = members.filter((m) => m.place === 'hero');
  const echoes = members.filter((m) => m.place === 'echo');
  return {
    time: t,
    drives: heroes.map((m) => stageDrive(features, m.key, m.playAt, m.calm, t, motion)),
    plates: heroes.map((m) => m.presence),
    echoes: echoes.map((m) => ({ drive: stageDrive(features, m.key, m.playAt, m.calm, t, motion), presence: m.presence })),
  };
}

/**
 * An instrumental passage in the flow. Ahead of time it is a compact line ("Дальше — уд, канун"),
 * on stage the section's three or four engravings are already standing. The one that is playing
 * brightens and moves; the others stay dim until their entrance. Who plays, and when the voice returns, stays under the drawings.
 * A passage that is only voice or choir keeps that engraving and does not invent an orchestra.
 */
function InstBlockImpl({ cue, parked = false, timeline, timed, entrance, motion, stage, features, register, onPick, measureEpoch = 0 }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const compact = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<InstrumentStageHandle>(null);
  const { section } = cue;
  const keys = section.instruments;
  const names = keys.map((k) => instrument(k)?.name ?? k);
  // Credit the player on the full section, then keep that name when the phone shows only the later entrance.
  // An empty list is applause: no ensemble plate and no invented performer.
  const credited = assignPerformers(keys, section.performers);
  const title = passageTitle(keys) ?? (keys.length === 0 ? section.label : null);
  const nextVocal = timeline.cues.find((c) => c.kind === 'line' && c.start >= cue.end - 0.01);
  const [anim, setAnim] = useState({ progress: 0, presence: 0 });
  const animRef = useRef(anim);
  const castSig = useRef('');
  const frameRef = useRef<StagePose | null>(null);
  const painted = useRef({ z: '', transform: '', opacity: '', vis: '', height: '', compact: '', fullO: '', fullS: '' });

  // A short wide screen (the car) gives the drawings the height and keeps the note short.
  // The box never asks for more height than the stage has: a 160px floor used to be crushed
  // by the flex column on a low window, and the plates left the frame.
  const room = Math.max(0, stage.h);
  const shortStage = room > 0 && room <= 420 && stage.w >= 640;
  const tight = room > 0 && room < 300 && !shortStage;
  const fullH = shortStage ? Math.round(room * 0.92) : Math.round(Math.min(tight ? room : room * 0.72, 620));
  const textH = shortStage
    ? section.note ? 52 : section.mode ? 36 : 28
    : section.note ? (tight ? 36 : 96) : section.mode ? (tight ? 28 : 64) : tight ? 20 : 44;
  const stageSize = {
    w: Math.max(200, Math.min(stage.w - (shortStage ? 16 : 24), 1040)),
    h: Math.max(64, Math.min(fullH - textH, room > 0 ? room : fullH)),
  };
  const compactH = useRef(56);
  // Sections that already stood. Shared plates keep their slot and skip the cascade.
  const earlier = timeline.cues.flatMap((c) => (c.kind === 'inst' && c.start < cue.start ? [c.section] : []));
  const [cast, setCast] = useState<CastMember[]>(() => {
    const members = castAt(section, section.start, stageSize.w, motion, earlier);
    castSig.current = castSignature(members);
    return members;
  });
  const heroes = cast.filter((m) => m.place === 'hero');
  const echoes = cast.filter((m) => m.place === 'echo');
  // The engravings are the long commit. The label paints first; the plates follow
  // on the next frame, after the song page has laid out.
  const [platesOn, setPlatesOn] = useState(() => !isPhone() || !!document.querySelector('.song.is-scrubbing'));
  useLayoutEffect(() => {
    if (platesOn) return;
    // A scrub has to show the engraving on this frame. Playback still waits
    // one frame so the opening flight can paint the label first.
    if (root.current?.closest('.song')?.classList.contains('is-scrubbing')) {
      setPlatesOn(true);
      return;
    }
    const id = requestAnimationFrame(() => setPlatesOn(true));
    return () => cancelAnimationFrame(id);
  }, [platesOn]);

  useLayoutEffect(() => {
    if (parked) {
      register(cue.idx, null);
      const r = root.current;
      if (r) {
        r.style.visibility = 'hidden';
        r.style.pointerEvents = 'none';
        r.style.zIndex = '0';
      }
      painted.current = { z: '', transform: '', opacity: '', vis: '', height: '', compact: '', fullO: '', fullS: '' };
      return;
    }
    if (root.current) root.current.style.pointerEvents = '';
    if (!compact.current) return;
    // measureEpoch forces a fresh read after the finger lifts. During the drag
    // the box is the last one we measured, so the frame does not lay out.
    const scrubbing = isPhone() && !!root.current?.closest('.song')?.classList.contains('is-scrubbing');
    if (scrubbing) {
      const known = instCompact.get(cue.idx);
      if (known != null) compactH.current = known;
    } else {
      compactH.current = compact.current.offsetHeight;
      instCompact.set(cue.idx, compactH.current);
    }
    void measureEpoch;
    register(cue.idx, call, { main: 0, sub: 0, compact: compactH.current, full: fullH });
  });

  // A reused phone slot would otherwise keep the previous section's roster.
  // Presence is not cleared: dropping it below the mount threshold removed the engravings.
  useLayoutEffect(() => {
    if (!isPhone()) return;
    const members = castAt(section, section.start, stageSize.w, motion, earlier);
    const sig = castSignature(members);
    // The mount already built this roster. A second setState in the same commit
    // was a long frame on the way in from the library.
    if (sig === castSig.current) return;
    castSig.current = sig;
    setCast(members);
    // The roster inputs are current when the cue changes. Listing them would refit every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue.idx]);

  // Pose after every commit, including the commit that mounts the stage. On a wide box the
  // roster does not change, so a cast-only effect would leave the first frame at presence 0.
  useLayoutEffect(() => {
    if (parked) return;
    const frame = frameRef.current;
    if (frame && anim.presence > 0.02) stageRef.current?.pose(frame);
  });

  const updater = useRef<BlockUpdater>(() => {});
  const call = useRef<BlockUpdater>((t, d, top, wait) => updater.current(t, d, top, wait)).current;
  updater.current = (t, d, top) => {
    const r = root.current;
    if (!r || bisect('placement')) return;
    const s = blockState(d);
    const p = s.presence;
    const z = String(20 - Math.min(18, Math.round(Math.abs(d) * 4)));
    const transform = `translate3d(0, ${top.toFixed(1)}px, 0)`;
    const opacity = entranceOpacity(d, entrance, s.opacity).toFixed(3);
    const vis = s.opacity < 0.01 ? 'hidden' : 'visible';
    const grown = compactH.current + (fullH - compactH.current) * p;
    const height = `${grown.toFixed(1)}px`;
    const box = painted.current;
    if (box.z !== z) {
      box.z = z;
      r.style.zIndex = z;
    }
    if (box.transform !== transform) {
      box.transform = transform;
      r.style.transform = transform;
    }
    if (box.opacity !== opacity || r.style.opacity !== opacity) {
      box.opacity = opacity;
      r.style.opacity = opacity;
    }
    if (box.vis !== vis || r.style.visibility !== vis) {
      box.vis = vis;
      r.style.visibility = vis;
    }
    if (box.height !== height) {
      box.height = height;
      r.style.height = height;
    }
    if (compact.current) {
      const compactO = (1 - clamp01(p * 2.5)).toFixed(3);
      if (box.compact !== compactO) {
        box.compact = compactO;
        compact.current.style.opacity = compactO;
      }
    }
    if (full.current) {
      const fullO = clamp01(p * 1.6 - 0.4).toFixed(3);
      const fullS = `scale(${(0.94 + 0.06 * p).toFixed(4)})`;
      if (box.fullO !== fullO) {
        box.fullO = fullO;
        full.current.style.opacity = fullO;
      }
      if (box.fullS !== fullS) {
        box.fullS = fullS;
        full.current.style.transform = fullS;
      }
    }
    const members = castAt(section, t, stageSize.w, motion, earlier);
    const sig = castSignature(members);
    const frame = frameFor(members, features, t, motion);
    frameRef.current = frame;
    const scrubbingNow = isPhone() && !!r.closest('.song')?.classList.contains('is-scrubbing');
    if (!bisect('instruments')) {
      // A scrub already moves the plate through this updater. A React commit
      // on every presence step was the long frame (the phone scrub budget).
      if (!scrubbingNow && !bisect('react') && sig !== castSig.current) {
        castSig.current = sig;
        setCast(members);
      }
      // The figure opacity is this frame's presence. Skipping the pose while
      // the finger moved left the engraving at the section-start value, which
      // is 0, so an instrumental passage drew only its chip.
      if (p > 0.02 || scrubbingNow) stageRef.current?.pose({ ...frame, block: p });
    }
    const steps = 50;
    const q = (v: number) => Math.round(v * steps) / steps;
    const next = { progress: q(motion === 'off' ? 1 : clamp01((t - (cue.start - 0.3)) / 2.6)), presence: q(p) };
    const cur = animRef.current;
    if (!scrubbingNow && !bisect('react') && (next.presence !== cur.presence || next.progress !== cur.progress)) {
      animRef.current = next;
      setAnim(next);
    }
    if (count.current && p > 0.01 && timed) {
      const left = (nextVocal?.start ?? cue.end) - t;
      const txt = nextVocal ? `Голос через ${formatTime(Math.max(0, left))}` : `До конца ${formatTime(Math.max(0, cue.end - t))}`;
      if (count.current.textContent !== txt) count.current.textContent = txt;
    }
  };

  useLayoutEffect(() => () => register(cue.idx, null), [cue.idx, register]);

  return (
    <div ref={root} className="fb fb--inst" aria-hidden={parked || undefined} onClick={() => onPick(cue.idx)} style={{ visibility: 'hidden' }}>
      <div ref={compact} className="fb-inst-compact t-subhead">
        <span className="fb-inst-kicker">{title ?? 'Инструменты'}</span>
        {title ? '' : ` ${names.join(' · ')}`}
      </div>
      <div ref={full} className="fb-inst-full" style={{ height: fullH }}>
        {(platesOn && heroes.length > 0 && !bisect('instruments') && (isPhone() || anim.presence > 0.02)) && (
          <InstrumentStage
            ref={stageRef}
            keys={heroes.map((m) => m.key)}
            echoes={echoes.map((m) => ({ key: m.key }))}
            performers={heroes.map((m) => (m.source >= 0 ? credited[m.source] ?? '' : ''))}
            presences={heroes.map((m) => m.presence)}
            mode={section.layout ?? 'auto'}
            progress={1}
            presence={anim.presence}
            energy={0}
            size={stageSize}
          />
        )}
        <div className="fb-inst-text">
          {section.mode && <div className="t-footnote fb-inst-mode">{section.mode}</div>}
          {section.note && <p className="t-callout fb-inst-note">{section.note}</p>}
          {timed && <span ref={count} className="fb-inst-count t-footnote tabular" />}
        </div>
      </div>
    </div>
  );
}

export const InstBlock = memo(InstBlockImpl);
