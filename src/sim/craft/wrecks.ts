// Salvage's wrecks (2026-10-25, plan-crafting: "Scrap comes off the Zone's own wrecks: Ladas, ZILs, rusted kolkhoz
// tractors"): a layer of their own, laid after everything else with a seed of their own, so that nothing the map already
// has moves (the navigator: "New wrecks are allowed only in a layer of their own: own seed, placed after everything else,
// so nothing existing moves"; generateWorld is left as it is). A tractor or a heap of junk in the yard of a barn, a shed
// or the sawmill; a ZIL, a Pirozhok or a heap of junk beside a garage or the works; each where src/sim/craft/layer.ts
// finds room.

import { RNG } from '../../core/noise';
import { BUILDING_FOOTPRINT } from '../../world/worldgen/layout';
import type { SalvageSpot } from './salvage';
import { roomOn, type LayerWorld } from './layer';

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
export function wreckLayer(world: LayerWorld): Wreck[] {
  const rng = new RNG(SEED), room = roomOn(world);
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
      const y = room.fit(x, z, K.l, K.w, rot);
      if (y === null) continue;
      out.push({ kind, x, y, z, rot });
      room.stand(x, z, r);
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
