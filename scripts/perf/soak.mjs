/**
 * T36 hour on desktop WebKit, iPhone viewport and user agent.
 *
 *   npx vite build
 *   npm run test:soak                              # 60 real minutes, then three kills
 *   npm run test:soak -- --minutes 3 --out work/perf/t36/smoke
 *   node scripts/perf/soak.mjs --url http://127.0.0.1:4185 --minutes 60 --slug karitas
 *
 * WebKit on Windows does not decode the fixture. The stand-in clock from lib.mjs
 * advances currentTime (--native-audio turns it off). play() without a trusted
 * gesture is refused, as on iOS, so a reload stays paused on «Продолжить с m:ss».
 *
 * Once a minute a line is appended to <out>/soak.jsonl: minute, position, the OS
 * working set of the WebKit process tree, the JS heap when the page exposes one
 * (performance.memory is absent in WebKit), DOM nodes, and page errors.
 *
 * Settings stay open for minutes 1–10 and again for 26–35. A seek lands about
 * every 7 minutes. Minutes 30 and 55 reload and record the position before and
 * after. The song is started again when it ends. After the hour, three kills use
 * the resume-crash.mjs technique (lifecycle events swallowed, then page.close)
 * at a random position each. A run shorter than 55 minutes scales the same
 * actions so a 3-minute smoke still opens the sheet, seeks, and reloads once.
 *
 * Exit code 2 when a reload, a kill, or a page error fails. A working-set slope
 * above 1 MB/min over minutes 10–60 is printed as LEAK and left in the summary;
 * it does not by itself change the exit code.
 */
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { webkit } from 'playwright';
import {
  browserPid,
  flag,
  installAudioRoute,
  installProbe,
  installStandInClock,
  phoneContext,
  prepareAudio,
  probe,
  slopePerMin,
} from './lib.mjs';

const args = process.argv.slice(2);
const given = flag(args, '--url', '');
const port = Number(flag(args, '--port', '4185'));
const outDir = flag(args, '--out', 'work/perf/t36');
const slug = flag(args, '--slug', 'karitas');
const minutes = Math.max(1, Math.round(Number(flag(args, '--minutes', '60'))));
const nativeAudio = args.includes('--native-audio');
const KEY = 'living-lyrics.resume.v1';
const TOLERANCE = 2;

/** Hour protocol, or a short run that still touches each action once. */
function schedule(total) {
  const n = Math.max(1, Math.round(total));
  if (n >= 55) {
    return {
      canonical: true,
      settings: [
        [1, 10],
        [26, 35],
      ],
      seeks: [7, 14, 21, 28, 35, 42, 49, 56].filter((m) => m <= n),
      reloads: [30, 55].filter((m) => m <= n),
    };
  }
  const reloadAt = n >= 2 ? n - 1 : null;
  const seekAt = Math.min(n, Math.max(1, Math.round(n * 0.34)));
  const settings = [[1, 1]];
  if (n >= 3) settings.push([n, n]);
  return {
    canonical: false,
    settings,
    seeks: [seekAt].filter((m) => m !== reloadAt),
    reloads: reloadAt == null ? [] : [reloadAt],
  };
}

function sheetWanted(plan, minute) {
  return plan.settings.some(([from, to]) => minute >= from && minute <= to);
}

function songDuration(name, fallback) {
  try {
    const song = JSON.parse(readFileSync(`content/songs/${name}/song.json`, 'utf8'));
    return Number.isFinite(song.duration) ? song.duration : fallback;
  } catch {
    return fallback;
  }
}

const songSeconds = Number(flag(args, '--song-seconds', String(songDuration(slug, 977))));

