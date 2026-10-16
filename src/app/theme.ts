import { useEffect, useState } from 'react';
import type { Song } from '@/data/schema';
import type { ThemePref } from './settings';

/** Applies the theme preference to <html> and reports whether the page is currently dark. */
export function useAppliedTheme(pref: ThemePref): boolean {
  const query = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [systemDark, setSystemDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const fn = () => setSystemDark(query.matches);
    query.addEventListener('change', fn);
    return () => query.removeEventListener('change', fn);
  }, [query]);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'auto') delete root.dataset.theme;
    else root.dataset.theme = pref;
  }, [pref]);
  const dark = pref === 'dark' || (pref === 'auto' && systemDark);
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  }, [dark]);
  return dark;
}

/** Per-song accent colours on <html> while a song is open. */
export function useSongAccent(song: Song | undefined) {
  useEffect(() => {
    const root = document.documentElement.style;
    if (!song) return;
    root.setProperty('--song-accent', song.palette.accent);
    root.setProperty('--song-accent-dark', song.palette.accentDark);
    return () => {
      root.removeProperty('--song-accent');
      root.removeProperty('--song-accent-dark');
    };
  }, [song]);
}
