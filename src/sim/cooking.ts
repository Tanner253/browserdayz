// Cooking spots (2026-10-13): whatever a fire is made in and food is made hot on. The ring of stones the game has,
// the metal stove, and one day a fire somebody builds and stands a pot on are all ONE thing here, told apart by a
// row of a table. The rules, in one place: the server and the game both go by them.
//
// The user's: "i want the metal stove we imported to be [usable], and we need to make the door on the front
// open/closable. open the stove to reveal its inventory, fuel will go in there soon (wood) but make it just work
// for now, soon will need to cook food etc. so lets make the stove usable, animated to open and close, must be
// open to interact with inventory. door does not have to be open or closed to use the fire/cooking stove but its
// a cool addition to animate it separately opening and closing like the metal door for the bunker." And of how it
// is to be built: "fires and metal stoves will work the same (sorta) like dayz ... build the code in a reusable
// modular way. cooking food in the code will behave the same and a cooking spot will simply have more or less
// functionality (fuel slots, or food slots to cook) depending on its tier of cooking ability (like weapons are
// tier 1 and 2 and 3, campfires will have their own, where a camping fire is tier 1)."
//
// So: a table of KINDS of spot (COOK_KINDS), each with its tier and what it offers; one state for any spot
// (CookSpot) and plain functions over it; a table of what burns (FUEL) and a table of what cooks (COOKS). A new
// kind of spot, a new fuel or a new food is one more row, and nothing else here changes.
//
// What is taken from DayZ (read 2026-10-13), wherever the user has not said:
//   - dayz.wiki.gg/wiki/Fireplace: what burns is put INTO the fire, in slots of its own: wood and sticks to keep
//     it going, and small things that catch at once (bark, paper, rags, a bandage). A fire is made better by what
//     is added to it (stones make it a ring and then an oven, a tripod lets it take one pot, an oven takes three),
//     which is the tier here. One that has burned out is lit again only if there is something left in it to burn.
//     What is left in a fire too long is spoiled.
//   - dayz.wiki.gg/wiki/Cooking: food has stages, raw, then cooked (baked, boiled or dried, by what it was cooked
//     in), then burned. A pot holds twelve places. Over a fire a thing takes half a minute dry, a minute in fat,
//     a minute and a quarter in water; on a gas stove four times as long; and left on a quarter of a minute more
//     it is burned. Cooking is done in something: a pot, a pan, or on a stick.
//   - dayz.wiki.gg/wiki/Food_and_Drink: what a stage is worth. A chicken steak is 62.5 kcal raw, 250 baked, 187.5
//     boiled and 62.5 burned, with 50, 30, 80 and 0 ml of water: raw is a quarter of cooked, and so is burned,
//     and burned is dry. (The rows for meat and fish below, which wait for animals and fishing, are those shares.)
//   - dayz.wiki.gg/wiki/Fire_Barrel: a closed thing a fire is made in has three places to cook, and what is kept in
//     it when it is lit is destroyed. dayz.wiki.gg/wiki/Portable_Gas_Stove: a stove takes one pot, and needs no
//     match.
// Where this departs from it, and why:
//   - Nothing is needed to light one, for now. There are no matches in the game; the day there are, a kind says
//     `igniter` and IGNITERS names them.
//   - Kindling and fuel are one table. A small thing burns a short time, a log a long one, and the smallest
//     catches first, as a fire is laid.
//   - A spot may burn for a while on nothing (`free`). The ring of stones has always done so, and until there is
//     wood to find the stove does too: "fuel will go in there soon (wood) but make it just work for now". What is
//     put in its fuel slots keeps it going longer. The day wood is an item, the stove's `free` is made 0 and it
//     burns what it is given and nothing else.
//   - Burning is slow. A quarter of a minute's grace is for somebody stood watching a pot; here somebody is
//     watching the door, and a tin left on is burned two minutes after it was hot.
//   - What the game has to eat today is tins and an apple. A tin is not cooked, it is WARMED: it is hot for five
//     minutes after it comes off the heat, eaten hot it does the good that a meal beside a lit fire has always
//     done (FIRE.meal in fires.ts), wherever it is eaten, and cold it is the tin it was. An apple is COOKED, and
//     stays so. Both are the same few lines, told apart by a word in their row (`how`).
//
// Time. Nothing here reads a clock or rolls dice. `dt` is seconds gone by. `now` is seconds on the WALL clock
// (Date.now() / 1000) and it is passed in for one thing only, to mark on a hot thing the moment it will be cold:
// that thing is carried off in a pocket to another game, or kept overnight by the server, and the mark has to mean
// the same wherever it is read. The server and every game must hand in the same clock.
//
// How it is called, in short (the server, or the game when it plays alone, is the keeper):
//   const cooks = new CookSpots(places)                    every spot of the map, in the order all count them
//   const spot = cooks.at(i, x, z, slack, y)               the one somebody is stood at, or null
//   swingDoor(spot, true)                                  its door is opened (false: shut)
//   noLighting(spot) ?? light(spot)                        why it cannot be lit; or it is
//   mayReach(spot, 'fuel') and gridOf(spot, 'fuel')        its fuel slots, as a Container the inventory screen shows
//   setGrid(spot, 'food', items)                           what a player's game says is in them now (the server's cset)
//   cooks.tick(dt, now)                                    time passes: fuel burns, food cooks, doors swing
//   mealOf(item, now, by)                                  what a thing gives when it is eaten, hot or not
//   JSON.stringify(spot) and readSpot(raw)                 kept, sent, and read back whatever it says

import { Container } from './inventory';
import { ITEMS, NAMING, sanitizeItem, type ItemInstance, type Placed } from './items';

/** the two insides a spot can have: where what burns goes, and where what cooks goes */
export type Part = 'fuel' | 'food';
const PARTS: Part[] = ['fuel', 'food'];

