/**
 * Checks the instrument layout engine (src/instruments/layout.ts) over many box sizes, counts and modes.
 *   npm run test:layout           → checks + a table of the automatic choice for typical screens
 * Exit code 1 on any failure.
 */
import { CHIP, LAYOUT_MODES, layoutInstruments, type Layout, type LayoutMode, type Rect, type Slot } from '../../src/instruments/layout.ts';

let failures = 0;
const fail = (where: string, msg: string) => {
  failures++;
  if (failures <= 40) console.log(`✗ ${where}: ${msg}`);
};

const EPS = 0.75;

/** Axis-aligned bounds of a plate after its 2D rotation. */
function bounds(s: Slot): Rect {
  const r = ((s.rotate ?? 0) * Math.PI) / 180;
  const w = Math.abs(s.w * Math.cos(r)) + Math.abs(s.h * Math.sin(r));
  const h = Math.abs(s.w * Math.sin(r)) + Math.abs(s.h * Math.cos(r));
  return { x: s.x + s.w / 2 - w / 2, y: s.y + s.h / 2 - h / 2, w, h };
}
function inter(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > EPS && h > EPS ? w * h : 0;
}
const inside = (r: Rect, w: number, h: number, eps = EPS) => r.x >= -eps && r.y >= -eps && r.x + r.w <= w + eps && r.y + r.h <= h + eps;

function check(L: Layout, n: number, aspects: number[], where: string) {
  const { box, slots } = L;
  const inst = slots.filter((s) => s.kind === 'instrument');
  const chip = slots.find((s) => s.kind === 'more');

  // Every instrument is either drawn once or counted in the chip
  const seen = inst.map((s) => s.index).concat(L.hidden).sort((a, b) => a - b);
  if (seen.join() !== Array.from({ length: n }, (_, i) => i).join()) fail(where, `instruments drawn/hidden: ${seen.join()}`);
  if (L.hidden.length && (!chip || chip.more !== L.hidden.length)) fail(where, `chip missing or wrong count`);
  if (!L.hidden.length && chip) fail(where, `chip without hidden instruments`);
  if (L.hidden.length && L.hidden.some((h, i) => h !== n - L.hidden.length + i)) fail(where, 'hidden instruments are not the last ones');

  for (const s of slots) {
    const b = bounds(s);
    if (!inside(b, box.w, box.h)) fail(where, `${s.role} #${s.index} outside the box: ${JSON.stringify(b)} in ${box.w}×${box.h}`);
    if (s.kind !== 'instrument') continue;
    if (!inside(s.art, s.w, s.h)) fail(where, `art outside its plate (#${s.index})`);
    if (!inside(s.label, s.w, s.h)) fail(where, `caption outside its plate (#${s.index})`);
    if (inter(s.art, s.label)) fail(where, `caption overlaps the drawing (#${s.index})`);
    const want = aspects[s.index] ?? 1;
    if (Math.abs(s.art.w / s.art.h - want) > 0.02 * want + 0.02) fail(where, `drawing stretched: ${(s.art.w / s.art.h).toFixed(3)} ≠ ${want}`);
    if (s.label.w < 40) fail(where, `caption too narrow (${s.label.w}px)`);
  }

  // Readability: a drawing smaller than the threshold only in the last-resort single layout
  if (L.minArt < L.threshold - EPS && !(L.mode === 'single' && inst.length === 1)) fail(where, `drawing below readable size: ${L.minArt} < ${L.threshold} (${L.mode})`);

  // Overlaps: only the intended ones
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      const area = inter(bounds(a), bounds(b));
      if (!area) continue;
      const smaller = Math.min(a.w * a.h, b.w * b.h);
      const pair = [a.role, b.role].sort().join('+');
      if (L.mode === 'fan') continue;
      if (L.mode === 'pair-diagonal' && area <= 0.2 * smaller) continue;
      if (L.mode === 'hero-insets' && (a.role === 'main' || b.role === 'main')) continue;
      if (L.mode === 'single' && pair === 'more+solo') continue;
      fail(where, `${a.role} #${a.index} overlaps ${b.role} #${b.index} (${Math.round(area)} px²)`);
    }
  }

  // Hero-insets: insets stay in the free corners, clear of the hero's medallion and caption
  if (L.mode === 'hero-insets') {
    const hero = slots.find((s) => s.role === 'main')!;
    const C = { x: hero.x + hero.art.x + hero.art.w / 2, y: hero.y + hero.art.y + hero.art.h / 2 };
    const R = 0.465 * Math.min(hero.art.w, hero.art.h);
    const cap: Rect = { x: hero.x + hero.label.x, y: hero.y + hero.label.y, w: hero.label.w, h: hero.label.h };
    for (const s of slots.filter((x) => x !== hero)) {
      const nx = Math.max(s.x, Math.min(C.x, s.x + s.w));
      const ny = Math.max(s.y, Math.min(C.y, s.y + s.h));
      if (Math.hypot(nx - C.x, ny - C.y) < R - EPS) fail(where, `inset #${s.index} covers the main drawing`);
      if (inter(s, cap)) fail(where, `inset #${s.index} covers the main caption`);
    }
    const heroSide = Math.min(hero.art.w, hero.art.h);
    for (const s of slots.filter((x) => x.role === 'inset')) if (Math.min(s.art.w, s.art.h) > heroSide * 0.75) fail(where, 'inset as large as the main drawing');
  }

  // Fan: each card behind keeps at least 40 % of its width in view
  if (L.mode === 'fan') {
    const front = slots[0];
    for (const s of slots.slice(1)) {
      const nearer = slots.filter((o) => o.z > s.z);
      let covered = 0;
      for (const o of nearer) covered = Math.max(covered, Math.max(0, Math.min(s.x + s.w, o.x + o.w) - Math.max(s.x, o.x)));
      if ((s.w - covered) / s.w < 0.4) fail(where, `card #${s.index} mostly hidden`);
    }
    if (front.z <= Math.max(...slots.slice(1).map((s) => s.z))) fail(where, 'first card is not on top');
  }
}

