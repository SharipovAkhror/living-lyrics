/**
 * Arabic concert oud (عود شرقي), not a Turkish ud.
 *
 * The catalogue calls it عود and names the plectrum «рише» (risha; Turkish is mızrap),
 * and places the origin in the Near East. A Turkish ud is smaller and is named when it is meant.
 *
 * Body, ribs, roses, pegbox (Metropolitan Museum of Art 1982.143.1, Les fils de Gamil
 * Georges, Cairo, 1977): vaulted back of fifteen ribs, varnished spruce top, three
 * fretwork roses, inlaid borders, bent-back pegbox, lateral pegs, unfretted.
 * L. 82 × W. 38.7 × D. 21 cm. That specimen has six double courses (twelve strings).
 * https://www.metmuseum.org/art/collection/search/503203
 *
 * A second Arab oud for the bowl and the short fretless neck (Met 2018.152, Abdo George
 * Nahat, Damascus, 1925): pear-shaped bowl of thin ribs, 76.2 × 35.6 × 20.3 cm.
 * https://www.metmuseum.org/art/collection/search/776535
 *
 * Stringing is the current Arabic concert set, not the twelve strings of the 1977 Met
 * oud: eleven strings = five double courses plus one single bass (lowest). Hannabach
 * 2511, scale 600–620 mm, tuning C, F/F, A/A, d/d, g/g, c'/c'.
 * https://www.thomann.co.uk/hannabach_2511_arabic_oud_11_strings_set.htm
 * The project engraving already draws eleven strings (scripts/art/instruments/oud.mjs).
 *
 * Choices, flagged in the manifest:
 * - Speaking length 61 cm, inside the Hannabach range. Body 50 cm, neck 20 cm,
 *   pegbox 18.6 cm plus a 0.9 cm finial (the head is about 20 cm along its axis),
 *   bent back 58°. The straight distance from the tail to the finial is 82.7 cm,
 *   near the Met catalogue’s 82 cm. The angle itself is not on that page; 58° is
 *   inside the usual 45–60° bend of an Arabic pegbox.
 * - Bridge 9 cm from the tail. The Met text does not describe the bridge; this one is
 *   the fixed tied bridge of a sharqi oud, not a floating Bashir bridge.
 * - The small roses sit toward the neck, flanking the fingerboard. The project SVG
 *   draws that pair lower, toward the bridge.
 * - Fingerboard, purfling and roses are plain stand-ins. The 1977 oud’s abalone
 *   borders, plastic fretwork and fingerboard inlay are not copied. The roses are a
 *   circular lattice only: the soundboard is cut on the circle, with no plate behind.
 * - A risha guard sits on the treble side, below the large rose. A lesson that names
 *   the parts of an Arabic oud puts “the risha guard” on the soundboard between the
 *   bridge and the sound holes (Learn The Oud, “Oud Rundown”, the risha-guard
 *   chapter: https://www.youtube.com/watch?v=afRYiI-gWmI). A luthier glues a wood
 *   veneer 0.5–1 mm thick there so the risha does not cut the spruce (Mansour Oud,
 *   “Oud Pick guard”: https://www.youtube.com/watch?v=n89kCR7uymQ). This one is a
 *   plain oval veneer, not a copy of either instrument’s shape.
 * - Viewer-left is the bass string. That is a display convention, not a claim about
 *   the player’s left hand.
 * - String radius 0.045 cm. The engraving outline in the app is what makes a line of
 *   that thickness readable; the tube itself is not fattened.
 */

import { add, box, geom, loft, mergeGeoms, quad, sphere, transformGeom, tri, tube } from './lib.mjs';

const BODY_L = 50;
const Y_TAIL = -BODY_L / 2;
const Y_JOIN = BODY_L / 2;
const NECK = 20;
const Y_NUT = Y_JOIN + NECK;
const BRIDGE_FROM_TAIL = 9;
const Y_BRIDGE = Y_TAIL + BRIDGE_FROM_TAIL;
const HALF_W = 19.35;
const DEPTH = 21;
const PEG_LEN = 18.6;
const FINIAL_R = 0.9;
const PEG_ANG = (58 * Math.PI) / 180;
const ALONG = [0, Math.cos(PEG_ANG), -Math.sin(PEG_ANG)];
const RIGHT = [1, 0, 0];

