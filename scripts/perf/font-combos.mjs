/**
 * Distinct (font-size, weight, shadow, filter) combos on the phone stage.
 *
 *   npx vite --port 5199 --strictPort --host 127.0.0.1
 *   node scripts/perf/font-combos.mjs --url http://127.0.0.1:5199
 */
import { webkit } from 'playwright';
import { flag, phoneContext } from './lib.mjs';

const args = process.argv.slice(2);
const url = flag(args, '--url', 'http://127.0.0.1:4179');
const songs = flag(args, '--songs', 'karitas,one,i-have-come-alive').split(',');

function collect() {
  const stage = document.querySelector('.scene-stage');
  if (!stage) return { ready: false };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && parseFloat(s.opacity) > 0.02;
  };
  const combos = [];
  const seen = new Set();
  for (const el of stage.querySelectorAll('*')) {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText || !visible(el)) continue;
    const s = getComputedStyle(el);
    const row = {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      textShadow: s.textShadow,
      filter: s.filter,
      willChange: s.willChange,
      font: s.fontFamily.split(',')[0].replace(/"/g, ''),
      tag: el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : el.tagName,
    };
    const key = `${row.fontSize}|${row.fontWeight}|${row.textShadow}|${row.filter}|${row.font}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push(row);
  }
  const lines = [...stage.querySelectorAll('.fb--line')].map((el) => {
    const s = getComputedStyle(el);
    return {
      transform: s.transform,
      willChange: s.willChange,
      filter: s.filter,
      textShadow: s.textShadow,
      hidden: el.hasAttribute('hidden'),
    };
  });
  const vars = {};
  const root = getComputedStyle(document.documentElement);
  for (const name of ['--lyric-latin', '--lyric-arab', '--lyric-tr', '--lyric-note']) {
    vars[name] = root.getPropertyValue(name).trim();
  }
  const arts = [...document.querySelectorAll('.ist-art, .ist-art-mount')].slice(0, 6).map((el) => {
    const s = getComputedStyle(el);
    return { filter: s.filter, willChange: s.willChange, transform: s.transform.slice(0, 80) };
  });
  return {
    ready: true,
    arts,
    stageH: Math.round(stage.getBoundingClientRect().height),
    innerH: window.innerHeight,
    phone: document.documentElement.dataset.phone || '',
    vars,
    combos,
    lines,
    willOnLines: lines.filter((l) => l.willChange && l.willChange !== 'auto').length,
    translateZ: lines.filter((l) => /matrix3d|translate3d/.test(l.transform)).length,
  };
}

const browser = await webkit.launch();
const context = await browser.newContext(phoneContext());
const page = await context.newPage();
for (const song of songs) {
  await page.goto(`${url.replace(/\/$/, '')}/song/${song}?t=50`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.scene-stage', { timeout: 20000 });
  await page.waitForTimeout(1600);
  const marks = [await page.evaluate(collect)];
  const track = page.locator('.scrub-track');
  const box = await track.boundingBox();
  if (box) {
    for (const frac of [0.15, 0.4, 0.7, 0.9]) {
      await track.click({ position: { x: Math.max(8, box.width * frac), y: box.height / 2 }, force: true });
      await page.waitForTimeout(500);
      marks.push(await page.evaluate(collect));
    }
  }
  const union = new Map();
  let stageH = null;
  let vars = null;
  let willOnLines = 0;
  let translateZ = 0;
  let lineSamples = 0;
  for (const mark of marks) {
    if (!mark?.ready) continue;
    stageH = mark.stageH;
    vars = mark.vars;
    willOnLines = Math.max(willOnLines, mark.willOnLines);
    translateZ = Math.max(translateZ, mark.translateZ);
    lineSamples += mark.lines.length;
    for (const row of mark.combos) {
      union.set(`${row.fontSize}|${row.fontWeight}|${row.textShadow}|${row.filter}|${row.font}`, row);
    }
  }
  process.stdout.write(`\n${song} stage=${stageH} inner=${marks.find((m) => m?.ready)?.innerH} phone=${marks.find((m) => m?.ready)?.phone} vars=${JSON.stringify(vars)} lineSamples=${lineSamples} willOnLines=${willOnLines} translate3dLines=${translateZ}\n`);
  for (const row of union.values()) {
    process.stdout.write(`  ${row.fontSize} w${row.fontWeight} shadow=${row.textShadow} filter=${row.filter} ${row.font} <${row.tag}>\n`);
  }
  process.stdout.write(`  combos ${union.size}\n`);
  const sample = marks.find((m) => m?.ready);
  if (sample?.lines?.[0]) process.stdout.write(`  line0 ${JSON.stringify(sample.lines[0])}\n`);
  if (sample?.arts?.length) process.stdout.write(`  art ${JSON.stringify(sample.arts)}\n`);
}
await browser.close();
