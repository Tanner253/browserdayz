// Animals (2026-10-23). The owner: "We also need animals ... it may be time to implement hunting as a food source", and
// of how: "regarding animal logic just ask what does dayz or rust do and copy/revamp their mechanics. we want meaningful
// gameplay mechanics. drops from animals should be useful"; "the bear should be dangerous ... player should be able to
// outrun it if breaks line of sight and or isnt too close when the bear first engages"; "the animal ai and migration
// should make SENSE and be balanced". The plan they said yes to: progress/animals/zona-plan-animals.png.
//
// Rules and numbers only, shared by the server (which moves every animal itself: src/sim/animal-mind.ts, server/animals.ts)
// and the game (which draws them: src/game/animals.ts). Unlike the infected, no player's game moves an animal: they live
// in the open, where the server knows all that matters (the ground, water, cliffs, trees and buildings), so nobody can
// lie about one and nobody's game does the work.
//
// Where each rule comes from, as the plan says it:
//   DayZ: herds that graze and bolt together; wolves in packs; a blade to gut and skin; raw meat and rotten meat make
//     you ill; meat goes off; pieces fall on the ground by the body.
//   Rust: the better the blade, the more is got; animal fat as fuel; hide and bone as the stuff things are made of;
//     a hurt animal breaks off.
//   Ours: scent carried on the wind; herds that leave ground where they are hunted.

/** What an animal is doing, as every game is told (the clip it plays goes by this). */
export const A_IDLE = 0, A_GRAZE = 1, A_WALK = 2, A_TROT = 3, A_RUN = 4, A_ALERT = 5, A_REST = 6, A_SWIPE = 7, A_BITE = 8, A_ROAR = 9, A_HIT = 10, A_DEAD = 11, A_DRINK = 12;

export type Biome = 'field' | 'forest' | 'rock' | 'snow' | 'desert' | 'water' | 'town';

/**
 * How it meets a person: `prey` runs; `bear` holds its ground and charges whoever comes too close or hurts it;
 * `pack` hunts together (DayZ's wolves); `tame` keeps to its farm and only shies off.
 */
export type Temper = 'prey' | 'bear' | 'pack' | 'tame';

/** One way it hurts somebody: what it is shown as, how far it reaches, how long it winds up and then stands after, what it does. */
export interface Move {
  mode: number;
  reach: number;
  windup: number;
  recover: number;
  damage: number;
  /** the chance it opens a wound */
  bleed: number;
  /** how often it is chosen beside the others */
  weight: number;
}

export interface Fight {
  /** how near somebody has to come before it goes for them, metres: by day, and by night */
  engage: [number, number];
  moves: Move[];
  /** a warning first, seconds stood facing them (a bear's roar): whoever runs at once is that much further off */
  warn: number;
  /** the rush: metres a second, and for how long it can keep it up */
  rush: number;
  rushFor: number;
  /** what it keeps up after that (a sprint is 6.2), and for how long more unless it is on them */
  chase: number;
  chaseFor: number;
  /** seconds without seeing or smelling them before it gives up; and how far from where it started before it does anyway */
  lose: number;
  leash: number;
  /** below this share of its health it breaks off and runs (Rust) */
  breakAt: number;
}

export interface Kind {
  id: string;
  name: string;
  /** the model it is drawn with (public/assets/manifest.json): a kind with none there is not stood anywhere */
  model: string;
  /** length nose to tail and height at the shoulder, metres: how big it is drawn and where it can be hit */
  len: number;
  tall: number;
  hp: number;
  /** what a hit on it does, beside what the same hit does to a person (a bear's hide and fat) */
  tough: number;
  /** metres a second */
  walk: number;
  trot: number;
  run: number;
  /** seconds it can run flat out; after that it trots */
  wind: number;
  /** the steepest ground it will cross (rise over run) */
  steep: number;
  /**
   * the kinds of country it sets foot on, but when it flees (onboarding for the owner, 2026-10-23: "deer on bare high
   * snow is wrong habitat, so keep deer to forest and meadow, below the tree line")
   */
  lives: Biome[];
  temper: Temper;
  /** metres it sees a person standing in the open by day; how well it hears (1: as a person does); metres it smells one upwind */
  sight: number;
  hear: number;
  smell: number;
  /** half the angle it sees in, radians */
  view: number;
  /** how far it runs from a fright, metres */
  flee: number;
  /** how long its body lies, seconds */
  lies: number;
  fight?: Fight;
  /** it has no gait to be drawn walking with: it stands where it was stood, grazing and looking up (a farm's cows) */
  still?: boolean;
  /** what it gives when gutted and skinned with the best blade (see BLADES): meat (the item, how many), fat, the hide, bones */
  gives: { meat: string; n: number; fat: number; hide: string | null; bones: number; feathers?: number };
}

