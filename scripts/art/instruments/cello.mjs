import { Art, P, line, ellipse, circle, shade, fillHatch, medallion, boutOutline, scalePts, smooth, f } from '../lib.mjs';

// Cello in a slight three-quarter view: body with corners and deep ribs, f-holes with their notches
// on the bridge line, fingerboard reaching a third of the way down the body, pegbox with four pegs and a scroll,
// tailpiece with fine tuners, and the endpin. The bow lies alongside.
// Proportions (≈ 2.37 px per cm): body 75.5 cm, upper bout 34.5, waist 23.5, lower bout 44, neck to nut 28,
// fingerboard 58, bridge 40 cm below the top edge of the body, endpin drawn ≈ 22 cm out.
export const celloShape = (cx = 200, top = 137, len = 179, k = 1) => {
  const p = (x, t) => P(cx + x * k, top + t * len);
  return {
    upper: [p(0, 0), p(18, 0.02), p(32, 0.07), p(40, 0.15), p(41, 0.22), p(38.6, 0.3), p(37.4, 0.355)],
    cbout: [p(37.4, 0.355), p(31, 0.375), p(28.6, 0.42), p(28, 0.47), p(28.6, 0.52), p(31.2, 0.562), p(38.4, 0.585)],
    lower: [p(38.4, 0.585), p(45, 0.63), p(50.5, 0.7), p(52, 0.78), p(50, 0.87), p(42, 0.935), p(24, 0.985), p(0, 1)],
  };
};

/** f-hole: S-shaped stem between a small upper eye and a larger lower eye, with the two notches. */
export function fHole(cx, s, y0, y1, k = 1) {
  const h = y1 - y0;
  const c = (x, t) => P(cx + s * x * k, y0 + t * h);
  const mid = [c(18, 0.06), c(22, 0.22), c(22.6, 0.5), c(23.6, 0.74), c(28, 0.94)];
  const left = mid.map((p, i) => P(p.x - s * [0.4, 1.1, 1.5, 1.1, 0.4][i] * k, p.y));
  const right = mid.map((p, i) => P(p.x + s * [0.4, 1.1, 1.5, 1.1, 0.4][i] * k, p.y));
  const stem = smooth([...left, ...right.slice().reverse()], true, 0.5);
  const eyes = circle(mid[0].x - s * 0.6 * k, mid[0].y - 1.4 * k, 2.1 * k) + circle(mid[4].x + s * 0.6 * k, mid[4].y + 1.6 * k, 2.6 * k);
  const n = c(22.6, 0.5);
  const notches = line(P(n.x - s * 1.5 * k, n.y), P(n.x - s * 4.6 * k, n.y)) + line(P(n.x + s * 1.5 * k, n.y), P(n.x + s * 4.6 * k, n.y));
  return { stem, eyes, notches };
}

/** Pegbox walls rising from the nut into a scroll whose volute turns on the visible (right) side. k scales it. */
export function scrollPath(cx, pbTop, nutY, k = 1) {
  const vc = P(cx + 1.5 * k, pbTop - 6 * k);
  const a0 = 2.22;
  const T = Math.PI * 2.7;
  const r0 = 10 * k;
  const r1 = 2 * k;
  const at = (t) => {
    const r = r0 - ((r0 - r1) * t) / T;
    return P(vc.x + r * Math.cos(a0 + t), vc.y + r * Math.sin(a0 + t));
  };
  const spiral = [];
  for (let i = 0; i <= 48; i++) spiral.push(at((i / 48) * T));
  const start = spiral[0];
  const join = at(2 * Math.PI - a0);
  let d = `M${f(cx - 3.9 * k)} ${f(nutY)}L${f(start.x)} ${f(start.y)}`;
  d += smooth(spiral, false, 0.5).replace(/^M[^C]*/, '');
  d += `M${f(cx + 3.9 * k)} ${f(nutY)}L${f(cx + 4.6 * k)} ${f(pbTop + 3 * k)}Q${f(join.x + 1 * k)} ${f(pbTop + 1 * k)} ${f(join.x)} ${f(join.y)}`;
  return d + circle(vc.x + 0.4 * k, vc.y + 0.3 * k, 1.2 * k);
}

