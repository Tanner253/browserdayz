// The animals' minds (src/sim/animal-mind.ts) on ground made for the test: forest to the west, fields to the east, a
// lake. Herds, their day, fright, the bear's charge (and outrunning it, as the owner asked), the wolves' hunt, herds
// leaving ground where they are hunted, gutting and skinning.
//   npx tsx test/animals.test.ts

import assert from 'node:assert/strict';
import { ANIMALS, A_DEAD, A_REST, A_ROAR, BLADES, CALLS, HERDS, KIND, KINDS, SKIN, yieldOf, type Biome } from '../src/sim/animals';
import { Herd, seeded, type Seen } from '../src/sim/animal-mind';
import type { Ground } from '../src/sim/animal-ground';
import { ENTITIES, entityBy } from '../src/net/orders';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

const LAKE = { x: 300, z: 300, r: 30 };
const ground: Ground = {
  height: () => 0,
  slope: () => 0,
  biome: (x, z): Biome => (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r ? 'water' : Math.abs(x) > 1490 || Math.abs(z) > 1490 ? 'water' : x < 0 ? 'forest' : 'field'),
  open: (x, z) => Math.abs(x) < 1490 && Math.abs(z) < 1490 && Math.hypot(x - LAKE.x, z - LAKE.z) >= LAKE.r,
  road: () => 999,
  people: () => ({ town: 9999, camp: 9999, house: 9999 }),
  towers: [],
  roofed: () => false,
  cover: (x) => (x < 0 ? 1 : 0),
  clear: () => true,
  water: (x, z, r) => (Math.hypot(x - LAKE.x, z - LAKE.z) < r + LAKE.r ? { x: LAKE.x - LAKE.r - 1, z: LAKE.z } : null),
  farms: [],
  bounds: { x0: -1500, x1: 1500, z0: -1500, z1: 1500 },
};

let PH = 0.1;
const herd = (kinds: string[], seed = 1) => new Herd(ground, (k) => kinds.includes(k.id), () => PH, seeded(seed));
const person = (id: number, x: number, z: number, o: Partial<Seen> = {}): Seen => ({ id, x, y: 0, z, crouch: false, prone: false, speed: 0, ride: '', sheltered: false, ...o });
/** run the herd for `secs` seconds, the people moved by `move` before each step; every blow struck is returned */
const run = (h: Herd, t0: number, secs: number, people: Seen[], move?: (t: number) => void) => {
  const strikes: { t: number; i: number; on: number; damage: number }[] = [];
  for (let t = 0; t <= secs * 1000; t += 200) {
    move?.(t);
    for (const s of h.tick(t0 + t, people).strikes) strikes.push({ t, ...s });
  }
  return strikes;
};

ok('deer herds are stood on ground with fields to feed in and forest to lie up in, apart from each other', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const deer = h.groups.filter((g) => g.members.length);
  assert.ok(deer.length >= 4, `${deer.length} herds`);
  for (const g of deer) {
    assert.equal(KINDS[h.beasts.get(g.members[0])!.k].id, 'stag', 'a stag leads each herd');
    assert.ok(g.members.length >= 3 && g.members.length <= 5);
    for (const o of deer) if (o !== g) assert.ok(Math.hypot(o.home.x - g.home.x, o.home.z - g.home.z) >= 380);
  }
  // (the same ground at every start: the herds' ground is the map's)
  const again = herd(['stag', 'doe'], 99);
  again.populate(0);
  assert.deepEqual(again.groups.map((g) => g.home), h.groups.map((g) => g.home));
});

ok('with nobody near a herd sleeps and does not move; somebody near and it goes about its day', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const before = [...h.beasts.values()].map((b) => [b.x, b.z]);
  run(h, 1000, 20, []);
  assert.deepEqual([...h.beasts.values()].map((b) => [b.x, b.z]), before);
  assert.ok(h.groups.every((g) => !g.awake));
  const g = h.groups[0], lead = h.beasts.get(g.members[0])!;
  run(h, 1000, 60, [person(1, lead.x + 380, lead.z)]);
  assert.ok(g.awake);
});

