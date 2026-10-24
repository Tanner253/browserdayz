// The fort's parts: its whole layout (walls, keep, gatehouse, stairs, vaults), the kit pieces, its door, the rock it stands on, its fire baskets, furniture and lamps.
// (One part of castle.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { KIT_MERLON, type KitPiece, KIT_LEVELS, type Cut, cutBox, KIT_GATE, cutRound, cutTurned, KIT_TOWER } from '../kit';
import { ARCADE, CASTLE, FAN, OUTCROP, POSTERN, UNDER, body, castleGround, hash, moundTop, northFace, tower, type Beam, type Box, type Flight, type Lump, type Opening, type Paint, type Part, type Rail, type V3 } from './plan';
import type { hatchLine } from './loose';

// ------------------------------------------------------------------ the whole of it, piece by piece

let made: Part[] | null = null;

/** Every piece of the fort, its ramp, the rock the ramp leaves from and the rubble under the breach. (Worked out once: it is the same every time. The loose pieces of its grounds are apart: see `looseParts`.) */
export function castleParts(): Part[] {
  return (made ??= layOut());
}

/** the kit's wall as the fort stands it: how far its foot stands out from the face of its parapet, how deep it is at the foot, and how far along a side one length of it reaches either way from the middle */
export const WALL = { out: 0.94, deep: 2.55, half: 7.41 };

/** the angle between two sides of the kit's round tower (it has 32) */
const SIDE = (2 * Math.PI) / 32;

/** the gatehouse: the kit's gate, made this big, stood on the east wall's top over the head of the ramp */
const GATEHOUSE = { scale: 0.63 };

/** the door in it: the castle door made this big; where its threshold is (how far in from the middle of the east wall's parapet), how wide a leaf is then, and how far the leaf that still hangs is swung in from shut (radians) */
const DOOR = { scale: 1.1, x: CASTLE.hx - 0.3, leaf: 1.1, swing: 0.95 };

/**
 * What is gone from the parapet of each side, along it (toward +x on the north and south walls, toward +z on the
 * others): [from, to, whether it is one whole merlon (its stump is left on the parapet) or a length of the parapet
 * itself, gone to the walk]. A merlon stands every 3.7 m, four to a side; the gatehouse stands where the east
 * wall's third was. A ruin falls from the top down: the walls under them all stand.
 */
function gaps(side: 'n' | 's' | 'e' | 'w'): [number, number, boolean][] {
  const M = KIT_MERLON;
  /** the merlon that is `k` along the kit's own piece, as the piece is stood on this side: the north and east walls run toward less */
  const merlon = (k: number): [number, number] => (side === 'n' || side === 'e' ? [WALL.half - M.from - k * M.every - M.long, WALL.half - M.from - k * M.every] : [-WALL.half + M.from + k * M.every, -WALL.half + M.from + k * M.every + M.long]);
  const one = (k: number): [number, number, boolean] => [merlon(k)[0], merlon(k)[1], true];
  if (side === 'n') return [[merlon(3)[0] - 0.02, merlon(2)[1] + 0.02, false], one(0)];
  if (side === 's') return [one(0), one(1)];
  if (side === 'e') return [one(3), [UNDER.rent.z1, merlon(0)[1] + 0.02, false]];
  return [one(2)];
}

/**
 * THE FORT'S STONE THAT IS THE KIT'S (2026-10-13): its four walls, the foot of each tower, and the gatehouse over
 * the ramp, as a layout of the fort kit's pieces (src/sim/kit.ts), in the fort's own measure [x, y over the
 * terrace, z]. Ruined with the kit: merlons and lengths of parapet broken out, the east wall broken out to the
 * cellars' floor where it fell (the rent), and blocks of the same wall lying where they came down. Everything
 * else of the fort is its own geometry (the keep, the drums of the towers, every floor and stair, the lower levels).
 * What stops a body for these is `kitSolids` of this list, but for the towers' feet, which have the fort's own.
 */
export function castleKit(): KitPiece[] {
  const C = CASTLE, U = UNDER, T = C.tower, ex = C.hx + C.parapet.thick / 2, ez = C.hz + C.parapet.thick / 2, xo = ex + WALL.out, zo = ez + WALL.out, y0 = -KIT_LEVELS.walk;
  const out: KitPiece[] = [];
  // WHERE A PARAPET IS GONE IT IS CUT FROM A HAIR OVER THE WALK'S TOP, AND THE WALK'S TOP IS LEFT. The kit's walk is at
  // 7.08486 in the piece's own measure (0.0049 here), and runs on under the parapet: cut from 0.004 it went with the
  // parapet, and nothing was drawn underfoot in the gate's passage or along the north wall's gap: the eye went down
  // the hollow wall to its footing. (It was cut so low to be rid of the parapet's underside, which lay in the walk's
  // very plane and flickered: that is taken out of the piece itself now, see `backedOut` in the kit.)
  const gone = 0.0055;
  /** the parapet of a side, cut where it is gone: across the whole of its thickness, from the walk up (a merlon: from the parapet's top up) */
  const top = (side: 'n' | 's' | 'e' | 'w'): Cut[] => gaps(side).map(([u0, u1, whole]) => {
    const lo = whole ? KIT_LEVELS.parapet - KIT_LEVELS.walk - 0.02 : gone;
    const cut = side === 'n' ? cutBox(u0, u1, lo, 4, -ez - 0.2, -ez + 1.3) : side === 's' ? cutBox(u0, u1, lo, 4, ez - 1.3, ez + 0.2) : side === 'e' ? cutBox(ex - 1.3, ex + 0.2, lo, 4, u0, u1) : cutBox(-ex - 0.2, -ex + 1.3, lo, 4, u0, u1);
    // WHAT IS BROKEN OFF LEAVES STONE, NOT A HOLE (see `KitCaps`). A merlon is one hollow skin with the parapet under
    // it: broken off, the parapet was a trough a forearm deep with the walk at the bottom of it; it is closed level
    // where it broke. A parapet gone to the walk has the walk under it: only its two broken ends are closed.
    return { ...cut, cap: whole ? ('all' as const) : ('upright' as const) };
  });
  const wall = 'fort_wall_thin_straight_01', gh = GATEHOUSE.scale, gz = (C.gate.z0 + C.gate.z1) / 2, g0 = gz + ((KIT_GATE.z0 + KIT_GATE.z1) / 2) * gh;
  out.push({ id: wall, name: 'north wall', at: [WALL.half, y0, -zo], turn: -Math.PI / 2, cut: top('n') });
  out.push({ id: wall, name: 'south wall', at: [-WALL.half, y0, zo], turn: Math.PI / 2, cut: top('s') });
  out.push({ id: wall, name: 'west wall', at: [-xo, y0, -WALL.half], turn: 0, cut: [...top('w'), cutBox(-xo - 0.3, -U.x + 0.1, U.floor - 0.02, U.floor + 2.07, U.goat.z0, U.goat.z1)] });
  // (the east wall: its parapet is gone under the gatehouse, which stands in its place; and a length of it fell out to the cellars' floor)
  out.push({ id: wall, name: 'east wall', at: [xo, y0, WALL.half], turn: Math.PI, cut: [...top('e'), cutBox(ex - 1.3, ex + 0.2, gone, 4, g0 - 7.41 * gh, g0), cutBox(U.x - 0.3, xo + 0.5, U.floor + 0.1, 4, U.rent.z0, U.rent.z1)] });
  // the gatehouse: its foot is the east wall's top; the sill across its passage is taken out, and the ramp's boards run through
  out.push({ id: 'fort_wall_thin_gate_01', name: 'gatehouse', at: [ex, 0, g0], turn: Math.PI, scale: gh, cut: [cutBox(ex - WALL.deep * gh - 0.1, ex + 0.2, -0.05, (KIT_GATE.sill + 0.06) * gh + 0.02, g0 - KIT_GATE.z1 * gh - 0.02, g0 - KIT_GATE.z0 * gh + 0.02)] });
  // the foot of each tower: the kit's round tower, its platform level with the terrace. Taken out of it: its middle
  // (the drum stands there, with its own floor), all of its top that is on the terrace's side of the walls, and,
  // of the hollow one, a doorway from its cellar to the lower levels.
  const px = ex + WALL.out - WALL.deep, pz = ez + WALL.out - WALL.deep;
  for (const tw of castleParts()) {
    if (tw.t !== 'tower') continue;
    // (the two that take its top off on the terrace's side are closed with stone where they go through it: the broken
    // ends of its ring of wall, and its top a hand under the terrace. Not the round one: the drum's own floor is there.)
    const cut: Cut[] = [cutRound(tw.cx, tw.cz, T.r - T.wall + 0.04, -0.06, 4), { ...(tw.cx > 0 ? cutBox(-60, px, -0.05, 4, -60, 60) : cutBox(-px, 60, -0.05, 4, -60, 60)), cap: 'all' }, { ...(tw.cz > 0 ? cutBox(-60, 60, -0.05, 4, -60, pz) : cutBox(-60, 60, -0.05, 4, -pz, 60)), cap: 'all' }];
    const d = (tw.door * Math.PI) / 180;
    // (as wide as the doorway's own lining and a hair more, 0.55 either side: wider, and beside the lining the foot was looked into. See the cellar in `towerSteps`.)
    if (tw.hollow !== undefined) cut.push(cutTurned(tw.cx + Math.cos(d) * 3.3, tw.cz + Math.sin(d) * 3.3, Math.PI / 2 - d, 1.9, 0.553, tw.hollow - 0.03, tw.hollow + 2.2));
    // (and nothing of the kit's foot is in the cellar, or within a hand of its wall, which bellies: a block of it stood out of the wall over the doorway)
    if (tw.hollow !== undefined) cut.push(cutRound(tw.cx, tw.cz, T.r - T.wall + 0.3, tw.hollow - 0.05, -0.055));
    const turn = (tw.cx * 7 + tw.cz * 3) * 0.1;
    out.push({ id: 'fort_tower_round', name: tw.name, at: [tw.cx, -KIT_TOWER.top[0] * T.kit, tw.cz], scale: T.kit, turn, cut, body: false });
    // ITS FOOTING: the same tower again under that one's foot, a little bigger (`under`), with everything of it over
    // that foot taken off: so its wall, at the size it has just under its platform, is where the upper one's foot is,
    // and from there it leans out and down eight metres more. The real hill falls away under the two towers on the
    // valley side to twelve metres under the terrace; a plain dark drum of the fort's own stood in the air there.
    // (Closed with stone where it is cut: left open, a ring a few fingers wide showed down into it round the foot over
    // it. And turned as the one over it is, but by whole sides of the kit's tower, which has 32: turned anyhow, each
    // one's corners stood out over the other's flats all round the join.)
    const kf = -KIT_TOWER.top[0] * T.kit;
    out.push({ id: 'fort_tower_round', name: `${tw.name} footing`, at: [tw.cx, kf - KIT_TOWER.top[0] * T.under, tw.cz], scale: T.under, turn: turn + Math.round(((tw.cx * 3 - tw.cz * 5) * 0.1 + 1.3 - turn) / SIDE) * SIDE, cut: [{ ...cutBox(tw.cx - 9, tw.cx + 9, kf + 0.01, 8, tw.cz - 9, tw.cz + 9), cap: 'all' as const }], body: false });
  }
  // blocks of the wall, lying where they came down: under the rent, and under the breach
  const block = (x: number, z: number, y: number, turn: number, tilt: [number, number], scale: number) => void out.push({ id: 'fort_wall_thick_end_01', name: 'fallen wall', at: [x, y, z], turn, tilt, scale });
  block(12.6, U.rent.z1 + 1.5, moundTop('rent', 12.9, U.rent.z1 + 1.6) - 0.25, 0.5, [1.25, 0.2], 0.17);
  block(15.3, U.rent.z1 + 2.3, moundTop('rent', 15.5, U.rent.z1 + 2.2) - 0.3, 2.1, [-1.4, 0.35], 0.14);
  block(-1.6, -ez - 3.4, moundTop('fan', -1.2, -ez - 3.2) - 0.3, 1.2, [1.35, -0.3], 0.16);
  return out;
}

