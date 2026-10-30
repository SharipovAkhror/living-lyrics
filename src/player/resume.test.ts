/**
 * Unit checks for the resume record.
 * Run: npx tsx src/player/resume.test.ts
 * test:interactions spawns this file. The page-kill cases are `npm run test:resume`.
 */
import assert from 'node:assert/strict';
import { RESUME_AUTO_MS, clearResume, readResume, usableResume, writeResume } from './resume';

function install(storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void }) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

const mem = new Map<string, string>();
install({
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => {
    mem.set(key, value);
  },
  removeItem: (key) => {
    mem.delete(key);
  },
});

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS resume ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`FAIL resume ${name} ${message}`);
    process.exitCode = 1;
  }
}

check('round-trip', () => {
  writeResume('karitas', { t: 12.5, playing: true, savedAt: 100 });
  const got = readResume('karitas');
  assert.equal(got?.t, 12.5);
  assert.equal(got?.playing, true);
  assert.equal(got?.savedAt, 100);
});

check('rejects NaN', () => {
  writeResume('one', { t: Number.NaN, playing: false, savedAt: 1 });
  assert.equal(readResume('one'), null);
  assert.equal(readResume('karitas')?.t, 12.5);
});

check('corrupt json', () => {
  mem.set('living-lyrics.resume.v1', '{');
  assert.equal(readResume('karitas'), null);
});

check('clear', () => {
  writeResume('karitas', { t: 4, playing: false, savedAt: 8 });
  clearResume('karitas');
  assert.equal(readResume('karitas'), null);
});

check('usable point', () => {
  const now = Date.now();
  writeResume('karitas', { t: 40, playing: true, savedAt: now });
  assert.equal(readResume('karitas', { duration: 30, now }), null);
  assert.equal(readResume('karitas', { duration: 40, now })?.t, 40);
  assert.equal(readResume('karitas', { duration: 90, now })?.t, 40);
  assert.equal(usableResume('karitas', 90, now)?.t, 40);

  writeResume('karitas', { t: 40, playing: true, savedAt: now + 60_000 });
  assert.equal(readResume('karitas', { now }), null);
  assert.equal(usableResume('karitas', 90, now), null);

  writeResume('karitas', { t: 0.2, playing: true, savedAt: now });
  assert.equal(usableResume('karitas', 90, now), null);

  writeResume('karitas', { t: 40, playing: true, savedAt: now - RESUME_AUTO_MS - 1 });
  assert.equal(usableResume('karitas', 90, now), null);

  mem.set('living-lyrics.resume.v1', JSON.stringify({ karitas: { t: '90', playing: true, savedAt: now } }));
  assert.equal(readResume('karitas', { now }), null);
  mem.set('living-lyrics.resume.v1', '{"karitas":{"t":1e999,"playing":true,"savedAt":1}}');
  assert.equal(readResume('karitas', { now }), null);
});

check('storage throws', () => {
  install({
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  });
  assert.equal(readResume('karitas'), null);
  writeResume('karitas', { t: 3, playing: true, savedAt: 1 });
  clearResume('karitas');
});
