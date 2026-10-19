// The Zona as the owner drew it (2026-10-18), on the big map, in red: "the areas inside the enclosed red spaces are the
// zona, where you can earn dog tags. leaving the zonas will start the dogtag void timer. we need to connect all the
// seperate circles i made as well so its all 1 connected zone". It was rounds laid over one another (PLAY_AREAS in the
// world's generator), and those are still what the world was made by; the rule of the tags, the line on the maps and
// where drops and wrecks come down now go by this.
//
// The shapes are traced off the owner's picture of the map: its points are pixels of that picture (1489 wide), its
// lettered squares a hundred metres, column A's west line at x -3868 and row 1's north line at z -768 (bigmap.ts). The
// Zona is every place inside any of them: the valley's great loop, round Lipki and out past the works to Kamenka and
// Orlinoye (out to the world's east edge, as the line was drawn along it); Bunker 17, Pokrov and the swamp at Mokroye, the Pass and
// Zastava, Zavod and Kalat; and the bands between them.
//
// Sums only: nothing of the page or of the renderer is known here.

/** a pixel of the owner's picture, in world metres */
const px = (x: number, y: number): [number, number] => [Math.round(-3718 + (100 * (x - 40)) / 32.42), Math.round(-618 + (100 * (y - 92)) / 32.8)];
const PX_M = 100 / 32.6;

type Shape = { poly: [number, number][] } | { at: [number, number]; r: number } | { a: [number, number]; b: [number, number]; r: number };

const SHAPES: Shape[] = [
  // the valley's great loop: along the top from Bunker 17 to Orlinoye, down the east by Kamenka, along the south road
  // back to the works, up past them, west above the woods to Lipki, round Lipki and up by Ozerki
  { poly: [
    [830, 195], [900, 191], [1000, 192], [1080, 180], [1120, 160], [1160, 126], [1250, 119], [1350, 119], [1440, 121], [1488, 140],
    [1496, 200], [1496, 300], [1496, 400], [1488, 462],
    [1450, 490], [1350, 493], [1250, 491], [1150, 486], [1090, 472], [1072, 440],
    [1064, 400], [1060, 340],
    [1040, 318], [980, 305], [930, 305], [905, 322],
    [900, 360], [898, 420], [890, 452],
    [865, 460], [840, 452], [824, 430],
    [819, 380], [817, 320], [811, 270], [795, 240],
  ].map(([x, y]) => px(x, y)) },
  // Bunker 17, Pokrov, Zavod and Kalat, each in its round
  { at: px(770, 195), r: 58 * PX_M },
  { at: px(633, 278), r: 52 * PX_M },
  { at: px(343, 165), r: 37 * PX_M },
  { at: px(197, 376), r: 46 * PX_M },
  // the Pass and Zastava, along the river
  { a: px(478, 149), b: px(628, 147), r: 48 * PX_M },
  // and the bands between: Zavod to the Pass, the Pass down to Pokrov, Pokrov over to Bunker 17
  { a: px(375, 160), b: px(445, 155), r: 22 * PX_M },
  { a: px(588, 192), b: px(610, 238), r: 20 * PX_M },
  { a: px(668, 256), b: px(736, 214), r: 24 * PX_M },
  // the swamp round Mokroye, and the way down to it from Pokrov (the owner, 2026-10-18: "i neglected to include the swamp
  // area with the zona area, expand and connect naturally")
  { poly: [
    [596, 432], [640, 424], [690, 428], [712, 448], [716, 490], [708, 528], [670, 538], [620, 536], [586, 522], [578, 480], [582, 446],
  ].map(([x, y]) => px(x, y)) },
  { poly: [[606, 318], [662, 318], [676, 360], [672, 432], [612, 434], [600, 380]].map(([x, y]) => px(x, y)) },
  // the desert between Kalat and the two in the north, Zavod and the Pass
  { poly: [
    [200, 332], [240, 272], [280, 216], [305, 180], [380, 170], [430, 168], [466, 174],
    [432, 230], [372, 290], [302, 360], [252, 410], [236, 382],
  ].map(([x, y]) => px(x, y)) },
];

/** how far a point is from a segment */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** how far inside a shape a point is, metres (less than none: how far outside it) */
function depthIn(s: Shape, x: number, z: number): number {
  if ('poly' in s) {
    const p = s.poly;
    let inside = false, d = Infinity;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i], [xj, zj] = p[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      d = Math.min(d, segDist(x, z, xi, zi, xj, zj));
    }
    return inside ? d : -d;
  }
  if ('at' in s) return s.r - Math.hypot(x - s.at[0], z - s.at[1]);
  return s.r - segDist(x, z, s.a[0], s.a[1], s.b[0], s.b[1]);
}

/** how far inside the Zona a place is, metres (less than none: how far outside it): the deepest it is in any of its shapes */
export function zonaDepth(x: number, z: number): number {
  let d = -Infinity;
  for (const s of SHAPES) d = Math.max(d, depthIn(s, x, z));
  return d;
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