function vadd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function vmul(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function vnorm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function vcross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const THICK = vnorm(vcross(ALONG, RIGHT));

function halfWidthRaw(t) {
  const env = Math.pow(Math.sin(Math.PI * t), 0.7);
  const shoulder = t > 0.58 ? 1 - 0.16 * Math.pow((t - 0.58) / 0.42, 1.35) : 1;
  const tail = t < 0.1 ? 0.62 + 0.38 * (t / 0.1) : 1;
  return (2.5 + (HALF_W - 2.5) * env * shoulder) * tail;
}

let peakW = 0;
for (let i = 0; i <= 400; i++) peakW = Math.max(peakW, halfWidthRaw(i / 400));
const W_SCALE = HALF_W / peakW;

function halfWidth(t) {
  return halfWidthRaw(Math.min(1, Math.max(0, t))) * W_SCALE;
}

function bowlDepth(t) {
  return 0.85 + (DEPTH - 0.85) * Math.pow(Math.sin(Math.PI * t), 0.82);
}

function surface(t, th, inner) {
  const y = Y_TAIL + t * BODY_L;
  const wall = inner ? 0.42 * Math.sin(th) : 0;
  const w = Math.max(0.35, halfWidth(t) - wall);
  const d = Math.max(0.04, bowlDepth(t) - wall);
  return [w * Math.cos(th), y, -d * Math.sin(th)];
}

function bowlMesh(inner) {
  const g = geom();
  const ny = 28;
  const nt = 30;
  const ids = [];
  for (let i = 0; i <= ny; i++) {
    const row = [];
    const t = i / ny;
    for (let j = 0; j <= nt; j++) row.push(add(g, ...surface(t, (j / nt) * Math.PI, inner)));
    ids.push(row);
  }
  const sign = inner ? -1 : 1;
  for (let i = 0; i < ny; i++) {
    for (let j = 0; j < nt; j++) {
      const p = surface((i + 0.5) / ny, ((j + 0.5) / nt) * Math.PI, inner);
      quad(g, ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j], p[0] * sign, 0, p[2] * sign);
    }
  }
  return g;
}

function seams() {
  const ribbons = [];
  const ny = 28;
  for (let r = 0; r <= 15; r++) {
    const th = (r / 15) * Math.PI;
    const side = [-Math.sin(th), 0, -Math.cos(th)];
    const a = [];
    const b = [];
    for (let i = 0; i <= ny; i++) {
      const p = surface(i / ny, th, false);
      const len = Math.hypot(p[0], p[2]) || 1;
      const ox = (p[0] / len) * 0.07;
      const oz = (p[2] / len) * 0.07;
      const w = 0.11;
      a.push([p[0] + ox + side[0] * w, p[1], p[2] + oz + side[2] * w]);
      b.push([p[0] + ox - side[0] * w, p[1], p[2] + oz - side[2] * w]);
    }
    const g = geom();
    const ia = a.map((p) => add(g, p[0], p[1], p[2]));
    const ib = b.map((p) => add(g, p[0], p[1], p[2]));
    for (let i = 0; i < ny; i++) {
      const p = a[i];
      quad(g, ia[i], ib[i], ib[i + 1], ia[i + 1], p[0], 0, p[2]);
    }
    ribbons.push(g);
  }
  return mergeGeoms(ribbons);
}

const HOLES = [
  { x: 0, y: -1.5, r: 4.2 },
  { x: -6.1, y: 8.2, r: 2.5 },
  { x: 6.1, y: 8.2, r: 2.5 },
];

/** Pull a point that falls inside a rose out to the circle, so the cut is round. */
function onBoard(x, y) {
  let px = x;
  let py = y;
  let inside = false;
  for (const h of HOLES) {
    const dx = px - h.x;
    const dy = py - h.y;
    const d = Math.hypot(dx, dy);
    if (d < h.r && d > 1e-4) {
      const k = (h.r + 0.04) / d;
      px = h.x + dx * k;
      py = h.y + dy * k;
      inside = true;
    }
  }
  return { x: px, y: py, inside };
}

function soundboard() {
  const g = geom();
  const ny = 64;
  const nx = 48;
  const z = 0.16;
  const ids = [];
  const raw = [];
  for (let i = 0; i <= ny; i++) {
    const row = [];
    const xy = [];
    const t = i / ny;
    const y = Y_TAIL + t * BODY_L;
    const w = halfWidth(t);
    for (let j = 0; j <= nx; j++) {
      const x = (j / nx * 2 - 1) * w;
      const p = onBoard(x, y);
      xy.push({ x, y, inside: p.inside });
      row.push(add(g, p.x, p.y, z));
    }
    ids.push(row);
    raw.push(xy);
  }
  for (let i = 0; i < ny; i++) {
    for (let j = 0; j < nx; j++) {
      const corners = [raw[i][j], raw[i][j + 1], raw[i + 1][j + 1], raw[i + 1][j]];
      // A cell that sits wholly in a rose is the opening. A cell that only crosses
      // the circle keeps its outside corners and has the inside ones on the rim.
      if (corners.every((p) => p.inside)) continue;
      quad(g, ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j], 0, 0, 1);
    }
  }
  return g;
}

