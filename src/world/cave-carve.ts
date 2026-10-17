// The pass's caves carved out of the rock, each one closed surface: rock is what is under the ground and outside every
// gallery, and the surface between rock and air is found on a grid (surface nets). Kept: all of a cave's own surface,
// and at a mouth the face it is in, where the terrain is cut away for it (the terrain's own is drawn up to that hole).
// One mesh, one collider: what is seen is what stops a body, with no gaps between pieces to see the sky through.
// A gallery's width and height are the room it always gives (its walls are roughed outward, never in), so what caveAt
// and the loot know of a cave stays true. Pure, the same numbers on every machine.

import { RNG } from '../core/noise';
import { caveMouths, galleries, type Gallery, type Pass } from '../sim/pass';

export const CARVE = {
  /** the grid, metres */
  cell: 0.45,
  /** cells to a block, each way: only blocks near a gallery or a mouth are looked at */
  block: 12,
  /** how far a wall is roughed outward at most, for its size, fine and broad (and never more than these metres) */
  rough: 0.1,
  roughMost: 0.45,
  swell: 0.16,
  swellMost: 0.9,
  /** the floor's own bumps */
  bumps: 0.03,
  /** a mouth's gallery carried on out of the face, and how far in from a mouth its walls are not roughed (its hole is its width) */
  out: 1.5,
  smooth: 3,
  /** how round the meeting of two galleries */
  blend: 0.8,
  /** the carved ground (a mouth's face, its floor) lies this far under the true ground: the terrain is drawn over it */
  skin: 0.05,
  /** and is kept this far past the hole cut in the terrain for the mouth */
  margin: 0.6,
};

