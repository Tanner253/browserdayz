// What is taken joins its own pile wherever on the body it is, and goes first into a bag set for its kind
// (PlayerInventory.add, `prefer`); Sort all packs every bag at once, each kind into the bag set for it, and nothing is
// made or lost, even with no room to sort (sortAll in src/ui/inv-piles.ts). The owner, 2026-10-23.
//   npx tsx test/sort-all.test.ts

import assert from 'node:assert/strict';
import { PlayerInventory, type Container } from '../src/sim/inventory';
import { sortAll } from '../src/ui/inv-piles';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';

const pack = (inv: PlayerInventory) => inv.containers.find((c) => c.of === 'suitcase')!;
const total = (inv: PlayerInventory, id: string) => inv.containers.reduce((n, c) => n + c.items.filter((p) => p.item.id === id).reduce((s, p) => s + p.item.qty, 0), 0);
const uids = (inv: PlayerInventory) => inv.containers.flatMap((c) => c.items.map((p) => p.item.uid)).sort();
const sound = (c: Container) => {
  for (const p of c.items) assert.ok(c.free(p.item, p.x, p.y, p.rot, p.item), `${p.item.id} is off ${c.name} or under another`);
};

// a pile joins its own kind in the pack, not a new pile in the jacket's first free hole
{
  const inv = new PlayerInventory();
  assert.equal(inv.add(makeItem('suitcase')), null);
  const sack = pack(inv);
  const half = makeItem('ammo_9mm', 10);
  assert.ok(sack.place(half, 0, 0, false));
  assert.equal(inv.add(makeItem('ammo_9mm', 5)), null);
  assert.equal(half.qty, 15, 'the pile in the pack was not topped up');
  assert.equal(inv.containers.filter((c) => c.items.some((p) => p.item.id === 'ammo_9mm')).length, 1, 'a second pile was made');
  // (past a full pile, the rest is a pile of its own)
  const cap = ITEMS.ammo_9mm.stack!;
  assert.equal(inv.add(makeItem('ammo_9mm', cap)), null);
  assert.equal(total(inv, 'ammo_9mm'), 15 + cap, 'rounds were lost or made');
}

// a bag set for ammo is where rounds and magazines go first; food does not
{
  const inv = new PlayerInventory();
  inv.add(makeItem('suitcase'));
  const sack = pack(inv);
  inv.prefer = (c, it) => c === sack && ['ammo', 'magazine'].includes(ITEMS[it.id].category);
  const mag = makeItem('mag_ak');
  inv.add(mag);
  inv.add(makeItem('ammo_739', 20));
  const beans = makeItem('beans');
  inv.add(beans);
  assert.equal(inv.containerOf(mag), sack, 'the magazine did not go into the bag set for ammo');
  assert.ok(sack.items.some((p) => p.item.id === 'ammo_739'), 'the rounds did not go into the bag set for ammo');
  assert.notEqual(inv.containerOf(beans), sack, 'food went into the bag set for ammo before the pockets');
}

// Sort all: every bag at once, each kind into its bag, piles joined, nothing made or lost
{
  const inv = new PlayerInventory();
  inv.add(makeItem('suitcase'));
  const sack = pack(inv), pockets = inv.containers.filter((c) => c !== inv.tags && c !== sack);
  const ids = ['beans', 'ammo_739', 'bandage', 'mag_ak', 'apple', 'ammo_739', 'flask', 'mag_ak', 'stim', 'compass'];
  const put: ItemInstance[] = ids.map((id) => makeItem(id, ITEMS[id].stack ? 6 : undefined));
  // (strewn: every other thing in the pockets, the rest in the pack, two piles of rounds apart)
  put.forEach((it, i) => assert.equal((i % 2 ? sack : pockets.find((c) => c.hasRoom(it))!).add(it), null, `${it.id} did not go in`));
  const before = { rounds: total(inv, 'ammo_739'), food: total(inv, 'beans') + total(inv, 'apple') };
  const ammo = (c: Container, it: ItemInstance) => c === sack && ['ammo', 'magazine'].includes(ITEMS[it.id].category);
  assert.equal(sortAll(inv, ammo, (c) => c === sack), true, 'Sort all moved nothing');
  for (const c of inv.containers) sound(c);
  assert.equal(total(inv, 'ammo_739'), before.rounds, 'rounds were lost or made');
  assert.equal(total(inv, 'beans') + total(inv, 'apple'), before.food, 'food was lost or made');
  assert.equal(inv.containers.reduce((n, c) => n + c.items.filter((p) => p.item.id === 'ammo_739').length, 0), 1, 'the two piles of rounds were not joined');
  for (const c of inv.containers) for (const p of c.items) if (['ammo', 'magazine'].includes(ITEMS[p.item.id].category)) assert.equal(c, sack, `${p.item.id} is not in the bag set for ammo`);
  assert.equal(sortAll(inv, ammo, (c) => c === sack), false, 'sorted twice, it moved again');
}

