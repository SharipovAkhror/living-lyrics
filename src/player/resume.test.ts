/**
 * Run: npm run test:resume
 * Five named checks. test:interactions spawns this file and counts the lines.
 */
import assert from 'node:assert/strict';
import { clearResume, readResume, writeResume } from './resume';

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
