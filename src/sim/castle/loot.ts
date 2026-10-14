// What is in the fort and about it: its loot places by tier, the burning jeep before its gate, its props and lamps as the world has them, where the infected start, and where a thing may be stood.
// (One part of castle.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import type { Place } from '../bunker';
import { postLoot, postProps } from '../castle-post';
import { CASTLE, CASTLE_SCALE, UNDER, body, castleAt, castleGround, castleLocal, type V3 } from './plan';
import { FURNITURE, LAMPS, castleParts, passageLamps } from './parts';
import { HOUSES, hatchLine, type Loose } from './loose';
import { castleLoose, looseLocal, type FortPlace } from './ask';

// WHAT IS KEPT HERE, AND ON WHICH STEP OF THE MAP. (The owner, asked: "refer to dayz and use common sense". The
// rules are over TYPES in src/sim/economy.ts: a thing has a kind of building it is kept in and a step it belongs to.)
//
// In DayZ a castle is no armoury: it is a hunter's and a wanderer's place, worth going to for where it stands, with
// a little of what is good in it. The army's stores and the gas are where the best is. So this is not a second
// Chemical Works: that would be the rifles' own step with no mask asked for, and nobody would go under the gas
// again. It is three steps in one place, and the way from the first to the last is up:
//   2  the ruined houses on the way to it: a hunter's leavings (Hunting). What a body can use on the climb.
//   3  the fort itself, from the gate to the hall: the terrace, the store under the hall, the hall, the floors of
//      the towers. What whoever held it lived on and fought with (Military): Kamenka's step, a submachine gun and
//      a vest, and far from Kamenka.
//   4  what is hardest to come at (Military), the rifles' own step: under the terrace, in the dark (the chamber
//      under the store, the cells at the far side of the galleries, the cellar in the foot of the north-west tower,
//      the landing of the passage out): twelve places, most of them behind the longest way round; and at the very
//      top, the rack in the upper room, which always has a gun on it, and the wall top over the roof.
// Its crates and cases are searched as crates are anywhere.
// (THE OWNER, 2026-10-13: "castle is T4 loot". Everything in and under the fort is of the fourth step now; the three
// steps above are how it was first laid out, and the ruined houses before its gate are still the hunter's second.)
export const CASTLE_TIERS = { grounds: 2, fort: 4, high: 4 } as const;

/** what is of the high step: whatever lies under the terrace; and above it, only what is said to be (the rack of guns, the wall top) */
const high = (y: number, top = false) => (y < -0.5 || top ? CASTLE_TIERS.high : CASTLE_TIERS.fort);

export type CastleUsage = 'Military' | 'Hunting' | 'Medic' | 'Hospital';

export interface CastleLoot {
  x: number;
  y: number;
  z: number;
  usage: CastleUsage[];
  building: string;
  floor: boolean;
  tier: 2 | 3 | 4;
  /** kept stocked with a gun (the rack in the upper room) */
  arms?: 'guns';
  surf?: { x: number; z: number; rot: number; hx: number; hz: number; clear: number };
}

