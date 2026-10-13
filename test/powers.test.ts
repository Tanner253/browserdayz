// Three of an admin's tools, as far as they can be tried with no game and no server (src/sim/powers.ts): whether
// a shot takes a round out of the gun, what the legs are told is carried, and the walk that fills every magazine
// and every gun somebody carries. (What the server makes of them, and who may have them, is test/admin.test.ts.)
//   npx tsx test/powers.test.ts

import assert from 'node:assert/strict';
import { PlayerInventory, bagGrid, cleanInventory } from '../src/sim/inventory';
import { ITEMS, capacityOf, magFits, makeItem, makeMag, sanitizeItem, type ItemInstance } from '../src/sim/items';
import { KITS } from '../src/sim/kits';
import { ORDERS } from '../src/net/orders';
import { CARRY_POWERS, carriedOf, refill, refilledWords, roundsSpent, weightFelt } from '../src/sim/powers';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const all = Object.values(ITEMS);
const guns = all.filter((d) => d.weapon), mags = all.filter((d) => d.mag);
/** every thing in a list of things, and in them, and in those */
const within = (things: Iterable<ItemInstance | null | undefined>): ItemInstance[] => [...things].flatMap((it) => (it ? [it, ...within((it.cargo ?? []).map((p) => p.item))] : []));
/** a kit as the server makes it and a game puts it on (`/kit` in server/index.ts, `kitUp` in src/game/game.ts) */
const kitted = (id: string) => {
  const inv = new PlayerInventory();
  const things = KITS.find((k) => k.id === id)!.things.map((th) => Object.assign(makeItem(th.id, th.qty), th.mag !== undefined ? { mag: th.mag } : {}, th.loaded !== undefined ? { loaded: th.loaded } : {}, th.mods ? { mods: [...th.mods] } : {}, th.rounds !== undefined ? { rounds: th.rounds } : {}));
  for (const it of things) assert.equal(inv.add(it), null, `${id}: no room for ${it.id}`);
  return { inv, things };
};

ok('a shot takes one round out of the gun, and none with endless ammunition on: for every gun there is', () => {
  assert.equal(roundsSpent(false), 1);
  assert.equal(roundsSpent(true), 0);
  assert.ok(guns.some((d) => d.weapon!.tube) && guns.some((d) => d.id === 'mosin') && guns.some((d) => d.weapon!.kind === 'auto') && guns.some((d) => d.weapon!.kind === 'pistol'), 'a kind of gun is missing from the list: the tube, the bolt rifle, an automatic, a pistol');
  for (const d of guns) {
    // (as `tryFire` in src/game/weapons.ts counts it: the one line there that a round is spent on)
    const fire = (gun: ItemInstance, endless: boolean) => {
      if ((gun.loaded ?? 0) <= 0) return false;
      gun.loaded = (gun.loaded ?? 0) - roundsSpent(endless);
      return true;
    };
    const gun = makeItem(d.id);
    refill([gun]);
    const full = gun.loaded!;
    assert.equal(full, capacityOf(gun));
    // endless: three times what it holds are fired, and it is as full as it was
    let fired = 0;
    for (let k = 0; k < full * 3; k++) fired += Number(fire(gun, true));
    assert.equal(fired, full * 3, `${d.id}: a shot was refused with endless ammunition on`);
    assert.equal(gun.loaded, full, `${d.id}: a round was spent with endless ammunition on`);
    // put off: it fires what it holds and no more
    fired = 0;
    for (let k = 0; k < full * 3; k++) fired += Number(fire(gun, false));
    assert.equal(fired, full, `${d.id}: fired ${fired} of the ${full} in it`);
    assert.equal(gun.loaded, 0);
    // and endless ammunition is not rounds from nowhere: an empty gun is still empty
    assert.equal(fire(gun, true), false, `${d.id}: an empty gun fired`);
  }
});

ok('weightless: the legs are told nothing is carried, and with it off, what it weighs', () => {
  const { inv } = kitted('heavy');
  const kg = inv.weight();
  assert.ok(kg > 30, `the heavy kit weighs ${kg.toFixed(1)} kg: not much of a weight to try this with`);
  assert.equal(weightFelt(kg, false), kg);
  assert.equal(weightFelt(kg, true), 0);
  assert.equal(weightFelt(0, true), 0);
});

