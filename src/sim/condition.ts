// How worn a thing that is worn is: DayZ's five states, kept as `hp` on it (1 when not said: pristine). The owner,
// 2026-10-24: "those clothes items should be items we bring into the game ... like dayz has tiers of clothing items ...
// durability color etc". A hit wears what covers the place it lands; a ruined piece does nothing it did (its armour,
// its pads, its knuckles), and is cut into bandages with a blade (Game.cutUp), as DayZ cuts clothes into rags.

import { ITEMS, healthOf, ruined, type ItemInstance, type Slot } from './items';
import type { HitZone } from './combat';

export { STATES, healthOf, ruined, stateOf } from './items';

/** what is worn over each place a hit lands (src/sim/combat.ts) */
export const COVERS: Record<HitZone, Slot[]> = {
  head: ['head', 'face', 'eyes'],
  torso: ['vest', 'top', 'back'],
  arms: ['top', 'hands'],
  legs: ['legs', 'feet'],
};

/** what a hit of this much takes off each piece over where it landed: a hundred of damage is a whole piece (DayZ's clothes go in three or four rounds) */
export const WEAR_PER_DAMAGE = 1 / 100;

/** Wears what covers the place a hit landed. Returns the pieces that were ruined by it. */
export function wearOut(slots: Partial<Record<Slot, ItemInstance | null>>, zone: HitZone, damage: number): ItemInstance[] {
  const out: ItemInstance[] = [];
  for (const s of COVERS[zone] ?? []) {
    const it = slots[s];
    if (!it || ITEMS[it.id]?.category !== 'clothing' || ruined(it)) continue;
    const hp = Math.max(0, healthOf(it) - damage * WEAR_PER_DAMAGE);
    it.hp = Math.round(hp * 1000) / 1000;
    if (it.hp <= 0) out.push(it);
  }
  return out;
}

/** how many bandages a piece is cut into: one for every two cells it takes up, at least one; half as many from a ruined one */
export function bandagesFrom(it: ItemInstance): number {
  const d = ITEMS[it.id];
  return Math.max(1, Math.floor((d.w * d.h) / 2 / (ruined(it) ? 2 : 1)));
}

/** whether it can be cut up: a piece of clothing with nothing in it, and a blade carried to do it with */
// (every sharp thing, the owner, 2026-10-27: "ensure all sharp objects can cut clothing like hatchet and machete etc")
export const BLADES = ['knife', 'hunting_knife', 'bayonet', 'karambit', 'bone_knife', 'machete', 'hatchet', 'stone_hatchet', 'felling_axe', 'hand_saw'];
export const cuttable = (it: ItemInstance) => ITEMS[it.id]?.category === 'clothing' && !!ITEMS[it.id]?.dress && !it.cargo?.length;
