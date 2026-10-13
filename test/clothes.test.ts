// Checks of the clothes a survivor stands in, the places things are worn in, and what becomes of an inventory kept
// from before the jacket and the trousers were things (src/sim/inventory.ts, src/sim/items.ts), of 2026-10-13. No
// network and no server: `npx tsx test/clothes.test.ts`, from the top of the repository.
//
// What was asked: "When i kill someone and i loot their body and i pick up their backpack it should bring all the
// loot with it ... it should be the same for all inventories. we should make the jacket and pants the user spawns in
// with (the default inventory slots) clothing items. look up how dayz handles their equip slots, they have more than
// we do ... we will need to make our player character equip more robust. like dayz, once again."
//
// What is held to here besides, and matters most: every character the server keeps and every save is of the old
// shape until it has been read once, and NOTHING anybody carried is lost by that reading. The old shapes are real:
// test/fixtures/old-*.json were written by the code as it was the hour before the change (PlayerInventory.serialize
// of a new life, of a character with everything worn and every grid full, of the same as the server kept it, and
// of one packed to the last cell). They are not to be made again from today's code: it no longer makes that shape.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_SLOTS, CLOTHES, DOLL_SLOTS, GEAR_SLOTS, ITEMS, SLOT_KIND, SLOT_LABEL, TAG_HOLD, WEAPON_SLOTS, holds, makeItem, makeMag, type ItemInstance } from '../src/sim/items';
import { BODY_GRID, Container, HOT_KEYS, KEPT_DEPTH, PlayerInventory, SPILL, bagGrid, cleanHot, cleanInventory, cleanItem, cleanStored, layOnBody, upgradeInventory, type SerializedInventory } from '../src/sim/inventory';
import { PROTOCOL } from '../src/net/protocol';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

type Stored = ItemInstance & { x: number; y: number; rot: boolean };
const FIXTURES = ['old-fresh-kit.json', 'old-geared.json', 'old-kept-by-server.json', 'old-packed-full.json'];
/** a fixture, read afresh each time: loading is allowed to write on what it is given */
const old = (name: string): SerializedInventory => JSON.parse(readFileSync(`test/fixtures/${name}`, 'utf8'));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** how the server makes a name on a tag safe (its own is in server/index.ts: this one is as strict) */
const name = (v: unknown) => (typeof v === 'string' ? v : '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Survivor';

/**
 * Everything that is kept of one thing, as a line: which thing it is, how many, what is loaded in it, what is fitted
 * to it, whose tag it is and how long it has been carried, and every thing inside it, each with the place it lies
 * at and the way up, all the way down. Two lines are the same only if nothing about the thing has changed.
 */
const said = (it: ItemInstance, deep = true): string =>
  JSON.stringify([
    it.uid, it.id, it.qty, it.loaded ?? null, it.rounds ?? null, it.mag === undefined ? 'not said' : it.mag, it.mods ?? [], it.zero ?? null, it.left ?? null,
    it.owner ?? null, it.pid ?? null, it.holder ?? null, it.held ?? 0,
    deep ? (it.cargo ?? []).map((p) => [p.x, p.y, !!p.rot, said(p.item)]).sort() : 'whatever is in it',
  ]);
type Counted = { uid: string; id: string; line: string; own: string };
/**
 * every thing in an inventory, at any depth, each as its line (and as `own`, the line that says nothing of what is
 * in it: for when things are meant to have been put into other things); `loose` are things handed back for the ground
 */
const census = (inv: SerializedInventory, loose: ItemInstance[] = []): Counted[] => {
  const out: Counted[] = [];
  const walk = (it: ItemInstance | null | undefined) => {
    if (!it) return;
    out.push({ uid: it.uid, id: it.id, line: said(it), own: said(it, false) });
    for (const p of it.cargo ?? []) walk(p.item);
  };
  for (const it of Object.values(inv.slots)) walk(it);
  for (const c of inv.containers) for (const it of c.items) walk(it);
  for (const it of loose) walk(it);
  return out;
};
const lines = (list: { line: string }[]) => list.map((e) => e.line).sort();
const owns = (list: { own: string }[]) => list.map((e) => e.own).sort();
/** the same, but for the jacket and the trousers that were made on the way: they are new, and are the only things that are */
const butNewClothes = (after: Counted[], before: { uid: string }[]) => {
  const had = new Set(before.map((e) => e.uid));
  return after.filter((e) => had.has(e.uid) || !CLOTHES.some(([, id]) => id === e.id));
};
/** what lay in a grid, each thing with its place and its way up */
const laid = (items: { x: number; y: number; rot: boolean }[], line: (v: never) => string) => items.map((s) => [s.x, s.y, !!s.rot, line(s as never)]).sort();
const grid = (inv: SerializedInventory, id: string) => inv.containers.find((c) => c.id === id);
/** a body made as the server makes one (makeCorpse in server/index.ts): what was worn, then what was in each grid kept, laid in the body's grid */
const body = (kept: SerializedInventory, w = BODY_GRID[0], h = BODY_GRID[1]) => {
  const box = new Container('corpse', 'Body', w, h, [], true);
  const things = [...Object.values(kept.slots).filter((it): it is ItemInstance => !!it), ...kept.containers.flatMap((c) => c.items.map((s) => cleanItem(s, name)!))];
  return { box, spill: layOnBody(box, things) };
};

// ------------------------------------------------------------------ the places, and the two things

ok('what is worn has DayZ\'s eleven places, beside the two on the back and the holster; the place for gloves keeps its name and is called Gloves', () => {
  assert.deepEqual(WEAPON_SLOTS, ['primary', 'secondary', 'holster']);
  assert.deepEqual(GEAR_SLOTS, ['head', 'face', 'eyes', 'top', 'vest', 'belt', 'legs', 'back', 'hands', 'feet', 'armband']);
  assert.deepEqual(ALL_SLOTS, [...WEAPON_SLOTS, ...GEAR_SLOTS]);
  assert.deepEqual(SLOT_LABEL, {
    primary: 'On the back', secondary: 'On the back', holster: 'Holster',
    head: 'Head', face: 'Face', eyes: 'Eyes', top: 'Top', vest: 'Vest', belt: 'Belt', legs: 'Legs', back: 'Back', hands: 'Gloves', feet: 'Feet', armband: 'Armband',
  });
  for (const s of ALL_SLOTS) assert.ok(SLOT_KIND[s] && SLOT_LABEL[s], `${s} has no kind or no name`);
  // (the inventory draws each of them once, in one of its two columns)
  assert.deepEqual([...DOLL_SLOTS[0], ...DOLL_SLOTS[1]].sort(), [...GEAR_SLOTS].sort());
});

ok('no thing there was is worn anywhere else than it was', () => {
  const was: Record<string, string> = {
    mosin: 'long', benelli: 'long', mpa: 'long', ak: 'long', ar15: 'long', machete: 'long', crowbar: 'long', bat: 'long', shovel: 'long',
    colt: 'holster', m9: 'holster', deagle: 'holster',
    boonie_hat: 'head', helmet_k63: 'head', patrol_cap: 'head', fishermans_hat: 'head', gasmask: 'face',
    // (and what has been made since is worn where its like is: the steel helmet)
    helmet_m1: 'head',
    chest_rig: 'vest', soft_vest: 'vest', armor_vest: 'vest', heavy_armor: 'vest', life_vest: 'vest',
    sack_pack: 'back', camping_pack: 'back', suitcase: 'back', garden_gloves: 'hands', work_gloves: 'hands', rubber_boots: 'feet',
  };
  const now = Object.fromEntries(Object.values(ITEMS).filter((d) => d.slot && !CLOTHES.some(([, id]) => id === d.id)).map((d) => [d.id, d.slot]));
  assert.deepEqual(now, was);
});

ok('the jacket and the trousers are things: worn on the top and the legs, with pockets no smaller either way than the body had (4x4 and 4x3: they are 5x5 and 5x4), and a model the game ships', () => {
  const j = ITEMS.field_jacket, t = ITEMS.field_trousers;
  // (the pockets were the size the body's own grids were, so that nothing kept in them had to move; they were made
  // bigger on 2026-10-13, both ways, and for the same reason are never made smaller either way: see GRIDS in src/sim/items.ts)
  assert.deepEqual([j.slot, j.w, j.h, j.wear?.cargo, j.category], ['top', 3, 3, [5, 5], 'clothing']);
  assert.deepEqual([t.slot, t.w, t.h, t.wear?.cargo, t.category], ['legs', 3, 2, [5, 4], 'clothing']);
  assert.ok(j.wear!.cargo![0] >= 4 && j.wear!.cargo![1] >= 4 && t.wear!.cargo![0] >= 4 && t.wear!.cargo![1] >= 3, 'a pocket is smaller than the grid the body had: what was kept in it has no place');
  assert.deepEqual(CLOTHES, [['top', 'field_jacket'], ['legs', 'field_trousers']]);
  const models = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).models as Record<string, unknown>;
  for (const d of [j, t]) {
    assert.ok(models[d.model], `${d.id} is drawn with ${d.model}, which is not among the game's models`);
    assert.ok(d.tint !== undefined, `${d.id} borrows a model and is not dyed to tell it from the thing it is borrowed from`);
  }
  assert.notEqual(j.tint, t.tint);
});

