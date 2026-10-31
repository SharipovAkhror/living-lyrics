/**
 * Test-only faults for the motion rows. The dev and preview builds honour
 * `?ll-mutate=a|b|c|d`. The production build defines the flag false and the
 * bundler drops every branch below, the same way as `?fill=1`.
 *
 * a — the first drawn answer to a tap waits 300 ms (D28).
 * b — during a scrub, one beat with the stage and the player undrawn, then
 *     one beat with a black rectangle over the player (D29).
 * c — the cover flight freezes, then one frame is a full white field (D30).
 * d — settings rows appear at full opacity on one frame and drop 6 px (D33).
 */
declare const __MUTATE_QUERY__: boolean | undefined;

/**
 * False only in the production bundle. Vite replaces the flag, so this folds
 * to a constant and the branches below are deleted from that bundle.
 */
const MUTATE = typeof __MUTATE_QUERY__ === 'undefined' || __MUTATE_QUERY__;

export type MutateKind = 'a' | 'b' | 'c' | 'd';

function readKind(): MutateKind | '' {
  if (typeof location === 'undefined') return '';
  const v = new URLSearchParams(location.search).get('ll-mutate');
  return v === 'a' || v === 'b' || v === 'c' || v === 'd' ? v : '';
}

type FlightFault = 'run' | 'skip';
let flightHook: ((now: number) => FlightFault) | null = null;

/**
 * Called from the cover flight, once per frame, only while the cover is moving.
 * Production returns 'run' and the hook is never installed.
 */
export function noteFlightFrame(now: number): FlightFault {
  if (!MUTATE) return 'run';
  return flightHook ? flightHook(now) : 'run';
}

const TAP_DELAY_MS = 300;
/** Long enough that a slow cast (about 7 fps on WebKit here) samples the blank. */
const BEAT_MS = 220;
/** Four frames of the slow cast (about 60–100 ms each) plus the cast's own slack. */
const FREEZE_MS = 560;

function installDelay(): void {
  const style = document.createElement('style');
  style.textContent = 'html[data-ll-hold] :active{transform:none!important;transition:none!important}';
  document.head.append(style);
  const locks: HTMLElement[] = [];
  type Queued = { type: string; target: EventTarget; init: PointerEventInit; pointer: boolean };
  const queue: Queued[] = [];
  let timer = 0;
  let holding = false;

  const unlock = () => {
    document.documentElement.removeAttribute('data-ll-hold');
    for (const el of locks) {
      el.style.removeProperty('transform');
      el.style.removeProperty('transition');
      el.style.removeProperty('background-color');
    }
    locks.length = 0;
  };

  const flush = () => {
    timer = 0;
    holding = false;
    unlock();
    const batch = queue.splice(0);
    if (batch.some((item) => item.type === 'pointerup') && !batch.some((item) => item.type === 'click')) {
      const down = batch.find((item) => item.type === 'pointerdown');
      if (down) batch.push({ ...down, type: 'click', pointer: false });
    }
    for (const item of batch) {
      const ev = item.pointer ? new PointerEvent(item.type, item.init) : new MouseEvent(item.type, item.init);
      Object.defineProperty(ev, '__llReplay', { value: true });
      item.target.dispatchEvent(ev);
    }
  };

  const take = (event: Event) => {
    if ((event as Event & { __llReplay?: boolean }).__llReplay) return;
    const type = event.type;
    if (type === 'pointerdown' && event.isTrusted) {
      holding = true;
      document.documentElement.dataset.llHold = '1';
      const hit = event.target instanceof Element ? event.target.closest('button, a, .lib-hero') : null;
      if (hit instanceof HTMLElement) {
        hit.style.setProperty('transform', 'none', 'important');
        hit.style.setProperty('transition', 'none', 'important');
        if (hit.classList.contains('btn-ring')) hit.style.setProperty('background-color', 'var(--accent)', 'important');
        locks.push(hit);
      }
    }
    if (!holding || !event.isTrusted) return;
    if (type !== 'pointerdown' && type !== 'pointerup' && type !== 'mousedown' && type !== 'mouseup' && type !== 'click') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pe = event as PointerEvent;
    queue.push({
      type,
      target: event.target instanceof Node ? event.target : window,
      pointer: type.startsWith('pointer'),
      init: {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: pe.clientX,
        clientY: pe.clientY,
        screenX: pe.screenX,
        screenY: pe.screenY,
        button: pe.button,
        buttons: pe.buttons,
        pointerId: pe.pointerId,
        pointerType: pe.pointerType || 'mouse',
        isPrimary: pe.isPrimary !== false,
        view: window,
      },
    });
    if (!timer) timer = window.setTimeout(flush, TAP_DELAY_MS);
  };

  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    window.addEventListener(type, take, true);
  }
}

