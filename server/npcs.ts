// The server: armed survivors of its own (2026-11-14). The owner: "players are not playing the game bc its boring i
// guess and theres not enough players online maybe we need npc ai"; and of how they are to be: "our ai should be smart
// they should strafe and hide behind cover and peek over cover to shoot back at player and also should respond to long
// distance shots if they're near the npc ... it should behave like a real player".
//
// Each is told to every game as a player is (a 'join', a row of 'ps', a 'shot', a 'death', a 'leave'), under a number
// from NPC_FROM up, so a game draws, hears, shoots and searches one with what it has for players and nothing new. They
// are in no list of players: not `clients`, not the board, not the count of who is on (src/game/game/online.ts leaves
// them out). And nothing of them pays: one has no dog tag, and a hit of theirs is never `lastHitBy`, so a player one
// kills leaves no tag either (TAG_NEEDS_KILLER, server/acts.ts): two friends cannot have one shot and take the tag.
//
// The mind: it wanders about its place; hears a shot within the gun's carry, or takes a round, and turns to it; sees
// whoever is in the open in front of it; and fights from cover where there is any, stood out or stood up to fire a
// burst and gone back behind it, moving along when it is flanked, and aside in the open where there is none. They keep
// out of doors: the server knows where the map's walls are and not the ways through them (a later step).

import { F_AIM, F_CROUCH, F_DEAD, F_GROUND, F_PRONE, F_SPRINT, NPC_FROM, type C2S, type KillInfo, type PlayerInfo, type Pose, type S2C } from '../src/net/protocol';
import { WEAPON_RULES, hitDamage, piercedBy, type HitZone } from '../src/sim/combat';
import { ITEMS, makeItem, stockGun } from '../src/sim/items';
import { BODY_GRID, Container } from '../src/sim/inventory';
import type { Ground } from '../src/sim/animal-ground';
import { clients, broadcast, broadcastNear, num, send, type Client } from './players';
import { boxes, economy, issue, log, world } from './index';
import { bodyInfo, fellWay } from './bodies';
import { dealt } from './checks';
import { away } from './gate';
import { mayHit } from './tags';
import { safe } from './camp';
import { roundClear, sightClear } from './walls';
import { solid, walled, zoneAt } from './solid';
import type { Vec3 } from '../src/sim/grenades';

/** how many there are (NPCS=0 for none), and the numbers they go by */
export const NPC = {
  count: Math.max(0, Number(process.env.NPCS ?? 10) || 0),
  /** thinks only with a player this near, metres */
  near: 260,
  /** sees a standing player this far in the open in front of it; less of one crouched, lying, or in the trees */
  sees: 95,
  /** and knows where a round came from this far, when it is hit or one is fired at it */
  feels: 220,
  walk: 1.5,
  run: 4.4,
  hp: 100,
  /** seconds its body lies before it is gone, and before another comes to the map in its place */
  lies: 300,
  back: [150, 330] as [number, number],
  /** no nearer a player than this where it comes to the map, metres */
  apart: 140,
  /** and nobody is seen or shot at this soon after they come into the world, ms: one may be standing where they wake */
  grace: Number(process.env.NPC_GRACE ?? 30000),
  /** how well they shoot (NPC_AIM: 0, never a hit; 1, as written below), and how much of a round's harm theirs does: a
   * hit of theirs is a roll and no aim, so it is made to hurt less than a player's (two rounds killed a new life in 8 s) */
  aim: Number(process.env.NPC_AIM ?? 1),
  harm: 0.55,
};

