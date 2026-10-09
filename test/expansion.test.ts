// The map's first expansion (EXPANSION in src/world/worldgen.ts): that the map as it was is
// still exactly there, and that what was added can be walked into and stands up.
// `npx tsx test/expansion.test.ts`.

import assert from 'node:assert/strict';
import { CELL, EXPANSION as E, PLAY_AREAS, PLAY_RADIUS, WORLD_RES, WORLD_SIZE, generateWorld, heightAt, inPlay, playOutline, slopeAt, BUILDING_FOOTPRINT } from '../src/world/worldgen';
import { buildWorldData } from '../server/world';
import { GAS, gasDepth, gasZone } from '../src/sim/gas';
import { INFECTED, openGround } from '../src/sim/infected';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

/**
 * The map before the expansion, as numbers taken off it the day before it was added (commit
 * f136435): the ground, the buildings, the starts, the trees, the loot points and the jeeps.
 */
const WAS = { cells: 241540, heights: 3950402189, buildings: 72, buildingsHash: 2448790248, lastId: 'tower_71', spawns: 2697513077, trees: 11693, treesHash: 2254000829, lootPoints: 675, lootHash: 545356472, jeeps: 8, jeepsHash: 380833839, fires: 6 };
const hash = (parts: number[]) => {
  let h = 2166136261 >>> 0;
  for (const v of parts) {
    const q = Math.round(v * 1000) | 0;
    h = Math.imul(h ^ (q & 0xffff), 16777619) >>> 0;
    h = Math.imul(h ^ (q >>> 16), 16777619) >>> 0;
  }
  return h >>> 0;
};

const world = generateWorld();
const data = buildWorldData(process.cwd());
const half = WORLD_SIZE / 2;
const camp = world.pois.find((p) => p.name === 'Military Checkpoint')!;
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
/** the only ground the expansion may have touched: the cirque itself, and a strip along the track up to it from the checkpoint */
const touched = (x: number, z: number) => {
  if (Math.hypot(x - E.x, z - E.z) < 160) return true;
  const dx = E.x - camp.x, dz = E.z - camp.z, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - camp.x) * dx + (z - camp.z) * dz) / l2));
  return Math.hypot(x - (camp.x + dx * t), z - (camp.z + dz * t)) < 34 && Math.hypot(x - camp.x, z - camp.z) > 16;
};
const inl = Math.hypot(camp.x - E.x, camp.z - E.z);
const ux = (camp.x - E.x) / inl, uz = (camp.z - E.z) / inl;
const works = world.sites.find((s) => s.kind === 'works')!;
const added = world.buildings.slice(WAS.buildings);

ok('the map as it was is still exactly there: its ground, its buildings, its starts, its trees, its loot points, its jeeps', () => {
  const hs: number[] = [];
  for (let iz = 0; iz < WORLD_RES; iz++) for (let ix = 0; ix < WORLD_RES; ix++) if (!touched(-half + ix * CELL, -half + iz * CELL)) hs.push(world.heights[iz * WORLD_RES + ix]);
  assert.equal(hs.length, WAS.cells);
  assert.equal(hash(hs), WAS.heights, 'the old ground has moved');
  const old = world.buildings.slice(0, WAS.buildings);
  assert.equal(old[old.length - 1].id, WAS.lastId);
  assert.equal(hash(old.flatMap((b) => [b.x, b.z, b.rot, b.floorY])), WAS.buildingsHash, 'an old building has moved');
  assert.equal(hash(world.spawns.flatMap((s) => [s.x, s.z, s.yaw])), WAS.spawns, 'a starting point has moved');
  const trees = world.trees.filter((t) => !touched(t.x, t.z));
  assert.equal(trees.length, WAS.trees);
  assert.equal(hash(trees.flatMap((t) => [t.x, t.y, t.z])), WAS.treesHash, 'a tree away from the works has moved');
  // (what is kept between restarts goes by a loot point's number: the old ones are the first, in their old order)
  const points = data.lootPoints.slice(0, WAS.lootPoints);
  assert.equal(hash(points.flatMap((p) => [p.x, p.y, p.z])), WAS.lootHash, 'an old loot point has moved or been renumbered');
  assert.equal(data.jeeps.length, WAS.jeeps);
  assert.equal(hash(data.jeeps.flatMap((j: { x: number; z: number }) => [j.x, j.z])), WAS.jeepsHash);
  assert.equal(data.fires.length, WAS.fires);
});

