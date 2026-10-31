// Grenades (src/sim/grenades.ts): the two there are, the fuse that runs from the pin and not from the throw, the
// one that goes off in the hand, and what the server believes of a blast. First the rules by themselves, with a
// clock that is a number; then the real server on a port of its own, with players over the wire, to see that it
// goes by them. About a minute.
//   npx tsx test/grenades.test.ts
//   npx tsx test/grenades.test.ts rules     the rules by themselves: a second

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { WEAPON_RULES, hitDamage } from '../src/sim/combat';
import { LAUNCHED, NADE, THROWN, fallen, fuseLeft, inHandDamage, judge, launch, letGo, lyingBlast, newThrower, overdue, pullPin, travel, type Vec3 } from '../src/sim/grenades';
import { ITEMS } from '../src/sim/items';
import { TYPES } from '../src/sim/economy';
import { STALLS } from '../src/sim/camp';

/** what the trader camp's stalls sell, and what a thing is worth to them (src/sim/camp.ts) */
const STOCK = Object.values(STALLS).flatMap((s) => s.sells.map((g) => g.id));
const worth = (id: string) => ITEMS[id]?.worth ?? 0;
import { JEEP, carDamage, type VehicleInfo } from '../src/sim/vehicles';
import { generateWorld, heightAt } from '../src/world/worldgen';

let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log('  ok  ' + name);
};
const near = (a: number, b: number, by: number, what: string) => assert.ok(Math.abs(a - b) <= by, `${what}: ${a.toFixed(2)}, and ${b.toFixed(2)} was expected`);

// ------------------------------------------------------------------ the rules by themselves

const stick = ITEMS.grenade, frag = ITEMS.frag;

ok('the frag grenade is a thing: one place in a pocket, and it does more than the stick grenade, a metre further', () => {
  assert.ok(frag && frag.throw && frag.use, 'there is no frag grenade to throw');
  assert.deepEqual([frag.w, frag.h], [1, 1], '"it takes up 1x1 in the inventory"');
  assert.deepEqual([stick.w, stick.h], [1, 3]);
  assert.ok(frag.weight < stick.weight);
  assert.ok(WEAPON_RULES.frag.damage > WEAPON_RULES.grenade.damage, '"does more damage as the stick grenade"');
  assert.ok(WEAPON_RULES.frag.blast! > WEAPON_RULES.grenade.blast!);
  // at every distance either reaches, the frag is the worse to be near
  for (let d = 0; d < WEAPON_RULES.grenade.blast!; d += 0.5) assert.ok(hitDamage('frag', 'torso', d) > hitDamage('grenade', 'torso', d), `at ${d} m`);
  assert.equal(hitDamage('frag', 'torso', WEAPON_RULES.frag.blast!), 0);
  // (what the game's own blast goes by is said twice, on the item and in the rule: the two are one figure)
  for (const d of [stick, frag]) {
    assert.equal(d.throw!.damage, WEAPON_RULES[d.id].damage, `${d.name}: its item and its rule do not agree on what it does`);
    assert.equal(d.throw!.radius, WEAPON_RULES[d.id].blast, `${d.name}: its item and its rule do not agree on how far`);
  }
  assert.deepEqual(Object.keys(THROWN).sort(), ['frag', 'grenade'], 'what is thrown');
});

ok('"2 stick grenades or 1 frag grenade blows up a car"', () => {
  assert.ok(carDamage(WEAPON_RULES.frag) >= JEEP.hp);
  assert.ok(carDamage(WEAPON_RULES.grenade) < JEEP.hp && 2 * carDamage(WEAPON_RULES.grenade) >= JEEP.hp);
});

ok('the stick grenade on the first three steps and the frag on the fourth and fifth, and nowhere else; the trader buys it and does not sell it', () => {
  // (the owner, 2026-10-19: "stick grenades t1-3 regular grenades t4-5". It had been found where the stick grenade was, rarer, from the third step up)
  const s = TYPES.grenade, f = TYPES.frag;
  assert.ok(f, 'the frag grenade is kept nowhere');
  assert.deepEqual([f.at[0], f.at[1], f.at[2]], [0, 0, 0], 'a frag grenade below the fourth step');
  assert.ok(f.at[3] > 0 && f.at[4] > 0, 'no frag grenade on the fourth or the fifth step');
  assert.deepEqual([s.at[3], s.at[4]], [0, 0], 'a stick grenade from the fourth step up');
  assert.ok(s.at[0] > 0 && s.at[1] > 0 && s.at[2] > 0, 'no stick grenade on one of the first three steps');
  assert.ok(f.restock > s.restock);
  assert.deepEqual(f.usage, s.usage);
  assert.ok(worth('frag') > worth('grenade') && !STOCK.includes('frag'));
});

ok('the fuse runs from the pin: what is left when it is thrown is what was not spent in the hand', () => {
  for (const k of Object.values(THROWN)) {
    assert.equal(fuseLeft(k.id, 0), k.fuse, 'a tap: all of it');
    near(fuseLeft(k.id, 2.5), k.fuse - 2.5, 1e-9, 'cooked two and a half seconds');
    assert.equal(fuseLeft(k.id, k.fuse), 0, 'held to the end: it goes off where it is');
    assert.equal(fuseLeft(k.id, k.fuse + 3), 0);
    assert.ok(k.fuse >= 3, '"hold to cook the grenade for multiple seconds": there are not that many');
    assert.ok(k.pull > 0 && k.pull < 1, 'the hands take a moment over the pin, and not long');
  }
  assert.equal(fuseLeft('beans', 1), 0);
});

