/**
 * Geometry for the Qalam icon family.
 * Paths are built here so every glyph shares one nib.
 * Coordinates are on the 24 grid. The nib angle is the engraving hatch.
 */

import {
  arcStroke,
  circleRing,
  frameOf,
  quadStroke,
  roundLoop,
  roundSamples,
  solidRound,
} from './curve';

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
 * Closed polygon with circular fillets. `radius` is the tangent length
 * (the circle's radius on a right angle), one value or one per corner.
 * A zero radius stays a corner.
 */
export function roundPoly(pts: Pt[], radius: number | number[]): string {
  return solidRound(pts, radius);
}

/** Same rounded polygon as a clip outline. */
export function roundPolyPoints(pts: Pt[], radius: number | number[], steps = 4): Pt[] {
  return roundSamples(pts, radius, steps);
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

/**
 * The qalam cut. 35° is the engraving hatch in scripts/art/lib.mjs
 * (`shade({ angle: 35 })`), measured in screen space from +x toward +y.
 * Every terminal is this edge, or the nib's short side when the stroke
 * runs along the edge. One angle for the whole family.
 */
export const QATT = 35;

const QATT_RAD = (QATT * Math.PI) / 180;

/** Unit vector along the nib edge (the thick cut). */
export const QATT_EDGE = { x: Math.cos(QATT_RAD), y: Math.sin(QATT_RAD) };

/** Unit vector across the nib (the thin side). */
export const QATT_ACROSS = { x: -Math.sin(QATT_RAD), y: Math.cos(QATT_RAD) };

/**
 * Broad-nib. `broad` is the full length of the edge, `hair` the full
 * thickness. Stroke width is the nib's projection on the normal, so a
 * stroke across the edge is thick and a stroke along it is thin.
 */
export type Nib = { broad: number; hair: number };

/**
 * Contrast by optical master. 16 and 20 stay near a monoline so the thin
 * arm cannot fall through the pixel floor. 32 is where the pen shows.
 * Keyed by the master pixel size.
 */
const NIB_CONTRAST: Record<number, number> = {
  16: 1.06,
  20: 1.18,
  24: 1.46,
  28: 1.66,
  32: 1.86,
};

/**
 * Nib for a keyline of weight `sw` (grid units on the 24 board).
 * The horizontal stroke lands on `sw`. The thin stroke stays at least
 * `floorPx` on screen. Interior writing passes a lower floor so a counter
 * can stay open inside a plate.
 */
export function nibFor(optical: number, sw: number, floorPx = 1.6): Nib {
  const contrast = NIB_CONTRAST[optical] ?? 1.18;
  const minGrid = (floorPx * 24) / optical;
  const sin = Math.sin(QATT_RAD);
  const cos = Math.cos(QATT_RAD);
  let hair = sw / (contrast * sin + cos);
  let broad = hair * contrast;
  if (hair < minGrid) {
    hair = minGrid;
    broad = Math.max(hair, hair * contrast);
  }
  return { broad, hair };
}

/** 0 = silhouette only, 1 = the bookmark, 2 = full contrast, the second stroke and the extra nuqtas. */
export function penDetail(optical: number): 0 | 1 | 2 {
  if (optical >= 32) return 2;
  if (optical >= 24) return 1;
  return 0;
}

/** The family's dot. A square turned 45° — the naskh nuqta, not a circle. */
export function nuqta(cx: number, cy: number, r: number): string {
  return diamond(cx, cy, r);
}

/** Lozenge aligned with the nib. `along` and `across` are centre-to-vertex. */
export function nibLozenge(cx: number, cy: number, along: number, across: number): string {
  const e = QATT_EDGE;
  const a = QATT_ACROSS;
  return polyPath([
    { x: cx + e.x * along, y: cy + e.y * along },
    { x: cx + a.x * across, y: cy + a.y * across },
    { x: cx - e.x * along, y: cy - e.y * along },
    { x: cx - a.x * across, y: cy - a.y * across },
  ]);
}

/**
 * Oval with the same axes as `nibLozenge`. Four quarter ellipses: a semicircle
 * large-arc flag is ambiguous once the coordinates are rounded, and that
 * ambiguity kinked the note head at the 16 master.
 */
function n3(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

export function nibOval(cx: number, cy: number, along: number, across: number): string {
  const at = (th: number) => {
    const x = along * Math.cos(th);
    const y = across * Math.sin(th);
    return {
      x: cx + QATT_EDGE.x * x + QATT_ACROSS.x * y,
      y: cy + QATT_EDGE.y * x + QATT_ACROSS.y * y,
    };
  };
  const q = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map(at);
  const p = (pt: Pt) => `${n3(pt.x)} ${n3(pt.y)}`;
  // Sweep 1 follows increasing θ, which is clockwise on screen (y grows down).
  return `M${p(q[0]!)}A${n3(along)} ${n3(across)} ${n3(QATT)} 0 1 ${p(q[1]!)}A${n3(along)} ${n3(across)} ${n3(QATT)} 0 1 ${p(q[2]!)}A${n3(along)} ${n3(across)} ${n3(QATT)} 0 1 ${p(q[3]!)}A${n3(along)} ${n3(across)} ${n3(QATT)} 0 1 ${p(q[0]!)}Z`;
}

/** Solid bar. Both ends are the nib edge, so the bar is a parallelogram. */
export function nibSlab(x: number, y: number, w: number, h: number): string {
  const dy = w * Math.tan(QATT_RAD);
  return polyPath([
    { x, y },
    { x: x + w, y: y + dy },
    { x: x + w, y: y + h + dy },
    { x, y: y + h },
  ]);
}

/** Sample of a circular arc. Angle 0 is +x, positive sweeps toward +y. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

/** Sample of a quadratic bezier. */
export function quadPoints(p0: Pt, p1: Pt, p2: Pt, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return pts;
}

function add(p: Pt, q: Pt): Pt {
  return { x: p.x + q.x, y: p.y + q.y };
}

function polyPath(pts: Pt[]): string {
  const clean = dedupe(pts);
  if (clean.length < 3) return '';
  let d = `M${n(clean[0]!.x)} ${n(clean[0]!.y)}`;
  for (let i = 1; i < clean.length; i++) d += `L${n(clean[i]!.x)} ${n(clean[i]!.y)}`;
  return d + 'Z';
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.02) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0]!.x - out[out.length - 1]!.x, out[0]!.y - out[out.length - 1]!.y) <= 0.02) {
    out.pop();
  }
  return out;
}

