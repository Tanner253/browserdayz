// Where the animals are on the real map (the owner: "make sure animals dont spawn in impossible places like in the
// deserv canyon walls etc."): every herd's ground, every animal stood, and every place each one goes through ten
// minutes with somebody near every herd and shots among them, against the ground as the game makes it solid: water,
// too steep for it, a rock or the canyon's rock, a building, a wall, a prop, the fort, a post, a cave's mouth; and a
// town or a road, unless it flees. (progress/animals/audit.ts draws the same on the map, over an hour.)
//   npx tsx test/animal-places.test.ts

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateWorld, heightAt, passData, passPlan } from '../src/world/worldgen';
import { outcropPieces } from '../src/world/outcrops';
import { rockPieces, ROCKS } from '../src/sim/pass';
import { animalGround } from '../src/sim/animal-ground';
import { Herd, seeded, type Seen } from '../src/sim/animal-mind';
import { ANIMALS, HERDS, KINDS } from '../src/sim/animals';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

const world = generateWorld();
const man = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8'));
const rocks = [...rockPieces(passPlan, { ramps: passData().ramps, ground: (x, z) => heightAt(world.heights, x, z) }), ...outcropPieces(world, passPlan)];
const ground = animalGround(world, { rocks, boxOf: (k) => (man.models[k]?.min ? man.models[k] : null) });
const h = new Herd(ground, () => true, (now) => ((now / 1000) % 1920) / 1920, seeded(5));
h.populate(1);
const farm = (g: number) => !!HERDS[h.groups[g].herd].farm;
/** what is wrong with a place for one of a kind ('' nothing) */
const fault = (x: number, z: number, k: number, g: number, moving: boolean, fleeing: boolean) => {
  const kind = KINDS[k], b = ground.biome(x, z);
  if (!ground.open(x, z, kind.steep + 0.05)) return ground.slope(x, z) > kind.steep + 0.05 ? 'too steep' : 'in water or something solid';
  if (!farm(g) && !fleeing && b === 'town') return 'in a town';
  if (!farm(g) && !moving && ground.road(x, z) < ANIMALS.keepOff.walk) return 'on a road';
  return '';
};

ok('the ground knows the canyon\'s rock: a point inside a cliff piece is not open, one well in front of its face is', () => {
  const cliff = rocks.find((p) => p.id === 'namaqualand_cliff_02' && !p.small)!;
  const m = ROCKS[cliff.id], c = Math.cos(cliff.turn), s = Math.sin(cliff.turn);
  // (its own frame: along x, its face out along +z from its foot)
  const at = (lx: number, lz: number) => [cliff.at[0] + lx * c + lz * s, cliff.at[2] - lx * s + lz * c] as const;
  assert.equal(ground.open(...at(0, -m.back * cliff.scale * 0.5), 9), false, 'inside the rock');
});

ok('every herd lives on its own kind of country, on ground it can stand on, off the roads and away from the towns', () => {
  assert.ok(h.groups.length >= 20, `${h.groups.length} herds`);
  for (const g of h.groups) {
    if (farm(g.i)) continue;
    const kind = KINDS[g.wants[0]], hk = HERDS[g.herd];
    assert.ok(ground.open(g.home.x, g.home.z, kind.steep), `${hk.id} at ${g.home.x | 0},${g.home.z | 0}: not open`);
    assert.ok(ground.road(g.home.x, g.home.z) >= ANIMALS.keepOff.home, `${hk.id} at ${g.home.x | 0},${g.home.z | 0}: by a road`);
    assert.ok([...hk.feed, ...hk.rest].includes(ground.biome(g.home.x, g.home.z)), `${hk.id}: on ${ground.biome(g.home.x, g.home.z)}`);
    assert.notEqual(ground.biome(g.home.x, g.home.z), 'desert', `${hk.id} in the desert`);
  }
});

ok('every animal is stood somewhere it can be', () => {
  const bad = [...h.beasts.values()].map((b) => [KINDS[b.k].id, b.x | 0, b.z | 0, fault(b.x, b.z, b.k, b.g, false, false)]).filter((f) => f[3]);
  assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 5)));
});

ok('ten minutes with somebody by every herd and shots among them: none ever where it cannot be', () => {
  const people: Seen[] = h.groups.map((g, i) => ({ id: i + 1, x: g.home.x + 150, y: 0, z: g.home.z, crouch: false, prone: false, speed: 1.5, ride: '', sheltered: false }));
  const bad: string[] = [];
  let checks = 0;
  for (let t = 0; t <= 600_000; t += 200) {
    for (const p of people) p.x += Math.sin((t / 1000 + p.id) * 0.05) * 0.4;
    if (t % 20_000 === 0) {
      const p = people[(t / 20_000) % people.length];
      h.heard(p.x - 60, p.z, [300, 600], 1_000_000 + t);
    }
    h.tick(1_000_000 + t, people);
    for (const b of h.beasts.values()) {
      if (b.diedAt) continue;
      checks++;
      const f = fault(b.x, b.z, b.k, b.g, b.speed > 0, !!h.groups[b.g].flee);
      if (f && bad.length < 5) bad.push(`${KINDS[b.k].id} at ${b.x | 0},${b.z | 0}: ${f}`);
    }
  }
  assert.ok(checks > 100_000, `${checks} checks`);
  assert.equal(bad.length, 0, bad.join('; '));
});

console.log(`animal-places: ${n} passed`);
