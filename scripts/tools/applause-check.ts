/**
 * Applause must not draw, and a voice plate must not sit on a quiet vocal stem.
 *
 *   npx tsx scripts/tools/applause-check.test.ts
 *
 * The detector's spans are docs/analysis/<slug>/applause.json (accepted spans only).
 * The vocal stem is public/audio/<slug>/features.json, track tracks.vocals.
 * The floor is the midpoint already written in docs/analysis/stage-marks.md.
 * A song with no features file, or no floor written down, skips the voice half.
 * A song with no applause.json still rejects a non-empty «Аплодисменты» section.
 * Review exempts a quiet voice plate when it names that section id as a whole token.
 * It does not exempt a drawing on applause.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lyrics, Song } from '../../src/data/schema.ts';

export type ApplauseIssue = { level: 'error'; where: string; msg: string };

/** Midpoint of the two medians in docs/analysis/stage-marks.md. Not refit here. */
export const VOCAL_FLOOR: Record<string, number> = {
  'i-have-come-alive': 0.415,
  karitas: 0.335,
  one: 0.375,
};

export const APPLAUSE_LABEL = 'Аплодисменты';

const VOICE_KEYS = new Set(['voice', 'choir']);
/** Same edge as scripts/instrument_id/applause.py. A shared boundary is not an overlap. */
const EDGE_S = 0.5;
/** Round 1 did not rewrite a disagreement shorter than 2 s. */
const MIN_VOICE_S = 2;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type Plate = {
  id: string;
  kind: 'vocal' | 'instrumental';
  label: string;
  start: number;
  end: number;
  instruments: string[];
};

export type ApplauseSpan = { start: number; end: number; accepted?: boolean };

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** `voice-5` does not match `voice-50` or `voice-5-inst`. */
export function namedInReview(review: string[], id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![a-z0-9-])${escaped}(?![a-z0-9-])`);
  return review.some((line) => re.test(line));
}

function draws(section: Plate) {
  return section.kind === 'vocal' || section.instruments.length > 0;
}

function comma(n: number, digits: number) {
  return n.toFixed(digits).replace('.', ',');
}

/**
 * Pure check. The fixture test calls this with a broken object, not a song folder.
 */
export function applauseIssues(input: {
  review: string[];
  sections: Plate[];
  spans: ApplauseSpan[];
  vocals?: { rate: number; samples: number[] } | null;
  floor?: number | null;
}): ApplauseIssue[] {
  const issues: ApplauseIssue[] = [];
  const accepted = input.spans.filter((span) => span.accepted !== false);
  for (const section of input.sections) {
    if (section.label === APPLAUSE_LABEL && section.instruments.length > 0) {
      issues.push({
        level: 'error',
        where: `section ${section.id}`,
        msg: `подпись «Аплодисменты», а на сцене есть ${section.instruments.join(', ')}`,
      });
    }
    if (section.label === APPLAUSE_LABEL) continue;
    for (const span of accepted) {
      const got = overlap(section.start, section.end, span.start, span.end);
      if (got <= EDGE_S || !draws(section)) continue;
      issues.push({
        level: 'error',
        where: `section ${section.id}`,
        msg: `участок аплодисментов ${comma(span.start, 1)}–${comma(span.end, 1)} с пересекает рисунок на ${comma(got, 1)} с`,
      });
    }
  }
  const vocals = input.vocals;
  const floor = input.floor;
  if (!vocals || floor == null) return issues;
  for (const section of input.sections) {
    if (section.kind !== 'instrumental') continue;
    if (!section.instruments.some((key) => VOICE_KEYS.has(key))) continue;
    if (section.end - section.start < MIN_VOICE_S) continue;
    if (namedInReview(input.review, section.id)) continue;
    let sum = 0;
    let n = 0;
    const { rate, samples } = vocals;
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      if (t < section.start) continue;
      if (t >= section.end) break;
      sum += samples[i];
      n++;
    }
    if (n === 0) continue;
    const mean = sum / n;
    if (mean < floor) {
      issues.push({
        level: 'error',
        where: `section ${section.id}`,
        msg: `голос на сцене, а вокальный стем ниже порога ${comma(floor, 3)} (среднее ${comma(mean, 3)})`,
      });
    }
  }
  return issues;
}

function plates(lyrics: Lyrics): Plate[] {
  return lyrics.sections.map((section) => ({
    id: section.id,
    kind: section.kind,
    label: section.label,
    start: section.start,
    end: section.end,
    instruments: section.kind === 'instrumental' ? section.instruments : [],
  }));
}

export function checkApplause(slug: string, song: Song, lyrics: Lyrics): ApplauseIssue[] {
  const spanPath = join(root, 'docs/analysis', slug, 'applause.json');
  let spans: ApplauseSpan[] = [];
  if (existsSync(spanPath)) {
    try {
      const body = JSON.parse(readFileSync(spanPath, 'utf8')) as { spans?: ApplauseSpan[] };
      if (!Array.isArray(body.spans)) {
        return [{ level: 'error', where: 'applause.json', msg: 'поле spans не массив' }];
      }
      spans = body.spans;
    } catch (e) {
      return [{ level: 'error', where: 'applause.json', msg: `не читается: ${e}` }];
    }
  }
  const floor = VOCAL_FLOOR[slug];
  let vocals: { rate: number; samples: number[] } | null = null;
  const featPath = join(root, 'public/audio', slug, 'features.json');
  if (floor != null && existsSync(featPath)) {
    try {
      const body = JSON.parse(readFileSync(featPath, 'utf8')) as {
        rate?: number;
        tracks?: { vocals?: number[] };
      };
      const samples = body.tracks?.vocals;
      if (typeof body.rate !== 'number' || body.rate <= 0 || !Array.isArray(samples)) {
        return [{ level: 'error', where: 'features.json', msg: 'нет rate или дорожки vocals' }];
      }
      vocals = { rate: body.rate, samples };
    } catch (e) {
      return [{ level: 'error', where: 'features.json', msg: `не читается: ${e}` }];
    }
  }
  return applauseIssues({
    review: song.review ?? [],
    sections: plates(lyrics),
    spans,
    vocals,
    floor: floor ?? null,
  });
}
