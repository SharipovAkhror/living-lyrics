/**
 * Ten minutes of the phone scene in Chromium, with a heap snapshot at each end.
 *
 *   npx vite build
 *   node scripts/perf/heap-growth.mjs --minutes 10 --mode native,stand-in,pause --port 4197
 *
 * Modes, same viewport as soak (phoneContext):
 *   native    decrypted m4a, decoder running, sheet closed, no seeks
 *   stand-in  lib.mjs clock, media requests aborted, scene still advances
 *   pause     stand-in clock seeks to 120s and pauses; time must stay put
 *
 * WebKit on Windows does not decode the recording. Playwright's bundled
 * Chromium does not either: its demuxer reports DEMUXER_ERROR_NO_SUPPORTED_STREAMS
 * on this AAC m4a. The script launches the installed Google Chrome (channel
 * chrome), which is Chromium with the decoder. The WebKit hour it is compared
 * with is the T36 run in t27-iphone.md.
 *
 * Snapshots and the summary stay in work/ (gitignored). A decrypted m4a is
 * served from dist/ and is not committed.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { diffBuckets, diffGroups, diffNumbers, heapGroups, summarizeHeapSnapshot, summarizeMemoryDump, watchedDiff } from './heap-snapshot.mjs';
import {
  browserPid,
  flag,
  installProbe,
  installStandInClock,
  phoneContext,
  probe,
  processTreeMemory,
  rangedTotal,
  slopePerMin,
} from './lib.mjs';

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const { selfTest } = await import('./heap-snapshot.mjs');
  process.stdout.write(`${selfTest()}\n`);
  process.exit(0);
}

const given = flag(args, '--url', '');
const port = Number(flag(args, '--port', '4197'));
const outDir = flag(args, '--out', 'work/perf/t27-memory');
const slug = flag(args, '--slug', 'karitas');
const minutes = Math.max(0.4, Number(flag(args, '--minutes', '10')));
const modes = flag(args, '--mode', 'native,stand-in,pause')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const pauseAt = Number(flag(args, '--pause-at', '120'));

const KNOWN = new Set(['native', 'stand-in', 'pause']);
for (const mode of modes) {
  if (!KNOWN.has(mode)) {
    process.stderr.write(`unknown --mode ${mode}\n`);
    process.exit(2);
  }
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
const sampleMs = minutes >= 3 ? 30000 : 10000;

function entryFile() {
  try {
    return readdirSync('dist/assets').find((name) => name.startsWith('index-') && name.endsWith('.js')) ?? null;
  } catch {
    return null;
  }
}

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { url, pid: child.pid ?? null, stop: () => child.kill() };
}

function mb(bytes) {
  return bytes == null || !Number.isFinite(bytes) ? null : Math.round((bytes / (1024 * 1024)) * 1000) / 1000;
}

async function readAudio(page) {
  return page.evaluate(() => {
    const el = document.querySelector('audio');
    const mem = performance.memory;
    const alert = document.querySelector('.player-alert');
    return {
      t: el ? el.currentTime : null,
      paused: el ? el.paused : null,
      ready: el ? el.readyState : null,
      error: el && el.error ? el.error.code : 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : null,
      alert: alert ? (alert.textContent ?? '').replace(/\s+/g, ' ').trim() : null,
      jsHeap: mem && typeof mem.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : null,
      phone: document.documentElement.dataset.phone ?? '',
    };
  });
}

async function performanceMap(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const out = {};
  for (const metric of metrics) out[metric.name] = metric.value;
  return out;
}

async function takeHeapSnapshot(cdp, file) {
  const chunks = [];
  const onChunk = (params) => {
    if (params && typeof params.chunk === 'string') chunks.push(params.chunk);
  };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  try {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await cdp.send('HeapProfiler.disable').catch(() => {});
  }
  const text = chunks.join('');
  if (text.length < 100) throw new Error(`heap snapshot is empty (${text.length} bytes)`);
  writeFileSync(file, text);
  return text.length;
}

async function captureMemoryDump(cdp) {
  const events = [];
  const onData = (params) => {
    if (Array.isArray(params?.value)) events.push(...params.value);
  };
  cdp.on('Tracing.dataCollected', onData);
  let timer = null;
  let started = false;
  const done = new Promise((resolve) => {
    cdp.once('Tracing.tracingComplete', () => resolve('complete'));
    timer = setTimeout(() => resolve('timeout'), 20000);
  });
  try {
    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: {
        includedCategories: ['disabled-by-default-memory-infra'],
        memoryDumpConfig: { allowedModes: ['light', 'detailed'] },
      },
    });
    started = true;
    await cdp.send('Tracing.requestMemoryDump', { deterministic: false, levelOfDetail: 'light' });
    await cdp.send('Tracing.end');
    started = false;
    const how = await done;
    return { events, how };
  } finally {
    if (timer) clearTimeout(timer);
    if (started) await cdp.send('Tracing.end').catch(() => {});
    cdp.off('Tracing.dataCollected', onData);
  }
}

function roleMap(tree) {
  const map = new Map();
  for (const item of tree?.items ?? []) {
    if (Number.isFinite(item.pid)) map.set(item.pid, item.role);
  }
  return map;
}

function dumpShape(events) {
  const first = (events ?? []).find((event) => event && (event.ph === 'v' || event.args));
  if (!first) return { count: (events ?? []).length, sample: null };
  return {
    count: events.length,
    name: first.name ?? null,
    ph: first.ph ?? null,
    cat: first.cat ?? null,
    argKeys: first.args ? Object.keys(first.args) : [],
    sample: JSON.stringify(first).slice(0, 4000),
  };
}

function notable(rows, limit) {
  return rows.filter((row) => Math.abs(row.bytes) >= 2048 || Math.abs(row.count) >= 50).slice(0, limit);
}

/** Keep allocator totals. Bucket and partition rows hide the process-sized numbers. */
function compactPaths(paths) {
  const out = {};
  for (const [key, bytes] of Object.entries(paths ?? {})) {
    if (!key.startsWith('allocators/')) continue;
    if (key.includes('bucket_') || key.includes('/partitions') || key.includes('__')) continue;
    if (key.split('/').length > 3) continue;
    out[key] = bytes;
  }
  return out;
}

