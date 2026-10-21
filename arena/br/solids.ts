// What stops a shot on a map, kept cheap for a server (2026-10-21; the owner, of the battle royale's server walls: "yes,
// and its the best thing for zona eventually as well"). Every building the game draws is made of thousands of triangles
// (its whole model is its collider in the game); a server needs only where a round is stopped. So each building becomes
// a few boxes: its triangles are laid into a grid of small cells in the building's own frame (turned with its walls), and
// the cells it fills are merged into the fewest boxes, with gaps where its doors and windows are. Rocks stay the simple
// hulls the game already has, and trunks its cylinders. Made by scripts/br-solids.ts from the game's own solids
// (tools/br/br-solids.js in the headless game) and read by arena/br/match.ts; ZONA's own server can read the same files
// for its sight and aim checks (docs/HANDOFF.md: server-side sight and aim checks).
//
// The file (arena/br/solids/<map>.bin.gz), as little-endian floats, gzipped:
//   [2 (its version), boxes, hulls, cylinders]
//   each box:      x y z (its middle), half its size along its own x y z, its turn (a quaternion: x y z w)
//   each hull:     how many points, then the points (x y z)
//   each cylinder: x y z (its middle), its turn (x y z w), half its height, its radius
// All in the world's metres.
import type RAPIER from '@dimforge/rapier3d-compat';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface Solids {
  /** ten floats a box */
  boxes: Float32Array;
  hulls: Float32Array[];
  /** nine floats a cylinder */
  cylinders: Float32Array;
}

export function writeSolids(s: Solids): Buffer {
  const n = 4 + s.boxes.length + s.hulls.reduce((a, h) => a + 1 + h.length, 0) + s.cylinders.length;
  const f = new Float32Array(n);
  f.set([2, s.boxes.length / 10, s.hulls.length, s.cylinders.length / 9]);
  let k = 4;
  f.set(s.boxes, k);
  k += s.boxes.length;
  for (const h of s.hulls) {
    f[k++] = h.length / 3;
    f.set(h, k);
    k += h.length;
  }
  f.set(s.cylinders, k);
  return gzipSync(Buffer.from(f.buffer), { level: 9 });
}

export function readSolids(file: Uint8Array): Solids {
  const b = gunzipSync(file), f = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (f[0] !== 2) throw new Error(`solids of version ${f[0]}, not 2`);
  const nb = f[1], nh = f[2], nc = f[3];
  let k = 4;
  const boxes = f.slice(k, (k += nb * 10));
  const hulls: Float32Array[] = [];
  for (let h = 0; h < nh; h++) {
    const n = f[k++];
    hulls.push(f.slice(k, (k += n * 3)));
  }
  return { boxes, hulls, cylinders: f.slice(k, k + nc * 9) };
}

/**
 * Laid into a physics world, those within `keep` (by their middle): the colliders made, to be taken out again when the
 * map is no longer played.
 */
export function addSolids(R: typeof RAPIER, w: RAPIER.World, s: Solids, keep: (x: number, z: number) => boolean = () => true): RAPIER.Collider[] {
  const made: RAPIER.Collider[] = [];
  const b = s.boxes, c = s.cylinders;
  for (let i = 0; i < b.length; i += 10) {
    if (!keep(b[i], b[i + 2])) continue;
    made.push(w.createCollider(R.ColliderDesc.cuboid(b[i + 3], b[i + 4], b[i + 5]).setTranslation(b[i], b[i + 1], b[i + 2]).setRotation({ x: b[i + 6], y: b[i + 7], z: b[i + 8], w: b[i + 9] })));
  }
  for (const h of s.hulls) {
    if (!keep(h[0], h[2])) continue;
    const d = R.ColliderDesc.convexHull(h);
    if (d) made.push(w.createCollider(d));
  }
  for (let i = 0; i < c.length; i += 9) {
    if (!keep(c[i], c[i + 2])) continue;
    made.push(w.createCollider(R.ColliderDesc.cylinder(c[i + 7], c[i + 8]).setTranslation(c[i], c[i + 1], c[i + 2]).setRotation({ x: c[i + 3], y: c[i + 4], z: c[i + 5], w: c[i + 6] })));
  }
  return made;
}

/**
 * One mesh (a building, a wall, a piece of rock) as boxes, ten floats each: its triangles laid into cells (40 cm for a
 * thing up to 40 m across, coarser for bigger things) in the frame its walls stand in, and the cells merged.
 */
