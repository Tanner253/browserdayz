// The arena (2026-10-14): wager matches in the fort, team against team in rounds, as CS:GO has them (the owner:
// "round based progression like cs:go ... once all the players of 1 team is dead the winner team is decided point
// awarded then next round and reset"). It runs inside the game server's process, on its own path (/arena) and with
// its own state: nothing of the open world is in it, and nothing of it is in the open world (the owner asked for a
// free service: this costs nothing more). The rules are src/sim/arena.ts.
//
// THE SERVER DECIDES EVERY HIT AND EVERY HEALTH POINT. A game says where it is and where it shot; the server traces
// each shot itself, through the fort's own walls (its solids, built here into a physics world of their own) and the
// ground, to the others as they stood when it was fired (wound back by the shooter's lag), and says what was hit
// and what is left. A game's word on a hit, its health or a death is not asked for.
//
// It speaks the game's own protocol, a few words of it: the game comes in as it does to the open world, and a round
// is said in words the game knows already ('put' to set somebody down, 'mend', 'kit' for the loadout, 'hp' for the
// health the server holds, 'powers' to watch the rest of a round, flying, once dead, 'tell' for the score).
import RAPIER from '@dimforge/rapier3d-compat';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { ARENA, arenaEnds, hitShapes, inArena, rayRod, type LobbyInfo } from '../src/sim/arena';
import { CASTLE_SCALE, castleAt, type FortPlace } from '../src/sim/castle';
import { WEAPON_RULES, hitDamage } from '../src/sim/combat';
import { shotOf } from '../src/sim/gunplay';
import { phaseOf } from '../src/sim/daynight';
import { ITEMS, makeItem } from '../src/sim/items';
import { KITS } from '../src/sim/kits';
import { F_DEAD, PROTOCOL, type Pose, type S2C } from '../src/net/protocol';
import { castleShapeIn } from '../src/world/castle-shape';
import { WORLD_RES, WORLD_SIZE, heightAt, type World } from '../src/world/worldgen';

interface Fighter {
  id: number;
  ws: WebSocket;
  name: string;
  key: string;
  side: 0 | 1;
  pose: Pose;
  /** where they said they were over the last second, by the server's clock: a shot is judged against these */
  hist: { t: number; p: Pose }[];
  health: number;
  alive: boolean;
  w: string | null;
  m: string[];
  g: string[];
  shots: number[];
  /** the time a ping to their game takes there and back, ms */
  rtt: number;
  pingAt: number;
  /** when they dropped (0: they are here) */
  gone: number;
}

interface Lobby {
  id: string;
  host: string;
  hostKey: string;
  /** players a side */
  size: number;
  kills: number;
  loadout: string;
  stake: number;
  opened: number;
  state: 'open' | 'match' | 'over';
  sides: [Fighter[], Fighter[]];
  score: [number, number];
  round: number;
  between: boolean;
  ends: { x: number; y: number; z: number; yaw: number }[];
}

