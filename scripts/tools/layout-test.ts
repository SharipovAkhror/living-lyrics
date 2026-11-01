/**
 * Checks the instrument layout engine (src/instruments/layout.ts) over many box sizes, counts and modes.
 *   npm run test:layout           → checks + a table of the automatic choice for typical screens
 * Exit code 1 on any failure.
 */
import { LIFE_DIM, LIFE_REST, plateLife, type AudioFeatures } from '../../src/instruments/animation.ts';
import { CHIP, LAYOUT_MODES, layoutInstruments, type Layout, type LayoutMode, type Rect, type Slot } from '../../src/instruments/layout.ts';
import { castAt } from '../../src/scene/cast.ts';
import { stageFrame } from '../../src/scene/columns.ts';
import { footnoteTop } from '../../src/scene/noteFit.ts';

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

  // Every instrument is either drawn once or left out. There is no «+N» chip.
  const seen = inst.map((s) => s.index).concat(L.hidden).sort((a, b) => a - b);
  if (seen.join() !== Array.from({ length: n }, (_, i) => i).join()) fail(where, `instruments drawn/hidden: ${seen.join()}`);
  if (chip) fail(where, '«+N» chip is drawn');
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
if (single3.hidden.length !== 2) fail('single with 3', 'the other two should be left out');
if (single3.slots.some((s) => s.kind === 'more')) fail('single with 3', 'chip drawn');
if (CHIP.w <= 0) fail('chip', 'size');

// Prominence: cap, rank, shared baseline, no chip.
const wide5 = layoutInstruments(5, { w: 1440, h: 820 });
if (wide5.mode !== 'prominence' || wide5.slots.length !== 4 || wide5.hidden.length !== 1) fail('wide n=5', `${wide5.mode} shown ${wide5.slots.length} hidden ${wide5.hidden.length}`);
const mid5 = layoutInstruments(5, { w: 800, h: 480 });
if (mid5.mode !== 'prominence' || mid5.slots.length !== 3 || mid5.hidden.length !== 2) fail('medium n=5', `${mid5.mode} shown ${mid5.slots.length}`);
const phone5 = layoutInstruments(5, { w: 390, h: 600 });
if (phone5.mode !== 'prominence' || phone5.slots.length !== 4 || phone5.hidden.length !== 1) fail('phone n=5', `${phone5.mode} shown ${phone5.slots.length} hidden ${phone5.hidden.length}`);
if (phone5.minArt < phone5.threshold - EPS) fail('phone n=5', 'companions below readable size');
const phone3 = layoutInstruments(3, { w: 390, h: 520 });
if (phone3.slots.length !== 3) fail('phone n=3', `shown ${phone3.slots.length}`);
const phoneShort = layoutInstruments(4, { w: 369, h: 240 });
if (phoneShort.slots.length !== 4) fail('phone stage', `shown ${phoneShort.slots.length} in 369×240`);
function artBottoms(slots: Slot[]) {
  return slots.map((s) => Math.round((s.y + s.art.y + s.art.h) * 10) / 10);
}
for (const L of [wide5, mid5, phone3]) {
  const bottoms = artBottoms(L.slots);
  if (Math.max(...bottoms) - Math.min(...bottoms) > 0.2) fail(L.mode, 'art bottoms are not aligned');
  const lead = Math.max(L.slots[0].art.w, L.slots[0].art.h);
  L.slots.forEach((s, i) => {
    const scale = [1, 0.8, 0.7, 0.65][i];
    const side = Math.max(s.art.w, s.art.h);
    if (Math.abs(side / lead - scale) > 0.04) fail('scale', `#${i} ${(side / lead).toFixed(3)} ≠ ${scale}`);
  });
}
const phoneRows = artBottoms(phone5.slots);
const topRow = phoneRows.slice(0, 2);
const lowRow = phoneRows.slice(2);
if (Math.max(...topRow) - Math.min(...topRow) > 0.2 || Math.max(...lowRow) - Math.min(...lowRow) > 0.2) fail('phone quad', 'a row does not share a baseline');
if (Math.min(...lowRow) <= Math.max(...topRow) + 8) fail('phone quad', 'the two rows are not stacked');
{
  const lead = Math.max(phone5.slots[0].art.w, phone5.slots[0].art.h);
  phone5.slots.forEach((s, i) => {
    const scale = [1, 0.8, 0.7, 0.65][i];
    const side = Math.max(s.art.w, s.art.h);
    if (Math.abs(side / lead - scale) > 0.04) fail('phone scale', `#${i} ${(side / lead).toFixed(3)} ≠ ${scale}`);
  });
}

