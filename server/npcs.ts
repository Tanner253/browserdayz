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
// in a building as a player would: some stand about inside one, cover under a roof is taken before cover in the open,
// and a doorway or a window is fired from (2026-11-15, the owner: "should hide in buildings"). How one walks through the
// map's own walls and floors, and finds its way round them, is server/npc-walk.ts.
//
// They are no friends of one another (the owner, 2026-11-15: "the bandits shouldnt all be friendly to eachother, they
// should operate like real people. sometimes they group up but most the time theyre hostile ... especially 2 groups
// coming into contact"): one fights any other it sees but the one it keeps with, as it fights a player, and a round of
// its is as hard on them. And they do not keep to one place ("can move freely in their map zones but avoid bunching
// them up"): now and then one makes for another place of its land, none where another already is.
//
// And what one has is counted (the owner, 2026-11-15: "play like a real player ... proning in spots nearby roads to
// hunt players etc looting etc.... managing their inventories properly"): the rounds it carries go down as it fires
// and it runs when they are gone; it dresses a wound behind cover; it lies up by a road; it picks up what lies about
// its place, and all of it is in its body when it is killed.

import { F_AIM, F_CROUCH, F_DEAD, F_GROUND, F_PRONE, F_SPRINT, NPC_FROM, type C2S, type KillInfo, type PlayerInfo, type Pose, type S2C } from '../src/net/protocol';
import { WEAPON_RULES, hitDamage, piercedBy, type HitZone } from '../src/sim/combat';
import { ITEMS, makeItem, stockGun, type ItemInstance } from '../src/sim/items';
import { LOOT_BAG } from '../src/sim/items/build';
import { BODY_GRID, Container } from '../src/sim/inventory';
import type { Ground } from '../src/sim/animal-ground';
import { clients, broadcast, broadcastNear, num, send, type Client } from './players';
import { boxes, economy, horde, issue, log, world } from './index';
import { INFECTED, I_ATTACK, I_CHASE } from '../src/sim/infected';
import { infectedBody } from './acts';
import { bodyInfo, fellWay } from './bodies';
import { dealt } from './checks';
import { away } from './gate';
import { mayHit } from './tags';
import { safe } from './camp';
import { goneFrom } from './searched';
import { walled, zoneAt } from './solid';
import { ROUTES, floorsAt, indoors, openAir, route, standAt, stepTo, straight, walkOn, type Spot } from './npc-walk';
import { SIGHT, clear, eyeOf, noticeIn, sightOn, wrap, yawTo } from './npc-sight';
import type { Vec3 } from '../src/sim/grenades';

/** how many there are (NPCS=0 for none), and the numbers they go by */
export const NPC = {
  count: process.env.NPCS === undefined ? -1 : Math.max(0, Number(process.env.NPCS) || 0),
  /**
   * how many live where, west to east (the owner, 2026-11-15: "too many of them are in the desert where players spawn,
   * we should add more the more east we go, maybe 3 in the desert zone, 8 in the middle and 12 in the far east"): the
   * desert to the ridge's crest, the green land to the old square's edge, the square. NPCS=n: n of them, anywhere.
   */
  zones: [{ to: -2250, n: 3 }, { to: -768, n: 8 }, { to: Infinity, n: 12 }],
  /** how often two come together and keep together ("maybe some of the ai stick together so theres duos") */
  duo: 0.4,
  /** thinks only with a player this near, metres */
  near: 260,
  /** NPC_AWAKE=1: they think with nobody near (a test read in the server's log, with no game) */
  awake: !!process.env.NPC_AWAKE,
  /** a player's own paces, so that the legs a game draws fit the ground covered (the owner, 2026-11-15: "the bandits
   * movement animations dont always look natural"): a walk, the jog a player goes about at, a sprint */
  walk: 1.7,
  jog: 4.0,
  run: 6.0,
  hp: 100,
  /** seconds its body lies before it is gone, and before another comes to the map in its place */
  lies: 300,
  back: [150, 330] as [number, number],
  /** no nearer a player than this where it comes to the map, metres */
  apart: 140,
  /** and nobody is seen or shot at this soon after they come into the world, ms: one may be standing where they wake */
  grace: Number(process.env.NPC_GRACE ?? 30000),
  /** NPC_AIM=0: never a hit (a test). And how much of a round's harm theirs does: a quarter of a player's (the owner,
   * 2026-11-15: "the bandits should do 25% normal damage"), as one meets them alone and they are many */
  aim: Number(process.env.NPC_AIM ?? 1),
  harm: 0.25,
};

/**
 * What one carries and wears: a gun (and how many rounds a burst is), what is on it, and which of NPC.zones it is met
 * in (the owner, 2026-11-15: "ai weapons should be scaled from west to east matching loot tiers so desert has pistols
 * npc and far east has ak npc"): pistols in the desert, pistols and the short guns in the green land, rifles in the east.
 */
