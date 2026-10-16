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
}

/**
 * A river: its middle line from its spring end to its mouth, each point where it is, the height of its water there and
 * how wide it is. The water falls downstream; where it runs fast it falls in small steps (two points close together).
 */
export interface River {
  name?: string;
  pts: [x: number, z: number, surface: number, width: number][];
}

export interface Waters {
  lakes: Lake[];
  rivers: River[];
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
  private cells = new Map<number, { lakes: Lake[]; stretches: Stretch[] }>();

  constructor(readonly waters: Waters) {
    const cellOf = (i: number, j: number) => {
      const k = i * 100003 + j;
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = { lakes: [], stretches: [] }));
      return c;
    };
    const over = (x0: number, x1: number, z0: number, z1: number, put: (c: { lakes: Lake[]; stretches: Stretch[] }) => void) => {
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) put(cellOf(i, j));
    };
    for (const lake of waters.lakes) {
      const xs = lake.outline.map((p) => p[0]), zs = lake.outline.map((p) => p[1]);
      over(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), (c) => c.lakes.push(lake));
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
    return best;
  }
}

const indexes = new WeakMap<Waters, WaterIndex>();
/** The water over a point of a world's waters, if any (the waters are laid out in cells the first time they are asked of). */
export function waterAt(waters: Waters, x: number, z: number, ground: (x: number, z: number) => number): WaterHere | null {
  let index = indexes.get(waters);
  if (!index) indexes.set(waters, (index = new WaterIndex(waters)));
  return index.at(x, z, ground);
}
