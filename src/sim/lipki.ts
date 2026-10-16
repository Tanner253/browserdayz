// Lipki, the woodcutters' hamlet in the birch woods (2026-10-16, reworked): where its houses and what lies about them
// stand. Pure numbers, the same for the game and the server; in Lipki's own frame (x east, z south of its middle).
// The owner, of the first pass: "i am underhwlemed and not impressed witht he layouts. we want dyanmic gampelaty".
// It was five log houses far apart round an empty green. Now: one muddy lane from the north, the houses tight along
// both sides of it, each in a picket-fenced front garden with a gate on the lane (the fences make alleys, the
// gardens cover, the lane a shooting alley); wood stacked behind each house; at the lane's end the sawmill's yard, its
// log stacks laid out as the walls of a maze, some two high; the chapel on a knoll over the lane; three high seats at
// the wood's edge watching the ways in.

import type { SlabRun, Town, TownGround, TownSpot } from './towns';
import type { TownThing } from './zavod';

const PI = Math.PI, Q = PI / 2;

export const LIPKI: Town = { name: 'Lipki', x: -1180, z: 350, pad: [60, 100], rot: 0 };

/** a house along the lane: which side (-1 west, +1 east), how far south, what kind */
const HOUSES: { side: -1 | 1; z: number; type: 'izba' | 'izba_two' }[] = [
  { side: -1, z: -66, type: 'izba' }, { side: 1, z: -56, type: 'izba_two' },
  { side: -1, z: -46, type: 'izba_two' }, { side: 1, z: -35, type: 'izba' },
  { side: -1, z: -24, type: 'izba' }, { side: 1, z: -13, type: 'izba' },
  { side: -1, z: -2, type: 'izba' }, { side: 1, z: 10, type: 'izba_two' },
];
/** the kinds' size (along their front, and deep) and where their front door's middle is (along the front, from its middle) */
const KIND = { izba: { w: 8, d: 6.5, door: -1.9 }, izba_two: { w: 9, d: 8, door: -1.1 } };
/** how far the lane's fences and the houses' fronts stand from the lane's middle */
const FENCE_X = 4.5, FRONT_X = 11.5;
/** the knoll the chapel stands on: its middle, how far its foot reaches, how high its top, how wide its level top */
export const KNOLL = { x: -38, z: 30, r: 24, h: 3.5, top: 7 };

/** where a house's middle is, which way it faces (its front to the lane), and the world z of its door */
function house(h: (typeof HOUSES)[number]) {
  const k = KIND[h.type], x = h.side * (FRONT_X + k.d / 2);
  // (the west side faces east, a quarter turn; the east side west. A house's own x then runs south on the west side, north on the east)
  const rot = h.side < 0 ? Q : -Q;
  return { x, rot, door: h.z + h.side * k.door, k };
}

export function lipkiBuildings(): TownSpot[] {
  return [
    ...HOUSES.map((h) => {
      const { x, rot } = house(h);
      return { type: h.type, x, z: h.z, rot };
    }),
    // (its door, in the gable end on its own left, to the east: the path up from the lane)
    { type: 'chapel', x: KNOLL.x, z: KNOLL.z, rot: PI },
    // (the shed's open front to the yard south of it)
    { type: 'sawmill', x: 10, z: 50, rot: 0 },
    { type: 'tower', x: -46, z: -88, rot: 0.6 },
    { type: 'tower', x: 42, z: -30, rot: -Q },
    { type: 'tower', x: 34, z: 96, rot: PI },
  ];
}

/** a run of 2 m fence panels from a to b, with gaps (metres along it, from a: [from, to]) where a gate is left open */
function fence(kind: string, a: [number, number], b: [number, number], gaps: [number, number][] = []): TownThing[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 2)), step = len / n;
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len, rot = Math.atan2(-dz, dx), out: TownThing[] = [];
  for (let k = 0; k < n; k++) {
    const m = (k + 0.5) * step;
    if (gaps.some(([g0, g1]) => m > g0 && m < g1)) continue;
    out.push({ kind, x: a[0] + dx * m, z: a[1] + dz * m, rot });
  }
  return out;
}

