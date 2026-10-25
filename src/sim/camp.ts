// The trader camp (progression v3, the owner's yes 2026-10-25: "a trader camp with four stalls, like Rust's outpost ...
// Paid in scrap, which you carry and can lose when killed, instead of the book"; "Never overpowered: no top-tier gun,
// armour or steel plate on any shelf. A daily limit per player, and prices high enough that looting stays better"; "Jobs
// (three a day, as today) pay in scrap"). The trading post east of the village made over: its shop is the building
// stall, and three stalls stand on the yard before it (weapons, medical, clothing and gear), with a recycler. Within it
// nobody is hurt by anybody (Rust's outpost: a safe zone). Every price is data, here; the server judges every trade on
// its own copy of the pockets, and the game played alone by the same rules.

import { RNG } from '../core/noise';
import { ITEMS, type ItemInstance } from './items';
import { BUILDING_FOOTPRINT } from '../world/worldgen/layout';
import { roomOn, type LayerWorld } from './craft/layer';
import type { World } from '../world/worldgen';
import type { TradeDay } from '../net/protocol';
import { MAT } from './craft/materials';

export type StallId = 'building' | 'weapons' | 'medical' | 'clothing';

/** a thing a stall sells: how many a sale hands over, its price in scrap, and how many sales of it a player gets a day */
export interface Good {
  id: string;
  n: number;
  price: number;
  day: number;
}

interface Stall {
  name: string;
  /** what its trader says first */
  hello: string;
  sells: Good[];
  /** the kinds of thing it buys back */
  buys: string[];
}

const g = (id: string, n: number, price: number, day: number): Good => ({ id, n, price, day });

/** the four stalls: what each sells, for what, how many a day, and the kinds it buys (src/sim/items/ `category`) */
export const STALLS: Record<StallId, Stall> = {
  building: {
    name: 'Building supplies',
    hello: 'Nails are dear and they stay dear. Everybody wants them.',
    sells: [g('nails', 10, 50, 3), g('planks', 10, 15, 4), g('key_lock', 1, 40, 2), g('code_lock', 1, 150, 1), g('building_plan', 1, 10, 2), g('hardware', 1, 80, 1), g('stash_kit', 1, 50, 1)],
    buys: ['tool', 'misc'],
  },
  weapons: {
    name: 'Guns and rounds',
    hello: 'Plain guns and the rounds for them. The good ones you find yourself.',
    sells: [g('ammo_9mm', 20, 20, 4), g('ammo_45', 20, 24, 4), g('ammo_12', 10, 24, 3), g('ammo_762', 10, 30, 3), g('ammo_739', 20, 60, 2), g('mag_colt', 1, 25, 1), g('mag_m9', 1, 25, 1), g('clip_mosin', 1, 15, 2), g('gun_light', 1, 50, 1), g('red_dot', 1, 100, 1), g('grenade', 1, 60, 2), g('db12', 1, 140, 1), g('colt', 1, 175, 1), g('mosin9130', 1, 260, 1)],
    buys: ['weapon', 'ammo', 'magazine', 'attachment', 'melee'],
  },
  medical: {
    name: 'Medicine and food',
    hello: 'Dressings, drips, a splint. And something to eat.',
    sells: [g('bandage', 1, 12, 5), g('rags', 5, 8, 4), g('splint', 1, 15, 3), g('saline', 1, 35, 2), g('blood_bag', 1, 60, 1), g('aid_pouch', 1, 40, 2), g('rubbing_alcohol', 5, 15, 2), g('charcoal', 6, 12, 2), g('beans', 1, 8, 4), g('water_jug', 1, 8, 4)],
    buys: ['medical', 'food', 'drink'],
  },
  clothing: {
    name: 'Clothes and gear',
    hello: 'Something warm, something to carry it in.',
    sells: [g('field_jacket', 1, 40, 1), g('field_trousers', 1, 30, 1), g('patrol_cap', 1, 10, 2), g('fishermans_hat', 1, 10, 2), g('work_gloves', 1, 12, 2), g('rubber_boots', 1, 15, 2), g('sack_pack', 1, 60, 1), g('camping_pack', 1, 140, 1), g('flashlight', 1, 25, 2), g('compass', 1, 15, 1), g('binoculars', 1, 60, 1), g('gasmask', 1, 120, 1), g('radio', 1, 150, 1)],
    buys: ['clothing', 'stash'],
  },
};
export const STALL_IDS = Object.keys(STALLS) as StallId[];
// (a thing that is not an item in this build, base building's hardware before it lands, is not on the shelf)
for (const s of Object.values(STALLS)) s.sells = s.sells.filter((x) => ITEMS[x.id]);

