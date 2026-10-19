// Inside Pokrov's corner towers (2026-10-19). The owner: "pokrov needs to have stairs on the insides of the corner
// towers and door". The towers are the fort kit's round tower, which is a skin with nothing in it and no way in
// ("No door, no stair: nothing in the kit reaches its top"), made solid as one shape. Now each is hollow: a doorway
// from the court, a round room, a stone stair winding up its wall with a parapet on its open side, and through a
// hatch in the platform onto the top, where its battlements and the little drum in its middle stop a body too.
// Pure numbers, the same for the game and the server; heights are over the tower's foot (the wall's).

import { KIT_TOWER, type Cut, type KitSolid, type V3 } from './kit';

const D = Math.PI / 180;

/** the platform on the top, measured on the model (KIT_TOWER says 11.5: a stair's head a centimetre proud of it showed as a line) */
const TOP = 11.4894;
export const TOWER_ROOM = {
  /** the room's wall, the stair's inner edge (its parapet's outer face), the parapet's inner face */
  r: 4.4, stair: 3.2, rail: 3.0,
  /** the doorway: half its width, its height */
  door: { half: 0.65, h: 2.4 },
  /** the platform, and the room's ceiling under it */
  top: TOP, ceil: TOP - 0.45,
  /** how many steps, round how much of the wall, starting so far round from the doorway (clear of it) */
  steps: 61, sweep: 300 * D, start: 32 * D,
  /** how thick a step's slab is, how high its parapet stands over the line of the steps' fronts */
  slab: 0.25, railUp: 0.95,
};
/** how far out the tower's face is at a height (measured on the kit's model: a moulded foot, then a straight batter to the platform) */
const FACE: [number, number][] = [[0, 7.93], [1.5, 7.76], [2, 7.33], [2.75, 7.2], [TOP, 6.29]];
export const faceAt = (y: number): number => {
  for (let k = 1; k < FACE.length; k++) if (y <= FACE[k][0]) return FACE[k - 1][1] + ((FACE[k][1] - FACE[k - 1][1]) * (y - FACE[k - 1][0])) / (FACE[k][0] - FACE[k - 1][0]);
  return FACE[FACE.length - 1][1];
};
/** the battlements round the platform: their inner and outer faces, the crenels' sills and the merlons' tops; the eight crenels' middles round the kit's own piece, and half the width of each */
const RING = { r0: KIT_TOWER.ring.r0, r1: KIT_TOWER.ring.r1, sill: 11.95, merlon: 13.02, crenel: 20.5 * D, every: 45 * D, half: 6.5 * D };
/** the drum in the middle of the platform: its radius, its top, the top of its cap */
const DRUM = { r: 1.17, top: 13.26, cap: 13.5 };

/** one tower as it stands: its middle, its foot, which way its doorway faces and its stair turns, and its kit piece's turn (where its crenels are) */
export interface TowerPlace { x: number; z: number; foot: number; door: number; dir: 1 | -1; turn: number }

/** a step of the stair: the angles it spans, the top of its tread */
export interface Step { a0: number; a1: number; y: number }

/** the steps of a tower's stair, foot to head; the first is the lowest */
export function towerSteps(t: TowerPlace): Step[] {
  const R = TOWER_ROOM, da = (R.sweep / R.steps) * t.dir, rise = R.top / R.steps, from = t.door + R.start * t.dir;
  return Array.from({ length: R.steps }, (_, i) => ({ a0: from + da * i, a1: from + da * (i + 1), y: rise * (i + 1) }));
}

/** the line of the steps' fronts, at an angle along the stair: the slope a body goes up (from the floor one step before the first, level over the last) */
export function noseAt(t: TowerPlace, a: number): number {
  const R = TOWER_ROOM, da = R.sweep / R.steps, rise = R.top / R.steps, from = t.door + R.start * t.dir;
  const u = ((a - from) * t.dir) / da;
  return Math.max(0, Math.min(R.top, rise * (u + 1)));
}

/**
 * The hatch in the platform: from the step where the line of the fronts is 2.25 m under the ceiling, to the stair's
 * head. A body is 1.72 m and its crown is round: climbing past the platform's edge with 2 m (walked, 2026-10-19) its
 * head caught on it, and it went no higher.
 */