const KITS: { w: string; burst: [number, number]; g: string[]; in: number[] }[] = [
  { w: 'ak', burst: [2, 4], g: ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack'], in: [2] },
  { w: 'ak', burst: [2, 3], g: ['quilted_jacket', 'combat_trousers', 'hiking_boots', 'beanie'], in: [2] },
  { w: 'ar15', burst: [2, 3], g: ['tactical_jacket', 'combat_trousers', 'hiking_boots', 'sack_pack'], in: [2] },
  { w: 'aks74u', burst: [2, 5], g: ['tracksuit_jacket', 'tracksuit_pants', 'trainers'], in: [1, 2] },
  { w: 'mpa', burst: [3, 5], g: ['leather_jacket', 'jeans', 'work_boots', 'beanie'], in: [1] },
  { w: 'm9', burst: [1, 3], g: ['hoodie', 'jeans', 'trainers'], in: [0, 1] },
  { w: 'colt', burst: [1, 2], g: ['hoodie', 'work_trousers', 'work_boots'], in: [0, 1] },
  { w: 'm9', burst: [1, 2], g: ['quilted_jacket', 'combat_trousers', 'hiking_boots', 'beanie'], in: [0] },
];
const FOOD = ['beans', 'bandage', 'rags'];

type State = 'roam' | 'alert' | 'fight' | 'hunt';
interface Npc {
  id: number;
  /** which of NPC.zones it lives in, and the one it keeps with (0: alone; the one that came second follows the first) */
  zone: number;
  mate: number;
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
  to: { x: number; z: number; y?: number } | null;
  /** the way there round what stands between, once walking straight at it has failed: which `to` it is for, when it
   * may next be looked for, and how near the end it has got and when (it gives up what it gets no nearer) */
  way: Spot[];
  wayFor: object | null;
  wayAt: number;
  tries: number;
  /** how many times running it has not got where it was going */
  fails: number;
  progD: number;
  progAt: number;
  pace: number;
  waitUntil: number;
  vx: number;
  vz: number;
  /** who it is fighting, where it last saw them, which way they were going, and when */
  foe: number;
  last: Vec3;
  lastV: [number, number];
  sawAt: number;
  /** how nearly it knows of each it has had in view (1: it does), and the way to one it half knows of (it stops and looks) */
  aware: Map<number, number>;
  wary: number;
  /** the way it looks while it stands about: out of a window, down a street */
  gaze: number;
  gazeAt: number;
  /** whether it has gone round for another line since it lost them; the places it has yet to look for one lost, and when it goes on */
  flanked: boolean;
  seek: number;
  seekAt: number;
  /** the fight: its cover (and whether it only has to stand up there to fire), where it fires from, and what it is at */
  cover: (Spot & { low: boolean }) | null;
  peek: Spot | null;
  act: 'hide' | 'out' | 'fire' | 'back' | 'open';
  until: number;
  left: number;
  nextShot: number;
  mag: number;
  /** when it may next look for cover, and when it was last hit */
  coverAt: number;
  /** when it next leaves the cover it has for cover nearer them */
  pushAt: number;
  hitAt: number;
  /** its sights: how far off their chest they are, across and up, metres where they stand; how many rounds of climb
   * are in the gun; and how good a shot it is (1: middling) */
  ax: number;
  ay: number;
  kick: number;
  skill: number;
  /** what it has: what a magazine holds and the rounds beside those in the gun (none left: `dry`, and it runs),
   * dressings and when the one going on is on, and what it has picked up */
  cap: number;
  rounds: number;
  dry: boolean;
  bandages: number;
  healAt: number;
  pack: ItemInstance[];
  /** what it is about with nobody to fight: a walk, lying up by a road (`lie`: down there), or gone to pick something up */
  plan: 'walk' | 'lie' | 'loot';
  lie: boolean;
  lootUid: string;
  lootAt: number;
}

/** NPC_LOG=1: what each is at said in the server's log, for a test */
const SAY = !!process.env.NPC_LOG;
let ground: Ground;
export const npcs = new Map<number, Npc>();
let nextId = NPC_FROM;
/** each that is owed: when it comes to the map, and to which of NPC.zones (-1: anywhere) */
const owed: { at: number; zone: number }[] = [];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(l: T[]) => l[Math.floor(Math.random() * l.length)];

/** Made once the animals' ground is (server/index.ts). */
export function startNpcs(g: Ground) {
  ground = g;
  walkOn(g);
  sightOn(g);
  if (!NPC.count) return void log('[npcs] none (NPCS=0)');
  if (NPC.count > 0) for (let k = 0; k < NPC.count; k++) owed.push({ at: Date.now() + k * 400, zone: -1 });
  else NPC.zones.forEach((q, zone) => {
    for (let k = 0; k < q.n; k++) owed.push({ at: Date.now() + owed.length * 400, zone });
  });
  log(`[npcs] ${owed.length} to come`);
}

/** a place for one to come to the map: in or by a named place, in the open, with nobody near and no trader's camp */
function place(zone: number): { x: number; z: number; r: number } | null {
  const west = zone > 0 ? NPC.zones[zone - 1].to : -Infinity, east = zone >= 0 ? NPC.zones[zone].to : Infinity;
  const places = (world.places as { x: number; z: number; radius: number; name: string }[]).filter((q) => q.radius >= 25 && q.x >= west && q.x < east);
  if (!places.length) return null;
  for (let go = 0; go < 40; go++) {
    const q = pick(places), r = Math.min(90, q.radius), a = rnd(0, Math.PI * 2), d = rnd(0, r);
    const x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d;
    if (x < west || x >= east || !ground.open(x, z, 0.7) || ground.roofed(x, z) || safe(x, z)) continue;
    // (on its feet under the sky, with a way off in most directions: the owner, 2026-11-15, "some ai are spawning in or
    // getting stuck in some buildings": not every building is a box to the animals' ground)
    const y = standAt(x, z, ground.height(x, z) + 0.3);
    if (y === null || !openAir(x, z, y)) continue;
    let ways = 0;
    for (let k = 0; k < 6; k++) if (straight({ x, y, z }, { x: x + Math.sin(k * 1.047) * 6, z: z + Math.cos(k * 1.047) * 6 })) ways++;
    if (ways < 4) continue;
    if ([...clients.values()].some((c) => Math.hypot(c.pose[0] - x, c.pose[2] - z) < NPC.apart)) continue;
    if ([...npcs.values()].some((n) => n.alive && (Math.hypot(n.pose[0] - x, n.pose[2] - z) < 90 || Math.hypot(n.home.x - x, n.home.z - z) < 90))) continue;
    return { x, z, r };
  }
  return null;
}

function spawn(now: number, zone: number, by?: Npc): Npc | null {
  // (one of two: beside the other)
  let at = by ? null : place(zone);
  for (let go = 0; by && go < 12 && !at; go++) {
    const a = rnd(0, Math.PI * 2), x = by.pose[0] + Math.cos(a) * 4, z = by.pose[2] + Math.sin(a) * 4;
    if (ground.open(x, z, 0.7) && !ground.roofed(x, z) && !safe(x, z)) at = { x, z, r: by.home.r };
  }
  if (!at) return null;
  // (by the land it stands in, whichever it was owed to)
  const land = NPC.zones.findIndex((q) => at.x < q.to), kit = pick(KITS.filter((k) => k.in.includes(land))), mag = ITEMS[kit.w]?.weapon?.mag, cap = (mag && ITEMS[mag]?.mag?.capacity) || ITEMS[kit.w]?.weapon?.capacity || 30;
  const n: Npc = {
    id: nextId++, zone, mate: by?.id ?? 0, name: 'Bandit', pose: [at.x, ground.height(at.x, at.z), at.z, rnd(-Math.PI, Math.PI), 0, F_GROUND],
    w: kit.w, m: mag ? [mag] : [], g: kit.g.filter((id) => ITEMS[id]), bd: Math.floor(rnd(0, 4)), vo: Math.floor(rnd(0, 4)), burst: kit.burst,
    hp: NPC.hp, alive: true, diedAt: 0, home: at, state: 'roam', to: null, way: [], wayFor: null, wayAt: 0, tries: 0, fails: 0, progD: Infinity, progAt: 0, pace: NPC.walk, waitUntil: now + rnd(500, 4000), vx: 0, vz: 0,
    foe: 0, last: [0, 0, 0], lastV: [0, 0], sawAt: 0, aware: new Map(), wary: NaN, gaze: NaN, gazeAt: 0, flanked: false, seek: 0, seekAt: 0, cover: null, peek: null, act: 'open', until: 0, left: 0, nextShot: 0, mag: cap, coverAt: 0, pushAt: 0, hitAt: 0, ax: 2, ay: 0.5, kick: 0, skill: rnd(0.6, 1.05),
    cap, rounds: cap * Math.round(rnd(2, 4)), dry: false, bandages: Math.round(rnd(1, 3)), healAt: 0, pack: [makeItem('beans')], plan: 'walk', lie: false, lootUid: '', lootAt: 0,
  };
  if (by) (n.home = by.home), (by.mate = n.id);
  npcs.set(n.id, n);
  broadcast({ t: 'join', p: infoOf(n) });
  return n;
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

/** whoever one may fight: a player, or another of them */
type Foe = Client | Npc;
const isNpc = (f: Foe): f is Npc => f.id >= NPC_FROM;
const foeOf = (id: number): Foe | undefined => (id >= NPC_FROM ? npcs.get(id) : clients.get(id));
const okFoe = (f: Foe | undefined): f is Foe => !!f && (isNpc(f) ? f.alive : fair(f));

/**
 * The floors above a place that it may make for: none in a building where the stairs were looked for and not found (a
 * loft up a ladder, a roof), by 6 m squares, so that a way which is not there is looked for once.
 */
const noStairs = new Set<number>();
const sq = (x: number, z: number) => Math.floor(x / 6) * 65536 + Math.floor(z / 6);
const upper = (x: number, z: number) => (noStairs.has(sq(x, z)) ? [] : floorsAt(x, z).filter((y) => y < ground.height(x, z) + 7.5));

const spotOf = (n: Npc): Spot => ({ x: n.pose[0], y: n.pose[1], z: n.pose[2] });
/** the places on a floor above whose stairs have been looked for from under them */
const climbed = new WeakSet<object>();
/** ways that may still be looked for this tick: one, so that no tick is long */
let routesLeft = 1;

/**
 * A step toward where it is going: straight at it, aside round what is in the way, and by a way found through the
 * map's walls where that fails (a doorway, a corner). False when it is there or cannot get there.
 */
function step(n: Npc, dt: number): boolean {
  if (!n.to) return false;
  const now = Date.now(), at = spotOf(n);
  if (n.wayFor !== n.to) {
    n.wayFor = n.to;
    n.way = [];
    n.wayAt = 0;
    n.tries = 0;
    n.progD = Infinity;
    n.progAt = now;
  }
  const end = Math.hypot(n.to.x - at.x, n.to.z - at.z);
  // (on another floor: it walks to under it as to anywhere, and from there only a way found, by the stairs, gets it up)
  const up = n.to.y !== undefined && Math.abs(n.to.y - at.y) > 1.2, climb = up && end < 1.5;
  if (end < 0.5 && !up) return false;
  while (n.way.length && Math.hypot(n.way[0].x - at.x, n.way[0].z - at.z) < 0.4) {
    n.way.shift();
    n.progAt = now;
  }
  if (!n.way.length && end < n.progD - 1) {
    n.progD = end;
    n.progAt = now;
  }
  const stuck = now - n.progAt > (n.way.length ? 4000 : 2500);
  const goal = n.way[0] ?? n.to, want = Math.atan2(goal.x - at.x, goal.z - at.z), far = Math.min(Math.hypot(goal.x - at.x, goal.z - at.z), n.pace * dt);
  if (!stuck && (!climb || n.way.length)) for (const turn of n.way.length ? [0, 0.5, -0.5] : [0, 0.6, -0.6, 1.2, -1.2]) {
    const a = want + turn, s = stepTo(at, at.x + Math.sin(a) * far, at.z + Math.cos(a) * far, false);
    // (and room for a body half a metre on: it does not walk its face into a wall)
    if (!s || (far < 0.55 && Math.hypot(goal.x - at.x, goal.z - at.z) > 0.6 && !stepTo(at, at.x + Math.sin(a) * 0.55, at.z + Math.cos(a) * 0.55))) continue;
    n.pose[0] = s.x;
    n.pose[1] = s.y;
    n.pose[2] = s.z;
    n.vx = (Math.sin(a) * far) / dt;
    n.vz = (Math.cos(a) * far) / dt;
    return true;
  }
  n.vx = n.vz = 0;
  n.way = [];
  const first = climb && !climbed.has(n.to);
  if (end > 70) return false;
  // (a way it was on and lost a step of: it stands until it may look again, a few times over, before it gives it up)
  if (now < n.wayAt && !first) return n.tries > 0 && n.tries < 4;
  // (another's turn this tick: it stands a moment)
  if (routesLeft <= 0) return true;
  routesLeft--;
  n.wayAt = now + 3000;
  n.tries++;
  if (climb) climbed.add(n.to);
  const way = route(at, climb ? n.to : { x: n.to.x, z: n.to.z }, climb ? 1200 : 450);
  if (SAY) log(`[npc ${n.id}] a way of ${way ? way.length : 'none'} to ${Math.round(end)} m off (${ROUTES.n} ways, ${Math.round(ROUTES.cells / ROUTES.n)} squares and ${(ROUTES.ms / ROUTES.n).toFixed(1)} ms each, ${ROUTES.none} none)`);
  if (!way) return false;
  n.way = way;
  n.progAt = now;
  return true;
}

const face = (n: Npc, yaw: number, dt: number, rate = 7) => {
  const d = wrap(yaw - n.pose[3]);
  n.pose[3] = wrap(n.pose[3] + Math.max(-rate * dt, Math.min(rate * dt, d)));
};
const flagsOf = (n: Npc, moving: boolean, aim: boolean, crouch: boolean) => F_GROUND | (aim ? F_AIM : 0) | (crouch ? F_CROUCH : 0) | (moving && n.pace > 5 ? F_SPRINT : 0);

/**
 * Cover from somebody at `from`: a place it can walk to where nothing of it can be seen from there crouched, and
 * beside it (or at it, stood up: a low wall, a window) a place it can fire from. Under a roof before in the open
 * ("should hide in buildings"), then the nearest.
 */
function findCover(n: Npc, from: Vec3, about?: { x: number; z: number }, reach = 160): { cover: NonNullable<Npc['cover']>; peek: Spot; way: Spot[] } | null {
  const at = spotOf(n), mid = about ?? at, found: { cover: NonNullable<Npc['cover']>; peek: Spot; score: number }[] = [];
  for (const r of [2.5, 5, 8, 12, 16, 22]) {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + r, cx = mid.x + Math.cos(a) * r, cz = mid.z + Math.sin(a) * r;
      // (on the ground there; on its own floor if it is up a building; and, in a building near, the floor above: a
      // window over them is the place a player takes)
      const gy = ground.height(cx, cz), inb = indoors(cx, cz), ys = [standAt(cx, cz, gy + 0.3)];
      if (at.y > gy + 1.5) ys.push(standAt(cx, cz, at.y));
      else if (inb && r <= 12 && k % 2 === 0) ys.push(...upper(cx, cz));
      let was = -99;
      for (const y of ys) {
        if (y === null || Math.abs(y - was) < 0.5 || Math.abs(y - at.y) > 4.5) continue;
        was = y;
        if (clear(from, [cx, y + 0.95, cz]) || clear(from, [cx, y + 0.4, cz])) continue;
        const score = r - (inb ? 9 : 0) - (y > gy + 2 ? 7 : 0) + Math.abs(y - at.y) * 1.5, c: Spot = { x: cx, y, z: cz };
        // (a low wall or a window: hidden crouched, and over it stood up)
        if (clear([cx, y + 1.58, cz], from, true)) {
          found.push({ cover: { ...c, low: true }, peek: c, score });
          continue;
        }
        // (or a corner, a doorway: a step or two out of it to the side there is a line to them)
        const side = Math.atan2(from[0] - cx, from[2] - cz) + Math.PI / 2;
        for (const s of [1.4, -1.4, 2.4, -2.4]) {
          const p = straight(c, { x: cx + Math.sin(side) * s, z: cz + Math.cos(side) * s });
          if (!p || !clear([p.x, p.y + 1.58, p.z], from, true)) continue;
          found.push({ cover: { ...c, low: false }, peek: p, score });
          break;
        }
      }
    }
  }
  found.sort((a, b) => a.score - b.score);
  // (the best few it can get to: straight, or by a way found, a longer one where there are stairs to climb)
  for (const f of found.slice(0, 2)) {
    const s = straight(at, f.cover), stairs = Math.abs(f.cover.y - at.y) > 1.2;
    if (s && Math.abs(s.y - f.cover.y) < 0.6) return { cover: f.cover, peek: f.peek, way: [] };
    const way = route(at, f.cover, stairs ? 600 : reach);
    if (way) return { cover: f.cover, peek: f.peek, way };
    if (stairs) noStairs.add(sq(f.cover.x, f.cover.z));
  }
  return null;
}

/** how fast they are going, across the ground, from the last two places their game told of */
function going(c: Foe): [number, number] {
  if (isNpc(c)) return [c.vx, c.vz];
  const tr = c.trail, a = tr && tr.length > 1 ? tr[tr.length - 2] : null, b = tr?.[tr.length - 1];
  if (!a || !b) return [0, 0];
  const dt = Math.max(0.05, (b.t - a.t) / 1000);
  return [(b.p[0] - a.p[0]) / dt, (b.p[2] - a.p[2]) / dt];
}

/** where on them it aims: the chest as they stand, crouch or lie */
const chestOf = (p: Pose): Vec3 => [p[0], p[1] + (p[5] & F_PRONE ? 0.3 : p[5] & F_CROUCH ? 0.8 : 1.15), p[2]];

/**
 * Its sights on them, ten times a second (the owner, 2026-11-15: "the ai's are not very good at shooting ... play more
 * natural and human like"). No roll of a die: `ax` and `ay` are how far off their chest its sights are, in metres at
 * where they stand. Sights come onto somebody over a third of a second or so, trail behind whoever crosses in front
 * of them, and sway more the further off, stood more than crouched or lying, and when it has just been hit; out of
 * sight they are lost and have to be brought on again. So one who stands still in the open is hit, and one who runs
 * across, breaks the line or shoots first is not.
 */
function track(n: Npc, c: Foe, seen: boolean, dt: number, now: number) {
  const p = c.pose, d = Math.max(1, Math.hypot(p[0] - n.pose[0], p[2] - n.pose[2]));
  if (!seen) {
    n.ax = rnd(-1, 1) * (0.8 + d * 0.03);
    n.ay = rnd(-0.5, 0.5);
    return;
  }
  const [vx, vz] = going(c), lx = (p[2] - n.pose[2]) / d, lz = -(p[0] - n.pose[0]) / d;
  // (across its line: it follows a little behind them)
  const want = -(vx * lx + vz * lz) * 0.17 / n.skill, k = 1 - Math.exp(-dt / (0.45 / n.skill));
  // (the owner, 2026-11-15, of the pass before: 'the npc seem to be "too good" at playing now ... we just want to get
  // REALISM in here': a hand that wanders half as much again, sights slower onto somebody, a longer look before the first round)
  const low = n.pose[5] & F_PRONE ? 0.0027 : n.pose[5] & F_CROUCH ? 0.0042 : 0.0063;
  const sway = (low * d * (now - n.hitAt < 900 ? 2.2 : 1) * (Math.hypot(n.vx, n.vz) > 0.5 ? 2 : 1)) / n.skill;
  n.ax += (want - n.ax) * k + rnd(-1, 1) * sway;
  n.ay += (0 - n.ay) * k + rnd(-1, 1) * sway * 0.7;
  n.kick *= 0.55;
}

/** One round at them: heard and seen by every game near, and gone where its sights were, with the gun's own climb. */
function fire(n: Npc, c: Foe, now: number) {
  const rule = WEAPON_RULES[n.w], p = c.pose, o = eyeOf(n.pose), aim = chestOf(p);
  const d = Math.hypot(aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]);
  const x = n.ax + rnd(-1, 1) * d * 0.0025 * (1 + n.kick), y = n.ay + rnd(-1, 1) * d * 0.0025 + d * 0.0012 * n.kick, wide = Math.abs(x);
  // (and the gun climbs with each round of a burst)
  n.kick += 1;
  n.ay += d * 0.003;
  n.ax += rnd(-1, 1) * d * 0.0025;
  // (what of them the round finds, by how they stand)
  let zone: HitZone | null = null;
  if (p[5] & F_PRONE) zone = wide < 0.35 && y > -0.25 && y < 0.2 ? (Math.random() < 0.15 ? 'head' : 'torso') : null;
  else {
    const [head, neck, hip, foot] = p[5] & F_CROUCH ? [0.5, 0.25, -0.3, -0.75] : [0.62, 0.33, -0.35, -1.1];
    if (y > neck && y < head && wide < 0.14) zone = 'head';
    else if (y > hip && y <= neck) zone = wide < 0.24 ? 'torso' : wide < 0.36 ? 'arms' : null;
    else if (y >= foot && y <= hip && wide < 0.22) zone = 'legs';
  }
  const hit = NPC.aim > 0 && !!zone && clear(o, aim, true) && !walled(n.pose, aim);
  const side = Math.atan2(aim[0] - o[0], aim[2] - o[2]) + Math.PI / 2;
  const tx = aim[0] + Math.sin(side) * x, ty = aim[1] + y, tz = aim[2] + Math.cos(side) * x;
  const len = Math.max(0.001, Math.hypot(tx - o[0], ty - o[1], tz - o[2]));
  broadcastNear({ t: 'shot', id: n.id, o: [o[0], o[1] - 0.12, o[2]], d: [(tx - o[0]) / len, (ty - o[1]) / len, (tz - o[2]) / len], w: n.w, sup: false }, o[0], o[2], 700);
  n.mag--;
  if (!hit || !rule || !zone) return;
  const amount = hitDamage(n.w, zone, d) * NPC.harm;
  if (amount <= 0) return;
  // (never `lastHitBy`: see the head of this file)
  if (SAY) log(`[npc ${n.id}] hit ${c.name} ${zone} ${amount.toFixed(0)} at ${Math.round(d)} m`);
  if (isNpc(c)) {
    // (another of them: down, or it turns on whoever hit it)
    c.hp -= amount;
    c.hitAt = now;
    if (c.hp <= 0) {
      down(c, now, n.pose[0], n.pose[2], { by: n.id, byName: n.name, w: n.w, zone, dist: Math.round(d) });
      log(`a ${n.name} killed a ${c.name} (${n.w}, ${Math.round(d)} m)`);
    } else if (c.dry) {
      c.last = [n.pose[0], n.pose[1], n.pose[2]];
      flee(c, now);
    } else if (c.id !== n.mate) onTo(c, n, now);
    return;
  }
  dealt(c, amount, zone, n.w);
  const flat = Math.max(0.001, Math.hypot(p[0] - o[0], p[2] - o[2]));
  send(c, { t: 'dmg', from: n.id, amount, zone, w: n.w, dir: [(p[0] - o[0]) / flat, 0, (p[2] - o[2]) / flat] });
}

