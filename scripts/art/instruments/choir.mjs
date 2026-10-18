import { Art, P, smooth, shade, medallion, f, rot } from '../lib.mjs';
import { drawHead, headOutline } from './voice.mjs';

// Choir: five adult singers in two rows, not a book. Faces are the solo head,
// smaller. Nobody is a portrait. Hair length varies; clothes stay plain robes.
// The plate lifts together on --breath-o (one phase: the stage has a single
// variable). Mouths already open at rest and scale from the upper lip. Air dots
// sit only outside the outer mouths, so they do not land on a neighbour.

const BREATH = 'var(--breath-o, 0)';

function bust(cx, top, hem, shoulder, hip) {
  return smooth([
    P(cx - shoulder * 0.28, top),
    P(cx - shoulder, top + shoulder * 0.62),
    P(cx - hip, hem),
    P(cx - hip * 0.2, hem + 5),
    P(cx + hip * 0.35, hem + 2),
    P(cx + hip, hem - 8),
    P(cx + shoulder * 0.92, top + shoulder * 0.5),
    P(cx + shoulder * 0.22, top + 2),
  ], true, 0.28);
}

function bodyOf(p) {
  const top = p.cy + 0.42 * p.H;
  return bust(p.cx, top, p.hem, 0.5 * p.H, 0.62 * p.H);
}

function neckOf(p) {
  const top = p.cy + 0.22 * p.H;
  const bot = p.cy + 0.62 * p.H;
  const w = 0.12 * p.H;
  return smooth([
    P(p.cx - w, top),
    P(p.cx - w * 0.82, bot),
    P(p.cx + w * 0.82, bot),
    P(p.cx + w, top),
  ], true, 0.3);
}

function drawPerson(a, p) {
  const body = bodyOf(p);
  const neck = neckOf(p);
  const head = headOutline(p.cx, p.cy, p.H, p.turn);
  a.begin();
  a.fillin(neck);
  a.path(neck, 'd', 0.85);
  a.hidden([head, body]);
  a.fillin(body);
  a.path(body, 'd', p.front ? 1.35 : 1.15);
  if (p.front) {
    const top = p.cy + 0.42 * p.H;
    a.add(shade({
      shape: body,
      box: { x: p.cx - 0.7 * p.H, y: top, w: 1.4 * p.H, h: p.hem - top },
      angle: 64,
      spacing: 6.2,
      width: 0.38,
      light: P(-14, -10),
    }));
    a.path(smooth([
      P(p.cx - 0.06 * p.H, top + 6),
      P(p.cx - 0.02 * p.H, (top + p.hem) / 2),
      P(p.cx + 0.02 * p.H, p.hem - 18),
    ], false, 0.35), 'h', 0.5);
  }
  drawHead(a, {
    cx: p.cx,
    cy: p.cy,
    H: p.H,
    turn: p.turn,
    hair: p.hair,
    detail: p.H >= 76,
    breath: !!p.breath,
    hatch: p.front ? 1.45 : 0,
  });
}

function folder(x, y, tilt) {
  const w = 44;
  const h = 56;
  const c = P(x, y);
  const corners = [P(0, 0), P(w, 1), P(w - 2, h), P(-3, h - 1)].map((p) => rot(P(x + p.x, y + p.y), c, tilt));
  const d = corners.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + 'Z';
  let staff = '';
  for (let i = 0; i < 5; i++) {
    const y0 = 14 + i * 4.2;
    const a = rot(P(x + 6, y + y0), c, tilt);
    const b = rot(P(x + w - 7, y + y0), c, tilt);
    staff += `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
  }
  let notes = '';
  const marks = [P(16, 28), P(24, 22), P(32, 30)];
  for (const m of marks) {
    const q = rot(P(x + m.x, y + m.y), c, tilt);
    notes += `<ellipse class="h" cx="${f(q.x)}" cy="${f(q.y)}" rx="2.3" ry="1.6" fill="currentColor" stroke="none" transform="rotate(${f(tilt)} ${f(q.x)} ${f(q.y)})"/>`;
  }
  const thumb = smooth([
    P(x + 2, y + 24), P(x - 7, y + 30), P(x - 6, y + 40), P(x + 3, y + 38), P(x + 5, y + 28),
  ].map((p) => rot(p, c, tilt)), true, 0.28);
  return { d, staff, notes, thumb };
}

const BACK = [
  { cx: 152, cy: 108, H: 58, turn: -1, hair: 'short', hem: 250, front: false },
  { cx: 250, cy: 104, H: 60, turn: -1, hair: 'shoulder', hem: 246, front: false },
];

const FRONT = [
  { cx: 108, cy: 168, H: 74, turn: -1, hair: 'short', hem: 338, front: true, breath: true },
  { cx: 200, cy: 180, H: 80, turn: -1, hair: 'shoulder', hem: 352, front: true, breath: false },
  { cx: 292, cy: 166, H: 74, turn: 1, hair: 'short', hem: 336, front: true, breath: true },
];

export default function choir() {
  const a = new Art('choir');
  a.add(medallion());
  a.add(`<g style="transform:translate(0px, calc(${BREATH} * -1.6px))">`);

  const frontCover = FRONT.flatMap((p) => [headOutline(p.cx, p.cy, p.H, p.turn), bodyOf(p)]);
  a.begin();
  for (const p of BACK) drawPerson(a, p);
  a.hidden(frontCover);

  const center = FRONT[1];
  a.begin();
  drawPerson(a, FRONT[0]);
  drawPerson(a, FRONT[2]);
  a.hidden([headOutline(center.cx, center.cy, center.H, center.turn), bodyOf(center)]);
  drawPerson(a, center);

  a.add(`<g style="transform:translate(0px, calc(${BREATH} * -1.2px))">`);
  for (const spec of [
    { x: 78, y: 228, tilt: 8 },
    { x: 268, y: 224, tilt: -10 },
  ]) {
    const book = folder(spec.x, spec.y, spec.tilt);
    a.fillin(book.d);
    a.path(book.d, 'd', 1.15);
    a.path(book.staff, 'h', 0.45);
    a.add(book.notes);
    a.fillin(book.thumb);
    a.path(book.thumb, 'd', 0.9);
  }
  a.add('</g>');

  a.add('</g>');
  return a.done('Хор');
}
