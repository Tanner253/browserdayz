// Recyclers (progression v3, the owner's yes 2026-10-25: "Recyclers: four, at the works (Zavod), the army camp, the fort
// and the chemical works, plus one at the trader camp. Each is on its own layer, so no world resets. A run takes a minute
// and is loud"; "Every component you don't need goes in a recycler for fragments and scrap, so nothing found is
// worthless"). Rust's: a machine anybody may use, its store open to whoever is there; switched on, it breaks what is in
// it down a thing at a time, into fragments, scrap, rags and now and then a steel plate, and is heard far off while it
// runs. What each thing gives is data, here; the server runs every recycler, the game played alone its own.

import { RNG } from '../../core/noise';
import { Container } from '../inventory';
import { ITEMS, makeItem, type ItemInstance } from '../items';
import type { StoredItem } from '../../net/protocol';
import type { World } from '../../world/worldgen';
import { castleLoose } from '../castle/ask';
import { castleClear, castleHomes } from '../castle/loot';
import { castleLocal } from '../castle/plan';
import { MAT } from './materials';
import { RECIPES, RAGS, optionsOf } from './recipes';
import { roomOn, type LayerWorld } from './layer';
import type { Camp } from '../camp';

export const RECYCLE = {
  /** seconds a thing takes (a store of ten, a minute and a half) */
  each: 6,
  /** its store */
  store: [10, 6] as [number, number],
  /** how far off one running is heard, m */
  heard: 90,
  /** its size, m: across its front and from front to back (its model's z and x: its front is its +x) */
  w: 1.6,
  l: 2.0,
  model: 'recycler',
};

type Gives = [string, number][];

/** what a found part gives (v3: "Every component you don't need goes in a recycler for fragments and scrap") */
const PARTS: Record<string, Gives> = {
  metal_pipe: [[MAT.frags, 15], [MAT.scrap, 3]],
  spring: [[MAT.frags, 10], [MAT.scrap, 4]],
  gun_body_pistol: [[MAT.frags, 25], [MAT.scrap, 10]],
  gun_body_rifle: [[MAT.frags, 40], [MAT.scrap, 20]],
  sheet_metal: [[MAT.frags, 15]],
  tin_can: [[MAT.frags, 2]],
  hardware: [[MAT.frags, 20], [MAT.scrap, 8]],
  jerrycan: [[MAT.frags, 8]],
  code_lock: [[MAT.frags, 20], [MAT.scrap, 10], ['spring', 1]],
};
/** never put through: the metals themselves, nails (looted, and wanted), what is eaten or bled, the Zone's own */
const NEVER = new Set([MAT.scrap, MAT.frags, MAT.bar, MAT.coal, 'nails', 'dogtag', 'keycard', 'gunpowder', 'rags']);

/**
 * What one of a thing breaks down into (empty: it is not taken). A part, by its own list; a thing that is made, half of
 * what it is made of (a part a recipe takes one of: one time in two); a found gun or blade, fragments by its weight,
 * scrap, and now and then a spring or a pipe; clothes, rags; armour, fragments and now and then a steel plate.
 */
export function recycles(id: string, rnd: () => number = Math.random): Gives {
  const def = ITEMS[id];
  if (!def || NEVER.has(id)) return [];
  if (PARTS[id]) return PARTS[id].filter(([x]) => ITEMS[x]);
  const made = RECIPES.find((r) => r.makes === id && r.at === 'bench');
  if (made) {
    const out: Gives = [];
    for (const need of made.needs) {
      if (need.keep) continue;
      const opt = optionsOf(need)[0], half = Math.floor(need.n / 2) / Math.max(1, made.qty);
      if (half >= 1) out.push([opt, Math.floor(half)]);
      else if (need.n === 1 && made.qty === 1 && rnd() < 0.5) out.push([opt, 1]);
    }
    return out;
  }
  if (def.weapon || def.melee) {
    const out: Gives = [[MAT.frags, Math.max(5, Math.round(def.weight * 12))], [MAT.scrap, Math.max(2, Math.round((def.worth ?? 6) / 4))]];
    if (def.weapon && rnd() < 0.35) out.push(['spring', 1]);
    if (def.weapon && rnd() < 0.25) out.push(['metal_pipe', 1]);
    return out;
  }
  if (def.wear?.armor !== undefined) {
    const out: Gives = [[MAT.frags, Math.max(10, Math.round(def.weight * 8))], ['rags', 2]];
    if (ITEMS.steel_plate && def.weight >= 3 && rnd() < 0.3) out.push(['steel_plate', 1]);
    return out;
  }
  if (def.category === 'clothing') return [['rags', RAGS[id] ?? 2]];
  if (def.category === 'attachment') return [[MAT.frags, Math.max(5, Math.round(def.weight * 40))], [MAT.scrap, Math.max(1, Math.round((def.worth ?? 4) / 4))]];
  if (def.category === 'tool' && def.weight >= 0.2) return [[MAT.frags, Math.max(3, Math.round(def.weight * 10))]];
  return [];
}

/** whether a thing goes through */
export const recyclable = (it: ItemInstance) => !it.cargo?.length && recycles(it.id, () => 1).length > 0;

/** a recycler's run: on or off, and seconds into the thing it is at */
export interface Run {
  on: boolean;
  done: number;
}

