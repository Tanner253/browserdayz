// ZONA game server. One process: serves the built client and runs the shared world
// over a WebSocket at /ws.
//
// Authority (see src/net/protocol.ts): the server owns the loot economy, containers
// (map crates, stashes, bodies), doors, who is alive, spawn points and how much a hit
// hurts. Clients own their movement, aim and inventory.

import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WebSocketServer, type WebSocket } from 'ws';
import { buildWorldData } from './world';
import { Economy, type WorldLoot } from '../src/sim/economy';
import { Container, type SerializedInventory } from '../src/sim/inventory';
import { ITEMS, TAG_HOLD, sanitizeItem, type ItemInstance } from '../src/sim/items';
import { DROP, fillDrop, type DropInfo } from '../src/sim/drops';
import { CRATE_RESTOCK, CRATE_SPECS, fillCrate } from '../src/sim/crates';
import { WEAPON_RULES, hitDamage, type HitZone } from '../src/sim/combat';
import { BARREL } from '../src/sim/barrels';
import { EMOTE, EMOTE_GAP, SHOUT_RANGE } from '../src/sim/emotes';
import { ACTS, CHAT_RANGE, F_DEAD, MAX_STAMINA, PROTOCOL, type C2S, type CorpseInfo, type KillInfo, type PlayerInfo, type Pose, type S2C, type StashInfo, type StoredItem, type Vitals } from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'world.json');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 24);
const TICK_HZ = 15;
const CORPSE_LIFETIME = 600; // seconds
const RECORD_LIFETIME = 30 * 60 * 1000; // a logged-out character is remembered this long
/** bump when loot points change: world loot from an older save is re-rolled */
const WORLD_REV = 8;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------ world

log('generating world…');
const t0 = Date.now();
const world = buildWorldData(ROOT);
log(`world ready in ${Date.now() - t0} ms: ${world.lootPoints.length} loot points, ${world.crates.length} crates, ${world.barrels.length} fuel drums, ${world.spawns.length} spawns`);

