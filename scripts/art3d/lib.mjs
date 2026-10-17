/**
 * Procedural meshes and a meshopt glTF writer for instrument models.
 * Units in the builders are centimetres, Y up, +Z toward the camera.
 * `normalizeTree` then centres the model and scales its Y extent to 1.
 * Front faces are counter-clockwise seen from outside; `quad` flips a
 * winding when it does not match the outward hint.
 */

import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

export function geom() {
  return { pos: [], idx: [], morph: null };
}

export function add(g, x, y, z) {
  const i = g.pos.length / 3;
  g.pos.push(x, y, z);
  return i;
}

function faceNormal(g, a, b, c) {
  const p = g.pos;
  const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
  const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** Triangle whose winding matches the outward hint. */
export function tri(g, a, b, c, nx, ny, nz) {
  const n = faceNormal(g, a, b, c);
  if (n[0] * nx + n[1] * ny + n[2] * nz >= 0) g.idx.push(a, b, c);
  else g.idx.push(a, c, b);
}

/**
 * Quad a-b-c-d. The hint (nx, ny, nz) is the desired outward direction
 * at the face; the winding is flipped when the geometric normal disagrees.
 */
export function quad(g, a, b, c, d, nx, ny, nz) {
  if (a === b || c === d) return;
  const n = faceNormal(g, a, b, c);
  const area = Math.hypot(n[0], n[1], n[2]);
  if (area < 1e-10) return;
  if (n[0] * nx + n[1] * ny + n[2] * nz >= 0) g.idx.push(a, b, c, a, c, d);
  else g.idx.push(a, c, b, a, d, c);
}

export function computeNormals(g) {
  const n = new Float32Array(g.pos.length);
  const p = g.pos;
  for (let i = 0; i < g.idx.length; i += 3) {
    const a = g.idx[i] * 3, b = g.idx[i + 1] * 3, c = g.idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Revolve a cross-section around Z. Profile points are {r, z}, r ≥ 0. Closed walks the loop. */
export function revolveZ(profile, segs, closed = false) {
  const g = geom();
  const n = profile.length;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const ring = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      ring.push(add(g, Math.cos(a) * profile[i].r, Math.sin(a) * profile[i].r, profile[i].z));
    }
    rings.push(ring);
  }
  const steps = closed ? n : n - 1;
  for (let i = 0; i < steps; i++) {
    const i2 = (i + 1) % n;
    const dr = profile[i2].r - profile[i].r;
    const dz = profile[i2].z - profile[i].z;
    const len = Math.hypot(dr, dz) || 1;
    // Tangent (dr, dz) rotated so a cylinder walking +z has an outward +r normal.
    const nr = dz / len;
    const nz = -dr / len;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const a = ((s + 0.5) / segs) * Math.PI * 2;
      quad(g, rings[i][s], rings[i][s2], rings[i2][s2], rings[i2][s], Math.cos(a) * nr, Math.sin(a) * nr, nz);
    }
  }
  return g;
}

/** Disc in a plane of constant z, normal +Z, centred on the origin. Optional morph callback (x, y, z) => [dx, dy, dz]. */
export function discZ(radius, z, nRad, nAng, morphFn) {
  const g = geom();
  const rows = [];
  for (let i = 0; i <= nRad; i++) {
    const row = [];
    const rr = (i / nRad) * radius;
    const count = i === 0 ? 1 : nAng;
    for (let j = 0; j < count; j++) {
      const a = (j / nAng) * Math.PI * 2;
      row.push(add(g, Math.cos(a) * rr, Math.sin(a) * rr, z));
    }
    rows.push(row);
  }
  for (let i = 0; i < nRad; i++) {
    for (let j = 0; j < nAng; j++) {
      const j2 = (j + 1) % nAng;
      const inner = rows[i];
      const a = inner[Math.min(j, inner.length - 1)];
      const b = inner[Math.min(j2, inner.length - 1)];
      const c = rows[i + 1][j2];
      const d = rows[i + 1][j];
      if (a === b) tri(g, a, d, c, 0, 0, 1);
      else quad(g, a, b, c, d, 0, 0, 1);
    }
  }
  if (morphFn) {
    const morph = new Float32Array(g.pos.length);
    for (let v = 0; v < g.pos.length / 3; v++) {
      const d = morphFn(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);
      morph[v * 3] = d[0];
      morph[v * 3 + 1] = d[1];
      morph[v * 3 + 2] = d[2];
    }
    g.morph = morph;
  }
  return g;
}

