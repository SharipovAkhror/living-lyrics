/** Generated cover: the song's colour field with its key word set in the script it is sung in. */
import type { Song } from '@/data/schema';

const ARABIC = /[؀-ۿ]/;

export function Cover({ song, size = 'md' }: { song: Song; size?: 'md' | 'lg' }) {
  const [a, b, c, d] = song.palette.field;
  const glyph = song.coverGlyph ?? song.title;
  const arabic = ARABIC.test(glyph);
  return (
    <div
      className={`cover cover--${size}`}
      style={{
        background: `radial-gradient(120% 90% at 15% 10%, ${a} 0%, transparent 60%),
          radial-gradient(110% 90% at 90% 20%, ${b} 0%, transparent 55%),
          radial-gradient(120% 110% at 60% 100%, ${c} 0%, transparent 60%),
          ${d ?? c}`,
      }}
      aria-hidden
    >
      <div className="cover-grain" />
      <span className={`cover-glyph ${arabic ? 'f-mushaf' : 'f-serif'}`} dir={arabic ? 'rtl' : 'ltr'}>
        {glyph}
      </span>
    </div>
  );
}
