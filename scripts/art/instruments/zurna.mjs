import { Art, P, ellipse, shade, fillHatch, medallion, f } from '../lib.mjs';

// Zurna: conical shawm with a flared bell, seven holes, a lip disc and a short double reed.
export default function zurna() {
  const a = new Art('zurna');
  const cx = 200;
  const top = 54;
  const bodyEnd = 300;
  const shape = `M${cx - 7} ${top + 20}L${cx - 13} ${bodyEnd - 30}C${cx - 18} ${bodyEnd} ${cx - 44} ${bodyEnd + 40} ${cx - 56} ${bodyEnd + 62}L${cx + 56} ${bodyEnd + 62}C${cx + 44} ${bodyEnd + 40} ${cx + 18} ${bodyEnd} ${cx + 13} ${bodyEnd - 30}L${cx + 7} ${top + 20}Z`;
  a.add(medallion());
  a.add('<g transform="rotate(-36 200 210)">');
  a.fillin(shape);
  a.path(shape, 'd', 1.5);
  a.add(shade({ shape, box: { x: cx - 60, y: top, w: 120, h: 320 }, angle: 90, spacing: 1.6, width: 0.5, light: P(-9, 0) }));
  a.path(ellipse(cx, bodyEnd + 62, 56, 9), 'd', 1.3);
  a.add(fillHatch({ shape: ellipse(cx, bodyEnd + 62, 50, 6.5), box: { x: cx - 52, y: bodyEnd + 54, w: 104, h: 16 }, angle: 0, spacing: 1.3, width: 0.45 }));
  // Turned rings
  let rings = '';
  for (const y of [top + 34, top + 40, bodyEnd - 24, bodyEnd - 18]) {
    const w = 7 + ((y - top) / (bodyEnd - top)) * 6;
    rings += `M${f(cx - w - 1)} ${y}Q${cx} ${y + 3} ${f(cx + w + 1)} ${y}`;
  }
  a.path(rings, 'd', 0.8);
  // Seven finger holes
  let holes = '';
  for (let i = 0; i < 7; i++) holes += ellipse(cx - 1, top + 82 + i * 22, 3, 2.4);
  a.path(holes, 'd', 0.9);
  // Lip disc and reed
  a.path(ellipse(cx, top + 16, 17, 4.2), 'd', 1.2);
  a.path(`M${cx - 3} ${top + 15}L${cx - 2.5} ${top - 6}L${cx + 2.5} ${top - 6}L${cx + 3} ${top + 15}`, 'd', 0.9);
  a.path(`M${cx - 4} ${top - 6}L${cx + 4} ${top - 6}L${cx + 3} ${top - 16}L${cx - 3} ${top - 16}Z`, 'd', 0.9);
  a.add('</g>');
  return a.done('Зурна');
}
