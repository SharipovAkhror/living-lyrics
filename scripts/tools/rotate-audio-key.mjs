// Owner command: npm run rotate-key
//
// Replaces AUDIO_KEY (AES-256-GCM, same layout as scripts/tools/audio-crypt.mjs:
// 12-byte IV, 16-byte tag, ciphertext). The owner runs it once on the Station.
// Agents must not run it against the real key.
//
// The key is written only to .env.local (gitignored) and to the stdin of
// `gh secret set` and `vercel env add`. It is never passed as an argument,
// never put in a child environment, and never printed. A second run keeps the
// key already stored in the main checkout's .env.local.
//
// GitHub Actions mode (only on a runner): node scripts/tools/rotate-audio-key.mjs --rekey-runner
// Decrypts with AUDIO_KEY, encrypts with AUDIO_KEY_NEW, checks sha256, and
// leaves plaintext only under RUNNER_TEMP.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// vercel@63.1.2 was published on 2026-10-09 (npm). Pinned so the CLI is an
// exact release at least two weeks old on 2026-10-24, not the floating latest.
export const VERCEL_PACKAGE = 'vercel@63.1.2';
export const VERCEL_ORG_ID = 'team_vKwfBgyY5JNLfiqxgWSD6R8A';
export const VERCEL_PROJECT_ID = 'prj_qSpZgGNjg0KoGNHaT0Rw3RcBZ7kX';
export const DONE_LINE = 'Готово — напишите в LL · Main «ключ готов»';

const ENV_NAME = '.env.local';
const STATE_NAME = '.env.rotate-state';
const WORKFLOW_FILE = 'rekey-audio.yml';
const REPO_FALLBACK = 'SharipovAkhror/living-lyrics';
const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export class RotateError extends Error {
  constructor(step, userMessage, hint) {
    super('rotate-step-failed');
    this.step = step;
    this.userMessage = userMessage;
    this.hint = hint;
  }
}

export function redact(text, key) {
  if (!key || text == null) return text == null ? '' : String(text);
  const raw = String(text);
  const lower = String(key);
  const upper = lower.toUpperCase();
  let out = raw.split(lower).join('[скрыто]');
  if (upper !== lower) out = out.split(upper).join('[скрыто]');
  return out;
}

export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

export function parseWorktrees(text) {
  const records = [];
  let cur = null;
  const flush = () => {
    if (cur && !cur.bare) records.push(cur);
    cur = null;
  };
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    if (key === 'worktree') {
      flush();
      cur = { path: value, branch: '', bare: false };
    } else if (!cur) {
      continue;
    } else if (key === 'branch') cur.branch = value;
    else if (key === 'bare') cur.bare = true;
  }
  flush();
  return records;
}

export function readAudioKey(text) {
  const match = String(text).match(/^AUDIO_KEY=([0-9a-fA-F]{64})[ \t]*$/m);
  return match ? match[1].toLowerCase() : null;
}

export function hasAudioKeyLine(text) {
  return /^AUDIO_KEY=/m.test(String(text));
}

export function upsertAudioKey(text, key) {
  const src = String(text);
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const line = `AUDIO_KEY=${key}`;
  if (/^AUDIO_KEY=/m.test(src)) return src.replace(/^AUDIO_KEY=.*$/m, line);
  if (src.length === 0) return line + nl;
  return src.endsWith('\n') || src.endsWith('\r') ? src + line + nl : src + nl + line + nl;
}

