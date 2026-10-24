// Every base on the map, as the server keeps them (server/build.ts) and as a game played alone keeps its own
// (src/game/building/index.ts): laid, nailed up, taken down, and kept in the save as short as it can be said. The rules
// of where a piece goes are src/sim/build/snap.ts; what it is and costs, src/sim/build/pieces.ts.

import { BENCH_NEAR, FOUND, PIECES, PIECE_IDS, costOf, hpOf, laidAt, type Tier } from './pieces';
import { blocked, cornersOf, offered, restsOn, standing, toLocal, toWorld, type Base, type Claim, type Piece, type Spot } from './snap';
import { ROT } from './upkeep';
import { heardLock, saidLock, type KeptLock } from './locks';

export const LIMITS = {
  /** pieces a base holds (the owner's yes to "150 pieces a claim"), and the server holds in all */
  base: 150,
  all: 6000,
  /** how near another base a new one may be begun: nearer, it is built onto that one */
  apart: 8,
  /** claims a player may hold (the owner's yes: "One claim a player") */
  claims: 1,
};

/** what a world says of the ground to a base (the server's world and the game's are the same, from one seed) */
export interface Land {
  ground: (x: number, z: number) => number;
  /** why nothing is built here (a town, a road, a building, the fort...): null, it may be */
  why: (x: number, z: number) => string | null;
  /** the trunks and the rocks near a place, as circles */
  solids?: (x: number, z: number, within: number) => { x: number; z: number; r: number }[];
}

/** a piece asked for: in a base (its frame's place and turn), or, with no base, a new one begun at a place in the world */
export interface Ask {
  b?: number;
  k: string;
  x: number;
  y: number;
  z: number;
  r: number;
  /** a new base's turn in the world, radians */
  yaw?: number;
}

export class Bases {
  bases = new Map<number, Base>();
  private nextBase = 1;
  constructor(public land: Land) {}

  /** all the pieces there are */
  get count() {
    let n = 0;
    for (const b of this.bases.values()) n += b.pieces.size;
    return n;
  }

  /** the bases with a piece within `within` metres of a place */
  near(x: number, z: number, within: number): Base[] {
    const out: Base[] = [];
    for (const b of this.bases.values()) {
      for (const p of b.pieces.values()) {
        const [wx, , wz] = toWorld(b, p.x, p.y, p.z);
        if (Math.hypot(wx - x, wz - z) < within) {
          out.push(b);
          break;
        }
      }
    }
    return out;
  }

  /** the ground under a place in a base's frame, in that frame */
  groundIn(b: Base) {
    return (x: number, z: number) => {
      const [wx, , wz] = toWorld(b, x, 0, z);
      return this.land.ground(wx, wz) - b.oy;
    };
  }

