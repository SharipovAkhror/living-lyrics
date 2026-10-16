import { Art, P, poly, line, circle, shade, fillHatch, rosette, medallion, dots, lerpP, f } from '../lib.mjs';

// Qanun seen from the player, in light perspective: trapezoid soundboard, five fish-skin panels
// under a long bridge on the right, pegs and mandal levers along the slanted left edge,
// 26 courses of three strings.
export default function qanun() {
  const a = new Art('qanun');
  const nearL = P(28, 292);
  const nearR = P(372, 292);
  const farR = P(352, 150);
  const farL = P(158, 150);
  const top = poly([nearL, nearR, farR, farL]);
  const depth = 13;
  const front = poly([nearL, nearR, P(nearR.x, nearR.y + depth), P(nearL.x, nearL.y + depth)]);
  const side = poly([nearR, farR, P(farR.x, farR.y + depth * 0.7), P(nearR.x, nearR.y + depth)]);

  a.add(medallion());
  a.add('<g transform="translate(200 212) rotate(-9) scale(0.84) translate(-200 -221)">');

  // Case thickness
  a.path(front, 'd', 1.2);
  a.add(fillHatch({ shape: front, box: { x: 26, y: 290, w: 350, h: 18 }, angle: 0, spacing: 1.6, width: 0.5 }));
  a.path(side, 'd', 1.1);
  a.add(fillHatch({ shape: side, box: { x: 348, y: 148, w: 28, h: 160 }, angle: 80, spacing: 1.5, width: 0.45 }));

  // Soundboard
  a.fillin(top);
  a.path(top, 'd', 1.6);
  a.add(shade({ shape: top, box: { x: 26, y: 146, w: 350, h: 150 }, angle: 20, spacing: 2.8, width: 0.4, light: P(-40, -30) }));
  // Inlaid border
  const inset = (p, q, t) => lerpP(p, q, t);
  const bL = inset(nearL, farR, 0.025);
  const bR = inset(nearR, farL, 0.02);
  const bFR = inset(farR, nearL, 0.03);
  const bFL = inset(farL, nearR, 0.03);
  a.path(poly([bL, bR, bFR, bFL]), 'd', 0.6);
  a.path(dots([bL, bR, bFR, bFL, bL], 5, 0.6), 'h', 0.45);

  // Fish-skin panels under the bridge (right edge), five windows
  const skinNear = lerpP(nearR, nearL, 0.2);
  const skinFar = lerpP(farR, farL, 0.32);
  const panels = [];
  for (let i = 0; i < 5; i++) {
    const t0 = 0.05 + i * 0.19;
    const t1 = t0 + 0.17;
    const p1 = lerpP(lerpP(nearR, farR, t0), lerpP(skinNear, skinFar, t0), 0.08);
    const p2 = lerpP(lerpP(nearR, farR, t1), lerpP(skinNear, skinFar, t1), 0.08);
    const p3 = lerpP(skinNear, skinFar, t1);
    const p4 = lerpP(skinNear, skinFar, t0);
    panels.push(poly([p1, p2, p3, p4]));
  }
  a.path(panels.join(''), 'd skin', 0.9);
  // Skin texture: sparse stipple
  let stip = '';
  panels.forEach((_, i) => {
    for (let k = 0; k < 26; k++) {
      const t = 0.05 + i * 0.19 + ((k * 0.618) % 1) * 0.17;
      const u = 0.12 + ((k * 0.381) % 1) * 0.78;
      const p = lerpP(lerpP(nearR, farR, t), lerpP(skinNear, skinFar, t), u);
      stip += circle(p.x, p.y, 0.45);
    }
  });
  a.path(stip, 'h', 0.5);

  // Bridge on the skins with five feet
  const brN = lerpP(lerpP(nearR, skinNear, 0.55), nearR, 0);
  const brF = lerpP(farR, skinFar, 0.55);
  const brN2 = P(brN.x - 5, brN.y);
  const brF2 = P(brF.x - 5, brF.y);
  const bridge = poly([lerpP(brN, brF, -0.01), lerpP(brF, brN, -0.01), lerpP(brF2, brN2, -0.01), lerpP(brN2, brF2, -0.01)]);
  a.path(bridge, 'd', 1);
  a.add(fillHatch({ shape: bridge, box: { x: 300, y: 140, w: 60, h: 170 }, angle: 80, spacing: 1.2, width: 0.45 }));

  // Rosettes on the wooden board
  a.add(rosette(200, 214, 16, 8, { width: 0.8 }));
  a.add(rosette(120, 252, 10, 6, { width: 0.6, petals: false }));
  a.add(rosette(258, 182, 10, 6, { width: 0.6, petals: false }));

  // Pegbox strip along the slanted edge, pegs and mandals
  const pbN = lerpP(nearL, nearR, 0.075);
  const pbF = lerpP(farL, farR, 0.12);
  a.path(line(pbN, pbF), 'd', 0.9);
  const strip = poly([nearL, pbN, pbF, farL]);
  a.add(fillHatch({ shape: strip, box: { x: 26, y: 148, w: 160, h: 148 }, angle: 60, spacing: 1.8, width: 0.42 }));
  let pegs = '';
  let mandals = '';
  const courses = 26;
  const strings = [];
  for (let i = 0; i < courses; i++) {
    const t = (i + 0.5) / courses;
    const leftEdge = lerpP(farL, nearL, t);
    const pegP = lerpP(leftEdge, lerpP(pbF, pbN, t), 0.45);
    pegs += circle(pegP.x, pegP.y, 1.6);
    const mStart = lerpP(pbF, pbN, t);
    for (let m = 0; m < 4; m++) {
      const mp = P(mStart.x + 4 + m * 4.2, mStart.y);
      mandals += line(P(mp.x, mp.y - 1.3), P(mp.x, mp.y + 1.3));
    }
    const right = lerpP(brF, brN, t);
    const lane = [];
    for (let s = -1; s <= 1; s++) {
      const dy = s * 1.05;
      lane.push(`M${f(right.x - 2)} ${f(right.y + dy)}L${f(pegP.x)} ${f(pegP.y + dy * 0.6)}`);
    }
    strings.push(lane.join(''));
  }
  a.path(pegs, 'd', 0.6);
  a.path(mandals, 'h', 0.6);
  // Strings in groups so neighbouring courses shimmer together
  for (let g = 0; g < courses; g += 2) a.path(strings.slice(g, g + 2).join(''), 'str', 0.32);
  // Strings continue over the bridge to the right-hand fixing
  let tails = '';
  for (let i = 0; i < courses; i++) {
    const t = (i + 0.5) / courses;
    const r1 = lerpP(brF, brN, t);
    const r2 = lerpP(farR, nearR, t);
    tails += line(P(r1.x + 3, r1.y), P(r2.x - 2, r2.y));
  }
  a.path(tails, 'h', 0.35);

  // Finger picks (mızrap rings) resting on the board
  a.path(`M84 268c4-6 14-6 16 0s-8 10-14 6M100 262l10-6`, 'd', 0.8);

  a.add('</g>');
  return a.done('Канун');
}
