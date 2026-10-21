/**
 * Smooth outlines for the Qalam pen.
 *
 * A circle or a circular arc is exact SVG arcs. A nib edge inserted where
 * the normal sweeps across a flat is a straight line, and it meets the arc
 * on a shared tangent. A quadratic the nib follows is the same quadratic,
 * translated by the support vertex, split where the support changes.
 * A rounded corner of a frame is a circular fillet, so its parallel is the
 * same arc at a new radius and the join stays tangent. A quadratic fillet
 * is tighter than that circle and the inner parallel folds.
 * FIT_TOL is under 0.02 grid units — one grid unit is one pixel on the
 * 24 master.
 *
 * A join is a corner only where the centreline itself corners, or where the
 * open stroke ends on a nib vertex. Those are the deliberate cuts.
 */

export const FIT_TOL = 0.015;

export type Pt = { x: number; y: number };

export type Cmd =
  | { op: 'L'; to: Pt }
  | { op: 'Q'; c: Pt; to: Pt }
  | { op: 'C'; c1: Pt; c2: Pt; to: Pt }
  | { op: 'A'; rx: number; ry: number; rot: number; large: 0 | 1; sweep: 0 | 1; to: Pt };

export type Outline = { start: Pt; cmds: Cmd[]; closed: boolean; swallowed?: boolean };

type Piece =
  | { k: 'L'; a: Pt; b: Pt }
  | { k: 'Q'; a: Pt; c: Pt; b: Pt }
  | { k: 'A'; c: Pt; r: number; a0: number; a1: number; sweep: 1 | -1 };

const CORNER = (18 * Math.PI) / 180;

function fmt(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mul(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

function len(a: Pt): number {
  return Math.hypot(a.x, a.y);
}

function unit(a: Pt): Pt {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
}

function neg(a: Pt): Pt {
  return { x: -a.x, y: -a.y };
}

/** Left-hand normal. Y grows downward, so a stroke to the right has its left side up. */
function port(t: Pt): Pt {
  return { x: t.y, y: -t.x };
}

function far(a: Pt, b: Pt): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > 0.012;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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

export function outlinePath(o: Outline): string {
  if (o.cmds.length === 0) return '';
  let d = `M${fmt(o.start.x)} ${fmt(o.start.y)}`;
  let cursor = o.start;
  for (const cmd of o.cmds) {
    if (!far(cursor, cmd.to) && cmd.op === 'L') continue;
    if (cmd.op === 'L') d += `L${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`;
    else if (cmd.op === 'Q') d += `Q${fmt(cmd.c.x)} ${fmt(cmd.c.y)} ${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`;
    else if (cmd.op === 'C') {
      d += `C${fmt(cmd.c1.x)} ${fmt(cmd.c1.y)} ${fmt(cmd.c2.x)} ${fmt(cmd.c2.y)} ${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`;
    } else {
      d += `A${fmt(cmd.rx)} ${fmt(cmd.ry)} ${fmt(cmd.rot)} ${cmd.large} ${cmd.sweep} ${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`;
    }
    cursor = cmd.to;
  }
  if (o.closed) d += 'Z';
  return d;
}

function endOf(o: Outline): Pt {
  return o.cmds.length ? o.cmds[o.cmds.length - 1]!.to : o.start;
}

export function reverseOutline(o: Outline): Outline {
  const before: Pt[] = [];
  let cursor = o.start;
  for (const cmd of o.cmds) {
    before.push(cursor);
    cursor = cmd.to;
  }
  const cmds: Cmd[] = [];
  for (let i = o.cmds.length - 1; i >= 0; i--) {
    const cmd = o.cmds[i]!;
    const to = before[i]!;
    if (cmd.op === 'L') cmds.push({ op: 'L', to });
    else if (cmd.op === 'Q') cmds.push({ op: 'Q', c: cmd.c, to });
    else if (cmd.op === 'C') cmds.push({ op: 'C', c1: cmd.c2, c2: cmd.c1, to });
    else cmds.push({ op: 'A', rx: cmd.rx, ry: cmd.ry, rot: cmd.rot, large: cmd.large, sweep: cmd.sweep ? 0 : 1, to });
  }
  return { start: cursor, cmds, closed: o.closed };
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

/** Nib vertices from `fromDir` to `toDir`, not including the start. The short rotation. */
function nibWalk(verts: Pt[], fromDir: Pt, toDir: Pt): Pt[] {
  const a0 = Math.atan2(fromDir.y, fromDir.x);
  let delta = Math.atan2(toDir.y, toDir.x) - a0;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  if (Math.abs(delta) < 1e-3) return [];
  const i0 = supportIndex(verts, fromDir);
  const i1 = supportIndex(verts, toDir);
  return walkVerts(verts, i0, i1, delta > 0);
}

/** The cap chain from `fromDir` to `toDir` that faces `via`. Includes the arrival vertex only. */
function capVerts(verts: Pt[], fromDir: Pt, toDir: Pt, via: Pt): Pt[] {
  const i0 = supportIndex(verts, fromDir);
  const i1 = supportIndex(verts, toDir);
  const score = (chain: Pt[]) => {
    let m = verts[i0]!.x * via.x + verts[i0]!.y * via.y;
    for (const v of chain) m = Math.max(m, v.x * via.x + v.y * via.y);
    return m;
  };
  const cw = walkVerts(verts, i0, i1, false);
  const ccw = walkVerts(verts, i0, i1, true);
  return score(ccw) >= score(cw) ? ccw : cw;
}

function pushLine(cmds: Cmd[], cursor: Pt, p: Pt): Pt {
  if (far(cursor, p)) cmds.push({ op: 'L', to: p });
  return p;
}

/* ------------------------------------------------------------------ */
/* Cubic fit                                                          */
/* ------------------------------------------------------------------ */

function bez(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function chordParams(pts: Pt[]): number[] {
  const d = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    d.push(total);
  }
  if (total < 1e-9) return pts.map((_, i) => (pts.length === 1 ? 0 : i / (pts.length - 1)));
  return d.map((v) => v / total);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function maxChordDist(pts: Pt[]): number {
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  let m = 0;
  for (let i = 1; i < pts.length - 1; i++) m = Math.max(m, distToSegment(pts[i]!, a, b));
  return m;
}

function turnOf(a: Pt, b: Pt): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const cross = a.x * b.y - a.y * b.x;
  const d = a.x * b.x + a.y * b.y;
  return Math.abs(Math.atan2(cross, d));
}

/** Index of an interior deliberate corner, or -1. */
function sharpIndex(pts: Pt[]): number {
  let best = -1;
  let bestA = CORNER;
  for (let i = 1; i < pts.length - 1; i++) {
    const v1 = sub(pts[i]!, pts[i - 1]!);
    const v2 = sub(pts[i + 1]!, pts[i]!);
    const a = turnOf(v1, v2);
    if (a > bestA) {
      bestA = a;
      best = i;
    }
  }
  return best;
}

function generateBezier(pts: Pt[], u: number[], t1: Pt, t2: Pt): { c1: Pt; c2: Pt } {
  const p0 = pts[0]!;
  const p3 = pts[pts.length - 1]!;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i]!;
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a1x = t1.x * b1;
    const a1y = t1.y * b1;
    const a2x = t2.x * b2;
    const a2y = t2.y * b2;
    c00 += a1x * a1x + a1y * a1y;
    c01 += a1x * a2x + a1y * a2y;
    c11 += a2x * a2x + a2y * a2y;
    const tmpx = pts[i]!.x - (b0 + b1) * p0.x - (b2 + b3) * p3.x;
    const tmpy = pts[i]!.y - (b0 + b1) * p0.y - (b2 + b3) * p3.y;
    x0 += a1x * tmpx + a1y * tmpy;
    x1 += a2x * tmpx + a2y * tmpy;
  }
  const det = c00 * c11 - c01 * c01;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y) || 1;
  let a1: number;
  let a2: number;
  if (Math.abs(det) < 1e-12 * chord) {
    a1 = a2 = chord / 3;
  } else {
    a1 = (x0 * c11 - x1 * c01) / det;
    a2 = (c00 * x1 - c01 * x0) / det;
  }
  if (!(a1 > 1e-4) || !(a2 > 1e-4)) {
    a1 = chord / 3;
    a2 = chord / 3;
  }
  return { c1: add(p0, mul(t1, a1)), c2: add(p3, mul(t2, a2)) };
}