/** where things lie, in the fort's own measure: [x, z, y, on the floor, what kind of place, on which piece of furniture (its place in FURNITURE)] */
function lootSpots(loose: Loose[]): { x: number; z: number; y: number; floor: boolean; usage: CastleUsage[]; tier: 2 | 3 | 4; on?: number; arms?: 'guns'; sits?: [number, number]; /** it is the hamlet's, before the gate, and not the fort's */ hamlet?: boolean }[] {
  const C = CASTLE, T = C.tower, out: ReturnType<typeof lootSpots> = [];
  const army: CastleUsage[] = ['Military'], hunt: CastleUsage[] = ['Hunting'];
  // on the furniture: along the top of each table, on a rack's middle shelf, on a bunk's lower bed
  FURNITURE.forEach((f, on) => {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    // (so far along its board and so high on it, in metres of the world: the board is a body's, see `FURNITURE`)
    const put = (lx: number, y: number, o: { arms?: 'guns' } = {}) => out.push({ x: f.x + body(lx) * c, z: f.z - body(lx) * s, y: f.y + body(y), floor: false, usage: f.medic ? ['Medic', 'Hospital'] : army, tier: high(f.y, !!o.arms || (f.kind === 'rack' && f.y > 5)), on, ...o });
    if (f.kind === 'table') for (const lx of f.w > 2 ? [-0.75, 0, 0.75] : [-0.45, 0.45]) put(lx, 0.8);
    else if (f.kind === 'rack') {
      put(-0.4, 0.995, f.arms || f.y > 5 ? { arms: 'guns' } : {});
      put(0.4, 0.995);
    } else if (f.kind === 'bunk') put(0, 0.46);
  });
  const fl = (x: number, z: number, y: number, top = false, usage = army) => out.push({ x, z, y, floor: true, usage, tier: high(y, top) });
  // THE VAULTS. The armoury: on its floor by its cases (its racks and its table are above, with the furniture).
  const UF = UNDER.floor, medic: CastleUsage[] = ['Medic', 'Hospital'];
  fl(-2.3, -0.2, UF);
  fl(-0.5, 2.7, UF);
  fl(2.3, -0.9, UF);
  fl(-0.3, -1.1, UF);
  // the aid post: by the cot in each cell, and in the ward: what a dressing station had
  for (const x of [-2.1, 0.3, 2.7]) fl(x - 0.5, 7.2, UF, false, medic);
  fl(5.0, 6.95, UF, false, medic);
  fl(6.2, 6.4, UF, false, medic);
  fl(-7.3, 6.5, UF, false, medic);
  // the cellar under the tower; by the head of the sally port's stair, and on its landing
  fl(-C.hx - 0.9, -C.hz + 0.9, UF);
  fl(6.3, -7.3, UF);
  fl(UNDER.postern.x0 + 0.5, UNDER.postern.end - 0.45, UNDER.postern.deep);
  // the store, the hall, the upper room and the roof: on the boards and the paving
  fl(-1.5, -1.3, 0);
  fl(1.4, 0.4, 0);
  fl(-0.6, 2.2, 0);
  fl(-1.2, -2.5, 3);
  fl(1.9, -2.2, 3);
  fl(-2.6, 0.2, 5.85);
  fl(-0.9, 1.7, 5.85);
  fl(-2.8, 2.4, C.keep.roof);
  fl(-2, 2.7, C.keep.roof);
  fl(3.7, -1, C.keep.band, true);
  // each tower: under the stair on its floor, and up on its platform
  for (const tw of castleParts()) {
    if (tw.t !== 'tower') continue;
    const back = ((tw.door + 180) * Math.PI) / 180;
    fl(tw.cx + Math.cos(back) * 0.5, tw.cz + Math.sin(back) * 0.5, 0);
    fl(tw.cx, tw.cz, T.deck);
  }
  // the terrace: by the fire, and behind the keep
  fl(4.6, -6.6, 0);
  fl(-7.3, -5.6, 0);
  fl(5.9, 4.4, 0);
  // the ruined houses: a hunter's leavings, one or two to a house
  houses(loose).forEach((sh, k) => {
    const c = Math.cos(sh.rot), s = Math.sin(sh.rot);
    for (const [lx, lz] of k % 2 ? [[-2.4, 1.2]] : [[2.2, -1.1], [-2.6, 1.4]]) {
      const x = sh.x + lx * c + lz * s, z = sh.z - lx * s + lz * c;
      out.push({ x, z, y: 0.02, floor: true, usage: hunt, tier: CASTLE_TIERS.grounds, sits: [x, z], hamlet: true });
    }
  });
  return out;
}

