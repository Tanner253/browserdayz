// The Old Mine: the way through the canyon wall at z 540, the one crossing of it but for the Pass. Nothing carries you through it (the owner: "nothing teleports"): each gate swings on
// its hinges and you walk in, level out of the hill's side on the east, and on the west up a long incline from the foot of the face to the level of the workings. A long drift, a
// hoist room half way with what was left in it, galleries off it that were worked and left, and a stretch where the roof came down, that you go through bent double. Timber sets
// every few metres. What the game draws is src/world/mine.ts.

export const MINE = {
  /** the level's drift: its two ends along x, its line in z, its floor, half its width and its height */
  x0: -2330, x1: -2150, z: 540, y: 18.9, half: 1.9, tall: 3.2,
  /** the hoist room half way along it: its middle, and half its length and width */
  hall: { x: -2240, hx: 10, hz: 7 },
  /** the timber sets, metres apart */
  sets: 5,
  /** the portals, each square to its face, which runs aslant of the drift: where it stands, its floor, its turn. The west's climbs by an incline to the level, the east's is level with it */
  west: { x: -2389, z: 540, y: 0.35, rot: 2.53 },
  east: { x: -2104.5, z: 540, y: 18.9, rot: -0.478 },
  /** how far in from its portal each way runs square to the face, before it turns for the drift */
  adit: 7,
  /** the galleries off the drift: where each leaves it, which way (+z or -z), how far it goes and how wide */
  galleries: [{ x: -2296, side: 1, long: 20, half: 1.6 }, { x: -2204, side: -1, long: 17, half: 1.6 }, { x: -2184, side: 1, long: 12, half: 1.6 }],
  /** where the roof came down, its middle and half its length, and how much of the drift's height is left */
  fall: { x: -2270, half: 2.4, tall: 1.25 },
};

/** the way in from a portal to the drift's end, its three points [x, z, y]. @param side -1 the west, 1 the east */
export function mineWay(side: -1 | 1): [number, number, number][] {
  const M = MINE, p = side < 0 ? M.west : M.east, ix = -Math.cos(p.rot), iz = Math.sin(p.rot), ax = p.x + ix * M.adit, az = p.z + iz * M.adit, dx = side < 0 ? M.x0 : M.x1;
  const rest = Math.hypot(dx - ax, M.z - az);
  return [[p.x, p.z, p.y], [ax, az, p.y + ((M.y - p.y) * M.adit) / (M.adit + rest)], [dx, M.z, M.y]];
}
const WAYS = [mineWay(-1), mineWay(1)];

/** the floor of the way through at a place along it */
export function mineFloor(x: number) {
  const M = MINE, [a, b, c] = WAYS[0];
  if (x >= M.x0) return M.y;
  if (x <= a[0]) return a[2];
  return x < b[0] ? a[2] + ((b[2] - a[2]) * (x - a[0])) / (b[0] - a[0]) : b[2] + ((c[2] - b[2]) * (x - b[0])) / (c[0] - b[0]);
}

/** the timber sets of the way, each where it stands and turned across it */
export function mineSets(): { x: number; y: number; z: number; rot: number }[] {
  const M = MINE, out: { x: number; y: number; z: number; rot: number }[] = [];
  for (const w of WAYS) {
    for (const [a, b] of [[w[0], w[1]], [w[1], w[2]]]) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      for (let d = a === w[0] ? 2.4 : 2.5; d < L - 1; d += M.sets) out.push({ x: a[0] + ux * d, y: a[2] + ((b[2] - a[2]) * d) / L, z: a[1] + uz * d, rot: Math.atan2(-uz, ux) });
    }
  }
  for (let x = M.x0 + 3; x < M.x1 - 1; x += M.sets) if (Math.abs(x - M.hall.x) >= M.hall.hx + 1 && Math.abs(x - M.fall.x) >= M.fall.half + 1.2) out.push({ x, y: M.y, z: M.z, rot: 0 });
  return out;
}

/** is a point in the mine? */
export function inMine(x: number, y: number, z: number) {
  const M = MINE;
  if (x < M.west.x + 0.3 || x > M.east.x - 0.3 || Math.abs(z - M.z) > 24) return false;
  const low = mineFloor(x);
  return y > low - 2 && y < low + M.tall + 3;
}

