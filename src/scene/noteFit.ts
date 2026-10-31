/**
 * The phone footnote is one line under the sung line. It is never wider than the
 * translation above it and it ends on a clause or a word, not in the middle of one:
 * a CSS ellipsis cut «…«что так…» and ran the full column under a narrow translation.
 * The full text stays in the sheet the footnote opens.
 */

let ctx: CanvasRenderingContext2D | null = null;

function measure(text: string, font: string): number {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Quotes and brackets closed: a cut that leaves «, ( or “ open reads as a broken phrase. */
function balanced(text: string): boolean {
  const pairs: Array<[string, string]> = [
    ['«', '»'],
    ['(', ')'],
    ['“', '”'],
  ];
  return pairs.every(([a, b]) => text.split(a).length === text.split(b).length);
}

/** The longest head of the text that fits: a whole clause first, else whole words and an ellipsis. */
export function fitClause(full: string, width: number, font: string): string {
  if (measure(full, font) <= width) return full;
  const clauses: string[] = [];
  const re = /[.;:!?](?=\s)|\s[—–](?=\s)|,(?=\s)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(full))) {
    const end = hit[0].trim() === '—' || hit[0].trim() === '–' ? hit.index : hit.index + 1;
    clauses.push(full.slice(0, end).trim());
  }
  for (let i = clauses.length - 1; i >= 0; i--) {
    let head = clauses[i];
    if (!balanced(head)) continue;
    // A sentence end stands alone; a comma or a dash continues, so it gets the ellipsis.
    if (!/[.;!?]$/.test(head)) head = `${head.replace(/[,:]$/, '')}…`;
    if (measure(head, font) <= width) return head;
  }
  const words = full.split(' ');
  for (let n = words.length - 1; n > 0; n--) {
    const head = `${words.slice(0, n).join(' ').replace(/[,;:—–-]$/, '')}…`;
    if (balanced(head) && measure(head, font) <= width) return head;
  }
  return `${words[0]}…`;
}

/** Width of the painted translation of the current line (its text, not its block). */
function paintedWidth(el: Element): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  const box = range.getBoundingClientRect();
  return box.width;
}

export interface VBand {
  top: number;
  bottom: number;
}

function mergeBands(bands: VBand[]): VBand[] {
  const list = bands
    .filter((b) => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top + 0.5)
    .map((b) => ({ top: b.top, bottom: b.bottom }))
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const out: VBand[] = [];
  for (const b of list) {
    const last = out[out.length - 1];
    if (last && b.top <= last.bottom + 0.5) last.bottom = Math.max(last.bottom, b.bottom);
    else out.push({ top: b.top, bottom: b.bottom });
  }
  return out;
}

/**
 * Top of a one-line footnote that does not cross the instrumental captions.
 * `under` is the bottom of the current picture (labels, drawings, section note).
 * The footnote sits in the gap just under that picture when the gap is free.
 * `maxTop` is the stylesheet clamp: a larger top is pulled back up into the captions.
 * Returns null when no gap is tall enough.
 */
export function footnoteTop(opts: {
  hard: VBand[];
  soft?: VBand[];
  under: number;
  noteH: number;
  ceiling: number;
  limit: number;
  maxTop: number;
  pad?: number;
}): number | null {
  const pad = opts.pad ?? 8;
  const { noteH, ceiling, under, maxTop } = opts;
  const limit = Math.min(opts.limit, maxTop + noteH);
  if (!(noteH > 0) || limit - ceiling < noteH) return null;
  const clear = (top: number, bands: VBand[]) => {
    if (top < ceiling - 0.5 || top > maxTop + 0.5 || top + noteH > limit + 0.5) return false;
    const bottom = top + noteH;
    return !bands.some((b) => b.bottom > top + 0.5 && b.top < bottom - 0.5);
  };
  const gaps = (bands: VBand[]) => {
    const merged = mergeBands(bands);
    const found: number[] = [];
    let cursor = ceiling;
    for (const b of merged) {
      const gapBot = Math.min(b.top - pad, limit);
      if (gapBot - cursor >= noteH) found.push(cursor);
      cursor = Math.max(cursor, b.bottom + pad);
    }
    if (limit - cursor >= noteH) found.push(cursor);
    return found;
  };
  const obstacles = mergeBands([...opts.hard, ...(opts.soft ?? [])]);
  const preferred = under + pad;
  if (clear(preferred, obstacles)) return Math.round(preferred * 10) / 10;
  const below = gaps(obstacles).filter((t) => t >= under - 0.5 && clear(t, obstacles));
  if (below.length) return Math.round(below[0] * 10) / 10;
  // The next line fills the gap. Still keep the captions clear, even above the picture.
  const hard = mergeBands(opts.hard);
  const hardBelow = gaps(hard).filter((t) => t >= under - 0.5 && clear(t, hard));
  if (hardBelow.length) return Math.round(hardBelow[0] * 10) / 10;
  const anywhere = gaps(hard).find((t) => clear(t, hard));
  return anywhere == null ? null : Math.round(anywhere * 10) / 10;
}

/** Size the footnote to the translation and cut its text to fit. Cheap when nothing changed. */
export function fitNote(host: HTMLElement): void {
  const card = host.querySelector<HTMLElement>('.note-card');
  const span = card?.querySelector<HTMLElement>('.note-line-text');
  const full = span?.dataset.full;
  if (!card || !span || !full) return;
  const line = host.querySelector('.scene-view .fb--line.is-current');
  const ref = line?.querySelector('.fb-tr') ?? line?.querySelector('.fb-orig');
  const width = ref ? Math.floor(paintedWidth(ref)) : 0;
  // An instrumental picture has no sung line to measure. The footnote stays
  // the full line and a CSS ellipsis; «ещё» is the visible way to open it.
  if (width < 80) {
    if (span.clientWidth > 40) {
      span.dataset.truncated = span.scrollWidth > span.clientWidth + 1 ? '1' : '0';
    }
    return;
  }
  const max = `${width}px`;
  if (card.style.maxWidth !== max) card.style.maxWidth = max;
  const key = `${width}|${full}`;
  if (span.dataset.fit === key) return;
  span.dataset.fit = key;
  const text = fitClause(full, width, getComputedStyle(span).font);
  if (span.textContent !== text) span.textContent = text;
  const cut = text !== full || span.scrollWidth > span.clientWidth + 1;
  span.dataset.truncated = cut ? '1' : '0';
}
