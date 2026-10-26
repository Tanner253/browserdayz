// The server: raiding (base building's fifth step; the rules are src/sim/build/raid.ts). A blow at a piece is believed
// from the tool in the hands, at its own pace, from within a swing's reach, and only where nothing else of a base stands
// between the eye and where it landed; it wears the tool as any work does. A charge is thrown as a grenade is and is the
// server's from the moment it leaves the hand: its fuse, whether it goes off, and what it reaches, pieces and bodies
// alike, are reckoned here and told to all; where it stuck is its thrower's game's word, held to what the throw can carry.
// The charges held back (raid.ts HELD_BACK) are an admin's alone, in creative or out of it (the owner, 2026-10-25: "raid
// charges should just work for admins period ... just not accessible to normal users").

import { ITEMS, type ItemInstance } from '../src/sim/items';
import { HELD_BACK, RAID, blastOn, blowOf, fuseOf } from '../src/sim/build/raid';
import { THROWN_SLACK } from '../src/sim/build/charges';
import { NADE } from '../src/sim/grenades';
import type { Base } from '../src/sim/build/snap';
import type { C2S } from '../src/net/protocol';
import { broadcast, isVec3, send, type Client } from './players';
import { things } from './index';
import { bases, pay, tellBase } from './build';
import { broke } from './claims';
import { ruined, use } from './gather';
import { fellBlast, roleOf } from './gate';
import { solid } from './solid';

type V3 = [number, number, number];

/** what may be swung at a piece: anything held to strike with */
const SWUNG: Record<string, number> = Object.fromEntries(Object.values(ITEMS).filter((d) => d.melee).map((d) => [d.id, 1]));
/** when each player's last blow at a base landed (a blow comes no faster than its tool swings) */
const lastBlow = new WeakMap<Client, number>();
/** when each piece was last struck, by `b:p` (a piece is not mended within MEND.after of a blow: Rust's, src/sim/build/bases.ts) */
const struck = new Map<string, number>();
export const struckAt = (b: number, p: number) => struck.get(`${b}:${p}`) ?? 0;

const eyeOf = (c: Client): V3 => [c.pose[0], c.pose[1] + 1.6, c.pose[2]];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** what a piece has left after a raid, told to whoever knows its base; or it is gone */
function hurt(base: Base, list: [number, number][]) {
  const left: [number, number][] = [];
  for (const [id, hp] of list) {
    const p = base.pieces.get(id);
    if (!p) continue;
    struck.set(`${base.id}:${id}`, Date.now());
    if (hp <= 0) broke(base, id);
    else {
      p.hp = hp;
      left.push([id, Math.round(hp)]);
    }
  }
  if (left.length && bases().bases.has(base.id)) tellBase(base.id, { t: 'bhp', b: base.id, hp: left });
}

export function blow(c: Client, m: Extract<C2S, { t: 'bhit' }>) {
  if (!c.alive || !Number.isInteger(m.b) || !Number.isInteger(m.p) || typeof m.u !== 'string' || !isVec3(m.at) || !c.w || !SWUNG[c.w]) return;
  let it: ItemInstance | null = null;
  for (const t of things(c.inv)) if (t.uid === m.u && t.id === c.w) it = t;
  if (!it) return;
  const now = Date.now(), rate = (ITEMS[it.id].melee?.rate ?? 0.6) * 1000 * 0.8;
  if (now - (lastBlow.get(c) ?? 0) < rate) return;
  const base = bases().bases.get(m.b), piece = base?.pieces.get(m.p);
  if (!base || !piece) return;
  // (from within a swing of the eye, and the first of any base's solids on the way there is this piece)
  const eye = eyeOf(c), d = dist(eye, m.at);
  if (d > RAID.reach.blow || d < 1e-3) return;
  const past: V3 = [eye[0] + ((m.at[0] - eye[0]) * (d + 0.1)) / d, eye[1] + ((m.at[1] - eye[1]) * (d + 0.1)) / d, eye[2] + ((m.at[2] - eye[2]) * (d + 0.1)) / d];
  const first = solid.first(eye, past, 'shot');
  if (!first || first.base !== base || first.p !== piece) return;
  lastBlow.set(c, now);
  const dmg = blowOf(it.id, piece);
  if (dmg <= 0 || ruined(c, it)) return;
  use(c, it);
  hurt(base, [[piece.id, piece.hp - dmg]]);
}

// ---- charges

interface Lit {
  i: number;
  w: string;
  at: V3;
  n: V3;
  by: Client;
  /** when it goes off (ms); a dud's, when it goes out of the world */
  due: number;
  dud: boolean;
  /** still in the air: thrown from `o` this fast at `t` (ms), till its thrower's game says where it stuck */
  fly?: { o: V3; v: V3; t: number };
}
const lit = new Map<number, Lit>();
let next = 1;