/** after them: where they were, and from now */
/** a fresh magazine from what it carries; with no rounds left it is `dry` */
function reload(n: Npc) {
  const take = Math.min(n.cap, n.rounds);
  n.rounds -= take;
  n.mag = take;
  if (!take) n.dry = true;
}

/** out of rounds: away from whoever it was fighting, at a run, and it fights nobody until it finds some */
function flee(n: Npc, now: number) {
  const a = Math.atan2(n.pose[0] - n.last[0], n.pose[2] - n.last[2]) + rnd(-0.5, 0.5);
  if (SAY) log(`[npc ${n.id}] out of rounds, away`);
  n.state = 'hunt';
  n.foe = 0;
  n.seek = 0;
  n.cover = n.peek = null;
  n.lie = false;
  n.to = { x: n.pose[0] + Math.sin(a) * 60, z: n.pose[2] + Math.cos(a) * 60 };
  n.pace = NPC.run;
  n.until = now + 20000;
}

/** what lies near that it would pick up: the nearest thing on its own floor (no tag, no bag of a broken box, nothing that holds things) */
function lootNear(n: Npc): { uid: string; x: number; z: number } | null {
  if (n.pack.length >= 6) return null;
  let best: { uid: string; x: number; z: number } | null = null, bd = 45;
  for (const [uid, l] of economy.loot) {
    const d = Math.hypot(l.x - n.pose[0], l.z - n.pose[2]);
    if (d >= bd || Math.abs(l.y - n.pose[1]) > 2.5 || l.item.id === 'dogtag' || l.item.id === LOOT_BAG.id || l.item.cargo?.length || safe(l.x, l.z)) continue;
    best = { uid, x: l.x, z: l.z };
    bd = d;
  }
  return best;
}