  /**
   * Whether a piece may be laid as asked, and where it would go: the spot, the base (made now, for a first piece, but
   * not kept until `lay`), or why not.
   */
  check(ask: Ask, by: string): { base: Base; spot: Spot; fresh: boolean } | string {
    const K = PIECES[ask.k];
    if (!K) return 'No such piece';
    if (this.count >= LIMITS.all) return 'The server holds no more pieces';
    let base: Base, spot: Spot | null, fresh = false;
    if (ask.b === undefined) {
      // a first foundation (or a high wall) out on its own: a base of its own, turned as the player faces
      if (!K.ground && K.role !== 'free') return 'Lay a foundation first';
      const near = this.near(ask.x, ask.z, LIMITS.apart);
      if (near.length) return 'Too near a base: build onto it';
      const yaw = Number.isFinite(ask.yaw) ? ask.yaw! : 0;
      base = { id: 0, ox: ask.x, oy: 0, oz: ask.z, yaw, owner: by, pieces: new Map(), next: 1 };
      if (K.ground) {
        // (its top a hand over the highest ground under it)
        const hs = cornersOf(K.shape!, 0, 0, 0).map(([x, z]) => {
          const [wx, , wz] = toWorld(base, x, 0, z);
          return this.land.ground(wx, wz);
        });
        base.oy = Math.max(this.land.ground(ask.x, ask.z), ...hs) + FOUND.lift;
      } else base.oy = this.land.ground(ask.x, ask.z);
      spot = { x: 0, y: 0, z: 0, r: 0, on: [] };
      fresh = true;
    } else {
      const b = this.bases.get(ask.b);
      if (!b) return 'That base is gone';
      base = b;
      if (b.pieces.size >= LIMITS.base) return `A base holds ${LIMITS.base} pieces at most`;
      spot = offered(b, ask.k, ask);
      if (!spot) return 'It does not fit there';
    }
    const why = blocked(base, ask.k, spot, this.groundIn(base));
    if (why) return why;
    // (where it stands in the world: not in a town, on a road, by a building; not on a tree or a rock)
    const [wx, , wz] = toWorld(base, spot.x, spot.y, spot.z);
    const no = this.land.why(wx, wz);
    if (no) return no;
    // (nor inside somebody else's claim: Rust's building blocked)
    const theirs = this.claimAt(wx, wz);
    if (theirs && !theirs.claim!.members.some((m) => m.pid === by) && !K.anywhere) return "Building blocked: someone else's claim";
    if (K.bench && !this.benchNear(wx, wz)) return `It needs a workbench within ${BENCH_NEAR} m`;
    if (K.sleep && !base.claim?.members.some((m) => m.pid === by)) return 'A bed goes only in a base whose claim you are on';
    if (ask.k === 'claim') {
      if (base.claim) return 'This base has its claim already';
      if ([...this.bases.values()].filter((b) => b.claim?.members[0]?.pid === by).length >= LIMITS.claims) return 'You hold a claim already: one a player';
    }
    if (K.ground || K.role === 'free' || K.role === 'steps') {
      for (const s of this.land.solids?.(wx, wz, 3) ?? []) {
        const [lx, , lz] = toLocal(base, s.x, 0, s.z);
        if (Math.hypot(lx - spot.x, lz - spot.z) < (K.ground && K.shape === 'sq' ? 2.1 : 1.5) + s.r) return s.r > 0.7 ? 'A rock is in the way' : 'A tree is in the way';
      }
    }
    return { base, spot, fresh };
  }

  /** the base whose claim's rights reach a place (null: none's) */
  claimAt(x: number, z: number): Base | null {
    for (const b of this.bases.values()) {
      if (!b.claim) continue;
      for (const p of b.pieces.values()) {
        const [px, , pz] = toWorld(b, p.x, p.y, p.z);
        if (Math.hypot(px - x, pz - z) < ROT.reach) return b;
      }
    }
    return null;
  }

  /** whether a workbench stands near a place (what a metal fitting is made at) */
  benchNear(x: number, z: number) {
    for (const b of this.bases.values()) {
      for (const p of b.pieces.values()) {
        if (p.k !== 'workbench') continue;
        const [px, , pz] = toWorld(b, p.x, p.y, p.z);
        if (Math.hypot(px - x, pz - z) < BENCH_NEAR) return true;
      }
    }
    return false;
  }

  /** whether a player may work a base with the hammer: on its claim, or, with none, its first builder */
  mayWork(b: Base, by: string) {
    return b.claim ? b.claim.members.some((m) => m.pid === by) : b.owner === by;
  }

  /** a player joins a base's claim, or, on it already, leaves it: true now on it */
  join(b: Base, by: string, name: string): boolean {
    const c = b.claim;
    if (!c) return false;
    const i = c.members.findIndex((m) => m.pid === by);
    if (i >= 0) {
      c.members.splice(i, 1);
      return false;
    }
    c.members.push({ pid: by, name });
    return true;
  }

  /** a piece laid (`check` first said it may): the base, and the piece */
  lay(ask: Ask, by: string, now: number, name = ''): { base: Base; piece: Piece; fresh: boolean } | string {
    const c = this.check(ask, by);
    if (typeof c === 'string') return c;
    const { base, spot, fresh } = c;
    if (fresh) {
      base.id = this.nextBase++;
      this.bases.set(base.id, base);
    }
    const t = laidAt(ask.k);
    // (to the centimetre, as every game is told it: the server's copy and theirs are the same to the last figure)
    const piece: Piece = { id: base.next++, k: ask.k, t, x: cm(spot.x) / 100, y: cm(spot.y) / 100, z: cm(spot.z) / 100, r: spot.r, hp: hpOf(ask.k, t), at: now, by, on: spot.on };
    base.pieces.set(piece.id, piece);
    if (ask.k === 'claim') base.claim = { p: piece.id, members: [{ pid: by, name }], due: {}, dry: false };
    return { base, piece, fresh };
  }

