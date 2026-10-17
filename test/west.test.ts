// THE WORLD GROWN WEST (2026-10-16): the rectangle, and plan v5 on it.   npx tsx test/west.test.ts
// The owner: "from west to east itll be ocean, beach, desert, plains, mountains"; "open up the werst side of the map
// and rid the mountains if you must for good transition but leave the east vibes kamenka doesnt need to be touched".
// The east half of today's map is held to prints taken off the tree before the world grew (but for the hillside the
// bunker left, and the trading post's buildings, which went west): every field of the ground's net, and everything
// that stands on it. Then the west: the valley opened onto it, no crease at the seam, the green land, the sea, the
// ridge and its wall, the pass and its shelves, the river valley, the river, the lake and the swamp, the towns and
// Kalat, the roads and their grades, the bunker and the trader where they went, the Zona out to the barrier, the new
// starts; and the ground bodies stand on (Rapier's heightfield of the whole world) where `heightAt` says it is.
// (WEST_PRINT=1 prints the east half's prints instead of holding it to them: run so in a tree from before
// 2026-10-16, with a copy of this file, to take them again.)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import * as WG from '../src/world/worldgen';
import { BUNKER } from '../src/sim/bunker';
import { moundAt } from '../src/sim/towns';
import { generateWorld, heightAt, slopeAt, type World } from '../src/world/worldgen';

const SQ = 769, HALF = 768, CELL = 2;
const W = WG as unknown as Record<string, number> & typeof WG;
const NX = W.WORLD_NX ?? SQ, OX = W.WORLD_X0 === undefined ? 0 : (-HALF - W.WORLD_X0) / CELL, OZ = W.WORLD_Z0 === undefined ? 0 : (-HALF - W.WORLD_Z0) / CELL;
const WAS_B = ((WG as unknown as { BUNKER_WAS?: { x: number; z: number } }).BUNKER_WAS ?? WG.BUNKER_AT) as { x: number; z: number };
const WAS_T = { x: 200, z: -40 }, KEEP = 200;
/** the east half of the square (x 0 to 768), but the ground the bunker left: in the square's own order */
const east = (p: { x: number; z: number }) => p.x > 0 && p.x <= HALF && Math.abs(p.z) <= HALF && Math.hypot(p.x - WAS_B.x, p.z - WAS_B.z) > KEEP;
function half<T extends Float32Array | Uint8Array>(a: T, per = 1): T {
  const out = new (a.constructor as new (n: number) => T)((SQ - 384) * SQ * per);
  for (let iz = 0; iz < SQ; iz++) for (let ix = 385; ix < SQ; ix++) {
    if (!east({ x: -HALF + ix * CELL, z: -HALF + iz * CELL })) continue;
    for (let c = 0; c < per; c++) out[(iz * (SQ - 384) + ix - 384) * per + c] = a[((iz + OZ) * NX + ix + OX) * per + c];
  }
  return out;
}
const print = (v: ArrayBufferView | unknown) => {
  const h = createHash('sha256');
  if (ArrayBuffer.isView(v)) h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  else h.update(JSON.stringify(v));
  return h.digest('hex').slice(0, 16);
};
const roadsEast = (w: World) => [w.road, ...w.roads].map((r) => { const o: number[] = []; for (let i = 0; i < r.points.length; i += 3) if (r.points[i] > 0) o.push(r.points[i], r.points[i + 1], r.points[i + 2]); return o; }).filter((o) => o.length);

const t0 = performance.now();
const world: World = generateWorld();
const made = performance.now() - t0;
const prints = {
  heights: print(half(world.heights)),
  surface: print(half(world.surface)),
  splat: print(half(world.splat, 4)),
  grass: print(half(world.grass)),
  trees: print(world.trees.filter(east)),
  rocks: print(world.rocks.filter(east)),
  props: print(world.props.filter(east)),
  buildings: print(world.buildings.filter((b) => east(b) && Math.hypot(b.x - WAS_T.x, b.z - WAS_T.z) > 80)),
  spawns: print([world.spawns.filter(east), world.spawnRing]),
  roads: print(roadsEast(world)),
  rest: print([world.bridges, world.paths, world.worn, world.wreck, world.walls, world.gatehouse, world.castle, world.pois.filter((p) => east(p) && p.name !== BUNKER.name && p.name !== 'Trading Post'), world.sites.filter((p) => east(p) && p.kind !== 'bunker' && p.kind !== 'market'), world.solids]),
};
if (process.env.WEST_PRINT) {
  console.log(JSON.stringify(prints, null, 1));
  process.exit(0);
}
let checks = 0;
const ok = (what: string) => { checks++; console.log(`  ok  ${what}`); };

