/**
 * Daf (دف) — Iranian / Kurdish ring-frame drum, not a dayereh and not an Azeri gaval.
 *
 * Sources for the proportions (read 2026-10-17):
 * - Peyman Nasehpour, “Daf, the Iranian frame drum”: six parts (frame, skin, pins,
 *   hooks, rings, leather band); concert frame diameter 48–53 cm, width 5–7 cm,
 *   goatskin glued on. https://www.nasehpour.com/daf-iranian-frame-drum
 * - Hartenberger World Musical Instrument Collection 2ME-MBST-11, Kurdish Iranian daf:
 *   diameter 21.5 in (54.6 cm), depth 2.3 in (5.8 cm), goatskin, “over 300 brass rings
 *   (3/4 inch) on over 70 staples”, thumb notch, decorative tacks.
 *   https://wmic.net/iran-daf-frame-drum/
 * - Encyclopaedia Iranica, “Daf(f) and Dāyera” (Jean During): art-music daf has rings on
 *   the inside, not zang discs; among the Qādirī, “each chain must be composed of four
 *   circular links”. https://www.iranicaonline.org/articles/daff-and-dayera-daf-ar/
 * - Cooperman “Daf — Persian style”: four interlocked brass rings inside the shell.
 *   https://www.coopermanframedrums.com/products/daf
 *
 * Choices inside those ranges, flagged in the manifest:
 * - Diameter 52 cm (inside Nasehpour’s 48–53; the Hartenberger drum is 54.6 cm).
 * - Depth 6 cm (inside 5–7 cm; the specimen is 5.8 cm).
 * - Wall thickness 1.2 cm is not given by the sources.
 * - 68 staples × 4 rings = 272 rings. Four links per chain is Iranica / Cooperman.
 *   Staple count is scaled from “over 70” on the slightly larger specimen
 *   (70 × 52 / 54.6 ≈ 67). Staples that would sit in the thumb notch are omitted.
 * - Ring diameter 1.9 cm (3/4 in on the specimen).
 * - Decorative tacks are mentioned but not counted; this model uses 48.
 * - The open side faces +Z (the camera). The skin is on the far side.
 */

import { box, discZ, geom, hoopProfile, mergeGeoms, revolveZ, sphere, torus, transformGeom } from './lib.mjs';

const DIAMETER = 52;
const R = DIAMETER / 2;
const DEPTH = 6;
const WALL = 1.2;
const R_IN = R - WALL;
const Z0 = -DEPTH / 2;
const Z1 = DEPTH / 2;
const RING_R = 0.95;
const WIRE = 0.09;

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function scoopNotch(g) {
  const notch = 0.16;
  const bottom = -Math.PI / 2;
  const p = g.pos;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const r = Math.hypot(x, y);
    const d = Math.abs(angDiff(Math.atan2(y, x), bottom));
    if (d >= notch || z < 0.4) continue;
    const u = Math.cos((d / notch) * Math.PI * 0.5);
    p[i + 2] = z + (0.15 - z) * u;
    if (r < R_IN + 1.6) {
      const target = R_IN - 0.05;
      const nr = r + (target - r) * u * 0.9;
      const s = nr / (r || 1);
      p[i] = x * s;
      p[i + 1] = y * s;
    }
  }
  return g;
}

function shell() {
  const profile = hoopProfile(R_IN, R, Z0, Z1, 0.38, 3);
  const g = revolveZ(profile, 96, true);
  return scoopNotch(g);
}

function skin() {
  const radius = R_IN + 0.35;
  const z = Z0 + 0.15;
  return discZ(radius, z, 16, 80, (x, y) => {
    const r = Math.hypot(x, y) / radius;
    const bump = Math.cos(r * Math.PI * 0.5);
    const ripple = 0.18 * Math.cos(Math.atan2(y, x) * 3) * Math.sin(r * Math.PI);
    return [0, 0, 1.15 * bump * (1 + ripple)];
  });
}

function leatherBand() {
  return transformGeom(torus(R + 0.08, 0.32, 64, 6), [0, 0, Z0 + 0.7], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
}

function tacks() {
  const parts = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R - 0.15;
    parts.push(transformGeom(sphere(0.18, 6, 4), [Math.cos(a) * r, Math.sin(a) * r, Z0 + 0.28], [1, 0, 0], [0, 1, 0], [0, 0, 1]));
  }
  return mergeGeoms(parts);
}

function hookAt(a) {
  const radial = [Math.cos(a), Math.sin(a), 0];
  const tangent = [-Math.sin(a), Math.cos(a), 0];
  const z = [0, 0, 1];
  const origin = [radial[0] * (R_IN + 0.15), radial[1] * (R_IN + 0.15), 1.15];
  // Local box: X along tangent, Y along radial, Z along the hoop axis.
  return transformGeom(box(0, 0, 0, 0.28, 0.7, 0.42), origin, tangent, radial, z);
}

function ringAt(a, dr, dz) {
  const radial = [Math.cos(a), Math.sin(a), 0];
  const tangent = [-Math.sin(a), Math.cos(a), 0];
  const up = [0, 0, 1];
  const cr = R_IN - 1.45 + dr;
  const origin = [radial[0] * cr, radial[1] * cr, 0.55 + dz];
  // Torus axis (local Z) becomes the tangent, so the ring hangs in the radial–Z plane.
  return transformGeom(torus(RING_R, WIRE, 10, 5), origin, radial, up, tangent);
}

const CLUSTER = [
  { dr: 0, dz: 0 },
  { dr: 0.28, dz: -0.95 },
  { dr: -0.12, dz: -1.25 },
  { dr: 0.36, dz: -1.85 },
];

export function buildDaf() {
  const staples = 68;
  const notch = 0.16;
  const bottom = -Math.PI / 2;
  const sectors = Array.from({ length: 8 }, () => []);
  const hooks = [];
  let used = 0;
  for (let i = 0; i < staples; i++) {
    const a = (i / staples) * Math.PI * 2;
    if (Math.abs(angDiff(a, bottom)) < notch) continue;
    used++;
    hooks.push(hookAt(a));
    const s = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 8;
    for (const off of CLUSTER) sectors[s].push(ringAt(a, off.dr, off.dz));
  }

  const jingleChildren = sectors.map((list, s) => {
    const a = -Math.PI + ((s + 0.5) / 8) * Math.PI * 2;
    return {
      name: `rings-${s}`,
      material: 'metal',
      geom: mergeGeoms(list),
      extras: { phase: s / 8, axis: [-Math.sin(a), Math.cos(a), 0] },
    };
  });

  return {
    name: 'instrument',
    children: [
      { name: 'shell', material: 'wood', geom: shell() },
      { name: 'band', material: 'leather', geom: leatherBand() },
      { name: 'tacks', material: 'metal', geom: tacks() },
      { name: 'hooks', material: 'metal', geom: mergeGeoms(hooks) },
      { name: 'part-skin', material: 'skin', morphName: 'hit', geom: skin() },
      { name: 'part-jingles', children: jingleChildren },
    ],
    notes: {
      staples: used,
      rings: used * CLUSTER.length,
      diameterCm: DIAMETER,
      depthCm: DEPTH,
      wallCm: WALL,
    },
  };
}

void geom;
