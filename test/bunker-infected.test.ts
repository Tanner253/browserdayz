// Checks of Bunker 17's infected (src/sim/infected.ts): twelve as before, half by its passages to come for the door,
// half still about its rooms (the owner, 2026-10-19), where each is stood, what the still ones carry to every game,
// none put back while the door is open, and the way round its house up top. The world is made, no network:
// `npx tsx test/bunker-infected.test.ts`.

import assert from 'node:assert/strict';
import { generateWorld, bunkerPlace } from '../src/world/worldgen';
import { BUNKER, bunkerLocal, bunkerPlan, bunkerWays, levelY } from '../src/sim/bunker';
import { Director, HOUSE, crosses, homeSpot, infectedHomes, roundHouse } from '../src/sim/infected';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const world = generateWorld();
const P = bunkerPlace(world)!;
const plan = bunkerPlan(), W = bunkerWays();
const homes = infectedHomes(world);
const ours = homes.filter((h) => h.bunker);
const passages = ours.find((h) => !h.still)!, rooms = ours.find((h) => h.still)!;
const local = (s: readonly (number | undefined)[]) => bunkerLocal(P, s[0]!, s[1]!, s[2]!);

ok('twelve shut in the bunker, as before: six by the passages, six still in the rooms', () => {
  assert.equal(ours.length, 2);
  assert.equal(passages.n, 6);
  assert.equal(rooms.n, 6);
  assert.ok(passages.inside!.length >= 7 && rooms.inside!.length >= 12, `${passages.inside!.length} passage spots, ${rooms.inside!.length} room spots`);
  // (and the map's other homes as they were: nothing else is marked the bunker's)
  assert.equal(homes.filter((h) => h.still).length, 1);
});

ok('the passage ones stand in the two passages, this side of the far rooms, on the floor', () => {
  for (const s of passages.inside!) {
    const [r, f, h] = local(s);
    assert.ok(Math.abs(h - levelY()) < 1e-6);
    const part = W.part(r, f, h + 1);
    assert.ok(part === plan.rooms.length || part === plan.rooms.length + 1 || part === plan.rooms.length + 2, `(${r.toFixed(1)}, ${f.toFixed(1)}) is in part ${part}, not a passage`);
    assert.ok(f > plan.cross - 2.5, `(${r.toFixed(1)}, ${f.toFixed(1)}) is past the passage across`);
  }
});

ok('the still ones have spots in every room, out of the doorways and clear of what stands there, and down the far ends of the passages', () => {
  const rs = new Set<number>(), ends: string[] = [];
  for (const s of rooms.inside!) {
    const [r, f, h] = local(s);
    assert.ok(Math.abs(h - levelY()) < 1e-6);
    assert.ok(!plan.stood.some((t) => Math.hypot(t.r - r, t.f - f) < 1.4 - 1e-6), `(${r.toFixed(2)}, ${f.toFixed(2)}) in something standing there: ${plan.stood.filter((t) => Math.hypot(t.r - r, t.f - f) < 1.4).map((t) => `${t.r},${t.f}`)}`);
    assert.ok(!plan.made.some((m) => m.solid !== false && Math.hypot(m.r - r, m.f - f) < 1 + Math.max(m.w, m.d) / 2), 'in something made');
    const k = W.part(r, f, h + 1);
    if (k >= plan.rooms.length) {
      // (a passage: only its far ends, the back of the main one and the ends of the one across)
      assert.ok((Math.abs(r) < BUNKER.passage && f < plan.cross - 8) || Math.abs(r) > 12, `(${r.toFixed(1)}, ${f.toFixed(1)}) in a passage, not at its far end`);
      ends.push(Math.abs(r) < BUNKER.passage ? 'back' : r < 0 ? 'left' : 'right');
      continue;
    }
    rs.add(k);
    const q = plan.rooms[k];
    assert.ok(r > q.r0 + 0.7 && r < q.r1 - 0.7 && f > q.f0 + 0.7 && f < q.f1 - 0.7, 'against a wall');
    assert.ok(q.doors.every(([a, b]) => Math.hypot(a - r, b - f) >= 1.6), 'in a doorway');
  }
  // (all throughout: every room, and all three far ends)
  assert.equal(rs.size, plan.rooms.length, `${rs.size} rooms of ${plan.rooms.length}`);
  assert.deepEqual([...new Set(ends)].sort(), ['back', 'left', 'right']);
});

