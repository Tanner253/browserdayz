// Searchable crates that are part of the map (the army's cases at the checkpoints, wooden crates in barns, sheds and
// yards, the lockers and cabinets). They hide what is in them until opened, and refill some time after they are
// emptied. Pure data and rules, shared by the game and the server.
//
// What is in one is read from the item rules (src/sim/items/), as DayZ fills a building's containers from types.xml: a
// crate is a container of a kind of building on a step of the map, and holds what that kind of building keeps there,
// each thing as likely as the step keeps it, as the building favours it and as the step is its home. So a new item
// turns up in the crates it belongs in with nothing more said. (Until 2026-10-17 each sort of crate had a list of its
// own, which every new item had to be added to by hand.)

import { ITEMS, fitAtRandom, foundMag, makeItem, plainMag, stockGun, type Category } from './items';
import { eastOnly, typeRule } from './items/rules';
import type { Container } from './inventory';
import type { Tier } from './tiers';
import type { Usage } from '../world/buildings';

type Table = [id: string, weight: number][];

export interface CrateSpec {
  label: string;
  w: number;
  h: number;
  count: [number, number];
  /** how many, by the step it is filled on, where that is not `count` */
  countOn?: Partial<Record<Tier, [number, number]>>;
  /** the kind of building whose loot it holds, and the step of the map it is of wherever it stands */
  usage: Usage[];
  tier: Tier;
  /** how it leans among the sorts of things, times (1 unsaid), and the only sorts it holds, if it holds only some */
  lean?: Partial<Record<Category, number>>;
  only?: Category[];
  /** how often a thing in it is of the next step up instead (and then only what that step is the home of, never what is above it) */
  up?: number;
  /** what else is found in one now and then: [what, how often, in a crate] */
  also?: [string, number][];
  /** other steps whose things it holds as well (the bunker's racks: the gas's long guns too) */
  with?: Tier[];
  /** of the guns, only the long ones */
  long?: true;
}

