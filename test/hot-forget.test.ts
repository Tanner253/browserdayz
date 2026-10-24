// A hot key forgets its thing the moment the thing leaves the body (the owner, 2026-10-23: "when i drop an item my
// hotbar should forget about it"), and another of the kind picked up after does not bring it back: the key held the
// thing, not its kind (DayZ's way). A pile poured into another pile carried takes its key on with it. The server's
// copy is cleaned the same way (keepHotHeld, run by cleanInventory and takeOut).
//   npx tsx test/hot-forget.test.ts

import assert from 'node:assert/strict';
import { Container, PlayerInventory, cleanInventory, keepHotHeld } from '../src/sim/inventory';
import { combinePiles } from '../src/ui/inv-piles';
import { makeItem } from '../src/sim/items';

const packed = () => {
  const inv = new PlayerInventory();
  assert.equal(inv.add(makeItem('suitcase')), null);
  return inv;
};

// dropped: the key is bare, and a magazine of the same kind picked up after is not put on it
{
  const inv = packed();
  const mag = makeItem('mag_ak');
  inv.add(mag);
  inv.bind(3, mag);
  inv.remove(mag);
  inv.forgetGone();
  assert.equal(inv.hot[3], null, 'a dropped magazine stayed on its key');
  const other = makeItem('mag_ak');
  inv.add(other);
  inv.forgetGone();
  assert.equal(inv.hot[3], null, 'another magazine of the kind came back on the key');
  assert.equal(inv.hotItem(3), null);
  // (nor the very one, picked up again: it is a thing put on a key by hand again)
  inv.add(mag);
  inv.forgetGone();
  assert.equal(inv.hot[3], null, 'the same magazine picked up again came back on the key');
}

// used up, with another pile of the kind still carried: the key does not reach for the other pile
{
  const inv = packed();
  const one = makeItem('bandage', 1), more = makeItem('bandage', 3);
  inv.add(one);
  const sack = inv.containers.find((c) => c.of === 'suitcase')!;
  assert.ok(sack.place(more, 0, 2, false));
  inv.bind(4, one);
  assert.equal(inv.hotItem(4), one);
  inv.remove(one);
  assert.equal(inv.hotItem(4), null, 'a used-up pile\'s key brought up another of its kind');
  inv.forgetGone();
  assert.equal(inv.hot[4], null, 'a used-up pile stayed on its key');
}

// a pile poured into another pile carried (Combine all, a pick-up topping one up): the key goes with it
{
  const inv = packed();
  const sack = inv.containers.find((c) => c.of === 'suitcase')!;
  const big = makeItem('ammo_9mm', 10), small = makeItem('ammo_9mm', 4);
  assert.ok(sack.place(big, 0, 0, false));
  assert.ok(sack.place(small, 2, 0, false));
  inv.bind(5, small);
  combinePiles(inv.containers, 'ammo_9mm');
  assert.equal(small.qty, 0);
  inv.forgetGone();
  assert.equal(inv.hot[5]?.uid, big.uid, 'a pile combined into another lost its key');
}
{
  // (and topped up into another as it is moved, by Container.add: the same)
  const inv = packed();
  const sack = inv.containers.find((c) => c.of === 'suitcase')!;
  const big = makeItem('bandage', 2), part = makeItem('bandage', 1);
  assert.ok(sack.place(big, 0, 0, false));
  assert.ok(sack.place(part, 3, 0, false));
  inv.bind(6, part);
  sack.remove(part);
  assert.equal(sack.add(part), null);
  assert.equal(part.qty, 0, 'the bandage was not put onto the pile');
  inv.forgetGone();
  assert.equal(inv.hot[6]?.uid, big.uid, 'a pile topped up into another lost its key');
}

// poured into a pile in a crate: it has left the body, and its key is bare
{
  const inv = packed();
  const sack = inv.containers.find((c) => c.of === 'suitcase')!;
  const mine = makeItem('ammo_9mm', 5);
  assert.ok(sack.place(mine, 0, 0, false));
  inv.bind(7, mine);
  const crate = new Container('crate', 'Crate', 6, 4);
  assert.ok(crate.place(makeItem('ammo_9mm', 5), 0, 0, false));
  sack.remove(mine);
  assert.equal(crate.add(mine), null);
  inv.forgetGone();
  assert.equal(inv.hot[7], null, 'a pile poured into a crate\'s pile kept its key');
}

// a thing in a bag carried inside a pack is still on the body: its key is kept
{
  const inv = packed();
  const mag = makeItem('mag_ak');
  const sack = inv.containers.find((c) => c.of === 'suitcase')!;
  const pouch = makeItem('suitcase');
  pouch.cargo = [{ item: mag, x: 0, y: 0, rot: false }];
  sack.items.push({ item: pouch, x: 0, y: 0, rot: false });
  inv.bind(2, mag);
  inv.forgetGone();
  assert.equal(inv.hot[2]?.uid, mag.uid, 'a magazine in a bag in the pack was forgotten');
}

// the server's copy: a key whose thing is not in what the game says it carries is bare; one deep in a bag is kept;
// and a key bared by the server (takeOut) does not come back with the next load
{
  const name = (v: unknown) => String(v ?? '');
  const raw = {
    slots: { back: { uid: 'pack-1', id: 'suitcase', qty: 1, cargo: [{ item: { uid: 'mag-1', id: 'mag_ak', qty: 1, rounds: 30 }, x: 0, y: 0, rot: false }] } },
    active: null,
    containers: [],
    hot: [null, null, null, { uid: 'mag-1', id: 'mag_ak' }, { uid: 'mag-gone', id: 'mag_ak' }],
  };
  const inv = cleanInventory(raw, name)!;
  assert.equal(inv.hot?.[3]?.uid, 'mag-1', 'the server forgot a magazine still carried in the pack');
  assert.equal(inv.hot?.[4], null, 'the server kept a key whose magazine is not carried');
  // (taken out by the server, as an admin's take or a refused move does: server/index.ts takeOut ends with this)
  inv.slots.back!.cargo = [];
  keepHotHeld(inv);
  assert.equal(inv.hot?.[3], null, 'a magazine the server took out stayed on its key');
  const back = new PlayerInventory();
  back.load({ ...inv, hot: [null, null, null, { uid: 'mag-1', id: 'mag_ak' }] });
  assert.equal(back.hot[3], null, 'a game loading a key whose thing is not carried kept it');
}

// what a life comes back with has been seen: load marks every kind carried, so `autoHot` gives none of them a key
// the player took off it; a new life starts with none seen
{
  const inv = packed();
  inv.add(makeItem('bandage', 2));
  const again = new PlayerInventory();
  again.load(inv.serialize());
  assert.ok(again.autoGiven.has('bandage'), 'a kind carried at load was not taken as seen');
  again.clear();
  assert.equal(again.autoGiven.size, 0, 'a new life began with kinds already seen');
}

console.log('hot-forget: 8 checks pass');
