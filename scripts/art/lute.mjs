// Shared long-necked lute builder (tanbur, bağlama, setar, tar-like bodies).
import { Art, P, smooth, line, circle, shade, fillHatch, medallion, rosette, f } from './lib.mjs';

/**
 * @param {object} o
 *  key, title, bodyW, bodyH, bodyTop (y of neck joint), neckTop (y of nut), headH,
 *  frets: number of tied frets, strings: number, pegs: [left, right] or {front: n},
 *  soundhole: 'rosette' | 'small' | null, guard: boolean, tilt
 */
export function longNeckLute(o) {
  const a = new Art(o.key);
  const cx = 200;
  const bottom = o.bottom ?? 372;
  const bodyTop = bottom - o.bodyH;
  const w = o.bodyW / 2;
  // Pear/teardrop body: widest in the lower third
  const R = [
    P(cx + o.neckW / 2 + 2, bodyTop),
    P(cx + w * 0.55, bodyTop + o.bodyH * 0.18),
    P(cx + w * 0.92, bodyTop + o.bodyH * 0.45),
    P(cx + w, bodyTop + o.bodyH * 0.68),
    P(cx + w * 0.8, bodyTop + o.bodyH * 0.9),
    P(cx + w * 0.35, bottom),
  ];
  const L = R.slice().reverse().map((p) => P(2 * cx - p.x, p.y));
  const bodyPts = [...R, ...L];
  const body = smooth(bodyPts, true, 0.5);
  const back = smooth(bodyPts.map((p) => P(p.x + 6, p.y + 4)), true, 0.5);
  const nut = o.neckTop;
  const nw = o.neckW / 2;
  const neck = `M${cx - nw} ${bodyTop + 4}L${cx - nw * 0.82} ${nut}L${cx + nw * 0.82} ${nut}L${cx + nw} ${bodyTop + 4}`;

  a.add(medallion());
  a.add(`<g transform="rotate(${o.tilt ?? 32} 200 205)">`);
  // Back of the bowl beyond the soundboard
  a.path(back, 'd', 1.1);
  a.add(shade({ shape: back, box: { x: cx - w - 10, y: bodyTop - 10, w: 2 * w + 30, h: o.bodyH + 30 }, angle: 60, spacing: 1.6, width: 0.5, light: P(-6, -4) }));
  // Soundboard
  a.fillin(body);
  a.path(body, 'd', 1.5);
  a.add(shade({ shape: body, box: { x: cx - w - 4, y: bodyTop - 4, w: 2 * w + 8, h: o.bodyH + 8 }, angle: 45, spacing: 2.6, width: 0.4, light: P(-w * 0.35, -o.bodyH * 0.25) }));
  // Staves hinted on the soundboard (tanbur/bağlama are carved, the lines read as wood grain)
  let grain = '';
  for (let x = cx - w + 6; x < cx + w; x += 6) grain += line(P(x, bodyTop), P(x + 1, bottom));
  a.add(`<g clip-path="url(#${o.key}-bodyclip)"><path class="h" d="${grain}" stroke-width="0.2" opacity=".7"/></g>`);
  a.defs += `<clipPath id="${o.key}-bodyclip"><path d="${body}"/></clipPath>`;

  // Neck with tied frets
  a.path(`${neck}`, 'd', 1.3);
  a.add(shade({ shape: `${neck}Z`, box: { x: cx - nw - 2, y: nut - 2, w: o.neckW + 4, h: bodyTop - nut + 8 }, angle: 90, spacing: 1.5, width: 0.45, light: P(-3, 0) }));
  let frets = '';
  const scale = bodyTop + o.bodyH * 0.72 - nut; // nut → bridge distance
  for (let i = 1; i <= o.frets; i++) {
    // Equal-temperament-like spacing, compressed (these lutes use microtonal frets)
    const y = nut + scale * (1 - Math.pow(2, -(i * (o.fretStep ?? 0.9)) / 12));
    if (y > bodyTop + 2) break;
    const half = nw * (0.82 + (0.18 * (y - nut)) / (bodyTop - nut));
    frets += line(P(cx - half - 0.6, y), P(cx + half + 0.6, y)) + line(P(cx - half - 0.6, y + 1.3), P(cx + half + 0.6, y + 1.3));
  }
  a.path(frets, 'd', 0.55);

  // Head and pegs
  const headTop = nut - o.headH;
  const head = `M${cx - nw * 0.82} ${nut}L${cx - nw * 0.75} ${headTop + 6}Q${cx} ${headTop - 4} ${cx + nw * 0.75} ${headTop + 6}L${cx + nw * 0.82} ${nut}`;
  a.path(head, 'd', 1.2);
  a.add(fillHatch({ shape: `${head}Z`, box: { x: cx - nw - 2, y: headTop - 6, w: o.neckW + 4, h: o.headH + 8 }, angle: 75, spacing: 1.7, width: 0.42 }));
  let pegs = '';
  const pegList = o.pegs; // [{side:-1|1, y}]
  for (const p of pegList) {
    const x0 = cx + p.side * nw * 0.8;
    const tip = P(x0 + p.side * 16, p.y - 2);
    pegs += `M${x0} ${p.y - 1.2}L${tip.x} ${tip.y - 1}C${tip.x + p.side * 3} ${tip.y - 4.5} ${tip.x + p.side * 10} ${tip.y - 3.5} ${tip.x + p.side * 10} ${tip.y}C${tip.x + p.side * 10} ${tip.y + 3.5} ${tip.x + p.side * 3} ${tip.y + 4.5} ${tip.x} ${tip.y + 1}L${x0} ${p.y + 1.2}`;
  }
  a.path(pegs, 'd', 0.8);

  // Soundhole and pickguard
  if (o.soundhole === 'rosette') a.add(rosette(cx, bodyTop + o.bodyH * 0.38, 9, 6, { width: 0.6, petals: false }));
  if (o.soundhole === 'small') a.path(circle(cx + w * 0.42, bodyTop + o.bodyH * 0.42, 3.4), 'd', 0.8);
  if (o.guard) {
    const g = `M${cx - w * 0.45} ${bodyTop + o.bodyH * 0.5}Q${cx} ${bodyTop + o.bodyH * 0.44} ${cx + w * 0.45} ${bodyTop + o.bodyH * 0.5}L${cx + w * 0.38} ${bodyTop + o.bodyH * 0.64}Q${cx} ${bodyTop + o.bodyH * 0.6} ${cx - w * 0.38} ${bodyTop + o.bodyH * 0.64}Z`;
    a.path(g, 'd', 0.8);
    a.add(fillHatch({ shape: g, box: { x: cx - w * 0.5, y: bodyTop + o.bodyH * 0.42, w: w, h: o.bodyH * 0.25 }, angle: 30, spacing: 2.2, width: 0.4 }));
  }

  // Bridge and tailpiece
  const by = bodyTop + o.bodyH * 0.72;
  const bridge = `M${cx - 11} ${by}L${cx + 11} ${by}L${cx + 9} ${by + 4}L${cx - 9} ${by + 4}Z`;
  a.path(bridge, 'd', 0.9);
  a.path(`M${cx - 4} ${bottom - 2}L${cx + 4} ${bottom - 2}`, 'd', 1);

  // Strings from tail to pegs
  for (let i = 0; i < o.strings; i++) {
    const t = o.strings === 1 ? 0.5 : i / (o.strings - 1);
    const xb = cx - 6 + 12 * t;
    const xn = cx - nw * 0.55 + nw * 1.1 * t;
    const peg = pegList[i % pegList.length];
    a.path(`M${f(cx - 2 + 4 * t)} ${bottom - 2}L${f(xb)} ${by}L${f(xn)} ${nut}L${f(cx + peg.side * nw * 0.5)} ${peg.y}`, 'str', 0.5);
  }
  a.add('</g>');
  return a.done(o.title);
}
