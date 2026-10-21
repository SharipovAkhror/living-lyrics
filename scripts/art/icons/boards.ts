/**
 * Studio boards for the Qalam family.
 * Usage: npx tsx scripts/art/icons/boards.ts
 * Writes HTML and PNG into work/t28-icons/own4/ (gitignored).
 * Also opens the song page at 393×852, light and dark, then stops the dev server.
 * Pass --fast to skip the song page. The 1× proof is shot at deviceScaleFactor 1.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { ICON_NAMES, type IconName, type Mark } from '../../../src/ui/icons/types';
import { QATT_ACROSS, QATT_EDGE, circle, nibFor, nibLozenge, nuqta, pt, qalamStroke } from './pen';
import { glyphAt, opticalFor, type Optical } from './qalam';

const OUT = 'work/t28-icons/own4';
const FAST = process.argv.includes('--fast');
const LABELS: Record<IconName, string> = {
  'chevron.left': 'Назад',
  'chevron.right': 'Вперёд',
  'chevron.down': 'Раскрыть',
  'chevron.up': 'Свернуть',
  xmark: 'Закрыть',
  play: 'Пуск',
  pause: 'Пауза',
  backward: 'Предыдущая строка',
  forward: 'Следующая строка',
  'character.bubble': 'Перевод',
  'book.closed': 'Пояснение',
  'music.note': 'Запись',
  'list.bullet': 'Весь текст',
  'slider.horizontal.3': 'Настройки',
  'square.grid.2x2': 'Инструменты',
  'book.pages': 'Методология',
  magnifyingglass: 'Поиск',
  'info.circle': 'О песне',
  flag: 'Не совпадает',
  'speaker.wave.2': 'Громкость',
  'square.and.arrow.down': 'Свой файл',
};

type Snap = { vb: number; sw: number; glyphs: Record<string, { off: Mark[]; on?: Mark[] }> };

let maskSeq = 0;

function pathTag(mark: Mark, fallback: number, cap: 'butt' | 'round'): string {
  const fill = mark.draw === 'fill' ? 'currentColor' : 'none';
  const stroke = mark.draw === 'stroke' ? 'currentColor' : 'none';
  const width = mark.draw === 'stroke' ? (mark.sw ?? fallback) : 0;
  const opacity = mark.opacity ?? 1;
  const rule = mark.rule ?? 'evenodd';
  const transform = mark.transform ? ` transform="${mark.transform}"` : '';
  const join = cap === 'butt' ? 'miter' : 'round';
  return `<path d="${mark.d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="${cap}" stroke-linejoin="${join}" fill-opacity="${mark.draw === 'fill' ? opacity : 1}" stroke-opacity="${mark.draw === 'stroke' ? opacity : 1}" fill-rule="${rule}"${transform}/>`;
}

/** Same mask as `src/ui/icons/index.tsx`. Glass keeps round caps; Qalam cuts are butt. */
function marks(list: Mark[], fallback: number, cap: 'butt' | 'round' = 'butt'): string {
  const holes = list.filter((mark) => mark.knock && mark.d);
  const body = list.filter((mark) => !mark.knock && mark.d).map((mark) => pathTag(mark, fallback, cap)).join('');
  if (holes.length === 0) return body;
  const id = `cut${maskSeq++}`;
  const punched = holes
    .map((mark) => {
      const transform = mark.transform ? ` transform="${mark.transform}"` : '';
      const rule = mark.rule ?? 'nonzero';
      return `<path d="${mark.d}" fill="#000" fill-rule="${rule}"${transform}/>`;
    })
    .join('');
  return `<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>${punched}</mask><g mask="url(#${id})">${body}</g>`;
}

function qalam(name: IconName, state: 'off' | 'on', px: number, optical?: Optical): string {
  const master = optical ?? opticalFor(px);
  const glyph = glyphAt(name, master);
  const body = state === 'on' && glyph.on ? glyph.on : glyph.off;
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" shape-rendering="geometricPrecision">${marks(body, 1.78)}</svg>`;
}

function glass(snap: Snap, name: IconName, px: number): string {
  const glyph = snap.glyphs[name];
  if (!glyph) return '';
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${snap.vb} ${snap.vb}" fill="none" shape-rendering="geometricPrecision">${marks(glyph.off, snap.sw, 'round')}</svg>`;
}

