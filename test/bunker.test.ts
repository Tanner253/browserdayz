// Checks of the bunker (src/sim/bunker.ts) against the world as it is made: where it lies,
// the hole it stands in, what is kept in it. `npx tsx test/bunker.test.ts`.

import assert from 'node:assert/strict';
import { BUNKER, bunkerAt, bunkerDark, bunkerLamps, bunkerLocal, bunkerLoot, bunkerRooms, bunkerShelves, inBunker, lampBurns, levelY } from '../src/sim/bunker';
import { BUNKER_AT, EXPANSION, PLAY_RADIUS, bunkerPlace, generateWorld, heightAt, inPlay } from '../src/world/worldgen';
import { buildWorldData } from '../server/world';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const world = generateWorld();
const P = bunkerPlace(world)!;
const ground = (r: number, f: number) => {
  const [x, , z] = bunkerAt(P, r, f);
  return heightAt(world.heights, x, z);
};

ok('it is straight across the map from the works, at the foot of the hills, and is part of where the game is played', () => {
  assert.ok(P, 'the world has no bunker');
  const cos = (BUNKER_AT.x * EXPANSION.x + BUNKER_AT.z * EXPANSION.z) / (Math.hypot(BUNKER_AT.x, BUNKER_AT.z) * Math.hypot(EXPANSION.x, EXPANSION.z));
  assert.ok(cos < -0.999, 'it is not opposite the works');
  assert.ok(Math.hypot(P.x, P.z) > PLAY_RADIUS && inPlay(P.x, P.z));
  // its way out is toward the middle of the map, and the valley floor is level with it there
  const [mx, , mz] = bunkerAt(P, 0, BUNKER.floor + BUNKER.wall - 4);
  assert.ok(Math.hypot(mx, mz) < Math.hypot(P.x, P.z) && Math.hypot(mx, mz) < PLAY_RADIUS);
  assert.ok(Math.abs(heightAt(world.heights, mx, mz) - P.y) < 1.5, 'a step up or down at its mouth');
  // and the hill stands over it behind
  assert.ok(ground(0, -(BUNKER.floor + BUNKER.wall - 4)) > P.y + 15, 'no hillside behind it');
});

ok('the ground round the pad is level, and under the pad it is dug out for the first level', () => {
  for (const [r, f] of [[BUNKER.pad.r + 3, 0], [-BUNKER.pad.r - 3, 5], [0, BUNKER.hut.front + 4], [10, BUNKER.pad.front + 4]]) assert.ok(Math.abs(ground(r, f) - P.y) < 0.12, `not level at ${r}, ${f}`);
  const floor = P.y + levelY();
  for (const [r, f] of [[0, 0], [BUNKER.hall.r, BUNKER.hall.back], [-BUNKER.hall.r, BUNKER.hall.front], [0, BUNKER.stair.foot + 3]]) assert.ok(ground(r, f) < floor - 0.1 && ground(r, f) > floor - 0.6, `the hole is not under the floor at ${r}, ${f}`);
  // the pad covers the whole of the hole, with a margin for the slope of its sides
  assert.ok(BUNKER.pad.r >= BUNKER.pit.r + 2 && BUNKER.pad.back <= BUNKER.pit.back - 2 && BUNKER.pad.front >= BUNKER.pit.front + 2);
  // and the stair is no steeper than a stair
  assert.ok((BUNKER.depth + BUNKER.pad.top) / BUNKER.stair.run < 0.7);
});

ok('what it is to be inside it, and how dark it is there', () => {
  const at = (r: number, f: number, y: number) => bunkerAt(P, r, f, y);
  assert.equal(bunkerDark(P, ...at(0, BUNKER.hut.front + 6, 1.6)), 0);
  assert.equal(bunkerDark(P, ...at(0, BUNKER.hut.front - 1, 1.9)), 0);
  assert.equal(bunkerDark(P, ...at(0, 0, levelY() + 1.6)), 1);
  assert.ok(inBunker(P, ...at(3, -4, levelY() + 1.6)) && !inBunker(P, ...at(0, BUNKER.stair.foot + 1, levelY() + 1.6)) && !inBunker(P, ...at(0, 0, 1.6)));
  const [r, f, y] = bunkerLocal(P, ...at(4.5, -7.25, 2));
  assert.ok(Math.abs(r - 4.5) < 1e-9 && Math.abs(f + 7.25) < 1e-9 && Math.abs(y - 2) < 1e-9);
  assert.equal(bunkerDark(null, 0, 0, 0), 0);
});

ok('five rooms and a sealed way down; benches, places for things, and lamps, all inside its walls', () => {
  const rooms = bunkerRooms();
  assert.equal(rooms.length, 6);
  assert.equal(rooms.filter((r) => r.sealed).length, 1);
  const inside = (r: number, f: number) => Math.abs(r) < BUNKER.hall.r && f > BUNKER.hall.back && f < BUNKER.hall.front;
  for (const s of bunkerShelves()) assert.ok(inside(s.r, s.f) && Math.abs(s.r) > BUNKER.passage + 0.4, 'a bench outside its room');
  const spots = bunkerLoot();
  assert.ok(spots.length >= 45, `${spots.length} places for things`);
  assert.ok(spots.filter((s) => s.floor).length >= 15, 'few places long enough for a shotgun');
  for (const s of spots) assert.ok(inside(s.r, s.f), 'a place for things outside its walls');
  // none of them in the room that is sealed
  const shut = rooms.find((r) => r.sealed)!;
  for (const s of spots) assert.ok(!(Math.sign(s.r) === shut.side && Math.abs(s.r) > BUNKER.passage + 0.3 && s.f > shut.back && s.f < shut.front), 'something is kept behind the sealed door');
  const lamps = bunkerLamps();
  assert.ok(lamps.length >= 8 && lamps.some((l) => l[3] >= 1) && lamps.some((l) => l[3] < 1));
  for (let t = 0; t < 60; t += 0.37) for (let k = 0; k < lamps.length; k++) assert.ok(lampBurns(lamps[k][3], k, t) >= 0 && lampBurns(lamps[k][3], k, t) <= 1);
  // a flickering lamp is sometimes lit and sometimes not
  let on = 0, off = 0;
  for (let t = 0; t < 120; t += 0.1) lampBurns(0.4, 3, t) > 0.5 ? on++ : off++;
  assert.ok(on > 60 && off > 60, `lit ${on}, dark ${off}`);
});

ok('the server knows it as the game does: its places for things come after every other, and its door is where the game puts it', () => {
  const data = buildWorldData(process.cwd());
  const mine = data.lootPoints.filter((p) => p.usage.includes('Bunker'));
  assert.equal(mine.length, bunkerLoot().length);
  assert.ok(data.lootPoints.slice(-mine.length).every((p) => p.usage.includes('Bunker')), 'a place of the bunker among the others');
  for (const p of mine) assert.ok(inBunker(P, p.x, p.y + 0.5, p.z), 'a place for things that is not in the bunker');
  const d = data.bunkerDoor!;
  const [, f, y] = bunkerLocal(P, d[0], d[1], d[2]);
  assert.ok(Math.abs(f - BUNKER.hall.front) < 1e-6 && Math.abs(y - (levelY() + 1.2)) < 1e-6);
  assert.ok(BUNKER.door.open >= 120 && BUNKER.door.open <= 300);
});

console.log(`\n${n} checks passed`);
