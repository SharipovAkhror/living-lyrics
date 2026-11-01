/**
 * One light for every glass surface.
 *
 * Desktop (fine pointer, wide window): the specular angle follows the pointer,
 * coalesced to one animation frame, and the SVG displacement filter is allowed.
 * The filter definition itself never changes.
 *
 * Phone and reduced transparency: no pointer tracking, no displacement. A tap
 * may set the light once. The phone header and floor blur and saturate only.
 * Reduced transparency and the settings sheet stay opaque.
 */

type Mode = 'solid' | 'rim' | 'lens';

function mode(): Mode {
  if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return 'solid';
  const lens = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 800px)').matches;
  return lens ? 'lens' : 'rim';
}

let started = false;

export function mountGlassLight(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  const root = document.documentElement;

  const applyMode = () => {
    root.dataset.glass = mode();
  };
  applyMode();

  const queries = [
    window.matchMedia('(prefers-reduced-transparency: reduce)'),
    window.matchMedia('(hover: hover) and (pointer: fine)'),
    window.matchMedia('(min-width: 800px)'),
  ];
  for (const q of queries) q.addEventListener('change', applyMode);

  let frame = 0;
  let px = 0;
  let py = 0;
  const paint = () => {
    frame = 0;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const x = (px / w) * 100;
    const y = (py / h) * 100;
    root.style.setProperty('--lg-x', `${x.toFixed(2)}%`);
    root.style.setProperty('--lg-y', `${y.toFixed(2)}%`);
    const angle = (Math.atan2(py - h * 0.15, px - w * 0.2) * 180) / Math.PI + 180;
    root.style.setProperty('--lg-angle', `${angle.toFixed(1)}deg`);
  };
  const queue = (e: PointerEvent) => {
    px = e.clientX;
    py = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(paint);
  };

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (root.dataset.glass === 'solid') return;
      queue(e);
    },
    { passive: true },
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (root.dataset.glass !== 'lens') return;
      // A button-down move belongs to the scrubber. These variables restyle
      // the whole document, and nothing in the stylesheet reads them during a drag.
      if (e.buttons) return;
      queue(e);
    },
    { passive: true },
  );
}