const lobbies = new Map<string, Lobby>();
let nextId = 1;
let world: World;
let phys: RAPIER.World | null = null;
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} [arena] ${s}`);
const send = (f: Fighter, m: S2C) => {
  if (!f.gone && f.ws.readyState === 1) f.ws.send(JSON.stringify(m));
};
const everyone = (l: Lobby) => [...l.sides[0], ...l.sides[1]];
const tellAll = (l: Lobby, text: string, kind: 'good' | 'warn' | 'info' = 'info') => everyone(l).forEach((f) => send(f, { t: 'tell', text, kind }));

/** The fort's walls and the ground under and round it, for shots to meet: built once, in a world of their own. */
async function buildWorld() {
  await RAPIER.init();
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // the ground, as the game has it (column-major, rows along z)
  const N = WORLD_RES, H = world.heights, hcm = new Float32Array(N * N);
  for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) hcm[iz + ix * N] = H[iz * N + ix];
  w.createCollider(RAPIER.ColliderDesc.heightfield(N - 1, N - 1, hcm, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE }));
  // the fort, as the game stands it (src/world/castle.ts, `solid`): its own measure turned and scaled into the world's
  const P = world.castle as FortPlace, c = Math.cos(P.rot / 2), s = Math.sin(P.rot / 2);
  const at = (x: number, y: number, z: number) => { const [wx, wy, wz] = castleAt(P, x, z, y); return { x: wx, y: wy, z: wz }; };
  const steps = castleShapeIn(P, (x, z) => heightAt(world.surface, x, z));
  let step = steps.next();
  while (!step.done) step = steps.next();
  let n = 0;
  for (const so of step.value.solids) {
    if (so.t === 'field' || so.feet) continue; // (a rail or a stair's edge stops feet, never a shot; the fort's own earth is the ground's)
    if (so.t === 'box') {
      // the box's own turn after the fort's: q = turn(P.rot about y) * q
      const [qx, qy, qz, qw] = so.q;
      const rot = { x: c * qx + s * qz, y: c * qy + s * qw, z: c * qz - s * qx, w: c * qw - s * qy };
      w.createCollider(RAPIER.ColliderDesc.cuboid(so.h[0] * CASTLE_SCALE, so.h[1] * CASTLE_SCALE, so.h[2] * CASTLE_SCALE).setTranslation(...(Object.values(at(so.c[0], so.c[1], so.c[2])) as [number, number, number])).setRotation(rot));
      n++;
    } else if (so.t === 'hull') {
      const pts = new Float32Array(so.pts.length);
      for (let i = 0; i < so.pts.length; i += 3) { const p = at(so.pts[i], so.pts[i + 1], so.pts[i + 2]); pts.set([p.x, p.y, p.z], i); }
      const d = RAPIER.ColliderDesc.convexHull(pts);
      if (d) { w.createCollider(d); n++; }
    }
  }
  w.step();
  phys = w;
  log(`the fort's ${n} solids and the ground are up, for shots to meet`);
}

/** how far along a ray from `o` the first wall or ground is (Infinity: none within `most`) */
function wallAt(o: number[], d: number[], most: number): number {
  if (!phys) return Infinity;
  const hit = phys.castRay(new RAPIER.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] }), most, true);
  return hit ? hit.timeOfImpact : Infinity;
}

/** where a fighter stood `ms` ago by the server's clock (their word as it came in, the nearest before that moment) */
function poseAt(f: Fighter, at: number): Pose {
  for (let i = f.hist.length - 1; i >= 0; i--) if (f.hist[i].t <= at) return f.hist[i].p;
  return f.hist[0]?.p ?? f.pose;
}

const info = (f: Fighter) => ({ id: f.id, name: f.name, pose: f.pose, w: f.w, m: f.m, g: f.g, alive: f.alive });

/** the loadout, every thing of it made here, as the admin's /kit makes one */
function loadout(l: Lobby) {
  const kit = KITS.find((k) => k.id === l.loadout) ?? KITS[0];
  return {
    name: kit.name,
    // (the guns and nothing else, loaded, with what is fitted to them: no magazines, rounds, armour or clothes to see to.
    // The owner: "lets strip the mags and the bullets and gear. lets make a simple fps shooter". They never run dry:
    // see `endless` in setDown)
    items: kit.things.filter((th) => ITEMS[th.id]?.category === 'weapon').map((th) => {
      const it = makeItem(th.id, th.qty);
      if (th.mag !== undefined) it.mag = th.mag;
      if (th.loaded !== undefined) it.loaded = th.loaded;
      if (th.mods) it.mods = [...th.mods];
      if (th.rounds !== undefined) it.rounds = th.rounds;
      return it;
    }),
  };
}
const carries = (l: Lobby, w: string) => (KITS.find((k) => k.id === l.loadout) ?? KITS[0]).things.some((th) => th.id === w);

/** each at their own end, a few paces apart from their side, alive, whole and with the loadout */
function setDown(l: Lobby) {
  const kit = loadout(l);
  for (const side of [0, 1] as const) {
    const e = l.ends[side];
    l.sides[side].forEach((f, k) => {
      const off = (k - (l.sides[side].length - 1) / 2) * 2.2, x = e.x + Math.cos(e.yaw) * off, z = e.z - Math.sin(e.yaw) * off;
      const y = heightAt(world.surface, x, z);
      f.alive = true;
      f.health = 100;
      f.pose = [x, y, z, e.yaw, 0, 0];
      f.hist = [{ t: Date.now(), p: f.pose }];
      // (endless: firing takes no round out of a gun, so nobody reloads: src/sim/powers.ts)
      send(f, { t: 'powers', god: false, hidden: false, clip: false, voidInv: false, voidTag: false, endless: true });
      send(f, { t: 'put', x, y, z });
      send(f, { t: 'mend' });
      send(f, { t: 'kit', name: kit.name, items: kit.items });
      send(f, { t: 'hp', health: 100, bleeding: false });
    });
  }
}

