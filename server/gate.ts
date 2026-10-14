// The server: who is let in and kept on (a life kept by the server, the bot check, the check that this is a person, bans, admins and roles).
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { createHash, randomBytes } from 'node:crypto';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import { type RangeSpec, dealing, rangeOf } from '../src/sim/range';
import { WEAPON_RULES } from '../src/sim/combat';
import { type Vec3, inHandDamage, overdue, lyingBlast } from '../src/sim/grenades';
import { carDamage } from '../src/sim/vehicles';
import { INFECTED, infectedDrop } from '../src/sim/infected';
import { BLOOD, bloodOf, withWound, bleedOf, woundOf } from '../src/sim/blood';
import { MAX_STAMINA, F_SIT, F_GROUND, F_BLEED } from '../src/net/protocol';
import { BANS, LOCAL_ADMIN, economy, horde, invented, log, things, vehicles } from './index';
import { SITE_URL, ipsTellApart } from './tags';
import { CHECK, CHECKS, dealt, flag } from './checks';
import { broadcast, clients, drop, send, type Client } from './players';
import { hurtJeep, kill, leaveSeat, releaseLock } from './acts';

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

export const LOGOUT_MS = (process.env.LOGOUT_S === undefined ? 60 : Math.max(0, Number(process.env.LOGOUT_S) || 0)) * 1000;

/** how far somebody waiting to leave may shift before the wait is off, metres; and how long an open wound runs by itself, seconds */
export const LOGOUT_STIR = 1.5;

export const away = (c: Client, now = Date.now()) => c.asleep > 0 || now - c.heardAt > SILENT_MS;

/** a life new to the world leaves no body behind if its connection goes this soon; and a connection whose game has said nothing of where it is by this long after it was let in is not a game, and goes (ms) */
const FRESH_MS = (Number(process.env.FRESH_S) || 60) * 1000;

const NEVER_SPOKE_MS = (Number(process.env.NEVER_SPOKE_S) || 60) * 1000;

/** how many are in the world and awake: a body left behind is not somebody playing */
export const awake = () => {
  let n = 0;
  for (const c of clients.values()) if (!c.asleep) n++;
  return n;
};

/** what has been turned away, for /healthz: by what */
export const TURNED = { address: 0, flood: 0, origin: 0, silent: 0, hover: 0, flags: 0, banned: 0, captcha: 0, range: 0 };

/** when each connection lately said hello, by where it came from: see `flooding` */
const hellos = new Map<string, number[]>();

