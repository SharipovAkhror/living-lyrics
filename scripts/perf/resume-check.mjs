/**
 * Reload Karitas and check that the saved position comes back.
 *
 *   node scripts/perf/resume-check.mjs --url http://127.0.0.1:4179
 *
 * Autoplay after a reload may be blocked. A restored playhead with paused audio still passes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { webkit } from 'playwright';
import { flag, installAudioRoute, phoneContext, prepareAudio } from './lib.mjs';

const args = process.argv.slice(2);
const url = flag(args, '--url', 'http://127.0.0.1:4179');
const outDir = flag(args, '--out', 'work/perf/t27');
const slug = flag(args, '--slug', 'karitas');
const songSeconds = Number(flag(args, '--song-seconds', '977'));
const song = `${url.replace(/\/$/, '')}/song/${slug}`;

mkdirSync(outDir, { recursive: true });
const audio = prepareAudio(songSeconds, outDir);

function parseClock(text) {
  const m = /(\d+):(\d{2})/.exec(text ?? '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const browser = await webkit.launch();
const context = await browser.newContext(phoneContext());
await installAudioRoute(context, audio.body, audio.type);
const page = await context.newPage();
const report = { audio: audio.label, pass: false };
try {
  await page.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.scrub-track', { timeout: 30000 });
  const play = page.getByRole('button', { name: 'Воспроизвести' });
  if (await play.count()) await play.click();
  await page.waitForTimeout(500);
  const track = page.locator('.scrub-track');
  const box = await track.boundingBox();
  if (box) {
    await track.click({ position: { x: Math.max(8, box.width * 0.32), y: box.height / 2 }, force: true });
  }
  // The page writes the position about every 2 seconds, and again on pagehide.
  await page.waitForTimeout(2500);
  const before = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    const clock = document.querySelector('.scrub-now')?.textContent ?? '';
    return { raw, clock };
  }, 'living-lyrics.resume.v1');
  report.before = before;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.scrub-track', { timeout: 30000 });
  await page.waitForTimeout(1200);
  const after = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    const clock = document.querySelector('.scrub-now')?.textContent ?? '';
    const audioEl = document.querySelector('audio');
    return {
      raw,
      clock,
      paused: audioEl ? audioEl.paused : null,
      error: audioEl?.error ? audioEl.error.code : 0,
      currentTime: audioEl ? audioEl.currentTime : null,
    };
  }, 'living-lyrics.resume.v1');
  report.after = after;
  let savedT = null;
  try {
    savedT = JSON.parse(before.raw ?? '{}')[slug]?.t ?? null;
  } catch {
    savedT = null;
  }
  report.savedT = savedT;
  const shown = parseClock(after.clock);
  report.shownSec = shown;
  const near = savedT != null && shown != null && Math.abs(shown - savedT) < 12;
  report.pass = savedT != null && savedT > 20 && near;
} catch (err) {
  report.error = String(err?.stack || err).slice(0, 500);
} finally {
  await browser.close().catch(() => {});
}
writeFileSync(`${outDir}/resume-check.json`, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
