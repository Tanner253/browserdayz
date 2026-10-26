// Blueprints (2026-10-24, base building's fourth step). The owner: "small blueprint pieces that can be used as a build
// example or staritng spot for a base like a 1x1 with walls and a roof and a door". Plan v2: "Placing one lays all its
// frames at once and pays their planks; short of planks, it lays what it can"; then each piece is hammered up as usual.
// Each is a list of pieces in a base's own frame, worked out once by the rules on flat ground (so it is always what the
// rules allow), and laid on the ground the player aims at: its first foundation begins a base, and the rest go onto it
// in order, as far as what is carried pays and the ground allows. Laid again on that base, it lays what is still missing.

import { Bases, type Ask } from './bases';
import { PIECES, PLACED, STOREY, costOf, laidAt } from './pieces';

/** what a blueprint's piece costs: its door from the materials the door's item is made of (the blueprint hangs it whole) */
const printPiece = (k: string) => (PLACED[k] ? { ...(PIECES[k].cost ?? {}) } : costOf(k, laidAt(k)));
import { nearestSpot, spots, type Base, type Piece } from './snap';

export interface Print {
  id: string;
  name: string;
  /** each piece: its kind, and roughly where it goes (in the base's frame) and how it is turned */
  plan: [string, number, number, number, number?][];
}

const W = STOREY / 2;
export const PRINTS: Print[] = [
  { id: 'bp:hut', name: 'Hut 1x1', plan: [['foundation', 0, 0, 0], ['wall', 0, W, -1.5], ['wall', -1.5, W, 0], ['wall', 1.5, W, 0], ['doorway', 0, W, 1.5], ['door_wood', 0, 1.2, 1.5], ['roof', 0, STOREY, 0]] },
  {
    id: 'bp:airlock', name: 'Airlock 1x2',
    plan: [['foundation', 0, 0, 0], ['foundation', 0, 0, 3], ['wall', 0, W, -1.5], ['wall', -1.5, W, 0], ['wall', 1.5, W, 0], ['wall', -1.5, W, 3], ['wall', 1.5, W, 3], ['doorway', 0, W, 1.5], ['doorway', 0, W, 4.5], ['door_wood', 0, 1.2, 1.5, 1], ['door_wood', 0, 1.2, 4.5], ['roof', 0, STOREY, 0], ['roof', 0, STOREY, 3]],
  },
  {
    id: 'bp:house', name: 'House 2x2',
    plan: [
      ['foundation', 0, 0, 0], ['foundation', 3, 0, 0], ['foundation', 0, 0, 3], ['foundation', 3, 0, 3],
      ['wall', 0, W, -1.5], ['wall', 3, W, -1.5], ['wall', -1.5, W, 0], ['wall', -1.5, W, 3], ['wall', 4.5, W, 0], ['wall', 4.5, W, 3], ['wall', 3, W, 4.5], ['doorway', 0, W, 4.5], ['door_wood', 0, 1.2, 4.5],
      ['stairs_u', 3, W, 3, 2], ['floor', 0, STOREY, 0], ['floor', 3, STOREY, 0], ['floor', 0, STOREY, 3],
      ['wall', 0, STOREY + W, -1.5], ['wall', 3, STOREY + W, -1.5], ['wall', -1.5, STOREY + W, 0], ['wall', -1.5, STOREY + W, 3], ['window', 4.5, STOREY + W, 0], ['wall', 4.5, STOREY + W, 3], ['wall', 3, STOREY + W, 4.5], ['window', 0, STOREY + W, 4.5],
      ['roof', 0, 2 * STOREY, 0], ['roof', 3, 2 * STOREY, 0], ['roof', 0, 2 * STOREY, 3], ['roof', 3, 2 * STOREY, 3],
    ],
  },
  {
    // (DayZ's watchtower: a room with its door, a floor over it, a railing round the top but where the ladder up its back comes over)
    id: 'bp:tower', name: 'Watchtower',
    plan: [['foundation', 0, 0, 0], ['wall', 0, W, -1.5], ['wall', -1.5, W, 0], ['wall', 1.5, W, 0], ['doorway', 0, W, 1.5], ['door_wood', 0, 1.2, 1.5], ['floor', 0, STOREY, 0], ['ladder', 0, W, -1.82], ['wall_low', -1.5, STOREY + 0.5, 0], ['wall_low', 1.5, STOREY + 0.5, 0], ['wall_low', 0, STOREY + 0.5, 1.5]],
  },
];
export const printOf = (id: string) => PRINTS.find((p) => p.id === id);