ok('nothing is made yet for the eyes, the belt or the arm: the places are there and empty, and nothing minds', () => {
  const none = ['eyes', 'belt', 'armband'] as const;
  for (const s of none) assert.deepEqual(Object.values(ITEMS).filter((d) => d.slot === SLOT_KIND[s]), [], `something is made for ${s}: this check is out of date, and so may the body's grid be`);
  const inv = new PlayerInventory();
  for (const d of Object.values(ITEMS)) {
    if (d.id === 'dogtag') continue;
    const free = inv.freeSlotFor(makeItem(d.id));
    assert.ok(!free || !(none as readonly string[]).includes(free), `${d.id} would be put in ${free}`);
  }
  for (const s of none) assert.equal(inv.slots[s], null);
  assert.deepEqual(inv.wear('armor'), []);
  assert.equal(inv.containers.length, 3);
  // (kept and read again with them empty: they are said, as nothing, and stay so)
  const kept = copy(inv.serialize());
  for (const s of none) assert.ok(s in kept.slots && kept.slots[s] === null);
  const again = new PlayerInventory();
  assert.deepEqual(again.load(kept), []);
  for (const s of none) assert.equal(again.slots[s], null);
  assert.deepEqual(copy(again.serialize()), kept);
  assert.deepEqual(cleanInventory(kept, name)!.slots, kept.slots);
});

ok('every new life stands in a jacket and trousers with nothing in them, and what it is given goes into their pockets', () => {
  const inv = new PlayerInventory();
  const check = () => {
    assert.equal(inv.slots.top?.id, 'field_jacket');
    assert.equal(inv.slots.legs?.id, 'field_trousers');
    assert.deepEqual([inv.jacket.w, inv.jacket.h, inv.pants.w, inv.pants.h], [5, 5, 5, 4]);
    assert.deepEqual([inv.jacket.items.length, inv.pants.items.length], [0, 0]);
    assert.deepEqual(inv.containers.map((c) => c.name), ['Dog tags', 'Field Jacket', 'Field Trousers']);
    assert.equal(inv.topLevel().length, 2);
  };
  check();
  // (as freshKit in src/game/game.ts makes one: clear, then the three things)
  const first = inv.slots.top;
  inv.clear();
  check();
  assert.notEqual(inv.slots.top, first, 'the jacket of the life before is still on');
  for (const id of ['beans', 'thermos', 'bandage']) assert.equal(inv.add(makeItem(id)), null);
  assert.deepEqual(inv.slots.top!.cargo!.map((p) => p.item.id), ['beans', 'thermos', 'bandage']);
  // (what is kept of it: the pouch is the only grid that is no thing's; the pockets are in the two things)
  const kept = inv.serialize();
  assert.deepEqual(kept.containers.map((c) => c.id), ['tags']);
  assert.equal(kept.slots.top!.cargo!.length, 3);
});

