/**
 * Round 4 memory arms, one after another, against a preview that is already up.
 * Pressure first (10 min), then 12-minute WebKit arms. Does not stop on a slope.
 *
 *   node scripts/perf/round4-suite.mjs --url http://127.0.0.1:4179
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:4179';
const outDir = 'work/perf/t27';
mkdirSync(outDir, { recursive: true });
const log = `${outDir}/round4-suite.log`;

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const steps = [
  ['scripts/perf/pressure.mjs', '--url', url, '--minutes', '10', '--alloc-mb', '768', '--out', outDir],
  ['scripts/perf/long-run.mjs', '--url', url, '--minutes', '12', '--browser', 'webkit', '--no-sheet', '--label', 'r4-base', '--out', outDir],
  ['scripts/perf/long-run.mjs', '--url', url, '--minutes', '12', '--browser', 'webkit', '--no-sheet', '--arm', 'quantize', '--label', 'r4-quantize', '--out', outDir],
  ['scripts/perf/long-run.mjs', '--url', url, '--minutes', '12', '--browser', 'webkit', '--no-sheet', '--arm', 'quantize-px', '--label', 'r4-quantize-px', '--out', outDir],
  ['scripts/perf/long-run.mjs', '--url', url, '--minutes', '12', '--browser', 'webkit', '--no-sheet', '--bisect', 'glow', '--label', 'r4-glow', '--out', outDir],
  ['scripts/perf/long-run.mjs', '--url', url, '--minutes', '12', '--browser', 'webkit', '--no-sheet', '--bisect', 'layer', '--label', 'r4-layer', '--out', outDir],
];

const codes = [];
for (const args of steps) {
  const line = `\n=== ${new Date().toISOString()} ${args.join(' ')} ===\n`;
  process.stdout.write(line);
  writeFileSync(log, line, { flag: 'a' });
  const code = await run(args);
  codes.push({ args: args.join(' '), code });
  const done = `exit ${code}\n`;
  process.stdout.write(done);
  writeFileSync(log, done, { flag: 'a' });
}
process.stdout.write(`${JSON.stringify(codes, null, 2)}\n`);
process.exit(codes.every((c) => c.code === 0) ? 0 : 1);
