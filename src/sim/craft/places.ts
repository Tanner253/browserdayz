// Where a workbench's or a forge's recipes are made (2026-10-25): near one of them standing in a base, any base's (Rust's
// bench is anybody's who stands at it). Read by the game for its screen and by the server, which runs the queue.

import type { Bases } from '../build/bases';
import { toWorld } from '../build/snap';
import { NEAR, type Place } from './recipes';

/** the piece each place is */
export const PLACE_PIECE: Record<Exclude<Place, 'hand'>, string> = { bench: 'workbench', forge: 'forge' };

/** the nearest workbench or forge within reach of a place (on the same floor, near enough), or null */
export function placeNear(bases: Bases, at: Exclude<Place, 'hand'>, x: number, y: number, z: number, within = NEAR[at]): { b: number; p: number; x: number; y: number; z: number } | null {
  const k = PLACE_PIECE[at];
  let best: { b: number; p: number; x: number; y: number; z: number } | null = null, d = within;
  for (const b of bases.bases.values()) {
    for (const p of b.pieces.values()) {
      if (p.k !== k) continue;
      const [px, py, pz] = toWorld(b, p.x, p.y, p.z), h = Math.hypot(px - x, pz - z);
      if (h < d && Math.abs(py - y) < 2.5) {
        d = h;
        best = { b: b.id, p: p.id, x: px, y: py, z: pz };
      }
    }
  }
  return best;
}
