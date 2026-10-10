// The map's first expansion (EXPANSION in src/world/worldgen.ts): that the map as it was is
// still exactly there, and that what was added can be walked into and stands up.
// `npx tsx test/expansion.test.ts`.

import assert from 'node:assert/strict';
import { BUNKER_AT, CELL, KAMENKA, NO_START, OUTLYING, TOWN, TRADE_AT, kamenkaQ, EXPANSION as E, PLAY_AREAS, PLAY_RADIUS, WORLD_RES, WORLD_SIZE, generateWorld, heightAt, inPlay, playOutline, slopeAt, BUILDING_FOOTPRINT } from '../src/world/worldgen';
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
// (The loot points were counted again on 2026-10-10: the same points in the same order, those that are on
// a bed a hand's width higher, on the mattress each bed was given. It was 545356472.)
// (And on 2026-10-10 again, 1223262982 before it: the same places in the same order, those on a water
// barrel 3 cm lower, on its lid and not at the height of its rim.)
// (And the ground and the trees once more on 2026-10-10, with the trading post's meadow left out as well:
// counted on the map BEFORE the post was built (234302 cells, 1986740555; 11269 trees, 3538601034 with it in),
// and the same four figures came off the map after.)
// (The ground and the trees were counted again on 2026-10-09, from the same map, with the
// bunker's hollow left out of the count as the works' is: taken before the bunker was dug.)
const WAS = { cells: 217934, heights: 4113734791, buildings: 72, buildingsHash: 2448790248, lastId: 'tower_71', spawns: 2697513077, trees: 10647, treesHash: 778129303, lootPoints: 675, lootHash: 113905251, jeeps: 8, jeepsHash: 380833839, fires: 6 };
const hash = (parts: number[]) => {
  let h = 2166136261 >>> 0;
  for (const v of parts) {
    const q = Math.round(v * 1000) | 0;
    h = Math.imul(h ^ (q & 0xffff), 16777619) >>> 0;
    h = Math.imul(h ^ (q >>> 16), 16777619) >>> 0;
  }
  return h >>> 0;
};

/** where the long hut behind the depot was put (2026-10-10): fenced off before it was built, as the others were */
const HUT_AT = { x: 160.1, z: 163.1 };

/** where a brick block, a plank house and a long hut were stood behind the village street: fenced off before they were built */
const IN_VILLAGE = [{ type: 'townhouse', x: 44, z: -28 }, { type: 'shanty', x: 14, z: 50 }, { type: 'hut', x: 46, z: 50 }];

const world = generateWorld();
/** the map as it was first made: 513 samples a side, 1024 m, in the middle of whatever the grid is now */
const OLD_RES = 513, OLD_HALF = 512, OFF = (WORLD_RES - OLD_RES) / 2;
const oldGround = (keep: (x: number, z: number) => boolean) => {
  const hs: number[] = [];
  for (let iz = 0; iz < OLD_RES; iz++) for (let ix = 0; ix < OLD_RES; ix++) if (keep(-OLD_HALF + ix * CELL, -OLD_HALF + iz * CELL)) hs.push(world.heights[(iz + OFF) * WORLD_RES + ix + OFF]);
  return hs;
};
const inOld = (x: number, z: number) => Math.abs(x) <= OLD_HALF && Math.abs(z) <= OLD_HALF;
const data = buildWorldData(process.cwd());
const half = WORLD_SIZE / 2;
const camp = world.pois.find((p) => p.name === 'Military Checkpoint')!;
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
/** the only ground the expansion may have touched: the cirque itself, and a strip along the track up to it from the checkpoint */
const touched = (x: number, z: number) => {
  if (Math.hypot(x - E.x, z - E.z) < 160) return true;
  // (and the meadow the trading post was built in, later: 78 m round it)
  if (Math.hypot(x - TRADE_AT.x, z - TRADE_AT.z) < 78) return true;
  // (and where the long hut stands behind the depot's barracks: 24 m round it)
  if (Math.hypot(x - HUT_AT.x, z - HUT_AT.z) < 24) return true;
  // (and where one of each of the downloaded buildings was stood in the village, 2026-10-10: 24 m round each)
  if (IN_VILLAGE.some((q) => Math.hypot(x - q.x, z - q.z) < 24)) return true;
  // (and Kamenka's valley, 2026-10-10: its rim stands on the old map's ground west and north of the town)
  if (kamenkaQ(x, z) < KAMENKA.foot + 0.1) return true;
  // (and the bunker's hollow, on the far side of the map)
  if (Math.hypot(x - BUNKER_AT.x, z - BUNKER_AT.z) < 96) return true;
  const dx = E.x - camp.x, dz = E.z - camp.z, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - camp.x) * dx + (z - camp.z) * dz) / l2));
  return Math.hypot(x - (camp.x + dx * t), z - (camp.z + dz * t)) < 34 && Math.hypot(x - camp.x, z - camp.z) > 16;
};
const inl = Math.hypot(camp.x - E.x, camp.z - E.z);
const ux = (camp.x - E.x) / inl, uz = (camp.z - E.z) / inl;
const works = world.sites.find((s) => s.kind === 'works')!;
// (what was built with the works: not the trading post's two, which came later and stand in the old map's meadow)
const added = world.buildings.slice(WAS.buildings).filter((b) => !['hut', 'townhouse', 'shanty'].includes(b.type) && Math.hypot(b.x - TRADE_AT.x, b.z - TRADE_AT.z) > 78 && inOld(b.x, b.z));