/** Nib rectangle centred on the origin, CCW in mathematical order. */
function nibShape(nib: Nib): Pt[] {
  const hx = QATT_EDGE.x * (nib.broad / 2);
  const hy = QATT_EDGE.y * (nib.broad / 2);
  const tx = QATT_ACROSS.x * (nib.hair / 2);
  const ty = QATT_ACROSS.y * (nib.hair / 2);
  return [
    { x: hx + tx, y: hy + ty },
    { x: -hx + tx, y: -hy + ty },
    { x: -hx - tx, y: -hy - ty },
    { x: hx - tx, y: hy - ty },
  ];
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mul(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

function unitVec(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function far(a: Pt, b: Pt): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > 0.03;
}

/** Left-hand normal. Y grows downward, so a stroke to the right has its left side up. */
function port(t: Pt): Pt {
  return { x: t.y, y: -t.x };
}

function supportIndex(verts: Pt[], dir: Pt): number {
  let best = 0;
  let bestD = -Infinity;
  for (let i = 0; i < verts.length; i++) {
    const d = verts[i]!.x * dir.x + verts[i]!.y * dir.y;
    if (d > bestD + 1e-9) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Boundary walk from `from` to `to`, not including `from`. `ccw` follows mathematical order. */
function walkVerts(verts: Pt[], from: number, to: number, ccw: boolean): Pt[] {
  const n = verts.length;
  if (from === to) return [];
  const out: Pt[] = [];
  let i = from;
  for (let guard = 0; guard < n; guard++) {
    i = ccw ? (i + 1) % n : (i - 1 + n) % n;
    out.push(verts[i]!);
    if (i === to) return out;
  }
  return out;
}

/**
 * Nib vertices as the outward normal turns from `from` to `to` the short way.
 * The arrival vertex is included. The start vertex is not.
 */
function roll(verts: Pt[], from: Pt, to: Pt, at: Pt): Pt[] {
  const a0 = Math.atan2(from.y, from.x);
  let delta = Math.atan2(to.y, to.x) - a0;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  if (Math.abs(delta) < 1e-3) return [];
  const steps = Math.max(3, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
  const out: Pt[] = [];
  let last = supportIndex(verts, from);
  for (let s = 1; s <= steps; s++) {
    const ang = a0 + (delta * s) / steps;
    const idx = supportIndex(verts, { x: Math.cos(ang), y: Math.sin(ang) });
    if (idx === last) continue;
    for (const v of walkVerts(verts, last, idx, delta > 0)) out.push(add(v, at));
    last = idx;
  }
  return out;
}

/** The cap is the nib chain from `fromN` to `toN` that faces `via`. */
function capChain(verts: Pt[], fromN: Pt, toN: Pt, via: Pt, at: Pt): Pt[] {
  const i0 = supportIndex(verts, fromN);
  const i1 = supportIndex(verts, toN);
  const score = (chain: Pt[]) => {
    let m = verts[i0]!.x * via.x + verts[i0]!.y * via.y;
    for (const v of chain) m = Math.max(m, v.x * via.x + v.y * via.y);
    return m;
  };
  const cw = walkVerts(verts, i0, i1, false);
  const ccw = walkVerts(verts, i0, i1, true);
  const chosen = score(ccw) >= score(cw) ? ccw : cw;
  return chosen.map((v) => add(v, at));
}

function pushFar(out: Pt[], p: Pt): void {
  const prev = out[out.length - 1];
  if (!prev || far(prev, p)) out.push(p);
}

function sidePoint(verts: Pt[], at: Pt, tangent: Pt, side: 1 | -1): Pt {
  return add(verts[supportIndex(verts, mul(port(tangent), side))]!, at);
}

/** One side of a sweep. `side` 1 is the left of the direction of travel. */
function offsetSide(pts: Pt[], segs: Pt[], verts: Pt[], side: 1 | -1, closed: boolean): Pt[] {
  const chain: Pt[] = [];
  const count = segs.length;
  if (!closed) chain.push(sidePoint(verts, pts[0]!, segs[0]!, side));
  for (let i = 0; i < count; i++) {
    const next = closed ? (i + 1) % count : i + 1;
    pushFar(chain, sidePoint(verts, pts[next]!, segs[i]!, side));
    if (closed || i + 1 < count) {
      const n1 = mul(port(segs[i]!), side);
      const n2 = mul(port(segs[next % count]!), side);
      for (const p of roll(verts, n1, n2, pts[next]!)) pushFar(chain, p);
    }
  }
  if (chain.length > 1 && !far(chain[0]!, chain[chain.length - 1]!)) chain.pop();
  return chain;
}

function tangentsOf(pts: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) out.push(unitVec(sub(pts[(i + 1) % pts.length]!, pts[i]!)));
  return out;
}

function usablePoints(points: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || far(prev, p)) out.push(p);
  }
  if (closed && out.length > 2 && !far(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

function shoelace(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Clockwise-on-screen is the positive shoelace here, and SVG fills it. */
function wind(pts: Pt[], positive: boolean): Pt[] {
  if (pts.length < 3) return pts;
  const pos = shoelace(pts) > 0;
  return pos === positive ? pts : [...pts].reverse();
}

/**
 * Grid step for a master drawn at `px` CSS pixels on the 24 board.
 * An integer step is one CSS pixel, so the same edge is whole device
 * pixels at both @2x and @3x.
 */
export function pixelUnit(px: number): number {
  return px > 0 ? 24 / px : 0;
}

function snapTo(v: number, unit: number): number {
  return Math.round(v / unit) * unit;
}

/** Place a stroke so both edges land on the CSS-pixel grid. */
function snapCenter(center: number, extent: number, unit: number): number {
  const edge = snapTo(center - extent / 2, unit);
  return edge + extent / 2;
}

const SIN35 = Math.sin(QATT_RAD);
const COS35 = Math.cos(QATT_RAD);

function extents(nib: Nib): { h: number; v: number } {
  return {
    h: nib.broad * SIN35 + nib.hair * COS35,
    v: nib.broad * COS35 + nib.hair * SIN35,
  };
}

/**
 * Round the nib so a horizontal run and a vertical run are whole CSS pixels.
 * The 35° corner stays. When the pair cannot be built at this angle without
 * a hair under one pixel, the pen scales uniformly onto the horizontal pixel
 * and the contrast ratio is kept.
 */
function hintNib(nib: Nib, unit: number): Nib {
  if (unit <= 0) return nib;
  const { h, v } = extents(nib);
  const lighter = (css: number) => {
    const down = Math.max(1, Math.floor(css + 1e-6));
    // Prefer the lighter whole pixel. A stem that rounds up looks heavy at 20–24.
    return css - down <= 0.82 ? down : Math.ceil(css - 1e-6);
  };
  const hs = lighter(h / unit);
  const vs = lighter(v / unit);
  const den = COS35 * COS35 - SIN35 * SIN35;
  const hair = ((hs * COS35 - vs * SIN35) / den) * unit;
  const broad = ((vs * COS35 - hs * SIN35) / den) * unit;
  if (hair < unit * 0.9 || broad < unit * 0.9) {
    // 35° cannot put two different whole-pixel widths on the axes without a
    // hair under one pixel. Keep the contrast and land the horizontal run;
    // `snapAxisRuns` then pulls the other edge onto the grid.
    const k = (hs * unit) / h;
    return { broad: nib.broad * k, hair: nib.hair * k };
  }
  return { broad, hair };
}

/**
 * Move long axis-aligned edges onto the CSS-pixel grid.
 * A 35° nib's horizontal and vertical projections differ by a fraction of a
 * pixel, so one edge of the sweep is already on the grid and the other is
 * not. The diagonal caps stay where the pen put them.
 */
function snapAxisRuns(pts: Pt[], unit: number): Pt[] {
  if (unit <= 0 || pts.length < 3) return pts;
  const n = pts.length;
  const out = pts.map((p) => ({ ...p }));
  for (const axis of ['y', 'x'] as const) {
    const other = axis === 'y' ? 'x' : 'y';
    const used = new Array<boolean>(n).fill(false);
    for (let s = 0; s < n; s++) {
      if (used[s]) continue;
      const run = [s];
      used[s] = true;
      for (let step = 1; step < n; step++) {
        const i = (s + step) % n;
        if (used[i]) break;
        const prev = out[run[run.length - 1]!]!;
        const cur = out[i]!;
        const dAxis = Math.abs(cur[axis] - prev[axis]);
        const dOther = Math.abs(cur[other] - prev[other]);
        if (dAxis <= 0.28 && dOther > dAxis) {
          run.push(i);
          used[i] = true;
        } else break;
      }
      const span = Math.abs(out[run[run.length - 1]!]![other] - out[run[0]!]![other]);
      let lo = Infinity;
      let hi = -Infinity;
      for (const i of run) {
        lo = Math.min(lo, out[i]![axis]);
        hi = Math.max(hi, out[i]![axis]);
      }
      // A real stem is already straight. A curve drifts, and snapping it
      // would flatten a valley or a corner into a step.
      if (run.length < 2 || span < unit * 1.15 || hi - lo > 0.4) continue;
      const avg = run.reduce((sum, i) => sum + out[i]![axis], 0) / run.length;
      const target = snapTo(avg, unit);
      for (const i of run) out[i]![axis] = target;
    }
  }
  return out;
}

function alignOpen(pts: Pt[], nib: Nib, unit: number): Pt[] {
  if (unit <= 0 || pts.length < 2) return pts;
  const { h, v } = extents(nib);
  const out = pts.map((p) => ({ ...p }));
  let axis = false;
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < unit * 0.75) continue;
    if (Math.abs(dy) < 0.16 && Math.abs(dx) > len * 0.94) {
      const y = snapCenter((a.y + b.y) / 2, h, unit);
      a.y = y;
      b.y = y;
      axis = true;
    } else if (Math.abs(dx) < 0.16 && Math.abs(dy) > len * 0.94) {
      const x = snapCenter((a.x + b.x) / 2, v, unit);
      a.x = x;
      b.x = x;
      axis = true;
    }
  }
  // A chevron has no stem to phase. Landing its joints on the pixel grid
  // keeps the diagonal from crawling between pixels.
  if (!axis && out.length <= 6) return out.map((p) => ({ x: snapTo(p.x, unit), y: snapTo(p.y, unit) }));
  return out;
}

/** Snap long straight runs of a plate so the frame sits on the pixel grid. Curves are left alone. */
function alignLoop(pts: Pt[], nib: Nib, unit: number): Pt[] {
  if (unit <= 0 || pts.length < 4) return pts;
  const { h, v } = extents(nib);
  const out = pts.map((p) => ({ ...p }));
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < unit * 1.4) continue;
    if (Math.abs(dy) < 0.16 && Math.abs(dx) > len * 0.94) {
      const y = snapCenter((a.y + b.y) / 2, h, unit);
      a.y = y;
      b.y = y;
    } else if (Math.abs(dx) < 0.16 && Math.abs(dy) > len * 0.94) {
      const x = snapCenter((a.x + b.x) / 2, v, unit);
      a.x = x;
      b.x = x;
    }
  }
  return out;
}

/**
 * One clean outline of the nib swept along `points`.
 * Joins are the pen rolling onto its corner. Caps are the nib edge itself.
 * `unit` snaps stems onto the CSS-pixel grid of that master. 0 leaves the pen raw.
 */
function sweep(points: Pt[], nib: Nib, closed: boolean, unit: number): Pt[][] {
  const hinted = hintNib(nib, unit);
  const src = usablePoints(points, closed);
  if (src.length < (closed ? 3 : 2)) return [];
  const placed = closed ? alignLoop(src, hinted, unit) : alignOpen(src, hinted, unit);
  const segs = tangentsOf(placed, closed);
  if (segs.length === 0) return [];
  const verts = nibShape(hinted);
  const left = offsetSide(placed, segs, verts, 1, closed);
  const right = offsetSide(placed, segs, verts, -1, closed);
  if (left.length < 2 || right.length < 2) return [];
  if (closed) {
    const outer = wind(left, true);
    const inner = wind(right, false);
    const hole = Math.abs(shoelace(outer)) >= Math.abs(shoelace(inner)) ? inner : wind(left, false);
    const rim = Math.abs(shoelace(outer)) >= Math.abs(shoelace(inner)) ? outer : wind(right, true);
    return [snapAxisRuns(rim, unit), snapAxisRuns(hole, unit)];
  }
  const lastT = segs[segs.length - 1]!;
  const firstT = segs[0]!;
  const endCap = capChain(verts, port(lastT), mul(port(lastT), -1), lastT, placed[placed.length - 1]!);
  const startCap = capChain(verts, mul(port(firstT), -1), port(firstT), mul(firstT, -1), placed[0]!);
  const ring: Pt[] = [];
  for (const p of left) pushFar(ring, p);
  for (const p of endCap) pushFar(ring, p);
  for (let i = right.length - 1; i >= 0; i--) pushFar(ring, right[i]!);
  for (const p of startCap) pushFar(ring, p);
  if (ring.length > 1 && !far(ring[0]!, ring[ring.length - 1]!)) ring.pop();
  return [wind(snapAxisRuns(ring, unit), true)];
}

/**
 * CSS-pixel step while a master is built. `glyphAt` sets it.
 * The signature diagram leaves it at 0 and draws the raw pen.
 */
let builtUnit = 0;

export function beginGlyph(unit: number): void {
  builtUnit = unit;
}

export function endGlyph(): void {
  builtUnit = 0;
}

/**
 * Open stroke as one filled outline.
 * The nib rolls through the corner, so a cut meets the next run on a pen edge
 * instead of a stack of segment hulls.
 */
export function qalamStroke(points: Pt[], nib: Nib, unit = builtUnit): string {
  const parts = sweep(points, nib, false, unit);
  return parts.map((pts) => polyPath(pts)).join('');
}

/**
 * Closed centreline as one ring. Outer and inner have opposite winding,
 * so a nonzero fill leaves the counter open without a mask.
 */
export function qalamLoop(points: Pt[], nib: Nib, unit = builtUnit): string {
  const parts = sweep(points, nib, true, unit);
  return parts.map((pts) => polyPath(pts)).join('');
}

/**
 * Closed frame of constant width. The 35° cuts live in `pts` as straight
 * edges. A nib sweep along those edges folds, because the cut is already
 * the pen's flat; this keeps the cut a single clean line.
 * `stroke` and `unit` are grid units. `unit` is one CSS pixel.
 */
export function frameRing(pts: Pt[], stroke: number, unit: number): string {
  if (pts.length < 3 || stroke <= 0) return '';
  const half = stroke / 2;
  const src = snapFrame(simplifyFrame(dedupe(pts)), half, unit);
  const outer = dropSpikes(offsetPoly(src, half));
  const inner = dropSpikes(offsetPoly(src, -half));
  if (outer.length < 3 || inner.length < 3) return '';
  return polyPath(wind(outer, true)) + polyPath(wind(inner, false));
}

/**
 * A 35° cut is already a straight edge. The parallel offset still leaves a
 * hairpin shorter than a pixel where the miter folds. That nick reads as a
 * defect, so the vertex goes and the two neighbours meet.
 */
function dropSpikes(pts: Pt[]): Pt[] {
  let cur = dedupe(pts);
  for (let pass = 0; pass < 4 && cur.length >= 4; pass++) {
    const next: Pt[] = [];
    const n = cur.length;
    let dropped = false;
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n]!;
      const b = cur[i]!;
      const c = cur[(i + 1) % n]!;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      const lab = Math.hypot(abx, aby);
      const lbc = Math.hypot(bcx, bcy);
      const dot = lab > 1e-6 && lbc > 1e-6 ? (abx * bcx + aby * bcy) / (lab * lbc) : 1;
      // 132° is about -0.67. Both legs stay under a pixel, so this is a nick.
      const hairpin = dot < -0.66 && lab < 0.75 && lbc < 0.75;
      const spur = Math.min(lab, lbc) < 0.14 && Math.max(lab, lbc) < 1.2 && dot < 0.2;
      if (hairpin || spur) {
        dropped = true;
        continue;
      }
      next.push(b);
    }
    if (!dropped || next.length < 3) break;
    cur = dedupe(next);
  }
  return cur;
}