const told = (ch: Lit, f: number) => broadcast({ t: 'bcharge', i: ch.i, w: ch.w, o: ch.at, n: ch.n, f, by: ch.by.id, ...(ch.fly ? { v: ch.fly.v } : {}) });
/** (a test's short fuse, seconds: CHARGE_FUSE in its server's env; never set on a real one) */
const TEST_FUSE = Number(process.env.CHARGE_FUSE) || 0;

/** A charge armed and thrown: out of the pockets, its fuse running from now, flown by every game till it sticks. */
export function throwCharge(c: Client, m: Extract<C2S, { t: 'bthrow' }>) {
  if (!c.alive || typeof m.w !== 'string' || !RAID.charge[m.w] || typeof m.u !== 'string' || !isVec3(m.o) || !isVec3(m.v)) return;
  if (HELD_BACK.has(m.w) && roleOf(c) !== 'admin') return void send(c, { t: 'tell', kind: 'warn', text: 'Charges are not in the game yet: raiding opens later' });
  let it: ItemInstance | null = null;
  for (const t of things(c.inv)) if (t.uid === m.u && t.id === m.w) it = t;
  if (!it) return;
  // (from the hand, as a grenade is believed to leave one: src/sim/grenades.ts NADE)
  if (Math.hypot(m.o[0] - c.pose[0], m.o[2] - c.pose[2]) > NADE.from || Math.abs(m.o[1] - c.pose[1]) > NADE.up || Math.hypot(...m.v) > NADE.most) return;
  pay(c, { [m.w]: 1 });
  const now = Date.now(), f = TEST_FUSE || fuseOf(m.w, Math.random());
  const ch: Lit = { i: next++, w: m.w, at: [m.o[0], m.o[1], m.o[2]], n: [0, 1, 0], by: c, due: now + f * 1000, dud: false, fly: { o: [m.o[0], m.o[1], m.o[2]], v: [m.v[0], m.v[1], m.v[2]], t: now } };
  lit.set(ch.i, ch);
  told(ch, f);
}

/** Where a charge its thrower's game flew came to rest: stuck to whatever it struck first, or lying on the ground. */
export function stick(c: Client, m: Extract<C2S, { t: 'bstick' }>) {
  const ch = Number.isInteger(m.i) ? lit.get(m.i) : undefined;
  if (!ch?.fly || ch.by !== c || !isVec3(m.at) || !isVec3(m.n)) return;
  // (no further from where it left the hand than its speed and its fall can have carried it since)
  const e = (Date.now() - ch.fly.t) / 1000 + NADE.lag / 1000, s = Math.hypot(...ch.fly.v);
  if (dist(m.at, ch.fly.o) > s * e + 0.5 * NADE.fall * e * e + THROWN_SLACK) return;
  const l = Math.hypot(...m.n);
  ch.n = l < 1e-6 ? [0, 1, 0] : [m.n[0] / l, m.n[1] / l, m.n[2] / l];
  ch.at = [m.at[0], m.at[1], m.at[2]];
  ch.fly = undefined;
  if (!ch.dud) told(ch, Math.max(0, (ch.due - Date.now()) / 1000));
}

export function relight(c: Client, m: Extract<C2S, { t: 'blight' }>) {
  const ch = Number.isInteger(m.i) ? lit.get(m.i) : undefined;
  if (!ch || !ch.dud || !c.alive || dist(eyeOf(c), ch.at) > RAID.reach.plant + 0.4) return;
  const f = TEST_FUSE || fuseOf(ch.w, Math.random());
  Object.assign(ch, { dud: false, due: Date.now() + f * 1000, by: c });
  told(ch, f);
}

/** Four times a second: each charge whose fuse has run down goes off, or does not and lies there, or goes out of the world. */
export function charges(now: number) {
  for (const ch of [...lit.values()]) {
    if (now < ch.due) continue;
    if (ch.dud) {
      lit.delete(ch.i);
      broadcast({ t: 'bfizz', i: ch.i });
      continue;
    }
    if (Math.random() < RAID.charge[ch.w].dud) {
      Object.assign(ch, { dud: true, due: now + RAID.dudFor });
      told(ch, -1);
      continue;
    }
    lit.delete(ch.i);
    broadcast({ t: 'bboom', i: ch.i, w: ch.w, o: ch.at, by: ch.by.id });
    const by = new Map<Base, [number, number][]>();
    for (const { base, p, hp } of blastOn(solid, ch.at, ch.w, ch.n)) {
      if (!by.has(base)) by.set(base, []);
      by.get(base)!.push([p.id, hp]);
    }
    for (const [base, list] of by) hurt(base, list);
    // (and the bodies, the infected, the cars and the animals in reach: as a grenade lying on the ground is reckoned)
    fellBlast(ch.by, ch.w, ch.at);
  }
}

/** the charges burning or lying unlit, for a game that comes in */
export const chargesNow = (now = Date.now()) => [...lit.values()].map((ch) => ({ i: ch.i, w: ch.w, o: ch.at, n: ch.n, f: ch.dud ? -1 : Math.max(0, (ch.due - now) / 1000), by: ch.by.id }));
