// What each piece is made of, as solids in its own frame (2026-10-24): boxes, upright prisms and a few hulls, the same
// list drawn by the game (src/game/building/draw.ts) and made into what stops a body and a bullet. Its frame: +z is
// the way it faces (a wall's outside), +x along it, y up from its foot (a floor-like piece: down from its top).
// Built cheap by design: a wall is one box, a doorway three.

import { CELL, FLOOR_T, FOUND, FREE, PIECES, STOREY, WALL_T } from './pieces';

export type Solid = (
  /** a box: its middle and its size */
  | { box: [number, number, number, number, number, number] }
  /** an upright prism: its outline on the ground (x, z) from y0 to y1 */
  | { prism: [number, number][]; y0: number; y1: number }
  /** the hull of these points */
  | { hull: [number, number, number][] }
) & {
  /** a shade its paint is drawn darker or lighter in (a strap's iron, a rivet's): white, none */
  c?: number;
};

/**
 * What a piece is drawn in: a tier's paint, or one of its own. The navigator, 2026-10-24, of a shut door that was the
 * wall's own planks: "Give every leaf what makes it one ... planks of a different shade ... the metal door its own
 * plate and rivets". A wooden door is painted boards, a metal one a plate of painted steel, a garage door galvanised
 * sheet; an opening's frame is dark timber; the claim's flag is cloth.
 */
export type Paint = 0 | 1 | 2 | 3 | 4 | 'door' | 'steel' | 'galv' | 'trim' | 'flag' | 'bag' | 'iron';

export interface Shape {
  /** what stops a body and a bullet, and is drawn */
  solid: Solid[];
  /** drawn, and stops nothing (a foundation's posts into the ground, a high wall's sharpened tops) */
  dress?: Solid[];
  /** a paint of its own (none: its tier's) */
  paint?: Paint;
  /** drawn in another paint, and stops nothing (an opening's frame, the claim's flag) */
  cloth?: { paint: Paint; solid: Solid[] };
  /** what swings (a door's leaves, a gate's, a hatch's lid, shutters) */
  leaves?: Leaf[];
  /** a ladder's line, climbed (src/game/building/ladders.ts): where it stands, its foot and top, and the way out from its rungs to whoever climbs it */
  climb?: { x: number; z: number; y0: number; y1: number; out: [number, number] };
  /** where a flame burns on it (a wall torch: src/game/building/torches.ts) */
  flame?: [number, number, number];
  /** where a lock fitted to it is seen: on a leaf (its frame) or on the piece, facing +z, or lying face up (a hatch's) */
  lockAt?: { leaf?: number; at: [number, number, number]; up?: boolean };
  /** drawn by a model of its own elsewhere (crafting's forge: src/game/craft-forge.ts): here it only stops things */
  unseen?: true;
}

/**
 * A part that swings on a hinge, solid at every angle (the owner: "doors that swing open 1 way with collision"). Its
 * solids are in the hinge's own frame, hung shut; it turns about the hinge's line (`axis`) by `open` radians to stand
 * open, the sign saying which way. `paint`: a tier of its own to be drawn in (a stone gate's leaves are metal).
 */
export interface Leaf {
  hinge: [number, number, number];
  axis: 'x' | 'y';
  open: number;
  solid: Solid[];
  dress?: Solid[];
  paint?: Paint;
  /** its ironwork (straps, hinges, handles), drawn in iron of its own: made from what of its dress is shaded IRON (`ironOf`) */
  iron?: Solid[];
}

const H = CELL / 2;
/** a wall's length: a hand past its edge each end, so that two meeting at a corner close it */
const LONG = CELL + WALL_T;
/** a doorway's opening: half its width and its height, m (a door fills it) */
const DOORWAY = { half: 0.65, high: 2.3 };
const TRI = (y0: number, y1: number, shrink = 0): Solid => {
  const R = CELL / Math.sqrt(3) - shrink;
  return { prism: [2, 6, 10].map((a) => [Math.sin((a * Math.PI) / 6) * R, Math.cos((a * Math.PI) / 6) * R]), y0, y1 };
};
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid => ({ box: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0] });
const wallBox = (x0: number, y0: number, x1: number, y1: number) => box(x0, y0, -WALL_T / 2, x1, y1, WALL_T / 2);

