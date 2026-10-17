// Checks of magazines and what feeds a gun (src/sim/items.ts), of 2026-10-10. No network:
// `npx tsx test/mags.test.ts`.
//
// What was asked: magazines are things of their own, found and carried and filled by hand, as in DayZ; rounds
// lie thirty to a place in a pocket; a box is one place and holds twenty-five; every gun that takes a magazine
// has one. What is held to here besides: no round is made or lost by anything that is done with a magazine.

import assert from 'node:assert/strict';
import { FOUND_WITH_MAG, ITEMS, capacityOf, chambered, fillMag, fitAtRandom, fittedOf, foundMag, itemWeight, loadGun, magFed, magFits, magRoom, makeItem, makeMag, nextMag, sanitizeItem, stockGun, swapMag, type ItemInstance } from '../src/sim/items';
import { Container } from '../src/sim/inventory';
import { CRATE_SPECS, fillCrate } from '../src/sim/crates';
import { fillDrop } from '../src/sim/drops';
import { RNG } from '../src/core/noise';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const all = Object.values(ITEMS);
const guns = all.filter((d) => d.weapon);
const mags = all.filter((d) => d.mag);
const rounds = (it: ItemInstance | null) => (it ? (it.loaded ?? 0) + (it.rounds ?? 0) : 0);

ok('loose rounds lie thirty to a place; a box is one place in a pocket and holds twenty-five', () => {
  const ammo = all.filter((d) => d.category === 'ammo' && d.stack);
  assert.ok(ammo.length >= 4);
  // (but the launcher's grenades, the owner: "ammo stack to 50 for the grenade launcher"; and the .50 and 12.7 mm
  // rounds, a hand's length each and a tenth of a kilo, ten)
  const STACK: Record<string, number> = { ammo_40mm: 50, ammo_50bmg: 10, ammo_127x55: 10 };
  for (const d of ammo) assert.equal(d.stack, STACK[d.id] ?? 30, `${d.id} stacks to ${d.stack}`);
  const boxes = all.filter((d) => d.open);
  assert.ok(boxes.length >= 4);
  for (const d of boxes) {
    assert.deepEqual([d.w, d.h], [1, 1], `${d.id} takes ${d.w}x${d.h}`);
    assert.equal(d.open!.qty, 25, `${d.id} holds ${d.open!.qty}`);
    assert.ok(ITEMS[d.open!.gives]?.stack, `${d.id} gives ${d.open!.gives}`);
  }
  // (and every kind of round a gun fires comes in a box: but the big ones, which come loose)
  for (const g of guns.filter((g) => !STACK[g.weapon!.ammo])) assert.ok(boxes.some((b) => b.open!.gives === g.weapon!.ammo), `no box of what the ${g.id} fires`);
});

ok('every gun is fed by a magazine of its own or by its own tube, and every magazine goes into a gun and holds what that gun fires', () => {
  for (const g of guns) {
    const w = g.weapon!;
    if (!w.mag) {
      // (or loaded whole by hand: the broken-open shotguns, the launcher's cylinder)
      assert.ok(w.tube || ['db12', 'dual_sawnoff', 'm32'].includes(g.id), `${g.id} has neither a magazine nor a tube`);
      continue;
    }
    const m = ITEMS[w.mag];
    assert.ok(m?.mag, `${g.id}: ${w.mag} is not a magazine`);
    assert.ok(magFits(w.mag, g.id), `${w.mag} does not go into the ${g.id}`);
    assert.equal(m.mag!.capacity, w.capacity, `${g.id} says ${w.capacity} and its magazine holds ${m.mag!.capacity}`);
  }
  for (const m of mags) {
    assert.equal(m.category, 'magazine');
    assert.equal(m.attach?.slot, 'magazine');
    assert.ok(m.attach!.fits.length > 0);
    for (const g of m.attach!.fits) assert.equal(ITEMS[g]?.weapon?.ammo, m.mag!.ammo, `${m.id} holds ${m.mag!.ammo} and the ${g} fires something else`);
    assert.ok(!m.stack, `${m.id} stacks`);
  }
  // (what was asked for by size: the sniper's is one place)
  assert.deepEqual([ITEMS.mag_sniper.w, ITEMS.mag_sniper.h], [1, 1]);
});

ok('a gun holds what its magazine holds and one in its chamber; with no magazine, its chamber and no more', () => {
  const g = makeItem('m9');
  assert.equal(g.mag, null);
  assert.equal(capacityOf(g), 1);
  assert.equal(magRoom(g), 0);
  stockGun(g, 9);
  assert.equal(g.loaded, 0, 'rounds went into a gun with no magazine in it');
  loadGun(g, 9);
  assert.equal(g.mag, 'mag_m9');
  assert.equal(g.loaded, 9);
  assert.equal(capacityOf(g), 16);
  loadGun(g, 999);
  assert.equal(g.loaded, 15, 'a gun put into the world full has one over');
  // the shotgun is its own tube
  const s = loadGun(makeItem('benelli'), 999);
  assert.equal(s.mag, undefined);
  assert.equal(s.loaded, ITEMS.benelli.weapon!.capacity);
  assert.equal(capacityOf(s), ITEMS.benelli.weapon!.capacity);
  assert.ok(!magFed('benelli') && magFed('m9'));
});

