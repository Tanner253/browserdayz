// Three of an admin's tools that are about what is carried (2026-10-13: "admins should have infinite weight
// toggle", "admins should have reload mags button and no ammo consumtion otpion for infinte ammo"):
//
//   weightless – a power, as god mode is: what is carried weighs nothing, and so never slows whoever carries it.
//   endless    – a power: a shot takes no round out of the gun it is fired from, so the gun never runs dry.
//   refill     – done once, not a power: every magazine and every gun carried is full.
//
// What each one comes to is decided here, in functions that need no game and no server, so that both ends go by
// the same rule and it can be tried without either (test/powers.test.ts). Who may have them is the server's to say
// (`setPower` and `carryOrder` in server/index.ts); the game does only what the server tells it.
//
// What the server makes of them. It counts rounds nowhere and weighs nothing: it never has. So neither power is
// anything it sees, and nothing here makes a thing: a refill leaves every gun and every magazine the very thing it
// was (the same number), with more rounds in it, and rounds are not among what the server's checks ask after (they
// ask after guns, blades, armour and the keycard: `GUARDED` in server/index.ts).

import { ITEMS, capacityOf, type ItemInstance } from './items';

/** How many rounds a shot takes out of the gun it is fired from: one, or none with endless ammunition on. */
export const roundsSpent = (endless: boolean): 0 | 1 => (endless ? 0 : 1);

/**
 * What the legs are told is carried, kg: what it weighs, or nothing with the power on. (A load costs breath, and a very great one pace:
 * src/sim/load.ts. With nothing to weigh, an admin goes
 * as anybody goes who carries nothing, and no faster.)
 */
export const weightFelt = (kg: number, weightless: boolean): number => (weightless ? 0 : kg);

/** what a refill came to: how many magazines and how many guns took rounds, how many rounds that was, and how many magazines and guns there were to look at */
export interface Refilled {
  mags: number;
  guns: number;
  rounds: number;
  of: number;
}

/**
 * Every magazine and every gun among these things is filled, wherever it is: the things themselves, what is in
 * them, and what is in that (a jacket's pockets, a pack, a bag in a pack). In place: each stays the thing it was.
 *
 * - A magazine: as many rounds as it holds.
 * - A gun fed by a magazine: the magazine in it full, and one more in the chamber. One with no magazine in it is
 *   given the one it is made with first, as `loadGun` gives it: a gun somebody is handed bare is a gun that fires
 *   after this.
 * - A gun fed from its own tube: the tube full.
 *
 * Loose rounds and boxes of them are left as they are: nothing is made but what goes into a magazine or a gun.
 * @param things what is carried, top down (`carriedOf` for an inventory as it is kept and sent; the game hands over its own)
 */
export function refill(things: Iterable<ItemInstance | null | undefined>): Refilled {
  const out: Refilled = { mags: 0, guns: 0, rounds: 0, of: 0 };
  const walk = (it: ItemInstance | null | undefined, depth: number) => {
    const def = it ? ITEMS[it.id] : undefined;
    // (no deeper than anything is ever kept: a list that leads back into itself is not followed for ever)
    if (!it || !def || depth > 8) return;
    if (def.mag) {
      const room = def.mag.capacity - (it.rounds ?? 0);
      out.of++;
      if (room > 0) {
        it.rounds = def.mag.capacity;
        out.mags++;
        out.rounds += room;
      }
    }
    if (def.weapon) {
      const bare = !!def.weapon.mag && !it.mag;
      if (bare) it.mag = def.weapon.mag;
      const room = capacityOf(it) - (it.loaded ?? 0);
      out.of++;
      if (room > 0 || bare) {
        it.loaded = Math.max(it.loaded ?? 0, capacityOf(it));
        out.guns++;
        out.rounds += Math.max(0, room);
      }
    }
    for (const p of it.cargo ?? []) walk(p?.item, depth + 1);
  };
  for (const it of things) walk(it, 0);
  return out;
}

/** Everything in an inventory as it is kept and sent, top down: what is worn, slung and holstered, and what lies in the grids that are no thing's (the tag pouch). */
export function carriedOf(inv: { slots: Record<string, ItemInstance | null>; containers: { items: ItemInstance[] }[] } | null | undefined): ItemInstance[] {
  if (!inv) return [];
  return [...Object.values(inv.slots ?? {}), ...(inv.containers ?? []).flatMap((c) => c.items ?? [])].filter((it): it is ItemInstance => !!it);
}

/** What a refill did, in words: "6 magazines and 2 guns filled"; '' when nothing took a round. */
export function refilledWords(r: Refilled): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const parts = [...(r.mags ? [n(r.mags, 'magazine')] : []), ...(r.guns ? [n(r.guns, 'gun')] : [])];
  return parts.length ? `${parts.join(' and ')} filled` : '';
}

/**
 * The two powers as they are spoken of: the order each is given by, what it is called, and what it does, said to
 * whoever has it and of somebody else. One list, read by the server's replies, the panel's switches and the guide.
 */
export const CARRY_POWERS = {
  weightless: { order: 'weightless', name: 'weightless', label: 'Weightless', mine: 'What you carry weighs nothing: however much it is, it takes nothing off your sprint and never slows you', theirs: 'What they carry weighs nothing: however much it is, it takes nothing off their sprint and never slows them', on: 'What you carry weighs nothing now: however much it is, it never slows you.', off: 'What you carry weighs what it weighs again.' },
  endless: { order: 'ammo', name: 'endless ammunition', label: 'Endless ammunition', mine: 'Firing takes no round out of your gun: it never runs dry (an empty gun is still empty: Refill fills it)', theirs: 'Firing takes no round out of their gun: it never runs dry', on: 'Firing takes no round out of your gun now: it never runs dry. (An empty gun is still empty: /refill fills it.)', off: 'Your gun spends its rounds again.' },
} as const;
export type CarryPower = keyof typeof CARRY_POWERS;
