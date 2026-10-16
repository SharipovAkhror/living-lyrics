import { Art, P, smooth, chainSmooth, line, circle, shade, fillHatch, hatchLines, medallion, poly, f } from '../lib.mjs';

// Grand piano seen from above with the lid off: the case with its straight bass side, S-shaped bentside
// and round tail; the iron plate with its row of round openings; treble and tenor strings running back to
// the long bridge, the bass strings crossing over them to the bass bridge near the tail; the row of dampers;
// and the keyboard of 88 keys (52 white, 36 black) between the cheek blocks.
// Plan in centimetres (≈ 1.4 px per cm): 148 cm wide, 186 cm long, keys 122.7 cm.
export default function piano() {
  const a = new Art('piano');
  const s = 1.4;
  const X = (x, y) => P(200 + (x - 74) * s, 206 - (y - 84) * s);
  const pl = (pts) => pts.map(([x, y]) => X(x, y));
  // Curved part of the case, from the treble front corner round the tail to the straight bass side
  const curve = [[148, 0], [148, 26], [145.5, 42], [137, 60], [121, 82], [103, 106], [87, 130], [75, 150], [65, 166], [51, 179], [31, 186], [13, 183], [3.5, 174], [0, 158]];
  const outline = (pts) => chainSmooth([pl(pts), [X(...pts.at(-1)), X(pts.at(-1)[0], pts[0][1])], [X(pts.at(-1)[0], pts[0][1]), X(...pts[0])]], true, 0.5);
  const c0 = [74, 90];
  const inset = (k) => curve.map(([x, y]) => [c0[0] + (x - c0[0]) * k, c0[1] + (y - c0[1]) * k]);
  const caseOut = outline(curve);
  const caseIn = outline(inset(0.962).map(([x, y], i) => (i === 0 ? [x, 0] : [x, y])));
  const plate = outline(inset(0.9).map(([x, y], i) => (i === 0 ? [x, 8] : [x, y])));
  const rimSide = outline(curve.map(([x, y]) => [x + 2.6, y - 2]));

  a.add(medallion());
  a.add('<g transform="rotate(-16 200 205)">');

  // Rim seen past the edge (depth of the case), then the rim top
  a.begin();
  a.path(rimSide, 'd', 1.1);
  a.add(shade({ shape: rimSide, box: { x: 90, y: 40, w: 230, h: 320 }, angle: 60, spacing: 1.5, width: 0.5, light: P(-4, -3) }));
  a.hidden(caseOut);
  a.fillin(caseOut);
  a.path(caseOut, 'd', 1.6);
  a.path(caseIn, 'd', 0.8);
  // Rim top: a narrow band between the outer and inner outlines, lightly hatched
  a.defs += `<clipPath id="piano-rim"><path d="${caseOut + caseIn}" clip-rule="evenodd"/></clipPath>`;
  a.add(`<g clip-path="url(#piano-rim)"><path class="h" d="${hatchLines({ x: 90, y: 40, w: 220, h: 320 }, 35, 2.2)}" stroke-width="0.32"/></g>`);

  // Iron plate
  a.path(plate, 'd', 1);
  a.add(shade({ shape: plate, box: { x: 96, y: 50, w: 210, h: 300 }, angle: 30, spacing: 2.8, width: 0.34, light: P(-16, -14) }));
  // Front bar with the round openings, and the pin field
  const holes = [[22, 24, 4.6], [40, 25, 5.2], [60, 25.5, 5.4], [80, 25.5, 5.4], [100, 25, 5], [118, 24, 4.4]];
  a.path(holes.map(([x, y, r]) => { const p = X(x, y); return circle(p.x, p.y, r * s); }).join(''), 'd', 0.9);
  a.path(holes.map(([x, y, r]) => { const p = X(x, y); return circle(p.x, p.y, r * s * 0.72); }).join(''), 'h', 0.45);
  let pins = '';
  for (let i = 0; i < 64; i++) {
    const x = 7 + i * 2.05;
    for (const y of [11.5, 14.5]) {
      const p = X(x + (y > 13 ? 1 : 0), y);
      pins += `M${f(p.x)} ${f(p.y)}l.1 0`;
    }
  }
  a.path(pins, 'h', 1.1);

  // Strings. Tenor and treble run back to the long bridge; the bass crosses over them to the bass bridge.
  // Long bridge from the treble end to the tenor end, following the bentside inside the plate
  const bridgePts = [[134, 34], [122, 60], [104, 86], [86, 112], [70, 136], [56, 155], [42, 168]];
  const bridgeY = (x) => {
    for (let i = 0; i < bridgePts.length - 1; i++) {
      const [x0, y0] = bridgePts[i];
      const [x1, y1] = bridgePts[i + 1];
      if (x <= x0 && x >= x1) return y0 + ((y1 - y0) * (x0 - x)) / (x0 - x1);
    }
    return bridgePts.at(-1)[1];
  };
  let treble = '';
  for (let x = 133; x >= 43; x -= 1.95) treble += line(X(x, 17), X(x, bridgeY(x)));
  a.path(treble, 'str', 0.32);
  a.path(smooth(bridgePts.map(([x, y]) => X(x, y)), false, 0.5), 'd', 1.4);
  // Bass: wound strings fanning back and to the right over the tenor, to the bass bridge near the tail
  const bb = [[16, 176], [50, 171]];
  let bass = '';
  const nB = 15;
  for (let i = 0; i < nB; i++) {
    const t = i / (nB - 1);
    bass += line(X(5 + t * 33, 17), X(bb[0][0] + (bb[1][0] - bb[0][0]) * t, bb[0][1] + (bb[1][1] - bb[0][1]) * t));
  }
  a.path(bass, 'str', 0.62);
  a.path(line(X(...bb[0]), X(...bb[1])), 'd', 1.6);

  // Dampers: a row of small felt blocks across the strings, the top treble left free
  let dampers = '';
  for (let i = 0; i < 40; i++) {
    const x = 8 + i * 2.6;
    dampers += poly([X(x, 29), X(x + 2, 29), X(x + 2, 35), X(x, 35)]);
  }
  a.path(dampers, 'd', 0.5);

  // Fallboard band and cheek blocks
  a.path(poly(pl([[0, 0], [148, 0], [148, 6], [0, 6]])), 'd', 0.9);
  a.add(fillHatch({ shape: poly(pl([[0, 0], [148, 0], [148, 6], [0, 6]])), box: { x: 90, y: 300, w: 220, h: 30 }, angle: 0, spacing: 1.4, width: 0.4 }));
  const cheekL = poly(pl([[0, 0], [12.6, 0], [12.6, -15], [2.5, -16], [0, -13.5]]));
  const cheekR = poly(pl([[135.3, 0], [148, 0], [148, -13.5], [145.5, -16], [135.3, -15]]));
  a.path(cheekL + cheekR, 'd', 1.1);
  a.add(fillHatch({ shape: cheekL + cheekR, box: { x: 90, y: 300, w: 220, h: 40 }, angle: 35, spacing: 1.5, width: 0.4 }));

  // Keyboard: 52 white keys from A0 to C8, 36 black keys
  const k0 = 12.6;
  const kw = 122.7 / 52;
  let white = poly(pl([[k0, 0], [k0 + 122.7, 0], [k0 + 122.7, -15], [k0, -15]]));
  for (let i = 1; i < 52; i++) white += line(X(k0 + i * kw, 0), X(k0 + i * kw, -15));
  a.path(white, 'd', 0.5);
  // Black keys sit after these white keys (within an octave starting at C): C, D, F, G, A
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  let black = '';
  for (let i = 0; i < 51; i++) {
    const n = names[i % 7];
    if (!['A', 'C', 'D', 'F', 'G'].includes(n)) continue;
    const x = k0 + (i + 1) * kw;
    black += poly(pl([[x - 0.68, 0], [x + 0.68, 0], [x + 0.68, -9.5], [x - 0.68, -9.5]]));
  }
  a.add(`<path class="h" d="${black}" fill="currentColor" stroke="none" opacity=".85"/>`);
  a.path(line(X(0, -16), X(148, -16)), 'd', 0.6);
  a.add('</g>');
  return a.done('Фортепиано');
}
