/**
 * After 10 minutes of WebKit growth, allocate in a second page and see if the
 * song process gives memory back. Playwright WebKit has no iOS memory warning.
 *
 *   node scripts/perf/pressure.mjs --url http://127.0.0.1:4179 --minutes 10
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { webkit } from 'playwright';
import {
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
const minutes = Number(flag(args, '--minutes', '10'));
const allocMb = Number(flag(args, '--alloc-mb', '768'));
const outDir = flag(args, '--out', 'work/perf/t27');
const songSeconds = Number(flag(args, '--song-seconds', '977'));
mkdirSync(outDir, { recursive: true });

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function processTable(rootPid) {
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
    '$rows = foreach ($p in $procs) {',
    '  if (-not $set.Contains([int]$p.ProcessId)) { continue }',
    '  if ([string]$p.Name -match "^(node|powershell|pwsh|cmd|conhost)") { continue }',
    '  "{0}`t{1}`t{2}" -f $p.ProcessId, $p.WorkingSetSize, $p.Name',
    '}',
    '$rows -join "`n"',
  ].join('; ');
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 });
    return out
      .trim()
      .split(/\n/)
      .filter(Boolean)
      .map((line) => {
        const [pid, bytes, name] = line.trim().split('\t');
        return { pid: Number(pid), bytes: Number(bytes), name };
      })
      .filter((row) => Number.isFinite(row.bytes));
  } catch (err) {
    return [{ pid: 0, bytes: 0, name: `table-failed ${err.message}` }];
  }
}

const audio = prepareAudio(songSeconds, outDir);
const browser = await webkit.launch();
const context = await browser.newContext(phoneContext());
await installProbe(context);
await installAudioRoute(context, audio.body, audio.type);
await installStandInClock(context, songSeconds);
const page = await context.newPage();
const samples = [];
const file = `${outDir}/pressure-${stamp()}.jsonl`;
const rootPid = process.pid;

function sample(phase) {
  const tree = workingSetTree(rootPid);
  const processes = processTable(rootPid);
  return { phase, tree, processes };
}

await page.goto(`${url.replace(/\/$/, '')}/song/karitas`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.scrub-track', { timeout: 30000 });
const play = page.getByRole('button', { name: 'Воспроизвести' });
if (await play.count()) await play.click();
const caps = await page.evaluate(() => ({
  memory: typeof performance !== 'undefined' && 'memory' in performance,
  gc: typeof window.gc === 'function',
  pressure: typeof window.onmemorypressure === 'function' || 'onmemorypressure' in window,
}));
process.stdout.write(`page caps ${JSON.stringify(caps)}\n`);

const started = Date.now();
const growEnd = started + minutes * 60 * 1000;
let nextSeek = started + 15000;
let seekN = 0;
while (Date.now() < growEnd) {
  const now = Date.now();
  if (now >= nextSeek) {
    seekN += 1;
    const track = page.locator('.scrub-track');
    const box = await track.boundingBox();
    if (box) {
      const frac = seekN % 5 === 0 ? 0.02 : 0.08 + Math.random() * 0.84;
      await track.click({ position: { x: Math.max(6, box.width * frac), y: box.height / 2 }, force: true }).catch(() => {});
    }
    nextSeek = now + 35000;
  }
  const row = {
    tMin: (Date.now() - started) / 60000,
    phase: 'grow',
    ...(await probe(page).catch((err) => ({ probeError: String(err) }))),
    ...sample('grow'),
  };
  if (row.tree) row.workingSet = row.tree.bytes;
  samples.push(row);
  writeFileSync(file, samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
  process.stdout.write(`grow t=${row.tMin.toFixed(2)} ws=${row.workingSet ? (row.workingSet / 1048576).toFixed(0) : '?'} MB nodes=${row.nodes} procs=${row.processes.map((p) => `${p.name}:${(p.bytes / 1048576).toFixed(0)}`).join(',')}\n`);
  const left = growEnd - Date.now();
  if (left <= 0) break;
  await page.waitForTimeout(Math.min(30000, left));
}

const before = samples[samples.length - 1];
const songPid = before.processes.find((p) => /WebKitWebProcess/i.test(p.name))?.pid ?? null;
process.stdout.write(`song web process ${songPid}\n`);

const allocator = await context.newPage();
await allocator.goto('about:blank');
const allocated = await allocator.evaluate(async (mb) => {
  const chunks = [];
  const chunk = 16 * 1024 * 1024;
  let got = 0;
  const target = mb * 1024 * 1024;
  try {
    while (got < target) {
      const bin = new Uint8Array(chunk);
      bin.fill(1);
      chunks.push(bin);
      got += chunk;
      if (chunks.length % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } catch (err) {
    window.__hold = chunks;
    return { got, error: String(err) };
  }
  window.__hold = chunks;
  return { got, error: null };
}, allocMb);
process.stdout.write(`allocated ${JSON.stringify(allocated)}\n`);
await page.waitForTimeout(8000);
const held = {
  tMin: (Date.now() - started) / 60000,
  phase: 'held',
  allocated,
  ...(await probe(page).catch((err) => ({ probeError: String(err) }))),
  ...sample('held'),
};
if (held.tree) held.workingSet = held.tree.bytes;
samples.push(held);
writeFileSync(file, samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
process.stdout.write(`held ws=${(held.workingSet / 1048576).toFixed(0)} MB procs=${held.processes.map((p) => `${p.name}#${p.pid}:${(p.bytes / 1048576).toFixed(0)}`).join(',')}\n`);

await allocator.evaluate(() => {
  window.__hold = null;
});
await allocator.close();
await page.waitForTimeout(20000);
const released = {
  tMin: (Date.now() - started) / 60000,
  phase: 'released',
  ...(await probe(page).catch((err) => ({ probeError: String(err) }))),
  ...sample('released'),
};
if (released.tree) released.workingSet = released.tree.bytes;
samples.push(released);
writeFileSync(file, samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
process.stdout.write(`released ws=${(released.workingSet / 1048576).toFixed(0)} MB procs=${released.processes.map((p) => `${p.name}#${p.pid}:${(p.bytes / 1048576).toFixed(0)}`).join(',')}\n`);

await page.waitForTimeout(90000);
const later = {
  tMin: (Date.now() - started) / 60000,
  phase: 'later',
  ...(await probe(page).catch((err) => ({ probeError: String(err) }))),
  ...sample('later'),
};
if (later.tree) later.workingSet = later.tree.bytes;
samples.push(later);
writeFileSync(file, samples.map((s) => JSON.stringify(s)).join('\n') + '\n');

const warm = samples.filter((s) => s.phase === 'grow' && s.tMin >= 1);
const mb = (n) => (n ? Math.round((n / 1048576) * 10) / 10 : null);
const same = (row) => row.processes.find((p) => p.pid === songPid);
const summary = {
  file,
  caps,
  allocated,
  songPid,
  slopeMb: slopePerMin(warm, (s) => (s.workingSet ?? NaN) / (1024 * 1024)),
  nodesSlope: slopePerMin(warm, (s) => s.nodes),
  listenersSlope: slopePerMin(warm, (s) => s.listeners),
  beforeMb: mb(before.workingSet),
  heldMb: mb(held.workingSet),
  releasedMb: mb(released.workingSet),
  laterMb: mb(later.workingSet),
  songBeforeMb: mb(same(before)?.bytes),
  songHeldMb: mb(same(held)?.bytes),
  songReleasedMb: mb(same(released)?.bytes),
  songLaterMb: mb(same(later)?.bytes),
  nodes: { before: before.nodes, released: released.nodes, later: later.nodes },
  listeners: { before: before.listeners, later: later.listeners },
  canvases: later.canvases,
};
writeFileSync(`${outDir}/pressure-${stamp()}-summary.json`, JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
await browser.close();
