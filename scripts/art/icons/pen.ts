/**
 * Geometry for the Qalam icon family.
 * Paths are built here so every glyph shares one stroke, one hatch angle
 * and one corner rule. Coordinates are on the 24 grid.
 */

export type Pt = { x: number; y: number };

export function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Closed circle, from the leftmost point. */
export function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 1 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-r * 2)} 0`;
}

/** Diamond, the naskh dot. `r` is the centre-to-vertex distance. */
export function diamond(cx: number, cy: number, r: number): string {
  return `M${n(cx)} ${n(cy - r)}L${n(cx + r)} ${n(cy)}L${n(cx)} ${n(cy + r)}L${n(cx - r)} ${n(cy)}Z`;
}

/** Rounded rectangle, clockwise, closed. */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + rr)}V${n(y + h - rr)}Q${n(x + w)} ${n(y + h)} ${n(x + w - rr)} ${n(y + h)}H${n(x + rr)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - rr)}V${n(y + rr)}Q${n(x)} ${n(y)} ${n(x + rr)} ${n(y)}Z`;
}

/** Polygon of a rounded rectangle, clockwise, for clipping. */
export function rrectPoly(x: number, y: number, w: number, h: number, r: number, steps = 3): Pt[] {
  const rr = Math.min(r, w / 2, h / 2);
  const corners: { cx: number; cy: number; a0: number }[] = [
    { cx: x + w - rr, cy: y + rr, a0: -Math.PI / 2 },
    { cx: x + w - rr, cy: y + h - rr, a0: 0 },
    { cx: x + rr, cy: y + h - rr, a0: Math.PI / 2 },
    { cx: x + rr, cy: y + rr, a0: Math.PI },
  ];
  const pts: Pt[] = [];
  for (const corner of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = corner.a0 + (i / steps) * (Math.PI / 2);
      pts.push({ x: corner.cx + rr * Math.cos(a), y: corner.cy + rr * Math.sin(a) });
    }
  }
  return pts;
}

/**
 * Closed polygon with quadratic corners. The control point is the sharp
 * corner, so the visual tip sits inside it. `radius` is one value or one
 * per corner.
 */
export function roundPoly(pts: Pt[], radius: number | number[]): string {
  const count = pts.length;
  const radii = Array.isArray(radius) ? radius : pts.map(() => radius);
  const corners = pts.map((cur, i) => {
    const prev = pts[(i - 1 + count) % count]!;
    const next = pts[(i + 1) % count]!;
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const rr = Math.min(radii[i] ?? 0, l1 / 2.05, l2 / 2.05);
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

/** Same rounded polygon as a clip outline (samples the quadratics). */
export function roundPolyPoints(pts: Pt[], radius: number | number[], steps = 4): Pt[] {
  const count = pts.length;
  const radii = Array.isArray(radius) ? radius : pts.map(() => radius);
  const corners = pts.map((cur, i) => {
    const prev = pts[(i - 1 + count) % count]!;
    const next = pts[(i + 1) % count]!;
    const v1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const rr = Math.min(radii[i] ?? 0, l1 / 2.05, l2 / 2.05);
    return {
      p1: { x: cur.x - u1.x * rr, y: cur.y - u1.y * rr },
      c: cur,
      p2: { x: cur.x + u2.x * rr, y: cur.y + u2.y * rr },
    };
  });
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const here = corners[i]!;
    const next = corners[(i + 1) % count]!;
    out.push(here.p2);
    out.push(next.p1);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u * u * next.p1.x + 2 * u * t * next.c.x + t * t * next.p2.x,
        y: u * u * next.p1.y + 2 * u * t * next.c.y + t * t * next.p2.y,
      });
    }
  }
  return out;
}

