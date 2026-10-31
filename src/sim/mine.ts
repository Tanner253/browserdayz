// The Old Mine: the way through the canyon wall at z 540, the one crossing of it but for the Pass. Its galleries lie inside the rock of the
// plateau, a hundred metres of it overhead, and touch no ground: its gates at the foot of each face lead in (src/sim/sites.ts, RIDES).
// A long drift, a hoist room half way with what was left in it, and timber sets every few metres. What the game draws is src/world/mine.ts.

export const MINE = {
  /** the drift: its two ends along x, its line in z, its floor, half its width and its height */
  x0: -2330, x1: -2150, z: 540, y: 40, half: 1.9, tall: 3.2,
  /** the hoist room half way along it: its middle, and half its length and width */
  hall: { x: -2240, hx: 10, hz: 7 },
  /** the timber sets, metres apart */
  sets: 5,
};

/** is a point in the mine? */
export function inMine(x: number, y: number, z: number) {
  const M = MINE;
  return x > M.x0 - 2 && x < M.x1 + 2 && Math.abs(z - M.z) < M.hall.hz + 2 && y > M.y - 2 && y < M.y + M.tall + 2;
}

/** what stands in it, each with where it is seen from */
export function mineProps(): { kind: string; x: number; y: number; z: number; rot: number }[] {
  const M = MINE, out: { kind: string; x: number; y: number; z: number; rot: number }[] = [];
  const inHall = (x: number) => Math.abs(x - M.hall.x) < M.hall.hx + 1;
  // (a set's posts stand across the drift: the model is thin along its x, and is walked through that way)
  for (let x = M.x0 + 3; x < M.x1 - 1; x += M.sets) if (!inHall(x)) out.push({ kind: 'mine_timber', x, y: M.y, z: M.z, rot: 0 });
  // (the rail lies along the drift, down the middle: the model's length is its x)
  for (let x = M.x0 + 3; x < M.x1 - 2; x += 6) out.push({ kind: 'mine_rail', x, y: M.y, z: M.z, rot: 0 });
  // (the cart's length is its x too: it stands on the rail)
  out.push({ kind: 'ore_cart', x: M.hall.x - 4, y: M.y + 0.12, z: M.z, rot: 0 }, { kind: 'ore_cart', x: M.x0 + 34, y: M.y + 0.12, z: M.z, rot: 0 });
  // (and the gate from the inside at each end, its +x to the drift)
  out.push({ kind: 'mine_portal', x: M.x0 + 0.7, y: M.y, z: M.z, rot: 0 }, { kind: 'mine_portal', x: M.x1 - 0.7, y: M.y, z: M.z, rot: Math.PI });
  return out;
}

/** where the infected sleep in it */
export function mineSpots(): [number, number, number][] {
  const M = MINE, out: [number, number, number][] = [];
  for (let x = M.x0 + 18; x < M.x1 - 12; x += 22) out.push([x, M.y, M.z + (out.length % 2 ? 1 : -1)]);
  return out;
}
