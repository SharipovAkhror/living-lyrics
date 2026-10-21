/**
 * Renders the Qalam family on one page so the grid can be checked by eye.
 * Usage: npx tsx scripts/art/icon-proof.ts
 * Writes work/t28-icons/proof.html (gitignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { glyphAt, OPTICAL, type Optical } from './icons/qalam';
import { ICON_NAMES, type Mark } from '../../src/ui/icons/types';

function marks(list: Mark[], sw: number): string {
  return list
    .map((mark) => {
      const fill = mark.draw === 'fill' ? 'currentColor' : 'none';
      const stroke = mark.draw === 'stroke' ? 'currentColor' : 'none';
      const width = mark.draw === 'stroke' ? (mark.sw ?? sw) : 0;
      const opacity = mark.opacity ?? 1;
      const rule = mark.rule ?? 'evenodd';
      const transform = mark.transform ? ` transform="${mark.transform}"` : '';
      return `<path d="${mark.d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill-opacity="${mark.draw === 'fill' ? opacity : 1}" stroke-opacity="${mark.draw === 'stroke' ? opacity : 1}" fill-rule="${rule}"${transform}/>`;
    })
    .join('');
}

function svg(name: (typeof ICON_NAMES)[number], state: 'off' | 'on', px: number): string {
  const optical: Optical = px <= 18 ? 16 : px <= 22 ? 20 : px <= 28 ? 24 : 32;
  const glyph = glyphAt(name, optical);
  const body = state === 'on' && glyph.on ? glyph.on : glyph.off;
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" shape-rendering="geometricPrecision">${marks(body, 1.78)}</svg>`;
}

const tabs = ['character.bubble', 'book.closed', 'list.bullet', 'slider.horizontal.3'] as const;

function sheet(): string {
  const cells = ICON_NAMES.map((name) => {
    const sizes = [16, 20, 24, 32].map((px) => svg(name, 'off', px)).join('');
    const pair = `<div class="pair"><span>off</span>${svg(name, 'off', 48)}<span>on</span>${svg(name, 'on', 48)}</div>`;
    return `<figure><div class="sizes">${sizes}</div><div class="big">${svg(name, 'off', 72)}</div>${pair}<figcaption>${name}</figcaption></figure>`;
  }).join('');
  const bar = tabs
    .map(
      (name, i) =>
        `<button class="${i < 2 ? 'on' : ''}">${svg(name, i < 2 ? 'on' : 'off', 24)}<span>${['Перевод', 'Пояснение', 'Весь текст', 'Настройки'][i]}</span></button>`,
    )
    .join('');
  const transport = ['backward', 'play', 'pause', 'forward']
    .map((name) => svg(name as (typeof ICON_NAMES)[number], 'off', name === 'play' || name === 'pause' ? 28 : 24))
    .join('');
  return `<section><h2>qalam ${OPTICAL.join(' ')}</h2><div class="transport"><i class="disc">${transport}</i></div><div class="bar">${bar}</div><div class="grid">${cells}</div></section>`;
}

const html = `<!doctype html><meta charset="utf-8"><title>icon proof</title>
<style>
  body { margin: 0; font: 13px/1.3 ui-sans-serif, sans-serif; background: #efe6da; color: #1a140f; }
  section { padding: 28px; border-bottom: 8px solid #fff; }
  h2 { margin: 0 0 12px; font-size: 22px; }
  .grid { display: flex; flex-wrap: wrap; gap: 14px; }
  figure { margin: 0; width: 220px; }
  figcaption { font-size: 12px; opacity: .7; }
  .sizes, .big, .pair { display: flex; align-items: flex-end; gap: 8px; color: #1a140f; }
  .big { margin-top: 8px; }
  .pair { margin-top: 6px; align-items: center; }
  .bar, .transport { display: flex; gap: 8px; align-items: center; margin: 0 0 16px; }
  .bar button { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 72px; border: 0; background: transparent; color: color-mix(in srgb, #1a140f 72%, transparent); font: 500 13px/1.2 inherit; }
  .bar button.on { color: #8a3d2a; }
  .disc { display: inline-flex; align-items: center; gap: 10px; background: #8a3d2a; color: #fffaf6; border-radius: 40px; padding: 12px 18px; }
  .dark { background: #07060c; color: #f6f0e6; }
  .dark .sizes, .dark .big, .dark .pair { color: #f6f0e6; }
  .dark .bar button { color: color-mix(in srgb, #f6f0e6 72%, transparent); }
  .dark .bar button.on { color: #e7b59a; }
</style>
${sheet()}
<div class="dark">${sheet()}</div>
`;

mkdirSync('work/t28-icons', { recursive: true });
writeFileSync('work/t28-icons/proof.html', html);
console.log('work/t28-icons/proof.html');
