// The server: the way down's stops out in the world (the rules are src/sim/sites.ts). A card in the reader, from somebody
// standing at it, unlocks the strong room, sets a crate of the bunker's best in it, and starts the siren; the infected
// come in waves until the time is up; then a locker holds the next card, and the place is spent for a while. Crates are set
// down as a supply drop's is, and so they are marked on every map: everybody knows when one has gone off. Nothing here is
// kept over a restart: a site that was going comes back ready.

import { Container } from '../src/sim/inventory';
import { DROP, fillDrop } from '../src/sim/drops';
import { fillCrate } from '../src/sim/crates';
import { ITEMS, makeItem } from '../src/sim/items';
import { levelSpots, levelY } from '../src/sim/bunker';
import { GATES, RIDES, SITES, atSpot, sitePoint, siteSpot, spotAt, strongDoor, waveSpot, type Site, type SitePhase } from '../src/sim/sites';
import type { C2S, S2C } from '../src/net/protocol';
import { boxes, doors, economy, horde, issue, log, world, type Box } from './index';
import { place } from './keep';
import { broadcast, send, type Client } from './players';
import { dropInfo } from './drops';
import { carries } from './tags';

interface Run {
  phase: SitePhase;
  until: number;
  nextWave: number;
  /** what it stood up, to be cleared away at the end */
  stood: Set<number>;
  crates: string[];
  /** when what lies there comes back (0: it is there) */
  fuelAt: number;
  /** which of what is to be turned has been */
  done: Set<number>;
}

const runs = new Map<string, Run>(Object.keys(SITES).map((id) => [id, { phase: 'idle', until: 0, nextWave: 0, stood: new Set(), crates: [], fuelAt: 0, done: new Set() }]));
/** when each gate shuts again (0: it is shut) */
const gates = new Map<string, number>(Object.keys(GATES).map((g) => [g, 0]));
/** each site's strong room's door, found when the world is made (-1: none) */
const locks = new Map<string, number>();

/** how long an alarm and a rest last, seconds: a test's are shorter */
const holdOf = (s: Site) => Number(process.env.SITE_HOLD_S) || s.hold;
const againOf = (s: Site) => Number(process.env.SITE_AGAIN_S) || s.again;

const said = (id: string, r: Run, now = Date.now()): Extract<S2C, { t: 'site' }> => ({ t: 'site', s: id, phase: r.phase, left: Math.max(0, Math.round((r.until - now) / 1000)), ...(SITES[id].fuel ? { fuel: now >= r.fuelAt } : {}), ...(SITES[id].steps ? { done: [...r.done] } : {}) });
const gateSaid = (g: string, until: number, now = Date.now()): Extract<S2C, { t: 'gate' }> => ({ t: 'gate', g, open: until > now, left: Math.max(0, Math.round((until - now) / 1000)) });

/** how each site stands, for a game that comes in */
export const sitesNow = (): S2C[] => [...[...runs].map(([id, r]) => said(id, r)), ...[...gates].map(([g, until]) => gateSaid(g, until))];

function doorOf(id: string, s: Site) {
  let i = locks.get(id);
  if (i === undefined) {
    i = strongDoor(s, (k) => {
      const m = world.doorSpecs[k]?.m.elements;
      return m ? [m[12], m[14]] : null;
    }, world.doorCount);
    locks.set(id, i);
    // (shut, whatever the map's dice said of it)
    if (i >= 0) doors.set(i, [false, 1]);
  }
  return i;
}

/** The world is up: the strong rooms are shut. */
export function sitesReady() {
  for (const [id, s] of Object.entries(SITES)) if (!s.level) doorOf(id, s);
}

/** is this door locked now? (a strong room's, but for the time its site is going and spent) */
export function doorLocked(i: number) {
  for (const [id, s] of Object.entries(SITES)) if (!s.level && doorOf(id, s) === i) return runs.get(id)!.phase === 'idle';
  return false;
}

/** the floor of the level a site is on */
const floorOf = (s: Site) => (s.level ? (world.bunker?.y ?? 0) + levelY(s.level) : undefined);