/** what one carries and wears: a gun (and how many rounds a burst is), what is on it */
const KITS: { w: string; burst: [number, number]; g: string[] }[] = [
  { w: 'ak', burst: [2, 4], g: ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack'] },
  { w: 'aks74u', burst: [2, 5], g: ['tracksuit_jacket', 'tracksuit_pants', 'trainers'] },
  { w: 'mpa', burst: [3, 5], g: ['leather_jacket', 'jeans', 'work_boots', 'beanie'] },
  { w: 'm9', burst: [1, 3], g: ['hoodie', 'jeans', 'trainers'] },
  { w: 'colt', burst: [1, 2], g: ['flannel_shirt', 'work_trousers', 'work_boots'] },
  { w: 'm9', burst: [1, 2], g: ['quilted_jacket', 'combat_trousers', 'hiking_boots', 'beanie'] },
  { w: 'ar15', burst: [2, 3], g: ['tactical_jacket', 'combat_trousers', 'hiking_boots', 'sack_pack'] },
];
const FOOD = ['beans', 'bandage', 'rags'];

type State = 'roam' | 'alert' | 'fight' | 'hunt';
interface Npc {
  id: number;
  name: string;
  pose: Pose;
  w: string;
  m: string[];
  g: string[];
  bd: number;
  vo: number;
  burst: [number, number];
  hp: number;
  alive: boolean;
  diedAt: number;
  home: { x: number; z: number; r: number };
  state: State;
  /** where it is going, and how fast */
  to: { x: number; z: number } | null;
  pace: number;
  waitUntil: number;
  vx: number;
  vz: number;
  /** who it is fighting, where it last saw them and when */
  foe: number;
  last: Vec3;
  sawAt: number;
  /** the fight: its cover (and whether it only has to stand up there to fire), where it fires from, and what it is at */
  cover: { x: number; z: number; low: boolean } | null;
  peek: { x: number; z: number } | null;
  act: 'hide' | 'out' | 'fire' | 'back' | 'open';
  until: number;
  left: number;
  nextShot: number;
  mag: number;
  /** when it may next look for cover, and when it was last hit */
  coverAt: number;
  hitAt: number;
}

/** NPC_LOG=1: what each is at said in the server's log, for a test */
const SAY = !!process.env.NPC_LOG;
let ground: Ground;
export const npcs = new Map<number, Npc>();
let nextId = NPC_FROM;
/** when each that is owed comes to the map */
const owed: number[] = [];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(l: T[]) => l[Math.floor(Math.random() * l.length)];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));
const eyeOf = (p: Pose): Vec3 => [p[0], p[1] + (p[5] & F_PRONE ? 0.35 : p[5] & F_CROUCH ? 1.0 : 1.58), p[2]];

/** whether nothing stands between two places: no hill, none of the map's walls, no base's */
function clear(a: Vec3, b: Vec3, round = false) {
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    if (world.groundAt(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t) > a[1] + (b[1] - a[1]) * t + 0.15) return false;
  }
  return solid.clear(a, b) && (round ? roundClear(a, b) : sightClear(a, b));
}

/** Made once the animals' ground is (server/index.ts). */
export function startNpcs(g: Ground) {
  ground = g;
  if (!NPC.count) return void log('[npcs] none (NPCS=0)');
  for (let k = 0; k < NPC.count; k++) owed.push(Date.now() + k * 400);
  log(`[npcs] ${NPC.count} to come`);
}

/** a place for one to come to the map: in or by a named place, in the open, with nobody near and no trader's camp */
function place(): { x: number; z: number; r: number } | null {
  const places = (world.places as { x: number; z: number; radius: number; name: string }[]).filter((q) => q.radius >= 25);
  for (let go = 0; go < 40; go++) {
    const q = pick(places), r = Math.min(90, q.radius), a = rnd(0, Math.PI * 2), d = rnd(0, r);
    const x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d;
    if (!ground.open(x, z, 0.7) || ground.roofed(x, z) || safe(x, z)) continue;
    if ([...clients.values()].some((c) => Math.hypot(c.pose[0] - x, c.pose[2] - z) < NPC.apart)) continue;
    if ([...npcs.values()].some((n) => Math.hypot(n.pose[0] - x, n.pose[2] - z) < 40)) continue;
    return { x, z, r };
  }
  return null;
}

