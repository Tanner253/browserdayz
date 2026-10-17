// Checks of the grids things are carried in (src/sim/inventory.ts): piles, two things changing places, a pile
// halved, and what goes into what. No network: `npx tsx test/inventory.test.ts`.
// (The clothes themselves, and what becomes of an inventory kept from before they were things: test/clothes.test.ts.)

import assert from 'node:assert/strict';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import { BODY_GRID, Container, HOLD, HOLD_MOST, HOLD_W, PlayerInventory, bagGrid, cleanInventory, heldIn, holdOnlyEmpties, layOnBody, splitPile, swapPlaces, type SerializedInventory } from '../src/sim/inventory';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const at = (c: Container, it: unknown) => c.items.find((p) => p.item === it)!;

ok('bandages are carried five to a place and stims three, and each is found, given and made one at a time', () => {
  assert.equal(ITEMS.bandage.stack, 5);
  assert.equal(ITEMS.stim.stack, 3);
  assert.equal(makeItem('bandage').qty, 1);
  assert.equal(makeItem('stim').qty, 1);
  const inv = new PlayerInventory();
  for (let i = 0; i < 7; i++) assert.equal(inv.add(makeItem('bandage')), null);
  for (let i = 0; i < 4; i++) assert.equal(inv.add(makeItem('stim')), null);
  const piles = (id: string) => inv.containers.flatMap((c) => c.items).filter((p) => p.item.id === id).map((p) => p.item.qty);
  assert.deepEqual(piles('bandage'), [5, 2]);
  assert.deepEqual(piles('stim'), [3, 1]);
  // (rounds are still made six tenths of a pile, where nothing says how many)
  assert.equal(makeItem('ammo_9mm').qty, Math.round(ITEMS.ammo_9mm.stack! * 0.6));
});

ok('two things in one grid change places when one is let go on the other', () => {
  const c = new Container('c', 'c', 4, 3);
  const a = makeItem('bandage'), b = makeItem('stim');
  c.place(a, 0, 0, false);
  c.place(b, 3, 2, false);
  assert.ok(swapPlaces(a, c, c, b, { x: 3, y: 2, rot: false }));
  assert.deepEqual([at(c, a).x, at(c, a).y, at(c, b).x, at(c, b).y], [3, 2, 0, 0]);
  assert.equal(c.items.length, 2);
});

ok('a tall thing and a small one change places only where the tall one has room; with none, nothing is moved', () => {
  const c = new Container('c', 'c', 2, 2);
  const tall = makeItem('beans'), small = makeItem('bandage'), other = makeItem('stim');
  assert.deepEqual([ITEMS.beans.w, ITEMS.beans.h], [1, 2]);
  c.place(tall, 0, 0, false);
  c.place(small, 1, 0, false);
  // (the cell under the small one is free: the tall one goes where it lay, and the small one where the tall one was)
  assert.ok(swapPlaces(tall, c, c, small, { x: 1, y: 0, rot: false }));
  assert.deepEqual([at(c, tall).x, at(c, tall).y, at(c, small).x, at(c, small).y], [1, 0, 0, 0]);
  // (now a third thing lies under the small one: the tall one has no room there, either way up)
  const d = new Container('d', 'd', 2, 2);
  d.place(tall, 0, 0, false);
  d.place(small, 1, 0, false);
  d.place(other, 1, 1, false);
  const was = JSON.stringify(d.items.map((p) => [p.item.uid, p.x, p.y, p.rot]));
  assert.ok(!swapPlaces(tall, d, d, small, { x: 1, y: 0, rot: false }));
  assert.equal(JSON.stringify(d.items.map((p) => [p.item.uid, p.x, p.y, p.rot])), was, 'something was moved by a swap that could not be made');
});

ok('things change places between two grids, and a thing off the ground takes the place of one that is handed back', () => {
  const pocket = new Container('p', 'p', 2, 1), crate = new Container('k', 'k', 2, 2);
  const a = makeItem('bandage'), b = makeItem('stim');
  pocket.place(a, 0, 0, false);
  crate.place(b, 1, 1, false);
  assert.ok(swapPlaces(a, pocket, crate, b, { x: 1, y: 1, rot: false }));
  assert.ok(crate.has(a) && pocket.has(b) && !crate.has(b) && !pocket.has(a));
  // (off the ground: it is in no grid, and what it is let go on comes out of its grid)
  const g = makeItem('splint');
  assert.ok(swapPlaces(g, null, crate, a, { x: 1, y: 1, rot: false }));
  assert.ok(crate.has(g) && !crate.has(a));
  // (the pouch for dog tags takes nothing else: no swap into it)
  const tags = Object.assign(new Container('tags', 'tags', 2, 1), { only: 'dogtag' });
  const tag = makeItem('dogtag');
  tags.place(tag, 0, 0, false);
  assert.ok(!swapPlaces(b, pocket, tags, tag, { x: 0, y: 0, rot: false }));
  assert.ok(tags.has(tag) && pocket.has(b));
});

ok('a pile is halved, the smaller half laid beside it as a thing of its own; with no room, or one left, it is not', () => {
  const c = new Container('c', 'c', 2, 1);
  const five = makeItem('bandage', 5);
  c.place(five, 0, 0, false);
  const half = splitPile(c, five, makeItem)!;
  assert.ok(half && half.uid !== five.uid && half.id === 'bandage');
  assert.deepEqual([five.qty, half.qty], [3, 2]);
  assert.deepEqual([at(c, half).x, at(c, half).y], [1, 0]);
  // (the grid is full now)
  assert.equal(splitPile(c, five, makeItem), null);
  assert.equal(five.qty, 3);
  const one = makeItem('stim', 1), d = new Container('d', 'd', 2, 1);
  d.place(one, 0, 0, false);
  assert.equal(splitPile(d, one, makeItem), null);
  // (and a thing that is not piled is not halved)
  const tin = makeItem('beans'), e = new Container('e', 'e', 2, 2);
  e.place(tin, 0, 0, false);
  assert.equal(splitPile(e, tin, makeItem), null);
});

