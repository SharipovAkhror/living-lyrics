import { ICON_NAMES, type Glyph, type IconName, type IconSet, type Mark } from './types';

export function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r);
}

/** Rounded rectangle, clockwise, closed. */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + rr)}V${n(y + h - rr)}Q${n(x + w)} ${n(y + h)} ${n(x + w - rr)} ${n(y + h)}H${n(x + rr)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - rr)}V${n(y + rr)}Q${n(x)} ${n(y)} ${n(x + rr)} ${n(y)}Z`;
}

/** Full circle as two arcs, from the leftmost point. */
export function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 1 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-r * 2)} 0`;
}

/** Ellipse rotated by degrees, closed. Used for a notehead. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, deg: number): string {
  const rad = (deg * Math.PI) / 180;
  const x0 = cx + rx * Math.cos(rad);
  const y0 = cy + rx * Math.sin(rad);
  const x1 = cx - rx * Math.cos(rad);
  const y1 = cy - rx * Math.sin(rad);
  return `M${n(x0)} ${n(y0)}A${n(rx)} ${n(ry)} ${n(deg)} 1 1 ${n(x1)} ${n(y1)}A${n(rx)} ${n(ry)} ${n(deg)} 1 1 ${n(x0)} ${n(y0)}Z`;
}

/**
 * Closed polygon with quadratic corners. The curve does not pass through
 * the corner; the control point is the sharp corner, so the visual tip
 * sits slightly inside it.
 */
export function roundPoly(pts: { x: number; y: number }[], radius: number): string {
  const count = pts.length;
  const corners = pts.map((cur, i) => {
    const prev = pts[(i - 1 + count) % count]!;
    const next = pts[(i + 1) % count]!;
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const rr = Math.min(radius, l1 / 2.05, l2 / 2.05);
    return {
      p1: { x: cur.x - u1.x * rr, y: cur.y - u1.y * rr },
      c: cur,
      p2: { x: cur.x + u2.x * rr, y: cur.y + u2.y * rr },
    };
  });
  const first = corners[0]!;
  let d = `M${n(first.p2.x)} ${n(first.p2.y)}`;
  for (let i = 0; i < count; i++) {
    const corner = corners[(i + 1) % count]!;
    d += `L${n(corner.p1.x)} ${n(corner.p1.y)}Q${n(corner.c.x)} ${n(corner.c.y)} ${n(corner.p2.x)} ${n(corner.p2.y)}`;
  }
  return d + 'Z';
}

/** Stadium from (x1, y1) to (x2, y2). Round caps match a stroke of the same thickness. */
export function capsule(x1: number, y1: number, x2: number, y2: number, thickness: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const t = thickness / 2;
  const px = -uy * t;
  const py = ux * t;
  const a = { x: x1 + px, y: y1 + py };
  const b = { x: x2 + px, y: y2 + py };
  const c = { x: x2 - px, y: y2 - py };
  const d = { x: x1 - px, y: y1 - py };
  return `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}A${n(t)} ${n(t)} 0 0 1 ${n(c.x)} ${n(c.y)}L${n(d.x)} ${n(d.y)}A${n(t)} ${n(t)} 0 0 1 ${n(a.x)} ${n(a.y)}Z`;
}

/**
 * Open chevron. The elbow is a quadratic of the given radius, so the tip
 * stays soft even when the stroke join alone would still look sharp.
 */
export function openChevron(
  a: { x: number; y: number },
  tip: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
): string {
  const v1 = { x: tip.x - a.x, y: tip.y - a.y };
  const v2 = { x: b.x - tip.x, y: b.y - tip.y };
  const l1 = Math.hypot(v1.x, v1.y);
  const l2 = Math.hypot(v2.x, v2.y);
  const u1 = { x: v1.x / l1, y: v1.y / l1 };
  const u2 = { x: v2.x / l2, y: v2.y / l2 };
  const rr = Math.min(radius, l1 / 2.2, l2 / 2.2);
  const p1 = { x: tip.x - u1.x * rr, y: tip.y - u1.y * rr };
  const p2 = { x: tip.x + u2.x * rr, y: tip.y + u2.y * rr };
  return `M${n(a.x)} ${n(a.y)}L${n(p1.x)} ${n(p1.y)}Q${n(tip.x)} ${n(tip.y)} ${n(p2.x)} ${n(p2.y)}L${n(b.x)} ${n(b.y)}`;
}

/**
 * One sheet with the top-right corner folded down.
 * A comment on the current line: not a book (methodology is the open book),
 * and not a handset, a door or a badge.
 * `fold` is the length of the cut along the top and the right edge.
 */
export function noteSheet(l: number, t: number, w: number, h: number, rad: number, fold: number): string {
  const right = l + w;
  const bottom = t + h;
  const rr = Math.min(rad, h / 2, (w - fold) / 2, (h - fold) / 2);
  const foldX = right - fold;
  const foldY = t + fold;
  return `M${n(l + rr)} ${n(t)}H${n(foldX)}L${n(right)} ${n(foldY)}V${n(bottom - rr)}Q${n(right)} ${n(bottom)} ${n(right - rr)} ${n(bottom)}H${n(l + rr)}Q${n(l)} ${n(bottom)} ${n(l)} ${n(bottom - rr)}V${n(t + rr)}Q${n(l)} ${n(t)} ${n(l + rr)} ${n(t)}Z`;
}

export function stroke(d: string, sw?: number, opacity?: number): Mark {
  return { d, draw: 'stroke', sw, opacity };
}

export function fill(d: string, opacity?: number, rule?: Mark['rule']): Mark {
  return { d, draw: 'fill', opacity, rule };
}

export function iconSet(
  id: IconSet['id'],
  vb: number,
  sw: number,
  glyphs: Record<IconName, Glyph>,
): IconSet {
  const missing = ICON_NAMES.filter((name) => !glyphs[name] || glyphs[name].off.length === 0);
  if (missing.length) throw new Error(`icon set ${id} is missing ${missing.join(', ')}`);
  return { id, vb, sw, glyphs };
}
