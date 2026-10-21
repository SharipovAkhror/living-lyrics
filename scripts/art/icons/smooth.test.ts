/**
 * Smooth Qalam outlines.
 *   npx tsx scripts/art/icons/smooth.test.ts
 *
 * Curved parts join within 2°. A steeper joint is allowed only when the glyph
 * lists it as a deliberate cut, nib cap or nuqta corner. A circle's samples
 * stay within 0.5% of the radius. A fitted cubic stays within 0.02 of the
 * true curve on the 24 grid.
 */
import { FIT_TOL, fitOpen, type Pt } from './curve';
import { glyphAt, glyphTransport, OPTICAL, type Optical } from './qalam';
import { ICON_NAMES, type IconName, type Mark } from '../../../src/ui/icons/types';

const SMOOTH = 2;
/** A reversed edge. A real nib corner stays under this, even a sharp inner miter. */
const SWALLOW = 178;
const RADIAL = 0.005;

type Cmd =
  | { op: 'L'; to: Pt }
  | { op: 'Q'; c: Pt; to: Pt }
  | { op: 'C'; c1: Pt; c2: Pt; to: Pt }
  | { op: 'A'; rx: number; ry: number; rot: number; large: number; sweep: number; to: Pt };

type Sub = { start: Pt; cmds: Cmd[]; closed: boolean };

let failures = 0;
const notes: string[] = [];
const fail = (msg: string) => {
  failures++;
  if (failures <= 80) console.log(`✗ ${msg}`);
};