ok('a magazine is filled to what it holds, whichever it is; a full one is left, and not counted', () => {
  for (const d of mags) {
    const empty = makeMag(d.id, 0), part = makeMag(d.id, 1), full = makeMag(d.id, d.mag!.capacity);
    const r = refill([empty, part, full]);
    for (const m of [empty, part, full]) assert.equal(m.rounds, d.mag!.capacity, `${d.id} holds ${d.mag!.capacity} and has ${m.rounds}`);
    assert.deepEqual(r, { mags: 2, guns: 0, rounds: d.mag!.capacity * 2 - 1, of: 3 });
  }
});

ok('a gun with a magazine in it: that magazine full and one in the chamber, whichever magazine it is', () => {
  for (const d of guns.filter((g) => g.weapon!.mag)) {
    for (const m of mags.filter((x) => magFits(x.id, d.id))) {
      const gun = Object.assign(makeItem(d.id), { mag: m.id, loaded: 0 });
      const r = refill([gun]);
      assert.equal(gun.mag, m.id, `${d.id}: its magazine was changed`);
      assert.equal(gun.loaded, m.mag!.capacity + 1, `${d.id} with ${m.id}: ${gun.loaded}`);
      assert.deepEqual(r, { mags: 0, guns: 1, rounds: m.mag!.capacity + 1, of: 1 });
      // (and it is a gun the game would have made: nothing in it is over what it holds)
      assert.equal(sanitizeItem(structuredClone(gun))!.loaded, gun.loaded);
      // part full, with the round in its chamber: topped up, and the rounds counted are the ones that went in
      gun.loaded = 3;
      assert.deepEqual(refill([gun]), { mags: 0, guns: 1, rounds: m.mag!.capacity - 2, of: 1 });
      // full already: looked at, and left
      assert.deepEqual(refill([gun]), { mags: 0, guns: 0, rounds: 0, of: 1 });
    }
  }
});

ok('a gun with no magazine in it is given the one it is made with, full, and one in the chamber', () => {
  for (const d of guns.filter((g) => g.weapon!.mag)) {
    const gun = makeItem(d.id);
    assert.equal(gun.mag, null);
    assert.equal(refill([gun]).guns, 1);
    assert.equal(gun.mag, d.weapon!.mag);
    assert.equal(gun.loaded, d.weapon!.capacity + 1);
    assert.equal(sanitizeItem(structuredClone(gun))!.loaded, gun.loaded);
  }
});

ok('a gun fed from its own tube: the tube full, no magazine put in it, and nothing in a chamber over that', () => {
  const tubes = guns.filter((g) => !g.weapon!.mag);
  assert.ok(tubes.some((d) => d.id === 'benelli'));
  for (const d of tubes) {
    const gun = makeItem(d.id);
    assert.deepEqual(refill([gun]), { mags: 0, guns: 1, rounds: d.weapon!.capacity, of: 1 });
    assert.equal(gun.loaded, d.weapon!.capacity);
    assert.equal(gun.mag, undefined);
    assert.equal(sanitizeItem(structuredClone(gun))!.loaded, gun.loaded);
  }
});

ok('nothing else is touched: the same things by their numbers, loose rounds, boxes, piles and what is fitted as they were', () => {
  const { inv } = kitted('breacher');
  const before = structuredClone(within(inv.topLevel()));
  for (const it of within(inv.topLevel())) {
    if (it.loaded !== undefined) it.loaded = 0;
    if (it.rounds !== undefined) it.rounds = 0;
  }
  refill(inv.topLevel());
  const after = within(inv.topLevel());
  assert.deepEqual(after.map((it) => it.uid), before.map((it) => it.uid), 'a thing was made, lost or moved');
  // (the kit comes full: emptied and refilled, it is the kit as it was handed over, to the round)
  assert.deepEqual(after, before);
  assert.ok(after.some((it) => it.id === 'ammo_12' && it.qty === 30) && after.some((it) => it.id === 'box_9mm'), 'the loose shells and the box are not there to be left alone');
});

