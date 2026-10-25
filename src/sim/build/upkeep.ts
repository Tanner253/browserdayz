// Upkeep and rot (2026-10-24, base building's third step). The owner: "we need maintenence requirements and materials
// gathering and decay to ensure players play regualrly and must grind to have a big base". Plan v2, approved: the claim
// holds the upkeep and every hour takes a share of each piece's tier cost, a day's worth being 10% for the first 15
// pieces, 15% for the next 35, 20% to 100 and 30% past (Rust's brackets); run dry, every piece loses health, frames
// gone in 2 h, wood 12 h, stone 24 h, metal 36 h; pieces laid with no claim rot from the start, after 10 minutes'
// grace.

import { PIECES, costOf, hpOf, type Tier } from './pieces';
import type { Base, Piece } from './snap';

/** what a claim's store takes: the materials a base is built of (the armoured tier's paid in iron bars: its steel plate is not asked again) */
export const UPKEEP = new Set(['planks', 'nails', 'stone', 'sheet_metal', 'iron_bar']);

export const ROT = {
  /** hours from whole to nothing, by tier, once upkeep is out (the owner's yes: "frame 2 h, wood 12 h, stone 24 h, metal 36 h"; armoured 48 h, the progression plan) */
  hours: [2, 12, 24, 36, 48],
  /** a piece laid with no claim over it rots after this long (ms) */
  grace: 10 * 60_000,
  /** a claim's building rights reach this far round every piece of its base, m */
  reach: 20,
};

/** a share of each piece's tier cost a day, by how many pieces the base has before it */
export const bracket = (n: number) => (n < 15 ? 0.1 : n < 50 ? 0.15 : n < 100 ? 0.2 : 0.3);

/** what a base costs a day to keep (its claim is free, and so are a foundation's logs) */
export function perDay(base: Base): Record<string, number> {
  const out: Record<string, number> = {};
  // (nor what is set down, nor a ladder, which may be anybody's leant on it)
  const list = [...base.pieces.values()].filter((p) => PIECES[p.k].role !== 'deploy' && PIECES[p.k].role !== 'lean').sort((a, b) => a.id - b.id);
  list.forEach((p, i) => {
    for (const [id, n] of Object.entries(costOf(p.k, p.t))) {
      if (!UPKEEP.has(id)) continue;
      out[id] = (out[id] ?? 0) + n * bracket(i);
    }
  });
  return out;
}

/** how long a store of these keeps a base whose upkeep is `day`, seconds (Infinity: it costs nothing) */
export function protectedFor(store: Record<string, number>, day: Record<string, number>): number {
  let s = Infinity;
  for (const [id, n] of Object.entries(day)) if (n > 0) s = Math.min(s, ((store[id] ?? 0) / n) * 86400);
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
    const whole = Math.floor(due[id] + 1e-9);
    if (!whole) continue;
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