const F = Math.PI / 180;

/**
 * Every kind. Health against a person's 100: a hunting rifle's round to the chest drops a deer, as in DayZ (the Mosin's
 * does 82; the AR's two do it); a bear takes six of those, or a dozen of the AR's, as Rust's does. The bear is
 * the danger the owner asked for: it charges faster than anybody sprints, for six seconds, after a roar; whoever was
 * more than about a dozen metres off when it roared, and kept running, is still ahead when it tires to less than a
 * sprint; in the trees it loses sight of them sooner.
 */
export const KINDS: Kind[] = [
  {
    id: 'stag', name: 'Red Deer', model: 'animal_stag', len: 2.1, tall: 1.3, hp: 80, tough: 1, walk: 1.3, trot: 4.2, run: 11, wind: 18, steep: 0.95, lives: ['field', 'forest'],
    temper: 'prey', sight: 75, hear: 1.3, smell: 70, view: 150 * F, flee: 220, lies: 600,
    gives: { meat: 'meat_venison', n: 7, fat: 2, hide: 'hide', bones: 5 },
  },
  {
    id: 'doe', name: 'Red Deer', model: 'animal_doe', len: 1.8, tall: 1.1, hp: 70, tough: 1, walk: 1.3, trot: 4.2, run: 11, wind: 18, steep: 0.95, lives: ['field', 'forest'],
    temper: 'prey', sight: 75, hear: 1.3, smell: 70, view: 150 * F, flee: 220, lies: 600,
    gives: { meat: 'meat_venison', n: 5, fat: 1, hide: 'hide', bones: 4 },
  },
  {
    id: 'bear', name: 'Brown Bear', model: 'animal_bear', len: 2.3, tall: 1.25, hp: 420, tough: 0.9, walk: 1.2, trot: 3.6, run: 9, wind: 6, steep: 1.0, lives: ['forest', 'field', 'snow', 'rock'],
    temper: 'bear', sight: 45, hear: 1, smell: 90, view: 120 * F, flee: 160, lies: 900,
    fight: {
      engage: [20, 28],
      moves: [
        { mode: A_SWIPE, reach: 2.4, windup: 0.45, recover: 0.8, damage: 28, bleed: 0.5, weight: 2 },
        { mode: A_BITE, reach: 2.1, windup: 0.6, recover: 1.0, damage: 42, bleed: 0.85, weight: 1 },
      ],
      warn: 1.3, rush: 9, rushFor: 6, chase: 5.6, chaseFor: 10, lose: 5, leash: 160, breakAt: 0.25,
    },
    gives: { meat: 'meat_bear', n: 10, fat: 6, hide: 'pelt_bear', bones: 8 },
  },
  {
    id: 'wolf', name: 'Wolf', model: 'animal_wolf', len: 1.5, tall: 0.8, hp: 120, tough: 1, walk: 1.5, trot: 4.5, run: 8.5, wind: 30, steep: 1.0, lives: ['forest', 'field', 'snow', 'rock'],
    temper: 'pack', sight: 60, hear: 1.4, smell: 120, view: 140 * F, flee: 300, lies: 600,
    fight: {
      engage: [30, 70],
      moves: [{ mode: A_BITE, reach: 1.7, windup: 0.3, recover: 0.6, damage: 12, bleed: 0.35, weight: 1 }],
      warn: 0, rush: 8.5, rushFor: 4, chase: 7, chaseFor: 120, lose: 8, leash: 260, breakAt: 0.3,
    },
    gives: { meat: 'meat_wolf', n: 4, fat: 1, hide: 'pelt_wolf', bones: 3 },
  },
  {
    id: 'cow', name: 'Cow', model: 'animal_cow', len: 2.3, tall: 1.4, hp: 220, tough: 1, walk: 0.9, trot: 2.6, run: 5, wind: 6, steep: 0.6, lives: ['field', 'town'],
    temper: 'tame', sight: 20, hear: 0.8, smell: 10, view: 160 * F, flee: 18, lies: 900, still: true,
    gives: { meat: 'meat_beef', n: 10, fat: 5, hide: 'hide', bones: 8 },
  },
];

export const KIND: Record<string, Kind> = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const kindNo = (id: string) => KINDS.findIndex((k) => k.id === id);

