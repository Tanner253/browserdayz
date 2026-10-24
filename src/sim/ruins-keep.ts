// The keep in Kalat's flat middle (2026-10-24, the owner: "in the ruins in the middle there a huge flat area it would
// be cool if we could make our own custom build there with ruins tiles, somethin cheap but dynamic with angles and
// loops and multiple routes ... make a complex FPS building with complex features in the middle there ... can be
// multiple stories. dont make it just a box, it should have some ruins aesthetic to it"), as the plan they said yes
// to draws it (marketing/plan-kalat-keep.html): three floors round an open atrium and a tower, of the town's own
// walls, floors, flights, beams and heaps. It stands on the land as it is (no ground of its own: see ruinsGround), set
// as high as the land under it reaches, so that no floor of it is under the ground.
//
// Its own measure: x east, z south, from its middle. Ways in: the arched gate (south), a breach over rubble (north-west),
// a postern (east), the tower's door (north), the stair up the west wall to the roof, the fallen south wall. Ways up:
// the rubble in the gate hall, a timber stair (west), the tower's stairs, a stone flight from the east hall to the
// tower. Loops: round the ground floor through the atrium's arches, and across the atrium on a bridge.

import { build, type Part, type V2, type V3 } from './ruins';

/** the floors: the ground (a sill over the land), the first floor, the roofs, the tower's top */
export const KEEP_L = [0.14, 3.8, 7.6, 11.4] as const;
/** the corners of its outer walls along their middle lines, and the tower's room (inside its walls) */
const P1: V2 = [-18, -4], P2: V2 = [-10, -15], P4: V2 = [18, -5], P5: V2 = [14, 12], P6: V2 = [-13, 14];
const TOWER = { x0: 7.4, z0: -17.8, x1: 14.6, z1: -10.6, thick: 1.4 };
const ROOM = { x0: 8.1, z0: -17.1, x1: 13.9, z1: -11.3 };
const ATRIUM: V2[] = [[-6, -6], [5, -7], [7, 3], [-5, 5]];
/** the rooms between the outer walls and the atrium, along the walls' middle lines */
const NORTH: V2[] = [[-13.6, -10.05], P2, [7.4, -15], [7.4, -10.6], [5, -7], [-6, -6]];
const WEST: V2[] = [P1, [-13.6, -10.05], [-6, -6], [-5, 5], [-6.6, 13.6], P6];
const EAST: V2[] = [[7.4, -10.6], [13.9, -10.6], P4, [16.02, 3.4], [7, 3], [5, -7]];
/** the ground floor inside the outer walls (the tower has its own) */
const INSIDE: V2[] = [P1, P2, [7.4, -15], [7.4, -10.6], [13.9, -10.6], P4, P5, P6];

