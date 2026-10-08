// Grid inventory (DayZ / Tarkov style). Items occupy w x h cells and may be rotated.
// What a character can carry comes from what they wear: the built-in jacket and trouser
// pockets, plus the cargo grid of a vest and of whatever is on their back. A bag's
// contents live inside the bag item, so they travel with it when it is dropped.
//
// Dog tags have places of their own. A survivor's own tag hangs round their neck: it is not
// in a pocket, cannot be moved or dropped, and is on the body when they die. Tags taken off
// other people go in a pouch of ten, so they do not fill the pockets; an eleventh goes
// wherever there is room.

import { ALL_SLOTS, GEAR_SLOTS, ITEMS, SLOT_KIND, WEAPON_SLOTS, itemWeight, sanitizeItem, type ItemInstance, type Placed, type Slot } from './items';

const EMPTY_SLOTS = (): Record<Slot, ItemInstance | null> => Object.fromEntries(ALL_SLOTS.map((s) => [s, null])) as Record<Slot, ItemInstance | null>;
/** hand-held slots in number-key order */
export const SLOT_ORDER: Slot[] = WEAPON_SLOTS;

export type { Placed };

export class Container {
  /**
   * @param items backing array (a bag's own `cargo`), so the container is a live view of the item
   * @param holdsBags world containers (crates, stashes, bodies) accept bags that still have things in them
   */
  constructor(public id: string, public name: string, public w: number, public h: number, public items: Placed[] = [], public holdsBags = false) {}

  /** the one kind of item this is for (null: anything) */
  only: string | null = null;

  static size(item: ItemInstance, rot: boolean): [number, number] {
    const d = ITEMS[item.id];
    return rot ? [d.h, d.w] : [d.w, d.h];
  }

  /** a bag can't go inside itself, and a packed bag can't be stuffed into pockets */
  accepts(item: ItemInstance): boolean {
    if (this.only && item.id !== this.only) return false;
    if (this.id === `gear:${item.uid}`) return false;
    if (item.cargo?.length && !this.holdsBags) return false;
    return true;
  }

  fits(item: ItemInstance, x: number, y: number, rot: boolean, ignore?: ItemInstance): boolean {
    if (!this.accepts(item)) return false;
    const [w, h] = Container.size(item, rot);
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
    for (const p of this.items) {
      if (p.item === ignore) continue;
      const [pw, ph] = Container.size(p.item, p.rot);
      if (x < p.x + pw && x + w > p.x && y < p.y + ph && y + h > p.y) return false;
    }
    return true;
  }

  findSpace(item: ItemInstance): { x: number; y: number; rot: boolean } | null {
    if (!this.accepts(item)) return null;
    for (const rot of [false, true]) {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.fits(item, x, y, rot)) return { x, y, rot };
        }
      }
    }
    return null;
  }

  /** room for the item either as a new entry or merged into a stack */
  hasRoom(item: ItemInstance): boolean {
    const def = ITEMS[item.id];
    if (def.stack && this.items.some((p) => p.item.id === item.id && p.item.qty < def.stack!)) return true;
    return !!this.findSpace(item);
  }

  place(item: ItemInstance, x: number, y: number, rot: boolean): boolean {
    if (!this.fits(item, x, y, rot)) return false;
    this.items.push({ item, x, y, rot });
    return true;
  }

  /** Merges into existing stacks first, then finds free space. Returns leftover qty. */
  add(item: ItemInstance): ItemInstance | null {
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

  /** Replaces the contents. Returns whatever no longer fits (a smaller grid than when it was saved). */
  load(data: { items: (ItemInstance & { x: number; y: number; rot: boolean })[] }): ItemInstance[] {
    this.items.length = 0;
    const overflow: ItemInstance[] = [];
    for (const d of data.items ?? []) {
      const { x, y, rot, ...raw } = d;
      const item = sanitizeItem(raw);
      if (!item) continue;
      if (this.place(item, x, y, rot)) continue;
      const left = this.add(item);
      if (left) overflow.push(left);
    }
    return overflow;
  }
}

export type SerializedInventory = { slots: Record<string, ItemInstance | null>; active: Slot | null; containers: ReturnType<Container['serialize']>[] };