ok('changing magazines neither makes a round nor loses one, and the round in the chamber stays', () => {
  for (const [gunId, inGun, inNext] of [['m9', 6, 15], ['m9', 0, 15], ['m9', 15, 0], ['colt', 1, 7], ['mosin', 3, 5], ['deagle', 7, 7]] as const) {
    const g = loadGun(makeItem(gunId), inGun);
    const next = makeMag(ITEMS[gunId].weapon!.mag!, inNext);
    const before = rounds(g) + rounds(next);
    const hadOne = chambered(g);
    const out = swapMag(g, next)!;
    assert.ok(out, `${gunId}: nothing came out`);
    assert.equal(rounds(g) + rounds(out), before, `${gunId} ${inGun}/${inNext}: ${before} rounds became ${rounds(g) + rounds(out)}`);
    assert.equal(out.rounds, Math.max(0, inGun - (hadOne ? 1 : 0)));
    assert.equal(g.loaded, (hadOne ? 1 : 0) + inNext);
    assert.ok((g.loaded ?? 0) <= capacityOf(g));
  }
  // taken out, and nothing put in: the gun keeps the one in its chamber
  const g = loadGun(makeItem('m9'), 10);
  const out = swapMag(g, null)!;
  assert.equal(out.rounds, 9);
  assert.equal(g.loaded, 1);
  assert.equal(g.mag, null);
  assert.equal(swapMag(g, null), null);
  // a magazine that is not this gun's does not go into it
  const wrong = makeMag('mag_colt', 7);
  assert.equal(swapMag(g, wrong), null);
  assert.equal(g.mag, null);
  assert.equal(wrong.rounds, 7);
  // the long one holds more, in the same gun
  const long = makeMag('mag_m9_ext', 20);
  swapMag(g, long);
  assert.equal(g.loaded, 21);
  assert.equal(capacityOf(g), 21);
});

ok('a magazine takes what it has room for and no more', () => {
  const m = makeMag('mag_colt', 4);
  assert.equal(fillMag(m, 2), 2);
  assert.equal(fillMag(m, 30), 1);
  assert.equal(m.rounds, 7);
  assert.equal(fillMag(m, 1), 0);
  assert.equal(makeMag('mag_colt', 99).rounds, 7);
  assert.equal(makeItem('mag_colt').rounds, 0);
});

ok('a gun from before magazines were things is given its own, or the long one it had, and keeps its rounds', () => {
  const old = { uid: 'a', id: 'm9', qty: 1, loaded: 12 } as ItemInstance;
  sanitizeItem(old);
  assert.equal(old.mag, 'mag_m9');
  assert.equal(old.loaded, 12);
  const long = { uid: 'b', id: 'm9', qty: 1, loaded: 18, mods: ['mag_m9_ext', 'suppressor_9'] } as ItemInstance;
  sanitizeItem(long);
  assert.equal(long.mag, 'mag_m9_ext');
  assert.deepEqual(long.mods, ['suppressor_9']);
  assert.equal(long.loaded, 18);
  // (and a Pistol 43, which is gone, is a Colt: with the Colt's magazine in it, and no more rounds than that holds)
  const gone = { uid: 'f', id: 'p38', qty: 1, loaded: 12, mag: 'mag_p38_ext', mods: ['suppressor_9'] } as ItemInstance;
  sanitizeItem(gone);
  assert.equal(gone.id, 'colt');
  assert.equal(gone.mag, 'mag_colt');
  assert.equal(gone.loaded, 8);
  assert.equal(sanitizeItem({ uid: 'g', id: 'mag_p38', qty: 1, rounds: 8 } as ItemInstance)!.rounds, 7);
  // and one that says it has none has none, however many rounds it says it has
  const bare = { uid: 'c', id: 'm9', qty: 1, loaded: 12, mag: null } as ItemInstance;
  sanitizeItem(bare);
  assert.equal(bare.mag, null);
  assert.equal(bare.loaded, 1);
  // a magazine cannot say it holds more than it does, nor a gun that it has somebody else's in it
  assert.equal(sanitizeItem({ uid: 'd', id: 'mag_m9', qty: 1, rounds: 400 } as ItemInstance)!.rounds, 15);
  assert.equal(sanitizeItem({ uid: 'e', id: 'm9', qty: 1, loaded: 5, mag: 'mag_deagle' } as ItemInstance)!.mag, null);
  assert.deepEqual(fittedOf(long), ['suppressor_9', 'mag_m9_ext']);
});

