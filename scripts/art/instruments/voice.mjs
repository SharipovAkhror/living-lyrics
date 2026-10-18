import { Art, P, medallion } from '../lib.mjs';
import { birdCovers, drawBird, drawBranch, drawBud, drawLeaf, drawRose, drawSong, drawThorn, swayStyle } from '../birds.mjs';

// Solo voice: a nightingale on a rose cane. In Persian and Turkic poetry the
// nightingale sings to the rose (gul-o-bulbul); the plate is that sign of song,
// not a portrait. No person is drawn.
//
// The cane pivots a fraction of a degree from its root on --breath-o. The bird
// swells at the breast and opens the lower mandible a little more on the same
// sample. At rest the bill is already open and the sound lines are already there.

const ROOT = P(348, 328);
const BIRD = { x: 232, y: 232, s: 1.28, face: -1, kind: 'nightingale', phase: 'o' };

const CANE = [
  P(124, 236),
  P(176, 244),
  P(224, 246),
  P(272, 274),
  P(314, 304),
  ROOT,
];

export default function voice() {
  const a = new Art('voice');
  a.add(medallion());
  a.add(`<g style="${swayStyle(ROOT, 'o', 0.65)}">`);
  a.begin();
  drawBranch(a, CANE, [3.6, 5.2, 6.8, 8.2, 10, 11.5]);
  drawBranch(a, [P(150, 250), P(112, 200), P(88, 152)], [2.4, 1.8, 1.3]);
  drawThorn(a, P(272, 274), P(7, -6));
  drawThorn(a, P(176, 250), P(-5, -7));
  drawLeaf(a, 58, 124, 26, 200);
  drawLeaf(a, 168, 258, 30, 120);
  drawLeaf(a, 292, 292, 32, 150);
  drawLeaf(a, 330, 316, 24, 40);
  a.hidden(birdCovers(BIRD));
  drawRose(a, 84, 108, 0.84, -8);
  drawBud(a, 52, 162, 0.55, -18);
  const { beak } = drawBird(a, BIRD);
  drawSong(a, beak, -1);
  a.add('</g>');
  return a.done('Голос');
}
