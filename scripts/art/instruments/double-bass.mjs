import { Art, P, line, ellipse, circle, shade, fillHatch, medallion, boutOutline, scalePts, rect, f } from '../lib.mjs';
import { fHole, scrollPath } from './cello.mjs';

// Double bass (violin-corner model), slight three-quarter view. What tells it from a cello:
// sloping shoulders running down from the neck, deep ribs, and a head with brass machine gears
// (two keys a side) instead of wooden pegs. Long fingerboard, f-holes notched on the bridge line, endpin.
// Proportions (≈ 1.69 px per cm): body 111 cm, upper bout 52, waist 37.5, lower bout 66, neck 43,
// head 30, bridge ≈ 62 cm below the top of the body, endpin ≈ 20 cm out.
export default function doubleBass() {
  const a = new Art('double-bass');
  const cx = 200;
  const top = 150;
  const len = 188;
  const bottom = top + len;
  const nut = 77;
  const fbEnd = 229;
  const bridgeY = 255;
  const pin = 372;
  const p = (x, t) => P(cx + x, top + t * len);
  const runs = {
    upper: [p(0, 0), p(9, 0.004), p(16, 0.035), p(25, 0.085), p(34, 0.145), p(41.5, 0.215), p(44, 0.28), p(42.6, 0.34), p(39.8, 0.384)],
    cbout: [p(39.8, 0.384), p(34, 0.403), p(31.8, 0.445), p(31.4, 0.49), p(32, 0.533), p(35, 0.565), p(42.4, 0.586)],
    lower: [p(42.4, 0.586), p(50, 0.63), p(55, 0.7), p(56, 0.78), p(54, 0.87), p(45.5, 0.94), p(26, 0.985), p(0, 1)],
  };
  const outline = boutOutline(runs, cx);
  const c0 = P(cx, top + len / 2);
  const inset = (r, kx, ky) => scalePts(r, c0, kx, ky);
  const purfling = boutOutline({ upper: inset(runs.upper, 0.94, 0.968), cbout: inset(runs.cbout, 0.92, 0.968), lower: inset(runs.lower, 0.95, 0.97) }, cx);
  const off = (pts) => pts.map((q) => P(q.x + 10, q.y + 4));
  const ribs = boutOutline({ upper: off(runs.upper), cbout: off(runs.cbout), lower: off(runs.lower) }, cx + 10);

  a.add(medallion());
  a.add('<g transform="rotate(-17 200 205)">');

  // Endpin
  a.path(`M${cx - 6} ${bottom - 1}L${cx - 5} ${bottom + 8}L${cx + 5} ${bottom + 8}L${cx + 6} ${bottom - 1}`, 'd', 1);
  a.add(fillHatch({ shape: `M${cx - 6} ${bottom - 1}L${cx - 5} ${bottom + 8}L${cx + 5} ${bottom + 8}L${cx + 6} ${bottom - 1}Z`, box: { x: cx - 7, y: bottom - 2, w: 14, h: 11 }, angle: 80, spacing: 1.1, width: 0.4 }));
  a.path(`M${cx - 1.6} ${bottom + 8}L${cx - 1.3} ${pin - 6}L${cx} ${pin}L${cx + 1.3} ${pin - 6}L${cx + 1.6} ${bottom + 8}`, 'd', 0.9);

  // Ribs and top
  a.begin();
  a.path(ribs, 'd', 1.1);
  a.add(shade({ shape: ribs, box: { x: cx - 62, y: top - 4, w: 134, h: len + 14 }, angle: 64, spacing: 1.45, width: 0.5, light: P(-10, -4) }));
  a.hidden(outline);
  a.fillin(outline);
  a.path(outline, 'd', 1.6);
  a.path(purfling, 'd', 0.5);
  a.add(shade({ shape: outline, box: { x: cx - 60, y: top - 4, w: 120, h: len + 8 }, angle: 38, spacing: 2.4, width: 0.4, light: P(-20, -22) }));
  let grain = '';
  for (let x = cx - 54; x < cx + 56; x += 4.5) grain += line(P(x, top), P(x + 0.6, bottom));
  a.add(`<g clip-path="url(#double-bass-top)"><path class="h" d="${grain}" stroke-width="0.2" opacity=".7"/></g>`);
  a.defs += `<clipPath id="double-bass-top"><path d="${purfling}"/></clipPath>`;

  // f-holes (longer than a cello's relative to the waist)
  let fh = '';
  for (const s of [-1, 1]) {
    const { stem, eyes, notches } = fHole(cx, s, bridgeY - 30, bridgeY + 27, 1.2);
    fh += stem + eyes + notches;
  }
  a.path(fh, 'd', 0.85);

  // Neck, fingerboard, nut
  a.path(`M${cx - 4.2} ${nut}L${cx - 7} ${top + 3}M${cx + 4.2} ${nut}L${cx + 7} ${top + 3}`, 'd', 1.1);
  const fb = `M${cx - 4.3} ${nut}L${cx + 4.3} ${nut}L${cx + 9.6} ${fbEnd}Q${cx} ${fbEnd + 4} ${cx - 9.6} ${fbEnd}Z`;
  a.path(fb, 'd', 1.1);
  a.add(fillHatch({ shape: fb, box: { x: cx - 11, y: nut - 2, w: 22, h: fbEnd - nut + 8 }, angle: 86, spacing: 1.25, width: 0.45 }));
  a.path(line(P(cx - 4.5, nut - 1.6), P(cx + 4.5, nut - 1.6)), 'd', 1);

  // Head: pegbox and scroll, brass machine plates with worm gears and four keys
  const pbTop = 40;
  a.path(scrollPath(cx, pbTop, nut - 1.6, 1.15), 'd', 1.05);
  const slot = `M${cx - 2.2} ${nut - 5}L${cx - 2.8} ${pbTop + 7}L${cx + 2.8} ${pbTop + 7}L${cx + 2.2} ${nut - 5}Z`;
  a.path(slot, 'd', 0.6);
  a.add(fillHatch({ shape: slot, box: { x: cx - 4, y: pbTop + 5, w: 8, h: nut - pbTop }, angle: 85, spacing: 1, width: 0.4 }));
  const keysY = [50, 64];
  let mech = '';
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? cx - 8.4 : cx + 4.9;
    mech += rect(x0, pbTop + 4, 3.5, nut - pbTop - 8, 0.8);
    for (const y of keysY) {
      const yy = y + (s > 0 ? 4 : 0);
      mech += circle(cx + s * 6.6, yy, 2.2);
      mech += `M${f(cx + s * 8.6)} ${yy}L${f(cx + s * 16)} ${yy - 1}` + ellipse(cx + s * 21.5, yy - 1.5, 5.4, 3.6, s * -12);
      mech += line(P(cx - 2.6, yy), P(cx + 2.6, yy));
    }
  }
  a.path(mech, 'd', 0.8);
  // Worm teeth hatched on the plates
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? cx - 8.4 : cx + 4.9;
    a.add(fillHatch({ shape: rect(x0, pbTop + 4, 3.5, nut - pbTop - 8, 0.8), box: { x: x0 - 1, y: pbTop + 3, w: 6, h: nut - pbTop }, angle: 20, spacing: 1.2, width: 0.35 }));
  }

  // Bridge, tailpiece, saddle
  a.path(`M${cx - 15} ${bridgeY + 3.5}L${cx - 14} ${bridgeY - 1}Q${cx} ${bridgeY - 6} ${cx + 14} ${bridgeY - 1}L${cx + 15} ${bridgeY + 3.5}L${cx + 8} ${bridgeY + 3.5}Q${cx} ${bridgeY} ${cx - 8} ${bridgeY + 3.5}Z`, 'd', 0.9);
  const tp0 = bridgeY + 22;
  const tail = `M${cx - 9} ${tp0}Q${cx} ${tp0 - 3.5} ${cx + 9} ${tp0}L${cx + 5} ${bottom - 15}Q${cx} ${bottom - 12} ${cx - 5} ${bottom - 15}Z`;
  a.path(tail, 'd', 1);
  a.add(fillHatch({ shape: tail, box: { x: cx - 10, y: tp0 - 4, w: 20, h: bottom - tp0 }, angle: 82, spacing: 1.2, width: 0.42 }));
  a.path(`M${cx - 3.5} ${bottom - 14}Q${cx} ${bottom - 3} ${cx + 3.5} ${bottom - 14}M${cx - 7} ${bottom - 1.5}L${cx + 7} ${bottom - 1.5}`, 'd', 0.8);

  // Four strings: tailpiece → bridge → nut → posts in the pegbox
  [-7, -2.4, 2.4, 7].forEach((dx, i) => {
    const y = [keysY[1], keysY[0], keysY[0] + 4, keysY[1] + 4][i];
    a.path(`M${f(cx + dx * 0.9)} ${tp0 + 2}L${f(cx + dx * 1.55)} ${bridgeY - 3.5}L${f(cx + dx * 0.45)} ${nut}L${f(cx + dx * 0.25)} ${y}`, 'str', i < 2 ? 0.7 : 0.6);
  });
  a.add('</g>');
  return a.done('Контрабас');
}