/** It picks up what it went to: rounds for its gun and dressings to what it uses, anything else into its pack. */
function pickUp(n: Npc) {
  const uid = n.lootUid, l = economy.loot.get(uid);
  n.lootUid = '';
  if (!l || Math.hypot(l.x - n.pose[0], l.z - n.pose[2]) > 2.6 || !economy.take(uid)) return;
  goneFrom(`l:${uid}`);
  const it = l.item;
  if (SAY) log(`[npc ${n.id}] picked up ${it.id}`);
  if (it.id === ITEMS[n.w]?.weapon?.ammo) {
    n.rounds += it.qty;
    n.dry = false;
  } else if (it.id === n.m[0] && it.rounds) {
    n.rounds += it.rounds;
    n.dry = false;
  } else if (it.id === 'bandage' || it.id === 'rags') n.bandages += 1;
  else n.pack.push(it);
}

/** a place to lie up by a road: a few metres off its edge, in the open air, among trees if there are any */
function lieSpot(n: Npc): { x: number; z: number } | null {
  for (let go = 0; go < 16; go++) {
    const a = rnd(0, Math.PI * 2), d = rnd(5, 90), x = n.pose[0] + Math.cos(a) * d, z = n.pose[2] + Math.sin(a) * d, road = ground.road(x, z);
    if (road < 5 || road > 22 || indoors(x, z) || (go < 8 && ground.cover(x, z) < 0.2)) continue;
    if (standAt(x, z, ground.height(x, z) + 0.3) !== null) return { x, z };
  }
  return null;
}