// ------------------------------------------------------------------ the kinds of spot

export interface CookKind {
  /** what it is called on the screen */
  label: string;
  /** its tier of cooking ability, 1 the least, as guns have theirs. What a tier gives is the rest of its row. */
  tier: 1 | 2 | 3;
  /** the things of the map that are one of these, by the name of their model (none: it is made by a player, one day) */
  props: string[];
  /** how near one has to be stood to work it, metres */
  reach: number;
  /** seconds of work to get it going */
  lighting: number;
  /** it wants something to light it with (one of IGNITERS, carried) */
  igniter: boolean;
  /** its fuel slots, wide and high (null: nothing is put in it to burn) */
  fuel: [number, number] | null;
  /** seconds it burns, lit, on nothing at all (0: it burns what is put in it and nothing else) */
  free: number;
  /** fuel lasts this many times as long in it as FUEL says */
  lasts: number;
  /** its food slots, wide and high (null: nothing is cooked on it) */
  food: [number, number] | null;
  /** it cooks this many times as fast as COOKS says */
  speed: number;
  /** what has to be stood on it before anything cooks (an item's id: the pot), or null if it cooks as it is */
  needs: string | null;
  /** its door: the seconds it takes to swing, and which of its insides are behind it (reached only while it stands open) */
  door: { seconds: number; shuts: Part[] } | null;
  /** lit, whoever rests within so many metres of it mends this much health a second, and a meal there does this many times the good (null: it is no good to anybody near) */
  warm: { within: number; heal: number; meal: number } | null;
  /** lit, the infected hear it from this far off, every so many seconds (null: it makes no sound to speak of) */
  noise: { heard: number; every: number } | null;
}

/**
 * Every kind of cooking spot. A new one is one more row.
 *
 * The tiers, as they stand: 1 is a fire and nothing else; 2 is a fire with something stood on it to cook in; 3 is
 * a firebox with a door, a plate and a flue. A higher tier cooks faster and makes its fuel go further, and has
 * more places for both.
 */
export const COOK_KINDS: Record<string, CookKind> = {
  // The ring of stones at the lodges, the cabins and the hamlet, exactly as src/sim/fires.ts has kept it since
  // 2026-10-09: lit by standing at it for three seconds, it burns five minutes on nothing, mends whoever rests by
  // it and is heard by the infected. Every figure here is FIRE's (test/cooking.test.ts holds the two together),
  // so that fires.ts can one day be said through this row. What is new is its food slots: room on the stones for
  // two tins. Nobody sees them until the screen is told of them.
  campfire: {
    label: 'Campfire', tier: 1, props: ['stone_fire_pit'], reach: 2.6, lighting: 3, igniter: false,
    fuel: null, free: 300, lasts: 1,
    food: [2, 2], speed: 1, needs: null,
    door: null,
    warm: { within: 3.6, heal: 0.8, meal: 1.4 },
    noise: { heard: 18, every: 8 },
  },
  // NOT IN THE GAME YET: a row to show the shape of it. "youll be able to craft a fire one day and put a cooking
  // pot on top of it with a camping cooking stove item". It is made by a player and so is no thing of the map; it
  // burns only what it is given; and nothing cooks on it until the pot is stood on it (`fit`). Its twelve food
  // slots are the pot's, as DayZ's pot has twelve.
  potfire: {
    label: 'Fire and pot', tier: 2, props: [], reach: 2.6, lighting: 3, igniter: false,
    fuel: [6, 2], free: 0, lasts: 1,
    food: [4, 3], speed: 1.25, needs: 'cooking_pot',
    door: null,
    warm: { within: 3.6, heal: 0.8, meal: 1.4 },
    noise: { heard: 18, every: 8 },
  },
  // The metal stove ("Stove" by spooneystone, brought in 2026-10-12: assets-src/models/stove, its door a part of
  // its own). Both its insides are behind the door: "must be open to interact with inventory". Lighting it and
  // what cooks on it take no notice of the door: "door does not have to be open or closed to use the fire/cooking
  // stove". Its fuel slots are six wide so that the longest thing that burns today, a bat, goes in on its side. It
  // is iron round the fire, so the same wood lasts half as long again, it cooks half as fast again, and it is
  // heard from half as far.
  // (`free` is the five minutes of the ring of stones, until there is wood: see the top of this file.)
  stove: {
    label: 'Stove', tier: 3, props: ['stove'], reach: 2.2, lighting: 3, igniter: false,
    fuel: [6, 3], free: 300, lasts: 1.5,
    food: [4, 3], speed: 1.5, needs: null,
    door: { seconds: 0.7, shuts: ['fuel', 'food'] },
    warm: { within: 3.6, heal: 0.8, meal: 1.4 },
    noise: { heard: 9, every: 8 },
  },
};

/** the kind a spot is taken for when nothing better is known of it: the least of them */
const LEAST = 'campfire';

/** What lights a fire, carried, for a kind that says it wants one. Nothing yet: there are no matches in the game. */
export const IGNITERS: string[] = [
  // 'matches', 'lighter',
];

/** Things the tables below name that are not items yet. The day one is added to items.ts, its row here works as it stands. */
export const TO_COME = ['firewood', 'cooking_pot'];

// ------------------------------------------------------------------ what burns

/**
 * What counts as fuel, and for how many seconds one of it burns on an open fire (a kind's `lasts` stretches it).
 * One of a pile is burned at a time. A new fuel is one more row.
 *
 * There is no wood in the game yet, so today's fuel is whatever a survivor has that would burn: a wooden bat,
 * cloth, a dressing, a pack of cigarettes. None of it is worth much beside a log, and all of it is worth more as
 * what it is. That is meant: a stove is kept going by somebody who gives something up for it.
 * (Not fuel, on purpose: the jerrycan, since petrol in a firebox is a bomb and that is a rule for another day; the
 * helmet, which is `boonie_hat` by its id and is steel; and anything things are kept in.)
 */
