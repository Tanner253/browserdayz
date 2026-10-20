// The server: its players (who is connected, what each is told of the others, where a fresh one starts), what they send cleaned, and joining and leaving.
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import type { WebSocket } from 'ws';
import { BODY_GRID, type SerializedInventory, cleanItem as cleanThing, cleanInventory as cleanCarried } from '../src/sim/inventory';
import type { ItemInstance } from '../src/sim/items';
import { bunkerDark } from '../src/sim/bunker';
import { phaseOf } from '../src/sim/daynight';
import type { HitZone } from '../src/sim/combat';
import { type Thrower, newThrower } from '../src/sim/grenades';
import { BLOOD } from '../src/sim/blood';
import { type Pose, type Slung, type Vitals, type S2C, type PlayerInfo, type StoredItem, type C2S, PROTOCOL, F_GROUND, MAX_STAMINA } from '../src/net/protocol';
import { MAX_PLAYERS, RECORD_LIFETIME, RESTART, onMap, barrelsGone, boxes, doors, economy, hearths, horde, locks, log, vehInfo, vehicles, world } from './index';
import { bunkerDoor, cardSeen, hitsBy, ipOf, seenOf, tagSeen } from './tags';
import { CHECK } from './checks';
import { BodyWatch } from './bodywatch';
import { ADMIN, PER_ADDRESS, TURNED, addressFull, bannedFor, deviceFull, doorWords, keyHash, roleOf, sigOfWs, turnedAway } from './gate';
import { DEVICE, deviceOf, shortDevice } from './device';
import { KEPT, asAdmin, claim } from './keep';
import { noHold } from './admin';
import { leaveSeat, racksNow, releaseLock } from './acts';
import { fillFromQueue, keyOf, scores, sendBoard } from './queue';
import { dropInfo, flightNow, flights } from './drops';
import { partyIn, partyOut } from './party';

export interface Client {
  ws: WebSocket;
  id: number;
  key: string;
  name: string;
  pose: Pose;
  /** when their game said that was so, by its own clock (ms) */
  n?: number;
  /** when they came in; whether their game has yet said where they are; whether they came back into a life they had */
  since: number;
  spoke: boolean;
  resumed: boolean;
  w: string | null;
  m: string[];
  g: string[];
  b: Slung[];
  alive: boolean;
  inv: SerializedInventory | null;
  vitals: Vitals | null;
  lastHit: number;
  /** when a round of theirs last hit a jeep, and when they got into the seat they are in (0: on foot) */
  lastVHit: number;
  seatAt: number;
  /** when they were first seen outside the Zona with a tag they took (0: they are not) */
  outAt: number;
  /** when they were first seen under the ground this time (0: they are not): see `underCheck` */
  underAt: number;
  /**
   * The body in the world when its game is not (see "a life kept by the server", below): when their game last said
   * where they were; whether the server has had to keep their health for them since; when the connection went
   * without a proper leave (0: it has not), the body staying where it was; for how many seconds a wound has run
   * while the server kept it; and when the wait to leave properly ends (0: nobody is waiting), begun where. And
   * when they were last hit while their game was not answering (see TABBED in gate.ts).
   */
  heardAt: number;
  hitAway: number;
  kept: boolean;
  asleep: number;
  bled: number;
  logoutAt: number;
  logoutFrom: [number, number];
  /**
   * An admin's powers that are on: nothing hurts them, nobody is shown them, and where they go is not questioned.
   * And two things chosen for their own death: nothing they carried is left on the body (what an admin makes for
   * themselves is not found on them by whoever kills them), and no dog tag of their own is.
   */
  power: { god: boolean; hidden: boolean; clip: boolean; voidInv: boolean; voidTag: boolean; /** what they carry weighs nothing, and their gun spends no rounds: their own game's to honour (see `carryOrder`) */ weightless: boolean; endless: boolean; /** their inventory never fills: things are kept in their hold (see `carryOrder`) */ bottomless: boolean };
  /** this player's grenades: the one whose pin is out in their hand, and those that have left it and not long gone off, with what each has been said to reach (src/sim/grenades.ts) */
  nades: Thrower;
  /** the fuel drums this player has just set off, and how many hits have been claimed for each */
  blasts: { i: number; at: number; hits: number }[];
  lastEmote: number;
  lastChat: number;
  lastHitBy: { id: number; name: string; w: string; zone: HitZone; dist: number; at: number } | null;
  openCid: string | null;
  /** the things lying about that hold things which this player has open with their pockets ('lopen'): theirs to set while they do */
  openLying: Set<string>;
  /** when they last moved, looked about or did anything (see kickIdle) */
  activeAt: number;
  joinedAt: number;
  /** where they connect from, and when the life they are living began (see notEarned) */
  ip: string;
  lifeAt: number;
  /** of this life, the ms spent inside the Zona, and when that was last counted (see tagTime): what a tag of their own waits on */
  zonaMs: number;
  zonaAt: number;
  /** the device their game said it runs on ('' : none said): server/device.ts */
  fp: string;
  /** their browser as it shows itself ('' : no graphics card said): sigOf in gate.ts */
  sig: string;
  /** the role they were last told they have (see tellRoles in keep.ts) */
  roleTold?: string | null;
  msgCount: number;
  msgWindow: number;
  /**
   * For the server's own checks (see CHECKS): when they were last where they said they were, how much going is
   * saved up, until when where they are is not questioned, how long they have been high over the ground, how
   * often a check has fired on them, when that was last written down, and when it last refused them.
   */
  check: {
    at: number; carry: number; free: number; high: number; hovered: number; flags: number; said: number; refused: number[];
    /** metres the grace has let them go ahead of their legs, not yet paid back: see moveCheck */
    owed: number;
    /** when they were last heard from at all; and what is saved out of a silence, good until `lagTill`: see moveCheck */
    heard: number; lag: number; lagTill: number;
    /** how they have been going about lately: see gaitCheck */
    gait?: { since: number; yaw: number; pitch: number; far: number; turns: number; dx: number; dz: number };
    /** the most health they can have (see `dealt`), when that was reckoned, and since when it has been less than none (0: it is not) */
    hp: number; hpAt: number; downAt: number;
    /** things they have said they carry that the server never put in the world: each written down once */
    unknown: Set<string>;
    /** until when, just off the bot check's course, their game may still say it is up where the course stood (see CHECK.fresh); and when they last did something a person does (see `handle`) */
    ranged: number; acted: number;
    /** how their body moves, watched for a program walking it: see server/bodywatch.ts */
    body: BodyWatch;
  };
}

