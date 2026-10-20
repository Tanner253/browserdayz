// Checks of how the guns shoot (src/sim/gunplay.ts), of 2026-10-11. No network: `npx tsx test/gunplay.test.ts`.
//
// What was asked: "good bullet physics realistic recoil". What is held to here: a bullet flown by the game's own
// sum arrives down range at the speed its cartridge's table says, and falls as far as it should; sights set for
// a range put the round on the mark at that range; each gun kicks as itself (the AK harder than the AR-15, a knee
// less than standing, the first of a string more where the gun says so); a hit at a distance does the same on the
// server, which flies nothing, as in the game, which flies the bullet.

import assert from 'node:assert/strict';
import { CARTRIDGES, GRAVITY, GUNS, MOA, PATTERNS, QUIETED, SOUND, anywhereIn, coneOf, cooled, crackOf, damageKept, elevationFor, fly, intervalOf, kickOf, scatterOf, shotOf, speedAt, zeroOf, type Hold } from '../src/sim/gunplay';
import { ONE_SHOT, RIFLE_HITS, WEAPON_RULES, hitDamage } from '../src/sim/combat';
import { ITEMS, sanitizeItem, makeItem } from '../src/sim/items';
import { LAUNCHED } from '../src/sim/grenades';

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
  // (a launched grenade is flown as a grenade is, not as a bullet)
  for (const id of Object.keys(GUNS).filter((id) => !LAUNCHED[GUNS[id].ammo])) {
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
      // (to half a centimetre since 2026-10-19, set against the round as it is flown; a grenade within ten: its blast is seven metres)
      assert.ok(Math.abs(at) < (LAUNCHED[g.ammo] ? 0.1 : 0.005), `${id} set for ${z} m is ${(at * 100).toFixed(1)} cm off the mark there`);
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
  // (by a sixth and more: it was by half, until the AR-15 was made to climb, 2026-10-13: "it doesnt go up enough")
  assert.ok(up('ak', { shot: 2 }) > up('ar15', { shot: 2 }) * 1.15, 'the AK does not kick harder than the AR-15');
  assert.ok(up('mosin') > up('ak') * 1.3 && up('deagle') > up('m9') * 2, 'the big rounds do not kick hardest');
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
  assert.ok(climb('ak') > 11 && climb('ak') < 18, `an AK's magazine climbs ${climb('ak').toFixed(1)} degrees`);
  assert.ok(climb('ar15') > 9 && climb('ar15') < climb('ak') * 0.9, `an AR-15's climbs ${climb('ar15').toFixed(1)}`);
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
    assert.ok(y30 > 32 && y30 < 39, `an AK's magazine throws the muzzle ${y30.toFixed(1)} degrees up in all`);
    const [a3, a10, a20] = [at('ar15', 3)[0], at('ar15', 10)[0], at('ar15', 20)[0]];
    // (a magazine of it climbs twenty-nine degrees, where it climbed twenty-one: 2026-10-13, "it doesnt go up enough")
    const r30 = at('ar15', 30)[1];
    assert.ok(a10 < a3 - 1.5 && a20 > a10 + 2.5 && r30 > 26 && r30 < y30 * 0.9, `the AR-15 does not go the other way first, or climbs ${r30.toFixed(1)} degrees to the AK's ${y30.toFixed(1)}`);
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
  // ---- the two rifles with a string to learn warm a quarter as much as the rest, and their rounds are drawn in
  // toward the middle of the cone: a string pulled against rightly lands (2026-10-13)
  for (const [id, g] of Object.entries(GUNS)) {
    if (!g.auto) continue;
    const warmed = coneOf(id, { ...still, heat: 30 }) - coneOf(id, still);
    assert.ok(Math.abs(warmed - (PATTERNS[id] ? 0.0018 : 0.0066)) < 1e-9, `${id} held open warms by ${warmed.toFixed(4)}`);
  }
  assert.ok(coneOf('ak', { ...still, heat: 30 }) < 0.003 && coneOf('ar15', { ...still, heat: 30 }) < 0.0025, 'a rifle with a string is thrown about by chance as well');
  {
    const N = 400, grid = Array.from({ length: N }, (_, i) => (i + 0.5) / N), coarse = Array.from({ length: 50 }, (_, i) => (i + 0.5) / 50);
    const mean = (r: number[]) => r.reduce((a, b) => a + b, 0) / r.length, within = (r: number[], of: number) => r.filter((v) => v <= of).length / r.length;
    // (anywhere in the cone is as likely as anywhere else: a quarter of them inside half its width, and two thirds of the way out on the whole)
    const flat = grid.map((u) => anywhereIn(0.01, u));
    assert.ok(Math.max(...flat) <= 0.005 && Math.abs(mean(flat) - 0.005 * (2 / 3)) < 1e-5 && Math.abs(within(flat, 0.0025) - 0.25) < 0.01);
    for (const id of Object.keys(GUNS)) {
      const r = grid.flatMap((u) => coarse.map((v) => scatterOf(id, 0.01, u, v)));
      assert.ok(Math.max(...r) <= 0.005 + 1e-12, `${id}: a shot lands outside its cone`);
      if (PATTERNS[id]) assert.ok(Math.abs(mean(r) - 0.0025) < 1e-5 && Math.abs(within(r, 0.0025) - 0.5) < 0.01 && within(r, 0.0045) > 0.97, `${id}: its shots are not drawn in to the middle`);
      else assert.ok(Math.abs(mean(r) - 0.005 * (2 / 3)) < 1e-5 && Math.abs(within(r, 0.0025) - 0.25) < 0.01, `${id}: its shots are not anywhere in its cone`);
    }
  }
});

