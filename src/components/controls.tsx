import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/icons/Icon';

/* ---------- Sheet: iOS 26 floating sheet with grabber, drag-to-dismiss, Esc, backdrop tap ---------- */

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
  /** In-sheet navigation: shows a back button in the header. */
  onBack?: () => void;
  backLabel?: string;
}) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setRender(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const to = setTimeout(() => setRender(false), 380);
    return () => clearTimeout(to);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!render) return null;

  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0, t: performance.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    panel.current.style.transition = 'none';
    panel.current.style.transform = `translate3d(0, ${d.dy}px, 0)`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    panel.current.style.transition = '';
    panel.current.style.transform = '';
    const v = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 120 || v > 0.6) onClose();
  };

  return createPortal(
    <div className={`sheet-root${shown ? ' is-open' : ''}`}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        ref={panel}
        className={`sheet glass glass--strong sheet--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="sheet-grabber" />
          {onBack && (
            <button className="btn btn-plain sheet-back" onClick={onBack} onPointerDown={(e) => e.stopPropagation()}>
              <Icon name="chevron.left" size={18} weight={2.3} />
              <span>{backLabel ?? 'Назад'}</span>
            </button>
          )}
          <h2 id={titleId} className="sheet-title t-headline">
            {title}
          </h2>
          <button className="btn btn-circle btn-sm sheet-close btn-gray" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Закрыть">
            <Icon name="xmark" size={15} weight={2.3} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Grouped list (inset) ---------- */

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
      {chevron && <Icon name="chevron.right" size={15} weight={2.2} className="row-chevron" />}
    </>
  );
  return onClick ? (
    <button className="row row--button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="row">{content}</div>
  );
}

/* ---------- Switch (51 × 31, system green) ---------- */

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
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

/* ---------- Segmented control ---------- */

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
    <div className={className ? `seg ${className}` : 'seg'} role="radiogroup" aria-label={label} style={{ ['--n' as string]: options.length, ['--i' as string]: i }}>
      <span className="seg-thumb" aria-hidden />
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className="seg-item" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Slider ---------- */

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
  /** Fill from this value instead of from min (bipolar sliders like EQ gain). */
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
