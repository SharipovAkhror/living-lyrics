/**
 * Library → song. Only the artwork is shared.
 * The card's words fade and the card settles to 0.97 before the route changes.
 * The cover then flies, as one transformed image, onto the header.
 * There is no plate: a scaled, clipped layer the size of the stage paints black in WebKit.
 */
import { FLIGHT_SPRING, stepSpring } from '@/ui/spring';

export interface MorphBox {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

export interface MorphFrom {
  card: MorphBox;
  cover: MorphBox;
  src: string;
}

let held: MorphFrom | null = null;

function boxOf(el: HTMLElement, radius: number): MorphBox {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height, radius };
}

export function motionBlocked(): boolean {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return document.documentElement.dataset.motion === 'off';
}

/** Remember the cover and fade the card. The route change waits for that fade. */
export function armMorph(card: HTMLElement): void {
  const cover = card.querySelector<HTMLElement>('[data-poster]');
  if (!cover) {
    held = null;
    return;
  }
  const img = cover instanceof HTMLImageElement ? cover.currentSrc || cover.src : '';
  const cardRadius = parseFloat(getComputedStyle(card).borderRadius) || 28;
  const coverRadius = parseFloat(getComputedStyle(cover).borderRadius) || 20;
  held = { card: boxOf(card, cardRadius), cover: boxOf(cover, coverRadius), src: img };
  if (motionBlocked()) return;
  const root = card.closest('.library');
  root?.classList.add('is-leaving');
  card.classList.add('is-chosen');
}

export function takeMorph(): MorphFrom | null {
  const next = held;
  held = null;
  return next;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Fly the cover onto `dest`. Resolves when the spring has settled, or when the
 * header never appears. The page under the image stays painted the whole time.
 */
export function runMorph(
  from: MorphFrom,
  dest: () => MorphBox | null,
  onArrive: () => void,
  alive?: { current: boolean },
): Promise<void> {
  const reduce = motionBlocked();
  if (reduce || !from.src) {
    onArrive();
    return Promise.resolve();
  }

  const cover = document.createElement('img');
  cover.className = 'morph-cover';
  cover.alt = '';
  cover.src = from.src;
  document.body.append(cover);

  // Width and a translation only. A scaled layer with a radius paints black in WebKit.
  const place = (fromBox: MorphBox, toBox: MorphBox, t: number) => {
    const left = lerp(fromBox.left, toBox.left, t);
    const top = lerp(fromBox.top, toBox.top, t);
    const w = Math.max(1, lerp(fromBox.width, toBox.width, t));
    const h = Math.max(1, lerp(fromBox.height, toBox.height, t));
    const radius = lerp(fromBox.radius, toBox.radius, t);
    cover.style.width = `${w.toFixed(2)}px`;
    cover.style.height = `${h.toFixed(2)}px`;
    cover.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0)`;
    cover.style.borderRadius = `${radius.toFixed(2)}px`;
  };

  place(from.cover, from.cover, 0);

  return new Promise((resolve) => {
    let state = { x: 0, v: 0 };
    let last = performance.now();
    let missed = 0;
    let arrived = false;
    const finish = () => {
      if (!arrived) {
        arrived = true;
        onArrive();
      }
      cover.remove();
      resolve();
    };
    const tick = (now: number) => {
      if (alive && !alive.current) {
        cover.remove();
        resolve();
        return;
      }
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      state = stepSpring(state, 1, dt, FLIGHT_SPRING);
      const t = Math.max(0, Math.min(1.04, state.x));
      const to = dest();
      if (!to) {
        missed += dt;
        if (missed > 0.18) finish();
        else requestAnimationFrame(tick);
        return;
      }
      missed = 0;
      place(from.cover, to, t);
      if (!arrived && t >= 0.92) {
        arrived = true;
        onArrive();
      }
      if (Math.abs(state.x - 1) < 0.004 && Math.abs(state.v) < 0.02) {
        finish();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
