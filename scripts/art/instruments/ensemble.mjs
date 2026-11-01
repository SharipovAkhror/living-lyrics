import { Art, P, line, poly } from '../lib.mjs';

// Unknown roster. Empty lecterns on a shallow stage — not a named set of instruments.
// The old plate was an oud, a frame drum and a ney drawn as one badge.
export default function ensemble() {
  const a = new Art('ensemble');
  const stand = (x, y, lean) => {
    const top = P(x + lean, y);
    const lipL = P(x - 46 + lean * 0.2, y + 8);
    const lipR = P(x + 46 + lean * 0.2, y + 8);
    const foot = P(x, y + 118);
    const desk = poly([lipL, lipR, P(x + 40, y + 22), P(x - 40, y + 22)]);
    a.path(desk, 'd', 1.35);
    a.path(line(P(x, y + 22), foot), 'd', 1.5);
    a.path(line(P(x - 28, y + 118), P(x + 28, y + 118)), 'd', 1.5);
    a.path(line(P(x - 22, y + 112), P(x - 34, y + 126)) + line(P(x + 22, y + 112), P(x + 34, y + 126)), 'd', 1.15);
    a.path(line(top, P(x, y + 8)), 'h', 0.7);
    a.path(line(P(x - 18, y + 14), P(x + 18, y + 16)), 'h', 0.55);
  };
  a.path('M48 292Q200 312 352 292', 'd', 1.15);
  a.path('M72 300Q200 316 328 300', 'h', 0.55);
  stand(118, 118, -8);
  stand(200, 96, 0);
  stand(282, 118, 8);
  return a.done('Ансамбль');
}
