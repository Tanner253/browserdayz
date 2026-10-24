// Grid inventory (DayZ / Tarkov style). Items occupy w x h cells and may be rotated.
// What a character can carry comes from what they wear, and from nothing else: the pockets of
// the jacket and the trousers they have on, the pouches of a vest, whatever is on their back.
// Each of those is a thing, and what is in it lives inside it (`cargo`), so it travels with
// the thing when it is taken off, dropped, or left on a body. (2026-10-13: "When i kill someone
// and i loot their body and i pick up their backpack it should bring all the loot with it ...
// it should be the same for all inventories. we should make the jacket and pants the user
// spawns in with (the default inventory slots) clothing items". The jacket and the trousers
// were two grids of the body's own until then: see `upgradeInventory` for what becomes of an
// inventory kept from before.) The one grid a survivor can have that is no thing's and is not
// the tag pouch is an admin's hold, which nobody else ever has: see `Hold`.
//
// What goes into what is DayZ's rule (see `accepts`): a thing with something in it is worn,
// held, put on the ground or laid in a body, a crate or a stash, and is never put inside
// another thing that is worn or carried; and things are put into a thing only while it is
// worn or lies in a body, a crate or a stash, never while it is itself in a pocket or a pack.
//
// Dog tags have places of their own. A survivor's own tag hangs round their neck: it is not
// in a pocket, cannot be moved or dropped, and is on the body when they die. Tags taken off
// other people go in a pouch of ten, so they do not fill the pockets; an eleventh goes
// wherever there is room.

import { ALL_SLOTS, CLOTHES, GEAR_SLOTS, ITEMS, SLOT_KIND, TAG_HOLD, WEAPON_SLOTS, holds, isBagKind, itemWeight, magFits, makeItem, sanitizeItem, type ItemInstance, type Placed, type Slot } from './items';

const EMPTY_SLOTS = (): Record<Slot, ItemInstance | null> => Object.fromEntries(['held', ...ALL_SLOTS].map((s) => [s, null])) as Record<Slot, ItemInstance | null>;
/** the places whose things are looked into for room, in the order they are filled: jacket and trousers first, as ever, then the rest of what is worn */
/** the two places on the back, whose things keys 1 and 2 bring up (`PlayerInventory.backItem`) */
const BACK: Slot[] = ['primary', 'secondary'];
const POCKET_ORDER: Slot[] = [...new Set<Slot>([...CLOTHES.map(([slot]) => slot), ...GEAR_SLOTS])];
/** the body's own places for weapons, in the order of the keys they are first put on: the two on the back, and the holster */
export const SLOT_ORDER: Slot[] = WEAPON_SLOTS;

/**
 * Hot keys: ten of them (1 to 9, and 0), each bound to a thing and not to a place. Anything carried can be put on
 * any of them, and pressing it takes that thing into the hands. A key remembers the very thing it was given (by
 * the thing's own number) and, when that is gone, another of its kind: the key a bandage was on is the key the
 * next bandage is on.
 */
export const HOT_KEYS = 10;
export interface HotBind {
  uid: string;
  id: string;
}

export type { Placed };

/** A pile gone into another of its kind (topped up into it, combined, let go on it): its hot key goes with it (`forgetGone`). */
export const poured = new WeakMap<ItemInstance, ItemInstance>();

export class Container {
  /**
   * @param items backing array (a bag's own `cargo`), so the container is a live view of the item
   * @param holdsBags world containers (crates, stashes, bodies) accept bags that still have things in them
   */
  constructor(public id: string, public name: string, public w: number, public h: number, public items: Placed[] = [], public holdsBags = false) {}

  /**
   * How far down this grid is: 0 for a crate, a body, a stash on the ground, the tag pouch; 1 for the inside of a
   * thing that is worn, or that lies in one of those; 2 for the inside of a thing that lies in such a thing (a bag
   * in a pack, a pack in a pack on a body). What a grid takes goes by this: see `accepts`.
   */
  depth = 0;

  /** the one kind of item this is for (null: anything) */
  only: string | null = null;

  /** the thing this grid is the inside of, by its item (a pack, a vest, a jacket, a stash case); null for a grid that is no thing's: the tag pouch, a crate, a body, a stash on the ground */
  of: string | null = null;
  /** that thing itself, where the grid is the inside of something worn (what it is set for is on it: `for`) */
  bag: ItemInstance | null = null;

  static size(item: ItemInstance, rot: boolean): [number, number] {
    const d = ITEMS[item.id];
    return rot ? [d.h, d.w] : [d.w, d.h];
  }

  /**
   * What is taken here at all, wherever in the grid it would lie. A thing can't go inside itself, nor inside a
   * thing that is inside it. Then, as DayZ's own script has it (2026-10-13, asked: "like dayz"):
   *
   * - Things are put INTO a thing only while it is worn, or lies in a body, a crate or a stash. The inside of one
   *   that is itself in a pocket or a pack (`depth` 2) is looked into and taken from, and takes nothing.
   * - A thing with something in it (a pack, a vest, a jacket, trousers) is put in its own place on the body, on the
   *   ground, or in the grid of a body, a crate or a stash, and nowhere else: not in a pocket, not in a vest, not
   *   in another pack. Empty, it goes anywhere it has room.
   *
   * Stash cases, suitcases and black bags keep the rule they had: one with things in it goes into a pack that is
   * worn or lies in a crate, so long as nothing in it has things in it; and into a case that lies in a pack, single
   * things are still put.
   *
   * These are the rules of MOVING a thing. What a save says lay somewhere is laid there by `restore`, which asks
   * only whether there is room: nobody's packed bag is put out of the pack it was kept in.
   */
  accepts(item: ItemInstance): boolean {
    return !this.refusal(item);
  }

  /** dog tags may lie here though it is not the pouch for them: a body (see `refusal`) */
  tagsHere = false;

  /**
   * Why a thing is not taken here, in words that can be said to the player; null when it is. (Whether there is
   * room for it is another question: `free`, `findSpace`.)
   */
  refusal(item: ItemInstance): string | null {
    // (the words are made only when there is something to say: this is asked for every cell a thing is dragged over)
    const what = () => (ITEMS[item.id]?.name ?? 'thing').toLowerCase(), here = () => this.name.toLowerCase();
    if (this.only && item.id !== this.only) return `Only a ${(ITEMS[this.only]?.name ?? this.only).toLowerCase()} goes in the ${here()}`;
    // (a dog tag is carried in the pouch for them or lies on a body, and is put away nowhere else: the owner, 2026-10-17,
    // "dogtags should not be stashed in inventory")
    if (item.id === 'dogtag' && this.only !== 'dogtag' && !this.tagsHere) return 'A dog tag goes in your dog tag pouch, and nowhere else';
    if (this.id === `gear:${item.uid}` || this.id === `bag:${item.uid}`) return `The ${what()} does not go inside itself`;
    const within = (it: ItemInstance): boolean => !!it.cargo && (it.cargo === this.items || it.cargo.some((p) => within(p.item)));
    if (within(item)) return `The ${here()} is inside the ${what()}`;
    const ofCase = !!this.of && !!ITEMS[this.of]?.stash;
    if (this.depth >= 2 && !ofCase) return `Take the ${here()} out of what it is in first: nothing is put into it while it is in a pocket or a pack`;
    if (!item.cargo?.length) return null;
    if (ofCase || ITEMS[item.id]?.stash) {
      // (as it was before 2026-10-13, to the letter: stash cases keep the rule they had)
      if (!this.holdsBags || this.depth >= 2) return `The ${what()} has things in it: it does not go in the ${here()}`;
      if (this.depth >= 1 && item.cargo.some((p) => p.item.cargo?.length)) return `The ${what()} has things in it that have things in them: it does not go in the ${here()}`;
      return null;
    }
    if (!this.holdsBags || this.depth > 0) return `The ${what()} has things in it: empty it first, or wear it, or put it on the ground. It does not go in the ${here()}`;
    return null;
  }

