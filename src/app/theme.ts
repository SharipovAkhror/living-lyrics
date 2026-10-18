import { useEffect, useLayoutEffect, useState } from 'react';
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
    meta?.setAttribute('content', dark ? '#07060c' : '#efe6da');
  }, [dark]);
  return dark;
}

/** Relative luminance, so the sheet can tint itself with the darkest sky stop. */
function darkest(colors: string[]): string {
  let best = colors[0] ?? '#221820';
  let bestL = 2;
  for (const hex of colors) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
    const n = parseInt(hex.slice(1), 16);
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    if (L < bestL) {
      bestL = L;
      best = hex;
    }
  }
  return best;
}

/** Per-song accent colours on <html> while a song is open. Layout, so the first paint already has them. */
export function useSongAccent(song: Song | undefined) {
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    if (!song) return;
    root.setProperty('--song-accent', song.palette.accent);
    root.setProperty('--song-accent-dark', song.palette.accentDark);
    root.setProperty('--song-field', darkest(song.palette.field));
    return () => {
      root.removeProperty('--song-accent');
      root.removeProperty('--song-accent-dark');
      root.removeProperty('--song-field');
    };
  }, [song]);
}
