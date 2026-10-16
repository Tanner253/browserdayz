// The sea's numbers, apart from how it is drawn (src/world/ocean.ts), so that they can be checked without a page:
// the picture its waves are drawn from, the tiles it is laid in, and how deep it is everywhere over them.
//
// The waves are made here, not downloaded: the sea's surface is a sum of a few dozen long-crested waves, as a real
// sea is (each with its own length, way and phase, the short ones less steep than the long, most of them running
// with the wind, some across it), worked out once into a picture of 256 points a side that repeats without a seam.
// Nothing to fetch, and no licence to ask about: three's own water picture is of a source nobody could name.

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** the same numbers every time from the same seed */
export function seeded(seed: number) {
  let s = seed | 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
}

/** One wave of the sum: whole cycles across the picture each way (so that it repeats), how steep it is, its phase. */
export interface Wave {
  i: number;
  j: number;
  steep: number;
  phase: number;
}

/**
 * The waves of the picture. Their lengths run from a half to a twenty-sixth of the picture; their ways lie mostly
 * along +x (the wind's way in the picture: the sea turns it to the world's), spread about it as a wind sea is, with
 * a few running across it. The short ones are less steep than the long. The steepness is given as a share of the
 * whole: the sea says how steep the whole is (OCEAN.slope).
 */
export function wavesOf(n: number, seed: number): Wave[] {
  const rnd = seeded(seed), out: Wave[] = [];
  const seen = new Set<string>();
  while (out.length < n) {
    const k = 2 + Math.pow(rnd(), 1.6) * 24;
    // (three in four within 40 degrees of the wind, the rest anywhere it does not blow against)
    const a = rnd() < 0.75 ? (rnd() - 0.5) * 1.4 : (rnd() - 0.5) * 3.0;
    const i = Math.round(Math.cos(a) * k), j = Math.round(Math.sin(a) * k);
    if (i === 0 && j === 0) continue;
    if (seen.has(`${i},${j}`)) continue;
    seen.add(`${i},${j}`);
    out.push({ i, j, steep: Math.pow(Math.hypot(i, j), -0.55), phase: rnd() * Math.PI * 2 });
  }
  return out;
}

/**
 * The picture the waves are drawn from, `res` points a side, repeating: in its first two places the surface's two
 * slopes (across x, across z) as 128 +- 127 of the steepest anywhere in it (`slope`, the slope that stands for), in
 * the third how high the surface is there (0 the lowest trough, 255 the highest crest: where caps break), in the
 * fourth the net of lines foam lies in (see foamNet).
 */
export function waveMap(res = 256, seed = 20261016, count = 40) {
  const waves = wavesOf(count, seed);
  const sx = new Float32Array(res * res), sz = new Float32Array(res * res), h = new Float32Array(res * res);
  const ca = new Float32Array(res), sa = new Float32Array(res), cb = new Float32Array(res), sb = new Float32Array(res);
  for (const w of waves) {
    // cos and sin of the phase, as a part along x and a part along z added (so each point is a few multiplies)
    for (let x = 0; x < res; x++) {
      const a = (2 * Math.PI * w.i * x) / res;
      ca[x] = Math.cos(a);
      sa[x] = Math.sin(a);
    }
    for (let z = 0; z < res; z++) {
      const b = (2 * Math.PI * w.j * z) / res + w.phase;
      cb[z] = Math.cos(b);
      sb[z] = Math.sin(b);
    }
    const k = Math.hypot(w.i, w.j), ux = w.i / k, uz = w.j / k, amp = w.steep / k;
    for (let z = 0; z < res; z++) {
      const o = z * res, c2 = cb[z], s2 = sb[z];
      for (let x = 0; x < res; x++) {
        const cos = ca[x] * c2 - sa[x] * s2, sin = sa[x] * c2 + ca[x] * s2;
        sx[o + x] -= w.steep * ux * sin;
        sz[o + x] -= w.steep * uz * sin;
        h[o + x] += amp * cos;
      }
    }
  }
  let most = 0, lo = Infinity, hi = -Infinity;
  for (let p = 0; p < res * res; p++) {
    most = Math.max(most, Math.abs(sx[p]), Math.abs(sz[p]));
    lo = Math.min(lo, h[p]);
    hi = Math.max(hi, h[p]);
  }
  const foam = foamNet(res, seed + 1);
  const data = new Uint8Array(res * res * 4);
  for (let p = 0; p < res * res; p++) {
    data[p * 4] = Math.round(128 + (127 * sx[p]) / most);
    data[p * 4 + 1] = Math.round(128 + (127 * sz[p]) / most);
    data[p * 4 + 2] = Math.round((255 * (h[p] - lo)) / (hi - lo));
    data[p * 4 + 3] = foam[p];
  }
  // (the whole's slope, as a share of the steepest point: what the picture's 127 is worth once the sea scales it)
  let sum = 0;
  for (let p = 0; p < res * res; p++) sum += sx[p] * sx[p] + sz[p] * sz[p];
  return { data, res, slope: most, rms: Math.sqrt(sum / (res * res)) };
}

