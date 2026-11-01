import { fitNote, footnoteTop, type VBand } from './noteFit';
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { LineCue } from '@/data/timeline';
import type { LineEntrance, MotionPref, Settings } from '@/app/settings';
import { formatTime } from '@/data/library';
import { LYRIC_PAD } from './columns';
import { fillEdgePercent, fillMaskDirection, wordFillFraction } from './fill';
import { blockState, clamp01, entranceOpacity, scriptShift, type Measure } from './flow';
import { showHarakatText } from '@/data/harakat';
import { fontClass } from './fonts';
import { bisect } from '@/app/bisect';
import { isPhone } from '@/ui/phone';
import { bindPhoneMeasures, generousLine, paintPhoneLine, type PhoneLineHost } from './slots';

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
  /** Bumps once when a scrub ends, so a line that used a cached box is read again. */
  measureEpoch?: number;
}

/**
 * Phone lines reuse one host. A fixed row of word nodes means the next lyric
 * only changes text: WebKit was retaining a backing store for every removed span.
 */
const PHONE_WORD_POOL = 40;

/** Box already read for a phone line. A scrub reuses it and does not lay out. */
const phoneMeasures = new Map<number, Measure>();
bindPhoneMeasures((idx) => phoneMeasures.get(idx));

/** Word widths are not needed to place the line. One line per frame stays inside the frame budget. */
const widthQueue: Array<() => void> = [];
let widthPump = 0;
function pumpWidths() {
  widthPump = 0;
  const job = widthQueue.shift();
  if (job) job();
  if (widthQueue.length) widthPump = requestAnimationFrame(pumpWidths);
}
function queuePhoneWidths(job: () => void) {
  widthQueue.push(job);
  if (!widthPump) widthPump = requestAnimationFrame(pumpWidths);
}

/**
 * The phone footnote sits under the painted line. The layout slot can be
 * shorter until the measure queue lands, and a resting clock does not place again.
 */
export function syncNoteFoot(line: HTMLElement): void {
  const stage = line.closest('.scene-stage');
  const host = line.closest('.song');
  if (!(stage instanceof HTMLElement) || !(host instanceof HTMLElement)) return;
  const stageBox = stage.getBoundingClientRect();
  const lineBox = line.getBoundingClientRect();
  if (lineBox.height < 8) return;
  const foot = `${(stage.offsetTop + (lineBox.bottom - stageBox.top) + 16).toFixed(1)}px`;
  if (host.style.getPropertyValue('--note-foot') !== foot) host.style.setProperty('--note-foot', foot);
  fitNote(host);
}

