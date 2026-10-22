import { GUNS } from './gunplay';
import { GUN_ITEMS } from './items/guns';
import { PART_ITEMS } from './items/parts';
import { KIT_ITEMS } from './items/kit';
import { WEAR_ITEMS } from './items/wear';
import { TOOL_ITEMS } from './items/tools';
import type { LootRule } from './items/rules';
import { lookOf } from '../../api/_lib/shop-items';
// Item database. Pure data; shared by the client UI, world spawning and the server.
// Grid sizes follow DayZ conventions (1 cell ~ 10 cm).

export type Category = 'weapon' | 'ammo' | 'magazine' | 'food' | 'drink' | 'medical' | 'melee' | 'tool' | 'misc' | 'stash' | 'attachment' | 'clothing';
/**
 * Physical equipment slots on the character: weapons and worn gear. Two things are carried slung on the back
 * (`primary`, `secondary`: a long gun, or something long to hit with), a sidearm in a holster, and that is all the
 * body has places for (2026-10-10, as DayZ has it: there was a place for a melee weapon, and there is not). A
 * knife or a hatchet goes in a pocket like anything else. What is in the hands is whatever was taken into them:
 * see `hold` on the inventory, and the hot keys, which are bound to things and not to places.
 *
 * What is worn has the places DayZ has (2026-10-13: "look up how dayz handles their equip slots, they have more than
 * we do ... we will need to make our player character equip more robust. like dayz, once again"): head, face, eyes,
 * top, vest, belt, legs, back, gloves, feet, armband. DayZ has no socks and no shirt under a jacket: its Top is one
 * place, and so is this. The jacket and the trousers a survivor stands in are things in `top` and `legs` now, and
 * their pockets are those things' own. (`hands` is the place for gloves, and keeps its name: every save says it.)
 * Nothing is made yet for `eyes`, `belt` or `armband`: the places are there, and empty.
 */
export type Slot = 'primary' | 'secondary' | 'holster' | 'head' | 'face' | 'eyes' | 'top' | 'vest' | 'belt' | 'legs' | 'back' | 'hands' | 'feet' | 'armband';
/** what kind of slot an item fits: long things fit either place on the back, gear fits its own slot */
export type SlotKind = 'long' | 'holster' | 'head' | 'face' | 'eyes' | 'top' | 'vest' | 'belt' | 'legs' | 'back' | 'hands' | 'feet' | 'armband';
export const SLOT_KIND: Record<Slot, SlotKind> = {
  primary: 'long', secondary: 'long', holster: 'holster',
  head: 'head', face: 'face', eyes: 'eyes', top: 'top', vest: 'vest', belt: 'belt', legs: 'legs', back: 'back', hands: 'hands', feet: 'feet', armband: 'armband',
};
export const WEAPON_SLOTS: Slot[] = ['primary', 'secondary', 'holster'];
export const GEAR_SLOTS: Slot[] = ['head', 'face', 'eyes', 'top', 'vest', 'belt', 'legs', 'back', 'hands', 'feet', 'armband'];
export const ALL_SLOTS: Slot[] = [...WEAPON_SLOTS, ...GEAR_SLOTS];
export const SLOT_LABEL: Record<Slot, string> = {
  primary: 'On the back', secondary: 'On the back', holster: 'Holster',
  head: 'Head', face: 'Face', eyes: 'Eyes', top: 'Top', vest: 'Vest', belt: 'Belt', legs: 'Legs', back: 'Back', hands: 'Gloves', feet: 'Feet', armband: 'Armband',
};
/** the places for what is worn as the inventory stands them either side of the survivor, each column from the top down */
export const DOLL_SLOTS: [Slot[], Slot[]] = [['head', 'face', 'eyes', 'top', 'vest', 'belt'], ['back', 'armband', 'hands', 'legs', 'feet']];
/** what every survivor stands in to begin with: its place on them, and the thing */
export const CLOTHES: [Slot, string][] = [['top', 'field_jacket'], ['legs', 'field_trousers']];

