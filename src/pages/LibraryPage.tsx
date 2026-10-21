import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { coverExt, coverUrl } from '@/data/covers';
import { songs, LANG_NAMES } from '@/data/library';
import type { Song } from '@/data/schema';
import { prefetchLyrics } from '@/app/prefetch';
import { linkHandler } from '@/app/router';
import { rememberedSong } from '@/app/continue';
import { useSettings } from '@/app/settings';
import { useAppliedTheme } from '@/app/theme';
import { Icon } from '@/ui/icons';
import { Field } from '@/scene/Field';
import { Status } from '@/components/Status';

function statusOf(song: Song) {
  if (song.audio.status === 'missing') return { text: 'Без аудио', tone: 'muted' as const };
  return null;
}

function langsOf(song: Song) {
  return song.languages.map((code) => LANG_NAMES[code] ?? code).join(' · ');
}

/** One cover carries the shared name into the song. Pointer-down moves it onto the cover that was touched. */
function armPoster(event: PointerEvent<HTMLAnchorElement>) {
  const root = event.currentTarget.closest('.library');
  root?.querySelectorAll<HTMLElement>('[data-poster]').forEach((el) => {
    el.style.viewTransitionName = '';
  });
  const poster = event.currentTarget.querySelector<HTMLElement>('[data-poster]');
  if (poster) poster.style.viewTransitionName = 'song-poster';
}

