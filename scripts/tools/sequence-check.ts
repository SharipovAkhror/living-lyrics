/**
 * Sung-line order. The letter check in validate.ts only asks whether a line
 * occurs somewhere in canon.md. It does not ask whether that line is what is
 * sung at its time.
 *
 * Four guards, all from files already produced by the route:
 * 1. A vocal-stem transcript segment (docs/analysis/<slug>/transcript.json)
 *    that matches a different line — not the same words repeated, and not a
 *    segment that simply spills into the neighbour — is an error.
 * 2. A segment that matches a verse listed in recheck-alts.json (a line the
 *    canon says is not sung) better than the line on screen is an error,
 *    unless that line is flagged text-unverified. The flag is the waiver:
 *    removing it brings the error back.
 * 3. When official json3 cues are on disk, a line in the cue's own language
 *    must match the cue's letters. A translation track is not that language
 *    and is not consulted. One cue often covers an immediate repeat of the
 *    same letters: that repeat is not a missing cue. Two transcript segments
 *    back to back that both match those letters still need two lines. The
 *    cues are not in git; the check is skipped when the folder is absent
 *    (CI). It looks in work/subs and, for this checkout, in the sibling
 *    clone living-lyrics/work/subs.
 *
 * `npx tsx scripts/tools/sequence-check.ts --write` refreshes the recheck tables.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SequenceIssue = { level: 'error' | 'warn'; where: string; msg: string };

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What a frame pass actually showed. Unchecked songs must not claim a result. */
const FRAMES: Record<string, string> = {
  'i-have-come-alive': 'Кадры официального видео без вшитого текста: lyric_frames не даёт букв.',
  karitas: 'Кадры официального видео не снимались.',
  one: 'Кадры официального видео не снимались.',
};

/** Official video id and which subtitle track carries the sung letters. */
const TRACK: Record<string, { video: string; sung: Record<string, string> }> = {
  'i-have-come-alive': { video: 'M_8ano37jYo', sung: { en: 'en-GB', tr: 'tr', ar: 'ar' } },
  karitas: { video: 'xWwMzfGVikA', sung: { az: 'tr', ar: 'ar' } },
  one: { video: 'BcSnZ-RuwyI', sung: { de: 'en-GB', ar: 'en-GB' } },
};

