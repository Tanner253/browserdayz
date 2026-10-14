// HOW A THING THAT STANDS ON THE GROUND IS SEATED IN IT. The whole rule, for whatever draws such a thing and for
// whatever stops a body at it (src/world/vegetation.ts does both, from the one answer given here).
//
// The owner, after playing the release of 14 October: "the tree stumps all around the castle look terrible and dont
// blend in with the ground at all. Same with some of the boulders around. and trees sometimes dont sit inthe ground
// properly when on a steep angle causin gthe base of the tree to look glitched or untextured on the steeper side of
// the trunk. [...] half floating disconnected from the ground oobjects dont look good."
//
// What was wrong, looked at in the game. Everything was set down by the height of the ground AT ITS MIDDLE, level,
// its model's lowest point at that height or a hand under it:
//   a tree   – a trunk is a pipe that ends at its foot. On a hillside the ground falls away under the low side of
//              it, and half a metre of pipe hung out of a 46 degree slope with its open end showing.
//   a stump  – its model is a stump with the forest floor it stood in about it, a metre and a half across, and its
//              own ground line is a hand's breadth and a half over its lowest root. Stood on the tips of its roots
//              it was a brown mound on the snow; level on a steep bank it stuck out of it like a shelf.
//   a rock   – the same: half of these stones are modelled to lie as much as 0.66 m in the earth and were stood on
//              their lowest point, a boulder was a hand in the ground and level on a slope of 38 degrees.
//   a log    – three metres long and level: one end in the bank and the other a metre in the air.
//
// THE RULE. A thing has a FOOT: the lowest drawn point of its rim in each sixteenth of a turn round it (of a tree,
// the ring its trunk ends in). Then
//   1  what LIES is laid to the ground under it, nose and roll, as far as its kind may be tilted: a stone and a log
//      have no upright, and a stump goes with the ground it grew from. What STANDS (a tree) is never tilted.
//   2  it is let down until every point of its foot is on the ground under THAT POINT or in it: seated on the
//      lowest ground under its own foot, not the ground at its middle;
//   3  and sunk a little more, by an amount that is its kind's own (`SEAT`): a rock a third of its height or as
//      deep as its model was made to lie, a stump as deep as its own roots, a tree a hand.
// On level ground 2 moves nothing and 3 is all there is: a tree stands within a hand of where it stood. The plan is
// not changed by any of this: a thing's place in the world (`Instance.x, y, z`) is what it was, and the answer here
// is how it is DRAWN AND COLLIDED there (`Instance.lean`, which the cars that lie to the ground on their wheels
// already had). The server knows a tree, a rock or a stump only by where it is over the ground, which has not moved.
//
// Nothing of the game's is read here but the ground: the test (test/seat.test.ts) asks this file the same question
// the game does, of the models' own shapes, and counts every thing on the map.

import type { Instance } from './worldgen';

/** Where a thing meets the ground, in its model's own measure (before its size in the world), its lowest point at 0. */
export interface Foot {
  /** the lowest drawn point of its rim in each part of a turn round it: [x, y, z] */
  rim: [number, number, number][];
  /** half its width and half its length, and how high it stands */
  hx: number;
  hz: number;
  h: number;
  /** how far over its lowest point the model's own ground line is: what it was made to have in the earth */
  own: number;
}

/**
 * How a kind is seated.
 *   lies  – the most it is tilted to the ground under it, radians (nothing: it stands upright whatever the ground does)
 *   sunk  – how far under the ground at its middle its lowest point goes at the least, its own measure
 *   more  – and how far under the lowest ground round its foot, its own measure: "sunk a little more"
 *   drift – for whoever paints it (`foot` in src/world/foliage.ts: the damp at its foot, the snow banked against
 *           it): how high snow is drifted against it where snow lies, metres. (Where the ground is reckoned to
 *           meet it, for the same painting: `groundLine`.)
 */
