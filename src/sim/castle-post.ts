// ORLINOYE, "the Eagle's Nest": the fort on the mountain as the army's signals and observation post, above ground.
// (The fort itself, its stone and what is under it are src/sim/castle.ts: nothing of that is said again here. Every
// measure of the fort is read from what that file exports.)
//
// When the Zona was sealed a platoon took the old fort: from its keep the whole valley and both passes are seen, and
// a mast on its roof carried the radio net. They lived here for months and died here. So each room is two things: a
// ruin of cut stone, and a soldiers' post left in a hurry.
//
//   KEEP ROOF      the mast and its guys, an observation position of sandbags on the east wall top with a scope on
//                  a stand, a tarpaulin in the south-west corner
//   UPPER ROOM     the command post: the signals desk and its set, the map on the fort's own table, the commander's
//                  locker, a net over the corner of the roof that fell in. The best of the fort above ground
//   HALL           the mess: the wood stove and its flue, a pot, a shelf of stores under the stair
//   STORE          the generator, drums of fuel beside the stair down (they blow), jerrycans, the switch box, and
//                  cables out to the lamps and up to the mast
//   TERRACE        two ridge tents in the lee of the keep, duckboards, a netted dump of crates, a flagpole, sandbags
//                  either side of the gate and on the parapet where its merlons fell, two floodlights
//   TOWERS         north-east a sniper's nest, south-west a bunk room behind canvas where its wall fell, north-west
//                  the signals' own with its aerial and a wire to the keep; the south-east one is left a ruin
//   THE VILLAGE    a burial ground by the nearest house, a picket's post of sandbags with a fire ring past the last
//
// Rules and layout only: nothing is drawn here, and the server may read all of it. What is off the shelf is given
// as the world's own list of such things has them (`postProps`); what the game has no model for is said as plain
// pieces (`postMade`) and is drawn and made solid by src/world/castle-post.ts.
//
// (Nothing at the top of this file reads the fort's own: src/sim/castle.ts may bring this file in, and each would
// then be waiting on the other. Everything is worked out when it is asked for.)

import { CASTLE, CASTLE_SCALE, HOUSES, LOOSE, body, castleAt, castleGround, castleLoose, castleParts, looseLocal, type CastleLoot, type GroundAt, type Loose, type Place, type Tower, type V3 } from './castle';

// A BODY'S MEASURE (2026-10-13). The fort is built a fifth bigger than its own measure (`CASTLE_SCALE`), and the
// post is in it: every PLACE here is the fort's, and a fifth further from its middle in the world. But a desk, a
// tent, a sandbag, a stove and a grave are a body's, and are the size they were. So: whatever is off the shelf
// comes at its own size (`scale: 1`); whatever is made by hand and is a body's (`BODILY`) is made the size it is
// said here and set down that size in the world, about its own spot; and every height or reach that is OF such a
// thing (the top of a desk, how far along it the wireless stands, how far before it the chair) is said
// `body(metres)`. What is the place's stays the place's: the mast, a net from wall to poles, a cable's run.
/** the kinds of thing made by hand that are a body's: each is made about its own spot at the size it is said, whatever the fort's scale */
export const BODILY: ReadonlySet<string> = new Set(['tent', 'generator', 'scope', 'table', 'set', 'map', 'bedroll', 'grave', 'pot', 'tins', 'logs', 'board']);

export const POST = {
  name: 'Orlinoye',
  /** how far from the fort's middle an eye may be for the post to be made and drawn: beyond, the mast alone */
  reach: 350,
  /** the mast: how tall, how wide a side of its three, how far apart its rungs of bracing, and how high over its top its light is */
  mast: { h: 12, side: 0.52, bay: 1, light: 0.22 },
  /** a sandbag as it lies: long, wide, and how much a course of them adds to a wall's height */
  bag: { long: 0.54, wide: 0.36, course: 0.19 },
  /** a ridge tent for two: along its ridge, across its foot, to its ridge */
  tent: { long: 2.2, wide: 1.7, high: 1.25 },
  /** the lamps that burn on the generator: a floodlight's light and a bulb's (colour, how far it carries) */
  flood: { colour: [1, 0.96, 0.86] as V3, reach: 16 },
  bulb: { colour: [1, 0.8, 0.52] as V3, reach: 7 },
  /** the mast's light: red, seen from the valley; so long on and so long off */
  beacon: { colour: [1, 0.08, 0.04] as V3, on: 1.1, off: 0.9 },
};

export type Room = 'roof' | 'command post' | 'mess' | 'store' | 'terrace' | 'gate' | 'dump' | "sniper's nest" | 'bunk room' | 'signals tower' | 'village';

/** a thing off the shelf, in the fort's own measure: its kind, where it stands and how it is turned */
interface Stood { kind: string; room: Room; x: number; z: number; y: number; rot: number; sits?: boolean; far?: number }

interface Piece { room: Room; name: string }
/**
 * What is made by hand, in the fort's own measure (x toward the gate, z toward the steep side, y over the terrace;
 * `sits`: its heights are over the ground at its own spot, not over the terrace).
 */
