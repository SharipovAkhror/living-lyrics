// Geometry and engraving helpers for the instrument illustrations.
// Conventions (see docs/methodology/09-instruments.md):
//   viewBox 0 0 400 400, stroke = currentColor, fill = none.
//   .d     — contour strokes, drawn in on entrance (pathLength = 1)
//   .h     — hatching (engraved shading), fades in after the contours
//   .fillin— faint tonal fill under hatching
//   .str   — strings (vibrate with the music's loudness)
//   .skin  — membranes (pulse with the music's loudness)

export const f = (n) => +n.toFixed(1);
export const P = (x, y) => ({ x, y });
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpP = (a, b, t) => P(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
export const rot = (p, c, deg) => {
  const r = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return P(c.x + dx * Math.cos(r) - dy * Math.sin(r), c.y + dx * Math.sin(r) + dy * Math.cos(r));
};

let uid = 0;
export const id = (p) => `${p}${++uid}`;
export function resetIds(prefix) {
  uid = 0;
  idPrefix = prefix;
}
let idPrefix = 'x';
export const gid = (p) => `${idPrefix}-${p}-${++uid}`;

/** Closed polygon path through points. */
export function poly(pts, close = true) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + (close ? 'Z' : '');
}

/** Smooth closed curve through points (Catmull-Rom → cubic Bézier). */
export function smooth(pts, close = true, tension = 0.5) {
  tension = Math.min(tension, 0.6);
  const n = pts.length;
  const get = (i) => (close ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  const last = close ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const c1 = P(p1.x + ((p2.x - p0.x) * tension) / 3, p1.y + ((p2.y - p0.y) * tension) / 3);
    const c2 = P(p2.x - ((p3.x - p1.x) * tension) / 3, p2.y - ((p3.y - p1.y) * tension) / 3);
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d + (close ? 'Z' : '');
}

/** Ellipse as a path of two arcs (drawable with pathLength). */
export function ellipse(cx, cy, rx, ry, rotDeg = 0) {
  const a = rot(P(cx - rx, cy), P(cx, cy), rotDeg);
  const b = rot(P(cx + rx, cy), P(cx, cy), rotDeg);
  return `M${f(a.x)} ${f(a.y)}A${f(rx)} ${f(ry)} ${f(rotDeg)} 1 0 ${f(b.x)} ${f(b.y)}A${f(rx)} ${f(ry)} ${f(rotDeg)} 1 0 ${f(a.x)} ${f(a.y)}Z`;
}
export const circle = (cx, cy, r) => ellipse(cx, cy, r, r);

export function line(a, b) {
  return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
}

/** Parallel hatch lines covering a box, at an angle; returned as one path. */
export function hatchLines(box, angleDeg, spacing, jitter = 0) {
  const { x, y, w, h } = box;
  const c = P(x + w / 2, y + h / 2);
  const R = Math.hypot(w, h) / 2 + spacing;
  let d = '';
  let k = 0;
  for (let s = -R; s <= R; s += spacing) {
    const j = jitter ? Math.sin(k * 12.9898) * jitter : 0;
    const a = rot(P(c.x - R, c.y + s + j), c, angleDeg);
    const b = rot(P(c.x + R, c.y + s + j), c, angleDeg);
    d += line(a, b);
    k++;
  }
  return d;
}

/**
 * Engraved shading on the shadow side of a shape: hatch lines clipped to `shape`
 * and masked so they only appear where the shape, shifted toward the light, does not cover it.
 */
export function shade({ shape, box, angle = 35, spacing = 3, width = 0.55, light = P(-14, -10), cross = false, extraMask = '' }) {
  const clip = gid('clip');
  const mask = gid('mask');
  const defs = `<clipPath id="${clip}"><path d="${shape}"/></clipPath><mask id="${mask}" maskUnits="userSpaceOnUse" x="${box.x - 40}" y="${box.y - 40}" width="${box.w + 80}" height="${box.h + 80}"><rect x="${box.x - 40}" y="${box.y - 40}" width="${box.w + 80}" height="${box.h + 80}" fill="#fff"/><path d="${shape}" transform="translate(${light.x} ${light.y})" fill="#000"/>${extraMask}</mask>`;
  let body = `<path class="h" d="${hatchLines(box, angle, spacing)}" stroke-width="${width}"/>`;
  if (cross) body += `<path class="h" d="${hatchLines(box, angle + 70, spacing * 1.35)}" stroke-width="${width * 0.8}"/>`;
  return { defs, svg: `<g clip-path="url(#${clip})" mask="url(#${mask})">${body}</g>` };
}

/** Uniform hatching inside a shape (e.g. dark wood of a fingerboard). */
export function fillHatch({ shape, box, angle = 45, spacing = 2.2, width = 0.5, cross = false }) {
  const clip = gid('clip');
  const defs = `<clipPath id="${clip}"><path d="${shape}"/></clipPath>`;
  let body = `<path class="h" d="${hatchLines(box, angle, spacing)}" stroke-width="${width}"/>`;
  if (cross) body += `<path class="h" d="${hatchLines(box, angle + 90, spacing)}" stroke-width="${width * 0.85}"/>`;
  return { defs, svg: `<g clip-path="url(#${clip})">${body}</g>` };
}

/** Geometric rosette: rings, an n-fold interlaced star and a petal ring. */
export function rosette(cx, cy, r, n = 8, opts = {}) {
  const { petals = true, width = 0.8 } = opts;
  let d = circle(cx, cy, r) + circle(cx, cy, r * 0.86);
  // Star {2n / (n-1)} as two interlaced n-gons rotated by half a step → classic 8- or 12-fold star.
  const star = (rr, offset) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      pts.push(P(cx + rr * Math.cos(a), cy + rr * Math.sin(a)));
    }
    let s = '';
    const step = Math.floor(n / 2) - 1 || 1;
    for (let i = 0; i < n; i++) s += line(pts[i], pts[(i + step) % n]);
    return s;
  };
  d += star(r * 0.84, -Math.PI / 2) + star(r * 0.84, -Math.PI / 2 + Math.PI / n);
  d += circle(cx, cy, r * 0.3);
  let p = '';
  if (petals) {
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const a1 = a - Math.PI / (n * 2);
      const a2 = a + Math.PI / (n * 2);
      const o1 = P(cx + r * 0.86 * Math.cos(a1), cy + r * 0.86 * Math.sin(a1));
      const o2 = P(cx + r * 0.86 * Math.cos(a2), cy + r * 0.86 * Math.sin(a2));
      const tip = P(cx + r * 0.62 * Math.cos(a), cy + r * 0.62 * Math.sin(a));
      p += `M${f(o1.x)} ${f(o1.y)}Q${f(cx + r * 0.7 * Math.cos(a1))} ${f(cy + r * 0.7 * Math.sin(a1))} ${f(tip.x)} ${f(tip.y)}Q${f(cx + r * 0.7 * Math.cos(a2))} ${f(cy + r * 0.7 * Math.sin(a2))} ${f(o2.x)} ${f(o2.y)}`;
    }
  }
  // Tiny centre flower
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p += circle(cx + r * 0.17 * Math.cos(a), cy + r * 0.17 * Math.sin(a), r * 0.09);
  }
  return `<path class="d" pathLength="1" d="${d}" stroke-width="${width}"/><path class="h" d="${p}" stroke-width="${width * 0.7}"/>`;
}