function edgeWall() {
  const g = geom();
  const n = 56;
  const loop = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    loop.push([halfWidth(t), Y_TAIL + t * BODY_L]);
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    loop.push([-halfWidth(t), Y_TAIL + t * BODY_L]);
  }
  const top = loop.map((p) => add(g, p[0], p[1], 0.16));
  const bot = loop.map((p) => add(g, p[0], p[1], 0));
  for (let i = 0; i < loop.length; i++) {
    const i2 = (i + 1) % loop.length;
    const ox = loop[i][0];
    const oy = loop[i][1];
    quad(g, bot[i], bot[i2], top[i2], top[i], ox, 0, 0.2);
  }
  return g;
}

function circleStrip(cx, cy, r0, r1, z, seg, nz) {
  const g = geom();
  const a = [];
  const b = [];
  for (let i = 0; i < seg; i++) {
    const ang = (i / seg) * Math.PI * 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    a.push(add(g, cx + c * r0, cy + s * r0, z));
    b.push(add(g, cx + c * r1, cy + s * r1, z));
  }
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    const ang = ((i + 0.5) / seg) * Math.PI * 2;
    quad(g, a[i], a[i2], b[i2], b[i], Math.cos(ang), Math.sin(ang), nz);
  }
  return g;
}

function holeWall(h) {
  const g = geom();
  const seg = 28;
  const top = [];
  const bot = [];
  for (let i = 0; i < seg; i++) {
    const ang = (i / seg) * Math.PI * 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    top.push(add(g, h.x + c * h.r, h.y + s * h.r, 0.16));
    bot.push(add(g, h.x + c * h.r, h.y + s * h.r, -0.35));
  }
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    const ang = ((i + 0.5) / seg) * Math.PI * 2;
    quad(g, top[i], bot[i], bot[i2], top[i2], -Math.cos(ang), -Math.sin(ang), 0);
  }
  return g;
}

/** Circular fretwork only. Nothing is filled behind it: the soundboard is already cut. */
function roseLattice(h) {
  const z = 0.22;
  const parts = [
    circleStrip(h.x, h.y, h.r * 0.1, h.r * 0.16, z, 16, 1),
    circleStrip(h.x, h.y, h.r * 0.4, h.r * 0.46, z, 24, 1),
    circleStrip(h.x, h.y, h.r * 0.68, h.r * 0.74, z, 28, 1),
    circleStrip(h.x, h.y, h.r * 0.9, h.r * 0.97, z, 32, 1),
  ];
  const spokes = 18;
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2;
    const dir = [Math.cos(ang), Math.sin(ang), 0];
    const side = [-Math.sin(ang), Math.cos(ang), 0];
    const inner = [h.x + dir[0] * h.r * 0.16, h.y + dir[1] * h.r * 0.16, z];
    const outer = [h.x + dir[0] * h.r * 0.9, h.y + dir[1] * h.r * 0.9, z];
    const w = Math.max(0.045, h.r * 0.022);
    const g = geom();
    const il = add(g, ...vadd(inner, vmul(side, -w)));
    const ol = add(g, ...vadd(outer, vmul(side, -w)));
    const orr = add(g, ...vadd(outer, vmul(side, w)));
    const ir = add(g, ...vadd(inner, vmul(side, w)));
    quad(g, il, ol, orr, ir, 0, 0, 1);
    parts.push(g);
  }
  return mergeGeoms(parts);
}

/** Thin veneer where the risha strikes, treble side, below the large rose. */
function pickguard() {
  const g = geom();
  const cx = 5.6;
  const cy = -11.4;
  const rx = 4.2;
  const ry = 2.7;
  const z0 = 0.18;
  const z1 = 0.26;
  const seg = 32;
  const ring = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    ring.push([x, y]);
  }
  const c0 = add(g, cx, cy, z0);
  const c1 = add(g, cx, cy, z1);
  const bot = ring.map((p) => add(g, p[0], p[1], z0));
  const top = ring.map((p) => add(g, p[0], p[1], z1));
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    tri(g, c1, top[i], top[i2], 0, 0, 1);
    tri(g, c0, bot[i2], bot[i], 0, 0, -1);
    const ox = ring[i][0] - cx;
    const oy = ring[i][1] - cy;
    quad(g, bot[i], bot[i2], top[i2], top[i], ox, oy, 0);
  }
  return g;
}