/** the way to the road from where it lies */
function roadYaw(n: Npc) {
  let best = n.pose[3], bd = Infinity;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, x = n.pose[0] + Math.sin(a) * 6, z = n.pose[2] + Math.cos(a) * 6, d = ground.road(x, z);
    if (d < bd) (bd = d), (best = yawTo(n.pose[0], n.pose[2], x, z));
  }
  return best;
}

function onTo(n: Npc, c: Foe, now: number) {
  if (n.state !== 'fight' || n.foe !== c.id) {
    n.state = 'fight';
    n.foe = c.id;
    n.act = 'open';
    n.cover = n.peek = null;
    n.coverAt = 0;
    n.pushAt = now + rnd(12000, 26000);
    if (SAY) log(`[npc ${n.id}] after ${c.name} at ${Math.round(Math.hypot(c.pose[0] - n.pose[0], c.pose[2] - n.pose[2]))} m`);
    // (a moment to take them in before the first round)
    n.nextShot = now + rnd(600, 1200) / n.skill;
    n.left = 0;
    n.ax = rnd(1.2, 2.6) * (Math.random() < 0.5 ? -1 : 1);
    n.ay = rnd(-0.6, 0.6);
  }
  n.last = [c.pose[0], c.pose[1], c.pose[2]];
  n.sawAt = now;
  // (and the one it keeps with knows of them as it does)
  const m = npcs.get(n.mate);
  if (m?.alive && m !== c && m.state !== 'fight' && !m.dry && Math.hypot(m.pose[0] - n.pose[0], m.pose[2] - n.pose[2]) < 80) onTo(m, c, now);
}

function fight(n: Npc, now: number, dt: number) {
  const c = foeOf(n.foe);
  if (!okFoe(c)) return void calm(n, now);
  if (n.dry) return void flee(n, now);
  const seen = noticeIn(n.pose, c.pose, true, 0) < Infinity;
  track(n, c, seen, dt, now);
  if (seen) {
    n.last = [c.pose[0], c.pose[1], c.pose[2]];
    n.lastV = going(c);
    n.sawAt = now;
    n.flanked = false;
  } else if (now - n.sawAt > 11000) {
    // (lost: to where they were last, sights up, a look about there, and on the way they were going)
    n.state = 'hunt';
    n.to = { x: n.last[0], z: n.last[2] };
    n.pace = NPC.jog;
    n.until = now + 30000;
    n.seek = 2;
    n.seekAt = 0;
    return;
  }
  const foeAt: Vec3 = [n.last[0], n.last[1] + 1.4, n.last[2]], dist = Math.hypot(n.last[0] - n.pose[0], n.last[2] - n.pose[2]);
  const toFoe = yawTo(n.pose[0], n.pose[2], n.last[0], n.last[2]);
  // (cover looked for once it is in a fight, again when what it has no longer hides it, or it has none and is hit)
  // (and it does not sit behind one wall for ever: after a while it works nearer, or round to a side, cover to cover)
  const push = !!n.cover && n.act === 'hide' && dist > 25 && now > n.pushAt;
  // (and with them out of sight a few seconds it goes round for another line on where they were: "move to find angles")
  const round = !seen && !n.flanked && now - n.sawAt > 3000 && n.act !== 'back' && n.act !== 'out' && dist > 6;
  if (!n.lie && now >= n.coverAt && (!n.cover || push || round || (n.act === 'hide' && clear(foeAt, [n.cover.x, n.cover.y + 0.95, n.cover.z])))) {
    n.coverAt = now + 2500;
    n.pushAt = now + rnd(12000, 26000);
    const way = Math.atan2(n.last[0] - n.pose[0], n.last[2] - n.pose[2]) + rnd(-0.8, 0.8), far = Math.min(14, dist * 0.35);
    // (round them: a place off to one side of the line it had, a little nearer)
    const arc = Math.atan2(n.pose[0] - n.last[0], n.pose[2] - n.last[2]) + (Math.random() < 0.5 ? 1 : -1) * rnd(0.8, 1.3), out = Math.max(8, Math.min(28, dist * 0.75));
    const about = round ? { x: n.last[0] + Math.sin(arc) * out, z: n.last[2] + Math.cos(arc) * out } : push ? { x: n.pose[0] + Math.sin(way) * far, z: n.pose[2] + Math.cos(way) * far } : undefined;
    if (round) n.flanked = true;
    const found = findCover(n, foeAt, about, round ? 400 : 160) ?? ((push || round) && n.cover && n.peek ? { cover: n.cover, peek: n.peek, way: [] } : null);
    if (SAY) log(`[npc ${n.id}] ${round ? 'round for a line, ' : ''}cover ${found ? `${found.cover.y > ground.height(found.cover.x, found.cover.z) + 2 ? 'upstairs ' : ''}${found.cover.low ? 'low' : 'corner'}${indoors(found.cover.x, found.cover.z) ? ' indoors' : ''} ${Math.round(Math.hypot(found.cover.x - n.pose[0], found.cover.z - n.pose[2]))} m off` : 'none'}`);
    n.cover = found?.cover ?? null;
    n.peek = found?.peek ?? null;
    if (found) {
      n.act = 'back';
      n.to = { x: found.cover.x, z: found.cover.z, y: found.cover.y };
      // (the way it was found by, if it is not a straight one)
      n.wayFor = n.to;
      n.way = found.way;
      n.wayAt = 0;
      n.progD = Infinity;
      n.progAt = now;
      n.pace = NPC.run;
    } else if (n.act !== 'fire') n.act = 'open';
  }
  const shoot = () => {
    if (now < n.nextShot) return;
    if (n.mag <= 0) {
      // (a magazine out: behind cover, or where it stands, for as long as a new one takes)
      reload(n);
      n.left = 0;
      n.nextShot = now + 2600;
      return;
    }
    if (n.left <= 0) n.left = Math.round(rnd(n.burst[0], n.burst[1]));
    if (seen) fire(n, c, now);
    n.left--;
    n.nextShot = now + Math.max(120, (WEAPON_RULES[n.w]?.interval ?? 0.2) * 1000 * rnd(1.1, 1.6)) + (n.left <= 0 ? rnd(700, 1500) : 0);
  };
  if (n.lie) {
    // (lying up, and they have not found it: it fires from where it lies. Hit, or with them on top of it, it is up)
    if (now - n.hitAt < 4000 || dist < 10 || (!seen && now - n.sawAt > 3000)) n.lie = false;
    else {
      n.vx = n.vz = 0;
      face(n, toFoe, dt);
      n.pose[4] = Math.atan2(n.last[1] + 1.1 - (n.pose[1] + 0.35), Math.max(1, dist));
      n.pose[5] = F_GROUND | F_PRONE | F_AIM;
      shoot();
      return;
    }
  }
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
        n.pace = NPC.jog;
        n.act = Math.random() < 0.5 ? 'open' : 'hide';
      }
    } else face(n, toFoe, dt);
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
      if (n.mag <= 0) reload(n);
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
        n.to = { x: n.peek.x, z: n.peek.z, y: n.peek.y };
        n.pace = NPC.walk;
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
      if (n.mag <= 0) reload(n);
    } else {
      n.act = 'back';
      n.to = { x: n.cover.x, z: n.cover.z, y: n.cover.y };
      n.pace = NPC.run;
    }
  }
}

