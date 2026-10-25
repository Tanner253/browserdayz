// Salvage's wrecks (2026-10-25, plan-crafting: "Scrap comes off the Zone's own wrecks: Ladas, ZILs, rusted kolkhoz
// tractors"): a layer of their own, laid after everything else with a seed of their own, so that nothing the map already
// has moves (the navigator: "New wrecks are allowed only in a layer of their own: own seed, placed after everything else,
// so nothing existing moves"; generateWorld is left as it is). A tractor or a heap of junk in the yard of a barn, a shed
// or the sawmill; a ZIL, a Pirozhok or a heap of junk beside a garage or the works; each on open, level ground, clear of
// every building, road, tree, rock and thing already there, and sunk a little into it where it meets it.

import { RNG } from '../../core/noise';
import { heightAt } from '../../world/worldgen/ground';
import { BUILDING_FOOTPRINT } from '../../world/worldgen/layout';
import type { World } from '../../world/worldgen';
import { wetAt } from '../build/land';
import type { SalvageSpot } from './salvage';

/** each wreck: its model, its name, its fragments and scrap, and how long and wide it lies, m */
export const WRECK_KINDS = {
  zil: { model: 'zil_wreck', name: 'ZIL truck', frags: 40, scrap: 5, l: 6.6, w: 2.6 },
  tractor: { model: 'tractor_wreck', name: 'tractor', frags: 30, scrap: 4, l: 4.2, w: 2.4 },
  pirozhok: { model: 'pirozhok_wreck', name: 'car', frags: 22, scrap: 3, l: 4.0, w: 1.7 },
  junk: { model: 'junk_heap', name: 'heap of junk', frags: 22, scrap: 6, l: 3.0, w: 2.3 },
} as const;
export type WreckKind = keyof typeof WRECK_KINDS;

export interface Wreck {
  kind: WreckKind;
  x: number;
  y: number;
  z: number;
  rot: number;
}

/** what is laid beside each kind of building */
const BESIDE: Partial<Record<string, WreckKind[]>> = {
  barn: ['tractor', 'junk'],
  shed: ['junk', 'tractor'],
  sawmill: ['tractor', 'junk'],
  garage: ['zil', 'pirozhok', 'junk'],
  police_garage: ['pirozhok', 'zil'],
  works_hall: ['zil', 'junk'],
  works_office: ['pirozhok', 'zil'],
};
/** the layer's own seed; how many at most, and of each kind; how far apart, m */
const SEED = 0x5c4a77, MOST = 30, EACH: Record<WreckKind, number> = { zil: 8, pirozhok: 8, tractor: 10, junk: 10 }, APART = 55;
/** the works first (fewer of them), then the farms */
const WORKS = new Set(['garage', 'police_garage', 'works_hall', 'works_office']);

/** the wrecks' layer, the same for the game and the server (the world as generateWorld makes it) */
export function wreckLayer(world: Pick<World, 'heights' | 'buildings' | 'roads' | 'props' | 'trees' | 'rocks' | 'water'>): Wreck[] {
  const rng = new RNG(SEED), ground = (x: number, z: number) => heightAt(world.heights, x, z), wet = wetAt(world.water, ground);
  // (what stands already, in cells of 8 m: a wreck keeps clear of every one of them)
  const CELL = 8, cells = new Map<string, { x: number; z: number; r: number }[]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const stand = (x: number, z: number, r: number) => {
    const k = key(x, z);
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push({ x, z, r });
  };
  for (const list of [world.props, world.trees, world.rocks]) for (const t of list) stand(t.x, t.z, 0.6 + 0.6 * (t.scale ?? 1));
  const clear = (x: number, z: number, r: number) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (const s of cells.get(`${Math.floor(x / CELL) + dx},${Math.floor(z / CELL) + dz}`) ?? []) if (Math.hypot(s.x - x, s.z - z) < r + s.r) return false;
    }
    return true;
  };
  const inBuilding = (x: number, z: number, margin: number) =>
    world.buildings.some((b) => {
      const [fw, fd] = BUILDING_FOOTPRINT[b.type] ?? [10, 10], dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < fw / 2 + margin && Math.abs(lz) < fd / 2 + margin;
    });
  const nearRoad = (x: number, z: number, r: number) =>
    world.roads.some((road) => {
      const p = road.points, half = road.width / 2 + r;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
        if (Math.hypot(ax + vx * t - x, az + vz * t - z) < half) return true;
      }
      return false;
    });
  const out: Wreck[] = [];
  // (the buildings in an order of the layer's own, so that which get one is spread over the map: the works before the farms)
  const yards = world.buildings.filter((b) => BESIDE[b.type]).map((b) => ({ b, k: rng.next() + (WORKS.has(b.type) ? 0 : 1) })).sort((a, c) => a.k - c.k).map((q) => q.b);
  for (const b of yards) {
    if (out.length >= MOST) break;
    if (out.some((w) => Math.hypot(w.x - b.x, w.z - b.z) < APART)) continue;
    const kinds = BESIDE[b.type]!.filter((k) => out.filter((w) => w.kind === k).length < EACH[k]);
    if (!kinds.length) continue;
    const kind = kinds[rng.int(0, kinds.length - 1)], K = WRECK_KINDS[kind];
    const [fw, fd] = BUILDING_FOOTPRINT[b.type] ?? [10, 10], r = Math.hypot(K.l, K.w) / 2;
    // (a few tries round the building, out past its walls by a few metres)
    for (let t = 0; t < 10; t++) {
      const a = rng.range(0, Math.PI * 2), d = Math.max(fw, fd) / 2 + r + rng.range(2, 7);
      const x = b.x + Math.sin(a) * d, z = b.z + Math.cos(a) * d, rot = rng.range(0, Math.PI * 2);
      if (inBuilding(x, z, r + 1.5) || nearRoad(x, z, r + 1) || wet(x, z) || !clear(x, z, r)) continue;
      // (on level ground, seated: its lowest corner taken, and a hand's breadth into it)
      const c = Math.cos(rot), s = Math.sin(rot), corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => ground(x + (u * K.w * c) / 2 + (v * K.l * s) / 2, z - (u * K.w * s) / 2 + (v * K.l * c) / 2));
      if (Math.max(...corners) - Math.min(...corners) > 0.7) continue;
      out.push({ kind, x, y: Math.min(...corners) - 0.1, z, rot });
      stand(x, z, r);
      break;
    }
  }
  return out;
}

/** the wrecks as salvage spots (after the map's own things: src/sim/craft/salvage.ts) */
export const wreckSpots = (wrecks: Wreck[]): SalvageSpot[] =>
  wrecks.map((w) => {
    const K = WRECK_KINDS[w.kind];
    return { x: w.x, y: w.y, z: w.z, kind: w.kind, name: K.name, frags: K.frags, scrap: K.scrap, reach: K.l / 2 + 1 };
  });
