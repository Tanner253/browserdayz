// The way down's stops out in the world (the owner, 2026-10-31: "go out into the world to a new poi and use it there which
// unlocks a special high tier loot room there and an alarm and a zombie event that gives the red card"; the plan,
// marketing/plan-grand-tour.html). A card from the bunker goes in a reader: a strong room opens, a siren goes, the infected
// come for as long as `hold` says, and the end of it gives the next card. Then the place is spent for a while. The rules
// only: the server runs it (server/sites.ts), and every number is here.

import { BUNKER, CAB, bunkerAt, bunkerPlan, bunkerVault, clearIn, levelAt, levelY, type Place } from './bunker';
import { inMine, MINE } from './mine';
import { BOLOTNAYA, GORODOK, KUPOL, MINE_E, MINE_W, STOLOVAYA } from './outposts';
import { DOOR, SHAFT, STATIONS, stationAt } from './train-line';
import { BOLT } from './bunker-wings';
import { townPoint, type Town } from './towns';

export type SitePhase = 'idle' | 'alarm' | 'spent';

export interface Site {
  town: Town;
  name: string;
  /** the card that starts it ('': nothing does, only a hand), and the one its end gives */
  card: string;
  gives: string;
  /** the strong room's middle and where the reader stands, in the town's frame */
  room: [number, number];
  reader: [number, number];
  /** where its crates are set down, in the town's frame: out in the world there is the one, in the strong room, with the next card in it; a level's has a locker as well, for the end of its time */
  crate: [number, number];
  locker?: [number, number];
  /** how long there is, seconds (0: the door just opens), and how long the place is spent after it */
  hold: number;
  again: number;
  /** how far off the siren is heard by the infected, metres */
  heard: number;
  /** it is on a level of the bunker, not out in the world: its frame is the bunker's (GORODOK's), and its waves come down that level's passages */
  level?: number;
  /** where something more is to be had there: a thing that lies at a spot, back so long after it is taken (seconds) */
  fuel?: { at: [number, number]; item: string; back: number };
  /** what the reader is called, and what is done at it, where it is no reader */
  what?: { use: string; doing: string; none: string };
  /** the siren does not sound */
  quiet?: boolean;
  /** what is to be turned first, in the town's frame: the strong room opens when the last is done. Time up with one left, and the place is spent for nothing. */
  steps?: { at: [number, number][]; name: string; use: string; doing: string; secs: number };
  /** how often the infected come, seconds; how many each time; the most on their feet at once; and how far out they start, metres */
  wave: { every: number; n: number; most: number; from: [number, number] };
}

export const SITES: Record<string, Site> = {
  stolovaya: {
    town: STOLOVAYA, name: 'Stolovaya', card: 'card_blue', gives: 'card_yellow',
    room: [22, -10], reader: [18.7, -12.3], crate: [22.2, -9],
    hold: 0, again: 1800, heard: 90,
    wave: { every: 28, n: 7, most: 26, from: [24, 42] },
  },
};

SITES.bolotnaya = {
  town: BOLOTNAYA, name: 'Bolotnaya', card: 'card_yellow', gives: 'card_red',
  room: [14, -14], reader: [12, -10.6], crate: [15, -13.6],
  hold: 360, again: 1800, heard: 100,
  wave: { every: 24, n: 8, most: 30, from: [20, 38] },
  steps: { at: [[-24, 8], [8, 16], [0, -24]], name: 'valves', use: 'Turn the valve', doing: 'Turning the valve', secs: 4 },
};
SITES.kupol = {
  town: KUPOL, name: 'the Kupol', card: 'card_black', gives: 'card_purple',
  room: [-12, 14], reader: [-14.2, 10.7], crate: [-13, 13.6],
  hold: 240, again: 2400, heard: 130,
  wave: { every: 20, n: 10, most: 40, from: [22, 44] },
  steps: { at: [[-12, -8], [12, -12], [0, 22]], name: 'breakers', use: 'Throw the breaker', doing: 'Throwing the breaker', secs: 4 },
};

/** Level 2's plant, and its armoury, as the plan lays them out */
const plant = () => bunkerPlan(2).made.find((m) => m.kind === 'generator')!;
const safe = () => clearIn(2, bunkerPlan(2).rooms.find((r) => r.kind === 'armoury')!);
SITES.level2 = {
  town: GORODOK, name: 'Level 2', card: 'jerrycan', gives: 'card_black', level: 2, quiet: true,
  room: [plant().r, plant().f], reader: [plant().r, plant().f + plant().d / 2 + 0.7], crate: safe()[0], locker: safe()[1],
  hold: 180, again: 1800, heard: 40,
  wave: { every: 45, n: 5, most: 16, from: [0, 0] },
  // (the owner, 2026-10-31: "gas can be found on the same level floor where required for generator always and rewspawn 5 in intervals after collected")
  fuel: { at: [-1.2, -26.5], item: 'jerrycan', back: 300 },
  what: { use: 'Pour the jerrycan into the plant', doing: 'Filling the plant', none: 'The plant is dry. There is a jerrycan on this floor' },
};

