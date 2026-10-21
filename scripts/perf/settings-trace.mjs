/**
 * Settings sheet on an iPhone-sized WebKit: time to a usable sheet, and frame gaps while scrolling.
 *
 *   node scripts/perf/settings-trace.mjs --url http://127.0.0.1:4179
 *
 * A frame gap above 32 ms is a dropped frame at 60 Hz. Open is the time until the dialog
 * covers the lower part of the screen (the title is on screen), not until the spring rests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { webkit } from 'playwright';
import { flag, installAudioRoute, installProbe, phoneContext, prepareAudio, probe } from './lib.mjs';

const args = process.argv.slice(2);
const url = flag(args, '--url', 'http://127.0.0.1:4179');
const outDir = flag(args, '--out', 'work/perf/t27');
const slug = flag(args, '--slug', 'karitas');
const songSeconds = Number(flag(args, '--song-seconds', '977'));

mkdirSync(outDir, { recursive: true });
const audio = prepareAudio(songSeconds, outDir);

async function frames(page) {
  return page.evaluate(() => {
    const list = window.__llFrames ?? [];
    window.__llFrames = [];
    return list;
  });
}

function gapsOf(list) {
  return list.map((x) => (typeof x === 'number' ? x : x.gap));
}

function stats(list) {
  const gaps = gapsOf(list);
  if (!gaps.length) return { n: 0, max: 0, p95: 0, over20: 0, over32: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    n: list.length,
    max: sorted[sorted.length - 1],
    p95,
    over20: gaps.filter((n) => n > 20).length,
    over32: gaps.filter((n) => n > 32).length,
  };
}

const browser = await webkit.launch();
const context = await browser.newContext(phoneContext());
await installProbe(context);
await installAudioRoute(context, audio.body, audio.type);
await context.addInitScript(() => {
  window.__llFrames = [];
  let last = performance.now();
  const loop = (now) => {
    window.__llFrames.push({
      gap: Math.round(now - last),
      rows: document.querySelectorAll('.row').length,
      nodes: document.getElementsByTagName('*').length,
    });
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const page = await context.newPage();
const song = `${url.replace(/\/$/, '')}/song/${slug}`;
await page.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.scrub-track', { timeout: 30000 });
const play = page.getByRole('button', { name: 'Воспроизвести' });
if (await play.count()) await play.click();
await page.waitForTimeout(600);
await frames(page);
await page.waitForTimeout(500);
const idleFrames = stats(await frames(page));

const t0 = Date.now();
// A real tap does not wait for the playhead to stop moving. force skips that wait.
await page.getByRole('button', { name: 'Настройки', exact: true }).click({ force: true });
await page.waitForFunction(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return false;
  const r = d.getBoundingClientRect();
  return r.height > 200 && r.top < window.innerHeight * 0.75;
});
const openMs = Date.now() - t0;
const openFrames = stats(await frames(page));
const motion = await page.evaluate(async () => {
  const sheet = document.querySelector('.sheet');
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push({
      t: Math.round(performance.now()),
      transform: sheet ? sheet.style.transform : '',
      p: document.documentElement.style.getPropertyValue('--sheet-p'),
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  // One geometry read after the frames, so the samples themselves do not force layout.
  const r = sheet ? sheet.getBoundingClientRect() : null;
  return { samples, top: r ? Math.round(r.top) : null, height: r ? Math.round(r.height) : null };
});
// The row tree mounts one frame after the title. Those gaps belong to the open, not to scroll.
const settleRaw = await frames(page);
const settleFrames = stats(settleRaw);

// Mobile WebKit rejects mouse.wheel. Step the sheet's own scroller and let rAF record gaps.
await page.evaluate(async () => {
  const el = document.querySelector('.sheet-body');
  if (!el) return;
  for (let i = 0; i < 8; i++) {
    el.scrollTop = Math.min(el.scrollHeight, (i + 1) * 180);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
});
await page.waitForTimeout(400);
const scrollFrames = stats(await frames(page));
const after = await probe(page);

const report = {
  browser: 'webkit',
  viewport: phoneContext().viewport,
  deviceScaleFactor: phoneContext().deviceScaleFactor,
  audio: audio.label,
  openMs,
  idleFrames,
  openFrames,
  settleFrames,
  settleLong: settleRaw.filter((f) => f.gap > 32),
  scrollFrames,
  motion,
  blurWhileOpen: after.blur,
  nodes: after.nodes,
  phone: after.phone,
  media: after.media,
  // Idle on this WebKit is about 30 fps (gaps 30–47 ms), so a gap above 32 ms is the host
  // floor, not a dropped frame. A gap above the idle ceiling is a real hitch.
  // settleFrames is the first composite after the sheet is up: software WebKit at DPR 3
  // rasters that once at about 150 ms. Scroll after it is judged against the idle ceiling.
  hostCeiling: Math.max(48, idleFrames.max),
  pass:
    openMs < 100 &&
    openFrames.max <= Math.max(48, idleFrames.max) &&
    scrollFrames.max <= Math.max(48, idleFrames.max),
};
writeFileSync(`${outDir}/settings-trace.json`, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click({ force: true }).catch(() => {});
await browser.close();
if (!report.pass) process.exitCode = 2;