/** where a thing off the shelf stands: [what, x, z, y, which way it is turned]. Crates and cases are searched, as they are anywhere. */
const STOOD: [string, number, number, number, number][] = [
  // the store: what an army left, and what was put by since
  // (each is the size it comes, in a fort a fifth bigger: what stands ON another is that other's own height over the floor, `body(...)`, and as far along it)
  ['wooden_military_crate', -1.2, 3.02, 0, 0], ['wooden_military_crate', 2.1, 2.95, 0, 0], ['wooden_crate_01', 2.1 + body(0.05), 2.95 - body(0.05), body(0.46), -0.2],
  ['barrel_03', -0.7, -1.9, 0, 0], ['barrel_03', 0, -1.92, 0, 1], ['barrel_03', 2.35, 0.9, 0, 2],
  // the chamber under the store, and the cells: what was worth keeping under a stone roof
  // the armoury: cases of arms, and boxes of rounds on its table
  // (each stood by its measure in the manifest: a case is 1.26 by 0.52, a crate 1.24 by 0.52; the way in at the grille is left clear)
  ['weapons_case', -2.3, -0.75, UNDER.floor, 0.25], ['weapons_case', 0.9, 2.98, UNDER.floor, 0], ['weapons_case', 0.9 + body(0.05), 2.98 - body(0.03), UNDER.floor + body(0.43), 0.12], ['wooden_military_crate', -0.3, -1.15, UNDER.floor, 0.1], ['wooden_military_crate', 2.42, 2.98, UNDER.floor, 0], ['wooden_military_crate', 2.3, -1.3, UNDER.floor, Math.PI / 2],
  // (on its table, whose middle is at 1.4, -0.4)
  ['ammo_box', 1.4 - body(0.35), -0.4 - body(0.1), UNDER.floor + body(0.8), 0.3], ['ammo_box', 1.4 - body(0.1), -0.4 + body(0.1), UNDER.floor + body(0.8), 1.2], ['ammo_box', 1.4 + body(0.35), -0.4 - body(0.05), UNDER.floor + body(0.8), -0.2],
  // the aid post: a cot in each cell and one in the ward, a cabinet, a box of dressings, a lamp on a stand
  // (a bed is 0.91 by 2.0: along the back wall of each cell, and of the ward; the cabinet is in the nook at the west end)
  ['old_bed_frame', -2.1, 7.82, UNDER.floor, Math.PI / 2], ['old_bed_frame', 0.3, 7.82, UNDER.floor, Math.PI / 2], ['old_bed_frame', 2.7, 7.82, UNDER.floor, Math.PI / 2], ['old_bed_frame', 5.05, 7.8, UNDER.floor, Math.PI / 2],
  ['med_cabinet', -7.9, 6.2, UNDER.floor, Math.PI / 2], ['medical_box', -1.35, 7.2, UNDER.floor, 0.4], ['medical_box', 5.7, 6.95, UNDER.floor, -0.3], ['medical_light', 6.1, 6.95, UNDER.floor, 0.6],
  // the upper room
  ['weapons_case', 0.2, -1.0, 5.85, 0.1],
  // the hall: a long case against its north wall
  ['old_military_crate', 1.75, -2.85, 3, 0],
  // the roof: something to kneel behind
  ['wooden_crate_01', -2.9, -0.4, CASTLE.keep.roof, 1.4], ['wooden_crate_01', 2.3, -1.2, CASTLE.keep.roof, 0.4],
  // inside the gate: drums of fuel dragged across it, which did not stop anybody (and which a shot sets off: whoever
  // comes in by the gate comes in past them), and what else was to hand
  ['Barrel_01', 7.75, -4.6, 0, 0], ['Barrel_01', 8.1, -4.0, 0, 2], ['wooden_crate_01', 8.0, 0.2, 0, 0.3], ['wooden_crate_01', 7.5, 2.3, 0, 0.1], ['wooden_crate_01', 7.5 - body(0.05), 2.3 + body(0.05), body(0.35), 0.6],
  // a fire on the north side of the terrace, out of the wind off the gate
  ['stone_fire_pit', 4.6, -7.75, body(0.19), 0],
];

/** and in the ruined houses, each on the ground where it is: a fire in the second there is, a crate in the fourth: [what, which house, across it, along it, turned] */
const STOOD_OUT: [string, number, number, number, number][] = [['stone_fire_pit', 1, -0.6, 0.3, 0], ['wooden_crate_01', 3, 2.2, -1.6, 0.8]];

const houses = (loose: Loose[]) => loose.filter((l) => l.kind === 'house');

/** the ground at a spot of the world, for whoever stands a thing on it: the world's own, where there is one; else what the fort assumes */
export type GroundAt = (wx: number, wz: number) => number;

const assumed = (p: Place): GroundAt => (wx, wz) => {
  const [x, z] = castleLocal(p, wx, 0, wz);
  return p.y + CASTLE_SCALE * castleGround(x, z);
};

/**
 * Every place a thing can lie, as places in the world. The same on the server and in every game: it is all in
 * the plan. @param ground the height of the world's ground at a spot (the ruined houses stand on it as it is)
 */
