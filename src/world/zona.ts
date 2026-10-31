// The Zona, where tags are earned: a round about each town, site and settlement east of a line across the map, joined by
// corridors, the middle of the valley filled in whole; and everywhere else is wilderness, for bases and raiding (the
// owner, 2026-10-24: "rein in the zona zones ... to be around town (but connected) so that the wilderness is focused on
// bases and raiding while the interior of the map rewards pvp based earning ... otherwise people can earn tags while
// camping their base roof"; "only east of the line we have currently"; "even smaller on the east ... more wilderness
// around the edges of the map"; "leave zastava out its right at the mouth of the canyon"; "connect the cirlces in the
// east in the middle"). Drawn as marketing/plan-zona-smaller.html, from the world's places (progress/zona-plan).
// The line is at x -1950 (2026-10-19, "people cannot earn tags west of the wall"): west of it nobody has a tag, and
// one carried outside the Zona is void (ZONA_VOID in src/sim/items.ts). The loot still goes by the line alone
// (`eastOfLine`: nothing of the fourth step or above west of it, src/sim/economy.ts), so no loot changed.
//
// The corridors follow ground a body can walk, and the shapes run into one another with soft corners (the owner,
// 2026-10-31: "some of the zona connections ... runs across veryhard to traverse terrian", "border-radius needs softening",
// "so the player isnt forced to walk up and down insane cliffs"): straight lines between places until then.
//
// Sums only: nothing of the page or of the renderer is known here.

import { WAYS } from './zona-ways';

/** the Zona's west line: everything east of it is inside */
export const ZONA_WEST = -1950;
/**
 * And round Zastava, which it cut in half: west to x -2013 from z -520 to -380, eased back over 30 m each side, so the
 * whole town is in (its tower stands at -1999) and the paved road out of the canyon is not (it turns south down x -2027,
 * its near edge at -2021): the owner, 2026-10-19, "we need to include zatava in the zone but not the paved road that comes
 * out of the canyon just to the west of zatava, need to fine tune it to go around the town so it doesnt cut through half of it".
 */
const ZASTAVA = { x: -2013, z0: -520, z1: -380, ease: 30 };

/** where the line runs at this z */
export function westAt(z: number): number {
  const { x, z0, z1, ease } = ZASTAVA;
  const t = z < z0 ? (z - (z0 - ease)) / ease : z > z1 ? ((z1 + ease) - z) / ease : 1;
  return ZONA_WEST + (x - ZONA_WEST) * Math.max(0, Math.min(1, t));
}

/** how far east of the line a place is, metres (less than none: how far west of it), measured along x */
export function eastDepth(x: number, z: number): number {
  return x - westAt(z);
}

/** is this place east of the line, by `margin` metres at least: what the loot goes by */
export function eastOfLine(x: number, z: number, margin = 0): boolean {
  return eastDepth(x, z) > margin;
}

/** each place's round: where, and how far out (its own size and 35 to 45 m more; the fort and the bunker more) */
export const ROUNDS: [string, number, number, number][] = [
  ['Zelenaya Dolina', 30, 10, 150], ['Military Checkpoint', -175, 175, 80], ["Hunter's Cabin", 235, -195, 65],
  ["Forester's Lodge", 326, 98, 75], ['Kamenka Farm', 150, 290, 75], ['South Ranger Post', -77, 264, 75],
  ['Old Sawmill', -279, 144, 75], ["Trapper's Camp", -270, -130, 75], ['Berezovo Dacha', -106, -286, 75],
  ['North Ranger Post', 128, -268, 75], ['Lugovoe Farm', 326, -89, 75], ['Kolkhoz Yard', 68, 203, 75],
  ['Field Depot', -44, -155, 75], ['Quarry Dacha', 111, -159, 75], ['Sosnovka', -158, -169, 75],
  ['Motor Pool', 179, 174, 75], ['Trading Post', -1507, 8, 75], ['Army Camp', -240, 5, 75],
  ['Chemical Works', -368, 368, 119], ['Bunker 17', -1450, -320, 110], ['Kamenka', 625, 365, 135],
  ['Orlinoye', 537, -371, 130], ['Pokrov', -1850, -30, 202], ['Lipki', -1180, 350, 157],
  ['Ozerki', -1250, -120, 132], ['Mokroye', -1855, 585, 146], ["Mel'nitsa", -1760, -505, 79],
  ['Khutor', -1560, -575, 79], ['Kordon', -1300, -480, 72],
];
/** how far either side of its line a corridor reaches (the lines are src/world/zona-ways.ts, from scripts/zona-ways.ts) */
const BAND = 34;
/** how soft the corners are, metres: where two shapes meet, the width of ground over which the one eases into the other */
const SOFT = 70;
/** and where the Zona meets the west line */
const SOFT_LINE = 30;
/** each corridor's box, to leave out the ones nowhere near */
const BOXES = WAYS.map((w) => {
  const xs = w.map((p) => p[0]), zs = w.map((p) => p[1]), m = BAND + SOFT;
  return [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m];
});
/** and the middle of the valley, round the settlements about Zelenaya Dolina, filled in whole; out to the mountain road on the east, or the ways to the fort and Kamenka shut a pocket of wilderness in the Zona, where a tag carried across it would stop counting */
export const MIDDLE: [number, number][] = [[-106, -286], [128, -268], [235, -195], [326, -89], [440, -215], [560, -190], [575, 240], [440, 210], [326, 98], [150, 290], [-77, 264], [-175, 175], [-279, 144], [-240, 5], [-270, -130]];

/** how far a point is from a segment */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** how far inside the middle a point is (less than none: how far outside it) */
function middleDepth(x: number, z: number): number {
  let inside = false, d = Infinity;
  for (let i = 0, j = MIDDLE.length - 1; i < MIDDLE.length; j = i++) {
    const [xi, zi] = MIDDLE[i], [xj, zj] = MIDDLE[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    d = Math.min(d, segDist(x, z, xi, zi, xj, zj));
  }
  return inside ? d : -d;
}

/** the larger of two, eased over `k` where they are close: the join of two shapes, corner rounded, and never less than either */
function softMax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

/** how far inside the Zona a place is, metres (less than none: how far outside it): the deepest it is in any of its shapes, and never west of the line */
export function zonaDepth(x: number, z: number): number {
  let d = middleDepth(x, z);
  for (const [, cx, cz, r] of ROUNDS) d = softMax(d, r - Math.hypot(x - cx, z - cz), SOFT);
  for (let w = 0; w < WAYS.length; w++) {
    const way = WAYS[w], b = BOXES[w];
    if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
    let near = Infinity;
    for (let i = 1; i < way.length; i++) near = Math.min(near, segDist(x, z, way[i - 1][0], way[i - 1][1], way[i][0], way[i][1]));
    d = softMax(d, BAND - near, SOFT);
  }
  return -softMax(-d, -eastDepth(x, z), SOFT_LINE);
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
