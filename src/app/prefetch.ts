/**
 * Warm what the next tap needs, without a second media element.
 * Another <audio> would compete with the playback session that keeps the song
 * alive on the lock screen, so recordings are hinted with a prefetch link only.
 */
import { loadLyrics, songs } from '@/data/library';
import type { Song } from '@/data/schema';
import { eagerAudio, readNetHint } from '@/player/preload';

const lyricsStarted = new Set<string>();

export function prefetchLyrics(slug: string) {
  if (!slug || lyricsStarted.has(slug)) return;
  lyricsStarted.add(slug);
  void loadLyrics(slug).catch(() => {
    lyricsStarted.delete(slug);
  });
}

/** The following song in the library order, or null at the end of the list. */
export function nextSlug(slug: string): string | null {
  const i = songs.findIndex((s) => s.slug === slug);
  if (i < 0 || i + 1 >= songs.length) return null;
  return songs[i + 1].slug;
}

export function recordingUrl(song: Song, quality: 'high' | 'saver'): string | undefined {
  if (quality === 'saver') return song.audio.saver ?? song.audio.high;
  return song.audio.high ?? song.audio.saver;
}

const audioHinted = new Set<string>();

/** Ask the browser to cache a recording. No-op on a slow or metered connection. */
export function prefetchRecording(url: string | undefined) {
  if (!url || audioHinted.has(url) || typeof document === 'undefined') return;
  if (!eagerAudio(readNetHint(navigator))) return;
  audioHinted.add(url);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'audio';
  link.href = url;
  document.head.appendChild(link);
}
