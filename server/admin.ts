// The server: what an admin can do that nobody else can (command: every slash command; login; putting a player off).
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { spawnAnimal } from './animals';
import { createHash } from 'node:crypto';
import { heldIn } from '../src/sim/inventory';
import { ITEMS, type ItemInstance, makeItem } from '../src/sim/items';
import { onWorld } from '../src/world/worldgen';
import { comesFrom, flightTimes } from '../src/sim/airdrop';
import { POLICE_CAR, restState } from '../src/sim/vehicles';
import { HELI, skidGround } from '../src/sim/heli';
import type { S2C } from '../src/net/protocol';
import { ORDERS, written, entityBy, ENTITIES, GROUND } from '../src/net/orders';
import { KITS } from '../src/sim/kits';
import { type CarryPower, refill, carriedOf, refilledWords, CARRY_POWERS } from '../src/sim/powers';
import { BANS, PARKS, boxes, onMap, economy, horde, invented, issue, locks, log, news, standJeep, takeOut, things, vehInfo, vehicles, world, type Veh } from './index';
import { ipOf, namesOf } from './tags';
import { deviceOf, forgetDevice, shortDevice } from './device';
import { CHECK, CHECKS } from './checks';
import { ADMIN, SIG_MS, TURNED, bannedFor, forgetShooter, ipHash, keptOffNow, keyHash, outranks, over, roleOf, siteAdmin, turnedAway, type AdminState, type Role } from './gate';
import { KEPT, asAdmin, keepBefore, place, saveAdmin, savedWords, sayRestart, setPower, sys, whoIs } from './keep';
import { broadcast, cleanName, clients, drop, send, type Client } from './players';
import { kill } from './acts';
import { queue } from './queue';
import { sendDrop } from './drops';
import { dogtag, roleKey, tagSet } from './roles';
import { pinned } from './pinned';

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
export const CARRY_KEPT = new Map<string, Pick<Client['power'], CarryPower>>();

/**
 * Every power each admin has, by their key's hash, theirs again when they come back: across a server's restarts too,
 * kept with the world (keep.ts). The owner, 2026-10-14: "admin state should be stored across server restart.
 * currently when im flying around then leave then come back i fall and die as admin" (noclip, god and vanish were
 * forgotten as soon as they left).
 */
export const POWERS_KEPT = new Map<string, Client['power']>();
export const keepPowers = (c: Client) => void POWERS_KEPT.set(keyHash(c.key), { ...c.power });

export function carryKept(c: Client) {
  if (c.power.weightless || c.power.endless || c.power.bottomless) CARRY_KEPT.set(c.key, { weightless: c.power.weightless, endless: c.power.endless, bottomless: c.power.bottomless });
  else CARRY_KEPT.delete(c.key);
}

export function carryKeep(c: Client) {
  carryKept(c);
  send(c, { t: 'powers', ...c.power });
}

/**
 * Somebody who is no admin and has things in a hold (an admin who has been made something else since they put
 * them there): told that they have no powers, which is all their game needs to empty it into their pockets, and at
 * their feet what finds no room. Nobody else who is no admin is ever told of powers.
 */
