// Checks of the rules the gas is kept by (src/sim/gas.ts), against the world as it is made:
// where it lies, what breathing it costs, and that nobody is put down in it. No network:
// `npx tsx test/gas.test.ts`.

import assert from 'node:assert/strict';
import { GAS, breathe, freshLungs, gasDepth, gasEdge, gasZone } from '../src/sim/gas';
import { ITEMS } from '../src/sim/items';
import { fillDrop, pickDropSite } from '../src/sim/drops';
import { generateWorld, heightAt } from '../src/world/worldgen';
import { Economy, GAS_RESTOCK } from '../src/sim/economy';
import { fillCrate } from '../src/sim/crates';
import { RNG } from '../src/core/noise';
import { buildWorldData } from '../server/world';

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

/** in from the rim at a sprint to so many metres from the middle, and straight back out: the health left */
const dash = (turn: number) => {
  const lungs = freshLungs();
  let health = 100;
  const speed = 6.2;
  for (let t = 0, d = zone.r; ; t += 1 / 60) {
    const going = t < (zone.r - turn) / speed;
    d += (going ? -speed : speed) / 60;
    if (!going && d >= zone.r) break;
    health -= breathe(lungs, gasDepth(zone, zone.x + d, zone.y + 1.6, zone.z), false, 1 / 60).hurt;
  }
  return health;
};