// ------------------------------------------------------------------ what goes into what (2026-10-13, "like dayz")
//
// A thing with something in it is worn, held, put on the ground, or laid in a body, a crate or a stash, and is not
// put inside another thing that is worn or carried. Things are put INTO a thing only while it is worn or lies in a
// body, a crate or a stash: never while it is itself in a pocket or a pack. Stash cases keep the rule they had.

/** somebody with a jacket and trousers on (as everybody has), a plate carrier and the big rucksack; and a crate and a body beside them */
const dressed = () => {
  const inv = new PlayerInventory();
  inv.slots.vest = makeItem('life_vest');
  inv.slots.back = makeItem('suitcase');
  const [jacket, trousers, vest, pack] = (['top', 'legs', 'vest', 'back'] as const).map((s) => inv.cargoOf(inv.slots[s]!)!);
  return { inv, jacket, trousers, vest, pack, worn: [jacket, trousers, vest, pack], crate: new Container('crate', 'Crate', 8, 6, [], true), body: new Container('corpse', 'Body', ...BODY_GRID, [], true) };
};
/** a thing with one thing in it */
const withThing = (id: string, inside: ItemInstance = makeItem('bandage')): ItemInstance => Object.assign(makeItem(id), { cargo: [{ item: inside, x: 0, y: 0, rot: false }] });
const HOLDERS = ['sack_pack', 'camping_pack', 'suitcase', 'chest_rig', 'soft_vest', 'life_vest', 'field_jacket', 'field_trousers'];

ok('a pack, a vest, a jacket or trousers with nothing in it goes anywhere it has room; with a thing in it, into nothing that is worn or carried', () => {
  const { worn, pack, jacket, crate, body } = dressed();
  for (const id of HOLDERS) {
    // empty (and one that has been looked into, and has an empty list for its inside)
    for (const it of [makeItem(id), Object.assign(makeItem(id), { cargo: [] })]) {
      assert.ok(pack.accepts(it) && pack.findSpace(it), `the rucksack did not take an empty ${id}`);
      assert.ok(crate.accepts(it) && body.accepts(it));
    }
    assert.ok(jacket.accepts(makeItem(id)));
    // with a thing in it
    const it = withThing(id);
    for (const c of worn) {
      assert.ok(!c.accepts(it), `${c.name} took a ${id} with a thing in it`);
      assert.equal(c.findSpace(it), null);
      assert.ok(!c.hasRoom(it) && !c.fits(it, 0, 0, false) && !c.place(it, 0, 0, false));
      assert.equal(c.add(it), it);
      assert.match(c.refusal(it)!, /has things in it: empty it first, or wear it, or put it on the ground/);
      assert.equal(c.items.length, 0);
    }
    // ... but onto a body, into a crate: yes, with what is in it
    for (const c of [crate, body]) {
      assert.equal(c.refusal(it), null);
      assert.equal(c.add(it), null, `${c.name} did not take a ${id} with a thing in it`);
      assert.equal(c.items.at(-1)!.item.cargo!.length, 1);
    }
    // ... and not into a pack that lies in a crate: that is the inside of another thing
    const lying = makeItem('suitcase');
    crate.add(lying);
    assert.ok(!bagGrid(lying, crate.depth + 1)!.accepts(withThing(id)), `a rucksack lying in a crate took a ${id} with a thing in it`);
    crate.items.length = body.items.length = 0;
  }
});

ok('a thing with things in it goes in its own place on the body, or stays in the hands for the ground: it is never put away', () => {
  const { inv } = dressed();
  const mine = inv.slots.back!, found = withThing('camping_pack');
  // (the back is taken: nowhere to put it, and it is handed back as it came)
  assert.equal(inv.freeSlotFor(found), null);
  assert.ok(!inv.hasRoom(found));
  assert.equal(inv.add(found), found);
  assert.equal(found.cargo!.length, 1);
  // (the back is free: it is slung, with what is in it)
  inv.remove(mine);
  assert.equal(inv.add(found), null);
  assert.equal(inv.slots.back, found);
  assert.equal(inv.cargoOf(found)!.items.length, 1);
  // the jacket with something in its pocket comes off: no pocket of another thing takes it; emptied, the pack does
  const jacket = inv.slots.top!, tin = makeItem('beans');
  inv.add(tin);
  assert.equal(jacket.cargo![0].item, tin);
  inv.remove(jacket);
  assert.ok(inv.containers.length === 4 && inv.containers.every((c) => !c.accepts(jacket)), 'a jacket with a tin in its pocket was put away in something');
  assert.equal(inv.freeSlotFor(jacket), 'top', 'it does not go back on, either');
  jacket.cargo!.length = 0;
  assert.ok(inv.cargoOf(found)!.hasRoom(jacket));
  // two things do not change places if that puts a thing with things in it into a pack
  const { pack: p2, crate } = dressed();
  const dressing = makeItem('bandage'), full = withThing('sack_pack');
  p2.place(dressing, 0, 0, false);
  crate.place(full, 0, 0, false);
  assert.ok(!swapPlaces(full, crate, p2, dressing, { x: 0, y: 0, rot: false }));
  assert.ok(crate.has(full) && p2.has(dressing) && p2.items.length === 1 && crate.items.length === 1);
  // (nor dragged the other way, the dressing let go on a rig with things in it in the crate: the rig would go into the pack)
  const other = withThing('chest_rig');
  crate.place(other, 4, 0, false);
  assert.ok(!swapPlaces(dressing, p2, crate, other, { x: 4, y: 0, rot: false }), 'a vest with things in it went into a worn pack by changing places');
  assert.ok(crate.has(other) && p2.has(dressing));
  // (two such things in a crate change places with one another: both stay in the crate's own grid)
  assert.ok(swapPlaces(full, crate, crate, other, { x: 4, y: 0, rot: false }));
});

