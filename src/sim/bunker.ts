// The bunker: a place under the ground on the far side of the map from the Chemical Works.
// A concrete pad in a hollow of the hills, a hut on it, a stair down, and behind a steel
// door that only a keycard opens, the first level: a passage with rooms off it, no daylight,
// and lamps that mostly work. The two levels under it are sealed, for now.
//
// Rules and measurements only, shared by everything that has to agree about them: the
// ground that is dug for it (worldgen.ts), what is built in the hole (world/bunker.ts),
// where things are kept in it (buildings.ts, for the economy), and the server.
//
// Everything is said in the bunker's own measure: `r` metres to the right and `f` metres
// forward of its middle, forward being the way out (toward the middle of the map), and `y`
// metres above the pad (the first level's floor is at -depth).

export const BUNKER = {
  name: 'Bunker 17',
  /** how far its middle is from the middle of the map, straight away from the works */
  out: 452,
  /** the hollow it lies in: the level ground round it, and how far the hillside is cut back beyond that */
  floor: 30,
  wall: 44,
  /** how far the first level's floor is under the pad */
  depth: 5.2,
  /** how high its rooms are */
  tall: 3,
  /** the first level, inside its walls: right and left of the middle, back and front */
  hall: { r: 11, back: -16, front: 8 },
  /** half the width of the passage down its middle */
  passage: 1.6,
  /** where the rooms are divided along the passage */
  cross: [0, -8],
  /** the stair: half its width, where its foot is, and how far along the ground its head is from that */
  stair: { half: 1.2, foot: 8.5, run: 9 },
  /** the hut over the head of the stair */
  hut: { half: 2, back: 12.5, front: 20, tall: 2.6 },
  /** the ground that is dug out for all of it */
  pit: { r: 13.5, back: -18.5, front: 16 },
  /** the pad over the pit */
  pad: { r: 15.5, back: -20.5, front: 18.6, top: 0.25 },
  /** the door at the foot of the stair: half its width, its height, and how many seconds a keycard holds it open */
  door: { half: 1.1, tall: 2.3, open: 180 },
};

export interface Place { x: number; y: number; z: number; rot: number }

/** A spot in the bunker's own measure, as a place in the world. */
export function bunkerAt(p: Place, r: number, f: number, y = 0): [number, number, number] {
  return [p.x + r * Math.cos(p.rot) + f * Math.sin(p.rot), p.y + y, p.z - r * Math.sin(p.rot) + f * Math.cos(p.rot)];
}
/** A place in the world, in the bunker's own measure: [right, forward, above the pad]. */
export function bunkerLocal(p: Place, x: number, y: number, z: number): [number, number, number] {
  const dx = x - p.x, dz = z - p.z;
  return [dx * Math.cos(p.rot) - dz * Math.sin(p.rot), dx * Math.sin(p.rot) + dz * Math.cos(p.rot), y - p.y];
}

/** the floor of the first level, above the pad (so: a negative number) */
export const levelY = () => -BUNKER.depth;

/**
 * How far under the ground a point is, as the light goes: 0 in the open and at the head of
 * the stair, 1 in the first level and at the stair's foot.
 */
export function bunkerDark(p: Place | null, x: number, y: number, z: number): number {
  if (!p) return 0;
  const B = BUNKER, [r, f, h] = bunkerLocal(p, x, y, z);
  if (Math.abs(r) > B.pit.r || f < B.pit.back || f > B.hut.front) return 0;
  // (by how far down: nothing at the pad, all of it two metres and a half under)
  return Math.min(1, Math.max(0, (-h - 0.2) / 2.5));
}

/** Whether a point is inside the first level proper: beyond the door. */
export function inBunker(p: Place | null, x: number, y: number, z: number): boolean {
  if (!p) return false;
  const B = BUNKER, [r, f, h] = bunkerLocal(p, x, y, z);
  return Math.abs(r) < B.hall.r + 0.6 && f > B.hall.back - 0.6 && f < B.hall.front && h < -1;
}

