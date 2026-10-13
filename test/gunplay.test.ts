// Checks of how the guns shoot (src/sim/gunplay.ts), of 2026-10-11. No network: `npx tsx test/gunplay.test.ts`.
//
// What was asked: "good bullet physics realistic recoil". What is held to here: a bullet flown by the game's own
// sum arrives down range at the speed its cartridge's table says, and falls as far as it should; sights set for
// a range put the round on the mark at that range; each gun kicks as itself (the AK harder than the AR-15, a knee
// less than standing, the first of a string more where the gun says so); a hit at a distance does the same on the
// server, which flies nothing, as in the game, which flies the bullet.

import assert from 'node:assert/strict';
import { CARTRIDGES, GRAVITY, GUNS, MOA, coneOf, damageKept, elevationFor, fly, intervalOf, kickOf, shotOf, speedAt, zeroOf, type Hold } from '../src/sim/gunplay';
import { RIFLE_HITS, WEAPON_RULES, hitDamage } from '../src/sim/combat';
import { ITEMS, sanitizeItem, makeItem } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

/** a round flown as the game flies it (240 steps a second), from the eye along a line lifted by `slope`: where it is and how fast when it has gone `metres` along the ground */
function flown(id: string, metres: number, slope = 0) {
  const s = shotOf(id);
  const len = Math.hypot(1, slope);
  const pos = { x: 0, y: 0, z: 0 }, vel = { x: (s.muzzleVel * 1) / len, y: (s.muzzleVel * slope) / len, z: 0 };
  let t = 0;
  const h = 1 / 240;
  while (pos.x < metres && t < 6) {
    const before = { ...pos }, was = t;
    fly(pos, vel, s.drag, h);
    t += h;
    if (pos.x >= metres) {
      // (where it crossed that distance, between the two steps)
      const k = (metres - before.x) / (pos.x - before.x);
      return { y: before.y + (pos.y - before.y) * k, speed: Math.hypot(vel.x, vel.y, vel.z), t: was + h * k };
    }
  }
  return { y: pos.y, speed: Math.hypot(vel.x, vel.y, vel.z), t };
}
/** dice that always come up the same: the middle of everything */
const even = () => 0.5;
const standing: Hold = { shot: 1, crouched: false, prone: false, aimed: false, arms: 1, ergo: 60, fitted: 1 };
const guns = Object.values(ITEMS).filter((d) => d.weapon);

ok('every gun in the game is in the table, firing what its item says it fires; and nothing else is', () => {
  for (const d of guns) {
    assert.ok(GUNS[d.id], `${d.id} is not in GUNS: it would not fire`);
    assert.equal(GUNS[d.id].ammo, d.weapon!.ammo, `${d.id}: the table and the item disagree about what it fires`);
    assert.ok(CARTRIDGES[GUNS[d.id].ammo], `${d.id}: nothing is known of ${GUNS[d.id].ammo}`);
    assert.ok(WEAPON_RULES[d.id]?.drag, `${d.id}: the server has no rule for it`);
    assert.equal(!!GUNS[d.id].auto, !!d.weapon!.modes?.includes('auto'), `${d.id}: automatic in one place and not the other`);
  }
  for (const id of Object.keys(GUNS)) assert.ok(ITEMS[id]?.weapon, `${id} is in GUNS and is no gun`);
  for (const id of Object.keys(CARTRIDGES)) assert.equal(ITEMS[id]?.category, 'ammo', `${id} is in CARTRIDGES and is no round`);
});

