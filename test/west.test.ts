// THE WORLD GROWN WEST (2026-10-16): the square as it was, and the ground west of it.   npx tsx test/west.test.ts
// The owner: "from west to east itll be ocean, beach, desert, plains, mountains. We have the plains and mountains."
// The square (the map until then) is held to prints taken off the tree before the world grew: every field of the
// ground's net cut out of the world's, and everything that stands on it. Then the new ground: no step and no crease
// at the seam, a broad plain at the desert's height, a beach and a sea floor in the west, paint to match, the woods
// of the rim thinned out down the fall and nothing planted on the square, and the ground bodies stand on (Rapier's
// heightfield of the whole world, laid where the game lays it) where `heightAt` says it is.
// (WEST_PRINT=1 prints the square's prints instead of holding it to them: run so in a tree from before 2026-10-16,
// with a copy of this file, to take them again.)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import * as WG from '../src/world/worldgen';
import { generateWorld, heightAt, slopeAt, type World } from '../src/world/worldgen';

const SQ = 769, HALF = 768, CELL = 2;
const W = WG as unknown as Record<string, number> & typeof WG;
const NX = W.WORLD_NX ?? SQ, OX = W.WORLD_X0 === undefined ? 0 : (-HALF - W.WORLD_X0) / CELL, OZ = W.WORLD_Z0 === undefined ? 0 : (-HALF - W.WORLD_Z0) / CELL;
/** the square's samples of a field of the world's net (`per` numbers to a sample), in the square's own order */
function square<T extends Float32Array | Uint8Array>(a: T, per = 1): T {
  const out = new (a.constructor as new (n: number) => T)(SQ * SQ * per);
  for (let iz = 0; iz < SQ; iz++) out.set(a.subarray(((iz + OZ) * NX + OX) * per, ((iz + OZ) * NX + OX + SQ) * per), iz * SQ * per);
  return out;
}
const print = (v: ArrayBufferView | unknown) => {
  const h = createHash('sha256');
  if (ArrayBuffer.isView(v)) h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  else h.update(JSON.stringify(v));
  return h.digest('hex').slice(0, 16);
};
const onSq = (p: { x: number; z: number }) => Math.abs(p.x) <= HALF && Math.abs(p.z) <= HALF;

const t0 = performance.now();
const world: World = generateWorld();
const made = performance.now() - t0;
const prints = {
  heights: print(square(world.heights)),
  surface: print(square(world.surface)),
  splat: print(square(world.splat, 4)),
  grass: print(square(world.grass)),
  trees: print(world.trees.filter(onSq)),
  rocks: print(world.rocks.filter(onSq)),
  props: print(world.props.filter(onSq)),
  buildings: print(world.buildings),
  spawns: print([world.spawns, world.spawnRing]),
  rest: print([world.road, world.roads, world.bridges, world.paths, world.worn, world.wreck, world.walls, world.gatehouse, world.castle, world.pois, world.sites, world.solids]),
};
if (process.env.WEST_PRINT) {
  console.log(JSON.stringify(prints, null, 1));
  process.exit(0);
}
let checks = 0;
const ok = (what: string) => { checks++; console.log(`  ok  ${what}`); };

// --- the square as it was (prints taken 2026-10-16 off f1d0ca0, the last tree with the square alone)
const WAS = {
  heights: 'ab11c3520dc204c8', surface: '2cef399e43bc7143', splat: 'c370ac29f03eb841', grass: '52307f0f4a88060b', trees: '823eba9cb861e5de',
  rocks: '9e05c737a3c05a37', props: 'b7ac1b9442e7ed1f', buildings: '2dc6d52235386608', spawns: 'a19d07b56cb336e8', rest: '0482a1d3f8bca13a',
};
for (const [k, v] of Object.entries(WAS)) assert.equal(prints[k as keyof typeof prints], v, `the square's ${k} are not what they were`);
ok(`the square as it was, to the byte: its ground, paint and grass, ${world.trees.filter(onSq).length} trees, ${world.rocks.filter(onSq).length} rocks, ${world.props.filter(onSq).length} props, ${world.buildings.length} buildings, the starts, the roads, the fort (made in ${made.toFixed(0)} ms)`);