ok('deer feed in the open at dawn and lie up in the trees at midday', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const g = h.groups[0], lead = h.beasts.get(g.members[0])!;
  const watcher = person(1, lead.x + 390, lead.z + 10);
  PH = 0.1;
  run(h, 0, 200, [watcher], () => {
    const b = h.beasts.get(g.members[0])!;
    watcher.x = b.x + 390;
    watcher.z = b.z;
  });
  assert.equal(g.spot === 'feed' || g.spot === 'water', true, `feeding at dawn: ${g.spot}`);
  if (g.spot === 'feed') assert.equal(ground.biome(g.at.x, g.at.z), 'field');
  PH = 0.4;
  run(h, 300_000, 400, [watcher], () => {
    const b = h.beasts.get(g.members[0])!;
    watcher.x = b.x + 390;
    watcher.z = b.z;
  });
  assert.equal(g.spot, 'rest');
  assert.equal(ground.biome(g.at.x, g.at.z), 'forest');
  const lying = g.members.map((i) => h.beasts.get(i)!).filter((b) => b.mode === A_REST).length;
  assert.ok(lying >= 1, 'lying down in cover');
  PH = 0.1;
});

ok('a sprinting man near a herd sends all of it off together, and it runs on for a couple of hundred metres', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const g = h.groups[0], lead = h.beasts.get(g.members[0])!;
  const man = person(1, lead.x + 35, lead.z, { speed: 6.2 });
  const start = g.members.map((i) => [h.beasts.get(i)!.x, h.beasts.get(i)!.z]);
  run(h, 0, 25, [man]);
  g.members.forEach((i, n) => {
    const b = h.beasts.get(i)!;
    assert.ok(Math.hypot(b.x - start[n][0], b.z - start[n][1]) > 120, `deer ${i} ran ${Math.hypot(b.x - start[n][0], b.z - start[n][1]).toFixed(0)} m`);
    assert.ok(Math.hypot(b.x - man.x, b.z - man.z) > 150);
  });
  assert.ok(g.pressure >= 1);
});

ok('crouched, still and downwind a hunter gets close; upwind the herd smells him from far off', () => {
  const near = (dx: number, dz: number) => {
    const h = herd(['stag', 'doe']);
    h.populate(0);
    const g = h.groups[0], lead = h.beasts.get(g.members[0])!;
    // (the wind blows toward +x +z: standing at +x +z of the deer is downwind of it)
    const man = person(1, lead.x + dx, lead.z + dz, { crouch: true, speed: 0 });
    for (const i of g.members) h.beasts.get(i)!.yaw = Math.atan2(dx, dz); // (facing away)
    run(h, 0, 12, [man]);
    return g.flee !== null || g.members.some((i) => h.beasts.get(i)!.aware >= ANIMALS.alert);
  };
  assert.equal(near(24, 18), false, 'downwind at 30 m: not noticed');
  assert.equal(near(-40, -30), true, 'upwind at 50 m: smelled');
});

ok('a shot within earshot frightens a herd off; a hunted herd leaves its ground for fresh ground far off', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const g = h.groups[0], lead = h.beasts.get(g.members[0])!;
  const man = person(1, lead.x + 200, lead.z, { crouch: true });
  run(h, 0, 2, [man]);
  h.heard(man.x, man.z, [600, 1100], 2000);
  run(h, 2200, 1, [man]);
  assert.ok(g.flee, 'a rifle shot 200 m off: off they go');
  // a kill and a few more shots: the herd is gone from here
  h.hurt(g.members[1], 500, man, 4000);
  for (let s = 0; s < 3; s++) h.heard(man.x, man.z, [600, 1100], 5000 + s * 100);
  const was = { ...g.mid };
  run(h, 6000, 5, [man]);
  assert.ok(Math.hypot(g.mid.x - was.x, g.mid.z - was.z) >= 400, `moved ${Math.hypot(g.mid.x - was.x, g.mid.z - was.z).toFixed(0)} m`);
  assert.ok(g.movedAt > 0);
});

