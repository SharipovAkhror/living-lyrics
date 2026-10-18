import { Art, P, circle, ellipse, ellipseArc, fillHatch, medallion, rect, shade, f } from '../lib.mjs';

// Voice: a mid-century studio microphone, not a named model and with no lettering.
// Round grille, short body, a shock-mount ring on four bands, a short stand.
// Proportions are a composite silhouette. Nothing here is traced from a product.
const CX = 200;
const HEAD = { x: CX, y: 128, r: 66 };
const BODY = { x: CX - 28, y: 186, w: 56, h: 108, r: 12 };

export default function voice() {
  const a = new Art('voice');
  const head = circle(HEAD.x, HEAD.y, HEAD.r);
  const mesh = circle(HEAD.x, HEAD.y, HEAD.r - 8);
  const body = rect(BODY.x, BODY.y, BODY.w, BODY.h, BODY.r);
  const meshBox = { x: HEAD.x - HEAD.r, y: HEAD.y - HEAD.r, w: HEAD.r * 2, h: HEAD.r * 2 };
  const neck = rect(CX - 18, 176, 36, 28, 6);

  a.add(medallion());

  // Stand and foot stay still. The coupler at the top of the pole is the sway pivot.
  const pole = rect(CX - 7, 286, 14, 54, 3);
  a.begin();
  a.fillin(pole);
  a.path(pole, 'd', 1.35);
  a.add(shade({ shape: pole, box: { x: CX - 8, y: 284, w: 18, h: 58 }, angle: 90, spacing: 1.6, width: 0.4, light: P(-6, 0) }));
  a.hidden(body);
  const base = `M${CX - 68} 342A68 15 0 0 0 ${CX + 68} 342L${CX + 60} 354A60 11 0 0 1 ${CX - 60} 354Z`;
  a.fillin(base);
  a.path(base, 'd', 1.35);
  a.path(ellipse(CX, 342, 68, 15), 'd', 1.15);
  a.add(shade({ shape: base, box: { x: CX - 72, y: 330, w: 144, h: 30 }, angle: 6, spacing: 2.4, width: 0.4, light: P(-12, -6) }));

  // Fixed ring. The microphone covers the part that passes behind the body.
  a.begin();
  a.path(ellipse(CX, 246, 96, 38), 'd', 1.55);
  a.path(ellipse(CX, 246, 88, 32), 'd', 0.75);
  a.hidden([head, body, neck]);

  // About 1.4° in the mount. At rest the variable is 0, so the microphone stands straight.
  a.add(`<g style="transform-box:view-box;transform-origin:${CX / 4}% ${286 / 4}%;transform:rotate(calc(var(--breath-o, 0) * 1.4deg))">`);

  a.fillin(neck);
  a.path(neck, 'd', 1.2);
  a.fillin(body);
  a.path(body, 'd', 1.55);
  a.add(shade({ shape: body, box: { x: BODY.x - 2, y: BODY.y, w: BODY.w + 4, h: BODY.h }, angle: 86, spacing: 2.2, width: 0.42, light: P(-14, -4) }));
  a.path(`M${BODY.x + 3} ${BODY.y + BODY.h - 16}H${BODY.x + BODY.w - 3}`, 'd', 0.8);

  a.fillin(head);
  a.add(fillHatch({ shape: mesh, box: meshBox, angle: 90, spacing: 5.6, width: 0.46 }));
  a.path(head, 'd', 1.65);
  a.path(mesh, 'd', 0.8);
  a.path(circle(HEAD.x, HEAD.y, HEAD.r * 0.55), 'd', 0.55);
  // The right rim turns away: one arc, so the head is a ball and not a flat disc.
  a.path(ellipseArc(HEAD.x, HEAD.y, HEAD.r - 11, HEAD.r - 11, -1.05, 1.05), 'd', 0.7);

  // Straps from the ring to the body. Two strokes each, so they read at card size.
  const straps = [
    [CX - 88, 232, BODY.x, 220],
    [CX + 88, 232, BODY.x + BODY.w, 220],
    [CX - 74, 274, BODY.x + 4, BODY.y + BODY.h - 14],
    [CX + 74, 274, BODY.x + BODY.w - 4, BODY.y + BODY.h - 14],
  ];
  let band = '';
  for (const [x0, y0, x1, y1] of straps) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * 1.6;
    const oy = (dx / len) * 1.6;
    for (const s of [-1, 1]) {
      const ax = x0 + ox * s;
      const ay = y0 + oy * s;
      const bx = x1 + ox * s;
      const by = y1 + oy * s;
      band += `M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}`;
    }
  }
  a.path(band, 'd', 0.85);

  a.add('</g>');
  return a.done('Голос');
}