function startMatch(l: Lobby) {
  l.state = 'match';
  l.round = 1;
  const hour = phaseOf(Date.now() / 1000);
  for (const f of everyone(l)) {
    const e = l.ends[f.side];
    send(f, {
      t: 'welcome', v: PROTOCOL, you: f.id, players: everyone(l).filter((o) => o !== f).map(info),
      loot: [], doors: [], stashes: [], corpses: [], drops: [], flights: [], barrels: [], fires: [], bunker: false, ajar: [], vehicles: [], infected: [],
      hour, spawn: { x: e.x, z: e.z, yaw: e.yaw, y: e.y }, me: null, max: l.size * 2,
    } as unknown as S2C);
  }
  setDown(l);
  tellAll(l, `The wager is on: first to ${l.kills}. Round 1.`, 'good');
  log(`${l.id}: ${everyone(l).map((f) => f.name).join(', ')} begin, first to ${l.kills}, ${l.loadout}`);
}

function roundOver(l: Lobby, winner: 0 | 1) {
  l.between = true;
  l.score[winner]++;
  const names = (s: 0 | 1) => l.sides[s].map((f) => f.name).join(' & ');
  if (l.score[winner] >= l.kills) {
    l.state = 'over';
    tellAll(l, `${names(winner)} won the wager, ${l.score[winner]} to ${l.score[winner ? 0 : 1]}.`, 'good');
    log(`${l.id}: over, ${names(winner)} won ${l.score.join('-')}`);
    setTimeout(() => {
      for (const f of everyone(l)) if (f.ws.readyState === 1) f.ws.send(JSON.stringify({ t: 'kick', reason: `The wager is over: ${names(winner)} won ${l.score[winner]} to ${l.score[winner ? 0 : 1]}.` }));
      lobbies.delete(l.id);
    }, 4000);
    return;
  }
  tellAll(l, `${names(winner)} take round ${l.round}. ${l.score[0]} to ${l.score[1]}.`, 'info');
  setTimeout(() => {
    if (l.state !== 'match') return;
    l.round++;
    l.between = false;
    setDown(l);
    tellAll(l, `Round ${l.round}.`, 'info');
  }, ARENA.roundGap * 1000);
}

/** a side with nobody left standing (dead, or gone from the game) has lost the round */
function checkRound(l: Lobby) {
  if (l.state !== 'match' || l.between) return;
  for (const side of [0, 1] as const) if (l.sides[side].every((f) => !f.alive || f.gone)) return roundOver(l, side ? 0 : 1);
}