// --- the world's measures
const { WORLD_X0: X0, WORLD_X1: X1, WORLD_Z0: Z0, WORLD_Z1: Z1, WORLD_NZ: NZ, SEA_LEVEL: SEA, WEST } = WG;
assert.equal(world.heights.length, NX * NZ);
assert.equal(world.splat.length, NX * NZ * 4);
assert.equal(world.grass.length, NX * NZ);
assert.ok(world.surface.length === NX * NZ, 'the surface is on the world\'s net');
assert.deepEqual([X0, X1, Z0, Z1, NX, NZ], [-3840, 768, -768, 768, 2305, 769]);
for (const t of [...world.trees, ...world.rocks, ...world.props, ...world.buildings]) assert.ok(WG.onWorld(t.x, t.z), `something stands off the world at ${t.x}, ${t.z}`);
ok('the world is 4608 m by 1536 m, x -3840 to 768 and z -768 to 768, on one net of 2305 by 769 samples');

// --- the seam: the square's last column and the first of the new ground
const H = world.heights, at = (ix: number, iz: number) => H[iz * NX + ix];
let step = 0, crease = 0, inner = 0;
for (let iz = 0; iz < NZ; iz++) {
  // (across the seam: the fall from the first new column to the square's edge, against the square's own next fall)
  const a = at(OX - 2, iz), b = at(OX - 1, iz), c = at(OX, iz), d = at(OX + 1, iz), e = at(OX + 2, iz);
  step = Math.max(step, Math.abs(c - b) - Math.abs(d - c));
  crease = Math.max(crease, Math.abs(b - 2 * c + d));
  inner = Math.max(inner, Math.abs(c - 2 * d + e), Math.abs(a - 2 * b + c));
}
assert.ok(crease <= Math.max(0.6, inner * 1.25), `a crease at the seam: ${crease.toFixed(2)} m against ${inner.toFixed(2)} either side of it`);
ok(`no step and no crease at the seam: the fall across it is within ${step.toFixed(2)} m of the square's own, its bend ${crease.toFixed(2)} m where the ground either side bends ${inner.toFixed(2)}`);