/** The door at the gate, as a layout of the castle door's own pieces: its frame in the passage, one leaf hung open inward against the passage's wall, one off its hinges and lying on the paving inside. */
export function castleDoor(): KitPiece[] {
  const C = CASTLE, s = DOOR.scale, gz = (C.gate.z0 + C.gate.z1) / 2, turn = Math.PI / 2;
  return [
    { id: 'large_castle_door_frame', at: [DOOR.x, 0, gz], turn, scale: s, body: false },
    // (the leaf whose hinge is on the south side, swung in until it lies along that wall of the passage)
    { id: 'large_castle_door_left', at: [DOOR.x, 1.165 * s, gz + 0.987 * s], turn: turn + DOOR.swing, scale: s, body: false },
    { id: 'large_castle_door_right', at: [DOOR.x - 2.3, 0.07, gz + 0.5], turn: 0.5, tilt: [Math.PI / 2, 0], scale: s, body: false },
  ];
}

/**
 * Scanned rock, as a layout of the rock face's one piece: round the rock the ramp leaves from, and under the north
 * and south walls where the hill falls away from their feet. Each is a sheet that leans back from its foot, its
 * face toward where it is turned to: it is bedded against the made rock and the footings, which are what stop a
 * body. `ground` is how high the ground is at a spot, over the terrace.
 */
export function castleRocks(ground: (x: number, z: number) => number = castleGround, rock = true): KitPiece[] {
  const C = CASTLE, O = OUTCROP, out: KitPiece[] = [], zo = C.hz + C.parapet.thick / 2 + WALL.out;
  /** one of them: where the middle of its foot is on the plan, which way it faces (degrees: 0 east, 90 south), how big, and how much steeper than it came it stands */
  const face = (x0: number, z0: number, toward: number, scale: number, steep = 0.3, sink = 0.25, proud = 1.5) => {
    // (it stands so far out from where it was asked for, the way it faces: it leans back, and what it leans on is behind its top, not its foot)
    const a = (toward * Math.PI) / 180, turn = Math.atan2(Math.cos(a), Math.sin(a)), x = x0 + Math.cos(a) * proud, z = z0 + Math.sin(a) * proud;
    // (not where the ground falls away before it: the world's own cliff is rock already, and a sheet stood at its lip hangs out over it in the air)
    if (ground(x, z) - Math.min(ground(x + Math.cos(a) * 4, z + Math.sin(a) * 4), ground(x + Math.cos(a) * 6.5, z + Math.sin(a) * 6.5)) > 4) return;
    // (its own origin is to one side of its middle: it is set so that its middle is where it was asked for)
    const off = -0.35 * scale;
    // (it stops a body as the rock it is: `KIT_ROCK` in the kit. It stopped nothing, and was walked through.)
    out.push({ id: 'rock_face_01', at: [x + Math.cos(turn) * off, ground(x, z) - sink * scale, z - Math.sin(turn) * off], turn, tilt: [steep, 0], scale });
  };
  if (rock) {
    face((O.x0 + O.x1) / 2, O.z1 + 0.6, 90, 1.5, 0.42);
    face((O.x0 + O.x1) / 2 + 0.6, O.z0 - 1.2, 270, 1.5, 0.42);
    face(O.x1 + 1.6, O.z0 - 0.4, 310, 1.3, 0.35);
    face(O.x1 + 1.6, O.z1 + 0.2, 50, 1.3, 0.35);
  }
  // (under the south wall only: under the north one the rubble of the breach lies along the whole of it, and that is walked)
  for (const x of [-4.4, 4.2]) face(x + 0.8, zo - 0.4, 90, 1.3, 0.5, 0.3, 1.9);
  return out;
}

