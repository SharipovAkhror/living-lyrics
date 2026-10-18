import type { Cue } from '@/data/timeline';
import type { Lyrics, Part, Song } from '@/data/schema';

/** The part that covers this sung line, if the song has a composition. */
export function partForLine(song: Song, sectionId: string, lineId: string): Part | undefined {
  return song.parts?.find((part) => part.sections?.includes(sectionId) || part.lines?.includes(lineId));
}

/**
 * Start of the part: the first word of its earliest line, in the order of the recording.
 * Exact word start, so the header names the part on the same frame the line becomes current.
 */
export function partStart(part: Part, lyrics: Lyrics | null): number | null {
  if (!lyrics) return null;
  const sections = new Set(part.sections ?? []);
  const lines = new Set(part.lines ?? []);
  for (const section of lyrics.sections) {
    if (section.kind !== 'vocal') continue;
    for (const line of section.lines) {
      if (!sections.has(section.id) && !lines.has(line.id)) continue;
      const start = line.words[0]?.s;
      if (typeof start === 'number') return start;
    }
  }
  return null;
}

/** Quiet line under the song title: the part name while its words are current, otherwise the section label. */
export function headerLine(song: Song, cue: Cue | null): string {
  if (!cue) return song.artist;
  if (cue.kind === 'line') {
    const part = partForLine(song, cue.section.id, cue.line.id);
    if (part) return part.title;
  }
  return cue.section.label;
}