function spawn(now: number): boolean {
  const at = place();
  if (!at) return false;
  const kit = pick(KITS), mag = ITEMS[kit.w]?.weapon?.mag;
  const n: Npc = {
    id: nextId++, name: 'Bandit', pose: [at.x, ground.height(at.x, at.z), at.z, rnd(-Math.PI, Math.PI), 0, F_GROUND],
    w: kit.w, m: mag ? [mag] : [], g: kit.g.filter((id) => ITEMS[id]), bd: Math.floor(rnd(0, 4)), vo: Math.floor(rnd(0, 4)), burst: kit.burst,
    hp: NPC.hp, alive: true, diedAt: 0, home: at, state: 'roam', to: null, pace: NPC.walk, waitUntil: now + rnd(500, 4000), vx: 0, vz: 0,
    foe: 0, last: [0, 0, 0], sawAt: 0, cover: null, peek: null, act: 'open', until: 0, left: 0, nextShot: 0, mag: 30, coverAt: 0, hitAt: 0,
  };
  npcs.set(n.id, n);
  broadcast({ t: 'join', p: infoOf(n) });
  return true;
}

const infoOf = (n: Npc): PlayerInfo => ({ id: n.id, name: n.name, pose: n.pose, w: n.w, m: n.m, g: n.g, b: [], bd: n.bd, vo: n.vo, alive: n.alive });
/** every one, as a game that has just come is told of the players already there (server/players.ts) */
export const npcInfos = (): PlayerInfo[] => [...npcs.values()].map(infoOf);

/** each one's row of 'ps', beside the players' (server/index.ts) */
export function npcRows() {
  const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
  return [...npcs.values()].map((n) => {
    const p = n.pose;
    return {
      id: n.id, x: p[0], z: p[2], hidden: false,
      json: JSON.stringify([n.id, r2(p[0]), r2(p[1]), r2(p[2]), r3(p[3]), r3(p[4]), p[5], n.alive ? n.w : null, n.m, null]),
      body: { id: n.id, x: p[0], y: p[1], z: p[2], low: (p[5] & F_CROUCH ? 1 : 0) as 0 | 1 | 2, vx: n.vx, vz: n.vz },
    };
  });
}

/** a player one may know of and shoot at: alive, there, not an admin unseen or unhurt, not at the traders' */
const fair = (c: Client | undefined): c is Client => !!c && c.alive && !c.power.hidden && !c.power.god && !away(c) && !safe(c.pose[0], c.pose[2]) && Date.now() - (c.lifeAt ?? 0) > NPC.grace;

/** whether it sees them: near enough for how they stand and where, in front of it (or it is already after them), nothing between */
function sees(n: Npc, c: Client, after: boolean) {
  const p = c.pose, d = Math.hypot(p[0] - n.pose[0], p[2] - n.pose[2]);
  let reach = after ? NPC.feels : NPC.sees;
  if (!after) {
    if (p[5] & F_PRONE) reach *= 0.4;
    else if (p[5] & F_CROUCH) reach *= 0.7;
    if (ground.cover(p[0], p[2]) > 0.55) reach *= 0.7;
    if (Math.abs(wrap(yawTo(n.pose[0], n.pose[2], p[0], p[2]) - n.pose[3])) > 1.75) reach *= d < 12 ? 1 : 0.35;
  }
  return d <= reach && clear(eyeOf(n.pose), [p[0], p[1] + (p[5] & F_PRONE ? 0.3 : 1.1), p[2]]);
}

/** a step toward where it is going, round what stands in the way; false when it is there or cannot go on */
function step(n: Npc, dt: number): boolean {
  if (!n.to) return false;
  const [x, , z] = n.pose, dx = n.to.x - x, dz = n.to.z - z, left = Math.hypot(dx, dz);
  if (left < 0.5) return false;
  const want = Math.atan2(dx, dz), far = Math.min(left, n.pace * dt);
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
    const a = want + turn, nx = x + Math.sin(a) * far, nz = z + Math.cos(a) * far, ax = x + Math.sin(a) * 0.9, az = z + Math.cos(a) * 0.9;
    if (!ground.open(nx, nz, 0.9) || !ground.open(ax, az, 0.9) || ground.roofed(ax, az) || safe(nx, nz)) continue;
    n.pose[0] = nx;
    n.pose[2] = nz;
    n.pose[1] = ground.height(nx, nz);
    n.vx = (Math.sin(a) * far) / dt;
    n.vz = (Math.cos(a) * far) / dt;
    return true;
  }
  return false;
}

