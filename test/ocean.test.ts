// The sea's numbers (src/world/ocean-waves.ts): its wave picture repeats without a seam and is the same every time,
// its tiles cover its rectangle once and only once, and its depths are the world's where they were read and read
// between as the card reads them. No ports, no page; a second or two.
//   npx tsx test/ocean.test.ts

import assert from 'node:assert/strict';
import { depthGrid, depthIn, foamNet, oceanTiles, shallowestIn, waveMap } from '../src/world/ocean-waves';

// ---- the wave picture: no seam where it repeats, the same from the same seed, slopes about nothing on the whole
{
  const w = waveMap(256);
  const { data, res } = w;
  const at = (x: number, z: number, c: number) => data[(((z + res) % res) * res + ((x + res) % res)) * 4 + c];
  // the biggest step between neighbours anywhere inside it, and across its edges (where it meets its own other side)
  let inside = 0, seam = 0;
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res - 1; x++) for (let c = 0; c < 3; c++) inside = Math.max(inside, Math.abs(at(x + 1, z, c) - at(x, z, c)));
    for (let c = 0; c < 3; c++) seam = Math.max(seam, Math.abs(at(0, z, c) - at(res - 1, z, c)), Math.abs(at(z, 0, c) - at(z, res - 1, c)));
  }
  assert.ok(seam <= inside, `a seam where the picture repeats (${seam} against ${inside} inside it)`);
  let sx = 0, sz = 0;
  for (let p = 0; p < res * res; p++) {
    sx += data[p * 4] - 128;
    sz += data[p * 4 + 1] - 128;
  }
  assert.ok(Math.abs(sx / (res * res)) < 2 && Math.abs(sz / (res * res)) < 2, 'the sea leans one way on the whole');
  assert.deepEqual(waveMap(256).data, data, 'not the same picture from the same seed');
  assert.ok(w.rms > 0 && w.rms < w.slope, 'no waves');
  const foam = foamNet(64);
  assert.ok(foam.some((v) => v > 200) && foam.some((v) => v === 0), 'the foam net is all one thing');
  console.log(`waves: no seam (steps of ${seam} at the edges, ${inside} inside), steepest ${w.slope.toFixed(2)} of the sum, on the whole ${w.rms.toFixed(2)}`);
}

// ---- the tiles: once over every part of the rectangle, the last ones cut to it
{
  const r = { x0: -3840 - 1500, x1: -3840 + 700, z0: -768, z1: 768 };
  const tiles = oceanTiles(r, 256);
  const area = tiles.reduce((s, t) => s + (t.x1 - t.x0) * (t.z1 - t.z0), 0);
  assert.equal(area, (r.x1 - r.x0) * (r.z1 - r.z0), 'the tiles do not cover the sea exactly');
  for (const t of tiles) {
    assert.ok(t.x0 >= r.x0 && t.x1 <= r.x1 && t.z0 >= r.z0 && t.z1 <= r.z1 && t.x1 > t.x0 && t.z1 > t.z0, 'a tile outside the sea');
    for (const u of tiles) if (u !== t) assert.ok(u.x0 >= t.x1 || u.x1 <= t.x0 || u.z0 >= t.z1 || u.z1 <= t.z0, 'two tiles over one place');
  }
  console.log(`tiles: ${tiles.length} of 256 m over ${(r.x1 - r.x0) / 1000} by ${(r.z1 - r.z0) / 1000} km, each place once`);
}

// ---- the depths: the world's at the points read, between them as the card reads them, held at the edges
{
  const r = { x0: -100, x1: 60, z0: -30, z1: 50 };
  const shelf = (x: number, z: number) => 4 - 0.05 * x + 0.02 * z;
  const g = depthGrid(r, 4, shelf);
  assert.equal(g.nx, 41);
  assert.equal(g.nz, 21);
  for (const [x, z] of [[-100, -30], [60, 50], [-12, 6], [0, 0]]) assert.ok(Math.abs(depthIn(g, x, z) - shelf(x, z)) < 1e-5, `depth at ${x},${z}`);
  // (a sloping floor is read between the points as it is: the reading is straight between them)
  assert.ok(Math.abs(depthIn(g, -41.3, 17.9) - shelf(-41.3, 17.9)) < 1e-4, 'depth between the points');
  assert.ok(Math.abs(depthIn(g, -500, 0) - shelf(-100, 0)) < 1e-5, 'depth off the edge is not the edge');
  // a wide sea is read more coarsely, never more than the most points a side
  const wide = depthGrid({ x0: 0, x1: 20000, z0: 0, z1: 100 }, 4, () => 1, 2048);
  assert.ok(wide.nx <= 2048 && wide.cell > 4, 'a wide sea read finer than the card can hold');
  // a tile is drawn solid only if all of its water, to its edges, is deep (the shelf is shallowest at its east, x = 60)
  assert.ok(Math.abs(shallowestIn(g, { x0: -100, x1: 60, z0: -30, z1: 50 }) - shelf(60, -30)) < 1e-5, 'the shallowest of the whole');
  assert.ok(shallowestIn(g, { x0: -100, x1: -60, z0: -30, z1: 50 }) <= shelf(-60 + 4, -30) + 1e-5, 'a tile read short of its edge');
  console.log(`depths: ${g.nx} by ${g.nz} points, read straight between; 20 km of sea read every ${wide.cell.toFixed(1)} m`);
}
console.log('ocean: all good');