/** steps of a flight: `n` of them over [a, b] along one way, rising from `y0` to `y1`, each solid to the floor */
function flight(n: number, across: [number, number], along: [number, number], y0: number, y1: number, alongX: boolean): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = along[0] + ((along[1] - along[0]) * i) / n, t1 = along[0] + ((along[1] - along[0]) * (i + 1)) / n;
    const top = y0 + ((y1 - y0) * (i + 1)) / n;
    const [a0, a1] = [Math.min(t0, t1), Math.max(t0, t1)];
    out.push(alongX ? box(a0, 0, across[0], a1, top, across[1]) : box(across[0], 0, a0, across[1], top, a1));
  }
  return out;
}

const SHAPES: Record<string, () => Shape> = {
  // (a block reaching down into the ground however the ground falls away under it, its slab's edge standing proud)
  foundation: () => ({ solid: [box(-H, -FOUND.deep - FOUND.skirt, -H, H, 0, H)], dress: [box(-H - 0.04, -0.14, -H - 0.04, H + 0.04, 0, H + 0.04)] }),
  foundation_tri: () => ({ solid: [TRI(-FOUND.deep - FOUND.skirt, 0)], dress: [TRI(-0.14, 0, -0.07)] }),
  // (against a foundation's edge: its back at the edge, going down away from it)
  foundation_steps: () => ({ solid: [0, 1, 2].map((i) => box(-H, -0.2 * (i + 1) - 1.2, -0.75 + i * 0.5, H, -0.2 * (i + 1) + 0.0, -0.25 + i * 0.5)) }),
  ramp: () => ({ solid: [{ hull: [[-H, 0, -H], [H, 0, -H], [-H, -1.2, -H], [H, -1.2, -H], [-H, -1.2, H], [H, -1.2, H]] }] }),
  wall: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, STOREY)] }),
  wall_half: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, STOREY / 2)] }),
  wall_low: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, 1)] }),
  // (an opening a metre wide and 2.2 m high: a door is hung in it, step four)
  // (an opening 1.3 m wide and 2.3 high, as Rust's: a door opened in a triangle's doorway lies across the next doorway, the
  // airlock the owner asked for, 2026-10-25: "you can't get into the 2nd frame because the door open blocks the open door
  // frame of the first door")
  doorway: () => ({ solid: [wallBox(-LONG / 2, 0, -DOORWAY.half, STOREY), wallBox(DOORWAY.half, 0, LONG / 2, STOREY), wallBox(-DOORWAY.half, DOORWAY.high, DOORWAY.half, STOREY)], cloth: frame(DOORWAY.half, 0, DOORWAY.high, false) }),
  // (a window 1.2 m across, from 1.1 m to 2.1 m: shutters or bars go in it)
  window: () => ({ solid: [wallBox(-LONG / 2, 0, LONG / 2, 1.1), wallBox(-LONG / 2, 2.1, LONG / 2, STOREY), wallBox(-LONG / 2, 1.1, -0.6, 2.1), wallBox(0.6, 1.1, LONG / 2, 2.1)], cloth: frame(0.6, 1.1, 2.1, true) }),
  // (an opening 2.4 m across and 2.6 m high: double doors or a garage door)
  wall_frame: () => ({ solid: [wallBox(-LONG / 2, 0, -1.2, STOREY), wallBox(1.2, 0, LONG / 2, STOREY), wallBox(-1.2, 2.6, 1.2, STOREY)], cloth: frame(1.2, 0, 2.6, false) }),
  floor: () => ({ solid: [box(-H, -FLOOR_T, -H, H, 0, H)] }),
  floor_tri: () => ({ solid: [TRI(-FLOOR_T, 0)] }),
  // (a hole 1.4 m square: a ladder hatch goes in it)
  floor_frame: () => ({ solid: [box(-H, -FLOOR_T, -H, H, 0, -0.7), box(-H, -FLOOR_T, 0.7, H, 0, H), box(-H, -FLOOR_T, -0.7, -0.7, 0, 0.7), box(0.7, -FLOOR_T, -0.7, H, 0, 0.7)] }),
  floor_frame_tri: () => {
    const R = CELL / Math.sqrt(3), r = R * 0.42, at = (a: number, d: number): [number, number] => [Math.sin((a * Math.PI) / 6) * d, Math.cos((a * Math.PI) / 6) * d];
    return { solid: [[2, 6], [6, 10], [10, 2]].map(([a, b]) => ({ prism: [at(a, R), at(b, R), at(b, r), at(a, r)], y0: -FLOOR_T, y1: 0 })) };
  },
  // (up the -x side away from +z, a landing in the far corner, along the far side to +x: it comes out on the floor above at +x)
  stairs_l: () => ({ solid: [...flight(6, [-H, -0.3], [H, -0.3], 0, STOREY / 2, false), box(-H, 0, -H, -0.3, STOREY / 2, -0.3), ...flight(6, [-H, -0.3], [-0.3, H], STOREY / 2, STOREY, true)] }),
  // (up the +x side toward -z, across a landing the whole width, back down the -x side toward +z, rising)
  stairs_u: () => ({ solid: [...flight(5, [0.3, H], [H, 0], 0, STOREY / 2, false), box(-H, 0, -H, H, STOREY / 2, 0), ...flight(5, [-H, -0.3], [0, H], STOREY / 2, STOREY, false)] }),
  stairs_spiral: () => {
    const out: Solid[] = [box(-0.15, 0, -0.15, 0.15, STOREY, 0.15)];
    for (let i = 0; i < 12; i++) {
      const a0 = (i * Math.PI) / 6, a1 = a0 + Math.PI / 6 + 0.02, R = 1.45, y = (STOREY * (i + 1)) / 12;
      out.push({ prism: [[0, 0], [Math.sin(a0) * R, Math.cos(a0) * R], [Math.sin(a1) * R, Math.cos(a1) * R]], y0: y - 0.14, y1: y });
    }
    return { solid: out };
  },
  // (a slope from its front edge up to its back: turned, four of them make a hipped roof)
  roof: () => ({ solid: [{ hull: [[-H, -FLOOR_T, H], [H, -FLOOR_T, H], [-H, -FLOOR_T, -H], [H, -FLOOR_T, -H], [-H, 1.5, -H], [H, 1.5, -H]] }] }),
  roof_tri: () => {
    const R = CELL / Math.sqrt(3), c = [2, 6, 10].map((a): [number, number, number] => [Math.sin((a * Math.PI) / 6) * R, -FLOOR_T, Math.cos((a * Math.PI) / 6) * R]);
    return { solid: [{ hull: [...c, [0, 1.3, 0]] }] };
  },
  // (sharpened logs, six to a length, and the rail that holds them)
  // (each reaching FREE.skirt into the ground, to meet it at both ends on a slope)
  high_wall_wood: () => ({
    solid: [box(-H, -FREE.skirt, -0.25, H, 6, 0.25)],
    dress: Array.from({ length: 6 }, (_, i) => ({ hull: [[-H + i * 0.5 + 0.02, 6, -0.23], [-H + i * 0.5 + 0.48, 6, -0.23], [-H + i * 0.5 + 0.02, 6, 0.23], [-H + i * 0.5 + 0.48, 6, 0.23], [-H + i * 0.5 + 0.25, 6.6, 0]] as [number, number, number][] })),
  }),
  high_wall_stone: () => ({ solid: [box(-H, -FREE.skirt, -0.4, H, 6, 0.4), box(-H - 0.05, 6, -0.45, H + 0.05, 6.25, 0.45)] }),
  // (the claim: its upkeep box, and over it a pole with the flag of whoever holds it)
  // (as its model stands, src/game/building/models.ts: a rusted strongbox, the post on it, the flag off the post to +x)
  claim: () => ({ lockAt: { at: [0, 0.24, 0.34] }, solid: [box(-0.49, 0, -0.34, 0.49, 0.45, 0.34), box(0.01, 0.45, -0.11, 0.13, 2.1, 0.01)], cloth: { paint: 'flag', solid: [box(0.17, 1.42, -0.065, 1.17, 2.04, -0.035)] } }),
  // ---- fittings: each swings out to its piece's +z, which R turns about
  // (a leaf filling the doorway, hung on its -x jamb; braced on the inside, its handle both sides)
  door_wood: () => ({ solid: [], leaves: [door(-DOORWAY.half, DOORWAY.half * 2, DOORWAY.high, true)], lockAt: { leaf: 0, at: [DOORWAY.half * 2 - 0.18, 1.16, 0] } }),
  door_metal: () => ({ solid: [], leaves: [door(-DOORWAY.half, DOORWAY.half * 2, DOORWAY.high, false)], lockAt: { leaf: 0, at: [DOORWAY.half * 2 - 0.18, 1.16, 0] } }),
  double_door_wood: () => ({ solid: [], leaves: [door(-1.2, 1.2, 2.6, true), door(1.2, 1.2, 2.6, true)], lockAt: { leaf: 0, at: [1.02, 1.32, 0] } }),
  double_door_metal: () => ({ solid: [], leaves: [door(-1.2, 1.2, 2.6, false), door(1.2, 1.2, 2.6, false)], lockAt: { leaf: 0, at: [1.02, 1.32, 0] } }),
  // (one panel hung from the opening's head, that tips up and in to lie under the ceiling: an up-and-over door)
  garage_door: () => ({
    solid: [],
    lockAt: { leaf: 0, at: [0.7, -2.2, 0.05] },
    leaves: [{ hinge: [0, 2.6, 0], axis: 'x', open: Math.PI / 2, paint: 'galv', solid: [box(-1.18, -2.58, -0.05, 1.18, -0.02, 0.05)], dress: [...[0, 1, 2, 3, 4].map((i) => box(-1.15, -2.45 + i * 0.5, -0.09, 1.15, -2.37 + i * 0.5, -0.05)), tinted(box(-0.25, -2.48, 0.05, 0.25, -2.42, 0.09), IRON)] }],
  }),
  // (a lid in the floor frame's hole, hinged at its -z side, that lifts to stand up past upright)
  hatch: () => ({ ...ladderUnder(), paint: 'steel', lockAt: { leaf: 0, at: [0.35, 0, 1.15], up: true }, leaves: [{ hinge: [0, 0, -0.7], axis: 'x', open: -1.75, paint: 'steel', solid: [box(-0.68, -0.08, 0.02, 0.68, 0, 1.38)], dress: [tinted(box(-0.08, 0, 1.12, 0.08, 0.04, 1.3), IRON), ...[-0.5, 0.5].map((x) => tinted(box(x - 0.06, -0.02, 0, x + 0.06, 0.02, 0.14), IRON)), ...rivets([-0.6, 0.6], [0.1, 1.3], 0, 'y')] }] }),
  // (two leaves on the wall's outside face, folded back flat against it when open)
  shutters: () => ({
    solid: [],
    // (hung clear of the window's frame, which stands proud of the wall)
    leaves: [-1, 1].map((s): Leaf => ({ hinge: [s * 0.6, 1.1, WALL_T / 2 + 0.08], axis: 'y', open: s * 3.05, paint: 'door', solid: [box(Math.min(0, -s * 0.59), 0.01, -0.03, Math.max(0, -s * 0.59), 0.99, 0.03)], dress: [0.25, 0.75].map((y) => tinted(box(Math.min(-s * 0.02, -s * 0.45), y - 0.025, 0.03, Math.max(-s * 0.02, -s * 0.45), y + 0.025, 0.045), IRON)) })),
  }),
  bars_wood: () => ({ solid: bars(6, 0.07, 0.035) }),
  bars_metal: () => ({ solid: bars(8, 0.035, 0.02), paint: 'steel' }),
  // (a plate over the window with a slit to see and shoot through, 0.6 m by 0.15)
  embrasure: () => ({ solid: [box(-0.6, 1.1, -0.04, 0.6, 1.5, 0.04), box(-0.6, 1.65, -0.04, 0.6, 2.1, 0.04), box(-0.6, 1.5, -0.04, -0.3, 1.65, 0.04), box(0.3, 1.5, -0.04, 0.6, 1.65, 0.04)], paint: 'steel', dress: [...rivets([-0.54, 0.54], [1.16, 2.04], 0.04, 'z'), ...rivets([-0.54, 0.54], [1.16, 2.04], -0.04, 'z')] }),
  // (a gate the length of a high wall: its posts and head, and two leaves 1.2 m wide and 5.1 high)
  gate_wood: () => ({
    lockAt: { leaf: 0, at: [1.02, 1.4, 0] },
    solid: [box(-1.5, -FREE.skirt, -0.3, -1.2, 6, 0.3), box(1.2, -FREE.skirt, -0.3, 1.5, 6, 0.3), box(-1.2, 5.25, -0.25, 1.2, 6, 0.25)],
    dress: [-1.35, 1.35].map((x) => ({ hull: [[x - 0.15, 6, -0.3], [x + 0.15, 6, -0.3], [x - 0.15, 6, 0.3], [x + 0.15, 6, 0.3], [x, 6.6, 0]] as [number, number, number][] })),
    // (hung at their outside faces, as the doors are, and opening square: clear of the posts)
    leaves: [-1, 1].map((s): Leaf => ({ hinge: [s * 1.2, 0, 0.1], axis: 'y', open: (s * Math.PI) / 2, solid: [box(Math.min(0, -s * 1.19), 0.08, -0.2, Math.max(0, -s * 1.19), 5.2, 0)], dress: [0.7, 4.4].map((y) => tinted(box(Math.min(-s * 0.14, -s * 0.9), y, 0, Math.max(-s * 0.14, -s * 0.9), y + 0.12, 0.04), IRON)) })),
  }),
  gate_stone: () => ({
    lockAt: { leaf: 0, at: [0.98, 1.4, 0] },
    solid: [box(-1.5, -FREE.skirt, -0.45, -1.15, 6, 0.45), box(1.15, -FREE.skirt, -0.45, 1.5, 6, 0.45), box(-1.15, 5.25, -0.4, 1.15, 6.25, 0.4)],
    leaves: [-1, 1].map((s): Leaf => ({ hinge: [s * 1.15, 0, 0.06], axis: 'y', open: (s * Math.PI) / 2, paint: 'steel', solid: [box(Math.min(0, -s * 1.14), 0.08, -0.12, Math.max(0, -s * 1.14), 5.2, 0)], dress: [0.6, 2.6, 4.6].flatMap((y) => [tinted(box(Math.min(-s * 0.12, -s * 1.1), y, 0, Math.max(-s * 0.12, -s * 1.1), y + 0.14, 0.03), IRON), tinted(box(Math.min(0, -s * 1.1), y, -0.15, Math.max(0, -s * 1.1), y + 0.14, -0.12), IRON)]) })),
  }),
  // (a ladder of two rails and its rungs, a storey high and a little over, leant on the face behind it (-z))
  ladder: () => ({ ...rungs(0, 0, 0, STOREY + 0.5), climb: { x: 0, z: 0, y0: 0, y1: STOREY, out: [0, 1] } }),
  // (a torch in an iron bracket on the wall's face behind it (-z), leant a little out, its head burning)
  torch_wall: () => ({
    solid: [{ hull: [[-0.025, 1.62, -0.04], [0.025, 1.62, -0.04], [-0.025, 1.62, 0.01], [0.025, 1.62, 0.01], [-0.025, 2.12, 0.06], [0.025, 2.12, 0.06], [-0.025, 2.12, 0.11], [0.025, 2.12, 0.11]] }],
    dress: [tinted(box(-0.05, 1.74, -0.12, 0.05, 1.8, 0.04), IRON), tinted(box(-0.06, 1.68, -0.12, 0.06, 1.9, -0.1), IRON), tinted({ hull: [[-0.045, 2.02, 0.03], [0.045, 2.02, 0.03], [-0.045, 2.02, 0.12], [0.045, 2.02, 0.12], [-0.04, 2.2, 0.06], [0.04, 2.2, 0.06], [-0.04, 2.2, 0.15], [0.04, 2.2, 0.15]] }, 0x2a2018)],
    flame: [0, 2.26, 0.1],
  }),
  // ---- set down
  box_small: () => ({ lockAt: { at: [0, 0.38, 0.28] }, solid: [box(-0.4, 0, -0.28, 0.4, 0.5, 0.28)], dress: [box(-0.42, 0.5, -0.3, 0.42, 0.56, 0.3)] }),
  box_large: () => ({ lockAt: { at: [0, 0.56, 0.42] }, solid: [box(-0.7, 0, -0.42, 0.7, 0.75, 0.42)], dress: [box(-0.72, 0.75, -0.44, 0.72, 0.82, 0.44), box(-0.74, 0.1, -0.44, -0.7, 0.65, 0.44), box(0.7, 0.1, -0.44, 0.74, 0.65, 0.44)] }),
  // (a sleeping bag rolled out flat, its hood at the head; a bed of pallets with its bedding, as its model is,
  // src/game/building/models.ts)
  bedroll: () => ({ solid: [box(-0.4, 0, -1, 0.4, 0.1, 1)], paint: 'bag', dress: [box(-0.36, 0.1, 0.6, 0.36, 0.17, 0.95), tinted(box(-0.41, 0, -1.02, 0.41, 0.11, -0.86), 0x8a8a70)] }),
  bed: () => ({
    solid: [box(-0.55, 0, -1.05, 0.55, 0.3, 1.05)],
    cloth: { paint: 'bag', solid: [box(-0.5, 0.3, -1, 0.5, 0.45, 0.96), box(-0.36, 0.45, 0.6, 0.36, 0.6, 0.92)] },
  }),
  // (crafting's forge: the drum, round, as high as its rim of stones, and its chimney; drawn by its model, these are what
  // stops a body and what the wheel's picture is drawn from)
  forge: () => ({
    solid: [
      { prism: Array.from({ length: 10 }, (_, i) => [Math.cos((i / 10) * Math.PI * 2) * 0.4, Math.sin((i / 10) * Math.PI * 2) * 0.4] as [number, number]), y0: 0, y1: 0.95 },
      box(-0.07, 0.95, -0.07, 0.07, 1.6, 0.07),
    ],
    unseen: true,
  }),
  // (crafting's research table: its top and what stands on it; drawn by its own model, src/game/craft-forge.ts)
  research_table: () => ({
    solid: [
      box(-0.6, 0.86, -0.3, 0.6, 0.92, 0.3),
      box(0.05, 0.12, -0.27, 0.55, 0.86, 0.27),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(sx * 0.56 - 0.03, 0, sz * 0.26 - 0.03, sx * 0.56 + 0.03, 0.86, sz * 0.26 + 0.03))),
      box(-0.52, 0.92, -0.22, -0.48, 1.3, -0.18),
    ],
    unseen: true,
  }),
  // (a heavy table: its top, its four legs and a shelf between them)
  workbench: () => ({
    solid: [box(-0.85, 0.82, -0.45, 0.85, 0.94, 0.45), box(-0.8, 0.15, -0.4, 0.8, 0.22, 0.4), ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(sx * 0.78 - 0.05, 0, sz * 0.38 - 0.05, sx * 0.78 + 0.05, 0.82, sz * 0.38 + 0.05)))],
    dress: [box(0.45, 0.94, -0.42, 0.7, 1.12, -0.24), box(-0.8, 0.94, 0.38, 0.8, 1.4, 0.44)],
  }),
  // (the armoured tier's doors, the progression plan: the metal ones' shapes, their leaves in its heavy plate)
  door_armoured: () => armoured(SHAPES.door_metal()),
  garage_door_armoured: () => armoured(SHAPES.garage_door()),
};