// --- the east half of today's map as it was (prints taken 2026-10-16 off f1d0ca0, the last tree with the square alone)
const WAS = {
  heights: '4fd34df70b1161bf', surface: '6465e5e0e9449e2b', splat: '5bfdf1b818379f3a', grass: '88229d83ee6f64b8', trees: 'ef7e372692c689f1', rocks: '8e6656ab18f30a00',
  props: 'a5d0512c8234be5a', buildings: '3f0394645ba713f3', spawns: 'a4dd04bfc4d1ef94', roads: 'a502efb5b853d34f', rest: 'c507af5c93c3db81',
};
for (const [k, v] of Object.entries(WAS)) assert.equal(prints[k as keyof typeof prints], v, `the east's ${k} are not what they were`);
ok(`the east of today's map as it was, to the byte (but within ${KEEP} m of where the bunker was): its ground, paint and grass, ${world.trees.filter(east).length} trees, ${world.rocks.filter(east).length} rocks, ${world.props.filter(east).length} props, ${world.buildings.filter(east).length} buildings, the roads, the fort, Kamenka (made in ${made.toFixed(0)} ms)`);

// --- the world's measures
const { WORLD_X0: X0, WORLD_X1: X1, WORLD_Z0: Z0, WORLD_Z1: Z1, WORLD_NZ: NZ, SEA_LEVEL: SEA, PLAN } = WG;
assert.equal(world.heights.length, NX * NZ);
assert.equal(world.splat.length, NX * NZ * 4);
assert.equal(world.grass.length, NX * NZ);
assert.ok(world.surface.length === NX * NZ, 'the surface is on the world\'s net');
assert.deepEqual([X0, X1, Z0, Z1, NX, NZ], [-3840, 768, -768, 768, 2305, 769]);
for (const t of [...world.trees, ...world.rocks, ...world.props, ...world.buildings]) assert.ok(WG.onWorld(t.x, t.z), `something stands off the world at ${t.x}, ${t.z}`);
ok('the world is 4608 m by 1536 m, x -3840 to 768 and z -768 to 768, on one net of 2305 by 769 samples');

const H = world.heights, at = (ix: number, iz: number) => H[iz * NX + ix];

// --- the west of today's map opened: no wall of hills between the valley and the green land along the main road
{
  let top = -Infinity;
  // (between the valley's own rim and the seam, about the main road and the pass: the rim's hills north of it and the
  // works' hill south of it are kept)
  for (let x = -760; x <= -470; x += 4) for (let z = -280; z <= 60; z += 4) top = Math.max(top, heightAt(H, x, z));
  assert.ok(top < 45, `the old rim still stands ${top.toFixed(0)} m high west of the valley`);
  const main = world.roads.reduce((a, b) => (b.points.length > a.points.length ? b : a)).points;
  let hi = -Infinity;
  for (let i = 0; i < main.length; i += 3) hi = Math.max(hi, main[i + 1]);
  assert.ok(hi < 40, `the main road climbs to ${hi.toFixed(0)} m`);
  const loop = world.roads.find((r) => r.points.length / 3 === 453)!.points;
  let lg = 0;
  for (let i = 3; i < loop.length; i += 3) if (loop[i] < -380) lg = Math.max(lg, Math.abs(loop[i + 1] - loop[i - 2]) / Math.hypot(loop[i] - loop[i - 3], loop[i + 2] - loop[i - 1]));
  assert.ok(lg <= 0.13, `the loop is ${lg.toFixed(3)} steep where it was laid again`);
  ok(`today's west opened: west of the valley along the main road nothing stands over ${top.toFixed(0)} m (the rim was 75-160), the main road never over ${hi.toFixed(0)} m, the loop laid again no steeper than ${(lg * 100).toFixed(1)}%`);
}

