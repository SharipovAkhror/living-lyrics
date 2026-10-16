import { Art, P, smooth, line, circle, ellipse, shade, fillHatch, medallion, dots, stipple, peg, ellipseArc, gid, f } from '../lib.mjs';

// Kamancheh: spherical wooden bowl with a round skin table on the front and a mother-of-pearl ring,
// a long rounded fretless neck with bone collars, an open pegbox with four pegs (two a side) under a finial,
// a metal spike passing through the bowl, four strings, and the loose-haired bow.
// Proportions (≈ 4.15 px per cm): total ≈ 82 cm, bowl ≈ 18 cm, skin ≈ 13 cm, neck ≈ 28 cm, spike ≈ 19 cm.
export default function kamancheh() {
  const a = new Art('kamancheh');
  const cx = 200;
  const finialTop = 28;
  const nut = 100;
  const bowlC = P(cx, 252);
  const bowlR = 37;
  const skinC = P(cx - 3, 255);
  const skinR = 27;
  const spikeEnd = 372;
  const bridgeY = 262;

  a.add(medallion());
  a.add('<g transform="rotate(17 200 205)">');

  // Spike: metal rod through the bowl, a turned knob under it, tapering to a point
  const spike = `M${cx - 2.6} ${bowlC.y + bowlR - 2}L${cx - 2.2} ${spikeEnd - 18}L${cx} ${spikeEnd}L${cx + 2.2} ${spikeEnd - 18}L${cx + 2.6} ${bowlC.y + bowlR - 2}`;
  a.path(spike, 'd', 1.1);
  a.add(shade({ shape: `${spike}Z`, box: { x: cx - 4, y: bowlC.y + bowlR - 4, w: 8, h: spikeEnd - bowlC.y - bowlR + 8 }, angle: 90, spacing: 1.1, width: 0.4, light: P(-1.4, 0) }));
  const knob = smooth([P(cx - 3, 292), P(cx - 6.5, 298), P(cx - 7, 305), P(cx - 3.2, 311), P(cx + 3.2, 311), P(cx + 7, 305), P(cx + 6.5, 298), P(cx + 3, 292)], true, 0.5);
  a.path(knob, 'd', 1);
  a.add(shade({ shape: knob, box: { x: cx - 8, y: 290, w: 16, h: 24 }, angle: 80, spacing: 1.2, width: 0.42, light: P(-3, -2) }));
  a.path(ellipse(cx, 318, 4, 1.4) + ellipse(cx, 336, 3.2, 1.2), 'd', 0.7);

  // Bowl: a sphere, shaded on the lower right, with turned rings (latitudes) and an inlaid band
  const bowl = circle(bowlC.x, bowlC.y, bowlR);
  a.fillin(bowl);
  a.path(bowl, 'd', 1.6);
  a.add(shade({ shape: bowl, box: { x: cx - bowlR - 2, y: bowlC.y - bowlR - 2, w: 2 * bowlR + 4, h: 2 * bowlR + 4 }, angle: 48, spacing: 1.7, width: 0.45, light: P(-11, -12), cross: true }));
  let lat = '';
  for (const k of [0.94, 0.86]) lat += ellipseArc(bowlC.x, bowlC.y, bowlR * k, bowlR * k, -0.15 * Math.PI, 1.15 * Math.PI, 0, 36);
  a.path(lat, 'h', 0.45);
  // Inlay band between the rings: small lozenges
  let loz = '';
  for (let i = 0; i < 30; i++) {
    const t = -0.12 * Math.PI + (i / 29) * 1.24 * Math.PI;
    const r = bowlR * 0.9;
    const p = P(bowlC.x + r * Math.cos(t), bowlC.y + r * Math.sin(t));
    const u = P(Math.cos(t), Math.sin(t));
    const v = P(-u.y, u.x);
    loz += `M${f(p.x + u.x * 1.4)} ${f(p.y + u.y * 1.4)}L${f(p.x + v.x * 2)} ${f(p.y + v.y * 2)}L${f(p.x - u.x * 1.4)} ${f(p.y - u.y * 1.4)}L${f(p.x - v.x * 2)} ${f(p.y - v.y * 2)}Z`;
  }
  a.path(loz, 'h', 0.4);

  // Skin table with its mother-of-pearl ring
  a.path(dots(Array.from({ length: 49 }, (_, i) => P(skinC.x + (skinR + 1.4) * Math.cos((i / 48) * Math.PI * 2), skinC.y + (skinR + 3.2) * Math.sin((i / 48) * Math.PI * 2))), 3.4, 0.6), 'h', 0.45);
  a.path(ellipse(skinC.x, skinC.y, skinR + 3.5, skinR + 5.5), 'd', 0.7);
  a.add('<g class="skin">');
  const skin = ellipse(skinC.x, skinC.y, skinR - 2, skinR);
  a.path(skin, 'd', 1.1);
  a.path(stipple(skinC.x, skinC.y, skinR - 2, skinR, 130), 'h', 0.4);
  a.add(shade({ shape: skin, box: { x: cx - skinR - 2, y: skinC.y - skinR - 2, w: 2 * skinR + 4, h: 2 * skinR + 4 }, angle: 30, spacing: 2.6, width: 0.35, light: P(-12, -12) }));
  a.add('</g>');

  // Neck: a long rounded rod, slightly wider at the top, with bone collars at both ends
  const neck = `M${cx - 7} ${nut}L${cx - 5.6} ${bowlC.y - bowlR + 3}L${cx + 5.6} ${bowlC.y - bowlR + 3}L${cx + 7} ${nut}Z`;
  a.path(neck, 'd', 1.3);
  a.add(shade({ shape: neck, box: { x: cx - 9, y: nut - 2, w: 18, h: bowlC.y - bowlR - nut + 8 }, angle: 90, spacing: 1.2, width: 0.45, light: P(-6, 0) }));
  a.path(line(P(cx - 3.6, nut + 12), P(cx - 3, bowlC.y - bowlR - 10)), 'h', 0.35);
  const collar = (y, w, h) => {
    const s = `M${f(cx - w)} ${f(y)}Q${cx} ${f(y + 2.4)} ${f(cx + w)} ${f(y)}L${f(cx + w)} ${f(y + h)}Q${cx} ${f(y + h + 2.4)} ${f(cx - w)} ${f(y + h)}Z`;
    a.path(s, 'd', 0.8);
    a.add(fillHatch({ shape: s, box: { x: cx - w - 1, y: y - 1, w: 2 * w + 2, h: h + 5 }, angle: 60, spacing: 1.2, width: 0.38, cross: true }));
  };
  collar(nut + 3, 7.4, 6);
  collar(bowlC.y - bowlR - 6, 6.6, 6);

  // Pegbox (open), four pegs, finial
  const pbTop = 54;
  const pb = `M${cx - 7} ${nut}L${cx - 6.5} ${pbTop}L${cx + 6.5} ${pbTop}L${cx + 7} ${nut}`;
  a.path(pb, 'd', 1.2);
  const slot = `M${cx - 3} ${nut - 4}L${cx - 3} ${pbTop + 4}L${cx + 3} ${pbTop + 4}L${cx + 3} ${nut - 4}Z`;
  a.path(slot, 'd', 0.7);
  a.add(fillHatch({ shape: slot, box: { x: cx - 4, y: pbTop + 2, w: 8, h: nut - pbTop }, angle: 85, spacing: 1.05, width: 0.45 }));
  const pegYs = [[-1, 64], [1, 70], [-1, 82], [1, 88]];
  a.path(pegYs.map(([s, y]) => peg(cx + s * 6.8, y, s, 13, 11, -2.5)).join(''), 'd', 0.85);
  // Finial: a ball and a slim spire
  a.path(`M${cx - 6.5} ${pbTop}Q${cx - 8} ${pbTop - 6} ${cx - 4} ${pbTop - 9}` + circle(cx, pbTop - 14, 6) + `M${cx + 4} ${pbTop - 9}Q${cx + 8} ${pbTop - 6} ${cx + 6.5} ${pbTop}` + `M${cx - 2} ${pbTop - 19.6}L${cx} ${finialTop}L${cx + 2} ${pbTop - 19.6}`, 'd', 1);
  a.add(shade({ shape: circle(cx, pbTop - 14, 6), box: { x: cx - 7, y: pbTop - 21, w: 14, h: 14 }, angle: 60, spacing: 1.1, width: 0.4, light: P(-2.5, -2.5) }));

  // Bridge on the skin, tailpiece hooked under the bowl
  a.path(`M${cx - 8} ${bridgeY}L${cx + 8} ${bridgeY}L${cx + 6} ${bridgeY + 4}L${cx - 6} ${bridgeY + 4}Z`, 'd', 0.85);
  const tail = `M${cx - 5} ${bowlC.y + bowlR - 4}L${cx + 5} ${bowlC.y + bowlR - 4}L${cx + 2} ${bowlC.y + bowlR + 6}L${cx - 2} ${bowlC.y + bowlR + 6}Z`;
  a.path(tail, 'd', 0.8);

  // Strings: tailpiece → bridge → nut → pegs
  [-4.2, -1.4, 1.4, 4.2].forEach((dx, i) => {
    const [s, y] = pegYs[[0, 2, 3, 1][i]];
    a.path(`M${f(cx + dx * 0.6)} ${bowlC.y + bowlR - 3}L${f(cx + dx * 1.4)} ${bridgeY}L${f(cx + dx * 0.95)} ${nut}L${f(cx + s * 2.6)} ${y}`, 'str', 0.5);
  });
  a.add('</g>');

  // The bow: a slightly arched stick with loosely tensioned hair, lying across
  const b0 = P(50, 244);
  const b1 = P(352, 126);
  const stick = `M${b0.x} ${b0.y}Q${f((b0.x + b1.x) / 2 - 10)} ${f((b0.y + b1.y) / 2 - 26)} ${b1.x} ${b1.y}`;
  a.path(stick, 'd', 1.3);
  a.path(`M${b0.x + 6} ${b0.y + 2}Q${f((b0.x + b1.x) / 2 + 2)} ${f((b0.y + b1.y) / 2 + 3)} ${b1.x - 2} ${b1.y + 5}`, 'str', 0.6);
  a.path(ellipse(b0.x + 2, b0.y + 1, 7, 4.5, -26) + `M${b1.x} ${b1.y}L${b1.x - 2} ${b1.y + 5}`, 'd', 0.9);
  a.add(fillHatch({ shape: ellipse(b0.x + 2, b0.y + 1, 7, 4.5, -26), box: { x: b0.x - 8, y: b0.y - 8, w: 20, h: 18 }, angle: 60, spacing: 1.2, width: 0.4 }));
  return a.done('Кяманча');
}
