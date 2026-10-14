// The helicopter a player flies (2026-10-14), its rules shared by the game and the server: what it is, how it flies
// (src/game/heli.ts flies it by these numbers), and where it stands when the world is new. The owner: "we just want
// flight controls and a functioning simple helicopter with good physics" ("theres no parts for now": no engine, no
// gearbox, no blades worked out one by one), and "We need a heli pad spawn near the castle and on top of the
// hospital". The model is the MD-500 they gave (scripts/assets.config.mjs, `md500`).
import { hospitalPlan } from '../world/big-buildings';
import { CASTLE_SCALE, castleClear, castleLocal, castleLoose, castleProps, inCastle, looseLocal } from './castle';
import { heightAt, inPlay, BUILDING_FOOTPRINT, type World } from '../world/worldgen';
import { JEEP, SEATS } from './vehicles';

export const HELI = {
  model: 'md500',
  /** the `k` of a VehicleInfo (0 the jeep, 1 the police car) */
  kind: 2,
  /** its seats: the pilot's and the one beside it (the Defender is a two-seater; the owner: "ctrl 1-2 for heli") */
  seats: 2,
  /** kg: an MD 500 with a pilot, a passenger and some fuel */
  mass: 1100,
  /** how its weight is spread, as a multiple of a solid box's (it is mostly cabin, and long in the tail) */
  inertia: [1.6, 1.4, 1.9] as [number, number, number],
  /** the most the rotor pushes, as a share of its weight: a climb with some to spare */
  lift: 1.7,
  /** and a fifth more of that within a rotor's breadth of the ground (the air it pushes down has nowhere to go) */
  ground: 0.2,
  rotorD: 7.4,
  /** m/s up with the climb key held, down with the descend key; with neither it holds its height */
  climb: 7,
  sink: 6,
  /** how hard it is held to the climb asked for (1/s) */
  hold: 1.8,
  /** the most it tips its nose (forward or back) and leans (into a turn), radians: 24 and 29 degrees */
  pitch: 0.42,
  roll: 0.5,
  /** hands off: radians of nose up (or lean) for each m/s it is going forward (or sideways), and the most (20 degrees): how it stops itself */
  brake: 0.03,
  brakeMost: 0.35,
  /** how fast it comes to the tip and lean asked for, and back to level when nothing is asked (1/s); and how fast its turning follows (1/s) */
  level: 2.6,
  response: 7,
  /** radians a second it turns round with the turn keys; and how much of a banked turn's own swing is added at speed (0..1) */
  yaw: 1.25,
  coordinate: 0.8,
  /** the air: N per (m/s)^2 along its nose, its side and its up (it goes nose first; sideways and up and down it is a barn door) */
  drag: [7, 14, 1.9] as [number, number, number],
  /** the highest it climbs over what is under it, metres, the ground rising and falling under it (the owner: "The max height above the ground for heli should be 100m, dynamic with geography. So the helicopter is shootable"); and over the sea, the world's y (the server takes no word of a vehicle 500 m up: isVState) */
  agl: 100,
  ceiling: 440,
  /** m/s: never faster (the server holds every vehicle under 60: see isVState in server/index.ts) */
  top: 52,
  /** seconds for the rotor to come up to speed with a pilot in, and to run down without one */
  spinUp: 6,
  spinDown: 9,
  /** radians a second the main rotor turns at full speed (as it is drawn: some seven turns a second); the tail rotor turns this many times as fast */
  rotorRate: 44,
  tailRate: 5.3,
  /** metres over the ground under which it is held level and pushed straight up (see `low` in src/game/heli.ts) */
  low: 1.5,
  /** m/s lost in one step that counts as a crash (a hard landing at four is not one) */
  crash: 6,
  /** a crash (m/s lost in one step) from which it is hurt, and from which it is wrecked and everybody in it killed (see heliCrash) */
  wreck: [6, 14] as [number, number],
  /** litres a minute at full power (a jeep flat out burns JEEP.burn) */
  burn: 2.4,
  /** how far over the ground its skids are when its middle is where the vehicles' own middle is said to be (RIDE_HEIGHT) */
  pad: { r: 6.5, clear: 7.5, building: 12 },
} as const;

/** the hospital's roof over its floor, metres: the ground storey, the storeys over it, and a slab under each and over the last (src/world/buildings.ts) */
export function hospitalRoof(): number {
  const bp = hospitalPlan();
  return bp.h + (bp.levels ?? []).reduce((a, l) => a + l.h, 0) + 0.2 * ((bp.levels ?? []).length + 1);
}

/** where on the hospital's roof the helicopter stands, in the building's own frame (x along it, z toward its front): the clear middle, west of the mast, its nose to the east */
const ROOF_PAD = { x: -3.2, z: -0.6, turn: -Math.PI / 2 };