// To take the old map's figures again after fencing off more ground (do it BEFORE building there): FIGURES=1 npx tsx test/expansion.test.ts
if (process.env.FIGURES) {
  const hs = oldGround((x, z) => !touched(x, z));
  const trees = world.trees.filter((t) => inOld(t.x, t.z) && !touched(t.x, t.z));
  console.log(JSON.stringify({ cells: hs.length, heights: hash(hs), trees: trees.length, treesHash: hash(trees.flatMap((t) => [t.x, t.y, t.z])), huts: world.buildings.filter((b) => b.type === 'hut').map((b) => [b.id, +b.x.toFixed(1), +b.z.toFixed(1), +b.floorY.toFixed(2)]) }));
  process.exit(0);
}

ok('the map as it was is still exactly there: its ground, its buildings, its starts, its trees, its loot points, its jeeps', () => {
  const hs = oldGround((x, z) => !touched(x, z));
  assert.equal(hs.length, WAS.cells);
  assert.equal(hash(hs), WAS.heights, 'the old ground has moved');
  const old = world.buildings.slice(0, WAS.buildings);
  assert.equal(old[old.length - 1].id, WAS.lastId);
  assert.equal(hash(old.flatMap((b) => [b.x, b.z, b.rot, b.floorY])), WAS.buildingsHash, 'an old building has moved');
  assert.equal(hash(world.spawnRing.flatMap((s) => [s.x, s.z, s.yaw])), WAS.spawns, 'a starting point has moved');
  // (and of those, nobody is set down by the bunker any more, nor between the valley and the town in the east)
  assert.ok(world.spawns.length >= 16 && world.spawns.length < world.spawnRing.length, `${world.spawns.length} starts left of ${world.spawnRing.length}`);
  for (const sp of world.spawns) {
    assert.ok(world.spawnRing.includes(sp), 'a start that is none of the ring');
    assert.ok(Math.hypot(sp.x - BUNKER_AT.x, sp.z - BUNKER_AT.z) > NO_START.bunker, 'a start by the bunker');
    assert.ok(Math.hypot(sp.x - TOWN.gate.x, sp.z - TOWN.gate.z) > NO_START.gate && Math.hypot(sp.x - TOWN.x, sp.z - TOWN.z) > NO_START.town, 'a start between the valley and the town');
  }
  const trees = world.trees.filter((t) => inOld(t.x, t.z) && !touched(t.x, t.z));
  assert.equal(trees.length, WAS.trees);
  assert.equal(hash(trees.flatMap((t) => [t.x, t.y, t.z])), WAS.treesHash, 'a tree away from the works has moved');
  // (what is kept between restarts goes by a loot point's number: the old ones are the first, in their old order)
  const points = data.lootPoints.slice(0, WAS.lootPoints);
  assert.equal(hash(points.flatMap((p) => [p.x, p.y, p.z])), WAS.lootHash, 'an old loot point has moved or been renumbered');
  assert.equal(data.jeeps.length, WAS.jeeps);
  assert.equal(hash(data.jeeps.flatMap((j: { x: number; z: number }) => [j.x, j.z])), WAS.jeepsHash);
  // (the old six, and one each at the three places built in the east country)
  assert.equal(data.fires.length, WAS.fires + 3);
});