function installScrubFault(): void {
  let down = false;
  let raf = 0;
  let phase: 'wait' | 'blank' | 'gap' | 'black' | 'done' = 'wait';
  let phaseAt = 0;
  let frames = 0;
  const undo: Array<() => void> = [];

  const clear = () => {
    while (undo.length) undo.pop()?.();
  };

  const cover = (box: { left: number; top: number; width: number; height: number }, color: string) => {
    const veil = document.createElement('div');
    veil.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;background:${color};z-index:60;pointer-events:none`;
    document.body.append(veil);
    undo.push(() => veil.remove());
  };

  const boxOf = (sel: string) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    return r;
  };

  const blank = () => {
    clear();
    // Flat, and not near-black: the player reads as undrawn, and the dark-rectangle row stays for the other beat.
    const stage = boxOf('.scene-stage');
    const player = boxOf('.player');
    if (stage) cover(stage, '#2a2830');
    if (player) cover(player, '#2a2830');
  };

  const black = () => {
    clear();
    const player = boxOf('.player');
    if (!player) return;
    // The player box is well over 5 % of a phone. A flat black field there is the planted rectangle.
    cover(player, '#000');
  };

  const tick = (now: number) => {
    if (!down || phase === 'done') return;
    frames += 1;
    if (phase === 'wait' && frames >= 8) {
      blank();
      phase = 'blank';
      phaseAt = now;
    } else if (phase === 'blank' && now - phaseAt >= BEAT_MS) {
      clear();
      phase = 'gap';
      phaseAt = now;
    } else if (phase === 'gap' && now - phaseAt >= 420) {
      black();
      phase = 'black';
      phaseAt = now;
    } else if (phase === 'black' && now - phaseAt >= BEAT_MS) {
      clear();
      phase = 'done';
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  window.addEventListener(
    'pointerdown',
    (event) => {
      const hit = event.target instanceof Element ? event.target.closest('.scrub-track') : null;
      if (!hit) return;
      down = true;
      frames = 0;
      phase = 'wait';
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    },
    true,
  );
  const stop = () => {
    down = false;
    cancelAnimationFrame(raf);
    clear();
  };
  window.addEventListener('pointerup', stop, true);
  window.addEventListener('pointercancel', stop, true);
}

function installFlightFault(): void {
  let calls = 0;
  let veil: HTMLElement | null = null;
  flightHook = () => {
    const flyer = document.querySelector('.morph-cover');
    if (!(flyer instanceof HTMLElement)) return 'run';
    calls += 1;
    if (calls === 2) {
      veil = document.createElement('div');
      veil.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:81;pointer-events:none';
      document.body.append(veil);
      window.setTimeout(() => {
        veil?.remove();
        veil = null;
      }, 500);
      return 'skip';
    }
    if (calls === 3) {
      // Keep the white field up across one slow cast frame, then take it down
      // before the spring steps, so the frames on either side still agree.
      const end = performance.now() + BEAT_MS;
      while (performance.now() < end) {
        /* the planted flash */
      }
      veil?.remove();
      veil = null;
      return 'run';
    }
    if (calls === 5) {
      const end = performance.now() + FREEZE_MS;
      while (performance.now() < end) {
        /* four frames of the slow cast, held */
      }
      return 'run';
    }
    return 'run';
  };
}

/** Settings rows at full opacity, 6 px lower, on the frame they mount (D33). */
function installRowPop(): void {
  const mark = (stage: HTMLElement) => {
    if (stage.dataset.llPop === '1' || !stage.querySelector('.row')) return;
    stage.dataset.llPop = '1';
    for (const node of stage.querySelectorAll('.group')) {
      if (!(node instanceof HTMLElement)) continue;
      node.style.setProperty('animation', 'none', 'important');
      node.style.setProperty('opacity', '1', 'important');
    }
    // One frame later, so the arrival check sees the 6 px against the frame
    // the row popped in on. A margin collapses inside the group; a transform
    // moves the painted box.
    requestAnimationFrame(() => {
      const row = stage.querySelector('.row');
      if (!(row instanceof HTMLElement)) return;
      // .row--button transitions transform over 320 ms, so a bare write is
      // still under 1 px on the next Chromium frame. Snap the whole 6 px.
      row.style.setProperty('transition', 'none', 'important');
      row.style.setProperty('transform', 'translate3d(0, 6px, 0)', 'important');
    });
  };
  const scan = () => {
    const stage = document.querySelector('.set-stage');
    if (stage instanceof HTMLElement) mark(stage);
  };
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
}

/** Read the query once, at startup. No effect when the build stripped the flag. */
export function installMutations(): void {
  if (!MUTATE) return;
  const kind = readKind();
  if (kind === 'a') installDelay();
  else if (kind === 'b') installScrubFault();
  else if (kind === 'c') installFlightFault();
  else if (kind === 'd') installRowPop();
}
