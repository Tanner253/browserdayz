import assert from 'node:assert/strict';
import { cachedWorld } from '../src/world/world-cache';

const world = { heights: new Float32Array([1]), grass: new Uint8Array([2]), trees: [], buildings: [] } as never;
let made = 0;
const generate = () => { made++; return world; };
assert.equal(await cachedWorld(undefined, generate), world);
assert.equal(await cachedWorld('compiled-worker-hash', generate), world);
assert.equal(made, 2, 'no storage must take the ordinary generation path');
const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
try {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { throw new Error('storage blocked'); } } });
  assert.equal(await cachedWorld('compiled-worker-hash', generate), world);
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { return {}; } } });
  const began = performance.now();
  assert.equal(await cachedWorld('compiled-worker-hash', generate), world);
  assert.ok(performance.now() - began < 2000, 'an unanswered storage request must not hang world loading');
  assert.equal(made, 4);
  await assert.rejects(cachedWorld(undefined, () => { throw new Error('generation failed'); }), /generation failed/);
  console.log('ok   missing, blocked, and unresponsive storage fall back; genuine generation errors remain visible');
} finally {
  if (original) Object.defineProperty(globalThis, 'indexedDB', original);
  else Reflect.deleteProperty(globalThis, 'indexedDB');
}
