/**
 * Word fill is a function of time, and the sung word is not painted with a translucent colour.
 *   npx tsx scripts/tools/fill-join.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillEdgePercent, fillMaskDirection, fillQuery, lineWordSync, wordFillFraction, wordSyncOn } from '../../src/scene/fill.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`✗ ${msg}`);
};
const near = (a: number, b: number, where: string) => {
  if (Math.abs(a - b) > 0.001) fail(`${where}: ${a} ≠ ${b}`);
};

// Same time, same fraction. A seek does not depend on anything but t.
near(wordFillFraction(12.4, 10, 14), wordFillFraction(12.4, 10, 14), 'повтор того же t');
if (wordFillFraction(10, 10, 12) !== 0) fail('в начале слова доля не 0');
if (wordFillFraction(9, 10, 12) !== 0) fail('до слова доля не 0');
// A held note reaches full at 1.6 s, not at the end of the note.
// 11.6 and 0.04 are not exact in binary, so the quotient sits a ulp under the mark.
near(wordFillFraction(11.6, 10, 14), 1, 'долгая нота не доходит до 1 за 1,6 с');
near(wordFillFraction(10.8, 10, 14), 0.5, 'середина окна 1,6 с');
let prev = -1;
for (let i = 0; i <= 16; i++) {
  const f = wordFillFraction(10 + i * 0.1, 10, 14);
  if (f < prev) fail('доля убывает');
  prev = f;
}
near(wordFillFraction(10.04, 10, 10.05), 0.5, 'короткое слово не растянуто до 0,08 с');

// Symmetric inset keeps the middle of a wide word at 50 %.
near(fillEdgePercent(0, 100, 40), 8.4, 'край в начале');
near(fillEdgePercent(1, 100, 40), 91.6, 'край в конце');
near(fillEdgePercent(0.25, 100, 40), 29.2, 'четверть');
near(fillEdgePercent(0.5, 100, 40), 50, 'середина');
near(fillEdgePercent(0.75, 100, 40), 70.8, 'три четверти');
// A word narrower than the inset sweeps the whole box instead of running backwards.
near(fillEdgePercent(0.5, 10, 40), 50, 'узкое слово');
near(fillEdgePercent(0, 10, 40), 0, 'узкое слово в начале');
if (fillEdgePercent(0.25, 0, 40) !== 25) fail('нулевая ширина');

if (fillMaskDirection(true) !== 'to left') fail('RTL должен заливаться справа');
if (fillMaskDirection(false) !== 'to right') fail('LTR должен заливаться слева');

if (fillQuery('')) fail('пустой адрес не включает заливку');
if (fillQuery('?t=10')) fail('чужой параметр не включает заливку');
if (!fillQuery('?fill=1')) fail('?fill=1 не включил заливку');
if (!fillQuery('?t=12&fill=1')) fail('fill среди других параметров');
if (fillQuery('?fill=0')) fail('fill=0 не должен включать');

if (wordSyncOn('aligned', '') !== true) fail('aligned без адреса должен заливать');
if (wordSyncOn('draft', '') !== false) fail('draft без адреса не должен заливать');
if (wordSyncOn('draft', '?fill=1') !== true) fail('draft с ?fill=1 должен заливать');

if (lineWordSync(false, false, false)) fail('песня без заливки');
if (lineWordSync(true, true, false)) fail('timing-draft не должен заливаться');
if (!lineWordSync(true, true, true)) fail('принудительная заливка должна брать и timing-draft');
if (!lineWordSync(true, false, false)) fail('обычная строка доказанной песни');

const css = readFileSync(join(root, 'src/styles/app.css'), 'utf8');
const filling = css.match(/\.w\.is-filling \{[^}]*\}/);
if (!filling) fail('нет правила .w.is-filling');
else {
  if (filling[0].includes('color-mix') || filling[0].includes('transparent')) fail('.w.is-filling красит полупрозрачным цветом');
  if (!filling[0].includes('mask-image')) fail('.w.is-filling без маски');
  if (!filling[0].includes('opacity: 1')) fail('.w.is-filling не собирает глиф в один непрозрачный слой');
}
if (!css.includes(".fb-orig[dir='rtl'] .w.is-filling") || !css.includes('--fill-dir: to left')) {
  fail('RTL не направляет заливку справа');
}

const block = readFileSync(join(root, 'src/scene/LineBlock.tsx'), 'utf8');
if (block.includes('linear-gradient') || block.includes('color-mix') || block.includes('--w-dim')) {
  fail('LineBlock снова красит слово полупрозрачным градиентом');
}
if (!block.includes('fillEdgePercent') || !block.includes('wordFillFraction') || !block.includes('fillMaskDirection')) {
  fail('LineBlock не ведёт край от функции времени');
}

const scene = readFileSync(join(root, 'src/scene/Scene.tsx'), 'utf8');
if (!scene.includes('fillQuery') || !scene.includes('wordSyncOn')) fail('сцена не читает ?fill=1');

if (failures) {
  console.log(`\n✗ fill-join  ${failures}`);
  process.exit(1);
}
console.log('✓ fill-join');
