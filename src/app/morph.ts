/**
 * Library → song. One artwork travels the whole path.
 * The flyer is born on the click, before the route changes, and the card's
 * own image is hidden, so the eye never swaps objects. Width and a translation
 * only: a scaled, clipped layer the size of the stage paints black in WebKit.
 * The loop lives here, not in an effect, so a strict remount cannot eat it.
 */
import { noteFlightFrame } from '@/app/mutate';
import { stageFrame } from '@/scene/columns';
import { FLIGHT_SPRING, getMotionScale, stepSpring, type SpringState } from '@/ui/spring';

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
  // Last third of the flight. The stage used to stay empty until 0.85,
  // which was a dark frame on a 100 ms sheet.
  { sel: '.topbar-title', gate: 0.67, dist: 12 },
  { sel: '.fb', gate: 0.67, dist: 14 },
  { sel: '.ist-chip', gate: 0.67, dist: 10 },
  // The floor is not gated on flight progress. It waits ~80 ms of wall time
  // from the click, then rises. A progress gate opened between two samples
  // and the floor looked like it popped in.
  { sel: '.player', gate: 0, dist: 84 },
];

/** Wall time after the flyer is born before the floor may move. Not stretched. */
const FLOOR_DELAY = 0.08;

interface ExitNode {
  el: HTMLElement;
  delay: number;
  dist: number;
  /** The shelf: it lies where the floor arrives, so the floor waits for it. */
  under?: boolean;
}

/** Opacity of the library copy that lies under the arriving floor. 0 when gone. */
let underOpacity = 0;

let node: HTMLImageElement | null = null;
/** The card's own image. It stays drawn until the flyer has a decoded picture to show. */
let parked: HTMLElement | null = null;
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
/** Images inside the exit copies. The route waits for them, see exitDecoded. */
let copyImages: HTMLImageElement[] = [];

function pinExit(source: HTMLElement, delay: number, dist: number): ExitNode | null {
  const rect = source.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const el = source.cloneNode(true) as HTMLElement;
  el.classList.add('lib-exit');
  el.setAttribute('aria-hidden', 'true');
  // Filters and motion are killed by .lib-exit. Walking every node to set
  // inline styles was itself the long frame. The shelf covers keep their
  // pictures: a flat brown stand-in flashed on a 60 fps sheet.
  copyImages.push(...el.querySelectorAll('img'));
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
      if (item.under) underOpacity = t > 0.95 ? 0 : 1 - t;
      if (item.dist) item.el.style.transform = `translate3d(0, ${(item.dist * t).toFixed(2)}px, 0)`;
      if (t < 0.985 || Math.abs(springs[i].v) > 0.04) alive = true;
    });
    if (!alive || elapsed > 1.5) {
      underOpacity = 0;
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
    // No delay: the floor rises only once this copy is gone, so two transport rows never share a frame.
    const pinned = pinExit(shelf, 0, 8);
    if (pinned) {
      pinned.under = true;
      underOpacity = 1;
      nodes.push(pinned);
    }
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
  // The thumbnail is revealed in the same turn the flyer leaves.
  // Calling arrive while the node is still on screen showed both.
  const el = node;
  node = null;
  fromBox = null;
  parked = null;
  destGet = null;
  el?.remove();
  if (!arrived) {
    arrived = true;
    arrive?.();
  }
  arrive = null;
}

