import { Art, P, smooth, shade, medallion, fillHatch, f, rot } from '../lib.mjs';

// Solo voice: one adult singer, three-quarter view, not a portrait of anyone.
// Academic eight-head canon: eyes on the midline of the head, nose base halfway from
// the eyes to the chin, mouth a third of the way from the nose to the chin, shoulders
// about two head-widths, hand about as long as the face. The nose projects only a
// little past the lip plane, so the view stays three-quarter rather than a profile.
// A calm open palm rests on the upper chest. Plain robe, no costume, no likeness.
//
// Motion follows playback time. The stage writes --breath-o from the vocal drive and
// a sine of the second. The whole figure lifts on that value, the chest (hand and
// folds) a little more, and the mouth opening scales from the upper lip. No keyframe
// animation and no blink. At breath 0 the mouth is already open.

const BREATH = 'var(--breath-o, 0)';

// Positive local x points toward the nose. turn = -1 sends the nose left.
function place(cx, cy, H, turn) {
  return (x, y) => P(cx + turn * x * H, cy + y * H);
}

function almond(x, y, w, h, tilt = 0) {
  const c = P(x, y);
  const l = rot(P(x - w / 2, y), c, tilt);
  const r = rot(P(x + w / 2, y), c, tilt);
  const up = rot(P(x, y - h), c, tilt);
  const lo = rot(P(x, y + h * 0.4), c, tilt);
  return `M${f(l.x)} ${f(l.y)}Q${f(up.x)} ${f(up.y)} ${f(r.x)} ${f(r.y)}Q${f(lo.x)} ${f(lo.y)} ${f(l.x)} ${f(l.y)}Z`;
}

function breathDots(origin, dir) {
  let d = '';
  for (let i = 0; i < 4; i++) {
    const x = origin.x + dir * (16 + i * 8);
    const y = origin.y - 6 - i * 5;
    d += `<circle class="breath breath-dot" cx="${f(x)}" cy="${f(y)}" r="${f(1.45 - i * 0.22)}" fill="currentColor" stroke="none"/>`;
  }
  return d;
}

