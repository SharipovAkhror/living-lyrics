import { useLayoutEffect, useMemo, useRef } from 'react';
import type { LineCue } from '@/data/timeline';
import type { Settings, MotionPref } from '@/app/settings';
import { exitProgress, letterStyleAt, lineStyleAt, wordStyleAt } from './choreo';

export type Updater = (t: number, energy: number) => void;

export function fontClass(cue: LineCue, s: Pick<Settings, 'persianStyle'>) {
  if (cue.line.script === 'Arab') return cue.line.lang === 'fa' && s.persianStyle === 'nastaliq' ? 'f-nastaliq' : 'f-mushaf';
  return 'f-serif';
}

/** Graphemes, so combining marks stay with their letter in the cascade. */
function letters(word: string) {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(word), (x) => x.segment);
  return Array.from(word);
}

interface Props {
  cue: LineCue;
  settings: Settings;
  motion: MotionPref;
  stage: { w: number; h: number };
  register: (idx: number, fn: Updater | null) => void;
}

export function LineView({ cue, settings, motion, stage, register }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const orig = useRef<HTMLDivElement>(null);
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const lits = useRef<(HTMLSpanElement | null)[]>([]);
  const letterEls = useRef<HTMLSpanElement[][]>([]);
  const subs = useRef<HTMLDivElement>(null);

  const { line } = cue;
  const cascade = cue.fx === 'cascade' && !cue.rtl && motion === 'full';
  const fClass = fontClass(cue, settings);
  const showTr = settings.showTranslation && !!line.tr.ru;
  const showTl = settings.showTranslit && !!line.translit;
  const showAlt = settings.showAlt && !!line.alt;
  const hasSubs = showTr || showTl || showAlt;
  const split = useMemo(() => line.words.map((w) => (cascade ? letters(w.w) : [w.w])), [line.words, cascade]);

  // Fit the original to the stage: as large as possible without exceeding its share of the height.
  useLayoutEffect(() => {
    const el = orig.current;
    if (!el || !stage.w) return;
    const width = Math.min(stage.w - 32, 1180);
    const maxH = stage.h * (hasSubs ? 0.5 : 0.66);
    const arab = line.script === 'Arab';
    const nast = fClass === 'f-nastaliq';
    const upper = Math.min(arab ? (nast ? 92 : 120) : 108, width * (arab ? 0.14 : 0.13)) * settings.textScale;
    const lower = 22 * settings.textScale;
    el.style.width = `${width}px`;
    let lo = lower;
    let hi = upper;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      const fits = el.scrollHeight <= maxH && el.scrollWidth <= width + 1;
      if (fits) lo = mid;
      else hi = mid;
    }
    el.style.fontSize = `${Math.floor(lo)}px`;
  }, [stage.w, stage.h, hasSubs, settings.textScale, fClass, line.script, split]);

  useLayoutEffect(() => {
    const fn: Updater = (t, energy) => {
      const ls = lineStyleAt(cue, t, motion);
      const r = root.current;
      if (!r) return;
      r.style.opacity = String(ls.opacity);
      r.style.transform = `translate3d(0, ${ls.y}px, 0) scale(${ls.scale})`;
      r.style.filter = ls.blur > 0.05 ? `blur(${ls.blur.toFixed(2)}px)` : '';
      if (subs.current) {
        subs.current.style.opacity = String(ls.sub);
        subs.current.style.transform = `translate3d(0, ${(1 - ls.sub) * 10}px, 0)`;
      }
      const exitX = exitProgress(cue, t, motion);
      for (let i = 0; i < line.words.length; i++) {
        const el = words.current[i];
        const lit = lits.current[i];
        if (!el || !lit) continue;
        const s = wordStyleAt(cue, i, t, motion, energy);
        el.style.opacity = String(s.opacity);
        el.style.transform =
          s.x || s.y || s.rot || s.scale !== 1
            ? `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) rotate(${s.rot.toFixed(2)}deg) scale(${s.scale.toFixed(3)})`
            : '';
        el.style.filter = s.blur > 0.05 ? `blur(${s.blur.toFixed(2)}px)` : '';
        // Karaoke fill in reading direction.
        if (s.fill >= 1) lit.style.clipPath = 'none';
        else {
          const rest = ((1 - s.fill) * 100).toFixed(2);
          lit.style.clipPath = cue.rtl ? `inset(0 0 0 ${rest}%)` : `inset(0 ${rest}% 0 0)`;
        }
        // Ink reveal: a soft-edged mask sweeping in reading direction.
        if (s.reveal >= 1) {
          el.style.maskImage = '';
          el.style.webkitMaskImage = '';
        } else {
          const p = s.reveal * 130 - 15;
          const m = `linear-gradient(${cue.rtl ? 270 : 90}deg, #000 ${p.toFixed(1)}%, transparent ${(p + 15).toFixed(1)}%)`;
          el.style.maskImage = m;
          el.style.webkitMaskImage = m;
        }
        lit.style.textShadow = s.glow > 0.02 ? `0 0 ${(s.glow * 26).toFixed(1)}px color-mix(in srgb, var(--accent) ${(s.glow * 90).toFixed(0)}%, transparent)` : '';
        if (cascade) {
          const ls2 = letterEls.current[i];
          const w = line.words[i];
          if (ls2) {
            const m = ls2.length / 2;
            for (let j = 0; j < ls2.length; j++) {
              const jj = j % m;
              const st = letterStyleAt(jj, m, t, w.s, w.e - w.s, exitX);
              const le = ls2[j];
              le.style.opacity = String(st.opacity);
              le.style.transform = `translate3d(0, ${st.y.toFixed(1)}px, 0)`;
            }
          }
        }
      }
    };
    register(cue.idx, fn);
    return () => register(cue.idx, null);
  }, [cue, motion, register, line.words, cascade]);

  const isStack = cue.fx === 'stack' && motion === 'full';

  return (
    <div
      ref={root}
      className={`ln fx-${cue.fx}${isStack ? ' ln--stack' : ''}`}
      dir={cue.rtl ? 'rtl' : 'ltr'}
      lang={line.lang}
      style={{ opacity: 0 }}
    >
      {line.voice && <div className="ln-voice t-footnote">{line.voice}</div>}
      <div ref={orig} className={`ln-orig ${fClass}`}>
        {line.words.map((w, i) => (
          <span key={i} className="w-wrap">
            <span
              ref={(el) => {
                words.current[i] = el;
              }}
              className={`w${w.em ? ' w--em' : ''}`}
            >
              <span className="w-base">
                {cascade
                  ? split[i].map((ch, j) => (
                      <span
                        key={j}
                        className="ch"
                        ref={(el) => {
                          if (!el) return;
                          (letterEls.current[i] ??= [])[j] = el;
                        }}
                      >
                        {ch}
                      </span>
                    ))
                  : w.w}
              </span>
              <span
                ref={(el) => {
                  lits.current[i] = el;
                }}
                className="w-lit"
                aria-hidden
              >
                {cascade
                  ? split[i].map((ch, j) => (
                      <span
                        key={j}
                        className="ch"
                        ref={(el) => {
                          if (!el) return;
                          (letterEls.current[i] ??= [])[split[i].length + j] = el;
                        }}
                      >
                        {ch}
                      </span>
                    ))
                  : w.w}
              </span>
            </span>
            {w.br && <span className="w-br" />}
          </span>
        ))}
      </div>
      {hasSubs && (
        <div ref={subs} className="ln-subs" dir="ltr" style={{ opacity: 0 }}>
          {showAlt && (
            <div className="ln-alt f-mushaf" dir="rtl" lang={line.lang}>
              {line.alt!.text}
            </div>
          )}
          {showTl && (
            <div className="ln-translit" lang="ru">
              {line.translit}
            </div>
          )}
          {showTr && (
            <p className="ln-tr" lang="ru">
              {line.tr.ru}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