function fitError(pts: Pt[], u: number[], p0: Pt, c1: Pt, c2: Pt, p3: Pt): { err: number; index: number } {
  let err = 0;
  let index = Math.max(1, Math.floor(pts.length / 2));
  for (let i = 1; i < pts.length - 1; i++) {
    const p = bez(u[i]!, p0, c1, c2, p3);
    const d = Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y);
    if (d > err) {
      err = d;
      index = i;
    }
  }
  // Catch a cubic that passes the samples and bows between them.
  for (let s = 1; s < 12; s++) {
    const t = s / 12;
    const p = bez(t, p0, c1, c2, p3);
    let nearest = Infinity;
    for (let i = 0; i < pts.length - 1; i++) nearest = Math.min(nearest, distToSegment(p, pts[i]!, pts[i + 1]!));
    if (nearest > err) {
      err = nearest;
      index = Math.max(1, Math.min(pts.length - 2, Math.round(t * (pts.length - 1))));
    }
  }
  return { err, index };
}

function localForward(pts: Pt[], i: number): Pt {
  const a = pts[Math.max(0, i - 1)]!;
  const b = pts[Math.min(pts.length - 1, i + 1)]!;
  return unit(sub(b, a));
}

/** Degrees between two directions. */
function angDeg(a: Pt, b: Pt): number {
  return (turnOf(a, b) * 180) / Math.PI;
}

/**
 * A line only when both end tangents already lie on the chord.
 * A span can sit within `tol` of its chord and still arrive at 30° or more;
 * collapsing that span to a line is what kinked the rounded frames.
 * The replacement cubic keeps the tangents and bows by at most `tol`.
 */
function honoured(p0: Pt, p3: Pt, t1: Pt, t2back: Pt, tol: number): Cmd[] {
  const chord = sub(p3, p0);
  const chordLen = len(chord);
  if (chordLen < 1e-9) return [];
  const chordU = unit(chord);
  const startAng = angDeg(t1, chordU);
  const endAng = angDeg(neg(t2back), chordU);
  if (startAng <= 2 && endAng <= 2) return [{ op: 'L', to: p3 }];
  // A cubic handle's bow peaks near 0.45 of its offset from the chord.
  const limit = (ang: number) => {
    const s = Math.sin((ang * Math.PI) / 180);
    if (s < 0.035) return chordLen / 3;
    return Math.min(chordLen / 3, tol / (0.45 * s));
  };
  return [{
    op: 'C',
    c1: add(p0, mul(unit(t1), Math.max(limit(startAng), 1e-4))),
    c2: add(p3, mul(unit(t2back), Math.max(limit(endAng), 1e-4))),
    to: p3,
  }];
}

/**
 * Fit an open chain. `tan0` points along the curve at the start.
 * `tan1back` points back into the curve at the end (Schneider's right tangent).
 * Both may be null; then the chord of the samples is used.
 */
export function fitOpen(pts: Pt[], tan0: Pt | null, tan1back: Pt | null, tol = FIT_TOL, depth = 0): Cmd[] {
  if (pts.length < 2) return [];
  const p0 = pts[0]!;
  const p3 = pts[pts.length - 1]!;
  if (!far(p0, p3) && maxChordDist(pts) <= tol) return [];
  const t1 = tan0 && len(tan0) > 1e-9 ? unit(tan0) : localForward(pts, 0);
  const t2 = tan1back && len(tan1back) > 1e-9 ? unit(tan1back) : neg(localForward(pts, pts.length - 1));
  if (pts.length === 2 || depth > 16) return far(p0, p3) ? honoured(p0, p3, t1, t2, tol) : [];

  const corner = sharpIndex(pts);
  if (corner > 0) {
    const into = unit(sub(pts[corner]!, pts[corner - 1]!));
    const out = unit(sub(pts[corner + 1]!, pts[corner]!));
    return [
      ...fitOpen(pts.slice(0, corner + 1), t1, neg(into), tol, depth + 1),
      ...fitOpen(pts.slice(corner), out, t2, tol, depth + 1),
    ];
  }

  if (maxChordDist(pts) <= tol) return honoured(p0, p3, t1, t2, tol);

  const u = chordParams(pts);
  const { c1, c2 } = generateBezier(pts, u, t1, t2);
  const { err, index } = fitError(pts, u, p0, c1, c2, p3);
  if (err <= tol) {
    if (distToSegment(c1, p0, p3) <= tol && distToSegment(c2, p0, p3) <= tol) return honoured(p0, p3, t1, t2, tol);
    return [{ op: 'C', c1, c2, to: p3 }];
  }
  let at = index;
  if (at <= 0 || at >= pts.length - 1) at = Math.floor(pts.length / 2);
  const shared = localForward(pts, at);
  return [
    ...fitOpen(pts.slice(0, at + 1), t1, neg(shared), tol, depth + 1),
    ...fitOpen(pts.slice(at), shared, t2, tol, depth + 1),
  ];
}

/* ------------------------------------------------------------------ */
/* Circles and arcs                                                    */
/* ------------------------------------------------------------------ */