ok('one that goes off in the hand is the end of whoever held it, whatever they wear', () => {
  for (const id of Object.keys(THROWN)) {
    assert.equal(inHandDamage(id), WEAPON_RULES[id].damage);
    assert.ok(inHandDamage(id) >= 100, `${id}: somebody could hold it to the end and walk away`);
  }
});

ok('nothing a grenade strikes can carry it further than the server allows for', () => {
  // The game's own flight (src/game/grenades.ts), over ground that is level here and a wall there: gravity, and at
  // whatever it strikes it keeps 62 parts in a hundred along the surface and a third of what it had into it.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let go = 0; go < 60; go++) {
    const speed = 5 + rnd() * 30, up = rnd() * 1.2, turn = rnd() * 6.28;
    const v: Vec3 = [Math.cos(turn) * Math.cos(up) * speed, Math.sin(up) * speed, Math.sin(turn) * Math.cos(up) * speed];
    const p: Vec3 = [0, 1.5, 0];
    // (a wall across its way, some metres off, leaning as it happens to; and the ground, which falls away behind where it was thrown from)
    const wall = { n: [-Math.cos(turn), rnd() * 0.6 - 0.3, -Math.sin(turn)] as Vec3, d: 3 + rnd() * 12 };
    const wl = Math.hypot(...wall.n);
    wall.n = wall.n.map((x) => x / wl) as Vec3;
    const bounce = (n: Vec3) => {
      const into = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
      if (into >= 0) return;
      for (let k = 0; k < 3; k++) v[k] = (v[k] - into * n[k]) * 0.62 - into * 0.32 * n[k];
    };
    const h = 1 / 120;
    for (let t = h; t <= 4; t += h) {
      v[1] -= NADE.fall * h;
      for (let k = 0; k < 3; k++) p[k] += v[k] * h;
      const floor = p[0] < -2 ? -6 : 0;
      if (p[1] < floor) {
        p[1] = floor;
        bounce([0, 1, 0]);
      }
      const past = p[0] * wall.n[0] + p[1] * wall.n[1] + p[2] * wall.n[2] + wall.d;
      if (past < 0) {
        for (let k = 0; k < 3; k++) p[k] -= past * wall.n[k];
        bounce(wall.n);
      }
      const gone = Math.hypot(p[0], p[1] - 1.5, p[2]);
      // (flown in steps of a hundred-and-twentieth of a second, as the game flies it, a fall is ahead of the true
      // one by half a step's worth of speed: sixteen centimetres in four seconds, inside what the server lets go)
      assert.ok(gone <= travel(speed, t) + 0.5 * NADE.fall * h * t + 1e-6, `thrown at ${speed.toFixed(1)} m/s, ${gone.toFixed(2)} m off after ${t.toFixed(2)} s, and ${travel(speed, t).toFixed(2)} is all it is allowed`);
    }
  }
  assert.equal(travel(0, 0), 0);
  assert.ok(travel(15, 1) < travel(15, 2) && travel(15, 1) < travel(20, 1));
});

// (a thrower standing at the origin; `at` is somebody's chest, so many metres off along x)
const FEET: Vec3 = [0, 0, 0], HAND: Vec3 = [0.2, 1.5, -0.5], T0 = 1_000_000;
const chest = (m: number): Vec3 => [m, 1.1, 0];
const FUSE = THROWN.frag.fuse * 1000;

ok('the server: a grenade is nothing until its pin is out, and its fuse is the server\'s own count from then', () => {
  const t = newThrower();
  assert.equal(letGo(t, HAND, [10, 3, 0], FEET, T0), null, 'a grenade was thrown whose pin was never pulled');
  assert.equal(pullPin(t, 'beans', T0), 'what');
  assert.equal(pullPin(t, 'frag', T0), 'ok');
  assert.equal(pullPin(t, 'frag', T0 + 900), 'held', 'two pins out in one hand');
  // it leaves from where its thrower is, no faster than an arm throws: said otherwise, it has not left
  assert.equal(letGo(t, [30, 1.5, 0], [10, 3, 0], FEET, T0 + 1000), null, 'a grenade left the hand thirty metres from its thrower');
  assert.equal(letGo(t, [0, 40, 0], [10, 3, 0], FEET, T0 + 1000), null, 'a grenade left the hand forty metres over its thrower');
  assert.equal(letGo(t, HAND, [NADE.most + 1, 0, 0], FEET, T0 + 1000), null, 'a grenade left the hand faster than anything is thrown');
  assert.ok(t.held, 'a throw that was not believed took the pin back');
  // cooked two and a half seconds by the server's clock: a second and a half is what everybody is told it has left
  const out = letGo(t, HAND, [10, 3, 0], FEET, T0 + 2500);
  assert.ok(out && out.w === 'frag' && !out.hand);
  near(out.left, 1.5, 1e-9, 'what is left of a fuse cooked 2.5 s');
  assert.deepEqual(out.o, HAND);
  assert.equal(letGo(t, HAND, [10, 3, 0], FEET, T0 + 2600), null, 'one pin, two grenades');
  // (and the next pin is not pulled the moment after the last)
  const u = newThrower();
  assert.equal(pullPin(u, 'grenade', T0), 'ok');
  assert.ok(letGo(u, HAND, [10, 3, 0], FEET, T0 + 10));
  assert.equal(pullPin(u, 'grenade', T0 + NADE.gap - 1), 'soon');
  assert.equal(pullPin(u, 'grenade', T0 + NADE.gap), 'ok');
});

