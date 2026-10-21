/**
 * Run: npx tsx src/ui/spring.test.ts
 * The sheet spring peaks between 2% and 3% and is quiet by 340 ms.
 */
import assert from 'node:assert/strict';
import { RELEASE_SPRING, SPRING, stepSpring, type SpringState } from './spring';

function run(spring = SPRING, ms = 700): { peak: number; settle: number } {
  let state: SpringState = { x: 0, v: 0 };
  let peak = 0;
  let settle = ms;
  let quiet = 0;
  for (let t = 0; t <= ms; t += 8) {
    state = stepSpring(state, 1, 0.008, spring);
    if (state.x > peak) peak = state.x;
    const done = Math.abs(state.x - 1) < 0.005 && Math.abs(state.v) < 0.02;
    quiet = done ? quiet + 8 : 0;
    if (quiet >= 24 && settle === ms) settle = t;
  }
  return { peak, settle };
}

const sheet = run();
assert.ok(sheet.peak >= 1.02 && sheet.peak <= 1.03, `sheet peak ${sheet.peak}`);
assert.ok(sheet.settle > 240 && sheet.settle < 360, `sheet settle ${sheet.settle}`);

let release: SpringState = { x: 0.8, v: 0 };
let releasePeak = 0.8;
for (let t = 0; t <= 900; t += 8) {
  release = stepSpring(release, 1, 0.008, RELEASE_SPRING);
  if (release.x > releasePeak) releasePeak = release.x;
}
assert.ok(releasePeak >= 1.02 && releasePeak <= 1.03, `release peak ${releasePeak}`);
assert.ok(Math.abs(release.x - 1) < 0.01, `release settles ${release.x}`);

let flicked: SpringState = { x: 40, v: 900 };
const before = flicked.v;
flicked = stepSpring(flicked, 0, 0.016);
assert.ok(flicked.v < before, 'a flick keeps a finite velocity and the spring pulls it back');
assert.ok(Number.isFinite(flicked.x) && Number.isFinite(flicked.v), 'analytic step stays finite');

let held: SpringState = { x: 0.2, v: 1.4 };
held = stepSpring(held, 1, 0.016);
const atRetarget = { x: held.x, v: held.v };
held = stepSpring(atRetarget, 0, 0.016);
const fromRest = stepSpring({ x: atRetarget.x, v: 0 }, 0, 0.016);
assert.notEqual(held.v, 0, 'retarget does not zero the velocity');
assert.ok(Math.abs(held.v - fromRest.v) > 0.05, 'retarget keeps the velocity already on the state');

console.log(`✓ spring  peak ${sheet.peak.toFixed(4)}  settle ${sheet.settle} ms  release ${releasePeak.toFixed(4)}`);