function boxOf(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Closed skull. Positive local x is the nose; turn -1 faces left. */
export function headOutline(cx, cy, H, turn = -1) {
  const q = place(cx, cy, H, turn);
  // Nose projection is modest (tip at 0.30): both eyes stay on the cheek.
  return smooth([
    q(0.14, -0.4),
    q(0.2, -0.24),
    q(0.22, -0.1),
    q(0.24, 0.04),
    q(0.28, 0.12),
    q(0.3, 0.17),
    q(0.27, 0.21),
    q(0.2, 0.25),
    q(0.16, 0.34),
    q(0.1, 0.44),
    q(0.02, 0.5),
    q(-0.12, 0.46),
    q(-0.26, 0.34),
    q(-0.36, 0.18),
    q(-0.4, 0.02),
    q(-0.42, -0.16),
    q(-0.34, -0.34),
    q(-0.16, -0.46),
    q(0.0, -0.5),
    q(0.1, -0.46),
    q(0.14, -0.4),
  ], true, 0.28);
}

/**
 * Head, hair and face. cy is the eye line. Returns the closed silhouette.
 * hair 'shoulder' adds a mass behind the neck; the skull itself stays short.
 */
export function drawHead(a, opt) {
  const { cx, cy, H, turn = -1, hair = 'short', detail = H >= 84, breath = false, hatch = 1, hairHatch = true } = opt;
  const q = place(cx, cy, H, turn);
  const silhouette = headOutline(cx, cy, H, turn);

  if (hair === 'shoulder') {
    const mass = smooth([
      q(-0.34, 0.02), q(-0.46, 0.16), q(-0.5, 0.4), q(-0.46, 0.78),
      q(-0.28, 0.84), q(-0.22, 0.5), q(-0.3, 0.16),
    ], true, 0.35);
    a.fillin(mass);
    a.path(mass, 'd', 1.05);
    if (hatch > 0 && hairHatch) {
      a.add(fillHatch({ shape: mass, box: boxOf([q(-0.6, -0.1), q(-0.1, 0.9)]), angle: 74, spacing: 2.3 * hatch, width: 0.4 }));
    }
  }

  const hairline = smooth([
    q(0.14, -0.38), q(0.02, -0.34), q(-0.14, -0.32), q(-0.28, -0.24), q(-0.36, -0.08), q(-0.38, 0.02),
  ], false, 0.4);
  const hairShape = smooth([
    q(0.14, -0.38), q(0.02, -0.33), q(-0.16, -0.3), q(-0.32, -0.14), q(-0.38, 0.02),
    q(-0.42, -0.16), q(-0.32, -0.36), q(-0.12, -0.48), q(0.04, -0.5), q(0.14, -0.42), q(0.14, -0.38),
  ], true, 0.3);
  a.fillin(hairShape);
  if (hatch > 0 && hairHatch) {
    a.add(fillHatch({ shape: hairShape, box: boxOf([q(-0.5, -0.55), q(0.2, 0.08)]), angle: 72, spacing: 2.5 * hatch, width: 0.4 }));
  }
  const strands = [0.2, 0.45, 0.7].map((t) => smooth([
    q(-0.02 + t * 0.1, -0.36),
    q(-0.18 - t * 0.08, -0.16),
    q(-0.3 - t * 0.06, -0.02),
  ], false, 0.45)).join('');
  a.path(strands, 'h', 0.55);
  a.path(hairline, 'd', 0.75);
  a.path(silhouette, 'd', 1.45);

  const earC = q(-0.37, 0.1);
  const ew = 0.065 * H;
  const eh = 0.125 * H;
  const ear = smooth([
    P(earC.x - turn * ew * 0.15, earC.y - eh),
    P(earC.x + turn * ew, earC.y - eh * 0.25),
    P(earC.x + turn * ew * 0.85, earC.y + eh * 0.45),
    P(earC.x + turn * ew * 0.1, earC.y + eh),
    P(earC.x - turn * ew * 0.45, earC.y + eh * 0.35),
    P(earC.x - turn * ew * 0.15, earC.y - eh * 0.2),
  ], true, 0.35);
  a.path(ear, 'd', 0.85);
  if (detail) {
    a.path(smooth([
      P(earC.x, earC.y - eh * 0.25),
      P(earC.x + turn * ew * 0.4, earC.y + eh * 0.05),
      P(earC.x, earC.y + eh * 0.4),
    ], false, 0.45), 'h', 0.55);
  }

  const near = { x: cx + turn * 0.07 * H, y: cy, w: 0.145 * H, h: 0.055 * H, tilt: turn * -6 };
  const far = { x: cx - turn * 0.1 * H, y: cy - 0.004 * H, w: 0.1 * H, h: 0.044 * H, tilt: turn * -4 };
  const nearEye = almond(near.x, near.y, near.w, near.h, near.tilt);
  const farEye = almond(far.x, far.y, far.w, far.h, far.tilt);
  if (hatch > 0) {
    a.add(shade({
      shape: silhouette,
      box: boxOf([q(-0.5, -0.55), q(0.4, 0.55)]),
      angle: 64,
      spacing: 3.4 * hatch,
      width: 0.34,
      light: P(-16, -12),
      extraMask: `<path d="${nearEye}${farEye}" fill="#000"/>`,
    }));
  }

  a.path(smooth([q(0.0, -0.1), q(0.08, -0.128), q(0.16, -0.095)], false, 0.45), 'd', 1.15);
  a.path(smooth([q(-0.16, -0.09), q(-0.08, -0.112), q(-0.01, -0.088)], false, 0.45), 'd', 1.0);

  drawEye(a, near, detail);
  drawEye(a, far, detail);

  // Nostril under the tip. The bridge is already the silhouette.
  a.path(smooth([q(0.28, 0.19), q(0.22, 0.245), q(0.15, 0.24)], false, 0.4), 'd', 0.9);

  const mouthTop = cy + 0.325 * H;
  const mouthX = cx + turn * 0.06 * H;
  const mouthW = 0.18 * H;
  a.path(smooth([
    q(-0.02, 0.33), q(0.05, 0.305), q(0.11, 0.312), q(0.16, 0.335),
  ], false, 0.4), 'd', 1.05);
  const openH = 0.062 * H;
  const open = `M${f(mouthX - turn * mouthW * 0.4)} ${f(mouthTop)}Q${f(mouthX + turn * mouthW * 0.02)} ${f(mouthTop + openH)} ${f(mouthX + turn * mouthW * 0.42)} ${f(mouthTop + 0.006 * H)}Q${f(mouthX)} ${f(mouthTop + openH * 0.35)} ${f(mouthX - turn * mouthW * 0.4)} ${f(mouthTop)}Z`;
  const lower = smooth([
    q(-0.02, 0.345), q(0.06, 0.4), q(0.12, 0.385), q(0.16, 0.34),
  ], false, 0.4);
  a.add(`<g style="transform-box:fill-box;transform-origin:50% 0%;transform:scale(1, calc(1 + ${BREATH} * 0.4))">`);
  a.add(`<path class="h" d="${open}" fill="currentColor" stroke="none"/>`);
  a.path(lower, 'd', 1.05);
  a.add('</g>');

  if (breath) a.add(breathDots(P(mouthX + turn * mouthW * 0.55, mouthTop + 0.01 * H), turn));
  return { shape: silhouette };
}

function drawEye(a, e, detail) {
  a.path(almond(e.x, e.y, e.w, e.h, e.tilt), 'd', 1.15);
  const irisC = rot(P(e.x - e.w * 0.02, e.y + e.h * 0.12), P(e.x, e.y), e.tilt);
  const irisR = e.h * 0.62;
  a.path(
    `M${f(irisC.x - irisR)} ${f(irisC.y)}A${f(irisR)} ${f(irisR)} 0 1 0 ${f(irisC.x + irisR)} ${f(irisC.y)}A${f(irisR)} ${f(irisR)} 0 1 0 ${f(irisC.x - irisR)} ${f(irisC.y)}`,
    'd',
    0.75,
  );
  const pupil = rot(P(e.x - e.w * 0.06, e.y + e.h * 0.02), P(e.x, e.y), e.tilt);
  a.add(`<circle class="h" cx="${f(pupil.x)}" cy="${f(pupil.y)}" r="${f(Math.max(1.2, e.w * 0.085))}" fill="currentColor" stroke="none"/>`);
  if (detail) {
    const c = P(e.x, e.y);
    const p0 = rot(P(e.x - e.w * 0.28, e.y - e.h * 0.55), c, e.tilt);
    const p1 = rot(P(e.x, e.y - e.h * 1.05), c, e.tilt);
    const p2 = rot(P(e.x + e.w * 0.28, e.y - e.h * 0.55), c, e.tilt);
    a.path(`M${f(p0.x)} ${f(p0.y)}Q${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)}`, 'h', 0.5);
  }
}

function quadPoint(a, b, c, t) {
  const u = 1 - t;
  return P(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y);
}

/** Closed sleeve along a quadratic centre line. Polygon, not a spline, so the bend cannot grow claws. */
function sleeveTube(a, b, c, half, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(quadPoint(a, b, c, i / n));
  const left = [];
  const right = [];
  for (let i = 0; i <= n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n, i + 1)];
    let dx = p1.x - p0.x;
    let dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    left.push(P(pts[i].x - dy * half, pts[i].y + dx * half));
    right.push(P(pts[i].x + dy * half, pts[i].y - dx * half));
  }
  const ring = [...left, ...right.reverse()];
  return ring.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
}

