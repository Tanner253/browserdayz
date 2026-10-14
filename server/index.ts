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
import { BODY_GRID, Container, HOLD, cleanInventory as cleanCarried, cleanItem as cleanThing, heldIn, holdOnlyEmpties, layOnBody, type SerializedInventory } from '../src/sim/inventory';
import { GEAR_SLOTS, ITEMS, TAG_FRESH, TAG_HOLD, TAG_OUT, holds, magFits, makeItem, sanitizeItem, type ItemInstance } from '../src/sim/items';
import { WORLD_SIZE, inPlay } from '../src/world/worldgen';
import { BURY, noBurying } from '../src/sim/stash';

/** how far from the middle anything may say it is: the edge of the ground, and a little (the walls stand 4 m inside it) */
const EDGE = WORLD_SIZE / 2 + 8;
import { CALL, CRASH, DROP, fillCrash, fillDrop, type DropInfo } from '../src/sim/drops';
import { comesFrom, flightTimes, planFlight, restAt, type Flight } from '../src/sim/airdrop';
import { STOCK } from '../src/sim/trade';
import { VOICE } from '../src/sim/voice';
import { CRATE_RESTOCK, CRATE_SPECS, fillCrate } from '../src/sim/crates';
import { News, type NewsKept } from '../src/sim/news';
import { gasEdge, underGas } from '../src/sim/gas';
import { RangeJudge, dealing, rangeOf, shotMisses, type RangeSpec } from '../src/sim/range';
import { BUNKER, bunkerDark, inBunker } from '../src/sim/bunker';
import { phaseOf } from '../src/sim/daynight';
import { WEAPON_RULES, hitDamage, type HitZone } from '../src/sim/combat';
import { THROWN, fallen, inHandDamage, judge, letGo, lyingBlast, newThrower, overdue, pullPin, type Thrower, type Vec3 } from '../src/sim/grenades';
import { BARREL } from '../src/sim/barrels';
import { JEEP, POLICE_CAR, SEATS, carDamage, crashDamage, restState, type VehicleInfo, type VState } from '../src/sim/vehicles';
import { Director, INFECTED, guarded, infectedDrop } from '../src/sim/infected';
import { EMOTE, EMOTE_GAP, SHOUT_RANGE } from '../src/sim/emotes';
import { BLOOD, bleedOf, bloodOf, withWound, woundOf } from '../src/sim/blood';
import { ACTS, CHAT_RANGE, F_BLEED, F_DEAD, F_GROUND, F_GUARD, F_SIT, MAX_STAMINA, PROTOCOL, type C2S, type CorpseInfo, type KillInfo, type PlayerInfo, type Pose, type S2C, type Slung, type StashInfo, type StoredItem, type Vitals } from '../src/net/protocol';
import { ENTITIES, GROUND, ORDERS, entityBy, written } from '../src/net/orders';
import { KITS } from '../src/sim/kits';
import { CARRY_POWERS, carriedOf, refill, refilledWords, type CarryPower } from '../src/sim/powers';
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
const WORLD_REV = 24;

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
  /** a stash: when somebody last had anything to do with it (put it down, opened it, changed what is in it, dug it up) */
  touchedAt?: number;
  emptiedAt: number;
  /** a crate: when (economy time) somebody last changed what is in it, since it was last filled (unset: nobody has) */
  pickedAt?: number;
  /** a crate: what it was last filled with, by uid. It is filled again over what is left only if all that is left is of these: never over a thing somebody put in it. */
  filled?: string[];
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
/** Things taken out of a set of pockets, wherever in them they are: worn, in a pocket, or in something that is. */
function takeOut(inv: SerializedInventory | null, gone: Set<string>) {
  if (!inv) return;
  const strip = (it: ItemInstance | null | undefined) => {
    if (!it?.cargo) return;
    it.cargo = it.cargo.filter((p) => !gone.has(p.item.uid));
    for (const p of it.cargo) strip(p.item);
  };
  for (const [slot, it] of Object.entries(inv.slots)) {
    if (it && gone.has(it.uid)) (inv.slots as Record<string, ItemInstance | null>)[slot] = null;
    else strip(it);
  }
  for (const cont of inv.containers) {
    cont.items = cont.items.filter((it) => !gone.has(it.uid));
    for (const it of cont.items) strip(it);
  }
}

/** (what is kept is listed further down: until that list is made, nothing has changed that it does not know of) */
let keptListed = false;
const keptChanged = () => {
  if (keptListed) KEPT.dirty = true;
};
const economy = new Economy(world.lootPoints, {
  spawn: (l) => {
    issue(l.item);
    // (a case, a suitcase or a bag somebody dropped is kept between restarts: see `keptAt`)
    if (l.keptAt !== undefined) keptChanged();
    broadcast({ t: 'loot+', l });
  },
  despawn: (l) => {
    if (l.keptAt !== undefined) keptChanged();
    broadcast({ t: 'loot-', uid: l.uid });
  },
});
// A container left lying is not there for ever: an empty one is cleared away after STASH_EMPTY_S (a week), one with
// anything in it after STASH_FULL_S (a fortnight). One under the ground stays until it is dug up. (2026-10-12:
// "unburried stashes autodelete after 7 days of no interaction. 14 days if the unburries stash has an item(s) within".)
economy.containerLife = { empty: (Number(process.env.STASH_EMPTY_S) || 7 * 86400) * 1000, full: (Number(process.env.STASH_FULL_S) || 14 * 86400) * 1000 };

/**
 * A stash as a thing to carry, and a thing carried as what a stash holds. A case, a suitcase or a bag is an item
 * like any other: dropped, it lies on the ground as one (with what is in it), is picked up as one, and only a
 * shovel makes anything else of it. Buried, it is a `Box` under the ground, going by the same number as the item.
 */
const stashItem = (b: Box): ItemInstance => ({ uid: b.cid, id: b.item ?? 'stash_kit', qty: 1, ...(b.items.length ? { cargo: b.items.map(({ x, y, rot, ...item }) => ({ item, x, y, rot })) } : {}) }) as ItemInstance;
const cargoOf = (item: ItemInstance): Box['items'] => (item.cargo ?? []).map((q) => ({ ...q.item, x: q.x, y: q.y, rot: q.rot }));

function fillBox(b: Box) {
  const spec = CRATE_SPECS[b.crate ?? ''];
  if (!spec) return;
  const c = new Container(b.cid, spec.label, spec.w, spec.h, [], true);
  // (a crate under the gas, or down in the bunker, is filled with the best of everything)
  fillCrate(c, b.crate!, Math.random, inBunker(world.bunker, b.x, b.y + 0.5, b.z) ? 'bunker' : underGas(world.gas, b.x, b.y, b.z));
  b.items = c.serialize().items;
  for (const it of b.items) issue(it);
  b.emptiedAt = -1;
  b.pickedAt = undefined;
  b.filled = b.items.map((it) => it.uid);
}

