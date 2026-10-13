// The map's first expansion (EXPANSION in src/world/worldgen.ts): that the map as it was is
// still exactly there, and that what was added can be walked into and stands up.
// `npx tsx test/expansion.test.ts`.

import assert from 'node:assert/strict';
import { ARMY_CAMP, BUNKER_AT, CELL, KAMENKA, LOOP, MOUNTAIN, NO_START, OUTLYING, PASS, PLAY_FIRST, TOWN, TRADE_AT, kamenkaQ, loopFence, loopLine, EXPANSION as E, PLAY_AREAS, PLAY_RADIUS, WORLD_RES, WORLD_SIZE, generateWorld, heightAt, inPlay, playOutline, slopeAt, BUILDING_FOOTPRINT } from '../src/world/worldgen';
import { buildWorldData } from '../server/world';
import { GAS, gasDepth, gasZone } from '../src/sim/gas';
import { INFECTED, openGround } from '../src/sim/infected';
import { deckWidth, onBridge, spanOf, wreckUnder } from '../src/sim/bridge';
import { OUTCROP, castleAt, castleHomes, castleLocal } from '../src/sim/castle';

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
// (The jeeps: 380833839 until 2026-10-10. The one that stood at the foot of the old road's last climb, at 334, 150,
// stands at 268, 115, the foot of the climb as it is now: where it stood is the side of a bank.)
// (The ground and the trees once more on 2026-10-10, with the way over to Kamenka left out (see PASS): counted on
// the map before the hill was cut down along the road, with the fence already round it. It was 217934 cells,
// 4113734791; 10647 trees, 778129303.)
// (The loot points were counted again on 2026-10-10: the same points in the same order, those that are on
// a bed a hand's width higher, on the mattress each bed was given. It was 545356472.)
// (And on 2026-10-10 again, 1223262982 before it: the same places in the same order, those on a water
// barrel 3 cm lower, on its lid and not at the height of its rim.)
// (And the ground and the trees once more on 2026-10-10, with the trading post's meadow left out as well:
// counted on the map BEFORE the post was built (234302 cells, 1986740555; 11269 trees, 3538601034 with it in),
// and the same four figures came off the map after.)
// (The ground and the trees were counted again on 2026-10-09, from the same map, with the
// bunker's hollow left out of the count as the works' is: taken before the bunker was dug.)
// (2026-10-11: thirty-three of the old places for things moved, each inside its own house and none by more than
// 4.2 m, when the upstairs wall of the two-floor house was moved clear of its window and closets were built:
// compared place by place, before and after, with assets-src/_wf/me/loot-points.ts. None was added or renumbered.)
import { JEEP } from '../src/sim/vehicles';
// (2026-10-12, with the village fenced off (see VILLAGE_FENCE), off the map as it was live that day. They were: 190604
// cells, 3515396887; all 72 buildings, 2448790248; 9494 trees, 1630127803; all 675 loot points, 2826555666.)
// (2026-10-13, with the hillside behind the bunker fenced off as well (BUNKER_FENCE), off the map as it was live that
// day. They were: 181893 cells, 1379160507; 9454 trees, 3496676067.)
// (2026-10-13 again, when the road was made a loop (LOOP in the generator): the first pass laid back to 190 m from
// the road (PASS.reach, which the fence follows: it was 150), and fenced off besides, by `loopFence`, the ground the
// second pass was cut through at the old road's west end and the strip the new road rounds the works on. Off the
// map as it was before any of that, with those fences up. They were: 160775 cells, 1846616272; 8100 trees,
// 3268064997. What moved inside the new fences was counted cell by cell against the map before, and nothing
// outside them had: the same four figures came off the map before and after.)
const WAS = { cells: 133883, heights: 176932252, buildings: 72, away: 46, buildingsHash: 816271812, lastId: 'tower_71', spawns: 2697513077, trees: 6547, treesHash: 3799651930, lootPoints: 675, lootAway: 371, lootHash: 760462293, jeeps: 8, jeepsAway: 7, jeepsHash: 1649467612, fires: 6 };
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
/**
 * The village, laid out again on 2026-10-12 (streets, every building stood on one, more of them, the police
 * headquarters): all of it is fenced off. (As far as it reaches, measured against the map that was live that day:
 * ground moved from x -86 to 148 and z -66 to 130, no tree, and twenty-two of the old buildings; six metres are
 * allowed beyond.) What is asked of the old map is asked of the rest of it: the figures in WAS were taken with
 * this fence up, off the map as it was before.
 */
const VILLAGE_FENCE = { x0: -92, x1: 154, z0: -72, z1: 136 };
const inVillage = (x: number, z: number) => x >= VILLAGE_FENCE.x0 && x <= VILLAGE_FENCE.x1 && z >= VILLAGE_FENCE.z0 && z <= VILLAGE_FENCE.z1;
/** the village's second clinic and second shop (2026-10-11), at the two ends of its street: the ground fenced off for each */
const SECOND = [{ type: 'clinic', x: 136.7, z: 23.5 }, { type: 'store', x: -63.1, z: -17.6 }];

