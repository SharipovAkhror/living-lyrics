import { useMemo, useState } from 'react';
import { songs, LANG_NAMES, formatTime } from '@/data/library';
import type { Song } from '@/data/schema';
import { linkHandler } from '@/app/router';
import { Icon } from '@/icons/Icon';
import { Cover } from '@/components/Cover';

function statusOf(song: Song) {
  if (song.audio.status === 'missing') return { text: 'Без аудио', tone: 'muted' as const };
  if (song.timing.status === 'draft') return { text: 'Черновые тайм-коды', tone: 'warn' as const };
  if (song.timing.status === 'aligned') return { text: 'Выровнено автоматически', tone: 'muted' as const };
  return null;
}

export function LibraryPage() {
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
            <a className="btn btn-circle glass" href="/instruments" onClick={linkHandler('/instruments')} aria-label="Инструменты: галерея гравюр">
              <Icon name="square.grid.2x2" size={20} />
            </a>
            <a className="btn btn-circle glass" href="/method" onClick={linkHandler('/method')} aria-label="Методология">
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

      <ul className="lib-grid">
        {list.map((song) => {
          const st = statusOf(song);
          return (
            <li key={song.slug}>
              <a className="card" href={`/song/${song.slug}`} onClick={linkHandler(`/song/${song.slug}`)}>
                <div className="card-cover">
                  <Cover song={song} />
                  <span className="card-play glass glass--clear" aria-hidden>
                    <Icon name="play" size={18} />
                  </span>
                </div>
                <div className="card-text">
                  <div className="card-title t-headline">{song.title}</div>
                  <div className="card-sub t-subhead secondary">
                    {song.artist}
                    {song.release?.year ? ` · ${song.release.year}` : ''}
                  </div>
                  <div className="card-meta t-footnote tertiary">
                    {song.languages.map((l) => LANG_NAMES[l] ?? l).join(', ')} · {formatTime(song.duration)}
                  </div>
                  {st && <span className={`chip chip--${st.tone} t-caption1`}>{st.text}</span>}
                </div>
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