/** Everything the player carries. */
export class PlayerInventory {
  slots: Record<Slot, ItemInstance | null> = EMPTY_SLOTS();
  jacket = new Container('jacket', 'Jacket', 4, 3);
  pants = new Container('pants', 'Trousers', 4, 2);
  /** the pouch: ten places for dog tags taken off other people, and for nothing else */
  tags = Object.assign(new Container('tags', 'Dog tags', 5, 2), { only: 'dogtag' });
  /** the survivor's own dog tag, round their neck */
  neck: ItemInstance | null = null;
  /** which slot is in hands: weapon/melee, or null = bare hands */
  active: Slot | null = null;
  private gearCargo = new Map<string, Container>();

  /** cargo grid of a worn item (a live view of the item's own contents) */
  cargoOf(item: ItemInstance): Container | null {
    const d = ITEMS[item.id];
    if (!d.wear?.cargo) return null;
    item.cargo ??= [];
    let c = this.gearCargo.get(item.uid);
    if (!c || c.items !== item.cargo) {
      c = new Container(`gear:${item.uid}`, d.name, d.wear.cargo[0], d.wear.cargo[1], item.cargo);
      this.gearCargo.set(item.uid, c);
    }
    return c;
  }

  /** every grid the player can put things in right now: the tag pouch (which takes only tags), pockets, then vest and bag */
  get containers(): Container[] {
    const out = [this.tags, this.jacket, this.pants];
    for (const s of GEAR_SLOTS) {
      const it = this.slots[s];
      const c = it ? this.cargoOf(it) : null;
      if (c) out.push(c);
    }
    return out;
  }

  clear() {
    this.slots = EMPTY_SLOTS();
    this.active = null;
    this.jacket.items = [];
    this.pants.items = [];
    this.tags.items = [];
    this.neck = null;
    this.gearCargo.clear();
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
   * Every top-level item carried: worn / slung things (bags keep their contents), pocket
   * contents and the tags in the pouch. Not the survivor's own tag: that is not carried, and
   * is never among what is dropped.
   */
  topLevel(): ItemInstance[] {
    const out: ItemInstance[] = [];
    for (const s of ALL_SLOTS) {
      const it = this.slots[s];
      if (it) out.push(it);
    }
    for (const c of [this.tags, this.jacket, this.pants]) for (const p of c.items) out.push(p.item);
    return out;
  }

  /** value of a worn-gear effect, e.g. the vest's torso armour */
  wear<K extends 'armor' | 'head' | 'fall' | 'fist' | 'thirst'>(key: K): number[] {
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
    return { slots: { ...this.slots, neck: this.neck }, active: this.active, containers: [this.tags, this.jacket, this.pants].map((c) => c.serialize()) };
  }

  /** Returns items that no longer fit anywhere (the caller drops them at the player's feet). */
  load(d: SerializedInventory): ItemInstance[] {
    const raw = d.slots as Record<string, ItemInstance | null>;
    this.slots = EMPTY_SLOTS();
    this.gearCargo.clear();
    const overflow: ItemInstance[] = [];
    // migrate saves from the single 'shoulder' slot layout
    if (raw.shoulder && !raw.primary) raw.primary = raw.shoulder;
    for (const s of ALL_SLOTS) {
      const it = raw[s] ? sanitizeItem(raw[s]!) : null;
      if (!it) continue;
      if (ITEMS[it.id].slot === SLOT_KIND[s]) this.slots[s] = it;
      else overflow.push(it);
    }
    this.active = null;
    const neck = raw.neck ? sanitizeItem(raw.neck) : null;
    this.neck = neck?.id === 'dogtag' ? neck : null;
    this.tags.items = [];
    for (const cd of d.containers ?? []) {
      const c = cd.id === 'jacket' ? this.jacket : cd.id === 'pants' ? this.pants : cd.id === 'tags' ? this.tags : null;
      if (c) overflow.push(...c.load(cd as never));
    }
    // things that fell out of a shrunken pocket go wherever there is room
    return overflow.map((it) => this.add(it)).filter((it): it is ItemInstance => !!it);
  }
}