function frame(now: number) {
  if (!node || !fromBox) {
    stopLoop();
    return;
  }
  const dt = last ? Math.min(0.032, (now - last) / 1000) : 0.016;
  last = now;
  // A flyer that has not loaded paints nothing: on a 60 fps sheet the cover
  // vanished for a frame (+60 ms) and came back in the air. Hold until it is drawable.
  if (parked) {
    if (!node.complete || !node.naturalWidth) {
      raf = requestAnimationFrame(frame);
      return;
    }
    parked.style.visibility = 'hidden';
    parked = null;
  }
  const to = destGet?.() ?? null;
  if (!to) {
    place(node, fromBox, fromBox, 0);
    if (now - started > 1400) finish();
    else raf = requestAnimationFrame(frame);
    return;
  }
  // A planted fault (preview only) holds this frame or skips the step.
  if (noteFlightFrame(now) === 'skip') {
    raf = requestAnimationFrame(frame);
    return;
  }
  state = stepSpring(state, 1, dt, FLIGHT_SPRING);
  const t = Math.max(0, Math.min(1, state.x));
  place(node, fromBox, to, t);
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

function readPx(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const n = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Where the header art will be, before the song page has laid out.
 * The first flight frame runs before the route commits. On WebKit the song's
 * first layout then blocks the next frame for about 300 ms, so a cover that
 * is still parked on that first frame does not move until the block ends.
 * The numbers follow the header rules in app.css. followHeader replaces this
 * with the measured box once the song has painted.
 */
function predictHeader(): MorphBox {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = getComputedStyle(document.documentElement);
  const safeT = readPx(root, '--safe-t', 0);
  const safeL = readPx(root, '--safe-l', 0);
  const hit = readPx(root, '--hit', 44);
  const shortLand = (vw >= 700 && vh <= 640) || (vw <= 699 && vh <= 520 && vw > vh);
  const se = vw <= 389;
  const phone = !shortLand && ((vw <= 699 && vh >= 521) || (vw <= 767 && vh >= 641));
  let art = 40;
  let barTop = 0;
  let barLeft = 0;
  let padT = 12;
  let padL = 8;
  const gap = 8;
  if (shortLand) {
    art = 32;
    barTop = Math.max(4, safeT);
    barLeft = Math.max(12, safeL);
    padT = 4;
    padL = 6;
  } else if (phone) {
    art = se ? 32 : 40;
    barTop = Math.max(se ? 2 : 8, safeT);
    barLeft = Math.max(10, safeL);
    padT = se ? 4 : 8;
    padL = se ? 6 : 8;
  } else if (vw >= 768) {
    const wideArt = vw >= 1100 && vh > 640;
    art = wideArt ? 52 : 48;
    barTop = Math.max(16, safeT);
    padT = 10;
    padL = 12;
    const dock = stageFrame(vw, vh, true);
    barLeft = vw >= 1280 && vh > 640 ? dock.colLeft : Math.max(dock.colLeft, safeL);
  }
  const row = Math.max(hit, art);
  return {
    left: barLeft + padL + hit + gap,
    top: barTop + padT + Math.max(0, (row - art) / 2),
    width: art,
    height: art,
    radius: art / 2,
  };
}

/** Decoded copies of the library covers, made while the library is idle. */
const warmed = new Map<string, HTMLImageElement>();

/**
 * Decode the flyer before the tap. A new image born on the click was not drawn on
 * the first frames (Chromium +64 ms: no cover at all) even when it was in the cache.
 */
export function warmCover(src: string): void {
  if (!src || warmed.has(src) || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'sync';
  img.src = src;
  warmed.set(src, img);
  img.decode().catch(() => warmed.delete(src));
}

/** Hide the card image and put the one flyer on the body, at the card's rect. */
export function armMorph(card: HTMLElement): void {
  const cover = card.querySelector<HTMLElement>('[data-poster]');
  if (node) {
    node.remove();
    node = null;
  }
  fromBox = null;
  parked = null;
  arrived = false;
  state = { x: 0, v: 0 };
  if (!cover) return;
  const src = cover instanceof HTMLImageElement ? cover.currentSrc || cover.src : '';
  // The pressed card scales to 0.985. Measuring through that scale squashes
  // the title and the listen pill into the flyer. Reset first, then measure.
  card.style.transition = 'none';
  card.style.transform = 'none';
  const box = boxOf(cover);
  // Labels stay on the card until the exit copies exist. Hiding them here
  // left a blank frame before the route changed.
  if (motionBlocked() || !src || box.width < 2) return;
  const ready = warmed.get(src);
  warmed.delete(src);
  const el = ready ?? document.createElement('img');
  el.className = 'morph-cover';
  el.alt = '';
  el.decoding = 'sync';
  if (el.src !== src) el.src = src;
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
  if (el.complete && el.naturalWidth) cover.style.visibility = 'hidden';
  else parked = cover;
  // A destination on the tap. The song page has not committed yet, and WebKit
  // does not deliver the next frame until that first layout has painted.
  if (!destGet) {
    const header = predictHeader();
    destGet = () => header;
    // Step once before yielding. The tap frame then already shows the cover
    // leaving, including when WebKit's next callback waits on the song layout.
    started = performance.now();
    last = started;
    state = stepSpring(state, 1, 0.016, FLIGHT_SPRING);
    place(el, fromBox, header, Math.max(0, Math.min(1, state.x)));
    running = true;
    raf = requestAnimationFrame(frame);
    return;
  }
  started = performance.now();
  ensureLoop();
}

/**
 * Copies of the header, the shelf and the card labels. Call this while the
 * library is still mounted, in the same turn that unmounts it, so the click
 * itself only puts the cover in the air.
 */
export function armLibraryExit(card: HTMLElement): void {
  const library = card.closest('.library');
  if (!(library instanceof HTMLElement) || motionBlocked()) return;
  copyImages = [];
  armExit(library, card);
}

/**
 * The library may unmount once the copies can draw their covers. A fresh copy of
 * an image paints nothing until it decodes; the live cover under it hid that only
 * while the library was still there. At most 120 ms.
 */
export function exitDecoded(): Promise<void> {
  const list = copyImages;
  copyImages = [];
  const decoded = Promise.all(list.map((img) => img.decode().catch(() => {}))).then(() => {});
  return Promise.race([decoded, new Promise<void>((resolve) => setTimeout(resolve, 120))]);
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
  const found = new Map<string, HTMLElement[]>();
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
    // The floor's own rule reads this. An inline transform fought the sheet.
    if (sel === '.player') {
      root.style.setProperty('--floor-in', t.toFixed(3));
      return;
    }
    let nodes = found.get(sel);
    if (!nodes) {
      nodes = [...root.querySelectorAll<HTMLElement>(sel)];
      if (nodes.length) found.set(sel, nodes);
    }
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
    root.style.removeProperty('--floor-in');
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
    const sinceClick = started ? (now - started) / 1000 : elapsed;
    let quiet = true;
    RISES.forEach((group, i) => {
      if (group.sel === '.player' && (sinceClick < FLOOR_DELAY || underOpacity > 0)) {
        paint(group.sel, group.dist, 0);
        quiet = false;
        return;
      }
      if (progress < group.gate) {
        paint(group.sel, group.dist, 0);
        quiet = false;
        return;
      }
      // The title used to wait on a spring that opened at this gate, so the
      // last third of the flight was still a dark stage on a 100 ms sheet.
      // It now tracks the flight itself and is already up as the cover lands.
      if (group.sel !== '.player') {
        const span = Math.max(0.001, 1 - group.gate);
        const t = Math.max(0, Math.min(1, (progress - group.gate) / span));
        paint(group.sel, group.dist, t);
        if (t < 0.99) quiet = false;
        return;
      }
      springs[i] = stepSpring(springs[i], 1, dt, RISE);
      const t = Math.max(0, Math.min(1, springs[i].x));
      paint(group.sel, group.dist, t);
      if (Math.abs(springs[i].x - 1) > 0.01 || Math.abs(springs[i].v) > 0.05) quiet = false;
    });
    if (quiet && elapsed > 0.2 * getMotionScale() && progress >= 0.995) {
      clear();
      done();
      return;
    }
    if (elapsed > 2.2 * getMotionScale()) {
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