ok('one of a herd shot dead, the rest bolt away from the shooter; a vanished admin keeps herds awake and is never noticed', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const g = h.groups[0], lead = h.beasts.get(g.members[0])!;
  const admin = person(1, lead.x + 25, lead.z, { unseen: true, speed: 6.2 });
  run(h, 0, 6, [admin]);
  assert.ok(g.awake, 'awake with an admin near');
  assert.equal(g.flee, null, 'a vanished admin sprinting by is not noticed');
  const start = g.members.map((i) => [h.beasts.get(i)!.x, h.beasts.get(i)!.z]);
  h.heard(admin.x, admin.z, [600, 1100], 6100);
  h.hurt(g.members[1], 999, admin, 6200);
  run(h, 6200, 12, [admin]);
  g.members.forEach((i, n) => {
    const b = h.beasts.get(i)!;
    if (b.diedAt) return;
    const was = Math.hypot(start[n][0] - admin.x, start[n][1] - admin.z), now = Math.hypot(b.x - admin.x, b.z - admin.z);
    assert.ok(now > was + 60, `${i} ran away from the shot: ${was.toFixed(0)} -> ${now.toFixed(0)} m`);
  });
});

ok('a herd bolting through close-set trunks keeps going: none stands running on one spot', () => {
  // (trunks every three metres, half a metre round: the stand of pines a hind froze in, 2026-10-23)
  const trunks: Ground = { ...ground, open: (x, z) => ground.open(x, z, 1) && Math.hypot(x - Math.round(x / 3) * 3, z - Math.round(z / 3) * 3) > 0.5 };
  const h = new Herd(trunks, (k) => ['stag', 'doe'].includes(k.id), () => PH, seeded(3));
  const deer = h.place('stag', -300, 0, 1, 4);
  const admin = person(1, -275, 2, { unseen: true });
  run(h, 1, 2, [admin]);
  h.heard(admin.x, admin.z, [600, 1100], 2100);
  let last = deer.map((b) => [b.x, b.z]);
  for (let s = 0; s < 8; s++) {
    run(h, 2200 + s * 1000, 1, [admin]);
    deer.forEach((b, n) => assert.ok(Math.hypot(b.x - last[n][0], b.z - last[n][1]) > 2, `${b.i} stood still in second ${s}`));
    last = deer.map((b) => [b.x, b.z]);
  }
});

ok('a hurt deer that is not killed bleeds, falls behind, and drops at the end of its blood trail', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const g = h.groups[0], b = h.beasts.get(g.members[1])!;
  const man = person(1, b.x + 60, b.z);
  const r = h.hurt(b.i, KIND.doe.hp * 0.6, man, 0)!;
  assert.equal(r.dead, false);
  assert.ok(b.bleeds);
  const was = [b.x, b.z];
  run(h, 0, 80, [man]);
  assert.equal(b.mode, A_DEAD);
  assert.ok(Math.hypot(b.x - was[0], b.z - was[1]) > 40, 'ran before it dropped');
});

ok('a bear roars and charges whoever comes too near, and its blows land on whoever stays', () => {
  const h = herd(['bear']);
  const bear = h.place('bear', 0, 0, 0)[0];
  bear.yaw = Math.atan2(-1, 0);
  const man = person(1, 12, 0);
  let roared = false, nearest = Infinity;
  const strikes = run(h, 0, 8, [man], () => {
    if (bear.mode === A_ROAR) roared = true;
    nearest = Math.min(nearest, Math.hypot(bear.x - man.x, bear.z - man.z));
  });
  assert.ok(roared, 'a warning first');
  assert.ok(strikes.length >= 2, `${strikes.length} blows`);
  assert.ok(strikes.every((s) => s.on === 1 && s.damage >= 20));
  // (its muzzle at him, never its body through him: its middle was once 0.2 m from his)
  assert.ok(nearest > KIND.bear.len / 2 + 0.4, `came within ${nearest.toFixed(2)} m`);
});