// --- the seam: the square's last column and the first of the new ground
{
  let crease = 0, inner = 0;
  for (let iz = 0; iz < NZ; iz++) {
    const a = at(OX - 2, iz), b = at(OX - 1, iz), c = at(OX, iz), d = at(OX + 1, iz), e = at(OX + 2, iz);
    crease = Math.max(crease, Math.abs(b - 2 * c + d));
    inner = Math.max(inner, Math.abs(c - 2 * d + e), Math.abs(a - 2 * b + c));
  }
  assert.ok(crease <= Math.max(0.6, inner * 1.25), `a crease at the seam: ${crease.toFixed(2)} m against ${inner.toFixed(2)} either side of it`);
  ok(`no crease at the seam: its bend ${crease.toFixed(2)} m where the ground either side bends ${inner.toFixed(2)}`);
}

// --- the green land, the sea
const RL = await import('../src/world/worldgen/west-relief');
const ridge = (z: number) => RL.ridgeAt(z);
{
  const slopes: number[] = [];
  let lo = Infinity, hi = -Infinity;
  // (the plains between the valley and the swamp, east of the ridge's foot: the valley's walls, the lake and the towns' pads are their own)
  for (let x = -2000; x <= -900; x += 8) for (let z = -180; z <= 380; z += 8) {
    if (WG.inside(PLAN.lake.outline, x, z) || x < ridge(z)[2] + 40) continue;
    const h = heightAt(H, x, z);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
    slopes.push(slopeAt(H, x, z));
  }
  slopes.sort((a, b) => a - b);
  const most = slopes[Math.floor(slopes.length * 0.98)];
  assert.ok(lo >= SEA + 5 && hi <= SEA + 90, `the green land runs ${(lo - SEA).toFixed(1)} to ${(hi - SEA).toFixed(1)} m over the sea`);
  assert.ok(most < 0.6, `the green land is not gentle: 2% of it steeper than ${most.toFixed(2)}`);
  ok(`green rolling land: ${(lo - SEA).toFixed(0)} to ${(hi - SEA).toFixed(0)} m over the sea, 98% of it under ${(Math.atan(most) * 57.3).toFixed(0)} degrees`);
  let shoreW = Infinity, shoreE = -Infinity, shallowest = -Infinity, beachSteep = 0;
  const mouth = world.water!.rivers[0].pts.filter(([x]) => x < -3500);
  for (let iz = 0; iz < NZ; iz++) {
    // (but where the river runs into the sea: its bed is under the sea's level a little way inland)
    if (mouth.some(([, z]) => Math.abs(z - (Z0 + iz * CELL)) < 30)) continue;
    let last = X0;
    for (let ix = 0; ix < 200; ix++) if (at(ix, iz) < SEA) last = X0 + ix * CELL;
    shoreW = Math.min(shoreW, last);
    shoreE = Math.max(shoreE, last);
    shallowest = Math.max(shallowest, at(0, iz));
    for (let x = last - 30; x <= last + 50; x += 4) beachSteep = Math.max(beachSteep, slopeAt(H, x, Z0 + iz * CELL));
  }
  assert.ok(shoreW >= -3765 && shoreE <= -3665 && shallowest < SEA - 6 && beachSteep < 0.1, `the shore from ${shoreW} to ${shoreE}, ${(SEA - shallowest).toFixed(1)} m deep at the edge, the beach ${beachSteep.toFixed(2)} steep`);
  assert.ok(PLAN.barrier > shoreE + 10, 'the barrier is not on the beach');
  ok(`a thin sea in the west: the shore between x ${shoreW} and ${shoreE} (${shoreW - X0} to ${shoreE - X0} m of water), the beach never steeper than ${(Math.atan(beachSteep) * 57.3).toFixed(1)} degrees; the barrier at x ${PLAN.barrier}`);
}

