/**
 * Run: npx tsx src/player/preload.test.ts
 */
import assert from 'node:assert/strict';
import { eagerAudio, preloadMode } from './preload';

const save = { saveData: true, effectiveType: '4g' };
const slow = { saveData: false, effectiveType: '3g' };
const fast = { saveData: false, effectiveType: '4g' };
const desk = { saveData: false, effectiveType: '' };

assert.equal(eagerAudio(save), false);
assert.equal(eagerAudio(slow), false);
assert.equal(eagerAudio({ saveData: false, effectiveType: '2g' }), false);
assert.equal(eagerAudio(fast), true);
assert.equal(eagerAudio(desk), true);

assert.equal(preloadMode('play', save), 'auto');
assert.equal(preloadMode('play', slow), 'auto');
assert.equal(preloadMode('first', save), 'none');
assert.equal(preloadMode('settle', save), 'none');
assert.equal(preloadMode('first', slow), 'none');
assert.equal(preloadMode('settle', slow), 'none');
assert.equal(preloadMode('first', fast), 'metadata');
assert.equal(preloadMode('settle', fast), 'auto');
assert.equal(preloadMode('first', desk), 'metadata');
assert.equal(preloadMode('settle', desk), 'auto');

console.log('preload: ok');