ok('the six still ones are stood apart, through the whole of it: no two to a room, the far rooms and ends as likely as the near', () => {
  const k = homes.indexOf(rooms);
  let far = 0, n = 0;
  for (let run = 0; run < 40; run++) {
    const d = new Director(homes, (h) => homeSpot(world, h, Math.random));
    for (let t = 0; t < 5; t++) d.tick(t * 1000, []);
    const still = [...d.bodies.values()].filter((b) => b.home === k);
    assert.equal(still.length, 6);
    const at = still.map((b) => local([b.s[0], b.s[1], b.s[2]]));
    const parts = new Set(at.map(([r, f, h]) => W.part(r, f, h + 1)));
    assert.equal(parts.size, 6, 'two in one room or passage');
    for (let a = 0; a < at.length; a++) for (let c = a + 1; c < at.length; c++) assert.ok(Math.hypot(at[a][0] - at[c][0], at[a][1] - at[c][1]) > 6, 'two within six metres');
    // (the far half of the place, behind the passage across: about half of them, not none)
    far += at.filter(([, f]) => f < plan.cross).length;
    n += at.length;
  }
  assert.ok(far / n > 0.35 && far / n < 0.75, `${Math.round((far / n) * 100)}% behind the passage across`);
});

ok('the director stands them all, the still ones marked so for every game, and puts none back while the door is open', () => {
  const k = homes.indexOf(rooms);
  const d = new Director(homes, (h) => homeSpot(world, h, Math.random));
  // nobody near: everything stands that can (a few spots taken twice wait for the next round)
  for (let t = 0; t < 20; t++) d.tick(t * 1000, []);
  const all = [...d.bodies.values()];
  const still = all.filter((b) => b.home === k), pass = all.filter((b) => b.home === homes.indexOf(passages));
  assert.equal(still.length, 6);
  assert.equal(pass.length, 6);
  assert.ok(still.every((b) => b.w === 1) && all.every((b) => b.home === k || !b.w));
  const listed = d.list();
  assert.ok(listed.filter((b) => b.w === 1).length === 6);
  assert.ok(listed.filter((b) => b.w !== undefined).length === 6, 'only the still ones carry it');
  // two killed, one of each: with the door open neither comes back, nor does anybody else's wait on it
  const gone = [still[0], pass[0]];
  for (const b of gone) d.hurt(b.i, 1e6, 30_000);
  const cave = all.find((b) => homes[b.home].inside && !homes[b.home].bunker);
  if (cave) d.hurt(cave.i, 1e6, 30_000);
  const open = (h: { bunker?: boolean }) => !!h.bunker;
  let back = 0, caveBack = 0;
  for (let t = 31; t < 400; t += 5) {
    const turn = d.tick(t * 1000, [], open);
    back += turn.added.filter((b) => homes[b.home].bunker).length;
    caveBack += turn.added.filter((b) => homes[b.home].inside && !homes[b.home].bunker).length;
  }
  assert.equal(back, 0);
  if (cave) assert.equal(caveBack, 1, 'a cave one waited on the bunker door');
  // shut: both come back, the still one still
  let again: number[] = [];
  for (let t = 400; t < 420; t++) again = again.concat(d.tick(t * 1000, []).added.filter((b) => homes[b.home].bunker).map((b) => b.w ?? 0));
  assert.deepEqual(again.sort(), [0, 1]);
});

ok('up top, round the house and its yard, never through it', () => {
  // from the lid behind the house to the way into its yard; from one side of it to the other; from far off in front
  const ways: [number, number, number, number][] = [
    [0, 4, BUNKER.court.open * (HOUSE.r + 1.6), 17.7],
    [8, 14, -8, 14],
    [6, 30, -6, 2],
    [0, 4, 0, 26],
  ];
  for (const [r0, f0, r1, f1] of ways) {
    // walked as a body walks it, a step at a time toward wherever it is told next (the way is asked again every step:
    // asked only at each corner, it hid one that sent them back and forth between two)
    let r = r0, f = f0, steps = 0, walked = 0;
    for (; steps < 400 && Math.hypot(r1 - r, f1 - f) > 0.1; steps++) {
      const c = roundHouse(r, f, r1, f1) ?? [r1, f1];
      assert.ok(!crosses(r, f, c[0], c[1]), `(${r.toFixed(1)}, ${f.toFixed(1)}) told through the house`);
      const d = Math.hypot(c[0] - r, c[1] - f), k = Math.min(1, 0.15 / d);
      r += (c[0] - r) * k;
      f += (c[1] - f) * k;
      walked += Math.min(d, 0.15);
    }
    assert.ok(steps < 400, `(${r0}, ${f0}) to (${r1}, ${f1}) never got there: stuck at (${r.toFixed(1)}, ${f.toFixed(1)})`);
    // (and not the long way round: no more than half as far again as the straight line)
    assert.ok(walked < Math.hypot(r1 - r0, f1 - f0) * 1.5 + 4, `${walked.toFixed(1)} m walked`);
  }
  // with nothing in the way it walks straight
  assert.equal(roundHouse(-10, 0, -10, 30), null);
  assert.equal(roundHouse(10, 2, -10, 2), null);
});

console.log(`${n} passed`);
