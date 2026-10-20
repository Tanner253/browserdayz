// The army's field posts in the west: a WW2 pillbox (the model "WW2 Field Bunker" by Golden, the one stood over Bunker 17's
// stair: see src/world/bunker.ts) by four of the western roads, its door to the road, a rack, a case and a gun inside.
// The owner, 2026-10-17: "we need more loot places", and the plan they said yes to, "cheap posts with bunker tops in the
// west". Each is a place of the army's on the third step of the map. Pure numbers, shared by the game and the server.
//
// Where: along the roads west of the old map, a few metres off the road's edge, where the ground under one varies by
// less than 0.4 m and no tree, rock, prop or building is near, and well apart (scripts that chose them: the road walked
// at every point of its line, 2026-10-17). The ground is levelled under each as the world is made (`seatPost`).

/** a post: where its middle stands, and the way its door faces (about Y: at 0, toward +z), toward the road */
export interface Post { x: number; z: number; rot: number }

export const POSTS: Post[] = [
  { x: -1189, z: 111, rot: 1.55 },
  { x: -2535, z: -375, rot: -2.08 },
  { x: -2956, z: 243, rot: -1.53 },
  { x: -3452, z: -34, rot: 0.24 },
];

/**
 * The model's own measures: its floor's top over its foot (the slab the room stands on), its one room (the door at its
 * -z end, the yard of blast walls before that), and how tall the room is. From the bunker's own numbers for the same
 * model (src/sim/bunker.ts B.house and B.hut), turned into the model's own space.
 */
export const PILLBOX = {
  model: 'bunker_house',
  floor: 0.305,
  room: { x0: -2.1, x1: 2.1, z0: -2.75, z1: 2.9 },
  tall: 2.45,
  /** half its width and half its length, the yard with it, and the ground levelled round it beyond that */
  half: [3.18, 5.41] as [number, number],
  blend: 4,
};

/** the model is turned about so that its door, at its own -z, faces the way the post does */
export const postYaw = (p: Post) => p.rot + Math.PI;

/** a point in the model's own space (x across, y up from its foot, z along: the door at -z), in the world, its foot at `foot` */
export function postAt(p: Post, foot: number, lx: number, ly: number, lz: number): [number, number, number] {
  const a = postYaw(p), c = Math.cos(a), s = Math.sin(a);
  return [p.x + lx * c + lz * s, foot + ly, p.z - lx * s + lz * c];
}

/** where the model's foot stands, over the ground as levelled (`level`): its floor a finger over that */
export const postFoot = (level: number) => level - PILLBOX.floor + 0.02;

/**
 * What is in a post's room, in the model's space: a small rack against its back wall facing the door, on every board;
 * the army's hard case by one side wall (searched as any case is: src/sim/crates.ts); and three places on the floor, the
 * first of them kept with a gun as a guard post's is (see `arms` in the economy).
 */
export const POST_ROOM = {
  rack: { id: 'rack_small', x: 1.0, z: 2.56, rot: Math.PI, boards: [0, 1, 2, 3] },
  case: { id: 'weapons_case', x: -1.5, z: 1.7, rot: Math.PI / 2 },
  // (and a gun rack beside the shelf on the back wall: the owner, 2026-10-18, "more of the new weapon lockers ... in
  // military locations". Half way between the case's end and the shelf, a hand clear of each: at -0.62 the case lay
  // 15 cm into its foot; and out from the wall to the shelf's depth: stood where the shelf is, 2.56, it was 0.61 deep to
  // the shelf's 0.2 and its back was 30 cm into the wall, seen through: the owner, 2026-10-19, "the rifle rack clips into
  // the bunker walls", of these pillboxes)
  gunRack: { id: 'gun_rack', x: -0.42, z: 2.2, rot: Math.PI },
  floor: [[0, 0.2], [1.2, -1.5], [-1.1, -1.7]] as [number, number][],
};

/**
 * Levels the ground under a post and blends it into what is round it (the world's net: CELL metres a point, its first
 * column at x0 and first row at z0, nx points a row), and clears the grass from under it. @returns the level it was set to
 */
export function seatPost(p: Post, fields: { heights: Float32Array; surface: Float32Array; grass: Uint8Array }, net: { cell: number; x0: number; z0: number; nx: number; nz: number }): number {
  const a = postYaw(p), c = Math.cos(a), s = Math.sin(a), [hx, hz] = PILLBOX.half, B = PILLBOX.blend;
  const local = (x: number, z: number): [number, number] => {
    const dx = x - p.x, dz = z - p.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const reach = Math.hypot(hx + B, hz + B);
  const i0 = Math.max(0, Math.floor((p.x - reach - net.x0) / net.cell)), i1 = Math.min(net.nx - 1, Math.ceil((p.x + reach - net.x0) / net.cell));
  const j0 = Math.max(0, Math.floor((p.z - reach - net.z0) / net.cell)), j1 = Math.min(net.nz - 1, Math.ceil((p.z + reach - net.z0) / net.cell));
  // (the level: the mean of the ground under it, so that as much is cut as is filled)
  let sum = 0, n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const [lx, lz] = local(net.x0 + i * net.cell, net.z0 + j * net.cell);
    if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) (sum += fields.heights[j * net.nx + i], n++);
  }
  const level = n ? sum / n : fields.heights[Math.round((p.z - net.z0) / net.cell) * net.nx + Math.round((p.x - net.x0) / net.cell)];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const [lx, lz] = local(net.x0 + i * net.cell, net.z0 + j * net.cell);
    const out = Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(lz) - hz));
    if (out >= B) continue;
    const k = j * net.nx + i, t = out / B, w = t * t * (3 - 2 * t);
    fields.heights[k] = level + (fields.heights[k] - level) * w;
    if (fields.surface !== fields.heights) fields.surface[k] = level + (fields.surface[k] - level) * w;
    if (out < 1) fields.grass[k] = 0;
  }
  return level;
}