if (args.includes('--print-plan')) {
  process.stdout.write(`${JSON.stringify({ minutes, slug, songSeconds, ...schedule(minutes) }, null, 2)}\n`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const jsonlPath = join(outDir, 'soak.jsonl');
const logPath = join(outDir, 'soak.log');
const summaryPath = join(outDir, 'soak-summary.json');

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  appendFileSync(logPath, text);
  process.stdout.write(text);
}

function entryFile() {
  try {
    return readdirSync('dist/assets').find((name) => name.startsWith('index-') && name.endsWith('.js')) ?? null;
  } catch {
    return null;
  }
}

/** Serve dist/ with vite preview unless --url points at a running site. */
async function serve() {
  if (given) return { url: given.replace(/\/$/, ''), stop: () => {}, pid: null };
  if (!existsSync('dist/index.html')) throw new Error('dist/ is missing: run `npx vite build` first, or pass --url');
  const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const until = Date.now() + 30000;
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
  return { url, pid: child.pid ?? null, stop: () => child.kill() };
}

/** Runs before the app. A kill sets __llKill so lifecycle saves cannot run. */
function harness(key) {
  window.__llKill = false;
  try {
    window.__llBoot = localStorage.getItem(key);
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

/** play() without a trusted gesture is refused, as iOS refuses it after a kill or reload. */
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

function round1(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function parseClock(text) {
  const m = /(\d+):(\d{2})/.exec(text ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function storedT(raw) {
  try {
    const t = JSON.parse(raw ?? '{}')[slug]?.t;
    return typeof t === 'number' ? round1(t) : null;
  } catch {
    return null;
  }
}

async function readState(page) {
  return page.evaluate((key) => {
    const el = document.querySelector('audio');
    const offer = document.querySelector('.resume-offer');
    const alert = document.querySelector('.player-alert');
    const mem = performance.memory;
    return {
      href: location.pathname + location.search,
      clock: document.querySelector('.scrub-now')?.textContent ?? '',
      audioTime: el ? el.currentTime : null,
      paused: el ? el.paused : null,
      mediaError: el?.error ? el.error.code : 0,
      offer: offer ? (offer.textContent ?? '').replace(/\s+/g, ' ').trim() : null,
      alert: alert ? (alert.textContent ?? '').replace(/\s+/g, ' ').trim() : null,
      stored: localStorage.getItem(key),
      boot: window.__llBoot ?? null,
      jsHeap: mem && typeof mem.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : null,
    };
  }, KEY);
}

function positionOf(state) {
  return state.audioTime ?? parseClock(state.clock);
}

async function seekTo(page, seconds) {
  // The sheet covers the track. A forced click still hits whatever is on top, so
  // close it for the gesture and open it again before returning.
  const dialog = page.getByRole('dialog');
  const covered = (await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false));
  if (covered) await closeSettings(page);
  try {
    const track = page.locator('.scrub-track');
    const box = await track.boundingBox();
    if (!box) throw new Error('no scrubber');
    const dur = await page.evaluate(() => {
      const el = document.querySelector('audio');
      return el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    });
    const total = dur ?? songSeconds;
    const x = Math.max(6, Math.min(box.width - 6, (box.width * seconds) / total));
    await track.click({ position: { x, y: box.height / 2 }, force: true });
    await page.waitForFunction(
      (target) => {
        const el = document.querySelector('audio');
        return !!el && Math.abs(el.currentTime - target) < 4;
      },
      seconds,
      { timeout: 5000 },
    );
  } finally {
    if (covered) await openSettings(page);
  }
}

/**
 * Working set of the browser tree, in bytes. Node and the shell are left out.
 * `webBytes` is WebKitWebProcess only: that is the process iOS would jetsam.
 * One PowerShell call, same walk as lib.mjs workingSetTree.
 */
function memorySnapshot(rootPid) {
  if (!rootPid) return null;
  const script = [
    `$target = ${Number(rootPid)}`,
    '$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize',
    '$set = [System.Collections.Generic.HashSet[int]]::new()',
    '[void]$set.Add($target)',
    '$grow = $true',
    'while ($grow) {',
    '  $grow = $false',
    '  foreach ($p in $procs) {',
    '    $id = [int]$p.ProcessId',
    '    $parent = [int]$p.ParentProcessId',
    '    if ($set.Contains($parent) -and -not $set.Contains($id)) { [void]$set.Add($id); $grow = $true }',
    '  }',
    '}',
    '$sum = [int64]0; $web = [int64]0; $count = 0; $names = @{}',
    'foreach ($p in $procs) {',
    '  if (-not $set.Contains([int]$p.ProcessId)) { continue }',
    '  $n = [string]$p.Name',
    "  if ($n -like 'node*' -or $n -like 'powershell*' -or $n -like 'pwsh*' -or $n -like 'cmd*' -or $n -like 'conhost*') { continue }",
    '  $b = [int64]$p.WorkingSetSize',
    '  $sum += $b',
    '  $count++',
    "  if ($n -eq 'WebKitWebProcess.exe') { $web += $b }",
    '  if ($names.ContainsKey($n)) { $names[$n]++ } else { $names[$n] = 1 }',
    '}',
    '$label = ($names.Keys | ForEach-Object { $_ + "=" + $names[$_] }) -join ","',
    'Write-Output ($sum.ToString() + " " + $web.ToString() + " " + $count.ToString() + " " + $label)',
  ].join('; ');
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 });
    const parts = out.trim().split(/\s+/);
    const bytes = Number(parts[0]);
    const webBytes = Number(parts[1]);
    const processes = Number(parts[2]);
    if (!Number.isFinite(bytes)) return null;
    return { bytes, webBytes: Number.isFinite(webBytes) ? webBytes : null, processes, names: parts.slice(3).join(' ') };
  } catch {
    return null;
  }
}

async function openSettings(page) {
  const dialog = page.getByRole('dialog');
  if ((await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false))) return false;
  await page.locator('button[aria-label="Настройки"]').click();
  await dialog.waitFor({ state: 'visible', timeout: 8000 });
  return true;
}

async function closeSettings(page) {
  const dialog = page.getByRole('dialog');
  if ((await dialog.count()) === 0 || !(await dialog.isVisible().catch(() => false))) return false;
  const close = dialog.getByRole('button', { name: 'Закрыть' });
  if ((await close.count()) > 0) await close.first().click();
  else await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 8000 });
  return true;
}

