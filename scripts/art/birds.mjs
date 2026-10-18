// Shared engraving for the voice and the choir.
//
// Proportions are typical field proportions, not a measured skin and not a
// tracing of a miniature. A nightingale (Luscinia / bulbul) has a round head,
// a large dark eye, a thin bill about two-thirds of the head, a throat that
// swells when it sings, and a long cocked tail. The hoopoe's crest and slender
// decurved bill, the parrot's hook, the dove's small head and full breast, and
// the finch's short conical bill are silhouette cues so the flock reads at
// card size.
//
// No person is drawn: no face, no figure, no human silhouette.
//
// Motion is a function of playback time. The stage writes three samples of one
// sine (--breath-o, --breath-p, --breath-q) so neighbouring birds can be out
// of phase. CSS cannot shift a single sample. Nothing uses class "breath":
// that class fades with --breath-o, and the bird must stay visible when the
// sample is 0 (gallery, reduced motion). At rest the bill is already open and
// the sound lines are already drawn. Breath swells the breast from the back,
// opens the lower mandible a little more, and the plate turns the branch a
// fraction of a degree about its root.

import { P, smooth, shade, f, circle, poly } from './lib.mjs';

export const PHASE = {
  o: 'var(--breath-o, 0)',
  p: 'var(--breath-p, 0)',
  q: 'var(--breath-q, 0)',
};

const T = 0.15;

function Mof(x, y, s, face) {
  return (lx, ly) => P(x + face * lx * s, y + ly * s);
}

function pts(pairs, M) {
  return pairs.map(([lx, ly]) => M(lx, ly));
}

function blob(pairs, M, tension = T) {
  return smooth(pts(pairs, M), true, tension);
}

