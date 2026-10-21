/**
 * Persian orthography for sung lines (`lang: fa`).
 *
 * Arabic yeh ي (U+064A) and kaf ك (U+0643) are always errors: Persian editions use ی and ک.
 * إ ة ؤ ى ٱ are errors too, unless the same letter in canon.md is that character.
 * Alef with hamza above أ (U+0623) stays a warning on the same rule.
 * Vowels are ignored, so a vocalized line still lines up with the edition.
 * The fold matches `letters()` in validate.ts; a self-test there checks they agree.
 */

export interface OrthIssue {
  level: 'error' | 'warn';
  msg: string;
}

export interface LetterAtom {
  /** Base character after mark stripping, before the Arabic/Persian fold. */
  raw: string;
  /** One step of the same fold as `letters()` in validate.ts. */
  fold: string;
}

const ARABIC_YEH = '\u064A';
const ARABIC_KAF = '\u0643';

/** Flagged only when the edition's letter at that place is different, or the line is not in canon. */
const GATED: { raw: string; level: 'error' | 'warn' }[] = [
  { raw: '\u0625', level: 'error' }, // إ
  { raw: '\u0629', level: 'error' }, // ة
  { raw: '\u0624', level: 'error' }, // ؤ
  { raw: '\u0649', level: 'error' }, // ى
  { raw: '\u0671', level: 'error' }, // ٱ
  { raw: '\u0623', level: 'warn' }, // أ — warning, not an error
];

function hex(ch: string): string {
  return ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}

/** Combining marks and tatweel. Not base letters. No /g flag: `test` runs once per character. */
const STRIP = /[\u0300-\u036f\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/;

export function foldLetter(ch: string): string {
  let s = ch;
  if (s === '\u064A' || s === '\u0649' || s === '\u0626') s = '\u06CC';
  else if (s === '\u0643') s = '\u06A9';
  else if (s === '\u0623' || s === '\u0625' || s === '\u0622' || s === '\u0671') s = '\u0627';
  else if (s === '\u0624') s = '\u0648';
  return s.toLowerCase();
}

export function letterAtoms(text: string): LetterAtom[] {
  // Do not NFKD first. أ إ آ ؤ ئ decompose into a base plus a hamza mark, and the
  // raw letter would be lost before the warning can see it. `letters()` strips
  // those marks after NFKD; `foldLetter` applies the same result to the whole letter.
  const atoms: LetterAtom[] = [];
  for (const ch of text) {
    if (STRIP.test(ch) || !/[\p{L}\p{N}]/u.test(ch)) continue;
    atoms.push({ raw: ch, fold: foldLetter(ch) });
  }
  return atoms;
}

/** First place where `needle` sits inside `hay` after the fold. -1 if it does not. */
export function findAtomSpan(hay: LetterAtom[], needle: LetterAtom[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j].fold !== needle[j].fold) continue outer;
    }
    return i;
  }
  return -1;
}

function quoted(words: string[]): string {
  return words.map((w) => `«${w}»`).join(', ');
}

/**
 * Check one Persian line. `canon` is the whole canon.md text, or null when the file is missing.
 * The first folded match of the whole line is the edition place: a later quotation of the
 * same words does not override it.
 */
export function persianOrthographyIssues(words: string[], canon: string | null): OrthIssue[] {
  const issues: OrthIssue[] = [];
  const yeh = words.filter((w) => w.includes(ARABIC_YEH));
  const kaf = words.filter((w) => w.includes(ARABIC_KAF));
  if (yeh.length) {
    issues.push({
      level: 'error',
      msg: `арабская ي (U+064A) в ${quoted(yeh)}: в персидской строке нужна ی (U+06CC)`,
    });
  }
  if (kaf.length) {
    issues.push({
      level: 'error',
      msg: `арабская ك (U+0643) в ${quoted(kaf)}: в персидской строке нужна ک (U+06A9)`,
    });
  }

  const wordAtoms = words.map((w) => letterAtoms(w));
  const lineAtoms = wordAtoms.flat();
  const canonAtoms = canon ? letterAtoms(canon) : null;
  const at = canonAtoms ? findAtomSpan(canonAtoms, lineAtoms) : -1;
  for (const gate of GATED) {
    const offenders: string[] = [];
    let canonNote = '';
    let offset = 0;
    for (let wi = 0; wi < words.length; wi++) {
      const atoms = wordAtoms[wi];
      let flagged = false;
      for (let j = 0; j < atoms.length; j++) {
        if (atoms[j].raw !== gate.raw) continue;
        const canonRaw = at >= 0 ? canonAtoms![at + offset + j]?.raw : undefined;
        if (canonRaw === gate.raw) continue;
        if (!flagged) {
          offenders.push(words[wi]);
          flagged = true;
          if (!canonNote) {
            canonNote = canonRaw
              ? `в эталоне здесь «${canonRaw}» (U+${hex(canonRaw)})`
              : `строка не найдена в canon.md, поэтому ${gate.raw} изданием не подтверждена`;
          }
        }
      }
      offset += atoms.length;
    }
    if (offenders.length) {
      issues.push({
        level: gate.level,
        msg: `арабская ${gate.raw} (U+${hex(gate.raw)}) в ${quoted(offenders)}: ${canonNote}`,
      });
    }
  }
  return issues;
}

