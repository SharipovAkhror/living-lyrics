import { Art, P, smooth, ellipse, shade, fillHatch, medallion, stipple, line, f } from '../lib.mjs';

// Tabla: the pair, as the player sees them. Dayan (right, wood, smaller) and bayan (left, metal, larger).
// The 360p frame (I Have Come Alive, 535 s) is a wide stage shot and does not resolve the heads,
// so the drawing follows measured sets rather than that frame.
// Dayan head 14 cm (5.5 in, the usual professional size) and bayan head 23.5 cm (9.25 in).
// Heights about 26 cm and 28 cm. India Instruments describes the goatskin, the syahi paste,
// the rawhide straps and the wooden wedges, and a copper bayan near 9 in
// (https://www.india-instruments.com/construction.html). Banjira's pro set gives the inch sizes
// (dayan head 5.25 in, height about 10 in; bayan head 9.25 in, height about 11 in).
// The bayan syahi sits off the centre, toward the player; the dayan syahi is centred.
// That offset is the usual head, not a measurement taken off one drum, and the frame does not show it.
// Scale ≈ 5.2 px/cm on the heads.
export default function tabla() {
  const a = new Art('tabla');
  const px = 5.2;

  // Bayan, viewer's left. Head foreshortened, bowl below.
  const bx = 132;
  const by = 168;
  const bRx = (23.5 / 2) * px;
  const bRy = bRx * 0.42;
  const bayanHead = ellipse(bx, by, bRx, bRy);
  // Bulbous copper bowl.
  // Copper pot: wide under the head, round through the belly, a small foot. Not a point.
  const bowlR = [
    P(bx + bRx * 0.9, by + 8),
    P(bx + bRx * 1.02, by + 34),
    P(bx + bRx * 0.96, by + 64),
    P(bx + bRx * 0.74, by + 94),
    P(bx + bRx * 0.4, by + 114),
    P(bx + bRx * 0.14, by + 120),
    P(bx, by + 121),
  ];
  const bowlL = bowlR.slice().reverse().map((p) => P(2 * bx - p.x, p.y));
  const bowl = smooth([...bowlR, ...bowlL], true, 0.5);

  // Dayan, viewer's right. Narrower, taller in proportion, wooden.
  const dx = 268;
  const dy = 176;
  const dRx = (14 / 2) * px;
  const dRy = dRx * 0.42;
  const dayanHead = ellipse(dx, dy, dRx, dRy);
  const shellR = [
    P(dx + dRx * 0.96, dy + 4),
    P(dx + dRx * 0.84, dy + 28),
    P(dx + dRx * 0.62, dy + 62),
    P(dx + dRx * 0.7, dy + 96),
    P(dx + dRx * 0.5, dy + 124),
    P(dx, dy + 128),
  ];
  const shellL = shellR.slice().reverse().map((p) => P(2 * dx - p.x, p.y));
  const shell = smooth([...shellR, ...shellL], true, 0.48);

  a.add(medallion());
  a.add('<g transform="rotate(-6 200 210)">');

  // Bodies first, tucked under the heads.
  a.begin();
  a.fillin(bowl);
  a.path(bowl, 'd', 1.45);
  a.add(shade({ shape: bowl, box: { x: bx - bRx - 16, y: by, w: bRx * 2 + 36, h: 130 }, angle: 78, spacing: 1.8, width: 0.42, light: P(-14, -4) }));
  // A few hammer facets on the copper, as light bands, not a copied pattern.
  let facets = '';
  for (let i = -2; i <= 2; i++) {
    const x = bx + i * 16;
    facets += `M${f(x)} ${by + 18}Q${f(x + 6)} ${by + 60} ${f(x - 2)} ${by + 100}`;
  }
  a.add(`<g clip-path="url(#tabla-bowl)"><path class="h" d="${facets}" stroke-width="0.35"/></g>`);
  a.defs += `<clipPath id="tabla-bowl"><path d="${bowl}"/></clipPath>`;
  a.hidden(bayanHead);

  a.begin();
  a.fillin(shell);
  a.path(shell, 'd', 1.4);
  a.add(shade({ shape: shell, box: { x: dx - dRx - 10, y: dy, w: dRx * 2 + 24, h: 140 }, angle: 84, spacing: 1.7, width: 0.42, light: P(-10, -4) }));
  // Turned rings on the wooden shell.
  let rings = '';
  for (const yy of [dy + 34, dy + 42, dy + 92, dy + 100]) {
    const w = dRx * (yy < dy + 70 ? 0.72 : 0.58);
    rings += ellipse(dx, yy, w, w * 0.28);
  }
  a.path(rings, 'd', 0.6);
  a.hidden(dayanHead);

  // Rawhide straps and, on the dayan, the wooden wedges (gatta).
  let straps = '';
  const strap = (x, y0, y1, half, n) => {
    let d = '';
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const ang = Math.PI * (0.15 + 0.7 * t);
      const sx = x + Math.cos(ang) * half;
      d += line(P(sx, y0 + 8), P(sx + (i - n / 2) * 0.4, y1));
    }
    return d;
  };
  straps += strap(bx, by, by + 112, bRx * 0.78, 8);
  straps += strap(dx, dy, dy + 116, dRx * 0.72, 6);
  // Straps lace the shell. Clip them to the bodies so they do not hang past the foot.
  a.defs += `<clipPath id="tabla-straps"><path d="${bowl}"/><path d="${shell}"/></clipPath>`;
  a.add(`<g clip-path="url(#tabla-straps)"><path class="d" pathLength="1" d="${straps}" stroke-width="0.55"/></g>`);
  // Wedges between shell and straps, dayan only. Four, the usual visible set, not a counted museum piece.
  let wedges = '';
  for (let i = 0; i < 4; i++) {
    const yy = dy + 48 + i * 16;
    const side = i % 2 ? 1 : -1;
    const x = dx + side * dRx * 0.62;
    wedges += `M${f(x - 3)} ${f(yy)}L${f(x + 3)} ${f(yy - 2)}L${f(x + 2.4)} ${f(yy + 7)}L${f(x - 3.2)} ${f(yy + 6)}Z`;
  }
  a.path(wedges, 'd', 0.7);
  a.add(fillHatch({ shape: wedges, box: { x: dx - dRx, y: dy + 40, w: dRx * 2, h: 80 }, angle: 40, spacing: 1.3, width: 0.35 }));

  // Heads. Each membrane is its own .skin so the pulse scales the head, syahi included.
  const syahi = (cx, cy, rx, ry) => {
    let d = ellipse(cx, cy, rx, ry);
    // The paste is built in rings. A few of them, not a photograph of one head.
    d += ellipse(cx, cy, rx * 0.72, ry * 0.72);
    d += ellipse(cx, cy, rx * 0.4, ry * 0.4);
    return d;
  };

  a.add('<g class="skin">');
  a.fillin(bayanHead);
  a.path(bayanHead, 'd', 1.45);
  a.path(ellipse(bx, by, bRx - 5, bRy - 2.2), 'h', 0.45);
  a.path(stipple(bx, by, bRx - 7, bRy - 3, 140), 'h', 0.35);
  // Off-centre syahi, toward the near rim (down, toward the player).
  const bSy = syahi(bx + 6, by + bRy * 0.28, bRx * 0.34, bRy * 0.46);
  a.path(bSy, 'h', 0.7, ' fill="currentColor" fill-opacity="0.55"');
  a.add('</g>');

  a.add('<g class="skin">');
  a.fillin(dayanHead);
  a.path(dayanHead, 'd', 1.4);
  a.path(ellipse(dx, dy, dRx - 4, dRy - 1.8), 'h', 0.45);
  a.path(stipple(dx, dy, dRx - 5, dRy - 2.2, 90), 'h', 0.35);
  const dSy = syahi(dx, dy, dRx * 0.42, dRy * 0.55);
  a.path(dSy, 'h', 0.7, ' fill="currentColor" fill-opacity="0.62"');
  a.add('</g>');

  // Rim laces just outside each head.
  a.path(ellipse(bx, by + 3, bRx + 1.5, bRy + 1.2) + ellipse(dx, dy + 2.4, dRx + 1.2, dRy + 1), 'd', 0.7);

  a.add('</g>');
  return a.done('Табла');
}
