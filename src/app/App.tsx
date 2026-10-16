import { lazy, Suspense } from 'react';
import { useRoute } from './router';
import { useSettings } from './settings';
import { useAppliedTheme } from './theme';
import { LibraryPage } from '@/pages/LibraryPage';
import { SongPage } from '@/pages/song/SongPage';

const MethodPage = lazy(() => import('@/pages/MethodPage').then((m) => ({ default: m.MethodPage })));
const InstrumentsPage = lazy(() => import('@/pages/InstrumentsPage'));

export function App() {
  const route = useRoute();
  const settings = useSettings();
  const dark = useAppliedTheme(settings.theme);

  switch (route.name) {
    case 'library':
      return <LibraryPage />;
    case 'song':
      return <SongPage key={route.slug} slug={route.slug} dark={dark} />;
    case 'instruments':
      return (
        <Suspense fallback={null}>
          <InstrumentsPage />
        </Suspense>
      );
    case 'method':
      return (
        <Suspense fallback={null}>
          <MethodPage doc={route.doc} />
        </Suspense>
      );
    default:
      return (
        <div className="empty">
          <p className="t-title3">Страница не найдена</p>
          <a className="btn btn-capsule btn-tinted" href="/">
            К списку песен
          </a>
        </div>
      );
  }
}
