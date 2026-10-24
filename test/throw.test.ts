// A thing thrown from the hands (the owner, 2026-10-23: "hold G to throw an item in my hands with power depending on how
// long held, and a bar"): the bar's power is the throw's, an honest throw is always believed where it comes down, and
// the server believes none further than its bar carries, higher than it rises, over a hill or out of the ground.
// src/sim/throw.ts, server/throws.ts. A thrown dog tag on a real server: test/tag-custody.test.ts.
//   npx tsx test/throw.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { landing, tossed } from '../server/throws';
import { THROW, fastest, flightStep, powerOf, throwReach, throwSpeed, type Met, type V3 } from '../src/sim/throw';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

/** a world of level ground at `floor`, with a wall across x = `wall` if there is one, up to `top` */
const world = (floor = 0, wall?: number, top = 3) => (from: V3, dir: V3, len: number): Met => {
  let best: Met = null;
  if (dir[1] < 0) {
    const t = (floor - from[1]) / dir[1];
    if (t >= 0 && t <= len) best = { toi: t, normal: [0, 1, 0] };
  }
  if (wall !== undefined && dir[0] > 0) {
    const t = (wall - from[0]) / dir[0], y = from[1] + dir[1] * t;
    if (t >= 0 && t <= len && y < top && (!best || t < best.toi)) best = { toi: t, normal: [-1, 0, 0] };
  }
  return best;
};

/** a throw flown as the game flies it (src/game/throwing.ts): from the hand, looking up by `pitch` degrees, until it lies still */
const fly = (power: number, pitch: number, hit = world(), hand = 1.4): V3 => {
  const a = (pitch * Math.PI) / 180, s = throwSpeed(power);
  const pos: V3 = [0, hand, 0], vel: V3 = [Math.cos(a) * s, Math.sin(a) * s + THROW.lift, 0];
  for (let t = 0; t < THROW.most; t += 1 / 120) {
    if (flightStep(pos, vel, 1 / 120, hit)) break;
    if (Math.hypot(pos[0], pos[2]) > throwReach(power, hand - pos[1]) - THROW.slack) break;
  }
  return pos;
};

ok('a tap is no throw; the bar fills over the hold, and stays full', () => {
  assert.equal(powerOf(0.1), 0);
  assert.equal(powerOf(THROW.tap), 0);
  assert.ok(Math.abs(powerOf(THROW.tap + THROW.wind / 2) - 0.5) < 1e-9);
  assert.equal(powerOf(THROW.tap + THROW.wind), 1);
  assert.equal(powerOf(30), 1);
});

ok('the bar is the throw: the fuller it is, the further it goes', () => {
  let last = -1;
  for (let p = 0; p <= 1.0001; p += 0.1) {
    const d = fly(p, 30)[0];
    assert.ok(d > last, `${p.toFixed(1)}: ${d.toFixed(1)} m, not further than ${last.toFixed(1)}`);
    last = d;
  }
  assert.ok(fly(0, 30)[0] < 4, `the least of throws goes ${fly(0, 30)[0].toFixed(1)} m`);
  assert.ok(fly(1, 30)[0] > 15, `the fullest goes ${fly(1, 30)[0].toFixed(1)} m`);
});

ok('every honest throw, at any power and angle, from a roof or into a pit, is believed where it comes down', () => {
  for (let p = 0; p <= 1.0001; p += 0.05)
    for (let pitch = -60; pitch <= 85; pitch += 5)
      for (const [floor, hand] of [[0, 1.4], [-12, 1.4], [0, 9]] as [number, number][]) {
        const at = fly(p, pitch, world(floor), hand), d = Math.hypot(at[0], at[2]);
        assert.ok(d <= throwReach(p, hand - at[1]), `power ${p.toFixed(2)}, ${pitch} degrees, from ${hand} m to ${floor}: ${d.toFixed(2)} m, past ${throwReach(p, hand - at[1]).toFixed(2)}`);
      }
});

ok('a wall stops it: it comes down this side of it', () => {
  const at = fly(1, 10, world(0, 6));
  assert.ok(at[0] < 6, `it lies at ${at[0].toFixed(2)}, through the wall at 6`);
});

