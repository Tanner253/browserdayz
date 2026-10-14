// The fort's loose pieces: the ruined houses below it, the curved and long walls, the rocks, and the hatch with its passage under the ground.
// (One part of castle.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { CASTLE, POSTERN, UNDER, castleGround, hash, type Opening, type Paint, type Part, type V3 } from './plan';
import { castleParts, cresset, passageLamps } from './parts';

// ------------------------------------------------------------------ the loose pieces of its grounds
//
// Round the real fort: the roofless shells of a village along the crest, a curved wall by the rock the ramp leaves
// from, a thin wall down the south slope, grey teeth of rock. None of them is part of the fort. Each is a thing by
// itself that stands on whatever ground it is put on (its foot goes three metres into it, so it meets ground that
// is not level), and whoever shapes the mountain sets each down where that ground suits: `LOOSE` is only where
// they stand when nobody has said, on the ground the fort assumes.

/**
 * A loose piece: which kind, which of its kind, where its middle is and how it is turned. (In the fort's own
 * measure here; `castleLoose` gives the same as places in the world, which is how the world's own list has them.)
 */
export interface Loose { kind: 'house' | 'curved wall' | 'long wall' | 'rock' | 'hatch'; n: number; x: number; z: number; rot: number }

/** the houses there are to choose from: how long, how deep, and which long side the door was on */
export const HOUSES: { w: number; d: number; door: number }[] = [{ w: 9, d: 7, door: -1 }, { w: 8.4, d: 6.6, door: 1 }, { w: 9.2, d: 7, door: -1 }, { w: 9, d: 7.2, door: 1 }, { w: 8.6, d: 6.8, door: -1 }];

/** how far into the ground a loose piece's foot goes */
const FOOTING = 3;

export const LOOSE: Loose[] = [
  // what is left of the village, along the crest to the east
  { kind: 'house', n: 0, x: 47, z: 2.5, rot: 0.14 }, { kind: 'house', n: 1, x: 60, z: -6.6, rot: -0.2 }, { kind: 'house', n: 2, x: 69, z: 3, rot: 0.1 }, { kind: 'house', n: 3, x: 80, z: -5, rot: -0.08 }, { kind: 'house', n: 4, x: 91, z: 2.5, rot: 0.22 },
  // the curved wall by the rock: what held the path up, on the side the ground falls away; and the thin wall down the south slope
  { kind: 'curved wall', n: 0, x: 20.5, z: -2, rot: 0 },
  { kind: 'long wall', n: 0, x: 22.6, z: 23.4, rot: 0 },
  // the storm-cellar hatch the sally port comes up at: in the old village, close behind the gable of its first
  // house from the fort, where nobody on the keep's roof, its wall top or a tower sees who goes down it. Its steps
  // go down northward, along the gable (the way it is turned: not turned, they go down toward the fort); the
  // passage is made from their foot to the fort, wherever it is set.
  // (a pace and a half from the first house's gable: at three quarters of a metre a body had no room to spare between that wall and the hatch's kerb)
  { kind: 'hatch', n: 0, x: 54, z: 1.6, rot: Math.PI },
  // grey teeth of rock, clear of the ways people go
  ...([[27.5, -6.2], [30.5, 3.2], [34, -7.5], [37.5, 2.6], [40.5, -6.8], [44, -9.5], [52.5, 7.5], [63.5, -1.5], [74.5, 8.2], [85.5, 0.5], [97, -4], [16.5, -13.5], [15.8, 9.5], [-15.5, -12.5], [-16.5, 6.5], [-20, -4], [-24.5, -9], [-27, 2.5], [-32, -6.5], [-36.5, -1]] as [number, number][]).map(([x, z], n): Loose => ({ kind: 'rock', n, x, z, rot: n * 1.7 })),
];

