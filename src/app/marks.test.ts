/**
 * Run: npx tsx src/app/marks.test.ts
 * Logic of owner marks: storage, undo, a missing localStorage, the copied report.
 */
import assert from 'node:assert/strict';
import type { Cue } from '@/data/timeline';
import {
  BEFORE_MARK,
  INSTRUMENTAL_MARK,
  clockLabel,
  createMarkBook,
  formatMarksReport,
  marksStorageKey,
  momentAt,
  parseMarks,
  type MarkStorage,
} from './marks';

function memoryStorage(): { storage: MarkStorage; raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    storage: {
      get: (key) => raw.get(key) ?? null,
      set: (key, value) => {
        raw.set(key, value);
      },
    },
  };
}

function draft(t: number, lineId: string | null, text: string) {
  return { t, lineId, text, sectionId: lineId ? 'sec' : 'overture', sectionLabel: lineId ? 'Бейт' : 'Увертюра' };
}

function testRoundTrip() {
  const { storage, raw } = memoryStorage();
  let n = 1000;
  const book = createMarkBook('karitas', storage, () => ++n);
  book.add(draft(95.206, 'fuzuli-1-2', 'Öyle ser-mestem ki'));
  book.add(draft(12, null, INSTRUMENTAL_MARK));
  const saved = raw.get(marksStorageKey('karitas'));
  assert.ok(saved);
  const again = createMarkBook('karitas', storage);
  const marks = again.getSnapshot().marks;
  assert.equal(marks.length, 2);
  assert.equal(marks[0].t, 12);
  assert.equal(marks[0].text, INSTRUMENTAL_MARK);
  assert.equal(marks[1].t, 95.206);
  assert.equal(marks[1].lineId, 'fuzuli-1-2');
  assert.equal(again.getSnapshot().memoryOnly, false);
  assert.deepEqual(parseMarks(saved!), marks);
}

function testUndoIsLastPressedNotLatestInSong() {
  const { storage } = memoryStorage();
  let n = 1000;
  const book = createMarkBook('karitas', storage, () => ++n);
  book.add(draft(50, 'a', 'later in the song'));
  book.add(draft(10, 'b', 'earlier in the song'));
  const shown = book.getSnapshot().marks.map((m) => m.lineId);
  assert.deepEqual(shown, ['b', 'a']);
  const removed = book.undoLast();
  assert.equal(removed?.lineId, 'b');
  assert.deepEqual(
    book.getSnapshot().marks.map((m) => m.lineId),
    ['a'],
  );
}

function testRemoveAndClear() {
  const { storage } = memoryStorage();
  const book = createMarkBook('one', storage, () => 1);
  const a = book.add(draft(1, 'a', 'one'));
  book.add(draft(2, 'b', 'two'));
  book.remove(a.id);
  assert.deepEqual(
    book.getSnapshot().marks.map((m) => m.lineId),
    ['b'],
  );
  book.remove('missing');
  assert.equal(book.getSnapshot().marks.length, 1);
  book.clear();
  assert.equal(book.getSnapshot().marks.length, 0);
  book.clear();
  assert.equal(book.getSnapshot().marks.length, 0);
}

function testStorageThrows() {
  const book = createMarkBook('karitas', {
    get() {
      throw new Error('denied');
    },
    set() {
      throw new Error('denied');
    },
  });
  assert.equal(book.getSnapshot().memoryOnly, true);
  const mark = book.add(draft(3, 'a', 'kept'));
  assert.equal(book.getSnapshot().marks.length, 1);
  assert.equal(book.getSnapshot().memoryOnly, true);
  book.remove(mark.id);
  assert.equal(book.getSnapshot().marks.length, 0);
}

function testQuotaAfterLoad() {
  const raw = new Map<string, string>();
  let failSet = false;
  const storage: MarkStorage = {
    get: (key) => raw.get(key) ?? null,
    set: (key, value) => {
      if (failSet) throw new Error('quota');
      raw.set(key, value);
    },
  };
  const first = createMarkBook('karitas', storage, () => 5);
  first.add(draft(4, 'a', 'saved'));
  failSet = true;
  const mark = first.add(draft(8, 'b', 'only in memory'));
  assert.equal(first.getSnapshot().memoryOnly, true);
  assert.equal(first.getSnapshot().marks.length, 2);
  assert.equal(mark.text, 'only in memory');
  const reloaded = createMarkBook('karitas', {
    get: (key) => raw.get(key) ?? null,
    set: () => {
      throw new Error('quota');
    },
  });
  assert.equal(reloaded.getSnapshot().marks.length, 1);
  assert.equal(reloaded.getSnapshot().marks[0].lineId, 'a');
}