export type AttachSlot = 'optic' | 'muzzle' | 'magazine' | 'wrap' | 'light' | 'grip';

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  /** Poly Haven model id, or '@name' for a mesh built in code */
  model: string;
  /** node name inside the model when the file contains several objects */
  node?: string;
  /** regular expression over node names (several nodes make up the item) */
  nodeRe?: string;
  /** extra uniform scale for the world model */
  scale?: number;
  /**
   * A thing put down to keep other things in (category 'stash'): how many places wide and high it is inside, and
   * how big it stands on the ground beside the size its model was made (1 when not said). It is put down empty,
   * picked up empty, and with a shovel buried and dug up (see src/sim/stash.ts).
   */
  stash?: [number, number];
  place?: number;
  w: number;
  h: number;
  weight: number;
  category: Category;
  stack?: number;
  /** how many of it a new one is, where that is not six tenths of a full pile: a bandage is found one at a time, and carried five together */
  fresh?: number;
  slot?: SlotKind;
  use?: { verb: string; time: number; energy?: number; water?: number; health?: number; stopBleed?: boolean; /** sets a broken leg (see src/sim/injury.ts) */ splint?: boolean; /** breath given back, in hundredths of all there is */ stamina?: number; /** a bottle: it holds this many drinks (what `water` and `energy` say is one of them), is kept when it is empty, and is filled at a well */ sips?: number; /** and the kilograms of drink in a full one: it weighs that much less empty, and less with every drink */ drink?: number; /** seconds afterwards in which nothing costs any breath */ boost?: number; /** blood given back, ml, and the seconds it takes to run in (a bag of a drip: see src/sim/blood.ts) */ blood?: number; over?: number; /** taken into the hand first and held there: a click then uses it (see `ready` in src/game/game.ts) */ hold?: boolean; sound: 'eat' | 'drink' | 'bandage' | 'inject' | 'smoke' };
  /** thrown when used: seconds of fuse, damage at the centre, metres it reaches */
  throw?: { fuse: number; damage: number; radius: number };
  /** used, it calls a supply drop down where its user stands (see CALL in src/sim/drops.ts) */
  call?: boolean;
  /** looked through when used: how much of the normal field of view is left (0.2 = five times closer) */
  look?: number;
  /** ergo: how handy it is, 0..100. A handy gun comes up to the eye fast and follows a turn closely; a long heavy one does neither. */
  weapon?: {
    kind: 'rifle' | 'pistol' | 'auto';
    ammo: string;
    /** rounds in what feeds it: its own tube, or the magazine it is made with (a gun with a bigger one in it holds that one's) */
    capacity: number;
    /**
     * The magazine it is made with, if it is fed by one: a thing of its own (see `mag` on an item), found, carried,
     * filled by hand and put in. A gun with none in it fires what is in its chamber and no more. Without this the
     * gun is fed from its own tube, a round at a time.
     */
    mag?: string;
    ergo: number;
    modes?: ('semi' | 'auto')[];
    /** pieces of its model that are only there with an attachment on it (attachment -> pieces), and pieces that never are */
    shows?: Record<string, string[]>;
    /** the sight of its own that it is aimed through when fitted (an attachment no other gun takes), where it is not the holographic one */
    optic?: string;
    /** a scope that is part of the gun: aimed, it is looked through, as a rifle with the PU scope on */
    ownScope?: boolean;
    /** two of it, one in each hand: the left button fires the left one, the right button the right; not aimed down sights */
    akimbo?: boolean;
    /** what it fires in place of bullets: a grenade that flies and goes off where it strikes (src/sim/grenades.ts LAUNCHED) */
    launches?: string;
    /** a sight that is part of it: aimed, it is looked through, never along irons */
    fixedSight?: boolean;
    never?: string[];
    /** and pieces that are taken off when an attachment goes on in their place (attachment -> pieces): a brake, for a suppressor */
    hides?: Record<string, string[]>;
    /** how it is made ready after a shot, where its kind does not say: by hand (a bolt), or by itself */
    action?: 'bolt' | 'self';
    // (what it fires, how fast, how it kicks and what its sights are set for: src/sim/gunplay.ts, by its id)
    /** fed one at a time into a tube under the barrel, not by a magazine */
    tube?: boolean;
  };
  melee?: { damage: number; range: number; rate: number };
  /** a magazine: what it is filled with, and how many of them it holds (which guns take it is its `attach.fits`) */
  mag?: { ammo: string; capacity: number };
  /** sealed container (ammo box): opening it replaces the item with loose contents */
  open?: { gives: string; qty: number; time: number };
  /** world model shows this many copies of the mesh in a small pile (loose rounds) */
  pile?: number;
  /** worn gear: cargo grid it adds, damage it soaks */
  wear?: { cargo?: [number, number]; /** torso damage multiplier */ armor?: number; /** head damage multiplier */ head?: number; /** fall damage multiplier */ fall?: number; /** extra punch damage */ fist?: number; /** how fast thirst grows, as a multiplier */ thirst?: number; /** over the face, it keeps the gas out (see src/sim/gas.ts) */ gas?: number };
  /** weapon attachment: which weapons take it and where it mounts; what it does to the gun's handling score, and to its kick (a multiplier) */
  attach?: { fits: string[]; slot: AttachSlot; ergo?: number; recoil?: number; /** on the muzzle: it quiets the shot and hides the flash */ quiet?: boolean };
  /** its model's colours are multiplied by this (0xrrggbb): one model, told apart from another thing made of it */
  tint?: number;
  /** what is white on its model is painted this colour (0xrrggbb) and the rest keeps its own: see whiteTo in src/game/loot.ts */
  paint?: number;
  /** camera hint for the icon renderer */
  iconYaw?: number;
  /** its picture in the pockets taken under the lamps a gun's is (src/ui/icons.ts LAMPS): for a thing too dark under its own kind's */
  iconBright?: boolean;
  /** where and how much of it is found, and what it is found with: on DayZ's Central Economy (src/sim/items/rules.ts) */
  loot?: LootRule;
  /** what the trader gives for one, in credit (a thing that stacks: each of the stack); unsaid, he does not deal in it (src/sim/trade.ts) */
  worth?: number;
  /** he sells it too, so many to a player in a day */
  sells?: number;
}