ok('things are put into a thing while it is worn, or lies in a body or a crate; not while it is in a pocket or a pack, though they are taken out of it there', () => {
  const { worn, pack, jacket, crate, body } = dressed();
  const dressing = () => makeItem('bandage');
  // worn: all four take things
  for (const c of worn) assert.equal(c.add(dressing()), null, `${c.name}, worn, took nothing`);
  // lying in a crate, and on a body: opened where it lies, it takes things
  for (const c of [crate, body]) {
    const lying = makeItem('sack_pack');
    c.add(lying);
    const open = bagGrid(lying, c.depth + 1)!;
    assert.equal(open.depth, 1);
    assert.equal(open.add(dressing()), null, `a pack lying in a ${c.name} took nothing`);
    assert.ok(open.place(makeItem('beans'), 3, 0, false));
    // ... and a bag inside that pack does not: it is in a pack
    const inner = makeItem('chest_rig');
    assert.equal(open.add(inner), null);
    const shut = bagGrid(inner, open.depth + 1)!;
    assert.ok(!shut.accepts(dressing()), `a rig in a pack in a ${c.name} took a thing`);
  }
  // in a worn pack, and in a pocket
  for (const [c, id] of [[pack, 'sack_pack'], [jacket, 'chest_rig']] as [Container, string][]) {
    const bag = makeItem(id);
    assert.equal(c.add(bag), null);
    const shut = bagGrid(bag, c.depth + 1)!;
    assert.equal(shut.depth, 2);
    const thing = dressing();
    assert.ok(!shut.accepts(thing) && !shut.hasRoom(thing) && !shut.fits(thing, 0, 0, false) && !shut.place(thing, 0, 0, false), `a ${id} in the ${c.name} took a thing`);
    assert.equal(shut.findSpace(thing), null);
    assert.equal(shut.add(thing), thing);
    assert.match(shut.refusal(thing)!, /nothing is put into it while it is in a pocket or a pack/);
    assert.equal(bag.cargo!.length, 0);
    // (one kept with things in it, from before: they are there, they come out, and nothing goes onto them)
    const pile = makeItem('bandage', 2), tin = makeItem('beans');
    assert.ok(shut.restore(pile, 0, 0, false) && shut.restore(tin, 1, 0, false));
    const more = makeItem('bandage', 1);
    assert.equal(shut.add(more), more, 'a dressing was added to a pile in a bag that is in a pack');
    assert.deepEqual([pile.qty, more.qty], [2, 1]);
    assert.ok(!shut.joinable(more, c) && !shut.joinable(more, null), 'a thing from outside may be let go on a pile in it');
    assert.ok(shut.joinable(pile, shut), 'what is in it may not even be put together with what is in it');
    assert.equal(splitPile(shut, pile, makeItem), null);
    shut.remove(tin);
    assert.equal(c.add(tin), null);
    assert.deepEqual(bag.cargo!.map((p) => p.item), [pile]);
    assert.equal(shut.take('bandage', 2), 2);
    assert.equal(bag.cargo!.length, 0);
  }
});

ok('stash cases keep the rule they had: one with things in it goes into a worn pack and into a pack in a crate, and single things go into one that is in a pack', () => {
  /** the whole rule as it was before 2026-10-13, word for word (Container.accepts of that day, but for a thing going into itself) */
  const was = (c: Container, item: ItemInstance) => !(c.only && item.id !== c.only) && !(item.cargo?.length && (!c.holdsBags || c.depth >= 2 || (c.depth >= 1 && item.cargo.some((p) => p.item.cargo?.length))));
  const { worn, crate, body, inv } = dressed();
  const cases = ['stash_kit', 'old_suitcase', 'black_bag'];
  const lyingIn = (id: string, depth: number) => bagGrid(makeItem(id), depth)!;
  const grids: [string, Container][] = [
    ...worn.map((c): [string, Container] => [`${c.name}, worn`, c]), ['a crate', crate], ['a body', body], ['the tag pouch', inv.tags],
    ['a rucksack lying in a crate', lyingIn('suitcase', 1)], ['a plate carrier lying in a crate', lyingIn('life_vest', 1)],
    ...cases.flatMap((id): [string, Container][] => [[`a ${id} lying in a crate`, lyingIn(id, 1)], [`a ${id} in a worn pack`, lyingIn(id, 2)]]),
  ];
  const things: [string, () => ItemInstance][] = [
    ...cases.flatMap((id): [string, () => ItemInstance][] => [[`an empty ${id}`, () => makeItem(id)], [`a ${id} with a thing in it`, () => withThing(id)], [`a ${id} with a bag in it that has a thing in it`, () => withThing(id, withThing('sack_pack'))]]),
  ];
  let tried = 0;
  // a case, wherever it is put
  for (const [where, c] of grids) for (const [what, make] of things) {
    const it = make();
    assert.equal(c.accepts(it), was(c, it), `${what} into ${where}: it was ${was(c, it) ? 'taken' : 'refused'}, and is not now`);
    tried++;
  }
  // and whatever is put into a case
  for (const [where, c] of grids.filter(([, g]) => g.of && ITEMS[g.of].stash)) {
    for (const [what, make] of [['a dressing', () => makeItem('bandage')], ['an empty day pack', () => makeItem('sack_pack')], ['a day pack with a thing in it', () => withThing('sack_pack')], ['a rucksack with a bag in it that has a thing in it', () => withThing('suitcase', withThing('chest_rig'))]] as [string, () => ItemInstance][]) {
      const it = make();
      assert.equal(c.accepts(it), was(c, it), `${what} into ${where}: it was ${was(c, it) ? 'taken' : 'refused'}, and is not now`);
      tried++;
    }
  }
  assert.ok(tried > 100);
  // (said in so many words, so that the table above is not all there is to read)
  const [, , , pack] = worn;
  assert.ok(pack.accepts(withThing('stash_kit')) && !worn[0].accepts(withThing('stash_kit')) && !worn[2].accepts(withThing('stash_kit')));
  assert.ok(!pack.accepts(withThing('stash_kit', withThing('sack_pack'))) && crate.accepts(withThing('stash_kit', withThing('sack_pack'))));
  assert.ok(lyingIn('stash_kit', 2).accepts(makeItem('bandage')) && !lyingIn('stash_kit', 2).accepts(withThing('sack_pack')));
});