export const CAMP = {
  /** what a stall pays for a thing, of what the thing is worth (`worth`, src/sim/items/): low, so that the camp is a sink, not a farm (the navigator) */
  back: 0.5,
  /** and for a thing it sells itself, at most this share of its own price */
  backOfPrice: 0.25,
  /** the most scrap a player is paid for things sold in a day, over every stall */
  soldADay: 150,
  /** the old book: credit paid out in scrap once, at so much a scrap, to so much at most */
  book: { per: 2, most: 250 },
  /** the safe zone: how far out from the yard's middle, m */
  safe: 40,
  /** how near a stall's counter a player must stand to trade, m (as near as to speak) */
  reach: 4.7,
};

/** what is never bought, from anybody (the Zone's own, and the money itself) */
const NEVER = new Set(['dogtag', 'keycard', MAT.scrap]);

/** a stall's good, by its item */
export const goodOf = (s: StallId, id: string) => STALLS[s].sells.find((x) => x.id === id);

/** what a stall pays for one of a thing (0: it does not take it) */
export function payEach(s: StallId, id: string): number {
  const def = ITEMS[id];
  if (!def || NEVER.has(id) || !STALLS[s].buys.includes(def.category)) return 0;
  const worth = def.open ? (ITEMS[def.open.gives]?.worth ?? 0) * def.open.qty : (def.worth ?? 0);
  let each = worth * CAMP.back;
  // (never more than a quarter of what any stall asks for it: nothing bought here is sold back for a profit)
  for (const st of Object.values(STALLS)) for (const x of st.sells) if (x.id === id) each = Math.min(each, (x.price / x.n) * CAMP.backOfPrice);
  return each;
}

/** what a stall pays for a thing as it is (a pile: all of it), whole scrap */
export function pays(s: StallId, it: ItemInstance): number {
  const each = payEach(s, it.id);
  if (each <= 0) return 0;
  return Math.max(1, Math.floor(each * (ITEMS[it.id].stack ? Math.max(1, it.qty) : 1)));
}

/** a day at the camp: the one kept, if it is today's, or a clean one */
export function dayFor(day: number, kept: Partial<TradeDay> | null | undefined): TradeDay {
  if (kept && kept.day === day) {
    const n = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Math.floor(Number(v))) : 0);
    return { day, bought: kept.bought && typeof kept.bought === 'object' ? { ...kept.bought } : {}, sold: n(kept.sold), done: Array.isArray(kept.done) ? kept.done.filter((x) => typeof x === 'string') : [], kills: n(kept.kills), heads: n(kept.heads) };
  }
  return { day, bought: {}, sold: 0, done: [], kills: 0, heads: 0 };
}

/** how many more sales of a good a player gets today */
export const leftToday = (good: Good, d: TradeDay) => Math.max(0, good.day - (d.bought[good.id] ?? 0));

/** what the old book's credit comes to in scrap */
export const bookScrap = (credit: number) => Math.min(CAMP.book.most, Math.max(0, Math.floor((Number(credit) || 0) / CAMP.book.per)));

// ---------------------------------------------------------------- where it stands

export interface StallSpot {
  id: StallId;
  x: number;
  y: number;
  z: number;
  /** which way its counter faces (its model's +x: drawn turned by FACE_TURN) */
  rot: number;
  /** where its trader stands, and faces */
  at: [number, number, number];
  yaw: number;
}

export interface Camp {
  /** the yard's middle (the safe zone is round it) */
  x: number;
  z: number;
  stalls: StallSpot[];
  /** the camp's recycler */
  recycler: { x: number; y: number; z: number; rot: number } | null;
}

/** a stall's model (made again from three pictures, the owner: "the trader stand looks very low quality") at the size it was made; how deep it is from its counter back, roof and all (its x), and how wide (its z); its trader behind its counter */
export const STALL = { model: 'trader_stall', scale: 1, l: 2.42, w: 2.8, behind: 0.15 };
/** what a model whose front is its +x (the stall, the recycler: the sandbox's front camera looks from +x) is turned by, past the way it faces */
export const FACE_TURN = -Math.PI / 2;
/** the shop's trader, behind its counter facing the door (src/game/trader.ts had him so) */
const SHOP_BEHIND = { x: -0.9, z: -0.45 };
const SEED = 0x7c4a11;