export const FUEL: Record<string, number> = {
  // THE ROW FOR WOOD. A log burns as long as the ring of stones always has. (Not an item yet: see TO_COME.)
  firewood: 300,
  // sticks: 60,
  // a turned ash club is most of a log
  bat: 240,
  // cloth: the soft hat, the field cap and the canvas gloves
  fishermans_hat: 40,
  patrol_cap: 40,
  garden_gloves: 40,
  // what DayZ lights its fires with
  bandage: 20,
  // paper and tobacco, a pack at a time
  cigarettes: 15,
  // a lump of animal fat (2026-10-23, Rust's: fat is what fuel is made of)
  animal_fat: 180,
  // paper: 15, bark: 20,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A row of a table by its name, and never something every object has (`constructor`): the names come from outside. */
const own = <T>(table: Record<string, T>, id: unknown): T | undefined => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined);

/** seconds one of these burns on an open fire (0: it is not fuel) */
export const fuelOf = (id: string): number => own(FUEL, id) ?? 0;

/** Would a fire take this? What burns, with nothing kept inside it. */
export const isFuel = (item: ItemInstance): boolean => fuelOf(item.id) > 0 && !item.cargo?.length;

// ------------------------------------------------------------------ what cooks

/** how far along a thing is: as it was found, done (hot, or cooked), or left on too long */
export type Stage = 'raw' | 'done' | 'burned';

/**
 * What a stage is worth: what the thing's own `use` gives of energy and of water is multiplied by these (only what
 * it GIVES: salt fish takes water from whoever eats it, cooked or not), and `health` is added to what it does to
 * health (raw meat turns the stomach).
 */
export interface Worth {
  energy: number;
  water: number;
  health?: number;
  /** the chance it gives whoever eats it food poisoning (DayZ: raw meat, rotten anything) */
  sick?: number;
}

export interface Recipe {
  /**
   * 'warm': it is only made hot. Cold again, it is what it was, and is warmed again from cold (a tin).
   * 'cook': done, it stays done (an apple, meat).
   */
  how: 'warm' | 'cook';
  /** seconds on a tier 1 spot until it is done (a kind's `speed` shortens it) */
  takes: number;
  /** seconds more, left on, until it is burned */
  burns: number;
  /** what it is worth raw and done, where that is not simply what its item says (1 and 1) */
  raw?: Worth;
  done?: Worth;
  /** and burned */
  burned: Worth;
  /** it goes off (DayZ): seconds from when it was got until it is rotten, raw, and once it is cooked (see `rotten`) */
  keeps?: { raw: number; done: number };
}

/** How hot food is kept, and what it is worth. */
export const HEAT = {
  /** seconds a thing stays hot after it comes off the heat, or the fire under it dies */
  keeps: 300,
  /** what is eaten or drunk hot does this many times the good: what a meal beside a lit fire has always done (FIRE.meal) */
  meal: 1.4,
};

/** meat, of whatever animal (src/sim/items/hunt.ts) */
const MEAT: Recipe = { how: 'cook', takes: 60, burns: 45, raw: { energy: 0.25, water: 1.6, sick: 0.5 }, burned: { energy: 0.25, water: 0 }, keeps: { raw: 2400, done: 10800 } };
/** what anything rotten is worth: little, and it makes you ill */
export const ROTTEN: Worth = { energy: 0.2, water: 0, health: -15, sick: 1 };

/** a tin: warmed in so many seconds, scorched two minutes later, and then half the food and none of the juice */
const tin = (takes: number): Recipe => ({ how: 'warm', takes, burns: 120, burned: { energy: 0.5, water: 0 } });

/**
 * What cooking does to food: one row for each thing that can be put on the heat. A new food is one more row.
 * (What is hot is worth HEAT.meal times its stage, for as long as it is hot: that is not said row by row.)
 */
export const COOKS: Record<string, Recipe> = {
  // the flat tin is hot soonest, the tall ones last
  sardines: tin(30),
  sprats: tin(35),
  condensed: tin(40),
  beans: tin(45),
  tomatoes: tin(45),
  // Baked, the water goes out of an apple and the sweetness stays: more to eat and less to drink, and it keeps so.
  apple: { how: 'cook', takes: 30, burns: 45, done: { energy: 1.5, water: 0.5 }, burned: { energy: 0.3, water: 0 } },
  // Meat (2026-10-23, the animals: the shares are DayZ's chicken steak, see the top of this file). The item is written as
  // what it is worth COOKED; raw it is a quarter of that and as likely as not gives whoever eats it food poisoning;
  // burned it is a quarter and dry. It goes off: raw in forty minutes, cooked in three hours. One item for each
  // animal, with its stage kept on the thing itself, as a tin's is.
  ...Object.fromEntries(['meat_venison', 'meat_bear', 'meat_wolf', 'meat_beef'].map((id) => [id, MEAT])),
  // fish: { how: 'cook', takes: 40, burns: 45, raw: { energy: 0.3, water: 1.4, health: -6 }, burned: { energy: 0.25, water: 0 } },
  // And what waits for the pot (boiled, a thing keeps three quarters of its food and gains water; water is made
  // fit to drink): a recipe will say what it has to be cooked in, as a kind says what has to be stood on it.
};

/**
 * What cooking leaves on a thing itself, so that it goes with the thing out of the spot and into a pocket, a
 * crate or a body. THESE TWO ARE NOT IN `ItemInstance` YET (src/sim/items.ts is not this file's to change): they
 * are read and written here through this type, and whatever cleans an item that came from outside has to keep
 * them (`keepCooked` does it in one line).
 */
