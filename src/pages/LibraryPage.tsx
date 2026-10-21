import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { coverExt, coverUrl } from '@/data/covers';
import { songs, LANG_NAMES } from '@/data/library';
import type { Song } from '@/data/schema';
import { prefetchLyrics } from '@/app/prefetch';
import { linkHandler, navigate } from '@/app/router';
import { rememberedSong } from '@/app/continue';
import { useSettings } from '@/app/settings';
import { useAppliedTheme } from '@/app/theme';
import { Icon } from '@/ui/icons';
import { Glass, GlassLayers } from '@/ui/glass/Glass';
import { armMorph, motionBlocked } from '@/app/morph';
import { Field } from '@/scene/Field';
import { Status } from '@/components/Status';

function statusOf(song: Song) {
  if (song.audio.status === 'missing') return { text: 'Без аудио', tone: 'muted' as const };
  return null;
}

function langsOf(song: Song) {
  return song.languages.map((code) => LANG_NAMES[code] ?? code).join(' · ');
}

/** The flyer is born on the click. The route changes on the next frame, so one cover is already in the air. */
function openSong(event: MouseEvent<HTMLAnchorElement>, slug: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const to = `/song/${slug}`;
  if (motionBlocked()) {
    navigate(to);
    return;
  }
  armMorph(event.currentTarget);
  requestAnimationFrame(() => navigate(to));
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
  // A living sky under every frosted card repaints the phone each tick. The shelf keeps one frame.
  const stillSky = useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(max-width: 799px), (pointer: coarse)');
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(max-width: 799px), (pointer: coarse)').matches,
    () => true,
  );
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
      <Field colors={wash} dark={dark} clock={stillSky ? undefined : clock} still={stillSky} t={12} />
      <header className="lib-head">
        <div className="lib-titlebar">
          <h1 className="lib-title">Песни</h1>
          <nav className="lib-actions" aria-label="Разделы">
            <Glass as="a" variant="chip" className="lib-nav" href="/instruments" onClick={linkHandler('/instruments')} aria-label="Инструменты: галерея гравюр">
              <Icon name="square.grid.2x2" size={20} />
              <span className="lib-nav-label">Инструменты</span>
            </Glass>
            <Glass as="a" variant="chip" className="lib-nav" href="/method" onClick={linkHandler('/method')} aria-label="Методология">
              <Icon name="book.pages" size={20} />
              <span className="lib-nav-label">Методология</span>
            </Glass>
          </nav>
        </div>
        <Glass as="label" variant="chip" className="search">
          <Icon name="magnifyingglass" size={20} className="search-icon" />
          <input
            type="search"
            className="search-input"
            placeholder="Название, версия, поэт, язык"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Поиск"
          />
        </Glass>
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

function tone(song: Song, dark: boolean): CSSProperties {
  return {
    '--glow': song.palette.field[0],
    '--accent': dark ? song.palette.accentDark : song.palette.accent,
  } as CSSProperties;
}

function Cover({ song, className, sizes }: { song: Song; className: string; sizes: string }) {
  const ext = coverExt(song);
  return (
    <img
      data-poster=""
      className={className}
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
      className="lib-hero lg-host lg-host--card"
      href={`/song/${song.slug}`}
      onClick={(e) => openSong(e, song.slug)}
      onPointerEnter={warm}
      onPointerDown={() => warm()}
      onFocus={warm}
      aria-label={`${song.title}. ${song.version.label}. ${song.artist}`}
      style={tone(song, dark)}
    >
      <GlassLayers />
      <span className="lib-hero-bleed" aria-hidden="true">
        <img src={coverUrl(song.slug, 512, coverExt(song))} alt="" />
      </span>
      <Cover song={song} className="lib-hero-cover" sizes="(min-width: 800px) 380px, 92vw" />
      <span className="lib-hero-copy">
        <span className="lib-hero-title">
          {song.title}
        </span>
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
      className="lib-row lg-host lg-host--card"
      href={`/song/${song.slug}`}
      onClick={(e) => openSong(e, song.slug)}
      onPointerEnter={warm}
      onPointerDown={() => warm()}
      onFocus={warm}
      aria-label={`${song.title}. ${song.version.label}. ${song.artist}`}
      style={tone(song, dark)}
    >
      <GlassLayers />
      <Cover song={song} className="lib-row-cover" sizes="96px" />
      <span className="lib-row-copy">
        <span className="lib-row-lead">
          {song.title}
        </span>
        <span className="lib-row-version">{song.version.label}</span>
        <span className="lib-row-artist">{continued ? `Продолжить · ${song.artist}` : song.artist}</span>
      </span>
      {st && <span className={`chip chip--${st.tone} t-caption1`}>{st.text}</span>}
    </a>
  );
}
