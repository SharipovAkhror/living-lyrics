import { Art, P, smooth, line, shade, fillHatch, medallion, mirrorOutline, scalePts, stipple, peg, fretYs, gid, f } from '../lib.mjs';

// Tar (Persian type): double-bowl "figure eight" body carved from mulberry, both chambers covered
// with one thin skin membrane; the lower chamber is the larger. Long neck with 26 tied gut frets,
// open pegbox with six pegs (three a side), six strings in three double courses over a loose bone bridge.
// Proportions (≈ 3.66 px per cm): total ≈ 95 cm, body ≈ 37 cm, neck ≈ 40 cm, lower chamber ≈ 20.5 cm wide.
export default function tar() {
  const a = new Art('tar');
  const cx = 200;
  const nut = 93;
  const bodyTop = 239;
  const bottom = 374;
  const bridgeY = 338;
  const nw = 7; // half neck width at the body

  // Right half of the body, top → bottom: small heart (upper chamber), waist, large heart (lower chamber).
  const R = [
    P(cx + nw + 1, bodyTop), P(cx + 17, bodyTop + 3), P(cx + 23.5, bodyTop + 12), P(cx + 24.5, bodyTop + 21),
    P(cx + 21.5, bodyTop + 33), P(cx + 16.5, bodyTop + 44), P(cx + 15.5, bodyTop + 50),
    P(cx + 22, bodyTop + 58), P(cx + 32.5, bodyTop + 68), P(cx + 37.5, bodyTop + 80), P(cx + 36.5, bodyTop + 94),
    P(cx + 30, bodyTop + 110), P(cx + 19, bodyTop + 124), P(cx + 8, bodyTop + 132), P(cx, bottom),
  ];
  const outlinePts = mirrorOutline(R, cx);
  const body = smooth(outlinePts, true, 0.5);
  const back = smooth(outlinePts.map((p) => P(p.x + 5, p.y + 3.5)), true, 0.5);
  // Membrane: inset from the wooden rim
  const skinPts = scalePts(outlinePts, P(cx, 306), 0.85, 0.955);
  const skin = smooth(skinPts, true, 0.5);

  a.add(medallion());
  a.add('<g transform="rotate(-31 200 205)">');

  // Carved bowls seen past the rim
  a.begin();
  a.path(back, 'd', 1.1);
  a.add(shade({ shape: back, box: { x: cx - 45, y: bodyTop - 8, w: 95, h: 150 }, angle: 62, spacing: 1.5, width: 0.5, light: P(-5, -3.5) }));
  a.hidden(body);
  // Wooden rim and the membrane
  a.fillin(body);
  a.path(body, 'd', 1.6);
  a.add(shade({ shape: body, box: { x: cx - 42, y: bodyTop - 4, w: 84, h: 145 }, angle: 40, spacing: 2.4, width: 0.4, light: P(-12, -16) }));
  a.add('<g class="skin">');
  a.path(skin, 'd', 0.8);
  const clip = gid('clip');
  a.defs += `<clipPath id="${clip}"><path d="${skin}"/></clipPath>`;
  a.add(`<g clip-path="url(#${clip})"><path class="h" d="${stipple(cx, 268, 22, 30, 70) + stipple(cx, 330, 34, 42, 150)}" stroke-width="0.4"/></g>`);
  a.add('</g>');

  // Neck: fingerboard with tied frets, ending in a pointed tongue on the upper chamber
  const neck = `M${cx - nw * 0.86} ${nut}L${cx - nw} ${bodyTop + 2}L${cx} ${bodyTop + 13}L${cx + nw} ${bodyTop + 2}L${cx + nw * 0.86} ${nut}`;
  a.path(neck, 'd', 1.3);
  a.add(shade({ shape: `${neck}Z`, box: { x: cx - nw - 2, y: nut - 2, w: 2 * nw + 4, h: bodyTop - nut + 18 }, angle: 90, spacing: 1.4, width: 0.42, light: P(-2.5, 0) }));
  let frets = '';
  for (const y of fretYs(nut, bridgeY - nut, 26, 0.61, bodyTop - 3)) {
    const half = nw * (0.86 + (0.14 * (y - nut)) / (bodyTop - nut));
    frets += line(P(cx - half - 0.5, y), P(cx + half + 0.5, y)) + line(P(cx - half - 0.5, y + 1.1), P(cx + half + 0.5, y + 1.1));
  }
  a.path(frets, 'd', 0.45);
  a.path(`M${cx - nw * 0.86} ${nut}L${cx + nw * 0.86} ${nut}M${cx - nw * 0.86} ${nut - 2.4}L${cx + nw * 0.86} ${nut - 2.4}`, 'd', 0.9);

  // Open pegbox: two side walls, a crest on top, three pegs a side (staggered)
  const top = 27;
  const pb = `M${cx - nw * 0.86} ${nut - 2.4}L${cx - 8.5} ${top + 8}Q${cx - 9} ${top} ${cx} ${top - 3}Q${cx + 9} ${top} ${cx + 8.5} ${top + 8}L${cx + nw * 0.86} ${nut - 2.4}`;
  a.path(pb, 'd', 1.2);
  const slot = `M${cx - 3.2} ${nut - 7}L${cx - 4.2} ${top + 10}Q${cx} ${top + 6} ${cx + 4.2} ${top + 10}L${cx + 3.2} ${nut - 7}Z`;
  a.path(slot, 'd', 0.7);
  a.add(fillHatch({ shape: slot, box: { x: cx - 6, y: top + 4, w: 12, h: nut - top }, angle: 80, spacing: 1.1, width: 0.45 }));
  a.add(fillHatch({ shape: `${pb}Z`, box: { x: cx - 10, y: top - 4, w: 20, h: nut - top + 4 }, angle: 70, spacing: 2.2, width: 0.32 }));
  const pegY = { left: [40, 54, 68], right: [47, 61, 75] };
  let pegs = '';
  pegY.left.forEach((y) => (pegs += peg(cx - 8.2, y, -1, 12, 8)));
  pegY.right.forEach((y) => (pegs += peg(cx + 8.2, y, 1, 12, 8)));
  a.path(pegs, 'd', 0.8);

  // Bone bridge with two feet, tail button at the bottom of the lower chamber
  a.path(`M${cx - 9} ${bridgeY}L${cx + 9} ${bridgeY}L${cx + 7.5} ${bridgeY + 3.5}L${cx + 3} ${bridgeY + 3.5}L${cx} ${bridgeY + 1.8}L${cx - 3} ${bridgeY + 3.5}L${cx - 7.5} ${bridgeY + 3.5}Z`, 'd', 0.8);
  a.path(`M${cx - 4} ${bottom - 5}L${cx + 4} ${bottom - 5}L${cx + 3} ${bottom - 1.5}L${cx - 3} ${bottom - 1.5}Z`, 'd', 0.8);

  // Six strings in three double courses: tail → bridge → nut → pegs
  const atBridge = [-6.2, -4.6, -0.8, 0.8, 4.6, 6.2];
  const pegFor = [
    [-1, pegY.left[0]], [1, pegY.right[0]], [-1, pegY.left[1]], [1, pegY.right[1]], [-1, pegY.left[2]], [1, pegY.right[2]],
  ];
  atBridge.forEach((dx, i) => {
    const xn = cx + dx * 0.78;
    const [side, py] = pegFor[i];
    a.path(`M${f(cx + dx * 0.4)} ${bottom - 4}L${f(cx + dx)} ${bridgeY}L${f(xn)} ${nut}L${f(cx + side * 3.4)} ${py}`, 'str', 0.45);
  });

  a.add('</g>');
  return a.done('Тар');
}
