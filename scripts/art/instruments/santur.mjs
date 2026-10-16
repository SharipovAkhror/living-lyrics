import { Art, P, poly, line, shade, fillHatch, rosette, medallion, lerpP, f } from '../lib.mjs';

// Santur: trapezoidal hammered dulcimer seen from the player, two rows of bridges (kharak),
// eighteen courses of four strings, two light mallets (mezrab) resting on the board.
export default function santur() {
  const a = new Art('santur');
  const nl = P(36, 282);
  const nr = P(364, 282);
  const fr = P(292, 142);
  const fl = P(108, 142);
  const top = poly([nl, nr, fr, fl]);
  const d = 12;
  const front = poly([nl, nr, P(nr.x, nr.y + d), P(nl.x, nl.y + d)]);
  a.add(medallion());
  a.add('<g transform="translate(200 214) rotate(-6) scale(0.9) translate(-200 -212)">');
  a.path(front, 'd', 1.2);
  a.add(fillHatch({ shape: front, box: { x: 34, y: 280, w: 334, h: 16 }, angle: 0, spacing: 1.5, width: 0.5 }));
  a.fillin(top);
  a.path(top, 'd', 1.6);
  a.add(shade({ shape: top, box: { x: 34, y: 138, w: 334, h: 148 }, angle: 15, spacing: 2.8, width: 0.38, light: P(-40, -26) }));
  a.add(rosette(160, 196, 11, 6, { width: 0.6, petals: false }));
  a.add(rosette(248, 236, 11, 6, { width: 0.6, petals: false }));
  // Courses and bridges
  const courses = 18;
  const strings = [];
  let bridges = '';
  for (let i = 0; i < courses; i++) {
    const t = (i + 0.5) / courses;
    const L = lerpP(fl, nl, t);
    const R = lerpP(fr, nr, t);
    // Bridges alternate rows: left row at 0.36, right row at 0.66
    const side = i % 2 === 0 ? 0.36 : 0.66;
    const b = lerpP(L, R, side);
    bridges += `M${f(b.x - 3)} ${f(b.y + 2.5)}L${f(b.x - 1.2)} ${f(b.y - 2.5)}L${f(b.x + 1.2)} ${f(b.y - 2.5)}L${f(b.x + 3)} ${f(b.y + 2.5)}Z`;
    let lane = '';
    for (let s = 0; s < 4; s++) {
      const dy = (s - 1.5) * 0.9;
      lane += line(P(L.x + 6, L.y + dy), P(R.x - 6, R.y + dy));
    }
    strings.push(lane);
  }
  for (let g = 0; g < courses; g += 3) a.path(strings.slice(g, g + 3).join(''), 'str', 0.3);
  a.path(bridges, 'd', 0.7);
  // Hitch pins (left) and tuning pins (right)
  let pins = '';
  for (let i = 0; i < courses * 2; i++) {
    const t = (i + 0.5) / (courses * 2);
    const L = lerpP(lerpP(fl, nl, t), lerpP(fr, nr, t), 0.035);
    const R = lerpP(lerpP(fl, nl, t), lerpP(fr, nr, t), 0.965);
    pins += `M${f(L.x)} ${f(L.y)}l.1 0M${f(R.x)} ${f(R.y)}l.1 0`;
  }
  a.path(pins, 'h', 1.6);
  // Mezrabs: slim sticks with felted rings at the ends
  const mallet = (x, y, ang) => {
    const c = Math.cos((ang * Math.PI) / 180);
    const s = Math.sin((ang * Math.PI) / 180);
    const e = P(x + 120 * c, y + 120 * s);
    return `M${x} ${y}L${f(e.x)} ${f(e.y)}M${f(e.x)} ${f(e.y)}c${f(6 * c - 4 * s)} ${f(6 * s + 4 * c)} ${f(12 * c)} ${f(12 * s)} ${f(10 * c + 5 * s)} ${f(10 * s - 5 * c)}`;
  };
  a.path(mallet(86, 312, -14) + mallet(170, 326, -18), 'd', 1.1);
  a.add('</g>');
  return a.done('Сантур');
}