type Sector = { a0: number; a1: number; v: number };

function sectorsBetween(verts: Pt[], a0: number, a1: number, inward: boolean): Sector[] {
  const dirAt = (th: number): Pt => {
    const a = inward ? th + Math.PI : th;
    return { x: Math.cos(a), y: Math.sin(a) };
  };
  const span = a1 - a0;
  if (span <= 1e-8) return [];
  const out: Sector[] = [];
  let cursor = a0;
  const step = Math.PI / 360;
  for (let guard = 0; guard < 24 && cursor < a1 - 1e-7; guard++) {
    const v = supportIndex(verts, dirAt(cursor + Math.min(span, 1) * 1e-6));
    let th = cursor + step;
    let crossed = false;
    while (th < a1 - 1e-9) {
      if (supportIndex(verts, dirAt(th)) !== v) {
        crossed = true;
        break;
      }
      th += step;
    }
    if (!crossed) {
      out.push({ a0: cursor, a1, v });
      break;
    }
    let lo = Math.max(cursor, th - step);
    let hi = Math.min(a1, th);
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (supportIndex(verts, dirAt(mid)) === v) lo = mid;
      else hi = mid;
    }
    out.push({ a0: cursor, a1: hi, v });
    cursor = hi;
  }
  return out;
}

/**
 * Where the nib support jumps, the straight edge is the outline only if it
 * continues the arc's tangent. On the inward side that edge falls inside the
 * stroke (a swallowtail). The two arcs meet on the real boundary instead,
 * at the intersection closer to the circle's centre.
 */
function circleHit(c0: Pt, c1: Pt, r: number, prefer: Pt): Pt | null {
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > r * 2 - 1e-9) return null;
  const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
  const mx = (c0.x + c1.x) / 2;
  const my = (c0.y + c1.y) / 2;
  const px = (-dy / d) * h;
  const py = (dx / d) * h;
  const a = { x: mx + px, y: my + py };
  const b = { x: mx - px, y: my - py };
  const da = Math.hypot(a.x - prefer.x, a.y - prefer.y);
  const db = Math.hypot(b.x - prefer.x, b.y - prefer.y);
  return da <= db ? a : b;
}

/**
 * Point on the increasing arc, inside [a0, a1], whose forward tangent
 * passes through `p`. Used to leave a swallowed nib corner along a tangent
 * instead of reversing along the nib edge.
 */
function tangentToward(center: Pt, r: number, p: Pt, a0: number, a1: number): Pt | null {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= r + 1e-4) return null;
  const alpha = Math.atan2(dy, dx);
  const beta = Math.acos(Math.min(1, r / dist));
  let best: { along: number; q: Pt } | null = null;
  for (const theta of [alpha + beta, alpha - beta]) {
    let along = theta - a0;
    while (along < -1e-3) along += Math.PI * 2;
    while (along > Math.PI * 2 - 1e-3) along -= Math.PI * 2;
    if (along > a1 - a0 + 0.02) continue;
    const th = a0 + along;
    const q = { x: center.x + r * Math.cos(th), y: center.y + r * Math.sin(th) };
    const t = { x: -Math.sin(th), y: Math.cos(th) };
    const toP = { x: p.x - q.x, y: p.y - q.y };
    if (toP.x * t.x + toP.y * t.y <= 1e-6) continue;
    if (!best || along > best.along) best = { along, q };
  }
  return best?.q ?? null;
}

function arcSide(cx: number, cy: number, r: number, a0: number, a1: number, verts: Pt[], inward: boolean, close: boolean): Outline {
  const sectors = sectorsBetween(verts, a0, a1, inward);
  if (sectors.length === 0) return { start: { x: cx, y: cy }, cmds: [], closed: close, swallowed: false };
  const prefer = { x: cx, y: cy };
  // The two offset circles meet at the nib corner only when that point lies on
  // both sectors. An intersection past the arc is not part of this stroke.
  const onSector = (center: Pt, p: Pt, a0s: number, a1s: number): boolean => {
    let d = Math.atan2(p.y - center.y, p.x - center.x) - a0s;
    while (d < -1e-3) d += Math.PI * 2;
    while (d > Math.PI * 2) d -= Math.PI * 2;
    return d <= a1s - a0s + 0.04;
  };
  // A sector whose corner with the previous one closes past the end of this
  // arc lies inside the swallowtail. It is not part of the outline.
  const swallowed = new Set<number>();
  const cuts: (Pt | null)[] = sectors.map((s, i) => {
    const nextI = close ? (i + 1) % sectors.length : i + 1;
    const next = sectors[nextI];
    if (!next) return null;
    const v = verts[s.v]!;
    const w = verts[next.v]!;
    const ang = close && nextI === 0 ? next.a0 : s.a1;
    const from = { x: cx + v.x + r * Math.cos(ang), y: cy + v.y + r * Math.sin(ang) };
    const to = { x: cx + w.x + r * Math.cos(ang), y: cy + w.y + r * Math.sin(ang) };
    const tangent = { x: -Math.sin(ang), y: Math.cos(ang) };
    const line = { x: to.x - from.x, y: to.y - from.y };
    if (line.x * tangent.x + line.y * tangent.y >= 0) return null;
    const c0 = { x: cx + v.x, y: cy + v.y };
    const c1 = { x: cx + w.x, y: cy + w.y };
    const hit = circleHit(c0, c1, r, prefer);
    if (!hit || !onSector(c0, hit, s.a0, s.a1) || !onSector(c1, hit, next.a0, next.a1)) {
      swallowed.add(nextI);
      return null;
    }
    return hit;
  });
  const firstI = sectors.findIndex((_, i) => !swallowed.has(i));
  if (firstI < 0) return { start: { x: cx, y: cy }, cmds: [], closed: close, swallowed: true };
  const first = sectors[firstI]!;
  const v0 = verts[first.v]!;
  const closingCut = close && !swallowed.has(sectors.length - 1) ? cuts[cuts.length - 1] : null;
  const start = closingCut ?? { x: cx + v0.x + r * Math.cos(first.a0), y: cy + v0.y + r * Math.sin(first.a0) };
  const cmds: Cmd[] = [];
  let cursor = start;
  for (let i = 0; i < sectors.length; i++) {
    if (swallowed.has(i)) continue;
    const s = sectors[i]!;
    const v = verts[s.v]!;
    const center = { x: cx + v.x, y: cy + v.y };
    const cut = cuts[i]!;
    const nextI = close ? (i + 1) % sectors.length : i + 1;
    const next = sectors[nextI];
    let bridge: Pt | null = null;
    if (next && swallowed.has(nextI)) {
      let k = nextI;
      for (let guard = 0; guard < sectors.length; guard++) {
        const nxt = close ? (k + 1) % sectors.length : k + 1;
        if (nxt === i || !swallowed.has(nxt)) break;
        k = nxt;
      }
      const last = sectors[k]!;
      const lv = verts[last.v]!;
      bridge = { x: cx + lv.x + r * Math.cos(last.a1), y: cy + lv.y + r * Math.sin(last.a1) };
    }
    let end = cut ?? { x: center.x + r * Math.cos(s.a1), y: center.y + r * Math.sin(s.a1) };
    if (bridge) {
      const q = tangentToward(center, r, bridge, s.a0, s.a1);
      if (q) end = q;
    }
    if (far(cursor, end)) {
      const span = s.a1 - s.a0;
      const sweepOf = (p: Pt) => {
        let delta = Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(cursor.y - center.y, cursor.x - center.x);
        while (delta <= 1e-6) delta += Math.PI * 2;
        while (delta > Math.PI * 2) delta -= Math.PI * 2;
        return delta;
      };
      let delta = sweepOf(end);
      if (delta > Math.PI && span < Math.PI) {
        // A trim behind the cursor would wrap the long way around the circle.
        const natural = { x: center.x + r * Math.cos(s.a1), y: center.y + r * Math.sin(s.a1) };
        const naturalDelta = sweepOf(natural);
        if (naturalDelta <= Math.PI) {
          end = natural;
          delta = naturalDelta;
        } else continue;
      }
      cmds.push({
        op: 'A',
        rx: r,
        ry: r,
        rot: 0,
        large: delta > Math.PI ? 1 : 0,
        sweep: 1,
        to: end,
      });
      cursor = end;
    }
    if (bridge) {
      cursor = pushLine(cmds, cursor, bridge);
      continue;
    }
    if (!next || cut || swallowed.has(nextI)) continue;
    const w = verts[next.v]!;
    const ang = close && i + 1 >= sectors.length ? next.a0 : s.a1;
    const join = { x: cx + w.x + r * Math.cos(ang), y: cy + w.y + r * Math.sin(ang) };
    if (far(cursor, join)) {
      cmds.push({ op: 'L', to: join });
      cursor = join;
    }
  }
  return { start, cmds, closed: close, swallowed: swallowed.size > 0 };
}