// (the items themselves are in src/sim/items/, by sort, each with its loot rule and its price)

const D: ItemDef[] = [...GUN_ITEMS, ...PART_ITEMS, ...KIT_ITEMS, ...WEAR_ITEMS, ...TOOL_ITEMS];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(D.map((d) => [d.id, d]));

/** an item sitting at a grid position inside a container */
export interface Placed {
  item: ItemInstance;
  x: number;
  y: number;
  rot: boolean;
}

export interface ItemInstance {
  uid: string;
  id: string;
  qty: number;
  /** a gun: the rounds in it, in its magazine or its tube and the one in its chamber */
  loaded?: number;
  /** a gun fed by a magazine: the one in it (an item's id), or null with none in it. (Not said at all: a gun from before magazines were things, which is given the one it was made with: see sanitizeItem.) */
  mag?: string | null;
  /** a magazine: the rounds in it */
  rounds?: number;
  /** attachment item ids fitted to this weapon (not its magazine: see `mag`) */
  mods?: string[];
  /** a gun whose sights can be set: the range they are set for, metres (not said: how it comes; see GUNS in gunplay.ts) */
  zero?: number;
  /** contents of a bag or vest: they stay inside it when it is dropped or handed over */
  cargo?: Placed[];
  /** dog tag: the name stamped on it and that player's public id */
  owner?: string;
  pid?: string;
  /** dog tag: gold, a VIP's (the store's: it pays the same) */
  gold?: true;
  /** dog tag: public id of whoever carries it now, and for how many seconds they have */
  holder?: string;
  held?: number;
  /** a bottle (see `sips`): how many drinks are left in it */
  left?: number;
  /**
   * a gun with a store finish put on it (the shop's item id, 'deagle_gold'): it goes with the gun until the gun is
   * gone, Rust's way. Only ever the server's word (server/plates.ts); a game's own is not read.
   */
  finish?: string;
}

/**
 * seconds somebody else's dog tag has to be carried before it is cashed in
 * (thirty minutes since 2026-10-22, the owner: "move the payout timer to 20/30 again as well. to let treasury grow".
 * Twenty from 2026-10-19, thirty from 2026-10-18, fifteen from 2026-10-12, ten before that, and thirty before that.)
 */
export const TAG_HOLD = 30 * 60;
/**
 * The Zona is the played part of the map, the red line round it (PLAY_AREAS in the world's generator): tags are
 * earned inside it. The country outside is for stashes and for building. A tag taken off somebody and carried
 * over that line is void after this many seconds out there: no sitting out its fifteen minutes in the hills.
 */
