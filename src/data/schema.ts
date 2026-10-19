/**
 * Data contract for a song. One folder per song: content/songs/<slug>/{song.json, lyrics.json, sources.md}.
 * The validator (scripts/tools/validate.ts), the app and the onboarding agent all read this file,
 * so any change here is a change to the methodology (docs/data-format.md).
 */
import { z } from 'zod';
import { LAYOUT_MODES } from '../instruments/layout';
import { ISO639 } from './iso639';

/**
 * Any ISO 639-1 or ISO 639-3 code (see src/data/iso639.ts). A new language is a code
 * from that list, not a new module. The error names the bad value.
 */
export const LANG = z.string().superRefine((value, ctx) => {
  if (ISO639.has(value)) return;
  const shape = /^[a-z]{2,3}$/.test(value)
    ? 'такого кода нет в ISO 639-1 и ISO 639-3'
    : 'нужны строчные латинские буквы: 2 (ISO 639-1) или 3 (ISO 639-3)';
  ctx.addIssue({
    code: 'custom',
    message: `язык «${value}»: ${shape}. Примеры: fa, ar, he, hi, la; ota — османский, gmh — средневерхненемецкий, grc — древнегреческий. Список — src/data/iso639.ts, пояснение — docs/data-format.md.`,
  });
});
export type Lang = z.infer<typeof LANG>;

/**
 * ISO 15924 codes for scripts a sung line may use. Arabic script (Arabic, Persian,
 * Ottoman, Urdu) is `Arab`. Adding a song in one of these scripts does not need new code.
 */
export const SCRIPT_CODES = [
  'Latn', 'Cyrl', 'Grek', 'Glag',
  'Arab', 'Aran', 'Syrc', 'Hebr', 'Mand', 'Samr', 'Thaa', 'Nkoo', 'Adlm', 'Rohg', 'Mend',
  'Armn', 'Geor',
  'Deva', 'Beng', 'Guru', 'Gujr', 'Orya', 'Taml', 'Telu', 'Knda', 'Mlym', 'Sinh', 'Olck', 'Mtei',
  'Thai', 'Laoo', 'Khmr', 'Mymr', 'Tibt', 'Tale', 'Lana', 'Limb', 'Lisu',
  'Hani', 'Hans', 'Hant', 'Jpan', 'Kore', 'Hang', 'Hira', 'Kana', 'Bopo', 'Yiii',
  'Ethi', 'Tfng',
  'Mong',
  'Cans', 'Cher',
  'Bali', 'Batk', 'Java', 'Sund',
] as const;

const SCRIPT_SET = new Set<string>(SCRIPT_CODES);

/** Scripts written right to left. The Scene should use this set for `dir` (see timeline.ts). */
export const RTL_SCRIPTS = ['Adlm', 'Arab', 'Aran', 'Hebr', 'Mand', 'Mend', 'Nkoo', 'Rohg', 'Samr', 'Syrc', 'Thaa'] as const;

export function isRtlScript(script: string) {
  return (RTL_SCRIPTS as readonly string[]).includes(script);
}

export const SCRIPT = z.string().superRefine((value, ctx) => {
  if (SCRIPT_SET.has(value)) return;
  ctx.addIssue({
    code: 'custom',
    message: `письмо «${value}» не из списка ISO 15924 в SCRIPT_CODES (src/data/schema.ts). Четыре буквы, как в стандарте: Latn, Cyrl, Arab, Hebr, Grek, Armn, Geor, Deva, Hani, Jpan, Kore. Пояснение — docs/data-format.md.`,
  });
});
export type Script = z.infer<typeof SCRIPT>;

const seconds = z.number().min(0);

/**
 * One instrument entering during a section. `at` and `until` are seconds from the start of the
 * recording, and both fall inside the section. Order in the array is the order of appearance.
 * Omit `until` when the instrument keeps playing until the section ends.
 */
export const InstrumentEntrySchema = z.object({
  key: z.string().min(1),
  at: seconds,
  until: seconds.optional(),
});
export type InstrumentEntry = z.infer<typeof InstrumentEntrySchema>;

/** A sung word. `s`/`e` are seconds from the start of the audio file. */
export const WordSchema = z.object({
  w: z.string().min(1),
  s: seconds,
  e: seconds,
  /** Visual line break after this word. */
  br: z.boolean().optional(),
  /** Key word: the Scene may enlarge or tint it. Use sparingly: 0–1 per line. */
  em: z.boolean().optional(),
});
export type Word = z.infer<typeof WordSchema>;

