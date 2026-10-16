import { Art, P, smooth, line, circle, ellipse, shade, fillHatch, medallion, rect, lerpP, f } from '../lib.mjs';

// Concert pedal harp, side view, the player's side to the right: a straight column with a carved crown,
// the soundbox slanting back toward the player and widening to the base, the neck with its harmonic curve
// and a row of tuning discs, 47 strings (longest by the column; C strings drawn heavier, as they are coloured),
// and the pedal base. Proportions: ≈ 180 cm tall, ≈ 100 cm deep (≈ 1.85 px per cm).
export default function harp() {
  const a = new Art('harp');
  // Soundbox: front (soundboard) line A→B, back C→D
  const A = P(140, 344);
  const B = P(300, 116);
  const C = P(210, 350);
  const D = P(311, 122);
  const sbPath = `M${A.x} ${A.y}L${B.x} ${B.y}Q${B.x + 8} ${B.y - 5} ${D.x} ${D.y}` + smooth([D, P(298, 172), P(268, 252), P(236, 316), C], false, 0.5).replace(/^M[^C]*/, '') + 'Z';
  const sbY = (x) => A.y + ((B.y - A.y) * (x - A.x)) / (B.x - A.x); // soundboard height at x

  // Neck: harmonic curve, from the crown to the top of the soundbox
  const neckTop = [P(112, 46), P(140, 50), P(176, 68), P(214, 84), P(248, 74), P(280, 82), P(304, 104)];
  const neckBot = [P(306, 118), P(282, 98), P(250, 90), P(214, 100), P(174, 84), P(140, 68), P(118, 66)];
  const neck = smooth(neckTop, false, 0.5) + 'L' + smooth(neckBot, false, 0.5).replace(/^M/, '') + 'Z';
  const lowerEdge = (x) => {
    // y of the neck's lower edge at x (piecewise linear on the control points)
    const pts = neckBot.slice().reverse();
    for (let i = 0; i < pts.length - 1; i++) if (x >= pts[i].x && x <= pts[i + 1].x) return pts[i].y + ((pts[i + 1].y - pts[i].y) * (x - pts[i].x)) / (pts[i + 1].x - pts[i].x);
    return pts.at(-1).y;
  };

  a.add(medallion());
  a.add('<g transform="translate(205 206) scale(0.9) translate(-205 -200)">');

  // Base with feet and pedals (pedals reach out toward the player)
  const base = rect(96, 346, 126, 16, 3);
  a.path(base, 'd', 1.2);
  a.add(shade({ shape: base, box: { x: 94, y: 344, w: 130, h: 20 }, angle: 0, spacing: 1.4, width: 0.45, light: P(0, -6) }));
  a.path(`M104 362Q100 370 94 370M214 362Q218 370 224 370`, 'd', 1);
  let pedals = '';
  [[350, 246], [354, 240], [358, 250]].forEach(([y, x2]) => (pedals += `M222 ${y}L${x2} ${y}L${x2 + 3} ${y + 2}L${x2 - 1} ${y + 3}L222 ${y + 3}`));
  a.path(pedals, 'd', 0.8);

  // Column: straight, fluted, shaded on the right
  const col = `M106 346L108 74L122 74L124 346Z`;
  a.fillin(col);
  a.path(col, 'd', 1.3);
  a.add(shade({ shape: col, box: { x: 104, y: 70, w: 22, h: 280 }, angle: 90, spacing: 1.4, width: 0.45, light: P(-6, 0) }));
  a.path(line(P(111, 92), P(110.4, 330)) + line(P(115, 92), P(115, 330)), 'h', 0.4);
  a.path(`M104 346L104 334L126 334L126 346M106 334Q115 328 124 334`, 'd', 0.9);
  // Crown: stacked mouldings and a carved cap
  const crown = `M106 74L104 66Q115 60 126 66L124 74ZM103 66Q100 54 108 46Q115 40 122 46Q130 54 127 66`;
  a.path(crown, 'd', 1.1);
  a.add(fillHatch({ shape: `M103 66Q100 54 108 46Q115 40 122 46Q130 54 127 66Z`, box: { x: 100, y: 38, w: 30, h: 30 }, angle: 70, spacing: 1.5, width: 0.4 }));
  a.path(`M108 46Q115 30 122 46` + circle(115, 34, 3.2), 'd', 0.9);

  // Soundbox: soundboard face and the rounded back, shaded toward the player
  a.fillin(sbPath);
  a.path(sbPath, 'd', 1.5);
  a.add(shade({ shape: sbPath, box: { x: 136, y: 110, w: 180, h: 244 }, angle: 58, spacing: 1.6, width: 0.48, light: P(-22, -8) }));
  // Centre strip of the soundboard where the strings are anchored
  a.path(line(lerpP(A, C, 0.18), lerpP(B, D, 0.25)), 'd', 0.6);

  // Neck
  a.fillin(neck);
  a.path(neck, 'd', 1.4);
  a.add(shade({ shape: neck, box: { x: 108, y: 40, w: 204, h: 84 }, angle: 80, spacing: 1.5, width: 0.45, light: P(0, -6) }));

  // Strings: 47, vertical, from the discs under the neck to the soundboard
  let strs = { c: '', f: '', o: '' };
  let discs = '';
  const n = 47;
  for (let i = 0; i < n; i++) {
    const x = 146 + (i * (294 - 146)) / (n - 1);
    const y0 = lowerEdge(x) + 1;
    const y1 = sbY(x) - 2;
    const note = (n - 1 - i + 2) % 7; // index 0 = C (counting up from the top string, which is a G)
    const key = note === 0 ? 'c' : note === 3 ? 'f' : 'o';
    strs[key] += `M${f(x)} ${f(y0)}L${f(x)} ${f(y1)}`;
    discs += circle(x, y0 + 4, 0.9) + circle(x, y0 + 9, 0.9);
  }
  a.path(strs.o, 'str', 0.38);
  a.path(strs.f, 'str', 0.55);
  a.path(strs.c, 'str', 0.8);
  a.path(discs, 'h', 0.45);
  a.add('</g>');
  return a.done('Арфа');
}