export function towerHatch(t: TowerPlace): [number, number] {
  const steps = towerSteps(t), first = steps.findIndex((s) => s.y >= TOWER_ROOM.ceil - 2.25);
  return [steps[first].a0, steps[steps.length - 1].a1];
}

/** angles from a0 to a1 (either way round) in pieces of no more than `most` */
export function arcs(a0: number, a1: number, most: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / most));
  return Array.from({ length: n + 1 }, (_, k) => a0 + ((a1 - a0) * k) / n);
}

// ------------------------------------------------------------------ what is cut out of the kit

const cutOf = (planes: Cut['planes'], pts: V3[]): Cut => {
  const mid: V3 = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length) as V3;
  return { planes, mid, reach: Math.max(...pts.map((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]))) };
};
/** a block cut along a way (an angle on the plan), from `near` to `far` out from the tower's middle, so wide either side, so high */
function passageCut(t: TowerPlace, near: number, far: number, half: number, y0: number, y1: number): Cut {
  const c = Math.cos(t.door), s = Math.sin(t.door), along = t.x * c + t.z * s, across = -t.x * s + t.z * c;
  const pts: V3[] = [];
  for (const u of [near, far]) for (const v of [-half, half]) for (const y of [y0, y1]) pts.push([t.x + c * u - s * v, y, t.z + s * u + c * v]);
  return cutOf([[c, 0, s, along + far], [-c, 0, -s, -(along + near)], [-s, 0, c, across + half], [s, 0, -c, half - across], [0, 1, 0, y1], [0, -1, 0, -y0]], pts);
}
/** a piece of a ring cut out, between two angles, from one radius to another (flat between its corners), so high */
function sectorCut(t: TowerPlace, a0: number, a1: number, r0: number, r1: number, y0: number, y1: number): Cut {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1), m = (lo + hi) / 2, h = (hi - lo) / 2, mx = Math.cos(m), mz = Math.sin(m), mc = mx * t.x + mz * t.z;
  const pts: V3[] = [];
  for (const a of [lo, hi]) for (const r of [r0, r1]) for (const y of [y0, y1]) pts.push([t.x + Math.cos(a) * r, y, t.z + Math.sin(a) * r]);
  const side = (a: number, sign: number): Cut['planes'][number] => [sign * Math.sin(a), 0, -sign * Math.cos(a), sign * (Math.sin(a) * t.x - Math.cos(a) * t.z)];
  return cutOf([side(lo, 1), side(hi, -1), [mx, 0, mz, mc + r1 * Math.cos(h)], [-mx, 0, -mz, -mc - r0 * Math.cos(h)], [0, 1, 0, y1], [0, -1, 0, -y0]], pts);
}
/** a drum cut out, upright, of many flat sides */
function roundCut(t: TowerPlace, r: number, y0: number, y1: number, sides = 32): Cut {
  const planes: Cut['planes'] = [[0, 1, 0, y1], [0, -1, 0, -y0]], pts: V3[] = [];
  for (let k = 0; k < sides; k++) {
    const a = ((k + 0.5) * 2 * Math.PI) / sides, nx = Math.cos(a), nz = Math.sin(a);
    planes.push([nx, 0, nz, t.x * nx + t.z * nz + r]);
    for (const y of [y0, y1]) pts.push([t.x + nx * r * 1.01, y, t.z + nz * r * 1.01]);
  }
  return cutOf(planes, pts);
}

/**
 * What is cut out of the tower's own piece: the doorway through its wall, and the hatch through its platform. The
 * room needs nothing cut: the kit's tower has nothing inside it.
 */
