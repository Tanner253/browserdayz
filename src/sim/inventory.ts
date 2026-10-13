// Grid inventory (DayZ / Tarkov style). Items occupy w x h cells and may be rotated.
// What a character can carry comes from what they wear, and from nothing else: the pockets of
// the jacket and the trousers they have on, the pouches of a vest, whatever is on their back.
// Each of those is a thing, and what is in it lives inside it (`cargo`), so it travels with
// the thing when it is taken off, dropped, or left on a body. (2026-10-13: "When i kill someone
// and i loot their body and i pick up their backpack it should bring all the loot with it ...
// it should be the same for all inventories. we should make the jacket and pants the user
// spawns in with (the default inventory slots) clothing items". The jacket and the trousers
// were two grids of the body's own until then: see `upgradeInventory` for what becomes of an
// inventory kept from before.)
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

import { ALL_SLOTS, CLOTHES, GEAR_SLOTS, ITEMS, SLOT_KIND, TAG_HOLD, WEAPON_SLOTS, holds, itemWeight, magFits, makeItem, sanitizeItem, type ItemInstance, type Placed, type Slot } from './items';

const EMPTY_SLOTS = (): Record<Slot, ItemInstance | null> => Object.fromEntries(ALL_SLOTS.map((s) => [s, null])) as Record<Slot, ItemInstance | null>;
/** the places whose things are looked into for room, in the order they are filled: jacket and trousers first, as ever, then the rest of what is worn */
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

  /**
   * Why a thing is not taken here, in words that can be said to the player; null when it is. (Whether there is
   * room for it is another question: `free`, `findSpace`.)
   */
  refusal(item: ItemInstance): string | null {
    // (the words are made only when there is something to say: this is asked for every cell a thing is dragged over)
    const what = () => (ITEMS[item.id]?.name ?? 'thing').toLowerCase(), here = () => this.name.toLowerCase();
    if (this.only && item.id !== this.only) return `Only a ${(ITEMS[this.only]?.name ?? this.only).toLowerCase()} goes in the ${here()}`;
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

  /** Is this very place free for it: inside the grid, and on nothing that lies there? (Whether it is taken here at all is `accepts`.) */
  free(item: ItemInstance, x: number, y: number, rot: boolean, ignore?: ItemInstance): boolean {
    const [w, h] = Container.size(item, rot);
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
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
  private anywhere(item: ItemInstance): { x: number; y: number; rot: boolean } | null {
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

  /** Merges into existing stacks first, then finds free space. Returns leftover qty. */
  add(item: ItemInstance): ItemInstance | null {
    if (!this.accepts(item)) return item;
    const def = ITEMS[item.id];
    if (def.stack) {
      for (const p of this.items) {
        if (p.item.id !== item.id || p.item.qty >= def.stack) continue;
        const move = Math.min(def.stack - p.item.qty, item.qty);
        p.item.qty += move;
        item.qty -= move;
        if (item.qty <= 0) return null;
      }
    }
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
export type SerializedInventory = { slots: Record<string, ItemInstance | null>; active: Slot | null; containers: ReturnType<Container['serialize']>[]; hot?: (HotBind | null)[] };

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
  let best: { x: number; y: number; rot: boolean } | null = null, bd = Infinity;
  for (const rot of [placed.rot, !placed.rot]) {
    const [w, h] = Container.size(half, rot);
    for (let y = 0; y <= c.h - h; y++) {
      for (let x = 0; x <= c.w - w; x++) {
        const d = Math.hypot(x - placed.x, y - placed.y);
        if (d < bd && c.fits(half, x, y, rot)) {
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
  /** the survivor's own dog tag, round their neck */
  neck: ItemInstance | null = null;
  /** which of the body's own places has its thing in the hands (null: none of them) */
  active: Slot | null = null;
  /** a thing carried in a pocket or a pack that is in the hands: it stays where it is carried, and is held (see `hold`) */
  hand: ItemInstance | null = null;
  /** what each hot key is bound to */
  hot: (HotBind | null)[] = Array.from({ length: HOT_KEYS }, () => null);

  /** What is in the hands: something off the back or out of the holster, or a thing out of a pocket. */
  held(): ItemInstance | null {
    if (this.active) return this.slots[this.active];
    return this.hand && this.containerOf(this.hand) ? this.hand : null;
  }

  /** A thing carried is taken into the hands (null: the hands are emptied). It stays where it is carried. */
  hold(item: ItemInstance | null) {
    const slot = item ? WEAPON_SLOTS.find((s) => this.slots[s] === item) ?? null : null;
    this.active = slot;
    this.hand = item && !slot && this.containerOf(item) ? item : null;
  }

  /** every thing carried that a hand could take up: on the back and in the holster, in the pockets, and in what is worn */
  *carried(): Generator<ItemInstance> {
    for (const s of WEAPON_SLOTS) if (this.slots[s]) yield this.slots[s]!;
    for (const c of this.containers) if (c !== this.tags) for (const p of c.items) yield p.item;
  }

  /** The thing a hot key brings up: the one it was given, or failing that another of its kind (null: nothing of the sort is carried). */
  hotItem(i: number): ItemInstance | null {
    const b = this.hot[i];
    if (!b) return null;
    let other: ItemInstance | null = null;
    for (const it of this.carried()) {
      if (it.uid === b.uid) return it;
      if (!other && it.id === b.id) other = it;
    }
    return other;
  }

  /** Put a thing on a hot key (it comes off any other it was on), or clear the key. */
  bind(i: number, item: ItemInstance | null) {
    if (i < 0 || i >= HOT_KEYS) return;
    if (item) this.hot = this.hot.map((b) => (b && b.uid === item.uid ? null : b));
    this.hot[i] = item ? { uid: item.uid, id: item.id } : null;
  }

  /** the hot key this thing is on, or one of its kind is (-1: none) */
  hotOf(item: ItemInstance): number {
    const own = this.hot.findIndex((b) => b?.uid === item.uid);
    return own >= 0 ? own : this.hot.findIndex((b, i) => b?.id === item.id && this.hotItem(i) === item);
  }

  /**
   * What goes on the back or into the holster takes the key of its place if that key is free and the thing is on
   * none: 1 and 2 for the back, 3 for the holster. (Any of them can be given to something else afterwards.)
   */
  autoBind() {
    WEAPON_SLOTS.forEach((s, i) => {
      const it = this.slots[s];
      if (it && this.hotOf(it) < 0 && !this.hotItem(i)) this.bind(i, it);
    });
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
      c = Object.assign(new Container(`gear:${item.uid}`, d.name, d.wear.cargo[0], d.wear.cargo[1], item.cargo, d.slot === 'back'), { depth: 1, of: item.id });
      this.gearCargo.set(item.uid, c);
    }
    return c;
  }

  /** every grid the player can put things in right now: the tag pouch (which takes only tags), the pockets of jacket and trousers, then vest and bag */
  get containers(): Container[] {
    const out: Container[] = [this.tags];
    for (const s of POCKET_ORDER) {
      const it = this.slots[s];
      const c = it ? this.cargoOf(it) : null;
      if (c) out.push(c);
    }
    return out;
  }

  /**
   * Everything carried goes, and the survivor stands in a new jacket and new trousers with nothing in them: what a
   * body had by itself when its pockets were its own, and what every new life starts in (2026-10-13). Whoever is
   * given a kit by an admin, which "replaces everything", is left the same.
   */
  clear() {
    this.slots = EMPTY_SLOTS();
    this.active = null;
    this.hand = null;
    this.hot = Array.from({ length: HOT_KEYS }, () => null);
    this.tags.items = [];
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

  add(item: ItemInstance): ItemInstance | null {
    const free = this.freeSlotFor(item);
    if (free) {
      this.slots[free] = item;
      return null;
    }
    let left: ItemInstance | null = item;
    for (const c of this.containers) {
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
    for (const s of ALL_SLOTS) {
      if (this.slots[s] === item) {
        this.slots[s] = null;
        if (this.active === s) this.active = null;
      }
    }
    if (this.hand === item) this.hand = null;
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
   * the survivor's own tag: that is not carried, and is never among what is dropped.
   */
  topLevel(): ItemInstance[] {
    const out: ItemInstance[] = [];
    for (const s of ALL_SLOTS) {
      const it = this.slots[s];
      if (it) out.push(it);
    }
    for (const p of this.tags.items) out.push(p.item);
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
    return { slots: { ...this.slots, neck: this.neck }, active: this.active, containers: [this.tags.serialize()], hot: this.hot.map((b) => (b ? { ...b } : null)) };
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
    this.active = null;
    this.hand = null;
    const neck = raw.neck ? sanitizeItem(raw.neck) : null;
    this.neck = neck?.id === 'dogtag' ? neck : null;
    this.tags.items = [];
    for (const cd of d.containers ?? []) {
      if (cd.id === 'tags') overflow.push(...this.tags.load(cd as never));
      // (any other grid kept: the server's `spill`, or one this game does not know. What is in it is not lost: it goes wherever there is room)
      else for (const { x: _x, y: _y, rot: _rot, ...it } of cd.items ?? []) if (sanitizeItem(it)) overflow.push(it);
    }
    // things that fell out of a shrunken pocket go wherever there is room
    const left = overflow.map((it) => this.add(it)).filter((it): it is ItemInstance => !!it);
    // the hot keys as they were left; a save from before there were any gets the back and the holster on 1, 2 and 3
    this.hot = cleanHot(d.hot);
    this.autoBind();
    return left;
  }
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
  if (r.id === 'dogtag') {
    const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 24) : undefined);
    it.owner = name(r.owner);
    it.pid = short(r.pid);
    it.holder = short(r.holder);
    it.held = Math.max(0, Math.min(TAG_HOLD, Number(r.held) || 0));
  }
  const room = holds(def.id);
  if (room && Array.isArray(r.cargo)) {
    it.cargo = [];
    // (As many things as it has cells, and no fewer. It was forty whatever the thing: a full rucksack is forty-two
    // single things and a stash case forty-eight, and the last of them were dropped every time they were read.)
    for (const p of r.cargo.slice(0, room[0] * room[1])) {
      const inner = cleanItem(p?.item, name, depth + 1);
      if (inner && num(p.x) && num(p.y)) it.cargo.push({ item: inner, x: p.x, y: p.y, rot: !!p.rot });
    }
  }
  return sanitizeItem(it);
}

/** The things in a grid as somebody's game says they lie, each made safe. */
export function cleanStored(list: unknown, name: (v: unknown) => string): Stored[] {
  if (!Array.isArray(list)) return [];
  const out: Stored[] = [];
  for (const raw of list.slice(0, 120)) {
    const it = cleanItem(raw, name);
    if (it && num(raw.x) && num(raw.y)) out.push({ ...it, x: raw.x, y: raw.y, rot: !!raw.rot });
  }
  return out;
}

/**
 * A whole inventory as somebody's game says it is, or as it was kept, made safe and made new: every thing through
 * `cleanItem`, the hot keys through `cleanHot` (they were let fall here until 2026-10-13, and every key was bare
 * again after every rejoin), nothing in the hands (that is the game's to say when it is back), and the shape of
 * today (`upgradeInventory`). Whatever found no room on the way is kept in a grid named `spill`, which the game it
 * is for empties at its player's feet: the server has no feet to put it at, and loses nothing by holding it.
 */
export function cleanInventory(raw: unknown, name: (v: unknown) => string): SerializedInventory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as SerializedInventory;
  const slots: Record<string, ItemInstance | null> = {};
  for (const [k, v] of Object.entries(r.slots ?? {})) if (k.length < 16) slots[k] = v ? cleanItem(v, name) : null;
  const containers = (Array.isArray(r.containers) ? r.containers : []).slice(0, 4).map((c) => ({ id: String(c?.id).slice(0, 16), items: cleanStored(c?.items, name) }));
  const { inv, left } = upgradeInventory({ slots, active: null, containers, hot: cleanHot(r.hot) });
  if (left.length) {
    let spill = inv.containers.find((c) => c.id === SPILL);
    if (!spill) inv.containers.push((spill = { id: SPILL, items: [] }));
    spill.items.push(...left.map((it) => ({ ...it, x: 0, y: 0, rot: false })));
  }
  return inv;
}

// ------------------------------------------------------------------ a body
//
// Everything a character carried goes into a body that can be searched. What was worn lies in the body's grid as
// the things themselves, each with what is in it still in it: take the jacket and what was in its pockets comes
// with it, as a pack always did (2026-10-13: "it should be the same for all inventories").

/**
 * A body's grid: everything a person can have on and slung at once, with their own tag and a full pouch of tags
 * taken, lies in it. The worst there is, two AKs and the biggest thing for every place, is 120 cells, and this is
 * 120: laid biggest first (`layOnBody`) every set of things that can be worn goes in with none left over
 * (test/clothes.test.ts lays them out; all 230,400 sets were laid once by hand, and 8x14, which was proposed, left
 * tags over in 35 of them). It was 8x10: a geared body is 83 to 88 cells of worn things before a single thing out
 * of a pocket, and what found no room, pocket loot and taken tags, was thrown on the ground round it.
 *
 * (No bigger than it need be: the server reads no more than 120 things out of any grid it is sent, so a grid of
 * more cells than that could be filled with more single things than are kept. When something is made for the
 * eyes, the belt or the arm this has to grow a row, and that count with it: the test will say so.)
 */
export const BODY_GRID: [number, number] = [8, 15];

/**
 * Things laid in a body's grid, the biggest first so that the small ones fill what is left.
 * @returns what found no room (the caller puts it on the ground beside the body)
 */
export function layOnBody(box: Container, things: ItemInstance[]): ItemInstance[] {
  const cells = (it: ItemInstance) => ITEMS[it.id].w * ITEMS[it.id].h, long = (it: ItemInstance) => Math.max(ITEMS[it.id].w, ITEMS[it.id].h);
  const spill: ItemInstance[] = [];
  for (const it of [...things].sort((a, b) => cells(b) - cells(a) || long(b) - long(a))) {
    const left = box.add(it);
    if (left) spill.push(left);
  }
  return spill;
}
