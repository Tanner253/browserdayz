// The second car (POLICE_CAR in src/sim/vehicles.ts): where the police cars stand, and that the server stands them
// there after the jeeps and says which each is.   npx tsx test/cars.test.ts

import assert from 'node:assert/strict';
import { buildWorldData } from '../server/world';
import { JEEP, POLICE_CAR, jeepSpots, policeSpots } from '../src/sim/vehicles';
import { BUILDING_FOOTPRINT, TOWN, generateWorld, heightAt } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const world = generateWorld();
const jeeps = jeepSpots(world);
const cars = policeSpots(world, jeeps);

ok('a police car beside each police station: the village\'s and Kamenka\'s, on level ground, clear of every wall and of every jeep', () => {
  const stations = world.buildings.filter((b) => b.type === 'police');
  assert.equal(stations.length, 2);
  assert.equal(cars.length, stations.length, `${cars.length} police cars for ${stations.length} stations`);
  cars.forEach((c, k) => {
    const st = stations[k];
    assert.ok(Math.hypot(c.x - st.x, c.z - st.z) < 22, `the car of station ${k} stands ${Math.hypot(c.x - st.x, c.z - st.z).toFixed(0)} m from it`);
    for (const b of world.buildings) {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      const dx = c.x - b.x, dz = c.z - b.z, co = Math.cos(b.rot), si = Math.sin(b.rot);
      // (it is two metres wide and five and a half long: nowhere nearer a wall than its own half length)
      assert.ok(Math.abs(dx * co - dz * si) > w / 2 + 2.8 || Math.abs(dx * si + dz * co) > d / 2 + 2.8, `a police car stands against ${b.id}`);
    }
    for (const [dx, dz] of [[2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]]) assert.ok(Math.abs(heightAt(world.heights, c.x + dx, c.z + dz) - c.y) < 0.45, 'a police car on a bank');
    for (const j of jeeps) assert.ok(Math.hypot(j.x - c.x, j.z - c.z) > 6, 'a police car on top of a jeep');
  });
  assert.ok(cars.some((c) => Math.hypot(c.x - TOWN.x, c.z - TOWN.z) < 120), 'no police car in Kamenka');
  assert.deepEqual(policeSpots(world, jeeps), cars, 'not where they were the last time');
});

ok('the server stands the jeeps where it stood them, and the police cars after them', () => {
  const data = buildWorldData(process.cwd());
  assert.deepEqual(data.jeeps, jeeps);
  assert.deepEqual(data.cars, cars);
  assert.equal(POLICE_CAR.kind, 1);
  assert.notEqual(POLICE_CAR.model, JEEP.model);
});

console.log(`\n${n} checks passed`);