/** More hellos from one address in a minute than anybody playing sends (a game says it once, and again when its line drops). */
export function flooding(ip: string): boolean {
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
export const BOTCHECK = {
  on: process.env.BOTCHECK ? process.env.BOTCHECK !== 'off' : !!process.env.RENDER,
  ms: (process.env.BOTCHECK_HOURS === undefined ? 6 : Math.max(0, Number(process.env.BOTCHECK_HOURS) || 0)) * 3600_000,
  goes: 4,
  /** and the browser is asked what it is (BOTCHECK_ENV=off: not asked): one that says a program is driving it, or that draws with no graphics card, as a browser on a rented server does, has not passed whatever it shot */
  env: process.env.BOTCHECK_ENV !== 'off',
};

/** who has passed, and until when: by their game and where they play from */
export const shooters = new Map<string, number>();

/**
 * Ranges dealt ahead. Dealing one is a hundred tryings some of the time, a tenth of a second of this server's one
 * thread with everybody's game waiting on it: so a few are kept ready, each dealt a trying at a time between
 * other things, and whoever asks to come in is handed one.
 */
const DEALT: RangeSpec[] = [];

let dealingNow = false;

export function dealAhead() {
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

export const nextRange = (): RangeSpec => {
  const spec = DEALT.shift() ?? rangeOf(1 + Math.floor(Math.random() * 2147483646));
  dealAhead();
  return spec;
};

export const RANGES = { dealt: 0, passed: 0, failed: 0, on: 0 };

export function knownShooter(key: string, ip: string): boolean {
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
export const CAPTCHA = {
  site: process.env.TURNSTILE_SITEKEY ?? '',
  secret: process.env.TURNSTILE_SECRET ?? '',
  url: process.env.TURNSTILE_VERIFY_URL ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  ms: Math.max(0, Number(process.env.CAPTCHA_HOURS) || 0) * 3600_000,
};

export const CAPTCHA_ON = !!CAPTCHA.site && !!CAPTCHA.secret;

/** who has shown they are a person, and until when: by their game and where they play from */
export const persons = new Map<string, number>();

export const personOf = (key: string, ip: string) => `${keyHash(key)}|${ip}`;

export function knownPerson(key: string, ip: string): boolean {
  if (!CAPTCHA_ON) return true;
  if (!key || !CAPTCHA.ms) return false;
  const until = persons.get(personOf(key, ip));
  return !!until && until > Date.now();
}

/** how the asking has gone since this server started, and what Cloudflare said of the last slip it did not take */
export const SLIPS = { passed: 0, failed: 0, unreachable: 0, last: [] as string[] };

/** @returns whether the slip is good; null if Cloudflare could not be asked */
export async function goodSlip(slip: string, ip: string): Promise<boolean | null> {
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
export function keep(c: Client, amount: number, zone: string, w: string) {
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
export function keeping(now: number) {
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

/** The wait to leave properly is off: they are told why. */
export function stayOn(c: Client, why: string) {
  if (!c.logoutAt) return;
  c.logoutAt = 0;
  send(c, { t: 'logout', left: 0, why });
}

/** A connection has gone. Dead, or with nothing kept of bodies: out of the world. Alive: the body stays, sat where it stood. */
export function gone(c: Client) {
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
export function standing(now: number) {
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

/**
 * A grenade has gone off in the hand that held it (2026-10-13, with grenades that are cooked: "hold to cook the
 * grenade for multiple seconds before throwing it", and one held too long goes off where it is). Everybody else is
 * shown it where its holder stands. What it did to the holder their own game reckons, as it does for any grenade of
 * its own; here it is counted among what they have taken, all of it and through no armour (`arms`: no plate is
 * between a hand and its owner), so that whoever is still on their feet after it is found by `standing`, and
 * whoever's game is not answering dies of it by the server's hand (`keep`). See src/sim/grenades.ts.
 */
export function handBlast(c: Client, w: string, at: Vec3) {
  broadcast({ t: 'nade', id: c.id, o: at, v: [0, 0, 0], w, f: 0 }, c);
  if (c.alive && !c.power.god) dealt(c, inHandDamage(w), 'arms', w);
}

/** Four times a second: a pin that is out, a fuse that has run down, and nothing said of the grenade. It went off in the hand. */
export function inHands(now: number) {
  for (const c of clients.values()) {
    const went = c.nades.held ? overdue(c.nades, [c.pose[0], c.pose[1], c.pose[2]], now) : null;
    if (went) handBlast(c, went.w, went.from);
  }
}

/**
 * A grenade that fell from a dead hand has gone off where it lay (`fallen` in src/sim/grenades.ts: whoever dies
 * with the pin out lets go of it, and it goes off when its fuse ends, "for whoever is in reach, as any grenade on
 * the ground would"). Nobody's game is asked anything of it: where it lay and when it went off are the server's
 * own, and so is whom it reached, by how far each stands from it, as a car that burns is reckoned. Whoever is in
 * reach is hurt by it through what they wear, and it is the dead holder's doing; the infected in reach and a car
 * in reach take it too. (There are no walls in the server's world: none stops it, as none stops a burning car's.)
 */
export function fellBlast(by: Client, w: string, at: Vec3) {
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
export function pockets(c: Client) {
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
export const listOf = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Whoever is kept off for a while (by the checks, or timed out by an admin), one line for each player and not one
 * for each of the two things they are kept off by (their game's key and their address).
 * 2026-10-13: a player was kept off for six hours by a check that was wrong about them ("he says hes in offline
 * mode and cant play"), and there was nowhere it could be seen and no way to lift it short of a restart.
 */
export function keptOffNow(now = Date.now()): { name: string; why: string; until: number; keys: string[] }[] {
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
export function doorWords(key: string, ip: string, off: string): string {
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

export function bannedFor(key: string, ip: string): string | null {
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
export type Role = 'admin' | 'mod';

export interface AdminState {
  roles: Record<string, { role: Role; name: string; by: string; at: string }>;
  bans: { key: string; ip: string; name: string; why: string; by: string; at: string }[];
}

export const ADMIN = {
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

export const keyHash = (key: string) => createHash('sha256').update(`zona key ${key}`).digest('hex').slice(0, 40);

/** Is this an address out in the world? (Not this machine's own, nor one of a private network: those are whatever stands in front of the server, and are everybody's.) */
const publicIp = (ip: string) => !!ip && !/^(::1$|0:0:0:0::|::ffff:127\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);

export const ipHash = (ip: string) => (publicIp(ip) && ADMIN.pepper ? createHash('sha256').update(`${ADMIN.pepper} ${ip}`).digest('hex').slice(0, 40) : '');

export const roleOf = (c: Client): Role | null => (LOCAL_ADMIN ? 'admin' : ADMIN.state.roles[keyHash(c.key)]?.role ?? null);

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
export const PER_ADDRESS = process.env.PER_ADDRESS === undefined ? 1 : Math.max(0, Number(process.env.PER_ADDRESS) || 0);

export function addressFull(key: string, ip: string): boolean {
  if (!PER_ADDRESS || !publicIp(ip) || !ipsTellApart() || ADMIN.state.roles[keyHash(key)]) return false;
  // (Not counted: a body left behind by a connection that has gone. It was, for the five minutes it lies there:
  // and whoever came back in another browser, on another device, or with a browser that had forgotten who they
  // were, was told somebody was already playing from their connection, with one window open. 2026-10-12: "people
  // swear they only have 1 window open but then get blocked". A tag off such a body is still not paid to
  // somebody at its own address: see notEarned.)
  return [...clients.values()].filter((o) => o.ip === ip && o.key !== key && !roleOf(o) && !o.asleep).length >= PER_ADDRESS;
}

/** Something asked of the site: it is told a number, and asks this server back what the number stands for (see /adminop below). */
export async function siteAdmin(op: Record<string, unknown>): Promise<{ ok?: boolean; why?: string; state?: AdminState; pepper?: string; set?: boolean } | null> {
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