  /**
   * May this thing be let go ON a thing that lies here, to go into it: more onto a pile, rounds into a magazine,
   * a part onto a gun? As putting it here would be allowed; and within one grid always, where nothing comes in.
   */
  joinable(item: ItemInstance, from: Container | null): boolean {
    return from === this || this.accepts(item);
  }

  /** how many rows down a thing may lie here: the grid's height (but for a grid that has no bottom: see `Hold`) */
  protected get deep(): number {
    return this.h;
  }

  /** Is this very place free for it: inside the grid, and on nothing that lies there? (Whether it is taken here at all is `accepts`.) */
  free(item: ItemInstance, x: number, y: number, rot: boolean, ignore?: ItemInstance): boolean {
    const [w, h] = Container.size(item, rot);
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.deep) return false;
    for (const p of this.items) {
      if (p.item === ignore) continue;
      const [pw, ph] = Container.size(p.item, p.rot);
      if (x < p.x + pw && x + w > p.x && y < p.y + ph && y + h > p.y) return false;
    }
    return true;
  }

  fits(item: ItemInstance, x: number, y: number, rot: boolean, ignore?: ItemInstance): boolean {
    return this.accepts(item) && this.free(item, x, y, rot, ignore);
  }

  /** the first free place for it, upright before on its side, by room alone */
  protected anywhere(item: ItemInstance): { x: number; y: number; rot: boolean } | null {
    for (const rot of [false, true]) {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.free(item, x, y, rot)) return { x, y, rot };
        }
      }
    }
    return null;
  }

  findSpace(item: ItemInstance): { x: number; y: number; rot: boolean } | null {
    return this.accepts(item) ? this.anywhere(item) : null;
  }

  /** room for the item either as a new entry or merged into a stack */
  hasRoom(item: ItemInstance): boolean {
    if (!this.accepts(item)) return false;
    const def = ITEMS[item.id];
    if (def.stack && this.items.some((p) => p.item.id === item.id && p.item.qty < def.stack!)) return true;
    return !!this.anywhere(item);
  }

  place(item: ItemInstance, x: number, y: number, rot: boolean): boolean {
    if (!this.fits(item, x, y, rot)) return false;
    this.items.push({ item, x, y, rot });
    return true;
  }

  /**
   * A thing laid where a save says it lay, or failing that wherever there is room for it. Only room is asked,
   * never `accepts`: what was kept under older rules of what goes into what is kept as it was.
   * @returns whether it was laid (false: there is no room for it here at all)
   */
  restore(item: ItemInstance, x: number, y: number, rot: boolean): boolean {
    if (this.only && item.id !== this.only) return false;
    const spot = Number.isInteger(x) && Number.isInteger(y) && this.free(item, x, y, !!rot) ? { x, y, rot: !!rot } : this.anywhere(item);
    if (!spot) return false;
    this.items.push({ item, ...spot });
    return true;
  }

  /** a pile put onto the piles of its kind already here, as far as they have room: true if none of it is left */
  topUp(item: ItemInstance): boolean {
    const cap = ITEMS[item.id].stack;
    if (!cap || !this.accepts(item)) return false;
    for (const p of this.items) {
      if (p.item.id !== item.id || p.item === item || p.item.qty >= cap) continue;
      const move = Math.min(cap - p.item.qty, item.qty);
      p.item.qty += move;
      item.qty -= move;
      if (item.qty <= 0) {
        poured.set(item, p.item);
        return true;
      }
    }
    return false;
  }

  /** Merges into existing stacks first, then finds free space. Returns what is left of it, or null. */
  add(item: ItemInstance): ItemInstance | null {
    if (!this.accepts(item)) return item;
    if (this.topUp(item)) return null;
    const spot = this.findSpace(item);
    if (!spot) return item;
    this.items.push({ item, ...spot });
    return null;
  }

  remove(item: ItemInstance) {
    const i = this.items.findIndex((p) => p.item === item);
    if (i >= 0) this.items.splice(i, 1);
  }

  has(item: ItemInstance) {
    return this.items.some((p) => p.item === item);
  }

  count(id: string) {
    return this.items.reduce((s, p) => s + (p.item.id === id ? p.item.qty : 0), 0);
  }

  /** consumes up to n of a stackable id; returns how many were taken */
  take(id: string, n: number): number {
    let taken = 0;
    for (const p of [...this.items]) {
      if (p.item.id !== id || taken >= n) continue;
      const k = Math.min(p.item.qty, n - taken);
      p.item.qty -= k;
      taken += k;
      if (p.item.qty <= 0) this.remove(p.item);
    }
    return taken;
  }

  serialize() {
    return { id: this.id, items: this.items.map((p) => ({ ...p.item, x: p.x, y: p.y, rot: p.rot })) };
  }

  /**
   * Replaces the contents. Returns whatever no longer fits (a smaller grid than when it was saved). Each thing is
   * laid where it was kept, by room alone (see `restore`): a save is not held to the rules a move is.
   */
  load(data: { items: Stored[] }): ItemInstance[] {
    this.items.length = 0;
    const overflow: ItemInstance[] = [];
    for (const d of data.items ?? []) {
      const { x, y, rot, ...raw } = d;
      const item = sanitizeItem(raw);
      if (item && !this.restore(item, x, y, rot)) overflow.push(item);
    }
    return overflow;
  }
}

/** a thing and where it lies in a grid, as grids are kept and sent */
type Stored = ItemInstance & { x: number; y: number; rot: boolean };

// ------------------------------------------------------------------ an admin's hold
//
// 2026-10-13: "admins need an infinite inventory option". An admin with the power on (`bottomless` in
// src/sim/powers.ts; who may have it is the server's to say) has one more grid than what they wear brings: a hold,
// which is no thing's, has no bottom, and so always has room. It is the last place looked into for room, after
// everything that is worn, so pockets fill as they always did and only what they cannot take goes into it.
//
// Why a grid of its own, and not a worn thing with a very deep inside or pockets that stretch. Everything that
// puts a thing away (a pick-up, a kit, a gift, a drag, a magazine taken out of a gun) asks `PlayerInventory.add`
// or `hasRoom`, and both go through `containers`: one more grid there and all of them have the room, with not one
// of them changed. Nothing that is worn is touched, so nothing of an ordinary inventory can go wrong by it, and a
// body, a crate and a pack are what they were. And it is kept and sent as one more grid beside the tag pouch,
// which every game and every server already carries without knowing what it is: one that has never heard of a
// hold hands what is in it to its player as things that found no room, and loses none of them.

/** the name the hold is kept and sent by */
export const HOLD = 'hold';
/** how many cells across it is: wider than the widest thing there is, so everything lies in it the way up it is made */
export const HOLD_W = 10;
/** the empty rows always under the last thing in it: as many as the longest thing is long, so anything is let go there either way up */
const HOLD_SPARE = Math.max(...Object.values(ITEMS).map((d) => Math.max(d.w, d.h)));
/**
 * The most things it takes, counting what is in them. Not for want of room: what is carried is said to the server
 * in one message, and the server reads no message of more than 256 KB (eight hundred rifles with every part fitted
 * are about 150: test/inventory.test.ts counts them). Past this, a thing is refused as any full grid refuses it, and
 * lies where it lay.
 */