ok('with nothing on the top or the legs there are no pockets there: hands only', () => {
  const inv = new PlayerInventory();
  inv.slots.top = null;
  inv.slots.legs = null;
  assert.deepEqual(inv.containers.map((c) => c.name), ['Dog tags']);
  assert.deepEqual([inv.jacket.w, inv.jacket.h, inv.pants.w, inv.pants.h], [0, 0, 0, 0]);
  const tin = makeItem('beans');
  assert.ok(!inv.hasRoom(tin));
  assert.equal(inv.add(tin), tin, 'a thing was put away by somebody with no pockets');
  assert.equal(inv.jacket.add(tin), tin);
  assert.equal(inv.weight(), 0);
  // (kept and read like that, they stay like that: nobody is dressed again by a load)
  const kept = copy(inv.serialize());
  const again = new PlayerInventory();
  assert.deepEqual(again.load(kept), []);
  assert.deepEqual([again.slots.top, again.slots.legs], [null, null]);
  assert.deepEqual([cleanInventory(kept, name)!.slots.top, cleanInventory(kept, name)!.slots.legs], [null, null]);
  // (one put back on is the pockets again)
  const jacket = makeItem('field_jacket');
  assert.equal(inv.add(jacket), null);
  assert.equal(inv.slots.top, jacket);
  assert.equal(inv.add(tin), null);
  assert.equal(jacket.cargo![0].item, tin);
});

ok('taken off, a jacket keeps what is in its pockets; another is put on in its place; a hot key on a thing in the first finds nothing', () => {
  const inv = new PlayerInventory();
  const mine = inv.slots.top!, tin = makeItem('beans'), dressing = makeItem('bandage');
  inv.add(tin);
  inv.add(dressing);
  inv.bind(4, dressing);
  inv.hold(dressing);
  assert.equal(inv.held(), dressing);
  inv.remove(mine);
  assert.equal(inv.slots.top, null);
  assert.deepEqual(mine.cargo!.map((p) => p.item), [tin, dressing], 'the jacket came off without what was in it');
  assert.equal(inv.held(), null, 'a thing in a jacket on the ground is still in the hands');
  assert.equal(inv.hotItem(4), null);
  assert.ok(!inv.find((it) => it === tin));
  const other = makeItem('field_jacket');
  other.cargo = [{ item: makeItem('stim'), x: 3, y: 3, rot: false }];
  assert.equal(inv.add(other), null);
  assert.equal(inv.slots.top, other);
  assert.equal(inv.jacket.items[0].item.id, 'stim');
  // (and the first goes back on with what was in it: the key finds its dressing again)
  inv.remove(other);
  inv.add(mine);
  assert.equal(inv.hotItem(4), dressing);
});

// ------------------------------------------------------------------ what was kept from before

for (const file of FIXTURES) {
  ok(`${file}: read by the game, nothing that was carried is lost, changed or moved, and the pockets are the jacket's and the trousers'`, () => {
    const was = old(file), before = census(old(file));
    assert.ok(!('top' in was.slots) && grid(was, 'jacket') && grid(was, 'pants'), 'this fixture is not of the old shape');
    const inv = new PlayerInventory();
    const over = inv.load(old(file));
    assert.deepEqual(over.map((it) => it.id), [], 'things were handed back for the ground');
    const now = copy(inv.serialize());
    assert.deepEqual(now.containers.map((c) => c.id), ['tags']);
    assert.equal(now.slots.top?.id, 'field_jacket');
    assert.equal(now.slots.legs?.id, 'field_trousers');
    const after = census(now);
    assert.equal(after.length, before.length + 2, 'there are not exactly two things more than there were (the jacket and the trousers)');
    assert.deepEqual(lines(butNewClothes(after, before)), lines(before));
    // where each thing lay in a pocket is where it lies in the jacket's, the same way up
    const asStored = (s: Stored) => said(s), asPlaced = (p: { item: ItemInstance }) => said(p.item);
    assert.deepEqual(laid(now.slots.top!.cargo!, asPlaced as never), laid(grid(was, 'jacket')!.items, asStored as never));
    assert.deepEqual(laid(now.slots.legs!.cargo!, asPlaced as never), laid(grid(was, 'pants')!.items, asStored as never));
    assert.deepEqual(laid(grid(now, 'tags')!.items, asStored as never), laid(grid(was, 'tags')!.items, asStored as never));
    // every other thing worn is the very thing it was, with what was in it where it was
    for (const [slot, it] of Object.entries(was.slots)) assert.equal(it ? said(now.slots[slot]!) : null, it ? said(it) : null, slot);
  });

  ok(`${file}: read a second time, nothing changes`, () => {
    const inv = new PlayerInventory();
    inv.load(old(file));
    const once = copy(inv.serialize());
    assert.equal(upgradeInventory(once).inv, once, 'one already of today was made over again');
    assert.deepEqual(upgradeInventory(once).left, []);
    const again = new PlayerInventory();
    assert.deepEqual(again.load(copy(once)), []);
    assert.deepEqual(copy(again.serialize()), once);
    // (and through the server and back, as a character is kept between sessions: every thing the same, in the same
    // place, on the same keys. The server writes "carried for 0 s" on a tag that said nothing of it, and that is all.)
    const third = new PlayerInventory();
    assert.deepEqual(third.load(copy(cleanInventory(copy(once), name)!)), []);
    const back = copy(third.serialize());
    assert.deepEqual(lines(census(back)), lines(census(once)));
    assert.deepEqual([back.hot, back.containers.map((c) => c.id), Object.keys(back.slots)], [once.hot, once.containers.map((c) => c.id), Object.keys(once.slots)]);
  });

  ok(`${file}: read by the server and then by the game, nothing is lost either way, and nothing waits in a grid of leftovers`, () => {
    const before = census(old(file));
    const kept = cleanInventory(old(file), name)!;
    assert.deepEqual(kept.containers.map((c) => c.id), ['tags'], `the server kept grids of the old shape, or leftovers (${SPILL})`);
    assert.equal(kept.active, null);
    assert.equal(kept.slots.top?.id, 'field_jacket');
    assert.equal(kept.slots.legs?.id, 'field_trousers');
    const after = census(kept);
    assert.equal(after.length, before.length + 2);
    assert.deepEqual(lines(butNewClothes(after, before)), lines(before));
    // (kept again, as it is every time the game says what it carries: the very same)
    assert.deepEqual(copy(cleanInventory(copy(kept), name)), copy(kept));
    const inv = new PlayerInventory();
    assert.deepEqual(inv.load(copy(kept)), []);
    assert.deepEqual(lines(census(copy(inv.serialize()))), lines(after));
  });
}

