// Blueprints (progression v3, the owner's yes 2026-10-25: "Blueprints: you start knowing the basics. Everything else must
// be learned before it can be crafted"). Two ways to learn, both Rust's: the research table ("put a found item in with
// scrap, and the item is used up; you know it for good") and each bench's tech tree ("spend scrap to unlock its recipes
// in order, cheaper ones first"). What a player knows is kept with them for good, through death, as Rust keeps it until a
// wipe: by the server, or by the browser played alone. Shared by both, which judge alike.

import { PLACED } from '../build/pieces';
import { RECIPE, RECIPES, type Level, type Recipe } from './recipes';
import { ITEMS, type ItemInstance } from '../items';
import { count } from './plan';
import { MAT } from './materials';
import { HELD_BACK } from '../build/raid';

/** known from the start: everything made by hand, the forge's bar, and a bench's first tools, bed and plan */
export const KNOWN_AT_START: ReadonlySet<string> = new Set([
  ...RECIPES.filter((r) => r.at !== 'bench').map((r) => r.id),
  'hammer', 'hatchet', 'building_plan', 'sleeping_bag',
  // (whatever is set down from the hands: a base needs its doors and its benches from the first)
  ...Object.values(PLACED).filter((id) => id !== 'torch'),
]);

/**
 * each bench level's tech tree: its recipes in the order they are unlocked, and the scrap each costs there (less what is
 * held back: src/sim/build/raid.ts). Two fifths of what they were when crates gave scrap by the hundred (2026-10-26: scrap
 * a currency worth having, found a few at a time).
 */
const TREE_ALL: Record<Level, readonly (readonly [string, number])[]> = {
  1: [['pickaxe', 8], ['hand_saw', 12], ['key_lock', 16], ['ammo_9mm', 20], ['ammo_45', 24]],
  2: [['gun_light', 30], ['code_lock', 35], ['sheet_metal', 36], ['sledgehammer', 45], ['red_dot', 55], ['colt', 70], ['m9', 90], ['satchel', 120]],
  3: [['ammo_762', 80], ['ammo_739', 90], ['suppressor_9', 105], ['pu_scope', 120], ['mosin9130', 140], ['mpa', 160], ['scorpion', 180], ['suppressor_739', 200], ['ak', 260], ['c4', 300]],
};
export const TREE = Object.fromEntries(Object.entries(TREE_ALL).map(([lv, list]) => [lv, list.filter(([id]) => !HELD_BACK.has(id))])) as unknown as Record<Level, readonly (readonly [string, number])[]>;

/** how a recipe not yet known may be learned: its tree's place (and why not now), and researching it (and why not now) */
export interface LearnWays {
  tree: { lv: Level; cost: number; why: string | null } | null;
  research: { cost: number; uses: number; uid: string | null; why: string | null };
}

/** what researching a recipe costs, of what its tree asks: less, as the thing itself is used up */
const RESEARCH_SHARE = 0.5;

const treeOf = (id: string): { lv: Level; i: number; cost: number } | null => {
  for (const lv of [1, 2, 3] as Level[]) {
    const i = TREE[lv].findIndex(([r]) => r === id);
    if (i >= 0) return { lv, i, cost: TREE[lv][i][1] };
  }
  return null;
};

/** what is still to learn: a bench's recipe not known from the start */
export const learnable = (r: Recipe | undefined): r is Recipe => !!r && r.at === 'bench' && !KNOWN_AT_START.has(r.id) && !HELD_BACK.has(r.makes);

/** whether a recipe may be made by somebody who knows these */
export const knows = (known: ReadonlySet<string>, id: string) => KNOWN_AT_START.has(id) || known.has(id);

/** the scrap a recipe's place in its tree costs, and the tree's level; null: not in a tree */
export const treeCost = (id: string) => treeOf(id);

/** the scrap researching a recipe costs */
export const researchCost = (id: string) => Math.max(4, Math.round((treeOf(id)?.cost ?? 16) * RESEARCH_SHARE));

/** how many of what a recipe makes researching it uses up: one thing, or a recipe's pile of rounds */
export const researchUses = (r: Recipe) => (ITEMS[r.makes]?.stack ? Math.max(1, r.qty) : 1);

/** the recipe a thing carried teaches at a research table, if any still to learn */
export const teaches = (itemId: string): Recipe | undefined => RECIPES.find((r) => r.makes === itemId && learnable(r));

/**
 * Whether a recipe may be unlocked in its tree now, at a bench of `lv`, by somebody who knows these and carries `scrap`:
 * null if so, or why not.
 */
export function mayUnlock(id: string, known: ReadonlySet<string>, lv: Level | 0, scrap: number): string | null {
  const t = treeOf(id), r = RECIPE[id];
  if (!t || !learnable(r)) return 'Nothing to learn there';
  if (knows(known, id)) return 'You know it already';
  if (lv < t.lv) return `Learned at a Bench ${['', 'I', 'II', 'III'][t.lv]}`;
  // (in any order: the owner, 2026-10-26, "let any blueprint of the bench's level (and below) be unlocked directly, in any
  // order, for its scrap". It was one after another along the line)
  if (scrap < t.cost) return `It takes ${t.cost} ${ITEMS[MAT.scrap].name.toLowerCase()}`;
  return null;
}

/** a known list as it comes from a save or the wire: only recipes there are, still to learn */
export const cleanKnown = (ids: unknown): string[] => (Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === 'string' && learnable(RECIPE[x])))] : []);

/** how a recipe still to learn may be learned now, by somebody who knows these, carries these, at a bench of `lv` (0: none) and at a research table or not; null: nothing to learn */
export function waysToLearn(r: Recipe, known: ReadonlySet<string>, carried: ItemInstance[], lv: Level | 0, table: boolean): LearnWays | null {
  if (!learnable(r) || knows(known, r.id)) return null;
  const scrap = count(carried, MAT.scrap), t = treeOf(r.id);
  const tree = t ? { lv: t.lv, cost: t.cost, why: mayUnlock(r.id, known, lv, scrap) } : null;
  const cost = researchCost(r.id), uses = researchUses(r), name = ITEMS[r.makes].name;
  const it = carried.find((x) => x.id === r.makes && (!ITEMS[x.id].stack || count(carried, x.id) >= uses)) ?? null;
  const why = !it
    ? `Carry ${uses > 1 ? `${uses} ${name}` : `a ${name}`} to a research table`
    : !table
      ? 'Stand at a research table'
      : scrap < cost
        ? `It takes ${cost} ${ITEMS[MAT.scrap].name.toLowerCase()}`
        : null;
  return { tree, research: { cost, uses, uid: it?.uid ?? null, why } };
}