const DIAC = /[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/g;
const MARKS: Record<string, string> = {
  ي: 'ی', ك: 'ک', ة: 'ه', أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ؤ: 'و', ئ: 'ی', ى: 'ی', ۀ: 'ه',
};

type Line = { id: string; lang: string; text: string; norm: string; start: number; end: number; flags: string[] };
type Segment = { start: number; end: number; text: string };
type Alt = { id: string; text: string; norm: string };
type Cue = { n: number; start: number; end: number; text: string; norm: string };

export function normLetters(input: string): string {
  let s = input.normalize('NFKC');
  s = s.replace(/[\u200c\u200d\u200e\u200f]/g, '');
  s = s.replace(DIAC, '');
  s = s.replace(/[يكةأإآٱؤئىۀ]/g, (ch) => MARKS[ch] ?? ch);
  s = s.replace(/[’‘ʻ`´]/g, "'");
  s = s.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i');
  s = s.toLowerCase();
  s = s.replace(/[^\p{L}\p{N}\s']+/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (x: string) => {
    const g = new Map<string, number>();
    const padded = ` ${x} `;
    for (let i = 0; i < padded.length - 2; i++) {
      const k = padded.slice(i, i + 3);
      g.set(k, (g.get(k) ?? 0) + 1);
    }
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  let sa = 0;
  let sb = 0;
  for (const v of ga.values()) sa += v;
  for (const v of gb.values()) sb += v;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  return (2 * inter) / (sa + sb);
}

function loadLines(slug: string): Line[] {
  const lyrics = JSON.parse(readFileSync(join(root, 'content/songs', slug, 'lyrics.json'), 'utf8')) as {
    sections: { lines?: { id: string; lang: string; flags?: string[]; words: { w: string; s: number; e: number }[] }[] }[];
  };
  const out: Line[] = [];
  for (const sec of lyrics.sections) {
    for (const line of sec.lines ?? []) {
      if (!line.words?.length) continue;
      const text = line.words.map((w) => w.w).join(' ');
      out.push({
        id: line.id,
        lang: line.lang,
        text,
        norm: normLetters(text),
        start: line.words[0].s,
        end: line.words[line.words.length - 1].e,
        flags: line.flags ?? [],
      });
    }
  }
  return out;
}

function loadSegments(slug: string): Segment[] | null {
  const path = join(root, 'docs/analysis', slug, 'transcript.json');
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { start: number; end: number; text?: string }[];
  return raw
    .filter((s) => (s.text ?? '').trim())
    .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? '').trim() }));
}

function loadAlts(slug: string): Alt[] {
  const path = join(root, 'docs/analysis', slug, 'recheck-alts.json');
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { id: string; text: string }[];
  return raw.map((a) => ({ id: a.id, text: a.text, norm: normLetters(a.text) }));
}

function subsDir(): string | null {
  const candidates = [join(root, 'work', 'subs'), join(root, '..', '..', 'living-lyrics', 'work', 'subs')];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function loadCues(dir: string, video: string): Record<string, Cue[]> {
  const folder = join(dir, video);
  const out: Record<string, Cue[]> = {};
  if (!existsSync(folder)) return out;
  for (const name of readdirSync(folder)) {
    if (!name.endsWith('.json3')) continue;
    const data = JSON.parse(readFileSync(join(folder, name), 'utf8')) as {
      events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
    };
    const cues: Cue[] = [];
    let n = 0;
    for (const ev of data.events ?? []) {
      const text = (ev.segs ?? []).map((s) => s.utf8 ?? '').join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      n += 1;
      const start = (ev.tStartMs ?? 0) / 1000;
      cues.push({ n, start, end: start + (ev.dDurationMs ?? 0) / 1000, text, norm: normLetters(text) });
    }
    out[name.replace(/\.json3$/, '')] = cues;
  }
  return out;
}

/** Equal, or the only differences are a space and the letters ه / ت (ta marbuta written out). */
function lettersMatch(lyric: string, cue: string): boolean {
  if (!lyric) return true;
  if (cue.includes(lyric) || lyric === cue) return true;
  const squash = (s: string) => s.replace(/ /g, '');
  if (squash(cue).includes(squash(lyric))) return true;
  const fold = (s: string) => s.replace(/[هةت]/g, 'ه');
  return fold(cue).includes(fold(lyric));
}

type GeminiSeg = { start: number; end: number; text: string; line: string; confidence: string };

type JudgeInput = {
  lines: Line[];
  segments: Segment[];
  alts: Alt[];
  cues: Record<string, Cue[]> | null;
  sung: Record<string, string>;
  gemini?: GeminiSeg[] | null;
};

/** Language a witness phrase is closest to. Persian-only letters decide even a rough transcript. */
function witnessLang(text: string, lines: Line[], alts: Alt[]): string | null {
  const raw = text.trim();
  if (!raw) return null;
  const heard = normLetters(raw);
  const words = heard.split(' ').filter(Boolean);
  const persianLetter = /[گپچژ]/.test(raw);
  if (words.length < 2 && !persianLetter) return null;
  let best = 0;
  let lang: string | null = null;
  const take = (code: string, norm: string) => {
    const score = dice(heard, norm);
    if (score > best) {
      best = score;
      lang = code;
    }
  };
  for (const ln of lines) take(ln.lang, ln.norm);
  for (const alt of alts) take(/[گپچژ]/.test(alt.text) || alt.text.includes('ی') ? 'fa' : 'ar', alt.norm);
  if (persianLetter) return best >= 0.45 && lang ? lang : 'fa';
  if (best >= 0.55 && lang) return lang;
  return null;
}

/**
 * A transcript phrase against the line on screen.
 * 0.72 keeps a repeated hemistich and a phrase that spills into the next line
 * from looking like a swap: those score high on the neighbour but either share
 * the letters or overlap its time. 0.50 on an absent verse is the beyt-8 case
 * (the second half alone scores 0.55).
 */
export function judgeSequence(input: JudgeInput): SequenceIssue[] {
  const issues: SequenceIssue[] = [];
  const { lines, segments, alts, cues, sung, gemini } = input;
  for (const seg of segments) {
    const heard = normLetters(seg.text);
    if (heard.split(' ').length < 2) continue;
    const mid = (seg.start + seg.end) / 2;
    const owner = lines.find((ln) => ln.start - 0.4 <= mid && mid <= ln.end + 0.4) ?? null;
    const ownerScore = owner ? dice(heard, owner.norm) : 0;
    let best: Line | null = null;
    let bestScore = 0;
    for (const ln of lines) {
      const score = ln.norm === heard ? 1 : dice(heard, ln.norm);
      if (score > bestScore) {
        best = ln;
        bestScore = score;
      }
    }
    // The same words may be an earlier repeat. A spill is real when any copy of
    // that line sits under this segment, not only the copy the scorer named first.
    const spills =
      best !== null &&
      lines.some((ln) => ln.norm === best.norm && seg.end > ln.start + 0.3 && seg.start < ln.end - 0.3);
    if (
      owner &&
      best &&
      bestScore >= 0.72 &&
      best.norm !== owner.norm &&
      best.id !== owner.id &&
      !spills
    ) {
      issues.push({
        level: 'error',
        where: owner.id,
        msg: `транскрипт ${seg.start.toFixed(1)}–${seg.end.toFixed(1)} с ближе к строке ${best.id} (${bestScore.toFixed(2)}), чем к ${owner.id} (${ownerScore.toFixed(2)})`,
      });
    }
    for (const alt of alts) {
      const score = dice(heard, alt.norm);
      if (score < 0.5 || score < ownerScore + 0.18) continue;
      if (owner?.flags.includes('text-unverified')) continue;
      issues.push({
        level: 'error',
        where: owner?.id ?? alt.id,
        msg: owner
          ? `транскрипт ${seg.start.toFixed(1)}–${seg.end.toFixed(1)} с ближе к неспетому «${alt.id}» (${score.toFixed(2)}), чем к строке ${owner.id} (${ownerScore.toFixed(2)}). Пометьте строку text-unverified, пока слух не решит, или поправьте текст`
          : `транскрипт ${seg.start.toFixed(1)}–${seg.end.toFixed(1)} с читает неспетое «${alt.id}» (${score.toFixed(2)}), а строки в этом месте нет`,
      });
    }
  }
  // An immediate repeat: two transcript segments of the same letters, less than
  // 2.5 s apart, and only one line of those letters under them.
  const sorted = [...segments].sort((x, y) => x.start - y.start);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const heardA = normLetters(a.text);
    if (heardA.split(' ').length < 2) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.start - a.end > 2.5) break;
      if (b.start < a.end - 0.2) continue;
      const heardB = normLetters(b.text);
      const norms = new Set<string>();
      for (const ln of lines) {
        if (dice(ln.norm, heardA) < 0.72 || dice(ln.norm, heardB) < 0.72) continue;
        norms.add(ln.norm);
      }
      for (const norm of norms) {
        const copies = lines.filter(
          (ln) =>
            ln.norm === norm &&
            ln.end > a.start + 0.2 &&
            ln.start < b.end - 0.2,
        );
        if (copies.length >= 2) continue;
        const owner = copies[0];
        if (!owner) continue;
        issues.push({
          level: 'error',
          where: owner.id,
          msg: `транскрипт повторяет эти буквы дважды (${a.start.toFixed(1)}–${a.end.toFixed(1)} и ${b.start.toFixed(1)}–${b.end.toFixed(1)} с), а строка в окне одна (${owner.id})`,
        });
      }
    }
  }
  if (cues) {
    for (const ln of lines) {
      const track = sung[ln.lang];
      if (!track || !cues[track]) continue;
      const near = cues[track].find((c) => Math.abs(c.start - ln.start) < 0.8) ?? null;
      // One official cue often holds an immediate repeat. The second line starts
      // inside that cue and uses the same letters.
      const hit =
        near ??
        cues[track].find(
          (c) => ln.start >= c.start - 0.05 && ln.end <= c.end + 0.45 && lettersMatch(ln.norm, c.norm),
        ) ??
        null;
      if (!hit) {
        issues.push({ level: 'error', where: ln.id, msg: `нет реплики дорожки ${track} у ${ln.start.toFixed(1)} с` });
        continue;
      }
      if (!lettersMatch(ln.norm, hit.norm)) {
        issues.push({
          level: 'error',
          where: ln.id,
          msg: `буквы строки не совпадают с репликой ${hit.n} дорожки ${track}`,
        });
      }
    }
  }
  // A line drawn in one language while Whisper and Gemini both hear another.
  // text-unverified does not waive this: that flag is what hid the old error.
  if (gemini?.length) {
    for (const ln of lines) {
      const whisperText = segments
        .filter((s) => Math.min(s.end, ln.end) - Math.max(s.start, ln.start) > 0.35)
        .map((s) => s.text)
        .join(' ');
      const geminiText = gemini
        .filter((s) => Math.min(s.end, ln.end) - Math.max(s.start, ln.start) > 0.35)
        .map((s) => s.text)
        .join(' ');
      const heardByWhisper = witnessLang(whisperText, lines, alts);
      const heardByGemini = witnessLang(geminiText, lines, alts);
      if (!heardByWhisper || !heardByGemini || heardByWhisper !== heardByGemini || heardByWhisper === ln.lang) continue;
      issues.push({
        level: 'error',
        where: ln.id,
        msg: `на ${ln.start.toFixed(1)}–${ln.end.toFixed(1)} с оба свидетеля слышат язык «${heardByWhisper}», на экране «${ln.lang}»`,
      });
    }
  }
  return issues;
}

export function checkSequence(slug: string): SequenceIssue[] {
  const lines = loadLines(slug);
  if (!lines.length) return [];
  const issues: SequenceIssue[] = [];
  const segments = loadSegments(slug);
  if (!segments) {
    issues.push({
      level: 'warn',
      where: 'transcript.json',
      msg: 'нет docs/analysis/<slug>/transcript.json: порядок строк с голосом не сверен',
    });
  }
  const meta = TRACK[slug];
  const dir = subsDir();
  const cues = meta && dir ? loadCues(dir, meta.video) : null;
  const sung = meta?.sung ?? {};
  if (segments) {
    issues.push(...judgeSequence({ lines, segments, alts: loadAlts(slug), cues, sung, gemini: loadGemini(slug) }));
  }
  return issues;
}

/** The absent-verse case must fail without the flag and pass with it. */
export function sequenceSelfTest(): string | null {
  const verse = 'شیخ نیم پیش نیم امر تو را بنده شدم';
  const heard = 'شیخ نیگم پیش نیگم عمر تو را بنده شد';
  const arabic = 'ولا انا زعیم';
  const base = {
    segments: [{ start: 372.16, end: 379.52, text: heard }],
    alts: [{ id: 'rumi-beyt-8-response', text: verse, norm: normLetters(verse) }],
    cues: null,
    sung: {},
  };
  const line = (flags: string[]): Line => ({
    id: 'arabic-23b', lang: 'ar', text: arabic, norm: normLetters(arabic), start: 374.42, end: 376.35, flags,
  });
  const open = judgeSequence({ ...base, lines: [line([])] });
  if (!open.some((i) => i.level === 'error' && i.where === 'arabic-23b')) return 'неспетый бейт 8 не пойман';
  const waived = judgeSequence({ ...base, lines: [line(['text-unverified'])] });
  if (waived.some((i) => i.level === 'error')) return 'флаг text-unverified не снял спор';
  const same = normLetters('Bir ölüydüm canla doldum');
  const repeat = judgeSequence({
    lines: [
      { id: 'a', lang: 'tr', text: same, norm: same, start: 215, end: 219, flags: [] },
      { id: 'b', lang: 'tr', text: same, norm: same, start: 230, end: 234, flags: [] },
    ],
    segments: [{ start: 215.2, end: 218.8, text: 'Bir ölüydüm canla doldum' }],
    alts: [],
    cues: null,
    sung: {},
  });
  if (repeat.some((i) => i.level === 'error')) return 'повтор тех же слов принят за обмен строк';
  const chorus = normLetters('sonsuzluk devleti buldum');
  const head = normLetters('Aşk devleti gelince ben');
  const spanned = judgeSequence({
    lines: [
      { id: 'turkish-12', lang: 'tr', text: chorus, norm: chorus, start: 227.2, end: 230.7, flags: [] },
      { id: 'turkish-15', lang: 'tr', text: head, norm: head, start: 239.0, end: 242.88, flags: [] },
      { id: 'turkish-16', lang: 'tr', text: chorus, norm: chorus, start: 242.88, end: 246.7, flags: [] },
    ],
    segments: [{ start: 239.18, end: 246.1, text: 'Devleti geyce ben sonsuzluk devleti buldum' }],
    alts: [],
    cues: null,
    sung: {},
  });
  if (spanned.some((i) => i.level === 'error')) return 'фраза на две строки принята за обмен с более ранним повтором';
  if (dice(normLetters(heard), normLetters(verse)) < 0.5) return 'порог бейта 8 разъехался с нормой букв';
  const persianReply = 'شیخ نیم پیش نیم امر تو را بنده شدم';
  const bothHearPersian = {
    segments: [{ start: 372.16, end: 379.52, text: heard }],
    alts: [{ id: 'rumi-beyt-8-response', text: verse, norm: normLetters(verse) }],
    cues: null,
    sung: {},
    gemini: [{ start: 374, end: 383, text: 'گفت که شیخی و سری پیشرو و راهبری', line: 'NONE', confidence: 'high' }],
  };
  const wrongLang = judgeSequence({ ...bothHearPersian, lines: [line([])] });
  if (!wrongLang.some((i) => i.level === 'error' && i.where === 'arabic-23b' && i.msg.includes('язык'))) {
    return 'строка чужого языка при двух свидетелях не поймана';
  }
  const flaggedLang = judgeSequence({ ...bothHearPersian, lines: [line(['text-unverified'])] });
  if (!flaggedLang.some((i) => i.level === 'error' && i.msg.includes('язык'))) {
    return 'флаг text-unverified снял чужой язык';
  }
  const faLine: Line = {
    id: 'rumi-8-1',
    lang: 'fa',
    text: persianReply,
    norm: normLetters(persianReply),
    start: 372.16,
    end: 379.52,
    flags: ['timing-draft'],
  };
  const rightLang = judgeSequence({
    ...bothHearPersian,
    lines: [faLine],
    gemini: [{ start: 372.4, end: 379, text: 'شیخ نیم پیش نیم امر تو را بنده شدم', line: 'NONE', confidence: 'high' }],
  });
  if (rightLang.some((i) => i.level === 'error')) return 'персидская строка при двух персидских свидетелях отклонена';
  const phrase = normLetters('في رحلة الفنون');
  const covered = judgeSequence({
    lines: [
      { id: 'arabic-8', lang: 'ar', text: phrase, norm: phrase, start: 300.26, end: 302.34, flags: [] },
      { id: 'arabic-8b', lang: 'ar', text: phrase, norm: phrase, start: 302.34, end: 304.4, flags: [] },
    ],
    segments: [
      { start: 300.26, end: 302.34, text: phrase },
      { start: 302.34, end: 304.4, text: phrase },
    ],
    alts: [],
    cues: { ar: [{ n: 48, start: 300.25, end: 304.45, text: phrase, norm: phrase }] },
    sung: { ar: 'ar' },
  });
  if (covered.some((i) => i.level === 'error')) return 'повтор внутри одной реплики отвергнут';
  const once = judgeSequence({
    lines: [{ id: 'arabic-8', lang: 'ar', text: phrase, norm: phrase, start: 300.26, end: 304.4, flags: [] }],
    segments: [
      { start: 300.26, end: 302.34, text: phrase },
      { start: 302.34, end: 304.4, text: phrase },
    ],
    alts: [],
    cues: null,
    sung: {},
  });
  if (!once.some((i) => i.level === 'error' && i.where === 'arabic-8')) return 'сдвоенная фраза транскрипта не поймана';
  const outside = judgeSequence({
    lines: [{ id: 'arabic-8b', lang: 'ar', text: phrase, norm: phrase, start: 310, end: 312, flags: [] }],
    segments: [],
    alts: [],
    cues: { ar: [{ n: 48, start: 300.25, end: 304.45, text: phrase, norm: phrase }] },
    sung: { ar: 'ar' },
  });
  if (!outside.some((i) => i.level === 'error')) return 'строка вне реплики прошла';
  return null;
}

type GeminiCell = { line: string; heard: string; start: number; end: number; confidence: string };

type RecheckLine = {
  id: string;
  lang: string;
  start: number;
  end: number;
  text: string;
  cue: { n: number; track: string; role: 'original' | 'translation'; text: string } | null;
  whisper: string;
  verdict: 'agree' | 'subtitle' | 'whisper' | 'translation-only' | 'conflict' | 'weak';
  gemini: GeminiCell[] | null;
};

function loadGemini(slug: string): GeminiSeg[] | null {
  const path = join(root, 'docs/analysis', slug, 'recheck-gemini.json');
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    segments?: { start_s?: number; end_s?: number; heard?: string; line?: string; confidence?: string }[];
  };
  return (raw.segments ?? [])
    .filter((s) => (s.heard ?? '').trim())
    .map((s) => ({
      start: s.start_s ?? 0,
      end: s.end_s ?? 0,
      text: (s.heard ?? '').trim(),
      line: s.line ?? 'NONE',
      confidence: s.confidence ?? '',
    }));
}

function buildTable(slug: string): { slug: string; checked: string; gemini: 'pending' | 'filled'; frames: string; lines: RecheckLine[] } {
  const lines = loadLines(slug);
  const segments = loadSegments(slug) ?? [];
  const alts = loadAlts(slug);
  const meta = TRACK[slug];
  const dir = subsDir();
  const cues = meta && dir ? loadCues(dir, meta.video) : {};
  const sung = meta?.sung ?? {};
  const gemini = loadGemini(slug);
  const rows: RecheckLine[] = lines.map((ln) => {
    const track = sung[ln.lang] ?? null;
    const role: 'original' | 'translation' = track ? 'original' : 'translation';
    const pool = track ? cues[track] ?? [] : [];
    // Translation witness: en-GB, for the report only. It is not a letter check.
    const glossPool = cues['en-GB'] ?? [];
    const poolUsed = pool.length ? pool : glossPool;
    const roleUsed = pool.length ? role : 'translation';
    const hit = poolUsed.find((c) => Math.abs(c.start - ln.start) < 0.8) ?? null;
    const heard = segments
      .filter((s) => {
        const overlap = Math.min(s.end, ln.end) - Math.max(s.start, ln.start);
        return overlap > 0.35 && s.end - s.start < 30;
      })
      .map((s) => s.text)
      .join(' / ');
    const heardNorm = normLetters(heard);
    const own = heardNorm ? dice(heardNorm, ln.norm) : 0;
    const altScore = alts.reduce((m, a) => Math.max(m, heardNorm ? dice(heardNorm, a.norm) : 0), 0);
    let verdict: RecheckLine['verdict'] = 'weak';
    if (altScore >= 0.5 && altScore >= own + 0.18) verdict = 'conflict';
    else if (roleUsed === 'original' && hit && lettersMatch(ln.norm, hit.norm)) verdict = own >= 0.4 ? 'agree' : heard ? 'weak' : 'subtitle';
    else if (own >= 0.4) verdict = 'whisper';
    else if (roleUsed === 'translation') verdict = 'translation-only';
    const geminiHits: GeminiCell[] | null = gemini
      ? gemini
          .filter((s) => Math.min(s.end, ln.end) - Math.max(s.start, ln.start) > 0.3)
          .map((s) => ({ line: s.line, heard: s.text, start: s.start, end: s.end, confidence: s.confidence }))
      : null;
    return {
      id: ln.id,
      lang: ln.lang,
      start: ln.start,
      end: ln.end,
      text: ln.text,
      cue: hit ? { n: hit.n, track: pool.length ? (track as string) : 'en-GB', role: roleUsed, text: hit.text } : null,
      whisper: heard,
      verdict,
      gemini: geminiHits,
    };
  });
  return {
    slug,
    checked: '2026-10-20',
    gemini: gemini ? 'filled' : 'pending',
    frames: FRAMES[slug] ?? 'Кадры официального видео не снимались.',
    lines: rows,
  };
}

function isCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry || entry.replace(/\\/g, '/').endsWith('scripts/tools/sequence-check.ts');
}

if (isCli()) {
  const broken = sequenceSelfTest();
  if (broken) {
    console.error(broken);
    process.exit(1);
  }
  const write = process.argv.includes('--write');
  const slugs = readdirSync(join(root, 'content/songs'));
  let errors = 0;
  for (const slug of slugs) {
    if (write) {
      const table = buildTable(slug);
      const path = join(root, 'docs/analysis', slug, 'recheck.json');
      if (existsSync(path)) {
        try {
          const previous = JSON.parse(readFileSync(path, 'utf8')) as { decisions?: unknown };
          if (previous.decisions) (table as { decisions?: unknown }).decisions = previous.decisions;
        } catch {
          // A broken table is rewritten from the sources. Decisions are kept only when they parse.
        }
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(table, null, 2) + '\n', 'utf8');
      const counts: Record<string, number> = {};
      for (const row of table.lines) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
      console.log(`${slug}: ${table.lines.length} строк ${JSON.stringify(counts)}`);
    }
    const issues = checkSequence(slug);
    const bad = issues.filter((i) => i.level === 'error');
    errors += bad.length;
    for (const i of issues) console.log(`${i.level} ${slug} ${i.where}: ${i.msg}`);
  }
  if (errors) process.exit(1);
}
