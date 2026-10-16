import { Art, P, smooth, line, circle, ellipse, shade, fillHatch, medallion, rect, fretYs, f } from '../lib.mjs';

// Flamenco guitar: a Spanish guitar with a light, shallow body, clear tap plates (golpeadores) on both
// sides of the soundhole, mosaic rosette, classical tie-block bridge, nineteen frets with the twelfth at the body,
// and a slotted head with three rollers a side. Six strings.
// Proportions (≈ 3.4 px per cm): total ≈ 100 cm, body 48.5 cm, bouts 28 / 23.5 / 36.5 cm, scale 65 cm.
export default function guitar() {
  const a = new Art('guitar');
  const cx = 200;
  const nut = 93;
  const top = 203.5; // neck joint = 12th fret
  const len = 165;
  const bottom = top + len;
  const saddle = nut + 221; // 65 cm scale
  const hole = P(cx, top + 37);
  const holeR = 14.5;
  const p = (x, t) => P(cx + x, top + t * len);
  const R = [p(0, 0), p(22, 0.01), p(38, 0.06), p(46, 0.15), p(47.6, 0.23), p(45, 0.32), p(40.4, 0.42), p(41, 0.5), p(50, 0.6), p(59, 0.68), p(62, 0.76), p(59, 0.87), p(46, 0.95), p(24, 0.993), p(0, 1)];
  const L = R.slice(1, -1).reverse().map((q) => P(2 * cx - q.x, q.y));
  const pts = [...R, ...L];
  const body = smooth(pts, true, 0.5);
  const sides = smooth(pts.map((q) => P(q.x + 6, q.y + 3)), true, 0.5);
  const binding = smooth(pts.map((q) => P(cx + (q.x - cx) * 0.965, top + len / 2 + (q.y - top - len / 2) * 0.98)), true, 0.5);

  a.add(medallion());
  a.add('<g transform="rotate(28 200 205)">');

  // Shallow sides past the edge
  a.begin();
  a.path(sides, 'd', 1.1);
  a.add(shade({ shape: sides, box: { x: cx - 66, y: top - 4, w: 140, h: len + 10 }, angle: 64, spacing: 1.5, width: 0.5, light: P(-6, -3) }));
  a.hidden(body);
  // Spruce top
  a.fillin(body);
  a.path(body, 'd', 1.6);
  a.path(binding, 'd', 0.5);
  let grain = '';
  for (let x = cx - 60; x < cx + 62; x += 4.2) grain += line(P(x, top), P(x + 0.5, bottom));
  a.add(`<g clip-path="url(#guitar-top)"><path class="h" d="${grain}" stroke-width="0.2" opacity=".7"/></g>`);
  a.defs += `<clipPath id="guitar-top"><path d="${binding}"/></clipPath>`;
  a.add(shade({ shape: body, box: { x: cx - 66, y: top - 4, w: 132, h: len + 8 }, angle: 40, spacing: 2.6, width: 0.38, light: P(-20, -22) }));

  // Golpeadores: clear tap plates, one each side of the soundhole, reaching toward the bridge
  const plate = (s) =>
    smooth([P(cx + s * 15, hole.y + 12), P(cx + s * 21, hole.y - 4), P(cx + s * 31, hole.y - 2), P(cx + s * 37, hole.y + 14), P(cx + s * 35, hole.y + 34), P(cx + s * 26, hole.y + 48), P(cx + s * 18, hole.y + 42), P(cx + s * 15, hole.y + 28)], true, 0.5);
  for (const s of [-1, 1]) {
    a.path(plate(s), 'd', 0.55);
    // Clear plastic: only a couple of glints
    a.path(`M${cx + s * 24} ${hole.y + 2}L${cx + s * 31} ${hole.y + 12}M${cx + s * 22} ${hole.y + 10}L${cx + s * 26} ${hole.y + 16}`, 'h', 0.45);
  }

  // Soundhole and mosaic rosette
  a.path(circle(hole.x, hole.y, holeR), 'd', 1.2);
  a.add(fillHatch({ shape: circle(hole.x, hole.y, holeR), box: { x: hole.x - holeR, y: hole.y - holeR, w: 2 * holeR, h: 2 * holeR }, angle: 70, spacing: 1.2, width: 0.45 }));
  a.path(circle(hole.x, hole.y, holeR + 3) + circle(hole.x, hole.y, holeR + 4.2) + circle(hole.x, hole.y, holeR + 8.4) + circle(hole.x, hole.y, holeR + 9.6), 'd', 0.6);
  let mosaic = '';
  const n = 44;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r1 = holeR + 4.6;
    const r2 = holeR + 8;
    const t2 = t + Math.PI / n;
    mosaic += `M${f(hole.x + r1 * Math.cos(t))} ${f(hole.y + r1 * Math.sin(t))}L${f(hole.x + r2 * Math.cos(t2))} ${f(hole.y + r2 * Math.sin(t2))}L${f(hole.x + r1 * Math.cos(t + (2 * Math.PI) / n))} ${f(hole.y + r1 * Math.sin(t + (2 * Math.PI) / n))}`;
  }
  a.path(mosaic, 'h', 0.45);

  // Neck and fingerboard with nineteen frets (the 19th at the soundhole)
  const fbEnd = hole.y - holeR - 3.2;
  const wNut = 8.8;
  const wBody = 10.6;
  const wAt = (y) => wNut + ((wBody - wNut) * (y - nut)) / (top - nut);
  const fb = `M${cx - wNut} ${nut}L${cx + wNut} ${nut}L${f(cx + wAt(fbEnd))} ${f(fbEnd)}L${f(cx - wAt(fbEnd))} ${f(fbEnd)}Z`;
  a.path(`M${cx - wNut} ${nut}L${cx - wBody} ${top + 1}M${cx + wNut} ${nut}L${cx + wBody} ${top + 1}`, 'd', 1.2);
  a.path(fb, 'd', 1.1);
  a.add(fillHatch({ shape: fb, box: { x: cx - 12, y: nut - 2, w: 24, h: fbEnd - nut + 4 }, angle: 88, spacing: 1.5, width: 0.4 }));
  let frets = '';
  for (const y of fretYs(nut, saddle - nut, 19)) frets += line(P(cx - wAt(y), y), P(cx + wAt(y), y));
  a.path(frets, 'd', 0.6);
  // Position dots are not used on Spanish guitars; the nut is bone
  a.path(rect(cx - wNut - 0.2, nut - 2.4, 2 * wNut + 0.4, 2.4), 'd', 0.8);

  // Slotted head: two slots, three rollers each, tuner buttons outside
  const hTop = 28;
  const head = `M${cx - wNut} ${nut - 2.4}L${cx - 12.4} ${hTop + 6}Q${cx - 12} ${hTop - 2} ${cx - 4} ${hTop + 1}Q${cx} ${hTop - 3} ${cx + 4} ${hTop + 1}Q${cx + 12} ${hTop - 2} ${cx + 12.4} ${hTop + 6}L${cx + wNut} ${nut - 2.4}Z`;
  a.path(head, 'd', 1.2);
  a.add(fillHatch({ shape: head, box: { x: cx - 14, y: hTop - 4, w: 28, h: nut - hTop + 2 }, angle: 75, spacing: 2.2, width: 0.32 }));
  const slots = [-1, 1].map((s) => rect(cx + (s < 0 ? -8.4 : 3.4), hTop + 12, 5, 42, 2.4));
  a.path(slots.join(''), 'd', 0.8);
  slots.forEach((d, i) => a.add(fillHatch({ shape: d, box: { x: cx + (i ? 2 : -10), y: hTop + 10, w: 9, h: 46 }, angle: 80, spacing: 1.1, width: 0.42 })));
  let tuners = '';
  const rollers = [hTop + 20, hTop + 33, hTop + 46];
  for (const s of [-1, 1]) {
    for (const y of rollers) {
      tuners += line(P(cx + s * 3.4, y - 1.4), P(cx + s * 8.4, y - 1.4)) + line(P(cx + s * 3.4, y + 1.4), P(cx + s * 8.4, y + 1.4));
      tuners += `M${cx + s * 12.4} ${y - 1}L${cx + s * 17} ${y - 1}M${cx + s * 12.4} ${y + 1}L${cx + s * 17} ${y + 1}` + ellipse(cx + s * 21.5, y, 4.6, 3.4);
    }
  }
  a.path(tuners, 'd', 0.75);

  // Bridge: saddle and tie block
  const br = `M${cx - 32} ${saddle + 1}Q${cx - 30} ${saddle - 3} ${cx - 20} ${saddle - 3}L${cx + 20} ${saddle - 3}Q${cx + 30} ${saddle - 3} ${cx + 32} ${saddle + 1}Q${cx + 30} ${saddle + 9} ${cx + 20} ${saddle + 9}L${cx - 20} ${saddle + 9}Q${cx - 30} ${saddle + 9} ${cx - 32} ${saddle + 1}Z`;
  a.path(br, 'd', 1);
  a.add(fillHatch({ shape: br, box: { x: cx - 34, y: saddle - 5, w: 68, h: 16 }, angle: 0, spacing: 1.4, width: 0.38 }));
  a.path(rect(cx - 13, saddle - 1.2, 26, 2) + rect(cx - 13.5, saddle + 3.4, 27, 3.6), 'd', 0.6);

  // Strings: tie block → saddle → nut → rollers
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const xb = cx - 11 + 22 * t;
    const xn = cx - 6.8 + 13.6 * t;
    const s = i < 3 ? -1 : 1;
    const yR = rollers[i < 3 ? 2 - i : i - 3];
    a.path(`M${f(xb)} ${saddle + 5}L${f(xb)} ${saddle - 0.6}L${f(xn)} ${nut - 1}L${f(cx + s * 5.9)} ${yR}`, 'str', i < 3 ? 0.62 : 0.45);
  }
  a.add('</g>');
  return a.done('Гитара фламенко');
}