ok('down range each round has the speed its maker says it has', () => {
  // [gun, metres, m/s there in its table (for an ordinary barrel)]
  const table: [string, number, number][] = [
    ['m9', 91.4, 312], // 9x19 115 gr: 1023 ft/s at 100 yd
    ['deagle', 91.4, 378], // .50 AE 300 gr
    ['mosin', 274.3, 622], // 7.62x54R 148 gr: 2040 ft/s at 300 yd
    ['ak', 274.3, 480], // 7.62x39 123 gr: 1580 ft/s at 300 yd
    ['benelli', 45.7, 278], // 00 buck at 50 yd
  ];
  for (const [id, metres, want] of table) {
    const got = flown(id, metres).speed / GUNS[id].barrel;
    assert.ok(Math.abs(got - want) / want < 0.03, `${id} at ${metres} m: ${got.toFixed(0)} m/s, its table says ${want}`);
  }
  // (the short AR-15: a rifle's round, 6% slower out of this barrel, and still supersonic at three hundred metres)
  assert.ok(Math.abs(shotOf('ar15').muzzleVel - 900 * 0.94) < 1e-9);
  assert.ok(flown('ar15', 300).speed > 343);
  // (and the sum the server does, which flies nothing, says the same as the flight does)
  for (const id of Object.keys(GUNS)) {
    const far = GUNS[id].reach * 0.5;
    const a = flown(id, far).speed / shotOf(id).muzzleVel, b = speedAt(shotOf(id).drag, far);
    assert.ok(Math.abs(a - b) < 0.02, `${id} at ${far} m: flown it keeps ${a.toFixed(3)} of its speed, by the sum ${b.toFixed(3)}`);
  }
});

ok('a round falls as far as a thing falls in the time it is in the air (which the air makes longer)', () => {
  for (const id of ['mosin', 'ak', 'ar15', 'm9']) {
    const at = id === 'm9' ? 50 : 200;
    const f = flown(id, at);
    const bare = 0.5 * GRAVITY * f.t * f.t;
    assert.ok(-f.y > bare * 0.85 && -f.y <= bare * 1.03, `${id} at ${at} m fell ${(-f.y * 100).toFixed(1)} cm in ${f.t.toFixed(3)} s (a stone falls ${(bare * 100).toFixed(1)})`);
  }
  // (figures anybody can look up: a 7.62x39 sighted dead level is about 30 cm low at 200 m; a 5.56 about half that)
  assert.ok(-flown('ak', 200).y > 0.34 && -flown('ak', 200).y < 0.5, `AK at 200 m: ${(-flown('ak', 200).y * 100).toFixed(0)} cm`);
  assert.ok(-flown('ar15', 200).y > 0.2 && -flown('ar15', 200).y < 0.34, `AR-15 at 200 m: ${(-flown('ar15', 200).y * 100).toFixed(0)} cm`);
  assert.ok(-flown('ar15', 200).y < -flown('ak', 200).y, 'the faster round is the flatter one');
});

ok('sights set for a range put the round on the mark at that range, and over it nearer and under it further', () => {
  for (const [id, g] of Object.entries(GUNS)) {
    const s = shotOf(id);
    for (const z of g.zero) {
      const slope = elevationFor(s.muzzleVel, s.drag, z);
      const at = flown(id, z, slope).y;
      assert.ok(Math.abs(at) < Math.max(0.012, z * 0.00012), `${id} set for ${z} m is ${(at * 100).toFixed(1)} cm off the mark there`);
      assert.ok(flown(id, z * 0.5, slope).y > 0, `${id} set for ${z} m is not above the line at half of it`);
      assert.ok(flown(id, z * 1.3, slope).y < 0, `${id} set for ${z} m is not under the line beyond it`);
    }
    assert.equal(zeroOf(id), g.zero[0]);
    assert.equal(zeroOf(id, g.zero[g.zero.length - 1]), g.zero[g.zero.length - 1]);
    assert.equal(zeroOf(id, 123), g.zero[0], 'a range it has no setting for is not one');
  }
  // (and an item keeps only a setting its gun has)
  const rifle = makeItem('mosin');
  rifle.zero = 300;
  assert.equal(sanitizeItem(rifle)!.zero, 300);
  rifle.zero = 250;
  assert.equal(sanitizeItem(rifle)!.zero, undefined);
  const tin = makeItem('beans');
  tin.zero = 100;
  assert.equal(sanitizeItem(tin)!.zero, undefined);
});