const feet: V3 = [100, 20, 50], hand: V3 = [100, 21.4, 50];
let clock = 1e6;
const next = () => (clock += 1000);

ok('a throw is believed from about where its thrower stands, no faster than its power, and not too often', () => {
  const who = {};
  assert.equal(tossed(who, 'a', [104, 21.4, 50], [5, 2, 0], 0.5, feet, next()), null, 'from four metres off');
  assert.equal(tossed(who, 'a', [100, 25, 50], [5, 2, 0], 0.5, feet, next()), null, 'from over their head');
  assert.equal(tossed(who, 'a', hand, [fastest(0.2) + 1, 0, 0], 0.2, feet, next()), null, 'faster than its power throws');
  assert.equal(tossed(who, 'a', hand, [5, 2, 0], 1.5, feet, next()), null, 'with more than the full bar');
  assert.equal(tossed(who, '', hand, [5, 2, 0], 0.5, feet, next()), null, 'nothing');
  const now = next();
  assert.ok(tossed(who, 'a', hand, [5, 2, 0], 0.5, feet, now));
  assert.equal(tossed(who, 'b', hand, [5, 2, 0], 0.5, feet, now + THROW.gap - 1), null, 'two throws at once');
  assert.ok(tossed(who, 'b', hand, [5, 2, 0], 0.5, feet, now + THROW.gap));
});

ok('where it comes down is believed within its throw\'s reach, and nowhere it could not have got', () => {
  const who = {}, flat = () => 20;
  // not thrown: an ordinary drop, the drop's own rule
  assert.equal(landing(who, 'x', [101, 20, 50], flat, next()), 'free');
  // thrown hard, come down 18 m off: believed, once
  let now = next();
  tossed(who, 'x', hand, [12, 3, 0], 1, feet, now);
  assert.equal(landing(who, 'x', [118, 20, 50], flat, now + 1500), 'ok');
  assert.equal(landing(who, 'x', [118, 20, 50], flat, now + 1600), 'free', 'the same throw believed twice');
  // thrown softly, said to have come down 18 m off: further than it carries
  now = next();
  tossed(who, 'y', hand, [3, 2, 0], 0.1, feet, now);
  assert.match(landing(who, 'y', [118, 20, 50], flat, now + 1500), /further than the throw carries/);
  // onto a roof higher than it rises
  now = next();
  tossed(who, 'z', hand, [3, 2, 0], 0.1, feet, now);
  assert.match(landing(who, 'z', [101, 26, 50], flat, now + 1500), /higher than the throw rises/);
  // over a ridge it could never clear
  now = next();
  tossed(who, 'w', hand, [12, 3, 0], 1, feet, now);
  assert.match(landing(who, 'w', [115, 20, 50], (x) => (x > 106 && x < 110 ? 60 : 20), now + 1500), /over ground higher/);
  // out of the bunker, up to the ground over it
  now = next();
  tossed(who, 'v', [100, 9.4, 50], [12, 3, 0], 1, [100, 8, 50], now);
  assert.match(landing(who, 'v', [110, 20, 50], flat, now + 1500), /out of the ground/);
  // and a throw waited for too long is no longer one
  now = next();
  tossed(who, 'u', hand, [3, 2, 0], 0.1, feet, now);
  assert.equal(landing(who, 'u', [118, 20, 50], flat, now + THROW.keepFor + 1), 'free');
});

ok('the server asks every drop whether it was thrown, before custody is gone through, and shows a throw to whoever is near', () => {
  const src = readFileSync(new URL('../server/handle.ts', import.meta.url), 'utf8');
  const drop = src.slice(src.indexOf("case 'drop': {"), src.indexOf("case 'toss': {"));
  assert.ok(drop.indexOf('landing(c, item.uid') > 0 && drop.indexOf('landing(c, item.uid') < drop.indexOf('payingTags(item)'), 'the throw is not asked of before the tags');
  assert.ok(/case 'toss': \{[\s\S]{0,400}tossed\(c, m\.uid, m\.o, m\.v, m\.pw/.test(src), 'a throw is not asked of the rules');
});

console.log(`${n} checks passed`);
