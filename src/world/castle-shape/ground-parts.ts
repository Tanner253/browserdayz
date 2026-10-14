// The fort's shape: the parts that meet the ground (mounds, the apron round a hatch, the lid over cut ground, lumps of rock, vaults).
// (One part of castle-shape.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { cutPoly, clipOut } from '../../sim/kit';
import { type hatchLine, UNDER, type Mound, moundTop, type V3, rough, type Apron, CASTLE, type Lump, type Vault } from '../../sim/castle';
import { UP, add, cross, dot, hash, len, mul, sorted, sub, unit, type Out, type UV } from './base';
import { block, boxSolid, type Put } from './parts';

/** a hatch's stairwell and its passage, for made ground to keep out of: its line (see `hatchLine`) and the ground it stands at */
export interface Way { L: ReturnType<typeof hatchLine>; g: number }

/** the floor of a hatch's way at a spot within `by` of it, and whether it is open to the sky there (null: no hatch's way is there) */
function wayAt(ways: Way[], x: number, z: number, by: number): { floor: number; open: boolean } | null {
  const H = UNDER.hatch;
  for (const { L, g } of ways) {
    const ax = x - L.head[0], az = z - L.head[2], along = ax * L.d[0] + az * L.d[1], off = Math.abs(ax * L.r[0] + az * L.r[1]);
    if (along > -0.4 - by && along < H.run + 0.65 + by && off < H.wide / 2 + 0.45 + by) return { floor: g - H.drop, open: true };
    for (let k = 0; k + 1 < L.path.length; k++) {
      const a = L.path[k], b = L.path[k + 1], ex = b[0] - a[0], ez = b[2] - a[2], t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[2]) * ez) / (ex * ex + ez * ez)));
      // (its floor where it is nearest: a passage falls along its length, and what is clear over one end of it is in the other)
      if (Math.hypot(x - a[0] - ex * t, z - a[2] - ez * t) < H.wide / 2 + 0.45 + by) return { floor: a[1] + (b[1] - a[1]) * t - 0.1, open: false };
    }
  }
  return null;
}

