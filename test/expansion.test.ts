// The map's first expansion (EXPANSION in src/world/worldgen.ts): that the map as it was is
// still exactly there, and that what was added can be walked into and stands up.
// `npx tsx test/expansion.test.ts`.

import assert from 'node:assert/strict';
import * as WG from '../src/world/worldgen';
const { ARMY_CAMP, CELL, KAMENKA, LOOP, MOUNTAIN, OUTLYING, PASS, PLAY_FIRST, TOWN, TRADE_AT, catmullRom, kamenkaQ, loopFence, loopLine, worldWithoutMountain, EXPANSION: E, PLAY_AREAS, PLAY_RADIUS, generateWorld, heightAt, inPlay, playOutline, seenGround, slopeAt, BUILDING_FOOTPRINT } = WG;
/** the rounds the world was made by (PLAY_AREAS): the Zona's rule is the owner's drawing since 2026-10-18 (src/world/zona.ts), and these hold the world to the rounds */
const { inRounds } = WG;
// (this test is of the map as it was, and runs on a tree from before the world grew west too, to take its figures again:
// where the bunker and the trading post were made, and the square's measures, said by such a tree's own names where it has them)
const WGX = WG as unknown as Record<string, unknown>;
const BUNKER_WAS = (WGX.BUNKER_WAS ?? WG.BUNKER_AT) as { x: number; z: number }, TRADE_WAS = (WGX.TRADE_WAS ?? WG.TRADE_AT) as { x: number; z: number };
const SQUARE_HALF = (WGX.SQUARE_HALF ?? 768) as number, SQUARE_RES = (WGX.SQUARE_RES ?? 769) as number, WORLD_NX = (WGX.WORLD_NX ?? 769) as number;
const WORLD_X0 = (WGX.WORLD_X0 ?? -768) as number, WORLD_Z0 = (WGX.WORLD_Z0 ?? -768) as number;
import { buildWorldData } from '../server/world';
import { TOWN_PLOT } from '../src/world/buildings';
import { GAS, gasDepth, gasZone } from '../src/sim/gas';
import { INFECTED, IN_CAVES, WEST_HOMES, openGround } from '../src/sim/infected';
import { deckWidth, onBridge, spanOf, wreckUnder } from '../src/sim/bridge';
import { CASTLE, CASTLE_SCALE, UNDER, castleAt, castleFoot, castleHomes, castleLocal, castleLoose, castleOpen, castleUnder, hatchLine, looseLocal } from '../src/sim/castle';
import { castleShapeIn } from '../src/world/castle-shape';

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
import { HUNTING_TOWERS, WATCHTOWERS } from '../src/sim/watchtowers';
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
// (lootHash taken again 2026-10-14: the white shelves of the sheds, shops, clinics and barracks were stood clear of
// their walls (85b9505), and the 62 old places on them moved with them, by 12 cm at most; none renumbered, nothing
// else of the old map moved: was 760462293)
const WAS = { cells: 124509, heights: 3974542425, buildings: 72, away: 46, buildingsHash: 816271812, lastId: 'tower_71', spawns: 2697513077, trees: 5987, treesHash: 3736410845, lootPoints: 675, lootAway: 371, lootHash: 2120685143, jeeps: 5, jeepsAway: 1, jeepsHash: 2828878713, fires: 6 };
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
/**
 * The fort's place on the valley's east rim (2026-10-13: it was moved there off the mountain; MOUNTAIN.castle in the
 * generator): the corner of the old map its yard, the feet of its walls, the last of its cart track, two of its
 * hamlet's houses, the foot path under its valley wall and the wreck at that path's end stand on. Fenced off
 * before any of it was built: the figures in WAS were taken with this fence up, off the map as it was before.
 * (As far as it reaches, measured: ground moved from x 464 to the old map's edge and z -442 to -270; eight metres
 * and more are allowed beyond, and to the west the bluff as far as the wreck, where only trees were taken away.)
 */
const FORT_FENCE = { x0: 438, z0: -452, z1: -262 };

const world = generateWorld();
/** the map as it was first made: 513 samples a side, 1024 m, in the middle of whatever the grid is now */
const OLD_RES = 513, OLD_HALF = 512, OFF = (SQUARE_RES - OLD_RES) / 2;
/** a sample of the square (the map until 2026-10-16, which is still made first and whole) in the world's net: (ix, iz) from the square's own corner */
const sq = (ix: number, iz: number) => (iz + (-SQUARE_HALF - WORLD_Z0) / CELL) * WORLD_NX + ix + (-SQUARE_HALF - WORLD_X0) / CELL;
const oldGround = (keep: (x: number, z: number) => boolean) => {
  const hs: number[] = [];
  for (let iz = 0; iz < OLD_RES; iz++) for (let ix = 0; ix < OLD_RES; ix++) if (keep(-OLD_HALF + ix * CELL, -OLD_HALF + iz * CELL)) hs.push(world.heights[sq(ix + OFF, iz + OFF)]);
  return hs;
};
const inOld = (x: number, z: number) => Math.abs(x) <= OLD_HALF && Math.abs(z) <= OLD_HALF;
const data = buildWorldData(process.cwd());
const half = SQUARE_HALF;
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
  if (Math.hypot(x - TRADE_WAS.x, z - TRADE_WAS.z) < 78) return true;
  // (and the clearing the army's camp was pitched in, 2026-10-10: 78 m round it, as round the trading post)
  if (Math.hypot(x - ARMY_CAMP.x, z - ARMY_CAMP.z) < 78) return true;
  // (and where the long hut stands behind the depot's barracks: 24 m round it)
  if (Math.hypot(x - HUT_AT.x, z - HUT_AT.z) < 24) return true;
  // (and where one of each of the downloaded buildings was stood in the village, 2026-10-10: 24 m round each)
  if (IN_VILLAGE.some((q) => Math.hypot(x - q.x, z - q.z) < 24)) return true;
  if (SECOND.some((q) => Math.hypot(x - q.x, z - q.z) < 30)) return true;
  // (and the ground each watchtower and hunting tower was levelled on, 2026-10-19: 14 m round each. Compared cell by cell
  // with the map before them, every cell that moved was within 10.2 m of one, and nothing else had)
  if ([...WATCHTOWERS, ...HUNTING_TOWERS].some((t) => Math.hypot(x - t.x, z - t.z) < 14)) return true;
  // (and Kamenka's valley, 2026-10-10: its rim stands on the old map's ground west and north of the town)
  if (kamenkaQ(x, z) < KAMENKA.foot + 0.1) return true;
  // (and the bunker's hollow, on the far side of the map; and, since 2026-10-13, the hillside behind it, which was
  // cut back to a slope somebody can walk: "generally smooth out the landscape around the bunker a little bit")
  if (Math.hypot(x - BUNKER_WAS.x, z - BUNKER_WAS.z) < BUNKER_FENCE) return true;
  // (and the ring of hills west of the valley, opened onto the green land of the west, 2026-10-16: plan v2, see
  // src/world/worldgen/opening.ts; the works kept in its cirque)
  if (x < -380 && z > -620 && z < 560 && Math.hypot(x - E.x, z - E.z) > E.floor + E.wall + 10) return true;
  // (and the fort's place on the rim)
  if (x >= FORT_FENCE.x0 && z >= FORT_FENCE.z0 && z <= FORT_FENCE.z1) return true;
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
const added = world.buildings.slice(WAS.buildings).filter((b) => !['hut', 'townhouse', 'shanty', 'tent'].includes(b.type) && !SECOND.some((q) => Math.hypot(b.x - q.x, b.z - q.z) < 3) && Math.hypot(b.x - TRADE_AT.x, b.z - TRADE_AT.z) > 78 && Math.hypot(b.x - ARMY_CAMP.x, b.z - ARMY_CAMP.z) > 78 && inOld(b.x, b.z) && !inVillage(b.x, b.z) && !/^(watchtower|hunting)_/.test(b.id));

