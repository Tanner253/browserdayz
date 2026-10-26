// How often a bed or a sleeping bag may be woken at, how many a player may have, and that it is kept with its base
// (src/sim/build/beds.ts; the owner, 2026-10-25: "sleeping bags get 1 spawn with 30 min cooldown, beds get 2 spawns 30
// min cooldown. player can have 5 sleeping bags and 2 regular beds at 1 time"). No server: the rules alone.
//   npx tsx test/beds.test.ts

import assert from 'node:assert/strict';
import { bedsFull, sleepOf, sleptAt } from '../src/sim/build/beds';
import { heardPiece, saidPiece } from '../src/sim/build/bases';
import type { Piece } from '../src/sim/build/snap';

const MIN = 60_000, t0 = 1_800_000_000_000;
const piece = (k: string, id = 1): Piece => ({ id, k, t: 0, x: 1, y: 0, z: 2, r: 0, hp: 100, at: t0, by: 'me', on: [] });

// ---- a sleeping bag: once, then half an hour
{
  const bag = piece('bedroll');
  assert.deepEqual(sleepOf(bag, t0), { left: 1, wait: 0 });
  assert.ok(sleptAt(bag, t0), 'a new bag is not ready');
  assert.equal(sleptAt(bag, t0 + MIN), false, 'a bag gave a second wake');
  assert.deepEqual(sleepOf(bag, t0 + 10 * MIN), { left: 0, wait: 20 * 60 });
  assert.equal(sleepOf(bag, t0 + 30 * MIN).left, 1, 'a bag is not ready again after half an hour');
  assert.ok(sleptAt(bag, t0 + 31 * MIN));
}

// ---- a bed: twice, then half an hour from the second
{
  const bed = piece('bed');
  assert.equal(sleepOf(bed, t0).left, 2);
  assert.ok(sleptAt(bed, t0));
  assert.deepEqual(sleepOf(bed, t0 + MIN), { left: 1, wait: 0 });
  assert.ok(sleptAt(bed, t0 + 5 * MIN), 'a bed gave only one wake');
  assert.equal(sleptAt(bed, t0 + 6 * MIN), false, 'a bed gave a third wake');
  assert.deepEqual(sleepOf(bed, t0 + 20 * MIN), { left: 0, wait: 15 * 60 });
  assert.equal(sleepOf(bed, t0 + 35 * MIN).left, 2, 'a bed does not give both again after half an hour');

  // ---- kept with its base: a restart finds it as it was
  sleptAt(bed, t0 + 40 * MIN);
  const back = heardPiece(JSON.parse(JSON.stringify(saidPiece(bed))), 'me')!;
  assert.deepEqual(back.slept, bed.slept, 'its wakes were not kept');
  assert.deepEqual(sleepOf(back, t0 + 41 * MIN), { left: 1, wait: 0 });
}

// ---- how many one player may have
{
  const bags = Array.from({ length: 5 }, (_, i) => piece('bedroll', i + 1)), beds = [piece('bed', 10), piece('bed', 11)];
  assert.equal(bedsFull('bedroll', bags.slice(0, 4)), null, 'a fifth bag was refused');
  assert.match(bedsFull('bedroll', bags) ?? '', /only 5 sleeping bags/, 'a sixth bag was let down');
  assert.equal(bedsFull('bed', [...bags, beds[0]]), null, 'bags counted against beds');
  assert.match(bedsFull('bed', beds) ?? '', /only 2 beds/, 'a third bed was let down');
  assert.equal(bedsFull('wall_wood', beds), null);
}
console.log('beds: ok');
