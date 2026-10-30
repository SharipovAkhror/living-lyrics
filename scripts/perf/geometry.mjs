// Geometry of the frozen 12 design sheets, plus a pixel diff against round 18.
// The diff is a report: mean channel difference above 2 is «changed», not a failure.
// node scripts/perf/geometry.mjs --base http://127.0.0.1:4176 [--write]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { installResolvedAudio, prepareAudio } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const base = args.base || 'http://127.0.0.1:4176';
const write = args.write === 'true';
const baselinePath = 'tests/baselines/geometry.json';
const acceptedDir = 'work/studio/sheets18';
const POS = 4;
const SIZE = 0.04;

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const phone = (width, height, dsf) => ({
  viewport: { width, height },
  deviceScaleFactor: dsf,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
});

/** Contact sheets plus the round-22 desktop sizes. Theme is the one in the name. */
const SHEETS = [
  { id: 'iphone-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: phone(393, 852, 3), page: 'song' },
  { id: 'iphone-light-song', scheme: 'light', path: '/song/karitas?t=42', device: phone(393, 852, 3), page: 'song' },
  { id: 'iphone-dark-library', scheme: 'dark', path: '/', device: phone(393, 852, 3), page: 'library' },
  { id: 'iphone-light-library', scheme: 'light', path: '/', device: phone(393, 852, 3), page: 'library' },
  { id: 'se-light-song', scheme: 'light', path: '/song/karitas?t=42', device: phone(320, 568, 2), page: 'song' },
  { id: 'se375-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: phone(375, 667, 2), page: 'song' },
  { id: 'land-15-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: phone(852, 393, 3), page: 'song' },
  {
    id: 'ipad-light-song',
    scheme: 'light',
    path: '/song/karitas?t=42',
    device: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    page: 'song',
  },
  { id: 'desk-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'desk-light-library', scheme: 'light', path: '/', device: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, page: 'library' },
  { id: 'wide-dark-library', scheme: 'dark', path: '/', device: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 }, page: 'library' },
  { id: 'wide-light-song', scheme: 'light', path: '/song/karitas?t=42', device: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'w1680-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: { viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'w1680-light-song', scheme: 'light', path: '/song/karitas?t=42', device: { viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'fhd-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'fhd-light-song', scheme: 'light', path: '/song/karitas?t=42', device: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'wide-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'ultra-dark-song', scheme: 'dark', path: '/song/karitas?t=42', device: { viewport: { width: 3440, height: 1440 }, deviceScaleFactor: 1 }, page: 'song' },
  { id: 'ultra-light-song', scheme: 'light', path: '/song/karitas?t=42', device: { viewport: { width: 3440, height: 1440 }, deviceScaleFactor: 1 }, page: 'song' },
];

function measureInPage() {
  const box = (selector) => {
    const nodes = [...document.querySelectorAll(selector)];
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (!(Number(style.opacity) > 0.05)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return null;
  };
  return {
    header: box('.topbar, .lib-head'),
    line: box('.fb--line.is-current .fb-orig'),
    translation: box('.fb--line.is-current .fb-tr'),
    note: box('.note-card, .comment.is-margin'),
    player: box('.player'),
    sheet: box('.sheet'),
    shelf: box('.lib-shelf'),
  };
}

function sameBox(next, prev) {
  if (!next && !prev) return true;
  if (!next || !prev) return false;
  if (Math.abs(next.x - prev.x) > POS || Math.abs(next.y - prev.y) > POS) return false;
  if (Math.abs(next.w - prev.w) / Math.max(prev.w, 1) > SIZE) return false;
  if (Math.abs(next.h - prev.h) / Math.max(prev.h, 1) > SIZE) return false;
  return true;
}

async function meanChannel(accepted, shot) {
  const size = { width: 160, height: 90, fit: 'fill' };
  const left = await sharp(accepted).resize(size).removeAlpha().raw().toBuffer();
  const right = await sharp(shot).resize(size).removeAlpha().raw().toBuffer();
  const n = Math.min(left.length, right.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(left[i] - right[i]);
  return n ? sum / n : 99;
}

function songSlugs() {
  return readdirSync('content/songs')
    .filter((name) => existsSync(`content/songs/${name}/song.json`))
    .sort();
}

function songDurations() {
  const map = {};
  for (const slug of readdirSync('content/songs')) {
    const file = `content/songs/${slug}/song.json`;
    if (!existsSync(file)) continue;
    const song = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof song.duration === 'number' && song.duration > 1) map[slug] = song.duration;
  }
  return map;
}

async function installSilence(context) {
  const map = songDurations();
  const cache = new Map();
  await installResolvedAudio(context, (url) => {
    const slug = /\/audio\/([^/]+)\//.exec(url)?.[1] || '';
    const seconds = map[slug];
    if (!seconds) return null;
    const key = String(seconds);
    if (!cache.has(key)) cache.set(key, prepareAudio(seconds, 'work/studio/silence'));
    return cache.get(key);
  });
}

const browser = await chromium.launch();
const sheets = {};
const pixel = [];
const libraryGaps = [];
const slugs = songSlugs();
for (const sheet of SHEETS) {
  const context = await browser.newContext({ ...sheet.device, colorScheme: sheet.scheme });
  await installSilence(context);
  const page = await context.newPage();
  await page.goto(base + sheet.path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('.fb--line, .lib-shelf'), { timeout: 8000 });
  await page.waitForTimeout(600);
  const measured = await page.evaluate(measureInPage);
  sheets[sheet.id] = { viewport: [sheet.device.viewport.width, sheet.device.viewport.height], ...measured };
  if (sheet.page === 'library') {
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href^="/song/"]')].map((el) => el.getAttribute('href') || ''));
    const missing = slugs.filter((slug) => !hrefs.some((href) => href === `/song/${slug}` || href.startsWith(`/song/${slug}?`)));
    if (missing.length) libraryGaps.push(`${sheet.id} missing ${missing.join(', ')} (${slugs.length} songs)`);
  }
  const file = `${acceptedDir}/round18-${sheet.id}.png`;
  const shot = await page.screenshot({ type: 'png', fullPage: sheet.page === 'library' });
  if (existsSync(file)) {
    const mean = await meanChannel(file, shot);
    pixel.push({ id: sheet.id, mean, changed: mean > 2 });
  } else {
    pixel.push({ id: sheet.id, mean: null, changed: false, missing: true });
  }
  await context.close();
}
await browser.close();

console.log('\nPixel diff against sheets18 (mean channel, > 2 is changed, not a failure):');
for (const row of pixel) {
  if (row.missing) console.log(`  ${row.id}  no accepted sheet`);
  else console.log(`  ${row.id}  ${row.mean.toFixed(2)}${row.changed ? '  changed' : ''}`);
}

const keys = ['header', 'line', 'translation', 'note', 'player', 'sheet', 'shelf'];
if (write || !existsSync(baselinePath)) {
  if (!write && !existsSync(baselinePath)) {
    console.error(`\nFAIL geometry: ${baselinePath} is missing. Pass --write to record the accepted boxes.`);
    process.exit(1);
  }
  mkdirSync('tests/baselines', { recursive: true });
  const body = { tolerances: { positionPx: POS, sizeRatio: SIZE }, sheets };
  writeFileSync(baselinePath, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`\nwrote ${baselinePath}`);
  if (write) process.exit(0);
}

const saved = JSON.parse(readFileSync(baselinePath, 'utf8'));
const problems = [];
for (const sheet of SHEETS) {
  const next = sheets[sheet.id];
  const prev = saved.sheets?.[sheet.id];
  if (!prev) {
    problems.push(`${sheet.id} missing from the baseline`);
    continue;
  }
  for (const key of keys) {
    if (!sameBox(next[key], prev[key])) {
      problems.push(`${sheet.id} ${key} ${JSON.stringify(prev[key])} -> ${JSON.stringify(next[key])}`);
    }
  }
}
if (libraryGaps.length) {
  console.error(`\nFAIL geometry library ${libraryGaps.length}`);
  for (const row of libraryGaps) console.error(`  ${row}`);
}
if (problems.length) {
  console.error(`\nFAIL geometry ${problems.length}`);
  for (const row of problems) console.error(`  ${row}`);
}
if (problems.length || libraryGaps.length) process.exit(1);
console.log(`\nPASS geometry ${SHEETS.length} sheets`);