/** how far round the bunker the old ground may have been moved: its hollow, and the hillside cut back behind it */
const BUNKER_FENCE = 190;

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
/** the old road from where its climb out of the valley begins (see PASS), and the first of the road on from it */
const passLine: [number, number][] = [];
for (let i = 0; i < world.road.points.length / 3; i++) if (world.road.points[i * 3] >= PASS.from) passLine.push([world.road.points[i * 3], world.road.points[i * 3 + 2]]);
for (let i = 0; i < 26; i++) passLine.push([world.roads[0].points[i * 3], world.roads[0].points[i * 3 + 2]]);
/** the only ground the expansion may have touched: the cirque itself, and a strip along the track up to it from the checkpoint */
const touched = (x: number, z: number) => {
  if (Math.hypot(x - E.x, z - E.z) < 160) return true;
  if (inVillage(x, z)) return true;
  // (and the meadow the trading post was built in, later: 78 m round it)
  if (Math.hypot(x - TRADE_AT.x, z - TRADE_AT.z) < 78) return true;
  // (and the clearing the army's camp was pitched in, 2026-10-10: 78 m round it, as round the trading post)
  if (Math.hypot(x - ARMY_CAMP.x, z - ARMY_CAMP.z) < 78) return true;
  // (and where the long hut stands behind the depot's barracks: 24 m round it)
  if (Math.hypot(x - HUT_AT.x, z - HUT_AT.z) < 24) return true;
  // (and where one of each of the downloaded buildings was stood in the village, 2026-10-10: 24 m round each)
  if (IN_VILLAGE.some((q) => Math.hypot(x - q.x, z - q.z) < 24)) return true;
  if (SECOND.some((q) => Math.hypot(x - q.x, z - q.z) < 30)) return true;
  // (and Kamenka's valley, 2026-10-10: its rim stands on the old map's ground west and north of the town)
  if (kamenkaQ(x, z) < KAMENKA.foot + 0.1) return true;
  // (and the bunker's hollow, on the far side of the map; and, since 2026-10-13, the hillside behind it, which was
  // cut back to a slope somebody can walk: "generally smooth out the landscape around the bunker a little bit")
  if (Math.hypot(x - BUNKER_AT.x, z - BUNKER_AT.z) < BUNKER_FENCE) return true;
  // (and the way over to Kamenka, 2026-10-10: the hill cut down along the road's last climb and its foot banked up;
  // laid back further on 2026-10-13, which PASS.reach says)
  if (x > PASS.from - PASS.reach - 4 && passLine.some(([px, pz]) => Math.hypot(x - px, z - pz) < PASS.reach + 3)) return true;
  // (and the ground of the loop, 2026-10-13: the second pass, at the old road's west end, and the new road's bed
  // and banks where it comes onto the old map behind the works)
  if (loopFence(x, z)) return true;
  const dx = E.x - camp.x, dz = E.z - camp.z, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - camp.x) * dx + (z - camp.z) * dz) / l2));
  return Math.hypot(x - (camp.x + dx * t), z - (camp.z + dz * t)) < 34 && Math.hypot(x - camp.x, z - camp.z) > 16;
};
const inl = Math.hypot(camp.x - E.x, camp.z - E.z);
const ux = (camp.x - E.x) / inl, uz = (camp.z - E.z) / inl;
const works = world.sites.find((s) => s.kind === 'works')!;
// (what was built with the works: not the trading post's two, which came later and stand in the old map's meadow)
const added = world.buildings.slice(WAS.buildings).filter((b) => !['hut', 'townhouse', 'shanty', 'tent'].includes(b.type) && !SECOND.some((q) => Math.hypot(b.x - q.x, b.z - q.z) < 3) && Math.hypot(b.x - TRADE_AT.x, b.z - TRADE_AT.z) > 78 && Math.hypot(b.x - ARMY_CAMP.x, b.z - ARMY_CAMP.z) > 78 && inOld(b.x, b.z) && !inVillage(b.x, b.z));