export type Made = Piece & (
  /** the lattice mast: its foot, its height, and each guy: from how high on it to where it is pegged */
  | { t: 'mast'; at: V3; h: number; guys: { from: number; to: V3 }[] }
  /** a wall of sandbags along a line of spots [x, z], so many courses high, on a floor at `y` */
  | { t: 'bags'; pts: [number, number][]; y: number; courses: number; sits?: boolean }
  /** cloth between four corners (in order round it), hanging so far in its middle: a camouflage net, a tarpaulin, a flag */
  | { t: 'sheet'; stuff: 'net' | 'tarp' | 'flag'; p: [V3, V3, V3, V3]; sag: number }
  /** a ridge tent: the middle of its floor, which way its ridge runs, and which end is open (1: the far end of the ridge, -1: the near) */
  | { t: 'tent'; at: V3; yaw: number; open: 1 | -1 }
  /** duckboards from one spot to another, so wide */
  | { t: 'boards'; a: V3; b: V3; w: number }
  /** a cable through these spots (or a pipe: `r` its half thickness); it hangs so far over the longest of its lengths */
  | { t: 'cable'; pts: V3[]; sag?: number; r?: number }
  /** a pole from one spot to another: `r` its half thickness */
  | { t: 'pole'; a: V3; b: V3; r: number; stuff: 'timber' | 'steel' }
  /** a floodlight: where its head is, which way it looks (degrees: 0 toward the gate, 90 toward the steep side), and whether it stands on legs of its own from the floor at `foot` */
  | { t: 'flood'; at: V3; aim: number; foot?: number }
  /** the generator: the middle of its foot, and how it is turned */
  | { t: 'generator'; at: V3; yaw: number }
  /** a spotting scope on its stand */
  | { t: 'scope'; at: V3; aim: number }
  /** a table or a bench of boards: the middle of its foot, its top's width and depth, and its height */
  | { t: 'table'; at: V3; yaw: number; w: number; d: number; h: number }
  /** a wireless set or a field telephone, standing on something */
  | { t: 'set'; kind: 'radio' | 'phone'; at: V3; yaw: number }
  /** a map, lying on a table */
  | { t: 'map'; at: V3; yaw: number; w: number; d: number }
  /** a bedroll on the floor */
  | { t: 'bedroll'; at: V3; yaw: number }
  /** a grave: a mound and a rough cross, on the ground */
  | { t: 'grave'; at: V3; yaw: number; sits: true; plumb?: boolean }
  /** a pot */
  | { t: 'pot'; at: V3; r: number; h: number }
  /** a bulb on its cord: where the bulb is, and how long the cord over it */
  | { t: 'bulb'; at: V3; drop: number }
  /** a whip aerial */
  | { t: 'whip'; at: V3; h: number }
  /** tins of ammunition, so many, stacked two to a layer */
  | { t: 'tins'; at: V3; yaw: number; n: number }
  /** split firewood stacked against a wall: so many across, so many high */
  | { t: 'logs'; at: V3; yaw: number; wide: number; high: number }
  /** a board on a wall with a map and papers pinned to it: its middle, the way it faces (its own z), its width and height */
  | { t: 'board'; at: V3; yaw: number; w: number; h: number }
);

/** what stops a body, in the fort's own measure: a block, turned about its own middle. `feet`: it stops a body and not a shot (cloth) */
export interface PostSolid { c: V3; h: V3; yaw: number; feet?: boolean; surface: 'cloth' | 'metal' | 'wood'; name: string; room: Room; sits?: boolean }

/** a lamp of the post, in the fort's own measure */
export interface PostLight { at: V3; kind: 'flood' | 'bulb' | 'beacon'; room: Room }

/** a place for a thing: as the fort's own are (and the map's: a LootPoint), with the room it is in */
export type PostLoot = CastleLoot & { room: Room };

interface Spot { room: Room; x: number; z: number; y: number; tier: 3 | 4; usage: CastleLoot['usage']; arms?: 'guns'; surf: { x: number; z: number; yaw: number; hx: number; hz: number; clear: number } }

interface Plan { stood: Stood[]; made: Made[]; solids: PostSolid[]; spots: Spot[]; lights: PostLight[] }

const rad = (d: number) => (d * Math.PI) / 180;
/** a grave: how far from its middle its cross stands (toward where it is turned from), and how tall the cross is */
export const GRAVE = { cross: 0.95, high: 1.05 };
/** how big the things off the shelf are that the world gives no body to, and the post does: half their size [x, y, z] */
const BODY: Record<string, V3> = { wood_stove: [0.34, 0.5, 0.27] };

