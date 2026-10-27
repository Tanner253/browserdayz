// The map's walls on the server (server/walls.ts): a wall stops a round and a look, a curtain only a look, a line
// round them is clear, and a file of another map is not taken.
import assert from 'node:assert/strict';
import { WALLS, readWalls, roundClear, sightClear } from '../server/walls';

/** a walls file as scripts/solid-bake.page.js writes it, of cuboids only: [hx, hy, hz, x, y, z, flags] */
function file(print: string, boxes: number[][]): Buffer {
  const head = Buffer.from(JSON.stringify({ v: 1, print }));
  const hl = (head.length + 3) & ~3, b = Buffer.alloc(12 + hl + 8 + boxes.length * 44);
  b.write('ZSOL', 0, 'latin1');
  b.writeUInt32LE(1, 4);
  b.writeUInt32LE(head.length, 8);
  head.copy(b, 12);
  let o = 12 + hl;
  b.writeUInt32LE(0, o);
  b.writeUInt32LE(boxes.length, o + 4);
  o += 8;
  for (const [hx, hy, hz, x, y, z, flags] of boxes) {
    b.writeUInt8(0, o);
    b.writeUInt8(flags, o + 1);
    [x, y, z, 0, 0, 0, 1, hx, hy, hz].forEach((v, i) => b.writeFloatLE(v, o + 4 + i * 4));
    o += 44;
  }
  return b;
}

// a wall across x = 5 (z -2..2, 3 m high), and a curtain across x = 5 at z 10
const walls = file('map-a', [
  [0.1, 1.5, 2, 5, 1.5, 0, 0],
  [0.02, 1.2, 1, 5, 1.2, 10, 1],
]);
assert.match(await readWalls(walls, 'map-b'), /another map/, 'a file of another map is not taken');
assert.equal(WALLS.on, false);
assert.equal(await readWalls(walls, 'map-a'), '');
assert.equal(WALLS.on, true);
assert.equal(WALLS.pieces, 2);

assert.equal(roundClear([0, 1.6, 0], [10, 1.2, 0]), false, 'through the wall: stopped');
assert.equal(sightClear([0, 1.6, 0], [10, 1.2, 0]), false, 'nor seen through it');
assert.equal(roundClear([0, 1.6, 5], [10, 1.2, 5]), true, 'beside it: clear');
assert.equal(roundClear([0, 4, 0], [10, 4, 0]), true, 'over it: clear');
assert.equal(roundClear([0, 1.6, 0], [4.5, 1.2, 0]), true, 'short of it: clear');
assert.equal(roundClear([0, 1.6, 10], [10, 1.2, 10]), true, 'a curtain lets a round through');
assert.equal(sightClear([0, 1.6, 10], [10, 1.2, 10]), false, 'and hides who is behind it');

console.log('walls ok');
