import type { Line } from '@/data/schema';
import type { Settings } from '@/app/settings';

/** Typeface class for a line's original: Mushaf naskh for Arabic script (or Nastaliq for Persian, by choice), serif otherwise. */
export function fontClass(line: Pick<Line, 'script' | 'lang'>, s: Pick<Settings, 'persianStyle'>) {
  if (line.script === 'Arab') return line.lang === 'fa' && s.persianStyle === 'nastaliq' ? 'f-nastaliq' : 'f-mushaf';
  return 'f-serif';
}
