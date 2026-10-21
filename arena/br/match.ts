// The battle royale's server (2026-10-21): lobbies, the vote, the plane, the circle, the loot, the fights, knock and
// revive, the winner and the board. It runs in the arena's service (arena/server.ts; the owner: "if we can put this on
// the same server as arena for now that would be great"), at /arena?w=br, and speaks the game's own protocol as the
// Arena does, with the battle royale's own words beside it (./wire.ts).
//
// As in the Arena, THE SERVER DECIDES EVERY HIT AND EVERY HEALTH POINT: a game says where it is and where it shot; the
// server traces the shot itself (the ground, and the others as they stood when it was fired) and holds every health,
// knock, slot and round. What it does not have yet is the buildings' walls (docs/BATTLE-ROYALE.md, P4's solids): until
// then a shot is stopped by the ground alone.
import RAPIER from '@dimforge/rapier3d-compat';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { hitShapes, rayRod } from '../rules';
import { WEAPON_RULES, hitDamage } from '../../src/sim/combat';
import { shotOf } from '../../src/sim/gunplay';
import { ITEMS, makeItem, type ItemInstance } from '../../src/sim/items';
import { F_CROUCH, F_DEAD, F_PRONE, PROTOCOL, type Pose, type S2C } from '../../src/net/protocol';
import { groundField, heightAt, type World } from '../../src/world/worldgen';
import { AMMO, BR, FLIGHT, HEALS, MAPS, MELEE, PHASES, TEAM, capOf, circleAt, firstCircle, inMap, kindOf, modeOfSize, nextCircle, type BrMode, type Circle, type Ground, type SlotItem } from './rules';
import { brSpots, groundId, rollMatch, rollWait, type Spot } from './loot';
import type { BrS2C, Mate, Phase } from './wire';
import { JEEP, SEATS, jeepSpots, restState, westSpots, type VState, type VehicleInfo } from '../../src/sim/vehicles';

interface P {
  id: number;
  ws: WebSocket;
  name: string;
  key: string;
  pose: Pose;
  hist: { t: number; p: Pose }[];
  w: string | null;
  m: string[];
  g: string[];
  rtt: number;
  pingAt: number;
  gone: number;
  team: number;
  hp: number;
  /** knocked: on the ground with `kn` of their own to bleed out */
  knocked: boolean;
  kn: number;
  alive: boolean;
  /** this match's place once their team is out (0: still in) */
  place: number;
  slots: SlotItem[];
  vest: string | null;
  helmet: string | null;
  pack: string | null;
  pools: Record<string, number>;
  using: { slot: number; until: number } | null;
  /** getting a teammate up: who, and when it is done */
  rev: { id: number; until: number } | null;
  voted: boolean;
  jumped: boolean;
  kills: number;
  knocks: number;
  revives: number;
  dmg: number;
  longest: number;
  born: number;
  shots: number[];
}

interface Lobby {
  id: string;
  code: string;
  private: boolean;
  mode: BrMode;
  map: number;
  state: Phase;
  ps: P[];
  ground: Map<number, Ground>;
  doors: Map<number, [boolean, number]>;
  /** the count's end, once the vote has passed */
  at: number;
  plane: { a: [number, number]; b: [number, number]; y: number; t0: number; speed: number; end: number } | null;
  zone: { a: Circle; b: Circle; t0: number; t1: number; phase: number; dmg: number } | null;
  opened: number;
  relaid: number;
  gas: number;
  winners: string[];
  /** the jeeps of the match (decision 6: "yes jeeps, no helis"), each moved by its driver's game as in the open world */
  veh: Map<number, VehicleInfo>;
}