/** a shape whose leaves are the armoured tier's plate */
const armoured = (s: Shape): Shape => ({ ...s, leaves: s.leaves?.map((l) => ({ ...l, paint: 4 as Paint })) });

/** iron (straps, hinges, handles) and the heads of rivets, as the paint is shaded for them */
const IRON = 0x2e2c2a, RIVET = 0xb4b0a8;
const tinted = (s: Solid, c: number): Solid => ({ ...s, c });

/** rivets round a plate: along its edges between [x0, x1] and [a0, a1], on the face at `at` (z, or y for a lid) */
function rivets([x0, x1]: [number, number], [a0, a1]: [number, number], at: number, face: 'z' | 'y'): Solid[] {
  const out: Solid[] = [], r = 0.018, n = (a: number, b: number) => Math.max(2, Math.round(Math.abs(b - a) / 0.3));
  const put = (x: number, a: number) => out.push(tinted(face === 'z' ? box(x - r, a - r, at - r, x + r, a + r, at + r) : box(x - r, at - r, a - r, x + r, at + r, a + r), RIVET));
  for (let i = 0; i <= n(x0, x1); i++) for (const a of [a0, a1]) put(x0 + ((x1 - x0) * i) / n(x0, x1), a);
  for (let i = 1; i < n(a0, a1); i++) for (const x of [x0, x1]) put(x, a0 + ((a1 - a0) * i) / n(a0, a1));
  return out;
}

