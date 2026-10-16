import { Art, P, smooth, ellipse, shade, medallion, stipple, ellipseArc, gid, f } from '../lib.mjs';

// Tombak (zarb): a goblet drum carved from a single block of wood, with a wide bowl, a narrow throat
// low down and a flared foot; the skin is glued (not laced) over the head. Drawn lying as it is played,
// on the lap, head turned to the right. Carved flutes run down the body.
// Proportions (≈ 6.8 px per cm): height ≈ 43 cm, head ≈ 28 cm, throat ≈ 10 cm, foot ≈ 13 cm.
const half = [
  [95, 0], [96, 9], [94.5, 36], [88, 78], [73, 126], [53, 168], [38, 202], [34, 220], [36, 246], [42, 272], [45, 292],
];

export default function tombak() {
  const a = new Art('tombak');
  const cx = 200;
  const top = 58;
  const H = 292;
  const ry = (w) => w * 0.24; // ellipse of a horizontal section seen slightly from above
  const R = half.map(([x, y]) => P(cx + x, top + y));
  const L = R.slice().reverse().map((p) => P(2 * cx - p.x, p.y));
  // Silhouette: sides plus the front arc of the foot rim
  const footW = half.at(-1)[0];
  const body = smooth([...R.slice(0, -1), R.at(-1)], false, 0.5) + ellipseArc(cx, top + H, footW, ry(footW), 0, Math.PI, 0, 24).replace(/^M[^C]*/, '') + smooth([L[0], ...L.slice(1)], false, 0.5).replace(/^M[^C]*/, '') + ellipseArc(cx, top, half[0][0], ry(half[0][0]), Math.PI, 2 * Math.PI, 0, 24).replace(/^M[^C]*/, '') + 'Z';
  const skin = ellipse(cx, top, half[0][0], ry(half[0][0]));

  a.add(medallion());
  a.add('<g transform="translate(200 206) rotate(64) scale(0.93) translate(-200 -205)">');
  a.begin();
  a.fillin(body);
  a.path(body, 'd', 1.6);
  a.add(shade({ shape: body, box: { x: cx - 100, y: top - 10, w: 200, h: H + 40 }, angle: 90, spacing: 1.7, width: 0.48, light: P(-34, 0) }));

  // Carved flutes: meridians following the profile, bunching toward the edges
  const clip = gid('clip');
  a.defs += `<clipPath id="${clip}"><path d="${body}"/></clipPath>`;
  let flutes = '';
  for (let k = -5; k <= 5; k++) {
    if (k === 0) continue;
    const s = Math.sin((k / 6) * (Math.PI / 2));
    const pts = half.map(([x, y]) => P(cx + x * s, top + y + ry(x) * Math.sqrt(1 - s * s)));
    flutes += smooth(pts.slice(1, -1), false, 0.5);
  }
  flutes += smooth(half.slice(1, -1).map(([x, y]) => P(cx, top + y + ry(x))), false, 0.5);
  a.add(`<g clip-path="url(#${clip})"><path class="h" d="${flutes}" stroke-width="0.45"/></g>`);
  // Turned bands at the throat and above the foot
  let bands = '';
  for (const y of [204, 212, 262]) {
    const i = half.findIndex(([, yy]) => yy >= y);
    const [x0, y0] = half[i - 1];
    const [x1, y1] = half[i];
    const w = x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
    bands += ellipseArc(cx, top + y, w, ry(w), 0, Math.PI, 0, 24);
  }
  a.path(bands, 'd', 0.7);
  a.hidden(skin);

  // Head: the rim where the skin is glued over the edge, and the skin
  const rimW = half[0][0];
  a.path(ellipse(cx, top + 6, rimW + 0.6, ry(rimW) + 0.8), 'd', 1.1);
  a.add('<g class="skin">');
  a.fillin(skin);
  a.path(skin, 'd', 1.5);
  a.path(ellipse(cx, top, rimW - 6, ry(rimW - 6)), 'h', 0.5);
  a.path(stipple(cx, top, rimW - 8, ry(rimW - 8), 170), 'h', 0.42);
  a.add(shade({ shape: skin, box: { x: cx - rimW - 2, y: top - 26, w: 2 * rimW + 4, h: 52 }, angle: 20, spacing: 2.4, width: 0.36, light: P(-30, -12) }));
  a.add('</g>');
  a.add('</g>');
  return a.done('Томбак');
}
