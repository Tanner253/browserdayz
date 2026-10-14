// Questions asked of the fort at a point: under it, in its dark, what it cuts out of the ground, what it hides, its foot; and where the world set its loose pieces.
// (One part of castle.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import type { Place } from '../bunker';
import { KIT_LEVELS } from '../kit';
import { CASTLE, CASTLE_SCALE, FAN, OUTCROP, UNDER, castleAt, castleGround, castleLocal, clamp01, towerRadius } from './plan';
import { WALL } from './parts';
import type { GroundAt } from './loot';
import { LOOSE, hatchLine, hatchWell, hatchWells, inCellar, shaftWell, type Loose } from './loose';

/**
 * Whether a place is in the fort's lower levels, or in the passage out of them to a hatch: where a body is under
 * the terrace, and may be under the ground, by right. (The server's rule against being under the ground excuses
 * it, as it excuses the bunker: see `underCheck` in server/index.ts.)
 *
 * ONLY WHERE THERE IS A PLACE TO BE (2026-10-13). It is asked of where a body's feet are, and it says yes only in
 * what was built to be stood in: between a floor and the roof over it, inside the walls of it, with half a pace
 * and a step's height to spare and no more. It said yes anywhere under the fort's plan down to a metre under the
 * deepest floor, and a body sunk in the earth under the armoury, where nothing can reach it, was excused with the
 * rest. The places are: the lower levels themselves from their floor up (the cistern's is a knee lower); the slot of
 * the stair down to the sally port, from the stair's own slope up; the cellar in the hollow tower; the postern's
 * doorway and its landing; each hatch's steps, from their own slope up to the ground; and each straight length of
 * its passage, from its own floor (which climbs) to its roof.
 * @param ground the height of the world's ground at a spot, as it was before anything was cut for the fort (the passage is made to the hatch's depth)
 */
export function castleUnder(p: Place | null, wx: number, wy: number, wz: number, ground?: GroundAt, loose?: Loose[]): boolean {
  if (!p) return false;
  const [x, z, y] = castleLocal(p, wx, wy, wz), U = UNDER, H = U.hatch, PS = U.postern, CI = U.cistern;
  /** half a pace beyond a wall's face (every wall of it is thicker than that), and a step's height under a floor */
  const SIDE = 0.45, STEP = 0.6;
  if (y < -0.6 && Math.abs(x) < U.x + SIDE && Math.abs(z) < U.z + SIDE) {
    // (what is underfoot there: the slope of the stair down and its landing, in their slot; the cistern's floor; the floor)
    let floor = U.floor;
    if (x > PS.x0 - SIDE && z > PS.head - SIDE && z < PS.end + 0.25 + SIDE) floor = U.floor + (PS.deep - U.floor) * clamp01((z + SIDE - PS.head) / (PS.foot - PS.head));
    else if (x < CI.x1 + SIDE && z < CI.z1 + SIDE) floor = U.floor - CI.deep;
    if (y > floor - STEP) return true;
  }
  if (inCellar(x, y, z)) return true;
  // (the postern's doorway through the west wall's foot, and the landing outside it)
  if (y > U.floor - STEP && y < U.floor + 2.4 && x < -U.x + SIDE && x > -CASTLE.hx - CASTLE.parapet.thick / 2 - WALL.out - 1.25 - SIDE && z > U.goat.z0 - 0.1 - SIDE && z < U.goat.z1 + 0.1 + SIDE) return true;
  for (const l of looseLocal(p, loose ?? castleLoose(p))) {
    if (l.kind !== 'hatch') continue;
    const [hx, , hz] = castleAt(p, l.x, l.z), g = ground ? (ground(hx, hz) - p.y) / CASTLE_SCALE : castleGround(l.x, l.z), L = hatchLine(l, g);
    // (on its steps: how far along them from their head, and how far off their line; from the steps' own slope up to the ground)
    const ax = x - L.head[0], az = z - L.head[2], along = ax * L.d[0] + az * L.d[1], off = Math.abs(ax * L.r[0] + az * L.r[1]);
    // (the stairwell is open as far as half a pace past their foot: see `looseParts`)
    if (along > -0.5 && along < H.run + 0.5 + SIDE && off < H.wide / 2 + SIDE && y < g + 0.6 && y > g - H.drop * clamp01((along + SIDE) / H.run) - STEP) return true;
    // (in its passage: within its width of one of its straight lengths, between its floor there and its roof)
    for (let k = 0; k + 1 < L.path.length; k++) {
      const a = L.path[k], b = L.path[k + 1], ex = b[0] - a[0], ez = b[2] - a[2], t = clamp01(((x - a[0]) * ex + (z - a[2]) * ez) / (ex * ex + ez * ez)), floor = a[1] + (b[1] - a[1]) * t;
      if (Math.hypot(x - a[0] - ex * t, z - a[2] - ez * t) < H.wide / 2 + SIDE && y > floor - STEP && y < floor + H.tall + 0.4) return true;
    }
  }
  return false;
}