export interface Cooked {
  /** seconds of cooking it has had, as a tier 1 spot counts them */
  cook?: number;
  /** the moment it is cold again, seconds on the wall clock */
  hot?: number;
  /** when it was got (a steak off a carcass), seconds on the wall clock: what goes off goes off from then */
  made?: number;
}
type Food = ItemInstance & Cooked;

const EPS = 1e-6;
const PLAIN: Worth = { energy: 1, water: 1 };

/** A thing that goes off is marked with when it was got. (Returns the thing.) */
export function markMade<T extends ItemInstance>(item: T, now: number): T {
  if (own(COOKS, item.id)?.keeps) (item as Food).made = Math.floor(now);
  return item;
}

/** Has it gone off? Raw, after its recipe's `keeps.raw` from when it was got; cooked, after `keeps.done`. */
export function rotten(item: ItemInstance, now: number): boolean {
  const k = own(COOKS, item.id)?.keeps, made = (item as Food).made;
  if (!k || !num(made)) return false;
  return now - made > (stageOf(item) === 'raw' ? k.raw : k.done);
}

// (what goes off says what stage it is at in its name, wherever it is shown)
NAMING.stage = (it) => (own(COOKS, it.id)?.keeps ? stateOf(it, Date.now() / 1000).word.replace(', hot', '') : '');

/** Can this be put on the heat? */
export const cookable = (item: ItemInstance): boolean => !!own(COOKS, item.id);

/** How far along a thing is. (Whatever does not cook is 'raw': as it was found.) */
export function stageOf(item: ItemInstance): Stage {
  const r = own(COOKS, item.id), c = (item as Food).cook;
  if (!r || !num(c)) return 'raw';
  return c >= r.takes + r.burns - EPS ? 'burned' : c >= r.takes - EPS ? 'done' : 'raw';
}

/** Is it hot now? Only what is done is: a tin half warmed is not, and nothing burned is worth calling so. */
export function isHot(item: ItemInstance, now: number): boolean {
  return stageOf(item) === 'done' && ((item as Food).hot ?? 0) > now;
}

/**
 * The stage a thing is at NOW, which for a tin is not the same question: one that was warmed and has gone cold is
 * the tin it was, whatever is still counted on it (the count is kept for a tin put back on the heat while warm).
 */
function stageNow(item: ItemInstance, now: number): Stage {
  const stage = stageOf(item);
  return stage === 'done' && own(COOKS, item.id)?.how === 'warm' && !isHot(item, now) ? 'raw' : stage;
}

/**
 * All there is to say of a thing that cooks, for whatever shows it: its stage as it is now, whether it is hot, how
 * far through that stage it is (0 to 1: a bar over it while it is on the heat), and the word to put after its
 * name ('' for a tin that is merely a tin).
 */
export function stateOf(item: ItemInstance, now: number): { stage: Stage; hot: boolean; share: number; word: string } {
  const r = own(COOKS, item.id), stage = stageNow(item, now), hot = isHot(item, now), c = (item as Food).cook ?? 0;
  const share = !r ? 0 : stage === 'burned' ? 1 : stage === 'raw' ? (stageOf(item) === 'raw' ? c / r.takes : 0) : (c - r.takes) / r.burns;
  const word = rotten(item, now) ? 'rotten' : stage === 'burned' ? 'burned' : stage === 'raw' ? (r?.raw ? 'raw' : '') : r?.how === 'cook' ? (hot ? 'cooked, hot' : 'cooked') : 'hot';
  return { stage, hot, share: clamp(share, 0, 1), word };
}

/**
 * What a thing gives when it is eaten or drunk: energy, water and health, as whole numbers to add. This is the
 * one place that says so, for a tin out of a pocket as for one off the stove.
 * @param by the `meal` of the lit spot the eater is resting by (1: they are by none). Hot food by a fire is not
 *   hot twice over: the greater of the two counts.
 */
export function mealOf(item: ItemInstance, now: number, by = 1): { energy: number; water: number; health: number; hot: boolean; sick?: number } {
  const u = own(ITEMS, item.id)?.use, r = own(COOKS, item.id), stage = stageNow(item, now), hot = isHot(item, now);
  const worth = !r ? PLAIN : rotten(item, now) ? ROTTEN : stage === 'burned' ? r.burned : stage === 'done' ? r.done ?? PLAIN : r.raw ?? PLAIN;
  const k = Math.max(1, num(by) ? by : 1, hot ? HEAT.meal : 1);
  const good = (v: number | undefined, share: number) => (!v ? 0 : v > 0 ? Math.round(v * share * k) : v);
  return { energy: good(u?.energy, worth.energy), water: good(u?.water, worth.water), health: (u?.health ?? 0) + (worth.health ?? 0), hot, ...(worth.sick ? { sick: worth.sick } : {}) };
}

/**
 * What cooking has left on a thing that came from outside (a player's game, a file), put onto the clean copy of
 * it: its cooking no more than its recipe has, its heat no further off than heat lasts. Whatever does not cook
 * has neither. This is the line the server's `cleanItem` wants, so that a hot tin is still hot in a pocket.
 * @param now the wall clock, if the heat is to be held to it (a game that says its tin is hot for a year is not believed)
 */
export function keepCooked(into: ItemInstance, raw: unknown, now?: number): ItemInstance {
  const it = into as Food, r = own(COOKS, into.id), said = (raw && typeof raw === 'object' ? raw : {}) as Cooked;
  const cook = said.cook, hot = said.hot, made = said.made;
  delete it.cook;
  delete it.hot;
  delete it.made;
  // (when it was got: never later than now, so a game cannot keep its meat fresh by saying so)
  if (r?.keeps && num(made) && made > 0) it.made = num(now) ? Math.min(made, now) : made;
  if (!r || !num(cook) || cook <= 0) return into;
  it.cook = Math.min(cook, r.takes + r.burns);
  if (num(hot) && hot > 0 && stageOf(it) !== 'burned') it.hot = num(now) ? Math.min(hot, now + HEAT.keeps) : hot;
  return into;
}