/** the trader camp, the same for the game and the server: the shop at the trading post, the stalls before it, its recycler */
export function campLayer(world: LayerWorld & Pick<World, 'sites'>): Camp | null {
  const post = world.sites.find((st) => st.kind === 'market');
  const shop = post && world.buildings.find((b) => b.type === 'store' && Math.hypot(post.x - b.x, post.z - b.z) < 40);
  if (!post || !shop) return null;
  const room = roomOn(world, true), rng = new RNG(SEED);
  const c = Math.cos(shop.rot), s = Math.sin(shop.rot), [, fd] = BUILDING_FOOTPRINT[shop.type] ?? [10, 10];
  // (the shop's own frame to the world's: its door faces its +z)
  const at = (lx: number, lz: number): [number, number] => [shop.x + lx * c + lz * s, shop.z - lx * s + lz * c];
  const [cx, cz] = at(0, fd / 2 + 12);
  const face = (x: number, z: number) => Math.atan2(cx - x, cz - z);
  const stalls: StallSpot[] = [{ id: 'building', x: shop.x, y: shop.floorY, z: shop.z, rot: shop.rot, at: [shop.x + SHOP_BEHIND.x * c + SHOP_BEHIND.z * s, shop.floorY, shop.z - SHOP_BEHIND.x * s + SHOP_BEHIND.z * c], yaw: shop.rot + Math.PI }];
  /** the nearest room to a place on the yard for a thing so big, facing the yard's middle */
  const lay = (lx: number, lz: number, l: number, w: number) => {
    for (let t = 0; t < 24; t++) {
      const j = t ? 1 + t * 0.35 : 0, a = rng.range(0, Math.PI * 2);
      const [x, z] = at(lx + Math.sin(a) * j, lz + Math.cos(a) * j), rot = face(x, z);
      const y = room.fit(x, z, l, w, rot, { margin: 1, road: 0.5, level: 0.5, sink: 0.05 });
      if (y === null) continue;
      room.stand(x, z, Math.hypot(l, w) / 2 + 0.6);
      return { x, y, z, rot };
    }
    return null;
  };
  for (const [id, lx, lz] of [['weapons', -10, fd / 2 + 13], ['medical', 10, fd / 2 + 13], ['clothing', 0, fd / 2 + 22]] as [StallId, number, number][]) {
    const p = lay(lx, lz, STALL.l, STALL.w);
    if (!p) continue;
    // (its trader behind the counter, facing out over it: the yaw a body faces +z of the stall by)
    const bx = p.x + Math.sin(p.rot) * STALL.behind, bz = p.z + Math.cos(p.rot) * STALL.behind;
    stalls.push({ id, ...p, at: [bx, p.y + 0.05, bz], yaw: p.rot + Math.PI });
  }
  const recycler = lay(-16, fd / 2 + 4, 1.6, 2.0);
  return { x: cx, z: cz, stalls, recycler };
}

/** whether a place is within the camp's safe zone */
export const inSafe = (camp: Camp | null, x: number, z: number) => !!camp && Math.hypot(x - camp.x, z - camp.z) < CAMP.safe;

// ---------------------------------------------------------------- a trade, judged (the server's, and the game's played alone)

const scrapName = () => ITEMS[MAT.scrap].name.toLowerCase();

/** buying a good from a stall, with so much scrap carried: the good, or why not */
export function mayBuy(s: StallId, id: string, d: TradeDay, scrap: number): Good | string {
  const good = goodOf(s, id);
  if (!good) return 'I do not sell that.';
  if (leftToday(good, d) <= 0) return 'No more of those today. Come back tomorrow.';
  if (scrap < good.price) return `That is ${good.price} ${scrapName()}. You have ${scrap}.`;
  return good;
}

/** selling a thing to a stall: what it is paid (within the day's most), or why not */
export function maySell(s: StallId, it: ItemInstance, d: TradeDay): number | string {
  if (it.cargo?.length) return 'Empty it first.';
  const p = pays(s, it);
  if (!p) return 'I do not deal in that. Try another stall.';
  const left = CAMP.soldADay - d.sold;
  if (left <= 0) return 'I have paid out all I will today.';
  return Math.min(p, left);
}
