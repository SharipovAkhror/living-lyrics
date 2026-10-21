import { memo, useLayoutEffect, useRef } from 'react';
import type { LineCue } from '@/data/timeline';
import type { LineEntrance, MotionPref, Settings } from '@/app/settings';
import { formatTime } from '@/data/library';
import { fillEdgePercent, fillMaskDirection, wordFillFraction } from './fill';
import { blockState, clamp01, entranceOpacity, scriptShift, type Measure } from './flow';
import { showHarakatText } from '@/data/harakat';
import { fontClass } from './fonts';
import { bisect } from '@/app/bisect';
import { isPhone } from '@/ui/phone';

/**
 * Per-frame update from the Scene: time, distance from the current position, top in px, and
 * `wait` (0…1): how visible the "next line in N s" hint above this block is.
 */
export type BlockUpdater = (t: number, d: number, top: number, wait: number) => void;

interface Props {
  cue: LineCue;
  /** Phone slot that has left the window. The host stays mounted and is not measured. */
  parked?: boolean;
  /** Word-by-word fill only where the timing is measured and checked; otherwise the whole line lights up. */
  wordSync: boolean;
  settings: Pick<Settings, 'fontPersian' | 'showTranslation' | 'showTranslit' | 'showAlt' | 'showHarakat' | 'textScale'>;
  entrance: LineEntrance;
  motion: MotionPref;
  stage: { w: number; h: number };
  register: (idx: number, fn: BlockUpdater | null, m?: Measure) => void;
  onPick: (idx: number) => void;
}

/**
 * Phone lines reuse one host. A fixed row of word nodes means the next lyric
 * only changes text: WebKit was retaining a backing store for every removed span.
 */
const PHONE_WORD_POOL = 40;

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