/** Open chevron. The elbow is a quadratic so the tip stays soft. */
export function elbow(a: Pt, tip: Pt, b: Pt, radius: number): string {
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

/** Stadium. Round caps match a stroke of the same thickness. */
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

export function line(a: Pt, b: Pt): string {
  return `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`;
}

/** Short medallion tick across a stroke end, perpendicular to the arm. */
export function tick(at: Pt, dir: Pt, length: number): string {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const px = (-dir.y / len) * (length / 2);
  const py = (dir.x / len) * (length / 2);
  return line({ x: at.x - px, y: at.y - py }, { x: at.x + px, y: at.y + py });
}

/** Scale a polygon toward its centroid so hatch stays off the contour. */
export function insetPoly(poly: Pt[], amount: number): Pt[] {
  if (poly.length < 3 || amount <= 0) return poly;
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  let min = Infinity;
  for (const p of poly) min = Math.min(min, Math.hypot(p.x - cx, p.y - cy));
  if (min < 0.8) return poly;
  const scale = Math.max(0.42, (min - amount) / min);
  return poly.map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale }));
}

function inside(poly: Pt[], p: Pt): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y);
      if (p.x < x) c = !c;
    }
  }
  return c;
}

/** Intersection of edge a→b with the infinite line o + t·d. Returns t, or null. */
function edgeHit(a: Pt, b: Pt, o: Pt, d: Pt): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = ex * d.y - ey * d.x;
  if (Math.abs(den) < 1e-9) return null;
  const ox = o.x - a.x;
  const oy = o.y - a.y;
  const u = (ox * d.y - oy * d.x) / den;
  if (u < -1e-5 || u > 1 + 1e-5) return null;
  return (ox * ey - oy * ex) / den;
}

/**
 * Clip an infinite line to a polygon (convex or concave).
 * `dir` only sets the axis; its length is one grid unit.
 */
export function clipLine(origin: Pt, dir: Pt, poly: Pt[]): [Pt, Pt][] {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const t = edgeHit(poly[i]!, poly[(i + 1) % poly.length]!, origin, dir);
    if (t != null) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const t of ts) {
    if (!unique.length || Math.abs(t - unique[unique.length - 1]!) > 1e-3) unique.push(t);
  }
  const spans: [Pt, Pt][] = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const t0 = unique[i]!;
    const t1 = unique[i + 1]!;
    const mid = { x: origin.x + dir.x * ((t0 + t1) / 2), y: origin.y + dir.y * ((t0 + t1) / 2) };
    if (!inside(poly, mid)) continue;
    const p0 = { x: origin.x + dir.x * t0, y: origin.y + dir.y * t0 };
    const p1 = { x: origin.x + dir.x * t1, y: origin.y + dir.y * t1 };
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) >= 1.15) spans.push([p0, p1]);
  }
  return spans;
}

/**
 * Engraved hatch across `poly`. Angle is degrees, y grows downward,
 * so 35 matches `shade({ angle: 35 })` in scripts/art/lib.mjs.
 * Returns one segment per visible run.
 */
export function hatch(poly: Pt[], angleDeg: number, spacing: number): [Pt, Pt][] {
  if (poly.length < 3 || spacing <= 0.4) return [];
  const rad = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };
  const nrm = { x: -Math.sin(rad), y: Math.cos(rad) };
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const s = (p.x - cx) * nrm.x + (p.y - cy) * nrm.y;
    min = Math.min(min, s);
    max = Math.max(max, s);
  }
  const span = max - min;
  if (span < spacing * 0.85) return [];
  const count = Math.max(1, Math.floor((span - spacing * 0.2) / spacing));
  const total = (count - 1) * spacing;
  const start = (min + max) / 2 - total / 2;
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < count; i++) {
    const s = start + i * spacing;
    const origin = { x: cx + nrm.x * s, y: cy + nrm.y * s };
    for (const seg of clipLine(origin, dir, poly)) out.push(seg);
  }
  return out;
}

export function joinLines(segs: [Pt, Pt][]): string {
  return segs.map(([a, b]) => line(a, b)).join('');
}

export function joinCapsules(segs: [Pt, Pt][], thickness: number): string {
  return segs.map(([a, b]) => capsule(a.x, a.y, b.x, b.y, thickness)).join('');
}