// ------------------------------------------------------------------ one spot

/**
 * A cooking spot as it stands. It is plain data: JSON.stringify keeps or sends it as it is, and `readSpot` reads
 * it back, whoever wrote it.
 */
export interface CookSpot {
  /** which row of COOK_KINDS it is */
  kind: string;
  /** its door: how far open it stands, 0 (shut) to 1 (open), and which of the two it is on its way to */
  door: number;
  to: 0 | 1;
  /** seconds of burning left in what is alight now (0: it is out). What waits in its fuel slots is not in this. */
  burn: number;
  /** what is in its fuel slots and in its food slots, as any grid keeps things (see `gridOf`) */
  fuel: Placed[];
  food: Placed[];
  /** what is stood on it to cook in, if its kind wants such a thing (the pot) */
  gear: ItemInstance | null;
}

/** A spot of this kind as it is made: shut, cold and empty. */
export function newSpot(kind: string): CookSpot {
  if (!own(COOK_KINDS, kind)) throw new Error(`unknown cooking spot ${kind}`);
  return { kind, door: 0, to: 0, burn: 0, fuel: [], food: [], gear: null };
}

/** the row a spot goes by */
export const kindOf = (spot: CookSpot): CookKind => own(COOK_KINDS, spot.kind) ?? COOK_KINDS[LEAST];

/** Which kind of spot a thing of the map is, by its model's name (null: it is none). */
export function spotKind(prop: string): string | null {
  for (const [id, k] of Object.entries(COOK_KINDS)) if (k.props.includes(prop)) return id;
  return null;
}

/**
 * Every cooking spot among the things of a map, in the order the game and the server both count them (the order
 * they were given in), each with the kind it is. (The rings of stones are among them, and are still kept by
 * src/sim/fires.ts today: whoever wires the stove in takes `kind === 'stove'` and leaves the rest.)
 */
export function cookSpots<P extends { kind: string }>(props: P[]): { kind: string; prop: P }[] {
  const out: { kind: string; prop: P }[] = [];
  for (const prop of props) {
    const kind = spotKind(prop.kind);
    if (kind) out.push({ kind, prop });
  }
  return out;
}

// ------------------------------------------------------------------ its door

export type DoorState = 'none' | 'shut' | 'opening' | 'open' | 'shutting';

/** How its door stands ('none': it has no door). How far open it is, for whatever draws it, is `spot.door`. */
export function doorState(spot: CookSpot): DoorState {
  if (!kindOf(spot).door) return 'none';
  if (spot.to) return spot.door >= 1 ? 'open' : 'opening';
  return spot.door <= 0 ? 'shut' : 'shutting';
}

/**
 * Its door is pushed open, or shut. It swings from wherever it is (one turned back half way goes back from half
 * way), in the seconds its kind says, as `tick` moves it: the server and every game move it by the same rule.
 * @returns false if it has no door, or is on its way there already
 */
export function swingDoor(spot: CookSpot, open: boolean): boolean {
  if (!kindOf(spot).door || !!spot.to === open) return false;
  spot.to = open ? 1 : 0;
  return true;
}

/**
 * May somebody put a hand into this part of it now? Not if it has no such part; and what is behind a door is
 * reached only while the door stands OPEN, not while it swings either way: "must be open to interact with
 * inventory". (So the moment a door is pushed to, whoever was looking inside is looking at a door.)
 */
export function mayReach(spot: CookSpot, part: Part): boolean {
  const k = kindOf(spot);
  if (!k[part]) return false;
  return !k.door?.shuts.includes(part) || doorState(spot) === 'open';
}

// ------------------------------------------------------------------ its insides

/** a grid that takes only what belongs in it: a stove is not somewhere to keep a rifle */
class Grid extends Container {
  constructor(id: string, name: string, size: [number, number], items: Placed[], private readonly takes: (item: ItemInstance) => boolean) {
    super(id, name, size[0], size[1], items);
  }

  override accepts(item: ItemInstance): boolean {
    return this.takes(item) && super.accepts(item);
  }

  /**
   * Filled from a list, it is still held to what it takes. (Any other grid lays what a save says lay in it by room
   * alone. This one is filled from what a player's game sends, and a rifle is not kept in a firebox by being said
   * to have been there.) What does not belong, or has no room, comes back.
   */
  override load(data: { items: (ItemInstance & { x: number; y: number; rot: boolean })[] }): ItemInstance[] {
    this.items.length = 0;
    const overflow: ItemInstance[] = [];
    for (const d of data.items ?? []) {
      const { x, y, rot, ...raw } = d;
      const item = sanitizeItem(raw);
      if (!item) continue;
      const left = Number.isInteger(x) && Number.isInteger(y) && this.place(item, x, y, !!rot) ? null : this.add(item);
      if (left) overflow.push(left);
    }
    return overflow;
  }
}

/**
 * One of a spot's insides as an ordinary Container, so that the inventory screen shows it and things are moved in
 * and out of it as with any crate. It is a live view: what is put into it is in the spot. Its fuel slots take
 * only what burns and its food slots only what cooks. Null: this kind has no such part.
 * (It does not ask about the door. Ask `mayReach` before showing it, or use `putIn`, `takeOut` and `setGrid`.)
 * @param id what the container is to go by, where the screen or the server wants a name for it
 */