function purfling() {
  const g = geom();
  const n = 64;
  const loop = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = Y_TAIL + t * BODY_L;
    const w = Math.max(0.4, halfWidth(t) - 0.55);
    loop.push([w, y]);
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    const y = Y_TAIL + t * BODY_L;
    const w = Math.max(0.4, halfWidth(t) - 0.55);
    loop.push([-w, y]);
  }
  const a = [];
  const b = [];
  for (const p of loop) {
    const len = Math.hypot(p[0], 0) || 1;
    const inset = p[0] === 0 ? 0 : Math.sign(p[0]) * 0.16;
    a.push(add(g, p[0], p[1], 0.22));
    b.push(add(g, p[0] - inset, p[1], 0.22));
    void len;
  }
  for (let i = 0; i < loop.length; i++) {
    const i2 = (i + 1) % loop.length;
    quad(g, a[i], a[i2], b[i2], b[i], 0, 0, 1);
  }
  return g;
}

function bar(y0, y1, w0, w1, zBot, thick) {
  const rings = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const y = y0 + (y1 - y0) * u;
    const hw = (w0 + (w1 - w0) * u) / 2;
    const z0 = zBot;
    const z1 = zBot + thick;
    rings.push([
      [-hw, y, z0],
      [-hw, y, z0 + thick * 0.4],
      [-hw * 0.7, y, z1],
      [0, y, z1 + thick * 0.06],
      [hw * 0.7, y, z1],
      [hw, y, z0 + thick * 0.4],
      [hw, y, z0],
      [hw * 0.45, y, z0 - thick * 0.02],
      [-hw * 0.45, y, z0 - thick * 0.02],
    ]);
  }
  return loft(rings, 1);
}

function neck() {
  const rings = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const y = Y_JOIN - 0.4 + (Y_NUT - (Y_JOIN - 0.4)) * u;
    const hw = 1.85 - u * 0.25;
    const zBack = -2.15 + u * 0.25;
    const ring = [];
    const seg = 8;
    for (let s = 0; s <= seg; s++) {
      const a = Math.PI * 0.05 + (s / seg) * Math.PI * 0.9;
      ring.push([-Math.cos(a) * hw, y, -0.05 - Math.sin(a) * (0.15 - zBack)]);
    }
    ring.push([hw * 0.7, y, 0.12]);
    ring.push([-hw * 0.7, y, 0.12]);
    rings.push(ring);
  }
  return loft(rings, 1);
}

function pegbox() {
  const length = PEG_LEN;
  const nut = [0, Y_NUT, 0.85];
  const rings = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const o = vadd(nut, vmul(ALONG, 0.4 + u * length));
    const hw = u < 0.12 ? 1.45 + (u / 0.12) * 0.75 : 2.2 - Math.max(0, u - 0.82) * 1.4;
    const ht = 0.62;
    rings.push([
      vadd(o, vadd(vmul(RIGHT, -hw), vmul(THICK, -ht))),
      vadd(o, vadd(vmul(RIGHT, hw), vmul(THICK, -ht))),
      vadd(o, vadd(vmul(RIGHT, hw * 0.82), vmul(THICK, ht))),
      vadd(o, vadd(vmul(RIGHT, -hw * 0.82), vmul(THICK, ht))),
    ]);
  }
  return { mesh: loft(rings, 1), length, nut };
}

function pegAt(origin, side) {
  const rings = [];
  const samples = [
    [0, 0.2],
    [0.28, 0.36],
    [1.45, 0.18],
    [1.75, 0.3],
  ];
  for (const [dist, r] of samples) {
    const x = origin[0] + side * (2.15 + dist);
    const ring = [];
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2;
      ring.push([x, origin[1] + Math.cos(a) * r, origin[2] + Math.sin(a) * r]);
    }
    rings.push(ring);
  }
  return loft(rings, 1);
}

function stringXs() {
  const gaps = [];
  for (let i = 0; i < 5; i++) gaps.push(0.62, 0.38);
  const xs = [0];
  for (const g of gaps) xs.push(xs[xs.length - 1] + g);
  const mid = xs[xs.length - 1] / 2;
  const span = xs[xs.length - 1];
  const bridge = xs.map((v) => v - mid);
  const nut = bridge.map((v) => v * (2.4 / span));
  return { bridge, nut, span };
}