/** The whole of the post, in the fort's own measure. @param loose the fort's loose pieces, in its own measure (the village is among them) */
function lay(loose: Loose[]): Plan {
  const C = CASTLE, K = C.keep, R = K.room, [, F1, F2] = K.floors, ROOF = K.roof, B = K.band, T = C.tower, BG = POST.bag;
  const stood: Stood[] = [], made: Made[] = [], solids: PostSolid[] = [], spots: Spot[] = [], lights: PostLight[] = [];
  const put = (room: Room, kind: string, x: number, z: number, y: number, rot = 0, o: Partial<Stood> = {}) => void stood.push({ kind, room, x, z, y, rot, far: 90, ...o });
  /** a body's measure, in the fort's own (see the head of this file); and half the size of a block that is a body's */
  const b = body, bh = (h: V3): V3 => [b(h[0]), b(h[1]), b(h[2])];
  const towers = castleParts().filter((p): p is Tower => p.t === 'tower'), tower = (name: string) => towers.find((t) => t.name === name)!;
  /** a spot of a tower's round: so far round it (degrees: 0 toward the gate, 90 toward the steep side), so far out */
  const round = (tw: Tower, a: number, r: number): [number, number] => [tw.cx + Math.cos(rad(a)) * r, tw.cz + Math.sin(rad(a)) * r];
  /** a wall of sandbags, what stops a body at it, and (if asked) a place for a thing on its top */
  const bags = (room: Room, name: string, pts: [number, number][], y: number, courses: number, sits = false) => {
    made.push({ t: 'bags', room, name, pts, y, courses, ...(sits ? { sits } : {}) });
    for (let k = 0; k + 1 < pts.length; k++) {
      // (a bag is a body's: the wall is as long as its line, and as high and as thick as so many bags)
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], long = Math.hypot(bx - ax, bz - az), h = b(courses * BG.course) / 2;
      solids.push({ c: [(ax + bx) / 2, y + h, (az + bz) / 2], h: [long / 2, h, b(BG.wide / 2 + 0.02)], yaw: Math.atan2(-(bz - az), bx - ax), surface: 'cloth', name, room, ...(sits ? { sits } : {}) });
    }
  };
  const pole = (room: Room, name: string, a: V3, b: V3, r = 0.024, stuff: 'timber' | 'steel' = 'timber') => void made.push({ t: 'pole', room, name, a, b, r, stuff });
  /** a place for a thing on a surface: `lx` along the surface from its middle (in metres of the world, as the surface's own half sizes are: it is a body's) */
  const lies = (room: Room, tier: 3 | 4, surf: Spot['surf'], y: number, lx: number, o: Partial<Spot> = {}) => void spots.push({ room, tier, usage: ['Military'], x: surf.x + b(lx) * Math.cos(surf.yaw), z: surf.z - b(lx) * Math.sin(surf.yaw), y, surf, ...o });

  // ------------------------------------------------------------------ the keep's roof
  {
    // the mast, on the slab clear of the hatch and of both flights of steps; three pegs on the wall tops, two guys to each
    const M = POST.mast, foot: V3 = [-1, ROOF, -0.4], pegs: V3[] = [[-4.6, B, -4.2], [-4.6, B, 4.2], [4.3, B, -2]];
    made.push({ t: 'mast', room: 'roof', name: 'mast', at: foot, h: M.h, guys: pegs.flatMap((to) => [{ from: 7.4, to }, { from: 11.3, to }]) });
    solids.push({ c: [foot[0], ROOF + 1.2, foot[2]], h: [M.side / 2, 1.2, M.side / 2], yaw: 0, surface: 'metal', name: 'mast', room: 'roof' });
    lights.push({ at: [foot[0], ROOF + M.h + M.light, foot[2]], kind: 'beacon', room: 'roof' });
    // the observation position: on the east wall top, where what is left of the storey over it is knee high and the
    // mountain road lies below. Sandbags along the lip, a scope on its stand behind them, glasses left on the bags
    const row: [number, number][] = [[4.38, -0.4], [4.38, 2]];
    bags('roof', 'observation post', row, B, 3);
    made.push({ t: 'scope', room: 'roof', name: 'scope', at: [3.85, B, 1.55], aim: 0 });
    lies('roof', 3, { x: 4.38, z: 0.8, yaw: -Math.PI / 2, hx: 1.05, hz: 0.12, clear: 1 }, B + b(3 * BG.course), -0.75);
    // a tarpaulin on four poles in the south-west corner of the slab, sloped to the wall: somewhere out of the wind
    const t0: V3 = [-3.6, ROOF + 2, 1.85], t1: V3 = [-1.45, ROOF + 2, 1.85], t2: V3 = [-1.45, ROOF + 1.5, 3.3], t3: V3 = [-3.6, ROOF + 1.5, 3.3];
    made.push({ t: 'sheet', stuff: 'tarp', room: 'roof', name: 'tarpaulin', p: [t0, t1, t2, t3], sag: 0.14 });
    for (const t of [t0, t1, t2, t3]) pole('roof', 'tarpaulin pole', [t[0], ROOF, t[2]], [t[0], t[1] + 0.06, t[2]]);
    put('roof', 'folded_blanket', -3.3, 3.05, ROOF, 0.4);
    // the set's lead: from the foot of the mast across the slab, and down through the corner that fell in
    // (it ends at the back of the desk in the room below: see `desk`, there)
    made.push({ t: 'cable', room: 'roof', name: 'aerial lead', pts: [[foot[0] + 0.2, ROOF + 0.03, foot[2]], [1.15, ROOF + 0.03, 1.75], [1.5, ROOF + 0.02, 2.05], [1.6, F2 + 0.03, 2.2], [1.5, F2 + 0.03, 2.3], [-1.75, F2 + 0.03, 2.3], [-2.68 + b(0.78), F2 + 0.03, 2.92 - b(0.32)], [-2.68 + b(0.78), F2 + b(0.8), 2.92 - b(0.17)]] });
  }

  // ------------------------------------------------------------------ the upper room: the command post
  {
    // the signals desk in the nook by the head of the stair, the set on it and a telephone; the map on the fort's own table
    // (the desk is where it was in the room; what is on it and before it is as far from the desk's own middle as it was)
    const desk = { x: -2.68, z: 2.92, top: b(0.7875) }, on = (dx: number, dz: number): [number, number] => [desk.x + b(dx), desk.z + b(dz)];
    put('command post', 'metal_office_desk', desk.x, desk.z, F2, Math.PI);
    put('command post', 'SchoolChair_01', ...on(-0.02, -0.97), F2, 0.15);
    put('command post', 'vintage_radio_transceiver', ...on(-0.44, 0.1), F2 + desk.top, Math.PI);
    made.push({ t: 'set', kind: 'phone', room: 'command post', name: 'field telephone', at: [on(0.73, 0.28)[0], F2 + desk.top, on(0.73, 0.28)[1]], yaw: 0.3 });
    const surf = { x: desk.x, z: desk.z - b(0.12), yaw: 0, hx: 0.9, hz: 0.26, clear: 1 };
    lies('command post', 4, surf, F2 + desk.top, 0.15);
    lies('command post', 4, surf, F2 + desk.top, 0.6);
    // (on the fort's own table, whose middle is at 0.4, 0.3 and whose top is 0.8 over the floor)
    made.push({ t: 'map', room: 'command post', name: 'map', at: [0.4, F2 + b(0.808), 0.3], yaw: Math.PI / 2, w: 1.15, d: 0.7 });
    // the commander's locker, in the corner past the head of the stair to the roof
    put('command post', 'steel_locker', 2.52, -2, F2, -Math.PI / 2);
    // a bulb over the map, and a net over the corner of the roof that fell in: from the roof's edge down to the broken walls
    made.push({ t: 'bulb', room: 'command post', name: 'bulb', at: [0.4, F2 + 1.85, 0.3], drop: 0.6 });
    lights.push({ at: [0.4, F2 + 1.85, 0.3], kind: 'bulb', room: 'command post' });
    made.push({ t: 'sheet', stuff: 'net', room: 'command post', name: 'net over the fallen corner', p: [[1.15, ROOF + 0.06, 1.85], [3.1, B + 0.05, 1.9], [4.45, 8.5, 4.75], [1.2, B + 0.05, 4.2]], sag: 0.35 });
    pole('command post', 'net pole', [4.45, 6.6, 4.75], [4.45, 8.56, 4.75], 0.03);
    // what makes it a command post: a board of maps and orders on the wall over the desk, a second set, chairs at the map, tins of ammunition by the rack
    made.push({ t: 'board', room: 'command post', name: 'map board', at: [on(0.08, 0)[0], F2 + b(1.65), R.z1 - b(0.02)], yaw: Math.PI, w: 1.5, h: 0.95 });
    made.push({ t: 'set', kind: 'radio', room: 'command post', name: 'wireless set', at: [on(0.23, 0.2)[0], F2 + desk.top, on(0.23, 0.2)[1]], yaw: 0 });
    // (the chairs at the map: as near the table as they were)
    put('command post', 'painted_wooden_chair_01', 0.4 + b(0.85), 0.3 - b(0.2), F2, -Math.PI / 2 + 0.2);
    put('command post', 'painted_wooden_chair_01', 0.4 - b(0.85), 0.3 + b(0.45), F2, Math.PI / 2 - 0.3);
    made.push({ t: 'tins', room: 'command post', name: 'ammunition tins', at: [2.5, F2, 0.75], yaw: Math.PI / 2, n: 5 });
  }

  // ------------------------------------------------------------------ the hall: the mess
  {
    // the stove against the north wall, between the head of the stair and the window; its flue goes out through the wall
    // (as near the wall as it was: its flue goes through it)
    const s = { x: -2.05, z: R.z0 + b(0.32) }, sb = bh(BODY.wood_stove);
    put('mess', 'wood_stove', s.x, s.z, F1, 0);
    solids.push({ c: [s.x, F1 + sb[1], s.z], h: sb, yaw: 0, surface: 'metal', name: 'stove', room: 'mess' });
    made.push({ t: 'cable', room: 'mess', name: 'flue', pts: [[s.x, F1 + b(1.3), s.z - b(0.05)], [s.x, F1 + 2.25, s.z - b(0.05)], [s.x, F1 + 2.33, R.z0 - 0.1]], r: b(0.065) });
    made.push({ t: 'logs', room: 'mess', name: 'firewood', at: [-2.55, F1, R.z0 + b(0.26)], yaw: 0, wide: 2, high: 5 });
    made.push({ t: 'bulb', room: 'mess', name: 'bulb', at: [1.05, F1 + 1.9, -0.4], drop: 0.45 });
    lights.push({ at: [1.05, F1 + 1.9, -0.4], kind: 'bulb', room: 'mess' });
    // mess tins and mugs left on the fort's long table (whose middle is at 0.3, -0.4, and whose top is 0.8 over the floor)
    for (const [x, z, r, h] of [[-0.4, -0.24, 0.1, 0.11], [0.4, 0.22, 0.045, 0.085], [-1.05, 0.2, 0.045, 0.085], [0.32, -0.26, 0.075, 0.06], [-0.6, 0.28, 0.045, 0.085]]) made.push({ t: 'pot', room: 'mess', name: 'mess tin', at: [0.3 + b(x), F1 + b(0.8), -0.4 + b(z)], r, h });
    // a pot, on the long case by the wall (which stands at 1.75, -2.85); and stores on a shelf under the stair to the upper room
    made.push({ t: 'pot', room: 'mess', name: 'pot', at: [1.75 + b(0.55), F1 + b(0.301), -2.85 - b(0.05)], r: 0.17, h: 0.24 });
    const shelf = { x: 1.75, z: R.z1 - b(0.01) };
    put('mess', 'Shelf_01', shelf.x, shelf.z, F1, Math.PI);
    const surf = { x: shelf.x, z: shelf.z - b(0.13), yaw: 0, hx: 0.43, hz: 0.09, clear: 0.24 };
    lies('mess', 3, surf, F1 + b(0.94), -0.2, { usage: ['Military', 'Hunting'] });
    lies('mess', 3, surf, F1 + b(1.22), 0.18, { usage: ['Military', 'Hunting'] });
  }

  // ------------------------------------------------------------------ the store: the generator and its fuel
  const gen: V3 = [-1.3, 0, 0.55], door: V3 = [K.x1 + 0.08, 0.03, 0.42];
  {
    made.push({ t: 'generator', room: 'store', name: 'generator', at: gen, yaw: 0 });
    solids.push({ c: [gen[0], b(0.36), gen[2]], h: bh([0.52, 0.36, 0.3]), yaw: 0, surface: 'metal', name: 'generator', room: 'store' });
    // its fuel: three drums in the corner over the foot of the stair down (a grenade down that stair is a decision), and jerrycans by it
    put('store', 'Barrel_01', 1.8, -3.05, 0, 0);
    put('store', 'Barrel_01', 2.45, -3.05, 0, Math.PI / 2);
    put('store', 'Barrel_01', 2.12, -2.42, 0, Math.PI);
    put('store', 'metal_jerrycan_green', -1.95, 1.08, 0, 0.5);
    put('store', 'metal_jerrycan_green', -1.58, 1.2, 0, -0.3);
    // the switch box on the east wall, and the cables: to it, and out by the small door
    // (on the wall, as near it as it was)
    put('store', 'utility_box_01', R.x1 - b(0.23), 1.75, 0, -Math.PI / 2);
    made.push({ t: 'cable', room: 'store', name: 'cable', pts: [[gen[0] + b(0.5), b(0.2), gen[2]], [gen[0] + b(0.75), 0.03, gen[2]], [2.2, 0.03, 0.42], [R.x1 - b(0.5), 0.03, 1.75 - b(0.15)], [R.x1 - b(0.44), b(0.7), 1.75 - b(0.05)]] });
    made.push({ t: 'cable', room: 'store', name: 'cable', pts: [[2.2, 0.03, 0.42], door] });
  }

  // ------------------------------------------------------------------ the terrace
  {
    // two ridge tents in the lee of the keep's north wall, their backs to it; a bedroll in each; duckboards before them
    // (each tent the size a tent is, its back as near the wall as it was; the two a fifth further apart)
    const TN = POST.tent, tz = K.z0 - 0.05 - b(TN.wide / 2);
    for (const [x, open] of [[-0.4, 1], [-2.65, -1]] as [number, 1 | -1][]) {
      made.push({ t: 'tent', room: 'terrace', name: 'tent', at: [x, 0, tz], yaw: 0, open });
      // (canvas: it stops a body and not a shot; the mouth of it is left open for a hand)
      solids.push({ c: [x - open * b(0.3), b(0.45), tz], h: bh([TN.long / 2 - 0.35, 0.45, TN.wide / 2 - 0.12]), yaw: 0, feet: true, surface: 'cloth', name: 'tent', room: 'terrace' });
      made.push({ t: 'bedroll', room: 'terrace', name: 'bedroll', at: [x + open * b(0.12), 0, tz + b(0.1)], yaw: 0 });
      lies('terrace', 3, { x: x + open * b(0.12), z: tz + b(0.1), yaw: 0, hx: 0.85, hz: 0.26, clear: 0.6 }, b(0.11), open * 0.62);
    }
    // (before their mouths: a hand off the tents' feet, as they were)
    made.push({ t: 'boards', room: 'terrace', name: 'duckboards', a: [-3.6, 0, tz - b(TN.wide / 2 + 0.22)], b: [1, 0, tz - b(TN.wide / 2 + 0.22)], w: b(0.5) });
    // the cables from the store: out of the small door, along the foot of the keep's east wall both ways. North: under the
    // stair, round the corner (and up it to the roof and the mast) and along the north wall to the floodlight by the tents
    // (a floodlight on legs of its own is as tall as it was: a body's)
    const f1: V3 = [1.45, b(2.25), -5.95], corner: V3 = [K.x1 + 0.06, 0.03, K.z0 - 0.06];
    made.push({ t: 'cable', room: 'terrace', name: 'cable', pts: [door, [K.x1 + 0.06, 0.03, -0.45], corner, [1.6, 0.03, K.z0 - 0.06], [f1[0], 0.03, f1[2] + 0.1], [f1[0], b(0.6), f1[2]]] });
    made.push({ t: 'cable', room: 'roof', name: 'cable up the keep', pts: [corner, [corner[0], B + 0.34, corner[2]], [4.2, B + 0.03, -4.4], [2.95, B + 0.03, -3.3], [2.7, ROOF + 0.03, -3.2], [1.2, ROOF + 0.03, -1.6], [-0.75, ROOF + 0.03, -0.5]] });
    made.push({ t: 'flood', room: 'terrace', name: 'floodlight', at: f1, aim: 207, foot: 0 });
    solids.push({ c: [f1[0], b(0.6), f1[2]], h: bh([0.1, 0.6, 0.1]), yaw: 0, feet: true, surface: 'metal', name: 'floodlight', room: 'terrace' });
    lights.push({ at: f1, kind: 'flood', room: 'terrace' });
    // the flagpole, inside the gate; what is left of the flag
    const fp: V3 = [7.7, 0, 1.5], top = 6.4;
    pole('gate', 'flagpole', fp, [fp[0], top, fp[2]], 0.045, 'steel');
    solids.push({ c: [fp[0], 1.3, fp[2]], h: [0.06, 1.3, 0.06], yaw: 0, surface: 'metal', name: 'flagpole', room: 'gate' });
    made.push({ t: 'sheet', stuff: 'flag', room: 'gate', name: 'flag', p: [[fp[0], top - 0.1, fp[2] + 0.05], [fp[0] - 0.25, top - 0.25, fp[2] + 0.95], [fp[0] - 0.3, top - 1.0, fp[2] + 0.8], [fp[0], top - 0.85, fp[2] + 0.05]], sag: 0.1 });
    // the gate: a wing of sandbags either side of the way in, and bags on the parapet where its merlons came down
    // (north of the gatehouse on the east wall, and by the fire on the north one), to fight from over the ramp
    bags('gate', 'gate sandbags', [[7.35, -3.28], [8.35, -3.28]], 0, 5);
    bags('gate', 'gate sandbags', [[8.15, 0.6], [8.15, 1.7]], 0, 4);
    const ex = C.hx + C.parapet.thick / 2 - 0.5, ez = C.hz + C.parapet.thick / 2 - 0.5;
    bags('gate', 'parapet sandbags', [[ex, -6.6], [ex, -4.5]], 0.72, 2);
    bags('terrace', 'parapet sandbags', [[4.5, -ez], [6.6, -ez]], 0.72, 2);
  }

  // ------------------------------------------------------------------ the dump: crates under a net, in the lee of the keep's east wall
  {
    // (a heap is as close as it was: each thing so far from the first crate, in a body's measure)
    const dx = 5.62, dz = 2.2;
    put('dump', 'wooden_military_crate', dx, dz, 0, Math.PI / 2, { far: 140 });
    put('dump', 'wooden_military_crate', dx, dz + b(1.3), 0, Math.PI / 2, { far: 140 });
    put('dump', 'cardboard_box_01', dx - b(0.02), dz - b(0.15), b(0.465), 0.3, { far: 140 });
    put('dump', 'cardboard_box_01', dx + b(0.04), dz + b(1.55), b(0.465), -0.2, { far: 140 });
    put('dump', 'cardboard_box_01', dx + b(0.5), dz - b(0.25), 0, 0, { far: 140 });
    put('dump', 'barrel_03', dx, dz + b(2.32), 0, 0, { far: 140 });
    made.push({ t: 'tins', room: 'dump', name: 'ammunition tins', at: [dx + b(0.46), 0, dz + b(0.85)], yaw: Math.PI / 2 + 0.2, n: 6 });
    // the net: from the keep's wall down to three poles; the tallest of them carries the floodlight that looks at the gate
    const z0 = 1.5, z1 = 5, xw = K.x1 + 0.04, xp = 6.5, f2: V3 = [xp, 2.6, z0];
    made.push({ t: 'sheet', stuff: 'net', room: 'dump', name: 'net over the dump', p: [[xw, 2.4, z0], [xw, 2.4, z1], [xp, 1.72, z1], [xp, 1.72, z0]], sag: 0.22 });
    pole('dump', 'net pole', [xp, 0, z0], [xp, 2.6, z0], 0.035);
    pole('dump', 'net pole', [xp, 0, (z0 + z1) / 2], [xp, 1.66, (z0 + z1) / 2]);
    pole('dump', 'net pole', [xp, 0, z1], [xp, 1.76, z1]);
    made.push({ t: 'flood', room: 'dump', name: 'floodlight', at: f2, aim: -47 });
    lights.push({ at: f2, kind: 'flood', room: 'dump' });
    made.push({ t: 'cable', room: 'dump', name: 'cable', pts: [door, [K.x1 + 0.06, 0.03, 1.4], [xp - 0.04, 0.03, z0], [xp - 0.04, 2.5, z0]] });
    solids.push({ c: [xp, 0.9, z0], h: [0.05, 0.9, 0.05], yaw: 0, feet: true, surface: 'wood', name: 'net pole', room: 'dump' });
  }

  // ------------------------------------------------------------------ the towers
  {
    // NORTH-EAST, over the ramp and the north shelf: the sniper's nest, up on its platform. A low bench of boards with
    // the rifle on it, bags laid in three of the gaps of its rim, a net over the side of the field
    const ne = tower('north-east tower'), D = T.deck, rin = T.r - T.wall;
    const [bx, bz] = round(ne, 300, 1.72), yaw = -rad(300 + 90);
    made.push({ t: 'table', room: "sniper's nest", name: 'rifle bench', at: [bx, D, bz], yaw, w: 1, d: 0.36, h: 0.5 });
    solids.push({ c: [bx, D + b(0.25), bz], h: bh([0.5, 0.25, 0.18]), yaw, surface: 'wood', name: 'rifle bench', room: "sniper's nest" });
    const surf = { x: bx, z: bz, yaw, hx: 0.44, hz: 0.14, clear: 1 };
    lies("sniper's nest", 4, surf, D + b(0.5), -0.2, { arms: 'guns' });
    lies("sniper's nest", 4, surf, D + b(0.5), 0.26);
    const [tx, tz] = round(ne, 268, 1.85), [kx, kz] = round(ne, 332, 1.75);
    made.push({ t: 'tins', room: "sniper's nest", name: 'ammunition tins', at: [tx, D, tz], yaw: -rad(268 + 90), n: 3 });
    put("sniper's nest", 'folded_blanket', kx, kz, D, 0.8);
    for (const slot of [1, 19, 21]) {
      const a = (slot + 0.5) * (360 / T.slots), y = ne.rim[slot], [ax, az] = round(ne, a - 5.5, rin + 0.45), [cx, cz] = round(ne, a + 5.5, rin + 0.45);
      made.push({ t: 'bags', room: "sniper's nest", name: 'bags in the rim', pts: [[ax, az], [cx, cz]], y, courses: 1 });
    }
    const at = (a: number, r: number, y: number): V3 => [round(ne, a, r)[0], y, round(ne, a, r)[1]], stub = (a: number) => ne.rim[Math.floor(a / (360 / T.slots)) % T.slots] + 0.04, top = Math.max(stub(247), stub(338)) + 0.2;
    made.push({ t: 'sheet', stuff: 'net', room: "sniper's nest", name: 'net over the nest', p: [at(247, rin + 0.35, stub(247)), at(338, rin + 0.35, stub(338)), at(15, 0.75, top), at(230, 0.75, top)], sag: 0.2 });
    for (const a of [15, 230]) pole("sniper's nest", 'net pole', at(a, 0.75, D), at(a, 0.75, top + 0.05));

    // SOUTH-WEST, whose wall has fallen to the field: the bunk room, on its floor. Canvas hung across the gap on poles
    // (it hides whoever is on the stair and stops nothing), a bedroll under the high part of the stair, a bulb
    const sw = tower('south-west tower'), swAt = (a: number, r: number, y: number): V3 => [round(sw, a, r)[0], y, round(sw, a, r)[1]];
    for (const [a0, a1] of [[140, 187], [187, 234]]) made.push({ t: 'sheet', stuff: 'tarp', room: 'bunk room', name: 'canvas over the fallen wall', p: [swAt(a0, T.r - 0.25, 4.5), swAt(a1, T.r - 0.25, 4.5), swAt(a1, T.r - 0.2, 0.95), swAt(a0, T.r - 0.2, 0.95)], sag: 0.1 });
    for (const a of [140, 187, 234]) pole('bunk room', 'canvas pole', swAt(a, T.r - 0.25, 0.4), swAt(a, T.r - 0.25, 4.6));
    const [rx, rz] = round(sw, 250, 1.65), ryaw = -rad(250 + 90);
    made.push({ t: 'bedroll', room: 'bunk room', name: 'bedroll', at: [rx, 0.06, rz], yaw: ryaw });
    lies('bunk room', 3, { x: rx, z: rz, yaw: ryaw, hx: 0.85, hz: 0.26, clear: 0.6 }, 0.06 + b(0.11), 0.5);
    const [fx, fz] = round(sw, 214, 1.6);
    put('bunk room', 'folded_blanket', fx, fz, 0.06, ryaw + 0.5);
    const lamp = swAt(285, rin - 0.25, 2.1);
    made.push({ t: 'bulb', room: 'bunk room', name: 'bulb', at: lamp, drop: 0.3 });
    lights.push({ at: lamp, kind: 'bulb', room: 'bunk room' });

    // NORTH-WEST, whose boards have a hole in them: the signals' own, up on its platform. A table with a set and a
    // telephone, a whip aerial on the rim, and the wire from here to the keep
    const nw = tower('north-west tower'), nwAt = (a: number, r: number, y: number): V3 => [round(nw, a, r)[0], y, round(nw, a, r)[1]];
    const [sx, sz] = round(nw, 235, 1.68), syaw = -rad(235 + 90), rim = nw.rim[Math.floor(222 / (360 / T.slots))];
    void nwAt;
    made.push({ t: 'table', room: 'signals tower', name: 'signals table', at: [sx, D, sz], yaw: syaw, w: 0.95, d: 0.45, h: 0.74 });
    solids.push({ c: [sx, D + b(0.37), sz], h: bh([0.475, 0.37, 0.225]), yaw: syaw, surface: 'wood', name: 'signals table', room: 'signals tower' });
    made.push({ t: 'set', kind: 'radio', room: 'signals tower', name: 'wireless set', at: [sx + b(0.26) * Math.cos(syaw), D + b(0.74), sz - b(0.26) * Math.sin(syaw)], yaw: syaw + Math.PI });
    const ssurf = { x: sx, z: sz, yaw: syaw, hx: 0.42, hz: 0.18, clear: 1 };
    lies('signals tower', 3, ssurf, D + b(0.74), -0.37);
    lies('signals tower', 3, ssurf, D + b(0.74), -0.03);
    made.push({ t: 'whip', room: 'signals tower', name: 'aerial', at: nwAt(222, rin + 0.45, rim), h: 4.2 });
    const rimAt = (a: number) => nw.rim[Math.floor(a / (360 / T.slots)) % T.slots] + 0.04;
    made.push({ t: 'cable', room: 'signals tower', name: 'wire to the keep', pts: [[sx, D + b(0.78), sz], nwAt(210, rin - 0.05, D + 0.04), nwAt(170, rin - 0.05, D + 0.04), nwAt(128, rin - 0.05, D + 0.04), nwAt(126, rin + 0.05, rimAt(126)), nwAt(126, rin + 0.4, rimAt(126)), nwAt(100, rin + 0.45, rimAt(100)), nwAt(80, rin + 0.45, rimAt(80)), nwAt(62, rin + 0.5, rimAt(62)), [K.x0 - 0.04, B + 0.2, K.z0 + 0.6]], sag: 0.5 });
  }

  // ------------------------------------------------------------------ the old village on the crest
  {
    const hs = loose.filter((l) => l.kind === 'house');
    if (hs.length) {
      // the burial ground: six graves in two rows before the nearest house to the fort, on the side of the fort
      const near = hs.reduce((a, b) => (Math.hypot(a.x, a.z) < Math.hypot(b.x, b.z) ? a : b)), sh = HOUSES[near.n % HOUSES.length], c = Math.cos(near.rot), s = Math.sin(near.rot);
      // (a grave's cross is at the end of it that is toward the fort: see GRAVE)
      const side = Math.sign(-(near.x * c - near.z * s)) || -1, turn = near.rot + (side > 0 ? Math.PI : 0);
      for (let k = 0; k < 6; k++) {
        const lx = side * (sh.w / 2 + 2.2 + Math.floor(k / 3) * 2.5), lz = -6 + (k % 3) * 1.5, x = near.x + lx * c + lz * s, z = near.z - lx * s + lz * c;
        made.push({ t: 'grave', room: 'village', name: 'grave', at: [x, 0, z], yaw: turn + (k ? ((k * 0.37) % 0.3) - 0.15 : 0), sits: true, ...(k ? {} : { plumb: true }) });
      }
      // (a helmet on the first of them)
      // (a grave is a body's: its cross is as far from its middle, and as tall, as it was)
      const hl = side * (sh.w / 2 + 2.2 + b(GRAVE.cross)), [hx, hz] = [near.x + hl * c - 6 * s, near.z - hl * s - 6 * c];
      put('village', 'helmet_m1', hx, hz, b(GRAVE.high - 0.03), near.rot + 1.2, { sits: true, far: 60 });
      // the picket: past the house furthest from the fort, where the path comes up: a half round of sandbags open to the fort, a fire ring, a crate
      const last = hs.reduce((a, b) => (Math.hypot(a.x, a.z) > Math.hypot(b.x, b.z) ? a : b)), lh = HOUSES[last.n % HOUSES.length], lc = Math.cos(last.rot), ls = Math.sin(last.rot);
      const out = Math.sign(last.x * lc - last.z * ls) || 1, px = last.x + out * (lh.w / 2 + 5.5) * lc, pz = last.z - out * (lh.w / 2 + 5.5) * ls, face = Math.atan2(pz, px);
      const arc: [number, number][] = [];
      for (let k = 0; k <= 6; k++) arc.push([px + Math.cos(face - rad(100) + rad((200 * k) / 6)) * 1.7, pz + Math.sin(face - rad(100) + rad((200 * k) / 6)) * 1.7]);
      bags('village', 'picket', arc, 0, 3, true);
      put('village', 'campfire_ring_cold', px - Math.cos(face) * 0.2, pz - Math.sin(face) * 0.2, 0, 0, { sits: true, far: 140 });
      put('village', 'wooden_crate_01', px + Math.cos(face + 0.9) * 0.95, pz + Math.sin(face + 0.9) * 0.95, 0, 0.5, { sits: true, far: 140 });
    }
  }
  return { stood, made, solids, spots, lights };
}