const FONTS = `
@font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: url('../../../node_modules/@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: url('../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212, U+FEFF; }
@font-face { font-family: 'Source Serif 4'; font-weight: 600; src: url('../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-cyrillic-600-normal.woff2') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: 'Source Serif 4'; font-weight: 600; src: url('../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212, U+FEFF; }
@font-face { font-family: 'Source Serif 4'; font-weight: 400; font-style: italic; src: url('../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-cyrillic-400-italic.woff2') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: 'Source Serif 4'; font-weight: 400; font-style: italic; src: url('../../../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212, U+FEFF; }
`;

const BASE = `
${FONTS}
:root {
  --bg: #efe6da; --ink: #1a140f; --ink-2: rgba(26,20,15,.62); --ink-3: rgba(26,20,15,.42);
  --line: rgba(26,20,15,.1); --tile: #f7f1e8; --accent: #5B3FC4; --on-accent: #fff;
  --field: #EBBAAF; --field-2: #AA6A90; --glass: rgba(255,255,255,.62);
  color-scheme: light;
}
.dark {
  --bg: #07060c; --ink: #f6f0e6; --ink-2: rgba(246,240,230,.7); --ink-3: rgba(246,240,230,.46);
  --line: rgba(246,240,230,.12); --tile: #14131a; --accent: #B3A2FF; --on-accent: #0b0b0d;
  --field: #3D38A5; --field-2: #70356F; --glass: rgba(255,255,255,.1);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
body { font-family: 'Inter Variable', sans-serif; font-weight: 450; color: var(--ink); -webkit-font-smoothing: antialiased; }
article { width: max-content; background: var(--bg); color: var(--ink); padding: 48px 56px 64px; }
h1 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 600; font-size: 42px; line-height: 1.05; margin: 0; letter-spacing: -0.02em; }
.lede { font-family: 'Source Serif 4', Georgia, serif; font-style: italic; font-weight: 400; font-size: 18px; color: var(--ink-2); margin: 10px 0 28px; max-width: 640px; }
h2 { font: 560 13px/1 'Inter Variable', sans-serif; letter-spacing: .04em; text-transform: none; margin: 28px 0 14px; color: var(--ink-2); }
.grid { display: grid; grid-template-columns: repeat(7, 168px); gap: 22px 18px; }
figure { margin: 0; }
.pair { display: flex; gap: 14px; align-items: flex-end; min-height: 72px; }
figcaption { margin-top: 8px; font-size: 13px; }
figcaption small { display: block; color: var(--ink-3); font-size: 11px; margin-top: 2px; }
.glassbar {
  margin-top: 8px; display: flex; gap: 28px; align-items: flex-end;
  padding: 28px 32px; border-radius: 28px; color: var(--ink);
  background:
    linear-gradient(180deg, var(--glass), var(--glass)),
    linear-gradient(120deg, var(--field), var(--field-2) 55%, #70356F);
  background-blend-mode: normal;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.45);
}
.dark .glassbar { box-shadow: inset 0 1px 0 rgba(255,255,255,.28); }
.gcell { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-2); }
.sizes table { border-collapse: collapse; }
.sizes th, .sizes td { padding: 8px 10px; text-align: center; vertical-align: bottom; font-weight: 450; font-size: 12px; color: var(--ink-2); }
.sizes th.name, .sizes td.name { text-align: left; color: var(--ink); font-size: 13px; min-width: 180px; }
.compare { display: grid; grid-template-columns: 200px 88px 36px 88px 88px; gap: 10px 16px; align-items: center; }
.compare .h { font-size: 12px; color: var(--ink-2); }
.arrow { color: var(--ink-3); font-family: 'Source Serif 4', serif; font-size: 22px; }
.player {
  width: 1107px; padding: 36px 42px 28px; border-radius: 72px; color: var(--ink);
  background:
    linear-gradient(180deg, var(--glass), var(--glass)),
    linear-gradient(160deg, var(--field) 0%, var(--field-2) 48%, #3D38A5 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.5), 0 30px 80px -36px rgba(26,20,15,.35);
}
.dark .player { box-shadow: inset 0 1px 0 rgba(255,255,255,.28), 0 30px 80px -28px rgba(0,0,0,.55); }
.scrub { display: flex; align-items: center; gap: 18px; font-variant-numeric: tabular-nums; font-size: 36px; }
.rail { flex: 1; height: 12px; border-radius: 99px; background: color-mix(in srgb, var(--ink) 16%, transparent); position: relative; }
.rail i { position: absolute; left: 0; top: 0; bottom: 0; width: 28%; border-radius: inherit; background: var(--accent); }
.flag { color: color-mix(in srgb, var(--ink) 58%, transparent); display: inline-flex; }
.transport { display: flex; align-items: center; justify-content: center; gap: 72px; margin: 18px 0 8px; color: color-mix(in srgb, var(--ink) 72%, transparent); }
.disc {
  width: 168px; height: 168px; border-radius: 50%; background: var(--accent); color: var(--on-accent);
  display: flex; align-items: center; justify-content: center;
}
.tabs { display: flex; justify-content: space-between; padding: 8px 12px 0; }
.tab { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 180px; color: color-mix(in srgb, var(--ink) 72%, transparent); font: 500 33px/1.15 'Inter Variable', sans-serif; }
.tab.on { color: var(--accent); }
.minis { display: flex; flex-wrap: wrap; gap: 14px 18px; max-width: 920px; }
.mini { margin: 0; }
.mini div { display: flex; gap: 6px; align-items: flex-end; }
.mini i { width: 8px; }
.mini figcaption { font-size: 11px; color: var(--ink-2); }
.bar1 { display: flex; gap: 8px; margin-top: 22px; }
.tab1 { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 72px; color: color-mix(in srgb, var(--ink) 72%, transparent); font: 500 13px/1.2 'Inter Variable', sans-serif; }
.tab1.on { color: var(--accent); }
.transport1 { display: flex; align-items: center; gap: 28px; margin-top: 18px; }
.disc1 { width: 64px; height: 64px; border-radius: 50%; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center; }
.flag1 { display: inline-flex; }
.dna { display: grid; grid-template-columns: 300px minmax(420px, 1fr) 280px; gap: 22px; align-items: stretch; }
.panel { background: var(--tile); border-radius: 22px; padding: 18px 18px 16px; }
.panel h3 { margin: 0 0 8px; font: 560 15px/1.2 'Inter Variable', sans-serif; }
.panel p, .note { margin: 12px 0 0; font-size: 14px; line-height: 1.45; color: var(--ink-2); max-width: 68em; }
.srow { display: flex; gap: 6px; align-items: flex-end; margin-top: 6px; }
.slabel { width: 86px; flex: none; font-size: 12px; line-height: 1.3; color: var(--ink-2); padding-bottom: 18px; }
.scell { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 112px; font-size: 11px; color: var(--ink-3); text-align: center; }
.stamps { display: flex; gap: 6px; }
.stamps .scell { width: 76px; }
.nibfig { display: block; }
`;