/** a crate of a site's, set down as a supply drop's is */
function crate(s: Site, r: Run, at: [number, number], fill: (c: Container) => void, label: string, y?: number) {
  const [x, z] = sitePoint(s, at), uid = `site-${Math.round(economy.time)}-${Math.random().toString(36).slice(2, 7)}`;
  const c = new Container(uid, label, DROP.w, DROP.h, [], true);
  fill(c);
  const b: Box = { cid: uid, kind: 'drop', site: label, w: DROP.w, h: DROP.h, items: c.serialize().items, x, y: y ?? world.groundAt(x, z), z, rot: s.town.rot, expires: economy.time + againOf(s), emptiedAt: -1 };
  boxes.set(uid, b);
  for (const it of b.items) issue(it);
  r.crates.push(uid);
  broadcast({ t: 'drop+', d: dropInfo(b) });
}

function wave(s: Site, r: Run, now: number) {
  for (const i of r.stood) if (!horde.bodies.get(i) || horde.bodies.get(i)!.diedAt) r.stood.delete(i);
  const n = Math.min(s.wave.n, s.wave.most - r.stood.size), [rx, rz] = sitePoint(s, s.reader), level = world.groundAt(rx, rz);
  // (on a level of the bunker they come down its passages)
  if (s.level) {
    const spots = levelSpots(s.level), y = (world.bunker?.y ?? 0) + levelY(s.level);
    for (let k = 0; k < n; k++) {
      const [x, z] = sitePoint(s, spots[Math.floor(Math.random() * spots.length)]), b = horde.place(x, y, z, now);
      r.stood.add(b.i);
      broadcast({ t: 'i+', b: { i: b.i, s: b.s, hp: b.hp, own: b.own, h: b.h } });
    }
    return;
  }
  for (let k = 0; k < n; k++) {
    // (on the place's own level: one put under a cliff never gets up it)
    let [x, z] = waveSpot(s, k, n, Math.random);
    for (let t = 0; t < 12 && Math.abs(world.groundAt(x, z) - level) > 2.5; t++) [x, z] = waveSpot(s, k, n, Math.random);
    const b = horde.place(x, world.groundAt(x, z), z, now);
    r.stood.add(b.i);
    broadcast({ t: 'i+', b: { i: b.i, s: b.s, hp: b.hp, own: b.own, h: b.h } });
  }
}

function openRoom(i: number) {
  if (i < 0) return;
  doors.set(i, [true, 1]);
  broadcast({ t: 'door', i, open: true, swing: 1 });
}

/** One of what is to be turned, turned. */
export function useStep(c: Client, m: Extract<C2S, { t: 'sitestep' }>) {
  const s = SITES[m.s], r = runs.get(m.s), at = s?.steps?.at[m.k];
  if (!s?.steps || !r || !at || !c.alive || r.phase !== 'alarm' || r.done.has(m.k) || !atSpot(siteSpot(s, at), world.bunker, c.pose[0], c.pose[1], c.pose[2], 3)) return;
  r.done.add(m.k);
  const now = Date.now();
  if (r.done.size === s.steps.at.length) {
    openRoom(doorOf(m.s, s));
    r.until = now + (process.env.SITE_AFTER_S ? Number(process.env.SITE_AFTER_S) : s.steps.after) * 1000;
  }
  broadcast(said(m.s, r, now));
}

/** A card in a reader. */
export function useSite(c: Client, m: Extract<C2S, { t: 'site' }>) {
  const s = SITES[m.s], r = runs.get(m.s);
  if (!s || !r || !c.alive || r.phase !== 'idle' || (s.card && !carries(c.inv, s.card))) return;
  if (!atSpot(siteSpot(s, s.reader), world.bunker, c.pose[0], c.pose[1], c.pose[2], 4)) return;
  const now = Date.now();
  Object.assign(r, { phase: 'alarm', until: now + holdOf(s) * 1000, nextWave: now });
  if (s.card) send(c, { t: 'siteok', card: s.card });
  // (where there is something to be turned, the room stays shut until the last of it is)
  const i = s.level ? -1 : doorOf(m.s, s);
  if (!s.steps) openRoom(i);
  crate(s, r, s.crate, (b) => fillCrate(b, 'weapons_case', Math.random, 'bunker'), `The strong room at ${s.name}`, floorOf(s) ?? (i >= 0 ? world.doorSpecs[i].m.elements[13] : undefined));
  broadcast(said(m.s, r, now));
  log(`[site] ${c.name} set off ${s.name}`);
}