function loadWorld() {
  for (const c of world.crates) {
    const spec = CRATE_SPECS[c.kind];
    if (!spec) continue;
    // (a steel cabinet is filled with what its building kept: in a police building a constable's locker, in the
    // hospital a hospital's, which is kits before dressings, and elsewhere a clinic's medicine cabinet)
    const stands = (kind: string, within: number) => world.buildings.some((q) => q.type.startsWith(kind) && Math.hypot(q.x - c.x, q.z - c.z) < within);
    // (the steel locker with two doors likewise: a constable's in a police building; in the hospital, where it is the
    // staff's own, a clinic's cabinet and not a hospital's; anywhere else what it is by itself, a soldier's)
    const kind = c.kind !== 'med_cabinet' && c.kind !== 'steel_locker' ? c.kind : stands('police', 17) ? 'police_locker' : stands('hospital', 22) ? (c.kind === 'steel_locker' ? 'med_cabinet' : 'hospital_cabinet') : c.kind;
    boxes.set(c.cid, { cid: c.cid, kind: 'crate', w: spec.w, h: spec.h, items: [], x: c.x, y: c.y, z: c.z, rot: 0, crate: kind, emptiedAt: -1 });
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
      } else if (b.kind === 'stash') {
        if (b.buried) boxes.set(b.cid, b);
        else if (!economy.loot.has(b.cid)) economy.drop(stashItem(b), b.x, b.y, b.z, b.rot).keptAt = b.touchedAt ?? Date.now();
      }
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
// time (TAG_HOLD, fifteen minutes) of the server's own clock has passed since the server first
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
 * When each shooter last hit each body. A hit is believed no oftener than the gun fires, of any ONE body: a shell
 * that lands on two is two hits a moment apart, and the second was thrown away with the first's clock until
 * 2026-10-13 (one clock a shooter). No more than three bodies inside one gap: what a spread of shot could reach.
 * @param target who or what was hit, in a word of its own ('p' + a player's id, 'i' + an infected's)
 */
const hitsBy = new Map<number, Map<string, number>>();
function mayHit(c: Client, target: string, now: number, gap: number): boolean {
  let m = hitsBy.get(c.id);
  if (!m) hitsBy.set(c.id, (m = new Map()));
  if (now - (m.get(target) ?? 0) < gap) return false;
  let lately = 0;
  for (const [k, t] of m) {
    if (now - t > 5000) m.delete(k);
    else if (now - t < gap) lately++;
  }
  if (lately >= 3) return false;
  m.set(target, now);
  return true;
}
/** what a game says without anybody at it doing anything (see `handle`) */
const SAID_BY_ITSELF = new Set<string>(['s', 'me', 'ping', 'gear', 'back', 'is', 'iatk', 'v', 'vrest']);
/** when each connection was last seen to carry a keycard, and how long after that it may still put one in the reader */
const cardSeen = new Map<number, number>();
const CARD_GRACE_MS = 20_000;

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
 *   carry – seconds of going that fast that may be saved up, by anybody, at any time
 *   lag   – and how many more are saved out of a SILENCE (a line held up), good for `lagFor` ms after it ends: what that line then sends all at once
 *   grace – metres let go on top of that at any one time, and
 *   owe   – the most of it that may be owed at once: what is let go is paid back out of time left over, before any is saved
 *   free  – ms after being set down somewhere (a start, a seat taken or left) in which where they are is not questioned
 *   kick  – so many refusals inside a minute, and the connection is closed (when enforcing)
 *   hill  – how far the ground may stand over the line of a shot before the shot is through a hill, metres
 *   high  – how far over the ground, and for how many seconds, before it is written down that somebody is in the air
 *   reach – how far off a thing lying in the world can be taken from, metres (a hand reaches three)
 *   heal  – the most health anybody gets back in a second, by any means (a first aid kit gives 45 in six)
 *   over  – how far past none the health the server allows somebody may go before they ought to be dead, and
 *   down  – how many ms they are given to say so themselves, as every honest game does
 *   strikes, ban – put off the server so many times inside an hour, and they are kept off it for so many hours
 *   fresh – ms after somebody is let in OFF THE BOT CHECK'S RANGE in which nothing their game says of where they
 *     are is weighed. The range stands four hundred metres up, and a game that had passed it went on saying it
 *     was there (or falling from there) until it had put its world together: held in the air for twelve
 *     seconds, put off; put off, the range again, and the same again; twice in an hour, kept off for six. Nobody
 *     had cheated. 2026-10-13: "this person was wrongfully banned". The game no longer waits up there; this is
 *     for a game that does all the same.
 */
const CHECK = { foot: 9.5, seat: 64, carry: 2, lag: 12, lagFor: 5000, grace: 3, owe: 30, free: 2500, fresh: 30_000, kick: Number(process.env.CHECK_KICK) || 12, hill: 1.5, high: [30, 4], reach: 8, heal: 10, over: 15, down: 1500, strikes: 2, ban: 6 };
let flagged = 0;

/** Something a check fires on: counted, and written down (not more than once in five seconds for one player). @returns whether it is refused */
function flag(c: Client, what: string, refuse = true): boolean {
  // (an admin is not asked how they got anywhere, or how they are still standing: they fly, and are put where they say)
  if (roleOf(c) === 'admin') return false;
  c.check.flags++;
  flagged++;
  const now = Date.now();
  if (now - c.check.said > 5000) {
    c.check.said = now;
    log(`[check:${CHECKS}] ${c.name} ${what} (${c.check.flags} so far)`);
  }
  // (2026-10-12: "if a user gets flagged by the enforce check 50 times they should be kicked from the server".
  // When whatever was being done with them is done: this is called from the middle of it. Put off as the other
  // checks put off: the first time they may come straight back, and the second time within the hour their game
  // and their address are kept off for hours. In the five minutes after this rule went in as a plain kick it put
  // six out, and the flags went on at one a second: the same ones, back in each time.)
  if (CHECKS === 'enforce' && c.check.flags === FLAGS_OUT) {
    setImmediate(() => {
      if (!clients.has(c.id)) return;
      TURNED.flags++;
      putOff(c, `the checks flagged them ${FLAGS_OUT} times (the last: ${what})`);
    });
  }
  return refuse && CHECKS === 'enforce';
}
/** enforcing, somebody the checks have flagged this many times since they came in is put out of the server (FLAGS_OUT) */
const FLAGS_OUT = Number(process.env.FLAGS_OUT) || 50;

/**
 * Whether the place a player says they have got to is one they could have got to since they were last where
 * they said. Refused, they are kept where they were for everybody else (and for what they can hit from there)
 * until enough time has gone by to have run or driven the distance: nobody gets anywhere faster than that, and
 * an honest player who was wrongly refused is right again in the time it takes to cover the ground.
 */
function moveCheck(c: Client, to: Pose, now: number): boolean {
  const k = c.check;
  if (CHECKS === 'off' || !c.alive || now < k.free || c.power.clip || roleOf(c) === 'admin') {
    k.at = now;
    k.heard = now;
    k.carry = 0;
    k.lag = 0;
    k.owed = 0;
    k.high = 0;
    return true;
  }
  // (how long nothing had been heard from them before this, and what is still good of a silence just ended)
  const silent = (now - k.heard) / 1000;
  k.heard = now;
  if (now > k.lagTill) k.lag = 0;
  const dt = Math.min(600, Math.max(0, (now - k.at) / 1000)), most = c.seatAt ? CHECK.seat : CHECK.foot;
  const dist = Math.hypot(to[0] - c.pose[0], to[2] - c.pose[2]), allow = most * dt + k.carry + k.lag;
  // (in the air: written down and never refused. There are towers and roofs, and there is falling off things.)
  // (Over what there is to stand on, which on a bridge is its deck and not the ground far under it: `standAt`.)
  k.high = !c.seatAt && to[1] - world.standAt(to[0], to[1], to[2]) > CHECK.high[0] ? k.high + Math.min(dt, 1) : 0;
  if (k.high > CHECK.high[1]) {
    k.high = 0;
    flag(c, `is ${(to[1] - world.standAt(to[0], to[1], to[2])).toFixed(0)} m over the ground at ${to[0].toFixed(0)}, ${to[2].toFixed(0)}`, false);
    // (Once is a fall off the highest thing there is. Three times running, twelve seconds and more held thirty
    // metres up with nothing under them, is nothing anybody playing does: enforcing, they are put off.)
    if (++k.hovered >= 3 && CHECKS === 'enforce') {
      k.hovered = 0;
      TURNED.hover++;
      putOff(c, 'they were held in the air, far over the ground, for twelve seconds and more');
      return false;
    }
  } else if (!k.high) k.hovered = 0;
  // (What the grace lets go is owed, and is paid back out of whatever time is left over before any of that is
  // saved. It used to be let go every time and forgotten: anybody could go a little too fast for ever, and at
  // fifteen positions a second "a little" came to 45 m/s on top of a sprint; 11 m/s held for eighteen seconds was
  // not written down once (found 2026-10-13, measuring the slides). Owing `owe`, nothing more is let go until
  // some is paid.
  //
  // A LINE THAT IS HELD UP is not a cheat, and is not to be taken for one. A game says where it is fifteen times a
  // second whatever its line does, so a line held up for ten seconds lets go a hundred and fifty steps at once,
  // each the half metre of a run. With two seconds saved and thirty metres owed, forty-nine metres of that were
  // believed and every step after it refused and counted: fifty counts, and an honest runner was put off the
  // server, twice in the hour for six hours (found by an independent reading, with the real server, the same day
  // the debt went in, before it was ever live). So what legs cover in a SILENCE is saved, up to twelve seconds of
  // it (`lag`), and is good for the few seconds after the silence ends in which the burst comes; in one step as
  // readily as in a hundred and fifty (of a burst that long this server takes the first messages and lets the
  // rest fall, so what comes next is one step of twenty metres and more: a rule that no single message moves
  // anybody further than two seconds' worth put the same runner off, was tried for an hour, and was taken out).
  // It is saved out of silence and nothing else: saved by anybody at any time, twelve seconds would let whoever
  // walks blink a hundred metres every half minute, and the recorded slide with a jump of 37 m in it went by.
  // And whoever is refused only for being a little ahead of their legs, a step at a time, is held where they
  // were and written down, and NOT counted toward being put off: over a long enough silence that is a bad line,
  // and held back is all a cheat need be.
  const short = dist - allow;
  if (short <= CHECK.grace && (short <= 0 || k.owed + short <= CHECK.owe)) {
    k.at = now;
    if (short > 0) {
      k.owed += short;
      k.carry = 0;
      k.lag = 0;
    } else {
      const back = Math.min(k.owed, -short);
      k.owed -= back;
      const left = -short - back;
      k.carry = Math.min(most * CHECK.carry, left);
      // (what is over, out of a silence: kept for the burst that follows it, never added to by anything else)
      if (silent > 1) {
        k.lag = Math.min(most * CHECK.lag, left - k.carry);
        k.lagTill = now + CHECK.lagFor;
      } else k.lag = Math.min(k.lag, left - k.carry);
    }
    return true;
  }
  const ahead = short <= CHECK.grace;
  const what = `moved ${dist.toFixed(0)} m in ${dt.toFixed(2)} s ${c.seatAt ? 'in a jeep' : 'on foot'}, to ${to[0].toFixed(0)}, ${to[2].toFixed(0)}${ahead ? `, ${k.owed.toFixed(0)} m ahead of their legs already` : ''}`;
  if (ahead) {
    // (written down, no oftener than anything else is, and counted nowhere)
    if (now - k.said > 5000 && roleOf(c) !== 'admin') {
      k.said = now;
      log(`[check:${CHECKS}] ${c.name} ${what} (held, not counted)`);
    }
    if (CHECKS === 'enforce') return false;
    k.at = now;
    k.carry = 0;
    k.lag = 0;
    k.owed = 0;
    return true;
  }
  if (!flag(c, what)) {
    k.at = now;
    k.carry = 0;
    k.lag = 0;
    k.owed = 0;
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
const LOGOUT_STIR = 1.5;

const away = (c: Client, now = Date.now()) => c.asleep > 0 || now - c.heardAt > SILENT_MS;
/** a life new to the world leaves no body behind if its connection goes this soon; and a connection whose game has said nothing of where it is by this long after it was let in is not a game, and goes (ms) */
const FRESH_MS = (Number(process.env.FRESH_S) || 60) * 1000;
const NEVER_SPOKE_MS = (Number(process.env.NEVER_SPOKE_S) || 60) * 1000;
/** how many are in the world and awake: a body left behind is not somebody playing */
const awake = () => {
  let n = 0;
  for (const c of clients.values()) if (!c.asleep) n++;
  return n;
};
/** what has been turned away, for /healthz: by what */
const TURNED = { address: 0, flood: 0, origin: 0, silent: 0, hover: 0, flags: 0, banned: 0, captcha: 0, range: 0 };
/** when each connection lately said hello, by where it came from: see `flooding` */
const hellos = new Map<string, number[]>();
/** More hellos from one address in a minute than anybody playing sends (a game says it once, and again when its line drops). */
function flooding(ip: string): boolean {
  if (!publicIp(ip)) return false;
  const now = Date.now(), times = (hellos.get(ip) ?? []).filter((t) => now - t < 60_000);
  times.push(now);
  hellos.set(ip, times);
  if (hellos.size > 5000) for (const [k, v] of hellos) if (!v.some((t) => now - t < 60_000)) hellos.delete(k);
  return times.length > HELLOS_A_MINUTE;
}
const HELLOS_A_MINUTE = Number(process.env.HELLOS_A_MINUTE) || 20;

// ---- the bot check (2026-10-12: "lets build our own bot detector... no ip can reach the server and join the game
// without passing this bot check. the players character wont spawn in the game and they wont join the game server
// until they pass this check")
//
// Whoever asks to come in is dealt a range first (src/sim/range.ts): they are nobody in the world while they are
// on it, hold no place, and are seen by nobody. Their game says where its player stands and looks and what it
// fires; the judge here says whether the figures went down, and whether it was a person that put them down. It
// is asked of everybody, whatever role they have. Passed, it holds for a game at an address for BOTCHECK_HOURS
// (six), so that a line that drops is not the range again; whoever the checks put off the server shoots it again.
// On wherever the host is Render, and wherever BOTCHECK says so ("off": never).
const BOTCHECK = {
  on: process.env.BOTCHECK ? process.env.BOTCHECK !== 'off' : !!process.env.RENDER,
  ms: (process.env.BOTCHECK_HOURS === undefined ? 6 : Math.max(0, Number(process.env.BOTCHECK_HOURS) || 0)) * 3600_000,
  goes: 4,
  /** and the browser is asked what it is (BOTCHECK_ENV=off: not asked): one that says a program is driving it, or that draws with no graphics card, as a browser on a rented server does, has not passed whatever it shot */
  env: process.env.BOTCHECK_ENV !== 'off',
};
/** who has passed, and until when: by their game and where they play from */
const shooters = new Map<string, number>();
/**
 * Ranges dealt ahead. Dealing one is a hundred tryings some of the time, a tenth of a second of this server's one
 * thread with everybody's game waiting on it: so a few are kept ready, each dealt a trying at a time between
 * other things, and whoever asks to come in is handed one.
 */
const DEALT: RangeSpec[] = [];
let dealingNow = false;
function dealAhead() {
  if (dealingNow || !BOTCHECK.on || DEALT.length >= 8) return;
  dealingNow = true;
  const deal = dealing(1 + Math.floor(Math.random() * 2147483646));
  const step = () => {
    const s = deal.next();
    if (!s.done) return void setImmediate(step);
    DEALT.push(s.value);
    dealingNow = false;
    dealAhead();
  };
  setImmediate(step);
}
const nextRange = (): RangeSpec => {
  const spec = DEALT.shift() ?? rangeOf(1 + Math.floor(Math.random() * 2147483646));
  dealAhead();
  return spec;
};
dealAhead();
const RANGES = { dealt: 0, passed: 0, failed: 0, on: 0 };
function knownShooter(key: string, ip: string): boolean {
  if (!BOTCHECK.on) return true;
  if (!key || !BOTCHECK.ms) return false;
  const until = shooters.get(`${keyHash(key)}|${ip}`);
  return !!until && until > Date.now();
}

// ---- a person, and not a program (2026-10-12: "we should add a captcha or something")
//
// Cloudflare's Turnstile. On when its two keys are set here (TURNSTILE_SITEKEY, which anybody may know, and
// TURNSTILE_SECRET, which nobody but the owner and this server may). Somebody who asks to come in is then asked
// for the slip the check gives a person's browser (src/ui/person.ts), and Cloudflare is asked whether it is good.
// It is asked of everybody, every time they ask to come in, whatever role they have (2026-10-12: "it should be the
// interactive one blocking bots entirely. user cannot join the game unless they pass captcha"): a pass can be made
// to hold for a while for a game at an address by setting CAPTCHA_HOURS, and by default holds for none. If
// Cloudflare cannot be reached, or says no for any reason, they are turned away and may try again. What Cloudflare last said is told on /healthz (`captchaSays`), so that a secret
// set wrongly here, which is everybody turned away, can be told from outside for what it is.
const CAPTCHA = {
  site: process.env.TURNSTILE_SITEKEY ?? '',
  secret: process.env.TURNSTILE_SECRET ?? '',
  url: process.env.TURNSTILE_VERIFY_URL ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  ms: Math.max(0, Number(process.env.CAPTCHA_HOURS) || 0) * 3600_000,
};
const CAPTCHA_ON = !!CAPTCHA.site && !!CAPTCHA.secret;
/** who has shown they are a person, and until when: by their game and where they play from */
const persons = new Map<string, number>();
const personOf = (key: string, ip: string) => `${keyHash(key)}|${ip}`;
function knownPerson(key: string, ip: string): boolean {
  if (!CAPTCHA_ON) return true;
  if (!key || !CAPTCHA.ms) return false;
  const until = persons.get(personOf(key, ip));
  return !!until && until > Date.now();
}
/** how the asking has gone since this server started, and what Cloudflare said of the last slip it did not take */
const SLIPS = { passed: 0, failed: 0, unreachable: 0, last: [] as string[] };
/** @returns whether the slip is good; null if Cloudflare could not be asked */
async function goodSlip(slip: string, ip: string): Promise<boolean | null> {
  try {
    const body = new URLSearchParams({ secret: CAPTCHA.secret, response: slip });
    if (publicIp(ip) && !ip.includes('/')) body.set('remoteip', ip);
    const r = await fetch(CAPTCHA.url, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      SLIPS.unreachable++;
      return null;
    }
    const said = (await r.json()) as { success?: boolean; 'error-codes'?: unknown };
    if (said.success) {
      SLIPS.passed++;
      return true;
    }
    SLIPS.failed++;
    SLIPS.last = (Array.isArray(said['error-codes']) ? said['error-codes'] : []).filter((x): x is string => typeof x === 'string').slice(0, 4);
    // (the secret set on this server is not the one of the key it is set with: nobody at all will pass until it is put right)
    if (SLIPS.last.some((c) => /secret/.test(c))) log(`THE CAPTCHA SECRET IS NOT ACCEPTED BY CLOUDFLARE (${SLIPS.last.join(', ')}): nobody can come in until TURNSTILE_SECRET is put right, or taken away`);
    return false;
  } catch {
    SLIPS.unreachable++;
    return null;
  }
}
/** what worn things do to a hit: every plate and helmet they were last seen in (as their own game reckons it: Game.takeHit) */
const worn = (c: Client, k: 'armor' | 'head') => Object.values(c.inv?.slots ?? {}).flatMap((it) => (it && ITEMS[it.id]?.wear?.[k] !== undefined ? [ITEMS[it.id].wear![k] as number] : []));

/** Something has hit somebody whose game is not answering: it comes off the health the server holds for them. */
function keep(c: Client, amount: number, zone: string, w: string) {
  if (!c.alive || !away(c)) return;
  const v = (c.vitals ??= { health: 100, energy: 80, water: 80, stamina: MAX_STAMINA, bleeding: false, blood: BLOOD.full, bleed: 0 });
  let a = amount;
  if (w !== 'crash') for (const m of zone === 'torso' ? worn(c, 'armor') : zone === 'head' ? worn(c, 'head') : []) a *= m;
  v.health = Math.max(0, v.health - a);
  c.kept = true;
  // (A hit takes health; a wound takes blood, which is another thing: src/sim/blood.ts. A round takes a hundred of
  // it going in, and nearly always opens a wound, the infected and a blade often, a blast or a blow seldom; and a
  // wound bleeds by what made it and where, beside whatever others are open.)
  // (a blast: either grenade, a fuel drum, a car going up)
  const gun = !!ITEMS[w]?.weapon, blast = !!WEAPON_RULES[w]?.blast || w === 'fire';
  if (gun) v.blood = Math.max(0, bloodOf(v) - BLOOD.shot);
  if (w !== 'crash' && Math.random() < (gun ? (a > 12 ? 0.85 : 0.4) : w === 'infected' ? INFECTED.bleed : 0.25)) {
    v.bleed = withWound(v.bleeding ? bleedOf(v) : 0, woundOf(gun ? 'shot' : w === 'infected' ? 'bite' : blast ? 'blast' : 'blunt', zone));
    v.bleeding = true;
    c.bled = 0;
  }
  // (after whoever dealt it has been told it landed)
  if (v.health <= 0) setImmediate(() => kill(c, w === 'infected' ? 'the infected' : ITEMS[w]?.name ? 'wounds' : w));
  else if (bloodOf(v) <= BLOOD.dead) setImmediate(() => kill(c, 'blood loss'));
}

/** Once a second: the wounds of those whose lives the server is keeping, the bodies left behind whose time is up, and the waits to leave that are over. */
function keeping(now: number) {
  for (const c of [...clients.values()]) {
    if (c.asleep && now - c.asleep >= LINGER_MS) {
      log(`${c.name}'s body has been left ${Math.round(LINGER_MS / 1000)} s: it goes, with what it carried`);
      drop(c);
      continue;
    }
    if (!c.spoke && !c.asleep && now - c.since > NEVER_SPOKE_MS) {
      log(`${c.name} (#${c.id}) has said nothing of where they are in ${Math.round(NEVER_SPOKE_MS / 1000)} s: not a game, and gone`);
      TURNED.silent++;
      send(c, { t: 'kick', reason: 'Your game did not start in time. Press Play again.' });
      drop(c);
      c.ws.close();
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
    // (their wounds go on bleeding while their game says nothing: blood, by what the wounds cost, and it closes
    // by itself in the end as it does for anybody. It took a health a second, and stopped after forty-two.)
    c.kept = true;
    v.bleed = bleedOf(v);
    v.blood = Math.max(0, bloodOf(v) - v.bleed);
    if (++c.bled > BLOOD.clots) {
      v.bleeding = false;
      v.bleed = 0;
      c.bled = 0;
    }
    if (v.blood <= BLOOD.dead) kill(c, 'blood loss');
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
  // (A body is left by somebody who was playing. A connection whose game never said where it stood, or one new to
  // the world that went within its first minute, was nobody to leave one: 2026-10-12, connections made by a
  // program came and went by the dozen, and each left a body for five minutes that held a place on the server
  // and stood in everybody's way.)
  if (!c.spoke || (!c.resumed && Date.now() - c.since < FRESH_MS)) return void drop(c);
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

/**
 * A grenade has gone off in the hand that held it (2026-10-13, with grenades that are cooked: "hold to cook the
 * grenade for multiple seconds before throwing it", and one held too long goes off where it is). Everybody else is
 * shown it where its holder stands. What it did to the holder their own game reckons, as it does for any grenade of
 * its own; here it is counted among what they have taken, all of it and through no armour (`arms`: no plate is
 * between a hand and its owner), so that whoever is still on their feet after it is found by `standing`, and
 * whoever's game is not answering dies of it by the server's hand (`keep`). See src/sim/grenades.ts.
 */
function handBlast(c: Client, w: string, at: Vec3) {
  broadcast({ t: 'nade', id: c.id, o: at, v: [0, 0, 0], w, f: 0 }, c);
  if (c.alive && !c.power.god) dealt(c, inHandDamage(w), 'arms', w);
}
/** Four times a second: a pin that is out, a fuse that has run down, and nothing said of the grenade. It went off in the hand. */
function inHands(now: number) {
  for (const c of clients.values()) {
    const went = c.nades.held ? overdue(c.nades, [c.pose[0], c.pose[1], c.pose[2]], now) : null;
    if (went) handBlast(c, went.w, went.from);
  }
}
setInterval(() => inHands(Date.now()), 250);

/**
 * A grenade that fell from a dead hand has gone off where it lay (`fallen` in src/sim/grenades.ts: whoever dies
 * with the pin out lets go of it, and it goes off when its fuse ends, "for whoever is in reach, as any grenade on
 * the ground would"). Nobody's game is asked anything of it: where it lay and when it went off are the server's
 * own, and so is whom it reached, by how far each stands from it, as a car that burns is reckoned. Whoever is in
 * reach is hurt by it through what they wear, and it is the dead holder's doing; the infected in reach and a car
 * in reach take it too. (There are no walls in the server's world: none stops it, as none stops a burning car's.)
 */
function fellBlast(by: Client, w: string, at: Vec3) {
  const rule = WEAPON_RULES[w], now = Date.now();
  for (const o of clients.values()) {
    if (!o.alive || o.power.god) continue;
    const amount = lyingBlast(w, at, [o.pose[0], o.pose[1] + 1.1, o.pose[2]]);
    if (amount <= 0) continue;
    const len = Math.max(0.001, Math.hypot(o.pose[0] - at[0], o.pose[2] - at[2]));
    o.lastHitBy = { id: by.id, name: by.name, w, zone: 'torso', dist: Math.hypot(o.pose[0] - at[0], o.pose[1] - at[1], o.pose[2] - at[2]), at: now };
    dealt(o, amount, 'torso', w);
    send(o, { t: 'dmg', from: by.id, amount, zone: 'torso', w, dir: [(o.pose[0] - at[0]) / len, 0, (o.pose[2] - at[2]) / len] });
  }
  for (const [i, b] of horde.bodies) {
    const r = b.diedAt ? null : horde.hurt(i, lyingBlast(w, at, [b.s[0], b.s[1] + 1.2, b.s[2]]), now);
    if (!r) continue;
    if (r.dead) {
      // what it had on it falls where it does
      const had = infectedDrop();
      if (had) economy.drop(makeItem(had[0], had[1]), b.s[0] + (Math.random() - 0.5) * 0.8, b.s[1] + 0.03, b.s[2] + (Math.random() - 0.5) * 0.8, Math.random() * Math.PI * 2);
    }
    const len = Math.max(0.001, Math.hypot(b.s[0] - at[0], b.s[2] - at[2]));
    broadcast({ t: 'ihp', i, hp: r.hp, dead: r.dead, by: by.id, zone: 'torso', dir: [(b.s[0] - at[0]) / len, (b.s[2] - at[2]) / len], melee: false });
  }
  // (a car is reached from seven tenths as far as a body, as it is by a grenade that was thrown)
  for (const v of [...vehicles.values()]) if (!v.goneAt && Math.hypot(v.s[0] - at[0], v.s[1] - at[1], v.s[2] - at[2]) < rule.blast! * 0.7) hurtJeep(v, carDamage(rule), by);
}

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
const BANS = { keys: new Set(listOf(process.env.BAN_KEYS)), ips: new Set(listOf(process.env.BAN_IPS)), temp: new Map<string, { until: number; why: string; name?: string }>(), strikes: new Map<string, number[]>() };
/**
 * Whoever is kept off for a while (by the checks, or timed out by an admin), one line for each player and not one
 * for each of the two things they are kept off by (their game's key and their address).
 * 2026-10-13: a player was kept off for six hours by a check that was wrong about them ("he says hes in offline
 * mode and cant play"), and there was nowhere it could be seen and no way to lift it short of a restart.
 */
function keptOffNow(now = Date.now()): { name: string; why: string; until: number; keys: string[] }[] {
  const out: { name: string; why: string; until: number; keys: string[] }[] = [];
  for (const [k, b] of BANS.temp) {
    if (b.until <= now) {
      BANS.temp.delete(k);
      continue;
    }
    const same = out.find((o) => o.name === (b.name ?? k) && o.why === b.why && Math.abs(o.until - b.until) < 2000);
    if (same) same.keys.push(k);
    else out.push({ name: b.name ?? k, why: b.why, until: b.until, keys: [k] });
  }
  return out.sort((a, b) => a.until - b.until);
}
/** what somebody turned away at the door is told: that they are kept off, for about how long, and what to do if it is wrong */
function doorWords(key: string, ip: string, off: string): string {
  if (off === 'banned') {
    const k = keyHash(key);
    const b = ADMIN.state.bans.find((x) => x.key === k) ?? ADMIN.state.bans.find((x) => !!ip && x.ip === ip);
    return `You are banned from this server${b?.why ? `: ${b.why}` : '.'}`;
  }
  const now = Date.now();
  const b = [key, ...(ip ? [`ip:${ip}`] : [])].map((n) => BANS.temp.get(n)).find((x) => x && x.until > now);
  if (!b) return 'You are kept off this server for now.';
  const mins = Math.max(1, Math.ceil((b.until - now) / 60000));
  const long = mins >= 90 ? `${Math.round(mins / 60)} hours` : `${mins} minute${mins === 1 ? '' : 's'}`;
  return off.startsWith('timed out') ? `You are kept off this server for about ${long} more (${off}).` : `You are kept off this server for about ${long} more: its checks put you off it more than once. If you were only playing, tell an admin on the Discord and they can lift it.`;
}
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
  /** the colour an admin has chosen for the word ADMIN before their name in the chat, by their number (none: the rainbow) */
  tints: new Map<number, string>(),
  /** what each admin has chosen for their own death, by their key: it is theirs again when they come back */
  voids: new Map<string, { voidInv: boolean; voidTag: boolean }>(),
};
const keyHash = (key: string) => createHash('sha256').update(`zona key ${key}`).digest('hex').slice(0, 40);
/** Is this an address out in the world? (Not this machine's own, nor one of a private network: those are whatever stands in front of the server, and are everybody's.) */
const publicIp = (ip: string) => !!ip && !/^(::1$|0:0:0:0::|::ffff:127\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);
const ipHash = (ip: string) => (publicIp(ip) && ADMIN.pepper ? createHash('sha256').update(`${ADMIN.pepper} ${ip}`).digest('hex').slice(0, 40) : '');
/**
 * A server on somebody's own machine makes whoever plays on it an admin (LOCAL_ADMIN=1), so that what an admin has
 * can be tried there without the site's password: "i should have admin panel locally", 2026-10-13. Never where the
 * host is Render, and never on a server that answers to a site anywhere but this machine.
 */
const LOCAL_ADMIN = process.env.LOCAL_ADMIN === '1' && !process.env.RENDER && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(SITE_URL);
if (LOCAL_ADMIN) console.log('[admin] LOCAL_ADMIN: everybody on this server is an admin');
const roleOf = (c: Client): Role | null => (LOCAL_ADMIN ? 'admin' : ADMIN.state.roles[keyHash(c.key)]?.role ?? null);
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
  // (Not counted: a body left behind by a connection that has gone. It was, for the five minutes it lies there:
  // and whoever came back in another browser, on another device, or with a browser that had forgotten who they
  // were, was told somebody was already playing from their connection, with one window open. 2026-10-12: "people
  // swear they only have 1 window open but then get blocked". A tag off such a body is still not paid to
  // somebody at its own address: see notEarned.)
  return [...clients.values()].filter((o) => o.ip === ip && o.key !== key && !roleOf(o) && !o.asleep).length >= PER_ADDRESS;
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
// (100 s: on 2026-10-12 02:30 UTC a server waited 25 s after the world reached it, and the one before it, which the
// host tells to stop a minute after that, had not yet said its last word: everybody came back as they had been ten
// minutes before. A server of this build says its last word as soon as it sees it has been replaced: see `replaced`.)
const KEEP_WAIT_MS = (process.env.KEEP_WAIT_S === undefined ? 100 : Math.max(0, Number(process.env.KEEP_WAIT_S) || 0)) * 1000;
/** however long the server before this one goes on answering, it is not waited for longer than this */
const KEEP_MAX_MS = (process.env.KEEP_MAX_S === undefined ? 420 : Math.max(0, Number(process.env.KEEP_MAX_S) || 0)) * 1000;
/**
 * And a copy the site says has been written but cannot be read yet is waited for this long from when it first said
 * so (2026-10-13 01:44 UTC: the last word was written, the store would not be read for the hundred seconds after
 * it, this server gave up and went on with what it had read before, 68 minutes old: see api/keep.ts).
 */
const KEEP_STALE_MS = (process.env.KEEP_STALE_S === undefined ? 360 : Math.max(0, Number(process.env.KEEP_STALE_S) || 0)) * 1000;
/**
 * Where the world reaches this server from outside (Render says: RENDER_EXTERNAL_URL). At a deploy the server
 * before this one goes on answering there until this one is ready, and only then is told to stop: asked there who
 * it is, a server knows whether it is the one being reached yet. (OTHER_URL: for a test of that, with two on one
 * machine.)
 */
const PUBLIC_URL = (process.env.OTHER_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
/** who answers at the public address: this server (true), another (false), nobody (null) */
async function reachedHere(): Promise<boolean | null> {
  if (!PUBLIC_URL) return true;
  try {
    const r = await fetch(`${PUBLIC_URL}/healthz`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? ((await r.json()) as { boot?: string }).boot === BOOT : null;
  } catch {
    return null;
  }
}

/**
 * A restart, said to everybody before it happens (2026-10-12: "would be great if could have a banner overhead that
 * says server restarting, then reason"). Nobody tells a server it is about to be replaced until the moment it is
 * told to stop, so it finds out for itself: it is run from a commit (Render says which, and of what), and every
 * minute and a half it asks where that came from what the newest one is. When that is no longer its own, the one
 * that will replace it is being built: it says so to everybody on, with why, as the note that came with the new one
 * says (server/restart-note.json, written by whoever made the change). And a server told to stop says so to whoever
 * is still on, as its last word to them. (An admin can say it by hand as well: `/restart`.)
 */
const RESTART = {
  /** why this server was started, as the note that came with it says */
  why: (() => {
    try {
      return String((JSON.parse(readFileSync(path.join(ROOT, 'server', 'restart-note.json'), 'utf8')) as { why?: unknown }).why ?? '').slice(0, 120);
    } catch {
      return '';
    }
  })(),
  /** something newer than this server has been seen to be on its way (when), and why it is coming */
  seen: 0,
  pending: null as string | null,
  /** how long the host takes to have the new one ready, about: what the count on everybody's screen starts from */
  about: Math.max(20, Number(process.env.RESTART_ABOUT_S) || 150),
};
function sayRestart(why: string, seconds: number) {
  log(`[restart] said to ${clients.size}: restarting${seconds ? ` in ${seconds} s` : ''}${why ? ` (${why})` : ''}`);
  broadcast({ t: 'restart', why: why.slice(0, 120), in: Math.max(0, Math.round(seconds)) });
}
{
  const mine = process.env.RENDER_GIT_COMMIT, slug = process.env.RENDER_GIT_REPO_SLUG, branch = process.env.RENDER_GIT_BRANCH || 'main';
  // (WATCH_URL: for a test of it. It answers with the newest commit's name, and with the note under /note/<name>.)
  const at = process.env.WATCH_URL;
  if (process.env.RESTART_WATCH !== 'off' && ((mine && slug) || at)) {
    const head = at ? `${at}/head` : `https://api.github.com/repos/${slug}/commits/${branch}`;
    const note = (sha: string) => (at ? `${at}/note/${sha}` : `https://raw.githubusercontent.com/${slug}/${sha}/server/restart-note.json`);
    setInterval(async () => {
      if (RESTART.seen || stopping) return;
      try {
        const r = await fetch(head, { headers: { accept: 'application/vnd.github.sha', 'user-agent': 'zona-server' }, signal: AbortSignal.timeout(8000) });
        const sha = r.ok ? (await r.text()).trim() : '';
        if (!/^[0-9a-f]{7,64}$/.test(sha) || sha === (mine ?? process.env.WATCH_MINE)) return;
        RESTART.seen = Date.now();
        let why = '';
        try {
          const n = await fetch(note(sha), { signal: AbortSignal.timeout(8000) });
          if (n.ok) why = String(((await n.json()) as { why?: unknown }).why ?? '').slice(0, 120);
        } catch {
          /* no note came with it: it is said without a reason */
        }
        sayRestart(why, RESTART.about);
        // (and to whoever comes in before it happens)
        RESTART.pending = why;
        // (and everything kept is written now, while this server is certainly alive: see `keepBefore`)
        void keepBefore('a newer server is being built', 5 * 60_000);
      } catch {
        /* not answered: asked again in a while */
      }
    }, Math.max(2, Number(process.env.RESTART_WATCH_S) || 90) * 1000).unref();
  }
}
const WIPE = (process.env.WIPE ?? '').slice(0, 40);
const KEPT = {
  /** what was kept has been read (or there was nothing, or it is not kept here): players are let in */
  ready: !KEEP_ON,
  /** characters from before this server started, by the hash of their key, until their players come for them */
  chars: new Map<string, Record_>(),
  /** the file says this server is alive; something has happened since it was last written; when that was; a writing is under way */
  claimed: false,
  /** what was kept has been read and taken in (or there was nothing): only then is anything written over it */
  read: false,
  /** when the newest copy this server has read was written ('': there was none). The site writes nothing of this server's over a newer one. */
  seen: '',
  /** the store's mark for what this server last wrote: said with its next writing, which is then made though the store cannot be read (see api/keep.ts) */
  mark: '',
  dirty: false,
  savedAt: 0,
  busy: false,
  /** what became of what was kept when this server started, in a line (it is on /healthz: a count and a time, nobody's anything) */
  how: 'not read yet',
  /** what became of the last writing this server made, in a line (on /healthz as `saved`: whether a save was made is read there, not guessed) */
  last: 'nothing written by this server yet',
};
keptListed = true;
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

interface Snapshot {
  rev: number;
  wipe: string;
  chars: [string, Record_][];
  /** what is under the ground */
  stashes: Box[];
  /** the containers lying on it: each a thing with what is in it, where it lies, and when it was dropped */
  loose?: { item: ItemInstance; x: number; y: number; z: number; rot: number; at: number }[];
  /** the hearts and the comments under the changelog's entries (see src/sim/news.ts) */
  news?: NewsKept;
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
async function siteKeep(op: Record<string, unknown>): Promise<{ ok?: boolean; why?: string; save?: KeptFile | null; stale?: boolean; newer?: boolean; mark?: string } | null> {
  if (!ADMIN.pepper) return null;
  const body = JSON.stringify(op), at = String(Date.now());
  const sig = createHmac('sha256', `zona keep ${ADMIN.pepper}`).update(`${at}.${createHash('sha256').update(body).digest('hex')}`).digest('hex');
  try {
    const r = await fetch(`${SITE_URL}/api/keep`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zona-at': at, 'x-zona-auth': sig }, body, signal: AbortSignal.timeout(20_000) });
    return r.ok ? ((await r.json()) as { ok?: boolean; why?: string; save?: KeptFile | null; stale?: boolean; newer?: boolean; mark?: string }) : null;
  } catch {
    return null;
  }
}

/**
 * The changelog's hearts and comments (2026-10-12: "can we add a blog/forum layout to the changelog so users can
 * heart the changelog posts, as well as leave a comment ... public comment section"). Held here, because this
 * server is always there and the site keeps next to nothing (its file store allows two thousand writes a month,
 * and the payouts live on them): they go into what is kept with everything else, at the times that is written,
 * and not once more. What a server that dies without a last word had heard since it last wrote is lost with it.
 * The rules are in src/sim/news.ts; the page is public/changelog/index.html.
 */
const news = new News();
{
  // the entries there are to speak under: the page as this server was built with it, and then the page as the site
  // serves it (a new entry goes out with the site, and may be days ahead of this server)
  const ids = (html: string) => new Set([...html.matchAll(/<article class="entry" id="([a-z0-9][a-z0-9-]{1,47})"/g)].map((m) => m[1]));
  try {
    const own = ids(readFileSync(path.join(ROOT, 'public', 'changelog', 'index.html'), 'utf8'));
    if (own.size) news.known = own;
  } catch {
    /* no page here: whatever is asked of is taken, up to so many entries */
  }
  const look = () =>
    void fetch(`${SITE_URL}/changelog/`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        const live = ids(html);
        if (live.size) news.known = new Set([...(news.known ?? []), ...live]);
      })
      .catch(() => {});
  setTimeout(look, 15_000).unref();
  setInterval(look, 10 * 60_000).unref();
}

/** everything that is kept, as it is this moment */
function snapshot(): Snapshot {
  const now = Date.now(), chars = new Map<string, Record_>(KEPT.chars);
  for (const [k, r] of records) if (r.alive && r.inv) chars.set(keyHash(k), r);
  for (const c of clients.values()) if (c.alive && c.inv) chars.set(keyHash(c.key), { pose: c.pose, inv: c.inv, vitals: c.vitals, alive: true, leftAt: now });
  // (no more of them than can be carried: the newest, if it ever came to that)
  const newest = [...chars].sort((a, b) => b[1].leftAt - a[1].leftAt).slice(0, 6000);
  const loose = [...economy.loot.values()].filter((l) => l.keptAt !== undefined).map((l) => ({ item: l.item, x: l.x, y: l.y, z: l.z, rot: l.rot, at: l.keptAt! }));
  return { rev: WORLD_REV, wipe: WIPE, chars: newest, stashes: [...boxes.values()].filter((b) => b.kind === 'stash' && b.buried), loose, news: news.keep() };
}

/** What is kept is written to the site. @param final this server's last word @returns whether it was */
async function keepNow(final: boolean, why: string): Promise<boolean> {
  // (a last word waits its turn behind a writing already under way: it used to give up at once, and the server
  // then stopped with what that other writing had happened to say)
  if (final) for (let waited = 0; KEPT.busy && waited < 8000; waited += 200) await pause(200);
  // (a server that never read what was kept does not write over it: what it holds is not what there is)
  if (!KEEP_ON || !KEPT.ready || !KEPT.read || !ADMIN.pepper || KEPT.busy) return false;
  // (a server nobody came to has nothing to say that the file does not say already)
  if (!KEPT.claimed && !KEPT.dirty) return false;
  KEPT.busy = true;
  try {
    let snap = snapshot();
    for (let tries = 0; tries < 3; tries++) {
      const r = await siteKeep({ op: 'save', at: new Date().toISOString(), boot: BOOT, final, z: seal(snap), seen: KEPT.seen, ...(KEPT.mark ? { mark: KEPT.mark } : {}) });
      // (What is kept is newer than anything this server has read: the server before it said its last word after
      // this one had stopped waiting for it. It is taken in, for everybody who has not come back yet, and then
      // this server's writing is of both.)
      if (r?.newer && r.save) {
        takeInLate(r.save);
        snap = snapshot();
        continue;
      }
      if (r?.ok) {
        KEPT.claimed = true;
        KEPT.dirty = clients.size > 0;
        KEPT.savedAt = Date.now();
        KEPT.mark = typeof r.mark === 'string' ? r.mark : '';
        KEPT.last = `${snap.chars.length} characters and ${snap.stashes.length + (snap.loose?.length ?? 0)} stashes written at ${new Date().toISOString()} (${why}${final ? ': the last word' : ''})`;
        log(`[keep] ${why}: ${snap.chars.length} characters and ${snap.stashes.length + (snap.loose?.length ?? 0)} stashes written to the site${final ? ' (the last word)' : ''}`);
        return true;
      }
      await pause(700);
    }
    KEPT.last = `could NOT be written at ${new Date().toISOString()} (${why})`;
    log(`[keep] ${why}: it could NOT be written to the site`);
    return false;
  } finally {
    KEPT.busy = false;
  }
}

/**
 * A copy that turned up after this server had opened: the last word of the server before it, written (or readable)
 * only once this one had stopped waiting. Whoever has not come back since this server started is as that copy
 * has them; whoever has is left as they are, with what they have been doing since. Stashes it has that this
 * server has not are put where they were.
 */
function takeInLate(save: KeptFile) {
  KEPT.seen = save.at;
  let snap: Snapshot;
  try {
    snap = unseal(save.z) as Snapshot;
  } catch (e) {
    return void log(`[keep] a newer copy (${save.at}) could not be opened, and is written over: ${e instanceof Error ? e.message : e}`);
  }
  if ((snap.wipe ?? '') !== WIPE) return void log(`[keep] a newer copy (${save.at}) is of another world, and is written over`);
  const moved = snap.rev !== WORLD_REV, now = Date.now();
  const back = new Set([...[...clients.values()].map((c) => keyHash(c.key)), ...[...records.keys()].map((k) => keyHash(k))]);
  const carried = new Set<string>();
  for (const c of clients.values()) for (const it of things(c.inv)) carried.add(it.uid);
  let chars = 0, stashes = 0;
  for (const [k, r] of snap.chars ?? []) {
    try {
      if (back.has(k) || !r?.inv || !r.alive || now - r.leftAt > RECORD_LIFETIME || !isPose(r.pose)) continue;
      const had = KEPT.chars.get(k);
      if (had && had.leftAt >= r.leftAt) continue;
      const inv = cleanInventory(r.inv);
      for (const it of things(inv)) issue(it);
      KEPT.chars.set(k, { pose: r.pose, inv, vitals: r.vitals, alive: true, leftAt: r.leftAt, ...(moved || r.afresh ? { afresh: true } : {}) });
      chars++;
    } catch {
      /* one that cannot be made sense of is left as this server had them */
    }
  }
  for (const b of snap.stashes ?? []) {
    // (not one that is in this world already: under the ground, lying on it, or in somebody's hands who is back)
    if (b?.kind !== 'stash' || !b.buried || typeof b.cid !== 'string' || boxes.has(b.cid) || economy.loot.has(b.cid) || carried.has(b.cid) || ![b.x, b.y, b.z, b.rot].every(num)) continue;
    const items = (Array.isArray(b.items) ? b.items : []).flatMap((s) => {
      const it = cleanItem(s);
      return it ? [{ ...it, x: s.x, y: s.y, rot: !!s.rot }] : [];
    });
    for (const it of items) issue(it);
    const box: Box = { ...b, items, y: moved ? world.groundAt(b.x, b.z) : b.y, emptiedAt: -1, touchedAt: num(b.touchedAt) ? b.touchedAt : now };
    if (Math.abs(box.y - b.y) > 1) log(`[keep] a stash at ${Math.round(b.x)}, ${Math.round(b.z)} lies on ground that has moved ${(box.y - b.y).toFixed(1)} m: it is set on the new ground`);
    boxes.set(b.cid, box);
    // (and everybody on is shown it, as they are shown one that is buried while they watch)
    broadcast({ t: 'stash+', s: { uid: box.cid, x: box.x, y: box.y, z: box.z, rot: box.rot, ...(box.item ? { item: box.item } : {}), buried: true } });
    stashes++;
  }
  // (Whoever this server had from the older copy and the later one has not: they died, or their time ran out,
  // before the last word. Not back, they are not kept alive by a copy that was out of date.)
  const late = new Set((snap.chars ?? []).map(([k]) => k));
  let gone = 0;
  for (const k of [...KEPT.chars.keys()]) if (!late.has(k) && !back.has(k)) (KEPT.chars.delete(k), gone++);
  KEPT.how += `; and the last word of the server before, written at ${save.at}, came after: ${chars} characters and ${stashes} stashes were taken from it${gone ? `, and ${gone} who had died before it are no longer kept` : ''}`;
  log(`[keep] a newer copy (${save.at}${save.final ? ', a last word' : ''}) turned up after this server had opened: ${chars} characters who have not come back yet, and ${stashes} stashes, are as it has them`);
}

/**
 * This server opened without the last word of the one before it (it never came while this one waited, or the
 * site could not be read at all). It goes on being looked for, every twenty seconds for a quarter of an hour, and
 * is taken in the moment it can be read: not left until this server's next writing happens to be refused, which
 * may be three hours off, with everybody who comes back meanwhile given what was out of date.
 */
let lateWatching = false;
function lateWatch() {
  if (lateWatching || !KEEP_ON) return;
  lateWatching = true;
  const began = Date.now();
  const look = async () => {
    const r = await siteKeep({ op: 'load' });
    if (r?.ok) {
      const save = r.save ?? null;
      // (never read until now: from here on this server may write, and knows what it writes over)
      if (!KEPT.read) {
        KEPT.read = true;
        if (!save) KEPT.seen = '';
      }
      if (save && save.boot !== BOOT && save.at > KEPT.seen) return void takeInLate(save);
      // (the file is this server's own by now, or a last word it has already: nothing more is coming)
      if (save && (save.boot === BOOT || save.final)) return;
    }
    if (Date.now() - began < 15 * 60_000) setTimeout(() => void look(), 20_000).unref();
  };
  setTimeout(() => void look(), 20_000).unref();
}

/** The first player of this run has come in: the file is made to say a server is alive, with more to say. */
function claim() {
  KEPT.dirty = true;
  if (KEEP_ON && KEPT.ready && !KEPT.claimed && !KEPT.busy) void keepNow(false, 'somebody is on');
}
setInterval(() => {
  if (KEEP_EVERY_MS && KEPT.dirty && Date.now() - KEPT.savedAt >= KEEP_EVERY_MS) void keepNow(false, 'time has gone by');
}, Math.max(1000, Math.min(60_000, KEEP_EVERY_MS || 60_000))).unref();

/**
 * Everything kept is written NOW, because this server is about to be replaced (2026-10-13, after a deploy at which
 * the server before stopped without its last word and everybody came back as they had been 68 minutes earlier:
 * "why do you not take a snapshot before running restart commands? ... cant you make a script ... to trigger a save
 * before the restart is even told to render?"). A last word is the best there is and is still said; it is no longer
 * the only thing between a deploy and an hours-old file. This is asked for three ways: by whoever is about to
 * deploy (`deploying`, below: scripts/deploy.mjs will not push until it has been answered), by this server itself
 * the moment it sees something newer has been published (the RESTART watch), and by an admin's `/save`.
 * @returns whether what there is to keep is on the site as of now, and a line saying what was done
 */
async function keepBefore(why: string, fresh = 0): Promise<{ ok: boolean; said: string }> {
  if (!KEEP_ON) return { ok: true, said: 'nothing is kept by this server' };
  if (!KEPT.ready || !KEPT.read) return { ok: false, said: 'what was kept has not been read yet: nothing is written over it' };
  // (written within `fresh` ms, by whoever announced the deploy: not written again. Every writing leaves the store
  // unreadable for a minute or two, and the last word is coming.)
  if (fresh && KEPT.savedAt && Date.now() - KEPT.savedAt < fresh) return { ok: true, said: KEPT.last };
  if (!KEPT.claimed && !KEPT.dirty) return { ok: true, said: 'nobody has been on since it was last written: the file says all there is' };
  for (let waited = 0; KEPT.busy && waited < 15_000; waited += 250) await pause(250);
  const ok = await keepNow(false, why);
  return { ok, said: KEPT.last };
}

/** where a branch of the repository this server was built from stands now (null: it could not be told) */
async function branchHead(branch: string): Promise<string | null> {
  const at = process.env.WATCH_URL, slug = process.env.RENDER_GIT_REPO_SLUG;
  try {
    // (WATCH_URL: for a test of it, as for the RESTART watch)
    if (at) {
      const r = await fetch(`${at}/branch/${branch}`, { signal: AbortSignal.timeout(8000) });
      return r.ok ? (await r.text()).trim() : null;
    }
    if (!slug) return null;
    // (asked as git itself asks: every branch and where it stands, this instant. Not the API first: that answers an
    // address sixty times an hour and no more, and the host's address is shared.)
    const r = await fetch(`https://github.com/${slug}.git/info/refs?service=git-upload-pack`, { headers: { 'user-agent': 'git/2.40.0' }, signal: AbortSignal.timeout(8000) });
    const m = r.ok ? new RegExp(`([0-9a-f]{40}) refs/heads/${branch}\n`).exec(await r.text()) : null;
    if (m) return m[1];
    const a = await fetch(`https://api.github.com/repos/${slug}/commits/${branch}`, { headers: { accept: 'application/vnd.github.sha', 'user-agent': 'zona-server' }, signal: AbortSignal.timeout(8000) });
    const sha = a.ok ? (await a.text()).trim() : '';
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * "A deploy is coming", said to this server over the web by whoever is about to make one: GET /deploying?sha=...
 * It writes everything kept, and answers with what it wrote, before the host has been told anything at all.
 *
 * What is asked of whoever says so is a push, and nothing they must be trusted with: the commit they name has to
 * be where the branch `deploying` of this server's own repository stands. Nobody who cannot push there can make
 * this server write once (the store allows two thousand writes a month, and the payouts live on them); whoever
 * can, could have deployed anyway. One commit is written for once, and the branch is looked at no oftener than
 * every twenty seconds.
 */
const DEPLOY = { sha: '', lookedAt: 0, busy: false };
async function deploying(url: URL, res: http.ServerResponse) {
  const say = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const sha = url.searchParams.get('sha') ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) return say(400, { ok: false, why: 'which commit? ?sha= and its forty letters' });
  if (sha === DEPLOY.sha) return say(200, { ok: true, again: true, saved: KEPT.last, boot: BOOT });
  if (DEPLOY.busy || Date.now() - DEPLOY.lookedAt < 20_000) return say(429, { ok: false, why: 'asked a moment ago: again in twenty seconds' });
  DEPLOY.busy = true;
  DEPLOY.lookedAt = Date.now();
  try {
    const head = await branchHead('deploying');
    if (head !== sha) return say(403, { ok: false, why: head ? 'that is not where the deploying branch stands' : 'the deploying branch could not be read' });
    const r = await keepBefore('a deploy is coming');
    if (r.ok) DEPLOY.sha = sha;
    log(`[keep] told a deploy is coming (${sha.slice(0, 7)}): ${r.said}`);
    say(r.ok ? 200 : 503, { ok: r.ok, saved: r.said, boot: BOOT });
  } catch {
    say(500, { ok: false, why: 'it went wrong here' });
  } finally {
    DEPLOY.busy = false;
  }
}

/** What was kept is read, and the world is as it was left: then players are let in. */
async function loadKept() {
  const open = (what: string) => {
    if (KEPT.ready) return;
    KEPT.ready = true;
    KEPT.how = what;
    log(`[keep] ${what}`);
    fillFromQueue();
  };
  if (!KEEP_ON) return;
  try {
    // The secret it is read with comes with the admin lists (see `loadAdmin`), and the site gives those only to a
    // server it can reach at the address the world reaches it at. At a deploy that address is still the server
    // before this one's, until this one is ready: so the secret is waited for as long as another server answers
    // there, and for a minute after this one does. (It used to be waited for 35 seconds from this server's start,
    // and a server that had not been reached by then opened with nothing kept. Worse, it then wrote that over
    // what was kept. A server that has not read what was kept writes nothing now: see `KEPT.read`.)
    const began = Date.now();
    for (let mine = 0; !ADMIN.pepper; ) {
      const here = await reachedHere();
      if (here === false) mine = 0;
      else if (!mine) mine = Date.now();
      if ((mine && Date.now() - mine >= Math.max(KEEP_WAIT_MS, 60_000)) || Date.now() - began >= KEEP_MAX_MS) break;
      await pause(1000);
    }
    if (!ADMIN.pepper) return open('what is kept could NOT be read: the site did not answer, or no admin password is set on it. Everybody begins afresh, and nothing is written over what is kept');
    let save: KeptFile | null = null;
    // What is kept was written by a server that has not said its last word: at a deploy that server is alive, and
    // goes on being the one players reach until this one is ready. Only then is it told to stop, and only then
    // does it say its last word. So it is waited for: for as long as it is another server that answers where the
    // world reaches this one, and for KEEP_WAIT after this one does (the other has been told to stop by then, and
    // its last word comes in seconds or not at all). (It used to be waited for 25 seconds from this server's own
    // start, whatever the other was doing: on the night of 2026-10-11 the other was told to stop a few seconds
    // after that, and everybody came back as they had been two hours before.)
    let read = false;
    for (let mine = 0, stale = 0; ; ) {
      const r = await siteKeep({ op: 'load' });
      if (r?.ok) {
        save = r.save ?? null;
        read = true;
        stale = 0;
      }
      if (r?.ok && (!save || save.final || save.boot === BOOT)) break;
      // (The site says a newer copy has been written and cannot be read yet: that is the last word, on its way.
      // It is waited for, for as long as the site goes on saying so, and not given up on with the others.)
      if (r?.stale) {
        if (!stale) log('[keep] a newer copy has been written and the site cannot hand it over yet: waiting for it');
        stale ||= Date.now();
        if (Date.now() - stale >= KEEP_STALE_MS) break;
        await pause(2500);
        continue;
      }
      const here = await reachedHere();
      if (here === false) mine = 0;
      else if (!mine) mine = Date.now();
      if ((mine && Date.now() - mine >= KEEP_WAIT_MS) || Date.now() - began >= KEEP_MAX_MS) break;
      await pause(2500);
    }
    if (!read) {
      // (And it is NOT asked for again afterwards. A server that opened without reading has let everybody in with
      // a new life, and has promised to write over nothing: were the copy read late, it would become a writer, the
      // late copy would be passed over for everybody who is back, and the next save would put their new lives in
      // the place of what they had. Found by an independent reading, 2026-10-13, and shown on a local server.)
      return open('what is kept could NOT be read: the site did not answer. Everybody begins afresh, and nothing is written over what is kept');
    }
    KEPT.read = true;
    KEPT.seen = save?.at ?? '';
    if (save && !save.final && save.boot !== BOOT) {
      log(`[keep] the server before this one never said its last word: what it wrote at ${save.at} is all there is`);
      lateWatch();
    }
    if (!save) return open('nothing has been kept yet: everybody begins afresh');
    // (from here on something goes wrong only by what is in the file)
    let snap: Snapshot;
    try {
      snap = unseal(save.z) as Snapshot;
    } catch (e) {
      // A file that cannot be opened is no use to anybody, now or later: it is not left to stand in the way for
      // ever. (Left alone, with nothing written over it, every server after this one would have found it again,
      // opened with nothing again, and kept nothing again.)
      return open(`what was kept at ${save.at} could not be opened (${e instanceof Error ? e.message : e}): everybody begins afresh, and what is kept from now on is written over it`);
    }
    if ((snap.wipe ?? '') !== WIPE) KEPT.read = true;
    if ((snap.wipe ?? '') !== WIPE) return open(`what was kept is of the world "${snap.wipe ?? ''}", and this is "${WIPE}": everybody begins afresh`);
    const moved = snap.rev !== WORLD_REV, now = Date.now();
    let bad = 0;
    for (const [k, r] of snap.chars ?? []) {
      try {
        if (!r?.inv || !r.alive || now - r.leftAt > RECORD_LIFETIME || !isPose(r.pose)) continue;
        const inv = cleanInventory(r.inv);
        for (const it of things(inv)) issue(it);
        // (the map has been made again since: what they carried is theirs, where they stood may be inside a wall)
        KEPT.chars.set(k, { pose: r.pose, inv, vitals: r.vitals, alive: true, leftAt: r.leftAt, ...(moved || r.afresh ? { afresh: true } : {}) });
      } catch {
        // (one character that cannot be made sense of is one character lost, not everybody)
        bad++;
      }
    }
    if (bad) log(`[keep] ${bad} characters in what was kept could not be made sense of, and are left out`);
    let stashes = 0;
    for (const b of snap.stashes ?? []) {
      if (b?.kind !== 'stash' || typeof b.cid !== 'string' || boxes.has(b.cid) || ![b.x, b.y, b.z, b.rot].every(num)) continue;
      const items = (Array.isArray(b.items) ? b.items : []).flatMap((s) => {
        const it = cleanItem(s);
        return it ? [{ ...it, x: s.x, y: s.y, rot: !!s.rot }] : [];
      });
      for (const it of items) issue(it);
      const box: Box = { ...b, items, y: moved ? world.groundAt(b.x, b.z) : b.y, emptiedAt: -1, touchedAt: num(b.touchedAt) ? b.touchedAt : now };
      if (Math.abs(box.y - b.y) > 1) log(`[keep] a stash at ${Math.round(b.x)}, ${Math.round(b.z)} lies on ground that has moved ${(box.y - b.y).toFixed(1)} m: it is set on the new ground`);
      // (one that stood on the ground, kept by a server from before a stash was a thing to drop: it lies there as one now)
      if (box.buried) boxes.set(b.cid, box);
      else if (!economy.loot.has(b.cid)) economy.drop(stashItem(box), box.x, box.y, box.z, box.rot).keptAt = box.touchedAt;
      stashes++;
    }
    for (const l of snap.loose ?? []) {
      const item = cleanItem(l?.item);
      if (!item || ITEMS[item.id]?.category !== 'stash' || economy.loot.has(item.uid) || boxes.has(item.uid) || ![l.x, l.y, l.z, l.rot].every(num)) continue;
      for (const it of things({ slots: { it: item }, active: null, containers: [] })) issue(it);
      economy.drop(item, l.x, moved ? world.groundAt(l.x, l.z) : l.y, l.z, l.rot).keptAt = num(l.at) ? l.at : now;
      stashes++;
    }
    // (what has been said under the changelog, and its hearts: kept with the rest, and no worse for a new map)
    news.restore(snap.news);
    open(`${KEPT.chars.size} characters and ${stashes} stashes as they were kept at ${save.at}${save.final ? '' : ' (not a last word: the server before this one stopped without one)'}${moved ? '; the map has been made again since, so everybody starts from the edge with what they had' : ''}`);
  } catch (e) {
    // (what could be taken in has been: it is not thrown away for the sake of what could not)
    KEPT.read = true;
    open(`what was kept could not all be taken in (${e instanceof Error ? e.message : e}): ${KEPT.chars.size} characters were`);
  }
}

/** The lists are read when the server starts, and again every little while until they have been (the site may be asleep). */
function loadAdmin(tries = 0) {
  void siteAdmin({ op: 'load' }).then((r) => {
    if (r?.ok) {
      log(`[admin] lists read from the site: ${Object.keys(ADMIN.state.roles).length} with a role, ${ADMIN.state.bans.length} banned${r.set ? '' : ' (no ADMIN_PASSWORD is set there: nobody can become an admin)'}`);
      // (Whoever came in before the lists were read was let in as nobody in particular, and nothing told them
      // otherwise afterwards: at a deploy the first tries are answered by the server before this one, so that is
      // whoever was quickest back. They are told now.)
      for (const c of clients.values()) {
        const role = roleOf(c);
        // (and whoever came in with an admin's hold is told it is not theirs, now that it is known who is an admin)
        if (role !== 'admin') noHold(c);
        if (!role) continue;
        send(c, { t: 'role', role });
        if (role === 'admin') asAdmin(c, true);
      }
      return;
    }
    // (often at first: at a deploy the site's call back reaches the server before this one until this one is the one being served)
    if (tries < 110) setTimeout(() => loadAdmin(tries + 1), tries < 90 ? 5_000 : 30_000).unref();
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
  t.check.lag = 0;
  t.check.owed = 0;
  t.underAt = 0;
  send(t, { t: 'put', x, ...(y === null ? {} : { y }), z, ...(by === t ? {} : { by: by.name }) });
}
/**
 * Somebody has just been made an admin, or has come in as one. What they leave when they die is chosen for them
 * until they choose otherwise: nothing they carried, and no tag (an admin's kit is not found on them, and nobody
 * is paid for killing one at work). And they are shown whoever has vanished.
 */
function asAdmin(c: Client, fresh: boolean) {
  Object.assign(c.power, ADMIN.voids.get(c.key) ?? { voidInv: true, voidTag: true });
  Object.assign(c.power, CARRY_KEPT.get(c.key));
  // (An admin who comes in with things in their hold has the room they lie in. Which powers were on is forgotten
  // when this server restarts, and what is carried is not: without this, a restart put everything in an admin's
  // hold at their feet as they came back.)
  if (!c.power.bottomless && heldIn(c.inv).length) {
    c.power.bottomless = true;
    carryKept(c);
  }
  send(c, { t: 'powers', ...c.power });
  if (fresh) for (const o of clients.values()) if (o !== c && o.power.hidden) send(c, { t: 'join', p: info(o) });
}

/** One of an admin's powers, put on or off: they are told which they have, and (vanishing) everybody else that they have left or come. */
function setPower(c: Client, k: keyof Client['power'], on: boolean) {
  if (c.power[k] === on) return;
  c.power[k] = on;
  if (k === 'voidInv' || k === 'voidTag') {
    ADMIN.voids.set(c.key, { voidInv: c.power.voidInv, voidTag: c.power.voidTag });
    return void send(c, { t: 'powers', ...c.power });
  }
  if (k === 'weightless' || k === 'endless' || k === 'bottomless') return void carryKeep(c);
  const now = Date.now();
  // (vanished: gone from everybody's game but an admin's, where they are drawn faintly)
  if (k === 'hidden') for (const o of clients.values()) if (o !== c) send(o, roleOf(o) === 'admin' ? { t: 'ghost', id: c.id, on } : on ? { t: 'leave', id: c.id } : { t: 'join', p: info(c) });
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

// ------------------------------------------------------------------ what an admin carries, and fires (2026-10-13)
//
// Asked for: "admins should have infinite weight toggle", "admins should have reload mags button and no ammo
// consumtion otpion for infinte ammo". Two more powers, and one thing that is done once (what each comes to is in
// src/sim/powers.ts, where it is tried without a server):
//   /weightless, /ammo   put on and off as the other powers are, for the admin who gives the order or (named)
//                        another admin. Each is the admin's own game's to honour. This server weighs nothing and
//                        counts no rounds, and never did: neither power is anything it sees, and no check of its
//                        own asks after either. (And no check fires on an admin at all: see `flag`.)
//   /refill              every magazine and every gun somebody carries is full: the admin's, or anybody's they name.
//
// How a refill is done, and why that way. The rounds are not made here and sent, as a kit's things are. This
// server's copy of what somebody carries is as old as their game's last word of it (`me`), and things made from it
// and sent back would be put where they no longer lie. Their game is told to fill what it carries (`refill`), by
// the very rule this server fills its own copy with, and then says what it carries, as it does after anything.
// No thing is made by it: every gun and every magazine is the one it was, by its own number, with more rounds in
// it. So nothing in it is a thing "the server never put in the world" (`invented` asks after guns, blades, armour
// and the keycard by their numbers, and after rounds not at all), and a player it is done to is flagged for
// nothing. And nobody but an admin has it done: the word is sent on an admin's order alone, and a game that filled
// its own magazines without it would have said nothing it could not already say, what is in a magazine being its
// own game's word and nobody else's.
//
// And a third power, the same day ("admins need an infinite inventory option"):
//   /bottomless          the admin's inventory never fills: what finds no room in what they wear goes into a hold,
//                        a grid with no bottom that is kept and sent beside the tag pouch (`Hold` in
//                        src/sim/inventory.ts). Put on and off, and kept, as the two above. This one the server
//                        does see, in three places, and each is so that the room is an admin's and nobody else's,
//                        and so that nothing in it is lost:
//                        - what a game says lies in its hold is kept in full only while the power is on. With it
//                          off, a hold only ever gets emptier (`holdOnlyEmpties`, at 'me'): so a game that is not
//                          an admin's has nothing kept in a hold it makes up, and an admin's own, in the moments
//                          before this server has read who the admins are, loses nothing.
//                        - an admin who comes in with things in their hold has the power on (`asAdmin`): this
//                          server forgets which powers were on when it restarts, and must not put a hold at
//                          anybody's feet for that. Whoever comes in with things in one and is no admin is told
//                          they have no powers (`noHold`), and their game empties it, pockets first.
//                        - on a body it is nobody's: what was in it lies in what room the body's grid has left
//                          after everything that was worn, and the rest is gone (`makeCorpse`).

/** which of them each admin has on, by their key: theirs again when they come back, as what they chose for their death is (and, like that, until this server restarts) */
const CARRY_KEPT = new Map<string, Pick<Client['power'], CarryPower>>();
function carryKept(c: Client) {
  if (c.power.weightless || c.power.endless || c.power.bottomless) CARRY_KEPT.set(c.key, { weightless: c.power.weightless, endless: c.power.endless, bottomless: c.power.bottomless });
  else CARRY_KEPT.delete(c.key);
}
function carryKeep(c: Client) {
  carryKept(c);
  send(c, { t: 'powers', ...c.power });
}
/**
 * Somebody who is no admin and has things in a hold (an admin who has been made something else since they put
 * them there): told that they have no powers, which is all their game needs to empty it into their pockets, and at
 * their feet what finds no room. Nobody else who is no admin is ever told of powers.
 */
function noHold(c: Client) {
  if (ADMIN.ready && roleOf(c) !== 'admin' && heldIn(c.inv).length) send(c, { t: 'powers', ...c.power });
}

/** `/weightless`, `/ammo`, `/bottomless` and `/refill`, given by an admin (`command` has seen that they are one). */
function carryOrder(c: Client, cmd: 'weightless' | 'ammo' | 'bottomless' | 'refill', rest: string[]) {
  if (cmd === 'refill') {
    const t = rest[0] ? whoIs(rest[0]) : c;
    if (!t) return void sys(c, `Nobody online is "${rest[0]}" (or more than one is): see /players.`);
    if (!t.alive) return void sys(c, `${t === c ? 'You are' : `${t.name} is`} dead: there is nothing to fill.`);
    // (this server's own copy first, so that it is right from this moment; their game does the same to what it carries)
    const r = refill(carriedOf(t.inv)), did = refilledWords(r), whose = t === c ? 'you carry' : `${t.name} carries`;
    send(t, { t: 'refill', ...(t === c ? {} : { by: c.name }) });
    log(`[admin] ${c.name} refilled what ${t === c ? 'they' : t.name} carried: ${did || 'nothing took a round'}`);
    if (did) return void sys(c, `${did}${t === c ? '' : `, for ${t.name}`}.`);
    if (r.of) return void sys(c, `Every magazine and gun ${whose} is full already.`);
    return void sys(c, t.inv ? `No magazine and no gun among what ${whose}: there is nothing to fill.` : `${t === c ? 'Your' : `${t.name}'s`} game has been told to fill what it carries (it has not yet said what that is).`);
  }
  // One of the powers put on or off: the admin's own, or (named) another admin's. `on` or `off` says which,
  // in either order with the name; said neither, it is turned over. As god mode and the rest are: see `command`.
  const k: CarryPower = cmd === 'ammo' ? 'endless' : cmd, p = CARRY_POWERS[k];
  const say = rest.find((w) => w === 'on' || w === 'off'), whom = rest.find((w) => w !== 'on' && w !== 'off');
  const t = whom ? whoIs(whom) : c;
  if (!t) return void sys(c, `Nobody online is "${whom}" (or more than one is): see /players.`);
  if (roleOf(t) !== 'admin') return void sys(c, `${t.name} is not an admin: these are an admin's.`);
  const on = say ? say === 'on' : !t.power[k];
  setPower(t, k, on);
  log(`[admin] ${c.name} has put ${p.name} ${on ? 'on' : 'off'}${t === c ? '' : ` for ${t.name}`}`);
  if (t !== c) {
    sys(t, `${c.name} has put ${p.name} ${on ? 'on' : 'off'} for you.`);
    return void sys(c, `${t.name}: ${p.name} is ${on ? 'on' : 'off'}.`);
  }
  return void sys(c, on ? p.on : p.off);
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
 * Everybody a ban or a time off the server now covers is put out, there and then: by their game or by their
 * address, playing, lying where their connection left them, or waiting in line. (2026-10-12: "when I ban people
 * in game the ip and server ban should take effect instantly not at server restart". The one named was put out;
 * anybody else at their address, a second game of theirs already in the world, the body they had left a minute
 * before, stayed until they next tried to come in.)
 * @returns the names of those put out
 */
function sweepKeptOff(but?: Client): string[] {
  const out: string[] = [];
  for (const o of [...clients.values()]) {
    if (o === but || !clients.has(o.id)) continue;
    const why = bannedFor(o.key, o.ip);
    if (!why) continue;
    out.push(o.name);
    TURNED.banned++;
    eject(o, why === 'banned' ? 'You are banned from this server.' : 'You are kept off this server for now.');
  }
  for (const w of [...queue]) {
    if (!bannedFor(w.key, ipOf.get(w.ws) ?? '')) continue;
    out.push(cleanName(w.hello.name));
    TURNED.banned++;
    try {
      w.ws.send(JSON.stringify({ t: 'kick', reason: 'You are banned from this server.' } satisfies S2C));
    } catch {
      /* gone already */
    }
    w.ws.close();
  }
  return out;
}
/** A car taken out of the world by an admin (`/del car`, `/delcar`). @returns what the admin is told of it */
function takeCar(c: Client, v: Veh): string {
  if (v.seats.some((s) => s !== null)) return 'Somebody is in it: they get out first.';
  vehicles.delete(v.i);
  broadcast({ t: 'v-', i: v.i });
  log(`[admin] ${c.name} took away car ${v.i}${v.goneAt ? ' (burned out)' : ''} at ${v.s[0].toFixed(0)}, ${v.s[2].toFixed(0)}`);
  return `Taken away: ${v.goneAt ? 'the burned-out car' : v.k === POLICE_CAR.kind ? 'the police car' : 'the jeep'}, number ${v.i}. (The cars of the map are back when the server next starts.)`;
}
/**
 * A car stood somewhere by an admin (`/spawn`). It is made as every car is (`standJeep`), on the books of the park
 * of its own kind nearest to where it is put, and then set down where it was asked for. Everything that happens to
 * a car afterwards goes by its park (burned, driven off the edge of the world, left under the gas), and so finds
 * one: a car of an admin's that burns is followed in its time by a new one at that park, as any car is.
 */
function standCarAt(k: number, x: number, ground: number, z: number, yaw: number): Veh | null {
  let home = -1, best = Infinity;
  PARKS.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z) + (p.k === k ? 0 : 1e6);
    if (d < best) {
      best = d;
      home = i;
    }
  });
  if (home < 0) return null;
  const v = standJeep(home);
  v.s = restState(x, ground, z, yaw);
  if (k) v.k = k;
  else delete v.k;
  return v;
}
/**
 * A ban's own name in the lists, the same whatever else is banned or lifted meanwhile: an admin's ban by the start
 * of the hash it is kept under, a time off the server by a hash of the first thing it is kept off by (a key or an
 * address: neither is shown). Until 2026-10-13 a ban was lifted by where it stood in the list, which moves when
 * another admin bans somebody or a time off runs out: `/unban 3`, or the panel's button pressed on a list two
 * seconds old, could lift somebody else's.
 */
const banId = (b: { key: string }) => `a:${b.key.slice(0, 8)}`;
// (made with the site's secret, as the hash of an address is: nothing of the key or the address can be had back from it)
const offId = (b: { keys: string[] }) => `t:${createHash('sha256').update(`${ADMIN.pepper} kept off ${b.keys[0]}`).digest('hex').slice(0, 8)}`;
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
    case 'del': {
      // Something taken out of the world, for good: what a spawned thing, a body left lying or a car in the way is
      // cleared away with. (2026-10-12: "for the admin can you make it so the del key will delete a model or prop
      // or item when looked at".) The game says what the admin is looking at; what can be taken away is decided here.
      if (!admin) return need();
      const what = (rest[0] ?? '').toLowerCase(), id = rest[1] ?? '';
      if (what === 'item') {
        const l = economy.take(id);
        if (l) log(`[admin] ${c.name} took away ${ITEMS[l.item.id]?.name ?? l.item.id} at ${l.x.toFixed(0)}, ${l.z.toFixed(0)}`);
        return void sys(c, l ? `Taken away: ${ITEMS[l.item.id]?.name ?? l.item.id}${l.item.cargo?.length ? `, with the ${l.item.cargo.length} things in it` : ''}.` : 'Nothing of that number lies there (any more).');
      }
      if (what === 'box') {
        const b = boxes.get(id);
        if (!b) return void sys(c, 'No body, drop or buried stash of that number.');
        if (b.kind === 'crate') return void sys(c, 'A crate of the map is not taken away: it is part of the place.');
        locks.delete(id);
        boxes.delete(id);
        if (b.kind === 'stash') KEPT.dirty = true;
        broadcast({ t: b.kind === 'corpse' ? 'corpse-' : b.kind === 'drop' ? 'drop-' : 'stash-', uid: id });
        const name = b.kind === 'corpse' ? 'a body' : b.kind === 'drop' ? 'a supply drop' : 'a buried stash';
        log(`[admin] ${c.name} took away ${name} at ${b.x.toFixed(0)}, ${b.z.toFixed(0)} (${b.items.length} things in it)`);
        return void sys(c, `Taken away: ${name}${b.items.length ? `, with the ${b.items.length} things in it` : ''}.`);
      }
      if (what === 'car') {
        const v = vehicles.get(Number(id));
        if (!v) return void sys(c, 'No car of that number.');
        return void sys(c, takeCar(c, v));
      }
      if (what === 'z') {
        const i = Number(id), r = Number.isInteger(i) ? horde.hurt(i, 1e6, Date.now()) : null;
        if (!r) return void sys(c, 'None of the infected has that number.');
        broadcast({ t: 'ihp', i, hp: r.hp, dead: r.dead, by: c.id, zone: 'torso', dir: [0, 1], melee: false });
        return void sys(c, 'One of the infected is put down.');
      }
      return void sys(c, 'Take away what? /del item, box, car or z, and its number. The Delete key does it for whatever you are looking at.');
    }
    case 'airdrop': {
      // The helicopter sent now by an admin, to look at it and to try it (2026-10-13): to a few steps in front of
      // whoever asks, or to the map numbers given. From there on it is a drop like any other: everybody is told.
      if (!admin) return need();
      const n = rest.map(Number);
      if ((n.length !== 0 && n.length !== 2) || n.some((v) => !Number.isFinite(v))) return void sys(c, 'After /airdrop: nothing (it comes to a few steps in front of you), or the map numbers x z.');
      const x = n.length ? n[0] : c.pose[0] - Math.sin(c.pose[3]) * 6, z = n.length ? n[1] : c.pose[2] - Math.cos(c.pose[3]) * 6;
      if (Math.abs(x) > WORLD_SIZE / 2 - 6 || Math.abs(z) > WORLD_SIZE / 2 - 6) return void sys(c, 'That is off the map.');
      const f = sendDrop({ x, y: world.groundAt(x, z), z });
      if (f) sys(c, `A helicopter is coming in from the ${comesFrom(f)}: the crate is down at ${Math.round(x)}, ${Math.round(z)} in ${Math.round(flightTimes(f).land)} s, and it is gone in ${Math.round(flightTimes(f).gone)}.`);
      return;
    }
    case 'spawn': {
      // Something stood in the world by an admin: a car of either kind, or the infected. (2026-10-13: "add more
      // admin tools that might be useful like spawn entities like cars and zombies and future entities would go
      // here".) What there is to stand is ENTITIES in src/net/orders.ts: one more kind of thing is one more row
      // there, and one more `kind` here if it is made in a way of its own. Where: a few steps in front of whoever
      // asks, or at the map numbers given (the panel gives those of what the admin is looking at):
      // `/spawn what [count] [x z]`, or with a height, `/spawn what count x y z`.
      if (!admin) return need();
      const e = entityBy(rest[0] ?? '');
      if (!e) return void sys(c, `Stand what? One of: ${ENTITIES.map((x) => x.id).join(', ')}. As in /spawn jeep, or /spawn infected 5.`);
      const n = rest.slice(1).map(Number);
      // (one number is how many; three are how many and a place; four are how many, and a place with its height.
      // Two could be either, and are asked again.)
      if (n.length > 4 || n.length === 2 || n.some((v) => !Number.isFinite(v))) return void sys(c, `After /spawn ${e.id}: how many (up to ${e.most}), and then, if it is not to be in front of you, the map numbers x z. As in /spawn ${e.id} 1 120 -40.`);
      const count = Math.max(1, Math.min(e.most, Math.round(n[0] ?? 1)));
      const yaw = c.pose[3], ahead = e.kind === 'car' ? 6 : 5;
      const x = n.length >= 3 ? n[1] : c.pose[0] - Math.sin(yaw) * ahead;
      const z = n.length >= 3 ? n[n.length - 1] : c.pose[2] - Math.cos(yaw) * ahead;
      const y = n.length === 4 ? n[2] : null;
      if (Math.abs(x) > WORLD_SIZE / 2 - 6 || Math.abs(z) > WORLD_SIZE / 2 - 6 || (y !== null && Math.abs(y) > 400)) return void sys(c, 'That is off the map.');
      if (e.kind === 'car') {
        const standing = [...vehicles.values()].filter((v) => !v.goneAt).length;
        if (standing + count > PARKS.length + 30) return void sys(c, `There are ${standing} cars standing already: take some away first (/delcar).`);
        const made: Veh[] = [];
        for (let k = 0; k < count; k++) {
          // (more than one: side by side, across the way the admin faces)
          const off = (k - (count - 1) / 2) * 4.5, cx = x + Math.cos(yaw) * off, cz = z - Math.sin(yaw) * off;
          const v = standCarAt(e.k ?? 0, cx, y ?? world.groundAt(cx, cz), cz, yaw);
          if (!v) break;
          made.push(v);
          broadcast({ t: 'v+', v: vehInfo(v) });
        }
        if (!made.length) return void sys(c, 'No car is kept anywhere in this world: none can be stood.');
        const which = `number ${made.map((v) => v.i).join(', ')}`;
        log(`[admin] ${c.name} stood ${made.length} × ${e.name.toLowerCase()} at ${x.toFixed(0)}, ${z.toFixed(0)} (${which})`);
        return void sys(c, `${made.length > 1 ? `${made.length} × ` : ''}${e.name} at ${x.toFixed(0)}, ${z.toFixed(0)} (${which}). /delcar takes the nearest car away.`);
      }
      const afoot = [...horde.bodies.values()].filter((b) => !b.diedAt).length;
      if (afoot + count > INFECTED.max + 80) return void sys(c, `There are ${afoot} of the infected on their feet already: put some down first (/delz).`);
      const now = Date.now();
      for (let k = 0; k < count; k++) {
        // (the first where it was asked for, the rest spread round it a good pace apart: two in one place can neither of them move)
        const r = 1.7 * Math.sqrt(k), a = k * 2.39996, bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
        const b = horde.place(bx, y ?? world.groundAt(bx, bz), bz, now);
        broadcast({ t: 'i+', b: { i: b.i, s: b.s, hp: b.hp, own: b.own, h: b.h } });
      }
      log(`[admin] ${c.name} stood ${count} of the infected at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      return void sys(c, `${count} of the infected at ${x.toFixed(0)}, ${z.toFixed(0)}. /delz puts down those near you.`);
    }
    case 'delcar': {
      // (the car nearest whoever asks, or the one of the number given: the panel gives the number of the one looked at)
      if (!admin) return need();
      let v: Veh | undefined;
      if (/^#?\d+$/.test(who)) v = vehicles.get(Number(who.replace('#', '')));
      else if (!who || who.toLowerCase() === 'nearest') {
        let best = 150;
        for (const o of vehicles.values()) {
          const d = Math.hypot(o.s[0] - c.pose[0], o.s[2] - c.pose[2]);
          if (d < best) {
            best = d;
            v = o;
          }
        }
        if (!v) return void sys(c, 'No car stands within 150 metres of you.');
      } else return void sys(c, '/delcar takes away the car nearest you; /delcar 7 takes away car number 7.');
      if (!v) return void sys(c, 'No car of that number.');
      return void sys(c, takeCar(c, v));
    }
    case 'wrecks': {
      // (every burned-out car, now: each is cleared away by itself two minutes after it burns)
      if (!admin) return need();
      const gone = [...vehicles.values()].filter((v) => v.goneAt && v.seats.every((s) => s === null));
      for (const v of gone) {
        vehicles.delete(v.i);
        broadcast({ t: 'v-', i: v.i });
      }
      if (gone.length) log(`[admin] ${c.name} cleared away ${gone.length} burned-out car${gone.length > 1 ? 's' : ''}`);
      return void sys(c, gone.length ? `Cleared away: ${gone.length} burned-out car${gone.length > 1 ? 's' : ''}. A new car is stood for each in its own time, as ever.` : 'No car is burned out just now.');
    }
    case 'delz': {
      // (the infected about whoever asks, put down as `/del z` puts one down: they lie where they fall, and those
      // that lived there are owed again in their time)
      if (!admin) return need();
      if (rest[0] && !(Number(rest[0]) > 0)) return void sys(c, '/delz puts down the infected within 60 metres of you; /delz 120, those within 120 (up to 400).');
      const within = Math.min(400, Math.max(5, Number(rest[0]) || 60)), now = Date.now();
      let down = 0;
      for (const b of [...horde.bodies.values()]) {
        if (b.diedAt || Math.hypot(b.s[0] - c.pose[0], b.s[2] - c.pose[2]) > within) continue;
        const r = horde.hurt(b.i, 1e6, now);
        if (!r) continue;
        down++;
        broadcast({ t: 'ihp', i: b.i, hp: r.hp, dead: r.dead, by: c.id, zone: 'torso', dir: [0, 1], melee: false });
      }
      if (down) log(`[admin] ${c.name} put down ${down} of the infected within ${within} m of ${c.pose[0].toFixed(0)}, ${c.pose[2].toFixed(0)}`);
      return void sys(c, down ? `Put down: ${down} of the infected within ${within} metres of you.` : `None of the infected is on its feet within ${within} metres of you.`);
    }
    case 'save': {
      // everybody and every stash written to the site now: before a restart made by hand, or whenever it is wanted
      if (!admin) return need();
      if (Date.now() - KEPT.savedAt < 60_000) return void sys(c, `It was written less than a minute ago: ${KEPT.last}.`);
      void keepBefore('an admin asked').then((r) => sys(c, r.ok ? `Kept: ${r.said}.` : `It could NOT be kept: ${r.said}. Do not restart on the strength of it.`));
      return;
    }
    case 'restart': {
      // (said, and no more: nothing is restarted by saying so. For a warning before somebody restarts it by hand.)
      const secs = /^\d+$/.test(rest[0] ?? '') ? Math.min(600, Number(rest[0])) : 60;
      const why = (/^\d+$/.test(rest[0] ?? '') ? rest.slice(1) : rest).join(' ').slice(0, 120);
      sayRestart(why, secs);
      return void sys(c, `Everybody is told: the server restarts in ${secs} s${why ? ` (${why})` : ''}. Saying so restarts nothing.`);
    }
    case 'delc': {
      // a comment under the changelog taken down by its number; with no number, the newest of them are read out
      if (!admin) return need();
      const n = Number(rest[0]);
      if (!rest.length || !Number.isInteger(n)) {
        const last = news.latest(14);
        return void sys(c, last.length ? 'Comments on the changelog, newest last (/delc <number> takes one down):' : 'Nobody has commented on the changelog.', ...last.map((q) => `#${q.id} [${q.entry}] ${q.name}: ${q.text}`));
      }
      if (!news.remove(n)) return void sys(c, `There is no comment #${n}.`);
      KEPT.dirty = true;
      log(`[admin] ${c.name} took comment #${n} off the changelog`);
      return void sys(c, `Comment #${n} is gone from the changelog.`);
    }
    case 'say': {
      if (!rest.length) return void sys(c, 'Say what?');
      const words = rest.join(' ').slice(0, 160);
      log(`[admin] ${c.name} to everybody: ${words}`);
      broadcast({ t: 'announce', text: words, by: c.name });
      return void sys(c, `Said to all ${clients.size}: ${words}`);
    }
    case 'msg':
    case 'pm':
    case 'w': {
      const t = whoIs(who), words = rest.slice(1).join(' ').slice(0, 160);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (!words) return void sys(c, 'Say what to them?');
      log(`[admin] ${c.name} to ${t.name} alone: ${words}`);
      send(t, { t: 'pm', from: c.name, role, text: words });
      return void sys(c, `To ${t.name} alone: ${words}`);
    }
    case 'inv': {
      const t = whoIs(who);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      const worn = Object.entries(t.inv?.slots ?? {}).flatMap(([slot, it]) => (it && slot !== 'neck' ? [`${slot}: ${ITEMS[it.id]?.name ?? it.id}${it.mods?.length ? ` (${it.mods.map((m) => ITEMS[m]?.name ?? m).join(', ')})` : ''}`] : []));
      const count = new Map<string, number>();
      for (const it of things(t.inv)) count.set(ITEMS[it.id]?.name ?? it.id, (count.get(ITEMS[it.id]?.name ?? it.id) ?? 0) + (ITEMS[it.id]?.stack ? it.qty : 1));
      const never = [...things(t.inv)].filter(invented).map((it) => ITEMS[it.id]?.name ?? it.id);
      return void sys(c, `${t.name} carries (as their game last said, ${t.vitals ? `health ${Math.round(t.vitals.health)}` : 'health not said'}):`, worn.length ? worn.join(' · ') : 'nothing worn or slung', [...count].map(([n, q]) => (q > 1 ? `${q} × ${n}` : n)).join(' · ') || 'nothing at all', ...(never.length ? [`NOT put in the world by the server: ${never.join(', ')}`] : []));
    }
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
      for (const n of namesOf(t.key, t.ip)) BANS.temp.set(n, { until: Date.now() + mins * 60000, why: `timed out by ${c.name}${reason ? `: ${reason}` : ''}`, name: t.name });
      log(`[admin] ${c.name} timed ${t.name} out for ${mins} minutes${reason ? `: ${reason}` : ''}`);
      eject(t, `You are kept off the server for ${mins} minutes${reason ? `: ${reason}` : '.'}`);
      const more = sweepKeptOff(c);
      return void sys(c, `${t.name} is off the server for ${mins} minutes.${more.length ? ` Put out with them, from the same address: ${more.join(', ')}.` : ''}`);
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
      // (it holds from this line on: see saveAdmin. And whoever else it covers goes now.)
      const saving = saveAdmin(next);
      const more = sweepKeptOff(c);
      const kept = await saving;
      return void sys(c, `${name} is banned${ip ? ', by their game and by their address' : ' (by their game only: the address could not be told)'}, from now.${more.length ? ` Put out with them: ${more.join(', ')}.` : ''}${kept ? '' : ' It could NOT be written to the site: it holds until this server restarts. Give the order again in a minute.'}`);
    }
    case 'bans':
      if (!admin) return need();
    {
      const off = keptOffNow();
      return void sys(
        c,
        ADMIN.state.bans.length ? 'Banned (/unban takes the id in brackets, or the number straight after this list):' : 'Nobody is banned.',
        ...ADMIN.state.bans.map((b, i) => `${i + 1}. ${b.name}  [${banId(b)}]  by ${b.by}, ${b.at.slice(0, 10)}${b.why ? `: ${b.why}` : ''}`),
        ...(off.length ? ['Kept off for a while (by the checks, or timed out):'] : []),
        ...off.map((b, i) => `${ADMIN.state.bans.length + i + 1}. ${b.name}  [${offId(b)}]  for ${Math.ceil((b.until - Date.now()) / 60000)} more minutes: ${b.why}`),
      );
    }
    case 'unban': {
      if (!admin) return need();
      // Which ban is meant. By its own id first (what the panel's button sends, and what /bans prints in brackets);
      // then by where it stands in /bans, for `/unban 3` typed straight after it; then by name. A name that more
      // than one ban has, across those an admin wrote down and those kept off for a while, lifts nothing: they are
      // read out with their ids. ("Survivor" is the name of everybody who never chose one.)
      const said = rest.join(' ').trim(), w = said.toLowerCase(), off = keptOffNow();
      const held = [...ADMIN.state.bans.map((b) => ({ id: banId(b), name: b.name, ban: b, off: null })), ...off.map((t) => ({ id: offId(t), name: t.name, ban: null, off: t }))];
      const found = /^[at]:[0-9a-f]+$/.test(w) ? held.filter((x) => x.id === w) : /^\d+$/.test(w) ? held.slice(Number(w) - 1, Number(w)) : held.filter((x) => x.name.toLowerCase() === w);
      if (!found.length) return void sys(c, `No ban is "${said}": see /bans.`);
      if (found.length > 1) {
        return void sys(c, `More than one ban is "${said}", and none of them is lifted. Give the id of the one you mean:`, ...found.map((x) => `/unban ${x.id}   ${x.name}, ${x.ban ? `banned by ${x.ban.by} on ${x.ban.at.slice(0, 10)}${x.ban.why ? `: ${x.ban.why}` : ''}` : `kept off for ${Math.ceil((x.off!.until - Date.now()) / 60000)} more minutes: ${x.off!.why}`}`));
      }
      const b = found[0].ban;
      if (!b) {
        // (not one an admin wrote down: one of those kept off for a while, by the checks or by a timeout)
        const t = found[0].off!;
        for (const k of t.keys) {
          BANS.temp.delete(k);
          BANS.strikes.delete(k);
        }
        log(`[admin] ${c.name} let ${t.name} back in (they were kept off: ${t.why})`);
        return void sys(c, `${t.name} is no longer kept off, and may come straight back in.`);
      }
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
      const key = keyHash(t.key), roles = { ...ADMIN.state.roles }, was = roleOf(t) === 'admin';
      const to: Role | null = cmd === 'mod' ? 'mod' : cmd === 'demote' || cmd === 'deop' ? null : 'admin';
      if (t === c && to !== 'admin') return void sys(c, 'Not yourself: somebody else has to.');
      if (to) roles[key] = { role: to, name: t.name, by: c.name, at: new Date().toISOString() };
      else delete roles[key];
      log(`[admin] ${c.name} made ${t.name} ${to ?? 'nothing'}`);
      const kept = await saveAdmin({ roles, bans: ADMIN.state.bans });
      if (to !== 'admin') {
        for (const k of ['god', 'hidden', 'clip', 'voidInv', 'voidTag', 'weightless', 'endless', 'bottomless'] as const) setPower(t, k, false);
        ADMIN.voids.delete(t.key);
        // (and whoever has vanished is gone from their game, as from anybody's)
        if (was) for (const o of clients.values()) if (o !== t && o.power.hidden) send(t, { t: 'leave', id: o.id });
      }
      send(t, { t: 'role', role: to });
      if (to === 'admin' && !was) asAdmin(t, true);
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
      // Where it goes (2026-10-13: "the default mode for spawning loot for somone should be in their inventory
      // unless on space"): into the inventory of whoever it is for, and at their feet what finds no room there.
      // It was at their feet, always; that is still to be had, with the word `ground` (or `feet`, or `floor`)
      // anywhere after the thing. And at their feet it is for whoever has no game to put it away: the dead, and a
      // body left behind by a connection that has gone.
      const said = rest.slice(1), onGround = said.some((w) => GROUND.includes(w.toLowerCase())), tail = said.filter((w) => !GROUND.includes(w.toLowerCase()));
      const counted = /^\d+$/.test(tail[0] ?? ''), whom = counted ? tail[1] : tail[0];
      const t = whom ? whoIs(whom) : c;
      if (!t) return void sys(c, `Nobody online is "${whom}" (or more than one is): see /players.`);
      const per = ITEMS[id].stack ?? 1, away = !t.alive || !!t.asleep, feet = onGround || away;
      let left = Math.max(1, Math.min(counted ? Number(tail[0]) : 1, per > 1 ? per * 10 : 10)), made = 0;
      const items: ItemInstance[] = [];
      while (left > 0) {
        const q = Math.min(per, left), it = makeItem(id, per > 1 ? q : undefined);
        if (feet) economy.drop(it, t.pose[0] + (Math.random() - 0.5) * 0.9, t.pose[1] + 0.05, t.pose[2] + (Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2);
        else {
          // (made here and written down, as a kit's things are: each is one the server knows it put in the world)
          issue(it);
          items.push(it);
        }
        left -= q;
        made += q;
      }
      const what = `${made > 1 ? `${made} × ` : ''}${ITEMS[id].name}`, whose = t === c ? 'your' : `${t.name}'s`;
      if (feet) {
        log(`[admin] ${c.name} made ${made} of ${id}${t === c ? '' : ` at ${t.name}'s feet`}`);
        return void sys(c, `${what} at ${whose} feet${away && !onGround ? ` (${t === c ? 'you are' : `${t.name} is`} ${t.alive ? 'not at their game' : 'dead'}: nothing goes into an inventory)` : ''}.`);
      }
      // (handed over as a kit that adds to what is carried: their game puts each thing on or away as it does a thing
      // picked up, and at their feet what finds no room. `gift` has the note say what was given; a game from
      // before it reads `name`, and calls the same words a kit.)
      log(`[admin] ${c.name} made ${made} of ${id}, into ${t === c ? 'their own' : `${t.name}'s`} inventory`);
      send(t, { t: 'kit', name: what, items, adds: true, gift: what, ...(t === c ? {} : { by: c.name }) });
      return void sys(c, `${what}: in ${whose} inventory; what finds no room there is at ${t === c ? 'your' : 'their'} feet.`);
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
    case 'clear': {
      if (!admin) return need();
      const t = rest[0] ? whoIs(rest[0]) : c;
      if (!t) return void sys(c, `Nobody online is "${rest[0]}" (or more than one is): see /players.`);
      if (!t.alive) return void sys(c, `${t === c ? 'You are' : `${t.name} is`} dead: there is nothing on them to empty.`);
      // (a kit of nothing: what is carried and worn goes, as it does for any kit, and nothing comes in its place)
      log(`[admin] ${c.name} emptied what ${t === c ? 'they' : t.name} carried`);
      send(t, { t: 'kit', name: '', items: [], ...(t === c ? {} : { by: c.name }) });
      return void sys(c, `${t === c ? 'You carry' : `${t.name} carries`} nothing now (dog tags are kept).`);
    }
    case 'pockets': {
      // (the panel's own order: what somebody carries, thing by thing, for its Inventory tab. /inv says it in words.)
      if (!admin) return need();
      const t = rest[0] ? whoIs(rest[0]) : c;
      if (!t) return void sys(c, `Nobody online is "${rest[0]}" (or more than one is): see /players.`);
      return void send(c, { t: 'inv', id: t.id, name: t.name, inv: t.inv });
    }
    case 'trash': {
      // (the panel's own order: a thing, by its number, taken out of what somebody carries)
      if (!admin) return need();
      const t = rest[1] ? whoIs(rest[0]) : c, uid = rest[1] ?? rest[0] ?? '';
      if (!t || !uid) return void sys(c, 'Whose, and which thing: /trash who thing (the panel writes this for you).');
      const had = [...things(t.inv)].find((it) => it.uid === uid);
      if (!had) return void sys(c, `${t === c ? 'You do' : `${t.name} does`} not carry that any more.`);
      takeOut(t.inv, new Set([uid]));
      log(`[admin] ${c.name} took ${ITEMS[had.id]?.name ?? had.id} out of what ${t === c ? 'they' : t.name} carried`);
      send(t, { t: 'trash', uids: [uid], ...(t === c ? {} : { by: c.name }) });
      send(c, { t: 'inv', id: t.id, name: t.name, inv: t.inv });
      return void sys(c, `${ITEMS[had.id]?.name ?? had.id}: gone from what ${t === c ? 'you carry' : `${t.name} carries`}.`);
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
    case 'die': {
      if (!admin) return need();
      if (!c.alive) return void sys(c, 'You are dead already.');
      c.lastHitBy = null;
      kill(c, 'their own hand');
      return void sys(c, 'You are dead.');
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
    case 'voidtag':
    case 'god':
    case 'vanish':
    case 'noclip': {
      // One of an admin's powers put on or off: their own, or (named) another admin's. `on` or `off` says which;
      // said neither, it is turned over.
      if (!admin) return need();
      const k = ({ god: 'god', vanish: 'hidden', noclip: 'clip', voidinv: 'voidInv', voidtag: 'voidTag' } as const)[cmd];
      const say = rest.find((w) => w === 'on' || w === 'off'), whom = rest.find((w) => w !== 'on' && w !== 'off');
      const t = whom ? whoIs(whom) : c;
      if (!t) return void sys(c, `Nobody online is "${whom}" (or more than one is): see /players.`);
      if (roleOf(t) !== 'admin') return void sys(c, `${t.name} is not an admin: these are an admin's.`);
      const on = say ? say === 'on' : !t.power[k];
      setPower(t, k, on);
      const what = { god: 'god mode', hidden: 'vanish', clip: 'noclip', voidInv: 'void inventory on death', voidTag: 'void dog tag on death' }[k];
      if (t !== c) {
        sys(t, `${c.name} has put ${what} ${on ? 'on' : 'off'} for you.`);
        return void sys(c, `${t.name}: ${what} is ${on ? 'on' : 'off'}.`);
      }
      return void sys(c, k === 'voidInv' ? (on ? 'When you die, nothing you carried is left on your body.' : 'When you die, what you carried is on your body, as anybody\'s is.') : k === 'voidTag' ? (on ? 'When you die, no dog tag of your own is left.' : 'When you die, your dog tag is on your body, as anybody\'s is.') : k === 'god' ? (on ? 'Nothing hurts you now.' : 'You can be hurt again.') : k === 'hidden' ? (on ? 'Nobody but an admin sees you now: to everybody else you have left.' : 'You can be seen again.') : on ? 'You fly, and through anything: W A S D, Space up, Ctrl down, Shift fast.' : 'You walk again.');
    }
    case 'weightless':
    case 'ammo':
    case 'bottomless':
    case 'refill':
      // (what an admin carries weighing nothing, their gun never emptying, their inventory never filling, and every magazine filled: see `carryOrder`)
      if (!admin) return need();
      return void carryOrder(c, cmd, rest);
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
  asAdmin(c, true);
  sys(c, 'You are an admin, on this and every game from now on. /help lists your orders.');
}

/** Put off the server by a check (only ever when enforcing): told so, counted, and after enough of it kept off for a while. */
function putOff(c: Client, why: string) {
  // (no check puts an admin off the server)
  if (roleOf(c) === 'admin') return void log(`[check] ${c.name} is an admin and is left alone: ${why}`);
  const now = Date.now();
  let kept = false;
  for (const n of namesOf(c.key, c.ip)) {
    const times = (BANS.strikes.get(n) ?? []).filter((t) => now - t < 3600000);
    times.push(now);
    BANS.strikes.set(n, times);
    if (times.length >= CHECK.strikes) {
      BANS.temp.set(n, { until: now + CHECK.ban * 3600000, why, name: c.name });
      kept = true;
    }
  }
  shooters.delete(`${keyHash(c.key)}|${c.ip}`);
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
const UNDER = { deep: 1.1, grace: 3, void: 10, off: 8 };
function underCheck(c: Client, now = Date.now()) {
  const [x, y, z] = c.pose;
  const b = world.bunker;
  const down = c.alive && !c.seatAt && !c.power.clip && roleOf(c) !== 'admin' && now >= c.check.free && y < world.coverAt(x, z) - UNDER.deep && !(b && Math.hypot(x - b.x, z - b.z) < UNDER_BUNKER) && !world.castleUnder(x, y, z);
  if (!down) {
    c.underAt = 0;
    return;
  }
  if (!c.underAt) c.underAt = now;
  // (2026-10-12: "player should never be able to go under the map". Wherever their game says they are under it,
  // they are on it for everybody else, from the first word: seen there, and hit there. The programs that came by
  // the dozen that day slid about the map at one height, metres under it, where nothing could touch them.)
  if (CHECKS === 'enforce') c.pose[1] = world.coverAt(x, z);
  const secs = (now - c.underAt) / 1000;
  if (secs < UNDER.grace) return;
  flag(c, `is ${(world.coverAt(x, z) - y).toFixed(1)} m under the ground at ${x.toFixed(0)}, ${z.toFixed(0)}, ${secs.toFixed(0)} s now`, false);
  if (secs >= UNDER.void) voidTags(c, 'under the ground');
  if (secs >= UNDER.off) putOff(c, `was under the ground for ${UNDER.off} seconds`);
}
/**
 * To and fro without the head once turning (2026-10-12: "can we not detect rigid inhuman movements like these
 * players?"). Somebody who goes about has their eyes on where they go: the turn and the tilt of their head change
 * with every twitch of the hand. A program that walks a body up and down to seem alive turns it about without
 * the head moving at all. Four turns back the way it came and twenty metres covered, in half a minute in which
 * the head did not move by a hair: written down.
 *
 * (It put them off the server at once, until 2026-10-13, and it was wrong about people: "user is complaining that
 * they get disconnected when they kill someone". With their pockets open the mouse is free and the head is not
 * steered, and somebody going through a body's pockets steps round it: to and fro, head still. Twice inside an
 * hour, and they were kept off for six. Now it is a mark against them like any other, FLAGS_OUT of which put
 * somebody off; nobody is put off for this alone; and the half minute begins again whenever they DO anything, which
 * a body walked by a program does not: see `handle`.)
 */
const GAIT = { ms: 30_000, turns: 4, far: 20 };
function gaitCheck(c: Client, was: Pose, now = Date.now()) {
  if (CHECKS === 'off' || !c.alive || c.seatAt || c.power.clip || roleOf(c) === 'admin') return;
  const k = c.check, to = c.pose;
  if (!k.gait || to[3] !== k.gait.yaw || to[4] !== k.gait.pitch || now - k.gait.since > GAIT.ms) k.gait = { since: now, yaw: to[3], pitch: to[4], far: 0, turns: 0, dx: 0, dz: 0 };
  const g = k.gait, dx = to[0] - was[0], dz = to[2] - was[2], step = Math.hypot(dx, dz);
  if (step < 0.05) return;
  g.far += step;
  if (g.dx * dx + g.dz * dz < -0.5 * step * Math.hypot(g.dx, g.dz)) g.turns++;
  g.dx = dx;
  g.dz = dz;
  if (g.turns < GAIT.turns || g.far < GAIT.far) return;
  k.gait = undefined;
  flag(c, `went to and fro ${GAIT.turns} times over ${g.far.toFixed(0)} m without their head once turning`, false);
}
/** how far round the bunker's middle the ground is not asked about: its rooms and its stair are under it */
const UNDER_BUNKER = 48;
/** somebody has had something to do with a stash: noted, and it is kept again */
function touched(b: Box) {
  if (b.kind !== 'stash') return;
  b.touchedAt = Date.now();
  KEPT.dirty = true;
}

/** Is somebody out of the game for being under the ground? (past the moment that is let go) */
const buried = (c: Client, now = Date.now()) => c.underAt > 0 && now - c.underAt >= UNDER.grace * 1000;

interface Client {
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
  power: { god: boolean; hidden: boolean; clip: boolean; voidInv: boolean; voidTag: boolean; /** what they carry weighs nothing, and their gun spends no rounds: their own game's to honour (see `carryOrder`) */ weightless: boolean; endless: boolean; /** their inventory never fills: things are kept in their hold (see `carryOrder`) */ bottomless: boolean };
  /** this player's grenades: the one whose pin is out in their hand, and those that have left it and not long gone off, with what each has been said to reach (src/sim/grenades.ts) */
  nades: Thrower;
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

const info = (c: Client): PlayerInfo => ({ id: c.id, name: c.name, pose: c.pose, w: c.w, m: c.m, g: c.g, b: c.b, alive: c.alive, ...(c.power.hidden ? { hidden: true as const } : {}) });
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
function pickSpawn(died?: { x: number; z: number }) {
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
  good.sort((a, b) => b.d - a.d);
  const best = good[Math.floor(Math.random() * Math.min(3, good.length))].s;
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

// (What makes a thing, and a whole inventory, out of what a game says is in src/sim/inventory.ts since 2026-10-13,
// where it is tried without a server: test/clothes.test.ts. A thing's cargo is read to as many things as it has
// cells, where it was forty; three deep, where it was two; and the hot keys are kept.)
function cleanItem(raw: unknown, depth = 0): ItemInstance | null {
  return cleanThing(raw, cleanName, depth);
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

/**
 * What a game says it carries, or what was kept of a character, made safe and made of today's shape: a character
 * kept from before the jacket and the trousers were things has them on after this, with what was in its pockets in
 * theirs (upgradeInventory in src/sim/inventory.ts, the same the game itself reads a save with).
 */
function cleanInventory(raw: unknown): SerializedInventory | null {
  return cleanCarried(raw, cleanName);
}

// ------------------------------------------------------------------ gameplay

function releaseLock(c: Client) {
  if (c.openCid && locks.get(c.openCid) === c.id) {
    locks.delete(c.openCid);
    ajar(c.openCid, false);
  }
  c.openCid = null;
}

/**
 * One of the map's containers is being searched, or no longer is: everybody is told, and whoever is near one that
 * has doors sees them swing open, stand open and shut again (a locker: src/game/lockers.ts). Only of what is part of
 * the map: a body, a drop and a stash have no doors. And nothing is said of what a vanished admin opens: a door
 * that opens by itself is somebody.
 */
function ajar(cid: string, open: boolean, by?: Client) {
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

/**
 * everything a character carried goes into a body that can be searched for a while
 *
 * What was worn lies in the body's grid as the thing it is, with what was in it still in it: the jacket with what
 * was in its pockets and the trousers with theirs, as a pack always did (2026-10-13: "When i kill someone and i
 * loot their body and i pick up their backpack it should bring all the loot with it ... it should be the same for
 * all inventories"). The grid is BODY_GRID, which holds all a person can have on at once: it was 8x10, and pocket
 * loot and taken tags that found no room were thrown on the ground round the body.
 */
function makeCorpse(c: Client, v: number): CorpseInfo | null {
  const inv = c.inv;
  const [x, , z, yaw] = c.pose;
  const y = c.pose[1];
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
  boxes.set(uid, { cid: uid, kind: 'corpse', w: BODY_GRID[0], h: BODY_GRID[1], items: box.serialize().items, x, y, z, rot: yaw, emptiedAt: -1, name: c.name, expires: economy.time + CORPSE_LIFETIME, v });
  return { uid, x, y, z, rot: yaw, name: c.name, v };
}

function kill(c: Client, cause: string, v = 0) {
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
  // (What the game reports on its own: where it stands, what it carries and wears, a ping; and, for whichever game
  // moves them, where the infected and the jeeps near it are. Those last were counted as something a person did
  // until 2026-10-13: anybody within reach of an infected was never away, however long their hands were off the
  // keys, and was never looked at by the check below.)
  if (!SAID_BY_ITSELF.has(m.t)) {
    c.activeAt = Date.now();
    // (and whoever is doing things is not a body being walked up and down: see gaitCheck)
    c.check.gait = undefined;
  }
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
        if (c.alive && c.vitals) send(c, { t: 'hp', health: c.vitals.health, bleeding: !!c.vitals.bleeding, blood: bloodOf(c.vitals), bleed: c.vitals.bleeding ? bleedOf(c.vitals) : 0 });
      }
      c.heardAt = Date.now();
      c.spoke = true;
      if (c.logoutAt && Math.hypot(m.p[0] - c.logoutFrom[0], m.p[2] - c.logoutFrom[1]) > LOGOUT_STIR) stayOn(c, 'you moved');
      c.pose = moveCheck(c, m.p, Date.now()) ? m.p : [was[0], was[1], was[2], m.p[3], m.p[4], m.p[5]];
      // (dead here is dead in what is passed on, whatever their own game had heard when it sent this)
      if (!c.alive) c.pose[5] |= F_DEAD;
      zoneCheck(c);
      underCheck(c);
      gaitCheck(c, was);
      const w = typeof m.w === 'string' && ITEMS[m.w] ? m.w : null;
      c.w = w;
      c.m = Array.isArray(m.m) ? m.m.filter((x) => typeof x === 'string').slice(0, 4) : [];
      // (when their game says this was so, by its own clock: passed on as it is, for the others to space what they are shown by)
      c.n = typeof m.n === 'number' && Number.isFinite(m.n) ? Math.round(m.n) : undefined;
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
    case 'pin': {
      // (the pin of a grenade is out: its fuse runs from now, by this clock and nobody else's)
      if (!c.alive || typeof m.w !== 'string' || !THROWN[m.w]) return;
      if (pullPin(c.nades, m.w, Date.now()) === 'ok') stayOn(c, 'you pulled a pin');
      return;
    }
    case 'nade': {
      if (!c.alive || !isVec3(m.o) || !isVec3(m.v)) return;
      // It has to leave from where the thrower is, at a speed an arm can give it, and its pin has to be out. Which
      // grenade it is and how much of its fuse is left are what the server heard and counted: the game is not
      // asked, and everybody else is told the server's figure. (Until 2026-10-13 any game could say a grenade had
      // been thrown, and every hit it then claimed in nine seconds was believed.)
      const out = letGo(c.nades, m.o, m.v, [c.pose[0], c.pose[1], c.pose[2]], Date.now());
      if (!out) return;
      if (out.hand) handBlast(c, out.w, out.o);
      else broadcast({ t: 'nade', id: c.id, o: out.o, v: m.v, w: out.w, f: out.left }, c);
      return;
    }
    case 'bunker': {
      // a keycard at the door, by somebody standing at it (the card is theirs to use up: what they carry is their own game's to say)
      const d = world.bunkerDoor;
      if (!c.alive || !d || Math.hypot(c.pose[0] - d[0], c.pose[1] - d[1], c.pose[2] - d[2]) > 6) return;
      // (And they have a card, or had one a moment ago: their game takes it out of their pockets as it says this,
      // and which of the two reaches here first is not certain. Until 2026-10-13 nothing was asked: anybody who
      // sent this from the doorway had the bunker open, card or no card, and sent again each minute it stayed
      // open for good, which now would also keep its infected from ever coming back.)
      const had = cardSeen.get(c.id) ?? 0;
      if (!carries(c.inv, 'keycard') && Date.now() - had > CARD_GRACE_MS) return void flag(c, 'opened the bunker with no keycard', false);
      cardSeen.delete(c.id);
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
      // only things that are worn, and only as many as there are places to wear them (there were six places, and
      // the list was cut to six: there are eleven now, and whatever is drawn of any of them has room in it)
      c.g = (Array.isArray(m.g) ? m.g : []).filter((x) => typeof x === 'string' && !!ITEMS[x]?.wear).slice(0, GEAR_SLOTS.length);
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
      if (!['head', 'torso', 'legs', 'arms'].includes(m.zone)) return;
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
        // A grenade of theirs, gone off when the server's own count of its fuse says, no further from where it left
        // the hand than it can have flown, and reaching this body for the first time: see `judge`. The game says how
        // far off they were; it is believed no nearer than the grenade can have got.
        const far = num(m.dist) ? judge(c.nades, m.w, `p${target.id}`, [target.pose[0], target.pose[1] + 1.1, target.pose[2]], m.dist, now) : null;
        if (far === null) return;
        amount = hitDamage(m.w, 'torso', far);
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
        if (!mayHit(c, `p${target.id}`, now, rule.interval * 700)) return;
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
      if (!['head', 'torso', 'legs', 'arms'].includes(m.zone)) return;
      const now = Date.now();
      const d = Math.hypot(c.pose[0] - b.s[0], c.pose[1] - b.s[1], c.pose[2] - b.s[2]);
      if (d > rule.range + 6) return;
      let amount: number;
      if (rule.blast) {
        // something of theirs went off: a drum set off in the last few seconds, or a grenade, held to what any
        // blast of a grenade is held to (when, where, and each of them once: `judge`)
        if (!num(m.dist)) return;
        const far = m.w === 'barrel' ? (Math.min(...c.blasts.map((q) => now - q.at), Infinity) > 9000 ? null : Math.max(0, m.dist)) : judge(c.nades, m.w, `i${m.i}`, [b.s[0], b.s[1] + 1.2, b.s[2]], m.dist, now);
        if (far === null) return;
        amount = hitDamage(m.w, 'torso', far);
        m.zone = 'torso';
      } else if (m.w === 'jeep') {
        // run down, by whoever is at the wheel of a jeep that is right there
        const at = seatOf(c);
        if (!at || at.seat !== 0 || !num(m.dist) || Math.hypot(at.v.s[0] - b.s[0], at.v.s[2] - b.s[2]) > 7) return;
        amount = Math.max(0, Math.min(m.dist, Math.hypot(at.v.s[7], at.v.s[8], at.v.s[9]) + 3) - JEEP.bumpFrom) * JEEP.bumpPer;
        m.zone = 'torso';
      } else {
        if (m.w !== 'fists' && c.w !== m.w) return;
        if (!mayHit(c, `i${m.i}`, now, rule.interval * 700)) return;
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
      if (!b || !target?.alive || target.power.hidden) return;
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
      // (in front of the caller, and far enough off to be seen coming down: see `callSite`. Where they stand is
      // where they may still be standing when it lands.)
      const at = world.callSite(c.pose[0], c.pose[1], c.pose[2], c.pose[3]);
      // (it comes by helicopter from the map's edge, as every drop does: the flight says who called it, and when it is down)
      sendDrop(at, c.id);
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
      // (asked again for what they already have open, they are told what is in it and nothing is said of its doors)
      const again = c.openCid === m.cid && holder === c.id;
      if (!again) releaseLock(c);
      locks.set(m.cid, c.id);
      c.openCid = m.cid;
      if (!again) ajar(m.cid, true, c);
      touched(b);
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
      if (b.kind === 'crate') b.pickedAt = economy.time;
      touched(b);
      return;
    }
    case 'cclose': {
      if (c.openCid === m.cid) releaseLock(c);
      return;
    }
    case 'bury': {
      // A shovel in the hands, beside a case, a suitcase or a bag lying on the ground: it goes under the ground, with
      // what is in it, and all that is left to see is the turned earth. Or beside such a place: what is under it
      // comes up, and lies there again. Anybody's shovel brings up anybody's; it is the finding of the place that
      // keeps it.
      if (!c.alive || c.seatAt || c.w !== 'shovel' || typeof m.uid !== 'string') return;
      if (m.on) {
        const l = economy.loot.get(m.uid);
        if (!l || ITEMS[l.item.id]?.category !== 'stash' || boxes.has(m.uid)) return;
        if (Math.hypot(l.x - c.pose[0], l.z - c.pose[2]) > BURY.reach) return;
        // (out in the country and nowhere else: not in a town or a camp, not in a building, not beside one)
        const no = noBurying(l.x, l.y, l.z, world.groundAt(l.x, l.z), world.places, world.buildings);
        if (no) return void send(c, { t: 'tell', kind: 'warn', text: `${no}.` });
        const def = ITEMS[l.item.id], [w, h] = def.stash ?? [8, 6];
        if (!economy.take(m.uid)) return;
        const st: StashInfo = { uid: m.uid, x: l.x, y: world.groundAt(l.x, l.z), z: l.z, rot: l.rot, ...(def.id === 'stash_kit' ? {} : { item: def.id }), buried: true };
        boxes.set(m.uid, { cid: m.uid, kind: 'stash', w, h, items: cargoOf(l.item), ...st, emptiedAt: -1, touchedAt: Date.now() });
        KEPT.dirty = true;
        log(`${c.name} buried a ${def.name.toLowerCase()} at ${l.x.toFixed(0)}, ${l.z.toFixed(0)}`);
        broadcast({ t: 'stash+', s: st });
        return;
      }
      const b = boxes.get(m.uid);
      if (!b || b.kind !== 'stash' || !b.buried) return;
      if (Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) > BURY.reach) return;
      locks.delete(m.uid);
      boxes.delete(m.uid);
      KEPT.dirty = true;
      log(`${c.name} dug up a ${(ITEMS[b.item ?? 'stash_kit']?.name ?? 'stash').toLowerCase()} at ${b.x.toFixed(0)}, ${b.z.toFixed(0)}`);
      broadcast({ t: 'stash-', uid: m.uid });
      economy.drop(stashItem(b), b.x, b.y + 0.02, b.z, b.rot);
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
      const had = c.inv;
      c.inv = cleanInventory(m.inv);
      // (nobody without the power puts a thing in a hold: see `carryOrder`)
      if (c.inv && !c.power.bottomless) holdOnlyEmpties(c.inv, had);
      pockets(c);
      // (somebody with a keycard: remembered a moment, for when they put it in the bunker's reader)
      if (carries(c.inv, 'keycard')) cardSeen.set(c.id, Date.now());
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
      if (v && num(v.health) && num(v.energy) && num(v.water)) {
        // (nor any blood, and no wound of theirs is closed by it)
        const bleeding = held ? held.bleeding || !!v.bleeding : !!v.bleeding;
        const bleed = bleeding ? Math.max(held?.bleeding ? bleedOf(held) : 0, v.bleeding ? bleedOf(v) : 0) : 0;
        c.vitals = { health: held ? Math.min(held.health, v.health) : v.health, energy: v.energy, water: v.water, stamina: num(v.stamina) ? v.stamina : MAX_STAMINA, bleeding, blood: held ? Math.min(bloodOf(held), bloodOf(v)) : bloodOf(v), bleed, broken: !!v.broken };
      }
      return;
    }
    case 'died': {
      kill(c, typeof m.cause === 'string' ? m.cause.slice(0, 24) : 'unknown', num(m.v) ? Math.max(0, Math.min(2, Math.floor(m.v))) : 0);
      return;
    }
    case 'respawn': {
      // (Dead on their own screen, by what their game last said of where they are, and alive here: this server was
      // not told of the death, or took a return to life that their game never acted on. Whichever it was, they
      // are looking at the word Respawn and pressing it, and were left looking at it for good; and everybody
      // else saw them standing over their own body. What they carried is left where they are, and they come back.)
      if (c.alive) {
        if (!(c.pose[5] & F_DEAD)) return;
        log(`${c.name} asks to come back while alive here and dead by their own game: taken as a death`);
        kill(c, 'injuries');
      }
      const sp = pickSpawn({ x: c.pose[0], z: c.pose[2] });
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
      if (!text || (now - c.lastChat < 500 && !(text.startsWith('/') && roleOf(c)))) return;
      c.lastChat = now;
      // (an order, and never talk: whatever begins with a stroke is said to nobody and is not written down)
      if (text.startsWith('/')) return void command(c, text).catch((e) => log('[admin] an order failed:', e instanceof Error ? e.message : e));
      const quiet = ADMIN.muted.get(c.key) ?? 0;
      if (quiet > now) return void sys(c, `You are muted for ${Math.ceil((quiet - now) / 60000)} more minutes: what you type and say reaches nobody.`);
      // (the word before a name: their role, in the colour they chose; or nothing, for an admin who has put the tag off)
      const worn = ADMIN.tints.get(c.id), badge = worn === 'off' ? {} : { role: roleOf(c) ?? undefined, tint: worn };
      if (m.ch === 'staff') {
        // those with a role, to one another, wherever they are: nobody else is sent it, or told that anything was said
        if (!roleOf(c)) return;
        const out: S2C = { t: 'chat', ch: 'staff', from: c.name, text, role: roleOf(c) ?? undefined, ...(worn && worn !== 'off' ? { tint: worn } : {}) };
        for (const o of clients.values()) if (roleOf(o)) send(o, out);
        return;
      }
      if (m.ch === 'near') {
        // proximity: only players standing within earshot get it (the speaker included)
        const out: S2C = { t: 'chat', ch: 'near', from: c.name, text, ...badge };
        for (const o of clients.values()) {
          if (Math.hypot(o.pose[0] - c.pose[0], o.pose[1] - c.pose[1], o.pose[2] - c.pose[2]) <= CHAT_RANGE) send(o, out);
        }
      } else broadcast({ t: 'chat', ch: 'global', from: c.name, text, ...badge });
      return;
    }
    case 'admin':
      return void login(c, m.pw).catch(() => sys(c, 'The site did not answer: try again in a minute.'));
    case 'tint': {
      if (roleOf(c) !== 'admin') return;
      // ('off': no tag at all before their name where everybody talks: they are read as anybody is)
      if (m.color === 'off') ADMIN.tints.set(c.id, 'off');
      else if (typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color)) ADMIN.tints.set(c.id, m.color.toLowerCase());
      else ADMIN.tints.delete(c.id);
      return;
    }
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
          id: o.id, name: o.name, role: roleOf(o), x: Math.round(o.pose[0]), z: Math.round(o.pose[2]), yaw: Math.round(o.pose[3] * 100) / 100, alive: o.alive, flags: o.check.flags, mins: Math.round((now - o.joinedAt) / 60000),
          hp: Math.round(o.vitals?.health ?? 100), kills: scores.get(o.key)?.kills ?? 0, tags: scores.get(o.key)?.tags ?? 0,
          ...(o.power.hidden ? { hidden: true as const } : {}), ...(o.power.god ? { god: true as const } : {}), ...(o.power.clip ? { clip: true as const } : {}),
          ...((ADMIN.muted.get(o.key) ?? 0) > now ? { muted: true as const } : {}), ...(o.seatAt ? { seat: true as const } : {}),
          ...(o.power.voidInv ? { voidInv: true as const } : {}), ...(o.power.voidTag ? { voidTag: true as const } : {}),
          ...(o.power.weightless ? { weightless: true as const } : {}), ...(o.power.endless ? { endless: true as const } : {}), ...(o.power.bottomless ? { bottomless: true as const } : {}),
          ...(o.asleep ? { asleep: true as const } : away(o, now) && o.alive ? { away: true as const } : {}),
        })),
        gone: ADMIN.gone.slice(-20).reverse().map((g) => ({ id: g.id, name: g.name, mins: Math.round((now - g.at) / 60000) })),
        bans: admin
          ? [
              ...ADMIN.state.bans.map((b, i) => ({ n: i + 1, id: banId(b), name: b.name, why: b.why, by: b.by, at: b.at.slice(0, 10) })),
              // (and whoever is kept off for a while: lifted the same way)
              ...keptOffNow(now).map((b, i) => ({ n: ADMIN.state.bans.length + i + 1, id: offId(b), name: b.name, why: `${b.why} (for ${Math.ceil((b.until - now) / 60000)} more minutes)`, by: b.why.startsWith('timed out') ? 'a timeout' : 'the checks', at: new Date(b.until).toISOString().slice(11, 16) + ' UTC' })),
            ]
          : [],
        roles: admin ? Object.values(ADMIN.state.roles).map((r) => ({ name: r.name, role: r.role, by: r.by, at: r.at.slice(0, 10) })) : [],
        checks: CHECKS,
        stats: { up: Math.round(process.uptime() / 60), loot: economy.loot.size, stashes: [...boxes.values()].filter((b) => b.kind === 'stash').length + [...economy.loot.values()].filter((l) => l.keptAt !== undefined).length, kept: KEPT.chars.size + records.size, asleep: [...clients.values()].filter((o) => o.asleep).length, cars: vehicles.size, wrecks: [...vehicles.values()].filter((v) => v.goneAt).length, infected: [...horde.bodies.values()].filter((b) => !b.diedAt).length },
      });
    }
    case 'vin': {
      const v = vehicles.get(m.i);
      if (!v || !c.alive || v.goneAt || c.seatAt || !Number.isInteger(m.seat) || m.seat < 0 || m.seat >= SEATS || v.seats[m.seat] !== null) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[1] - v.s[1], c.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      // A tag taken off somebody is carried on foot, for fifteen minutes, with the map showing
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
      const amount = carDamage(rule);
      if (rule.blast) {
        // A drum set off in the last moments; or a grenade of theirs gone off when its fuse said, near enough to
        // reach it (a car is reached from seven tenths as far as a body), which it takes once from each grenade.
        // (It took one from every message that said so: one stick grenade, said twice, was the end of a car.)
        const recent = m.w === 'barrel' ? c.blasts.some((q) => now - q.at < 4000) : judge(c.nades, m.w, `v${v.i}`, [v.s[0], v.s[1], v.s[2]], 0, now, rule.blast * 0.7) !== null;
        if (!recent) return;
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
    ws.send(JSON.stringify({ t: 'kick', reason: 'This game was updated. Reload the page.', v: PROTOCOL } satisfies S2C));
    ws.close();
    return null;
  }
  const key = keyOf(m) || `anon-${Math.random().toString(36).slice(2)}`;
  const off = bannedFor(key, ipOf.get(ws) ?? '');
  if (off) {
    log(`${cleanName(m.name)} is not let in: ${off}`);
    ws.send(JSON.stringify({ t: 'kick', reason: doorWords(key, ipOf.get(ws) ?? '', off) } satisfies S2C));
    ws.close();
    return null;
  }
  if (addressFull(key, ipOf.get(ws) ?? '')) {
    TURNED.address++;
    log(`${cleanName(m.name)} is not let in: ${PER_ADDRESS} already playing from their address`);
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
  if (resume) for (const [k, since] of tagSeen) if (k.startsWith(`${key}|`)) tagSeen.set(k, since + (Date.now() - resume.leftAt));
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
    heardAt: Date.now(), kept: false, asleep: 0, bled: 0, logoutAt: 0, logoutFrom: [0, 0],
    since: Date.now(), spoke: false, resumed: !!resume,
    inv: resume?.inv ?? null, vitals: resume?.vitals ?? null,
    outAt: 0, underAt: 0, lastHit: 0, lastVHit: 0, seatAt: 0, nades: newThrower(), blasts: [], lastEmote: 0, lastChat: 0, lastHitBy: null, openCid: null, check: { at: Date.now(), carry: 0, owed: 0, heard: Date.now(), lag: 0, lagTill: 0, free: Date.now() + CHECK.free, high: 0, hovered: 0, flags: 0, said: 0, refused: [], hp: Math.min(100, resume?.vitals?.health ?? 100), hpAt: Date.now(), downAt: 0, unknown: new Set() }, activeAt: Date.now(), joinedAt: Date.now(), ip: ipOf.get(ws) ?? '', lifeAt: Date.now(), msgCount: 0, msgWindow: Date.now(),
  };
  records.delete(key);
  KEPT.chars.delete(keyHash(key));
  const others = [...clients.values()].filter((o) => shown(o, c)).map(info);
  clients.set(c.id, c);
  claim();
  send(c, {
    t: 'welcome', v: PROTOCOL, you: c.id, players: others,
    loot: [...economy.loot.values()],
    doors: [...doors].map(([i, [open, swing]]) => [i, open, swing]),
    stashes: [...boxes.values()].filter((b) => b.kind === 'stash').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, ...(b.item ? { item: b.item } : {}), ...(b.buried ? { buried: true } : {}) })),
    corpses: [...boxes.values()].filter((b) => b.kind === 'corpse').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor', v: b.v ?? 0 })),
    drops: [...boxes.values()].filter((b) => b.kind === 'drop').map(dropInfo),
    // (the helicopters in the air at this moment, each with how long it has been: this game puts it where everybody else's has it)
    flights: [...flights.values()].map(flightNow),
    barrels: [...barrelsGone.keys()],
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
  // back under another name: the board says so, to everybody
  const had = scores.get(c.key);
  if (had && had.name !== c.name) {
    had.name = c.name;
    sendBoard();
  } else sendBoard(c);
  log(`+ ${c.name} (#${c.id})${resume ? ' resumed' : ''} — ${clients.size} online`);
  // (somebody with a role is told so as they come in: their game shows them what they may do)
  if (roleOf(c)) send(c, { t: 'role', role: roleOf(c) });
  if (roleOf(c) === 'admin') asAdmin(c, false);
  // (and whoever comes in with an admin's hold and is none is told so: their game empties it)
  else noHold(c);
  return c;
}

function drop(c: Client) {
  if (!clients.delete(c.id)) return;
  hitsBy.delete(c.id);
  cardSeen.delete(c.id);
  ADMIN.gone.push({ id: c.id, name: c.name, key: c.key, ip: c.ip, at: Date.now() });
  ADMIN.asked.delete(c.id);
  ADMIN.tints.delete(c.id);
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
  // (where everybody is, for everybody; and for admins, where the vanished are as well)
  const all: typeof s = [];
  for (const c of clients.values()) {
    const p = c.pose;
    const row: (typeof s)[number] = [c.id, round2(p[0]), round2(p[1]), round2(p[2]), Math.round(p[3] * 1000) / 1000, Math.round(p[4] * 1000) / 1000, p[5], c.w, c.m, c.n ?? null];
    all.push(row);
    if (!c.power.hidden) s.push(row);
  }
  if (all.length === s.length) broadcast({ t: 'ps', s });
  else {
    const plain = JSON.stringify({ t: 'ps', s } satisfies S2C), whole = JSON.stringify({ t: 'ps', s: all } satisfies S2C);
    for (const c of clients.values()) if (c.ws.readyState === 1) c.ws.send(roleOf(c) === 'admin' ? whole : plain);
  }
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
  // (the bunker's are not put back while its door stands open: the home that is no open ground is the bunker)
  const turn = horde.tick(now, [...clients.values()].filter((c) => c.alive && !away(c) && !c.power.hidden).map((c) => ({ id: c.id, x: c.pose[0], z: c.pose[2] })), (home) => !!home.inside && bunkerDoor.open);
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
  // (a body left behind does not hold a place: eleven of them and eleven players were a server of twenty-four all but full)
  return awake() >= MAX_PLAYERS || queue.length > 0 || !KEPT.ready;
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
  while (KEPT.ready && awake() < MAX_PLAYERS && queue.length) {
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

/**
 * The helicopters in the air with a supply drop (src/sim/airdrop.ts): each flight as it was said, and the moment
 * (the clock on the wall, ms) it appeared on the map's edge. Everything a game draws and hears of one follows from
 * those two. Not kept over a restart: a flight the server forgets brings no crate, and the next comes by the clock.
 */
const flights = new Map<string, { f: Flight; at: number; landed: boolean }>();
/** a flight as it is said to somebody now: with how long it has been in the air */
const flightNow = (e: { f: Flight; at: number }): Flight => ({ ...e.f, age: Math.round((Date.now() - e.at) / 10) / 100 });

/**
 * A supply drop is sent: a helicopter appears on the map's edge, flies to the place, holds over it and lets the
 * crate down under a canopy, stays a while and flies off the map another way. Everybody is told of the flight at
 * once (`heli+`), and of the crate (`drop+`) only when it is on the ground: until then there is nothing in the
 * world to open.
 * @param where the place (called for on a radio, or an admin's), and not one of the map's choosing
 * @param by whoever called it
 * @returns the flight, or null if the map had nowhere to set a crate down
 */
function sendDrop(where?: { x: number; y: number; z: number }, by?: number): Flight | null {
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
      // (Emptied, it is filled again five minutes on. Gone through and not emptied, a quarter of an hour after
      // anybody last had a hand in it: until 2026-10-13 it was filled only when wholly empty, and one tin left
      // in a weapons case kept that case from ever being filled again.)
      const quiet = !locks.has(b.cid) && !alive.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 60);
      if (b.items.length) {
        b.emptiedAt = -1;
        // (Not over anything that was put into it: a crate has always been somewhere to leave a thing, and a
        // refill takes the place of all that is in it.)
        const own = b.filled, leftOnly = !!own && b.items.every((it) => own.includes(it.uid));
        if (b.pickedAt !== undefined && economy.time - b.pickedAt > CRATE_RESTOCK * 3 && quiet && leftOnly) fillBox(b);
      } else if (b.emptiedAt < 0) b.emptiedAt = economy.time;
      else if (economy.time - b.emptiedAt > CRATE_RESTOCK && quiet) fillBox(b);
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

/**
 * The changelog's hearts and comments, over plain requests from the page (which is on another host: anybody may
 * ask). What is sent is read as text and may not be long. Who is asking is told by where they ask from, and by the
 * mark their browser gives.
 */
function newsHttp(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const head = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  const say = (code: number, body: unknown) => {
    res.writeHead(code, head);
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...head, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' });
    return void res.end();
  }
  if (req.method === 'GET' && url.pathname === '/news') return say(200, { ok: true, entries: news.view(url.searchParams.get('by') ?? undefined) });
  if (req.method !== 'POST') return say(405, { ok: false, why: 'Not that way.' });
  const address = addressOf(req);
  let raw = '', over = false;
  req.setEncoding('utf8');
  req.on('data', (d: string) => {
    raw += d;
    if (raw.length > 4096 && !over) {
      over = true;
      say(413, { ok: false, why: 'Too long.' });
      req.destroy();
    }
  });
  req.on('end', () => {
    if (over) return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
      if (!m || typeof m !== 'object') throw new Error('not a thing');
    } catch {
      return say(400, { ok: false, why: 'Not understood.' });
    }
    const now = Date.now();
    const r =
      url.pathname === '/news/heart' ? news.heart(m.entry, m.by, address, now)
      : url.pathname === '/news/comment' ? news.say(m.entry, m.by, address, m.name, m.text, now)
      : url.pathname === '/news/remove' ? { ok: typeof m.id === 'number' && typeof m.by === 'string' && news.remove(m.id, m.by) }
      : null;
    if (!r) return say(404, { ok: false, why: 'No such thing.' });
    if (r.ok) {
      // (it goes into what is kept the next time that is written: nothing is written for it now)
      KEPT.dirty = true;
      if ('comment' in r) log(`[news] #${r.comment.id} under ${String(m.entry)} by ${r.comment.name}: ${r.comment.text}`);
    }
    say(200, r);
  });
  req.on('error', () => {});
}

function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    // readable from a client hosted somewhere else (e.g. Vercel) for the start-screen player count
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    // (places: how many different addresses the players come from. One, with several players on, means the host is not passing addresses through.)
    res.end(JSON.stringify({ ok: true, boot: BOOT, protocol: PROTOCOL, why: RESTART.why, kept: KEPT.how, saved: KEPT.last, players: [...clients.values()].filter((c) => !c.asleep).length, asleep: [...clients.values()].filter((c) => c.asleep).length, max: MAX_PLAYERS, queue: queue.length, uptime: Math.round(process.uptime()), checks: CHECKS, flagged, keptOff: BANS.temp.size, loot: economy.loot.size, places: new Set([...clients.values()].map((c) => c.ip)).size, unspoken: [...clients.values()].filter((c) => !c.spoke && !c.asleep).length, turned: TURNED, captcha: CAPTCHA_ON, ...(CAPTCHA_ON ? { captchaKey: CAPTCHA.site, captchaSays: SLIPS } : {}), botcheck: BOTCHECK.on, ...(BOTCHECK.on ? { ranges: RANGES } : {}) }));
    return;
  }
  // whoever is about to deploy says so here first, and everything kept is written (see `deploying`)
  if (url.pathname === '/deploying') return void deploying(url, res);
  // the changelog page asks here for its hearts and comments, and gives them (see `news`)
  if (url.pathname === '/news' || url.pathname.startsWith('/news/')) return void newsHttp(req, res, url);
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

/**
 * Whose page a connection is asked for from. A browser says, of every such connection, which page asked for it;
 * a program written to open connections by the dozen mostly says nothing, or something else. It can be made to
 * say anything, so this stops only what has not bothered: which, 2026-10-12, was worth stopping. Asked on the
 * host (Render) or wherever ORIGINS is set (hosts, comma between; "off" for never); a development machine and
 * the tests are let alone.
 */
const ORIGINS = (() => {
  const set = process.env.ORIGINS ?? '';
  if (set === 'off' || (!set && !process.env.RENDER)) return null;
  const hosts = new Set<string>(['localhost', '127.0.0.1']);
  const add = (u: string) => {
    try {
      const h = new URL(u.includes('://') ? u : `https://${u}`).hostname.toLowerCase();
      hosts.add(h);
      // (with and without the three letters before it)
      hosts.add(h.startsWith('www.') ? h.slice(4) : `www.${h}`);
    } catch {
      /* not an address */
    }
  };
  add(SITE_URL);
  // (and the game's own name, whatever the site is set to be here)
  add('https://www.zonapvp.fun');
  if (process.env.RENDER_EXTERNAL_URL) add(process.env.RENDER_EXTERNAL_URL);
  if (process.env.OTHER_URL) add(process.env.OTHER_URL);
  for (const h of set.split(',').map((x) => x.trim()).filter(Boolean)) add(h);
  return hosts;
})();
function fromOurPage(req: http.IncomingMessage): boolean {
  if (!ORIGINS) return true;
  const said = String(req.headers.origin ?? '');
  let host = '';
  try {
    host = new URL(said).hostname.toLowerCase();
  } catch {
    return false;
  }
  // (the site's own trial copies, before they are the site)
  return ORIGINS.has(host) || /^dayz-web-slice[\w-]*\.vercel\.app$/.test(host);
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
  if (!fromOurPage(req)) {
    TURNED.origin++;
    if (TURNED.origin < 20 || TURNED.origin % 100 === 0) log(`a connection asked for from ${String(req.headers.origin ?? 'no page at all').slice(0, 80)} is not taken (${TURNED.origin} so far)`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req: http.IncomingMessage) => {
  ipOf.set(ws, addressOf(req));
  let c: Client | null = null;
  let waiting = false;
  /** Cloudflare is being asked whether the slip this connection gave is good */
  let asking = false;
  /** on the bot check's range, and not yet anybody in the world: the judge of this go, when it was dealt, which go it is */
  let range: { judge: RangeJudge; began: number; go: number; hello: Extract<C2S, { t: 'hello' }>; said: number; saidAt: number; dealtAt: number; begun: boolean } | null = null;
  /** what this connection's browser has said of itself on the range */
  let browser: { wd: boolean; gl: string } | null = null;
  /** into the world, or into the line for it */
  /** @param ranged they have this moment passed the bot check's range: see CHECK.fresh */
  const letIn = (h: Extract<C2S, { t: 'hello' }>, ranged = false) => {
    const fresh = (client: Client | null) => {
      if (client && ranged) client.check.free = Date.now() + CHECK.fresh;
      return client;
    };
    if (mustWait(h)) {
      waiting = !!enqueue(ws, h, (client) => {
        waiting = false;
        c = fresh(client);
      });
    } else c = fresh(join(ws, h));
  };
  let ranging: ReturnType<typeof setInterval> | null = null;
  const offRange = () => {
    if (ranging) clearInterval(ranging);
    ranging = null;
    if (range) RANGES.on--;
    range = null;
  };
  const hello = setTimeout(() => !c && !waiting && !asking && !range && ws.close(), 8000);
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
    if (!c && range) {
      // (on the range: what the game says of where it stands and what it fires, and nothing else)
      const now = Date.now(), r = range;
      if (now - r.saidAt > 1000) {
        r.saidAt = now;
        r.said = 0;
      }
      if (++r.said > 90) return;
      const at = now - r.began;
      if (m.t === 'renv') browser = { wd: m.wd === true, gl: String(m.gl ?? '').slice(0, 160) };
      // (The game has built the range and stood the figures on it: the go's clock starts here, and not when it
      // was dealt. A slow machine is a dozen seconds at that, which were coming off its forty. Said once, and
      // only in the first quarter of a minute: nobody is given a go that never ends.)
      else if (m.t === 'rgo') {
        if (m.g === r.go && !r.begun && now - r.dealtAt < 15_000) {
          r.begun = true;
          r.began = now;
          r.judge = new RangeJudge(r.judge.spec);
        }
      }
      // (of the go before this one, and late: nothing to this one)
      else if ((m.t === 'r' || m.t === 'rs') && m.g !== r.go) return;
      else if (m.t === 'r' && Array.isArray(m.p) && m.p.length === 4) r.judge.seen(Number(m.n), Number(m.p[0]), Number(m.p[1]), Number(m.p[2]), Number(m.p[3]), at);
      else if (m.t === 'rs' && Array.isArray(m.o) && Array.isArray(m.d) && m.o.length === 3 && m.d.length === 3) {
        const i = r.judge.shot(Number(m.n), m.o.map(Number), m.d.map(Number), at);
        if (process.env.RANGE_DEBUG) log(`[range] shot at ${m.n} (server ${at}) from ${m.o.map((v: number) => Number(v).toFixed(2)).join(',')} along ${m.d.map((v: number) => Number(v).toFixed(3)).join(',')}: ${i >= 0 ? `figure ${i} down` : r.judge.why || 'landed on nothing'}; ${shotMisses(r.judge.spec, m.o.map(Number), m.d.map(Number), Number(m.n))}`);
        if (i >= 0) ws.send(JSON.stringify({ t: 'rhit', i } satisfies S2C));
        if (r.judge.passed && BOTCHECK.env && (!browser || browser.wd || /swiftshader|llvmpipe|softpipe|software|basic render/i.test(browser.gl))) {
          TURNED.range++;
          log(`${cleanName(r.hello.name)} shot the range, in a browser that ${!browser ? 'said nothing of itself' : browser.wd ? 'a program is driving' : `draws with "${browser.gl}"`}: turned away`);
          offRange();
          ws.send(JSON.stringify({ t: 'kick', reason: 'The bot check was not passed: this browser is being driven by a program, or has no graphics card to draw with.' } satisfies S2C));
          ws.close();
          return;
        }
        if (r.judge.passed) {
          const h = r.hello, key = keyOf(h);
          log(`${cleanName(h.name)} passed the bot check in ${(at / 1000).toFixed(0)} s (go ${r.go}): ${r.judge.report}`);
          RANGES.passed++;
          offRange();
          if (key && BOTCHECK.ms) shooters.set(`${keyHash(key)}|${ipOf.get(ws) ?? ''}`, now + BOTCHECK.ms);
          if (shooters.size > 20000) for (const [k, until] of shooters) if (until < now) shooters.delete(k);
          ws.send(JSON.stringify({ t: 'rpass' } satisfies S2C));
          letIn(h, true);
        }
      }
      return;
    }
    if (!c) {
      if (m.t !== 'hello' || waiting) return;
      if (m.v === PROTOCOL && flooding(ipOf.get(ws) ?? '')) {
        TURNED.flood++;
        ws.send(JSON.stringify({ t: 'kick', reason: 'Too many tries from your connection in a minute. Wait a little and press Play again.' } satisfies S2C));
        ws.close();
        return;
      }
      const ip = ipOf.get(ws) ?? '', key = keyOf(m);
      // (Shown to be a person's browser, or not asked: now the range, for whoever has not lately passed it.
      // Not for somebody who is to be turned away whatever they shoot: they are told so at once, by `join`.)
      const enter = (h: Extract<C2S, { t: 'hello' }>) => {
        if (h.v !== PROTOCOL || knownShooter(key, ip) || bannedFor(key || 'nobody', ip) || addressFull(key, ip)) return void letIn(h);
        const deal = (go: number) => {
          const spec = nextRange();
          if (range) RANGES.on--;
          range = { judge: new RangeJudge(spec), began: Date.now(), go, hello: h, said: 0, saidAt: 0, dealtAt: Date.now(), begun: false };
          RANGES.on++;
          RANGES.dealt++;
          ws.send(JSON.stringify({ t: 'range', seed: spec.seed, turn: spec.turn, go } satisfies S2C));
          if (process.env.RANGE_DEBUG) log(`[range] dealt ${spec.seed} turn ${spec.turn}: ${JSON.stringify(spec.figures.map((f) => [+f.x.toFixed(2), f.z, +f.reach.toFixed(2), +f.secs.toFixed(2), +f.start.toFixed(3)]))}`);
        };
        deal(1);
        ranging = setInterval(() => {
          const r = range;
          if (!r || ws.readyState !== 1) return void offRange();
          if (!r.judge.failed(Date.now() - r.began)) return;
          RANGES.failed++;
          log(`${cleanName(h.name)} did not pass go ${r.go} of the bot check: ${r.judge.report}`);
          if (r.go >= BOTCHECK.goes) {
            TURNED.range++;
            log(`${cleanName(h.name)} did not pass the bot check in ${BOTCHECK.goes} goes: turned away`);
            offRange();
            ws.send(JSON.stringify({ t: 'kick', reason: 'The bot check was not passed. Press Deploy to try again.' } satisfies S2C));
            ws.close();
            return;
          }
          deal(r.go + 1);
        }, 500);
      };
      if (m.v !== PROTOCOL || knownPerson(key, ip)) return void enter(m);
      // (not known for a person: the slip, or the asking for one)
      const again = (reason: string) => {
        TURNED.captcha++;
        ws.send(JSON.stringify({ t: 'kick', reason, captcha: CAPTCHA.site } satisfies S2C));
        ws.close();
      };
      const slip = typeof m.proof === 'string' ? m.proof.slice(0, 4096) : '';
      if (!slip) return void again('One check that you are a person, and you are in.');
      if (asking) return;
      asking = true;
      void goodSlip(slip, ip).then((good) => {
        asking = false;
        if (ws.readyState !== 1 || c) return;
        if (good === false) return void again('The check that you are a person did not pass. Press Play to try again.');
        if (good === null) {
          log(`the check that ${cleanName(m.name)} is a person could not be asked of Cloudflare: turned away`);
          return void again('The check that you are a person could not be confirmed just now. Press Play to try again in a moment.');
        }
        if (key && CAPTCHA.ms) persons.set(personOf(key, ip), Date.now() + CAPTCHA.ms);
        if (persons.size > 20000) for (const [k, until] of persons) if (until < Date.now()) persons.delete(k);
        enter(m);
      });
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
    offRange();
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
/**
 * A server that has been the one the world reaches, and now finds another answering there, has been replaced: a
 * new one is up, and the host will tell this one to stop in a minute or so. It does not wait to be told. It says
 * its last word at once (which is what the new one is waiting for before it lets anybody in), tells everybody on
 * that the server is restarting, and goes: their games find the new one, and they are in it seconds later with
 * what they had. (Left to play on here for that minute, whatever they did in it would have been played on a server
 * nobody else could join, and the new one would have stood shut for as long.)
 */
{
  let reached = false, away = 0;
  const watch = setInterval(async () => {
    if (stopping || !PUBLIC_URL || !KEPT.ready) return;
    const here = await reachedHere();
    if (here === true) {
      reached = true;
      away = 0;
    } else if (here === false && reached && ++away >= 2 && !stopping) {
      stopping = true;
      clearInterval(watch);
      log('another server answers where this one was reached: this one has been replaced, says its last word and goes');
      sayRestart(RESTART.why, 0);
      saveWorld();
      void Promise.race([keepNow(true, 'another server has taken over'), pause(12_000)]).finally(() => setTimeout(() => process.exit(0), 600));
    } else if (here !== false) away = 0;
  }, Number(process.env.REPLACED_EVERY_MS) || 4000);
  watch.unref();
}
// (A test stops it as a host does, by a word on its input: on Windows a process cannot be asked to stop, only stopped.)
if (process.env.STOP_BY_WORD) process.stdin.on('data', (d) => String(d).includes('stop') && process.emit('SIGTERM'));
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    log('shutting down, saving world');
    // (to whoever is still on: their game says so, and looks for the server that comes after this one)
    sayRestart('', 0);
    saveWorld();
    // (and its last word to the site, where it outlasts this server: a few seconds are allowed for it)
    void Promise.race([keepNow(true, 'this server is stopping'), pause(12_000)]).finally(() => process.exit(0));
  });
}