// To take the old map's figures again after fencing off more ground (do it BEFORE building there): FIGURES=1 npx tsx test/expansion.test.ts
if (process.env.FIGURES) {
  const hs = oldGround((x, z) => !touched(x, z));
  const trees = world.trees.filter((t) => inOld(t.x, t.z) && !touched(t.x, t.z));
  const oldB = world.buildings.slice(0, WAS.buildings).filter((b) => !inVillage(b.x, b.z)), oldP = data.lootPoints.slice(0, WAS.lootPoints).filter((p) => !inVillage(p.x, p.z));
  const oldJ = data.jeeps.slice(0, WAS.jeeps).filter((j: { x: number; z: number }) => !inVillage(j.x, j.z));
  console.log(JSON.stringify({ jeepsAway: oldJ.length, jeepsHash: hash(oldJ.flatMap((j: { x: number; z: number }) => [j.x, j.z])) }));
  console.log(JSON.stringify({ away: oldB.length, buildingsHash: hash(oldB.flatMap((b) => [b.x, b.z, b.rot, b.floorY])), lootAway: oldP.length, lootHash: hash(oldP.flatMap((p) => [p.x, p.y, p.z])) }));
  console.log(JSON.stringify({ cells: hs.length, heights: hash(hs), trees: trees.length, treesHash: hash(trees.flatMap((t) => [t.x, t.y, t.z])), huts: world.buildings.filter((b) => b.type === 'hut').map((b) => [b.id, +b.x.toFixed(1), +b.z.toFixed(1), +b.floorY.toFixed(2)]) }));
  process.exit(0);
}

ok('the map as it was is still exactly there: its ground, its buildings, its starts, its trees, its loot points, its jeeps', () => {
  const hs = oldGround((x, z) => !touched(x, z));
  assert.equal(hs.length, WAS.cells);
  assert.equal(hash(hs), WAS.heights, 'the old ground has moved');
  const old = world.buildings.slice(0, WAS.buildings);
  assert.equal(old[old.length - 1].id, WAS.lastId);
  // (those of them that are not the village's: the village's stand on its streets now, each still the building it was)
  const away = old.filter((b) => !inVillage(b.x, b.z));
  assert.equal(away.length, WAS.away, 'an old building has come into the village or left it');
  assert.equal(hash(away.flatMap((b) => [b.x, b.z, b.rot, b.floorY])), WAS.buildingsHash, 'an old building away from the village has moved');
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
  // (the village's moved with their buildings, each keeping its number: the first of all are still the old ones,
  // and those away from the village are where they were)
  const points = data.lootPoints.slice(0, WAS.lootPoints).filter((p) => !inVillage(p.x, p.z));
  assert.equal(points.length, WAS.lootAway, 'an old loot point has come into the village or left it');
  assert.equal(hash(points.flatMap((p) => [p.x, p.y, p.z])), WAS.lootHash, 'an old loot point away from the village has moved or been renumbered');
  // (2026-10-11: five more cars stand where the map had none, found after all the others: the eight that stood stand where they stood)
  assert.equal(data.jeeps.length, WAS.jeeps + JEEP.far);
  // (those that do not stand in the village: the one or two that do stand where there is room for them now)
  const cars = data.jeeps.slice(0, WAS.jeeps).filter((j: { x: number; z: number }) => !inVillage(j.x, j.z));
  assert.equal(cars.length, WAS.jeepsAway);
  assert.equal(hash(cars.flatMap((j: { x: number; z: number }) => [j.x, j.z])), WAS.jeepsHash);
  // (the old six, and one each at the three places built in the east country)
  // (and one where the lane crosses in the army's camp)
  // (and two at the fort on the mountain, 2026-10-13: one in its keep, one in a ruined house on the way to it)
  assert.equal(data.fires.length, WAS.fires + 4 + 2);
});

