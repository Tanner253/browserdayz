// The server: base building (2026-10-24, the second step; the rules are src/sim/build/). The server owns every piece:
// a game says where it lays one and the server lays it only where its own copy of the base offers that spot and the
// rules allow it, paid for out of its own copy of that player's pockets. Materials taken are told to the game
// ('spent'), and until its word on its pockets says it has taken them out ('me' `sp`), they are taken out of that word
// too: no plank is laid twice. A base is told to whoever comes within sight of it, and forgotten by their game when
// they go far off (the owner: "imagine 100's of bases on the map, how will we handle this without pickup a performance
// cost"). Kept in the one save (server/keep.ts), with no write of its own.

import { Bases, LIMITS, repairOf, said, saidPiece, type KeptBase } from '../src/sim/build/bases';
import { struckAt } from './raid';
import { PIECES, TIER_S, costOf, type Tier } from '../src/sim/build/pieces';
import { toWorld } from '../src/sim/build/snap';
import { Solids, noBuilding, wetAt } from '../src/sim/build/land';
import { HAMMERS, condition } from '../src/sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import type { SerializedInventory } from '../src/sim/inventory';
import type { C2S, S2C } from '../src/net/protocol';
import { clients, send, type Client } from './players';
import { log, things, world } from './index';
import { tool, use, woods } from './gather';
import { pidOf } from './acts';
import { spill, stockOf, storeFor, storesBack, tellClaim } from './claims';
import { boxStore, boxesBack, emptyBox, heldIn, spillBoxes } from './boxes';
import { asksOf, layPrint, printOf } from '../src/sim/build/blueprints';

/** how far off a base is told to a game, and how far off it is forgotten again */
export const SIGHT = { tell: 450, forget: 650 };
/** how near a piece someone laying it, or hammering at it, has to stand (a step of their own lateness besides) */
const REACH = { lay: 9, hammer: 6 };

let made: Bases | null = null;
let solids: Solids | null = null;
let wet: ((x: number, z: number) => boolean) | null = null;
/** every base (made when first asked: this file is read before the world is built) */
export const bases = () =>
  (made ??= new Bases({
    ground: (x, z) => world.groundAt(x, z),
    why: (x, z) => noBuilding(x, z, world.places, world.buildings, world.spawns, (wet ??= wetAt(world.water, (gx, gz) => world.groundAt(gx, gz)))),
    solids: (x, z, within) => (solids ??= new Solids(world.trees, world.rocks)).near(x, z, within, (i) => woods().felled.has(i)),
  }));

interface Doing {
  /** the bases this player's game has been told */
  known: Set<number>;
  /** the last 'spent' sent, and what is still to come out of their word on their pockets */
  n: number;
  owed: { n: number; items: [string, number][] }[];
  /** the hammer at a piece: which, to what tier, since when */
  up: { b: number; p: number; to: Tier; at: number } | null;
}
const doing = new WeakMap<Client, Doing>();
const of = (c: Client) => {
  let d = doing.get(c);
  if (!d) doing.set(c, (d = { known: new Set(), n: 0, owed: [], up: null }));
  return d;
};

// ---- materials

/** how many of a thing a player carries, by the server's copy of their pockets */
function count(inv: SerializedInventory | null, id: string) {
  let n = 0;
  for (const it of things(inv)) if (it.id === id) n += it.qty;
  return n;
}

/** what is short of `cost` in these pockets, said plainly (null: nothing) */
export function short(inv: SerializedInventory | null, cost: Record<string, number>): string | null {
  const missing = Object.entries(cost).map(([id, n]) => [id, n - count(inv, id)] as const).filter(([, n]) => n > 0);
  if (!missing.length) return null;
  return `Needs ${missing.map(([id, n]) => `${n} more ${(ITEMS[id]?.name ?? id).toLowerCase()}`).join(' and ')}`;
}

