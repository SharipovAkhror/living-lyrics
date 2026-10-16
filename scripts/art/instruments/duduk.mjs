import { Art, P, line, ellipse, shade, fillHatch, medallion, chainSmooth, rect, f } from '../lib.mjs';

// Duduk: a plain cylindrical tube of apricot wood (no bell) with a turned socket at the top,
// eight finger holes on the front (the thumb hole is on the back, out of sight), and the large flat
// double reed of cane with its tuning bridle tied round it.
// Proportions (≈ 7.6 px per cm): body 34 cm × 2.9 cm, reed ≈ 10.5 cm (≈ 8.5 cm outside), reed lips ≈ 2.4 cm wide.
export default function duduk() {
  const a = new Art('duduk');
  const cx = 200;
  const reedTop = 30;
  const socket = 95; // top of the body
  const bottom = 352;
  const r = 11;

  a.add(medallion());
  a.add('<g transform="translate(200 200) rotate(-44) scale(1.06) translate(-200 -192)">');

  // Body: socket collar, plain tube, a turned ring at the foot
  const tube = `M${cx - r} ${socket + 12}L${cx - r} ${bottom - 2}Q${cx} ${bottom + 3} ${cx + r} ${bottom - 2}L${cx + r} ${socket + 12}Z`;
  a.fillin(tube);
  a.path(tube, 'd', 1.5);
  a.add(shade({ shape: tube, box: { x: cx - r - 2, y: socket, w: 2 * r + 4, h: bottom - socket + 6 }, angle: 90, spacing: 1.5, width: 0.48, light: P(-7, 0) }));
  a.path(line(P(cx - r + 3.2, socket + 24), P(cx - r + 3.2, bottom - 26)), 'h', 0.4);
  // Wood grain along the tube
  let grain = '';
  for (let x = cx - r + 2; x < cx + r; x += 3.4) grain += `M${f(x)} ${socket + 14}C${f(x + 0.8)} ${socket + 90} ${f(x - 0.8)} ${bottom - 90} ${f(x + 0.4)} ${bottom - 4}`;
  a.add(`<g clip-path="url(#duduk-tube)"><path class="h" d="${grain}" stroke-width="0.22" opacity=".7"/></g>`);
  a.defs += `<clipPath id="duduk-tube"><path d="${tube}"/></clipPath>`;
  // Socket collar (slightly wider), with two turned grooves
  const collar = `M${cx - r - 1.6} ${socket}L${cx + r + 1.6} ${socket}L${cx + r + 1.6} ${socket + 12}Q${cx} ${socket + 15} ${cx - r - 1.6} ${socket + 12}Z`;
  a.path(collar, 'd', 1.3);
  a.add(shade({ shape: collar, box: { x: cx - r - 3, y: socket - 2, w: 2 * r + 6, h: 18 }, angle: 90, spacing: 1.3, width: 0.45, light: P(-7, 0) }));
  a.path(`M${cx - r - 1.6} ${socket + 4}Q${cx} ${socket + 7} ${cx + r + 1.6} ${socket + 4}M${cx - r - 1.6} ${socket + 8}Q${cx} ${socket + 11} ${cx + r + 1.6} ${socket + 8}`, 'd', 0.6);
  a.path(ellipse(cx, socket, r + 1.6, 2.6), 'd', 1);
  // Foot ring
  a.path(`M${cx - r} ${bottom - 14}Q${cx} ${bottom - 11} ${cx + r} ${bottom - 14}M${cx - r} ${bottom - 10}Q${cx} ${bottom - 7} ${cx + r} ${bottom - 10}`, 'd', 0.7);

  // Eight finger holes on the front, evenly spread over the lower two thirds
  let holes = '';
  let wells = '';
  for (let i = 0; i < 8; i++) {
    const y = socket + 86 + i * 20.5;
    holes += ellipse(cx - 1, y, 3.6, 2.9);
    wells += ellipse(cx - 1.4, y + 0.5, 2.3, 1.7);
  }
  a.path(holes, 'd', 0.9);
  a.add(`<path class="h" d="${wells}" fill="currentColor" stroke="none" opacity=".55"/>`);

  // Reed: flat cane lips, narrowing to the round tube that sits in the socket
  const R = [P(cx + 9.6, reedTop), P(cx + 9.7, reedTop + 12), P(cx + 8.8, reedTop + 28), P(cx + 6.8, reedTop + 45), P(cx + 5.6, reedTop + 55), P(cx + 5.2, socket + 1)];
  const L = R.map((q) => P(2 * cx - q.x, q.y)).reverse();
  const reed = chainSmooth([R, [R.at(-1), L[0]], L, [L.at(-1), R[0]]], true, 0.5);
  a.fillin(reed);
  a.path(reed, 'd', 1.2);
  // Cane fibres
  let fib = '';
  for (let x = cx - 8; x <= cx + 8; x += 2.2) fib += `M${f(x)} ${reedTop + 3}C${f(x)} ${reedTop + 24} ${f(cx + (x - cx) * 0.6)} ${reedTop + 44} ${f(cx + (x - cx) * 0.55)} ${socket - 2}`;
  a.add(`<g clip-path="url(#duduk-reed)"><path class="h" d="${fib}" stroke-width="0.25" opacity=".8"/></g>`);
  a.defs += `<clipPath id="duduk-reed"><path d="${reed}"/></clipPath>`;
  a.add(shade({ shape: reed, box: { x: cx - 11, y: reedTop - 2, w: 22, h: socket - reedTop + 4 }, angle: 90, spacing: 1.4, width: 0.42, light: P(-5, 0) }));
  // The lips' opening at the tip
  a.path(`M${cx - 9.6} ${reedTop}Q${cx} ${reedTop - 1.8} ${cx + 9.6} ${reedTop}Q${cx} ${reedTop + 1.8} ${cx - 9.6} ${reedTop}Z`, 'd', 0.9);
  a.path(line(P(cx - 7, reedTop), P(cx + 7, reedTop)), 'h', 0.5);
  // Tuning bridle: a cane band with a few turns of thread
  const by = reedTop + 24;
  const band = rect(cx - 10.6, by - 3.2, 21.2, 6.4, 1.2);
  a.path(band, 'd', 1);
  a.add(fillHatch({ shape: band, box: { x: cx - 12, y: by - 5, w: 24, h: 10 }, angle: 90, spacing: 1.6, width: 0.38 }));

  a.add('</g>');
  return a.done('Дудук');
}