// Sweep: many boxes, counts 1…8, automatic and every requested mode, square and non-square drawings
const widths = [240, 300, 320, 360, 390, 430, 520, 640, 768, 844, 1024, 1200, 1440, 1600];
const heights = [220, 300, 360, 420, 520, 600, 700, 820, 1000];
const aspectSets = [[1], [0.75, 1, 1.3, 1, 0.8, 1.2, 1, 1]];
let cases = 0;
for (const w of widths) {
  for (const h of heights) {
    for (let n = 1; n <= 8; n++) {
      for (const set of aspectSets) {
        const aspects = Array.from({ length: n }, (_, i) => set[i % set.length]);
        for (const mode of ['auto', ...LAYOUT_MODES] as const) {
          const where = `${w}×${h} n=${n} ${mode}${set.length > 1 ? ' mixed' : ''}`;
          const L = layoutInstruments(n, { w, h }, { mode, aspects });
          check(L, n, aspects, where);
          cases++;
          if (mode === 'auto' && set.length === 1) {
            const again = layoutInstruments(n, { w, h }, { mode, aspects });
            if (JSON.stringify(again) !== JSON.stringify(L)) fail(where, 'not deterministic');
          }
        }
      }
    }
  }
}
// Three caption lines (performer shown)
for (const [w, h] of [[390, 600], [1200, 700], [320, 420]]) for (let n = 1; n <= 8; n++) check(layoutInstruments(n, { w, h }, { lines: 3 }), n, [1], `${w}×${h} n=${n} lines=3`), cases++;

// A requested mode is honoured when it is readable
const honoured: [number, number, number, LayoutMode][] = [
  [1200, 700, 2, 'pair-diagonal'],
  [1200, 700, 3, 'grid'],
  [1200, 700, 4, 'fan'],
  [390, 600, 2, 'stack'],
  [1200, 700, 3, 'hero-insets'],
  [1200, 700, 3, 'single'],
];
for (const [w, h, n, mode] of honoured) {
  const L = layoutInstruments(n, { w, h }, { mode });
  if (L.mode !== mode || L.fallback) fail(`${w}×${h} n=${n}`, `requested ${mode}, got ${L.mode}${L.fallback ? ' (fallback)' : ''}`);
}
const single3 = layoutInstruments(3, { w: 1200, h: 700 }, { mode: 'single' });
if (single3.hidden.length !== 2) fail('single with 3', 'the other two should be in the chip');
if (CHIP.w <= 0) fail('chip', 'size');

// Table: what the automatic choice does on typical screens
const screens: [string, number, number][] = [
  ['iPhone, портрет', 390, 600],
  ['iPhone SE', 320, 440],
  ['iPhone, альбом', 844, 330],
  ['iPad', 820, 900],
  ['ноутбук', 1200, 700],
  ['большой экран', 1600, 820],
];
console.log('\nАвтоматический выбор (режим · наименьшая гравюра, px · спрятано в «+N»):');
console.log(['экран'.padEnd(26), ...Array.from({ length: 8 }, (_, i) => String(i + 1).padEnd(19))].join(''));
for (const [name, w, h] of screens) {
  const row = [`${name} ${w}×${h}`.padEnd(26)];
  for (let n = 1; n <= 8; n++) {
    const L = layoutInstruments(n, { w, h });
    row.push(`${L.mode} ${L.minArt}${L.hidden.length ? ` +${L.hidden.length}` : ''}`.padEnd(19));
  }
  console.log(row.join(''));
}

console.log(`\n${cases} раскладок проверено, ошибок: ${failures}.`);
process.exit(failures ? 1 : 0);