function page(id: string, dark: boolean, body: string): string {
  return `<article id="${id}" class="${dark ? 'dark' : ''}">${body}</article>`;
}

function specimen(dark: boolean): string {
  const cells = ICON_NAMES.map((name) => {
    return `<figure><div class="pair">${qalam(name, 'off', 56)}${qalam(name, 'on', 56)}</div><figcaption>${LABELS[name]}<small>${name}</small></figcaption></figure>`;
  }).join('');
  const bar = (['character.bubble', 'book.closed', 'list.bullet', 'music.note', 'flag', 'play'] as const)
    .map((name) => `<div class="gcell">${qalam(name, name === 'play' ? 'off' : 'on', 48)}<span>${LABELS[name]}</span></div>`)
    .join('');
  return page(
    dark ? 'specimen-dark' : 'specimen-light',
    dark,
    `<h1>Калам</h1><p class="lede">Своё перо. Слева покой, справа нажатие. Мастер 32 в 56 px: срез виден, контраст открыт.</p><div class="grid">${cells}</div><h2>На стекле, поле песни</h2><div class="glassbar">${bar}</div>`,
  );
}

function sizes(): string {
  const head = [16, 20, 24, 32, 48].map((n) => `<th>${n}</th>`).join('');
  const row = (dark: boolean) =>
    ICON_NAMES.map((name) => {
      const cells = [16, 20, 24, 32, 48].map((px) => `<td>${qalam(name, 'off', px)}</td>`).join('');
      return `<tr><td class="name">${LABELS[name]}</td>${cells}</tr>`;
    }).join('');
  const table = (dark: boolean) =>
    page(
      dark ? 'sizes-dark' : 'sizes-light',
      dark,
      `<h1>${dark ? 'Тёмная' : 'Светлая'}</h1><p class="lede">Покой на 16, 20, 24, 32 и 48. 48 берёт мастер 32.</p><div class="sizes"><table><thead><tr><th class="name"></th>${head}</tr></thead><tbody>${row(dark)}</tbody></table></div>`,
    );
  return table(false) + table(true);
}