/** `n` of a thing taken out of a set of pockets, wherever it lies (the last piles first); how many were taken */
export function takeFrom(inv: SerializedInventory | null, id: string, n: number): number {
  if (!inv || n <= 0) return 0;
  let left = n;
  const fromList = (list: { qty: number; id: string }[], get = (x: unknown) => x as { qty: number; id: string }) => {
    for (let i = list.length - 1; i >= 0 && left > 0; i--) {
      const it = get(list[i]);
      if (it.id !== id) continue;
      const k = Math.min(left, it.qty);
      it.qty -= k;
      left -= k;
      if (it.qty <= 0) list.splice(i, 1);
    }
  };
  const inCargo = (it: ItemInstance | null | undefined) => {
    if (!it?.cargo) return;
    fromList(it.cargo as unknown as { qty: number; id: string }[], (p) => (p as { item: ItemInstance }).item);
    for (const p of it.cargo) inCargo(p.item);
  };
  for (const c of inv.containers) fromList(c.items as unknown as { qty: number; id: string }[]);
  // (what is in the hands, after the pockets: as the game takes it, src/sim/inventory.ts)
  const held = (inv.slots as Record<string, ItemInstance | null | undefined>).held;
  if (left > 0 && held?.id === id) {
    const k = Math.min(left, held.qty);
    held.qty -= k;
    left -= k;
    if (held.qty <= 0) (inv.slots as Record<string, ItemInstance | null>).held = null;
  }
  for (const it of Object.values(inv.slots)) inCargo(it);
  for (const c of inv.containers) for (const it of c.items) inCargo(it);
  return n - left;
}

/** a cost taken out of a player's pockets (the server's copy), and their game told to take it out of theirs */
export function pay(c: Client, cost: Record<string, number>) {
  const d = of(c), items = Object.entries(cost).filter(([, n]) => n > 0) as [string, number][];
  if (!items.length) return;
  for (const [id, n] of items) takeFrom(c.inv, id, n);
  d.owed.push({ n: ++d.n, items });
  send(c, { t: 'spent', n: d.n, items });
}

/** Their game's word on their pockets ('me'), cleaned: whatever the server has taken that it has not yet taken out, taken out of it. */
export function owing(c: Client, sp: unknown) {
  const d = doing.get(c);
  if (!d?.owed.length) return;
  const said = Number.isFinite(sp) ? Number(sp) : 0;
  d.owed = d.owed.filter((o) => o.n > said);
  for (const o of d.owed) for (const [id, n] of o.items) takeFrom(c.inv, id, n);
}

/** who a player is to a base: their public id, as their dog tag has it (never their key: a base is told to everybody near) */
const own = (c: Client) => pidOf(c.key);

// ---- what each game is told

/** whether a player's game has been told of base `b` */
export const known = (c: Client, b: number) => !!doing.get(c)?.known.has(b);

/** to each game that has been told of base `b` */
export function tellBase(b: number, m: S2C) {
  for (const c of clients.values()) if (doing.get(c)?.known.has(b)) send(c, m);
}

/** every couple of seconds: the bases come into sight told whole, those gone far off forgotten */
export function sighting() {
  for (const c of clients.values()) sightFor(c);
}

/** the bases in sight of somebody coming in, told in their welcome (and so known to their game) */
export function basesFor(c: Client) {
  const d = of(c), out: KeptBase[] = [];
  for (const b of bases().bases.values()) {
    if (Math.hypot(b.ox - c.pose[0], b.oz - c.pose[2]) >= SIGHT.tell) continue;
    d.known.add(b.id);
    out.push(said(b));
  }
  return out;
}

/**
 * One player's bases come into sight or gone off: asked of everybody every couple of seconds, and of one who has just
 * come in or woken somewhere new at once, before they are stood there (a floor of theirs is under them from the first
 * moment, and nobody falls through it while it is on its way).
 */
export function sightFor(c: Client) {
  const all = bases(), d = of(c);
  for (const b of all.bases.values()) {
    const far = Math.hypot(b.ox - c.pose[0], b.oz - c.pose[2]);
    if (!d.known.has(b.id) && far < SIGHT.tell) {
      d.known.add(b.id);
      send(c, { t: 'base', b: said(b) });
    } else if (d.known.has(b.id) && far > SIGHT.forget) {
      d.known.delete(b.id);
      send(c, { t: 'bgone', b: b.id });
    }
  }
  for (const id of d.known) if (!all.bases.has(id)) d.known.delete(id);
}

/** a game that has come in (again): told nothing yet, and so told afresh */
export function forgetBases(c: Client) {
  const d = of(c);
  d.known.clear();
  d.owed = [];
}

// ---- what a player does

