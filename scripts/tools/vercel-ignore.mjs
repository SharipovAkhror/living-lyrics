// Vercel ignored build step. Exit 0 skips the build, exit 1 builds.
// Production builds are skipped only when every path in the push is under
// ops/ or docs/. Previews always build. A missing parent (shallow clone) builds.
import { spawnSync } from 'node:child_process';

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
}

function finish(code, message) {
  console.log(`vercel-ignore: ${message}`);
  process.exit(code);
}

const env = process.env.VERCEL_ENV;
if (env !== 'production') finish(1, `build (VERCEL_ENV=${env || 'unset'})`);

const argBase = process.argv[2];
const argHead = process.argv[3];
let base;
let head;
if (argBase && argHead) {
  base = argBase;
  head = argHead;
} else if (argBase || argHead) {
  finish(1, 'build (usage: vercel-ignore.mjs [<base> <head>])');
} else {
  const parent = git(['rev-parse', '--verify', 'HEAD^']);
  if (parent.status !== 0) finish(1, 'build (no HEAD^)');
  base = 'HEAD^';
  head = 'HEAD';
}

const diff = git(['diff', '--name-only', base, head]);
if (diff.status !== 0) {
  const detail = (diff.stderr || diff.stdout || '').trim().split(/\r?\n/)[0] || 'git diff failed';
  finish(1, `build (${detail})`);
}
const files = diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (files.length === 0) finish(1, 'build (empty diff)');
const docsOrOps = (file) => file.startsWith('docs/') || file.startsWith('ops/');
if (files.every(docsOrOps)) finish(0, `skip (${files.length} path(s) under ops/ or docs/)`);
finish(1, 'build (paths outside ops/ and docs/)');