export function moundPart(m: Mound, o: Out, put: Put, lod: number, ground: (x: number, z: number) => number, ways: Way[]) {
  const nx = Math.round((m.x1 - m.x0) / m.cell), nz = Math.round((m.z1 - m.z0) / m.cell), W = nx + 1, step = lod ? 3 : 1;
  const H = new Float32Array(W * (nz + 1));
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    let y = moundTop(m.kind, m.x0 + ix * m.cell, m.z0 + iz * m.cell);
    // (made ground gives way to a hatch: it is not in its stairwell; and over its passage it lies over the passage's
    // roof and nowhere lower. Not let down under the floor in the places where it would be in the way: a place let
    // down beside one that is not is a wall across the passage, which was found by walking into it.)
    const way = ways.length ? wayAt(ways, m.x0 + ix * m.cell, m.z0 + iz * m.cell, m.cell) : null;
    if (way) y = way.open ? Math.min(y, way.floor - 0.7) : Math.max(y, way.floor + UNDER.hatch.tall + 0.85);
    H[iz * W + ix] = y;
  }
  // (what is drawn: the same heights, but where the ground is said to be far under everything, which is how it is
  // kept out of a stair or from under a floor, its edge is drawn as a short skirt and not as a face thirty metres deep)
  const D = Float32Array.from(H);
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    if (H[iz * W + ix] > -20) continue;
    let by = -Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx >= 0 && jx <= nx && jz >= 0 && jz <= nz && H[jz * W + jx] > -20) by = Math.max(by, H[jz * W + jx] - 0.9);
    }
    if (by > -Infinity) D[iz * W + ix] = by;
  }
  const P = (ix: number, iz: number): V3 => [m.x0 + ix * m.cell, D[iz * W + ix], m.z0 + iz * m.cell];
  const N = (ix: number, iz: number): V3 => {
    const x0 = Math.max(0, ix - 1), x1 = Math.min(nx, ix + 1), z0 = Math.max(0, iz - 1), z1 = Math.min(nz, iz + 1);
    return unit([-(D[iz * W + x1] - D[iz * W + x0]) / ((x1 - x0) * m.cell), 1, -(D[z1 * W + ix] - D[z0 * W + ix]) / ((z1 - z0) * m.cell)]);
  };
  const tone = (p: V3) => (m.tone ?? 1) * (0.84 + 0.32 * rough(p[0] * 0.35, p[2] * 0.35, 3));
  // ONE HEAP WITH ITS TOP. A heap's foot goes on down under the hill, by its own slope; where the hill itself falls
  // away further out (the world's cliff, twelve metres from the wall), that foot would come out of the cliff's face
  // again, a sheet of rubble hung in the air (it was seen from the hollow as a white arch). So only what is joined to
  // the heap's top by rubble that shows is made: square by square from the top outward, and no further than the
  // first place the hill has it covered.
  const shows = (ix: number, iz: number) => {
    const c = [P(ix, iz), P(ix + 1, iz), P(ix, iz + 1), P(ix + 1, iz + 1)];
    return !(Math.max(...c.map((p) => p[1] - ground(p[0], p[2]))) < -0.4 || Math.max(...c.map((p) => p[1])) < -20);
  };
  const one = new Uint8Array(nx * nz);
  {
    let top = 0;
    for (let i = 1; i < H.length; i++) if (H[i] > H[top]) top = i;
    const todo: [number, number][] = [[Math.min(nx - 1, top % W), Math.min(nz - 1, Math.floor(top / W))]];
    while (todo.length) {
      const [ix, iz] = todo.pop()!;
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz || one[iz * nx + ix] || !shows(ix, iz)) continue;
      one[iz * nx + ix] = 1;
      todo.push([ix + 1, iz], [ix - 1, iz], [ix, iz + 1], [ix, iz - 1]);
    }
    // (a heap whose very top the hill covers: all of it that shows, as before)
    if (!one.some((v) => v)) for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) one[iz * nx + ix] = shows(ix, iz) ? 1 : 0;
    // (and what is left out is nothing to stand on either: it is put under the hill)
    const part = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < nx && iz < nz && one[iz * nx + ix] === 1;
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      if (part(ix, iz) || part(ix - 1, iz) || part(ix, iz - 1) || part(ix - 1, iz - 1) || H[iz * W + ix] < -20) continue;
      const g = ground(m.x0 + ix * m.cell, m.z0 + iz * m.cell);
      if (H[iz * W + ix] > g - 0.6) H[iz * W + ix] = g - 0.6;
    }
  }
  for (let iz = 0; iz + step <= nz; iz += step) {
    for (let ix = 0; ix + step <= nx; ix += step) {
      const q: [number, number][] = [[ix, iz], [ix + step, iz], [ix, iz + step], [ix + step, iz + step]], c = q.map(([i, j]) => P(i, j));
      // (nothing of it is drawn where the hill has it covered, or where it is said to be under a floor: see `moundTop`)
      if (Math.max(...c.map((p) => p[1] - ground(p[0], p[2]))) < -0.4 || Math.max(...c.map((p) => p[1])) < -20) continue;
      let joined = false;
      for (let jz = iz; jz < iz + step && !joined; jz++) for (let jx = ix; jx < ix + step; jx++) if (one[jz * nx + jx]) { joined = true; break; }
      if (!joined) continue;
      // (cut the way the ground itself is cut, corner to corner: what is stood on is what is seen)
      for (const [a, b, e] of [[0, 2, 1], [1, 2, 3]]) {
        const g = cross(sub(c[b], c[a]), sub(c[e], c[a]));
        // (the picture is laid on from whichever side sees the face most squarely: it does not run down a cliff in streaks)
        const flat = Math.abs(g[1]) > 0.72 * len(g), east = Math.abs(g[0]) > Math.abs(g[2]);
        const uv = (p: V3): UV => (flat ? [p[0], p[2]] : east ? [p[2], p[1]] : [p[0], p[1]]);
        // (round, where it is round: at a crest or the lip of a drop a corner faces the way its own face does)
        const face = unit(g[1] < 0 ? mul(g, -1) : g), smooth = [q[a], q[b], q[e]].map((k) => N(...k)).map((n) => (dot(n, face) < 0.5 ? face : n));
        o.tri([c[a], c[b], c[e]], [uv(c[a]), uv(c[b]), uv(c[e])], UP, [tone(c[a]), tone(c[b]), tone(c[e])], smooth);
      }
    }
  }
  put({ t: 'field', x0: m.x0, z0: m.z0, nx, nz, cell: m.cell, heights: H, surface: 'rock', name: m.name ?? 'mound' });
}

/**
 * The ground's own earth, laid over ground that has been cut away for something under it: in squares of two
 * metres, each corner at the height the ground has there (the ground as it was: see `castleCuts`), wherever a
 * square's middle is within reach of one of the pieces that were cut; none of it under the fort itself, which
 * hides what is cut there, and none over the hole that is left open. What stops a body is a thin shape under each square.
 */