/** what stands in it, each with where it is seen from */
export function mineProps(): { kind: string; x: number; y: number; z: number; rot: number }[] {
  const M = MINE, out: { kind: string; x: number; y: number; z: number; rot: number }[] = [];
  // (a set's posts stand across the way: the model is thin along its x, and is walked through that way)
  for (const s of mineSets()) out.push({ kind: 'mine_timber', ...s });
  for (const g of M.galleries) for (let d = 3; d < g.long - 1; d += M.sets) out.push({ kind: 'mine_timber', x: g.x, y: M.y, z: M.z + g.side * (M.half + d), rot: Math.PI / 2 });
  // (the rail lies along the level, down the middle: the model's length is its x)
  for (let x = M.x0 + 3; x < M.x1 - 2; x += 6) out.push({ kind: 'mine_rail', x, y: M.y, z: M.z, rot: 0 });
  // (the cart's length is its x too: it stands on the rail; and the rest of what was left)
  out.push({ kind: 'ore_cart', x: M.hall.x - 4, y: M.y + 0.12, z: M.z, rot: 0 }, { kind: 'ore_cart', x: M.x0 + 12, y: M.y + 0.12, z: M.z, rot: 0 }, { kind: 'ore_cart', x: M.hall.x - 6, y: M.y, z: M.z + 5, rot: 1.1 });
  const H = M.hall;
  out.push({ kind: 'portable_generator', x: H.x + 7, y: M.y, z: M.z - 5.6, rot: 0.4 }, { kind: 'Barrel_01', x: H.x + 8.6, y: M.y, z: M.z - 5, rot: 0 }, { kind: 'barrel_03', x: H.x + 8, y: M.y, z: M.z - 6, rot: 1 }, { kind: 'wooden_military_crate', x: H.x - 8, y: M.y, z: M.z - 5.6, rot: 0.2 }, { kind: 'wooden_crate_01', x: H.x - 7.8, y: M.y + 0.46, z: M.z - 5.5, rot: 0.6 }, { kind: 'scrap_pile', x: H.x + 3, y: M.y, z: M.z + 5.4, rot: 0 });
  // (what came down: heaped against the fall's two faces, either side of the way under it)
  const F = M.fall;
  for (const [dx, dz, k, rot] of [[-3.1, -1.3, 'boulder_01', 0.4], [3.1, 1.3, 'boulder_01', 2.1], [-3.4, 1.35, 'boulder_01', 1.2], [3.4, -1.35, 'boulder_01', 0.2]] as [number, number, string, number][]) out.push({ kind: k, x: F.x + dx, y: M.y, z: M.z + dz, rot });
  for (const g of M.galleries) out.push({ kind: g.side > 0 ? 'wooden_military_crate' : 'ore_cart', x: g.x + 0.6, y: M.y, z: M.z + g.side * (M.half + g.long - 1.2), rot: 0.3 });
  return out;
}

/** where things lie in it: the end of each gallery, the hoist room, and past the fall */
export function minePlaces(): { x: number; y: number; z: number }[] {
  const M = MINE, H = M.hall, out = M.galleries.flatMap((g) => [{ x: g.x - 0.6, y: M.y, z: M.z + g.side * (M.half + g.long - 2) }, { x: g.x + 0.4, y: M.y, z: M.z + g.side * (M.half + g.long - 5) }]);
  out.push({ x: H.x - 6.6, y: M.y, z: M.z - 5.4 }, { x: H.x + 5.6, y: M.y, z: M.z - 5.2 }, { x: H.x + 6.5, y: M.y, z: M.z + 5.4 }, { x: M.fall.x + 5, y: M.y, z: M.z + 1.2 });
  return out;
}

/** where the infected sleep in it */
export function mineSpots(): [number, number, number][] {
  const M = MINE, out: [number, number, number][] = [];
  for (let x = M.x0 + 18; x < M.x1 - 12; x += 22) if (Math.abs(x - M.fall.x) > 6) out.push([x, M.y, M.z + (out.length % 2 ? 1 : -1)]);
  for (const g of M.galleries) out.push([g.x, M.y, M.z + g.side * (M.half + g.long - 3)]);
  return out;
}

/** is a point on the line of a way in, from its portal on? There the ground's own surface is no floor or wall to a body: it lies over the rock, and a body is under it */
export function onMineLine(x: number, z: number) {
  for (const w of WAYS) {
    for (let k = 0; k < 2; k++) {
      const a = w[k], b = w[k + 1], ux = b[0] - a[0], uz = b[1] - a[1], L2 = ux * ux + uz * uz, t = ((x - a[0]) * ux + (z - a[1]) * uz) / L2;
      if (t >= 0 && t <= 1 && Math.hypot(x - a[0] - ux * t, z - a[1] - uz * t) < 3.4) return true;
    }
  }
  return false;
}

/** where each portal opens the ground, as the terrain's wells take such things */
// (only the slice of the face between the way's floor and the top of the portal, and laid along the face: it stands so steep that a metre of ground here is eight of cliff, and any more
// of it shows the sky over the lintel)
const mouth = (p: { x: number; z: number; rot: number }, at: number, hx: number, rot: number) => ({ cave: -1, x: p.x - Math.cos(p.rot) * at, z: p.z + Math.sin(p.rot) * at, rot, hx, hz: 2.1, floor: 0 });
export const MINE_MOUTHS = [mouth(MINE.west, 0.52, 0.4, 2.356), mouth(MINE.east, 2.35, 0.95, -0.785)];