const unit = (a: V2, b: V2): V2 => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
const at = (a: V2, d: V2, s: number, n: V2 = [0, 0], o = 0): V2 => [a[0] + d[0] * s + n[0] * o, a[1] + d[1] * s + n[1] * o];
const mid = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function keepParts(): Part[] {
  const { wall, opening, fallen, crenels, floor, flight, beam, post, heap, strewn, apron, rect } = build;
  const [L0, L1, L2, L3] = KEEP_L;
  const out: Part[] = [];
  const add = (...p: Part[]) => void out.push(...p);

  // ---- the outer walls: the north and west, which carry the roofs and their walk, and the east and south, broken down.
  // Each run ends inside the tower's walls, and the north-west one carries on round the south-west corner as far as
  // the wall of the west room, so that no corner is two ends meeting (which leaves a notch to the sky).
  const Q: V2 = [-6.2, 13.5], Qs: V2 = [-7, 13.56];
  const nw = wall([[7.6, -15], P2, P1, P6, Q], 1.6, -3, L2 + 1.4, { ruin: { seed: 911, bite: 0.9, floor: L2 + 0.5 }, batter: 0.25, name: 'keep north and west walls' });
  crenels(nw, 0.6, 56, 2.6, L2 + 0.9, 0.8);
  // the stair up the outside of the west wall comes up through the parapet; the breach in the north-west wall, over rubble
  const west = unit(P6, P1), outward: V2 = [-0.964, 0.268];
  const head = at(P6, west, 16);
  opening(nw, head[0], head[1], 1.5, L2, 99);
  opening(nw, -15.6, -7.3, 3.4, 0.6, 3.2);
  for (const [x, z, lo] of [[-5, -15, true], [2, -15, true], [-5, -15, false], [3.5, -15, false], [-16.8, -5.65, true], [-15.1, 7, false], [-16.6, -1, false]] as [number, number, boolean][]) opening(nw, x, z, 0.5, lo ? 1.1 : L1 + 0.9, lo ? 2.3 : L1 + 2.1);
  const se = wall([[13.6, -11], P4, P5, Qs], 1.6, -3, [[0, 6.6], [24, 6.0], [27.5, 5.6], [46, 5.6]], { ruin: { seed: 913, bite: 1.6, floor: L1 + 0.8 }, batter: 0.25, name: 'keep east and south walls' });
  // the gate; the postern; where the south wall has fallen, down to a scramble over it
  opening(se, 3.5, 12.78, 3.4, L0, 4.0, true);
  opening(se, 17.06, -1, 1.2, L0, 2.3);
  fallen(se, [10, 12.3], [12.6, 12.1], 1.0, 1.4);
  for (const [x, z, lo] of [[17.6, -3, true], [15.2, 7, false], [-2, 13.3, true], [8, 12.4, false]] as [number, number, boolean][]) opening(se, x, z, 0.5, lo ? 1.1 : L1 + 0.9, lo ? 2.3 : L1 + 2.1);
  add(nw, se);

  // ---- the tower: four floors, a stair up three walls in turn, a door out to the north, into the keep, onto each floor
  {
    const T = TOWER, R = ROOM;
    const t = wall(rect(T.x0, T.z0, T.x1, T.z1), T.thick, -3, L3 + 1.2, { closed: true, ruin: { seed: 917, bite: 0.6, floor: L3 + 0.9 }, batter: 0.3, name: 'keep tower' });
    crenels(t, 0, 28.8, 1.8, L3 + 0.7, 0.75);
    opening(t, 10.5, T.z0, 1.1, L0, 2.3);
    opening(t, 10, T.z1, 1.1, L0, 2.3);
    opening(t, 10, T.z1, 1.1, L1, L1 + 2.2);
    opening(t, 12.2, T.z1, 1.2, L2, L2 + 2.2);
    opening(t, T.x0, -13.6, 1.1, L2, L2 + 2.2);
    for (const [x, z, y] of [[T.x1, -14.5, L1 + 1], [T.x1, -14.5, L2 + 1], [12.6, T.z0, L2 + 0.9], [T.x0, -16, L1 + 1]] as V3[]) opening(t, x, z, 0.5, y, y + 1.2);
    add(t);
    // (the stairs: up the east wall to the first floor, along the north wall to the second, along the south to the top)
    // (each with room to step onto it from before its foot, and to step off its head: walked, 2026-10-24)
    const f1: [V3, V3] = [[13.35, L0, -12.4], [13.35, L1, -16.4]];
    const f2: [V3, V3] = [[12.9, L1, -16.6], [8.6, L2, -16.6]];
    const f3: [V3, V3] = [[9.1, L2, -11.85], [13.2, L3, -11.85]];
    add(floor(rect(R.x0, R.z0, R.x1, R.z1), L0, 'paving', { name: 'tower floor' }));
    add(floor(rect(R.x0, R.z0, R.x1, R.z1), L1, 'timber', { holes: [rect(12.85, -16.4, R.x1, -13.8)], under: 0.12, near: true, name: 'tower floor 1' }));
    add(floor(rect(R.x0, R.z0, R.x1, R.z1), L2, 'timber', { holes: [rect(8.6, R.z0, 11.3, -16.05)], under: 0.12, near: true, name: 'tower floor 2' }));
    add(floor(rect(R.x0, R.z0, R.x1, R.z1), L3, 'timber', { holes: [rect(10.63, -12.4, 13.2, R.z1)], under: 0.12, near: true, name: 'tower top' }));
    add({ ...flight(...f1, 0.9, 'timber'), near: true, name: 'tower stair 1' }, { ...flight(...f2, 0.9, 'timber'), near: true, name: 'tower stair 2' }, { ...flight(...f3, 0.9, 'timber'), near: true, name: 'tower stair 3' });
    add(apron([9.9, T.z0 - 1], [11.1, T.z0 - 1], [0, -1], L0, 0.45));
  }

  // ---- the atrium: open to the sky, a low wall round it that is the first floor's parapet, two arches through it on
  // the ground and a gap each side at the first floor where the bridge crosses
  {
    const a = wall(ATRIUM, 0.8, -3, L1 + 1.1, { closed: true, cap: 'paving', name: 'atrium' });
    opening(a, ...mid(ATRIUM[0], ATRIUM[1]), 2.4, L0, 3.0, true);
    opening(a, ...mid(ATRIUM[2], ATRIUM[3]), 2.4, L0, 3.0, true);
    opening(a, -5.5, -0.5, 1.7, L1, 99);
    opening(a, 6, -2, 1.7, L1, 99);
    add(a, floor(ATRIUM, L0, 'sand', { name: 'atrium floor' }));
    // the bridge: boards on two beams, wall to wall, nothing to hold on to
    const d = unit([-5.5, -0.5], [6, -2]), n: V2 = [-d[1] * 0.75, d[0] * 0.75], w0: V2 = [-5.9, -0.45], w1: V2 = [6.4, -2.05];
    add(floor([[w0[0] + n[0], w0[1] + n[1]], [w1[0] + n[0], w1[1] + n[1]], [w1[0] - n[0], w1[1] - n[1]], [w0[0] - n[0], w0[1] - n[1]]], L1, 'timber', { under: 0.12, near: true, name: 'bridge' }));
    for (const k of [-0.5, 0.5]) add({ ...beam([w0[0] + n[0] * k, L1 - 0.22, w0[1] + n[1] * k], [w1[0] + n[0] * k, L1 - 0.22, w1[1] + n[1] * k], 0.2, 0.2), near: false });
    // beams of a lost roof, lying on the atrium's wall from side to side, either side of the bridge
    for (const [a0, a1] of [[[-6.1, -4.3], [5.65, -5]], [[-5.45, 2.9], [7.1, 2.2]]] as [V2, V2][]) add({ ...beam([a0[0], L1 + 1.12, a0[1]], [a1[0], L1 + 1.12, a1[1]], 0.24, 0.26), near: false });
  }

  // ---- the walls between the rooms, each with a door on the ground; on the first floor the north hall's doors west and east
  {
    const room = (a: V2, b: V2, top: number, doors: number[], name: string) => {
      const w = wall([a, b], 0.8, -3, top, { name });
      const m = mid(a, b);
      for (const y of doors) opening(w, m[0], m[1], 1.2, y, y + 2.2);
      return w;
    };
    add(room([-6, -6], [-13.6, -10.05], L2 - 0.05, [L0, L1], 'keep wall north-west'));
    add(room([5, -7], [7.4, -10.6], L2 + 1, [L0, L1], 'keep wall north-east'));
    add(room([-5, 5], [-6.6, 13.6], L2 + 1, [L0], 'keep wall south-west'));
    // (the one between the gate hall and the east hall: broken down to the first floor where what fell of it lies against
    // it, a ramp of rubble up from the gate hall, which is the way up onto the first floor: a heap as high is too steep to
    // walk at its foot, so it is a slope of earth with the heaps either side)
    const e = wall([[7, 3], [16.02, 3.4]], 0.8, -3, L1 + 1, { ruin: { seed: 925, bite: 0.4, floor: L1 + 0.6 }, name: 'keep wall east' });
    fallen(e, [8.2, 3.15], [11, 3.28], L1 - 0.1, 0.6);
    opening(e, 14.4, 3.33, 1.2, L0, L0 + 2.2);
    add(e, { t: 'slab', p: [[8.5, L1, 3.6], [8.5, L0, 9.8], [10.7, L0, 9.8], [10.7, L1, 3.6]], thick: 0.6, paint: 'earth', name: 'keep rubble ramp' });
    add(heap(7.1, 5.4, L0, 1.6, 2.6, 2.2, 931), heap(12.1, 5.1, L0, 1.4, 2.4, 2.5, 932), heap(9.6, 0.9, L0, 2.6, 2.0, 1.4, 934));
  }

  // ---- the floors: the ground; the first floor over the north, west and east rooms (the gate hall's fell in); the roofs
  // over the north and west, on posts along the atrium, with a rail; the east roof is gone
  add(floor(INSIDE, L0, 'paving', { holes: [ATRIUM], name: 'keep floor' }));
  add(floor(NORTH, L1, 'paving', { under: 0.3, name: 'keep north hall' }));
  add(floor(WEST, L1, 'timber', { holes: [rect(-12.45, -1.8, -11.35, 1.3)], under: 0.15, name: 'keep west gallery' }));
  add(floor(EAST, L1, 'paving', { under: 0.3, name: 'keep east hall' }));
  add(floor(NORTH, L2, 'paving', { under: 0.3, name: 'keep north roof' }), floor(WEST, L2, 'paving', { under: 0.3, name: 'keep west roof' }));
  for (const [a, b] of [[[-6, -6], [5, -7]], [[-5, 5], [-6, -6]]] as [V2, V2][]) {
    const d = unit(a, b), len = Math.hypot(b[0] - a[0], b[1] - a[1]), n: V2 = [d[1], -d[0]];
    // (the posts just inside the roof's edge, clear of the atrium's wall and its arches)
    for (const s of [0.9, len / 2 + 2.1, len - 0.9]) {
      const p = at(a, d, s, n, 0.65);
      add(post(p[0], p[1], L1, L2 - 0.3));
    }
    const r0 = at(a, d, 0.3, n, 0.3), r1 = at(a, d, len - 0.3, n, 0.3);
    add({ t: 'rail', a: [r0[0], L2, r0[1]], b: [r1[0], L2, r1[1]], paint: 'timber', near: true });
  }

  // ---- the stairs: timber up from the west room; stone from the east hall up to the tower's door; stone up the outside
  // of the west wall to the roof
  add({ ...flight([-11.9, L0, 3.2], [-11.9, L1, -1.8], 1.0, 'timber'), near: true, name: 'keep west stair' });
  add({ ...flight([12.2, L1, -3.4], [12.2, L2, -9.9], 1.2, 'stone', L1 - 0.05), name: 'keep east flight' });
  const foot = at(P6, west, 2.5, outward, 1.8), top = at(P6, west, 16, outward, 1.8);
  add({ ...flight([foot[0], 0, foot[1]], [top[0], L2, top[1]], 1.4, 'stone'), name: 'keep outside stair' });

  // ---- ways in from outside: a tread at the gate and the postern for the ground outside, rubble at the breach and the fall
  add(apron([1.7, 13.8], [5.3, 13.53], [0.074, 0.997], L0, 0.45, 1.1));
  {
    const d = unit(P4, P5), n: V2 = [d[1], -d[0]], c = at([17.06, -1], n, 1.05);
    add(apron(at(c, d, -0.7), at(c, d, 0.7), n, L0, 0.45, 1.1));
  }
  // (each heap as high as the sill it leads to, its top against the wall's face, and gentle enough to walk at its foot)
  add(heap(-16.45, -7.92, 0, 2.5, 2.5, 0.62, 933), heap(-14.95, -6.83, L0, 2.2, 2.2, 0.48, 935));
  add(heap(11.35, 13.3, 0, 2.8, 3, 1.05, 937), heap(11.3, 11.4, L0, 2.4, 2.6, 0.9, 939));
  add(...strewn(12, 16, 0, 7, 3.5, 941), ...strewn(-19, -9, 0, 5, 3, 943), ...strewn(9, 7, L0, 5, 3, 945), ...strewn(13.5, -4, L1, 5, 2.5, 947), ...strewn(20, 4, 0, 4, 3, 949), ...strewn(-4, -17.5, 0, 4, 3, 951));
  return out;
}