SITES.vault = {
  town: GORODOK, name: 'the vault', card: '', gives: 'night_vision', level: 3,
  room: bunkerVault().room, reader: [bunkerVault().breaker[0], bunkerVault().breaker[1] + 1], crate: bunkerVault().clear[0], locker: bunkerVault().clear[1],
  hold: 240, again: 3600, heard: 70,
  wave: { every: 24, n: 9, most: 32, from: [0, 0] },
  what: { use: 'Throw the vault breaker', doing: 'Throwing the breaker', none: '' },
};

/** where each pass comes from, as a locked thing says it: nothing that stops you leaves you guessing */
export const PASS_FROM: Record<string, string> = { card_blue: 'found on Level 1 of Bunker 17', card_yellow: 'from the strong room at Stolovaya', card_red: 'from the strong room at Bolotnaya', card_black: 'from the locker on Level 2', card_purple: 'from the strong room at the Kupol' };

/**
 * The way down in order, as the map tells it (the owner, 2026-10-31: "is it intuitive to the user what steps are required next"): each stop, what it asks and where it is.
 * The pass in your pockets says which you are at; the figures are the sites' own.
 */
export const WAY: { pass: string; name: string; say: string; x: number; z: number }[] = [
  { pass: '', name: 'Bunker 17', say: 'Find a blue clearance pass on Level 1 of Bunker 17', x: GORODOK.x, z: GORODOK.z },
  { pass: 'card_blue', name: 'Stolovaya', say: 'Stolovaya: the blue pass unlocks the strong room, and the yellow pass is inside', x: STOLOVAYA.x, z: STOLOVAYA.z },
  { pass: 'card_yellow', name: 'Bolotnaya', say: `Bolotnaya: scan the yellow pass and turn ${SITES.bolotnaya.steps!.at.length} valves in ${SITES.bolotnaya.hold / 60} minutes to open the room with the Level 2 keycard`, x: BOLOTNAYA.x, z: BOLOTNAYA.z },
  { pass: 'card_red', name: 'Bunker 17', say: 'Bunker 17: the Level 2 keycard opens the goods lift at the end of Level 1. On Level 2, pour a jerrycan into the plant', x: GORODOK.x, z: GORODOK.z },
  { pass: 'card_black', name: 'The Kupol', say: `The Kupol: scan the black pass and throw ${SITES.kupol.steps!.at.length} breakers in ${SITES.kupol.hold / 60} minutes to open the room with the Level 3 keycard`, x: KUPOL.x, z: KUPOL.z },
  { pass: 'card_purple', name: 'Kupol station', say: 'The stair west of the Kupol: scan the Level 3 keycard at its foot and take the train', x: STATIONS[0].x + STATIONS[0].ux * SHAFT.top, z: STATIONS[0].z + STATIONS[0].vz * 6.5 },
];

/** which of those somebody is at, by the furthest pass they carry */
export function wayStep(has: (id: string) => boolean) {
  for (let k = WAY.length - 1; k > 0; k--) if (has(WAY[k].pass)) return k;
  return 0;
}

/** where a thing is said to be: on a level of the bunker, at [right, forward]; or on the ground of a town, at a place in its frame */
export type Spot = { level: number; at: [number, number] } | { town: Town; at: [number, number] } | { place: [number, number, number] };
const CABIN: [number, number] = [0, (CAB.back + CAB.front) / 2];

/** A way shut until a pass is shown to it. How long it stays open, seconds; `keep`: the pass is shown and not cancelled. */
export interface Gate { name: string; card: string; at: Spot; also?: Spot; open: number; keep?: boolean; /** what is done at it, where it wants no card */ use?: string }
export const GATES: Record<string, Gate> = {
  lift: { name: 'the goods lift', card: 'card_red', at: { level: 1, at: [BUNKER.door.half + 0.32, BUNKER.hall.back + 0.5] }, open: 1800 },
  // (it stays with whoever shows it: the yellow pass goes on to Bolotnaya, and the Pass is the long way round)
  mine: { name: 'the Old Mine', card: 'card_yellow', keep: true, at: { town: MINE_W, at: [2.6, 3.8] }, also: { town: MINE_E, at: [2.6, 3.8] }, open: 900 },
  // (the door at the foot of the Kupol's stair: while it stands open anybody can go through, and the train comes and goes by itself)
  // (the bolt-hole's hatch from under it: its wheel always turns, and on one circuit with the blast door it needs nothing from above. src/game/bolt.ts)
  bolt: { name: 'the hatch', card: '', use: 'Turn the wheel', at: { level: 2, at: [BOLT.hatch.r, BOLT.hatch.f] }, open: 14, keep: true },
  train: { name: 'the station door', card: 'card_purple', at: { place: DOOR.reader }, open: 300 },
};