// To take the old map's figures again after fencing off more ground (do it BEFORE building there): FIGURES=1 npx tsx test/expansion.test.ts
// (west of x 0 the small props were thinned, plan v2 of 2026-10-16, and a car looking for a clear verge may find one
// nearer its stretch's middle than it could: those east of it are where they were)
const thinned = (x: number) => x < 0;
if (process.env.FIGURES) {
  const hs = oldGround((x, z) => !touched(x, z));
  const trees = world.trees.filter((t) => inOld(t.x, t.z) && !touched(t.x, t.z));
  const oldB = world.buildings.slice(0, WAS.buildings).filter((b) => !inVillage(b.x, b.z)), oldP = data.lootPoints.slice(0, WAS.lootPoints).filter((p) => !inVillage(p.x, p.z));
  const oldJ = data.jeeps.slice(0, WAS.jeeps).filter((j: { x: number; z: number }) => !inVillage(j.x, j.z) && !thinned(j.x));
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
  // (and the starts handed out are on the far west beach since 2026-10-18, "move all player spawns to the far west coast
  // like DAYZ does": inside the barrier, on dry ground, down the whole coast, none of them the ring's)
  assert.ok(world.spawns.length >= 16, `${world.spawns.length} starts on the coast`);
  for (const sp of world.spawns) {
    assert.ok(!world.spawnRing.includes(sp) && sp.x > WG.PLAN.barrier && sp.x < WG.PLAN.barrier + 100, `a start off the west beach at ${sp.x.toFixed(0)}, ${sp.z.toFixed(0)}`);
    assert.ok(WG.heightAt(world.heights, sp.x, sp.z) > WG.SEA_LEVEL + 0.5, `a start in the sea at ${sp.x.toFixed(0)}, ${sp.z.toFixed(0)}`);
  }
  assert.ok(Math.min(...world.spawns.map((q) => q.z)) < -500 && Math.max(...world.spawns.map((q) => q.z)) > 500, 'the starts are not down the whole coast');
  const trees = world.trees.filter((t) => inOld(t.x, t.z) && !touched(t.x, t.z));
  assert.equal(trees.length, WAS.trees);
  assert.equal(hash(trees.flatMap((t) => [t.x, t.y, t.z])), WAS.treesHash, 'a tree away from the works has moved');
  // (what is kept between restarts goes by a loot point's number: the old ones are the first, in their old order)
  // (the village's moved with their buildings, each keeping its number: the first of all are still the old ones,
  // and those away from the village are where they were)
  const points = data.lootPoints.slice(0, WAS.lootPoints).filter((p) => !inVillage(p.x, p.z));
  assert.equal(points.length, WAS.lootAway, 'an old loot point has come into the village or left it');
  assert.equal(hash(points.flatMap((p) => [p.x, p.y, p.z])), WAS.lootHash, 'an old loot point away from the village has moved or been renumbered');
  // (2026-10-11: more cars stand where the map had none, found after all the others; 2026-10-19 the east's halved, three
  // by the road and two at the edge (WAS.jeeps) and two more, "remove maybe 50% of the spawns from the east")
  assert.equal(data.jeeps.length, WAS.jeeps + JEEP.far);
  // (those that do not stand in the village: the one or two that do stand where there is room for them now)
  const cars = data.jeeps.slice(0, WAS.jeeps).filter((j: { x: number; z: number }) => !inVillage(j.x, j.z) && !thinned(j.x));
  assert.equal(cars.length, WAS.jeepsAway);
  assert.equal(hash(cars.flatMap((j: { x: number; z: number }) => [j.x, j.z])), WAS.jeepsHash);
  // (the old six, and one each at the three places built in the east country)
  // (and one where the lane crosses in the army's camp)
  // (and two at the fort on the mountain, 2026-10-13: one in its keep, one in a ruined house on the way to it)
  // (on today's map: the west's towns and Kalat have fireplaces of their own, plan v5)
  assert.equal(data.fires.filter((f: { x: number }) => f.x > -SQUARE_HALF).length, WAS.fires + 4 + 2);
});

ok('it lies outside the ring the map used to end at, inside the ground there is, and the two are one place to play in', () => {
  assert.ok(Math.hypot(E.x, E.z) - E.floor > PLAY_RADIUS, 'its floor reaches into the old map');
  const R = E.floor + E.wall;
  assert.ok(Math.abs(E.x) + R < half && Math.abs(E.z) + R < half, 'it runs off the edge of the ground');
  // (the valley, the works, the bunker; and since, the town in the east and the round over the road to it: the five
  // there were are the first five still, and the rounds strung along the loop come after them)
  assert.equal(PLAY_FIRST, 5);
  assert.deepEqual(PLAY_AREAS.slice(0, PLAY_FIRST).map((a) => [a.x, a.z]), [[0, 0], [E.x, E.z], [BUNKER_WAS.x, BUNKER_WAS.z], [TOWN.gate.x, TOWN.gate.z], [TOWN.x, TOWN.z]]);
  assert.deepEqual([PLAY_AREAS[0].r, PLAY_AREAS[1].r, PLAY_AREAS[3].r, PLAY_AREAS[4].r], [PLAY_RADIUS, E.floor + E.wall, TOWN.gate.r, TOWN.r]);
  assert.ok(PLAY_AREAS.length > PLAY_FIRST, 'the Zona has not grown along the loop');
  // (the rounds the world was made by: the Zona's rule is the owner's drawing since 2026-10-18, src/world/zona.ts)
  assert.ok(inRounds(0, 0) && inRounds(E.x, E.z) && inRounds(camp.x, camp.z) && inRounds(BUNKER_WAS.x, BUNKER_WAS.z));
  // (the corner across the valley from the works is not in them; the one across the road from it is, since
  // 2026-10-13: it lies inside the loop of the road, and everything inside the loop was the Zona's)
  assert.ok(!inRounds(E.x, -E.z) && !inRounds(E.x * 1.5, -E.z * 1.5), 'the north-west corner of the map is in the rounds');
  assert.ok(inRounds(-E.x, E.z), 'the ground inside the loop of the road is not in the rounds');
  void inPlay;
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
  // (and the basements under the works' buildings, since 2026-10-14: their places are the cellar's, under the gas)
  for (const p of under) assert.ok(added.some((b) => b.id === p.building) || (p.building === 'cellar' && Math.hypot(p.x - gas.x, p.z - gas.z) < gas.r), 'something marked as under the gas is not in the works');
});

