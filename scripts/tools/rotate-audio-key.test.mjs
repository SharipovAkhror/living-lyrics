// Dry run of the audio-key rotation. The key must not appear in stdout, stderr,
// command arguments, child environments, or any file except .env.local.
// Run: node scripts/tools/rotate-audio-key.test.mjs
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv } from 'node:crypto';
import {
  decryptBuffer,
  defaultSpawn,
  DONE_LINE,
  encryptBuffer,
  rekeyTree,
  rotateAudioKey,
  VERCEL_ORG_ID,
  VERCEL_PACKAGE,
  VERCEL_PROJECT_ID,
} from './rotate-audio-key.mjs';

const DONE = 'Готово — напишите в LL · Main «ключ готов»';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function lastLine(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.length > 0);
  return lines[lines.length - 1] || '';
}

function assertNoKey(label, text, key) {
  const value = text == null ? '' : String(text);
  if (key && (value.includes(key) || value.includes(key.toUpperCase()))) {
    throw new Error(`${label} contains the key (value not printed)`);
  }
}

function assertSameBytes(label, buf, key) {
  const expect = Buffer.from(key, 'utf8');
  if (buf.length !== expect.length || !timingSafeEqual(buf, expect)) {
    throw new Error(`${label}: stdin does not match the key (values not printed)`);
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) walk(path, out);
    else if (ent.isFile()) out.push(path);
  }
  return out;
}

function assertTreeHidesKey(dir, key) {
  for (const file of walk(dir)) {
    if (file.endsWith(`${sep}.env.local`) || file.endsWith('/.env.local')) continue;
    assertNoKey(file, readFileSync(file), key);
  }
}

function porcelain(paths) {
  return paths.map((path, index) => `worktree ${path}\nHEAD ${index}\nbranch refs/heads/test\n`).join('\n');
}