export function castleLoot(p: Place, ground: GroundAt = assumed(p), loose: Loose[] = castleLoose(p)): CastleLoot[] {
  // (what lies down there is found by a torch: 'Military' still, and of the high step)
  const own = lootSpots(looseLocal(p, loose)).map((s): CastleLoot => {
    let [x, y, z] = castleAt(p, s.x, s.z, s.y);
    if (s.sits) y = ground(x, z) + s.y;
    const f = s.on === undefined ? null : FURNITURE[s.on];
    [x, y, z] = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000];
    return {
      x, y: y + (s.floor ? 0.02 : 0.003), z, usage: s.usage, building: s.hamlet ? 'hamlet' : 'castle', floor: s.floor, tier: s.tier,
      ...(s.arms ? { arms: s.arms } : {}),
      // (the board a thing lies on: the real top of the real thing, where it is drawn and as big as it is drawn)
      ...(f ? { surf: { x: castleAt(p, f.x, f.z)[0], z: castleAt(p, f.x, f.z)[2], rot: p.rot + f.yaw, hx: f.w / 2, hz: f.d / 2, clear: f.kind === 'table' ? 10 : 0.5 } } : {}),
    };
  });
  // (and the post's: each has a `room` the fort's own have not)
  return [...own, ...postLoot(p, ground, loose)];
}

/**
 * THE JEEP THAT BURNS BEFORE THE GATE, for good (the owner, 2026-10-14: "can we put a static burning jeep out front
 * of the draw bridge that eluminates light as well for night time, and heat"; and, seeing it stood with its nose to
 * the gate: "the car is rotated backwards, the front should be facing the road"). One of the garrison's own, hit as
 * it left: off the way on the side of the hill, where the top of the shoulder is broad, its nose down the track
 * toward the road and slewed a little off the track's line, as a car that stopped in a hurry. It is the game's own
 * jeep, burned out (`kind`: what a car that is blown up is left as), and what its fire is worth is src/sim/wreck-fire.ts.
 *
 * In the fort's own measure, as everything here is, so that it turns and moves with the fort: `x`, `z` its middle
 * (four metres of the world beyond the ramp's foot, and four and a half to the hill side of the middle line of the
 * way in, which is the gate's: the nearest of it is over three metres from that line); `rot` how it is turned (its
 * model's nose is toward its own -z: a quarter turn back, -PI / 2, puts that nose straight down the gate's line,
 * away from the fort, and it is slewed 13 degrees off that, toward the hill).
 * What is a car's own is in metres of the world, since a car is no bigger for the fort being a fifth bigger:
 * `wheels`, where they stand from its middle [half its track, half its wheelbase], and `sunk`. It stands LEVEL on the
 * lowest of the ground under its four wheels, as the world has that ground, and a hand in it.
 */
export const JEEP_WRECK = { kind: 'uaz_469', x: 21.5, z: -5.4, rot: -Math.PI / 2 + 0.227, wheels: [0.7, 1.27] as [number, number], sunk: 0.1 };

/** Where the burning jeep stands in the world: its middle at the foot of its wheels, and how it is turned (as the world's list of things has a turn). */
export function castleJeep(p: Place, ground: GroundAt = assumed(p)): { kind: string; x: number; y: number; z: number; rot: number } {
  const J = JEEP_WRECK, [x, , z] = castleAt(p, J.x, J.z), rot = p.rot + J.rot, c = Math.cos(rot), s = Math.sin(rot);
  let y = Infinity;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) y = Math.min(y, ground(x + sx * J.wheels[0] * c + sz * J.wheels[1] * s, z - sx * J.wheels[0] * s + sz * J.wheels[1] * c));
  return { kind: J.kind, x, y: y - J.sunk, z, rot };
}

/** What stands in it off the shelf, as the world's own list of such things has them. */
export function castleProps(p: Place, ground: GroundAt = assumed(p), loose: Loose[] = castleLoose(p)): { kind: string; x: number; y: number; z: number; rot: number; scale: number; far?: number }[] {
  const out = STOOD.map(([kind, lx, lz, ly, rot]) => {
    const [x, y, z] = castleAt(p, lx, lz, ly);
    return { kind, x, y, z, rot: p.rot + rot, scale: 1, far: kind === 'stone_fire_pit' ? 140 : 90 };
  });
  const hs = houses(loose);
  for (const [kind, k, lx, lz, rot] of STOOD_OUT) {
    const h = hs[k];
    if (!h) continue;
    const x = h.x + lx * Math.cos(h.rot) + lz * Math.sin(h.rot), z = h.z - lx * Math.sin(h.rot) + lz * Math.cos(h.rot);
    out.push({ kind, x, y: ground(x, z) + (kind === 'stone_fire_pit' ? 0.19 : 0), z, rot: h.rot + rot, scale: 1, far: 140 });
  }
  out.push(...postProps(p, ground, loose));
  // (And the jeep that burns before the gate, the last of all: no thing before it is renumbered. `far` nothing: it
  // is in the world's list for where it is and for what stops a body and a shot there, as any car stood about the
  // map is, and is drawn from no distance by whoever draws that list. It is drawn burnt, by src/game/wreck-fire.ts.)
  out.push({ ...castleJeep(p, ground), scale: 1, far: 0 });
  return out;
}