/** an opening's frame of dark timber, standing proud of both faces: its jambs at +-`half`, from `y0` (a sill too, a window's) to `y1` */
function frame(half: number, y0: number, y1: number, sill: boolean): { paint: Paint; solid: Solid[] } {
  const t = 0.12, d = WALL_T / 2 + 0.04;
  return { paint: 'trim', solid: [box(-half - t, y0, -d, -half, y1 + t, d), box(half, y0, -d, half + t, y1 + t, d), box(-half - t, y1, -d, half + t, y1 + t, d), ...(sill ? [box(-half - t - 0.04, y0 - t, -d - 0.04, half + t + 0.04, y0, d + 0.04)] : [])] };
}

/**
 * A door's leaf hung on a jamb at x = `at` (it reaches toward the opening's middle), `w` wide and `h` high, out to +z,
 * on hinges at its outside face, as a door is hung: it opens square without its edge turning into the frame. A wooden
 * one is painted boards with two ledges and two iron straps from its hinges; a metal one a plate of painted steel with
 * a frame and rivets round it and three hinges; both a handle each side. Its leaf is 8 cm thick.
 */
function door(at: number, w: number, h: number, wood: boolean): Leaf {
  const s = at < 0 ? 1 : -1, T = 0.08;
  const along = (a: number, b: number): [number, number] => [Math.min(s * a, s * b), Math.max(s * a, s * b)];
  // (something laid on a face, `t` deep, from `u0` to `u1` along the leaf; the outside face (f 1) is the hinges')
  const on = (f: number, u0: number, u1: number, y0: number, y1: number, t: number, c?: number): Solid => {
    const [xa, xb] = along(u0, u1), [za, zb] = f > 0 ? [0, t] : [-T - t, -T];
    const b = box(xa, y0, za, xb, y1, zb);
    return c === undefined ? b : tinted(b, c);
  };
  const handles = [1, -1].map((f) => on(f, w - 0.16, w - 0.12, h * 0.42 - 0.12, h * 0.42 + 0.12, 0.06, IRON));
  const [x0, x1] = along(0, w - 0.02);
  // (on the outside, nothing within 12 cm of the hinges: it would turn into the jamb)
  const dress = wood
    ? [0.42, h - 0.5].flatMap((y) => [on(1, 0.12, w - 0.06, y - 0.06, y + 0.06, 0.03), on(-1, 0.04, w - 0.06, y - 0.06, y + 0.06, 0.03), on(1, 0.12, w * 0.62, y - 0.05, y + 0.05, 0.045, IRON)])
    : [
        ...[1, -1].flatMap((f) => {
          const u0 = f > 0 ? 0.12 : 0.03;
          return [on(f, u0, w - 0.04, 0.05, 0.13, 0.03), on(f, u0, w - 0.04, h - 0.14, h - 0.06, 0.03), on(f, w - 0.12, w - 0.04, 0.13, h - 0.14, 0.03), on(f, u0, u0 + 0.08, 0.13, h - 0.14, 0.03)];
        }),
        ...rivets(along(0.16, w - 0.08), [0.09, h - 0.1], 0.03, 'z'),
        ...[0.3, h / 2, h - 0.4].map((y) => tinted(box(-0.025, y, -0.025, 0.025, y + 0.16, 0.025), IRON)),
      ];
  return { hinge: [at, 0, T / 2], axis: 'y', open: (s * -Math.PI) / 2, paint: wood ? 'door' : 'steel', solid: [box(x0, 0.02, -T, x1, h - 0.02, 0)], dress: [...dress, ...handles] };
}