ok('a gun fires at its own rate, however fast the frames come', () => {
  /** the trigger held for so many seconds at so many frames a second, the game's own sum each frame: when each shot went */
  const held = (id: string, fps: number, seconds: number, wait = 0) => {
    const dt = 1 / fps, shots: number[] = [];
    for (let f = 0; f < Math.round(fps * seconds); f++) {
      wait = cooled(wait, dt);
      if (wait > 0) continue;
      wait += intervalOf(id);
      shots.push(f * dt);
    }
    return shots;
  };
  const autos = Object.keys(GUNS).filter((id) => GUNS[id].auto);
  assert.deepEqual(autos.sort(), ['ak', 'aks74u', 'ar15', 'dual_mac10', 'dual_smg', 'mp7a1', 'mpa', 'scorpion']);
  for (const id of autos) {
    for (const fps of [30, 60, 144, 240]) {
      const shots = held(id, fps, 10), rpm = GUNS[id].rpm;
      const rate = ((shots.length - 1) / (shots[shots.length - 1] - shots[0])) * 60;
      assert.ok(Math.abs(rate - rpm) / rpm < 0.01, `${id} at ${fps} frames a second fires ${rate.toFixed(0)} a minute, and is a ${rpm}`);
      assert.ok(Math.abs(shots.length - (10 * rpm) / 60) <= 1, `${id} at ${fps} frames a second: ${shots.length} shots in ten seconds`);
      // (and never two nearer together than its interval, less the one frame a shot can be late by)
      for (let i = 1; i < shots.length; i++) assert.ok(shots[i] - shots[i - 1] > intervalOf(id) - 1 / fps - 1e-9, `${id} at ${fps}: two shots ${(shots[i] - shots[i - 1]).toFixed(4)} s apart`);
    }
  }
  // (What it was: every shot waited for the next whole frame, so at sixty frames a second the AR-15 fired 600 a
  // minute, which is the AK's rate, and the submachine gun 720. The AK itself, whose interval is six frames to
  // a hair, fired every six or every seven as the hair fell: here, every seven.)
  const was = (id: string, fps: number) => {
    let wait = 0, shots = 0;
    for (let f = 0; f < fps * 10; f++) {
      wait = Math.max(0, wait - 1 / fps);
      if (wait > 0) continue;
      wait = intervalOf(id);
      shots++;
    }
    return shots * 6;
  };
  assert.ok(was('ar15', 60) === 600 && was('mpa', 60) === 720 && was('ak', 60) <= 600, `it was not as it was said to be: ${was('ar15', 60)}, ${was('ak', 60)}, ${was('mpa', 60)}`);
  assert.ok(held('ar15', 60, 10).length > held('ak', 60, 10).length * 1.15, 'at sixty frames a second the AR-15 is still an AK');
  // (nor do the frames have to come evenly: anywhere from fifty to a hundred and twenty a second, no two alike)
  for (const id of autos) {
    let seed = 11, wait = 0, t = 0, shots = 0, first = -1, last = 0;
    const dice = () => ((seed = (seed * 16807) % 2147483647) % 10000) / 10000;
    while (t < 10) {
      const dt = 1 / (50 + dice() * 70);
      wait = cooled(wait, dt);
      if (wait <= 0) {
        wait += intervalOf(id);
        shots++;
        if (first < 0) first = t;
        last = t;
      }
      t += dt;
    }
    const rate = ((shots - 1) / (last - first)) * 60;
    assert.ok(Math.abs(rate - GUNS[id].rpm) / GUNS[id].rpm < 0.01, `${id} with uneven frames fires ${rate.toFixed(0)} a minute`);
  }
  // (a gun left alone owes nothing: after five seconds with the trigger up its first two shots are a whole interval apart, not a frame)
  for (const fps of [60, 144]) {
    let wait = intervalOf('ak');
    for (let f = 0; f < fps * 5; f++) wait = cooled(wait, 1 / fps);
    assert.equal(wait, 0, 'time with the trigger up is kept');
    const shots = held('ak', fps, 1, wait);
    assert.ok(shots[0] === 0 && shots[1] - shots[0] > intervalOf('ak') - 1e-9);
  }
  // (and a frame that takes a second owes one frame's worth and no more: one shot the sooner, not ten)
  {
    let wait = cooled(0.05, 1);
    wait += intervalOf('ak');
    assert.ok(wait <= 0, 'what was left of a long frame was not kept');
    wait = cooled(wait, 1 / 60);
    assert.equal(wait, 0);
    wait += intervalOf('ak');
    assert.ok(Math.abs(wait - 0.1) < 1e-12);
  }
});