function shot(l: Lobby, me: Fighter, m: { o: unknown; d: unknown; w: unknown; sup?: unknown }) {
  if (l.state !== 'match' || l.between || !me.alive || typeof m.w !== 'string') return;
  const rule = WEAPON_RULES[m.w];
  const o = m.o as number[], d0 = m.d as number[];
  if (!rule || !carries(l, m.w) || !Array.isArray(o) || !Array.isArray(d0) || o.length !== 3 || d0.length !== 3 || ![...o, ...d0].every(Number.isFinite)) return;
  // (no faster than the gun fires)
  const now = Date.now();
  me.shots = me.shots.filter((t) => now - t < rule.interval * 1000 * 0.85);
  if (me.shots.length) return;
  me.shots.push(now);
  // (and from where they are: a muzzle a body's height off where they stand, no further)
  if (Math.hypot(o[0] - me.pose[0], o[2] - me.pose[2]) > 2.5 || Math.abs(o[1] - me.pose[1] - 1.3) > 1.6) return;
  const len = Math.hypot(d0[0], d0[1], d0[2]);
  if (len < 1e-6) return;
  const d = d0.map((v) => v / len);
  for (const f of everyone(l)) if (f !== me) send(f, { t: 'shot', id: me.id, o: o as [number, number, number], d: d as [number, number, number], w: m.w, sup: !!m.sup });
  const most = Math.max(rule.range * 2, 150);
  // (the others as they were drawn on the shooter's screen when they fired: their lag, and the 140 ms a game draws others behind)
  const back = now - Math.min(400, me.rtt / 2 + 140);
  const foes = everyone(l).filter((f) => f !== me && f.alive && !f.gone && f.side !== me.side).map((f) => ({ f, shapes: hitShapes(poseAt(f, back)) }));
  // A shell's pellets: fired here, evenly over its cone round the line of the shot (the game strews its own at
  // random; no game says how many of its pellets struck). One round is one pellet.
  const { pellets, cone } = shotOf(m.w);
  const side = Math.abs(d[1]) < 0.95 ? [d[2], 0, -d[0]] : [1, 0, 0], sl = Math.hypot(side[0], side[1], side[2]);
  const r1 = side.map((v) => v / sl), r2 = [d[1] * r1[2] - d[2] * r1[1], d[2] * r1[0] - d[0] * r1[2], d[0] * r1[1] - d[1] * r1[0]];
  let best: { f: Fighter; t: number; zone: 'head' | 'torso' | 'legs' | 'arms'; n: number } | null = null;
  for (let k = 0; k < Math.max(1, pellets); k++) {
    const a = k * 2.399963, rr = pellets > 1 ? cone * Math.sqrt((k + 0.5) / pellets) : 0;
    const dk = [0, 1, 2].map((i) => d[i] + r1[i] * Math.cos(a) * rr + r2[i] * Math.sin(a) * rr), dl = Math.hypot(dk[0], dk[1], dk[2]);
    for (let i = 0; i < 3; i++) dk[i] /= dl;
    const wall = wallAt(o, dk, most);
    let first: { f: Fighter; t: number; zone: 'head' | 'torso' | 'legs' | 'arms' } | null = null;
    for (const { f, shapes } of foes) for (const s of shapes) {
      const t = rayRod(o, dk, s.a, s.b, s.r);
      if (t !== null && t < wall && t < most && (!first || t < first.t)) first = { f, t, zone: s.zone };
    }
    if (!first) continue;
    // (the one struck first by the most of them takes them all: a shell is not shared out between two)
    if (!best) best = { ...first, n: 1 };
    else if (best.f === first.f) best.n++;
  }
  if (!best) return;
  const v = best.f, dmg = hitDamage(m.w, best.zone, best.t, !!m.sup, 0, best.n);
  if (dmg <= 0) return;
  v.health = Math.max(0, v.health - dmg);
  send(v, { t: 'dmg', from: me.id, amount: dmg, zone: best.zone, w: m.w, dir: d as [number, number, number] });
  send(me, { t: 'hitok', to: v.id, amount: dmg, zone: best.zone });
  if (v.health > 0) return void send(v, { t: 'hp', health: v.health, bleeding: false });
  // dead for the rest of the round: lying where they fell to the others, and free to watch the rest of it, flying
  v.alive = false;
  v.pose = [v.pose[0], v.pose[1], v.pose[2], v.pose[3], v.pose[4], v.pose[5] | F_DEAD];
  tellAll(l, `${me.name} killed ${v.name}${best.zone === 'head' ? ' (head)' : ''}.`, 'info');
  send(v, { t: 'powers', god: true, hidden: true, clip: true, voidInv: false, voidTag: false });
  send(v, { t: 'tell', text: 'You are dead for this round: watch the rest of it.', kind: 'warn' });
  checkRound(l);
}

