import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useRoute } from './router';
import { effectiveMotion, useSettings } from './settings';
import { useAppliedTheme } from './theme';
import { GlassFilter } from '@/ui/glass/GlassFilter';
import { mountGlassLight } from '@/ui/glass/light';
import './fontCatalog';
import { getSong } from '@/data/library';
import { LibraryPage } from '@/pages/LibraryPage';
import { SongPage } from '@/pages/song/SongPage';

const MethodPage = lazy(() => import('@/pages/MethodPage').then((m) => ({ default: m.MethodPage })));
const InstrumentsPage = lazy(() => import('@/pages/InstrumentsPage'));

/** A quiet page while a lazy route's script arrives. The paper is already the app background. */
function RouteFallback({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="t-body secondary">{detail}</p>
    </div>
  );
}

/**
 * The song route. The sky of the song being left fades out over the new one,
 * so the switch is not a cut to bare paper. Reduced motion swaps at once;
 * the new sky is still in the first paint, so there is no empty frame.
 */
function SongRoute({ slug, dark }: { slug: string; dark: boolean }) {
  const motion = effectiveMotion(useSettings());
  const [current, setCurrent] = useState(slug);
  const [leaving, setLeaving] = useState<string[] | null>(null);
  if (slug !== current) {
    const prev = getSong(current);
    setCurrent(slug);
    setLeaving(motion === 'off' || !prev ? null : prev.palette.field);
  }
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(null), 420);
    return () => window.clearTimeout(id);
  }, [leaving, slug]);

  return <SongPage key={slug} slug={slug} dark={dark} leaving={leaving} />;
}

export function App() {
  const route = useRoute();
  const settings = useSettings();
  const dark = useAppliedTheme(settings.theme);

  useEffect(() => {
    document.documentElement.dataset.motion = effectiveMotion(settings);
  }, [settings]);

  useEffect(() => {
    mountGlassLight();
  }, []);

  let page: ReactNode;
  switch (route.name) {
    case 'library':
      page = <LibraryPage />;
      break;
    case 'song':
      page = <SongRoute slug={route.slug} dark={dark} />;
      break;
    case 'instruments':
      page = (
        <Suspense fallback={<RouteFallback title="Инструменты" detail="Открываем каталог" />}>
          <InstrumentsPage />
        </Suspense>
      );
      break;
    case 'method':
      page = (
        <Suspense fallback={<RouteFallback title="Методология" detail="Открываем раздел" />}>
          <MethodPage doc={route.doc} />
        </Suspense>
      );
      break;
    default:
      page = (
        <div className="empty">
          <p className="empty-title">Страница не найдена</p>
          <p className="t-body secondary">Такого адреса на сайте нет.</p>
          <a className="btn btn-capsule btn-tinted" href="/">
            К списку песен
          </a>
        </div>
      );
  }

  return (
    <>
      <GlassFilter />
      {page}
    </>
  );
}