function strings() {
  const { bridge, nut } = stringXs();
  const nodes = [];
  let minGap = Infinity;
  for (let i = 0; i < bridge.length; i++) {
    // Centre-to-centre. The nut is the tight pair; do not double it (that hid the real gap).
    if (i > 0) minGap = Math.min(minGap, bridge[i] - bridge[i - 1], nut[i] - nut[i - 1]);
    const pts = [];
    const n = 14;
    for (let s = 0; s <= n; s++) {
      const u = s / n;
      pts.push([
        bridge[i] + (nut[i] - bridge[i]) * u,
        Y_BRIDGE + (Y_NUT - Y_BRIDGE) * u,
        0.9 + 0.2 * u,
      ]);
    }
    nodes.push({
      name: `part-string-${i + 1}`,
      material: 'string',
      morphName: 'vibrate',
      geom: tube(pts, 0.045, 6, 0.2),
    });
  }
  const tails = [];
  for (let i = 0; i < bridge.length; i++) {
    tails.push(tube(
      [
        [bridge[i], Y_BRIDGE, 0.9],
        [bridge[i] * 0.92, Y_TAIL + 2.4, 0.35],
      ],
      0.04,
      4,
      0,
    ));
  }
  return { nodes, tails: mergeGeoms(tails), minGap, count: bridge.length };
}

export function buildOud() {
  const pegs = pegbox();
  const pegMeshes = [];
  for (let i = 0; i < 11; i++) {
    const dist = 1.3 + i * ((PEG_LEN - 2.6) / 10);
    const origin = vadd(pegs.nut, vmul(ALONG, dist));
    const side = i % 2 === 0 ? -1 : 1;
    pegMeshes.push(pegAt(origin, side));
  }
  const tip = vadd(pegs.nut, vmul(ALONG, 0.35 + pegs.length + FINIAL_R));
  const played = strings();
  const lattices = mergeGeoms(HOLES.map(roseLattice));
  const walls = mergeGeoms(HOLES.map(holeWall));

  return {
    name: 'instrument',
    children: [
      { name: 'bowl', material: 'wood', geom: bowlMesh(false) },
      { name: 'bowl-inner', material: 'wood', geom: bowlMesh(true) },
      { name: 'seams', material: 'seam', geom: seams() },
      { name: 'soundboard', material: 'spruce', geom: mergeGeoms([soundboard(), edgeWall(), walls]) },
      { name: 'purfling', material: 'seam', geom: purfling() },
      { name: 'rosettes', material: 'spruce', geom: lattices },
      { name: 'pickguard', material: 'guard', geom: pickguard() },
      { name: 'fingerboard', material: 'ebony', geom: bar(Y_JOIN - 6.5, Y_NUT, 3.6, 2.85, 0.16, 0.42) },
      { name: 'neck', material: 'wood', geom: neck() },
      { name: 'pegbox', material: 'ebony', geom: pegs.mesh },
      { name: 'finial', material: 'ebony', geom: transformGeom(sphere(FINIAL_R, 10, 8), tip, RIGHT, ALONG, THICK) },
      { name: 'pegs', material: 'ebony', geom: mergeGeoms(pegMeshes) },
      { name: 'bridge', material: 'ebony', geom: box(0, Y_BRIDGE, 0.16 + 0.28, 6.4, 0.55, 0.58) },
      { name: 'tail', material: 'ebony', geom: box(0, Y_TAIL + 2.2, 0.16 + 0.18, 2.4, 1.1, 0.36) },
      { name: 'string-tails', material: 'string', geom: played.tails },
      ...played.nodes,
    ],
    notes: {
      strings: played.count,
      minGapCm: Number(played.minGap.toFixed(3)),
      scaleCm: Y_NUT - Y_BRIDGE,
      widthCm: HALF_W * 2,
      depthCm: DEPTH,
      pegboxCm: Number((PEG_LEN + FINIAL_R * 2).toFixed(1)),
      pegAngleDeg: Math.round((PEG_ANG * 180) / Math.PI),
      overallCm: Number((() => {
        const along = 0.35 + PEG_LEN + FINIAL_R * 2;
        const tipY = Y_NUT + along * Math.cos(PEG_ANG);
        const tipZ = 0.85 - along * Math.sin(PEG_ANG);
        return Math.hypot(tipY - Y_TAIL, tipZ);
      })().toFixed(1)),
      bodyCm: BODY_L,
      ribs: 15,
      courses: '5 double + 1 single bass',
    },
  };
}

void box;
