// What of a base stops a body, a round and a blast, and what lies on it (2026-10-24). The owner, via the navigator:
// "items i drop on the ground should not clip through the floor of my base, neither should players when theyre killed
// or disconnecting ... bases need full collision, also should be communicated to server so it cant be shot through or
// noclipped into somehow via relogging etc...". Every piece is the solids it is drawn and stood on as
// (src/sim/build/solids.ts), held here as planes, its leaves where its door's state has them. Asked by the server
// wherever it judges a step, a shot or a blast and wherever it finds what a body or a thing lies on; by the game where
// it lays a body its colliders do not reach.

import { PIECES, type Role } from './pieces';
import { angleOf, toLocal, toWorld, type Base, type Piece } from './snap';
import { shapeOf, type Solid } from './solids';

type V3 = [number, number, number];
/** a convex solid: inside where n·p <= d for every plane */
interface Convex {
  planes: [number, number, number, number][];
}
interface Leafed {
  hinge: V3;
  axis: 'x' | 'y';
  open: number;
  parts: Convex[];
}
interface Kind {
  body: Convex[];
  leaves: Leafed[];
  /** its box in its own frame, leaves at every angle and a hand over */
  lo: V3;
  hi: V3;
  /** the middle of its solids as it stands shut, in its own frame (where a blast is looked for it from) */
  mid: V3;
  role: Role;
}

/**
 * What is asked: a round or a blast (`shot`: everything but a ladder or a torch on the wall), a body's step (`move`:
 * walls, floors, fittings and high walls, a little fattened so a body's middle does not slip between bars), what a
 * thing lies on (`stand`), and a body that is in something (`body`).
 */
export type Use = 'shot' | 'move' | 'stand' | 'body';
const ROLES: Record<Use, ReadonlySet<Role>> = {
  shot: new Set(['floor', 'wall', 'stairs', 'steps', 'free', 'fit', 'deploy']),
  move: new Set(['floor', 'wall', 'free', 'fit']),
  stand: new Set(['floor', 'wall', 'stairs', 'steps', 'free', 'fit', 'deploy']),
  body: new Set(['floor', 'wall', 'free', 'fit', 'deploy']),
};
/** how much a solid is fattened for a body's step: bars stand 0.13 m apart, and a body is 0.3 round */
const FAT = 0.08;