/**
 * Where the helicopters stand when the world is new, and which way each faces: on the hospital's roof, and on the
 * nearest level, clear ground to the fort (no tree, rock or thing within a rotor's reach and some, no building
 * near, outside the fort and its loose pieces, where people play). The same on every game and on the server.
 */
export function heliSpots(world: World): { x: number; y: number; z: number; yaw: number; roof?: boolean }[] {
  const out: { x: number; y: number; z: number; yaw: number; roof?: boolean }[] = [];
  const H = world.heights, P = HELI.pad;
  const hosp = world.buildings.find((b) => b.type === 'hospital');
  if (hosp) {
    const c = Math.cos(hosp.rot), s = Math.sin(hosp.rot);
    // (the building's frame to the world's, as the hospital's grounds are laid: src/world/buildings.ts)
    out.push({ x: hosp.x + ROOF_PAD.x * c + ROOF_PAD.z * s, y: hosp.floorY + hospitalRoof(), z: hosp.z - ROOF_PAD.x * s + ROOF_PAD.z * c, yaw: hosp.rot + ROOF_PAD.turn, roof: true });
  }
  const fort = world.castle;
  if (fort) {
    // (the fort's loose pieces in its own measure, as castleClear asks; and what stands on its grounds, the wreck burning before its gate among it)
    const loose = castleLoose(fort), local = looseLocal(fort, loose);
    const stood = castleProps(fort, (x, z) => heightAt(world.surface, x, z), loose);
    const near = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r);
    const level = (x: number, z: number) => {
      const y = heightAt(H, x, z);
      for (let a = 0; a < 8; a++) if (Math.abs(heightAt(H, x + Math.cos((a * Math.PI) / 4) * P.r, z + Math.sin((a * Math.PI) / 4) * P.r) - y) > 0.55) return false;
      return true;
    };
    const trees = world.trees.filter((t) => Math.hypot(t.x - fort.x, t.z - fort.z) < 200);
    const rocks = world.rocks.filter((t) => Math.hypot(t.x - fort.x, t.z - fort.z) < 200);
    const props = world.props.filter((t) => Math.hypot(t.x - fort.x, t.z - fort.z) < 200);
    let best: { x: number; z: number; d: number } | null = null;
    // (outward from the fort in rings two metres apart, the first spot that will do: the nearest)
    for (let d = 30; d <= 180 && !best; d += 2) {
      const steps = Math.ceil((2 * Math.PI * d) / 2);
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * 2 * Math.PI, x = fort.x + Math.cos(a) * d, z = fort.z + Math.sin(a) * d;
        if (!inPlay(x, z, 20) || !level(x, z)) continue;
        if (near(trees, x, z, P.clear) || near(rocks, x, z, P.clear) || near(props, x, z, P.clear)) continue;
        if (world.buildings.some((b) => { const [w, dd] = BUILDING_FOOTPRINT[b.type]; return Math.hypot(b.x - x, b.z - z) < Math.hypot(w, dd) / 2 + P.building; })) continue;
        const y = heightAt(H, x, z);
        const [lx, , lz] = castleLocal(fort, x, y, z);
        if (inCastle(fort, x, y + 1, z) || !castleClear(local, lx, lz, fort.rock !== false, P.clear / CASTLE_SCALE) || near(stood, x, z, P.clear + 2)) continue;
        best = { x, z, d };
        break;
      }
    }
    // (its nose toward the fort)
    if (best) {
      // (stood on the highest of the ground under its skids' ends, so that none of them is in the ground)
      const yaw = Math.atan2(-(fort.x - best.x), -(fort.z - best.z)), c = Math.cos(yaw), s = Math.sin(yaw);
      const y = Math.max(...[[-1, -1.5], [1, -1.5], [-1, 1.1], [1, 1.1]].map(([sx, sz]) => heightAt(H, best!.x + sx * c + sz * s, best!.z - sx * s + sz * c)));
      out.push({ x: best.x, y, z: best.z, yaw });
    }
  }
  return out;
}

/** how many seats a vehicle of this kind (the `k` of a VehicleInfo) has: a helicopter two, a car SEATS */
export const seatsOf = (k?: number) => (k === HELI.kind ? HELI.seats : SEATS);

/**
 * What a crash does to a helicopter and to everybody in it (a car's is crashDamage in src/sim/vehicles.ts): a hard
 * landing dents it and shakes them; from HELI.wreck[1] up it is wrecked (it burns) and nobody in it lives. A fall from
 * a hundred metres is twenty and more.
 */
export function heliCrash(hard: number): { jeep: number; people: number } {
  const [from, all] = HELI.wreck;
  if (hard >= all) return { jeep: JEEP.hp, people: 500 };
  const k = Math.max(0, (hard - from) / (all - from));
  return { jeep: Math.round(JEEP.hp * 0.6 * k), people: k > 0.3 ? Math.round(90 * k) : 0 };
}