export default function cello() {
  const a = new Art('cello');
  const cx = 200;
  const top = 137;
  const len = 179;
  const bottom = top + len;
  const nut = 71;
  const fbEnd = 208;
  const bridgeY = 232;
  const pin = 368;

  const runs = celloShape(cx, top, len);
  const outline = boutOutline(runs, cx);
  const c0 = P(cx, top + len / 2);
  const inset = (r, kx, ky) => scalePts(r, c0, kx, ky);
  const purfling = boutOutline({ upper: inset(runs.upper, 0.93, 0.965), cbout: inset(runs.cbout, 0.9, 0.965), lower: inset(runs.lower, 0.94, 0.968) }, cx);
  const ribsRuns = { upper: runs.upper.map((p) => P(p.x + 8, p.y + 3)), cbout: runs.cbout.map((p) => P(p.x + 8, p.y + 3)), lower: runs.lower.map((p) => P(p.x + 8, p.y + 3)) };
  const ribs = boutOutline(ribsRuns, cx + 8);

  a.add(medallion());
  a.add('<g transform="rotate(19 200 205)">');

  // Endpin: collar, steel rod, point
  a.path(`M${cx - 5} ${bottom - 1}L${cx - 4} ${bottom + 7}L${cx + 4} ${bottom + 7}L${cx + 5} ${bottom - 1}`, 'd', 1);
  a.add(fillHatch({ shape: `M${cx - 5} ${bottom - 1}L${cx - 4} ${bottom + 7}L${cx + 4} ${bottom + 7}L${cx + 5} ${bottom - 1}Z`, box: { x: cx - 6, y: bottom - 2, w: 12, h: 10 }, angle: 80, spacing: 1.1, width: 0.4 }));
  a.path(`M${cx - 1.3} ${bottom + 7}L${cx - 1} ${pin - 6}L${cx} ${pin}L${cx + 1} ${pin - 6}L${cx + 1.3} ${bottom + 7}`, 'd', 0.9);

  // Ribs seen past the edge, then the top plate
  a.begin();
  a.path(ribs, 'd', 1.1);
  a.add(shade({ shape: ribs, box: { x: cx - 56, y: top - 4, w: 120, h: len + 12 }, angle: 64, spacing: 1.45, width: 0.5, light: P(-8, -3) }));
  a.hidden(outline);
  a.fillin(outline);
  a.path(outline, 'd', 1.6);
  a.path(purfling, 'd', 0.5);
  a.add(shade({ shape: outline, box: { x: cx - 56, y: top - 4, w: 112, h: len + 8 }, angle: 38, spacing: 2.4, width: 0.4, light: P(-18, -20) }));
  // Spruce grain, very light
  let grain = '';
  for (let x = cx - 50; x < cx + 52; x += 4.5) grain += line(P(x, top), P(x + 0.6, bottom));
  a.add(`<g clip-path="url(#cello-top)"><path class="h" d="${grain}" stroke-width="0.2" opacity=".7"/></g>`);
  a.defs += `<clipPath id="cello-top"><path d="${purfling}"/></clipPath>`;

  // f-holes, notched on the bridge line
  const fy0 = bridgeY - 24;
  const fy1 = bridgeY + 22;
  let fh = '';
  for (const s of [-1, 1]) {
    const { stem, eyes, notches } = fHole(cx, s, fy0, fy1);
    fh += stem + eyes + notches;
  }
  a.path(fh, 'd', 0.85);

  // Neck and fingerboard (ebony), nut
  a.path(`M${cx - 3.6} ${nut}L${cx - 5.6} ${top + 2}M${cx + 3.6} ${nut}L${cx + 5.6} ${top + 2}`, 'd', 1.1);
  const fb = `M${cx - 3.7} ${nut}L${cx + 3.7} ${nut}L${cx + 8.3} ${fbEnd}Q${cx} ${fbEnd + 3.5} ${cx - 8.3} ${fbEnd}Z`;
  a.path(fb, 'd', 1.1);
  a.add(fillHatch({ shape: fb, box: { x: cx - 10, y: nut - 2, w: 20, h: fbEnd - nut + 8 }, angle: 86, spacing: 1.25, width: 0.45 }));
  a.path(line(P(cx - 3.9, nut - 1.6), P(cx + 3.9, nut - 1.6)), 'd', 1);

  // Pegbox, pegs and scroll
  const pbTop = 38;
  a.path(scrollPath(cx, pbTop, nut - 1.6, 1), 'd', 1.05);
  a.path(`M${cx - 1.8} ${nut - 5}L${cx - 2.4} ${pbTop + 6}L${cx + 2.4} ${pbTop + 6}L${cx + 1.8} ${nut - 5}Z`, 'd', 0.6);
  a.add(fillHatch({ shape: `M${cx - 1.8} ${nut - 5}L${cx - 2.4} ${pbTop + 6}L${cx + 2.4} ${pbTop + 6}L${cx + 1.8} ${nut - 5}Z`, box: { x: cx - 3, y: pbTop + 4, w: 6, h: nut - pbTop }, angle: 85, spacing: 1, width: 0.4 }));
  // Pegs: two a side, on short shafts, with ear-shaped heads
  let pegs = '';
  for (const [y, s] of [[46, -1], [58, -1], [50, 1], [62, 1]]) {
    pegs += `M${cx + s * 4.4} ${y}L${cx + s * 13} ${y - 1}` + ellipse(cx + s * 18.5, y - 1.6, 5.4, 3.4, s * -10);
  }
  a.path(pegs, 'd', 0.85);

  // Bridge (arched, with feet), tailpiece with four fine tuners, saddle and tailgut
  a.path(`M${cx - 13} ${bridgeY + 3}L${cx - 12} ${bridgeY - 1}Q${cx} ${bridgeY - 5} ${cx + 12} ${bridgeY - 1}L${cx + 13} ${bridgeY + 3}L${cx + 7} ${bridgeY + 3}Q${cx} ${bridgeY} ${cx - 7} ${bridgeY + 3}Z`, 'd', 0.9);
  const tp0 = bridgeY + 20;
  const tail = `M${cx - 7.5} ${tp0}Q${cx} ${tp0 - 3} ${cx + 7.5} ${tp0}L${cx + 4.5} ${bottom - 14}Q${cx} ${bottom - 11} ${cx - 4.5} ${bottom - 14}Z`;
  a.path(tail, 'd', 1);
  a.add(fillHatch({ shape: tail, box: { x: cx - 9, y: tp0 - 4, w: 18, h: bottom - tp0 }, angle: 82, spacing: 1.2, width: 0.42 }));
  a.path([-4.8, -1.6, 1.6, 4.8].map((dx) => circle(cx + dx, tp0 + 5, 1.2)).join(''), 'd', 0.6);
  a.path(`M${cx - 3} ${bottom - 13}Q${cx} ${bottom - 3} ${cx + 3} ${bottom - 13}M${cx - 6} ${bottom - 1.5}L${cx + 6} ${bottom - 1.5}`, 'd', 0.8);

  // Strings: tailpiece → bridge → nut → pegs
  const pegFor = [[58, -1], [46, -1], [50, 1], [62, 1]];
  [-6, -2, 2, 6].forEach((dx, i) => {
    const [y, s] = pegFor[i];
    a.path(`M${f(cx + dx * 0.8)} ${tp0 + 4}L${f(cx + dx * 1.5)} ${bridgeY - 3}L${f(cx + dx * 0.45)} ${nut}L${f(cx + s * 1.5)} ${y}`, 'str', i < 2 ? 0.6 : 0.5);
  });
  a.add('</g>');

  // Bow, standing to the left of the instrument (≈ 73 cm)
  const b0 = P(64, 304);
  const b1 = P(136, 136);
  a.path(`M${b0.x + 6} ${b0.y - 4}L${b1.x + 3} ${b1.y + 4}`, 'str', 0.6);
  a.path(`M${b0.x} ${b0.y}Q${f((b0.x + b1.x) / 2 - 6)} ${f((b0.y + b1.y) / 2 - 2)} ${b1.x} ${b1.y}`, 'd', 1.2);
  const frog = `M${b0.x + 1} ${b0.y - 2}L${b0.x + 6} ${b0.y - 14}L${b0.x + 12} ${b0.y - 11}L${b0.x + 7} ${b0.y + 1}Z`;
  a.path(frog, 'd', 0.9);
  a.add(fillHatch({ shape: frog, box: { x: b0.x - 2, y: b0.y - 18, w: 18, h: 22 }, angle: 45, spacing: 1.2, width: 0.4 }));
  a.path(ellipse(b0.x - 1, b0.y + 4, 2.6, 4, 24), 'd', 0.8);
  a.path(line(P(b1.x, b1.y), P(b1.x + 3, b1.y + 4)), 'd', 1);
  return a.done('Виолончель');
}