export function gridOf(spot: CookSpot, part: Part, id: string = part): Container | null {
  const size = kindOf(spot)[part];
  if (!size) return null;
  return new Grid(id, part === 'fuel' ? 'Fuel' : 'Cooking', size, spot[part], part === 'fuel' ? isFuel : cookable);
}

/**
 * A thing is put into a spot: fuel into its fuel slots, food onto the heat.
 * @returns what did not go in: nothing (null), the rest of a pile there was not room for, or the thing itself if
 *   it does not belong there or that part cannot be reached now
 */
export function putIn(spot: CookSpot, part: Part, item: ItemInstance): ItemInstance | null {
  const g = mayReach(spot, part) ? gridOf(spot, part) : null;
  return g && g.accepts(item) ? g.add(item) : item;
}

/**
 * A thing is taken out of a spot, by its own number. What comes back is the thing as it now is: `stageOf` and
 * `mealOf` say what it has become. Null: it is not there, or that part cannot be reached now.
 */
export function takeOut(spot: CookSpot, part: Part, uid: string): ItemInstance | null {
  if (!mayReach(spot, part)) return null;
  const i = spot[part].findIndex((p) => p.item.uid === uid);
  return i < 0 ? null : spot[part].splice(i, 1)[0].item;
}

/** What its kind wants stood on it is stood on it (the pot). False: it wants no such thing, has one, or this is not it. */
export function fit(spot: CookSpot, item: ItemInstance): boolean {
  if (spot.gear || kindOf(spot).needs !== item.id) return false;
  spot.gear = item;
  return true;
}

/** And is lifted off again. (What was cooking stays where it was, and stops cooking.) */
export function unfit(spot: CookSpot): ItemInstance | null {
  const was = spot.gear;
  spot.gear = null;
  return was;
}

/** Would anything put on it cook, were it lit? It has somewhere for food, and what its kind wants is stood on it. */
export function cooks(spot: CookSpot): boolean {
  const k = kindOf(spot);
  return !!k.food && (!k.needs || spot.gear?.id === k.needs);
}

// ------------------------------------------------------------------ its fire

export const isLit = (spot: CookSpot): boolean => spot.burn > 0;

/** the thing in its fuel slots that catches next: the one that burns the shortest, and of two alike the first as the grid is read */
function nextFuel(spot: CookSpot): Placed | null {
  let best: Placed | null = null;
  for (const p of spot.fuel) {
    const v = fuelOf(p.item.id);
    if (v <= 0) continue;
    const b = best ? fuelOf(best.item.id) : Infinity;
    if (v < b || (v === b && best && (p.y - best.y || p.x - best.x) < 0)) best = p;
  }
  return best;
}

/** one of what waits in its fuel slots catches, if there is any */
function draw(spot: CookSpot, k: CookKind): boolean {
  const next = nextFuel(spot);
  if (!next) return false;
  spot.burn += fuelOf(next.item.id) * k.lasts;
  if (--next.item.qty <= 0) spot.fuel.splice(spot.fuel.indexOf(next), 1);
  return true;
}

/** Seconds of burning it has left in all: what is alight, and everything waiting in its fuel slots. */
export function fuelLeft(spot: CookSpot): number {
  const k = kindOf(spot);
  return spot.burn + spot.fuel.reduce((s, p) => s + fuelOf(p.item.id) * Math.max(0, p.item.qty) * k.lasts, 0);
}

/**
 * Why it cannot be lit, or null if it can be. (Where somebody stands is the keeper's to ask: see `CookSpots.at`.)
 * @param has whether whoever would light it carries a thing, by its id (only a kind that wants an igniter asks)
 */
export function noLighting(spot: CookSpot, has: (id: string) => boolean = () => false): string | null {
  const k = kindOf(spot);
  if (isLit(spot)) return 'It is burning already';
  if (k.free <= 0 && !nextFuel(spot)) return 'There is nothing in it to burn';
  if (k.igniter && !IGNITERS.some(has)) return 'You have nothing to light it with';
  return null;
}

/**
 * It is lit: on nothing, for as long as its kind burns so, or else on the first of what is in its fuel slots.
 * The door has no say in it. False: it could not be (`noLighting` says why).
 */
export function light(spot: CookSpot, has?: (id: string) => boolean): boolean {
  if (noLighting(spot, has)) return false;
  const k = kindOf(spot);
  if (k.free > 0) spot.burn = k.free;
  else draw(spot, k);
  return true;
}

/** It is put out. What had not caught yet is still in its fuel slots. */
export function putOut(spot: CookSpot) {
  spot.burn = 0;
}

/** What it does for whoever rests by it, as it stands now: its kind's `warm`, lit; nothing, out. */
export const warmthOf = (spot: CookSpot) => (isLit(spot) ? kindOf(spot).warm : null);

// ------------------------------------------------------------------ time

/** What came of a stretch of time at one spot: what whoever keeps it has to tell people. */
export interface Happened {
  /** it went out */
  out: boolean;
  /** its door came to rest, open or shut */
  door: boolean;
  /** something in its fuel slots caught: they hold less than they did */
  fed: boolean;
  /** what was done in that time, and what was burned (the things themselves, still on it) */
  done: ItemInstance[];
  burned: ItemInstance[];
}

/** the heat of `litFor` seconds, which began at `from`, on everything that is on a spot */
function heat(spot: CookSpot, k: CookKind, litFor: number, from: number, what: Happened) {
  for (const p of spot.food) {
    const it = p.item as Food, r = own(COOKS, it.id);
    if (!r) continue;
    // A tin that has gone cold since it was last on the heat is a cold tin, and starts again. (What is cooked
    // stays cooked. And a tin said to be half warmed that was never marked hot has not been on any heat of ours.)
    if (r.how === 'warm' && stageOf(it) !== 'burned' && !((it.hot ?? -Infinity) >= from)) delete it.cook;
    const was = stageOf(it);
    it.cook = Math.min(r.takes + r.burns, (it.cook ?? 0) + litFor * k.speed);
    const is = stageOf(it);
    if (is === 'burned') delete it.hot;
    else it.hot = from + litFor + HEAT.keeps;
    if (is !== was) (is === 'burned' ? what.burned : what.done).push(it);
  }
}