interface Box {
  cid: string;
  kind: 'crate' | 'stash' | 'corpse' | 'drop';
  w: number;
  h: number;
  items: StoredItem[];
  x: number;
  y: number;
  z: number;
  rot: number;
  /** crate prop kind (loot table) */
  crate?: string;
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
const BARREL_RESPAWN = Number(process.env.BARREL_RESPAWN_S) || BARREL.respawn;

const economy = new Economy(world.lootPoints, {
  spawn: (l) => broadcast({ t: 'loot+', l }),
  despawn: (l) => broadcast({ t: 'loot-', uid: l.uid }),
});

function fillBox(b: Box) {
  const spec = CRATE_SPECS[b.crate ?? ''];
  if (!spec) return;
  const c = new Container(b.cid, spec.label, spec.w, spec.h, [], true);
  fillCrate(c, b.crate!);
  b.items = c.serialize().items;
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
const TAG_PAIR_GAP_MS = (Number(process.env.TAG_PAIR_GAP_S) || 3 * 3600) * 1000;
/** `${who cashed in}>${whose tag}` (each a player's key, or "ip:" and where they play from) -> when */
const pairPaidAt = new Map<string, number>();

/** where a connection comes from, as near as the host lets it be known */
function addressOf(req: http.IncomingMessage): string {
  const first = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').split(',')[0].trim();
  return first(req.headers['cf-connecting-ip']) || first(req.headers['true-client-ip']) || first(req.headers['x-forwarded-for']) || req.socket.remoteAddress || '';
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
  const entry: CashIn = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, at: new Date().toISOString(), name: c.name, owner, wallet };
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

// ------------------------------------------------------------------ players

interface Client {
  ws: WebSocket;
  id: number;
  key: string;
  name: string;
  pose: Pose;
  w: string | null;
  m: string[];
  g: string[];
  alive: boolean;
  inv: SerializedInventory | null;
  vitals: Vitals | null;
  lastHit: number;
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
}

interface Record_ {
  pose: Pose;
  inv: SerializedInventory | null;
  vitals: Vitals | null;
  alive: boolean;
  leftAt: number;
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

const info = (c: Client): PlayerInfo => ({ id: c.id, name: c.name, pose: c.pose, w: c.w, m: c.m, g: c.g, alive: c.alive });

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
const isPose = (v: unknown): v is Pose => Array.isArray(v) && v.length === 6 && v.every(num) && Math.abs(v[0]) < 600 && Math.abs(v[2]) < 600 && Math.abs(v[1]) < 500;
const cleanName = (s: unknown) => (typeof s === 'string' ? s : '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Survivor';
const round2 = (v: number) => Math.round(v * 100) / 100;

function cleanItem(raw: unknown, depth = 0): ItemInstance | null {
  if (!raw || typeof raw !== 'object' || depth > 2) return null;
  const r = raw as ItemInstance;
  const def = ITEMS[r.id];
  if (!def || typeof r.uid !== 'string' || r.uid.length > 64) return null;
  const it: ItemInstance = { uid: r.uid, id: r.id, qty: def.stack ? Math.max(1, Math.min(def.stack, Math.floor(Number(r.qty) || 1))) : 1 };
  if (def.weapon) {
    it.loaded = Math.max(0, Math.min(def.weapon.capacity + 4, Math.floor(Number(r.loaded) || 0)));
    if (Array.isArray(r.mods)) it.mods = r.mods.filter((m) => typeof m === 'string').slice(0, 4);
  }
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

/** everything a character carried goes into a body that can be searched for a while */
function makeCorpse(c: Client, v: number): CorpseInfo | null {
  const inv = c.inv;
  const [x, , z, yaw] = c.pose;
  const y = c.pose[1];
  const uid = `corpse_${c.id}_${Date.now().toString(36)}`;
  const box = new Container(uid, 'Body', 8, 10, [], true);
  const spill: ItemInstance[] = [];
  const put = (it: ItemInstance | null) => {
    if (!it) return;
    const left = box.add(it);
    if (left) spill.push(left);
  };
  if (inv) {
    for (const it of Object.values(inv.slots)) put(it);
    for (const cont of inv.containers) for (const s of cont.items) put(cleanItem(s));
    // their own tag (one, however many they claim to carry) can now be taken and cashed in
    const own = carriedTags(inv).find((t) => !lootedTags.has(t.uid) && (t.owner ?? '') === c.name);
    if (own) lootedTags.set(own.uid, { owner: c.name, ownerKey: c.key, ownerIp: c.ip, livedMs: Date.now() - c.lifeAt });
  }
  for (const it of spill) {
    const a = Math.random() * Math.PI * 2;
    economy.drop(it, x + Math.cos(a) * 0.9, y, z + Math.sin(a) * 0.9, Math.random() * 6.28);
  }
  if (!box.items.length) return null;
  boxes.set(uid, { cid: uid, kind: 'corpse', w: 8, h: 10, items: box.serialize().items, x, y, z, rot: yaw, emptiedAt: -1, name: c.name, expires: economy.time + CORPSE_LIFETIME, v });
  return { uid, x, y, z, rot: yaw, name: c.name, v };
}

function kill(c: Client, cause: string, v = 0) {
  if (!c.alive) return;
  c.alive = false;
  releaseLock(c);
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
  if (m.t !== 's' && m.t !== 'me' && m.t !== 'ping' && m.t !== 'gear') c.activeAt = Date.now();
  switch (m.t) {
    case 's': {
      if (!isPose(m.p)) return;
      // (a step, or a turn of the head)
      const was = c.pose;
      if (Math.abs(m.p[0] - was[0]) + Math.abs(m.p[2] - was[2]) > 0.02 || Math.abs(m.p[3] - was[3]) + Math.abs(m.p[4] - was[4]) > 0.004) c.activeAt = Date.now();
      c.pose = m.p;
      const w = typeof m.w === 'string' && ITEMS[m.w] ? m.w : null;
      c.w = w;
      c.m = Array.isArray(m.m) ? m.m.filter((x) => typeof x === 'string').slice(0, 4) : [];
      return;
    }
    case 'shot': {
      if (!c.alive || !isVec3(m.o) || !isVec3(m.d) || !WEAPON_RULES[m.w] || WEAPON_RULES[m.w].melee) return;
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
    case 'hit': {
      const target = clients.get(m.to);
      const rule = WEAPON_RULES[m.w];
      if (!target || !target.alive || !c.alive || !rule || target === c) return;
      if (!['head', 'torso', 'legs'].includes(m.zone)) return;
      const now = Date.now();
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
      } else {
        // you can only hit with what you are holding (fists are always there)
        if (m.w !== 'fists' && c.w !== m.w) return;
        if (now - c.lastHit < rule.interval * 700) return;
        c.lastHit = now;
        amount = hitDamage(m.w, m.zone, d, !!m.sup, num(m.bonus) ? m.bonus : 0);
      }
      if (amount <= 0) return;
      const len = Math.max(0.001, Math.hypot(target.pose[0] - from[0], target.pose[2] - from[1]));
      target.lastHitBy = { id: c.id, name: c.name, w: m.w, zone: m.zone, dist: d, at: now };
      send(target, { t: 'dmg', from: c.id, amount, zone: m.zone, w: m.w, dir: [(target.pose[0] - from[0]) / len, 0, (target.pose[2] - from[1]) / len] });
      send(c, { t: 'hitok', to: target.id, amount, zone: m.zone });
      return;
    }
    case 'take': {
      if (typeof m.uid !== 'string' || !c.alive) return;
      // first request wins; the economy's despawn event tells everyone it is gone
      if (!economy.take(m.uid)) send(c, { t: 'denied', uid: m.uid });
      return;
    }
    case 'drop': {
      const l = m.l;
      const item = cleanItem(l?.item);
      if (!item || !num(l.x) || !num(l.y) || !num(l.z) || !num(l.rot) || economy.loot.has(item.uid)) return;
      if (Math.hypot(l.x - c.pose[0], l.z - c.pose[2]) > 12) return;
      economy.drop(item, l.x, l.y, l.z, l.rot);
      return;
    }
    case 'copen': {
      const b = boxes.get(m.cid);
      if (!b || !c.alive) return;
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
      if (!b || locks.get(m.cid) !== c.id) return;
      b.items = cleanStored(m.items);
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
      if (Math.hypot(s.x - c.pose[0], s.z - c.pose[2]) > 8) return;
      const st: StashInfo = { uid: s.uid, x: s.x, y: s.y, z: s.z, rot: s.rot };
      boxes.set(s.uid, { cid: s.uid, kind: 'stash', w: 8, h: 6, items: [], ...st, emptiedAt: -1 });
      broadcast({ t: 'stash+', s: st }, c);
      return;
    }
    case 'stash-': {
      const b = boxes.get(m.uid);
      if (!b || b.kind !== 'stash' || b.items.length) return;
      const holder = locks.get(m.uid);
      if (holder !== undefined && holder !== c.id && clients.has(holder)) return;
      locks.delete(m.uid);
      boxes.delete(m.uid);
      broadcast({ t: 'stash-', uid: m.uid }, c);
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
      // the clock on a looted tag starts the first time the server sees it in somebody else's pockets
      for (const t of carriedTags(c.inv)) {
        const from = lootedTags.get(t.uid);
        if (from && from.ownerKey !== c.key && !tagSeen.has(`${c.key}|${t.uid}`)) tagSeen.set(`${c.key}|${t.uid}`, Date.now());
      }
      const v = m.vitals;
      if (v && num(v.health) && num(v.energy) && num(v.water)) c.vitals = { health: v.health, energy: v.energy, water: v.water, stamina: num(v.stamina) ? v.stamina : MAX_STAMINA, bleeding: !!v.bleeding };
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
      send(c, { t: 'spawn', ...sp });
      broadcast({ t: 'alive', id: c.id }, c);
      return;
    }
    case 'chat': {
      const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
      const now = Date.now();
      if (!text || now - c.lastChat < 500) return;
      c.lastChat = now;
      if (m.ch === 'near') {
        // proximity: only players standing within earshot get it (the speaker included)
        const out: S2C = { t: 'chat', ch: 'near', from: c.name, text };
        for (const o of clients.values()) {
          if (Math.hypot(o.pose[0] - c.pose[0], o.pose[1] - c.pose[1], o.pose[2] - c.pose[2]) <= CHAT_RANGE) send(o, out);
        }
      } else broadcast({ t: 'chat', ch: 'global', from: c.name, text });
      return;
    }
    case 'cash': {
      // the tag has to be one this player really carries, with its time (nearly) served:
      // our copy of their inventory is a few seconds behind theirs
      const tag = findCarried(c, m.uid);
      if (!tag || tag.id !== 'dogtag' || (tag.held ?? 0) < TAG_HOLD - 30) return;
      tag.held = 0;
      const owner = tag.owner ?? 'Survivor';
      const from = lootedTags.get(tag.uid);
      const now = Date.now();
      // (a tag this server did not see taken: it has restarted since, and no longer knows whose pockets it came out of)
      const why = from ? notEarned(c, from, tagSeen.get(`${c.key}|${tag.uid}`), now) : 'the server restarted while you were carrying it';
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
  // the same character can only be in the world once
  for (const o of clients.values()) {
    if (o.key === key) {
      send(o, { t: 'kick', reason: 'You connected from another tab.' });
      o.ws.close();
      drop(o);
    }
  }
  const rec = records.get(key);
  const resume = rec && rec.alive && rec.inv && Date.now() - rec.leftAt < RECORD_LIFETIME ? rec : null;
  const sp = resume ? { x: resume.pose[0], y: resume.pose[1], z: resume.pose[2], yaw: resume.pose[3] } : pickSpawn();
  const c: Client = {
    ws, id: nextId++, key, name: cleanName(m.name),
    pose: [sp.x, 'y' in sp && sp.y !== undefined ? sp.y : world.groundAt(sp.x, sp.z), sp.z, sp.yaw, 0, 0],
    w: null, m: [], g: [], alive: true,
    inv: resume?.inv ?? null, vitals: resume?.vitals ?? null,
    lastHit: 0, lastNade: 0, nadeHits: 0, blasts: [], lastEmote: 0, lastChat: 0, lastHitBy: null, openCid: null, activeAt: Date.now(), joinedAt: Date.now(), ip: ipOf.get(ws) ?? '', lifeAt: Date.now(), msgCount: 0, msgWindow: Date.now(),
  };
  records.delete(key);
  const others = [...clients.values()].map(info);
  clients.set(c.id, c);
  send(c, {
    t: 'welcome', v: PROTOCOL, you: c.id, players: others,
    loot: [...economy.loot.values()],
    doors: [...doors].map(([i, [open, swing]]) => [i, open, swing]),
    stashes: [...boxes.values()].filter((b) => b.kind === 'stash').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot })),
    corpses: [...boxes.values()].filter((b) => b.kind === 'corpse').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor', v: b.v ?? 0 })),
    drops: [...boxes.values()].filter((b) => b.kind === 'drop').map(dropInfo),
    barrels: [...barrelsGone.keys()],
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
  return c;
}

function drop(c: Client) {
  if (!clients.delete(c.id)) return;
  releaseLock(c);
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
    const p = c.pose;
    s.push([c.id, round2(p[0]), round2(p[1]), round2(p[2]), Math.round(p[3] * 1000) / 1000, Math.round(p[4] * 1000) / 1000, p[5], c.w, c.m]);
  }
  broadcast({ t: 'ps', s });
}, 1000 / TICK_HZ);

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
  return clients.size >= MAX_PLAYERS || queue.length > 0;
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
  while (clients.size < MAX_PLAYERS && queue.length) {
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
    if (now - c.activeAt < IDLE_KICK_MS) continue;
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
  return { uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, left: Math.max(0, Math.round((b.expires ?? 0) - economy.time)) };
}

function spawnDrop() {
  const at = world.dropSite();
  if (!at) return;
  const uid = `drop-${Math.round(economy.time)}-${Math.random().toString(36).slice(2, 7)}`;
  const c = new Container(uid, DROP.label, DROP.w, DROP.h, [], true);
  fillDrop(c);
  const b: Box = { cid: uid, kind: 'drop', w: DROP.w, h: DROP.h, items: c.serialize().items, x: at.x, y: at.y, z: at.z, rot: Math.random() * Math.PI * 2, emptiedAt: -1, expires: economy.time + DROP_LIFE };
  boxes.set(uid, b);
  broadcast({ t: 'drop+', d: dropInfo(b) });
  log(`supply drop at ${Math.round(at.x)}, ${Math.round(at.z)} (${b.items.length} items)`);
}

/** every five seconds: clear away the one that is done with, set the next one down when it is due */
function tickDrops(anyoneAlive: boolean) {
  let standing = false;
  for (const b of [...boxes.values()]) {
    if (b.kind !== 'drop') continue;
    // (never from under somebody who has it open)
    const done = economy.time > (b.expires ?? 0) || (b.emptiedAt >= 0 && economy.time - b.emptiedAt > DROP_LINGER);
    if (done && !locks.has(b.cid)) {
      boxes.delete(b.cid);
      broadcast({ t: 'drop-', uid: b.cid });
    } else standing = true;
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
    if (!c.alive) continue;
    const takes = carriedTags(c.inv).some((t) => {
      const from = lootedTags.get(t.uid);
      return !!from && from.ownerKey !== c.key;
    });
    if (takes) p.push([c.id, Math.round(c.pose[0]), Math.round(c.pose[2])]);
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
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    // readable from a client hosted somewhere else (e.g. Vercel) for the start-screen player count
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    // (places: how many different addresses the players come from. One, with several players on, means the host is not passing addresses through.)
    res.end(JSON.stringify({ ok: true, players: clients.size, max: MAX_PLAYERS, queue: queue.length, uptime: Math.round(process.uptime()), loot: economy.loot.size, places: new Set([...clients.values()].map((c) => c.ip)).size }));
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
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
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
  ws.on('message', (data) => {
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
    if (c) drop(c);
  });
  ws.on('error', () => ws.close());
});

loadWorld();
server.listen(PORT, () => log(`listening on :${PORT}${existsSync(DIST) ? '' : ' (no client build found: API only)'}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log('shutting down, saving world');
    saveWorld();
    process.exit(0);
  });
}
