import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { springSettled, stepSpring, type SpringState } from './spring';

function motionOff() {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return document.documentElement.dataset.motion === 'off';
}

function clearSheetChrome() {
  delete document.documentElement.dataset.sheet;
  document.documentElement.classList.remove('is-sheet-drag');
  document.documentElement.style.removeProperty('--sheet-p');
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'medium' | 'large';
  onBack?: () => void;
  backLabel?: string;
}) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
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
  openRef.current = open;

  const paint = (y: number) => {
    const el = panel.current;
    if (!el) return;
    const travel = Math.max(0, y);
    el.style.transform = `translate3d(0, ${travel.toFixed(2)}px, 0)`;
    const h = el.offsetHeight || 1;
    const p = Math.max(0, Math.min(1, 1 - travel / h));
    if (backdrop.current) backdrop.current.style.opacity = p.toFixed(3);
    const root = document.documentElement;
    root.style.setProperty('--sheet-p', p.toFixed(3));
    if (p > 0.02) root.dataset.sheet = '1';
    else delete root.dataset.sheet;
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
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      state.current = stepSpring(state.current, target.current, dt);
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
    if (open) setRender(true);
  }, [open]);

  useEffect(() => {
    if (!render || !panel.current) return;
    const el = panel.current;
    const away = () => el.offsetHeight + 48;
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
        return () => window.clearTimeout(timer);
      }
      return;
    }
    if (open) {
      if (!shown) {
        const from = away();
        state.current = { x: from, v: 0 };
        paint(from);
      }
      target.current = 0;
      setShown(true);
    } else {
      target.current = away();
    }
    loop();
    return () => stop();
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
    const y = Math.max(0, e.clientY - d.y0);
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
        className={`sheet glass sheet--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="sheet-head">
          <div className="sheet-grabber" />
          <div className="sheet-titlebar">
            {onBack ? (
              <button type="button" className="btn btn-plain sheet-back" onClick={onBack}>
                <Icon name="chevron.left" size={18} />
                <span>{backLabel ?? 'Назад'}</span>
              </button>
            ) : (
              <span className="sheet-side" />
            )}
            <h2 id={titleId} key={title} className="sheet-title t-headline">
              {title}
            </h2>
            <button type="button" className="btn btn-circle sheet-close" onClick={onClose} aria-label="Закрыть">
              <Icon name="xmark" size={16} />
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
      {chevron && <Icon name="chevron.right" size={16} className="row-chevron" />}
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