ok('the infected keep to it too, and nowhere else has fewer for it', () => {
  const homes = data.homes as { x: number; z: number; n: number; r: number; inside?: unknown[] }[];
  const here = homes.find((h) => Math.hypot(h.x - E.x, h.z - E.z) < 1);
  assert.ok(here && here.n >= 4, 'none at the works');
  // (the fort's are its own, over and above the map's: as many as its own file says)
  const forts = castleHomes(world.castle!).reduce((a, h) => a + h.n, 0);
  // (and the west's, its own as the fort's are, 2026-10-19: about its places and in the pass's caves)
  const west = world.pois.reduce((a, q) => a + (WEST_HOMES[q.name]?.[0] ?? 0), 0) + IN_CAVES;
  assert.equal(homes.reduce((s, h) => s + h.n, 0), INFECTED.max + forts + west);
  // (the valley held thirty-three before there was a works, or a bunker with its own shut in it)
  // (the bunker's: the fort on the mountain has a dark of its own under its terrace, counted further down)
  const atFort = (h: { x: number; z: number }) => Math.hypot(h.x - MOUNTAIN.castle.x, h.z - MOUNTAIN.castle.z) < 160;
  // (nor the pass's caves', the west's own: one round home over all their places, IN_CAVES strong)
  const below = homes.filter((h) => h.inside && !atFort(h) && !(h.n === IN_CAVES && h.r === 400));
  assert.ok(below.length === 1 && below[0].n >= 4 && below[0].inside!.length >= below[0].n * 2, 'none in the bunker, or nowhere for them to stand');
  // (and those that walk the ground over it)
  const over = homes.filter((h) => !h.inside && Math.hypot(h.x - below[0].x, h.z - below[0].z) < 1);
  assert.ok(over.length === 1 && over[0].n >= 6, 'none over the bunker');
  // (and the fifteen of the east country since: ten in the town, two at the squat, three at the camp; and, since
  // 2026-10-13, the fifteen the outlying places of the old valley were owed and had never had: see INFECTED.max)
  assert.equal(INFECTED.max - here!.n - below[0].n - over[0].n, 33 + 15 + 15);
  // (and the fort's own since: about its ruined village and in the dark under its terrace)
  assert.ok(forts >= 8 && homes.filter(atFort).reduce((a, h) => a + h.n, 0) === forts, 'the fort has not its own');
  // (the bunker's, in and over it, are its own wherever it stands: since plan v2, 2026-10-16, in the pines of the west)
  // (and not the west's, beyond the square's west edge: see WEST_HOMES)
  const east = homes.filter((h) => (Math.abs(h.x) > 512 || Math.abs(h.z) > 512) && h.x > -768 && !atFort(h) && Math.hypot(h.x - below[0].x, h.z - below[0].z) > 1);
  assert.equal(east.reduce((a, h) => a + h.n, 0), 15, 'the east country has not its fifteen');
});

