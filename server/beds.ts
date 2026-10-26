// Beds and sleeping bags as the server keeps them (2026-10-24, base building's fourth step). The owner: "players can
// place a bed or bedroll in their base when they have a TC down like rust". Laid only in a base whose claim the player
// is on (src/sim/build/bases.ts); after a death its owner may wake at it instead of at the map's edge, with nothing, as
// often as its kind gives (src/sim/build/beds.ts: a bag once, a bed twice, then half an hour). A life begun at a bed is a
// life as any other to the dog tags' rules (server/tags.ts): no tag on it until it has lived its time in the Zona, a
// pair's kills spaced, and what a wallet is paid in a day bounded; so a bed is no quicker a way to be killed for a tag
// than the map's edge.

import { PIECES } from '../src/sim/build/pieces';
import { toWorld, worldYaw } from '../src/sim/build/snap';
import { sleepOf, sleptAt } from '../src/sim/build/beds';
import { send, type Client } from './players';
import { bases } from './build';
import { pidOf } from './acts';

/** a player's beds, wherever they are: [base, piece, kind, x, z, seconds until it gives wakes again, wakes it has now] */
export function bedsOf(c: Client): [number, number, string, number, number, number, number][] {
  const pid = pidOf(c.key), now = Date.now(), out: [number, number, string, number, number, number, number][] = [];
  for (const b of bases().bases.values()) {
    for (const p of b.pieces.values()) {
      if (!PIECES[p.k].sleep || p.by !== pid) continue;
      const [x, , z] = toWorld(b, p.x, p.y, p.z), s = sleepOf(p, now);
      out.push([b.id, p.id, p.k, Math.round(x), Math.round(z), s.wait, s.left]);
    }
  }
  return out;
}

export function tellBeds(c: Client) {
  send(c, { t: 'beds', list: bedsOf(c) });
}

/** where somebody wakes at a bed of theirs, a wake of it spent (null: they may not, and have been told why) */
export function wakeAt(c: Client, bed: { b: number; p: number }): { x: number; y: number; z: number; yaw: number } | null {
  const b = bases().bases.get(bed.b), p = b?.pieces.get(bed.p);
  if (!b || !p || !PIECES[p.k].sleep) return void send(c, { t: 'tell', kind: 'warn', text: 'That bed is gone' }), null;
  if (p.by !== pidOf(c.key)) return void send(c, { t: 'tell', kind: 'warn', text: 'That bed is not yours' }), null;
  const now = Date.now(), { wait } = sleepOf(p, now);
  if (!sleptAt(p, now)) return void send(c, { t: 'tell', kind: 'warn', text: `It is not ready: ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}` }), null;
  // (on it, a hand over it: a bed's top, a bag's)
  const [x, y, z] = toWorld(b, p.x, p.y + (p.k === 'bed' ? 0.62 : 0.15), p.z);
  return { x, y, z, yaw: worldYaw(b, p.r) + Math.PI };
}
