// Keeps recordings out of a public repository in readable form.
//
//   node scripts/tools/audio-crypt.mjs encrypt <slug>   public/audio/<slug>/*.m4a → content/audio-enc/<slug>/*.m4a.enc
//   node scripts/tools/audio-crypt.mjs decrypt          content/audio-enc/**     → public/audio/<slug>/*.m4a
//
// Key: AUDIO_KEY (64 hex chars = 256-bit) from the environment or .env.local. On Vercel it is a
// project environment variable, so the build decrypts the files and the password-protected site
// serves them; the repository only ever holds ciphertext (AES-256-GCM: 12-byte IV, 16-byte tag, data).
// Without a key, decrypt does nothing and the site plays without the recordings.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const encRoot = join(root, 'content', 'audio-enc');
const pubRoot = join(root, 'public', 'audio');

function loadKey() {
  let hex = process.env.AUDIO_KEY;
  const envFile = join(root, '.env.local');
  if (!hex && existsSync(envFile)) hex = readFileSync(envFile, 'utf8').match(/^AUDIO_KEY=([0-9a-f]{64})\s*$/m)?.[1];
  if (!hex) return null;
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('AUDIO_KEY must be 64 hex characters');
  return Buffer.from(hex, 'hex');
}

function encryptFile(key, src, dst) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(readFileSync(src)), cipher.final()]);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, Buffer.concat([iv, cipher.getAuthTag(), data]));
}

function decryptFile(key, src, dst) {
  const buf = readFileSync(src);
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const data = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, data);
}

const [mode, slug] = process.argv.slice(2);
const key = loadKey();

if (mode === 'encrypt') {
  if (!key) throw new Error('Set AUDIO_KEY (64 hex chars) to encrypt');
  if (!slug) throw new Error('Usage: audio-crypt.mjs encrypt <slug>');
  const dir = join(pubRoot, slug);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.m4a'))) {
    encryptFile(key, join(dir, f), join(encRoot, slug, `${f}.enc`));
    console.log(`encrypted ${slug}/${f}`);
  }
} else if (mode === 'decrypt') {
  if (!existsSync(encRoot)) process.exit(0);
  if (!key) {
    console.warn('audio-crypt: AUDIO_KEY not set — recordings stay encrypted, the site will play without them.');
    process.exit(0);
  }
  let n = 0;
  for (const s of readdirSync(encRoot)) {
    for (const f of readdirSync(join(encRoot, s)).filter((f) => f.endsWith('.enc'))) {
      decryptFile(key, join(encRoot, s, f), join(pubRoot, s, f.replace(/\.enc$/, '')));
      n++;
    }
  }
  console.log(`audio-crypt: decrypted ${n} recording(s)`);
} else {
  console.error('Usage: audio-crypt.mjs encrypt <slug> | decrypt');
  process.exit(1);
}