/**
 * The infected (the owner, 2026-11-15: "they need to know how to kill zombies that are trying to kill them"): one
 * that is after somebody within a few strides of it, or any at arm's length, is turned on and shot, the head as often
 * as a hurried shot finds it, before anything else it was about. True when it is busy with one.
 */
function zeds(n: Npc, now: number, dt: number): boolean {
  if (n.dry) return false;
  let best: (typeof horde.bodies extends Map<number, infer B> ? B : never) | null = null, bd = n.state === 'fight' ? 6 : 16;
  for (const b of horde.bodies.values()) {
    if (b.diedAt) continue;
    const d = Math.hypot(b.s[0] - n.pose[0], b.s[2] - n.pose[2]);
    if (d >= bd || Math.abs(b.s[1] - n.pose[1]) > 3 || (d > 5 && b.s[4] !== I_CHASE && b.s[4] !== I_ATTACK)) continue;
    if (!clear(eyeOf(n.pose), [b.s[0], b.s[1] + 1.3, b.s[2]], true)) continue;
    best = b;
    bd = d;
  }
  if (!best) return false;
  n.to = null;
  n.vx = n.vz = 0;
  n.lie = false;
  n.lootAt = 0;
  face(n, yawTo(n.pose[0], n.pose[2], best.s[0], best.s[2]), dt, 9);
  n.pose[4] = 0;
  n.pose[5] = flagsOf(n, false, true, false);
  if (now < n.nextShot || Math.abs(wrap(yawTo(n.pose[0], n.pose[2], best.s[0], best.s[2]) - n.pose[3])) > 0.3) return true;
  if (n.mag <= 0) {
    reload(n);
    n.nextShot = now + 2400;
    return true;
  }
  const o = eyeOf(n.pose), head = Math.random() < 0.3, at: Vec3 = [best.s[0], best.s[1] + (head ? 1.6 : 1.2), best.s[2]];
  const len = Math.max(0.001, Math.hypot(at[0] - o[0], at[1] - o[1], at[2] - o[2]));
  broadcastNear({ t: 'shot', id: n.id, o: [o[0], o[1] - 0.12, o[2]], d: [(at[0] - o[0]) / len, (at[1] - o[1]) / len, (at[2] - o[2]) / len], w: n.w, sup: false }, o[0], o[2], 700);
  n.mag--;
  n.nextShot = now + Math.max(160, (WEAPON_RULES[n.w]?.interval ?? 0.2) * 1000 * rnd(1.4, 2.4));
  // (a moving, lurching thing: nine in ten at arm's length, half at fifteen metres)
  if (Math.random() > Math.min(0.9, 1.05 - bd * 0.035) * n.skill) return true;
  const zone: HitZone = head ? 'head' : 'torso', r = horde.hurt(best.i, hitDamage(n.w, zone, bd), now);
  if (!r) return true;
  const flat = Math.max(0.001, Math.hypot(best.s[0] - o[0], best.s[2] - o[2])), dir: [number, number] = [(best.s[0] - o[0]) / flat, (best.s[2] - o[2]) / flat];
  const body = r.dead ? infectedBody(best, dir) : undefined;
  broadcast({ t: 'ihp', i: best.i, hp: r.hp, dead: r.dead, by: n.id, zone, dir, ...(body ? { body } : {}) });
  return true;
}

function calm(n: Npc, now: number) {
  n.state = 'roam';
  n.foe = 0;
  n.to = null;
  n.cover = n.peek = null;
  n.lie = false;
  n.lootAt = 0;
  n.seek = 0;
  n.aware.clear();
  n.gaze = NaN;
  n.pace = NPC.walk;
  n.waitUntil = now + rnd(2000, 6000);
  n.pose[4] = 0;
  n.pose[5] = F_GROUND;
}

