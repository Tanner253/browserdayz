// Mokroye, the flooded hamlet in the swamp (2026-10-16): its houses as the water has them. The owner's investor, of a
// lake drawn over a village: "the investor liked the swamp idea and water around buildings like this". The houses are
// the hamlets' own (src/world/town-plans.ts) and the village's barn, their ground floors under the water; the brief:
// "keep loot on tables, shelves and upper floors, never under water". Where they stand: src/sim/mokroye.ts.

import type { Blueprint, MatKey } from './buildings';

/** A building's outside painted another way (the sunk barn's dark weathered boards read black from the walk in shade). */
export function painted(bp: Blueprint, ext: MatKey): Blueprint {
  return { ...bp, ext, walls: bp.walls.map((w) => (w.side === 'inner' ? w : { ...w, ext })) };
}

/** how high each board of a rack is over its floor (RACKS in buildings.ts) */
const RACK_BOARDS = [0.18, 0.72, 1.25, 1.82];
/** a hand's breadth over the water: what lies lower is wet */
const DRY = 0.12;

/**
 * A building with the water `depth` deep over its ground floor: no place for a thing below it, nothing kept on a
 * rack's board under it, and no car parked in it.
 */
export function flooded(bp: Blueprint, depth: number): Blueprint {
  const above = depth + DRY;
  return {
    ...bp,
    loot: bp.loot.filter((p) => p[1] > above),
    furniture: bp.furniture.filter((f) => !f.id.startsWith('covered_car')).map((f) => (f.on ? { ...f, on: f.on.filter((b) => RACK_BOARDS[b] > above) } : f)),
  };
}