/** a ladder's rails and rungs at (x, z) from `y0` to `y1`, its rungs across x */
function rungs(x: number, z: number, y0: number, y1: number): { solid: Solid[]; dress: Solid[] } {
  const solid = [-1, 1].map((s) => box(x + s * 0.25 - 0.03, y0, z - 0.03, x + s * 0.25 + 0.03, y1, z + 0.03));
  const dress: Solid[] = [];
  for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.3) dress.push(box(x - 0.24, y - 0.02, z - 0.02, x + 0.24, y + 0.02, z + 0.02));
  return { solid, dress };
}

/** the hatch's own ladder, down the far side of its hole to the floor a storey below (Rust's ladder hatch) */
function ladderUnder(): { solid: Solid[]; dress: Solid[]; climb: NonNullable<Shape['climb']> } {
  return { ...rungs(0, 0.6, -STOREY, 0.6), climb: { x: 0, z: 0.6, y0: -STOREY, y1: 0, out: [0, -1] } };
}

/** `n` bars across the window, each `t` square, held by a rail top and bottom of `rail` deep */
function bars(n: number, t: number, rail: number): Solid[] {
  const out: Solid[] = [box(-0.6, 1.1, -rail, 0.6, 1.18, rail), box(-0.6, 2.02, -rail, 0.6, 2.1, rail)];
  for (let i = 0; i < n; i++) {
    const x = -0.6 + (1.2 * (i + 0.5)) / n;
    out.push(box(x - t / 2, 1.18, -t / 2, x + t / 2, 2.02, t / 2));
  }
  return out;
}

