// ZONA game server. One process: serves the built client and runs the shared world
// over a WebSocket at /ws.
//
// Authority (see src/net/protocol.ts): the server owns the loot economy, containers
// (map crates, stashes, bodies), doors, who is alive, spawn points and how much a hit
// hurts. Clients own their movement, aim and inventory.

import http from 'node:http';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WebSocketServer, type WebSocket } from 'ws';
import { buildWorldData } from './world';
import { Economy, type WorldLoot } from '../src/sim/economy';
import { Container, type SerializedInventory } from '../src/sim/inventory';
import { ITEMS, TAG_FRESH, TAG_HOLD, TAG_OUT, magFits, makeItem, sanitizeItem, type ItemInstance } from '../src/sim/items';
import { WORLD_SIZE, inPlay } from '../src/world/worldgen';
import { BURY, noBurying } from '../src/sim/stash';

/** how far from the middle anything may say it is: the edge of the ground, and a little (the walls stand 4 m inside it) */
const EDGE = WORLD_SIZE / 2 + 8;
import { CALL, CRASH, DROP, fillCrash, fillDrop, type DropInfo } from '../src/sim/drops';
import { STOCK } from '../src/sim/trade';
import { VOICE } from '../src/sim/voice';
import { CRATE_RESTOCK, CRATE_SPECS, fillCrate } from '../src/sim/crates';
import { gasEdge, underGas } from '../src/sim/gas';
import { BUNKER, bunkerDark, inBunker } from '../src/sim/bunker';
import { phaseOf } from '../src/sim/daynight';
import { WEAPON_RULES, hitDamage, type HitZone } from '../src/sim/combat';
import { BARREL } from '../src/sim/barrels';
import { JEEP, POLICE_CAR, SEATS, crashDamage, restState, type VehicleInfo, type VState } from '../src/sim/vehicles';
import { Director, INFECTED, guarded, infectedDrop } from '../src/sim/infected';
import { EMOTE, EMOTE_GAP, SHOUT_RANGE } from '../src/sim/emotes';
import { ACTS, CHAT_RANGE, F_BLEED, F_DEAD, F_GROUND, F_GUARD, F_SIT, MAX_STAMINA, PROTOCOL, type C2S, type CorpseInfo, type KillInfo, type PlayerInfo, type Pose, type S2C, type Slung, type StashInfo, type StoredItem, type Vitals } from '../src/net/protocol';
import { ORDERS, written } from '../src/net/orders';
import { KITS } from '../src/sim/kits';
import { FIRE, Hearths } from '../src/sim/fires';

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'world.json');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 24);
const TICK_HZ = 15;
const CORPSE_LIFETIME = 600; // seconds
// (A character is its player's until it dies: whoever comes back in a year has what they left with. It was
    // half an hour.)
const RECORD_LIFETIME = 400 * 24 * 3600 * 1000; // a logged-out character is remembered this long
/** bump when loot points change: world loot from an older save is re-rolled */
const WORLD_REV = 21;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------ world

log('generating world…');
const t0 = Date.now();
const world = buildWorldData(ROOT);
log(`world ready in ${Date.now() - t0} ms: ${world.lootPoints.length} loot points, ${world.crates.length} crates, ${world.barrels.length} fuel drums, ${world.spawns.length} spawns`);

interface Box {
  cid: string;
  kind: 'crate' | 'stash' | 'corpse' | 'drop';
  /** a drop that is the cargo of a helicopter that came down */
  heli?: boolean;
  w: number;
  h: number;
  items: StoredItem[];
  x: number;
  y: number;
  z: number;
  rot: number;
  /** crate prop kind (loot table) */
  crate?: string;
  /** a stash: what was put down (a pack's item; not said, the stash case), and whether it is under the ground */
  item?: string;
  buried?: boolean;
  emptiedAt: number;
  /** corpse and supply drop: expiry (economy time). Corpse: owner name, how it fell */
  name?: string;
  expires?: number;
  v?: number;
}

const boxes = new Map<string, Box>();
const locks = new Map<string, number>(); // cid -> client id
const doors = new Map<number, [boolean, number]>();
/** fuel drums that have gone up (see src/sim/barrels.ts): which one -> when a new one may be stood there */
const barrelsGone = new Map<number, number>();
// the infected: how many there are, what each has left, and whose game moves it (src/sim/infected.ts)
const horde = new Director(process.env.INFECTED === 'off' ? [] : world.homes, world.homeSpot);
const BARREL_RESPAWN = Number(process.env.BARREL_RESPAWN_S) || BARREL.respawn;

/**
 * The jeeps (see src/sim/vehicles.ts). The server keeps where each one is, what it has left
 * and who sits in it; the game of whoever drives it (`sim`) says how it moves.
 */
interface Veh extends VehicleInfo {
  /** which of the world's spots it started on */
  home: number;
  /** when the game moving it last said where it was */
  heard: number;
  /** burning: when it goes up, and who set it alight (0: it is not) */
  burnAt: number;
  by: number;
  /** burned out: when the wreck is cleared away (0: it is whole) */
  goneAt: number;
  /** standing empty under the gas with nobody near: since when (0: it is not) */
  leftAt?: number;
}
const vehicles = new Map<number, Veh>();
/** spots whose jeep burned: which -> when a new one may be stood there */
const jeepsDue = new Map<number, number>();
let nextVeh = 1;
/** where every car stands when the world is new, by the number of its place: the jeeps, and after them the police cars */
const PARKS = [...world.jeeps.map((p) => ({ ...p, k: 0 })), ...world.cars.map((p) => ({ ...p, k: POLICE_CAR.kind }))];
function standJeep(home: number): Veh {
  const p = PARKS[home];
  const v: Veh = { i: nextVeh++, s: restState(p.x, p.y, p.z, p.yaw), hp: JEEP.hp, fuel: Math.round(JEEP.tank * (0.3 + Math.random() * 0.45)), seats: Array(SEATS).fill(null), sim: null, home, heard: 0, burnAt: 0, by: 0, goneAt: 0, ...(p.k ? { k: p.k } : {}) };
  vehicles.set(v.i, v);
  return v;
}
PARKS.forEach((_, k) => standJeep(k));
/** the gas over the works: a car left under it is stood back home (see JEEP.gas) */
const carsGas = world.gas;
const vehInfo = (v: Veh): VehicleInfo => ({ i: v.i, s: v.s, hp: v.goneAt ? 0 : v.hp, fuel: v.fuel, seats: v.seats, sim: v.sim, ...(v.k ? { k: v.k } : {}) });
const tellSeats = (v: Veh, rest = false) => broadcast({ t: 'vseat', i: v.i, seats: v.seats, sim: v.sim, ...(rest ? { s: v.s } : {}) });
const isVState = (s: unknown): s is VState => Array.isArray(s) && s.length === 12 && s.every(num) && Math.abs(s[0]) < EDGE && Math.abs(s[2]) < EDGE && Math.abs(s[1]) < 500 && Math.abs(Math.hypot(s[3], s[4], s[5], s[6]) - 1) < 0.02 && Math.hypot(s[7], s[8], s[9]) < 60;

/** the fireplaces, and which of them are alight */
const hearths = new Hearths(world.fires);

/**
 * The things that are only ever found, never made by a player's own game: guns, blades, armour, helmets and
 * hats, the keycard. (What the trader sells is made by the game that buys it, and so are a meal, a dressing, a
 * round taken out of a gun, a sight taken off one: none of those can be told from an invention, and none is here.)
 */
const GUARDED = new Set(Object.values(ITEMS).filter((d) => !STOCK.includes(d.id) && (!!d.weapon || !!d.melee || d.wear?.armor !== undefined || d.wear?.head !== undefined || d.id === 'keycard')).map((d) => d.id));
/** every such thing the server has put in the world, by its own number: laid out as loot, packed in a crate or a drop, left on a body */
const issued = new Set<string>();
function issue(it: ItemInstance | null | undefined) {
  if (!it) return;
  if (GUARDED.has(it.id)) issued.add(it.uid);
  for (const p of it.cargo ?? []) issue(p.item);
}
/** everything in a set of pockets: what is worn and held, what is in them, and what is in what is in them */
function* things(inv: SerializedInventory | null): Generator<ItemInstance> {
  const walk = function* (it: ItemInstance | null | undefined): Generator<ItemInstance> {
    if (!it) return;
    yield it;
    for (const p of it.cargo ?? []) yield* walk(p.item);
  };
  if (!inv) return;
  for (const it of Object.values(inv.slots)) yield* walk(it);
  for (const cont of inv.containers) for (const it of cont.items) yield* walk(it);
}
const invented = (it: ItemInstance) => GUARDED.has(it.id) && !issued.has(it.uid);

const economy = new Economy(world.lootPoints, {
  spawn: (l) => {
    issue(l.item);
    broadcast({ t: 'loot+', l });
  },
  despawn: (l) => broadcast({ t: 'loot-', uid: l.uid }),
});

function fillBox(b: Box) {
  const spec = CRATE_SPECS[b.crate ?? ''];
  if (!spec) return;
  const c = new Container(b.cid, spec.label, spec.w, spec.h, [], true);
  // (a crate under the gas, or down in the bunker, is filled with the best of everything)
  fillCrate(c, b.crate!, Math.random, inBunker(world.bunker, b.x, b.y + 0.5, b.z) ? 'bunker' : underGas(world.gas, b.x, b.y, b.z));
  b.items = c.serialize().items;
  for (const it of b.items) issue(it);
  b.emptiedAt = -1;
}

function loadWorld() {
  for (const c of world.crates) {
    const spec = CRATE_SPECS[c.kind];
    if (!spec) continue;
    boxes.set(c.cid, { cid: c.cid, kind: 'crate', w: spec.w, h: spec.h, items: [], x: c.x, y: c.y, z: c.z, rot: 0, crate: c.kind, emptiedAt: -1 });
  }
  let saved: {
    rev: number;
    economy: { time: number; lastRestock: Record<string, number>; loot: WorldLoot[] };
    boxes: Box[];
    doors: [number, boolean, number][];
  } | null = null;
  try {
    if (existsSync(SAVE_FILE)) saved = JSON.parse(readFileSync(SAVE_FILE, 'utf8'));
  } catch (e) {
    log('could not read save, starting fresh:', (e as Error).message);
  }
  if (saved && saved.rev === WORLD_REV) {
    economy.time = saved.economy.time;
    economy.lastRestock = saved.economy.lastRestock;
    economy.restore(saved.economy.loot);
    for (const b of saved.boxes) {
      if (b.kind === 'crate') {
        const cur = boxes.get(b.cid);
        if (cur) Object.assign(cur, { items: b.items, emptiedAt: b.emptiedAt });
      } else if (b.kind === 'stash') boxes.set(b.cid, b);
    }
    for (const [i, open, swing] of saved.doors ?? []) doors.set(i, [open, swing]);
    economy.tick(0, []);
    log(`restored world: ${economy.loot.size} loot, ${[...boxes.values()].filter((b) => b.kind === 'stash').length} stashes`);
  } else {
    economy.populate();
    for (const b of boxes.values()) fillBox(b);
    log(`fresh world: ${economy.loot.size} loot items`);
  }
  // (whatever was kept from before the server stopped is the server's own too)
  for (const l of economy.loot.values()) issue(l.item);
  for (const b of boxes.values()) for (const it of b.items) issue(it);
}

function saveWorld() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      rev: WORLD_REV,
      economy: economy.serialize(),
      boxes: [...boxes.values()].filter((b) => b.kind !== 'corpse' && b.kind !== 'drop'),
      doors: [...doors].map(([i, [open, swing]]) => [i, open, swing]),
    };
    writeFileSync(SAVE_FILE, JSON.stringify(data));
  } catch (e) {
    log('save failed:', (e as Error).message);
  }
}

// ------------------------------------------------------------------ cashed-in tags
//
// A tag counts for a reward only if this server watched it happen: the tag came off a body
// the server itself made when its owner died, somebody else has carried it, and the hold
// time (TAG_HOLD, ten minutes) of the server's own clock has passed since the server first
// saw it in their pockets. What a client says about its own inventory is not enough.

/** the website keeps the list (this server has no disk): it is told the id and asks back for the entry */
const SITE_URL = process.env.SITE_URL ?? 'https://www.zonapvp.fun';
/** seconds a tag must be seen carried; a minute of slack for the gap between a client's reports */
const CASH_HOLD_MS = (Number(process.env.CASH_HOLD_S) || TAG_HOLD - 60) * 1000;

interface CashIn {
  id: string;
  at: string;
  name: string;
  owner: string;
  wallet: string;
}
const cashins: CashIn[] = [];
/** a tag taken off a body this server made: whose it was, where they were playing from, and how long that life had lasted */
interface Looted {
  owner: string;
  ownerKey: string;
  ownerIp: string;
  livedMs: number;
}
/** tag uid -> that */
const lootedTags = new Map<string, Looted>();
/** tags carried out of the Zona and held there past TAG_OUT: no reward is ever paid on one */
const voided = new Set<string>();
/** `${player key}|${tag uid}` -> when the server first saw that player carrying it */
const tagSeen = new Map<string, number>();
const isWallet = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

// Tags are paid for in SOL now (the site does it: api/_lib/payouts.ts), and the cheapest way
// to a tag is a second window of one's own. So a tag is listed for a reward only if, as well
// as having been taken and held under this server's eyes: its owner was not playing from the
// same connection as whoever cashes it in; its owner had been alive a couple of minutes (a
// body that only exists to be killed again is worth nothing); and the same two players have
// not just done this. None of it stops two people in two houses who are set on it: what the
// site will pay in a day, and to one wallet, is what bounds that.
const TAG_MIN_LIFE_MS = (Number(process.env.TAG_MIN_LIFE_S) || 120) * 1000;
/** and there is no tag on a body at all until its owner had lived this long (see TAG_FRESH) */
const TAG_FRESH_MS = (Number(process.env.TAG_FRESH_S) || TAG_FRESH) * 1000;
const TAG_PAIR_GAP_MS = (Number(process.env.TAG_PAIR_GAP_S) || 3 * 3600) * 1000;
/** `${who cashed in}>${whose tag}` (each a player's key, or "ip:" and where they play from) -> when */
const pairPaidAt = new Map<string, number>();

/** where a connection comes from, as near as the host lets it be known */
function addressOf(req: http.IncomingMessage): string {
  const first = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').split(',')[0].trim();
  return netOf(first(req.headers['cf-connecting-ip']) || first(req.headers['true-client-ip']) || first(req.headers['x-forwarded-for']) || req.socket.remoteAddress || '');
}
/**
 * An address as far as it says whose connection it is. One of the old kind is that; one of the new kind (with
 * colons) is a different number for every device and every day, and it is the first half of it that is the
 * household's: that half is what is kept, so that a ban of an address, and one player to an address, mean on
 * the new kind what they mean on the old.
 */