ok('the hot keys of a character kept from before are on the same things, in a pocket or anywhere; one kept without any gets the guns on 1, 2 and 3', () => {
  const was = old('old-geared.json');
  assert.equal(was.hot!.filter(Boolean).length, 9);
  const inv = new PlayerInventory();
  inv.load(old('old-geared.json'));
  assert.deepEqual(inv.hot, was.hot);
  was.hot!.forEach((b, i) => assert.equal(inv.hotItem(i)?.uid ?? null, b?.uid ?? null, `key ${(i + 1) % 10}`));
  // (the bandages were in the jacket and the stims in the trousers: each is in that thing's pockets now)
  assert.ok(inv.jacket.has(inv.hotItem(3)!) && inv.pants.has(inv.hotItem(4)!));
  // the server let the keys fall until now: one it kept has none, and is given the three its guns go on by themselves
  const bare = new PlayerInventory();
  bare.load(old('old-kept-by-server.json'));
  assert.deepEqual(bare.hot.map((b) => b?.id ?? null), ['ak', 'mosin', 'm9', null, null, null, null, null, null, null]);
});

ok('a save from before the two places on the back and from when a blade had a place of its own is still read: the long gun slung, the blade in a pocket', () => {
  const gun = makeItem('mosin'), blade = makeItem('knife'), tin = makeItem('beans');
  const inv = new PlayerInventory();
  const ancient = { slots: { shoulder: gun, melee: blade }, active: null, containers: [{ id: 'jacket', items: [{ ...tin, x: 2, y: 1, rot: false }] }, { id: 'pants', items: [] }] } as unknown as SerializedInventory;
  const over = inv.load(copy(ancient));
  assert.deepEqual(over, []);
  assert.equal(inv.slots.primary?.uid, gun.uid);
  assert.deepEqual(inv.jacket.items.map((p) => [p.item.uid, p.x, p.y]), [[tin.uid, 2, 1], [blade.uid, 0, 0]]);
  assert.equal(inv.slots.legs?.id, 'field_trousers');
});

ok('a grid that was kept becomes the thing; where none was kept nothing is made, and nobody who had nothing on is dressed by being read', () => {
  // (every inventory the game ever kept had both grids, full or empty: this is what the server's own tests send, and a character who has taken everything off)
  const gun = makeItem('ak'), tin = makeItem('beans');
  const none = { slots: { primary: gun }, active: null, containers: [] } as unknown as SerializedInventory;
  assert.equal(upgradeInventory(none).inv, none);
  const kept = cleanInventory(copy(none), name)!;
  assert.deepEqual([kept.slots.top ?? null, kept.slots.legs ?? null, kept.containers], [null, null, []]);
  assert.deepEqual(body(kept).box.items.map((p) => p.item.id), ['ak'], 'somebody who carried a rifle and nothing else left more than a rifle');
  const inv = new PlayerInventory();
  assert.deepEqual(inv.load(copy(none)), []);
  assert.deepEqual([inv.slots.top, inv.slots.legs, inv.slots.primary?.uid], [null, null, gun.uid]);
  // one grid of the two: that one's thing, and not the other's
  const one = cleanInventory({ slots: {}, active: null, containers: [{ id: 'pants', items: [{ ...tin, x: 3, y: 1, rot: false }] }] }, name)!;
  assert.deepEqual([one.slots.top ?? null, one.slots.legs?.id, one.slots.legs?.cargo?.map((p) => [p.item.uid, p.x, p.y])], [null, 'field_trousers', [[tin.uid, 3, 1]]]);
});

