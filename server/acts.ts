// The server: what happens to players and things (locks, voice, carried things, seats, jeeps hurt and blown up, bodies, a kill).
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { Container, BODY_GRID, HOLD, layOnBody, heldIn } from '../src/sim/inventory';
import { ZONA_VOID, type ItemInstance } from '../src/sim/items';
import { VOICE } from '../src/sim/voice';
import { WEAPON_RULES, hitDamage } from '../src/sim/combat';
import { fallen } from '../src/sim/grenades';
import { JEEP, RIDE_HEIGHT, SEATS, restState, type VState } from '../src/sim/vehicles';
import { HELI, heliCrash, hpOf } from '../src/sim/heli';
import { type CorpseInfo, type KillInfo, F_DEAD } from '../src/net/protocol';
import { RACKS, rackShows } from '../src/sim/crates';
import { CORPSE_LIFETIME, PARKS, boxes, economy, issue, jeepsDue, locks, log, tellSeats, vehicles, world, type Box, type Veh } from './index';
import { TAG_CAUSE_MS, TAG_FRESH_MS, TAG_NEEDS_KILLER, carriedTags, lootedFrom, lootedTags, seenOf, tagSeen, theirOwn } from './tags';
import { CHECK, dealt } from './checks';
import { ADMIN, fellBlast, tagLock } from './gate';
import { inPlay } from '../src/world/worldgen';
import { broadcast, cleanItem, clients, drop, send, type Client } from './players';
import { scoreOf, sendBoard } from './queue';

// ------------------------------------------------------------------ gameplay

export function releaseLock(c: Client, lying = true) {
  if (c.openCid && locks.get(c.openCid) === c.id) {
    locks.delete(c.openCid);
    ajar(c.openCid, false);
  }
  c.openCid = null;
  // (and the things lying about they had open with their pockets, unless it is only another crate being opened)
  if (!lying) return;
  for (const uid of c.openLying) if (locks.get(`l:${uid}`) === c.id) locks.delete(`l:${uid}`);
  c.openLying.clear();
}

/**
 * One of the map's containers is being searched, or no longer is: everybody is told, and whoever is near one that
 * has doors sees them swing open, stand open and shut again (a locker: src/game/lockers.ts). Only of what is part of
 * the map: a body, a drop and a stash have no doors. And nothing is said of what a vanished admin opens: a door
 * that opens by itself is somebody.
 */
/** what each gun rack was last said to hold, by its crate's id */
const racked = new Map<string, string>();
/** the guns standing in every gun rack, as the welcome tells them */
export const racksNow = (): [string, string[]][] => [...boxes.values()].filter((b) => RACKS.has(b.crate ?? '')).map((b) => [b.cid, rackShows(b.items)]);
/** A gun rack's guns, told to everybody when they are not what was last told (what else is in it is seen when it is opened). */
export function rackChanged(b: Box) {
  if (!RACKS.has(b.crate ?? '')) return;
  const g = rackShows(b.items), was = racked.get(b.cid), now = g.join(',');
  racked.set(b.cid, now);
  if (was !== now) broadcast({ t: 'rack', cid: b.cid, g });
}

export function ajar(cid: string, open: boolean, by?: Client) {
  if (boxes.get(cid)?.kind !== 'crate' || (open && by?.power.hidden)) return;
  broadcast({ t: 'cdoor', cid, open });
}