/**
 * A herd as it lives: which kinds are in it and how many of each, how many such herds there are, how far its ground
 * reaches, which kinds of ground it feeds and lies up on, and when in the day it is up and feeding (shares of DAY,
 * src/sim/daynight.ts: 0 first light, 0.71 dusk, 0.75 night). Outside its feeding hours it lies up in cover.
 * Deer feed at dawn and dusk and lie in the woods through the middle of the day and the night; a bear
 * keeps the day; wolves travel at dusk and in the dark.
 */
export interface HerdKind {
  id: string;
  of: [kind: string, min: number, max: number][];
  count: number;
  /** metres round its middle it keeps to; and how far apart two herds of the kind are set */
  range: number;
  apart: number;
  feed: Biome[];
  rest: Biome[];
  hours: [number, number][];
  /** it goes to water once in its feeding hours, if there is any on its ground */
  drinks: boolean;
  /** seconds before a dead one is made good, out of sight of everybody */
  respawn: number;
  /** a farm's: it lives in the yard of a place whose name says it is a farm, and nowhere else */
  farm?: boolean;
}

export const HERDS: HerdKind[] = [
  { id: 'deer', of: [['stag', 1, 1], ['doe', 2, 4]], count: 6, range: 320, apart: 450, feed: ['field'], rest: ['forest'], hours: [[0, 0.22], [0.55, 0.8]], drinks: true, respawn: 600 },
  { id: 'bear', of: [['bear', 1, 1]], count: 3, range: 420, apart: 900, feed: ['forest', 'snow'], rest: ['forest', 'snow'], hours: [[0.06, 0.7]], drinks: true, respawn: 1500 },
  { id: 'wolves', of: [['wolf', 3, 5]], count: 3, range: 650, apart: 900, feed: ['forest', 'snow', 'field'], rest: ['snow', 'forest'], hours: [[0.68, 1], [0, 0.1]], drinks: true, respawn: 900 },
  { id: 'cows', of: [['cow', 2, 3]], count: 3, range: 38, apart: 0, feed: ['field', 'town'], rest: ['field', 'town'], hours: [[0.04, 0.74]], drinks: false, respawn: 1200, farm: true },
];

/**
 * What the animals are heard to say, and how seldom (onboarding, for the owner, 2026-10-23: "we want to make sure
 * animals dont call too often so that its not annoying, as the plaeyr is surrounded by animals naturally"). Of each
 * call: the herd it is a call of, the seconds between two of one herd's (at random between the two), the shares of
 * the day it is said in (src/sim/daynight.ts: dusk 0.71, night 0.75), and how far it carries, metres. A deer's bark is
 * only ever its alarm, as the herd bolts, once a minute at most. Nobody hears two calls within `apart` seconds of
 * each other. A bear's roar, swipe and bite, a wolf's snarl and the hooves are its movements' own (src/game/animals.ts).
 */
export type Call = 'roar' | 'howl' | 'moo' | 'bark';
export const CALLS = {
  /** a stag at the rut: at dusk and first light */
  roar: { herd: 'deer', every: [360, 600] as [number, number], hours: [[0.66, 0.8], [0, 0.08]] as [number, number][], heard: 600 },
  /** a pack: by night */
  howl: { herd: 'wolves', every: [240, 420] as [number, number], hours: [[0.75, 1], [0, 0.02]] as [number, number][], heard: 900 },
  moo: { herd: 'cows', every: [120, 240] as [number, number], hours: [[0, 1]] as [number, number][], heard: 150 },
  bark: { every: 60, heard: 250 },
  apart: 45,
};