export interface Seating {
  lies: number;
  sunk: (f: Foot) => number;
  more: number;
  drift: number;
}

export const SEAT = {
  // (a hand: on level ground a tree is where it was. Its trunk is seated by the ring it ends in.)
  tree: { lies: 0, sunk: () => 0.04, more: 0.04, drift: 0.3 },
  // ("a boulder is a third in the earth": or as deep as it was modelled to lie, where that is more)
  rock: { lies: 0.85, sunk: (f: Foot) => Math.max(f.own, f.h / 3), more: 0.04, drift: 0.26 },
  // ("a stump's roots are under it": and a little of the forest floor its model brings with it, which is not the
  // ground's here). Little snow is banked against it: what is seen of a stump in the snow is the bark of its sides,
  // and drifted a hand deeper it was a white mound with nothing of a stump about it.
  stump: { lies: 0.75, sunk: (f: Foot) => f.own + 0.05, more: 0.03, drift: 0.07 },
  // (a trunk that lies: a third of its thickness in the ground it fell on)
  log: { lies: 0.85, sunk: (f: Foot) => f.h * 0.3, more: 0.02, drift: 0.1 },
} satisfies Record<string, Seating>;

/** which of those a thing set out by the world is, by the name of its model: null for what this rule does not seat (a tree is told by whoever knows the trees) */
export function seatKind(id: string): keyof typeof SEAT | null {
  if (id.startsWith('rock') || id.startsWith('boulder')) return 'rock';
  if (id.startsWith('tree_stump')) return 'stump';
  if (id === 'dead_tree_trunk') return 'log';
  return null;
}

/** how far over its lowest point the ground is reckoned to meet a thing so seated, its own measure (see `Seating`) */
export function groundLine(f: Foot, how: Seating): number {
  return Math.max(how.sunk(f), how.more + f.rim.reduce((m, p) => Math.max(m, p[1]), 0));
}

const PARTS = 16;

/**
 * The foot of a model, from its points ([x, y, z] one after another, as it is drawn: its lowest point at 0, its
 * middle over the origin). `ring`: it is a trunk, and its foot is the ring it ends in (every point within two
 * centimetres of the lowest). Otherwise: in each sixteenth of a turn, the lowest point of the outer third of its
 * reach there.
 */
export function footOf(points: ArrayLike<number>, own: number, ring = false): Foot {
  const n = Math.floor(points.length / 3);
  let hx = 0, hz = 0, h = 0, low = Infinity;
  for (let i = 0; i < n; i++) {
    hx = Math.max(hx, Math.abs(points[i * 3]));
    hz = Math.max(hz, Math.abs(points[i * 3 + 2]));
    h = Math.max(h, points[i * 3 + 1]);
    low = Math.min(low, points[i * 3 + 1]);
  }
  const rim: [number, number, number][] = [];
  if (ring) {
    let rx = 0, rz = 0;
    for (let i = 0; i < n; i++) {
      if (points[i * 3 + 1] > low + 0.02) continue;
      const p: [number, number, number] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
      // (a seam's point is told twice)
      if (!rim.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[2] - p[2]) < 1e-4)) rim.push(p);
      rx = Math.max(rx, Math.abs(p[0]));
      rz = Math.max(rz, Math.abs(p[2]));
    }
    return { rim, hx: rx, hz: rz, h, own };
  }
  const part = (i: number) => Math.floor(((Math.atan2(points[i * 3 + 2], points[i * 3]) + Math.PI) / (2 * Math.PI)) * PARTS) % PARTS;
  const reach = new Float64Array(PARTS), at = new Int32Array(PARTS).fill(-1);
  for (let i = 0; i < n; i++) reach[part(i)] = Math.max(reach[part(i)], Math.hypot(points[i * 3], points[i * 3 + 2]));
  for (let i = 0; i < n; i++) {
    const s = part(i);
    if (Math.hypot(points[i * 3], points[i * 3 + 2]) < reach[s] * 0.66) continue;
    if (at[s] < 0 || points[i * 3 + 1] < points[at[s] * 3 + 1]) at[s] = i;
  }
  for (let s = 0; s < PARTS; s++) if (at[s] >= 0) rim.push([points[at[s] * 3], points[at[s] * 3 + 1], points[at[s] * 3 + 2]]);
  return { rim, hx, hz, h, own };
}