export function noHold(c: Client) {
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
  // (bottomless put off empties their hold at their feet: no admin's to do to one above them, see `over`)
  if (!outranks(c, t)) return void sys(c, `${t.name} is above you: only whoever made them, or somebody above that, can do that to them.`);
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
    const why = bannedFor(o.key, o.ip, o.fp);
    if (!why) continue;
    out.push(o.name);
    TURNED.banned++;
    eject(o, why === 'banned' ? 'You are banned from this server.' : 'You are kept off this server for now.');
  }
  for (const w of [...queue]) {
    if (!bannedFor(w.key, ipOf.get(w.ws) ?? '', deviceOf.get(w.ws) ?? '')) continue;
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
  return `Taken away: ${v.goneAt ? 'the burned-out car' : v.k === POLICE_CAR.kind ? 'the police car' : v.k === HELI.kind ? 'the helicopter' : 'the jeep'}, number ${v.i}. (The cars of the map are back when the server next starts.)`;
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
    const d = Math.hypot(p.x - x, p.z - z) + ((p.ks ?? [p.k]).includes(k) ? 0 : 1e6);
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
export const banId = (b: { key: string }) => `a:${b.key.slice(0, 8)}`;

// (made with the site's secret, as the hash of an address is: nothing of the key or the address can be had back from it)
export const offId = (b: { keys: string[] }) => `t:${createHash('sha256').update(`${ADMIN.pepper} kept off ${b.keys[0]}`).digest('hex').slice(0, 8)}`;

/**
 * An order typed where talk is typed. @returns nothing: whoever gave it is told what came of it.
 * Mods: players, recent, flagged, kick, timeout, say. Admins: those, and ban, unban, bans, admin, mod, demote, roles.
 */
export async function command(c: Client, line: string) {
  const [word = '', ...rest] = line.slice(1).trim().split(/\s+/);
  const cmd = word.toLowerCase(), role = roleOf(c);
  if (!role) return void sys(c, cmd === 'help' ? 'There is nothing here to give orders with.' : 'That is not a thing you can do here.');
  const admin = role === 'admin';
  const need = () => void sys(c, 'Only an admin can do that.');
  const who = rest[0] ?? '', why = rest.slice(1).join(' ').slice(0, 120);
  /** somebody above them in the line of who made whom: not theirs to act against (see `over`) */
  const above = (name: string) => void sys(c, `${name} is above you: only whoever made them, or somebody above that, can do that to them.`);
  const label = (o: Client) => `#${o.id} ${o.name}${roleOf(o) ? ` [${roleOf(o)}]` : ''}${o.fp ? `  dev:${shortDevice(o.fp)}` : ''}`;
  /** a device named in an order (dev:xxxxxxxx, as /players shows it), or '' */
  const devOf = (w: string) => (/^dev:[0-9a-f]{4,40}$/i.test(w) ? w.slice(4).toLowerCase() : '');
  switch (cmd) {
    case 'help':
      return void sys(c, `Orders: ${ORDERS.filter((o) => !o.admin).map(written).join(' · ')}`, ...(admin ? [`Admins: ${ORDERS.filter((o) => o.admin).map(written).join(' · ')}`] : []), '"who" is a name, part of one, or #number from /players.', ...(admin ? ['/ban also finds somebody who has just left (/recent).'] : []));
    case 'players':
    case 'who':
    case 'list':
      return void sys(c, `${clients.size} online:`, ...[...clients.values()].map((o) => `${label(o)}  at ${o.pose[0].toFixed(0)}, ${o.pose[2].toFixed(0)}${o.alive ? '' : ' (dead)'}${o.check.flags ? `  ${o.check.flags} flagged` : ''}`));
    case 'recent':
      return void sys(c, ADMIN.gone.length ? 'Left lately (newest last):' : 'Nobody has left lately.', ...ADMIN.gone.slice(-15).map((g) => `${g.name}  ${Math.round((Date.now() - g.at) / 60000)} min ago${g.fp ? `  dev:${shortDevice(g.fp)}` : ''}`));
    case 'same': {
      // (everybody on one device: playing now, and gone lately. The swarm of 2026-10-16 was one device under a dozen names.)
      const d = devOf(who), t = d ? null : whoIs(who);
      const fp = d || t?.fp || '';
      if (!fp) return void sys(c, d ? 'No device is that.' : t ? `${t.name}'s game said nothing of its device.` : `Nobody online is "${who}" (or more than one is): see /players, or give a device as dev:xxxxxxxx.`);
      const on = [...clients.values()].filter((o) => o.fp.startsWith(fp)), gone = ADMIN.gone.filter((g) => g.fp.startsWith(fp) && !on.some((o) => o.key === g.key));
      return void sys(c, `On device ${shortDevice(fp)}: ${on.length} playing, ${gone.length} gone lately.`, ...on.map((o) => `${label(o)}  playing`), ...gone.slice(-15).map((g) => `${g.name}  gone ${Math.round((Date.now() - g.at) / 60000)} min ago`));
    }
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
      if (!onWorld(x, z, 6)) return void sys(c, 'That is off the map.');
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
      // (in front of whoever asks while they stand on a roof or an upper floor: at their own height, not the ground's
      // under the building; flown up there with noclip, the ground's. The owner, 2026-10-15: "when i spawn an entity it
      // does not respect the collision of a bulding (spawn heli on roof doenst owk)")
      const own = n.length < 3 && !c.power.clip && c.pose[1] > world.groundAt(x, z) + 0.5 ? c.pose[1] : null;
      const y = n.length === 4 ? n[2] : own;
      if (!onWorld(x, z, 6) || (y !== null && Math.abs(y) > 400)) return void sys(c, 'That is off the map.');
      if (e.kind === 'car') {
        const standing = [...vehicles.values()].filter((v) => !v.goneAt).length;
        if (standing + count > PARKS.length + 30) return void sys(c, `There are ${standing} cars standing already: take some away first (/delcar).`);
        const made: Veh[] = [];
        for (let k = 0; k < count; k++) {
          // (more than one: side by side, across the way the admin faces)
          const off = (k - (count - 1) / 2) * 4.5, cx = x + Math.cos(yaw) * off, cz = z - Math.sin(yaw) * off;
          // (a helicopter on the highest ground under its skids, as the parked ones are: see skidGround)
          const ground = e.k === HELI.kind ? skidGround(world.coverAt, cx, cz, yaw) : world.groundAt(cx, cz);
          const v = standCarAt(e.k ?? 0, cx, y ?? ground, cz, yaw);
          if (!v) break;
          made.push(v);
          broadcast({ t: 'v+', v: vehInfo(v) });
        }
        if (!made.length) return void sys(c, 'No car is kept anywhere in this world: none can be stood.');
        const which = `number ${made.map((v) => v.i).join(', ')}`;
        log(`[admin] ${c.name} stood ${made.length} × ${e.name.toLowerCase()} at ${x.toFixed(0)}, ${z.toFixed(0)} (${which})`);
        return void sys(c, `${made.length > 1 ? `${made.length} × ` : ''}${e.name} at ${x.toFixed(0)}, ${z.toFixed(0)} (${which}). /delcar takes the nearest car away.`);
      }
      if (e.kind === 'animal') {
        // (all of them one herd or pack: wolves stood together hunt together)
        const made = spawnAnimal(e.animal!, x, z, count);
        if (!made) return void sys(c, `No ${e.name.toLowerCase()} can be stood: the game has no model for it yet.`);
        log(`[admin] ${c.name} stood ${made} × ${e.name.toLowerCase()} at ${x.toFixed(0)}, ${z.toFixed(0)}`);
        return void sys(c, `${made > 1 ? `${made} × ` : ''}${e.name} at ${x.toFixed(0)}, ${z.toFixed(0)}.`);
      }
      // (as many as are asked for, however many are on their feet already: the owner, 2026-10-19, "admins when they
      // spawn zombies should bypass the server cap". The map's own are still kept to theirs: see Director.)
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
    case 'unlock': {
      // (a name and payout wallet fixed at a first cashed tag, free to change again until the next: server/pinned.ts)
      if (!admin) return need();
      const t = whoIs(who);
      if (t) {
        if (!pinned.free(t.key)) return void sys(c, `${t.name}'s name and wallet are not fixed: they can change them already.`);
        send(t, { t: 'pinned', pin: null });
        sys(t, 'An admin has let you change your name and payout wallet: they are fixed again at your next cashed tag.');
        log(`[admin] ${c.name} let ${t.name} change their name and wallet`);
        return void sys(c, `${t.name} can change their name and wallet until their next cashed tag.`);
      }
      const freed = who ? pinned.freeName(who) : null;
      if (!freed) return void sys(c, `Nobody on is "${who}", and no one name is fixed as that: see /players.`);
      log(`[admin] ${c.name} let ${freed} (not on) change their name and wallet`);
      return void sys(c, `${freed} can change their name and wallet when they next come, until their next cashed tag.`);
    }
    case 'kick': {
      const t = whoIs(who);
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (roleOf(t) === 'admin' && !admin) return need();
      if (!outranks(c, t)) return above(t.name);
      log(`[admin] ${c.name} kicked ${t.name}${why ? `: ${why}` : ''}`);
      eject(t, `You were put off the server${why ? `: ${why}` : '.'}`);
      return void sys(c, `${t.name} is off the server.`);
    }
    case 'timeout': {
      const t = whoIs(who), mins = Math.min(60, Math.max(1, Math.round(Number(rest[1]) || 10)));
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is): see /players.`);
      if (roleOf(t) === 'admin' && !admin) return need();
      if (!outranks(c, t)) return above(t.name);
      const reason = rest.slice(2).join(' ').slice(0, 120);
      for (const n of namesOf(t.key, t.ip, t.fp)) BANS.temp.set(n, { until: Date.now() + mins * 60000, why: `timed out by ${c.name}${reason ? `: ${reason}` : ''}`, name: t.name });
      log(`[admin] ${c.name} timed ${t.name} out for ${mins} minutes${reason ? `: ${reason}` : ''}`);
      eject(t, `You are kept off the server for ${mins} minutes${reason ? `: ${reason}` : '.'}`);
      const more = sweepKeptOff(c);
      return void sys(c, `${t.name} is off the server for ${mins} minutes.${more.length ? ` Put out with them, from the same address: ${more.join(', ')}.` : ''}`);
    }
    case 'ban': {
      if (!admin) return need();
      // (a device, as /players and /same show it: whoever is on it now, else whoever was on it last)
      const d = devOf(who);
      const t = d ? [...clients.values()].find((o) => o.fp.startsWith(d) && o !== c) ?? null : whoIs(who);
      const left = t ? null : d ? [...ADMIN.gone].reverse().find((g) => g.fp.startsWith(d)) : (/^#\d+$/.test(who) ? ADMIN.gone.find((g) => g.id === Number(who.slice(1))) : undefined) ?? [...ADMIN.gone].reverse().find((g) => g.name.toLowerCase() === who.toLowerCase()) ?? [...ADMIN.gone].reverse().find((g) => g.name.toLowerCase().includes(who.toLowerCase()) && who.length > 1);
      if (!t && !left) return void sys(c, d ? `Nobody online or lately gone is on device ${d}: see /players and /recent.` : `Nobody online or lately gone is "${who}": see /players and /recent.`);
      if (t === c) return void sys(c, 'That is you.');
      const name = t ? t.name : left!.name, key = keyHash(t ? t.key : left!.key), ip = ipHash(t ? t.ip : left!.ip), fp = t ? t.fp : left!.fp, sig = (t ? t.sig : left!.sig) ?? '';
      if (!over(keyHash(c.key), key)) return above(name);
      if (ADMIN.state.roles[key]?.role === 'admin') return void sys(c, `${name} is an admin: /demote first.`);
      // (the owner, 2026-10-16: "can i ban this computr or browser at the source?": the device goes on the ban with the key and the address;
      // and their browser for a day, the bots of 2026-10-18 coming back with a new device every time: see sigOf)
      const next: AdminState = { roles: ADMIN.state.roles, bans: [...ADMIN.state.bans.filter((b) => b.key !== key), { key, ip, ...(fp ? { fp } : {}), ...(sig ? { sig, sigTill: Date.now() + SIG_MS } : {}), name, why, by: c.name, at: new Date().toISOString() }] };
      log(`[admin] ${c.name} banned ${name}${why ? `: ${why}` : ''}${ip ? '' : ' (by key only: no address is known)'}${fp ? ` [dev ${shortDevice(fp)}]` : ''}`);
      if (t) eject(t, 'You are banned from this server.');
      // (and off the panel's "Left lately": the owner, 2026-10-16, "when i ban someone their name should be removed")
      const rawKey = t ? t.key : left!.key;
      for (let i = ADMIN.gone.length - 1; i >= 0; i--) if (ADMIN.gone[i].key === rawKey) ADMIN.gone.splice(i, 1);
      // (it holds from this line on: see saveAdmin. And whoever else it covers goes now.)
      const saving = saveAdmin(next);
      const more = sweepKeptOff(c);
      const kept = await saving;
      const by = [ip ? 'their address' : '', fp ? `their device (${shortDevice(fp)})` : '', sig ? `their browser for ${Math.round(SIG_MS / 3600_000)} hours` : ''].filter(Boolean);
      const alike = sig ? [...clients.values()].filter((o) => o.sig === sig && o.key !== (t ? t.key : left!.key)).length : 0;
      return void sys(c, `${name} is banned${by.length ? `, by their game, ${by.join(', ')}` : ' (by their game only: the address could not be told)'}, from now.${more.length ? ` Put out with them: ${more.join(', ')}.` : ''}${alike ? ` ${alike} other${alike === 1 ? ' is' : 's are'} playing on the same browser and card, and will be kept off if they leave and come back: /unban lifts it.` : ''}${savedWords(kept)}`);
    }
    case 'bans':
      if (!admin) return need();
    {
      const off = keptOffNow();
      return void sys(
        c,
        ADMIN.state.bans.length ? 'Banned (/unban takes the id in brackets, or the number straight after this list):' : 'Nobody is banned.',
        ...ADMIN.state.bans.map((b, i) => `${i + 1}. ${b.name}  [${banId(b)}]  by ${b.by}, ${b.at.slice(0, 10)}${b.fp ? `, dev:${shortDevice(b.fp)}` : ''}${b.why ? `: ${b.why}` : ''}`),
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
      return void sys(c, `${b.name} is no longer banned.${savedWords(kept)}`);
    }
    case 'turned':
      return void sys(c, ADMIN.turned.length ? 'Turned away at the door lately (newest last; /pardon p:number lets them straight back in):' : 'Nobody has been turned away at the door lately.', ...ADMIN.turned.slice(-20).map((t) => `p:${t.n}  ${t.name}  ${Math.round((Date.now() - t.at) / 60000)} min ago${t.fp ? `  dev:${shortDevice(t.fp)}` : ''}: ${t.why}`));
    case 'pardon': {
      // The owner, 2026-10-16: "admins need a way to handle when someone tries to join but is wrongly banned, or
      // kicked or rejects. we need to have a 'pardon' button for these people". Everything on them is lifted at
      // once: the bans and strikes on their game, their address and their device, an admin's ban of any of the
      // three, and what their device had been seen to come with (so the farm rule starts afresh for it).
      if (!admin) return need();
      const w = rest.join(' ').trim(), lw = w.toLowerCase(), d = devOf(w);
      const t = /^p:\d+$/.test(lw) ? ADMIN.turned.find((x) => x.n === Number(lw.slice(2))) : d ? [...ADMIN.turned].reverse().find((x) => x.fp.startsWith(d)) : [...ADMIN.turned].reverse().find((x) => x.name.toLowerCase() === lw) ?? [...ADMIN.turned].reverse().find((x) => lw.length > 1 && x.name.toLowerCase().includes(lw));
      if (!t) return void sys(c, `Nobody turned away at the door lately is "${w}": see /turned (or the Bans page of the panel).`);
      const names = [t.key, ...(t.ip ? [`ip:${t.ip}`] : []), ...(t.fp ? [`fp:${t.fp}`] : [])].filter(Boolean);
      const lifted: string[] = [];
      for (const n of names) {
        if (BANS.temp.delete(n)) lifted.push(n.startsWith('ip:') ? 'kept off by address' : n.startsWith('fp:') ? 'kept off by device' : 'kept off by game');
        BANS.strikes.delete(n);
        BANS.strikes.delete(`back:${n}`);
      }
      if (t.fp) forgetDevice(t.fp);
      const k = t.key ? keyHash(t.key) : '', a = ipHash(t.ip);
      const bans = ADMIN.state.bans.filter((b) => !((k && b.key === k) || (a && b.ip === a) || (t.fp && b.fp === t.fp)));
      let kept = true;
      if (bans.length !== ADMIN.state.bans.length) {
        lifted.push(`${ADMIN.state.bans.length - bans.length} ban${ADMIN.state.bans.length - bans.length === 1 ? '' : 's'} an admin wrote down`);
        kept = await saveAdmin({ roles: ADMIN.state.roles, bans });
      }
      ADMIN.turned.splice(ADMIN.turned.indexOf(t), 1);
      log(`[admin] ${c.name} pardoned ${t.name} (turned away: ${t.why}): ${lifted.length ? lifted.join(', ') : 'nothing was on them'}`);
      return void sys(c, `${t.name} is pardoned and may come straight back in${lifted.length ? `: lifted ${lifted.join(', ')}` : ' (nothing was kept against them here: what turned them away was ${t.why})'}.${savedWords(kept)}`);
    }
    case 'admin':
    case 'op':
    case 'mod':
    case 'demote':
    case 'deop': {
      if (!admin) return need();
      // (somebody with a role named by the key it is kept under, `r:` and its start as the panel's Roles sends it, or by
      // their name: online, as anybody named is; not online, taken away or an admin's made a mod's all the same. The
      // owner, 2026-10-19: "I cannot demote someone i made admin bc theyre offline". Made an admin only when here.)
      const named = whoIs(who), rk = named ? null : roleKey(who);
      const t = named ?? (rk ? [...clients.values()].find((o) => keyHash(o.key) === rk) ?? null : null);
      if (!t && rk) {
        const r = ADMIN.state.roles[rk], mine = keyHash(c.key);
        if (rk === mine) return void sys(c, 'Not yourself: somebody else has to.');
        if (cmd === 'admin' || cmd === 'op') return void sys(c, `${r.name} is not online: they have to be here to be made an admin.`);
        if (r.role === 'mod' && cmd === 'mod') return void sys(c, `${r.name} is a mod already.`);
        if (!over(mine, rk)) return above(r.name);
        const roles = { ...ADMIN.state.roles };
        if (cmd === 'mod') roles[rk] = { role: 'mod', name: r.name, by: c.name, up: mine, at: new Date().toISOString() };
        else delete roles[rk];
        log(`[admin] ${c.name} made ${r.name} ${cmd === 'mod' ? 'mod' : 'nothing'} (offline)`);
        const kept = await saveAdmin({ roles, bans: ADMIN.state.bans });
        // (and nothing of an admin's waits for them to come back to)
        POWERS_KEPT.delete(rk);
        for (const k of [...ADMIN.voids.keys()]) if (keyHash(k) === rk) ADMIN.voids.delete(k);
        for (const k of [...CARRY_KEPT.keys()]) if (keyHash(k) === rk) CARRY_KEPT.delete(k);
        return void sys(c, `${r.name} (not online) is ${cmd === 'mod' ? 'a mod' : 'no longer either'}.${savedWords(kept)}`);
      }
      if (!t) return void sys(c, `Nobody online is "${who}" (or more than one is), and nobody with a role is: they have to be here to be given one.`);
      const key = keyHash(t.key), roles = { ...ADMIN.state.roles }, was = roleOf(t) === 'admin';
      const to: Role | null = cmd === 'mod' ? 'mod' : cmd === 'demote' || cmd === 'deop' ? null : 'admin';
      if (t === c && to !== 'admin') return void sys(c, 'Not yourself: somebody else has to.');
      if (t === c) return void sys(c, 'You are an admin already.');
      if (!outranks(c, t)) return above(t.name);
      // (who gave it, by their key's hash: the line of who made whom, see `over`)
      if (to) roles[key] = { role: to, name: t.name, by: c.name, up: keyHash(c.key), at: new Date().toISOString() };
      else delete roles[key];
      log(`[admin] ${c.name} made ${t.name} ${to ?? 'nothing'}`);
      const kept = await saveAdmin({ roles, bans: ADMIN.state.bans });
      if (to !== 'admin') {
        for (const k of ['god', 'hidden', 'clip', 'voidInv', 'voidTag', 'weightless', 'endless', 'bottomless'] as const) setPower(t, k, false);
        ADMIN.voids.delete(t.key);
        POWERS_KEPT.delete(keyHash(t.key));
        // (and whoever has vanished is gone from their game, as from anybody's)
        if (was) for (const o of clients.values()) if (o !== t && o.power.hidden) send(t, { t: 'leave', id: o.id });
      }
      send(t, { t: 'role', role: to });
      if (to === 'admin' && !was) asAdmin(t, true);
      if (to) sys(t, `${c.name} has made you ${to === 'admin' ? 'an admin' : 'a mod'}: /help says what you can do.`);
      return void sys(c, `${t.name} is ${to ? (to === 'admin' ? 'an admin' : 'a mod') : 'no longer either'}.${savedWords(kept)}`);
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
      if (cmd === 'bring' && !outranks(c, t)) return above(t.name);
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
      if (!onMap(x, z)) return void sys(c, 'That is off the map.');
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
      if (t && !outranks(c, t)) return above(t.name);
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
      if (!outranks(c, t)) return above(t.name);
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
      if (!outranks(c, t)) return above(t.name);
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
      if (!outranks(c, t)) return above(t.name);
      log(`[admin] ${c.name} slew ${t.name}`);
      t.lastHitBy = null;
      kill(t, 'an admin');
      return void sys(c, `${t.name} is dead.`);
    }
    case 'dogtag':
      if (!admin) return need();
      return dogtag(c, rest, above);
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
      if (!outranks(c, t)) return above(t.name);
      const set = k === 'voidTag' ? tagSet(c, t) : null;
      if (set) return void sys(c, set);
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
export async function login(c: Client, pw: unknown) {
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

/**
 * Their page's window.__game was read ('bait'): a script pasted into the console, as nothing of the game reads it
 * (src/net/bait.ts; until 2026-10-20 it was the whole game, and a wallhack passed round among players used it).
 * Banned as an admin's /ban bans: by their game, their address, their device and their browser (the owner,
 * 2026-10-20: "ban anyone using this exploit"). An admin is only written down.
 */
export async function baited(c: Client, what: string) {
  const why = `cheat script (read window.${what.slice(0, 24)})`;
  if (roleOf(c) === 'admin') return void log(`[cheat] ${c.name} is an admin and is left alone: ${why}`);
  const key = keyHash(c.key), ip = ipHash(c.ip), fp = c.fp, sig = c.sig ?? '';
  const next: AdminState = { roles: ADMIN.state.roles, bans: [...ADMIN.state.bans.filter((b) => b.key !== key), { key, ip, ...(fp ? { fp } : {}), ...(sig ? { sig, sigTill: Date.now() + SIG_MS } : {}), name: c.name, why, by: 'the server', at: new Date().toISOString() }] };
  log(`[cheat] ${c.name} (#${c.id}) banned: ${why}${fp ? ` [dev ${shortDevice(fp)}]` : ''}`);
  eject(c, 'You are banned from this server.');
  for (let i = ADMIN.gone.length - 1; i >= 0; i--) if (ADMIN.gone[i].key === c.key) ADMIN.gone.splice(i, 1);
  await saveAdmin(next);
}

/** Put off the server by a check (only ever when enforcing): told so, counted, and after enough of it kept off for a while. */
export function putOff(c: Client, why: string) {
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
  forgetShooter(c.key, c.ip);
  log(`[check] ${c.name} is put off the server: ${why}${kept ? `; and kept off it for ${CHECK.ban} hours` : ''}`);
  if (kept) turnedAway(c.name, c.key, c.ip, c.fp, `kept off ${CHECK.ban} hours: ${why}`);
  send(c, { t: 'kick', reason: kept ? 'The server could not make sense of what your game told it, more than once. You are kept off it for a while.' : 'The server could not make sense of what your game told it. Reconnect.' });
  c.ws.close();
  drop(c);
}