/** How the animals live together, over the whole map. */
export const ANIMALS = {
  /** the most there are ever at once (the herds above come to about a hundred) */
  max: 120,
  /** nobody within this, metres: a herd is not moved and not sent (it is where it would be by now when somebody comes) */
  wake: 400,
  /** a player is sent the ones within this, metres, four times a second within `near` and once a second further out */
  told: 300,
  near: 140,
  /** a new one is never stood within this of anybody living, metres */
  clear: 200,
  /**
   * Room between two, centre to centre, as a share of their two lengths together: half of it is touching nose to
   * tail. Of one herd a little more than that, as a herd grazes; of strangers only what keeps them out of each other.
   * (The owner: "they spawned inside eachother in the images.")
   */
  room: { herd: 0.6, other: 0.5 },
  /**
   * Where people are kept off, metres (the owner, 2026-10-23: "animals dont spawn in towns they spawn in wilderness's.
   * you have the spawwn zones backwards"): from a road's edge, a town's or village's (a place with a name sixty metres
   * across and more), a camp's (a cabin, a post, a farm: thirty and more) and a building or tower standing alone, for
   * a herd's middle (`home`) and the spots it feeds and lies up at (`spot`); where one stands or walks keeps off the
   * road only (it crosses where its way goes over; it flees past a town). A farm's cows are the one herd that lives
   * among people.
   */
  keepOff: { road: { home: 100, spot: 12, walk: 5 }, town: { home: 400, spot: 250 }, camp: { home: 250, spot: 150 }, house: { home: 150, spot: 100 } },
  /** how often the awake ones think, seconds */
  step: 0.2,
  /** what is heard of a person moving, metres (as a person hears: an animal's `hear` scales it): sprinting, jogging, walking, crouched */
  noise: { sprint: 45, jog: 24, walk: 9, crouch: 3 },
  /** a car or a jeep on the move, and a helicopter */
  engine: 120,
  rotor: 320,
  /** crouched, a person is seen at this share of the distance; lying down, this; at night, this; among trees, this */
  crouched: 0.45,
  prone: 0.25,
  night: 0.55,
  trees: 0.55,
  /** how far behind it smells somebody who is downwind of it, beside upwind (scent is carried on the wind) */
  downwind: 0.25,
  /** how fast a fright builds and dies away: it looks up at ALERT and bolts at FLEE */
  alert: 0.35,
  fleeAt: 0.75,
  calm: 0.12,
  /** a hurt one left with less than this share bleeds, and goes on bleeding (a share of all its health a second) until it drops */
  bleedBelow: 0.5,
  bleedRate: 0.012,
  /** a herd that is hunted leaves its ground (`move`), and comes home once things have been quiet (`home`, seconds) */
  pressure: { shot: 1, fled: 1, killed: 3, move: 4, fade: 240, home: 3840 },
  /** a wolf pack circles this far off whoever it hunts, and sends one in every so often */
  circle: [13, 19] as [number, number],
  dash: [2.2, 4] as [number, number],
  /** a pack hunts deer at night as well, once a night at most */
  huntsDeer: true,
};

/**
 * The wind the trees sway in (src/world/foliage.ts, `wind.uWindDir`): it blows TOWARD +x and +z. Whoever stands where
 * it comes from is smelled from `smell` off; whoever stands where it goes, from a quarter of that.
 */
export const WIND: [number, number] = [0.8, 0.6];

/** How far an animal smells somebody, by where they stand to it and the wind. */
export function smellReach(kind: Kind, ax: number, az: number, px: number, pz: number): number {
  const dx = ax - px, dz = az - pz, d = Math.hypot(dx, dz) || 1;
  // (the wind carries scent from them to it when it blows the way from them to it)
  const along = (dx * WIND[0] + dz * WIND[1]) / d;
  return kind.smell * (ANIMALS.downwind + (1 - ANIMALS.downwind) * Math.max(0, along));
}

/**
 * The blades that gut and skin, and what share of what is there each gets (Rust: a better blade, more). Nothing
 * else will do it (DayZ). The combat knife is the bayonet-knife.
 */
export const BLADES: Record<string, number> = { knife: 1, machete: 0.85, hatchet: 0.75 };

/** what a body gives to a blade: [item, how many] for each thing it gives at all */
export function yieldOf(kind: Kind, blade: number): [string, number][] {
  const g = kind.gives, out: [string, number][] = [];
  const some = (n: number) => (n > 0 ? Math.max(1, Math.round(n * blade)) : 0);
  if (some(g.n)) out.push([g.meat, some(g.n)]);
  if (some(g.fat)) out.push(['animal_fat', some(g.fat)]);
  if (g.hide) out.push([g.hide, 1]);
  if (some(g.bones)) out.push(['bones', some(g.bones)]);
  if (g.feathers) out.push(['feathers', some(g.feathers)]);
  return out;
}

/** How long gutting and skinning takes, seconds, and how near the body one has to be, metres. */
export const SKIN = { time: 6, reach: 2.6 };

/** forward on the ground for a yaw: 0 looks down -z, as a person's does */
export const fwd = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)];
export const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/**
 * One animal as every game is told of it: its number, its kind (a row of KINDS), where it is (tenths of a metre),
 * which way it faces (hundredths of a radian), what it is doing, and marks (1: it bleeds).
 */
export type AnimalRow = [i: number, k: number, x: number, z: number, yaw: number, mode: number, marks: number];
export const ROW_BLEEDS = 1;