async function startPlayback(page, url) {
  const song = `${url}/song/${slug}`;
  await page.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.scrub-track', { timeout: 30000 });
  const offer = page.locator('.resume-offer');
  if ((await offer.count()) > 0) await offer.click();
  else {
    const play = page.getByRole('button', { name: 'Воспроизвести' });
    await play.waitFor({ timeout: 20000 });
    await play.click();
  }
  await page.waitForFunction(
    () => {
      const el = document.querySelector('audio');
      return !!el && el.paused === false && el.currentTime > 0.3;
    },
    { timeout: 20000 },
  );
}

/**
 * The stand-in clock wraps to 0 at the end and stays "playing". If the element
 * actually pauses, press play. Near the end, seek back in and keep going.
 */
async function keepPlaying(page, state) {
  if (page.isClosed()) return;
  const snap = await readState(page).catch(() => null);
  if (!snap || snap.audioTime == null) return;
  const now = Date.now();
  if (state.lastT != null && state.lastT - snap.audioTime > 20 && now - state.seekMark > 3000) {
    state.replays.push({ kind: 'wrap', from: round1(state.lastT), to: round1(snap.audioTime), wallMs: now - state.started });
  }
  const nearEnd = snap.audioTime >= songSeconds - 2;
  if (!snap.offer && (nearEnd || snap.paused === true)) {
    if (nearEnd) {
      await seekTo(page, 12);
      state.seekMark = Date.now();
      state.lastT = 12;
    }
    const play = page.getByRole('button', { name: 'Воспроизвести' });
    if ((await play.count()) > 0) await play.click({ force: true, timeout: 5000 });
    state.replays.push({ kind: nearEnd ? 'end' : 'paused', at: round1(snap.audioTime), wallMs: now - state.started });
    if (!nearEnd) state.lastT = snap.audioTime;
    return;
  }
  state.lastT = snap.audioTime;
}