/** a solid moved by a step (a leaf's, hung shut, into its piece's frame) */
export function moved(s: Solid, [dx, dy, dz]: [number, number, number]): Solid {
  if ('box' in s) return { ...s, box: [s.box[0] + dx, s.box[1] + dy, s.box[2] + dz, s.box[3], s.box[4], s.box[5]] };
  if ('prism' in s) return { ...s, prism: s.prism.map(([x, z]) => [x + dx, z + dz]), y0: s.y0 + dy, y1: s.y1 + dy };
  return { ...s, hull: s.hull.map(([x, y, z]) => [x + dx, y + dy, z + dz]) };
}

/** everything of a piece as it stands shut, in its own frame: what it is, what dresses it, and its leaves hung shut */
export function shutOf(kind: string, dress = true): Solid[] {
  const s = shapeOf(kind);
  return [...s.solid, ...(dress ? [...(s.dress ?? []), ...(s.cloth?.solid ?? [])] : []), ...(s.leaves ?? []).flatMap((l) => [...l.solid, ...(dress ? [...(l.dress ?? []), ...(l.iron ?? [])] : [])].map((q) => moved(q, l.hinge)))];
}

/**
 * A leaf's ironwork drawn in iron of its own, with a raised edge: what of its dress was shaded IRON on its paint, and
 * read as black holes through the leaf (the navigator, 2026-10-24, of the locked door's straps: "Give them an iron look:
 * dark grey with a little sheen, and a raised edge"). Each strap, hinge and handle a box, and a plate a little in from
 * its edges on each of its broad faces: the step catches the light as a forged edge does.
 */
