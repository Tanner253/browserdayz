// Where a base may stand (2026-10-24): out in the country, and not on a tree or a rock. Plan v2: "Not in towns, on
// roads, by loot buildings, the fort, the bunker, the coast starts". The owner, the same day: "players cannot build
// inside or too close to POI's we want people to be basing raiding and exploring the wilderness and making bases out
// there"; and none in the Zona, where nobody is to earn tags camping their own roof.

import { BUILDING_FOOTPRINT, PLAN, onRidgeWall, type BuildingType, type Instance } from '../../world/worldgen';
import { SEA_LEVEL, onWorld } from '../../world/worldgen/places';
import { inPlay } from '../../world/worldgen/layout';
import { TREE_KINDS, treeOf } from '../gather';
import { waterAt, type Waters } from '../water';
import { CAMP_KEEP, TRADER_SPOTS } from '../camp-place';

export const KEEP_OFF = {
  /** metres past a named place's reach (a town, a camp, the fort), anywhere on the map */
  place: 60,
  /** past a building's walls */
  building: 60,
  /** from where people come ashore (a fresh start) */
  spawn: 45,
  /** in from the edge of the map */
  edge: 80,
  /** off the west's ridge wall and its barrier */
  ridge: 12,
};

/** whether a place is under the sea, a lake or a river (as the animals have it: src/sim/animal-ground.ts) */
export const wetAt = (water: Waters | undefined, ground: (x: number, z: number) => number) => (x: number, z: number) => ground(x, z) < SEA_LEVEL + 0.4 || (!!water && !!waterAt(water, x, z, ground));

/** why nothing is built at this place (null: it may be) */
export function noBuilding(x: number, z: number, places: { x: number; z: number; radius: number; name?: string }[], buildings: { type: BuildingType; x: number; z: number; rot: number }[], spawns: { x: number; z: number }[] = [], wet?: (x: number, z: number) => boolean): string | null {
  if (!onWorld(x, z, KEEP_OFF.edge) || x < PLAN.barrier + KEEP_OFF.ridge) return 'Too near the edge of the map';
  // (nor across the west's ridge, whose wall the server holds everybody off: stairs over it would be a way over)
  for (let d = -KEEP_OFF.ridge; d <= KEEP_OFF.ridge; d += 2.5) if (onRidgeWall(x + d, z)) return 'Not on the ridge';
  if (wet?.(x, z)) return 'Not in the water';
  // (the Zona's own word on where it is: it is to be made smaller, rounds about the towns joined by corridors)
  if (inPlay(x, z)) return 'Inside the Zona';
  // (nor by a trader: a base beside a safe zone is a fight its owner always walks away from, src/sim/camp-place.ts)
  if (TRADER_SPOTS.some((q) => Math.hypot(x - q.x, z - q.z) < CAMP_KEEP)) return 'Too near a trader';
  const at = places.find((p) => Math.hypot(x - p.x, z - p.z) < p.radius + KEEP_OFF.place);
  if (at) return at.name ? `Too near ${at.name}` : 'Too near a town';
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
