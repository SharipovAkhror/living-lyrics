import { Art, P, ellipse, f, gid, medallion, rect, rot, shade, smooth } from '../lib.mjs';

// Voice: a classic mid-century vocal microphone. Composite, not a named model, no lettering.
// An elongated capsule with a horizontal grille — the usual sign for singing — sits in a
// yoke with a screw on each side, on a short stem and a round foot.
// The capsule is tipped slightly forward (wider crown, and a small lean in the yoke).
// Proportions are chosen so the silhouette reads on a 112 px card. Nothing is traced from a product.
const CX = 200;
const PIVOT = P(200, 208);
const TILT = -7;

const turn = (p) => rot(p, PIVOT, TILT);
const turned = (pts) => pts.map(turn);
const ink = (pts, close = true) => smooth(turned(pts), close, 0.42);

/** Upright capsule, then leaned in the yoke. Top is a little wider: the head comes toward the viewer. */
function capsulePoints(top, bot, rxTop, rxBot) {
  const cyTop = top + rxTop;
  const cyBot = bot - rxBot;
  const pts = [];
  const arc = (cy, rx, t0, t1, n) => {
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      pts.push(P(CX + rx * Math.cos(t), cy + rx * Math.sin(t)));
    }
  };
  arc(cyTop, rxTop, Math.PI, Math.PI * 2, 14);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const u = i / (steps + 1);
    const y = cyTop + (cyBot - cyTop) * u;
    const rx = rxTop + (rxBot - rxTop) * u;
    pts.push(P(CX + rx, y));
  }
  arc(cyBot, rxBot, 0, Math.PI, 14);
  for (let i = steps; i >= 1; i--) {
    const u = i / (steps + 1);
    const y = cyTop + (cyBot - cyTop) * u;
    const rx = rxTop + (rxBot - rxTop) * u;
    pts.push(P(CX - rx, y));
  }
  return pts;
}

function ellipsePoints(cx, cy, rx, ry, n = 28) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push(turn(P(cx + rx * Math.cos(t), cy + ry * Math.sin(t))));
  }
  return smooth(pts, true, 0.5);
}

function clipInk(shape, d, width) {
  const clip = gid('clip');
  return {
    defs: `<clipPath id="${clip}"><path d="${shape}"/></clipPath>`,
    svg: `<g clip-path="url(#${clip})"><path class="d" pathLength="1" d="${d}" stroke-width="${width}"/></g>`,
  };
}

export default function voice() {
  const a = new Art('voice');
  const shellPts = capsulePoints(68, 286, 48, 39);
  const bezelPts = capsulePoints(80, 274, 39, 31);
  const meshPts = capsulePoints(94, 262, 32, 25);
  const shell = ink(shellPts);
  const bezel = ink(bezelPts);
  const mesh = ink(meshPts);

  // Side of the shell at the pivot, before the lean, then the same lean the drawing uses.
  const screwL = turn(P(CX - 44, PIVOT.y));
  const screwR = turn(P(CX + 44, PIVOT.y));

  a.add(medallion());

  // Round foot and short stem stay still. The capsule rocks in the yoke above them.
  const footTop = ellipse(CX, 338, 66, 14);
  const foot = `M${CX - 66} 338A66 14 0 0 0 ${CX + 66} 338L${CX + 56} 356A56 11 0 0 1 ${CX - 56} 356Z`;
  const stem = rect(CX - 6, 308, 12, 34, 3);
  const collar = rect(CX - 15, 298, 30, 13, 4);
  a.begin();
  a.fillin(foot);
  a.path(foot, 'd', 1.4);
  a.path(footTop, 'd', 1.25);
  a.add(shade({ shape: foot, box: { x: CX - 72, y: 322, w: 144, h: 40 }, angle: 8, spacing: 2.3, width: 0.42, light: P(-10, -8) }));
  a.fillin(stem);
  a.path(stem, 'd', 1.25);
  a.add(shade({ shape: stem, box: { x: CX - 8, y: 298, w: 20, h: 42 }, angle: 90, spacing: 1.7, width: 0.4, light: P(-8, 0) }));
  a.hidden(footTop);

  // Yoke: a fork, open at the top. It holds the capsule at the screws and does not ring the body.
  const yoke = smooth(
    [
      screwL,
      P(screwL.x - 18, screwL.y + 16),
      P(CX - 70, 258),
      P(CX - 44, 300),
      P(CX, 316),
      P(CX + 44, 300),
      P(CX + 70, 254),
      P(screwR.x + 18, screwR.y + 16),
      screwR,
    ],
    false,
    0.46,
  );
  const yokeIn = smooth(
    [
      P(screwL.x + 2, screwL.y + 2),
      P(screwL.x - 8, screwL.y + 22),
      P(CX - 54, 260),
      P(CX - 32, 294),
      P(CX, 304),
      P(CX + 32, 294),
      P(CX + 54, 256),
      P(screwR.x + 8, screwR.y + 22),
      P(screwR.x - 2, screwR.y + 2),
    ],
    false,
    0.46,
  );
  a.begin();
  a.path(yoke, 'd', 1.55);
  a.path(yokeIn, 'd', 0.85);
  a.fillin(collar);
  a.path(collar, 'd', 1.15);
  a.hidden(shell);

  // Rest lean is drawn into the paths. Breath adds a small sway about the screws; at rest the variable is 0.
  a.add(
    `<g style="transform-box:view-box;transform-origin:${PIVOT.x / 4}% ${PIVOT.y / 4}%;transform:rotate(calc(var(--breath-o, 0) * 1.2deg))">`,
  );

  a.fillin(shell);
  a.add(shade({ shape: shell, box: { x: 110, y: 52, w: 180, h: 250 }, angle: 84, spacing: 2.4, width: 0.4, light: P(-20, -12) }));
  a.path(shell, 'd', 1.7);
  a.path(bezel, 'd', 0.85);

  // Grille: a few strong horizontal ribs, not a fine mesh that turns grey at card size.
  let ribs = '';
  for (let y = 118; y <= 248; y += 11.5) {
    const p = turn(P(CX - 56, y));
    const q = turn(P(CX + 56, y));
    ribs += `M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}`;
  }
  a.add(clipInk(mesh, ribs, 1.15));
  a.path(mesh, 'd', 0.7);
  // Crown and lower lip: the rounded ends of the capsule, seen because the head tips forward.
  a.path(ellipsePoints(CX, 112, 36, 12), 'd', 1.05);
  a.path(ellipsePoints(CX, 250, 26, 9), 'd', 0.8);

  const slot = (c) => {
    const p = turn(P(c.x - 4.2, c.y));
    const q = turn(P(c.x + 4.2, c.y));
    return `M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}`;
  };
  const screw = (c) => ellipse(c.x, c.y, 6.4, 6.4) + ellipse(c.x, c.y, 3.3, 3.3) + slot(c);
  a.path(screw(screwL), 'd', 1.2);
  a.path(screw(screwR), 'd', 1.2);

  a.add('</g>');
  return a.done('Голос');
}