ok('the server: a blast is believed when the fuse ends and not before, of each body once, and of twelve people at the most', () => {
  const t = newThrower();
  pullPin(t, 'frag', T0);
  letGo(t, HAND, [10, 3, 0], FEET, T0 + 50);
  // (the old rule believed this: a hit claimed the moment after the throw)
  assert.equal(judge(t, 'frag', 'p2', chest(5), 0, T0 + 100), null, 'a blast was believed as the grenade left the hand');
  assert.equal(judge(t, 'frag', 'p2', chest(5), 0, T0 + FUSE - NADE.early - 1), null, 'a blast was believed before its fuse had run');
  assert.equal(judge(t, 'grenade', 'p2', chest(5), 3, T0 + FUSE), null, 'a frag grenade was thrown and a stick grenade\'s blast believed');
  assert.equal(judge(t, 'frag', 'p2', chest(5), 3, T0 + FUSE), 3, 'a blast at the end of its fuse was not believed');
  assert.equal(judge(t, 'frag', 'p2', chest(5), 0, T0 + FUSE + 10), null, 'one blast reached the same body twice');
  // (an infected and a car are bodies of their own; a car is reached from seven tenths as far)
  assert.equal(judge(t, 'frag', 'i2', chest(5), 1, T0 + FUSE + 10), 1);
  assert.equal(judge(t, 'frag', 'v2', chest(5), 0, T0 + FUSE + 10, 7), 0);
  assert.equal(judge(t, 'frag', 'v2', chest(5), 0, T0 + FUSE + 20, 7), null, 'one blast took a car twice');
  for (let k = 3; k < 2 + NADE.people; k++) assert.notEqual(judge(t, 'frag', `p${k}`, chest(5), 2, T0 + FUSE + 20), null, `player ${k}`);
  assert.equal(judge(t, 'frag', 'p99', chest(5), 2, T0 + FUSE + 20), null, `one blast reached more than ${NADE.people} people`);
  assert.equal(judge(t, 'frag', 'p100', chest(5), Number.NaN, T0 + FUSE + 20), null);
  // and long after, it is forgotten
  const late = newThrower();
  pullPin(late, 'frag', T0);
  letGo(late, HAND, [10, 3, 0], FEET, T0 + 50);
  assert.equal(judge(late, 'frag', 'p2', chest(5), 0, T0 + FUSE + NADE.late + 1), null, 'a blast was believed long after its fuse had run');
  assert.equal(late.flown.length, 0);
});

ok('the server: a blast is no further from the hand than the grenade can have flown, and hurts as from no nearer than that', () => {
  // Cooked to its last 0.4 s and thrown as an arm throws: about twelve metres is the furthest it can be when it goes off.
  const cooked = () => {
    const t = newThrower();
    pullPin(t, 'frag', T0);
    letGo(t, HAND, [14, 5, 0], FEET, T0 + FUSE - 400);
    return t;
  };
  const speed = Math.hypot(14, 5), reach = travel(speed, (400 + NADE.lag) / 1000);
  assert.ok(reach > 8 && reach < 14, `${reach.toFixed(1)} m`);
  const from = (m: number) => Math.hypot(m - HAND[0], 1.1 - HAND[1], 0 - HAND[2]);
  // within its flight: the game's word for how near stands
  assert.equal(judge(cooked(), 'frag', 'p2', chest(6), 0, T0 + FUSE), 0);
  // beyond its flight and inside its blast: believed, but as from no nearer than it can have got
  const got = judge(cooked(), 'frag', 'p2', chest(18), 0, T0 + FUSE);
  assert.ok(got !== null);
  near(got, from(18) - reach - NADE.slack, 1e-6, 'the nearest a blast is believed to somebody 18 m from the hand');
  assert.ok(hitDamage('frag', 'torso', got) < WEAPON_RULES.frag.damage * 0.75, 'said to be at the middle of a blast that cannot have been within four metres, and hurt as if they were');
  // (and a game that says further is taken at its word: it is never made to hurt more than it says)
  assert.equal(judge(cooked(), 'frag', 'p2', chest(18), 9, T0 + FUSE), 9);
  // beyond its flight and its blast together: not reached at all (thirty metres while the frag's blast was ten)
  const beyond = Math.ceil(reach + WEAPON_RULES.frag.blast! + NADE.slack + 2);
  assert.equal(judge(cooked(), 'frag', 'p2', chest(beyond), 0, T0 + FUSE), null, `a grenade with 0.4 s left reached somebody ${beyond} metres off`);
  // (thrown with all its fuse it can have gone a long way, and the game's word stands: this is what is on trust)
  const tap = newThrower();
  pullPin(tap, 'frag', T0);
  letGo(tap, HAND, [14, 5, 0], FEET, T0 + 30);
  assert.equal(judge(tap, 'frag', 'p2', chest(30), 0, T0 + FUSE), 0);
});

ok('the M32 and its 40 mm grenades: admin only (found nowhere, sold by nobody), fired not thrown, a stack of fifty', () => {
  const m32 = ITEMS.m32, round = ITEMS.ammo_40mm;
  assert.ok(m32?.weapon?.launches === 'ammo_40mm' && LAUNCHED.ammo_40mm, 'the M32 fires 40 mm grenades');
  assert.equal(round.stack, 50, '"ammo stack to 50 for the grenade launcher"');
  assert.ok(!TYPES.m32 && !TYPES.ammo_40mm, 'neither is loot anywhere');
  assert.ok(!STOCK.includes('m32') && !STOCK.includes('ammo_40mm'), 'nor sold');
  assert.ok(WEAPON_RULES.ammo_40mm?.blast, 'its blast has a rule');
});