/** Cases the validator must keep. A string means the check is wrong. */
export function persianSelfTest(): string | null {
  const clean = persianOrthographyIssues(['اَخْتَرِ', 'رَخْشَنْدِه'], 'اختر رخشنده شدم');
  if (clean.length) return `чистая строка дала замечание: ${clean[0].msg}`;

  const yeh = persianOrthographyIssues(['عَيْن'], 'عین');
  if (!yeh.some((i) => i.level === 'error' && i.msg.includes('U+064A'))) return 'арабская ي не стала ошибкой';

  const kaf = persianOrthographyIssues(['كِه'], 'که');
  if (!kaf.some((i) => i.level === 'error' && i.msg.includes('U+0643'))) return 'арабская ك не стала ошибкой';

  const hamza = persianOrthographyIssues(['أَخْتَرِ'], 'بر زبر هفت طبق، اختر رخشنده شدم');
  if (!hamza.some((i) => i.level === 'warn' && i.msg.includes('U+0623'))) return 'أ вместо ا не стала предупреждением';
  if (hamza.some((i) => i.level === 'error')) return 'أ не должна быть ошибкой';

  const kept = persianOrthographyIssues(['أَخْتَرِ'], 'أَخْتَرِ رخشنده');
  if (kept.some((i) => i.msg.includes('U+0623'))) return 'أ, которая есть в эталоне, не должна предупреждать';

  const madda = persianOrthographyIssues(['آمَدْ'], 'آمد');
  if (madda.length) return 'мадда آ не должна замечаться';

  const ezafe = persianOrthographyIssues(['خَنْدِه\u0654'], 'خندهٔ');
  if (ezafe.length) return 'хамза изафета не должна замечаться';

  const persianYeh = persianOrthographyIssues(['گِرْیِه'], 'گریه');
  if (persianYeh.length) return 'персидская ی не должна замечаться';

  const hamzaRaw = letterAtoms('أَخْتَرِ')[0];
  if (!hamzaRaw || hamzaRaw.raw !== '\u0623' || hamzaRaw.fold !== '\u0627') return 'أ не должна теряться при разборе';

  const folded = letterAtoms('أَخْتَرِ گِرْیِه كِه ئ').map((a) => a.fold).join('');
  if (folded !== 'اخترگریهکهی') return `свёртка букв: ${folded}`;

  const both = persianOrthographyIssues(['يَك'], null);
  if (both.filter((i) => i.level === 'error').length !== 2) return 'ي и ك должны дать две ошибки';
  if (both.some((i) => i.level === 'warn')) return 'يَك без أ не должна предупреждать';

  const hamzaBelow = persianOrthographyIssues(['إِلَّا'], 'الا');
  if (!hamzaBelow.some((i) => i.level === 'error' && i.msg.includes('U+0625'))) return 'إ вместо ا не стала ошибкой';
  if (hamzaBelow.some((i) => i.level === 'warn')) return 'إ не должна быть предупреждением';

  const hamzaBelowKept = persianOrthographyIssues(['إِلَّا'], 'إِلَّا');
  if (hamzaBelowKept.some((i) => i.msg.includes('U+0625'))) return 'إ, которая есть в эталоне, не должна замечаться';

  const tehKept = persianOrthographyIssues(['نَظْرَةً'], 'نظرة');
  if (tehKept.some((i) => i.msg.includes('U+0629'))) return 'ة, которая есть в эталоне, не должна замечаться';

  const teh = persianOrthographyIssues(['نَظْرَةً'], 'نظره');
  if (!teh.some((i) => i.level === 'error' && i.msg.includes('U+0629'))) return 'ة вместо ه не стала ошибкой';

  const wawHamza = persianOrthographyIssues(['مُؤْمِن'], 'مومن');
  if (!wawHamza.some((i) => i.level === 'error' && i.msg.includes('U+0624'))) return 'ؤ вместо و не стала ошибкой';
  const wawKept = persianOrthographyIssues(['مُؤْمِن'], 'مؤمن');
  if (wawKept.some((i) => i.msg.includes('U+0624'))) return 'ؤ, которая есть в эталоне, не должна замечаться';

  const maksura = persianOrthographyIssues(['هُدَى'], 'هدی');
  if (!maksura.some((i) => i.level === 'error' && i.msg.includes('U+0649'))) return 'ى вместо ی не стала ошибкой';
  const maksuraKept = persianOrthographyIssues(['هُدَى'], 'هدى');
  if (maksuraKept.some((i) => i.msg.includes('U+0649'))) return 'ى, которая есть в эталоне, не должна замечаться';

  const wasla = persianOrthographyIssues(['ٱللَّه'], 'الله');
  if (!wasla.some((i) => i.level === 'error' && i.msg.includes('U+0671'))) return 'ٱ вместо ا не стала ошибкой';
  const waslaKept = persianOrthographyIssues(['ٱللَّه'], 'ٱلله');
  if (waslaKept.some((i) => i.msg.includes('U+0671'))) return 'ٱ, которая есть в эталоне, не должна замечаться';

  const yehHamza = persianOrthographyIssues(['ئ'], 'ی');
  if (yehHamza.length) return 'ئ не должна замечаться';

  const bareHamza = persianOrthographyIssues(['ء'], 'ء');
  if (bareHamza.length) return 'ء не должна замечаться';

  const missing = persianOrthographyIssues(['إِلَّا'], null);
  if (!missing.some((i) => i.level === 'error' && i.msg.includes('не найдена'))) return 'إ без эталона должна быть ошибкой';

  return null;
}
