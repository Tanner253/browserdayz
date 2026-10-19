// The server: the bot check's own judging of an aim, run on every shot that hits a player in the world (2026-10-18, the
// owner, of bots that had passed the course and were punching players: "we need to take better measures to block
// cheaters and bots"). The course counts no shot taken after the aim came round faster than a hand can, or not fired the
// way the player was looking; out in the world nothing asked either. Here each hit by a gun on a player is asked both,
// against what the shooter's own game said of where it looked in the moment before:
//   snap  the aim came round faster than RULES.snap degrees a second in the 0.6 s before it
//   off   in none of the tellings of the 0.4 s before it was the shooter looking within RULES.off degrees of whom it hit
// Neither refuses the hit (a line that stalls and then sends its tellings all at once can look like either, once): each
// is written down, the admins online are told, and RULES.strikes of them inside ten minutes send the player back to the
// bot check (`recheck`), as the other checks do when enforcing. The numbers are the host's (server/botrules.ts).
import { F_SEAT } from '../src/net/protocol';
import { RULES } from './botrules';
import { CHECKS, flag, recheck } from './checks';
import { roleOf } from './gate';
import { clients, send, type Client } from './players';

interface Look { at: number; yaw: number; pitch: number }
/** what each player's game said of where it looked, the last second and a half (the server's clock) */
const looks = new WeakMap<Client, Look[]>();
/** when each player was last written down by this, for `strikes` */
const strikes = new WeakMap<Client, number[]>();
const KEEP_MS = 1500, SNAP_MS = 600, OFF_MS = 400, STRIKE_MS = 10 * 60_000;
const DEG = 180 / Math.PI;

/** each telling of where a player is: where they look, kept a moment */
export function looked(c: Client, yaw: number, pitch: number, now = Date.now()) {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
  const l = looks.get(c) ?? [];
  l.push({ at: now, yaw, pitch });
  while (l.length && now - l[0].at > KEEP_MS) l.shift();
  looks.set(c, l);
}

/** how far apart two ways of looking are, radians */
const apart = (ay: number, ap: number, by: number, bp: number) => {
  const dy = Math.atan2(Math.sin(by - ay), Math.cos(by - ay));
  return Math.hypot(dy * Math.cos(ap), bp - ap);
};

/** A gun's hit on a player, as the server has let it: the shooter's aim before it asked. */
export function aimWatch(c: Client, target: Client, now = Date.now()) {
  // (nor of somebody in a seat: their game's turn is the seat's, and they look about it freely)
  if (CHECKS === 'off' || roleOf(c) || c.pose[5] & F_SEAT) return;
  const l = looks.get(c);
  if (!l || l.length < 3) return;
  // (snap: the fastest the aim came round between two tellings, of those in the 0.6 s before)
  let most = 0;
  for (let i = 1; i < l.length; i++) {
    if (now - l[i].at > SNAP_MS) continue;
    const secs = Math.max(0.03, (l[i].at - l[i - 1].at) / 1000);
    most = Math.max(most, (apart(l[i - 1].yaw, l[i - 1].pitch, l[i].yaw, l[i].pitch) * DEG) / secs);
  }
  // (off: the way to whom it hit, eye to chest, against every telling of the 0.4 s before)
  const dx = target.pose[0] - c.pose[0], dz = target.pose[2] - c.pose[2], dy = target.pose[1] + 1.2 - (c.pose[1] + 1.6);
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const near = l.filter((s) => now - s.at <= OFF_MS);
  const off = near.length ? Math.min(...near.map((s) => apart(s.yaw, s.pitch, yaw, pitch) * DEG)) : 0;
  const what = most > RULES.snap ? `hit ${target.name} after the aim came round at ${Math.round(most)} degrees a second, faster than a hand can` : off > RULES.off && Math.hypot(dx, dz) > 3 ? `hit ${target.name} while looking ${Math.round(off)} degrees away from them` : '';
  if (!what) return;
  flag(c, what, false);
  for (const o of clients.values()) if (roleOf(o) && o !== c) send(o, { t: 'tell', kind: 'warn', text: `[watch] ${c.name} ${what}` });
  const s = (strikes.get(c) ?? []).filter((t) => now - t < STRIKE_MS);
  s.push(now);
  strikes.set(c, s);
  if (s.length >= RULES.strikes) {
    strikes.set(c, []);
    setImmediate(() => clients.has(c.id) && recheck(c, `${RULES.strikes} hits in ten minutes that a hand could not have aimed (the last: ${what})`));
  }
}