ok('it lies outside the ring the map used to end at, inside the ground there is, and the two are one place to play in', () => {
  assert.ok(Math.hypot(E.x, E.z) - E.floor > PLAY_RADIUS, 'its floor reaches into the old map');
  const R = E.floor + E.wall;
  assert.ok(Math.abs(E.x) + R < half && Math.abs(E.z) + R < half, 'it runs off the edge of the ground');
  // (the valley, the works, the bunker; and since, the town in the east and the round over the road to it)
  assert.equal(PLAY_AREAS.length, 5);
  assert.ok(inPlay(0, 0) && inPlay(E.x, E.z) && inPlay(camp.x, camp.z) && inPlay(BUNKER_AT.x, BUNKER_AT.z));
  assert.ok(!inPlay(E.x, -E.z) && !inPlay(-E.x, E.z), 'the other corners of the map are not played in');
  // one line round the whole: every arc ends where another begins (the valley's round is in two pieces, between the two places added to it)
  const arcs = playOutline();
  assert.ok(arcs.length >= 6, `${arcs.length} arcs`);
  const at = (o: (typeof arcs)[number], t: number) => [o.x + Math.cos(t) * o.r, o.z + Math.sin(t) * o.r];
  for (const o of arcs) {
    const end = at(o, o.to);
    assert.ok(arcs.some((q) => q !== o && Math.hypot(at(q, q.from)[0] - end[0], at(q, q.from)[1] - end[1]) < 0.01), 'the line round the map does not meet itself');
  }
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
  const homes = data.homes as { x: number; z: number; n: number; inside?: unknown[] }[];
  const here = homes.find((h) => Math.hypot(h.x - E.x, h.z - E.z) < 1);
  assert.ok(here && here.n >= 4, 'none at the works');
  assert.equal(homes.reduce((s, h) => s + h.n, 0), INFECTED.max);
  // (the valley held thirty-three before there was a works, or a bunker with its own shut in it)
  const below = homes.filter((h) => h.inside);
  assert.ok(below.length === 1 && below[0].n >= 4 && below[0].inside!.length >= below[0].n * 2, 'none in the bunker, or nowhere for them to stand');
  // (and those that walk the ground over it)
  const over = homes.filter((h) => !h.inside && Math.hypot(h.x - below[0].x, h.z - below[0].z) < 1);
  assert.ok(over.length === 1 && over[0].n >= 6, 'none over the bunker');
  // (and the fifteen of the east country since: ten in the town, two at the squat, three at the camp)
  assert.equal(INFECTED.max - here!.n - below[0].n - over[0].n, 33 + 15);
  const east = homes.filter((h) => Math.abs(h.x) > 512 || Math.abs(h.z) > 512);
  assert.equal(east.reduce((a, h) => a + h.n, 0), 15, 'the east country has not its fifteen');
});

