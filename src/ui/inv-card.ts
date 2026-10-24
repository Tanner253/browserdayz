// What a thing is, and what to do with it (idea 15 of Fettah, a contributor, 2026-10-18). It showed three ways that could say different things:
// the card by the pointer (what it is, and the keys), the right-click menu (the deeds, without their keys) and the
// inspector under the grids (the full stats, and the deeds again). Fettah: the card is "an info card", with all the
// inspector had and no keys; the right button hides the info and shows the deeds, each with its keys at the right
// ("Eat it now ··· Dbl-click"), so a click on a row teaches the key. Every deed and every key comes from the one list
// made here (`rows`). The inspector is left only on a phone, which hovers on nothing and has no right button.

import { ITEMS, type ItemInstance } from '../sim/items';
import { cookable, mealOf } from '../sim/cooking';
import type { Act } from './act-icons';

type Def = (typeof ITEMS)[string];

/** something that can be done with a thing where it lies: a row on the menu (and, on a phone, a button in the inspector) */
export interface Action {
  label: string;
  /** its symbol before the words: src/ui/act-icons.ts */
  icon: Act | { kind: string };
  /** what it does, the same word a key's deed carries (`Deed`): how a row is found for each key */
  id?: string;
  /** drawn in the danger colour: what loses the thing (Drop) */
  danger?: boolean;
  run: () => void;
  primary?: boolean;
}

/** what one of the clicks does with a thing where it lies (what to call it, and which row it is), or why it does nothing */
export type Deed = { label: string; id: string; icon: Act | { kind: string }; run: () => void } | { why: string };

/** a row on the menu: a deed, and the keys that do the same */
export type Row = Action & { keys: string[] };

/** the keys, as the menu writes them, in the order a row lists them */
export const KEY = { use: 'Dbl-click', across: 'Ctrl-click', wield: 'Alt-click', quick: 'Shift-click', drop: 'G' } as const;

/**
 * Every deed with the keys that do it: what the menu lists, each key on the row whose deed it does. A key whose deed
 * has no row of its own is given one (before Drop), so no key is ever left untold; a key that does nothing here is
 * left out. A row keeps its place; the keys keep the order given.
 */
export function rows(acts: Action[], keys: [string, Deed][]): Row[] {
  const out: Row[] = acts.map((a) => ({ ...a, keys: [] }));
  for (const [key, deed] of keys) {
    if (!('label' in deed)) continue;
    let r = out.find((a) => a.id === deed.id);
    if (!r) {
      r = { label: deed.label, icon: deed.icon, id: deed.id, run: deed.run, keys: [] };
      const at = out.findIndex((a) => a.danger);
      out.splice(at < 0 ? out.length : at, 0, r);
    }
    if (!r.keys.includes(key)) r.keys.push(key);
  }
  return out;
}

/** a line of the card: what is said, its value, and the tag whose clock it is (ticked by `tickTags`) */
export interface Stat { k: string; v: string; clock?: string }

const pct = (k: number) => Math.round(k * 100);

/** the kinds of thing, in plain words (the rules' own names for them are not all words a player uses) */
const KIND: Record<string, string> = { weapon: 'Gun', ammo: 'Ammunition', magazine: 'Magazine', food: 'Food', drink: 'Drink', medical: 'Medical', melee: 'Hand weapon', tool: 'Tool', misc: 'Gear', stash: 'Storage', attachment: 'Gun part', clothing: 'Clothing' };
export const kindOf = (d: Def) => KIND[d.category] ?? d.category;

/** what does harm, said in red (2026-10-24: "it should be red too") */
const signed = (v: number, what: string) => (v > 0 ? `+${v} ${what}` : `<b class="bad">−${Math.abs(v)} ${what}</b>`);

/**
 * What a thing does, in a few words, read off the rules so that it is never out of step with them: the line under its
 * name. Food that cooks says what it gives as it is now, raw, cooked, burned or rotten (`it`): not what a cooked one
 * gives (the owner, 2026-10-24: "the raw meat says to the user that it gives them + energy").
 */
export function does(d: Def, it?: ItemInstance): string {
  const o: string[] = [];
  const u = d.use, meal = it && cookable(it) ? mealOf(it, Date.now() / 1000) : null;
  const health = meal ? meal.health : u?.health, energy = meal ? meal.energy : u?.energy, water = meal ? meal.water : u?.water;
  if (health) o.push(signed(health, 'health'));
  if (u?.stopBleed) o.push('stops bleeding');
  if (u?.splint) o.push('sets a broken leg');
  if (u?.blood) o.push(`+${u.blood} ml of blood`);
  if (energy) o.push(signed(energy, 'energy'));
  if (water) o.push(signed(water, 'water'));
  if (meal?.sick) o.push(`<b class="bad">${meal.sick >= 1 ? 'food poisoning' : `${Math.round(meal.sick * 100)}% chance of food poisoning`}</b>`);
  if (u?.stamina) o.push('fills your stamina');
  if (u?.boost) o.push(`${u.boost} s in which nothing costs breath`);
  if (u?.sips) o.push(`${u.sips} drinks, filled again at a well`);
  if (d.look) o.push(`brings things ${Math.round(1 / d.look)}× closer`);
  if (d.throw) o.push(`thrown: it goes off ${d.throw.fuse} s after`);
  if (d.call) o.push('calls a supply drop down, under open sky');
  if (d.weapon) o.push(`fires ${ITEMS[d.weapon.ammo]?.name ?? d.weapon.ammo}`);
  if (d.mag) o.push(`holds ${d.mag.capacity} × ${ITEMS[d.mag.ammo]?.name ?? d.mag.ammo}`);
  if (d.melee) o.push(`hits for ${d.melee.damage}`);
  if (d.open) o.push(`${d.open.qty} × ${ITEMS[d.open.gives]?.name ?? d.open.gives} inside`);
  if (d.wear?.cargo) o.push(`${d.wear.cargo[0]}×${d.wear.cargo[1]} of room in it`);
  if (d.wear?.armor) o.push(`chest hits −${pct(1 - d.wear.armor)}%`);
  if (d.wear?.head) o.push(`head hits −${pct(1 - d.wear.head)}%`);
  if (d.wear?.fall) o.push(`falls hurt −${pct(1 - d.wear.fall)}%`);
  if (d.wear?.fist) o.push(`punches +${d.wear.fist}`);
  if (d.wear?.gas) o.push('keeps the gas out');
  if (d.stash) o.push(`${d.stash[0]}×${d.stash[1]} of room in it`);
  if (d.attach?.quiet) o.push('quiets the shot');
  if (d.attach?.recoil) o.push(`kick −${pct(1 - d.attach.recoil)}%`);
  if (d.attach?.ergo) o.push(`handling ${d.attach.ergo > 0 ? '+' : '−'}${Math.abs(d.attach.ergo)}`);
  return o.join(' · ');
}