// ---- noise in three dimensions (improved Perlin), its own fixed table
const PERM = (() => {
  const r = new RNG(7331), p = new Uint8Array(256), out = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) out[i] = p[i & 255];
  return out;
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number, y: number, z: number) => {
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
};
const l = (a: number, b: number, t: number) => a + (b - a) * t;
export function noise3(x: number, y: number, z: number) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const P = PERM, xi = X & 255, yi = Y & 255, zi = Z & 255, u = fade(x), v = fade(y), w = fade(z);
  const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi, B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
  return l(
    l(l(grad(P[AA] & 15, x, y, z), grad(P[BA] & 15, x - 1, y, z), u), l(grad(P[AB] & 15, x, y - 1, z), grad(P[BB] & 15, x - 1, y - 1, z), u), v),
    l(l(grad(P[AA + 1] & 15, x, y, z - 1), grad(P[BA + 1] & 15, x - 1, y, z - 1), u), l(grad(P[AB + 1] & 15, x, y - 1, z - 1), grad(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
    w,
  );
}

/** a gallery made ready for the field: its ends (a mouth's carried out), its size, its roughness, its box */
interface Seg {
  ax: number; ay: number; az: number; by: number;
  ex: number; ez: number; run: number;
  w0: number; w1: number; h0: number; h1: number;
  /** how far past each end, metres on the ground's plane, it is carried (a mouth's out into the air) */
  lo: number; hi: number;
  /** whether each end is a mouth (its walls smooth near it) */
  m0: boolean; m1: boolean;
  rough: number; swell: number;
  box: [number, number, number, number, number, number];
}

function segOf(g: Gallery): Seg {
  const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], run = Math.hypot(ex, ez) || 1e-6, size = Math.min(Math.max(g.wa, g.wb), Math.max(g.ha, g.hb));
  const rough = Math.min(CARVE.rough * size, CARVE.roughMost), swell = Math.min(CARVE.swell * size, CARVE.swellMost);
  const lo = g.aMouth ? CARVE.out : Math.min(g.wa, g.wb) / 2, hi = g.bMouth ? CARVE.out : Math.min(g.wa, g.wb) / 2;
  const reach = Math.max(g.wa, g.wb) / 2 + rough + swell + 2 * CARVE.cell + 0.5, up = Math.max(g.ha, g.hb) + rough + swell + 2 * CARVE.cell;
  const ux = ex / run, uz = ez / run, x0 = g.a[0] - ux * lo, z0 = g.a[2] - uz * lo, x1 = g.b[0] + ux * hi, z1 = g.b[2] + uz * hi;
  return {
    ax: g.a[0], ay: g.a[1], az: g.a[2], by: g.b[1], ex, ez, run, w0: g.wa, w1: g.wb, h0: g.ha, h1: g.hb, lo, hi, m0: g.aMouth, m1: g.bMouth, rough, swell,
    box: [Math.min(x0, x1) - reach, Math.min(g.a[1], g.b[1]) - 1.5, Math.min(z0, z1) - reach, Math.max(x0, x1) + reach, Math.max(g.a[1], g.b[1]) + up, Math.max(z0, z1) + reach],
  };
}

/**
 * One gallery's air (negative inside, metres roughly): an arch over a flat floor, its walls nearly upright, round where
 * it ends. Its walls and roof roughed outward by `n` (0 to 1, fine and broad), its floor bumped by `b` (-1 to 1).
 */
function segField(s: Seg, x: number, y: number, z: number, fine: number, broad: number, bump: number) {
  const dx = x - s.ax, dz = z - s.az, u = (dx * s.ex + dz * s.ez) / (s.run * s.run);
  const k = u < 0 ? 0 : u > 1 ? 1 : u, lo = -s.lo / s.run, hi = 1 + s.hi / s.run, uc = u < lo ? lo : u > hi ? hi : u;
  const axial = Math.abs(u - uc) * s.run, lat = Math.abs(dx * s.ez - dz * s.ex) / s.run;
  const hw = (s.w0 + (s.w1 - s.w0) * k) / 2, h = s.h0 + (s.h1 - s.h0) * k, yf = s.ay + (s.by - s.ay) * k;
  const up = h * 0.62, down = h * 0.38 + 0.8, vy = y - (yf + h * 0.38), ny = vy > 0 ? vy / up : -vy / down;
  // (a rounded box: the four-norm, its walls upright and its roof flat but for the roughing)
  const a = (lat / hw) ** 2, c = ny * ny, e = (axial / hw) ** 2, norm = Math.sqrt(Math.sqrt(a * a + c * c + e * e));
  // (smooth near a mouth: its opening is its width, and the hole cut for it in the terrain is no wider)
  const along = u * s.run, calm = Math.min(s.m0 ? Math.max(0, along) / CARVE.smooth : 1, s.m1 ? Math.max(0, s.run - along) / CARVE.smooth : 1, 1);
  const wall = (norm - 1) * Math.min(hw, up) - calm * (s.rough * fine + s.swell * broad);
  // (carried past a bend, its floor rises away from it, steeper than any climb: the next gallery's floor is always the
  // lower, so that no ledge is left where a flat gallery meets one that climbs; out of a mouth it stays the shelf's)
  const past = u < 0 && !s.m0 ? -u * s.run : u > 1 && !s.m1 ? (u - 1) * s.run : 0;
  return Math.max(wall, yf + past * 1.2 - CARVE.skin - y + calm * CARVE.bumps * bump);
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

export interface Carved {
  cave: number;
  pos: Float32Array;
  nor: Float32Array;
  /** how open each point is (1) or shut in (toward 0): crevices and the roof's corners */
  ao: Float32Array;
  /** the cave's own faces, and the faces of the ground round its mouths (which cast the sun's shadow: the rock there is the face) */
  index: Uint32Array;
  face: Uint32Array;
  /** the grid's samples taken, and the milliseconds it took */
  samples: number;
  ms: number;
}

type Rect = ReturnType<typeof caveMouths>[number];
const inRect = (m: Rect, x: number, z: number, more: number) => {
  const dx = x - m.x, dz = z - m.z, c = Math.cos(m.rot), sn = Math.sin(m.rot);
  return Math.abs(dx * c - dz * sn) < m.hx + more && Math.abs(dx * sn + dz * c) < m.hz + more;
};

/**
 * One cave's field: negative in air (the cave's, or the open air over the ground), positive in rock; `caveAir` the
 * cave's air alone, `groundIn` the ground under its skin. `ground` is the true ground's height (the terrain's).
 */
export function caveField(p: Pass, cave: number, ground: (x: number, z: number) => number) {
  const segs = galleries(p).filter((g) => g.cave === cave).map(segOf);
  const mouths = caveMouths(p).filter((m) => m.cave === cave);
  const most = Math.max(...segs.map((s) => s.rough + s.swell)) + 0.6;
  // The ground under the skin, the skin pushed in along the ground's slope (so that on a riser too it is behind the
  // face): looked up once a column of the grid (the grid is the world's, from its origin), in proportion between.
  const C = CARVE.cell, raw = new Map<number, number>(), under = new Map<number, number>();
  const at = (i: number, k: number) => {
    const key = i + 32768 + (k + 32768) * 65536;
    let g = raw.get(key);
    if (g === undefined) raw.set(key, (g = ground(i * C, k * C)));
    return g;
  };
  const column = (i: number, k: number) => {
    const key = i + 32768 + (k + 32768) * 65536;
    let g = under.get(key);
    if (g === undefined) {
      const gx = (at(i + 1, k) - at(i - 1, k)) / (2 * C), gz = (at(i, k + 1) - at(i, k - 1)) / (2 * C);
      under.set(key, (g = at(i, k) - CARVE.skin * Math.sqrt(1 + gx * gx + gz * gz)));
    }
    return g;
  };
  const groundIn = (x: number, z: number) => {
    const fx = x / C, fz = z / C, i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    return l(l(column(i, k), column(i + 1, k), tx), l(column(i, k + 1), column(i + 1, k + 1), tx), tz);
  };
  // the cave's air alone, and with the open air over the ground
  const caveAir = (list: Seg[], x: number, y: number, z: number) => {
    let raw = Infinity;
    for (const s of list) raw = Math.min(raw, segField(s, x, y, z, 0, 0, 0));
    if (raw > most) return raw;
    const fine = 0.5 + 0.5 * (0.65 * noise3(x * 0.55, y * 0.55, z * 0.55) + 0.35 * noise3(x * 1.3 + 17, y * 1.3, z * 1.3)), broad = 0.5 + 0.5 * noise3(x * 0.12 + 40, y * 0.12, z * 0.12);
    const bump = noise3(x * 0.8 + 80, z * 0.8, 3.1);
    let f = Infinity;
    for (const s of list) f = smin(f, segField(s, x, y, z, fine, broad, bump), CARVE.blend);
    return f;
  };
  const field = (x: number, y: number, z: number) => Math.min(groundIn(x, z) - y, caveAir(segs, x, y, z));
  return { segs, mouths, groundIn, column, caveAir, field };
}

/** Carve one cave (see caveField), all at once. */
export function carveCave(p: Pass, cave: number, ground: (x: number, z: number) => number): Carved {
  const it = carving(p, cave, ground);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Carve one cave a piece at a time: it stops (yields) every few blocks, so that the game can carve between frames. */
export function* carving(p: Pass, cave: number, ground: (x: number, z: number) => number): Generator<void, Carved> {
  let busy = 0, t = performance.now(), ms = 0;
  const C = CARVE.cell, B = CARVE.block;
  const { segs, mouths, groundIn, column, caveAir, field } = caveField(p, cave, ground);

  // ---- which blocks: near a gallery's line, or over a mouth's hole
  // (on the world's grid, so that a block's corners are the ground's columns)
  const origin = [0, 1, 2].map((k) => Math.floor((Math.min(...segs.map((s) => s.box[k])) - 4) / C) * C);
  const o0 = Math.round(origin[0] / C), o2 = Math.round(origin[2] / C);
  const blocks = new Map<number, [number, number, number]>(), BS = B * C;
  const keyOf = (bi: number, bj: number, bk: number) => bi + bj * 1024 + bk * 1048576;
  const want = (box: number[], near?: (cx: number, cy: number, cz: number) => boolean) => {
    for (let bi = Math.floor((box[0] - origin[0]) / BS); bi <= Math.floor((box[3] - origin[0]) / BS); bi++)
      for (let bj = Math.floor((box[1] - origin[1]) / BS); bj <= Math.floor((box[4] - origin[1]) / BS); bj++)
        for (let bk = Math.floor((box[2] - origin[2]) / BS); bk <= Math.floor((box[5] - origin[2]) / BS); bk++) {
          if (near && !near(origin[0] + (bi + 0.5) * BS, origin[1] + (bj + 0.5) * BS, origin[2] + (bk + 0.5) * BS)) continue;
          blocks.set(keyOf(bi, bj, bk), [bi, bj, bk]);
        }
  };
  const halfDiag = (BS * Math.sqrt(3)) / 2;
  for (const s of segs) {
    const reach = Math.max(s.w0, s.w1) / 2 + s.rough + s.swell + 2 * C + 0.5 + halfDiag, ux = s.ex / s.run, uz = s.ez / s.run;
    want(s.box, (cx, _cy, cz) => {
      const along = Math.max(-s.lo, Math.min(s.run + s.hi, (cx - s.ax) * ux + (cz - s.az) * uz));
      return Math.hypot(cx - (s.ax + ux * along), cz - (s.az + uz * along)) < reach;
    });
  }
  for (const m of mouths) {
    const r = Math.hypot(m.hx, m.hz) + CARVE.margin + 1.5;
    let top = m.floor;
    for (let a = -1; a <= 1; a += 0.25) for (let b = -1; b <= 1; b += 0.25) top = Math.max(top, ground(m.x + a * r, m.z + b * r));
    want([m.x - r, m.floor - 2, m.z - r, m.x + r, top + 2, m.z + r]);
  }

  // ---- the surface: a point in each cell the surface passes through, then a face for each edge it crosses
  // (each block's cells' points, by the cell: -1 where the surface does not pass)
  const pos: number[] = [], verts = new Map<number, Int32Array>(), edges: number[] = [];
  const vertAt = (i: number, j: number, k: number) => {
    const bi = Math.floor(i / B), bj = Math.floor(j / B), bk = Math.floor(k / B), bv = verts.get(keyOf(bi, bj, bk));
    return bv ? bv[i - bi * B + (j - bj * B) * B + (k - bk * B) * B * B] : -1;
  };
  // (the cave's field first every other corner: where all eight round a corner are well in the rock, the surface cannot
  // be near it and it is not looked at again; it is only the cave's own surface that wants the grid's full fineness)
  const N = B + 1, H = B / 2 + 1, FAR = 2.2, vals = new Float32Array(N * N * N), cols = new Float32Array(N * N), coarse = new Float32Array(H * H * H), far = new Uint8Array((H - 1) ** 3);
  let samples = 0;
  const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGE = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [bi, bj, bk] of blocks.values()) {
    const x0 = origin[0] + bi * BS, y0 = origin[1] + bj * BS, z0 = origin[2] + bk * BS;
    const list = segs.filter((s) => s.box[0] <= x0 + BS && s.box[3] >= x0 && s.box[1] <= y0 + BS && s.box[4] >= y0 && s.box[2] <= z0 + BS && s.box[5] >= z0);
    for (let a = 0; a < N; a++) for (let c = 0; c < N; c++) cols[a + c * N] = column(o0 + bi * B + a, o2 + bk * B + c);
    if (list.length) {
      for (let a = 0; a < H; a++) for (let b = 0; b < H; b++) for (let c = 0; c < H; c++) coarse[a + b * H + c * H * H] = caveAir(list, x0 + 2 * a * C, y0 + 2 * b * C, z0 + 2 * c * C);
      for (let a = 0; a + 1 < H; a++) for (let b = 0; b + 1 < H; b++) for (let c = 0; c + 1 < H; c++) {
        let low = Infinity;
        for (const [da, db, dc] of CORNER) low = Math.min(low, coarse[a + da + (b + db) * H + (c + dc) * H * H]);
        far[a + b * (H - 1) + c * (H - 1) * (H - 1)] = low > FAR ? 1 : 0;
      }
      samples += H * H * H;
    }
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
      const y = y0 + b * C, g = cols[a + c * N] - y;
      let v = g;
      if (list.length) {
        const ca = Math.min(a >> 1, H - 2), cb = Math.min(b >> 1, H - 2), cc = Math.min(c >> 1, H - 2);
        if (far[ca + cb * (H - 1) + cc * (H - 1) * (H - 1)]) v = Math.min(g, FAR);
        else if (!(a & 1) && !(b & 1) && !(c & 1)) v = Math.min(g, coarse[(a >> 1) + (b >> 1) * H + (c >> 1) * H * H]);
        else {
          v = Math.min(g, caveAir(list, x0 + a * C, y, z0 + c * C));
          samples++;
        }
      }
      vals[a + b * N + c * N * N] = v;
    }
    if (++busy % 4 === 0) {
      const now = performance.now();
      ms += now - t;
      yield;
      t = performance.now();
    }
    const v = [0, 0, 0, 0, 0, 0, 0, 0], bv = new Int32Array(B * B * B).fill(-1);
    verts.set(keyOf(bi, bj, bk), bv);
    for (let a = 0; a < B; a++) for (let b = 0; b < B; b++) for (let c = 0; c < B; c++) {
      let mask = 0;
      for (let q = 0; q < 8; q++) {
        v[q] = vals[a + CORNER[q][0] + (b + CORNER[q][1]) * N + (c + CORNER[q][2]) * N * N];
        if (v[q] > 0) mask |= 1 << q;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [e0, e1] of EDGE) {
        if (v[e0] > 0 === v[e1] > 0) continue;
        const t = v[e0] / (v[e0] - v[e1]);
        sx += CORNER[e0][0] + (CORNER[e1][0] - CORNER[e0][0]) * t;
        sy += CORNER[e0][1] + (CORNER[e1][1] - CORNER[e0][1]) * t;
        sz += CORNER[e0][2] + (CORNER[e1][2] - CORNER[e0][2]) * t;
        n++;
      }
      const i = bi * B + a, j = bj * B + b, k = bk * B + c;
      bv[a + b * B + c * B * B] = pos.length / 3;
      pos.push(origin[0] + (i + sx / n) * C, origin[1] + (j + sy / n) * C, origin[2] + (k + sz / n) * C);
      // the edges out of the cell's lowest corner that the surface crosses (and which way: rock at their low end or air)
      for (const [axis, q] of [[0, 1], [1, 2], [2, 4]] as const) if (v[0] > 0 !== v[q] > 0) edges.push(i, j, k, axis, v[0] > 0 ? 1 : 0);
    }
  }

  // ---- each vertex: which way the surface faces (the field's slope), whether it is the cave's or the ground's, how shut in
  const nv = pos.length / 3, nor = new Float32Array(nv * 3), ao = new Float32Array(nv), ofCave = new Uint8Array(nv), e = C * 0.5;
  for (let q = 0; q < nv; q++) {
    const x = pos[q * 3], y = pos[q * 3 + 1], z = pos[q * 3 + 2];
    if (q % 1500 === 1499) {
      const now = performance.now();
      ms += now - t;
      yield;
      t = performance.now();
    }
    // (the field's slope from four looks round the point, a tetrahedron's corners)
    const k1 = field(x + e, y - e, z - e), k2 = field(x - e, y - e, z + e), k3 = field(x - e, y + e, z - e), k4 = field(x + e, y + e, z + e);
    let gx = -(k1 - k2 - k3 + k4), gy = -(-k1 - k2 + k3 + k4), gz = -(-k1 + k2 - k3 + k4);
    const l = Math.hypot(gx, gy, gz) || 1;
    gx /= l; gy /= l; gz /= l;
    nor.set([gx, gy, gz], q * 3);
    // (where the two meet, as on the floor carried out of a mouth onto the shelf, it is the ground's)
    ofCave[q] = caveAir(segs, x, y, z) < groundIn(x, z) - y - 0.01 ? 1 : 0;
    // (how much rock is near, out along the facing: the further the field falls short of the distance, the more shut in)
    let shut = 0, all = 0;
    for (const [d, w] of [[0.35, 1], [0.8, 0.8], [1.6, 0.6], [3, 0.4]]) {
      shut += (w * Math.max(0, d + field(x + gx * d, y + gy * d, z + gz * d))) / d;
      all += w;
    }
    ao[q] = Math.max(0.15, 1 - 0.85 * Math.min(1, shut / all));
  }

  // ---- the faces, kept where they are the cave's, or the ground's over a mouth's hole
  const index: number[] = [], face: number[] = [], P3 = (q: number) => [pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]];
  const cross = (a: number[], b: number[], c: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  };
  const AROUND = [
    [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]],
    [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]],
    [[0, 0, 0], [-1, 0, 0], [-1, -1, 0], [0, -1, 0]],
  ];
  for (let q = 0; q < edges.length; q += 5) {
    const i = edges[q], j = edges[q + 1], k = edges[q + 2], axis = edges[q + 3], rockLow = edges[q + 4];
    const vs = AROUND[axis].map(([a, b, c]) => vertAt(i + a, j + b, k + c));
    if (vs.some((x) => x < 0)) continue;
    const ground = !vs.some((x) => ofCave[x]);
    if (ground) {
      const cx = (pos[vs[0] * 3] + pos[vs[2] * 3]) / 2, cz = (pos[vs[0] * 3 + 2] + pos[vs[2] * 3 + 2]) / 2;
      if (!mouths.some((m) => inRect(m, cx, cz, CARVE.margin))) continue;
    }
    // (facing the air: the cells round an edge are listed turning about its axis, so they face along it; reversed
    // where the edge runs from air to rock)
    if (rockLow !== 1) vs.reverse();
    // (split along the diagonal that leaves both halves facing as the whole does, the shorter if both do)
    const Q = vs.map(P3), N = [0, 0, 0];
    for (let n = 0; n < 4; n++) {
      const a = Q[n], b = Q[(n + 1) % 4];
      N[0] += (a[1] - b[1]) * (a[2] + b[2]);
      N[1] += (a[2] - b[2]) * (a[0] + b[0]);
      N[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const agree = (t: number[]) => {
      const c = cross(Q[t[0]], Q[t[1]], Q[t[2]]);
      return c[0] * N[0] + c[1] * N[1] + c[2] * N[2];
    };
    const splits = [[[0, 1, 2], [0, 2, 3]], [[0, 1, 3], [1, 2, 3]]];
    const len = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const score = splits.map((sp) => Math.min(agree(sp[0]), agree(sp[1])));
    const pick = score[0] > 0 && score[1] > 0 ? (len(Q[0], Q[2]) <= len(Q[1], Q[3]) ? 0 : 1) : score[0] >= score[1] ? 0 : 1;
    (ground ? face : index).push(...splits[pick].flat().map((n) => vs[n]));
  }

  // ---- only the vertices the kept faces use
  const used = new Int32Array(nv).fill(-1);
  let m = 0;
  for (const q of index) if (used[q] < 0) used[q] = m++;
  for (const q of face) if (used[q] < 0) used[q] = m++;
  const P = new Float32Array(m * 3), Nn = new Float32Array(m * 3), A = new Float32Array(m);
  for (let q = 0; q < nv; q++) {
    const to = used[q];
    if (to < 0) continue;
    P.set([pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]], to * 3);
    Nn.set([nor[q * 3], nor[q * 3 + 1], nor[q * 3 + 2]], to * 3);
    A[to] = ao[q];
  }
  return { cave, pos: P, nor: Nn, ao: A, index: Uint32Array.from(index, (q) => used[q]), face: Uint32Array.from(face, (q) => used[q]), samples, ms: ms + performance.now() - t };
}
