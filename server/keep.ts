// The server: what is kept between restarts (the save, the last word before a restart, a life put back).
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import http from 'node:http';
import { createHash, randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import zlib from 'node:zlib';
import { BODY_GRID, heldIn } from '../src/sim/inventory';
import { type ItemInstance, ITEMS } from '../src/sim/items';
import type { NewsKept } from '../src/sim/news';
import { BOOT, CORPSE_LIFETIME, RECORD_LIFETIME, WORLD_REV, boxes, economy, issue, log, news, stashItem, things, world, type Box } from './index';
import { guardStashes } from './stash-guard';
import { SITE_URL, keepTags, tagTime, takeTags, type TagsKept } from './tags';
import { HUNTING_TOWERS, WATCHTOWERS } from '../src/sim/watchtowers';
import { inPokrovCourt } from '../src/sim/towns';
import { CHECK } from './checks';
import { ADMIN, keyHash, roleOf, siteAdmin, tagLock, type AdminState } from './gate';
import { CARRY_KEPT, POWERS_KEPT, carryKeep, carryKept, keepPowers, noHold } from './admin';
import { broadcast, cleanInventory, cleanItem, clients, info, isPose, num, records, send, type Client, type Record_ } from './players';
import { fillFromQueue } from './queue';
import { seen } from './seen';
import { pinned, type Pin } from './pinned';
import { elite } from './elite';
import { plating } from './plates';
import { keepBases, restoreBases, sightFor } from './build';
import type { KeptBase } from '../src/sim/build/bases';
import { keepLearned, restoreLearned } from './learn';
import { keepCamp, restoreCamp } from './camp';

/** on the host it is kept; on somebody's own machine it is not, unless asked for (KEEP=on) */
const KEEP_ON = process.env.KEEP ? process.env.KEEP !== 'off' : !!process.env.RENDER;

export const KEEP_EVERY_MS = (process.env.KEEP_EVERY_MIN === undefined ? 180 : Math.max(0, Number(process.env.KEEP_EVERY_MIN) || 0)) * 60_000;

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
export const PUBLIC_URL = (process.env.OTHER_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

/** who answers at the public address: this server (true), another (false), nobody (null) */
export async function reachedHere(): Promise<boolean | null> {
  if (!PUBLIC_URL) return true;
  try {
    const r = await fetch(`${PUBLIC_URL}/healthz`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? ((await r.json()) as { boot?: string }).boot === BOOT : null;
  } catch {
    return null;
  }
}

export function sayRestart(why: string, seconds: number) {
  log(`[restart] said to ${clients.size}: restarting${seconds ? ` in ${seconds} s` : ''}${why ? ` (${why})` : ''}`);
  broadcast({ t: 'restart', why: why.slice(0, 120), in: Math.max(0, Math.round(seconds)) });
}

const WIPE = (process.env.WIPE ?? '').slice(0, 40);

export const KEPT = {
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

export const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Where the ground was made again by the release that raised WORLD_REV past each number: a character kept from a world
 * of an older number is set down afresh only if they stood where some release since remade it. A number not here: all
 * of them, as before. (2026-10-18: with the starts on the far west beach since that day, a world remade anywhere sent
 * everybody back across the whole map; the owner that day, of tags a restart took: "its bad UX its not their fault".)
 */
const REMADE: Record<number, (x: number, z: number) => boolean> = {
  // (29 -> 30: the desert's places and their roads, src/sim/desert.ts, all west of the canyon)
  29: (x) => x < -2800,
  // (30 -> 31: the ground each watchtower and hunting tower was levelled on, 2026-10-19, and nowhere else it moved;
  // and Pokrov's court, where the church grew half as big again and the belfry moved: whoever was kept there could be in a wall)
  30: (x, z) => [...WATCHTOWERS, ...HUNTING_TOWERS].some((t) => Math.hypot(t.x - x, t.z - z) < 16) || inPokrovCourt(x, z),
};
/** is somebody kept from a world of this number, standing here, set down afresh at a start */
export function remadeUnder(rev: number, x: number, z: number): boolean {
  for (let v = rev; v < WORLD_REV; v++) if (!REMADE[v] || REMADE[v](x, z)) return true;
  return rev > WORLD_REV;
}

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
  /** who has played in the last week, by key hash and when (see seen.ts) */
  seen?: [string, number][];
  /** names and payout wallets fixed at a first cashed tag (pinned.ts) */
  pinned?: [string, Pin][];
  /** each admin's powers, by key hash (see POWERS_KEPT) */
  powers?: [string, Client['power']][];
  /** the Elite, by key hash and when they were last paid at the top rate (see elite.ts) */
  elite?: [string, number][];
  /** the dead lying on the ground, with what is on them and how many seconds each has left (see `bodies`) */
  bodies?: KeptBody[];
  /** whose each looted tag was and when its carrier picked it up (see keepTags) */
  tags?: TagsKept;
  /** the guns with a store finish put on them, by uid (plates.ts) */
  plates?: ReturnType<typeof plating.keep>;
  /** every base and its pieces, said short (server/build.ts) */
  bases?: KeptBase[];
  /** the blueprints each player has learned, by key hash (server/learn.ts) */
  learned?: [string, string[]][];
  /** each player's day at the trader camp, and whose old book is paid out (server/camp.ts) */
  camp?: ReturnType<typeof keepCamp>;
}

/** a body as it is kept: where it lies, whose it was, how it fell, what is on it, and the seconds it has left */
interface KeptBody { cid: string; x: number; y: number; z: number; rot: number; name: string; v: number; left: number; items: Box['items']; pid?: string }

/**
 * The dead lying on the ground, kept through a restart and a deploy with the time each had left (2026-10-17: a player
 * walking up to the body of somebody they had killed saw it go; the server had been started again, and a body was the
 * one thing that was not kept). Not one still riding in a seat: it goes with what it rides in.
 */
function bodies(): KeptBody[] {
  return [...boxes.values()]
    .filter((b) => b.kind === 'corpse' && !b.ride && b.zed === undefined && (b.expires ?? 0) > economy.time)
    .map((b) => ({ cid: b.cid, x: b.x, y: b.y, z: b.z, rot: b.rot, name: b.name ?? 'Survivor', v: b.v ?? 0, left: Math.round((b.expires ?? 0) - economy.time), items: b.items, ...(b.pid ? { pid: b.pid } : {}) }));
}

/** the kept bodies laid out again, each with the time it had left, and everybody on told of each @returns how many */
function layBodies(list: KeptBody[] | undefined, moved: boolean): number {
  let n = 0;
  for (const b of list ?? []) {
    if (typeof b?.cid !== 'string' || boxes.has(b.cid) || ![b.x, b.y, b.z, b.rot, b.left].every(num) || b.left <= 0) continue;
    const items = (Array.isArray(b.items) ? b.items : []).flatMap((s) => {
      const it = cleanItem(s);
      return it ? [{ ...it, x: s.x, y: s.y, rot: !!s.rot }] : [];
    });
    for (const it of items) issue(it);
    const y = moved ? world.groundAt(b.x, b.z) : b.y, name = String(b.name ?? 'Survivor').slice(0, 24), v = num(b.v) ? b.v : 0;
    boxes.set(b.cid, { cid: b.cid, kind: 'corpse', w: BODY_GRID[0], h: BODY_GRID[1], items, x: b.x, y, z: b.z, rot: b.rot, emptiedAt: -1, name, v, expires: economy.time + Math.min(CORPSE_LIFETIME, b.left), ...(typeof b.pid === 'string' ? { pid: b.pid.slice(0, 32) } : {}) });
    broadcast({ t: 'corpse@', corpse: { uid: b.cid, x: b.x, y, z: b.z, rot: b.rot, name, v } });
    n++;
  }
  return n;
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

/** admins' powers kept with the world: each the one this server has, or else the kept one (by key hash, each power a yes or no) */
function takePowers(list: unknown) {
  if (!Array.isArray(list)) return;
  for (const e of list) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || !e[1] || typeof e[1] !== 'object' || POWERS_KEPT.has(e[0])) continue;
    const p: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(e[1] as Record<string, unknown>)) if (typeof v === 'boolean') p[k] = v;
    POWERS_KEPT.set(e[0], p as unknown as Client['power']);
  }
}

/** everything that is kept, as it is this moment */
function snapshot(): Snapshot {
  const now = Date.now(), chars = new Map<string, Record_>(KEPT.chars);
  for (const [k, r] of records) if (r.alive && r.inv) chars.set(keyHash(k), r);
  for (const c of clients.values()) if (c.alive && c.inv) chars.set(keyHash(c.key), { pose: c.pose, inv: c.inv, vitals: c.vitals, alive: true, leftAt: now, tagMs: tagTime(c, c.asleep || now) });
  // (no more of them than can be carried: the newest, if it ever came to that)
  const newest = [...chars].sort((a, b) => b[1].leftAt - a[1].leftAt).slice(0, 6000);
  const loose = [...economy.loot.values()].filter((l) => l.keptAt !== undefined).map((l) => ({ item: l.item, x: l.x, y: l.y, z: l.z, rot: l.rot, at: l.keptAt! }));
  return { rev: WORLD_REV, wipe: WIPE, chars: newest, stashes: [...boxes.values()].filter((b) => b.kind === 'stash' && b.buried), loose, news: news.keep(), seen: seen.keep(), pinned: pinned.keep(), powers: [...POWERS_KEPT], elite: elite.keep(), bodies: bodies(), tags: keepTags(), plates: plating.keep(), bases: keepBases(), learned: keepLearned(), camp: keepCamp() };
}

/** What is kept is written to the site. @param final this server's last word @returns whether it was */
export async function keepNow(final: boolean, why: string): Promise<boolean> {
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
  seen.restore(snap.seen);
  pinned.restore(snap.pinned);
  elite.restore(snap.elite);
  plating.restore(snap.plates);
  restoreBases(snap.bases);
  restoreLearned(snap.learned);
  restoreCamp(snap.camp);
  takePowers(snap.powers);
  // (from a last word only: see loadKept)
  if (save.final) takeTags(snap.tags);
  const moved = snap.rev !== WORLD_REV, now = Date.now();
  layBodies(snap.bodies, moved);
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
      KEPT.chars.set(k, { pose: r.pose, inv, vitals: r.vitals, alive: true, leftAt: r.leftAt, ...(remadeUnder(snap.rev, r.pose[0], r.pose[2]) || r.afresh ? { afresh: true } : {}), ...(num(r.tagMs) && r.tagMs > 0 ? { tagMs: r.tagMs } : {}) });
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
    // (told to whoever comes near it, as every buried one is: server/stash-sight.ts)
    stashes++;
  }
  // (Whoever this server had from the older copy and the later one has not: they died, or their time ran out,
  // before the last word. Not back, they are not kept alive by a copy that was out of date.)
  const late = new Set((snap.chars ?? []).map(([k]) => k));
  let gone = 0;
  for (const k of [...KEPT.chars.keys()]) if (!late.has(k) && !back.has(k)) (KEPT.chars.delete(k), gone++);
  KEPT.how += `; and the last word of the server before, written at ${save.at}, came after: ${chars} characters and ${stashes} stashes were taken from it${gone ? `, and ${gone} who had died before it are no longer kept` : ''}`;
  log(`[keep] a newer copy (${save.at}${save.final ? ', a last word' : ''}) turned up after this server had opened: ${chars} characters who have not come back yet, and ${stashes} stashes, are as it has them`);
  guardStashes();
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
export function claim() {
  KEPT.dirty = true;
  if (KEEP_ON && KEPT.ready && !KEPT.claimed && !KEPT.busy) void keepNow(false, 'somebody is on');
}

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
export async function keepBefore(why: string, fresh = 0): Promise<{ ok: boolean; said: string }> {
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

export async function deploying(url: URL, res: http.ServerResponse) {
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
export async function loadKept() {
  const open = (what: string) => {
    if (KEPT.ready) return;
    KEPT.ready = true;
    KEPT.how = what;
    log(`[keep] ${what}`);
    guardStashes();
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
    // (which guns are plated, before any gun is read: each is read wearing what the record says)
    plating.restore(snap.plates);
    restoreBases(snap.bases);
    restoreLearned(snap.learned);
    restoreCamp(snap.camp);
    let bad = 0;
    for (const [k, r] of snap.chars ?? []) {
      try {
        if (!r?.inv || !r.alive || now - r.leftAt > RECORD_LIFETIME || !isPose(r.pose)) continue;
        const inv = cleanInventory(r.inv);
        for (const it of things(inv)) issue(it);
        // (the map has been made again since: what they carried is theirs, where they stood may be inside a wall if it was remade there)
        KEPT.chars.set(k, { pose: r.pose, inv, vitals: r.vitals, alive: true, leftAt: r.leftAt, ...(remadeUnder(snap.rev, r.pose[0], r.pose[2]) || r.afresh ? { afresh: true } : {}), ...(num(r.tagMs) && r.tagMs > 0 ? { tagMs: r.tagMs } : {}) });
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
      // (as big as its kind is now, where that has grown: a stash crate buried at eight by six comes up ten by fifteen, with all it held where it was)
      const [gw, gh] = ITEMS[b.item ?? 'stash_kit']?.stash ?? [box.w, box.h];
      box.w = Math.max(box.w, gw);
      box.h = Math.max(box.h, gh);
      if (Math.abs(box.y - b.y) > 1) log(`[keep] a stash at ${Math.round(b.x)}, ${Math.round(b.z)} lies on ground that has moved ${(box.y - b.y).toFixed(1)} m: it is set on the new ground`);
      // (one that stood on the ground, kept by a server from before a stash was a thing to drop: it lies there as one now)
      if (box.buried) boxes.set(b.cid, box);
      else if (!economy.loot.has(b.cid)) economy.drop(stashItem(box), box.x, box.y, box.z, box.rot).keptAt = box.touchedAt;
      stashes++;
    }
    for (const l of snap.loose ?? []) {
      const item = cleanItem(l?.item);
      if (!item || ITEMS[item.id]?.category !== 'stash' || economy.loot.has(item.uid) || boxes.has(item.uid) || ![l.x, l.y, l.z, l.rot].every(num)) continue;
      for (const it of things({ slots: { it: item }, containers: [] })) issue(it);
      economy.drop(item, l.x, moved ? world.groundAt(l.x, l.z) : l.y, l.z, l.rot).keptAt = num(l.at) ? l.at : now;
      stashes++;
    }
    const laid = layBodies(snap.bodies, moved);
    if (laid) log(`[keep] ${laid} bodies laid out again where they lay, each with the time it had left`);
    // (what has been said under the changelog, and its hearts: kept with the rest, and no worse for a new map)
    news.restore(snap.news);
    seen.restore(snap.seen);
    pinned.restore(snap.pinned);
    elite.restore(snap.elite);
    takePowers(snap.powers);
    // (Whose tags were whose only from a last word, written as the server stopped and after its last cash-in. Any
    // other copy is from before cash-ins it never saw: the pockets it gives back still hold a tag cashed and paid
    // since, and with its record that tag would be paid again. From such a copy a tag is carried for nothing, as
    // every tag was before tags were kept.)
    if (save.final) takeTags(snap.tags);
    open(`${KEPT.chars.size} characters and ${stashes} stashes as they were kept at ${save.at}${save.final ? '' : ' (not a last word: the server before this one stopped without one)'}${moved ? `; the map has been made again since, so ${[...KEPT.chars.values()].filter((r) => r.afresh).length} who stood where it was remade start from the edge with what they had` : ''}`);
  } catch (e) {
    // (what could be taken in has been: it is not thrown away for the sake of what could not)
    KEPT.read = true;
    open(`what was kept could not all be taken in (${e instanceof Error ? e.message : e}): ${KEPT.chars.size} characters were`);
  }
}

/** The lists are read when the server starts, and again every little while until they have been (the site may be asleep). */
export function loadAdmin(tries = 0) {
  // (said here and not as the module is read: the two modules read one another, and the lists are not made yet then)
  ADMIN.onState = tellRoles;
  void siteAdmin({ op: 'load' }).then((r) => {
    if (r?.ok) {
      log(`[admin] lists read from the site: ${Object.keys(ADMIN.state.roles).length} with a role, ${ADMIN.state.bans.length} banned${r.set ? '' : ' (no ADMIN_PASSWORD is set there: nobody can become an admin)'}`);
      // (and whoever came in with an admin's hold is told it is not theirs, now that it is known who is an admin)
      for (const c of clients.values()) if (roleOf(c) !== 'admin') noHold(c);
      return;
    }
    // (Often at first: at a deploy the site's call back reaches the server before this one until this one is the one
    // being served. It is asked again until it answers: it used to give up after some seventeen minutes, and then
    // nobody had a role until the next restart. 2026-10-14: "my admins lost their roles even though they still are
    // admin in the admin panel?")
    setTimeout(() => loadAdmin(tries + 1), tries < 90 ? 5_000 : 30_000).unref();
  });
}

/**
 * Whoever is on and has a role they have not been told is told it, whenever the lists come from the site and by
 * whatever asked for them (the start's own reading, a password, a role given): whoever came in before the lists
 * were read was let in as nobody in particular, and an admin who stayed on after a reading that was not the start's
 * was never told they were one.
 */
export function tellRoles() {
  for (const c of clients.values()) {
    const role = roleOf(c) ?? null;
    if (role === (c.roleTold ?? null)) continue;
    c.roleTold = role;
    if (!role) continue;
    send(c, { t: 'role', role });
    if (role === 'admin') asAdmin(c, true);
  }
}

/** What an admin changed is written to the site. @returns whether it was */
/**
 * The lists changed: held here at once (a ban bites whether or not the site answers), and written to the site, which
 * keeps them across restarts. The site cannot always take them the moment they are sent (its store serves an old
 * copy for a while after any write, and answered 500 to every ban given within a hundred seconds of another until
 * 2026-10-16): a save brings the mark of what was last written so the site need not read first, and one the site
 * still could not take is tried again every so often until it is written (`keepSaving`). The owner, 2026-10-16:
 * "when i ban someone in game the chat log says 'will take effect after server restart' is this false?" It was:
 * the ban held from the first line; only the copy on the site was behind.
 * @returns whether the site has it now
 */
export async function saveAdmin(next: AdminState): Promise<boolean> {
  // (a change that does not name the tags set for admins keeps them)
  ADMIN.state = { tags: ADMIN.state.tags, ...next };
  if (await trySaveAdmin()) return true;
  keepSaving();
  return false;
}

async function trySaveAdmin(): Promise<boolean> {
  const r = await siteAdmin({ op: 'save', state: ADMIN.state, mark: ADMIN.mark });
  return !!r?.ok;
}

let saving: NodeJS.Timeout | null = null;

/** the lists as they are here, tried on the site every so often until it takes them, for up to ten minutes */
function keepSaving() {
  if (saving) return;
  let tries = 0;
  saving = setInterval(async () => {
    if (++tries > 40) {
      clearInterval(saving!);
      saving = null;
      return void log('[admin] the lists could not be written to the site in ten minutes of trying: they hold here until this server restarts');
    }
    if (!(await trySaveAdmin())) return;
    clearInterval(saving!);
    saving = null;
    log(`[admin] the lists were written to the site at the ${tries + 1}${tries === 1 ? 'nd' : tries === 2 ? 'rd' : 'th'} try`);
  }, 15_000);
  saving.unref();
}

/** what an admin is told after a change to the lists, where the site has not taken it yet */
export const savedWords = (kept: boolean) => (kept ? '' : ' (The site could not take the lists this moment: they hold here now, and are written to the site again shortly.)');

export const sys = (c: Client, ...lines: string[]) => lines.forEach((text) => send(c, { t: 'sys', text }));

/** the player meant by a word: `#12` (their number), their name, or the start or some part of it if only one fits */
export function whoIs(word: string): Client | null {
  const all = [...clients.values()];
  if (/^#\d+$/.test(word)) return clients.get(Number(word.slice(1))) ?? null;
  const w = word.toLowerCase();
  const exact = all.filter((o) => o.name.toLowerCase() === w);
  if (exact.length === 1) return exact[0];
  const part = all.filter((o) => o.name.toLowerCase().includes(w));
  return part.length === 1 ? part[0] : null;
}

/** Somebody set down somewhere by an admin: there at once for everybody, and not asked how they got there. */
export function place(t: Client, x: number, y: number | null, z: number, by: Client) {
  const now = Date.now();
  t.pose = [x, y ?? world.groundAt(x, z), z, t.pose[3], t.pose[4], t.pose[5]];
  t.check.free = now + CHECK.free;
  t.check.at = now;
  t.check.carry = 0;
  t.check.lag = 0;
  t.check.owed = 0;
  t.underAt = 0;
  // (the bases about where they are set down told first: server/build.ts)
  sightFor(t);
  send(t, { t: 'put', x, ...(y === null ? {} : { y }), z, ...(by === t ? {} : { by: by.name }) });
}

/**
 * Somebody has just been made an admin, or has come in as one. What they leave when they die is chosen for them
 * until they choose otherwise: nothing they carried, and no tag (an admin's kit is not found on them, and nobody
 * is paid for killing one at work). And they are shown whoever has vanished.
 */
export function asAdmin(c: Client, fresh: boolean) {
  // (every power they had on when they left, or before this server started: one who was flying is flying again, and
  // does not fall out of the sky where they were kept)
  const kept = POWERS_KEPT.get(keyHash(c.key));
  if (kept) {
    for (const k of Object.keys(c.power) as (keyof Client['power'])[]) if (typeof kept[k] === 'boolean') c.power[k] = kept[k];
    const now = Date.now();
    if (c.power.clip) {
      c.check.free = now + CHECK.free;
      c.underAt = 0;
    }
    if (c.power.god) {
      c.check.hp = 100;
      c.check.hpAt = now;
      c.check.downAt = 0;
    }
    // (vanished when they left: everybody was told they had come, and is told now that they are gone)
    if (c.power.hidden) for (const o of clients.values()) if (o !== c) send(o, roleOf(o) === 'admin' ? { t: 'ghost', id: c.id, on: true } : { t: 'leave', id: c.id });
  }
  Object.assign(c.power, ADMIN.voids.get(c.key) ?? (kept ? {} : { voidInv: true, voidTag: true }));
  // (and their tag, where an admin above them has set it: see tagLock)
  const lock = tagLock(c.key);
  if (lock !== undefined) c.power.voidTag = !lock;
  Object.assign(c.power, CARRY_KEPT.get(c.key));
  // (An admin who comes in with things in their hold has the room they lie in. Which powers were on is forgotten
  // when this server restarts, and what is carried is not: without this, a restart put everything in an admin's
  // hold at their feet as they came back.)
  if (!c.power.bottomless && heldIn(c.inv).length) {
    c.power.bottomless = true;
    carryKept(c);
  }
  keepPowers(c);
  send(c, { t: 'powers', ...c.power });
  if (fresh) for (const o of clients.values()) if (o !== c && o.power.hidden) send(c, { t: 'join', p: info(o) });
}

/** One of an admin's powers, put on or off: they are told which they have, and (vanishing) everybody else that they have left or come. */
export function setPower(c: Client, k: keyof Client['power'], on: boolean) {
  if (c.power[k] === on) return;
  c.power[k] = on;
  if (roleOf(c) === 'admin') keepPowers(c);
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