function layOut(): Part[] {
  const C = CASTLE, P = C.parapet, K = C.keep, R = K.room, parts: Part[] = [];
  const box = (paint: Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: Partial<Box> = {}) => void parts.push({ t: 'box', paint, x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), ...o });
  const beam = (a: V3, b: V3, w: number, h: number, o: Partial<Beam> = {}) => void parts.push({ t: 'beam', paint: 'timber', a, b, w, h, body: 'none', ...o });
  const rail = (a: V3, b: V3, o: Partial<Rail> = {}) => void parts.push({ t: 'rail', paint: 'timber', a, b, body: 'feet', ...o });
  const flight = (foot: V3, head: V3, w: number, o: Partial<Flight> = {}) => void parts.push({ t: 'flight', paint: 'timber', foot, head, w, body: 'feet', ...o });
  const lump = (x: number, y: number, z: number, rx: number, ry: number, rz: number, seed: number, o: Partial<Lump> = {}) => void parts.push({ t: 'lump', paint: 'rock', x, y, z, rx, ry, rz, seed, ...o });
  /** what is left of lo..hi when the stretches in `cut` are taken out of it */
  const spans = (lo: number, hi: number, cut: [number, number][]) => {
    const out: [number, number][] = [];
    let from = lo;
    for (const [a, b] of [...cut].sort((p, q) => p[0] - q[0])) {
      if (a > from) out.push([from, Math.min(a, hi)]);
      from = Math.max(from, b);
    }
    if (from < hi) out.push([from, hi]);
    return out.filter(([a, b]) => b - a > 0.02);
  };

  // ---- the terrace: one floor, from wall to wall, and the keep stands on it
  const ex = C.hx + P.thick / 2, ez = C.hz + P.thick / 2;
  const U = UNDER;
  /** a floor from corner to corner less the holes in it ([x0, x1, z0, z1] each), as blocks */
  const tiles = (x0: number, x1: number, z0: number, z1: number, holes: number[][]) => {
    const cutsOf = (lo: number, hi: number, k: number) => [...new Set([lo, hi, ...holes.flatMap((h) => [h[k], h[k + 1]])])].filter((v) => v >= lo && v <= hi).sort((p, q) => p - q);
    const xs = cutsOf(x0, x1, 0), zs = cutsOf(z0, z1, 2), out: number[][] = [];
    for (let j = 0; j + 1 < zs.length; j++) {
      let run: number[] | null = null;
      for (let i = 0; i + 1 < xs.length; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
        if (holes.some((h) => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3])) run = null;
        else if (run) run[1] = xs[i + 1];
        else out.push((run = [xs[i], xs[i + 1], zs[j], zs[j + 1]]));
      }
    }
    return out;
  };
  // (its holes: the fallen bay, the stair down from the store, the gratings, and the corner of it that is under the hole in the north-west tower's boards)
  const DR = U.cistern.drop;
  // (THE CORNER UNDER THE NORTH-WEST TOWER: all of the paving that is inside the round of its cellar, and a hand more,
  // for the cellar's wall bellies. The paving ends at the inner faces of the kit's walls, and one hole said from the
  // walls' outer faces to 8.8 and 8.9 took nothing out of it: its corner stood in the cellar under the boards, a block
  // of stone a metre deep hung over the doorway. Three pieces, stepped round the cellar; none of them reaches out from
  // under the tower's own wall but at its door, where the tower's boards run on over them: see `towerSteps`.)
  const nwx = -C.hx, nwz = -C.hz;
  const holes = [[DR.x0, DR.x1, DR.z0, DR.z1], [U.x, ex, U.rent.z0, U.rent.z1], [U.bay.x0, U.bay.x1, U.bay.z0, U.bay.z1], [U.stair.head, U.stair.open, R.z0, R.z0 + 1], ...U.gratings.map(([x, z]) => [x - 0.45, x + 0.45, z - 0.45, z + 0.45]), [-ex, nwx + 1.94, -ez, nwz + 1.56], [-ex, nwx + 1.56, -ez, nwz + 1.94], [-ex, nwx + 1.76, -ez, nwz + 1.76]];
  // (as far as the inner face of the kit's walls: their own tops, level with it, are the rest)
  const px = ex + WALL.out - WALL.deep + 0.02, pz = ez + WALL.out - WALL.deep + 0.02;
  for (const [x0, x1, z0, z1] of tiles(-px, px, -pz, pz, holes)) box('paving', x0, x1, U.roof, 0, z0, z1, { name: 'terrace', at: 'both' });
  // a grating: bars a hand apart. A body goes over it; a shot goes through
  for (const [x, z] of U.gratings) {
    for (let k = -2; k <= 2; k++) beam([x - 0.47, -0.035, z + k * 0.19], [x + 0.47, -0.035, z + k * 0.19], 0.035, 0.05, { paint: 'iron', name: 'grating' });
    for (const k of [-1, 1]) beam([x + k * 0.3, -0.06, z - 0.47], [x + k * 0.3, -0.06, z + 0.47], 0.05, 0.03, { paint: 'iron', name: 'grating' });
    box('iron', x - 0.47, x + 0.47, -0.07, 0, z - 0.47, z + 0.47, { hidden: true, body: 'feet', name: 'grating' });
  }

  // ---- UNDER IT: THE VAULTS (see UNDER). All of it is `low`: drawn only while somebody is near enough to see into it.
  const lbox = (paint: Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: Partial<Box> = {}) => box(paint, x0, x1, y0, y1, z0, z1, { low: true, ...o });
  const PS = U.postern, UF = U.floor, CI = U.cistern, CF = UF - CI.deep, G = U.goat, M = U.mid;
  // (every vault springs from its walls at one height, and every arch that carries one has its crown there: an arch that stood higher would be cut by the vault it carries)
  const SPRING = UF + 2.05;
  // its floors: the cistern's, a knee under the rest; and the rest (open over the stair down to the sally port)
  for (const [x0, x1, z0, z1] of tiles(-U.x - 0.4, CI.x1, -U.z - 0.4, CI.z1, [])) lbox('paving', x0, x1, CF - 0.5, CF, z0, z1, { name: 'cistern floor', tone: 0.7 });
  for (const [x0, x1, z0, z1] of tiles(-U.x - 0.4, U.x + 0.4, -U.z - 0.4, U.z + 0.4, [[-U.x - 0.4, CI.x1, -U.z - 0.4, CI.z1], [K.x0, CI.x1, CI.z1 - 0.01, CI.z1 + 0.1], [PS.x0, PS.x1, PS.head, PS.end]])) lbox('paving', x0, x1, UF - 0.5, UF, z0, z1, { name: 'undercroft floor', tone: 0.82 });
  // (Its edge along the cistern is inside the thickness of the keep's north foundation, not in the plane of that wall's
  // face; and no wall of the lower levels has a sill or a top in the plane of it: each either stands from under it
  // with its doorways cut from its own foot, or has a threshold a finger proud. Two faces in one plane are drawn
  // turn and turn about, and were seen to: 2026-10-13, "many textures are overlapping in the castle".)
  // its outer walls (each ends where the foot of a tower comes into the corner: that is the wall there). The west
  // one has the postern's doorway in it; the east one is gone where it fell out.
  const WE = 7.05;
  lbox('stone', -WE, WE, CF, U.roof, -U.z - 0.6, -U.z, { name: 'undercroft wall' });
  lbox('stone', -WE, WE, UF, U.roof, U.z, U.z + 0.6, { name: 'undercroft wall' });
  lbox('stone', -U.x - 0.6, -U.x, CF, U.roof, -WE, G.z0, { name: 'undercroft wall' });
  lbox('stone', -U.x - 0.6, -U.x, UF, U.roof, G.z1, WE, { name: 'undercroft wall' });
  lbox('stone', -U.x - 0.6, -U.x, UF + 2.05, U.roof, G.z0, G.z1, { name: 'undercroft wall' });
  lbox('stone', U.x, U.x + 0.6, UF, U.roof, -WE, U.rent.z0, { name: 'undercroft wall' });
  lbox('stone', U.x, U.x + 0.6, UF, U.roof, U.rent.z1, WE, { name: 'undercroft wall' });

  // THE CISTERN: its water, a row of pillars down the middle of it, and under the hole in the terrace walk the
  // stone that fell in, standing out of the water (somewhere to land, and to be seen landing)
  lbox('water', -U.x, CI.x1, CF + 0.02, UF + CI.water, -U.z, CI.z1, { name: 'water', body: 'none' });
  // (an arcade down the middle of it: five piers and the arches between them, which its two vaults spring from)
  parts.push({ t: 'wall', paint: 'stone', low: true, name: 'cistern arcade', a: [-U.x, ARCADE.z], b: [CI.x1, ARCADE.z], y0: CF, top: U.roof, thick: ARCADE.thick, openings: ARCADE.arches.map(([u0, u1]) => ({ u0, u1, y0: CF - 0.05, y1: SPRING, arch: true, rise: 0.55 })) });
  // THE VAULTS' ROOFS: a round roof of stone over each side and each aisle, springing from the walls a man's height
  // up; gone where the terrace over it has fallen in, and open under the gratings
  const vault = (a: [number, number], b: [number, number], wide: number, gone?: [number, number][]) => void parts.push({ t: 'vault', paint: 'stone', low: true, tone: 0.78, name: 'vault', a, b, wide, spring: SPRING, crown: U.roof - 0.02, gone });
  vault([-U.x, (-U.z - 6.5) / 2], [CI.x1, (-U.z - 6.5) / 2], U.z - 6.5, [[DR.x0 - 0.2 + U.x, DR.x1 + 0.2 + U.x], [1.9 - 0.5 + U.x, 1.9 + 0.5 + U.x]]);
  vault([-U.x, (-6.0 + CI.z1) / 2], [CI.x1, (-6.0 + CI.z1) / 2], CI.z1 + 6.0);
  vault([(CI.x1 + U.x) / 2, -U.z], [(CI.x1 + U.x) / 2, U.z], U.x - CI.x1, [[-6 - 0.5 + U.z, -6 + 0.5 + U.z]]);
  vault([-U.x, (K.z1 + U.z) / 2], [CI.x1, (K.z1 + U.z) / 2], U.z - K.z1);
  vault([(-U.x + K.x0) / 2, CI.z1], [(-U.x + K.x0) / 2, K.z1], K.x0 + U.x, [[U.bay.z0 - 0.15 - CI.z1, U.bay.z1 + 0.15 - CI.z1]]);
  // (the armoury: three, side by side, on arches from its two piers to its walls)
  vault([(M.x0 - 1.3) / 2, U.armoury.z0], [(M.x0 - 1.3) / 2, M.z1], -1.3 - M.x0);
  vault([-0.1, U.armoury.z0], [-0.1, M.z1], 2.4, [[1.2 - 0.5 - U.armoury.z0, 1.2 + 0.5 - U.armoury.z0]]);
  vault([(1.1 + M.x1) / 2, U.armoury.z0], [(1.1 + M.x1) / 2, M.z1], M.x1 - 1.1);
  for (const x of [-1.3, 1.1]) parts.push({ t: 'wall', paint: 'stone', low: true, name: 'armoury arch', a: [x, U.armoury.z0], b: [x, M.z1], y0: UF, top: U.roof, thick: 0.4, openings: [[0, 1 - 0.34 - U.armoury.z0], [1 + 0.34 - U.armoury.z0, M.z1 - U.armoury.z0]].map(([u0, u1]) => ({ u0, u1, y0: UF - 0.05, y1: SPRING, arch: true, rise: 0.5 })) });
  // (out of the water: where its floor meets the rest there is a step half way up, and what is walked on is one slope over it, as under any stair: at the door of the stair, and across its east and west ends)
  for (const [x0, x1, z0, z1, way] of [[2.2, 3.2, CI.z1 - 0.75, CI.z1, 'z'], [CI.x1 - 0.75, CI.x1, -U.z, CI.z1, 'x'], [-U.x, K.x0, CI.z1 - 0.75, CI.z1, 'z']] as [number, number, number, number, 'x' | 'z'][]) {
    if (way === 'z') lbox('base', x0, x1, CF, CF + CI.deep / 2, z1 - 0.38, z1, { name: 'cistern step', tone: 0.75 });
    else lbox('base', x1 - 0.38, x1, CF, CF + CI.deep / 2, z0, z1, { name: 'cistern step', tone: 0.75 });
    parts.push({ t: 'slab', paint: 'base', hidden: true, body: 'feet', low: true, name: 'cistern step', p: way === 'z' ? [[x0, CF, z0], [x1, CF, z0], [x1, UF, z1], [x0, UF, z1]] : [[x0, CF, z1], [x0, CF, z0], [x1, UF, z0], [x1, UF, z1]], thick: 0.08 });
  }
  for (const [x, z, r, h] of [[-1.3, -7.2, 0.62, 0.3], [-0.35, -6.75, 0.5, 0.36], [-1.75, -6.6, 0.42, 0.22], [-0.7, -7.75, 0.4, 0.2]]) lump(x, CF + h, z, r, h, r * 0.8, Math.round(600 + x * 13 - z * 7), { paint: 'stone', blocky: true, name: 'fallen walk', low: true });

  // THE POSTERN: a doorway from the west side through the wall's foot, lined with rough stone; outside it a landing,
  // and a stair of stone down along the foot of the wall to the hill (it is built down past the ground the fort
  // assumes: what the hill has of it, it hides)
  const gx = -ex - WALL.out * 0.55 - 0.1, gs0 = -ex - WALL.out - 1.25, gs1 = -ex - WALL.out - 0.2;
  box('base', gx, -U.x - 0.6, UF - 0.3, UF, G.z0 - 0.25, G.z1 + 0.25, { name: 'postern sill' });
  box('base', gx, -U.x - 0.6, UF, UF + 2.05, G.z0 - 0.25, G.z0, { name: 'postern jamb' });
  box('base', gx, -U.x - 0.6, UF, UF + 2.05, G.z1, G.z1 + 0.25, { name: 'postern jamb' });
  box('base', gx, -U.x - 0.6, UF + 2.05, UF + 2.4, G.z0 - 0.25, G.z1 + 0.25, { name: 'postern lintel' });
  box('base', gs0, gx, UF - 4.8, UF, G.z0 - 0.1, G.z1 + 0.1, { name: 'postern landing', at: 'both' });
  flight([(gs0 + gs1) / 2, UF - 4.8, G.z1 + 5.6], [(gs0 + gs1) / 2, UF, G.z1 + 0.1], gs1 - gs0, { paint: 'base', name: 'postern stair' });

  // THE RENT in the east wall: where a length of it fell out. What is left either side shows what a wall is filled
  // with; its stone lies in a slope from the floor down to the hill outside, and a little way in over that floor.
  for (const [z, side] of [[U.rent.z0, -1], [U.rent.z1, 1]]) parts.push({ t: 'wall', paint: 'base', tone: 0.85, at: 'both', name: 'broken wall end', a: [U.x + 0.6, z + side * 0.3], b: [ex + 0.9, z + side * 0.3], y0: UF - 0.5, top: [-0.05, -0.5, -1.3, -2.3, -3.2], thick: 0.6 });
  parts.push({ t: 'mound', paint: 'scree', at: 'both', name: 'fallen wall', kind: 'rent', x0: U.rent.in - 0.6, x1: 17.7, z0: PS.end + 0.35, z1: U.rent.z1 + 4.2, cell: 0.35 });
  for (let k = 0; k < 10; k++) {
    const x = 8.6 + hash(k, 1, 541) * 6.5, z = U.rent.z0 + 0.3 + hash(k, 2, 541) * (U.rent.z1 - U.rent.z0 - 0.6) + (hash(k, 6, 541) - 0.3) * Math.max(0, x - 11.5) * 0.5;
    lump(x, moundTop('rent', x, z) + 0.12, z, 0.3 + hash(k, 3, 541) * 0.35, 0.18 + hash(k, 4, 541) * 0.14, 0.26 + hash(k, 5, 541) * 0.26, 550 + k, { paint: 'stone', blocky: true, name: 'fallen stone', body: 'none', at: 'both' });
  }

  // THE ARMOURY: the keep's foundations are its walls. One door, on the south; the wall on the north is thin (the
  // cistern runs in under the keep there) and has the door of the stair in it; a wall shuts the stair's slot off.
  // (the north one stands in the cistern, from the cistern's floor: the door of the stair in it has a threshold, a finger
  // proud of the floor. The other three stand from just under the floor, and the south one's door is cut from its foot.)
  const arched = (u0: number, u1: number, y0: number): Opening => ({ u0, u1, y0, y1: UF + 2.15, arch: true });
  const found = (a: [number, number], b: [number, number], thick: number, openings: Opening[], y0 = UF - 0.02) => void parts.push({ t: 'wall', paint: 'stone', low: true, name: 'keep foundation', a, b, y0, top: U.roof, thick, openings });
  found([K.x0, (CI.z1 + M.z0) / 2], [K.x1, (CI.z1 + M.z0) / 2], M.z0 - CI.z1, [arched(2.25 - K.x0, 3.15 - K.x0, UF + 0.015)], CF);
  found([K.x1, (K.z1 + M.z1) / 2], [K.x0, (K.z1 + M.z1) / 2], K.z1 - M.z1, [arched(K.x1 + 0.5, K.x1 + 1.7, UF - 0.02)]);
  found([(K.x0 + M.x0) / 2, M.z1], [(K.x0 + M.x0) / 2, M.z0], M.x0 - K.x0, []);
  found([(K.x1 + M.x1) / 2, M.z0], [(K.x1 + M.x1) / 2, M.z1], K.x1 - M.x1, []);
  parts.push({ t: 'wall', paint: 'stone', low: true, name: 'armoury wall', a: [M.x0, U.armoury.z0 - 0.1], b: [M.x1, U.armoury.z0 - 0.1], y0: UF, top: U.roof, thick: 0.2 });
  // the stair from the keep's store, down its slot to the door on the cistern; a rail round the hole it comes up through, in the store
  flight([U.stair.foot, UF, U.stair.z], [U.stair.head, 0, U.stair.z], 1, { paint: 'base', name: 'stair to the undercroft', low: true });
  rail([U.stair.head + 0.45, 0, R.z0 + 1], [U.stair.open, 0, R.z0 + 1]);
  rail([U.stair.open, 0, R.z0 + 1], [U.stair.open, 0, R.z0]);
  // two piers in it; and its grille: iron bars on a frame, hung on the west jamb of its door and standing open into the room
  for (const [x, z] of [[-1.3, 1], [1.1, 1]]) lbox('stone', x - 0.32, x + 0.32, UF, U.roof, z - 0.32, z + 0.32, { name: 'pier' });
  {
    const hx = -1.68, hz = M.z1 + 0.22, swing = 0.27, long = 1.14, dir: [number, number] = [Math.sin(swing), -Math.cos(swing)], at = (k: number, y: number): V3 => [hx + dir[0] * k, y, hz + dir[1] * k];
    for (let k = 0; k <= 8; k++) beam(at((long * k) / 8, UF + 0.04), at((long * k) / 8, UF + 2.05), 0.028, 0.028, { paint: 'iron', name: 'grille', low: true });
    for (const y of [0.1, 1.05, 2.0]) beam(at(0, UF + y), at(long, UF + y), 0.035, 0.05, { paint: 'iron', name: 'grille', low: true });
    const mid = at(long / 2, 0);
    // (bars stop a body and not a shot)
    box('iron', mid[0] - long / 2, mid[0] + long / 2, UF, UF + 2.05, mid[2] - 0.03, mid[2] + 0.03, { hidden: true, body: 'feet', name: 'grille', yaw: Math.PI / 2 - swing, low: true });
  }

  // THE SALLY PORT's pier, and an arch across each side here and there: each bay between two of them is a vault
  lbox('stone', 5.55 - 0.32, 5.55 + 0.32, UF, U.roof, -1.6 - 0.32, -1.6 + 0.32, { name: 'pier' });
  const rib = (a: [number, number], b: [number, number]) => void parts.push({ t: 'wall', paint: 'stone', low: true, name: 'vault rib', a, b, y0: UF, top: U.roof, thick: 0.45, openings: [{ u0: 0.28, u1: Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.28, y0: UF - 0.1, y1: U.roof - 0.3, arch: true }] });
  rib([-U.x, -2.6], [K.x0, -2.6]);
  // THE AID POST: three cells against the outer wall, each open to the passage under its own arch (a cot is seen
  // in each from the passage, and whoever is in one is seen), and the passage past them
  parts.push({ t: 'wall', paint: 'stone', low: true, name: 'cells', a: [-3.3, 6.9], b: [3.9, 6.9], y0: UF, top: U.roof, thick: 0.3, openings: [0, 1, 2].map((k) => ({ u0: 0.32 + k * 2.4, u1: 2.08 + k * 2.4, y0: UF - 0.05, y1: UF + 2, arch: true, rise: 0.45 })) });
  for (const x of [-3.3, -0.9, 1.5, 3.9]) lbox('stone', x - 0.13, x + 0.13, UF, U.roof, 7.05, U.z, { name: 'cells' });
  // (and an arch across the south side west of them, and one across the east side south of the stair: the bays of two long vaults)
  rib([-5.0, K.z1], [-5.0, U.z]);
  rib([K.x1, 2.6], [U.x, 2.6]);
  // the west side: the stone of its fallen bay, lying against the outer wall as it fell (seen from the terrace
  // through the hole it left); and a slab of the vault across the way that is left past it, to be crouched under
  // (its rows are counted from the south edge of the hole, where its head is: one of them is on that edge. See `moundTop`.)
  parts.push({ t: 'mound', paint: 'scree', name: 'fallen vault', kind: 'vault', x0: -U.x - 0.2, x1: U.crawl + 0.4, z0: U.bay.z1 - 24 * 0.3, z1: U.bay.z1 + 3 * 0.3, cell: 0.3 });
  for (let k = 0; k < 7; k++) {
    const x = -U.x + 0.3 + hash(k, 1, 501) * 0.7, z = U.bay.z0 + 0.9 + hash(k, 2, 501) * 3.6;
    lump(x, moundTop('vault', x, z) + 0.05, z, 0.24 + hash(k, 3, 501) * 0.2, 0.1, 0.2 + hash(k, 4, 501) * 0.16, 510 + k, { paint: 'stone', blocky: true, name: 'fallen stone', body: 'none' });
  }
  lbox('base', U.crawl + 0.15, K.x0, UF + 1.22, UF + 1.62, 0.9, 3.3, { name: 'fallen slab', tone: 0.9 });
  // the east side: the stair down to the passage out, in a slot along the outer wall, railed on the side's own side
  flight([(PS.x0 + PS.x1) / 2, PS.deep, PS.foot], [(PS.x0 + PS.x1) / 2, UF, PS.head], PS.x1 - PS.x0, { paint: 'base', name: 'stair to the passage out', low: true });
  // (each of its walls stops at the underside of the floor, whose edge is the lip of the slot; and the two long ones stop at the end one)
  lbox('base', PS.x0 - 0.25, PS.x0, PS.deep - 0.3, UF - 0.5, PS.head, PS.end, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep - 0.3, UF - 0.5, PS.head, POSTERN.z - 0.75, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep - 0.3, UF - 0.5, POSTERN.z + 0.75, PS.end, { name: 'passage stair wall' });
  lbox('base', PS.x1, PS.x1 + 0.25, PS.deep + U.hatch.tall, UF - 0.5, POSTERN.z - 0.75, POSTERN.z + 0.75, { name: 'passage stair wall' });
  lbox('base', PS.x0 - 0.25, PS.x1 + 0.25, PS.deep - 0.3, UF - 0.5, PS.end, PS.end + 0.25, { name: 'passage stair wall' });
  lbox('base', PS.x0, PS.x1, PS.deep - 0.3, PS.deep, PS.foot, PS.end, { name: 'passage landing' });
  // THE DOORWAY'S CASE, on the passage's side of it: a sill, a head and two jambs of stone, square to the fort, a pace
  // into the passage. The passage comes to this doorway at a slant (it is made to wherever the hatch is), and its
  // floor, its roof and its walls end square to ITS line: between their ends and the wall of the slot there was a
  // wedge open on one side, a hand to a foot wide, in the floor, the roof and the wall (2026-10-13: "the path
  // underground at the base of the stairs is bugged with panels ... missing"). The case stands a finger behind
  // the passage's own faces, and is what is seen wherever those stop short.
  {
    const x0 = PS.x1 - 0.02, x1 = PS.x1 + 0.25 + 0.75, z0 = POSTERN.z - 0.75, z1 = POSTERN.z + 0.75, tall = U.hatch.tall;
    lbox('base', x0, x1, PS.deep - 0.3, PS.deep - 0.005, z0 - 0.3, z1 + 0.3, { name: 'sally port doorway', tone: 0.78 });
    lbox('base', PS.x1 + 0.24, x1, PS.deep + tall + 0.008, PS.deep + tall + 0.32, z0 - 0.3, z1 + 0.3, { name: 'sally port doorway', tone: 0.78, body: 'none' });
    for (const [a, b] of [[z0 - 0.3, z0 - 0.02], [z1 + 0.02, z1 + 0.3]]) lbox('base', PS.x1 + 0.24, x1, PS.deep - 0.3, PS.deep + tall + 0.32, a, b, { name: 'sally port doorway', tone: 0.78, body: 'none' });
  }
  parts.push({ t: 'rail', paint: 'timber', body: 'feet', low: true, a: [PS.x0, UF, PS.head + 0.3], b: [PS.x0, UF, PS.end], name: 'passage stair rail' });
  parts.push({ t: 'rail', paint: 'timber', body: 'feet', low: true, a: [PS.x0, UF, PS.end], b: [PS.x1, UF, PS.end], name: 'passage stair rail' });
  // under the hole in the north-west tower's boards: what fell through, lying clear of the way from under the hole to the cellar's doorway
  for (const [dx, dz, r] of [[-0.45, -0.35, 0.5], [-0.35, 0.65, 0.36], [0.6, -0.6, 0.33]]) lump(-C.hx + dx, UF + 0.16, -C.hz + dz, r, 0.16, r * 0.8, 520 + Math.round(r * 100), { paint: 'timber', blocky: true, name: 'fallen boards', low: true });

  // ---- THE WALLS ARE THE KIT'S (see `castleKit`): a length of its thin wall on each side, tower to tower, its
  // walk level with the paving and its low thick parapet and merlons along the outside. What is made here is what
  // a ruin adds to them: the core of the wall where a merlon or a length of parapet has gone, and the stone that came down.
  type Side = 'n' | 's' | 'e' | 'w';
  /** a block said by how far along a wall it is (toward +x on the north and south walls, toward +z on the others), and how far out from the wall's middle line */
  const along = (side: Side, paint: Paint, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, o: Partial<Box> = {}) => {
    if (side === 'n') box(paint, u0, u1, y0, y1, -C.hz - v1, -C.hz - v0, o);
    else if (side === 's') box(paint, u0, u1, y0, y1, C.hz + v0, C.hz + v1, o);
    else if (side === 'e') box(paint, C.hx + v0, C.hx + v1, y0, y1, u0, u1, o);
    else box(paint, -C.hx - v1, -C.hx - v0, y0, y1, u0, u1, o);
  };
  const half = P.thick / 2, faceIn = half - (KIT_MERLON.x1 - KIT_MERLON.x0), sill = KIT_LEVELS.parapet - KIT_LEVELS.walk;
  // (the kit's wall is seven metres from its walk to its foot, and on the north and the south the hill is lower than that: under each wall a footing of rough stone, a hand proud of the wall's foot, down into the ground; its inner face a centimetre inside the wall's, which it laps: in the very plane of it, unbent beside the kit, the two were drawn turn about)
  for (const side of ['n', 's', 'e', 'w'] as Side[]) along(side, 'base', -WALL.half + 0.01, WALL.half - 0.01, half + WALL.out - WALL.deep + 0.01, half + WALL.out + 0.12, -C.deep, -KIT_LEVELS.walk + 0.04, { name: 'footing', tone: 0.8, at: 'both' });
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    const seed = { n: 201, s: 202, e: 203, w: 204 }[side];
    for (const [u0, u1, whole] of gaps(side)) {
      // (where a merlon stood there is no top to the parapet under it: what shows is the wall's core, a course or two of it left)
      if (whole) {
        // (set a hand inside the kit's parapet on both its faces, and straight as the kit is: laid two fingers inside it and bent as rough stone is, it came out through the parapet's face and lay in the plane of it by turns)
        along(side, 'base', u0 + 0.04, u1 - 0.04, faceIn + 0.09, half - 0.09, sill - 0.3, sill + 0.04 + hash(Math.round(u0 * 7), seed, 1) * 0.22, { name: 'merlon stump', tone: 0.85, body: 'none', straight: true });
        continue;
      }
      // (a length of parapet gone to the walk: a broken end of it either side)
      for (const [a, b] of [[u0 - 0.28, u0 + 0.02], [u1 - 0.02, u1 + 0.28]]) if (!(side === 'e' && a > UNDER.rent.z0 - 0.4)) along(side, 'base', a, b, faceIn + 0.05, half - 0.05, 0.03, sill - 0.04 - hash(Math.round(a * 9), seed, 2) * 0.2, { name: 'broken parapet', tone: 0.85, straight: true });
    }
    // the stone of what is gone: flat on the paving inside (low enough to be walked over), and tumbled outside
    for (const [a, b, whole] of gaps(side)) for (let k = 0; k < (whole ? 2 : 5); k++) {
      const u = a + ((k + 0.5) / (whole ? 2 : 5)) * (b - a) + (hash(k, seed, 5) - 0.5) * 0.4, inside = k % 2 === 0, v = inside ? faceIn - 0.6 - hash(k, seed, 6) * 1.2 : half + WALL.out + 0.5 + hash(k, seed, 6) * 1.6;
      const [x, z] = side === 'n' ? [u, -C.hz - v] : side === 's' ? [u, C.hz + v] : side === 'e' ? [C.hx + v, u] : [-C.hx - v, u];
      // (none inside along the west wall, where the vault fell in; none in the way to a tower's door, or to the gate)
      // (and none over the hole in the north walk: what fell there went down it)
      if (inside && (side === 'w' || Math.abs(u) > 5.5 || (side === 'e' && u > C.gate.z0 - 1.2 && u < C.gate.z1 + 1.2) || (side === 'n' && u > DR.x0 - 0.7 && u < DR.x1 + 0.7))) continue;
      if (inside) lump(x, 0.11, z, 0.3 + hash(k, seed, 7) * 0.22, 0.11, 0.22 + hash(k, seed, 8) * 0.14, 400 + seed + k, { paint: 'stone', blocky: true, name: 'fallen stone' });
      else lump(x, 0.25, z, 0.45 + hash(k, seed, 7) * 0.45, 0.36, 0.36 + hash(k, seed, 8) * 0.3, 400 + seed + k, { paint: 'stone', blocky: true, sits: [x, z], name: 'fallen stone', body: 'none' });
    }
  }
  // one leaf of the gate hangs open against the passage's wall inside: what stops a body there (the leaf itself is the door's own model: see `castleDoor`)
  {
    // (half open: from its hinge on the south side of the passage it stands in toward the terrace, and the way past it is a pace and a half wide)
    const swing = DOOR.swing, hz = (C.gate.z0 + C.gate.z1) / 2 + 0.987 * DOOR.scale, cx = DOOR.x - Math.sin(swing) * DOOR.leaf * 0.48, cz = hz - Math.cos(swing) * DOOR.leaf * 0.48;
    box('timber', cx - DOOR.leaf * 0.48, cx + DOOR.leaf * 0.48, 0, 3, cz - 0.07, cz + 0.07, { name: 'gate leaf', hidden: true, yaw: swing - Math.PI / 2 });
  }

  // ---- the four towers. Each has a door to the terrace, a stair round the inside of its wall to a platform under
  // its rim, a window along each of the two walls it guards and one out over the ridge.
  parts.push(tower('north-east tower', C.hx, -C.hz, -17, 6.6, 135, 300, [22.5, 67.5, 202.5], 11));
  // (the south-east tower is a stump: it came down toward the field, on a slant, to a man's waist on that side and
  // not five metres on the other. A third shorter than its neighbours from anywhere; its stair goes up behind what
  // is left of its wall in plain sight, to a perch where its platform was.)
  parts.push(tower('south-east tower', C.hx, C.hz, -20, 6.3, 225, -300, [337.5, 292.5, 157.5], 12, undefined, { toward: 52, low: 1, high: 5.7 }));
  // (the south-west tower has lost its side to the field: its stair and what is left of its platform stand open to
  // the west, and whoever is on them is seen, and shot at, from the ridge)
  parts.push(tower('south-west tower', -C.hx, C.hz, -20, 7.2, 315, 300, [22.5, 172.5, 247.5], 13, [138, 236]));
  // (the north-west tower's boards have a hole in them, over a round cellar in its foot: a drop into the lower levels)
  parts.push({ ...tower('north-west tower', -C.hx, -C.hz, -17, 6.9, 45, -300, [337.5, 187.5, 112.5], 14), hollow: UNDER.floor });

  // ---- the keep. Its walls are over two metres thick: a shell of dressed stone outside, and the mass of the wall
  // behind it, with a deep recess at each window (a man stands in the recess to shoot from it).
  const sk = K.skin, [, F1, F2] = K.floors, split = 5.3;
  /** the shell of one face: `top` is what is left of the storey over the roof, a height for each of its equal lengths */
  const face = (name: string, a: [number, number], b: [number, number], top: number[], openings: Opening[]) => {
    parts.push({ t: 'wall', paint: 'ashlar', at: 'both', name, a, b, y0: 0, top: split, thick: sk, openings: openings.filter((o) => o.y1 <= split) });
    parts.push({ t: 'wall', paint: 'stone', at: 'both', name, a, b, y0: split, top, thick: sk, openings: openings.filter((o) => o.y0 >= split) });
  };
  const B = K.band;
  // (the north face: tall over the western two thirds of it, and broken low toward the entrance side)
  face('keep north face', [K.x0, K.z0 + sk / 2], [K.x1, K.z0 + sk / 2], [14.4, 14.1, 13.4, 12.2, 12.9, 11.3, 10.4, B + 0.5, B + 0.2, B + 0.35, B + 0.15, B + 0.3, B + 0.1], [{ u0: 5.2, u1: 6, y0: 3.9, y1: 5.2, arch: true }, { u0: 2.1, u1: 2.75, y0: 10.5, y1: 11.3, arch: true, round: true }]);
  // (the entrance face: the small door, the doorway over it, and the two arched windows of the storey that is gone)
  face('keep east face', [K.x1 - sk / 2, K.z0 + sk], [K.x1 - sk / 2, K.z1 - sk], [B + 0.3, 10.6, 12.4, 12.0, 10.8, B + 0.4, B + 0.2, 9.9, 8.6, 7.4, 6.7], [
    { u0: 4.4, u1: 5.4, y0: 0, y1: 1.9 }, { u0: 4.4, u1: 5.4, y0: F1, y1: 5.2, arch: true },
    { u0: 2.25, u1: 3.15, y0: B + 0.85, y1: B + 2.0, arch: true }, { u0: 6.65, u1: 7.55, y0: B + 0.85, y1: B + 2.0, arch: true },
  ]);
  // (the south face: low on the entrance side, with a way through it where the scaffold comes up, and tall to the west)
  face('keep south face', [K.x1, K.z1 - sk / 2], [K.x0, K.z1 - sk / 2], [6.6, 6.9, 7.7, 8.8, 10.4, 10.6, B, B, 11.4, 12.6, 13.4, 12.9, 13.6], [{ u0: 2.7, u1: 3.5, y0: 6.75, y1: 8.05, arch: true }, { u0: 9.0, u1: 9.7, y0: 10.2, y1: 11.0, arch: true, round: true }]);
  // (the west face: the tallest of what is left)
  face('keep west face', [K.x0 + sk / 2, K.z1 - sk], [K.x0 + sk / 2, K.z0 + sk], [13.3, 12.1, 13.4, 13.8, 11.6, 10.4, 12.9, 13.7, 14.2, 12.8, 14.3], [
    { u0: 1.6, u1: 2.3, y0: 10.9, y1: 11.8, arch: true, round: true },
    { u0: 6.8, u1: 7.6, y0: 3.9, y1: 5.2, arch: true }, { u0: 4.1, u1: 4.9, y0: 6.75, y1: 8.05, arch: true },
  ]);
  /** the mass of a wall behind its shell, from the terrace to the wall's top, less what is cut out of it: [from, to along it, from, to up it] */
  const mass = (name: string, lo: number, hi: number, put: (u0: number, u1: number, y0: number, y1: number) => void, holes: [number, number, number, number][]) => {
    const us = [...new Set([lo, hi, ...holes.flatMap((h) => [h[0], h[1]])])].sort((p, q) => p - q);
    for (let i = 0; i + 1 < us.length; i++) {
      const mid = (us[i] + us[i + 1]) / 2;
      const gone = holes.filter((h) => mid > h[0] && mid < h[1]).map((h): [number, number] => [h[2], h[3]]);
      for (const [y0, y1] of spans(0, B, gone)) put(us[i], us[i + 1], y0, y1);
    }
    void name;
  };
  const inner = { tone: 0.8 };
  mass('north', K.x0 + sk, K.x1 - sk, (u0, u1, y0, y1) => box('stone', u0, u1, y0, y1, K.z0 + sk, R.z0, { ...inner, name: 'keep north wall' }), [[-1.4, 0.4, F1, 5.3]]);
  mass('south', K.x0 + sk, K.x1 - sk, (u0, u1, y0, y1) => box('stone', u0, u1, y0, y1, R.z1, K.z1 - sk, { ...inner, name: 'keep south wall' }), [[1.4, 2.8, F2, 8.05], [K.fallen.x0 + 0.3, K.x1 - sk, 6.6, B]]);
  mass('east', R.z0, R.z1, (u0, u1, y0, y1) => box('stone', R.x1, K.x1 - sk, y0, y1, u0, u1, { ...inner, name: 'keep east wall' }), [[-0.5, 0.5, 0, 1.9], [-0.5, 0.5, F1, 5.2], [K.fallen.z0 + 0.3, R.z1, 6.6, B]]);
  mass('west', R.z0, R.z1, (u0, u1, y0, y1) => box('stone', K.x0 + sk, R.x0, y0, y1, u0, u1, { ...inner, name: 'keep west wall' }), [[-3.2, -1.4, F1, 5.3], [-0.5, 1.3, F2, 8.05]]);

  /** a floor across the room with a hole in it over a stair: its top at `y` */
  const floor = (paint: Paint, y: number, thick: number, hole: [number, number, number, number], name: string) => {
    const [hx0, hx1, hz0, hz1] = hole;
    for (const [x0, x1, z0, z1] of [[R.x0, R.x1, R.z0, hz0], [R.x0, R.x1, hz1, R.z1], [R.x0, hx0, hz0, hz1], [hx1, R.x1, hz0, hz1]]) if (x1 - x0 > 0.01 && z1 - z0 > 0.01) box(paint, x0, x1, y - thick, y, z0, z1, { name });
  };
  // the ground floor is the terrace's own paving. The first floor: the hall, come into by the doorway on the east.
  // (A floor is open over a stair from where a head would meet it: from where the stair is two metres under the
  // floor's own underside. Reckoned, and not judged by eye: a hole a pace too short is a stair nobody gets up.)
  const opens = (L: number, up: number, under: number) => Math.max(0, ((under - 2) * L) / up - L / Math.round(up / 0.2));
  const hall = 2.3 - opens(3.75, F1, F1 - 0.2), upper = -2.2 + opens(3.6, F2 - F1, F2 - F1 - 0.2), hatch = -1.7 + opens(3.6, K.roof - F2, K.roof - F2 - 0.35);
  floor('timber', F1, 0.2, [R.x0, R.x0 + 1, -1.45, hall], 'keep first floor');
  floor('timber', F2, 0.2, [upper, 1.4, R.z1 - 1, R.z1], 'keep second floor');
  // (the roof: all of it but the hatch over its stair, and the south-east corner, which came down with the corner of
  // the keep over it: the walls there stand a knee over the upper room's floor, and the room is open to the sky and the south)
  const gone = K.fallen;
  for (const [x0, x1, z0, z1] of [[R.x0, hatch, R.z0, R.z0 + 1], [1.9, R.x1, R.z0, R.z0 + 1], [R.x0, R.x1, R.z0 + 1, gone.z0], [R.x0, gone.x0, gone.z0, R.z1]]) box('paving', x0, x1, K.roof - 0.35, K.roof, z0, z1, { name: 'keep roof' });
  // the timbers each floor lies on, from wall to wall, clear of the well of its stair; and the roof's slab on its own
  for (let x = R.x0 + 1.25; x < R.x1 - 0.3; x += 1.05) beam([x, F1 - 0.31, R.z0], [x, F1 - 0.31, R.z1], 0.16, 0.22, { name: 'joist', tone: 0.85 });
  for (const z of [-2.9, -1.85, -0.8, 0.25, 1.3, 2.3]) beam([R.x0, F2 - 0.31, z], [R.x1, F2 - 0.31, z], 0.16, 0.22, { name: 'joist', tone: 0.85 });
  for (const z of [-2.25, -1.2, -0.15, 0.9]) beam([R.x0, K.roof - 0.46, z], [R.x1, K.roof - 0.46, z], 0.18, 0.22, { name: 'joist', tone: 0.85 });
  // (the two that bore the corner are broken off short of it, and stick out over the hole; what came down lies in the upper room)
  beam([R.x0, K.roof - 0.46, 1.95], [R.x1, K.roof - 0.46, 1.95], 0.18, 0.22, { name: 'joist', tone: 0.85 });
  beam([R.x0, K.roof - 0.46, 3], [gone.x0 + 0.9, K.roof - 0.55, 3], 0.18, 0.22, { name: 'joist', tone: 0.8 });
  beam([gone.x0 + 0.2, F2 + 0.12, 2.15], [R.x1 - 0.2, F2 + 1.5, 3.3], 0.18, 0.22, { name: 'fallen joist', tone: 0.75 });
  for (let k = 0; k < 7; k++) lump(gone.x0 + 0.3 + hash(k, 1, 301) * 1.05, F2 + 0.09, gone.z0 - 0.9 + hash(k, 2, 301) * 0.8, 0.24 + hash(k, 3, 301) * 0.18, 0.09, 0.2 + hash(k, 4, 301) * 0.12, 310 + k, { paint: 'stone', blocky: true, name: 'fallen roof' });
  // and what of that corner went outward lies in a heap at its foot, on the terrace: stone a man does not climb, and small stuff round it
  for (const [x, z, r, h] of [[5.75, 6.0, 0.5, 0.48], [6.35, 5.35, 0.42, 0.4], [5.6, 6.75, 0.38, 0.38], [5.9, 6.05, 0.36, 0.86]]) lump(x, h, z, r, h, r * 0.85, Math.round(x * 91 + z * 7), { paint: 'stone', blocky: true, name: 'fallen corner' });
  for (let k = 0; k < 6; k++) lump(5.45 + hash(k, 1, 305) * 1.1, 0.1, 5.75 + hash(k, 2, 305) * 1.1, 0.22 + hash(k, 3, 305) * 0.16, 0.1, 0.18 + hash(k, 4, 305) * 0.12, 330 + k, { paint: 'stone', blocky: true, name: 'fallen stone' });
  // the three flights, one to a storey, each along a different wall: nobody on one floor has the next stair at his back
  flight([R.x0 + 0.5, 0, 2.3], [R.x0 + 0.5, F1, -1.45], 1, { name: 'keep stair to the hall' });
  flight([-2.2, F1, R.z1 - 0.5], [1.4, F2, R.z1 - 0.5], 1, { name: 'keep stair to the upper room' });
  flight([-1.7, F2, R.z0 + 0.5], [1.9, K.roof, R.z0 + 0.5], 1, { name: 'keep stair to the roof' });
  // a rail round each hole, on the floor it is a hole in, as far along it as the stair's own rail has not yet come up
  // through the floor; and one up the open side of each flight
  rail([R.x0 + 1, F1, -0.3], [R.x0 + 1, F1, hall]);
  rail([R.x0 + 1, F1, hall], [R.x0, F1, hall]);
  rail([upper, F2, R.z1 - 1], [0.5, F2, R.z1 - 1]);
  rail([upper, F2, R.z1 - 1], [upper, F2, R.z1]);
  rail([hatch, K.roof, R.z0 + 1], [1, K.roof, R.z0 + 1]);
  rail([hatch, K.roof, R.z0 + 1], [hatch, K.roof, R.z0]);
  rail([R.x0 + 1, 0, 2.3], [R.x0 + 1, F1, -1.45]);
  rail([-2.2, F1, R.z1 - 1], [1.4, F2, R.z1 - 1]);
  rail([-1.7, F2, R.z0 + 1], [1.9, K.roof, R.z0 + 1]);
  // the roof: the slab between the walls, and the walls' own tops a pace higher all round it, with stone steps up to them
  flight([1.6, K.roof, 0.6], [R.x1, B, 0.6], 1.3, { paint: 'stone', name: 'roof steps east' });
  flight([-0.5, K.roof, 2.2], [-0.5, B, R.z1], 1.3, { paint: 'stone', name: 'roof steps south' });

  // the timber stair to the doorway, along the entrance face, and its landing over the small door
  const lx = K.x1;
  flight([lx + 0.52, 0, -4.9], [lx + 0.52, F1, -1.15], 0.95, { name: 'stair to the doorway' });
  box('timber', lx, lx + 1.55, F1 - 0.15, F1, -1.15, 1.25, { name: 'doorway landing' });
  rail([lx + 1, 0, -4.9], [lx + 1, F1, -1.15]);
  rail([lx + 1, F1, -1.15], [lx + 1.55, F1, -1.15]);
  rail([lx + 1.55, F1, -1.15], [lx + 1.55, F1, 1.25]);
  rail([lx + 1.55, F1, 1.25], [lx, F1, 1.25]);
  for (const z of [-1.07, 1.17]) beam([lx + 1.47, 0, z], [lx + 1.47, F1 - 0.15, z], 0.14, 0.14, { name: 'landing post', body: 'all' });
  beam([lx + 1.47, F1 - 0.24, -1.15], [lx + 1.47, F1 - 0.24, 1.25], 0.12, 0.18);

  // ---- the scaffold up the south face to the roof: three flights and three landings, and whoever climbs it is in plain sight
  const sx0 = -5.8, sx1 = -1.8, zi = K.z1 + 0.5, zo = K.z1 + 1.45, zs = K.z1 + 1.95, up = B / 3;
  flight([sx0, 0, zi], [sx1, up, zi], 0.9, { name: 'scaffold first flight' });
  flight([sx1, up, zo], [sx0, up * 2, zo], 0.9, { name: 'scaffold second flight' });
  flight([sx0, up * 2, zi], [sx1, B, zi], 0.9, { name: 'scaffold third flight' });
  box('timber', sx1, sx1 + 1, up - 0.12, up, K.z1, zs, { name: 'scaffold landing' });
  box('timber', sx0 - 1, sx0, up * 2 - 0.12, up * 2, K.z1, zs, { name: 'scaffold landing' });
  box('timber', sx1, sx1 + 1, B - 0.12, B, K.z1, zs, { name: 'scaffold head' });
  const mid = (zi + zo) / 2;
  rail([sx0, 0, mid], [sx1, up, mid]);
  rail([sx1, up, mid], [sx0, up * 2, mid]);
  rail([sx0, up * 2, mid], [sx1, B, mid]);
  rail([sx1, up, zs], [sx0, up * 2, zs]);
  for (const [x, y] of [[sx1 + 1, up], [sx0 - 1, up * 2], [sx1 + 1, B]] as [number, number][]) {
    rail([x, y, K.z1], [x, y, zs]);
    rail([x, y, zs], [x < -3 ? sx0 : sx1, y, zs]);
  }
  rail([sx1, B, mid], [sx1, B, zs]);
  for (const x of [sx0 - 0.93, -4.6, -3, sx1 + 0.93]) beam([x, 0, zs - 0.07], [x, B + 1, zs - 0.07], 0.13, 0.13, { name: 'scaffold post', body: 'all' });
  for (const x of [sx0 - 0.93, sx1 + 0.93]) beam([x, 0, K.z1 + 0.08], [x, B + 1, K.z1 + 0.08], 0.13, 0.13, { name: 'scaffold post' });
  for (const y of [up - 0.2, up * 2 - 0.2, B - 0.2]) beam([sx0 - 0.93, y, zs - 0.07], [sx1 + 0.93, y, zs - 0.07], 0.1, 0.16);
  beam([sx0 - 0.93, 0.2, zs - 0.07], [-4.6, up * 2 - 0.3, zs - 0.07], 0.08, 0.1);
  beam([sx1 + 0.93, 0.2, zs - 0.07], [-3, up * 2 - 0.3, zs - 0.07], 0.08, 0.1);

  // ---- the ramp: the one way in. A deck of boards on trestles from the rock to the gate, a rail each side.
  const gz0 = C.gate.z0 + 0.18, gz1 = C.gate.z1 - 0.18, run = Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2), rx = ex + run, ry = -C.ramp.drop;
  // ITS HEAD LIES ON THE EDGE OF THE WALL'S TOP, WHICH IS THE PASSAGE'S FLOOR. (2026-10-14, played: "gaps at the top of
  // the ramps ... where they dont meet flush with the next level". Its boards ran on under the gate at the terrace's
  // own height, 0.4 in from the wall's face; when the wall's top was left in the passage as its floor, that top lay
  // over them, and where it ended there was a lip a hand high across the head of the ramp, and a hand and more for a
  // foot. Now the boards end on the stone, where its level top ends, a finger over it.)
  const rh: V3 = [ex - 0.02, 0.008, 0];
  parts.push({ t: 'slab', paint: 'timber', at: 'both', name: 'ramp', p: [[rh[0], rh[1], gz0], [rx, ry, gz0], [rx, ry, gz1], [rh[0], rh[1], gz1]], thick: 0.12 });
  rail([ex, 0, gz0 + 0.05], [rx, ry, gz0 + 0.05], { name: 'ramp rail' });
  rail([ex, 0, gz1 - 0.05], [rx, ry, gz1 - 0.05], { name: 'ramp rail' });
  for (const s of [0.27, 0.52, 0.77]) {
    const x = ex + run * s, y = ry * s - 0.3;
    for (const z of [gz0 + 0.12, gz1 - 0.12]) beam([x, -10, z], [x, y, z], 0.2, 0.2, { name: 'ramp trestle', body: 'all', at: 'both' });
    beam([x, y - 0.1, gz0], [x, y - 0.1, gz1], 0.18, 0.2);
    beam([x, y - 0.5, gz0 + 0.12], [x, -4.6, gz1 - 0.12], 0.07, 0.14);
    beam([x, y - 0.5, gz1 - 0.12], [x, -4.6, gz0 + 0.12], 0.07, 0.14);
  }
  for (const z of [gz0 + 0.3, gz1 - 0.3]) beam([ex - 0.2, -0.24, z], [rx, ry - 0.24, z], 0.16, 0.22);

  // ---- the rock the ramp starts from, and the rocks on its top that whoever means to cross can wait behind
  const O = OUTCROP;
  parts.push({ t: 'mound', paint: 'rock', at: 'both', name: 'outcrop', kind: 'outcrop', x0: 15.5, x1: 32, z0: -9.5, z1: 4, cell: 0.5 });
  lump(20.2, O.top + 0.55, -4.1, 0.95, 0.85, 0.75, 31, { name: 'rock by the ramp head' });
  lump(19.3, O.top + 0.5, 1, 0.8, 0.8, 0.9, 32, { name: 'rock by the ramp head' });
  lump(23, O.top + 0.4, 0.7, 1.1, 0.7, 0.8, 33, { name: 'rock on the outcrop' });
  lump(22.6, O.top + 0.35, -4.3, 0.7, 0.6, 0.9, 34, { name: 'rock on the outcrop' });

  // ---- the rubble under the breach, and blocks of the wall that came down with it
  const F = FAN;
  parts.push({ t: 'mound', paint: 'scree', name: 'rubble', kind: 'fan', x0: F.end - 3, x1: F.foot + 4, z0: -22, z1: -10, cell: 0.5 });
  for (let k = 0; k < 9; k++) {
    const x = F.foot + 2 - k * 1.5 + hash(k, 3, 7) * 0.8, z = northFace(moundTop('fan', x, -12)) - F.wide - 0.9 - hash(k, 5, 7) * 2.2;
    lump(x, moundTop('fan', x, z) + 0.12, z, 0.3 + hash(k, 1, 7) * 0.3, 0.22 + hash(k, 2, 7) * 0.16, 0.3 + hash(k, 4, 7) * 0.25, 60 + k, { paint: 'stone', blocky: true, name: 'fallen block' });
  }

  // and two lengths of it that came down inside: something to kneel behind, either side of the way in
  // (The east one lay inside, by the keep, in the side of a tent of the post: "theres a rock ... clipping into it",
  // 2026-10-14. It lies in the breach it fell from now, at its east end, as the west one lies at the west end.)
  lump(C.breach.x1 - 0.75, 0.36, -9.5, 0.6, 0.36, 0.4, 71, { paint: 'stone', blocky: true, name: 'fallen merlon' });
  lump(C.breach.x0 - 0.6, 0.33, -9.0, 0.55, 0.33, 0.42, 72, { paint: 'stone', blocky: true, name: 'fallen merlon' });

  // ---- what stands in the rooms, made of boards: tables, benches, a rack, bunks. (What is kept on each is in `castleLoot`.)
  // (A BODY'S, every one: each is the size it was in a fort a fifth smaller, at its place in this one. Said here in
  // metres of the world, as `FURNITURE` has them, and built `body(...)` of each.)
  for (const f of FURNITURE) {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw), at = (lx: number, lz: number): [number, number] => [f.x + lx * c + lz * s, f.z - lx * s + lz * c], b = body, hw = b(f.w / 2), hd = b(f.d / 2);
    const slab = (y0: number, y1: number) => box('timber', f.x - hw, f.x + hw, f.y + b(y0), f.y + b(y1), f.z - hd, f.z + hd, { yaw: f.yaw, name: f.kind, body: y1 - y0 > 0.2 ? 'none' : 'all' });
    const leg = (lx: number, lz: number, h: number) => {
      const [px, pz] = at(b(lx), b(lz));
      beam([px, f.y, pz], [px, f.y + b(h), pz], b(0.07), b(0.07), { name: f.kind });
    };
    const whole = (h: number) => box('timber', f.x - hw, f.x + hw, f.y, f.y + b(h), f.z - hd, f.z + hd, { yaw: f.yaw, hidden: true, name: f.kind });
    if (f.kind === 'table') {
      slab(0.74, 0.8);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.1), sz * (f.d / 2 - 0.1), 0.74);
      whole(0.8);
    } else if (f.kind === 'bench') {
      slab(0.4, 0.45);
      for (const sx of [-1, 1]) leg(sx * (f.w / 2 - 0.12), 0, 0.4);
      whole(0.45);
    } else if (f.kind === 'bunk') {
      for (const y of [0.4, 1.3]) slab(y, y + 0.06);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.05), sz * (f.d / 2 - 0.05), 1.75);
      whole(1.36);
    } else {
      // a rack: two uprights and three shelves between them, a board at its back
      for (const y of [0.35, 0.95, 1.55]) slab(y, y + 0.045);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(sx * (f.w / 2 - 0.04), sz * (f.d / 2 - 0.04), 1.9);
      whole(1.9);
    }
  }

  // ---- a basket of iron for a fire at each place a light is kept, on a post or on a bracket from the wall
  // (six bars between a hoop at its lip and a smaller one at its foot, and a plate under the fire; on three legs
  // where it stands on a floor, and on a chain where it hangs. The fire in it is the game's own: see CastleSite.)
  for (const [x, z, y, post] of LAMPS) parts.push(...cresset(x, z, y, post, y < -0.5));

  return parts;
}

