// Where a workbench's, a forge's or a research table's work is done (2026-10-25): near one of them standing in a base,
// any base's (Rust's bench is anybody's who stands at it). Read by the game for its screen and by the server.

import type { Bases } from '../build/bases';
import { toWorld, type Piece } from '../build/snap';
import { benchLevel } from '../build/pieces';
import { NEAR, type Level, type Place } from './recipes';

export type Spot = Exclude<Place, 'hand'> | 'research';
/** the pieces each place is */
export const PLACE_PIECE: Record<Spot, string> = { bench: 'workbench', forge: 'forge', research: 'research_table' };
const REACH: Record<Spot, number> = { ...NEAR, research: 3 };

/** a workbench's level (progression v3: "three bench levels"), as base building keeps it: its piece's tier (src/sim/build/pieces.ts benchLevel) */
export const levelOf = (p: Piece): Level => {
  const lv = benchLevel(p);
  return lv >= 3 ? 3 : lv === 2 ? 2 : 1;
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

/**
 * The level of the workbench in use (F at it, as Rust's: the owner, "I should have to press F on the workbench to use it
 * to open the crafting menu with those items unlocked"), while it stands within reach: 0 once it is gone or left.
 */
export function benchAt(bases: Bases, b: number, p: number, x: number, y: number, z: number, within = REACH.bench): Level | 0 {
  const base = bases.bases.get(b), piece = base?.pieces.get(p);
  if (!base || !piece || piece.k !== PLACE_PIECE.bench) return 0;
  const [px, py, pz] = toWorld(base, piece.x, piece.y, piece.z);
  return Math.hypot(px - x, pz - z) < within && Math.abs(py - y) < 2.5 ? levelOf(piece) : 0;
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