/** where things lie in it: [x, z, floor, what kind of place, kept armed] (src/sim/ruins.ts lootSpots) */
export const KEEP_LOOT: [number, number, number, 'dig' | 'camp' | 'nest', ('guns' | 'any')?][] = [
  // the tower: its top a rifleman's nest, its floors under it
  [9.6, -14.6, KEEP_L[3], 'nest', 'guns'], [12.6, -14.2, KEEP_L[2], 'nest'], [9.4, -14.2, KEEP_L[1], 'camp'],
  // the roofs and the first floor
  [-2, -12, KEEP_L[2], 'nest'], [-12.6, 8, KEEP_L[2], 'camp'], [0, -11.5, KEEP_L[1], 'nest'], [-9.6, 9, KEEP_L[1], 'camp'], [15, -6.5, KEEP_L[1], 'nest'],
  // the ground: the store, the guard room's camp, the gate hall, the atrium, the stair hall
  [-1, -12, KEEP_L[0], 'dig'], [-12.4, 9.4, KEEP_L[0], 'camp', 'any'], [-1.5, 10, KEEP_L[0], 'camp'], [1, -1, KEEP_L[0], 'dig'], [14.4, -6.2, KEEP_L[0], 'dig'],
];
/** what stands in it off the shelf: [what, x, z, floor (null: the ground), turned] (src/sim/ruins.ts stood) */
export const KEEP_STOOD: [string, number, number, number | null, number][] = [
  ['weapons_case', 9.4, -16.2, KEEP_L[3], 0.2], ['wooden_crate_01', -6.4, -12.6, KEEP_L[2], 0.4], ['old_military_crate', 3.2, -12.4, KEEP_L[1], 1.4],
  ['stone_fire_pit', -10.8, 7.8, KEEP_L[0] + 0.19, 0], ['wooden_crate_01', -3, 11.2, KEEP_L[0], 0.7], ['crate_big', 15.4, -9, KEEP_L[0], 0.3],
];
/** how far round the keep its ground reaches (what is near it, and what is on it: the server's own questions) */
export const KEEP_FOOT: V2[] = [[-24, -5], [-11, -20.5], [16, -20.5], [22.5, -6], [18, 18], [-15, 18], [-22, 14]];