export interface Record_ {
  pose: Pose;
  inv: SerializedInventory | null;
  vitals: Vitals | null;
  alive: boolean;
  leftAt: number;
  /** kept from a world of another making: what they carried is theirs, where they stood is not */
  afresh?: boolean;
}

export const clients = new Map<number, Client>();

export const records = new Map<string, Record_>();

let nextId = 1;

export const send = (c: Client, m: S2C) => {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m));
};

export function broadcast(m: S2C, except?: Client) {
  if (!clients.size) return;
  const s = JSON.stringify(m);
  for (const c of clients.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s);
}

/**
 * Said only to those within `within` metres of (x, z), across the ground: what nobody further off could hear or see.
 * (A shot was said to every game on the map, and each flew its rounds for four seconds, a fight at one end of the map
 * paid for by everybody at the other: the owner, 2026-10-19, "people sometimes complain of lag spike when fighting
 * people".)
 */
export function broadcastNear(m: S2C, x: number, z: number, within: number, except?: Client) {
  if (!clients.size) return;
  let s: string | null = null;
  const r2 = within * within;
  for (const c of clients.values()) {
    if (c === except || c.ws.readyState !== 1 || (c.pose[0] - x) ** 2 + (c.pose[2] - z) ** 2 > r2) continue;
    c.ws.send((s ??= JSON.stringify(m)));
  }
}

export const info = (c: Client): PlayerInfo => ({ id: c.id, name: c.name, pose: c.pose, w: c.w, m: c.m, g: c.g, b: c.b, alive: c.alive, ...(c.power.hidden ? { hidden: true as const } : {}) });

/** is somebody shown to this player: everybody is, but a vanished admin, whom only admins see */
const shown = (who: Client, to: Client) => !who.power.hidden || roleOf(to) === 'admin';

/**
 * A start on the edge of the map: one with nobody near it. Every start is looked at (it was eight drawn at random
 * of the seventeen, so the best was passed over six times in ten, and nothing was ever ruled out). A start is
 * good with nobody living within 120 m of it, no infected within 40 (they see 34), and, for somebody coming back
 * from a death, not within 250 m of where they died: DayZ rules a fresh start out within 65 m of a player and 30
 * of an infected, on a map a hundred times the size. Of the good ones, one of the three furthest from anybody,
 * so that where the next arrival appears cannot be told beforehand. With none good, the rules are let go one at
 * a time, the last first.
 * @param died where whoever is asking has just died
 */
