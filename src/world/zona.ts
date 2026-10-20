// The Zona: everything east of a line across the map, where tags are earned (the owner, 2026-10-19: "i think we should
// make it so people cannot earn tags west of the wall. we should add the zona back so dogtags are void along the coast
// ... the whole map to the east of the ruins can be hotzone", and of where: "x -2000 i think makes the most sense, enough
// room on the east side of the canyon to take the road out south without being camped. but we keep pokrov in the zone").
// The line is at x -1950: Pokrov's furthest place for a thing lies at -1920, and the monastery is inside. West of it,
// the coast, the desert, Kalat, Zavod, Blokpost, Zastava and Mokroye, nobody has a tag, and one carried there is void
// (ZONA_VOID in src/sim/items.ts); and nothing of the fourth step or above is found there (src/sim/economy.ts).
// (It was the rounds the owner drew on 2026-10-18 round the valley and each town, and before that PLAY_AREAS.)
//
// Sums only: nothing of the page or of the renderer is known here.

/** the Zona's west line: everything east of it is inside */
export const ZONA_WEST = -1950;

/** how far inside the Zona a place is, metres (less than none: how far outside it) */
export function zonaDepth(x: number, _z: number): number {
  return x - ZONA_WEST;
}

/** is this place inside the Zona, by `margin` metres at least (less than none: or within that much outside it) */
export function inZona(x: number, z: number, margin = 0): boolean {
  return zonaDepth(x, z) > margin;
}

/**
 * The line round the Zona, for the maps: one closed line round each piece of it (there is one) and round any hole,
 * walked off a grid of `step` metres over the whole world (the squares that the edge crosses, its place in each by how
 * deep the corners are), each line ending on the point it began at.
 */
export function zonaRings(x0 = -3840, x1 = 768, z0 = -768, z1 = 768, step = 8): { x: number; z: number }[][] {
  const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
  const v = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = zonaDepth(x0 + i * step, z0 + j * step);
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : v[j * nx + i]);
  // (the edge's pieces, square by square: each joins two of a square's sides where the depth changes sign along them)
  const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;
  const cross = (ia: number, ja: number, ib: number, jb: number) => {
    const a = at(ia, ja), b = at(ib, jb), t = a / (a - b);
    return { x: x0 + (ia + (ib - ia) * t) * step, z: z0 + (ja + (jb - ja) * t) * step };
  };
  const links = new Map<string, { x: number; z: number }[]>();
  const link = (p: { x: number; z: number }, q: { x: number; z: number }) => {
    for (const [a, b] of [[p, q], [q, p]]) {
      const k = key(a.x, a.z), l = links.get(k) ?? [];
      l.push(b);
      links.set(k, l);
    }
  };
  for (let j = -1; j < nz; j++) {
    for (let i = -1; i < nx; i++) {
      const c = [at(i, j) > 0, at(i + 1, j) > 0, at(i + 1, j + 1) > 0, at(i, j + 1) > 0];
      const sides: { x: number; z: number }[] = [];
      if (c[0] !== c[1]) sides.push(cross(i, j, i + 1, j));
      if (c[1] !== c[2]) sides.push(cross(i + 1, j, i + 1, j + 1));
      if (c[2] !== c[3]) sides.push(cross(i + 1, j + 1, i, j + 1));
      if (c[3] !== c[0]) sides.push(cross(i, j + 1, i, j));
      if (sides.length === 2) link(sides[0], sides[1]);
      else if (sides.length === 4) {
        link(sides[0], sides[1]);
        link(sides[2], sides[3]);
      }
    }
  }
  // (the pieces walked end to end into closed lines)
  const used = new Set<string>(), rings: { x: number; z: number }[][] = [];
  for (const [k0, next0] of links) {
    if (used.has(k0)) continue;
    const [sx, sz] = k0.split(',').map(Number), ring = [{ x: sx, z: sz }];
    used.add(k0);
    let prev = k0, cur = next0[0];
    for (let guard = 0; guard < 1e6; guard++) {
      const k = key(cur.x, cur.z);
      ring.push(cur);
      if (k === k0) break;
      used.add(k);
      const n = (links.get(k) ?? []).find((q) => key(q.x, q.z) !== prev && !used.has(key(q.x, q.z))) ?? (links.get(k) ?? []).find((q) => key(q.x, q.z) === k0);
      if (!n) break;
      prev = k;
      cur = n;
    }
    if (ring.length > 8) rings.push(ring);
  }
  return rings;
}
