import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InstCue, Timeline } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { instrument, instrumentSvg, loadInstrumentSvg } from '@/instruments/catalog';
import type { MotionPref } from '@/app/settings';
import { clamp01, easeInCubic, easeOutCubic } from './choreo';
import type { Updater } from './LineView';

export function InstView({
  cue,
  timeline,
  motion,
  register,
}: {
  cue: InstCue;
  timeline: Timeline;
  motion: MotionPref;
  register: (idx: number, fn: Updater | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const { section } = cue;
  const keys = section.instruments.slice(0, 2);
  const names = section.instruments.map((k) => instrument(k)?.name ?? k);
  const nextVocal = timeline.cues.find((c) => c.kind === 'line' && c.start >= cue.end - 0.01);
  const [svgs, setSvgs] = useState(() => keys.map((k) => instrumentSvg(k)));
  useEffect(() => {
    if (svgs.every(Boolean)) return;
    let alive = true;
    void Promise.all(keys.map(loadInstrumentSvg)).then((list) => alive && setSvgs(list));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join()]);

  useLayoutEffect(() => {
    const fn: Updater = (t, energy) => {
      const r = root.current;
      if (!r) return;
      const a = clamp01((t - cue.show) / 0.7);
      const x = clamp01((t - (cue.hide - 0.6)) / 0.6);
      const o = easeOutCubic(a) * (1 - easeInCubic(x));
      r.style.opacity = String(o);
      r.style.transform = `translate3d(0, ${(1 - easeOutCubic(a)) * 16 - easeInCubic(x) * 12}px, 0)`;
      r.style.filter = x > 0.01 ? `blur(${(x * 8).toFixed(1)}px)` : '';
      const draw = motion === 'off' ? 1 : clamp01((t - cue.show) / 2.8);
      art.current?.style.setProperty('--draw', easeOutCubic(draw).toFixed(4));
      art.current?.style.setProperty('--hatch', clamp01((t - cue.show - 1.2) / 1.6).toFixed(3));
      art.current?.style.setProperty('--energy', motion === 'full' ? energy.toFixed(3) : '0');
      if (count.current) {
        const left = (nextVocal?.start ?? cue.end) - t;
        count.current.textContent = nextVocal ? `Голос через ${formatTime(Math.max(0, left))}` : `До конца ${formatTime(Math.max(0, cue.end - t))}`;
      }
    };
    register(cue.idx, fn);
    return () => register(cue.idx, null);
  }, [cue, motion, register, nextVocal]);

  return (
    <div ref={root} className="inst" style={{ opacity: 0 }}>
      <div ref={art} className={`inst-art${keys.length > 1 ? ' inst-art--pair' : ''}`} aria-hidden>
        {keys.map((k, i) => (
          <div key={k} className="eng" dangerouslySetInnerHTML={{ __html: svgs[i] }} />
        ))}
      </div>
      <div className="inst-text">
        <div className="inst-names t-title3">{names.join(' · ')}</div>
        {section.performers?.length ? <div className="inst-performers t-subhead secondary">{section.performers.join(', ')}</div> : null}
        {section.mode && <div className="inst-mode t-footnote">{section.mode}</div>}
        {section.note && <p className="inst-note t-callout secondary">{section.note}</p>}
        <span ref={count} className="inst-count t-footnote tabular" />
      </div>
    </div>
  );
}
