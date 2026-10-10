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
  stair: { half: 1.2, foot: 6.5, run: 9 },
  /** the hut over the head of the stair */
  hut: { half: 2, back: 10.5, front: 18, tall: 2.6 },
  /** the ground that is dug out for all of it */
  pit: { r: 22.5, back: -30.5, front: 14 },
  /** the pad over the pit */
  pad: { r: 24.5, back: -32.5, front: 16.6, top: 0.25 },
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
  // (two slow waves out of step, cut off sharply: on, on, a stutter, off for a while)
  const a = Math.sin(t * (1.3 + (k % 7) * 0.37) + k * 2.1), b = Math.sin(t * (7.1 + (k % 5) * 1.3) + k);
  const on = a * 0.6 + b * 0.4 > 1 - how * 1.9 ? 1 : 0.06;
  return on * (0.85 + 0.15 * Math.sin(t * 31 + k));
}

// ------------------------------------------------------------------ the level, laid out by rule

export type RoomKind = 'barracks' | 'mess' | 'stores' | 'armoury' | 'medical' | 'control' | 'plant' | 'workshop' | 'archive' | 'quarters' | 'cells' | 'washroom';

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
export interface Made { kind: 'locker' | 'generator' | 'tank' | 'console' | 'rack' | 'bench' | 'pillar' | 'bunk' | 'pipe' | 'duct' | 'sign' | 'grate' | 'cell'; r: number; f: number; rot: number; w: number; d: number; h: number; y?: number; text?: string; solid?: boolean }
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
  const NAMES: Record<RoomKind, string> = { barracks: 'Barracks', mess: 'Mess', stores: 'Stores', armoury: 'Armoury', medical: 'Sick bay', control: 'Control', plant: 'Plant', workshop: 'Workshop', archive: 'Records', quarters: 'Quarters', cells: 'Cells', washroom: 'Wash room' };
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
    const corner = (k: number): [number, number] => [k & 1 ? q.r1 - 1.1 : q.r0 + 1.1, k & 2 ? q.f1 - 1.1 : q.f0 + 1.1];
    const clutter = (n: number, ids: string[]) => {
      for (let i = 0; i < n; i++) {
        const [r, f] = corner(Math.floor(rnd() * 4));
        const pr = r + between(-0.5, 0.5), pf = f + between(-0.5, 0.5);
        if (clear(pr, pf, 1.6)) put(pick(ids), pr, pf, between(0, Math.PI * 2));
      }
    };
    let lamp = pick([0.4, 0.3, 0, 0, 0]);
    switch (q.kind) {
      case 'barracks': {
        // bunks down the two longest walls, lockers along a third, a table in the middle if there is room
        for (const wl of longest.slice(0, 2)) along(wl, (r, f, rot) => build('bunk', r, f, rot, 2.05, 0.95, 1.75), 1.15, 0.95, 5);
        along(longest[2], (r, f, rot) => build('locker', r, f, rot, 0.5, 0.5, 1.85), 0.42, 0.5, 6);
        if (w > 6.5 && d > 6.5) put('WoodenTable_01', cr, cf, rnd() < 0.5 ? 0 : Math.PI / 2, { on: TOP });
        break;
      }
      case 'quarters': {
        along(longest[0], (r, f, rot) => put('old_bed_frame', r, f, rot + Math.PI / 2, { on: [0.45] }), 0.6, 2.1, 2);
        along(longest[1], (r, f, rot, k) => (k === 0 ? put('metal_office_desk', r, f, rot, { on: TOP }) : k === 1 ? put('painted_wooden_cabinet', r, f, rot, { on: TOP }) : build('locker', r, f, rot, 0.5, 0.5, 1.85)), 0.55, 2.0, 3);
        put('SchoolChair_01', cr + between(-0.6, 0.6), cf + between(-0.6, 0.6), between(0, 6));
        break;
      }
      case 'mess': {
        const n = Math.max(1, Math.min(3, Math.floor((Math.max(w, d) - 2) / 3.2)));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, r = w > d ? q.r0 + 1 + t * (w - 2) : cr, f = w > d ? cf : q.f0 + 1 + t * (d - 2);
          const turn = w > d ? Math.PI / 2 : 0;
          put('painted_wooden_table', r, f, turn, { on: TOP, scale: 0.85 });
          for (const sgn of [-1, 1]) for (const off of [-0.55, 0.55]) put('painted_wooden_chair_01', r + (w > d ? off : sgn * 0.85), f + (w > d ? sgn * 0.85 : off), (w > d ? (sgn > 0 ? Math.PI : 0) : sgn > 0 ? -Math.PI / 2 : Math.PI / 2) + between(-0.25, 0.25));
        }
        along(longest[0], (r, f, rot, k) => put(k === 0 ? 'electric_stove' : k === 1 ? 'painted_wooden_cabinet' : 'Shelf_01', r, f, rot, { on: k === 2 ? SHELF : TOP }), 0.36, 1.3, 4);
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
        lamp = 0.45;
        break;
      }
      case 'medical': {
        along(longest[0], (r, f, rot) => put('old_bed_frame', r, f, rot + Math.PI / 2, { on: [0.45] }), 0.6, 2.1, 3);
        along(longest[1], (r, f, rot, k) => put(k % 2 ? 'painted_wooden_cabinet' : 'Shelf_01', r, f, rot, { on: k % 2 ? TOP : SHELF }), 0.36, 1.25, 4);
        put('metal_office_desk', cr, cf, pick([0, Math.PI / 2]), { on: TOP });
        break;
      }
      case 'control': {
        // a row of consoles facing the longest wall, desks behind them, and what is watched on the wall
        along(longest[0], (r, f, rot) => build('console', r, f, rot, 1.5, 0.8, 1.15), 0.55, 1.5, 5);
        along(longest[1], (r, f, rot, k) => {
          put('metal_office_desk', r, f, rot, { on: TOP });
          if (k % 2 === 0) put('Television_01', r, f, rot, { y: 0.78 });
          put('SchoolChair_01', r + Math.sin(rot) * 0.9, f + Math.cos(rot) * 0.9, rot + Math.PI + between(-0.4, 0.4));
        }, 0.6, 2.2, 3);
        lamp = 0.3;
        break;
      }
      case 'plant': {
        // generators down the middle, tanks along a wall, pillars holding the roof up, and pipes
        const n = Math.max(1, Math.min(3, Math.floor((Math.max(w, d) - 3) / 3.6)));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          build('generator', w > d ? q.r0 + 1.5 + t * (w - 3) : cr, w > d ? cf : q.f0 + 1.5 + t * (d - 3), w > d ? 0 : Math.PI / 2, 2.6, 1.3, 1.55);
        }
        along(longest[0], (r, f, rot) => build('tank', r, f, rot, 1.1, 1.1, 2.2), 0.75, 1.3, 4);
        along(longest[1], (r, f, rot, k) => (k % 2 ? put('utility_box_01', r, f, rot) : put(pick(['Barrel_01', 'barrel_03']), r, f, rot)), 0.45, 1.0, 5);
        for (const [pr, pf] of [[q.r0 + w * 0.25, q.f0 + d * 0.25], [q.r1 - w * 0.25, q.f1 - d * 0.25], [q.r0 + w * 0.25, q.f1 - d * 0.25], [q.r1 - w * 0.25, q.f0 + d * 0.25]]) if (w > 8 && d > 6 && clear(pr, pf, 1.6)) build('pillar', pr, pf, 0, 0.6, 0.6, B.tall);
        floorSpot(cr + between(-1.5, 1.5), cf + between(-1.2, 1.2));
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
        break;
      }
      case 'archive': {
        for (const wl of longest.slice(0, 3)) along(wl, (r, f, rot) => put('wooden_bookshelf_worn', r, f, rot, { on: BOOK }), 0.42, 1.5, 4);
        put('metal_office_desk', cr, cf, pick([0, Math.PI / 2]), { on: TOP });
        put('SchoolChair_01', cr + 0.9, cf + 0.3, between(0, 6));
        clutter(3, ['cardboard_box_01']);
        break;
      }
      case 'cells': {
        // barred cells down one wall, a desk for whoever kept them
        along(longest[0], (r, f, rot) => build('cell', r, f, rot, 2.2, 2.0, B.tall), 1.15, 2.2, 3);
        along(longest[1], (r, f, rot, k) => (k === 0 ? put('metal_office_desk', r, f, rot, { on: TOP }) : build('locker', r, f, rot, 0.5, 0.5, 1.85)), 0.55, 2.0, 2);
        lamp = 0;
        break;
      }
      case 'washroom': {
        along(longest[0], (r, f, rot) => build('locker', r, f, rot, 0.5, 0.5, 1.85), 0.42, 0.5, 5);
        clutter(2, ['metal_trash_can', 'trashbag', 'cardboard_box_01']);
        lamp = pick([0.3, 0]);
        break;
      }
    }
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
  // (one over the door, on an arm from the wall: the door and its reader are seen by whoever comes down the stair)
  lamps.push([0, H.front + B.door.lamp, Y + 2.62, 1]);
  builtList.push({ kind: 'pipe', r: -B.passage + 0.4, f: (H.back + H.front) / 2, rot: 0, w: 0.16, d: H.front - H.back - 0.6, h: 0.16, y: B.tall - 0.32, solid: false });
  builtList.push({ kind: 'pipe', r: -B.passage + 0.68, f: (H.back + H.front) / 2, rot: 0, w: 0.1, d: H.front - H.back - 0.6, h: 0.1, y: B.tall - 0.26, solid: false });
  builtList.push({ kind: 'duct', r: B.passage - 0.5, f: (H.back + H.front) / 2, rot: 0, w: 0.55, d: H.front - H.back - 0.6, h: 0.35, y: B.tall - 0.4, solid: false });
  builtList.push({ kind: 'pipe', r: 0, f: cross + B.across - 0.35, rot: Math.PI / 2, w: 0.14, d: H.r * 2 - 0.6, h: 0.14, y: B.tall - 0.3, solid: false });
  for (let f = H.front - 5; f > H.back + 3; f -= between(5, 9)) {
    const side = rnd() < 0.5 ? -1 : 1, r = side * (B.passage - 0.5);
    // (not in front of a way through)
    if (rooms.some((q) => q.doors.some(([dr, df]) => Math.abs(dr - side * B.passage) < 0.1 && Math.abs(df - f) < 1.6)) || Math.abs(f - cross) < 3) continue;
    stood.push({ id: pick(['wooden_military_crate', 'Barrel_01', 'cardboard_box_01', 'metal_trash_can', 'old_military_crate']), r, f, rot: between(-0.3, 0.3) + (rnd() < 0.5 ? 0 : Math.PI / 2) });
  }
  for (const f of [H.front - 2.5, cross + 4, cross - 5, H.back + 2.5]) spots.push({ r: pick([-0.9, 0.9]), f, y: Y, floor: true });
  builtList.push({ kind: 'sign', r: 0, f: H.back + 0.02, rot: 0, w: 2.2, d: 0.02, h: 0.4, y: 2.42, text: 'LEVEL 2 · LEVEL 3', solid: false });
  builtList.push({ kind: 'grate', r: 0, f: cross, rot: 0, w: 1.6, d: 1.6, h: 0.03, solid: false });

  return { rooms, walls, stood, made: builtList, spots, lamps, sealed: [0, H.back], cross };
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
  const MAIN = n, LEFT = n + 1, RIGHT = n + 2, STAIR = n + 3, WORLD = n + 4;
  const head = B.stair.foot + B.stair.run;
  const part = (r: number, f: number, h: number): number => {
    // the stair's shaft below ground, and the hut over its head
    if (Math.abs(r) < B.hut.half && ((f > H.front - 0.15 && f < head + 0.5 && h < -0.6) || (f >= B.hut.back && f < B.hut.front))) return STAIR;
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
  ways.push({ a: STAIR, b: WORLD, r: 0, f: B.hut.front, nr: 0, nf: 1 });
  // the first step from each part to each other, by the fewest doorways
  const parts = WORLD + 1;
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
