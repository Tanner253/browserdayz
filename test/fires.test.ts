// Checks of the rules the campfires are kept by (src/sim/fires.ts), against the world as it
// is made. No network: `npx tsx test/fires.test.ts`.

import assert from 'node:assert/strict';
import { FIRE, Hearths, fireSpots } from '../src/sim/fires';
import { gasEdge, gasZone } from '../src/sim/gas';
import { buildWorldData } from '../server/world';
import { generateWorld, heightAt } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const data = buildWorldData(process.cwd());
const spots = data.fires;

ok('there are fireplaces on the map, the server and the game count the same ones, and none is under the gas', () => {
  assert.ok(spots.length >= 4, `only ${spots.length} fireplaces on the whole map`);
  // (the game counts them off the same world, made the same way, after the buildings have laid their yards out)
  const again = buildWorldData(process.cwd()).fires;
  assert.deepEqual(again, spots);
  const world = generateWorld();
  assert.equal(fireSpots(world.props).length < spots.length, true, 'the fireplaces are in the bare world: the yards add none?');
  const gas = gasZone(world.pois, (x, z) => heightAt(world.heights, x, z))!;
  for (const s of spots) assert.ok(gasEdge(gas, s.x, s.z) > 10, 'a fireplace in the gas');
});

ok('one is lit by somebody standing beside it, and by nobody else', () => {
  const h = new Hearths(spots);
  const s = spots[0];
  assert.equal(h.left(0, 100), 0);
  assert.equal(h.light(0, s.x + FIRE.reach + 1, s.z, 100), false, 'lit from out of reach');
  assert.equal(h.light(99, s.x, s.z, 100), false, 'lit a fireplace there is not');
  assert.equal(h.light(0.5, s.x, s.z, 100), false);
  assert.equal(h.light(0, s.x + 1, s.z, 100), true);
  assert.equal(h.left(0, 100), FIRE.burns);
  // (the server gives a moving player a little grace, and no more than it is asked to)
  assert.equal(h.light(1, spots[1].x + FIRE.reach + 2, spots[1].z, 100, 2.5), true);
  assert.equal(new Hearths(spots).light(1, spots[1].x + FIRE.reach + 3, spots[1].z, 100, 2.5), false);
});

ok('it burns for as long as is said, cannot be lit twice over, and can be lit again when it is out', () => {
  const h = new Hearths(spots);
  const s = spots[0];
  assert.ok(h.light(0, s.x, s.z, 0));
  assert.equal(h.light(0, s.x, s.z, 10), false, 'lit while it was burning');
  assert.equal(h.left(0, FIRE.burns - 1), 1);
  assert.equal(h.left(0, FIRE.burns + 1), 0);
  assert.ok(h.light(0, s.x, s.z, FIRE.burns + 1));
});

ok('somebody arriving is told which are alight and how long each has left, and nothing of those that are out', () => {
  const h = new Hearths(spots);
  h.light(0, spots[0].x, spots[0].z, 0);
  h.light(2, spots[2].x, spots[2].z, 100);
  assert.deepEqual(h.alight(150), [[0, FIRE.burns - 150], [2, FIRE.burns - 50]]);
  assert.deepEqual(h.alight(FIRE.burns + 10), [[2, 90]]);
  assert.deepEqual(h.alight(FIRE.burns + 200), []);
});

ok('what it is worth: a hurt survivor is whole again in a couple of minutes beside one, and it does not burn all day', () => {
  // from a quarter of their health to all of it
  const seconds = 75 / FIRE.heal;
  assert.ok(seconds > 45 && seconds < 150, `${seconds.toFixed(0)} s to mend`);
  assert.ok(seconds < FIRE.burns, 'one fire does not last long enough to mend by');
  assert.ok(FIRE.burns <= 600);
  assert.ok(FIRE.meal > 1 && FIRE.meal <= 1.6);
  // (and it is heard by the infected further off than a jog is, which is the price of it)
  assert.ok(FIRE.heard > 11);
});

console.log(`\n${n} checks passed`);