  /** why a piece may not be brought up to tier `t` (null: it may) */
  canUpgrade(b: number, id: number, t: Tier): string | null {
    const p = this.bases.get(b)?.pieces.get(id);
    if (!p) return 'It is gone';
    if (PIECES[p.k].only !== undefined) return 'It comes as it is: it is not built up';
    if (t <= p.t) return `It is ${['a frame', 'wood', 'stone', 'metal'][p.t]} already`;
    return null;
  }

  /** nailed up to tier `t`, and whole again */
  upgrade(b: number, id: number, t: Tier): Piece | null {
    const p = this.bases.get(b)?.pieces.get(id);
    if (!p || this.canUpgrade(b, id, t)) return null;
    p.t = t;
    p.hp = hpOf(p.k, t);
    return p;
  }

  /** a piece taken away, and with it whatever stood only on it: the pieces gone (the base itself, when none is left) */
  remove(b: number, id: number): number[] {
    const base = this.bases.get(b);
    if (!base || !base.pieces.delete(id)) return [];
    const gone = [id];
    for (const p of base.pieces.values()) p.on = p.on.filter((q) => q !== id);
    const up = standing(base);
    for (const p of [...base.pieces.values()]) {
      if (up.has(p.id)) continue;
      base.pieces.delete(p.id);
      gone.push(p.id);
    }
    if (base.claim && gone.includes(base.claim.p)) base.claim = undefined;
    if (!base.pieces.size) this.bases.delete(b);
    return gone;
  }

  /** what taking a piece down gives back: half of what laying it and bringing it to its tier took */
  refund(b: number, id: number): Record<string, number> {
    const p = this.bases.get(b)?.pieces.get(id);
    if (!p) return {};
    const out: Record<string, number> = {};
    const add = (c: Record<string, number>) => {
      for (const [k, n] of Object.entries(c)) out[k] = (out[k] ?? 0) + n;
    };
    add(costOf(p.k, laidAt(p.k)));
    if (p.t !== laidAt(p.k)) add(costOf(p.k, p.t));
    // (a box or a bench is picked up whole, Rust's way: only what is built is half lost)
    if (PIECES[p.k].role === 'deploy' && p.k !== 'claim') return out;
    for (const k of Object.keys(out)) out[k] = Math.floor(out[k] / 2);
    for (const k of Object.keys(out)) if (!out[k]) delete out[k];
    return out;
  }

  // ---- kept

  /** every base, as short as it can be said, with what is in each claim's store (`stock`) and each box's (`held`): what the save keeps */
  keep(stock?: (b: Base) => unknown[], held?: (b: Base, p: Piece) => unknown[] | undefined): KeptBase[] {
    return [...this.bases.values()].map((b) => said(b, stock?.(b), held, true));
  }

  /** read back (the save's, or what the server says): every piece's rests worked out again from where it stands */
  restore(kept: KeptBase[] | undefined) {
    for (const k of kept ?? []) {
      const b = heard(k);
      if (!b) continue;
      this.bases.set(b.id, b);
      this.nextBase = Math.max(this.nextBase, b.id + 1);
    }
  }
}

/** a base said short: [id, x, y, z, yaw, owner, next piece's number, pieces, and its claim] */
export type KeptBase = [number, number, number, number, number, string, number, KeptPiece[], KeptClaim?];
/** a claim: [its piece, its members [public id, name], what is owed over, dry, what is in its store (the save's only, never a game's)] */
export type KeptClaim = [number, [string, string][], Record<string, number>, boolean, unknown[]?];
/** a piece: [id, kind's number, tier, x, y, z (cm), turn, health, laid (s), and what more there is of it] */
export type KeptPiece = [number, number, number, number, number, number, number, number, number, KeptMore?];
/** what more there is of a piece: `o` it stands open; `s` what is in its store (the save's only, never a game's); `l` its lock; `w` whose bed it is */
export interface KeptMore {
  o?: 1;
  s?: unknown[];
  l?: KeptLock;
  w?: string;
}

