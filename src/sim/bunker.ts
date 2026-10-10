// The bunker: a place under the ground on the far side of the map from the Chemical Works.
// A concrete pad in a hollow of the hills, a hut on it, a stair down, and behind a steel
// door that only a keycard opens, the first level: a long passage with another across it,
// rooms off both and rooms behind rooms, no daylight, and lamps that mostly work. The two
// levels under it are sealed, for now, behind the door at the passage's far end.
//
// The level is not drawn by hand: it is laid out by rule from a number (`BUNKER.seed`), the
// same on the server and in every game, so that everything that has to agree about it does:
// the ground that is dug for it (worldgen.ts), what is built in the hole (world/bunker.ts),
// what stands in its rooms and where things are kept (buildings.ts, for the economy), and
// the server. Change the number and it is another bunker.
//
// Everything is said in the bunker's own measure: `r` metres to the right and `f` metres
// forward of its middle, forward being the way out (toward the middle of the map), and `y`
// metres above the pad (the first level's floor is at -depth).

export const BUNKER = {
  name: 'Bunker 17',
  /** the number its rooms are laid out from */
  seed: 1717,
  /** how far its middle is from the middle of the map, straight away from the works */
  out: 452,
  /** the hollow it lies in: the level ground round it, and how far the hillside is cut back beyond that */
  floor: 40,
  wall: 44,
  /** how far the first level's floor is under the pad */
  depth: 5.2,
  /** how high its rooms are */
  tall: 3,
  /** the first level, inside its walls: right and left of the middle, back and front */
  hall: { r: 20, back: -28, front: 6 },
  /** half the width of the passage down its middle, and of the one across it */
  passage: 1.7,
  across: 1.4,
  /** the stair: half its width, where its foot is, and how far along the ground its head is from that */
  stair: { half: 1.2, foot: 7.25, run: 8.25 },
  /** the hut over the head of the stair */
  hut: { half: 2.1, back: 10.8, front: 16.45, tall: 2.45 },
  /** the walled yard before its door (the house is a model, "WW2 Field Bunker": see BunkerSite): how far out it reaches either side and to the front, and which side it is open to (-1: toward -r) */
  court: { r: 2.9, front: 18.9, open: -1 },
  /** where that model's own middle stands: forward of the bunker's own, and how far it is let into the ground */
  house: { f: 13.7, sunk: 0.305 },
  /** the ground that is dug out for all of it */
  pit: { r: 22.5, back: -30.5, front: 14 },
  /** the pad over the pit */
  pad: { r: 24.5, back: -32.5, front: 16.6, top: 0.015 },
  /** the door at the foot of the stair: half its width, its height; how long it stays open once nobody is left inside, seconds; and how far out from it the lamp over it hangs */
  door: { half: 1.1, tall: 2.3, shut: 60, lamp: 0.9 },
  /** how far off its opening and shutting are heard, metres */
  heard: 170,
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

/** Whether a point is inside the first level proper: beyond the door. @param slack metres of the stair's foot counted as inside too (somebody standing in the doorway) */
export function inBunker(p: Place | null, x: number, y: number, z: number, slack = 0): boolean {
  if (!p) return false;
  const B = BUNKER, [r, f, h] = bunkerLocal(p, x, y, z);
  return Math.abs(r) < B.hall.r + 0.6 && f > B.hall.back - 0.6 && f < B.hall.front + slack && h < -1;
}

/**
 * How brightly a lamp burns at a moment, 0..1: a steady one always fully, the others in fits.
 * @param how its nature: 1 steadily, 0 not at all, between: it flickers @param k which lamp it is (they do not flicker together) @param t seconds
 */
export function lampBurns(how: number, k: number, t: number): number {
  if (how >= 1) return 1;
  if (how <= 0) return 0;
  // One slow wave, a quarter of a minute round: above a line it burns, below it it is out (the
  // line is lower the better the lamp). Only as it crosses the line does it stutter, for half a
  // second or so. (It used to be cut in and out by a second, quick wave: every such lamp in
  // sight blinked a couple of times a second, which is a disco and no bunker.)
  const d = Math.sin(t * (0.36 + (k % 7) * 0.035) + k * 2.1) - (1 - how * 1.9);
  if (d > 0.09) return 0.93 + 0.07 * Math.sin(t * 5.3 + k);
  if (d < -0.09) return 0.03;
  return Math.sin(t * 21 + k * 5) > 0.15 ? 0.95 : 0.05;
}

// ------------------------------------------------------------------ the level, laid out by rule

export type RoomKind = 'barracks' | 'mess' | 'stores' | 'armoury' | 'medical' | 'control' | 'plant' | 'workshop' | 'archive' | 'quarters' | 'cells' | 'washroom' | 'kitchen';

export interface Room {
  kind: RoomKind;
  name: string;
  r0: number;
  r1: number;
  f0: number;
  f1: number;
  /** where its ways in are: [right, forward] of the middle of each doorway */
  doors: [number, number][];
}
/** a stretch of wall, floor to ceiling (or, a lintel: from `y0` above the floor up to it) */
export interface Wall { r0: number; r1: number; f0: number; f1: number; y0?: number }
/** something off a shelf of real things (a model the game has), stood in a room. `on`: heights above its own foot at which things are kept on it. */
export interface Stood { id: string; r: number; f: number; rot: number; scale?: number; y?: number; on?: number[] }
/** something made for the bunker: [what, where its middle is on the floor, which way it faces, its size across, deep and tall] */
export interface Made { kind: 'locker' | 'generator' | 'tank' | 'console' | 'rack' | 'bench' | 'pillar' | 'bunk' | 'pipe' | 'duct' | 'sign' | 'grate' | 'cell' | 'mattress' | 'stripe' | 'stain' | 'scrawl'; r: number; f: number; rot: number; w: number; d: number; h: number; y?: number; text?: string; solid?: boolean; /** which of its kind it is: a pool of blood or what was dragged through one, white paint or red */ v?: number }
export interface Spot { r: number; f: number; y: number; floor: boolean }
export interface Plan {
  rooms: Room[];
  walls: Wall[];
  stood: Stood[];
  made: Made[];
  /** where things lie on the floor (what is on furniture is said with the furniture) and on the benches made for it */
  spots: Spot[];
  /** [right, forward, above the pad, how it burns] */
  lamps: [number, number, number, number][];
  /** the sealed way down: the middle of its door, in the wall at the passage's far end */
  sealed: [number, number];
  /** where the passage across lies along the main one */
  cross: number;
}

let made: Plan | null = null;
/** The first level as it is laid out. (Worked out once: it is the same every time.) */
export function bunkerPlan(): Plan {
  return (made ??= layOut(BUNKER.seed));
}

function layOut(seed: number): Plan {
  const B = BUNKER, H = B.hall, T = 0.3, GAP = 0.95, Y = levelY();
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const pick = <V>(list: V[]) => list[Math.floor(rnd() * list.length)];
  const round = (v: number) => Math.round(v * 2) / 2;

  const rooms: Room[] = [];
  const walls: Wall[] = [];
  /** walls as lines with ways through them, cut into stretches at the end */
  const lines: { axis: 'r' | 'f'; at: number; from: number; to: number; thick: number; gaps: number[] }[] = [];
  const line = (axis: 'r' | 'f', at: number, from: number, to: number, thick = T) => {
    const l = { axis, at, from: Math.min(from, to), to: Math.max(from, to), thick, gaps: [] as number[] };
    lines.push(l);
    return l;
  };
  const cross = round(between(-12, -8));
  // ---- the two passages: the main one from the door to the sealed door, and one across it
  const spineL = [line('f', -B.passage, H.back, cross - B.across), line('f', -B.passage, cross + B.across, H.front)];
  const spineR = [line('f', B.passage, H.back, cross - B.across), line('f', B.passage, cross + B.across, H.front)];
  const crossB = [line('r', cross - B.across, -H.r, -B.passage), line('r', cross - B.across, B.passage, H.r)];
  const crossF = [line('r', cross + B.across, -H.r, -B.passage), line('r', cross + B.across, B.passage, H.r)];

  // ---- the four blocks between them, each cut into strips, and some strips into a room and a room behind it
  for (const side of [-1, 1] as const) {
    for (const part of [0, 1] as const) {
      const f0 = part ? H.back : cross + B.across, f1 = part ? cross - B.across : H.front;
      const inner = side * B.passage, outer = side * H.r;
      // the strips, from the front of the block to its back
      const cuts = [f1];
      while (cuts[cuts.length - 1] - f0 > 11.5) cuts.push(round(cuts[cuts.length - 1] - between(5.5, 8.5)));
      if (cuts[cuts.length - 1] - f0 > 9.5 && rnd() < 0.6) cuts.push(round((cuts[cuts.length - 1] + f0) / 2));
      cuts.push(f0);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k + 1], b = cuts[k];
        if (k > 0) line('r', b, inner, outer);
        const spine = (side < 0 ? spineL : spineR)[part ? 0 : 1];
        // (the passage across is beside the first strip of a back block and the last of a front one)
        const beside = part ? (k === 0 ? crossB[side < 0 ? 0 : 1] : null) : k + 2 === cuts.length ? crossF[side < 0 ? 0 : 1] : null;
        const deep = b - a > 5 && rnd() < 0.68;
        const mid = (a + b) / 2;
        if (!deep) {
          const room: Room = { kind: 'stores', name: '', r0: Math.min(inner, outer), r1: Math.max(inner, outer), f0: a, f1: b, doors: [] };
          spine.gaps.push(mid);
          room.doors.push([inner, mid]);
          if (beside && rnd() < 0.5) {
            const at = side * round(between(8, 15));
            beside.gaps.push(at);
            room.doors.push([at, beside.at]);
          }
          rooms.push(room);
          continue;
        }
        // a room on the passage, and one behind it reached through it (and from the passage across, where that runs beside it)
        const cut = side * round(between(8, 11.5));
        const wall = line('f', cut, a, b);
        const near: Room = { kind: 'stores', name: '', r0: Math.min(inner, cut), r1: Math.max(inner, cut), f0: a, f1: b, doors: [] };
        const far: Room = { kind: 'stores', name: '', r0: Math.min(cut, outer), r1: Math.max(cut, outer), f0: a, f1: b, doors: [] };
        spine.gaps.push(mid);
        near.doors.push([inner, mid]);
        const through = round(between(a + 1.6, b - 1.6));
        wall.gaps.push(through);
        near.doors.push([cut, through]);
        far.doors.push([cut, through]);
        if (beside) {
          const at = side * round(between(Math.abs(cut) + 2, H.r - 2));
          beside.gaps.push(at);
          far.doors.push([at, beside.at]);
        }
        rooms.push(near, far);
      }
    }
  }

  // ---- what each room is: the biggest is the plant, the deepest in is the armoury, and the rest by lot
  const area = (q: Room) => (q.r1 - q.r0) * (q.f1 - q.f0);
  const depth = (q: Room) => -(q.f0 + q.f1) / 2 + Math.abs((q.r0 + q.r1) / 2) * 0.6;
  const NAMES: Record<RoomKind, string> = { kitchen: 'Kitchen', barracks: 'Barracks', mess: 'Mess', stores: 'Stores', armoury: 'Armoury', medical: 'Sick bay', control: 'Control', plant: 'Plant', workshop: 'Workshop', archive: 'Records', quarters: 'Quarters', cells: 'Cells', washroom: 'Wash room' };
  const left = [...rooms];
  const take = (best: (a: Room, b: Room) => number, kind: RoomKind, ok: (q: Room) => boolean = () => true) => {
    const q = left.filter(ok).sort(best)[0];
    if (!q) return;
    q.kind = kind;
    left.splice(left.indexOf(q), 1);
  };
  take((a, b) => area(b) - area(a), 'plant');
  take((a, b) => depth(b) - depth(a), 'armoury', (q) => area(q) > 30);
  take((a, b) => area(b) - area(a), 'barracks');
  take((a, b) => (b.f0 + b.f1) - (a.f0 + a.f1), 'control', (q) => area(q) > 24);
  take((a, b) => area(b) - area(a), 'mess');
  take((a, b) => area(a) - area(b), 'washroom');
  const lot: RoomKind[] = ['medical', 'workshop', 'stores', 'archive', 'quarters', 'cells', 'stores', 'barracks', 'workshop', 'quarters', 'stores'];
  for (const q of left) q.kind = lot.length ? lot.splice(Math.floor(rnd() * Math.min(4, lot.length)), 1)[0] : 'stores';
  // ---- ways from room to room. There was one way into most rooms, off a passage, and the place was a comb: every
  // room a dead end, and nothing to be come at from behind. A doorway is cut through the wall two rooms share,
  // where that wall is long enough for one and has none near.
  const joined = (a: Room, b: Room) => a.doors.some(([r, f]) => b.doors.some(([r2, f2]) => r === r2 && f === f2));
  const join = (a: Room, b: Room): boolean => {
    for (const axis of ['r', 'f'] as const) {
      // (a wall that runs across, axis 'r', is shared where one room's back is the other's front; one that runs along, where their sides meet)
      const at = axis === 'r' ? (Math.abs(a.f0 - b.f1) < 1e-6 ? a.f0 : Math.abs(a.f1 - b.f0) < 1e-6 ? a.f1 : null) : Math.abs(a.r0 - b.r1) < 1e-6 ? a.r0 : Math.abs(a.r1 - b.r0) < 1e-6 ? a.r1 : null;
      if (at === null) continue;
      const lo = axis === 'r' ? Math.max(a.r0, b.r0) : Math.max(a.f0, b.f0), hi = axis === 'r' ? Math.min(a.r1, b.r1) : Math.min(a.f1, b.f1);
      if (hi - lo < 3.8) continue;
      const l = lines.find((x) => x.axis === axis && Math.abs(x.at - at) < 1e-6 && x.from <= lo + 1e-6 && x.to >= hi - 1e-6);
      if (!l) continue;
      const pos = round(between(lo + 1.9, hi - 1.9));
      if (l.gaps.some((g) => Math.abs(g - pos) < 2.6)) continue;
      l.gaps.push(pos);
      const door: [number, number] = axis === 'r' ? [pos, at] : [at, pos];
      a.doors.push(door);
      b.doors.push([door[0], door[1]]);
      return true;
    }
    return false;
  };
  // A kitchen: the room beside the mess, with a way straight through to it. (One of the rooms there are two of
  // gives way to it: a store or a second set of quarters, the smallest first; failing those, whatever is there.)
  const mess = rooms.find((q) => q.kind === 'mess');
  if (mess) {
    const spare = (q: Room) => (q.kind === 'stores' || q.kind === 'quarters' || q.kind === 'workshop') && rooms.filter((x) => x.kind === q.kind).length > 1;
    const beside = [...rooms.filter(spare).sort((a, b) => area(a) - area(b)), ...rooms.filter((q) => !spare(q) && !['plant', 'armoury', 'barracks', 'control', 'mess', 'washroom', 'medical'].includes(q.kind))];
    const kitchen = beside.find((q) => joined(mess, q) || join(mess, q));
    if (kitchen) kitchen.kind = 'kitchen';
  }
  // And through the rest: every pair of rooms that share a wall is tried, in an order of the place's own, until
  // there are six more ways through; no room is given more than three ways in (its walls are for its furniture).
  {
    const pairs: [Room, Room][] = [];
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) pairs.push([rooms[i], rooms[j]]);
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    let more = 0;
    for (const [a, b] of pairs) {
      if (more >= 6) break;
      if (a.doors.length >= 3 || b.doors.length >= 3 || joined(a, b)) continue;
      if (join(a, b)) more++;
    }
  }
  const count = new Map<RoomKind, number>();
  for (const q of rooms) {
    const n = (count.get(q.kind) ?? 0) + 1;
    count.set(q.kind, n);
    q.name = NAMES[q.kind] + (rooms.filter((x) => x.kind === q.kind).length > 1 ? ` ${n}` : '');
  }

  // ---- the walls: the shell (with the way in, and the sealed way down at the far end), and every line cut at its ways through
  const D = B.door.half;
  walls.push({ r0: -H.r - 0.5, r1: -H.r, f0: H.back - 0.5, f1: H.front }, { r0: H.r, r1: H.r + 0.5, f0: H.back - 0.5, f1: H.front });
  walls.push({ r0: -H.r, r1: -D, f0: H.back - 0.5, f1: H.back }, { r0: D, r1: H.r, f0: H.back - 0.5, f1: H.back }, { r0: -D, r1: D, f0: H.back - 0.5, f1: H.back, y0: B.door.tall });
  walls.push({ r0: -H.r, r1: -D, f0: H.front - 0.4, f1: H.front }, { r0: D, r1: H.r, f0: H.front - 0.4, f1: H.front }, { r0: -D, r1: D, f0: H.front - 0.4, f1: H.front, y0: B.door.tall });
  for (const l of lines) {
    const gaps = [...l.gaps].sort((a, b) => a - b);
    let from = l.from;
    const box = (a: number, b: number, y0?: number): Wall => (l.axis === 'f' ? { r0: l.at - l.thick / 2, r1: l.at + l.thick / 2, f0: a, f1: b, y0 } : { r0: a, r1: b, f0: l.at - l.thick / 2, f1: l.at + l.thick / 2, y0 });
    for (const g of gaps) {
      if (g - GAP > from + 0.01) walls.push(box(from, g - GAP));
      walls.push(box(g - GAP, g + GAP, 2.15));
      from = g + GAP;
    }
    if (l.to > from + 0.01) walls.push(box(from, l.to));
  }

  // ---- what stands in each room
  const stood: Stood[] = [], builtList: Made[] = [], spots: Spot[] = [], lamps: [number, number, number, number][] = [];
  const SHELF = [0.38, 0.94, 1.51], BOOK = [0.39, 0.96], TOP = [1];
  for (const q of rooms) {
    const w = q.r1 - q.r0, d = q.f1 - q.f0, cr = (q.r0 + q.r1) / 2, cf = (q.f0 + q.f1) / 2;
    // is a spot by a wall clear of that room's ways in?
    const clear = (r: number, f: number, by = 1.5) => q.doors.every(([dr, df]) => Math.hypot(dr - r, df - f) > by);
    /** things stood along one wall of the room, a pace apart, facing in: [which wall, what, how far out from the wall its middle stands, how much of the wall each takes] */
    const along = (wall: 'r0' | 'r1' | 'f0' | 'f1', make: (r: number, f: number, rot: number, k: number) => void, out: number, each: number, most = 99) => {
      const onR = wall === 'r0' || wall === 'r1';
      const lo = (onR ? q.f0 : q.r0) + 0.5 + each / 2, hi = (onR ? q.f1 : q.r1) - 0.5 - each / 2;
      let n = 0;
      for (let v = lo; v <= hi + 0.01 && n < most; v += each + 0.12) {
        const r = onR ? (wall === 'r0' ? q.r0 + T / 2 + out : q.r1 - T / 2 - out) : v;
        const f = onR ? v : wall === 'f0' ? q.f0 + T / 2 + out : q.f1 - T / 2 - out;
        if (!clear(r, f, 1.35 + each / 2)) continue;
        // (facing into the room: its back to the wall)
        const rot = wall === 'r0' ? Math.PI / 2 : wall === 'r1' ? -Math.PI / 2 : wall === 'f0' ? 0 : Math.PI;
        make(r, f, rot, n++);
      }
    };
    const wallsOf: ('r0' | 'r1' | 'f0' | 'f1')[] = ['r0', 'r1', 'f0', 'f1'];
    // (the walls with no way through them, longest first: where the furniture goes)
    const free = wallsOf.filter((wl) => !q.doors.some(([dr, df]) => (wl === 'r0' ? Math.abs(dr - q.r0) < 0.5 : wl === 'r1' ? Math.abs(dr - q.r1) < 0.5 : wl === 'f0' ? Math.abs(df - q.f0) < 0.5 : Math.abs(df - q.f1) < 0.5)));
    const longest = [...wallsOf].sort((a, b) => ((b[0] === 'r' ? d : w) - (a[0] === 'r' ? d : w)) + (free.includes(b) ? 4 : 0) - (free.includes(a) ? 4 : 0));
    const put = (id: string, r: number, f: number, rot: number, o: Partial<Stood> = {}) => stood.push({ id, r, f, rot, ...o });
    const build = (kind: Made['kind'], r: number, f: number, rot: number, bw: number, bd: number, bh: number, o: Partial<Made> = {}) => builtList.push({ kind, r, f, rot, w: bw, d: bd, h: bh, ...o });
    const floorSpot = (r: number, f: number) => spots.push({ r, f, y: Y, floor: true });
    /** nothing already stands within `by` of a spot */
    const room = (r: number, f: number, by: number) => !stood.some((s) => Math.hypot(s.r - r, s.f - f) < by) && !builtList.some((m) => m.solid !== false && m.kind !== 'sign' && Math.hypot(m.r - r, m.f - f) < by + Math.min(m.w, m.d) / 2);
    const corner = (k: number): [number, number] => [k & 1 ? q.r1 - 1.1 : q.r0 + 1.1, k & 2 ? q.f1 - 1.1 : q.f0 + 1.1];
    const clutter = (n: number, ids: string[]) => {
      for (let i = 0; i < n; i++) {
        const [r, f] = corner(Math.floor(rnd() * 4));
        const pr = r + between(-0.5, 0.5), pf = f + between(-0.5, 0.5);
        if (clear(pr, pf, 1.6)) put(pick(ids), pr, pf, between(0, Math.PI * 2));
      }
    };
    /** is the middle of the floor free here: off the walls, no way in near, and nothing standing within `by` */
    const open = (r: number, f: number, by: number) => r > q.r0 + by + 0.5 && r < q.r1 - by - 0.5 && f > q.f0 + by + 0.5 && f < q.f1 - by - 0.5 && clear(r, f, by + 1.1) && room(r, f, by + 0.35);
    /** a bed: its frame, a mattress on the wires of it, and what is kept on that */
    const bed = (r: number, f: number, rot: number) => {
      put('old_bed_frame', r, f, rot + Math.PI / 2, { on: [0.59] });
      build('mattress', r, f, rot + Math.PI / 2, 0.76, 1.8, 0.1, { y: 0.49, solid: false });
    };
    /** boxes on boxes in a corner, where there is a corner for them */
    const heap = (k: number) => {
      const [r0, f0] = corner(k);
      const r = r0 + between(-0.25, 0.25), f = f0 + between(-0.25, 0.25), a = between(0, Math.PI * 2);
      if (!clear(r, f, 1.7) || !room(r, f, 0.55)) return;
      put('cardboard_box_01', r, f, a);
      put('cardboard_box_01', r + between(-0.05, 0.05), f + between(-0.05, 0.05), a + between(0.2, 1.3), { y: 0.34 });
      const r2 = r + Math.cos(a) * 0.6, f2 = f + Math.sin(a) * 0.6;
      if (rnd() < 0.6 && clear(r2, f2, 1.5) && room(r2, f2, 0.45) && r2 > q.r0 + 0.6 && r2 < q.r1 - 0.6 && f2 > q.f0 + 0.6 && f2 < q.f1 - 0.6) put('cardboard_box_01', r2, f2, a + between(-0.4, 0.4));
    };
    /** a rule of the place on a plate, high on the wall that whoever comes in is looking at */
    const notice = (text: string) => {
      const [dr, df] = q.doors[0];
      const across: (typeof wallsOf)[number] = Math.abs(dr - q.r0) < 0.5 ? 'r1' : Math.abs(dr - q.r1) < 0.5 ? 'r0' : Math.abs(df - q.f0) < 0.5 ? 'f1' : 'f0';
      const wl = free.includes(across) ? across : free[0];
      if (!wl) return;
      // (where the wall's face is: a wall between rooms is half its thickness in from the room's edge, and the shell's own are where they are)
      const face = wl === 'r0' ? q.r0 + (q.r0 <= -H.r + 1e-6 ? 0 : T / 2) : wl === 'r1' ? q.r1 - (q.r1 >= H.r - 1e-6 ? 0 : T / 2) : wl === 'f0' ? q.f0 + (q.f0 <= H.back + 1e-6 ? 0 : T / 2) : q.f1 - (q.f1 >= H.front - 1e-6 ? 0.4 : T / 2);
      const onR = wl === 'r0' || wl === 'r1', mid = onR ? cf : cr, half = (onR ? d : w) / 2 - 1.3;
      for (const off of [0, 1.8, -1.8, 3.4, -3.4]) {
        if (Math.abs(off) > half) continue;
        const r = onR ? face : mid + off, f = onR ? mid + off : face;
        // (not behind a ladder or a stack of pipe that goes to the ceiling)
        if (stood.some((st) => (st.id === 'bunker_pipe' || st.id === 'bunker_ladder') && Math.hypot(st.r - r, st.f - f) < 1.4)) continue;
        build('sign', r, f, wl === 'r0' ? Math.PI / 2 : wl === 'r1' ? -Math.PI / 2 : wl === 'f0' ? 0 : Math.PI, 1.7, 0.02, 0.32, { y: 2.34, text, solid: false });
        return;
      }
    };
    /** blood, long dry, on the floor */
    const blood = (r: number, f: number, size = 1.7) => build('stain', r, f, between(0, Math.PI * 2), size, size, 0, { v: 2 * Math.floor(rnd() * 3), solid: false });
    let lamp = pick([0.4, 0.3, 0, 0, 0]);
    switch (q.kind) {
      case 'barracks': {
        // bunks down the two longest walls, lockers along a third, a table in the middle if there is room
        for (const wl of longest.slice(0, 2)) along(wl, (r, f, rot) => build('bunk', r, f, rot, 2.05, 0.95, 1.75), 1.15, 0.95, 5);
        along(longest[2], (r, f, rot) => build('locker', r, f, rot, 0.5, 0.5, 1.85), 0.42, 0.5, 6);
        if (w > 6.5 && d > 6.5) {
          const turn = rnd() < 0.5 ? 0 : Math.PI / 2;
          put('WoodenTable_01', cr, cf, turn, { on: TOP });
          // (and somewhere to sit at it: one at each end, pushed back as they were left)
          for (const sgn of [-1, 1]) put('painted_wooden_chair_01', cr + Math.cos(turn) * sgn * 1.3, cf - Math.sin(turn) * sgn * 1.3, turn - sgn * (Math.PI / 2) + between(-0.5, 0.5));
        }
        heap(Math.floor(rnd() * 4));
        notice('LIGHTS OUT 2200');
        break;
      }
      case 'quarters': {
        along(longest[0], (r, f, rot) => bed(r, f, rot), 0.6, 2.1, 2);
        along(longest[1], (r, f, rot, k) => (k === 0 ? put('metal_office_desk', r, f, rot, { on: TOP }) : k === 1 ? put('painted_wooden_cabinet', r, f, rot, { on: TOP }) : build('locker', r, f, rot, 0.5, 0.5, 1.85)), 0.55, 2.0, 3);
        // a low table in the middle of the floor and a chair drawn up to it, where there is room for them; a chair anyway
        const turn = w > d ? 0 : Math.PI / 2;
        if (open(cr, cf, 0.95)) {
          put('WoodenTable_01', cr, cf, turn);
          put('SchoolChair_01', cr + Math.sin(turn) * 0.8, cf + Math.cos(turn) * 0.8, turn + Math.PI + between(-0.4, 0.4));
          put('cardboard_box_01', cr - Math.cos(turn) * 0.5, cf + Math.sin(turn) * 0.5, turn + between(-0.5, 0.5), { y: 0.549 });
        } else put('SchoolChair_01', cr + between(-0.6, 0.6), cf + between(-0.6, 0.6), between(0, 6));
        notice('OFFICERS ONLY');
        break;
      }
      case 'mess': {
        const n = Math.max(1, Math.min(3, Math.floor((Math.max(w, d) - 2) / 3.2)));
        // (two rows of tables where the room is wide enough for a way between them)
        const rows = Math.min(w, d) > 7.6 ? [-1.7, 1.7] : [0];
        for (const row of rows) for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, r = w > d ? q.r0 + 1 + t * (w - 2) : cr + row, f = w > d ? cf + row : q.f0 + 1 + t * (d - 2);
          const turn = w > d ? Math.PI / 2 : 0;
          if (!clear(r, f, 1.9)) continue;
          put('painted_wooden_table', r, f, turn, { on: TOP, scale: 0.85 });
          for (const sgn of [-1, 1]) for (const off of [-0.55, 0.55]) put('painted_wooden_chair_01', r + (w > d ? off : sgn * 0.85), f + (w > d ? sgn * 0.85 : off), (w > d ? (sgn > 0 ? Math.PI : 0) : sgn > 0 ? -Math.PI / 2 : Math.PI / 2) + between(-0.25, 0.25));
        }
        // (what it is served from is along one wall: the cooking is done next door, in the kitchen)
        along(longest[0], (r, f, rot, k) => put(k === 0 ? 'painted_wooden_cabinet' : 'Shelf_01', r, f, rot, { on: k === 0 ? TOP : SHELF }), 0.36, 1.3, 4);
        clutter(2, ['Barrel_01', 'barrel_03', 'trashbag']);
        notice('ONE RATION A MAN');
        break;
      }
      case 'kitchen': {
        // stoves in a row under a hood that takes their smoke up through the roof, steel tables to work at, shelves
        // of what there was to cook, water in drums, and a table in the middle where it was all put together
        const row: [number, number, number][] = [];
        along(longest[0], (r, f, rot) => {
          put('electric_stove', r, f, rot, { on: TOP });
          row.push([r, f, rot]);
        }, 0.36, 0.62, 4);
        if (row.length) {
          const [r0, f0, rot] = row[0], [r1, f1] = row[row.length - 1];
          const len = Math.hypot(r1 - r0, f1 - f0) + 0.8, mr = (r0 + r1) / 2, mf = (f0 + f1) / 2;
          build('duct', mr, mf, rot, len, 0.75, 0.28, { y: 1.95, solid: false });
          build('duct', mr - Math.sin(rot) * 0.18, mf - Math.cos(rot) * 0.18, rot, 0.4, 0.36, B.tall - 2.23, { y: 2.23, solid: false });
        }
        along(longest[1], (r, f, rot) => {
          build('bench', r, f, rot, 2.2, 0.7, 0.92);
          spots.push({ r, f, y: Y + 0.92, floor: false });
        }, 0.5, 2.2, 2);
        along(longest[2], (r, f, rot, k) => (k % 2 ? put('painted_wooden_cabinet', r, f, rot, { on: TOP }) : put('Shelf_01', r, f, rot, { on: SHELF })), 0.36, 1.25, 3);
        if (open(cr, cf, 1.15)) put('painted_wooden_table', cr, cf, w > d ? 0 : Math.PI / 2, { on: TOP, scale: 0.85 });
        clutter(3, ['Barrel_01', 'barrel_03', 'barrel_03', 'trashbag']);
        heap(Math.floor(rnd() * 4));
        notice('WASH YOUR HANDS');
        lamp = pick([0.4, 0.3]);
        break;
      }
      case 'stores': {
        for (const wl of longest.slice(0, 3)) along(wl, (r, f, rot) => put(rnd() < 0.75 ? 'Shelf_01' : 'wooden_bookshelf_worn', r, f, rot, { on: SHELF }), 0.3, 1.1, 5);
        clutter(3 + Math.floor(rnd() * 3), ['Barrel_01', 'barrel_03', 'wooden_crate_01', 'cardboard_box_01', 'cardboard_box_01', 'wooden_military_crate']);
        if (w > 5 && d > 5) {
          put('wooden_military_crate', cr, cf, between(0, 3));
          put('wooden_crate_01', cr + 0.1, cf, between(0, 3), { y: 0.52 });
        }
        floorSpot(cr + between(-1, 1), cf + between(-1, 1));
        heap(Math.floor(rnd() * 4));
        notice('SIGN FOR EVERYTHING');
        break;
      }
      case 'armoury': {
        // benches along the two longest walls, racks on a third, cases on the floor: where the long things are kept
        for (const wl of longest.slice(0, 2)) along(wl, (r, f, rot) => {
          build('bench', r, f, rot, 2.2, 0.7, 0.92);
          const c = Math.cos(rot), sn = Math.sin(rot);
          for (const k of [-0.55, 0.55]) spots.push({ r: r + k * c, f: f - k * sn, y: Y + 0.92, floor: false });
        }, 0.5, 2.2, 3);
        along(longest[2], (r, f, rot) => build('rack', r, f, rot, 1.6, 0.4, 1.9), 0.3, 1.6, 3);
        for (let k = 0; k < 3; k++) {
          const pr = cr + (k - 1) * 1.6 * (w > d ? 1 : 0) + between(-0.2, 0.2), pf = cf + (k - 1) * 1.6 * (w > d ? 0 : 1) + between(-0.2, 0.2);
          if (clear(pr, pf, 1.4)) put('weapons_case', pr, pf, (w > d ? Math.PI / 2 : 0) + between(-0.2, 0.2));
        }
        for (let k = 0; k < 6; k++) floorSpot(between(q.r0 + 1.2, q.r1 - 1.2), between(q.f0 + 1.2, q.f1 - 1.2));
        along(longest[3], (r, f, rot) => void (room(r, f, 0.8) && put('utility_box_01', r, f, rot)), 0.3, 1.0, 1);
        notice('CLEAR YOUR WEAPON');
        lamp = 0.45;
        break;
      }
      case 'medical': {
        along(longest[0], (r, f, rot) => {
          bed(r, f, rot);
          // (a chair by each bed, for whoever sat up with them)
          const sr = r + Math.sin(rot) * 1.05 + Math.cos(rot) * 0.7, sf = f + Math.cos(rot) * 1.05 - Math.sin(rot) * 0.7;
          if (clear(sr, sf, 1.3)) put('SchoolChair_01', sr, sf, rot + Math.PI + between(-0.6, 0.6));
        }, 0.6, 2.1, 3);
        along(longest[1], (r, f, rot, k) => put(k % 2 ? 'painted_wooden_cabinet' : 'Shelf_01', r, f, rot, { on: k % 2 ? TOP : SHELF }), 0.36, 1.25, 4);
        put('metal_office_desk', cr, cf, pick([0, Math.PI / 2]), { on: TOP });
        blood(cr + between(-1.6, 1.6), cf + between(-1.6, 1.6));
        notice('NO ENTRY · QUARANTINE');
        break;
      }
      case 'control': {
        // a row of consoles facing the longest wall, desks behind them, and what is watched on the wall
        along(longest[0], (r, f, rot, k) => (k % 2 === 0 ? put('bunker_terminal', r, f, rot) : build('console', r, f, rot, 1.5, 0.8, 1.15)), 0.78, 1.6, 5);
        along(longest[1], (r, f, rot, k) => {
          // (a desk with a set on it keeps nothing else on its top: the set is where it would lie)
          put('metal_office_desk', r, f, rot, k % 2 === 0 ? {} : { on: TOP });
          if (k % 2 === 0) put('Television_01', r, f, rot, { y: 0.78 });
          put('SchoolChair_01', r + Math.sin(rot) * 0.9, f + Math.cos(rot) * 0.9, rot + Math.PI + between(-0.4, 0.4));
        }, 0.6, 2.2, 3);
        along(longest[2], (r, f, rot) => void (room(r, f, 1.7) && put('bunker_machine', r, f, rot)), 0.95, 3.7, 1);
        // the table the place was run from, in the middle of the floor: a set on it, and the chairs pushed back from it
        if (open(cr, cf, 1.2)) {
          const turn = w > d ? 0 : Math.PI / 2, c = Math.cos(turn), sn = Math.sin(turn);
          put('painted_wooden_table', cr, cf, turn, { scale: 0.85 });
          put('Television_01', cr + c * 0.5, cf - sn * 0.5, turn + between(-0.3, 0.3), { y: 0.81 });
          for (const [ox, oz, face] of [[-0.45, 0.98, Math.PI], [0.5, -1.0, 0], [-1.5, 0, Math.PI / 2]]) put('SchoolChair_01', cr + ox * c + oz * sn, cf - ox * sn + oz * c, turn + face + between(-0.45, 0.45));
        }
        if (Math.max(w, d) > 7) put('bunker_cable', cr + (w > d ? 0 : -1.5), cf + (w > d ? -1.5 : 0), w > d ? 0 : Math.PI / 2, { scale: Math.min(1, (Math.max(w, d) - 1.6) / 6) });
        notice('AUTHORISED STAFF ONLY');
        lamp = 0.3;
        break;
      }
      case 'plant': {
        // generators down the middle, tanks along a wall, pillars holding the roof up, and pipes
        const n = Math.max(1, Math.min(3, Math.floor((Math.max(w, d) - 3) / 3.6)));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const gr = w > d ? q.r0 + 1.5 + t * (w - 3) : cr, gf = w > d ? cf : q.f0 + 1.5 + t * (d - 3), turn = w > d ? 0 : Math.PI / 2;
          if (k % 2 === 0) put('bunker_machine', gr, gf, turn);
          else build('generator', gr, gf, turn, 2.6, 1.3, 1.55);
          put('bunker_grate', gr + (w > d ? 0 : 1.6), gf + (w > d ? 1.5 : 0), 0);
          // (a rail along the side of it that is walked past)
          const rr = gr - (w > d ? 0 : 1.3), rf = gf - (w > d ? 1.3 : 0);
          if (clear(rr, rf, 1.3)) put('bunker_rail', rr, rf, turn);
        }
        along(longest[0], (r, f, rot) => build('tank', r, f, rot, 1.1, 1.1, 2.2), 0.75, 1.3, 4);
        along(longest[1], (r, f, rot, k) => (k % 2 ? put('utility_box_01', r, f, rot) : put(pick(['Barrel_01', 'barrel_03']), r, f, rot)), 0.45, 1.0, 5);
        for (const [pr, pf] of [[q.r0 + w * 0.25, q.f0 + d * 0.25], [q.r1 - w * 0.25, q.f1 - d * 0.25], [q.r0 + w * 0.25, q.f1 - d * 0.25], [q.r1 - w * 0.25, q.f0 + d * 0.25]]) if (w > 8 && d > 6 && clear(pr, pf, 1.6)) build('pillar', pr, pf, 0, 0.6, 0.6, B.tall);
        floorSpot(cr + between(-1.5, 1.5), cf + between(-1.2, 1.2));
        along(longest[2], (r, f, rot) => void (room(r, f, 1.1) && put('bunker_pipe', r, f, rot)), 0.55, 1.4, 3);
        along(longest[3], (r, f, rot, k) => void (room(r, f, 0.9) && put(k === 0 ? 'bunker_ladder' : 'bunker_pipes', r, f, rot)), 0.17, 1.9, 2);
        // (the cable that fed the place from them, across the floor)
        put('bunker_cable', cr - (w > d ? 0 : 0.6), cf - (w > d ? 0.6 : 0), w > d ? 0 : Math.PI / 2, { scale: Math.min(1, (Math.max(w, d) - 1.6) / 6) });
        notice('DANGER · HIGH VOLTAGE');
        lamp = 0.3;
        break;
      }
      case 'workshop': {
        along(longest[0], (r, f, rot) => {
          build('bench', r, f, rot, 2.2, 0.7, 0.92);
          const c = Math.cos(rot), sn = Math.sin(rot);
          for (const k of [-0.55, 0.55]) spots.push({ r: r + k * c, f: f - k * sn, y: Y + 0.92, floor: false });
        }, 0.5, 2.2, 2);
        along(longest[1], (r, f, rot) => put('Shelf_01', r, f, rot, { on: SHELF }), 0.3, 1.1, 3);
        clutter(4, ['old_tyre', 'utility_box_01', 'Barrel_01', 'wooden_crate_01', 'cardboard_box_01']);
        floorSpot(cr, cf);
        along(longest[2], (r, f, rot) => void (room(r, f, 1.0) && put('bunker_pipes', r, f, rot)), 0.17, 1.9, 1);
        // tyres stood in a row against the last wall, and the ladder that was left by them
        along(longest[3], (r, f, rot, k) => {
          if (!room(r, f, 0.75)) return;
          if (k === 0) for (let i = -1; i <= 1; i++) put('old_tyre', r + Math.cos(rot) * i * 0.19, f - Math.sin(rot) * i * 0.19, rot + Math.PI / 2 + between(-0.08, 0.08));
          else put('wooden_ladder', r, f, rot);
        }, 0.36, 1.1, 2);
        // a low table out on the floor with what was being mended on it
        const tr = cr + (w > d ? pick([-1, 1]) * w * 0.24 : 0), tf = cf + (w > d ? 0 : pick([-1, 1]) * d * 0.24);
        if (open(tr, tf, 0.95)) {
          const turn = w > d ? Math.PI / 2 : 0;
          put('WoodenTable_01', tr, tf, turn);
          put('cardboard_box_01', tr + Math.cos(turn) * 0.45, tf - Math.sin(turn) * 0.45, between(0, 3), { y: 0.549 });
        }
        notice('EYE PROTECTION');
        break;
      }
      case 'archive': {
        for (const wl of longest.slice(0, 3)) along(wl, (r, f, rot) => put('wooden_bookshelf_worn', r, f, rot, { on: BOOK }), 0.42, 1.5, 4);
        put('metal_office_desk', cr, cf, pick([0, Math.PI / 2]), { on: TOP });
        put('SchoolChair_01', cr + 0.9, cf + 0.3, between(0, 6));
        // stacks out on the floor, two back to back, where the room is long enough for a way round them
        if (Math.max(w, d) >= 8) for (const sgn of [-1, 1]) {
          const sr = cr + (w > d ? sgn * w * 0.29 : 0), sf = cf + (w > d ? 0 : sgn * d * 0.29), turn = w > d ? Math.PI / 2 : 0;
          if (!open(sr, sf, 1.0)) continue;
          for (const back of [-1, 1]) put('wooden_bookshelf_worn', sr + Math.sin(turn) * back * 0.3, sf + Math.cos(turn) * back * 0.3, turn + (back > 0 ? 0 : Math.PI));
        }
        for (let k = 0; k < 2; k++) heap(Math.floor(rnd() * 4));
        notice('NO NAKED FLAME');
        break;
      }
      case 'cells': {
        // barred cells down one wall, a desk for whoever kept them
        along(longest[0], (r, f, rot) => build('cell', r, f, rot, 2.2, 2.0, B.tall), 1.15, 2.2, 3);
        along(longest[1], (r, f, rot, k) => (k === 0 ? put('metal_office_desk', r, f, rot, { on: TOP }) : build('locker', r, f, rot, 0.5, 0.5, 1.85)), 0.55, 2.0, 2);
        blood(cr + between(-1, 1), cf + between(-1, 1), 1.4);
        notice('NO TALKING TO THE HELD');
        lamp = 0;
        break;
      }
      case 'washroom': {
        along(longest[0], (r, f, rot) => build('locker', r, f, rot, 0.5, 0.5, 1.85), 0.42, 0.5, 5);
        // a bench down the middle to sit and change on, drains in the floor, and the pipes that fed the showers
        if (open(cr, cf, 0.95)) put('WoodenTable_01', cr, cf, w > d ? 0 : Math.PI / 2);
        for (const sgn of [-1, 1]) {
          const gr = cr + (w > d ? 0 : sgn * w * 0.27), gf = cf + (w > d ? sgn * d * 0.27 : 0);
          if (clear(gr, gf, 1.2) && room(gr, gf, 0.6)) put('bunker_grate', gr, gf, 0);
        }
        along(longest[1], (r, f, rot) => void (room(r, f, 1.0) && put('bunker_pipes', r, f, rot)), 0.17, 1.9, 2);
        clutter(2, ['metal_trash_can', 'trashbag', 'cardboard_box_01']);
        notice('DECONTAMINATION');
        lamp = pick([0.3, 0]);
        break;
      }
    }
    // (and here and there what happened in the place has been left on its floor)
    if (q.kind !== 'medical' && q.kind !== 'cells' && rnd() < 0.3) blood(cr + between(-w * 0.25, w * 0.25), cf + between(-d * 0.25, d * 0.25));
    // a sign over each way in, on the passage's side of it
    for (const [dr, df] of q.doors) {
      const onSpine = Math.abs(Math.abs(dr) - B.passage) < 0.01, onCross = Math.abs(Math.abs(df - cross) - B.across) < 0.01;
      if (onSpine) build('sign', dr - Math.sign(dr) * (T / 2 + 0.02), df, dr > 0 ? -Math.PI / 2 : Math.PI / 2, 1.5, 0.02, 0.3, { y: 2.3, text: q.name.toUpperCase(), solid: false });
      else if (onCross) build('sign', dr, df - Math.sign(df - cross) * (T / 2 + 0.02), df > cross ? Math.PI : 0, 1.5, 0.02, 0.3, { y: 2.3, text: q.name.toUpperCase(), solid: false });
    }
    lamps.push([cr, cf, Y + B.tall - 0.25, lamp]);
    if (w * d > 60) lamps.push([cr + (w > d ? w * 0.28 : 0), cf + (w > d ? 0 : d * 0.28), Y + B.tall - 0.25, pick([0.3, 0, 0])], [cr - (w > d ? w * 0.28 : 0), cf - (w > d ? 0 : d * 0.28), Y + B.tall - 0.25, pick([0, 0, 0])]);
  }

  // ---- the passages: lamps down them, pipes and a duct along the ceiling, and what has been left standing about
  for (let f = H.front - 3; f > H.back + 1; f -= 6.5) lamps.push([0, f, Y + B.tall - 0.25, pick([0.4, 0, 0, 0.3, 0, 0])]);
  for (const r of [-14.5, -8, 8, 14.5]) lamps.push([r, cross, Y + B.tall - 0.25, pick([0.3, 0, 0, 0])]);
  // (one over the door, on the ceiling of the stair's shaft: the door and its reader are seen by whoever comes down the stair)
  lamps.push([0, H.front + B.door.lamp, Y + B.depth + B.pad.top - 0.45 - 0.25, 1]);
  builtList.push({ kind: 'pipe', r: -B.passage + 0.4, f: (H.back + H.front) / 2, rot: 0, w: 0.16, d: H.front - H.back - 0.6, h: 0.16, y: B.tall - 0.32, solid: false });
  builtList.push({ kind: 'pipe', r: -B.passage + 0.68, f: (H.back + H.front) / 2, rot: 0, w: 0.1, d: H.front - H.back - 0.6, h: 0.1, y: B.tall - 0.26, solid: false });
  builtList.push({ kind: 'duct', r: B.passage - 0.5, f: (H.back + H.front) / 2, rot: 0, w: 0.55, d: H.front - H.back - 0.6, h: 0.35, y: B.tall - 0.4, solid: false });
  builtList.push({ kind: 'pipe', r: 0, f: cross + B.across - 0.35, rot: Math.PI / 2, w: 0.14, d: H.r * 2 - 0.6, h: 0.14, y: B.tall - 0.3, solid: false });
  // A painted line down each side of the main passage, as such places have; warning paint before each of its two
  // doors; and what was dragged down it to the far one, a long time ago.
  for (const side of [-1, 1]) builtList.push({ kind: 'stripe', r: side * (B.passage - 0.36), f: (H.back + H.front) / 2 - 0.2, rot: 0, w: 0.09, d: H.front - H.back - 1.6, h: 0.004, text: 'yellow', solid: false });
  for (const f of [H.back + 0.72, H.front - 1.05]) builtList.push({ kind: 'stripe', r: 0, f, rot: 0, w: 2.7, d: 1.0, h: 0.004, text: 'hazard', solid: false });
  for (let k = 0, f = H.back + 2.4; k < 3; k++, f += 3.2) builtList.push({ kind: 'stain', r: between(-0.3, 0.3), f, rot: between(-0.1, 0.1), w: 0.95, d: 3.5, h: 0, v: 1 + 2 * k, solid: false });
  builtList.push({ kind: 'stain', r: 0.25, f: H.back + 0.95, rot: 1.1, w: 1.9, d: 1.9, h: 0, v: 0, solid: false });
  // What whoever was last down here wrote on the walls, in what paint they had: on a stretch of the main passage's
  // wall with no way through it. (v 0: whitewash; 1: red.) Nothing is stood or hung where something is written.
  const written: [number, number][] = [];
  const daub = (side: number, want: number, text: string, v: number, wide = 2.6) => {
    for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 3.5, -3.5]) {
      const f = want + off;
      if (f < H.back + wide / 2 + 0.3 || f > H.front - wide / 2 - 0.7 || Math.abs(f - cross) < B.across + wide / 2 + 0.3) continue;
      if (rooms.some((q) => q.doors.some(([dr, df]) => Math.abs(dr - side * B.passage) < 0.1 && Math.abs(df - f) < wide / 2 + 1.1)) || written.some(([s2, f2]) => s2 === side && Math.abs(f2 - f) < wide + 0.5)) continue;
      builtList.push({ kind: 'scrawl', r: side * (B.passage - T / 2 - 0.004), f, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, w: wide, d: 0.02, h: wide / 4, y: 1.18, text, v, solid: false });
      written.push([side, f]);
      return;
    }
  };
  daub(-1, H.back + 2.6, 'THE CURE IS BELOW', 0);
  daub(1, H.back + 3.2, 'DO NOT OPEN|LEVEL 2', 1, 2.2);
  daub(1, H.front - 3.4, 'MASKS ON', 0, 2.0);
  daub(-1, cross + 5.5, 'THEY HEAR THE DOOR', 1);
  daub(1, cross - 5.5, 'BATCH 17 HOLDS', 0, 2.4);
  daub(-1, cross - 6.5, 'COUNT YOUR ROUNDS', 0);
  const kept = (side: number, f: number) => written.some(([s2, f2]) => s2 === side && Math.abs(f2 - f) < 2.1);
  for (let f = H.front - 5; f > H.back + 3; f -= between(5, 9)) {
    const side = rnd() < 0.5 ? -1 : 1, r = side * (B.passage - 0.5);
    // (not in front of a way through, nor of what is written)
    if (rooms.some((q) => q.doors.some(([dr, df]) => Math.abs(dr - side * B.passage) < 0.1 && Math.abs(df - f) < 1.6)) || Math.abs(f - cross) < 3 || kept(side, f)) continue;
    stood.push({ id: pick(['wooden_military_crate', 'Barrel_01', 'cardboard_box_01', 'metal_trash_can', 'old_military_crate']), r, f, rot: between(-0.3, 0.3) + (rnd() < 0.5 ? 0 : Math.PI / 2) });
  }
  for (const f of [H.front - 2.5, cross + 4, cross - 5, H.back + 2.5]) spots.push({ r: pick([-0.9, 0.9]), f, y: Y, floor: true });
  builtList.push({ kind: 'sign', r: 0, f: H.back + 0.02, rot: 0, w: 2.2, d: 0.02, h: 0.4, y: 2.42, text: 'LEVEL 2', solid: false });
  builtList.push({ kind: 'grate', r: 0, f: cross, rot: 0, w: 1.6, d: 1.6, h: 0.03, solid: false });
  // (the works of the place run down its walls: clusters of pipes, wherever there is neither a way through nor something standing)
  let side = 1;
  for (let f = H.front - 2.2; f > H.back + 2; f -= 3.1) {
    const r = side * (B.passage - T / 2 - 0.15);
    const blocked = rooms.some((q) => q.doors.some(([dr, df]) => Math.abs(dr - side * B.passage) < 0.1 && Math.abs(df - f) < 2.1)) || Math.abs(f - cross) < B.across + 1.3 || stood.some((s) => Math.hypot(s.r - r, s.f - f) < 1.5) || kept(side, f);
    if (blocked) continue;
    stood.push({ id: 'bunker_pipes', r, f, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    side = -side;
  }

  return { rooms, walls, stood, made: builtList, spots, lamps, sealed: [0, H.back], cross };
}

// ------------------------------------------------------------------ what is searched in it

/** which things of the bunker are opened and looked into, and as what kind of crate (see CRATE_SPECS) */
const SEARCHED: Record<string, string> = { locker: 'locker', rack: 'gun_rack', painted_wooden_cabinet: 'bunker_cabinet', metal_office_desk: 'bunker_desk', bunker_terminal: 'bunker_desk' };

/**
 * The lockers, racks, cabinets and desks of the bunker, each a thing to be searched: where it
 * stands in the world. (Its crates and cases are crates like any on the map, and are not said
 * here.) The same on the server and in every game: it is all in the plan.
 */
export function bunkerCrates(p: Place): { kind: string; x: number; y: number; z: number; rot: number }[] {
  const plan = bunkerPlan(), out: { kind: string; x: number; y: number; z: number; rot: number }[] = [];
  const add = (kind: string | undefined, r: number, f: number, rot: number) => {
    if (!kind) return;
    const [x, y, z] = bunkerAt(p, r, f, levelY());
    out.push({ kind, x, y, z, rot: p.rot + rot });
  };
  for (const m of plan.made) add(SEARCHED[m.kind], m.r, m.f, m.rot);
  for (const s of plan.stood) add(SEARCHED[s.id], s.r, s.f, s.rot);
  return out;
}

// ------------------------------------------------------------------ finding the way about it

/**
 * A way through between two parts of the place: a doorway, or where one passage opens into
 * the other. `nr, nf`: which way through it leads from part `a` to part `b`.
 */
export interface Way {
  a: number;
  b: number;
  r: number;
  f: number;
  nr: number;
  nf: number;
  /** it is the door a keycard opens */
  gate?: boolean;
}

export interface Ways {
  ways: Way[];
  /** the part that is everywhere else: the ground above it, and the whole map */
  world: number;
  /** which part a spot is in. @param h how high it is above the pad's own level (a chest's height, not a foot's) */
  part(r: number, f: number, h: number): number;
  /** the first way through on the shortest way from one part to another, and whether it is gone through from its `a` (+1) or from its `b` (-1). Null: they are the same part. */
  next(from: number, to: number): { way: Way; dir: 1 | -1 } | null;
}

let found: Ways | null = null;

/**
 * The bunker as whatever has no map of it in its head finds its way about it: its rooms, the
 * main passage, the two arms of the one across it, the stair (with the hut over it) and the
 * world outside are each a part, inside any of which a straight line is a way; and from part
 * to part is by the doorways, the shortest count of them.
 */
export function bunkerWays(): Ways {
  if (found) return found;
  const B = BUNKER, H = B.hall, plan = bunkerPlan(), n = plan.rooms.length;
  const MAIN = n, LEFT = n + 1, RIGHT = n + 2, STAIR = n + 3, WORLD = n + 4, COURT = n + 5;
  const head = B.stair.foot + B.stair.run;
  const part = (r: number, f: number, h: number): number => {
    // the stair's shaft below ground, and the hut over its head
    if (Math.abs(r) < B.hut.half && ((f > H.front - 0.15 && f < head + 0.5 && h < -0.6) || (f >= B.hut.back && f < B.hut.front))) return STAIR;
    // (the walled yard before the house's door: out of it is by its open side, not through its walls)
    if (h > -2 && Math.abs(r) < B.court.r && f >= B.hut.front && f < B.court.front) return COURT;
    if (h > -2 || Math.abs(r) > H.r + 0.6 || f < H.back - 0.6 || f > H.front) return WORLD;
    for (let k = 0; k < n; k++) {
      const q = plan.rooms[k];
      if (r > q.r0 && r < q.r1 && f > q.f0 && f < q.f1) return k;
    }
    if (Math.abs(r) <= B.passage) return MAIN;
    if (Math.abs(f - plan.cross) <= B.across) return r < 0 ? LEFT : RIGHT;
    return MAIN;
  };
  const ways: Way[] = [];
  const seen = new Set<string>();
  plan.rooms.forEach((q, k) => {
    for (const [dr, df] of q.doors) {
      const key = `${dr},${df}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // (a door is in one of its room's four walls: out of the room is away from the room's middle, square to that wall)
      const inR = Math.abs(dr - q.r0) < 1e-6 || Math.abs(dr - q.r1) < 1e-6;
      const nr = inR ? Math.sign(dr - (q.r0 + q.r1) / 2) : 0, nf = inR ? 0 : Math.sign(df - (q.f0 + q.f1) / 2);
      ways.push({ a: k, b: part(dr + nr * 0.9, df + nf * 0.9, -4), r: dr, f: df, nr, nf });
    }
  });
  ways.push({ a: MAIN, b: LEFT, r: -B.passage, f: plan.cross, nr: -1, nf: 0 }, { a: MAIN, b: RIGHT, r: B.passage, f: plan.cross, nr: 1, nf: 0 });
  ways.push({ a: MAIN, b: STAIR, r: 0, f: H.front - 0.15, nr: 0, nf: 1, gate: true });
  ways.push({ a: STAIR, b: COURT, r: -0.24, f: B.hut.front, nr: 0, nf: 1 });
  ways.push({ a: COURT, b: WORLD, r: B.court.open * B.court.r, f: (B.hut.front + B.court.front) / 2 + 0.2, nr: B.court.open, nf: 0 });
  // the first step from each part to each other, by the fewest doorways
  const parts = COURT + 1;
  const first: ({ way: Way; dir: 1 | -1 } | null)[][] = [];
  for (let from = 0; from < parts; from++) {
    const step: ({ way: Way; dir: 1 | -1 } | null)[] = new Array(parts).fill(null);
    const reached = new Set([from]);
    let edge: [number, { way: Way; dir: 1 | -1 } | null][] = [[from, null]];
    while (edge.length) {
      const nextEdge: typeof edge = [];
      for (const [at, by] of edge) {
        for (const w of ways) {
          const to = w.a === at ? w.b : w.b === at ? w.a : -1;
          if (to < 0 || reached.has(to)) continue;
          reached.add(to);
          const how = by ?? { way: w, dir: (w.a === at ? 1 : -1) as 1 | -1 };
          step[to] = how;
          nextEdge.push([to, how]);
        }
      }
      edge = nextEdge;
    }
    first.push(step);
  }
  return (found = { ways, world: WORLD, part, next: (from, to) => first[from]?.[to] ?? null });
}