ok('half-way (a jacket grid AND a jacket worn) loses nothing: what is in the stray grid goes where it fits, and the rest is handed back for the ground', () => {
  const inv0 = new PlayerInventory();
  inv0.load(old('old-fresh-kit.json'));
  const base = copy(inv0.serialize());
  // (the new life's jacket: beans at 0,0, the thermos at 1,0, the bandage at 2,0)
  // (the pockets are 5x5 and 5x4 now. The compass at 3,3 still leaves no four-by-three in the jacket; a radio still
  // leaves no room for another in the trousers, but no longer fills them: what comes out of the stray trousers grid
  // is a pair of binoculars, two by two, which the column and the row left there cannot take)
  const free = makeItem('compass'), taken = makeItem('apple'), big = makeItem('radio'), bigger = makeItem('radio'), small = makeItem('binoculars');
  const half = copy(base);
  half.containers.push({ id: 'jacket', items: [{ ...free, x: 3, y: 3, rot: false }, { ...taken, x: 0, y: 0, rot: false }, { ...big, x: 0, y: 0, rot: false }, { ...bigger, x: 0, y: 1, rot: false }] });
  half.containers.push({ id: 'pants', items: [{ ...small, x: 1, y: 1, rot: false }] });
  const before = census(half);
  assert.equal(before.length, census(base).length + 5);

  const up = upgradeInventory(copy(half));
  assert.deepEqual(up.inv.containers.map((c) => c.id), ['tags']);
  assert.deepEqual(up.left.map((it) => it.uid), [bigger.uid], 'what had no room anywhere was not handed back, or something else was');
  // (things have been put into the jacket and the trousers, so each thing is counted by itself: every one of them is there, and is what it was)
  assert.deepEqual(owns(census(up.inv, up.left)), owns(before));
  const at = (uid: string) => {
    for (const s of ['top', 'legs']) for (const p of up.inv.slots[s]!.cargo!) if (p.item.uid === uid) return [s, p.x, p.y];
    return null;
  };
  assert.deepEqual(at(free.uid), ['top', 3, 3], 'a thing whose place was free was moved');
  assert.deepEqual(at(taken.uid), ['top', 3, 0], 'a thing whose place was taken did not go to the first free one');
  assert.deepEqual(at(big.uid), ['legs', 0, 0], 'a thing too big for the jacket did not go into the trousers');
  assert.equal(at(small.uid)?.[0], 'top', 'a thing out of the stray trousers grid, the trousers having no room for it, did not go into the jacket');

  // the game: the one thing with no room comes back for the ground
  const inv = new PlayerInventory();
  const over = inv.load(copy(half));
  assert.deepEqual(over.map((it) => it.uid), [bigger.uid]);
  assert.deepEqual(owns(census(copy(inv.serialize()), over)), owns(before));

  // the server: it has no ground to put it on, and keeps it in a grid of leftovers; the game it is for is handed it
  const kept = cleanInventory(copy(half), name)!;
  assert.deepEqual(kept.containers.map((c) => c.id), ['tags', SPILL]);
  assert.deepEqual(grid(kept, SPILL)!.items.map((it) => it.uid), [bigger.uid]);
  assert.deepEqual(owns(census(kept)), owns(before));
  assert.deepEqual(copy(cleanInventory(copy(kept), name)), copy(kept), 'kept again, the leftovers were lost or doubled');
  const later = new PlayerInventory();
  const handed = later.load(copy(kept));
  assert.deepEqual(handed.map((it) => it.uid), [bigger.uid]);
  assert.deepEqual(owns(census(copy(later.serialize()), handed)), owns(before));
});

ok('half-way with every grid already full: all of the stray things come back for the ground, and none is lost', () => {
  const inv0 = new PlayerInventory();
  inv0.load(old('old-packed-full.json'));
  // (it was kept packed to the last cell of the grids as they were then: every cell they have since is filled as well)
  for (const c of inv0.containers) while (c !== inv0.tags && c.add(makeItem('compass')) === null);
  assert.ok(inv0.containers.every((c) => c.items.reduce((cells, p) => cells + ITEMS[p.item.id].w * ITEMS[p.item.id].h, 0) === c.w * c.h), 'a grid is not full');
  const half = copy(inv0.serialize());
  const strays = [makeItem('bandage', 5), makeMag('mag_m9', 9), makeItem('firstaid'), Object.assign(makeItem('dogtag'), { owner: 'Zed', pid: 'pid-zed', held: 77 })];
  half.containers.push({ id: 'jacket', items: strays.slice(0, 2).map((it, i) => ({ ...it, x: i, y: 0, rot: false })) });
  half.containers.push({ id: 'pants', items: strays.slice(2).map((it, i) => ({ ...it, x: i, y: 9, rot: true })) });
  const before = census(half);
  const inv = new PlayerInventory();
  const over = inv.load(copy(half));
  // (the tag goes into the pouch if there is room there, which in this one there is not: ten are in it)
  assert.deepEqual(over.map((it) => it.uid).sort(), strays.map((it) => it.uid).sort());
  assert.deepEqual(lines(census(copy(inv.serialize()), over)), lines(before));
  const kept = cleanInventory(copy(half), name)!;
  assert.deepEqual(grid(kept, SPILL)!.items.map((it) => it.uid).sort(), strays.map((it) => it.uid).sort());
  assert.deepEqual(lines(census(kept)), lines(before));
});

ok('a grid kept bigger than the pockets are, or with two things on one place: each thing is laid where there is room, or handed back', () => {
  const a = makeItem('beans'), b = makeItem('beans'), c = makeItem('radio'), d = makeItem('radio'), e = makeItem('compass'), f = makeItem('radio');
  const odd = { slots: { primary: null }, active: null, containers: [{ id: 'jacket', items: [{ ...a, x: 0, y: 0, rot: false }, { ...b, x: 0, y: 0, rot: false }, { ...e, x: 7, y: 9, rot: false }, { ...c, x: 0, y: 1, rot: false }, { ...d, x: 0, y: 1, rot: false }, { ...f, x: 0, y: 1, rot: false }] }, { id: 'pants', items: [] }] } as unknown as SerializedInventory;
  const before = census(copy(odd));
  const inv = new PlayerInventory();
  const over = inv.load(copy(odd));
  // (the second tin beside the first and the compass at the first free cell; a radio is four cells by three: the
  // first lies under the tins, where the jacket now has room for one and no more, the second goes into the
  // trousers, which have room for one and no more, and the third comes back for the ground)
  assert.deepEqual(over.map((it) => it.uid), [f.uid]);
  const now = copy(inv.serialize());
  assert.deepEqual(owns(butNewClothes(census(now, over), before)), owns(before));
  assert.deepEqual(now.slots.top!.cargo!.map((p) => [p.item.uid, p.x, p.y]), [[a.uid, 0, 0], [b.uid, 1, 0], [e.uid, 2, 0], [c.uid, 0, 2]]);
  assert.deepEqual(now.slots.legs!.cargo!.map((p) => [p.item.uid, p.x, p.y]), [[d.uid, 0, 0]]);
});

