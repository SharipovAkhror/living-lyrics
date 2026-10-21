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
/** Sibling cards leave over about 320 ms, so a 100 ms sheet catches the fade. */
const EXIT: { stiffness: number; damping: number; mass: number } = { stiffness: 170, damping: 22, mass: 1 };

interface RiseGroup {
  sel: string;
  /** Flight progress (0…1) that must pass before this group may enter. */
  gate: number;
  dist: number;
}

const RISES: RiseGroup[] = [
  // The destination title stays out until the cover has left the centre.
  // Two titles in the same place was the double exposure on the contact sheet.
  { sel: '.topbar-title', gate: 0.85, dist: 12 },
  { sel: '.fb', gate: 0.85, dist: 14 },
  { sel: '.ist-chip', gate: 0.85, dist: 10 },
  // The floor waits until the cover is past the middle, then rises with it.
  { sel: '.player', gate: 0.45, dist: 84 },
];

interface ExitNode {
  el: HTMLElement;
  delay: number;
  dist: number;
}

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

/** 0 at the card, 1 at the header. 1 when nothing is in the air. */
export function flightProgress(): number {
  return node ? state.x : 1;
}

/**
 * Keep a copy of a library block after the route changes.
 * A CSS fade on the live tree is one frame: the page unmounts, and the
 * contact sheet fast-forwards that transition to the end. The copy is
 * opacity and translate only, on the same spring as the flight.
 */
function pinExit(source: HTMLElement, delay: number, dist: number): ExitNode | null {
  const rect = source.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const el = source.cloneNode(true) as HTMLElement;
  el.classList.add('lib-exit');
  el.setAttribute('aria-hidden', 'true');
  // A filtered clone of the shelf is a long frame. Strip it before the first paint.
  const quiet = (node: HTMLElement) => {
    node.style.backdropFilter = 'none';
    node.style.setProperty('-webkit-backdrop-filter', 'none');
    node.style.animation = 'none';
    node.style.transition = 'none';
  };
  quiet(el);
  el.querySelectorAll<HTMLElement>('*').forEach(quiet);
  el.style.position = 'fixed';
  el.style.left = `${rect.left.toFixed(2)}px`;
  el.style.top = `${rect.top.toFixed(2)}px`;
  el.style.width = `${rect.width.toFixed(2)}px`;
  el.style.height = `${rect.height.toFixed(2)}px`;
  el.style.margin = '0';
  el.style.zIndex = '40';
  el.style.pointerEvents = 'none';
  el.style.transition = 'none';
  el.style.opacity = '1';
  el.style.transform = 'translate3d(0, 0, 0)';
  document.body.append(el);
  return { el, delay, dist };
}

function runExit(nodes: ExitNode[]) {
  if (!nodes.length) return;
  const springs: SpringState[] = nodes.map(() => ({ x: 0, v: 0 }));
  let last = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
    last = now;
    const elapsed = (now - start) / 1000;
    let alive = false;
    nodes.forEach((item, i) => {
      if (elapsed < item.delay) {
        alive = true;
        return;
      }
      springs[i] = stepSpring(springs[i], 1, dt, EXIT);
      const t = Math.max(0, Math.min(1, springs[i].x));
      item.el.style.opacity = (1 - t).toFixed(3);
      if (item.dist) item.el.style.transform = `translate3d(0, ${(item.dist * t).toFixed(2)}px, 0)`;
      if (t < 0.985 || Math.abs(springs[i].v) > 0.04) alive = true;
    });
    if (!alive || elapsed > 1.5) {
      nodes.forEach((item) => item.el.remove());
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Header, shelf and the chosen title leave on their own springs. The cover is the flyer. */
function armExit(library: HTMLElement, chosen: HTMLElement) {
  const nodes: ExitNode[] = [];
  const head = library.querySelector<HTMLElement>('.lib-head');
  const shelf = library.querySelector<HTMLElement>('.lib-shelf');
  const copy = chosen.querySelector<HTMLElement>('.lib-hero-copy, .lib-row-copy');
  if (head) {
    const pinned = pinExit(head, 0, 8);
    if (pinned) nodes.push(pinned);
  }
  if (shelf) {
    const pinned = pinExit(shelf, 0.09, 8);
    if (pinned) nodes.push(pinned);
  }
  if (copy) {
    const pinned = pinExit(copy, 0, 0);
    if (pinned) nodes.push(pinned);
  }
  runExit(nodes);
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
  const library = card.closest('.library');
  // The live page unmounts on the next frame. Copies keep the exit on screen.
  if (library instanceof HTMLElement && !motionBlocked()) armExit(library, card);
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
    // The scene writes opacity on the lyric blocks every frame. A custom
    // property with !important is the one those writes cannot overwrite.
    if (sel === '.fb' || sel === '.ist-chip') {
      root.style.setProperty('--title-in', t.toFixed(3));
      return;
    }
    const nodes = root.querySelectorAll<HTMLElement>(sel);
    nodes.forEach((el) => {
      touched.add(el);
      const y = (1 - t) * dist;
      el.style.transition = 'none';
      el.style.opacity = t.toFixed(3);
      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    });
  };
  const clear = () => {
    root.style.removeProperty('--title-in');
    touched.forEach((el) => {
      el.style.opacity = '';
      el.style.transform = '';
      el.style.transition = '';
    });
  };
  // Before the first paint. A later frame would flash the destination title under the cover.
  RISES.forEach((group) => paint(group.sel, group.dist, 0));
  const tick = (now: number) => {
    if (!alive) return;
    const dt = lastT ? Math.min(0.032, (now - lastT) / 1000) : 0.016;
    lastT = now;
    const elapsed = (now - start) / 1000;
    const progress = flightProgress();
    let quiet = true;
    RISES.forEach((group, i) => {
      if (progress < group.gate) {
        paint(group.sel, group.dist, 0);
        quiet = false;
        return;
      }
      springs[i] = stepSpring(springs[i], 1, dt, RISE);
      const t = Math.max(0, Math.min(1, springs[i].x));
      paint(group.sel, group.dist, t);
      if (Math.abs(springs[i].x - 1) > 0.01 || Math.abs(springs[i].v) > 0.05) quiet = false;
    });
    if (quiet && elapsed > 0.2 && progress >= 0.98) {
      clear();
      done();
      return;
    }
    if (elapsed > 2.2) {
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