let own: Plan | null = null;
const plan = (loose?: Loose[]): Plan => (loose ? lay(loose) : (own ??= lay(LOOSE)));
/** the ground of the world, said in the fort's own measure: over the terrace */
const over = (p: Place, ground?: GroundAt) => (ground ? (x: number, z: number) => { const [wx, , wz] = castleAt(p, x, z); return (ground(wx, wz) - p.y) / CASTLE_SCALE; } : undefined);
const local = (p: Place, loose?: Loose[]) => (loose ? looseLocal(p, loose) : undefined);

/** What is made by hand, in the fort's own measure: for whoever draws it. */
export function postMade(loose?: Loose[]): Made[] {
  return plan(loose).made;
}
/** What of the post stops a body, in the fort's own measure. (What is off the shelf and solid in the world's own list is the world's to make solid.) */
export function postSolids(loose?: Loose[]): PostSolid[] {
  return plan(loose).solids;
}
/** Its lamps, in the fort's own measure: floodlights and bulbs, which burn on the generator after dusk, and the mast's red light. */
export function postLights(): PostLight[] {
  return plan().lights;
}
/** What stands in each room off the shelf, in the fort's own measure. */
export function postRooms(loose?: Loose[]): { room: Room; kind: string; x: number; y: number; z: number; rot: number; sits?: boolean }[] {
  return plan(loose).stood;
}