export function apronPart(p: Apron, o: Out, put: Put, ground: (x: number, z: number) => number) {
  const CELL = 2, C = CASTLE, fx = C.hx + C.parapet.thick / 2 + 0.9, fz = C.hz + C.parapet.thick / 2 + 0.9, all = p.wells.flat();
  const lo = (k: number) => Math.floor((Math.min(...all.map((q) => q[k])) - p.reach) / CELL) * CELL, hi = (k: number) => Math.ceil((Math.max(...all.map((q) => q[k])) + p.reach) / CELL) * CELL;
  const hole = cutPoly(p.hole, -1e3, 1e3);
  /** how far a spot is from a piece of the plan (0: in it) */
  const off = (poly: [number, number][], x: number, z: number) => {
    let inside = true, best = Infinity, sign = 0;
    for (let k = 0; k < poly.length; k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length], ex = bx - ax, ez = bz - az, turn = ex * (z - az) - ez * (x - ax);
      if (sign === 0) sign = Math.sign(turn);
      else if (turn * sign < 0) inside = false;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
      best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
    return inside ? 0 : best;
  };
  for (let x = lo(0); x < hi(0); x += CELL) for (let z = lo(1); z < hi(1); z += CELL) {
    if (Math.max(Math.abs(x), Math.abs(x + CELL)) < fx && Math.max(Math.abs(z), Math.abs(z + CELL)) < fz) continue;
    if (!p.wells.some((w) => off(w, x + CELL / 2, z + CELL / 2) < p.reach)) continue;
    for (const piece of clipOut([[x, 0, z], [x + CELL, 0, z], [x + CELL, 0, z + CELL], [x, 0, z + CELL]], hole)) {
      const pts = piece.map((v): V3 => [v[0], ground(v[0], v[2]) + 0.03, v[2]]);
      put({ t: 'hull', pts: [...pts, ...pts.map((v): V3 => [v[0], v[1] - 0.5, v[2]])].flat(), feet: false, surface: 'rock', name: p.name ?? 'apron' });
    }
    // WHAT IS SEEN OF IT IS THE GROUND AS IT WOULD HAVE BEEN, square for square: the ground is squares of two metres,
    // each cut corner to corner into two triangles, and every corner faces by the heights of the four corners next
    // to it (the ground's own paint asks each corner how steep it is, for where snow lies and where rock shows). So
    // the lid is the same squares, cut along whichever of the two ways the ground between the corners lies on, and
    // each of its corners faces by the same sum over the ground as it was. Where the fort stands square on the
    // ground's own grid it is then the ground itself, and there is nothing to see. (Why it must be: a corner beside
    // one that was lowered faces the hole, and is painted as a cliff: green and brown facets two squares out from
    // everything that was cut, which the lid covers.)
    const lean = (qx: number, qz: number): V3 => unit([ground(qx - CELL, qz) - ground(qx + CELL, qz), 2 * CELL, ground(qx, qz - CELL) - ground(qx, qz + CELL)]);
    const c: V3[] = [[x, 0, z], [x + CELL, 0, z], [x + CELL, 0, z + CELL], [x, 0, z + CELL]].map((v): V3 => [v[0], ground(v[0], v[2]), v[2]]), mid = ground(x + CELL / 2, z + CELL / 2);
    const across = Math.abs((c[0][1] + c[2][1]) / 2 - mid) <= Math.abs((c[1][1] + c[3][1]) / 2 - mid) ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
    for (const tri of across) for (const piece of clipOut(tri.map((k): V3 => [c[k][0], 0, c[k][2]]), hole)) {
      const pts = piece.map((v): V3 => [v[0], ground(v[0], v[2]) + 0.03, v[2]]), faces = pts.map((v) => lean(v[0], v[2]));
      for (let k = 1; k + 1 < pts.length; k++) o.tri([pts[0], pts[k], pts[k + 1]], [pts[0], pts[k], pts[k + 1]].map((v): UV => [v[0], v[2]]), UP, p.tone ?? 1, [faces[0], faces[k], faces[k + 1]]);
    }
  }
}

/**
 * The squares of a world's own net that the fort's cuts left to it (`FortLid` in the fort's own file), in the
 * fort's own measure: how long a square's side is, which way the net's two ways run ([x, z], each a metre long),
 * and each square by its lowest corner, with how far under the terrace the lowest of its corners was let down to.
 */