function compactDump(dump) {
  if (!dump || dump.error || !dump.paths) return dump;
  const paths = compactPaths(dump.paths);
  const byRole = {};
  for (const [role, bucket] of Object.entries(dump.byRole ?? {})) {
    if (role !== 'renderer' && role !== 'gpu' && role !== 'browser') continue;
    byRole[role] = compactPaths(bucket);
  }
  return { dumps: dump.dumps, how: dump.how, paths, byRole };
}

async function sampleRow(page, cdp, started) {
  const audio = await readAudio(page);
  const metrics = await performanceMap(cdp).catch((err) => ({ error: String(err).slice(0, 240) }));
  const dom = await cdp.send('Memory.getDOMCounters').catch((err) => ({ error: String(err).slice(0, 240) }));
  const domProbe = await probe(page).catch((err) => ({ probeError: String(err).slice(0, 240) }));
  const tree = processTreeMemory(process.pid);
  return {
    tMin: Math.round(((Date.now() - started) / 60000) * 1000) / 1000,
    at: new Date().toISOString(),
    audio,
    metrics,
    dom,
    nodes: domProbe.nodes ?? null,
    listeners: domProbe.listeners ?? null,
    blur: domProbe.blur ?? null,
    canvases: domProbe.canvases?.length ?? null,
    phone: domProbe.phone ?? audio.phone,
    treeMb: tree
      ? {
          tree: mb(tree.bytes),
          renderer: mb(tree.rendererBytes),
          rendererMax: mb(tree.rendererMaxBytes),
          gpu: mb(tree.gpuBytes),
          browser: mb(tree.browserBytes),
          utility: mb(tree.utilityBytes),
          web: mb(tree.webBytes),
        }
      : null,
    processNames: tree?.names ?? null,
    tree,
  };
}

