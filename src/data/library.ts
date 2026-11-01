import { hideDraftComments } from './comments';
import { LyricsSchema, PeaksSchema, SongSchema, type Lyrics, type Peaks, type Song } from './schema';

const songModules = import.meta.glob('/content/songs/*/song.json', { eager: true, import: 'default' });
const lyricsModules = import.meta.glob('/content/songs/*/lyrics.json', { import: 'default' });

function slugOf(path: string) {
  return path.split('/').at(-2)!;
}

export const songs: Song[] = Object.entries(songModules)
  .map(([path, raw]) => {
    const parsed = SongSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`content/songs/${slugOf(path)}/song.json is invalid`, parsed.error.issues);
      return null;
    }
    return parsed.data;
  })
  .filter((s): s is Song => s !== null)
  .sort((a, b) => a.title.localeCompare(b.title));

export function getSong(slug: string): Song | undefined {
  return songs.find((s) => s.slug === slug);
}

export async function loadLyrics(slug: string): Promise<Lyrics> {
  const loader = lyricsModules[`/content/songs/${slug}/lyrics.json`];
  if (!loader) throw new Error(`No lyrics for ${slug}`);
  const raw = await loader();
  // The only gate: draft commentary is gone before a screen, a search or a font check can see it.
  return hideDraftComments(LyricsSchema.parse(raw));
}

export async function loadPeaks(url: string): Promise<Peaks | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return PeaksSchema.parse(await res.json());
  } catch {
    return null;
  }
}

export const LANG_NAMES: Record<string, string> = {
  ar: 'арабский',
  fa: 'персидский',
  az: 'азербайджанский',
  tr: 'турецкий',
  ota: 'османский',
  en: 'английский',
  la: 'латынь',
  de: 'немецкий',
  gmh: 'средневерхненемецкий',
  es: 'испанский',
  ur: 'урду',
  hi: 'хинди',
  ru: 'русский',
  uz: 'узбекский',
  fr: 'французский',
  it: 'итальянский',
};

export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