/** A way from one place to another that a body is carried by, seconds on the way; shut with its `gate` */
export interface Ride { label: string; doing: string; secs: number; gate?: string; /** not offered while this gate stands open: there is no need */ unless?: string; from: Spot; to: Spot }
export const RIDES: Record<string, Ride> = {
  // (the lift itself runs by itself: src/game/lift.ts. A bar on the inside of the door it stands behind: nobody is shut in)
  lift_out: { label: 'Out by the door', doing: 'Through the door', secs: 1, unless: 'lift', from: { level: 1, at: CABIN }, to: { level: 1, at: [0, BUNKER.hall.back + 1.6] } },
  mine_in: { label: 'Go in', doing: 'Through the gate', secs: 2, gate: 'mine', from: { town: MINE_W, at: [3, 0] }, to: { place: [MINE.x0 + 1.5, MINE.y, MINE.z] } },
  mine_in_e: { label: 'Go in', doing: 'Through the gate', secs: 2, gate: 'mine', from: { town: MINE_E, at: [3, 0] }, to: { place: [MINE.x1 - 1.5, MINE.y, MINE.z] } },
  // (out is by a bar on the inside: nobody is shut in)
  mine_out: { label: 'Out by the west gate', doing: 'Through the gate', secs: 2, from: { place: [MINE.x0 + 1.5, MINE.y, MINE.z] }, to: { town: MINE_W, at: [4, 0] } },
  mine_out_e: { label: 'Out by the east gate', doing: 'Through the gate', secs: 2, from: { place: [MINE.x1 - 1.5, MINE.y, MINE.z] }, to: { town: MINE_E, at: [4, 0] } },
  // (off the platform by a bar on the inside: nobody is shut in. The train is the only way into Level 3, and the ladder the other way out of it)
  train_out: { label: 'Out by the door', doing: 'Through the door', secs: 1, from: { place: DOOR.inside }, to: { place: DOOR.outside } },
  ladder: { label: 'Climb the ladder', doing: 'Up the ladder', secs: 6, from: { level: 3, at: [0, BUNKER.hall.front - 1.4] }, to: { town: GORODOK, at: [18, 45] } },
};

/** where a spot is: x, z, and the height, or null where it is the ground's to say */
export function spotAt(s: Spot, P: Place | null): [number, number | null, number] {
  if ('level' in s) {
    const [x, y, z] = bunkerAt(P ?? { x: GORODOK.x, y: 0, z: GORODOK.z, rot: GORODOK.rot }, s.at[0], s.at[1], levelY(s.level));
    return [x, y, z];
  }
  if ('place' in s) return s.place;
  const [x, z] = townPoint(s.town, s.at[0], s.at[1]);
  return [x, null, z];
}

/** is somebody at a spot, within so many metres across? (and on its level: the levels stand one over the other) */
export function atSpot(s: Spot, P: Place | null, x: number, y: number, z: number, reach: number) {
  const [sx, , sz] = spotAt(s, P);
  if (Math.hypot(sx - x, sz - z) > reach) return false;
  if ('place' in s) return inMine(x, y, z) || stationAt(x, y, z) !== null;
  // (a level is only asked of the bunker: Bolotnaya's ground lies lower than its second)
  if (!('level' in s)) return !inMine(x, y, z);
  return !!P && y < P.y - 1 && levelAt(y + 1 - P.y) === s.level;
}

/** a site as a spot: its reader, or any other of its places */
export const siteSpot = (s: Site, at: [number, number]): Spot => (s.level ? { level: s.level, at } : { town: s.town, at });

/** a place of a site's in the world */
export const sitePoint = (s: Site, p: [number, number]): [number, number] => townPoint(s.town, p[0], p[1]);

/** which of a world's doors is a site's strong room's: the nearest to its middle */
export function strongDoor(s: Site, at: (i: number) => [number, number] | null, count: number): number {
  const [x, z] = sitePoint(s, s.room);
  let best = -1, near = 6;
  for (let i = 0; i < count; i++) {
    const d = at(i);
    if (!d) continue;
    const e = Math.hypot(d[0] - x, d[1] - z);
    if (e < near) {
      near = e;
      best = i;
    }
  }
  return best;
}

/** where one of the infected of a wave starts: `k` of `n`, on a ring about the reader, a turn apart and never in one place */
export function waveSpot(s: Site, k: number, n: number, roll: () => number): [number, number] {
  const [x, z] = sitePoint(s, s.reader), a = ((k + roll() * 0.7) / n) * Math.PI * 2, r = s.wave.from[0] + roll() * (s.wave.from[1] - s.wave.from[0]);
  return [x + Math.cos(a) * r, z + Math.sin(a) * r];
}