ok('outrun: away at a sprint from further than a dozen metres when it roars, and the bear never catches you', () => {
  for (const [start, caught] of [[16, false], [6, true]] as [number, boolean][]) {
    const h = herd(['bear']);
    const bear = h.place('bear', 0, 0, 0)[0];
    bear.yaw = Math.atan2(-1, 0);
    const man = person(1, start, 0);
    let ran = false;
    const strikes = run(h, 0, 30, [man], () => {
      if (bear.foe) ran = true;
      if (ran) {
        man.x += 6.2 * 0.2;
        man.speed = 6.2;
      }
    });
    assert.equal(strikes.length > 0, caught, `from ${start} m: ${strikes.length} blows`);
    if (!caught) assert.equal(bear.foe, 0, 'it gave up');
  }
});

ok('under a roof you are safe from a bear: it gives up and goes', () => {
  const h = herd(['bear']);
  const bear = h.place('bear', 0, 0, 0)[0];
  const man = person(1, 10, 0);
  run(h, 0, 2, [man]);
  assert.ok(bear.foe);
  man.sheltered = true;
  const strikes = run(h, 2000, 25, [man]);
  assert.equal(strikes.filter((s) => s.t > 1500).length, 0);
  assert.equal(bear.foe, 0);
});

ok('wolves circle and come in one at a time; when half the pack is down the rest run', () => {
  const h = herd(['wolf']);
  // (a pack of four, as the map has them, and as an admin's /spawn wolf 4 stands them)
  const pack = h.place('wolf', 0, 0, 0, 4), g = h.groups[pack[0].g];
  assert.equal(pack.length, 4);
  assert.ok(pack.every((w) => w.g === g.i), 'one pack');
  PH = 0.85;
  const man = person(1, 22, 0);
  const strikes = run(h, 0, 30, [man]);
  PH = 0.1;
  assert.ok(strikes.length >= 3, `${strikes.length} bites`);
  const by = new Set(strikes.map((s) => s.i));
  assert.ok(by.size >= 2, 'more than one wolf bit');
  for (let s = 1; s < strikes.length; s++) assert.ok(strikes[s].t - strikes[s - 1].t >= 400, 'one at a time');
  assert.ok(strikes.every((s) => s.damage <= 15));
  h.hurt(g.members[0], 999, man, 31_000);
  h.hurt(g.members[1], 999, man, 31_000);
  h.hurt(g.members[2], 999, man, 31_000);
  const last = h.beasts.get(g.members[3])!, was = Math.hypot(last.x - man.x, last.z - man.z);
  const after = run(h, 31_000, 10, [man]);
  assert.equal(after.length, 0);
  assert.ok(Math.hypot(last.x - man.x, last.z - man.z) > was + 30, 'the last one ran');
});

ok('gutting and skinning: a blade, six seconds at the body, and what it gives by the blade', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const b = h.beasts.get(h.groups[0].members[0])!;
  assert.equal(h.startSkin(b.i, 1, b.x, b.z, 0), 'There is nothing here to skin.');
  h.hurt(b.i, 999, null, 0);
  assert.equal(h.startSkin(b.i, 1, b.x + 10, b.z, 0), 'Too far from it.');
  assert.equal(h.startSkin(b.i, 1, b.x + 1, b.z, 1000), null);
  assert.equal(h.endSkin(b.i, 1, b.x + 1, b.z, 2000), null, 'too soon');
  assert.equal(h.endSkin(b.i, 2, b.x + 1, b.z, 1000 + SKIN.time * 1000), null, 'not theirs');
  const done = h.endSkin(b.i, 1, b.x + 1, b.z, 1000 + SKIN.time * 1000)!;
  assert.equal(done.kind.id, 'stag');
  assert.equal(h.endSkin(b.i, 1, b.x + 1, b.z, 9000), null, 'once');
  assert.equal(h.rows(b.x, b.z, 50).some((r) => r[0] === b.i), false, 'gone from sight');
  const knife = Object.fromEntries(yieldOf(KIND.stag, BLADES.knife)), hatchet = Object.fromEntries(yieldOf(KIND.stag, BLADES.hatchet));
  assert.deepEqual(knife, { meat_venison: 7, animal_fat: 2, hide: 1, bones: 5 });
  assert.ok(hatchet.meat_venison < knife.meat_venison && hatchet.hide === 1);
  assert.deepEqual(Object.fromEntries(yieldOf(KIND.bear, 1)), { meat_bear: 10, animal_fat: 6, pelt_bear: 1, bones: 8 });
});

