// The server: the way down's stops out in the world (the rules are src/sim/sites.ts). A card in the reader, from somebody
// standing at it, unlocks the strong room, sets a crate of the bunker's best in it, and starts the siren; the infected
// come in waves until the time is up; then a locker holds the next card, and the place is spent for a while. Crates are set
// down as a supply drop's is, and so they are marked on every map: everybody knows when one has gone off. Nothing here is
// kept over a restart: a site that was going comes back ready.

import { Container } from '../src/sim/inventory';
import { DROP, fillDrop } from '../src/sim/drops';
import { fillCrate } from '../src/sim/crates';
import { makeItem } from '../src/sim/items';
import { SITES, sitePoint, strongDoor, waveSpot, type Site, type SitePhase } from '../src/sim/sites';
import type { C2S, S2C } from '../src/net/protocol';
import { boxes, doors, economy, horde, issue, log, world, type Box } from './index';
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
}

const runs = new Map<string, Run>(Object.keys(SITES).map((id) => [id, { phase: 'idle', until: 0, nextWave: 0, stood: new Set(), crates: [] }]));
/** each site's strong room's door, found when the world is made (-1: none) */
const locks = new Map<string, number>();

/** how long an alarm and a rest last, seconds: a test's are shorter */
const holdOf = (s: Site) => Number(process.env.SITE_HOLD_S) || s.hold;
const againOf = (s: Site) => Number(process.env.SITE_AGAIN_S) || s.again;

const said = (id: string, r: Run, now = Date.now()): Extract<S2C, { t: 'site' }> => ({ t: 'site', s: id, phase: r.phase, left: Math.max(0, Math.round((r.until - now) / 1000)) });

/** how each site stands, for a game that comes in */
export const sitesNow = () => [...runs].map(([id, r]) => said(id, r));

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
  for (const [id, s] of Object.entries(SITES)) doorOf(id, s);
}

/** is this door locked now? (a strong room's, but for the time its site is going and spent) */
export function doorLocked(i: number) {
  for (const [id, s] of Object.entries(SITES)) if (doorOf(id, s) === i) return runs.get(id)!.phase === 'idle';
  return false;
}

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
  for (let k = 0; k < n; k++) {
    // (on the place's own level: one put under a cliff never gets up it)
    let [x, z] = waveSpot(s, k, n, Math.random);
    for (let t = 0; t < 12 && Math.abs(world.groundAt(x, z) - level) > 2.5; t++) [x, z] = waveSpot(s, k, n, Math.random);
    const b = horde.place(x, world.groundAt(x, z), z, now);
    r.stood.add(b.i);
    broadcast({ t: 'i+', b: { i: b.i, s: b.s, hp: b.hp, own: b.own, h: b.h } });
  }
}

/** A card in a reader. */
export function useSite(c: Client, m: Extract<C2S, { t: 'site' }>) {
  const s = SITES[m.s], r = runs.get(m.s);
  if (!s || !r || !c.alive || r.phase !== 'idle' || !carries(c.inv, s.card)) return;
  const [x, z] = sitePoint(s, s.reader);
  if (Math.hypot(x - c.pose[0], z - c.pose[2]) > 4) return;
  const now = Date.now();
  Object.assign(r, { phase: 'alarm', until: now + holdOf(s) * 1000, nextWave: now });
  send(c, { t: 'siteok', card: s.card });
  const i = doorOf(m.s, s);
  if (i >= 0) {
    doors.set(i, [true, 1]);
    broadcast({ t: 'door', i, open: true, swing: 1 });
  }
  crate(s, r, s.crate, (b) => fillCrate(b, 'weapons_case', Math.random, 'bunker'), `The strong room at ${s.name}`, i >= 0 ? world.doorSpecs[i].m.elements[13] : undefined);
  broadcast(said(m.s, r, now));
  log(`[site] ${c.name} set off ${s.name}`);
}

function ready(id: string, s: Site, r: Run, now: number) {
  Object.assign(r, { phase: 'idle', until: 0 });
  // (what is left of it cleared away, and the room shut again)
  for (const i of r.stood) {
    const h = horde.hurt(i, 1e6, now);
    if (h) broadcast({ t: 'ihp', i, hp: h.hp, dead: h.dead, by: 0, zone: 'torso', dir: [0, 0], melee: false });
  }
  r.stood.clear();
  for (const cid of r.crates.splice(0)) if (boxes.delete(cid)) broadcast({ t: 'drop-', uid: cid });
  const i = doorOf(id, s);
  if (i >= 0) {
    doors.set(i, [false, 1]);
    broadcast({ t: 'door', i, open: false, swing: 1 });
  }
  broadcast(said(id, r, now));
}

/** An admin's: every site as it was, at once (/site). */
export function sitesReset() {
  for (const [id, r] of runs) ready(id, SITES[id], r, Date.now());
}

/** Once a second: the waves, and what comes after them. */
export function sitesTick(now: number) {
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
      crate(s, r, s.locker, (b) => {
        b.add(makeItem(s.gives, 1));
        fillDrop(b);
      }, `The locker at ${s.name}`);
      broadcast(said(id, r, now));
    } else if (r.phase === 'spent' && now >= r.until) ready(id, s, r, now);
  }
}