const cm = (v: number) => Math.round(v * 100);
/** a base said short: for a game, or with `secret` for the save (its locks' codes and keys) */
export function said(b: Base, stock?: unknown[], held?: (b: Base, p: Piece) => unknown[] | undefined, secret = false): KeptBase {
  const k: KeptBase = [b.id, Math.round(b.ox * 1000) / 1000, Math.round(b.oy * 1000) / 1000, Math.round(b.oz * 1000) / 1000, Math.round(b.yaw * 1e5) / 1e5, b.owner, b.next, [...b.pieces.values()].map((p) => saidPiece(p, held?.(b, p), secret))];
  if (b.claim) k.push(saidClaim(b.claim, stock));
  return k;
}
export const saidClaim = (c: Claim, stock?: unknown[]): KeptClaim => [c.p, c.members.map((m) => [m.pid, m.name]), Object.fromEntries(Object.entries(c.due).map(([k, n]) => [k, Math.round(n * 1000) / 1000])), c.dry, ...(stock ? [stock] : [])] as KeptClaim;
export function heardClaim(k: unknown): Claim | undefined {
  if (!Array.isArray(k) || !Number.isFinite(k[0]) || !Array.isArray(k[1])) return undefined;
  const members = (k[1] as unknown[]).filter((m): m is [string, string] => Array.isArray(m) && typeof m[0] === 'string' && typeof m[1] === 'string').map(([pid, name]) => ({ pid, name }));
  const due: Record<string, number> = {};
  for (const [id, n] of Object.entries((k[2] ?? {}) as Record<string, unknown>)) if (Number.isFinite(n)) due[id] = Number(n);
  return { p: k[0] as number, members, due, dry: !!k[3], ...(Array.isArray(k[4]) ? { kept: k[4] as unknown[] } : {}) };
}
export function saidPiece(p: Piece, store?: unknown[], secret = false): KeptPiece {
  const k: KeptPiece = [p.id, PIECE_IDS.indexOf(p.k), p.t, cm(p.x), cm(p.y), cm(p.z), p.r, Math.round(p.hp), Math.round(p.at / 1000)];
  const bed = !!PIECES[p.k].sleep;
  if (p.open || store?.length || p.lock || bed) k.push({ ...(p.open ? { o: 1 as const } : {}), ...(store?.length ? { s: store } : {}), ...(p.lock ? { l: saidLock(p.lock, secret) } : {}), ...(bed ? { w: p.by } : {}) });
  return k;
}

/** a base read back from what it was said as; null if it is not one */
export function heard(k: KeptBase): Base | null {
  if (!Array.isArray(k) || (k.length !== 8 && k.length !== 9) || !Array.isArray(k[7])) return null;
  const [id, ox, oy, oz, yaw, owner, next, ps] = k;
  if (![id, ox, oy, oz, yaw, next].every(Number.isFinite) || typeof owner !== 'string') return null;
  const b: Base = { id, ox, oy, oz, yaw, owner, pieces: new Map(), next };
  for (const q of ps) {
    const p = heardPiece(q, owner);
    if (p) b.pieces.set(p.id, p);
  }
  // (what each rests on is where it stands: worked out again, in the order they were laid)
  for (const p of [...b.pieces.values()].sort((a, c) => a.id - c.id)) p.on = restsOn(b, p.k, p).filter((id) => id !== p.id);
  const claim = heardClaim(k[8]);
  if (claim && b.pieces.get(claim.p)?.k === 'claim') b.claim = claim;
  return b.pieces.size ? b : null;
}

export function heardPiece(q: KeptPiece, by = ''): Piece | null {
  if (!Array.isArray(q) || (q.length !== 9 && q.length !== 10) || !q.slice(0, 9).every(Number.isFinite)) return null;
  const k = PIECE_IDS[q[1] as number];
  if (!k) return null;
  const t = Math.max(0, Math.min(3, Math.round(q[2]))) as Tier;
  const p: Piece = { id: q[0], k, t, x: q[3] / 100, y: q[4] / 100, z: q[5] / 100, r: ((Math.round(q[6]) % 12) + 12) % 12, hp: Math.max(1, Math.min(hpOf(k, t), q[7])), at: q[8] * 1000, by, on: [] };
  const more = q[9];
  if (more && typeof more === 'object') {
    if (more.o === 1) p.open = true;
    if (Array.isArray(more.s)) p.kept = more.s;
    const l = heardLock(more.l);
    if (l) p.lock = l;
    if (typeof more.w === 'string') p.by = more.w;
  }
  return p;
}