function compare(snap: Snap): string {
  const rows = ICON_NAMES.map((name) => {
    return `<div>${LABELS[name]}<small style="display:block;color:var(--ink-3)">${name}</small></div><div>${glass(snap, name, 64)}</div><div class="arrow">→</div><div>${qalam(name, 'off', 64)}</div><div>${qalam(name, 'on', 64)}</div>`;
  }).join('');
  return page(
    'compare',
    false,
    `<h1>Стекло → Калам</h1><p class="lede">Слева прежний набор, покой. Дальше Калам: покой и нажатие. 64 px, мастер 32.</p><div class="compare"><div></div><div class="h">Стекло</div><div></div><div class="h">Покой</div><div class="h">Нажатие</div>${rows}</div>`,
  );
}

/** Tab bar and transport at the real pixel sizes, for the 1× naming test. */
function proof(dark: boolean): string {
  const tab = (name: IconName, label: string, on: boolean) =>
    `<div class="tab1${on ? ' on' : ''}">${qalam(name, on ? 'on' : 'off', 24)}<span>${label}</span></div>`;
  const names = ICON_NAMES.map(
    (name) =>
      `<figure class="mini"><div>${qalam(name, 'off', 20)}${qalam(name, 'on', 20)}<i></i>${qalam(name, 'off', 24)}${qalam(name, 'on', 24)}</div><figcaption>${LABELS[name]}</figcaption></figure>`,
  ).join('');
  return page(
    dark ? 'proof-dark' : 'proof-light',
    dark,
    `<h1>1× ${dark ? 'тёмная' : 'светлая'}</h1><p class="lede">Иконки в настоящий размер. Слева 20 покой и нажатие, справа 24. Ниже — вкладки 24 и плеер как на странице.</p>
    <div class="minis">${names}</div>
    <div class="bar1">${tab('character.bubble', 'Перевод', true)}${tab('book.closed', 'Пояснение', false)}${tab('list.bullet', 'Весь текст', false)}${tab('slider.horizontal.3', 'Настройки', false)}</div>
    <div class="transport1">${qalam('backward', 'off', 24)}<div class="disc1">${qalam('play', 'off', 28)}</div>${qalam('forward', 'off', 24)}<span class="flag1">${qalam('flag', 'off', 20)}</span></div>`,
  );
}

function player(dark: boolean): string {
  const tab = (name: IconName, label: string, on: boolean) =>
    `<div class="tab${on ? ' on' : ''}">${qalam(name, on ? 'on' : 'off', 72)}<span>${label}</span></div>`;
  return page(
    dark ? 'player-dark' : 'player-light',
    dark,
    `<h1>${dark ? 'Тёмная' : 'Светлая'}</h1><p class="lede">Плеер и вкладки в три раза. Поле — палитра «I Have Come Alive».</p>
    <div class="player">
      <div class="scrub"><span>1:12</span><div class="rail"><i></i></div><span>−8:28</span><span class="flag">${qalam('flag', 'off', 60)}</span></div>
      <div class="transport">${qalam('backward', 'off', 72)}<div class="disc">${qalam('play', 'off', 84)}</div>${qalam('forward', 'off', 72)}</div>
      <div class="tabs">${tab('character.bubble', 'Перевод', true)}${tab('book.closed', 'Пояснение', false)}${tab('list.bullet', 'Весь текст', false)}${tab('slider.horizontal.3', 'Настройки', false)}</div>
    </div>`,
  );
}