/** Torus in the XY plane, tube axis Z, centred on the origin. */
export function torus(R, r, nMaj, nMin) {
  const g = geom();
  const rings = [];
  for (let i = 0; i < nMaj; i++) {
    const a = (i / nMaj) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ring = [];
    for (let j = 0; j < nMin; j++) {
      const b = (j / nMin) * Math.PI * 2;
      const rr = R + r * Math.cos(b);
      ring.push(add(g, ca * rr, sa * rr, r * Math.sin(b)));
    }
    rings.push(ring);
  }
  for (let i = 0; i < nMaj; i++) {
    const i2 = (i + 1) % nMaj;
    const a = ((i + 0.5) / nMaj) * Math.PI * 2;
    for (let j = 0; j < nMin; j++) {
      const j2 = (j + 1) % nMin;
      const b = ((j + 0.5) / nMin) * Math.PI * 2;
      const ox = Math.cos(a) * Math.cos(b);
      const oy = Math.sin(a) * Math.cos(b);
      const oz = Math.sin(b);
      quad(g, rings[i][j], rings[i][j2], rings[i2][j2], rings[i2][j], ox, oy, oz);
    }
  }
  return g;
}

/** Axis-aligned box with hard edges (unique vertices per face). sx, sy, sz are full sizes. */
export function box(cx, cy, cz, sx, sy, sz) {
  const g = geom();
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const face = (pts, nx, ny, nz) => {
    const id = pts.map((p) => add(g, p[0], p[1], p[2]));
    quad(g, id[0], id[1], id[2], id[3], nx, ny, nz);
  };
  face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1);
  face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0, 0, -1);
  face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0);
  face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0);
  face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0, 1, 0);
  face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, -1, 0);
  return g;
}