function createWorld(options = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'll-rotate-test-'));
  const primary = join(sandbox, 'living-lyrics');
  const empty = join(sandbox, 'wt-empty');
  const keep = join(sandbox, 'wt-keep');
  mkdirSync(primary, { recursive: true });
  mkdirSync(empty, { recursive: true });
  mkdirSync(keep, { recursive: true });
  writeFileSync(join(primary, '.env.local'), 'OTHER=1\n', 'utf8');
  writeFileSync(join(keep, '.env.local'), 'KEEP=1\n', 'utf8');
  const paths = options.paths || [primary, empty, keep];
  const runs = [];
  let runSeq = 1000;
  let watchCount = 0;
  let whoamiFails = options.whoamiFails || 0;
  const calls = [];

  function spawnCommand(command, args, opts = {}) {
    const stdin = opts.input == null ? Buffer.alloc(0) : Buffer.from(opts.input);
    const env = opts.env || {};
    calls.push({
      command,
      args: [...args],
      stdin,
      stdinSha256: createHash('sha256').update(stdin).digest('hex'),
      cwd: opts.cwd || '',
      inherit: !!opts.inherit,
      env,
    });
    const reply = (code, stdout = '', stderr = '') => Promise.resolve({ code, stdout, stderr });
    if (command === 'git') {
      if (args[0] === 'worktree') return reply(0, porcelain(paths));
      if (args.includes('check-ignore')) return reply(options.ignoreCode == null ? 0 : options.ignoreCode, '');
      if (args.includes('remote')) return reply(0, 'https://github.com/SharipovAkhror/living-lyrics.git\n');
      return reply(1, '', `unexpected git ${args.join(' ')}`);
    }
    if (command === 'gh') {
      if (args[0] === 'secret' && args[1] === 'set') return reply(0, '');
      if (args[0] === 'workflow' && args[1] === 'view') {
        if (options.workflowVisible === false) return reply(1, '', 'could not find workflow rekey-audio.yml');
        return reply(0, 'rekey-audio\n');
      }
      if (args[0] === 'workflow' && args[1] === 'run') {
        runSeq += 1;
        runs.push({
          databaseId: runSeq,
          status: 'queued',
          conclusion: null,
          createdAt: new Date().toISOString(),
          event: 'workflow_dispatch',
          url: `https://example.test/runs/${runSeq}`,
          headBranch: 'main',
        });
        return reply(0, '');
      }
      if (args[0] === 'run' && args[1] === 'list') return reply(0, `${JSON.stringify(runs)}\n`);
      if (args[0] === 'run' && args[1] === 'view') {
        const id = String(args[2]);
        const run = runs.find((item) => String(item.databaseId) === id);
        if (!run) return reply(1, '', 'not found');
        return reply(0, `${JSON.stringify(run)}\n`);
      }
      if (args[0] === 'run' && args[1] === 'watch') {
        watchCount += 1;
        const id = String(args[2]);
        const run = runs.find((item) => String(item.databaseId) === id);
        const fail = options.failWatchOnce && watchCount === 1;
        if (run) {
          run.status = 'completed';
          run.conclusion = fail ? 'failure' : 'success';
        }
        return reply(fail ? 1 : 0, '', fail ? 'run failed\n' : '');
      }
      return reply(1, '', `unexpected gh ${args.join(' ')}`);
    }
    if (command === 'npx') {
      const line = args.join(' ');
      if (!line.includes(VERCEL_PACKAGE)) return reply(1, '', 'vercel package not pinned');
      if (line.includes('whoami')) {
        if (whoamiFails > 0) {
          whoamiFails -= 1;
          return reply(1, '', 'not logged in');
        }
        return reply(0, 'owner\n');
      }
      if (line.includes(' login')) return reply(0, '');
      if (line.includes('env ls production')) return reply(0, 'AUDIO_KEY Encrypted Production\n');
      if (line.includes('env ls preview')) return reply(0, 'AUDIO_KEY Encrypted Preview\n');
      if (line.includes('env rm')) return reply(0, 'Removed\n');
      if (line.includes('env add')) return reply(0, 'Added\n');
      return reply(1, '', `unexpected npx ${line}`);
    }
    return reply(1, '', `unexpected ${command}`);
  }

  function run() {
    let stdout = '';
    let stderr = '';
    return rotateAudioKey({
      dryRun: true,
      sandbox,
      cwd: primary,
      spawn: spawnCommand,
      sleep: async () => {},
      env: {
        PATH: process.env.PATH || '',
        AUDIO_KEY: 'ab'.repeat(32),
        AUDIO_KEY_NEW: 'cd'.repeat(32),
        AUDIO_KEY_OLD: 'ef'.repeat(32),
      },
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
    }).then((result) => ({ result, stdout, stderr }));
  }

  return { sandbox, primary, empty, keep, calls, run, runs };
}

function keyFrom(primary) {
  const text = readFileSync(join(primary, '.env.local'), 'utf8');
  const match = text.match(/^AUDIO_KEY=([0-9a-f]{64})$/m);
  if (!match) throw new Error('primary .env.local has no 64-hex key (value not printed)');
  return match[1];
}

function assertCallsClean(calls, key) {
  for (const call of calls) {
    assertNoKey('command', call.command, key);
    for (const arg of call.args) assertNoKey('arg', arg, key);
    for (const [name, value] of Object.entries(call.env)) {
      if (name === 'AUDIO_KEY' || name === 'AUDIO_KEY_NEW' || name === 'AUDIO_KEY_OLD') {
        throw new Error(`child env still has ${name}`);
      }
      if (typeof value === 'string') assertNoKey(`env ${name}`, value, key);
    }
  }
}

function secretStdins(calls) {
  return calls.filter((call) => call.command === 'gh' && call.args[0] === 'secret' && call.args[1] === 'set');
}

function addStdins(calls) {
  return calls.filter((call) => call.command === 'npx' && call.args.join(' ').includes('env add'));
}

