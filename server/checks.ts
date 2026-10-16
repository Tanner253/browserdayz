// The server: its own checks on where players say they are and what they say they did (moves, hills between, the zone, under the ground, gait).
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { TAG_OUT, type ItemInstance } from '../src/sim/items';
import { inPlay } from '../src/world/worldgen';
import { F_DANCE, F_SIT, F_SURRENDER, type Pose } from '../src/net/protocol';
import { BANS, SOAK, log, vehicles, world, type Box } from './index';
import { carriedTags, lootedTags, namesOf, tagSeen, voided } from './tags';
import { TURNED, keep, keyHash, roleOf, shooters, stayOn, turnedAway } from './gate';
import { KEPT } from './keep';
import { putOff } from './admin';
import { clients, drop, send, type Client } from './players';
import { AIR, FIRST } from './bodywatch';

// ------------------------------------------------------------------ players

/**
 * Carrying a tag they took off somebody (their own does not count). Such a player is shown
 * on the map every half minute, and goes on foot: no jeep will take them.
 */
export function takenTag(c: Client): boolean {
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
export const CHECKS = (['off', 'watch', 'enforce'].includes(process.env.CHECKS ?? '') ? process.env.CHECKS : 'watch') as 'off' | 'watch' | 'enforce';

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
 *   fresh – ms after somebody is let in OFF THE BOT CHECK'S RANGE in which what their game says of being up
 *     where the range stood is not weighed. The range stands four hundred metres up, and a game that had passed
 *     it went on saying it was there (or falling from there) until it had put its world together: held in the air
 *     for twelve seconds, put off; put off, the range again, and the same again; twice in an hour, kept off for
 *     six. Nobody had cheated. 2026-10-13: "this person was wrongfully banned". The game no longer waits up there;
 *     this is for a game that does all the same. (Until 2026-10-15 nothing they said at all was weighed for half
 *     a minute: a program had half its first minute free. "we need to detect bots within a minute of joining".)
 */
export const CHECK = { foot: 9.5, seat: 64, carry: 2, lag: 12, lagFor: 5000, grace: 3, owe: 30, free: 2500, fresh: 30_000, kick: Number(process.env.CHECK_KICK) || 12, hill: 1.5, high: [30, 4], reach: 8, heal: 10, over: 15, down: 1500, strikes: 2, ban: 6 };

export let flagged = 0;

/** Something a check fires on: counted, and written down (not more than once in five seconds for one player). @returns whether it is refused */
export function flag(c: Client, what: string, refuse = true): boolean {
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
  // (In their first minute, a handful of flags is enough: "we need to detect bots within a minute of joining". A
  // person new to the world is flagged by a line that stalls now and then, and is let go a little for it; the
  // programs of 2026-10-15 were flagged eighteen and thirty-five times in their first minute. Sent back to the bot
  // check, not put off: a person loses nothing by it.)
  else if (CHECKS === 'enforce' && c.check.flags === FIRST_FLAGS && now - c.joinedAt < FIRST) setImmediate(() => clients.has(c.id) && recheck(c, `flagged ${FIRST_FLAGS} times in their first minute (the last: ${what})`));
  return refuse && CHECKS === 'enforce';
}

/** in their first minute in the world, somebody flagged this many times is sent back to the bot check */
const FIRST_FLAGS = Number(process.env.FIRST_FLAGS) || 8;

/** Is a place up where the bot check's range stands, high over the middle of the map? (see CHECK.fresh) */
const atRange = (p: Pose) => Math.hypot(p[0], p[2]) < 60 && p[1] > world.groundAt(p[0], p[2]) + 60;

/**
 * Sent back to the bot check (2026-10-15): taken off the server as with the proper leave, saved where they stood
 * with everything they carried, their pass forgotten, and told to press Play: the course again, and back where they
 * were. What a program cannot do, and a person can in a minute. Watching (CHECKS=watch), only written down.
 */
/** sent back to the bot check this many times within so long, a player is kept off the server for so many hours */
const RECHECK_BAN = { times: 4, within: 30 * 60_000, hours: 24 };

export function recheck(c: Client, why: string) {
  const secs = ((Date.now() - c.joinedAt) / 1000).toFixed(0);
  if (CHECKS !== 'enforce') return void log(`[check:${CHECKS}] ${c.name} would be sent back to the bot check, ${secs} s after coming in: ${why}`);
  TURNED.recheck++;
  log(`[check] ${c.name} is sent back to the bot check, ${secs} s after coming in: ${why}`);
  shooters.delete(`${keyHash(c.key)}|${c.ip}`);
  // Sent back again and again: kept off the server, by their key, where they play from and the device they play on
  // (the owner, 2026-10-16: "can we ban these accounts who join and get kcicked multiple times?". That day a swarm
  // with made-up names, Merric635, Brambl116 and the like, passed the course and was sent back from the world every
  // half minute, and took new names and keys every half hour: the device is what they all share.)
  const now = Date.now();
  let kept = false;
  if (roleOf(c) !== 'admin') {
    for (const n of namesOf(c.key, c.ip, c.fp)) {
      const times = (BANS.strikes.get(`back:${n}`) ?? []).filter((t) => now - t < RECHECK_BAN.within);
      times.push(now);
      BANS.strikes.set(`back:${n}`, times);
      if (times.length >= RECHECK_BAN.times) {
        BANS.temp.set(n, { until: now + RECHECK_BAN.hours * 3600000, why: `sent back to the bot check ${times.length} times in ${Math.round(RECHECK_BAN.within / 60000)} minutes`, name: c.name });
        kept = true;
      }
    }
  }
  if (kept) {
    log(`[check] ${c.name} is kept off the server for ${RECHECK_BAN.hours} hours: sent back to the bot check ${RECHECK_BAN.times} times in ${Math.round(RECHECK_BAN.within / 60000)} minutes`);
    turnedAway(c.name, c.key, c.ip, c.fp, `kept off ${RECHECK_BAN.hours} hours: sent back to the bot check ${RECHECK_BAN.times} times in ${Math.round(RECHECK_BAN.within / 60000)} minutes`);
    send(c, { t: 'kick', reason: 'Sent back to the bot check too many times. You are kept off the server for a while.' });
    drop(c);
    c.ws.close();
    return;
  }
  send(c, { t: 'kick', reason: 'A quick bot check before you go on. Press Play: when it is passed you are back where you stood, with everything you carried.' });
  drop(c);
  c.ws.close();
}

/** enforcing, somebody the checks have flagged this many times since they came in is put out of the server (FLAGS_OUT) */
const FLAGS_OUT = Number(process.env.FLAGS_OUT) || 50;

/**
 * Whether the place a player says they have got to is one they could have got to since they were last where
 * they said. Refused, they are kept where they were for everybody else (and for what they can hit from there)
 * until enough time has gone by to have run or driven the distance: nobody gets anywhere faster than that, and
 * an honest player who was wrongly refused is right again in the time it takes to cover the ground.
 */
export function moveCheck(c: Client, to: Pose, now: number): boolean {
  const k = c.check;
  if (CHECKS === 'off' || !c.alive || now < k.free || c.power.clip || roleOf(c) === 'admin' || (now < k.ranged && atRange(to))) {
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
 * What the server has just dealt somebody, taken off the most health they can have. That figure is never less
 * than what they do have: it starts at what they last said (or a hundred), comes back at CHECK.heal a second
 * whether they are mending or not, and loses only what the best armour there is would let through. So nobody
 * honest is ever below it, and whoever is CHECK.over past none of it and still on their feet CHECK.down later
 * has taken more than a body can (see `standing`).
 */
export function dealt(target: Client, amount: number, zone: string, w: string) {
  keep(target, amount, zone, w);
  stayOn(target, 'you were hit');
  if (CHECKS === 'off' || !target.alive) return;
  const now = Date.now(), k = target.check;
  k.hp = Math.min(100, k.hp + (CHECK.heal * (now - k.hpAt)) / 1000) - amount * (w === 'crash' ? 1 : zone === 'torso' ? SOAK.torso : zone === 'head' ? SOAK.head : 1);
  k.hpAt = now;
  if (k.hp < -CHECK.over && !k.downAt) k.downAt = now;
}

/** How far the ground stands over the line from one player's eye to another's chest, where it stands over it at all (0: it does not, or there is no saying). */
export function hillBetween(a: Pose, b: Pose): number {
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
export function zoneCheck(c: Client, now = Date.now()) {
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

export function underCheck(c: Client, now = Date.now()) {
  const [x, y, z] = c.pose;
  const b = world.bunker;
  const down = c.alive && !c.seatAt && !c.power.clip && roleOf(c) !== 'admin' && now >= c.check.free && y < world.coverAt(x, z) - UNDER.deep && !(b && Math.hypot(x - b.x, z - b.z) < UNDER_BUNKER) && !world.castleUnder(x, y, z) && !world.basementUnder(x, y, z);
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

/**
 * A body watched for a program walking it (server/bodywatch.ts): on nothing in the air, or to and fro on one spot
 * doing nothing else. What it is told of the place is the server's: what is under them (the ground, a bridge, the
 * fort), and whether anything they could be up on is near (the world's things, and the vehicles where they are now).
 * @param said where their game says they are (taken or refused), @param n when that was so by its own clock
 */
export function bodyCheck(c: Client, was: Pose, said: Pose, n: number | undefined, now = Date.now()) {
  if (CHECKS === 'off') return;
  const k = c.check, [x, y, z] = said;
  const free = !c.alive || !!c.seatAt || c.power.clip || roleOf(c) === 'admin' || now < k.free || (now < k.ranged && atRange(said));
  const under = world.standAt(x, y, z), up = y - under > AIR.high;
  const by = world.supportNear(x, z), near = up && (by || [...vehicles.values()].some((v) => Math.hypot(v.s[0] - x, v.s[2] - z) < 7));
  // (a dance, a sit, hands up: chosen, and the feet kept where they are, which the game's own emotes do)
  const posed = (said[5] & (F_DANCE | F_SIT | F_SURRENDER)) !== 0 && Math.hypot(x - was[0], z - was[2]) < 0.3;
  const v = k.body.see({ t: typeof n === 'number' && Number.isFinite(n) ? n : now, x, y, z, under, near, by, free, did: posed ? now : k.acted }, now);
  if (v) recheck(c, v.why);
}

export function gaitCheck(c: Client, was: Pose, now = Date.now()) {
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
export function touched(b: Box) {
  if (b.kind !== 'stash') return;
  b.touchedAt = Date.now();
  KEPT.dirty = true;
}

/** Is somebody out of the game for being under the ground? (past the moment that is let go) */
export const buried = (c: Client, now = Date.now()) => c.underAt > 0 && now - c.underAt >= UNDER.grace * 1000;
