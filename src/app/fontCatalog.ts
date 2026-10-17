/**
 * Font choices. To add a face: install its files (a pinned @fontsource package, or woff2
 * plus the licence in public/fonts) and add one object to the list below. The settings
 * sheet renders the list. Nothing else needs a new component.
 *
 * Only the selected entry's `text` stylesheets load. `label` is the latin subset for the
 * name in the sheet, and loads when the sheet opens. Inter has no label file: its CSS
 * uses the same family as the interface, so loading it just to draw the word "Inter"
 * would restyle every control.
 */
import {
  getSettings,
  subscribeSettings,
  type FontOriginal,
  type FontPersian,
  type FontTranslation,
  type Settings,
} from './settings';

interface Sheet {
  key: string;
  load: () => Promise<unknown>;
}

export interface FontFace<Id extends string> {
  id: Id;
  /** Name drawn in this face. */
  name: string;
  /** Short Russian note, sentence case. */
  note: string;
  /** Full CSS font-family value, including fallbacks. */
  stack: string;
  /** Line height for a Persian naskh. Nastaliq keeps the stylesheet's 2. */
  lineHeight?: number;
  text: Sheet[];
  label: Sheet[];
}

const started = new Map<string, Promise<unknown>>();

function sheet(key: string, load: () => Promise<unknown>): Sheet {
  return { key, load };
}

function loadSheets(list: Sheet[]) {
  return Promise.all(
    list.map((item) => {
      let job = started.get(item.key);
      if (!job) {
        job = item.load();
        started.set(item.key, job);
      }
      return job;
    }),
  );
}

/** Latin, latin-ext (Turkish and Azerbaijani) and Cyrillic, roman at two weights plus a real italic. */
function serifSheets(prefix: string, loads: {
  l400: () => Promise<unknown>;
  x400: () => Promise<unknown>;
  c400: () => Promise<unknown>;
  l600: () => Promise<unknown>;
  x600: () => Promise<unknown>;
  c600: () => Promise<unknown>;
  l400i: () => Promise<unknown>;
  x400i: () => Promise<unknown>;
  c400i: () => Promise<unknown>;
}): { verse: Sheet[]; reading: Sheet[]; label: Sheet[] } {
  const roman400 = [
    sheet(`${prefix}-l400`, loads.l400),
    sheet(`${prefix}-x400`, loads.x400),
    sheet(`${prefix}-c400`, loads.c400),
  ];
  const roman600 = [
    sheet(`${prefix}-l600`, loads.l600),
    sheet(`${prefix}-x600`, loads.x600),
    sheet(`${prefix}-c600`, loads.c600),
  ];
  const italic400 = [
    sheet(`${prefix}-l400i`, loads.l400i),
    sheet(`${prefix}-x400i`, loads.x400i),
    sheet(`${prefix}-c400i`, loads.c400i),
  ];
  return {
    verse: [...roman600, ...italic400],
    reading: [...roman400, ...roman600, ...italic400],
    label: [sheet(`${prefix}-l400`, loads.l400)],
  };
}

const sourceSerif = serifSheets('ss', {
  l400: () => import('@fontsource/source-serif-4/latin-400.css'),
  x400: () => import('@fontsource/source-serif-4/latin-ext-400.css'),
  c400: () => import('@fontsource/source-serif-4/cyrillic-400.css'),
  l600: () => import('@fontsource/source-serif-4/latin-600.css'),
  x600: () => import('@fontsource/source-serif-4/latin-ext-600.css'),
  c600: () => import('@fontsource/source-serif-4/cyrillic-600.css'),
  l400i: () => import('@fontsource/source-serif-4/latin-400-italic.css'),
  x400i: () => import('@fontsource/source-serif-4/latin-ext-400-italic.css'),
  c400i: () => import('@fontsource/source-serif-4/cyrillic-400-italic.css'),
});