/** a point of a thing (its own measure) as it is drawn: turned about, laid to the ground and at its size, metres from its origin */
export function seatedPoint(p: [number, number, number], rot: number, scale: number, nose: number, roll: number): [number, number, number] {
  // (as three turns it: rolled, then its nose put up, then turned about: see LodSet in vegetation.ts)
  const cb = Math.cos(roll), sb = Math.sin(roll), ca = Math.cos(nose), sa = Math.sin(nose), cr = Math.cos(rot), sr = Math.sin(rot);
  const x1 = p[0] * cb - p[1] * sb, y1 = p[0] * sb + p[1] * cb;
  const y2 = y1 * ca - p[2] * sa, z2 = y1 * sa + p[2] * ca;
  return [(x1 * cr + z2 * sr) * scale, y2 * scale, (-x1 * sr + z2 * cr) * scale];
}

/**
 * How a thing is seated: [its nose up, its roll (radians), the height of its lowest point], as `Instance.lean` is
 * told. `ground`: the height of the ground that is SEEN at a place. Nothing is answered for a thing that was not
 * put on the ground (a stone on a floor, say): it is left as it is.
 */
export function seat(ground: (x: number, z: number) => number, it: Pick<Instance, 'x' | 'y' | 'z' | 'rot' | 'scale'>, foot: Foot, how: Seating): [number, number, number] | undefined {
  const mid = ground(it.x, it.z);
  if (Math.abs(it.y - mid) > 0.6) return undefined;
  let nose = 0, roll = 0;
  if (how.lies > 0) {
    const c = Math.cos(it.rot), s = Math.sin(it.rot);
    const at = (lx: number, lz: number) => ground(it.x + lx * c + lz * s, it.z - lx * s + lz * c);
    // (laid to the ground at its four sides, a little inside its reach: no less than half a metre, or a small
    // stone is laid to a wrinkle)
    const wx = Math.max(0.5, foot.hx * it.scale * 0.8), wz = Math.max(0.5, foot.hz * it.scale * 0.8);
    nose = Math.max(-how.lies, Math.min(how.lies, -Math.atan2(at(0, wz) - at(0, -wz), 2 * wz)));
    roll = Math.max(-how.lies, Math.min(how.lies, Math.atan2(at(wx, 0) - at(-wx, 0), 2 * wx)));
  }
  // its lowest point no higher than `sunk` under the ground at its middle, and every point of its foot `more` under
  // the ground under that point
  let y = mid - how.sunk(foot) * it.scale;
  for (const p of foot.rim) {
    const q = seatedPoint(p, it.rot, it.scale, nose, roll);
    y = Math.min(y, ground(it.x + q[0], it.z + q[2]) - q[1] - how.more * it.scale);
  }
  return [nose, roll, y];
}

/** how far the highest point of a thing's foot stands over the ground under it, seated as said (`lean`) or as the plan alone has it: metres, nothing or less when all of its foot is in the ground */
export function footOver(ground: (x: number, z: number) => number, it: Pick<Instance, 'x' | 'y' | 'z' | 'rot' | 'scale'>, foot: Foot, lean?: [number, number, number]): number {
  let worst = -Infinity;
  for (const p of foot.rim) {
    const q = seatedPoint(p, it.rot, it.scale, lean ? lean[0] : 0, lean ? lean[1] : 0);
    worst = Math.max(worst, (lean ? lean[2] : it.y) + q[1] - ground(it.x + q[0], it.z + q[2]));
  }
  return worst;
}