const face = (n: Npc, yaw: number, dt: number, rate = 7) => {
  const d = wrap(yaw - n.pose[3]);
  n.pose[3] = wrap(n.pose[3] + Math.max(-rate * dt, Math.min(rate * dt, d)));
};
const flagsOf = (n: Npc, moving: boolean, aim: boolean, crouch: boolean) => F_GROUND | (aim ? F_AIM : 0) | (crouch ? F_CROUCH : 0) | (moving && n.pace > 3 ? F_SPRINT : 0);

/**
 * Cover from somebody at `from`: the nearest place it can walk to where nothing of it can be seen from there crouched,
 * and beside it (or at it, stood up: a low wall) a place it can fire from.
 */
function findCover(n: Npc, from: Vec3): { cover: NonNullable<Npc['cover']>; peek: NonNullable<Npc['peek']> } | null {
  const [x, , z] = n.pose;
  let best: { cover: NonNullable<Npc['cover']>; peek: NonNullable<Npc['peek']>; d: number } | null = null;
  for (const r of [2.5, 5, 8, 12, 16]) {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + r, cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      if (!ground.open(cx, cz, 0.9) || ground.roofed(cx, cz) || ground.walled(x, z, cx, cz)) continue;
      const y = ground.height(cx, cz);
      if (clear(from, [cx, y + 0.95, cz]) || clear(from, [cx, y + 0.4, cz])) continue;
      // (a low wall: hidden crouched, and over it stood up)
      if (clear([cx, y + 1.58, cz], from, true)) {
        if (!best || r < best.d) best = { cover: { x: cx, z: cz, low: true }, peek: { x: cx, z: cz }, d: r };
        continue;
      }
      // (or a corner: a step or two out of it to the side there is a line to them)
      const side = Math.atan2(from[0] - cx, from[2] - cz) + Math.PI / 2;
      for (const s of [1.4, -1.4, 2.4, -2.4]) {
        const px = cx + Math.sin(side) * s, pz = cz + Math.cos(side) * s;
        if (!ground.open(px, pz, 0.9) || ground.walled(cx, cz, px, pz)) continue;
        if (!clear([px, ground.height(px, pz) + 1.58, pz], from, true)) continue;
        if (!best || r < best.d) best = { cover: { x: cx, z: cz, low: false }, peek: { x: px, z: pz }, d: r };
        break;
      }
    }
    if (best) break;
  }
  return best && { cover: best.cover, peek: best.peek };
}

