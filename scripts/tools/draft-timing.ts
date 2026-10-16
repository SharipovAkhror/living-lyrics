/**
 * Draft word timings: spreads each vocal section's lines evenly over the section and each
 * line's words by syllable weight. For lines still flagged "timing-draft" only, unless --all.
 *   npm run draft-timing -- <slug> [--all]
 * Use it after writing the text (stage 4) and before real alignment (stage 5), so the Scene
 * is watchable while you work.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LyricsSchema } from '../../src/data/schema.ts';

const [slug] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = process.argv.includes('--all');
if (!slug) {
  console.error('Usage: npm run draft-timing -- <slug> [--all]');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const path = join(root, 'content/songs', slug, 'lyrics.json');
const raw = JSON.parse(readFileSync(path, 'utf8'));
LyricsSchema.parse(raw);

const ARABIC = /[؀-ۿ]/;
function syllables(w: string) {
  if (ARABIC.test(w)) {
    const consonants = w.replace(/[ً-ٰٟ]/g, '').replace(/[^ء-يپچژگکی]/g, '');
    return Math.max(1, consonants.length * 0.55);
  }
  return Math.max(1, (w.match(/[aeiouyəıöüâîûāīūаеёиоуыэюя]+/gi) ?? []).length);
}

let changed = 0;
for (const s of raw.sections) {
  if (s.kind !== 'vocal') continue;
  const slot = (s.end - s.start) / s.lines.length;
  s.lines.forEach((line: { words: { w: string; s: number; e: number }[]; flags?: string[] }, k: number) => {
    if (!all && !line.flags?.includes('timing-draft')) return;
    const weights = line.words.map((w) => syllables(w.w));
    const total = weights.reduce((a, b) => a + b, 0);
    const natural = total * 0.42 + 0.4;
    const dur = Math.max(0.8, Math.min(natural * 1.5, slot - 0.7));
    let t = s.start + k * slot + Math.min(0.45, slot * 0.1);
    line.words.forEach((w, i) => {
      const d = (dur * weights[i]) / total;
      w.s = +t.toFixed(2);
      w.e = +(t + d * 0.9).toFixed(2);
      t += d;
    });
    line.flags = Array.from(new Set([...(line.flags ?? []), 'timing-draft']));
    changed++;
  });
}
writeFileSync(path, JSON.stringify(raw, null, 2) + '\n');
console.log(`${slug}: черновое время для ${changed} строк`);
