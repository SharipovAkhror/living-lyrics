/**
 * Phone lyric slots. WebKit kept the backing store of a line each time the flow
 * unmounted it, and the working set climbed for the whole song. A slot stays in
 * the DOM: the cue it shows can change, the host element does not.
 */
import type { Settings } from '@/app/settings';
import { showHarakatText } from '@/data/harakat';
import type { LineCue, Timeline } from '@/data/timeline';
import type { Measure } from './flow';
import { fontClass } from './fonts';

export const PHONE_LINE_SLOTS = 8;
export const PHONE_INST_SLOTS = 8;

export interface PhoneSlot {
  idx: number;
  /** In the current window. A parked slot keeps its host and is not laid out. */
  live: boolean;
}

/** The host publishes these so a scrub can retarget the line without a React commit. */
export interface PhoneLineHost extends HTMLElement {
  __llCue?: { current: LineCue };
  __llOverride?: { current: LineCue | null };
}

type BlockEntry = { fn: (t: number, d: number, top: number, wait: number) => void; m: Measure };

/** The line block owns the measured boxes. A scrub asks for the cue it is about to show. */
let measureOf: (idx: number) => Measure | undefined = () => undefined;

export function bindPhoneMeasures(fn: (idx: number) => Measure | undefined) {
  measureOf = fn;
}

/**
 * A line we have not measured yet. Taller than a fitted phone line, so the next
 * block cannot land on it. The release read replaces this with the real box.
 */
export function generousLine(cue: LineCue): Measure {
  const n = cue.line.words.length;
  const sub = cue.line.tr?.ru || cue.line.translit || cue.line.alt ? 180 : 0;
  return { main: Math.max(240, Math.min(520, 96 + n * 28)), sub };
}

/** Plain text for the drag. The release render puts the emphasis markup back. */
function plain(text: string | undefined): string {
  if (!text) return '\u200b';
  const stripped = text.replace(/\*\*/g, '').replace(/\*/g, '');
  return stripped || '\u200b';
}

/** Change a leaf's characters without detaching the text node React still holds. */
function setLeaf(el: HTMLElement | null, text: string) {
  if (!el) return;
  const child = el.firstChild;
  if (child && child.nodeType === Node.TEXT_NODE && child.nextSibling == null) {
    if (child.nodeValue !== text) child.nodeValue = text;
  }
}

/**
 * A parked host stays hidden. A live host only drops the hide sentinel:
 * a real opacity such as "0.72" belongs to the block updater.
 */
function showSlot(el: HTMLElement, live: boolean) {
  if (!live) {
    el.style.visibility = 'hidden';
    el.style.opacity = '0';
    return;
  }
  if (el.style.visibility === 'hidden') el.style.visibility = 'visible';
  if (el.style.opacity === '0') el.style.opacity = '';
}

/** Write the next lyric into the host that already shows the previous one. */
export function paintPhoneLine(
  el: HTMLElement,
  cue: LineCue,
  settings: Pick<Settings, 'showHarakat' | 'fontPersian'>,
  wordSync: boolean,
) {
  const line = cue.line;
  el.lang = line.lang;
  const orig = el.querySelector<HTMLElement>('.fb-orig');
  if (orig) {
    orig.dir = cue.rtl ? 'rtl' : 'ltr';
    orig.className = `fb-orig ${fontClass(line, settings)}${wordSync ? '' : ' is-line-fade'}`;
  }
  el.querySelectorAll<HTMLElement>('.w-wrap').forEach((wrap, i) => {
    const w = line.words[i];
    const word = wrap.querySelector<HTMLElement>('.w');
    if (word) {
      setLeaf(word, w ? showHarakatText(w.w, settings.showHarakat) : '\u200b');
      word.classList.toggle('w--em', !!w?.em);
    }
    wrap.hidden = !w;
    if (word) {
      word.classList.remove('is-filling', 'is-sung');
      delete word.dataset.f;
      word.style.removeProperty('--fill-cut');
      word.style.removeProperty('--fill-dir');
      word.style.removeProperty('background-image');
      word.style.transform = '';
    }
    const gap = wrap.querySelector<HTMLElement>('.w-br, .w-sp');
    if (gap) {
      gap.classList.toggle('w-br', !!w?.br);
      gap.classList.toggle('w-sp', !w?.br);
      gap.hidden = !(w && (w.br || i < line.words.length - 1));
    }
  });
  // The translation keeps React's emphasis nodes. A plain string covers them
  // until the release commit, which clears the attribute before paint.
  const tr = el.querySelector<HTMLElement>('.fb-tr');
  if (tr) {
    const text = plain(line.tr?.ru);
    tr.setAttribute('data-scrub', text === '\u200b' ? '' : text);
  }
  setLeaf(el.querySelector('.fb-alt'), line.alt ? showHarakatText(line.alt.text, settings.showHarakat) : '\u200b');
  setLeaf(el.querySelector('.fb-translit'), plain(line.translit));
  const rep = el.querySelector<HTMLElement>('.fb-repeat');
  if (rep) rep.hidden = cue.repeat <= 0;
}

