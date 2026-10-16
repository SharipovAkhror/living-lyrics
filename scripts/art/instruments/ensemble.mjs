import oud from './oud.mjs';
import daf from './daf.mjs';
import ney from './ney.mjs';
import { medallion } from '../lib.mjs';

// Ensemble: daf behind, oud and ney crossing in front — used for tutti passages and as the fallback.
const inner = (svg) => {
  const defs = svg.match(/<defs>([\s\S]*?)<\/defs>/)?.[1] ?? '';
  const body = svg.replace(/^[\s\S]*?<\/defs>/, '').replace(/<\/svg>\s*$/, '').replace(/<g class="frame"[\s\S]*?<\/g>/, '');
  return { defs, body };
};

export default function ensemble() {
  const parts = [
    { svg: daf(), t: 'translate(196 52) scale(0.44)' },
    { svg: ney(), t: 'translate(168 150) scale(0.56)' },
    { svg: oud(), t: 'translate(36 78) scale(0.66)' },
  ].map(({ svg, t }) => ({ ...inner(svg), t }));
  const defs = parts.map((p) => p.defs).join('');
  const body = parts.map((p) => `<g transform="${p.t}">${p.body}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Ансамбль"><defs>${defs}</defs>${medallion()}${body}</svg>\n`;
}