/** what a game in the arena says */
function said(l: Lobby, f: Fighter, m: Record<string, unknown>) {
  switch (m.t) {
    case 's': {
      const p = m.p as Pose;
      if (!Array.isArray(p) || p.length !== 6 || !p.every(Number.isFinite)) return;
      // (the dead lie where they fell; their own game's flying about is theirs alone)
      if (!f.alive || l.between) return;
      const now = Date.now(), was = f.pose, dt = Math.max(0.05, (now - (f.hist[f.hist.length - 1]?.t ?? now)) / 1000);
      // (no faster than a body runs, with room for a line held up; and never out of the arena)
      const out = !inArena(world, p[0], p[2]);
      if (Math.hypot(p[0] - was[0], p[2] - was[2]) > 12 * dt + 3 || out) {
        const e = l.ends[f.side];
        send(f, { t: 'put', x: e.x, y: e.y, z: e.z });
        if (out) send(f, { t: 'tell', text: 'Out of the arena: back to your end.', kind: 'warn' });
        f.pose = [e.x, e.y, e.z, e.yaw, 0, 0];
      } else f.pose = p;
      f.hist.push({ t: now, p: f.pose });
      while (f.hist.length > 2 && now - f.hist[1].t > 1000) f.hist.shift();
      f.w = typeof m.w === 'string' && ITEMS[m.w] ? m.w : null;
      f.m = Array.isArray(m.m) ? (m.m as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
      return;
    }
    case 'shot':
      return shot(l, f, m as { o: unknown; d: unknown; w: unknown; sup?: unknown });
    case 'gear':
      if (Array.isArray(m.g)) f.g = (m.g as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8);
      for (const o of everyone(l)) if (o !== f) send(o, { t: 'gear', id: f.id, g: f.g });
      return;
    case 'chat':
      if (typeof m.text === 'string' && m.text.trim()) for (const o of everyone(l)) send(o, { t: 'chat', from: f.name, text: m.text.slice(0, 200) });
      return;
    case 'ping':
      return void (Number.isFinite(m.n) && send(f, { t: 'pong', n: m.n as number }));
  }
}

/** the lobbies, as the menu's list has them */
export function arenaList(): LobbyInfo[] {
  const now = Date.now();
  return [...lobbies.values()].filter((l) => l.state !== 'over').map((l) => ({ id: l.id, host: l.host, kills: l.kills, loadout: l.loadout, stake: l.stake, size: l.size, have: everyone(l).filter((f) => !f.gone).length, state: l.state === 'open' ? 'open' : 'match', age: Math.round((now - l.opened) / 1000) }));
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

/** A connection asked for at /arena: `?w=new&size=&kills=&loadout=&stake=` to open a lobby, `?w=<id>` to join one. */
export function arenaUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams;
    let f: Fighter | null = null, l: Lobby | null = null;
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
      if (f && l) return said(l, f, m);
      if (m.t !== 'hello') return;
      if (m.v !== PROTOCOL) return void ws.send(JSON.stringify({ t: 'kick', reason: 'This page is out of date: load it again.', v: PROTOCOL }));
      const key = typeof m.key === 'string' ? m.key.slice(0, 80) : '', name = typeof m.name === 'string' ? m.name.slice(0, 24).trim() || 'Survivor' : 'Survivor';
      if (key.length < 16) return turn('No player key.');
      const w = q.get('w') ?? '';
      // back after dropping: into their own place
      for (const ll of lobbies.values()) for (const ff of everyone(ll)) if (ff.key === key && ff.gone && ll.state === 'match') {
        ff.ws = ws;
        ff.gone = 0;
        f = ff;
        l = ll;
        const e = ll.ends[ff.side];
        send(ff, { t: 'welcome', v: PROTOCOL, you: ff.id, players: everyone(ll).filter((o) => o !== ff).map(info), loot: [], doors: [], stashes: [], corpses: [], drops: [], flights: [], barrels: [], fires: [], bunker: false, ajar: [], vehicles: [], infected: [], hour: phaseOf(Date.now() / 1000), spawn: { x: e.x, z: e.z, yaw: e.yaw, y: e.y }, me: null, max: ll.size * 2 } as unknown as S2C);
        tellAll(ll, `${ff.name} is back.`, 'info');
        return;
      }
      if (w === 'new') {
        if (lobbies.size >= ARENA.most) return turn('Every arena is taken: try again in a while.');
        if ([...lobbies.values()].some((x) => x.state === 'open' && x.hostKey === key)) return turn('You have a wager open already.');
        const size = Math.min(3, Math.max(1, Math.round(Number(q.get('size')) || 1)));
        const kills = (ARENA.kills as readonly number[]).includes(Number(q.get('kills'))) ? Number(q.get('kills')) : ARENA.kills[1];
        const lo = (ARENA.loadouts as readonly string[]).includes(q.get('loadout') ?? '') ? (q.get('loadout') as string) : ARENA.loadouts[0];
        const stake = Math.min(ARENA.stake[1], Math.max(ARENA.stake[0], Number(q.get('stake')) || ARENA.stake[0]));
        const ends = arenaEnds(world);
        l = { id: Math.random().toString(36).slice(2, 8), host: name, hostKey: key, size, kills, loadout: lo, stake, opened: Date.now(), state: 'open', sides: [[], []], score: [0, 0], round: 0, between: false, ends };
        lobbies.set(l.id, l);
        log(`${l.id}: ${name} opens a ${size}v${size} wager, first to ${kills}, ${lo}`);
      } else {
        l = lobbies.get(w) ?? null;
        if (!l || l.state !== 'open') return turn('That wager is not open any more.');
        if (everyone(l).some((o) => o.key === key)) return turn('You are in that wager already.');
      }
      // onto the side with room, the host's first
      const side: 0 | 1 = l.sides[0].length < l.size && (w === 'new' || l.sides[0].length <= l.sides[1].length) ? 0 : 1;
      if (l.sides[side].length >= l.size) return turn('That wager is full.');
      f = { id: nextId++, ws, name, key, side, pose: [l.ends[side].x, l.ends[side].y, l.ends[side].z, l.ends[side].yaw, 0, 0], hist: [], health: 100, alive: true, w: null, m: [], g: [], shots: [], rtt: 150, pingAt: 0, gone: 0 };
      l.sides[side].push(f);
      if (everyone(l).length < l.size * 2) {
        // (waiting: the game waits as it waits in line for a full server, and is told how many are in)
        for (const o of everyone(l)) send(o, { t: 'queue', pos: everyone(l).length, of: l.size * 2, max: l.size * 2 });
        return;
      }
      startMatch(l);
    });
    ws.on('pong', () => {
      if (f && f.pingAt) f.rtt = Date.now() - f.pingAt;
    });
    ws.on('close', () => {
      if (!f || !l) return;
      const me = f, lob = l;
      if (lob.state === 'open') {
        lob.sides[me.side] = lob.sides[me.side].filter((o) => o !== me);
        if (!everyone(lob).length) lobbies.delete(lob.id);
        else for (const o of everyone(lob)) send(o, { t: 'queue', pos: everyone(lob).length, of: lob.size * 2, max: lob.size * 2 });
        return;
      }
      if (lob.state !== 'match') return;
      me.gone = Date.now();
      tellAll(lob, `${me.name} dropped: ${ARENA.grace} s to come back.`, 'warn');
      checkRound(lob);
      setTimeout(() => {
        if (!me.gone || lob.state !== 'match') return;
        // gone for good: their side plays on without them; with nobody of it left, the match is the other side's
        if (lob.sides[me.side].every((o) => o.gone)) {
          lob.score[me.side ? 0 : 1] = lob.kills - 1;
          roundOver(lob, me.side ? 0 : 1);
        }
      }, ARENA.grace * 1000);
    });
  });
}

