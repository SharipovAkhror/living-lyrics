import { Art, P, line, ellipse, shade, fillHatch, medallion, f } from '../lib.mjs';

// Erhu: long rod neck, two side pegs, hexagonal resonator covered with python skin,
// two strings with the qianjin loop, bow hair running between the strings.
export default function erhu() {
  const a = new Art('erhu');
  const cx = 200;
  a.add(medallion());
  a.add('<g transform="translate(200 205) rotate(-14) scale(1.08) translate(-200 -200)">');
  // Neck rod and scroll head
  const neck = `M${cx - 4} 330L${cx - 3} 58L${cx + 3} 58L${cx + 4} 330`;
  a.path(neck, 'd', 1.3);
  a.add(shade({ shape: `${neck}Z`, box: { x: cx - 6, y: 54, w: 12, h: 280 }, angle: 90, spacing: 1.3, width: 0.45, light: P(-2, 0) }));
  a.path(`M${cx - 3} 58C${cx - 4} 44 ${cx + 10} 34 ${cx + 12} 44C${cx + 14} 52 ${cx + 4} 54 ${cx + 3} 48`, 'd', 1.2);
  // Pegs
  a.path(`M${cx - 4} 78L${cx - 24} 76M${cx - 24} 72L${cx - 30} 72L${cx - 31} 80L${cx - 24} 80ZM${cx + 4} 96L${cx - 24} 94M${cx - 24} 90L${cx - 30} 90L${cx - 31} 98L${cx - 24} 98Z`, 'd', 0.9);
  // Qianjin loop
  a.path(`M${cx - 4} 168C${cx - 10} 168 ${cx - 10} 174 ${cx - 4} 174M${cx + 4} 168C${cx + 10} 168 ${cx + 10} 174 ${cx + 4} 174`, 'd', 0.8);
  // Resonator: hexagonal prism in three-quarter view
  const rc = P(cx + 2, 330);
  const hx = (r, dx = 0) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
      pts.push(P(rc.x + dx + r * Math.cos(ang) * 0.62, rc.y + r * Math.sin(ang)));
    }
    return pts;
  };
  const front = hx(40);
  const back = hx(40, 30);
  let prism = '';
  front.forEach((p, i) => (prism += line(p, back[i])));
  const poly6 = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
  a.path(poly6(back), 'd', 1);
  a.path(prism, 'd', 0.9);
  a.add(fillHatch({ shape: poly6([back[0], back[1], back[2], front[2], front[1], front[0]]), box: { x: rc.x - 30, y: rc.y - 40, w: 90, h: 80 }, angle: 80, spacing: 1.5, width: 0.45 }));
  // Python skin on the front face: scale pattern
  const skin = poly6(front);
  a.add('<g class="skin">');
  a.fillin(skin);
  a.path(skin, 'd', 1.4);
  let scales = '';
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 8; c++) {
      const x = rc.x - 22 + c * 6 + (r % 2) * 3;
      const y = rc.y - 30 + r * 5.4;
      scales += `M${f(x - 3)} ${f(y)}Q${f(x)} ${f(y + 3.4)} ${f(x + 3)} ${f(y)}`;
    }
  }
  a.add(`<g clip-path="url(#erhu-skin)"><path class="h" d="${scales}" stroke-width="0.4"/></g>`);
  a.defs += `<clipPath id="erhu-skin"><path d="${skin}"/></clipPath>`;
  a.add('</g>');
  // Bridge on the skin
  a.path(`M${cx - 3} 318L${cx + 3} 318L${cx + 2} 324L${cx - 2} 324Z`, 'd', 0.8);
  // Strings
  a.path(`M${cx - 1.5} 321L${cx - 2} 78`, 'str', 0.55);
  a.path(`M${cx + 1.5} 321L${cx - 1} 96`, 'str', 0.5);
  // Bow: bamboo stick arching, hair passing between the strings
  const bow = `M88 300C150 236 248 192 340 180`;
  a.path(bow, 'd', 1.3);
  a.path(`M92 306L338 186`, 'str', 0.6);
  a.path(ellipse(90, 303, 4, 6, -40) + ellipse(339, 183, 3, 5, -30), 'd', 0.8);
  a.add('</g>');
  return a.done('Эрху');
}