export function lay(c: Client, m: Extract<C2S, { t: 'blay' }>) {
  if (!c.alive || typeof m.k !== 'string' || !PIECES[m.k] || ![m.x, m.y, m.z, m.r].every(Number.isFinite)) return;
  const plan = [...things(c.inv)].find((it) => it.uid === m.u && it.id === 'building_plan');
  if (!plan) return void send(c, { t: 'tell', kind: 'warn', text: 'You need a building plan' });
  const all = bases();
  const where = m.b === undefined ? [m.x, 0, m.z] : (() => {
    const b = all.bases.get(m.b);
    return b ? toWorld(b, m.x, m.y, m.z) : null;
  })();
  if (!where || Math.hypot(where[0] - c.pose[0], where[2] - c.pose[2]) > REACH.lay) return;
  const ask = { b: m.b, k: m.k, x: m.x, y: m.y, z: m.z, r: m.r, yaw: m.yaw };
  const ok = all.check(ask, own(c));
  if (typeof ok === 'string') return void send(c, { t: 'tell', kind: 'warn', text: ok });
  const cost = costOf(m.k, PIECES[m.k].only ?? 0);
  const no = short(c.inv, cost);
  if (no) return void send(c, { t: 'tell', kind: 'warn', text: no });
  const r = all.lay(ask, own(c), Date.now(), c.name);
  if (typeof r === 'string') return void send(c, { t: 'tell', kind: 'warn', text: r });
  pay(c, cost);
  if (PIECES[m.k].store) boxStore(r.base, r.piece);
  if (m.k === 'claim') {
    storeFor(r.base);
    log(`[build] ${c.name} set down a claim in base ${r.base.id}`);
  }
  if (r.fresh) {
    log(`[build] ${c.name} began base ${r.base.id} at ${r.base.ox.toFixed(0)}, ${r.base.oz.toFixed(0)} (${all.bases.size} bases, ${all.count} pieces)`);
    sighting();
  } else tellBase(r.base.id, { t: 'bpc', b: r.base.id, p: saidPiece(r.piece) });
  if (m.k === 'claim') tellClaim(r.base);
}

/** the hammer at a piece: whose it is to work, near enough, and the hammer fit to work with */
/** a blueprint laid: each piece in order while what they carry pays, the rest passed over (src/sim/build/blueprints.ts) */
export function print(c: Client, m: Extract<C2S, { t: 'bprint' }>) {
  if (!c.alive || !printOf(m.id) || ![m.x, m.z, m.yaw].every(Number.isFinite)) return;
  const plan = [...things(c.inv)].find((it) => it.uid === m.u && it.id === 'building_plan');
  if (!plan) return void send(c, { t: 'tell', kind: 'warn', text: 'You need a building plan' });
  const all = bases(), b = m.b !== undefined ? all.bases.get(m.b) : undefined;
  if (m.b !== undefined && !b) return;
  const [x, , z] = b ? toWorld(b, 0, 0, 0) : [m.x, 0, m.z];
  if (Math.hypot(x - c.pose[0], z - c.pose[2]) > REACH.lay + 6) return;
  const r = layPrint(all, m.id, { b: m.b, x: m.x, z: m.z, yaw: m.yaw }, own(c), Date.now(), c.name, (cost) => {
    if (short(c.inv, cost)) return false;
    pay(c, cost);
    return true;
  });
  if (!r.base || !r.laid.length) return void send(c, { t: 'tell', kind: 'warn', text: (r.need && short(c.inv, r.need)) || r.why || 'Nothing more of it to lay' });
  if (r.fresh) sighting();
  else for (const p of r.laid) tellBase(r.base.id, { t: 'bpc', b: r.base.id, p: saidPiece(p) });
  const left = asksOf(m.id).length - r.base.pieces.size;
  const why = (r.need && short(c.inv, r.need)) || r.why;
  send(c, { t: 'tell', kind: left > 0 ? 'info' : 'good', text: `${printOf(m.id)!.name}: ${r.laid.length} laid${left > 0 && why ? `; ${why.toLowerCase()}` : ''}` });
  log(`[build] ${c.name} laid ${r.laid.length} pieces of a ${m.id} in base ${r.base.id}`);
}

function atPiece(c: Client, b: number, p: number, u: unknown): { it: ItemInstance; why: string | null } | null {
  const it = tool(c, u, HAMMERS);
  if (!it || !c.alive) return null;
  const base = bases().bases.get(b), piece = base?.pieces.get(p);
  if (!base || !piece) return { it, why: 'It is gone' };
  const [x, , z] = toWorld(base, piece.x, piece.y, piece.z);
  if (Math.hypot(x - c.pose[0], z - c.pose[2]) > REACH.hammer) return { it, why: 'Too far off' };
  if (condition(it.cond).ruined) return { it, why: 'Your hammer is ruined' };
  // (its claim's members' to work; with no claim, its first builder's)
  if (!bases().mayWork(base, own(c))) return { it, why: base.claim ? 'You are not on its claim' : 'It is not yours' };
  return { it, why: null };
}