export const HOLD_MOST = 800;
/** how far down a thing may be said to lie in it (a save that says a thing lies a million rows down is not believed: it is laid where there is room) */
const HOLD_DEEP = HOLD_MOST * HOLD_SPARE;

/** a thing, and everything in it, counted */
const counted = (it: ItemInstance): number => 1 + (it.cargo ?? []).reduce((n, p) => n + counted(p.item), 0);

/**
 * An admin's hold: a grid ten across with no bottom. It is as tall as what lies in it and a few rows more, so there
 * is always a free place, and the screen draws all of it. It takes anything while it is `open`, a pack with things
 * in it too (as a crate does), and what lies in it is opened and taken from where it lies, and takes nothing (it is
 * one grid down, as the inside of a thing that is worn). Shut, it gives up what it has and takes nothing.
 */
export class Hold extends Container {
  /** things are put in: the admin's power is on (see `PlayerInventory.bottomless`) */
  open = false;

  constructor() {
    super(HOLD, 'Hold', HOLD_W, HOLD_SPARE, [], true);
    this.depth = 1;
    // (its height is worked out from what lies in it, whenever it is asked: nothing that moves a thing has to remember to)
    Object.defineProperty(this, 'h', { get: () => this.used() + HOLD_SPARE, set: () => undefined, enumerable: true, configurable: true });
  }

  protected override get deep(): number {
    return HOLD_DEEP;
  }

  /** the rows that have something in them, counted from the top */
  used(): number {
    let rows = 0;
    for (const p of this.items) rows = Math.max(rows, p.y + Container.size(p.item, p.rot)[1]);
    return rows;
  }

  /** how many things are in it, with what is in them */
  holding(): number {
    return this.items.reduce((n, p) => n + counted(p.item), 0);
  }

  override refusal(item: ItemInstance): string | null {
    // (a thing that lies in it already is moved about in it whatever else is so)
    if (this.has(item)) return null;
    if (!this.open) return 'Nothing more goes into the hold: it is an admin’s, and the power is off';
    if (this.holding() + counted(item) > HOLD_MOST) return `The hold has ${HOLD_MOST} things in it, and takes no more: that is as many as the server is told of`;
    return null;
  }

  /**
   * The first free place, as any grid's is found, on a map of the cells that are taken. (Asked of every thing that
   * lies there for every cell, as a pocket is, a hold of some hundreds of things took a second to take one more.)
   */
  protected override anywhere(item: ItemInstance): { x: number; y: number; rot: boolean } | null {
    const rows = this.h, W = this.w, taken = new Uint8Array(rows * W);
    for (const p of this.items) {
      const [pw, ph] = Container.size(p.item, p.rot);
      for (let y = Math.max(0, p.y); y < Math.min(rows, p.y + ph); y++) taken.fill(1, y * W + Math.max(0, p.x), y * W + Math.min(W, p.x + pw));
    }
    for (const rot of [false, true]) {
      const [w, h] = Container.size(item, rot);
      for (let y = 0; y + h <= rows; y++) {
        next: for (let x = 0; x + w <= W; x++) {
          for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (taken[(y + dy) * W + x + dx]) continue next;
          return { x, y, rot };
        }
      }
    }
    return null;
  }
}

/** the things in the hold of an inventory as it is kept and sent (none: it has no hold, or an empty one) */
export function heldIn(inv: SerializedInventory | null | undefined): ItemInstance[] {
  return inv?.containers?.find((c) => c.id === HOLD)?.items ?? [];
}

/**
 * Nobody without the power puts a thing in a hold: the server's rule, for what a game says it carries. Of what the
 * game says lies in its hold, only what the server already had there is kept; what it did not is left out of the
 * server's copy, and an empty hold is no grid at all. So a hold with the power off only ever gets emptier (an
 * admin's own, in the moments before the server knows them for one, loses nothing by this), and a game that makes
 * one up has nothing kept in it.
 * @param now what the game has just said it carries, made safe (changed in place)  @param before what the server had until then
 * @returns how many things were left out
 */
export function holdOnlyEmpties(now: SerializedInventory, before: SerializedInventory | null): number {
  const i = now.containers.findIndex((c) => c.id === HOLD);
  if (i < 0) return 0;
  const was = new Set(heldIn(before).map((it) => it.uid)), said = now.containers[i].items;
  const kept = said.filter((it) => was.has(it.uid));
  if (kept.length) now.containers[i].items = kept;
  else now.containers.splice(i, 1);
  return said.length - kept.length;
}

/**
 * The inside of a thing that is looked into where it lies and is not worn (what is worn: `PlayerInventory.cargoOf`):
 * a pack on a body or in a crate, a bag in a pack, a stash case that is carried. Null for a thing nothing is kept in.
 * @param depth how far down the grid is (see `Container.depth`): one more than the grid the thing lies in
 */
export function bagGrid(item: ItemInstance, depth = 1): Container | null {
  const d = ITEMS[item.id], room = holds(item.id);
  if (!room) return null;
  // (a stash carried is opened where it lies as a bag is, and takes what a stash takes)
  return Object.assign(new Container(`bag:${item.uid}`, d.name, room[0], room[1], (item.cargo ??= []), d.slot === 'back' || !!d.stash), { depth, of: item.id });
}

/**
 * What is carried, as it is kept and sent. `containers` holds the tag pouch (`tags`) and nothing else of the
 * survivor's own: the pockets are inside the jacket and the trousers in `slots.top` and `slots.legs`. (From before
 * 2026-10-13 it held `jacket` and `pants` as well: see `upgradeInventory`. And `spill`, when the server found no
 * room for something while making an old one new: whoever it is for is given those at their feet.)
 */
export type SerializedInventory = { slots: Record<string, ItemInstance | null>; containers: ReturnType<Container['serialize']>[]; hot?: (HotBind | null)[] };

/**
 * Two things change places: `item`, out of `from` (null: it lies on the ground, or is in the hands and carried
 * nowhere), goes into `into` where `other` lies, and `other` goes where `item` lay (with no `from`, it is handed
 * back to be put down). `item` is tried first at the very cell it was let go on, then where `other` lay, either way
 * up; `other` where `item` lay, either way up, and failing that anywhere in that grid. Nothing is moved unless
 * both have a place.
 * @returns whether they changed places
 */
export function swapPlaces(item: ItemInstance, from: Container | null, into: Container, other: ItemInstance, at: { x: number; y: number; rot: boolean }): boolean {
  if (item === other || !into.accepts(item) || (from && !from.accepts(other))) return false;
  const theirs = into.items.find((p) => p.item === other), mine = from?.items.find((p) => p.item === item) ?? null;
  if (!theirs || (from && !mine)) return false;
  const keptInto = [...into.items], keptFrom = from ? [...from.items] : null;
  const back = () => {
    into.items.splice(0, into.items.length, ...keptInto);
    if (from && keptFrom && from !== into) from.items.splice(0, from.items.length, ...keptFrom);
    return false;
  };
  into.remove(other);
  from?.remove(item);
  const put = (c: Container, it: ItemInstance, spots: [number, number, boolean][]) => spots.some(([x, y, rot]) => c.place(it, x, y, rot));
  if (!put(into, item, [[at.x, at.y, at.rot], [theirs.x, theirs.y, at.rot], [theirs.x, theirs.y, !at.rot]])) return back();
  if (from && mine) {
    if (!put(from, other, [[mine.x, mine.y, theirs.rot], [mine.x, mine.y, !theirs.rot]])) {
      const spot = from.findSpace(other);
      if (!spot || !from.place(other, spot.x, spot.y, spot.rot)) return back();
    }
  }
  return true;
}

