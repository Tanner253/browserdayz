// Wells and bottles (src/sim/wells.ts, `sips` in src/sim/items.ts): where the wells stand, what a bottle
// holds, and when hunger and thirst begin to tell.   npx tsx test/thirst.test.ts

import assert from 'node:assert/strict';
import { ITEMS, makeItem, sanitizeItem } from '../src/sim/items';
import { NEED, WELL, stage, wellSpots } from '../src/sim/wells';
import { BUILDING_FOOTPRINT, TOWN, generateWorld, heightAt } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const world = generateWorld();

ok('a well in each town: near its middle, on level ground, off the road and clear of every building and tree', () => {
  const wells = wellSpots(world);
  assert.equal(wells.length, 2, `${wells.length} wells`);
  const village = world.pois[0];
  assert.ok(Math.hypot(wells[0].x - village.x, wells[0].z - village.z) < 60, 'the village well is not in the village');
  assert.ok(Math.hypot(wells[1].x - TOWN.x, wells[1].z - TOWN.z) < 60, "Kamenka's well is not in Kamenka");
  const lines = [world.road.points, ...world.roads.map((r) => r.points)];
  for (const w of wells) {
    for (const b of world.buildings) {
      const [bw, bd] = BUILDING_FOOTPRINT[b.type];
      const dx = w.x - b.x, dz = w.z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
      assert.ok(Math.abs(dx * c - dz * s) > bw / 2 + 3 || Math.abs(dx * s + dz * c) > bd / 2 + 3, `the well of ${w.town} stands against ${b.id}`);
    }
    for (const t of world.trees) assert.ok(Math.hypot(t.x - w.x, t.z - w.z) > 4, `a tree stands in the well of ${w.town}`);
    for (const p of lines) for (let i = 0; i < p.length; i += 3) assert.ok(Math.hypot(p[i] - w.x, p[i + 2] - w.z) > 5, `the well of ${w.town} stands in the road`);
    for (let k = 0; k < 8; k++) assert.ok(Math.abs(heightAt(world.heights, w.x + Math.cos(k) * WELL.ring, w.z + Math.sin(k) * WELL.ring) - w.y) < 0.2, `the well of ${w.town} stands on a slope`);
  }
  // (and they are where they were the last time: found from the map, the same in every game)
  const again = wellSpots(world);
  assert.deepEqual(again, wells);
});

ok('a bottle holds more than one drink, is full when it is found, and is never more than full or less than empty', () => {
  const bottles = Object.values(ITEMS).filter((d) => d.use?.sips);
  assert.deepEqual(bottles.map((d) => d.id).sort(), ['flask', 'thermos', 'water_jug']);
  for (const d of bottles) {
    assert.ok(d.use!.sips! >= 2 && (d.use!.water ?? 0) > 0, `${d.id} is not a bottle of water`);
    assert.equal(makeItem(d.id).left, d.use!.sips, `${d.id} is not found full`);
    assert.equal(sanitizeItem({ ...makeItem(d.id), left: 99 })!.left, d.use!.sips);
    assert.equal(sanitizeItem({ ...makeItem(d.id), left: -3 })!.left, 0);
    const old = makeItem(d.id);
    delete old.left;
    assert.equal(sanitizeItem(old)!.left, d.use!.sips, `a ${d.id} from before bottles were counted is not a full one`);
  }
  // the jug is the most water there is to carry, the flask next
  assert.ok(ITEMS.water_jug.use!.sips! * ITEMS.water_jug.use!.water! > ITEMS.flask.use!.sips! * ITEMS.flask.use!.water!);
  // and what is not a bottle has nothing left in it to count
  assert.equal(sanitizeItem({ ...makeItem('beans'), left: 2 })!.left, undefined);
});

ok('hunger and thirst tell before they kill: wanting under a quarter, in a bad way under a tenth', () => {
  assert.deepEqual([100, 26, 25, 24, 11, 10, 9, 0].map(stage), [0, 0, 0, 1, 1, 1, 2, 2]);
  assert.ok(NEED.slow < 1 && NEED.slow > 0.75, 'parched, a sprint is a little slower and still a sprint');
  assert.ok(NEED.breath[0] === 1 && NEED.breath[1] < 1 && NEED.breath[2] < NEED.breath[1]);
  assert.ok(NEED.shake[0] === 1 && NEED.shake[1] > 1 && NEED.shake[2] > NEED.shake[1]);
});

console.log(`\n${n} checks passed`);
