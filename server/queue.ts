// The server: the line to get in when it is full, and the leaderboard.
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import type { WebSocket } from 'ws';
import { type C2S, PROTOCOL, type S2C } from '../src/net/protocol';
import { MAX_PLAYERS, log } from './index';
import { awake } from './gate';
import { KEPT } from './keep';
import { cleanName, clients, drop, join, records, send, type Client } from './players';

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

export const queue: Waiting[] = [];

const QUEUE_MAX = Number(process.env.QUEUE_MAX ?? 200);

/** how long after dropping out a player still goes to the front of the line, ms */
const REJOIN_GRACE_MS = (Number(process.env.REJOIN_GRACE_S) || 120) * 1000;

/** with people waiting, how long a player may do nothing before their place goes to the next in line, ms */
const IDLE_KICK_MS = (Number(process.env.IDLE_KICK_S) || 300) * 1000;

export const keyOf = (m: { key?: unknown }) => (typeof m.key === 'string' && m.key.length >= 8 && m.key.length <= 64 ? m.key : '');

/** no room for this player right now? (Somebody taking over their own character from another tab needs none.) */
export function mustWait(m: Extract<C2S, { t: 'hello' }>) {
  if (m.v !== PROTOCOL) return false; // join() turns them away itself
  const key = keyOf(m);
  if (key && [...clients.values()].some((o) => o.key === key)) return false;
  // (a body left behind does not hold a place: eleven of them and eleven players were a server of twenty-four all but full)
  return awake() >= MAX_PLAYERS || queue.length > 0 || !KEPT.ready;
}

/** when the line was last told where it stands */
export let queueToldAt = 0;

export function tellQueue() {
  queueToldAt = Date.now();
  queue.forEach((w, i) => {
    if (w.ws.readyState === 1) w.ws.send(JSON.stringify({ t: 'queue', pos: i + 1, of: queue.length, max: MAX_PLAYERS } satisfies S2C));
  });
}

export function enqueue(ws: WebSocket, hello: Extract<C2S, { t: 'hello' }>, enter: (c: Client) => void): Waiting | null {
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

export function leaveQueue(ws: WebSocket) {
  const i = queue.findIndex((w) => w.ws === ws);
  if (i < 0) return;
  queue.splice(i, 1);
  tellQueue();
}

/** somebody has left: the next in line comes in */
export function fillFromQueue() {
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
export function kickIdle(now: number) {
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

export const scores = new Map<string, { name: string; kills: number; tags: number }>();

export function scoreOf(c: Client) {
  let s = scores.get(c.key);
  if (!s) scores.set(c.key, (s = { name: c.name, kills: 0, tags: 0 }));
  s.name = c.name;
  return s;
}

/** tell everyone (or one player who has just joined) how the board stands */
export function sendBoard(only?: Client) {
  const ranked = [...scores.entries()].filter(([, s]) => s.kills || s.tags).sort((a, b) => b[1].tags - a[1].tags || b[1].kills - a[1].kills || a[1].name.localeCompare(b[1].name));
  const rows = ranked.slice(0, 5).map(([, s]) => [s.name, s.kills, s.tags] as [string, number, number]);
  for (const c of only ? [only] : clients.values()) {
    const mine = scores.get(c.key);
    send(c, { t: 'board', rows, me: ranked.findIndex(([k]) => k === c.key), mine: [mine?.kills ?? 0, mine?.tags ?? 0] });
  }
}