export function towerCuts(t: TowerPlace): Cut[] {
  const R = TOWER_ROOM, f = t.foot, [h0, h1] = towerHatch(t);
  const out = [passageCut(t, R.r - 0.4, KIT_TOWER.foot + 0.5, R.door.half, f - 0.1, f + R.door.h)];
  // (the hatch: its inner edge a finger inside the stair's parapet, which runs up through it)
  const as = arcs(h0, h1, 10 * D);
  for (let k = 0; k + 1 < as.length; k++) out.push(sectorCut(t, as[k], as[k + 1], R.rail - 0.02, R.r, f + R.ceil - 0.05, f + TOP + 0.25));
  return out;
}
/**
 * What is cut out of a wall that runs into the tower: all of it in the room and a hand round it (its pieces run to
 * the tower's middle), and in the doorway. Wider than the room by half a metre: a wall is made solid in blocks of
 * that size, and one standing half in the room stood out of its wall. Nothing of what is cut is seen: the room's own
 * wall is in front of it.
 */
export function wallCuts(t: TowerPlace): Cut[] {
  const R = TOWER_ROOM, f = t.foot;
  return [roundCut(t, R.r + 0.6, f - 1, f + TOP + 2), passageCut(t, R.r - 0.4, faceAt(R.door.h) - 0.15, R.door.half + 0.35, f - 1, f + R.door.h + 0.3)];
}

// ------------------------------------------------------------------ what stops a body

/** the points of a convex shape, less what is on the far side of a plane (n . p > d): what is left of it, by its corners and where its edges cross */
function clip(pts: V3[], n: V3, d: number): V3[] {
  const side = pts.map((p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d), out: V3[] = pts.filter((_, i) => side[i] <= 1e-9);
  // (every pair, not only edges: what a pair inside the shape gives lies inside what is left of it, and changes nothing)
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if ((side[i] > 0) === (side[j] > 0)) continue;
    const f = side[i] / (side[i] - side[j]);
    out.push([0, 1, 2].map((k) => pts[i][k] + (pts[j][k] - pts[i][k]) * f) as V3);
  }
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.map((v) => v.toFixed(3)).join()) && !!seen.add(p.map((v) => v.toFixed(3)).join()));
}
const hull = (pts: V3[], name: string): KitSolid => ({ t: 'hull', pts: pts.flat(), name });
const ringPt = (t: TowerPlace, a: number, r: number, y: number): V3 => [t.x + Math.cos(a) * r, t.foot + y, t.z + Math.sin(a) * r];

/**
 * What stops a body at a tower, in the world: its wall all round the room (but at the doorway), the platform over
 * the room (but at the hatch), the battlements and the drum on its top, and the stair: a slope along the fronts of
 * its steps, as every flight in the game is (no step to catch the feet on), and its parapet.
 */
