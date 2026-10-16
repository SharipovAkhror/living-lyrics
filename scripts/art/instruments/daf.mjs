import { Art, P, ellipse, shade, medallion, circle, rot } from '../lib.mjs';

// Daf in three-quarter view from the open side: wide frame, skin stretched on the far side,
// chains of small rings hanging along the inner wall.
export default function daf() {
  const a = new Art('daf');
  const c = P(200, 204);
  const tilt = -14;
  const rx = 150;
  const ry = 132;
  const depth = P(10, 16);
  const outer = ellipse(c.x, c.y, rx, ry, tilt);
  const innerFront = ellipse(c.x, c.y, rx - 9, ry - 8, tilt);
  const back = ellipse(c.x + depth.x, c.y + depth.y, rx - 9, ry - 8, tilt);
  const backOuter = ellipse(c.x + depth.x, c.y + depth.y, rx, ry, tilt);

  a.add(medallion());
  // Outer wall of the frame seen at the bottom-right
  a.path(backOuter, 'd', 1.2);
  a.add(shade({ shape: backOuter, box: { x: 40, y: 60, w: 330, h: 300 }, angle: 70, spacing: 1.6, width: 0.55, light: P(-depth.x, -depth.y) }));
  a.fillin(outer);
  a.path(outer, 'd', 1.7);
  a.path(innerFront, 'd', 1);
  // Frame rim band: wood grain
  a.add(`<g mask="url(#daf-rim)"><path class="h" d="${[0.95, 0.975].map((k) => ellipse(c.x, c.y, rx * k, ry * k, tilt)).join('')}" stroke-width="0.35"/></g>`);
  a.defs += `<mask id="daf-rim" maskUnits="userSpaceOnUse" x="30" y="50" width="350" height="320"><path d="${outer}" fill="#fff"/><path d="${innerFront}" fill="#000"/></mask>`;

  // Skin on the far side: the "skin" class pulses with the music
  a.add(`<g class="skin">`);
  a.path(back, 'd', 1);
  let stip = '';
  for (let i = 0; i < 260; i++) {
    const ang = i * 2.39996;
    const rr = Math.sqrt(i / 260) * 0.92;
    const p = rot(P(c.x + depth.x + (rx - 12) * rr * Math.cos(ang), c.y + depth.y + (ry - 12) * rr * Math.sin(ang)), P(c.x + depth.x, c.y + depth.y), tilt);
    stip += circle(p.x, p.y, 0.35 + (i % 5) * 0.08);
  }
  a.path(stip, 'h', 0.45);
  a.add('</g>');

  // Inner wall between front rim and skin (shadowed on the upper-left, where we look into the frame)
  a.add(shade({ shape: innerFront, box: { x: 50, y: 70, w: 320, h: 290 }, angle: -20, spacing: 1.8, width: 0.45, light: P(depth.x, depth.y) }));

  // Rings: chains of small loops along the inner wall
  let rings = '';
  const n = 64;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const base = P(c.x + (rx - 16) * Math.cos(t) + depth.x * 0.45, c.y + (ry - 15) * Math.sin(t) + depth.y * 0.45);
    const p = rot(base, P(c.x + depth.x * 0.45, c.y + depth.y * 0.45), tilt);
    const tang = (Math.atan2((ry - 15) * Math.cos(t), -(rx - 16) * Math.sin(t)) * 180) / Math.PI + tilt;
    rings += ellipse(p.x, p.y, 4.2, 2.4, tang);
  }
  a.path(rings, 'd', 0.6);
  // The hook rail the rings hang from
  a.path(ellipse(c.x + depth.x * 0.45, c.y + depth.y * 0.45, rx - 16, ry - 15, tilt), 'h', 0.5);

  // Small inlaid dots on the front rim
  let inlay = '';
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    const p = rot(P(c.x + (rx - 4.5) * Math.cos(t), c.y + (ry - 4) * Math.sin(t)), c, tilt);
    inlay += circle(p.x, p.y, 0.8);
  }
  a.path(inlay, 'h', 0.5);
  return a.done('Даф');
}