/** Drop samples that sit on a straight run so the offset does not zigzag. */
function simplifyFrame(pts: Pt[]): Pt[] {
  if (pts.length < 4) return pts;
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n]!;
    const b = pts[i]!;
    const c = pts[(i + 1) % n]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const lab = Math.hypot(abx, aby) || 1;
    const lbc = Math.hypot(bcx, bcy) || 1;
    const dot = (abx * bcx + aby * bcy) / (lab * lbc);
    if (dot > 0.992 && lab < 1.1 && lbc < 1.1) continue;
    out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

/** Put long axis edges so both sides of a `stroke`-wide frame land on pixels. */
function snapFrame(pts: Pt[], half: number, unit: number): Pt[] {
  if (unit <= 0 || pts.length < 4) return pts;
  const out = pts.map((p) => ({ ...p }));
  const n = out.length;
  const stroke = half * 2;
  for (let i = 0; i < n; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < unit * 1.4) continue;
    if (Math.abs(dy) < 0.2 && Math.abs(dx) > len * 0.94) {
      const y = snapCenter((a.y + b.y) / 2, stroke, unit);
      a.y = y;
      b.y = y;
    } else if (Math.abs(dx) < 0.2 && Math.abs(dy) > len * 0.94) {
      const x = snapCenter((a.x + b.x) / 2, stroke, unit);
      a.x = x;
      b.x = x;
    }
  }
  return out;
}