/** Dotted inlay along a polyline (mother-of-pearl border). */
export function dots(pts, every = 6, r = 0.9) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.floor(len / every));
    for (let k = 0; k < n; k++) {
      const p = lerpP(a, b, (k + 0.5) / n);
      d += circle(p.x, p.y, r);
    }
  }
  return d;
}

/** Faint circular medallion shared by all illustrations: hairline rings and a 16-point star border. */
export function medallion(cx = 200, cy = 200, r = 186) {
  let d = circle(cx, cy, r) + circle(cx, cy, r - 5);
  let t = '';
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const p1 = P(cx + (r - 5) * Math.cos(a), cy + (r - 5) * Math.sin(a));
    const p2 = P(cx + (r - (i % 2 ? 8 : 11)) * Math.cos(a), cy + (r - (i % 2 ? 8 : 11)) * Math.sin(a));
    t += line(p1, p2);
  }
  return `<g class="frame" opacity="0.32"><path class="d" pathLength="1" d="${d}" stroke-width="0.6"/><path class="h" d="${t}" stroke-width="0.45"/></g>`;
}

export function svgDoc(title, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${title}"><defs>${defs}</defs>${body}</svg>\n`;
}

/** Collects defs + body fragments. */
export class Art {
  constructor(prefix) {
    resetIds(prefix);
    this.defs = '';
    this.parts = [];
  }
  add(x) {
    if (typeof x === 'string') this.parts.push(x);
    else {
      this.defs += x.defs;
      this.parts.push(x.svg);
    }
    return this;
  }
  path(d, cls = 'd', w = 1.4, extra = '') {
    const pl = cls.split(' ').includes('d') ? ' pathLength="1"' : '';
    this.parts.push(`<path class="${cls}"${pl} d="${d}" stroke-width="${w}"${extra}/>`);
    return this;
  }
  fillin(d) {
    this.parts.push(`<path class="fillin" d="${d}" fill="currentColor" stroke="none"/>`);
    return this;
  }
  done(title) {
    return svgDoc(title, this.defs, this.parts.join(''));
  }
}
