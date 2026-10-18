import { Art, P, smooth, line, circle, ellipse, shade, fillHatch, medallion, f } from '../lib.mjs';

// Sitar: one gourd, a long neck, raised frets, playing strings over the frets and sympathetic
// strings in a channel beside them. No second gourd: the wide 360p frames
// (I Have Come Alive, 231 s and 394 s) do not resolve an upper gourd.
// Length follows two catalogued concert sitars that publish it:
// ROM 973.159, 123.3 cm, 7 main strings (2 on the face, 5 on the side), 11 sympathetic, 19 frets
// (https://collections.rom.on.ca/objects/342280/sitar);
// Tokyo Geidai no. 245, 123.0 cm, 7 main, 12 sympathetic, 20 frets
// (https://www.geidai.ac.jp/labs/koizumi/english/gcato/html-text/245.html).
// This drawing uses the ROM count. Geidai's twelfth sympathetic string and twentieth fret
// are left out so the courses stay separable at this size.
// Neither card publishes a neck width or a gourd diameter. The neck is drawn at 9.2 cm
// and the gourd at 28 cm so the tumba reads against that length. 28 cm is not a measured
// museum figure. The Met sitar 89.4.1585 is a different instrument (129.5 × 30.5 cm,
// six strings, no sympathetic strings; https://www.metmuseum.org/art/collection/search/502149)
// and its dimensions are not used here.
// Scale ≈ 2.55 px/cm.
export default function sitar() {
  const a = new Art('sitar');
  const cx = 208;
  const scale = 2.55;
  const gourd = P(cx, 308);
  const gR = 14 * scale; // half of 28 cm
  const nut = 58;
  const neckTop = nut;
  const neckJoin = gourd.y - gR + 8;
  const nw = 4.6 * scale; // fingerboard about 9 cm across

  a.add(medallion());
  a.add('<g transform="rotate(26 200 210)">');

  // Pumpkin, seen from the front. The back bowl sticks out to the right.
  const bowl = ellipse(gourd.x + 7, gourd.y + 4, gR + 4, gR - 2);
  const tumba = circle(gourd.x, gourd.y, gR);
  a.begin();
  a.path(bowl, 'd', 1.05);
  a.add(shade({ shape: bowl, box: { x: gourd.x - gR - 8, y: gourd.y - gR - 6, w: gR * 2 + 28, h: gR * 2 + 16 }, angle: 55, spacing: 1.7, width: 0.45, light: P(-10, -8) }));
  a.hidden(tumba);

  // Neck and pegbox, hidden where the soundboard covers the joint.
  const neck = `M${cx - nw} ${neckJoin}L${cx - nw * 0.78} ${neckTop}L${cx + nw * 0.78} ${neckTop}L${cx + nw} ${neckJoin}Z`;
  const headTop = 28;
  const head = `M${cx - nw * 0.78} ${neckTop}L${cx - nw * 0.7} ${headTop + 8}Q${cx - 4} ${headTop - 2} ${cx + 2} ${headTop + 4}Q${cx + nw * 0.5} ${headTop + 10} ${cx + nw * 0.55} ${neckTop - 2}L${cx + nw * 0.78} ${neckTop}`;
  a.begin();
  a.path(neck, 'd', 1.25);
  a.add(shade({ shape: neck, box: { x: cx - nw - 4, y: neckTop - 2, w: nw * 2 + 8, h: neckJoin - neckTop + 8 }, angle: 90, spacing: 1.6, width: 0.4, light: P(-4, 0) }));
  a.path(head, 'd', 1.15);
  a.add(fillHatch({ shape: `${head}Z`, box: { x: cx - nw - 2, y: headTop - 4, w: nw * 2 + 8, h: neckTop - headTop + 6 }, angle: 70, spacing: 1.8, width: 0.36 }));
  a.hidden(tumba);

  // Soundboard (tabli) set into the gourd, with a plain border. Not a copy of one painted tumba.
  const tabli = circle(gourd.x, gourd.y + 2, gR - 7);
  a.fillin(tabli);
  a.path(tumba, 'd', 1.5);
  a.path(tabli, 'd', 1.15);
  a.path(circle(gourd.x, gourd.y + 2, gR - 11), 'd', 0.45);
  a.add(shade({ shape: tumba, box: { x: gourd.x - gR - 2, y: gourd.y - gR - 2, w: gR * 2 + 6, h: gR * 2 + 6 }, angle: 40, spacing: 2.4, width: 0.36, light: P(-16, -14) }));

  // Main pegs: five on the side of the pegbox, two on the face just under the nut.
  let pegs = '';
  const sidePegs = [];
  for (let i = 0; i < 5; i++) {
    const yy = headTop + 12 + i * 7.2;
    sidePegs.push(yy);
    const x0 = cx - nw * 0.55;
    pegs += `M${f(x0)} ${f(yy - 1.1)}L${f(x0 - 14)} ${f(yy - 3)}C${f(x0 - 20)} ${f(yy - 6)} ${f(x0 - 24)} ${f(yy - 2)} ${f(x0 - 22)} ${f(yy + 1)}C${f(x0 - 20)} ${f(yy + 4)} ${f(x0 - 14)} ${f(yy + 3)} ${f(x0 - 12)} ${f(yy + 1.2)}L${f(x0)} ${f(yy + 1.1)}`;
  }
  const facePegs = [neckTop + 10, neckTop + 20];
  for (const yy of facePegs) {
    pegs += ellipse(cx + nw * 0.15, yy, 3.2, 2.4);
    pegs += line(P(cx + nw * 0.15, yy), P(cx + nw + 8, yy - 2));
    pegs += ellipse(cx + nw + 11, yy - 2.4, 3.4, 2.6);
  }
  a.path(pegs, 'd', 0.75);

  // Sympathetic pegs down the bass side of the neck. Eleven, matching the courses.
  const symPegs = [];
  let sym = '';
  for (let i = 0; i < 11; i++) {
    const yy = neckTop + 34 + i * ((neckJoin - neckTop - 48) / 10);
    symPegs.push(yy);
    const x0 = cx - nw;
    sym += `M${f(x0)} ${f(yy)}L${f(x0 - 8)} ${f(yy - 1.4)}`;
    sym += ellipse(x0 - 11, yy - 1.6, 2.6, 1.8);
  }
  a.path(sym, 'd', 0.6);

  // Sympathetic strings in the bass channel, under the frets that follow.
  a.add('<g>');
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const xb = cx - 13 + 8 * t;
    const pegY = symPegs[i];
    a.path(`M${f(xb)} ${f(gourd.y + 8)}L${f(cx - nw + 1.1 + t * 1.6)} ${f(pegY)}`, 'str', 0.28);
  }
  a.add('</g>');

  // Raised frets: arches over the playing strings only. The bass edge stays clear
  // for the sympathetic courses. Nineteen, ROM's count. Spacing narrows toward the gourd.
  let frets = '';
  const fretSpan = neckJoin - 6 - (neckTop + 6);
  for (let i = 1; i <= 19; i++) {
    const yy = neckTop + 6 + fretSpan * (1 - Math.pow(2, -i / 12));
    if (yy > neckJoin - 4) break;
    const grow = (yy - neckTop) / (neckJoin - neckTop);
    const xL = cx - nw * (0.48 + 0.06 * grow);
    const xR = cx + nw * (0.84 + 0.1 * grow);
    const arch = 3.1 + (i % 3) * 0.15;
    frets += `M${f(xL)} ${f(yy)}Q${f((xL + xR) / 2)} ${f(yy - arch)} ${f(xR)} ${f(yy)}`;
  }
  a.path(frets, 'd', 0.6);

  // Jawari: a wide flat bridge on the soundboard, and a small tail button.
  const by = gourd.y + 4;
  const jaw = `M${cx - 16} ${by}L${cx + 16} ${by}L${cx + 14} ${by + 5}L${cx - 14} ${by + 5}Z`;
  a.path(jaw, 'd', 0.95);
  a.add(fillHatch({ shape: jaw, box: { x: cx - 18, y: by - 1, w: 36, h: 8 }, angle: 0, spacing: 1.2, width: 0.4 }));
  a.path(line(P(cx - 13, by + 1.2), P(cx + 13, by + 1.2)), 'd', 0.55);
  const tailY = gourd.y + gR - 10;
  a.path(circle(cx, tailY, 2.4), 'd', 0.7);

  // Seven playing strings over the frets. Five go to the side pegs, two to the face pegs.
  a.add('<g>');
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const xb = cx - 8 + 18 * t;
    const xn = cx - nw * 0.4 + nw * 1.15 * t;
    const wound = i < 4;
    // Five go to the side pegs, two to the face pegs.
    const end = i < 5 ? P(cx - nw * 0.4, sidePegs[i]) : P(cx + nw * 0.2, facePegs[i - 5]);
    a.path(`M${f(cx - 4 + 8 * t)} ${f(tailY)}L${f(xb)} ${f(by)}L${f(xn)} ${f(neckTop)}L${f(end.x)} ${f(end.y)}`, 'str', wound ? 0.62 : 0.4);
  }
  a.add('</g>');

  a.add('</g>');
  return a.done('Ситар');
}
