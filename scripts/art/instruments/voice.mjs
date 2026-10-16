import { Art, P, smooth, chainSmooth, shade, medallion, lerpP, gid, f } from '../lib.mjs';

// Solo voice: a generic singer in profile, cut as a bust like the portrait on a medal, eyes closed,
// mouth open, the voice leaving in three soft arcs. Deliberately not a likeness of anyone.
export default function voice() {
  const a = new Art('voice');
  // Face (top → bottom), facing left
  const face = [
    P(232, 60), P(204, 66), P(184, 80), P(174, 98), P(171, 116), P(174, 126), P(168, 140), P(158, 156), P(157, 161), P(164, 165),
    P(169, 168), P(166, 176),
  ];
  const mouthIn = [P(166, 176), P(177, 180), P(167, 186)];
  const chin = [P(167, 186), P(172, 194), P(168, 204), P(176, 215), P(196, 221), P(208, 230), P(212, 246), P(214, 262)];
  const back = [P(288, 264), P(280, 243), P(277, 219), P(281, 195), P(292, 170), P(299, 140), P(296, 108), P(282, 82), P(260, 64), P(232, 60)];
  // Bust: robe over the shoulders, cut in a curve at the bottom
  const front = [P(214, 262), P(196, 276), P(168, 292), P(148, 316), P(140, 342), P(146, 356)];
  const backBust = [P(326, 350), P(334, 328), P(328, 300), P(310, 280), P(288, 264)];
  const cut = [P(146, 356), P(200, 365), P(266, 364), P(326, 350)];
  const outline = chainSmooth([face, mouthIn, chin, front, cut, backBust, back], true, 0.5);

  a.add(medallion());
  a.add('<g transform="translate(214 200) scale(0.92) translate(-220 -206)">');
  a.fillin(outline);
  a.path(outline, 'd', 1.6);
  a.add(shade({ shape: outline, box: { x: 130, y: 50, w: 230, h: 330 }, angle: 64, spacing: 2, width: 0.42, light: P(-18, -12) }));

  // Hair: a combed-back mass between the hairline and the skull, engraved as strands
  const outer = [P(181, 88), P(188, 72), P(206, 61), P(232, 57), P(262, 62), P(284, 80), P(298, 108), P(300, 140), P(292, 166), P(281, 182)];
  const inner = [P(181, 88), P(196, 94), P(214, 100), P(230, 110), P(240, 120), P(250, 120), P(262, 124), P(272, 140), P(276, 160), P(281, 182)];
  const hairShape = smooth([...outer, ...inner.slice(1, -1).reverse()], true, 0.5);
  a.path(smooth(inner, false, 0.5), 'd', 0.8);
  const hc = gid('clip');
  a.defs += `<clipPath id="${hc}"><path d="${hairShape}"/></clipPath>`;
  let hair = '';
  const N = 13;
  for (let k = 1; k < N; k++) {
    const t = k / N;
    hair += smooth(outer.map((o, i) => lerpP(inner[i], o, t)), false, 0.5);
  }
  a.add(`<g clip-path="url(#${hc})"><path class="h" d="${hair}" stroke-width="0.5"/></g>`);

  // Ear, closed eye, brow, nostril, lips
  a.path(smooth([P(250, 128), P(258, 122), P(266, 130), P(266, 146), P(260, 160), P(252, 160)], false, 0.5) + smooth([P(256, 134), P(260, 140), P(256, 150)], false, 0.5), 'd', 0.9);
  a.path(`M180 130Q186 134 193 131`, 'd', 1);
  a.path(`M182 136l-2 3M186 137l-1 3M190 136l0 3`, 'h', 0.5);
  a.path(`M176 120Q186 114 198 120`, 'd', 0.9);
  a.path(`M166 162Q170 160 172 163`, 'd', 0.8);
  a.path(`M171 175Q175 178 177 180`, 'h', 0.6);
  // Neck modelling
  a.path(smooth([P(228, 232), P(233, 250), P(234, 262)], false, 0.5), 'h', 0.5);

  // Robe: collar and a few folds
  a.path(smooth([P(214, 262), P(236, 278), P(262, 276), P(288, 264)], false, 0.5), "d", 1);
  a.path(smooth([P(200, 274), P(224, 296), P(262, 294), P(300, 276)], false, 0.5), 'd', 0.8);
  let folds = '';
  for (const [x0, y0, x1, y1] of [[176, 300, 196, 352], [204, 306, 218, 358], [246, 304, 252, 360], [290, 292, 298, 350], [312, 294, 318, 342]]) folds += `M${x0} ${y0}Q${f((x0 + x1) / 2 + 6)} ${f((y0 + y1) / 2)} ${x1} ${y1}`;
  a.path(folds, 'h', 0.7);

  // The voice: three soft arcs leaving the open mouth
  let arcs = '';
  for (const [r, w] of [[18, 0.9], [32, 0.8], [46, 0.7]]) {
    const c = P(170, 180);
    const a0 = (150 * Math.PI) / 180;
    const a1 = (214 * Math.PI) / 180;
    arcs += `<path class="h" d="M${f(c.x + r * Math.cos(a0))} ${f(c.y + r * Math.sin(a0))}A${r} ${r} 0 0 1 ${f(c.x + r * Math.cos(a1))} ${f(c.y + r * Math.sin(a1))}" stroke-width="${w}"/>`;
  }
  a.add(arcs);
  a.add(`<circle class="breath-dot" cx="128" cy="178" r="1.4" fill="currentColor" stroke="none"/><circle class="breath-dot" cx="118" cy="186" r="1.1" fill="currentColor" stroke="none" style="animation-delay:.9s"/><circle class="breath-dot" cx="122" cy="168" r="1" fill="currentColor" stroke="none" style="animation-delay:1.7s"/>`);
  a.add('</g>');
  return a.done('Голос');
}
