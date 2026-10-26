// The trader camp (progression v3, the owner's yes 2026-10-25: "a trader camp with four stalls, like Rust's outpost ...
// Paid in scrap, which you carry and can lose when killed, instead of the book"; "Never overpowered: no top-tier gun,
// armour or steel plate on any shelf. A daily limit per player, and prices high enough that looting stays better"; "Jobs
// (three a day, as today) pay in scrap"). Its four stalls (building, weapons, medical, clothing and gear) each at a spot
// of its own out of the Zona, in the green west and the valley, with a recycler where one fits (the owner: "the trader
// zone must be moved from the red zone ... because this can be exploited"; "the traders should be spread out across the
// map (green west and the valley only)"). At each nobody is hurt by anybody (Rust's outpost), and no base is laid near. Every price is data, here; the server judges every trade on
// its own copy of the pockets, and the game played alone by the same rules.

import { RNG } from '../core/noise';
import { ITEMS, type ItemInstance } from './items';
import { roomOn, type LayerWorld } from './craft/layer';
import type { TradeDay } from '../net/protocol';
import { MAT } from './craft/materials';
import { TRADER_SPOTS } from './camp-place';

export type StallId = 'building' | 'weapons' | 'medical' | 'clothing';

/** a thing a stall sells: how many a sale hands over, its price in scrap, and how many sales of it a player gets a day (unsaid: no limit) */
export interface Good {
  id: string;
  n: number;
  price: number;
  day?: number;
}

interface Stall {
  name: string;
  /** what its trader says first */
  hello: string;
  sells: Good[];
  /** the kinds of thing it buys back */
  buys: string[];
}

const g = (id: string, n: number, price: number, day?: number): Good => ({ id, n, price, ...(day ? { day } : {}) });

/**
 * The four stalls: what each sells, for what, and the kinds it buys (src/sim/items/ `category`). No daily limit on what is
 * everyday (rounds, food, drink, medicine, building things, plain tools and clothes); a limit only on what would unbalance
 * the game bought freely: the guns, the sight, grenades, the gas mask (the way under the gas) and the radio (a drop called
 * in), the better the scarcer; and nails, which the owner wants looted ("they must be looted which is hard and time
 * consuming"). The owner: "im not a big fan of the trader supply limits some of them dont make sense".
 */
