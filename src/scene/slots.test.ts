/**
 * Run: npx tsx src/scene/slots.test.ts
 */
import assert from 'node:assert/strict';
import { assignSlots, sameSlots, type PhoneSlot } from './slots';

const blank = (): (PhoneSlot | null)[] => [null, null, null, null];

const first = assignSlots(blank(), [1, 2]);
assert.deepEqual(first, [
  { idx: 1, live: true },
  { idx: 2, live: true },
  null,
  null,
]);

// The cue that stays must keep its slot. The new cue reuses the parked host.
const slid = assignSlots(first, [2, 3]);
assert.deepEqual(slid, [
  { idx: 3, live: true },
  { idx: 2, live: true },
  null,
  null,
]);

const parked = assignSlots(slid, [2]);
assert.deepEqual(parked, [
  { idx: 3, live: false },
  { idx: 2, live: true },
  null,
  null,
]);
assert.equal(sameSlots(parked, parked), true);
assert.equal(sameSlots(parked, slid), false);

const full = assignSlots(parked, [2, 3, 4, 5, 6]);
assert.deepEqual(
  full.map((s) => s?.idx),
  [3, 2, 4, 5],
);
assert.equal(full.every((s) => s?.live), true);

console.log('slots ok');
