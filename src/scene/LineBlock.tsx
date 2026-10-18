import { memo, useLayoutEffect, useRef } from 'react';
import type { LineCue } from '@/data/timeline';
import type { LineEntrance, MotionPref, Settings } from '@/app/settings';
import { formatTime } from '@/data/library';
import { blockState, clamp01, entranceOpacity, scriptShift, type Measure } from './flow';
import { showHarakatText } from '@/data/harakat';
import { fontClass } from './fonts';

/**
 * Per-frame update from the Scene: time, distance from the current position, top in px, and
 * `wait` (0…1): how visible the "next line in N s" hint above this block is.
 */
export type BlockUpdater = (t: number, d: number, top: number, wait: number) => void;

interface Props {
  cue: LineCue;
  /** Word-by-word fill only where the timing is measured and checked; otherwise the whole line lights up. */
  wordSync: boolean;
  settings: Pick<Settings, 'fontPersian' | 'showTranslation' | 'showTranslit' | 'showAlt' | 'showHarakat' | 'textScale'>;
  entrance: LineEntrance;
  motion: MotionPref;
  stage: { w: number; h: number };
  register: (idx: number, fn: BlockUpdater | null, m?: Measure) => void;
  onPick: (idx: number) => void;
}

/** Longest a word may take to fill; a held note keeps the word lit instead of crawling for seconds. */
const FILL_MAX = 1.6;
/** Extra room around each word for the text-clipped fill (Nastaliq and Naskh glyphs overflow their box). */
const PAD_X = 0.21;

/** Light markup in translations: **key word** (the counterpart of the accented original word), *nuance*. */
export function TrText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <strong key={i} className="tr-em">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith('*') ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          p
        ),
      )}
    </>
  );
}