/** Closed nib ring around a circle. Outer and inner are true arcs. */
export function circleRing(cx: number, cy: number, r: number, verts: Pt[]): string {
  const outer = arcSide(cx, cy, r, 0, Math.PI * 2, verts, false, true);
  const inner = reverseOutline(arcSide(cx, cy, r, 0, Math.PI * 2, verts, true, true));
  inner.closed = true;
  return outlinePath(outer) + outlinePath(inner);
}

function stitch(left: Outline, endCap: Pt[], right: Outline, startCap: Pt[]): string {
  const cmds: Cmd[] = [...left.cmds];
  let cursor = endOf(left);
  for (const p of endCap) cursor = pushLine(cmds, cursor, p);
  const rev = reverseOutline(right);
  if (far(cursor, rev.start)) cmds.push({ op: 'L', to: rev.start });
  cmds.push(...rev.cmds);
  cursor = endOf({ start: rev.start, cmds: rev.cmds, closed: false });
  for (const p of startCap) cursor = pushLine(cmds, cursor, p);
  if (far(cursor, left.start)) cmds.push({ op: 'L', to: left.start });
  return outlinePath({ start: left.start, cmds, closed: true });
}

/** Open nib stroke along a circular arc. `a0` → `a1` in math angles, y downward. */
export function arcStroke(cx: number, cy: number, r: number, a0: number, a1: number, verts: Pt[]): string {
  const left = arcSide(cx, cy, r, a0, a1, verts, false, false);
  const right = arcSide(cx, cy, r, a0, a1, verts, true, false);
  const t0 = { x: -Math.sin(a0), y: Math.cos(a0) };
  const t1 = { x: -Math.sin(a1), y: Math.cos(a1) };
  const p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
  const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
  const endCap = capVerts(verts, port(t1), neg(port(t1)), t1).map((v) => add(p1, v));
  const startCap = capVerts(verts, neg(port(t0)), port(t0), neg(t0)).map((v) => add(p0, v));
  return stitch(left, endCap, right, startCap);
}

/* ------------------------------------------------------------------ */
/* Quadratics and rounded polygons                                     */
/* ------------------------------------------------------------------ */

function quadAt(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function quadDeriv(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    y: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
  };
}

function splitQuad(p0: Pt, p1: Pt, p2: Pt, t: number): { left: [Pt, Pt, Pt]; right: [Pt, Pt, Pt] } {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(a, b, t);
  return { left: [p0, a, c], right: [c, b, p2] };
}

function subQuad(p0: Pt, p1: Pt, p2: Pt, t0: number, t1: number): [Pt, Pt, Pt] {
  const left = t1 >= 1 - 1e-9 ? [p0, p1, p2] as [Pt, Pt, Pt] : splitQuad(p0, p1, p2, Math.max(t1, 1e-9)).left;
  const u = t1 < 1e-9 ? 0 : t0 / t1;
  if (u <= 1e-9) return left;
  return splitQuad(left[0], left[1], left[2], Math.min(u, 1)).right;
}

type Span = { t0: number; t1: number; v: number };

function quadSpans(p0: Pt, p1: Pt, p2: Pt, verts: Pt[], inward: boolean): Span[] {
  const dirAt = (t: number): Pt => {
    const tan = unit(quadDeriv(p0, p1, p2, t));
    const n = port(tan);
    return inward ? neg(n) : n;
  };
  const out: Span[] = [];
  let cursor = 0;
  const step = 1 / 180;
  for (let guard = 0; guard < 16 && cursor < 1 - 1e-7; guard++) {
    const v = supportIndex(verts, dirAt(Math.min(cursor + 1e-5, 1)));
    let t = cursor + step;
    let crossed = false;
    while (t < 1 - 1e-9) {
      if (supportIndex(verts, dirAt(t)) !== v) {
        crossed = true;
        break;
      }
      t += step;
    }
    if (!crossed) {
      out.push({ t0: cursor, t1: 1, v });
      break;
    }
    let lo = Math.max(cursor, t - step);
    let hi = Math.min(1, t);
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (supportIndex(verts, dirAt(mid)) === v) lo = mid;
      else hi = mid;
    }
    out.push({ t0: cursor, t1: hi, v });
    cursor = hi;
  }
  return out;
}

/**
 * Where two neighbouring offset copies of one quadratic cross.
 * On the inward side the nib edge between them lies inside the stroke.
 * The hit replaces that edge. `null` when the copies do not meet inside
 * the two spans (the edge is then the real, tangent, boundary).
 */