export interface LidNet { cell: number; ex: [number, number]; ez: [number, number]; squares: { x: number; z: number; open: boolean; low: number }[] }

/**
 * THE SAME where a world has stood the fort, whose ground draws itself over what was cut (`seenGround`, in the
 * world's generator): nothing is laid over the ground at all. Under each half of each square the fort was told of,
 * cut corner to corner as the ground is, earth stops a body: its top is the ground as it is drawn there, to the
 * hair, and it is the ground to whoever treads on it or shoots at it. It is solid down past the cut: nothing is
 * left hollow under the ground but the stairwell (open to the sky: no earth over it at all) and the passage, over
 * each length of which the earth comes down to the top of its roof. And only in the squares a stairwell opens in,
 * which the ground does not draw, the square is drawn here round the well: on the ground's own corners, in the
 * ground's own two triangles, each corner facing as the ground's corner does (by the heights of the four next to
 * it), so that it is the ground's own square with a hole in it.
 */
export function lidPart(p: Apron, o: Out, put: Put, ground: (x: number, z: number) => number, net: LidNet) {
  const S = net.cell, [ux, uz] = net.ex, [vx, vz] = net.ez;
  /** what is hollow under the ground: the well first (`top` unsaid: open to the sky), then each length of the passage */
  const hollow = [{ plan: p.hole, cut: cutPoly(p.hole, -1e3, 1e3), top: undefined as number | undefined }, ...(p.ways ?? []).map((w) => ({ plan: w.well, cut: cutPoly(w.well, -1e3, 1e3), top: w.top as number | undefined }))];
  // (a corner of the net: where it is, and after that how much of each corner of its triangle a spot is, which is carried along as the triangle is cut)
  const at = (x: number, z: number, k: number): number[] => [x, ground(x, z), z, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
  const faces = (x: number, z: number): V3 => {
    const a = ground(x - ux * S, z - uz * S) - ground(x + ux * S, z + uz * S), b = ground(x - vx * S, z - vz * S) - ground(x + vx * S, z + vz * S);
    return unit([a * ux + b * vx, 2 * S, a * uz + b * vz]);
  };
  /** whether a triangle and a piece of the plan have anything in common (two shapes with no dent are apart only if some side of one has all of the other beyond it) */
  const meets = (tri: number[][], plan: [number, number][]) => {
    const a = tri.map((v): [number, number] => [v[0], v[2]]);
    for (const [m, n] of [[a, plan], [plan, a]]) for (let k = 0; k < m.length; k++) {
      const [px, pz] = m[k], [qx, qz] = m[(k + 1) % m.length], nx = qz - pz, nz = px - qx;
      const side = (pts: [number, number][]) => pts.map(([x, z]) => (x - px) * nx + (z - pz) * nz), own = side(m), other = side(n);
      if (Math.max(...own) <= 1e-9 ? Math.min(...other) > 1e-9 : Math.max(...other) < -1e-9) return false;
    }
    return true;
  };
  /** what of a flat piece is in a cut (`clipOut` gives what is out of it) */
  const within = (poly: number[][], planes: [number, number, number, number][]) => {
    let rest = poly;
    for (const [nx, ny, nz, d] of planes) {
      const side = rest.map((v) => nx * v[0] + ny * v[1] + nz * v[2] - d), into: number[][] = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i], b = rest[(i + 1) % rest.length], sa = side[i], sb = side[(i + 1) % rest.length];
        if (sa <= 0) into.push(a);
        if (sa > 0 !== sb > 0) into.push(a.map((v, k) => v + ((b[k] - v) * sa) / (sa - sb)));
      }
      rest = into;
      if (rest.length < 3) return [];
    }
    return rest;
  };
  /** earth under a piece of the ground, from the ground down to `to` (never thinner than a hand) */
  const earth = (piece: number[][], to: number) => {
    // (a sliver no wider than a finger is nothing to stand on, and no shape to draw tight round)
    let twice = 0;
    for (let k = 1; k + 1 < piece.length; k++) twice += Math.abs((piece[k][0] - piece[0][0]) * (piece[k + 1][2] - piece[0][2]) - (piece[k + 1][0] - piece[0][0]) * (piece[k][2] - piece[0][2]));
    if (twice < 2e-3) return;
    const foot = Math.min(to, Math.min(...piece.map((v) => v[1])) - 0.1);
    put({ t: 'hull', pts: [...piece.map((v) => [v[0], v[1], v[2]]), ...piece.map((v) => [v[0], foot, v[2]])].flat(), feet: false, surface: 'grass', name: p.name ?? 'apron' });
  };
  for (const s of net.squares) {
    const xz = [[s.x, s.z], [s.x + ux * S, s.z + uz * S], [s.x + vx * S, s.z + vz * S], [s.x + (ux + vx) * S, s.z + (uz + vz) * S]];
    for (const tri of [[0, 2, 1], [1, 2, 3]]) {
      const t = tri.map((c, k) => at(xz[c][0], xz[c][1], k));
      // ---- what stops a body: solid, but over what is hollow
      let solid: number[][][] = [t];
      for (const h of hollow) {
        if (!meets(t, h.plan)) continue;
        const next: number[][][] = [];
        for (const piece of solid) {
          next.push(...clipOut(piece, h.cut));
          if (h.top !== undefined) earth(within(piece, h.cut.planes), h.top);
        }
        solid = next;
      }
      for (const piece of solid) earth(piece, s.low - 0.3);
      // ---- what is seen: only where the ground does not draw itself, and all of the square but the well
      if (!s.open) continue;
      const face = t.map((v) => faces(v[0], v[2]));
      for (const piece of meets(t, p.hole) ? clipOut(t, hollow[0].cut) : [t]) {
        const pts = piece.map((v): V3 => [v[0], v[1], v[2]]), n = piece.map((v) => unit(add(add(mul(face[0], v[3]), mul(face[1], v[4])), mul(face[2], v[5]))));
        for (let k = 1; k + 1 < pts.length; k++) o.tri([pts[0], pts[k], pts[k + 1]], [pts[0], pts[k], pts[k + 1]].map((v): UV => [v[0], v[2]]), UP, p.tone ?? 1, [n[0], n[k], n[k + 1]]);
      }
    }
  }
}

