// WebKit working set on the phone profile while a song page stays open.
// Usage: node scripts/tools/studio-memory.mjs --port 4175 --minutes 12 --out work/studio/memory-round5.json --label round5
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { webkit } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const port = Number(args.port || 4175);
const minutes = Number(args.minutes || 12);
const outDirFlag = args.outDir || 'work/studio/round5-dist';
const out = args.out || 'work/studio/memory.json';
const label = args.label || 'memory';
const base = `http://127.0.0.1:${port}`;

function serve() {
  const child = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--outDir', outDirFlag, '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (b) => {
    log += b.toString();
  });
  child.stderr.on('data', (b) => {
    log += b.toString();
  });
  return { child, read: () => log };
}

function psJson(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    ps.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    ps.on('exit', (code) => {
      if (code !== 0) reject(new Error(stderr || `powershell ${code}`));
      else resolve(stdout.trim());
    });
  });
}

/** Every process id and its parent, so a browser born after launch can be followed. */
async function processTable() {
  const raw = await psJson(
    "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize | ConvertTo-Json -Compress",
  );
  const rows = JSON.parse(raw || '[]');
  return Array.isArray(rows) ? rows : [rows];
}

function workingSetOf(table, roots) {
  const ids = new Set(roots);
  let guard = 0;
  let growing = true;
  while (growing && guard < 16) {
    guard += 1;
    growing = false;
    for (const row of table) {
      const id = Number(row.ProcessId);
      const parent = Number(row.ParentProcessId);
      if (ids.has(parent) && !ids.has(id)) {
        ids.add(id);
        growing = true;
      }
    }
  }
  let bytes = 0;
  let count = 0;
  for (const row of table) {
    if (!ids.has(Number(row.ProcessId))) continue;
    bytes += Number(row.WorkingSetSize) || 0;
    count += 1;
  }
  return { bytes, count };
}

function workingSet(pid) {
  const script = `
$root = ${Number(pid)}
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize)
$ids = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$ids.Add($root)
$guard = 0
while ($guard -lt 12) {
  $guard++
  $added = $false
  foreach ($p in $all) {
    $id = [int]$p.ProcessId
    $parent = [int]$p.ParentProcessId
    if ($ids.Contains($parent) -and -not $ids.Contains($id)) {
      [void]$ids.Add($id)
      $added = $true
    }
  }
  if (-not $added) { break }
}
$sum = [int64]0
$count = 0
foreach ($p in $all) {
  if ($ids.Contains([int]$p.ProcessId)) {
    $sum += [int64]$p.WorkingSetSize
    $count++
  }
}
Write-Output ("{0} {1}" -f $sum, $count)
`;
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    ps.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    ps.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `powershell ${code}`));
        return;
      }
      const [bytes, count] = stdout.trim().split(/\s+/).map(Number);
      resolve({ bytes, count });
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base);
      if (res.ok || res.status === 404) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`preview did not answer on ${base}`);
}

const preview = serve();
let browser;
try {
  await waitForServer();
  const before = new Set((await processTable()).map((row) => Number(row.ProcessId)));
  browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${base}/song/karitas?t=42`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const play = page.locator('button.btn-xl').first();
  if (await play.count()) await play.click({ timeout: 5000 }).catch(() => {});
  const born = (await processTable())
    .map((row) => Number(row.ProcessId))
    .filter((id) => !before.has(id));
  if (!born.length) throw new Error('no browser process appeared');
  console.log(`${label} browser pids ${born.join(',')}`);
  const samples = [];
  const until = Date.now() + minutes * 60 * 1000;
  while (Date.now() <= until) {
    const sample = workingSetOf(await processTable(), born);
    const row = { t: Date.now(), mb: Math.round((sample.bytes / 1048576) * 10) / 10, bytes: sample.bytes, processes: sample.count };
    samples.push(row);
    console.log(`${label} ${row.mb} MB (${row.processes} procs)`);
    const left = until - Date.now();
    if (left <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(15000, left)));
  }
  const mbs = samples.map((s) => s.mb);
  const sorted = [...mbs].sort((a, b) => a - b);
  const report = {
    label,
    minutes,
    profile: 'webkit 393x852 dsf 3 touch',
    pids: born,
    samples: samples.length,
    startMb: mbs[0] ?? null,
    endMb: mbs[mbs.length - 1] ?? null,
    minMb: sorted[0] ?? null,
    maxMb: sorted[sorted.length - 1] ?? null,
    medianMb: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    growthMb: mbs.length ? Math.round((mbs[mbs.length - 1] - mbs[0]) * 10) / 10 : null,
    series: samples,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);
  console.log(JSON.stringify({ ...report, series: undefined }));
} finally {
  await browser?.close().catch(() => {});
  preview.child.kill();
  if (preview.child.exitCode == null) {
    spawn('taskkill', ['/F', '/T', '/PID', String(preview.child.pid)], { shell: true, stdio: 'ignore' });
  }
}