// Car screens share the prominence row. Width under 1000 keeps three; a wider short screen keeps four when they fit.
const cars: [string, number, number, number][] = [
  ['машина 800×480', 800, 480, 3],
  ['машина 960×540', 960, 540, 3],
  ['машина 1024×600', 1024, 600, 4],
  ['машина 1280×480', 1280, 480, 4],
];
for (const [name, w, h, cap] of cars) {
  const L = layoutInstruments(5, { w, h });
  if (L.mode !== 'prominence') fail(name, `mode ${L.mode}`);
  if (L.slots.some((s) => s.kind === 'more')) fail(name, 'chip drawn');
  if (L.slots.length < 1 || L.slots.length > cap) fail(name, `shown ${L.slots.length}, cap ${cap}`);
  if (L.slots.length > 1 && L.minArt < L.threshold - EPS) fail(name, `below readable ${L.minArt} < ${L.threshold}`);
  const bottoms = L.slots.map((s) => s.y + s.art.y + s.art.h);
  if (Math.max(...bottoms) - Math.min(...bottoms) > 0.2) fail(name, 'art bottoms are not aligned');
}
const rosterPhone = layoutInstruments(6, { w: 390, h: 520 }, { fitRoster: true });
const rosterDesk = layoutInstruments(6, { w: 800, h: 480 }, { fitRoster: true });
if (rosterPhone.slots.length !== 6 || rosterDesk.slots.length !== 6 || rosterPhone.hidden.length || rosterDesk.hidden.length) {
  fail('fit roster', `phone ${rosterPhone.slots.length} desk ${rosterDesk.slots.length}`);
}
// Desk interlude, 1440×900 column after the picture takes the lyric reserve. Same six, drawing at least 200.
const deskSpectacle = layoutInstruments(6, { w: 844, h: 552 }, { fitRoster: true, lines: 3, spectacle: true });
if (deskSpectacle.slots.length !== 6 || deskSpectacle.hidden.length || deskSpectacle.minArt < 200) {
  fail('desk spectacle', `shown ${deskSpectacle.slots.length} art ${deskSpectacle.minArt}`);
}
const asUniform = layoutInstruments(5, { w: 1440, h: 820 }, { uniform: true });
if (asUniform.mode !== 'prominence' || asUniform.slots.length !== 4 || asUniform.slots.some((s) => s.kind === 'more')) {
  fail('uniform', `${asUniform.mode} shown ${asUniform.slots.length}`);
}

