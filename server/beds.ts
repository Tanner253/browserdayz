// Beds and sleeping bags as the server keeps them (2026-10-24, base building's fourth step). The owner: "players can
// place a bed or bedroll in their base when they have a TC down like rust". Laid only in a base whose claim the player
// is on (src/sim/build/bases.ts); after a death its owner may wake at it instead of at the map's edge, with nothing, as
// often as its kind gives (src/sim/build/beds.ts: a bag once, a bed twice, then half an hour). A life begun at a bed is a
// life as any other to the dog tags' rules (server/tags.ts): no tag on it until it has lived its time in the Zona, a
// pair's kills spaced, and what a wallet is paid in a day bounded; so a bed is no quicker a way to be killed for a tag
// than the map's edge.

import { PIECES } from '../src/sim/build/pieces';
import { toWorld, worldYaw } from '../src/sim/build/snap';
import { bedsFull, sleepOf, sleptAt } from '../src/sim/build/beds';
import { saidPiece } from '../src/sim/build/bases';
import { clients, send, type Client } from './players';
import { bases, tellBase } from './build';
import { pidOf } from './acts';
import { partyMates } from './party';
import { KEPT } from './keep';

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

/**
 * A bed or a bag of one's own given to somebody in one's party, Rust's way: theirs from then on, on their map when they
 * die and not on the giver's (the owner, 2026-10-27: "I should be able to set a sleeping bag for another player that I
 * place down, rust style"). Within their own limit of each kind.
 */
export function giveBed(c: Client, m: { b: unknown; p: unknown; to: unknown }) {
  const b = typeof m.b === 'number' ? bases().bases.get(m.b) : undefined, p = typeof m.p === 'number' ? b?.pieces.get(m.p) : undefined;
  const to = typeof m.to === 'number' ? clients.get(m.to) : undefined;
  if (!c.alive || !b || !p || !PIECES[p.k].sleep) return;
  const warn = (text: string) => send(c, { t: 'tell', kind: 'warn', text });
  if (p.by !== pidOf(c.key)) return void warn('That is not yours to give');
  if (!to || to === c || !partyMates(c).includes(to)) return void warn('Give it to somebody in your party');
  const theirs: typeof p[] = [];
  for (const o of bases().bases.values()) for (const q of o.pieces.values()) if (q.by === pidOf(to.key)) theirs.push(q);
  const full = bedsFull(p.k, theirs);
  if (full) return void warn(`${to.name} has as many as they may: ${full.split(':')[0].replace('You can', 'they can')}`);
  p.by = pidOf(to.key);
  KEPT.dirty = true;
  tellBase(b.id, { t: 'bpc', b: b.id, p: saidPiece(p) });
  tellBeds(c);
  tellBeds(to);
  const name = PIECES[p.k].name.toLowerCase();
  send(c, { t: 'tell', kind: 'info', text: `Your ${name} is ${to.name}'s now` });
  send(to, { t: 'tell', kind: 'good', text: `${c.name} gave you their ${name}: it is on your map when you die` });
}