export function lipkiThings(): TownThing[] {
  const out: TownThing[] = [];
  HOUSES.forEach((h, n) => {
    const { x, door, k } = house(h), s = h.side, half = k.w / 2 + 1.0;
    const kind = n % 3 === 1 ? 'fence_white' : 'fence_grey';
    // the front garden: along the lane with its gate at the door, and down each side to the house's front
    out.push(...fence(kind, [s * FENCE_X, h.z - half], [s * FENCE_X, h.z + half], [[door - (h.z - half) - 1.1, door - (h.z - half) + 1.1]]));
    for (const e of [-half, half]) out.push(...fence(kind, [s * FENCE_X, h.z + e], [s * (FRONT_X + 0.2), h.z + e]));
    // what grows in it, on the side of the path away from the door (drawn only from near: see `far` where it is set down)
    const away = door > h.z ? -1 : 1, gx = s * (FENCE_X + 2.2), gz = h.z + away * 2.6;
    if (n % 2 === 0) for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) out.push({ kind: (r + c + n) % 2 ? 'cabbage' : 'pumpkin', x: gx + s * r * 1.6, z: gz + away * c * 1.1, rot: (r * 3 + c) * 1.7 });
    else out.push({ kind: 'Barrel_01', x: gx, z: gz, rot: 0 }, { kind: 'wooden_crate_01', x: gx + s * 1.2, z: gz + away * 0.4, rot: 0.4 });
    // wood stacked against the back wall
    out.push({ kind: 'log_pile', x: x + s * (k.d / 2 + 1.9), z: h.z + (n % 2 ? 1.2 : -1.2), rot: 0 });
  });
  // the sawmill's yard: stacks of logs laid as walls, some two high, the ways between them turning
  const pile = (x: number, z: number, rot: number, two = false) => [{ kind: 'log_pile', x, z, rot }, ...(two ? [{ kind: 'log_pile', x, z, rot, up: 1.45 }] : [])];
  out.push(
    ...pile(-14, 64, Q), ...pile(-7.6, 64, Q, true), ...pile(6, 65, Q), ...pile(12.6, 64.6, Q, true),
    ...pile(-18, 76, 0, true), ...pile(-4, 75, Q, true), ...pile(3.4, 75.4, Q), ...pile(20, 74, 0, true),
    ...pile(-11, 86, Q), ...pile(8, 85, Q, true), ...pile(25, 86, Q),
    { kind: 'dead_tree_trunk', x: -24, z: 60, rot: 0.3 }, { kind: 'dead_tree_trunk', x: 29, z: 66, rot: 1.9 }, { kind: 'tree_stump_01', x: 15, z: 92, rot: 0.8 },
    { kind: 'Barrel_01', x: 19.4, z: 57.4, rot: 0 }, { kind: 'wooden_crate_01', x: -2.2, z: 57.0, rot: 0.2 },
  );
  return out;
}

/** the lane, the sawmill's yard trodden bare, the paths up the knoll; the gardens' beds dug */
export const LIPKI_GROUND: TownGround = {
  yards: [[-24, 54, 32, 94]],
  lanes: [
    { line: [[2, -104], [-1, -64], [2, -24], [0, 14], [-4, 40], [-8, 58]], w: 5 },
    { line: [[-3, 22], [-22, 28], [-32, 30]], w: 2.4 },
  ],
  beds: HOUSES.filter((_, n) => n % 2 === 0).map((h) => {
    const { door } = house(h), s = h.side, away = door > h.z ? -1 : 1, z0 = h.z + away * 1.8, z1 = h.z + away * 4.8;
    return [Math.min(s * (FENCE_X + 1.2), s * (FENCE_X + 5.6)), Math.min(z0, z1), Math.max(s * (FENCE_X + 1.2), s * (FENCE_X + 5.6)), Math.max(z0, z1)] as [number, number, number, number];
  }),
  mounds: [[KNOLL.x, KNOLL.z, KNOLL.r, KNOLL.h, KNOLL.top]],
};

/** (none: the hamlet has no walls) */
export const LIPKI_SLABS: SlabRun[] = [];