ok('unmasked, a dash to the gate and back is survived and no more than that; a run into the yard is not', () => {
  // the gate posts are the nearest of its buildings to the way in
  const works = world.pois.find((q) => q.name === GAS.place)!;
  const gate = Math.max(...world.buildings.filter((b) => b.type === 'guardpost' && Math.hypot(b.x - works.x, b.z - works.z) < works.radius).map((b) => Math.hypot(b.x - works.x, b.z - works.z)));
  assert.ok(gate > 40 && gate < zone.r, 'no gate to the place');
  const left = dash(gate);
  assert.ok(left > 5 && left < 75, `back from the gate with ${left.toFixed(0)} health`);
  assert.ok(dash(15) <= 0, 'into the middle of the yard and out again, alive');
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

ok('what is kept under the gas is marked so, and the masks are kept out of it, in the police station', () => {
  const data = buildWorldData(process.cwd());
  const under = data.lootPoints.filter((p) => p.usage.includes('Gas'));
  assert.ok(under.length >= 8, `only ${under.length} places to find anything under the gas`);
  for (const p of data.lootPoints) assert.equal(p.usage.includes('Gas'), gasDepth(zone, p.x, p.y, p.z) > GAS.breathe);
  // stocked as a fresh server stocks it: every mask is in the police station, none under the gas
  const police = world.buildings.filter((b) => b.type === 'police').map((b) => b.id);
  assert.ok(police.length >= 1, 'no police station on this map');
  const eco = new Economy(data.lootPoints, { spawn: () => {}, despawn: () => {} });
  eco.populate();
  const masks = [...eco.loot.values()].filter((l) => l.item.id === 'gasmask');
  assert.ok(masks.length >= 2, `${masks.length} gas masks on the whole map`);
  for (const l of masks) {
    const at = data.lootPoints.find((q) => Math.hypot(q.x - l.x, q.z - l.z) < 0.6 && Math.abs(q.y - l.y) < 0.6);
    assert.ok(at && police.includes(at.building), 'a gas mask somewhere other than the police station');
    assert.equal(gasDepth(zone, l.x, l.y, l.z), 0, 'a gas mask under the gas');
  }
});

ok('the gas is the richest place on the map; helmets, plates and scopes are of it, and rare anywhere else', () => {
  const data = buildWorldData(process.cwd());
  const places = data.lootPoints.filter((p) => p.usage.includes('Gas') && !p.arms).length;
  const tally = (seed: number) => {
    const e = new Economy(data.lootPoints, { spawn: () => {}, despawn: () => {} });
    // (its own dice, thrown from a different place each time)
    (e as unknown as { rng: RNG }).rng = new RNG(seed);
    e.populate();
    const inGas = new Map<string, number>(), out = new Map<string, number>();
    let gasThings = 0;
    for (const l of e.loot.values()) {
      const under = l.point >= 0 && data.lootPoints[l.point].usage.includes('Gas');
      const m = under ? inGas : out;
      m.set(l.item.id, (m.get(l.item.id) ?? 0) + 1);
      if (under && !data.lootPoints[l.point].arms) gasThings++;
    }
    return { e, inGas, out, gasThings };
  };
  for (let k = 0; k < 6; k++) {
    const { inGas, out, gasThings } = tally(1000 + k * 7919);
    const g = (id: string) => inGas.get(id) ?? 0, o = (id: string) => out.get(id) ?? 0;
    // four places in five there have something lying in them (on the rest of the map it is three in five)
    assert.ok(gasThings / places >= 0.8, `only ${gasThings} things on the ${places} places under the gas`);
    // helmets, plates, scopes: common there, rare everywhere else
    for (const [id, most] of [['boonie_hat', 2], ['life_vest', 2], ['pu_scope', 1]] as const) {
      assert.ok(g(id) >= 5, `${g(id)} of ${id} under the gas`);
      assert.ok(o(id) <= most, `${o(id)} of ${id} on the rest of the map`);
      assert.ok(g(id) > o(id) * 2);
    }
    // and everything else is to be had there: guns, a lot to fire from them, something for a wound, grenades
    assert.ok(g('mosin') + g('p38') + g('m9') >= 14, 'few guns under the gas');
    assert.ok(g('box_762') + g('box_9mm') + g('ammo_762') + g('ammo_9mm') >= 24, 'little ammunition under the gas');
    assert.ok(g('firstaid') + g('bandage') >= 7 && g('grenade') >= 5);
    // the rest of the map holds what it held before the works were built
    assert.ok(o('mosin') >= 16 && o('ammo_9mm') >= 44 && o('bandage') >= 18, 'the rest of the map has gone short');
    assert.equal(g('gasmask'), 0);
  }
  // what is taken under the gas is put back, and soon; a scope taken from the rest of the map is not back so soon
  const { e } = tally(4242);
  const scopes = [...e.loot.values()].filter((l) => l.item.id === 'pu_scope' && l.point >= 0 && data.lootPoints[l.point].usage.includes('Gas'));
  for (const l of scopes.slice(0, 3)) e.take(l.uid);
  assert.equal(e.held('pu_scope', true), scopes.length - 3);
  for (let t = 0; t < GAS_RESTOCK + 10; t += 5) e.tick(5, []);
  assert.equal(e.held('pu_scope', true), scopes.length, 'the scopes under the gas were not put back');
  // a crate under the gas holds the best of everything, and every supply drop has a scope in it
  const seen = new Map<string, number>();
  let s = 99;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const box = () => ({ add: (it: { id: string }) => (seen.set(it.id, (seen.get(it.id) ?? 0) + 1), it) });
  for (let k = 0; k < 300; k++) fillCrate(box() as never, 'weapons_case', rnd, true);
  const rich = (id: string) => (seen.get(id) ?? 0) / 300;
  assert.ok(rich('boonie_hat') > 0.2 && rich('life_vest') > 0.2 && rich('pu_scope') > 0.15, 'a crate under the gas is no better than another');
  seen.clear();
  for (let k = 0; k < 300; k++) fillCrate(box() as never, 'weapons_case', rnd, false);
  assert.ok(rich('life_vest') < 0.06 && rich('pu_scope') < 0.04, 'plates and scopes are common in a crate outside the gas');
  for (let k = 0; k < 60; k++) {
    const got: string[] = [];
    fillDrop({ add: (it: { id: string }) => (got.push(it.id), it) } as never, rnd);
    assert.ok(got.includes('pu_scope'), 'a supply drop with no scope in it');
  }
});

console.log(`\n${n} checks passed`);
