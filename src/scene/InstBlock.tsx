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

interface Props {
  cue: InstCue;
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
    drives: heroes.map((m) => stageDrive(features, m.key, m.at, m.calm, t, motion)),
    plates: heroes.map((m) => m.presence),
    echoes: echoes.map((m) => ({ drive: stageDrive(features, m.key, m.at, m.calm, t, motion), presence: m.presence })),
  };
}

/**
 * An instrumental passage in the flow. Ahead of time it is a compact line ("Дальше — уд, канун"),
 * on stage it opens into the engravings, one arrival at a time, with who plays and when the voice returns.
 * A passage that is only voice or choir keeps that engraving and does not invent an orchestra.
 */
function InstBlockImpl({ cue, timeline, timed, entrance, motion, stage, features, register, onPick }: Props) {
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
  const [cast, setCast] = useState<CastMember[]>(() => castAt(section, section.start, stageSize.w, motion));
  const heroes = cast.filter((m) => m.place === 'hero');
  const echoes = cast.filter((m) => m.place === 'echo');

  useLayoutEffect(() => {
    if (!compact.current) return;
    compactH.current = compact.current.offsetHeight;
    register(cue.idx, call, { main: 0, sub: 0, compact: compactH.current, full: fullH });
  });

  // Pose after every commit, including the commit that mounts the stage. On a wide box the
  // roster does not change, so a cast-only effect would leave the first frame at presence 0.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame && anim.presence > 0.02) stageRef.current?.pose(frame);
  });

  const updater = useRef<BlockUpdater>(() => {});
  const call = useRef<BlockUpdater>((t, d, top, wait) => updater.current(t, d, top, wait)).current;
  updater.current = (t, d, top) => {
    const r = root.current;
    if (!r) return;
    const s = blockState(d);
    const p = s.presence;
    r.style.zIndex = String(20 - Math.min(18, Math.round(Math.abs(d) * 4)));
    r.style.transform = `translate3d(0, ${top.toFixed(1)}px, 0)`;
    r.style.opacity = entranceOpacity(d, entrance, s.opacity).toFixed(3);
    r.style.visibility = s.opacity < 0.01 ? 'hidden' : 'visible';
    r.style.height = `${(compactH.current + (fullH - compactH.current) * p).toFixed(1)}px`;
    if (compact.current) compact.current.style.opacity = (1 - clamp01(p * 2.5)).toFixed(3);
    if (full.current) {
      full.current.style.opacity = clamp01(p * 1.6 - 0.4).toFixed(3);
      full.current.style.transform = `scale(${(0.94 + 0.06 * p).toFixed(4)})`;
    }
    const members = castAt(section, t, stageSize.w, motion);
    const sig = castSignature(members);
    const frame = frameFor(members, features, t, motion);
    frameRef.current = frame;
    if (sig !== castSig.current) {
      castSig.current = sig;
      setCast(members);
    } else if (p > 0.02) {
      stageRef.current?.pose(frame);
    }
    const q = (v: number) => Math.round(v * 50) / 50;
    const next = { progress: q(motion === 'off' ? 1 : clamp01((t - (cue.start - 0.3)) / 2.6)), presence: q(p) };
    const cur = animRef.current;
    if (next.presence !== cur.presence || next.progress !== cur.progress) {
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
    <div ref={root} className="fb fb--inst" onClick={() => onPick(cue.idx)} style={{ visibility: 'hidden' }}>
      <div ref={compact} className="fb-inst-compact t-subhead">
        <span className="fb-inst-kicker">{title ?? 'Инструменты'}</span>
        {title ? '' : ` ${names.join(' · ')}`}
      </div>
      <div ref={full} className="fb-inst-full" style={{ height: fullH }}>
        {anim.presence > 0.02 && heroes.length > 0 && (
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
