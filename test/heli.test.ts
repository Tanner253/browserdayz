// The helicopter's rules (src/sim/heli.ts): where the two stand when the world is new, and the numbers the server
// holds every vehicle to. How it flies is looked at in the game (assets-src/_wf/me/heli-fly.js: a test flight that
// takes off, holds its height, goes, stops itself, turns and lands).   npx tsx test/heli.test.ts
import assert from 'node:assert/strict';
import { HELI, heliSpots, hospitalRoof } from '../src/sim/heli';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { inCastle } from '../src/sim/castle';
import { buildWorldData } from '../server/world';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};
const world = generateWorld();
const spots = heliSpots(world);

ok('two helicopters: one on the hospital roof, one by the fort; the same every time', () => {
  assert.equal(spots.length, 2);
  assert.equal(spots.filter((s) => s.roof).length, 1);
  assert.deepEqual(heliSpots(world), spots);
});

ok('the one on the roof stands on the roof: 9.8 m over the hospital\'s floor, inside its walls', () => {
  const s = spots.find((q) => q.roof)!, h = world.buildings.find((b) => b.type === 'hospital')!;
  assert.ok(Math.abs(hospitalRoof() - 9.8) < 1e-9, `the roof is ${hospitalRoof()} over the floor`);
  assert.ok(Math.abs(s.y - (h.floorY + 9.8)) < 1e-9);
  // (in the building's own frame: inside its 46 by 16 m, clear of the stair rooms at either end)
  const c = Math.cos(h.rot), si = Math.sin(h.rot), dx = s.x - h.x, dz = s.z - h.z, lx = dx * c - dz * si, lz = dx * si + dz * c;
  assert.ok(Math.abs(lx) < 23 - 3.7 - 3 && Math.abs(lz) < 8 - 0.2, `at ${lx.toFixed(1)}, ${lz.toFixed(1)} in the building`);
});

ok('the one by the fort: on level ground clear of trees, rocks, things and buildings, outside the fort, within 200 m of it', () => {
  const s = spots.find((q) => !q.roof)!, f = world.castle!;
  const d = Math.hypot(s.x - f.x, s.z - f.z);
  assert.ok(d < 200, `${d.toFixed(0)} m from the fort`);
  assert.ok(!inCastle(f, s.x, s.y + 1, s.z));
  for (const list of [world.trees, world.rocks, world.props]) {
    const near = Math.min(...list.map((t) => Math.hypot(t.x - s.x, t.z - s.z)));
    assert.ok(near >= HELI.pad.clear, `something ${near.toFixed(1)} m from its pad`);
  }
  // (stood on the highest ground under its skids: none of it in the ground, and not more than a hand over any of it)
  assert.ok(s.y >= heightAt(world.heights, s.x, s.z) - 1e-6 && s.y - heightAt(world.heights, s.x, s.z) < 0.6);
});

ok('the server stands them where the game does', () => {
  const data = buildWorldData(process.cwd());
  assert.deepEqual(data.helis, spots);
});

ok('it is never faster or higher than the server takes a vehicle\'s word for (isVState: under 60 m/s, under 500 m)', () => {
  assert.ok(HELI.top < 60 && HELI.ceiling < 500);
  // and it can lift itself, a passenger and some fuel, with some to spare
  assert.ok(HELI.lift > 1.3);
});

console.log(`heli: ${n} passed`);
