/**
 * Validates every song under content/songs. Run before every commit: `npm run validate`.
 *   --emit-schema   also writes docs/schema/{song,lyrics}.schema.json for editor autocompletion
 *   --strict        treats warnings as errors (use before marking a song "verified")
 *   <slug>          validate one song only
 * Exit code 1 on errors.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { LyricsSchema, SongSchema, type Lyrics, type Song } from '../../src/data/schema.ts';
import { harakatWarning } from '../../src/data/harakat.ts';
import { INSTRUMENTS } from '../../src/instruments/list.ts';
import { MODE_COUNTS, modeFit } from '../../src/instruments/layout.ts';
import { checkSequence, sequenceSelfTest } from './sequence-check.ts';
import { letterAtoms, persianOrthographyIssues, persianSelfTest } from './persian-letters.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.filter((a) => !a.startsWith('--'));

const coverage = JSON.parse(readFileSync(join(root, 'scripts/tools/font-coverage.json'), 'utf8')) as Record<string, number[]>;
const covSets = Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, new Set(v)]));
const instrumentKeys = new Set(INSTRUMENTS.map((i) => i.key));
const svgDir = join(root, 'src/instruments/svg');
const ARABIC_LANGS = new Set(['ar', 'fa', 'ota', 'ur']);
/** Arabic-script codes. Transliteration is required for these, whatever the language. */
export const ARABIC_SCRIPTS = new Set(['Arab', 'Aran']);
/**
 * Comfortable reading speed for the Russian line, characters per second of the line as sung
 * (last word end minus first word start). Above CPS_WARN the validator warns.
 */
export const CPS_OK = 17;
export const CPS_WARN = 20;

/**
 * Words the karaoke translation must not use. One list, shared with
 * docs/methodology/06-translation.md and docs/methodology/translation-standard.md.
 * Matched as whole words, with inflections for the longer ones.
 * «сей» does not match «сейчас». «является» does not match «являю» or «являть».
 */
export const BANNED_RU: { name: string; re: RegExp }[] = [
  { name: 'сей', re: /(?<![\p{L}])сей(?![\p{L}])/giu },
  { name: 'дабы', re: /(?<![\p{L}])дабы(?![\p{L}])/giu },
  { name: 'предвечный', re: /(?<![\p{L}])предвечн\p{L}*/giu },
  { name: 'сокровенный', re: /(?<![\p{L}])сокровенн\p{L}*/giu },
  { name: 'священный', re: /(?<![\p{L}])священн\p{L}*/giu },
  { name: 'поистине', re: /(?<![\p{L}])поистине(?![\p{L}])/giu },
  { name: 'воистину', re: /(?<![\p{L}])воистину(?![\p{L}])/giu },
  { name: 'бесконечный', re: /(?<![\p{L}])бесконечн\p{L}*/giu },
  { name: 'вселенная', re: /(?<![\p{L}])вселенн\p{L}*/giu },
  { name: 'подлинный', re: /(?<![\p{L}])подлинн\p{L}*/giu },
  { name: 'небытие', re: /(?<![\p{L}])небыти\p{L}*/giu },
  { name: 'аннигиляция', re: /(?<![\p{L}])аннигиляц\p{L}*/giu },
  { name: 'трансцендентный', re: /(?<![\p{L}])трансцендент\p{L}*/giu },
  { name: 'мироздание', re: /(?<![\p{L}])мироздан\p{L}*/giu },
  { name: 'сакральный', re: /(?<![\p{L}])сакральн\p{L}*/giu },
  { name: 'невыразимый', re: /(?<![\p{L}])невыразим\p{L}*/giu },
  { name: 'неизреченный', re: /(?<![\p{L}])неизреченн\p{L}*/giu },
  { name: 'благоговейный', re: /(?<![\p{L}])благоговейн\p{L}*/giu },
  { name: 'представляет собой', re: /представляет собой/giu },
  { name: 'является', re: /(?<![\p{L}])является(?![\p{L}])/giu },
  { name: 'являются', re: /(?<![\p{L}])являются(?![\p{L}])/giu },
];

