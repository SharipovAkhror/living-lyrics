/**
 * Library → song. One artwork travels the whole path.
 * The flyer is born on the click, before the route changes, and the card's
 * own image is hidden, so the eye never swaps objects. Width and a translation
 * only: a scaled, clipped layer the size of the stage paints black in WebKit.
 * The loop lives here, not in an effect, so a strict remount cannot eat it.
 */
import { FLIGHT_SPRING, stepSpring, type SpringState } from '@/ui/spring';

export interface MorphBox {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

const RISE: { stiffness: number; damping: number; mass: number } = { stiffness: 340, damping: 28, mass: 1 };

interface RiseGroup {
  sel: string;
  delay: number;
  dist: number;
}

const RISES: RiseGroup[] = [
  { sel: '.topbar-title', delay: 0, dist: 12 },
  { sel: '.fb', delay: 0.04, dist: 16 },
  { sel: '.ist-chip', delay: 0.08, dist: 12 },
  { sel: '.player', delay: 0.12, dist: 24 },
];

let node: HTMLImageElement | null = null;
let fromBox: MorphBox | null = null;
let destGet: (() => MorphBox | null) | null = null;
let arrive: (() => void) | null = null;
let arrived = false;
let followers = 0;
let raf = 0;
let running = false;
let state: SpringState = { x: 0, v: 0 };
let last = 0;
let started = 0;

export function motionBlocked(): boolean {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return document.documentElement.dataset.motion === 'off';
}

export function hasFlight(): boolean {
  return !!node;
}

function boxOf(el: HTMLElement): MorphBox {
  const r = el.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(el).borderRadius) || 20;
  return { left: r.left, top: r.top, width: r.width, height: r.height, radius };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function place(el: HTMLImageElement, from: MorphBox, to: MorphBox, t: number) {
  const left = lerp(from.left, to.left, t);
  const top = lerp(from.top, to.top, t);
  const w = Math.max(1, lerp(from.width, to.width, t));
  const h = Math.max(1, lerp(from.height, to.height, t));
  const radius = lerp(from.radius, to.radius, t);
  el.style.width = `${w.toFixed(2)}px`;
  el.style.height = `${h.toFixed(2)}px`;
  el.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0)`;
  el.style.borderRadius = `${radius.toFixed(2)}px`;
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  running = false;
}

function finish() {
  stopLoop();
  if (!arrived) {
    arrived = true;
    arrive?.();
  }
  node?.remove();
  node = null;
  fromBox = null;
  destGet = null;
  arrive = null;
}

function frame(now: number) {
  if (!node || !fromBox) {
    stopLoop();
    return;
  }
  const dt = last ? Math.min(0.032, (now - last) / 1000) : 0.016;
  last = now;
  const to = destGet?.() ?? null;
  if (!to) {
    place(node, fromBox, fromBox, 0);
    if (now - started > 1400) finish();
    else raf = requestAnimationFrame(frame);
    return;
  }
  state = stepSpring(state, 1, dt, FLIGHT_SPRING);
  const t = Math.max(0, Math.min(1, state.x));
  place(node, fromBox, to, t);
  if (!arrived && state.x >= 0.98) {
    arrived = true;
    arrive?.();
  }
  if (Math.abs(state.x - 1) < 0.004 && Math.abs(state.v) < 0.02) {
    finish();
    return;
  }
  raf = requestAnimationFrame(frame);
}

function ensureLoop() {
  if (running || !node) return;
  running = true;
  last = 0;
  raf = requestAnimationFrame(frame);
}

/** Hide the card image and put the one flyer on the body, at the card's rect. */
export function armMorph(card: HTMLElement): void {
  const cover = card.querySelector<HTMLElement>('[data-poster]');
  if (node) {
    node.remove();
    node = null;
  }
  fromBox = null;
  arrived = false;
  state = { x: 0, v: 0 };
  if (!cover) return;
  const src = cover instanceof HTMLImageElement ? cover.currentSrc || cover.src : '';
  const box = boxOf(cover);
  card.closest('.library')?.classList.add('is-leaving');
  card.classList.add('is-chosen');
  if (motionBlocked() || !src || box.width < 2) return;
  cover.style.visibility = 'hidden';
  const el = document.createElement('img');
  el.className = 'morph-cover';
  el.alt = '';
  el.decoding = 'sync';
  el.src = src;
  el.style.position = 'fixed';
  el.style.left = '0';
  el.style.top = '0';
  el.style.margin = '0';
  el.style.zIndex = '80';
  el.style.pointerEvents = 'none';
  el.style.objectFit = 'cover';
  document.body.append(el);
  place(el, box, box, 0);
  node = el;
  fromBox = box;
  started = performance.now();
  ensureLoop();
}

/**
 * The song page tells the flyer where the header art is.
 * Cleanup drops the subscription. A strict remount re-subscribes before the
 * microtask, so the flyer is not thrown away between the two.
 */
export function followHeader(dest: () => MorphBox | null, onArrive: () => void): () => void {
  followers += 1;
  destGet = dest;
  arrive = onArrive;
  arrived = false;
  ensureLoop();
  let dropped = false;
  return () => {
    if (dropped) return;
    dropped = true;
    followers -= 1;
    if (destGet === dest) destGet = null;
    if (arrive === onArrive) arrive = null;
    queueMicrotask(() => {
      if (followers === 0 && node && !destGet) finish();
    });
  };
}

/** Stagger the song chrome. Inline styles, so a contact sheet cannot skip them. */
export function playRise(root: HTMLElement, done: () => void): () => void {
  if (motionBlocked()) {
    done();
    return () => {};
  }
  const springs: SpringState[] = RISES.map(() => ({ x: 0, v: 0 }));
  const touched = new Set<HTMLElement>();
  let lastT = 0;
  let id = 0;
  let alive = true;
  const start = performance.now();
  const paint = (sel: string, dist: number, t: number) => {
    const nodes = root.querySelectorAll<HTMLElement>(sel);
    nodes.forEach((el) => {
      touched.add(el);
      const y = (1 - t) * dist;
      el.style.opacity = t.toFixed(3);
      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    });
  };
  const clear = () => {
    touched.forEach((el) => {
      el.style.opacity = '';
      el.style.transform = '';
    });
  };
  const tick = (now: number) => {
    if (!alive) return;
    const dt = lastT ? Math.min(0.032, (now - lastT) / 1000) : 0.016;
    lastT = now;
    const elapsed = (now - start) / 1000;
    let quiet = true;
    RISES.forEach((group, i) => {
      if (elapsed < group.delay) {
        paint(group.sel, group.dist, 0);
        quiet = false;
        return;
      }
      springs[i] = stepSpring(springs[i], 1, dt, RISE);
      const t = Math.max(0, Math.min(1, springs[i].x));
      paint(group.sel, group.dist, t);
      if (Math.abs(springs[i].x - 1) > 0.01 || Math.abs(springs[i].v) > 0.05) quiet = false;
    });
    if (quiet && elapsed > 0.2) {
      clear();
      done();
      return;
    }
    if (elapsed > 1.6) {
      clear();
      done();
      return;
    }
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => {
    alive = false;
    if (id) cancelAnimationFrame(id);
    clear();
  };
}
