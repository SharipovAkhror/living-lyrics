/**
 * Phone stage geometry against a stored main expectation.
 *
 * The review frames are npm run shots: Chromium, 393×852, touch, DPR 3.
 * Spare phone word slots used to stay in the flex line (`display: contents`
 * beat the hidden attribute), so this checks the current block, the gap
 * above the translation, and that those slots are out of the layout.
 * At 0.3 s the comment may still be opening (stage 576 → 512) and the error
 * card may be absent, so that frame accepts either centre and skips `clear`.
 * At 1.5 s, 5 s and after a seek a lyric line must sit on the centre of its box.
 *
 *   npx vite --port 5199 --strictPort --host 127.0.0.1
 *   node scripts/perf/stage-geometry.mjs --url http://127.0.0.1:5199
 *   node scripts/perf/stage-geometry.mjs --url http://127.0.0.1:5201 --write scripts/perf/stage-geometry.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { flag } from './lib.mjs';

const args = process.argv.slice(2);
const url = flag(args, '--url', 'http://127.0.0.1:5173');
const writePath = flag(args, '--write', '');
const expectPath = flag(args, '--expect', 'scripts/perf/stage-geometry.json');
const songs = flag(args, '--songs', 'karitas,one,i-have-come-alive,alive').split(',');
const schemes = ['dark', 'light'];

const shots = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
};

function sample() {
  const num = (n) => Math.round(n * 10) / 10;
  const stage = document.querySelector('.scene-stage');
  const alert = document.querySelector('.player-alert');
  const marked = document.querySelector('.fb--line.is-current');
  const blocks = [...document.querySelectorAll('.fb--line, .fb--inst')];
  let cur = marked;
  if (!cur) {
    let bestOp = -1;
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      if (r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
      const op = parseFloat(getComputedStyle(el).opacity);
      if (op > bestOp) {
        bestOp = op;
        cur = el;
      }
    }
  }
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const stageBox = box(stage);
  const alertBox = box(alert);
  const curBox = box(cur);
  const orig = cur?.querySelector('.fb-orig');
  const tr = cur?.querySelector('.fb-tr');
  const origBox = box(orig);
  const trBox = box(tr);
  const hidden = cur ? [...cur.querySelectorAll('.w-wrap[hidden]')] : [];
  const hiddenLaidOut = hidden.filter((el) => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== 'none' || r.height > 0;
  }).length;
  const text = (orig?.innerText || cur?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const next = [...document.querySelectorAll('.fb--line, .fb--inst')].find((el) => {
    if (el === cur) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && stageBox && r.y > (curBox?.y ?? 0) + 8;
  });
  const nextBox = box(next);
  return {
    ready: !!curBox && curBox.h > 0,
    kind: cur?.classList.contains('fb--inst') ? 'inst' : cur ? 'line' : 'none',
    text,
    stageH: stageBox ? num(stageBox.h) : null,
    relTop: stageBox && curBox ? num(curBox.y - stageBox.y) : null,
    blockH: curBox ? num(curBox.h) : null,
    origH: origBox ? num(origBox.h) : null,
    font: orig ? num(parseFloat(getComputedStyle(orig).fontSize)) : null,
    gap: origBox && trBox && trBox.h > 0 ? num(trBox.y - (origBox.y + origBox.h)) : null,
    clear: !!(origBox && alertBox && origBox.y >= alertBox.y + alertBox.h - 1),
    nextRel: stageBox && nextBox ? num(nextBox.y - stageBox.y) : null,
    hidden: hidden.length,
    hiddenLaidOut,
  };
}

async function shot(page, song, scheme, when) {
  const row = await page.evaluate(sample);
  return { song, scheme, when, ...row };
}

async function openAt(page, song, t) {
  const target = `${url.replace(/\/$/, '')}/song/${song}?t=${t}`;
  await page.goto(target, { waitUntil: 'commit', timeout: 45000 });
  await page.waitForFunction(() => performance.now() >= 300);
}

async function seek(page) {
  const track = page.locator('.scrub-track');
  await track.focus();
  for (let i = 0; i < 16; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
}

const browser = await chromium.launch();
const rows = [];
for (const scheme of schemes) {
  const context = await browser.newContext({ ...shots, colorScheme: scheme });
  const page = await context.newPage();
  for (const song of songs) {
    await openAt(page, song, 50);
    rows.push(await shot(page, song, scheme, '0.3'));
    await page.waitForFunction(() => performance.now() >= 1500);
    await page.waitForSelector('.scene-stage', { timeout: 15000 });
    rows.push(await shot(page, song, scheme, '1.5'));
    await page.waitForFunction(() => performance.now() >= 5000);
    rows.push(await shot(page, song, scheme, '5'));
    await seek(page);
    rows.push(await shot(page, song, scheme, 'seek'));
  }
  await context.close();
}
await browser.close();

if (writePath) {
  writeFileSync(writePath, `${JSON.stringify({ viewport: shots.viewport, rows }, null, 2)}\n`);
  process.stdout.write(`wrote ${rows.length} rows to ${writePath}\n`);
  process.exit(0);
}

function near(a, b, tol) {
  if (a == null && b == null) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return Math.abs(a - b) <= tol;
}

// Where layoutAt puts a block whose centre is 36% down the stage.
function centerTop(stageH, blockH) {
  if (typeof stageH !== 'number' || typeof blockH !== 'number') return null;
  return Math.round((stageH * 0.36 - blockH / 2) * 10) / 10;
}

const expect = JSON.parse(readFileSync(expectPath, 'utf8'));
const byKey = new Map(expect.rows.map((row) => [`${row.song}|${row.scheme}|${row.when}`, row]));
let failed = 0;
const POS = 4;
const FONT = 0.6;
// Comment opens and the stage falls 576 → 512. At 0.3 s the transform can
// still be the centre of the taller stage. The error card can also be absent,
// so `clear` is false for both reasons. Neither is the spare-slot bug
// (that one clamps top to 8 and inflates the original by a blank line).
const PRE_COMMENT_STAGE = 576;

for (const row of rows) {
  const key = `${row.song}|${row.scheme}|${row.when}`;
  const want = byKey.get(key);
  const problems = [];
  if (!want) problems.push('no expectation');
  else {
    if (row.text !== want.text) problems.push(`text «${row.text}» ≠ «${want.text}»`);
    if (row.kind !== want.kind) problems.push(`kind ${row.kind} ≠ ${want.kind}`);
    const stageOk = near(row.stageH, want.stageH, POS)
      || (row.when === '0.3' && near(row.stageH, PRE_COMMENT_STAGE, POS) && near(want.stageH, 512, POS));
    if (!stageOk) problems.push(`stage ${row.stageH} ≠ ${want.stageH}`);
    let topShift = null;
    if (!near(row.relTop, want.relTop, POS)) {
      const here = centerTop(row.stageH, row.blockH);
      const before = centerTop(PRE_COMMENT_STAGE, row.blockH);
      const raced = row.when === '0.3' && row.kind === 'line'
        && (near(row.relTop, here, POS) || near(row.relTop, before, POS));
      if (raced) topShift = row.relTop - want.relTop;
      else problems.push(`top ${row.relTop} ≠ ${want.relTop}`);
    }
    if (!near(row.blockH, want.blockH, POS)) problems.push(`block ${row.blockH} ≠ ${want.blockH}`);
    if (!near(row.origH, want.origH, POS)) problems.push(`orig ${row.origH} ≠ ${want.origH}`);
    if (!near(row.gap, want.gap, POS)) problems.push(`gap ${row.gap} ≠ ${want.gap}`);
    if (!near(row.font, want.font, FONT)) problems.push(`font ${row.font} ≠ ${want.font}`);
    const nextOk = near(row.nextRel, want.nextRel, POS)
      || (topShift != null && typeof want.nextRel === 'number' && near(row.nextRel, want.nextRel + topShift, POS));
    if (!nextOk) problems.push(`next ${row.nextRel} ≠ ${want.nextRel}`);
    // After the first frame the card is up. A line under it is the regression.
    if (row.when !== '0.3' && row.clear !== want.clear) problems.push(`clear ${row.clear} ≠ ${want.clear}`);
    if (row.ready !== want.ready) problems.push(`ready ${row.ready} ≠ ${want.ready}`);
    if (row.kind === 'line' && row.when !== '0.3') {
      const here = centerTop(row.stageH, row.blockH);
      if (!near(row.relTop, here, POS)) problems.push(`top ${row.relTop} is not the centre ${here}`);
    }
  }
  if (row.hiddenLaidOut) problems.push(`${row.hiddenLaidOut} hidden slots still laid out`);
  const mark = problems.length ? 'FAIL' : 'ok';
  if (problems.length) failed += 1;
  process.stdout.write(`${mark} ${key} stage=${row.stageH} top=${row.relTop} h=${row.blockH} orig=${row.origH} gap=${row.gap} font=${row.font}${problems.length ? ` — ${problems.join('; ')}` : ''}\n`);
}

if (failed) {
  process.stderr.write(`${failed} geometry rows differ from main\n`);
  process.exit(1);
}
process.stdout.write(`${rows.length} rows match main\n`);