/** The pieces a loose piece is made of, where it stands (in the fort's own measure: each of them on the ground at its own spot). */
/**
 * The hatch and the passage to it, as plain figures: where its steps begin (at the ground) and end, the line the
 * passage takes from their foot to its end under the fort, and how long and how steep that is. `g`: the ground
 * at the hatch, over the terrace.
 */
export function hatchLine(l: { x: number; z: number; rot?: number }, g: number) {
  const H = UNDER.hatch, end: V3 = [POSTERN.x, POSTERN.y, POSTERN.z], far = Math.hypot(POSTERN.x - l.x, POSTERN.z - l.z);
  const u: [number, number] = [(POSTERN.x - l.x) / far, (POSTERN.z - l.z) / far], side: [number, number] = [u[1], -u[0]];
  // (a passage of any length bends twice: to one side before the hatch and to the other as it leaves the fort, so
  // that nobody sees, or shoots, along the whole of it. A short one runs straight.)
  const bends: [number, number][] = far < 18 ? [] : [[l.x + u[0] * Math.min(20, far * 0.45) - side[0] * 3.4, l.z + u[1] * Math.min(20, far * 0.45) - side[1] * 3.4], [POSTERN.x - u[0] * 7.6 + side[0] * 1.5, POSTERN.z - u[1] * 7.6 + side[1] * 1.5]];
  // (its steps go down the way it is turned, as a wall runs the way it is turned; not turned, toward the fort)
  const toward = bends[0] ?? [POSTERN.x, POSTERN.z], dl = Math.hypot(toward[0] - l.x, toward[1] - l.z), d: [number, number] = l.rot ? [Math.sin(l.rot), Math.cos(l.rot)] : [(toward[0] - l.x) / dl, (toward[1] - l.z) / dl];
  const head: V3 = [l.x - d[0] * 0.3, g, l.z - d[1] * 0.3], foot: V3 = [l.x + d[0] * (H.run - 0.3), g - H.drop, l.z + d[1] * (H.run - 0.3)];
  // (level for a pace at the foot of the steps: whoever comes off them is on a floor before it begins to climb)
  const LEVEL = 1.2, flat: [number, number][] = [[foot[0], foot[2]], [foot[0] + d[0] * LEVEL, foot[2] + d[1] * LEVEL], ...bends, [end[0], end[2]]], at = [0];
  for (let k = 1; k < flat.length; k++) at.push(at[k - 1] + Math.hypot(flat[k][0] - flat[k - 1][0], flat[k][1] - flat[k - 1][1]));
  const long = at[at.length - 1];
  return {
    /** the way its steps go down, and the way across them */
    d, r: [d[1], -d[0]] as [number, number],
    /** the head of its steps, at the ground; their foot; and the passage's end under the fort */
    head, foot, end,
    /** the middle line of the passage's floor, from the foot of the steps to its end: it falls or climbs evenly along its length */
    path: flat.map(([x, z], k): V3 => [x, foot[1] + ((end[1] - foot[1]) * Math.max(0, at[k] - LEVEL)) / (long - LEVEL), z]),
    /** how long the passage is, and how steep (rise over run, up toward the fort) */
    long, steep: (end[1] - foot[1]) / Math.max(1, long),
  };
}

/** The slot of the stair down to the sally port, on the plan: where the ground under the fort is taken away for it. */
export const shaftWell = (): [number, number][] => {
  const PS = UNDER.postern;
  return [[PS.x0 - 0.5, PS.head - 0.3], [PS.x1 + 0.6, PS.head - 0.3], [PS.x1 + 0.6, PS.end + 0.6], [PS.x0 - 0.5, PS.end + 0.6]];
};

/** The stairwell of a hatch on the plan: its four corners [x, z], in order round it (the hole in the ground, kerb and all). */
export function hatchWell(l: { x: number; z: number; rot?: number }, g: number): [number, number][] {
  const H = UNDER.hatch, L = hatchLine(l, g), w = H.wide / 2 + 0.3;
  const at = (along: number, across: number): [number, number] => [L.head[0] + L.d[0] * along + L.r[0] * across, L.head[2] + L.d[1] * along + L.r[1] * across];
  return [at(-0.02, -w), at(H.run + 0.65, -w), at(H.run + 0.65, w), at(-0.02, w)];
}