async function waitUntil(page, deadline, tick) {
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('page closed');
    const slice = Math.min(5000, deadline - Date.now());
    await page.waitForTimeout(Math.max(0, slice));
    if (tick) await tick();
  }
}

function resumeChecks(before, after) {
  const expected = positionOf(before);
  const shown = positionOf(after);
  const checks = {
    sameSong: typeof after.href === 'string' && after.href.startsWith(`/song/${slug}`),
    position: expected != null && shown != null && Math.abs(shown - expected) <= TOLERANCE,
    paused: after.paused === true,
    offerVisible: after.offer != null && /Продолжить с \d+:\d{2}/.test(after.offer),
  };
  return {
    checks,
    pass: Object.values(checks).every(Boolean),
    expected: round1(expected),
    got: round1(shown),
    delta: expected != null && shown != null ? round1(shown - expected) : null,
  };
}

async function reloadAndCheck(page) {
  const before = await readState(page);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.scrub-track', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const after = await readState(page);
  const verdict = resumeChecks(before, after);
  return {
    ...verdict,
    before: { href: before.href, clock: before.clock, audioTime: round1(before.audioTime), paused: before.paused, storedT: storedT(before.stored) },
    after: {
      href: after.href,
      clock: after.clock,
      audioTime: round1(after.audioTime),
      paused: after.paused,
      offer: after.offer,
      storedAtBootT: storedT(after.boot),
    },
  };
}

async function acceptResume(page) {
  const offer = page.locator('.resume-offer');
  if ((await offer.count()) > 0) {
    await offer.click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('audio');
        return !!el && el.paused === false;
      },
      { timeout: 10000 },
    );
    return 'offer';
  }
  const play = page.getByRole('button', { name: 'Воспроизвести' });
  if ((await play.count()) > 0) {
    await play.click();
    return 'play';
  }
  return 'none';
}

async function sampleRow(page, minute, started, extra) {
  const state = await readState(page);
  const dom = await probe(page).catch((err) => ({ probeError: String(err).slice(0, 240) }));
  const mem = memorySnapshot(process.pid);
  const mb = (bytes) => (bytes == null ? null : Math.round((bytes / (1024 * 1024)) * 100) / 100);
  return {
    minute,
    tMin: minute,
    wallMin: Math.round(((Date.now() - started) / 60000) * 1000) / 1000,
    at: new Date().toISOString(),
    position: round1(positionOf(state)),
    clock: state.clock,
    paused: state.paused,
    href: state.href,
    sheet: await page.locator('[role="dialog"]').isVisible().catch(() => false),
    workingSetMb: mb(mem?.bytes),
    workingSetBytes: mem?.bytes ?? null,
    webProcessMb: mb(mem?.webBytes),
    webProcessBytes: mem?.webBytes ?? null,
    processes: mem?.processes ?? null,
    processNames: mem?.names ?? null,
    jsHeapMb: state.jsHeap == null ? null : Math.round((state.jsHeap / (1024 * 1024)) * 1000) / 1000,
    jsHeapBytes: state.jsHeap,
    nodes: dom.nodes ?? null,
    listeners: dom.listeners ?? null,
    blur: dom.blur ?? null,
    canvases: dom.canvases?.length ?? null,
    phone: dom.phone ?? null,
    playerAlert: state.alert,
    ...extra,
  };
}

async function prepareContext(browser) {
  const context = await browser.newContext(phoneContext());
  await context.addInitScript(harness, KEY);
  await installProbe(context);
  if (!nativeAudio) await installStandInClock(context, songSeconds);
  await context.addInitScript(autoplayPolicy);
  return context;
}