/** What stands in the post off the shelf, as the world's own list of such things has them. @param ground the height of the world's ground at a spot (what is in the village stands on it) */
export function postProps(p: Place, ground?: GroundAt, loose: Loose[] = castleLoose(p)): { kind: string; x: number; y: number; z: number; rot: number; scale: number; far: number }[] {
  const g = over(p, ground) ?? castleGround;
  return plan(local(p, loose)).stood.map((s) => {
    const [x, y, z] = castleAt(p, s.x, s.z, s.sits ? g(s.x, s.z) + s.y : s.y);
    return { kind: s.kind, x, y, z, rot: p.rot + s.rot, scale: 1, far: s.far ?? 90 };
  });
}

/** Every place of the post a thing can lie, as places in the world: each on something, at its height, on the step of the map its room is. */
export function postLoot(p: Place, _ground?: GroundAt, loose: Loose[] = castleLoose(p)): PostLoot[] {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return plan(local(p, loose)).spots.map((s) => {
    const [x, y, z] = castleAt(p, s.x, s.z, s.y), [sx, , sz] = castleAt(p, s.surf.x, s.surf.z);
    // (every place inside the walls is of the fourth step: the owner, 2026-10-13: "castle is T4 loot"; what lies in the hamlet before the gate is the hamlet's)
    // (a surface is a body's: its half sizes are metres of the world as they are said, whatever the fort's scale)
    return { x: r3(x), y: r3(y) + 0.003, z: r3(z), usage: s.usage, building: s.room === 'village' ? 'hamlet' : 'castle', floor: false, tier: s.room === 'village' ? s.tier : 4, room: s.room, ...(s.arms ? { arms: s.arms } : {}), surf: { x: sx, z: sz, rot: p.rot + s.surf.yaw, hx: s.surf.hx, hz: s.surf.hz, clear: s.surf.clear } };
  });
}

/** Where its lamps are, as places in the world: the floodlights and the bulbs. (The mast's light is `postBeacon`: it is not in the fort, it is over it.) */
export function postLamps(p: Place): V3[] {
  return plan().lights.filter((l) => l.kind !== 'beacon').map((l) => castleAt(p, l.at[0], l.at[2], l.at[1]));
}
/** The mast's red light, as a place in the world. */
export function postBeacon(p: Place): V3 {
  const l = plan().lights.find((q) => q.kind === 'beacon')!;
  return castleAt(p, l.at[0], l.at[2], l.at[1]);
}