ok('an admin stands any kind, one or a herd or pack of it, from the entity list', () => {
  for (const e of ENTITIES.filter((x) => x.kind === 'animal')) {
    assert.ok(KIND[e.animal!], `${e.id} is no kind`);
    assert.equal(entityBy(e.id), e);
    const h = herd([e.animal!, 'doe']);
    const got = h.place(e.animal!, 100, 100, 1, Math.min(4, e.most));
    assert.equal(got.length, Math.min(4, e.most), e.id);
    // (a bear lives alone: as many as are asked for, each its own; the rest one herd or pack)
    const alone = HERDS.find((h) => h.of.some(([id]) => id === e.animal))!.of.every(([, , most]) => most <= 1);
    assert.equal(new Set(got.map((b) => b.g)).size, alone ? got.length : 1, `${e.id}: ${alone ? 'each alone' : 'one herd'}`);
    assert.ok(got.every((b) => Math.hypot(b.x - 100, b.z - 100) < (alone ? 4 * got.length + 2 : 6)));
  }
  // (every kind there is can be stood: the list misses none)
  for (const k of KINDS) assert.ok(ENTITIES.some((e) => e.animal === k.id), `${k.id} cannot be spawned`);
  const deer = herd(['stag', 'doe']).place('stag', 0, 0, 1, 5);
  assert.deepEqual(deer.map((b) => KINDS[b.k].id), ['stag', 'doe', 'doe', 'doe', 'doe'], 'a stag asked for with others comes with hinds');
});

ok('herd and pack mates never stand inside each other: stood, grazing, bolting, or stood by an admin', () => {
  // (the owner: "they spawned inside eachother in the images")
  const h = herd(['stag', 'doe', 'wolf', 'cow'], 7);
  h.populate(0);
  const placed = [h.place('stag', 200, -200, 1, 6), h.place('wolf', 260, -200, 1, 5), h.place('cow', 200, -260, 1, 4)];
  const near = (x: number, z: number) => [...h.beasts.values()].filter((b) => Math.hypot(b.x - x, b.z - z) < 300);
  /** the closest two of one herd come, as a share of their two lengths together (0.5: nose touching tail) */
  const closest = (list: ReturnType<typeof near>) => {
    let m = Infinity;
    for (const a of list) for (const b of list) {
      if (a.i >= b.i || a.g !== b.g || a.diedAt || b.diedAt) continue;
      m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z) / (KINDS[a.k].len + KINDS[b.k].len));
    }
    return m;
  };
  const at = [...h.beasts.values()][0];
  const watchers = [person(1, at.x + 250, at.z), person(2, 230, -120)];
  assert.ok(closest(placed.flat()) >= ANIMALS.room.herd - 1e-9, `an admin's herd stood apart (${closest(placed.flat()).toFixed(2)})`);
  assert.ok(closest(near(at.x, at.z)) >= ANIMALS.room.herd - 1e-9, 'herds stood apart at the start');
  let worst = Infinity, settled = Infinity;
  for (let t = 0; t <= 240_000; t += 200) {
    // (a shot among them half way, so that they bolt and come back together)
    if (t === 120_000) {
      h.heard(at.x + 40, at.z, [400, 400], 1_000_000 + t);
      h.heard(230, -230, [400, 400], 1_000_000 + t);
    }
    h.tick(1_000_000 + t, watchers);
    const all = [...near(at.x, at.z), ...placed.flat()];
    const m = closest(all);
    worst = Math.min(worst, m);
    if (t > 100_000 && t < 120_000) settled = Math.min(settled, m);
  }
  assert.ok(worst >= 0.5, `never touching, bolting included (closest ${worst.toFixed(2)} of their lengths)`);
  assert.ok(settled >= 0.55, `grazing, room between them (closest ${settled.toFixed(2)})`);
});