/**
 * A pile is halved: the smaller half is made a pile of its own (a new thing, with its own number) and laid in the
 * same grid, as near the first as there is room. Null: it is not a pile of two or more, or there is no room.
 */
export function splitPile(c: Container, item: ItemInstance, make: (id: string, qty: number) => ItemInstance): ItemInstance | null {
  const def = ITEMS[item.id], placed = c.items.find((p) => p.item === item);
  if (!def.stack || !placed || item.qty < 2) return null;
  const half = make(item.id, Math.floor(item.qty / 2));
  // (whether the grid takes such a thing at all is asked once, and not of every cell: it does not turn on where)
  if (!c.accepts(half)) return null;
  let best: { x: number; y: number; rot: boolean } | null = null, bd = Infinity;
  const rows = c.h;
  for (const rot of [placed.rot, !placed.rot]) {
    const [w, h] = Container.size(half, rot);
    for (let y = 0; y <= rows - h; y++) {
      for (let x = 0; x <= c.w - w; x++) {
        const d = Math.hypot(x - placed.x, y - placed.y);
        if (d < bd && c.free(half, x, y, rot)) {
          bd = d;
          best = { x, y, rot };
        }
      }
    }
  }
  if (!best) return null;
  item.qty -= half.qty;
  c.items.push({ item: half, ...best });
  return half;
}

/** Everything the player carries. */
export class PlayerInventory {
  slots: Record<Slot, ItemInstance | null> = EMPTY_SLOTS();
  /**
   * The pockets of the jacket that is on, and of the trousers. (They were grids of the body's own, by these names,
   * until 2026-10-13: they are the insides of the things in `top` and `legs` now, and with nothing worn there they
   * are no room at all.)
   */
  get jacket(): Container {
    return this.pocketsOf('top');
  }
  get pants(): Container {
    return this.pocketsOf('legs');
  }
  private pocketsOf(slot: Slot): Container {
    const it = this.slots[slot];
    return (it && this.cargoOf(it)) || new Container('none', 'No pockets', 0, 0);
  }
  /** A survivor begins dressed: see `clear`. */
  constructor() {
    this.dress();
  }
  /** the pouch: ten places for dog tags taken off other people, and for nothing else */
  tags = Object.assign(new Container('tags', 'Dog tags', 5, 2), { only: 'dogtag' });
  /**
   * An admin's hold (see `Hold`): empty and shut for everybody else, and then it is no grid at all (`containers`).
   * It is the game's to open, on the server's word that the power is on.
   */
  theHold = new Hold();
  /** the admin's power is on: whatever finds no room in what is worn goes into the hold, which always has some */
  get bottomless(): boolean {
    return this.theHold.open;
  }
  set bottomless(on: boolean) {
    this.theHold.open = on;
  }
  /**
   * The power is put off: the hold takes nothing more, and everything in it that finds a place on the body or room
   * in what is worn is put there. What does not stays in it, for the caller to put at the survivor's feet (a few at
   * a time: see `emptyHold` in src/game/game.ts). Nothing is let go of here.
   * @returns how many things are still in it
   */
  shutHold(): number {
    this.theHold.open = false;
    for (const p of [...this.theHold.items]) {
      this.theHold.remove(p.item);
      // (what is left of a pile that went in part into a pocket, or the thing as it was, goes back where it lay)
      if (this.add(p.item)) this.theHold.items.push(p);
    }
    return this.theHold.items.length;
  }
  /** the survivor's own dog tag, round their neck */
  neck: ItemInstance | null = null;
  /**
   * When the survivor's own tag is put round their neck (Date.now()): only once they have been alive TAG_FRESH since
   * they came in or came back (the owner, 2026-10-17: "a player should not have a dogtag object in their inventory
   * until theyve been alive long enough"). Nought: not waiting.
   */
  neckDue = 0;
  /** what each hot key is bound to */
  hot: (HotBind | null)[] = Array.from({ length: HOT_KEYS }, () => null);
  /** each bound thing as last seen on this body, to follow it into the pile it was poured into (`forgetGone`) */
  private boundSeen = new Map<string, ItemInstance>();
  /** the kinds a key has been given by itself in this life (`Game.autoHot`), each once: a kind whose thing left is not put back on a key when more of it comes */
  autoGiven = new Set<string>();

  /** What is in the hands. */
  held(): ItemInstance | null {
    return this.slots.held;
  }

  /**
   * A thing is taken into the hands (null: they are emptied), out of wherever it was carried, which is room again,
   * or from outside (the ground, a crate: the caller's to have taken it from there). What was in them is put away
   * first (`putAway`), into the place the new thing leaves if that is its own: a third long gun in the hands and two
   * on the back change places, as in DayZ. With no room for it the hands are not changed (the owner, 2026-10-24:
   * "must put one on the ground to free up hands if no room").
   * @param dry only asked: would it be so? Nothing is moved.
   * @returns whether the hands now hold `item`
   */
  hold(item: ItemInstance | null, dry = false): boolean {
    const was = this.slots.held;
    if (item === was) return true;
    if (!item) return dry ? this.canPutAway() : this.putAway();
    // (where it lies, to be laid back there, just where it was, if what is in the hands finds no room)
    const slot = ALL_SLOTS.find((s) => this.slots[s] === item), c = slot ? null : this.containerOf(item), i = c ? c.items.findIndex((p) => p.item === item) : -1, at = c?.items[i];
    this.remove(item);
    const room = !was || this.hasRoom(was);
    if (!room || dry) {
      if (slot) this.slots[slot] = item;
      else if (c && at) c.items.splice(i, 0, at);
      return room;
    }
    if (was) this.putAway();
    this.slots.held = item;
    this.came = slot === 'primary' || slot === 'secondary' ? { slot, item } : null;
    this.syncBack();
    return true;
  }

  /** the place on the back the thing in the hands was taken from (see `home`) */
  private came: { slot: Slot; item: ItemInstance } | null = null;

  /**
   * The place on the back a long thing in the hands goes back to: the one it came out of, if that is free still, else
   * the first free one (null: none, or nothing long in the hands). Its key is that place's (`backItem`).
   */
  private home(): Slot | null {
    const h = this.slots.held;
    if (!h || ITEMS[h.id].slot !== 'long') return null;
    if (this.came?.item === h && !this.slots[this.came.slot]) return this.came.slot;
    return BACK.find((s) => !this.slots[s]) ?? null;
  }

  /**
   * What key 1 (0) or key 2 (1) brings up: the long thing on that place on the back, or the one in the hands that goes
   * back to it. Those two keys are the back's, whatever is moved in or out (the owner, 2026-10-24: "the 1 and 2 hotkey
   * slots should always be paired to the back slots no matter what").
   */
  backItem(i: number): ItemInstance | null {
    const s = BACK[i];
    return s ? (this.slots[s] ?? (this.home() === s ? this.slots.held : null)) : null;
  }

  /**
   * Keys 1 and 2 said as the back has them; and whatever is on the back (or came off it into the hands) is on no other
   * key, so that a gun put from the back into a bag is on none at all (the owner: "if i stow something from my back to
   * my bag then it should be removed from the hotbar").
   */
  private syncBack() {
    const back = BACK.map((_, i) => this.backItem(i));
    this.hot = this.hot.map((b, i) => {
      if (i < BACK.length) return back[i] ? { uid: back[i]!.uid, id: back[i]!.id } : null;
      return b && back.some((it) => it?.uid === b.uid) ? null : b;
    });
  }