/**
 * Every piece of the plan that a hatch's way is under the ground in, and how deep the ground must be taken there
 * (see `castleCuts`): its stairwell, and a strip along each straight length of its passage. In the fort's own measure.
 */
export function hatchWells(l: { x: number; z: number; rot?: number }, g: number): { well: [number, number][]; to: number }[] {
  const H = UNDER.hatch, L = hatchLine(l, g), out = [{ well: hatchWell(l, g), to: g - H.drop - 0.6 }];
  for (let k = 0; k + 1 < L.path.length; k++) {
    const a = L.path[k], b = L.path[k + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]), e = [(b[0] - a[0]) / len, (b[2] - a[2]) / len], w = H.wide / 2 + 0.85;
    const at = (p: V3, along: number, across: number): [number, number] => [p[0] + e[0] * along + e[1] * across, p[2] + e[1] * along - e[0] * across];
    out.push({ well: [at(a, -1.3, -w), at(b, 1.3, -w), at(b, 1.3, w), at(a, -1.3, w)], to: Math.min(a[1], b[1]) - 0.9 });
  }
  return out;
}

/**
 * @param g the ground where the piece stands, over the terrace (asked for the hatch, whose passage is made to its depth: the others stand on the ground piece by piece)
 * @param ground the ground at any spot, over the terrace (asked for the hatch, whose kerb stands on the ground all round its well): unsaid, level with `g`
 */