function quadHit(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  t0: number,
  t1: number,
  v: Pt,
  s0: number,
  s1: number,
  w: Pt,
): { t: number; s: number } | null {
  const dx = w.x - v.x;
  const dy = w.y - v.y;
  let bestT = t0;
  let bestS = s0;
  let best = Infinity;
  const score = (t: number, s: number) => {
    const qt = quadAt(p0, p1, p2, t);
    const qs = quadAt(p0, p1, p2, s);
    const ex = qt.x - qs.x - dx;
    const ey = qt.y - qs.y - dy;
    return ex * ex + ey * ey;
  };
  const grid = 14;
  for (let i = 0; i <= grid; i++) {
    const t = t0 + ((t1 - t0) * i) / grid;
    for (let j = 0; j <= grid; j++) {
      const s = s0 + ((s1 - s0) * j) / grid;
      const e = score(t, s);
      if (e < best) {
        best = e;
        bestT = t;
        bestS = s;
      }
    }
  }
  let step = Math.max(t1 - t0, s1 - s0) / grid;
  for (let iter = 0; iter < 28 && step > 1e-5; iter++) {
    let improved = false;
    for (const dt of [0, step, -step]) {
      for (const ds of [0, step, -step]) {
        if (dt === 0 && ds === 0) continue;
        const t = Math.min(t1, Math.max(t0, bestT + dt));
        const s = Math.min(s1, Math.max(s0, bestS + ds));
        const e = score(t, s);
        if (e + 1e-18 < best) {
          best = e;
          bestT = t;
          bestS = s;
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.5;
  }
  // 0.15 grid: a nearer miss than that is still a nib corner, not a separate edge.
  if (Math.sqrt(best) > 0.15) return null;
  return { t: bestT, s: bestS };
}

function appendShiftedQuad(cmds: Cmd[], cursor: Pt, p0: Pt, p1: Pt, p2: Pt, t0: number, t1: number, v: Pt): Pt {
  if (t1 <= t0 + 1e-5) return cursor;
  const [a0, c0, b0] = subQuad(p0, p1, p2, t0, t1);
  const a = add(a0, v);
  const c = add(c0, v);
  const b = add(b0, v);
  cursor = pushLine(cmds, cursor, a);
  if (distToSegment(c, a, b) > 0.004 && far(a, b)) {
    cmds.push({ op: 'Q', c, to: b });
    return b;
  }
  return pushLine(cmds, cursor, b);
}

/** Joins after each span but the last. A hit means the nib edge is a swallowtail. */
function spanCuts(p0: Pt, p1: Pt, p2: Pt, spans: Span[], verts: Pt[]): ({ t: number; s: number } | null)[] {
  const cuts: ({ t: number; s: number } | null)[] = [];
  for (let i = 0; i < spans.length - 1; i++) {
    const s = spans[i]!;
    const next = spans[i + 1]!;
    const v = verts[s.v]!;
    const w = verts[next.v]!;
    const tan = quadDeriv(p0, p1, p2, s.t1);
    if (dot(tan, sub(w, v)) >= 0) {
      cuts.push(null);
      continue;
    }
    const pad = 0.35;
    cuts.push(
      quadHit(p0, p1, p2, s.t0, s.t1, v, next.t0, next.t1, w) ??
        quadHit(
          p0, p1, p2,
          Math.max(0, s.t0 - pad),
          Math.min(1, s.t1 + pad),
          v,
          Math.max(0, next.t0 - pad),
          Math.min(1, next.t1 + pad),
          w,
        ),
    );
  }
  return cuts;
}

function quadSide(p0: Pt, p1: Pt, p2: Pt, verts: Pt[], inward: boolean): Outline {
  const spans = quadSpans(p0, p1, p2, verts, inward);
  if (spans.length === 0) return { start: p0, cmds: [], closed: false };
  const cuts = spanCuts(p0, p1, p2, spans, verts);
  const s0 = spans[0]!;
  let tCursor = s0.t0;
  const start = add(quadAt(p0, p1, p2, tCursor), verts[s0.v]!);
  const cmds: Cmd[] = [];
  let cursor = start;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    const cut = i < cuts.length ? cuts[i]! : null;
    const from = Math.max(tCursor, s.t0);
    const tEnd = cut ? cut.t : s.t1;
    cursor = appendShiftedQuad(cmds, cursor, p0, p1, p2, from, tEnd, verts[s.v]!);
    const next = spans[i + 1];
    if (!next) continue;
    if (cut) {
      cursor = pushLine(cmds, cursor, add(quadAt(p0, p1, p2, cut.s), verts[next.v]!));
      tCursor = cut.s;
      continue;
    }
    cursor = pushLine(cmds, cursor, add(quadAt(p0, p1, p2, s.t1), verts[next.v]!));
    tCursor = next.t0;
  }
  return { start, cmds, closed: false };
}

/** Open nib stroke along one quadratic. */
export function quadStroke(p0: Pt, p1: Pt, p2: Pt, verts: Pt[]): string {
  const left = quadSide(p0, p1, p2, verts, false);
  const right = quadSide(p0, p1, p2, verts, true);
  const t0 = unit(quadDeriv(p0, p1, p2, 0));
  const t1 = unit(quadDeriv(p0, p1, p2, 1));
  const endCap = capVerts(verts, port(t1), neg(port(t1)), t1).map((v) => add(p2, v));
  const startCap = capVerts(verts, neg(port(t0)), port(t0), neg(t0)).map((v) => add(p0, v));
  return stitch(left, endCap, right, startCap);
}

type Corner = { p1: Pt; c: Pt; p2: Pt; rr: number; u1: Pt; u2: Pt };

function cornersOf(pts: Pt[], radius: number | number[]): Corner[] {
  const count = pts.length;
  const radii = Array.isArray(radius) ? radius : pts.map(() => radius);
  return pts.map((cur, i) => {
    const prev = pts[(i - 1 + count) % count]!;
    const next = pts[(i + 1) % count]!;
    const v1 = sub(cur, prev);
    const v2 = sub(next, cur);
    const l1 = len(v1) || 1;
    const l2 = len(v2) || 1;
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const rr = Math.max(0, Math.min(radii[i] ?? 0, l1 / 2.05, l2 / 2.05));
    return {
      p1: { x: cur.x - u1.x * rr, y: cur.y - u1.y * rr },
      c: cur,
      p2: { x: cur.x + u2.x * rr, y: cur.y + u2.y * rr },
      rr,
      u1,
      u2,
    };
  });
}

type Fillet = { c: Pt; r: number; a0: number; a1: number; sweep: 1 | -1 };

/**
 * Circular fillet through the same tangent points the quadratic used.
 * `rr` is the tangent length. On a right angle that equals the radius.
 */
function filletOf(corner: Corner): Fillet | null {
  if (corner.rr < 0.001) return null;
  const cross = corner.u1.x * corner.u2.y - corner.u1.y * corner.u2.x;
  const along = dot(corner.u1, corner.u2);
  const turn = Math.atan2(cross, along);
  const half = Math.abs(turn) / 2;
  if (half < 0.05 || half > Math.PI / 2 - 0.02) return null;
  const r = corner.rr / Math.tan(half);
  if (!(r > 0.02) || r > 80) return null;
  // Centre sits on the side the path turns toward, so the arc cuts the corner.
  const inward = turn > 0 ? neg(port(corner.u1)) : port(corner.u1);
  const c = add(corner.p1, mul(inward, r));
  if (Math.abs(Math.hypot(corner.p2.x - c.x, corner.p2.y - c.y) - r) > 0.05) return null;
  const a0 = Math.atan2(corner.p1.y - c.y, corner.p1.x - c.x);
  const a1 = Math.atan2(corner.p2.y - c.y, corner.p2.x - c.x);
  const increasing = { x: -Math.sin(a0), y: Math.cos(a0) };
  const sweep: 1 | -1 = dot(increasing, corner.u1) >= 0 ? 1 : -1;
  return { c, r, a0, a1, sweep };
}

/** Signed travel from `a0` to `a1`. Positive when the arc sweeps toward +y. */
function arcDelta(a0: number, a1: number, sweep: 1 | -1): number {
  let delta = a1 - a0;
  if (sweep > 0) {
    while (delta <= 1e-6) delta += Math.PI * 2;
    while (delta > Math.PI * 2 - 1e-6) delta -= Math.PI * 2;
  } else {
    while (delta >= -1e-6) delta -= Math.PI * 2;
    while (delta < -Math.PI * 2 + 1e-6) delta += Math.PI * 2;
  }
  return delta;
}

function piecesOf(pts: Pt[], radius: number | number[]): Piece[] {
  const corners = cornersOf(pts, radius);
  const pieces: Piece[] = [];
  for (let i = 0; i < corners.length; i++) {
    const here = corners[i]!;
    const next = corners[(i + 1) % corners.length]!;
    const b = next.rr < 0.001 ? next.c : next.p1;
    if (far(here.p2, b)) pieces.push({ k: 'L', a: here.p2, b });
    if (next.rr < 0.001) continue;
    const arc = filletOf(next);
    if (arc) pieces.push({ k: 'A', ...arc });
    else pieces.push({ k: 'Q', a: next.p1, c: next.c, b: next.p2 });
  }
  return pieces;
}

/** Centreline of a rounded polygon, sampled. The play mark shifts by this centroid. */
export function roundSamples(pts: Pt[], radius: number | number[], steps = 8): Pt[] {
  const out: Pt[] = [];
  for (const piece of piecesOf(pts, radius)) {
    if (piece.k === 'L') {
      out.push(piece.a, piece.b);
    } else if (piece.k === 'A') {
      const delta = arcDelta(piece.a0, piece.a1, piece.sweep);
      for (let s = 0; s <= steps; s++) {
        const th = piece.a0 + delta * (s / steps);
        out.push({ x: piece.c.x + piece.r * Math.cos(th), y: piece.c.y + piece.r * Math.sin(th) });
      }
    } else {
      for (let s = 0; s <= steps; s++) out.push(quadAt(piece.a, piece.c, piece.b, s / steps));
    }
  }
  return out;
}

/** Filled rounded polygon. A zero radius is a real corner, not a degenerate curve. */
export function solidRound(pts: Pt[], radius: number | number[]): string {
  const corners = cornersOf(pts, radius);
  if (corners.length === 0) return '';
  const first = corners[0]!;
  const start = first.rr < 0.001 ? first.c : first.p2;
  let d = `M${fmt(start.x)} ${fmt(start.y)}`;
  let cursor = start;
  const lineTo = (p: Pt) => {
    if (!far(cursor, p)) return;
    d += `L${fmt(p.x)} ${fmt(p.y)}`;
    cursor = p;
  };
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[(i + 1) % corners.length]!;
    if (corner.rr < 0.001) {
      lineTo(corner.c);
      continue;
    }
    lineTo(corner.p1);
    const arc = filletOf(corner);
    if (!arc) {
      d += `Q${fmt(corner.c.x)} ${fmt(corner.c.y)} ${fmt(corner.p2.x)} ${fmt(corner.p2.y)}`;
    } else {
      const delta = arcDelta(arc.a0, arc.a1, arc.sweep);
      const large = Math.abs(delta) > Math.PI ? 1 : 0;
      const sweep = arc.sweep > 0 ? 1 : 0;
      d += `A${fmt(arc.r)} ${fmt(arc.r)} 0 ${large} ${sweep} ${fmt(corner.p2.x)} ${fmt(corner.p2.y)}`;
    }
    cursor = corner.p2;
  }
  return d + 'Z';
}

function sideNormal(tan: Pt, side: 1 | -1): Pt {
  const n = port(tan);
  return side === 1 ? n : neg(n);
}

/** Longest side of the nib. Offset arcs shorter than half of this cannot meet. */
function nibEdge(verts: Pt[]): number {
  let m = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return m;
}

function arcTan(ang: number, sweep: 1 | -1): Pt {
  return unit({ x: -sweep * Math.sin(ang), y: sweep * Math.cos(ang) });
}

function pieceStartPt(piece: Piece): Pt {
  if (piece.k === 'A') return { x: piece.c.x + piece.r * Math.cos(piece.a0), y: piece.c.y + piece.r * Math.sin(piece.a0) };
  return piece.a;
}

function pieceEndPt(piece: Piece): Pt {
  if (piece.k === 'A') return { x: piece.c.x + piece.r * Math.cos(piece.a1), y: piece.c.y + piece.r * Math.sin(piece.a1) };
  return piece.b;
}

function pieceStartTan(piece: Piece): Pt {
  if (piece.k === 'L') return unit(sub(piece.b, piece.a));
  if (piece.k === 'A') return arcTan(piece.a0, piece.sweep);
  return unit(quadDeriv(piece.a, piece.c, piece.b, 0));
}

function pieceEndTan(piece: Piece): Pt {
  if (piece.k === 'L') return unit(sub(piece.b, piece.a));
  if (piece.k === 'A') return arcTan(piece.a1, piece.sweep);
  return unit(quadDeriv(piece.a, piece.c, piece.b, 1));
}

function appendOutline(cmds: Cmd[], cursor: Pt, part: Outline): Pt {
  cursor = pushLine(cmds, cursor, part.start);
  for (const cmd of part.cmds) {
    cmds.push(cmd);
    cursor = cmd.to;
  }
  return cursor;
}

/** One side of a closed nib sweep. `side` 1 is the left of the travel direction. */
function loopSide(pieces: Piece[], verts: Pt[], side: 1 | -1): Outline {
  if (pieces.length === 0) return { start: { x: 0, y: 0 }, cmds: [], closed: true };
  const cmds: Cmd[] = [];
  const firstN = sideNormal(pieceStartTan(pieces[0]!), side);
  const firstV = supportIndex(verts, firstN);
  const start = add(pieceStartPt(pieces[0]!), verts[firstV]!);
  let cursor = start;
  let prevTan = pieceEndTan(pieces[pieces.length - 1]!);
  let prevEnd = pieceEndPt(pieces[pieces.length - 1]!);

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    const tan0 = pieceStartTan(piece);
    const n0 = sideNormal(tan0, side);
    const anchor = pieceStartPt(piece);
    if (i === 0) {
      // The closing walk is applied after the loop, so the start vertex is already `start`.
    } else if (dot(unit(prevTan), unit(tan0)) < 0.9995 || supportIndex(verts, sideNormal(prevTan, side)) !== supportIndex(verts, n0)) {
      const walked = nibWalk(verts, sideNormal(prevTan, side), n0);
      for (const rel of walked) cursor = pushLine(cmds, cursor, add(anchor, rel));
    }
    if (piece.k === 'L') {
      const v = supportIndex(verts, n0);
      const b = add(piece.b, verts[v]!);
      cursor = pushLine(cmds, cursor, b);
    } else if (piece.k === 'A') {
      const increasing = piece.sweep > 0;
      const lo = increasing ? piece.a0 : piece.a1;
      const hi = increasing ? piece.a1 : piece.a0;
      // Left of an increasing arc is away from the centre. A decreasing arc
      // has its left toward the centre, which is `inward` on the flipped span.
      // Left of an increasing arc points away from its centre. The outline side
      // is `side` (1 = left of the piece's own travel), so a decreasing piece
      // wants the other offset of the increasing span.
      const inward = increasing ? side === 1 : side === -1;
      const part = arcSide(piece.c.x, piece.c.y, piece.r, lo, hi, verts, inward, false);
      // A fillet tighter than the nib never reaches its own corner: the swept
      // arcs fall inside the stroke. Pivot the nib there instead of drawing
      // the swallowtail.
      const tight = piece.r <= nibEdge(verts) * 0.5 + 0.02 || part.swallowed;
      if (tight) {
        const n1 = sideNormal(pieceEndTan(piece), side);
        const corner = lineIntersect(anchor, tan0, pieceEndPt(piece), pieceEndTan(piece)) ?? anchor;
        for (const rel of nibWalk(verts, n0, n1)) cursor = pushLine(cmds, cursor, add(corner, rel));
        cursor = pushLine(cmds, cursor, add(pieceEndPt(piece), verts[supportIndex(verts, n1)]!));
      } else {
        cursor = appendOutline(cmds, cursor, increasing ? part : reverseOutline(part));
      }
    } else {
      const spans = quadSpans(piece.a, piece.c, piece.b, verts, side === -1);
      const cuts = spanCuts(piece.a, piece.c, piece.b, spans, verts);
      let tCursor = spans[0]?.t0 ?? 0;
      for (let s = 0; s < spans.length; s++) {
        const span = spans[s]!;
        const cut = s < cuts.length ? cuts[s]! : null;
        const from = Math.max(tCursor, span.t0);
        const tEnd = cut ? cut.t : span.t1;
        cursor = appendShiftedQuad(cmds, cursor, piece.a, piece.c, piece.b, from, tEnd, verts[span.v]!);
        const nxt = spans[s + 1];
        if (!nxt) continue;
        if (cut) {
          cursor = pushLine(cmds, cursor, add(quadAt(piece.a, piece.c, piece.b, cut.s), verts[nxt.v]!));
          tCursor = cut.s;
          continue;
        }
        cursor = pushLine(cmds, cursor, add(quadAt(piece.a, piece.c, piece.b, span.t1), verts[nxt.v]!));
        tCursor = nxt.t0;
      }
    }
    prevTan = pieceEndTan(piece);
    prevEnd = pieceEndPt(piece);
  }
  // Close across the last corner back to the first vertex.
  const closeWalk = nibWalk(verts, sideNormal(prevTan, side), firstN);
  for (const rel of closeWalk) cursor = pushLine(cmds, cursor, add(prevEnd, rel));
  if (far(cursor, start)) cmds.push({ op: 'L', to: start });
  return { start, cmds: dropNeedles(start, cmds), closed: true };
}