function netOf(ip: string): string {
  if (!ip.includes(':') || ip === '::1') return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
const ipOf = new WeakMap<WebSocket, string>();
/** addresses only mean something while they tell players apart: if three or more are on and all seem to come from one place, the host is hiding them */
const ipsTellApart = () => clients.size < 3 || new Set([...clients.values()].map((x) => x.ip)).size > 1;

/** the two names a player goes by here: their key, and (when it means anything) where they play from */
const namesOf = (key: string, ip: string) => (ip && ipsTellApart() ? [key, `ip:${ip}`] : [key]);

/** Why a tag earns nothing, or null if it does. */
function notEarned(c: Client, from: Looted, since: number | undefined, now: number): string | null {
  if (from.ownerKey === c.key) return 'it is your own';
  if (since === undefined || now - since < CASH_HOLD_MS) return 'it was not held for the full time';
  if (c.ip && from.ownerIp === c.ip && ipsTellApart()) return 'its owner was playing from the same connection as you';
  if (from.livedMs < TAG_MIN_LIFE_MS) return `its owner had been alive for less than ${TAG_MIN_LIFE_MS >= 60000 ? `${Math.round(TAG_MIN_LIFE_MS / 60000)} minutes` : `${Math.round(TAG_MIN_LIFE_MS / 1000)} seconds`}`;
  const theirs = namesOf(from.ownerKey, from.ownerIp);
  if (namesOf(c.key, c.ip).some((a) => theirs.some((b) => now - (pairPaidAt.get(`${a}>${b}`) ?? -Infinity) < TAG_PAIR_GAP_MS))) return `you cashed in another of their tags less than ${Math.round(TAG_PAIR_GAP_MS / 3600000)} hours ago`;
  return null;
}

function recordCashIn(c: Client, owner: string, wallet: string) {
  // (its id is what the site is called with, and what the receipt of its payment is made from: not to be guessed)
  const entry: CashIn = { id: randomBytes(16).toString('hex'), at: new Date().toISOString(), name: c.name, owner, wallet };
  cashins.push(entry);
  if (cashins.length > 2000) cashins.shift();
  scoreOf(c).tags++;
  sendBoard();
  // also in the server's own log, which the host keeps for a few days whatever else happens
  log('CASHIN', JSON.stringify(entry));
  follow(entry, c.key, 1, Date.now());
}

/** what the site answers about a tag (see Outcome in api/_lib/payouts.ts) */
interface SitePayout {
  state: 'paid' | 'sending' | 'waiting' | 'skipped' | 'off';
  lamports?: number;
  signature?: string;
  why?: string;
}

/**
 * Hands a cash-in to the site, which lists it and pays it, and tells the player what became
 * of it. A tag the site has not settled (the payment is on its way, the treasury is empty,
 * the day's limit is reached) is asked about again, for up to a day: the site also looks at
 * such tags itself once a day, so one this server forgets in a restart is not lost.
 */
function follow(entry: CashIn, key: string, attempt: number, began: number) {
  const again = (ms: number) => void setTimeout(() => follow(entry, key, attempt + 1, began), ms).unref();
  const say = (kind: 'good' | 'warn' | 'info', text: string) => {
    const who = [...clients.values()].find((x) => x.key === key);
    if (who) send(who, { t: 'tell', kind, text });
  };
  fetch(`${SITE_URL}/api/cashin?id=${entry.id}`, { method: 'POST', signal: AbortSignal.timeout(75_000) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      const p = ((await r.json()) as { payout?: SitePayout }).payout;
      // (payouts not switched on: it is listed, and that is all)
      if (!p || p.state === 'off') return;
      if (p.state === 'paid') {
        log('PAID', entry.id, p.signature);
        say('good', `${Math.round((p.lamports ?? 0) / 1e5) / 1e4} SOL sent to ${entry.wallet.slice(0, 4)}…${entry.wallet.slice(-4)} for ${entry.owner}'s tag.`);
        // with this one seen to, the site collects its rewards if there are any and looks at whatever else is waiting
        fetch(`${SITE_URL}/api/tick`, { signal: AbortSignal.timeout(75_000) }).catch(() => {});
        return;
      }
      if (p.state === 'skipped') {
        log('NOT PAID', entry.id, p.why);
        say('warn', `${entry.owner}'s tag is listed and not paid: ${p.why}.`);
        return;
      }
      if (attempt === 1) say('info', p.state === 'sending' ? `Your reward for ${entry.owner}'s tag is on its way.` : `Your reward for ${entry.owner}'s tag is waiting: ${p.why}.`);
      if (Date.now() - began < 24 * 3600 * 1000) again(p.state === 'sending' && attempt < 20 ? 25_000 : 5 * 60_000);
    })
    .catch((e) => {
      log(`could not hand cash-in ${entry.id} to the site (${(e as Error).message}), attempt ${attempt}`);
      if (attempt < 8) again(attempt * 15000);
    });
}

/** every dog tag in what a player says they carry */
function carriedTags(inv: SerializedInventory | null): ItemInstance[] {
  const out: ItemInstance[] = [];
  const walk = (it: ItemInstance | null | undefined) => {
    if (!it) return;
    if (it.id === 'dogtag') out.push(it);
    for (const p of it.cargo ?? []) walk(p.item);
  };
  if (!inv) return out;
  for (const it of Object.values(inv.slots)) walk(it);
  for (const cont of inv.containers) for (const it of cont.items) walk(it);
  return out;
}

/** Is one of these among what somebody carries? (a keycard, like a tag that was taken, goes on foot) */
function carries(inv: SerializedInventory | null, id: string): boolean {
  let found = false;
  const walk = (it: ItemInstance | null | undefined) => {
    if (!it || found) return;
    if (it.id === id) found = true;
    for (const p of it.cargo ?? []) walk(p.item);
  };
  if (!inv) return false;
  for (const it of Object.values(inv.slots)) walk(it);
  for (const cont of inv.containers) for (const it of cont.items) walk(it);
  return found;
}

/**
 * The bunker's door. A keycard opens it; it stays open while anybody is inside (or stands in
 * its doorway), and shuts a minute after the last of them has gone.
 */
const bunkerDoor = { open: false, /** when somebody was last inside, or the card was used */ emptyAt: 0 };

// ------------------------------------------------------------------ players

/**
 * Carrying a tag they took off somebody (their own does not count). Such a player is shown
 * on the map every half minute, and goes on foot: no jeep will take them.
 */
function takenTag(c: Client): boolean {
  return carriedTags(c.inv).some((t) => {
    const from = lootedTags.get(t.uid);
    return !!from && from.ownerKey !== c.key;
  });
}

// ---------------------------------------------------------------- the server's own checks
/**
 * A player's own game says where it is and whom it has hit, and it is believed: a game that has been tampered with
 * can say anything. These are the server's checks on what it is told. They are run one of three ways (CHECKS, in
 * the environment):
 *   watch   – what would have been refused is written down and let through. The default: a check is not let touch
 *             what an honest player does until it has been seen, in the log, never to fire on one.
 *   enforce – it is refused.
 *   off     – it is not looked at.
 * What is checked: that a player has not got somewhere faster than legs or a jeep go; that a shot does not pass
 * through a hill; that nobody is standing after more than a body can take (`dealt`); that a thing taken off the
 * ground was within reach; and that the guns, the blades, the armour and the keycard somebody carries, puts down,
 * stores or hits with are ones the server itself put in the world (`issued`). (That a hit is by the weapon held,
 * within its range, no faster than it fires, and does what that weapon does, was always the server's to say.)
 */
const CHECKS = (['off', 'watch', 'enforce'].includes(process.env.CHECKS ?? '') ? process.env.CHECKS : 'watch') as 'off' | 'watch' | 'enforce';
/**
 *   foot  – the fastest anybody is let go on their own legs, m/s along the ground (a sprint with empty hands is 7.4)
 *   seat  – and in a jeep (which is held to 60: see isVState)
 *   carry – seconds of going that fast that may be saved up: what a connection that was held up sends all at once
 *   grace – metres let go on top of that, every time
 *   free  – ms after being set down somewhere (a start, a seat taken or left) in which where they are is not questioned
 *   kick  – so many refusals inside a minute, and the connection is closed (when enforcing)
 *   hill  – how far the ground may stand over the line of a shot before the shot is through a hill, metres
 *   high  – how far over the ground, and for how many seconds, before it is written down that somebody is in the air
 *   reach – how far off a thing lying in the world can be taken from, metres (a hand reaches three)
 *   heal  – the most health anybody gets back in a second, by any means (a first aid kit gives 45 in six)
 *   over  – how far past none the health the server allows somebody may go before they ought to be dead, and
 *   down  – how many ms they are given to say so themselves, as every honest game does
 *   strikes, ban – put off the server so many times inside an hour, and they are kept off it for so many hours
 */
const CHECK = { foot: 9.5, seat: 64, carry: 2, grace: 3, free: 2500, kick: Number(process.env.CHECK_KICK) || 12, hill: 1.5, high: [30, 4], reach: 8, heal: 10, over: 15, down: 1500, strikes: 2, ban: 6 };
let flagged = 0;

/** Something a check fires on: counted, and written down (not more than once in five seconds for one player). @returns whether it is refused */
function flag(c: Client, what: string, refuse = true): boolean {
  c.check.flags++;
  flagged++;
  const now = Date.now();
  if (now - c.check.said > 5000) {
    c.check.said = now;
    log(`[check:${CHECKS}] ${c.name} ${what} (${c.check.flags} so far)`);
  }
  return refuse && CHECKS === 'enforce';
}

/**
 * Whether the place a player says they have got to is one they could have got to since they were last where
 * they said. Refused, they are kept where they were for everybody else (and for what they can hit from there)
 * until enough time has gone by to have run or driven the distance: nobody gets anywhere faster than that, and
 * an honest player who was wrongly refused is right again in the time it takes to cover the ground.
 */
function moveCheck(c: Client, to: Pose, now: number): boolean {
  const k = c.check;
  if (CHECKS === 'off' || !c.alive || now < k.free || c.power.clip) {
    k.at = now;
    k.carry = 0;
    k.high = 0;
    return true;
  }
  const dt = Math.min(600, Math.max(0, (now - k.at) / 1000)), most = c.seatAt ? CHECK.seat : CHECK.foot;
  const dist = Math.hypot(to[0] - c.pose[0], to[2] - c.pose[2]), allow = most * dt + k.carry;
  // (in the air: written down and never refused. There are towers and roofs, and there is falling off things.)
  k.high = !c.seatAt && to[1] - world.groundAt(to[0], to[2]) > CHECK.high[0] ? k.high + Math.min(dt, 1) : 0;
  if (k.high > CHECK.high[1]) {
    k.high = 0;
    flag(c, `is ${(to[1] - world.groundAt(to[0], to[2])).toFixed(0)} m over the ground at ${to[0].toFixed(0)}, ${to[2].toFixed(0)}`, false);
  }
  if (dist <= allow + CHECK.grace) {
    k.at = now;
    k.carry = Math.min(most * CHECK.carry, Math.max(0, allow - dist));
    return true;
  }
  if (!flag(c, `moved ${dist.toFixed(0)} m in ${dt.toFixed(2)} s ${c.seatAt ? 'in a jeep' : 'on foot'}, to ${to[0].toFixed(0)}, ${to[2].toFixed(0)}`)) {
    k.at = now;
    k.carry = 0;
    return true;
  }
  k.refused = k.refused.filter((t) => now - t < 60000);
  k.refused.push(now);
  if (k.refused.length >= CHECK.kick * 10) {
    k.refused = [];
    putOff(c, `where they said they were was refused ${CHECK.kick * 10} times in a minute`);
  }
  return false;
}

/**
 * The most any worn thing takes off a hit, were everything that can be worn worn at once: nobody is hurt less
 * than that by anything. (What each player says they wear is not asked: it is their own game's word, and a
 * moment old.)
 */
const SOAK = (() => {
  const best = (field: 'armor' | 'head') => {
    const by = new Map<string, number>();
    for (const d of Object.values(ITEMS)) {
      const v = d.wear?.[field];
      if (v !== undefined) by.set(d.slot ?? d.id, Math.min(by.get(d.slot ?? d.id) ?? 1, v));
    }
    return [...by.values()].reduce((x, y) => x * y, 1);
  };
  return { torso: best('armor'), head: best('head') };
})();

/**
 * What the server has just dealt somebody, taken off the most health they can have. That figure is never less
 * than what they do have: it starts at what they last said (or a hundred), comes back at CHECK.heal a second
 * whether they are mending or not, and loses only what the best armour there is would let through. So nobody
 * honest is ever below it, and whoever is CHECK.over past none of it and still on their feet CHECK.down later
 * has taken more than a body can (see `standing`).
 */
function dealt(target: Client, amount: number, zone: string, w: string) {
  keep(target, amount, zone, w);
  stayOn(target, 'you were hit');
  if (CHECKS === 'off' || !target.alive) return;
  const now = Date.now(), k = target.check;
  k.hp = Math.min(100, k.hp + (CHECK.heal * (now - k.hpAt)) / 1000) - amount * (w === 'crash' ? 1 : zone === 'torso' ? SOAK.torso : zone === 'head' ? SOAK.head : 1);
  k.hpAt = now;
  if (k.hp < -CHECK.over && !k.downAt) k.downAt = now;
}

// ------------------------------------------------------------------ a life kept by the server
//
// A player's health is their own game's to keep for as long as that game is answering: it is the one that knows
// what they ate, what they fell off and what they bound up. But a game that is not answering is a body standing in
// the world all the same: a tab put behind another (a browser stops the game in it), a game that has frozen, a
// window shut. Nothing could kill such a body, because nothing was there to say it had died.
//
// So: from SILENT after a game last said where its player was, the server keeps that player's life. What hits
// them comes off the health they last reported, through the armour they were last seen wearing; an open wound
// runs; and at nothing the server says they are dead, as their own game would have. When the game is heard from
// again it is told what the figure is now.
//
// And a connection that goes without a proper leave leaves its body where it stood, sat on the ground, for
// LINGER: seen, hit and killed like anybody, and what it carried is on it. Whoever comes back within that time is
// back in that body. The proper leave is asked for and waited out, LOGOUT seconds, standing still and unhurt:
// then the body goes with the player, at once.

/** seconds of nothing heard before a life is the server's to keep; a body left behind stays so long; the wait to leave properly */
const SILENT_MS = 1500;
const LINGER_MS = (process.env.LINGER_S === undefined ? 300 : Math.max(0, Number(process.env.LINGER_S) || 0)) * 1000;
const LOGOUT_MS = (process.env.LOGOUT_S === undefined ? 60 : Math.max(0, Number(process.env.LOGOUT_S) || 0)) * 1000;
/** how far somebody waiting to leave may shift before the wait is off, metres; and how long an open wound runs by itself, seconds */
const LOGOUT_STIR = 1.5, BLEED_S = 42;

const away = (c: Client, now = Date.now()) => c.asleep > 0 || now - c.heardAt > SILENT_MS;
/** what worn things do to a hit: every plate and helmet they were last seen in (as their own game reckons it: Game.takeHit) */
const worn = (c: Client, k: 'armor' | 'head') => Object.values(c.inv?.slots ?? {}).flatMap((it) => (it && ITEMS[it.id]?.wear?.[k] !== undefined ? [ITEMS[it.id].wear![k] as number] : []));

/** Something has hit somebody whose game is not answering: it comes off the health the server holds for them. */
function keep(c: Client, amount: number, zone: string, w: string) {
  if (!c.alive || !away(c)) return;
  const v = (c.vitals ??= { health: 100, energy: 80, water: 80, stamina: MAX_STAMINA, bleeding: false });
  let a = amount;
  if (w !== 'crash') for (const m of zone === 'torso' ? worn(c, 'armor') : zone === 'head' ? worn(c, 'head') : []) a *= m;
  v.health = Math.max(0, v.health - a);
  c.kept = true;
  // (a round nearly always opens a wound, the infected and a blade often, a blast or a blow seldom)
  if (w !== 'crash' && Math.random() < (ITEMS[w]?.weapon ? (a > 12 ? 0.85 : 0.4) : w === 'infected' ? INFECTED.bleed : 0.25)) v.bleeding = true;
  // (after whoever dealt it has been told it landed)
  if (v.health <= 0) setImmediate(() => kill(c, w === 'infected' ? 'the infected' : ITEMS[w]?.name ? 'wounds' : w));
}

/** Once a second: the wounds of those whose lives the server is keeping, the bodies left behind whose time is up, and the waits to leave that are over. */
function keeping(now: number) {
  for (const c of [...clients.values()]) {
    if (c.asleep && now - c.asleep >= LINGER_MS) {
      log(`${c.name}'s body has been left ${Math.round(LINGER_MS / 1000)} s: it goes, with what it carried`);
      drop(c);
      continue;
    }
    if (c.logoutAt && now >= c.logoutAt && !c.asleep) {
      log(`${c.name} left the proper way`);
      send(c, { t: 'kick', reason: 'You have logged out. Your character is saved where you stood, with everything you carried.' });
      drop(c);
      c.ws.close();
      continue;
    }
    if (!c.alive || !away(c, now)) continue;
    const v = c.vitals;
    if (!v?.bleeding) continue;
    c.kept = true;
    v.health = Math.max(0, v.health - 1);
    if (++c.bled > BLEED_S) {
      v.bleeding = false;
      c.bled = 0;
    }
    if (v.health <= 0) kill(c, 'blood loss');
  }
}
setInterval(() => keeping(Date.now()), 1000);

/** The wait to leave properly is off: they are told why. */
function stayOn(c: Client, why: string) {
  if (!c.logoutAt) return;
  c.logoutAt = 0;
  send(c, { t: 'logout', left: 0, why });
}

/** A connection has gone. Dead, or with nothing kept of bodies: out of the world. Alive: the body stays, sat where it stood. */
function gone(c: Client) {
  if (!clients.has(c.id)) return;
  if (!c.alive || !LINGER_MS) return void drop(c);
  c.asleep = Date.now();
  c.logoutAt = 0;
  releaseLock(c);
  leaveSeat(c, true);
  c.w = null;
  c.m = [];
  c.pose[5] = F_SIT | F_GROUND | (c.vitals?.bleeding ? F_BLEED : 0);
  log(`~ ${c.name} (#${c.id}) went without logging out: their body stays ${Math.round(LINGER_MS / 1000)} s`);
}

/** Twice a second: whoever ought to have been dead for a while and has not said so. Enforcing, the server says it for them. */
function standing(now: number) {
  if (CHECKS === 'off') return;
  for (const c of [...clients.values()]) {
    const k = c.check;
    if (!k.downAt || now - k.downAt < CHECK.down) continue;
    k.downAt = 0;
    if (!c.alive) continue;
    if (!flag(c, `is on their feet after ${Math.round(100 - k.hp)} of damage that no armour stops`)) continue;
    k.hp = 0;
    kill(c, 'wounds');
  }
}
setInterval(() => standing(Date.now()), 500);

/** What somebody says they carry, asked of the server's own list: an invented gun is written down once, and (enforcing) is not in the copy the server keeps of their pockets. */
function pockets(c: Client) {
  if (CHECKS === 'off' || !c.inv) return;
  const gone = new Set<string>();
  for (const it of things(c.inv)) {
    if (!invented(it)) continue;
    if (!c.check.unknown.has(it.uid)) {
      c.check.unknown.add(it.uid);
      flag(c, `carries ${ITEMS[it.id].name} (${it.uid.slice(0, 12)}), which the server never put in the world`);
    }
    if (CHECKS === 'enforce') gone.add(it.uid);
  }
  if (!gone.size) return;
  const keep = (it: ItemInstance | null): ItemInstance | null => {
    if (!it || gone.has(it.uid)) return null;
    if (it.cargo) it.cargo = it.cargo.filter((p) => !!keep(p.item));
    return it;
  };
  for (const k of Object.keys(c.inv.slots)) c.inv.slots[k] = keep(c.inv.slots[k]);
  for (const cont of c.inv.containers) cont.items = cont.items.filter((it) => !!keep(it));
}

// ---------------------------------------------------------------- kept off the server
const listOf = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
/**
 * Who is not let in. BAN_KEYS and BAN_IPS in the environment (lists, commas between) are kept off for as long as
 * they are written there. And whoever the checks have put off the server CHECK.strikes times inside an hour is
 * kept off for CHECK.ban hours, by the key their game gives and (where addresses can be told apart) by address.
 * This last is forgotten when the server restarts.
 */
const BANS = { keys: new Set(listOf(process.env.BAN_KEYS)), ips: new Set(listOf(process.env.BAN_IPS)), temp: new Map<string, { until: number; why: string }>(), strikes: new Map<string, number[]>() };
function bannedFor(key: string, ip: string): string | null {
  if (BANS.keys.has(key) || (!!ip && BANS.ips.has(ip))) return 'kept off by name';
  if (adminBan(key, ip)) return 'banned';
  const now = Date.now();
  for (const n of [key, ...(ip ? [`ip:${ip}`] : [])]) {
    const b = BANS.temp.get(n);
    if (b && b.until > now) return b.why;
    if (b) BANS.temp.delete(n);
  }
  return null;
}
// ------------------------------------------------------------------ admins, and who they have banned (2026-10-11)
//
// Asked for the day players were found flying and sunk in the ground: "i need a way to become admin and a way to
// make someone else admin ... mainly need a way to ban people asap, permanantley as well as unban", "i will set
// password in vercel env, make in game command for me to admin myself", "once im admin role in the game i should
// be good permanantley".
//
// Who is an admin (or a mod), and who is banned, is kept by the site (api/admin.ts), since this server forgets
// everything when it restarts. It is read from there when the server starts and written there when an admin
// changes it. The password is the site's and is checked there: what a player types is passed on and kept nowhere,
// here or in the log. A player is known by a hash of the key their game gives, and an address by a hash made with
// a secret the site hands over (`pepper`): the lists hold nobody's key and nobody's address.
//
// The orders are typed where talk is typed, with a stroke in front (`/ban name`): see `command`. Nothing that
// begins with a stroke is ever said to anybody.
type Role = 'admin' | 'mod';
interface AdminState {
  roles: Record<string, { role: Role; name: string; by: string; at: string }>;
  bans: { key: string; ip: string; name: string; why: string; by: string; at: string }[];
}
const ADMIN = {
  state: { roles: {}, bans: [] } as AdminState,
  pepper: '',
  /** read from the site at least once since this server started */
  ready: false,
  /** what the site is about to ask this server to vouch for: a number, and what it stands for */
  ops: new Map<string, Record<string, unknown>>(),
  /** tries at the password: by key and by address, the times of them */
  tries: new Map<string, number[]>(),
  /** whoever has left lately (the newest last): somebody who does a thing and goes can still be banned */
  gone: [] as { id: number; name: string; key: string; ip: string; at: number }[],
  /** until when what somebody types and says reaches nobody: by their key */
  muted: new Map<string, number>(),
  /** when each panel last asked for its lists */
  asked: new Map<number, number>(),
  /** what each admin has chosen for their own death, by their key: it is theirs again when they come back */
  voids: new Map<string, { voidInv: boolean; voidTag: boolean }>(),
};
const keyHash = (key: string) => createHash('sha256').update(`zona key ${key}`).digest('hex').slice(0, 40);
/** Is this an address out in the world? (Not this machine's own, nor one of a private network: those are whatever stands in front of the server, and are everybody's.) */
const publicIp = (ip: string) => !!ip && !/^(::1$|0:0:0:0::|::ffff:127\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);
const ipHash = (ip: string) => (publicIp(ip) && ADMIN.pepper ? createHash('sha256').update(`${ADMIN.pepper} ${ip}`).digest('hex').slice(0, 40) : '');
const roleOf = (c: Client): Role | null => ADMIN.state.roles[keyHash(c.key)]?.role ?? null;
function adminBan(key: string, ip: string): boolean {
  const k = keyHash(key), a = ipHash(ip);
  // (Somebody with a role is never kept off by an address: an address is a household's, a café's, a whole
  // phone network's, and an admin who banned somebody at their own would have banned themselves.)
  const mine = !!ADMIN.state.roles[k];
  return ADMIN.state.bans.some((b) => b.key === k || (!mine && !!a && b.ip === a && ipsTellApart()));
}
/**
 * How many may play from one address at a time (PER_ADDRESS; 0: any number). Asked for 2026-10-11, the day of
 * the cheats: "we should limit 1 connection per IP". It costs two friends in one house their game together, and
 * a whole street behind one address on some phone networks: it is the owner's to set. Whoever has a role is not
 * counted or refused, and it is not asked while the host hides addresses (see ipsTellApart).
 */
const PER_ADDRESS = process.env.PER_ADDRESS === undefined ? 1 : Math.max(0, Number(process.env.PER_ADDRESS) || 0);
function addressFull(key: string, ip: string): boolean {
  if (!PER_ADDRESS || !publicIp(ip) || !ipsTellApart() || ADMIN.state.roles[keyHash(key)]) return false;
  return [...clients.values()].filter((o) => o.ip === ip && o.key !== key && !roleOf(o)).length >= PER_ADDRESS;
}
/** Something asked of the site: it is told a number, and asks this server back what the number stands for (see /adminop below). */
async function siteAdmin(op: Record<string, unknown>): Promise<{ ok?: boolean; why?: string; state?: AdminState; pepper?: string; set?: boolean } | null> {
  const n = randomBytes(16).toString('hex');
  ADMIN.ops.set(n, op);
  try {
    const r = await fetch(`${SITE_URL}/api/admin?n=${n}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    const out = (await r.json()) as { ok?: boolean; why?: string; state?: AdminState; pepper?: string; set?: boolean };
    if (out.ok && out.state) {
      ADMIN.state = { roles: out.state.roles ?? {}, bans: out.state.bans ?? [] };
      if (out.pepper) ADMIN.pepper = out.pepper;
      ADMIN.ready = true;
    }
    return out;
  } catch {
    return null;
  } finally {
    ADMIN.ops.delete(n);
  }
}
// ------------------------------------------------------------------ kept between restarts
//
// Everybody's character (where they stood, what they carried, how they were) and every stash, with what is in it:
// handed to the site, which keeps it in one file (api/keep.ts), and read back when the server starts. This server
// has no disk that outlasts it. What lies loose in the world is not kept: only what is in somebody's pockets or in
// a container somebody put down.
//
// It is sealed here before it leaves (with a key drawn from the secret this server shares with the site), so the
// file says nothing to anybody else: not who anybody is, and not where a stash is buried. A player is in it by a
// hash of their key and never the key.
//
// When it is written: once a server with somebody on it begins (`claim`: from then on the file says a server is
// alive that has more to say), every KEEP_EVERY while anybody has been on, and as it stops (its last word). At a
// deploy the new server is started before the old one is stopped: so a server that finds the file is not a last
// word waits a little for one before it reads, and whoever arrives meanwhile waits in the line.
//
// WIPE on the host is the name of the world: what was kept under another name is not read, and is written over.
// (Changing it is how everything is wiped, when that is wanted.)

/** this run of the server, by a name of its own */
const BOOT = randomBytes(8).toString('hex');
/** on the host it is kept; on somebody's own machine it is not, unless asked for (KEEP=on) */
const KEEP_ON = process.env.KEEP ? process.env.KEEP !== 'off' : !!process.env.RENDER;
const KEEP_EVERY_MS = (process.env.KEEP_EVERY_MIN === undefined ? 180 : Math.max(0, Number(process.env.KEEP_EVERY_MIN) || 0)) * 60_000;
const KEEP_WAIT_MS = (process.env.KEEP_WAIT_S === undefined ? 25 : Math.max(0, Number(process.env.KEEP_WAIT_S) || 0)) * 1000;
const WIPE = (process.env.WIPE ?? '').slice(0, 40);
const KEPT = {
  /** what was kept has been read (or there was nothing, or it is not kept here): players are let in */
  ready: !KEEP_ON,
  /** characters from before this server started, by the hash of their key, until their players come for them */
  chars: new Map<string, Record_>(),
  /** the file says this server is alive; something has happened since it was last written; when that was; a writing is under way */
  claimed: false,
  dirty: false,
  savedAt: 0,
  busy: false,
};
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

interface Snapshot {
  rev: number;
  wipe: string;
  chars: [string, Record_][];
  stashes: Box[];
}
interface KeptFile { at: string; boot: string; final: boolean; z: string }

const sealKey = () => createHash('sha256').update(`zona world save ${ADMIN.pepper}`).digest();
function seal(data: unknown): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(data))), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
function unseal(z: string): unknown {
  const b = Buffer.from(z, 'base64'), d = createDecipheriv('aes-256-gcm', sealKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()])).toString('utf8'));
}

/** Something asked of the site about what is kept: signed with the secret the two share (see api/keep.ts). */
async function siteKeep(op: Record<string, unknown>): Promise<{ ok?: boolean; why?: string; save?: KeptFile | null } | null> {
  if (!ADMIN.pepper) return null;
  const body = JSON.stringify(op), at = String(Date.now());
  const sig = createHmac('sha256', `zona keep ${ADMIN.pepper}`).update(`${at}.${createHash('sha256').update(body).digest('hex')}`).digest('hex');
  try {
    const r = await fetch(`${SITE_URL}/api/keep`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zona-at': at, 'x-zona-auth': sig }, body, signal: AbortSignal.timeout(20_000) });
    return r.ok ? ((await r.json()) as { ok?: boolean; why?: string; save?: KeptFile | null }) : null;
  } catch {
    return null;
  }
}

/** everything that is kept, as it is this moment */
function snapshot(): Snapshot {
  const now = Date.now(), chars = new Map<string, Record_>(KEPT.chars);
  for (const [k, r] of records) if (r.alive && r.inv) chars.set(keyHash(k), r);
  for (const c of clients.values()) if (c.alive && c.inv) chars.set(keyHash(c.key), { pose: c.pose, inv: c.inv, vitals: c.vitals, alive: true, leftAt: now });
  // (no more of them than can be carried: the newest, if it ever came to that)
  const newest = [...chars].sort((a, b) => b[1].leftAt - a[1].leftAt).slice(0, 6000);
  return { rev: WORLD_REV, wipe: WIPE, chars: newest, stashes: [...boxes.values()].filter((b) => b.kind === 'stash') };
}

/** What is kept is written to the site. @param final this server's last word @returns whether it was */
async function keepNow(final: boolean, why: string): Promise<boolean> {
  if (!KEEP_ON || !KEPT.ready || !ADMIN.pepper || KEPT.busy) return false;
  // (a server nobody came to has nothing to say that the file does not say already)
  if (!KEPT.claimed && !KEPT.dirty) return false;
  KEPT.busy = true;
  try {
    const snap = snapshot();
    for (let tries = 0; tries < 3; tries++) {
      const r = await siteKeep({ op: 'save', at: new Date().toISOString(), boot: BOOT, final, z: seal(snap) });
      if (r?.ok) {
        KEPT.claimed = true;
        KEPT.dirty = clients.size > 0;
        KEPT.savedAt = Date.now();
        log(`[keep] ${why}: ${snap.chars.length} characters and ${snap.stashes.length} stashes written to the site${final ? ' (the last word)' : ''}`);
        return true;
      }
      await pause(700);
    }
    log(`[keep] ${why}: it could NOT be written to the site`);
    return false;
  } finally {
    KEPT.busy = false;
  }
}

/** The first player of this run has come in: the file is made to say a server is alive, with more to say. */
function claim() {
  KEPT.dirty = true;
  if (KEEP_ON && KEPT.ready && !KEPT.claimed && !KEPT.busy) void keepNow(false, 'somebody is on');
}
setInterval(() => {
  if (KEEP_EVERY_MS && KEPT.dirty && Date.now() - KEPT.savedAt >= KEEP_EVERY_MS) void keepNow(false, 'time has gone by');
}, Math.max(1000, Math.min(60_000, KEEP_EVERY_MS || 60_000))).unref();

/** What was kept is read, and the world is as it was left: then players are let in. */
async function loadKept() {
  const open = (what: string) => {
    if (KEPT.ready) return;
    KEPT.ready = true;
    log(`[keep] ${what}`);
    fillFromQueue();
  };
  if (!KEEP_ON) return;
  try {
    // (the secret it is read with comes with the admin lists: see `loadAdmin`)
    for (let k = 0; k < 35 && !ADMIN.pepper; k++) await pause(1000);
    if (!ADMIN.pepper) return open('nothing is kept between restarts: the site did not answer, or no admin password is set on it');
    let save: KeptFile | null = null;
    const until = Date.now() + KEEP_WAIT_MS;
    for (;;) {
      const r = await siteKeep({ op: 'load' });
      if (r?.ok) save = r.save ?? null;
      // (written by a server that has not said its last word: it may be about to, if this is a deploy and it is still alive)
      if ((r?.ok && (!save || save.final || save.boot === BOOT)) || Date.now() >= until) break;
      await pause(2500);
    }
    if (!save) return open('nothing has been kept yet: everybody begins afresh');
    const snap = unseal(save.z) as Snapshot;
    if ((snap.wipe ?? '') !== WIPE) return open(`what was kept is of the world "${snap.wipe ?? ''}", and this is "${WIPE}": everybody begins afresh`);
    const moved = snap.rev !== WORLD_REV, now = Date.now();
    for (const [k, r] of snap.chars ?? []) {
      if (!r?.inv || !r.alive || now - r.leftAt > RECORD_LIFETIME || !isPose(r.pose)) continue;
      const inv = cleanInventory(r.inv);
      for (const it of things(inv)) issue(it);
      // (the map has been made again since: what they carried is theirs, where they stood may be inside a wall)
      KEPT.chars.set(k, { pose: r.pose, inv, vitals: r.vitals, alive: true, leftAt: r.leftAt, ...(moved ? { afresh: true } : {}) });
    }
    let stashes = 0;
    for (const b of snap.stashes ?? []) {
      if (b?.kind !== 'stash' || typeof b.cid !== 'string' || boxes.has(b.cid) || ![b.x, b.y, b.z, b.rot].every(num)) continue;
      const items = (Array.isArray(b.items) ? b.items : []).flatMap((s) => {
        const it = cleanItem(s);
        return it ? [{ ...it, x: s.x, y: s.y, rot: !!s.rot }] : [];
      });
      for (const it of items) issue(it);
      boxes.set(b.cid, { ...b, items, y: moved ? world.groundAt(b.x, b.z) : b.y, emptiedAt: -1 });
      stashes++;
    }
    open(`${KEPT.chars.size} characters and ${stashes} stashes as they were kept at ${save.at}${save.final ? '' : ' (not a last word: the server before this one stopped without one)'}${moved ? '; the map has been made again since, so everybody starts from the edge with what they had' : ''}`);
  } catch (e) {
    open(`what was kept could not be read (${e instanceof Error ? e.message : e}): everybody begins afresh`);
  }
}

/** The lists are read when the server starts, and again every little while until they have been (the site may be asleep). */
function loadAdmin(tries = 0) {
  void siteAdmin({ op: 'load' }).then((r) => {
    if (r?.ok) return void log(`[admin] lists read from the site: ${Object.keys(ADMIN.state.roles).length} with a role, ${ADMIN.state.bans.length} banned${r.set ? '' : ' (no ADMIN_PASSWORD is set there: nobody can become an admin)'}`);
    // (often at first: at a deploy the site's call back reaches the server before this one until this one is the one being served)
    if (tries < 44) setTimeout(() => loadAdmin(tries + 1), tries < 24 ? 5_000 : 30_000).unref();
  });
}
/** What an admin changed is written to the site. @returns whether it was */
async function saveAdmin(next: AdminState): Promise<boolean> {
  const was = ADMIN.state;
  // (held here at once, so that it bites whether or not the site answers)
  ADMIN.state = next;
  const r = await siteAdmin({ op: 'save', state: next });
  if (r?.ok) return true;
  if (ADMIN.state !== next) return true;
  void was;
  return false;
}
const sys = (c: Client, ...lines: string[]) => lines.forEach((text) => send(c, { t: 'sys', text }));
/** the player meant by a word: `#12` (their number), their name, or the start or some part of it if only one fits */
function whoIs(word: string): Client | null {
  const all = [...clients.values()];
  if (/^#\d+$/.test(word)) return clients.get(Number(word.slice(1))) ?? null;
  const w = word.toLowerCase();
  const exact = all.filter((o) => o.name.toLowerCase() === w);
  if (exact.length === 1) return exact[0];
  const part = all.filter((o) => o.name.toLowerCase().includes(w));
  return part.length === 1 ? part[0] : null;
}
/** Somebody set down somewhere by an admin: there at once for everybody, and not asked how they got there. */
function place(t: Client, x: number, y: number | null, z: number, by: Client) {
  const now = Date.now();
  t.pose = [x, y ?? world.groundAt(x, z), z, t.pose[3], t.pose[4], t.pose[5]];
  t.check.free = now + CHECK.free;
  t.check.at = now;
  t.check.carry = 0;
  t.underAt = 0;
  send(t, { t: 'put', x, ...(y === null ? {} : { y }), z, ...(by === t ? {} : { by: by.name }) });
}
/** One of an admin's powers, put on or off: they are told which they have, and (vanishing) everybody else that they have left or come. */
function setPower(c: Client, k: keyof Client['power'], on: boolean) {
  if (c.power[k] === on) return;
  c.power[k] = on;
  if (k === 'voidInv' || k === 'voidTag') {
    ADMIN.voids.set(c.key, { voidInv: c.power.voidInv, voidTag: c.power.voidTag });
    return void send(c, { t: 'powers', ...c.power });
  }
  const now = Date.now();
  if (k === 'hidden') broadcast(on ? { t: 'leave', id: c.id } : { t: 'join', p: info(c) }, c);
  if (k === 'clip') {
    c.check.free = now + CHECK.free;
    c.underAt = 0;
  }
  if (k === 'god') {
    c.check.hp = 100;
    c.check.hpAt = now;
    c.check.downAt = 0;
  }
  send(c, { t: 'powers', ...c.power });
  log(`[admin] ${c.name} has ${on ? 'put on' : 'put off'} ${k === 'hidden' ? 'vanish' : k === 'clip' ? 'noclip' : 'god mode'}`);
}
/** the thing meant by a word: its id, its name, or some part of either if only one thing fits */
function itemBy(word: string): string | null {
  const w = word.toLowerCase();
  if (!w) return null;
  if (ITEMS[w]) return w;
  const all = Object.values(ITEMS);
  const named = all.filter((d) => d.name.toLowerCase().replace(/\s+/g, '_') === w);
  if (named.length === 1) return named[0].id;
  const part = all.filter((d) => d.id.includes(w) || d.name.toLowerCase().includes(w.replace(/_/g, ' ')));
  return part.length === 1 ? part[0].id : null;
}
/** put off the server by somebody with the right to: told why, and gone */
function eject(target: Client, reason: string) {
  send(target, { t: 'kick', reason });
  target.ws.close();
  drop(target);
}
/**
 * An order typed where talk is typed. @returns nothing: whoever gave it is told what came of it.
 * Mods: players, recent, flagged, kick, timeout, say. Admins: those, and ban, unban, bans, admin, mod, demote, roles.
 */
async function command(c: Client, line: string) {
  const [word = '', ...rest] = line.slice(1).trim().split(/\s+/);
  const cmd = word.toLowerCase(), role = roleOf(c);
  if (!role) return void sys(c, cmd === 'help' ? 'There is nothing here to give orders with.' : 'That is not a thing you can do here.');
  const admin = role === 'admin';
  const need = () => void sys(c, 'Only an admin can do that.');
  const who = rest[0] ?? '', why = rest.slice(1).join(' ').slice(0, 120);
  const label = (o: Client) => `#${o.id} ${o.name}${roleOf(o) ? ` [${roleOf(o)}]` : ''}`;
  switch (cmd) {
    case 'help':
      return void sys(c, `Orders: ${ORDERS.filter((o) => !o.admin).map(written).join(' · ')}`, ...(admin ? [`Admins: ${ORDERS.filter((o) => o.admin).map(written).join(' · ')}`] : []), '"who" is a name, part of one, or #number from /players.', ...(admin ? ['/ban also finds somebody who has just left (/recent).'] : []));
    case 'players':
    case 'who':
    case 'list':
      return void sys(c, `${clients.size} online:`, ...[...clients.values()].map((o) => `${label(o)}  at ${o.pose[0].toFixed(0)}, ${o.pose[2].toFixed(0)}${o.alive ? '' : ' (dead)'}${o.check.flags ? `  ${o.check.flags} flagged` : ''}`));
    case 'recent':
      return void sys(c, ADMIN.gone.length ? 'Left lately (newest last):' : 'Nobody has left lately.', ...ADMIN.gone.slice(-15).map((g) => `${g.name}  ${Math.round((Date.now() - g.at) / 60000)} min ago`));
    case 'flagged': {
      const list = [...clients.values()].filter((o) => o.check.flags > 0).sort((p, q) => q.check.flags - p.check.flags);
      return void sys(c, list.length ? `Flagged by the checks (which are set to "${CHECKS}"):` : 'Nobody online has been flagged.', ...list.map((o) => `${label(o)}  ${o.check.flags} times`));
    }
    case 'say':
      if (!rest.length) return void sys(c, 'Say what?');
      log(`[admin] ${c.name} to everybody: ${rest.join(' ')}`);
      return void broadcast({ t: 'tell', kind: 'warn', text: rest.join(' ').slice(0, 160) });
    case 'kick': {
      const t = whoIs(who);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (roleOf(t) === 'admin' && !admin) return need();
      log(`[admin] ${c.name} kicked ${t.name}${why ? `: ${why}` : ''}`);
      eject(t, `You were put off the server${why ? `: ${why}` : '.'}`);
      return void sys(c, `${t.name} is off the server.`);
    }
    case 'timeout': {
      const t = whoIs(who), mins = Math.min(60, Math.max(1, Math.round(Number(rest[1]) || 10)));
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (roleOf(t) === 'admin' && !admin) return need();
      const reason = rest.slice(2).join(' ').slice(0, 120);
      for (const n of namesOf(t.key, t.ip)) BANS.temp.set(n, { until: Date.now() + mins * 60000, why: `timed out by ${c.name}${reason ? `: ${reason}` : ''}` });
      log(`[admin] ${c.name} timed ${t.name} out for ${mins} minutes${reason ? `: ${reason}` : ''}`);
      eject(t, `You are kept off the server for ${mins} minutes${reason ? `: ${reason}` : '.'}`);
      return void sys(c, `${t.name} is off the server for ${mins} minutes.`);
    }
    case 'ban': {
      if (!admin) return need();
      const t = whoIs(who);
      const left = t ? null : (/^#\d+$/.test(who) ? ADMIN.gone.find((g) => g.id === Number(who.slice(1))) : undefined) ?? [...ADMIN.gone].reverse().find((g) => g.name.toLowerCase() === who.toLowerCase()) ?? [...ADMIN.gone].reverse().find((g) => g.name.toLowerCase().includes(who.toLowerCase()) && who.length > 1);
      if (!t && !left) return void sys(c, `Nobody online or lately gone is "${who}": see /players and /recent.`);
      if (t === c) return void sys(c, 'That is you.');
      const name = t ? t.name : left!.name, key = keyHash(t ? t.key : left!.key), ip = ipHash(t ? t.ip : left!.ip);
      if (ADMIN.state.roles[key]?.role === 'admin') return void sys(c, `${name} is an admin: /demote first.`);
      const next: AdminState = { roles: ADMIN.state.roles, bans: [...ADMIN.state.bans.filter((b) => b.key !== key), { key, ip, name, why, by: c.name, at: new Date().toISOString() }] };
      log(`[admin] ${c.name} banned ${name}${why ? `: ${why}` : ''}${ip ? '' : ' (by key only: no address is known)'}`);
      if (t) eject(t, 'You are banned from this server.');
      const kept = await saveAdmin(next);
      return void sys(c, `${name} is banned${ip ? ', by their game and by their address' : ' (by their game only: the address could not be told)'}.${kept ? '' : ' It could NOT be written to the site: it holds until this server restarts. Give the order again in a minute.'}`);
    }
    case 'bans':
      if (!admin) return need();
      return void sys(c, ADMIN.state.bans.length ? 'Banned (the number is what /unban takes):' : 'Nobody is banned.', ...ADMIN.state.bans.map((b, i) => `${i + 1}. ${b.name}  by ${b.by}, ${b.at.slice(0, 10)}${b.why ? `: ${b.why}` : ''}`));
    case 'unban': {
      if (!admin) return need();
      const i = /^\d+$/.test(who) ? Number(who) - 1 : ADMIN.state.bans.findIndex((b) => b.name.toLowerCase() === who.toLowerCase());
      const b = ADMIN.state.bans[i];
      if (!b) return void sys(c, `No ban is "${who}": see /bans.`);
      log(`[admin] ${c.name} unbanned ${b.name}`);
      const kept = await saveAdmin({ roles: ADMIN.state.roles, bans: ADMIN.state.bans.filter((x) => x !== b) });
      return void sys(c, `${b.name} is no longer banned.${kept ? '' : ' It could NOT be written to the site: give the order again in a minute.'}`);
    }
    case 'admin':
    case 'op':
    case 'mod':
    case 'demote':
    case 'deop': {
      if (!admin) return need();
      const t = whoIs(who);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): they have to be here to be given a role, or to lose one.`);
      const key = keyHash(t.key), roles = { ...ADMIN.state.roles };
      const to: Role | null = cmd === 'mod' ? 'mod' : cmd === 'demote' || cmd === 'deop' ? null : 'admin';
      if (t === c && to !== 'admin') return void sys(c, 'Not yourself: somebody else has to.');
      if (to) roles[key] = { role: to, name: t.name, by: c.name, at: new Date().toISOString() };
      else delete roles[key];
      log(`[admin] ${c.name} made ${t.name} ${to ?? 'nothing'}`);
      const kept = await saveAdmin({ roles, bans: ADMIN.state.bans });
      if (to !== 'admin') for (const k of ['god', 'hidden', 'clip', 'voidInv', 'voidTag'] as const) setPower(t, k, false);
      send(t, { t: 'role', role: to });
      if (to) sys(t, `${c.name} has made you ${to === 'admin' ? 'an admin' : 'a mod'}: /help says what you can do.`);
      return void sys(c, `${t.name} is ${to ? (to === 'admin' ? 'an admin' : 'a mod') : 'no longer either'}.${kept ? '' : ' It could NOT be written to the site: give the order again in a minute.'}`);
    }
    case 'warn': {
      const t = whoIs(who), words = rest.slice(1).join(' ').slice(0, 160);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (!words) return void sys(c, 'Warn them of what?');
      log(`[admin] ${c.name} warned ${t.name}: ${words}`);
      send(t, { t: 'tell', kind: 'warn', text: `${admin ? 'An admin' : 'A mod'} warns you: ${words}` });
      sys(t, `${admin ? 'An admin' : 'A mod'} warns you: ${words}`);
      return void sys(c, `${t.name} has been warned.`);
    }
    case 'mute':
    case 'unmute': {
      const t = whoIs(who);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (cmd === 'unmute') {
        ADMIN.muted.delete(t.key);
        sys(t, 'You can be heard again.');
        return void sys(c, `${t.name} can be heard again.`);
      }
      if (roleOf(t)) return void sys(c, `${t.name} has a role: nobody with one is muted.`);
      const mins = Math.min(60, Math.max(1, Math.round(Number(rest[1]) || 10)));
      ADMIN.muted.set(t.key, Date.now() + mins * 60000);
      log(`[admin] ${c.name} muted ${t.name} for ${mins} minutes`);
      sys(t, `You are muted for ${mins} minutes: what you type and say reaches nobody.`);
      return void sys(c, `${t.name} is muted for ${mins} minutes.`);
    }
    case 'goto':
    case 'bring': {
      if (!admin) return need();
      const t = whoIs(who);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (t === c) return void sys(c, 'That is you.');
      const [moved, to] = cmd === 'goto' ? [c, t] : [t, c];
      if (!moved.alive) return void sys(c, `${moved === c ? 'You are' : `${moved.name} is`} dead: the dead are not moved.`);
      if (moved.seatAt) return void sys(c, `${moved === c ? 'You are' : `${moved.name} is`} in a car: out of it first.`);
      // (a step short of them, on the side they are not looking)
      const back = cmd === 'goto' ? 1 : -1.6, yaw = to.pose[3];
      place(moved, to.pose[0] + Math.sin(yaw) * back, to.pose[1] + 0.1, to.pose[2] + Math.cos(yaw) * back, c);
      log(`[admin] ${c.name} ${cmd === 'goto' ? `went to ${t.name}` : `brought ${t.name}`}`);
      return void sys(c, cmd === 'goto' ? `You are with ${t.name}.` : `${t.name} is with you.`);
    }
    case 'tp': {
      if (!admin) return need();
      const n = rest.slice(0, 3).map(Number);
      if (n.length < 2 || n.some((v) => !Number.isFinite(v))) return void sys(c, 'Where to? /tp x z (the numbers the map and /players give), or right-click the map.');
      if (!c.alive) return void sys(c, 'You are dead: the dead are not moved.');
      if (c.seatAt) return void sys(c, 'You are in a car: out of it first.');
      const [x, y, z] = n.length === 3 ? n : [n[0], null, n[1]];
      if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return void sys(c, 'That is off the map.');
      place(c, x, y, z, c);
      return void sys(c, `You are at ${x.toFixed(0)}, ${z.toFixed(0)}.`);
    }
    case 'give': {
      if (!admin) return need();
      const id = itemBy(rest[0] ?? '');
      if (!id) return void sys(c, `No thing is "${rest[0] ?? ''}" (or more than one is): type some of its name after /give and take one from the list.`);
      // (a tag is somebody's death, and is money: none is ever made)
      if (id === 'dogtag') return void sys(c, 'Not a dog tag: one is only ever taken from somebody.');
      const counted = /^\d+$/.test(rest[1] ?? ''), whom = counted ? rest[2] : rest[1];
      const t = whom ? whoIs(whom) : c;
      if (!t) return void sys(c, `Nobody online is "${whom}" (or more than one is): see /players.`);
      const per = ITEMS[id].stack ?? 1;
      let left = Math.max(1, Math.min(counted ? Number(rest[1]) : 1, per > 1 ? per * 10 : 10)), made = 0;
      while (left > 0) {
        const q = Math.min(per, left);
        economy.drop(makeItem(id, per > 1 ? q : undefined), t.pose[0] + (Math.random() - 0.5) * 0.9, t.pose[1] + 0.05, t.pose[2] + (Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2);
        left -= q;
        made += q;
      }
      log(`[admin] ${c.name} made ${made} of ${id}${t === c ? '' : ` at ${t.name}'s feet`}`);
      return void sys(c, `${made > 1 ? `${made} × ` : ''}${ITEMS[id].name} ${t === c ? 'at your feet' : `at ${t.name}'s feet`}.`);
    }
    case 'kit': {
      if (!admin) return need();
      const kit = KITS.find((k) => k.id === (rest[0] ?? '').toLowerCase());
      if (!kit) return void sys(c, `The kits are: ${KITS.map((k) => k.id).join(', ')}.`);
      const t = rest[1] ? whoIs(rest[1]) : c;
      if (!t) return void sys(c, `Nobody online is "${rest[1]}" (or more than one is): see /players.`);
      if (!t.alive) return void sys(c, `${t === c ? 'You are' : `${t.name} is`} dead: there is nobody to put it on.`);
      // (every thing of it is made here, so that each is one the server knows it put in the world)
      const items = kit.things.map((th) => {
        const it = makeItem(th.id, th.qty);
        if (th.mag !== undefined) it.mag = th.mag;
        if (th.loaded !== undefined) it.loaded = th.loaded;
        if (th.mods) it.mods = [...th.mods];
        if (th.rounds !== undefined) it.rounds = th.rounds;
        issue(it);
        return it;
      });
      log(`[admin] ${c.name} gave ${t === c ? 'themselves' : t.name} the ${kit.id} kit`);
      send(t, { t: 'kit', name: kit.name, items, ...(kit.adds ? { adds: true as const } : {}), ...(t === c ? {} : { by: c.name }) });
      return void sys(c, `${t === c ? 'You have' : `${t.name} has`} the ${kit.name} kit.`);
    }
    case 'heal': {
      if (!admin) return need();
      const t = who ? whoIs(who) : c;
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (!t.alive) return void sys(c, `${t === c ? 'You are' : `${t.name} is`} dead: that is past mending.`);
      t.check.hp = 100;
      t.check.hpAt = Date.now();
      t.check.downAt = 0;
      send(t, { t: 'mend' });
      if (t !== c) sys(t, 'An admin has made you whole.');
      return void sys(c, `${t === c ? 'You are' : `${t.name} is`} whole.`);
    }
    case 'slay': {
      if (!admin) return need();
      const t = whoIs(who);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (!t.alive) return void sys(c, `${t.name} is dead already.`);
      log(`[admin] ${c.name} slew ${t.name}`);
      t.lastHitBy = null;
      kill(t, 'an admin');
      return void sys(c, `${t.name} is dead.`);
    }
    case 'voidinv':
    case 'voidtag': {
      if (!admin) return need();
      const k = cmd === 'voidinv' ? 'voidInv' : 'voidTag';
      const on = rest[0] === 'on' ? true : rest[0] === 'off' ? false : !c.power[k];
      setPower(c, k, on);
      return void sys(c, k === 'voidInv' ? (on ? 'When you die, nothing you carried is left on your body.' : 'When you die, what you carried is on your body, as anybody\'s is.') : on ? 'When you die, no dog tag of your own is left.' : 'When you die, your dog tag is on your body, as anybody\'s is.');
    }
    case 'god':
    case 'vanish':
    case 'noclip': {
      if (!admin) return need();
      const k = cmd === 'god' ? 'god' : cmd === 'vanish' ? 'hidden' : 'clip';
      const on = rest[0] === 'on' ? true : rest[0] === 'off' ? false : !c.power[k];
      setPower(c, k, on);
      return void sys(c, k === 'god' ? (on ? 'Nothing hurts you now.' : 'You can be hurt again.') : k === 'hidden' ? (on ? 'Nobody sees you now: to them you have left.' : 'You can be seen again.') : on ? 'You fly, and through anything: W A S D, Space up, Ctrl down, Shift fast.' : 'You walk again.');
    }
    case 'roles':
      if (!admin) return need();
      return void sys(c, 'With a role:', ...Object.values(ADMIN.state.roles).map((r) => `${r.name}  ${r.role}  (by ${r.by}, ${r.at.slice(0, 10)})`));
    default:
      return void sys(c, `There is no /${cmd}: /help lists what there is.`);
  }
}
/** The password, typed by somebody who wants to be an admin: asked of the site, which alone knows it. */
async function login(c: Client, pw: unknown) {
  const now = Date.now();
  for (const n of namesOf(c.key, c.ip)) {
    const times = (ADMIN.tries.get(n) ?? []).filter((t) => now - t < 600000);
    if (times.length >= 5) return void sys(c, 'Too many tries: wait ten minutes.');
    times.push(now);
    ADMIN.tries.set(n, times);
  }
  if (typeof pw !== 'string' || !pw || pw.length > 200) return void sys(c, 'No password was given.');
  const r = await siteAdmin({ op: 'login', pw, key: keyHash(c.key), name: c.name });
  if (!r) return void sys(c, 'The site did not answer: try again in a minute.');
  if (!r.ok) {
    log(`[admin] ${c.name} (#${c.id}) gave a wrong admin password`);
    return void sys(c, r.why ?? 'That is not the password.');
  }
  for (const n of namesOf(c.key, c.ip)) ADMIN.tries.delete(n);
  log(`[admin] ${c.name} (#${c.id}) is an admin, by the password`);
  send(c, { t: 'role', role: 'admin' });
  sys(c, 'You are an admin, on this and every game from now on. /help lists your orders.');
}

/** Put off the server by a check (only ever when enforcing): told so, counted, and after enough of it kept off for a while. */
function putOff(c: Client, why: string) {
  const now = Date.now();
  let kept = false;
  for (const n of namesOf(c.key, c.ip)) {
    const times = (BANS.strikes.get(n) ?? []).filter((t) => now - t < 3600000);
    times.push(now);
    BANS.strikes.set(n, times);
    if (times.length >= CHECK.strikes) {
      BANS.temp.set(n, { until: now + CHECK.ban * 3600000, why });
      kept = true;
    }
  }
  log(`[check] ${c.name} is put off the server: ${why}${kept ? `; and kept off it for ${CHECK.ban} hours` : ''}`);
  send(c, { t: 'kick', reason: kept ? 'The server could not make sense of what your game told it, more than once. You are kept off it for a while.' : 'The server could not make sense of what your game told it. Reconnect.' });
  c.ws.close();
  drop(c);
}

/** How far the ground stands over the line from one player's eye to another's chest, where it stands over it at all (0: it does not, or there is no saying). */
function hillBetween(a: Pose, b: Pose): number {
  const ax = a[0], ay = a[1] + 1.5, az = a[2], bx = b[0], by = b[1] + 1.1, bz = b[2];
  const d = Math.hypot(bx - ax, bz - az);
  // (near to, the ground between two people is nothing; and under the ground, in the bunker, the ground is over everything)
  if (d < 14 || a[1] < world.groundAt(ax, az) - 2 || b[1] < world.groundAt(bx, bz) - 2) return 0;
  let over = 0;
  for (let s = 5; s < d - 5; s += 2) {
    const t = s / d;
    over = Math.max(over, world.groundAt(ax + (bx - ax) * t, az + (bz - az) * t) - (ay + (by - ay) * t));
  }
  return over > CHECK.hill ? over : 0;
}

/**
 * Whoever carries a tag they took off somebody over the line round the Zona has TAG_OUT seconds to turn back.
 * After that every such tag they carry is void: it is forgotten here (so nothing is ever paid on it), taken
 * out of this server's copy of their pockets, and they are told to take it out of their own.
 */
function zoneCheck(c: Client, now = Date.now()) {
  if (!c.alive || inPlay(c.pose[0], c.pose[2]) || !takenTag(c)) {
    c.outAt = 0;
    return;
  }
  if (!c.outAt) c.outAt = now;
  if (now - c.outAt < TAG_OUT * 1000) return;
  c.outAt = 0;
  voidTags(c, 'out of the Zona');
}

/** Every tag somebody carries that they took off another is void: forgotten here, taken out of this server's copy of their pockets, and they are told. */
function voidTags(c: Client, where: string) {
  const uids: string[] = [];
  for (const t of carriedTags(c.inv)) {
    const from = lootedTags.get(t.uid);
    if (!from || from.ownerKey === c.key) continue;
    lootedTags.delete(t.uid);
    tagSeen.delete(`${c.key}|${t.uid}`);
    voided.add(t.uid);
    uids.push(t.uid);
  }
  if (!uids.length) return;
  const gone = new Set(uids);
  const strip = (it: ItemInstance | null | undefined) => {
    if (it?.cargo) {
      it.cargo = it.cargo.filter((p) => !gone.has(p.item.uid));
      for (const p of it.cargo) strip(p.item);
    }
  };
  if (c.inv) {
    for (const [slot, it] of Object.entries(c.inv.slots)) {
      if (it && gone.has(it.uid)) (c.inv.slots as Record<string, ItemInstance | null>)[slot] = null;
      else strip(it);
    }
    // (and out of whatever else of theirs things are kept in)
    for (const cont of c.inv.containers) cont.items = cont.items.filter((it) => !gone.has((it as { uid?: string }).uid ?? ''));
  }
  send(c, { t: 'void', uids });
  log(`${c.name} carried ${uids.length} dog tag${uids.length === 1 ? '' : 's'} ${where}: void`);
}

/**
 * Under the ground (2026-10-11). Somebody sunk into the ground cannot be shot: every round at them stops in the
 * earth over them. One was found there with the tags he had taken, waiting out their ten minutes where nobody
 * could take them back. So a body that says it is more than `deep` metres under the ground, and is not down the
 * bunker (which is under the ground, and is a place), is out of the game for as long as it is there. After
 * `grace` seconds of it (a moment is let go: a lagging step, a ledge) it hits nobody, takes nothing off the
 * ground or out of a body, and cashes nothing in; after `void` seconds every tag it took is void, as tags
 * carried over the line are; after `off` it is put off the server. This is a rule of the game and not a guess
 * about anybody: it holds whatever CHECKS says. (An honest game puts its player back on the ground within two
 * seconds of finding them under it: see `Game.unbury`.)
 */
const UNDER = { deep: 1.1, grace: 3, void: 10, off: 25 };
function underCheck(c: Client, now = Date.now()) {
  const [x, y, z] = c.pose;
  const b = world.bunker;
  const down = c.alive && !c.seatAt && !c.power.clip && now >= c.check.free && y < world.groundAt(x, z) - UNDER.deep && !(b && Math.hypot(x - b.x, z - b.z) < UNDER_BUNKER);
  if (!down) {
    c.underAt = 0;
    return;
  }
  if (!c.underAt) c.underAt = now;
  const secs = (now - c.underAt) / 1000;
  if (secs < UNDER.grace) return;
  flag(c, `is ${(world.groundAt(x, z) - y).toFixed(1)} m under the ground at ${x.toFixed(0)}, ${z.toFixed(0)}, ${secs.toFixed(0)} s now`, false);
  if (secs >= UNDER.void) voidTags(c, 'under the ground');
  if (secs >= UNDER.off) putOff(c, `was under the ground for ${UNDER.off} seconds`);
}
/** how far round the bunker's middle the ground is not asked about: its rooms and its stair are under it */
const UNDER_BUNKER = 48;
/** Is somebody out of the game for being under the ground? (past the moment that is let go) */
const buried = (c: Client, now = Date.now()) => c.underAt > 0 && now - c.underAt >= UNDER.grace * 1000;

interface Client {
  ws: WebSocket;
  id: number;
  key: string;
  name: string;
  pose: Pose;
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
   * while the server kept it; and when the wait to leave properly ends (0: nobody is waiting), begun where.
   */
  heardAt: number;
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
  power: { god: boolean; hidden: boolean; clip: boolean; voidInv: boolean; voidTag: boolean };
  /** when this player last threw a grenade, and how many hits have been claimed for it */
  lastNade: number;
  nadeHits: number;
  /** the fuel drums this player has just set off, and how many hits have been claimed for each */
  blasts: { i: number; at: number; hits: number }[];
  lastEmote: number;
  lastChat: number;
  lastHitBy: { id: number; name: string; w: string; zone: HitZone; dist: number; at: number } | null;
  openCid: string | null;
  /** when they last moved, looked about or did anything (see kickIdle) */
  activeAt: number;
  joinedAt: number;
  /** where they connect from, and when the life they are living began (see notEarned) */
  ip: string;
  lifeAt: number;
  msgCount: number;
  msgWindow: number;
  /**
   * For the server's own checks (see CHECKS): when they were last where they said they were, how much going is
   * saved up, until when where they are is not questioned, how long they have been high over the ground, how
   * often a check has fired on them, when that was last written down, and when it last refused them.
   */
  check: {
    at: number; carry: number; free: number; high: number; flags: number; said: number; refused: number[];
    /** the most health they can have (see `dealt`), when that was reckoned, and since when it has been less than none (0: it is not) */
    hp: number; hpAt: number; downAt: number;
    /** things they have said they carry that the server never put in the world: each written down once */
    unknown: Set<string>;
  };
}

interface Record_ {
  pose: Pose;
  inv: SerializedInventory | null;
  vitals: Vitals | null;
  alive: boolean;
  leftAt: number;
  /** kept from a world of another making: what they carried is theirs, where they stood is not */
  afresh?: boolean;
}

const clients = new Map<number, Client>();
const records = new Map<string, Record_>();
let nextId = 1;

const send = (c: Client, m: S2C) => {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m));
};
function broadcast(m: S2C, except?: Client) {
  if (!clients.size) return;
  const s = JSON.stringify(m);
  for (const c of clients.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s);
}

const info = (c: Client): PlayerInfo => ({ id: c.id, name: c.name, pose: c.pose, w: c.w, m: c.m, g: c.g, b: c.b, alive: c.alive });

/** a spawn point on the edge of the map, as far from everyone else as possible */
function pickSpawn() {
  const others = [...clients.values()].filter((c) => c.alive);
  let best = world.spawns[Math.floor(Math.random() * world.spawns.length)];
  let bestD = -1;
  for (let k = 0; k < 8; k++) {
    const s = world.spawns[Math.floor(Math.random() * world.spawns.length)];
    const d = others.length ? Math.min(...others.map((o) => Math.hypot(o.pose[0] - s.x, o.pose[2] - s.z))) : 1e9;
    if (d > bestD) {
      bestD = d;
      best = s;
    }
  }
  // a few metres of scatter so two people never spawn inside each other
  const a = Math.random() * Math.PI * 2;
  return { x: best.x + Math.cos(a) * 3, z: best.z + Math.sin(a) * 3, yaw: best.yaw };
}

// ------------------------------------------------------------------ validation

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(num);
const isPose = (v: unknown): v is Pose => Array.isArray(v) && v.length === 6 && v.every(num) && Math.abs(v[0]) < EDGE && Math.abs(v[2]) < EDGE && Math.abs(v[1]) < 500;
const cleanName = (s: unknown) => (typeof s === 'string' ? s : '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Survivor';
const round2 = (v: number) => Math.round(v * 100) / 100;

function cleanItem(raw: unknown, depth = 0): ItemInstance | null {
  if (!raw || typeof raw !== 'object' || depth > 2) return null;
  const r = raw as ItemInstance;
  const def = ITEMS[r.id];
  if (!def || typeof r.uid !== 'string' || r.uid.length > 64) return null;
  const it: ItemInstance = { uid: r.uid, id: r.id, qty: def.stack ? Math.max(1, Math.min(def.stack, Math.floor(Number(r.qty) || 1))) : 1 };
  if (def.weapon) {
    // (how many it may really have in it is said by what feeds it: sanitizeItem holds it to that)
    it.loaded = Math.max(0, Math.min(200, Math.floor(Number(r.loaded) || 0)));
    if (Array.isArray(r.mods)) it.mods = r.mods.filter((m) => typeof m === 'string').slice(0, 6);
    // (its magazine: one it takes, or none; said by nobody, it is a gun from before magazines, and is given its own)
    if (def.weapon.mag && r.mag !== undefined) it.mag = typeof r.mag === 'string' && magFits(r.mag, r.id) ? r.mag : null;
    // (the range its sights are set for: sanitizeItem holds it to one that gun has)
    if (num(r.zero)) it.zero = r.zero;
  }
  if (def.mag) it.rounds = Math.max(0, Math.min(def.mag.capacity, Math.floor(Number(r.rounds) || 0)));
  if (def.use?.sips) it.left = Number.isFinite(Number(r.left)) ? Number(r.left) : def.use.sips;
  if (r.id === 'dogtag') {
    const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 24) : undefined);
    it.owner = cleanName(r.owner);
    it.pid = short(r.pid);
    it.holder = short(r.holder);
    it.held = Math.max(0, Math.min(TAG_HOLD, Number(r.held) || 0));
  }
  if (def.wear?.cargo && Array.isArray(r.cargo)) {
    it.cargo = [];
    for (const p of r.cargo.slice(0, 40)) {
      const inner = cleanItem(p?.item, depth + 1);
      if (inner && num(p.x) && num(p.y)) it.cargo.push({ item: inner, x: p.x, y: p.y, rot: !!p.rot });
    }
  }
  return sanitizeItem(it);
}

function cleanStored(list: unknown): StoredItem[] {
  if (!Array.isArray(list)) return [];
  const out: StoredItem[] = [];
  for (const raw of list.slice(0, 120)) {
    const it = cleanItem(raw);
    if (it && num(raw.x) && num(raw.y)) out.push({ ...it, x: raw.x, y: raw.y, rot: !!raw.rot });
  }
  return out;
}

function cleanInventory(raw: unknown): SerializedInventory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as SerializedInventory;
  const slots: Record<string, ItemInstance | null> = {};
  for (const [k, v] of Object.entries(r.slots ?? {})) if (k.length < 16) slots[k] = v ? cleanItem(v) : null;
  const containers = (Array.isArray(r.containers) ? r.containers : []).slice(0, 4).map((c) => ({ id: String(c.id).slice(0, 16), items: cleanStored(c.items) }));
  return { slots, active: null, containers };
}

// ------------------------------------------------------------------ gameplay

function releaseLock(c: Client) {
  if (c.openCid && locks.get(c.openCid) === c.id) locks.delete(c.openCid);
  c.openCid = null;
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
function voice(c: Client, piece: Buffer) {
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
function findCarried(c: Client, uid: unknown): ItemInstance | null {
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
function seatOf(c: Client): { v: Veh; seat: number } | null {
  if (!c.seatAt) return null;
  for (const v of vehicles.values()) {
    const seat = v.seats.indexOf(c.id);
    if (seat >= 0) return { v, seat };
  }
  return null;
}

/** out of whatever they are sitting in (they got out, died, or are gone) */
function leaveSeat(c: Client, gone = false) {
  const at = seatOf(c);
  // (out of a jeep that is moving, a body goes on moving)
  if (c.seatAt) c.check.free = Date.now() + CHECK.free;
  c.seatAt = 0;
  if (!at) {
    // (not in a seat, but perhaps still the one moving a jeep they got out of)
    if (gone) for (const v of vehicles.values()) if (v.sim === c.id) {
      v.sim = null;
      v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
      tellSeats(v, true);
    }
    return;
  }
  const { v, seat } = at;
  v.seats[seat] = null;
  // The game that was moving it goes on doing so until it has rolled to a stop (see 'vrest'):
  // unless that game is gone, and then it stops where it was last seen.
  if (gone && v.sim === c.id) {
    v.sim = null;
    v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
    tellSeats(v, true);
  } else tellSeats(v);
}

/** a jeep is hit: what it has left, and what follows from that */
function hurtJeep(v: Veh, amount: number, by: Client) {
  if (v.goneAt || amount <= 0) return;
  v.hp = Math.max(0, v.hp - amount);
  broadcast({ t: 'vhp', i: v.i, hp: Math.round(v.hp), by: by.id });
  if (v.hp <= 0) return blowJeep(v, by.id);
  // on fire: it goes up in a few seconds, and everybody in it knows it
  if (v.hp <= JEEP.hp * JEEP.fireAt && !v.burnAt) {
    v.burnAt = Date.now() + JEEP.fuse * 1000;
    v.by = by.id;
  }
}

function blowJeep(v: Veh, byId: number) {
  if (v.goneAt) return;
  const now = Date.now();
  v.hp = 0;
  v.burnAt = 0;
  v.goneAt = now + 120_000;
  jeepsDue.set(v.home, now + (Number(process.env.JEEP_RESPAWN_S) || JEEP.respawn) * 1000);
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
  v.seats = Array(SEATS).fill(null);
  v.sim = null;
  v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
  tellSeats(v, true);
  log(`jeep #${v.i} burned out${by ? ` (${by.name})` : ''}`);
}

/** everything a character carried goes into a body that can be searched for a while */
function makeCorpse(c: Client, v: number): CorpseInfo | null {
  const inv = c.inv;
  const [x, , z, yaw] = c.pose;
  const y = c.pose[1];
  const uid = `corpse_${c.id}_${Date.now().toString(36)}`;
  const box = new Container(uid, 'Body', 8, 10, [], true);
  const spill: ItemInstance[] = [];
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
  // (and an admin who has chosen so leaves no tag of their own either, however long they lived; or nothing at all
  // of what they carried but the tags they took off other people)
  const noTag = fresh || c.power.voidTag, bare = c.power.voidInv;
  /** a tag that is on a body whoever's body it is: one taken off somebody else */
  const taken = (t: ItemInstance) => {
    const from = lootedTags.get(t.uid);
    return !!from && from.ownerKey !== c.key;
  };
  let older = 0;
  const theirs = (it: ItemInstance) => {
    if (it.id !== 'dogtag' || taken(it)) return false;
    if (lootedTags.delete(it.uid)) older++;
    return true;
  };
  const put = (it: ItemInstance | null) => {
    if (!it || (noTag && theirs(it)) || (bare && it.id !== 'dogtag')) return;
    if (noTag && it.cargo) it.cargo = it.cargo.filter((p) => !theirs(p.item));
    stopTagClocks(it);
    const left = box.add(it);
    if (left) spill.push(left);
  };
  if (inv) {
    for (const it of Object.values(inv.slots)) put(it);
    for (const cont of inv.containers) for (const s of cont.items) put(cleanItem(s));
    if (own && !noTag) lootedTags.set(own.uid, { owner: c.name, ownerKey: c.key, ownerIp: c.ip, livedMs: lived });
    else if (own || older) {
      log(`${c.name} left no dog tag: ${fresh ? `alive ${Math.round(lived / 1000)} s` : 'an admin, who chose so'}${older ? ` (nor ${older} older of their own, taken back)` : ''}`);
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
  boxes.set(uid, { cid: uid, kind: 'corpse', w: 8, h: 10, items: box.serialize().items, x, y, z, rot: yaw, emptiedAt: -1, name: c.name, expires: economy.time + CORPSE_LIFETIME, v });
  return { uid, x, y, z, rot: yaw, name: c.name, v };
}

function kill(c: Client, cause: string, v = 0) {
  if (!c.alive) return;
  c.alive = false;
  c.logoutAt = 0;
  // (a body left behind has nobody to come back to it: it is out of the world once it has fallen)
  if (c.asleep) setTimeout(() => drop(c), 3000);
  releaseLock(c);
  leaveSeat(c);
  const now = Date.now();
  const by = c.lastHitBy && now - c.lastHitBy.at < 15000 ? c.lastHitBy : null;
  const k: KillInfo = { id: c.id, name: c.name, by: by?.id ?? null, byName: by?.name ?? null, w: by?.w ?? cause, zone: by?.zone ?? null, dist: Math.round(by?.dist ?? 0), v };
  const corpse = makeCorpse(c, v);
  for (const k of [...tagSeen.keys()]) if (k.startsWith(`${c.key}|`)) tagSeen.delete(k);
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

function handle(c: Client, m: C2S) {
  // anything a person does counts as being there; what the game reports on its own does not
  if (m.t !== 's' && m.t !== 'me' && m.t !== 'ping' && m.t !== 'gear' && m.t !== 'back') c.activeAt = Date.now();
  switch (m.t) {
    case 's': {
      if (!isPose(m.p)) return;
      // (a step, or a turn of the head)
      const was = c.pose;
      if (Math.abs(m.p[0] - was[0]) + Math.abs(m.p[2] - was[2]) > 0.02 || Math.abs(m.p[3] - was[3]) + Math.abs(m.p[4] - was[4]) > 0.004) c.activeAt = Date.now();
      // (somewhere they cannot have got to: they are kept where they were, and only the way they look is taken)
      // (heard from again after the server kept their life for them: its figure is the figure)
      if (c.kept) {
        c.kept = false;
        c.bled = 0;
        if (c.alive && c.vitals) send(c, { t: 'hp', health: c.vitals.health, bleeding: !!c.vitals.bleeding });
      }
      c.heardAt = Date.now();
      if (c.logoutAt && Math.hypot(m.p[0] - c.logoutFrom[0], m.p[2] - c.logoutFrom[1]) > LOGOUT_STIR) stayOn(c, 'you moved');
      c.pose = moveCheck(c, m.p, Date.now()) ? m.p : [was[0], was[1], was[2], m.p[3], m.p[4], m.p[5]];
      // (dead here is dead in what is passed on, whatever their own game had heard when it sent this)
      if (!c.alive) c.pose[5] |= F_DEAD;
      zoneCheck(c);
      underCheck(c);
      const w = typeof m.w === 'string' && ITEMS[m.w] ? m.w : null;
      c.w = w;
      c.m = Array.isArray(m.m) ? m.m.filter((x) => typeof x === 'string').slice(0, 4) : [];
      return;
    }
    case 'shot': {
      if (!c.alive || !isVec3(m.o) || !isVec3(m.d) || !WEAPON_RULES[m.w] || WEAPON_RULES[m.w].melee) return;
      stayOn(c, 'you fired');
      broadcast({ t: 'shot', id: c.id, o: m.o, d: m.d, w: m.w, sup: !!m.sup }, c);
      return;
    }
    case 'swing': {
      if (c.alive) broadcast({ t: 'swing', id: c.id }, c);
      return;
    }
    case 'nade': {
      if (!c.alive || !isVec3(m.o) || !isVec3(m.v)) return;
      // it has to leave from where the thrower is, at a speed an arm can give it
      if (Math.hypot(m.o[0] - c.pose[0], m.o[2] - c.pose[2]) > 4 || Math.hypot(...m.v) > 40) return;
      c.lastNade = Date.now();
      c.nadeHits = 0;
      broadcast({ t: 'nade', id: c.id, o: m.o, v: m.v }, c);
      return;
    }
    case 'bunker': {
      // a keycard at the door, by somebody standing at it (the card is theirs to use up: what they carry is their own game's to say)
      const d = world.bunkerDoor;
      if (!c.alive || !d || Math.hypot(c.pose[0] - d[0], c.pose[1] - d[1], c.pose[2] - d[2]) > 6) return;
      bunkerDoor.emptyAt = Date.now();
      if (bunkerDoor.open) return;
      bunkerDoor.open = true;
      broadcast({ t: 'bunker', open: true });
      return;
    }
    case 'fire': {
      // lit by somebody standing beside it (a couple of metres' grace: where they are is told a moment late)
      if (!c.alive || !hearths.light(m.i, c.pose[0], c.pose[2], Date.now() / 1000, 2.5)) return;
      broadcast({ t: 'fire', i: m.i, left: FIRE.burns });
      return;
    }
    case 'barrel': {
      const b = world.barrels[m.i];
      if (!c.alive || !Number.isInteger(m.i) || !b || barrelsGone.has(m.i)) return;
      const now = Date.now();
      c.blasts = c.blasts.filter((q) => now - q.at < 5000);
      // a bullet's reach, or the next drum along from one of theirs that has just gone up
      const near = Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) < WEAPON_RULES.barrel.range;
      const chained = c.blasts.some((q) => Math.hypot(world.barrels[q.i].x - b.x, world.barrels[q.i].y - b.y, world.barrels[q.i].z - b.z) < WEAPON_RULES.barrel.blast! + 1);
      if ((!near && !chained) || c.blasts.length >= 12) return;
      barrelsGone.set(m.i, now + BARREL_RESPAWN * 1000);
      c.blasts.push({ i: m.i, at: now, hits: 0 });
      broadcast({ t: 'boom', i: m.i, by: c.id }, c);
      return;
    }
    case 'emote': {
      const e = EMOTE[m.e];
      const now = Date.now();
      if (!c.alive || !e?.say || now - c.lastEmote < EMOTE_GAP * 800) return;
      c.lastEmote = now;
      // a voice carries so far and no further
      const s = JSON.stringify({ t: 'emote', id: c.id, e: e.id } satisfies S2C);
      for (const o of clients.values()) {
        if (o !== c && o.ws.readyState === 1 && Math.hypot(o.pose[0] - c.pose[0], o.pose[1] - c.pose[1], o.pose[2] - c.pose[2]) < SHOUT_RANGE) o.ws.send(s);
      }
      return;
    }
    case 'act': {
      if (!c.alive || !ACTS.includes(m.a)) return;
      broadcast({ t: 'act', id: c.id, a: m.a, d: num(m.d) ? Math.max(0, Math.min(12, m.d)) : 1 }, c);
      return;
    }
    case 'gear': {
      // only things that are worn, and only as many as there are places to wear them
      c.g = (Array.isArray(m.g) ? m.g : []).filter((x) => typeof x === 'string' && !!ITEMS[x]?.wear).slice(0, 6);
      broadcast({ t: 'gear', id: c.id, g: c.g }, c);
      return;
    }
    case 'back': {
      // what is slung on a back: two places, a gun or a thing to hit with in each, and only things fitted to it
      c.b = (Array.isArray(m.b) ? m.b : [])
        .filter((e) => Array.isArray(e) && typeof e[0] === 'string' && !!(ITEMS[e[0]]?.weapon || ITEMS[e[0]]?.melee))
        .slice(0, 2)
        .map((e): Slung => [e[0], (Array.isArray(e[1]) ? e[1] : []).filter((x) => typeof x === 'string' && !!(ITEMS[x]?.attach || ITEMS[x]?.mag)).slice(0, 8)]);
      broadcast({ t: 'back', id: c.id, b: c.b }, c);
      return;
    }
    case 'hit': {
      const target = clients.get(m.to);
      const rule = WEAPON_RULES[m.w];
      if (!target || !target.alive || !c.alive || !rule || target === c) return;
      if (!['head', 'torso', 'legs'].includes(m.zone)) return;
      const now = Date.now();
      // (nobody is hit from under the ground: see UNDER)
      if (buried(c, now)) return;
      const d = Math.hypot(c.pose[0] - target.pose[0], c.pose[1] - target.pose[1], c.pose[2] - target.pose[2]);
      if (d > rule.range + 4) return;
      let amount: number;
      /** where it came from, for the one who is hit: the shooter, or whatever went off */
      let from: [number, number] = [c.pose[0], c.pose[2]];
      if (m.w === 'barrel') {
        // a drum they set off in the last moments, near enough to the one it is said to have reached
        const reach = rule.blast! + 1.5;
        let best: { q: (typeof c.blasts)[number]; d: number } | null = null;
        for (const q of c.blasts) {
          const b = world.barrels[q.i];
          const bd = Math.hypot(b.x - target.pose[0], b.y + BARREL.centre - (target.pose[1] + 1.1), b.z - target.pose[2]);
          if (now - q.at < 4000 && bd < reach && (!best || bd < best.d)) best = { q, d: bd };
        }
        if (!best || ++best.q.hits > 12 || !num(m.dist)) return;
        // the game says how far off they were; it is not believed by more than a couple of metres
        amount = hitDamage(m.w, 'torso', Math.max(0, m.dist, best.d - 2));
        m.zone = 'torso';
        from = [world.barrels[best.q.i].x, world.barrels[best.q.i].z];
      } else if (rule.blast) {
        // a grenade is not held when it goes off: it has to have been thrown in the last few
        // seconds, and one grenade only reaches so many people
        if (now - c.lastNade > 9000 || ++c.nadeHits > 12 || !num(m.dist)) return;
        amount = hitDamage(m.w, 'torso', Math.max(0, m.dist));
        m.zone = 'torso';
      } else if (m.w === 'jeep') {
        // run down: by whoever is at the wheel of a jeep that is right there, going fast enough
        const at = seatOf(c);
        if (!at || at.seat !== 0 || !num(m.dist) || now - c.lastHit < rule.interval * 1000) return;
        if (Math.hypot(at.v.s[0] - target.pose[0], at.v.s[2] - target.pose[2]) > 7) return;
        c.lastHit = now;
        const speed = Math.min(m.dist, Math.hypot(at.v.s[7], at.v.s[8], at.v.s[9]) + 3);
        amount = Math.max(0, speed - JEEP.bumpFrom) * JEEP.bumpPer;
        m.zone = 'torso';
      } else {
        // you can only hit with what you are holding (fists are always there)
        if (m.w !== 'fists' && c.w !== m.w) return;
        if (now - c.lastHit < rule.interval * 700) return;
        // (and what is held has to be in the pockets the server knows of: an invented gun is in nobody's)
        if (m.w !== 'fists' && CHECKS !== 'off' && c.inv && !carries(c.inv, m.w) && flag(c, `hit ${target.name} with ${ITEMS[m.w]?.name ?? m.w}, which is not in their pockets`)) return;
        // (a round does not go through a hill)
        const hill = rule.melee || CHECKS === 'off' ? 0 : hillBetween(c.pose, target.pose);
        if (hill && flag(c, `shot ${target.name} through ${hill.toFixed(1)} m of hill at ${Math.round(d)} m`)) return;
        c.lastHit = now;
        amount = hitDamage(m.w, m.zone, d, !!m.sup, num(m.bonus) ? m.bonus : 0, num(m.n) ? m.n : 1);
      }
      if (amount <= 0) return;
      const len = Math.max(0.001, Math.hypot(target.pose[0] - from[0], target.pose[2] - from[1]));
      if (target.power.god) return;
      target.lastHitBy = { id: c.id, name: c.name, w: m.w, zone: m.zone, dist: d, at: now };
      dealt(target, amount, m.zone, m.w);
      send(target, { t: 'dmg', from: c.id, amount, zone: m.zone, w: m.w, dir: [(target.pose[0] - from[0]) / len, 0, (target.pose[2] - from[1]) / len] });
      send(c, { t: 'hitok', to: target.id, amount, zone: m.zone });
      return;
    }
    case 'is': {
      // where the infected this player's game moves have got to: passed on to everybody else
      const s = horde.report(c.id, m.s, Date.now());
      if (s.length) broadcast({ t: 'is', s }, c);
      return;
    }
    case 'ihit': {
      const b = horde.bodies.get(m.i);
      const rule = WEAPON_RULES[m.w];
      if (!b || b.diedAt || !c.alive || !rule || m.w === 'infected') return;
      if (!['head', 'torso', 'legs'].includes(m.zone)) return;
      const now = Date.now();
      const d = Math.hypot(c.pose[0] - b.s[0], c.pose[1] - b.s[1], c.pose[2] - b.s[2]);
      if (d > rule.range + 6) return;
      let amount: number;
      if (rule.blast) {
        // something of theirs went off in the last few seconds: a grenade thrown, or a drum set off
        const since = m.w === 'grenade' ? now - c.lastNade : Math.min(...c.blasts.map((q) => now - q.at), Infinity);
        if (since > 9000 || !num(m.dist)) return;
        amount = hitDamage(m.w, 'torso', Math.max(0, m.dist));
        m.zone = 'torso';
      } else if (m.w === 'jeep') {
        // run down, by whoever is at the wheel of a jeep that is right there
        const at = seatOf(c);
        if (!at || at.seat !== 0 || !num(m.dist) || Math.hypot(at.v.s[0] - b.s[0], at.v.s[2] - b.s[2]) > 7) return;
        amount = Math.max(0, Math.min(m.dist, Math.hypot(at.v.s[7], at.v.s[8], at.v.s[9]) + 3) - JEEP.bumpFrom) * JEEP.bumpPer;
        m.zone = 'torso';
      } else {
        if (m.w !== 'fists' && c.w !== m.w) return;
        if (now - c.lastHit < rule.interval * 700) return;
        c.lastHit = now;
        amount = hitDamage(m.w, m.zone, d, !!m.sup, num(m.bonus) ? m.bonus : 0, num(m.n) ? m.n : 1);
      }
      const r = horde.hurt(m.i, amount, now);
      if (!r) return;
      if (r.dead) {
        // what it had on it falls where it does
        const had = infectedDrop();
        if (had) economy.drop(makeItem(had[0], had[1]), b.s[0] + (Math.random() - 0.5) * 0.8, b.s[1] + 0.03, b.s[2] + (Math.random() - 0.5) * 0.8, Math.random() * Math.PI * 2);
      }
      const len = Math.max(0.001, Math.hypot(b.s[0] - c.pose[0], b.s[2] - c.pose[2]));
      broadcast({ t: 'ihp', i: m.i, hp: r.hp, dead: r.dead, by: c.id, zone: m.zone, dir: [(b.s[0] - c.pose[0]) / len, (b.s[2] - c.pose[2]) / len], melee: !!rule.melee && !rule.blast });
      return;
    }
    case 'iatk': {
      // one of them that this player's game moves has struck somebody (as likely as not, this player)
      const target = clients.get(m.to);
      const b = horde.bodies.get(m.i);
      if (!b || !target?.alive) return;
      if (!horde.strikes(m.i, c.id, { id: target.id, x: target.pose[0], z: target.pose[2] }, Date.now())) return;
      // On guard (fists, or something in the hand to strike with), facing it, with the wind to
      // hold it off: nothing lands, and the one that threw it is stopped for a moment.
      const hands = target.w === null || WEAPON_RULES[target.w]?.melee;
      if (target.pose[5] & F_GUARD && hands && (target.vitals?.stamina ?? MAX_STAMINA) >= INFECTED.guardCost && guarded(target.pose[0], target.pose[2], target.pose[3], b.s[0], b.s[2])) {
        if (target.vitals) target.vitals.stamina -= INFECTED.guardCost;
        broadcast({ t: 'iblk', i: m.i, to: target.id });
        return;
      }
      const len = Math.max(0.001, Math.hypot(target.pose[0] - b.s[0], target.pose[2] - b.s[2]));
      if (target.power.god) return;
      const bite = INFECTED.damage + Math.round((Math.random() - 0.5) * 6);
      dealt(target, bite, 'torso', 'infected');
      send(target, { t: 'dmg', from: 0, amount: bite, zone: 'torso', w: 'infected', dir: [(target.pose[0] - b.s[0]) / len, 0, (target.pose[2] - b.s[2]) / len] });
      return;
    }
    case 'radio': {
      // a field radio keyed: one aircraft, so one call in five minutes, whoever makes it
      if (!c.alive) return;
      const wait = Math.ceil(lastCall + CALL.every - economy.time);
      if (wait > 0) {
        send(c, { t: 'radio-', why: `No aircraft to send: one went out a moment ago. Try again in ${wait} s.` });
        return;
      }
      lastCall = economy.time;
      // (three paces in front of the caller: where they stand is where they may still be standing when it lands)
      const at = { x: c.pose[0] - Math.sin(c.pose[3]) * CALL.ahead, y: c.pose[1], z: c.pose[2] - Math.cos(c.pose[3]) * CALL.ahead };
      broadcast({ t: 'radio+', by: c.id, x: at.x, z: at.z, eta: CALL.eta });
      setTimeout(() => spawnDrop(at), CALL.eta * 1000);
      log(`${c.name} called a supply drop to ${Math.round(at.x)}, ${Math.round(at.z)}`);
      return;
    }
    case 'take': {
      if (typeof m.uid !== 'string' || !c.alive) return;
      // (nothing is picked up from under the ground)
      if (buried(c)) {
        send(c, { t: 'denied', uid: m.uid });
        return;
      }
      // first request wins; the economy's despawn event tells everyone it is gone
      // (and nobody reaches the ground from a jeep's seat)
      const lying = economy.loot.get(m.uid);
      const far = lying && CHECKS !== 'off' ? Math.hypot(lying.x - c.pose[0], lying.z - c.pose[2]) : 0;
      if (lying && far > CHECK.reach && flag(c, `took ${ITEMS[lying.item.id]?.name ?? lying.item.id} from ${Math.round(far)} m away`)) {
        send(c, { t: 'denied', uid: m.uid });
        return;
      }
      if (c.seatAt || !economy.take(m.uid)) send(c, { t: 'denied', uid: m.uid });
      return;
    }
    case 'drop': {
      const l = m.l;
      const item = cleanItem(l?.item);
      if (!item || !num(l.x) || !num(l.y) || !num(l.z) || !num(l.rot) || economy.loot.has(item.uid)) return;
      if (Math.hypot(l.x - c.pose[0], l.z - c.pose[2]) > 12) return;
      if (CHECKS !== 'off' && [...things({ slots: { it: item }, active: null, containers: [] })].some(invented) && flag(c, `put down ${ITEMS[item.id].name}, which the server never put in the world`)) return;
      economy.drop(item, l.x, l.y, l.z, l.rot);
      return;
    }
    case 'copen': {
      const b = boxes.get(m.cid);
      // (a body, a crate, a stash, a drop: none of them is searched from a jeep's seat)
      if (!b || !c.alive || c.seatAt || buried(c) || b.buried) return;
      if (Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) > 6) return;
      const holder = locks.get(m.cid);
      if (holder !== undefined && holder !== c.id && clients.has(holder)) {
        send(c, { t: 'cbusy', cid: m.cid });
        return;
      }
      releaseLock(c);
      locks.set(m.cid, c.id);
      c.openCid = m.cid;
      send(c, { t: 'cdata', cid: m.cid, items: b.items });
      return;
    }
    case 'cset': {
      const b = boxes.get(m.cid);
      if (!b || locks.get(m.cid) !== c.id || c.seatAt) return;
      b.items = cleanStored(m.items);
      if (CHECKS !== 'off') {
        const made = b.items.filter((it) => [...things({ slots: { it }, active: null, containers: [] })].some(invented));
        if (made.length && flag(c, `stored ${ITEMS[made[0].id].name}, which the server never put in the world`)) b.items = b.items.filter((it) => !made.includes(it));
        // (let through, it is in the world from now on: it is whoever brought it that was asked)
        for (const it of b.items) issue(it);
      }
      if (b.kind === 'crate' || b.kind === 'drop') b.emptiedAt = b.items.length ? -1 : b.emptiedAt < 0 ? economy.time : b.emptiedAt;
      return;
    }
    case 'cclose': {
      if (c.openCid === m.cid) releaseLock(c);
      return;
    }
    case 'stash+': {
      const s = m.s;
      if (!s || typeof s.uid !== 'string' || s.uid.length > 64 || boxes.has(s.uid) || ![s.x, s.y, s.z, s.rot].every(num)) return;
      if (!c.alive || Math.hypot(s.x - c.pose[0], s.z - c.pose[2]) > 8) return;
      // (the stash case, the suitcase or the black bag: each as big inside as it is, and put down empty)
      const def = ITEMS[String(s.item ?? 'stash_kit')];
      if (def?.category !== 'stash') return;
      const [w, h] = def.stash ?? [8, 6];
      const st: StashInfo = { uid: s.uid, x: s.x, y: s.y, z: s.z, rot: s.rot, ...(def.id === 'stash_kit' ? {} : { item: def.id }) };
      boxes.set(s.uid, { cid: s.uid, kind: 'stash', w, h, items: [], ...st, emptiedAt: -1 });
      KEPT.dirty = true;
      broadcast({ t: 'stash+', s: st }, c);
      return;
    }
    case 'stash-': {
      // picked up, when it is empty. Not from under the ground, and not from across a field.
      const b = boxes.get(m.uid);
      if (!b || b.kind !== 'stash' || b.buried || !c.alive || b.items.length) return;
      if (Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) > 6) return;
      const holder = locks.get(m.uid);
      if (holder !== undefined && holder !== c.id && clients.has(holder)) return;
      locks.delete(m.uid);
      boxes.delete(m.uid);
      KEPT.dirty = true;
      // (it is theirs when the server says so, and nobody else's: two who reached for it at once do not both carry it off)
      send(c, { t: 'stashgot', uid: m.uid, item: b.item ?? 'stash_kit' });
      broadcast({ t: 'stash-', uid: m.uid }, c);
      return;
    }
    case 'bury': {
      // A shovel in the hands, beside a stash: it goes under the ground, or comes up out of it. Anybody's shovel
      // brings up anybody's stash; it is the finding of the place that keeps it.
      const b = boxes.get(m.uid);
      if (!b || b.kind !== 'stash' || !c.alive || c.seatAt || !!b.buried === !!m.on) return;
      if (c.w !== 'shovel' || Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) > BURY.reach) return;
      const holder = locks.get(m.uid);
      if (holder !== undefined && holder !== c.id && clients.has(holder)) return void send(c, { t: 'tell', kind: 'warn', text: 'Somebody has it open.' });
      // (out in the country and nowhere else: not in a town or a camp, not in a building, not beside one)
      const no = m.on ? noBurying(b.x, b.y, b.z, world.groundAt(b.x, b.z), world.places, world.buildings) : null;
      if (no) return void send(c, { t: 'tell', kind: 'warn', text: `${no}.` });
      locks.delete(m.uid);
      if (c.openCid === m.uid) c.openCid = null;
      b.buried = !!m.on;
      KEPT.dirty = true;
      log(`${c.name} ${b.buried ? 'buried' : 'dug up'} a stash at ${b.x.toFixed(0)}, ${b.z.toFixed(0)}`);
      broadcast({ t: 'stash~', uid: m.uid, buried: b.buried });
      return;
    }
    case 'door': {
      if (!num(m.i) || m.i < 0 || m.i >= world.doorCount) return;
      const swing = m.swing > 0 ? 1 : -1;
      doors.set(m.i, [!!m.open, swing]);
      broadcast({ t: 'door', i: m.i, open: !!m.open, swing }, c);
      return;
    }
    case 'me': {
      if (!c.alive) return;
      c.inv = cleanInventory(m.inv);
      pockets(c);
      // the clock on a looted tag starts the first time the server sees it in somebody else's pockets
      for (const t of carriedTags(c.inv)) {
        const from = lootedTags.get(t.uid);
        if (from && from.ownerKey !== c.key && !tagSeen.has(`${c.key}|${t.uid}`)) tagSeen.set(`${c.key}|${t.uid}`, Date.now());
      }
      // (there is no honest way to come by one in a seat: see 'take' and 'copen')
      if (c.seatAt && takenTag(c)) {
        leaveSeat(c);
        send(c, { t: 'tell', kind: 'warn', text: JEEP.noTag });
      }
      const v = m.vitals;
      // (less health than the server allowed them is taken at their word; more is not)
      if (v && num(v.health)) c.check.hp = Math.min(c.check.hp, Math.max(0, v.health) + 1);
      // (and while the server is keeping their life for them, what their game says puts no health back)
      const held = c.kept && c.vitals ? c.vitals : null;
      if (v && num(v.health) && num(v.energy) && num(v.water)) c.vitals = { health: held ? Math.min(held.health, v.health) : v.health, energy: v.energy, water: v.water, stamina: num(v.stamina) ? v.stamina : MAX_STAMINA, bleeding: held ? held.bleeding || !!v.bleeding : !!v.bleeding, broken: !!v.broken };
      return;
    }
    case 'died': {
      kill(c, typeof m.cause === 'string' ? m.cause.slice(0, 24) : 'unknown', num(m.v) ? Math.max(0, Math.min(2, Math.floor(m.v))) : 0);
      return;
    }
    case 'respawn': {
      if (c.alive) return;
      const sp = pickSpawn();
      c.alive = true;
      c.lifeAt = Date.now();
      c.inv = null;
      c.vitals = null;
      c.pose = [sp.x, world.groundAt(sp.x, sp.z), sp.z, sp.yaw, 0, 0];
      c.check.free = Date.now() + CHECK.free;
      c.check.hp = 100;
      c.check.hpAt = Date.now();
      c.check.downAt = 0;
      send(c, { t: 'spawn', ...sp });
      broadcast({ t: 'alive', id: c.id }, c);
      return;
    }
    case 'chat': {
      const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
      const now = Date.now();
      if (!text || now - c.lastChat < 500) return;
      c.lastChat = now;
      // (an order, and never talk: whatever begins with a stroke is said to nobody and is not written down)
      if (text.startsWith('/')) return void command(c, text).catch((e) => log('[admin] an order failed:', e instanceof Error ? e.message : e));
      const quiet = ADMIN.muted.get(c.key) ?? 0;
      if (quiet > now) return void sys(c, `You are muted for ${Math.ceil((quiet - now) / 60000)} more minutes: what you type and say reaches nobody.`);
      if (m.ch === 'near') {
        // proximity: only players standing within earshot get it (the speaker included)
        const out: S2C = { t: 'chat', ch: 'near', from: c.name, text, role: roleOf(c) ?? undefined };
        for (const o of clients.values()) {
          if (Math.hypot(o.pose[0] - c.pose[0], o.pose[1] - c.pose[1], o.pose[2] - c.pose[2]) <= CHAT_RANGE) send(o, out);
        }
      } else broadcast({ t: 'chat', ch: 'global', from: c.name, text, role: roleOf(c) ?? undefined });
      return;
    }
    case 'admin':
      return void login(c, m.pw).catch(() => sys(c, 'The site did not answer: try again in a minute.'));
    case 'logout': {
      if (m.cancel) return void stayOn(c, 'you called it off');
      if (!c.alive || c.logoutAt) return;
      c.logoutAt = Date.now() + LOGOUT_MS;
      c.logoutFrom = [c.pose[0], c.pose[2]];
      return void send(c, { t: 'logout', left: Math.round(LOGOUT_MS / 1000) });
    }
    case 'adm': {
      const role = roleOf(c), now = Date.now();
      if (!role || now - (ADMIN.asked.get(c.id) ?? 0) < 600) return;
      ADMIN.asked.set(c.id, now);
      const admin = role === 'admin';
      return void send(c, {
        t: 'adm',
        players: [...clients.values()].map((o) => ({
          id: o.id, name: o.name, role: roleOf(o), x: Math.round(o.pose[0]), z: Math.round(o.pose[2]), alive: o.alive, flags: o.check.flags, mins: Math.round((now - o.joinedAt) / 60000),
          ...(o.power.hidden ? { hidden: true as const } : {}), ...(o.power.god ? { god: true as const } : {}), ...(o.power.clip ? { clip: true as const } : {}),
          ...((ADMIN.muted.get(o.key) ?? 0) > now ? { muted: true as const } : {}), ...(o.seatAt ? { seat: true as const } : {}),
          ...(o.asleep ? { asleep: true as const } : away(o, now) && o.alive ? { away: true as const } : {}),
        })),
        gone: ADMIN.gone.slice(-20).reverse().map((g) => ({ id: g.id, name: g.name, mins: Math.round((now - g.at) / 60000) })),
        bans: admin ? ADMIN.state.bans.map((b, i) => ({ n: i + 1, name: b.name, why: b.why, by: b.by, at: b.at.slice(0, 10) })) : [],
        roles: admin ? Object.values(ADMIN.state.roles).map((r) => ({ name: r.name, role: r.role, by: r.by, at: r.at.slice(0, 10) })) : [],
        checks: CHECKS,
      });
    }
    case 'vin': {
      const v = vehicles.get(m.i);
      if (!v || !c.alive || v.goneAt || c.seatAt || !Number.isInteger(m.seat) || m.seat < 0 || m.seat >= SEATS || v.seats[m.seat] !== null) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[1] - v.s[1], c.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      // A tag taken off somebody is carried on foot, for ten minutes, with the map showing
      // everybody where: not driven round in circles.
      if (takenTag(c) || carries(c.inv, 'keycard')) {
        send(c, { t: 'tell', kind: 'warn', text: JEEP.noTag });
        return;
      }
      // (and whatever they were searching is shut: nothing is searched from a seat)
      releaseLock(c);
      v.seats[m.seat] = c.id;
      c.seatAt = Date.now();
      c.check.free = Date.now() + CHECK.free;
      // whoever takes the wheel moves it from now on; a passenger changes nothing about that
      if (m.seat === 0) {
        v.sim = c.id;
        v.heard = Date.now();
      }
      tellSeats(v);
      return;
    }
    case 'vout': {
      leaveSeat(c);
      return;
    }
    case 'v': {
      const v = vehicles.get(m.i);
      if (!v || v.sim !== c.id || v.goneAt || !isVState(m.s) || !num(m.at)) return;
      const now = Date.now();
      // passed straight on, not held for the next tick: every wait here is a wobble there
      broadcast({ t: 'vs', s: [[v.i, m.at, ...m.s]] }, c);
      // what the engine burns: flat out for a minute is JEEP.burn litres
      if (v.seats[0] === c.id && v.fuel > 0) {
        const had = v.fuel;
        v.fuel = Math.max(0, v.fuel - (Math.abs(m.s[11]) * JEEP.burn * Math.min(1, (now - v.heard) / 1000)) / 60);
        if (Math.floor(had) !== Math.floor(v.fuel) || !v.fuel) broadcast({ t: 'vfuel', i: v.i, fuel: Math.round(v.fuel * 10) / 10 });
      }
      v.s = m.s;
      v.heard = now;
      return;
    }
    case 'vrest': {
      const v = vehicles.get(m.i);
      if (!v || v.sim !== c.id || !isVState(m.s)) return;
      v.s = [m.s[0], m.s[1], m.s[2], m.s[3], m.s[4], m.s[5], m.s[6], 0, 0, 0, 0, 0];
      // (with somebody still at the wheel it is only standing, not left)
      if (v.seats[0] === c.id) return;
      v.sim = null;
      tellSeats(v, true);
      return;
    }
    case 'vflip': {
      const v = vehicles.get(m.i);
      if (!v || !c.alive || v.goneAt || v.sim !== null || v.seats.some((s) => s !== null)) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      // their game stands it up and lets it settle, then hands it back (see 'vrest')
      v.sim = c.id;
      v.heard = Date.now();
      tellSeats(v);
      return;
    }
    case 'vhit': {
      const v = vehicles.get(m.i);
      const rule = WEAPON_RULES[m.w];
      if (!v || !c.alive || !rule || rule.melee || v.goneAt) return;
      const now = Date.now();
      const d = Math.hypot(c.pose[0] - v.s[0], c.pose[1] - v.s[1], c.pose[2] - v.s[2]);
      if (d > rule.range + 6) return;
      let amount = rule.damage;
      if (rule.blast) {
        // a grenade thrown or a drum set off in the last moments, near enough to reach it
        const recent = m.w === 'barrel' ? c.blasts.some((q) => now - q.at < 4000) : now - c.lastNade < 9000;
        if (!recent) return;
        amount = rule.damage * 2;
      } else {
        if (c.w !== m.w || now - c.lastVHit < rule.interval * 700) return;
      }
      c.lastVHit = now;
      hurtJeep(v, amount, c);
      return;
    }
    case 'vcrash': {
      const v = vehicles.get(m.i);
      if (!v || v.sim !== c.id || v.goneAt || !num(m.n) || m.n <= 0) return;
      // the jeep takes it first; from a real smash, so does everybody in it
      const cost = crashDamage(Math.min(40, m.n));
      const riders = v.seats.slice();
      hurtJeep(v, cost.jeep, c);
      if (cost.people > 0) {
        for (const id of riders) {
          const o = id === null ? undefined : clients.get(id);
          if (!o?.alive || o.power.god) continue;
          dealt(o, cost.people, 'torso', 'crash');
          send(o, { t: 'dmg', from: 0, amount: cost.people, zone: 'torso', w: 'crash', dir: [0, 0, 0] });
        }
      }
      return;
    }
    case 'vfuel': {
      const v = vehicles.get(m.i);
      if (!v || !c.alive || v.goneAt || v.fuel >= JEEP.tank - 0.5) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      v.fuel = Math.min(JEEP.tank, v.fuel + JEEP.can);
      broadcast({ t: 'vfuel', i: v.i, fuel: Math.round(v.fuel * 10) / 10 });
      return;
    }
    case 'cash': {
      // the tag has to be one this player really carries, with its time (nearly) served:
      // our copy of their inventory is a few seconds behind theirs
      const tag = findCarried(c, m.uid);
      const seenAt = tag ? tagSeen.get(`${c.key}|${tag.uid}`) : undefined;
      if (!tag || tag.id !== 'dogtag' || ((tag.held ?? 0) < TAG_HOLD - 30 && !(seenAt !== undefined && Date.now() - seenAt >= CASH_HOLD_MS))) return;
      // (nothing is earned by somebody nothing can hurt, nobody can see, or no wall stops)
      if (c.power.god || c.power.hidden || c.power.clip) return void sys(c, 'No tag is cashed in with god mode, vanish or noclip on: put them off first.');
      tag.held = 0;
      const owner = tag.owner ?? 'Survivor';
      const from = lootedTags.get(tag.uid);
      const now = Date.now();
      // (a tag this server did not see taken: it has restarted since, and no longer knows whose pockets it came out of)
      const why = buried(c, now) ? 'it was cashed in from under the ground' : voided.has(tag.uid) ? 'it was carried out of the Zona or under the ground' : from ? notEarned(c, from, tagSeen.get(`${c.key}|${tag.uid}`), now) : 'the server restarted while you were carrying it';
      log(`${c.name} cashed in ${owner}'s dog tag${why ? ` (not listed for a reward: ${why})` : ''}`);
      lootedTags.delete(tag.uid);
      tagSeen.delete(`${c.key}|${tag.uid}`);
      if (from && !why) {
        // one tag, one reward
        for (const a of namesOf(c.key, c.ip)) for (const b of namesOf(from.ownerKey, from.ownerIp)) pairPaidAt.set(`${a}>${b}`, now);
        recordCashIn(c, from.owner, isWallet(m.wallet) ? m.wallet : '');
      } else send(c, { t: 'tell', kind: 'warn', text: `No reward for ${owner}'s tag: ${why}.` });
      broadcast({ t: 'cashed', id: c.id, name: c.name, owner });
      return;
    }
    case 'ping':
      send(c, { t: 'pong', n: m.n });
      return;
  }
}

function join(ws: WebSocket, m: Extract<C2S, { t: 'hello' }>): Client | null {
  if (m.v !== PROTOCOL) {
    ws.send(JSON.stringify({ t: 'kick', reason: 'This game was updated. Reload the page.' } satisfies S2C));
    ws.close();
    return null;
  }
  const key = keyOf(m) || `anon-${Math.random().toString(36).slice(2)}`;
  const off = bannedFor(key, ipOf.get(ws) ?? '');
  if (off) {
    log(`${cleanName(m.name)} is not let in: ${off}`);
    ws.send(JSON.stringify({ t: 'kick', reason: off === 'banned' ? 'You are banned from this server.' : off.startsWith('timed out') ? 'You are kept off this server for a while yet.' : 'You are kept off this server for now.' } satisfies S2C));
    ws.close();
    return null;
  }
  if (addressFull(key, ipOf.get(ws) ?? '')) {
    log(`${cleanName(m.name)} is not let in: ${PER_ADDRESS} already playing from their address`);
    ws.send(JSON.stringify({ t: 'kick', reason: PER_ADDRESS === 1 ? 'Somebody is already playing from your connection: one player to a connection.' : `There are already ${PER_ADDRESS} playing from your connection.` } satisfies S2C));
    ws.close();
    return null;
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
  if (resume) for (const [k, since] of tagSeen) if (k.startsWith(`${key}|`)) tagSeen.set(k, since + (Date.now() - resume.leftAt));
  // (Somebody who left the game down in the bunker comes back with what they carried, at one
  // of the map's own starting places: nobody waits behind its door for it to be opened for them.)
  const under = !!resume && bunkerDark(world.bunker, resume.pose[0], resume.pose[1] + 1, resume.pose[2]) > 0;
  const sp = resume && !under && !resume.afresh ? { x: resume.pose[0], y: resume.pose[1], z: resume.pose[2], yaw: resume.pose[3] } : pickSpawn();
  const c: Client = {
    ws, id: nextId++, key, name: cleanName(m.name),
    pose: [sp.x, 'y' in sp && sp.y !== undefined ? sp.y : world.groundAt(sp.x, sp.z), sp.z, sp.yaw, 0, 0],
    w: null, m: [], g: [], b: [], alive: true, power: { god: false, hidden: false, clip: false, voidInv: false, voidTag: false },
    heardAt: Date.now(), kept: false, asleep: 0, bled: 0, logoutAt: 0, logoutFrom: [0, 0],
    inv: resume?.inv ?? null, vitals: resume?.vitals ?? null,
    outAt: 0, underAt: 0, lastHit: 0, lastVHit: 0, seatAt: 0, lastNade: 0, nadeHits: 0, blasts: [], lastEmote: 0, lastChat: 0, lastHitBy: null, openCid: null, check: { at: Date.now(), carry: 0, free: Date.now() + CHECK.free, high: 0, flags: 0, said: 0, refused: [], hp: Math.min(100, resume?.vitals?.health ?? 100), hpAt: Date.now(), downAt: 0, unknown: new Set() }, activeAt: Date.now(), joinedAt: Date.now(), ip: ipOf.get(ws) ?? '', lifeAt: Date.now(), msgCount: 0, msgWindow: Date.now(),
  };
  records.delete(key);
  KEPT.chars.delete(keyHash(key));
  const others = [...clients.values()].filter((o) => !o.power.hidden).map(info);
  clients.set(c.id, c);
  claim();
  send(c, {
    t: 'welcome', v: PROTOCOL, you: c.id, players: others,
    loot: [...economy.loot.values()],
    doors: [...doors].map(([i, [open, swing]]) => [i, open, swing]),
    stashes: [...boxes.values()].filter((b) => b.kind === 'stash').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, ...(b.item ? { item: b.item } : {}), ...(b.buried ? { buried: true } : {}) })),
    corpses: [...boxes.values()].filter((b) => b.kind === 'corpse').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor', v: b.v ?? 0 })),
    drops: [...boxes.values()].filter((b) => b.kind === 'drop').map(dropInfo),
    barrels: [...barrelsGone.keys()],
    fires: hearths.alight(Date.now() / 1000),
    bunker: bunkerDoor.open,
    vehicles: [...vehicles.values()].map(vehInfo),
    infected: horde.list(),
    // (the hour is the wall clock's: every game on the server is at the same one, and a restart does not put it back)
    hour: phaseOf(Date.now() / 1000),
    spawn: sp,
    me: resume ? { inv: resume.inv!, vitals: resume.vitals ?? { health: 100, energy: 80, water: 80, stamina: MAX_STAMINA, bleeding: false } } : null,
    max: MAX_PLAYERS,
  });
  broadcast({ t: 'join', p: info(c) }, c);
  // back under another name: the board says so, to everybody
  const had = scores.get(c.key);
  if (had && had.name !== c.name) {
    had.name = c.name;
    sendBoard();
  } else sendBoard(c);
  log(`+ ${c.name} (#${c.id})${resume ? ' resumed' : ''} — ${clients.size} online`);
  // (somebody with a role is told so as they come in: their game shows them what they may do)
  if (roleOf(c)) send(c, { t: 'role', role: roleOf(c) });
  const chose = roleOf(c) === 'admin' ? ADMIN.voids.get(c.key) : undefined;
  if (chose && (chose.voidInv || chose.voidTag)) {
    Object.assign(c.power, chose);
    send(c, { t: 'powers', ...c.power });
  }
  return c;
}

function drop(c: Client) {
  if (!clients.delete(c.id)) return;
  ADMIN.gone.push({ id: c.id, name: c.name, key: c.key, ip: c.ip, at: Date.now() });
  ADMIN.asked.delete(c.id);
  if (ADMIN.gone.length > 60) ADMIN.gone.shift();
  releaseLock(c);
  leaveSeat(c, true);
  records.set(c.key, { pose: c.pose, inv: c.inv, vitals: c.vitals, alive: c.alive, leftAt: Date.now() });
  broadcast({ t: 'leave', id: c.id });
  log(`- ${c.name} (#${c.id}) — ${clients.size} online`);
  fillFromQueue();
}

// ------------------------------------------------------------------ loops

setInterval(() => {
  if (clients.size < 2) return;
  const s: Extract<S2C, { t: 'ps' }>['s'] = [];
  for (const c of clients.values()) {
    if (c.power.hidden) continue;
    const p = c.pose;
    s.push([c.id, round2(p[0]), round2(p[1]), round2(p[2]), Math.round(p[3] * 1000) / 1000, Math.round(p[4] * 1000) / 1000, p[5], c.w, c.m]);
  }
  broadcast({ t: 'ps', s });
}, 1000 / TICK_HZ);

setInterval(() => {
  const now = Date.now();
  for (const v of [...vehicles.values()]) {
    if (v.burnAt && now >= v.burnAt) blowJeep(v, v.by);
    else if (v.goneAt && now >= v.goneAt) {
      vehicles.delete(v.i);
      broadcast({ t: 'v-', i: v.i });
    } else if (!v.goneAt && (v.s[1] < JEEP.floor || Math.abs(v.s[0]) > EDGE || Math.abs(v.s[2]) > EDGE) && v.seats.every((s) => s === null)) {
      // off the edge of the world, or through the bottom of it: stood back where it started
      const p = PARKS[v.home];
      v.s = restState(p.x, p.y, p.z, p.yaw);
      v.sim = null;
      tellSeats(v, true);
    } else if (!v.goneAt && !v.burnAt && carsGas && gasEdge(carsGas, v.s[0], v.s[2]) < 0 && v.seats.every((s) => s === null)) {
      // Left under the gas (see JEEP.gas): once it has stood there empty long enough with nobody near, it is stood
      // back where it first stood, as a new one is. (Anybody near, or in it, and the count starts again.)
      const near = [...clients.values()].some((c) => c.alive && Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]) < JEEP.gas.clear);
      if (near) v.leftAt = 0;
      else if (!v.leftAt) v.leftAt = now;
      else if (now - v.leftAt > JEEP.gas.after * 1000) {
        const p = PARKS[v.home];
        // (not onto anybody, nor onto another car: it waits until its place is free)
        if (![...clients.values()].some((c) => c.alive && Math.hypot(c.pose[0] - p.x, c.pose[2] - p.z) < JEEP.respawnClear) && ![...vehicles.values()].some((o) => o !== v && Math.hypot(o.s[0] - p.x, o.s[2] - p.z) < 8)) {
          vehicles.delete(v.i);
          broadcast({ t: 'v-', i: v.i });
          broadcast({ t: 'v+', v: vehInfo(standJeep(v.home)) });
        }
      }
    } else if (v.sim !== null && v.seats[0] !== v.sim && now - v.heard > 6000) {
      // the game that was letting it roll to a stop has gone quiet
      v.sim = null;
      v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
      tellSeats(v, true);
    }
  }
  // the infected: new ones where nobody is looking, the dead cleared away, and whose game moves each
  const turn = horde.tick(now, [...clients.values()].filter((c) => c.alive && !away(c)).map((c) => ({ id: c.id, x: c.pose[0], z: c.pose[2] })));
  for (const i of turn.gone) broadcast({ t: 'i-', i });
  for (const b of turn.added) broadcast({ t: 'i+', b: { i: b.i, s: b.s, hp: b.hp, own: b.own, h: b.h } });
  for (const [i, to] of turn.owned) broadcast({ t: 'iown', i, to });
  // the bunker's door: open while anybody is in there, shut a minute after the last of them is gone
  if (bunkerDoor.open) {
    if ([...clients.values()].some((c) => c.alive && inBunker(world.bunker, c.pose[0], c.pose[1] + 1, c.pose[2], 2.5))) bunkerDoor.emptyAt = now;
    else if (now - bunkerDoor.emptyAt > BUNKER.door.shut * 1000) {
      bunkerDoor.open = false;
      broadcast({ t: 'bunker', open: false });
    }
  }
  // a new one for each that burned, once its time has come and nobody is standing on the spot
  for (const [home, at] of jeepsDue) {
    const p = PARKS[home];
    if (now < at || [...clients.values()].some((c) => c.alive && Math.hypot(c.pose[0] - p.x, c.pose[2] - p.z) < JEEP.respawnClear) || [...vehicles.values()].some((v) => Math.hypot(v.s[0] - p.x, v.s[2] - p.z) < 8)) continue;
    jeepsDue.delete(home);
    broadcast({ t: 'v+', v: vehInfo(standJeep(home)) });
  }
}, 1000);

// ------------------------------------------------------------------ the queue
//
// The server holds MAX_PLAYERS. Anyone who turns up beyond that waits in line, first come
// first served, on the connection they turned up with, and is let in the moment somebody
// leaves. A player whose connection dropped a moment ago goes to the front: they were
// playing, not arriving. And while anybody is waiting, a player who has not moved or done
// anything for five minutes gives up their place.

interface Waiting {
  ws: WebSocket;
  hello: Extract<C2S, { t: 'hello' }>;
  key: string;
  /** they were in the game until a moment ago */
  back: boolean;
  /** called with the player they have become, once they are in */
  enter: (c: Client) => void;
}
const queue: Waiting[] = [];
const QUEUE_MAX = Number(process.env.QUEUE_MAX ?? 200);
/** how long after dropping out a player still goes to the front of the line, ms */
const REJOIN_GRACE_MS = (Number(process.env.REJOIN_GRACE_S) || 120) * 1000;
/** with people waiting, how long a player may do nothing before their place goes to the next in line, ms */
const IDLE_KICK_MS = (Number(process.env.IDLE_KICK_S) || 300) * 1000;

const keyOf = (m: { key?: unknown }) => (typeof m.key === 'string' && m.key.length >= 8 && m.key.length <= 64 ? m.key : '');

/** no room for this player right now? (Somebody taking over their own character from another tab needs none.) */
function mustWait(m: Extract<C2S, { t: 'hello' }>) {
  if (m.v !== PROTOCOL) return false; // join() turns them away itself
  const key = keyOf(m);
  if (key && [...clients.values()].some((o) => o.key === key)) return false;
  return clients.size >= MAX_PLAYERS || queue.length > 0 || !KEPT.ready;
}

/** when the line was last told where it stands */
let queueToldAt = 0;

function tellQueue() {
  queueToldAt = Date.now();
  queue.forEach((w, i) => {
    if (w.ws.readyState === 1) w.ws.send(JSON.stringify({ t: 'queue', pos: i + 1, of: queue.length, max: MAX_PLAYERS } satisfies S2C));
  });
}

function enqueue(ws: WebSocket, hello: Extract<C2S, { t: 'hello' }>, enter: (c: Client) => void): Waiting | null {
  if (queue.length >= QUEUE_MAX) {
    ws.send(JSON.stringify({ t: 'kick', reason: 'The server is full, and so is the line for it. Try again in a while.' } satisfies S2C));
    ws.close();
    return null;
  }
  const key = keyOf(hello);
  // the same player waiting twice (a second tab): the new connection takes the old one's place
  const twice = key ? queue.findIndex((w) => w.key === key) : -1;
  const rec = key ? records.get(key) : undefined;
  const w: Waiting = { ws, hello, key, back: !!rec && Date.now() - rec.leftAt < REJOIN_GRACE_MS, enter };
  if (twice >= 0) {
    const old = queue[twice];
    queue[twice] = { ...w, back: old.back || w.back };
    old.ws.send(JSON.stringify({ t: 'kick', reason: 'You joined the line from another tab.' } satisfies S2C));
    old.ws.close();
  } else if (w.back) {
    // behind anyone else who is also on their way back in
    const at = queue.findIndex((q) => !q.back);
    queue.splice(at < 0 ? queue.length : at, 0, w);
  } else queue.push(w);
  log(`~ ${cleanName(hello.name)} is waiting (${queue.indexOf(queue.find((q) => q.ws === ws)!) + 1} of ${queue.length})`);
  tellQueue();
  return queue.find((q) => q.ws === ws) ?? null;
}

function leaveQueue(ws: WebSocket) {
  const i = queue.findIndex((w) => w.ws === ws);
  if (i < 0) return;
  queue.splice(i, 1);
  tellQueue();
}

/** somebody has left: the next in line comes in */
function fillFromQueue() {
  let moved = false;
  while (KEPT.ready && clients.size < MAX_PLAYERS && queue.length) {
    const w = queue.shift()!;
    moved = true;
    if (w.ws.readyState !== 1) continue;
    const c = join(w.ws, w.hello);
    if (c) w.enter(c);
  }
  if (moved) tellQueue();
}

/** every five seconds: with people waiting, whoever has done nothing for too long makes room */
function kickIdle(now: number) {
  if (!queue.length) return;
  for (const c of [...clients.values()]) {
    if (now - c.activeAt < IDLE_KICK_MS || c.asleep) continue;
    send(c, { t: 'kick', reason: 'You were away while others were waiting to play. Reconnect to join the line.' });
    log(`${c.name} was idle with ${queue.length} waiting: their place goes to the next in line`);
    c.ws.close();
    drop(c);
  }
}

// ------------------------------------------------------------------ leaderboard
//
// Kills, and tags cashed in for a reward, since this server started. Counted by the player's
// key, so a new name or a dropped connection keeps the count. Ranked by tags, then kills:
// a tag is the harder thing to bring home.

const scores = new Map<string, { name: string; kills: number; tags: number }>();

function scoreOf(c: Client) {
  let s = scores.get(c.key);
  if (!s) scores.set(c.key, (s = { name: c.name, kills: 0, tags: 0 }));
  s.name = c.name;
  return s;
}

/** tell everyone (or one player who has just joined) how the board stands */
function sendBoard(only?: Client) {
  const ranked = [...scores.entries()].filter(([, s]) => s.kills || s.tags).sort((a, b) => b[1].tags - a[1].tags || b[1].kills - a[1].kills || a[1].name.localeCompare(b[1].name));
  const rows = ranked.slice(0, 5).map(([, s]) => [s.name, s.kills, s.tags] as [string, number, number]);
  for (const c of only ? [only] : clients.values()) {
    const mine = scores.get(c.key);
    send(c, { t: 'board', rows, me: ranked.findIndex(([k]) => k === c.key), mine: [mine?.kills ?? 0, mine?.tags ?? 0] });
  }
}

// ------------------------------------------------------------------ supply drops
//
// See src/sim/drops.ts. One at a time, and only while somebody is alive to go and get it.

const DROP_EVERY = Number(process.env.DROP_EVERY_S) || DROP.every;
const DROP_FIRST = Number(process.env.DROP_FIRST_S) || DROP.first;
const DROP_LIFE = Number(process.env.DROP_LIFE_S) || DROP.life;
const DROP_LINGER = Number(process.env.DROP_LINGER_S) || DROP.linger;
/** economy time the next one is due (-1 until the clock is first read) */
let nextDrop = -1;

function dropInfo(b: Box): DropInfo {
  return { uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, left: Math.max(0, Math.round((b.expires ?? 0) - economy.time)), ...(b.heli ? { heli: true } : {}) };
}

/** economy time of the last call answered on a field radio */
let lastCall = -1e9;

/** @param where set down here (called for on a radio) and not at a place of the map's choosing */
function spawnDrop(where?: { x: number; y: number; z: number }, heli = false) {
  // (a supply drop out in the wild country, past the line; a helicopter's cargo inside it)
  const at = where ?? world.dropSite(undefined, heli);
  if (!at) return;
  const uid = `drop-${Math.round(economy.time)}-${Math.random().toString(36).slice(2, 7)}`;
  const [w, h] = heli ? [CRASH.w, CRASH.h] : [DROP.w, DROP.h];
  const c = new Container(uid, heli ? CRASH.label : DROP.label, w, h, [], true);
  if (heli) fillCrash(c);
  else fillDrop(c);
  const b: Box = { cid: uid, kind: 'drop', w, h, items: c.serialize().items, x: at.x, y: at.y, z: at.z, rot: Math.random() * Math.PI * 2, emptiedAt: -1, expires: economy.time + (heli ? CRASH.life : DROP_LIFE), ...(heli ? { heli: true } : {}) };
  boxes.set(uid, b);
  for (const it of b.items) issue(it);
  broadcast({ t: 'drop+', d: dropInfo(b) });
  log(`${heli ? 'helicopter down' : 'supply drop'} at ${Math.round(at.x)}, ${Math.round(at.z)} (${b.items.length} items)`);
}

/** every five seconds: clear away the one that is done with, set the next one down when it is due */
/** economy time the next helicopter is due to come down (-1 until the clock is first read) */
let nextCrash = -1;

function tickDrops(anyoneAlive: boolean) {
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
  // with nobody about the clock waits: the first one comes a minute and a half after somebody turns up
  if (nextDrop < 0 || !anyoneAlive) nextDrop = Math.max(nextDrop, economy.time + DROP_FIRST);
  else if (economy.time >= nextDrop && !standing) {
    nextDrop = economy.time + DROP_EVERY;
    spawnDrop();
  }
}

// A tag taken off somebody is worth a reward once it has been carried for ten minutes, so
// the safest thing to do with one was to sit in a bush until the clock ran out. Every half
// minute the map shows everybody where each carrier is: the tag has to be defended, or run with.
const TAG_PING_MS = (Number(process.env.TAG_PING_S) || 30) * 1000;
setInterval(() => {
  const p: [number, number, number][] = [];
  for (const c of clients.values()) {
    if (c.alive && takenTag(c)) p.push([c.id, Math.round(c.pose[0]), Math.round(c.pose[2])]);
  }
  if (p.length) broadcast({ t: 'tags', p });
}, TAG_PING_MS);

let lastEcon = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastEcon) / 1000;
  lastEcon = now;
  const alive = [...clients.values()].filter((c) => c.alive).map((c) => ({ x: c.pose[0], z: c.pose[2] }));
  economy.tick(dt, alive);
  for (const b of [...boxes.values()]) {
    if (b.kind === 'crate') {
      if (b.items.length) b.emptiedAt = -1;
      else if (b.emptiedAt < 0) b.emptiedAt = economy.time;
      else if (economy.time - b.emptiedAt > CRATE_RESTOCK && !locks.has(b.cid) && !alive.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 60)) fillBox(b);
    } else if (b.kind === 'corpse' && economy.time > (b.expires ?? 0) && !locks.has(b.cid)) {
      boxes.delete(b.cid);
      broadcast({ t: 'corpse-', uid: b.cid });
    }
  }
  tickDrops(alive.length > 0);
  // a new drum where one went up, once its time has come and nobody is standing on the spot
  for (const [i, at] of barrelsGone) {
    const b = world.barrels[i];
    if (now < at || alive.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < BARREL.clear)) continue;
    barrelsGone.delete(i);
    broadcast({ t: 'barrel+', i });
  }
  kickIdle(now);
  // a line that is not moving still hears from us: a connection that says nothing for long is cut off on the way
  if (queue.length && Date.now() - queueToldAt > 20_000) tellQueue();
  for (const [k, r] of records) if (now - r.leftAt > RECORD_LIFETIME) records.delete(k);
}, 5000);