/** UV sphere centred on the origin. */
export function sphere(r, segs, rings) {
  const g = geom();
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const v = (i / rings) * Math.PI;
    const y = Math.cos(v) * r;
    const rr = Math.sin(v) * r;
    const row = [];
    const count = i === 0 || i === rings ? 1 : segs;
    for (let j = 0; j < count; j++) {
      const a = (j / segs) * Math.PI * 2;
      row.push(add(g, Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    rows.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      const a = rows[i][Math.min(j, rows[i].length - 1)];
      const b = rows[i][Math.min(j2, rows[i].length - 1)];
      const c = rows[i + 1][Math.min(j2, rows[i + 1].length - 1)];
      const d = rows[i + 1][Math.min(j, rows[i + 1].length - 1)];
      const ang = ((j + 0.5) / segs) * Math.PI * 2;
      const vv = ((i + 0.5) / rings) * Math.PI;
      const nx = Math.cos(ang) * Math.sin(vv);
      const ny = Math.cos(vv);
      const nz = Math.sin(ang) * Math.sin(vv);
      if (a === b) tri(g, a, c, d, nx, ny, nz);
      else if (c === d) tri(g, a, b, c, nx, ny, nz);
      else quad(g, a, b, c, d, nx, ny, nz);
    }
  }
  return g;
}

/**
 * Tube along a polyline. `morphAmp` adds a lateral morph along +X,
 * zero at the ends, sine-shaped: the string target `vibrate`.
 */
export function tube(points, radius, sides, morphAmp = 0) {
  const g = geom();
  const frames = framesFor(points);
  const rings = [];
  for (let i = 0; i < points.length; i++) {
    const ring = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const rx = frames[i].n[0] * c + frames[i].b[0] * sn;
      const ry = frames[i].n[1] * c + frames[i].b[1] * sn;
      const rz = frames[i].n[2] * c + frames[i].b[2] * sn;
      ring.push(add(g, points[i][0] + rx * radius, points[i][1] + ry * radius, points[i][2] + rz * radius));
    }
    rings.push(ring);
  }
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const a = ((s + 0.5) / sides) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const nx = frames[i].n[0] * c + frames[i].b[0] * sn;
      const ny = frames[i].n[1] * c + frames[i].b[1] * sn;
      const nz = frames[i].n[2] * c + frames[i].b[2] * sn;
      quad(g, rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s], nx, ny, nz);
    }
  }
  if (morphAmp) {
    const morph = new Float32Array(g.pos.length);
    for (let i = 0; i < points.length; i++) {
      const u = i / (points.length - 1);
      const dx = Math.sin(Math.PI * u) * morphAmp;
      for (let s = 0; s < sides; s++) {
        morph[rings[i][s] * 3] = dx;
      }
    }
    g.morph = morph;
  }
  return g;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function mul(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function addv(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function rotateAround(v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const k = cross(axis, v);
  return addv(addv(mul(v, c), mul(k, s)), mul(axis, dot(axis, v) * (1 - c)));
}

function framesFor(points) {
  const tans = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    return norm(sub(b, a));
  });
  let seed = Math.abs(tans[0][0]) > 0.85 ? [0, 0, 1] : [1, 0, 0];
  let normal = norm(sub(seed, mul(tans[0], dot(seed, tans[0]))));
  const frames = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const axis = cross(tans[i - 1], tans[i]);
      const s = Math.hypot(axis[0], axis[1], axis[2]);
      const c = Math.max(-1, Math.min(1, dot(tans[i - 1], tans[i])));
      if (s > 1e-6) normal = rotateAround(normal, norm(axis), Math.atan2(s, c));
      normal = norm(sub(normal, mul(tans[i], dot(normal, tans[i]))));
    }
    frames.push({ t: tans[i], n: normal, b: cross(tans[i], normal) });
  }
  return frames;
}

/** Map a mesh built in local axes (X, Y, Z) onto origin + px*X + py*Y + pz*Z. Morph deltas rotate, they do not translate. */
export function transformGeom(g, origin, xAxis, yAxis, zAxis) {
  const out = geom();
  out.idx = g.idx.slice();
  const p = g.pos;
  for (let i = 0; i < p.length; i += 3) {
    const px = p[i], py = p[i + 1], pz = p[i + 2];
    out.pos.push(
      origin[0] + px * xAxis[0] + py * yAxis[0] + pz * zAxis[0],
      origin[1] + px * xAxis[1] + py * yAxis[1] + pz * zAxis[1],
      origin[2] + px * xAxis[2] + py * yAxis[2] + pz * zAxis[2],
    );
  }
  if (g.morph) {
    const m = g.morph;
    const morph = new Float32Array(m.length);
    for (let i = 0; i < m.length; i += 3) {
      const px = m[i], py = m[i + 1], pz = m[i + 2];
      morph[i] = px * xAxis[0] + py * yAxis[0] + pz * zAxis[0];
      morph[i + 1] = px * xAxis[1] + py * yAxis[1] + pz * zAxis[1];
      morph[i + 2] = px * xAxis[2] + py * yAxis[2] + pz * zAxis[2];
    }
    out.morph = morph;
  }
  return out;
}

export function mergeGeoms(list) {
  const g = geom();
  const any = list.some((s) => s.morph);
  const parts = [];
  for (const src of list) {
    const base = g.pos.length / 3;
    for (let i = 0; i < src.pos.length; i++) g.pos.push(src.pos[i]);
    for (const i of src.idx) g.idx.push(i + base);
    if (any) parts.push(src.morph ?? new Float32Array(src.pos.length));
  }
  if (any) {
    const morph = new Float32Array(g.pos.length);
    let o = 0;
    for (const m of parts) {
      morph.set(m, o);
      o += m.length;
    }
    g.morph = morph;
  }
  return g;
}