/**
 * A nib walk sometimes steps past a corner and comes straight back, a needle
 * with no area. Both edges are shorter than a nib and the turn is past 170°.
 * Drop the tip and keep the outline that actually borders the stroke.
 */
function dropNeedles(start: Pt, cmds: Cmd[]): Cmd[] {
  const out: Cmd[] = [];
  let cursor = start;
  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i]!;
    const next = cmds[i + 1];
    if (cmd.op === 'L' && next?.op === 'L') {
      const ab = sub(cmd.to, cursor);
      const bc = sub(next.to, cmd.to);
      const lab = len(ab);
      const lbc = len(bc);
      const shorter = Math.min(lab, lbc);
      if (lab > 0.03 && lbc > 0.03 && shorter < 2.4) {
        const ang = Math.abs(Math.atan2(ab.x * bc.y - ab.y * bc.x, ab.x * bc.x + ab.y * bc.y));
        if (ang > (170 * Math.PI) / 180) continue;
      }
    }
    out.push(cmd);
    cursor = cmd.to;
  }
  return out;
}

/** Closed nib ring around a rounded polygon. */
export function roundLoop(pts: Pt[], radius: number | number[], verts: Pt[]): string {
  const pieces = piecesOf(pts, radius);
  if (pieces.length === 0) return '';
  // Positive shoelace is clockwise on screen, and the left side is then the outside.
  const cw = shoelace(pts) >= 0;
  const outerSide: 1 | -1 = cw ? 1 : -1;
  const outer = loopSide(pieces, verts, outerSide);
  const inner = reverseOutline(loopSide(pieces, verts, outerSide === 1 ? -1 : 1));
  inner.closed = true;
  return outlinePath(outer) + outlinePath(inner);
}