function shownBand(el: Element): VBand | null {
  if (!(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  let n: HTMLElement | null = el;
  while (n) {
    const s = getComputedStyle(n);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) return null;
    if (n.classList.contains('fb--inst') || n.classList.contains('scene-stage')) break;
    n = n.parentElement;
  }
  return { top: r.top, bottom: r.bottom };
}

let instFootAt = 0;
let instFootKey = '';

/**
 * The phone footnote follows the sung line. An instrumental picture has no line,
 * so the unset foot (28% of the song) ran through the musician names. Place it
 * under that picture, clear of the captions, without moving the picture itself.
 */
export function syncInstNote(inst: HTMLElement): void {
  const host = inst.closest('.song');
  const stage = inst.closest('.scene-stage');
  if (!(host instanceof HTMLElement) || !(stage instanceof HTMLElement)) return;
  if (host.classList.contains('is-scrubbing')) return;
  const card = host.querySelector('.note-card');
  if (!(card instanceof HTMLElement)) return;
  const full = inst.querySelector('.fb-inst-full');
  if (!(full instanceof HTMLElement)) return;
  const labels = inst.querySelectorAll('.ist-label').length;
  const key = `${inst.style.transform}|${inst.style.height}|${labels}`;
  const now = performance.now();
  if (key === instFootKey && now - instFootAt < 120) return;

  const hard: VBand[] = [];
  inst.querySelectorAll('.ist-label, .fb-inst-note, .fb-inst-mode, .ist-art, .ist-art-mount').forEach((el) => {
    const b = shownBand(el);
    if (b) hard.push(b);
  });
  if (!hard.length) return;
  const soft: VBand[] = [];
  stage.querySelectorAll('.fb--line').forEach((el) => {
    const b = shownBand(el);
    if (b) soft.push(b);
  });
  const under = Math.max(...hard.map((b) => b.bottom));
  const cardBox = card.getBoundingClientRect();
  const noteH = cardBox.height > 8 ? cardBox.height : 36;
  const player = host.querySelector('.player');
  const playerTop = player instanceof HTMLElement ? player.getBoundingClientRect().top : window.innerHeight;
  const raw = getComputedStyle(host).getPropertyValue('--player-h');
  const px = /([\d.]+)px/.exec(raw);
  const playerVar = px ? Number(px[1]) : 208;
  const maxTop = window.innerHeight - playerVar - 48;
  const header = host.querySelector('.topbar');
  const ceiling = header instanceof HTMLElement ? header.getBoundingClientRect().bottom + 4 : 8;
  const top = footnoteTop({
    hard,
    soft,
    under,
    noteH,
    ceiling,
    limit: playerTop - 4,
    maxTop,
    pad: 16,
  });
  if (top == null) return;
  instFootKey = key;
  instFootAt = now;
  const stageBox = stage.getBoundingClientRect();
  const foot = `${(stage.offsetTop + (top - stageBox.top)).toFixed(1)}px`;
  if (host.style.getPropertyValue('--note-foot') !== foot) host.style.setProperty('--note-foot', foot);
}

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
          <span key={i} className="tr-tx">
            {p}
          </span>
        ),
      )}
    </>
  );
}