function testCorruptJson() {
  const raw = new Map<string, string>([[marksStorageKey('karitas'), '{']]);
  const book = createMarkBook('karitas', {
    get: (key) => raw.get(key) ?? null,
    set: (key, value) => {
      raw.set(key, value);
    },
  });
  assert.deepEqual(book.getSnapshot().marks, []);
  assert.equal(book.getSnapshot().memoryOnly, false);
  assert.deepEqual(parseMarks('{"marks":[{"id":1}]}'), []);
  assert.deepEqual(parseMarks(null), []);
}

function testMoment() {
  const inst = { kind: 'inst', section: { id: 'overture', label: 'Увертюра' } } as Cue;
  const line = {
    kind: 'line',
    section: { id: 'fuzuli-1', label: 'Бейт 1' },
    line: { id: 'fuzuli-1-1', words: [{ w: 'Öyle' }, { w: 'ser-mestem' }, { w: 'ki' }] },
  } as Cue;
  const before = momentAt([inst, line], -1, 1.2);
  assert.equal(before.text, BEFORE_MARK);
  assert.equal(before.lineId, null);
  assert.equal(before.sectionLabel, 'Начало');
  const passage = momentAt([inst, line], 0, 20);
  assert.equal(passage.text, INSTRUMENTAL_MARK);
  assert.equal(passage.lineId, null);
  assert.equal(passage.sectionId, 'overture');
  const sung = momentAt([inst, line], 1, 39.5);
  assert.equal(sung.lineId, 'fuzuli-1-1');
  assert.equal(sung.text, 'Öyle ser-mestem ki');
  assert.equal(sung.sectionLabel, 'Бейт 1');
  assert.equal(momentAt([inst], 5, 0).text, BEFORE_MARK);
}

function testReport() {
  assert.equal(clockLabel(95.9), '1:35');
  assert.equal(clockLabel(0), '0:00');
  const text = formatMarksReport({
    title: 'Karitas',
    slug: 'karitas',
    commit: null,
    date: '2026-10-17',
    marks: [
      {
        id: '1',
        at: 1,
        t: 12,
        lineId: null,
        text: INSTRUMENTAL_MARK,
        sectionId: 'overture',
        sectionLabel: 'Увертюра',
      },
      {
        id: '2',
        at: 2,
        t: 95.2,
        lineId: 'fuzuli-1-2',
        text: 'Öyle ser-mestem ki',
        sectionId: 'fuzuli-1',
        sectionLabel: 'Бейт 1',
      },
    ],
  });
  assert.equal(
    text,
    [
      'Отметки «не совпадает»',
      'Песня: Karitas (karitas)',
      'Версия данных: 2026-10-17',
      '',
      '1. 12.00 с (0:12)',
      '   строка: —',
      '   текст: проигрыш',
      '   секция: overture — Увертюра',
      '',
      '2. 95.20 с (1:35)',
      '   строка: fuzuli-1-2',
      '   текст: Öyle ser-mestem ki',
      '   секция: fuzuli-1 — Бейт 1',
      '',
    ].join('\n'),
  );
  const hashed = formatMarksReport({
    title: 'Karitas',
    slug: 'karitas',
    commit: 'abc1234',
    date: '2026-10-17',
    marks: [],
  });
  assert.match(hashed, /Версия данных: abc1234/);
  const bad = formatMarksReport({
    title: 'Karitas',
    slug: 'karitas',
    commit: 'not a hash',
    date: '2026-10-17',
    marks: [],
  });
  assert.match(bad, /Версия данных: 2026-10-17/);
}

testRoundTrip();
testUndoIsLastPressedNotLatestInSong();
testRemoveAndClear();
testStorageThrows();
testQuotaAfterLoad();
testCorruptJson();
testMoment();
testReport();
console.log('marks: ok');