/* ------------------------------------------------------------------ */
/* Constant-width frame                                                */
/* ------------------------------------------------------------------ */

function snapTo(v: number, unit: number): number {
  return Math.round(v / unit) * unit;
}

function snapCenter(center: number, extent: number, unit: number): number {
  const edge = snapTo(center - extent / 2, unit);
  return edge + extent / 2;
}

function snapOrtho(pts: Pt[], stroke: number, unit: number): Pt[] {
  if (unit <= 0 || pts.length < 3) return pts.map((p) => ({ ...p }));
  const out = pts.map((p) => ({ ...p }));
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < unit * 1.4) continue;
    if (Math.abs(dy) < 0.2 && Math.abs(dx) > l * 0.92) {
      const y = snapCenter((a.y + b.y) / 2, stroke, unit);
      a.y = y;
      b.y = y;
    } else if (Math.abs(dx) < 0.2 && Math.abs(dy) > l * 0.92) {
      const x = snapCenter((a.x + b.x) / 2, stroke, unit);
      a.x = x;
      b.x = x;
    }
  }
  return out;
}

function offsetQuadSamples(piece: Extract<Piece, { k: 'Q' }>, dist: number, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const tan = unit(quadDeriv(piece.a, piece.c, piece.b, t));
    const p = add(quadAt(piece.a, piece.c, piece.b, t), mul(port(tan), dist));
    if (out.length > 0) {
      const step = sub(p, out[out.length - 1]!);
      // A parallel curve cusps where the stroke is thicker than the corner.
      // Drop the samples that walk backwards; the fit then corners there.
      if (dot(step, tan) <= 0 && len(step) < Math.abs(dist) * 1.4) continue;
    }
    out.push(p);
  }
  if (out.length < 2) {
    const t0 = unit(quadDeriv(piece.a, piece.c, piece.b, 0));
    const t1 = unit(quadDeriv(piece.a, piece.c, piece.b, 1));
    return [add(piece.a, mul(port(t0), dist)), add(piece.b, mul(port(t1), dist))];
  }
  return out;
}