ok('the long huts stand where they were meant to: beside the trading post, behind the depot, and on the track up to the works', () => {
  // (three on the old map, apart from the one in the village; the town's and the camp's are the east country's, below)
  const huts = world.buildings.filter((b) => b.type === 'hut' && inOld(b.x, b.z) && !IN_VILLAGE.some((q) => Math.hypot(b.x - q.x, b.z - q.z) < 3));
  assert.equal(huts.length, 3, `${huts.length} huts`);
  // and in the village, one of each of the downloaded buildings, where the ground was fenced off for it
  for (const q of IN_VILLAGE) assert.ok(world.buildings.some((b) => b.type === q.type && Math.hypot(b.x - q.x, b.z - q.z) < 0.5), `no ${q.type} in the village at ${q.x}, ${q.z}`);
  assert.ok(huts.some((b) => Math.hypot(b.x - TRADE_AT.x, b.z - TRADE_AT.z) < 60), 'none at the trading post');
  assert.ok(huts.some((b) => Math.hypot(b.x - HUT_AT.x, b.z - HUT_AT.z) < 2), 'none behind the depot, where the ground was fenced off for it');
  // (the third is on ground the works' track had already moved)
  const third = huts.find((b) => Math.hypot(b.x - camp.x, b.z - camp.z) < 80);
  assert.ok(third, 'none by the checkpoint');
  for (const lx of [-13, -6.8, 0, 6.8, 13]) for (const lz of [-9, 0, 9]) {
    const c = Math.cos(third.rot), s = Math.sin(third.rot);
    assert.ok(touched(third.x + lx * c + lz * s, third.z - lx * s + lz * c), 'the hut by the checkpoint reaches onto the old map');
  }
  // each stands on its floor: the ground round it within a step of the floor
  for (const b of huts) for (const [lx, lz] of [[8.2, -1.35], [-8.2, 0], [0, 3.6], [0, -3.6]]) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const g = ground(b.x + lx * c + lz * s, b.z - lx * s + lz * c);
    assert.ok(b.floorY - g > -0.05 && b.floorY - g < 0.75, `${b.id}: the ground is ${(b.floorY - g).toFixed(2)} m under its floor at ${lx}, ${lz}`);
  }
});

