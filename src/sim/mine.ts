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
  /** the portal at the foot of the west face, and the height of the ground there: the incline climbs from it to the drift */
  west: { x: -2388.2, y: 0.35 },
  /** the portal in the east face, level with the drift */
  east: { x: -2105.6 },
  /** the galleries off the drift: where each leaves it, which way (+z or -z), how far it goes and how wide */
  galleries: [{ x: -2296, side: 1, long: 20, half: 1.6 }, { x: -2204, side: -1, long: 17, half: 1.6 }, { x: -2184, side: 1, long: 12, half: 1.6 }],
  /** where the roof came down, its middle and half its length, and how much of the drift's height is left */
  fall: { x: -2270, half: 2.4, tall: 1.25 },
};

/** the floor of the way through at a place along it */
export function mineFloor(x: number) {
  const M = MINE;
  if (x >= M.x0) return M.y;
  return M.west.y + (M.y - M.west.y) * Math.max(0, (x - M.west.x) / (M.x0 - M.west.x));
}

/** is a point in the mine? */
export function inMine(x: number, y: number, z: number) {
  const M = MINE;
  if (x < M.west.x - 0.6 || x > M.east.x + 0.6 || Math.abs(z - M.z) > 24) return false;
  const low = mineFloor(x);
  return y > low - 2 && y < low + M.tall + 3;
}

/** what stands in it, each with where it is seen from */
export function mineProps(): { kind: string; x: number; y: number; z: number; rot: number }[] {
  const M = MINE, out: { kind: string; x: number; y: number; z: number; rot: number }[] = [];
  const inHall = (x: number) => Math.abs(x - M.hall.x) < M.hall.hx + 1, inFall = (x: number) => Math.abs(x - M.fall.x) < M.fall.half + 1.2;
  // (a set's posts stand across the way: the model is thin along its x, and is walked through that way)
  for (let x = M.west.x + 4; x < M.east.x - 2; x += M.sets) if (!inHall(x) && !inFall(x)) out.push({ kind: 'mine_timber', x, y: mineFloor(x), z: M.z, rot: 0 });
  for (const g of M.galleries) for (let d = 3; d < g.long - 1; d += M.sets) out.push({ kind: 'mine_timber', x: g.x, y: M.y, z: M.z + g.side * (M.half + d), rot: Math.PI / 2 });
  // (the rail lies along the level, down the middle: the model's length is its x)
  for (let x = M.x0 + 3; x < M.east.x - 3; x += 6) out.push({ kind: 'mine_rail', x, y: M.y, z: M.z, rot: 0 });
  // (the cart's length is its x too: it stands on the rail; and the rest of what was left)
  out.push({ kind: 'ore_cart', x: M.hall.x - 4, y: M.y + 0.12, z: M.z, rot: 0 }, { kind: 'ore_cart', x: M.x0 + 34, y: M.y + 0.12, z: M.z, rot: 0 }, { kind: 'ore_cart', x: M.hall.x - 6, y: M.y, z: M.z + 5, rot: 1.1 });
  const H = M.hall;
  out.push({ kind: 'portable_generator', x: H.x + 7, y: M.y, z: M.z - 5.6, rot: 0.4 }, { kind: 'Barrel_01', x: H.x + 8.6, y: M.y, z: M.z - 5, rot: 0 }, { kind: 'barrel_03', x: H.x + 8, y: M.y, z: M.z - 6, rot: 1 }, { kind: 'wooden_military_crate', x: H.x - 8, y: M.y, z: M.z - 5.6, rot: 0.2 }, { kind: 'wooden_crate_01', x: H.x - 7.8, y: M.y + 0.46, z: M.z - 5.5, rot: 0.6 }, { kind: 'scrap_pile', x: H.x + 3, y: M.y, z: M.z + 5.4, rot: 0 });
  // (what came down: heaped against the fall's two faces, either side of the way under it)
  const F = M.fall;
  for (const [dx, dz, k, rot] of [[-3, -1.3, 'namaqualand_boulder_04', 0.4], [3, 1.3, 'namaqualand_boulder_04', 2.1], [-3.1, 1.4, 'namaqualand_boulder_02', 1.2], [3.2, -1.4, 'namaqualand_boulder_02', 0.2], [-4, 0.9, 'boulder_01', 0.8]] as [number, number, string, number][]) out.push({ kind: k, x: F.x + dx, y: M.y, z: M.z + dz, rot });
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

/** where each portal opens the ground, as the terrain's wells take such things */
export const MINE_MOUTHS = [
  { cave: -1, x: MINE.west.x + 2.2, z: MINE.z, rot: 0, hx: 3, hz: 2.5, floor: 0 },
  { cave: -1, x: MINE.east.x - 2.2, z: MINE.z, rot: 0, hx: 3, hz: 2.5, floor: 0 },
];