/** Named entrance/exit choreography. Omit to let the Scene choose. See docs/methodology/10-choreography.md. */
export const FX = z.enum([
  'auto',
  'rise',
  'focus',
  'ink',
  'assemble',
  'drop',
  'bloom',
  'cascade',
  'spotlight',
  'stack',
  'whisper',
]);
export type Fx = z.infer<typeof FX>;

export const FLAG = z.enum([
  'text-unverified',
  'timing-draft',
  'translation-draft',
  'comment-draft',
  'attribution-unverified',
]);
export type Flag = z.infer<typeof FLAG>;

export const LineSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  lang: LANG,
  script: SCRIPT,
  /** Words exactly as sung, in order (including repetitions). Line text = words joined by spaces. */
  words: z.array(WordSchema).min(1),
  /** Same line in another script (e.g. Fuzuli in Arabic script). Shown only when the reader enables it. */
  alt: z.object({ script: SCRIPT, text: z.string().min(1) }).optional(),
  /** Pronunciation in Cyrillic, following docs/methodology/08-transliteration.md. */
  translit: z.string().optional(),
  /** Translations keyed by language. `ru` is required for every vocal line. */
  tr: z.object({ ru: z.string().min(1) }).catchall(z.string()),
  /** What the translation could not carry. Light markdown: *italic*, **bold**. Arabic-script runs are auto-styled. */
  comment: z.string().optional(),
  /** Who sings this line, when it differs from the section voice. */
  voice: z.string().optional(),
  /** Which aligner placed the line. Omitted when the line stays on the cue. */
  placedBy: z.enum(['mms', 'mms-window', 'mms-ft', 'stable-ts', 'second']).optional(),
  fx: FX.optional(),
  flags: z.array(FLAG).optional(),
});
export type Line = z.infer<typeof LineSchema>;

const SectionBase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  start: seconds,
  end: seconds,
  /** Short human label, sentence case: «Газель Физули, бейт 1». */
  label: z.string().min(1),
  comment: z.string().optional(),
  flags: z.array(FLAG).optional(),
  /**
   * Who starts playing when, inside this section. On an instrumental section this is the entrance
   * order (the small screen reveals drawings in this order). On a vocal section it is accompaniment,
   * not the singer — the singer stays in `voice`. Keys come from the instrument catalogue.
   */
  entries: z.array(InstrumentEntrySchema).optional(),
});

export const VocalSectionSchema = SectionBase.extend({
  kind: z.literal('vocal'),
  /** Main voice(s): «Сами Юсуф», «Cappella Amsterdam». */
  voice: z.string().optional(),
  lines: z.array(LineSchema).min(1),
});

export const InstrumentalSectionSchema = SectionBase.extend({
  kind: z.literal('instrumental'),
  /**
   * Keys from src/instruments/catalog.ts. The first one is drawn large.
   * An empty list is an empty stage (applause and bows): the scene must not invent an ensemble.
   * Voice or choir stays first when the passage is a vocalise with instruments entering later.
   */
  instruments: z.array(z.string()),
  performers: z.array(z.string()).optional(),
  /** Maqam / mode / meter, if known. */
  mode: z.string().optional(),
  /** One or two calm sentences shown under the illustration. */
  note: z.string().optional(),
  /**
   * How several instruments share the stage. Omit to let the engine choose by count and screen
   * (src/instruments/layout.ts, docs/methodology/09-instruments.md); set it only to override that choice.
   */
  layout: z.enum(LAYOUT_MODES).optional(),
});

export const SectionSchema = z.discriminatedUnion('kind', [VocalSectionSchema, InstrumentalSectionSchema]);
export type Section = z.infer<typeof SectionSchema>;
export type VocalSection = z.infer<typeof VocalSectionSchema>;
export type InstrumentalSection = z.infer<typeof InstrumentalSectionSchema>;

export const LyricsSchema = z.object({
  $schema: z.string().optional(),
  sections: z.array(SectionSchema).min(1),
});
export type Lyrics = z.infer<typeof LyricsSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * One stretch of sung text: whose words, from which book, where it is heard.
 * Order in `song.parts` is the order of first appearance. Omit `author` or `work`
 * when the sources do not name them — the card then says «не установлено».
 */
