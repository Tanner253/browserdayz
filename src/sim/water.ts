// Lakes and rivers, as rules: where the water is, how deep, which way it runs, and what it does to whoever walks into
// it. For the game and the server alike (nothing drawn here: src/world/water.ts draws them). The owner, 2026-10-16: "i
// want lakes and rivers as well in natural spots in the map since we now have water". The world says where they are
// (`world.water`, carved by the world's generator); these are the shapes it says them in.
//
// In the water, as in DayZ: the shallows slow a walker the deeper they go (to under half at the waist), and deep water
// is not gone into (it stops a body as the beach's barrier does: no swimming until the ocean's own update).

/** A lake: the shore as a closed outline (x, z, the way round does not matter), and the height of its water. */
export interface Lake {
  name?: string;
  level: number;
  outline: [number, number][];
  /** a swamp: still, shallow, murky water with the grass standing in it (drawn as such: src/world/water.ts SWAMP) */
  swamp?: boolean;
}

/**
 * A river: its middle line from its spring end to its mouth, each point where it is, the height of its water there and
 * how wide it is. The water falls downstream; where it runs fast it falls in small steps (two points close together).
 */
export interface River {
  name?: string;
  pts: [x: number, z: number, surface: number, width: number][];
}

/**
 * A building's ground in or by the water, as the world sets it down: a turned box on the ground's plane (its middle,
 * turn, half sizes across and along, as the terrain's wells take them; a building's is its footprint, its turn the
 * building's). Flooded (the usual): the water stands in it under a roof, drawn still and dark, with no sky in it.
 * `dry`, with its `floor` given and that floor DRY_ABOVE or more over the water: the water keeps out of it (a raised
 * floor over the water: none drawn under it, none waded in on it). A room called dry whose floor is under the water, or
 * not given, is flooded whatever it is called: water does not stop at a door (the owner, 2026-10-16, of a garage
 * standing in water with a dry floor at the same height: "i think the dry house is misplaced"). Where the water meets
 * its walls, either way, a line of scum and foam (src/world/ocean.ts).
 */
export interface WaterRoom {
  x: number;
  z: number;
  rot: number;
  hx: number;
  hz: number;
  dry?: boolean;
  /** the height of its floor (the world's): what says whether it can be dry */
  floor?: number;
}

/** how far over the water a room's floor must be for the room to be kept dry */
export const DRY_ABOVE = 0.1;

/** Whether a room keeps the water out, its water's surface being this high (see WaterRoom). */
export const keptDry = (r: WaterRoom, surface: number) => !!r.dry && r.floor !== undefined && r.floor >= surface + DRY_ABOVE;

export interface Waters {
  lakes: Lake[];
  rivers: River[];
  /** the buildings and rooms in the water (see WaterRoom) */
  rooms?: WaterRoom[];
}

/** How far a point is outside a room's walls (under 0 inside), on the ground's plane. */
export function fromRoom(r: WaterRoom, x: number, z: number): number {
  const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot), sn = Math.sin(r.rot);
  const qx = Math.abs(dx * c - dz * sn) - r.hx, qz = Math.abs(dx * sn + dz * c) - r.hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** What there is at a point that has water over it. */
export interface WaterHere {
  /** the height of the water's surface */
  surface: number;
  /** how deep it is there: the surface less the ground */
  depth: number;
  /** which way it runs, and how fast (metres a second): nothing in a lake */
  flow: [x: number, z: number, speed: number];
  kind: 'lake' | 'river';
}

/** What water does to a walker. Depths in metres. */
export const WADE = {
  /** shallower than this it is wet feet and nothing more */
  ankle: 0.15,
  /** at the waist a walker goes at this share of its pace on land */
  slowest: 0.45,
  waist: 0.95,
  /** deeper than this it is not walked into: a body stops at its edge */
  deep: 1.25,
  /** a river's pace: at the least, and how much faster for each metre it falls in a hundred */
  pace: [0.35, 0.55] as [number, number],
  /** and at the most */
  fastest: 3,
};

/** A walker's pace in water this deep, as a share of what it is on land: 1 down to WADE.slowest at the waist. */
export function wading(depth: number): number {
  if (depth <= WADE.ankle) return 1;
  const t = Math.min(1, (depth - WADE.ankle) / (WADE.waist - WADE.ankle));
  return 1 - (1 - WADE.slowest) * t * (2 - t);
}

/** Whether water this deep stops a walker at its edge. */
export const tooDeep = (depth: number) => depth > WADE.deep;

/** Whether a point is inside an outline (by the crossings of a line from it). */
export function inside(outline: [number, number][], x: number, z: number): boolean {
  let yes = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i], [xj, zj] = outline[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) yes = !yes;
  }
  return yes;
}

/** metres a side of the cells the waters are found by (each cell lists what can be over it) */
const CELL = 32;