/**
 * The net foam lies in on the sea: a sheet with round holes in it, as foam lies on the wash up a beach and in the lee
 * of a breaking wave (the holes the bubbles burst in), two sizes of hole laid over each other so that none is seen
 * to repeat. 0 to 255, repeating: where there is little foam, only what is highest in this is foam, and its holes
 * open wide into lace.
 */
export function foamNet(res = 256, seed = 7) {
  const out = new Uint8Array(res * res);
  const layer = (cells: number, weight: number, s: number) => {
    const rnd = seeded(s), px = new Float32Array(cells * cells), pz = new Float32Array(cells * cells);
    for (let c = 0; c < cells * cells; c++) {
      px[c] = rnd();
      pz[c] = rnd();
    }
    const at = new Float32Array(res * res);
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const u = (x / res) * cells, v = (z / res) * cells, ci = Math.floor(u), cj = Math.floor(v);
        // (how near the nearest cell's middle is, as its square until the end: this is most of the sea's making)
        let near = 9;
        for (let dj = -1; dj <= 1; dj++) {
          const j = cj + dj, e = j < 0 ? j + cells : j >= cells ? j - cells : j;
          for (let di = -1; di <= 1; di++) {
            const i = ci + di, c = e * cells + (i < 0 ? i + cells : i >= cells ? i - cells : i);
            const dx = i + px[c] - u, dz = j + pz[c] - v;
            near = Math.min(near, dx * dx + dz * dz);
          }
        }
        // (nothing at a cell's middle, rising to whole half a cell out from it: a sheet with round holes in it)
        const t = Math.min(1, Math.max(0, (Math.sqrt(near) - 0.08) / 0.5));
        at[z * res + x] = weight * t * t * (3 - 2 * t);
      }
    }
    return at;
  };
  const big = layer(9, 1, seed), small = layer(23, 1, seed + 11);
  for (let p = 0; p < res * res; p++) out[p] = Math.round(255 * (big[p] * 0.6 + small[p] * 0.4));
  return out;
}

/** The tiles a rectangle is laid in: whole tiles from its west and north edges, the last of each row and column cut to fit. */
export function oceanTiles(r: Rect, tile: number): Rect[] {
  const out: Rect[] = [];
  for (let z = r.z0; z < r.z1 - 1e-6; z += tile) {
    for (let x = r.x0; x < r.x1 - 1e-6; x += tile) out.push({ x0: x, x1: Math.min(x + tile, r.x1), z0: z, z1: Math.min(z + tile, r.z1) });
  }
  return out;
}

/** How deep the water is at every `cell` metres over a rectangle (at its corners too): what the sea is coloured by. */
export interface DepthGrid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  data: Float32Array;
}

/**
 * The depths over a rectangle, from the world's word on how deep the water is anywhere (`depthAt`: the sea level
 * less the ground's height; under nothing on land). No more than `most` points a side: a wider sea is sampled
 * more coarsely, which far out to sea nobody can tell.
 */
export function depthGrid(r: Rect, cell: number, depthAt: (x: number, z: number) => number, most = 2048): DepthGrid {
  const span = Math.max(r.x1 - r.x0, r.z1 - r.z0);
  if (span / cell + 1 > most) cell = span / (most - 1);
  const nx = Math.ceil((r.x1 - r.x0) / cell - 1e-6) + 1, nz = Math.ceil((r.z1 - r.z0) / cell - 1e-6) + 1;
  const data = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) data[j * nx + i] = depthAt(r.x0 + i * cell, r.z0 + j * cell);
  return { x0: r.x0, z0: r.z0, cell, nx, nz, data };
}

/** The depth anywhere over the grid, read between its points as the card reads it (and held at its edges). */
export function depthIn(g: DepthGrid, x: number, z: number): number {
  const u = Math.min(g.nx - 1, Math.max(0, (x - g.x0) / g.cell)), v = Math.min(g.nz - 1, Math.max(0, (z - g.z0) / g.cell));
  const i = Math.min(g.nx - 2, Math.floor(u)), j = Math.min(g.nz - 2, Math.floor(v)), fu = u - i, fv = v - j, o = j * g.nx + i;
  const a = g.data[o], b = g.data[o + 1], c = g.data[o + g.nx], d = g.data[o + g.nx + 1];
  return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
}

/** The shallowest the water is anywhere over a part of the grid (its points in it and one more all round). */
export function shallowestIn(g: DepthGrid, r: Rect): number {
  const i0 = Math.max(0, Math.floor((r.x0 - g.x0) / g.cell) - 1), i1 = Math.min(g.nx - 1, Math.ceil((r.x1 - g.x0) / g.cell) + 1);
  const j0 = Math.max(0, Math.floor((r.z0 - g.z0) / g.cell) - 1), j1 = Math.min(g.nz - 1, Math.ceil((r.z1 - g.z0) / g.cell) + 1);
  let least = Infinity;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) least = Math.min(least, g.data[j * g.nx + i]);
  return least;
}