function LineBlockImpl({ cue, parked = false, wordSync, settings, entrance, motion, stage, register, onPick }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const orig = useRef<HTMLDivElement>(null);
  const subs = useRef<HTMLDivElement>(null);
  const wait = useRef<HTMLSpanElement>(null);
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const fontPx = useRef(40);
  const wordPool = useRef(PHONE_WORD_POOL);
  const filterRef = useRef('');
  // Last strings actually written. WebKit grows its working set on a repeated write even when the pixels match.
  const painted = useRef({ transform: '', opacity: '', z: '', vis: '', sub: '', wait: '', lit: '', cur: '' });

  const { line } = cue;
  const fClass = fontClass(line, settings);
  const phone = isPhone();
  if (phone && line.words.length > wordPool.current) wordPool.current = line.words.length;
  const showTr = settings.showTranslation && !!line.tr.ru;
  const showTl = settings.showTranslit && !!line.translit;
  const showAlt = settings.showAlt && !!line.alt;
  const hasSubs = showTr || showTl || showAlt;
  const meta = [cue.voiceChanged ? cue.voice : null].filter(Boolean) as string[];

  // A slot is reused for the next line. Drop the previous line's layers before the fit.
  useLayoutEffect(() => {
    painted.current = { transform: '', opacity: '', z: '', vis: '', sub: '', wait: '', lit: '', cur: '' };
    filterRef.current = '';
    if (orig.current) {
      orig.current.style.opacity = '';
      orig.current.style.removeProperty('--litf');
    }
    for (const el of words.current) {
      if (!el) continue;
      delete el.dataset.f;
      el.classList.remove('is-filling', 'is-sung');
      el.style.removeProperty('--fill-cut');
      el.style.removeProperty('--fill-dir');
      el.style.removeProperty('background-image');
      el.style.transform = '';
    }
    if (root.current) root.current.style.visibility = 'hidden';
  }, [cue.idx]);

  // Fit the original: as large as possible within the width and about a third of the stage height.
  useLayoutEffect(() => {
    if (parked) {
      register(cue.idx, null);
      const r = root.current;
      if (r) {
        r.style.visibility = 'hidden';
        r.style.pointerEvents = 'none';
        r.style.zIndex = '0';
      }
      painted.current = { transform: '', opacity: '', z: '', vis: '', sub: '', wait: '', lit: '', cur: '' };
      return;
    }
    if (root.current) root.current.style.pointerEvents = '';
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
    if (isPhone()) {
      // The stylesheet already holds the design size, including the text-scale
      // variables below. Walking font-size (eight tries per line, every seek)
      // kept a WebKit backing store for each write. A line that does not fit
      // wraps; it is not restyled.
      if (bisect('measure')) {
        widths.current = [];
        register(cue.idx, call, { main: 72, sub: hasSubs ? 36 : 0 });
        return;
      }
      const readBox = (): Measure => {
        const mainH = main.current!.offsetHeight;
        return { main: mainH, sub: subs.current ? r.offsetHeight - mainH : 0 };
      };
      widths.current = words.current.map((w) => w?.offsetWidth ?? 0);
      const m = readBox();
      register(cue.idx, call, m);
      // text-wrap: balance and late fonts can drop a line after this read. One more
      // frame picks that up; the scene places again only if the box actually changed.
      requestAnimationFrame(() => {
        if (!orig.current || !root.current || !main.current) return;
        widths.current = words.current.map((w) => w?.offsetWidth ?? 0);
        register(cue.idx, call, readBox());
      });
      return;
    }
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
    if (!r || bisect('placement')) return;
    const s = blockState(d);
    const still = motion === 'off';
    const phone = isPhone();
    const x = entrance === 'script' ? scriptShift(d, cue.rtl, stage.w, still) : 0;
    const z = String(20 - Math.min(18, Math.round(Math.abs(d) * 4)));
    if (painted.current.z !== z) {
      painted.current.z = z;
      r.style.zIndex = z;
    }
    const transform = `translate3d(${x.toFixed(1)}px, ${top.toFixed(1)}px, 0) scale(${s.scale.toFixed(phone ? 3 : 4)})`;
    if (painted.current.transform !== transform) {
      painted.current.transform = transform;
      r.style.transform = transform;
    }
    const opacity = entranceOpacity(d, entrance, s.opacity).toFixed(phone ? 2 : 3);
    if (painted.current.opacity !== opacity) {
      painted.current.opacity = opacity;
      r.style.opacity = opacity;
    }
    // A CSS blur on the line allocated a fresh filtered bitmap on this WebKit.
    // The line already fades by opacity, which is what the phone keeps.
    const blurOn = !phone && entrance === 'flow' && !still && motion === 'full' && s.blur > 0.05;
    const nextFilter = blurOn ? `blur(${s.blur.toFixed(2)}px)` : '';
    if (filterRef.current !== nextFilter) {
      filterRef.current = nextFilter;
      r.style.filter = nextFilter;
    }
    const vis = s.opacity < 0.01 ? 'hidden' : 'visible';
    if (painted.current.vis !== vis) {
      painted.current.vis = vis;
      r.style.visibility = vis;
    }
    const cur = Math.abs(d) < 0.5 ? '1' : '0';
    if (painted.current.cur !== cur) {
      painted.current.cur = cur;
      r.classList.toggle('is-current', cur === '1');
    }
    if (subs.current) {
      const sub = s.sub.toFixed(3);
      if (painted.current.sub !== sub) {
        painted.current.sub = sub;
        subs.current.style.opacity = sub;
      }
    }

    // Every word is visible from the start (dim). With measured timing, each word fills in the
    // writing direction as it is sung; otherwise the whole line lights up while it is current.
    // One text layer. The moving edge is a mask on the word box, so joined letters are painted
    // once. A translucent colour on the glyphs would darken the joins.
    const o = orig.current;
    if (o && !bisect('words')) {
      const lit = d <= 0 ? 1 : clamp01((0.5 - d) / 0.5);
      const rawLit = wordSync ? (d < 0 ? 1 : 0) : lit;
      if (wordSync) {
        // 0 or 1 only. The sung word is the mask, not a new colour on the glyphs.
        const litf = rawLit >= 1 ? '1' : '0';
        if (painted.current.lit !== litf) {
          painted.current.lit = litf;
          o.style.opacity = '';
          o.style.setProperty('--litf', litf);
        }
      } else {
        // One opacity on the line. --litf on every word re-rasterised the glyphs
        // and the working set climbed about 16 MB/min (T27). Tenths still read as a fade.
        const step = phone ? rawLit.toFixed(1) : rawLit.toFixed(3);
        if (painted.current.lit !== `o${step}`) {
          painted.current.lit = `o${step}`;
          const dim = Number(getComputedStyle(o).getPropertyValue('--dim-op'));
          const dimN = Number.isFinite(dim) ? dim : 0.42;
          o.style.removeProperty('--litf');
          o.style.opacity = (dimN + (1 - dimN) * Number(step)).toFixed(phone ? 2 : 3);
        }
      }
    }
    if (bisect('words')) return;
    for (let i = 0; i < line.words.length; i++) {
      const el = words.current[i];
      if (!el) continue;
      const w = line.words[i];
      if (wordSync && d > -1) {
        const f = wordFillFraction(t, w.s, w.e);
        if (f <= 0 || f >= 1) {
          const mark = f >= 1 ? '1' : '0';
          if (el.dataset.f !== mark) {
            el.dataset.f = mark;
            el.classList.remove('is-filling');
            el.classList.toggle('is-sung', f >= 1);
            el.style.removeProperty('--fill-cut');
            el.style.removeProperty('--fill-dir');
            el.style.removeProperty('background-image');
          }
        } else {
          el.dataset.f = 'x';
          el.classList.add('is-filling');
          el.classList.remove('is-sung');
          el.style.removeProperty('background-image');
          const W = widths.current[i] || el.offsetWidth || 1;
          // The edge is a step, and its place is fixed by t, so a seek lands on the same cut.
          // A phone keeps a few dozen mask strings per word. WebKit rasterises each one.
          const dir = fillMaskDirection(cue.rtl);
          const edge = fillEdgePercent(f, W, fontPx.current);
          const cut = phone ? `${Math.round(edge / 4) * 4}%` : `${edge.toFixed(2)}%`;
          if (el.style.getPropertyValue('--fill-dir') !== dir) el.style.setProperty('--fill-dir', dir);
          if (el.style.getPropertyValue('--fill-cut') !== cut) el.style.setProperty('--fill-cut', cut);
        }
        if (motion === 'full') {
          // The word being sung rises a hair, then settles.
          const active = t >= w.s && t < w.e + 0.15 ? Math.sin(Math.PI * clamp01((t - w.s) / Math.max(0.25, w.e - w.s + 0.15))) : 0;
          el.style.transform = active > 0.001 ? `translate3d(0, ${(-active * 0.05).toFixed(3)}em, 0)` : '';
        }
      } else if (el.dataset.f) {
        delete el.dataset.f;
        el.classList.remove('is-filling', 'is-sung');
        el.style.removeProperty('--fill-cut');
        el.style.removeProperty('--fill-dir');
        el.style.removeProperty('background-image');
        el.style.transform = '';
      }
    }

    // A long pause before this line (it is next): say how long, so the reader is not left guessing.
    if (wait.current) {
      const waitO = waitV.toFixed(3);
      if (painted.current.wait !== waitO) {
        painted.current.wait = waitO;
        wait.current.style.opacity = waitO;
      }
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
      aria-hidden={parked || undefined}
      onClick={() => onPick(cue.idx)}
      style={{ visibility: 'hidden' }}
    >
      <div ref={main} className="fb-main">
        <span ref={wait} className="fb-wait t-footnote" dir="ltr" />
        {(meta.length > 0 || cue.repeat > 0 || phone) && (
          <div className="fb-meta t-footnote" dir="ltr" hidden={phone && meta.length === 0 && cue.repeat === 0 ? true : undefined}>
            {meta.map((m) => (
              <span key={m} className="fb-voice">
                {m}
              </span>
            ))}
            {(cue.repeat > 0 || phone) && (
              <span className="fb-repeat" hidden={cue.repeat > 0 ? undefined : true}>
                повтор
              </span>
            )}
          </div>
        )}
        <div ref={orig} className={`fb-orig ${fClass}${wordSync ? '' : ' is-line-fade'}`} dir={cue.rtl ? 'rtl' : 'ltr'}>
          {phone
            ? Array.from({ length: wordPool.current }, (_, i) => {
                const w = line.words[i];
                const spare = !w;
                const gap = !!w && (w.br || i < line.words.length - 1);
                return (
                  <span key={i} className="w-wrap" hidden={spare || undefined}>
                    <span
                      ref={(el) => {
                        words.current[i] = el;
                      }}
                      className={`w${w?.em ? ' w--em' : ''}`}
                    >
                      {w ? showHarakatText(w.w, settings.showHarakat) : '\u200b'}
                    </span>
                    {/* Same node for a break and a gap, so a new line does not mount a span. */}
                    <span className={w?.br ? 'w-br' : 'w-sp'} hidden={gap ? undefined : true} aria-hidden="true" />
                  </span>
                );
              })
            : line.words.map((w, i) => (
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
      {(hasSubs || phone) && (
        <div ref={subs} className="fb-subs" dir="ltr" hidden={hasSubs ? undefined : true}>
          {(showAlt || phone) && (
            <div className="fb-alt f-mushaf" dir="rtl" lang={line.lang} hidden={showAlt ? undefined : true}>
              {line.alt ? showHarakatText(line.alt.text, settings.showHarakat) : '\u200b'}
            </div>
          )}
          {(showTl || phone) && (
            <div className="fb-translit" lang="ru" hidden={showTl ? undefined : true}>
              {showTl ? line.translit : '\u200b'}
            </div>
          )}
          {(showTr || phone) && (
            <p className="fb-tr" lang="ru" hidden={showTr ? undefined : true}>
              {showTr ? <TrText text={line.tr.ru} /> : '\u200b'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const LineBlock = memo(LineBlockImpl);