const cormorant = serifSheets('cg', {
  l400: () => import('@fontsource/cormorant-garamond/latin-400.css'),
  x400: () => import('@fontsource/cormorant-garamond/latin-ext-400.css'),
  c400: () => import('@fontsource/cormorant-garamond/cyrillic-400.css'),
  l600: () => import('@fontsource/cormorant-garamond/latin-600.css'),
  x600: () => import('@fontsource/cormorant-garamond/latin-ext-600.css'),
  c600: () => import('@fontsource/cormorant-garamond/cyrillic-600.css'),
  l400i: () => import('@fontsource/cormorant-garamond/latin-400-italic.css'),
  x400i: () => import('@fontsource/cormorant-garamond/latin-ext-400-italic.css'),
  c400i: () => import('@fontsource/cormorant-garamond/cyrillic-400-italic.css'),
});

const eb = serifSheets('eb', {
  l400: () => import('@fontsource/eb-garamond/latin-400.css'),
  x400: () => import('@fontsource/eb-garamond/latin-ext-400.css'),
  c400: () => import('@fontsource/eb-garamond/cyrillic-400.css'),
  l600: () => import('@fontsource/eb-garamond/latin-600.css'),
  x600: () => import('@fontsource/eb-garamond/latin-ext-600.css'),
  c600: () => import('@fontsource/eb-garamond/cyrillic-600.css'),
  l400i: () => import('@fontsource/eb-garamond/latin-400-italic.css'),
  x400i: () => import('@fontsource/eb-garamond/latin-ext-400-italic.css'),
  c400i: () => import('@fontsource/eb-garamond/cyrillic-400-italic.css'),
});

const literata = serifSheets('lit', {
  l400: () => import('@fontsource/literata/latin-400.css'),
  x400: () => import('@fontsource/literata/latin-ext-400.css'),
  c400: () => import('@fontsource/literata/cyrillic-400.css'),
  l600: () => import('@fontsource/literata/latin-600.css'),
  x600: () => import('@fontsource/literata/latin-ext-600.css'),
  c600: () => import('@fontsource/literata/cyrillic-600.css'),
  l400i: () => import('@fontsource/literata/latin-400-italic.css'),
  x400i: () => import('@fontsource/literata/latin-ext-400-italic.css'),
  c400i: () => import('@fontsource/literata/cyrillic-400-italic.css'),
});

export const PERSIAN_FONTS: FontFace<FontPersian>[] = [
  {
    id: 'amiri',
    name: 'Amiri',
    note: 'классический насх',
    stack: "'Amiri', 'KFGQPC Hafs', serif",
    lineHeight: 1.75,
    text: [sheet('amiri-ar', () => import('@fontsource/amiri/arabic-400.css'))],
    label: [sheet('amiri-latin', () => import('@fontsource/amiri/latin-400.css'))],
  },
  {
    id: 'naskh',
    name: 'Noto Naskh Arabic',
    note: 'простой насх',
    stack: "'Noto Naskh Arabic', 'KFGQPC Hafs', serif",
    lineHeight: 1.8,
    text: [sheet('naskh-ar', () => import('@fontsource/noto-naskh-arabic/arabic-400.css'))],
    label: [sheet('naskh-latin', () => import('@fontsource/noto-naskh-arabic/latin-400.css'))],
  },
  {
    id: 'scheherazade',
    name: 'Scheherazade New',
    note: 'крупный насх',
    stack: "'Scheherazade New', 'KFGQPC Hafs', serif",
    lineHeight: 1.9,
    text: [sheet('scheh-ar', () => import('@fontsource/scheherazade-new/arabic-400.css'))],
    label: [sheet('scheh-latin', () => import('@fontsource/scheherazade-new/latin-400.css'))],
  },
  {
    id: 'nastaliq',
    name: 'Noto Nastaliq Urdu',
    note: 'насталик — для знатоков',
    stack: "'Noto Nastaliq Urdu', 'KFGQPC Hafs', serif",
    lineHeight: 2,
    text: [sheet('nast-ar', () => import('@fontsource/noto-nastaliq-urdu/arabic-400.css'))],
    label: [sheet('nast-latin', () => import('@fontsource/noto-nastaliq-urdu/latin-400.css'))],
  },
];

