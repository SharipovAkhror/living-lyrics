import { Art, P, smooth, line, circle, shade, fillHatch, medallion, poly, rosette, rect, f } from '../lib.mjs';

// Choir: a large choirbook open on a lectern, as choirs sang from in cathedrals: two pages of chant
// on four-line staves with square notes, an illuminated initial, ribbon markers, brass corners on the boards,
// and the turned column and feet of the lectern. A sign for choral singing rather than a portrait of singers.
export default function choir() {
  const a = new Art('choir');
  const yb = 250; // bottom edge of the pages
  const yt = 90; // top edge
  const halfW = (v) => 148 - 18 * v;
  const lift = (u) => 11 * (1 - Math.exp(-Math.abs(u) * 6));
  const S = (u, v) => P(200 + u * halfW(v), yb - v * (yb - yt) - lift(u));
  const curveV = (v, u0, u1, n = 24) => smooth(Array.from({ length: n + 1 }, (_, i) => S(u0 + ((u1 - u0) * i) / n, v)), false, 0.5);
  const curveU = (u, v0, v1) => line(S(u, v0), S(u, v1));
  const page = (side) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push(S(side * (i / 20), 0));
    for (let i = 0; i <= 20; i++) pts.push(S(side, i / 20));
    for (let i = 20; i >= 0; i--) pts.push(S(side * (i / 20), 1));
    return poly(pts);
  };

  a.add(medallion());

  // Lectern: slanted board under the book, turned column, three feet
  const board = poly([P(42, 258), P(358, 258), P(350, 270), P(50, 270)]);
  a.path(board, 'd', 1.2);
  a.add(fillHatch({ shape: board, box: { x: 40, y: 254, w: 320, h: 20 }, angle: 0, spacing: 1.4, width: 0.42 }));
  const colR = [P(208, 270), P(209, 276), P(205, 282), P(205, 300), P(209, 306), P(209, 312), P(205, 318), P(206, 340), P(212, 348), P(214, 352)];
  const colL = colR.slice().reverse().map((p) => P(400 - p.x, p.y));
  const col = smooth(colR, false, 0.5) + 'L' + smooth(colL, false, 0.5).slice(1);
  a.fillin(col + 'Z');
  a.path(col, 'd', 1.2);
  a.add(shade({ shape: col + 'Z', box: { x: 182, y: 268, w: 36, h: 88 }, angle: 90, spacing: 1.3, width: 0.45, light: P(-6, 0) }));
  a.path(`M191 282L209 282M191 300L209 300M191 318L209 318`, 'h', 0.6);
  a.path(`M186 352Q160 356 132 368M214 352Q240 356 268 368M200 354L200 372`, 'd', 1.2);
  a.path(`M132 368l-6 1M268 368l6 1M200 372l0 4`, 'd', 1.6);

  // Boards (covers) slightly larger than the pages, with brass corners
  const coverL = poly([P(200, yb + 7), P(44, yb + 7), P(58, yt - 4), P(200, yt + 2)]);
  const coverR = poly([P(200, yb + 7), P(356, yb + 7), P(342, yt - 4), P(200, yt + 2)]);
  a.path(coverL + coverR, 'd', 1.1);
  a.path(line(P(46, yb + 10), P(354, yb + 10)), 'd', 0.8);
  let corners = '';
  for (const [x, y, sx] of [[44, yb + 7, 1], [356, yb + 7, -1], [58, yt - 4, 1], [342, yt - 4, -1]]) {
    const dy = y > 200 ? -1 : 1;
    corners += `M${x} ${y}L${x + sx * 16} ${y}L${x + sx * 4} ${y + dy * 13}Z` + circle(x + sx * 6, y + dy * 4, 1.6);
  }
  a.path(corners, 'd', 0.8);

  // Text block: stacked page edges along the bottom and the outer sides
  let edges = '';
  for (let k = 1; k <= 4; k++) {
    const d = k * 1.5;
    for (const side of [-1, 1]) {
      const pts = Array.from({ length: 21 }, (_, i) => S(side * (i / 20), 0)).map((p) => P(p.x + side * d * 0.4, p.y + d));
      edges += smooth(pts, false, 0.5);
      edges += line(P(S(side, 0).x + side * d * 0.4, S(side, 0).y + d), P(S(side, 1).x + side * d * 0.5, S(side, 1).y + d * 0.4));
    }
  }
  a.path(edges, 'h', 0.45);

  // Pages
  for (const side of [-1, 1]) {
    const pg = page(side);
    a.fillin(pg);
    a.path(pg, 'd', 1.3);
  }
  // Gutter shading near the spine
  for (const side of [-1, 1]) {
    a.add(shade({ shape: page(side), box: { x: 200 + (side < 0 ? -40 : 0), y: yt - 4, w: 40, h: yb - yt + 20 }, angle: 90, spacing: 1.4, width: 0.4, light: P(side * 14, 0) }));
  }
  a.path(curveU(0, 0, 1), 'd', 0.9);

  // Staves of four lines, square notes, text under each staff
  const rnd = (i) => {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  let staves = '';
  let notes = '';
  let words = '';
  const staffV = [0.86, 0.66, 0.46, 0.26];
  const dv = 0.025;
  let seed = 1;
  for (const side of [-1, 1]) {
    const u0 = side < 0 ? -0.9 : 0.1;
    const u1 = side < 0 ? -0.1 : 0.9;
    staffV.forEach((v0, si) => {
      const start = side < 0 && si === 0 ? u0 + 0.2 : u0; // room for the initial
      for (let k = 0; k < 4; k++) staves += curveV(v0 + k * dv, start, u1, 18);
      // Notes: a melody walking over lines and spaces; some stacked as two-note neumes
      let pos = 3;
      const n = Math.round((u1 - start) / 0.062);
      for (let i = 0; i < n; i++) {
        const u = start + 0.04 + i * 0.062 + (rnd(seed++) - 0.5) * 0.01;
        pos = Math.max(0, Math.min(6, pos + Math.round((rnd(seed++) - 0.5) * 3)));
        const v = v0 + (pos * dv) / 2;
        const c = S(u, v);
        const w = 3.6;
        const h = 3;
        notes += rect(c.x - w / 2, c.y - h / 2, w, h);
        if (rnd(seed++) > 0.72 && pos < 5) {
          const c2 = S(u, v + dv);
          notes += rect(c2.x - w / 2, c2.y - h / 2, w, h) + line(P(c.x + w / 2, c.y), P(c2.x + w / 2, c2.y));
        }
      }
      // Words of the text under the staff
      let u = start + 0.01;
      while (u < u1 - 0.06) {
        const len = 0.05 + rnd(seed++) * 0.1;
        const e = Math.min(u + len, u1 - 0.02);
        words += smooth([S(u, v0 - 0.045), S((u + e) / 2, v0 - 0.045), S(e, v0 - 0.045)], false, 0.5);
        u = e + 0.025;
      }
    });
  }
  a.path(staves, 'd', 0.55);
  a.add(`<path class="h" d="${notes}" fill="currentColor" stroke="none" opacity=".9"/>`);
  a.path(words, 'h', 0.9);
  // Illuminated initial on the left page: a framed square with a rosette
  const ic = S(-0.79, staffV[0] + 0.03);
  a.path(rect(ic.x - 14, ic.y - 15, 28, 28), 'd', 0.9);
  a.add(rosette(ic.x, ic.y - 1, 11, 8, { width: 0.6 }));

  // Ribbon markers from the spine, hanging over the bottom edge
  a.path(`M198 ${yb - 4}C196 ${yb + 14} 190 ${yb + 30} 186 ${yb + 44}L183 ${yb + 38}L180 ${yb + 46}C184 ${yb + 32} 190 ${yb + 14} 194 ${yb - 4}`, 'd', 0.8);
  a.path(`M203 ${yb - 4}C206 ${yb + 12} 212 ${yb + 24} 218 ${yb + 34}L220 ${yb + 28}L224 ${yb + 35}C218 ${yb + 22} 212 ${yb + 10} 207 ${yb - 4}`, 'd', 0.8);
  return a.done('Хор');
}
