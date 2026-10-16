/**
 * Validates every song under content/songs. Run before every commit: `npm run validate`.
 *   --emit-schema   also writes docs/schema/{song,lyrics}.schema.json for editor autocompletion
 *   --strict        treats warnings as errors (use before marking a song "verified")
 *   <slug>          validate one song only
 * Exit code 1 on errors.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LyricsSchema, SongSchema, type Lyrics, type Song } from '../../src/data/schema.ts';
import { INSTRUMENTS } from '../../src/instruments/list.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.filter((a) => !a.startsWith('--'));

if (args.includes('--emit-schema')) {
  mkdirSync(join(root, 'docs/schema'), { recursive: true });
  writeFileSync(join(root, 'docs/schema/song.schema.json'), JSON.stringify(z.toJSONSchema(SongSchema), null, 2) + '\n');
  writeFileSync(join(root, 'docs/schema/lyrics.schema.json'), JSON.stringify(z.toJSONSchema(LyricsSchema), null, 2) + '\n');
  console.log('schemas → docs/schema/');
}

const coverage = JSON.parse(readFileSync(join(root, 'scripts/tools/font-coverage.json'), 'utf8')) as Record<string, number[]>;
const covSets = Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, new Set(v)]));
const instrumentKeys = new Set(INSTRUMENTS.map((i) => i.key));
const svgDir = join(root, 'src/instruments/svg');
const ARABIC_LANGS = new Set(['ar', 'fa', 'ota', 'ur']);
// Reading speed for the Russian layer. Subtitle practice: ≤ 17 characters per second is comfortable.
const CPS_WARN = 20;

type Issue = { level: 'error' | 'warn'; where: string; msg: string };

function check(slug: string): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, msg: string) => issues.push({ level: 'error', where, msg });
  const warn = (where: string, msg: string) => issues.push({ level: 'warn', where, msg });
  const dir = join(root, 'content/songs', slug);

  let song: Song;
  let lyrics: Lyrics;
  try {
    const parsed = SongSchema.safeParse(JSON.parse(readFileSync(join(dir, 'song.json'), 'utf8')));
    if (!parsed.success) {
      parsed.error.issues.forEach((i) => err('song.json', `${i.path.join('.')}: ${i.message}`));
      return issues;
    }
    song = parsed.data;
  } catch (e) {
    err('song.json', String(e));
    return issues;
  }
  try {
    const parsed = LyricsSchema.safeParse(JSON.parse(readFileSync(join(dir, 'lyrics.json'), 'utf8')));
    if (!parsed.success) {
      parsed.error.issues.forEach((i) => err('lyrics.json', `${i.path.join('.')}: ${i.message}`));
      return issues;
    }
    lyrics = parsed.data;
  } catch (e) {
    err('lyrics.json', String(e));
    return issues;
  }

  if (song.slug !== slug) err('song.json', `slug "${song.slug}" ≠ folder "${slug}"`);
  if (!existsSync(join(dir, 'sources.md'))) warn('sources.md', 'нет файла источников (sources.md)');

  // Audio
  if (song.audio.status === 'ready') {
    if (!song.audio.high) err('song.json', 'audio.status = ready, но нет audio.high');
    for (const key of ['high', 'saver', 'peaks'] as const) {
      const p = song.audio[key];
      if (p && !existsSync(join(root, 'public', p))) {
        const encrypted = join(root, 'content/audio-enc', p.replace(/^\/audio\//, '') + '.enc');
        if (existsSync(encrypted)) warn('song.json', `audio.${key}: ${p} есть только в зашифрованном виде — нужен AUDIO_KEY (npm run dev / build расшифруют)`);
        else err('song.json', `audio.${key}: файл ${p} не найден в public/`);
      }
    }
    if (!song.audio.provenance) warn('song.json', 'audio.provenance не заполнен (откуда запись)');
  }

  // Sections and lines
  const ids = new Set<string>();
  let prevEnd = 0;
  let lastWordEnd = 0;
  const langsSeen = new Set<string>();
  lyrics.sections.forEach((s, si) => {
    const where = `section ${s.id}`;
    if (ids.has(s.id)) err(where, 'повтор id');
    ids.add(s.id);
    if (s.end <= s.start) err(where, `end (${s.end}) ≤ start (${s.start})`);
    if (s.start < prevEnd - 0.01) warn(where, `начинается (${s.start}) раньше конца предыдущей секции (${prevEnd})`);
    if (s.end > song.duration + 0.5) err(where, `end ${s.end} больше длительности песни ${song.duration}`);
    prevEnd = s.end;
    if (/[A-ZА-ЯЁ]{4,}/.test(s.label) && s.label === s.label.toUpperCase()) warn(where, 'подпись набрана капсом — нужен обычный регистр');

    if (s.kind === 'instrumental') {
      for (const k of s.instruments) {
        if (!instrumentKeys.has(k)) err(where, `инструмент "${k}" не описан в src/instruments/list.ts`);
        else if (!existsSync(join(svgDir, `${k}.svg`))) warn(where, `для "${k}" нет гравюры (src/instruments/svg/${k}.svg) — будет показан ансамбль`);
      }
      return;
    }

    s.lines.forEach((line, li) => {
      const lw = `${s.id} › ${line.id}`;
      if (ids.has(line.id)) err(lw, 'повтор id');
      ids.add(line.id);
      langsSeen.add(line.lang);
      const arab = ARABIC_LANGS.has(line.lang);
      if (arab && line.script !== 'Arab') warn(lw, `язык ${line.lang} обычно пишется арабской графикой, а script = ${line.script}`);
      if (line.script === 'Arab' && !line.translit) warn(lw, 'нет транскрипции (translit) для строки арабской графикой');
      if (!line.tr.ru.trim()) err(lw, 'пустой перевод');

      // Words: increasing, inside the section
      line.words.forEach((w, wi) => {
        if (w.e <= w.s) err(lw, `слово «${w.w}»: e ≤ s`);
        if (w.s < lastWordEnd - 0.02 && !(li === 0 && wi === 0 && si > 0 && w.s >= s.start)) err(lw, `слово «${w.w}» начинается (${w.s}) раньше конца предыдущего (${lastWordEnd})`);
        if (w.s < s.start - 0.05 || w.e > s.end + 0.05) warn(lw, `слово «${w.w}» выходит за границы секции`);
        if (/\s/.test(w.w)) err(lw, `слово «${w.w}» содержит пробел — разбейте на два`);
        lastWordEnd = Math.max(lastWordEnd, w.e);
      });

      // Glyph coverage
      const text = line.words.map((w) => w.w).join(' ');
      const face = line.script === 'Arab' ? (line.lang === 'fa' ? ['mushaf', 'nastaliq'] : ['mushaf']) : ['serif'];
      for (const f of face) {
        const missing = new Set<string>();
        for (const ch of text) {
          const cp = ch.codePointAt(0)!;
          if (cp <= 0x20 || cp === 0x200c || cp === 0x200d) continue;
          if (!covSets[f].has(cp)) missing.add(`${ch} U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
        }
        if (missing.size) warn(lw, `в шрифте ${f} нет символов: ${[...missing].join(', ')}`);
      }

      // Reading speed of the translation over the time the line is on screen
      const next = s.lines[li + 1];
      const shown = (next ? next.words[0].s : s.end) - line.words[0].s;
      const cps = line.tr.ru.length / Math.max(0.5, shown);
      if (cps > CPS_WARN) warn(lw, `перевод читается со скоростью ${cps.toFixed(0)} зн/с (норма ≤ 17): сократите`);
      if (line.tr.ru.length > 90) warn(lw, `перевод длиннее 90 знаков (${line.tr.ru.length}) — в караоке он не успеет прочитаться`);
    });
  });

  for (const l of song.languages) if (!langsSeen.has(l)) warn('song.json', `язык ${l} указан в languages, но строк на нём нет`);
  for (const l of langsSeen) if (!song.languages.includes(l as never)) warn('song.json', `строки на языке ${l} есть, но он не указан в languages`);
  return issues;
}

const slugs = readdirSync(join(root, 'content/songs')).filter((d) => !only.length || only.includes(d));
let errors = 0;
let warnings = 0;
for (const slug of slugs) {
  const issues = check(slug);
  const e = issues.filter((i) => i.level === 'error');
  const w = issues.filter((i) => i.level === 'warn');
  errors += e.length;
  warnings += w.length;
  console.log(`\n${e.length ? '✗' : '✓'} ${slug}  (${e.length} ошибок, ${w.length} предупреждений)`);
  for (const i of [...e, ...w].slice(0, 60)) console.log(`  ${i.level === 'error' ? 'ошибка' : 'внимание'}  ${i.where}: ${i.msg}`);
  if (e.length + w.length > 60) console.log(`  … и ещё ${e.length + w.length - 60}`);
}
console.log(`\nИтого: ${errors} ошибок, ${warnings} предупреждений.`);
if (errors || (strict && warnings)) process.exit(1);