export const ORIGINAL_FONTS: FontFace<FontOriginal>[] = [
  {
    id: 'source-serif',
    name: 'Source Serif 4',
    note: 'классическая антиква',
    stack: "'Source Serif 4', 'Iowan Old Style', Palatino, Georgia, serif",
    text: sourceSerif.verse,
    label: sourceSerif.label,
  },
  {
    id: 'cormorant',
    name: 'Cormorant Garamond',
    note: 'прежний шрифт стиха',
    stack: "'Cormorant Garamond', 'Iowan Old Style', Palatino, Georgia, serif",
    text: cormorant.verse,
    label: cormorant.label,
  },
  {
    id: 'eb-garamond',
    name: 'EB Garamond',
    note: 'гарамонд',
    stack: "'EB Garamond', 'Iowan Old Style', Palatino, Georgia, serif",
    text: eb.verse,
    label: eb.label,
  },
  {
    id: 'literata',
    name: 'Literata',
    note: 'текстовая антиква',
    stack: "'Literata', Georgia, serif",
    text: literata.verse,
    label: literata.label,
  },
];

export const TRANSLATION_FONTS: FontFace<FontTranslation>[] = [
  {
    id: 'source-serif',
    name: 'Source Serif 4',
    note: 'классическая антиква, легче стиха',
    stack: "'Source Serif 4', Georgia, serif",
    text: sourceSerif.reading,
    label: sourceSerif.label,
  },
  {
    id: 'inter',
    name: 'Inter',
    note: 'гротеск',
    stack: "'Inter Variable', system-ui, sans-serif",
    text: [sheet('inter', () => import('../styles/inter-used.css'))],
    label: [],
  },
];

function findFace<Id extends string>(list: FontFace<Id>[], id: Id): FontFace<Id> {
  return list.find((face) => face.id === id) ?? list[0];
}

/** Write the chosen families onto the tokens. Safe when there is no document. */
export function applyFonts(s: Settings) {
  if (typeof document === 'undefined') return;
  const persian = findFace(PERSIAN_FONTS, s.fontPersian);
  const original = findFace(ORIGINAL_FONTS, s.fontOriginal);
  const translation = findFace(TRANSLATION_FONTS, s.fontTranslation);
  const root = document.documentElement;
  root.style.setProperty('--font-serif', original.stack);
  root.style.setProperty('--font-tr', translation.stack);
  root.style.setProperty('--font-persian', persian.stack);
  root.style.setProperty('--font-persian-lh', String(persian.lineHeight ?? 1.8));
  if (persian.id === 'nastaliq') root.style.setProperty('--font-nastaliq', persian.stack);
}

/** Stylesheets for the three chosen faces. Already-loaded files are not requested again. */
export function loadSelectedFonts(s: Settings) {
  const persian = findFace(PERSIAN_FONTS, s.fontPersian);
  const original = findFace(ORIGINAL_FONTS, s.fontOriginal);
  const translation = findFace(TRANSLATION_FONTS, s.fontTranslation);
  return loadSheets([...persian.text, ...original.text, ...translation.text]);
}

/** Latin subsets so each name in the sheet is drawn in its own face. */
export function loadFontLabels() {
  return loadSheets([...PERSIAN_FONTS, ...ORIGINAL_FONTS, ...TRANSLATION_FONTS].flatMap((face) => face.label));
}

function nudgeMeasure() {
  const stage = document.querySelector('.scene-stage');
  if (!(stage instanceof HTMLElement)) return;
  const previous = stage.style.width;
  stage.style.width = 'calc(100% - 0.5px)';
  requestAnimationFrame(() => {
    stage.style.width = previous;
  });
}

function boot() {
  if (typeof document === 'undefined') return;
  try {
    localStorage.removeItem('living-lyrics.font-preview');
  } catch {
    /* private mode */
  }
  const sync = () => {
    const s = getSettings();
    applyFonts(s);
    void loadSelectedFonts(s).then(nudgeMeasure);
  };
  sync();
  subscribeSettings(sync);
  document.fonts?.addEventListener?.('loadingdone', nudgeMeasure);
}

boot();
