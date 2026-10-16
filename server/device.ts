// The server: the devices games run on (2026-10-16). A game sends a hash of the machine it runs on with `hello`
// (src/net/device.ts): how its card draws, how its browser writes, the screen, the time zone, the languages, the
// cores and the memory. That day a swarm with made-up names (Merric635, Brambl116, Drayto518 ...) came through
// fifteen rented addresses in as many countries, a new name and a new key every half hour, every one of them
// "Chrome 155 on Windows, RTX 3060": one machine. The owner: "can i ban this computr or browser at the source?"
//
// What is kept here is pure (no server state is touched): who has come with each device lately, and the rules
// that read it. The gate applies them (server/gate.ts, deviceRules): a connection is turned away at `hello`,
// before the bot check, when its device
//   - is kept off (a check sent it back again and again: see recheck in checks.ts, which strikes the device as it
//     strikes the key and the address; or an admin's /ban took it);
//   - has come with SPREAD different games from as many different public addresses inside an hour: a farm. A
//     player whose phone changes its address as they play is one game, however many addresses; two friends on the
//     same kind of laptop are two games at one or two addresses. Neither is a farm.
//   - already has LIVE games playing on it (not asleep: a body left behind is not somebody playing).
// Nobody with a role is counted or refused. Two of the same machine set up the same way are one device here, so
// no rule turns anybody away for the device ALONE: the spread rule wants three games on it at three addresses in
// an hour, and the strikes want it sent back four times in half an hour. Whoever is wrongly caught is on
// /bans and /unban lets them back in (keptOffNow in gate.ts).
//
// DEVICE_NEED (on wherever the host is Render; "off": a hello with no device is let in and no rule is asked of it;
// anything else: on), DEVICE_RULES ("watch": the rules are written down and not applied; "enforce": applied),
// DEVICE_LIVE (games at once on one device; 0: any number), DEVICE_SPREAD (games from as many addresses in an
// hour; 0: never), DEVICE_HOURS (how long a farm is kept off).

import type { WebSocket } from 'ws';

export const DEVICE = {
  need: process.env.DEVICE_NEED ? process.env.DEVICE_NEED !== 'off' : !!process.env.RENDER,
  mode: (process.env.DEVICE_RULES === 'watch' ? 'watch' : 'enforce') as 'watch' | 'enforce',
  live: process.env.DEVICE_LIVE === undefined ? 2 : Math.max(0, Number(process.env.DEVICE_LIVE) || 0),
  spread: process.env.DEVICE_SPREAD === undefined ? 3 : Math.max(0, Number(process.env.DEVICE_SPREAD) || 0),
  within: 3600_000,
  hours: Number(process.env.DEVICE_HOURS) || 24,
};

/** the device each connection said it runs on, by the connection (set at hello, read at join) */
export const deviceOf = new WeakMap<WebSocket, string>();

/** a device as a game may say it: 16 to 40 hex characters, or nothing */
export const cleanDevice = (v: unknown) => (/^[0-9a-f]{16,40}$/.test(String(v)) ? String(v) : '');

/** the name a device is kept off by (BANS.temp, /bans) */
export const deviceName = (fp: string) => `fp:${fp}`;

/** a device as the log and /players show it: its first eight characters */
export const shortDevice = (fp: string) => (fp ? fp.slice(0, 8) : '');

/** who has come with each device lately: by game (its key), from where and when; the newest address of each game */
const came = new Map<string, Map<string, { ip: string; at: number }>>();

/**
 * A game has come with a device. @returns how many different games have come with it from different public
 * addresses inside the hour (counting each game once, at the address it last came from, and only where the
 * addresses differ game from game), and how many games in all.
 */
export function cameWith(fp: string, key: string, ip: string, isPublic: boolean, now = Date.now()): { games: number; places: number } {
  let seen = came.get(fp);
  if (!seen) came.set(fp, (seen = new Map()));
  seen.set(key, { ip: isPublic ? ip : '', at: now });
  for (const [k, v] of seen) if (now - v.at > DEVICE.within) seen.delete(k);
  // (and the devices nobody has come with in an hour are forgotten)
  if (came.size > 5000) for (const [f, s] of came) if (![...s.values()].some((v) => now - v.at <= DEVICE.within)) came.delete(f);
  const places = new Set<string>();
  for (const v of seen.values()) if (v.ip) places.add(v.ip);
  return { games: seen.size, places: places.size };
}

/** Is it a farm: this many games from this many addresses inside the hour? (DEVICE.spread; 0: never) */
export const isFarm = (seen: { games: number; places: number }) => DEVICE.spread > 0 && seen.games >= DEVICE.spread && seen.places >= DEVICE.spread;

/** forgotten (a test) */
export function forgetDevices() {
  came.clear();
}