// --- the shape: the rim falls away into the plain, the plain comes down to a beach, the beach to the sea
const band = (x0: number, x1: number, zr: number) => {
  let lo = Infinity, hi = -Infinity, steep = 0;
  for (let x = x0; x <= x1; x += 8) for (let z = -zr; z <= zr; z += 8) {
    const h = heightAt(H, x, z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    steep = Math.max(steep, slopeAt(H, x, z));
  }
  return { lo, hi, steep };
};
const plain = band(-2900, -1350, 560);
assert.ok(plain.lo >= SEA + 15 && plain.hi <= SEA + 45, `the plain runs ${plain.lo.toFixed(1)} to ${plain.hi.toFixed(1)} m`);
assert.ok(plain.steep < 0.25, `the plain is not gentle: a slope of ${plain.steep.toFixed(2)}`);
ok(`a broad plain west of the hills: ${(plain.lo - SEA).toFixed(0)} to ${(plain.hi - SEA).toFixed(0)} m over the sea, no slope over ${(Math.atan(plain.steep) * 57.3).toFixed(1)} degrees`);
let shoreW = Infinity, shoreE = -Infinity, deepest = 0, beachSteep = 0;
for (let iz = 0; iz < NZ; iz++) {
  let last = X0;
  for (let ix = 0; ix < OX; ix++) if (at(ix, iz) < SEA) last = X0 + ix * CELL;
  shoreW = Math.min(shoreW, last);
  shoreE = Math.max(shoreE, last);
  assert.ok(at(0, iz) < SEA - 15, `the sea at the west edge is shallow at z ${Z0 + iz * CELL}`);
  deepest = Math.min(deepest, at(0, iz));
  for (let x = last - 40; x <= last + 60; x += 4) beachSteep = Math.max(beachSteep, slopeAt(H, x, Z0 + iz * CELL));
}
assert.ok(shoreW > -3400 && shoreE < -3080, `the shore runs from ${shoreW} to ${shoreE}`);
assert.ok(beachSteep < 0.15, `a beach that is no beach: a slope of ${beachSteep.toFixed(2)}`);
ok(`the sea in the west: the shore between x ${shoreW} and ${shoreE}, the beach never steeper than ${(Math.atan(beachSteep) * 57.3).toFixed(1)} degrees, the floor ${(SEA - deepest).toFixed(0)} m deep at the edge`);

// --- the paint and the grass of the new ground
let bare = 0, all = 0, worst = 0, grassy = 0;
for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < OX; ix++) {
  const i = iz * NX + ix, s = world.splat;
  worst = Math.max(worst, Math.abs(s[i * 4] + s[i * 4 + 1] + s[i * 4 + 2] + s[i * 4 + 3] - 255));
  const x = X0 + ix * CELL;
  if (x < WEST.seam - 600) {
    all++;
    if (s[i * 4 + 3] > 200) bare++;
    if (world.grass[i] > 0) grassy++;
  }
}
assert.ok(worst <= 2, `the paint does not add up: ${worst} of 255 out`);
assert.ok(bare / all > 0.95 && grassy === 0, `the dry country is ${((bare / all) * 100).toFixed(1)}% bare, with grass at ${grassy} points`);
ok(`the new ground painted: bare dry earth on ${((bare / all) * 100).toFixed(1)}% of all of it beyond 600 m from the seam, no grass there, the paint whole everywhere`);

// --- the woods of the rim carried on down the fall, and nothing planted on the square
const west = world.trees.filter((t) => t.x < WEST.seam);
assert.ok(west.length > 500, `only ${west.length} trees on the rim's fall`);
assert.ok(west.every((t) => t.x > WEST.seam - WEST.woods[1] - 30 && Math.abs(t.y - heightAt(H, t.x, t.z)) < 1e-3), 'a tree out in the plain, or off the ground');
const near = west.filter((t) => t.x > WEST.seam - 100).length, far = west.filter((t) => t.x < WEST.seam - 300 && t.x > WEST.seam - 400).length;
assert.ok(near > far * 2, `the woods do not thin out: ${near} in the first 100 m, ${far} from 300 to 400`);
ok(`${west.length} trees on the rim's fall, thinning out (${near} in its first hundred metres, ${far} three hundred metres on), none on the plain`);

// --- the ground bodies stand on: Rapier's heightfield of the whole world where the game lays it
await RAPIER.init();
const pw = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const f = WG.groundField(H);
pw.createCollider(RAPIER.ColliderDesc.heightfield(f.rows, f.cols, f.heights, f.scale).setTranslation(f.at.x, f.at.y, f.at.z));
pw.step();
let off = 0, n = 0;
for (let k = 0; k < 4000; k++) {
  // (off the net's lines: a ray straight down one of those is now and then let through by Rapier, on the square as anywhere)
  const x = X0 + 1.37 + ((k * 2654435761) % 4606), z = Z0 + 1.21 + ((k * 40503) % 1534) + (k % 7) * 0.13;
  const hit = pw.castRay(new RAPIER.Ray({ x, y: 500, z }, { x: 0, y: -1, z: 0 }), 1000, true);
  assert.ok(hit, `no ground under ${x}, ${z}`);
  off = Math.max(off, Math.abs(500 - hit!.timeOfImpact - heightAt(H, x, z)));
  n++;
}
assert.ok(off < 1e-3, `the ground bodies stand on is ${off.toFixed(4)} m off the ground's own`);
ok(`Rapier's heightfield of the world is the ground, east and west: ${n} spots, none more than ${(off * 1000).toFixed(2)} mm off`);

console.log(`\n${checks} checks passed`);
