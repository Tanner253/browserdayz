// The map's lines and areas: the mountain's and the loop road's lines, snow by height, the outlying places, where the play is, the hospital's grounds and the village's streets, the kinds of building and their footprints.
// (One part of worldgen.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { clamp, smoothstep } from '../../core/noise';
import { BUNKER, type Place, bunkerAt } from '../../sim/bunker';
import { BUNKER_AT, EXPANSION, LOOP, MOUNTAIN, PASS, PLAY_RADIUS, TOWN, WORLD_SEED, eastRoad } from './places';
import type { World } from './types';
import { catmullRom, heightAt } from './ground';
import { generateWorld } from './generate';

/**
 * The world made without the mountain road and the fort's place (the tenth step, below): the ground as every step
 * before it leaves it. For whoever must show what that step moved and what it did not (test/expansion.test.ts:
 * the mountain the fort once stood on is the ground it was), and for nothing in the game.
 */
export const leftOut = { mountain: false };

export function worldWithoutMountain(seed = WORLD_SEED): World {
  leftOut.mountain = true;
  try {
    return generateWorld(seed);
  } finally {
    leftOut.mountain = false;
  }
}

/** The mountain road as a line over the ground, told off every four metres. */
export function mountainLine(): [number, number][] {
  return catmullRom(MOUNTAIN.road, 4);
}

/**
 * The first road's line: the points it was drawn through, west to east. (Its points are told off from these, four
 * metres apart: jeeps and street lamps go by their numbers, and the west pass by where the first of them lie.)
 */
export const OLD_ROAD: [number, number][] = [[-540, -150], [-380, -110], [-250, -70], [-130, -25], [-40, 4], [30, 12], [110, 30], [190, 70], [300, 140], [420, 190], [540, 230]];

/** the line the new road takes out of Kamenka: from the end of its street (the last point of `eastRoad`) to the bridge's near end */
export function doorRoad(): [number, number][] {
  return [eastRoad()[eastRoad().length - 1], ...LOOP.door];
}

let loopKept: { door: [number, number][]; main: [number, number][]; west: number; old: number } | null = null;

/**
 * The new road as lines over the ground, each told off every four metres: `door`, from the end of Kamenka's
 * street to the bridge; and `main`, from the bridge's far end along the shelf and down the west pass to its foot
 * on the old road. In `main` the west pass begins at point `west`, and from point `old` on its points are the old
 * road's own first points, each where it was.
 */
export function loopLine() {
  if (loopKept) return loopKept;
  const door = catmullRom(doorRoad(), 4);
  const shelf = catmullRom([LOOP.bridge, ...LOOP.shelf], 4);
  const head = catmullRom([LOOP.shelf[LOOP.shelf.length - 1], ...LOOP.west, OLD_ROAD[0]], 4);
  const first = catmullRom(OLD_ROAD, 4);
  // (the old road's own points, from its first to the last of them that lies west of the foot)
  const down: [number, number][] = [];
  for (let i = 1; i < first.length && first[i][0] <= LOOP.foot; i++) down.push(first[i]);
  return (loopKept = { door, main: [...shelf, ...head.slice(1), ...down], west: shelf.length - 1, old: shelf.length + head.length - 2 });
}