/** Loft closed rings. Each ring is an array of [x, y, z] of equal length. */
export function loft(rings, outward = 1) {
  const g = geom();
  const ids = rings.map((ring) => ring.map((p) => add(g, p[0], p[1], p[2])));
  for (let i = 0; i < rings.length - 1; i++) {
    const n = rings[i].length;
    let cx = 0, cy = 0, cz = 0;
    for (const p of rings[i]) {
      cx += p[0]; cy += p[1]; cz += p[2];
    }
    cx /= n; cy /= n; cz /= n;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const p = rings[i][j];
      quad(
        g,
        ids[i][j], ids[i][j2], ids[i + 1][j2], ids[i + 1][j],
        (p[0] - cx) * outward, (p[1] - cy) * outward, (p[2] - cz) * outward,
      );
    }
  }
  return g;
}

export function walk(node, fn) {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}

export function countTris(root) {
  let t = 0;
  walk(root, (n) => {
    if (n.geom) t += n.geom.idx.length / 3;
  });
  return t;
}

/** Centre on the origin and scale so the Y extent is 1. Morph deltas scale, they do not shift. */
export function normalizeTree(root) {
  const geoms = [];
  walk(root, (n) => {
    if (n.geom) geoms.push(n.geom);
  });
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const g of geoms) {
    for (let i = 0; i < g.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = g.pos[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  const center = min.map((v, i) => (v + max[i]) / 2);
  const height = max[1] - min[1];
  if (!(height > 0)) throw new Error('model has no height');
  const s = 1 / height;
  for (const g of geoms) {
    for (let i = 0; i < g.pos.length; i += 3) {
      g.pos[i] = (g.pos[i] - center[0]) * s;
      g.pos[i + 1] = (g.pos[i + 1] - center[1]) * s;
      g.pos[i + 2] = (g.pos[i + 2] - center[2]) * s;
    }
    if (g.morph) {
      for (let i = 0; i < g.morph.length; i++) g.morph[i] *= s;
    }
  }
  return { min, max, center, height, scale: s };
}

function f32(src) {
  return src instanceof Float32Array ? src : Float32Array.from(src);
}

const ROLE = {
  wood: { color: [0.42, 0.24, 0.13, 1], rough: 0.72, metal: 0.02 },
  spruce: { color: [0.9, 0.82, 0.66, 1], rough: 0.62, metal: 0 },
  ebony: { color: [0.16, 0.12, 0.1, 1], rough: 0.45, metal: 0.04 },
  skin: { color: [0.84, 0.76, 0.62, 1], rough: 0.78, metal: 0 },
  leather: { color: [0.45, 0.28, 0.16, 1], rough: 0.7, metal: 0 },
  metal: { color: [0.78, 0.63, 0.35, 1], rough: 0.32, metal: 0.86 },
  string: { color: [0.93, 0.9, 0.84, 1], rough: 0.4, metal: 0.05 },
  seam: { color: [0.28, 0.16, 0.1, 1], rough: 0.55, metal: 0.02 },
  void: { color: [0.1, 0.07, 0.05, 1], rough: 0.9, metal: 0 },
};

/**
 * Write one instrument. `root` is the node tree from the builder (already normalised).
 * Returns the GLB bytes and a short report.
 */
export async function writeInstrument(root, file, meta) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  doc.getRoot().setDefaultScene(scene);

  const materials = {};
  for (const [name, spec] of Object.entries(ROLE)) {
    materials[name] = doc.createMaterial(name)
      .setBaseColorFactor(spec.color)
      .setRoughnessFactor(spec.rough)
      .setMetallicFactor(spec.metal)
      .setDoubleSided(false);
  }

  function addNode(parent, part) {
    const node = doc.createNode(part.name);
    if (part.extras) node.setExtras(part.extras);
    if (part.geom && part.geom.idx.length) {
      const g = part.geom;
      const prim = doc.createPrimitive().setMaterial(materials[part.material] ?? materials.wood);
      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(f32(g.pos)).setBuffer(buffer));
      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(computeNormals(g)).setBuffer(buffer));
      const idx = g.idx.length > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
      const mesh = doc.createMesh(part.name);
      if (g.morph && part.morphName) {
        const target = doc.createPrimitiveTarget(part.morphName).setAttribute(
          'POSITION',
          doc.createAccessor(part.morphName).setType('VEC3').setArray(f32(g.morph)).setBuffer(buffer),
        );
        prim.addTarget(target);
        mesh.setWeights([0]);
      }
      mesh.addPrimitive(prim);
      node.setMesh(mesh);
    }
    parent.addChild(node);
    for (const child of part.children ?? []) addNode(node, child);
    return node;
  }

  const rootNode = addNode(scene, root);

  const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const values = doc.createAccessor().setType('VEC4').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(times).setOutput(values).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel().setTargetNode(rootNode).setTargetPath('rotation').setSampler(sampler);
  doc.createAnimation('idle').addSampler(sampler).addChannel(channel);

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const bin = await io.writeBinary(doc);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, bin);

  const back = await io.readBinary(bin);
  const report = inspect(back);
  report.bytes = bin.byteLength;
  report.meta = meta;
  return report;
}

