/**
 * T36: kill the song page mid-listen, open it again, expect the same place.
 *
 *   npm run test:resume                              # serves dist/ itself (build first: npx vite build)
 *   node scripts/perf/resume-crash.mjs --url http://127.0.0.1:4179
 *
 * A WebContent kill on iOS runs no page handlers. The harness copies that: just before
 * page.close({ runBeforeUnload: false }) it swallows pagehide, visibilitychange, freeze,
 * beforeunload and unload at the window capture phase, so only what the page already
 * wrote to localStorage survives. A new page in the same context then opens the same URL.
 *
 * Cases:
 *   seek-then-kill  — play a few seconds, seek to ~1:30, kill at once (no periodic save yet)
 *   wait-then-kill  — seek to ~1:30, play past the save interval, then kill
 *   idb-stall       — as wait-then-kill, but on the reopened page indexedDB.open never answers
 *                     (restore must not depend on the attached-file store)
 *   render-error    — seek, then throw once inside the scene (`?ll-render-error=1`, stripped
 *                     from the Vercel production build). The scene remounts, the position stays,
 *                     and «О песне» shows the error with «Скопировать».
 *   bad-storage     — write garbage into the resume key, reload. No crash, time stays at 0,
 *                     no «Продолжить» button.
 *
 * WebKit on Windows cannot decode the fixture, so the stand-in clock from lib.mjs plays it
 * (--native-audio turns it off), and play() without a trusted gesture is refused, as on iOS.
 *
 * Each case passes when, after reopening: same song URL, position within ±2 s of the
 * position at the kill, the audio is paused, and the «Продолжить с m:ss» button is visible.
 * Exit code 2 when any case fails.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { webkit } from 'playwright';
import { flag, installAudioRoute, installStandInClock, phoneContext, prepareAudio } from './lib.mjs';

const args = process.argv.slice(2);
const given = flag(args, '--url', '');
const port = Number(flag(args, '--port', '4183'));
const outDir = flag(args, '--out', 'work/perf/t36');
const slug = flag(args, '--slug', 'karitas');
const songSeconds = Number(flag(args, '--song-seconds', '977'));
const target = Number(flag(args, '--target', '90'));
const only = flag(args, '--case', '');
const KEY = 'living-lyrics.resume.v1';
const ERROR_KEY = 'living-lyrics.lastError.v1';
const TOLERANCE = 2;
// The page saves about every 2 s (SongPage.tsx). Wait clearly past one interval.
const SAVE_WAIT_MS = 3500;

mkdirSync(outDir, { recursive: true });
const audio = prepareAudio(songSeconds, outDir);

/** Serve dist/ with vite preview unless --url points at a running site. */
async function serve() {
  if (given) return { url: given.replace(/\/$/, ''), stop: () => {} };
  if (!existsSync('dist/index.html')) throw new Error('dist/ is missing: run `npx vite build` first, or pass --url');
  const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const until = Date.now() + 20000;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > until) {
      child.kill();
      throw new Error(`vite preview did not answer on ${url}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, stop: () => child.kill() };
}

/** Runs before the app on every page: a kill switch for lifecycle events and a boot snapshot. */
function harness(key) {
  window.__llKill = false;
  try {
    window.__llBoot = localStorage.getItem(key);
    // idb-stall case: IndexedDB open never answers on the reopened page (a known WebKit failure mode).
    if (localStorage.getItem('t36.stall-idb') === '1') {
      IDBFactory.prototype.open = function () {
        return {};
      };
    }
  } catch {
    window.__llBoot = 'throws';
  }
  for (const ev of ['pagehide', 'visibilitychange', 'freeze', 'beforeunload', 'unload']) {
    window.addEventListener(
      ev,
      (e) => {
        if (window.__llKill) e.stopImmediatePropagation();
      },
      true,
    );
  }
}

/**
 * Runs after installStandInClock: play() without a trusted gesture in this document is
 * refused, as iOS Safari refuses it on a page that came back after a kill.
 */
function autoplayPolicy() {
  let activated = false;
  for (const ev of ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend']) {
    window.addEventListener(
      ev,
      (e) => {
        if (e.isTrusted) activated = true;
      },
      true,
    );
  }
  const play = HTMLMediaElement.prototype.play;
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value() {
      if (!activated) return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'));
      return play.call(this);
    },
  });
}

async function readState(page) {
  return page.evaluate((key) => {
    const el = document.querySelector('audio');
    const offer = document.querySelector('.resume-offer');
    return {
      href: location.pathname + location.search,
      clock: document.querySelector('.scrub-now')?.textContent ?? '',
      audioTime: el ? el.currentTime : null,
      paused: el ? el.paused : null,
      mediaError: el?.error ? el.error.code : 0,
      offer: offer ? (offer.textContent ?? '').trim() : null,
      stored: localStorage.getItem(key),
      boot: window.__llBoot ?? null,
    };
  }, KEY);
}

function parseClock(text) {
  const m = /(\d+):(\d{2})/.exec(text ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function storedT(raw) {
  try {
    const t = JSON.parse(raw ?? '{}')[slug]?.t;
    return typeof t === 'number' ? Math.round(t * 10) / 10 : null;
  } catch {
    return null;
  }
}

async function seekTo(page, seconds) {
  const track = page.locator('.scrub-track');
  const box = await track.boundingBox();
  if (!box) throw new Error('no scrubber');
  const dur = await page.evaluate(() => document.querySelector('audio')?.duration);
  const total = Number.isFinite(dur) && dur > 0 ? dur : songSeconds;
  await track.click({ position: { x: (box.width * seconds) / total, y: box.height / 2 }, force: true });
}

async function runCase(context, url, name, waitAfterSeek, stallIdb = false) {
  const song = `${url}/song/${slug}`;
  const row = { case: name, pass: false };
  const page = await context.newPage();
  try {
    await page.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.scrub-track', { timeout: 30000 });
    const play = page.getByRole('button', { name: 'Воспроизвести' });
    if (await play.count()) await play.first().click();
    await page.waitForTimeout(3000);
    await seekTo(page, target);
    if (waitAfterSeek) await page.waitForTimeout(waitAfterSeek);
    const before = await readState(page);
    row.beforeKill = { clock: before.clock, audioTime: before.audioTime, paused: before.paused, mediaError: before.mediaError, storedT: storedT(before.stored) };
    await page.evaluate((stall) => {
      if (stall) localStorage.setItem('t36.stall-idb', '1');
      window.__llKill = true;
    }, stallIdb);
    await page.close({ runBeforeUnload: false });

    const again = await context.newPage();
    try {
      await again.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await again.waitForSelector('.scrub-track', { timeout: 30000 });
      await again.waitForTimeout(2500);
      const after = await readState(again);
      const shown = after.audioTime ?? parseClock(after.clock);
      const expected = before.audioTime ?? parseClock(before.clock);
      row.afterReopen = {
        href: after.href,
        clock: after.clock,
        audioTime: after.audioTime,
        paused: after.paused,
        offer: after.offer,
        storedAtBootT: storedT(after.boot),
      };
      const checks = {
        sameSong: after.href.startsWith(`/song/${slug}`),
        position: expected != null && shown != null && Math.abs(shown - expected) <= TOLERANCE,
        paused: after.paused === true,
        offerVisible: after.offer != null && /Продолжить с \d+:\d{2}/.test(after.offer),
      };
      row.expected = expected != null ? Math.round(expected * 10) / 10 : null;
      row.got = shown != null ? Math.round(shown * 10) / 10 : null;
      row.checks = checks;
      row.pass = Object.values(checks).every(Boolean);
    } finally {
      await again.close().catch(() => {});
    }
  } catch (err) {
    row.error = String(err?.stack || err).slice(0, 500);
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
  return row;
}

/** Seek, force one scene throw, expect the stage back at the same time and the error in «О песне». */
async function runRenderError(context, url) {
  const song = `${url}/song/${slug}`;
  const row = { case: 'render-error', pass: false };
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 240)));
  try {
    await page.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.scrub-track', { timeout: 30000 });
    const play = page.getByRole('button', { name: 'Воспроизвести' });
    if (await play.count()) await play.first().click();
    await page.waitForTimeout(1500);
    await seekTo(page, target);
    const pause = page.getByRole('button', { name: 'Пауза' });
    if (await pause.count()) await pause.first().click();
    await page.waitForTimeout(200);
    const before = await readState(page);
    row.beforeThrow = { clock: before.clock, audioTime: before.audioTime, paused: before.paused };
    await page.evaluate(() => {
      const next = new URL(location.href);
      next.searchParams.set('ll-render-error', '1');
      history.replaceState(null, '', next.pathname + next.search);
    });
    // The scene reads the query on its next render. Toggling the translation does that.
    await page.getByRole('button', { name: 'Перевод' }).click();
    await page.locator('.scene').waitFor({ timeout: 10000 });
    const after = await readState(page);
    const shown = after.audioTime ?? parseClock(after.clock);
    const expected = before.audioTime ?? parseClock(before.clock);
    await page.getByRole('button', { name: 'О песне' }).click();
    const diag = page.locator('.info-diag');
    await diag.waitFor({ timeout: 10000 });
    const diagText = ((await diag.innerText()) ?? '').replace(/\s+/g, ' ').trim();
    const storedError = await page.evaluate((key) => localStorage.getItem(key), ERROR_KEY);
    row.after = { clock: after.clock, audioTime: after.audioTime, diag: diagText, storedError, pageErrors };
    row.expected = expected != null ? Math.round(expected * 10) / 10 : null;
    row.got = shown != null ? Math.round(shown * 10) / 10 : null;
    const checks = {
      recovered: (await page.locator('.scene').count()) > 0 && (await page.locator('.scrub-track').count()) > 0,
      position: expected != null && shown != null && Math.abs(shown - expected) <= TOLERANCE,
      errorVisible: /ll-render-error/.test(diagText),
      copyVisible: (await page.getByRole('button', { name: 'Скопировать' }).count()) > 0,
    };
    row.checks = checks;
    row.pass = Object.values(checks).every(Boolean);
  } catch (err) {
    row.error = String(err?.stack || err).slice(0, 500);
    row.pageErrors = pageErrors;
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
  return row;
}

/** Garbage in the resume key must not throw, must not offer a button, and must start at 0. */
async function runBadStorage(context, url) {
  const song = `${url}/song/${slug}`;
  const row = { case: 'bad-storage', pass: false, expected: 0 };
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 240)));
  try {
    await page.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.scrub-track', { timeout: 30000 });
    await page.evaluate((key) => localStorage.setItem(key, '{'), KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.scrub-track', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const after = await readState(page);
    const shown = after.audioTime ?? parseClock(after.clock);
    row.after = { clock: after.clock, audioTime: after.audioTime, offer: after.offer, pageErrors };
    row.got = shown != null ? Math.round(shown * 10) / 10 : null;
    const checks = {
      noCrash: pageErrors.length === 0 && (await page.locator('.scrub-track').count()) > 0,
      position: shown != null && shown < 1.5,
      noOffer: after.offer == null,
    };
    row.checks = checks;
    row.pass = Object.values(checks).every(Boolean);
  } catch (err) {
    row.error = String(err?.stack || err).slice(0, 500);
    row.pageErrors = pageErrors;
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
  return row;
}

const server = await serve();
const browser = await webkit.launch();
const report = { url: server.url, audio: audio.label, tolerance: TOLERANCE, cases: [], pass: false };
try {
  const cases = [
    { name: 'seek-then-kill', kind: 'kill', wait: 0 },
    { name: 'wait-then-kill', kind: 'kill', wait: SAVE_WAIT_MS },
    { name: 'idb-stall', kind: 'kill', wait: SAVE_WAIT_MS, stall: true },
    { name: 'render-error', kind: 'render-error' },
    { name: 'bad-storage', kind: 'bad-storage' },
  ].filter((item) => !only || only === item.name);
  // One context per case: fresh storage, and both pages of a case share it.
  for (const item of cases) {
    const context = await browser.newContext(phoneContext());
    await context.addInitScript(harness, KEY);
    // WebKit on Windows rejects the fixture (media error 4); the stand-in clock plays it.
    if (!args.includes('--native-audio')) await installStandInClock(context, songSeconds);
    await context.addInitScript(autoplayPolicy);
    await installAudioRoute(context, audio.body, audio.type);
    if (item.kind === 'render-error') report.cases.push(await runRenderError(context, server.url));
    else if (item.kind === 'bad-storage') report.cases.push(await runBadStorage(context, server.url));
    else report.cases.push(await runCase(context, server.url, item.name, item.wait, item.stall === true));
    await context.close().catch(() => {});
  }
  report.pass = report.cases.length > 0 && report.cases.every((c) => c.pass);
} catch (err) {
  report.error = String(err?.stack || err).slice(0, 500);
} finally {
  await browser.close().catch(() => {});
  server.stop();
}
writeFileSync(`${outDir}/resume-crash.json`, JSON.stringify(report, null, 2));
for (const c of report.cases) {
  const why = c.checks ? Object.entries(c.checks).filter(([, ok]) => !ok).map(([k]) => k).join(', ') : c.error;
  process.stdout.write(`${c.pass ? 'PASS' : 'FAIL'} ${c.case}: expected ${c.expected ?? '?'} s, got ${c.got ?? '?'} s${why ? ` — failed: ${why}` : ''}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${report.pass ? 'PASS' : 'FAIL'} resume-crash\n`);
if (!report.pass) process.exitCode = 2;