for (const kit of KITS.filter((k) => k.things.some((t) => ITEMS[t.id].weapon))) {
  ok(`the ${kit.id} kit, shot dry and refilled, is the kit as it was handed over; refilled again, nothing is filled`, () => {
    const { inv, things } = kitted(kit.id);
    const handed = things.map((it) => [it.id, it.loaded, it.rounds, it.mag]);
    const fed = things.filter((it) => ITEMS[it.id].weapon || ITEMS[it.id].mag);
    for (const it of fed) {
      if (ITEMS[it.id].weapon) it.loaded = 0;
      else it.rounds = 0;
    }
    const r = refill(inv.topLevel());
    assert.deepEqual(things.map((it) => [it.id, it.loaded, it.rounds, it.mag]), handed);
    assert.equal(r.mags, fed.filter((it) => ITEMS[it.id].mag).length);
    assert.equal(r.guns, fed.filter((it) => ITEMS[it.id].weapon).length);
    assert.equal(r.of, fed.length);
    assert.equal(r.rounds, fed.reduce((s, it) => s + (it.loaded ?? 0) + (it.rounds ?? 0), 0));
    assert.equal(refilledWords(r), `${r.mags} magazine${r.mags === 1 ? '' : 's'} and ${r.guns} guns filled`);
    assert.deepEqual(refill(inv.topLevel()), { mags: 0, guns: 0, rounds: 0, of: fed.length });
  });
}

ok('wherever it is: in the hands, slung, in the holster, in a pocket, in the pack, and in a bag in the pack', () => {
  const inv = new PlayerInventory();
  for (const id of ['suitcase', 'chest_rig']) assert.equal(inv.add(makeItem(id)), null);
  const ak = makeItem('ak'), shotgun = makeItem('benelli'), pistol = Object.assign(makeItem('m9'), { mag: 'mag_m9_ext', loaded: 2 });
  for (const g of [ak, shotgun, pistol]) assert.equal(inv.add(g), null);
  assert.deepEqual([inv.slots.primary, inv.slots.secondary, inv.slots.holster], [ak, shotgun, pistol]);
  // a magazine in a jacket pocket (and taken into the hands, where it stays carried), one in the vest, one in the pack
  const inPocket = makeMag('mag_ak', 4), inVest = makeMag('mag_m9', 0), inPack = makeMag('drum_ak', 10), inBag = makeMag('mag_ak', 0);
  assert.ok(inv.jacket.add(inPocket) === null && inv.cargoOf(inv.slots.vest!)!.add(inVest) === null && inv.cargoOf(inv.slots.back!)!.add(inPack) === null);
  inv.hold(inPocket);
  assert.equal(inv.held(), inPocket);
  // and one in a black bag that is in the pack: three things down from what is worn
  const bag = makeItem('black_bag');
  assert.equal(bagGrid(bag)!.add(inBag), null);
  assert.equal(inv.cargoOf(inv.slots.back!)!.add(bag), null, 'the bag did not go into the pack');
  // and one held loose in the hands, carried nowhere (`loose` in src/game/game.ts): the game hands it over with the rest
  const loose = makeMag('mag_mpa', 0);
  // what the server would have of all this (the loose one it never hears of), read as it reads a game's word
  const kept = cleanInventory(JSON.parse(JSON.stringify(inv.serialize())), (v) => String(v ?? ''))!;
  const r = refill([...inv.topLevel(), loose]);
  assert.deepEqual(r, { mags: 5, guns: 3, rounds: (30 - 4) + 15 + (75 - 10) + 30 + 30 + 31 + 7 + (21 - 2), of: 8 });
  assert.deepEqual([ak.mag, ak.loaded, shotgun.loaded, pistol.mag, pistol.loaded], ['mag_ak', 31, 7, 'mag_m9_ext', 21]);
  assert.deepEqual([inPocket.rounds, inVest.rounds, inPack.rounds, inBag.rounds, loose.rounds], [30, 15, 75, 30, 30]);
  assert.equal(refilledWords(r), '5 magazines and 3 guns filled');
  // the server's copy, filled by the same walk, comes to the same thing by thing
  const theirs = refill(carriedOf(kept));
  assert.deepEqual(theirs, { ...r, mags: r.mags - 1, of: r.of - 1, rounds: r.rounds - 30 });
  const fed = (things: ItemInstance[]) => within(things).filter((it) => ITEMS[it.id].weapon || ITEMS[it.id].mag).map((it) => [it.uid, it.id, it.mag, it.loaded, it.rounds]).sort();
  assert.deepEqual(fed(carriedOf(kept)), fed(inv.topLevel()), 'the server’s copy and the game’s own do not agree after a refill');
  // and what the game then says it carries is that, read as the server reads it
  assert.deepEqual(fed(carriedOf(cleanInventory(JSON.parse(JSON.stringify(inv.serialize())), (v) => String(v ?? '')))), fed(carriedOf(kept)));
});