type Issue = { level: 'error' | 'warn'; where: string; msg: string };

/**
 * Letters only, for checking that a sung line occurs in canon.md: no harakat or other marks,
 * Arabic and Persian letter variants unified, no spaces, punctuation or case.
 */
export function letters(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

/** Same rule as scripts/pipeline/timing.py group. An empty voice is one unnamed lead. */
function voiceGroup(sectionVoice: string | undefined, lineVoice: string | undefined): 'solo' | 'choir' | 'other' {
  const voice = (lineVoice || sectionVoice || '').trim();
  const low = voice.toLowerCase().replace(/ё/g, 'е');
  if (['хор', 'choir', 'chorus', 'cappella'].some((m) => low.includes(m))) return 'choir';
  if (!voice) return 'solo';
  if (low === 'все' || low === 'all' || low === 'все исполнители' || low.startsWith('все ') || low.startsWith('all ')) return 'other';
  if (` ${low} `.includes(' и ')) return 'other';
  if (['ансамбль', 'ensemble', 'оркестр', 'orchestra', 'tutti'].some((m) => low.includes(m))) return 'other';
  return 'solo';
}

/** Publication gate. Goal is 100 %. An empty group does not block.
 *  Otherwise at least 90 % of its lines have lost timing-draft.
 *  Same integer test as qa_sync.song_proven: proved * 1000 >= n * 900. */
const SONG_SHARE = 0.9;

function shareOk(lines: { flags?: string[] }[]): boolean {
  if (lines.length === 0) return true;
  const proven = lines.filter((l) => !l.flags?.includes('timing-draft'));
  return proven.length * 1000 >= lines.length * Math.round(SONG_SHARE * 1000);
}

/**
 * Commentary used to be the field `sharh` (Arabic شرح) and the flag `sharh-draft`.
 * Zod strips unknown keys, so a leftover name would vanish without this check.
 */
/** Characters the reader actually sees: markdown asterisks are not read aloud. */
export function translationChars(ru: string) {
  return ru.replace(/\*/g, '').length;
}

/** Sung length of a line, seconds. Not the gap until the next line. */
export function sungDuration(words: { s: number; e: number }[]) {
  if (words.length === 0) return 0;
  return words[words.length - 1].e - words[0].s;
}

export function readingCps(ru: string, words: { s: number; e: number }[]) {
  const sung = sungDuration(words);
  const cps = translationChars(ru) / Math.max(0.5, sung);
  return { cps, sung };
}

export function bannedIn(text: string) {
  const found: string[] = [];
  for (const ban of BANNED_RU) {
    ban.re.lastIndex = 0;
    const hit = ban.re.exec(text);
    if (hit) found.push(hit[0]);
  }
  return found;
}

/**
 * Editor's notes that belong in canon.md, review or sources.md, not in a reader-facing comment.
 * One list, shared with docs/methodology/07-comment.md.
 */
export const EDITORIAL_MARKERS: { name: string; re: RegExp }[] = [
  { name: 'субтитр', re: /субтитр/giu },
  { name: 'титр', re: /(?<!суб)титр/giu },
  { name: 'транскрипт', re: /транскрипт/giu },
  { name: 'whisper', re: /whisper/giu },
  { name: 'распознава', re: /распознава/giu },
  { name: 'слухом', re: /(?<![\p{L}])слухом(?![\p{L}])/giu },
  { name: 'ухом', re: /(?<![\p{L}])ухом(?![\p{L}])/giu },
  { name: 'не проверен', re: /не[\s-]+проверен/giu },
  { name: 'реплика', re: /(?<![\p{L}])реплик/giu },
];

export function editorialMarkers(text: string) {
  const found: string[] = [];
  for (const marker of EDITORIAL_MARKERS) {
    marker.re.lastIndex = 0;
    if (marker.re.test(text)) found.push(marker.name);
  }
  return found;
}

/** A line of punctuation or single letters («؟», «…», «آ») is a stub, not sung text. */
export function isStubLine(words: { w: string }[]) {
  return words.length > 0 && words.every((word) => letters(word.w).length <= 1);
}

/** A run of three or more capital letters is shouting. Roman numerals (XVI) are not. */
export function capsWords(text: string) {
  const plain = text.replace(/\*/g, '');
  return [...plain.matchAll(/(?<![\p{L}\p{N}])[\p{Lu}]{3,}(?![\p{L}\p{N}])/gu)]
    .map((m) => m[0])
    .filter((word) => !/^[IVXLCDM]+$/.test(word));
}

/** The translation's pair for a key word marked `em` in the original. */
export function hasEmphasisPair(ru: string) {
  return /\*\*[^*\n]+\*\*/.test(ru);
}

function rejectRetiredNames(raw: unknown, err: (where: string, msg: string) => void) {
  if (!raw || typeof raw !== 'object') return;
  const sections = (raw as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const s = section as { id?: unknown; lines?: unknown; flags?: unknown };
    const sid = typeof s.id === 'string' ? s.id : '?';
    if ('sharh' in s) err(`section ${sid}`, 'поле sharh переименовано в comment');
    if (Array.isArray(s.flags) && s.flags.includes('sharh-draft')) err(`section ${sid}`, 'флаг sharh-draft переименован в comment-draft');
    if (!Array.isArray(s.lines)) continue;
    for (const line of s.lines) {
      if (!line || typeof line !== 'object') continue;
      const l = line as { id?: unknown; flags?: unknown };
      const where = `${sid} › ${typeof l.id === 'string' ? l.id : '?'}`;
      if ('sharh' in l) err(where, 'поле sharh переименовано в comment');
      if (Array.isArray(l.flags) && l.flags.includes('sharh-draft')) err(where, 'флаг sharh-draft переименован в comment-draft');
    }
  }
}

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
  let rawLyrics: unknown;
  try {
    rawLyrics = JSON.parse(readFileSync(join(dir, 'lyrics.json'), 'utf8'));
  } catch (e) {
    err('lyrics.json', String(e));
    return issues;
  }
  rejectRetiredNames(rawLyrics, err);
  const parsed = LyricsSchema.safeParse(rawLyrics);
  if (!parsed.success) {
    parsed.error.issues.forEach((i) => err('lyrics.json', `${i.path.join('.')}: ${i.message}`));
    return issues;
  }
  lyrics = parsed.data;

  if (song.slug !== slug) err('song.json', `slug "${song.slug}" ≠ folder "${slug}"`);
  // `version` itself is required by SongSchema. These warnings only catch a label that drops a year the file already states.
  if (song.version.kind === 'live' && !song.performance) {
    warn('version', 'kind = live, а performance нет: подпись должна опираться на факты концерта');
  }
  const concertYear = song.performance?.date?.match(/^\d{4}/)?.[0];
  if (song.version.kind === 'live' && concertYear && !song.version.label.includes(concertYear)) {
    warn('version.label', `в подписи нет года концерта ${concertYear} из performance.date`);
  }
  if (song.version.kind === 'studio' && song.release?.year != null && !song.version.label.includes(String(song.release.year))) {
    warn('version.label', `в подписи нет года релиза ${song.release.year}`);
  }
  const sourcesPath = join(dir, 'sources.md');
  const sourcesText = existsSync(sourcesPath) ? readFileSync(sourcesPath, 'utf8') : '';
  if (!sourcesText) warn('sources.md', 'нет файла источников (sources.md)');
  const canonPath = join(dir, 'canon.md');
  const canonRaw = existsSync(canonPath) ? readFileSync(canonPath, 'utf8') : null;
  const canon = canonRaw ? letters(canonRaw) : null;
  if (!canon) warn('canon.md', 'нет оригиналов текста (canon.md): строки не с чем сверить (docs/methodology/04-text.md)');

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
  const uncoveredScripts = new Set<string>();
  lyrics.sections.forEach((s, si) => {
    const where = `section ${s.id}`;
    if (ids.has(s.id)) err(where, 'повтор id');
    ids.add(s.id);
    if (s.end <= s.start) err(where, `end (${s.end}) ≤ start (${s.start})`);
    if (s.start < prevEnd - 0.01) warn(where, `начинается (${s.start}) раньше конца предыдущей секции (${prevEnd})`);
    if (s.end > song.duration + 0.5) err(where, `end ${s.end} больше длительности песни ${song.duration}`);
    prevEnd = s.end;
    if (/[A-ZА-ЯЁ]{4,}/.test(s.label) && s.label === s.label.toUpperCase()) warn(where, 'подпись набрана капсом — нужен обычный регистр');
    const labelCaps = capsWords(s.label);
    if (labelCaps.length && s.label !== s.label.toUpperCase()) warn(where, `в подписи капс: ${labelCaps.join(', ')}`);
    if (s.comment) {
      const commentCaps = capsWords(s.comment);
      if (commentCaps.length) warn(where, `в пояснении капс: ${commentCaps.join(', ')}`);
      const marks = editorialMarkers(s.comment);
      if (marks.length) warn(where, `в пояснении редакторская пометка (${marks.join(', ')}): её место — canon.md, раздел «Расхождения и вопросы», song.json → review или sources.md`);
    }

    // entries: catalogue keys, and the entrance sits inside the section (accompaniment on a vocal
    // section uses the same field). Order is appearance order; an unsorted list is a warning.
    if (s.entries?.length) {
      const spans: { key: string; at: number; until: number }[] = [];
      let prevAt = -1;
      for (const e of s.entries) {
        if (!instrumentKeys.has(e.key)) err(where, `entries: инструмент «${e.key}» не описан в src/instruments/list.ts`);
        else if (!existsSync(join(svgDir, `${e.key}.svg`))) warn(where, `entries: для «${e.key}» нет гравюры — будет показан ансамбль`);
        if (e.at < s.start - 0.05 || e.at >= s.end) err(where, `entries: «${e.key}» вступает на ${e.at} с, это вне секции ${s.start}–${s.end}`);
        if (e.until != null && e.until <= e.at) err(where, `entries: «${e.key}» уходит (${e.until}) не позже вступления (${e.at})`);
        if (e.until != null && e.until > s.end + 0.05) err(where, `entries: «${e.key}» уходит на ${e.until} с, позже конца секции ${s.end}`);
        if (e.at + 1e-6 < prevAt) warn(where, 'entries идут не по времени вступления');
        prevAt = e.at;
        const until = e.until ?? s.end;
        if (spans.some((p) => p.key === e.key && e.at < p.until - 0.05 && until > p.at + 0.05))
          warn(where, `entries: «${e.key}» пересекается сам с собой`);
        spans.push({ key: e.key, at: e.at, until });
      }
    }

    if (s.kind === 'instrumental') {
      for (const k of s.instruments) {
        if (!instrumentKeys.has(k)) err(where, `инструмент "${k}" не описан в src/instruments/list.ts`);
        else if (!existsSync(join(svgDir, `${k}.svg`))) warn(where, `для "${k}" нет гравюры (src/instruments/svg/${k}.svg) — будет показан ансамбль`);
      }
      if (new Set(s.instruments).size !== s.instruments.length) warn(where, 'инструмент повторяется в списке');
      if (s.note) {
        const noteCaps = capsWords(s.note);
        if (noteCaps.length) warn(where, `в заметке капс: ${noteCaps.join(', ')}`);
      }
      // Hand-set layout: does it suit the number of instruments? (rules: src/instruments/layout.ts)
      if (s.layout) {
        const n = s.instruments.length;
        const fit = modeFit(s.layout, n);
        const { min, max } = MODE_COUNTS[s.layout];
        const range = max === Infinity ? `от ${min}` : min === max ? `${min}` : `${min}–${max}`;
        if (fit === 'auto') warn(where, `layout "${s.layout}" рассчитан на ${range} инстр., а их ${n} — сцена выберет раскладку сама; уберите поле или смените режим`);
        if (fit === 'chip') warn(where, `layout "${s.layout}" рассчитан на ${range} инстр., а их ${n} — лишние уйдут в «+${n - max}»`);
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
      if (ARABIC_SCRIPTS.has(line.script) && !line.translit) warn(lw, 'нет транскрипции (translit) для строки арабским письмом');
      if (!line.tr.ru.trim()) err(lw, 'пустой перевод');
      if (canon && !canon.includes(letters(line.words.map((w) => w.w).join(' '))))
        warn(lw, `строки нет в canon.md: «${line.words.map((w) => w.w).join(' ')}» — сверьте с оригиналом или объясните расхождение`);

      // Words: increasing, inside the section
      line.words.forEach((w, wi) => {
        if (w.e <= w.s) err(lw, `слово «${w.w}»: e ≤ s`);
        if (w.e > song.duration + 0.5) err(lw, `слово «${w.w}» кончается (${w.e}) позже конца записи (${song.duration})`);
        if (w.s < lastWordEnd - 0.02 && !(li === 0 && wi === 0 && si > 0 && w.s >= s.start)) err(lw, `слово «${w.w}» начинается (${w.s}) раньше конца предыдущего (${lastWordEnd})`);
        if (w.s < s.start - 0.05 || w.e > s.end + 0.05) warn(lw, `слово «${w.w}» выходит за границы секции`);
        if (/\s/.test(w.w)) err(lw, `слово «${w.w}» содержит пробел — разбейте на два`);
        lastWordEnd = Math.max(lastWordEnd, w.e);
      });
      if (isStubLine(line.words)) {
        err(lw, 'строка-заглушка: слова — только знаки препинания или одна буква. Голос без разобранных слов записывайте инструментальной секцией с ключом voice или choir, без строк');
      }

      // Glyph coverage. Arab uses the bundled Mushaf face. Latin and Cyrillic use the serif.
      // Any other script falls through to the system font and must not be reported glyph by glyph.
      const text = line.words.map((w) => w.w).join(' ');
      const bundled = ARABIC_SCRIPTS.has(line.script)
        ? line.lang === 'fa' ? ['amiri', 'naskh', 'scheherazade', 'nastaliq'] : ['mushaf']
        : line.script === 'Latn' || line.script === 'Cyrl' ? ['serif'] : null;
      if (!bundled) uncoveredScripts.add(line.script);
      else {
        for (const f of bundled) {
          const missing = new Set<string>();
          for (const ch of text) {
            const cp = ch.codePointAt(0)!;
            if (cp <= 0x20 || cp === 0x200c || cp === 0x200d) continue;
            if (!covSets[f].has(cp)) missing.add(`${ch} U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
          }
          if (missing.size) warn(lw, `в шрифте ${f} нет символов: ${[...missing].join(', ')}`);
        }
      }

      // Reading speed over the time this line is actually sung.
      const speed = readingCps(line.tr.ru, line.words);
      if (speed.cps > CPS_WARN) {
        warn(lw, `перевод читается со скоростью ${speed.cps.toFixed(0)} зн/с при длительности строки ${speed.sung.toFixed(1)} с (норма ≤ ${CPS_OK}): сократите, остальное — в пояснение`);
      }
      const visible = translationChars(line.tr.ru);
      if (visible > 90) warn(lw, `перевод длиннее 90 знаков (${visible}) — в караоке он не успеет прочитаться`);

      const banned = bannedIn(line.tr.ru);
      if (banned.length) warn(lw, `в переводе запрещённые слова: ${banned.join(', ')} (список BANNED_RU, docs/methodology/06-translation.md)`);
      const shouted = capsWords(line.tr.ru);
      if (shouted.length) warn(lw, `в переводе капс: ${shouted.join(', ')} — нужен обычный регистр`);
      if (line.comment) {
        const commentCaps = capsWords(line.comment);
        if (commentCaps.length) warn(lw, `в пояснении капс: ${commentCaps.join(', ')}`);
        const marks = editorialMarkers(line.comment);
        if (marks.length) warn(lw, `в пояснении редакторская пометка (${marks.join(', ')}): её место — canon.md, раздел «Расхождения и вопросы», song.json → review или sources.md`);
      }
      const ems = line.words.filter((w) => w.em).length;
      if (ems > 1) warn(lw, `ключевых слов (em) ${ems} — нужно не больше одного`);
      if (ems >= 1 && !hasEmphasisPair(line.tr.ru)) warn(lw, 'в оригинале есть em, а в переводе нет пары **…**');
      if (line.lang === 'fa') {
        for (const issue of persianOrthographyIssues(line.words.map((w) => w.w), canonRaw)) {
          if (issue.level === 'error') err(lw, issue.msg);
          else warn(lw, issue.msg);
        }
      }
      if (ARABIC_SCRIPTS.has(line.script)) {
        const gap = harakatWarning(line.words.map((w) => w.w).join(' '));
        if (gap) warn(lw, gap);
      }
      if (line.alt && ARABIC_SCRIPTS.has(line.alt.script)) {
        const gap = harakatWarning(line.alt.text);
        if (gap) warn(lw, `историческое письмо: ${gap}`);
      }
    });
  });
  for (const script of uncoveredScripts) {
    warn('lyrics.json', `письмо ${script}: отдельного шрифта в проекте нет, строка рисуется f-serif, недостающие знаки берёт системный шрифт`);
  }

  if (song.timing.status === 'aligned') {
    const vocalSections = lyrics.sections.filter((s) => s.kind === 'vocal');
    const vocalLines = vocalSections.flatMap((s) => s.lines);
    if (vocalLines.length > 0 && vocalLines.every((l) => l.flags?.includes('timing-draft')))
      err('song.json', 'timing.status = aligned, но у каждой вокальной строки флаг timing-draft: пословная заливка нигде не включена, статус должен остаться draft');
    const solo = vocalSections.flatMap((s) => s.lines.filter((l) => voiceGroup(s.voice, l.voice) === 'solo'));
    const choir = vocalSections.flatMap((s) => s.lines.filter((l) => voiceGroup(s.voice, l.voice) === 'choir'));
    const soloProved = solo.filter((l) => !l.flags?.includes('timing-draft')).length;
    const choirProved = choir.filter((l) => !l.flags?.includes('timing-draft')).length;
    if (solo.length + choir.length === 0)
      err('song.json', 'timing.status = aligned, но нет ни соло, ни хора (дуэт и тутти в порог не входят): статус должен остаться draft');
    else if (!shareOk(solo) || !shareOk(choir))
      err('song.json', `timing.status = aligned, но доказано соло ${soloProved} из ${solo.length}, хор ${choirProved} из ${choir.length}: нужно не меньше ${Math.round(SONG_SHARE * 100)} % в каждой группе, где она есть, иначе статус draft`);
  }

  for (const l of song.languages) if (!langsSeen.has(l)) warn('song.json', `язык ${l} указан в languages, но строк на нём нет`);
  for (const l of langsSeen) if (!song.languages.includes(l)) warn('song.json', `строки на языке ${l} есть, но он не указан в languages`);

  checkParts(song, lyrics, sourcesText, err, warn);
  issues.push(...checkSequence(slug));
  checkRouteFiles(slug, lyrics, err, warn);
  return issues;
}

/**
 * Stage files the route now requires: official cue times without cue text,
 * and a translation dossier that names every sung line.
 * A missing file is a warning. Cue text committed into the repo is an error.
 */
function checkRouteFiles(
  slug: string,
  lyrics: Lyrics,
  err: (where: string, msg: string) => void,
  warn: (where: string, msg: string) => void,
) {
  const vocalIds: string[] = [];
  for (const section of lyrics.sections) {
    if (section.kind !== 'vocal') continue;
    for (const line of section.lines) vocalIds.push(line.id);
  }
  const cuePath = join(root, 'docs/analysis', slug, 'cues.json');
  if (!existsSync(cuePath)) {
    if (vocalIds.length) warn('cues.json', 'нет docs/analysis/<slug>/cues.json: время строк по официальным субтитрам (docs/methodology/04-text.md)');
  } else {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(cuePath, 'utf8'));
    } catch (e) {
      err('cues.json', String(e));
      json = null;
    }
    if (Array.isArray(json)) {
      const allowed = new Set(['line', 'cue', 'lang', 'start', 'end']);
      const seen = new Set<string>();
      for (const item of json) {
        if (!item || typeof item !== 'object') {
          err('cues.json', 'реплика не объект');
          continue;
        }
        const record = item as Record<string, unknown>;
        const extra = Object.keys(record).filter((key) => !allowed.has(key));
        if (extra.length) err('cues.json', `лишние поля (${extra.join(', ')}): текста реплики в файле быть не должно`);
        const line = record.line;
        if (typeof line !== 'string' || !line) {
          err('cues.json', 'у реплики нет line');
          continue;
        }
        if (seen.has(line)) err('cues.json', `реплика ${line} повторяется`);
        seen.add(line);
        if (typeof record.cue !== 'number' || typeof record.start !== 'number' || typeof record.end !== 'number') {
          err('cues.json', `реплика ${line}: cue, start и end — числа`);
        } else if (!(record.start < record.end)) err('cues.json', `реплика ${line}: start не меньше end`);
        if (typeof record.lang !== 'string' || !record.lang.trim()) err('cues.json', `реплика ${line}: нет lang`);
      }
      const missing = vocalIds.filter((id) => !seen.has(id));
      if (missing.length) {
        warn('cues.json', `нет реплики (${missing.length}): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
      }
      const extraIds = [...seen].filter((id) => !vocalIds.includes(id));
      if (extraIds.length) warn('cues.json', `id нет среди вокальных строк: ${extraIds.slice(0, 8).join(', ')}`);
    } else if (json !== null) err('cues.json', 'файл не массив');
  }

  const dossierPath = join(root, 'docs/analysis/translation', `${slug}.md`);
  if (!existsSync(dossierPath)) {
    if (vocalIds.length) warn('translation', `нет docs/analysis/translation/${slug}.md (docs/methodology/06-translation.md)`);
    return;
  }
  const dossier = readFileSync(dossierPath, 'utf8');
  if (!dossier.includes('Источник') || !dossier.includes('Принято')) {
    warn('translation', 'в досье нет «Источник» или «Принято»');
  }
  const missing = vocalIds.filter((id) => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`).test(dossier);
  });
  if (missing.length) {
    warn('translation', `нет id строк (${missing.length}): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
  }
}

/**
 * `parts` names whose words each stretch is. Section and line ids must exist.
 * Every vocal line belongs to exactly one part: a duplicate is an error, a gap is a warning.
 * A part with no `author` is «не установлено», not a guess — the validator does not invent one.
 */
function checkParts(
  song: Song,
  lyrics: Lyrics,
  sourcesText: string,
  err: (where: string, msg: string) => void,
  warn: (where: string, msg: string) => void,
) {
  const vocal: { id: string; sectionId: string; lang: string; start: number }[] = [];
  const sectionIds = new Set<string>();
  const lineIds = new Set<string>();
  for (const s of lyrics.sections) {
    sectionIds.add(s.id);
    if (s.kind !== 'vocal') continue;
    for (const line of s.lines) {
      lineIds.add(line.id);
      vocal.push({ id: line.id, sectionId: s.id, lang: line.lang, start: line.words[0]?.s ?? s.start });
    }
  }
  const parts = song.parts;
  if (!parts?.length) {
    if (vocal.length) warn('song.json', 'нет поля parts: вокальные строки не входят в состав (docs/methodology/04-text.md)');
    return;
  }

  const seen = new Set<string>();
  const owner = new Map<string, string>();
  const firstAt: number[] = [];
  for (const part of parts) {
    const where = `parts.${part.id}`;
    if (seen.has(part.id)) err(where, 'id части повторяется');
    seen.add(part.id);
    for (const [label, text] of [
      ['имени', part.title],
      ['заметке', part.note],
      ['ссылке', part.ref ?? ''],
    ] as const) {
      const shouted = text ? capsWords(text) : [];
      if (shouted.length) warn(where, `в ${label} капс: ${shouted.join(', ')}`);
    }
    if (part.url && sourcesText && !sourcesText.includes(part.url)) warn(where, `url нет в sources.md: ${part.url}`);

    let earliest = Infinity;
    const langs = new Set<string>();
    const claim = (lineId: string) => {
      const prev = owner.get(lineId);
      if (prev && prev !== part.id) err(where, `строка ${lineId} уже входит в часть ${prev}`);
      else if (!prev) {
        owner.set(lineId, part.id);
        const line = vocal.find((l) => l.id === lineId);
        if (line) {
          langs.add(line.lang);
          if (line.start < earliest) earliest = line.start;
        }
      }
    };
    for (const sid of part.sections ?? []) {
      if (!sectionIds.has(sid)) {
        err(where, `секции «${sid}» нет в lyrics.json`);
        continue;
      }
      for (const line of vocal) if (line.sectionId === sid) claim(line.id);
    }
    for (const lid of part.lines ?? []) {
      if (!lineIds.has(lid)) {
        err(where, `строки «${lid}» нет в lyrics.json`);
        continue;
      }
      claim(lid);
    }
    const covered = [...owner.values()].filter((id) => id === part.id).length;
    if (covered === 0) warn(where, 'часть не покрывает ни одной вокальной строки');
    if (langs.size && !langs.has(part.lang)) warn(where, `lang ${part.lang} не совпадает с языком строк (${[...langs].join(', ')})`);
    firstAt.push(earliest);
  }
  for (let i = 1; i < firstAt.length; i++) {
    if (firstAt[i] < firstAt[i - 1]) {
      warn(`parts.${parts[i].id}`, 'части идут не по порядку первого звучания');
      break;
    }
  }
  const missing = vocal.filter((l) => !owner.has(l.id));
  if (missing.length) {
    const sample = missing
      .slice(0, 8)
      .map((l) => l.id)
      .join(', ');
    warn('parts', `не входят в состав (${missing.length}): ${sample}${missing.length > 8 ? '…' : ''}`);
  }
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isCli()) {
  if (args.includes('--emit-schema')) {
    mkdirSync(join(root, 'docs/schema'), { recursive: true });
    writeFileSync(join(root, 'docs/schema/song.schema.json'), JSON.stringify(z.toJSONSchema(SongSchema), null, 2) + '\n');
    writeFileSync(join(root, 'docs/schema/lyrics.schema.json'), JSON.stringify(z.toJSONSchema(LyricsSchema), null, 2) + '\n');
    console.log('schemas → docs/schema/');
  }

  const self = sequenceSelfTest();
  if (self) {
    console.log(`\n✗ sequence-check  ${self}`);
    process.exit(1);
  }
  const orth = persianSelfTest();
  if (orth) {
    console.log(`\n✗ persian-letters  ${orth}`);
    process.exit(1);
  }
  const foldSample = 'أَخْتَرِ رَخْشَنْدِه';
  const folded = letterAtoms(foldSample).map((a) => a.fold).join('');
  if (folded !== letters(foldSample)) {
    console.log(`\n✗ persian-letters  свёртка не совпала с letters(): ${folded} ≠ ${letters(foldSample)}`);
    process.exit(1);
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
    for (const i of [...e, ...w].slice(0, 80)) console.log(`  ${i.level === 'error' ? 'ошибка' : 'внимание'}  ${i.where}: ${i.msg}`);
    if (e.length + w.length > 80) console.log(`  … и ещё ${e.length + w.length - 80}`);
  }
  console.log(`\nИтого: ${errors} ошибок, ${warnings} предупреждений.`);
  if (errors || (strict && warnings)) process.exit(1);
}