ok('loading keeps what the rules of today would refuse: a bag with things in it stays in the pack it was kept in, and is not put back once it is out', () => {
  const inv = new PlayerInventory();
  inv.load(old('old-geared.json'));
  const pack = inv.cargoOf(inv.slots.back!)!;
  const day = pack.items.find((p) => p.item.id === 'sack_pack')!, bag = pack.items.find((p) => p.item.id === 'black_bag')!;
  assert.deepEqual([day.x, day.y, day.item.cargo!.length], [0, 0, 6]);
  assert.deepEqual([bag.x, bag.y, bag.item.cargo!.length], [3, 0, 4]);
  // out, the day pack does not go back in: not there, not in a pocket, not in the vest
  pack.remove(day.item);
  for (const c of inv.containers) assert.ok(!c.accepts(day.item) && !c.place(day.item, 0, 0, false), `${c.name} took a pack with things in it`);
  assert.match(pack.refusal(day.item)!, /has things in it/);
  // (the black bag is a stash case, and keeps the rule it had: out and in again)
  pack.remove(bag.item);
  assert.ok(pack.place(bag.item, 3, 0, false));
  // and a grid read from a save lays what it is given by room alone
  const pocket = new Container('p', 'Pocket', 4, 4);
  assert.ok(!pocket.accepts(day.item));
  assert.deepEqual(pocket.load({ items: [{ ...copy(day.item), x: 1, y: 1, rot: false }] }), []);
  assert.deepEqual(pocket.items.map((p) => [p.item.uid, p.x, p.y, p.item.cargo!.length]), [[day.item.uid, 1, 1, 6]]);
});

// ------------------------------------------------------------------ what the server makes of what it is told

ok('a thing\'s cargo is read to as many things as it has cells: sixty-three in a rucksack, forty-eight in a stash case (it was forty), and no more than that', () => {
  const full = (id: string, n: number) => {
    const it = makeItem(id), [w] = ITEMS[id].wear?.cargo ?? ITEMS[id].stash!;
    it.cargo = Array.from({ length: n }, (_, k) => ({ item: makeItem('compass'), x: k % w, y: Math.floor(k / w), rot: false }));
    return it;
  };
  for (const [id, cells] of [['suitcase', 63], ['stash_kit', 48], ['camping_pack', 42], ['sack_pack', 25], ['field_jacket', 25], ['field_trousers', 20], ['life_vest', 20], ['old_suitcase', 30], ['black_bag', 20]] as [string, number][]) {
    assert.equal(holds(id)![0] * holds(id)![1], cells, `${id} has ${holds(id)!.join('x')} cells`);
    const it = full(id, cells);
    const clean = cleanItem(copy(it), name)!;
    assert.equal(clean.cargo!.length, cells, `${id} came back with ${clean.cargo!.length} of its ${cells} things`);
    assert.deepEqual(clean.cargo!.map((p) => p.item.uid), it.cargo!.map((p) => p.item.uid));
    // (and one said to hold more than it has cells is cut to its cells: nobody is kept a bag bigger inside than it is)
    assert.equal(cleanItem(copy(full(id, cells + 25)), name)!.cargo!.length, cells);
  }
  // the character packed to the last cell of the grids as they were, as the server keeps it: all forty-two are in the rucksack
  const kept = cleanInventory(old('old-packed-full.json'), name)!;
  assert.deepEqual([kept.slots.back!.cargo!.length, kept.slots.top!.cargo!.length, kept.slots.legs!.cargo!.length, kept.slots.vest!.cargo!.length, grid(kept, 'tags')!.items.length], [42, 16, 12, 12, 10]);
});

ok('things inside things are read three down (it was two), so that nothing kept in a bag in a pack falls out now that pockets are one further in', () => {
  assert.equal(KEPT_DEPTH, 3);
  // a thing (0), in it a thing (1), in that a thing (2), in that a thing (3), and in that one more (4), which is not read
  const chain = ['suitcase', 'camping_pack', 'sack_pack', 'black_bag', 'bandage'].map((id) => makeItem(id));
  for (let i = 0; i + 1 < chain.length; i++) chain[i].cargo = [{ item: chain[i + 1], x: 0, y: 0, rot: false }];
  const depth = (it: ItemInstance | undefined): number => (it ? 1 + depth(it.cargo?.[0]?.item) : 0);
  const clean = cleanItem(copy(chain[0]), name)!;
  assert.equal(depth(clean), 4);
  assert.deepEqual(clean.cargo![0].item.cargo![0].item.cargo![0].item.cargo, []);
  // (what a character of before carried at the bottom: a thing in a bag in the pack)
  const kept = cleanInventory(old('old-geared.json'), name)!;
  const day = kept.slots.back!.cargo!.find((p) => p.item.id === 'sack_pack')!.item;
  assert.equal(day.cargo!.length, 6);
  // The deepest the server kept in a POCKET was a thing (0), a thing in it (1) and a thing in that (2). In the
  // jacket they are 1, 2 and 3: read to two, the last would be gone the first time the game said what it carried.
  const deepest = ['camping_pack', 'sack_pack', 'bandage'].map((id) => makeItem(id));
  for (let i = 0; i + 1 < deepest.length; i++) deepest[i].cargo = [{ item: deepest[i + 1], x: 0, y: 0, rot: false }];
  const pocketed = { slots: {}, active: null, containers: [{ id: 'jacket', items: [{ ...copy(deepest[0]), x: 0, y: 0, rot: false }] }] };
  let up = cleanInventory(copy(pocketed), name)!;
  for (let pass = 0; pass < 3; pass++) {
    assert.equal(depth(up.slots.top!), 4, `pass ${pass}: a thing in a bag in a bag in a pocket was lost on the way into the jacket, or after`);
    assert.equal(up.slots.top!.cargo![0].item.cargo![0].item.cargo![0].item.uid, deepest[2].uid);
    // (through the game and back to the server, as it goes every few seconds of play)
    const inv = new PlayerInventory();
    assert.deepEqual(inv.load(copy(up)), []);
    up = cleanInventory(copy(inv.serialize()), name)!;
  }
});

