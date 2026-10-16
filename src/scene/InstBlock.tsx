import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InstCue, Timeline } from '@/data/timeline';
import type { MotionPref } from '@/app/settings';
import { formatTime } from '@/data/library';
import { instrument, instrumentSvg, loadInstrumentSvg } from '@/instruments/catalog';
import { blockState, clamp01, type Measure } from './flow';
import type { BlockUpdater } from './LineBlock';

interface Props {
  cue: InstCue;
  timeline: Timeline;
  motion: MotionPref;
  stage: { w: number; h: number };
  register: (idx: number, fn: BlockUpdater | null, m?: Measure) => void;
  onPick: (idx: number) => void;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * An instrumental passage in the flow. Ahead of time it is a compact line ("Дальше — уд, канун"),
 * on stage it opens into the engravings on a material plate, with who plays and when the voice returns.
 */
function InstBlockImpl({ cue, timeline, motion, stage, register, onPick }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const compact = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const { section } = cue;
  const keys = section.instruments;
  const shown = keys.slice(0, stage.w < 560 ? 3 : 4);
  const names = keys.map((k) => instrument(k)?.name ?? k);
  const nextVocal = timeline.cues.find((c) => c.kind === 'line' && c.start >= cue.end - 0.01);
  const [svgs, setSvgs] = useState(() => shown.map((k) => instrumentSvg(k)));

  useEffect(() => {
    if (svgs.length === shown.length && svgs.every(Boolean)) return;
    let alive = true;
    void Promise.all(shown.map(loadInstrumentSvg)).then((list) => alive && setSvgs(list));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.join()]);

  const fullH = Math.round(Math.min(stage.h * 0.66, 520));
  const compactH = useRef(56);

  useLayoutEffect(() => {
    if (!compact.current) return;
    compactH.current = compact.current.offsetHeight;
    register(cue.idx, call, { main: 0, sub: 0, compact: compactH.current, full: fullH });
  });

  const updater = useRef<BlockUpdater>(() => {});
  const call = useRef<BlockUpdater>((t, d, top, wait) => updater.current(t, d, top, wait)).current;
  updater.current = (t, d, top) => {
    const r = root.current;
    if (!r) return;
    const s = blockState(d);
    const p = s.presence;
    r.style.transform = `translate3d(0, ${top.toFixed(1)}px, 0)`;
    r.style.opacity = s.opacity.toFixed(3);
    r.style.visibility = s.opacity < 0.01 ? 'hidden' : 'visible';
    r.style.height = `${(compactH.current + (fullH - compactH.current) * p).toFixed(1)}px`;
    if (compact.current) compact.current.style.opacity = (1 - clamp01(p * 2.5)).toFixed(3);
    if (full.current) {
      full.current.style.opacity = clamp01(p * 1.6 - 0.4).toFixed(3);
      full.current.style.transform = `scale(${(0.94 + 0.06 * p).toFixed(4)})`;
    }
    // Draw-in is a function of time since the passage began, so seeking lands on the same drawing.
    const draw = motion === 'off' ? 1 : clamp01((t - (cue.start - 0.3)) / 2.6);
    art.current?.style.setProperty('--draw', easeOut(draw).toFixed(4));
    art.current?.style.setProperty('--hatch', clamp01((t - cue.start - 0.9) / 1.6).toFixed(3));
    art.current?.style.setProperty('--energy', motion === 'full' ? timeline.energyAt(t).toFixed(3) : '0');
    if (count.current && p > 0.01) {
      const left = (nextVocal?.start ?? cue.end) - t;
      const txt = nextVocal ? `Голос через ${formatTime(Math.max(0, left))}` : `До конца ${formatTime(Math.max(0, cue.end - t))}`;
      if (count.current.textContent !== txt) count.current.textContent = txt;
    }
  };

  useLayoutEffect(() => () => register(cue.idx, null), [cue.idx, register]);

  return (
    <div ref={root} className="fb fb--inst" onClick={() => onPick(cue.idx)} style={{ visibility: 'hidden' }}>
      <div ref={compact} className="fb-inst-compact t-subhead">
        <span className="fb-inst-kicker">Инструменты</span> {names.join(' · ')}
      </div>
      <div ref={full} className="fb-inst-full" style={{ height: fullH }}>
        <div ref={art} className={`fb-inst-art n${shown.length}`} aria-hidden>
          {shown.map((k, i) => (
            <div key={k} className="fb-inst-cell material">
              <div className="eng" dangerouslySetInnerHTML={{ __html: svgs[i] ?? '' }} />
              <div className="fb-inst-name t-footnote">
                {instrument(k)?.name ?? k}
                {instrument(k)?.native && <span className="fb-inst-native"> {instrument(k)!.native}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="fb-inst-text">
          {keys.length > shown.length && <div className="t-subhead">{names.join(' · ')}</div>}
          {section.performers?.length ? <div className="t-subhead fb-inst-who">{section.performers.join(', ')}</div> : null}
          {section.mode && <div className="t-footnote fb-inst-mode">{section.mode}</div>}
          {section.note && <p className="t-callout fb-inst-note">{section.note}</p>}
          <span ref={count} className="fb-inst-count t-footnote tabular" />
        </div>
      </div>
    </div>
  );
}

export const InstBlock = memo(InstBlockImpl);
