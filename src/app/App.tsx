import { lazy, Suspense, type ReactNode } from 'react';
import { useRoute } from './router';
import { useSettings } from './settings';
import { useAppliedTheme } from './theme';
import './fontCatalog';
import { LibraryPage } from '@/pages/LibraryPage';
import { SongPage } from '@/pages/song/SongPage';

const MethodPage = lazy(() => import('@/pages/MethodPage').then((m) => ({ default: m.MethodPage })));
const InstrumentsPage = lazy(() => import('@/pages/InstrumentsPage'));

export function App() {
  const route = useRoute();
  const settings = useSettings();
  const dark = useAppliedTheme(settings.theme);

  let page: ReactNode;
  switch (route.name) {
    case 'library':
      page = <LibraryPage />;
      break;
    case 'song':
      page = <SongPage key={route.slug} slug={route.slug} dark={dark} />;
      break;
    case 'instruments':
      page = (
        <Suspense fallback={null}>
          <InstrumentsPage />
        </Suspense>
      );
      break;
    case 'method':
      page = (
        <Suspense fallback={null}>
          <MethodPage doc={route.doc} />
        </Suspense>
      );
      break;
    default:
      page = (
        <div className="empty">
          <p className="t-title3">Страница не найдена</p>
          <a className="btn btn-capsule btn-tinted" href="/">
            К списку песен
          </a>
        </div>
      );
  }

  return page;
}