async function runKill(browser, url, index) {
  const row = { case: `kill-${index + 1}`, pass: false };
  const context = await prepareContext(browser);
  await installAudioRoute(context, audio.body, audio.type);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));
  try {
    const target = Math.round(40 + Math.random() * Math.max(30, songSeconds - 80));
    row.target = target;
    await startPlayback(page, url);
    await seekTo(page, target);
    const waitMs = Math.round(800 + Math.random() * 4200);
    row.waitMs = waitMs;
    await page.waitForTimeout(waitMs);
    // The page saves about every 2 s. Kill only once that write is close to "now".
    const freshUntil = Date.now() + 5000;
    let fresh = false;
    while (Date.now() < freshUntil) {
      const snap = await readState(page);
      const live = positionOf(snap);
      const saved = storedT(snap.stored);
      if (live != null && saved != null && Math.abs(live - saved) <= 1.5 && snap.paused === false) {
        fresh = true;
        break;
      }
      await page.waitForTimeout(200);
    }
    row.saveFresh = fresh;
    const before = await readState(page);
    row.beforeKill = { clock: before.clock, audioTime: round1(before.audioTime), paused: before.paused, storedT: storedT(before.stored) };
    await page.evaluate(() => {
      window.__llKill = true;
    });
    await page.close({ runBeforeUnload: false });
    const again = await context.newPage();
    const againErrors = [];
    again.on('pageerror', (err) => againErrors.push(String(err).slice(0, 300)));
    try {
      await again.goto(`${url}/song/${slug}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await again.waitForSelector('.scrub-track', { timeout: 30000 });
      await again.waitForTimeout(2500);
      const after = await readState(again);
      const verdict = resumeChecks(before, after);
      row.afterReopen = {
        href: after.href,
        clock: after.clock,
        audioTime: round1(after.audioTime),
        paused: after.paused,
        offer: after.offer,
        storedAtBootT: storedT(after.boot),
      };
      row.expected = verdict.expected;
      row.got = verdict.got;
      row.delta = verdict.delta;
      row.checks = verdict.checks;
      row.pageErrors = [...pageErrors, ...againErrors];
      row.pass = verdict.pass && row.pageErrors.length === 0;
    } finally {
      await again.close().catch(() => {});
    }
  } catch (err) {
    row.error = String(err?.stack || err).slice(0, 500);
    row.pageErrors = pageErrors;
  } finally {
    await context.close().catch(() => {});
  }
  const why = row.checks ? Object.entries(row.checks).filter(([, ok]) => !ok).map(([k]) => k).join(', ') : row.error;
  log(`${row.pass ? 'PASS' : 'FAIL'} ${row.case}: expected ${row.expected ?? '?'} s, got ${row.got ?? '?'} s${why ? ` — ${why}` : ''}`);
  return row;
}

const plan = schedule(minutes);
const audio = prepareAudio(songSeconds, outDir);
writeFileSync(jsonlPath, '');
writeFileSync(logPath, '');
log(`soak start minutes=${minutes} slug=${slug} canonical=${plan.canonical} clock=${nativeAudio ? 'native' : 'stand-in'} songSeconds=${songSeconds}`);
log(`audio: ${audio.label}`);
log(`plan ${JSON.stringify(plan)}`);

const server = await serve();
log(`preview ${server.url} pid=${server.pid ?? 'external'}`);
const browser = await webkit.launch();
const browserProcess = browserPid(browser);
log(`webkit pid=${browserProcess ?? 'unknown'} entry=${entryFile() ?? 'unknown'}`);

const pageErrors = [];
const rows = [];
const reloads = [];
const playState = { lastT: null, seekMark: 0, replays: [], started: Date.now() };
let crashed = false;
let hourError = null;

try {
  const context = await prepareContext(browser);
  await installAudioRoute(context, audio.body, audio.type);
  const page = await context.newPage();
  page.on('pageerror', (err) => {
    const text = String(err).slice(0, 300);
    pageErrors.push(text);
    log(`pageerror ${text}`);
  });
  page.on('crash', () => {
    crashed = true;
    log('page crashed');
  });
  const started = Date.now();
  playState.started = started;
  await startPlayback(page, server.url);
  if (sheetWanted(plan, 1)) await openSettings(page);
  log('playback started');

  for (let minute = 1; minute <= minutes && !crashed && !page.isClosed(); minute++) {
    await waitUntil(page, started + minute * 60_000, async () => {
      try {
        await keepPlaying(page, playState);
      } catch (err) {
        log(`keepPlaying ${String(err).slice(0, 200)}`);
      }
    });
    const events = [];
    try {
      if (plan.seeks.includes(minute)) {
        const target = Math.round(30 + Math.random() * Math.max(20, songSeconds - 80));
        const before = round1(positionOf(await readState(page)));
        await seekTo(page, target);
        playState.seekMark = Date.now();
        playState.lastT = target;
        events.push({ seek: target, from: before });
        log(`minute ${minute} seek ${before} -> ${target}`);
      }
    } catch (err) {
      events.push({ seekError: String(err).slice(0, 240) });
      log(`minute ${minute} seek failed ${events.at(-1).seekError}`);
    }
    let reload = null;
    if (plan.reloads.includes(minute)) {
      try {
        reload = await reloadAndCheck(page);
        reloads.push({ minute, ...reload });
        log(`minute ${minute} reload expected ${reload.expected} got ${reload.got} ${reload.pass ? 'PASS' : 'FAIL'}`);
        const how = await acceptResume(page);
        log(`minute ${minute} continue via ${how}`);
        playState.seekMark = Date.now();
        events.push({ reload: reload.pass, continue: how });
      } catch (err) {
        const text = String(err?.stack || err).slice(0, 400);
        reload = { pass: false, error: text };
        reloads.push({ minute, pass: false, error: text });
        log(`minute ${minute} reload failed ${text}`);
      }
    }
    try {
      if (sheetWanted(plan, minute)) await openSettings(page);
      else await closeSettings(page);
    } catch (err) {
      events.push({ sheetError: String(err).slice(0, 240) });
      log(`minute ${minute} sheet failed ${events.at(-1).sheetError}`);
    }
    const row = await sampleRow(page, minute, started, {
      events,
      reload,
      pageErrors: pageErrors.length,
      pageErrorTexts: pageErrors.slice(),
    });
    rows.push(row);
    appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`);
    log(`minute ${minute} pos=${row.position} ws=${row.workingSetMb}MB web=${row.webProcessMb}MB nodes=${row.nodes} heap=${row.jsHeapMb ?? 'n/a'} errors=${row.pageErrors} sheet=${row.sheet} wall=${row.wallMin}`);
    // First window: open from the start until the minute-10 sample, then close.
    // Middle window: open after minute 25 so it stays up for the next ten minutes.
    try {
      if (sheetWanted(plan, minute) && !sheetWanted(plan, minute + 1)) await closeSettings(page);
      if (!sheetWanted(plan, minute) && sheetWanted(plan, minute + 1)) await openSettings(page);
    } catch (err) {
      log(`minute ${minute} sheet edge failed ${String(err).slice(0, 240)}`);
    }
  }
  await context.close().catch(() => {});
} catch (err) {
  hourError = String(err?.stack || err).slice(0, 800);
  log(`hour error ${hourError}`);
}