setInterval(saveWorld, 60_000);

// The site's housekeeping (api/tick.ts: payments still on their way, tags waiting for the
// treasury, creator rewards to collect) is given a nudge every ten minutes while anybody is
// playing, and once shortly after this server starts: what it was following before a restart
// it no longer knows about.
const nudge = () => void fetch(`${SITE_URL}/api/tick`, { signal: AbortSignal.timeout(75_000) }).catch(() => {});
setTimeout(nudge, 30_000).unref();
setInterval(() => clients.size && nudge(), 10 * 60_000).unref();

// ------------------------------------------------------------------ http + ws

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg']);
const gz = new Map<string, Buffer>();

const server = http.createServer((req, res) => {
  // (an address that cannot be read is a bad request, not the end of the server)
  try {
    serve(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('bad request');
  }
});

function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    // readable from a client hosted somewhere else (e.g. Vercel) for the start-screen player count
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    // (places: how many different addresses the players come from. One, with several players on, means the host is not passing addresses through.)
    res.end(JSON.stringify({ ok: true, players: [...clients.values()].filter((c) => !c.asleep).length, asleep: [...clients.values()].filter((c) => c.asleep).length, max: MAX_PLAYERS, queue: queue.length, uptime: Math.round(process.uptime()), checks: CHECKS, flagged, keptOff: BANS.temp.size, loot: economy.loot.size, places: new Set([...clients.values()].map((c) => c.ip)).size }));
    return;
  }
  // the website's function asks here what it has just been asked to do with the lists of admins and bans (see siteAdmin)
  if (url.pathname.startsWith('/adminop/')) {
    // (once, and only for a number this server made up a moment ago)
    const n = url.pathname.split('/')[2] ?? '';
    const body = ADMIN.ops.get(n);
    ADMIN.ops.delete(n);
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body ?? { error: 'unknown' }));
    return;
  }
  // the website's function asks here whether a cash-in it was told about is real
  if (url.pathname.startsWith('/cashins')) {
    // (one at a time, by its id, which only the site is told: the list is not given out)
    const id = url.pathname.split('/')[2];
    const body = id ? cashins.find((e) => e.id === id) : undefined;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body ?? { error: 'unknown' }));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (path.extname(rel)) {
      res.writeHead(404).end('not found');
      return;
    }
    file = path.join(DIST, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain' }).end('Client not built. Run "npm run build".');
      return;
    }
  }
  const ext = path.extname(file);
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // asset lists are always re-checked; everything else under /assets is either content-hashed
    // (the built script) or requested with a version in the URL, so it can be kept for good
    'cache-control': rel.startsWith('/assets/') && ext !== '.json' ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (COMPRESS.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    let body = gz.get(file);
    if (!body) {
      body = zlib.gzipSync(readFileSync(file), { level: 6 });
      gz.set(file, body);
    }
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
    res.writeHead(200, headers).end(body);
    return;
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  let wanted = '';
  try {
    wanted = new URL(req.url ?? '/', 'http://x').pathname;
  } catch {
    /* not an address at all */
  }
  if (wanted !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req: http.IncomingMessage) => {
  ipOf.set(ws, addressOf(req));
  let c: Client | null = null;
  let waiting = false;
  const hello = setTimeout(() => !c && !waiting && ws.close(), 8000);
  ws.on('message', (data, isBinary) => {
    // (what is not words is speech: see `voice`)
    if (isBinary) {
      if (c) voice(c, Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]));
      return;
    }
    let m: C2S;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (!c) {
      if (m.t !== 'hello' || waiting) return;
      if (mustWait(m)) {
        waiting = !!enqueue(ws, m, (client) => {
          waiting = false;
          c = client;
        });
      } else c = join(ws, m);
      return;
    }
    // crude flood guard: nobody legitimately sends more than ~80 messages a second
    const now = Date.now();
    if (now - c.msgWindow > 1000) {
      c.msgWindow = now;
      c.msgCount = 0;
    }
    if (++c.msgCount > 120) return;
    try {
      handle(c, m);
    } catch (e) {
      log('bad message from', c.name, m.t, (e as Error).message);
    }
  });
  ws.on('close', () => {
    clearTimeout(hello);
    if (waiting) leaveQueue(ws);
    if (c) gone(c);
  });
  ws.on('error', () => ws.close());
});

loadWorld();
server.listen(PORT, () => log(`listening on :${PORT}${existsSync(DIST) ? '' : ' (no client build found: API only)'}`));
// (who may give orders here and who is kept off: read from the site, which keeps them between this server's restarts)
loadAdmin();

void loadKept();

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    log('shutting down, saving world');
    saveWorld();
    // (and its last word to the site, where it outlasts this server: a few seconds are allowed for it)
    void Promise.race([keepNow(true, 'this server is stopping'), pause(12_000)]).finally(() => process.exit(0));
  });
}