function fingerprint(key) {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

export function encryptBuffer(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function decryptBuffer(blob, key) {
  if (blob.length < 28) throw new Error('Файл шифра короче заголовка.');
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

function parseHexKey(name, value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    const len = typeof value === 'string' ? value.trim().length : 0;
    throw new Error(`${name} не задан или это не 64 шестнадцатеричных знака (длина ${len}).`);
  }
  return Buffer.from(raw.toLowerCase(), 'hex');
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walkEnc(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue;
    const path = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkEnc(path));
    else if (ent.isFile() && ent.name.endsWith('.enc')) out.push(path);
  }
  return out.sort();
}

function shredTree(dir) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) shredTree(path);
    else {
      try {
        const size = statSync(path).size;
        writeFileSync(path, Buffer.alloc(size));
      } catch {
        // The file may already be gone. The directory removal below still runs.
      }
      try {
        rmSync(path, { force: true });
      } catch {
        // Best effort. The runner disk is thrown away with the job.
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

// Decrypt every *.enc under content/audio-enc, encrypt with the new key, and
// keep plaintext under tempRoot only. Writes the new ciphertext after every
// file has round-tripped, so a mismatch leaves the tree untouched.
export function rekeyTree({ root, oldKeyHex, newKeyHex, tempRoot }) {
  const oldKey = parseHexKey('AUDIO_KEY', oldKeyHex);
  const newKey = parseHexKey('AUDIO_KEY_NEW', newKeyHex);
  const encRoot = join(root, 'content', 'audio-enc');
  const resolvedTemp = resolve(tempRoot);
  if (isInside(root, resolvedTemp)) {
    throw new Error('Временная папка оказалась внутри репозитория. Открытый звук туда не пишу.');
  }
  const files = walkEnc(encRoot);
  if (files.length === 0) throw new Error('В content/audio-enc нет файлов .enc.');
  const plainDir = join(resolvedTemp, `ll-rekey-${randomBytes(8).toString('hex')}`);
  mkdirSync(plainDir, { recursive: true });
  const planned = [];
  try {
    for (const file of files) {
      const rel = relative(encRoot, file);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Файл шифра выходит за пределы content/audio-enc.');
      const plain = decryptBuffer(readFileSync(file), oldKey);
      const plainPath = join(plainDir, `${rel}.plain`);
      mkdirSync(dirname(plainPath), { recursive: true });
      writeFileSync(plainPath, plain);
      const digest = sha256(plain);
      const enc = encryptBuffer(plain, newKey);
      const again = decryptBuffer(enc, newKey);
      const againDigest = sha256(again);
      plain.fill(0);
      again.fill(0);
      if (againDigest !== digest) throw new Error(`sha256 не совпал: ${rel}`);
      planned.push({ file, enc, rel });
    }
    for (const item of planned) writeFileSync(item.file, item.enc);
    return planned.map((item) => item.rel);
  } finally {
    shredTree(plainDir);
  }
}

function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function quoteCmd(arg) {
  if (arg.length === 0 || /[\s"&|<>^%]/.test(arg)) return `"${String(arg).replace(/"/g, '""')}"`;
  return String(arg);
}

function npxJs(command) {
  const nodeDir = dirname(process.execPath);
  const file = command === 'npm' ? 'npm-cli.js' : 'npx-cli.js';
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', file),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', file),
  ];
  return candidates.find((path) => existsSync(path)) || null;
}

export function defaultSpawn(command, args, opts = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const env = opts.env || process.env;
    const stdio = opts.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'];
    let child;
    if (command === 'npx' || command === 'npm') {
      // Spawn node on npx-cli.js so the key stays on a real stdin pipe.
      // Spawning npx.cmd on Windows either fails or lets cmd.exe eat stdin.
      const js = npxJs(command);
      if (js) {
        child = spawn(process.execPath, [js, ...args], { cwd: opts.cwd, env, windowsHide: true, stdio });
      } else if (process.platform === 'win32') {
        child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command, ...args.map(quoteCmd)], {
          cwd: opts.cwd,
          env,
          windowsHide: true,
          stdio,
        });
      } else {
        child = spawn(command, args, { cwd: opts.cwd, env, windowsHide: true, stdio });
      }
    } else {
      child = spawn(command, args, { cwd: opts.cwd, env, windowsHide: true, shell: false, stdio });
    }
    const stdout = [];
    const stderr = [];
    if (!opts.inherit) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
      if (opts.input != null) {
        child.stdin.write(opts.input);
        child.stdin.end();
      } else {
        child.stdin.end();
      }
    }
    let settled = false;
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolvePromise({
        code: code == null ? 1 : code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function blankState(now) {
  return {
    version: 1,
    startedAt: now,
    steps: {
      env: 'pending',
      secretNew: 'pending',
      workflow: 'pending',
      vercelProduction: 'pending',
      vercelPreview: 'pending',
      secretLive: 'pending',
    },
    workflowRunId: null,
    workflowRunUrl: '',
    failedRunIds: [],
    previewManual: false,
    keyFingerprint: '',
  };
}

function childEnv(base, key) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (name === 'AUDIO_KEY' || name === 'AUDIO_KEY_NEW' || name === 'AUDIO_KEY_OLD') {
      delete env[name];
      continue;
    }
    const value = env[name];
    if (key && typeof value === 'string' && value.includes(key)) delete env[name];
  }
  return env;
}

function formatFailure(err, key) {
  return redact(
    `Шаг ${err.step}. ${err.userMessage}\nЧто сделать: ${err.hint}\nПовторный запуск продолжит с этого места и не создаст новый ключ.\n`,
    key,
  );
}

function writePrivate(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows may refuse the Unix mode. The file is still gitignored.
  }
}

export async function rotateAudioKey(options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const keyHolder = { value: null };
  const out = (text) => stdout.write(redact(text, keyHolder.value));
  const err = (text) => stderr.write(redact(text, keyHolder.value));
  try {
    await runRotation({ ...options, stdout, stderr, keyHolder, out, err });
    return { ok: true };
  } catch (error) {
    if (error instanceof RotateError) {
      err(formatFailure(error, keyHolder.value));
      return { ok: false, step: error.step };
    }
    const message = error && error.code === 'ENOENT'
      ? `Не найдена команда ${error.path || ''}. Установите её и выполните npm run rotate-key снова.`
      : `Сбой: ${error && error.message ? error.message : 'неизвестная ошибка'}`;
    err(redact(`Шаг не определён. ${message}\nЧто сделать: выполните npm run rotate-key снова.\nПовторный запуск продолжит с этого места и не создаст новый ключ.\n`, keyHolder.value));
    return { ok: false, step: 0 };
  }
}

async function runRotation(ctx) {
  const dryRun = !!ctx.dryRun;
  const sandbox = ctx.sandbox ? resolve(ctx.sandbox) : null;
  if (dryRun && !sandbox) {
    throw new RotateError(1, 'Сухой запуск без папки песочницы.', 'Укажите --sandbox. Настоящий .env.local эта команда не трогает. Для замены ключа запустите npm run rotate-key без --dry-run.');
  }
  const spawnCommand = ctx.spawn || defaultSpawn;
  const sleep = ctx.sleep || defaultSleep;
  const baseEnv = ctx.env || process.env;
  const startCwd = ctx.cwd || process.cwd();
  const keyHolder = ctx.keyHolder;

  const guard = (file) => {
    if (dryRun && !isInside(sandbox, file)) {
      throw new RotateError(1, 'Сухой запуск остановился: путь вне песочницы.', 'Настоящий .env.local не изменён. Для замены ключа запустите npm run rotate-key без --dry-run.');
    }
  };

  const call = async (command, args, opts = {}) => {
    const list = args.map(String);
    if (keyHolder.value) {
      for (const arg of list) {
        if (arg.includes(keyHolder.value)) {
          throw new RotateError(opts.step || 1, 'Внутренняя ошибка: ключ чуть не попал в аргументы команды.', 'Запуск остановлен. Напишите в LL · Main и не запускайте команду снова, пока не посмотрят скрипт.');
        }
      }
    }
    let env = childEnv(baseEnv, keyHolder.value);
    if (opts.extraEnv) env = { ...env, ...opts.extraEnv };
    if (keyHolder.value) {
      for (const name of Object.keys(env)) {
        const value = env[name];
        if (typeof value === 'string' && value.includes(keyHolder.value)) delete env[name];
      }
    }
    const input = opts.input == null ? null : Buffer.from(opts.input);
    try {
      return await spawnCommand(command, list, {
        cwd: opts.cwd || startCwd,
        env,
        input,
        inherit: !!opts.inherit,
      });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new RotateError(opts.step || 1, `Не найдена команда ${command}.`, command === 'gh'
          ? 'Установите GitHub CLI, выполните gh auth login и снова npm run rotate-key.'
          : 'Установите недостающую команду и снова выполните npm run rotate-key.');
      }
      throw error;
    }
  };

  const git = (args, step) => call('git', args, { step, cwd: startCwd });
  const mustGit = async (args, step, hint) => {
    const result = await git(args, step);
    if (result.code !== 0) {
      const detail = `${result.stdout}\n${result.stderr}`.trim();
      if (detail) ctx.err(redact(detail + '\n', keyHolder.value));
      throw new RotateError(step, 'Команда git завершилась с ошибкой.', hint);
    }
    return result;
  };

  const listed = await mustGit(
    ['worktree', 'list', '--porcelain'],
    1,
    'Запустите команду из копии репозитория living-lyrics и проверьте git worktree list.',
  );
  const worktrees = parseWorktrees(listed.stdout);
  if (worktrees.length === 0) {
    throw new RotateError(1, 'git worktree list не вернул ни одной копии.', 'Запустите команду из репозитория living-lyrics.');
  }
  const named = worktrees.find((item) => basename(item.path).toLowerCase() === 'living-lyrics');
  const primary = named || worktrees[0];
  guard(primary.path);
  const envPath = join(primary.path, ENV_NAME);
  const statePath = join(primary.path, STATE_NAME);
  guard(envPath);
  guard(statePath);

  const ignored = async (cwd, rel) => {
    const result = await git(['-C', cwd, 'check-ignore', '-q', '--', rel], 1);
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    const detail = `${result.stdout}\n${result.stderr}`.trim();
    if (detail) ctx.err(redact(detail + '\n', keyHolder.value));
    throw new RotateError(1, `git check-ignore не смог проверить ${rel}.`, 'Проверьте, что это копия репозитория, и запустите команду снова.');
  };

  if (!(await ignored(primary.path, ENV_NAME))) {
    throw new RotateError(1, '.env.local не игнорируется git в основной копии.', 'Ключ не записан. Проверьте .gitignore (строка .env*) и только потом запускайте команду снова.');
  }
  if (!(await ignored(primary.path, STATE_NAME))) {
    throw new RotateError(1, '.env.rotate-state не игнорируется git.', 'Состояние замены туда не записано, ключ тоже. Шаблон .env* в .gitignore должен покрывать этот файл.');
  }

  let state = blankState(new Date().toISOString());
  if (existsSync(statePath)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      throw new RotateError(1, 'Файл .env.rotate-state повреждён.', 'Не создаю новый ключ. Покажите файл LL · Main, не копируя .env.local.');
    }
    if (!parsed || parsed.version !== 1) {
      throw new RotateError(1, 'Файл .env.rotate-state записан другой версией скрипта.', 'Не продолжаю. Напишите в LL · Main, не вставляя .env.local.');
    }
    state = { ...blankState(parsed.startedAt || state.startedAt), ...parsed, steps: { ...blankState(parsed.startedAt).steps, ...(parsed.steps || {}) } };
  }

  const existingText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  if (hasAudioKeyLine(existingText) && !readAudioKey(existingText)) {
    throw new RotateError(1, 'В .env.local строка AUDIO_KEY есть, но это не 64 шестнадцатеричных знака.', 'Не заменяю её и не создаю второй ключ. Уберите строку или исправьте её вручную и запустите команду снова.');
  }
  let key = readAudioKey(existingText);
  const reused = !!key;
  if (!key && (state.keyFingerprint || state.steps.secretNew === 'done' || state.steps.workflow === 'done' || state.steps.secretLive === 'done' || state.steps.vercelProduction === 'done')) {
    throw new RotateError(1, 'Замена уже начата, но ключа в .env.local нет.', 'Не создаю новый: секрет в GitHub мог уже быть записан. Верните .env.local из другой рабочей копии или напишите в LL · Main.');
  }
  if (!key) key = randomBytes(32).toString('hex');
  keyHolder.value = key;
  const mark = fingerprint(key);
  if (state.keyFingerprint && state.keyFingerprint !== mark) {
    throw new RotateError(1, 'Ключ в .env.local не совпадает с уже начатой заменой.', 'Не продолжаю, чтобы не создать второй ключ. Верните прежний .env.local. Содержимое в чат не копируйте.');
  }
  state.keyFingerprint = mark;
  const nextText = readAudioKey(existingText) === key && hasAudioKeyLine(existingText) && existingText.includes(`AUDIO_KEY=${key}`)
    ? existingText
    : upsertAudioKey(existingText, key);
  if (nextText !== existingText) writePrivate(envPath, nextText);
  state.steps.env = 'done';
  ctx.out(reused
    ? 'Шаг 1. В .env.local уже есть ключ — использую его, новый не создаю.\n'
    : 'Шаг 1. Создан новый ключ и записан в .env.local основной копии.\n');
  const save = () => {
    guard(statePath);
    writePrivate(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };
  save();

  let copied = 0;
  let skipped = 0;
  for (const tree of worktrees) {
    if (resolve(tree.path) === resolve(primary.path)) continue;
    const dest = join(tree.path, ENV_NAME);
    if (dryRun && !isInside(sandbox, dest)) {
      throw new RotateError(1, 'Сухой запуск остановился: рабочая копия вне песочницы.', 'Настоящий .env.local не изменён.');
    }
    if (!existsSync(tree.path)) {
      ctx.out(`Шаг 1. Копия ${tree.path} недоступна — пропускаю.\n`);
      skipped += 1;
      continue;
    }
    if (existsSync(dest)) {
      skipped += 1;
      continue;
    }
    if (!(await ignored(tree.path, ENV_NAME))) {
      ctx.out(`Шаг 1. В копии ${tree.path} файл .env.local не игнорируется — не копирую.\n`);
      skipped += 1;
      continue;
    }
    guard(dest);
    copyFileSync(envPath, dest);
    try {
      chmodSync(dest, 0o600);
    } catch {
      // Same as the primary file: Windows may ignore the mode.
    }
    copied += 1;
  }
  ctx.out(`Шаг 1. .env.local скопирован в ${copied} рабочих копий, где его не было. Уже занятых или пропущенных: ${skipped}.\n`);

  const remote = await mustGit(
    ['-C', primary.path, 'remote', 'get-url', 'origin'],
    2,
    'Проверьте git remote get-url origin и запустите команду снова.',
  );
  const repo = parseRepo(remote.stdout) || REPO_FALLBACK;
  const ghEnv = {
    GH_REPO: repo,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
  };
  const gh = (args, opts = {}) => call('gh', args, { ...opts, extraEnv: ghEnv, cwd: primary.path, step: opts.step || 2 });

  if (state.steps.secretNew !== 'done') {
    ctx.out('Шаг 2. Записываю секрет AUDIO_KEY_NEW в GitHub.\n');
    const set = await gh(['secret', 'set', 'AUDIO_KEY_NEW'], { input: key, step: 2 });
    if (set.code !== 0) {
      showTool(ctx, set);
      throw new RotateError(2, 'Не удалось записать секрет AUDIO_KEY_NEW.', 'Проверьте gh auth status и снова выполните npm run rotate-key.');
    }
    state.steps.secretNew = 'done';
    save();
  } else {
    ctx.out('Шаг 2. Секрет AUDIO_KEY_NEW уже записан — пропускаю.\n');
  }

  await stepWorkflow({ ...ctx, state, save, gh, sleep, key, out: ctx.out, err: ctx.err });

  await stepVercel({ ...ctx, state, save, call, key, primary, sandbox, dryRun });

  if (state.steps.secretLive !== 'done') {
    ctx.out('Шаг 5. Заменяю секрет AUDIO_KEY в GitHub.\n');
    const set = await gh(['secret', 'set', 'AUDIO_KEY'], { input: key, step: 5 });
    if (set.code !== 0) {
      showTool(ctx, set);
      throw new RotateError(5, 'Не удалось записать секрет AUDIO_KEY.', 'Проверьте gh auth status и снова выполните npm run rotate-key. AUDIO_KEY_OLD не создаётся.');
    }
    state.steps.secretLive = 'done';
    save();
  } else {
    ctx.out('Шаг 5. Секрет AUDIO_KEY в GitHub уже заменён — пропускаю.\n');
  }

  ctx.out(`${DONE_LINE}\n`);
}

function parseRepo(url) {
  const match = String(url).trim().match(/github\.com[:/]([^/\s]+)\/([^/\s.]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function showTool(ctx, result) {
  const detail = redact(`${result.stdout || ''}\n${result.stderr || ''}`.trim(), ctx.keyHolder.value);
  if (detail) ctx.err(`${detail}\n`);
}

function parseRuns(text) {
  const value = JSON.parse(text);
  return Array.isArray(value) ? value : [value];
}

function isActive(run) {
  if (!run) return false;
  const status = String(run.status || '');
  if (status === 'completed') return false;
  return ACTIVE_STATUSES.has(status);
}

async function listRuns(gh) {
  const result = await gh([
    'run', 'list',
    '--workflow', WORKFLOW_FILE,
    '--limit', '20',
    '--json', 'databaseId,status,conclusion,createdAt,event,url,headBranch',
  ], { step: 3 });
  if (result.code !== 0) {
    throw new RotateError(3, 'Не удалось получить список запусков GitHub Actions.', 'Проверьте gh auth status и снова выполните npm run rotate-key.');
  }
  try {
    return parseRuns(result.stdout || '[]');
  } catch {
    throw new RotateError(3, 'GitHub вернул список запусков, который не удалось разобрать.', 'Запустите команду снова.');
  }
}

async function viewRun(gh, id) {
  const result = await gh(['run', 'view', String(id), '--json', 'databaseId,status,conclusion,url,event,createdAt'], { step: 3 });
  if (result.code !== 0) {
    throw new RotateError(3, 'Не удалось прочитать состояние запуска перешифровки.', 'Откройте вкладку Actions и снова выполните npm run rotate-key.');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new RotateError(3, 'Ответ о запуске перешифровки не удалось разобрать.', 'Запустите команду снова.');
  }
}

async function stepWorkflow(ctx) {
  const { state, save, gh } = ctx;
  if (state.steps.workflow === 'done') {
    ctx.out('Шаг 3. Перешифровка уже прошла успешно — пропускаю.\n');
    return;
  }
  const visible = await gh(['workflow', 'view', WORKFLOW_FILE], { step: 3 });
  if (visible.code !== 0) {
    showTool(ctx, visible);
    const blob = `${visible.stdout}\n${visible.stderr}`;
    if (/auth|login|HTTP 401|unauthorized/i.test(blob) && !/could not find|not found/i.test(blob)) {
      throw new RotateError(3, 'GitHub CLI не авторизован.', 'Выполните gh auth login и снова npm run rotate-key.');
    }
    throw new RotateError(
      3,
      'GitHub не показывает workflow rekey-audio.yml, поэтому запустить его нельзя.',
      'Файл .github/workflows/rekey-audio.yml должен лежать в ветке main: workflow_dispatch читается только оттуда. Влейте ветку site/rotate-key в main (это делает LL · Main) и снова выполните npm run rotate-key.',
    );
  }

  const failed = new Set((state.failedRunIds || []).map(String));
  const runs = await listRuns(gh);
  const started = Date.parse(state.startedAt) - 15000;
  const fresh = (run) => {
    const at = Date.parse(run.createdAt || '');
    return Number.isFinite(at) && at >= started;
  };
  const success = runs.find((run) => run.event === 'workflow_dispatch' && run.conclusion === 'success' && fresh(run) && !failed.has(String(run.databaseId)));
  if (success) {
    state.workflowRunId = String(success.databaseId);
    state.workflowRunUrl = success.url || '';
    state.steps.workflow = 'done';
    save();
    ctx.out('Шаг 3. Нашёл успешный запуск перешифровки — новый не создаю.\n');
    return;
  }

  let current = null;
  if (state.workflowRunId && !failed.has(String(state.workflowRunId))) {
    current = runs.find((run) => String(run.databaseId) === String(state.workflowRunId)) || await viewRun(gh, state.workflowRunId);
  }
  if (!current) {
    current = runs.find((run) => run.event === 'workflow_dispatch' && isActive(run) && fresh(run) && !failed.has(String(run.databaseId)));
  }
  if (current && isActive(current)) {
    ctx.out('Шаг 3. Жду уже идущий запуск перешифровки.\n');
    await watchRun(ctx, current);
    return;
  }
  if (current && current.conclusion === 'success') {
    state.workflowRunId = String(current.databaseId);
    state.workflowRunUrl = current.url || '';
    state.steps.workflow = 'done';
    save();
    ctx.out('Шаг 3. Запуск перешифровки уже успешен — новый не создаю.\n');
    return;
  }
  if (current && !isActive(current)) {
    state.failedRunIds = [...failed, String(current.databaseId)];
    state.workflowRunId = null;
    save();
    failed.add(String(current.databaseId));
  }

  ctx.out('Шаг 3. Запускаю перешифровку записей на GitHub.\n');
  const since = Date.now();
  const dispatched = await gh(['workflow', 'run', WORKFLOW_FILE, '--ref', 'main'], { step: 3 });
  if (dispatched.code !== 0) {
    showTool(ctx, dispatched);
    throw new RotateError(3, 'GitHub не принял запуск rekey-audio.yml.', 'Убедитесь, что файл workflow уже в main, и снова выполните npm run rotate-key.');
  }
  const created = await pollRun(ctx, since, failed);
  state.workflowRunId = String(created.databaseId);
  state.workflowRunUrl = created.url || '';
  save();
  await watchRun(ctx, created);
}

async function pollRun(ctx, sinceMs, failed) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const runs = await listRuns(ctx.gh);
    const found = runs
      .filter((run) => run.event === 'workflow_dispatch' && !failed.has(String(run.databaseId)))
      .filter((run) => {
        const at = Date.parse(run.createdAt || '');
        return Number.isFinite(at) && at >= sinceMs - 15000;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (found) return found;
    await ctx.sleep(3000);
  }
  throw new RotateError(3, 'GitHub принял запуск, но номер прогона не появился.', 'Откройте вкладку Actions. Если прогон rekey-audio уже идёт, снова выполните npm run rotate-key — скрипт дождётся его.');
}

async function watchRun(ctx, run) {
  const id = String(run.databaseId);
  ctx.out(`Шаг 3. Жду окончания запуска ${id}.\n`);
  const watched = await ctx.gh(['run', 'watch', id, '--exit-status'], { step: 3 });
  const viewed = await viewRun(ctx.gh, id);
  if (watched.code === 0 && viewed.conclusion === 'success') {
    ctx.state.workflowRunId = id;
    ctx.state.workflowRunUrl = viewed.url || run.url || '';
    ctx.state.steps.workflow = 'done';
    ctx.save();
    ctx.out('Шаг 3. Перешифровка на GitHub прошла. Новые файлы лежат в ветке rekey/audio.\n');
    return;
  }
  const failed = new Set((ctx.state.failedRunIds || []).map(String));
  failed.add(id);
  ctx.state.failedRunIds = [...failed];
  ctx.state.workflowRunId = null;
  ctx.save();
  showTool(ctx, watched);
  const url = viewed.url || run.url || '';
  throw new RotateError(
    3,
    `Запуск перешифровки не удался${url ? ` (${url})` : ''}.`,
    'Откройте этот запуск в GitHub Actions, устраните причину и снова выполните npm run rotate-key. Новый ключ не создаётся. Если ветка rekey/audio уже есть и push её не обновляет, историю main не переписывайте: ветку удаляет LL · Main, затем команду запускают снова.',
  );
}

async function stepVercel(ctx) {
  const { state, save, key } = ctx;
  if (state.steps.vercelProduction === 'done' && state.steps.vercelPreview === 'done') {
    ctx.out('Шаг 4. Vercel уже обновлён — пропускаю.\n');
    return;
  }
  const vercelCwd = ctx.dryRun ? join(ctx.sandbox, 'vercel-cwd') : join(tmpdir(), `ll-rotate-vercel-${randomBytes(4).toString('hex')}`);
  mkdirSync(vercelCwd, { recursive: true });
  // CI is not set: vercel@63.1.2 skips the browser on `vercel login` when CI is set.
  // Project ids select the project, so no .vercel directory is written into the repo.
  const vercelEnv = {
    VERCEL_ORG_ID,
    VERCEL_PROJECT_ID,
  };
  const vercel = (args, opts = {}) => ctx.call('npx', ['--yes', VERCEL_PACKAGE, ...args], {
    ...opts,
    step: 4,
    cwd: vercelCwd,
    extraEnv: vercelEnv,
  });

  ctx.out('Шаг 4. Проверяю вход в Vercel.\n');
  let who = await vercel(['whoami']);
  if (who.code !== 0) {
    ctx.out('Шаг 4. Vercel не видит вход. Откроется браузер — войдите и вернитесь в это окно.\n');
    const login = await vercel(['login'], { inherit: true });
    if (login.code !== 0) {
      throw new RotateError(4, 'Вход в Vercel не выполнен.', 'Завершите вход в открывшемся браузере и снова выполните npm run rotate-key.');
    }
    who = await vercel(['whoami']);
    if (who.code !== 0) {
      throw new RotateError(4, 'После входа Vercel всё ещё не отвечает на whoami.', 'Выполните вход ещё раз и снова запустите npm run rotate-key.');
    }
  }

  await ensureVercelTarget(ctx, vercel, 'production');
  await ensureVercelTarget(ctx, vercel, 'preview');
  save();
  ctx.out('Шаг 4. Переменная AUDIO_KEY записана в Vercel для production и preview.\n');
}

async function ensureVercelTarget(ctx, vercel, target) {
  const stepName = target === 'production' ? 'vercelProduction' : 'vercelPreview';
  if (ctx.state.steps[stepName] === 'done') return;
  // --non-interactive is required for preview. In vercel@63.1.2, two positionals
  // and no git branch mean every preview branch only when the client is non-interactive.
  const listed = await vercel(['env', 'ls', target, '--non-interactive']);
  if (listed.code !== 0) {
    showTool(ctx, listed);
    throw new RotateError(4, `Не удалось прочитать переменные Vercel (${target}).`, 'Проверьте сеть и вход, затем снова выполните npm run rotate-key.');
  }
  const present = /(^|\s)AUDIO_KEY(\s|$)/m.test(listed.stdout);
  if (present && target === 'preview' && ctx.state.previewManual) {
    ctx.state.steps.vercelPreview = 'done';
    ctx.save();
    ctx.out('Шаг 4. В preview переменная AUDIO_KEY уже есть — не удаляю её.\n');
    return;
  }
  if (present) {
    const removed = await vercel(['env', 'rm', 'AUDIO_KEY', target, '--yes', '--non-interactive']);
    if (removed.code !== 0) {
      const blob = `${removed.stdout}\n${removed.stderr}`;
      if (!/could not find|not found|does not exist|wasn't found|no environment variable/i.test(blob)) {
        showTool(ctx, removed);
        throw new RotateError(4, `Не удалось удалить AUDIO_KEY из ${target}.`, 'Посмотрите сообщение команды выше и снова выполните npm run rotate-key.');
      }
    }
    ctx.out(`Шаг 4. Удалил прежнюю переменную AUDIO_KEY из ${target}.\n`);
  } else {
    ctx.out(`Шаг 4. В ${target} переменной AUDIO_KEY нет — удалять нечего.\n`);
  }
  const added = await vercel(['env', 'add', 'AUDIO_KEY', target, '--sensitive', '--yes', '--non-interactive'], { input: ctx.key });
  if (added.code !== 0) {
    showTool(ctx, added);
    const blob = `${added.stdout}\n${added.stderr}`;
    if (target === 'preview' && /git_branch_required/.test(blob)) {
      ctx.state.previewManual = true;
      ctx.save();
      throw new RotateError(
        4,
        'Vercel не принял preview без имени ветки.',
        'Добавьте AUDIO_KEY для всех веток Preview в панели Vercel. Значение возьмите из строки AUDIO_KEY в .env.local основной копии и в чат его не копируйте. Затем снова выполните npm run rotate-key: скрипт увидит переменную и не станет удалять её.',
      );
    }
    throw new RotateError(4, `Не удалось записать AUDIO_KEY в ${target}.`, 'Посмотрите сообщение команды выше и снова выполните npm run rotate-key.');
  }
  ctx.state.steps[stepName] = 'done';
  ctx.save();
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(arg).href === import.meta.url;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let sandbox = null;
  let rekeyRunner = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--sandbox') {
      sandbox = args[i + 1] || '';
      i += 1;
      if (!sandbox) {
        process.stderr.write('У --sandbox нет пути.\n');
        process.exitCode = 1;
        return;
      }
    } else if (arg === '--rekey-runner') rekeyRunner = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('npm run rotate-key\nСухой запуск для проверки: npm run rotate-key -- --dry-run --sandbox <папка>\nКлюч на экран не выводится.\n');
      return;
    } else {
      process.stderr.write('Неизвестный аргумент. Ключ в команду подставлять нельзя. Запуск: npm run rotate-key\n');
      process.exitCode = 1;
      return;
    }
  }
  if (rekeyRunner) {
    if (process.env.GITHUB_ACTIONS !== 'true' && process.env.ROTATE_KEY_REKEY_ALLOW !== '1') {
      process.stderr.write('Режим перешифровки только для GitHub Actions.\n');
      process.exitCode = 1;
      return;
    }
    try {
      const rels = rekeyTree({
        root: process.cwd(),
        oldKeyHex: process.env.AUDIO_KEY,
        newKeyHex: process.env.AUDIO_KEY_NEW,
        tempRoot: process.env.RUNNER_TEMP || tmpdir(),
      });
      process.stdout.write(`Перешифровано файлов: ${rels.length}. Свёртка sha256 совпала.\n`);
    } catch (error) {
      const message = redact(error && error.message ? error.message : 'сбой перешифровки', process.env.AUDIO_KEY);
      const hidden = redact(message, process.env.AUDIO_KEY_NEW);
      process.stderr.write(`${hidden}\n`);
      process.exitCode = 1;
    }
    return;
  }
  const result = await rotateAudioKey({ dryRun, sandbox });
  process.exitCode = result.ok ? 0 : 1;
}

if (isDirectRun()) {
  main().catch((error) => {
    process.stderr.write(redact(`Сбой запуска: ${error && error.message ? error.message : 'ошибка'}\n`, null));
    process.exitCode = 1;
  });
}
