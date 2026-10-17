import { useMemo, useState } from 'react';
import { songs, LANG_NAMES, formatTime } from '@/data/library';
import type { Song } from '@/data/schema';
import { linkHandler } from '@/app/router';
import { useSettings } from '@/app/settings';
import { useAppliedTheme } from '@/app/theme';
import { Icon } from '@/icons/Icon';
import { Field } from '@/scene/Field';

/** A stable second for a song's still sky, so the library does not animate three fields at once. */
function stillT(slug: string) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 16777619);
  return (h >>> 0) % 180;
}

function originalScript(title: string | undefined) {
  return !!title && /[\u0600-\u06FF]/.test(title);
}

function statusOf(song: Song) {
  if (song.audio.status === 'missing') return { text: 'Без аудио', tone: 'muted' as const };
  if (song.timing.status === 'draft') return { text: 'Черновые тайм-коды', tone: 'warn' as const };
  if (song.timing.status === 'aligned') return { text: 'Выровнено автоматически', tone: 'muted' as const };
  return null;
}

export function LibraryPage() {
  const dark = useAppliedTheme(useSettings().theme);
  const [q, setQ] = useState('');
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
        {list.map((song) => {
          const st = statusOf(song);
          const origRtl = originalScript(song.titleOriginal);
          return (
            <li key={song.slug}>
              <a className="lib-band" href={`/song/${song.slug}`} onClick={linkHandler(`/song/${song.slug}`)}>
                <Field colors={song.palette.field} dark={dark} t={stillT(song.slug)} still />
                <span className="lib-band-copy">
                  <span className="lib-band-title">{song.title}</span>
                  {song.titleOriginal ? (
                    <span className={`lib-band-orig${origRtl ? ' f-mushaf' : ''}`} dir={origRtl ? 'rtl' : 'ltr'}>
                      {song.titleOriginal}
                    </span>
                  ) : null}
                  <span className="lib-band-meta">
                    {song.artist}
                    {song.release?.year ? ` · ${song.release.year}` : ''} · {song.languages.map((l) => LANG_NAMES[l] ?? l).join(', ')} · {formatTime(song.duration)}
                  </span>
                  {st && <span className={`chip chip--${st.tone} t-caption1`}>{st.text}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <p className="lib-empty t-body secondary">Ничего не найдено.</p>}
      <footer className="lib-foot t-footnote tertiary">
        Тексты, переводы и пояснения — {songs.length} {plural(songs.length, 'песня', 'песни', 'песен')}. Как добавить новую — в разделе «Методология».
      </footer>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