  /** What is in the hands goes into its own free place (the back, the holster), onto its own kind, or into any room (`add`): false, and it stays there, if there is none. */
  putAway(): boolean {
    const it = this.slots.held;
    if (!it) return true;
    if (!this.hasRoom(it)) return false;
    // (a long thing to the place on the back it came from, if that is free still: it keeps its key)
    const home = this.home();
    this.slots.held = null;
    if (home) {
      this.slots[home] = it;
      return true;
    }
    // (room said, but a pile that was poured in part: what is left of it stays in the hands)
    const left = this.add(it);
    this.slots.held = left;
    return !left;
  }

  /**
   * What the wheel and a thumb go round, one after another, whichever of them is held: what is on the back and in the
   * holster and a gun or a thing to hit with in the hands, in the order of their hot keys (1 and 2 the back's, 3 the
   * holster's as `autoBind` gives it), and any on no key after those, the hands' last.
   */
  ring(): ItemInstance[] {
    const h = this.slots.held, armed = h && (ITEMS[h.id].weapon || ITEMS[h.id].melee) ? h : null;
    const all = [...WEAPON_SLOTS.map((s) => this.slots[s]), armed].filter((it): it is ItemInstance => !!it);
    const rank = (it: ItemInstance) => (this.hotOf(it) >= 0 ? this.hotOf(it) : HOT_KEYS + all.indexOf(it));
    return all.sort((a, b) => rank(a) - rank(b));
  }

  /** could what is in the hands be put away now? */
  canPutAway(): boolean {
    const it = this.slots.held;
    return !it || this.hasRoom(it);
  }

  /** every thing carried that a hand could take up: what is in them, on the back and in the holster, in the pockets, and in what is worn */
  *carried(): Generator<ItemInstance> {
    if (this.slots.held) yield this.slots.held;
    for (const s of WEAPON_SLOTS) if (this.slots[s]) yield this.slots[s]!;
    for (const c of this.containers) if (c !== this.tags) for (const p of c.items) yield p.item;
  }

  /** The thing a hot key brings up: 1 and 2 the back's (`backItem`), the rest the very one each was given (null: it is not carried where it can be taken up). */
  hotItem(i: number): ItemInstance | null {
    if (i < BACK.length) return this.backItem(i);
    const b = this.hot[i];
    if (!b) return null;
    for (const it of this.carried()) if (it.uid === b.uid) return it;
    return null;
  }

  /** Put a thing on a hot key (it comes off any other it was on), or clear the key. Not 1 or 2, which are the back's, nor for what is on the back: it has its key there. */
  bind(i: number, item: ItemInstance | null) {
    if (i < BACK.length || i >= HOT_KEYS || (item && BACK.some((_, k) => this.backItem(k) === item))) return;
    if (item) this.hot = this.hot.map((b) => (b && b.uid === item.uid ? null : b));
    this.hot[i] = item ? { uid: item.uid, id: item.id } : null;
    if (item) this.boundSeen.set(item.uid, item);
  }

  /** the hot key this thing is on (-1: none) */
  hotOf(item: ItemInstance): number {
    const back = BACK.findIndex((_, i) => this.backItem(i) === item);
    return back >= 0 ? back : this.hot.findIndex((b, i) => i >= BACK.length && b?.uid === item.uid);
  }

  /**
   * Every hot key whose thing has left this body is made bare (the owner, 2026-10-23: "when i drop an item my hotbar
   * should forget about it"): dropped, thrown, put in a crate, a stash or on a body, traded, used up, loaded into a
   * gun, taken by an admin. A key holds the thing, not its kind (DayZ's way), so no other of the kind takes its
   * place. Only a pile poured into another pile still carried takes its key on with it.
   */
  forgetGone() {
    this.syncBack();
    const on = this.everything(), taken = new Set<string>();
    this.hot = this.hot.map((b, i) => {
      if (i < BACK.length || !b || on.has(b.uid)) return b;
      let o = this.boundSeen.get(b.uid);
      while (o && !on.has(o.uid)) o = poured.get(o);
      if (!o || on.get(o.uid) !== o || this.hotOf(o) >= 0 || taken.has(o.uid)) return null;
      taken.add(o.uid);
      return { uid: o.uid, id: o.id };
    });
    this.boundSeen = new Map(this.hot.flatMap((b) => (b && on.has(b.uid) ? [[b.uid, on.get(b.uid)!] as const] : [])));
  }

  /** everything on this body by its number: what is worn, slung and round the neck, and what is in every grid and bag */
  everything(): Map<string, ItemInstance> {
    return allIn([...Object.values(this.slots), this.neck, ...this.containers.flatMap((c) => c.items.map((p) => p.item))]);
  }

  /**
   * Keys 1 and 2 as the back has them (`syncBack`), and what goes into the holster takes key 3 if that is free and the
   * thing is on no key. (Key 3 can be given to something else afterwards.)
   */
  autoBind() {
    this.syncBack();
    const it = this.slots.holster;
    if (it && this.hotOf(it) < 0 && !this.hotItem(2)) this.bind(2, it);
  }
  private gearCargo = new Map<string, Container>();

  /** cargo grid of a worn item (a live view of the item's own contents) */
  cargoOf(item: ItemInstance): Container | null {
    const d = ITEMS[item.id];
    if (!d.wear?.cargo) return null;
    item.cargo ??= [];
    let c = this.gearCargo.get(item.uid);
    if (!c || c.items !== item.cargo) {
      // (what is worn on the back takes a stash case with things in it, as it did; nothing worn takes a pack, a vest or a jacket that has: see `accepts`)
      c = Object.assign(new Container(`gear:${item.uid}`, d.name, d.wear.cargo[0], d.wear.cargo[1], item.cargo, d.slot === 'back'), { depth: 1, of: item.id, bag: item });
      this.gearCargo.set(item.uid, c);
    }
    return c;
  }

  /** every grid the player can put things in right now: the tag pouch (which takes only tags), the pockets of jacket and trousers, then vest and bag; and last, an admin's hold while it is open or has anything in it */
  get containers(): Container[] {
    const out: Container[] = [this.tags];
    for (const s of POCKET_ORDER) {
      const it = this.slots[s];
      const c = it ? this.cargoOf(it) : null;
      if (c) out.push(c);
    }
    if (this.theHold.open || this.theHold.items.length) out.push(this.theHold);
    return out;
  }

  /**
   * Everything carried goes, and the survivor stands in a new jacket and new trousers with nothing in them: what a
   * body had by itself when its pockets were its own, and what every new life starts in (2026-10-13). Whoever is
   * given a kit by an admin, which "replaces everything", is left the same.
   */
  clear() {
    this.slots = EMPTY_SLOTS();
    this.came = null;
    this.hot = Array.from({ length: HOT_KEYS }, () => null);
    this.boundSeen.clear();
    this.autoGiven.clear();
    this.tags.items = [];
    // (and what an admin had in the hold: everything carried goes. Whether it is open is the power's, and stays as it is.)
    this.theHold.items = [];
    this.neck = null;
    this.gearCargo.clear();
    this.dress();
  }

  /** A jacket and trousers put on, wherever nothing is worn in their place. */
  dress() {
    for (const [slot, id] of CLOTHES) this.slots[slot] ??= makeItem(id);
  }

  /**
   * Dog tags put where they belong: the survivor's own round their neck, the rest in the
   * pouch for as long as it has room. (Characters from before there was a pouch carry theirs
   * in their pockets.)
   * @param own is this tag the survivor's own
   */
  sortTags(own: (tag: ItemInstance) => boolean) {
    for (const c of this.containers) {
      for (const p of [...c.items]) {
        if (p.item.id !== 'dogtag') continue;
        if (own(p.item)) {
          c.remove(p.item);
          this.neck ??= p.item;
        } else if (c !== this.tags && this.tags.findSpace(p.item)) {
          c.remove(p.item);
          this.tags.add(p.item);
        }
      }
    }
  }