ok('through a suppressor a round is slower, for whoever fired it and for everybody else; and a slow round has no crack', () => {
  // (a 9 mm from a pistol leaves faster than sound and, quieted, slower: it goes by without a crack. A rifle's round cracks either way.)
  assert.ok(shotOf('m9').muzzleVel > SOUND && shotOf('m9').muzzleVel * QUIETED < SOUND);
  assert.ok(shotOf('colt').muzzleVel < SOUND);
  assert.equal(crackOf(shotOf('m9').muzzleVel * QUIETED), 0);
  assert.equal(crackOf(shotOf('colt').muzzleVel), 0);
  for (const id of ['mosin', 'ak', 'ar15']) assert.equal(crackOf(shotOf(id).muzzleVel * QUIETED), 1, `${id}: quieted, its round does not crack as a rifle's`);
  assert.ok(crackOf(SOUND) === 0 && crackOf(SOUND * 1.15) > 0.49 && crackOf(SOUND * 1.15) < 0.51 && crackOf(2000) === 1);
});

ok('what a hit does at a distance is the same on the server as in the game', () => {
  for (const id of Object.keys(GUNS)) {
    const s = shotOf(id), r = WEAPON_RULES[id];
    assert.ok(Math.abs(r.interval - (GUNS[id].cycle ?? intervalOf(id))) < 1e-9, `${id}: the server's pace is not the gun's`);
    // (the sniper rifle has figures of its own, by where it lands and whether it is quieted: see below)
    // (and a launched grenade does what its blast does, wherever it lands)
    if (RIFLE_HITS[id] || LAUNCHED[GUNS[id].ammo]) continue;
    // (the .50s kill with any hit, anywhere, at any distance: the owner, 2026-10-18, "the l96 and berret should always 1
    // shot kill")
    if (r.kill) {
      for (const d of [0, GUNS[id].reach]) for (const zone of ['legs', 'arms'] as const) assert.equal(hitDamage(id, zone, d), ONE_SHOT, `${id} in the ${zone} at ${d} m`);
      continue;
    }
    assert.equal(hitDamage(id, 'torso', 0), s.damage, `${id} at the muzzle`);
    for (const share of [0.15, 0.5, 1]) {
      const d = GUNS[id].reach * share;
      const game = s.damage * damageKept(flown(id, d).speed / s.muzzleVel), server = hitDamage(id, 'torso', d);
      assert.ok(Math.abs(game - server) / server < 0.04, `${id} at ${d.toFixed(0)} m: ${game.toFixed(1)} in the game, ${server.toFixed(1)} on the server`);
    }
    assert.ok(hitDamage(id, 'torso', GUNS[id].reach) < s.damage * 0.95 && hitDamage(id, 'torso', GUNS[id].reach) >= s.damage * 0.4, `${id}: at its furthest it has lost nothing, or everything`);
    assert.ok(hitDamage(id, 'head', 50) > hitDamage(id, 'torso', 50) * 3 && hitDamage(id, 'legs', 50) < hitDamage(id, 'torso', 50));
    assert.equal(hitDamage(id, 'arms', 50), hitDamage(id, 'legs', 50), `${id}: an arm is not hit as a leg is`);
    // (a fitted suppressor takes a tenth off; a can that is part of the gun is in its figure already)
    assert.ok(Math.abs(hitDamage(id, 'torso', 30, true) - hitDamage(id, 'torso', 30) * (GUNS[id].quiet ? 1 : 0.9)) < 1e-9, `${id}: quieted`);
  }
  // ---- the sniper rifle, as it was asked for (2026-10-17): never one to the body; one to a bare head, loud or quiet,
  // and not to a helmeted one; less to an arm or a leg
  {
    const worn = (id: string, k: 'armor' | 'head') => ITEMS[id].wear![k]!;
    const helmets = Object.values(ITEMS).filter((d) => d.slot === 'head' && d.wear?.head !== undefined && d.wear.head <= 0.75).map((d) => d.id);
    assert.ok(helmets.length >= 2, 'the helmets were not found');
    for (const d of [0, 100, 300, 600, 900]) {
      for (const sup of [false, true]) {
        assert.ok(hitDamage('mosin', 'torso', d, sup) < 100, `one to the body was the end at ${d} m${sup ? ', quieted' : ''}`);
        assert.ok(hitDamage('mosin', 'head', d, sup) >= 100, `to a bare head at ${d} m${sup ? ', quieted' : ''}: ${hitDamage('mosin', 'head', d, sup).toFixed(0)}`);
        for (const h of helmets) assert.ok(hitDamage('mosin', 'head', d, sup) * worn(h, 'head') < 100, `one to a head under the ${ITEMS[h].name} was the end at ${d} m${sup ? ', quieted' : ''}`);
      }
      for (const z of ['legs', 'arms'] as const) for (const sup of [false, true]) assert.ok(hitDamage('mosin', z, d, sup) < 100 && hitDamage('mosin', z, d, sup) < hitDamage('mosin', 'torso', d, sup), `one to the ${z} at ${d} m`);
    }
    // (the Mosin 91/30: two thirds of it to the body, and a bare head still the end, 2026-10-19)
    for (const d of [0, 300, 600]) {
      assert.ok(Math.abs(hitDamage('mosin9130', 'torso', d) / hitDamage('mosin', 'torso', d) - 2 / 3) < 0.02, `the Mosin to the body at ${d} m`);
      assert.ok(hitDamage('mosin9130', 'head', d) >= 100 && hitDamage('mosin9130', 'head', d) < hitDamage('mosin', 'head', d), `the Mosin to a bare head at ${d} m`);
      for (const h of helmets) assert.ok(hitDamage('mosin9130', 'head', d) * worn(h, 'head') < 100, `the Mosin through the ${ITEMS[h].name} at ${d} m`);
    }
    // (and the .50s are what kill with one to the body, up close)
    for (const id of ['sniper50', 'barrett']) assert.ok(hitDamage(id, 'torso', 30) >= 100, `${id}: one to the body up close is not the end`);
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
