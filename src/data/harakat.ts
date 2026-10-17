/**
 * Full vocalization stays in the data. The «Огласовки» switch only changes what is drawn.
 * Stripping marks must not touch letters, ZWNJ (U+200C) or ZWJ (U+200D): those are what
 * keep Persian joins and the half-space in می‌کند. Combining marks do not take part in
 * Arabic joining, so removing them leaves the same letter connections.
 */

/** Vowels, sukun, shadda, dagger alif, Quranic annotation, open tanwin. Not base letters. */
const MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED\u08D4-\u08E1\u08E3-\u08FF]/g;

/**
 * Vowel marks only, for «is this the same spelling?». Hamza above/below (U+0654, U+0655)
 * and combining madda (U+0653) stay, so an ezafe hamza on ه is part of the spelling.
 */
const VOWEL_ONLY = /[\u064B-\u0652\u0656-\u065F\u0670\u06D6-\u06ED\u08D4-\u08E1\u08E3-\u08FF]/g;

const FATHA = 0x064e;
const DAMMA = 0x064f;
const KASRA = 0x0650;
const FATHATAN = 0x064b;
const DAMMATAN = 0x064c;
const KASRATAN = 0x064d;
const SHADDA = 0x0651;
const SUKUN = 0x0652;
const SUPERSCRIPT_ALEF = 0x0670;

const VOWEL_CPS = new Set([
  FATHATAN,
  DAMMATAN,
  KASRATAN,
  FATHA,
  DAMMA,
  KASRA,
  SUKUN,
  SUPERSCRIPT_ALEF,
  0x08f0,
  0x08f1,
  0x08f2,
]);

/** One-letter prefixes that can sit in front of the article: ب ف و ل ك. */
const ARTICLE_PREFIX = new Set(['ب', 'ف', 'و', 'ل', 'ك', 'ک']);

interface Letter {
  ch: string;
  marks: number[];
}

function isMarkCp(cp: number) {
  return (
    (cp >= 0x064b && cp <= 0x065f) ||
    cp === SUPERSCRIPT_ALEF ||
    (cp >= 0x06d6 && cp <= 0x06ed) ||
    (cp >= 0x08d4 && cp <= 0x08e1) ||
    (cp >= 0x08e3 && cp <= 0x08ff)
  );
}

function isArabicLetter(cp: number) {
  if (cp === 0x0640) return false;
  return (
    (cp >= 0x0621 && cp <= 0x063a) ||
    (cp >= 0x0641 && cp <= 0x064a) ||
    cp === 0x0671 ||
    (cp >= 0x0672 && cp <= 0x06d3) ||
    (cp >= 0x06ee && cp <= 0x06fc) ||
    (cp >= 0x06ff && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08c8)
  );
}

function hasVowel(letter: Letter) {
  return letter.marks.some((cp) => VOWEL_CPS.has(cp));
}

function has(letter: Letter | undefined, cp: number) {
  return !!letter && letter.marks.includes(cp);
}

function shortVowel(letter: Letter | undefined) {
  return has(letter, FATHA) || has(letter, DAMMA) || has(letter, KASRA);
}

/** Split a word into base letters and the combining marks that follow each one. */
function lettersOf(word: string): Letter[] {
  const letters: Letter[] = [];
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\u200c' || ch === '\u200d' || cp === 0x0640) continue;
    if (isMarkCp(cp)) {
      if (letters.length) letters[letters.length - 1].marks.push(cp);
      continue;
    }
    if (isArabicLetter(cp)) letters.push({ ch, marks: [] });
  }
  return letters;
}

function isArticleAlef(letters: Letter[], index: number) {
  if (index < 0) return false;
  const letter = letters[index];
  if (letter.ch !== 'ا' && letter.ch !== 'ٱ') return false;
  if (hasVowel(letter)) return false;
  const lam = letters[index + 1];
  if (!lam || lam.ch !== 'ل') return false;
  const after = letters[index + 2];
  const moon = has(lam, SUKUN);
  const sun = !!after && after.marks.includes(SHADDA);
  if (!moon && !sun) return false;
  if (index === 0) return true;
  const prev = letters[index - 1];
  return index === 1 && ARTICLE_PREFIX.has(prev.ch) && hasVowel(prev);
}