ok('a thing does not go inside itself, nor inside a thing that is inside it', () => {
  const { pack, inv } = dressed();
  const rucksack = inv.slots.back!, day = makeItem('sack_pack');
  assert.ok(!pack.accepts(rucksack));
  assert.match(pack.refusal(rucksack)!, /does not go inside itself/);
  pack.add(day);
  const inDay = bagGrid(day, pack.depth + 1)!;
  assert.ok(!inDay.accepts(rucksack) && !inDay.accepts(day));
  // (nor a crate's pack into the bag that lies in that pack)
  const crate = new Container('crate', 'Crate', 8, 6, [], true), outer = makeItem('camping_pack'), inner = makeItem('sack_pack');
  crate.add(outer);
  bagGrid(outer, 1)!.add(inner);
  assert.match(bagGrid(inner, 2)!.refusal(outer)!, /is inside the camping backpack|in a pocket or a pack/);
});

// ---- an admin's hold: the inventory that never fills (2026-10-13: "admins need an infinite inventory option").
// The rules of it, with no game and no server. Who may have it, and what the server keeps of it, is test/admin.test.ts.
{
  const name = (v: unknown) => String(v ?? '');
  /** what a game says it carries, as it goes over the wire, and as the server reads it */
  const wire = (inv: PlayerInventory) => JSON.parse(JSON.stringify(inv.serialize())) as SerializedInventory;
  const read = (inv: PlayerInventory) => cleanInventory(wire(inv), name)!;
  /** every thing carried, and in those, by its number */
  const uids = (things: ItemInstance[]): string[] => things.flatMap((it) => [it.uid, ...uids((it.cargo ?? []).map((p) => p.item))]);
  const all = (inv: PlayerInventory) => uids([...inv.topLevel(), ...(inv.neck ? [inv.neck] : [])]).sort();
  /** no two things in a grid lie on one cell, and none is off its sides */
  const sound = (c: Container) => {
    const taken = new Set<string>();
    for (const p of c.items) {
      const [w, h] = Container.size(p.item, p.rot);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + w <= c.w && p.y + h <= c.h, `${p.item.id} lies off the grid at ${p.x}, ${p.y}`);
      for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) {
        assert.ok(!taken.has(`${x},${y}`), `two things lie on cell ${x}, ${y}`);
        taken.add(`${x},${y}`);
      }
    }
  };
  /** a thing that lies in one cell and does not pile: every one given is one more thing */
  const small = Object.values(ITEMS).find((d) => d.w === 1 && d.h === 1 && !d.stack && !d.slot && d.id !== 'dogtag')!.id;

  ok('nobody has a hold who has not been given one: an inventory is what it was, to the byte', () => {
    const inv = new PlayerInventory();
    assert.ok(!inv.bottomless && !inv.containers.includes(inv.theHold));
    assert.deepEqual(inv.serialize().containers.map((c) => c.id), ['tags']);
    // (full pockets are full: the third rifle has nowhere to go, as ever)
    const rifles = [makeItem('ak'), makeItem('ak'), makeItem('ak')];
    assert.deepEqual(rifles.map((it) => inv.add(it)), [null, null, rifles[2]]);
    assert.ok(!inv.hasRoom(rifles[2]) && !inv.theHold.accepts(rifles[2]) && inv.theHold.add(rifles[2]) === rifles[2]);
    assert.match(inv.theHold.refusal(rifles[2])!, /the power is off/);
    assert.equal(inv.theHold.items.length, 0);
    assert.ok(Object.values(ITEMS).every((d) => d.w <= HOLD_W), 'a thing is wider than the hold: nothing would put it there the way up it is made');
  });

  ok('with it open, forty rifles all find room, and a pack with things in it; the pockets are filled first, as ever', () => {
    const inv = new PlayerInventory();
    inv.bottomless = true;
    assert.ok(inv.containers[inv.containers.length - 1] === inv.theHold, 'the hold is not the last place looked into for room');
    const rifles = Array.from({ length: 40 }, () => makeItem('ak'));
    for (const it of rifles) assert.ok(inv.hasRoom(it) && inv.add(it) === null, 'a rifle found no room');
    assert.deepEqual([inv.slots.primary, inv.slots.secondary], rifles.slice(0, 2), 'the places on the back were passed over for the hold');
    assert.deepEqual(inv.theHold.items.map((p) => p.item), rifles.slice(2));
    // something small goes into a pocket while there is one, not into the hold
    const tin = makeItem(small);
    assert.equal(inv.add(tin), null);
    assert.ok(inv.jacket.has(tin) && !inv.theHold.has(tin));
    // a pack with a thing in it, when there is one on the back already: no pocket takes it, and the hold does
    assert.equal(inv.add(makeItem('camping_pack')), null);
    const full = makeItem('sack_pack');
    assert.equal(bagGrid(full)!.add(makeItem(small)), null);
    assert.ok(!inv.jacket.accepts(full) && !inv.cargoOf(inv.slots.back!)!.accepts(full));
    assert.equal(inv.add(full), null);
    assert.ok(inv.theHold.has(full) && full.cargo!.length === 1);
    // and what lies in it is looked into and taken from where it lies, and takes nothing: it is a grid down
    assert.equal(inv.theHold.depth, 1);
    assert.match(bagGrid(full, inv.theHold.depth + 1)!.refusal(makeItem(small))!, /nothing is put into it while/);
    sound(inv.theHold);
    assert.ok(inv.theHold.h > inv.theHold.used(), 'there is no empty row under the last thing');
    // it is carried: it weighs what it weighs, and a hot key finds what is in it
    assert.ok(inv.weight() > 38 * ITEMS.ak.weight, `forty rifles weigh ${inv.weight().toFixed(1)} kg`);
    assert.ok([...inv.carried()].includes(rifles[39]) && inv.containerOf(rifles[39]) === inv.theHold && inv.find((it) => it === rifles[39]) === rifles[39]);
    // (forty rifles, the tin, the jacket and the trousers, the pack on her back, and the day pack with the tin in it)
    assert.equal(all(inv).length, 40 + 1 + 2 + 1 + 2, 'a thing is not among what is carried');
  });

  ok('it is kept and sent as one more grid, read back whole by the server past the 120 any other grid is read to, and laid as it lay', () => {
    const inv = new PlayerInventory();
    inv.bottomless = true;
    const things = [...Array.from({ length: 40 }, () => makeItem('ak')), ...Array.from({ length: 300 }, () => makeItem(small))];
    for (const it of things) assert.equal(inv.add(it), null);
    assert.ok(inv.theHold.items.length > 200, `only ${inv.theHold.items.length} things are in the hold: not enough to try the count with`);
    const kept = read(inv);
    assert.deepEqual(kept.containers.map((c) => c.id), ['tags', HOLD]);
    assert.equal(heldIn(kept).length, inv.theHold.items.length, 'the server read fewer things out of the hold than lie in it');
    // (any other grid is read to 120, as it was)
    const lying = wire(inv);
    lying.containers[1].id = 'made-up';
    assert.equal(cleanInventory(lying, name)!.containers[1].items.length, 120);
    // and two holds are one
    const twice = wire(inv);
    twice.containers.push({ id: HOLD, items: [{ ...makeItem(small), x: 0, y: 0, rot: false }] });
    assert.deepEqual(cleanInventory(twice, name)!.containers.map((c) => c.id), ['tags', HOLD]);
    // the game they come back in: everything where it lay, nothing at their feet, and the hold shut until it is said to be theirs
    const back = new PlayerInventory();
    assert.deepEqual(back.load(JSON.parse(JSON.stringify(kept))), [], 'something was handed back to be put at their feet');
    assert.ok(!back.bottomless && back.containers.includes(back.theHold), 'a hold that came back with things in it is open before the server has said so, or is not shown');
    assert.deepEqual(all(back), all(inv), 'what came back is not what was kept');
    const place = (i: PlayerInventory) => i.theHold.items.map((p) => [p.item.uid, p.x, p.y, p.rot]);
    assert.deepEqual(place(back), place(inv), 'a thing in the hold moved while it was kept');
    sound(back.theHold);
    // shut, it gives up what it has and takes nothing
    const one = makeItem('ak');
    assert.equal(back.add(one), one);
    assert.ok(!back.hasRoom(one));
    const out = back.theHold.items[0].item;
    back.remove(out);
    assert.ok(!back.theHold.has(out) && back.theHold.items.length === inv.theHold.items.length - 1);
    // and a thing that lies in it is moved about in it, shut or open
    const moved = back.theHold.items[0];
    assert.ok(back.theHold.fits(moved.item, moved.x, back.theHold.used(), moved.rot, moved.item));
    // a game that has never heard of a hold reads it as it reads any grid it does not know: its things are handed to its player, and none is lost
    const old = wire(inv);
    old.containers[1].id = 'unknown';
    const stale = new PlayerInventory(), over = stale.load(old);
    assert.equal(uids([...stale.topLevel(), ...over]).length, uids(inv.topLevel()).length);
  });

  ok('put off: what fits what is worn stays, the rest is still in the hold to be put down, and not one thing is lost', () => {
    const inv = new PlayerInventory();
    inv.bottomless = true;
    for (let i = 0; i < 40; i++) assert.equal(inv.add(makeItem('ak')), null);
    const before = all(inv), held = inv.theHold.items.length;
    assert.equal(held, 38);
    // (she takes the two off her back and puts them in the hold, and takes a pile of dressings into it by hand)
    for (const s of ['primary', 'secondary'] as const) {
      const it = inv.slots[s]!;
      inv.remove(it);
      assert.equal(inv.theHold.add(it), null);
    }
    const pile = makeItem('bandage', 5);
    assert.equal(inv.theHold.add(pile), null);
    const left = inv.shutHold();
    assert.ok(!inv.bottomless);
    // two rifles went back on her back and the dressings into a pocket; thirty-eight rifles fit nothing she wears
    assert.equal(left, 38);
    assert.equal(inv.theHold.items.length, 38);
    assert.ok(inv.slots.primary && inv.slots.secondary && inv.jacket.has(pile));
    assert.deepEqual(all(inv), [...before, pile.uid].sort(), 'a thing was lost, or made, in putting the power off');
    sound(inv.theHold);
    // the game then puts them at her feet a few at a time: each is out of the hold, and in the world
    const down: ItemInstance[] = [];
    while (inv.theHold.items.length) {
      for (const p of inv.theHold.items.slice(0, 6)) {
        inv.theHold.remove(p.item);
        down.push(p.item);
      }
    }
    assert.equal(down.length, 38);
    assert.ok(!inv.containers.includes(inv.theHold), 'an empty hold that is shut is still a grid');
    assert.deepEqual(inv.serialize().containers.map((c) => c.id), ['tags']);
    assert.deepEqual([...all(inv), ...down.map((it) => it.uid)].sort(), [...before, pile.uid].sort());
    // (everything carried goes when everything carried goes: a death, a kit, an admin's "empty everything")
    inv.bottomless = true;
    assert.equal(inv.add(makeItem('ak')), null);
    inv.theHold.add(makeItem('ak'));
    inv.clear();
    assert.ok(inv.theHold.items.length === 0 && inv.bottomless, 'the hold was not emptied with the rest, or the power went with it');
  });

  ok('nobody without the power puts a thing in a hold: the server keeps of one only what it already had there', () => {
    const inv = new PlayerInventory();
    inv.bottomless = true;
    const things = Array.from({ length: 6 }, () => makeItem('ak'));
    for (const it of things) inv.theHold.add(it);
    const had = read(inv);
    // one taken out and one put in, by a game the server has not given the power: the first is gone, the second is not kept
    inv.theHold.remove(things[0]);
    const extra = makeItem('ak');
    inv.theHold.add(extra);
    const now = read(inv);
    assert.equal(holdOnlyEmpties(now, had), 1);
    assert.deepEqual(heldIn(now).map((it) => it.uid).sort(), things.slice(1).map((it) => it.uid).sort());
    // a game that makes one up, to a server that had none of it: nothing in it is kept, and it is no grid
    const made = read(inv);
    assert.equal(holdOnlyEmpties(made, null), 6);
    assert.deepEqual(made.containers.map((c) => c.id), ['tags']);
    assert.deepEqual(heldIn(made), []);
    // nothing said of a hold: nothing done
    const plain = read(new PlayerInventory());
    assert.equal(holdOnlyEmpties(plain, had), 0);
    assert.deepEqual(plain.containers.map((c) => c.id), ['tags']);
  });

  ok('it takes eight hundred things and no more, and eight hundred of the fattest there are go to the server in one message', () => {
    const inv = new PlayerInventory();
    inv.bottomless = true;
    // (the fattest thing to say: a rifle with a magazine in it and every part it takes fitted)
    const parts = Object.values(ITEMS).filter((d) => d.attach?.fits.includes('ar15')).map((d) => d.id);
    const fat = () => Object.assign(makeItem('ar15'), { mag: 'mag_ar_60', loaded: 61, mods: parts.slice(0, 6), zero: 300 });
    const t0 = Date.now();
    for (let i = 0; i < HOLD_MOST; i++) assert.equal(inv.theHold.add(fat()), null, `the hold was full at ${i}`);
    const took = Date.now() - t0;
    assert.ok(took < 20_000, `${HOLD_MOST} things took ${took} ms to put away`);
    assert.equal(inv.theHold.holding(), HOLD_MOST);
    const over = makeItem(small);
    assert.equal(inv.theHold.add(over), over);
    assert.match(inv.theHold.refusal(over)!, /takes no more/);
    // (what is in a thing counts: a pack with things in it is as many things as it is)
    const pack = makeItem('sack_pack');
    bagGrid(pack)!.add(makeItem(small));
    inv.theHold.remove(inv.theHold.items[0].item);
    assert.equal(inv.theHold.add(pack), pack, 'a pack with a thing in it went in where there was room for one thing');
    assert.equal(inv.theHold.add(over), null);
    const said = JSON.stringify({ t: 'me', inv: inv.serialize(), vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false, blood: 5000, bleed: 0, broken: false } });
    // (the server reads no message of more than 256 KB: maxPayload in server/index.ts)
    assert.ok(said.length < 256 * 1024 * 0.7, `a full hold is ${(said.length / 1024).toFixed(0)} KB to say: too near the 256 the server reads`);
    assert.equal(heldIn(read(inv)).length, HOLD_MOST);
    sound(inv.theHold);
    console.log(`      (a full hold is ${(said.length / 1024).toFixed(0)} KB to say, ${inv.theHold.h} rows deep, and took ${took} ms to fill)`);
  });
}

