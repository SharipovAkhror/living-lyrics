/**
 * Library → song is one object.
 * The card's words fade in place, then a clipped plate and the cover
 * travel on transforms. The title does not cross-fade across the stage.
 */
import { stepSpring } from '@/ui/spring';

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
  wash: string;
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

/** Remember the card and fade its neighbours. Returns after the words have left. */
export function armMorph(card: HTMLElement): void {
  const cover = card.querySelector<HTMLElement>('[data-poster]');
  if (!cover) {
    held = null;
    return;
  }
  const img = cover instanceof HTMLImageElement ? cover.currentSrc || cover.src : '';
  const wash = getComputedStyle(card).getPropertyValue('--glow').trim() || '#3a2a22';
  const cardRadius = parseFloat(getComputedStyle(card).borderRadius) || 28;
  const coverRadius = parseFloat(getComputedStyle(cover).borderRadius) || 20;
  held = { card: boxOf(card, cardRadius), cover: boxOf(cover, coverRadius), src: img, wash };
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

export interface MorphDest {
  card: MorphBox;
  cover: MorphBox;
}

/**
 * Run the plate and the cover. `onArrive` fires once, when the plate is
 * most of the way across, so the header and the verse can enter after it.
 * Resolves when the spring has settled and the nodes are gone.
 */
export function runMorph(
  from: MorphFrom,
  dest: () => MorphDest | null,
  onArrive: () => void,
  alive?: { current: boolean },
): Promise<void> {
  const reduce = motionBlocked();
  const shell = document.createElement('div');
  shell.className = 'morph-shell';
  const cover = document.createElement('img');
  cover.className = 'morph-cover';
  cover.alt = '';
  cover.src = from.src;
  shell.style.background = `color-mix(in srgb, ${from.wash} 42%, #fffaf6)`;
  document.body.append(shell, cover);

  const place = (node: HTMLElement, fromBox: MorphBox, toBox: MorphBox, t: number) => {
    const left = lerp(fromBox.left, toBox.left, t);
    const top = lerp(fromBox.top, toBox.top, t);
    const w = Math.max(1, lerp(fromBox.width, toBox.width, t));
    const h = Math.max(1, lerp(fromBox.height, toBox.height, t));
    const sx = w / Math.max(1, fromBox.width);
    const sy = h / Math.max(1, fromBox.height);
    const radius = lerp(fromBox.radius, toBox.radius, t) / Math.max(sx, sy, 0.01);
    node.style.width = `${fromBox.width}px`;
    node.style.height = `${fromBox.height}px`;
    node.style.transformOrigin = '0 0';
    node.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    node.style.borderRadius = `${radius.toFixed(2)}px`;
  };

  // Park on the card before the first paint, so the plate does not flash at the origin.
  place(shell, from.card, from.card, 0);
  place(cover, from.cover, from.cover, 0);

  if (reduce) {
    shell.remove();
    cover.remove();
    onArrive();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let state = { x: 0, v: 0 };
    let last = performance.now();
    let arrived = false;
    let missed = 0;
    const finish = () => {
      shell.remove();
      cover.remove();
      resolve();
    };
    const tick = (now: number) => {
      if (alive && !alive.current) {
        finish();
        return;
      }
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      state = stepSpring(state, 1, dt);
      const t = Math.max(0, Math.min(1.025, state.x));
      const to = dest();
      if (!to) {
        missed += dt;
        if (missed > 0.45) finish();
        else requestAnimationFrame(tick);
        return;
      }
      missed = 0;
      place(shell, from.card, to.card, t);
      place(cover, from.cover, to.cover, t);
      shell.style.opacity = t < 0.84 ? '1' : Math.max(0, 1 - (t - 0.84) / 0.16).toFixed(3);
      if (!arrived && t >= 0.42) {
        arrived = true;
        onArrive();
      }
      if (Math.abs(state.x - 1) < 0.004 && Math.abs(state.v) < 0.02) {
        shell.remove();
        cover.remove();
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