function LineBlockImpl({ cue, parked = false, wordSync, settings, entrance, motion, stage, register, onPick, measureEpoch = 0 }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const orig = useRef<HTMLDivElement>(null);
  const subs = useRef<HTMLDivElement>(null);
  const wait = useRef<HTMLSpanElement>(null);
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const fontPx = useRef(40);
  const fitSig = useRef('');
  // The first desktop read can be a narrower parent (max-width: 100%). The
  // signature does not change when that parent later grows, so the line stayed
  // centred on the tall box. Content-box sizes only: mixing in offsetHeight
  // never matched and forced a layout on every notice.
  const deskW = useRef(-1);
  const deskH = useRef(-1);
  const deskObs = useRef<ResizeObserver | null>(null);
  const deskRead = useRef<() => void>(() => {});
  // The first observer notice is the box just measured. A later one is the
  // real wrap (the parent was still narrow). Reading that during a flight or
  // a sheet is a layout on the animation clock.
  const deskPrimed = useRef(false);
  const deskTimer = useRef(0);
  const wordPool = useRef(PHONE_WORD_POOL);
  const filterRef = useRef('');
  // Last strings actually written. WebKit grows its working set on a repeated write even when the pixels match.
  const painted = useRef({ transform: '', opacity: '', z: '', vis: '', sub: '', wait: '', lit: '', cur: '' });
  // A queued width read belongs to one cue. The next lyric or a scrub release drops it.
  const widthGen = useRef(0);
  const epochRef = useRef(measureEpoch);
  epochRef.current = measureEpoch;
  // The footnote is placed from this box. A later wrap must move it; the clock does not.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!el.classList.contains('is-current')) return;
      syncNoteFoot(el);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      deskObs.current?.disconnect();
      deskObs.current = null;
      window.clearTimeout(deskTimer.current);
      deskTimer.current = 0;
    };
  }, []);
  // A scrub writes the next lyric here and skips React. The render keeps that
  // cue until the release commit matches it.
  const overrideRef = useRef<LineCue | null>(null);
  const cueRef = useRef(cue);
  cueRef.current = overrideRef.current ?? cue;

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
    fitSig.current = '';
    widthGen.current += 1;
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

  useLayoutEffect(() => {
    const host = root.current as PhoneLineHost | null;
    if (!host) return;
    host.__llCue = cueRef;
    host.__llOverride = overrideRef;
    const over = overrideRef.current;
    if (!over) return;
    if (over.idx === cue.idx) {
      overrideRef.current = null;
      cueRef.current = cue;
      host.querySelectorAll<HTMLElement>('[data-scrub]').forEach((node) => node.removeAttribute('data-scrub'));
      return;
    }
    // A parent render reconciled the old lyric back. Put the scrubbed one on screen.
    paintPhoneLine(host, over, settings, wordSync);
    cueRef.current = over;
  });

  // Fit the original: as large as possible within the width and about a third of the stage height.
  useLayoutEffect(() => {
    if (parked) {
      const r = root.current;
      if (r) {
        r.style.visibility = 'hidden';
        r.style.pointerEvents = 'none';
        r.style.zIndex = '0';
      }
      painted.current = { transform: '', opacity: '', z: '', vis: '', sub: '', wait: '', lit: '', cur: '' };
      // Keep the updater. A scrub retargets this host without a React commit,
      // and it can only place the next line if the function is still registered.
      const known = phoneMeasures.get(cue.idx);
      register(cue.idx, call, known ?? { main: 72, sub: hasSubs ? 36 : 0 });
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
    // SE and the car window are short enough that an unfitted phone line
    // runs through the note and the section kicker runs through the status pill.
    // SE's stage is about 155px. The 393px phone stage is about 300px and must
    // keep the cheap path: fitting every line was a long scrub frame.
    const short = stage.h > 0 && stage.h < 240;
    // Desktop is its own scale, not the phone size stretched by the window height.
    const desk = vw >= 1100 && vh > 640;
    // The stage is already the column left of the margin note. The line fills that
    // content box and wraps; it must not grow to the width of an unwrapped sentence.
    const width = Math.max(120, stage.w - LYRIC_PAD * 2);
    const arab = line.script === 'Arab' || line.script === 'Aran';
    const maxH = car
      ? Math.max(64, stage.h * (hasSubs ? 0.62 : 0.74))
      : desk
        ? Math.max(140, stage.h * (hasSubs ? 0.52 : 0.62))
        : stage.h < 180
          ? Math.max(32, stage.h * (hasSubs ? 0.4 : 0.58))
          : Math.max(80, stage.h * (hasSubs ? (arab ? 0.52 : 0.44) : 0.5));
    const floor = car ? (arab ? 34 : 28) : 13;
    // System font size up to 200%, then the in-page slider, and never past double the design size.
    // The fit below still refuses a line that will not sit in the stage.
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const os = Math.min(2, Math.max(0.85, rootPx / 16));
    const scale = Math.min(2, settings.textScale * os);
    // Phone: 36px Latin/Cyrillic, 42px Arabic and Persian, scaled by the window, never below 13.
    // Wide and tall: 50 / 58, so the sung line is a stage line and not a caption.
    const design = car
      ? Math.max(floor, (arab ? 36 : 30) * scale)
      : desk
        ? (arab ? 58 : 50) * scale
        : (arab ? 42 : 36) * (Math.min(vh, 900) / 852) * scale;
    const upper = Math.max(floor, design);
    const lower = floor;
    el.style.width = `${width}px`;
    el.style.maxWidth = `${width}px`;
    el.style.minWidth = '0';
    if (desk) {
      // The steps live on --lyric-*. An inline pixel size froze the 50px cap
      // and a resize could not move it. Word widths are not read here: one
      // line per later frame missed the desktop p95.
      const sig = `desk|${Math.round(width)}|${vw}|${scale.toFixed(3)}|${arab ? 1 : 0}|${hasSubs ? 1 : 0}`;
      const readDesk = () => {
        const mainEl = main.current;
        const rootEl = root.current;
        if (!mainEl || !rootEl) return;
        const mainH = mainEl.offsetHeight || (arab ? 140 : 110);
        const subH = subs.current ? Math.max(0, rootEl.offsetHeight - mainH) : 0;
        register(cueRef.current.idx, call, { main: mainH, sub: subH });
      };
      // Cover rise, sheet scale, and the page spring all write style every
      // frame. A box read in that window is a long frame. --sheet-p is set
      // before data-sheet, and is-arriving outlives is-flying.
      const pageBusy = () =>
        document.documentElement.dataset.sheet === '1' ||
        parseFloat(document.documentElement.style.getPropertyValue('--sheet-p') || '0') > 0.02 ||
        !!document.querySelector('.morph-cover, .song.is-flying, .song.is-arriving, .song.is-scrubbing');
      const scheduleRead = () => {
        window.clearTimeout(deskTimer.current);
        const attempt = () => {
          if (pageBusy()) {
            deskTimer.current = window.setTimeout(attempt, 180);
            return;
          }
          deskTimer.current = 0;
          deskRead.current();
        };
        deskTimer.current = window.setTimeout(attempt, 32);
      };
      deskRead.current = readDesk;
      if (fitSig.current !== sig) {
        const prop = arab ? '--lyric-arab' : '--lyric-latin';
        el.style.fontSize = scale === 1 ? '' : `calc(var(${prop}) * ${scale})`;
        if (subs.current) subs.current.style.fontSize = scale === 1 ? '' : `calc(var(--lyric-tr) * ${scale})`;
        fitSig.current = sig;
        // One block read in this commit. A later queue measured one line per
        // frame of the flight, and each of those frames missed 16 ms. Word
        // widths wait until a word is actually filling.
        readDesk();
        // The notice for this write is the box we just read. The next notice,
        // when the wrap actually changes, is the one that may correct it.
        deskPrimed.current = false;
      }
      if (!deskObs.current && typeof ResizeObserver !== 'undefined') {
        deskObs.current = new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect;
          if (!rect) return;
          const w = Math.round(rect.width);
          const h = Math.round(rect.height);
          if (!deskPrimed.current) {
            deskPrimed.current = true;
            deskW.current = w;
            deskH.current = h;
            return;
          }
          if (Math.abs(w - deskW.current) <= 1 && Math.abs(h - deskH.current) <= 1) return;
          deskW.current = w;
          deskH.current = h;
          scheduleRead();
        });
      }
      if (deskObs.current) deskObs.current.observe(r);
      return;
    }
    if (isPhone() && !car && !short) {
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
      const scrubbing = !!r.closest('.song')?.classList.contains('is-scrubbing');
      // Reading the box forces layout. A drag reuses the last box. Any other
      // commit registers that box now and reads the real one on a later frame,
      // one line at a time, so the opening flight stays inside 16 ms.
      const known = phoneMeasures.get(cue.idx);
      // 72px was shorter than the words. The drag keeps the last real box, or a
      // tall guess, until the finger lifts and the queue reads the line.
      register(cue.idx, call, known ?? generousLine(cue));
      if (scrubbing) return;
      const gen = widthGen.current;
      const epoch = measureEpoch;
      const idx = cue.idx;
      queuePhoneWidths(() => {
        if (widthGen.current !== gen || epochRef.current !== epoch) return;
        if (!orig.current || !root.current || !main.current) return;
        if (root.current.closest('.song')?.classList.contains('is-scrubbing')) return;
        widths.current = words.current.map((w) => w?.offsetWidth ?? 0);
        const next = readBox();
        phoneMeasures.set(idx, next);
        register(idx, call, next);
      });
      return;
    }
    // Geometry is stable across seeks. Repeating the search on every commit
    // wrote a new font size into WebKit's backing store for the same pixels.
    const sig = `${Math.round(width)}|${Math.round(stage.h)}|${scale.toFixed(3)}|${car ? 1 : 0}|${short ? 1 : 0}|${hasSubs ? 1 : 0}`;
    let fitted = fontPx.current;
    if (fitSig.current !== sig) {
      let lo = lower;
      let hi = upper;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (el.scrollHeight <= maxH && el.scrollWidth <= width + 1) lo = mid;
        else hi = mid;
      }
      // lo is a size that already fits. Round it, then step back if the integer overflows.
      fitted = Math.min(upper, Math.max(lower, Math.round(lo)));
      el.style.fontSize = `${fitted}px`;
      if (el.scrollHeight > maxH + 1 || el.scrollWidth > width + 1) {
        fitted = Math.min(upper, Math.max(lower, Math.floor(lo)));
        el.style.fontSize = `${fitted}px`;
      }
      fontPx.current = fitted;
      // The original's cap does not shrink the translation. On a short stage the
      // whole block has to leave room for the section kicker above it.
      if (!desk && stage.h > 0 && subs.current) {
        // The whole block, original and translation, has to sit inside the stage.
        // On a short phone the note card is the sheet under the line.
        const budget = car ? stage.h * 0.58 : short ? Math.max(72, stage.h - 12) : stage.h * 0.9;
        const tr = subs.current;
        for (let i = 0; i < 4 && r.offsetHeight > budget; i++) {
          const factor = budget / r.offsetHeight;
          fitted = Math.max(lower, fitted * factor);
          el.style.fontSize = `${fitted}px`;
          const trNow = parseFloat(getComputedStyle(tr).fontSize) || 16;
          tr.style.fontSize = `${Math.max(13, trNow * factor)}px`;
        }
        fontPx.current = fitted;
      }
      fitSig.current = sig;
    }
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
    const liveCue = cueRef.current;
    const liveLine = liveCue.line;
    const s = blockState(d);
    const still = motion === 'off';
    const phone = isPhone();
    const scrubbing = phone && !!r.closest('.song')?.classList.contains('is-scrubbing');
    const x = entrance === 'script' ? scriptShift(d, liveCue.rtl, stage.w, still) : 0;
    const z = String(20 - Math.min(18, Math.round(Math.abs(d) * 4)));
    if (painted.current.z !== z) {
      painted.current.z = z;
      r.style.zIndex = z;
    }
    // translate3d promotes a backing store per slot. The layer arm checks whether
    // that store is the WebKit climb; a 2d translate keeps the same position.
    const transform = phone && bisect('layer')
      ? `translate(${x.toFixed(1)}px, ${top.toFixed(1)}px) scale(${s.scale.toFixed(3)})`
      : `translate3d(${x.toFixed(1)}px, ${top.toFixed(1)}px, 0) scale(${s.scale.toFixed(phone ? 3 : 4)})`;
    if (painted.current.transform !== transform) {
      painted.current.transform = transform;
      r.style.transform = transform;
    }
    const opacity = entranceOpacity(d, entrance, s.opacity).toFixed(phone ? 2 : 3);
    // An outside write (a scrub hide) must not stick just because the cache matches.
    if (painted.current.opacity !== opacity || r.style.opacity !== opacity) {
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
    if (painted.current.vis !== vis || r.style.visibility !== vis) {
      painted.current.vis = vis;
      r.style.visibility = vis;
    }
    const cur = Math.abs(d) < 0.5 ? '1' : '0';
    if (painted.current.cur !== cur) {
      painted.current.cur = cur;
      r.classList.toggle('is-current', cur === '1');
    }
    // After the transform. The layout height is not the ink, and the footnote
    // must clear this box on the same frame the line is placed.
    if (cur === '1' && phone && !scrubbing) syncNoteFoot(r);
    if (subs.current) {
      const sub = s.sub.toFixed(3);
      if (painted.current.sub !== sub) {
        painted.current.sub = sub;
        subs.current.style.opacity = sub;
      }
    }
    // A neighbour parked on the clip edge used to leave a dash and two dots
    // (the cut translation). Hide a sliver. A line that is fully in stays.
    if (!phone) {
      const stage = r.closest('.scene-stage');
      if (stage) {
        const edge = stage.clientHeight;
        const blockBottom = top + r.offsetHeight;
        if (blockBottom > edge - 2 && top < edge) {
          const sr = stage.getBoundingClientRect();
          if (subs.current) {
            const tr = subs.current.getBoundingClientRect();
            const visibleH = Math.min(tr.bottom, sr.bottom) - Math.max(tr.top, sr.top);
            const clipped = tr.height > 4 && visibleH < tr.height - 2 && visibleH < 22;
            const next = clipped ? 'hidden' : '';
            if (subs.current.style.visibility !== next) subs.current.style.visibility = next;
          }
          if (cur !== '1') {
            const br = r.getBoundingClientRect();
            const visibleH = Math.min(br.bottom, sr.bottom) - Math.max(br.top, sr.top);
            if (br.height > 8 && visibleH > 0 && visibleH < 18) r.style.visibility = 'hidden';
          }
        } else if (subs.current && subs.current.style.visibility === 'hidden') {
          subs.current.style.visibility = '';
        }
      }
    }

    // Every word is visible from the start (dim). With measured timing, each word fills in the
    // writing direction as it is sung; otherwise the whole line lights up while it is current.
    // One text layer. The moving edge is a mask on the word box, so joined letters are painted
    // once. A translucent colour on the glyphs would darken the joins.
    const o = orig.current;
    if (o && !bisect('words')) {
      const lit = d <= 0 ? 1 : d < 0.65 ? clamp01((0.65 - d) / 0.65) : 1;
      const rawLit = wordSync ? (d < -0.2 || d > 0.65 ? 1 : 0) : lit;
      if (wordSync) {
        // 0 or 1 only. The sung word is the mask, not a new colour on the glyphs.
        const litf = rawLit >= 1 ? '1' : '0';
        if (painted.current.lit !== litf) {
          painted.current.lit = litf;
          o.style.opacity = '';
          o.style.setProperty('--litf', litf);
        }
      } else if (phone) {
        // One opacity on the line. --litf on every word re-rasterised the glyphs
        // and the working set climbed about 16 MB/min (T27). Tenths still read as a fade.
        const step = rawLit.toFixed(1);
        if (painted.current.lit !== `o${step}`) {
          painted.current.lit = `o${step}`;
          const dim = Number(getComputedStyle(o).getPropertyValue('--dim-op'));
          const dimN = Number.isFinite(dim) ? dim : 0.42;
          o.style.removeProperty('--litf');
          o.style.opacity = (dimN + (1 - dimN) * Number(step)).toFixed(2);
        }
      } else {
        // Desktop keeps the ink on the line. Neighbours fade with the block, not a second dim.
        const litf = rawLit.toFixed(3);
        if (painted.current.lit !== litf) {
          painted.current.lit = litf;
          o.style.opacity = '';
          o.style.setProperty('--litf', litf);
        }
      }
    }
    if (bisect('words')) return;
    for (let i = 0; i < liveLine.words.length; i++) {
      const el = words.current[i];
      if (!el) continue;
      const w = liveLine.words[i];
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
          const W = widths.current[i] || (scrubbing ? 1 : el.offsetWidth || 1);
          // The edge is a step, and its place is fixed by t, so a seek lands on the same cut.
          // A phone keeps a few dozen mask strings per word. WebKit rasterises each one.
          const dir = fillMaskDirection(liveCue.rtl);
          const edge = fillEdgePercent(f, W, fontPx.current);
          const cut = phone ? `${Math.round(edge / 4) * 4}%` : `${edge.toFixed(2)}%`;
          if (el.style.getPropertyValue('--fill-dir') !== dir) el.style.setProperty('--fill-dir', dir);
          if (el.style.getPropertyValue('--fill-cut') !== cut) el.style.setProperty('--fill-cut', cut);
        }
        if (motion === 'full') {
          // The word being sung rises a hair, then settles.
          const active = t >= w.s && t < w.e + 0.15 ? Math.sin(Math.PI * clamp01((t - w.s) / Math.max(0.25, w.e - w.s + 0.15))) : 0;
          const shift = (-active * 0.05).toFixed(3);
          el.style.transform = active > 0.001 ? (phone && bisect('layer') ? `translate(0, ${shift}em)` : `translate3d(0, ${shift}em, 0)`) : '';
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
        const txt = `через ${formatTime(Math.max(0, liveCue.start - t))}`;
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