ok('the server: a launched grenade leaves from where its player stands, no faster than its launcher fires, and not twice in a fifth of a second', () => {
  const t = newThrower(), feet: Vec3 = [0, 0, 0], now = 1e6, v: Vec3 = [0, 0, -LAUNCHED.ammo_40mm.speed];
  assert.equal(launch(t, 'ammo_40mm', [9, 1.6, 0], v, feet, now), null, 'not from nine metres off');
  assert.equal(launch(t, 'ammo_40mm', [0, 1.6, 0], [0, 0, -200], feet, now), null, 'not faster than it fires');
  assert.equal(launch(t, 'frag', [0, 1.6, 0], v, feet, now), null, 'a frag is thrown, not launched');
  assert.ok(launch(t, 'ammo_40mm', [0, 1.6, 0], v, feet, now), 'from the shoulder, at its speed');
  assert.equal(launch(t, 'ammo_40mm', [0, 1.6, 0], v, feet, now + 100), null, 'not a tenth of a second after the last');
  assert.ok(launch(t, 'ammo_40mm', [0, 1.6, 0], v, feet, now + 300), 'a third of a second after');
});

ok('the server: the blast of a launched grenade is believed when it strikes, no further than it can have flown by then, and of each body once', () => {
  const t = newThrower(), now = 2e6, speed = LAUNCHED.ammo_40mm.speed;
  launch(t, 'ammo_40mm', [0, 1.6, 0], [0, 0, -speed], [0, 0, 0], now);
  // (half a second on, with a quarter more for the line, it can be some sixty metres away: a body eighty off is not reached, one forty off is)
  assert.equal(judge(t, 'ammo_40mm', 'p1', [0, 1.1, -80], 2, now + 500), null, 'not eighty metres off half a second on');
  const far = judge(t, 'ammo_40mm', 'p2', [0, 1.1, -38], 2, now + 500);
  assert.ok(far !== null && far >= 2, 'believed forty metres off half a second on: ' + far);
  assert.equal(judge(t, 'ammo_40mm', 'p2', [0, 1.1, -38], 2, now + 520), null, 'and not twice of the one body');
  assert.equal(judge(t, 'ammo_40mm', 'p3', [0, 1.1, -38], 2, now + (LAUNCHED.ammo_40mm.flight + 4) * 1000), null, 'nor long after it can have been in the air');
});

ok('the server: a pin out and a fuse run down with nothing thrown is a grenade that went off in the hand, where its holder stands', () => {
  const t = newThrower();
  pullPin(t, 'grenade', T0);
  const fuse = THROWN.grenade.fuse * 1000;
  assert.equal(overdue(t, FEET, T0 + fuse + NADE.silent - 1), null, 'said to have gone off in the hand while its game may still say it was thrown');
  const went = overdue(t, [3, 0, 4], T0 + fuse + NADE.silent);
  assert.ok(went && went.hand && went.w === 'grenade' && went.speed === 0);
  assert.deepEqual(went.from, [3, NADE.hand, 4], 'it went off somewhere other than where its holder stands');
  assert.equal(t.held, null);
  assert.equal(overdue(t, FEET, T0 + fuse + NADE.silent + 500), null, 'it went off twice');
  // (a game that said nothing of its own grenade for that long is not then believed about whom it reached)
  assert.ok(NADE.silent > NADE.late);
  assert.equal(judge(t, 'grenade', 'p2', [4, 1.1, 4], 0, T0 + fuse + NADE.silent + 100), null, 'a game that said nothing of its grenade was believed about whom it reached');
  assert.equal(letGo(t, [3, 1.5, 4], [10, 3, 0], [3, 0, 4], T0 + fuse + NADE.silent + 200), null, 'a grenade was thrown after it had gone off in the hand');

  // its own game says so, as an honest one does: a grenade that has "left the hand" at the end of its fuse and is not moving
  const own = newThrower();
  pullPin(own, 'frag', T0);
  // (nothing is let fall with its fuse still running: a grenade that is not moving is one in the hand, and is believed only at the end)
  assert.equal(letGo(own, [7.2, 3.5, 6.5], [0, 0, 0], [7, 2, 7], T0 + 1500), null, 'a grenade was let fall at its holder\'s feet with most of its fuse to run');
  assert.ok(own.held);
  const said = letGo(own, [7.2, 3.5, 6.5], [0, 0, 0], [7, 2, 7], T0 + FUSE + 40);
  assert.ok(said && said.hand && said.left === 0);
  assert.deepEqual(said.o, [7, 2 + NADE.hand, 7], 'the server took the game\'s word for where its holder stood');
  // whom it reached is still its game's to say, but the server knows where it was: to within what is let go for where anybody stands
  const d = Math.hypot(10 - 7, 3.1 - (2 + NADE.hand), 3 - 7) - travel(0, NADE.lag / 1000);
  near(judge(own, 'frag', 'p2', [10, 3.1, 3], 0, T0 + FUSE + 60)!, d - NADE.slack, 1e-6, 'how near a blast in the hand is believed to somebody five metres off');
  assert.equal(judge(own, 'frag', 'p3', [7 + WEAPON_RULES.frag.blast! + NADE.slack + 1.5, 3.1, 7], 0, T0 + FUSE + 60), null, 'a blast in the hand reached further than a blast reaches');
  // (its word may come a moment before the server's own count ends: it is the same grenade in the same hand)
  const soon = newThrower();
  pullPin(soon, 'frag', T0);
  assert.ok(letGo(soon, HAND, [0, 0, 0], FEET, T0 + FUSE - 200)?.hand);
  // (thrown in the last instant, the word of it coming a moment late: it went off as it left, and was not in the hand)
  const last = newThrower();
  pullPin(last, 'frag', T0);
  const thrown = letGo(last, HAND, [14, 5, 0], FEET, T0 + FUSE + 40);
  assert.ok(thrown && !thrown.hand && thrown.left === 0);
  assert.equal(judge(last, 'frag', 'p2', chest(30), 0, T0 + FUSE + 60), null, 'a grenade that went off as it left the hand reached somebody thirty metres off');
  assert.notEqual(judge(last, 'frag', 'p2', chest(8), 0, T0 + FUSE + 60), null);
});