/**
 * A basket of iron for a fire: six bars between a hoop at its lip and a smaller one at its foot, and a plate under
 * the fire; on three legs where it stands on a floor (`post`: how long), and on a chain where it hangs. The fire
 * in it is the game's own: see CastleSite.
 */
export function cresset(x: number, z: number, y: number, post: number, low = false): Part[] {
  const out: Part[] = [], lip = y - 0.04, foot = y - 0.32, at = (k: number, r: number, h: number): V3 => [x + Math.cos((k * Math.PI) / 3) * r, h, z + Math.sin((k * Math.PI) / 3) * r];
  const bar = (a: V3, b: V3, w: number, h: number) => void out.push({ t: 'beam', paint: 'iron', a, b, w, h, body: 'none', name: 'cresset', low });
  for (let k = 0; k < 6; k++) {
    bar(at(k, 0.1, foot), at(k, 0.17, lip), 0.022, 0.022);
    bar(at(k, 0.17, lip), at(k + 1, 0.17, lip), 0.022, 0.03);
    bar(at(k, 0.1, foot), at(k + 1, 0.1, foot), 0.02, 0.025);
  }
  out.push({ t: 'box', paint: 'iron', x0: x - 0.09, x1: x + 0.09, y0: foot - 0.015, y1: foot, z0: z - 0.09, z1: z + 0.09, name: 'cresset', body: 'none', low });
  if (post) {
    for (const k of [0.5, 2.5, 4.5]) bar(at(k, 0.34, y - post), at(k, 0.07, foot), 0.035, 0.035);
    out.push({ t: 'box', paint: 'iron', x0: x - 0.07, x1: x + 0.07, y0: y - post, y1: foot, z0: z - 0.07, z1: z + 0.07, hidden: true, name: 'cresset', low });
  } else bar([x, lip, z], [x, lip + 0.55, z], 0.015, 0.015);
  return out;
}