/**
 * Point the mounted hosts at the next cues. Returns false when a host is missing,
 * so the caller commits through React instead of writing into the wrong node.
 */
export function retargetPhoneLines(
  stage: HTMLElement,
  prev: readonly (PhoneSlot | null)[],
  next: readonly (PhoneSlot | null)[],
  timeline: Timeline,
  blocks: Map<number, BlockEntry>,
  settings: Pick<Settings, 'showHarakat' | 'fontPersian'>,
  wordSync: boolean,
): boolean {
  // The departing clone also carries .fb--line. Counting it made every
  // boundary fall back to a React commit, which was the long scrub frame.
  const hosts = [...stage.querySelectorAll<PhoneLineHost>('.scene-view--lyric > .fb--line')];
  let seen = 0;
  const hostAt: Array<PhoneLineHost | null> = prev.map((slot) => (slot ? (hosts[seen++] ?? null) : null));
  if (seen !== hosts.length) return false;
  for (let i = 0; i < next.length; i++) {
    if (next[i] && !hostAt[i]) return false;
  }
  const moves: Array<{ from: number; to: number; cue: LineCue }> = [];
  for (let i = 0; i < prev.length; i++) {
    const was = prev[i];
    const slot = next[i];
    const el = hostAt[i];
    if (!was || !slot || !el || slot.idx === was.idx) {
      if (el && slot) showSlot(el, slot.live);
      continue;
    }
    const cue = timeline.cues[slot.idx];
    if (!cue || cue.kind !== 'line') return false;
    if (el.__llCue) el.__llCue.current = cue;
    if (el.__llOverride) el.__llOverride.current = cue;
    paintPhoneLine(el, cue, settings, wordSync);
    showSlot(el, slot.live);
    moves.push({ from: was.idx, to: slot.idx, cue });
  }
  if (moves.length) {
    const snapshot = new Map(blocks);
    for (const move of moves) blocks.delete(move.from);
    for (const move of moves) {
      const entry = snapshot.get(move.from);
      if (!entry) continue;
      // The host's updater moves with the host. The box does not: the previous
      // line's height stacked the next line on top of a taller one.
      const known = measureOf(move.to);
      blocks.set(move.to, { fn: entry.fn, m: known ?? generousLine(move.cue) });
    }
  }
  return true;
}

export function sameSlots(a: readonly (PhoneSlot | null)[], b: readonly (PhoneSlot | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (!x || !y || x.idx !== y.idx || x.live !== y.live) return false;
  }
  return true;
}

/**
 * Keep a cue in the slot it already occupies. A cue that no longer fits the window
 * parks that slot. A new cue reuses a parked host before it takes an empty one.
 */
export function assignSlots(prev: readonly (PhoneSlot | null)[], wanted: readonly number[]): (PhoneSlot | null)[] {
  const want = new Set(wanted);
  const next: (PhoneSlot | null)[] = prev.map((s) => (s ? { idx: s.idx, live: want.has(s.idx) } : null));
  const placed = new Set<number>();
  for (const s of next) if (s?.live) placed.add(s.idx);
  for (const id of wanted) {
    if (placed.has(id)) continue;
    let free = next.findIndex((s) => s != null && !s.live);
    if (free < 0) free = next.indexOf(null);
    if (free < 0) break;
    next[free] = { idx: id, live: true };
    placed.add(id);
  }
  return next;
}