/**
 * A recycler `dt` seconds on: it takes the first thing that goes through (one of a pile at a time), and when its time is
 * up puts what it gives into its store, onto its piles first; it switches itself off when nothing is left to go through
 * or there is no room for what comes out. The store is changed in place; true when anything in it changed.
 */
export function recycleStep(run: Run, items: StoredItem[], dt: number, rnd: () => number = Math.random): boolean {
  if (!run.on) return false;
  const i = items.findIndex((it) => recyclable(it as ItemInstance));
  if (i < 0) {
    run.on = false;
    run.done = 0;
    return true;
  }
  if ((run.done += dt) < RECYCLE.each) return false;
  run.done = 0;
  const it = items[i], gives = recycles(it.id, rnd);
  // (what comes out laid in first, in a copy: no room, and nothing is taken)
  const [w, h] = RECYCLE.store, out = items.map((x) => ({ ...x }));
  if (ITEMS[it.id].stack && it.qty > 1) out[i].qty -= 1;
  else out.splice(i, 1);
  for (const [id, n] of gives) {
    if (!put(out, w, h, id, n)) {
      run.on = false;
      return true;
    }
  }
  items.length = 0;
  items.push(...out);
  return true;
}

function put(items: StoredItem[], w: number, h: number, id: string, n: number): boolean {
  const max = ITEMS[id].stack ?? 1;
  for (const it of items) {
    if (it.id !== id || it.qty >= max) continue;
    const k = Math.min(n, max - it.qty);
    it.qty += k;
    n -= k;
  }
  if (n <= 0) return true;
  const c = new Container('recycler', 'Recycler', w, h, items.map((it) => ({ item: it as ItemInstance, x: it.x, y: it.y, rot: !!it.rot })), false);
  while (n > 0) {
    const it = makeItem(id, Math.min(max, n)), at = c.findSpace(it);
    if (!at) return false;
    c.place(it, at.x, at.y, at.rot);
    items.push({ ...it, x: at.x, y: at.y, rot: at.rot });
    n -= it.qty;
  }
  return true;
}

// ---------------------------------------------------------------- where they stand

export interface Recycler {
  /** where it is, to be said ("the recycler at Zavod") */
  at: string;
  x: number;
  y: number;
  z: number;
  /** which way its front faces (its model's +x: drawn turned by FACE_TURN, src/sim/camp.ts) */
  rot: number;
}

const SEED = 0x2ec7c1;

/** the recyclers' layer: Zavod, the army camp, the fort, the chemical works, the trader camp; the same for the game and the server */
export function recyclerLayer(world: LayerWorld & Pick<World, 'sites' | 'towns' | 'castle'>, camp: Camp | null): Recycler[] {
  const room = roomOn(world, true), rng = new RNG(SEED), out: Recycler[] = [];
  // (keep clear of the camp's stalls and its own recycler: laid before these)
  for (const s of camp?.stalls ?? []) room.stand(s.x, s.z, 2.5);
  const near = (at: string, cx: number, cz: number, from = 8) => {
    for (let d = from; d < 80; d += 3) {
      const a0 = rng.range(0, Math.PI * 2);
      for (let k = 0; k < 10; k++) {
        const a = a0 + (k / 10) * Math.PI * 2, x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d, rot = Math.atan2(cx - x, cz - z);
        const y = room.fit(x, z, RECYCLE.l, RECYCLE.w, rot, { margin: 1.2, road: 0.5, level: 0.45, sink: 0.05 });
        if (y === null) continue;
        room.stand(x, z, 2.5);
        out.push({ at, x, y, z, rot });
        return;
      }
    }
  };
  const town = (world.towns ?? []).find((t) => t.town.name === 'Zavod')?.town;
  if (town) near('Zavod', town.x, town.z, 14);
  const site = (k: string) => world.sites.find((s) => s.kind === k);
  const army = site('tents');
  if (army) near('the army camp', army.x, army.z, 10);
  const fort = world.castle && fortSpot(world, room);
  if (fort) out.push(fort);
  const works = site('works');
  if (works) near('the chemical works', works.x, works.z, 12);
  if (camp?.recycler) out.push({ at: 'the trader camp', ...camp.recycler });
  return out;
}

/** at the fort: on the open ground before its gate, clear of every stone of the plan, facing the gate */
function fortSpot(world: Pick<World, 'castle'>, room: ReturnType<typeof roomOn>): Recycler | null {
  const p = world.castle!, loose = castleLoose(p), homes = castleHomes(p, loose, room.ground), gate = homes[homes.length - 1];
  const spots = [...(gate.inside ?? [])].sort((a, b) => Math.hypot(b[0] - gate.x, b[2] - gate.z) - Math.hypot(a[0] - gate.x, a[2] - gate.z));
  for (const [x, , z] of spots) {
    const [lx, lz] = castleLocal(p, x, 0, z);
    if (!castleClear(loose, lx, lz, p.rock !== false, 1.8)) continue;
    const rot = Math.atan2(gate.x - x, gate.z - z), y = room.fit(x, z, RECYCLE.l, RECYCLE.w, rot, { margin: 1, road: 0, level: 0.6, sink: 0.05 });
    if (y === null) continue;
    room.stand(x, z, 2.5);
    return { at: 'the fort', x, y, z, rot };
  }
  return null;
}
