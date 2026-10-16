import { Art, P, smooth, line, ellipse, shade, fillHatch, medallion, f } from '../lib.mjs';

// Violin (held upright on the knee in Arab and Andalusian practice): bouts, f-holes,
// fingerboard, scroll, bridge, tailpiece, four strings, and the bow beside it.
export default function violin() {
  const a = new Art('violin');
  const cx = 200;
  // Right half of the body outline, top to bottom (y 120 → 362)
  const R = [
    P(cx + 14, 122), P(cx + 46, 128), P(cx + 62, 150), P(cx + 58, 180),
    P(cx + 44, 196), P(cx + 38, 214), P(cx + 44, 234), P(cx + 66, 258),
    P(cx + 74, 296), P(cx + 62, 336), P(cx + 30, 358), P(cx, 362),
  ];
  const L = R.slice(0, -1).reverse().map((p) => P(2 * cx - p.x, p.y));
  const outline = smooth([P(cx, 120), ...R.slice(0, -1), P(cx, 362), ...L], true, 0.5);
  const purfling = smooth([P(cx, 125), ...R.slice(0, -1).map((p) => P(cx + (p.x - cx) * 0.93, 240 + (p.y - 240) * 0.965)), P(cx, 357), ...L.map((p) => P(cx + (p.x - cx) * 0.93, 240 + (p.y - 240) * 0.965))], true, 0.5);
  a.add(medallion());
  a.add('<g transform="rotate(-28 200 220) translate(0 -8)">');
  a.path(smooth([P(cx, 120), ...R.slice(0, -1), P(cx, 362), ...L].map((p) => P(p.x + 5, p.y + 3)), true, 0.5), 'd', 1);
  a.add(shade({ shape: smooth([P(cx, 120), ...R.slice(0, -1), P(cx, 362), ...L].map((p) => P(p.x + 5, p.y + 3)), true, 0.5), box: { x: 120, y: 110, w: 170, h: 260 }, angle: 60, spacing: 1.5, width: 0.5, light: P(-5, -3) }));
  a.fillin(outline);
  a.path(outline, 'd', 1.6);
  a.path(purfling, 'd', 0.5);
  a.add(shade({ shape: outline, box: { x: 120, y: 110, w: 170, h: 260 }, angle: 40, spacing: 2.6, width: 0.4, light: P(-20, -16) }));
  // f-holes
  const fhole = (s) =>
    `M${cx + s * 26} 212C${cx + s * 18} 222 ${cx + s * 32} 236 ${cx + s * 26} 252C${cx + s * 22} 262 ${cx + s * 24} 276 ${cx + s * 32} 280` +
    ellipse(cx + s * 27, 210, 2.6, 2.6) + ellipse(cx + s * 32.5, 282, 2.8, 2.8);
  a.path(fhole(-1) + fhole(1), 'd', 1);
  // Fingerboard
  const fb = `M${cx - 9} 34L${cx + 9} 34L${cx + 13} 236Q${cx} 242 ${cx - 13} 236Z`;
  a.path(fb, 'd', 1.1);
  a.add(fillHatch({ shape: fb, box: { x: cx - 15, y: 30, w: 30, h: 216 }, angle: 85, spacing: 1.4, width: 0.45 }));
  // Pegbox and scroll
  a.path(`M${cx - 8} 34L${cx - 7} 6Q${cx} -6 ${cx + 7} 6L${cx + 8} 34`, 'd', 1.1);
  a.path(`M${cx} 2C${cx - 9} -4 ${cx - 6} -16 ${cx + 2} -14C${cx + 9} -12 ${cx + 8} -2 ${cx + 1} -2C${cx - 4} -2 ${cx - 3} -9 ${cx + 1} -9`, 'd', 1.1);
  let pegs = '';
  for (const [y, s] of [[12, -1], [24, -1], [16, 1], [28, 1]]) {
    pegs += `M${cx + s * 8} ${y}L${cx + s * 20} ${y - 1}` + ellipse(cx + s * 25, y - 1.5, 5, 3.2, s * -8);
  }
  a.path(pegs, 'd', 0.9);
  // Bridge, tailpiece, chinrest
  a.path(`M${cx - 18} 262Q${cx} 256 ${cx + 18} 262L${cx + 16} 268L${cx - 16} 268Z`, 'd', 0.9);
  const tail = `M${cx - 9} 290L${cx + 9} 290L${cx + 6} 344Q${cx} 348 ${cx - 6} 344Z`;
  a.path(tail, 'd', 1);
  a.add(fillHatch({ shape: tail, box: { x: cx - 10, y: 288, w: 20, h: 62 }, angle: 80, spacing: 1.3, width: 0.45 }));
  a.path(`M${cx - 34} 346Q${cx - 14} 330 ${cx + 6} 350`, 'd', 0.9);
  // Strings
  [-4.5, -1.5, 1.5, 4.5].forEach((dx, i) => {
    a.path(`M${f(cx + dx * 1.2)} 292L${f(cx + dx * 2.2)} 260L${f(cx + dx * 0.9)} 34L${f(cx + (i < 2 ? -6 : 6))} ${[12, 24, 16, 28][i]}`, 'str', 0.55);
  });
  a.add('</g>');
  // Bow alongside
  a.path(`M58 328L330 74`, 'str', 0.6);
  a.path(`M54 322C140 246 236 158 326 68`, 'd', 1.2);
  a.path(ellipse(56, 326, 5, 8, -45), 'd', 0.9);
  a.path(line(P(330, 74), P(326, 68)), 'd', 1);
  return a.done('Скрипка');
}