/** Parallel curve. Positive `dist` follows the left normal (outward for a clockwise plate). */
function offsetPoly(pts: Pt[], dist: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const t0 = unitVec(sub(cur, prev));
    const t1 = unitVec(sub(next, cur));
    const n0 = port(t0);
    const n1 = port(t1);
    let nx = n0.x + n1.x;
    let ny = n0.y + n1.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const dot = nx * n0.x + ny * n0.y;
    const raw = Math.abs(dot) > 0.35 ? dist / dot : dist;
    const cap = Math.abs(dist) * 1.8;
    const m = Math.max(-cap, Math.min(cap, raw));
    out.push({ x: cur.x + nx * m, y: cur.y + ny * m });
  }
  return dedupe(out);
}

/** Outer silhouette of a closed nib stroke, filled solid. Play option C uses it. */
export function qalamOuter(points: Pt[], nib: Nib, unit = builtUnit): string {
  const parts = sweep(points, nib, true, unit);
  return parts[0] ? polyPath(parts[0]) : '';
}

/** Closed polygon path. Fill with nonzero. */
export function closedPath(pts: Pt[]): string {
  return polyPath(pts);
}

/**
 * Rectangle with the nib taken off the top-right and the bottom-left.
 * Those are the two corners a 35° edge can cut. The other corners stay soft.
 */