  /**
   * Which grids a thing would rather go to (the game's: a bag the player has set for its kind, "assign their containers
   * as a Type like ammo or food or medical etc so those items automatically go there", the owner, 2026-10-23). Not
   * set, as on the server, every grid is as good as another.
   */
  prefer: ((c: Container, item: ItemInstance) => boolean) | null = null;

  add(item: ItemInstance): ItemInstance | null {
    const free = this.freeSlotFor(item);
    if (free) {
      this.slots[free] = item;
      return null;
    }
    // (A pile joins its own kind first, wherever on the body that is: it went into the first grid with room, a pile
    // of its own beside nothing, while one of the same lay half full in the pack. Then the grids set for it.)
    if (ITEMS[item.id].stack) for (const c of this.containers) if (c.topUp(item)) return null;
    const all = this.containers, want = this.prefer;
    const order = want ? [...all.filter((c) => want(c, item)), ...all.filter((c) => !want(c, item))] : all;
    let left: ItemInstance | null = item;
    for (const c of order) {
      if (!left) break;
      left = c.add(left);
    }
    return left;
  }

  /** could `add` take the whole item? */
  hasRoom(item: ItemInstance): boolean {
    return !!this.freeSlotFor(item) || this.containers.some((c) => c.hasRoom(item));
  }

  /** first empty equipment slot this item can occupy */
  freeSlotFor(item: ItemInstance): Slot | null {
    const kind = ITEMS[item.id].slot;
    if (!kind) return null;
    return ALL_SLOTS.find((s) => SLOT_KIND[s] === kind && !this.slots[s]) ?? null;
  }

  remove(item: ItemInstance) {
    for (const s of ALL_SLOTS) if (this.slots[s] === item) this.slots[s] = null;
    if (this.slots.held === item) this.slots.held = null;
    for (const c of this.containers) c.remove(item);
  }

  count(id: string) {
    return this.containers.reduce((s, c) => s + c.count(id), 0);
  }

  take(id: string, n: number) {
    let t = 0;
    for (const c of this.containers) t += c.take(id, n - t);
    return t;
  }

  find(pred: (i: ItemInstance) => boolean): ItemInstance | null {
    if (this.slots.held && pred(this.slots.held)) return this.slots.held;
    for (const s of ALL_SLOTS) {
      const it = this.slots[s];
      if (it && pred(it)) return it;
    }
    if (this.neck && pred(this.neck)) return this.neck;
    for (const c of this.containers) for (const p of c.items) if (pred(p.item)) return p.item;
    return null;
  }

  containerOf(item: ItemInstance): Container | null {
    return this.containers.find((c) => c.has(item)) ?? null;
  }

  /**
   * Every top-level item carried: worn / slung things (each keeps its contents: the jacket and
   * the trousers what is in their pockets, a bag what is in it) and the tags in the pouch. Not
   * the survivor's own tag: that is not carried, and is never among what is dropped. (And what
   * an admin has in the hold: it is carried, and weighs what it weighs.)
   */
  topLevel(): ItemInstance[] {
    const out: ItemInstance[] = this.slots.held ? [this.slots.held] : [];
    for (const s of ALL_SLOTS) {
      const it = this.slots[s];
      if (it) out.push(it);
    }
    for (const p of this.tags.items) out.push(p.item);
    for (const p of this.theHold.items) out.push(p.item);
    return out;
  }

  /** value of a worn-gear effect, e.g. the vest's torso armour */
  wear<K extends 'armor' | 'head' | 'fall' | 'fist' | 'thirst' | 'gas'>(key: K): number[] {
    const out: number[] = [];
    for (const s of GEAR_SLOTS) {
      const it = this.slots[s];
      const v = it ? ITEMS[it.id].wear?.[key] : undefined;
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  weight() {
    let w = 0;
    for (const it of this.topLevel()) w += itemWeight(it);
    return w;
  }

  serialize(): SerializedInventory {
    // (the tag round the neck goes with the slots: to the server it is one more thing worn, and so it is on the body)
    // (the pockets are in the jacket and the trousers, which are among the slots: the pouch is the one grid left that is no thing's)
    // (but for an admin's hold, said only when there is something in it: nobody else's inventory is a byte longer for it)
    return { slots: { ...this.slots, neck: this.neck }, containers: [this.tags.serialize(), ...(this.theHold.items.length ? [this.theHold.serialize()] : [])], hot: this.hot.map((b) => (b ? { ...b } : null)) };
  }

  /**
   * Returns items that no longer fit anywhere (the caller drops them at the player's feet). One kept from before
   * clothes were things is made new first (`upgradeInventory`); what is worn is then put on as it was kept, with
   * what was kept in it where it was kept, whatever the rules for moving a thing would say of that today.
   */
  load(d: SerializedInventory): ItemInstance[] {
    const up = upgradeInventory(d);
    d = up.inv;
    const raw = d.slots as Record<string, ItemInstance | null>;
    this.slots = EMPTY_SLOTS();
    this.came = null;
    this.gearCargo.clear();
    const overflow: ItemInstance[] = [...up.left];
    // migrate saves from the single 'shoulder' slot layout
    if (raw.shoulder && !raw.primary) raw.primary = raw.shoulder;
    // (and from when the body had a place for something to hit with: it goes on the back if it is long and there is room, or into a pocket)
    const loose = raw.melee ? sanitizeItem(raw.melee) : null;
    if (loose) overflow.push(loose);
    for (const s of ALL_SLOTS) {
      const it = raw[s] ? sanitizeItem(raw[s]!) : null;
      if (!it) continue;
      if (ITEMS[it.id].slot === SLOT_KIND[s]) this.slots[s] = it;
      else overflow.push(it);
    }
    // (what was in the hands is in them again: it is carried nowhere else. A save from before the hands were a place says `active`, which is let be: that gun is still on the back.)
    this.slots.held = raw.held ? sanitizeItem(raw.held) : null;
    const neck = raw.neck ? sanitizeItem(raw.neck) : null;
    this.neck = neck?.id === 'dogtag' ? neck : null;
    this.tags.items = [];
    // An admin's hold is laid as it was kept, every thing where it lay, and is shut: whether things are still put
    // into it is the server's to say, and it says so after this (the welcome carries what is carried, and `powers`
    // comes after it). Nothing in it is put at anybody's feet for arriving before that word; and if the word never
    // comes it holds what it held, gives it up as it is asked to, and takes nothing.
    this.theHold.items = [];
    this.theHold.open = false;
    for (const cd of d.containers ?? []) {
      if (cd.id === 'tags') overflow.push(...this.tags.load(cd as never));
      else if (cd.id === HOLD && !this.theHold.items.length) overflow.push(...this.theHold.load(cd as never));
      // (any other grid kept: the server's `spill`, or one this game does not know. What is in it is not lost: it goes wherever there is room)
      else for (const { x: _x, y: _y, rot: _rot, ...it } of cd.items ?? []) if (sanitizeItem(it)) overflow.push(it);
    }
    // things that fell out of a shrunken pocket go wherever there is room
    const left = overflow.map((it) => this.add(it)).filter((it): it is ItemInstance => !!it);
    // the hot keys as they were left; a save from before there were any gets the back and the holster on 1, 2 and 3
    this.hot = cleanHot(d.hot);
    this.forgetGone();
    this.autoBind();
    // (what came back with them has been seen: a kind they took off its key, or whose thing left them, is not put back)
    this.autoGiven = new Set([...this.everything().values()].map((it) => it.id));
    return left;
  }
}

/** every thing among these by its number, and down into every bag (what is on a body: `forgetGone`, `keepHotHeld`) */
function allIn(items: Iterable<ItemInstance | null | undefined>, on = new Map<string, ItemInstance>()): Map<string, ItemInstance> {
  for (const it of items) {
    if (!it || on.has(it.uid)) continue;
    on.set(it.uid, it);
    if (it.cargo) allIn(it.cargo.map((p) => p.item), on);
  }
  return on;
}

/** The server's side of `PlayerInventory.forgetGone`: a key whose thing is not in this inventory is bare. */
export function keepHotHeld(inv: SerializedInventory | null) {
  if (!inv?.hot) return;
  const on = allIn([...Object.values(inv.slots), ...inv.containers.flatMap((c) => c.items as ItemInstance[])]);
  inv.hot = inv.hot.map((b) => (b && on.has(b.uid) ? b : null));
}

/** The hot keys as something kept or sent says they were: ten of them, each a thing's number and its kind, or nothing. */
export function cleanHot(raw: unknown): (HotBind | null)[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: HOT_KEYS }, (_, i) => {
    const b = list[i] as HotBind | null | undefined;
    return b && typeof b.uid === 'string' && isItem(b.id) ? { uid: b.uid.slice(0, 64), id: b.id } : null;
  });
}