function arcPoints(cx, cy, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    pts.push(P(cx + r * Math.cos(t), cy + r * Math.sin(t)));
  }
  return pts;
}

// Thumb lobe, then four fingers. Tips are sampled arcs, so the outline stays round at low tension.
function handPoints() {
  // Tips stay near the collar; webs are shallow so the palm reads as one shape.
  const fingers = [
    { x: 168, cy: 212, r: 8 },
    { x: 188, cy: 204, r: 8.6 },
    { x: 208, cy: 210, r: 8 },
    { x: 226, cy: 216, r: 7 },
  ];
  const side = 14;
  const pts = [P(186, 286), P(170, 276), P(158, 262)];
  pts.push(...arcPoints(152, 244, 15, 0.55 * Math.PI, 1.32 * Math.PI, 8));
  pts.push(P(164, 230));
  fingers.forEach((finger, i) => {
    const yb = finger.cy + side;
    pts.push(P(finger.x - finger.r, yb));
    pts.push(P(finger.x - finger.r, finger.cy));
    pts.push(...arcPoints(finger.x, finger.cy, finger.r, Math.PI, Math.PI * 2, 6));
    pts.push(P(finger.x + finger.r, yb));
    const next = fingers[i + 1];
    if (next) pts.push(P((finger.x + next.x) / 2, Math.max(yb, next.cy + side) + 8));
  });
  const last = fingers[fingers.length - 1];
  pts.push(P(last.x + last.r + 2, 248), P(230, 266), P(216, 282), P(198, 288));
  return pts;
}