/** a print's pieces as exactly as the rules lay them: worked out once on flat ground, each its spot */
const worked = new Map<string, Ask[]>();
export function asksOf(id: string): Ask[] {
  let out = worked.get(id);
  if (out) return out;
  out = [];
  const bs = new Bases({ ground: () => 0, why: () => null });
  let b: Base | null = null;
  for (const [k, x, y, z, turn] of printOf(id)!.plan) {
    if (!b) {
      const r = bs.lay({ k, x: 0, y: 0, z: 0, r: 0, yaw: 0 }, 'print', 0);
      if (typeof r === 'string') throw new Error(`${id}: ${r}`);
      b = r.base;
      out.push({ k, x: 0, y: 0, z: 0, r: 0 });
      continue;
    }
    const s = nearestSpot(spots(b, k, turn ?? 0), k, { x, y, z }, 2);
    const r = s && bs.lay({ b: b.id, k, x: s.x, y: s.y, z: s.z, r: s.r }, 'print', 0);
    if (!s || !r || typeof r === 'string') throw new Error(`${id}: ${k} at ${x} ${y} ${z}: ${r ?? 'no spot'}`);
    out.push({ k, x: r.piece.x, y: r.piece.y, z: r.piece.z, r: r.piece.r });
  }
  worked.set(id, out);
  return out;
}

/** what a whole print costs, laid as frames (and its fittings whole) */
export function printCost(id: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of asksOf(id)) for (const [k, n] of Object.entries(printPiece(a.k))) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** whether a base has a piece of a kind where a print's piece goes (laid already) */
const has = (b: Base, a: Ask) => [...b.pieces.values()].some((p) => p.k === a.k && Math.abs(p.x - a.x) < 0.05 && Math.abs(p.y - a.y) < 0.05 && Math.abs(p.z - a.z) < 0.05);

/**
 * A print laid: begun on the ground at (x, z) turned `yaw` (a new base), or carried on with on base `b` (what is still
 * missing). Each piece in order, while what is carried pays for it (`pays` takes what it costs, or says no); one the
 * rules or the ground refuse is passed over. What was laid, why the rest was not, and what the piece it stopped at costs.
 */
export function layPrint(bases: Bases, id: string, at: { b?: number; x: number; z: number; yaw: number }, by: string, now: number, name: string, pays: (cost: Record<string, number>) => boolean): { base: Base | null; laid: Piece[]; fresh: boolean; why: string | null; need?: Record<string, number> } {
  const asks = asksOf(id), laid: Piece[] = [];
  let base = at.b !== undefined ? bases.bases.get(at.b) ?? null : null, fresh = false, why: string | null = null;
  for (const a of asks) {
    if (base && has(base, a)) continue;
    const ask: Ask = base ? { ...a, b: base.id } : { k: a.k, x: at.x, y: 0, z: at.z, r: 0, yaw: at.yaw };
    const c = bases.check(ask, by);
    if (typeof c === 'string') {
      // (the first piece refused: nothing is begun)
      if (!base) return { base: null, laid, fresh, why: c };
      why ??= c;
      continue;
    }
    if (!pays(printPiece(a.k))) {
      return { base, laid, fresh, why: 'Short of materials for the rest', need: printPiece(a.k) };
    }
    const r = bases.lay(ask, by, now, name);
    if (typeof r === 'string') {
      why ??= r;
      continue;
    }
    if (!base) {
      base = r.base;
      fresh = r.fresh;
    }
    laid.push(r.piece);
  }
  return { base, laid, fresh, why };
}