/** Where its lights are, as places in the world: its own, and one at each bend of a hatch's passage (`ground`, `loose`: as `castleLoot` has them). */
export function castleLamps(p: Place, ground?: GroundAt, loose?: Loose[]): V3[] {
  const out = LAMPS.map(([x, z, y]) => castleAt(p, x, z, y));
  for (const l of looseLocal(p, loose ?? castleLoose(p))) {
    if (l.kind !== 'hatch') continue;
    const [hx, , hz] = castleAt(p, l.x, l.z), g = ground ? (ground(hx, hz) - p.y) / CASTLE_SCALE : castleGround(l.x, l.z);
    for (const [x, z, y] of passageLamps(hatchLine(l, g))) out.push(castleAt(p, x, z, y));
  }
  return out;
}

/**
 * Where the infected of the place live: the ruined village, one to each of its houses; and four of the garrison's
 * dead on the open ground before the gate, where the way up comes to the foot of the ramp. They do not have the
 * terrace, the keep, the towers or the roof, which are for whoever holds the fort and whoever comes to take it.
 *
 * NOT THE LOWER LEVELS, for now (2026-10-13: "zombies spawn in the castle and get stuck and bugged in collision").
 * Four were stood in the aid post and about the galleries. One of the infected drifts in a straight line toward a
 * spot up to fifteen metres from the middle of where it lives, and gives up when it is stopped (src/game/infected.ts:
 * it finds doors only in the valley's houses and down the bunker). Under the fort every room is a few paces across
 * and the middle of their home was the fort's own middle, inside the keep's foundations: they walked into walls
 * for three seconds in every ten, and stood in doorways. They are put back down there when the horde is taught the
 * lower levels' doors as it was taught the bunker's (`bunkerLeg`); until then the dark is empty of them.
 */
/**
 * @param ground the height of the world's ground at a spot, and @param open whether a spot of the world is open ground
 *   by the world's own reckoning (its trees, its rocks, what it has built): given these, each home says the very
 *   PLACES its dead are stood at (`inside`), and they are stood nowhere else.
 *
 * WHY (2026-10-14, played: "zombies are getting stuck in the base of the building and surrounding buildings"). A home
 * was a round of six metres about a house's middle, and whoever stands them asks only the world whether a spot is
 * open: the world does not know the fort's walls. Run by the game's own rules for eight minutes each, of 144 stood
 * 39 were stood IN stone (in a house's wall, in a fallen block, in a rock: one of those can never move), 57 inside
 * a house's four walls, whose one way out is a doorway their legs do not look for, and 38 never got a pace from
 * where they were put. So: about each house, outside it, two paces off its walls; before the gate, on the open
 * ground; each place a pace and more clear of every stone of the plan (`castleClear`), level, and open by the world.
 */