const HAND = handPoints();

export function handCover() {
  return smooth(HAND, true, 0.2);
}

export function drawHand(a) {
  const palm = handCover();
  a.fillin(palm);
  a.path(palm, 'd', 1.2);
  a.add(shade({ shape: palm, box: boxOf(HAND), angle: 64, spacing: 3.1, width: 0.34, light: P(-10, -8) }));
  return palm;
}

export default function voice() {
  const a = new Art('voice');
  const H = 108;
  const cx = 204;
  const cy = 108;
  const turn = -1;
  a.add(medallion());

  // Lift of the whole figure. Two pixels at breath 1; the robe is one piece, so nothing tears.
  a.add(`<g style="transform:translate(0px, calc(${BREATH} * -2px))">`);

  // Robe without a stuck-on sleeve. The bent arm is drawn over the left shoulder and hides it.
  const robe = smooth([
    P(206, 176), P(176, 186), P(150, 208), P(148, 258), P(158, 316), P(176, 356),
    P(220, 364), P(266, 352), P(280, 292), P(272, 230), P(248, 196), P(224, 180), P(210, 174),
  ], true, 0.32);
  // Shoulder under the robe, elbow out to the left, wrist under the palm.
  const arm = sleeveTube(P(158, 196), P(118, 252), P(186, 258), 9.5, 24);
  const palm = handCover();
  const headShape = headOutline(cx, cy, H, turn);

  // Neck runs under the jaw and under the robe; the mask leaves only the column between them.
  const neck = smooth([
    P(192, 140), P(186, 168), P(188, 198), P(194, 228),
    P(218, 228), P(222, 198), P(220, 168), P(212, 140),
  ], true, 0.32);
  a.begin();
  a.fillin(neck);
  a.path(neck, 'd', 1.05);
  a.add(shade({ shape: neck, box: { x: 176, y: 150, w: 56, h: 70 }, angle: 70, spacing: 2.8, width: 0.34, light: P(-8, -6) }));
  a.hidden([headShape, robe, arm, palm]);

  a.begin();
  a.fillin(robe);
  a.path(robe, 'd', 1.5);
  a.add(shade({ shape: robe, box: { x: 130, y: 170, w: 160, h: 200 }, angle: 60, spacing: 2.6, width: 0.38, light: P(-16, -12) }));
  a.path(smooth([P(196, 186), P(208, 196), P(220, 184)], false, 0.4), 'd', 0.9);
  a.path(smooth([P(206, 190), P(200, 250), P(206, 324)], false, 0.35), 'd', 0.8);
  a.path(smooth([P(220, 230), P(230, 286), P(232, 330)], false, 0.35), 'h', 0.6);
  a.hidden([arm, palm]);

  a.begin();
  a.fillin(arm);
  a.path(arm, 'd', 1.25);
  a.add(shade({ shape: arm, box: { x: 120, y: 190, w: 90, h: 100 }, angle: 70, spacing: 2.8, width: 0.36, light: P(-8, -6) }));
  a.hidden(palm);

  a.add(`<g style="transform:translate(0px, calc(${BREATH} * -1.5px))">`);
  drawHand(a);
  a.add('</g>');

  drawHead(a, { cx, cy, H, turn, hair: 'short', detail: true, breath: true });
  a.add('</g>');
  return a.done('Голос');
}