/** one round at them: heard and seen by every game near, and landing or not by how far, how they move and how they stand */
function fire(n: Npc, c: Client, now: number) {
  const rule = WEAPON_RULES[n.w], p = c.pose, o = eyeOf(n.pose);
  const aim: Vec3 = [p[0], p[1] + (p[5] & F_PRONE ? 0.3 : p[5] & F_CROUCH ? 0.8 : 1.15), p[2]];
  const d = Math.hypot(aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]);
  const tr = c.trail, a = tr && tr.length > 1 ? tr[tr.length - 2] : null, b = tr?.[tr.length - 1];
  const speed = a && b ? Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / Math.max(0.05, (b.t - a.t) / 1000) : 0;
  // (as a fair shot is: most rounds home at a room's length, one in eight at a hundred metres; less of whoever runs, crouches or lies)
  let chance = NPC.aim * (0.5 * Math.max(0.1, 1 - d / 115) + (d < 12 ? 0.15 : 0));
  if (speed > 3) chance *= 0.55;
  else if (speed > 1) chance *= 0.8;
  if (p[5] & F_PRONE) chance *= 0.55;
  else if (p[5] & F_CROUCH) chance *= 0.8;
  if (now - n.hitAt < 900) chance *= 0.6;
  const hit = Math.random() < chance && clear(o, aim, true) && !walled(n.pose, aim);
  // (a round that misses goes by them: a metre or two off at the most)
  const off = hit ? 0 : rnd(0.6, 2.2) * (Math.random() < 0.5 ? -1 : 1), side = Math.atan2(aim[0] - o[0], aim[2] - o[2]) + Math.PI / 2;
  const tx = aim[0] + Math.sin(side) * off, ty = aim[1] + (hit ? 0 : rnd(-0.3, 0.8)), tz = aim[2] + Math.cos(side) * off;
  const len = Math.max(0.001, Math.hypot(tx - o[0], ty - o[1], tz - o[2]));
  broadcastNear({ t: 'shot', id: n.id, o: [o[0], o[1] - 0.12, o[2]], d: [(tx - o[0]) / len, (ty - o[1]) / len, (tz - o[2]) / len], w: n.w, sup: false }, o[0], o[2], 700);
  n.mag--;
  if (!hit || !rule) return;
  const roll = Math.random(), zone: HitZone = roll < 0.07 ? 'head' : roll < 0.7 ? 'torso' : roll < 0.88 ? 'legs' : 'arms';
  const amount = hitDamage(n.w, zone, d) * NPC.harm;
  if (amount <= 0) return;
  // (never `lastHitBy`: see the head of this file)
  if (SAY) log(`[npc ${n.id}] hit ${c.name} ${zone} ${amount.toFixed(0)} at ${Math.round(d)} m`);
  dealt(c, amount, zone, n.w);
  const flat = Math.max(0.001, Math.hypot(p[0] - o[0], p[2] - o[2]));
  send(c, { t: 'dmg', from: n.id, amount, zone, w: n.w, dir: [(p[0] - o[0]) / flat, 0, (p[2] - o[2]) / flat] });
}

/** after them: where they were, and from now */
function onTo(n: Npc, c: Client, now: number) {
  if (n.state !== 'fight' || n.foe !== c.id) {
    n.state = 'fight';
    n.foe = c.id;
    n.act = 'open';
    n.cover = n.peek = null;
    n.coverAt = 0;
    if (SAY) log(`[npc ${n.id}] after ${c.name} at ${Math.round(Math.hypot(c.pose[0] - n.pose[0], c.pose[2] - n.pose[2]))} m`);
    // (a moment to take them in before the first round)
    n.nextShot = now + rnd(550, 1000);
    n.left = 0;
  }
  n.last = [c.pose[0], c.pose[1], c.pose[2]];
  n.sawAt = now;
}