/** set going with the world the game server made: the fort's walls built, and the tick */
export async function startArena(w: World) {
  world = w;
  await buildWorld();
  // where everybody in each match is, for the others, twenty times a second; and their lag measured now and then
  setInterval(() => {
    for (const l of lobbies.values()) {
      if (l.state !== 'match') continue;
      const s = everyone(l).filter((f) => !f.gone).map((f) => [f.id, f.pose[0], f.pose[1], f.pose[2], f.pose[3], f.pose[4], f.pose[5], f.w, f.m, null] as Extract<S2C, { t: 'ps' }>['s'][number]);
      for (const f of everyone(l)) send(f, { t: 'ps', s: s.filter((r) => r[0] !== f.id) });
    }
  }, 50).unref();
  setInterval(() => {
    const now = Date.now();
    for (const l of lobbies.values()) {
      for (const f of everyone(l)) if (!f.gone && f.ws.readyState === 1) {
        f.pingAt = now;
        f.ws.ping();
      }
      // (a lobby nobody joins is taken off the list)
      if (l.state === 'open' && now - l.opened > ARENA.wait * 1000) {
        for (const f of everyone(l)) if (f.ws.readyState === 1) f.ws.send(JSON.stringify({ t: 'kick', reason: 'Nobody took the wager up in time.' }));
        lobbies.delete(l.id);
      }
      // (and every open lobby keeps its waiting games waiting)
      if (l.state === 'open') for (const f of everyone(l)) send(f, { t: 'queue', pos: everyone(l).length, of: l.size * 2, max: l.size * 2 });
    }
  }, 5000).unref();
}