ok('the hot keys are kept by the server (they were let fall, and were bare after every rejoin), each a thing\'s number and its kind or nothing', () => {
  const was = old('old-geared.json');
  const kept = cleanInventory(old('old-geared.json'), name)!;
  assert.deepEqual(kept.hot, was.hot);
  const inv = new PlayerInventory();
  inv.load(copy(kept));
  was.hot!.forEach((b, i) => assert.equal(inv.hotItem(i)?.uid ?? null, b?.uid ?? null, `key ${(i + 1) % 10}`));
  // what cannot be a key is no key; there are ten of them whatever is sent
  const junk = [{ uid: 'a', id: 'bandage' }, { uid: 'b', id: 'no_such_thing' }, { uid: 7, id: 'stim' }, 'bandage', null, { uid: 'x'.repeat(200), id: 'stim' }, { uid: 'c', id: 'constructor' }, { id: 'stim' }, { uid: 'd', id: 'ak', extra: 1 }, { uid: 'e', id: 'm9' }, { uid: 'f', id: 'colt' }, { uid: 'g', id: 'colt' }];
  const clean = cleanHot(junk);
  assert.equal(clean.length, HOT_KEYS);
  assert.deepEqual(clean, [{ uid: 'a', id: 'bandage' }, null, null, null, null, { uid: 'x'.repeat(64), id: 'stim' }, null, null, { uid: 'd', id: 'ak' }, { uid: 'e', id: 'm9' }]);
  for (const none of [undefined, null, 'keys', 5, {}]) assert.deepEqual(cleanHot(none), Array(HOT_KEYS).fill(null));
  assert.deepEqual(cleanInventory({ slots: {}, containers: [], hot: junk }, name)!.hot, clean);
});

ok('what is no thing is left out of what the server keeps, and what is said of a thing is held to what can be', () => {
  for (const bad of [null, 5, 'ak', {}, { uid: 'u', id: 'nothing', qty: 1 }, { uid: 'u', id: 'constructor', qty: 1 }, { uid: 'u', id: 'toString', qty: 1 }, { id: 'ak', qty: 1 }, { uid: 'u'.repeat(65), id: 'ak', qty: 1 }]) assert.equal(cleanItem(bad, name), null, JSON.stringify(bad));
  const tag = cleanItem({ uid: 't', id: 'dogtag', qty: 9, owner: '<b>Ann</b>', pid: 'p'.repeat(40), holder: 5, held: 1e9, cargo: [{ item: { uid: 'c', id: 'bandage', qty: 1 }, x: 0, y: 0 }] }, name)!;
  assert.deepEqual(tag, { uid: 't', id: 'dogtag', qty: 1, owner: 'bAnnb', pid: 'p'.repeat(24), holder: undefined, held: TAG_HOLD });
  assert.equal(cleanItem({ uid: 'b', id: 'bandage', qty: 99 }, name)!.qty, 5);
  assert.equal(cleanItem({ uid: 'm', id: 'mag_ak', qty: 1, rounds: 500 }, name)!.rounds, 30);
  // a thing in a grid with no place said for it is not kept; nor is a grid of more than a hundred and twenty things read past them
  assert.deepEqual(cleanStored([{ uid: 'a', id: 'bandage', qty: 1, x: 1, y: 2, rot: 1 }, { uid: 'b', id: 'bandage', qty: 1 }, { uid: 'c', id: 'nothing', qty: 1, x: 0, y: 0 }], name), [{ uid: 'a', id: 'bandage', qty: 1, x: 1, y: 2, rot: true }]);
  assert.equal(cleanInventory(null, name), null);
  assert.equal(cleanInventory('inventory', name), null);
  assert.deepEqual(cleanInventory({ slots: { ['x'.repeat(16)]: makeItem('ak'), top: null, legs: null }, containers: 'none' }, name), { slots: { top: null, legs: null }, active: null, containers: [], hot: Array(HOT_KEYS).fill(null) });
});

// ------------------------------------------------------------------ a body