function fight(n: Npc, now: number, dt: number) {
  const c = clients.get(n.foe);
  if (!fair(c)) return void calm(n, now);
  const seen = sees(n, c, true);
  if (seen) {
    n.last = [c.pose[0], c.pose[1], c.pose[2]];
    n.sawAt = now;
  } else if (now - n.sawAt > 7000) {
    // (lost: to where they were last, at a run, and a look about there)
    n.state = 'hunt';
    n.to = { x: n.last[0], z: n.last[2] };
    n.pace = NPC.run;
    n.until = now + 16000;
    return;
  }
  const foeAt: Vec3 = [n.last[0], n.last[1] + 1.4, n.last[2]], dist = Math.hypot(n.last[0] - n.pose[0], n.last[2] - n.pose[2]);
  const toFoe = yawTo(n.pose[0], n.pose[2], n.last[0], n.last[2]);
  // (cover looked for once it is in a fight, again when what it has no longer hides it, or it has none and is hit)
  if (now >= n.coverAt && (!n.cover || (n.act === 'hide' && clear(foeAt, [n.cover.x, ground.height(n.cover.x, n.cover.z) + 0.95, n.cover.z])))) {
    n.coverAt = now + 2500;
    const found = findCover(n, foeAt);
    if (SAY) log(`[npc ${n.id}] cover ${found ? `${found.cover.low ? 'low' : 'corner'} ${Math.round(Math.hypot(found.cover.x - n.pose[0], found.cover.z - n.pose[2]))} m off` : 'none'}`);
    n.cover = found?.cover ?? null;
    n.peek = found?.peek ?? null;
    if (found) {
      n.act = 'back';
      n.to = { x: found.cover.x, z: found.cover.z };
      n.pace = NPC.run;
    } else if (n.act !== 'fire') n.act = 'open';
  }
  const shoot = () => {
    if (now < n.nextShot) return;
    if (n.mag <= 0) {
      // (a magazine out: behind cover, or where it stands, for as long as a new one takes)
      n.mag = 30;
      n.left = 0;
      n.nextShot = now + 2600;
      return;
    }
    if (n.left <= 0) n.left = Math.round(rnd(n.burst[0], n.burst[1]));
    if (seen) fire(n, c, now);
    n.left--;
    n.nextShot = now + Math.max(120, (WEAPON_RULES[n.w]?.interval ?? 0.2) * 1000 * rnd(1.1, 1.6)) + (n.left <= 0 ? rnd(700, 1500) : 0);
  };
  if (!n.cover) {
    // (in the open: a step aside between bursts, down on a knee as often as not, on toward them when they are far)
    const moving = !!n.to && step(n, dt);
    if (!moving) {
      n.to = null;
      n.vx = n.vz = 0;
      face(n, toFoe, dt);
      n.pose[4] = Math.atan2(n.last[1] + 1.1 - (n.pose[1] + 1.5), Math.max(1, dist));
      shoot();
      if (now > n.until && n.left <= 0) {
        n.until = now + rnd(1800, 3800);
        const side = toFoe + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 + (dist > 70 ? 0.9 : 0), far = rnd(3, 6);
        n.to = { x: n.pose[0] - Math.sin(side) * far, z: n.pose[2] - Math.cos(side) * far };
        n.pace = NPC.run;
        n.act = Math.random() < 0.5 ? 'open' : 'hide';
      }
    } else face(n, Math.atan2(-n.vx, -n.vz), dt, 10);
    n.pose[5] = flagsOf(n, moving, !moving, !moving && n.act === 'hide');
    return;
  }
  // (from cover: behind it; out, or up; a burst; back)
  if (n.act === 'back' || n.act === 'out') {
    const moving = step(n, dt);
    if (moving) {
      face(n, Math.atan2(-n.vx, -n.vz), dt, 10);
      n.pose[5] = flagsOf(n, true, false, false);
      return;
    }
    n.to = null;
    n.vx = n.vz = 0;
    if (n.act === 'back') {
      n.act = 'hide';
      n.until = now + rnd(1200, 3200) + (n.mag <= 0 ? 2200 : 0);
      if (n.mag <= 0) n.mag = 30;
    } else {
      n.act = 'fire';
      n.left = 0;
      n.nextShot = now + rnd(300, 600);
      n.until = now + rnd(2200, 4200);
    }
  }
  face(n, toFoe, dt);
  n.pose[4] = Math.atan2(n.last[1] + 1.1 - (n.pose[1] + 1.5), Math.max(1, dist));
  if (n.act === 'hide') {
    n.pose[5] = flagsOf(n, false, false, true);
    if (now > n.until) {
      if (n.cover.low) {
        n.act = 'fire';
        n.left = 0;
        n.nextShot = now + rnd(350, 650);
        n.until = now + rnd(2000, 3800);
      } else if (n.peek) {
        n.act = 'out';
        n.to = { x: n.peek.x, z: n.peek.z };
        n.pace = NPC.walk * 1.6;
      }
    }
    return;
  }
  // (firing: stood, sights up; done with the burst or hit, down or back again)
  n.pose[5] = flagsOf(n, false, true, false);
  shoot();
  if ((now > n.until && n.left <= 0) || n.mag <= 0 || now - n.hitAt < 250) {
    if (n.cover.low) {
      n.act = 'hide';
      n.until = now + rnd(1000, 2800) + (n.mag <= 0 ? 2200 : 0);
      if (n.mag <= 0) n.mag = 30;
    } else {
      n.act = 'back';
      n.to = { x: n.cover.x, z: n.cover.z };
      n.pace = NPC.run;
    }
  }
}