/**
 * Time passes at a spot: its door swings, what is alight burns down, the next of its fuel catches or it goes out,
 * and what is on it cooks for as long as it was lit, and not a second longer. One long stretch comes to the same
 * as many short ones, so a keeper that looks in on a spot once a second and a game that does so every frame agree.
 * @param dt seconds gone by  @param now the wall clock at the END of them, seconds (see the top of this file)
 */
export function tick(spot: CookSpot, dt: number, now: number): Happened {
  const k = kindOf(spot), what: Happened = { out: false, door: false, fed: false, done: [], burned: [] };
  if (!num(dt) || dt <= 0) return what;
  if (k.door && spot.door !== spot.to) {
    const step = k.door.seconds > 0 ? dt / k.door.seconds : 1;
    spot.door = spot.to ? Math.min(1, spot.door + step) : Math.max(0, spot.door - step);
    // (seven tenths of a second in seven steps is not quite one: a hair short of home is home)
    if (Math.abs(spot.door - spot.to) < EPS) spot.door = spot.to;
    what.door = spot.door === spot.to;
  }
  if (spot.burn <= 0) return what;
  let left = dt, litFor = 0;
  while (left > 0 && spot.burn > 0) {
    const step = Math.min(left, spot.burn);
    spot.burn -= step;
    left -= step;
    litFor += step;
    if (spot.burn <= EPS) {
      spot.burn = 0;
      if (draw(spot, k)) what.fed = true;
    }
  }
  what.out = spot.burn <= 0;
  if (cooks(spot)) heat(spot, k, litFor, (num(now) ? now : 0) - dt, what);
  return what;
}

// ------------------------------------------------------------------ kept, sent, and read back

/** no grid is read past this many things: nobody's stove holds more, and whoever says theirs does is not listened to for long */
const MOST = 64;
/** nothing is said to burn longer than this, seconds */
const LONGEST = 86400;

/** one thing out of what somebody said, as a thing: an item there is, with a number of its own, and what cooking left on it */
function cleanThing(raw: unknown, now?: number): ItemInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, def = own(ITEMS, r.id);
  if (!def || typeof r.uid !== 'string' || !r.uid || r.uid.length > 64) return null;
  const it: ItemInstance = { uid: r.uid, id: def.id, qty: def.stack ? clamp(Math.floor(Number(r.qty) || 1), 1, def.stack) : 1 };
  if (def.use?.sips && num(r.left)) it.left = r.left;
  return sanitizeItem(keepCooked(it, r, now));
}

/**
 * Things are laid into one of a spot's grids out of a list somebody gave: each where it was said to lie if it
 * can, anywhere else if not, and not at all if it does not belong there. A list is read whether it is written as
 * this file keeps one ({ item, x, y, rot }) or as the server sends one (the item, with x, y and rot on it).
 */
function fill(spot: CookSpot, part: Part, raw: unknown, o: { now?: number; spilled?: ItemInstance[]; seen: Set<string>; mine?: Map<string, Food> }) {
  const g = gridOf(spot, part);
  if (!g || !Array.isArray(raw)) return;
  for (const e of raw.slice(0, MOST)) {
    if (!e || typeof e !== 'object') continue;
    const at = e as { item?: unknown; x?: unknown; y?: unknown; rot?: unknown };
    const it = cleanThing(at.item && typeof at.item === 'object' ? at.item : e, o.now) as Food | null;
    if (!it || o.seen.has(it.uid)) continue;
    o.seen.add(it.uid);
    // (what was on the spot already is as the spot knows it, whatever was said of it)
    const was = o.mine?.get(it.uid);
    if (was) keepCooked(it, was);
    const placed = Number.isInteger(at.x) && Number.isInteger(at.y) && g.place(it, at.x as number, at.y as number, !!at.rot);
    const left = placed ? null : g.add(it);
    if (left) o.spilled?.push(left);
  }
}

/**
 * What a player's game says one of a spot's grids holds now, after they moved things about in it: the server's
 * `cset`, for a stove. What was in it already keeps the cooking and the heat the SPOT has for it, whatever their
 * game said (theirs is as old as when they opened it); what is new to it brings what it carries.
 * @param items the list, as either end writes one
 * @returns what did not go in, to be handed back or dropped at their feet: things that do not belong in that
 *   grid, or that there was no room for. Null: that part cannot be reached now, and nothing was changed (tell
 *   their game what is really in it).
 */
export function setGrid(spot: CookSpot, part: Part, items: unknown, now?: number): ItemInstance[] | null {
  if (!mayReach(spot, part)) return null;
  const mine = new Map(spot[part].map((p) => [p.item.uid, p.item as Food]));
  const spilled: ItemInstance[] = [];
  spot[part].length = 0;
  fill(spot, part, items, { now, spilled, seen: new Set(), mine });
  return spilled;
}

/**
 * A spot out of whatever was written down for one: a file of the server's, or something sent. It never throws,
 * and what comes back is always a spot that could be: a kind there is, a door between shut and open (none, for a
 * kind without one), no more alight than can be, and in its grids only things that are items, belong there and
 * fit. What a true spot was written as comes back exactly as it was.
 * @param o `kind`: what stands there, when whoever reads knows better than what was written; `now`: the wall
 *   clock, to hold what is said to be hot to it; `spilled`: somewhere to put what no longer fits
 */
