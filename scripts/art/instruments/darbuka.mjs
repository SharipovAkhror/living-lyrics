import { Art, P, smooth, ellipse, shade, fillHatch, medallion, line, f } from '../lib.mjs';

// Darbuka: goblet drum with a mother-of-pearl inlaid bowl, skin on top, flared foot.
export default function darbuka() {
  const a = new Art('darbuka');
  const cx = 200;
  const R = [P(276, 92), P(286, 128), P(274, 186), P(232, 246), P(220, 284), P(236, 336), P(252, 362)];
  const L = R.slice().reverse().map((p) => P(2 * cx - p.x, p.y));
  const shape = smooth([...R, ...L], true, 0.5);
  a.add(medallion());
  a.add('<g transform="rotate(-12 200 220)">');
  a.fillin(shape);
  a.path(shape, "d", 1.6);
  a.add(shade({ shape, box: { x: 110, y: 80, w: 190, h: 300 }, angle: 80, spacing: 2, width: 0.45, light: P(-12, 0) }));
  // Head: rim and skin
  a.add('<g class="skin">');
  a.path(ellipse(cx, 92, 76, 15), 'd', 1.6);
  a.path(ellipse(cx, 92, 70, 12.5), 'h', 0.5);
  a.add('</g>');
  a.path(ellipse(cx, 98, 77, 15.5), 'd', 0.8);
  // Inlay bands: zig-zag and a row of small hexagons
  const band = (y, wTop) => {
    let z = '';
    const n = 18;
    for (let i = 0; i < n; i++) {
      const x0 = cx - wTop + (2 * wTop * i) / n;
      const x1 = cx - wTop + (2 * wTop * (i + 0.5)) / n;
      const x2 = cx - wTop + (2 * wTop * (i + 1)) / n;
      z += `M${f(x0)} ${y}L${f(x1)} ${y - 6}L${f(x2)} ${y}`;
    }
    return z + line(P(cx - wTop, y + 2), P(cx + wTop, y + 2)) + line(P(cx - wTop + 2, y - 8), P(cx + wTop - 2, y - 8));
  };
  a.path(band(140, 82) + band(196, 64), 'd', 0.6);
  let hex = '';
  for (let i = 0; i < 9; i++) {
    const x = cx - 56 + i * 14;
    const y = 166;
    hex += `M${x} ${y - 5}L${x + 4.5} ${y - 2.5}L${x + 4.5} ${y + 2.5}L${x} ${y + 5}L${x - 4.5} ${y + 2.5}L${x - 4.5} ${y - 2.5}Z`;
  }
  a.path(hex, 'h', 0.55);
  // Neck ring and foot
  a.path(ellipse(cx, 284, 21, 4) + ellipse(cx, 362, 52, 9), 'd', 0.9);
  a.add(fillHatch({ shape: `M${cx - 21} 280L${cx + 21} 280L${cx + 21} 288L${cx - 21} 288Z`, box: { x: 170, y: 276, w: 60, h: 16 }, angle: 60, spacing: 1.3, width: 0.4, cross: true }));
  a.add('</g>');
  return a.done('Дарбука');
}
