// Checks of the bunker (src/sim/bunker.ts) against the world as it is made: where it lies,
// the hole it stands in, what is kept in it. `npx tsx test/bunker.test.ts`.

import assert from 'node:assert/strict';
import { BUNKER, bunkerAt, bunkerDark, bunkerLocal, bunkerPlan, inBunker, lampBurns, levelY } from '../src/sim/bunker';
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

ok('it is laid out by rule, the same every time: two passages, a dozen rooms, every one of them reached', () => {
  const plan = bunkerPlan();
  assert.equal(plan, bunkerPlan());
  assert.ok(plan.rooms.length >= 10 && plan.rooms.length <= 20, `${plan.rooms.length} rooms`);
  const H = BUNKER.hall;
  for (const q of plan.rooms) {
    assert.ok(q.r0 >= -H.r - 1e-6 && q.r1 <= H.r + 1e-6 && q.f0 >= H.back - 1e-6 && q.f1 <= H.front + 1e-6, `${q.name} is outside the walls`);
    assert.ok(q.r1 - q.r0 >= 4.5 && q.f1 - q.f0 >= 4.5, `${q.name} is a cupboard`);
    assert.ok(q.doors.length >= 1, `${q.name} has no way in`);
  }
  // no two rooms share ground
  for (const a of plan.rooms) for (const b of plan.rooms) if (a !== b) assert.ok(a.r1 <= b.r0 + 1e-6 || b.r1 <= a.r0 + 1e-6 || a.f1 <= b.f0 + 1e-6 || b.f1 <= a.f0 + 1e-6, `${a.name} and ${b.name} overlap`);
  // every room is reached from a passage: by a way of its own, or through rooms that are
  const onPassage = (d: [number, number]) => Math.abs(Math.abs(d[0]) - BUNKER.passage) < 0.01 || Math.abs(Math.abs(d[1] - plan.cross) - BUNKER.across) < 0.01;
  const reached = new Set(plan.rooms.filter((q) => q.doors.some(onPassage)));
  for (let pass = 0; pass < 6; pass++) for (const q of plan.rooms) if (!reached.has(q) && q.doors.some((d) => [...reached].some((o) => o.doors.some((e) => e[0] === d[0] && e[1] === d[1])))) reached.add(q);
  assert.equal(reached.size, plan.rooms.length, 'a room nobody can get into');
  // it has the rooms a bunker has
  const kinds = plan.rooms.map((q) => q.kind);
  for (const k of ['plant', 'armoury', 'barracks', 'control', 'mess']) assert.ok(kinds.includes(k as never), `no ${k}`);
  // no doorway is walled up: no wall stands, floor to ceiling, across the middle of a way in
  for (const q of plan.rooms) for (const [dr, df] of q.doors) assert.ok(!plan.walls.some((w) => w.y0 === undefined && dr > w.r0 + 0.05 && dr < w.r1 - 0.05 && df > w.f0 + 0.05 && df < w.f1 - 0.05), `a way into ${q.name} is walled up`);
});

ok('what stands in it stands inside its walls and clear of the ways through; things are kept in it; lamps burn', () => {
  const plan = bunkerPlan(), H = BUNKER.hall;
  const inside = (r: number, f: number) => Math.abs(r) < H.r && f > H.back && f < H.front;
  assert.ok(plan.stood.length >= 60 && plan.made.length >= 40, `${plan.stood.length} things stood, ${plan.made.length} made`);
  for (const st of plan.stood) assert.ok(inside(st.r, st.f), `${st.id} outside the walls`);
  for (const m of plan.made) assert.ok(Math.abs(m.r) <= H.r + 0.1 && m.f >= H.back - 0.1 && m.f <= H.front + 0.1, `${m.kind} outside the walls`);
  // nothing solid stands in a doorway
  const doors = plan.rooms.flatMap((q) => q.doors);
  for (const m of plan.made) if (m.solid !== false && m.kind !== 'pillar') for (const [dr, df] of doors) assert.ok(Math.hypot(m.r - dr, m.f - df) > 0.9, `a ${m.kind} stands in a way through`);
  for (const st of plan.stood) for (const [dr, df] of doors) assert.ok(Math.hypot(st.r - dr, st.f - df) > 0.8, `${st.id} stands in a way through`);
  for (const sp of plan.spots) assert.ok(inside(sp.r, sp.f));
  assert.ok(plan.spots.filter((sp) => sp.floor).length >= 12, 'few places long enough for a shotgun');
  assert.ok(plan.lamps.length >= 20 && plan.lamps.some((l) => l[3] >= 1) && plan.lamps.some((l) => l[3] < 1));
  for (let t = 0; t < 60; t += 0.37) for (let k = 0; k < plan.lamps.length; k++) assert.ok(lampBurns(plan.lamps[k][3], k, t) >= 0 && lampBurns(plan.lamps[k][3], k, t) <= 1);
  let on = 0, off = 0;
  for (let t = 0; t < 120; t += 0.1) lampBurns(0.4, 3, t) > 0.5 ? on++ : off++;
  assert.ok(on > 60 && off > 60, `lit ${on}, dark ${off}`);
});

ok('the server knows it as the game does: its places for things come after every other, its crates are to be searched, and its door is where the game puts it', () => {
  const data = buildWorldData(process.cwd());
  const mine = data.lootPoints.filter((p) => p.usage.includes('Bunker'));
  assert.ok(mine.length >= 70, `${mine.length} places for things in the bunker`);
  assert.ok(data.lootPoints.slice(-mine.length).every((p) => p.usage.includes('Bunker')), 'a place of the bunker among the others');
  for (const p of mine) assert.ok(inBunker(P, p.x, p.y + 0.3, p.z), 'a place for things that is not in the bunker');
  assert.ok(mine.filter((p) => p.floor).length >= 12 && mine.filter((p) => p.surf).length >= 40);
  const d = data.bunkerDoor!;
  const [, f, y] = bunkerLocal(P, d[0], d[1], d[2]);
  assert.ok(Math.abs(f - BUNKER.hall.front) < 1e-6 && Math.abs(y - (levelY() + 1.2)) < 1e-6);
  assert.ok(data.crates.filter((c) => inBunker(P, c.x, c.y + 0.5, c.z)).length >= 4, 'no crates to search in the bunker');
  assert.equal(BUNKER.door.shut, 60);
});

console.log(`\n${n} checks passed`);
