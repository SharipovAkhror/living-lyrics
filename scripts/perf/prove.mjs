// Proves D28–D30 and D33 bite. Each planted fault must FAIL on the live preview,
// in both engines. Exit 0 only when all four do. Not part of `npm run gate`.
// node scripts/perf/prove.mjs
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4176;
const base = `http://127.0.0.1:${PORT}`;

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      out += chunk;
    });
    child.on('exit', (code) => resolve({ code: code ?? 1, out }));
  });
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { shell: true, stdio: 'ignore' });
  } else {
    child.kill();
  }
}

async function waitForPreview() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(base);
      if (res.status < 500) return;
    } catch {
      /* the preview is still starting */
    }
    await delay(250);
  }
  throw new Error(`preview did not answer on ${base}`);
}

function linesOf(out, engine, row) {
  return out.split(/\r?\n/).filter((line) => line.includes(engine) && line.includes(row));
}

/** D28: every tap row fails, and the measured wait is the planted 300 ms. */
function expectDelay(out) {
  const problems = [];
  for (const engine of ['chromium', 'webkit']) {
    const rows = linesOf(out, engine, 'D28 tap-to-motion');
    if (rows.length < 4) problems.push(`${engine} D28 ran ${rows.length} rows`);
    for (const line of rows) {
      if (!line.startsWith('FAIL')) {
        problems.push(line);
        continue;
      }
      const ms = /(\d+) ms after the first frame/.exec(line);
      const n = ms ? Number(ms[1]) : -1;
      if (n < 200 || n > 500) problems.push(line);
    }
  }
  return problems;
}

/** D29: both engines fail and name the blank frame and the black frame. */
function expectBlank(out) {
  const problems = [];
  for (const engine of ['chromium', 'webkit']) {
    const rows = linesOf(out, engine, 'D29 scrub-no-blank').filter((line) => line.startsWith('FAIL'));
    if (!rows.length) {
      problems.push(`${engine} D29 did not fail`);
      continue;
    }
    const line = rows[0];
    const frames = [...line.matchAll(/frame (\d+)/g)].map((m) => Number(m[1]));
    const undrawn = /player-/.test(line);
    const dark = /dark 0\.\d+/.test(line) && !/dark 0\.000/.test(line);
    if (frames.length < 2 || !undrawn || !dark) problems.push(line);
  }
  return problems;
}

/** D30: the flight fails with both a stall and a spike, in both engines. */
function expectFreeze(out) {
  const problems = [];
  for (const engine of ['chromium', 'webkit']) {
    const rows = linesOf(out, engine, 'D30 continuity').filter((line) => line.startsWith('FAIL') && line.includes('flight'));
    if (!rows.length) {
      problems.push(`${engine} D30 flight did not fail`);
      continue;
    }
    const line = rows[0];
    if (!/spikes [1-9]/.test(line) || !/stalls [1-9]/.test(line)) problems.push(line);
  }
  return problems;
}

/** D33: both engines fail the row-arrival check on the planted pop. */
function expectRowPop(out) {
  const problems = [];
  for (const engine of ['chromium', 'webkit']) {
    const rows = linesOf(out, engine, 'D33 rows-arrive-still').filter((line) => line.startsWith('FAIL'));
    if (!rows.length) problems.push(`${engine} D33 did not fail`);
  }
  return problems;
}

const checks = [
  ['a', expectDelay],
  ['b', expectBlank],
  ['c', expectFreeze],
  ['d', expectRowPop],
];

const built = await run('npx', ['vite', 'build']);
if (built.code !== 0) process.exit(built.code || 1);

const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  shell: true,
  stdio: 'inherit',
});

let failed = false;
try {
  await waitForPreview();
  for (const [kind, expect] of checks) {
    console.log(`\nprove mutate ${kind}`);
    const motion = await run('node', ['scripts/perf/motion.mjs', '--base', base, '--mutate', kind]);
    const problems = expect(motion.out);
    if (motion.code === 0 || problems.length) {
      failed = true;
      console.log(`prove mutate ${kind} MISSED`);
      for (const problem of problems) console.log(`  ${problem}`);
    } else {
      console.log(`prove mutate ${kind} bit, as required`);
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  failed = true;
} finally {
  killTree(preview);
  await delay(400);
}

if (failed) {
  console.log('prove failed');
  process.exit(1);
}
console.log('prove ok');
