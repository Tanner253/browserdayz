// A store finish put on one gun (2026-10-22), Rust's way. The owner: "we need a button for apply cosmetic so when a
// cosmetic owner hit it it applies their cosmetic ... the apply should stick with the weapon on the server so if its
// dropped or looted it carries over, like rust" and "the # doesnt really matter": gold or not.
//
// A player's game says what it carries ('me') and the server keeps that copy, so a finish on a gun is the server's
// own: it keeps which gun, by its uid, wears which finish, and writes that on the gun wherever it reads one in (a
// player's pockets, a box, the ground, what was kept over a restart). A game's own word on a finish is never taken
// (the owner: "why would we allow the client to have ANY authority?"). A buyer may plate as many guns of that kind as
// they like; a gun keeps it until it is gone.

import { KNIVES, SHOP, formOf, lookOf, skinFits, type ItemId } from '../api/_lib/shop-items';
import type { ItemInstance } from '../src/sim/items';
import type { SerializedInventory } from '../src/sim/inventory';

interface Plate {
  /** the shop's item id ('deagle_gold') */
  f?: ItemId;
  /** what it was made, for a knife made another kind of knife (the shop's 'karambit') */
  form?: ItemId;
  /** when the gun was last read in somewhere: a gun not seen for FORGET_MS is gone (its body rotted, its pack lost) */
  seen: number;
}

const FORGET_MS = 60 * 24 * 3600_000;
/** the kinds a knife can only be made at the store (the karambit) */
const FORMS = new Set(Object.values(SHOP).map((i) => i.skin?.form).filter((f): f is string => !!f));
const plates = new Map<string, Plate>();

/** everything in a set of pockets, and in what is in them (index.ts's `things`, here so that this file stands alone) */
function* all(inv: SerializedInventory | null): Generator<ItemInstance> {
  const walk = function* (it: ItemInstance | null | undefined): Generator<ItemInstance> {
    if (!it) return;
    yield it;
    for (const p of it.cargo ?? []) yield* walk(p.item);
  };
  if (!inv) return;
  for (const it of Object.values(inv.slots)) yield* walk(it);
  for (const cont of inv.containers) for (const it of cont.items) yield* walk(it);
}

export const plating = {
  /** a thing, and everything in it, made to wear what the record says and nothing else */
  stamp<T extends ItemInstance | null>(it: T, now = Date.now()): T {
    if (!it) return it;
    const p = plates.get(it.uid);
    delete it.finish;
    // (a knife made a karambit is one, wherever it is read in; one this has no record of is the knife it was, as a game's
    // own word on a finish is not taken)
    const form = p?.form && formOf(p.form);
    if (p && form && KNIVES.includes(it.id)) {
      it.id = form;
      p.seen = now;
    } else if (FORMS.has(it.id)) it.id = 'knife';
    // (only on a gun of the kind it was put on, or any knife for a knife's: a uid said of another thing is not plated by it)
    const skin = p?.f && SHOP[p.f]?.skin;
    if (p?.f && skin && skinFits(skin.gun, it.id)) {
      it.finish = p.f;
      p.seen = now;
    }
    for (const c of it.cargo ?? []) plating.stamp(c.item, now);
    return it;
  },
  stampAll<T extends SerializedInventory | null>(inv: T): T {
    if (inv) for (const it of [...Object.values(inv.slots), ...inv.containers.flatMap((c) => c.items)]) plating.stamp(it);
    return inv;
  },
  /**
   * A player asks for their finish on a gun they carry (C2S 'finish').
   * @param skin the finish of theirs for a gun of that kind (perks.ts), or null
   * @returns the gun, plated (and which of theirs it was), or why not
   */
  apply(inv: SerializedInventory | null, uid: unknown, skin: (gun: string) => ItemId | null): { it: ItemInstance; f: ItemId } | string {
    if (typeof uid !== 'string') return 'No such thing';
    const it = [...all(inv)].find((t) => t.uid === uid);
    if (!it) return 'Carry it first';
    const f = skin(it.id);
    if (!f) return 'You have no finish for that';
    const form = formOf(f);
    if (form ? it.id === form : it.finish === f) return form ? 'It is one already' : 'It wears it already';
    const p = plates.get(uid) ?? { seen: Date.now() };
    if (form) p.form = f;
    else p.f = f;
    p.seen = Date.now();
    plates.set(uid, p);
    return { it: plating.stamp(it), f };
  },
  /**
   * The look of what is in their hands, if it is plated ('gold', 'nickel'). Their game says which gun it is (`u`: the
   * server's copy of their pockets does not say what is held), and the server's copy says whether it is plated.
   */
  held(inv: SerializedInventory | null, w: string | null, u: unknown): string | undefined {
    if (typeof u !== 'string' || !w) return undefined;
    for (const it of all(inv)) if (it.uid === u) return (it.id === w && lookOf(it.finish)) || undefined;
    return undefined;
  },
  /** what is kept over a restart (keep.ts) */
  keep(now = Date.now()): [string, Plate][] {
    for (const [uid, p] of plates) if (now - p.seen > FORGET_MS) plates.delete(uid);
    return [...plates];
  },
  /** read back before anything kept is (a copy that turns up late adds what is not here) */
  restore(kept?: [string, Plate][]) {
    for (const [uid, p] of kept ?? []) {
      if (typeof uid !== 'string' || plates.has(uid) || !p) continue;
      const f = p.f && SHOP[p.f]?.skin ? p.f : undefined, form = p.form && SHOP[p.form]?.skin ? p.form : undefined;
      if (f || form) plates.set(uid, { ...(f ? { f } : {}), ...(form ? { form } : {}), seen: Number(p.seen) || Date.now() });
    }
  },
  /** for a test */
  size: () => plates.size,
};