/** Is this the name of a thing there is? (asked of the list's own names only: `constructor` is no item) */
const isItem = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(ITEMS, id);

// ------------------------------------------------------------------ from before clothes were things
//
// Until 2026-10-13 the jacket and the trousers were two grids of the body's own, kept in `containers` as `jacket`
// and `pants` beside the tag pouch (always both, full or empty: `serialize` wrote them every time, and the server
// kept them), and nothing was worn in `top` or `legs`. Every character the server keeps between sessions and
// restarts, and every single-player save, is of that shape until it has been through here once.

/** the grids that were the body's own, and the place the thing that has each one's pockets is worn in now */
const OLD_POCKETS = new Map<unknown, Slot>([['jacket', 'top'], ['pants', 'legs']]);
/** the grid the server keeps things in that found no room while an old inventory was made new (see `cleanInventory`) */
export const SPILL = 'spill';

/**
 * An inventory as it was kept, made into the shape of today. One function for the game (`PlayerInventory.load`) and
 * for the server (`cleanInventory`), so that the two can never read the same character differently.
 *
 * - From before (a `jacket` grid kept, and nothing worn on the top): a Field Jacket is made and put in `top`, and
 *   everything that was in the grid is in its pockets at the same place, the same way up. A `pants` grid, and
 *   nothing worn on the legs: Field Trousers in `legs`, the same. The pockets are the size the grids were, so
 *   everything has its place. The two grids are gone from `containers` after.
 * - Already of today (nothing kept as `jacket` or `pants`): handed back as it is, the very same object. Nobody is
 *   dressed by this who had nothing on: somebody who took their jacket off has no jacket.
 * - Half-way (a `jacket` or `pants` grid AND something worn in that place): nothing is thrown away. What is in the
 *   stray grid goes into the pockets of what is worn there, at its own place if that is free and anywhere if not;
 *   then into anything else that is worn and has room; and whatever is still left is handed back in `left`, for
 *   the caller to put at the player's feet.
 *
 * Things are laid by room alone (`Container.restore`), never by the rules of what goes into what.
 */
export function upgradeInventory(d: SerializedInventory): { inv: SerializedInventory; left: ItemInstance[] } {
  const slots = (d.slots ?? {}) as Record<string, ItemInstance | null>;
  const kept = Array.isArray(d.containers) ? d.containers : [];
  if (!kept.some((c) => OLD_POCKETS.has(c?.id))) return { inv: d, left: [] };
  const out: Record<string, ItemInstance | null> = { ...slots };
  const inside = (it: ItemInstance): Container | null => {
    const room = holds(it.id);
    return room ? new Container('', '', room[0], room[1], (it.cargo ??= [])) : null;
  };
  /** what has no place yet: each thing, where it lay, and the place on the body whose grid it lay in */
  const stray: { st: Stored; slot: Slot }[] = [];
  for (const [slot, id] of CLOTHES) {
    const grids = kept.filter((c) => OLD_POCKETS.get(c?.id) === slot);
    if (!grids.length) continue;
    const old = grids.flatMap((c) => (Array.isArray(c.items) ? c.items : []));
    if (out[slot]) {
      stray.push(...old.map((st) => ({ st, slot })));
      continue;
    }
    const made = makeItem(id), pockets = inside(made)!;
    for (const st of old) {
      const { x, y, rot, ...raw } = st;
      const item = sanitizeItem(raw);
      // (one that has no room where it was kept, nor anywhere in the pockets: a grid kept bigger than it is now)
      if (item && !pockets.restore(item, x, y, rot)) stray.push({ st: { ...item, x: NaN, y: NaN, rot: false }, slot });
    }
    out[slot] = made;
  }
  const left: ItemInstance[] = [];
  if (stray.length) {
    // (what is worn that has room in it, the jacket and the trousers before the rest: each made sense of first, as `load` will)
    const homes = new Map<Slot, Container>();
    for (const s of POCKET_ORDER) {
      const it = out[s], c = it && sanitizeItem(it) ? inside(it) : null;
      if (c) homes.set(s, c);
    }
    for (const { st, slot } of stray) {
      const { x, y, rot, ...raw } = st;
      const item = sanitizeItem(raw);
      if (!item) continue;
      const own = homes.get(slot);
      if (own?.restore(item, x, y, rot) || [...homes.values()].some((c) => c !== own && c.restore(item, NaN, NaN, false))) continue;
      left.push(item);
    }
  }
  return { inv: { ...d, slots: out, containers: kept.filter((c) => c && !OLD_POCKETS.has(c.id)) }, left };
}

// ------------------------------------------------------------------ what a game says it carries, made safe
//
// The server keeps a copy of what every living character carries, as their own game says it (`me`), and leaves a
// body with it. What a game says is not believed as it stands: these make a thing, a grid of things and a whole
// inventory out of whatever was sent, and leave out what cannot be. They are here, and not in the server, so that
// they can be tried without one (test/clothes.test.ts).

/** how far inside one another things are still read: a thing, what is in it, what is in that, and what is in that */
export const KEPT_DEPTH = 3;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A thing as somebody's game says it is, made into one this game could have made; null for what is no thing.
 * @param name how a name stamped on a dog tag is made safe (the server's own way with players' names)
 */
