import { Art, P, line, ellipse, shade, medallion, f } from '../lib.mjs';

// Concert flute, Boehm system, C foot, drawn in profile the way it is held (keys up).
// Proportions (5.1 px/cm): overall 67 cm. McGee records a 1970s US Boehm at 672 mm and a
// Powell Cooper at 670 mm (https://www.mcgee-flutes.com/flutelengths.htm). Bore 19 mm,
// tapering to about 17 mm at the embouchure (UNSW, https://www.phys.unsw.edu.au/music/flute/anatomy.html).
// A low-B foot is longer: the MFA Powell 1985.931 is 71 cm. The 360p frames (ONE, 276 s and the
// neighbouring close shots) show a silver transverse flute and a row of keys; they do not resolve
// C foot against B foot, nor open-hole rings against plateau cups. Cups are drawn closed so the
// mechanism still reads at about 120 px. Key order is the Boehm layout (trill pair, three left-hand
// keys, offset G-sharp, three right-hand keys, D-sharp, two foot keys). Each cup's millimetre
// station was not measured off the frame.
export default function flute() {
  const a = new Art('flute');
  const x0 = 34;
  const x1 = 370;
  const y = 196;
  const r = 5.4;
  const tube = `M${x0 + 8} ${y - r}L${x1 - 6} ${y - r}Q${x1 + 2} ${y} ${x1 - 6} ${y + r}L${x0 + 8} ${y + r}Q${x0 + 2} ${y} ${x0 + 8} ${y - r}Z`;

  a.add(medallion());
  a.add('<g transform="rotate(-11 200 200)">');

  // Headjoint crown and the open foot, so the tube reads as a pipe rather than a bar.
  a.path(ellipse(x0 + 6, y, 7.2, r + 0.4), 'd', 1.1);
  a.path(ellipse(x1 - 2, y, 5.2, r - 0.4), 'd', 0.9);
  a.add(shade({ shape: tube, box: { x: x0, y: y - r - 4, w: x1 - x0, h: 2 * r + 8 }, angle: 0, spacing: 1.5, width: 0.42, light: P(0, -8) }));
  a.fillin(tube);
  a.path(tube, 'd', 1.55);
  a.path(line(P(x0 + 16, y - r + 2.2), P(x1 - 14, y - r + 2.2)), 'h', 0.35);

  // Two tenons: head/body and body/foot.
  const tenon = (x) =>
    `M${x} ${y - r - 1.3}L${x} ${y + r + 1.3}M${x + 3.2} ${y - r - 1.3}L${x + 3.2} ${y + r + 1.3}M${x - 0.4} ${y - r - 1.3}L${x + 3.6} ${y - r - 1.3}M${x - 0.4} ${y + r + 1.3}L${x + 3.6} ${y + r + 1.3}`;
  a.path(tenon(x0 + 92) + tenon(x0 + 262), 'd', 0.8);

  // Lip plate and embouchure. The plate sits on the headjoint, close to the crown.
  const lipX = x0 + 36;
  a.path(ellipse(lipX, y - r - 1.6, 12.5, 6.4), 'd', 1.05);
  a.path(ellipse(lipX + 0.4, y - r - 1.2, 4.2, 2.5), 'h', 0.7, ' fill="currentColor"');
  // A short riser under the plate.
  a.path(`M${lipX - 8} ${y - r + 0.2}Q${lipX} ${y - r - 3.2} ${lipX + 8} ${y - r + 0.2}`, 'd', 0.7);

  // Steel rod the keys ride on, then the cups.
  a.path(line(P(x0 + 108, y - r - 2.4), P(x0 + 308, y - r - 2.4)), 'd', 0.55);
  const cups = [
    // Trill pair, small.
    [112, 3.1, 2.2, 3.2],
    [122, 3.1, 2.2, 3.2],
    // Left hand: B, A, G.
    [142, 5.4, 3.6, 4.6],
    [158, 5.4, 3.6, 4.6],
    [174, 5.4, 3.6, 4.6],
    // G-sharp, offset toward the player (drawn a little lower and to the side).
    [188, 3.6, 2.6, 1.4],
    // Right hand: F, E, D.
    [206, 5.2, 3.5, 4.4],
    [222, 5.2, 3.5, 4.4],
    [238, 5.2, 3.5, 4.4],
    // D-sharp, little finger.
    [252, 3.8, 2.6, 2.2],
    // Foot: C-sharp and C.
    [286, 4.6, 3.2, 3.6],
    [304, 4.6, 3.2, 3.6],
  ];
  let keys = '';
  for (const [dx, rw, rh, stem] of cups) {
    const x = x0 + dx;
    const cy = y - r - stem - rh;
    keys += line(P(x, y - r - 1), P(x, cy + rh * 0.2));
    keys += ellipse(x, cy, rw, rh);
  }
  a.path(keys, 'd', 0.85);
  // Posts: short ticks where the rod meets the tube.
  let posts = '';
  for (const dx of [118, 150, 166, 214, 230, 292]) {
    posts += line(P(x0 + dx, y - r), P(x0 + dx, y - r - 2.6));
  }
  a.path(posts, 'd', 0.6);

  // Breath leaving the embouchure. Opacity is --breath-o, a function of playback time.
  let air = '';
  for (let i = 0; i < 6; i++) {
    const px = lipX - 4 - i * 6.5;
    const py = y - r - 14 - i * 5.5 - (i % 2) * 2;
    air += `<circle class="breath-dot" cx="${f(px)}" cy="${f(py)}" r="${(1.7 - i * 0.18).toFixed(2)}" fill="currentColor" stroke="none"/>`;
  }
  a.add(air);

  a.add('</g>');
  return a.done('Поперечная флейта');
}
