import type { FontPersian } from '@/app/settings';
import { RichText } from '@/components/RichText';
import { showHarakatText } from '@/data/harakat';
import { LANG_NAMES } from '@/data/library';
import type { Lyrics, Part, Song } from '@/data/schema';
import { fontClass } from '@/scene/fonts';
import { partStart } from './parts';

const ARABIC = /[\u0600-\u06FF]/;

function face(text: string, lang: string | undefined, fontPersian: FontPersian) {
  if (!ARABIC.test(text)) return 'f-serif';
  return fontClass({ script: 'Arab', lang: lang === 'fa' ? 'fa' : 'ar' }, { fontPersian });
}

function ScriptTitle({
  text,
  lang,
  fontPersian,
  showHarakat,
}: {
  text: string;
  lang?: string;
  fontPersian: FontPersian;
  showHarakat: boolean;
}) {
  const arabic = ARABIC.test(text);
  return (
    <span
      className={`part-original ${face(text, lang, fontPersian)}`}
      dir={arabic ? 'rtl' : undefined}
      lang={arabic ? (lang === 'fa' ? 'fa' : 'ar') : lang}
    >
      {showHarakatText(text, showHarakat)}
    </span>
  );
}

function Book({
  part,
  fontPersian,
  showHarakat,
}: {
  part: Part;
  fontPersian: FontPersian;
  showHarakat: boolean;
}) {
  const work = part.work;
  const hasBook = Boolean(work?.original || work?.ru || part.ref);
  const body = (
    <>
      <span className="part-kicker">Книга</span>
      {hasBook ? (
        <>
          {work?.original && (
            <ScriptTitle text={work.original} lang={work.lang ?? part.lang} fontPersian={fontPersian} showHarakat={showHarakat} />
          )}
          {work?.ru && <span className="part-book-ru">{work.ru}</span>}
          {part.ref && <span className="part-ref">{part.ref}</span>}
        </>
      ) : (
        <span className="part-missing">не установлено</span>
      )}
    </>
  );
  if (!part.url) return <div className="part-book">{body}</div>;
  return (
    <a className="part-book" href={part.url} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  );
}

/** Composition cards, in the order the parts are first heard. A tap seeks to that start. */
export function PartsSection({
  song,
  lyrics,
  showHarakat,
  fontPersian,
  onSeek,
}: {
  song: Song;
  lyrics: Lyrics | null;
  showHarakat: boolean;
  fontPersian: FontPersian;
  onSeek: (t: number) => void;
}) {
  if (!song.parts?.length) return null;
  return (
    <section className="group parts-group">
      <h3 className="group-header t-footnote">Состав</h3>
      <div className="parts">
        {song.parts.map((part) => {
          const start = partStart(part, lyrics);
          const seek = () => {
            if (start != null) onSeek(start);
          };
          const author = part.author
            ? part.author.years
              ? `${part.author.name}, ${part.author.years}`
              : part.author.name
            : 'не установлено';
          return (
            <article className="part" key={part.id}>
              <button type="button" className="part-jump" onClick={seek} disabled={start == null}>
                <span className="part-title">{part.title}</span>
                <span className="part-lang">{LANG_NAMES[part.lang] ?? part.lang}</span>
                <span className="part-kicker">Автор</span>
                <span className="part-author">
                  {author}
                  {part.author?.original && (
                    <ScriptTitle
                      text={part.author.original}
                      lang={part.lang}
                      fontPersian={fontPersian}
                      showHarakat={showHarakat}
                    />
                  )}
                </span>
              </button>
              <Book part={part} fontPersian={fontPersian} showHarakat={showHarakat} />
              <div
                className="part-note-btn"
                role="button"
                tabIndex={start == null ? -1 : 0}
                aria-disabled={start == null || undefined}
                onClick={seek}
                onKeyDown={(e) => {
                  if (start == null || (e.key !== 'Enter' && e.key !== ' ')) return;
                  e.preventDefault();
                  seek();
                }}
              >
                <RichText text={part.note} showHarakat={showHarakat} className="part-note" />
              </div>
            </article>
          );
        })}
      </div>
      <p className="group-footer t-footnote">Нажатие переносит к началу части. Название книги открывает источник.</p>
    </section>
  );
}