/** The nib itself, at the 32-master ratio, with the 35° edge drawn past it. */
function nibPicture(): string {
  const sample = nibFor(32, 1.65);
  const k = 148 / sample.broad;
  const e = QATT_EDGE;
  const a = QATT_ACROSS;
  const cx = 118;
  const cy = 146;
  const corner = (su: number, sv: number) => {
    const u = su * sample.broad * k * 0.5;
    const v = sv * sample.hair * k * 0.5;
    return `${(cx + e.x * u + a.x * v).toFixed(2)},${(cy + e.y * u + a.y * v).toFixed(2)}`;
  };
  const pts = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)].join(' ');
  const reach = 112;
  const arcR = 92;
  const ex = cx + e.x * reach;
  const ey = cy + e.y * reach;
  const bx = cx + e.x * arcR;
  const by = cy + e.y * arcR;
  const mid = (17.5 * Math.PI) / 180;
  const lx = cx + Math.cos(mid) * (arcR + 14);
  const ly = cy + Math.sin(mid) * (arcR + 14);
  return `<svg class="nibfig" width="280" height="268" viewBox="0 0 280 268" fill="none" shape-rendering="geometricPrecision"><line x1="${cx}" y1="${cy}" x2="${cx + reach}" y2="${cy}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.25"/><line x1="${cx}" y1="${cy}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.25"/><path d="M${cx + arcR} ${cy}A${arcR} ${arcR} 0 0 1 ${bx.toFixed(2)} ${by.toFixed(2)}" stroke="currentColor" stroke-width="1.4" fill="none"/><polygon points="${pts}" fill="currentColor"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="currentColor" font-family="Source Serif 4, Georgia, serif" font-size="18">35°</text></svg>`;
}

function directionRow(optical: 20 | 32, title: string): string {
  const sw = optical === 20 ? 2.3 : 1.65;
  const nib = nibFor(optical, sw);
  const dirs = [
    { deg: 35, label: 'вдоль среза' },
    { deg: 125, label: 'поперёк' },
    { deg: 0, label: 'горизонталь' },
    { deg: 90, label: 'вертикаль' },
  ];
  const cells = dirs
    .map((dir) => {
      const rad = (dir.deg * Math.PI) / 180;
      const len = 14.4;
      const dx = Math.cos(rad) * (len / 2);
      const dy = Math.sin(rad) * (len / 2);
      const d = qalamStroke([pt(12 - dx, 12 - dy), pt(12 + dx, 12 + dy)], nib);
      return `<div class="scell"><svg width="112" height="112" viewBox="0 0 24 24" fill="none" shape-rendering="geometricPrecision"><path d="${d}" fill="currentColor" fill-rule="nonzero"/></svg><span>${dir.label}</span></div>`;
    })
    .join('');
  return `<div class="srow"><div class="slabel">${title}</div>${cells}</div>`;
}

function stamp(d: string, label: string): string {
  return `<div class="scell"><svg width="72" height="72" viewBox="0 0 24 24" fill="none" shape-rendering="geometricPrecision"><path d="${d}" fill="currentColor" fill-rule="nonzero"/></svg><span>${label}</span></div>`;
}

/** DNA board. Strokes come from the same pen functions as the glyphs. */
function signature(): string {
  const shown = [
    'chevron.right',
    'xmark',
    'play',
    'pause',
    'character.bubble',
    'book.closed',
    'list.bullet',
    'slider.horizontal.3',
    'square.grid.2x2',
    'music.note',
    'info.circle',
    'magnifyingglass',
  ] as const;
  const glyphs = shown
    .map(
      (name) =>
        `<figure class="mini"><div>${qalam(name, 'off', 20)}${qalam(name, 'off', 48)}</div><figcaption>${LABELS[name]}</figcaption></figure>`,
    )
    .join('');
  const pressed = (['chevron.right', 'character.bubble', 'square.grid.2x2', 'pause', 'play'] as const)
    .map(
      (name) =>
        `<figure class="mini"><div>${qalam(name, 'off', 48)}${qalam(name, 'on', 48)}</div><figcaption>${LABELS[name]}</figcaption></figure>`,
    )
    .join('');
  return page(
    'signature',
    false,
    `<h1>Подпись</h1><p class="lede">Одно перо на каждый знак. Срез 35° — тот же угол, что штрих гравюр. На 16 и 20 контраст тихий, на 32 перо читается. Точка — нукта.</p>
    <div class="dna">
      <div class="panel"><h3>Угол</h3>${nibPicture()}<p>Длинная грань — срез. Ею кончается каждый открытый штрих. Отдельной фаски нет: конец и есть перо.</p></div>
      <div class="panel"><h3>Контраст</h3>${directionRow(20, 'мастер 20')}${directionRow(32, 'мастер 32')}<p>Ход вдоль среза тонкий, ход поперёк шире. Горизонталь и вертикаль лежат между ними: 35° близко к 45°. На мастере 20 отношение около 1,18, тонкий ход не тоньше 1,6 px. На мастере 32 отношение около 1,86.</p></div>
      <div class="panel"><h3>Нукта</h3><div class="stamps">${stamp(nuqta(12, 12, 5.4), 'нукта')}${stamp(nibLozenge(12, 12, 6.2, 3.4), 'угол пера')}${stamp(circle(12, 12, 5.4), 'круг')}</div><p>Нукта — печать на 45°. Поворот на угол пера сливал бы её со срезом, поэтому точкой он не служит. Круг в семействе не ставится.</p></div>
    </div>
    <h2>Те же знаки в 20 и в 48</h2>
    <p class="note">Слева настоящие 20 px, справа 48 px с мастера 32. Силуэт один. На крупном размере контраст и лишние нукты читаются, на мелком остаётся имя знака.</p>
    <div class="minis">${glyphs}</div>
    <h2>Нажатие, мастер 32 в 48 px</h2>
    <p class="note">Слева покой, справа нажатие. Черта шире тем же пером. Пластина заливается, край остаётся, письмо вырезается. Сплошное тело чуть крупнее. У пуска верхняя грань уже почти совпадает со срезом, поэтому перо видно на основании, а не второй фаской на вершине. Остриё скруглено как угол пластины.</p>
    <div class="minis">${pressed}</div>`,
  );
}