function tokens(d: string): string[] {
  return d.match(/[MmLlHhVvCcQqAaZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
}

function parse(d: string): Sub[] {
  const tok = tokens(d);
  const subs: Sub[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cur: Sub | null = null;
  const num = () => Number(tok[i++]);
  const close = () => {
    if (!cur) return;
    cur.closed = true;
    subs.push(cur);
    cur = null;
    cx = sx;
    cy = sy;
  };
  while (i < tok.length) {
    const op = tok[i++]!;
    const rel = op === op.toLowerCase();
    const abs = op.toUpperCase();
    if (abs === 'Z') {
      close();
      continue;
    }
    if (abs === 'M') {
      if (cur && cur.cmds.length) subs.push(cur);
      const x = num() + (rel ? cx : 0);
      const y = num() + (rel ? cy : 0);
      cx = sx = x;
      cy = sy = y;
      cur = { start: { x, y }, cmds: [], closed: false };
      continue;
    }
    if (!cur) {
      fail(`path command ${op} before M`);
      break;
    }
    if (abs === 'L') {
      const x = num() + (rel ? cx : 0);
      const y = num() + (rel ? cy : 0);
      cur.cmds.push({ op: 'L', to: { x, y } });
      cx = x;
      cy = y;
    } else if (abs === 'H') {
      const x = num() + (rel ? cx : 0);
      cur.cmds.push({ op: 'L', to: { x, y: cy } });
      cx = x;
    } else if (abs === 'V') {
      const y = num() + (rel ? cy : 0);
      cur.cmds.push({ op: 'L', to: { x: cx, y } });
      cy = y;
    } else if (abs === 'Q') {
      const c = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
      const to = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
      cur.cmds.push({ op: 'Q', c, to });
      cx = to.x;
      cy = to.y;
    } else if (abs === 'C') {
      const c1 = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
      const c2 = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
      const to = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
      cur.cmds.push({ op: 'C', c1, c2, to });
      cx = to.x;
      cy = to.y;
    } else if (abs === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = num();
      const sweep = num();
      const to = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
      cur.cmds.push({ op: 'A', rx, ry, rot, large, sweep, to });
      cx = to.x;
      cy = to.y;
    } else {
      fail(`unknown path command ${op}`);
      break;
    }
  }
  if (cur && cur.cmds.length) subs.push(cur);
  return subs;
}

function hypot(x: number, y: number): number {
  return Math.hypot(x, y);
}

function unit(x: number, y: number): Pt | null {
  const l = hypot(x, y);
  if (l < 1e-8) return null;
  return { x: x / l, y: y / l };
}

type ArcGeom = { cx: number; cy: number; rx: number; ry: number; phi: number; theta1: number; dtheta: number };

/** Endpoint-to-centre conversion from the SVG implementation notes. */
function arcGeom(from: Pt, cmd: Extract<Cmd, { op: 'A' }>): ArcGeom | null {
  if (hypot(cmd.to.x - from.x, cmd.to.y - from.y) < 1e-9) return null;
  const phi = (cmd.rot * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - cmd.to.x) / 2;
  const dy = (from.y - cmd.to.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rx = Math.abs(cmd.rx);
  let ry = Math.abs(cmd.ry);
  if (rx < 1e-9 || ry < 1e-9) return null;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const sign = cmd.large === cmd.sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * ((-ry * x1p) / rx);
  const cx = cos * cxp - sin * cyp + (from.x + cmd.to.x) / 2;
  const cy = sin * cxp + cos * cyp + (from.y + cmd.to.y) / 2;
  const vx = (x1p - cxp) / rx;
  const vy = (y1p - cyp) / ry;
  const theta1 = Math.atan2(vy, vx);
  const ux = (-x1p - cxp) / rx;
  const uy = (-y1p - cyp) / ry;
  let dtheta = Math.atan2(vx * uy - vy * ux, vx * ux + vy * uy);
  if (cmd.sweep === 0 && dtheta > 0) dtheta -= Math.PI * 2;
  if (cmd.sweep === 1 && dtheta < 0) dtheta += Math.PI * 2;
  return { cx, cy, rx, ry, phi, theta1, dtheta };
}

function arcPoint(g: ArcGeom, t: number): Pt {
  const th = g.theta1 + t * g.dtheta;
  const xp = g.rx * Math.cos(th);
  const yp = g.ry * Math.sin(th);
  const cos = Math.cos(g.phi);
  const sin = Math.sin(g.phi);
  return { x: g.cx + cos * xp - sin * yp, y: g.cy + sin * xp + cos * yp };
}

function arcTangent(g: ArcGeom, t: number): Pt | null {
  const th = g.theta1 + t * g.dtheta;
  const sgn = g.dtheta >= 0 ? 1 : -1;
  const xp = -g.rx * Math.sin(th) * sgn;
  const yp = g.ry * Math.cos(th) * sgn;
  const cos = Math.cos(g.phi);
  const sin = Math.sin(g.phi);
  return unit(cos * xp - sin * yp, sin * xp + cos * yp);
}

function bez(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function quad(t: number, p0: Pt, p1: Pt, p2: Pt): Pt {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

type Seg = { a: Pt; b: Pt; tan0: Pt | null; tan1: Pt | null; kind: Cmd['op']; arc?: ArcGeom };

function segments(sub: Sub): Seg[] {
  const out: Seg[] = [];
  let cursor = sub.start;
  for (const cmd of sub.cmds) {
    if (cmd.op === 'L') {
      out.push({ a: cursor, b: cmd.to, tan0: unit(cmd.to.x - cursor.x, cmd.to.y - cursor.y), tan1: unit(cmd.to.x - cursor.x, cmd.to.y - cursor.y), kind: 'L' });
    } else if (cmd.op === 'Q') {
      const t0 = unit(cmd.c.x - cursor.x, cmd.c.y - cursor.y) ?? unit(cmd.to.x - cursor.x, cmd.to.y - cursor.y);
      const t1 = unit(cmd.to.x - cmd.c.x, cmd.to.y - cmd.c.y) ?? unit(cmd.to.x - cursor.x, cmd.to.y - cursor.y);
      out.push({ a: cursor, b: cmd.to, tan0: t0, tan1: t1, kind: 'Q' });
    } else if (cmd.op === 'C') {
      const t0 = unit(cmd.c1.x - cursor.x, cmd.c1.y - cursor.y) ?? unit(cmd.c2.x - cursor.x, cmd.c2.y - cursor.y) ?? unit(cmd.to.x - cursor.x, cmd.to.y - cursor.y);
      const t1 = unit(cmd.to.x - cmd.c2.x, cmd.to.y - cmd.c2.y) ?? unit(cmd.to.x - cmd.c1.x, cmd.to.y - cmd.c1.y) ?? unit(cmd.to.x - cursor.x, cmd.to.y - cursor.y);
      out.push({ a: cursor, b: cmd.to, tan0: t0, tan1: t1, kind: 'C' });
    } else {
      const g = arcGeom(cursor, cmd);
      out.push({ a: cursor, b: cmd.to, tan0: g ? arcTangent(g, 0) : null, tan1: g ? arcTangent(g, 1) : null, kind: 'A', arc: g ?? undefined });
    }
    cursor = cmd.to;
  }
  if (sub.closed && out.length > 0 && len(out[out.length - 1]!.b, sub.start) > 0.02) {
    const a = out[out.length - 1]!.b;
    const b = sub.start;
    const t = unit(b.x - a.x, b.y - a.y);
    out.push({ a, b, tan0: t, tan1: t, kind: 'L' });
  }
  return out;
}

function pointIn(pt: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const dy = pj.y - pi.y;
    if ((pi.y > pt.y) !== (pj.y > pt.y) && pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (dy === 0 ? 1e-12 : dy) + pi.x) c = !c;
  }
  return c;
}

function turn(a: Pt, b: Pt): number {
  return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * (180 / Math.PI);
}

function len(a: Pt, b: Pt): number {
  return hypot(b.x - a.x, b.y - a.y);
}

function sampleSub(sub: Sub, steps = 16): Pt[] {
  const pts: Pt[] = [sub.start];
  let cursor = sub.start;
  for (const cmd of sub.cmds) {
    if (cmd.op === 'L') pts.push(cmd.to);
    else if (cmd.op === 'Q') {
      for (let s = 1; s <= steps; s++) pts.push(quad(s / steps, cursor, cmd.c, cmd.to));
    } else if (cmd.op === 'C') {
      for (let s = 1; s <= steps; s++) pts.push(bez(s / steps, cursor, cmd.c1, cmd.c2, cmd.to));
    } else if (cmd.op === 'A') {
      const g = arcGeom(cursor, cmd);
      if (!g) pts.push(cmd.to);
      else for (let s = 1; s <= steps; s++) pts.push(arcPoint(g, s / steps));
    }
    cursor = cmd.to;
  }
  return pts;
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

const CIRCLES = new Set<IconName>(['info.circle', 'magnifyingglass', 'square.grid.2x2']);

/**
 * Joints steeper than 2° on a curved subpath. Each one is a nib cut, a cap,
 * an inner nib corner, or a chamfer — not a faceted sample. The count is the
 * same at every optical size unless `bySize` says otherwise. A new kink
 * changes the count and fails.
 */
type Expect = { off: number; on: number; why: string; bySize?: Partial<Record<Optical, { off: number; on: number }>> };

const DELIBERATE: Partial<Record<IconName, Expect>> = {
  backward: { off: 1, on: 1, why: 'chevron elbow' },
  forward: { off: 1, on: 1, why: 'chevron elbow' },
  'character.bubble': {
    off: 8,
    on: 8,
    why: 'two chamfered corners of the cartouche, outer and inner',
    bySize: { 28: { off: 4, on: 8 } },
  },
  'book.closed': {
    off: 4,
    on: 4,
    why: 'dog-ear of the folio',
    bySize: { 28: { off: 2, on: 4 } },
  },
  'music.note': { off: 8, on: 8, why: 'nib caps and the flag join' },
  'square.grid.2x2': { off: 4, on: 4, why: 'inner nib corners of the ring' },
  'book.pages': {
    off: 4,
    on: 4,
    why: 'valleys of the codex cover',
    bySize: { 16: { off: 4, on: 7 } },
  },
  magnifyingglass: { off: 4, on: 4, why: 'inner nib corners of the lens' },
  'info.circle': { off: 4, on: 4, why: 'inner nib corners of the ring' },
  'speaker.wave.2': {
    off: 42,
    on: 42,
    why: 'horn corners, wave caps and inner nib corners',
    bySize: {
      16: { off: 40, on: 40 },
      28: { off: 41, on: 41 },
    },
  },
};

function checkGlyph(name: IconName, optical: Optical, state: 'off' | 'on', marks: Mark[]): { sharp: number } {
  let sharp = 0;
  const where = `${name} ${optical} ${state}`;
  for (const mark of marks) {
    if (!mark.d) continue;
    const subs = parse(mark.d);
    if (subs.length >= 2 && subs[0]!.cmds.some((c) => c.op !== 'L') && subs[1]!.cmds.some((c) => c.op !== 'L')) {
      const outerPts = sampleSub(subs[0]!);
      const innerPts = sampleSub(subs[1]!);
      if (pointIn(subs[1]!.start, outerPts)) {
        const a0 = shoelace(outerPts);
        const a1 = shoelace(innerPts);
        if (a0 * a1 >= 0) fail(`${where}: ring hole winds the same way as the outer (${a0.toFixed(2)}, ${a1.toFixed(2)})`);
        if (Math.abs(a0) <= Math.abs(a1)) fail(`${where}: inner contour is larger than the outer`);
      }
    }
    for (const sub of subs) {
      const segs = segments(sub);
      const curved = segs.some((s) => s.kind !== 'L');
      let lineRun = 0;
      let smallInRun = 0;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]!;
        const next = segs[(i + 1) % segs.length];
        if (!sub.closed && i === segs.length - 1) next;
        const joined = sub.closed || i < segs.length - 1;
        // A faceted curve is a run of short chords. A long straight side of a
        // nib ring is a real edge, even when the same subpath also has arcs.
        if (seg.kind === 'L' && len(seg.a, seg.b) > 0.02 && len(seg.a, seg.b) < 1.6) lineRun++;
        else {
          if (smallInRun >= 4) fail(`${where}: ${smallInRun} faceted line joints in a row`);
          lineRun = 0;
          smallInRun = 0;
        }
        if (!joined || !next || !seg.tan1 || !next.tan0) continue;
        if (len(seg.a, seg.b) < 0.03 || len(next.a, next.b) < 0.03) continue;
        const ang = turn(seg.tan1, next.tan0);
        if (curved && ang > SWALLOW) fail(`${where}: swallowtail ${ang.toFixed(2)}°`);
        else if (curved && ang > SMOOTH) sharp++;
        if (seg.kind === 'L' && next.kind === 'L' && ang > 0.5 && ang <= 20) smallInRun++;
        else smallInRun = 0;
        if (seg.kind === 'A' && seg.arc && Math.abs(seg.arc.rx - seg.arc.ry) / seg.arc.rx < 0.01) {
          let worst = 0;
          for (let s = 0; s <= 12; s++) {
            const p = arcPoint(seg.arc, s / 12);
            const radial = Math.abs(hypot(p.x - seg.arc.cx, p.y - seg.arc.cy) - seg.arc.rx) / seg.arc.rx;
            worst = Math.max(worst, radial);
          }
          if (worst > RADIAL) fail(`${where}: circle radial ${(worst * 100).toFixed(3)}% > 0.5%`);
        }
        if (name === 'music.note' && seg.kind === 'A' && seg.arc && Math.abs(seg.arc.rx - seg.arc.ry) / seg.arc.rx >= 0.01) {
          let worst = 0;
          for (let s = 0; s <= 12; s++) {
            const th = seg.arc.theta1 + (s / 12) * seg.arc.dtheta;
            const xp = seg.arc.rx * Math.cos(th);
            const yp = seg.arc.ry * Math.sin(th);
            const err = Math.abs((xp * xp) / (seg.arc.rx * seg.arc.rx) + (yp * yp) / (seg.arc.ry * seg.arc.ry) - 1);
            worst = Math.max(worst, err);
          }
          if (worst > 0.01) fail(`${where}: note head off the ellipse by ${worst.toFixed(4)}`);
        }
      }
      if (smallInRun >= 4) fail(`${where}: ${smallInRun} faceted line joints in a row`);
      if (lineRun >= 8 && curved) fail(`${where}: ${lineRun} line commands along a curve`);
    }
    if (CIRCLES.has(name)) {
      let outer: Sub | null = null;
      let outerArea = 0;
      for (const sub of subs) {
        const segs = segments(sub);
        const circular = segs.some((s) => s.kind === 'A' && s.arc && Math.abs(s.arc.rx - s.arc.ry) < 0.02 && s.arc.rx > 1);
        if (!circular) continue;
        const area = Math.abs(shoelace(sampleSub(sub)));
        if (area > outerArea) {
          outer = sub;
          outerArea = area;
        }
      }
      if (outer) {
        const segs = segments(outer);
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i]!;
          const next = segs[(i + 1) % segs.length];
          if ((!outer.closed && i === segs.length - 1) || !next || !seg.tan1 || !next.tan0) continue;
          if (len(seg.a, seg.b) < 0.03 || len(next.a, next.b) < 0.03) continue;
          const ang = turn(seg.tan1, next.tan0);
          if (ang > SMOOTH) fail(`${where}: circle ring kink ${ang.toFixed(2)}°`);
        }
      }
    }
  }
  return { sharp };
}

function checkFit(): void {
  if (FIT_TOL > 0.02) fail(`fit tolerance ${FIT_TOL} is above 0.02`);
  const r = 8.35;
  const a0 = -Math.PI / 2;
  const a1 = 0;
  const n = 72;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push({ x: 12 + r * Math.cos(a), y: 12 + r * Math.sin(a) });
  }
  const tan0 = { x: -Math.sin(a0), y: Math.cos(a0) };
  const tan1 = { x: -Math.sin(a1), y: Math.cos(a1) };
  const cmds = fitOpen(pts, tan0, { x: -tan1.x, y: -tan1.y }, FIT_TOL);
  if (cmds.length === 0) {
    fail('quarter circle fit produced nothing');
    return;
  }
  if (cmds.every((c) => c.op === 'L')) fail('quarter circle fit collapsed to lines');
  let cursor = pts[0]!;
  let worst = 0;
  for (const cmd of cmds) {
    if (cmd.op === 'C') {
      for (let s = 1; s <= 20; s++) {
        const t = s / 20;
        const p = bez(t, cursor, cmd.c1, cmd.c2, cmd.to);
        const ang = Math.atan2(p.y - 12, p.x - 12);
        const truth = { x: 12 + r * Math.cos(ang), y: 12 + r * Math.sin(ang) };
        worst = Math.max(worst, hypot(p.x - truth.x, p.y - truth.y));
      }
      cursor = cmd.to;
    } else if (cmd.op === 'L') {
      worst = Math.max(worst, Math.abs(hypot(cmd.to.x - 12, cmd.to.y - 12) - r));
      cursor = cmd.to;
    }
  }
  if (worst > 0.02) fail(`quarter-circle fit misses the true arc by ${worst.toFixed(4)}`);
}

function main(): void {
  checkFit();
  const seen = new Map<IconName, Partial<Record<Optical, { off: number; on: number }>>>();
  for (const name of ICON_NAMES) {
    const row: Partial<Record<Optical, { off: number; on: number }>> = {};
    for (const optical of OPTICAL) {
      const glyph = glyphAt(name, optical, optical);
      row[optical] = {
        off: checkGlyph(name, optical, 'off', glyph.off).sharp,
        on: checkGlyph(name, optical, 'on', glyph.on ?? []).sharp,
      };
    }
    seen.set(name, row);
  }
  if (process.env.LL_DUMP) {
    for (const [name, row] of seen) {
      const bits = OPTICAL.map((o) => `${o}:${row[o]!.off}/${row[o]!.on}`).join(' ');
      if (OPTICAL.some((o) => row[o]!.off > 0 || row[o]!.on > 0)) console.log(name, bits);
    }
  }
  // Play options А/Б/В. А is the site default. Corners here are the base cut
  // (Б) and the nib caps; a new kink fails the count.
  const transportExpect: Record<string, { off: number; on: number }> = {
    'a play': { off: 0, on: 0 },
    'a pause': { off: 0, on: 0 },
    'b play': { off: 2, on: 2 },
    'b pause': { off: 4, on: 4 },
    'c play': { off: 0, on: 0 },
    'c pause': { off: 0, on: 0 },
  };
  for (const variant of ['a', 'b', 'c'] as const) {
    for (const which of ['play', 'pause'] as const) {
      for (const optical of OPTICAL) {
        const glyph = glyphTransport(variant, which, optical, optical);
        const off = checkGlyph(which, optical, 'off', glyph.off).sharp;
        const on = checkGlyph(which, optical, 'on', glyph.on ?? []).sharp;
        const key = `${variant} ${which}`;
        const want = transportExpect[key]!;
        if (off !== want.off || on !== want.on) {
          fail(`${key} ${optical}: corners off ${off} on ${on}, listed off ${want.off} on ${want.on}`);
        }
      }
    }
  }
  for (const note of notes) console.log(`· ${note}`);
  for (const [name, expect] of Object.entries(DELIBERATE) as [IconName, Expect][]) {
    const got = seen.get(name);
    if (!got) continue;
    for (const optical of OPTICAL) {
      const want = expect.bySize?.[optical] ?? { off: expect.off, on: expect.on };
      const have = got[optical];
      if (!have) continue;
      if (have.off !== want.off || have.on !== want.on) {
        fail(
          `${name} ${optical}: deliberate corners off ${have.off} on ${have.on}, listed off ${want.off} on ${want.on} (${expect.why})`,
        );
      }
    }
  }
  for (const [name, row] of seen) {
    if (DELIBERATE[name]) continue;
    if (OPTICAL.some((o) => (row[o]?.off ?? 0) > 0 || (row[o]?.on ?? 0) > 0)) {
      fail(`${name}: curved joints over 2° are not listed as deliberate corners`);
    }
  }
  if (failures > 0) {
    console.log(`${failures} failed`);
    process.exit(1);
  }
  console.log('smooth: ok');
}

main();
