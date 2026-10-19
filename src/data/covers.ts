import type { Song } from './schema';

export type CoverExt = 'jpg' | 'png';

/** File extension of the squares in public/covers. A song without `cover` still uses the field png. */
export function coverExt(song: Pick<Song, 'cover'>): CoverExt {
  return song.cover?.ext === 'jpg' ? 'jpg' : 'png';
}

export function coverUrl(slug: string, size: number, ext: CoverExt): string {
  return `/covers/${slug}/${size}.${ext}`;
}

export function coverMime(ext: CoverExt): 'image/jpeg' | 'image/png' {
  return ext === 'jpg' ? 'image/jpeg' : 'image/png';
}