// --- THE RIDGE: the whole height of the map, sheer, over a hundred metres over both sides, walled but at the pass
{
  let low = Infinity, lowAt = 0, steepest = 0, faces = 0, samples = 0;
  for (let z = Z0 + 20; z <= Z1 - 20; z += 16) {
    const [w, c, e] = ridge(z);
    if (Math.abs(z - -440) < 90) continue;
    const top = Math.max(heightAt(H, c, z), heightAt(H, c - 6, z), heightAt(H, c + 6, z));
    // (over the open land either side: by the world's north and south edges the rims of the old map are carried on)
    // (the land beside it: the desert's own past the buttes before the ridge, and the green land)
    if (Math.abs(z) < 580) { const v = top - Math.max(Math.min(heightAt(H, w - 150, z), heightAt(H, w - 320, z)), heightAt(H, e + 60, z)); if (v < low) { low = v; lowAt = z; } }
    for (let x = w; x <= e; x += 4) { const s = slopeAt(H, x, z); samples++; if (s > 1) faces++; steepest = Math.max(steepest, s); }
  }
  // (over a hundred metres along most of it; its lowest saddles less)
  assert.ok(low > 70, `the ridge stands only ${low.toFixed(0)} m over the land beside it at z ${lowAt}`);
  assert.ok(faces / samples > 0.25 && steepest > 2, `the ridge's faces: ${((faces / samples) * 100).toFixed(0)}% over 45 degrees, the steepest ${(Math.atan(steepest) * 57.3).toFixed(0)}`);
  const wall = WG.ridgeWall(Z0, Z1), k = wall.findIndex((s, i) => wall[i + 1] && wall[i + 1][1] !== s[3]);
  assert.ok(k >= 0 && wall.slice(k + 1).every((s, i) => i === 0 || s[1] === wall[k + i][3]), 'the ridge\'s wall has more than one gap, or none');
  const gz0 = wall[k][3], gz1 = wall[k + 1][1];
  assert.ok(gz0 < -440 && gz1 > -440 && gz1 - gz0 < 140, `the wall's gap is from z ${gz0} to ${gz1}`);
  assert.ok(WG.onRidgeWall(ridge(200)[1], 200) && !WG.onRidgeWall(ridge(-440)[1], -440), 'the server holds the wrong part of the crest');
  ok(`the ridge the whole height of the map, at least ${low.toFixed(0)} m over the land beside it, ${((faces / samples) * 100).toFixed(0)}% of its faces over 45 degrees (the steepest ${(Math.atan(steepest) * 57.3).toFixed(0)}); walled along its crest but from z ${gz0} to ${gz1}, where the pass goes through`);
}

// --- THE PASS: the one way through, its floor, its shelves on both walls, ramps between them
{
  const L = RL.passLine, floors: number[] = [];
  let walls = 0, shelved = 0;
  // (where the ridge stands over it: by its west mouth the ridge itself is low, a few metres from its foot)
  for (let a = 60; a <= L.total - 160; a += 20) {
    const p = L.at(a), y = RL.passFloor(a);
    // (on its dry side: the river runs 8 m off its middle toward the south wall)
    floors.push(heightAt(H, p.x - p.tz * 10 * Math.sign(PLAN.pass.river.side), p.z + p.tx * 10 * Math.sign(PLAN.pass.river.side)) - y);
    // (each wall's shelves, where no ramp is: across the wall, a level run of three metres at about each one's height)
    for (const side of [1, -1]) {
      if (PLAN.pass.ramps.some((r) => r.side === side && a > r.along[0] - 8 && a < r.along[1] + 8)) continue;
      walls++;
      const across: number[] = [];
      for (let d = RL.passHalf(a, side); d < 90; d += 1) across.push(heightAt(H, p.x + p.tz * d * side, p.z - p.tx * d * side) - y);
      const has = (h: number) => across.some((_, k) => k + 3 < across.length && [0, 1, 2, 3].every((j) => Math.abs(across[k + j] - h) < 3));
      if (PLAN.pass.shelves.every(([h]) => has(h))) shelved++;
    }
  }
  assert.ok(floors.every((d) => Math.abs(d) < 0.6), `the pass's floor is off its height: ${floors.map((d) => d.toFixed(1)).join(', ')}`);
  assert.ok(shelved / walls > 0.75, `only ${shelved} of ${walls} stretches of the pass's walls have all three shelves`);
  const worst = shelved / walls;
  const p = L.at(L.total / 2), mid = heightAt(H, p.x, p.z), top = heightAt(H, p.x + p.tz * 90, p.z - p.tx * 90);
  assert.ok(top - mid > 60, `the pass's walls at its middle stand ${(top - mid).toFixed(0)} m`);
  ok(`the pass ${L.total.toFixed(0)} m through the ridge, its floor ${RL.passFloor(0).toFixed(1)} to ${RL.passFloor(L.total).toFixed(1)} m, its walls ${(top - mid).toFixed(0)} m at its middle, three shelves up each (about ${PLAN.pass.shelves.map((s) => s[0]).join(', ')} m over the floor, all three on ${(worst * 100).toFixed(0)}% of its walls), ${PLAN.pass.ramps.length} ramps between them`);
}