type RawSeg = {
  k: 'L' | 'C';
  a: Pt;
  b: Pt;
  dir: Pt;
  endDir: Pt;
  cmds: Cmd[];
};

function lineIntersect(p: Pt, dp: Pt, q: Pt, dq: Pt): Pt | null {
  const den = dp.x * dq.y - dp.y * dq.x;
  if (Math.abs(den) < 1e-9) return null;
  const s = ((q.x - p.x) * dq.y - (q.y - p.y) * dq.x) / den;
  return { x: p.x + dp.x * s, y: p.y + dp.y * s };
}

function offsetArc(piece: Extract<Piece, { k: 'A' }>, dist: number): RawSeg | null {
  // Left of travel is `sweep` times the outward radius, so a positive dist grows the arc.
  const radius = piece.r + piece.sweep * dist;
  if (radius <= 0.04) return null;
  const at = (ang: number): Pt => ({ x: piece.c.x + radius * Math.cos(ang), y: piece.c.y + radius * Math.sin(ang) });
  const a = at(piece.a0);
  const b = at(piece.a1);
  const delta = arcDelta(piece.a0, piece.a1, piece.sweep);
  return {
    k: 'C',
    a,
    b,
    dir: arcTan(piece.a0, piece.sweep),
    endDir: arcTan(piece.a1, piece.sweep),
    cmds: [{
      op: 'A',
      rx: radius,
      ry: radius,
      rot: 0,
      large: Math.abs(delta) > Math.PI ? 1 : 0,
      sweep: piece.sweep > 0 ? 1 : 0,
      to: b,
    }],
  };
}

function offsetQuad(piece: Extract<Piece, { k: 'Q' }>, dist: number): RawSeg {
  const tan0 = unit(quadDeriv(piece.a, piece.c, piece.b, 0));
  const tan1 = unit(quadDeriv(piece.a, piece.c, piece.b, 1));
  const a = add(piece.a, mul(port(tan0), dist));
  const b = add(piece.b, mul(port(tan1), dist));
  const samples = offsetQuadSamples(piece, dist, 36);
  samples[0] = a;
  samples[samples.length - 1] = b;
  const cmds = fitOpen(samples, tan0, neg(tan1), FIT_TOL);
  return { k: 'C', a, b, dir: tan0, endDir: tan1, cmds };
}

function offsetParallel(pieces: Piece[], dist: number): Outline {
  const segs: RawSeg[] = [];
  for (const piece of pieces) {
    if (piece.k === 'L') {
      const dir = unit(sub(piece.b, piece.a));
      const n = port(dir);
      const a = add(piece.a, mul(n, dist));
      const b = add(piece.b, mul(n, dist));
      segs.push({ k: 'L', a, b, dir, endDir: dir, cmds: [{ op: 'L', to: b }] });
    } else if (piece.k === 'A') {
      const seg = offsetArc(piece, dist);
      if (seg) segs.push(seg);
    } else segs.push(offsetQuad(piece, dist));
  }

  const n = segs.length;
  for (let i = 0; i < n; i++) {
    const prev = segs[(i - 1 + n) % n]!;
    const cur = segs[i]!;
    if (prev.k !== 'L' || cur.k !== 'L') continue;
    if (!far(prev.b, cur.a)) continue;
    const hit = lineIntersect(prev.a, prev.dir, cur.a, cur.dir);
    if (!hit) continue;
    const span = Math.hypot(hit.x - prev.b.x, hit.y - prev.b.y);
    if (span > Math.abs(dist) * 3.2) continue;
    prev.b = hit;
    cur.a = hit;
    prev.cmds = [{ op: 'L', to: hit }];
    cur.cmds = far(cur.a, cur.b) ? [{ op: 'L', to: cur.b }] : [];
  }

  if (segs.length === 0) return { start: { x: 0, y: 0 }, cmds: [], closed: true };
  const cmds: Cmd[] = [];
  const start = segs[0]!.a;
  let cursor = start;
  for (const seg of segs) {
    if (far(cursor, seg.a)) cmds.push({ op: 'L', to: seg.a });
    for (const cmd of seg.cmds) {
      if (cmd.op === 'L' && !far(cursor, cmd.to)) continue;
      cmds.push(cmd);
      cursor = cmd.to;
    }
    cursor = seg.b;
  }
  if (far(cursor, start)) cmds.push({ op: 'L', to: start });
  return { start, cmds, closed: true };
}

/**
 * Constant-width ring of a rounded polygon, and the plate fill behind it.
 * `stroke` and `unit` are grid units. `unit` is one CSS pixel; 0 skips the snap.
 */
export function frameOf(
  pts: Pt[],
  radius: number | number[],
  stroke: number,
  unit: number,
): { ring: string; plate: string } {
  const snapped = snapOrtho(pts, stroke, unit);
  const plate = solidRound(snapped, radius);
  const pieces = piecesOf(snapped, radius);
  const sign = shoelace(snapped) >= 0 ? 1 : -1;
  const outer = offsetParallel(pieces, sign * (stroke / 2));
  const inner = reverseOutline(offsetParallel(pieces, -sign * (stroke / 2)));
  inner.closed = true;
  return { ring: outlinePath(outer) + outlinePath(inner), plate };
}