function ironOf(l: Leaf): Leaf {
  const iron: Solid[] = [], dress: Solid[] = [];
  for (const q of l.dress ?? []) {
    if (q.c !== IRON || !('box' in q)) {
      dress.push(q);
      continue;
    }
    const [cx, cy, cz, ...size] = q.box, thin = size.indexOf(Math.min(...size)), step = 0.007, lift = 0.006;
    iron.push({ box: q.box });
    for (const side of [-1, 1]) {
      const b = [cx, cy, cz, ...size.map((v, i) => (i === thin ? lift : Math.max(0.004, v - 2 * step)))] as [number, number, number, number, number, number];
      b[thin] += side * (size[thin] / 2 + lift / 2);
      iron.push({ box: b });
    }
  }
  return iron.length ? { ...l, dress, iron } : l;
}

const made = new Map<string, Shape>();
/** a piece's solids */
export function shapeOf(kind: string): Shape {
  let s = made.get(kind);
  if (!s) {
    s = SHAPES[kind]();
    if (s.leaves) s = { ...s, leaves: s.leaves.map(ironOf) };
    made.set(kind, s);
  }
  return s;
}

/** every kind has its shape (a test's word) */
export const SHAPED = () => Object.keys(PIECES).every((k) => !!SHAPES[k]);
