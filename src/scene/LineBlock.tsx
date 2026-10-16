import { memo, useLayoutEffect, useRef } from 'react';
import type { LineCue } from '@/data/timeline';
import type { MotionPref, Settings } from '@/app/settings';
import { formatTime } from '@/data/library';
import { blockState, clamp01, type Measure } from './flow';
import { fontClass } from './fonts';

/**
 * Per-frame update from the Scene: time, distance from the current position, top in px, and
 * `wait` (0…1): how visible the "next line in N s" hint above this block is.
 */
export type BlockUpdater = (t: number, d: number, top: number, wait: number) => void;

interface Props {
  cue: LineCue;
  settings: Pick<Settings, 'persianStyle' | 'showTranslation' | 'showTranslit' | 'showAlt' | 'textScale'>;
  motion: MotionPref;
  stage: { w: number; h: number };
  register: (idx: number, fn: BlockUpdater | null, m?: Measure) => void;
  onPick: (idx: number) => void;
}

/** Longest a word may take to fill; a held note keeps the word lit instead of crawling for seconds. */
const FILL_MAX = 1.6;

function LineBlockImpl({ cue, settings, motion, stage, register, onPick }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const orig = useRef<HTMLDivElement>(null);
  const subs = useRef<HTMLDivElement>(null);
  const wait = useRef<HTMLSpanElement>(null);
  const lits = useRef<(HTMLSpanElement | null)[]>([]);
  const words = useRef<(HTMLSpanElement | null)[]>([]);

  const { line } = cue;
  const fClass = fontClass(line, settings);
  const showTr = settings.showTranslation && !!line.tr.ru;
  const showTl = settings.showTranslit && !!line.translit;
  const showAlt = settings.showAlt && !!line.alt;
  const hasSubs = showTr || showTl || showAlt;
  const meta = [cue.voiceChanged ? cue.voice : null].filter(Boolean) as string[];

  // Fit the original: as large as possible within the width and about a third of the stage height.
  useLayoutEffect(() => {
    const el = orig.current;
    const r = root.current;
    if (!el || !r || !stage.w) return;
    const width = Math.min(stage.w - 56, 720);
    const maxH = Math.max(90, stage.h * (hasSubs ? 0.3 : 0.38));
    const arab = line.script === 'Arab';
    const nast = fClass === 'f-nastaliq';
    const upper = Math.min(arab ? (nast ? 64 : 76) : 68, width * (arab ? 0.13 : 0.115)) * settings.textScale;
    const lower = 20 * settings.textScale;
    el.style.width = `${width}px`;
    let lo = lower;
    let hi = upper;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= maxH && el.scrollWidth <= width + 1) lo = mid;
      else hi = mid;
    }
    el.style.fontSize = `${Math.floor(lo)}px`;
    // The translation's share includes its top margin: total height minus the original's block.
    const mainH = main.current!.offsetHeight;
    const m: Measure = { main: mainH, sub: subs.current ? r.offsetHeight - mainH : 0 };
    register(cue.idx, call, m);
  });

  const updater = useRef<BlockUpdater>(() => {});
  const call = useRef<BlockUpdater>((t, d, top, wait) => updater.current(t, d, top, wait)).current;
  updater.current = (t, d, top, waitV) => {
    const r = root.current;
    if (!r) return;
    const s = blockState(d);
    const still = motion === 'off';
    r.style.transform = `translate3d(0, ${top.toFixed(1)}px, 0) scale(${s.scale.toFixed(4)})`;
    r.style.opacity = s.opacity.toFixed(3);
    r.style.filter = !still && motion === 'full' && s.blur > 0.05 ? `blur(${s.blur.toFixed(2)}px)` : '';
    r.style.visibility = s.opacity < 0.01 ? 'hidden' : 'visible';
    r.classList.toggle('is-current', Math.abs(d) < 0.5);
    if (subs.current) subs.current.style.opacity = s.sub.toFixed(3);

    // Karaoke: every word is visible from the start (dim) and fills in reading direction as it is sung.
    for (let i = 0; i < line.words.length; i++) {
      const lit = lits.current[i];
      if (!lit) continue;
      const w = line.words[i];
      const span = Math.min(FILL_MAX, Math.max(0.08, w.e - w.s));
      const f = clamp01((t - w.s) / span);
      if (f >= 1) lit.style.maskImage = lit.style.webkitMaskImage = 'none';
      else if (f <= 0) lit.style.maskImage = lit.style.webkitMaskImage = 'linear-gradient(transparent, transparent)';
      else {
        // A soft edge 18 % wide travelling across the word.
        const p = f * 118 - 9;
        const m = `linear-gradient(${cue.rtl ? 270 : 90}deg, #000 ${(p - 9).toFixed(1)}%, transparent ${(p + 9).toFixed(1)}%)`;
        lit.style.maskImage = lit.style.webkitMaskImage = m;
      }
      const el = words.current[i];
      if (el && motion === 'full') {
        // The word being sung rises a hair, then settles.
        const active = t >= w.s && t < w.e + 0.15 ? Math.sin(Math.PI * clamp01((t - w.s) / Math.max(0.25, w.e - w.s + 0.15))) : 0;
        el.style.transform = active > 0.001 ? `translate3d(0, ${(-active * 0.05).toFixed(3)}em, 0)` : '';
      }
    }

    // A long pause before this line (it is next): say how long, so the reader is not left guessing.
    if (wait.current) {
      wait.current.style.opacity = waitV.toFixed(3);
      if (waitV > 0) {
        const txt = `через ${formatTime(Math.max(0, cue.start - t))}`;
        if (wait.current.textContent !== txt) wait.current.textContent = txt;
      }
    }
  };

  useLayoutEffect(() => () => register(cue.idx, null), [cue.idx, register]);

  return (
    <div
      ref={root}
      className="fb fb--line"
      dir={cue.rtl ? 'rtl' : 'ltr'}
      lang={line.lang}
      onClick={() => onPick(cue.idx)}
      style={{ visibility: 'hidden' }}
    >
      <div ref={main} className="fb-main">
        <span ref={wait} className="fb-wait t-footnote" dir="ltr" />
        {(meta.length > 0 || cue.repeat > 0) && (
          <div className="fb-meta t-footnote" dir="ltr">
            {meta.map((m) => (
              <span key={m} className="fb-voice">
                {m}
              </span>
            ))}
            {cue.repeat > 0 && <span className="fb-repeat">повтор</span>}
          </div>
        )}
        <div ref={orig} className={`fb-orig ${fClass}`}>
          {line.words.map((w, i) => (
            <span key={i} className="w-wrap">
              <span
                ref={(el) => {
                  words.current[i] = el;
                }}
                className={`w${w.em ? ' w--em' : ''}`}
              >
                <span className="w-base">{w.w}</span>
                <span
                  ref={(el) => {
                    lits.current[i] = el;
                  }}
                  className="w-lit"
                  aria-hidden
                >
                  {w.w}
                </span>
              </span>
              {w.br && <span className="w-br" />}
            </span>
          ))}
        </div>
      </div>
      {hasSubs && (
        <div ref={subs} className="fb-subs" dir="ltr">
          {showAlt && (
            <div className="fb-alt f-mushaf" dir="rtl" lang={line.lang}>
              {line.alt!.text}
            </div>
          )}
          {showTl && (
            <div className="fb-translit" lang="ru">
              {line.translit}
            </div>
          )}
          {showTr && (
            <p className="fb-tr" lang="ru">
              {line.tr.ru}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const LineBlock = memo(LineBlockImpl);