export function readSpot(raw: unknown, o: { kind?: string; now?: number; spilled?: ItemInstance[] } = {}): CookSpot {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const spot = newSpot(own(COOK_KINDS, o.kind) ? o.kind! : own(COOK_KINDS, r.kind) ? (r.kind as string) : LEAST), k = kindOf(spot);
  if (k.door) {
    spot.to = r.to === 1 ? 1 : 0;
    spot.door = num(r.door) ? clamp(r.door, 0, 1) : spot.to;
  }
  // (no more is ever alight at once than the kind burns on nothing, or the best of the fuel it takes gives)
  const most = Math.max(k.free, k.fuel ? Math.max(...Object.values(FUEL)) * k.lasts : 0);
  spot.burn = num(r.burn) ? clamp(r.burn, 0, most) : 0;
  // (one thing is in one place: a number met a second time, in either grid, is not read again)
  const uids = new Set<string>();
  for (const part of PARTS) fill(spot, part, r[part], { now: o.now, spilled: o.spilled, seen: uids });
  const gear = cleanThing(r.gear);
  if (gear && gear.id === k.needs && !uids.has(gear.uid)) spot.gear = gear;
  return spot;
}

/**
 * What everybody is told of a spot, whether or not they have it open: how far open its door stands, which way it
 * is going, and the seconds of burning it has left in all. It is enough for any game to draw it and to know when
 * it goes out.
 */
export type Seen = [door: number, to: 0 | 1, left: number];
export function seen(spot: CookSpot): Seen {
  return [Math.round(spot.door * 100) / 100, spot.to, Math.round(fuelLeft(spot) * 10) / 10];
}

/**
 * A spot as a game that has not opened it knows it, out of what it was told (`seen`): its door, and all the
 * burning it has left as if it were alight at once, with nothing in its grids. `tick` moves it as it moves the
 * real one, and it goes out at the same moment.
 */
export function shadow(kind: string, told: unknown): CookSpot {
  const spot = newSpot(own(COOK_KINDS, kind) ? kind : LEAST), t: unknown[] = Array.isArray(told) ? told : [];
  if (kindOf(spot).door) {
    spot.to = t[1] === 1 ? 1 : 0;
    spot.door = num(t[0]) ? clamp(t[0], 0, 1) : spot.to;
  }
  spot.burn = num(t[2]) ? clamp(t[2], 0, LONGEST) : 0;
  return spot;
}

// ------------------------------------------------------------------ all of them

/** how far above or below a spot somebody can be and still work it, or be warmed by it, metres: not through a floor */
const STOREY = 1.8;

/**
 * Every cooking spot there is, by whoever keeps count: the server, or the game playing alone; and in a game that
 * is on a server, what that game has been told of each. It is to cooking spots what `Hearths` is to the rings of
 * stones.
 */
export class CookSpots {
  readonly spots: CookSpot[];

  /** @param places where each stands and what kind it is, in the order the game and the server both count them (`y`: how high, where there are floors) */
  constructor(readonly places: { kind: string; x: number; z: number; y?: number }[]) {
    this.spots = places.map((p) => newSpot(p.kind));
  }

  /**
   * The spot numbered `i`, if there is one and somebody at (x, z) is near enough to work it; null otherwise.
   * @param slack how much further off than the rule says is still believed (a moving player, told late)
   * @param y how high they stand, where it is known: a stove is not worked through a floor
   */
  at(i: number, x: number, z: number, slack = 0, y?: number): CookSpot | null {
    const p = Number.isInteger(i) ? this.places[i] : undefined, s = p ? this.spots[i] : undefined;
    if (!p || !s || Math.hypot(p.x - x, p.z - z) > kindOf(s).reach + slack) return null;
    if (y !== undefined && p.y !== undefined && Math.abs(p.y - y) > STOREY + slack) return null;
    return s;
  }

  /** Time passes at all of them. @returns what happened, at each where anything did: [which, what] */
  tick(dt: number, now: number): [number, Happened][] {
    const out: [number, Happened][] = [];
    this.spots.forEach((s, i) => {
      if (s.burn <= 0 && s.door === s.to) return;
      const h = tick(s, dt, now);
      if (h.out || h.door || h.fed || h.done.length || h.burned.length) out.push([i, h]);
    });
    return out;
  }

  /** What the nearest lit spot does for somebody at (x, z), if they are near enough to one to be resting by it. */
  warmth(x: number, z: number, y?: number): { within: number; heal: number; meal: number } | null {
    let best: { within: number; heal: number; meal: number } | null = null, bd = Infinity;
    for (let i = 0; i < this.spots.length; i++) {
      const w = warmthOf(this.spots[i]), p = this.places[i], d = Math.hypot(p.x - x, p.z - z);
      if (!w || d > w.within || d >= bd || (y !== undefined && p.y !== undefined && Math.abs(p.y - y) > STOREY)) continue;
      best = w;
      bd = d;
    }
    return best;
  }

  /** Every one that is not as it was made (alight, or its door not shut): what somebody arriving is told. */
  told(): [number, Seen][] {
    const out: [number, Seen][] = [];
    this.spots.forEach((s, i) => {
      if (s.burn > 0 || s.door > 0 || s.to) out.push([i, seen(s)]);
    });
    return out;
  }

  /** A game is told how one stands (`seen`), and from then on knows it as that. (A Container had of it before is of the old one: ask `gridOf` again.) */
  hear(i: number, told: unknown) {
    if (this.places[i]) this.spots[i] = shadow(this.places[i].kind, told);
  }

  /** A game that has opened one is given all of it, as the server wrote it, and from then on knows it as that. */
  set(i: number, raw: unknown, now?: number) {
    if (this.places[i]) this.spots[i] = readSpot(raw, { kind: this.places[i].kind, now });
  }
}