/** Ten times a second: those near anybody think and move; the dead are cleared away, and the owed come. */
export function npcsTick(now: number, dt: number) {
  // (one that finds no place now tries again in a while: with somebody at every place, say)
  for (let k = owed.length - 1; k >= 0; k--) {
    if (now < owed[k].at) continue;
    const n = spawn(now, owed[k].zone);
    if (!n) {
      owed[k].at = now + 5000;
      continue;
    }
    owed.splice(k, 1);
    // (and as often as not another owed to the same land comes with it)
    const two = owed.findIndex((o) => o.zone === n.zone);
    if (two >= 0 && Math.random() < NPC.duo && spawn(now, n.zone, n)) owed.splice(two, 1);
    break;
  }
  const people = [...clients.values()].filter((c) => c.alive);
  routesLeft = 1;
  for (const n of [...npcs.values()]) {
    if (!n.alive) {
      if (now - n.diedAt > 20000) {
        npcs.delete(n.id);
        broadcast({ t: 'leave', id: n.id });
        owed.push({ at: now + rnd(NPC.back[0], NPC.back[1]) * 1000, zone: n.zone });
      }
      continue;
    }
    // (nobody near, and no other of them at it: it stands as it is)
    if (!NPC.awake && !people.some((c) => Math.hypot(c.pose[0] - n.pose[0], c.pose[2] - n.pose[2]) < NPC.near) && now - n.hitAt > 30000 && !(n.state === 'fight' && n.foe >= NPC_FROM)) {
      if (n.state !== 'roam') calm(n, now);
      n.vx = n.vz = 0;
      continue;
    }
    // (a dressing on: a wound it has had a moment's peace with, behind its cover or with nobody to fight)
    if (n.healAt && now >= n.healAt) {
      n.healAt = 0;
      n.bandages--;
      n.hp = Math.min(NPC.hp, n.hp + 45);
      if (SAY) log(`[npc ${n.id}] dressed, ${Math.round(n.hp)}`);
    }
    if (!n.healAt && n.hp < 60 && n.bandages > 0 && now - n.hitAt > 2500 && (n.state !== 'fight' || n.act === 'hide')) {
      n.healAt = now + 3500;
      if (n.state === 'fight') n.until = Math.max(n.until, now + 3600);
    }
    if (zeds(n, now, dt)) continue;
    // (whoever it has had in view long enough to know of, the nearest: it is after them. One it only half knows of it
    // stops and looks toward, as somebody does who thinks they saw something move)
    n.wary = NaN;
    if (n.state !== 'fight' && !n.dry) {
      const seenBy: { c: Foe; d: number }[] = [], keen = n.state !== 'roam';
      let wd = Infinity;
      const look = (c: Foe, far: number) => {
        const d = Math.hypot(c.pose[0] - n.pose[0], c.pose[2] - n.pose[2]);
        if (d > far) return;
        const [vx, vz] = going(c), t = noticeIn(n.pose, c.pose, keen, Math.hypot(vx, vz));
        let a = n.aware.get(c.id) ?? 0;
        if (t === Infinity) {
          if ((a -= dt / 4) > 0) n.aware.set(c.id, a);
          else n.aware.delete(c.id);
          return;
        }
        n.aware.set(c.id, (a = Math.min(1, a + dt / (keen ? t * 0.5 : t))));
        if (a >= 1) seenBy.push({ c, d });
        else if (a > 0.3 && d < wd) (wd = d), (n.wary = yawTo(n.pose[0], n.pose[2], c.pose[0], c.pose[2]));
      };
      for (const c of people) if (fair(c)) look(c, SIGHT.feels);
      // (and any other of them but the one it keeps with)
      for (const o of npcs.values()) if (o !== n && o.alive && o.id !== n.mate) look(o, SIGHT.sees);
      seenBy.sort((a, b) => a.d - b.d);
      if (seenBy[0]) onTo(n, seenBy[0].c, now);
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
        // (a look this way and that, each held a moment, as a head turns: not a turning on the spot)
        if (isNaN(n.gaze) || now > n.gazeAt) (n.gaze = n.pose[3] + rnd(-1.7, 1.7)), (n.gazeAt = now + rnd(1200, 2600));
        face(n, n.gaze, dt, 3);
        // (nobody where they were: after a look about, on the way they were going, twice, before it gives them up)
        if (n.state === 'hunt' && n.seek > 0) {
          if (!n.seekAt) n.seekAt = now + rnd(1500, 3000);
          else if (now > n.seekAt) {
            const a = (Math.hypot(n.lastV[0], n.lastV[1]) > 1 ? Math.atan2(n.lastV[0], n.lastV[1]) : rnd(0, Math.PI * 2)) + rnd(-0.6, 0.6), d = rnd(10, 18);
            const x = n.pose[0] + Math.sin(a) * d, z = n.pose[2] + Math.cos(a) * d;
            if (standAt(x, z, ground.height(x, z) + 0.3) !== null) n.to = { x, z };
            n.pace = NPC.walk;
            n.seek--;
            n.seekAt = 0;
            if (SAY) log(`[npc ${n.id}] lost them: looking on`);
          }
        }
      }
      n.pose[5] = flagsOf(n, moving, !moving, n.state === 'alert' && !moving);
      if (now > n.until) calm(n, now);
      continue;
    }
    if (!isNaN(n.wary)) {
      n.vx = n.vz = 0;
      face(n, n.wary, dt, 3.5);
      n.pose[5] = n.lie ? F_GROUND | F_PRONE : flagsOf(n, false, false, false);
      continue;
    }
    // (the second of two: by the first, down where it is down)
    const lead = n.mate && n.mate < n.id ? npcs.get(n.mate) : undefined;
    if (lead?.alive) {
      const d = Math.hypot(lead.pose[0] - n.pose[0], lead.pose[2] - n.pose[2]);
      // (up the stairs after it, where it has gone up; and one that finds no way to it waits a while before it looks again)
      const far = d > 7 || Math.abs(lead.pose[1] - n.pose[1]) > 1.5;
      if (far && now > n.waitUntil && (!n.to || Math.hypot(n.to.x - lead.pose[0], n.to.z - lead.pose[2]) > 6)) {
        const a = rnd(0, Math.PI * 2), y = lead.pose[1];
        n.to = { x: lead.pose[0] + Math.cos(a) * 3, z: lead.pose[2] + Math.sin(a) * 3, y };
        const s = standAt(n.to.x, n.to.z, y);
        if (s === null || Math.abs(s - y) > 0.6) n.to = { x: lead.pose[0], z: lead.pose[2], y };
      }
      n.pace = d > 14 ? NPC.jog : NPC.walk;
      const moving = !!n.to && (d > 2.5 || far) && step(n, dt);
      if (moving) face(n, Math.atan2(-n.vx, -n.vz), dt, 6);
      else {
        if (n.to && far) n.waitUntil = now + rnd(4000, 8000);
        n.to = null;
        n.vx = n.vz = 0;
        if (lead.lie) face(n, lead.pose[3] + 0.5, dt, 2);
      }
      n.pose[5] = !moving && lead.lie && d < 12 ? F_GROUND | F_PRONE : flagsOf(n, moving, false, !moving && lead.lootAt > 0);
      continue;
    }
    // (about its place: to somewhere near, a stand, and on)
    if (!n.to && now > n.waitUntil) {
      n.lie = false;
      n.lootUid = '';
      // (now and then on to another place of its land where none of them is; and far from its place, toward it a stretch at a time)
      const reach = Math.max(30, n.home.r) + 25, off = () => Math.hypot(n.home.x - n.pose[0], n.home.z - n.pose[2]);
      if (off() <= reach && Math.random() < 0.35) n.home = place(n.zone) ?? n.home;
      for (let go = 0; go < 8 && !n.to && off() > reach; go++) {
        const a = Math.atan2(n.home.x - n.pose[0], n.home.z - n.pose[2]) + rnd(-0.6, 0.6), d = rnd(35, 55), x = n.pose[0] + Math.sin(a) * d, z = n.pose[2] + Math.cos(a) * d;
        if (standAt(x, z, ground.height(x, z) + 0.3) !== null) n.to = { x, z };
      }
      const onward = !!n.to, r = onward ? 1 : Math.random();
      n.plan = r < 0.25 ? 'lie' : r < 0.6 ? 'loot' : 'walk';
      if (n.plan === 'loot') {
        const l = lootNear(n);
        if (l) (n.to = { x: l.x, z: l.z }), (n.lootUid = l.uid);
      } else if (n.plan === 'lie') n.to = lieSpot(n);
      if (!n.to) n.plan = 'walk';
      // (as often as not into a building of the place, to stand about in it as somebody looting or lying in wait does)
      const inside = Math.random() < 0.5, wantUp = Math.random() < 0.7;
      let flat: { x: number; z: number } | null = null;
      for (let go = 0; go < (inside ? 40 : 12) && !n.to && n.plan === 'walk'; go++) {
        const a = rnd(0, Math.PI * 2), d = rnd(inside ? 0 : 8, Math.max(20, n.home.r)), x = n.home.x + Math.cos(a) * d, z = n.home.z + Math.sin(a) * d;
        if (indoors(x, z) !== inside || standAt(x, z, ground.height(x, z) + 0.3) === null) continue;
        // (and up the stairs more often than not, where a building of the place has a floor above: "go upstairs in
        // them": the first few places looked at are passed over for one that has)
        const ups = inside && wantUp ? upper(x, z) : [];
        if (inside && wantUp && !ups.length && go < 32) {
          flat ??= { x, z };
          continue;
        }
        n.to = ups.length ? { x, z, y: pick(ups) } : { x, z };
        if (SAY && ups.length) log(`[npc ${n.id}] for the floor above, ${(n.to.y! - ground.height(x, z)).toFixed(1)} m up`);
      }
      if (!n.to && n.plan === 'walk') n.to = flat;
      n.gaze = NaN;
      n.pace = onward || Math.random() < 0.4 ? NPC.jog : NPC.walk;
      n.until = now + 40000;
    }
    const moving = !!n.to && step(n, dt);
    if (moving) face(n, Math.atan2(-n.vx, -n.vz), dt, 6);
    else if (n.to || now > n.until) {
      const got = !!n.to && Math.hypot(n.to.x - n.pose[0], n.to.z - n.pose[2]) < 2 && (n.to.y === undefined || Math.abs(n.to.y - n.pose[1]) < 1.2);
      // (one that gets nowhere time after time is shut in somewhere: with nobody near to see, it is set down afresh.
      // A floor above it did not find the stairs to is not that)
      n.fails = got || !n.to ? 0 : n.to.y !== undefined ? n.fails : n.fails + 1;
      if (n.to?.y !== undefined && !got) noStairs.add(sq(n.to.x, n.to.z));
      if (SAY && n.to?.y !== undefined) log(`[npc ${n.id}] ${got ? 'upstairs' : 'did not get upstairs'}`);
      if (n.fails >= 4 && !people.some((c) => Math.hypot(c.pose[0] - n.pose[0], c.pose[2] - n.pose[2]) < 150)) {
        const at = place(n.zone);
        if (at) {
          if (SAY) log(`[npc ${n.id}] shut in at ${Math.round(n.pose[0])}, ${Math.round(n.pose[2])}: set down afresh`);
          n.pose[0] = at.x;
          n.pose[2] = at.z;
          n.pose[1] = ground.height(at.x, at.z);
          n.home = at;
          n.fails = 0;
        }
      }
      n.to = null;
      n.vx = n.vz = 0;
      if (n.plan === 'lie' && got) {
        // (down by the road, its sights along it, for a good while)
        n.lie = true;
        n.pose[3] = roadYaw(n);
        n.waitUntil = now + rnd(40000, 120000);
        if (SAY) log(`[npc ${n.id}] lying up ${Math.round(ground.road(n.pose[0], n.pose[2]))} m off a road`);
      } else if (n.plan === 'loot' && got) {
        n.lootAt = now + rnd(2000, 3500);
        n.waitUntil = n.lootAt + rnd(1500, 5000);
      } else {
        n.waitUntil = now + (indoors(n.pose[0], n.pose[2]) ? rnd(15000, 50000) : (Math.hypot(n.home.x - n.pose[0], n.home.z - n.pose[2]) > Math.max(30, n.home.r) + 25 ? rnd(300, 2500) : rnd(3000, 12000)));
        // (stood about indoors it watches out of a window or a door, not a wall)
        if (indoors(n.pose[0], n.pose[2])) n.gaze = lookOut(n);
      }
      n.plan = 'walk';
      n.until = Infinity;
    }
    // (down over what it went to, and it is picked up)
    if (n.lootAt && now >= n.lootAt) {
      n.lootAt = 0;
      pickUp(n);
    }
    if (!moving && !n.lie && !isNaN(n.gaze)) face(n, n.gaze, dt, 2);
    n.pose[5] = n.lie ? F_GROUND | F_PRONE : flagsOf(n, moving, false, !moving && n.lootAt > 0);
  }
}

