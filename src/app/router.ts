import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'song'; slug: string }
  | { name: 'method'; doc?: string }
  | { name: 'notfound' };

export function parse(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'library' };
  let m = p.match(/^\/song\/([a-z0-9-]+)$/);
  if (m) return { name: 'song', slug: m[1] };
  // The timing editor was removed: old links land on the song.
  m = p.match(/^\/song\/([a-z0-9-]+)\/edit$/);
  if (m) return { name: 'song', slug: m[1] };
  m = p.match(/^\/method(?:\/([a-z0-9-]+))?$/);
  if (m) return { name: 'method', doc: m[1] };
  return { name: 'notfound' };
}

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.scrollTo(0, 0);
  listeners.forEach((l) => l());
}

export function useRoute(): Route {
  const path = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => location.pathname,
  );
  return parse(path);
}

/** Click handler for in-app links that keeps modifier-clicks working. */
export function linkHandler(to: string) {
  return (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
}