// --- THE PASS'S CAVES (the coast kit's plan, src/sim/pass.ts) under the ground as it is: two metres of rock over every
// gallery's roof, measured as the plan measures it (galleries' `cover`), but on the real ground; within four metres
// of a mouth it is the face the mouth is in
{
  const { CAVES, passWorld } = await import('../src/sim/pass');
  const P = WG.passPlan;
  let least = Infinity, at = '';
  CAVES.forEach((c, ci) => {
    for (let k = 0; k + 1 < c.nodes.length; k++) {
      const n0 = c.nodes[k], n1 = c.nodes[k + 1], run = Math.hypot(n1.s - n0.s, n1.t - n0.t), side = (n1.s - n0.s) / run;
      for (let i = 0; i <= 16; i++) {
        const q = i / 16, s0 = n0.s + (n1.s - n0.s) * q, t = n0.t + (n1.t - n0.t) * q, y = n0.y + (n1.y - n0.y) * q, w = n0.w + (n1.w - n0.w) * q, h = n0.h + (n1.h - n0.h) * q;
        if ((k === 0 && c.mouths.includes('first') && q * run < 4) || (k + 2 === c.nodes.length && c.mouths.includes('last') && (1 - q) * run < 4)) continue;
        for (const across of [-1, 0, 1]) {
          const [x, gy, z] = passWorld(P, s0, t + across * side * (w / 2 + 1), 0), cover = heightAt(H, x, z) - gy - y - h;
          if (cover < least) { least = cover; at = `cave ${ci} (${c.name}) at ${x.toFixed(0)}, ${z.toFixed(0)}`; }
        }
      }
    }
  });
  assert.ok(least >= 2, `only ${least.toFixed(1)} m of rock over ${at}`);
  ok(`the pass's caves under the ground as it is: at least ${least.toFixed(1)} m of rock over every gallery away from its mouths`);
}