ok('it lies outside the ring the map used to end at, inside the ground there is, and the two are one place to play in', () => {
  assert.ok(Math.hypot(E.x, E.z) - E.floor > PLAY_RADIUS, 'its floor reaches into the old map');
  const R = E.floor + E.wall;
  assert.ok(Math.abs(E.x) + R < half && Math.abs(E.z) + R < half, 'it runs off the edge of the ground');
  // (the valley, the works, the bunker; and since, the town in the east and the round over the road to it: the five
  // there were are the first five still, and the rounds strung along the loop come after them)
  assert.equal(PLAY_FIRST, 5);
  assert.deepEqual(PLAY_AREAS.slice(0, PLAY_FIRST).map((a) => [a.x, a.z]), [[0, 0], [E.x, E.z], [BUNKER_AT.x, BUNKER_AT.z], [TOWN.gate.x, TOWN.gate.z], [TOWN.x, TOWN.z]]);
  assert.deepEqual([PLAY_AREAS[0].r, PLAY_AREAS[1].r, PLAY_AREAS[3].r, PLAY_AREAS[4].r], [PLAY_RADIUS, E.floor + E.wall, TOWN.gate.r, TOWN.r]);
  assert.ok(PLAY_AREAS.length > PLAY_FIRST, 'the Zona has not grown along the loop');
  assert.ok(inPlay(0, 0) && inPlay(E.x, E.z) && inPlay(camp.x, camp.z) && inPlay(BUNKER_AT.x, BUNKER_AT.z));
  // (the corner across the valley from the works is not played in; the one across the road from it is, since
  // 2026-10-13: it lies inside the loop of the road, and everything inside the loop is the Zona's)
  assert.ok(!inPlay(E.x, -E.z) && !inPlay(E.x * 1.5, -E.z * 1.5), 'the north-west corner of the map is played in');
  assert.ok(inPlay(-E.x, E.z), 'the ground inside the loop of the road is not played in');
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
  // (the fort's are its own, over and above the map's: as many as its own file says)
  const forts = castleHomes(world.castle!).reduce((a, h) => a + h.n, 0);
  assert.equal(homes.reduce((s, h) => s + h.n, 0), INFECTED.max + forts);
  // (the valley held thirty-three before there was a works, or a bunker with its own shut in it)
  // (the bunker's: the fort on the mountain has a dark of its own under its terrace, counted further down)
  const atFort = (h: { x: number; z: number }) => Math.hypot(h.x - MOUNTAIN.castle.x, h.z - MOUNTAIN.castle.z) < 120;
  const below = homes.filter((h) => h.inside && !atFort(h));
  assert.ok(below.length === 1 && below[0].n >= 4 && below[0].inside!.length >= below[0].n * 2, 'none in the bunker, or nowhere for them to stand');
  // (and those that walk the ground over it)
  const over = homes.filter((h) => !h.inside && Math.hypot(h.x - below[0].x, h.z - below[0].z) < 1);
  assert.ok(over.length === 1 && over[0].n >= 6, 'none over the bunker');
  // (and the fifteen of the east country since: ten in the town, two at the squat, three at the camp; and, since
  // 2026-10-13, the fifteen the outlying places of the old valley were owed and had never had: see INFECTED.max)
  assert.equal(INFECTED.max - here!.n - below[0].n - over[0].n, 33 + 15 + 15);
  // (and the fort's own since: about its ruined village and in the dark under its terrace)
  assert.ok(forts >= 8 && homes.filter(atFort).reduce((a, h) => a + h.n, 0) === forts, 'the fort has not its own');
  const east = homes.filter((h) => (Math.abs(h.x) > 512 || Math.abs(h.z) > 512) && !atFort(h));
  assert.equal(east.reduce((a, h) => a + h.n, 0), 15, 'the east country has not its fifteen');
});