ok('calls are rare and kept to their hours: a stag roars at dusk and first light, wolves howl by night, deer bark only as they bolt', () => {
  // (onboarding, for the owner: "make sure animals dont call too often so that its not annoying")
  const DAY = 1920_000, h = new Herd(ground, (k) => ['stag', 'doe', 'wolf'].includes(k.id), (now) => (now % DAY) / DAY, seeded(3));
  h.populate(0);
  const deer = h.groups.find((g) => HERDS[g.herd].id === 'deer')!, wolves = h.groups.find((g) => HERDS[g.herd].id === 'wolves')!;
  const near = (g: typeof deer) => h.beasts.get(g.members[0])!;
  const calls: { t: number; call: string; g: number; p: number; bolting: boolean }[] = [];
  // (two hours of the Zone's days, a still watcher 250 m from each, out of sight and smell)
  for (let t = 0; t <= 2 * 3_600_000; t += 200) {
    const people = [deer, wolves].map((g, i) => person(i + 1, near(g).x + 250, near(g).z, { crouch: true }));
    for (const c of h.tick(t + 1, people).calls) calls.push({ t, call: c.call, g: h.beasts.get(c.i)!.g, p: ((t + 1) % DAY) / DAY, bolting: !!h.groups[h.beasts.get(c.i)!.g].flee });
  }
  const roars = calls.filter((c) => c.call === 'roar' && c.g === deer.i), howls = calls.filter((c) => c.call === 'howl' && c.g === wolves.i);
  assert.ok(roars.length >= 1 && roars.length <= 12, `${roars.length} roars in two hours`);
  assert.ok(roars.every((c) => CALLS.roar.hours.some(([a, b]) => c.p >= a && c.p < b)), 'a roar only at dusk and first light');
  assert.ok(howls.length >= 1 && howls.every((c) => CALLS.howl.hours.some(([a, b]) => c.p >= a && c.p < b)), `${howls.length} howls, by night only`);
  for (const list of [roars, howls]) for (let n = 1; n < list.length; n++) assert.ok(list[n].t - list[n - 1].t >= CALLS.roar.every[0] * 1000 * (list === roars ? 1 : CALLS.howl.every[0] / CALLS.roar.every[0]) - 1, 'never sooner than its wait');
  // (a bark only ever as its herd bolts, from whatever it was: a wolf, a bear, a person; and once a minute at most)
  const bk = calls.filter((c) => c.call === 'bark');
  assert.ok(bk.every((c) => c.bolting), 'a bark only as the herd bolts');
  for (let n = 1; n < bk.length; n++) if (bk[n].g === bk[n - 1].g) assert.ok(bk[n].t - bk[n - 1].t >= CALLS.bark.every * 1000, 'a bark a minute at most');
  // a fright: the herd bolts with one bark, and not another within the minute
  const t0 = 2 * 3_600_000 + 1000, b = near(deer), sprinter = person(9, b.x + 20, b.z, { speed: 6 }), barks: number[] = [];
  for (let t = 0; t <= 60_000; t += 200) for (const c of h.tick(t0 + t, [sprinter]).calls) if (c.call === 'bark') barks.push(t);
  assert.equal(barks.length, 1, `${barks.length} barks in a minute of fright`);
});

ok('a game is told only of the animals within its reach', () => {
  const h = herd(['stag', 'doe']);
  h.populate(0);
  const b = [...h.beasts.values()][0];
  const rows = h.rows(b.x, b.z, ANIMALS.told);
  assert.ok(rows.some((r) => r[0] === b.i));
  assert.ok(rows.every((r) => Math.hypot(r[2] / 10 - b.x, r[3] / 10 - b.z) <= ANIMALS.told + 0.1));
});

console.log(`animals: ${n} passed`);