export function nibPlate(x: number, y: number, w: number, h: number, cut: number, radius: number): Pt[] {
  const dx = QATT_EDGE.x * cut;
  const dy = QATT_EDGE.y * cut;
  const right = x + w;
  const bottom = y + h;
  return roundPolyPoints(
    [
      { x, y },
      { x: right - dx, y },
      { x: right, y: y + dy },
      { x: right, y: bottom },
      { x: x + dx, y: bottom },
      { x, y: bottom - dy },
    ],
    [radius, 0, 0, radius, 0, 0],
    4,
  );
}

function vertsOf(nib: Nib, unit: number): Pt[] {
  return nibShape(hintNib(nib, unit));
}

/** Pull a long axis-aligned edge onto the CSS pixel grid before a nib ring is built. */
function snapAxisSource(pts: Pt[], unit: number): Pt[] {
  if (unit <= 0 || pts.length < 3) return pts;
  const out = pts.map((p) => ({ ...p }));
  const nPts = out.length;
  for (let i = 0; i < nPts; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % nPts]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = Math.hypot(dx, dy);
    if (span < unit * 1.4) continue;
    if (Math.abs(dy) < 0.2 && Math.abs(dx) > span * 0.94) {
      const y = snapTo((a.y + b.y) / 2, unit);
      a.y = y;
      b.y = y;
    } else if (Math.abs(dx) < 0.2 && Math.abs(dy) > span * 0.94) {
      const x = snapTo((a.x + b.x) / 2, unit);
      a.x = x;
      b.x = x;
    }
  }
  return out;
}

