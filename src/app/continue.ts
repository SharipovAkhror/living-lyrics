/** Last song the reader opened. The library features it; a private window simply has none. */
const KEY = 'living-lyrics.continue';

export function rememberedSong(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberSong(slug: string) {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    /* private mode: the library opens on the first song */
  }
}