export const STALLS: Record<StallId, Stall> = {
  building: {
    name: 'Building supplies',
    hello: 'Nails are dear and they stay dear. Everybody wants them.',
    sells: [g('nails', 10, 50, 2), g('planks', 10, 15), g('key_lock', 1, 40), g('code_lock', 1, 150), g('building_plan', 1, 10), g('stash_kit', 1, 50)],
    buys: ['tool', 'misc'],
  },
  weapons: {
    name: 'Guns and rounds',
    hello: 'Plain guns and the rounds for them. The good ones you find yourself.',
    sells: [g('ammo_9mm', 20, 20), g('ammo_45', 20, 24), g('ammo_12', 10, 24), g('ammo_762', 10, 30), g('ammo_739', 20, 60), g('mag_colt', 1, 25), g('mag_m9', 1, 25), g('clip_mosin', 1, 15), g('gun_light', 1, 40), g('red_dot', 1, 100, 1), g('grenade', 1, 60, 2), g('mosin9130', 1, 120, 1), g('db12', 1, 140, 1), g('colt', 1, 150, 1)],
    buys: ['weapon', 'ammo', 'magazine', 'attachment', 'melee'],
  },
  medical: {
    name: 'Medicine and food',
    hello: 'Dressings, drips, a splint. And something to eat.',
    sells: [g('bandage', 1, 12), g('rags', 5, 8), g('splint', 1, 15), g('saline', 1, 35), g('blood_bag', 1, 60), g('aid_pouch', 1, 40), g('rubbing_alcohol', 5, 15), g('charcoal', 6, 12), g('beans', 1, 8), g('water_jug', 1, 8)],
    buys: ['medical', 'food', 'drink'],
  },
  clothing: {
    name: 'Clothes and gear',
    hello: 'Something warm, something to carry it in.',
    sells: [g('field_jacket', 1, 40), g('field_trousers', 1, 30), g('patrol_cap', 1, 10), g('fishermans_hat', 1, 10), g('work_gloves', 1, 12), g('rubber_boots', 1, 15), g('sack_pack', 1, 60), g('camping_pack', 1, 140), g('flashlight', 1, 25), g('compass', 1, 15), g('binoculars', 1, 60), g('gasmask', 1, 120, 1), g('radio', 1, 150, 1)],
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
  /** each trader's safe zone: how far out from its spot, m (the stall, its recycler and a little round them) */
  safe: 20,
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

/** how many more sales of a good a player gets today (no limit: Infinity) */
export const leftToday = (good: Good, d: TradeDay) => (good.day === undefined ? Infinity : Math.max(0, good.day - (d.bought[good.id] ?? 0)));

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
  /** each trader's spot (the safe zone is round each) */
  spots: { id: StallId; x: number; z: number; near: string }[];
  stalls: StallSpot[];
  /** the recyclers at the spots, where one fits */
  recyclers: { x: number; y: number; z: number; rot: number; at: string }[];
}

/** a stall's model (made again from three pictures, the owner: "the trader stand looks very low quality") at the size it was made; how deep it is from its counter back, roof and all (its x), and how wide (its z); its trader behind its counter */
export const STALL = { model: 'trader_stall', scale: 1, l: 2.42, w: 2.8, behind: 0.15 };
/** what a model whose front is its +x (the stall, the recycler: the sandbox's front camera looks from +x) is turned by, past the way it faces */
export const FACE_TURN = -Math.PI / 2;
/** each stall's mark on the maps: a coin of its colour with its letter (src/ui/minimap.ts, bigmap.ts) */
export const STALL_MARK: Record<StallId, { letter: string; colour: string }> = {
  building: { letter: 'B', colour: '#d1a654' },
  weapons: { letter: 'G', colour: '#e0703c' },
  medical: { letter: 'M', colour: '#5fc58e' },
  clothing: { letter: 'C', colour: '#7fb8ff' },
};
const SEED = 0x7c4a11;

/** the traders' spots, the same for the game and the server: a stall at each facing the road, and a recycler beside it where one fits */
export function campLayer(world: LayerWorld): Camp {
  const room = roomOn(world, true), rng = new RNG(SEED);
  const spots = TRADER_SPOTS.map((q) => ({ id: q.id as StallId, x: q.x, z: q.z, near: q.near }));
  const stalls: StallSpot[] = [], recyclers: Camp['recyclers'] = [];
  for (const q of spots) {
    // (its counter to the nearest road: the way people come)
    const r = nearestRoad(world, q.x, q.z), face = Math.atan2(r[0] - q.x, r[1] - q.z);
    /** the nearest room to a place for a thing so big, facing `rot` */
    const lay = (x0: number, z0: number, l: number, w: number, rot: number) => {
      for (let t = 0; t < 24; t++) {
        const j = t ? 1 + t * 0.4 : 0, a = rng.range(0, Math.PI * 2), x = x0 + Math.sin(a) * j, z = z0 + Math.cos(a) * j;
        const y = room.fit(x, z, l, w, rot, { margin: 1, road: 0.5, level: 0.6, sink: 0.05 });
        if (y === null) continue;
        room.stand(x, z, Math.hypot(l, w) / 2 + 0.6);
        return { x, y, z, rot };
      }
      return null;
    };
    const p = lay(q.x, q.z, STALL.l, STALL.w, face);
    if (!p) continue;
    const bx = p.x + Math.sin(p.rot) * STALL.behind, bz = p.z + Math.cos(p.rot) * STALL.behind;
    stalls.push({ id: q.id, ...p, at: [bx, p.y + 0.05, bz], yaw: p.rot + Math.PI });
    // (the recycler to the stall's side and a little before it, facing the same way)
    const sx = Math.cos(face), sz = -Math.sin(face), fx = Math.sin(face), fz = Math.cos(face);
    const rc = lay(p.x + sx * 5 + fx * 2, p.z + sz * 5 + fz * 2, 2.0, 1.6, face);
    if (rc) recyclers.push({ ...rc, at: `the ${STALLS[q.id].name.toLowerCase()} trader` });
  }
  return { spots, stalls, recyclers };
}

/** the nearest point of a road to a place */
function nearestRoad(world: LayerWorld, x: number, z: number): [number, number] {
  let best: [number, number] = [x, z + 1], d = Infinity;
  for (const r of world.roads) for (let i = 0; i + 5 < r.points.length; i += 3) {
    const ax = r.points[i], az = r.points[i + 2], vx = r.points[i + 3] - ax, vz = r.points[i + 5] - az, l2 = vx * vx + vz * vz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0, px = ax + vx * t, pz = az + vz * t, k = Math.hypot(px - x, pz - z);
    if (k < d && k > 1) (d = k), (best = [px, pz]);
  }
  return best;
}

/** whether a place is within a trader's safe zone */
export const inSafe = (camp: Camp | null, x: number, z: number) => !!camp && camp.spots.some((q) => Math.hypot(x - q.x, z - q.z) < CAMP.safe);

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