export function lumpPart(l: Lump, o: Out, put: Put, lod: number) {
  const tone = l.tone ?? 1, yaw = hash(l.seed, 1, 77) * Math.PI, cy = Math.cos(yaw), sy = Math.sin(yaw), ax: V3[] = [[cy, 0, -sy], UP, [sy, 0, cy]];
  // (a block of a heap: each stands a little taller than it was said, by its own amount, on the foot it was given. Said
  // at one height, the blocks of a heap that lie into one another had their tops in one plane.)
  const more = l.blocky ? l.ry * 0.34 * hash(l.seed, 5, 77) : 0;
  if (l.blocky || lod) block(o, [l.x, l.y + more, l.z], ax, [l.rx, l.ry + more, l.rz], tone * (0.9 + 0.2 * hash(l.seed, 2, 77)));
  else {
    // a rock: a ball of a few flat faces, each corner pushed in or out by its own amount
    const A = 7, B = 4, pt = (i: number, j: number): V3 => {
      const lat = -Math.PI / 2 + (Math.PI * j) / B, lon = (2 * Math.PI * (i % A)) / A, k = j === 0 || j === B ? 0.8 : 0.62 + 0.62 * hash(i % A, j, l.seed);
      return [l.x + Math.cos(lat) * Math.cos(lon) * l.rx * k, l.y + Math.sin(lat) * l.ry * (j === B ? 0.75 + 0.4 * hash(9, 9, l.seed) : 1), l.z + Math.cos(lat) * Math.sin(lon) * l.rz * k];
    };
    for (let j = 0; j < B; j++) for (let i = 0; i < A; i++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        const p = [q[a], q[b], q[c]], g = cross(sub(p[1], p[0]), sub(p[2], p[0])), away = sub(mul(add(add(p[0], p[1]), p[2]), 1 / 3), [l.x, l.y, l.z]);
        const flat = Math.abs(g[1]) > 0.72 * len(g), east = Math.abs(g[0]) > Math.abs(g[2]);
        o.tri(p, p.map((v): UV => (flat ? [v[0], v[2]] : east ? [v[2], v[1]] : [v[0], v[1]])), away, tone * (0.82 + 0.3 * hash(i, j, l.seed + 5)));
      }
    }
  }
  // WHAT STOPS A BODY IS THE ROCK THAT IS DRAWN. (2026-10-14, played: "rocks outside the building dont clip right
  // with collision". A rock stopped a body with one block, 0.78 by 0.9 of its radii and square to the fort, whatever
  // its drawn corners: each corner of it stands at its own distance, from 0.62 to 1.24 of the radius, so a body went
  // a forearm into the stone on one side and was stopped by air on another, and stood on air over its low shoulder.)
  // A block stops a body as the block it is drawn as, with the height that was added to it. A rock is given as it is
  // made: every face of it with the rock's own middle is a piece of what stops a body (it is round about its middle,
  // so those pieces are the whole of it and nothing more).
  if (l.blocky) return put(boxSolid([l.x, l.y + more, l.z], ax, [l.rx, l.ry + more, l.rz], false, 'rock', l.name ?? 'rock'));
  const A = 7, B = 4, at = (i: number, j: number): V3 => {
    const lat = -Math.PI / 2 + (Math.PI * j) / B, lon = (2 * Math.PI * (i % A)) / A, k = j === 0 || j === B ? 0.8 : 0.62 + 0.62 * hash(i % A, j, l.seed);
    return [l.x + Math.cos(lat) * Math.cos(lon) * l.rx * k, l.y + Math.sin(lat) * l.ry * (j === B ? 0.75 + 0.4 * hash(9, 9, l.seed) : 1), l.z + Math.cos(lat) * Math.sin(lon) * l.rz * k];
  };
  // (its foot, which is in the ground it stands in, is one piece: its lowest point, its middle, and the ring of corners over the foot)
  put({ t: 'hull', pts: [l.x, l.y, l.z, ...at(0, 0), ...Array.from({ length: A }, (_, i) => at(i, 1)).flat()], feet: false, surface: 'rock', name: l.name ?? 'rock' });
  for (let j = 1; j < B; j++) for (let i = 0; i < A; i++) {
    // (a face of four corners is drawn as two of three, which do not lie flat: over its middle each of the two is a
    // piece, and under it, where it goes into the ground, the four are one. At its top the corners of a face fall together.)
    const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    for (const face of j === 1 ? [q] : j === B - 1 ? [[q[0], q[1], q[2]]] : [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) put({ t: 'hull', pts: [l.x, l.y, l.z, ...face.flat()], feet: false, surface: 'rock', name: l.name ?? 'rock' });
  }
}