/** how far a spot is from a line of points, metres */
export function offLine(line: [number, number][], x: number, z: number, from = 0, to = line.length - 1): number {
  let best = 1e9;
  for (let k = from; k < to; k++) {
    const [ax, az] = line[k], dx = line[k + 1][0] - ax, dz = line[k + 1][1] - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * The ground the loop was allowed to move, for whoever asks that nothing else has (test/expansion.test.ts): as
 * far from the new road as its banks reach, the west pass as far as it was laid back, and the lay-by.
 */
export function loopFence(x: number, z: number): boolean {
  const L = loopLine();
  if (Math.hypot(x - LOOP.layby.at[0], z - LOOP.layby.at[1]) < LOOP.layby.long + LOOP.layby.off) return true;
  if (offLine(L.door, x, z) < LOOP.banks.door.reach + 3) return true;
  if (offLine(L.main, x, z, 0, L.west) < LOOP.banks.shelf.reach + 3) return true;
  // (the west pass, and where the shelf road widens into it: as far down as its foot, and nothing beyond the line
  // drawn across the road there)
  const n = L.main.length, [bx, bz] = L.main[n - 1], ox = bx - L.main[n - 2][0], oz = bz - L.main[n - 2][1];
  return ((x - bx) * ox + (z - bz) * oz) / Math.hypot(ox, oz) < 3 && offLine(L.main, x, z, Math.max(0, L.west - 20)) < PASS.reach + 3;
}

/**
 * One mountain (2026-10-13: "i want high elevation mountains to be snowcapped, and the surrounding area
 * snowcapped"). The edge of the map stood at the same height all the way round, 130 to 180 m: a wall, and nothing
 * to steer by. In the north-east, behind the bunker, it stands `lift` times as high over its shelf, and its slope
 * begins at the old map's edge and not 70 m beyond it: about 280 m at its top, a hundred over anything else, in
 * plain sight from the village, the checkpoint and the works. The best of everything is under the highest ground,
 * as in DayZ the richest place is the furthest hill; and whoever is lost looks for the white one.
 *
 * Between `from` and `to`, degrees as Math.atan2(z, x) gives them (north is -z, so these are north-east), and
 * fading out over `soft` either side. It is all on the ground the map was grown by: nothing of the old map moves.
 * (The Logging Camp, at -65 degrees, is just outside it.)
 */
export const PEAK = { from: -54, to: -22, soft: 9, lift: 2.4, run: 250 };

export const peakOf = (x: number, z: number) => {
  const a = (Math.atan2(z, x) * 180) / Math.PI;
  return smoothstep(PEAK.from - PEAK.soft, PEAK.from, a) * (1 - smoothstep(PEAK.to, PEAK.to + PEAK.soft, a));
};

/**
 * Where snow lies, metres up: none below `from`, all of the ground white above `full`, and none on ground steeper
 * than `slope` (it does not lie on a cliff). The trees thin out from `thin` and stop at `bare`.
 */
export const SNOW = { from: 132, full: 150, slope: 0.9, thin: 190, bare: 215 };

/** And two places far out in that country, outside the Zona: nothing is earned at them, and nobody is looking. */
export const OUTLYING: { name: string; kind: 'squat' | 'camp'; x: number; z: number; rot: number }[] = [
  { name: "Squatters' House", kind: 'squat', x: -100, z: 640, rot: Math.PI },
  { name: 'Logging Camp', kind: 'camp', x: 300, z: -640, rot: 0 },
];

/** how near the bunker, the way out to the town and the town itself nobody is set down when they start (metres) */
export const NO_START = { bunker: 190, gate: 200, town: 320 };

/** the rounds of the Zona there were before the road was made a loop: the valley, the works, the bunker, the way over to the town, the town */
export const PLAY_FIRST = 5;

export const PLAY_AREAS: { x: number; z: number; r: number }[] = [
  { x: 0, z: 0, r: PLAY_RADIUS },
  { x: EXPANSION.x, z: EXPANSION.z, r: EXPANSION.floor + EXPANSION.wall },
  { x: BUNKER_AT.x, z: BUNKER_AT.z, r: BUNKER.floor + BUNKER.wall },
  TOWN.gate,
  { x: TOWN.x, z: TOWN.z, r: TOWN.r },
  ...loopRounds(),
];

/**
 * The Zona grown to take the loop in (2026-10-12: "run the road through the wilderness (expanding the zona where
 * tags can be redeemed)"): rounds strung along the new road (see LOOP.zona), after the five there were. With the
 * valley's own round they are one piece of ground with no hole in it: the road, the woods outside it, and
 * everything between the road and the valley.
 */
function loopRounds(): { x: number; z: number; r: number }[] {
  const L = loopLine(), out: { x: number; z: number; r: number }[] = [];
  const along = (line: [number, number][]) => {
    for (let i = 0; i < line.length; i += LOOP.every / 4) {
      const [x, z] = line[i], d = Math.hypot(x, z) || 1;
      // (its middle toward the middle of the map, where the valley is)
      const cx = x - (x / d) * LOOP.inward, cz = z - (z / d) * LOOP.inward;
      const r = Math.min(LOOP.zona, ...OUTLYING.map((o) => Math.hypot(cx - o.x, cz - o.z) - LOOP.clear));
      if (r > 20) out.push({ x: Math.round(cx), z: Math.round(cz), r: Math.round(r) });
      // (and where the road lies so far out that such a round does not reach the valley's own, one more between the
      // two: nothing inside the loop is left outside the line)
      const gap = d - LOOP.inward - LOOP.zona - PLAY_RADIUS;
      if (gap > -30) out.push({ x: Math.round((x / d) * (PLAY_RADIUS + gap / 2)), z: Math.round((z / d) * (PLAY_RADIUS + gap / 2)), r: Math.round(gap / 2 + 55) });
    }
  };
  along(L.door);
  along(L.main);
  // (and up the mountain road to where it ends, with the rounds about the track and the fort: see MOUNTAIN.zona)
  along(mountainLine());
  out.push(...MOUNTAIN.zona.map((q) => ({ ...q })));
  return out;
}

/** Where the bunker stands in a world, and which way it faces: its pad's own level, not the hole under it. Null in a world that has none. */
export function bunkerPlace(world: Pick<World, 'sites' | 'heights'>): Place | null {
  const s = world.sites.find((q) => q.kind === 'bunker');
  if (!s) return null;
  const flat = { x: s.x, y: 0, z: s.z, rot: s.rot };
  // (the level ground beside the pad: under the pad itself the ground is dug away)
  const [x, , z] = bunkerAt(flat, BUNKER.pad.r + 3, 0);
  return { ...flat, y: heightAt(world.heights, x, z) };
}

/** is this place inside the part of the map that is played in */
export function inPlay(x: number, z: number, margin = 0): boolean {
  return PLAY_AREAS.some((a) => Math.hypot(x - a.x, z - a.z) < a.r - margin);
}

/**
 * The line round the played part of the map: for each of its rounds, the arcs of it that are
 * not inside another (angles as Math.atan2(z, x) gives them, each arc going the positive way
 * from `from` to `to`).
 */
export function playOutline(): { x: number; z: number; r: number; from: number; to: number }[] {
  const out: { x: number; z: number; r: number; from: number; to: number }[] = [];
  const TAU = Math.PI * 2, turn = (t: number) => ((t % TAU) + TAU) % TAU;
  // (a round wholly inside another has no edge of its own: of two the same, the first is kept)
  const within = (a: (typeof PLAY_AREAS)[number], b: (typeof PLAY_AREAS)[number]) => Math.hypot(b.x - a.x, b.z - a.z) + a.r <= b.r;
  const rounds = PLAY_AREAS.filter((a, i) => !PLAY_AREAS.some((b, j) => j !== i && within(a, b) && (!within(b, a) || j < i)));
  for (const a of rounds) {
    // where its edge goes into another round, or comes out of one
    let marks: number[] = [];
    for (const b of rounds) {
      if (a === b) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d >= a.r + b.r || d <= Math.abs(a.r - b.r)) continue;
      const mid = Math.atan2(b.z - a.z, b.x - a.x), half = Math.acos((a.r * a.r + d * d - b.r * b.r) / (2 * a.r * d));
      marks.push(turn(mid - half), turn(mid + half));
    }
    if (!marks.length) {
      out.push({ ...a, from: 0, to: TAU });
      continue;
    }
    marks.sort((p, q) => p - q);
    marks = marks.filter((m, k) => k === 0 || m - marks[k - 1] > 1e-9);
    // (Between one mark and the next the edge is all inside another round or all outside every one: its middle says
    // which. With five rounds, none of which lay over two others at one place, the end of each cut was the start of
    // an arc; with rounds strung along a road, three and four deep, it is not.)
    const free = marks.map((m, k) => {
      const t = (m + (k + 1 < marks.length ? marks[k + 1] : marks[0] + TAU)) / 2, x = a.x + Math.cos(t) * a.r, z = a.z + Math.sin(t) * a.r;
      return !rounds.some((b) => b !== a && Math.hypot(x - b.x, z - b.z) < b.r - 1e-9);
    });
    for (let k = 0; k < marks.length; k++) {
      if (!free[k] || free[(k + marks.length - 1) % marks.length]) continue;
      let last = k;
      while (free[(last + 1) % marks.length] && last - k < marks.length) last++;
      let to = marks[(last + 1) % marks.length];
      while (to <= marks[k]) to += TAU;
      out.push({ ...a, from: marks[k], to });
    }
  }
  return out;
}

/**
 * Where the hospital stands in Kamenka: metres to the right of its street (looking down it), and along it from the
 * town's middle. (Along: its door is opposite the middle of the way through between the plank house and the brick
 * block, where its drive comes in. It stood 3.3 m short of that.)
 */
export const HOSPITAL_AT = { right: 46, along: -0.7 };

/**
 * The hospital's grounds (2026-10-12: "the surroundings are boring, the path to the hospital is boring, everything
 * is too plain"), in the hospital's own measure: x along its front the way the street runs on, z out from its
 * middle towards the street. Its front wall is at z = 8, the middle of the street at z = 46.
 *
 * A yard level with its floor before it, round its ends and behind it. A drive of asphalt in from the street,
 * between the two houses, round to the left along its front and round its west end to the door the wounded were
 * carried in at. The ground before its doors east of the drive trodden bare. A wall of concrete slabs round all of
 * it, with slabs gone (see `planGrounds` in buildings.ts, which stands everything here that is not ground). Two
 * sheds and a barn that stood where its yard now is stand where a hospital would have them: the one behind it by
 * the boiler, for the coal; the other by the drive, the porter's; the barn clear of its east end.
 */
export const HOSPITAL_GROUNDS = {
  /** each [x from, to, z from, to] (the second is the ground round the wing behind it), and how far beyond them the ground is eased into what it was */
  yard: [[-33, 29.5, -15.5, 19.5], [-20.4, 1.2, -26.2, -15.5]] as [number, number, number, number][],
  ease: 7,
  /**
   * Its other parts (2026-10-12: "i dont like the rigid box style we have, can we not come up with more creative
   * layouts?"): each a building of its own stood against the main block, with no wall where the two meet and its
   * floors at the same heights (see Blueprint.joined in buildings.ts). [which, the x and z of its middle]: the wing
   * behind it, west of its middle; the block before its doors.
   */
  parts: [['hospital_wing', -9.6, -15], ['hospital_lobby', 0, 9.8]] as [BuildingType, number, number][],
  drive: 4.5,
  /** [which, x, z, turned from the way the hospital faces] */
  moved: [['shed_113', 12.5, -13.3, 0], ['shed_114', 6.9, 24.4, -Math.PI / 2], ['barn_115', 38, 9, 0]] as [string, number, number, number][],
  /** bare ground: lines of it, each [x, z] to [x, z] */
  bare: [[-2.5, 9.4, 21.5, 9.4], [-2.5, 11.4, 21.5, 11.4], [3, 13.4, 21.5, 13.4], [3, 15.4, 21.5, 15.4], [3.5, 17.4, 21.5, 17.4], [-26.4, 0, -23.6, 0], [2, -10, 15, -10]] as [number, number, number, number][],
  /** birches: between the drive and the backs of the houses, and at its east end */
  trees: [[-21.5, 19.2], [-15.2, 19.4], [-9.4, 19.1], [10.8, 19.4], [16.4, 19.2], [22.2, 19.3], [-31.2, 16.8], [-31.4, -8.5], [26.6, 6.2]] as [number, number][],
};

/**
 * The police headquarters' other two parts, in the main block's own measure (x along its front, z out from its
 * middle the way it faces): [which, the x and z of its middle]. West of the yard the cells with the men's quarters
 * over them; east of it the garage. Each stands against the main block's front, 12 m out from it.
 */
export const POLICE_PARTS: [BuildingType, number, number][] = [['police_cells', -9.9, 12.5], ['police_garage', 9.9, 12.5]];

/** the line of the hospital's drive, in the hospital's own measure: from the street's edge to the door at its west end */
export function hospitalDrive(roadW: number): [number, number][] {
  const line: [number, number][] = [];
  for (let z = HOSPITAL_AT.right - (roadW / 2 - 1.1); z > 21.5; z -= 3) line.push([0, z]);
  for (let a = 0; a <= 90; a += 15) line.push([-6 + 6 * Math.cos((a * Math.PI) / 180), 21 - 6 * Math.sin((a * Math.PI) / 180)]);
  for (let x = -9; x > -22; x -= 3) line.push([x, 15]);
  for (let a = 0; a <= 90; a += 15) line.push([-22.5 - 6 * Math.sin((a * Math.PI) / 180), 9 + 6 * Math.cos((a * Math.PI) / 180)]);
  for (let z = 6; z >= -3; z -= 3) line.push([-28.5, z]);
  return line;
}

/**
 * The village's streets and what stands on them (2026-10-12: see "the village laid out as a place is", at the end
 * of the map's making). `streets`: where each side street leaves the road (metres along it from the village's
 * middle, east is on) and how far it runs north and south of it. `plots`: [building, on what, how far along, how
 * far its front is from the edge of that street]. N and S are the road's two sides; <street>E and <street>W the two
 * sides of a side street, measured from the road (south is on, north is back).
 */
export const VILLAGE_STREETS = {
  width: 5,
  /** metres of open ground between the foot of the middle street and the headquarters' front */
  forecourt: 5,
  /** how far from the village's middle any of this reaches */
  reach: 190,
  streets: { west: { s: -68, north: 0, south: 64 }, middle: { s: 20.5, north: 62, south: 80 } } as Record<string, { s: number; north: number; south: number }>,
  plots: [
    // the road's north side, west to east
    ['house_small_3', 'N', -82, 7],
    ['barn_13', 'N', -47, 11],
    ['shed_4', 'N', -34, 9],
    ['garage_54', 'N', -23, 7.5],
    ['clinic_52', 'N', 7, 7.5],
    ['house_brick_7', 'N', 31.5, 7],
    ['house_brick_9', 'N', 47, 7],
    // its south side
    ['house_small_1', 'S', -104, 7],
    ['house_brick_2', 'S', -86, 7],
    ['house_two_68', 'S', -58, 7],
    ['house_two_67', 'S', -42, 7],
    ['house_small_5', 'S', -23, 7],
    ['store_53', 'S', 31.5, 7.5],
    ['house_small_8', 'S', 46, 7],
    ['shed_19', 'S', 66, 9],
    ['house_small_11', 'S', 89, 7],
    // the west street
    ['shed_14', 'westE', 31, 4],
    ['barn_15', 'westE', 47, 6],
    // the middle street, north of the road
    ['townhouse_77', 'middleW', -34, 5],
    ['shed_17', 'middleE', -27, 4],
    ['shed_18', 'middleE', -44, 4],
    ['barn_16', 'middleW', -54, 6],
    // and south of it
    ['hut_79', 'middleW', 35, 4],
    ['shanty_78', 'middleW', 54, 4],
    ['barn_20', 'middleE', 42, 6],
  ] as [string, string, number, number][],
  /**
   * More of them (2026-10-12: "looking at the village from the sky i think we could fit more house and buildings on
   * the street, especially around the cross streets. perhaps we need a new residential building"; and, on a picture
   * of the village with four places ringed: "i feel like we could fit some new buildings in the green circles":
   * the head of the middle street, the ground east of it behind the sheds, the west side of the west street, and
   * the foot of the west street). New buildings, each after every other in the list: [what, on what, how far
   * along, how far its front is from the edge]. <street>Head and <street>Foot: across the north end of a side
   * street or its south end, looking back down it (the last number is how far beyond its end). Three blocks of
   * flats (the new kind), and houses in the gaps of the road and of both side streets.
   */
  more: [
    ['house_brick', 'N', -65, 7],
    ['house_two', 'N', 63, 7],
    ['house_brick', 'S', 110, 7],
    // the west street: its west side, and across its foot
    ['flats', 'westW', 31, 5],
    ['house_small', 'westW', 52, 5],
    ['house_two', 'westFoot', 0, 6.5],
    // the middle street north of the road: between the sheds, one set back behind them, and across its head
    ['house_small', 'middleE', -35.5, 5],
    ['house_two', 'middleE', -56, 5],
    ['house_brick', 'middleE', -30, 14],
    ['flats', 'middleHead', 0, 6.5],
    // and south of it
    ['house_small', 'middleE', 26, 5],
    ['flats', 'middleE', 57, 5],
  ] as [BuildingType, string, number, number][],
};

/** the village's second clinic and second shop: how far out along its street from its middle they are looked for a place (metres: no nearer, no farther, and where first) */
export const SERVICES = { from: 68, to: 116, out: 90 };

export type BuildingType = 'house_small' | 'house_brick' | 'barn' | 'shed' | 'cabin' | 'guardpost' | 'police' | 'clinic' | 'store' | 'barracks' | 'garage' | 'house_two' | 'tower' | 'hut' | 'townhouse' | 'shanty' | 'tent' | 'hospital' | 'police_hq' | 'hospital_wing' | 'hospital_lobby' | 'police_cells' | 'police_garage' | 'flats'
  // (2026-10-16: the new towns' own, see src/world/town-plans.ts)
  | 'cathedral' | 'belfry' | 'cells' | 'refectory' | 'abbot' | 'tavern' | 'merchant' | 'smithy' | 'izba' | 'izba_two' | 'chapel' | 'sawmill'
  // (the brick works by the river, its walls dressed in the factory and apartments facade kits: src/world/zavod-plans.ts)
  | 'works_hall' | 'works_office' | 'zavod_flats'
  // (the cathedral's cross: an arm each side of its nave, the apse at its east end)
  | 'cathedral_arm' | 'cathedral_apse';

/** footprint (x = width, z = depth) in metres, used for terrain pads + spacing */
export const BUILDING_FOOTPRINT: Record<BuildingType, [number, number]> = {
  house_small: [8, 6.5],
  house_brick: [10.5, 7.5],
  barn: [12, 8],
  shed: [4, 3.2],
  cabin: [6, 5],
  guardpost: [4.4, 4.4],
  police: [14, 9],
  clinic: [11, 7.5],
  store: [10, 7],
  barracks: [13, 6.5],
  garage: [9, 7],
  house_two: [9, 7],
  tower: [6, 6],
  // (the long plastered hut: its walls, not its eaves)
  hut: [13.6, 5],
  // (two downloads that are whole buildings, rooms and stairs and all: the brick block of two floors, and the plank house on piles)
  townhouse: [11.4, 14.6],
  shanty: [9.9, 15.9],
  // (the army's tent, another download gone into whole: its cloth, without the ropes)
  tent: [6.3, 8.5],
  // (2026-10-11: the district hospital, three floors and the roof; and the police headquarters, two: see src/world/big-buildings.ts)
  hospital: [46, 16],
  // (a building that is not one box is several stood against one another: see Blueprint.joined in buildings.ts)
  hospital_wing: [12.8, 14],
  hospital_lobby: [12.8, 3.6],
  police_cells: [10.2, 12],
  police_garage: [10.2, 12],
  police_hq: [30, 13],
  // (2026-10-12: a block of four flats, the village's new kind of house: see flatsPlan in big-buildings.ts)
  flats: [13, 8.6],
  cathedral: [24, 13],
  belfry: [6, 6],
  cells: [36, 9],
  refectory: [22, 10],
  abbot: [10, 8],
  tavern: [14, 10],
  merchant: [11, 9],
  smithy: [10, 7],
  izba: [8, 6.5],
  izba_two: [9, 8],
  chapel: [9, 6],
  sawmill: [20, 7],
  cathedral_arm: [5, 9],
  cathedral_apse: [6, 8],
  works_hall: [36, 15],
  works_office: [18, 12],
  zavod_flats: [24, 9],
};

export interface BuildingPlot {
  id: string;
  type: BuildingType;
  x: number;
  z: number;
  rot: number; // radians about Y; local +Z is the front (door side)
  floorY: number;
  seed: number;
  /** how many of its loot points are kept stocked with something to fight with */
  arms?: number;
}

/** what stands at an outlying place */
export type SiteKind = 'lodge' | 'farm' | 'post' | 'yard' | 'dacha' | 'hamlet' | 'depot' | 'market' | 'works' | 'bunker' | 'town' | 'squat' | 'camp' | 'tents';

/**
 * Where the trading post stands: a meadow east of the village, 175 m out of it, a hundred from the road and
 * further than that from every other place. (Said, not looked for: the ground round it is counted out of the
 * check that nothing else on the map has moved.)
 */
export const TRADE_AT = { x: 200, z: -40 };

/** The army's camp (2026-10-10): four tents and a watchtower in a clearing of the wood south of the west road, between the trapper's camp and the old sawmill. */
export const ARMY_CAMP = { name: 'Army Camp', x: -240, z: 5 };