ok('what there is nothing to fill in says so, and nothing that is no thing is tripped over', () => {
  assert.deepEqual(refill([]), { mags: 0, guns: 0, rounds: 0, of: 0 });
  assert.deepEqual(refill([null, undefined, makeItem('beans'), { uid: 'x', id: 'no-such-thing', qty: 1 }]), { mags: 0, guns: 0, rounds: 0, of: 0 });
  assert.deepEqual(carriedOf(null), []);
  assert.deepEqual(carriedOf({ slots: { primary: null }, containers: [] }), []);
  assert.equal(refilledWords({ mags: 0, guns: 0, rounds: 0, of: 4 }), '');
  assert.equal(refilledWords({ mags: 1, guns: 0, rounds: 5, of: 1 }), '1 magazine filled');
  assert.equal(refilledWords({ mags: 0, guns: 1, rounds: 5, of: 1 }), '1 gun filled');
  assert.equal(refilledWords({ mags: 6, guns: 2, rounds: 99, of: 9 }), '6 magazines and 2 guns filled');
  // a list that leads back into itself is not followed for ever
  const loop = makeItem('suitcase');
  loop.cargo = [{ item: loop, x: 0, y: 0, rot: false }];
  assert.equal(refill([loop]).of, 0);
});

ok('a refill makes what is carried heavier by the rounds it put in, and by nothing else', () => {
  const { inv } = kitted('assault');
  for (const it of within(inv.topLevel())) {
    if (it.loaded !== undefined) it.loaded = 0;
    if (it.rounds !== undefined) it.rounds = 0;
  }
  const was = inv.weight();
  const r = refill(inv.topLevel());
  const round = (id: string) => ITEMS[ITEMS[id].weapon?.ammo ?? ITEMS[id].mag!.ammo].weight;
  const put = within(inv.topLevel()).reduce((s, it) => s + ((it.loaded ?? 0) + (it.rounds ?? 0)) * (ITEMS[it.id].weapon || ITEMS[it.id].mag ? round(it.id) : 0), 0);
  // (rounds weigh what DayZ has them weigh, about half the real thing: two hundred and more of them are a kilo or so)
  assert.ok(r.rounds > 200 && put > 0.8, `${r.rounds} rounds, ${put.toFixed(2)} kg of them`);
  assert.ok(Math.abs(inv.weight() - was - put) < 1e-6, `it weighs ${(inv.weight() - was).toFixed(3)} kg more, and the rounds put in weigh ${put.toFixed(3)}`);
});

ok('the inventory that never fills: what is in the hold weighs what it weighs unless weightless is on too, and a refill reaches it, the game’s and the server’s', () => {
  assert.equal(CARRY_POWERS.bottomless.order, 'bottomless');
  const inv = new PlayerInventory();
  inv.bottomless = true;
  for (let i = 0; i < 12; i++) assert.equal(inv.add(makeItem('ak')), null);
  assert.equal(inv.theHold.items.length, 10);
  const kg = inv.weight();
  assert.ok(kg > 11 * ITEMS.ak.weight, `twelve rifles weigh ${kg.toFixed(1)} kg`);
  assert.equal(weightFelt(kg, false), kg);
  assert.equal(weightFelt(kg, true), 0);
  // (the server's copy is read first, bare as they were made; then the game fills its own)
  const kept = cleanInventory(JSON.parse(JSON.stringify(inv.serialize())), (v) => String(v ?? ''))!;
  assert.equal(refill(inv.topLevel()).guns, 12);
  assert.equal(refill(carriedOf(kept)).guns, 12, 'the server’s refill does not reach what lies in the hold');
  assert.ok(inv.weight() > kg, 'the rounds a refill put into the guns in the hold weigh nothing');
});

ok('the powers about what is carried are spoken of in one way, and each is an order there is, an admin’s alone, as the refill is', () => {
  for (const p of Object.values(CARRY_POWERS)) {
    const o = ORDERS.find((x) => x.name === p.order);
    assert.ok(o?.admin, `/${p.order} is not an order, or not an admin's alone`);
    assert.deepEqual(o.args, ['[on|off]', '[who]']);
    for (const words of [p.label, p.mine, p.theirs, p.on, p.off]) assert.ok(words.length > 8);
  }
  assert.ok(ORDERS.find((x) => x.name === 'refill')?.admin);
});

console.log(`\n${n} checks passed`);