export const PartSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** Short Russian name, ordinary case. Shown on the card and, quietly, under the song title. */
    title: z.string().min(1),
    /** Language of this stretch. Same ISO 639 codes as a line. */
    lang: LANG,
    /**
     * Author of the sung words, when a source names one. `years` is the life span
     * or the era the source actually gives («1098–1179», «ум. 1556», «XIII в.»).
     * `original` is the name in its own script.
     */
    author: z
      .object({
        name: z.string().min(1),
        years: z.string().min(1).optional(),
        original: z.string().min(1).optional(),
      })
      .optional(),
    /**
     * The work and the book. `original` is the title in its own script, `ru` the Russian name.
     * `lang` is the language of that title when it is not the language of the stretch
     * (a Persian ghazal sung in an English rendering).
     */
    work: z
      .object({
        original: z.string().min(1).optional(),
        ru: z.string().min(1).optional(),
        lang: LANG.optional(),
      })
      .optional(),
    /** Ghazal number, bayts, chapter, page, edition — as the source states them. */
    ref: z.string().min(1).optional(),
    /** A http(s) URL already written in sources.md. */
    url: z
      .string()
      .regex(/^https?:\/\/\S+$/)
      .optional(),
    /** One sentence: how this stretch is heard in the recording. */
    note: z.string().min(1),
    /** Section ids where the stretch is heard. A vocal section covers every line in it. */
    sections: z.array(z.string().min(1)).optional(),
    /** Line ids, when only some lines of a section belong here. */
    lines: z.array(z.string().min(1)).optional(),
  })
  .superRefine((part, ctx) => {
    if ((part.sections?.length ?? 0) + (part.lines?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'нужны sections или lines: где часть звучит',
        path: ['sections'],
      });
    }
    if (part.work && !part.work.original && !part.work.ru) {
      ctx.addIssue({ code: 'custom', message: 'у work нужно original или ru', path: ['work'] });
    }
  });
export type Part = z.infer<typeof PartSchema>;

export const SongSchema = z.object({
  $schema: z.string().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  /** Optional title in the original script, e.g. «مرده بدم زنده شدم». */
  titleOriginal: z.string().optional(),
  artist: z.string().min(1),
  featuring: z.array(z.string()).optional(),
  release: z
    .object({
      album: z.string().optional(),
      year: z.number().int().optional(),
      label: z.string().optional(),
    })
    .optional(),
  performance: z
    .object({
      event: z.string().optional(),
      venue: z.string().optional(),
      city: z.string().optional(),
      date: z.string().optional(),
    })
    .optional(),
  /** Languages actually sung, in order of appearance. */
  languages: z.array(LANG).min(1),
  /** Authors of the sung texts. */
  poets: z.array(z.object({ name: z.string(), lang: LANG.optional(), era: z.string().optional() })).optional(),
  /** Duration of the delivered audio file in seconds. */
  duration: z.number().positive(),
  /** Per-song colour identity. Accent must pass contrast checks in both themes (see design docs). */
  palette: z.object({
    accent: hex,
    accentDark: hex,
    /** 3–4 colours for the animated background field. */
    field: z.array(hex).min(3).max(4),
  }),
  /**
   * Unused. Covers are painted from `palette.field` only; nothing is drawn on them.
   * Kept so song files that still carry the old word continue to validate.
   */
  coverGlyph: z.string().optional(),
  audio: z.object({
    status: z.enum(['missing', 'ready']),
    /** Paths under /public. `high` is required when status is ready. */
    high: z.string().optional(),
    saver: z.string().optional(),
    peaks: z.string().optional(),
    /** Gain to reach the library loudness target (−14 LUFS). Applied by the player, never baked in. */
    gainDb: z.number().optional(),
    provenance: z
      .object({
        kind: z.enum(['file', 'url', 'purchase']),
        ref: z.string(),
        retrieved: z.string().optional(),
        codec: z.string().optional(),
        sha256: z.string().optional(),
      })
      .optional(),
  }),
  timing: z.object({
    status: z.enum(['draft', 'aligned', 'verified']),
    method: z.string(),
    notes: z.string().optional(),
  }),
  credits: z.array(z.object({ role: z.string(), name: z.string() })).optional(),
  /** Open questions an agent or editor must close before the song is «verified». */
  review: z.array(z.string()).optional(),
  /** Whose words each stretch is, in order of first hearing. See PartSchema. */
  parts: z.array(PartSchema).min(1).optional(),
});
export type Song = z.infer<typeof SongSchema>;

/** Peaks file produced by scripts/pipeline/peaks.py. */
export const PeaksSchema = z.object({
  rate: z.number().positive(),
  duration: z.number().positive(),
  /** Normalised RMS 0..1, `rate` values per second. */
  rms: z.array(z.number()),
});
export type Peaks = z.infer<typeof PeaksSchema>;
