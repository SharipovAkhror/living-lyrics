import { Art, P, line, ellipse, shade, fillHatch, medallion, rot, f } from '../lib.mjs';

// Ney: a reed flute with nine segments, metal ferrules at both ends, horn mouthpiece (başpare),
// six front finger holes. Drawn upright and rotated; breath drifts from the mouthpiece.
export default function ney() {
  const a = new Art('ney');
  const cx = 200;
  const top = 30;
  const bottom = 372;
  const r = 12.5;
  const tube = `M${cx - r} ${top + 22}L${cx - r} ${bottom - 6}Q${cx} ${bottom + 2} ${cx + r} ${bottom - 6}L${cx + r} ${top + 22}Z`;
  a.add(medallion());
  a.add(`<g transform="rotate(40 200 205)">`);

  a.fillin(tube);
  a.path(tube, 'd', 1.5);
  // Cylinder shading: dense on the shadow side, a light reflection line on the lit side
  a.add(shade({ shape: tube, box: { x: cx - r - 2, y: top, w: 2 * r + 4, h: bottom - top + 10 }, angle: 90, spacing: 1.6, width: 0.5, light: P(-7, 0) }));
  a.path(line(P(cx - r + 3, top + 40), P(cx - r + 3, bottom - 30)), 'h', 0.4);

  // Nodes: nine segments, each node a slight swelling with two rings
  const nodes = 8;
  let nd = '';
  for (let i = 1; i <= nodes; i++) {
    const y = top + 22 + ((bottom - top - 28) * i) / (nodes + 1);
    nd += `M${cx - r - 0.8} ${f(y - 1.6)}Q${cx} ${f(y + 1.4)} ${cx + r + 0.8} ${f(y - 1.6)}`;
    nd += `M${cx - r - 0.8} ${f(y + 1.6)}Q${cx} ${f(y + 4.6)} ${cx + r + 0.8} ${f(y + 1.6)}`;
  }
  a.path(nd, 'd', 0.8);

  // Ferrules (parazvane) with fine knurling
  const ferrule = (y0, h) => {
    const s = `M${cx - r - 1} ${y0}L${cx + r + 1} ${y0}L${cx + r + 1} ${y0 + h}L${cx - r - 1} ${y0 + h}Z`;
    a.path(s, 'd', 0.9);
    a.add(fillHatch({ shape: s, box: { x: cx - r - 2, y: y0 - 1, w: 2 * r + 4, h: h + 2 }, angle: 60, spacing: 1.3, width: 0.4, cross: true }));
  };
  ferrule(top + 24, 9);
  ferrule(bottom - 22, 10);

  // Mouthpiece (horn), tapered
  const mp = `M${cx - r + 0.5} ${top + 24}L${cx - 8.5} ${top + 4}Q${cx} ${top - 1} ${cx + 8.5} ${top + 4}L${cx + r - 0.5} ${top + 24}`;
  a.path(mp, 'd', 1.2);
  a.add(fillHatch({ shape: `${mp}Z`, box: { x: cx - 11, y: top - 2, w: 22, h: 28 }, angle: 88, spacing: 1.2, width: 0.45 }));
  a.path(ellipse(cx, top + 3.5, 8.5, 2.6), 'd', 0.8);

  // Finger holes: three, a gap, three; elliptical in the curved surface
  const holes = [0.47, 0.53, 0.59, 0.69, 0.75, 0.81];
  let hd = '';
  for (const t of holes) {
    const y = top + (bottom - top) * t;
    hd += ellipse(cx - 1.5, y, 4, 2.8);
  }
  a.path(hd, 'd', 0.9);
  a.add(`<g>${holes.map((t) => `<path class="h" d="${ellipse(cx - 1.5, top + (bottom - top) * t + 0.5, 2.7, 1.6)}" fill="currentColor" stroke="none" opacity=".55"/>`).join('')}</g>`);

  // Breath leaving the mouthpiece (animated)
  let air = '';
  const origin = P(cx - 2, top - 4);
  for (let i = 0; i < 6; i++) {
    const p = rot(P(origin.x - 8 - i * 7, origin.y - 2 - (i % 3) * 3), origin, 0);
    air += `<circle class="breath-dot" cx="${f(p.x)}" cy="${f(p.y)}" r="${(1.6 - i * 0.18).toFixed(2)}" fill="currentColor" stroke="none" style="animation-delay:${(i * 0.42).toFixed(2)}s"/>`;
  }
  a.add(air);
  a.add('</g>');
  return a.done('Най');
}