/**
 * The underside of a vault: half a round, in eight flat lengths from one wall to the other, cut along its length a
 * pace and a half at a time; left out where it has fallen. Seen from under it, and it stops nothing.
 */
export function vaultPart(v: Vault, o: Out) {
  const [ax, az] = v.a, L = Math.hypot(v.b[0] - ax, v.b[1] - az), d: V3 = [(v.b[0] - ax) / L, 0, (v.b[1] - az) / L], side: V3 = [d[2], 0, -d[0]], half = v.wide / 2, rise = v.crown - v.spring, N = 8, tone = v.tone ?? 1;
  const at = (u: number, t: number): V3 => [ax + d[0] * u - side[0] * half * Math.cos(t), v.spring + rise * Math.sin(t) + ((v.lift ?? 0) * u) / L, az + d[2] * u - side[2] * half * Math.cos(t)];
  // (the way it faces at a place round it: in, and down)
  const face = (t: number): V3 => unit([(side[0] * Math.cos(t)) / half, -Math.sin(t) / rise, (side[2] * Math.cos(t)) / half]);
  const cuts = sorted([0, L, ...Array.from({ length: Math.ceil(L / 1.6) }, (_, k) => (L * k) / Math.ceil(L / 1.6)), ...(v.gone ?? []).flat()].filter((u) => u >= 0 && u <= L), 0.02);
  // (how far round it a place is, for the picture: the same stone as the walls, its courses running along the vault)
  const round: number[] = [0];
  for (let k = 1; k <= N; k++) round.push(round[k - 1] + len(sub(at(0, (Math.PI * k) / N), at(0, (Math.PI * (k - 1)) / N))));
  for (let i = 0; i + 1 < cuts.length; i++) {
    const u0 = cuts[i], u1 = cuts[i + 1], um = (u0 + u1) / 2;
    if ((v.gone ?? []).some(([g0, g1]) => um > g0 && um < g1)) continue;
    for (let k = 0; k < N; k++) {
      const t0 = (Math.PI * k) / N, t1 = (Math.PI * (k + 1)) / N;
      o.quad([at(u0, t0), at(u1, t0), at(u1, t1), at(u0, t1)], [[u0, round[k]], [u1, round[k]], [u1, round[k + 1]], [u0, round[k + 1]]], face((t0 + t1) / 2), tone, [face(t0), face(t0), face(t1), face(t1)]);
    }
  }
}
