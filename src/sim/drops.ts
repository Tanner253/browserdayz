// Supply drops. Every few minutes, while anybody is playing, a crate of the best things on
// the map is set down somewhere in the open and everyone is told where. It is there for a
// few minutes, or until somebody has emptied it: a reason to cross the map, and a place
// where people meet. Rules and data only: the server runs them in multiplayer, the game
// itself when playing alone.

import { ITEMS, fitAtRandom, makeItem } from './items';
import type { Container } from './inventory';
import { BUILDING_FOOTPRINT, heightAt, type World } from '../world/worldgen';
import { gasEdge, gasZone } from './gas';

/**
 * A drop called down with a field radio: how long it takes to come (everybody is told where, and has that long
 * to get there), and how long after one call before the next is answered, map-wide.
 */
export const CALL = { eta: 45, every: 300, /** metres in front of the caller it comes down */ ahead: 3 };

/**
 * A helicopter comes down. Now and then, somewhere open on the map: its wreck, smoke that is seen from a long
 * way off, and its cargo beside it, which is the army's and better than a supply drop's. Everybody is told
 * where. One at a time; the wreck and whatever is left in it are cleared away after `life` seconds.
 */
export const CRASH = { every: 900, first: 300, life: 600, label: 'Helicopter Cargo', /** metres from the cargo to the middle of the wreck */ beside: 4.6 };

/** what a wreck's cargo holds: a supply drop's worth, and the army's own on top of it */
export function fillCrash(c: Container, rnd: () => number = Math.random) {
  fillDrop(c, rnd);
  for (const [id, qty] of [['m9', undefined], ['box_9mm', undefined], ['box_762', undefined], ['grenade', undefined], ['boonie_hat', undefined], ['life_vest', undefined], ['firstaid', undefined], ['red_dot', undefined]] as [string, number | undefined][]) {
    const def = ITEMS[id];
    const item = makeItem(id, qty ?? (def.stack ? def.stack : 1));
    if (def.weapon) {
      item.loaded = def.weapon.capacity;
      fitAtRandom(item, rnd);
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
  /** the crate's grid: nine deep, because that is what a rifle laid in it takes (it is nine long, and the inventory is eight across) */
  w: 8,
  h: 9,
  label: 'Supply Drop',
};

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
 * What is in one: both guns, loaded, with a box of rounds each; something for a wound; a
 * scope, always; another part for one of the guns; and two or three of the things that are
 * hard to come by.
 */
export function fillDrop(c: Container, rnd: () => number = Math.random) {
  const put = (id: string, qty?: number) => {
    const def = ITEMS[id];
    const item = makeItem(id, qty ?? (def.stack ? def.stack : 1));
    if (def.weapon) {
      item.loaded = def.weapon.capacity;
      fitAtRandom(item, rnd);
    }
    c.add(item);
  };
  for (const id of ['mosin', 'p38', 'box_762', 'box_9mm', 'firstaid', 'bandage', 'bandage', 'pu_scope']) put(id);
  put(pick([['suppressor_9', 3], ['mag_p38_ext', 3], ['rifle_wrap', 2]], rnd));
  const extras: [string, number][] = [['grenade', 3], ['grenade', 2], ['gasmask', 2], ['life_vest', 2], ['binoculars', 1.5], ['condensed', 1.5], ['thermos', 1.5], ['ammo_762', 2], ['ammo_9mm', 2]];
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) put(pick(extras, rnd));
}

/**
 * Somewhere to set one down: open, level ground inside the part of the map people play
 * in, clear of buildings and trees, and not on the road.
 */
export function pickDropSite(world: World, rnd: () => number = Math.random): { x: number; y: number; z: number } | null {
  const H = world.heights;
  const road = world.road.points;
  const gas = gasZone(world.pois, (x, z) => heightAt(H, x, z));
  for (let tries = 0; tries < 200; tries++) {
    // anywhere from the village out to the ring of outlying places
    const a = rnd() * Math.PI * 2;
    const r = 40 + Math.sqrt(rnd()) * 250;
    const x = 15 + Math.cos(a) * r, z = 5 + Math.sin(a) * r;
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
