// The forge (2026-10-25, plan-crafting, ours: "an oil drum lined with stone, laid in your claim; feed it wood, it smelts
// while it burns, even while you are away"). Its store takes wood and metal fragments; while it has fragments to smelt
// and wood to burn it burns, ten fragments and half a minute of fire making an iron bar (v3: "10 fragments make 1 bar,
// with time and fuel"), and every log it burns leaves charcoal. Run by the server for every forge there is, whoever is
// near (and by the game, played alone, for its own). An armoured wall's six bars are sixty fragments and a log and a half.

import { Container } from '../inventory';
import { makeItem, ITEMS, type ItemInstance } from '../items';
import type { StoredItem } from '../../net/protocol';
import { MAT, PER_BAR } from './materials';

export const FORGE = {
  /** seconds of fire a bar takes, and the fragments it takes */
  smelt: 30,
  frags: PER_BAR,
  /** seconds each fuel burns, and the charcoal it leaves */
  // (planks too, a short fire each: the owner, 2026-10-26, "it won't fire with planks?")
  fuel: { log: 120, firewood: 60, coal: 40, planks: 30 } as Record<string, number>,
  ash: { log: 2, firewood: 1 } as Record<string, number>,
};

/** a forge's fire: seconds left of what it is burning (and what that was), and seconds into the bar it is making */
export interface Fire {
  burn: number;
  of: string;
  done: number;
}

export const cold = (): Fire => ({ burn: 0, of: '', done: 0 });
export const lit = (f: Fire) => f.burn > 0;

const count = (items: StoredItem[], id: string) => items.reduce((n, it) => n + (it.id === id ? it.qty : 0), 0);

/** `n` of a kind taken out of a store (the last piles first) */
function take(items: StoredItem[], id: string, n: number) {
  for (let i = items.length - 1; i >= 0 && n > 0; i--) {
    if (items[i].id !== id) continue;
    const k = Math.min(n, items[i].qty);
    items[i].qty -= k;
    n -= k;
    if (items[i].qty <= 0) items.splice(i, 1);
  }
}

/** `n` of a kind put into a store of `w` by `h`, onto its piles first; false when there is no room for all of it */
function put(items: StoredItem[], w: number, h: number, id: string, n: number): boolean {
  const max = ITEMS[id].stack ?? 1;
  for (const it of items) {
    if (it.id !== id || it.qty >= max) continue;
    const k = Math.min(n, max - it.qty);
    it.qty += k;
    n -= k;
  }
  if (n <= 0) return true;
  const c = new Container('forge', 'Forge', w, h, items.map((it) => ({ item: it as ItemInstance, x: it.x, y: it.y, rot: !!it.rot })), false);
  while (n > 0) {
    const it = makeItem(id, Math.min(max, n)), at = c.findSpace(it);
    if (!at) return false;
    c.place(it, at.x, at.y, at.rot);
    items.push({ ...it, x: at.x, y: at.y, rot: at.rot });
    n -= it.qty;
  }
  return true;
}

/**
 * A forge `dt` seconds on: what it burns, what it makes. Lights itself when it has fragments enough for a bar and something
 * to burn; goes out when what it burns is spent and it has nothing more to smelt (or nothing to burn). The store is
 * changed in place; true when anything in it changed.
 */
export function forgeStep(f: Fire, items: StoredItem[], w: number, h: number, dt: number): boolean {
  let changed = false;
  const fuel = () => Object.keys(FORGE.fuel).find((id) => count(items, id) > 0);
  if (f.burn <= 0) {
    const next = count(items, MAT.frags) >= FORGE.frags ? fuel() : undefined;
    if (!next) return false;
    take(items, next, 1);
    f.burn = FORGE.fuel[next];
    f.of = next;
    changed = true;
  }
  f.burn -= dt;
  if (count(items, MAT.frags) >= FORGE.frags && (f.done += dt) >= FORGE.smelt) {
    // (out of room for the bar: it waits, hot, until there is)
    if (put(items, w, h, MAT.bar, 1)) {
      take(items, MAT.frags, FORGE.frags);
      f.done = 0;
      changed = true;
    } else f.done = FORGE.smelt;
  }
  if (f.burn <= 0) {
    // (what it burned is spent: its charcoal, and the next if there are still fragments to smelt)
    if (FORGE.ash[f.of]) changed = put(items, w, h, MAT.coal, FORGE.ash[f.of]) || changed;
    f.burn = 0;
    if (count(items, MAT.frags) < FORGE.frags) f.done = 0;
  }
  return changed;
}