ok('the long huts stand where they were meant to: beside the trading post, behind the depot, and on the track up to the works', () => {
  // (three on the old map, apart from the one in the village; the town's and the camp's are the east country's, below)
  // (the trading post's went with it, plan v2 of 2026-10-16, to the main road west)
  const huts = world.buildings.filter((b) => b.type === 'hut' && (inOld(b.x, b.z) || Math.hypot(b.x - TRADE_AT.x, b.z - TRADE_AT.z) < 60) && !inVillage(b.x, b.z));
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
  // (on the square: the trading post's went west by the main road, and the west's towns are their own, plan v5)
  const built = world.buildings.filter((b) => !inOld(b.x, b.z) && b.x > -half && Math.hypot(b.x - TRADE_AT.x, b.z - TRADE_AT.z) > 60);
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
  // (and since plan v5, 2026-10-16, the west's: its main road and three branches; and since 2026-10-18 the desert's six,
  // to Peski, Karavan, Blokpost and Bereg, round Kalat's south and on from Peski)
  assert.equal(world.roads.length, 5 + 4 + 4 + 6);
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
  // (on the square: the woods of the west, past it since 2026-10-16, are west.test.ts's)
  const planted = world.trees.filter((t) => !inOld(t.x, t.z) && t.x >= -half);
  assert.ok(planted.length > 5000 && planted.length < 15000, `${planted.length} trees out there`);
  for (const t of planted) {
    assert.ok(!onRoad(t.x, t.z, 5), 'a tree stands in the new road');
    // (the ground as it is SEEN: over the fort's passage that is not the ground as it is let down under it, and a fir by the hatch stands on what is seen)
    assert.ok(Math.abs(t.y - heightAt(world.surface, t.x, t.z)) < 0.06, 'a tree is off the ground');
  }
  // the Zona: the town is in it, joined to the valley over the road; the two far places are not
  assert.ok(inRounds(town.x, town.z));
  for (let i = 0; i < world.road.points.length / 3; i++) if (world.road.points[i * 3] > 0) assert.ok(inRounds(world.road.points[i * 3], world.road.points[i * 3 + 2]), 'the road east leaves the Zona before the town');
  for (let i = 0; i < n; i++) if (Math.hypot(p[i * 3] - town.x, p[i * 3 + 2] - town.z) < 100 || p[i * 3 + 2] < town.z) assert.ok(inRounds(p[i * 3], p[i * 3 + 2]), 'the road to the town leaves the Zona on the way');
  for (const o of OUTLYING) assert.ok(!inRounds(o.x, o.z), `${o.name} is inside the Zona`);
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
    assert.ok(inRounds(x, z), `the new road leaves the Zona at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    for (let a = 0; a < 6.28; a += 0.785) assert.ok(inRounds(x + Math.cos(a) * 30, z + Math.sin(a) * 30), `there are not thirty metres of the Zona beside the new road at ${x.toFixed(0)}, ${z.toFixed(0)}`);
  }
  for (const o of OUTLYING) assert.ok(!inRounds(o.x, o.z, -LOOP.clear + 6), `${o.name} is in the Zona, or all but`);
  {
    const S = 8, M = Math.floor((2 * SQUARE_HALF) / S) + 1, out = new Uint8Array(M * M), stack: number[] = [];
    const inZona = (k: number) => inRounds(-half + (k % M) * S, -half + Math.floor(k / M) * S);
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
  // The mountain road: off the pass by Kamenka's first door, never near the bunker. It ends where the cart track to
  // the fort begins, and no gatehouse stands across its end (the one there was stood under the mountain the fort has left)
  const hp = hill.points;
  assert.ok(passLine.some(([x, z]) => Math.hypot(x - hp[0], z - hp[2]) < 3.5), 'the mountain road does not leave the pass road');
  for (let i = 0; i < hp.length; i += 3) assert.ok(Math.hypot(hp[i] - BUNKER_WAS.x, hp[i + 2] - BUNKER_WAS.z) > 250, 'the mountain road comes within 250 m of the bunker');
  assert.equal(world.gatehouse, null, 'a gatehouse stands at the end of the mountain road again');
  // THE WAYS TO THE FORT, each saying what it is (2026-10-13: "i fear youve overcomplicated the path and surrounding
  // geography of the castle"; 2026-10-14: "i simply want it roatated so the draw bdige faces the road"): ONE cart
  // track, driven, from the road's end up the shoulder to the trampled place before the gate; ONE lane, walked, off
  // it to the three ruined houses that lie off the way. And no other.
  assert.deepEqual(world.paths.map((p) => p.driven), [true, false], 'the ways to the fort are not one cart track and one lane');
  const track = world.paths[0].line, way = world.paths[1].line, fort = world.castle!, F = MOUNTAIN.castle;
  assert.ok(Math.hypot(track[0][0] - hp[hp.length - 3], track[0][1] - hp[hp.length - 1]) < 0.01, "the cart track does not begin at the road's end");
  // The fort: where the map says, its TERRACE at the height the map says (it stands on its terrace, as it was
  // first laid out, and no yard is levelled for it), named on the map; and the cart track ends before its gate
  assert.ok(fort && fort.x === F.x && fort.z === F.z && fort.y === F.terrace && fort.rot === F.rot && fort.rock === false, 'no fort where the track leads');
  assert.ok(world.pois.some((q) => q.name === F.name && q.x === fort.x && q.z === fort.z), 'the fort is not named on the map');
  // (the ramp's foot, in the fort's own measure: so far out from the gate's wall, in the middle of the gate's width)
  const rampFoot = CASTLE.hx + CASTLE.parapet.thick / 2 + Math.sqrt(CASTLE.ramp.len ** 2 - CASTLE.ramp.drop ** 2), gateZ = (CASTLE.gate.z0 + CASTLE.gate.z1) / 2;
  const [ex, ez] = castleLocal(fort, track[track.length - 1][0], 0, track[track.length - 1][1]);
  assert.ok(ex - rampFoot > 2 && ex - rampFoot < 6 && Math.abs(ez - gateZ) < 0.5, `the cart track ends at ${ex.toFixed(1)}, ${ez.toFixed(1)} of the fort's own measure: not on the ramp's line, a few paces beyond its foot`);
  // ITS DRAWBRIDGE FACES THE ROAD: the way its gate looks is within ten degrees of the line from the gate to the
  // road's end and to the road forty and eighty metres before it, and within twelve of the line down the last
  // sixty metres of the track (it looked forty-six to forty-nine degrees off the road, and away from the track)
  {
    const gate = castleAt(fort, CASTLE.hx, gateZ), looks = [Math.cos(fort.rot), -Math.sin(fort.rot)];
    const off = (x: number, z: number) => (Math.acos(((x - gate[0]) * looks[0] + (z - gate[2]) * looks[1]) / Math.hypot(x - gate[0], z - gate[2])) * 180) / Math.PI;
    for (const back of [0, 10, 20]) assert.ok(off(hp[hp.length - 3 - back * 3], hp[hp.length - 1 - back * 3]) < 10, `the gate looks ${off(hp[hp.length - 3 - back * 3], hp[hp.length - 1 - back * 3]).toFixed(0)} degrees off the road, ${back * 4} m before its end`);
    const up = catmullRom(track, 1);
    for (const k of [15, 30, 45, 60]) assert.ok(off(up[up.length - 1 - k][0], up[up.length - 1 - k][1]) < 12, `the gate looks ${off(up[up.length - 1 - k][0], up[up.length - 1 - k][1]).toFixed(0)} degrees off the track, ${k} m before its end`);
  }
  // (the track comes to the gate and to nothing else of the fort: whatever of it is within fifteen metres of the
  // fort's foot is out beyond the ramp's foot; the lane leaves it on the rise and ends between two of the houses,
  // where the track once ended; and the track ends in a trampled place, with the trodden apron before the ramp)
  {
    const end = track[track.length - 1], homes = fort.loose!.filter((l) => l.kind === 'house'), last = way[way.length - 1];
    assert.ok(homes.filter((h) => Math.hypot(h.x - last[0], h.z - last[1]) < 12).length === 2, 'the lane does not end between two of the houses');
    for (const [x, z] of catmullRom(track, 2)) if (castleFoot(fort, x, z) < 15) assert.ok(castleLocal(fort, x, 0, z)[0] > rampFoot, `the cart track comes within ${castleFoot(fort, x, z).toFixed(0)} m of the fort's walls at ${x.toFixed(0)}, ${z.toFixed(0)}, and not before its gate`);
    for (const p of world.paths.slice(1)) assert.ok(track.some((q) => Math.hypot(p.line[0][0] - q[0], p.line[0][1] - q[1]) < 0.01), 'a walked way does not begin on the track');
    assert.ok(world.worn.some((q) => q.driven && q.line.length === 1 && Math.hypot(q.line[0][0] - end[0], q.line[0][1] - end[1]) < 4), "no turning place at the track's end");
    assert.ok(world.worn.some((q) => !q.driven && q.line.length === 1 && castleFoot(fort, q.line[0][0], q.line[0][1]) <= 0), "no trodden apron before the ramp's foot");
    assert.ok(world.worn.some((q) => !q.driven && q.line.length === 1 && Math.hypot(q.line[0][0] - last[0], q.line[0][1] - last[1]) < 1), "no trodden yard at the lane's end");
  }
  // (and the ground there is the height the ramp's boards come down to, within a step, all across them)
  for (const dz of [-1, 0, 1]) {
    const [rx, ry, rz] = castleAt(fort, rampFoot, gateZ + dz, -CASTLE.ramp.drop);
    assert.ok(Math.abs(heightAt(world.surface, rx, rz) - ry) < 0.35, `the ramp's foot is ${(ry - heightAt(world.surface, rx, rz)).toFixed(2)} m over the ground`);
  }
  /** how far outside the fort's foot a place is (nothing or less: under a wall, a tower, the ramp, the rubble or the back door's stair) */
  const footOf = (x: number, z: number) => castleFoot(fort, x, z);
  const line = catmullRom(track, 1), offTrack = (x: number, z: number) => Math.min(...line.map((q) => Math.hypot(q[0] - x, q[1] - z)));
  // nothing grows or lies on the track, in the yard or against the walls
  for (const list of [world.trees, world.rocks, world.props]) for (const t of list) {
    assert.ok(footOf(t.x, t.z) > 2, `a ${t.kind} stands in the fort or against its wall at ${t.x.toFixed(0)}, ${t.z.toFixed(0)}`);
    if (Math.hypot(t.x - fort.x, t.z - fort.z) < 260) assert.ok(offTrack(t.x, t.z) > MOUNTAIN.track.bed[1] + 0.9, `a ${t.kind} stands on the track at ${t.x.toFixed(0)}, ${t.z.toFixed(0)}`);
  }
  // NO PAD (the owner, 2026-10-13: "i dont like how the terraain and building are floating on a raise \"pad\""),
  // and the mountain the fort has left is the mountain that was. Against the map made without the mountain road's
  // step (the ground as every step before it leaves it):
  const base = worldWithoutMountain();
  // (the old crest, and the rim raised behind it along the map's north edge: every height the ground's own again)
  for (let iz = 0; iz < SQUARE_RES; iz++) for (let ix = 0; ix < SQUARE_RES; ix++) {
    const x = -half + ix * CELL, z = -half + iz * CELL, i = sq(ix, iz);
    // (from twenty paces east of where the track goes round behind the fort, under the hill's foot: the fort stands 40 m further east than it did, and the line was at 560)
    if ((x >= 584 && z <= -400) || z <= -700) assert.ok(world.heights[i] === base.heights[i] && world.surface[i] === base.surface[i], `something of the old crest is left in the ground at ${x}, ${z}`);
  }
  // (About the fort, the seen ground against the ground that was. THE SHOULDER (MOUNTAIN.shoulder; the owner's
  // rule is no PAD: nothing that reads as a platform the fort was stood on). What is moved is the hill's foot run
  // out before the gate, with the way in on its top, and nothing else:
  //   - nowhere further from the way's line than the shoulder reaches, and nothing at all behind the fort's
  //     middle: no ring round its walls, and its back, its breach side and its valley side stand on the bench as
  //     the bench is;
  //   - only ever raised: off the track's own bed and banks nothing is let down by more than a hand;
  //   - no level top: of everything raised by half a metre and more, under sixty square metres lie level (the
  //     trampled place before the ramp's foot), and of the rest every spot slopes;
  //   - its sides are a hillside's and no bank's: nowhere over thirty-seven degrees, three metres and more from the fort's foot.)
  {
    const SH = MOUNTAIN.shoulder;
    let level = 0, raised = 0, most = 0;
    for (let iz = 1; iz < SQUARE_RES - 1; iz++) for (let ix = 1; ix < SQUARE_RES - 1; ix++) {
      const x = -half + ix * CELL, z = -half + iz * CELL;
      if (Math.hypot(x - fort.x, z - fort.z) > 200 || z > -226) continue;
      const i = sq(ix, iz), d = world.surface[i] - base.surface[i], out = footOf(x, z), [lx] = castleLocal(fort, x, 0, z);
      if (!d) continue;
      const off = offTrack(x, z);
      assert.ok(off <= SH.reach + 2, `the ground is moved ${off.toFixed(0)} m from the way in, at ${x}, ${z}`);
      assert.ok(lx > 0, `the ground is moved behind the fort's middle, at ${x}, ${z}: a ring round its walls`);
      if (off > 8) assert.ok(d > -0.3, `the ground is let down by ${(-d).toFixed(1)} m at ${x}, ${z}, away from the track's bed`);
      assert.ok(d > -F.foot - 0.01, `the ground is let down by ${(-d).toFixed(1)} m at ${x}, ${z}`);
      if (d < 0.5) continue;
      raised++;
      most = Math.max(most, d);
      const slope = slopeAt(world.surface, x, z);
      if (slope < 0.04) level++;
      if (out > 3) assert.ok(slope < Math.tan((37 * Math.PI) / 180), `the made ground stands at ${((Math.atan(slope) * 180) / Math.PI).toFixed(0)} degrees at ${x}, ${z}: a bank, not a hillside`);
    }
    assert.ok(raised > 400 && most > 5 && most < 10, `the shoulder before the gate: ${raised} spots raised, by ${most.toFixed(1)} m at the most`);
    assert.ok(level * CELL * CELL < 60, `${level * CELL * CELL} m2 of the made ground lie level: a pad`);
  }
  // (the track: its bed is the ground or over it, never dug in by more than a metre and a half; nowhere steeper
  // than one in six over four metres of it; and it comes to the gate some 170 m from the road's end)
  {
    const run: number[] = [0];
    for (let k = 1; k < line.length; k++) run.push(run[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
    const seen = (x: number, z: number) => heightAt(world.surface, x, z);
    for (let k = 0; k < line.length; k++) {
      const [x, z] = line[k], off = seen(x, z) - heightAt(base.surface, x, z);
      if (run[k] > 4) assert.ok(off > -1.5, `the track's bed is dug ${(-off).toFixed(2)} m into the ground that was, ${run[k].toFixed(0)} m along it`);
      if (run[k] > 4 && k + 4 < line.length) assert.ok(Math.abs(seen(line[k + 4][0], line[k + 4][1]) - seen(x, z)) / (run[k + 4] - run[k]) < 1 / 6 + 0.006, `the track is steeper than one in six, ${run[k].toFixed(0)} m along it`);
    }
    assert.ok(run[run.length - 1] > 150 && run[run.length - 1] < 190, `the cart track is ${run[run.length - 1].toFixed(0)} m long: it ends before the gate, some 170 m from the road's end`);
  }
  // THE LANE IS PAINT AND WEAR: no earth is moved for it. Along it the ground is the ground that was, but where it
  // leaves the track, on the shoulder; it can be walked both ways (nothing a body is slowed on: under 33 degrees
  // over any four metres of it); and nothing grows on it. And the hatch, which is the fort's secret way, is wide of
  // every way there is: eight metres and more from the lane, twelve and more from the track, the firs between.
  {
    const hatch = fort.loose!.find((l) => l.kind === 'hatch')!;
    assert.ok(offTrack(hatch.x, hatch.z) > 12, `the cart track comes within ${offTrack(hatch.x, hatch.z).toFixed(1)} m of the hatch`);
    for (const [name, p] of [['the lane', world.paths[1]]] as const) {
      const pts = catmullRom(p.line, 1), run: number[] = [0];
      for (let k = 1; k < pts.length; k++) run.push(run[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      for (let k = 0; k < pts.length; k++) {
        const [x, z] = pts[k];
        // (where it comes off the track it comes down the shoulder's own side, which is thirty metres at the most)
        if (offTrack(x, z) > 32) assert.equal(heightAt(world.surface, x, z), heightAt(base.surface, x, z), `earth is moved under ${name} at ${x.toFixed(0)}, ${z.toFixed(0)}`);
        let j = k;
        while (j < pts.length - 1 && run[j] - run[k] < 4) j++;
        if (run[j] - run[k] >= 3.9) assert.ok(Math.abs(heightAt(world.surface, pts[j][0], pts[j][1]) - heightAt(world.surface, x, z)) / (run[j] - run[k]) < Math.tan((33 * Math.PI) / 180), `${name} is too steep to walk both ways, ${run[k].toFixed(0)} m along it`);
        for (const t of [...world.trees, ...world.rocks]) assert.ok(Math.hypot(t.x - x, t.z - z) > 1.1, `a ${t.kind} stands on ${name} at ${x.toFixed(0)}, ${z.toFixed(0)}`);
        assert.ok(Math.hypot(hatch.x - x, hatch.z - z) > 8, `${name} comes within ${Math.hypot(hatch.x - x, hatch.z - z).toFixed(1)} m of the hatch`);
      }
      assert.ok(run[run.length - 1] > 60 && run[run.length - 1] < 90, `the lane is ${run[run.length - 1].toFixed(0)} m long`);
    }
  }
  // A FIELD OF FIRE under the valley-side walls (MOUNTAIN.felled): the wood is felled there, but for a few trees left
  // standing alone; stumps and dead trunks are what is left of it; and the firs that hide the hatch still stand.
  {
    const W = MOUNTAIN.felled, l = Math.hypot(W.to[0], W.to[1]);
    const inside = (t: { x: number; z: number }) => {
      const s = ((t.x - W.from[0]) * W.to[0] + (t.z - W.from[1]) * W.to[1]) / l, side = Math.abs((-(t.x - W.from[0]) * W.to[1] + (t.z - W.from[1]) * W.to[0]) / l);
      return s > W.ragged && s < W.long - W.ragged && side < W.half[0] + ((W.half[1] - W.half[0]) * s) / 90 - W.ragged;
    };
    const stand = world.trees.filter((t) => !t.kind.startsWith('bush') && inside(t)).length, stumps = world.props.filter((t) => (t.kind === 'tree_stump_01' || t.kind === 'dead_tree_trunk') && inside(t)).length;
    assert.ok(stand <= 6, `${stand} trees stand in the field of fire under the fort's valley walls`);
    assert.ok(stumps >= 15, `only ${stumps} stumps and dead trunks are left of the wood that was felled`);
    for (const [x, z] of F.firs) assert.ok(world.trees.some((t) => t.x === x && t.z === z), 'a fir that hides the hatch is gone');
  }
  // THE DRY-STONE WALLS are walls and not battlements: where one length follows another, its foot and its top begin
  // where the last ended (no step in either: within three fingers); each lies to the ground at both its ends; and
  // none stands across a way that is walked.
  {
    assert.ok(world.walls.length > 30, 'the dry-stone walls are gone');
    const ends = (w: (typeof world.walls)[number]) => {
      const ux = Math.cos(w.yaw), uz = -Math.sin(w.yaw), r = w.rise ?? 0, t = w.top ?? 0;
      return { a: [w.x - (ux * w.long) / 2, w.z - (uz * w.long) / 2], b: [w.x + (ux * w.long) / 2, w.z + (uz * w.long) / 2], footA: w.y - r / 2, footB: w.y + r / 2, topA: w.y - r / 2 + w.high - t / 2, topB: w.y + r / 2 + w.high + t / 2 };
    };
    world.walls.forEach((w, k) => {
      const e = ends(w), next = world.walls[k + 1], n = next && ends(next);
      for (const [q, foot] of [[e.a, e.footA], [e.b, e.footB]] as [number[], number][]) assert.ok(Math.abs(heightAt(world.surface, q[0], q[1]) - foot) < 0.03, `a dry-stone wall's foot is ${(foot - heightAt(world.surface, q[0], q[1])).toFixed(2)} m off the ground at ${q[0].toFixed(0)}, ${q[1].toFixed(0)}`);
      if (n && Math.hypot(n.a[0] - e.b[0], n.a[1] - e.b[1]) < 0.01) assert.ok(Math.abs(n.topA - e.topB) < 0.06 && Math.abs(n.footA - e.footB) < 0.03, `a dry-stone wall's top steps by ${(n.topA - e.topB).toFixed(2)} m at ${e.b[0].toFixed(0)}, ${e.b[1].toFixed(0)}`);
      for (const p of world.paths.slice(1)) for (const [x, z] of catmullRom(p.line, 1)) assert.ok(Math.hypot(w.x - x, w.z - z) > 1, `a dry-stone wall stands across a walked way at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    });
  }
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
  // (the last there were until the fort was built: the fort's own come after them, and nothing else does)
  // (and, between the two, the five about the helicopter that came down under the fort)
  const HELI = 5, heli = world.wreck!;
  const wreck = wreckUnder(b), ofFort = (q: { building: string }) => q.building === 'castle' || q.building === 'hamlet', end = data.lootPoints.findIndex(ofFort), last = data.lootPoints.slice(end - HELI - wreck.spots.length, end - HELI), about = data.lootPoints.slice(end - HELI, end);
  // (the fort's own, and its hamlet's before the gate, which are a place of their own to the map: 'hamlet')
  // (the basements' come after the fort's since 2026-10-14, the newest lot last: `cellar`; and Kalat's after all, plan v5: `ruins_`)
  // (and the watchtowers' and hunting towers' with the west's towns, 2026-10-19)
  assert.ok(end > 0 && data.lootPoints.slice(end).every((q) => ofFort(q) || q.building === 'cellar' || q.building.startsWith('ruins_') || TOWN_PLOT.test(q.building) || q.building.startsWith('cave_') || /^(watchtower|hunting)_/.test(q.building)), "the fort's places for things are not the last there are");
  const cellarsAt = data.lootPoints.findIndex((q) => q.building === 'cellar');
  assert.ok(cellarsAt > end && data.lootPoints.slice(cellarsAt).every((q) => q.building === 'cellar' || q.building.startsWith('ruins_') || TOWN_PLOT.test(q.building) || q.building.startsWith('cave_') || /^(watchtower|hunting)_/.test(q.building)), "something after the basements' places that is not theirs");
  assert.ok(last.every((q: { building: string }) => q.building === 'wreck'), "the wreck's places for things are not the last before the fort's");
  for (const q of last) assert.ok(Math.abs(q.y - ground(q.x, q.z)) < 0.05 && LOOP.deck - q.y > 15, 'a place for a thing by the wreck is not on the ground of the cleft');
  assert.ok(heli && inRounds(heli.x, heli.z, 15), 'no helicopter by the fort');
  {
    // (outside the walls, and in plain sight of the top of the back wall: from an eye there, no ground stands in the way of it)
    assert.ok(footOf(heli.x, heli.z) > 12 && footOf(heli.x, heli.z) < 60, 'the helicopter is not on the bench outside the walls');
    // (an eye on the terrace's walk behind the back wall's parapet: the terrace is the wall's top now, and the eye a man's height over it)
    const [wx, wy, wz] = castleAt(fort, -(CASTLE.hx - 0.6), CASTLE.hz * 0.4, 1.7 / CASTLE_SCALE);
    for (let t = 0.04; t < 0.97; t += 0.01) {
      const x = wx + (heli.x - wx) * t, z = wz + (heli.z - wz) * t;
      if (footOf(x, z) > 0) assert.ok(ground(x, z) < wy + (heli.y + 1.2 - wy) * t, `the ground at ${x.toFixed(0)}, ${z.toFixed(0)} hides the helicopter from the back wall's top`);
    }
    // (and a body can walk to it and back: the ground about it is no hillside, and nothing of the way from the wall's foot is steeper than one is walked both ways)
    for (let t = 0; t <= 1; t += 0.02) { const x = wx + (heli.x - wx) * t, z = wz + (heli.z - wz) * t; if (footOf(x, z) > 1) assert.ok(slopeAt(world.heights, x, z) < Math.tan((33 * Math.PI) / 180), `the way to the helicopter is a steep hillside at ${x.toFixed(0)}, ${z.toFixed(0)}`); }
    // (no foot path is drawn down the bluff: none there can be walked both ways. The two ways there are, are told above.)
    assert.equal(world.paths.length, 2, 'a path is drawn that is neither the cart track nor the foot path to the ramp');
  }
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

ok('the fort is no trap for tags and no window on the end of the map: the line takes it in with its track, its houses and the bluff under it, nobody starts by it, and its tower tops look over no near edge', () => {
  const fort = world.castle!;
  // (a tag carried outside the line is void after fifteen seconds: the whole way in is inside it, and the ground round the fort)
  const road = world.roads[world.roads.length - 1].points;
  for (let i = 0; i < road.length; i += 3) assert.ok(inRounds(road[i], road[i + 2]), `the mountain road leaves the Zona at ${road[i].toFixed(0)}, ${road[i + 2].toFixed(0)}`);
  for (const [x, z] of world.paths.flatMap((p) => p.line)) assert.ok(inRounds(x, z, 25), `a way to the fort leaves the Zona, or all but, at ${x}, ${z}`);
  assert.ok(inRounds(fort.x, fort.z) && inRounds(world.wreck!.x, world.wreck!.z, 15));
  for (let a = 0; a < 16; a++) {
    const x = fort.x + Math.sin((a / 16) * 6.283) * 100, z = fort.z + Math.cos((a / 16) * 6.283) * 100;
    assert.ok(inRounds(x, z), `a hundred metres from the fort is outside the Zona: ${x.toFixed(0)}, ${z.toFixed(0)}`);
  }
  // (the owner's rule for such places holds here: nobody is set down within 250 m of it)
  for (const s of world.spawns) assert.ok(Math.hypot(s.x - fort.x, s.z - fort.z) > 250, 'somebody starts by the fort');
  // (from the top of a tower, wherever an edge of the map is near, some ground on the way to it stands over the eye)
  const eye = fort.y + 13.5 * 1.2 + 2.3, near = 420, half = SQUARE_HALF;
  for (let b = 0; b < 720; b++) {
    const ux = Math.sin((b / 720) * 6.283), uz = -Math.cos((b / 720) * 6.283);
    let top = -Infinity, s = 4;
    for (; s < near - 30; s += 2) {
      const x = fort.x + ux * s, z = fort.z + uz * s;
      if (Math.abs(x) > half - 1 || Math.abs(z) > half - 1) break;
      top = Math.max(top, heightAt(world.heights, x, z));
    }
    if (s < near - 30) assert.ok(top > eye + 1, `from a tower's top the map ends in sight on bearing ${b / 2}: the ground stands no higher than ${top.toFixed(1)} m against an eye at ${eye.toFixed(1)}`);
  }
});

ok('over the fort\'s passage there is one ground: one sheet drawn at every spot, what stops a body exactly there, and no room under it that is no room of the plan', () => {
  // THE COUNT (the owner, 2026-10-13: "the ground also has overlapping textures and physics because of the tunnel
  // under ground"). The ground was let down along the passage and a blanket of earth laid over it by the fort, on
  // squares of the fort's own turned 35 degrees to the ground's: counted as here, 485 spots of 6081 had two sheets
  // drawn, 382 had a top that stops a body standing over the ground that is seen (by up to 10.2 m: a lid over a
  // trench), and under the lid at 189 spots there was half a metre and more of room (up to 6 m) that is no room of
  // the plan. Now the ground draws itself there (`seenGround`) and the fort stands solid earth under it.
  const fort = world.castle!, N = WORLD_NX, S = CASTLE_SCALE;
  const was = (x: number, z: number) => heightAt(world.surface, x, z), { heights: drawn, open } = seenGround(world);
  assert.ok(fort.lid && fort.lid.squares.length > 40 && open, 'the world tells the fort of no ground over its cuts');
  // (all of the fort is made, as the game makes it: the passage's own blocks are what is under the earth over it)
  const steps = castleShapeIn(fort, was);
  let step = steps.next();
  while (!step.done) step = steps.next();
  const shape = step.value, W = (x: number, y: number, z: number) => castleAt(fort, x, z, y);
  // (what the fort draws of the ground: three corners to each, in the world; and the earth it stands: its top, corner by corner, and how far down it goes)
  const E = shape.near.earth.pos, lids: number[][][] = [], tops: number[][][] = [], feet: number[] = [];
  for (let i = 0; i < E.length; i += 9) lids.push([W(E[i], E[i + 1], E[i + 2]), W(E[i + 3], E[i + 4], E[i + 5]), W(E[i + 6], E[i + 7], E[i + 8])]);
  for (const s of shape.solids) {
    if (s.t !== 'hull' || s.name !== 'hatch apron') continue;
    const n = s.pts.length / 6;
    assert.equal(s.surface, 'grass', 'the earth over the passage is not the ground to whoever treads on it');
    tops.push(Array.from({ length: n }, (_, k) => W(s.pts[k * 3], s.pts[k * 3 + 1], s.pts[k * 3 + 2])));
    feet.push(W(0, s.pts[n * 3 + 1], 0)[1]);
  }
  const blocks = shape.solids.filter((s): s is Extract<typeof s, { t: 'box' }> => s.t === 'box');
  const inBlock = (lx: number, ly: number, lz: number) => blocks.some((b) => {
    const v = [lx - b.c[0], ly - b.c[1], lz - b.c[2]], [qx, qy, qz, qw] = [-b.q[0], -b.q[1], -b.q[2], b.q[3]];
    const t = [2 * (qy * v[2] - qz * v[1]), 2 * (qz * v[0] - qx * v[2]), 2 * (qx * v[1] - qy * v[0])];
    const r = [v[0] + qw * t[0] + qy * t[2] - qz * t[1], v[1] + qw * t[1] + qz * t[0] - qx * t[2], v[2] + qw * t[2] + qx * t[1] - qy * t[0]];
    return Math.abs(r[0]) <= b.h[0] && Math.abs(r[1]) <= b.h[1] && Math.abs(r[2]) <= b.h[2];
  });
  /** how high a flat shape (its corners in order round it) is at a spot, or null where the spot is not over it */
  const over = (poly: number[][], x: number, z: number): number | null => {
    let sign = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length], t = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
      if (Math.abs(t) < 1e-9) continue;
      if (sign && Math.sign(t) !== sign) return null;
      sign = Math.sign(t);
    }
    const [a, b] = poly;
    for (let k = 2; k < poly.length; k++) {
      const c = poly[k], n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      if (Math.abs(n[1]) > 1e-9) return a[1] - (n[0] * (x - a[0]) + n[2] * (z - a[2])) / n[1];
    }
    return null;
  };
  const wells = castleOpen(fort), hatch = castleLoose(fort).find((l) => l.kind === 'hatch')!, L = hatchLine(looseLocal(fort, [hatch])[0], (was(hatch.x, hatch.z) - fort.y) / S);
  const way = [L.head, ...L.path].map((q) => castleAt(fort, q[0], q[2]));
  const offWay = (x: number, z: number) => {
    let best = Infinity;
    for (let k = 0; k + 1 < way.length; k++) {
      const ex = way[k + 1][0] - way[k][0], ez = way[k + 1][2] - way[k][2], t = Math.min(1, Math.max(0, ((x - way[k][0]) * ex + (z - way[k][2]) * ez) / (ex * ex + ez * ez)));
      best = Math.min(best, Math.hypot(x - way[k][0] - ex * t, z - way[k][2] - ez * t));
    }
    return best;
  };
  // on a net of one metre (set off from the ground's own, so that no spot lies on a seam) within 25 m of the fort's
  // foot, of the passage and of the hatch: outside the fort and off the open stairwell
  let spots = 0, covered = 0;
  const two: string[] = [], none: string[] = [], proud: string[] = [], unheld: string[] = [], room: string[] = [];
  for (let x = fort.x - 70.37; x < fort.x + 70; x += 1) for (let z = fort.z - 70.61; z < fort.z + 70; z += 1) {
    const foot = castleFoot(fort, x, z);
    if (foot <= 0 || (foot > 25 && offWay(x, z) > 25) || wells.some((w) => over(w.map(([wx, wz]) => [wx, 0, wz]), x, z) !== null)) continue;
    spots++;
    const at = `${x.toFixed(2)}, ${z.toFixed(2)}`, own = !open![Math.floor((z - WORLD_Z0) / CELL) * N + Math.floor((x - WORLD_X0) / CELL)];
    const laid = lids.map((t) => over(t, x, z)).filter((y): y is number => y !== null), sheets = (own ? 1 : 0) + laid.length;
    if (sheets > 1) two.push(at);
    if (sheets < 1) none.push(at);
    if (sheets !== 1) continue;
    // (what is seen there; and every top that stops a body there: the ground's own collider, which is `heights`, and the fort's earth)
    const seen = own ? heightAt(drawn, x, z) : laid[0], under = tops.map((t, i) => (over(t, x, z) !== null ? i : -1)).filter((i) => i >= 0);
    const stood = [heightAt(world.heights, x, z), ...under.map((i) => over(tops[i], x, z)!)];
    if (Math.max(...stood) > seen + 0.01) proud.push(`${at} (${(Math.max(...stood) - seen).toFixed(2)} m)`);
    if (!stood.some((y) => Math.abs(y - seen) <= 0.01)) unheld.push(at);
    if (!under.length) continue;
    covered++;
    // (under the foot of the earth, how far down before anything stops a body: the ground as it was let down, or a block of the fort's)
    const free = (px: number, pz: number) => {
      const held = tops.map((t, i) => (over(t, px, pz) !== null ? i : -1)).filter((i) => i >= 0);
      if (!held.length) return 0;
      const from = Math.min(...held.map((i) => feet[i])), cut = heightAt(world.heights, px, pz);
      let y = from - 0.02;
      for (; y > cut && y > from - 6; y -= 0.05) {
        const l = castleLocal(fort, px, y, pz);
        if (inBlock(l[0], l[2], l[1])) break;
      }
      return from - Math.max(y, cut);
    };
    // (ROOM IS WHAT A BODY COULD BE IN: free here and a hand's span to each side of here. The earth keeps a hand
    // clear of the backs of the passage's walls, 6 cm in the world, and that slot is no room: measured 2026-10-14 on
    // a net of a quarter of a metre, 2.4 m2 of it along 25 m of passage, which a net of one metre meets at two
    // spots or at none by where the hatch stands. It is the fort's own to close: see the fort's file, `ways`.)
    if (free(x, z) >= 0.5 && [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].every(([dx, dz]) => free(x + dx, z + dz) >= 0.5)) room.push(`${at} (${free(x, z).toFixed(2)} m)`);
  }
  assert.ok(spots > 5000 && covered > 150, `the count looked at ${spots} spots, ${covered} of them over the fort's earth`);
  assert.equal(two.length, 0, `two sheets of ground are drawn at ${two.length} spots: ${two.slice(0, 5).join(' | ')}`);
  assert.equal(none.length, 0, `no ground is drawn at ${none.length} spots: ${none.slice(0, 5).join(' | ')}`);
  assert.equal(proud.length, 0, `something stops a body over the ground that is seen at ${proud.length} spots: ${proud.slice(0, 5).join(' | ')}`);
  assert.equal(unheld.length, 0, `nothing stops a body where the ground is seen at ${unheld.length} spots: ${unheld.slice(0, 5).join(' | ')}`);
  assert.equal(room.length, 0, `there is room under the ground that is no room of the plan at ${room.length} spots: ${room.slice(0, 5).join(' | ')}`);
  // AND THE GROUND SHOWS IN NO PLACE TO BE. Where it is drawn as it was, over ground that was let down, it is drawn
  // outside the fort's stone or in it: never in a room of the lower levels (inside their walls' inner faces, over
  // the underside of their floor: of the stair's slot, in the slot), and never in the passage or on its stair.
  const U = UNDER;
  for (let x = fort.x - 45; x < fort.x + 45; x += 0.25) for (let z = fort.z - 45; z < fort.z + 45; z += 0.25) {
    if (open![Math.floor((z - WORLD_Z0) / CELL) * N + Math.floor((x - WORLD_X0) / CELL)] || Math.hypot(x - hatch.x, z - hatch.z) < 7) continue;
    const y = heightAt(drawn, x, z), [lx, lz, ly] = castleLocal(fort, x, y, z), where = `${lx.toFixed(2)}, ${ly.toFixed(2)}, ${lz.toFixed(2)}`;
    if (Math.abs(lx) < U.x + 0.45 && Math.abs(lz) < U.z + 0.45) {
      const slot = lx > U.postern.x0 && lz > U.postern.head && lz < U.postern.end + 0.25;
      assert.ok(Math.abs(lx) >= U.x || Math.abs(lz) >= U.z || ly < (slot ? U.postern.deep : U.floor - U.cistern.deep) - 0.3, `the ground is drawn in a room under the terrace, at ${where}`);
    } else assert.ok(!castleUnder(fort, x, y, z, was), `the ground is drawn in the passage or on a stair, at ${where}`);
  }
});

console.log(`\n${n} checks passed`);
