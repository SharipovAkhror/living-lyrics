/**
 * Long playback on an iPhone-sized WebKit (and Chromium, for the heap).
 *
 *   npx vite preview --host 127.0.0.1 --port 4179 --strictPort
 *   node scripts/perf/long-run.mjs --url http://127.0.0.1:4179 --minutes 60 --browser both
 *
 * Plays Karitas with seeks and the settings sheet. Audio is a generated silent file
 * of the song length (see lib.mjs): there is no AUDIO_KEY here.
 * Samples go to work/perf/t27/ (gitignored). A summary is printed as JSON.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import {
  chromiumMetrics,
  flag,
  installAudioRoute,
  installProbe,
  installStandInClock,
  phoneContext,
  prepareAudio,
  probe,
  slopePerMin,
  workingSetTree,
} from './lib.mjs';

const args = process.argv.slice(2);
const url = flag(args, '--url', 'http://127.0.0.1:4179');
const minutes = Number(flag(args, '--minutes', '60'));
const browserName = flag(args, '--browser', 'both');
const outDir = flag(args, '--out', 'work/perf/t27');
const sampleMs = Number(flag(args, '--sample-ms', '30000'));
const songSeconds = Number(flag(args, '--song-seconds', '977'));
const slug = flag(args, '--slug', 'karitas');
const checkFlat = args.includes('--check-flat');
const bisectName = flag(args, '--bisect', '');
const noSheet = args.includes('--no-sheet');
const noPlay = args.includes('--no-play');
const noSeek = args.includes('--no-seek');
const label = flag(args, '--label', '');

const songUrl = new URL(`${url.replace(/\/$/, '')}/song/${slug}`);
if (bisectName) songUrl.searchParams.set('bisect', bisectName);
const SONG = songUrl.toString();
const audio = prepareAudio(songSeconds, outDir);

mkdirSync(outDir, { recursive: true });

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function seekFrac(page, frac) {
  const track = page.locator('.scrub-track');
  const box = await track.boundingBox();
  if (!box) return false;
  await track.click({ position: { x: Math.max(6, Math.min(box.width - 6, box.width * frac)), y: box.height / 2 }, force: true });
  return true;
}

async function exerciseSettings(page) {
  const notes = [];
  const open = page.getByRole('button', { name: 'Настройки', exact: true });
  await open.click({ force: true });
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const body = page.locator('.sheet-body');
  await body.evaluate((el) => {
    el.scrollTop = Math.min(el.scrollHeight, 360);
  });
  await page.waitForTimeout(150);
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
  const instruments = dialog.getByRole('button', { name: 'Инструменты' });
  if (await instruments.count()) {
    await instruments.first().click({ force: true });
    await page.waitForTimeout(120);
    const realistic = dialog.getByRole('button', { name: 'реалистичный' });
    const drawing = dialog.getByRole('button', { name: 'рисунок' });
    if ((await realistic.count()) && (await drawing.count())) {
      const useReal = Math.random() < 0.35;
      await (useReal ? realistic : drawing).first().click({ force: true });
      notes.push(useReal ? 'realistic' : 'drawing');
    }
    const back = dialog.getByRole('button', { name: 'Настройки' });
    if (await back.count()) await back.first().click({ force: true });
  }
  await page.waitForTimeout(80);
  const close = dialog.getByRole('button', { name: 'Закрыть' });
  if (await close.count()) await close.click({ force: true });
  else await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => notes.push('sheet-stuck'));
  return notes;
}

async function runOne(name) {
  const launcher = name === 'webkit' ? webkit : chromium;
  const browser = await launcher.launch({
    args: name === 'chromium' ? ['--enable-precise-memory-info'] : [],
  });
  const context = await browser.newContext(phoneContext());
  await installProbe(context);
  await installAudioRoute(context, audio.body, audio.type);
  // WebKit cannot decode the WAV fixture, so the hour would otherwise sit at 0:00.
  if (name === 'webkit') await installStandInClock(context, songSeconds);
  const page = await context.newPage();
  const errors = [];
  let crashed = false;
  page.on('pageerror', (err) => {
    if (errors.length < 20) errors.push(String(err).slice(0, 300));
  });
  page.on('crash', () => {
    crashed = true;
  });
  const pid = process.pid;
  let cdp = null;
  const samples = [];
  const file = `${outDir}/${label || name}-${stamp()}.jsonl`;
  try {
    await page.goto(SONG, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.scrub-track', { timeout: 30000 });
    if (!noPlay) {
      const play = page.getByRole('button', { name: 'Воспроизвести' });
      if (await play.count()) await play.click();
    }
    await page.waitForTimeout(800);
    if (name === 'chromium') {
      cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
    }
    const started = Date.now();
    const end = started + minutes * 60 * 1000;
    let nextSeek = started + 15000;
    let nextSheet = started + 25000;
    let seekN = 0;
    while (Date.now() < end && !crashed && !page.isClosed()) {
      const now = Date.now();
      if (!noSeek && now >= nextSeek) {
        seekN += 1;
        const frac = seekN % 5 === 0 ? 0.02 : 0.08 + Math.random() * 0.84;
        await seekFrac(page, frac).catch((err) => errors.push(`seek ${err.message}`));
        nextSeek = now + 35000;
      }
      if (!noSheet && now >= nextSheet) {
        await exerciseSettings(page).catch((err) => errors.push(`sheet ${err.message}`));
        nextSheet = now + 75000;
      }
      const row = {
        tMin: (Date.now() - started) / 60000,
        ...(await probe(page).catch((err) => ({ probeError: String(err) }))),
      };
      const heap = await chromiumMetrics(cdp).catch(() => null);
      if (heap) row.heap = heap;
      const mem = workingSetTree(pid);
      if (mem) row.workingSet = mem.bytes;
      if (mem) row.processes = mem.processes;
      if (mem?.names) row.processNames = mem.names;
      samples.push(row);
      writeFileSync(file, samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
      const left = end - Date.now();
      if (left <= 0) break;
      await page.waitForTimeout(Math.min(sampleMs, left));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const warm = samples.filter((s) => s.tMin >= 1);
  const summary = {
    browser: name,
    label: label || name,
    bisect: bisectName || 'all',
    noSheet,
    noPlay,
    noSeek,
    minutes,
    samples: samples.length,
    crashed,
    file,
    pid,
    audio: audio.label,
    first: samples[0] ?? null,
    last: samples[samples.length - 1] ?? null,
    blurFirst: samples[0]?.blur ?? null,
    blurLast: samples[samples.length - 1]?.blur ?? null,
    nodesSlope: slopePerMin(warm, (s) => s.nodes),
    listenersSlope: slopePerMin(warm, (s) => s.listeners),
    canvasPixelsSlope: slopePerMin(warm, (s) => s.canvasPixels ?? 0),
    workingSetSlopeMb: slopePerMin(warm, (s) => (s.workingSet ?? NaN) / (1024 * 1024)),
    heapSlopeMb: slopePerMin(warm, (s) => (s.heap?.jsHeapUsed ?? NaN) / (1024 * 1024)),
    errors,
  };
  writeFileSync(`${outDir}/${name}-${stamp()}-summary.json`, JSON.stringify(summary, null, 2));
  return summary;
}

const names = browserName === 'both' ? ['webkit', 'chromium'] : [browserName];
const summaries = [];
for (const name of names) {
  process.stdout.write(`\n--- ${label || name} ${name} ${minutes} min bisect=${bisectName || 'all'} ---\n`);
  const summary = await runOne(name);
  summaries.push(summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (checkFlat) {
  const problems = [];
  for (const s of summaries) {
    if (s.crashed) problems.push(`${s.browser} crashed`);
    if (s.samples < 3) problems.push(`${s.browser} too few samples`);
    const ws = s.workingSetSlopeMb;
    if (ws != null && Math.abs(ws) > 1.5) problems.push(`${s.browser} working set slope ${ws.toFixed(2)} MB/min`);
    const heap = s.heapSlopeMb;
    if (heap != null && heap > 0.4) problems.push(`${s.browser} heap slope ${heap.toFixed(2)} MB/min`);
    const nodes = s.nodesSlope;
    if (nodes != null && nodes > 5) problems.push(`${s.browser} DOM slope ${nodes.toFixed(1)} nodes/min`);
    const firstWs = s.first?.workingSet;
    const lastWs = s.last?.workingSet;
    if (firstWs && lastWs && lastWs > firstWs * 1.35 && s.minutes >= 30) {
      problems.push(`${s.browser} working set grew ${(lastWs / firstWs).toFixed(2)}×`);
    }
  }
  if (problems.length) {
    process.stderr.write(`flat check failed:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
}
