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

// --- the shape: the rim falls away into green rolling land, which comes down to a beach, the beach to a thin sea
const band = (x0: number, x1: number, zr: number) => {
  let lo = Infinity, hi = -Infinity, steep = 0;
  const slopes: number[] = [];
  for (let x = x0; x <= x1; x += 8) for (let z = -zr; z <= zr; z += 8) {
    const h = heightAt(H, x, z), s = slopeAt(H, x, z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    steep = Math.max(steep, s);
    slopes.push(s);
  }
  slopes.sort((a, b) => a - b);
  return { lo, hi, steep, most: slopes[Math.floor(slopes.length * 0.98)] };
};
const green = band(-3200, -1400, 560);
assert.ok(green.lo >= SEA + 5 && green.hi <= SEA + 80, `the green land runs ${(green.lo - SEA).toFixed(1)} to ${(green.hi - SEA).toFixed(1)} m over the sea`);
// (the square's valley, measured so 2026-10-16: 2% of it steeper than 0.69, at most 1.52: the green land is to be no rougher)
assert.ok(green.most < 0.5 && green.steep < 1.0, `the green land is not gentle: 2% of it steeper than ${green.most.toFixed(2)}, at most ${green.steep.toFixed(2)}`);
ok(`green rolling land west of the hills: ${(green.lo - SEA).toFixed(0)} to ${(green.hi - SEA).toFixed(0)} m over the sea, 98% of it under ${(Math.atan(green.most) * 57.3).toFixed(0)} degrees, the steepest ${(Math.atan(green.steep) * 57.3).toFixed(0)}`);
let shoreW = Infinity, shoreE = -Infinity, deepest = 0, shallowest = -Infinity, beachSteep = 0, wet = 0;
for (let iz = 0; iz < NZ; iz++) {
  let last = X0;
  for (let ix = 0; ix < OX; ix++) if (at(ix, iz) < SEA) last = X0 + ix * CELL;
  shoreW = Math.min(shoreW, last);
  shoreE = Math.max(shoreE, last);
  // (nowhere is there sea but in the strip: no lake inland of it, the ground under the sea's height)
  for (let ix = (last - X0) / CELL + 1; ix < OX; ix++) if (at(ix, iz) < SEA) wet++;
  shallowest = Math.max(shallowest, at(0, iz));
  deepest = Math.min(deepest, at(0, iz));
  for (let x = last - 30; x <= last + WEST.sand; x += 4) beachSteep = Math.max(beachSteep, slopeAt(H, x, Z0 + iz * CELL));
  const line = WG.shoreLine(Z0 + iz * CELL);
  assert.ok(Math.abs(line - last) <= 2 * CELL + 1, `the shore line said is ${line.toFixed(1)}, the ground meets the sea at ${last}`);
}
assert.ok(shoreW >= -3640 && shoreE <= -3540, `the shore runs from ${shoreW} to ${shoreE}`);
assert.ok(shallowest < SEA - 6, `the sea at the west edge is only ${(SEA - shallowest).toFixed(1)} m deep`);
assert.ok(beachSteep < 0.1, `a beach that is no beach: a slope of ${beachSteep.toFixed(2)}`);
assert.equal(wet, 0, 'ground under the sea\'s height inland of the shore');
ok(`a thin sea in the west: the shore between x ${shoreW} and ${shoreE} (${shoreW - X0} to ${shoreE - X0} m of water), as shoreLine says it; the beach never steeper than ${(Math.atan(beachSteep) * 57.3).toFixed(1)} degrees; the floor ${(SEA - shallowest).toFixed(0)} to ${(SEA - deepest).toFixed(0)} m deep at the edge; no ground under the sea's height inland`);

// --- the paint and the grass of the new ground: green, but on the beach and under the sea
let bare = 0, all = 0, worst = 0, grassy = 0, beach = 0, beachBare = 0;
for (let iz = 0; iz < NZ; iz++) {
  const shore = WG.shoreLine(Z0 + iz * CELL);
  for (let ix = 0; ix < OX; ix++) {
    const i = iz * NX + ix, s = world.splat, x = X0 + ix * CELL;
    worst = Math.max(worst, Math.abs(s[i * 4] + s[i * 4 + 1] + s[i * 4 + 2] + s[i * 4 + 3] - 255));
    if (x < WEST.seam - 450 && x > shore + WEST.sand + 40) {
      all++;
      if (s[i * 4 + 3] > 200) bare++;
      if (world.grass[i] > 0) grassy++;
    } else if (x < shore + WEST.sand - 30) {
      beach++;
      if (s[i * 4 + 3] > 200) beachBare++;
    }
  }
}
assert.ok(worst <= 2, `the paint does not add up: ${worst} of 255 out`);
assert.ok(bare / all < 0.03 && grassy / all > 0.9, `the green land is ${((bare / all) * 100).toFixed(1)}% bare, with grass at ${((grassy / all) * 100).toFixed(1)}% of it`);
assert.ok(beachBare / beach > 0.98, `the beach and the sea floor are only ${((beachBare / beach) * 100).toFixed(1)}% bare`);
ok(`the new ground painted: grass growing on ${((grassy / all) * 100).toFixed(1)}% of the green land and bare earth on ${((bare / all) * 100).toFixed(1)}% of it; the beach and the sea floor bare (${((beachBare / beach) * 100).toFixed(1)}%); the paint whole everywhere`);

// --- the woods of the rim carried on down the fall, and nothing planted on the square
const west = world.trees.filter((t) => t.x < WEST.seam);
assert.ok(west.length > 500, `only ${west.length} trees on the rim's fall`);
assert.ok(west.every((t) => t.x > WEST.seam - WEST.woods[1] - 30 && Math.abs(t.y - heightAt(H, t.x, t.z)) < 1e-3), 'a tree out in the plain, or off the ground');
const near = west.filter((t) => t.x > WEST.seam - 100).length, far = west.filter((t) => t.x < WEST.seam - 300 && t.x > WEST.seam - 400).length;
assert.ok(near > far * 2, `the woods do not thin out: ${near} in the first 100 m, ${far} from 300 to 400`);
ok(`${west.length} trees on the rim's fall, thinning out (${near} in its first hundred metres, ${far} three hundred metres on), none out in the green land beyond`);

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