/** Closed nib ring of a circle. True arcs, joined by the nib edges on a shared tangent. */
export function qalamCircle(cx: number, cy: number, r: number, nib: Nib, unit = builtUnit): string {
  return circleRing(cx, cy, r, vertsOf(nib, unit));
}

/** Open nib stroke along a circular arc. The caps are the same nib edges as a straight stroke. */
export function qalamArc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  nib: Nib,
  unit = builtUnit,
): string {
  return arcStroke(cx, cy, r, a0, a1, vertsOf(nib, unit));
}

/** Open nib stroke along one quadratic. The curve is translated, not resampled into lines. */
export function qalamQuad(p0: Pt, p1: Pt, p2: Pt, nib: Nib, unit = builtUnit): string {
  return quadStroke(p0, p1, p2, vertsOf(nib, unit));
}

/**
 * Closed nib ring around a rounded polygon.
 * Axis-aligned edges snap onto the CSS pixel grid first. Curves stay quadratics.
 */
export function qalamRoundLoop(pts: Pt[], radius: number | number[], nib: Nib, unit = builtUnit): string {
  return roundLoop(snapAxisSource(pts, unit), radius, vertsOf(nib, unit));
}

/**
 * Constant-width frame and the plate inside it.
 * `stroke` and `unit` are grid units. `unit` 0 skips the pixel snap.
 * Rounded corners are cubics within 0.015 of the true parallel curve.
 */
export function framePlate(
  pts: Pt[],
  radius: number | number[],
  stroke: number,
  unit = builtUnit,
): { ring: string; plate: string } {
  return frameOf(pts, radius, stroke, unit);
}