// ---- the grids of what is worn, made bigger (2026-10-13: "i think we need to expand every equipable item with an
// inventory (lik ebackpacks and jackets) with more rows and colluns for example the largest backpack should b e able
// to hold 2 large primary weapons minimum to set the top end of the limit, look up how many inventory slots each
// dayz backpack has"). The table, and where DayZ's figures are from, is GRIDS in src/sim/items.ts.
{
  const name = (v: unknown) => String(v ?? '');
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  /** the grid of every thing that is worn and holds things, as it was until then: what is kept from before lies in these */
  const WAS: Record<string, [number, number]> = { field_jacket: [4, 4], field_trousers: [4, 3], chest_rig: [4, 2], soft_vest: [2, 2], armor_vest: [3, 2], heavy_armor: [3, 2], life_vest: [4, 3], sack_pack: [4, 4], camping_pack: [6, 5], suitcase: [7, 6] };
  /** and as it is */
  const IS: Record<string, [number, number]> = { field_jacket: [5, 5], field_trousers: [5, 4], chest_rig: [5, 3], soft_vest: [3, 3], armor_vest: [4, 3], heavy_armor: [4, 3], life_vest: [5, 4], sack_pack: [5, 5], camping_pack: [7, 6], suitcase: [9, 7] };
  /** the most DayZ has in any one thing of each class (its wiki's Clothing page, the tables of game version 1.29.163451): Field Backpack 8x8, OMK Jacket 6x5, cargo pants 5x4, Field Vest 5x4 */
  const DAYZ_MOST: Record<string, number> = { back: 64, top: 30, legs: 20, vest: 20 };
  const worn = Object.values(ITEMS).filter((d) => d.wear?.cargo);
  const cells = (id: string) => ITEMS[id].wear!.cargo![0] * ITEMS[id].wear!.cargo![1];
  /** every thing in a list of things, and in them, by its number */
  const uids = (things: (ItemInstance | null | undefined)[]): string[] => things.flatMap((it) => (it ? [it.uid, ...uids((it.cargo ?? []).map((p) => p.item))] : []));
  /** where everything lies in a thing, by its number */
  const places = (it: ItemInstance) => (it.cargo ?? []).map((p) => [p.item.uid, p.x, p.y, !!p.rot]).sort();
  /** a thing as it was kept packed to the last cell of the grid it had: a first-aid kit, three by two, in its far corner where it has one, and a compass in every other cell */
  const packedAsItWas = (id: string): ItemInstance => {
    const it = makeItem(id), [w, h] = WAS[id], box = new Container('was', 'As it was', w, h, (it.cargo = []));
    if (w >= 3 && h >= 2) assert.ok(box.place(makeItem('firstaid'), w - 3, h - 2, false));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) box.place(makeItem('compass'), x, y, false);
    assert.equal(box.items.reduce((n, p) => n + ITEMS[p.item.id].w * ITEMS[p.item.id].h, 0), w * h, `${id} was not packed full`);
    return it;
  };

  ok('every thing that is worn and holds things holds more than it did, across AND down; none holds more than DayZ\'s most of its class; and each says what it holds', () => {
    assert.deepEqual(worn.map((d) => d.id).sort(), Object.keys(WAS).sort(), 'a thing that is worn and holds things is not among those that were: say here what it was, or that it is new');
    for (const d of worn) {
      const [w, h] = d.wear!.cargo!, [ow, oh] = WAS[d.id];
      assert.deepEqual([w, h], IS[d.id], `${d.id} is ${w}x${h}`);
      // (never smaller either way, or what was kept in it has no place: this is the rule. Bigger both ways is what was asked.)
      assert.ok(w >= ow && h >= oh, `${d.id} is ${w}x${h}, smaller one way than the ${ow}x${oh} it was: what is kept in it would have to move`);
      assert.ok(w > ow && h > oh, `${d.id} is ${w}x${h}: it was ${ow}x${oh}, and is not bigger both ways`);
      assert.ok(w * h <= DAYZ_MOST[d.slot!], `${d.id} holds ${w * h}: more than DayZ's most for what is worn there, ${DAYZ_MOST[d.slot!]}`);
      assert.match(d.desc, new RegExp(`\\b${w * h}( more)? slots`), `${d.id} does not say it holds ${w * h}`);
    }
    // the ladders are the ladders they were: packs small to large, and the vests in the order of what they carried
    assert.deepEqual(['sack_pack', 'camping_pack', 'suitcase'].map(cells), [25, 42, 63]);
    const order = (ids: string[], of: (id: string) => number) => [...ids].sort((a, b) => of(a) - of(b) || ids.indexOf(a) - ids.indexOf(b));
    const vests = ['soft_vest', 'armor_vest', 'heavy_armor', 'chest_rig', 'life_vest'];
    assert.deepEqual(order(vests, cells), order(vests, (id) => WAS[id][0] * WAS[id][1]), 'the vests are no longer in the order of what they carried');
    // (a jacket's pockets are what the smallest pack is, as they were, and well under the others)
    assert.ok(cells('field_jacket') <= cells('sack_pack') && cells('field_jacket') * 1.5 < cells('camping_pack') && cells('field_trousers') < cells('field_jacket'));
    // what is not worn is as it was: the cases, a body
    assert.deepEqual([ITEMS.stash_kit.stash, ITEMS.old_suitcase.stash, ITEMS.black_bag.stash, BODY_GRID], [[8, 6], [6, 5], [5, 4], [8, 17]]);
  });

  ok('the biggest pack takes two AKs with a column and a row over, or three Mosins and a row; the middle pack takes an AR-15 and no AK', () => {
    const inv = new PlayerInventory();
    assert.equal(inv.add(makeItem('suitcase')), null);
    // (four rifles: two go on the back, where there are two places; the pack takes the other two, and a fifth has nowhere)
    const rifles = Array.from({ length: 5 }, () => makeItem('ak'));
    assert.deepEqual(rifles.map((it) => inv.add(it)), [null, null, null, null, rifles[4]]);
    const pack = inv.cargoOf(inv.slots.back!)!;
    assert.deepEqual([pack.w, pack.h], [9, 7]);
    assert.deepEqual(pack.items.map((p) => [p.item, p.x, p.y, p.rot]), [[rifles[2], 0, 0, false], [rifles[3], 0, 3, false]]);
    // with room over: the ninth column beside them and the seventh row under them, fifteen cells
    let over = 0;
    while (pack.add(makeItem('compass')) === null) over++;
    assert.equal(over, 9 * 7 - 2 * 8 * 3);
    assert.ok(pack.items.some((p) => p.x === 8 && p.y === 0) && pack.items.some((p) => p.x === 0 && p.y === 6));
    // three Mosins, each the whole nine across, and a row under them
    const long = new PlayerInventory();
    long.add(makeItem('suitcase'));
    const deep = long.cargoOf(long.slots.back!)!;
    for (let k = 0; k < 3; k++) assert.equal(deep.add(makeItem('mosin')), null);
    assert.deepEqual(deep.items.map((p) => [p.x, p.y]), [[0, 0], [0, 2], [0, 4]]);
    const fourth = makeItem('mosin');
    assert.equal(deep.add(fourth), fourth, 'a fourth Mosin went into one row');
    for (let k = 0; k < 9; k++) assert.equal(deep.add(makeItem('compass')), null);
    // the middle pack is seven across: an AR-15 lies in it, two of them, and an AK, eight long, does not either way up
    const mid = new PlayerInventory();
    mid.add(makeItem('camping_pack'));
    const middle = mid.cargoOf(mid.slots.back!)!, ak = makeItem('ak');
    assert.ok(!middle.hasRoom(ak) && middle.add(ak) === ak);
    for (let k = 0; k < 2; k++) assert.equal(middle.add(makeItem('ar15')), null);
    // and the smallest takes no long gun at all, as ever: a pistol, and what goes with one
    const day = new PlayerInventory();
    day.add(makeItem('sack_pack'));
    const little = day.cargoOf(day.slots.back!)!;
    for (const id of ['ak', 'mosin', 'benelli', 'ar15']) assert.ok(!little.hasRoom(makeItem(id)), `a ${id} goes into the day pack`);
    assert.equal(little.add(makeItem('m9')), null);
  });

  ok('what was kept under the grids as they were is laid thing for thing where it lay, by the game and by the server, and the cells there are since are free beside it', () => {
    for (const id of Object.keys(WAS)) {
      const slot = ITEMS[id].slot as 'top' | 'legs' | 'vest' | 'back', was = packedAsItWas(id), [ow, oh] = WAS[id];
      const kept = { slots: { [slot]: was }, active: null, containers: [{ id: 'tags', items: [] }] } as unknown as SerializedInventory;
      const before = places(was);
      assert.equal(before.length, ow * oh - (ow >= 3 && oh >= 2 ? 5 : 0));
      // the game: nothing handed back for the ground, and every thing in the cell it was kept in, the same way up
      const inv = new PlayerInventory();
      assert.deepEqual(inv.load(copy(kept)), [], `${id}: things were handed back for the ground`);
      const now = inv.slots[slot]!;
      assert.equal(now.uid, was.uid);
      assert.deepEqual(places(now), before, `${id}: a thing kept in it under the grid it had does not lie where it lay`);
      // the server, which reads what a thing holds to as many things as it has cells
      const theirs = cleanInventory(copy(kept), name)!.slots[slot]!;
      assert.deepEqual(places(theirs), before, `${id}: the server does not keep what was in it where it was`);
      // to the server and back and to the server again, as it goes every few seconds of play: still the same
      const again = new PlayerInventory();
      assert.deepEqual(again.load(copy(cleanInventory(copy(inv.serialize()), name)!)), []);
      assert.deepEqual(places(again.slots[slot]!), before);
      // and the room there is since: every new cell free, and filling them moves nothing that was there
      const grid = inv.cargoOf(now)!;
      let more = 0;
      while (grid.add(makeItem('compass')) === null) more++;
      assert.equal(more, cells(id) - ow * oh, `${id}: it has ${more} cells more than it had`);
      assert.deepEqual(places(now).filter(([uid]) => before.some(([u]) => u === uid)), before);
    }
    // (and the whole of somebody geared, at once: jacket, trousers, the vest and the pack that carried most, each full as it was)
    const whole = { slots: Object.fromEntries(['field_jacket', 'field_trousers', 'life_vest', 'suitcase'].map((id) => [ITEMS[id].slot!, packedAsItWas(id)])), active: null, containers: [{ id: 'tags', items: [] }] } as unknown as SerializedInventory;
    const had = Object.values(whole.slots).map((it) => places(it!));
    const inv = new PlayerInventory();
    assert.deepEqual(inv.load(copy(whole)), []);
    assert.deepEqual(Object.keys(whole.slots).map((s) => places(inv.slots[s as 'top']!)), had);
    assert.deepEqual(uids(inv.topLevel()).sort(), uids(Object.values(whole.slots)).sort());
  });

  ok('the fullest load there now is goes to the server in one message, an admin\'s full hold with it; every thing of it is kept; and on a body none of it is left over', () => {
    const inv = new PlayerInventory();
    // everything worn that is biggest of its place, two rifles with every part and a pistol
    const parts = (gun: string) => Object.values(ITEMS).filter((d) => d.attach?.fits.includes(gun)).map((d) => d.id).slice(0, 6);
    for (const id of ['suitcase', 'life_vest', 'helmet_k63', 'gasmask', 'work_gloves', 'rubber_boots']) assert.equal(inv.add(makeItem(id)), null);
    for (const gun of ['ak', 'ak', 'deagle']) assert.equal(inv.add(Object.assign(makeItem(gun), { mods: parts(gun) })), null);
    // (the fattest single thing to say: a tag, with whose it was, whose game took it and how long it has been carried)
    const tag = (k: number) => Object.assign(makeItem('dogtag'), { owner: `Survivor ${k}`.padEnd(16, 'x'), pid: 'p'.repeat(24), holder: 'h'.repeat(24), held: 899.123456 });
    let k = 0;
    const fill = (c: Container) => {
      while (c.add(tag(k)) === null) k++;
    };
    // the pack: as many stash cases as it takes, which is five (three on end across the top, two under them), each
    // with forty-eight places of its own, full; a thing in every cell left over; and every pocket and the pouch full
    const pack = inv.cargoOf(inv.slots.back!)!, cases: ItemInstance[] = [];
    for (const [x, y, rot] of [[0, 0, true], [3, 0, true], [6, 0, true], [0, 4, false], [4, 4, false]] as [number, number, boolean][]) {
      const box = makeItem('stash_kit');
      fill(bagGrid(box)!);
      assert.equal(box.cargo!.length, 48);
      assert.ok(pack.place(box, x, y, rot), `no room for a case at ${x}, ${y}`);
      cases.push(box);
    }
    for (const c of inv.containers) fill(c);
    for (const c of inv.containers) assert.equal(c.items.reduce((n, p) => n + ITEMS[p.item.id].w * ITEMS[p.item.id].h, 0), c.w * c.h, `${c.name} is not full`);
    const things = uids(inv.topLevel()).length;
    assert.ok(things > 330, `only ${things} things are carried`);
    const vitals = { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false, blood: 5000, bleed: 0, broken: false };
    const said = JSON.stringify({ t: 'me', inv: inv.serialize(), vitals });
    // (the server reads no message of more than 256 KB: maxPayload in server/index.ts)
    assert.ok(said.length < 256 * 1024 * 0.3, `the fullest load is ${(said.length / 1024).toFixed(0)} KB to say`);
    // every thing of it is kept by the server: no grid of it is cut short (a thing's are read to its cells, the pouch's to 120)
    const kept = cleanInventory(JSON.parse(JSON.stringify(inv.serialize())), name)!;
    assert.deepEqual(uids([...Object.values(kept.slots), ...kept.containers.flatMap((c) => c.items)]).sort(), uids(inv.topLevel()).sort(), 'the server did not keep every thing of the fullest load');
    assert.ok(Math.max(...worn.map((d) => cells(d.id)), 48) <= 120, 'a thing holds more things than the server reads out of one grid');
    // on a body, as the server lays one: what was worn, each with what is in it still in it, and the tags; nothing beside it
    const body = new Container('corpse', 'Body', ...BODY_GRID, [], true);
    const worn0 = [...Object.values(kept.slots).filter((it): it is ItemInstance => !!it), ...kept.containers.flatMap((c) => c.items)];
    assert.deepEqual(layOnBody(body, worn0).map((it) => it.id), [], 'the fullest load does not lie in a body\'s grid');
    assert.equal(uids(body.items.map((p) => p.item)).length, things);
    // and with an admin's hold full of the fattest rifles as well, it is still one message
    inv.bottomless = true;
    for (let i = 0; i < HOLD_MOST; i++) assert.equal(inv.theHold.add(Object.assign(makeItem('ar15'), { mag: 'mag_ar_60', loaded: 61, mods: parts('ar15'), zero: 300 })), null);
    const both = JSON.stringify({ t: 'me', inv: inv.serialize(), vitals });
    assert.ok(both.length < 256 * 1024 * 0.9, `the fullest load and a full hold are ${(both.length / 1024).toFixed(0)} KB to say: too near the 256 the server reads`);
    console.log(`      (the fullest load is ${things} things and ${(said.length / 1024).toFixed(0)} KB to say; with an admin's full hold, ${(both.length / 1024).toFixed(0)} KB)`);
  });
}

console.log(`\n${n} checks passed`);