function ready(id: string, s: Site, r: Run, now: number) {
  Object.assign(r, { phase: 'idle', until: 0 });
  r.done.clear();
  // (what is left of it cleared away, and the room shut again)
  for (const i of r.stood) {
    const h = horde.hurt(i, 1e6, now);
    if (h) broadcast({ t: 'ihp', i, hp: h.hp, dead: h.dead, by: 0, zone: 'torso', dir: [0, 0], melee: false });
  }
  r.stood.clear();
  for (const cid of r.crates.splice(0)) if (boxes.delete(cid)) broadcast({ t: 'drop-', uid: cid });
  const i = s.level ? -1 : doorOf(id, s);
  if (i >= 0) {
    doors.set(i, [false, 1]);
    broadcast({ t: 'door', i, open: false, swing: 1 });
  }
  broadcast(said(id, r, now));
}

/** An admin's: every site as it was, at once (/site). */
export function sitesReset() {
  for (const [id, r] of runs) ready(id, SITES[id], r, Date.now());
  for (const g of gates.keys()) {
    gates.set(g, 0);
    broadcast(gateSaid(g, 0));
  }
}

/** What lies at a site, taken. */
export function takeFuel(c: Client, m: Extract<C2S, { t: 'sitefuel' }>) {
  const s = SITES[m.s], r = runs.get(m.s), now = Date.now();
  if (!s?.fuel || !r || !c.alive || now < r.fuelAt || !atSpot(siteSpot(s, s.fuel.at), world.bunker, c.pose[0], c.pose[1], c.pose[2], 3.5)) return;
  r.fuelAt = now + (Number(process.env.SITE_FUEL_S) || s.fuel.back) * 1000;
  const it = makeItem(s.fuel.item);
  issue(it);
  send(c, { t: 'kit', name: ITEMS[s.fuel.item].name, items: [it], adds: true, gift: ITEMS[s.fuel.item].name });
  broadcast(said(m.s, r, now));
}

/** A pass shown to a gate. */
export function useGate(c: Client, m: Extract<C2S, { t: 'gate' }>) {
  const g = GATES[m.g], now = Date.now();
  if (!g || !c.alive || (gates.get(m.g) ?? 0) > now || !carries(c.inv, g.card)) return;
  const [x, y, z] = c.pose;
  if (!atSpot(g.at, world.bunker, x, y, z, 4) && !(g.also && atSpot(g.also, world.bunker, x, y, z, 4))) return;
  const until = now + (Number(process.env.SITE_GATE_S) || g.open) * 1000;
  gates.set(m.g, until);
  if (!g.keep) send(c, { t: 'siteok', card: g.card });
  broadcast(gateSaid(m.g, until, now));
  log(`[gate] ${c.name} opened ${g.name}`);
}

/** A ride taken: from where it leaves, and only while its gate is open. */
export function useRide(c: Client, m: Extract<C2S, { t: 'ride' }>) {
  const w = RIDES[m.w], now = Date.now();
  if (!w || !c.alive || c.seatAt || (w.gate && (gates.get(w.gate) ?? 0) <= now) || !atSpot(w.from, world.bunker, c.pose[0], c.pose[1], c.pose[2], 3.5)) return;
  const [x, y, z] = spotAt(w.to, world.bunker);
  place(c, x, y, z, c);
}

/** Once a second: the waves, and what comes after them. */
export function sitesTick(now: number) {
  for (const [g, until] of gates) {
    if (until && now >= until) {
      gates.set(g, 0);
      broadcast(gateSaid(g, 0, now));
    }
  }
  for (const [id, r] of runs) {
    const s = SITES[id];
    if (r.phase === 'alarm') {
      if (now < r.until) {
        if (now >= r.nextWave) {
          r.nextWave = now + s.wave.every * 1000;
          wave(s, r, now);
        }
        continue;
      }
      Object.assign(r, { phase: 'spent', until: now + againOf(s) * 1000 });
      // (time up with something still to turn: nothing to show for it)
      if (s.steps && r.done.size < s.steps.at.length) {
        broadcast(said(id, r, now));
        continue;
      }
      crate(s, r, s.locker, (b) => {
        b.add(makeItem(s.gives, 1));
        fillDrop(b);
      }, `The locker at ${s.name}`, floorOf(s));
      broadcast(said(id, r, now));
    } else if (r.phase === 'spent' && now >= r.until) ready(id, s, r, now);
    if (r.fuelAt && now >= r.fuelAt) {
      r.fuelAt = 0;
      broadcast(said(id, r, now));
    }
  }
}
