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
import { ITEMS, sanitizeItem, type ItemInstance } from '../src/sim/items';
import { CRATE_RESTOCK, CRATE_SPECS, fillCrate } from '../src/sim/crates';
import { WEAPON_RULES, hitDamage, type HitZone } from '../src/sim/combat';
import { CHAT_RANGE, F_DEAD, PROTOCOL, type C2S, type CorpseInfo, type KillInfo, type PlayerInfo, type Pose, type S2C, type StashInfo, type StoredItem, type Vitals } from '../src/net/protocol';

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
const WORLD_REV = 5;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------ world

log('generating world…');
const t0 = Date.now();
const world = buildWorldData(ROOT);
log(`world ready in ${Date.now() - t0} ms: ${world.lootPoints.length} loot points, ${world.crates.length} crates, ${world.spawns.length} spawns`);

interface Box {
  cid: string;
  kind: 'crate' | 'stash' | 'corpse';
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
  /** corpse: owner name, expiry (economy time) */
  name?: string;
  expires?: number;
}

const boxes = new Map<string, Box>();
const locks = new Map<string, number>(); // cid -> client id
const doors = new Map<number, [boolean, number]>();

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
      boxes: [...boxes.values()].filter((b) => b.kind !== 'corpse'),
      doors: [...doors].map(([i, [open, swing]]) => [i, open, swing]),
    };
    writeFileSync(SAVE_FILE, JSON.stringify(data));
  } catch (e) {
    log('save failed:', (e as Error).message);
  }
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
  alive: boolean;
  inv: SerializedInventory | null;
  vitals: Vitals | null;
  lastHit: number;
  lastChat: number;
  lastHitBy: { id: number; name: string; w: string; zone: HitZone; dist: number; at: number } | null;
  openCid: string | null;
  joinedAt: number;
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

const info = (c: Client): PlayerInfo => ({ id: c.id, name: c.name, pose: c.pose, w: c.w, m: c.m, alive: c.alive });

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

/** everything a character carried goes into a body that can be searched for a while */
function makeCorpse(c: Client): CorpseInfo | null {
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
  }
  for (const it of spill) {
    const a = Math.random() * Math.PI * 2;
    economy.drop(it, x + Math.cos(a) * 0.9, y, z + Math.sin(a) * 0.9, Math.random() * 6.28);
  }
  if (!box.items.length) return null;
  boxes.set(uid, { cid: uid, kind: 'corpse', w: 8, h: 10, items: box.serialize().items, x, y, z, rot: yaw, emptiedAt: -1, name: c.name, expires: economy.time + CORPSE_LIFETIME });
  return { uid, x, y, z, rot: yaw, name: c.name };
}

function kill(c: Client, cause: string) {
  if (!c.alive) return;
  c.alive = false;
  releaseLock(c);
  const now = Date.now();
  const by = c.lastHitBy && now - c.lastHitBy.at < 15000 ? c.lastHitBy : null;
  const k: KillInfo = { id: c.id, name: c.name, by: by?.id ?? null, byName: by?.name ?? null, w: by?.w ?? cause, zone: by?.zone ?? null, dist: Math.round(by?.dist ?? 0) };
  const corpse = makeCorpse(c);
  c.inv = null;
  c.vitals = null;
  c.lastHitBy = null;
  c.pose[5] |= F_DEAD;
  broadcast({ t: 'death', k, corpse });
  log(by ? `${c.name} was killed by ${by.name} (${by.w}, ${k.dist} m)` : `${c.name} died (${cause})`);
}