ok('each gun kicks as itself', () => {
  const up = (id: string, h: Partial<Hold> = {}) => {
    const k = kickOf(id, { ...standing, ...h }, even);
    return ((k.up + k.stayUp) * 180) / Math.PI;
  };
  // (a string's later shots, to set one gun beside another: not their first, which the AK's bolt makes its worst)
  assert.ok(up('ak', { shot: 2 }) > up('ar15', { shot: 2 }) * 1.3, 'the AK does not kick harder than the AR-15');
  assert.ok(up('mosin') > up('ak') * 1.5 && up('deagle') > up('m9') * 2, 'the big rounds do not kick hardest');
  assert.ok(up('ak', { shot: 1 }) > up('ak', { shot: 2 }) * 1.2, 'the first of an AK\'s string is not its worst');
  assert.ok(up('ak', { shot: 8 }) < up('ak', { shot: 2 }) * 0.85, 'a long string is not leaned into');
  assert.ok(up('ak', { shot: 20 }) > up('ak', { shot: 8 }) * 0.7 && up('ak', { shot: 60 }) === up('ak', { shot: 20 }), 'and it does not go on getting easier for ever');
  for (const id of Object.keys(GUNS)) {
    assert.ok(up(id, { crouched: true }) < up(id) * 0.75 && up(id, { prone: true }) < up(id, { crouched: true }), `${id}: a knee and the ground do not steady it`);
    assert.ok(up(id, { aimed: true }) < up(id), `${id}: the sights at the eye do not steady it`);
    assert.ok(up(id, { arms: 0 }) > up(id) * 1.3, `${id}: tired arms do not make it worse`);
    assert.ok(up(id, { fitted: 0.8 }) < up(id) * 0.85, `${id}: what is fitted to it does nothing`);
    const k = kickOf(id, standing, even);
    assert.ok(k.stayUp > 0 && k.stayUp < k.up, `${id}: more of its rise stays than comes back`);
    assert.ok(up(id) > 0.5 && up(id) < 6, `${id} kicks ${up(id).toFixed(2)} degrees`);
  }
  // (an automatic held open walks the way it leans, then saws: across, the string is never one straight line)
  const across = Array.from({ length: 12 }, (_, i) => kickOf('ak', { ...standing, shot: i + 1 }, even).across);
  assert.ok(across[1] > 0 && across[2] > 0, 'the AK does not start off to the right');
  assert.ok(across.slice(3).some((a) => a < 0) && across.slice(3).some((a) => a > 0), 'it never comes back across');
  // (thirty rounds held open, standing and aimed, with nothing done about it: the AK ends up pointing well over a man's head at fifty metres, the AR-15 a good deal less far)
  const climb = (id: string) => Array.from({ length: 30 }, (_, i) => kickOf(id, { ...standing, aimed: true, shot: i + 1 }, even).stayUp).reduce((a, b) => a + b, 0) * (180 / Math.PI);
  assert.ok(climb('ak') > 10 && climb('ak') < 16, `an AK's magazine climbs ${climb('ak').toFixed(1)} degrees`);
  assert.ok(climb('ar15') > 5.5 && climb('ar15') < climb('ak') * 0.75, `an AR-15's climbs ${climb('ar15').toFixed(1)}`);
  // ---- the string's own shape (2026-10-12: "google the AK recoil pattern on rust and use something similar"): up
  // hard and nearly straight, then across to the right, a long way back to the left, and right again
  {
    const at = (id: string, upTo: number) => {
      let x = 0, y = 0;
      for (let i = 1; i <= upTo; i++) {
        const k = kickOf(id, { ...standing, shot: i }, even);
        x += k.across + k.stayAcross;
        y += k.up + k.stayUp;
      }
      return [(x * 180) / Math.PI, (y * 180) / Math.PI];
    };
    const [x4, y4] = at('ak', 4), [x9] = at('ak', 9), [x20] = at('ak', 20), [x28, y30] = [at('ak', 28)[0], at('ak', 30)[1]];
    assert.ok(y4 > 5.5 && Math.abs(x4) < 1, `an AK's first four go ${y4.toFixed(1)} up and ${x4.toFixed(1)} across: not straight up, or not hard`);
    assert.ok(x9 > x4 + 3 && x20 < x9 - 5 && x28 > x20 + 3.5, `an AK's string does not snake: ${[x4, x9, x20, x28].map((v) => v.toFixed(1)).join(', ')}`);
    assert.ok(y30 > 28 && y30 < 36, `an AK's magazine throws the muzzle ${y30.toFixed(1)} degrees up in all`);
    const [a3, a10, a20] = [at('ar15', 3)[0], at('ar15', 10)[0], at('ar15', 20)[0]];
    assert.ok(a10 < a3 - 1.5 && a20 > a10 + 2.5 && at('ar15', 30)[1] < y30 * 0.72, 'the AR-15 does not go the other way first, or is no gentler');
    // (the same string every time, give or take: two magazines never end more than a degree apart)
    let seed = 7;
    const dice = () => ((seed = (seed * 16807) % 2147483647) % 1000) / 1000;
    const end = () => {
      let x = 0;
      for (let i = 1; i <= 30; i++) x += kickOf('ak', { ...standing, shot: i }, dice).stayAcross;
      return (x * 180) / Math.PI;
    };
    const ends = Array.from({ length: 12 }, end);
    assert.ok(Math.max(...ends) - Math.min(...ends) < 1, `an AK's string ends in a different place each time: ${ends.map((v) => v.toFixed(2)).join(' ')}`);
    assert.equal(kickOf('ak', { ...standing, shot: 75 }, even).up, kickOf('ak', { ...standing, shot: 55 }, even).up, 'a drum does not go round its last twenty');
  }
});

