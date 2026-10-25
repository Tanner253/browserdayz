// The server: raiding (base building's fifth step; the rules are src/sim/build/raid.ts). A blow at a piece is believed
// from the tool in the hands, at its own pace, from within a swing's reach, and only where nothing else of a base stands
// between the eye and where it landed; it wears the tool as any work does. A charge is the server's from the moment it is
// stuck: its fuse, whether it goes off, and what it reaches, pieces and bodies alike, are reckoned here and told to all.

import { ITEMS, type ItemInstance } from '../src/sim/items';
import { RAID, blastOn, blowOf, fuseOf } from '../src/sim/build/raid';
import type { Base } from '../src/sim/build/snap';
import type { C2S } from '../src/net/protocol';
import { broadcast, isVec3, send, type Client } from './players';
import { things } from './index';
import { bases, pay, tellBase } from './build';
import { broke } from './claims';
import { ruined, use } from './gather';
import { fellBlast } from './gate';
import { solid } from './solid';

type V3 = [number, number, number];

/** what may be swung at a piece: anything held to strike with */
const SWUNG: Record<string, number> = Object.fromEntries(Object.values(ITEMS).filter((d) => d.melee).map((d) => [d.id, 1]));
/** when each player's last blow at a base landed (a blow comes no faster than its tool swings) */
const lastBlow = new WeakMap<Client, number>();
/** when each piece was last struck, by `b:p` (a piece is not mended within RAID.mendAfter of a blow: Rust's) */
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
}
const lit = new Map<number, Lit>();
let next = 1;

const told = (ch: Lit, f: number) => broadcast({ t: 'bcharge', i: ch.i, w: ch.w, o: ch.at, n: ch.n, f, by: ch.by.id });

export function plant(c: Client, m: Extract<C2S, { t: 'bplant' }>) {
  if (!c.alive || typeof m.w !== 'string' || !RAID.charge[m.w] || typeof m.u !== 'string' || !isVec3(m.at) || !isVec3(m.n)) return;
  let it: ItemInstance | null = null;
  for (const t of things(c.inv)) if (t.uid === m.u && t.id === m.w) it = t;
  if (!it) return;
  if (dist(eyeOf(c), m.at) > RAID.reach.plant + 0.4) return;
  const l = Math.hypot(...m.n);
  if (l < 1e-6) return;
  const n: V3 = [m.n[0] / l, m.n[1] / l, m.n[2] / l];
  // (stuck to something of a base: a solid of one within a hand's breadth behind where it is)
  const front: V3 = [m.at[0] + n[0] * 0.04, m.at[1] + n[1] * 0.04, m.at[2] + n[2] * 0.04];
  const back: V3 = [m.at[0] - n[0] * 0.12, m.at[1] - n[1] * 0.12, m.at[2] - n[2] * 0.12];
  if (!solid.first(front, back, 'shot')) return void send(c, { t: 'tell', kind: 'warn', text: 'Stick it to a wall, a door or a floor of a base' });
  pay(c, { [m.w]: 1 });
  const f = fuseOf(m.w, Math.random()), ch: Lit = { i: next++, w: m.w, at: front, n, by: c, due: Date.now() + f * 1000, dud: false };
  lit.set(ch.i, ch);
  told(ch, f);
}

export function relight(c: Client, m: Extract<C2S, { t: 'blight' }>) {
  const ch = Number.isInteger(m.i) ? lit.get(m.i) : undefined;
  if (!ch || !ch.dud || !c.alive || dist(eyeOf(c), ch.at) > RAID.reach.plant + 0.4) return;
  const f = fuseOf(ch.w, Math.random());
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
    for (const { base, p, hp } of blastOn(solid, ch.at, ch.w)) {
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