function inspect(doc) {
  const nodes = doc.getRoot().listNodes();
  const names = nodes.map((n) => n.getName());
  const morphs = [];
  let tris = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  // meshopt quantization stores a scale and translation on the node. Bounds are in world space.
  const visit = (node, ps, pt) => {
    const s = node.getScale();
    const t = node.getTranslation();
    const scale = [ps[0] * s[0], ps[1] * s[1], ps[2] * s[2]];
    const pos = [pt[0] + t[0] * ps[0], pt[1] + t[1] * ps[1], pt[2] + t[2] * ps[2]];
    const mesh = node.getMesh();
    if (mesh) {
      const targets = mesh.getExtras()?.targetNames;
      if (targets) morphs.push(`${mesh.getName()}:${targets.join(',')}`);
      for (const prim of mesh.listPrimitives()) {
        const idx = prim.getIndices();
        if (idx) tris += idx.getCount() / 3;
        const attr = prim.getAttribute('POSITION');
        if (!attr) continue;
        for (let i = 0; i < attr.getCount(); i++) {
          const e = attr.getElement(i, [0, 0, 0]);
          for (let k = 0; k < 3; k++) {
            const v = pos[k] + e[k] * scale[k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
          }
        }
      }
    }
    for (const child of node.listChildren()) visit(child, scale, pos);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) visit(child, [1, 1, 1], [0, 0, 0]);
  }
  const clips = doc.getRoot().listAnimations().map((a) => a.getName());
  return { names, morphs, tris, min, max, clips, height: max[1] - min[1] };
}

/** A rounded-rectangle cross-section of the frame, walked counter-clockwise in the (r, z) plane. */
export function hoopProfile(rIn, rOut, z0, z1, rad, nCorner = 3) {
  const pts = [];
  const push = (r, z) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last.r - r, last.z - z) > 1e-4) pts.push({ r, z });
  };
  const corner = (cr, cz, a0, a1) => {
    for (let i = 0; i <= nCorner; i++) {
      const a = a0 + ((a1 - a0) * i) / nCorner;
      push(cr + Math.cos(a) * rad, cz + Math.sin(a) * rad);
    }
  };
  // CCW: back face (+r), outer wall (+z), front face (−r), inner wall (−z).
  corner(rOut - rad, z0 + rad, -Math.PI / 2, 0);
  corner(rOut - rad, z1 - rad, 0, Math.PI / 2);
  corner(rIn + rad, z1 - rad, Math.PI / 2, Math.PI);
  corner(rIn + rad, z0 + rad, Math.PI, Math.PI * 1.5);
  return pts;
}