// --- THE GREEN RIVER VALLEY, THE RIVER, THE LAKE, THE SWAMP
{
  const V = RL.valleyLine, fl: number[] = [];
  for (let t = 0.15; t <= 0.96; t += 0.2) { const p = V.at(t * V.total); fl.push(heightAt(H, p.x, p.z)); }
  assert.ok(fl.every((y, k) => k === 0 || y < fl[k - 1] + 0.8), `the valley's floor does not fall west: ${fl.map((y) => y.toFixed(1)).join(', ')}`);
  const water = world.water!, river = water.rivers[0].pts;
  let up = 0, dry = 0;
  for (let k = 1; k < river.length; k++) if (river[k][2] > river[k - 1][2] + 1e-6) up++;
  for (const [x, z, y] of river) if (heightAt(H, x, z) > y - 0.05) dry++;
  const [lx, , ly] = river[river.length - 1];
  assert.ok(up === 0 && dry === 0 && lx < -3715 && ly <= SEA + 0.01, `the river: ${up} points uphill, ${dry} with no water over the ground, ends at ${lx.toFixed(0)} (${ly.toFixed(1)})`);
  const [lake, swamp] = water.lakes;
  let deepest = 0;
  for (let x = -1370; x <= -1130; x += 6) for (let z = -282; z <= -130; z += 6) if (WG.inside(lake.outline, x, z)) deepest = Math.max(deepest, lake.level - heightAt(H, x, z));
  let wet = 0, cells = 0, pools = 0;
  for (let x = -2040; x <= -1650; x += 6) for (let z = 430; z <= 740; z += 6) if (WG.inside(swamp.outline, x, z)) { cells++; const d = swamp.level - heightAt(H, x, z); if (d > 0) wet++; if (d > 0.9) pools++; }
  assert.ok(deepest > 2 && deepest < 4.5 && wet / cells > 0.6 && pools / cells < 0.12 && swamp.swamp, `the lake ${deepest.toFixed(1)} m deep, the swamp ${((wet / cells) * 100).toFixed(0)}% under water, ${((pools / cells) * 100).toFixed(0)}% pools`);
  ok(`the valley's floor falling west (${fl.map((y) => y.toFixed(0)).join(', ')} m); the river ${river.length} points, never uphill, always water over its bed, into the sea; Ozerki's lake ${deepest.toFixed(1)} m at its deepest; the swamp ${((wet / cells) * 100).toFixed(0)}% under its water, ${((pools / cells) * 100).toFixed(0)}% deep pools`);
}

// --- THE TOWNS and KALAT
{
  const towns = world.towns!;
  assert.deepEqual(towns.map((t) => t.town.name), ['Pokrov', 'Lipki', 'Zavod', 'Ozerki', 'Mokroye']);
  for (const { town, padY } of towns) {
    const ids = world.buildings.filter((b) => b.id.startsWith(`${town.name.toLowerCase()}_`));
    assert.ok(ids.length > 0, `${town.name} has no buildings`);
    const c = Math.cos(town.rot), s = Math.sin(town.rot);
    const on = [...world.trees, ...world.rocks].filter((t) => { const dx = t.x - town.x, dz = t.z - town.z; return Math.abs(dx * c - dz * s) < town.pad[0] && Math.abs(dx * s + dz * c) < town.pad[1]; });
    assert.equal(on.length, 0, `${on.length} trees or rocks on ${town.name}'s pad`);
    // (but in a hollow: Mokroye's barn stands sunk to the waist, as it was drawn up)
    for (const b of ids) {
      const dx = b.x - town.x, dz = b.z - town.z;
      assert.ok(b.floorY >= padY + Math.min(0, moundAt(town, dx * c - dz * s, dx * s + dz * c)) - 0.5, `${b.id} sunk under its town's pad`);
    }
  }
  const K = world.kalat!, top = heightAt(H, K.x, K.z);
  assert.ok(Math.abs(top - K.y) < 6, `Kalat's top ${top.toFixed(1)} against its place's ${K.y}`);
  assert.equal(world.pois.filter((p) => p.name === 'Kalat').length, 1);
  assert.ok(world.props.filter((p) => Math.hypot(p.x - K.x, p.z - K.z) < 300).length > 20, 'nothing lies about Kalat');
  ok(`the towns set down: ${towns.map((t) => `${t.town.name} ${world.buildings.filter((b) => b.id.startsWith(`${t.town.name.toLowerCase()}_`)).length}`).join(', ')} buildings, nothing growing on their pads; Kalat at ${K.x}, ${K.z}, its top ${top.toFixed(1)} m`);
}

