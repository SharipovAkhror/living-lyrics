/**
 * Five-minute WebKit seek plateaus, one live-scene part disabled at a time.
 *
 *   npx vite preview --host 127.0.0.1 --port 4179 --strictPort
 *   node scripts/perf/bisect-scene.mjs http://127.0.0.1:4179
 *
 * The settings sheet stays closed: an open sheet pauses the scene and hides the leak.
 * Summaries land in work/perf/t27/.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4179';
const arms = [
  ['baseline', ''],
  ['field', 'field'],
  ['instruments', 'instruments'],
  ['words', 'words'],
  ['placement', 'placement'],
  ['scrubber', 'scrubber'],
  ['mediasession', 'mediasession'],
  ['react', 'react'],
];

mkdirSync('work/perf/t27', { recursive: true });
const rows = [];
for (const [label, name] of arms) {
  const args = [
    'scripts/perf/long-run.mjs',
    '--url',
    url,
    '--minutes',
    '5',
    '--browser',
    'webkit',
    '--sample-ms',
    '15000',
    '--no-sheet',
    '--label',
    label,
    '--out',
    'work/perf/t27',
  ];
  if (name) args.push('--bisect', name);
  process.stdout.write(`\n==== arm ${label} ====\n`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  rows.push({ label, bisect: name || 'all', status: result.status, minutes: (Date.now() - started) / 60000 });
  writeFileSync('work/perf/t27/bisect-arms.json', JSON.stringify(rows, null, 2));
  if (result.status !== 0) process.stdout.write(`arm ${label} exited ${result.status}\n`);
}
process.stdout.write(`\nbisect arms done\n${JSON.stringify(rows, null, 2)}\n`);
