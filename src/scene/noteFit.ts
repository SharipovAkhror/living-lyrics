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

/** Size the footnote to the translation and cut its text to fit. Cheap when nothing changed. */
export function fitNote(host: HTMLElement): void {
  const card = host.querySelector<HTMLElement>('.note-card');
  const span = card?.querySelector<HTMLElement>('.note-line-text');
  const full = span?.dataset.full;
  if (!card || !span || !full) return;
  const line = host.querySelector('.scene-view .fb--line.is-current');
  const ref = line?.querySelector('.fb-tr') ?? line?.querySelector('.fb-orig');
  const width = ref ? Math.floor(paintedWidth(ref)) : 0;
  if (width < 80) return;
  const max = `${width}px`;
  if (card.style.maxWidth !== max) card.style.maxWidth = max;
  const key = `${width}|${full}`;
  if (span.dataset.fit === key) return;
  span.dataset.fit = key;
  const text = fitClause(full, width, getComputedStyle(span).font);
  if (span.textContent !== text) span.textContent = text;
}
