/** Renders the methodology (docs/methodology/*.md) inside the app, so it lives next to the songs it describes. */
import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import { linkHandler, navigate } from '@/app/router';
import { Icon } from '@/ui/icons';

const files = import.meta.glob('/docs/methodology/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Doc {
  slug: string;
  title: string;
  body: string;
}

const docs: Doc[] = Object.entries(files)
  .map(([path, body]) => {
    const file = path.split('/').at(-1)!.replace(/\.md$/, '');
    const slug = file === 'README' ? 'overview' : file.replace(/^\d+-/, '');
    const title = body.match(/^#\s+(.+)$/m)?.[1] ?? slug;
    return { slug, title, body, order: file === 'README' ? -1 : parseInt(file, 10) };
  })
  .sort((a, b) => a.order - b.order)
  .map(({ slug, title, body }) => ({ slug, title, body }));

export function MethodPage({ doc }: { doc?: string }) {
  // The commentary stage used to live at /method/sharh (file 07-sharh.md).
  const asked = doc === 'sharh' ? 'comment' : doc;
  const current = docs.find((d) => d.slug === asked) ?? docs[0];
  const body = useRef<HTMLElement>(null);
  const html = useMemo(() => (current ? (marked.parse(current.body, { async: false }) as string) : ''), [current]);

  useEffect(() => {
    if (doc === 'sharh') navigate('/method/comment', { replace: true });
  }, [doc]);

  // Links between methodology files ("05-alignment.md") open inside the app.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('href');
      if (!href) return;
      const m = href.match(/^(?:\.\/)?(?:\d+-)?([a-z0-9-]+)\.md(?:#.*)?$/i);
      if (m) {
        e.preventDefault();
        navigate(`/method/${m[1] === 'README' ? 'overview' : m[1]}`);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [html]);

  if (!current) return <p className="empty">Методология пока не написана.</p>;
  const idx = docs.indexOf(current);

  return (
    <div className="method">
      <header className="method-top">
        <a className="btn btn-circle btn-plain" href="/" onClick={linkHandler('/')} aria-label="К списку песен">
          <Icon name="chevron.left" size={22} />
        </a>
        <span className="t-headline">Методология</span>
        <span style={{ width: 44 }} />
      </header>
      <div className="method-layout">
        <nav className="method-nav" aria-label="Разделы методологии">
          <ol>
            {docs.map((d, i) => (
              <li key={d.slug}>
                <a
                  href={`/method/${d.slug}`}
                  onClick={linkHandler(`/method/${d.slug}`)}
                  className={d === current ? 'is-current' : undefined}
                  aria-current={d === current ? 'page' : undefined}
                >
                  <span className="method-num tabular">{i === 0 ? '·' : i}</span>
                  {d.title.replace(/^\d+\.\s*/, '')}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article ref={body} className="doc" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <nav className="method-pager">
        {idx > 0 && (
          <a className="pager-link glass" href={`/method/${docs[idx - 1].slug}`} onClick={linkHandler(`/method/${docs[idx - 1].slug}`)}>
            <span className="t-caption1 secondary">Назад</span>
            <span className="t-subhead">{docs[idx - 1].title.replace(/^\d+\.\s*/, '')}</span>
          </a>
        )}
        {idx < docs.length - 1 && (
          <a className="pager-link pager-link--next glass" href={`/method/${docs[idx + 1].slug}`} onClick={linkHandler(`/method/${docs[idx + 1].slug}`)}>
            <span className="t-caption1 secondary">Дальше</span>
            <span className="t-subhead">{docs[idx + 1].title.replace(/^\d+\.\s*/, '')}</span>
          </a>
        )}
      </nav>
    </div>
  );
}
