// Where a workbench's, a forge's or a research table's work is done (2026-10-25): near one of them standing in a base,
// any base's (Rust's bench is anybody's who stands at it). Read by the game for its screen and by the server.

import type { Bases } from '../build/bases';
import { toWorld, type Piece } from '../build/snap';
import { NEAR, type Level, type Place } from './recipes';

export type Spot = Exclude<Place, 'hand'> | 'research';
/** the pieces each place is */
export const PLACE_PIECE: Record<Spot, string> = { bench: 'workbench', forge: 'forge', research: 'research_table' };
const REACH: Record<Spot, number> = { ...NEAR, research: 3 };

/** a workbench's level (progression v3: "three bench levels"), as base building keeps it on the piece; one when unsaid */
export const levelOf = (p: Piece): Level => {
  const lv = (p as Piece & { lv?: number }).lv;
  return lv === 2 || lv === 3 ? lv : 1;
};

export interface Near {
  b: number;
  p: number;
  x: number;
  y: number;
  z: number;
  /** a workbench's level: the best of those within reach */
  lv: Level;
}

/** the nearest of a place's pieces within reach (on the same floor, near enough), or null; for a workbench, the best level among those within reach */
export function placeNear(bases: Bases, at: Spot, x: number, y: number, z: number, within = REACH[at]): Near | null {
  const k = PLACE_PIECE[at];
  let best: Near | null = null, d = within, lv: Level = 1;
  for (const b of bases.bases.values()) {
    for (const p of b.pieces.values()) {
      if (p.k !== k) continue;
      const [px, py, pz] = toWorld(b, p.x, p.y, p.z), h = Math.hypot(px - x, pz - z);
      if (h >= within || Math.abs(py - y) >= 2.5) continue;
      lv = Math.max(lv, levelOf(p)) as Level;
      if (h < d) {
        d = h;
        best = { b: b.id, p: p.id, x: px, y: py, z: pz, lv: 1 };
      }
    }
  }
  if (best) best.lv = lv;
  return best;
}