export const CRATE_SPECS: Record<string, CrateSpec> = {
  // (One of the army's cases is of the second step wherever it stands, 2026-10-10: pistols and what they fire, the army's
  // kit; now and then something of the third, an armoured vest, a helmet or a submachine gun, and never a rifle, a scope
  // or plates; and a gas mask if you are lucky: the masks are the police's, "bar what one of the army's cases or a
  // supply drop turns up". 2026-10-13: "ammo should be more abundant in polive stations and armories ... i should find
  // all ammo there": a handful of every calibre the army kept.)
  wooden_military_crate: { label: 'Military Crate', w: 8, h: 4, count: [2, 4], usage: ['Military'], tier: 2, lean: { weapon: 0.18, ammo: 0.35, magazine: 0.5, food: 4, drink: 3, medical: 1.5 }, up: 0.08, also: [['gasmask', 0.05]] },
  old_military_crate: { label: 'Ammunition Crate', w: 8, h: 4, count: [2, 4], usage: ['Military'], tier: 2, lean: { weapon: 0.15, ammo: 0.6, magazine: 0.5, food: 4, drink: 3, medical: 1.5 }, up: 0.08, also: [['gasmask', 0.05]] },
  // (the hard case that stands wherever a military crate or an ammunition crate stood, and a little better filled)
  weapons_case: { label: 'Weapons Case', w: 8, h: 4, count: [2, 5], usage: ['Military'], tier: 2, lean: { weapon: 0.2, ammo: 0.35, magazine: 0.5, food: 4, drink: 3, medical: 1.5 }, up: 0.08, also: [['gasmask', 0.05]] },
  // (a wooden crate is of the outskirts, of their farms, yards and sheds: food, tools, something to hit with, and no gun)
  wooden_crate_01: { label: 'Wooden Crate', w: 6, h: 3, count: [1, 3], usage: ['Farm', 'Industrial', 'Hunting', 'Village'], tier: 1, lean: { food: 3, drink: 2.5, misc: 2, melee: 0.5, tool: 0.7, weapon: 0 } },
  // The steel cabinets of the hospital, of a clinic and of the police (2026-10-12: "the metal lockers found in the police
  // station and the medical station should be lootable and have inventories"): what each kind of building keeps,
  // "medkit abundant" in the hospital's, "heavy on bandages and stims" in a clinic's. The same cabinet in a police
  // building is a constable's: the server knows which by where it stands. A constable's holds a pistol now and then
  // and what every gun fires.
  med_cabinet: { label: 'Locker', w: 4, h: 6, count: [2, 4], usage: ['Medic'], tier: 3 },
  hospital_cabinet: { label: 'Locker', w: 4, h: 6, count: [2, 4], usage: ['Hospital'], tier: 3 },
  police_locker: { label: 'Locker', w: 4, h: 6, count: [1, 3], usage: ['Police'], tier: 3, lean: { weapon: 0.2 } },
  // The steel locker with two doors (see HUNG): a soldier's, in a barracks or a long hut (2026-10-13), where a man kept
  // his clothes, something to eat and to smoke, a dressing, a torch and a handful of what his pistol fired; a pistol
  // itself seldom, those are in the cases. In a police building it is a constable's, in the hospital a clinic's cabinet.
  steel_locker: { label: 'Locker', w: 4, h: 6, count: [1, 3], usage: ['Military'], tier: 2, lean: { clothing: 4, food: 8, drink: 5, misc: 1, medical: 2, tool: 3, melee: 2, ammo: 0.12, weapon: 0.05, magazine: 0.2, attachment: 0.2 } },
  // What is searched down the bunker ("abundant supplies in the T5": a rack is never bare, and a locker seldom), and on
  // its racks the long things.
  locker: { label: 'Locker', w: 4, h: 6, count: [0, 3], usage: ['Bunker'], tier: 5 },
  // (in the bunker its own, the best; anywhere else, the military's of the step it stands on: see fillCrate's `at`)
  // (as full as its step is rich: a thing or two in a village's, three to five down the bunker, the owner: "loot density
  // depends on tier it spawns in"; ten across, as a .50 is long)
  gun_rack: { label: 'Weapon Rack', w: 10, h: 5, count: [2, 4], countOn: { 1: [1, 2], 2: [1, 3], 3: [2, 3], 4: [2, 4], 5: [3, 5] }, usage: ['Military', 'Bunker'], tier: 5, with: [4], only: ['weapon', 'ammo', 'magazine', 'attachment'], long: true, lean: { weapon: 2 } },
  bunker_cabinet: { label: 'Cabinet', w: 6, h: 4, count: [1, 2], usage: ['Bunker'], tier: 5 },
  // (the furniture with no places of its own, filled as DayZ's cargo presets fill a container: a thing or two in a
  // cardboard box, a few in a large crate. See FURNITURE in storage.ts.)
  cardboard_box_01: { label: 'Cardboard Box', w: 4, h: 3, count: [0, 2], usage: ['Farm', 'Industrial', 'Hunting', 'Village'], tier: 1, lean: { food: 3, drink: 2.5, misc: 2, melee: 0.5, tool: 0.7, weapon: 0 } },
  crate_big: { label: 'Large Crate', w: 8, h: 4, count: [1, 3], usage: ['Farm', 'Industrial', 'Hunting', 'Village'], tier: 1, lean: { food: 3, drink: 2.5, misc: 2, melee: 0.5, tool: 0.7, weapon: 0 } },
  bunker_desk: { label: 'Desk', w: 6, h: 3, count: [0, 2], usage: ['Bunker'], tier: 5 },
};
/** a gun rack: what stands in it is seen from outside it, by everybody (the owner, 2026-10-17: "renders guns on the 3d
 * model that are in its inventory"); how many of its guns stand in its cups; and which of what it holds those are */
export const RACKS = new Set(['gun_rack']);
export const RACK_SHOWN = 6;
/** the step of the map a thing stands on: its nearest place for loot's, within thirty metres (a rack's building's) */
export function stepNear(points: readonly { x: number; z: number; tier?: Tier }[], x: number, z: number): Tier | undefined {
  let best: Tier | undefined, bd = 30 * 30;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd && p.tier) (bd = d), (best = p.tier);
  }
  return best;
}
export const rackShows = (items: readonly { id: string }[]) => items.filter((it) => ITEMS[it.id]?.weapon).map((it) => it.id).slice(0, RACK_SHOWN);
/** the kinds that are the bunker's own furniture: what they hold is theirs whatever is said of where they stand */
const OF_BUNKER = new Set(['locker', 'gun_rack', 'bunker_cabinet', 'bunker_desk']);
/** and the kinds that hold what is theirs wherever they stand (a cabinet under the gas would else be a crate of rifles) */
const OWN_TABLE = new Set([...OF_BUNKER, 'med_cabinet', 'hospital_cabinet', 'police_locker', 'steel_locker']);