log('kills');
const kills = [];
for (let i = 0; i < 3; i++) {
  kills.push(await runKill(browser, server.url, i));
}

const span = rows.filter((row) => row.minute >= 10 && row.minute <= minutes);
const slopeRows = span.length >= 3 ? span : rows;
const workingSetSlope = slopePerMin(slopeRows, (row) => row.workingSetMb);
const webSlope = slopePerMin(slopeRows, (row) => row.webProcessMb);
const nodeSlope = slopePerMin(slopeRows, (row) => row.nodes);
const nodeVals = slopeRows.map((row) => row.nodes).filter((n) => Number.isFinite(n));
const nodeRise = nodeVals.length >= 2 ? nodeVals[nodeVals.length - 1] - nodeVals[0] : null;
// Minutes 1–9 fill the line slots. Only minutes 10–60 judge a leak.
const judged = span.length >= 3;
const memLeak = judged && ((webSlope != null && webSlope > 1) || (workingSetSlope != null && workingSetSlope > 1));
const nodesLeak = judged && nodeSlope != null && nodeSlope > 1 && nodeRise != null && nodeRise > 40;
const uncovered = rows.filter((row) => !row.sheet && row.minute >= 10);
const uncoveredSlope = slopePerMin(uncovered, (row) => row.workingSetMb);

