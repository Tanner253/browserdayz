// Supply drops. Every few minutes, while anybody is playing, a crate of the best things on
// the map is set down somewhere in the open and everyone is told where. It is there for a
// few minutes, or until somebody has emptied it: a reason to cross the map, and a place
// where people meet. Rules and data only: the server runs them in multiplayer, the game
// itself when playing alone.

import { ITEMS, fitAtRandom, loadGun, makeItem, makeMag } from './items';
import type { Container } from './inventory';
import { BUILDING_FOOTPRINT, WORLD_SIZE, heightAt, inPlay, type World } from '../world/worldgen';
import { gasEdge, gasZone } from './gas';
import { UNDER_GAS } from './crates';

/**
 * A drop called down with a field radio: how long it takes to come (everybody is told where, and has that long
 * to get there), and how long after one call before the next is answered, map-wide.
 */
export const CALL = { eta: 45, every: 300, /** metres in front of the caller it comes down */ ahead: 3 };

/**
 * A helicopter comes down. Now and then, somewhere open on the map: its wreck, smoke that is seen from a long
 * way off, and its cargo beside it: a few things, of the kind kept under the gas. Everybody is told
 * where. One at a time; the wreck and whatever is left in it are cleared away after `life` seconds.
 */
export const CRASH = { every: 900, first: 300, life: 600, label: 'Helicopter Cargo', /** its crate's grid (a supply drop's is twice as deep) */ w: 8, h: 9, /** metres from the cargo to the middle of the wreck */ beside: 4.6 };

/** one of these is in every wreck's cargo: the things the gas is gone into for */
const CRASH_SURE = ['boonie_hat', 'life_vest', 'pu_scope', 'mosin'];

/**
 * What a wreck's cargo holds: little, and all of it of the fourth tier, the things kept under the gas (the
 * table those crates are filled from). One of the four things the gas is gone into for, always, and three or
 * four others, no two alike. (It held a supply drop's worth and eight things more: the most on the map, in a
 * meadow, for whoever walked up to the smoke.)
 */
export function fillCrash(c: Container, rnd: () => number = Math.random) {
  const ids = [CRASH_SURE[Math.floor(rnd() * CRASH_SURE.length)]];
  const more = 3 + Math.floor(rnd() * 2);
  for (let tries = 0; ids.length < 1 + more && tries < 60; tries++) {
    const id = pick(UNDER_GAS, rnd);
    if (!ids.includes(id)) ids.push(id);
  }
  for (const id of ids) {
    const def = ITEMS[id];
    const item = makeItem(id, def.fresh ?? def.stack ?? 1);
    if (def.weapon) {
      fitAtRandom(item, rnd);
      loadGun(item, 999);
    }
    c.add(item);
  }
}

export const DROP = {
  /** seconds from one drop to the next */
  every: 420,
  /** seconds after the first player turns up before the first one */
  first: 90,
  /** seconds a drop stays if nobody empties it */
  life: 360,
  /** seconds an emptied one stays before it is cleared away */
  linger: 20,
  /**
   * The crate's grid: eight across (the inventory is), and eighteen deep, twice what it was: it holds twice as
   * much (2026-10-11: "they should drop 2x the loot (bigger inventory of the container)"). A rifle laid in it is
   * nine long.
   */
  w: 8,
  h: 18,
  label: 'Supply Drop',
  /**
   * How far outside the Zona's line a drop comes down, at least and at most, metres (2026-10-11: "we have
   * helicopter crashes now so i think supply drops should spawn outside the zona, in the wilderness ... gives a
   * reason for people to explore"). A helicopter's cargo is what comes down inside it now.
   */
  out: [30, 260] as [number, number],
};

/**
 * TEMPORARY, THE SHOWCASE (2026-10-11; see SHOWCASE in src/sim/economy.ts): a drop also brings one of the new guns
 * with two magazines for it, a box of what it fires and something to fit to it ("and include all the T3 loot we
 * discussed here"). When the showcase is taken away this goes with it, or is cut down to what the drops are then
 * meant to bring.
 */
const SHOWCASE: { gun: string; mags: string[]; box: string; fits: string[] }[] = [
  { gun: 'ak', mags: ['mag_ak', 'mag_ak'], box: 'box_739', fits: ['suppressor_739', 'red_dot', 'drum_ak'] },
  { gun: 'ar15', mags: ['mag_ar', 'mag_ar'], box: 'box_556', fits: ['suppressor_556', 'red_dot', 'foregrip', 'gun_light', 'mag_ar_60'] },
  { gun: 'mpa', mags: ['mag_mpa', 'mag_mpa'], box: 'box_9mm', fits: ['suppressor_9', 'red_dot'] },
  { gun: 'benelli', mags: [], box: 'box_12', fits: ['suppressor_12', 'red_dot', 'gun_light'] },
];

export interface DropInfo {
  uid: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** seconds until it is cleared away */
  left: number;
  /** it is the cargo of a helicopter that came down: the wreck lies beside it (see CRASH) */
  heli?: boolean;
}

/** one of a weighted list */
function pick<T>(table: [T, number][], rnd: () => number): T {
  let r = rnd() * table.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of table) {
    r -= w;
    if (r <= 0) return v;
  }
  return table[table.length - 1][0];
}