/** The rooms off the passage: which side each is on, and from where to where along it. The last on the right is the head of the stair to the levels below, and is sealed. */
export function bunkerRooms(): { side: -1 | 1; back: number; front: number; sealed: boolean; name: string }[] {
  const B = BUNKER, cuts = [B.hall.front, ...B.cross, B.hall.back];
  const names = [['Stores', 'Guard room'], ['Armoury', 'Sick bay'], ['Plant', 'Levels 2 · 3']];
  const out: { side: -1 | 1; back: number; front: number; sealed: boolean; name: string }[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) for (const side of [-1, 1] as const) out.push({ side, front: cuts[k], back: cuts[k + 1], sealed: side === 1 && k === cuts.length - 2, name: names[k][side < 0 ? 0 : 1] });
  return out;
}

export interface BunkerShelf { r: number; f: number; turn: number; long: number; deep: number; top: number }

/**
 * The benches things are kept on: two along the back wall of each room that is open, and one
 * across its end. [where its middle is, which way it lies, how long and how deep, how high its top is above the level's floor]
 */
export function bunkerShelves(): BunkerShelf[] {
  const B = BUNKER, out: BunkerShelf[] = [];
  for (const room of bunkerRooms()) {
    if (room.sealed) continue;
    const mid = (room.back + room.front) / 2, far = room.side * (B.hall.r - 0.55);
    // along the outer wall, either side of the middle
    for (const df of [-1.9, 1.9]) out.push({ r: far, f: mid + df, turn: Math.PI / 2, long: 2.4, deep: 0.7, top: 0.92 });
    // and across the end away from the door
    out.push({ r: room.side * ((B.passage + B.hall.r) / 2 + 1.2), f: room.back + 0.6, turn: 0, long: 2.6, deep: 0.7, top: 0.92 });
  }
  return out;
}

export interface BunkerSpot { r: number; f: number; y: number; floor: boolean; surf?: { r: number; f: number; turn: number; hx: number; hz: number } }

/** Where things lie in it: two on every bench, and places on the floor for what is too long for a bench. */
export function bunkerLoot(): BunkerSpot[] {
  const B = BUNKER, out: BunkerSpot[] = [];
  for (const s of bunkerShelves()) {
    for (const k of [-0.28, 0.28]) {
      const along = s.long * k;
      const r = s.r + (s.turn ? 0 : along), f = s.f + (s.turn ? along : 0);
      out.push({ r, f, y: levelY() + s.top, floor: false, surf: { r: s.r, f: s.f, turn: s.turn, hx: s.long / 2 - 0.08, hz: s.deep / 2 - 0.06 } });
    }
  }
  for (const room of bunkerRooms()) {
    if (room.sealed) continue;
    const mid = (room.back + room.front) / 2;
    for (const [dr, df] of [[3.2, -2.2], [5.6, 1.4], [7.6, -1.2]]) out.push({ r: room.side * (B.passage + dr), f: mid + df, y: levelY(), floor: true });
  }
  // and down the passage
  for (const f of [4, -3, -10, -14.5]) out.push({ r: f % 2 ? 0.9 : -0.9, f, y: levelY(), floor: true });
  return out;
}

/** The lamps: [right, forward, how it burns: 1 steadily, 0 not at all, between: it flickers]. One to a room, three down the passage, one over the stair. */
export function bunkerLamps(): [number, number, number, number][] {
  const B = BUNKER, y = levelY() + B.tall - 0.25;
  const out: [number, number, number, number][] = [];
  bunkerRooms().forEach((room, k) => {
    if (room.sealed) return;
    out.push([room.side * (B.passage + B.hall.r) / 2, (room.back + room.front) / 2, y, [1, 0.5, 0.35, 1, 0.6][k % 5]]);
  });
  out.push([0, 5, y, 0.45], [0, -4, y, 1], [0, -13, y, 0.3]);
  out.push([0, B.stair.foot + 2.2, levelY() + 3.6, 0.6]);
  return out;
}

/**
 * How brightly a lamp burns at a moment, 0..1: a steady one always fully, the others in fits.
 * @param how its nature (see bunkerLamps) @param k which lamp it is (they do not flicker together) @param t seconds
 */
export function lampBurns(how: number, k: number, t: number): number {
  if (how >= 1) return 1;
  // (two slow waves out of step, cut off sharply: on, on, a stutter, off for a while)
  const a = Math.sin(t * (1.3 + k * 0.37) + k * 2.1), b = Math.sin(t * (7.1 + k * 1.3) + k);
  const on = a * 0.6 + b * 0.4 > 1 - how * 1.9 ? 1 : 0.06;
  return on * (0.85 + 0.15 * Math.sin(t * 31 + k));
}