ok('the server: whoever dies with the pin out lets go of it; it falls where they fell and goes off when its fuse ends, and no game is asked anything of it', () => {
  const t = newThrower();
  assert.equal(fallen(t, FEET, T0), null, 'something fell from a hand that held nothing live');
  pullPin(t, 'frag', T0);
  const fell = fallen(t, [5, 2, 9], T0 + 1500);
  assert.ok(fell && fell.w === 'frag', 'a grenade with its pin out went with whoever held it');
  near(fell.left, (FUSE - 1500) / 1000, 1e-9, 'the fuse it has left as it falls: the one that was running, by the server\'s count from the pin');
  assert.deepEqual(fell.from, [5, 2 + NADE.hand, 9], 'it fell from somewhere other than the hand of whoever died');
  assert.deepEqual(fell.lies, [5, 2 + NADE.lies, 9], 'it lies somewhere other than where they fell');
  assert.equal(t.held, null);
  // (it is nobody's any more: not to throw, not to say went off in the hand, not to say whom it reached)
  assert.equal(letGo(t, [5, 3.5, 9], [10, 3, 0], [5, 2, 9], T0 + 1600), null, 'a dead hand threw it');
  assert.equal(overdue(t, [5, 2, 9], T0 + FUSE + NADE.silent), null, 'it went off in the hand as well');
  assert.equal(judge(t, 'frag', 'p2', [6, 3.1, 9], 0, T0 + FUSE), null, 'its dead holder\'s game was believed about whom it reached');
  // whom it reaches is the server's to reckon: by how far each stands from where it lies, as any blast is
  assert.equal(lyingBlast('frag', fell.lies, fell.lies), WEAPON_RULES.frag.damage);
  near(lyingBlast('frag', fell.lies, [5 + 3, 2 + NADE.lies, 9 + 4]), hitDamage('frag', 'torso', 5), 1e-9, 'five metres from a frag grenade lying on the ground');
  assert.equal(lyingBlast('frag', fell.lies, [5 + WEAPON_RULES.frag.blast!, 2 + NADE.lies, 9]), 0, 'it reached further than its blast does');
  assert.ok(lyingBlast('grenade', fell.lies, [8, 3.1, 9]) < lyingBlast('frag', fell.lies, [8, 3.1, 9]));
  assert.equal(lyingBlast('beans', fell.lies, fell.lies), 0);
  // (died as the fuse ended, or after: it goes off as they fall)
  const late = newThrower();
  pullPin(late, 'grenade', T0);
  assert.equal(fallen(late, FEET, T0 + THROWN.grenade.fuse * 1000 + 300)!.left, 0);
});

if (process.argv[2] === 'rules') {
  console.log(`\n${checks} checks passed`);
  process.exit(0);
}

// ------------------------------------------------------------------ the real server