export function pickSpawn(died?: { x: number; z: number }) {
  const others = [...clients.values()].filter((c) => c.alive && !c.power.hidden);
  const walking = [...horde.bodies.values()].filter((b) => !b.diedAt);
  const far = (list: { x: number; z: number }[], s: { x: number; z: number }) => list.reduce((d, o) => Math.min(d, Math.hypot(o.x - s.x, o.z - s.z)), 1e9);
  const starts = world.spawns.map((s) => ({
    s,
    d: far(others.map((o) => ({ x: o.pose[0], z: o.pose[2] })), s),
    i: far(walking.map((b) => ({ x: b.s[0], z: b.s[2] })), s),
    own: died ? Math.hypot(died.x - s.x, died.z - s.z) : 1e9,
  }));
  const good = [
    starts.filter((q) => q.d >= 120 && q.i >= 40 && q.own >= 250),
    starts.filter((q) => q.d >= 120 && q.i >= 40),
    starts.filter((q) => q.d >= 60),
    starts,
  ].find((list) => list.length)!;
  // (Any of the good ones, not one of the three furthest from anybody: with the starts in a line down the beach, the
  // furthest were always the two ends of it. The owner, 2026-10-19: "i get people complain they spawn same place on
  // desert 3x in a row". With none good, the furthest of the rest, as before.)
  const pool = good === starts ? [...good].sort((a, b) => b.d - a.d).slice(0, 3) : good;
  const best = pool[Math.floor(Math.random() * pool.length)].s;
  // (and some metres of scatter, so two people never spawn inside each other nor on one spot twice)
  const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
  return { x: best.x + Math.cos(a) * r, z: best.z + Math.sin(a) * r, yaw: best.yaw };
}

// ------------------------------------------------------------------ validation

export const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(num);

export const isPose = (v: unknown): v is Pose => Array.isArray(v) && v.length === 6 && v.every(num) && onMap(v[0], v[2], v[1]) && Math.abs(v[1]) < 500;

