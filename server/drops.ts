// The server: supply drops and the helicopter that brings them.
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { Container } from '../src/sim/inventory';
import { DROP, type DropInfo, CRASH, fillCrash, fillDrop } from '../src/sim/drops';
import { type Flight, planFlight, flightTimes, comesFrom, restAt } from '../src/sim/airdrop';
import { boxes, economy, issue, locks, log, world, type Box } from './index';
import { SITE_URL } from './tags';
import { broadcast, clients } from './players';

// ------------------------------------------------------------------ supply drops
//
// See src/sim/drops.ts. One at a time, and only while somebody is alive to go and get it.

const DROP_EVERY = Number(process.env.DROP_EVERY_S) || DROP.every;

const DROP_FIRST = Number(process.env.DROP_FIRST_S) || DROP.first;

const DROP_LIFE = Number(process.env.DROP_LIFE_S) || DROP.life;

const DROP_LINGER = Number(process.env.DROP_LINGER_S) || DROP.linger;

/** economy time the next one is due (-1 until the clock is first read) */
let nextDrop = -1;

export function dropInfo(b: Box): DropInfo {
  return { uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, left: Math.max(0, Math.round((b.expires ?? 0) - economy.time)), ...(b.heli ? { heli: true } : {}) };
}

/**
 * The helicopters in the air with a supply drop (src/sim/airdrop.ts): each flight as it was said, and the moment
 * (the clock on the wall, ms) it appeared on the map's edge. Everything a game draws and hears of one follows from
 * those two. Not kept over a restart: a flight the server forgets brings no crate, and the next comes by the clock.
 */
export const flights = new Map<string, { f: Flight; at: number; landed: boolean }>();

/** a flight as it is said to somebody now: with how long it has been in the air */
export const flightNow = (e: { f: Flight; at: number }): Flight => ({ ...e.f, age: Math.round((Date.now() - e.at) / 10) / 100 });

/**
 * A supply drop is sent: a helicopter appears on the map's edge, flies to the place, holds over it and lets the
 * crate down under a canopy, stays a while and flies off the map another way. Everybody is told of the flight at
 * once (`heli+`), and of the crate (`drop+`) only when it is on the ground: until then there is nothing in the
 * world to open.
 * @param where the place (called for on a radio, or an admin's), and not one of the map's choosing
 * @param by whoever called it
 * @returns the flight, or null if the map had nowhere to set a crate down
 */
export function sendDrop(where?: { x: number; y: number; z: number }, by?: number): Flight | null {
  // (out in the wild country, past the line, and not beside anybody: it is something to go to)
  const at = where ?? world.dropSite(undefined, false, [...clients.values()].filter((c) => c.alive).map((c) => ({ x: c.pose[0], z: c.pose[2] })));
  if (!at) return null;
  const uid = `drop-${Math.round(economy.time)}-${Math.random().toString(36).slice(2, 7)}`;
  const f = planFlight(world.groundAt, at, uid, Math.random, by);
  const T = flightTimes(f), e = { f, at: Date.now(), landed: false };
  flights.set(uid, e);
  broadcast({ t: 'heli+', f });
  setTimeout(() => {
    e.landed = true;
    spawnDrop(at, false, uid);
  }, T.land * 1000);
  setTimeout(() => flights.delete(uid), T.gone * 1000);
  log(`helicopter in from the ${comesFrom(f)} with a supply drop for ${Math.round(at.x)}, ${Math.round(at.z)}: over it in ${T.arrive.toFixed(0)} s, down in ${T.land.toFixed(0)}, gone in ${T.gone.toFixed(0)}`);
  return f;
}

/**
 * @param where set down here (where the helicopter let it down) and not at a place of the map's choosing
 * @param flown the number of the flight that brought it: the crate that stands there is the one that came down
 */
function spawnDrop(where?: { x: number; y: number; z: number }, heli = false, flown?: string) {
  // (a supply drop out in the wild country, past the line; a helicopter's cargo inside it)
  // (and not beside anybody: it is something to go to)
  const at = where ?? world.dropSite(undefined, heli, [...clients.values()].filter((c) => c.alive).map((c) => ({ x: c.pose[0], z: c.pose[2] })));
  if (!at) return;
  const uid = flown ?? `drop-${Math.round(economy.time)}-${Math.random().toString(36).slice(2, 7)}`;
  const [w, h] = heli ? [CRASH.w, CRASH.h] : [DROP.w, DROP.h];
  const c = new Container(uid, heli ? CRASH.label : DROP.label, w, h, [], true);
  if (heli) fillCrash(c);
  else fillDrop(c);
  const b: Box = { cid: uid, kind: 'drop', w, h, items: c.serialize().items, x: at.x, y: at.y, z: at.z, rot: flown ? restAt(flown) : Math.random() * Math.PI * 2, emptiedAt: -1, expires: economy.time + (heli ? CRASH.life : DROP_LIFE), ...(heli ? { heli: true } : {}) };
  boxes.set(uid, b);
  for (const it of b.items) issue(it);
  broadcast({ t: 'drop+', d: dropInfo(b) });
  log(`${heli ? 'helicopter down' : 'supply drop'} at ${Math.round(at.x)}, ${Math.round(at.z)} (${b.items.length} items)`);
}

/** every five seconds: clear away the one that is done with, set the next one down when it is due */
/** economy time the next helicopter is due to come down (-1 until the clock is first read) */
let nextCrash = -1;

export function tickDrops(anyoneAlive: boolean) {
  let standing = false, wreck = false;
  for (const b of [...boxes.values()]) {
    if (b.kind !== 'drop') continue;
    // (never from under somebody who has it open)
    const done = economy.time > (b.expires ?? 0) || (b.emptiedAt >= 0 && economy.time - b.emptiedAt > DROP_LINGER);
    if (done && !locks.has(b.cid)) {
      boxes.delete(b.cid);
      broadcast({ t: 'drop-', uid: b.cid });
    } else if (b.heli) wreck = true;
    else standing = true;
  }
  // (helicopters keep a clock of their own: one down at a time, the first a few minutes after somebody turns up)
  if (nextCrash < 0 || !anyoneAlive) nextCrash = Math.max(nextCrash, economy.time + (Number(process.env.CRASH_FIRST_S) || CRASH.first));
  else if (economy.time >= nextCrash && !wreck) {
    nextCrash = economy.time + (Number(process.env.CRASH_EVERY_S) || CRASH.every);
    spawnDrop(undefined, true);
  }
  // (one on its way down is one standing: there is one aircraft)
  if ([...flights.values()].some((e) => !e.landed)) standing = true;
  // with nobody about the clock waits: the first one comes a minute and a half after somebody turns up
  if (nextDrop < 0 || !anyoneAlive) nextDrop = Math.max(nextDrop, economy.time + DROP_FIRST);
  else if (economy.time >= nextDrop && !standing) {
    nextDrop = economy.time + DROP_EVERY;
    sendDrop();
  }
}

// A tag taken off somebody is worth a reward once it has been carried for fifteen minutes, so
// the safest thing to do with one was to sit in a bush until the clock ran out. Every half
// minute the map shows everybody where each carrier is: the tag has to be defended, or run with.
export const TAG_PING_MS = (Number(process.env.TAG_PING_S) || 30) * 1000;

// The site's housekeeping (api/tick.ts: payments still on their way, tags waiting for the
// treasury, creator rewards to collect) is given a nudge every ten minutes while anybody is
// playing, and once shortly after this server starts: what it was following before a restart
// it no longer knows about.
export const nudge = () => void fetch(`${SITE_URL}/api/tick`, { signal: AbortSignal.timeout(75_000) }).catch(() => {});