function stop(proc: ChildProcess): void {
  if (!proc.pid) return;
  spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
}

async function startVite(): Promise<ChildProcess> {
  const proc = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5174', '--strictPort', '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
  });
  const url = 'http://127.0.0.1:5174/';
  const start = Date.now();
  while (Date.now() - start < 40000) {
    if (proc.exitCode != null) break;
    try {
      const res = await fetch(url);
      if (res.status < 500) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  stop(proc);
  throw new Error(`vite did not start\n${buf}`);
}

async function shootPhone(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  const proc = await startVite();
  try {
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [2, 1] as const) {
        const context = await browser.newContext({
          viewport: { width: 393, height: 852 },
          deviceScaleFactor: scale,
          isMobile: true,
          hasTouch: true,
          colorScheme: theme,
        });
        await context.addInitScript((value) => {
          localStorage.setItem(
            'living-lyrics.settings.v2',
            JSON.stringify({ theme: value, showTranslation: true, showComment: false, motion: 'off' }),
          );
        }, theme);
        const page = await context.newPage();
        await page.goto('http://127.0.0.1:5174/song/i-have-come-alive', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.player .ll-ico', { timeout: 20000 });
        await page.waitForTimeout(500);
        const file = scale === 1 ? `page-1x-${theme}.png` : `phone-${theme}.png`;
        await page.screenshot({ path: `${OUT}/${file}` });
        await context.close();
      }
    }
  } finally {
    stop(proc);
  }
}

async function shoot(page: Page, id: string, file: string): Promise<void> {
  await page.locator(`#${id}`).screenshot({ path: `${OUT}/${file}` });
}

async function main(): Promise<void> {
  const snap = JSON.parse(readFileSync('scripts/art/icons/glass-snapshot.json', 'utf8')) as Snap;
  const missing = ICON_NAMES.filter((name) => !snap.glyphs[name]);
  if (missing.length) throw new Error(`glass snapshot missing ${missing.join(', ')}`);

  mkdirSync(OUT, { recursive: true });
  const html = `<!doctype html><meta charset="utf-8"><title>Калам</title><style>${BASE}</style>${signature()}${specimen(false)}${specimen(true)}${player(false)}${player(true)}${sizes()}${compare(snap)}${proof(false)}${proof(true)}`;
  const file = `${OUT}/boards.html`;
  writeFileSync(file, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    await shoot(page, 'signature', 'signature.png');
    await shoot(page, 'specimen-light', 'specimen-light.png');
    await shoot(page, 'specimen-dark', 'specimen-dark.png');
    await shoot(page, 'player-light', 'player-3x-light.png');
    await shoot(page, 'player-dark', 'player-3x-dark.png');
    await shoot(page, 'sizes-light', 'sizes-light.png');
    await shoot(page, 'sizes-dark', 'sizes-dark.png');
    await shoot(page, 'compare', 'compare.png');
    await page.close();

    const one = await browser.newPage({ viewport: { width: 980, height: 1400 }, deviceScaleFactor: 1 });
    await one.goto(pathToFileURL(file).href);
    await one.evaluate(() => document.fonts.ready);
    await shoot(one, 'proof-light', 'proof-1x-light.png');
    await shoot(one, 'proof-dark', 'proof-1x-dark.png');
    await one.close();

    if (!FAST) await shootPhone(browser);
  } finally {
    await browser.close();
  }
}

await main();