/**
 * What is in one: both guns, loaded, each with a second magazine full and a box of rounds; something for a wound; a
 * scope, always; another part for one of the guns; and two or three of the things that are
 * hard to come by.
 */
export function fillDrop(c: Container, rnd: () => number = Math.random) {
  const put = (id: string, qty?: number) => {
    const def = ITEMS[id];
    const item = makeItem(id, qty ?? def.fresh ?? def.stack ?? 1);
    if (def.weapon) {
      fitAtRandom(item, rnd);
      loadGun(item, 999);
    }
    c.add(item);
  };
  for (const id of ['mosin', 'colt', 'box_762', 'box_45', 'firstaid', 'bandage', 'bandage', 'pu_scope']) put(id);
  for (const id of ['mag_sniper', 'mag_colt']) c.add(makeMag(id, 999));
  put(pick([['suppressor_9', 3], ['mag_colt', 3], ['rifle_wrap', 2]], rnd));
  const extras: [string, number][] = [['grenade', 3], ['grenade', 2], ['gasmask', 2], ['life_vest', 2], ['binoculars', 1.5], ['condensed', 1.5], ['thermos', 1.5], ['ammo_762', 2], ['ammo_45', 2]];
  // (twice what it brought, 2026-10-11: it is a long way out now, and worth the walk)
  const n = 2 * (2 + Math.floor(rnd() * 2));
  for (let i = 0; i < n; i++) put(pick(extras, rnd));
  for (const id of ['firstaid', 'stim', 'box_762', 'keycard']) put(id);
  // TEMPORARY, THE SHOWCASE: one of the new guns, loaded, with its magazines, its rounds and two things to fit to it
  const show = SHOWCASE[Math.floor(rnd() * SHOWCASE.length)];
  put(show.gun);
  for (const id of show.mags) c.add(makeMag(id, 999));
  put(show.box);
  put(show.box);
  const fits = [...show.fits];
  for (let k = 0; k < 2 && fits.length; k++) put(fits.splice(Math.floor(rnd() * fits.length), 1)[0]);
}

/**
 * Somewhere to set one down: open, level ground OUTSIDE the part of the map people play in (the Zona, the dotted
 * line on the map): the wild country round it, clear of buildings and trees, and not on the road. (It was inside,
 * anywhere from the village out to the ring of outlying places: `inside` is that, and is where a helicopter comes down.)
 */
export function pickDropSite(world: World, rnd: () => number = Math.random, inside = false): { x: number; y: number; z: number } | null {
  const H = world.heights;
  const road = world.road.points;
  const gas = gasZone(world.pois, (x, z) => heightAt(H, x, z));
  for (let tries = 0; tries < 200; tries++) {
    let x: number, z: number;
    if (inside) {
      // (a helicopter's cargo: inside the line, anywhere from the village out to the ring of outlying places, as a drop was)
      const a = rnd() * Math.PI * 2;
      const r = 40 + Math.sqrt(rnd()) * 250;
      x = 15 + Math.cos(a) * r;
      z = 5 + Math.sin(a) * r;
    } else {
      // anywhere on the map that is outside the line, by not too little and not too much, and not at the very edge of the world
      const edge = WORLD_SIZE / 2 - 45;
      x = (rnd() * 2 - 1) * edge;
      z = (rnd() * 2 - 1) * edge;
      if (inPlay(x, z, -DROP.out[0]) || !inPlay(x, z, -DROP.out[1])) continue;
    }
    const y = heightAt(H, x, z);
    // not into the gas: a drop is for whoever gets to it, not for whoever has a mask
    if (gas && gasEdge(gas, x, z) < 12) continue;
    // level enough to stand a crate on, and to fight round
    let steep = 0;
    for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) steep = Math.max(steep, Math.abs(heightAt(H, x + dx, z + dz) - y));
    if (steep > 0.5) continue;
    if (world.buildings.some((b) => {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      return Math.hypot(b.x - x, b.z - z) < Math.hypot(w, d) / 2 + 6;
    })) continue;
    if (world.trees.some((t) => Math.abs(t.x - x) < 3.5 && Math.abs(t.z - z) < 3.5)) continue;
    if (world.rocks.some((t) => Math.abs(t.x - x) < 3 && Math.abs(t.z - z) < 3) || world.props.some((t) => Math.abs(t.x - x) < 2.5 && Math.abs(t.z - z) < 2.5)) continue;
    let onRoad = false;
    for (let i = 0; i < road.length; i += 3) {
      if (Math.abs(road[i] - x) < world.road.width && Math.abs(road[i + 2] - z) < world.road.width) {
        onRoad = true;
        break;
      }
    }
    if (onRoad) continue;
    return { x, y, z };
  }
  return null;
}

/** the named place a spot is nearest to, and how far and which way from it ("120 m NE of Kamenka Farm") */
export function describeSpot(world: World, x: number, z: number): string {
  let best = world.pois[0], bd = Infinity;
  for (const p of world.pois) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return 'out in the open';
  if (bd < 45) return `at ${best.name}`;
  // north is -z, east is +x
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const dir = names[Math.round(Math.atan2(x - best.x, -(z - best.z)) / (Math.PI / 4) + 8) % 8];
  return `${Math.round(bd / 10) * 10} m ${dir} of ${best.name}`;
}