/** how many of a sort a step keeps: its rule's count, or the economy's as written (which knows what a sort kept by a rate comes to on the map; not cut to a step's places, which a crate is none of) */
export type Keeps = (id: string, t: Tier) => number;
const written: Keeps = (id, t) => ITEMS[id]?.loot?.at?.[t - 1] ?? 0;
/** how much more likely a thing is in a crate for every whole that its step is its home (its share of the map's count) */
const HOME_LEAN = 2;

/**
 * The table a crate of a kind is filled from on a step: every item the step keeps that its kind of building keeps
 * (from the gas up, anything), weighted by how many the step keeps, how the building favours it, how the step is its
 * home and how the crate leans. @param homeOnly only what the step is the home of (the step up from a crate's own)
 */
function tableFor(spec: Pick<CrateSpec, 'usage' | 'lean' | 'only' | 'long'>, t: Tier, keeps: Keeps, homeOnly = false): Table {
  const out: Table = [];
  for (const d of Object.values(ITEMS)) {
    const r = typeRule(d), n = r ? keeps(d.id, t) : 0;
    if (!r || n <= 0 || (spec.only && !spec.only.includes(d.category)) || (spec.long && d.weapon && d.slot !== 'long')) continue;
    // (a crate that leans nothing toward a sort holds none: no gun in a farm's crate, though the Mosin lies on the first step, 2026-10-19)
    if (spec.lean?.[d.category] === 0) continue;
    const kinds = r.on?.[t]?.usage ?? r.usage;
    if (t < 4 && !spec.usage.some((u) => kinds.includes(u))) continue;
    // (nothing the whole map keeps but one of: the .50s and the VSSK are the bunker's floor's, counted, and a crate that
    // fills again in five minutes would be a well of them)
    const all = ([1, 2, 3, 4, 5] as Tier[]).reduce((a, s) => a + keeps(d.id, s), 0), home = n / (all || 1);
    // (a sight or a can the map keeps one of may come in a crate: it is no well of rifles)
    if (all < 2 && d.category !== 'attachment') continue;
    // (the step up: only what that step is the home of more than any above it, so a case of the second step holds an armoured vest of the third and never its rifle)
    if (homeOnly && ([4, 5] as Tier[]).some((s) => s > t && keeps(d.id, s) > n)) continue;
    const fav = t < 4 ? (r.on?.[t]?.favour ?? r.favour) : undefined;
    let w = 1;
    if (fav) for (const u of spec.usage) w = Math.max(w, fav[u] ?? 1);
    out.push([d.id, n * w * (1 + HOME_LEAN * home) * (spec.lean?.[d.category] ?? 1)]);
  }
  return out;
}
const tables = new WeakMap<Keeps, Map<string, Table>>();
function table(spec: Pick<CrateSpec, 'usage' | 'lean' | 'only' | 'long' | 'with'>, key: string, t: Tier, keeps: Keeps, homeOnly = false): Table {
  const mine = tables.get(keeps) ?? tables.set(keeps, new Map()).get(keeps)!, k = `${key}@${t}${homeOnly ? '+' : ''}`;
  return mine.get(k) ?? mine.set(k, [t, ...(homeOnly ? [] : (spec.with ?? []))].flatMap((s) => tableFor(spec, s, keeps, homeOnly))).get(k)!;
}

/** what is in any crate that stands under the gas, whatever sort of crate it is: the best of everything (and in a helicopter's cargo, see drops.ts) */
const PLAIN = { usage: [] as Usage[] };
export const UNDER_GAS: Table = tableFor(PLAIN, 4, written);

function pick(t: Table, rnd: () => number): string | null {
  const total = t.reduce((a, [, w]) => a + w, 0);
  if (!total) return null;
  let r = rnd() * total;
  for (const [id, w] of t) if ((r -= w) <= 0) return id;
  return t[t.length - 1][0];
}

