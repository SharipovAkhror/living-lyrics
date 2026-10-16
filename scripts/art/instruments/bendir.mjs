import { Art, P, ellipse, shade, medallion, circle, rot, line } from '../lib.mjs';

// Bendir: frame drum seen from the skin side, snares visible through the membrane, thumb hole in the frame.
export default function bendir() {
  const a = new Art('bendir');
  const c = P(196, 200);
  const tilt = 18;
  const rx = 140;
  const ry = 150;
  const depth = P(14, 9);
  const face = ellipse(c.x, c.y, rx, ry, tilt);
  const backRim = ellipse(c.x + depth.x, c.y + depth.y, rx, ry, tilt);
  a.add(medallion());
  a.path(backRim, 'd', 1.2);
  a.add(shade({ shape: backRim, box: { x: 40, y: 30, w: 330, h: 340 }, angle: 75, spacing: 1.6, width: 0.55, light: P(-depth.x, -depth.y) }));
  // Thumb hole on the frame wall
  const hole = rot(P(c.x + rx + 7, c.y + 30), c, tilt);
  a.path(ellipse(hole.x, hole.y, 3.5, 6, tilt + 10), 'd', 0.9);
  a.add('<g class="skin">');
  a.fillin(face);
  a.path(face, 'd', 1.7);
  a.path(ellipse(c.x, c.y, rx - 5, ry - 5, tilt), 'h', 0.5);
  // Snares under the skin: two gut strings across the diameter, seen as soft ridges
  let sn = '';
  for (const off of [-10, 6]) {
    const p1 = rot(P(c.x - rx + 12, c.y + off), c, tilt + 72);
    const p2 = rot(P(c.x + rx - 12, c.y + off), c, tilt + 72);
    sn += line(p1, p2);
  }
  a.path(sn, 'd', 0.7);
  // Skin texture
  let st = '';
  for (let i = 0; i < 300; i++) {
    const ang = i * 2.39996;
    const rr = Math.sqrt(i / 300) * 0.93;
    const p = rot(P(c.x + rx * rr * Math.cos(ang), c.y + ry * rr * Math.sin(ang)), c, tilt);
    st += circle(p.x, p.y, 0.32 + (i % 4) * 0.07);
  }
  a.path(st, 'h', 0.42);
  // Soft shading on the skin's lower edge
  a.add(shade({ shape: face, box: { x: 40, y: 30, w: 320, h: 340 }, angle: 30, spacing: 2.8, width: 0.38, light: P(-26, -30) }));
  a.add('</g>');
  return a.done('Бендир');
}
