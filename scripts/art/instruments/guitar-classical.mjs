import { Art, P, smooth, line, circle, ellipse, shade, fillHatch, medallion, rect, fretYs, f } from '../lib.mjs';

// Classical guitar, not the flamenco plate (that one keeps the golpeadores).
// Concert frames (Karitas 211, 817, 827 s) show nylon strings, a slotted head, a tie-block
// bridge and no tap plates. Recognition labelled those shots guitar-acoustic; the alias
// points them here.
// Proportions (≈ 3.4 px/cm), in the Ramirez range rather than one numbered guitar:
// scale 65 cm, body length 48.6 cm, bouts 28 / 23.7 / 36.8 cm, nut 5.2 cm, soundhole 8.6 cm.
// Body depth is drawn as a deeper rim than the flamenco plate (classical sides are about 9–10 cm).
// Nineteen frets, the twelfth at the neck joint. Six strings: three wound, three plain.
export default function guitarClassical() {
  const a = new Art('gclassical');
  const cx = 200;
  const nut = 92;
  const top = 204;
  const len = 165;
  const bottom = top + len;
  const saddle = nut + 221;
  const hole = P(cx, top + 36);
  const holeR = 14.6;
  const p = (x, t) => P(cx + x, top + t * len);
  const R = [p(0, 0), p(24, 0.012), p(40, 0.07), p(48, 0.16), p(47.8, 0.24), p(42, 0.34), p(40.2, 0.44), p(43, 0.52), p(54, 0.62), p(62.5, 0.72), p(63, 0.8), p(56, 0.9), p(40, 0.96), p(20, 0.993), p(0, 1)];
  const L = R.slice(1, -1).reverse().map((q) => P(2 * cx - q.x, q.y));
  const pts = [...R, ...L];
  const body = smooth(pts, true, 0.48);
  // Deeper sides than the flamenco drawing: the rim steps out past the top.
  const sides = smooth(pts.map((q) => P(q.x + 9, q.y + 5)), true, 0.48);
  const binding = smooth(pts.map((q) => P(cx + (q.x - cx) * 0.968, top + len / 2 + (q.y - top - len / 2) * 0.982)), true, 0.48);

  a.add(medallion());
  a.add('<g transform="rotate(18 200 208)">');

  a.begin();
  a.path(sides, 'd', 1.1);
  a.add(shade({ shape: sides, box: { x: cx - 74, y: top - 6, w: 156, h: len + 16 }, angle: 62, spacing: 1.55, width: 0.48, light: P(-8, -4) }));
  a.hidden(body);

  a.fillin(body);
  a.path(body, 'd', 1.6);
  a.path(binding, 'd', 0.5);
  let grain = '';
  for (let x = cx - 58; x < cx + 62; x += 4.4) grain += line(P(x, top + 2), P(x + 0.4, bottom - 2));
  a.add(`<g clip-path="url(#gclassical-top)"><path class="h" d="${grain}" stroke-width="0.2" opacity=".65"/></g>`);
  a.defs += `<clipPath id="gclassical-top"><path d="${binding}"/></clipPath>`;
  a.add(shade({ shape: body, box: { x: cx - 70, y: top - 4, w: 140, h: len + 8 }, angle: 38, spacing: 2.7, width: 0.36, light: P(-22, -24) }));

  // Soundhole and a mosaic rosette. No golpeador: the top stays clear.
  a.path(circle(hole.x, hole.y, holeR), 'd', 1.15);
  a.add(fillHatch({ shape: circle(hole.x, hole.y, holeR), box: { x: hole.x - holeR, y: hole.y - holeR, w: 2 * holeR, h: 2 * holeR }, angle: 70, spacing: 1.2, width: 0.42 }));
  a.path(circle(hole.x, hole.y, holeR + 2.6) + circle(hole.x, hole.y, holeR + 3.6) + circle(hole.x, hole.y, holeR + 8.2) + circle(hole.x, hole.y, holeR + 9.4), 'd', 0.55);
  let mosaic = '';
  const n = 48;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r1 = holeR + 4.2;
    const r2 = holeR + 7.6;
    const t2 = t + Math.PI / n;
    mosaic += `M${f(hole.x + r1 * Math.cos(t))} ${f(hole.y + r1 * Math.sin(t))}L${f(hole.x + r2 * Math.cos(t2))} ${f(hole.y + r2 * Math.sin(t2))}L${f(hole.x + r1 * Math.cos(t + (2 * Math.PI) / n))} ${f(hole.y + r1 * Math.sin(t + (2 * Math.PI) / n))}`;
  }
  a.path(mosaic, 'h', 0.42);

  // Neck, wider at the nut than a steel-string, and a small heel where it meets the body.
  const fbEnd = hole.y - holeR - 2.4;
  const wNut = 8.8;
  const wBody = 11.2;
  const wAt = (yy) => wNut + ((wBody - wNut) * (yy - nut)) / (top - nut);
  const fb = `M${cx - wNut} ${nut}L${cx + wNut} ${nut}L${f(cx + wAt(fbEnd))} ${f(fbEnd)}L${f(cx - wAt(fbEnd))} ${f(fbEnd)}Z`;
  a.path(`M${cx - wNut - 0.4} ${nut}L${cx - wBody - 1} ${top + 2}M${cx + wNut + 0.4} ${nut}L${cx + wBody + 1} ${top + 2}`, 'd', 1.15);
  const heel = `M${cx - 14} ${top - 2}Q${cx - 16} ${top + 10} ${cx - 8} ${top + 14}L${cx + 8} ${top + 14}Q${cx + 16} ${top + 10} ${cx + 14} ${top - 2}`;
  a.path(heel, 'd', 0.9);
  a.path(fb, 'd', 1.05);
  a.add(fillHatch({ shape: fb, box: { x: cx - 14, y: nut - 2, w: 28, h: fbEnd - nut + 4 }, angle: 88, spacing: 1.45, width: 0.38 }));
  let frets = '';
  for (const yy of fretYs(nut, saddle - nut, 19)) {
    if (yy > fbEnd) break;
    frets += line(P(cx - wAt(yy), yy), P(cx + wAt(yy), yy));
  }
  a.path(frets, 'd', 0.55);
  a.path(rect(cx - wNut - 0.3, nut - 2.6, 2 * wNut + 0.6, 2.6), 'd', 0.75);

  // Slotted head: two slots, three rollers a side. The concert head is this shape, not a solid paddle.
  const hTop = 26;
  const head = `M${cx - wNut} ${nut - 2.6}L${cx - 13} ${hTop + 8}Q${cx - 13.2} ${hTop - 1} ${cx - 4.2} ${hTop + 2}Q${cx} ${hTop - 4} ${cx + 4.2} ${hTop + 2}Q${cx + 13.2} ${hTop - 1} ${cx + 13} ${hTop + 8}L${cx + wNut} ${nut - 2.6}Z`;
  a.path(head, 'd', 1.2);
  a.add(fillHatch({ shape: head, box: { x: cx - 16, y: hTop - 6, w: 32, h: nut - hTop + 4 }, angle: 74, spacing: 2.1, width: 0.32 }));
  const slots = [-1, 1].map((s) => rect(cx + (s < 0 ? -9 : 3.2), hTop + 12, 5.4, 44, 2.2));
  a.path(slots.join(''), 'd', 0.75);
  slots.forEach((d, i) => a.add(fillHatch({ shape: d, box: { x: cx + (i ? 2 : -11), y: hTop + 10, w: 10, h: 48 }, angle: 80, spacing: 1.15, width: 0.4 })));
  let tuners = '';
  const rollers = [hTop + 20, hTop + 34, hTop + 48];
  for (const s of [-1, 1]) {
    for (const yy of rollers) {
      tuners += line(P(cx + s * 3.6, yy - 1.3), P(cx + s * 8.8, yy - 1.3)) + line(P(cx + s * 3.6, yy + 1.3), P(cx + s * 8.8, yy + 1.3));
      tuners += `M${cx + s * 13} ${yy - 1}L${cx + s * 18} ${yy - 1}M${cx + s * 13} ${yy + 1}L${cx + s * 18} ${yy + 1}` + ellipse(cx + s * 22.2, yy, 4.4, 3.2);
    }
  }
  a.path(tuners, 'd', 0.72);

  // Tie-block bridge. Strings tie on the block, they are not pinned.
  const br = `M${cx - 30} ${saddle + 1}Q${cx - 26} ${saddle - 3.2} ${cx - 16} ${saddle - 3.2}L${cx + 16} ${saddle - 3.2}Q${cx + 26} ${saddle - 3.2} ${cx + 30} ${saddle + 1}Q${cx + 26} ${saddle + 11} ${cx + 16} ${saddle + 11}L${cx - 16} ${saddle + 11}Q${cx - 26} ${saddle + 11} ${cx - 30} ${saddle + 1}Z`;
  a.path(br, 'd', 1);
  a.add(fillHatch({ shape: br, box: { x: cx - 32, y: saddle - 5, w: 64, h: 18 }, angle: 0, spacing: 1.35, width: 0.4 }));
  a.path(rect(cx - 12, saddle - 1.4, 24, 2.1) + rect(cx - 14, saddle + 4.2, 28, 4.2), 'd', 0.65);

  a.add('<g>');
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const xb = cx - 11 + 22 * t;
    const xn = cx - 7.2 + 14.4 * t;
    const s = i < 3 ? -1 : 1;
    const yR = rollers[i < 3 ? 2 - i : i - 3];
    a.path(`M${f(xb)} ${saddle + 7}L${f(xb)} ${saddle - 0.4}L${f(xn)} ${nut - 1}L${f(cx + s * 6.2)} ${yR}`, 'str', i < 3 ? 0.7 : 0.42);
  }
  a.add('</g>');
  a.add('</g>');
  return a.done('Классическая гитара');
}