/** the way out of where it stands that it can see furthest along: a window, a doorway, a street; NaN where there is none */
function lookOut(n: Npc): number {
  const o = eyeOf(n.pose), k0 = Math.floor(rnd(0, 12));
  for (const far of [40, 18]) {
    for (let k = 0; k < 12; k++) {
      const a = ((k + k0) / 12) * Math.PI * 2, x = o[0] + Math.sin(a) * far, z = o[2] + Math.cos(a) * far;
      if (clear(o, [x, ground.height(x, z) + 1.2, z], true)) return yawTo(o[0], o[2], x, z);
    }
  }
  return NaN;
}

/** A shot fired by a player: every one within its carry turns to it, takes what cover there is, and goes to see. */
export function npcsHear(x: number, z: number, range: [number, number], by: Client) {
  const now = Date.now();
  for (const n of npcs.values()) {
    if (!n.alive || n.state === 'fight' || n.dry) continue;
    const d = Math.hypot(n.pose[0] - x, n.pose[2] - z);
    if (d > Math.min(range[1], 450) || !fair(by)) continue;
    n.state = 'alert';
    n.until = now + rnd(14000, 24000);
    n.pace = NPC.jog;
    // (some of the way toward it: far enough to see who it was, not into their sights)
    const k = Math.max(0, Math.min(1, (d - 45) / d));
    // (one in a building as often as not stays in it, down, its sights to where the shot was)
    n.to = indoors(n.pose[0], n.pose[2]) && Math.random() < 0.6 ? null : { x: n.pose[0] + (x - n.pose[0]) * k, z: n.pose[2] + (z - n.pose[2]) * k };
    n.gaze = yawTo(n.pose[0], n.pose[2], x, z);
    n.gazeAt = now + 2500;
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
  if (n.hp > 0) {
    if (!fair(c)) return;
    if (n.dry) return void ((n.last = [c.pose[0], c.pose[1], c.pose[2]]), flee(n, now));
    onTo(n, c, now);
    // (a round from somebody it cannot see tells it about where they are, not where)
    if (noticeIn(n.pose, c.pose, true, 0) === Infinity) (n.last[0] += rnd(-1, 1) * d * 0.12), (n.last[2] += rnd(-1, 1) * d * 0.12);
    return;
  }
  down(n, now, c.pose[0], c.pose[2], { by: c.id, byName: c.name, w: m.w, zone: m.zone as HitZone, dist: Math.round(d) });
  log(`${c.name} killed a ${n.name} (${m.w}, ${Math.round(d)} m)`);
}

/**
 * One of the infected has struck one ('iatk' in server/handle.ts, where the one struck is no player). The owner,
 * 2026-11-15: "zombies should be able to kill bandits". Believed as a blow on a player is: by the game that moves
 * that one, within its reach, no sooner than its arm comes round.
 */
export function npcBitten(c: Client, i: number, to: number) {
  const n = npcs.get(to), b = horde.bodies.get(i), now = Date.now();
  if (!n || !n.alive || !b || !horde.strikes(i, c.id, { id: n.id, x: n.pose[0], z: n.pose[2] }, now)) return;
  n.hp -= INFECTED.damage + Math.round((Math.random() - 0.5) * 6);
  n.hitAt = now;
  if (n.hp > 0) return;
  down(n, now, b.s[0], b.s[2], { by: null, byName: null, w: 'infected', zone: 'torso', dist: 1 });
  log(`the infected killed a ${n.name}`);
}

/** Down: its body where it fell with what it had, searched as any body is, and no tag in it. */
function down(n: Npc, now: number, fx: number, fz: number, by: Pick<KillInfo, 'by' | 'byName' | 'w' | 'zone' | 'dist'>) {
  n.alive = false;
  n.diedAt = now;
  n.vx = n.vz = 0;
  n.pose[5] = F_GROUND | F_DEAD;
  const len = Math.max(0.001, Math.hypot(n.pose[0] - fx, n.pose[2] - fz));
  const way = fellWay(n.pose[3], [(n.pose[0] - fx) / len, (n.pose[2] - fz) / len]);
  const uid = `nbody_${n.id}`, box = new Container(uid, 'Body', BODY_GRID[0], BODY_GRID[1], [], true);
  const gun = stockGun(makeItem(n.w), 0);
  if (ITEMS[n.w]?.weapon?.mag) gun.mag = ITEMS[n.w].weapon!.mag!;
  stockGun(gun, Math.max(0, n.mag));
  // (all it had: the rounds it had not fired, its dressings, and what it had picked up)
  const ammo = ITEMS[n.w]?.weapon?.ammo;
  const had = [gun, ...(ammo && ITEMS[ammo] && n.rounds > 0 ? [makeItem(ammo, Math.min(n.rounds, ITEMS[ammo].stack ?? n.rounds))] : []), ...Array.from({ length: Math.min(3, n.bandages) }, () => makeItem('bandage')), ...n.pack];
  for (const it of had) box.add(it);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const body = { cid: uid, kind: 'corpse' as const, w: BODY_GRID[0], h: BODY_GRID[1], items: box.serialize().items, x: r2(n.pose[0]), y: r2(n.pose[1]), z: r2(n.pose[2]), rot: Math.round(n.pose[3] * 1000) / 1000, emptiedAt: -1, name: n.name, expires: economy.time + NPC.lies, v: way, bd: n.bd };
  for (const it of body.items) issue(it);
  boxes.set(uid, body as never);
  const k: KillInfo = { id: n.id, name: n.name, ...by, v: way };
  broadcast({ t: 'death', k, corpse: bodyInfo(body) } as S2C);
}