async function openPlaying(page, url) {
  await page.goto(`${url}/song/${slug}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.scrub-track', { timeout: 30000 });
  const offer = page.locator('.resume-offer');
  if ((await offer.count()) > 0) await offer.click();
  else {
    const play = page.getByRole('button', { name: 'Воспроизвести' });
    await play.waitFor({ timeout: 20000 });
    await play.click();
  }
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('audio');
        return !!el && el.paused === false && el.currentTime > 0.4;
      },
      null,
      { timeout: 20000 },
    );
  } catch (err) {
    const state = await readAudio(page).catch(() => null);
    throw new Error(`${err.message} audio=${JSON.stringify(state)}`);
  }
}

async function runMode(mode, server) {
  const dir = join(outDir, mode);
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'run.log');
  const samplesPath = join(dir, 'samples.jsonl');
  writeFileSync(logPath, '');
  writeFileSync(samplesPath, '');
  const log = (line) => {
    const text = `${new Date().toISOString()} ${line}\n`;
    appendFileSync(logPath, text);
    process.stdout.write(text);
  };
  log(`mode ${mode} minutes=${minutes} entry=${entryFile() ?? 'unknown'}`);
  let browser;
  try {
    // Bundled Playwright Chromium has no AAC demuxer. Installed Chrome does.
    browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] });
  } catch (err) {
    throw new Error(`Installed Google Chrome is required to decode the m4a. ${err.message}`);
  }
  const context = await browser.newContext(phoneContext());
  await context.addInitScript(() => {
    try {
      localStorage.removeItem('living-lyrics.resume.v1');
    } catch {
      /* private mode */
    }
  });
  await installProbe(context);
  const aborted = { n: 0 };
  if (mode !== 'native') {
    await installStandInClock(context, songSeconds);
    await context.route('**/*.{m4a,mp3,aac,wav,flac}', (route) => {
      aborted.n += 1;
      return route.abort();
    });
  }
  const audioHits = [];
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));
  page.on('response', (res) => {
    if (res.url().includes('.m4a')) {
      audioHits.push({ status: res.status(), type: res.headers()['content-type'] ?? '', length: res.headers()['content-length'] ?? '' });
    }
  });
  const samples = [];
  let summary = null;
  try {
    if (mode === 'native') {
      const served = await rangedTotal(`${server.url}/audio/${slug}/high.m4a`);
      if (!((served.status === 200 || served.status === 206) && served.total != null && served.total >= 100000)) {
        throw new Error(`real audio is not served (${served.status}, ${served.total} bytes). Decrypt and rebuild; do not commit the m4a.`);
      }
      log(`real audio ${served.total} bytes ${served.type || 'unknown type'}`);
    }
    await openPlaying(page, server.url);
    if (mode === 'pause') {
      await page.evaluate((target) => {
        const el = document.querySelector('audio');
        if (el) el.currentTime = target;
      }, pauseAt);
      await page.evaluate(() => {
        const el = document.querySelector('audio');
        if (el) el.pause();
      });
      await page.waitForTimeout(800);
      const held = await readAudio(page);
      if (held.paused !== true) throw new Error(`pause did not hold (paused=${held.paused}, t=${held.t})`);
      if (held.t == null || Math.abs(held.t - pauseAt) > 2) throw new Error(`pause landed at ${held.t}, wanted ${pauseAt}`);
      log(`paused at ${held.t}`);
    }
    const phone = await page.evaluate(() => document.documentElement.dataset.phone ?? '');
    if (phone !== '1') throw new Error(`phone flag is "${phone}", expected 1`);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const started = Date.now();
    const end = started + minutes * 60 * 1000;
    const pushSample = async (tag) => {
      const row = await sampleRow(page, cdp, started);
      row.tag = tag;
      samples.push(row);
      appendFileSync(samplesPath, `${JSON.stringify({ ...row, tree: undefined })}\n`);
      log(
        `${tag} tMin=${row.tMin} pos=${row.audio?.t} paused=${row.audio?.paused} ready=${row.audio?.ready} mediaError=${row.audio?.error} heap=${mb(row.metrics?.JSHeapUsedSize)}MB tree=${row.treeMb?.tree}MB renderer=${row.treeMb?.renderer}MB rendererMax=${row.treeMb?.rendererMax}MB gpu=${row.treeMb?.gpu}MB nodes=${row.nodes} docs=${row.metrics?.Documents} listeners=${row.metrics?.JSEventListeners}`,
      );
      return row;
    };
    await pushSample('start');
    const roles = roleMap(processTreeMemory(process.pid));
    let dumpStart = null;
    let dumpEnd = null;
    try {
      const captured = await captureMemoryDump(cdp);
      dumpStart = summarizeMemoryDump(captured.events, roles);
      dumpStart.how = captured.how;
      if (dumpStart.dumps === 0) dumpStart.shape = dumpShape(captured.events);
      log(`memory dump start dumps=${dumpStart.dumps} how=${captured.how} events=${captured.events.length}`);
    } catch (err) {
      dumpStart = { error: String(err).slice(0, 400) };
      log(`memory dump start failed ${dumpStart.error}`);
    }
    const startFile = join(dir, 'start.heapsnapshot');
    const startBytes = await takeHeapSnapshot(cdp, startFile);
    log(`snapshot start ${startBytes} bytes`);
    const startSummary = summarizeHeapSnapshot(JSON.parse(readFileSync(startFile, 'utf8')));
    log(`snapshot start nodes=${startSummary.nodeCount} self=${mb(startSummary.selfBytes)}MB detached=${startSummary.detached.count}`);

    while (Date.now() < end && !page.isClosed()) {
      const left = end - Date.now();
      if (left < 5000) break;
      await page.waitForTimeout(Math.min(sampleMs, left));
      if (Date.now() >= end - 2000) break;
      await pushSample('tick');
    }

    await pushSample('end-before-gc');
    try {
      const captured = await captureMemoryDump(cdp);
      dumpEnd = summarizeMemoryDump(captured.events, roleMap(processTreeMemory(process.pid)));
      dumpEnd.how = captured.how;
      if (dumpEnd.dumps === 0) dumpEnd.shape = dumpShape(captured.events);
      log(`memory dump end dumps=${dumpEnd.dumps} how=${captured.how} events=${captured.events.length}`);
    } catch (err) {
      dumpEnd = { error: String(err).slice(0, 400) };
      log(`memory dump end failed ${dumpEnd.error}`);
    }
    const endFile = join(dir, 'end.heapsnapshot');
    const endBytes = await takeHeapSnapshot(cdp, endFile);
    log(`snapshot end ${endBytes} bytes`);
    const endSummary = summarizeHeapSnapshot(JSON.parse(readFileSync(endFile, 'utf8')));
    log(`snapshot end nodes=${endSummary.nodeCount} self=${mb(endSummary.selfBytes)}MB detached=${endSummary.detached.count}`);

    const nameDiff = diffBuckets(startSummary.byName, endSummary.byName);
    const typeDiff = diffBuckets(startSummary.byType, endSummary.byType);
    const detachedDiff = diffBuckets(startSummary.detached.byName, endSummary.detached.byName);
    const slopeRows = samples.filter((row) => row.tMin >= 1);
    const used = slopeRows.length >= 3 ? slopeRows : samples;
    const pickMetric = (name) => slopePerMin(used, (row) => (typeof row.metrics?.[name] === 'number' ? row.metrics[name] : NaN));
    const audioEnd = samples[samples.length - 1]?.audio ?? null;
    const audioStart = samples[0]?.audio ?? null;
    let audioOk = true;
    let audioWhy = '';
    if (mode === 'pause') {
      audioOk = audioEnd != null && audioEnd.paused === true && audioEnd.t != null && Math.abs(audioEnd.t - pauseAt) <= 2;
      audioWhy = audioOk ? '' : `pause drifted to ${audioEnd?.t} paused=${audioEnd?.paused}`;
    } else if (mode === 'native') {
      const advanced = audioEnd?.t != null && audioStart?.t != null ? audioEnd.t - audioStart.t : 0;
      audioOk = audioEnd?.error === 0 && advanced > minutes * 60 * 0.7;
      audioWhy = audioOk ? '' : `native advance ${advanced}s error=${audioEnd?.error} hits=${audioHits.length}`;
    } else {
      const advanced = audioEnd?.t != null && audioStart?.t != null ? audioEnd.t - audioStart.t : 0;
      audioOk = advanced > minutes * 60 * 0.7 && aborted.n > 0;
      audioWhy = audioOk ? '' : `stand-in advance ${advanced}s aborted=${aborted.n}`;
    }
    summary = {
      mode,
      minutes,
      entry: entryFile(),
      browserPid: browserPid(browser),
      phone: phone,
      audioOk,
      audioWhy,
      aborted: aborted.n,
      audioHits: audioHits.slice(0, 6),
      pageErrors,
      samples: samples.length,
      slopeWindow: slopeRows.length >= 3 ? 'tMin>=1' : 'all',
      slopesMbPerMin: {
        jsHeap: pickMetric('JSHeapUsedSize') == null ? null : pickMetric('JSHeapUsedSize') / (1024 * 1024),
        jsHeapTotal: pickMetric('JSHeapTotalSize') == null ? null : pickMetric('JSHeapTotalSize') / (1024 * 1024),
        nodes: pickMetric('Nodes'),
        documents: pickMetric('Documents'),
        listeners: pickMetric('JSEventListeners'),
        tree: slopePerMin(used, (row) => row.treeMb?.tree),
        renderer: slopePerMin(used, (row) => row.treeMb?.renderer),
        rendererMax: slopePerMin(used, (row) => row.treeMb?.rendererMax),
        gpu: slopePerMin(used, (row) => row.treeMb?.gpu),
        browser: slopePerMin(used, (row) => row.treeMb?.browser),
        domNodes: slopePerMin(used, (row) => row.nodes),
        domListeners: slopePerMin(used, (row) => row.listeners),
      },
      first: {
        tMin: samples[0]?.tMin ?? null,
        audio: audioStart,
        jsHeap: samples[0]?.metrics?.JSHeapUsedSize ?? null,
        treeMb: samples[0]?.treeMb ?? null,
        documents: samples[0]?.metrics?.Documents ?? null,
        nodes: samples[0]?.metrics?.Nodes ?? null,
        listeners: samples[0]?.metrics?.JSEventListeners ?? null,
        dom: samples[0]?.dom ?? null,
      },
      last: {
        tMin: samples[samples.length - 1]?.tMin ?? null,
        audio: audioEnd,
        jsHeap: samples[samples.length - 1]?.metrics?.JSHeapUsedSize ?? null,
        treeMb: samples[samples.length - 1]?.treeMb ?? null,
        documents: samples[samples.length - 1]?.metrics?.Documents ?? null,
        nodes: samples[samples.length - 1]?.metrics?.Nodes ?? null,
        listeners: samples[samples.length - 1]?.metrics?.JSEventListeners ?? null,
        dom: samples[samples.length - 1]?.dom ?? null,
      },
      groups: diffGroups(startSummary, endSummary),
      typeDiff,
      topNames: notable(nameDiff, 40),
      topClosures: nameDiff.filter((row) => row.name.startsWith('closure:')).slice(0, 15),
      topDetached: detachedDiff.filter((row) => row.count !== 0 || row.bytes !== 0).slice(0, 20),
      watched: watchedDiff(nameDiff),
      memoryDump: {
        start: compactDump(dumpStart) ?? dumpStart,
        end: compactDump(dumpEnd) ?? dumpEnd,
        growth:
          dumpStart?.paths && dumpEnd?.paths
            ? diffNumbers(compactPaths(dumpStart.paths), compactPaths(dumpEnd.paths)).filter((row) => Math.abs(row.bytes) >= 65536).slice(0, 40)
            : null,
      },
      snapshots: { start: startFile, end: endFile, startBytes, endBytes },
      groupEnds: { start: heapGroups(startSummary), end: heapGroups(endSummary) },
    };
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    log(
      `done audioOk=${audioOk} ${audioWhy} jsHeap=${summary.slopesMbPerMin.jsHeap == null ? 'n/a' : summary.slopesMbPerMin.jsHeap.toFixed(3)} MB/min renderer=${summary.slopesMbPerMin.renderer == null ? 'n/a' : summary.slopesMbPerMin.renderer.toFixed(2)} MB/min gpu=${summary.slopesMbPerMin.gpu == null ? 'n/a' : summary.slopesMbPerMin.gpu.toFixed(2)} MB/min tree=${summary.slopesMbPerMin.tree == null ? 'n/a' : summary.slopesMbPerMin.tree.toFixed(2)} MB/min`,
    );
    if (!audioOk) throw new Error(audioWhy || 'audio check failed');
  } finally {
    await browser.close().catch(() => {});
  }
  return summary;
}

mkdirSync(outDir, { recursive: true });
const server = await serve();
process.stdout.write(`preview ${server.url}\n`);
const results = [];
let failed = false;
try {
  for (const mode of modes) {
    try {
      results.push(await runMode(mode, server));
    } catch (err) {
      failed = true;
      const error = String(err?.stack || err).slice(0, 800);
      results.push({ mode, error });
      process.stdout.write(`FAIL ${mode} ${error}\n`);
    }
  }
} finally {
  server.stop();
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(results.map((item) => ({ mode: item.mode, error: item.error ?? null, slopes: item.slopesMbPerMin ?? null, audioOk: item.audioOk ?? null })), null, 2));
if (failed) process.exitCode = 2;