export const cleanName = (s: unknown) => (typeof s === 'string' ? s : '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Survivor';

export const round2 = (v: number) => Math.round(v * 100) / 100;

// (What makes a thing, and a whole inventory, out of what a game says is in src/sim/inventory.ts since 2026-10-13,
// where it is tried without a server: test/clothes.test.ts. A thing's cargo is read to as many things as it has
// cells, where it was forty; three deep, where it was two; and the hot keys are kept.)
export function cleanItem(raw: unknown, depth = 0): ItemInstance | null {
  return cleanThing(raw, cleanName, depth);
}

export function cleanStored(list: unknown): StoredItem[] {
  if (!Array.isArray(list)) return [];
  const out: StoredItem[] = [];
  // (as many things as the biggest grid a body has has cells)
  for (const raw of list.slice(0, BODY_GRID[0] * BODY_GRID[1])) {
    const it = cleanItem(raw);
    if (it && num(raw.x) && num(raw.y)) out.push({ ...it, x: raw.x, y: raw.y, rot: !!raw.rot });
  }
  return out;
}

/**
 * What a game says it carries, or what was kept of a character, made safe and made of today's shape: a character
 * kept from before the jacket and the trousers were things has them on after this, with what was in its pockets in
 * theirs (upgradeInventory in src/sim/inventory.ts, the same the game itself reads a save with).
 */
export function cleanInventory(raw: unknown): SerializedInventory | null {
  return cleanCarried(raw, cleanName);
}

export function join(ws: WebSocket, m: Extract<C2S, { t: 'hello' }>): Client | null {
  if (m.v !== PROTOCOL) {
    ws.send(JSON.stringify({ t: 'kick', reason: 'This game was updated. Reload the page.', v: PROTOCOL } satisfies S2C));
    ws.close();
    return null;
  }
  const key = keyOf(m) || `anon-${Math.random().toString(36).slice(2)}`, fp = deviceOf.get(ws) ?? '';
  const sig = sigOfWs.get(ws) ?? '';
  const off = bannedFor(key, ipOf.get(ws) ?? '', fp, sig);
  if (off) {
    log(`${cleanName(m.name)} is not let in: ${off}`);
    turnedAway(cleanName(m.name), key, ipOf.get(ws) ?? '', fp, off === 'banned' ? 'banned' : `kept off: ${off}`);
    ws.send(JSON.stringify({ t: 'kick', reason: doorWords(key, ipOf.get(ws) ?? '', off, fp) } satisfies S2C));
    ws.close();
    return null;
  }
  // (asked at hello too; asked again here for whoever waited in line or shot the course meanwhile)
  if (DEVICE.mode === 'enforce' && DEVICE.farm === 'enforce' && deviceFull(key, fp)) {
    TURNED.device++;
    log(`${cleanName(m.name)} (${shortDevice(fp)}) is not let in: ${DEVICE.live} already playing on their device`);
    turnedAway(cleanName(m.name), key, ipOf.get(ws) ?? '', fp, `${DEVICE.live} already playing on their device`);
    ws.send(JSON.stringify({ t: 'kick', reason: `There are already ${DEVICE.live} playing on this device.` } satisfies S2C));
    ws.close();
    return null;
  }
  if (addressFull(key, ipOf.get(ws) ?? '')) {
    TURNED.address++;
    log(`${cleanName(m.name)} is not let in: ${PER_ADDRESS} already playing from their address`);
    turnedAway(cleanName(m.name), key, ipOf.get(ws) ?? '', fp, `${PER_ADDRESS} already playing from their address`);
    ws.send(JSON.stringify({ t: 'kick', reason: PER_ADDRESS === 1 ? 'Somebody is already playing from your connection: one player to a connection.' : `There are already ${PER_ADDRESS} playing from your connection.` } satisfies S2C));
    ws.close();
    return null;
  }
  // (and never more in the world than twice the places there are: the bodies longest left go first, as they were)
  for (const o of [...clients.values()].filter((x) => x.asleep).sort((a, b) => a.asleep - b.asleep)) {
    if (clients.size < MAX_PLAYERS * 2) break;
    drop(o);
  }
  // the same character can only be in the world once
  for (const o of clients.values()) {
    if (o.key === key) {
      send(o, { t: 'kick', reason: 'You connected from another tab.' });
      o.ws.close();
      drop(o);
    }
  }
  const rec = records.get(key) ?? KEPT.chars.get(keyHash(key));
  const resume = rec && rec.alive && rec.inv && Date.now() - rec.leftAt < RECORD_LIFETIME ? rec : null;
  // (a tag is carried for its time in the world: the time its carrier was out of it is not counted)
  if (resume) for (const [k, since] of tagSeen) if (k.startsWith(seenOf(key))) tagSeen.set(k, since + (Date.now() - resume.leftAt));
  // (Somebody who left the game down in the bunker comes back with what they carried, at one
  // of the map's own starting places: nobody waits behind its door for it to be opened for them.)
  const under = !!resume && bunkerDark(world.bunker, resume.pose[0], resume.pose[1] + 1, resume.pose[2]) > 0;
  const sp = resume && !under && !resume.afresh ? { x: resume.pose[0], y: resume.pose[1], z: resume.pose[2], yaw: resume.pose[3] } : pickSpawn();
  const c: Client = {
    ws, id: nextId++, key, name: cleanName(m.name),
    // (on the ground, until their own game says otherwise: with no word of the ground they were drawn by everybody
    // else as somebody in the air, arms out, for as long as their game took to start, or for good if it never did)
    pose: [sp.x, 'y' in sp && sp.y !== undefined ? sp.y : world.groundAt(sp.x, sp.z), sp.z, sp.yaw, 0, F_GROUND],
    w: null, m: [], g: [], b: [], alive: true, power: { god: false, hidden: false, clip: false, voidInv: false, voidTag: false, weightless: false, endless: false, bottomless: false },
    heardAt: Date.now(), hitAway: 0, kept: false, asleep: 0, bled: 0, logoutAt: 0, logoutFrom: [0, 0],
    since: Date.now(), spoke: false, resumed: !!resume,
    inv: resume?.inv ?? null, vitals: resume?.vitals ?? null,
    outAt: 0, underAt: 0, lastHit: 0, lastVHit: 0, seatAt: 0, nades: newThrower(), blasts: [], lastEmote: 0, lastChat: 0, lastHitBy: null, openCid: null, openLying: new Set(), check: { at: Date.now(), carry: 0, owed: 0, heard: Date.now(), lag: 0, lagTill: 0, free: Date.now() + CHECK.free, high: 0, hovered: 0, flags: 0, said: 0, refused: [], hp: Math.min(100, resume?.vitals?.health ?? 100), hpAt: Date.now(), downAt: 0, unknown: new Set(), ranged: 0, acted: Date.now(), body: new BodyWatch(Date.now()) }, activeAt: Date.now(), joinedAt: Date.now(), ip: ipOf.get(ws) ?? '', lifeAt: Date.now(), zonaMs: 0, zonaAt: 0, fp, sig, msgCount: 0, msgWindow: Date.now(),
  };
  records.delete(key);
  KEPT.chars.delete(keyHash(key));
  const others = [...clients.values()].filter((o) => shown(o, c)).map(info);
  clients.set(c.id, c);
  claim();
  send(c, {
    t: 'welcome', v: PROTOCOL, you: c.id, players: others,
    // (not what is in a piece of furniture: that is seen when it is opened, server/storages.ts)
    loot: [...economy.loot.values()].filter((l) => !(l.point >= 0 && world.lootPoints[l.point]?.inside)),
    doors: [...doors].map(([i, [open, swing]]) => [i, open, swing]),
    stashes: [...boxes.values()].filter((b) => b.kind === 'stash').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, ...(b.item ? { item: b.item } : {}), ...(b.buried ? { buried: true } : {}) })),
    corpses: [...boxes.values()].filter((b) => b.kind === 'corpse').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor', v: b.v ?? 0, ...(b.ride ? { ride: b.ride } : {}) })),
    drops: [...boxes.values()].filter((b) => b.kind === 'drop').map(dropInfo),
    // (the helicopters in the air at this moment, each with how long it has been: this game puts it where everybody else's has it)
    flights: [...flights.values()].map(flightNow),
    barrels: [...barrelsGone.keys()],
    racks: racksNow(),
    fires: hearths.alight(Date.now() / 1000),
    bunker: bunkerDoor.open,
    // (the map's containers that somebody has open at this moment: a locker among them is seen standing open)
    ajar: [...locks.keys()].filter((cid) => boxes.get(cid)?.kind === 'crate'),
    vehicles: [...vehicles.values()].map(vehInfo),
    infected: horde.list(),
    // (the hour is the wall clock's: every game on the server is at the same one, and a restart does not put it back)
    hour: phaseOf(Date.now() / 1000),
    spawn: sp,
    me: resume ? { inv: resume.inv!, vitals: resume.vitals ?? { health: 100, energy: 80, water: 80, stamina: MAX_STAMINA, bleeding: false, blood: BLOOD.full, bleed: 0 } } : null,
    max: MAX_PLAYERS,
  });
  // (a restart is on its way: whoever comes in before it happens is told as the others were)
  if (RESTART.pending !== null) send(c, { t: 'restart', why: RESTART.pending, in: Math.max(0, Math.round(RESTART.about - (Date.now() - RESTART.seen) / 1000)) });
  broadcast({ t: 'join', p: info(c) }, c);
  partyIn(c);
  // back under another name: the board says so, to everybody
  const had = scores.get(c.key);
  if (had && had.name !== c.name) {
    had.name = c.name;
    sendBoard();
  } else sendBoard(c);
  log(`+ ${c.name} (#${c.id})${resume ? ' resumed' : ''}${fp ? ` [dev ${shortDevice(fp)}]` : ''} — ${clients.size} online`);
  // (somebody with a role is told so as they come in: their game shows them what they may do)
  c.roleTold = roleOf(c);
  if (roleOf(c)) send(c, { t: 'role', role: roleOf(c) });
  if (roleOf(c) === 'admin') asAdmin(c, false);
  // (and whoever comes in with an admin's hold and is none is told so: their game empties it)
  else noHold(c);
  return c;
}

export function drop(c: Client) {
  if (!clients.delete(c.id)) return;
  hitsBy.delete(c.id);
  cardSeen.delete(c.id);
  ADMIN.gone.push({ id: c.id, name: c.name, key: c.key, ip: c.ip, fp: c.fp, sig: c.sig, at: Date.now() });
  ADMIN.asked.delete(c.id);
  ADMIN.tints.delete(c.id);
  if (ADMIN.gone.length > 60) ADMIN.gone.shift();
  releaseLock(c);
  leaveSeat(c, true);
  // (left when they went: a body left sleeping after a connection was lost is not its owner on the server, and the
  // clock on a tag they took does not run for it, the owner, 2026-10-17: "the cash-in clock on a taken tag only counts
  // while the carrier is online". See the `resume` shift in `join`.)
  records.set(c.key, { pose: c.pose, inv: c.inv, vitals: c.vitals, alive: c.alive, leftAt: c.asleep || Date.now() });
  broadcast({ t: 'leave', id: c.id });
  partyOut(c);
  log(`- ${c.name} (#${c.id}) — ${clients.size} online`);
  fillFromQueue();
}