function LineBlockImpl({ cue, wordSync, settings, entrance, motion, stage, register, onPick }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const orig = useRef<HTMLDivElement>(null);
  const subs = useRef<HTMLDivElement>(null);
  const wait = useRef<HTMLSpanElement>(null);
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const fontPx = useRef(40);

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
    // A short wide window (car, low landscape) must not shrink the line with the height.
    // 30px Latin / 36px Arabic is the design size there; the fit may ease down only to 28 / 34.
    const vh = window.innerHeight || 852;
    const vw = window.innerWidth || stage.w;
    const car = vw >= 700 && vh <= 640;
    const width = Math.min(stage.w - (car ? 36 : 56), car ? 1100 : 720);
    const arab = line.script === 'Arab' || line.script === 'Aran';
    const maxH = car
      ? Math.max(64, stage.h * (hasSubs ? 0.62 : 0.74))
      : Math.max(72, stage.h * (hasSubs ? (arab ? 0.5 : 0.4) : 0.46));
    const floor = car ? (arab ? 34 : 28) : 13;
    // Phone design size, scaled by the window: 33px Latin/Cyrillic, 40px Arabic and Persian, never below 13.
    const design = car
      ? Math.max(floor, (arab ? 36 : 30) * settings.textScale)
      : (arab ? 40 : 33) * (vh / 852) * settings.textScale;
    const upper = Math.max(floor, design);
    const lower = floor;
    el.style.width = `${width}px`;
    let lo = lower;
    let hi = upper;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= maxH && el.scrollWidth <= width + 1) lo = mid;
      else hi = mid;
    }
    // lo is a size that already fits. Round it, then step back if the integer overflows.
    let fitted = Math.min(upper, Math.max(lower, Math.round(lo)));
    el.style.fontSize = `${fitted}px`;
    if (el.scrollHeight > maxH + 1 || el.scrollWidth > width + 1) {
      fitted = Math.min(upper, Math.max(lower, Math.floor(lo)));
      el.style.fontSize = `${fitted}px`;
    }
    fontPx.current = fitted;
    widths.current = words.current.map((w) => w?.offsetWidth ?? 0);
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
    const x = entrance === 'script' ? scriptShift(d, cue.rtl, stage.w, still) : 0;
    r.style.zIndex = String(20 - Math.min(18, Math.round(Math.abs(d) * 4)));
    r.style.transform = `translate3d(${x.toFixed(1)}px, ${top.toFixed(1)}px, 0) scale(${s.scale.toFixed(4)})`;
    r.style.opacity = entranceOpacity(d, entrance, s.opacity).toFixed(3);
    r.style.filter = entrance === 'flow' && !still && motion === 'full' && s.blur > 0.05 ? `blur(${s.blur.toFixed(2)}px)` : '';
    r.style.visibility = s.opacity < 0.01 ? 'hidden' : 'visible';
    r.classList.toggle('is-current', Math.abs(d) < 0.5);
    if (subs.current) subs.current.style.opacity = s.sub.toFixed(3);

    // Every word is visible from the start (dim). With measured timing, each word fills in reading
    // direction as it is sung; otherwise the whole line lights up while it is current.
    // One text layer per word, coloured through background-clip:text — no overlay, so letters that
    // join (Arabic, Persian) are drawn once and never double at the joins.
    const o = orig.current;
    if (o) {
      const lit = d <= 0 ? 1 : clamp01((0.5 - d) / 0.5);
      o.style.setProperty('--litf', (wordSync ? (d < 0 ? 1 : 0) : lit).toFixed(3));
    }
    for (let i = 0; i < line.words.length; i++) {
      const el = words.current[i];
      if (!el) continue;
      const w = line.words[i];
      if (wordSync && d > -1) {
        const span = Math.min(FILL_MAX, Math.max(0.08, w.e - w.s));
        const f = clamp01((t - w.s) / span);
        if (f <= 0 || f >= 1) {
          if (el.dataset.f !== String(f)) {
            el.dataset.f = String(f);
            el.classList.remove('is-filling');
            el.classList.toggle('is-sung', f >= 1);
            el.style.backgroundImage = '';
          }
        } else {
          el.dataset.f = 'x';
          el.classList.add('is-filling');
          const W = widths.current[i] || el.offsetWidth || 1;
          const pad = PAD_X * fontPx.current;
          const at = ((pad + f * (W - 2 * pad)) / W) * 100;
          const soft = Math.max(2, ((0.12 * (W - 2 * pad)) / W) * 100);
          el.style.backgroundImage = `linear-gradient(${cue.rtl ? 'to left' : 'to right'}, var(--w-lit) ${(at - soft).toFixed(1)}%, var(--w-dim) ${(at + soft).toFixed(1)}%)`;
        }
        if (motion === 'full') {
          // The word being sung rises a hair, then settles.
          const active = t >= w.s && t < w.e + 0.15 ? Math.sin(Math.PI * clamp01((t - w.s) / Math.max(0.25, w.e - w.s + 0.15))) : 0;
          el.style.transform = active > 0.001 ? `translate3d(0, ${(-active * 0.05).toFixed(3)}em, 0)` : '';
        }
      } else if (el.dataset.f) {
        delete el.dataset.f;
        el.classList.remove('is-filling', 'is-sung');
        el.style.backgroundImage = '';
        el.style.transform = '';
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
        <div ref={orig} className={`fb-orig ${fClass}`} dir={cue.rtl ? 'rtl' : 'ltr'}>
          {line.words.map((w, i) => (
            <span key={i} className="w-wrap">
              <span
                ref={(el) => {
                  words.current[i] = el;
                }}
                className={`w${w.em ? ' w--em' : ''}`}
              >
                {showHarakatText(w.w, settings.showHarakat)}
              </span>
              {/* A sized box, not a trailing space inside the word: RTL drops that space and the words glue. */}
              {w.br ? <span className="w-br" /> : i < line.words.length - 1 ? <span className="w-sp" aria-hidden="true" /> : null}
            </span>
          ))}
        </div>
      </div>
      {hasSubs && (
        <div ref={subs} className="fb-subs" dir="ltr">
          {showAlt && (
            <div className="fb-alt f-mushaf" dir="rtl" lang={line.lang}>
              {showHarakatText(line.alt!.text, settings.showHarakat)}
            </div>
          )}
          {showTl && (
            <div className="fb-translit" lang="ru">
              {line.translit}
            </div>
          )}
          {showTr && (
            <p className="fb-tr" lang="ru">
              <TrText text={line.tr.ru} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const LineBlock = memo(LineBlockImpl);