// `ensemble` only when fewer than two instruments are named. It must not spend a named slot.
const between = {
  start: 0,
  end: 40,
  instruments: ['violin', 'ensemble', 'santur', 'bendir'],
  entries: [
    { key: 'violin', at: 1 },
    { key: 'ensemble', at: 2 },
    { key: 'santur', at: 3 },
    { key: 'bendir', at: 4 },
  ],
};
const wideCast = castAt(between, 10, 1440).map((m) => m.key).join(',');
if (wideCast !== 'violin,santur,bendir') fail('ensemble wide', wideCast);
const phoneCast = castAt(between, 1.2, 390).map((m) => m.key).join(',');
if (phoneCast !== 'violin,santur,bendir') fail('ensemble phone', phoneCast);
const phoneLater = castAt(between, 30, 390).map((m) => m.key).join(',');
if (phoneLater !== phoneCast) fail('ensemble phone', `roster changed inside the section: ${phoneLater}`);
const standing = castAt(between, 1.2, 390);
if (standing.some((m) => m.presence < 0.9)) fail('ensemble phone', 'a place is still empty after the cascade');
const santur = standing.find((m) => m.key === 'santur');
if (!santur || santur.playAt !== 3) fail('ensemble phone', `santur playAt ${santur?.playAt}`);
const quiet = plateLife(null, 'струнные ударные', 1.2, 3, false);
if (Math.abs(quiet.brightness - LIFE_DIM) > 0.02 || quiet.awake > 0.02 || quiet.hit > 0.02) fail('life dim', JSON.stringify(quiet));
const silent: AudioFeatures = { rate: 10, duration: 8, tracks: { loud: [0, 0, 0, 0], other: [0, 0, 0, 0], drums: [0, 0, 0, 0], vocals: [0, 0, 0, 0] } };
const rest = plateLife(silent, 'смычковые', 4, 1, false);
if (Math.abs(rest.brightness - LIFE_REST) > 0.03 || rest.hit > 0.02) fail('life rest', JSON.stringify(rest));
const loud: AudioFeatures = { rate: 10, duration: 8, tracks: { loud: [1, 1, 1, 1], other: [1, 1, 1, 1], drums: [0, 0, 1, 0], vocals: [0, 0, 0, 0] } };
const full = plateLife(loud, 'смычковые', 4, 1, false);
if (full.brightness < 0.95 || full.halo < 0.9) fail('life full', JSON.stringify(full));
const struck = plateLife(loud, 'ударные', 0.18, 0, false);
if (struck.hit < 0.2) fail('life hit', JSON.stringify(struck));
const reduced = plateLife(loud, 'ударные', 0.18, 0, true);
if (reduced.hit > 0.001 || reduced.halo > 0.001 || reduced.brightness < 0.5) fail('life reduced', JSON.stringify(reduced));
const again = plateLife(loud, 'ударные', 0.18, 0, false);
if (again.hit !== struck.hit || again.brightness !== struck.brightness) fail('life seek', 'a second read differed');
const heldPrev = { start: 0, end: 6, instruments: ['ney', 'violin', 'daf'] };
const heldNext = { start: 6, end: 20, instruments: ['oud', 'qanun', 'piano', 'flute'] };
const held = castAt(heldNext, 10, 1440, 'full', [heldPrev]).map((m) => m.key).join(',');
if (held !== 'ney,violin,daf') fail('hold', held);
const released = castAt({ start: 8, end: 20, instruments: ['oud'] }, 10, 800, 'full', [heldPrev]).map((m) => m.key).join(',');
if (released !== 'oud') fail('hold release', released);
const sharedPrev = { start: 0, end: 30, instruments: ['violin', 'santur', 'daf', 'ney'] };
const sharedNext = { start: 30, end: 60, instruments: ['oud', 'qanun', 'ney'] };
const shared = castAt(sharedNext, 30.2, 1440, 'full', [sharedPrev]);
if (shared.map((m) => m.key).join(',') !== 'oud,qanun,ney') fail('shared slots', shared.map((m) => m.key).join(','));
const ney = shared.find((m) => m.key === 'ney');
const oud = shared.find((m) => m.key === 'oud');
if (!ney || ney.presence < 0.95 || ney.at !== 0) fail('shared stay', `ney ${ney?.presence} at ${ney?.at}`);
if (!oud || oud.presence > 0.5 || oud.at !== 30) fail('shared enter', `oud ${oud?.presence}`);
// A key that left and comes back after the hold is a new entrance, not the old one still standing.
const returned = castAt({ start: 40, end: 60, instruments: ['ney'], entries: [{ key: 'ney', at: 42 }] }, 40.05, 800, 'full', [
  heldPrev,
  { start: 8, end: 40, instruments: ['oud'] },
]);
const back = returned[0];
if (!back || back.key !== 'ney' || back.at !== 40 || back.playAt !== 42 || back.presence > 0.3) {
  fail('return', `${back?.key} at ${back?.at} play ${back?.playAt} presence ${back?.presence}`);
}
const kept = castAt({ start: 0, end: 20, instruments: ['ney', 'ensemble'] }, 10, 800).map((m) => m.key).join(',');
if (kept !== 'ney,ensemble') fail('ensemble with one', kept);
const alone = castAt({ start: 0, end: 10, instruments: ['ensemble'] }, 5, 800).map((m) => m.key).join(',');
if (alone !== 'ensemble') fail('ensemble alone', alone);
const none = castAt({ start: 0, end: 10, instruments: [] }, 5, 800);
if (none.length) fail('empty stage', none.map((m) => m.key).join(','));

