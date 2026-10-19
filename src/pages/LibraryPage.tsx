import { useEffect, useMemo, useRef, useState } from 'react';
import { songs, LANG_NAMES } from '@/data/library';
import type { Song } from '@/data/schema';
import { prefetchLyrics } from '@/app/prefetch';
import { linkHandler } from '@/app/router';
import { useSettings } from '@/app/settings';
import { useAppliedTheme } from '@/app/theme';
import { Icon } from '@/ui/icons';
import { Field } from '@/scene/Field';

function statusOf(song: Song) {
  if (song.audio.status === 'missing') return { text: 'Без аудио', tone: 'muted' as const };
  return null;
}

/** The cover paints `coverGlyph`, and falls back to the title when the glyph is absent. */
function coverDrawsTitle(song: Song): boolean {
  const glyph = (song.coverGlyph ?? song.title).trim().toLocaleLowerCase('en');
  return glyph === song.title.trim().toLocaleLowerCase('en');
}

/**
 * Glass line under the cover. When the cover already draws the title, the line is the
 * opening part — the same quiet name the song header shows under the title. Otherwise
 * the title itself, which the cover does not paint.
 */
function tileLead(song: Song): string {
  if (!coverDrawsTitle(song)) return song.title;
  return song.parts?.[0]?.title ?? '';
}

export function LibraryPage() {
  const dark = useAppliedTheme(useSettings().theme);
  const [q, setQ] = useState('');
  const wash = useMemo(() => {
    const colors = songs.flatMap((s) => s.palette.field).filter((c): c is string => !!c);
    return [0, 1, 2, 3].map((i) => colors[i % Math.max(colors.length, 1)] ?? '#3a2a22');
  }, []);
  const clock = useRef(() => performance.now() / 1000).current;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return songs;
    return songs.filter((song) =>
      [song.title, song.titleOriginal, song.artist, song.release?.album, ...(song.poets ?? []).map((p) => p.name), ...song.languages.map((l) => LANG_NAMES[l])]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(s)),
    );
  }, [q]);

  return (
    <div className="library">
      <Field colors={wash} dark={dark} clock={clock} />
      <header className="lib-head">
        <div className="lib-titlebar">
          <h1 className="t-large-title">Песни</h1>
          <div className="lib-actions">
            <a className="btn btn-circle btn-quiet" href="/instruments" onClick={linkHandler('/instruments')} aria-label="Инструменты: галерея гравюр">
              <Icon name="square.grid.2x2" size={20} />
            </a>
            <a className="btn btn-circle btn-quiet" href="/method" onClick={linkHandler('/method')} aria-label="Методология">
              <Icon name="book.pages" size={21} />
            </a>
          </div>
        </div>
        <label className="search">
          <Icon name="magnifyingglass" size={17} weight={2} className="search-icon" />
          <input
            type="search"
            className="search-input"
            placeholder="Название, поэт, язык"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск"
          />
        </label>
      </header>

      <ul className="lib-list">
        {list.map((song) => (
          <li key={song.slug}>
            <SongTile song={song} />
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="lib-empty t-body secondary">Ничего не найдено.</p>}
      <footer className="lib-foot t-footnote tertiary">
        Тексты, переводы и пояснения — {songs.length} {plural(songs.length, 'песня', 'песни', 'песен')}. Как добавить новую — в разделе «Методология».
      </footer>
    </div>
  );
}

/** Lyrics for a visible or pointed-at song, so the tap does not wait on that chunk. */
function SongTile({ song }: { song: Song }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (done || !entries.some((e) => e.isIntersecting)) return;
        done = true;
        io.disconnect();
        const run = () => prefetchLyrics(song.slug);
        const host = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
        if (typeof host.requestIdleCallback === 'function') host.requestIdleCallback(run, { timeout: 1200 });
        else window.setTimeout(run, 280);
      },
      { rootMargin: '160px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [song.slug]);

  const st = statusOf(song);
  const lead = tileLead(song);
  const warm = () => prefetchLyrics(song.slug);
  return (
    <a
      ref={ref}
      className="lib-tile"
      href={`/song/${song.slug}`}
      onClick={linkHandler(`/song/${song.slug}`)}
      onPointerEnter={warm}
      onPointerDown={warm}
      onFocus={warm}
    >
      <img
        className="lib-tile-cover"
        src={`/covers/${song.slug}/512.png`}
        srcSet={`/covers/${song.slug}/512.png 512w, /covers/${song.slug}/1024.png 1024w`}
        sizes="(min-width: 1100px) 240px, (min-width: 700px) 30vw, 46vw"
        alt=""
      />
      <span className="lib-tile-cap glass glass--strong">
        {coverDrawsTitle(song) && <span className="visually-hidden">{song.title}</span>}
        {lead && <span className="lib-tile-title">{lead}</span>}
        <span className="lib-tile-artist">{song.artist}</span>
      </span>
      {st && <span className={`chip chip--${st.tone} t-caption1`}>{st.text}</span>}
    </a>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