export function towerSolids(t: TowerPlace): KitSolid[] {
  const R = TOWER_ROOM, out: KitSolid[] = [], name = 'Pokrov tower';
  const SEG = 15 * D, grow = 1 / Math.cos(SEG / 2);
  // the wall, in pieces of fifteen degrees round and two heights (the moulded foot; the batter over it), drawn round
  // the face; those the doorway goes through, as what is either side of it and what is over it
  const c = Math.cos(t.door), s = Math.sin(t.door), o = -s * t.x + c * t.z, h = R.door.half;
  /** the side of a plane square across the doorway's way where `sign` times how far across it a point is is no more than v */
  const across = (pts: V3[], sign: number, v: number) => clip(pts, [-s * sign, 0, c * sign], v + sign * o);
  for (let k = 0; k < 24; k++) {
    const a0 = t.door + (k - 0.5) * SEG, a1 = a0 + SEG;
    for (const band of [[0, 1.5, 2], [2, 2.75, TOP]]) {
      const pts: V3[] = [];
      for (const a of [a0, a1]) {
        for (const y of [band[0], band[band.length - 1]]) pts.push(ringPt(t, a, R.r, y));
        for (const y of band) pts.push(ringPt(t, a, faceAt(y) * grow, y));
      }
      if (k > 2 && k < 22) {
        out.push(hull(pts, name));
        continue;
      }
      for (const part of [across(pts, -1, -h), across(pts, 1, -h), clip(across(across(pts, 1, h), -1, h), [0, -1, 0], -(t.foot + R.door.h))]) if (part.length >= 4) out.push(hull(part, name));
    }
  }
  // the platform over the room, but at the hatch: pies to the parapet's inner face, and the ring outside that where the hatch is not
  const [h0, h1] = towerHatch(t), lo = Math.min(h0, h1), hi = Math.max(h0, h1), base = t.door - SEG / 2;
  // (every angle within one turn from the doorway's first piece, so that they sort round, and the turn closed)
  const marks = [...Array.from({ length: 24 }, (_, k) => t.door + (k - 0.5) * SEG), ...arcs(h0, h1, 10 * D)].map((a) => base + ((((a - base) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)));
  const ends = [...[...new Set(marks.map((a) => a.toFixed(6)))].map(Number).sort((p, q) => p - q), base + 2 * Math.PI];
  const inHatch = (a: number) => {
    // (the same angle as the hatch's, one turn this way or that)
    for (const w of [-2 * Math.PI, 0, 2 * Math.PI]) if (a + w > lo + 1e-6 && a + w < hi - 1e-6) return true;
    return false;
  };
  for (let k = 0; k + 1 < ends.length; k++) {
    const a0 = ends[k], a1 = ends[k + 1];
    if (a1 - a0 < 1e-4) continue;
    const y0 = R.ceil, y1 = TOP, mid = [t.x, t.foot + y0, t.z] as V3, top = [t.x, t.foot + y1, t.z] as V3;
    out.push(hull([mid, top, ...[a0, a1].flatMap((a) => [ringPt(t, a, R.rail - 0.02, y0), ringPt(t, a, R.rail - 0.02, y1)])], name));
    if (!inHatch((a0 + a1) / 2)) out.push(hull([a0, a1].flatMap((a) => [R.rail - 0.02, R.r + 0.05].flatMap((r) => [ringPt(t, a, r, y0), ringPt(t, a, r, y1)])), name));
  }
  // the battlements: each merlon in three, each crenel's sill (the kit's piece turned: its own angle less its turn is the world's)
  for (let k = 0; k < 8; k++) {
    const mid = RING.crenel + k * RING.every - t.turn;
    const piece = (a0: number, a1: number, y1: number) => out.push(hull([a0, a1].flatMap((a) => [RING.r0, RING.r1].flatMap((r) => [ringPt(t, a, r, TOP - 0.05), ringPt(t, a, r, y1)])), name));
    piece(mid - RING.half, mid + RING.half, RING.sill);
    const m = arcs(mid + RING.half, mid + RING.every - RING.half, 12 * D);
    for (let j = 0; j + 1 < m.length; j++) piece(m[j], m[j + 1], RING.merlon);
  }
  // the drum, and its cap
  out.push(hull([...Array.from({ length: 16 }, (_, k) => [ringPt(t, k * 22.5 * D, DRUM.r * 1.02, TOP - 0.05), ringPt(t, k * 22.5 * D, DRUM.r * 1.02, DRUM.top)]).flat(), [t.x, t.foot + DRUM.cap, t.z]], name));
  // the stair: its slope, a piece a step, from one before the first (on the floor) to the head; its parapet, a piece each two steps
  const steps = towerSteps(t), da = steps[0].a1 - steps[0].a0;
  for (let i = -1; i < steps.length; i++) {
    const a0 = steps[0].a0 + da * i, a1 = a0 + da, y0 = noseAt(t, a0), y1 = noseAt(t, a1);
    out.push(hull([a0, a1].flatMap((a, j) => [R.stair - 0.02, R.r + 0.05].flatMap((r) => [ringPt(t, a, r, j ? y1 : y0), ringPt(t, a, r, Math.max(-0.1, (j ? y1 : y0) - 0.4))])), 'Pokrov tower stair'));
  }
  for (let i = 0; i < steps.length; i += 2) {
    const a0 = steps[i].a0, a1 = steps[Math.min(steps.length - 1, i + 1)].a1;
    out.push(hull([a0, a1].flatMap((a) => [R.rail, R.stair].flatMap((r) => [ringPt(t, a, r, Math.max(0, noseAt(t, a) - TOWER_ROOM.top / TOWER_ROOM.steps - R.slab)), ringPt(t, a, r, noseAt(t, a) + R.railUp)])), 'Pokrov tower stair'));
  }
  return out;
}