ok('the east country: a town out of the valley by the road, two places far out, and woods, all on ground the old map did not have', () => {
  const town = world.sites.find((st) => st.kind === 'town')!;
  assert.ok(town && town.name === TOWN.name && !inOld(town.x, town.z), 'no town, or it is on the old map');
  const built = world.buildings.filter((b) => !inOld(b.x, b.z));
  assert.ok(built.length >= 18, `${built.length} buildings out there`);
  for (const b of built) assert.ok(Math.abs(b.x) < half - 20 && Math.abs(b.z) < half - 20, `${b.id} is off the ground`);
  // every one of the downloaded buildings is used: the brick block four times in the town, the plank house far out, the long hut at both
  const of = (type: string, x: number, z: number, r: number) => built.filter((b) => b.type === type && Math.hypot(b.x - x, b.z - z) < r).length;
  // (and they are most of the town: the owner's word for it is that they dominate it)
  assert.equal(of('townhouse', town.x, town.z, 110), 8);
  assert.equal(of('hut', town.x, town.z, 110), 4);
  assert.equal(of('shanty', town.x, town.z, 110), 3);
  const inTown = built.filter((b) => Math.hypot(b.x - town.x, b.z - town.z) < 110);
  assert.ok(inTown.length >= 24 && inTown.filter((b) => ['townhouse', 'hut', 'shanty'].includes(b.type)).length * 2 > inTown.length, 'the new buildings are not most of the town');
  const squat = OUTLYING.find((o) => o.kind === 'squat')!, camp = OUTLYING.find((o) => o.kind === 'camp')!;
  assert.equal(of('shanty', squat.x, squat.z, 30), 1);
  assert.equal(of('hut', camp.x, camp.z, 40), 2);
  for (const type of ['police', 'clinic', 'store', 'garage']) assert.equal(of(type, town.x, town.z, 110), 1, `the town has no ${type}`);
  // nothing stands in anything else, and each stands on its floor
  for (const b of built) {
    // (neither's ground plan reaches into the other's: tried at the corners and the middles of the sides of each)
    for (const o of built) {
      if (o === b) continue;
      const [ow, od] = BUILDING_FOOTPRINT[o.type], [bw, bd] = BUILDING_FOOTPRINT[b.type], oc = Math.cos(o.rot), os = Math.sin(o.rot), bc = Math.cos(b.rot), bs = Math.sin(b.rot);
      for (const [fx, fz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) {
        const lx = (fx * bw) / 2, lz = (fz * bd) / 2;
        const wx = b.x + lx * bc + lz * bs - o.x, wz = b.z - lx * bs + lz * bc - o.z;
        assert.ok(Math.abs(wx * oc - wz * os) > ow / 2 + 0.5 || Math.abs(wx * os + wz * oc) > od / 2 + 0.5, `${b.id} stands in ${o.id}`);
      }
    }
    const [w, d] = BUILDING_FOOTPRINT[b.type], c = Math.cos(b.rot), sn = Math.sin(b.rot);
    for (const [lx, lz] of [[w / 2 + 1.5, 0], [-w / 2 - 1.5, 0], [0, d / 2 + 1.5], [0, -d / 2 - 1.5]]) {
      const g = ground(b.x + lx * c + lz * sn, b.z - lx * sn + lz * c);
      // (a hand's breadth over the floor is let pass: the ground is a point every two metres, and five metres from a
      // neighbour whose floor is a step higher it cannot be both houses' at once)
      assert.ok(b.floorY - g > -0.2 && b.floorY - g < 0.95, `${b.id}: the ground is ${(b.floorY - g).toFixed(2)} m under its floor`);
    }
  }
  // the road: a second line, picked up where the first ran out, down the town's street, and never a point added to the first
  assert.equal(world.road.points.length, 295 * 3, 'the old road has been lengthened: jeeps and lamps are told off along it by number');
  assert.equal(world.roads.length, 1);
  const p = world.roads[0].points, n = p.length / 3, last = world.road.points.length - 3;
  assert.ok(Math.hypot(p[0] - world.road.points[last], p[2] - world.road.points[last + 2]) < 0.01 && Math.abs(p[1] - world.road.points[last + 1]) < 0.01, 'the new road does not begin where the old one ends');
  let nearest = 1e9, steep = 0;
  for (let i = 0; i < n; i++) {
    nearest = Math.min(nearest, Math.hypot(p[i * 3] - town.x, p[i * 3 + 2] - town.z));
    assert.ok(!inOld(p[i * 3], p[i * 3 + 2]) || i === 0, 'the new road runs back onto the old map');
    if (i) steep = Math.max(steep, Math.abs(p[i * 3 + 1] - p[i * 3 - 2]) / Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 2] - p[i * 3 - 1]));
  }
  assert.ok(nearest < 1, `the road passes ${nearest.toFixed(1)} m from the middle of the town`);
  assert.ok(steep < 0.2, `the road climbs ${(steep * 100).toFixed(0)} in a hundred somewhere`);
  // no building on the road, no tree on it or in a building
  const onRoad = (x: number, z: number, r: number) => {
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 3], az = p[i * 3 + 2], dx = p[i * 3 + 3] - ax, dz = p[i * 3 + 5] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true;
    }
    return false;
  };
  for (const b of built) assert.ok(!onRoad(b.x, b.z, Math.min(...BUILDING_FOOTPRINT[b.type]) / 2 + 3.2), `${b.id} stands in the road`);
  const planted = world.trees.filter((t) => !inOld(t.x, t.z));
  assert.ok(planted.length > 5000 && planted.length < 15000, `${planted.length} trees out there`);
  for (const t of planted) {
    assert.ok(!onRoad(t.x, t.z, 5), 'a tree stands in the new road');
    assert.ok(Math.abs(t.y - ground(t.x, t.z)) < 0.06, 'a tree is off the ground');
  }
  // the Zona: the town is in it, joined to the valley over the road; the two far places are not
  assert.ok(inPlay(town.x, town.z));
  for (let i = 0; i < world.road.points.length / 3; i++) if (world.road.points[i * 3] > 0) assert.ok(inPlay(world.road.points[i * 3], world.road.points[i * 3 + 2]), 'the road east leaves the Zona before the town');
  for (let i = 0; i < n; i++) if (Math.hypot(p[i * 3] - town.x, p[i * 3 + 2] - town.z) < 100 || p[i * 3 + 2] < town.z) assert.ok(inPlay(p[i * 3], p[i * 3 + 2]), 'the road to the town leaves the Zona on the way');
  for (const o of OUTLYING) assert.ok(!inPlay(o.x, o.z), `${o.name} is inside the Zona`);
  // loot: the new buildings have places for things, all after every place there was
  const fresh = data.lootPoints.slice(WAS.lootPoints).filter((q: { x: number; z: number }) => !inOld(q.x, q.z));
  assert.ok(fresh.length >= 150, `${fresh.length} places for things out there`);
});

console.log(`\n${n} checks passed`);