function planesOf(s: Solid): Convex {
  if ('box' in s) {
    const [cx, cy, cz, sx, sy, sz] = s.box;
    return { planes: [[1, 0, 0, cx + sx / 2], [-1, 0, 0, -(cx - sx / 2)], [0, 1, 0, cy + sy / 2], [0, -1, 0, -(cy - sy / 2)], [0, 0, 1, cz + sz / 2], [0, 0, -1, -(cz - sz / 2)]] };
  }
  if ('prism' in s) {
    // (its outline's hull, turned round once: each edge's outward side)
    const pts = hull2(s.prism), planes: Convex['planes'] = [[0, 1, 0, s.y1], [0, -1, 0, -s.y0]];
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez);
      if (l < 1e-9) continue;
      const nx = ez / l, nz = -ex / l;
      planes.push([nx, 0, nz, nx * ax + nz * az]);
    }
    return { planes };
  }
  // (a hull of a few points: every plane through three of them with all the rest on one side)
  const p = s.hull, planes: Convex['planes'] = [];
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++)
      for (let k = j + 1; k < p.length; k++) {
        const u = sub(p[j], p[i]), v = sub(p[k], p[i]);
        let n = cross(u, v);
        const l = Math.hypot(...n);
        if (l < 1e-9) continue;
        n = [n[0] / l, n[1] / l, n[2] / l];
        let d = dot(n, p[i]), over = 0, under = 0;
        for (const q of p) {
          const e = dot(n, q) - d;
          if (e > 1e-6) over++;
          else if (e < -1e-6) under++;
        }
        if (over && under) continue;
        if (over) {
          n = [-n[0], -n[1], -n[2]];
          d = -d;
        }
        if (!planes.some((q) => Math.abs(q[0] - n[0]) + Math.abs(q[1] - n[1]) + Math.abs(q[2] - n[2]) < 1e-6)) planes.push([n[0], n[1], n[2], d]);
      }
  return { planes };
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** a 2D hull of (x, z) points */
function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && turn(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && turn(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  // (counter-clockwise with z taken for a page's up: the outward side of an edge (ex, ez) is (ez, -ex))
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** a point of a leaf's frame turned `a` about its hinge's line (as doors.ts `leafPoint` turns it), and back */
function turn(axis: 'x' | 'y', a: number, p: V3): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  return axis === 'y' ? [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c] : [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

function cornersOf(s: Solid): V3[] {
  if ('box' in s) {
    const [cx, cy, cz, sx, sy, sz] = s.box, out: V3[] = [];
    for (const i of [-0.5, 0.5]) for (const j of [-0.5, 0.5]) for (const k of [-0.5, 0.5]) out.push([cx + i * sx, cy + j * sy, cz + k * sz]);
    return out;
  }
  if ('prism' in s) return s.prism.flatMap(([x, z]): V3[] => [[x, s.y0, z], [x, s.y1, z]]);
  return s.hull;
}

const kinds = new Map<string, Kind>();
function kindOf(k: string): Kind {
  let K = kinds.get(k);
  if (K) return K;
  const s = shapeOf(k), lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: V3) => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i] - 0.15);
      hi[i] = Math.max(hi[i], p[i] + 0.15);
    }
  };
  const mid: V3 = [0, 0, 0];
  let n = 0;
  const into = (c: V3) => {
    for (let i = 0; i < 3; i++) mid[i] += c[i];
    n++;
  };
  for (const q of s.solid) for (const c of cornersOf(q)) {
    grow(c);
    into(c);
  }
  for (const l of s.leaves ?? []) for (const q of l.solid) for (const c of cornersOf(q)) into(sum(c, l.hinge));
  if (n) for (let i = 0; i < 3; i++) mid[i] /= n;
  const leaves = (s.leaves ?? []).map((l): Leafed => {
    for (const q of l.solid) for (const c of cornersOf(q)) for (let i = 0; i <= 4; i++) grow(sum(turn(l.axis, (l.open * i) / 4, c), l.hinge));
    return { hinge: l.hinge, axis: l.axis, open: l.open, parts: l.solid.map(planesOf) };
  });
  kinds.set(k, (K = { body: s.solid.map(planesOf), leaves, lo, hi, mid, role: PIECES[k].role }));
  return K;
}
const sum = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** where a line `a` + t·`d` (t from 0 to 1) is inside a solid fattened by `g`: [in, out], or null */
function clip(cv: Convex, a: V3, d: V3, g: number): [number, number] | null {
  let t0 = 0, t1 = 1;
  for (const [nx, ny, nz, pd] of cv.planes) {
    const den = nx * d[0] + ny * d[1] + nz * d[2], num = pd + g - (nx * a[0] + ny * a[1] + nz * a[2]);
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/** a box a line's two ends are both on one side of */
function missesBox(a: V3, b: V3, lo: V3, hi: V3) {
  for (let i = 0; i < 3; i++) if ((a[i] < lo[i] && b[i] < lo[i]) || (a[i] > hi[i] && b[i] > hi[i])) return true;
  return false;
}

/** a base's reach, worked out again whenever a piece comes or goes */
interface Reach {
  key: string;
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  /** its outline across the ground in its own frame: the hull of its pieces' cells */
  outline: [number, number][];
}

export class BaseSolids {
  private reach = new WeakMap<Base, Reach>();
  constructor(private all: () => Iterable<Base>) {}

  private reachOf(b: Base): Reach {
    const key = `${b.next}:${b.pieces.size}`;
    let r = this.reach.get(b);
    if (r?.key === key) return r;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const corners: [number, number][] = [];
    for (const p of b.pieces.values()) {
      for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]]) corners.push([p.x + dx, p.z + dz]);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    // (a piece reaches four metres round its middle at most, and from three below its foot to seven over: a high wall)
    r = { key, x: b.ox + mx * c + mz * s, z: b.oz - mx * s + mz * c, r: Math.hypot(x1 - x0, z1 - z0) / 2 + 4.5, y0: b.oy + y0 - 3.5, y1: b.oy + y1 + 7, outline: hull2(corners) };
    this.reach.set(b, r);
    return r;
  }

  /**
   * Each solid of every piece a line from `a` to `b` may pass, asked for `use`: `fn` is given where along the line it
   * is inside it ([in, out], 0 to 1), its piece and base. Returning true stops the search.
   */
  private each(a: V3, b: V3, use: Use, fn: (tt: [number, number], p: Piece, base: Base) => boolean | void) {
    const roles = ROLES[use], g = use === 'move' ? FAT : 0;
    const lx = b[0] - a[0], lz = b[2] - a[2], ll = lx * lx + lz * lz;
    for (const base of this.all()) {
      if (!base.pieces.size) continue;
      const R = this.reachOf(base);
      if (Math.max(a[1], b[1]) < R.y0 || Math.min(a[1], b[1]) > R.y1) continue;
      // (the line's nearest to the base's middle, across the ground)
      const t = ll < 1e-9 ? 0 : Math.max(0, Math.min(1, ((R.x - a[0]) * lx + (R.z - a[2]) * lz) / ll));
      if (Math.hypot(a[0] + lx * t - R.x, a[2] + lz * t - R.z) > R.r) continue;
      const A = toLocal(base, a[0], a[1], a[2]), B = toLocal(base, b[0], b[1], b[2]);
      for (const p of base.pieces.values()) {
        const K = kindOf(p.k);
        if (!roles.has(K.role)) continue;
        // (into the piece's own frame: as doors.ts `inBase`, the other way)
        const q = angleOf(p.r), c = Math.cos(q), s = Math.sin(q);
        const pa: V3 = [(A[0] - p.x) * c - (A[2] - p.z) * s, A[1] - p.y, (A[0] - p.x) * s + (A[2] - p.z) * c];
        const pb: V3 = [(B[0] - p.x) * c - (B[2] - p.z) * s, B[1] - p.y, (B[0] - p.x) * s + (B[2] - p.z) * c];
        if (missesBox(pa, pb, K.lo, K.hi)) continue;
        const d = sub(pb, pa);
        for (const cv of K.body) {
          const tt = clip(cv, pa, d, g);
          if (tt && fn(tt, p, base)) return;
        }
        for (const l of K.leaves) {
          // (and into the leaf's, as it stands: open or shut, as the server has it)
          const a2 = -(p.open ? l.open : 0), la = turn(l.axis, a2, sub(pa, l.hinge)), lb = turn(l.axis, a2, sub(pb, l.hinge)), ld = sub(lb, la);
          for (const cv of l.parts) {
            const tt = clip(cv, la, ld, g);
            if (tt && fn(tt, p, base)) return;
          }
        }
      }
    }
  }

  /** how far along a line from `a` to `b` (0 to 1) it first goes into a solid; a line that starts in one is in it at 0 */
  hit(a: V3, b: V3, use: Use = 'shot'): number | null {
    let best: number | null = null;
    this.each(a, b, use, (tt) => {
      if (best === null || tt[0] < best) best = tt[0];
      return best === 0;
    });
    return best;
  }

  /** the piece a line from `a` to `b` first goes into, how far along it (0 to 1), and its base (null: none) */
  first(a: V3, b: V3, use: Use = 'shot'): { t: number; p: Piece; base: Base } | null {
    const best: { t: number; p: Piece | null; base: Base | null } = { t: Infinity, p: null, base: null };
    this.each(a, b, use, (tt, p, base) => {
      if (tt[0] < best.t) Object.assign(best, { t: tt[0], p, base });
      return best.t === 0;
    });
    return best.p && best.base ? { t: best.t, p: best.p, base: best.base } : null;
  }

  /**
   * The pieces a blast at `at` reaches, and how far each is from it: each looked for along a line from the blast to its
   * middle, and reached where that line goes into it first. One that another piece stands in front of along that line
   * is not reached: the wall a charge is stuck to takes it, and what is behind that wall does not.
   */
  reached(at: V3, within: number): { p: Piece; base: Base; d: number }[] {
    const out: { p: Piece; base: Base; d: number }[] = [];
    for (const base of this.around(at[0], at[2], within)) {
      for (const p of base.pieces.values()) {
        const K = kindOf(p.k);
        if (!ROLES.shot.has(K.role)) continue;
        // (its middle, out of its own frame into the base's, then the world's)
        const q = angleOf(p.r), c = Math.cos(q), s = Math.sin(q), [mx, my, mz] = K.mid;
        const mid = toWorld(base, p.x + mx * c + mz * s, p.y + my, p.z - mx * s + mz * c) as V3;
        const far = Math.hypot(mid[0] - at[0], mid[1] - at[1], mid[2] - at[2]);
        if (far > within + 4.5) continue;
        const f = this.first(at, mid, 'shot');
        if (!f || f.p !== p || f.base !== base || f.t * far > within) continue;
        out.push({ p, base, d: f.t * far });
      }
    }
    return out;
  }

  /** whether nothing of a base stands on the line between two places: what a round and a blast are asked */
  clear(a: V3, b: V3) {
    return this.hit(a, b, 'shot') === null;
  }

  /** whether a body's step from `a` to `b` goes into a wall, a floor, a door or a fitting (one already in one may step out of it) */
  crosses(a: V3, b: V3) {
    let yes = false;
    this.each(a, b, 'move', (tt) => (yes = tt[0] > 1e-6));
    return yes;
  }

  /** the highest top of a base's solids under a place, no higher than it: what a body or a thing there lies on (-Infinity: none) */
  top(x: number, y: number, z: number, depth = 40): number {
    let best = -Infinity;
    this.each([x, y, z], [x, y - depth, z], 'stand', (tt) => {
      // (a solid the place is already in has its top over it, and is not what it lies on)
      if (tt[0] > 0) best = Math.max(best, y - tt[0] * depth);
    });
    return best;
  }

  /** whether a place is inside one of a base's solids (a wall, a floor, a fitting, a box) */
  within(x: number, y: number, z: number) {
    let yes = false;
    this.each([x, y, z], [x, y + 1e-4, z], 'body', (tt) => (yes = tt[0] === 0));
    return yes;
  }

  /**
   * The base a place is shut in: one of its floors under it and one of its floors or roofs over it (a room of it, as
   * Rust asks of a sleeper who wakes in somebody else's base). Null: in none.
   */
  roomOf(x: number, y: number, z: number): Base | null {
    const under = new Set<Base>(), over = new Set<Base>();
    this.each([x, y + 0.5, z], [x, y - 1.5, z], 'stand', (tt, p, b) => {
      if (tt[0] > 0 && PIECES[p.k].role === 'floor') under.add(b);
    });
    if (!under.size) return null;
    this.each([x, y + 0.5, z], [x, y + 6, z], 'stand', (_tt, p, b) => {
      if (PIECES[p.k].role === 'floor' && under.has(b)) over.add(b);
    });
    return [...over][0] ?? null;
  }

  /** whether a place is within a base's outline across the ground (the hull of its pieces' cells), grown by `grow` */
  within2(b: Base, x: number, z: number, grow = 1) {
    if (!b.pieces.size) return false;
    const o = this.reachOf(b).outline, [lx, , lz] = toLocal(b, x, 0, z);
    for (let i = 0; i < o.length; i++) {
      const [ax, az] = o[i], [bx, bz] = o[(i + 1) % o.length], ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez);
      if (l > 1e-9 && ((lx - ax) * ez - (lz - az) * ex) / l > grow) return false;
    }
    return true;
  }

  /** the bases with a piece within about `within` metres of a place, across the ground (by their reach: cheap) */
  around(x: number, z: number, within: number): Base[] {
    const out: Base[] = [];
    for (const b of this.all()) {
      if (!b.pieces.size) continue;
      const R = this.reachOf(b);
      if (Math.hypot(R.x - x, R.z - z) < R.r + within) out.push(b);
    }
    return out;
  }

  /** whether any base has a piece within `within` metres of a place, across the ground */
  near(x: number, z: number, within: number) {
    for (const b of this.all()) {
      if (!b.pieces.size) continue;
      const R = this.reachOf(b);
      if (Math.hypot(R.x - x, R.z - z) < R.r + within) return true;
    }
    return false;
  }
}