ok('how wide a shot can go: the gun\'s own at the eye, and wider every other way', () => {
  const still = { aimed: 1, moving: 0, air: false, crouched: false, prone: false, heat: 0 };
  for (const [id, g] of Object.entries(GUNS)) {
    assert.ok(Math.abs(coneOf(id, still) - g.moa * MOA) < 1e-12, `${id}: at the eye and still it is not its own ${g.moa} minutes`);
    const hip = coneOf(id, { ...still, aimed: 0 });
    assert.ok(hip > coneOf(id, still) * 5, `${id}: the hip is no worse than the eye`);
    assert.ok(coneOf(id, { ...still, aimed: 0, moving: 1 }) > hip * 2 && coneOf(id, { ...still, aimed: 0, crouched: true }) < hip && coneOf(id, { ...still, aimed: 0, prone: true }) < coneOf(id, { ...still, aimed: 0, crouched: true }));
    assert.ok(coneOf(id, { ...still, air: true }) > coneOf(id, still) + 0.015, `${id}: in the air it is as true as on the ground`);
    assert.equal(coneOf(id, { ...still, heat: 8 }) > coneOf(id, still), !!g.auto, `${id}: warming`);
  }
  // (the sniper rifle puts five rounds inside a hand's width at two hundred metres; the AK inside a dinner plate)
  assert.ok(coneOf('mosin', still) * 200 < 0.1 && coneOf('ak', still) * 200 < 0.25 && coneOf('ar15', still) < coneOf('ak', still));
});

