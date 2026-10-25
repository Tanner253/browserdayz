// A base's doors as the server keeps them (2026-10-24, base building's fourth step; how a leaf swings, and what it may
// not swing through, is src/sim/build/doors.ts). The owner: "airlock mechanics like rust has doors that swing open 1 way
// with collision". Whether a door is open is the server's word, told to everyone who knows the base; it will not swing
// a leaf through where anybody stands.

import { toLocal, toWorld } from '../src/sim/build/snap';
import { DOOR, inTheWay, middleOf, swings } from '../src/sim/build/doors';
import { PIECES } from '../src/sim/build/pieces';
import type { C2S } from '../src/net/protocol';
import { broadcastNear, clients, send, type Client } from './players';
import { bases, known, tellBase } from './build';
import { passes } from './locks';

/** when each door last swung, ms (`${base}:${piece}`) */
const swung = new Map<string, number>();
/** when each player last knocked */
const knocked = new WeakMap<Client, number>();

/** the door asked for, if the player stands at it */
function at(c: Client, b: unknown, p: unknown) {
  if (!c.alive || typeof b !== 'number' || typeof p !== 'number' || !known(c, b)) return null;
  const base = bases().bases.get(b), piece = base?.pieces.get(p);
  if (!base || !piece || !swings(piece.k)) return null;
  const [x, y, z] = toWorld(base, ...middleOf(piece));
  if (Math.hypot(x - c.pose[0], y - (c.pose[1] + 1), z - c.pose[2]) > DOOR.reach + 0.6) return null;
  return { base, piece, x, y, z };
}

export function swing(c: Client, m: Extract<C2S, { t: 'bdoor' }>) {
  const d = at(c, m.b, m.p);
  if (!d || !!m.open === !!d.piece.open) return;
  const key = `${m.b}:${m.p}`, now = Date.now();
  if (now - (swung.get(key) ?? 0) < DOOR.again) return;
  if (!passes(c, d.piece)) return void send(c, { t: 'tell', kind: 'warn', text: 'It is locked' });
  // (nobody in its way: whoever stands where it swings, the one opening it too)
  const feet = [...clients.values()].filter((o) => o.alive && Math.hypot(o.pose[0] - d.x, o.pose[2] - d.z) < 8).map((o) => {
    const [x, y, z] = toLocal(d.base, o.pose[0], o.pose[1], o.pose[2]);
    return { x, y, z };
  });
  if (inTheWay(d.piece, feet)) return void send(c, { t: 'tell', kind: 'warn', text: 'Someone is in the way of it' });
  swung.set(key, now);
  // (what swung long ago need not be remembered)
  if (swung.size > 400) for (const [k, t] of swung) if (now - t > DOOR.again) swung.delete(k);
  d.piece.open = !!m.open;
  tellBase(m.b, { t: 'bdoor', b: m.b, p: m.p, o: d.piece.open ? 1 : 0, by: c.id });
}

/** a knock, heard by whoever is near (plan v2: "Knock: F on a locked door from outside; heard inside") */
export function knock(c: Client, m: Extract<C2S, { t: 'bknock' }>) {
  const d = at(c, m.b, m.p), now = Date.now();
  if (!d || now - (knocked.get(c) ?? 0) < 600) return;
  knocked.set(c, now);
  broadcastNear({ t: 'knock', x: d.x, y: d.y, z: d.z, metal: PIECES[d.piece.k].only === 3 }, d.x, d.z, 40);
}