function calm(n: Npc, now: number) {
  n.state = 'roam';
  n.foe = 0;
  n.to = null;
  n.cover = n.peek = null;
  n.pace = NPC.walk;
  n.waitUntil = now + rnd(2000, 6000);
  n.pose[4] = 0;
  n.pose[5] = F_GROUND;
}

/** Ten times a second: those near anybody think and move; the dead are cleared away, and the owed come. */
export function npcsTick(now: number, dt: number) {
  // (one that finds no place now tries again in a while: with somebody at every place, say)
  for (let k = owed.length - 1; k >= 0; k--) {
    if (now < owed[k]) continue;
    if (spawn(now)) owed.splice(k, 1);
    else owed[k] = now + 5000;
  }
  const people = [...clients.values()].filter((c) => c.alive);
  for (const n of [...npcs.values()]) {
    if (!n.alive) {
      if (now - n.diedAt > 20000) {
        npcs.delete(n.id);
        broadcast({ t: 'leave', id: n.id });
        owed.push(now + rnd(NPC.back[0], NPC.back[1]) * 1000);
      }
      continue;
    }
    if (!people.some((c) => Math.hypot(c.pose[0] - n.pose[0], c.pose[2] - n.pose[2]) < NPC.near)) {
      if (n.state !== 'roam') calm(n, now);
      n.vx = n.vz = 0;
      continue;
    }
    // (whoever it sees, the nearest: it is after them)
    if (n.state !== 'fight') {
      let best: Client | null = null, bd = Infinity;
      for (const c of people) {
        if (!fair(c)) continue;
        const d = Math.hypot(c.pose[0] - n.pose[0], c.pose[2] - n.pose[2]);
        if (d < bd && sees(n, c, n.state !== 'roam')) (best = c), (bd = d);
      }
      if (best) onTo(n, best, now);
    }
    if (n.state === 'fight') {
      fight(n, now, dt);
      continue;
    }
    if (n.state === 'alert' || n.state === 'hunt') {
      // (toward what it heard or where they were, sights up, and a look about when it is there)
      const moving = step(n, dt);
      if (moving) face(n, Math.atan2(-n.vx, -n.vz), dt, 10);
      else {
        n.to = null;
        n.vx = n.vz = 0;
        face(n, n.pose[3] + 1.1, dt, 1.4);
      }
      n.pose[5] = flagsOf(n, moving, !moving, n.state === 'alert' && !moving);
      if (now > n.until) calm(n, now);
      continue;
    }
    // (about its place: to somewhere near, a stand, and on)
    if (!n.to && now > n.waitUntil) {
      for (let go = 0; go < 6 && !n.to; go++) {
        const a = rnd(0, Math.PI * 2), d = rnd(8, Math.max(20, n.home.r)), x = n.home.x + Math.cos(a) * d, z = n.home.z + Math.sin(a) * d;
        if (ground.open(x, z, 0.7) && !ground.roofed(x, z) && !safe(x, z)) n.to = { x, z };
      }
      n.pace = NPC.walk;
      n.until = now + 40000;
    }
    const moving = !!n.to && step(n, dt);
    if (moving) face(n, Math.atan2(-n.vx, -n.vz), dt, 6);
    else if (n.to || now > n.until) {
      n.to = null;
      n.vx = n.vz = 0;
      n.waitUntil = now + rnd(3000, 12000);
      n.until = Infinity;
    }
    n.pose[5] = flagsOf(n, moving, false, false);
  }
}

/** A shot fired by a player: every one within its carry turns to it, takes what cover there is, and goes to see. */
export function npcsHear(x: number, z: number, range: [number, number], by: Client) {
  const now = Date.now();
  for (const n of npcs.values()) {
    if (!n.alive || n.state === 'fight') continue;
    const d = Math.hypot(n.pose[0] - x, n.pose[2] - z);
    if (d > Math.min(range[1], 450) || !fair(by)) continue;
    n.state = 'alert';
    n.until = now + rnd(14000, 24000);
    n.pace = NPC.run;
    // (some of the way toward it: far enough to see who it was, not into their sights)
    const k = Math.max(0, Math.min(1, (d - 45) / d));
    n.to = { x: n.pose[0] + (x - n.pose[0]) * k, z: n.pose[2] + (z - n.pose[2]) * k };
    n.pose[3] = yawTo(n.pose[0], n.pose[2], x, z);
  }
}

