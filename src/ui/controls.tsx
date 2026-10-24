import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { GlassLayers } from './glass/Glass';
import { SHEET_SHELL_MS } from '@/scene/cover';
import { SHEET_CLOSE, SHEET_OPEN, springSettled, stepSpring, type SpringState } from './spring';

function motionOff() {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return document.documentElement.dataset.motion === 'off';
}

function clearSheetChrome() {
  delete document.documentElement.dataset.sheet;
  delete document.documentElement.dataset.cover;
  document.documentElement.classList.remove('is-sheet-drag');
  document.documentElement.style.removeProperty('--sheet-p');
}

/** The translate already painted on the sheet, in CSS px. The next spring step is not on the element yet. */
function paintedY(el: HTMLElement): number {
  const m = /translate3d\(\s*0(?:px)?\s*,\s*(-?[\d.]+)px/.exec(el.style.transform);
  return m ? Number(m[1]) : 0;
}

/**
 * Translate that keeps the sheet top 16 px under the fading note card.
 * Null when the card is not fading. The first paint uses it, so the bottom
 * edge is already drawn while the card is still on its way out (D22).
 */
function parkBelowCard(el: HTMLElement): number | null {
  if (document.documentElement.dataset.noteFade !== '1') return null;
  const card = document.querySelector('.note-card');
  if (!(card instanceof HTMLElement)) return null;
  const cardBox = card.getBoundingClientRect();
  if (cardBox.height < 8) return null;
  // The rest pose is translate 110%. paintedY only reads a px offset, so a
  // percent transform would be measured as the visual top and the park would
  // come out negative, throwing the sheet over the card.
  const prev = el.style.transform;
  const px = /translate3d\(\s*0(?:px)?\s*,\s*-?[\d.]+px/.test(prev);
  if (!px) el.style.transform = 'translate3d(0, 0px, 0)';
  const layoutTop = el.getBoundingClientRect().top - (px ? paintedY(el) : 0);
  if (!px) el.style.transform = prev;
  const minY = cardBox.bottom + 16 - layoutTop;
  return Number.isFinite(minY) ? minY : null;
}

/* ---------- Sheet: glass panel, spring in, drag down to dismiss ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  size = 'medium',
  onBack,
  backLabel,
  plain = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'medium' | 'large';
  onBack?: () => void;
  backLabel?: string;
  /** First frame of an opening sheet: the shell only, no glass layers. */
  plain?: boolean;
}) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const height = useRef(1);
  const state = useRef<SpringState>({ x: 900, v: 0 });
  const target = useRef(0);
  const raf = useRef(0);
  const openRef = useRef(open);
  const drag = useRef<{
    y0: number;
    lastY: number;
    lastT: number;
    v: number;
    active: boolean;
    decided: boolean;
    pointer: number;
  } | null>(null);
  const titleId = useId();
  const plainRef = useRef(plain);
  plainRef.current = plain;
  openRef.current = open;
  // Last painted top of the shell, so the row commit can put the top back.
  const shellTop = useRef<number | null>(null);
  const lockedTop = useRef<number | null>(null);
  const prevHeight = useRef(0);
  const rowHeld = useRef(false);

  const remember = () => {
    const el = panel.current;
    if (el) height.current = Math.max(1, el.offsetHeight);
  };

  const paint = (y: number) => {
    const el = panel.current;
    if (!el) return;
    // Negative y is the upward rubber-band. The scrim follows only the downward travel.
    const travel = y;
    el.style.transform = `translate3d(0, ${travel.toFixed(2)}px, 0)`;
    // The shell frame is a flat fill. Blur, shadow and the glass layers come
    // with the rows; they are what made the first cast frame late.
    if (plainRef.current) {
      el.dataset.shell = '1';
      el.style.background = 'var(--sheet-fallback)';
      el.style.boxShadow = 'none';
      el.style.backdropFilter = 'none';
      el.style.setProperty('-webkit-backdrop-filter', 'none');
    } else if (el.dataset.shell) {
      delete el.dataset.shell;
      el.style.removeProperty('background');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
    }
    const p = Math.max(0, Math.min(1, 1 - Math.max(0, travel) / height.current));
    // The scrim is a full-viewport blend. It waits until the shell's frame has
    // been painted; darkening the song on the tap frame was the slow paint.
    if (backdrop.current) backdrop.current.style.opacity = plainRef.current ? '0' : p.toFixed(3);
    const root = document.documentElement;
    // One progress for every device. The song reads it as a transform only.
    root.style.setProperty('--sheet-p', p.toFixed(3));
    // The page scale waits until the frame after the shell is drawn. On the tap
    // frame it pushed WebKit's first paint past 100 ms. Once the cover is on,
    // it stays until the sheet has left: clearing it mid-flight woke the sky.
    if (!openRef.current && p <= 0.02) delete root.dataset.sheet;
    // Refraction waits until the spring has arrived. Toggling it mid-flight resamples every frame.
    const settled = openRef.current && travel >= 0 && travel < 0.8;
    if (el.classList.contains('is-settled') !== settled) el.classList.toggle('is-settled', settled);
  };

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const loop = () => {
    stop();
    let last = performance.now();
    const tick = (now: number) => {
      if (drag.current?.active) return;
      const elNow = panel.current;
      // Remember the shell's top on the frames before the rows exist. One read
      // per frame, and only after the tap's own paint: the first frame is the
      // layout effect below, not this tick.
      if (elNow && plainRef.current) shellTop.current = elNow.getBoundingClientRect().top;
      // Rows fade in over the next frames. Hold the top until that fade clears
      // the flag, so the spring does not walk the edge while they appear (D33).
      if (elNow && elNow.dataset.rowLock === '1' && lockedTop.current != null) {
        const dy = elNow.getBoundingClientRect().top - lockedTop.current;
        if (Math.abs(dy) > 0.25) state.current = { x: state.current.x - dy, v: 0 };
        else state.current.v = 0;
        last = now;
        paint(state.current.x);
        raf.current = requestAnimationFrame(tick);
        return;
      }
      // The closed form is exact, so a slow WebKit frame may take its whole gap.
      // Capping at 32 ms made the sheet wait out the cast instead of the spring.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const spec = target.current > 1 ? SHEET_CLOSE : SHEET_OPEN;
      state.current = stepSpring(state.current, target.current, dt, spec);
      // The note fades on its own clock. The sheet may already be on screen
      // below the card; its top stays there until the fade ends (D22).
      const el = panel.current;
      if (el && target.current <= 1 && openRef.current) {
        const minY = parkBelowCard(el);
        if (minY != null && state.current.x < minY) state.current = { x: minY, v: 0 };
      }
      paint(state.current.x);
      if (springSettled(state.current, target.current)) {
        state.current = { x: target.current, v: 0 };
        paint(target.current);
        if (!openRef.current && target.current > 1) {
          setShown(false);
          setRender(false);
          clearSheetChrome();
        }
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!open) return;
    setRender(true);
    const id = window.setTimeout(() => {
      document.documentElement.dataset.sheet = '1';
    }, SHEET_SHELL_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  useLayoutEffect(() => {
    if (!render || !panel.current) return;
    const el = panel.current;
    remember();
    // Phone sheets are a dense fill. The lens still blurred the song behind it,
    // and that sample was on the tap frame.
    if (document.documentElement.dataset.phone === '1') {
      const lens = el.querySelector('.lg-lens');
      if (lens instanceof HTMLElement) {
        lens.style.backdropFilter = 'none';
        lens.style.setProperty('-webkit-backdrop-filter', 'none');
      }
    }
    const away = () => height.current + 48;
    const ro = new ResizeObserver(() => remember());
    ro.observe(el);
    if (motionOff()) {
      stop();
      state.current = { x: 0, v: 0 };
      paint(0);
      if (open) setShown(true);
      else {
        setShown(false);
        const timer = window.setTimeout(() => {
          setRender(false);
          clearSheetChrome();
        }, 200);
        return () => {
          window.clearTimeout(timer);
          ro.disconnect();
        };
      }
      return () => ro.disconnect();
    }
    if (open) {
      if (!shown) {
        // CSS parks the sheet at 110%. Painting here, before the browser frame,
        // puts the bottom edge on that first frame instead of springing up to it.
        const awayFrom = away();
        const parked = height.current > 80 ? parkBelowCard(el) : null;
        let from = parked != null && parked >= 0 && parked < awayFrom ? parked : awayFrom;
        // Rows arrive after SHEET_SHELL_MS, so this shell is short and `away`
        // would park it entirely past the bottom edge. The tap's first paint
        // has to cross the player band (D28). A 48 px strip stays on screen.
        const onScreen = Math.max(0, height.current - 48);
        if (from > onScreen) from = onScreen;
        state.current = { x: from, v: 0 };
        paint(from);
      }
      target.current = 0;
      setShown(true);
    } else {
      target.current = away();
    }
    loop();
    return () => {
      ro.disconnect();
      stop();
    };
    // `shown` is intentionally read once per open, not a dependency: including it restarts the spring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, render]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => () => clearSheetChrome(), []);

  // The shell is short and anchored to the bottom. Rows grow it upward on the
  // same translate, so the commit itself can cross the note. The spring only
  // parks on the next frame. Hold the top under the card before paint (D5, D22).
  // The same commit pins the top to the shell's last frame, so the rows do not
  // move the edge (D33). The fade that follows holds it from the spring tick.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !openRef.current) {
      rowHeld.current = false;
      prevHeight.current = 0;
      lockedTop.current = null;
      return;
    }
    const beforeH = prevHeight.current;
    const beforeTop = shellTop.current;
    remember();
    const minY = parkBelowCard(el);
    if (minY != null && state.current.x < minY) {
      state.current = { x: minY, v: 0 };
      paint(minY);
    }
    const grew = !rowHeld.current && beforeH > 40 && el.offsetHeight - beforeH > 8 && !!el.querySelector('.row');
    if (grew) {
      if (beforeTop != null) {
        const dy = el.getBoundingClientRect().top - beforeTop;
        if (Math.abs(dy) > 0.5) {
          state.current = { x: state.current.x - dy, v: 0 };
          paint(state.current.x);
        }
      }
      rowHeld.current = true;
      lockedTop.current = el.getBoundingClientRect().top;
    }
    prevHeight.current = el.offsetHeight;
  });

  if (!render) return null;

  const onDown = (e: ReactPointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, input, textarea, select, label, [role="switch"], [role="radio"]')) return;
    const scroller = body.current;
    const inBody = !!scroller && scroller.contains(t);
    drag.current = {
      y0: e.clientY,
      lastY: e.clientY,
      lastT: performance.now(),
      v: 0,
      active: !inBody,
      decided: !inBody,
      pointer: e.pointerId,
    };
    if (!inBody) {
      stop();
      document.documentElement.classList.add('is-sheet-drag');
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.decided) {
      const dy = e.clientY - d.y0;
      const atTop = (body.current?.scrollTop ?? 0) <= 0;
      if (dy > 8 && atTop) {
        d.decided = true;
        d.active = true;
        d.y0 = e.clientY;
        d.lastY = e.clientY;
        stop();
        document.documentElement.classList.add('is-sheet-drag');
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } else if (dy < -8 || !atTop) {
        drag.current = null;
      }
      return;
    }
    if (!d.active) return;
    const now = performance.now();
    const dt = Math.max(8, now - d.lastT);
    d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = now;
    const raw = e.clientY - d.y0;
    const h = height.current;
    // Down follows the finger, then resists past the sheet height. Up only stretches a little.
    const y = raw < 0 ? raw * 0.28 : raw < h ? raw : h + (raw - h) * 0.32;
    state.current = { x: y, v: d.v * 1000 };
    paint(y);
  };

  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    document.documentElement.classList.remove('is-sheet-drag');
    if (!d.active) return;
    const h = panel.current?.offsetHeight ?? 600;
    const flung = d.v > 0.55;
    const far = state.current.x > Math.min(120, h * 0.22);
    if (flung || far) {
      state.current.v = Math.max(0, d.v * 1000);
      onClose();
      return;
    }
    target.current = 0;
    loop();
  };

  return createPortal(
    <div className={`sheet-root${shown ? ' is-open' : ''}`}>
      <div ref={backdrop} className="sheet-backdrop" onClick={onClose} />
      <div
        ref={panel}
        className={`sheet glass lg-host lg-host--sheet sheet--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {plain ? null : <GlassLayers />}
        <div className="sheet-head">
          <div className="sheet-grabber" />
          <div className="sheet-titlebar">
            {onBack ? (
              <button type="button" className="btn btn-plain sheet-back" onClick={onBack}>
                <Icon name="chevron.left" size={20} />
                <span>{backLabel ?? 'Назад'}</span>
              </button>
            ) : (
              <span className="sheet-side" />
            )}
            <h2 id={titleId} key={title} className="sheet-title t-headline">
              {title}
            </h2>
            <button type="button" className="sheet-done" onClick={onClose}>
              Готово
            </button>
          </div>
        </div>
        <div ref={body} className="sheet-body">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Grouped list ---------- */

export function Group({ header, footer, children }: { header?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="group">
      {header && <h3 className="group-header t-footnote">{header}</h3>}
      <div className="group-body">{children}</div>
      {footer && <div className="group-footer t-footnote">{footer}</div>}
    </section>
  );
}

export function Row({
  icon,
  title,
  detail,
  children,
  onClick,
  chevron,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
}) {
  const content = (
    <>
      {icon && <span className="row-icon">{icon}</span>}
      <span className="row-text">
        <span className="row-title">{title}</span>
        {detail && <span className="row-detail t-footnote">{detail}</span>}
      </span>
      {children && <span className="row-accessory">{children}</span>}
      {chevron && (
        <svg className="row-chevron" width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
          <path d="M1 1L6 6L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className="row row--button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="row">{content}</div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className={className ? `seg ${className}` : 'seg'}
      role="radiogroup"
      aria-label={label}
      style={{ ['--n' as string]: options.length, ['--i' as string]: i }}
    >
      <span className="seg-thumb" aria-hidden />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="seg-item" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  center,
  vertical,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  center?: number;
  vertical?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const c = center != null ? ((center - min) / (max - min)) * 100 : 0;
  const from = Math.min(pct, c);
  const to = Math.max(pct, c);
  return (
    <input
      type="range"
      className={`slider${vertical ? ' slider--vertical' : ''}`}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ ['--from' as string]: `${from}%`, ['--to' as string]: `${to}%` }}
    />
  );
}
