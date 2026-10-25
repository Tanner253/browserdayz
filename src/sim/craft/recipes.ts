// Every recipe, as data (2026-10-24, plan-crafting, which the owner said yes to; "when in doubt just ask how does
// rust/dayz do it"). Three places to make things: by hand anywhere, DayZ's way (a timed hold, standing still); at a
// workbench within 4 m, Rust's (queued); at a forge, ours (it smelts while it burns). Every recipe is known from the
// start, DayZ's way: no research to grind. Found, never made: C4, the code lock, rubbing alcohol, guns and rounds.
// Tuned to the economy's targets: a wood hut in 20-30 min, a stone 2x2 in 1-1.5 h, a metal 2x2 in 3-4 h, solo.

export type Place = 'hand' | 'bench' | 'forge';
/** the screen's rail: what a recipe is filed under */
export type Cat = 'survival' | 'medical' | 'tools' | 'build' | 'raid';
export const CATS: { id: Cat; name: string }[] = [
  { id: 'survival', name: 'Survival' },
  { id: 'medical', name: 'Medical' },
  { id: 'tools', name: 'Tools' },
  { id: 'build', name: 'Building' },
  { id: 'raid', name: 'Raiding' },
];

export interface Need {
  /** what it is: one thing, or any one of several (all `n` of a need come from the same one) */
  id: string | readonly string[];
  n: number;
  /** a tool: not used up, but worn a use for each one made */
  keep?: true;
  /** what a need of several kinds is called on a card */
  name?: string;
}

export interface Recipe {
  id: string;
  /** what is made, and how many of it each time */
  makes: string;
  qty: number;
  /** what one made comes to by what was used for the first need, where it is not `qty`: rags by the size of the clothes, powder by the round */
  by?: Readonly<Record<string, number>>;
  needs: Need[];
  at: Place;
  /** seconds each one takes */
  time: number;
  cat: Cat;
}

/** how near a workbench or a forge has to be for what needs one, m (Rust's bench: its recipes light up near it) */
export const NEAR: Record<Exclude<Place, 'hand'>, number> = { bench: 4, forge: 3 };
/** how many one hand craft makes at most, one after another in one hold; and how many a bench keeps queued */
export const MOST = { hand: 10, queue: 5 };
/** how far a player may move during a hand craft, m: they stand still (DayZ) */
export const STILL = 0.6;

/** rags cut out of each piece of clothing, by its size (the fabric ones: a helmet, a vest or a pack is not cut up) */
export const RAGS: Readonly<Record<string, number>> = { field_jacket: 6, field_trousers: 4, fishermans_hat: 2, patrol_cap: 1, garden_gloves: 1 };
/** what cuts clothes: a blade, or anything with an edge (the owner: "a knife or sharp object") */
export const BLADES = ['knife', 'bone_knife', 'machete', 'hatchet', 'stone_hatchet'] as const;
/** powder out of ten rounds of each kind: a rifle round has more in it than a pistol's (the plan; a satchel is ten, a hundred rounds) */
export const POWDER: Readonly<Record<string, number>> = {
  ammo_9mm: 1, ammo_45: 1, ammo_12: 1, ammo_50: 2,
  ammo_556: 2, ammo_739: 2, ammo_762: 2,
  ammo_127x55: 4, ammo_50bmg: 5,
};

const hand = (id: string, makes: string, qty: number, needs: Need[], time: number, cat: Cat, by?: Record<string, number>): Recipe => ({ id, makes, qty, needs, at: 'hand', time, cat, ...(by ? { by } : {}) });
const bench = (id: string, makes: string, qty: number, needs: Need[], time: number, cat: Cat): Recipe => ({ id, makes, qty, needs, at: 'bench', time, cat });

export const RECIPES: Recipe[] = [
  // ---------------------------------------------------------------- by hand, anywhere (DayZ)
  hand('rags', 'rags', 0, [{ id: Object.keys(RAGS), n: 1, name: 'Clothes' }, { id: BLADES, n: 1, keep: true, name: 'A blade' }], 4, 'survival', RAGS),
  hand('rope', 'rope', 1, [{ id: 'rags', n: 4 }], 5, 'survival'),
  hand('torch', 'torch', 1, [{ id: 'planks', n: 1 }, { id: 'rags', n: 2 }, { id: 'animal_fat', n: 1 }], 4, 'survival'),
  hand('bandage', 'bandage', 1, [{ id: 'rags', n: 2 }, { id: 'rubbing_alcohol', n: 1 }], 4, 'medical'),
  hand('aid_pouch', 'aid_pouch', 1, [{ id: 'rags', n: 3 }, { id: 'rubbing_alcohol', n: 2 }, { id: 'bandage', n: 1 }], 6, 'medical'),
  hand('splint', 'splint', 1, [{ id: 'planks', n: 2 }, { id: 'rags', n: 2 }], 5, 'medical'),
  hand('stone_hatchet', 'stone_hatchet', 1, [{ id: 'stone', n: 5 }, { id: 'planks', n: 1 }], 6, 'tools'),
  hand('bone_knife', 'bone_knife', 1, [{ id: 'bones', n: 2 }], 4, 'tools'),
  hand('gunpowder', 'gunpowder', 0, [{ id: Object.keys(POWDER), n: 10, name: 'Rounds of one kind' }], 5, 'raid', POWDER),
  // ---------------------------------------------------------------- at a workbench, queued (Rust)
  bench('nails', 'nails', 20, [{ id: 'iron_bar', n: 1 }], 6, 'build'),
  bench('sheet_metal', 'sheet_metal', 1, [{ id: 'iron_bar', n: 3 }], 10, 'build'),
  bench('building_plan', 'building_plan', 1, [{ id: 'rags', n: 2 }, { id: 'coal', n: 1 }], 5, 'build'),
  bench('key_lock', 'key_lock', 1, [{ id: 'iron_bar', n: 2 }], 10, 'build'),
  bench('sleeping_bag', 'sleeping_bag', 1, [{ id: 'rags', n: 10 }, { id: 'rope', n: 1 }], 15, 'build'),
  bench('hammer', 'hammer', 1, [{ id: 'iron_bar', n: 1 }, { id: 'planks', n: 1 }], 10, 'tools'),
  bench('hatchet', 'hatchet', 1, [{ id: 'iron_bar', n: 2 }, { id: 'planks', n: 1 }], 12, 'tools'),
  bench('hand_saw', 'hand_saw', 1, [{ id: 'iron_bar', n: 2 }, { id: 'planks', n: 1 }], 12, 'tools'),
  bench('pickaxe', 'pickaxe', 1, [{ id: 'iron_bar', n: 2 }, { id: 'planks', n: 1 }], 12, 'tools'),
  bench('sledgehammer', 'sledgehammer', 1, [{ id: 'iron_bar', n: 4 }, { id: 'planks', n: 1 }], 14, 'tools'),
  bench('satchel', 'satchel', 1, [{ id: 'gunpowder', n: 10 }, { id: 'rags', n: 2 }, { id: 'rope', n: 1 }, { id: 'tin_can', n: 1 }], 20, 'raid'),
  // ---------------------------------------------------------------- at a forge (ours): five scrap and its fire's wood make a bar
  { id: 'iron_bar', makes: 'iron_bar', qty: 1, needs: [{ id: 'scrap', n: 5 }], at: 'forge', time: 20, cat: 'build' },
];

export const RECIPE: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** the things a need may be met with */
export const optionsOf = (need: Need): readonly string[] => (typeof need.id === 'string' ? [need.id] : need.id);
