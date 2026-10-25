// Beds and sleeping bags as the server keeps them (2026-10-24, base building's fourth step). The owner: "players can
// place a bed or bedroll in their base when they have a TC down like rust". Laid only in a base whose claim the player
// is on (src/sim/build/bases.ts); after a death its owner may wake at it instead of at the map's edge, with nothing, no
// sooner than its kind allows after the last time (PieceKind.sleep). A life begun at a bed is a life as any other to
// the dog tags' rules (server/tags.ts): no tag on it until it has lived its time in the Zona, a pair's kills spaced, and
// what a wallet is paid in a day bounded; so a bed is no quicker a way to be killed for a tag than the map's edge.

import { PIECES } from '../src/sim/build/pieces';
import { toWorld, worldYaw } from '../src/sim/build/snap';
import { send, type Client } from './players';
import { bases } from './build';
import { pidOf } from './acts';

/** when each bed was last woken at (`${base}:${piece}`), ms */
const woke = new Map<string, number>();

/** a player's beds, wherever they are, and how many seconds until each may be woken at */
export function bedsOf(c: Client): [number, number, string, number, number, number][] {
  const pid = pidOf(c.key), now = Date.now(), out: [number, number, string, number, number, number][] = [];
  for (const b of bases().bases.values()) {
    for (const p of b.pieces.values()) {
      const s = PIECES[p.k].sleep;
      if (!s || p.by !== pid) continue;
      const [x, , z] = toWorld(b, p.x, p.y, p.z), last = woke.get(`${b.id}:${p.id}`) ?? 0;
      out.push([b.id, p.id, p.k, Math.round(x), Math.round(z), Math.max(0, Math.ceil((last + s * 1000 - now) / 1000))]);
    }
  }
  return out;
}

export function tellBeds(c: Client) {
  send(c, { t: 'beds', list: bedsOf(c) });
}

/** where somebody wakes at a bed of theirs (null: they may not, and have been told why) */
export function wakeAt(c: Client, bed: { b: number; p: number }): { x: number; y: number; z: number; yaw: number } | null {
  const b = bases().bases.get(bed.b), p = b?.pieces.get(bed.p), s = p && PIECES[p.k].sleep;
  if (!b || !p || !s) return void send(c, { t: 'tell', kind: 'warn', text: 'That bed is gone' }), null;
  if (p.by !== pidOf(c.key)) return void send(c, { t: 'tell', kind: 'warn', text: 'That bed is not yours' }), null;
  const key = `${b.id}:${p.id}`, wait = (woke.get(key) ?? 0) + (s as number) * 1000 - Date.now();
  if (wait > 0) return void send(c, { t: 'tell', kind: 'warn', text: `It is not ready: ${Math.ceil(wait / 1000)} s` }), null;
  woke.set(key, Date.now());
  // (on it, a hand over it: a bed's top, a bag's)
  const [x, y, z] = toWorld(b, p.x, p.y + (p.k === 'bed' ? 0.62 : 0.15), p.z);
  return { x, y, z, yaw: worldYaw(b, p.r) + Math.PI };
}
