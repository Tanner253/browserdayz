// Checks of the rules the infected are kept by (src/sim/infected.ts): what the director
// believes of the games that move them, and what it does not. No network, no world:
// `npx tsx test/infected.test.ts`.

import assert from 'node:assert/strict';
import { Director, INFECTED, I_CHASE, I_DEAD, I_IDLE, infectedDrop, type Home } from '../src/sim/infected';
import { ITEMS } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const homes: Home[] = [{ x: 0, z: 0, r: 30, n: 3 }, { x: 400, z: 0, r: 30, n: 2 }];
/** a director whose bodies stand in a row at their home, so a test knows where each is */
const make = () => {
  let k = 0;
  return new Director(homes, (h) => ({ x: h.x + (k++ % 5) * 2, y: 0, z: h.z }), () => 0.5);
};
const at = (id: number, x: number, z: number) => ({ id, x, z });

ok('they turn up where nobody is standing, and nowhere else', () => {
  const d = make();
  // somebody in the middle of the first place: only the second fills
  let t = d.tick(1000, [at(1, 0, 0)]);
  assert.equal(t.added.length, 2);
  assert.ok(t.added.every((b) => b.s[0] >= 400));
  // they walk off, well clear of it: the first fills too
  t = d.tick(2000, [at(1, 0, 30 + INFECTED.clear + 5)]);
  assert.equal(t.added.length, 3);
  assert.equal(d.bodies.size, 5);
  // and no more than each place holds, however long it goes on
  t = d.tick(900000, []);
  assert.equal(t.added.length, 0);
});

ok('the nearest living player\'s game moves each; nobody\'s, when nobody is near', () => {
  const d = make();
  d.tick(1000, []);
  let t = d.tick(2000, [at(7, 20, 0), at(8, 390, 0)]);
  const own = new Map(t.owned);
  for (const b of d.bodies.values()) assert.equal(b.own, b.s[0] < 100 ? 7 : 8);
  assert.equal(own.size, 5);
  // 7 leaves: theirs are nobody's, and stand still
  t = d.tick(3000, [at(8, 390, 0)]);
  assert.deepEqual(t.owned.map((o) => o[1]), [null, null, null]);
  // somebody a little nearer does not take one off the game that has it; somebody much nearer does
  d.tick(4000, [at(8, 390, 0), at(9, 420, 0)]);
  const first = [...d.bodies.values()].find((b) => b.s[0] >= 400)!;
  assert.equal(first.own, 8);
  d.tick(5000, [at(8, 330, 0), at(9, first.s[0] + 1, 0)]);
  assert.equal(first.own, 9);
});

ok('only the game that moves one is believed about it, and only as far as it could have gone', () => {
  const d = make();
  d.tick(1000, []);
  d.tick(2000, [at(7, 20, 0)]);
  const b = [...d.bodies.values()][0];
  const [x, , z] = b.s;
  // somebody else's word
  assert.equal(d.report(8, [[b.i, x + 1, 0, z, 0, I_CHASE, 8]], 2100).length, 0);
  // a step
  assert.equal(d.report(7, [[b.i, x + 0.5, 0, z, 1, I_CHASE, 7]], 2100).length, 1);
  assert.equal(b.s[4], I_CHASE);
  // a leap across the map in a tenth of a second
  assert.equal(d.report(7, [[b.i, x + 200, 0, z, 1, I_CHASE, 7]], 2200).length, 0);
  assert.ok(Math.abs(b.s[0] - (x + 0.5)) < 1e-9);
  // rubbish of every kind
  assert.equal(d.report(7, [[b.i, NaN, 0, z, 1, I_CHASE, 7], [b.i, x, 0, z, 1, 99, 7], [b.i, x], 'x', null], 2300).length, 0);
  assert.equal(d.report(7, 'nonsense', 2300).length, 0);
  // and it cannot be said to be dead: that is the director's to say
  assert.equal(d.report(7, [[b.i, x + 0.5, 0, z, 1, I_DEAD, 0]], 2300).length, 0);
});

ok('a blow is believed only from beside whoever it hit, and no faster than an arm swings', () => {
  const d = make();
  d.tick(1000, []);
  d.tick(2000, [at(7, 20, 0)]);
  const b = [...d.bodies.values()][0];
  const [x, , z] = b.s;
  // from across the street
  assert.equal(d.strikes(b.i, 7, at(7, x + 12, z), 3000), false);
  // not this game's to say
  assert.equal(d.strikes(b.i, 8, at(8, x + 1, z), 3000), false);
  // beside them
  assert.equal(d.strikes(b.i, 7, at(7, x + 1, z), 3000), true);
  // and again before the arm has come round
  assert.equal(d.strikes(b.i, 7, at(7, x + 1, z), 3000 + INFECTED.swing * 400), false);
  assert.equal(d.strikes(b.i, 7, at(7, x + 1, z), 3000 + INFECTED.swing * 1000), true);
  // nobody there
  assert.equal(d.strikes(b.i, 7, undefined, 9000), false);
});

ok('hit enough it dies, lies a while, is cleared away, and another comes when nobody is looking', () => {
  const d = make();
  d.tick(1000, []);
  d.tick(2000, [at(7, 20, 0)]);
  const b = [...d.bodies.values()][0];
  assert.deepEqual(d.hurt(b.i, 34, 3000), { hp: INFECTED.hp - 34, dead: false });
  assert.equal(d.hurt(b.i, -5, 3000), null);
  const r = d.hurt(b.i, 500, 3000)!;
  assert.deepEqual(r, { hp: 0, dead: true });
  assert.equal(b.s[4], I_DEAD);
  assert.equal(b.own, null);
  // dead is dead: no more hits, no more blows, no more reports
  assert.equal(d.hurt(b.i, 10, 3100), null);
  assert.equal(d.strikes(b.i, 7, at(7, b.s[0], b.s[2]), 9000), false);
  assert.equal(d.report(7, [[b.i, b.s[0], 0, b.s[2], 0, I_IDLE, 0]], 3200).length, 0);
  // it lies there
  assert.deepEqual(d.tick(3000 + INFECTED.linger * 1000 - 500, [at(7, 20, 0)]).gone, []);
  // and is cleared away
  const t = d.tick(3000 + INFECTED.linger * 1000 + 500, [at(7, 20, 0)]);
  assert.deepEqual(t.gone, [b.i]);
  assert.equal(d.bodies.size, 4);
  // another, once its time has come and the place is empty of the living
  const due = 3000 + (INFECTED.linger + INFECTED.respawn) * 1000 + 1500;
  assert.equal(d.tick(due, [at(7, 20, 0)]).added.length, 0);
  assert.equal(d.tick(due + 1000, []).added.length, 1);
  assert.equal(d.bodies.size, 5);
});

ok('what one has on it is a real thing, a sensible number of them, and there about as often as is said', () => {
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  let had = 0;
  const seen = new Set<string>();
  for (let k = 0; k < 20000; k++) {
    const d = infectedDrop(rnd);
    if (!d) continue;
    had++;
    seen.add(d[0]);
    assert.ok(ITEMS[d[0]], d[0]);
    assert.ok(Number.isInteger(d[1]) && d[1] >= 1 && d[1] <= 8, `${d[0]} x ${d[1]}`);
    assert.ok(!ITEMS[d[0]].weapon, 'no guns in dead men\'s pockets');
  }
  assert.ok(Math.abs(had / 20000 - INFECTED.carries) < 0.02, `${had / 20000}`);
  assert.ok(seen.size >= 8);
});

console.log(`${n} checks passed`);
