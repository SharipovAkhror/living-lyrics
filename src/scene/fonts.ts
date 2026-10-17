import type { Line } from '@/data/schema';
import type { Settings } from '@/app/settings';

/** Typeface class for a line's original. Arabic stays on the Mushaf. Persian uses the chosen face. */
export function fontClass(line: Pick<Line, 'script' | 'lang'>, s: Pick<Settings, 'fontPersian'>) {
  if (line.script !== 'Arab') return 'f-serif';
  if (line.lang !== 'fa') return 'f-mushaf';
  return s.fontPersian === 'nastaliq' ? 'f-nastaliq' : 'f-persian';
}