// ------------------------------------------------------------------ what stands in it

/** what is made of boards for the rooms: where its middle is on the floor (in the fort's own measure), which way it is turned, and its size (`w`, `d`: in metres of the world: it is a body's, and no bigger for the fort's being bigger) */
export const FURNITURE: { kind: 'table' | 'bench' | 'bunk' | 'rack'; x: number; z: number; y: number; yaw: number; w: number; d: number; /** a rack that always has a gun on it */ arms?: boolean; /** it is the aid post's: what lies on it is a dressing station's */ medic?: boolean }[] = [
  // the hall: a long table and its benches, a rack by the door
  { kind: 'table', x: 0.3, z: -0.4, y: 3, yaw: 0, w: 2.4, d: 0.9 },
  { kind: 'bench', x: 0.3, z: -1.25, y: 3, yaw: 0, w: 2.2, d: 0.32 },
  { kind: 'bench', x: 0.3, z: 0.45, y: 3, yaw: 0, w: 2.2, d: 0.32 },
  { kind: 'rack', x: 2.52, z: 2.2, y: 3, yaw: Math.PI / 2, w: 1.5, d: 0.45 },
  // the upper room: where they slept, and where the guns were kept
  { kind: 'bunk', x: -3.2, z: -1.6, y: 5.85, yaw: Math.PI / 2, w: 1.95, d: 0.9 },
  { kind: 'rack', x: 2.52, z: -0.6, y: 5.85, yaw: Math.PI / 2, w: 1.7, d: 0.45 },
  { kind: 'table', x: 0.4, z: 0.3, y: 5.85, yaw: Math.PI / 2, w: 1.6, d: 0.8 },
  // the armoury: racks of arms along three of its walls (each always has a gun on it), and a table of rounds
  // (deeper than a store's racks, by a hand: a rifle with a sight on it lies on its side along the shelf, and on a
  // shelf of 0.45 its butt hung over the front edge. Their backs are where they were, a hand from the wall.)
  { kind: 'rack', x: -3.36, z: 0.35, y: UNDER.floor, yaw: Math.PI / 2, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: -3.36, z: 2.4, y: UNDER.floor, yaw: Math.PI / 2, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: -1.6, z: -1.86, y: UNDER.floor, yaw: 0, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: 0.9, z: -1.86, y: UNDER.floor, yaw: 0, w: 1.7, d: 0.57, arms: true },
  { kind: 'rack', x: 2.86, z: 1.6, y: UNDER.floor, yaw: Math.PI / 2, w: 1.7, d: 0.57, arms: true },
  { kind: 'table', x: 1.4, z: -0.4, y: UNDER.floor, yaw: 0, w: 1.4, d: 0.8 },
  // the aid post: a dressing table in the ward, and one in the dispensary at the west end by the cabinet
  { kind: 'table', x: 7.75, z: 6.45, y: UNDER.floor, yaw: Math.PI / 2, w: 1.2, d: 0.7, medic: true },
  { kind: 'table', x: -6.6, z: 7.9, y: UNDER.floor, yaw: 0, w: 1.6, d: 0.7, medic: true },
  // the store under the hall
  { kind: 'rack', x: 2.52, z: -1.3, y: 0, yaw: Math.PI / 2, w: 1.5, d: 0.45 },
  { kind: 'table', x: 0.6, z: 2.75, y: 0, yaw: 0, w: 1.8, d: 0.8 },
  // on the terrace by the fire, and in the lee of the keep
  { kind: 'bench', x: 3.2, z: -5.75, y: 0, yaw: 0, w: 2, d: 0.34 },
  { kind: 'table', x: -7.1, z: -3.6, y: 0, yaw: Math.PI / 2, w: 1.8, d: 0.8 },
];

