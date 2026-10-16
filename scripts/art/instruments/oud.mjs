import { Art, P, smooth, line, circle, shade, fillHatch, rosette, medallion, dots, gid } from '../lib.mjs';

// Oud, front view, tilted. Pear-shaped soundboard on a staved bowl, three rosettes,
// short fretless neck, pegbox bent back with twelve pegs, eleven strings in courses.
export default function oud({ framed = true, transform = 'rotate(-24 200 205)' } = {}) {
  const a = new Art('oud');
  const R = [P(214, 138), P(240, 157), P(268, 189), P(289, 228), P(296, 266), P(289, 305), P(262, 337), P(226, 352)];
  const L = R.slice().reverse().map((p) => P(400 - p.x, p.y));
  const bodyPts = [...R, ...L];
  const body = smooth(bodyPts, true, 0.5);
  const box = { x: 100, y: 130, w: 200, h: 230 };
  const bowl = smooth(bodyPts.map((p) => P(p.x + 7, p.y + 5)), true, 0.5);
  const inner = smooth(bodyPts.map((p) => P(200 + (p.x - 200) * 0.955, 250 + (p.y - 250) * 0.962)), true, 0.5);

  if (framed) a.add(medallion());
  a.add(`<g transform="${transform}">`);

  // Bowl seen past the soundboard edge: dense engraved crescent.
  a.path(bowl, 'd', 1.2);
  a.add(shade({ shape: bowl, box: { x: 100, y: 130, w: 210, h: 235 }, angle: 60, spacing: 1.7, width: 0.55, light: P(-7, -5) }));
  // Staves hinted on the bowl crescent.
  let staves = '';
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    staves += smooth([P(214 + 3, 140 + 3), P(270 + 8 * t, 200 + 4), P(300 + 3 * t, 270 + 12 * t), P(240 + 10 * t, 356)], false, 0.8);
  }
  a.add(`<g mask="url(#oud-bowlmask)"><path class="h" d="${staves}" stroke-width="0.35"/></g>`);
  a.defs += `<mask id="oud-bowlmask" maskUnits="userSpaceOnUse" x="80" y="110" width="250" height="270"><path d="${bowl}" fill="#fff"/><path d="${body}" fill="#000"/></mask>`;

  // Soundboard
  a.fillin(body);
  a.path(body, 'd', 1.6);
  a.path(inner, 'd', 0.6);
  // Spruce grain, very light
  const grainClip = gid('clip');
  a.defs += `<clipPath id="${grainClip}"><path d="${inner}"/></clipPath>`;
  let grain = '';
  for (let x = 108; x < 296; x += 5.5) grain += line(P(x, 130), P(x + 1.5, 360));
  a.add(`<g clip-path="url(#${grainClip})"><path class="h" d="${grain}" stroke-width="0.22" opacity="0.7"/></g>`);
  a.add(shade({ shape: inner, box, angle: 50, spacing: 2.6, width: 0.42, light: P(-26, -22) }));

  // Fingerboard (ebony) running onto the soundboard
  const fb = `M189 62L211 62L215 150Q215 178 200 180Q185 178 185 150Z`;
  a.path(fb, 'd', 1.2);
  a.add(fillHatch({ shape: fb, box: { x: 180, y: 58, w: 40, h: 126 }, angle: 80, spacing: 1.5, width: 0.5 }));
  // Neck sides
  a.path(`M185 138L187 62M215 138L213 62`, 'd', 1.2);
  // Nut
  a.path(`M187 62L213 62M187 59L213 59`, 'd', 1);

  // Pegbox bent back, with six pegs a side
  const pegbox = `M188 59L193 14Q200 8 207 14L212 59`;
  a.path(pegbox, 'd', 1.3);
  a.add(fillHatch({ shape: `${pegbox}Z`, box: { x: 186, y: 8, w: 28, h: 52 }, angle: 70, spacing: 1.9, width: 0.45 }));
  // Pegs: tapered shafts with pear-shaped heads, angled slightly back
  let pegs = '';
  const peg = (x, y, dir) => {
    const tip = P(x + dir * 15, y - 2.5);
    const head = `M${x + dir * 2} ${y - 1}L${tip.x} ${tip.y - 1.2}C${tip.x + dir * 2} ${tip.y - 4} ${tip.x + dir * 9} ${tip.y - 3.5} ${tip.x + dir * 9.5} ${tip.y}C${tip.x + dir * 9} ${tip.y + 3.5} ${tip.x + dir * 2} ${tip.y + 4} ${tip.x} ${tip.y + 1.2}L${x + dir * 2} ${y + 1}`;
    return head;
  };
  for (let i = 0; i < 6; i++) {
    const y = 20 + i * 7;
    pegs += peg(190 + i * 0.6, y, -1) + peg(210 - i * 0.6, y, 1);
  }
  a.path(pegs, 'd', 0.8);

  // Rosettes: one large, two small, with a dotted inlay ring around the large one
  a.add(rosette(200, 222, 24, 8, { width: 0.9 }));
  a.path(dots(Array.from({ length: 41 }, (_, i) => P(200 + 30 * Math.cos((i / 40) * Math.PI * 2), 222 + 30 * Math.sin((i / 40) * Math.PI * 2))), 4.6, 0.7), 'h', 0.5);
  a.add(rosette(160, 262, 11, 6, { width: 0.7, petals: false }));
  a.add(rosette(240, 262, 11, 6, { width: 0.7, petals: false }));

  // Pickguard (darker wood) between rosette and bridge
  const guard = `M200 258C226 258 238 272 236 288C234 302 218 308 200 308C182 308 166 302 164 288C162 272 174 258 200 258Z`;
  a.path(guard, 'd', 1);
  a.add(fillHatch({ shape: guard, box: { x: 160, y: 254, w: 80, h: 58 }, angle: 35, spacing: 1.6, width: 0.45, cross: true }));

  // Bridge with string ties
  const bridge = `M166 318Q200 313 234 318L234 326Q200 321 166 326Z`;
  a.path(bridge, 'd', 1.1);
  a.add(fillHatch({ shape: bridge, box: { x: 164, y: 312, w: 72, h: 16 }, angle: 0, spacing: 1.4, width: 0.4 }));

  // Strings: five double courses and a single bass, bridge to nut, then into the pegbox
  const xsB = [176, 179.5, 186, 189.5, 196, 199.5, 206, 209.5, 216, 219.5, 225];
  xsB.forEach((xb, i) => {
    const t = i / (xsB.length - 1);
    const xn = 190.5 + t * 19;
    const xp = 196 + t * 8;
    a.path(`M${xb} 319L${xn.toFixed(1)} 62L${xp.toFixed(1)} ${20 + (i % 6) * 7}`, 'str', i === 10 ? 0.9 : 0.62);
  });

  a.add('</g>');
  return a.done('Уд');
}
