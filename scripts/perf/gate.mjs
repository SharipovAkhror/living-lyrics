// One regression gate: fixed-defect checks, motion on drawn frames, geometry, speed budget, validate, typecheck.
// node scripts/perf/gate.mjs
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4176;
const gateStart = Date.now();
const base = `http://127.0.0.1:${PORT}`;

function run(command, args, capture = false) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let out = '';
    if (capture) {
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        out += chunk;
      });
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
        out += chunk;
      });
    }
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

const validate = await run('npm', ['run', 'validate']);
if (validate.code !== 0) process.exit(validate.code);
const types = await run('npm', ['run', 'typecheck']);
if (types.code !== 0) process.exit(types.code);

const built = await run('npx', ['vite', 'build'], true);
const budgetOk = built.code === 0 && /speed budget ok/.test(built.out);
console.log(`${budgetOk ? 'PASS' : 'FAIL'} D20 speed-budget ${budgetOk ? 'speed budget ok' : 'vite build failed the budget'}`);
if (!budgetOk) process.exit(built.code || 1);

let cssGzip = 0;
try {
  const css = readdirSync('dist/assets').find((name) => name.startsWith('index-') && name.endsWith('.css'));
  if (css) cssGzip = gzipSync(readFileSync(`dist/assets/${css}`)).length;
} catch {
  /* the report prints the number when the file is there */
}
console.log(`gate css gzip ${cssGzip}`);

const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  shell: true,
  stdio: 'inherit',
});
let failed = false;
try {
  await waitForPreview();
  const defects = await run('node', ['scripts/perf/defects.mjs', '--base', base]);
  if (defects.code !== 0) failed = true;
  const geometry = await run('node', ['scripts/perf/geometry.mjs', '--base', base]);
  if (geometry.code !== 0) failed = true;
  const motion = await run('node', ['scripts/perf/motion.mjs', '--base', base]);
  if (motion.code !== 0) failed = true;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  failed = true;
} finally {
  killTree(preview);
  await delay(400);
}

const minutes = ((Date.now() - gateStart) / 60000).toFixed(1);
if (failed) {
  console.log(`gate failed after ${minutes} min`);
  process.exit(1);
}
console.log(`gate ok in ${minutes} min`);