/**
 * How dark it is at a place for being under the fort: 0 in the open and anywhere above, 1 in the lower levels and
 * the passage, and less than that near where the day gets in (the fallen bay and the hole over the cistern most of
 * all, and the rent; the stair from the store, the gratings and the hole in the tower a little; the hatch's
 * steps). As the bunker's is: whoever draws the world puts out so much of the sun and the sky for an eye that is there.
 */
export function castleDark(p: Place | null, wx: number, wy: number, wz: number, ground?: GroundAt, loose?: Loose[]): number {
  if (!p || !castleUnder(p, wx, wy, wz, ground, loose)) return 0;
  const [x, z, y] = castleLocal(p, wx, wy, wz), U = UNDER, B = U.bay, D = U.cistern.drop;
  if (x < -U.x - 0.7) return inCellar(x, y, z) ? clamp01((-y - 0.8) / 1.4) * 0.75 : 0.3;
  if ((Math.abs(x) > U.x + 0.7 || Math.abs(z) > U.z + 0.7) && !inCellar(x, y, z)) {
    // in the passage: dark, but for the last of it under the hatch
    let near = Infinity;
    for (const l of looseLocal(p, loose ?? castleLoose(p))) if (l.kind === 'hatch') near = Math.min(near, Math.hypot(x - l.x, z - l.z));
    return clamp01((near - 1.5) / 5);
  }
  const deep = clamp01((-y - 0.8) / 1.4), off = (x0: number, x1: number, z0: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  let lit = 1 - clamp01(off(B.x0, B.x1, B.z0, B.z1) / 6);
  lit = Math.max(lit, 1 - clamp01(off(D.x0, D.x1, D.z0, D.z1) / 9));
  lit = Math.max(lit, 0.45 * (1 - clamp01(off(U.stair.head, U.stair.open, U.stair.z - 0.5, U.stair.z + 0.5) / 3.5)));
  lit = Math.max(lit, 1 - clamp01(off(U.x - 0.5, U.x + 2, U.rent.z0, U.rent.z1) / 6));
  lit = Math.max(lit, 0.6 * (1 - clamp01(off(-U.x - 1, -U.x, U.goat.z0, U.goat.z1) / 3)));
  for (const [gx, gz] of U.gratings) lit = Math.max(lit, 0.3 * (1 - clamp01(Math.hypot(x - gx, z - gz) / 2.5)));
  lit = Math.max(lit, 0.35 * (1 - clamp01(Math.hypot(x + CASTLE.hx, z + CASTLE.hz) / 3)));
  return deep * (1 - 0.8 * lit);
}

/**
 * What whoever shapes the mountain must do to the ground for the fort, and nothing else of the ground is touched.
 * One thing, for each piece of the plan this gives (`well`: its four corners in the world, [x, z]): the ground
 * LOWERED to `to` or under at every corner of every square of its grid that the piece touches (`squareTouches`
 * says which). They are: the slot of the stair down to the sally port, inside the walls; and for each hatch its
 * stairwell and a strip along each straight length of its passage. Ground is a skin with nothing under it: a body
 * goes through it only where it has been taken away, and a passage that leaves a place where it was taken away
 * meets it again a square further on, slanting down across its way. So it is taken away along the whole of what
 * is under the ground, as the bunker's is over the whole of its pit.
 *
 * What is lowered is covered. Inside the walls the fort covers it. Outside them the hatch lays the ground's own
 * earth over all of it, at the height the ground HAD (drawn with the ground's own paint: `earth`, to CastleSite)
 * out to `UNDER.hatch.lid` from each piece, which is as far as lowering those corners can disturb ground of
 * two-metre squares. So `ground`, here and wherever the fort is given it, is the ground AS IT WAS BEFORE this:
 * what the hatch stands at, what its earth lies at, and what everything of the fort's grounds stands on.
 *
 * Nothing is levelled. The lower levels themselves stand over the ground: only the ground under the terrace,
 * inside the walls, must be nowhere higher than the foot the fort assumes (`CASTLE.foot`: 5.8 m under the terrace
 * at the least), which is two metres under their floor.
 */
export function castleCuts(p: Place, ground?: GroundAt, loose?: Loose[]): { well: [number, number][]; to: number }[] {
  const PS = UNDER.postern, to = (q: [number, number][]) => q.map(([x, z]): [number, number] => [castleAt(p, x, z)[0], castleAt(p, x, z)[2]]);
  const U = UNDER, S = CASTLE_SCALE, out = [{ well: to(shaftWell()), to: p.y + S * (PS.deep - 0.9) }];
  for (const l of looseLocal(p, loose ?? castleLoose(p))) {
    if (l.kind !== 'hatch') continue;
    const [hx, , hz] = castleAt(p, l.x, l.z), g = ground ? (ground(hx, hz) - p.y) / CASTLE_SCALE : castleGround(l.x, l.z);
    for (const w of hatchWells(l, g)) out.push({ well: to(w.well), to: p.y + S * w.to });
  }
  // (And, last, the lower levels themselves, to under their floor. They are made to stand over the ground, inside
  // the fort's own base, and where the ground is as low as the fort assumes this lowers nothing: a cut is "to here
  // or under". On the side of the gate a hill may stand higher than their floor: there, and only there, it is let
  // down, and the fort's base covers it.)
  out.push({ well: to([[-(U.x + 0.7), -(U.z + 0.7)], [U.x + 0.7, -(U.z + 0.7)], [U.x + 0.7, U.z + 0.7], [-(U.x + 0.7), U.z + 0.7]]), to: p.y + S * (U.floor - U.cistern.deep - 0.75) });
  return out;
}

/** Whether a square of ground (its lowest corner [x, z] and its size, in the world) touches a four-cornered piece of the plan: for whoever makes the cut `castleCuts` asks for. */
export function squareTouches(well: [number, number][], x: number, z: number, size: number): boolean {
  // (two shapes with no dent in them are apart only if some side of one of them has all of the other beyond it)
  const sq: [number, number][] = [[x, z], [x + size, z], [x + size, z + size], [x, z + size]];
  for (const [a, b] of [[well, sq], [sq, well]]) for (let k = 0; k < a.length; k++) {
    const [px, pz] = a[k], [qx, qz] = a[(k + 1) % a.length], nx = qz - pz, nz = px - qx;
    const side = (pts: [number, number][]) => pts.map(([vx, vz]) => (vx - px) * nx + (vz - pz) * nz);
    const own = side(a), other = side(b);
    if (Math.max(...own) <= 1e-9 ? Math.min(...other) > 1e-9 : Math.max(...other) < -1e-9) return false;
  }
  return true;
}

/**
 * The fort's place as a world says it: where its middle is, how high its terrace, how it is turned; and, where the
 * world has set them down itself, what only the ground it stands on can say:
 *   loose  – its loose pieces, each where that ground suits (in the world: see `castleLoose`). Unsaid, they stand
 *            where the plan has them, on the ground the fort assumes.
 *   before – the open ground before its gate, where the garrison's dead stand ([x, z] in the world). Unsaid, the plan's.
 *   rock   – false: the ramp lands on ground of the land's own, and the rock it leaves from in the plan is not made
 *            (the owner, 2026-10-13: "get rid of the rocks near the front draw bridge ... make our own terrain").
 *   lid    – what its cuts left of the ground's own net (see `FortLid`). Unsaid: the fort lays earth of its own
 *            over what is cut, on squares of its own measure (the fort's own page, whose ground is laid square to it).
 */
export type FortPlace = Place & { loose?: Loose[]; before?: [number, number]; rock?: boolean; lid?: FortLid };

/**
 * ONE GROUND OVER WHAT IS CUT (the owner, 2026-10-13: "the ground also has overlapping textures and physics because
 * of the tunnel under ground"). The ground is let down under the fort's passage (`castleCuts`), and something must
 * be seen and stood on where it was. That is the ground ITSELF, on its own net: whoever draws the ground draws
 * every square listed here at the height it had (`seenGround`, in the world's generator), with the ground's own
 * snow, paint and grass, and the fort lays nothing over it. What the fort adds is only what the ground cannot do:
 *   - under each square listed, what stops a body: the ground's collider is a skin that is let down there, so the
 *     fort stands earth under each half of the square, its top exactly where the ground is drawn. SOLID EARTH: down
 *     past the cut (`low`: the lowest any corner of the square was let down to), so that there is no room under the
 *     ground that is not a room of the plan (measured, 2026-10-13: 92 m2 of standing room between a thin lid and
 *     the cut ground, beside the passage); and over the passage itself, down to the top of its roof;
 *   - in a square that is `open` (a hatch's stairwell opens in it), the ground draws nothing and the fort draws the
 *     square round the well, on the ground's own corners and cut corner to corner as the ground is.
 * `squares`: every square of the net (its lowest corner [x, z] in the world, `cell` metres a side) that has a corner
 * that was let down and is not wholly under the fort's own stone (`castleHides`).
 */
export interface FortLid { cell: number; squares: { x: number; z: number; open: boolean; low: number }[] }

/**
 * Whether a spot of the ground is under the fort's own stone or inside its walls, where nobody sees the ground:
 * within the outer faces of its walls (which lean: the face as it is at the height the ground has there; under
 * the kit's wall, the footing's) or of a tower's foot. A hand's breadth short of the face: what lies in the face
 * itself counts as seen.
 * @param wy how high the ground is there
 */
export function castleHides(p: Place, wx: number, wy: number, wz: number): boolean {
  const [x, z, y] = castleLocal(p, wx, wy, wz), C = CASTLE, SEEN = 0.12;
  const out = y < -KIT_LEVELS.walk ? WALL.out + 0.12 : Math.min(WALL.out, Math.max(0, -y) / C.lean);
  if (Math.abs(x) < C.hx + C.parapet.thick / 2 + out - SEEN && Math.abs(z) < C.hz + C.parapet.thick / 2 + out - SEEN) return true;
  return Math.hypot(Math.abs(x) - C.hx, Math.abs(z) - C.hz) < towerRadius(y) - SEEN;
}

/** Each hatch's stairwell as a hole in the world's ground: its four corners [x, z], in order round it, kerb and all. (Open to the sky: nothing of the ground is drawn or stood on over it.) */
export function castleOpen(p: FortPlace, loose?: Loose[]): [number, number][][] {
  return looseLocal(p, loose ?? castleLoose(p)).filter((l) => l.kind === 'hatch').map((l) => hatchWell(l, 0).map(([x, z]): [number, number] => [castleAt(p, x, z)[0], castleAt(p, x, z)[2]]));
}

/**
 * How far outside the fort's foot a spot of the world is, in metres (nothing or less: under it). Its foot is all
 * of the plan that stands on the ground: the walls and the towers' feet, the ramp and where it lands, the rubble
 * under the breach, the stone of the fallen wall, and the back door's landing and stair. For whoever must keep
 * the ground about it clear, or measure the land round it.
 */
export function castleFoot(p: Place, wx: number, wz: number): number {
  const [x, z] = castleLocal(p, wx, 0, wz), C = CASTLE, ex = C.hx + C.parapet.thick / 2 + WALL.out, ez = C.hz + C.parapet.thick / 2 + WALL.out, G = UNDER.goat;
  const rect = (x0: number, x1: number, z0: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)) + Math.min(0, Math.max(x0 - x, x - x1, z0 - z, z - z1));
  let d = rect(-ex - 0.12, ex + 0.12, -ez - 0.12, ez + 0.12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) d = Math.min(d, Math.hypot(x - sx * C.hx, z - sz * C.hz) - towerRadius(C.foot.south));
  // (the ramp, and seven metres of the plan beyond its foot: where the rock's top was; the rubble; the fallen wall's stone; the back door)
  d = Math.min(d, rect(ex, OUTCROP.x1, OUTCROP.z0, OUTCROP.z1), rect(FAN.end - 3, FAN.foot + 2, -ez - FAN.wide - 5.5, -ez), rect(ex, 17.7, UNDER.postern.end + 0.35, UNDER.rent.z1 + 4.2), rect(-ex - 1.25, -ex, G.z0 - 0.1, G.z1 + 5.6));
  return d * CASTLE_SCALE;
}

/** The loose pieces as the world has them: where each stands in the world. (Where the world has not said, where the plan has them.) */
export function castleLoose(p: FortPlace): Loose[] {
  if (p.loose) return p.loose;
  return LOOSE.map((l) => {
    const [x, , z] = castleAt(p, l.x, l.z);
    return { ...l, x, z, rot: l.rot + p.rot };
  });
}

/** Loose pieces said by where they stand in the world, in the fort's own measure. */
export function looseLocal(p: Place, loose: Loose[]): Loose[] {
  return loose.map((l) => {
    const [x, z] = castleLocal(p, l.x, 0, l.z);
    return { ...l, x, z, rot: l.rot - p.rot };
  });
}
