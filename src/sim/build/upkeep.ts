// Upkeep and rot (2026-10-24, base building's third step). The owner: "we need maintenence requirements and materials
// gathering and decay to ensure players play regualrly and must grind to have a big base". The claim holds the upkeep
// and every hour takes a share of what each piece is worth, a day's worth being Rust's brackets: 10% for the first 15
// pieces, 15% for the next 35, 20% for the next 75 and a third past; run dry, every piece loses health, frames gone in
// 2 h, wood 12 h, stone 24 h, metal 36 h; pieces laid with no claim rot from the start, after 10 minutes' grace.
// Each tier is kept in the one thing it is gathered as, never loot (the owner, 2026-10-25: "the upkeep requirements
// for bases seem way too expensive right now and not really grindable. rust upkeep is in basic resources"; "shouldnt
// i need forged iron and frags or something"): wood in planks, stone in stone, metal (Rust's sheet metal) in metal
// fragments, struck off wrecks and junk or recycled (src/sim/craft/salvage.ts), and armoured in iron bars, the forge's.

import { PIECES, PLACED, hpOf, type Tier } from './pieces';
import { MAT } from '../craft/materials';
import type { Base, Piece } from './snap';

/** what a claim's store takes: the gathered things a base is kept in */
export const UPKEEP = new Set(['planks', 'stone', MAT.frags, MAT.bar]);
/**
 * what a whole piece of each tier is worth in the thing it is kept in (half for a half piece): its planks and its stone
 * as built (nails are loot, and not asked again); metal's four sheets as the 12 bars, 120 fragments, they are made of;
 * armoured's six bars and its two plates' worth, 15 bars (Rust's: a wall's 200 wood, 300 stone, 200 fragments, 25 HQM)
 */
export const KEPT_IN: Record<string, number>[] = [{ planks: 4 }, { planks: 10 }, { stone: 30 }, { [MAT.frags]: 120 }, { [MAT.bar]: 15 }];
/** what a store held before upkeep was paid in gathered things, cut up for them when they run short: a sheet of metal is its 30 fragments (2026-10-25) */
const CUT: Record<string, [string, number]> = { [MAT.frags]: ['sheet_metal', 30] };
/** a claim's store, places across and down: days of a mid-sized base's upkeep, its planks, stone, fragments and bars piled high (the owner: "the sheet metal doesn't even fit in the flag's inventory") */
export const STORE = { w: 8, h: 6 };
/** whether a thing in a claim's store counts toward its upkeep */
export const pays = (id: string) => UPKEEP.has(id) || Object.values(CUT).some(([c]) => c === id);

export const ROT = {
  /** hours from whole to nothing, by tier, once upkeep is out (the owner's yes: "frame 2 h, wood 12 h, stone 24 h, metal 36 h"; armoured 48 h, the progression plan) */
  hours: [2, 12, 24, 36, 48],
  /** a piece laid with no claim over it rots after this long (ms) */
  grace: 10 * 60_000,
  /** a claim's building rights reach this far round every piece of its base, m */
  reach: 20,
};

/** a share of what each piece is worth a day, by how many pieces the base has before it (Rust's: 15, 50, 125) */
export const bracket = (n: number) => (n < 15 ? 0.1 : n < 50 ? 0.15 : n < 125 ? 0.2 : 1 / 3);

/** what a base costs a day to keep (its claim is free, and so are a foundation's logs, a door and whatever is set down) */
export function perDay(base: Base): Record<string, number> {
  const out: Record<string, number> = {};
  // (nor what is set down, nor a ladder, which may be anybody's leant on it)
  const list = [...base.pieces.values()].filter((p) => PIECES[p.k].role !== 'deploy' && PIECES[p.k].role !== 'lean').sort((a, b) => a.id - b.id);
  list.forEach((p, i) => {
    const k = PIECES[p.k];
    // (a piece made in one tier, a high wall, by its own cost; a door, made as an item, nothing)
    const of = PLACED[p.k] ? {} : (k.cost ?? KEPT_IN[p.t]), half = k.half && !k.cost ? 0.5 : 1;
    for (const [id, n] of Object.entries(of)) {
      if (!UPKEEP.has(id)) continue;
      out[id] = (out[id] ?? 0) + n * half * bracket(i);
    }
  });
  return out;
}

/** how many of a thing a store has toward upkeep, with what is cut up for it */
export const toward = (store: Record<string, number>, id: string) => (store[id] ?? 0) + (CUT[id] ? (store[CUT[id][0]] ?? 0) * CUT[id][1] : 0);

/** how long a store of these keeps a base whose upkeep is `day`, seconds (Infinity: it costs nothing) */
export function protectedFor(store: Record<string, number>, day: Record<string, number>): number {
  let s = Infinity;
  for (const [id, n] of Object.entries(day)) if (n > 0) s = Math.min(s, (toward(store, id) / n) * 86400);
  return s;
}

/** a time said as a person says it: "3 d 4 h", "5 h 20 m", "12 m" */
export function saidTime(s: number): string {
  if (!Number.isFinite(s)) return 'for ever';
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d} d ${h % 24} h`;
  if (h) return `${h} h ${m % 60} m`;
  return `${Math.max(0, m)} m`;
}

/** the health a piece loses an hour while it rots */
export const rotPerHour = (p: Piece) => hpOf(p.k, p.t) / ROT.hours[(PIECES[p.k].only ?? p.t) as Tier];

/**
 * A base's upkeep paid for `hours` out of `store` (counts, taken from as it is paid), with what was owed over from
 * before (`due`, fractions of a thing kept until they make a whole one). True: paid; false: the store ran dry.
 */
export function pay(day: Record<string, number>, hours: number, due: Record<string, number>, store: Record<string, number>): boolean {
  let ok = true;
  for (const [id, n] of Object.entries(day)) {
    due[id] = (due[id] ?? 0) + (n * hours) / 24;
    let whole = Math.floor(due[id] + 1e-9);
    // (short, an old sheet of metal is cut up: what it gives past what is owed is kept, owed less)
    const cut = CUT[id];
    while (cut && whole > (store[id] ?? 0) && (store[cut[0]] ?? 0) > 0) {
      store[cut[0]] -= 1;
      due[id] -= cut[1];
      whole = Math.floor(due[id] + 1e-9);
    }
    if (whole <= 0) continue;
    if ((store[id] ?? 0) < whole) {
      ok = false;
      continue;
    }
    store[id] -= whole;
    due[id] -= whole;
  }
  return ok;
}

/**
 * `hours` of rot on the pieces of a base that is not kept (no claim, or its store dry): whatever is laid long enough
 * loses health; what comes to nothing is broken. The pieces that lost health, and those broken.
 */
export function rot(base: Base, hours: number, now: number, claimed: boolean): { hurt: Piece[]; broken: number[] } {
  const hurt: Piece[] = [], broken: number[] = [];
  for (const p of base.pieces.values()) {
    if (!claimed && now - p.at < ROT.grace) continue;
    p.hp -= rotPerHour(p) * hours;
    if (p.hp <= 0) broken.push(p.id);
    else hurt.push(p);
  }
  return { hurt, broken };
}