function handle(c: Client, m: C2S) {
  switch (m.t) {
    case 's': {
      if (!isPose(m.p)) return;
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
    case 'hit': {
      const target = clients.get(m.to);
      const rule = WEAPON_RULES[m.w];
      if (!target || !target.alive || !c.alive || !rule || target === c) return;
      if (!['head', 'torso', 'legs'].includes(m.zone)) return;
      // you can only hit with what you are holding (fists are always there)
      if (m.w !== 'fists' && c.w !== m.w) return;
      const now = Date.now();
      if (now - c.lastHit < rule.interval * 700) return;
      const d = Math.hypot(c.pose[0] - target.pose[0], c.pose[1] - target.pose[1], c.pose[2] - target.pose[2]);
      if (d > rule.range + 4) return;
      c.lastHit = now;
      const amount = hitDamage(m.w, m.zone, d, !!m.sup, num(m.bonus) ? m.bonus : 0);
      const len = Math.max(0.001, Math.hypot(target.pose[0] - c.pose[0], target.pose[2] - c.pose[2]));
      target.lastHitBy = { id: c.id, name: c.name, w: m.w, zone: m.zone, dist: d, at: now };
      send(target, { t: 'dmg', from: c.id, amount, zone: m.zone, w: m.w, dir: [(target.pose[0] - c.pose[0]) / len, 0, (target.pose[2] - c.pose[2]) / len] });
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
      if (b.kind === 'crate') b.emptiedAt = b.items.length ? -1 : b.emptiedAt < 0 ? economy.time : b.emptiedAt;
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
      const v = m.vitals;
      if (v && num(v.health) && num(v.energy) && num(v.water)) c.vitals = { health: v.health, energy: v.energy, water: v.water, stamina: num(v.stamina) ? v.stamina : 100, bleeding: !!v.bleeding };
      return;
    }
    case 'died': {
      kill(c, typeof m.cause === 'string' ? m.cause.slice(0, 24) : 'unknown');
      return;
    }
    case 'respawn': {
      if (c.alive) return;
      const sp = pickSpawn();
      c.alive = true;
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
  if (clients.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ t: 'kick', reason: 'The server is full.' } satisfies S2C));
    ws.close();
    return null;
  }
  const key = typeof m.key === 'string' && m.key.length >= 8 && m.key.length <= 64 ? m.key : `anon-${Math.random().toString(36).slice(2)}`;
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
    w: null, m: [], alive: true,
    inv: resume?.inv ?? null, vitals: resume?.vitals ?? null,
    lastHit: 0, lastChat: 0, lastHitBy: null, openCid: null, joinedAt: Date.now(), msgCount: 0, msgWindow: Date.now(),
  };
  records.delete(key);
  const others = [...clients.values()].map(info);
  clients.set(c.id, c);
  send(c, {
    t: 'welcome', v: PROTOCOL, you: c.id, players: others,
    loot: [...economy.loot.values()],
    doors: [...doors].map(([i, [open, swing]]) => [i, open, swing]),
    stashes: [...boxes.values()].filter((b) => b.kind === 'stash').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot })),
    corpses: [...boxes.values()].filter((b) => b.kind === 'corpse').map((b) => ({ uid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor' })),
    spawn: sp,
    me: resume ? { inv: resume.inv!, vitals: resume.vitals ?? { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false } } : null,
    max: MAX_PLAYERS,
  });
  broadcast({ t: 'join', p: info(c) }, c);
  log(`+ ${c.name} (#${c.id})${resume ? ' resumed' : ''} — ${clients.size} online`);
  return c;
}

function drop(c: Client) {
  if (!clients.delete(c.id)) return;
  releaseLock(c);
  records.set(c.key, { pose: c.pose, inv: c.inv, vitals: c.vitals, alive: c.alive, leftAt: Date.now() });
  broadcast({ t: 'leave', id: c.id });
  log(`- ${c.name} (#${c.id}) — ${clients.size} online`);
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
  for (const [k, r] of records) if (now - r.leftAt > RECORD_LIFETIME) records.delete(k);
}, 5000);

setInterval(saveWorld, 60_000);

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
    res.end(JSON.stringify({ ok: true, players: clients.size, uptime: Math.round(process.uptime()), loot: economy.loot.size }));
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

wss.on('connection', (ws) => {
  let c: Client | null = null;
  const hello = setTimeout(() => !c && ws.close(), 8000);
  ws.on('message', (data) => {
    let m: C2S;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (!c) {
      if (m.t === 'hello') c = join(ws, m);
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