/** The short public mark of a key, as a player's own game stamps it on their tag (publicId in src/net/client.ts: the same sum). */
function pidOf(key: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < key.length; i++) {
    a = Math.imul(a ^ key.charCodeAt(i), 16777619);
    b = (Math.imul(b, 33) ^ key.charCodeAt(i)) | 0;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/**
 * A piece of somebody's speech: passed on, with whose it is in front of it, to whoever is alive within earshot of
 * them and to nobody else. Nothing is kept of it. One player sends no more than VOICE.rate pieces a second over
 * time and no more than VOICE.burst at once, none bigger than VOICE.bytes; the dead say nothing.
 */
const said = new Map<number, { at: number; left: number }>();

export function voice(c: Client, piece: Buffer) {
  if (!c.alive || piece.length < 3 || piece.length > VOICE.bytes || (ADMIN.muted.get(c.key) ?? 0) > Date.now()) return;
  const now = Date.now();
  // (an allowance that fills at VOICE.rate a second and holds VOICE.burst: what comes all at once after a stop is passed on whole)
  let k = said.get(c.id);
  if (!k) said.set(c.id, (k = { at: now, left: VOICE.burst }));
  k.left = Math.min(VOICE.burst, k.left + ((now - k.at) / 1000) * VOICE.rate);
  k.at = now;
  if (k.left < 1) return;
  k.left--;
  const out = Buffer.allocUnsafe(piece.length + 2);
  out.writeUInt16LE(c.id & 0xffff, 0);
  piece.copy(out, 2);
  for (const o of clients.values()) {
    if (o === c || !o.alive || o.ws.readyState !== 1) continue;
    if (Math.hypot(o.pose[0] - c.pose[0], o.pose[1] - c.pose[1], o.pose[2] - c.pose[2]) > VOICE.range) continue;
    o.ws.send(out, { binary: true });
  }
}

/** an item the server knows this player is carrying (pockets, slots, worn bags) */
export function findCarried(c: Client, uid: unknown): ItemInstance | null {
  if (!c.inv || typeof uid !== 'string') return null;
  const walk = (it: ItemInstance | null | undefined): ItemInstance | null => {
    if (!it) return null;
    if (it.uid === uid) return it;
    for (const p of it.cargo ?? []) {
      const hit = walk(p.item);
      if (hit) return hit;
    }
    return null;
  };
  for (const it of Object.values(c.inv.slots)) {
    const hit = walk(it);
    if (hit) return hit;
  }
  for (const cont of c.inv.containers) {
    for (const it of cont.items) {
      const hit = walk(it);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * A tag's clock belongs to whoever is carrying it alive. On a body it stops, and whoever
 * takes the tag next starts from nothing: the one who died too, if they come back for it
 * (the server's own clock for them was cleared when they died: see kill).
 */
function stopTagClocks(it: ItemInstance) {
  if (it.id === 'dogtag') {
    it.holder = undefined;
    it.held = 0;
  }
  for (const p of it.cargo ?? []) stopTagClocks(p.item);
}

/** the jeep a player sits in, and which seat */
export function seatOf(c: Client): { v: Veh; seat: number } | null {
  if (!c.seatAt) return null;
  for (const v of vehicles.values()) {
    const seat = v.seats.indexOf(c.id);
    if (seat >= 0) return { v, seat };
  }
  return null;
}

/** out of whatever they are sitting in (they got out, died, or are gone) */
export function leaveSeat(c: Client, gone = false) {
  const at = seatOf(c);
  // (out of a jeep that is moving, a body goes on moving)
  if (c.seatAt) c.check.free = Date.now() + CHECK.free;
  c.seatAt = 0;
  if (!at) {
    // (not in a seat, but perhaps still the one moving a jeep they got out of)
    if (gone) for (const v of vehicles.values()) if (v.sim === c.id) {
      if (orphanHeli(v, c)) continue;
      v.sim = null;
      v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
      tellSeats(v, true);
    }
    return;
  }
  const { v, seat } = at;
  v.seats[seat] = null;
  // (A helicopter whose pilot is shot out of it, or who leaves the game, is not left to their game: whoever is still
  // in it moves it from now on, so that it comes down for everybody as it falls, and they can take its controls.)
  const aboard = v.seats.find((s) => s !== null);
  if (v.k === HELI.kind && v.sim === c.id && aboard != null) {
    v.sim = aboard;
    v.heard = Date.now();
    tellSeats(v);
    return;
  }
  // The game that was moving it goes on doing so until it has rolled to a stop (see 'vrest'):
  // unless that game is gone, and then it stops where it was last seen (a helicopter in the air: see orphanHeli).
  // (A solo pilot shot dead in the air is gone from its controls as surely: their game flies it no more, and it hung
  // where they died with their body sat in it, never "down" for `riders` to lay them out. The owner, 2026-10-16: "when
  // a player is shot out of a helicopter their body remains floating in the sky, it should be stuck in the helicopter
  // till the helicopter lands or crashes then spawn on the ground".)
  if ((gone || !c.alive) && v.sim === c.id && orphanHeli(v, c)) return;
  if (gone && v.sim === c.id) {
    v.sim = null;
    v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
    tellSeats(v, true);
  } else tellSeats(v);
}

/** which way a vehicle's nose points, as a yaw, from how it is turned (the game's yaw: 0 looks down -z) */
const yawOf = (s: VState) => {
  const [x, y, z, w] = [s[3], s[4], s[5], s[6]];
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
};

/**
 * A helicopter in the air whose pilot has left the game with nobody aboard, so that no game moves it any more: the
 * game of whoever is nearest takes it over, and everybody sees it come down; with nobody near enough to see it, the
 * server sets it down where it would have fallen, as wrecked as that fall wrecks one (the owner, 2026-10-14: "a solo
 * pilot who disconnected would crash yes?"). @returns whether it was one, and was seen to
 */
function orphanHeli(v: Veh, by: Client): boolean {
  if (v.k !== HELI.kind || v.goneAt) return false;
  const [x, y, z] = v.s, ground = world.standAt(x, y, z), fall = y - RIDE_HEIGHT - ground;
  if (fall < 1.5) return false;
  let near: Client | null = null, best: number = HELI.handOver;
  for (const o of clients.values()) {
    if (o === by || !o.alive || o.asleep) continue;
    const d = Math.hypot(o.pose[0] - x, o.pose[2] - z);
    if (d < best) [near, best] = [o, d];
  }
  if (near) {
    v.sim = near.id;
    v.heard = Date.now();
    tellSeats(v);
    return true;
  }
  v.sim = null;
  v.s = restState(x, ground, z, yawOf(v.s));
  tellSeats(v, true);
  hurtJeep(v, heliCrash(Math.sqrt(2 * 9.81 * fall)).jeep, by);
  log(`the helicopter ${v.i} came down ${fall.toFixed(0)} m with nobody's game to move it`);
  return true;
}

/**
 * A helicopter gone up in the air comes down: the game of whoever is nearest lets the wreck fall, tumbling, and
 * everybody sees it hit the ground; with nobody near enough to see it, the server sets it down under where it went up.
 * It hung in the sky where it blew, and whoever had died in it with it (the owner, 2026-10-19: "when a helicopter
 * explodes in mid air it just stays there and does not tumble to the ground like it should").
 */
function dropWreck(v: Veh, aboard: (number | null)[]) {
  const [x, y, z] = v.s, ground = world.standAt(x, y, z);
  if (v.k !== HELI.kind || y - RIDE_HEIGHT - ground < 1.5) return;
  let near: Client | null = null, best: number = HELI.handOver;
  // (not whoever was aboard: the blast in the seat is the end of them, a moment after this, by their own game)
  for (const o of clients.values()) {
    if (!o.alive || o.asleep || aboard.includes(o.id)) continue;
    const d = Math.hypot(o.pose[0] - x, o.pose[2] - z);
    if (d < best) [near, best] = [o, d];
  }
  if (near) {
    v.sim = near.id;
    v.heard = Date.now();
    v.falling = true;
    tellSeats(v);
    return;
  }
  v.s = restState(x, ground, z, yawOf(v.s));
  tellSeats(v, true);
}

/** a jeep is hit: what it has left, and what follows from that */
export function hurtJeep(v: Veh, amount: number, by: Client) {
  if (v.goneAt || amount <= 0) return;
  v.hp = Math.max(0, v.hp - amount);
  broadcast({ t: 'vhp', i: v.i, hp: Math.round(v.hp), by: by.id });
  if (v.hp <= 0) return blowJeep(v, by.id);
  // on fire: it goes up in a few seconds, and everybody in it knows it
  if (v.hp <= hpOf(v.k) * JEEP.fireAt && !v.burnAt) {
    v.burnAt = Date.now() + JEEP.fuse * 1000;
    v.by = by.id;
  }
}

export function blowJeep(v: Veh, byId: number) {
  if (v.goneAt) return;
  const now = Date.now();
  v.hp = 0;
  v.burnAt = 0;
  v.goneAt = now + 120_000;
  v.siren = false;
  jeepsDue.set(v.home, now + RESPAWN_MS);
  const by = clients.get(byId);
  broadcast({ t: 'vboom', i: v.i, by: byId });
  // whoever is in it, and whoever is standing by it
  const rule = WEAPON_RULES.barrel;
  for (const c of clients.values()) {
    if (!c.alive) continue;
    const inside = v.seats.includes(c.id);
    const d = Math.hypot(c.pose[0] - v.s[0], c.pose[1] + 1 - v.s[1], c.pose[2] - v.s[2]);
    const amount = inside ? 400 : hitDamage('barrel', 'torso', Math.max(0, d - 1.5));
    if (amount <= 0 || d > rule.blast! + 3 || c.power.god) continue;
    if (by && by !== c) c.lastHitBy = { id: by.id, name: by.name, w: 'fire', zone: 'torso', dist: d, at: now };
    const len = Math.max(0.001, Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]));
    dealt(c, amount, 'torso', 'fire');
    send(c, { t: 'dmg', from: byId, amount, zone: 'torso', w: 'fire', dir: [(c.pose[0] - v.s[0]) / len, 0, (c.pose[2] - v.s[2]) / len] });
  }
  for (const id of v.seats) {
    const c = id === null ? undefined : clients.get(id);
    if (c) c.seatAt = 0;
  }
  const aboard = v.seats;
  v.seats = Array(SEATS).fill(null);
  v.sim = null;
  v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
  tellSeats(v, true);
  // (and one that went up in the air comes down)
  dropWreck(v, aboard);
  log(`jeep #${v.i} burned out${by ? ` (${by.name})` : ''}`);
}

/** how long before a new car is stood for one burned or taken away, and how long one may be left alone (JEEP.idle) */
const RESPAWN_MS = (Number(process.env.JEEP_RESPAWN_S) || JEEP.respawn) * 1000;
export const CAR_IDLE_MS = (Number(process.env.CAR_IDLE_S) || JEEP.idle.after) * 1000;

/**
 * Each second, for each car: whoever sits at its wheel winds its clock back; one left alone too long (JEEP.idle) with
 * nobody in it and nobody near is taken away, and a new one is due at its place, unless another car stands there.
 * Cars are not kept over a restart, so neither is the clock, nor is one taken away brought back.
 * @returns whether it was taken away
 */
export function leftAlone(v: Veh, now: number): boolean {
  if (v.seats[0] !== null) v.drivenAt = now;
  if (v.goneAt || v.burnAt || now - v.drivenAt < CAR_IDLE_MS || v.seats.some((s) => s !== null)) return false;
  const p = PARKS[v.home];
  if (p && Math.hypot(v.s[0] - p.x, v.s[2] - p.z) < 8) return false;
  if ([...clients.values()].some((c) => c.alive && Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]) < JEEP.idle.clear)) return false;
  vehicles.delete(v.i);
  broadcast({ t: 'v-', i: v.i });
  // (unless another car stands at its place now: an admin's is booked to the nearest place of its kind, and one driven
  // off from there left the place empty, its own never to come back)
  if (!jeepsDue.has(v.home) && ![...vehicles.values()].some((o) => o.home === v.home && !o.goneAt && p && Math.hypot(o.s[0] - p.x, o.s[2] - p.z) < 8)) jeepsDue.set(v.home, now + RESPAWN_MS);
  log(`car #${v.i} left alone ${Math.round((now - v.drivenAt) / 60000)} min at ${v.s[0].toFixed(0)}, ${v.s[2].toFixed(0)}: taken away`);
  return true;
}

/**
 * everything a character carried goes into a body that can be searched for a while
 *
 * What was worn lies in the body's grid as the thing it is, with what was in it still in it: the jacket with what
 * was in its pockets and the trousers with theirs, as a pack always did (2026-10-13: "When i kill someone and i
 * loot their body and i pick up their backpack it should bring all the loot with it ... it should be the same for
 * all inventories"). The grid is BODY_GRID, which holds all a person can have on at once: it was 8x10, and pocket
 * loot and taken tags that found no room were thrown on the ground round the body.
 */
function makeCorpse(c: Client, v: number, ride?: Box['ride']): CorpseInfo | null {
  const inv = c.inv;
  const [x, , z, yaw] = c.pose;
  // (on what is under where they died: dead in the air, off a jump or out of a helicopter, the body falls (see kill))
  const at = c.pose[1], under = world.standAt(x, at, z), y = !ride && at - under > 1.5 ? under : at;
  const uid = `corpse_${c.id}_${Date.now().toString(36)}`;
  const box = new Container(uid, 'Body', BODY_GRID[0], BODY_GRID[1], [], true);
  const spill: ItemInstance[] = [];
  /** what is to lie in the grid: laid all at once, the biggest first, so that the small things fill what is left */
  const laid: ItemInstance[] = [];
  // Their own tag (one, however many they claim to carry): on the body to be taken and cashed in, unless they had
  // only just arrived. Somebody alive less than TAG_FRESH leaves no tag of their own at all: not the one round
  // their neck, and not an older one of theirs that they took back off their last body. (That one was left on
  // them: whoever killed a player a minute after they started again found a tag, and one that paid.) What they
  // took off other people is on the body as it always was.
  // (It is known for theirs by the mark of their key on it, or by their name: by the name alone, somebody who
  // came back under another name carried a tag that was nobody's, and it was left on them whenever they died.)
  const mine = pidOf(c.key);
  const own = inv ? carriedTags(inv).find((t) => !lootedTags.has(t.uid) && (t.pid === mine || (t.owner ?? '') === c.name)) : undefined;
  const lived = Date.now() - c.lifeAt, fresh = lived < TAG_FRESH_MS;
  // (and none from a death no other player caused: the owner, 2026-10-18, of the bots that lived out the tag's time
  // and then had their own game say they "died of wounds", leaving a tag for their partner to take. A player's hit
  // within TAG_CAUSE_MS counts, so one who bleeds out from a gunshot still leaves theirs.)
  const hitter = c.lastHitBy && c.lastHitBy.id !== c.id && Date.now() - c.lastHitBy.at < TAG_CAUSE_MS ? c.lastHitBy : null;
  const nobody = TAG_NEEDS_KILLER && !hitter && !fresh;
  // (and an admin who has chosen so leaves no tag of their own either, however long they lived, unless an admin above
  // them has chosen for them (tagLock); or nothing at all of what they carried but the tags they took off other people)
  const lock = tagLock(c.key);
  // (nor anybody's who dies outside the Zona: the owner, 2026-10-19, "people cannot earn tags west of the wall")
  const outside = ZONA_VOID && !inPlay(c.pose[0], c.pose[2]);
  const noTag = fresh || nobody || outside || (lock === undefined ? c.power.voidTag : !lock), bare = c.power.voidInv;
  /** a tag that is on a body whoever's body it is: one taken off somebody else */
  const taken = (t: ItemInstance) => {
    const from = lootedTags.get(t.uid);
    return !!from && !theirOwn(from, c.key);
  };
  let older = 0;
  const theirs = (it: ItemInstance) => {
    if (it.id !== 'dogtag' || taken(it)) return false;
    if (lootedTags.delete(it.uid)) older++;
    return true;
  };
  /** their own tags out of a thing, and out of whatever is in it: a pocket is inside the jacket now, one further in than it was */
  const shed = (it: ItemInstance) => {
    if (!it.cargo) return;
    it.cargo = it.cargo.filter((p) => !theirs(p.item));
    for (const p of it.cargo) shed(p.item);
  };
  const put = (it: ItemInstance | null) => {
    if (!it || (noTag && theirs(it))) return;
    // (an admin who leaves nothing leaves the tags all the same, out of whatever they were carried in: the pockets were gone through thing by thing when they were the body's own)
    if (bare && it.id !== 'dogtag') return void (it.cargo ?? []).forEach((p) => put(p.item));
    if (noTag) shed(it);
    stopTagClocks(it);
    laid.push(it);
  };
  if (inv) {
    for (const it of Object.values(inv.slots)) put(it);
    for (const cont of inv.containers) if (cont.id !== HOLD) for (const s of cont.items) put(cleanItem(s));
    spill.push(...layOnBody(box, laid));
    // An admin's hold is nobody's on a body: a body has a body's room and no more. What was in it is laid after
    // everything that was worn, in whatever of the grid that has left, and what finds no room there is gone: not
    // thrown on the ground round the body, where forty rifles would lie for whoever came by. (An admin who leaves
    // nothing when they die, which is how every admin begins, leaves none of this either: `put` sees to that.)
    const held = heldIn(inv);
    if (held.length) {
      laid.length = 0;
      for (const s of held) put(cleanItem(s));
      const lost = layOnBody(box, laid);
      log(`${c.name} died with ${held.length} things in an admin's hold: ${bare ? 'none of them is left (an admin, who chose so)' : `${laid.length - lost.length} lie on the body, and ${lost.length} found no room there and are gone`}`);
    }
    if (own && !noTag) lootedTags.set(own.uid, lootedFrom(c, lived));
    else if (own || older) {
      log(`${c.name} left no dog tag: ${fresh ? `alive ${Math.round(lived / 1000)} s` : nobody ? 'no other player killed them' : 'an admin, who chose so'}${older ? ` (nor ${older} older of their own, taken back)` : ''}`);
      const by = c.lastHitBy && Date.now() - c.lastHitBy.at < 15000 ? clients.get(c.lastHitBy.id) : undefined;
      if (by && by !== c) send(by, { t: 'tell', kind: 'info', text: fresh ? `No dog tag on ${c.name}: alive less than ${Math.round(TAG_FRESH_MS / 60000)} minutes.` : `No dog tag on ${c.name}: an admin, at work.` });
    }
    if (bare) log(`${c.name} left nothing they carried on their body: an admin, who chose so`);
  }
  for (const it of spill) {
    const a = Math.random() * Math.PI * 2;
    economy.drop(it, x + Math.cos(a) * 0.9, y, z + Math.sin(a) * 0.9, Math.random() * 6.28);
  }
  if (!box.items.length) return null;
  // (what is on a body is in the world from now on, whatever it was before: it is whoever carried it that was asked)
  for (const p of box.items) issue(p.item);
  boxes.set(uid, { cid: uid, kind: 'corpse', w: BODY_GRID[0], h: BODY_GRID[1], items: box.serialize().items, x, y, z, rot: yaw, emptiedAt: -1, name: c.name, expires: economy.time + CORPSE_LIFETIME, v, ...(ride ? { ride } : {}) });
  if (ride) riders.add(uid);
  return { uid, x, y, z, rot: yaw, name: c.name, v, ...(ride ? { ride } : {}) };
}

/**
 * The dead who ride on (the owner, 2026-10-14: "when a player gets shot out of [the helicopter] their body should
 * stay in the helicopter till it crashes then spawn on the ground with all the contents on the ground so they can be
 * looted, currently the player just dies in the sky"). Somebody killed in a helicopter's seat stays sat in it, with
 * all they carried, until it is down: at rest, wrecked, or gone. Then the body is laid on the ground beside their
 * door ('corpse@'), to be searched there. (Laid where they died, it lay on the helicopter's own floor in the air,
 * every game finding that under it, and stayed there as the helicopter flew on.) The bodies' uids.
 */
export const riders = new Set<string>();

/** how far from the helicopter's middle, out of the side of its seat, a body that rode it down is laid (it is some two metres across) */
const OUT_BESIDE = 2.4;

/** each second: whatever helicopter a body rides that is down, the body is laid beside it */
export function settleRiders() {
  for (const uid of riders) {
    const b = boxes.get(uid);
    if (!b?.ride) {
      riders.delete(uid);
      continue;
    }
    const v = vehicles.get(b.ride.i);
    if (v && !v.goneAt) {
      // (down: barely moving, and on the ground or left to nobody's game; a helicopter hanging still in the air is not)
      const [x, y, z] = v.s, still = Math.hypot(v.s[7], v.s[8], v.s[9]) < 0.6;
      if (!still || (v.sim !== null && y - RIDE_HEIGHT - world.standAt(x, y, z) > 1)) continue;
    }
    // (beside the door of the seat they sat in: the pilot's on the left. Wrecked in the air, under where it went up.)
    const s = v ? v.s : null, yaw = s ? yawOf(s) : b.rot, side = b.ride.seat === 0 ? -1 : 1;
    const x = (s ? s[0] : b.x) + side * OUT_BESIDE * Math.cos(yaw), z = (s ? s[2] : b.z) - side * OUT_BESIDE * Math.sin(yaw);
    // (as high as the helicopter's skids, or the ground there if that is higher: on the hospital's roof the roof, which
    // the server does not know of; every game lays it on whatever is under that, as it does any body)
    const ground = world.standAt(x, s ? s[1] : b.y, z);
    b.x = x;
    b.y = s && !v!.goneAt ? Math.max(ground, s[1] - RIDE_HEIGHT) : ground;
    b.z = z;
    b.rot = yaw;
    delete b.ride;
    riders.delete(uid);
    broadcast({ t: 'corpse@', corpse: { uid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor', v: b.v ?? 0 } });
    log(`${b.name}'s body came down with the helicopter ${v ? v.i : '(gone)'}`);
  }
}

export function kill(c: Client, cause: string, v = 0) {
  if (!c.alive) return;
  c.alive = false;
  c.logoutAt = 0;
  // A grenade with its pin out in their hand does not go with them: it falls where they fell, everybody else is
  // shown it lying there with what is left of its fuse (their own game lets go of it by itself), and when that has
  // run the server reckons whom it reached: see `fellBlast`. (It vanished, until the ruling of 2026-10-13.)
  const fell = fallen(c.nades, [c.pose[0], c.pose[1], c.pose[2]], Date.now());
  if (fell) {
    broadcast({ t: 'nade', id: c.id, o: fell.from, v: [0, 0, 0], w: fell.w, f: fell.left }, c);
    setTimeout(() => fellBlast(c, fell.w, fell.lies), fell.left * 1000);
  }
  // (a body left behind has nobody to come back to it: it is out of the world once it has fallen)
  if (c.asleep) setTimeout(() => drop(c), 3000);
  releaseLock(c);
  // (killed in a helicopter: the body stays in its seat until the helicopter is down, see `riders`; the owner, 2026-10-19,
  // "the shot player who dies in heli should remain with the heli till it touches the ground or crashes then it should
  // fall on the ground")
  const rode = seatOf(c);
  const ride = rode && rode.v.k === HELI.kind && !rode.v.goneAt ? { i: rode.v.i, seat: rode.seat } : undefined;
  leaveSeat(c);
  const now = Date.now();
  const by = c.lastHitBy && now - c.lastHitBy.at < 15000 ? c.lastHitBy : null;
  const k: KillInfo = { id: c.id, name: c.name, by: by?.id ?? null, byName: by?.name ?? null, w: by?.w ?? cause, zone: by?.zone ?? null, dist: Math.round(by?.dist ?? 0), v };
  const corpse = makeCorpse(c, v, ride);
  for (const k of [...tagSeen.keys()]) if (k.startsWith(seenOf(c.key))) tagSeen.delete(k);
  c.inv = null;
  c.vitals = null;
  c.lastHitBy = null;
  c.pose[5] |= F_DEAD;
  broadcast({ t: 'death', k, corpse });
  // a kill on the board for whoever did it (never for doing it to yourself)
  const killer = by ? clients.get(by.id) : undefined;
  if (killer && killer !== c) {
    scoreOf(killer).kills++;
    sendBoard();
  }
  log(by ? `${c.name} was killed by ${by.name} (${by.w}, ${k.dist} m)` : `${c.name} died (${cause})`);
}