const lobbies = new Map<string, Lobby>();
let world: World;
let spots: Spot[] = [];
let phys: RAPIER.World | null = null;
let nextId = 1;
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} [br] ${s}`);
const rnd = Math.random;

// ------------------------------------------------------------------------------------------------- the board
// Per player key, since this server started (decision 8: "a battle royale leaderboard of wins and kills, and anything
// else that might be useful in the future"), and every match's result as a row, for ranks and seasons later.
interface Stat { name: string; matches: number; wins: number; top5: number; kills: number; knocks: number; revives: number; dmg: number; longest: number; alive: number; best: number }
const board = new Map<string, Stat>();
const results: { at: number; mode: BrMode; map: string; players: number; places: { name: string; place: number; kills: number }[] }[] = [];
function statOf(p: P): Stat {
  let s = board.get(p.key);
  if (!s) board.set(p.key, (s = { name: p.name, matches: 0, wins: 0, top5: 0, kills: 0, knocks: 0, revives: 0, dmg: 0, longest: 0, alive: 0, best: 0 }));
  s.name = p.name;
  return s;
}

// ------------------------------------------------------------------------------------------------- talking
const send = (p: P, m: S2C | ({ t: 'br' } & BrS2C)) => {
  if (!p.gone && p.ws.readyState === 1) p.ws.send(JSON.stringify(m));
};
const br = (p: P, m: BrS2C) => send(p, { t: 'br', ...m });
const all = (l: Lobby, m: S2C | ({ t: 'br' } & BrS2C), but?: P) => l.ps.forEach((p) => p !== but && send(p, m));
const tellAll = (l: Lobby, text: string, kind: 'good' | 'warn' | 'info' = 'info') => all(l, { t: 'tell', text, kind });
const info = (p: P) => ({ id: p.id, name: p.name, pose: p.pose, w: p.w, m: p.m, g: p.g, alive: p.alive });
const inMatch = (l: Lobby) => l.state === 'plane' || l.state === 'live';
const mates = (l: Lobby, p: P) => l.ps.filter((o) => o.team === p.team && o !== p && inMatch(l));
const foes = (l: Lobby, a: P, b: P) => a !== b && (!inMatch(l) || a.team !== b.team);
const teamsIn = (l: Lobby) => new Set(l.ps.filter((p) => p.alive).map((p) => p.team)).size;

function me(l: Lobby, p: P) {
  const now = Date.now(), r = p.rev ?? l.ps.find((o) => o.rev?.id === p.id)?.rev ?? null;
  const reviver = l.ps.find((o) => o.rev?.id === p.id);
  const ms: Mate[] = mates(l, p).map((o) => ({ id: o.id, name: o.name, hp: Math.round(o.knocked ? o.kn : o.hp), knocked: o.knocked, alive: o.alive }));
  br(p, { k: 'me', slots: p.slots, vest: p.vest, helmet: p.helmet, pack: p.pack, pools: p.pools, hp: Math.round(p.hp), knocked: p.knocked, kn: Math.round(p.kn), mates: ms, using: p.using, rev: r ? { id: p.rev ? p.rev.id : reviver!.id, until: r.until, me: !!p.rev } : null, now });
}
const meTeam = (l: Lobby, p: P) => l.ps.filter((o) => o.team === p.team).forEach((o) => me(l, o));

function lobbyTo(l: Lobby) {
  const now = Date.now(), have = l.ps.length;
  for (const p of l.ps) br(p, { k: 'lobby', id: l.id, code: l.code, mode: l.mode, map: l.map, have, votes: l.ps.filter((o) => o.voted).length, need: Math.max(BR.min, BR.votes(have)), voted: p.voted, at: l.at, now, max: BR.max });
}

function stateTo(l: Lobby, only?: P) {
  const m: BrS2C = { k: 'state', phase: l.state, alive: l.ps.filter((p) => p.alive).length, teams: teamsIn(l), kills: 0, map: l.map, mode: l.mode };
  for (const p of only ? [only] : l.ps) br(p, { ...m, kills: p.kills } as BrS2C);
}

// ------------------------------------------------------------------------------------------------- the ground and walls
async function buildWorld() {
  await RAPIER.init();
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const f = groundField(world.heights);
  w.createCollider(RAPIER.ColliderDesc.heightfield(f.rows, f.cols, f.heights, f.scale).setTranslation(f.at.x, f.at.y, f.at.z));
  w.step();
  phys = w;
}
function wallAt(o: number[], d: number[], most: number): number {
  if (!phys) return Infinity;
  const hit = phys.castRay(new RAPIER.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] }), most, true);
  return hit ? hit.timeOfImpact : Infinity;
}
function poseAt(p: P, at: number): Pose {
  for (let i = p.hist.length - 1; i >= 0; i--) if (p.hist[i].t <= at) return p.hist[i].p;
  return p.hist[0]?.p ?? p.pose;
}
const ground = (x: number, z: number) => heightAt(world.surface, x, z);

// ------------------------------------------------------------------------------------------------- setting people down
/** a melee weapon of their own, picked at random: every one hits alike */
const starter = (): SlotItem[] => [makeItem(MELEE[Math.floor(rnd() * MELEE.length)]), null, null, null, null, null];

function fresh(p: P) {
  p.hp = 100;
  p.knocked = false;
  p.kn = 0;
  p.alive = true;
  p.slots = starter();
  p.vest = p.helmet = p.pack = null;
  p.pools = {};
  p.using = null;
  p.rev = null;
}

/** in the waiting area, somewhere in its ring, whole and with only their melee weapon */
function toWait(l: Lobby, p: P) {
  const w = MAPS[l.map].wait, a = rnd() * Math.PI * 2, d = w.r * 0.8 * Math.sqrt(rnd()), x = w.x + Math.cos(a) * d, z = w.z + Math.sin(a) * d, y = ground(x, z) + 0.1;
  fresh(p);
  p.pose = [x, y, z, rnd() * 6.28, 0, 0];
  p.hist = [{ t: Date.now(), p: p.pose }];
  send(p, { t: 'powers', god: false, hidden: false, clip: false, voidInv: false, voidTag: false, bottomless: true });
  send(p, { t: 'put', x, y, z, yaw: p.pose[3] });
  send(p, { t: 'mend' } as S2C);
  send(p, { t: 'hp', health: 100, bleeding: false });
  me(l, p);
}

function welcome(l: Lobby, p: P) {
  const sp = p.pose;
  send(p, {
    t: 'welcome', v: PROTOCOL, you: p.id, players: l.ps.filter((o) => o !== p && !o.gone).map(info),
    loot: [], doors: [...l.doors.entries()].map(([i, [o, s]]) => [i, o, s]), stashes: [], corpses: [], drops: [], flights: [], barrels: [], fires: [], bunker: false, ajar: [], vehicles: [...l.veh.values()], infected: [],
    // (always day: a match by night is a match nobody can see, and every match is the same length of the same day)
    hour: 0.3, spawn: { x: sp[0], z: sp[2], yaw: sp[3], y: sp[1] }, me: null, max: BR.max,
  } as unknown as S2C);
  br(p, { k: 'loot', add: [...l.ground.values()], gone: [], all: true });
}

// ------------------------------------------------------------------------------------------------- the match
function startCount(l: Lobby) {
  l.state = 'count';
  l.at = Date.now() + BR.countdown * 1000;
  lobbyTo(l);
  tellAll(l, `The vote is in: the plane in ${BR.countdown} seconds.`, 'good');
}

function startMatch(l: Lobby) {
  const m = MAPS[l.map], size = TEAM[l.mode];
  // teams in the order people came in: a party that came in together is together
  l.ps.forEach((p, k) => {
    p.team = Math.floor(k / size) + 1;
    fresh(p);
    Object.assign(p, { kills: 0, knocks: 0, revives: 0, dmg: 0, longest: 0, place: 0, jumped: false, voted: false, born: Date.now() });
    statOf(p).matches++;
  });
  l.ground.clear();
  for (const g of rollMatch(world, spots, l.map, rnd)) l.ground.set(g.id, g);
  l.doors.clear();
  // jeeps where the open world parks them, those on this map; six at most
  l.veh.clear();
  const parks = [...jeepSpots(world), ...westSpots(world)].filter((s) => inMap(m, s.x, s.z, -20)).sort(() => rnd() - 0.5).slice(0, 6);
  parks.forEach((s, k) => l.veh.set(k + 1, { i: k + 1, s: restState(s.x, s.y, s.z, s.yaw), hp: JEEP.hp, fuel: JEEP.tank, seats: Array(SEATS).fill(null), sim: null }));
  // the plane: across the map at a random angle, through somewhere near its middle
  const cx = (m.x0 + m.x1) / 2 + (rnd() - 0.5) * (m.x1 - m.x0) * 0.4, cz = (m.z0 + m.z1) / 2 + (rnd() - 0.5) * (m.z1 - m.z0) * 0.4;
  const ang = rnd() * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang), L = Math.hypot(m.x1 - m.x0, m.z1 - m.z0) / 2 + FLIGHT.speed * FLIGHT.lead;
  let top = -1e9;
  for (let x = m.x0; x <= m.x1; x += 24) for (let z = m.z0; z <= m.z1; z += 24) top = Math.max(top, ground(x, z));
  const now = Date.now(), t0 = now + 2500;
  const a: [number, number] = [cx - dx * L, cz - dz * L], b: [number, number] = [cx + dx * L, cz + dz * L];
  // (everybody is out by the time it is over the far edge)
  const end = t0 + ((2 * L - FLIGHT.speed * FLIGHT.lead) / FLIGHT.speed) * 1000;
  l.plane = { a, b, y: top + FLIGHT.over, t0, speed: FLIGHT.speed, end };
  const first = firstCircle(m), ph = PHASES[0];
  const t1 = end + ph.wait * 1000;
  l.zone = { a: first, b: nextCircle(world, m, first, ph.r, rnd), t0: t1, t1: t1 + ph.shrink * 1000, phase: 0, dmg: 0 };
  l.state = 'plane';
  for (const p of l.ps) {
    p.pose = [a[0], l.plane.y, a[1], 0, 0, 0];
    p.hist = [{ t: now, p: p.pose }];
    send(p, { t: 'powers', god: false, hidden: false, clip: false, voidInv: false, voidTag: false, bottomless: true });
    send(p, { t: 'hp', health: 100, bleeding: false });
    br(p, { k: 'loot', add: [...l.ground.values()], gone: [], all: true });
    br(p, { k: 'plane', ...l.plane, now });
    br(p, { k: 'zone', ...l.zone, now });
    for (const v of l.veh.values()) send(p, { t: 'v+', v });
    me(l, p);
  }
  stateTo(l);
  log(`${l.id}: ${l.ps.length} in a ${l.mode} match on ${m.name}, ${l.ground.size} things on the ground`);
}

/** the circle moved on: the next phase's shrink, and its gas */
function nextPhase(l: Lobby) {
  const z = l.zone!, i = z.phase + 1, m = MAPS[l.map];
  if (i >= PHASES.length) return;
  const ph = PHASES[i];
  l.zone = { a: z.b, b: nextCircle(world, m, z.b, ph.r, rnd), t0: z.t1 + ph.wait * 1000, t1: z.t1 + (ph.wait + ph.shrink) * 1000, phase: i, dmg: PHASES[i - 1].dmg };
  const now = Date.now();
  for (const p of l.ps) br(p, { k: 'zone', ...l.zone, now });
}

/** What a fallen player carried lies where they fell, spread a little (Fortnite's spill). */
function spill(l: Lobby, p: P) {
  const add: Ground[] = [];
  const put = (g: Omit<Ground, 'id' | 'x' | 'y' | 'z'>) => {
    const a = add.length * 1.3, d = 0.5 + add.length * 0.12, x = p.pose[0] + Math.cos(a) * d, z = p.pose[2] + Math.sin(a) * d;
    add.push({ id: groundId(), x, y: Math.max(ground(x, z), p.pose[1] - 0.2) + 0.02, z, ...g });
  };
  for (const it of p.slots) if (it && kindOf(it.id) !== 'melee') put({ item: it });
  for (const id of [p.vest, p.helmet, p.pack]) if (id) put({ item: makeItem(id) });
  for (const [a, n] of Object.entries(p.pools)) if (n > 0) put({ ammo: a, n });
  p.slots = [null, null, null, null, null, null];
  p.vest = p.helmet = p.pack = null;
  p.pools = {};
  for (const g of add) l.ground.set(g.id, g);
  if (add.length) all(l, { t: 'br', k: 'loot', add, gone: [] });
}

/** out of the match: dead, their things on the ground, watching from the air */
function eliminate(l: Lobby, v: P, by: P | null, w: string, head: boolean) {
  if (!v.alive) return;
  unseat(l, v);
  v.alive = false;
  v.knocked = false;
  v.rev = null;
  v.using = null;
  for (const o of l.ps) if (o.rev?.id === v.id) o.rev = null;
  v.pose = [v.pose[0], v.pose[1], v.pose[2], v.pose[3], v.pose[4], v.pose[5] | F_DEAD];
  v.hist.push({ t: Date.now(), p: v.pose });
  spill(l, v);
  if (by && by !== v) {
    by.kills++;
    statOf(by).kills++;
  }
  for (const o of l.ps) send(o, { t: 'kill', by: by?.name ?? 'the gas', who: v.name, w, head, ours: o.team === (by?.team ?? -1), me: o === by || o === v });
  send(v, { t: 'powers', god: true, hidden: true, clip: true, voidInv: false, voidTag: false, bottomless: true });
  me(l, v);
  teamCheck(l, v, by);
}

/** a team with nobody standing is out: its knocked go with it, and its place is given */
function teamCheck(l: Lobby, v: P, by: P | null) {
  const team = l.ps.filter((o) => o.team === v.team);
  if (team.some((o) => o.alive && !o.knocked)) return void stateTo(l);
  for (const o of team) if (o.alive) eliminate(l, o, by, 'bleeding', false);
  const place = teamsIn(l) + 1;
  for (const o of team) {
    if (o.place) continue;
    o.place = place;
    const s = statOf(o);
    s.alive += (Date.now() - o.born) / 1000;
    s.best = s.best ? Math.min(s.best, place) : place;
    if (place <= 5) s.top5++;
    br(o, { k: 'out', place, kills: o.kills, dmg: Math.round(o.dmg), by: by?.name ?? null });
  }
  stateTo(l);
  if (teamsIn(l) <= 1) over(l);
}

function over(l: Lobby) {
  if (l.state === 'over') return;
  l.state = 'over';
  const win = l.ps.filter((p) => p.alive);
  for (const p of win) {
    p.place = 1;
    const s = statOf(p);
    s.wins++;
    s.top5++;
    s.best = 1;
    s.alive += (Date.now() - p.born) / 1000;
    send(p, { t: 'powers', god: true, hidden: false, clip: false, voidInv: false, voidTag: false, bottomless: true });
  }
  l.winners = win.map((p) => p.name);
  const rows = l.ps.map((p) => ({ name: p.name, place: p.place || 1, kills: p.kills, dmg: Math.round(p.dmg) })).sort((a, b) => a.place - b.place || b.kills - a.kills);
  for (const p of l.ps) br(p, { k: 'over', winners: l.winners, board: rows });
  results.push({ at: Date.now(), mode: l.mode, map: MAPS[l.map].id, players: l.ps.length, places: rows.map((r) => ({ name: r.name, place: r.place, kills: r.kills })) });
  if (results.length > 200) results.shift();
  stateTo(l);
  log(`${l.id}: won by ${l.winners.join(' & ') || 'nobody'}`);
  setTimeout(() => {
    for (const p of l.ps) if (p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({ t: 'kick', reason: 'The match is over.' }));
      p.ws.close();
    }
    lobbies.delete(l.id);
  }, BR.endFor * 1000);
}

/** health taken off (armour already reckoned): a knock, or out */
function hurt(l: Lobby, v: P, by: P | null, amount: number, w: string, head: boolean) {
  if (!v.alive || amount <= 0 || l.state === 'over') return;
  if (by && by !== v) {
    by.dmg += amount;
    statOf(by).dmg += amount;
  }
  if (v.knocked) {
    v.kn -= amount;
    if (v.kn <= 0) return eliminate(l, v, by, w, head);
    send(v, { t: 'hp', health: Math.max(1, v.kn), bleeding: true });
    return meTeam(l, v);
  }
  v.hp -= amount;
  if (v.hp > 0) {
    send(v, { t: 'hp', health: v.hp, bleeding: false });
    return me(l, v);
  }
  if (!inMatch(l)) {
    // (the waiting area: down and straight back up, somewhere else in it, with nothing; as PUBG's island)
    if (by && by !== v) for (const o of l.ps) send(o, { t: 'kill', by: by.name, who: v.name, w, head, ours: false, me: o === by || o === v });
    return toWait(l, v);
  }
  // with a teammate standing, knocked (decision 5); alone, out
  if (l.mode !== 'solo' && mates(l, v).some((o) => o.alive && !o.knocked)) {
    v.hp = 0;
    v.knocked = true;
    v.kn = BR.knockHp;
    v.using = null;
    v.rev = null;
    if (by && by !== v) {
      by.knocks++;
      statOf(by).knocks++;
    }
    for (const o of l.ps) send(o, { t: 'tell', text: `${by?.name ?? 'The gas'} knocked ${v.name} down`, kind: o.team === v.team ? 'warn' : 'info' });
    send(v, { t: 'hp', health: BR.knockHp, bleeding: true });
    return meTeam(l, v);
  }
  eliminate(l, v, by, w, head);
}

/** what armour leaves of a hit to a zone */
function armoured(v: P, zone: string, dmg: number) {
  if (zone === 'head' && v.helmet) return dmg * (ITEMS[v.helmet]?.wear?.head ?? 1);
  if (zone === 'torso' && v.vest) return dmg * (ITEMS[v.vest]?.wear?.armor ?? 1);
  return dmg;
}

const holds = (p: P, w: string) => p.slots.some((s) => s?.id === w);

function shot(l: Lobby, me: P, m: { o: unknown; d: unknown; w: unknown; sup?: unknown }) {
  if (!me.alive || me.knocked || typeof m.w !== 'string' || l.state === 'plane' && !me.jumped) return;
  const rule = WEAPON_RULES[m.w];
  const o = m.o as number[], d0 = m.d as number[];
  if (!rule || !holds(me, m.w) || !Array.isArray(o) || !Array.isArray(d0) || o.length !== 3 || d0.length !== 3 || ![...o, ...d0].every(Number.isFinite)) return;
  const now = Date.now();
  me.shots = me.shots.filter((t) => now - t < rule.interval * 1000 * 0.85);
  if (me.shots.length) return;
  me.shots.push(now);
  if (Math.hypot(o[0] - me.pose[0], o[2] - me.pose[2]) > 2.5 || Math.abs(o[1] - me.pose[1] - 1.3) > 1.8) return;
  const len = Math.hypot(d0[0], d0[1], d0[2]);
  if (len < 1e-6) return;
  const d = d0.map((v) => v / len);
  for (const f of l.ps) if (f !== me) send(f, { t: 'shot', id: me.id, o: o as [number, number, number], d: d as [number, number, number], w: m.w, sup: !!m.sup });
  if (l.state === 'over') return;
  const most = Math.max(rule.range * 2, 150);
  const back = now - Math.min(400, me.rtt / 2 + 140);
  const them = l.ps.filter((f) => f.alive && !f.gone && foes(l, me, f)).map((f) => ({ f, shapes: hitShapes(poseAt(f, back)) }));
  const { pellets, cone } = shotOf(m.w);
  const side = Math.abs(d[1]) < 0.95 ? [d[2], 0, -d[0]] : [1, 0, 0], sl = Math.hypot(side[0], side[1], side[2]);
  const r1 = side.map((v) => v / sl), r2 = [d[1] * r1[2] - d[2] * r1[1], d[2] * r1[0] - d[0] * r1[2], d[0] * r1[1] - d[1] * r1[0]];
  let best: { f: P; t: number; zone: 'head' | 'torso' | 'legs' | 'arms'; n: number } | null = null;
  for (let k = 0; k < Math.max(1, pellets); k++) {
    const a = k * 2.399963, rr = pellets > 1 ? cone * Math.sqrt((k + 0.5) / pellets) : 0;
    const dk = [0, 1, 2].map((i) => d[i] + r1[i] * Math.cos(a) * rr + r2[i] * Math.sin(a) * rr), dl = Math.hypot(dk[0], dk[1], dk[2]);
    for (let i = 0; i < 3; i++) dk[i] /= dl;
    const wall = wallAt(o, dk, most);
    let first: { f: P; t: number; zone: 'head' | 'torso' | 'legs' | 'arms' } | null = null;
    for (const { f, shapes } of them) for (const s of shapes) {
      const t = rayRod(o, dk, s.a, s.b, s.r);
      if (t !== null && t < wall && t < most && (!first || t < first.t)) first = { f, t, zone: s.zone };
    }
    if (!first) continue;
    if (!best) best = { ...first, n: 1 };
    else if (best.f === first.f) best.n++;
  }
  if (!best) return;
  const v = best.f, dmg = armoured(v, best.zone, hitDamage(m.w, best.zone, best.t, !!m.sup, 0, best.n));
  if (dmg <= 0) return;
  me.longest = Math.max(me.longest, best.t);
  const s = statOf(me);
  s.longest = Math.max(s.longest, Math.round(best.t));
  send(v, { t: 'dmg', from: me.id, amount: dmg, zone: best.zone, w: m.w, dir: d as [number, number, number] });
  send(me, { t: 'hitok', to: v.id, amount: Math.round(dmg), zone: best.zone });
  hurt(l, v, me, dmg, m.w, best.zone === 'head');
}

/** a blow with the melee weapon in hand (or fists), claimed by the striker's game and held to its reach */
function blow(l: Lobby, me: P, m: { to?: unknown; w?: unknown; zone?: unknown }) {
  if (!me.alive || me.knocked || l.state === 'plane' || l.state === 'over') return;
  const v = l.ps.find((o) => o.id === m.to);
  const w = typeof m.w === 'string' ? m.w : '';
  if (!v || !v.alive || !foes(l, me, v) || (w && !ITEMS[w]?.melee && w !== 'fists')) return;
  if (Math.hypot(v.pose[0] - me.pose[0], v.pose[1] - me.pose[1], v.pose[2] - me.pose[2]) > BR.meleeReach) return;
  const now = Date.now();
  me.shots = me.shots.filter((t) => now - t < 380);
  if (me.shots.length) return;
  me.shots.push(now);
  const dmg = w && w !== 'fists' ? BR.melee : 12;
  send(v, { t: 'dmg', from: me.id, amount: dmg, zone: 'torso', w: w || 'fists', dir: [0, 0, 1] });
  send(me, { t: 'hitok', to: v.id, amount: dmg, zone: 'torso' });
  hurt(l, v, me, dmg, w || 'fists', false);
}

// ------------------------------------------------------------------------------------------------- jeeps
const seatsTo = (l: Lobby, v: VehicleInfo, rest = false) => all(l, { t: 'vseat', i: v.i, seats: v.seats, sim: v.sim, ...(rest ? { s: v.s } : {}) });
const isV = (s: unknown): s is VState => Array.isArray(s) && s.length === 12 && s.every(Number.isFinite);

/** out of whatever seat they are in; a jeep left with nobody at the wheel stands where it is */
function unseat(l: Lobby, p: P) {
  for (const v of l.veh.values()) {
    const k = v.seats.indexOf(p.id);
    if (k < 0 && v.sim !== p.id) continue;
    if (k >= 0) v.seats[k] = null;
    if (v.sim === p.id && !v.seats[0]) {
      v.sim = null;
      v.s = [v.s[0], v.s[1], v.s[2], v.s[3], v.s[4], v.s[5], v.s[6], 0, 0, 0, 0, 0];
    }
    seatsTo(l, v, !v.sim);
  }
}

function drive(l: Lobby, p: P, m: Record<string, unknown>) {
  if (!inMatch(l) || !p.alive) return;
  const v = l.veh.get(Number(m.i));
  switch (m.t) {
    case 'vin': {
      const seat = Number(m.seat);
      if (!v || p.knocked || !Number.isInteger(seat) || seat < 0 || seat >= SEATS || v.seats[seat] !== null || [...l.veh.values()].some((o) => o.seats.includes(p.id))) return;
      if (Math.hypot(p.pose[0] - v.s[0], p.pose[1] - v.s[1], p.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      v.seats[seat] = p.id;
      if (seat === 0) v.sim = p.id;
      return seatsTo(l, v);
    }
    case 'vout':
      return unseat(l, p);
    case 'vswap': {
      const seat = Number(m.seat), was = [...l.veh.values()].find((o) => o.seats.includes(p.id));
      if (!was || !Number.isInteger(seat) || seat < 0 || seat >= SEATS || was.seats[seat] !== null) return;
      was.seats[was.seats.indexOf(p.id)] = null;
      was.seats[seat] = p.id;
      if (seat === 0) was.sim = p.id;
      return seatsTo(l, was);
    }
    case 'v':
      if (!v || v.sim !== p.id || !isV(m.s) || !Number.isFinite(m.at)) return;
      v.s = m.s;
      return all(l, { t: 'vs', s: [[v.i, m.at as number, ...m.s]] }, p);
    case 'vrest':
      if (!v || v.sim !== p.id || !isV(m.s)) return;
      v.s = [m.s[0], m.s[1], m.s[2], m.s[3], m.s[4], m.s[5], m.s[6], 0, 0, 0, 0, 0];
      if (v.seats[0] !== p.id) (v.sim = null), seatsTo(l, v, true);
      return;
    case 'vtake':
      if (!v || v.sim !== null || v.seats.some((x) => x !== null)) return;
      v.sim = p.id;
      return seatsTo(l, v);
    case 'vflip':
      if (!v || v.seats.some((x) => x !== null)) return;
      v.s = restState(v.s[0], ground(v.s[0], v.s[2]), v.s[2], Math.atan2(2 * (v.s[6] * v.s[4]), 1 - 2 * v.s[4] * v.s[4]));
      return seatsTo(l, v, true);
    case 'vhorn':
      if (v && v.seats[0] === p.id) all(l, { t: 'vhorn', i: v.i, ...(m.horn !== undefined ? { horn: !!m.horn } : {}) } as S2C, p);
      return;
  }
}

// ------------------------------------------------------------------------------------------------- what a game says
function take(l: Lobby, p: P, id: number, slot: number) {
  const g = l.ground.get(id);
  if (!g || !p.alive || p.knocked || (l.state === 'plane' && !p.jumped)) return;
  if (Math.hypot(g.x - p.pose[0], g.z - p.pose[2]) > 3.2 || Math.abs(g.y - p.pose[1]) > 3) return;
  const gone = [id], add: Ground[] = [];
  const drop = (o: Omit<Ground, 'id' | 'x' | 'y' | 'z'>) => add.push({ id: groundId(), x: p.pose[0], y: p.pose[1] + 0.02, z: p.pose[2], ...o });
  if (g.ammo) {
    const cap = capOf(g.ammo, p.pack), had = p.pools[g.ammo] ?? 0, room = Math.max(0, cap - had);
    if (!room) return void send(p, { t: 'tell', text: 'No room for more of those rounds', kind: 'info' });
    const n = Math.min(room, g.n ?? 0);
    p.pools[g.ammo] = had + n;
    if ((g.n ?? 0) > n) add.push({ ...g, id: groundId(), n: (g.n ?? 0) - n });
  } else if (g.item) {
    const k = kindOf(g.item.id);
    if (k === 'vest' || k === 'helmet' || k === 'pack') {
      const was = p[k];
      p[k] = g.item.id;
      if (was) drop({ item: makeItem(was) });
    } else {
      // a heal stacks onto a slot of the same; else the first free slot; else the slot in hand is swapped out
      const h = HEALS[g.item.id], same = h ? p.slots.findIndex((s) => s?.id === g.item!.id && (s.qty ?? 1) < h.stack) : -1;
      if (same >= 0) {
        const s = p.slots[same]!, n = Math.min(h.stack - (s.qty ?? 1), g.item.qty ?? 1);
        s.qty = (s.qty ?? 1) + n;
        if ((g.item.qty ?? 1) > n) add.push({ ...g, id: groundId(), item: { ...g.item, qty: (g.item.qty ?? 1) - n } });
      } else {
        let k2 = p.slots.findIndex((s) => !s);
        if (k2 < 0) {
          k2 = Math.max(0, Math.min(BR.slots - 1, Math.round(slot)));
          const out = p.slots[k2];
          if (out && kindOf(out.id) === 'melee') return void send(p, { t: 'tell', text: 'Your slots are full: hold what you would swap out', kind: 'info' });
          if (out) drop({ item: out });
        }
        p.slots[k2] = g.item;
      }
    }
  }
  l.ground.delete(id);
  for (const a of add) l.ground.set(a.id, a);
  all(l, { t: 'br', k: 'loot', add, gone });
  me(l, p);
}

function said(l: Lobby, p: P, m: Record<string, unknown>) {
  switch (m.t) {
    case 's': {
      const q = m.p as Pose;
      if (!Array.isArray(q) || q.length !== 6 || !q.every(Number.isFinite)) return;
      if (!p.alive) return;
      const now = Date.now(), was = p.pose, dt = Math.max(0.05, (now - (p.hist[p.hist.length - 1]?.t ?? now)) / 1000);
      // (falling, or in the plane, a body goes as fast as the game says; on the ground, no faster than a run, and in the waiting area never out of its ring)
      const air = l.state === 'plane' || q[1] - ground(q[0], q[2]) > 4 || [...l.veh.values()].some((v) => v.seats.includes(p.id));
      const w = MAPS[l.map].wait, outside = !inMatch(l) && Math.hypot(q[0] - w.x, q[2] - w.z) > w.r + 6;
      if (outside || (!air && Math.hypot(q[0] - was[0], q[2] - was[2]) > 14 * dt + 4)) {
        if (outside) {
          send(p, { t: 'tell', text: 'The waiting area ends here', kind: 'warn' });
          const x = w.x + (q[0] - w.x) * 0.8, z = w.z + (q[2] - w.z) * 0.8;
          p.pose = [x, ground(x, z) + 0.1, z, q[3], 0, 0];
        }
        send(p, { t: 'put', x: p.pose[0], y: p.pose[1], z: p.pose[2], yaw: p.pose[3] });
      } else p.pose = p.knocked ? [q[0], q[1], q[2], q[3], q[4], (q[5] | F_PRONE) & ~F_CROUCH] : q;
      p.hist.push({ t: now, p: p.pose });
      while (p.hist.length > 2 && now - p.hist[1].t > 1000) p.hist.shift();
      p.w = typeof m.w === 'string' && ITEMS[m.w] ? m.w : null;
      p.m = Array.isArray(m.m) ? (m.m as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
      return;
    }
    case 'shot':
      return shot(l, p, m as { o: unknown; d: unknown; w: unknown; sup?: unknown });
    case 'hit':
      return blow(l, p, m);
    case 'swing':
      return all(l, { t: 'swing', id: p.id }, p);
    case 'emote':
      if (typeof m.e === 'string') all(l, { t: 'emote', id: p.id, e: m.e.slice(0, 24) }, p);
      return;
    case 'gear':
      if (Array.isArray(m.g)) p.g = (m.g as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8);
      return all(l, { t: 'gear', id: p.id, g: p.g }, p);
    case 'door': {
      const i = Number(m.i);
      if (!Number.isInteger(i) || i < 0) return;
      const st: [boolean, number] = [!!m.open, Number(m.swing) === -1 ? -1 : 1];
      l.doors.set(i, st);
      return all(l, { t: 'door', i, open: st[0], swing: st[1] }, p);
    }
    case 'chat':
      if (typeof m.text === 'string' && m.text.trim()) all(l, { t: 'chat', from: p.name, text: m.text.slice(0, 200) } as S2C);
      return;
    case 'ping':
      return void (Number.isFinite(m.n) && send(p, { t: 'pong', n: m.n as number }));
    case 'br':
      return brSaid(l, p, m);
    case 'vin': case 'vout': case 'vswap': case 'v': case 'vrest': case 'vtake': case 'vflip': case 'vhorn':
      return drive(l, p, m);
  }
}

function brSaid(l: Lobby, p: P, m: Record<string, unknown>) {
  switch (m.k) {
    case 'vote':
      if (l.state !== 'wait') return;
      p.voted = !!m.yes;
      lobbyTo(l);
      if (l.ps.length >= BR.min && l.ps.filter((o) => o.voted).length >= BR.votes(l.ps.length)) startCount(l);
      return;
    case 'take':
      return take(l, p, Number(m.id), Number(m.slot));
    case 'drop': {
      const k = Number(m.slot), it = p.slots[k];
      if (!it || !p.alive || kindOf(it.id) === 'melee') return;
      p.slots[k] = null;
      const g: Ground = { id: groundId(), x: p.pose[0], y: p.pose[1] + 0.02, z: p.pose[2], item: it };
      l.ground.set(g.id, g);
      all(l, { t: 'br', k: 'loot', add: [g], gone: [] });
      return me(l, p);
    }
    case 'use': {
      const k = Number(m.slot), it = p.slots[k], h = it && HEALS[it.id];
      if (!h || !p.alive || p.knocked || p.using) return;
      if (p.hp >= h.cap) return void send(p, { t: 'tell', text: h.cap < 100 ? `That heals you to ${h.cap} at most` : 'Your health is full', kind: 'info' });
      p.using = { slot: k, until: Date.now() + h.secs * 1000 };
      return me(l, p);
    }
    case 'jump':
      if (l.state !== 'plane' || p.jumped) return;
      p.jumped = true;
      return;
    case 'rev': {
      const v = l.ps.find((o) => o.id === m.id);
      if (!m.on) {
        if (p.rev) (p.rev = null), v && meTeam(l, v), me(l, p);
        return;
      }
      if (!v || !v.knocked || v.team !== p.team || !p.alive || p.knocked || p.rev || l.ps.some((o) => o.rev?.id === v.id)) return;
      p.rev = { id: v.id, until: Date.now() + BR.revive * 1000 };
      return meTeam(l, p);
    }
    case 'load': {
      const a = String(m.ammo), n = Math.max(0, Math.round(Number(m.n) || 0));
      if (AMMO[a] && p.pools[a]) p.pools[a] = Math.max(0, p.pools[a] - n);
      return;
    }
  }
}

// ------------------------------------------------------------------------------------------------- the clock
function tick() {
  const now = Date.now();
  for (const l of lobbies.values()) {
    if (l.state === 'wait' || l.state === 'count') {
      if (l.state === 'count' && now >= l.at) startMatch(l);
      else if (now - l.relaid > BR.relay * 1000) {
        // (the waiting area's guns laid again where taken)
        l.relaid = now;
        if (l.ground.size < 30) {
          const add = rollWait(world, l.map, rnd);
          for (const g of add) l.ground.set(g.id, g);
          all(l, { t: 'br', k: 'loot', add, gone: [] });
        }
      }
      continue;
    }
    if (l.state === 'plane' && l.plane && now >= l.plane.end) {
      for (const p of l.ps) if (!p.jumped) {
        p.jumped = true;
        br(p, { k: 'eject' });
      }
      l.state = 'live';
      stateTo(l);
    }
    if (!inMatch(l) || !l.zone) continue;
    if (now >= l.zone.t1) nextPhase(l);
    // the gas, once a second, to whoever stands outside the circle as it is now
    if (now - l.gas >= 1000 && l.zone.dmg > 0) {
      l.gas = now;
      const c = circleAt(l.zone.a, l.zone.b, l.zone.t0, l.zone.t1, now);
      for (const p of l.ps) if (p.alive && Math.hypot(p.pose[0] - c.x, p.pose[2] - c.z) > c.r) hurt(l, p, null, l.zone.dmg, 'gas', false);
    }
    for (const p of l.ps) {
      if (!p.alive) continue;
      // a knocked player bleeds out
      if (p.knocked && !l.ps.some((o) => o.rev?.id === p.id)) {
        p.kn -= (BR.bleed * 250) / 1000;
        if (p.kn <= 0) eliminate(l, p, null, 'bleeding', false);
      }
      // a heal done
      if (p.using && now >= p.using.until) {
        const it = p.slots[p.using.slot], h = it && HEALS[it.id];
        p.using = null;
        if (h && it) {
          p.hp = Math.min(h.cap, p.hp + h.hp);
          it.qty = (it.qty ?? 1) - 1;
          if (it.qty <= 0) p.slots[p.slots.indexOf(it)] = null;
          send(p, { t: 'hp', health: p.hp, bleeding: false });
        }
        me(l, p);
      }
      // a revive: the reviver standing (not crouched or down) and within reach, all the way through
      if (p.rev) {
        const v = l.ps.find((o) => o.id === p.rev!.id);
        const ok = v && v.knocked && p.alive && !p.knocked && !(p.pose[5] & (F_CROUCH | F_PRONE)) && Math.hypot(v.pose[0] - p.pose[0], v.pose[2] - p.pose[2]) <= BR.reviveReach;
        if (!ok) {
          p.rev = null;
          me(l, p);
          if (v) meTeam(l, v);
        } else if (now >= p.rev.until) {
          p.rev = null;
          v!.knocked = false;
          v!.kn = 0;
          v!.hp = BR.reviveHp;
          p.revives++;
          statOf(p).revives++;
          send(v!, { t: 'hp', health: v!.hp, bleeding: false });
          send(v!, { t: 'tell', text: `${p.name} got you up`, kind: 'good' });
          meTeam(l, p);
        }
      }
    }
    // dropped for good (past their grace): out, as if fallen
    for (const p of l.ps) if (p.gone && p.alive && now - p.gone > 30_000) eliminate(l, p, null, 'left', false);
  }
}

// ------------------------------------------------------------------------------------------------- coming in
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const code4 = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(rnd() * 24)]).join('');

/**
 * A game at /arena?w=br: `size` the team (1, 2, 4), `kills` the map its page was cut to (0-2), `loadout` how it comes
 * in: 'find' (any open lobby of the mode on that map, else a new one), 'host' (a lobby of its own, with a code for
 * friends), or a lobby's code.
 */
export function brUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams;
    let p: P | null = null, l: Lobby | null = null;
    const turn = (reason: string) => {
      ws.send(JSON.stringify({ t: 'kick', reason }));
      ws.close();
    };
    ws.on('message', (raw) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (p && l) return said(l, p, m);
      if (m.t !== 'hello') return;
      if (m.v !== PROTOCOL) return void ws.send(JSON.stringify({ t: 'kick', reason: 'This page is out of date: load it again.', v: PROTOCOL }));
      const key = typeof m.key === 'string' ? m.key.slice(0, 80) : '', name = typeof m.name === 'string' ? m.name.slice(0, 24).trim() || 'Survivor' : 'Survivor';
      if (key.length < 16) return turn('No player key.');
      const mode = modeOfSize(Number(q.get('size')) || 1), map = Math.max(0, Math.min(MAPS.length - 1, Math.round(Number(q.get('kills')) || 0))), how = (q.get('loadout') ?? 'find').toUpperCase();
      // back after dropping, into their own match
      for (const ll of lobbies.values()) for (const pp of ll.ps) if (pp.key === key && pp.gone && ll.state !== 'over') {
        if (ll.map !== map) return void (ws.send(JSON.stringify({ t: 'br', k: 'remap', map: ll.map, code: ll.code, size: TEAM[ll.mode] })), ws.close());
        pp.ws = ws;
        pp.gone = 0;
        p = pp;
        l = ll;
        welcome(ll, pp);
        if (ll.plane) br(pp, { k: 'plane', ...ll.plane, now: Date.now() });
        if (ll.zone) br(pp, { k: 'zone', ...ll.zone, now: Date.now() });
        me(ll, pp);
        stateTo(ll, pp);
        tellAll(ll, `${pp.name} is back`);
        return;
      }
      const open = (x: Lobby) => (x.state === 'wait' || x.state === 'count') && x.ps.length < BR.max;
      if (how === 'HOST') {
        if (lobbies.size >= BR.most * 4) return turn('Every lobby is taken: try again in a while.');
        l = { id: Math.random().toString(36).slice(2, 8), code: code4(), private: true, mode, map, state: 'wait', ps: [], ground: new Map(), doors: new Map(), at: 0, plane: null, zone: null, opened: Date.now(), relaid: 0, gas: 0, winners: [], veh: new Map() };
        lobbies.set(l.id, l);
      } else if (how !== 'FIND') {
        const ll = [...lobbies.values()].find((x) => x.code === how);
        if (!ll || !open(ll)) return turn('No open lobby has that code.');
        if (ll.map !== map || TEAM[ll.mode] !== TEAM[mode]) return void (ws.send(JSON.stringify({ t: 'br', k: 'remap', map: ll.map, code: ll.code, size: TEAM[ll.mode] })), ws.close());
        l = ll;
      } else {
        l = [...lobbies.values()].filter((x) => !x.private && x.mode === mode && x.map === map && open(x)).sort((a, b) => b.ps.length - a.ps.length)[0] ?? null;
        if (!l) {
          if ([...lobbies.values()].filter(inMatch).length >= BR.most) return turn('Every match is being played: try again in a few minutes.');
          l = { id: Math.random().toString(36).slice(2, 8), code: code4(), private: false, mode, map, state: 'wait', ps: [], ground: new Map(), doors: new Map(), at: 0, plane: null, zone: null, opened: Date.now(), relaid: 0, gas: 0, winners: [], veh: new Map() };
          lobbies.set(l.id, l);
        }
      }
      if (l.ps.some((o) => o.key === key)) return turn('You are in that lobby already.');
      const me0: P = { id: nextId++, ws, name, key, pose: [0, 0, 0, 0, 0, 0], hist: [], w: null, m: [], g: [], rtt: 150, pingAt: 0, gone: 0, team: 0, hp: 100, knocked: false, kn: 0, alive: true, place: 0, slots: starter(), vest: null, helmet: null, pack: null, pools: {}, using: null, rev: null, voted: false, jumped: false, kills: 0, knocks: 0, revives: 0, dmg: 0, longest: 0, born: Date.now(), shots: [] };
      p = me0;
      l.ps.push(me0);
      if (!l.ground.size) for (const g of rollWait(world, l.map, rnd)) l.ground.set(g.id, g);
      toWait(l, me0);
      welcome(l, me0);
      me(l, me0);
      all(l, { t: 'join', p: info(me0) } as S2C, me0);
      lobbyTo(l);
      stateTo(l, me0);
      log(`${l.id}: ${name} in (${l.ps.length}, ${l.mode}, ${MAPS[l.map].name}${l.private ? `, code ${l.code}` : ''})`);
    });
    ws.on('pong', () => {
      if (p && p.pingAt) p.rtt = Date.now() - p.pingAt;
    });
    ws.on('close', () => {
      if (!p || !l) return;
      const me1 = p, lob = l;
      if (lob.state === 'wait' || lob.state === 'count' || lob.state === 'over' || !me1.alive) {
        lob.ps = lob.ps.filter((o) => o !== me1);
        all(lob, { t: 'leave', id: me1.id });
        if (!lob.ps.length) return void lobbies.delete(lob.id);
        if (inMatch(lob)) teamCheck(lob, me1, null);
        else lobbyTo(lob);
        return;
      }
      me1.gone = Date.now();
      tellAll(lob, `${me1.name} dropped: 30 s to come back`, 'warn');
    });
  });
}

/** the lobbies, for the menu's list (private ones are not listed) */
export function brList() {
  return [...lobbies.values()].filter((l) => !l.private).map((l) => ({ id: l.id, mode: l.mode, map: l.map, have: l.ps.length, state: l.state }));
}
export const brPlayers = () => [...lobbies.values()].reduce((n, l) => n + l.ps.filter((p) => !p.gone).length, 0);
/** the map a page should be cut to: the open lobby with the most in it, else any */
export function brNext(mode: BrMode): number {
  const l = [...lobbies.values()].filter((x) => !x.private && x.mode === mode && (x.state === 'wait' || x.state === 'count')).sort((a, b) => b.ps.length - a.ps.length)[0];
  return l ? l.map : Math.floor(rnd() * MAPS.length);
}
export function brBoard() {
  return {
    players: [...board.values()].sort((a, b) => b.wins - a.wins || b.kills - a.kills).slice(0, 50).map((s) => ({ ...s, dmg: Math.round(s.dmg), alive: Math.round(s.alive) })),
    matches: results.slice(-20).reverse(),
  };
}

export async function startBr(w: World) {
  world = w;
  const t0 = Date.now();
  await buildWorld();
  spots = brSpots(world);
  log(`ground and ${spots.length} places for things ready in ${Date.now() - t0} ms (${MAPS.map((m) => `${m.name} ${spots.filter((s) => inMap(m, s.x, s.z)).length}`).join(', ')})`);
  setInterval(tick, 250).unref();
  // where everybody is, for the others, 15 times a second (as the open world: 20 KB/s down a player at 30)
  setInterval(() => {
    for (const l of lobbies.values()) {
      const rows = l.ps.filter((p) => !p.gone).map((p) => [p.id, p.pose[0], p.pose[1], p.pose[2], p.pose[3], p.pose[4], p.pose[5], p.w, p.m, null] as Extract<S2C, { t: 'ps' }>['s'][number]);
      for (const p of l.ps) send(p, { t: 'ps', s: rows.filter((r) => r[0] !== p.id) });
    }
  }, 66).unref();
  setInterval(() => {
    const now = Date.now();
    for (const l of lobbies.values()) {
      for (const p of l.ps) if (!p.gone && p.ws.readyState === 1) {
        p.pingAt = now;
        p.ws.ping();
      }
      if (l.state !== 'over' && !inMatch(l)) lobbyTo(l);
    }
  }, 5000).unref();
}