function isSolarLam(letters: Letter[], index: number) {
  const letter = letters[index];
  if (letter.ch !== 'ل' || hasVowel(letter)) return false;
  const next = letters[index + 1];
  if (!next || !next.marks.includes(SHADDA)) return false;
  return isArticleAlef(letters, index - 1);
}

/**
 * Letters that do not take their own vowel in a fully pointed line.
 * Long-vowel matres, the silent alif after the plural waw, hamzat al-wasl,
 * the unpronounced lam before a sun letter, madda-alif, and Persian silent ه.
 */
function isExempt(letters: Letter[], index: number) {
  const letter = letters[index];
  const prev = letters[index - 1];
  if (letter.ch === 'آ') return true;
  if (isArticleAlef(letters, index) || isSolarLam(letters, index)) return true;

  if ((letter.ch === 'ا' || letter.ch === 'ٱ') && !hasVowel(letter)) {
    if (has(prev, FATHA) || has(prev, FATHATAN)) return true;
    const prev2 = letters[index - 2];
    if (prev && prev.ch === 'و' && !hasVowel(prev) && (has(prev2, DAMMA) || has(prev2, DAMMATAN))) return true;
  }

  if (letter.ch === 'ى' && !hasVowel(letter) && (has(prev, FATHA) || has(prev, FATHATAN))) return true;

  if (letter.ch === 'و' && !hasVowel(letter) && (has(prev, DAMMA) || has(prev, DAMMATAN))) return true;

  if ((letter.ch === 'ي' || letter.ch === 'ی') && !hasVowel(letter) && (has(prev, KASRA) || has(prev, KASRATAN))) return true;

  // Silent Persian ه (زنده، گریه) sits after a consonant that already has a short vowel.
  // After a mater the ه is pronounced (ماه، کوه): the mater itself carries no short vowel,
  // so this clause does not exempt it and the sukun stays required.
  if (letter.ch === 'ه' && !hasVowel(letter) && index === letters.length - 1 && prev && shortVowel(prev)) return true;

  return false;
}

export interface HarakatGap {
  /** Letters that should carry a vowel, sukun, tanwin or dagger alif. */
  need: number;
  /** How many of those are still bare. */
  bare: number;
  /** The bare letters themselves, in order, for a human check. */
  bareLetters: string[];
}

/** How many consonants in `text` still lack a vowel sign. Spaces separate words. */
export function harakatGap(text: string): HarakatGap {
  let need = 0;
  const bareLetters: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const letters = lettersOf(word);
    for (let i = 0; i < letters.length; i++) {
      if (isExempt(letters, i)) continue;
      need++;
      if (!hasVowel(letters[i])) bareLetters.push(letters[i].ch);
    }
  }
  return { need, bare: bareLetters.length, bareLetters };
}

/**
 * Soft warning: a noticeable share is at least two bare letters and at least a quarter
 * of the letters that ought to be pointed. One missed sukun in a long line stays quiet.
 * Returns null when the line is fine or has no Arabic letters.
 */
export function harakatWarning(text: string): string | null {
  const gap = harakatGap(text);
  if (gap.need === 0 || gap.bare < 2) return null;
  if (gap.bare / gap.need < 0.25) return null;
  const pct = Math.round((gap.bare / gap.need) * 100);
  return `огласовки неполные: без знака ${gap.bare} из ${gap.need} букв (${pct}%). Не считаются долгие ا و ی, конечная немая ه, алиф васли и лам солнечного артикля. Правило — docs/methodology/04-text.md`;
}

/** Drop vowel signs for display. Letters, ZWNJ and ZWJ stay, so joins do not change. */
export function stripHarakat(text: string): string {
  return text.replace(MARK, '');
}

/** Same letters, including an ezafe hamza, ignoring the vowel signs. Used to check an edit. */
export function stripVowels(text: string): string {
  return text.replace(VOWEL_ONLY, '');
}

export function showHarakatText(text: string, show: boolean) {
  return show ? text : stripHarakat(text);
}
