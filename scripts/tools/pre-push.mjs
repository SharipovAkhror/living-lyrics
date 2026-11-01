// pre-push: run `npm run precheck` only when a site/* branch is updated.
// Git passes one line per ref on stdin:
//   <local ref> <local sha> <remote ref> <remote sha>
// A delete (local sha all zeros) is not checked. Any other update whose
// local or remote ref is refs/heads/site/* runs precheck once.
// Bypass the hook with `git push --no-verify` (see AGENTS.md).
import { spawnSync } from 'node:child_process';

const ZERO = '0'.repeat(40);

function isSite(ref) {
  return typeof ref === 'string' && ref.startsWith('refs/heads/site/');
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

const text = await readStdin();
let run = false;
for (const line of text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [localRef, localSha, remoteRef] = line.split(/\s+/);
  const deleting = localSha === ZERO;
  const site = !deleting && (isSite(localRef) || isSite(remoteRef));
  const why = site ? 'precheck' : deleting ? 'delete, skip' : 'skip';
  console.log(`pre-push: ${localRef} -> ${remoteRef} (${why})`);
  if (site) run = true;
}

if (!run) {
  if (!text.trim()) console.log('pre-push: no site/* update, skip precheck');
  process.exit(0);
}

console.log(`pre-push: running npm run precheck in ${process.cwd()}`);
const result = spawnSync('npm', ['run', 'precheck'], {
  stdio: 'inherit',
  // Windows resolves npm through npm.cmd. shell:true does that from Git Bash too.
  shell: process.platform === 'win32',
  windowsHide: true,
});
if (result.error) {
  console.error(`pre-push: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
