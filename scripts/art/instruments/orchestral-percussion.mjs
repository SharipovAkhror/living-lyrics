import { Art, P, line, ellipse, shade, fillHatch, medallion, rect, f } from '../lib.mjs';

// Sign for the group key orchestral-percussion, not a portrait of one class.
// The only clear shot (I Have Come Alive, 524 s) is a percussionist at a rank of tubular
// bells, with a suspended cymbal and a mallet. The note on that frame says tubular bells.
// No kettle is resolved, so this plate is not a timpani: the class `timpani` keeps catalogKey
// null and is not drawn with someone else's engraving. A timpani would be a familiar emblem
// and would show an instrument the shot does not.
// The frame does not count the tubes. Twelve are drawn so the rank reads as a scale,
// longest (lowest) on the left, which is the usual orchestral layout. A full set is often
// eighteen tubes of about 32–38 mm diameter; twelve is the readable extract, not a census.
// There is no membrane in the resolved frame, so there is no .skin. The plate still sways
// with the beat, like every other engraving.
export default function orchestralPercussion() {
  const a = new Art('orchperc');
  const left = 78;
  const right = 248;
  const rail = 86;
  const foot = 346;
  const n = 12;

  a.add(medallion());
  a.add('<g transform="rotate(-4 200 214)">');

  // Stand: two uprights, a top rail the tubes hang from, a lower brace.
  const upright = (x) => rect(x, rail - 8, 7, foot - rail + 8, 1.2);
  a.path(upright(left) + upright(right - 7), 'd', 1.25);
  a.add(fillHatch({ shape: upright(left), box: { x: left - 1, y: rail - 10, w: 10, h: foot - rail + 14 }, angle: 90, spacing: 1.6, width: 0.35 }));
  a.add(fillHatch({ shape: upright(right - 7), box: { x: right - 9, y: rail - 10, w: 10, h: foot - rail + 14 }, angle: 90, spacing: 1.6, width: 0.35 }));
  const railBar = rect(left - 2, rail - 6, right - left + 4, 8, 1);
  a.path(railBar, 'd', 1.15);
  a.add(fillHatch({ shape: railBar, box: { x: left - 4, y: rail - 8, w: right - left + 10, h: 12 }, angle: 0, spacing: 1.4, width: 0.35 }));
  a.path(line(P(left + 4, foot - 28), P(right - 4, foot - 28)), 'd', 0.9);
  // Feet
  a.path(line(P(left - 10, foot), P(left + 16, foot)) + line(P(right - 16, foot), P(right + 10, foot)), 'd', 1.2);

  // Tubes. Lengths fall from the bass side. Each hangs on a short cord from the rail.
  const span = right - left - 22;
  let cords = '';
  let tubes = '';
  let caps = '';
  let shine = '';
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const x = left + 14 + span * t;
    const len = 214 - t * 92;
    const top = rail + 12;
    const w = 6.4;
    cords += line(P(x, rail + 2), P(x, top));
    const body = `M${f(x - w / 2)} ${f(top + 3)}L${f(x - w / 2)} ${f(top + len)}Q${f(x)} ${f(top + len + 3.2)} ${f(x + w / 2)} ${f(top + len)}L${f(x + w / 2)} ${f(top + 3)}Z`;
    tubes += body;
    caps += ellipse(x, top + 3, w / 2, 1.7);
    shine += line(P(x - 1.5, top + 8), P(x - 1.5, top + len - 8));
  }
  a.path(cords, 'd', 0.45);
  a.fillin(tubes);
  a.path(tubes, 'd', 0.95);
  a.path(caps, 'd', 0.7);
  a.path(shine, 'h', 0.32);
  // Shadow on the right side of each tube. Clipped to the tubes, so the gaps stay clear.
  a.add(shade({
    shape: tubes,
    box: { x: left, y: rail, w: right - left, h: 250 },
    angle: 90,
    spacing: 1.8,
    width: 0.32,
    light: P(-4, -2),
  }));

  // Suspended cymbal on its own stand, to the right of the rank, as in the shot.
  // The upright reaches a foot. It does not grow out of the chime rail.
  // The foot stays inside the medallion: the far right of the circle cannot reach the chime baseline.
  const cym = P(300, 214);
  const cR = 36;
  const standX = 346;
  const standFoot = 288;
  const standTop = cym.y - cR - 16;
  a.path(line(P(standX, standFoot), P(standX, standTop)), 'd', 1.05);
  a.path(line(P(standX - 12, standFoot), P(standX + 10, standFoot)), 'd', 1.15);
  a.path(line(P(standX, standTop + 1), P(cym.x + 4, cym.y - 2)), 'd', 0.6);
  const disc = ellipse(cym.x, cym.y, cR, cR * 0.42);
  a.fillin(disc);
  a.path(disc, 'd', 1.35);
  a.path(ellipse(cym.x, cym.y, cR * 0.55, cR * 0.2), 'd', 0.55);
  a.path(ellipse(cym.x - 2, cym.y - 2, 3.2, 1.6), 'd', 0.6);
  a.add(shade({ shape: disc, box: { x: cym.x - cR - 2, y: cym.y - 22, w: cR * 2 + 4, h: 46 }, angle: 18, spacing: 2.2, width: 0.36, light: P(-16, -10) }));
  a.path(`M${f(cym.x - 4)} ${f(cym.y - 2)}Q${f(cym.x + 6)} ${f(cym.y - cR * 0.72)} ${f(standX - 1)} ${f(standTop + 3)}`, 'd', 0.55);

  // Mallet: shaft and a wrapped head, in the gap between the rank and the cymbal.
  a.path(`M268 158L286 184`, 'd', 1.15);
  a.path(ellipse(290, 188, 7, 4.4), 'd', 1.05);
  a.add(fillHatch({ shape: ellipse(290, 188, 7, 4.4), box: { x: 280, y: 180, w: 20, h: 16 }, angle: 40, spacing: 1.3, width: 0.4 }));

  a.add('</g>');
  return a.done('Оркестровая перкуссия');
}