ok('everything a geared character had on lies in the body\'s grid, nothing on the ground; the jacket, the trousers, the vest and the pack are there with what was in them', () => {
  for (const file of FIXTURES) {
    const kept = cleanInventory(old(file), name)!;
    const { box, spill } = body(kept);
    assert.deepEqual(spill.map((it) => it.id), [], `${file}: these were thrown on the ground beside the body`);
    const lying = { slots: {}, active: null, containers: [box.serialize()] } as SerializedInventory;
    assert.deepEqual(lines(census(lying)), lines(census(kept)), `${file}: what lies on the body is not what was carried`);
    // nothing on anything else, nothing over the edge
    const cells = new Set<string>();
    for (const p of box.items) {
      const [pw, ph] = Container.size(p.item, p.rot);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + pw <= box.w && p.y + ph <= box.h, `${file}: ${p.item.id} lies over the edge`);
      for (let y = p.y; y < p.y + ph; y++) for (let x = p.x; x < p.x + pw; x++) assert.ok(!cells.has(`${x},${y}`) && cells.add(`${x},${y}`), `${file}: two things on ${x},${y}`);
    }
  }
  // taking the jacket off the body takes what is in it: it is one thing in the body's grid, and a new owner's top
  const kept = cleanInventory(old('old-geared.json'), name)!;
  const { box } = body(kept);
  const jacket = box.items.find((p) => p.item.id === 'field_jacket')!.item, pack = box.items.find((p) => p.item.id === 'suitcase')!.item;
  assert.equal(jacket.cargo!.length, 8);
  assert.equal(pack.cargo!.length, 8);
  const looter = new PlayerInventory();
  looter.slots.top = null;
  box.remove(jacket);
  assert.equal(looter.add(jacket), null);
  assert.equal(looter.slots.top, jacket);
  assert.deepEqual(looter.jacket.items.map((p) => p.item.id).sort(), kept.slots.top!.cargo!.map((p) => p.item.id).sort());
  assert.ok(!box.items.some((p) => jacket.cargo!.some((q) => q.item === p.item)), 'what was in the jacket was left lying on the body');
  // (and a looter who has a jacket on can open this one where it lies and take from it: it lies in a body's grid)
  const second = body(cleanInventory(old('old-geared.json'), name)!).box;
  const theirs = bagGrid(second.items.find((p) => p.item.id === 'field_jacket')!.item, second.depth + 1)!;
  assert.deepEqual([theirs.w, theirs.h, theirs.items.length], [5, 5, 8]);
  assert.ok(theirs.accepts(makeItem('bandage')));
});

ok('the grid was 8x10, and a geared body laid in it as it was then threw pocket loot and tags on the ground', () => {
  const was = old('old-geared.json');
  const box = new Container('corpse', 'Body', 8, 10, [], true), spill: string[] = [];
  // (as makeCorpse did: each thing worn, then each thing out of each pocket by itself, in that order)
  for (const it of [...Object.values(was.slots), ...was.containers.flatMap((c) => c.items.map((s) => cleanItem(s, name)))]) if (it && box.add(it)) spill.push(it.id);
  // (fourteen things of this character's: the sniper rifle off their back, most of what was in their pockets, the
  // bunker's keycard, and a tag they had taken)
  assert.ok(spill.length >= 10, `only ${spill.length} things were spilled: ${spill.join(', ')}`);
  for (const id of ['mosin', 'keycard', 'dogtag', 'stim']) assert.ok(spill.includes(id), `no ${id} was spilled: ${spill.join(', ')}`);
  // (and the same character today: nothing)
  assert.deepEqual(body(cleanInventory(old('old-geared.json'), name)!).spill, []);
});

ok('every set of things a person can have on at once, with their own tag and a full pouch, lies in a body\'s grid with nothing left over', () => {
  const all = Object.values(ITEMS);
  /** one thing of each shape there is for a place, and the place empty */
  const shapes = (kind: string) => {
    const seen = new Map<string, string>();
    for (const d of all.filter((x) => x.slot === kind)) seen.set(`${d.w}x${d.h}`, d.id);
    return [...seen.values(), null];
  };
  const biggest = (kind: string) => all.filter((d) => d.slot === kind).sort((a, b) => b.w * b.h - a.w * a.h)[0]?.id ?? null;
  const long = shapes('long'), others = GEAR_SLOTS.map((s) => SLOT_KIND[s]);
  /** the places whose things come in more than one shape: every shape of each is tried against every pair of long things */
  const varied = others.filter((k) => shapes(k).length > 2);
  const fixed = ['holster', ...others.filter((k) => !varied.includes(k))];
  let sets = 0, most = 0;
  const lay = (ids: (string | null)[]) => {
    const things = ids.filter((id): id is string => !!id).map((id) => makeItem(id));
    // (their own tag, and ten taken off others)
    for (let k = 0; k < 11; k++) things.push(makeItem('dogtag'));
    const cells = things.reduce((s, it) => s + ITEMS[it.id].w * ITEMS[it.id].h, 0);
    most = Math.max(most, cells);
    sets++;
    const spill = layOnBody(new Container('corpse', 'Body', ...BODY_GRID, [], true), things);
    assert.deepEqual(spill.map((it) => it.id), [], `left over from ${ids.filter(Boolean).join(' + ')} and eleven tags (${cells} cells in ${BODY_GRID[0] * BODY_GRID[1]})`);
  };
  const each = (kinds: string[], picked: (string | null)[], then: (ids: (string | null)[]) => void) => {
    if (!kinds.length) return then(picked);
    for (const id of shapes(kinds[0])) each(kinds.slice(1), [...picked, id], then);
  };
  for (const a of long) for (const b of long) {
    // every shape of what varies, with everything else on
    each(varied, [a, b, ...fixed.map(biggest)], lay);
    // and each of the rest left off in its turn, with the biggest of what varies
    for (const off of fixed) lay([a, b, ...fixed.map((k) => (k === off ? null : biggest(k))), ...varied.map(biggest)]);
  }
  assert.ok(sets > 3000, `only ${sets} sets were laid out`);
  assert.equal(most, 120, 'the most a person can have on is not what it was when the grid was sized: see BODY_GRID');
  assert.ok(BODY_GRID[0] * BODY_GRID[1] >= most);
  // (the server reads no more than 120 things out of a grid it is sent: a body of more cells could hold more single things than are kept)
  assert.ok(BODY_GRID[0] * BODY_GRID[1] <= 120, 'the body has more cells than the server reads things out of a grid: raise that count with it (cleanStored in server/index.ts)');
});

// ------------------------------------------------------------------ the two ends

ok('the game and the server speak version 36: a page from before, which knows nothing of the jacket, is turned away', () => {
  assert.equal(PROTOCOL, 36);
});

console.log(`\n${n} checks passed`);
