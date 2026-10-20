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
