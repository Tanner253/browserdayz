// Drinking from the world's water (src/sim/water.ts `drinkable`) on the world as made: from the river, its bank and
// in it; from Ozerki's lake shore; in the swamp; not from a bridge's height over the river, not far up a bank, not at
// the sea nor at the river's mouth, where it has come down to the sea's height. No ports, no page: the server takes
// thirst at the game's word, a well's drink and this one alike, so there is nothing of the server's to ask.
//   npx tsx test/drink.test.ts

import assert from 'node:assert/strict';
import { SEA_LEVEL, TOWN, generateWorld, heightAt } from '../src/world/worldgen';
import { DRINK, drinkable, inside, waterAt, waterName } from '../src/sim/water';

const world = generateWorld(), W = world.water!;
const ground = (x: number, z: number) => heightAt(world.heights, x, z);
const at = (x: number, z: number) => waterAt(W, x, z, ground);
/** whoever stands on the ground at (x, z), `up` metres over it */
const drink = (x: number, z: number, up = 0) => drinkable(at, x, ground(x, z) + up, z, SEA_LEVEL);
/** stood in water: their feet on its bed */
const wade = (x: number, z: number) => drinkable(at, x, ground(x, z), z, SEA_LEVEL);

// ---- the river: in it, on its bank, and not off up the bank or from a bridge's height
const river = W.rivers[0].pts;
const k = Math.floor(river.length / 4), [rx, rz, , rw] = river[k], [nx, nz] = river[k + 1];
const along = Math.hypot(nx - rx, nz - rz), ax = (nx - rx) / along, az = (nz - rz) / along;
const inRiver = wade(rx, rz)!;
assert.ok(inRiver && inRiver.under && waterName(inRiver) === 'river', `in the river at ${rx.toFixed(0)}, ${rz.toFixed(0)}`);
// (out from its middle, across it, to the first dry ground: one step on to the bank)
let off = rw / 2;
while (at(rx - az * off, rz + ax * off)) off += 0.25;
const bank = drink(rx - az * (off + 0.5), rz + ax * (off + 0.5));
assert.ok(bank && !bank.under && bank.kind === 'river', `on the river's bank, ${(off + 0.5).toFixed(1)} m from its middle`);
assert.equal(drink(rx - az * (off + DRINK.reach + 2), rz + ax * (off + DRINK.reach + 2)), null, 'not from a few paces up its bank');
assert.equal(drinkable(at, rx, inRiver.surface + 4, rz, SEA_LEVEL), null, 'not from a bridge four metres over it');

// ---- Ozerki's lake: from its shore and stood in its shallows
const lake = W.lakes.find((l) => !l.swamp)!;
const [cx, cz] = lake.outline.reduce(([sx, sz], [x, z]) => [sx + x / lake.outline.length, sz + z / lake.outline.length], [0, 0]);
// (from its middle toward each of its corners, to where its water ends: the first dry ground there is its shore)
let shore: [number, number] | null = null;
for (const [px, pz] of lake.outline) {
  const L = Math.hypot(px - cx, pz - cz);
  let s = 0;
  while (s < L && !at(cx + ((px - cx) * s) / L, cz + ((pz - cz) * s) / L)) s += 0.5;
  while (s < L + 30 && at(cx + ((px - cx) * s) / L, cz + ((pz - cz) * s) / L)) s += 0.25;
  if (s > 0 && s < L + 30) { shore = [cx + ((px - cx) * (s + 0.5)) / L, cz + ((pz - cz) * (s + 0.5)) / L]; break; }
}
assert.ok(shore, `found the shore of ${lake.name}`);
const fromShore = drink(...shore!);
assert.ok(fromShore && !fromShore.under && waterName(fromShore) === 'lake', `from the shore of ${lake.name} at ${shore!.map((v) => v.toFixed(0))}`);

// ---- the swamp: stood in it anywhere it has water
const swamp = W.lakes.find((l) => l.swamp)!;
let inSwamp: [number, number] | null = null;
const xs = swamp.outline.map((p) => p[0]), zs = swamp.outline.map((p) => p[1]);
for (let x = Math.min(...xs); x < Math.max(...xs) && !inSwamp; x += 7) for (let z = Math.min(...zs); z < Math.max(...zs) && !inSwamp; z += 7) if (inside(swamp.outline, x, z) && (at(x, z)?.depth ?? 0) > 0.1) inSwamp = [x, z];
const swampDrink = wade(...inSwamp!);
assert.ok(swampDrink && swampDrink.under && waterName(swampDrink) === 'swamp', `in the swamp at ${inSwamp!.map((v) => v.toFixed(0))}`);

// ---- not the sea, nor the river's mouth where it is the sea's
const sea: [number, number] = [-3800, river[river.length - 1][1]];
assert.ok(ground(...sea) < SEA_LEVEL - 0.5, 'the sea point is under the sea');
assert.equal(drinkable(at, sea[0], SEA_LEVEL - 0.6, sea[1], SEA_LEVEL), null, 'not in the sea');
const mouth = river[river.length - 2];
assert.ok(at(mouth[0], mouth[1]), 'the river has water at its mouth');
assert.equal(wade(mouth[0], mouth[1]), null, "not at the river's mouth, come down to the sea's height");
// (and where the river is still the river, well inland of its mouth)
const low = [...river].reverse().find(([, , s]) => s > SEA_LEVEL + DRINK.salt + 0.5)!;
assert.ok(wade(low[0], low[1]), `the river a little above the sea's height is fresh (${low[0].toFixed(0)}, ${low[1].toFixed(0)})`);

// ---- nothing in a dry town
assert.equal(drink(TOWN.x, TOWN.z), null, 'no water in Kamenka');

console.log(`drink: river ${rx.toFixed(0)},${rz.toFixed(0)}; bank ${(off + 0.5).toFixed(1)} m out; ${lake.name}'s shore; swamp ${inSwamp!.map((v) => v.toFixed(0))}; not the sea, not the mouth (${mouth[0].toFixed(0)}), fresh at ${low[0].toFixed(0)}`);