/** One stretch of a river between two of its points, as the finding keeps it. */
interface Stretch {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ay: number;
  by: number;
  aw: number;
  bw: number;
  len: number;
  speed: number;
}

/** The waters laid out in cells, to be found quickly: made once for a set of waters (see waterAt). */
export class WaterIndex {
  private cells = new Map<number, { lakes: Lake[]; stretches: Stretch[]; dry: WaterRoom[] }>();

  constructor(readonly waters: Waters) {
    const cellOf = (i: number, j: number) => {
      const k = i * 100003 + j;
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = { lakes: [], stretches: [], dry: [] }));
      return c;
    };
    const over = (x0: number, x1: number, z0: number, z1: number, put: (c: { lakes: Lake[]; stretches: Stretch[]; dry: WaterRoom[] }) => void) => {
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) put(cellOf(i, j));
    };
    for (const lake of waters.lakes) {
      const xs = lake.outline.map((p) => p[0]), zs = lake.outline.map((p) => p[1]);
      over(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), (c) => c.lakes.push(lake));
    }
    for (const r of waters.rooms ?? []) {
      if (!r.dry) continue;
      const reach = Math.hypot(r.hx, r.hz);
      over(r.x - reach, r.x + reach, r.z - reach, r.z + reach, (c) => c.dry.push(r));
    }
    for (const river of waters.rivers) {
      for (let k = 0; k + 1 < river.pts.length; k++) {
        const [ax, az, ay, aw] = river.pts[k], [bx, bz, by, bw] = river.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1e-6, fall = Math.max(0, ay - by) / len;
        const s: Stretch = { ax, az, bx, bz, ay, by, aw, bw, len, speed: Math.min(WADE.fastest, WADE.pace[0] + WADE.pace[1] * fall * 100) };
        const r = Math.max(aw, bw) / 2;
        over(Math.min(ax, bx) - r, Math.max(ax, bx) + r, Math.min(az, bz) - r, Math.max(az, bz) + r, (c) => c.stretches.push(s));
      }
    }
  }

  /** The water over a point, if any: what its surface is, how deep, which way it runs. `ground` is the ground's height. */
  at(x: number, z: number, ground: (x: number, z: number) => number): WaterHere | null {
    const c = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!c) return null;
    let best: WaterHere | null = null;
    for (const lake of c.lakes) {
      if (!inside(lake.outline, x, z)) continue;
      const depth = lake.level - ground(x, z);
      if (depth > 0 && (!best || lake.level > best.surface)) best = { surface: lake.level, depth, flow: [0, 0, 0], kind: 'lake' };
    }
    // (of a river, the nearest stretch whose width takes the point in: where two meet, the one nearer its middle)
    let near = Infinity;
    for (const s of c.stretches) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (s.len * s.len)));
      const d = Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t)), half = (s.aw + (s.bw - s.aw) * t) / 2;
      if (d > half || d / half >= near) continue;
      const surface = s.ay + (s.by - s.ay) * t, depth = surface - ground(x, z);
      if (depth <= 0) continue;
      near = d / half;
      // (slower toward the banks than in its middle)
      const speed = s.speed * (1 - 0.6 * (d / half) * (d / half));
      best = { surface, depth, flow: [ex / s.len, ez / s.len, speed], kind: 'river' };
    }
    // (none on a floor kept dry over it)
    if (best && c.dry.some((r) => fromRoom(r, x, z) < 0 && keptDry(r, best!.surface))) return null;
    return best;
  }
}

/**
 * How far a point is from the edge of a river's water, across the ground (under 0 in it), if it is within `reach`
 * of one: for the world's paint and planting, a river's green line of banks through dry country (grass and reeds a few
 * metres out, a few trees further). By its middle line and width, not by the ground.
 */
export function riverBank(waters: Waters, x: number, z: number, reach = 40): number | null {
  let best: number | null = null;
  for (const river of waters.rivers) {
    for (let k = 0; k + 1 < river.pts.length; k++) {
      const [ax, az, , aw] = river.pts[k], [bx, bz, , bw] = river.pts[k + 1];
      if (Math.max(Math.min(ax, bx) - x, x - Math.max(ax, bx), Math.min(az, bz) - z, z - Math.max(az, bz)) > reach + Math.max(aw, bw)) continue;
      const ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L));
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t) - (aw + (bw - aw) * t) / 2;
      if (d <= reach && (best === null || d < best)) best = d;
    }
  }
  return best;
}

const indexes = new WeakMap<Waters, WaterIndex>();
/** The water over a point of a world's waters, if any (the waters are laid out in cells the first time they are asked of). */
export function waterAt(waters: Waters, x: number, z: number, ground: (x: number, z: number) => number): WaterHere | null {
  let index = indexes.get(waters);
  if (!index) indexes.set(waters, (index = new WaterIndex(waters)));
  return index.at(x, z, ground);
}