ok('what a hit does at a distance is the same on the server as in the game', () => {
  for (const id of Object.keys(GUNS)) {
    const s = shotOf(id), r = WEAPON_RULES[id];
    assert.ok(Math.abs(r.interval - (GUNS[id].cycle ?? intervalOf(id))) < 1e-9, `${id}: the server's pace is not the gun's`);
    // (the sniper rifle has figures of its own, by where it lands and whether it is quieted: see below)
    if (RIFLE_HITS[id]) continue;
    assert.equal(hitDamage(id, 'torso', 0), s.damage, `${id} at the muzzle`);
    for (const share of [0.15, 0.5, 1]) {
      const d = GUNS[id].reach * share;
      const game = s.damage * damageKept(flown(id, d).speed / s.muzzleVel), server = hitDamage(id, 'torso', d);
      assert.ok(Math.abs(game - server) / server < 0.04, `${id} at ${d.toFixed(0)} m: ${game.toFixed(1)} in the game, ${server.toFixed(1)} on the server`);
    }
    assert.ok(hitDamage(id, 'torso', GUNS[id].reach) < s.damage * 0.95 && hitDamage(id, 'torso', GUNS[id].reach) >= s.damage * 0.4, `${id}: at its furthest it has lost nothing, or everything`);
    assert.ok(hitDamage(id, 'head', 50) > hitDamage(id, 'torso', 50) * 3 && hitDamage(id, 'legs', 50) < hitDamage(id, 'torso', 50));
    assert.equal(hitDamage(id, 'arms', 50), hitDamage(id, 'legs', 50), `${id}: an arm is not hit as a leg is`);
    assert.ok(Math.abs(hitDamage(id, 'torso', 30, true) - hitDamage(id, 'torso', 30) * 0.9) < 1e-9, `${id}: quieted`);
  }
  // ---- the sniper rifle, as it was asked for: one to the body with no suppressor; quieted, one to a bare head and
  // not to a helmeted one; less to an arm or a leg
  {
    const worn = (id: string, k: 'armor' | 'head') => ITEMS[id].wear![k]!;
    const helmets = Object.values(ITEMS).filter((d) => d.slot === 'head' && d.wear?.head !== undefined && d.wear.head <= 0.75).map((d) => d.id);
    assert.ok(helmets.length >= 2, 'the helmets were not found');
    for (const d of [0, 100, 300, 600, 900]) {
      assert.ok(hitDamage('mosin', 'torso', d) >= 100, `loud, to the body at ${d} m: ${hitDamage('mosin', 'torso', d).toFixed(0)}`);
      assert.ok(hitDamage('mosin', 'torso', d, true) < 100, `quieted, one to the body was the end at ${d} m`);
      assert.ok(hitDamage('mosin', 'head', d, true) >= 100, `quieted, to a bare head at ${d} m: ${hitDamage('mosin', 'head', d, true).toFixed(0)}`);
      for (const h of helmets) assert.ok(hitDamage('mosin', 'head', d, true) * worn(h, 'head') < 100, `quieted, one to a head under the ${ITEMS[h].name} was the end at ${d} m`);
      for (const z of ['legs', 'arms'] as const) for (const sup of [false, true]) assert.ok(hitDamage('mosin', z, d, sup) < 100 && hitDamage('mosin', z, d, sup) < hitDamage('mosin', 'torso', d, sup), `one to the ${z} at ${d} m`);
    }
    // (through every vest but the heaviest, a loud one to the body up close is the end; and a K6-3 still leaves its wearer standing after a loud one to the head, as it says it does)
    for (const v of Object.values(ITEMS).filter((d) => d.wear?.armor !== undefined && d.id !== 'heavy_armor')) assert.ok(hitDamage('mosin', 'torso', 30) * v.wear!.armor! >= 100, `loud, to the body in the ${v.name}`);
    assert.ok(hitDamage('mosin', 'head', 0) * worn('helmet_k63', 'head') < 100 && hitDamage('mosin', 'head', 0) * worn('boonie_hat', 'head') >= 100);
  }
  // (a shell: no more pellets are believed than it has, and each is a pellet)
  assert.equal(hitDamage('benelli', 'torso', 0, false, 0, 20), CARTRIDGES.ammo_12.damage * 9);
  assert.equal(hitDamage('benelli', 'torso', 0, false, 0, 3), CARTRIDGES.ammo_12.damage * 3);
});

ok('the guns that were there shoot as they did, near enough', () => {
  // (what each did at the muzzle before this table, by the rules the server had: nothing that was live is changed there)
  for (const [id, was] of [['mosin', 95], ['m9', 34], ['deagle', 58], ['benelli', 14]] as [string, number][]) assert.equal(shotOf(id).damage, was, id);
  // (and their pace: a pistol as fast as it was, the shotgun and the big pistol as slow)
  assert.ok(Math.abs(intervalOf('m9') - 0.13) < 0.005 && Math.abs(intervalOf('deagle') - 0.273) < 0.005 && Math.abs(intervalOf('benelli') - 0.34) < 0.005 && Math.abs(intervalOf('ak') - 0.1) < 1e-9);
});

console.log(`\n${n} checks passed`);
