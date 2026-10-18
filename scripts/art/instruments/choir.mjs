import { Art, P, medallion } from '../lib.mjs';
import { birdCovers, drawBird, drawBranch, drawLeaf, swayStyle } from '../birds.mjs';

// Choir: five birds on two canes, all facing one way, bills already open.
// The image is Attar's Conference of the Birds: a flock singing together, the
// hoopoe out in front. Species are silhouette cues (crest, hook, round breast,
// short cone, long nightingale tail), not a copy of a manuscript list.
// No person is drawn.
//
// Each bird swells and opens its bill on its own sample of the same sine
// (--breath-o, --breath-p, --breath-q, a third of a turn apart). Each cane
// sways a fraction of a degree from its own root, on a different sample.

const UPPER_ROOT = P(356, 176);
const LOWER_ROOT = P(362, 308);

const UPPER = [P(46, 156), P(110, 140), P(176, 136), P(250, 146), P(314, 158), UPPER_ROOT];
const LOWER = [P(40, 286), P(110, 262), P(186, 252), P(260, 262), P(320, 284), LOWER_ROOT];

const UPPER_BIRDS = [
  { x: 150, y: 128, s: 0.74, face: -1, kind: 'hoopoe', phase: 'o' },
  { x: 286, y: 148, s: 0.7, face: -1, kind: 'nightingale', phase: 'p' },
];
const LOWER_BIRDS = [
  { x: 112, y: 252, s: 0.72, face: -1, kind: 'parrot', phase: 'q' },
  { x: 204, y: 244, s: 0.76, face: -1, kind: 'dove', phase: 'p' },
  { x: 298, y: 270, s: 0.58, face: -1, kind: 'finch', phase: 'o' },
];

export default function choir() {
  const a = new Art('choir');
  a.add(medallion());

  a.add(`<g style="${swayStyle(UPPER_ROOT, 'o', 0.55)}">`);
  a.begin();
  drawBranch(a, UPPER, [3, 4, 4.6, 5, 5.6, 6.4]);
  drawLeaf(a, 86, 148, 24, -55);
  drawLeaf(a, 214, 142, 20, -125);
  a.hidden(UPPER_BIRDS.flatMap(birdCovers));
  for (const bird of UPPER_BIRDS) drawBird(a, bird);
  a.add('</g>');

  a.add(`<g style="${swayStyle(LOWER_ROOT, 'p', 0.6)}">`);
  a.begin();
  drawBranch(a, LOWER, [3.2, 4.6, 5.4, 6, 6.4, 7.2]);
  drawLeaf(a, 78, 274, 26, 55);
  drawLeaf(a, 236, 260, 22, 130);
  drawLeaf(a, 332, 292, 20, 165);
  a.hidden(LOWER_BIRDS.flatMap(birdCovers));
  for (const bird of LOWER_BIRDS) drawBird(a, bird);
  a.add('</g>');

  return a.done('Хор');
}
