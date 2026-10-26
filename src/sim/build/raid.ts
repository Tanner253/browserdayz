// Raiding (base building's fifth step; the navigator's order: "C4 and satchel as explosives, C4 as loot, far more tool
// blows"). Plan v2, approved: "Raids from day one, explosive loot rare; crafted later". Rust's shape: tools are the slow,
// loud, tiring way in, good on wood, poor on stone and no use on metal; a charge is the quick way in, and costly. Every
// number is here and nowhere else, read alike by the server and by a game played alone.

import { HAMMERS } from '../gather';
import { PIECES } from './pieces';
import type { Base, Piece } from './snap';
import type { BaseSolids } from './solid';
import { CHARGES, type Charge } from './charges';

type V3 = [number, number, number];

/**
 * The charges held back for now: neither found nor learned at a bench, given only by an admin, to be tried (the owner,
 * 2026-10-25: "right now c4 shouldnt be craftable or lootable from players but it should be accsisble to admins sam ewith
 * satchel charges ... players will ened time to make bases before theyll be raiding eachother anyways"). Their recipes
 * and their numbers here stay as they are, for when raiding opens.
 */
export const HELD_BACK: ReadonlySet<string> = new Set(['c4', 'satchel']);

export const RAID = {
  /**
   * What a blow takes off a piece, by tier (Frame, Wood, Stone, Metal, Armoured), for each tool. With health 60, 500,
   * 1000, 2000, 4000 (pieces.ts TIER_HP): a wooden wall is some 70 blows of a felling axe, a stone wall 200 of a
   * sledgehammer, a metal wall a thousand of it, and every blow wears the tool (src/sim/gather.ts TOOL_LIFE).
   */
  blow: {
    felling_axe: [30, 7, 0, 0, 0],
    hatchet: [24, 5, 0, 0, 0],
    stone_hatchet: [18, 3, 0, 0, 0],
    pickaxe: [24, 3, 4, 0, 0],
    sledgehammer: [30, 6, 5, 2, 0],
  } as Record<string, number[]>,
  /** anything else swung at it: a machete, a bat, a crowbar, a fist's worth (the building hammer breaks nothing) */
  other: [10, 1, 0, 0, 0],
  /** the charges: tuned in src/sim/build/charges.ts, the one place */
  charge: CHARGES as Record<string, Charge>,
  /** how far from the eye a blow is believed to land on a piece, and a charge that did not go off is lit again, metres */
  reach: { blow: 3.4, plant: 2.8 },
  /** a charge that did not go off goes out of the world this long after (ms), if nobody lights it again */
  dudFor: 5 * 60_000,
};

/** the tier a piece is struck as: a fitting's, a high wall's or a box's own (a metal door is metal in a wooden frame) */
export const struckAs = (p: Piece) => PIECES[p.k].only ?? p.t;

/** what one blow of `tool` takes off `p` */
export const blowOf = (tool: string, p: Piece) => (HAMMERS[tool] ? 0 : (RAID.blow[tool] ?? RAID.other)[struckAs(p)] ?? 0);

/** what a charge that went off `d` metres from `p` takes off it */
export function chargeOf(w: string, p: Piece, d: number) {
  const c = RAID.charge[w];
  if (!c) return 0;
  const k = d <= c.edge ? 1 : Math.max(0, 1 - (d - c.edge) / Math.max(0.01, c.reach - c.edge));
  return (c.dmg[struckAs(p)] ?? 0) * k;
}

/** a charge's fuse, seconds, by the roll `r` (0..1) */
export const fuseOf = (w: string, r: number) => {
  const f = RAID.charge[w]?.fuse ?? [10, 10];
  return f[0] + (f[1] - f[0]) * r;
};

/**
 * What a charge gone off at `at` does to every base about it: each piece it reaches and what it then has left
 * (`hp` at 0 or under: broken). The piece it is stuck to (behind it along `n`, its face's outward line; or, not said,
 * the nearest within a hand's breadth) takes all of it; anything else only its splash. The pieces themselves are not
 * changed: whoever owns them does that.
 */
export function blastOn(solids: BaseSolids, at: V3, w: string, n?: V3): { base: Base; p: Piece; hp: number }[] {
  const c = RAID.charge[w];
  if (!c) return [];
  const all = solids.reached(at, c.reach);
  const near = all.reduce<(typeof all)[number] | null>((m, r) => (r.d <= c.edge && (!m || r.d < m.d) ? r : m), null);
  const on = n ? solids.first(at, [at[0] - n[0] * 0.2, at[1] - n[1] * 0.2, at[2] - n[2] * 0.2], 'shot')?.p ?? near?.p : near?.p;
  return all.map(({ base, p, d }) => ({ base, p, hp: p.hp - (p === on ? chargeOf(w, p, 0) : chargeOf(w, p, d) * c.splash) }));
}
