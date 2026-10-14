// ZONA game server. One process: serves the built client and runs the shared world
// over a WebSocket at /ws.
//
// Authority (see src/net/protocol.ts): the server owns the loot economy, containers
// (map crates, stashes, bodies), doors, who is alive, spawn points and how much a hit
// hurts. Clients own their movement, aim and inventory.

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';
import { buildWorldData } from './world';
import { Economy, type WorldLoot } from '../src/sim/economy';
import { type SerializedInventory, Container } from '../src/sim/inventory';
import { ITEMS, type ItemInstance } from '../src/sim/items';
import { WORLD_SIZE } from '../src/world/worldgen';
import { STOCK } from '../src/sim/trade';
import { CRATE_SPECS, fillCrate, CRATE_RESTOCK } from '../src/sim/crates';
import { News } from '../src/sim/news';
import { underGas, gasEdge } from '../src/sim/gas';
import { RangeJudge, shotMisses } from '../src/sim/range';
import { inBunker, BUNKER } from '../src/sim/bunker';
import { BARREL } from '../src/sim/barrels';
import { type VehicleInfo, POLICE_CAR, restState, JEEP, SEATS, type VState } from '../src/sim/vehicles';
import { HELI } from '../src/sim/heli';
import { Director } from '../src/sim/infected';
import { type StoredItem, type S2C, PROTOCOL, type C2S } from '../src/net/protocol';
import { Hearths } from '../src/sim/fires';
import { SITE_URL, addressOf, bunkerDoor, cashins, ipOf } from './tags';
import { CHECK, CHECKS, flagged, takenTag } from './checks';
import { ADMIN, BOTCHECK, CAPTCHA, CAPTCHA_ON, RANGES, SLIPS, TURNED, addressFull, away, bannedFor, dealAhead, flooding, gone, goodSlip, inHands, keeping, keyHash, knownPerson, knownShooter, listOf, nextRange, personOf, persons, roleOf, shooters, standing } from './gate';
import { KEEP_EVERY_MS, KEPT, PUBLIC_URL, deploying, keepBefore, keepNow, loadAdmin, loadKept, pause, reachedHere, sayRestart } from './keep';
import { broadcast, cleanName, clients, join, num, records, round2, type Client } from './players';
import { blowJeep, voice } from './acts';
import { handle } from './handle';
import { enqueue, keyOf, kickIdle, leaveQueue, mustWait, queue, queueToldAt, tellQueue } from './queue';
import { TAG_PING_MS, nudge, tickDrops } from './drops';


/** how far from the middle anything may say it is: the edge of the ground, and a little (the walls stand 4 m inside it) */
export const EDGE = WORLD_SIZE / 2 + 8;

const PORT = Number(process.env.PORT ?? 8080);

const ROOT = process.cwd();

const DIST = path.join(ROOT, 'dist');

const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');

const SAVE_FILE = path.join(DATA_DIR, 'world.json');

export const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 24);

const TICK_HZ = 15;

export const CORPSE_LIFETIME = 600; // seconds

// (A character is its player's until it dies: whoever comes back in a year has what they left with. It was
    // half an hour.)
export const RECORD_LIFETIME = 400 * 24 * 3600 * 1000; // a logged-out character is remembered this long

/** bump when loot points change: world loot from an older save is re-rolled */
export const WORLD_REV = 25;

export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------ world

log('generating world…');

const t0 = Date.now();

export const world = buildWorldData(ROOT);

log(`world ready in ${Date.now() - t0} ms: ${world.lootPoints.length} loot points, ${world.crates.length} crates, ${world.barrels.length} fuel drums, ${world.spawns.length} spawns`);

