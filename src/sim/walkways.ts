// Walkways of boards on posts, from the pier kit (Poly Haven's modular wooden pier, src/world: pier_kit): a fishing
// village's piers, a swamp's boardwalks (2026-10-16). Pure numbers, for the game and the server alike: which pieces
// stand where (in a town's frame), and the deck of each run as a box that stops a body.

import type { KitPiece } from './kit';

/** a section's own measures: its deck so high over its origin, laid every so far, its middle so far across from its origin; the gateway's middle across */
export const SECTION = { deck: 2.65, step: 3.0, mid: 0.98, gate: 1.22, wide: 1.24 };

/** A run of a walkway: from a to b (a town's frame), its deck so high over the pad, a gateway where it starts, a cluster of old posts beside it. */
export interface WalkRun { a: [number, number]; b: [number, number]; deck: number; gate?: boolean; posts?: boolean }

/** a deck as a box: its middle, half its size each way (its own x across the run, z along it), and its turn */
export interface Deck { c: [number, number, number]; h: [number, number, number]; rot: number }

/** the turn of a run: a section runs along its own +z, turned so */
const turnOf = (r: WalkRun) => Math.atan2(r.b[0] - r.a[0], r.b[1] - r.a[1]);

/** The pieces of runs, on a pad at y: sections from a toward b (as many as reach it), turned to run so. */
export function walkPieces(runs: WalkRun[], y: number, name: string): KitPiece[] {
  const out: KitPiece[] = [];
  for (const r of runs) {
    const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), n = Math.max(1, Math.round(L / SECTION.step)), turn = turnOf(r);
    const dx = Math.sin(turn), dz = Math.cos(turn), ax = Math.cos(turn), az = -Math.sin(turn), foot = y + r.deck - SECTION.deck;
    // (a section's own x runs from -0.25 to 2.22: its origin stands to one side of the line, so its deck lies on it)
    if (r.gate) out.push({ id: 'pier_section_05', at: [r.a[0] - ax * SECTION.gate, foot, r.a[1] - az * SECTION.gate], turn, body: false, name });
    for (let k = 0; k < n; k++) {
      const id = k % 3 === 2 ? 'pier_section_03' : k % 2 ? 'pier_section_02' : 'pier_section_01';
      out.push({ id, at: [r.a[0] + dx * k * SECTION.step - ax * SECTION.mid, foot, r.a[1] + dz * k * SECTION.step - az * SECTION.mid], turn, body: false, name });
    }
    if (r.posts) out.push({ id: 'pier_poles', at: [r.a[0] + dx * L * 0.45 - ax * 4.5, foot, r.a[1] + dz * L * 0.45 - az * 4.5], turn: turn + 0.4, body: false, name });
  }
  return out;
}

/** The decks of runs, on a pad at y: the top of each box at the deck's height, from a to as far as its sections reach. */
export function walkDecks(runs: WalkRun[], y: number): Deck[] {
  return runs.map((r) => {
    const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), n = Math.max(1, Math.round(L / SECTION.step)), turn = turnOf(r);
    const reach = n * SECTION.step + 0.4, dx = Math.sin(turn), dz = Math.cos(turn), mid = reach / 2 - 0.3;
    return { c: [r.a[0] + dx * mid, y + r.deck - 0.06, r.a[1] + dz * mid], h: [SECTION.wide, 0.06, reach / 2], rot: turn };
  });
}