const PORT = 8157;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  x = 0;
  z = 0;
  private here: ReturnType<typeof setInterval> | null = null;
  constructor(public name: string, public key = `grenade-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    if (!w) return false;
    this.id = w.you;
    return true;
  }
  send(m: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  /** stands somewhere, and goes on saying so as a game does (until `quiet`) */
  stand(x: number, z: number) {
    this.x = x;
    this.z = z;
    const say = () => this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w: null, m: [] });
    say();
    this.quiet();
    this.here = setInterval(say, 250);
    this.send({ t: 'me', inv: { slots: {}, active: null, containers: [] }, vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  }
  /** their game says no more of where they are: a tab behind another */
  quiet() {
    if (this.here) clearInterval(this.here);
    this.here = null;
  }
  feet(): Vec3 {
    return [this.x, ground(this.x, this.z), this.z];
  }
  chest(): Vec3 {
    return [this.x, ground(this.x, this.z) + 1.1, this.z];
  }
  /** where a grenade leaves this player's hand */
  hand(): Vec3 {
    return [this.x, ground(this.x, this.z) + 1.5, this.z];
  }
  since(mark: number) {
    return this.got.slice(mark);
  }
  dmg(mark: number) {
    return this.since(mark).filter((m) => m.t === 'dmg') as Extract<S2C, { t: 'dmg' }>[];
  }
  nades(mark: number) {
    return this.since(mark).filter((m) => m.t === 'nade') as Extract<S2C, { t: 'nade' }>[];
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-grenades-'));
// (the site it would report to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0',
    // (Ben, Cy and Dee, the targets, take blast after blast that would kill anybody, to measure each: the server's own
    // kill of a body past its health leaves them up, server/gate.ts standing; Ada it does not)
    STANDING_SPARE: ['Ben', 'Cy', 'Dee'].map((name, k) => `grenade-test-key-${name}-${String(k + 2).padStart(20, '0')}`).join(','),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
const all: Player[] = [];
try {
  for (let k = 0; k < 1800 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);

  // Ada throws. Ben stands six metres from her, Cy sixteen, Dee thirty.
  const ada = new Player('Ada'), ben = new Player('Ben'), cy = new Player('Cy'), dee = new Player('Dee');
  all.push(ada, ben, cy, dee);
  for (const p of all) assert.ok(await p.join(), `${p.name} was not let in:\n${logged.slice(-400)}`);
  ada.stand(60, 0);
  ben.stand(66, 0);
  cy.stand(76, 0);
  // (forty metres from Ada: beyond the frag's flight and its blast of twenty since 2026-10-19; it was thirty)
  dee.stand(100, 0);
  await sleep(600);
  const fuse = THROWN.frag.fuse * 1000;
  const hit = (to: Player, w: string, dist: number) => ada.send({ t: 'hit', to: to.id, zone: 'torso', w, dist, sup: false, bonus: 0 });

  // ---- no pin, no grenade
  {
    const mark = ben.got.length;
    ada.send({ t: 'nade', o: ada.hand(), v: [10, 3, 0] });
    await sleep(300);
    hit(ben, 'frag', 0);
    hit(ben, 'grenade', 0);
    await sleep(400);
    assert.equal(ben.nades(mark).length, 0, 'everybody was shown a grenade whose pin was never pulled');
    assert.equal(ben.dmg(mark).length, 0, 'a blast was believed of a grenade whose pin was never pulled');
    checks++;
    console.log('  ok  over the wire: a grenade thrown with no pin pulled is shown to nobody and hurts nobody');
  }

  // ---- cooked a second and a half, thrown: the fuse is the server's count; the blast is believed when it ends, once
  {
    const mark = ben.got.length;
    const pin = Date.now();
    ada.send({ t: 'pin', w: 'frag' });
    await sleep(1500);
    ada.send({ t: 'nade', o: ada.hand(), v: [10, 3, 0] });
    await sleep(250);
    const seen = ben.nades(mark);
    assert.equal(seen.length, 1, 'a grenade that left the hand was not shown to everybody else, once');
    assert.equal(seen[0].w, 'frag', 'everybody was not told which grenade it is');
    near(seen[0].f, (fuse - 1500) / 1000, 0.25, 'the fuse everybody is told a grenade cooked 1.5 s has left');
    assert.equal(seen[0].id, ada.id);
    // (as the old rule had it: a hit, the moment after the throw)
    hit(ben, 'frag', 0);
    await sleep(300);
    assert.equal(ben.dmg(mark).length, 0, 'a blast was believed before the fuse had run by the server\'s count');
    await sleep(Math.max(0, pin + fuse + 100 - Date.now()));
    hit(ben, 'frag', 2);
    hit(ben, 'frag', 0);
    hit(ben, 'frag', 0);
    await sleep(400);
    const took = ben.dmg(mark);
    assert.equal(took.length, 1, `one blast hurt the same body ${took.length} times`);
    assert.equal(took[0].w, 'frag');
    near(took[0].amount, hitDamage('frag', 'torso', 2), 0.01, 'what a frag grenade does from two metres');
    assert.ok(took[0].amount > hitDamage('grenade', 'torso', 2));
    // (and long after, nothing more is believed of it)
    await sleep(NADE.late + 300);
    hit(cy, 'frag', 0);
    await sleep(300);
    assert.equal(cy.dmg(0).length, 0, 'a blast was believed long after its fuse had run');
    checks++;
    console.log(`  ok  over the wire: cooked 1.5 s, everybody is told ${seen[0].f.toFixed(2)} s are left; its blast is believed at the end of the fuse and not before, of a body once (${took[0].amount.toFixed(0)} from 2 m)`);
  }

  // ---- cooked to its last 0.4 s: it cannot have gone far, and the server holds its game to that
  {
    const marks = [ben, cy, dee].map((p) => p.got.length);
    const pin = Date.now();
    ada.send({ t: 'pin', w: 'frag' });
    await sleep(fuse - 400);
    const v: Vec3 = [14, 5, 0];
    ada.send({ t: 'nade', o: ada.hand(), v });
    await sleep(Math.max(0, pin + fuse + 50 - Date.now()));
    for (const p of [ben, cy, dee]) hit(p, 'frag', 0);
    await sleep(500);
    const [b, c, d] = [ben, cy, dee].map((p, k) => p.dmg(marks[k]));
    assert.equal(b.length, 1);
    near(b[0].amount, WEAPON_RULES.frag.damage, 0.01, 'somebody inside its flight, said to be at the middle of it');
    assert.equal(d.length, 0, 'a grenade with 0.4 s left reached somebody forty metres from the hand');
    assert.equal(c.length, 1, 'somebody sixteen metres from the hand, inside its flight and its blast together, was not reached');
    // (the server heard the throw a few ms either side of when it was sent: what it allows for the flight is within a metre or so of this)
    const least = Math.hypot(cy.x - ada.x, cy.chest()[1] - ada.hand()[1]) - travel(Math.hypot(...v), (400 + NADE.lag) / 1000) - NADE.slack;
    assert.ok(least > 1, `the test is set too near: ${least.toFixed(2)}`);
    near(c[0].amount, hitDamage('frag', 'torso', least), 30, 'what is done to somebody the blast cannot have been near, said to be at the middle of it');
    assert.ok(c[0].amount < WEAPON_RULES.frag.damage * 0.95, 'the game\'s word was taken for a blast nearer than the grenade can have got');
    checks++;
    console.log(`  ok  over the wire: cooked to its last 0.4 s, it reaches nobody 40 m off, and somebody 16 m off as from no nearer than it can have flown (${c[0].amount.toFixed(0)}, not ${WEAPON_RULES.frag.damage})`);
  }

  // ---- held to the end: its game says it went off in the hand, and the server puts it where it has its holder standing
  {
    const mark = ben.got.length, logMark = logged.length;
    const pin = Date.now();
    ada.send({ t: 'pin', w: 'grenade' });
    const due = pin + THROWN.grenade.fuse * 1000;
    // (not moving, with most of its fuse to run: nothing is let fall, and nobody is shown anything)
    await sleep(1000);
    ada.send({ t: 'nade', o: ada.hand(), v: [0, 0, 0] });
    await sleep(due + 60 - Date.now());
    assert.equal(ben.nades(mark).length, 0, 'a grenade was let fall at its holder\'s feet with its fuse still running');
    // (said as a grenade that has left the hand and is not moving; and said, falsely, to be three metres off to one side)
    ada.send({ t: 'nade', o: [ada.x, ada.hand()[1], ada.z + 3], v: [0, 0, 0] });
    await sleep(300);
    const seen = ben.nades(mark);
    assert.equal(seen.length, 1, 'a grenade held to the end of its fuse was not shown going off');
    assert.equal(seen[0].f, 0);
    assert.deepEqual(seen[0].v, [0, 0, 0]);
    assert.equal(seen[0].w, 'grenade');
    near(Math.hypot(seen[0].o[0] - ada.x, seen[0].o[1] - (ada.feet()[1] + NADE.hand), seen[0].o[2] - ada.z), 0, 0.01, 'how far from where the server has its holder a grenade in the hand went off');
    // its game says whom it reached: believed as from where the server put it, to within what is let go for where anybody stands
    hit(ben, 'grenade', 0);
    hit(dee, 'grenade', 0);
    await sleep(400);
    const took = ben.dmg(mark);
    assert.equal(took.length, 1);
    const d = Math.hypot(ben.x - ada.x, ben.chest()[1] - (ada.feet()[1] + NADE.hand)) - travel(0, NADE.lag / 1000) - NADE.slack;
    near(took[0].amount, hitDamage('grenade', 'torso', d), 0.5, 'what a stick grenade in a hand six metres off does, whatever its game says');
    assert.ok(took[0].amount < WEAPON_RULES.grenade.damage * 0.6);
    // Ada's game goes on saying she stands there, unhurt: the server has counted all of it against her, through no armour
    await sleep(2400);
    assert.match(logged.slice(logMark), /Ada is on their feet after \d+ of damage their armour does not stop/, 'whoever held a grenade to the end and stood there was not found out');
    // (and killed for it, whatever the checks' mode, 2026-10-28: then back, where she stood, for what comes next)
    assert.ok(ben.got.some((m) => m.t === 'death' && m.k.id === ada.id), 'whoever held a grenade to the end and stood there was not killed by the server');
    ada.send({ t: 'respawn' });
    await sleep(600);
    ada.stand(60, 0);
    await sleep(600);
    checks++;
    console.log(`  ok  over the wire: held to the end, it is shown going off where the server has its holder, its blast is believed from there (${took[0].amount.toFixed(0)} at 6 m), and its holder is killed for having taken all of it`);
  }

  // ---- and one whose game has stopped answering dies of it, by the server's hand
  {
    const eve = new Player('Eve');
    all.push(eve);
    assert.ok(await eve.join());
    eve.stand(60, 30);
    await sleep(500);
    const mark = ben.got.length;
    eve.send({ t: 'pin', w: 'frag' });
    eve.quiet();
    await sleep(fuse + NADE.silent + 1200);
    assert.equal(ben.nades(mark).filter((m) => m.id === eve.id && m.f === 0).length, 1, 'the grenade of somebody whose game went quiet was never seen to go off');
    const died = ben.since(mark).find((m) => m.t === 'death' && m.k.id === eve.id);
    assert.ok(died, `somebody whose game went quiet with a pin out did not die of it:\n${logged.slice(-400)}`);
    checks++;
    console.log('  ok  over the wire: a pin pulled and a game gone quiet: the grenade goes off in that hand, and they die of it');
  }

  // ---- a pin out, and its holder dies: the grenade falls where they fell and goes off when its fuse ends, for whoever is in reach
  {
    const gil = new Player('Gil'), hal = new Player('Hal');
    all.push(gil, hal);
    for (const p of [gil, hal]) assert.ok(await p.join());
    gil.stand(40, 40);
    hal.stand(45, 40);
    await sleep(500);
    const mark = hal.got.length, far = [ben, dee].map((p) => p.got.length);
    const pin = Date.now();
    gil.send({ t: 'pin', w: 'frag' });
    await sleep(1000);
    gil.send({ t: 'died', cause: 'the test' });
    gil.quiet();
    await sleep(400);
    const seen = hal.nades(mark).filter((m) => m.id === gil.id);
    assert.equal(seen.length, 1, 'a grenade that fell from a dead hand was not shown to everybody else, once');
    assert.equal(seen[0].w, 'frag');
    assert.deepEqual(seen[0].v, [0, 0, 0]);
    near(seen[0].f, (fuse - 1000) / 1000, 0.25, 'the fuse a grenade has left as it falls from a dead hand');
    near(Math.hypot(seen[0].o[0] - gil.x, seen[0].o[1] - (gil.feet()[1] + NADE.hand), seen[0].o[2] - gil.z), 0, 0.01, 'how far from where its holder died it fell');
    assert.equal(hal.dmg(mark).length, 0, 'it went off before its fuse had run');
    // (the dead say nothing that is believed: its holder's game is not asked whom it reached, and says so in vain)
    gil.send({ t: 'hit', to: dee.id, zone: 'torso', w: 'frag', dist: 0, sup: false, bonus: 0 });
    await sleep(Math.max(0, pin + fuse + 300 - Date.now()));
    const took = hal.dmg(mark);
    assert.equal(took.length, 1, `somebody five metres from a grenade a dead hand let fall was reached by it ${took.length} times`);
    const d = Math.hypot(hal.x - gil.x, hal.chest()[1] - (gil.feet()[1] + NADE.lies), hal.z - gil.z);
    near(took[0].amount, hitDamage('frag', 'torso', d), 0.01, 'what a frag grenade lying five metres off does, by the server\'s own reckoning');
    assert.equal(took[0].w, 'frag');
    assert.equal(took[0].from, gil.id, 'it was not the doing of whoever let it fall');
    assert.deepEqual([ben, dee].map((p, k) => p.dmg(far[k]).length), [0, 0], 'it reached somebody fifty metres off');
    // and whoever dies of it was killed by its dead holder
    hal.send({ t: 'died', cause: 'wounds' });
    await sleep(400);
    const death = ben.got.find((m) => m.t === 'death' && m.k.id === hal.id) as Extract<S2C, { t: 'death' }> | undefined;
    assert.ok(death && death.k.by === gil.id && death.k.w === 'frag', `whoever died of it was not said killed by its holder: ${JSON.stringify(death?.k)}`);
    checks++;
    console.log(`  ok  over the wire: a pin out and its holder dies: everybody is shown it fall there with ${seen[0].f.toFixed(2)} s left; it goes off when they have run, and the server reckons whom it reached (${took[0].amount.toFixed(0)} at 5 m) and whose doing it was`);
  }

  // ---- "2 stick grenades or 1 frag grenade blows up a car": and a car takes one grenade once, however often it is said
  {
    const cars = ((ada.got.find((m) => m.t === 'welcome') as { vehicles?: VehicleInfo[] }).vehicles ?? []).filter((v) => !v.k && v.hp > 0);
    assert.ok(cars.length >= 2, 'no two jeeps to try it on');
    // (a car going up three metres from Ada kills her now, as it would anybody: she is brought back before the next)
    let since = ben.got.length;
    const beside = async (car: VehicleInfo, w: string, says: number) => {
      // (after the server's grace for a heal, in which a body past its health is still up: server/gate.ts standing)
      await sleep(2000);
      if (ben.got.slice(since).some((m) => m.t === 'death' && m.k.id === ada.id)) {
        ada.send({ t: 'respawn' });
        await sleep(600);
      }
      since = ben.got.length;
      ada.stand(car.s[0] + 3, car.s[2]);
      await sleep(700);
      const mark = ben.got.length;
      const pin = Date.now();
      ada.send({ t: 'pin', w });
      await sleep(300);
      ada.send({ t: 'nade', o: ada.hand(), v: [-3, 1, 0] });
      await sleep(200);
      ada.send({ t: 'vhit', i: car.i, w });
      await sleep(Math.max(0, pin + THROWN[w].fuse * 1000 + 100 - Date.now()));
      for (let k = 0; k < says; k++) ada.send({ t: 'vhit', i: car.i, w });
      await sleep(500);
      return ben.since(mark);
    };
    const one = await beside(cars[0], 'grenade', 4);
    const hp = one.filter((m) => m.t === 'vhp' && m.i === cars[0].i) as Extract<S2C, { t: 'vhp' }>[];
    assert.equal(hp.length, 1, `one stick grenade, said four times, was taken ${hp.length} times by a car`);
    near(hp[0].hp, JEEP.hp / 2, 1, 'what a jeep has left after one stick grenade');
    assert.ok(!one.some((m) => m.t === 'vboom'), 'one stick grenade was the end of a car');
    const two = await beside(cars[0], 'grenade', 1);
    assert.ok(two.some((m) => m.t === 'vboom' && m.i === cars[0].i), 'two stick grenades were not the end of a car');
    const other = await beside(cars[1], 'frag', 1);
    assert.ok(other.some((m) => m.t === 'vboom' && m.i === cars[1].i), 'one frag grenade was not the end of a car');
    checks++;
    console.log('  ok  over the wire: a car takes one grenade once, before its fuse has run not at all; two stick grenades or one frag are the end of it');
  }
} catch (e) {
  failed = e;
} finally {
  for (const p of all) p.quiet();
  server.kill();
  await sleep(500);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server still letting go of it */
  }
}
if (failed) {
  console.error(logged.slice(-1500));
  throw failed;
}
console.log(`\n${checks} checks passed`);
process.exit(0);
