// The second car (POLICE_CAR in src/sim/vehicles.ts): where the police cars stand, and that the server stands them
// there after the jeeps and says which each is. And the west's jeeps (westSpots): one by the road at each of its
// places, level, off the asphalt, out of every building.   npx tsx test/cars.test.ts

import assert from 'node:assert/strict';
import { buildWorldData } from '../server/world';
import { JEEP, POLICE_CAR, WEST_CARS, jeepSpots, policeSpots, westSpots } from '../src/sim/vehicles';
import { waterAt } from '../src/sim/water';
import { BUILDING_FOOTPRINT, SEA_LEVEL, TOWN, generateWorld, heightAt } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const world = generateWorld();
const jeeps = jeepSpots(world);
const cars = policeSpots(world, jeeps);
const west = westSpots(world, [...jeeps, ...cars]);

ok('a police car beside each police station: the village\'s and Kamenka\'s, and the headquarters\', on level ground, clear of every wall and of every jeep', () => {
  const stations = world.buildings.filter((b) => b.type === 'police' || b.type === 'police_hq');
  assert.equal(stations.length, 3);
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

ok('a jeep by the road at each place of the west, on level ground, off the asphalt, out of every building and the water', () => {
  // (how far a point is from the edge of the asphalt of the nearest road, worked out here on its own)
  const asphalt = (x: number, z: number) => {
    let d = Infinity;
    for (const r of [world.road, ...world.roads]) {
      const p = r.points;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const ax = p[i], az = p[i + 2], ex = p[i + 3] - ax, ez = p[i + 5] - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t) - r.width / 2);
      }
    }
    return d;
  };
  assert.equal(west.length, WEST_CARS.length, `${west.length} west jeeps for ${WEST_CARS.length} places`);
  west.forEach((c, k) => {
    const q = world.pois.find((o) => o.name === WEST_CARS[k].name)!, d = Math.hypot(c.x - q.x, c.z - q.z);
    // (by the place: Kalat's on the road round its south, within the ruins' reach; the others at their way in)
    assert.ok(q.name === 'Kalat' ? d < q.radius : d >= 15 && d < Math.max(q.radius, 80), `${q.name}'s jeep stands ${d.toFixed(0)} m from its middle`);
    assert.ok(c.x < -1500, `${q.name}'s jeep is not in the west`);
    // (on the verge: its side, a metre from its middle, clear of the asphalt; and no further off than the verge)
    const off = asphalt(c.x, c.z);
    assert.ok(off >= 2 && off < 3, `${q.name}'s jeep stands ${off.toFixed(1)} m off the asphalt`);
    for (const [dx, dz] of [[2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]]) assert.ok(Math.abs(heightAt(world.heights, c.x + dx, c.z + dz) - c.y) <= 0.4, `${q.name}'s jeep on a bank`);
    assert.ok(c.y > SEA_LEVEL + 1 && !(world.water && waterAt(world.water, c.x, c.z, (x, z) => heightAt(world.heights, x, z))), `${q.name}'s jeep in the water`);
    for (const b of world.buildings) {
      const [w, dd] = BUILDING_FOOTPRINT[b.type];
      const dx = c.x - b.x, dz = c.z - b.z, co = Math.cos(b.rot), si = Math.sin(b.rot);
      assert.ok(Math.abs(dx * co - dz * si) > w / 2 + 3 || Math.abs(dx * si + dz * co) > dd / 2 + 3, `${q.name}'s jeep stands against ${b.id}`);
    }
    for (const o of [...jeeps, ...cars, ...west]) assert.ok(o === c || Math.hypot(o.x - c.x, o.z - c.z) > 39, `${q.name}'s jeep on top of another car`);
  });
  assert.deepEqual(westSpots(world, [...jeeps, ...cars]), west, 'not where they were the last time');
});

ok('the server stands the jeeps where it stood them, the police cars after them, and the west`s after those', () => {
  const data = buildWorldData(process.cwd());
  assert.deepEqual(data.jeeps, jeeps);
  assert.deepEqual(data.cars, cars);
  assert.deepEqual(data.west, west);
  assert.equal(POLICE_CAR.kind, 1);
  assert.notEqual(POLICE_CAR.model, JEEP.model);
});

console.log(`\n${n} checks passed`);
