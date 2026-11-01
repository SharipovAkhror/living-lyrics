import { Art, P, ellipse, fillHatch, line, medallion, poly, rect, shade, smooth } from '../lib.mjs';

// Voice: one vocal part on a stand. Not a person, not a named singer, and not the
// choir's two-page book. The staves carry a repeated sign, not a transcription
// and not words. Nothing on the plate is lettering.
export default function voice() {
  const a = new Art('voice');
  a.add(medallion());

  const foot = `M134 368Q200 360 266 368L258 378Q200 372 142 378Z`;
  a.fillin(foot);
  a.path(foot, 'd', 1.3);
  a.path(ellipse(200, 368, 66, 8), 'd', 1.05);
  a.path(`M168 368L132 384M200 366L200 386M232 368L268 384`, 'd', 1.15);

  const col = smooth(
    [P(194, 250), P(193, 270), P(196, 300), P(194, 330), P(197, 352), P(206, 352), P(203, 330), P(206, 300), P(207, 270), P(206, 250)],
    true,
    0.4,
  );
  a.fillin(col);
  a.path(col, 'd', 1.2);
  a.add(shade({ shape: col, box: { x: 188, y: 246, w: 24, h: 112 }, angle: 90, spacing: 3.6, width: 0.4, light: P(-6, 0) }));

  const lip = poly([P(78, 246), P(322, 246), P(314, 258), P(86, 258)]);
  a.fillin(lip);
  a.path(lip, 'd', 1.15);
  a.add(fillHatch({ shape: lip, box: { x: 76, y: 244, w: 250, h: 16 }, angle: 0, spacing: 3.4, width: 0.4 }));

  // One upright sheet. The curl is the bottom edge only, so it stays a single page.
  const page = smooth(
    [P(108, 78), P(292, 78), P(300, 96), P(300, 210), P(292, 228), P(200, 236), P(108, 228), P(100, 210), P(100, 96)],
    true,
    0.35,
  );
  a.fillin(page);
  a.path(page, 'd', 1.45);
  a.add(shade({ shape: page, box: { x: 96, y: 74, w: 40, h: 166 }, angle: 90, spacing: 4.4, width: 0.32, light: P(18, 0) }));

  // Five staves. The same four noteheads on each: a sign of singing, not this song.
  let staves = '';
  let notes = '';
  for (let s = 0; s < 5; s++) {
    const y = 96 + s * 26;
    for (let i = 0; i < 5; i++) staves += line(P(118, y + i * 3.1), P(282, y + i * 3.1));
    for (let n = 0; n < 4; n++) {
      const x = 146 + n * 34;
      const ny = y + (n % 2 === 0 ? 6.2 : 9.3);
      notes += rect(x, ny, 5.2, 4.2, 0.4);
    }
  }
  a.path(staves, 'h', 0.55);
  a.path(notes, 'd', 0.7);

  return a.done('Голос');
}