export function boxify(v: ArrayLike<number>, t: ArrayLike<number>): number[] {
  // the way its walls run: the commonest bearing of its upright faces, weighed by their size, folded into a quarter turn
  const bins = new Float64Array(90), Q = Math.PI / 2;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || Math.abs(ny) / len > 0.3) continue;
    const ang = ((Math.atan2(nz, nx) % Q) + Q) % Q;
    bins[Math.min(89, Math.floor((ang / Q) * 90))] += len;
  }
  let best = 0;
  for (let i = 1; i < 90; i++) if (bins[i] > bins[best]) best = i;
  // (turned so that a face at that bearing lies square: its bearing undone)
  const yaw = -((best + 0.5) / 90) * Q, cos = Math.cos(yaw), sin = Math.sin(yaw);
  // into that frame (about the first corner), and its bounds there
  const ox = v[0], oz = v[2], n = v.length / 3, L = new Float64Array(v.length);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const wx = v[i * 3] - ox, wz = v[i * 3 + 2] - oz, lx = cos * wx - sin * wz, lz = sin * wx + cos * wz, ly = v[i * 3 + 1];
    L[i * 3] = lx;
    L[i * 3 + 1] = ly;
    L[i * 3 + 2] = lz;
    x0 = Math.min(x0, lx), x1 = Math.max(x1, lx), y0 = Math.min(y0, ly), y1 = Math.max(y1, ly), z0 = Math.min(z0, lz), z1 = Math.max(z1, lz);
  }
  const ext = Math.max(x1 - x0, y1 - y0, z1 - z0);
  let cell = ext <= 40 ? 0.4 : ext <= 150 ? 1 : 2.5;
  let NX = 0, NY = 0, NZ = 0;
  for (;;) {
    NX = Math.ceil((x1 - x0) / cell) + 1;
    NY = Math.ceil((y1 - y0) / cell) + 1;
    NZ = Math.ceil((z1 - z0) / cell) + 1;
    if (NX * NY * NZ <= 24e6) break;
    cell *= 1.5;
  }
  const occ = new Uint8Array(NX * NY * NZ), at = (x: number, y: number, z: number) => x + NX * (z + NZ * y);
  // every triangle sampled at half a cell, each sample filling its cell
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const e = Math.max(Math.hypot(L[b] - L[a], L[b + 1] - L[a + 1], L[b + 2] - L[a + 2]), Math.hypot(L[c] - L[a], L[c + 1] - L[a + 1], L[c + 2] - L[a + 2]), Math.hypot(L[c] - L[b], L[c + 1] - L[b + 1], L[c + 2] - L[b + 2]));
    const k = Math.max(1, Math.ceil(e / (cell * 0.5)));
    for (let p = 0; p <= k; p++) for (let q = 0; q <= k - p; q++) {
      const s = p / k, r = q / k;
      const x = L[a] + (L[b] - L[a]) * s + (L[c] - L[a]) * r, y = L[a + 1] + (L[b + 1] - L[a + 1]) * s + (L[c + 1] - L[a + 1]) * r, z = L[a + 2] + (L[b + 2] - L[a + 2]) * s + (L[c + 2] - L[a + 2]) * r;
      occ[at(Math.floor((x - x0) / cell), Math.floor((y - y0) / cell), Math.floor((z - z0) / cell))] = 1;
    }
  }
  // the filled cells merged into boxes: along x, then z, then up
  // (a box's own x lies along the world's (cos, -sin): a turn of `yaw` about up)
  const out: number[] = [], qy = Math.sin(yaw / 2), qw = Math.cos(yaw / 2);
  for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    if (occ[at(x, y, z)] !== 1) continue;
    let xe = x, ze = z, ye = y;
    while (xe + 1 < NX && occ[at(xe + 1, y, z)] === 1) xe++;
    const rowFull = (zz: number, yy: number) => {
      for (let xx = x; xx <= xe; xx++) if (occ[at(xx, yy, zz)] !== 1) return false;
      return true;
    };
    while (ze + 1 < NZ && rowFull(ze + 1, y)) ze++;
    const layerFull = (yy: number) => {
      for (let zz = z; zz <= ze; zz++) if (!rowFull(zz, yy)) return false;
      return true;
    };
    while (ye + 1 < NY && layerFull(ye + 1)) ye++;
    for (let yy = y; yy <= ye; yy++) for (let zz = z; zz <= ze; zz++) for (let xx = x; xx <= xe; xx++) occ[at(xx, yy, zz)] = 2;
    // its middle in the frame, back into the world
    const lx = x0 + ((x + xe + 1) / 2) * cell, ly = y0 + ((y + ye + 1) / 2) * cell, lz = z0 + ((z + ze + 1) / 2) * cell;
    out.push(ox + cos * lx + sin * lz, ly, oz - sin * lx + cos * lz, ((xe - x + 1) * cell) / 2, ((ye - y + 1) * cell) / 2, ((ze - z + 1) * cell) / 2, 0, qy, 0, qw);
  }
  return out;
}