export function castleHomes(p: FortPlace, loose: Loose[] = castleLoose(p), ground?: GroundAt, open?: (wx: number, wz: number) => boolean): { x: number; z: number; r: number; n: number; inside?: V3[] }[] {
  // (the open ground before the gate: where the world says it is, on the ground the fort has; else where the plan has it)
  const hs = houses(loose), [gx, , gz] = p.before ? [p.before[0], 0, p.before[1]] : castleAt(p, 36, -1.5);
  // (before the gate: clear of the rock the ramp leaves from, of the first house and of the hatch)
  const gate = { x: gx, z: gz, r: 5.5, n: 4 };
  // (the village's: one to each of its houses, as far as five, in it or close by its walls. As one round home as wide
  // as the village is long they were stood anywhere within thirty metres of its middle, and the saddle it stands on is
  // fifteen metres wide: two of the five were found on the valley face, seventeen metres under the street.)
  const homes: { x: number; z: number; r: number; n: number; inside?: V3[] }[] = [...hs.slice(0, 5).map((h) => ({ x: h.x, z: h.z, r: 6.5, n: 1 })), gate];
  if (!ground) return homes;
  const local = looseLocal(p, loose), mine = local.filter((l) => l.kind === 'house'), rock = p.rock !== false;
  // (and clear of whatever stands on its grounds off the shelf: a crate by a house, a wreck before the gate)
  const stood = castleProps(p, ground, loose);
  const at = (x: number, z: number): V3 | null => {
    if (!castleClear(local, x, z, rock)) return null;
    const [wx, , wz] = castleAt(p, x, z), y = ground(wx, wz);
    if (stood.some((q) => Math.hypot(q.x - wx, q.z - wz) < 3.4)) return null;
    // (level enough to stand on and to walk off, as the world asks of open ground)
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(ground(wx + dx, wz + dz) - y) > 0.9) return null;
    return open && !open(wx, wz) ? null : [wx, y, wz];
  };
  return homes.map((h, k) => {
    const spots: V3[] = [];
    if (k < homes.length - 1) {
      // about its house, outside it: two paces off the middle of each wall, off each corner, and between those
      const l = mine[k], sh = HOUSES[l.n % HOUSES.length], c = Math.cos(l.rot), s = Math.sin(l.rot), a = sh.w / 2 + 2.1, b = sh.d / 2 + 2.1;
      for (const [u, v] of [[a, 0], [-a, 0], [0, b], [0, -b], [a, b], [a, -b], [-a, b], [-a, -b], [a, b / 2], [a, -b / 2], [-a, b / 2], [-a, -b / 2], [a / 2, b], [-a / 2, b], [a / 2, -b], [-a / 2, -b]]) {
        const spot = at(l.x + u * c + v * s, l.z - u * s + v * c);
        if (spot) spots.push(spot);
      }
    } else {
      const [lx, lz] = castleLocal(p, h.x, 0, h.z);
      for (let u = -4; u <= 4.01; u += 1.6) for (let v = -4; v <= 4.01; v += 1.6) {
        const spot = Math.hypot(u, v) < 4.6 ? at(lx + u, lz + v) : null;
        if (spot) spots.push(spot);
      }
    }
    // (a home with nowhere clear about it keeps its round: the world's own asking is all there is for it)
    return spots.length >= 2 ? { ...h, inside: spots } : h;
  });
}

/**
 * Whether a spot of the fort's grounds, in its own measure, is clear of everything of the plan that stops a body, by a
 * body and a pace (`by`): the fort and what lies against its foot, the ramp and its trestles, every house (all of it:
 * its four walls and what is between them), every rock, wall and hatch of its grounds.
 */
export function castleClear(loose: Loose[], x: number, z: number, rock = true, by = 1.2): boolean {
  const C = CASTLE, ex = C.hx + C.parapet.thick / 2;
  // (the fort, its towers' feet, the stone fallen from it and the scanned rock under its walls)
  if (Math.abs(x) < C.hx + 6.5 && Math.abs(z) < C.hz + 6.5) return false;
  // (the ramp and what it stands on; and the rock it leaves from, where that is made, with the rocks on it)
  if (x > ex - 1 && x < ex + C.ramp.len + 1.5 && z > C.gate.z0 - by - 0.6 && z < C.gate.z1 + by + 0.6) return false;
  if (rock && x > 15.5 - by && x < 32 + by && z > -9.5 - by && z < 4 + by) return false;
  for (const l of loose) {
    const dx = x - l.x, dz = z - l.z, c = Math.cos(l.rot), s = Math.sin(l.rot), u = dx * c - dz * s, v = dx * s + dz * c;
    if (l.kind === 'house') {
      const sh = HOUSES[l.n % HOUSES.length];
      if (Math.abs(u) < sh.w / 2 + by && Math.abs(v) < sh.d / 2 + by) return false;
    } else if (l.kind === 'rock') {
      // (a rock is at most 1.6 across at its middle, and a corner of it 1.24 of that)
      if (Math.hypot(dx, dz) < 1.6 * 1.24 + by) return false;
    } else if (l.kind === 'long wall') {
      if (Math.abs(u) < 0.3 + by && Math.abs(v) < 8.4 + by) return false;
    } else if (l.kind === 'curved wall') {
      if (Math.abs(Math.hypot(dx, dz) - 9.4) < 0.4 + by) return false;
    } else {
      // (a hatch: its well and its kerb, along the way its steps go down, and the steps that come up to its head)
      const L = hatchLine(l, 0), ax = x - L.head[0], az = z - L.head[2], along = ax * L.d[0] + az * L.d[1], across = ax * L.r[0] + az * L.r[1];
      if (along > -2.6 - by && along < UNDER.hatch.run + 0.9 + by && Math.abs(across) < UNDER.hatch.wide / 2 + 0.45 + by) return false;
    }
  }
  return true;
}