ok('guns are found with their magazine about six times in ten, never with rounds and no magazine, and what is dropped from the sky fires', () => {
  const rng = new RNG(4);
  let withMag = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const g = fitAtRandom(makeItem(i % 2 ? 'm9' : 'colt'), () => rng.next());
    stockGun(g, 6);
    if (g.mag) withMag++;
    else assert.equal(g.loaded, 0);
    assert.ok((g.loaded ?? 0) <= magRoom(g));
  }
  assert.ok(Math.abs(withMag / N - (FOUND_WITH_MAG.chance + 0.05)) < 0.08, `${withMag} of ${N} had a magazine`);
  for (let i = 0; i < 200; i++) {
    const m = foundMag(makeItem('mag_m9'), () => rng.next());
    assert.ok(m.rounds! >= 0 && m.rounds! <= Math.ceil(15 * FOUND_WITH_MAG.full));
  }
  // a supply drop: both guns with a magazine in them and full, and a second magazine for each, full
  const c = new Container('t', 't', 10, 12, [], true);
  fillDrop(c, () => rng.next());
  for (const id of ['mosin', 'colt']) {
    const g = c.items.find((p) => p.item.id === id)?.item;
    assert.ok(g?.mag && g.loaded === magRoom(g), `the drop's ${id}: ${g?.loaded} in ${g?.mag}`);
    const spare = c.items.find((p) => p.item.id === ITEMS[id].weapon!.mag)?.item;
    assert.equal(spare?.rounds, ITEMS[id].weapon!.capacity, `no full spare for the ${id}`);
  }
  // a crate's guns: a magazine or nothing in them
  for (const kind of Object.keys(CRATE_SPECS)) {
    for (let k = 0; k < 20; k++) {
      const spec = CRATE_SPECS[kind];
      const box = new Container('c', 'c', spec.w, spec.h, [], true);
      fillCrate(box, kind, () => rng.next(), false);
      for (const p of box.items) {
        const d = ITEMS[p.item.id];
        if (d.weapon?.mag && !p.item.mag) assert.equal(p.item.loaded, 0, `a ${p.item.id} in a ${kind} with rounds and no magazine`);
        if (d.weapon) assert.ok((p.item.loaded ?? 0) <= capacityOf(p.item));
        if (d.mag) assert.ok((p.item.rounds ?? 0) <= d.mag.capacity);
      }
    }
  }
});

ok('what is in a magazine and in a gun is weighed with it', () => {
  const empty = itemWeight(makeMag('mag_m9', 0)), full = itemWeight(makeMag('mag_m9', 15));
  assert.ok(Math.abs(full - empty - 15 * ITEMS.ammo_9mm.weight) < 1e-9);
  const g = loadGun(makeItem('m9'), 15);
  assert.ok(Math.abs(itemWeight(g) - (ITEMS.m9.weight + ITEMS.mag_m9.weight + 15 * ITEMS.ammo_9mm.weight)) < 1e-9);
});

ok('a reload changes a magazine for one of its own kind; the big one goes in by hand, or when nothing else has a round', () => {
  for (const [gun, small, big] of [['ak', 'mag_ak', 'drum_ak'], ['ar15', 'mag_ar', 'mag_ar_60']] as [string, string, string][]) {
    const g = loadGun(makeItem(gun), 5);
    assert.equal(g.mag, small);
    const full = makeMag(small, 30), half = makeMag(small, 12), huge = makeMag(big, ITEMS[big].mag!.capacity);
    assert.equal(nextMag(g, [half, huge, full]), full, `${gun}: with a thirty in it and a full thirty carried, the reload reached for the ${big}`);
    // (nothing of its own kind is fuller than what is in it: then the big one)
    assert.equal(nextMag(loadGun(makeItem(gun), 20), [half, huge]), huge);
    assert.equal(nextMag(g, [makeMag(small, 0), huge]), huge);
    // (with the big one in it, it is changed for another big one first, and for a small one that is fuller if there is none)
    const fat = loadGun(Object.assign(makeItem(gun), { mag: big }), 9);
    assert.equal(nextMag(fat, [full, huge]), huge);
    assert.equal(nextMag(fat, [full, half]), full);
    // (nothing carried is fuller than what is in it: nothing is changed; and one for another gun is never taken)
    assert.equal(nextMag(loadGun(makeItem(gun), 30), [half, makeMag(small, 29)]), null);
    assert.equal(nextMag(g, [makeMag('mag_m9', 15)]), null);
    // (a gun with no magazine in it takes its own kind first)
    const bare = makeItem(gun);
    assert.equal(bare.mag, null);
    assert.equal(nextMag(bare, [huge, half]), half);
    assert.equal(nextMag(bare, [huge]), huge);
  }
});

console.log(`\n${n} checks passed`);