// Table: what the automatic choice does on typical screens
const screens: [string, number, number][] = [
  ['iPhone, портрет', 390, 600],
  ['iPhone SE', 320, 440],
  ['iPhone, альбом', 844, 330],
  ['iPad', 820, 900],
  ['ноутбук', 1200, 700],
  ['большой экран', 1600, 820],
  ['машина', 800, 480],
  ['машина', 960, 540],
  ['машина', 1024, 600],
  ['машина', 1280, 480],
];
console.log('\nАвтоматический выбор (режим · наименьшая гравюра, px · не показано):');
console.log(['экран'.padEnd(26), ...Array.from({ length: 8 }, (_, i) => String(i + 1).padEnd(19))].join(''));
for (const [name, w, h] of screens) {
  const row = [`${name} ${w}×${h}`.padEnd(26)];
  for (let n = 1; n <= 8; n++) {
    const L = layoutInstruments(n, { w, h });
    row.push(`${L.mode} ${L.minArt}${L.hidden.length ? ` +${L.hidden.length}` : ''}`.padEnd(19));
  }
  console.log(row.join(''));
}

// The lyric column. Every desktop width from 800 to 1920, with and without the margin note.
// The line box stays inside the stage, and the stage stays clear of the note panel.
let columns = 0;
const columnHeights = [641, 700, 800, 900, 1080];
for (let vw = 800; vw <= 1920; vw++) {
  for (const vh of columnHeights) {
    for (const noteOpen of [false, true]) {
      columns++;
      const f = stageFrame(vw, vh, noteOpen);
      const where = `${vw}×${vh}${noteOpen ? ' note' : ''}`;
      if (f.colLeft < 0 || f.colRight < 0 || f.stageW <= 0) fail(where, `negative column ${f.colLeft}+${f.stageW}+${f.colRight}`);
      if (f.colLeft + f.stageW + f.colRight !== vw) fail(where, `columns ${f.colLeft}+${f.stageW}+${f.colRight} ≠ ${vw}`);
      if (f.lyricW > f.stageW - f.padX * 2 + 0.01) fail(where, `lyric ${f.lyricW} wider than the stage content`);
      if (f.lyricW < Math.min(280, f.stageW - f.padX * 2)) fail(where, `lyric ${f.lyricW} too narrow`);
      const lyricRight = f.colLeft + (f.stageW + f.lyricW) / 2;
      if (f.marginNote) {
        if (f.noteW < 260) fail(where, `note ${f.noteW} too narrow`);
        const panelLeft = vw - f.panelInset - f.noteW;
        const stageRight = f.colLeft + f.stageW;
        if (stageRight > panelLeft - f.gap + 0.01) fail(where, `stage ${stageRight} enters the note at ${panelLeft}`);
        if (lyricRight > panelLeft - 8) fail(where, `lyric ends at ${lyricRight}, note starts at ${panelLeft}`);
      } else if (f.noteW !== 0) fail(where, `note width ${f.noteW} while the column is closed`);
      if (lyricRight > f.colLeft + f.stageW + 0.01) fail(where, `lyric ends at ${lyricRight} past the stage`);
    }
  }
}
const wideGroup = stageFrame(2560, 1440, true);
{
  const noteLeft = 2560 - wideGroup.noteRight - wideGroup.noteW;
  const stageRight = wideGroup.colLeft + wideGroup.stageW;
  const gap = noteLeft - stageRight;
  const group = wideGroup.stageW + gap + wideGroup.noteW;
  if (wideGroup.panelInset !== 16) fail('2560 group', `panel inset ${wideGroup.panelInset}`);
  if (wideGroup.colLeft + wideGroup.stageW + wideGroup.colRight !== 2560) fail('2560 group', 'columns do not add up');
  if (gap > 28 || gap < 12) fail('2560 group', `note gap ${gap}`);
  if (wideGroup.stageW > 920) fail('2560 group', `stage ${wideGroup.stageW} wider than the 920 column`);
  if (wideGroup.lyricW > 820) fail('2560 group', `measure ${wideGroup.lyricW} grew past the desk spread`);
  if (group < 1100 || group > 1400) fail('2560 group', `group ${group} is not the desk column`);
  if (Math.abs(wideGroup.colLeft - wideGroup.noteRight) > 2) fail('2560 group', 'the group is not centred');
}
const at1920 = stageFrame(1920, 1080, true);
if (at1920.panelInset !== 16) fail('1920 note', `inset ${at1920.panelInset}`);
for (const [vw, vh] of [[390, 852], [320, 700], [800, 480], [1280, 480]] as const) {
  const f = stageFrame(vw, vh, true);
  if (f.marginNote) fail(`${vw}×${vh}`, 'a short or narrow window opened the margin note');
  if (f.lyricW > f.stageW - f.padX * 2 + 0.01) fail(`${vw}×${vh}`, `lyric ${f.lyricW} overflows`);
  if (f.colLeft + f.stageW + f.colRight !== vw) fail(`${vw}×${vh}`, 'columns do not add up');
}