test('full dry run hides the key and writes it only to ignored env files', async () => {
  const world = createWorld();
  try {
    const { result, stdout, stderr } = await world.run();
    if (!result.ok) throw new Error(`dry run failed: ${stderr}`);
    const key = keyFrom(world.primary);
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('key is not 64 lowercase hex');
    assertNoKey('stdout', stdout, key);
    assertNoKey('stderr', stderr, key);
    if (lastLine(stdout) !== DONE) throw new Error('final line is not the required sentence');
    if (DONE !== DONE_LINE) throw new Error('exported done line drifted');
    assertCallsClean(world.calls, key);
    assertTreeHidesKey(world.sandbox, key);
    const envText = readFileSync(join(world.primary, '.env.local'), 'utf8');
    if (!envText.startsWith('OTHER=1\n')) throw new Error('existing env lines were not kept');
    if (readFileSync(join(world.empty, '.env.local'), 'utf8') !== envText) throw new Error('empty worktree did not receive the env file');
    if (readFileSync(join(world.keep, '.env.local'), 'utf8') !== 'KEEP=1\n') throw new Error('existing worktree env was overwritten');
    const secrets = secretStdins(world.calls);
    const adds = addStdins(world.calls);
    if (/[0-9a-fA-F]{64}/.test(stdout) || /[0-9a-fA-F]{64}/.test(stderr)) {
      throw new Error('a 64-hex string appeared in output');
    }
    if (secrets.length !== 2) throw new Error(`expected two gh secret set calls, got ${secrets.length}`);
    if (secrets[0].args[2] !== 'AUDIO_KEY_NEW' || secrets[1].args[2] !== 'AUDIO_KEY') throw new Error('secret names are not AUDIO_KEY_NEW then AUDIO_KEY');
    if (adds.length !== 2) throw new Error(`expected two vercel env add calls, got ${adds.length}`);
    for (const call of [...secrets, ...adds]) assertSameBytes(call.args.join(' '), call.stdin, key);
    for (const call of adds) {
      const line = call.args.join(' ');
      if (!line.includes('--sensitive') || !line.includes('--yes') || !line.includes('--non-interactive')) {
        throw new Error('env add is missing --sensitive, --yes, or --non-interactive');
      }
      if (call.env.CI) throw new Error('CI was set for vercel and would block the login browser');
    }
    const removed = world.calls.filter((call) => call.command === 'npx' && call.args.join(' ').includes('env rm'));
    if (removed.length !== 2) throw new Error(`expected two env rm calls, got ${removed.length}`);
    for (const call of removed) {
      const line = call.args.join(' ');
      if (!line.includes('--yes') || !line.includes('--non-interactive')) throw new Error('env rm is missing --yes or --non-interactive');
    }
    if (world.calls.some((call) => call.args.includes('AUDIO_KEY_OLD'))) throw new Error('AUDIO_KEY_OLD was set');
    const vercelCalls = world.calls.filter((call) => call.command === 'npx');
    if (vercelCalls.some((call) => call.cwd === world.primary)) throw new Error('vercel ran inside the repo');
    for (const call of vercelCalls) {
      if (call.env.VERCEL_ORG_ID !== VERCEL_ORG_ID || call.env.VERCEL_PROJECT_ID !== VERCEL_PROJECT_ID) {
        throw new Error('vercel project env was not pinned');
      }
    }
    if (world.calls.some((call) => call.args.includes('login'))) throw new Error('login ran after a successful whoami');
    const ignore = world.calls.filter((call) => call.command === 'git' && call.args.includes('check-ignore'));
    if (ignore.length < 2) throw new Error('git check-ignore was not called');
  } finally {
    rmSync(world.sandbox, { recursive: true, force: true });
  }
});