// --- the roads
{
  const fresh = world.roads.slice(-4), river = world.water!.rivers[0].pts;
  for (const r of fresh) {
    const p = r.points;
    let steep = 0;
    for (let i = 3; i < p.length; i += 3) {
      // (but where a road goes down into the river's ford)
      if (river.some(([x, z]) => Math.hypot(x - p[i], z - p[i + 2]) < 16)) continue;
      steep = Math.max(steep, Math.abs(p[i + 1] - p[i - 2]) / Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]));
    }
    assert.ok(steep <= PLAN.road.steep + 0.02, `a new road ${steep.toFixed(3)} steep`);
    for (let i = 0; i < p.length; i += 3 * 5) assert.ok(Math.abs(heightAt(H, p[i], p[i + 2]) - p[i + 1]) < 0.4, `a new road ${Math.abs(heightAt(H, p[i], p[i + 2]) - p[i + 1]).toFixed(2)} m off its bed at ${p[i].toFixed(0)}, ${p[i + 2].toFixed(0)}`);
  }
  const main = fresh[0].points, near = (p: Float32Array, x: number, z: number) => { let d = Infinity; for (let i = 0; i < p.length; i += 3) d = Math.min(d, Math.hypot(p[i] - x, p[i + 2] - z)); return d; };
  const mid = RL.passLine.at(RL.passLine.total / 2);
  assert.ok(near(main, -3640, 25) < 3 && near(main, mid.x, mid.z) < PLAN.pass.floor, 'the main road misses the beach or the pass');
  ok(`four new roads (the main one ${((main.length / 3) * 4 / 1000).toFixed(1)} km through Ozerki, the pass and past Zavod to the beach, to the bunker, Lipki, Kalat): none steeper than ${PLAN.road.steep * 100}% but into a ford, each on its bed`);
}

// --- the bunker and the trading post where they went
{
  const b = WG.bunkerPlace(world)!;
  assert.ok(Math.hypot(b.x - WG.BUNKER_AT.x, b.z - WG.BUNKER_AT.z) < 0.01, 'the bunker is not where it went');
  assert.ok(world.sites.filter((s) => s.kind === 'bunker').length === 1 && world.pois.find((p) => p.name === BUNKER.name)!.x === WG.BUNKER_AT.x, 'the bunker\'s place and name are not with it');
  assert.ok(Math.hypot(b.x - world.castle!.x, b.z - world.castle!.z) > 1500, 'the bunker is near the fort');
  const pitH = heightAt(world.heights, b.x, b.z), roofH = heightAt(world.surface, b.x, b.z);
  assert.ok(roofH - pitH > BUNKER.depth - 0.5, `the bunker's pit is ${(roofH - pitH).toFixed(1)} m under its roof`);
  const wasPit = heightAt(world.heights, WAS_B.x, WAS_B.z), wasRoof = heightAt(world.surface, WAS_B.x, WAS_B.z);
  assert.ok(Math.abs(wasRoof - wasPit) < 0.01 && world.trees.filter((t) => Math.hypot(t.x - WAS_B.x, t.z - WAS_B.z) < 60).length > 10, 'the old bunker\'s hillside is not given back');
  const post = world.sites.find((s) => s.kind === 'market')!, theirs = world.buildings.filter((q) => Math.hypot(q.x - post.x, q.z - post.z) < 60);
  assert.ok(Math.abs(post.x - WG.TRADE_AT.x) < 1 && theirs.length >= 3 && world.buildings.every((q) => Math.hypot(q.x - WAS_T.x, q.z - WAS_T.z) > 40), `the trading post: ${theirs.length} buildings by it`);
  ok(`the bunker on the valley's rim at ${b.x}, ${b.z} (${Math.hypot(b.x - world.castle!.x, b.z - world.castle!.z).toFixed(0)} m from the fort), its pit ${(roofH - pitH).toFixed(1)} m under its roof; its old hillside given back; the trading post's ${theirs.length} buildings by the main road`);
}

// --- the Zona, the starts
{
  let out = 0;
  for (let x = -3600; x <= -700; x += 40) for (let z = -740; z <= 740; z += 40) if (!WG.inPlay(x, z)) out++;
  assert.equal(out, 0, `${out} spots of the new land outside the Zona`);
  assert.ok(!WG.inPlay(PLAN.barrier - 30, 0), 'the Zona reaches past the barrier');
  const west = world.spawns.filter((s) => s.x < -2000);
  assert.equal(west.length, PLAN.starts.z.length);
  assert.ok(west.every((s) => s.x < ridge(s.z)[0] - 60 && heightAt(H, s.x, s.z) > SEA + 1), 'a start on the ridge or in the sea');
  ok(`the Zona over all the new land out to the barrier; ${west.length} new starts in the desert along x ${PLAN.starts.x}, the square's own as they were`);
}

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