ok('it lies outside the ring the map used to end at, inside the ground there is, and the two are one place to play in', () => {
  assert.ok(Math.hypot(E.x, E.z) - E.floor > PLAY_RADIUS, 'its floor reaches into the old map');
  const R = E.floor + E.wall;
  assert.ok(Math.abs(E.x) + R < half && Math.abs(E.z) + R < half, 'it runs off the edge of the ground');
  assert.equal(PLAY_AREAS.length, 2);
  assert.ok(inPlay(0, 0) && inPlay(E.x, E.z) && inPlay(camp.x, camp.z));
  assert.ok(!inPlay(-E.x, -E.z), 'the far corner of the map is not played in');
  // one line round the two: each round's arc starts where the other's ends
  const [a, b] = playOutline();
  const at = (o: typeof a, t: number) => [o.x + Math.cos(t) * o.r, o.z + Math.sin(t) * o.r];
  for (const [p, q] of [[at(a, a.to), at(b, b.from)], [at(b, b.to), at(a, a.from)]]) assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01, 'the line round the map does not meet itself');
  assert.ok(a.to - a.from > Math.PI * 1.8 && b.to - b.from > Math.PI);
});

ok('its floor is level, with a wall round it on every side but the way in', () => {
  const y = ground(E.x, E.z);
  for (let a = 0; a < Math.PI * 2; a += 0.2) for (const d of [10, 30, 50, 66]) assert.ok(Math.abs(ground(E.x + Math.cos(a) * d, E.z + Math.sin(a) * d) - y) < 1.2, `the floor is not level ${d} m out`);
  for (let a = 0; a < Math.PI * 2; a += 0.1) {
    const cos = Math.cos(a) * ux + Math.sin(a) * uz;
    const rim = ground(E.x + Math.cos(a) * (E.floor + E.wall - 6), E.z + Math.sin(a) * (E.floor + E.wall - 6));
    // (away from the way in, the hillside stands well over the floor; toward it, there is none to speak of)
    if (cos < 0.3) assert.ok(rim > y + 22, `no wall on the side at ${a.toFixed(1)} rad: ${(rim - y).toFixed(0)} m`);
    if (cos > 0.93) assert.ok(rim < y + 6, 'the way in is walled up');
  }
});

ok('it can be walked into from the checkpoint: nothing on the way steeper than a hillside path', () => {
  // along the middle of the way in, a pace at a time: the rise over any ten metres
  let worst = 0;
  for (let d = inl - 34; d > 20; d -= 2) {
    const rise = Math.abs(ground(E.x + ux * d, E.z + uz * d) - ground(E.x + ux * (d - 10), E.z + uz * (d - 10))) / 10;
    worst = Math.max(worst, rise);
  }
  assert.ok(worst < 0.5, `a rise of ${(worst * 100).toFixed(0)}% on the way in`);
  // and no tree, rock or wall stands in the middle of it
  for (let d = inl - 40; d > 14; d -= 3) {
    const x = E.x + ux * d, z = E.z + uz * d;
    assert.ok(!world.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < Math.hypot(...BUILDING_FOOTPRINT[b.type]) / 2), 'a building stands in the way in');
  }
});