function arc(cx, cy, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function bounds(points, pad = 6) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

function ink(a, d) {
  a.add(`<path class="h" d="${d}" fill="currentColor" stroke="none"/>`);
}

/** Pivot as a percentage of the 400 viewBox, so it stays put when the plate is scaled. */
export function swayStyle(root, phase = 'o', deg = 0.65) {
  const v = PHASE[phase] ?? PHASE.o;
  return `transform-box:view-box;transform-origin:${f(root.x / 4)}% ${f(root.y / 4)}%;transform:rotate(calc(${v} * ${deg}deg))`;
}

function volume(shape, points) {
  return shade({
    shape,
    box: bounds(points, 3),
    angle: 34,
    spacing: 2.8,
    width: 0.4,
    light: P(-8, -6),
  });
}

// --- species, local space: +x toward the bill, +y down, origin on the perch ---

function nightingale() {
  const skull = arc(30, -48, 15.5, Math.PI, Math.PI * 2 - 0.32, 12);
  const brow = skull[skull.length - 1];
  const body = [
    [36, -36],
    [24, -24],
    [12, -14],
    [-2, -10],
    [-16, -12],
    [-28, -22],
    [-34, -34],
    [-22, -44],
    [-6, -48],
    [skull[0][0], skull[0][1]],
    ...skull.slice(1),
    [brow[0] + 8, brow[1] - 1],
    [brow[0] + 16, brow[1] + 2],
    [brow[0] + 22, brow[1] + 5],
    [brow[0] + 15, brow[1] + 9],
    [brow[0] + 7, brow[1] + 8],
    [brow[0] + 1, brow[1] + 7],
  ];
  return {
    body,
    billOnBody: true,
    tail: [
      [-26, -34],
      [-44, -46],
      [-66, -54],
      [-86, -52],
      [-98, -42],
      [-100, -34],
      [-90, -28],
      [-68, -26],
      [-44, -24],
      [-28, -24],
    ],
    wing: [
      [14, -44],
      [2, -38],
      [-12, -28],
      [-22, -16],
      [-14, -10],
      [0, -14],
      [12, -24],
      [18, -36],
    ],
    shafts: [
      [[8, -40], [-4, -30], [-16, -18]],
      [[12, -34], [0, -24], [-12, -14]],
      [[4, -34], [-8, -24], [-16, -14]],
    ],
    upper: [],
    lower: [
      [brow[0] + 1, brow[1] + 10],
      [brow[0] + 10, brow[1] + 12],
      [brow[0] + 18, brow[1] + 14],
      [brow[0] + 20, brow[1] + 15],
      [brow[0] + 12, brow[1] + 12],
      [brow[0] + 3, brow[1] + 10],
    ],
    eye: [34, -52],
    eyeR: 2.7,
    tip: [brow[0] + 22, brow[1] + 5],
  };
}

function hoopoe() {
  const g = nightingale();
  g.body = [
    [56, -30],
    [48, -20],
    [32, -12],
    [14, -7],
    [-4, -7],
    [-20, -14],
    [-32, -26],
    [-28, -38],
    [-10, -44],
    [8, -46],
    [24, -50],
    [36, -56],
    [46, -54],
    [52, -44],
    [54, -34],
  ];
  g.tail = [
    [-22, -32],
    [-38, -36],
    [-54, -32],
    [-62, -22],
    [-58, -14],
    [-42, -14],
    [-26, -18],
  ];
  g.upper = [
    [52, -40],
    [68, -44],
    [84, -38],
    [96, -28],
    [88, -26],
    [72, -32],
    [54, -34],
  ];
  g.lower = [
    [52, -33],
    [68, -28],
    [82, -20],
    [90, -16],
    [80, -20],
    [64, -28],
    [52, -31],
  ];
  g.eye = [44, -48];
  g.eyeR = 2.5;
  g.tip = [96, -28];
  g.crest = true;
  g.tailBand = true;
  g.wingBars = true;
  return g;
}

function dove() {
  const g = nightingale();
  g.body = [
    [36, -18],
    [28, -8],
    [14, -1],
    [-2, 1],
    [-18, -2],
    [-32, -12],
    [-36, -24],
    [-26, -34],
    [-10, -38],
    [4, -40],
    [16, -46],
    [24, -52],
    [30, -50],
    [34, -40],
    [36, -28],
  ];
  g.tail = [
    [-28, -30],
    [-44, -32],
    [-58, -26],
    [-64, -16],
    [-56, -8],
    [-40, -10],
    [-28, -16],
  ];
  g.wing = [
    [12, -36],
    [0, -30],
    [-14, -22],
    [-22, -12],
    [-12, -6],
    [2, -12],
    [14, -24],
  ];
  g.upper = [
    [34, -32],
    [44, -34],
    [52, -31],
    [56, -28],
    [50, -26],
    [40, -28],
    [34, -30],
  ];
  g.lower = [
    [34, -27],
    [44, -24],
    [52, -21],
    [48, -22],
    [38, -25],
    [34, -26],
  ];
  g.gape = [
    [36, -29],
    [46, -28],
    [52, -24],
    [44, -24],
  ];
  g.eye = [28, -44];
  g.eyeR = 2.2;
  g.tip = [56, -28];
  g.neckLine = [
    [20, -40],
    [14, -32],
    [16, -22],
  ];
  g.shafts = [
    [[8, -32], [-4, -24], [-16, -14]],
    [[12, -28], [0, -18], [-12, -10]],
  ];
  return g;
}

function parrot() {
  const g = nightingale();
  g.body = [
    [46, -26],
    [34, -14],
    [18, -6],
    [2, -3],
    [-14, -8],
    [-26, -20],
    [-24, -34],
    [-10, -42],
    [6, -46],
    [20, -52],
    [32, -58],
    [40, -56],
    [44, -46],
    [46, -34],
  ];
  g.tail = [
    [-18, -34],
    [-34, -38],
    [-50, -34],
    [-56, -24],
    [-50, -16],
    [-34, -16],
    [-20, -22],
  ];
  g.upper = [
    [40, -52],
    [52, -58],
    [62, -50],
    [66, -40],
    [62, -32],
    [54, -28],
    [48, -34],
    [42, -44],
    [40, -50],
  ];
  g.lower = [
    [42, -40],
    [52, -36],
    [60, -32],
    [64, -28],
    [56, -30],
    [46, -36],
    [42, -38],
  ];
  g.gape = [
    [44, -42],
    [56, -38],
    [62, -32],
    [54, -34],
    [46, -38],
  ];
  g.eye = [36, -50];
  g.eyeR = 2.6;
  g.tip = [66, -40];
  g.shafts = [
    [[8, -40], [-4, -32], [-16, -20]],
    [[14, -36], [2, -26], [-10, -16]],
  ];
  return g;
}

function finch() {
  const g = nightingale();
  g.body = [
    [34, -22],
    [24, -12],
    [10, -6],
    [-4, -5],
    [-16, -12],
    [-22, -24],
    [-14, -34],
    [0, -38],
    [14, -42],
    [24, -46],
    [30, -40],
    [34, -30],
  ];
  g.tail = [
    [-16, -30],
    [-30, -34],
    [-42, -30],
    [-46, -24],
    [-36, -22],
    [-44, -16],
    [-32, -14],
    [-18, -18],
  ];
  g.wing = [
    [10, -36],
    [-2, -30],
    [-12, -20],
    [-14, -12],
    [-4, -10],
    [8, -18],
    [14, -28],
  ];
  g.upper = [
    [32, -32],
    [42, -34],
    [50, -30],
    [54, -26],
    [46, -26],
    [36, -28],
    [32, -30],
  ];
  g.lower = [
    [32, -27],
    [42, -24],
    [50, -20],
    [44, -22],
    [34, -25],
    [32, -26],
  ];
  g.gape = [
    [34, -29],
    [44, -28],
    [50, -24],
    [42, -24],
  ];
  g.eye = [26, -38];
  g.eyeR = 2.15;
  g.tip = [54, -26];
  g.shafts = [[[6, -32], [-6, -22], [-12, -14]]];
  return g;
}

const KINDS = { nightingale, hoopoe, dove, parrot, finch };

function placed(spec) {
  const { x, y, s = 1, face = -1, kind = 'nightingale' } = spec;
  const g = KINDS[kind]();
  const M = Mof(x, y, s, face);
  return {
    spec,
    g,
    M,
    s,
    face,
    body: blob(g.body, M),
    bodyPts: pts(g.body, M),
    tail: blob(g.tail, M),
    tailPts: pts(g.tail, M),
    wing: blob(g.wing, M),
    upper: g.upper.length ? poly(pts(g.upper, M)) : '',
    lower: poly(pts(g.lower, M)),
  };
}

/** Body and tail paths, for hiding a branch that passes behind the bird. */
export function birdCovers(spec) {
  const p = placed(spec);
  return [p.body, p.tail, p.wing];
}

function crest(a, M) {
  const feathers = [
    { b: [38, -56], ang: -118, len: 26, w: 4.2 },
    { b: [44, -58], ang: -92, len: 34, w: 4.4 },
    { b: [50, -54], ang: -68, len: 22, w: 3.8 },
  ];
  for (const feather of feathers) {
    const rad = (feather.ang * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const px = -uy;
    const py = ux;
    const [bx, by] = feather.b;
    const side = (k, sd) => [bx + ux * feather.len * k + px * feather.w * sd, by + uy * feather.len * k + py * feather.w * sd];
    const tip = [bx + ux * feather.len, by + uy * feather.len];
    const shape = [side(0.05, 0.15), side(0.4, 1), side(0.75, 0.62), tip, side(0.75, -0.62), side(0.4, -1)];
    const d = blob(shape, M, 0.14);
    a.fillin(d);
    a.path(d, 'd', 1.0);
    const tipA = M(side(0.78, 0.35)[0], side(0.78, 0.35)[1]);
    const tipB = M(side(0.78, -0.35)[0], side(0.78, -0.35)[1]);
    a.path(`M${f(tipA.x)} ${f(tipA.y)}L${f(tipB.x)} ${f(tipB.y)}`, 'd', 1.35);
  }
}

function toes(a, M) {
  const feet = [
    [[1, -1], [9, 2], [15, 6], [17, 9]],
    [[0, 0], [6, 4], [10, 8]],
    [[3, 0], [10, 3], [14, 7]],
    [[-2, 0], [-9, 4], [-14, 8]],
  ];
  for (const foot of feet) {
    a.path(smooth(pts(foot, M), false, 0.18), 'd', 1.05);
    const tip = M(foot[foot.length - 1][0], foot[foot.length - 1][1]);
    const prev = M(foot[foot.length - 2][0], foot[foot.length - 2][1]);
    const dx = tip.x - prev.x;
    const dy = tip.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    a.path(`M${f(tip.x)} ${f(tip.y)}L${f(tip.x + (dx / len) * 3)} ${f(tip.y + (dy / len) * 3 + 1.2)}`, 'd', 0.9);
  }
  a.path(smooth(pts([[-1, -9], [0, -2]], M), false, 0.16), 'd', 1.15);
  a.path(smooth(pts([[4, -8], [2, -1]], M), false, 0.16), 'd', 1.0);
}

/**
 * One singing bird. `face` -1 looks left. `phase` is o | p | q.
 * Returns the bill tip in plate coordinates.
 */
export function drawBird(a, spec) {
  const p = placed(spec);
  const { g, M, s, face } = p;
  const v = PHASE[spec.phase] ?? PHASE.o;

  a.begin();
  a.fillin(p.tail);
  a.path(p.tail, 'd', 1.3);
  if (s >= 1) a.add(volume(p.tail, p.tailPts));
  if (g.tailBand) {
    const band = blob([[-44, -30], [-50, -20], [-60, -18], [-62, -28], [-52, -34]], M, 0.16);
    ink(a, band);
    a.path(band, 'd', 0.7);
  }
  if (spec.kind === 'nightingale') {
    a.path(smooth(pts([[-32, -32], [-62, -44], [-92, -40]], M), false, 0.2), 'h', 0.45);
    a.path(smooth(pts([[-30, -26], [-60, -32], [-90, -32]], M), false, 0.2), 'h', 0.4);
  }
  a.hidden(p.body);

  const back = face === -1 ? '100% 46%' : '0% 46%';
  a.add(`<g style="transform-box:fill-box;transform-origin:${back};transform:scale(calc(1 + ${v} * 0.045), calc(1 + ${v} * 0.06))">`);
  if (!g.billOnBody) a.begin();
  a.fillin(p.body);
  a.path(p.body, 'd', 1.45);
  if (s >= 1) a.add(volume(p.body, p.bodyPts));
  else {
    a.path(smooth(pts([[18, -30], [4, -26], [-10, -28]], M), false, 0.16), 'h', 0.4);
    a.path(smooth(pts([[14, -22], [0, -18], [-12, -20]], M), false, 0.16), 'h', 0.38);
  }
  a.fillin(p.wing);
  a.path(p.wing, 'd', 1.2);
  for (const shaft of g.shafts) a.path(smooth(pts(shaft, M), false, 0.2), 'h', 0.45);
  if (g.wingBars) {
    a.path(smooth(pts([[12, -34], [0, -28], [-10, -20]], M), false, 0.18), 'd', 1.15);
    a.path(smooth(pts([[10, -30], [-2, -24], [-12, -16]], M), false, 0.18), 'd', 0.85);
  }
  if (g.neckLine) a.path(smooth(pts(g.neckLine, M), false, 0.18), 'h', 0.7);
  if (s >= 1) {
    a.path(smooth(pts([[24, -22], [12, -20], [2, -22]], M), false, 0.16), 'h', 0.4);
    a.path(smooth(pts([[20, -16], [8, -14], [0, -16]], M), false, 0.16), 'h', 0.4);
  }
  if (g.crest) crest(a, M);

  const eye = M(g.eye[0], g.eye[1]);
  const er = g.eyeR * s;
  ink(a, circle(eye.x, eye.y, Math.max(er, 1.35)));
  a.path(circle(eye.x, eye.y, er + 1.2), 'd', 0.6);
  if (!g.billOnBody) a.hidden([p.upper, p.lower].filter(Boolean));

  if (p.upper) a.path(p.upper, 'd', 1.2);

  const hinge = face === -1 ? '100% 32%' : '0% 32%';
  const open = (-7 * face).toFixed(2);
  a.add(`<g style="transform-box:fill-box;transform-origin:${hinge};transform:rotate(calc(${v} * ${open}deg))">`);
  a.path(p.lower, 'd', 1.2);
  a.add('</g></g>');

  toes(a, M);
  return { beak: M(g.tip[0], g.tip[1]) };
}

/** Closed ribbon around a polyline. `half` is the half-width at each point, or one number. */
export function ribbon(center, half) {
  const left = [];
  const right = [];
  const n = center.length;
  for (let i = 0; i < n; i++) {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const w = Array.isArray(half) ? half[i] : half;
    left.push(P(center[i].x + -ty * w, center[i].y + tx * w));
    right.push(P(center[i].x - -ty * w, center[i].y - tx * w));
  }
  return smooth([...left, ...right.reverse()], true, 0.2);
}

export function drawBranch(a, center, half) {
  const d = ribbon(center, half);
  a.fillin(d);
  a.path(d, 'd', 1.35);
  for (let i = 1; i < center.length - 2; i += 2) {
    const p = center[i];
    const q = center[i + 1];
    a.path(`M${f(p.x)} ${f(p.y + 1.2)}Q${f((p.x + q.x) / 2)} ${f((p.y + q.y) / 2 - 1.5)} ${f(q.x)} ${f(q.y + 0.6)}`, 'h', 0.4);
  }
  return d;
}

export function drawThorn(a, at, dir) {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const tip = P(at.x + (dir.x / len) * 8, at.y + (dir.y / len) * 8);
  const side = P(-dir.y / len, dir.x / len);
  const d = smooth([
    P(at.x - side.x * 2.2, at.y - side.y * 2.2),
    tip,
    P(at.x + side.x * 2.2, at.y + side.y * 2.2),
  ], true, 0.12);
  a.path(d, 'd', 0.95);
}

export function drawLeaf(a, x, y, len, ang) {
  const rad = (ang * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const px = -uy;
  const py = ux;
  const w = len * 0.48;
  const q = (k, s) => P(x + ux * len * k + px * w * s, y + uy * len * k + py * w * s);
  const shape = [q(0, 0), q(0.16, 0.4), q(0.36, 0.9), q(0.58, 1), q(0.78, 0.62), q(0.92, 0.22), q(1, 0), q(0.92, -0.22), q(0.78, -0.62), q(0.58, -1), q(0.36, -0.9), q(0.16, -0.4)];
  const d = smooth(shape, true, 0.14);
  a.fillin(d);
  a.path(d, 'd', 1.1);
  const tip = q(1, 0);
  a.path(`M${f(q(0.08, 0).x)} ${f(q(0.08, 0).y)}Q${f(q(0.5, 0).x)} ${f(q(0.5, 0).y)} ${f(tip.x)} ${f(tip.y)}`, 'h', 0.4);
  for (const k of [0.42, 0.64]) {
    const b = q(k, 0);
    a.path(`M${f(b.x)} ${f(b.y)}Q${f(q(k + 0.1, 0.45).x)} ${f(q(k + 0.1, 0.45).y)} ${f(q(k + 0.16, 0.7).x)} ${f(q(k + 0.16, 0.7).y)}`, 'h', 0.32);
    a.path(`M${f(b.x)} ${f(b.y)}Q${f(q(k + 0.1, -0.45).x)} ${f(q(k + 0.1, -0.45).y)} ${f(q(k + 0.16, -0.7).x)} ${f(q(k + 0.16, -0.7).y)}`, 'h', 0.32);
  }
}

function onBloom(cx, cy, rad, ang) {
  return P(cx + rad * Math.sin(ang), cy - rad * Math.cos(ang));
}

/** Scalloped bloom: one outer cup, seams only in the outer half, a small spiral. */
export function drawRose(a, cx, cy, s = 1, turn = 0) {
  const R = 32 * s;
  const spin = (turn * Math.PI) / 180;
  const lobes = 7;
  const outer = [];
  const steps = lobes * 10;
  for (let i = 0; i <= steps; i++) {
    const ang = spin + (i / steps) * Math.PI * 2;
    const rad = R * (0.94 + 0.06 * Math.cos(lobes * ang));
    outer.push(onBloom(cx, cy, rad, ang));
  }
  const d = smooth(outer, true, 0.22);
  a.fillin(d);
  a.path(d, 'd', 1.3);
  a.add(shade({
    shape: d,
    box: { x: cx - R - 4, y: cy - R - 4, w: R * 2 + 8, h: R * 2 + 8 },
    angle: 28,
    spacing: 2.5,
    width: 0.36,
    light: P(-8, -6),
  }));
  for (let i = 0; i < lobes; i++) {
    const ang = spin + ((i + 0.5) / lobes) * Math.PI * 2;
    const bend = ang + 0.35;
    const p0 = onBloom(cx, cy, R * 0.42, ang);
    const p1 = onBloom(cx, cy, R * 0.7, bend);
    const p2 = onBloom(cx, cy, R * 0.94, ang);
    a.path(`M${f(p0.x)} ${f(p0.y)}Q${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)}`, 'h', 0.55);
  }
  const cup = [];
  for (let i = 0; i <= 48; i++) {
    const ang = spin + (i / 48) * Math.PI * 2;
    const rad = R * 0.46 * (0.92 + 0.08 * Math.cos(5 * ang));
    cup.push(onBloom(cx, cy, rad, ang));
  }
  const cd = smooth(cup, true, 0.2);
  a.path(cd, 'd', 1.05);
  let spiral = '';
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const ang = t * Math.PI * 3;
    const rad = (2 + t * 7) * s;
    const p = P(cx + rad * Math.cos(ang), cy + rad * Math.sin(ang) * 0.82);
    spiral += `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`;
  }
  a.path(spiral, 'h', 0.6);
}

/** Closed bud, two sepals. */
export function drawBud(a, x, y, s = 1, ang = 0) {
  const rad = (ang * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = -Math.cos(rad);
  const px = Math.cos(rad);
  const py = Math.sin(rad);
  const ring = [];
  for (let i = 0; i <= 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const lx = Math.cos(t) * 6.5 * s;
    const ly = Math.sin(t) * 11 * s;
    ring.push(P(x + ux * ly + px * lx, y + uy * ly + py * lx));
  }
  const d = smooth(ring, true, 0.2);
  a.fillin(d);
  a.path(d, 'd', 1.05);
  const tip = P(x + ux * 9 * s, y + uy * 9 * s);
  a.path(`M${f(x)} ${f(y)}Q${f(x + px * 1.4 * s)} ${f(y + py * 1.4 * s)} ${f(tip.x)} ${f(tip.y)}`, 'h', 0.45);
}

/** Two or three sound lines and one petal. Not notes. Visible at rest. */
export function drawSong(a, tip, face) {
  const dir = face;
  const lines = [
    { len: 12, lift: 18, w: 0.85 },
    { len: 22, lift: 32, w: 0.7 },
    { len: 16, lift: 10, w: 0.6 },
  ];
  lines.forEach((ln, i) => {
    const start = P(tip.x + dir * 3, tip.y - 2);
    const end = P(tip.x + dir * ln.len, tip.y - ln.lift);
    const c = P(tip.x + dir * ln.len * 0.5, tip.y - ln.lift * 0.35);
    a.path(`M${f(start.x)} ${f(start.y)}Q${f(c.x)} ${f(c.y)} ${f(end.x)} ${f(end.y)}`, 'd', ln.w);
    if (i === lines.length - 1) {
      const rad = ((face === -1 ? -30 : 30) * Math.PI) / 180;
      const ux = Math.sin(rad);
      const uy = -Math.cos(rad);
      const px = Math.cos(rad);
      const py = Math.sin(rad);
      const q = (k, sd) => P(end.x + ux * 12 * k + px * 5 * sd, end.y + uy * 12 * k + py * 5 * sd);
      const d = smooth([q(0, 0), q(0.35, 0.9), q(0.7, 0.7), q(1, 0), q(0.7, -0.7), q(0.35, -0.9)], true, 0.16);
      a.fillin(d);
      a.path(d, 'd', 0.95);
    }
  });
}