/** A player's hit on one ('hit' in server/handle.ts, where the one it names is no player): judged as a hit on a player is, in short. */
export function npcHit(c: Client, m: Extract<C2S, { t: 'hit' }>) {
  const n = npcs.get(m.to), rule = WEAPON_RULES[m.w];
  if (!n || !n.alive || !c.alive || !rule) return;
  if (!['head', 'torso', 'legs', 'arms'].includes(m.zone)) return;
  const now = Date.now(), d = Math.hypot(c.pose[0] - n.pose[0], c.pose[1] - n.pose[1], c.pose[2] - n.pose[2]);
  if (d > rule.range + 4 || safe(c.pose[0], c.pose[2])) return;
  let amount: number;
  if (rule.blast || m.w === 'barrel' || m.w === 'jeep') {
    // (a blast or a car: as far off as their game says, no more often than one could be)
    if (!num(m.dist) || !mayHit(c, `n${n.id}`, now, 400)) return;
    amount = m.w === 'jeep' ? Math.max(0, Math.min(m.dist, 40) - 4) * 6 : hitDamage(m.w, 'torso', Math.max(0, m.dist));
  } else {
    if (m.w !== 'fists' && c.w !== m.w) return;
    if (!mayHit(c, `n${n.id}`, now, rule.interval * 700)) return;
    if (walled(c.pose, zoneAt(n.pose, m.zone)) || (!rule.melee && !clear(eyeOf(c.pose), zoneAt(n.pose, m.zone), true))) return;
    amount = hitDamage(m.w, m.zone as HitZone, d, !!m.sup, num(m.bonus) ? m.bonus : 0, num(m.n) ? m.n : 1) * piercedBy(m.w, m.p);
  }
  if (amount <= 0) return;
  n.hp -= amount;
  n.hitAt = now;
  send(c, { t: 'hitok', to: n.id, amount, zone: m.zone });
  if (n.hp > 0) return void (fair(c) && onTo(n, c, now));
  // (down: its body where it fell with what it had, searched as any body is, and no tag in it)
  n.alive = false;
  n.diedAt = now;
  n.vx = n.vz = 0;
  n.pose[5] = F_GROUND | F_DEAD;
  const len = Math.max(0.001, Math.hypot(n.pose[0] - c.pose[0], n.pose[2] - c.pose[2]));
  const way = fellWay(n.pose[3], [(n.pose[0] - c.pose[0]) / len, (n.pose[2] - c.pose[2]) / len]);
  const uid = `nbody_${n.id}`, box = new Container(uid, 'Body', BODY_GRID[0], BODY_GRID[1], [], true);
  const gun = stockGun(makeItem(n.w), 0);
  if (ITEMS[n.w]?.weapon?.mag) gun.mag = ITEMS[n.w].weapon!.mag!;
  stockGun(gun, Math.round(rnd(4, 22)));
  for (const it of [gun, makeItem(pick(FOOD)), ...(Math.random() < 0.5 ? [makeItem(pick(FOOD))] : [])]) box.add(it);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const body = { cid: uid, kind: 'corpse' as const, w: BODY_GRID[0], h: BODY_GRID[1], items: box.serialize().items, x: r2(n.pose[0]), y: r2(n.pose[1]), z: r2(n.pose[2]), rot: Math.round(n.pose[3] * 1000) / 1000, emptiedAt: -1, name: n.name, expires: economy.time + NPC.lies, v: way, bd: n.bd };
  for (const it of body.items) issue(it);
  boxes.set(uid, body as never);
  const k: KillInfo = { id: n.id, name: n.name, by: c.id, byName: c.name, w: m.w, zone: m.zone, dist: Math.round(d), v: way };
  broadcast({ t: 'death', k, corpse: bodyInfo(body) } as S2C);
  log(`${c.name} killed a ${n.name} (${m.w}, ${Math.round(d)} m)`);
}
