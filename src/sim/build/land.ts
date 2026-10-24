// Where a base may stand (2026-10-24): out in the country, as a stash is buried (src/sim/stash.ts), and not on a tree or
// a rock. Plan v2: "Not in towns, on roads, by loot buildings, the fort, the bunker, the coast starts".

import { BUILDING_FOOTPRINT, type BuildingType, type Instance } from '../../world/worldgen';
import { SEA_LEVEL, onWorld } from '../../world/worldgen/places';
import { TREE_KINDS, treeOf } from '../gather';
import { waterAt, type Waters } from '../water';

export const KEEP_OFF = {
  /** metres past a town's or a camp's reach */
  place: 15,
  /** past a building's walls */
  building: 12,
  /** from where people come ashore (a fresh start) */
  spawn: 45,
  /** in from the edge of the map */
  edge: 80,
};

/** whether a place is under the sea, a lake or a river (as the animals have it: src/sim/animal-ground.ts) */
export const wetAt = (water: Waters | undefined, ground: (x: number, z: number) => number) => (x: number, z: number) => ground(x, z) < SEA_LEVEL + 0.4 || (!!water && !!waterAt(water, x, z, ground));

/** why nothing is built at this place (null: it may be) */
export function noBuilding(x: number, z: number, places: { x: number; z: number; radius: number }[], buildings: { type: BuildingType; x: number; z: number; rot: number }[], spawns: { x: number; z: number }[] = [], wet?: (x: number, z: number) => boolean): string | null {
  if (!onWorld(x, z, KEEP_OFF.edge)) return 'Too near the edge of the map';
  if (wet?.(x, z)) return 'Not in the water';
  if (places.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + KEEP_OFF.place)) return 'Not in a town or a camp: build out in the country';
  for (const b of buildings) {
    const f = BUILDING_FOOTPRINT[b.type];
    if (!f) continue;
    const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
    if (Math.abs(dx * c - dz * s) < f[0] / 2 + KEEP_OFF.building && Math.abs(dx * s + dz * c) < f[1] / 2 + KEEP_OFF.building) return 'Too near a building';
  }
  if (spawns.some((p) => Math.hypot(x - p.x, z - p.z) < KEEP_OFF.spawn)) return 'Not where people come ashore';
  return null;
}

/** the trunks and the rocks, found by place: a 16 m grid of them */
export class Solids {
  private cells = new Map<number, number[]>();
  private all: { x: number; z: number; r: number; tree: number }[] = [];
  constructor(trees: Instance[], rocks: Instance[]) {
    trees.forEach((t, i) => {
      if (treeOf(t)) this.put({ x: t.x, z: t.z, r: Math.min(TREE_KINDS[t.kind]?.trunk ?? 0.3, 0.5) * t.scale, tree: i });
    });
    for (const r of rocks) if (r.scale >= 0.6) this.put({ x: r.x, z: r.z, r: 0.55 * r.scale, tree: -1 });
  }
  private key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  private put(s: { x: number; z: number; r: number; tree: number }) {
    const k = this.key(Math.floor(s.x / 16), Math.floor(s.z / 16));
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push(this.all.length);
    this.all.push(s);
  }
  /** those within `within` of a place (a felled tree's stump is no trunk: `down` says which are down) */
  near(x: number, z: number, within: number, down?: (tree: number) => boolean) {
    const out: { x: number; z: number; r: number }[] = [];
    for (let cx = Math.floor((x - within) / 16); cx <= Math.floor((x + within) / 16); cx++)
      for (let cz = Math.floor((z - within) / 16); cz <= Math.floor((z + within) / 16); cz++)
        for (const i of this.cells.get(this.key(cx, cz)) ?? []) {
          const s = this.all[i];
          if (Math.hypot(s.x - x, s.z - z) < within + s.r && !(s.tree >= 0 && down?.(s.tree))) out.push(s);
        }
    return out;
  }
}
