// Checks of the rules the gas is kept by (src/sim/gas.ts), against the world as it is made:
// where it lies, what breathing it costs, and that nobody is put down in it. No network:
// `npx tsx test/gas.test.ts`.

import assert from 'node:assert/strict';
import { GAS, breathe, freshLungs, gasDepth, gasEdge, gasZone } from '../src/sim/gas';
import { ITEMS } from '../src/sim/items';
import { pickDropSite } from '../src/sim/drops';
import { generateWorld, heightAt } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
const zone = gasZone(world.pois, ground)!;

ok('it lies over the place it is said to, on the ground there', () => {
  assert.ok(zone, 'the world has no such place');
  const p = world.pois.find((q) => q.name === GAS.place)!;
  assert.equal(zone.x, p.x);
  assert.equal(zone.z, p.z);
  assert.ok(Math.abs(zone.y - ground(p.x, p.z)) < 1e-6);
});

ok('thickest at the middle, nothing at the rim, and never thinner going in', () => {
  assert.equal(gasDepth(zone, zone.x, zone.y, zone.z), 1);
  assert.equal(gasDepth(zone, zone.x + zone.r, zone.y, zone.z), 0);
  assert.equal(gasDepth(zone, zone.x + zone.r + 30, zone.y, zone.z), 0);
  assert.equal(gasDepth(zone, zone.x, zone.y + zone.h + 1, zone.z), 0);
  assert.equal(gasDepth(null, zone.x, zone.y, zone.z), 0);
  let last = 0;
  for (let d = zone.r; d >= 0; d -= 2) {
    const now = gasDepth(zone, zone.x + d, ground(zone.x + d, zone.z) + 1.6, zone.z);
    assert.ok(now >= last - 0.02, `thinner at ${d} m than further out`);
    last = now;
  }
});

ok('every building of the place is in gas thick enough to be breathed, at head height', () => {
  const p = world.pois.find((q) => q.name === GAS.place)!;
  const inside = world.buildings.filter((b) => Math.hypot(b.x - p.x, b.z - p.z) < p.radius);
  assert.ok(inside.length >= 3, 'the place has hardly a building');
  for (const b of inside) assert.ok(gasDepth(zone, b.x, ground(b.x, b.z) + 1.6, b.z) > GAS.breathe * 2, `${b.type} is at the rim or outside`);
});

/** a survivor stood `depth` deep for so many seconds: the health it costs, and how many times they cough */
const stand = (depth: number, masked: boolean, seconds: number, lungs = freshLungs()) => {
  let hurt = 0, coughs = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = breathe(lungs, depth, masked, 1 / 60);
    hurt += r.hurt;
    if (r.cough) coughs++;
  }
  return { hurt, coughs, lungs };
};

ok('breathed without a mask: a cough at once, a few seconds of grace, then it kills', () => {
  const a = stand(0.6, false, GAS.hold - 0.1);
  assert.equal(a.hurt, 0);
  assert.ok(a.coughs >= 1, 'the first breath of it was not coughed');
  // at the middle a healthy survivor is dead in well under a quarter of a minute, and not in a blink
  let lungs = freshLungs(), health = 100, t = 0;
  for (; health > 0 && t < 60; t += 1 / 60) health -= breathe(lungs, 1, false, 1 / 60).hurt;
  assert.ok(t > GAS.hold + 4 && t < 12, `dead at the middle in ${t.toFixed(1)} s`);
  // and at the least of it, in under half a minute
  lungs = freshLungs();
  health = 100;
  for (t = 0; health > 0 && t < 60; t += 1 / 60) health -= breathe(lungs, GAS.breathe + 0.01, false, 1 / 60).hurt;
  assert.ok(t > 12 && t < 25, `dead just inside the rim in ${t.toFixed(1)} s`);
});

ok('a run in to the buildings and out again, unmasked, is not survived twice', () => {
  // in from the rim to forty metres from the middle and straight back, at a sprint
  const lungs = freshLungs();
  let health = 100;
  const speed = 6.2, turn = 40;
  for (let t = 0, d = zone.r; ; t += 1 / 60) {
    const going = t < (zone.r - turn) / speed;
    d += (going ? -speed : speed) / 60;
    if (!going && d >= zone.r) break;
    health -= breathe(lungs, gasDepth(zone, zone.x + d, zone.y + 1.6, zone.z), false, 1 / 60).hurt;
  }
  assert.ok(health > 5 && health < 70, `left with ${health.toFixed(0)} health`);
});

ok('a mask on the face keeps all of it out, and the gas mask is such a mask', () => {
  assert.equal(stand(1, true, 120).hurt, 0);
  assert.equal(stand(1, true, 120).coughs, 0);
  assert.ok(ITEMS.gasmask.wear?.gas, 'the gas mask does not keep the gas out');
  assert.equal(ITEMS.gasmask.slot, 'face');
  // (nothing else worn does)
  assert.deepEqual(Object.values(ITEMS).filter((i) => i.wear?.gas).map((i) => i.id), ['gasmask']);
});

ok('clean air clears the lungs: out for a while, the grace is there again', () => {
  const { lungs } = stand(0.8, false, 10);
  assert.ok(lungs.held >= GAS.hold);
  stand(0, false, GAS.hold + 1.5, lungs);
  assert.equal(lungs.held, 0);
  assert.equal(stand(0.8, false, GAS.hold - 0.1, lungs).hurt, 0);
  // and a mask put on inside does the same
  const b = stand(0.8, false, 10).lungs;
  stand(0.8, true, GAS.hold + 1.5, b);
  assert.equal(b.held, 0);
});

ok('nobody starts in it, and nothing is dropped into it', () => {
  // (well clear of it: the warning of gas ahead is given long before anybody who starts nearest has walked to it)
  for (const s of world.spawns) assert.ok(gasEdge(zone, s.x, s.z) > 40, `a starting point ${gasEdge(zone, s.x, s.z).toFixed(0)} m from the gas`);
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let k = 0; k < 400; k++) {
    const at = pickDropSite(world, rnd);
    if (at) assert.ok(gasEdge(zone, at.x, at.z) > 0, 'a supply drop came down in the gas');
  }
});

console.log(`\n${n} checks passed`);
