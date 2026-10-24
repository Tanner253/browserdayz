// The map as a file (src/world/world-file.ts) is the map the page made: `withCaves(generateWorld())` packed, gzipped,
// read back, and held to the original value for value. Numbers by their bits (so -0 and NaN are told apart), keys in
// their order, each typed array of its own kind with its own bytes, and an object met in two places one object in
// both. Then the odd values the map does not hold today, so that a change to it that brings them is kept as well.
// About 40 s (the map is made once).
//   npx tsx test/world-file.test.ts

import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import { generateWorld } from '../src/world/worldgen';
import { WORLD_NX } from '../src/world/worldgen/places';
import { withCaves } from '../src/world/caves-carved';
import { looksWhole, packWorld, unpackWorld } from '../src/world/world-file';
import type { World } from '../src/world/worldgen';

/** a and b the same, value for value; `pairs` holds which object of b stands for which of a (so sharing is the same too) */
function same(a: unknown, b: unknown, path: string, pairs: Map<object, object>) {
  if (typeof a === 'number') {
    assert.equal(typeof b, 'number', path);
    const x = new Float64Array([a]), y = new Float64Array([b as number]);
    assert.ok(new Uint8Array(x.buffer).every((v, i) => v === new Uint8Array(y.buffer)[i]), `${path}: ${a} became ${b}`);
    return;
  }
  if (!a || typeof a !== 'object') return void assert.equal(b, a, path);
  assert.ok(b && typeof b === 'object', `${path}: not an object`);
  if (pairs.has(a)) return void assert.ok(pairs.get(a) === b, `${path}: one object in the map is two in the file`);
  pairs.set(a, b as object);
  if (ArrayBuffer.isView(a)) {
    const v = b as ArrayBufferView;
    assert.equal(v.constructor, a.constructor, path);
    assert.equal(v.byteLength, a.byteLength, path);
    assert.equal(v.byteOffset, 0, `${path}: a view into a shared buffer`);
    assert.equal(v.buffer.byteLength, v.byteLength, `${path}: a view into a shared buffer`);
    assert.ok(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(v.buffer, v.byteOffset, v.byteLength)), `${path}: bytes differ`);
    return;
  }
  assert.equal(Array.isArray(b), Array.isArray(a), path);
  assert.equal(Object.getPrototypeOf(b), Object.getPrototypeOf(a), path);
  const ka = Object.keys(a), kb = Object.keys(b as object);
  assert.deepEqual(kb, ka, `${path}: keys`);
  for (const k of ka) same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, pairs);
}
const roundTrip = (w: World, row: number) => unpackWorld(gunzipSync(gzipSync(packWorld(w, row, (b) => gzipSync(b, { level: 1 }).length)))) as World;

// (the odd values, on a world in small)
{
  const row = 8;
  const shared = { x: 1, inner: { y: -0 } };
  const heights = new Float32Array(row * 4).map((_, i) => Math.sin(i) * 100);
  const surface = heights.slice();
  surface[5] = 42;
  const w = {
    heights, surface, grass: new Uint8Array(row * 4).map((_, i) => i * 7), splat: new Uint8Array(row * 16).map((_, i) => (i * 13) & 255),
    odd: [-0, NaN, Infinity, -Infinity, undefined, null, 0.1 + 0.2, 1e-310, '$not a key', '\ud800'], gone: undefined,
    a: shared, b: [shared, shared.inner], spawn: { x: 3 }, buildings: [], trees: [],
  } as unknown as World;
  w.spawns = [w.spawn];
  const back = roundTrip(w, row);
  same(w, back, 'small', new Map());
  assert.ok('gone' in back, 'a key holding undefined is kept');
  const b = back as unknown as { a: object; b: object[]; spawn: object; spawns: object[] };
  assert.ok(b.b[0] === b.a && b.b[1] === (b.a as { inner: object }).inner && b.spawns[0] === b.spawn, 'shared objects kept shared');
  assert.throws(() => packWorld({ ...w, bad: { $t: 0 } } as unknown as World, row), /cannot be kept/);
  assert.throws(() => packWorld({ ...w, bad: new Map() } as unknown as World, row), /cannot be kept/);
}

// (the map itself)
const t0 = performance.now();
const world = withCaves(generateWorld());
const raw = packWorld(world, WORLD_NX, (b) => gzipSync(b, { level: 6 }).length);
const gz = gzipSync(raw, { level: 9 });
const back = unpackWorld(gunzipSync(gz));
same(world, back, 'world', new Map());
assert.ok(looksWhole(back));
assert.ok(back.spawns[0] === back.spawn, 'the first start is the default spawn, one object');
console.log(`world file: ${(gz.length / 1048576).toFixed(2)} MB, the map as made, value for value (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