export const TAG_OUT = 15;
/**
 * Whether the Zona's line voids tags carried over it, and keeps a tag off whoever dies outside it. On again since
 * 2026-10-19, the line now everything east of x -1950 (src/world/zona.ts; the owner: "we should add the zona back so
 * dogtags are void along the coast"); off from 2026-10-18 until then. Down a basement voids them, after TAG_OUT,
 * whatever this says; and while it is off the maps draw no line.
 */
export const ZONA_VOID = true;
/**
 * Seconds somebody has to have been alive before there is a tag on their body at all. Whoever has just arrived
 * has nothing on them worth a reward, and is not to be farmed for one where they are set down. (Twenty minutes since
 * 2026-10-22, with TAG_HOLD's thirty; ten from 2026-10-19, twenty from 2026-10-18, ten from 2026-10-12, five before.)
 */
export const TAG_FRESH = 20 * 60;
/**
 * Seconds a dog tag lies on the ground before it is gone, whoever is standing by it (the owner, 2026-10-17: "dogtags
 * dropped on the ground should despawn after 10 mins, so people cant leave them in the world for too long and come back
 * later to circumvent stashing them").
 */
export const TAG_GROUND = 10 * 60;
/** the same in minutes, for everything that says so in words */
export const TAG_HOLD_MIN = TAG_HOLD / 60;