// as seen in the game: a big gun in the pack set for ammo, magazines strewn in the vest and the jacket; the gun keeps
// its room and the magazines all go to the pack (they went nowhere when the rounds were laid first)
{
  const inv = new PlayerInventory();
  inv.add(makeItem('suitcase'));
  inv.add(makeItem('life_vest'));
  const sack = pack(inv), vest = inv.containers.find((c) => c.of === 'life_vest')!, jacket = inv.jacket;
  assert.equal(sack.add(makeItem('a91')), null, 'the 9A-91 did not go into the pack');
  for (const id of ['beans', 'frag', 'frag', 'flask']) assert.equal(sack.add(makeItem(id)), null, `${id} did not go into the pack`);
  for (const id of ['mag_ak', 'mag_ak', 'drum_ak', 'mag_ar']) assert.equal(vest.add(makeItem(id)), null, `${id} did not go into the vest`);
  for (const id of ['mag_ar', 'mag_colt']) assert.equal(jacket.add(makeItem(id)), null, `${id} did not go into the jacket`);
  const ammo = (c: Container, it: ItemInstance) => c === sack && ['ammo', 'magazine'].includes(ITEMS[it.id].category);
  const was = uids(inv);
  assert.equal(sortAll(inv, ammo, (c) => c === sack), true);
  assert.deepEqual(uids(inv), was, 'something was lost or made');
  assert.equal(inv.containerOf(inv.find((i) => i.id === 'a91')!), sack, 'the 9A-91 lost its room in the pack');
  const astray = inv.containers.filter((c) => c !== sack).flatMap((c) => c.items.filter((p) => ITEMS[p.item.id].category === 'magazine').map((p) => `${p.item.id} in ${c.name}`));
  assert.deepEqual(astray, [], 'magazines were left out of the bag set for ammo');
  for (const c of inv.containers) sound(c);
}

// no room to sort it all that way: everything stays, nothing made or lost
{
  const inv = new PlayerInventory();
  const all: string[] = [];
  for (const c of inv.containers.filter((c) => c !== inv.tags)) {
    // (full to the last cell with compasses, which do not stack)
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const b = makeItem('compass');
      if (c.fits(b, x, y, false) && c.place(b, x, y, false)) all.push(b.uid);
    }
  }
  const was = uids(inv);
  sortAll(inv, () => false, () => false);
  assert.deepEqual(uids(inv), was, 'a full set of pockets lost or made things being sorted');
  for (const c of inv.containers) sound(c);
}


// a bag's kind is the bag's own: the server's cleaning of what a game says it carries keeps it, and only a kind there is
{
  const { cleanInventory } = await import('../src/sim/inventory');
  const name = (v: unknown) => String(v ?? '');
  const raw = { slots: { back: { uid: 'pack-1', id: 'suitcase', qty: 1, for: 'ammo', cargo: [] }, vest: { uid: 'vest-1', id: 'life_vest', qty: 1, for: 'gold bars', cargo: [] } }, active: null, containers: [] };
  const inv = cleanInventory(raw, name)!;
  assert.equal(inv.slots.back?.for, 'ammo', 'what a pack is set for was lost in the server\'s cleaning');
  assert.equal(inv.slots.vest?.for, undefined, 'a kind there is not was kept');
  // (and it is what the game's own grid of that pack goes by)
  const back = new PlayerInventory();
  back.load(inv);
  const sack = back.containers.find((c) => c.of === 'suitcase')!;
  assert.equal(sack.bag?.for, 'ammo', 'the pack\'s grid does not know what the pack is set for');
}

console.log('sort-all: 6 checks pass');
