import { Art, P, ellipse, shade, medallion, circle, onEllipse, stipple, hideUnder, fillHatch, poly, f } from '../lib.mjs';

// Riq: a small frame drum seen in three-quarter view from the head side. The wooden frame
// (inlaid with mother-of-pearl) has five slots; in each, two pairs of brass cymbals sit on a pin that runs
// parallel to the drum's axis, so the cymbals lie parallel to the head and stick out past the frame.
// Proportions (≈ 12.4 px per cm): frame ≈ 22 cm across and 6 cm deep, cymbals ≈ 4.5 cm.
const bbox = (pts) => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - 2;
  const y = Math.min(...ys) - 2;
  return { x, y, w: Math.max(...xs) - x + 4, h: Math.max(...ys) - y + 4 };
};

export default function riq() {
  const a = new Art('riq');
  const c = P(194, 192);
  const R = 132;
  const k = 0.8; // cos of the viewing angle: the head is an ellipse R × kR
  const tilt = -18;
  const v = P(Math.sin((-tilt * Math.PI) / 180), Math.cos((-tilt * Math.PI) / 180)); // projected drum axis (toward the back)
  const depth = 44;
  const off = (p, t) => P(p.x + v.x * depth * t, p.y + v.y * depth * t);
  const front = ellipse(c.x, c.y, R, R * k, tilt);
  const back = ellipse(c.x + v.x * depth, c.y + v.y * depth, R, R * k, tilt);
  const headR = R - 6;
  const head = ellipse(c.x, c.y, headR, headR * k, tilt);
  const rj = 28; // cymbal radius
  const slots = [0, 1, 2, 3, 4].map((i) => ((i * 72 + 34) * Math.PI) / 180);
  const axial = [0.74, 0.6, 0.36, 0.22]; // back → front: two pairs on each pin

  a.add(medallion());
  // Cymbal stacks. Each disc is parallel to the head (same ellipse), stacked along the axis;
  // a disc hides the ones behind it, and the whole stack is hidden inside the frame by the front face.
  const discs = [];
  for (const s of slots) {
    const base = onEllipse(c.x, c.y, R - 2, (R - 2) * k, s, tilt);
    const stack = axial.map((t) => off(base, t));
    discs.push(stack);
  }
  const disc = (p, r) => ellipse(p.x, p.y, r, r * k, tilt);
  const allDiscs = discs.flat().map((p) => disc(p, rj));

  // Frame wall seen past the front rim, shaded; hidden under the head and the cymbals
  a.begin();
  a.path(back, 'd', 1.2);
  a.add(shade({ shape: back, box: { x: 40, y: 50, w: 330, h: 320 }, angle: 72, spacing: 1.5, width: 0.5, light: P(-v.x * depth, -v.y * depth) }));
  a.hidden([front, ...allDiscs]);
  // Mother-of-pearl inlay along the visible wall: small lozenges between the slots
  let inlay = '';
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    if (Math.sin(t) < 0.18) continue;
    if (slots.some((s) => Math.abs(Math.atan2(Math.sin(t - s), Math.cos(t - s))) < 0.3)) continue;
    const p = off(onEllipse(c.x, c.y, R, R * k, t, tilt), 0.5);
    inlay += `M${f(p.x - 2.6)} ${f(p.y)}L${f(p.x)} ${f(p.y - 3.4)}L${f(p.x + 2.6)} ${f(p.y)}L${f(p.x)} ${f(p.y + 3.4)}Z`;
  }
  a.add(hideUnder(`<path class="h" d="${inlay}" stroke-width="0.5"/>`, [front, ...allDiscs]));

  // Slot windows in the visible wall (dark inside)
  const windows = [];
  for (const s of slots) {
    if (Math.sin(s) < 0.6) continue;
    const d = 0.25;
    const arc = (t) => Array.from({ length: 7 }, (_, i) => off(onEllipse(c.x, c.y, R, R * k, s - d + (2 * d * i) / 6, tilt), t));
    const pts = [...arc(0.1), ...arc(0.86).reverse()];
    windows.push({ d: poly(pts), box: bbox(pts) });
  }

  let jingles = '';
  for (const stack of discs) {
    stack.forEach((p, i) => {
      const inFront = stack.slice(i + 1).map((q) => disc(q, rj));
      const body = `<path class="d" pathLength="1" d="${disc(p, rj)}" stroke-width="${i === stack.length - 1 ? 1 : 0.8}"/>` + `<path class="h" d="${disc(p, rj * 0.42)}" stroke-width="0.5"/>`;
      if (inFront.length) {
        const h = hideUnder(body, inFront);
        a.defs += h.defs;
        jingles += h.svg;
      } else {
        const sh = shade({ shape: disc(p, rj), box: { x: p.x - rj - 2, y: p.y - rj - 2, w: 2 * rj + 4, h: 2 * rj + 4 }, angle: 30, spacing: 1.5, width: 0.4, light: P(-8, -9) });
        a.defs += sh.defs;
        jingles += body + sh.svg + `<path class="d" pathLength="1" d="${circle(p.x, p.y, 1.6)}" stroke-width="0.7"/>`;
      }
    });
  }
  // Windows: hatched, under the cymbals, outside the front face
  const winSvg = windows.map((w) => `<path class="d" pathLength="1" d="${w.d}" stroke-width="0.8"/>`).join('');
  const winFill = windows.map((w) => fillHatch({ shape: w.d, box: w.box, angle: -20, spacing: 1.3, width: 0.45 }));
  winFill.forEach((x) => (a.defs += x.defs));
  const allFront = discs.map((st) => disc(st.at(-1), rj));
  a.add(hideUnder(winSvg + winFill.map((x) => x.svg).join(''), [front, ...allFront]));
  a.add(hideUnder(jingles, front));
  // Pins: short lines through each stack along the axis, visible outside the frame only
  let pins = '';
  for (const stack of discs) pins += `M${f(stack[0].x)} ${f(stack[0].y)}L${f(stack.at(-1).x)} ${f(stack.at(-1).y)}`;
  a.add(hideUnder(`<path class="h" d="${pins}" stroke-width="0.6"/>`, [front, ...allFront]));

  // Front rim and the skin head (glued over the edge)
  a.add('<g class="skin">');
  a.fillin(front);
  a.path(front, 'd', 1.7);
  a.path(head, 'd', 0.8);
  a.path(stipple(c.x, c.y, headR, headR * k, 220, tilt, 0.94), 'h', 0.42);
  a.add(shade({ shape: head, box: { x: 50, y: 70, w: 300, h: 250 }, angle: 28, spacing: 2.8, width: 0.36, light: P(-28, -26) }));
  a.add('</g>');
  return a.done('Рик');
}