export function looseParts(l: Loose, g = castleGround(l.x, l.z), ground?: (x: number, z: number) => number): Part[] {
  const parts: Part[] = [], c = Math.cos(l.rot), s = Math.sin(l.rot);
  if (l.kind === 'hatch') {
    // A storm cellar's doorway: a low kerb of stone round a flight of steps into the ground, two leaves of boards
    // that sloped over it (one thrown back and lying, one fallen in on the steps: it stands open, and anybody may
    // go in or come out), and the passage from the foot of the steps to the stair under the fort's east wall.
    const H = UNDER.hatch, L = hatchLine(l, g), w = H.wide / 2, at = (p: V3, across: number, up = 0): V3 => [p[0] + L.r[0] * across, p[1] + up, p[2] + L.r[1] * across];
    const flat = (p: V3, across: number): [number, number] => [p[0] + L.r[0] * across, p[2] + L.r[1] * across];
    // (the stairwell is open to the sky as far as half a pace past the foot of the steps: whoever comes down them is on the level before his head is under stone)
    const back: V3 = [L.foot[0] + L.d[0] * 0.5, g, L.foot[2] + L.d[1] * 0.5];
    parts.push({ t: 'flight', paint: 'base', foot: L.foot, head: L.head, w: H.wide, body: 'feet', name: 'hatch steps' });
    // WHERE THE HILL FALLS AWAY FROM THE HEAD OF ITS STEPS, STEPS COME UP TO IT. The head is as high as the ground at
    // the hatch's own middle; set down on a hillside with its back to the rise (the world's is), the ground before the
    // head was a knee lower, and the top step stood out of the hill with nothing up to it (2026-10-14, played: "gaps
    // at the top of the ... stairs ... where they dont meet flush with the next level"). As many steps of its own
    // rise and going, outward and down, as bring their foot to the ground at its lowest across them.
    if (ground) {
      const n = Math.round(H.drop / 0.2), rise = H.drop / n, run = H.run / n;
      const out = (k: number): V3 => [L.head[0] - L.d[0] * k * run, g - k * rise, L.head[2] - L.d[1] * k * run];
      const low = (k: number) => Math.min(...[-w, 0, w].map((a) => ground(...flat(out(k), a))));
      let k = 0;
      if (low(1) < g - 0.1) for (k = 1; k < 9 && low(k) < g - k * rise - 0.02; k++);
      if (k > 0 && k < 9) parts.push({ t: 'flight', paint: 'base', foot: out(k), head: L.head, w: H.wide, body: 'feet', name: 'hatch stoop' });
    }
    // its two cheeks, a hand over the ground at the head of the steps and knee high at the back, and the wall across the back
    // (The cheeks run to the far face of the wall across the back, which stands between them; and the passage's own walls
    // and its roof begin there. Run past each other, a cheek and a wall of the passage were two faces in one plane at
    // the foot of the steps, and so were the back wall's ends and the cheeks outside: 2026-10-13, "the path underground
    // at the base of the stairs is bugged with panels and textures".)
    // (How far past the foot of the steps each cheek goes: to the far face of the back wall, 0.65; but on the inside of
    // the passage's first bend no further than that bend's corner, where the next length's wall takes over.)
    const reach = (side: number) => {
      if (L.path.length < 3) return 0.65;
      const p0 = L.path[0], p1 = L.path[1], p2 = L.path[2], l0 = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), l1 = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
      const e0 = [(p1[0] - p0[0]) / l0, (p1[2] - p0[2]) / l0], e1 = [(p2[0] - p1[0]) / l1, (p2[2] - p1[2]) / l1], turn = e0[0] * e1[1] - e0[1] * e1[0];
      const corner = l0 + (turn < 0 ? -side : side) * Math.tan(Math.acos(Math.min(1, Math.max(-1, e0[0] * e1[0] + e0[1] * e1[1]))) / 2) * w;
      return Math.max(0.2, Math.min(0.65, corner));
    };
    const far = (side: number): V3 => [L.foot[0] + L.d[0] * reach(side), g, L.foot[2] + L.d[1] * reach(side)];
    // (of the passage's own rough stone, all of it: two stuffs are each bent their own way, and where a cheek of one met a wall of the other edge to edge a gap opened between them, a finger wide here and a hand there)
    // THE KERB HOLDS THE HILL BACK ALL ROUND. A hatch may be set down on a hillside with its steps going down into
    // the rise (the world's is: the ground is two metres higher at the back of its well than at the head of its
    // steps). A kerb as high as the ground at the hatch's own middle then stood a metre and more under the ground
    // at the back, and between its top and the edge of the ground there was nothing: a dark slot round the well
    // (seen, 2026-10-13). So each length of each cheek, and the wall across the back, stands on the ground AS IT IS
    // WHERE THAT LENGTH IS: a foot over the highest of it at the head of the steps, knee high at the back.
    // (in ten lengths to a cheek, each half a pace: in five, on a hill, each stood near half a metre over the last)
    const gAt = (q: [number, number]) => (ground ? ground(q[0], q[1]) : g), RISE = [0.32, 0.32, 0.32, 0.32, 0.39, 0.46, 0.54, 0.62, 0.7, 0.78];
    for (const side of [-1, 1]) {
      const a = flat(side > 0 ? L.head : far(side), side * (w + 0.15)), b = flat(side > 0 ? far(side) : L.head, side * (w + 0.15)), up = side > 0 ? RISE : [...RISE].reverse();
      const top = up.map((t, k) => Math.max(...[0, 0.5, 1].map((f) => gAt([a[0] + ((b[0] - a[0]) * (k + f)) / up.length, a[1] + ((b[1] - a[1]) * (k + f)) / up.length]))) + t);
      parts.push({ t: 'wall', paint: 'base', tone: 0.92, name: 'hatch kerb', a, b, y0: g - H.drop - 0.3, top, thick: 0.3, stepped: true });
    }
    parts.push({ t: 'wall', paint: 'base', tone: 0.92, name: 'hatch kerb', a: flat(back, w), b: flat(back, -w), y0: g - H.drop + H.tall, top: Math.max(gAt(flat(back, w)), gAt(flat(back, 0)), gAt(flat(back, -w))) + 0.8, thick: 0.3, soffit: true });
    // the leaf that was thrown back, lying on the ground beside it (as the ground lies there); and the one that fell in, on the steps
    const mid: V3 = [(L.head[0] + L.foot[0]) / 2, g, (L.head[2] + L.foot[2]) / 2];
    const lie = (p: V3, across: number, up: number): V3 => [flat(p, across)[0], gAt(flat(p, across)) + up, flat(p, across)[1]];
    parts.push({ t: 'slab', paint: 'timber', tone: 0.8, body: 'none', name: 'hatch leaf', p: [lie(L.head, w + 0.45, 0.1), lie(back, w + 0.45, 0.16), lie(back, w + 1.15, 0.07), lie(L.head, w + 1.15, 0.05)], thick: 0.05 });
    parts.push({ t: 'slab', paint: 'timber', tone: 0.75, body: 'none', name: 'hatch leaf', p: [at(mid, -w + 0.05, -H.drop / 2 + 0.2), at(L.foot, -w + 0.08, 0.22), at(L.foot, -0.05, 0.4), at(mid, 0.02, -H.drop / 2 + 0.38)], thick: 0.05 });
    // the ground's own earth, laid over everything the world cuts for it (the stairwell, and a strip along the
    // passage: ground cannot be walked under where it has been walked through): it lies as the ground lay
    // (and what of the passage the earth must keep out of: each straight length of it out to the outer faces of its
    // walls and a hand more, as far past each end as its walls go round a bend, and up to the top of its roof)
    const ways = L.path.slice(0, -1).map((a0, k) => {
      const b0 = L.path[k + 1], len = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]), e = [(b0[0] - a0[0]) / len, (b0[2] - a0[2]) / len], m = w + 0.3;
      const by = (q: V3, along: number, across: number): [number, number] => [q[0] + e[0] * along + e[1] * across, q[2] + e[1] * along - e[0] * across];
      return { well: [by(a0, -m, -m), by(b0, m, -m), by(b0, m, m), by(a0, -m, m)], top: Math.max(a0[1], b0[1]) + H.tall + 0.32 };
    });
    parts.push({ t: 'apron', paint: 'earth', name: 'hatch apron', wells: [shaftWell(), ...hatchWells(l, g).map((q) => q.well)], hole: hatchWell(l, g), reach: H.lid, ways });
    // the passage: a floor, a roof and two walls to each straight length of it, from the foot of the steps to the stair under the fort
    const o = { paint: 'base' as Paint, roofed: true, tone: 0.8 };
    for (const [x, z, y] of passageLamps(L)) parts.push(...cresset(x, z, y, 0).map((q) => ({ ...q, roofed: true })));
    const dirs = L.path.slice(0, -1).map((a0, k): [number, number] => {
      const b0 = L.path[k + 1], len = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]);
      return [(b0[0] - a0[0]) / len, (b0[2] - a0[2]) / len];
    });
    /**
     * At the bend after length `k`: how far past the bend the wall on one side (`sgn`) is carried to meet its fellow
     * of the next length. On the outside of the bend that is on past it; on the inside it is short of it, by as much:
     * so the two lengths meet at a corner with no gap outside it and nothing standing in the way inside it.
     * (Measured to where the two walls' FACES ON THE PASSAGE meet. On the outside of a bend that is where their
     * middle lines meet, less a little, and each wall's end is in the other. On the inside the walls stand round a
     * corner of earth and the passage is on the outside of that corner: carried only to where their middle lines
     * meet, the two left a notch open between their ends, a hand wide, at every inside corner of the passage, and
     * through it the backs of both were seen. There each is carried to where their faces meet, which is further.)
     */
    const mitre = (k: number, sgn: number) => {
      if (k < 0 || k + 1 >= dirs.length) return 0;
      // (the side that is across at +1 is the inside of a bend that turns toward it, which is where `turn` is under nothing)
      const e0 = dirs[k], e1 = dirs[k + 1], turn = e0[0] * e1[1] - e0[1] * e1[0], out = turn < 0 ? -sgn : sgn;
      return out * Math.tan(Math.acos(Math.min(1, Math.max(-1, e0[0] * e1[0] + e0[1] * e1[1]))) / 2) * (out < 0 ? w : w + 0.125);
    };
    /** how far past a bend its floor and its roof go: as far as the wall on its outside */
    const past = (k: number) => Math.max(Math.abs(mitre(k, 1)), Math.abs(mitre(k, -1)));
    for (let k = 0; k + 1 < L.path.length; k++) {
      const a0 = L.path[k], b0 = L.path[k + 1], len = Math.hypot(b0[0] - a0[0], b0[2] - a0[2]), e = dirs[k], last = k + 2 === L.path.length;
      // (a place so far along it from one of its ends, on the line of its floor: which climbs)
      const on = (p: V3, by: number): V3 => [p[0] + e[0] * by, p[1] + (by * (b0[1] - a0[1])) / len, p[2] + e[1] * by];
      // (its floor and its roof reach as far past each bend as the outer wall does: the corner is floored and roofed. One length's lie a hair under the next's, so that where they overlap one of them is seen and not both at once.)
      const a = on(a0, k === 0 ? -0.2 : -past(k - 1)), b = on(b0, last ? 0.1 : past(k)), hair = (k % 2) * 0.004;
      const off = (p: V3, across: number, up = 0): V3 => [p[0] + e[1] * across, p[1] + up, p[2] - e[0] * across], plan = (p: V3, across: number): [number, number] => [p[0] + e[1] * across, p[2] - e[0] * across];
      parts.push({ t: 'slab', ...o, name: 'passage floor', p: [off(a, -w, -hair), off(b, -w, -hair), off(b, w, -hair), off(a, w, -hair)], thick: 0.3 });
      const m = k === 0 ? on(a0, 0.65) : a;
      parts.push({ t: 'slab', ...o, name: 'passage roof', p: [off(m, -w, H.tall + 0.3 + hair), off(b, -w, H.tall + 0.3 + hair), off(b, w, H.tall + 0.3 + hair), off(m, w, H.tall + 0.3 + hair)], thick: 0.3 });
      {
        // What is seen of its roof: a round one of the same rough stone from wall to wall, under the slabs; gone where
        // the slab came down. It keeps to the straight of each length: it stops short of the square of each bend,
        // which the flat slabs roof, and at each of its ends an arch of stone stands across the passage, the round's
        // own shape, closing what is between the round and the slabs. (Run on through the bends, two rounds crossed,
        // and each was seen from behind through the other; and at an end with no arch the hollow over the round was
        // looked into from the bend. Found by the check that looks every way from every pace of it.)
        const v0 = k === 0 ? 0.65 : past(k - 1) + w + 0.2, v1 = last ? len + 0.1 : len - past(k) - w - 0.2;
        if (v1 - v0 > 1.6) {
          const va = on(a0, v0), vb = on(a0, v1), down = len / 2 - v0;
          parts.push({ t: 'vault', ...o, tone: 0.72, name: 'passage vault', a: [va[0], va[2]], b: [vb[0], vb[2]], wide: 2 * w, spring: va[1] + H.tall - 0.62, crown: va[1] + H.tall - 0.01, lift: vb[1] - va[1], gone: L.path.length > 3 && k === 2 ? [[down - 1.25, down + 1.25]] : undefined });
          for (const p of last ? [va] : [va, vb]) parts.push({ t: 'wall', ...o, tone: 0.74, body: 'none', name: 'passage arch', a: plan(p, -w), b: plan(p, w), y0: p[1] - 0.05, top: p[1] + H.tall + 0.02, thick: 0.34, openings: [{ u0: 0, u1: 2 * w, y0: p[1] - 0.05, y1: p[1] + H.tall - 0.01, arch: true, rise: 0.61 }] });
        }
      }
      for (const sgn of [-1, 1]) {
        const from = on(a0, k === 0 ? reach(sgn) : -mitre(k - 1, sgn)), to = on(b0, last ? 0.1 : mitre(k, sgn));
        // (on the inside of the first bend the hatch's own cheek is the wall as far as the corner: there is none of the passage's to make)
        if ((to[0] - from[0]) * e[0] + (to[2] - from[2]) * e[1] < 0.05) continue;
        // (in pieces of three metres, each as high as its own roof and no higher: a length that climbs two metres had walls level with its upper end from end to end, and at its lower end they stood a metre out of the ground behind the hatch, where a walker was held by them)
        const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 3)), at = (t: number): V3 => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
        for (let i = 0; i < n; i++) {
          const p0 = at(i / n), p1 = at((i + 1) / n);
          parts.push({ t: 'wall', ...o, name: 'passage wall', a: plan(sgn > 0 ? p0 : p1, sgn * (w + 0.125)), b: plan(sgn > 0 ? p1 : p0, sgn * (w + 0.125)), y0: Math.min(p0[1], p1[1]) - 0.3, top: Math.max(p0[1], p1[1]) + H.tall + 0.3, thick: 0.25 });
        }
      }
      if (L.path.length > 3 && k === 2) {
        // half way along its middle length the roof has come down: a slab of it lies across the passage at a man's
        // chest, and whoever goes on goes on crouched
        // (it lies as the floor lies, which climbs: a hand of room over a crouched head at both its ends)
        const mid2: V3 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2, (a0[2] + b0[2]) / 2], rise = ((b0[1] - a0[1]) / len) * 1.2, c0: V3 = [mid2[0] - e[0] * 1.2, mid2[1] - rise, mid2[2] - e[1] * 1.2], c1: V3 = [mid2[0] + e[0] * 1.2, mid2[1] + rise, mid2[2] + e[1] * 1.2];
        parts.push({ t: 'slab', ...o, tone: 0.7, name: 'fallen roof of the passage', p: [off(c0, -w, H.tall + 0.02), off(c1, -w, H.tall + 0.02), off(c1, w, H.tall + 0.02), off(c0, w, H.tall + 0.02)], thick: H.tall - 1.32 });
        for (const [by, across, r] of [[-1.5, -0.42, 0.24], [1.6, 0.44, 0.22], [-0.2, 0.5, 0.16]]) {
          const q = off(on(mid2, by), across);
          parts.push({ t: 'lump', paint: 'stone', x: q[0], y: q[1] + r * 0.5, z: q[2], rx: r, ry: r * 0.5, rz: r * 0.8, seed: Math.round(700 + by * 10), blocky: true, body: 'none', roofed: true, name: 'fallen stone' });
        }
      }
    }
    return parts;
  }
  const at = (lx: number, lz: number): [number, number] => [l.x + lx * c + lz * s, l.z - lx * s + lz * c];
  const wall = (a: [number, number], b: [number, number], top: number[], thick: number, name: string, openings?: Opening[]) => void parts.push({ t: 'wall', paint: 'stone', tone: 0.88, at: 'both', name, a, b, y0: -FOOTING, top, thick, openings, sits: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  if (l.kind === 'house') {
    const k = l.n % HOUSES.length, sh = HOUSES[k], w = sh.w / 2, d = sh.d / 2, name = `ruined house ${k + 1}`;
    /** a long wall's broken top, and a gable's: up to five metres in the middle of it, and never whole */
    const long = (seed: number) => Array.from({ length: 9 }, (_, i) => Math.round((0.7 + hash(i, seed, 21 + k) * 2.3) * 10) / 10);
    const gable = (seed: number) => Array.from({ length: 7 }, (_, i) => Math.round(Math.max(0.6, (2.4 + (1 - Math.abs(i - 3) / 3.5) * 2.6) * (hash(i, seed, 23 + k) < 0.25 ? 0.45 : 0.82 + hash(i, seed, 24 + k) * 0.18)) * 10) / 10);
    // (the whole house stands at the height of the ground under its middle: its floor is level, as a house's is)
    const o = { t: 'wall' as const, paint: 'stone' as Paint, tone: 0.9, at: 'both' as const, name, thick: 0.6, y0: -FOOTING, sits: [l.x, l.z] as [number, number] };
    const door = { u0: sh.w * 0.4, u1: sh.w * 0.4 + 1.2, y0: -FOOTING - 0.1, y1: 9 };
    parts.push({ ...o, a: at(-w, -d + 0.3), b: at(w, -d + 0.3), top: long(1), openings: sh.door < 0 ? [door] : [{ u0: 2, u1: 2.9, y0: 0.9, y1: 2, arch: false }] });
    parts.push({ ...o, a: at(w, d - 0.3), b: at(-w, d - 0.3), top: long(2), openings: sh.door > 0 ? [door] : [{ u0: 5.6, u1: 6.5, y0: 0.9, y1: 2, arch: false }] });
    parts.push({ ...o, a: at(w - 0.3, -d + 0.6), b: at(w - 0.3, d - 0.6), top: gable(3) });
    parts.push({ ...o, a: at(-w + 0.3, d - 0.6), b: at(-w + 0.3, -d + 0.6), top: gable(4) });
    // (stones of it, lying inside)
    for (let i = 0; i < 3; i++) {
      const [px, pz] = at((hash(i, k, 31) - 0.5) * (sh.w - 3), (hash(i, k, 32) - 0.5) * (sh.d - 3));
      parts.push({ t: 'lump', paint: 'stone', x: px, y: 0.12, z: pz, rx: 0.28 + hash(i, k, 33) * 0.25, ry: 0.2, rz: 0.3, seed: 80 + k * 5 + i, blocky: true, sits: [px, pz], name: 'fallen block' });
    }
  } else if (l.kind === 'curved wall') {
    // four lengths of a round, nine metres out from its middle
    const pt = (a: number) => at(Math.cos((a * Math.PI) / 180) * 9.4, Math.sin((a * Math.PI) / 180) * 9.4);
    for (let k = 0; k < 4; k++) wall(pt(98 - k * 21), pt(98 - (k + 1) * 21), [1.1 + hash(k, 1, 41) * 1.3, 0.7 + hash(k, 2, 41) * 1.6, 1.2 + hash(k, 3, 41) * 1.1], 0.7, 'curved wall');
  } else if (l.kind === 'long wall') {
    // sixteen metres of it, in lengths that each stand at the height of the ground where they are, one of them gone
    for (let k = 0; k < 7; k++) if (k !== 3) wall(at(0, -8.4 + (k + 1) * 2.4), at(0, -8.4 + k * 2.4), [1.2 + hash(k, 1, 43) * 1.4, 1.6 + hash(k, 2, 43) * 1.2], 0.55, 'wall down the slope');
  } else {
    const r = 0.9 + hash(l.n, 1, 51) * 0.7, h = 0.9 + hash(l.n, 2, 51) * 1;
    parts.push({ t: 'lump', paint: 'rock', x: l.x, y: h * 0.25, z: l.z, rx: r, ry: h, rz: r * (0.7 + hash(l.n, 3, 51) * 0.5), seed: 300 + l.n * 7, sits: [l.x, l.z], at: 'both', name: 'rock tooth' });
  }
  return parts;
}

/** whether a spot (in the fort's own measure) is in the round cellar in the foot of a hollow tower */
export const inCellar = (x: number, y: number, z: number) => y < -0.6 && castleParts().some((t) => t.t === 'tower' && t.hollow !== undefined && y > t.hollow - 0.4 && Math.hypot(x - t.cx, z - t.cz) < CASTLE.tower.r - CASTLE.tower.wall + 0.4);
