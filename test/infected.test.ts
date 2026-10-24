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
  // (never twice in one place: two of them standing in one spot could neither of them move, and the director will not have it)
  return new Director(homes, (h) => ({ x: h.x + (k++ % 11) * 2, y: 0, z: h.z }), () => 0.5);
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
  // another, once its time has come (counted from when it went down) and the place is empty of the living: while
  // the body still lies there, as it does for five minutes
  assert.ok(INFECTED.respawn < INFECTED.linger);
  assert.equal(d.tick(3000 + INFECTED.respawn * 1000 - 500, []).added.length, 0);
  assert.equal(d.tick(3000 + INFECTED.respawn * 1000 + 500, [at(7, 20, 0)]).added.length, 0);
  assert.equal(d.tick(3000 + INFECTED.respawn * 1000 + 1500, []).added.length, 1);
  assert.equal(d.bodies.size, 6);
  // it lies there
  assert.deepEqual(d.tick(3000 + INFECTED.linger * 1000 - 500, [at(7, 20, 0)]).gone, []);
  // and is cleared away, with nothing more owed for it
  const t = d.tick(3000 + INFECTED.linger * 1000 + 500, [at(7, 20, 0)]);
  assert.deepEqual(t.gone, [b.i]);
  assert.equal(d.tick(3000 + INFECTED.linger * 1000 * 3, []).added.length, 0);
  assert.equal(d.bodies.size, 5);
});

ok('a body is cleared away by an admin before its time; one alive is not; one an admin stood is owed nobody', () => {
  const d = make();
  d.tick(1000, []);
  const [b, alive] = [...d.bodies.values()];
  assert.equal(d.clear(b.i), false);
  d.hurt(b.i, 500, 2000);
  assert.equal(d.clear(b.i), true);
  assert.equal(d.bodies.has(b.i), false);
  assert.equal(d.clear(b.i), false);
  assert.equal(d.bodies.has(alive.i), true);
  // (its home is still owed one, in its time)
  assert.equal(d.tick(2000 + INFECTED.respawn * 1000 + 500, []).added.length, 1);
  const stray = d.place(30, 0, 30, 3000);
  d.hurt(stray.i, 500, 3000);
  d.clear(stray.i);
  assert.equal(d.tick(3000 + INFECTED.respawn * 1000 * 4, []).added.length, 0);
});

ok('the dead of a home that is told to wait are not put back until it no longer is (the bunker, while its door stands open)', () => {
  const d = make();
  d.tick(1000, []);
  const mine = [...d.bodies.values()].filter((b) => b.home === 0);
  assert.equal(mine.length, 3);
  for (const b of mine) d.hurt(b.i, 500, 2000);
  const open = (h: Home) => h === homes[0];
  const cleared = 2000 + INFECTED.linger * 1000 + 500;
  const t = d.tick(cleared, [], open);
  assert.equal(t.gone.length, 3);
  assert.equal(t.added.length, 0);
  // long past their time, with nobody anywhere near: and the door is open still
  const late = cleared + INFECTED.respawn * 1000 * 5;
  assert.equal(d.tick(late, [], open).added.length, 0);
  assert.equal(d.tick(late + 60000, [], open).added.length, 0);
  // (the other home is nobody's to hold: one killed there comes back as it always did)
  const far = [...d.bodies.values()].find((b) => b.home === 1)!;
  d.hurt(far.i, 500, late);
  assert.equal(d.tick(late + INFECTED.respawn * 1000 + 2000, [], open).added.length, 1);
  // the door shuts: all three are back (and the body of the other still lies there)
  assert.equal(d.tick(late + INFECTED.respawn * 1000 + 3000, [], () => false).added.length, 3);
  assert.equal(d.bodies.size, 6);
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
