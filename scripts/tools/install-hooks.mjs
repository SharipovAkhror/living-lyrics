// Sets core.hooksPath so a clone picks up .githooks on npm install.
// Exits 0 when git is missing or this directory is not a work tree:
// npm install must succeed on a machine without git (and on Vercel).
import { spawnSync } from 'node:child_process';

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
}

const inside = git(['rev-parse', '--is-inside-work-tree']);
if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') process.exit(0);

// --local writes the worktree config in a linked worktree, not the global file.
const set = git(['config', '--local', 'core.hooksPath', '.githooks']);
if (set.status !== 0) {
  const detail = (set.stderr || set.stdout || set.error?.message || '').trim();
  if (detail) console.warn(`install-hooks: ${detail}`);
  process.exit(0);
}
console.log('install-hooks: core.hooksPath=.githooks');