export function cleanItem(raw: unknown, name: (v: unknown) => string, depth = 0): ItemInstance | null {
  // (Things inside things are read KEPT_DEPTH down. It was two: pockets are one further in than they were, now
  // that they are inside the jacket, and what was kept at the bottom of a bag in a pack is not to fall out of it.)
  if (!raw || typeof raw !== 'object' || depth > KEPT_DEPTH) return null;
  const r = raw as ItemInstance;
  if (!isItem(r.id) || typeof r.uid !== 'string' || r.uid.length > 64) return null;
  const def = ITEMS[r.id];
  const it: ItemInstance = { uid: r.uid, id: r.id, qty: def.stack ? Math.max(1, Math.min(def.stack, Math.floor(Number(r.qty) || 1))) : 1 };
  if (def.weapon) {
    // (how many it may really have in it is said by what feeds it: sanitizeItem holds it to that)
    it.loaded = Math.max(0, Math.min(200, Math.floor(Number(r.loaded) || 0)));
    if (Array.isArray(r.mods)) it.mods = r.mods.filter((m) => typeof m === 'string').slice(0, 6);
    // (its magazine: one it takes, or none; said by nobody, it is a gun from before magazines, and is given its own)
    if (def.weapon.mag && r.mag !== undefined) it.mag = typeof r.mag === 'string' && magFits(r.mag, r.id) ? r.mag : null;
    // (the range its sights are set for: sanitizeItem holds it to one that gun has)
    if (num(r.zero)) it.zero = r.zero;
  }
  if (def.mag) it.rounds = Math.max(0, Math.min(def.mag.capacity, Math.floor(Number(r.rounds) || 0)));
  if (def.use?.sips) it.left = Number.isFinite(Number(r.left)) ? Number(r.left) : def.use.sips;
  // (what cooking and time have done to food: kept, and never said to be fresher than now, src/sim/cooking.ts)
  const wall = Date.now() / 1000;
  if (num(r.cook) && r.cook > 0) it.cook = Math.min(600, r.cook);
  if (num(r.hot) && r.hot > 0) it.hot = Math.min(wall + 300, r.hot);
  if (num(r.made) && r.made > 0) it.made = Math.min(wall, r.made);
  // (a tool's condition, worn by work: src/sim/gather.ts; the server holds it to no newer than it wore it, server/gather.ts)
  if (num(r.cond) && r.cond < 1) it.cond = Math.max(0, r.cond);
  if (r.id === 'dogtag') {
    const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 24) : undefined);
    it.owner = name(r.owner);
    it.pid = short(r.pid);
    if (r.gold === true) it.gold = true;
    it.holder = short(r.holder);
    it.held = Math.max(0, Math.min(TAG_HOLD, Number(r.held) || 0));
  }
  const room = holds(def.id);
  // (what it is set for, one of the kinds there are, or nothing)
  if (room && isBagKind(r.for)) it.for = r.for;
  if (room && Array.isArray(r.cargo)) {
    it.cargo = [];
    // (As many things as it has cells, and no fewer. It was forty whatever the thing: a full rucksack was forty-two
    // single things then and a stash case forty-eight, and the last of them were dropped every time they were read.
    // The most any one thing holds is sixty-three since 2026-10-13, the rucksack: still by its cells, and so never
    // to be bounded by a count written here.)
    for (const p of r.cargo.slice(0, room[0] * room[1])) {
      const inner = cleanItem(p?.item, name, depth + 1);
      if (inner && num(p.x) && num(p.y)) it.cargo.push({ item: inner, x: p.x, y: p.y, rot: !!p.rot });
    }
  }
  return sanitizeItem(it);
}

/**
 * The things in a grid as somebody's game says they lie, each made safe.
 * @param most how many of them are read: every cell of the biggest grid a body has (BODY_GRID); of an
 *   admin's hold, as many as a hold takes
 */
export function cleanStored(list: unknown, name: (v: unknown) => string, most = BODY_GRID[0] * BODY_GRID[1]): Stored[] {
  if (!Array.isArray(list)) return [];
  const out: Stored[] = [];
  for (const raw of list.slice(0, most)) {
    const it = cleanItem(raw, name);
    if (it && num(raw.x) && num(raw.y)) out.push({ ...it, x: raw.x, y: raw.y, rot: !!raw.rot });
  }
  return out;
}

/**
 * A whole inventory as somebody's game says it is, or as it was kept, made safe and made new: every thing through
 * `cleanItem`, the hot keys through `cleanHot` (they were let fall here until 2026-10-13, and every key was bare
 * again after every rejoin), what is in the hands as a place like any other, and the shape of
 * today (`upgradeInventory`). Whatever found no room on the way is kept in a grid named `spill`, which the game it
 * is for empties at its player's feet: the server has no feet to put it at, and loses nothing by holding it.
 */
/** the places a kept inventory may name: every one a body has, the hands, the tag round the neck, and the two an old save may still have */
const KEPT_SLOTS = new Set<string>([...ALL_SLOTS, 'held', 'neck', 'shoulder', 'melee']);

export function cleanInventory(raw: unknown, name: (v: unknown) => string): SerializedInventory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as SerializedInventory;
  const slots: Record<string, ItemInstance | null> = {};
  // (Only the places a body has, and the two an old save may still name. Any name at all used to be kept: a game
  // that said it wore five thousand things in five thousand made-up places had them all kept, and thrown on the
  // ground one by one when it died.)
  for (const [k, v] of Object.entries(r.slots ?? {})) if (KEPT_SLOTS.has(k)) slots[k] = v ? cleanItem(v, name) : null;
  // (A grid is read to 120 things, which was the end of an admin's hold at its hundred and twenty-first: the hold is
  // read to all a hold takes. That makes nobody a present of the room: whose hold it is, and whether anything may be
  // put in it, is the server's to say of what comes out of here: `holdOnlyEmpties`. And one hold, not two.)
  const containers = (Array.isArray(r.containers) ? r.containers : []).slice(0, 4).map((c) => ({ id: String(c?.id).slice(0, 16), items: cleanStored(c?.items, name, c?.id === HOLD ? HOLD_MOST : 120) })).filter((c, i, all) => c.id !== HOLD || all.findIndex((o) => o.id === HOLD) === i);
  const { inv, left } = upgradeInventory({ slots, containers, hot: cleanHot(r.hot) });
  if (left.length) {
    let spill = inv.containers.find((c) => c.id === SPILL);
    if (!spill) inv.containers.push((spill = { id: SPILL, items: [] }));
    spill.items.push(...left.map((it) => ({ ...it, x: 0, y: 0, rot: false })));
  }
  keepHotHeld(inv);
  return inv;
}

// ------------------------------------------------------------------ a body
//
// Everything a character carried goes into a body that can be searched. What was worn lies in the body's grid as
// the things themselves, each with what is in it still in it: take the jacket and what was in its pockets comes
// with it, as a pack always did (2026-10-13: "it should be the same for all inventories").

/**
 * A body's grid: everything a person can have on and slung at once, with their own tag and a full pouch of tags
 * taken, lies in it. The worst there is, three .50 rifles (two slung, one in the hands: 2026-10-24) and the biggest
 * thing for every place, is 162 cells, and this is 170, ten wide so that a long gun lies flat (it was 8x17 for two,
 * 8x15 until the .50s came): laid biggest first (`layOnBody`) every set of things that can be worn
 * goes in with none left over (test/clothes.test.ts lays them out). It was 8x10: a geared body is 83 to 88 cells of
 * worn things before a single thing out of a pocket, and what found no room was thrown on the ground round it.
 *
 * (No bigger than it need be: the server reads no more things out of any grid it is sent than this has cells. When
 * something bigger is made this has to grow a row: the test will say so.)
 */
export const BODY_GRID: [number, number] = [10, 17];

/**
 * Things laid in a body's grid, the biggest first so that the small ones fill what is left.
 * @returns what found no room (the caller puts it on the ground beside the body)
 */
export function layOnBody(box: Container, things: ItemInstance[]): ItemInstance[] {
  // (a body is where dog tags are taken from: they lie on it)
  box.tagsHere = true;
  const cells = (it: ItemInstance) => ITEMS[it.id].w * ITEMS[it.id].h, long = (it: ItemInstance) => Math.max(ITEMS[it.id].w, ITEMS[it.id].h);
  const spill: ItemInstance[] = [];
  for (const it of [...things].sort((a, b) => cells(b) - cells(a) || long(b) - long(a))) {
    const left = box.add(it);
    if (left) spill.push(left);
  }
  return spill;
}