ok('the works is built: an office, workshops, stores, a sick bay, a tower, a gate, a chimney and tanks, all on the floor and none in another', () => {
  assert.ok(works && works.later, 'no works');
  assert.ok(added.length >= 10, `only ${added.length} buildings`);
  for (const type of ['barracks', 'garage', 'barn', 'clinic', 'tower', 'guardpost']) assert.ok(added.some((b) => b.type === type), `no ${type}`);
  assert.equal(added.filter((b) => b.type === 'guardpost').length, 2, 'the gate wants a post either side');
  for (const b of added) {
    assert.ok(Math.hypot(b.x - E.x, b.z - E.z) < E.floor - 8, `${b.id} is off the floor`);
    assert.ok(Math.abs(b.floorY - ground(E.x, E.z)) < 1.5, `${b.id} stands at the wrong height`);
    for (const o of added) if (o !== b) assert.ok(Math.hypot(o.x - b.x, o.z - b.z) > 6, `${b.id} and ${o.id} are in one another`);
  }
  assert.equal(world.solids.filter((s) => s.kind === 'stack').length, 1);
  assert.ok(world.solids.filter((s) => s.kind === 'tank').length >= 3);
  for (const s of world.solids) {
    assert.ok(Math.hypot(s.x - E.x, s.z - E.z) + s.r < E.floor, `a ${s.kind} is off the floor`);
    assert.ok(Math.abs(s.y - ground(s.x, s.z)) < 0.05);
    for (const b of added) assert.ok(Math.hypot(b.x - s.x, b.z - s.z) > s.r + Math.min(...BUILDING_FOOTPRINT[b.type]) / 2, `a ${s.kind} stands in ${b.id}`);
    assert.equal(openGround(world, s.x, s.z), false, 'the middle of it is counted as open ground');
  }
  // the chimney stands over the gas, to be seen from the valley
  const stack = world.solids.find((s) => s.kind === 'stack')!;
  assert.ok(stack.h > GAS.height + 6);
  // nothing grows on the floor, and nothing is left on a face too steep to stand on
  assert.equal(world.trees.filter((t) => Math.hypot(t.x - E.x, t.z - E.z) < E.floor - 16).length, 0);
  for (const t of world.trees) if (Math.hypot(t.x - E.x, t.z - E.z) < E.floor + E.wall) assert.ok(slopeAt(world.heights, t.x, t.z) <= 1.06, 'a tree on a cliff');
});

ok('the gas lies over the works and nowhere else, and the checkpoint is clean air again', () => {
  const gas = gasZone(world.pois, ground)!;
  assert.equal(gas.x, E.x);
  assert.equal(gas.z, E.z);
  assert.equal(gasDepth(gas, camp.x, ground(camp.x, camp.z) + 1.6, camp.z), 0);
  for (const b of added) assert.ok(gasDepth(gas, b.x, b.floorY + 1.6, b.z) > GAS.breathe * 2, `${b.id} is in clean air`);
  for (const b of world.buildings.slice(0, WAS.buildings)) assert.equal(gasDepth(gas, b.x, b.floorY + 1.6, b.z), 0, `${b.id}, of the old map, is in the gas`);
  // it does not reach down the way in as far as the dip: nobody walking the valley floor wanders into it
  assert.equal(gasDepth(gas, E.x + ux * (gas.r + 4), ground(E.x + ux * (gas.r + 4), E.z + uz * (gas.r + 4)) + 1.6, E.z + uz * (gas.r + 4)), 0);
  const under = data.lootPoints.filter((p) => p.usage.includes('Gas'));
  assert.ok(under.length >= 40, `only ${under.length} places to find anything in the works`);
  for (const p of under) assert.ok(added.some((b) => b.id === p.building), 'something marked as under the gas is not in the works');
});

ok('the infected keep to it too, and nowhere else has fewer for it', () => {
  const homes = data.homes as { x: number; z: number; n: number }[];
  const here = homes.find((h) => Math.hypot(h.x - E.x, h.z - E.z) < 1);
  assert.ok(here && here.n >= 4, 'none at the works');
  assert.equal(homes.reduce((s, h) => s + h.n, 0), INFECTED.max);
  // (the valley held thirty-three before there was a works)
  assert.equal(INFECTED.max - here!.n, 33);
});

console.log(`\n${n} checks passed`);
