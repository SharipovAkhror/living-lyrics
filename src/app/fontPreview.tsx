/**
 * Font fitting. A query (?fonts=a|b|c|off) lays a candidate set over the usual
 * tokens without changing them. The choice is remembered until it is turned off.
 * Candidate files come from the Google Fonts CSS API and only while a set that
 * needs them is on, so the ordinary bundle stays as it is.
 */
import { useSyncExternalStore } from 'react';
import '@/styles/font-preview.css';

export type FontSetId = 'a' | 'b' | 'c';

const KEY = 'living-lyrics.font-preview';
const LINK_ID = 'font-preview-css';

interface SetDef {
  id: FontSetId;
  /** Google Fonts CSS API address. Null keeps the faces already in the bundle. */
  css: string | null;
}

export const FONT_SETS: Record<FontSetId, SetDef> = {
  /** Today's pairing: Nastaliq, Cormorant Garamond, the system face (Inter where SF Pro is absent). */
  a: { id: 'a', css: null },
  /** Book naskh and one serif family for the original and the translation. */
  b: {
    id: 'b',
    css: 'https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900&display=swap',
  },
  /** Clear naskh, a second old-style serif, and a reading serif for the translation. */
  c: {
    id: 'c',
    css: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..800;1,400..800&family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&family=Scheherazade+New:wght@400&display=swap',
  },
};

let current: FontSetId | null = null;
const listeners = new Set<() => void>();

function isSet(v: string | null): v is FontSetId {
  return v === 'a' || v === 'b' || v === 'c';
}

function remember(id: FontSetId | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the choice still lives in memory */
  }
}

function remembered(): FontSetId | null {
  try {
    const s = localStorage.getItem(KEY);
    return isSet(s) ? s : null;
  } catch {
    return null;
  }
}

/** What `?fonts=` asks for. `off` clears a remembered set. Anything else is ignored. */
export function fontSetFromSearch(search: string): FontSetId | 'off' | null {
  const q = new URLSearchParams(search).get('fonts');
  if (q === 'off') return 'off';
  if (isSet(q)) return q;
  return null;
}

function resolve(search: string): FontSetId | null {
  const q = fontSetFromSearch(search);
  if (q === 'off') {
    remember(null);
    return null;
  }
  if (q) {
    remember(q);
    return q;
  }
  return remembered();
}

function ensureLink(href: string | null) {
  const head = document.head;
  const drop = (id: string) => document.getElementById(id)?.remove();
  if (!href) {
    drop(LINK_ID);
    drop('font-preview-pre-api');
    drop('font-preview-pre-static');
    return;
  }
  if (!document.getElementById('font-preview-pre-api')) {
    const api = document.createElement('link');
    api.id = 'font-preview-pre-api';
    api.rel = 'preconnect';
    api.href = 'https://fonts.googleapis.com';
    head.appendChild(api);
  }
  if (!document.getElementById('font-preview-pre-static')) {
    const files = document.createElement('link');
    files.id = 'font-preview-pre-static';
    files.rel = 'preconnect';
    files.href = 'https://fonts.gstatic.com';
    files.crossOrigin = 'anonymous';
    head.appendChild(files);
  }
  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

/** The stage measures itself on resize. Nudge it after a new face arrives. */
function nudgeMeasure() {
  const el = document.querySelector('.scene-stage');
  if (!(el instanceof HTMLElement)) return;
  const prev = el.style.width;
  el.style.width = 'calc(100% - 0.5px)';
  requestAnimationFrame(() => {
    el.style.width = prev;
  });
}

function apply(id: FontSetId | null) {
  const root = document.documentElement;
  if (id) root.dataset.fontPreview = id;
  else delete root.dataset.fontPreview;
  ensureLink(id ? FONT_SETS[id].css : null);
  if (document.fonts) void document.fonts.ready.then(nudgeMeasure);
}

function publish(id: FontSetId | null) {
  current = id;
  apply(id);
  listeners.forEach((fn) => fn());
}

export function getFontPreview() {
  return current;
}

export function setFontPreview(id: FontSetId | 'off') {
  const url = new URL(location.href);
  if (id === 'off') {
    url.searchParams.set('fonts', 'off');
    remember(null);
    publish(null);
  } else {
    url.searchParams.set('fonts', id);
    remember(id);
    publish(id);
  }
  const next = url.pathname + url.search + url.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof document !== 'undefined') {
  publish(resolve(location.search));
  window.addEventListener('popstate', () => publish(resolve(location.search)));
  document.fonts?.addEventListener('loadingdone', nudgeMeasure);
}

export function useFontPreview(): FontSetId | null {
  return useSyncExternalStore(subscribe, getFontPreview, getFontPreview);
}

/** Small plaque. Rendered only while a set is on. */
export function FontFitChip({ song }: { song: boolean }) {
  const id = useFontPreview();
  if (!id) return null;
  const letter = id.toUpperCase();
  return (
    <div className={`font-fit glass${song ? ' font-fit--song' : ''}`} role="region" aria-label="Примерка шрифтов">
      <p className="font-fit-label">примерка шрифтов: набор {letter}</p>
      <div className="font-fit-switch" role="radiogroup" aria-label="Набор шрифтов">
        {(['a', 'b', 'c'] as const).map((set) => (
          <button
            key={set}
            type="button"
            role="radio"
            aria-checked={set === id}
            className="font-fit-btn"
            onClick={() => setFontPreview(set)}
          >
            {set.toUpperCase()}
          </button>
        ))}
        <button type="button" className="font-fit-btn font-fit-off" onClick={() => setFontPreview('off')}>
          выкл
        </button>
      </div>
    </div>
  );
}