/** where a light is kept: [x, z, how high the fire of it is, how long a post it stands on (0: it hangs from a wall or a beam)] */
export const LAMPS: [number, number, number, number][] = [
  // inside the gate, on the pier
  [CASTLE.hx - 0.75, CASTLE.gate.z0 - 0.3, 2.5, 0],
  // on the corner of the landing before the doorway
  [CASTLE.keep.x1 + 1.47, 1.17, 4.55, 0],
  // the hall, and the store under it
  [-0.4, 0.3, 5.3, 0],
  [-0.6, -3.1, 2.3, 0],
  // by the fire on the north side of the terrace, and in the nook between the west wall and the south-west tower
  [5.6, -8.2, 2.3, 2.3],
  [-9.1, 7, 2.3, 2.3],
  // under the terrace, where the garrison was: in the armoury; outside its grille and in the ward of the aid post;
  // at the door of the stair from the store, on the cistern; at the foot of the stair down to the sally port. Dark between.
  [0, 2.1, UNDER.floor + 2.25, 0],
  [-2.9, 6.02, UNDER.floor + 2.25, 0],
  [5.5, 6.3, UNDER.floor + 2.25, 0],
  [3.95, -5.2, UNDER.floor + 2.2, 0],
  [(UNDER.postern.x0 + UNDER.postern.x1) / 2, UNDER.postern.foot + 0.75, UNDER.postern.deep + 2.05, 0],
];

/** where the lamps along a hatch's passage hang: at each of its bends, a head over its floor ([x, z, how high the fire is]) */
export const passageLamps = (L: ReturnType<typeof hatchLine>): V3[] => (L.path.length > 3 ? L.path.slice(2, -1).map((q): V3 => [q[0], q[2], q[1] + 1.85]) : []);