test('interruption at step 3 resumes with the same key', async () => {
  const world = createWorld({ failWatchOnce: true });
  try {
    const first = await world.run();
    if (first.result.ok) throw new Error('first run should stop at step 3');
    if (lastLine(first.stdout) === DONE) throw new Error('failed run printed the done line');
    if (!first.stderr.includes('Шаг 3.')) throw new Error('step 3 was not reported');
    const key = keyFrom(world.primary);
    assertNoKey('stdout', first.stdout, key);
    assertNoKey('stderr', first.stderr, key);
    const mark = world.calls.length;

    const second = await world.run();
    if (!second.result.ok) throw new Error(`resume failed: ${second.stderr}`);
    if (keyFrom(world.primary) !== key) throw new Error('resume minted a new key');
    if (lastLine(second.stdout) !== DONE) throw new Error('resume did not finish with the required sentence');
    assertNoKey('stdout', second.stdout, key);
    assertNoKey('stderr', second.stderr, key);
    assertCallsClean(world.calls, key);
    assertTreeHidesKey(world.sandbox, key);
    const resumed = world.calls.slice(mark);
    if (resumed.some((call) => call.command === 'gh' && call.args[0] === 'secret' && call.args[2] === 'AUDIO_KEY_NEW')) {
      throw new Error('resume set AUDIO_KEY_NEW again');
    }
    for (const call of [...secretStdins(world.calls), ...addStdins(world.calls)]) {
      assertSameBytes('stdin', call.stdin, key);
    }
    if (world.runs.filter((run) => run.conclusion === 'success').length !== 1) {
      throw new Error('resume did not record one successful workflow run');
    }

    const beforeThird = world.calls.length;
    const third = await world.run();
    if (!third.result.ok) throw new Error(`finished rerun failed: ${third.stderr}`);
    if (keyFrom(world.primary) !== key) throw new Error('finished rerun minted a new key');
    if (lastLine(third.stdout) !== DONE) throw new Error('finished rerun missed the done line');
    const extra = world.calls.slice(beforeThird);
    if (extra.some((call) => call.command === 'gh' || call.command === 'npx')) {
      throw new Error('finished rerun called gh or vercel again');
    }
    assertNoKey('stdout', third.stdout, key);
    assertNoKey('stderr', third.stderr, key);
  } finally {
    rmSync(world.sandbox, { recursive: true, force: true });
  }
});

test('hidden workflow tells the owner to merge and does not dispatch', async () => {
  const world = createWorld({ workflowVisible: false });
  try {
    const { result, stdout, stderr } = await world.run();
    if (result.ok) throw new Error('hidden workflow should fail');
    const key = keyFrom(world.primary);
    assertNoKey('stdout', stdout, key);
    assertNoKey('stderr', stderr, key);
    if (!stderr.includes('rekey-audio.yml') || !stderr.includes('main')) throw new Error('merge hint is missing');
    if (world.calls.some((call) => call.command === 'gh' && call.args[1] === 'run')) throw new Error('workflow was dispatched');
    const again = createWorld({ workflowVisible: true });
    try {
      writeFileSync(join(again.primary, '.env.local'), readFileSync(join(world.primary, '.env.local')));
      writeFileSync(join(again.primary, '.env.rotate-state'), readFileSync(join(world.primary, '.env.rotate-state')));
      const resumed = await again.run();
      if (!resumed.result.ok) throw new Error(`resume after merge hint failed: ${resumed.stderr}`);
      if (keyFrom(again.primary) !== key) throw new Error('visibility retry minted a new key');
    } finally {
      rmSync(again.sandbox, { recursive: true, force: true });
    }
  } finally {
    rmSync(world.sandbox, { recursive: true, force: true });
  }
});

test('refuses to write the key when git check-ignore does not match', async () => {
  const world = createWorld({ ignoreCode: 1 });
  try {
    const { result, stderr } = await world.run();
    if (result.ok) throw new Error('unignored env file should fail');
    if (!stderr.includes('check-ignore') && !stderr.includes('не игнорируется')) throw new Error('ignore failure was not explained');
    const text = readFileSync(join(world.primary, '.env.local'), 'utf8');
    if (text !== 'OTHER=1\n') throw new Error('env file changed although it is not ignored');
    if (world.calls.some((call) => call.command === 'gh' || call.command === 'npx')) throw new Error('commands ran after ignore failure');
  } finally {
    rmSync(world.sandbox, { recursive: true, force: true });
  }
});