/** time left on a carried dog tag, as m:ss */
export function tagClock(it: ItemInstance): string {
  const left = Math.max(0, Math.ceil(TAG_HOLD - (it.held ?? 0)));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/** what an item is called: a dog tag carries its owner's name */
export function itemName(it: ItemInstance): string {
  const d = ITEMS[it.id];
  if (it.id === 'dogtag' && it.owner) return `${tagOwner(it)}'s Dog Tag`;
  const look = lookOf(it.finish);
  return look ? `${look === 'gold' ? 'Gold' : 'Nickel'}-plated ${d.name}` : d.name;
}

/** the name stamped on a tag, safe to put into markup (it was typed by another player) */
export function tagOwner(it: ItemInstance): string {
  return (it.owner ?? '').replace(/[<>&"']/g, '').slice(0, 16) || 'Survivor';
}

let uidCounter = 0;
export function newUid() {
  return `${Date.now().toString(36)}-${(uidCounter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeItem(id: string, qty?: number): ItemInstance {
  const def = ITEMS[id];
  if (!def) throw new Error(`unknown item ${id}`);
  const it: ItemInstance = { uid: newUid(), id, qty: qty ?? def.fresh ?? (def.stack ? Math.max(1, Math.round(def.stack * 0.6)) : 1) };
  if (def.weapon) {
    it.loaded = 0;
    if (def.weapon.mag) it.mag = null;
  }
  if (def.mag) it.rounds = 0;
  if (def.use?.sips) it.left = def.use.sips;
  return it;
}

// ------------------------------------------------------------------ magazines, and what feeds a gun
//
// A gun fed by a magazine holds what its magazine holds and one more, in its chamber. Pull the magazine out of a
// gun that has been firing and one round stays behind: put a full one in and the gun is one over. A gun with no
// magazine in it has its chamber and nothing else. Every count below keeps to that, and nothing here makes a
// round or loses one: what goes into a gun came out of a magazine, and what goes into a magazine came out of a
// pocket.

/** How often a gun put into the world has its magazine in it, and how full that is at most (a share of what it holds). */
export const FOUND_WITH_MAG = { chance: 0.6, full: 0.6 };

/** Is this a bag of blood or salt water, run into the arm? (a kit or a pouch gives blood too, but closes wounds as well) */
export function isBag(id: string): boolean {
  const u = ITEMS[id]?.use;
  return !!u?.blood && !u.stopBleed;
}

/** Is this gun fed by a magazine that comes out? (the others by their own tube, a round at a time) */
export function magFed(id: string): boolean {
  return !!ITEMS[id]?.weapon?.mag;
}

/** what the magazine in a gun holds (0 with none in it, or for a gun that takes none) */
export function magRoom(gun: ItemInstance): number {
  return (gun.mag ? ITEMS[gun.mag]?.mag?.capacity : 0) ?? 0;
}

/** Is there a round in its chamber? (any gun with a round in it has one there: it is the first to go) */
export function chambered(gun: ItemInstance): boolean {
  return (gun.loaded ?? 0) > 0;
}

/** Does this magazine go into this gun? */
export function magFits(mag: ItemInstance | string, gun: ItemInstance | string): boolean {
  const m = ITEMS[typeof mag === 'string' ? mag : mag.id], g = typeof gun === 'string' ? gun : gun.id;
  return !!m?.mag && m.attach?.slot === 'magazine' && m.attach.fits.includes(g);
}

/** A magazine, made with this many rounds in it (no more than it holds). */
export function makeMag(id: string, rounds = 0): ItemInstance {
  const it = makeItem(id);
  it.rounds = Math.max(0, Math.min(ITEMS[id].mag?.capacity ?? 0, Math.floor(rounds)));
  return it;
}

/**
 * One magazine out of a gun and another in (or none in, with `next` null: it is taken out and that is all).
 * The round in the chamber stays where it is.
 * @returns the magazine that came out, with what was in it, or null if there was none in the gun
 */
export function swapMag(gun: ItemInstance, next: ItemInstance | null): ItemInstance | null {
  if (!magFed(gun.id) || (next && !magFits(next, gun))) return null;
  const inChamber = chambered(gun) ? 1 : 0;
  const out = gun.mag ? makeMag(gun.mag, (gun.loaded ?? 0) - inChamber) : null;
  gun.mag = next ? next.id : null;
  gun.loaded = inChamber + (next ? Math.min(next.rounds ?? 0, ITEMS[next.id].mag!.capacity) : 0);
  return out;
}

/**
 * Rounds in a gun as it is put into the world: as many of these as it has room for as it is, which with no
 * magazine in a gun that needs one is none. (No extra one for the chamber: that comes of changing magazines.)
 */
export function stockGun(gun: ItemInstance, rounds: number): ItemInstance {
  const w = ITEMS[gun.id].weapon;
  if (w) gun.loaded = Math.max(0, Math.min(Math.floor(rounds), w.mag ? magRoom(gun) : w.capacity));
  return gun;
}

/**
 * The magazine a reload puts into a gun, of those carried for it: the fullest of the kind that is in it (with none
 * in it, the kind it is made with), if that is fuller than what the gun has; and only failing that, the fullest of
 * any other kind it takes. (It was the fullest of any kind: a rifle with a thirty in it and a drum in the pack was
 * given the drum by every reload, which is nobody's idea of changing a magazine. The big one is put in by hand, or
 * when there is nothing else with a round in it.) Null: nothing carried is fuller than what is in it.
 */
export function nextMag(gun: ItemInstance, carried: ItemInstance[]): ItemInstance | null {
  const w = ITEMS[gun.id]?.weapon;
  if (!w?.mag) return null;
  const inGun = gun.mag ? Math.max(0, (gun.loaded ?? 0) - (chambered(gun) ? 1 : 0)) : 0;
  const fuller = carried.filter((mg) => magFits(mg.id, gun.id) && (mg.rounds ?? 0) > inGun);
  const best = (list: ItemInstance[]) => list.reduce<ItemInstance | null>((a, b) => (!a || (b.rounds ?? 0) > (a.rounds ?? 0) ? b : a), null);
  const kind = gun.mag ?? w.mag;
  return best(fuller.filter((mg) => mg.id === kind)) ?? best(fuller);
}

/** The same for a gun that is to be a gun that fires, whatever the dice said: its magazine is put in it first, if it has none. */
export function loadGun(gun: ItemInstance, rounds: number): ItemInstance {
  const w = ITEMS[gun.id].weapon;
  if (w?.mag && !gun.mag) gun.mag = w.mag;
  return stockGun(gun, rounds);
}

/** How full a magazine found lying by itself is: nothing in it up to FOUND_WITH_MAG.full of what it holds. @param rnd 0..1 */
export function foundMag(mag: ItemInstance, rnd: () => number): ItemInstance {
  const cap = ITEMS[mag.id].mag?.capacity ?? 0;
  mag.rounds = Math.floor(rnd() * (cap * FOUND_WITH_MAG.full + 1));
  return mag;
}

/** Rounds pushed into a magazine. @returns how many went in (what it had room for) */
export function fillMag(mag: ItemInstance, rounds: number): number {
  const room = (ITEMS[mag.id].mag?.capacity ?? 0) - (mag.rounds ?? 0);
  const n = Math.max(0, Math.min(room, Math.floor(rounds)));
  mag.rounds = (mag.rounds ?? 0) + n;
  return n;
}

/** Everything fitted to a gun that its model shows: its attachments, and its magazine. */
export function fittedOf(it: ItemInstance | null | undefined): string[] {
  return it ? [...(it.mods ?? []), ...(it.mag ? [it.mag] : [])] : [];
}

/**
 * Now and then a gun is found with something already fitted to it: [what, how often], one
 * roll each. The scope is the best thing on the map and stays the rarest: one rifle in
 * forty has one on it. (Each is still found on its own as well.) Said on each gun: its `loot.fitted`.
 */
export const FITTED: Record<string, [string, number][]> = Object.fromEntries(D.filter((d) => d.loot?.fitted).map((d) => [d.id, d.loot!.fitted!]));

/** Rolls for what a gun put into the world comes with. @param rnd 0..1, the caller's own dice */
export function fitAtRandom(item: ItemInstance, rnd: () => number): ItemInstance {
  for (const [mod, chance] of FITTED[item.id] ?? []) {
    // (a long magazine is a magazine: it goes where the magazine goes, with nothing in it yet)
    if (rnd() >= chance) continue;
    if (ITEMS[mod]?.mag) item.mag = mod;
    else if (!item.mods?.includes(mod)) (item.mods ??= []).push(mod);
  }
  // (and more often than not, the one it was made with: a gun found is not always a gun that can be fired twice)
  const w = ITEMS[item.id].weapon;
  if (w?.mag && !item.mag && rnd() < FOUND_WITH_MAG.chance) item.mag = w.mag;
  return item;
}

/** the magazines that are the bunker's and nobody else's: the AK's drum and the AR-15's sixty */
export const BUNKER_MAGS = new Set(['drum_ak', 'mag_ar_60']);
/**
 * A gun found outside the bunker has not one of the bunker's magazines in it, whatever the dice gave it: the
 * one it was made with instead. (2026-10-13: one AK in twenty-five came with the drum and one AR-15 in twenty with
 * the sixty, in a supply drop, under the gas, wherever a gun was put down: "the bunker's and nobody else's" was
 * not so.)
 */
export function plainMag(item: ItemInstance): ItemInstance {
  if (item.mag && BUNKER_MAGS.has(item.mag)) item.mag = ITEMS[item.id].weapon?.mag ?? null;
  return item;
}

/** Is this fitted to it? (an attachment, or the magazine that is in it) */
export function hasMod(it: ItemInstance | null | undefined, id: string) {
  return !!it?.mods?.includes(id) || (!!it?.mag && it.mag === id);
}

/** Is this piece of a gun's model there, with these attachments on the gun? (see `shows` and `never` on the weapon) */
export function pieceShown(id: string, piece: string, mods: string[] = []): boolean {
  const w = ITEMS[id]?.weapon;
  if (!w) return true;
  if (w.never?.includes(piece)) return false;
  for (const [mod, pieces] of Object.entries(w.hides ?? {})) if (pieces.includes(piece) && mods.includes(mod)) return false;
  for (const [mod, pieces] of Object.entries(w.shows ?? {})) if (pieces.includes(piece)) return mods.includes(mod);
  return true;
}

/** The most rounds this gun can have in it as it is: its tube's worth, or its magazine's and the one in its chamber. */
export function capacityOf(it: ItemInstance): number {
  const w = ITEMS[it.id].weapon;
  if (!w) return 0;
  return w.mag ? magRoom(it) + 1 : w.capacity;
}

/** Is something on its muzzle that quiets it? (a quieted shot shows no flash, carries a fraction as far, and hits a little softer) */
export function quietOf(it: ItemInstance | null | undefined): boolean {
  return !!it && (!!GUNS[it.id]?.quiet || canOf(it));
}

/** a suppressor fitted to it (not one that is part of it): what slows its round (QUIETED) */
export function canOf(it: ItemInstance | null | undefined): boolean {
  return !!it?.mods?.some((m) => ITEMS[m]?.attach?.quiet);
}

/** weight of an item with everything fitted to it and packed inside it */
/**
 * How a gun handles with what is fitted to it: its handling score (0..100), what it weighs
 * in the hands, and how hard it kicks next to the bare gun. Null for anything that is not a gun.
 */
export function handlingOf(it: ItemInstance | null | undefined): { ergo: number; weight: number; recoil: number } | null {
  const w = it ? ITEMS[it.id]?.weapon : undefined;
  if (!it || !w) return null;
  let ergo = w.ergo, recoil = 1, weight = ITEMS[it.id].weight;
  for (const m of fittedOf(it)) {
    const d = ITEMS[m];
    if (!d) continue;
    ergo += d.attach?.ergo ?? 0;
    recoil *= d.attach?.recoil ?? 1;
    weight += d.weight;
  }
  return { ergo: Math.max(5, Math.min(100, ergo)), weight, recoil };
}

export function itemWeight(it: ItemInstance): number {
  const d = ITEMS[it.id];
  let w = d.weight * (d.stack ? it.qty : 1);
  // (a bottle weighs what is left in it: its own weight is of a full one)
  if (d.use?.sips && d.use.drink) w -= d.use.drink * (1 - (it.left ?? d.use.sips) / d.use.sips);
  for (const m of fittedOf(it)) w += ITEMS[m]?.weight ?? 0;
  // (the rounds in a magazine and in a gun weigh what they weigh loose)
  if (d.mag) w += (it.rounds ?? 0) * (ITEMS[d.mag.ammo]?.weight ?? 0);
  if (d.weapon) w += (it.loaded ?? 0) * (ITEMS[d.weapon.ammo]?.weight ?? 0);
  for (const p of it.cargo ?? []) w += itemWeight(p.item);
  return w;
}

/** drop anything a save refers to that no longer exists */
/** things that are gone, and what one of them carried from before is now: the Pistol 43 and its magazines (2026-10-11) */
const NOW: Record<string, string> = { p38: 'colt', mag_p38: 'mag_colt', mag_p38_ext: 'mag_colt', mp7_sight: 'red_dot' };
/** a part fitted to a gun since replaced by another that sits where it did: the MP7's own sight is the holographic sight */
const MOD_NOW: Record<string, string> = { mp7_sight: 'red_dot' };

/**
 * How big a thing is inside, if things are kept in it: a bag or a vest that is worn, or a stash, which keeps what
 * is in it while it is carried (a stash case picked up full is put down full).
 */
export const holds = (id: string): [number, number] | undefined => ITEMS[id]?.wear?.cargo ?? ITEMS[id]?.stash;

export function sanitizeItem(it: ItemInstance): ItemInstance | null {
  if (it && NOW[it.id]) it.id = NOW[it.id];
  if (it?.mag && NOW[it.mag]) it.mag = NOW[it.mag];
  if (it?.mods) it.mods = it.mods.map((m) => MOD_NOW[m] ?? m).filter((m) => !NOW[m]);
  if (!it || !ITEMS[it.id]) return null;
  // (a bottle from before bottles were counted is a full one)
  const sips = ITEMS[it.id].use?.sips;
  if (sips) it.left = Math.max(0, Math.min(sips, Math.floor(Number(it.left ?? sips))));
  else delete it.left;
  const d = ITEMS[it.id];
  if (d.weapon?.mag) {
    // A gun from before magazines were things had its rounds in itself, and a long magazine among what was fitted
    // to it: it is given that one, or the one it was made with, and keeps what was in it.
    const was = it.mods?.find((m) => magFits(m, it.id));
    if (it.mag === undefined) it.mag = was ?? d.weapon.mag;
    else if (it.mag !== null && !magFits(it.mag, it.id)) it.mag = null;
    it.loaded = Math.max(0, Math.min(capacityOf(it), Math.floor(Number(it.loaded) || 0)));
  } else delete it.mag;
  if (d.mag) it.rounds = Math.max(0, Math.min(d.mag.capacity, Math.floor(Number(it.rounds) || 0)));
  else delete it.rounds;
  // (its sights: one of the ranges that gun's can be set for, or as it comes)
  if (it.zero !== undefined && !(d.weapon && GUNS[it.id]?.zero.includes(it.zero))) delete it.zero;
  if (it.mods) it.mods = it.mods.filter((m) => !ITEMS[m]?.mag && ITEMS[m]?.attach?.fits.includes(it.id));
  if (it.cargo) {
    it.cargo = it.cargo.filter((p) => p && p.item && sanitizeItem(p.item));
    if (!holds(it.id)) delete it.cargo;
  }
  return it;
}