export function LibraryPage() {
  const dark = useAppliedTheme(useSettings().theme);
  const [q, setQ] = useState('');
  const [remembered, setRemembered] = useState<string | null>(null);
  const wash = useMemo(() => {
    const colors = songs.flatMap((s) => s.palette.field).filter((c): c is string => !!c);
    return [0, 1, 2, 3].map((i) => colors[i % Math.max(colors.length, 1)] ?? '#3a2a22');
  }, []);
  const clock = useRef(() => performance.now() / 1000).current;
  useEffect(() => {
    setRemembered(rememberedSong());
  }, []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return songs;
    return songs.filter((song) =>
      [song.title, song.titleOriginal, song.version.label, song.artist, song.release?.album, ...(song.poets ?? []).map((p) => p.name), ...song.languages.map((l) => LANG_NAMES[l])]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(s)),
    );
  }, [q]);
  const searching = q.trim().length > 0;
  const featured = searching ? null : (list.find((song) => song.slug === remembered) ?? list[0] ?? null);
  const shelf = featured ? list.filter((song) => song.slug !== featured.slug) : list;

  return (
    <div className="library">
      <Field colors={wash} dark={dark} clock={clock} />
      <header className="lib-head">
        <div className="lib-titlebar">
          <h1 className="lib-title">Песни</h1>
          <nav className="lib-actions" aria-label="Разделы">
            <a className="lib-nav" href="/instruments" onClick={linkHandler('/instruments')} aria-label="Инструменты: галерея гравюр">
              <Icon name="square.grid.2x2" size={20} />
              <span className="lib-nav-label">Инструменты</span>
            </a>
            <a className="lib-nav" href="/method" onClick={linkHandler('/method')} aria-label="Методология">
              <Icon name="book.pages" size={20} />
              <span className="lib-nav-label">Методология</span>
            </a>
          </nav>
        </div>
        <label className="search">
          <Icon name="magnifyingglass" size={20} className="search-icon" />
          <input
            type="search"
            className="search-input"
            placeholder="Название, версия, поэт, язык"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск"
          />
        </label>
      </header>

      {featured && <Hero song={featured} continued={featured.slug === remembered} dark={dark} />}

      {shelf.length > 0 && (
        <ul className="lib-shelf">
          {shelf.map((song) => (
            <li key={song.slug}>
              <ShelfRow song={song} continued={song.slug === remembered} dark={dark} />
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 && (
        <Status
          className="lib-empty status--stack glass"
          icon="magnifyingglass"
          title="Ничего не найдено"
          live="status"
          action={
            <button type="button" className="btn btn-capsule btn-tinted" onClick={() => setQ('')}>
              Очистить поиск
            </button>
          }
        >
          По этому запросу песен нет.
        </Status>
      )}
    </div>
  );
}

/** Lyrics for a visible or pointed-at song, so the tap does not wait on that chunk. */
function useWarm(slug: string) {
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
        const run = () => prefetchLyrics(slug);
        const host = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
        if (typeof host.requestIdleCallback === 'function') host.requestIdleCallback(run, { timeout: 1200 });
        else window.setTimeout(run, 280);
      },
      { rootMargin: '160px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [slug]);
  return { ref, warm: () => prefetchLyrics(slug) };
}

function posterStyle(on: boolean): CSSProperties | undefined {
  return on ? { viewTransitionName: 'song-poster' } : undefined;
}

function tone(song: Song, dark: boolean): CSSProperties {
  return {
    '--glow': song.palette.field[0],
    '--accent': dark ? song.palette.accentDark : song.palette.accent,
  } as CSSProperties;
}

function Cover({ song, className, poster, sizes }: { song: Song; className: string; poster: boolean; sizes: string }) {
  const ext = coverExt(song);
  return (
    <img
      data-poster=""
      className={className}
      style={posterStyle(poster)}
      src={coverUrl(song.slug, 512, ext)}
      srcSet={`${coverUrl(song.slug, 512, ext)} 512w, ${coverUrl(song.slug, 1024, ext)} 1024w`}
      sizes={sizes}
      alt=""
    />
  );
}

function Hero({ song, continued, dark }: { song: Song; continued: boolean; dark: boolean }) {
  const { ref, warm } = useWarm(song.slug);
  const st = statusOf(song);
  return (
    <a
      ref={ref}
      className="lib-hero glass"
      href={`/song/${song.slug}`}
      onClick={linkHandler(`/song/${song.slug}`)}
      onPointerEnter={warm}
      onPointerDown={(e) => {
        armPoster(e);
        warm();
      }}
      onFocus={warm}
      aria-label={`${song.title}. ${song.version.label}. ${song.artist}`}
      style={tone(song, dark)}
    >
      <Cover song={song} className="lib-hero-cover" poster={continued} sizes="(min-width: 800px) 380px, 92vw" />
      <span className="lib-hero-copy">
        <span className="lib-hero-title">{song.title}</span>
        <span className="lib-hero-version">{song.version.label}</span>
        <span className="lib-hero-artist">{song.artist}</span>
        <span className="lib-hero-langs">{langsOf(song)}</span>
        <span className="lib-hero-go">{continued ? 'Продолжить' : 'Слушать'}</span>
      </span>
      {st && <span className={`chip chip--${st.tone} t-caption1`}>{st.text}</span>}
    </a>
  );
}

function ShelfRow({ song, continued, dark }: { song: Song; continued: boolean; dark: boolean }) {
  const { ref, warm } = useWarm(song.slug);
  const st = statusOf(song);
  return (
    <a
      ref={ref}
      className="lib-row"
      href={`/song/${song.slug}`}
      onClick={linkHandler(`/song/${song.slug}`)}
      onPointerEnter={warm}
      onPointerDown={(e) => {
        armPoster(e);
        warm();
      }}
      onFocus={warm}
      aria-label={`${song.title}. ${song.version.label}. ${song.artist}`}
      style={tone(song, dark)}
    >
      <Cover song={song} className="lib-row-cover" poster={continued} sizes="96px" />
      <span className="lib-row-copy">
        <span className="lib-row-lead">{song.title}</span>
        <span className="lib-row-version">{song.version.label}</span>
        <span className="lib-row-artist">{song.artist}</span>
      </span>
      {st && <span className={`chip chip--${st.tone} t-caption1`}>{st.text}</span>}
    </a>
  );
}