export function hammer(c: Client, m: Extract<C2S, { t: 'bup' }>) {
  if (!Number.isInteger(m.b) || !Number.isInteger(m.p) || ![1, 2, 3, 4].includes(m.to)) return;
  const at = atPiece(c, m.b, m.p, m.u);
  if (!at) return;
  const d = of(c), all = bases(), to = m.to as Tier;
  const why = at.why ?? all.canUpgrade(m.b, m.p, to) ?? short(c.inv, costOf(all.bases.get(m.b)!.pieces.get(m.p)!.k, to));
  if (m.go === 1) {
    d.up = why ? null : { b: m.b, p: m.p, to, at: Date.now() };
    return void send(c, { t: 'bup', b: m.b, p: m.p, ok: !why, ...(why ? { why } : {}) });
  }
  const begun = d.up;
  d.up = null;
  if (why || !begun || begun.b !== m.b || begun.p !== m.p || begun.to !== to || Date.now() - begun.at < TIER_S[to] * 850) return;
  const piece = all.bases.get(m.b)!.pieces.get(m.p)!;
  pay(c, costOf(piece.k, to));
  all.upgrade(m.b, m.p, to);
  use(c, at.it);
  tellBase(m.b, { t: 'bpc', b: m.b, p: saidPiece(piece) });
}

export function takeDown(c: Client, m: Extract<C2S, { t: 'bdel' }>) {
  if (!Number.isInteger(m.b) || !Number.isInteger(m.p)) return;
  const at = atPiece(c, m.b, m.p, m.u);
  if (!at) return;
  if (at.why) return void send(c, { t: 'tell', kind: 'warn', text: at.why });
  const all = bases(), back = all.refund(m.b, m.p), claimed = all.bases.get(m.b)?.claim?.p;
  // (a box is picked up empty; what stood on a piece taken down spills what it held)
  if (PIECES[all.bases.get(m.b)!.pieces.get(m.p)!.k].store && !emptyBox(m.b, m.p)) return void send(c, { t: 'tell', kind: 'warn', text: 'Empty it first' });
  const gone = all.remove(m.b, m.p);
  if (!gone.length) return;
  spillBoxes(m.b, gone);
  if (claimed !== undefined && gone.includes(claimed)) {
    spill(m.b);
    const b = all.bases.get(m.b);
    if (b) tellClaim(b);
  }
  use(c, at.it);
  tellBase(m.b, { t: 'bout', b: m.b, ids: gone });
  const items = Object.entries(back).map(([id, n]) => makeItem(id, n));
  if (items.length) send(c, { t: 'kit', name: 'Taken down', items, adds: true, gift: Object.entries(back).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ') });
}

/** the hammer at a piece: mended whole for a share of what it cost (not within half a minute of a blow), or turned about */
export function mend(c: Client, m: Extract<C2S, { t: 'bfix' }>) {
  if (!Number.isInteger(m.b) || !Number.isInteger(m.p)) return;
  const at = atPiece(c, m.b, m.p, m.u);
  if (!at) return;
  const all = bases(), now = Date.now();
  const why = at.why ?? (m.turn ? all.canTurn(m.b, m.p, now) : all.canRepair(m.b, m.p, struckAt(m.b, m.p), now));
  if (why) return void send(c, { t: 'tell', kind: 'warn', text: why });
  const piece = all.bases.get(m.b)!.pieces.get(m.p)!;
  if (m.turn) all.turn(m.b, m.p);
  else {
    const cost = repairOf(piece), no = short(c.inv, cost);
    if (no) return void send(c, { t: 'tell', kind: 'warn', text: no });
    pay(c, cost);
    all.repair(m.b, m.p);
  }
  use(c, at.it);
  tellBase(m.b, { t: 'bpc', b: m.b, p: saidPiece(piece) });
}

// ---- kept

export const keepBases = (): KeptBase[] => bases().keep(stockOf, heldIn);
/** read back from the save (only into a server that has no bases of its own yet) */
export function restoreBases(kept: KeptBase[] | undefined) {
  const all = bases();
  if (all.bases.size || !kept?.length) return;
  all.restore(kept);
  storesBack();
  boxesBack();
  log(`[build] ${all.bases.size} bases, ${all.count} pieces read back`);
}

export { LIMITS };