ok('the long huts stand where they were meant to: beside the trading post, behind the depot, and on the track up to the works', () => {
  // (three on the old map, apart from the one in the village; the town's and the camp's are the east country's, below)
  const huts = world.buildings.filter((b) => b.type === 'hut' && inOld(b.x, b.z) && !inVillage(b.x, b.z));
  assert.equal(huts.length, 3, `${huts.length} huts`);
  // and in the village, one of each of the downloaded buildings (each stood on a street of it since 2026-10-12: it
  // was where the ground had been fenced off for it)
  for (const q of IN_VILLAGE) assert.equal(world.buildings.filter((b) => b.type === q.type && inVillage(b.x, b.z)).length, 1, `not one ${q.type} in the village`);
  // and the village's second clinic and second shop: the last two buildings of all, each where its ground was fenced
  // off, well away from the police station, from the first of its kind and from one another, and still in the village
  const police = world.buildings.find((b) => b.type === 'police')!, village = world.pois[0];
  // (the last two there were when they were built: what has been built since comes after them)
  const last = SECOND.map((q) => world.buildings.find((b) => b.type === q.type && Math.hypot(b.x - q.x, b.z - q.z) < 0.5)!);
  assert.ok(last.every(Boolean), 'the second clinic or the second shop is gone');
  assert.ok(world.buildings.indexOf(last[1]) === world.buildings.indexOf(last[0]) + 1, 'the second clinic and the second shop are not side by side in the list');
  SECOND.forEach((q, i) => {
    const b = last[i];
    assert.ok(b.type === q.type && Math.hypot(b.x - q.x, b.z - q.z) < 0.5, `no second ${q.type} at ${q.x}, ${q.z}: ${b.id} is at ${b.x.toFixed(1)}, ${b.z.toFixed(1)}`);
    assert.ok(Math.hypot(b.x - police.x, b.z - police.z) > 80, `the second ${q.type} is by the police station`);
    assert.ok(Math.hypot(b.x - village.x, b.z - village.z) < 118, `the second ${q.type} is out of the village`);
    const firstOf = world.buildings.find((o) => o.type === q.type && Math.hypot(o.x - village.x, o.z - village.z) < 60)!;
    assert.ok(Math.hypot(b.x - firstOf.x, b.z - firstOf.z) > 80, `the second ${q.type} is by the first`);
  });
  assert.ok(Math.hypot(last[0].x - last[1].x, last[0].z - last[1].z) > 150, 'the second clinic and the second shop are together');
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

ok('the way over to the town can be driven: one even climb, level across, the ground under the road and not over it', () => {
  // (it was a wall: the old road ran straight up the side of its valley, 105 in a hundred at the worst of it)
  const at: [number, number, number][] = [];
  for (const pts of [world.road.points, world.roads[0].points]) for (let i = 0; i < pts.length / 3; i++) if (pts[i * 3] > PASS.from - 90) at.push([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]);
  let steep = 0, tilt = 0, off = 0, top = -1e9, low = 1e9;
  for (let i = 1; i < at.length - 1; i++) {
    const [x, y, z] = at[i], dx = at[i + 1][0] - at[i - 1][0], dz = at[i + 1][2] - at[i - 1][2], l = Math.hypot(dx, dz);
    if (l < 0.5) continue;
    const tx = dx / l, tz = dz / l;
    // as the wheels find it: the ground itself, four metres either way along it and two and a half either side
    steep = Math.max(steep, Math.abs(ground(x + tx * 4, z + tz * 4) - ground(x - tx * 4, z - tz * 4)) / 8);
    tilt = Math.max(tilt, Math.abs(ground(x - tz * 2.5, z + tx * 2.5) - ground(x + tz * 2.5, z - tx * 2.5)) / 5);
    off = Math.max(off, Math.abs(ground(x, z) - y));
    top = Math.max(top, y);
    low = Math.min(low, y);
  }
  assert.ok(steep < 0.25, `the road climbs ${(steep * 100).toFixed(0)} in a hundred somewhere between the village and the town`);
  assert.ok(tilt < 0.12, `the road leans ${(tilt * 100).toFixed(0)} in a hundred across somewhere`);
  assert.ok(off < 0.3, `the ground is ${off.toFixed(2)} m off the road somewhere`);
  // (and it goes no higher than the town it goes to: it used to go ten metres over it and come down again)
  assert.ok(top < ground(TOWN.x, TOWN.z) + 1.5, `the road goes up to ${top.toFixed(0)} m on the way to a town at ${ground(TOWN.x, TOWN.z).toFixed(0)} m`);
  // the sides of the cutting and of the bank: a hillside a wood can stand on, not a wall
  let wall = 0;
  for (const [px, pz] of passLine) for (const [ox, oz] of [[0, 14], [0, -14], [0, 30], [0, -30], [30, 0], [-30, 0], [0, 60], [0, -60]]) wall = Math.max(wall, slopeAt(world.heights, px + ox, pz + oz));
  // (the old hill beside the road stood at 56 degrees where it was steepest, and still does where it was not touched)
  assert.ok(wall < 1.55, `the ground beside the way over stands at ${(Math.atan(wall) * 57.3).toFixed(0)} degrees somewhere`);
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
      // (the hospital is three buildings stood against one another: its main block, its wing and the block before its doors)
      if (b.type.startsWith('hospital') && o.type.startsWith('hospital')) continue;
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
  // (one road; what was laid after it is streets, the village's and the hospital's drive; and after those, the loop:
  // see the last check)
  assert.ok(!world.roads[0].side && world.roads.slice(1, 5).every((r) => r.side), 'a second road that is not a street');
  assert.equal(world.roads.length, 5 + 4);
  const p = world.roads[0].points, n = p.length / 3, last = world.road.points.length - 3;
  assert.ok(Math.hypot(p[0] - world.road.points[last], p[2] - world.road.points[last + 2]) < 0.01 && Math.abs(p[1] - world.road.points[last + 1]) < 0.01, 'the new road does not begin where the old one ends');
  let nearest = 1e9, steep = 0;
  for (let i = 0; i < n; i++) {
    nearest = Math.min(nearest, Math.hypot(p[i * 3] - town.x, p[i * 3 + 2] - town.z));
    assert.ok(!inOld(p[i * 3], p[i * 3 + 2]) || i === 0, 'the new road runs back onto the old map');
    if (i) steep = Math.max(steep, Math.abs(p[i * 3 + 1] - p[i * 3 - 2]) / Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 2] - p[i * 3 - 1]));
  }
  assert.ok(nearest < 1, `the road passes ${nearest.toFixed(1)} m from the middle of the town`);
  // (the town's own street is a street; the way up to it is the next check's)
  assert.ok(steep < 0.25, `the road climbs ${(steep * 100).toFixed(0)} in a hundred somewhere`);
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

ok('the road is a loop: out of the far end of Kamenka, over the bridge, round by the high ground and down a second pass onto the old road; and a road up the mountain', () => {
  const R = world.roads, door = R[5].points, over = R[6], main = R[7].points, hill = R[8];
  assert.ok(!R[5].side && !R[5].bridge && over.bridge && !R[7].side && hill.side, 'the lines of the new road are not the door, the bridge, the shelf and the mountain road, in that order');
  // each begins where the one before it ends, from the end of Kamenka's street round to the old road's first point
  const street = R[0].points, meet = (a: Float32Array, i: number, b: Float32Array, j: number, what: string) => assert.ok(Math.hypot(a[i] - b[j], a[i + 2] - b[j + 2]) < 0.01 && Math.abs(a[i + 1] - b[j + 1]) < 0.01, what);
  meet(door, 0, street, street.length - 3, "the new road does not begin at the end of Kamenka's street");
  meet(over.points, 0, door, door.length - 3, 'the bridge does not begin where the road out of the town ends');
  meet(main, 0, over.points, 3, 'the road does not go on from the bridge');
  meet(main, main.length - 3, world.road.points, 0, "the new road does not end on the old road's first point");
  assert.equal(world.bridges.length, 1);
  // It can be driven: the ground under every stretch of it (the old road's west end too, which was a wall of 78 in
  // a hundred) climbs less than a quarter, is level across, and is the road's own height. As the wheels find it.
  // (the old road's points that were given new heights: as far down as the foot of the second pass. And the mountain
  // road from where it is clear of the pass road, whose verge it crosses first: that slopes as the pass does.)
  const foot = loopLine().main.length - loopLine().old;
  const lines: [string, Float32Array, number][] = [['the road out of the town', door, 2], ['the shelf road and the west pass', main, 2], ["the old road's west end", world.road.points.slice(0, foot * 3), 2], ['the mountain road', hill.points, 6]];
  for (const [name, p, from] of lines) {
    let steep = 0, tilt = 0, off = 0;
    for (let i = from; i < p.length / 3 - 2; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], dx = p[i * 3 + 3] - p[i * 3 - 3], dz = p[i * 3 + 5] - p[i * 3 - 1], l = Math.hypot(dx, dz);
      if (l < 0.5) continue;
      const tx = dx / l, tz = dz / l;
      steep = Math.max(steep, Math.abs(ground(x + tx * 4, z + tz * 4) - ground(x - tx * 4, z - tz * 4)) / 8);
      tilt = Math.max(tilt, Math.abs(ground(x - tz * 2.2, z + tx * 2.2) - ground(x + tz * 2.2, z - tx * 2.2)) / 4.4);
      off = Math.max(off, Math.abs(ground(x, z) - y));
    }
    assert.ok(steep < 0.25, `${name} climbs ${(steep * 100).toFixed(0)} in a hundred somewhere`);
    assert.ok(tilt < 0.12, `${name} leans ${(tilt * 100).toFixed(0)} in a hundred across somewhere`);
    assert.ok(off < 0.35, `the ground is ${off.toFixed(2)} m off ${name} somewhere`);
  }
  // the old road keeps every point it had where it had it: only the height of its first is new (see the first check for the count)
  assert.ok(world.road.points[1] < 60, `the old road's first point is still ${world.road.points[1].toFixed(0)} m up, at the top of a wall`);
  // The second pass and the first are hillsides, not trenches: of the ground from twelve to seventy metres either
  // side of the road where it is cut through the hill, four fifths can be walked (under 33 degrees: src/sim/slopes.ts).
  for (const [name, pts] of [['the first pass', passLine.filter(([x]) => x > 410)], ['the second pass', loopLine().main.slice(loopLine().old).filter(([x]) => x < -380)]] as [string, [number, number][]][]) {
    let all = 0, steep = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const dx = pts[i + 1][0] - pts[i - 1][0], dz = pts[i + 1][1] - pts[i - 1][1], l = Math.hypot(dx, dz) || 1;
      for (let k = 12; k <= 70; k += 6) for (const sgn of [1, -1]) {
        all++;
        if (slopeAt(world.heights, pts[i][0] - (dz / l) * k * sgn, pts[i][1] + (dx / l) * k * sgn) > Math.tan((33 * Math.PI) / 180)) steep++;
      }
    }
    assert.ok(steep < all * 0.2, `${((steep / all) * 100).toFixed(0)}% of the ground beside ${name} is too steep to walk`);
  }
  // the Zona takes the loop in, all of it, with ground to fight on either side; the two far places stay outside it;
  // and it is one piece with no hole in it (nothing inside the loop is outside the line)
  for (const line of [loopLine().door, loopLine().main]) for (const [x, z] of line) {
    assert.ok(inPlay(x, z), `the new road leaves the Zona at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    for (let a = 0; a < 6.28; a += 0.785) assert.ok(inPlay(x + Math.cos(a) * 30, z + Math.sin(a) * 30), `there are not thirty metres of the Zona beside the new road at ${x.toFixed(0)}, ${z.toFixed(0)}`);
  }
  for (const o of OUTLYING) assert.ok(!inPlay(o.x, o.z, -LOOP.clear + 6), `${o.name} is in the Zona, or all but`);
  {
    const S = 8, M = Math.floor(WORLD_SIZE / S) + 1, out = new Uint8Array(M * M), stack: number[] = [];
    const inZona = (k: number) => inPlay(-half + (k % M) * S, -half + Math.floor(k / M) * S);
    for (let i = 0; i < M; i++) for (const k of [i, (M - 1) * M + i, i * M, i * M + M - 1]) if (!out[k] && !inZona(k)) (out[k] = 1), stack.push(k);
    while (stack.length) {
      const k = stack.pop()!;
      for (const m of [k - 1, k + 1, k - M, k + M]) if (m >= 0 && m < M * M && Math.abs((m % M) - (k % M)) <= 1 && !out[m] && !inZona(m)) (out[m] = 1), stack.push(m);
    }
    for (let k = 0; k < M * M; k++) assert.ok(out[k] || inZona(k), `a hole in the Zona at ${-half + (k % M) * S}, ${-half + Math.floor(k / M) * S}`);
  }
  // nobody starts on it or beside it, and no tree stands in it
  const near = (x: number, z: number) => Math.min(...[door, main, hill.points].map((p) => { let d = 1e9; for (let i = 0; i < p.length; i += 3) d = Math.min(d, Math.hypot(p[i] - x, p[i + 2] - z)); return d; }));
  for (const t of world.trees) if (Math.abs(t.x) > 380 || Math.abs(t.z) > 380) assert.ok(near(t.x, t.z) > 4.6, `a tree stands in the new road at ${t.x.toFixed(0)}, ${t.z.toFixed(0)}`);
  for (const sp of world.spawnRing) assert.ok(near(sp.x, sp.z) > 25, 'a start on the new road');
  // The mountain road: off the pass by Kamenka's first door, never near the bunker, to the gatehouse; and the place
  // kept for the fort above it is clear
  const hp = hill.points;
  assert.ok(passLine.some(([x, z]) => Math.hypot(x - hp[0], z - hp[2]) < 3.5), 'the mountain road does not leave the pass road');
  for (let i = 0; i < hp.length; i += 3) assert.ok(Math.hypot(hp[i] - BUNKER_AT.x, hp[i + 2] - BUNKER_AT.z) > 250, 'the mountain road comes within 250 m of the bunker');
  assert.ok(world.gatehouse && Math.hypot(world.gatehouse.x - hp[hp.length - 3], world.gatehouse.z - hp[hp.length - 1]) < 0.01, 'no gatehouse at the end of the mountain road');
  for (const list of [world.trees, world.rocks, world.props]) for (const t of list) assert.ok(Math.hypot(t.x - MOUNTAIN.castle.x, t.z - MOUNTAIN.castle.z) >= MOUNTAIN.castle.clear || t.x > MOUNTAIN.crest.hollow.brow, `a ${t.kind} stands where the fort stands (the hollow behind it is not that: beyond the brow of the cliff under its lee wall the ground is the world's)`);
  // The fort: where the map says, its terrace clear of the ground under it by what it asks at the least (the cellars'
  // floor is 3.8 m under the terrace), its place named on the map, and the path from the gatehouse comes to the foot
  // of the rock its ramp leaves from
  const fort = world.castle!;
  assert.ok(fort && fort.x === MOUNTAIN.castle.x && fort.z === MOUNTAIN.castle.z && fort.y === MOUNTAIN.castle.terrace, 'no fort where the mountain road leads');
  for (let lx = -10; lx <= 10; lx += 2) for (let lz = -10; lz <= 10; lz += 2) {
    const [wx, , wz] = castleAt(fort, lx, lz);
    assert.ok(fort.y - ground(wx, wz) > 5.2, `the ground is ${(fort.y - ground(wx, wz)).toFixed(1)} m under the fort's terrace at ${lx}, ${lz}: its cellars are in it`);
  }
  assert.ok(world.pois.some((q) => q.name === MOUNTAIN.castle.name && q.x === fort.x && q.z === fort.z), 'the fort is not named on the map');
  const pathEnd = MOUNTAIN.path.line[MOUNTAIN.path.line.length - 1], [ex, ez] = castleLocal(fort, pathEnd[0], 0, pathEnd[1]);
  assert.ok(ex > OUTCROP.x1 && ex < OUTCROP.x1 + 10 && Math.abs(ez) < 6, `the path ends at ${ex.toFixed(0)}, ${ez.toFixed(0)} of the fort's own measure: not at the foot of its rock`);
  // The bridge: nothing is dropped from the sky under it (a supply drop is set down on level, clear ground: there is
  // none under the deck), and what lies about the wreck in the cleft are the last places for things there are
  const b = world.bridges[0], len = spanOf(b);
  for (let x = Math.min(b.ax, b.bx) - 2; x <= Math.max(b.ax, b.bx) + 2; x += 2) for (let z = Math.min(b.az, b.bz) - deckWidth() / 2; z <= Math.max(b.az, b.bz) + deckWidth() / 2; z += 2) {
    const p = onBridge(b, x, z);
    // (under it: where the ground has fallen away from the deck. At its two ends the ground is the road.)
    if (p.along < 0 || p.along > len || Math.abs(p.side) > deckWidth() / 2 || LOOP.deck - ground(x, z) < 2) continue;
    const y = ground(x, z), steep = Math.max(...[[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]].map(([dx, dz]) => Math.abs(ground(x + dx, z + dz) - y)));
    const stood = world.trees.some((t) => Math.abs(t.x - x) < 3.5 && Math.abs(t.z - z) < 3.5) || world.rocks.some((t) => Math.abs(t.x - x) < 3 && Math.abs(t.z - z) < 3) || world.props.some((t) => Math.abs(t.x - x) < 2.5 && Math.abs(t.z - z) < 2.5);
    assert.ok(steep > 0.5 || stood, `a supply drop could be set down under the bridge at ${x}, ${z}`);
  }
  // (the last there were until the fort was stood on the mountain: the fort's own come after them, and nothing else does)
  // (and, between the two, the five about the helicopter that came down behind the fort)
  const HELI = 5, heli = world.wreck!;
  const wreck = wreckUnder(b), end = data.lootPoints.findIndex((q: { building: string }) => q.building === 'castle'), last = data.lootPoints.slice(end - HELI - wreck.spots.length, end - HELI), about = data.lootPoints.slice(end - HELI, end);
  assert.ok(end > 0 && data.lootPoints.slice(end).every((q: { building: string }) => q.building === 'castle'), "the fort's places for things are not the last there are");
  assert.ok(last.every((q: { building: string }) => q.building === 'wreck'), "the wreck's places for things are not the last before the fort's");
  for (const q of last) assert.ok(Math.abs(q.y - ground(q.x, q.z)) < 0.05 && LOOP.deck - q.y > 15, 'a place for a thing by the wreck is not on the ground of the cleft');
  assert.ok(heli && heli.x > MOUNTAIN.crest.hollow.brow && inPlay(heli.x, heli.z), 'no helicopter in the hollow behind the fort');
  for (const q of about) assert.ok(q.building === 'wreck' && q.tier === 4 && Math.abs(q.y - ground(q.x, q.z)) < 0.05 && Math.hypot(q.x - heli.x, q.z - heli.z) < 9, 'a place for a thing by the helicopter is not on the ground beside it');
});

ok('no two things that are searched are one thing to the server: every container has a number of its own', () => {
  // (2026-10-13: two cabinets of the hospital stood one over the other on two floors, and a container is told by
  // where it stands over the ground: they were one box. The upper one stands 0.4 m along its wall now.)
  const seen = new Map<string, { kind: string; y: number }>();
  for (const c of data.crates) {
    const was = seen.get(c.cid);
    assert.ok(!was, `${c.cid} is two containers: a ${was?.kind} at ${was?.y.toFixed(1)} m and a ${c.kind} at ${c.y.toFixed(1)} m`);
    seen.set(c.cid, c);
  }
});

ok('the fort is no trap for tags and no window on the end of the map: the line takes the mountain in, nobody starts by it, and its roof looks over no near edge', () => {
  const fort = world.castle!, gate = world.gatehouse!;
  // (a tag carried outside the line is void after fifteen seconds: the whole way up is inside it, and the ground round the fort)
  const road = world.roads[world.roads.length - 1].points;
  for (let i = 0; i < road.length; i += 3) assert.ok(inPlay(road[i], road[i + 2]), `the mountain road leaves the Zona at ${road[i].toFixed(0)}, ${road[i + 2].toFixed(0)}`);
  for (const [x, z] of world.paths.flat()) assert.ok(inPlay(x, z), `the foot path leaves the Zona at ${x}, ${z}`);
  assert.ok(inPlay(gate.x, gate.z) && inPlay(fort.x, fort.z));
  for (let a = 0; a < 16; a++) {
    const x = fort.x + Math.sin((a / 16) * 6.283) * 100, z = fort.z + Math.cos((a / 16) * 6.283) * 100;
    assert.ok(Math.abs(x) > WORLD_SIZE / 2 || inPlay(x, z), `a hundred metres from the fort is outside the Zona: ${x.toFixed(0)}, ${z.toFixed(0)}`);
  }
  // (the owner's rule for the bunker and the town holds here: nobody is set down near it)
  for (const s of world.spawns) assert.ok(Math.hypot(s.x - gate.x, s.z - gate.z) > 400 && Math.hypot(s.x - fort.x, s.z - fort.z) > 400, 'somebody starts by the fort');
  // (from the wall round the keep's roof, wherever an edge of the map is near, some ground on the way to it stands over the eye)
  const R = MOUNTAIN.rim, eye = fort.y + R.eye, half = WORLD_SIZE / 2;
  for (let b = 0; b < 720; b++) {
    const ux = Math.sin((b / 720) * 6.283), uz = -Math.cos((b / 720) * 6.283);
    let top = -Infinity, s = 4;
    for (; s < R.near - 30; s += 2) {
      const x = fort.x + ux * s, z = fort.z + uz * s;
      if (Math.abs(x) > half - 1 || Math.abs(z) > half - 1) break;
      top = Math.max(top, heightAt(world.heights, x, z));
    }
    if (s < R.near - 30) assert.ok(top > eye + 1, `from the keep's roof the map ends in sight on bearing ${b / 2}: the ground stands no higher than ${top.toFixed(1)} m against an eye at ${eye.toFixed(1)}`);
  }
});

console.log(`\n${n} checks passed`);