test('does not replace a malformed AUDIO_KEY line', async () => {
  const world = createWorld();
  try {
    writeFileSync(join(world.primary, '.env.local'), 'OTHER=1\nAUDIO_KEY=short\n', 'utf8');
    const { result } = await world.run();
    if (result.ok) throw new Error('malformed key should fail');
    if (readFileSync(join(world.primary, '.env.local'), 'utf8') !== 'OTHER=1\nAUDIO_KEY=short\n') {
      throw new Error('malformed env file was rewritten');
    }
    if (world.calls.some((call) => call.command === 'gh')) throw new Error('gh ran for a malformed key');
  } finally {
    rmSync(world.sandbox, { recursive: true, force: true });
  }
});

test('dry run does not touch a worktree outside the sandbox', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'll-rotate-outside-'));
  const world = createWorld({ paths: [join(outside, 'living-lyrics'), join(outside, 'other')] });
  try {
    const { result } = await world.run();
    if (result.ok) throw new Error('outside primary should fail');
    if (existsSync(join(outside, 'living-lyrics', '.env.local'))) throw new Error('outside env file was created');
    if (existsSync(join(outside, 'other', '.env.local'))) throw new Error('outside copy was created');
  } finally {
    rmSync(world.sandbox, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('vercel login is inherited and does not receive the key', async () => {
  const world = createWorld({ whoamiFails: 1 });
  try {
    const { result, stdout, stderr } = await world.run();
    if (!result.ok) throw new Error(`login path failed: ${stderr}`);
    const key = keyFrom(world.primary);
    assertNoKey('stdout', stdout, key);
    assertNoKey('stderr', stderr, key);
    const login = world.calls.find((call) => call.command === 'npx' && call.args.includes('login'));
    if (!login) throw new Error('vercel login was not called');
    if (!login.inherit) throw new Error('vercel login did not inherit the terminal');
    if (login.stdin.length !== 0) throw new Error('vercel login received stdin');
    if (login.args.includes('--non-interactive') || login.env.CI) throw new Error('login was made non-interactive');
    assertCallsClean(world.calls, key);
  } finally {
    rmSync(world.sandbox, { recursive: true, force: true });
  }
});

test('rekey round-trips plaintext and deletes the temp files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'll-rekey-'));
  const temp = join(dir, 'temp');
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'content', 'audio-enc', 'one'), { recursive: true });
  mkdirSync(temp, { recursive: true });
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const plain = randomBytes(4096);
  const encPath = join(repo, 'content', 'audio-enc', 'one', 'high.m4a.enc');
  writeFileSync(encPath, encryptBuffer(plain, oldKey));
  try {
    const rels = rekeyTree({
      root: repo,
      oldKeyHex: oldKey.toString('hex'),
      newKeyHex: newKey.toString('hex'),
      tempRoot: temp,
    });
    if (rels.join(',') !== 'one/high.m4a.enc' && rels.join(',') !== `one${sep}high.m4a.enc`) {
      throw new Error('unexpected rekey path');
    }
    const opened = decryptBuffer(readFileSync(encPath), newKey);
    if (!opened.equals(plain)) throw new Error('new key did not open the same bytes');
    let oldFailed = false;
    try {
      decryptBuffer(readFileSync(encPath), oldKey);
    } catch {
      oldFailed = true;
    }
    if (!oldFailed) throw new Error('old key still opens the new ciphertext');
    if (walk(temp).length !== 0) throw new Error('plaintext was left in the temp directory');
    let refused = false;
    try {
      rekeyTree({ root: repo, oldKeyHex: oldKey.toString('hex'), newKeyHex: newKey.toString('hex'), tempRoot: repo });
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('temp directory inside the repo was accepted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner entry refuses outside GitHub and hides both keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'll-rekey-cli-'));
  const repo = join(dir, 'repo');
  const temp = join(dir, 'temp');
  mkdirSync(join(repo, 'content', 'audio-enc', 'song'), { recursive: true });
  mkdirSync(temp, { recursive: true });
  const oldHex = randomBytes(32).toString('hex');
  const newHex = randomBytes(32).toString('hex');
  const plain = Buffer.from('living-lyrics-plain');
  writeFileSync(join(repo, 'content', 'audio-enc', 'song', 'high.m4a.enc'), encryptBuffer(plain, Buffer.from(oldHex, 'hex')));
  const script = join(root, 'scripts', 'tools', 'rotate-audio-key.mjs');
  try {
    const blocked = await runNode([script, '--rekey-runner'], { cwd: repo, env: { ...process.env, AUDIO_KEY: oldHex, AUDIO_KEY_NEW: newHex } });
    if (blocked.code === 0) throw new Error('runner mode ran outside GitHub Actions');
    assertNoKey('blocked stdout', blocked.stdout, oldHex);
    assertNoKey('blocked stderr', blocked.stderr, oldHex);
    assertNoKey('blocked stdout new', blocked.stdout, newHex);
    assertNoKey('blocked stderr new', blocked.stderr, newHex);
    const allowed = await runNode([script, '--rekey-runner'], {
      cwd: repo,
      env: {
        ...process.env,
        AUDIO_KEY: oldHex,
        AUDIO_KEY_NEW: newHex,
        ROTATE_KEY_REKEY_ALLOW: '1',
        RUNNER_TEMP: temp,
      },
    });
    if (allowed.code !== 0) throw new Error(`runner mode failed: ${allowed.stderr}`);
    assertNoKey('runner stdout', allowed.stdout, oldHex);
    assertNoKey('runner stderr', allowed.stderr, oldHex);
    assertNoKey('runner stdout new', allowed.stdout, newHex);
    assertNoKey('runner stderr new', allowed.stderr, newHex);
    if (!allowed.stdout.includes('Перешифровано файлов: 1')) throw new Error('runner did not report the file count');
    const opened = decryptBuffer(readFileSync(join(repo, 'content', 'audio-enc', 'song', 'high.m4a.enc')), Buffer.from(newHex, 'hex'));
    if (!opened.equals(plain)) throw new Error('runner ciphertext does not match');
    if (walk(temp).length !== 0) throw new Error('runner left plaintext behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audio-crypt still uses the 12-byte iv and 16-byte tag layout', () => {
  const source = readFileSync(join(root, 'scripts', 'tools', 'audio-crypt.mjs'), 'utf8');
  if (!source.includes('subarray(0, 12)') || !source.includes('subarray(12, 28)') || !source.includes('subarray(28)')) {
    throw new Error('audio-crypt layout changed; rekey must be updated with it');
  }
  const key = randomBytes(32);
  const plain = Buffer.from('layout');
  const enc = encryptBuffer(plain, key);
  const decipher = createDecipheriv('aes-256-gcm', key, enc.subarray(0, 12));
  decipher.setAuthTag(enc.subarray(12, 28));
  const back = Buffer.concat([decipher.update(enc.subarray(28)), decipher.final()]);
  if (!back.equals(plain)) throw new Error('layout self-check failed');
});

test('default spawn delivers stdin to node and can start npx', async () => {
  const marker = randomBytes(16).toString('hex');
  const piped = await defaultSpawn(process.execPath, ['-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(String(d.length)))'], {
    input: Buffer.from(marker),
    env: process.env,
  });
  if (piped.code !== 0 || piped.stdout !== String(marker.length)) {
    throw new Error('stdin pipe through defaultSpawn failed');
  }
  const version = await defaultSpawn('npx', ['--version'], { env: process.env });
  if (version.code !== 0 || !version.stdout.trim()) throw new Error('npx did not start');
});

function runNode(args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code == null ? 1 : code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

let failed = 0;
for (const item of tests) {
  try {
    await item.fn();
    process.stdout.write(`ok ${item.name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`fail ${item.name}\n`);
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  }
}
if (failed > 0) {
  process.stderr.write(`${failed} failed\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${tests.length} passed\n`);
}