const summary = {
  url: server.url,
  slug,
  minutes,
  canonical: plan.canonical,
  plan,
  clock: nativeAudio ? 'native' : 'stand-in',
  audio: audio.label,
  entry: entryFile(),
  webkitPid: browserProcess,
  previewPid: server.pid,
  samples: rows.length,
  crashed,
  hourError,
  pageErrors,
  reloads: reloads.map((item) => ({
    minute: item.minute,
    pass: item.pass,
    expected: item.expected,
    got: item.got,
    delta: item.delta,
    checks: item.checks,
    offer: item.after?.offer ?? null,
  })),
  kills: kills.map((item) => ({
    case: item.case,
    pass: item.pass,
    target: item.target,
    expected: item.expected,
    got: item.got,
    delta: item.delta,
    checks: item.checks,
    offer: item.afterReopen?.offer ?? null,
    error: item.error ?? null,
  })),
  replays: playState.replays,
  slopeWindow: span.length >= 3 ? '10-end' : 'all',
  workingSetSlopeMbPerMin: workingSetSlope,
  webProcessSlopeMbPerMin: webSlope,
  uncoveredWorkingSetSlopeMbPerMin: uncoveredSlope,
  nodeSlopePerMin: nodeSlope,
  nodeRise,
  memLeak,
  nodesLeak,
  first: rows[0] ?? null,
  last: rows[rows.length - 1] ?? null,
  pass:
    !crashed &&
    !hourError &&
    rows.length === minutes &&
    pageErrors.length === 0 &&
    reloads.length === plan.reloads.length &&
    reloads.every((item) => item.pass) &&
    kills.length === 3 &&
    kills.every((item) => item.pass) &&
    (rows.length === 0 || rows[rows.length - 1].wallMin >= minutes - 0.05),
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
log(
  `slope minutes ${summary.slopeWindow}: tree ${workingSetSlope == null ? 'n/a' : workingSetSlope.toFixed(2)} MB/min, web process ${webSlope == null ? 'n/a' : webSlope.toFixed(2)} MB/min, nodes ${nodeSlope == null ? 'n/a' : nodeSlope.toFixed(2)} /min, rise ${nodeRise ?? 'n/a'}`,
);
if (!judged) log('memory window is shorter than minutes 10-60; slope is not a leak verdict');
if (memLeak) log(`LEAK working set tree ${workingSetSlope == null ? 'n/a' : workingSetSlope.toFixed(2)} MB/min, web process ${webSlope == null ? 'n/a' : webSlope.toFixed(2)} MB/min over ${summary.slopeWindow}`);
if (nodesLeak) log(`LEAK nodes slope ${nodeSlope.toFixed(2)} /min rise ${nodeRise}`);
if (judged && !memLeak && !nodesLeak) log('memory within the 1 MB/min and node-growth bars');
log(`${summary.pass ? 'PASS' : 'FAIL'} soak`);
await browser.close().catch(() => {});
server.stop();
if (!summary.pass) process.exitCode = 2;