// Phone instrumental footnote. The measured frame (393×852, t = 70) put the
// comment through the first row of musician names. The footnote sits under
// the picture and must miss every caption.
{
  const hard = [
    { top: 203, bottom: 248 },
    { top: 216, bottom: 259 },
    { top: 349, bottom: 394 },
    { top: 362, bottom: 406 },
    { top: 414, bottom: 456 },
  ];
  const soft = [{ top: 509, bottom: 610 }];
  const top = footnoteTop({ hard, soft, under: 456, noteH: 36, ceiling: 82, limit: 684, maxTop: 596, pad: 8 });
  const band = top == null ? null : { top, bottom: top + 36 };
  const hits = band ? hard.filter((b) => b.bottom > band.top && b.top < band.bottom) : hard;
  if (top == null || Math.abs(top - 464) > 0.2 || hits.length) fail('phone footnote', `top ${top} hits ${hits.length}`);
  const phone = layoutInstruments(4, { w: 361, h: 300 }, { lines: 3 });
  const captions = phone.slots
    .filter((s) => s.kind === 'instrument')
    .map((s) => ({ top: s.y + s.label.y, bottom: s.y + s.label.y + s.label.h }));
  const under = Math.max(...captions.map((b) => b.bottom));
  const placed = footnoteTop({
    hard: captions,
    soft: [{ top: under + 50, bottom: under + 120 }],
    under,
    noteH: 36,
    ceiling: 0,
    limit: under + 220,
    maxTop: under + 180,
    pad: 8,
  });
  const overlaps = placed == null || placed < under - 0.5 || captions.some((b) => b.bottom > placed && b.top < placed + 36);
  if (overlaps) fail('phone footnote', `layout top ${placed} under ${under.toFixed(1)}`);
  cases += 2;
}

console.log(`\n${cases} раскладок проверено, колонок ${columns}, ошибок: ${failures}.`);
process.exit(failures ? 1 : 0);