/**
 * The containers whose doors are hung on hinges and swing (2026-10-13: "lockers for example when opened should have
 * their door crack open, and other people on the server could see that"). By the model that stands there: which of
 * its pieces are leaves (each a piece of the file whose own origin is on the line of its hinges: `hung` in
 * scripts/props.mjs), how far they swing open (radians, about that line, the free edge coming out toward the front)
 * and how long the swing takes, seconds. The leaves are left out of what is drawn standing still
 * (src/world/vegetation.ts) and drawn by src/game/lockers.ts, shut until somebody has the thing open.
 *
 * A lid is the same thing lying down: `about: 'x'` turns it about a line across the thing, and of a model whose lid
 * is a piece of its own but was not made to be hung, `at` says where that line is in the model's own space ([x, y,
 * z], metres: any point of it). The wooden crate's is its lid's upper back edge, so that the lid stands up behind
 * the opening, a little short of upright, and no part of it goes back past the crate into a wall. `wood`: it
 * sounds as a wooden door does, not as steel.
 */
export const HUNG: Record<string, { leaf: RegExp; open: number; time: number; about?: 'x'; at?: [number, number, number]; wood?: true }> = {
  steel_locker: { leaf: /_door_[lr]/, open: 1.68, time: 0.5 },
  wooden_crate_01: { leaf: /_lid$/, about: 'x', at: [0, 0.3415, -0.1957], open: -1.4, time: 0.45, wood: true },
};

/** seconds an emptied crate stays empty before it refills (only while nobody is near): five minutes, it was twenty */
export const CRATE_RESTOCK = 300;

/**
 * @param rich the crate stands under the gas (true) or down the bunker ('bunker'): it holds the
 *   best of what is kept there, and one thing more
 * @param keeps how many of each the steps keep (the economy's, where there is one: see Keeps)
 * @param at the step of the map where it stands (a gun rack's: see stepNear)
 */
/** @param west it stands west of the Zona's line: nothing of the fourth step and up in it (see eastOnly) */
export function fillCrate(c: Container, kind: string, rnd: () => number = Math.random, rich: boolean | 'bunker' = false, keeps: Keeps = written, at?: Tier, west = false) {
  const spec = CRATE_SPECS[kind];
  if (!spec) return;
  const own = OWN_TABLE.has(kind);
  // (a gun rack out of the bunker holds the military's of the step it stands on, and not the bunker's)
  const t0: Tier = RACKS.has(kind) && rich !== 'bunker' && at ? at : own || !rich ? spec.tier : rich === 'bunker' ? 5 : 4;
  const t = (west ? Math.min(t0, 3) : t0) as Tier;
  // (one that stands under the gas or down the bunker, not of its own kind, holds what is kept there, as any crate there does)
  const main = !own && rich ? table(PLAIN, 'plain', t, keeps) : table(spec, kind, t, keeps);
  const up = spec.up && !rich && t < (west ? 3 : 5) ? table(spec, kind, (t + 1) as Tier, keeps, true) : null;
  const [lo, hi] = spec.countOn?.[t] ?? spec.count;
  const n = lo + Math.floor(rnd() * (hi - lo + 1)) + (rich && !own ? 1 : 0);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = up && rnd() < spec.up! ? pick(up, rnd) : pick(main, rnd);
    if (id && !(west && eastOnly(ITEMS[id]))) ids.push(id);
  }
  for (const [id, chance] of rich ? [] : (spec.also ?? [])) if (ITEMS[id] && !(west && eastOnly(ITEMS[id])) && rnd() < chance) ids.push(id);
  for (const id of ids) {
    const def = ITEMS[id];
    const item = makeItem(id, def.stack ? Math.max(1, Math.round(def.stack * (0.2 + rnd() * 0.45))) : 1);
    if (def.weapon) {
      fitAtRandom(item, rnd);
      if (t < 5) plainMag(item);
      stockGun(item, Math.floor(rnd() * (def.weapon.capacity / 2 + 1)));
    }
    if (def.mag) foundMag(item, rnd);
    c.add(item);
  }
}