export interface Box {
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

export const boxes = new Map<string, Box>();

export const locks = new Map<string, number>(); // cid -> client id

export const doors = new Map<number, [boolean, number]>();

/** fuel drums that have gone up (see src/sim/barrels.ts): which one -> when a new one may be stood there */
export const barrelsGone = new Map<number, number>();

// the infected: how many there are, what each has left, and whose game moves it (src/sim/infected.ts)
export const horde = new Director(process.env.INFECTED === 'off' ? [] : world.homes, world.homeSpot);

export const BARREL_RESPAWN = Number(process.env.BARREL_RESPAWN_S) || BARREL.respawn;

/**
 * The jeeps (see src/sim/vehicles.ts). The server keeps where each one is, what it has left
 * and who sits in it; the game of whoever drives it (`sim`) says how it moves.
 */
export interface Veh extends VehicleInfo {
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

export const vehicles = new Map<number, Veh>();

/** spots whose jeep burned: which -> when a new one may be stood there */
export const jeepsDue = new Map<number, number>();

let nextVeh = 1;

/** where every car stands when the world is new, by the number of its place: the jeeps, and after them the police cars */
export const PARKS = [...world.jeeps.map((p) => ({ ...p, k: 0 })), ...world.cars.map((p) => ({ ...p, k: POLICE_CAR.kind })), ...world.helis.map((p) => ({ ...p, k: HELI.kind }))];

export function standJeep(home: number): Veh {
  const p = PARKS[home];
  const v: Veh = { i: nextVeh++, s: restState(p.x, p.y, p.z, p.yaw), hp: JEEP.hp, fuel: Math.round(JEEP.tank * (0.3 + Math.random() * 0.45)), seats: Array(SEATS).fill(null), sim: null, home, heard: 0, burnAt: 0, by: 0, goneAt: 0, ...(p.k ? { k: p.k } : {}) };
  vehicles.set(v.i, v);
  return v;
}

PARKS.forEach((_, k) => standJeep(k));

/** the gas over the works: a car left under it is stood back home (see JEEP.gas) */
const carsGas = world.gas;

export const vehInfo = (v: Veh): VehicleInfo => ({ i: v.i, s: v.s, hp: v.goneAt ? 0 : v.hp, fuel: v.fuel, seats: v.seats, sim: v.sim, ...(v.k ? { k: v.k } : {}) });

export const tellSeats = (v: Veh, rest = false) => broadcast({ t: 'vseat', i: v.i, seats: v.seats, sim: v.sim, ...(rest ? { s: v.s } : {}) });

export const isVState = (s: unknown): s is VState => Array.isArray(s) && s.length === 12 && s.every(num) && Math.abs(s[0]) < EDGE && Math.abs(s[2]) < EDGE && Math.abs(s[1]) < 500 && Math.abs(Math.hypot(s[3], s[4], s[5], s[6]) - 1) < 0.02 && Math.hypot(s[7], s[8], s[9]) < 60;

/** the fireplaces, and which of them are alight */
export const hearths = new Hearths(world.fires);

/**
 * The things that are only ever found, never made by a player's own game: guns, blades, armour, helmets and
 * hats, the keycard. (What the trader sells is made by the game that buys it, and so are a meal, a dressing, a
 * round taken out of a gun, a sight taken off one: none of those can be told from an invention, and none is here.)
 */
const GUARDED = new Set(Object.values(ITEMS).filter((d) => !STOCK.includes(d.id) && (!!d.weapon || !!d.melee || d.wear?.armor !== undefined || d.wear?.head !== undefined || d.id === 'keycard')).map((d) => d.id));

/** every such thing the server has put in the world, by its own number: laid out as loot, packed in a crate or a drop, left on a body */
const issued = new Set<string>();

export function issue(it: ItemInstance | null | undefined) {
  if (!it) return;
  if (GUARDED.has(it.id)) issued.add(it.uid);
  for (const p of it.cargo ?? []) issue(p.item);
}

/** everything in a set of pockets: what is worn and held, what is in them, and what is in what is in them */
export function* things(inv: SerializedInventory | null): Generator<ItemInstance> {
  const walk = function* (it: ItemInstance | null | undefined): Generator<ItemInstance> {
    if (!it) return;
    yield it;
    for (const p of it.cargo ?? []) yield* walk(p.item);
  };
  if (!inv) return;
  for (const it of Object.values(inv.slots)) yield* walk(it);
  for (const cont of inv.containers) for (const it of cont.items) yield* walk(it);
}

export const invented = (it: ItemInstance) => GUARDED.has(it.id) && !issued.has(it.uid);

/** Things taken out of a set of pockets, wherever in them they are: worn, in a pocket, or in something that is. */
export function takeOut(inv: SerializedInventory | null, gone: Set<string>) {
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

export const economy = new Economy(world.lootPoints, {
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
export const stashItem = (b: Box): ItemInstance => ({ uid: b.cid, id: b.item ?? 'stash_kit', qty: 1, ...(b.items.length ? { cargo: b.items.map(({ x, y, rot, ...item }) => ({ item, x, y, rot })) } : {}) }) as ItemInstance;

export const cargoOf = (item: ItemInstance): Box['items'] => (item.cargo ?? []).map((q) => ({ ...q.item, x: q.x, y: q.y, rot: q.rot }));

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

/**
 * The most any worn thing takes off a hit, were everything that can be worn worn at once: nobody is hurt less
 * than that by anything. (What each player says they wear is not asked: it is their own game's word, and a
 * moment old.)
 */
export const SOAK = (() => {
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

dealAhead();

setInterval(() => keeping(Date.now()), 1000);

setInterval(() => standing(Date.now()), 500);

setInterval(() => inHands(Date.now()), 250);

/**
 * Who is not let in. BAN_KEYS and BAN_IPS in the environment (lists, commas between) are kept off for as long as
 * they are written there. And whoever the checks have put off the server CHECK.strikes times inside an hour is
 * kept off for CHECK.ban hours, by the key their game gives and (where addresses can be told apart) by address.
 * This last is forgotten when the server restarts.
 */
export const BANS = { keys: new Set(listOf(process.env.BAN_KEYS)), ips: new Set(listOf(process.env.BAN_IPS)), temp: new Map<string, { until: number; why: string; name?: string }>(), strikes: new Map<string, number[]>() };

/**
 * A server on somebody's own machine makes whoever plays on it an admin (LOCAL_ADMIN=1), so that what an admin has
 * can be tried there without the site's password: "i should have admin panel locally", 2026-10-13. Never where the
 * host is Render, and never on a server that answers to a site anywhere but this machine.
 */
export const LOCAL_ADMIN = process.env.LOCAL_ADMIN === '1' && !process.env.RENDER && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(SITE_URL);

if (LOCAL_ADMIN) console.log('[admin] LOCAL_ADMIN: everybody on this server is an admin');

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
export const BOOT = randomBytes(8).toString('hex');

/**
 * A restart, said to everybody before it happens (2026-10-12: "would be great if could have a banner overhead that
 * says server restarting, then reason"). Nobody tells a server it is about to be replaced until the moment it is
 * told to stop, so it finds out for itself: it is run from a commit (Render says which, and of what), and every
 * minute and a half it asks where that came from what the newest one is. When that is no longer its own, the one
 * that will replace it is being built: it says so to everybody on, with why, as the note that came with the new one
 * says (server/restart-note.json, written by whoever made the change). And a server told to stop says so to whoever
 * is still on, as its last word to them. (An admin can say it by hand as well: `/restart`.)
 */
export const RESTART = {
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

keptListed = true;

/**
 * The changelog's hearts and comments (2026-10-12: "can we add a blog/forum layout to the changelog so users can
 * heart the changelog posts, as well as leave a comment ... public comment section"). Held here, because this
 * server is always there and the site keeps next to nothing (its file store allows two thousand writes a month,
 * and the payouts live on them): they go into what is kept with everything else, at the times that is written,
 * and not once more. What a server that dies without a last word had heard since it last wrote is lost with it.
 * The rules are in src/sim/news.ts; the page is public/changelog/index.html.
 */
export const news = new News();

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

setInterval(() => {
  if (KEEP_EVERY_MS && KEPT.dirty && Date.now() - KEPT.savedAt >= KEEP_EVERY_MS) void keepNow(false, 'time has gone by');
}, Math.max(1000, Math.min(60_000, KEEP_EVERY_MS || 60_000))).unref();

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
