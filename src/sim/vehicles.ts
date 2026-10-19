// Jeeps. A handful stand along the road and a few more out at the edge of the map, behind
// the outlying places; anybody can get in one and drive it, three more
// can ride, and it can be shot until it burns. It is the fast way across the map and the
// loud one: everybody hears it coming.
//
// Rules and data only, shared by the game and the server. How it drives is in
// src/game/vehicle.ts. The server keeps count of where each one stands, who sits in it and
// what state it is in; whoever is driving works out how it moves (as each player does for
// their own two feet) and the server passes that on.

import { BUILDING_FOOTPRINT, PLAY_RADIUS, SEA_LEVEL, SQUARE_HALF, heightAt, type World } from '../world/worldgen';
import { waterAt } from './water';

/** What one hit takes off a car: a bullet's own harm up to `JEEP.shot`, a blast's `JEEP.blast` times over. The server's rule and the game's own, alone. */
export function carDamage(rule: { damage: number; blast?: number; car?: number }): number {
  if (rule.car !== undefined) return JEEP.hp * rule.car;
  return rule.blast ? rule.damage * JEEP.blast : Math.min(rule.damage, JEEP.shot);
}

export const JEEP = {
  /** the model it is drawn with (see scripts/assets.config.mjs): without it there are no jeeps */
  model: 'uaz_469',
  /** how many stand along the road */
  count: 5,
  /** and how many more out at the edge of the map, away from the road, each behind one of the outlying places */
  outlying: 3,
  /**
   * And how many more again, wherever on the whole map a place is furthest from any car: the east country and the
   * corners of the valley, which had none (2026-10-11: "make sure car spawns around the map good distrobution").
   * They are found after all the others, so every car that stood before stands where it stood.
   */
  far: 5,
  /**
   * What it takes before it burns. (Three times what it was, 2026-10-11: "we need to triple the HP of cars they blow
   * up too easily": 600 to 1800. And three times that, 2026-10-13: "cars should have 3x more HP theyre too weak and
   * easy to kill. it should take at least 100 bullets to explode a car with bullets ... heavy bullets".)
   */
  hp: 5400,
  /**
   * The most one bullet takes off it: a hundredth of what there is between whole and alight (`fireAt`), so the
   * heaviest round there is, the sniper's 95 or the Desert Eagle's 58, needs a hundred and one to set it burning,
   * as the AK's does; the AR-15 needs 114 and a 9 mm 140. Without this the sniper's needed fifty.
   */
  shot: 47.5,
  /**
   * How many times what it does to a body a blast does to a car, where the blast does not say for itself (each
   * does now: `car` in WEAPON_RULES: two stick grenades or one frag grenade for a whole car, five fuel drums).
   */
  blast: 6,
  /**
   * Left under the gas: one that has stood empty there this many seconds, with nobody within this many metres of
   * it, is stood back where it first stood, whole and fuelled as a new one is (2026-10-11: "cars left in the gas
   * zone with no players around should respawn"). A car driven in to the works and walked away from was gone
   * from the map for good: nobody goes back in for it.
   */
  gas: { after: 120, clear: 70 },
  /**
   * Left alone: one nobody has sat at the wheel of for this many seconds, with nobody in it and nobody within this many
   * metres (nobody sees it go), is taken away, and a new one is stood at its place in its time, as for one that burned
   * (the owner, 2026-10-18: "cull old unused cars left behind by the user no driver for 2 hours despawn vehicle for
   * resapwning"; DayZ takes away abandoned cars). One standing at its own place still is left there. The server's
   * own: CAR_IDLE_S says otherwise.
   */
  idle: { after: 7200, clear: 150 },
  /** under this it smokes, under this it is on fire and goes up a few seconds later */
  smokeAt: 0.4,
  fireAt: 0.12,
  fuse: 7,
  /**
   * Seconds before a new one is stood up for one that burned, where the old one first stood;
   * and how near that spot somebody may be standing for it still to be stood there (it is
   * not set down on top of anybody: it waits until they have moved off).
   * (It was seven minutes and twenty-five metres. Along the village street somebody is nearly
   * always within twenty-five metres, and a jeep that burned there seemed never to come back.)
   */
  respawn: 180,
  respawnClear: 12,
  /** litres in a full tank, litres burned in a minute flat out, and what a jerrycan pours in */
  tank: 40,
  burn: 2.4,
  can: 10,
  /** how near the door a player has to be to get in, metres from the middle of the jeep */
  reach: 3.4,
  /** being run over: slower than this nothing happens (m/s), then this much damage for every m/s over it */
  bumpFrom: 3,
  bumpPer: 13,
  /**
   * Running into things: a knock of this many m/s is nothing, each one over it costs the jeep
   * this much (up to a most), and from a harder one still everybody in it is hurt as well.
   */
  crash: { from: 4, per: 9, most: 160, hurtFrom: 11, hurtPer: 6, hurtMost: 50 },
  /** what somebody carrying a tag they took is told at the door: they go on foot */
  noTag: 'Not while you carry a tag you took: it goes on foot.',
  /** a jeep that left the map or fell through it is stood back up where it started */
  floor: -40,
};

/**
 * Where a jeep is and how it is moving: position, rotation (a quaternion), velocity, and
 * the two things that show on it, how far the wheels are turned and how hard it is driven.
 * [x, y, z, qx, qy, qz, qw, vx, vy, vz, steer, throttle]
 */
export type VState = [number, number, number, number, number, number, number, number, number, number, number, number];

export interface VehicleInfo {
  i: number;
  s: VState;
  hp: number;
  fuel: number;
  /** who sits where (player ids): seat 0 drives */
  seats: (number | null)[];
  /** whose game is working out how it moves (null: it stands still) */
  sim: number | null;
  /** which car it is: 1 is the police car (see POLICE_CAR). The jeep says nothing. */
  k?: number;
  /** a police car's siren is going (see src/game/horns.ts) */
  siren?: boolean;
}

/**
 * The second car (2026-10-10): a police car, one beside each police station. A road car: on the road it leaves a
 * jeep behind, and off it a jeep leaves it (how each drives is in src/game/vehicle.ts). In everything else it is a
 * jeep: four seats, the same tank, the same fire.
 */
export const POLICE_CAR = { model: 'police_car', kind: 1 };

export const SEATS = 4;

/** what a knock of `hard` m/s takes off a jeep, and off each of the people in it */
export function crashDamage(hard: number): { jeep: number; people: number } {
  const c = JEEP.crash;
  return { jeep: Math.min(c.most, Math.max(0, hard - c.from) * c.per), people: Math.min(c.hurtMost, Math.max(0, hard - c.hurtFrom) * c.hurtPer) };
}

/** a quaternion for standing level, turned to face `yaw` (the game's yaw: 0 looks down -z) */
export function yawQuat(yaw: number): [number, number, number, number] {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** how high above the ground the middle of the body is when it stands on its wheels */
export const RIDE_HEIGHT = 0.8;

export function restState(x: number, ground: number, z: number, yaw: number): VState {
  return [x, ground + RIDE_HEIGHT, z, ...yawQuat(yaw), 0, 0, 0, 0, 0];
}

/**
 * Where the jeeps stand when the world is new: pulled up on the verge, spread along the
 * whole length of the road, on ground that is level and clear; and then a few out where
 * people start, far from the road. The same on every game and on the server.
 */
export function jeepSpots(world: World, count = JEEP.count, outlying = JEEP.outlying, more = JEEP.far): { x: number; y: number; z: number; yaw: number }[] {
  const p = world.road.points, n = p.length / 3;
  const H = world.heights;
  const out: { x: number; y: number; z: number; yaw: number }[] = [];
  const clear = (x: number, z: number, trees = 3.2) => {
    const y = heightAt(H, x, z);
    for (const [dx, dz] of [[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]]) if (Math.abs(heightAt(H, x + dx, z + dz) - y) > 0.45) return false;
    if (world.buildings.some((b) => {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      return Math.hypot(b.x - x, b.z - z) < Math.hypot(w, d) / 2 + 4;
    })) return false;
    if (world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < trees)) return false;
    if (world.rocks.some((t) => Math.hypot(t.x - x, t.z - z) < 3.4) || world.props.some((t) => Math.hypot(t.x - x, t.z - z) < 3)) return false;
    // (inside the part of the map people play in: the road runs on up into the hills at both ends)
    return Math.hypot(x, z) < PLAY_RADIUS - 30;
  };
  for (let k = 0; k < count; k++) {
    // the middle of each stretch first, then further and further either way along it
    const mid = Math.round(((k + 0.5) / count) * (n - 1));
    // (Not only within its own stretch: the last of them is the climb out of the valley to Kamenka, a fifth of a
    // metre up in every metre and no verge on it level enough to leave a car on. Its jeep stands at the nearest
    // place there is, which is the foot of the climb. The others are found within their own stretch as before.)
    search: for (let off = 0; off < n; off++) {
      for (const i of off ? [mid + off, mid - off] : [mid]) {
        if (i < 1 || i > n - 2) continue;
        const tx = p[(i + 1) * 3] - p[(i - 1) * 3], tz = p[(i + 1) * 3 + 2] - p[(i - 1) * 3 + 2];
        const tl = Math.hypot(tx, tz) || 1;
        for (const side of k % 2 ? [1, -1] : [-1, 1]) {
          const d = world.road.width / 2 + 2.4;
          const x = p[i * 3] + (-tz / tl) * d * side, z = p[i * 3 + 2] + (tx / tl) * d * side;
          if (!clear(x, z) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 40)) continue;
          // nose along the road, the way the road runs (yaw 0 looks down -z)
          out.push({ x, y: heightAt(H, x, z), z, yaw: Math.atan2(-tx, -tz) + (side > 0 ? 0 : Math.PI) });
          break search;
        }
      }
    }
  }
  // Out at the edge. The outlying places far from the road, taken one at a time: whichever is
  // furthest from every jeep there is so far. It stands behind the buildings, on the side
  // toward the middle of the map, nose pointing home. (A place's own frame: its doors face
  // out toward the map's edge, and what lies about its yard lies in front of them; behind is
  // ground that was levelled with the rest and has nothing put on it.)
  const toRoad = (x: number, z: number) => {
    let d = Infinity;
    for (let i = 0; i < n; i++) d = Math.min(d, Math.hypot(p[i * 3] - x, p[i * 3 + 2] - z));
    return d;
  };
  const BEHIND: [number, number][] = [[0, -17], [7, -18], [-7, -18], [0, -22], [13, -19], [-13, -19], [0, -27], [9, -26], [-9, -26]];
  // (the places the map was first made with: one built later is not somewhere a jeep has always stood)
  const far = world.sites.filter((st) => !st.later && toRoad(st.x, st.z) > 150);
  for (let k = 0; k < outlying; k++) {
    const alone = (st: { x: number; z: number }) => Math.min(...out.map((o) => Math.hypot(o.x - st.x, o.z - st.z)));
    place: for (const st of far.filter((s) => alone(s) > 60).sort((a, b) => alone(b) - alone(a))) {
      const c = Math.cos(st.rot), sn = Math.sin(st.rot);
      for (const [right, fwd] of BEHIND) {
        const x = st.x + right * c + fwd * sn, z = st.z - right * sn + fwd * c;
        if (!clear(x, z, 4.5)) continue;
        out.push({ x, y: heightAt(H, x, z), z, yaw: st.rot });
        break place;
      }
    }
  }
  // And wherever on the whole map a place is furthest from any car, the police cars counted (they are stood after
  // these, beside their stations): any place there is, built first or later, in the valley or out of it. Behind
  // its buildings as the others are, or wherever round it the ground is level and clear.
  const stations = world.buildings.filter((b) => b.type === 'police');
  const open = (x: number, z: number) => {
    const y = heightAt(H, x, z);
    for (const [dx, dz] of [[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]]) if (Math.abs(heightAt(H, x + dx, z + dz) - y) > 0.45) return false;
    if (world.buildings.some((b) => {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      return Math.hypot(b.x - x, b.z - z) < Math.hypot(w, d) / 2 + 4;
    })) return false;
    if (world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4.5)) return false;
    if (world.rocks.some((t) => Math.hypot(t.x - x, t.z - z) < 3.4) || world.props.some((t) => Math.hypot(t.x - x, t.z - z) < 3)) return false;
    // (on the square: the ground west of it has no ways as yet, 2026-10-16)
    return Math.max(Math.abs(x), Math.abs(z)) < SQUARE_HALF - 30;
  };
  // (Not at the works, where it would stand under the gas, nor over the bunker. The two places out in the wild
  // country, outside the line, are places like any other: a car out there is the way back.)
  // (Nor at the fort, which is reached on foot.)
  const NOT_AT = ['Chemical Works', 'Bunker 17', 'Orlinoye'];
  const places = [...world.sites.map((st) => ({ x: st.x, z: st.z, rot: st.rot })), ...world.pois.filter((q) => !NOT_AT.includes(q.name) && !world.sites.some((st) => Math.hypot(st.x - q.x, st.z - q.z) < 30)).map((q) => ({ x: q.x, z: q.z, rot: Math.atan2(q.x, q.z) }))].filter((st) => !world.pois.some((q) => NOT_AT.includes(q.name) && Math.hypot(q.x - st.x, q.z - st.z) < 150));
  for (let k = 0; k < more; k++) {
    const alone = (st: { x: number; z: number }) => Math.min(...[...out, ...stations].map((o) => Math.hypot(o.x - st.x, o.z - st.z)));
    place: for (const st of places.filter((s) => alone(s) > 110).sort((a, b) => alone(b) - alone(a))) {
      const c = Math.cos(st.rot), sn = Math.sin(st.rot);
      for (const [right, fwd] of [...BEHIND, [17, -8], [-17, -8], [20, 4], [-20, 4], [0, 20], [12, 22], [-12, 22], [26, -14], [-26, -14], [0, -34], [0, 30]] as [number, number][]) {
        const x = st.x + right * c + fwd * sn, z = st.z - right * sn + fwd * c;
        if (!open(x, z) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 40)) continue;
        out.push({ x, y: heightAt(H, x, z), z, yaw: st.rot });
        break place;
      }
    }
  }
  return out;
}

/**
 * Where the police cars stand when the world is new: one beside each police station, alongside it with its nose
 * the way the station's door faces, on ground that is level and clear. The same on every game and on the server.
 * @param taken where cars stand already: none is stood within a few paces of those
 */
export function policeSpots(world: World, taken: { x: number; z: number }[] = []): { x: number; y: number; z: number; yaw: number }[] {
  const H = world.heights;
  const out: { x: number; y: number; z: number; yaw: number }[] = [];
  const free = (x: number, z: number) => {
    const y = heightAt(H, x, z);
    for (const [dx, dz] of [[2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]]) if (Math.abs(heightAt(H, x + dx, z + dz) - y) > 0.4) return false;
    // (clear of every wall by more than its own width, and of every tree, rock and thing left in a yard)
    if (world.buildings.some((b) => {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
      return Math.abs(dx * c - dz * s) < w / 2 + 3 && Math.abs(dx * s + dz * c) < d / 2 + 3;
    })) return false;
    if ([...taken, ...out].some((o) => Math.hypot(o.x - x, o.z - z) < 7)) return false;
    return !world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2) && !world.rocks.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2) && !world.props.some((t) => Math.hypot(t.x - x, t.z - z) < 3.4);
  };
  for (const b of world.buildings) {
    // (the stations, in the order they were built; and the headquarters, built after them all)
    if (b.type !== 'police' && b.type !== 'police_hq') continue;
    const [w, d] = BUILDING_FOOTPRINT[b.type], c = Math.cos(b.rot), s = Math.sin(b.rot);
    // (beside it first, then before its door, then behind: [to its right, toward its front])
    for (const [right, fwd] of [[w / 2 + 3.6, 1], [-(w / 2 + 3.6), 1], [w / 2 + 3.6, d / 2 + 2.5], [-(w / 2 + 3.6), d / 2 + 2.5], [3, d / 2 + 6], [-3, d / 2 + 6], [w / 2 + 6.5, -2], [-(w / 2 + 6.5), -2], [0, -(d / 2 + 5.5)], [w / 2 + 9, 3], [-(w / 2 + 9), 3]]) {
      const x = b.x + right * c + fwd * s, z = b.z - right * s + fwd * c;
      if (!free(x, z)) continue;
      // (a building's front is the way its rot turns +z; a car at yaw 0 looks down -z)
      out.push({ x, y: heightAt(H, x, z), z, yaw: b.rot + Math.PI });
      break;
    }
  }
  return out;
}

/**
 * The places of the west that have a jeep by their road (westSpots), in the order they are numbered; and where to look
 * along the roads from, where that is not the place's middle. (Kalat's on the road laid round the south of it, the
 * owner: "add some more roads around kalat and some vehicle spawns".)
 */
export const WEST_CARS: { name: string; from?: [number, number] }[] = [{ name: 'Pokrov' }, { name: 'Zavod' }, { name: 'Karavan' }, { name: 'Blokpost' }, { name: 'Kalat', from: [-3215, 450] }, { name: 'Peski' }, { name: 'Bereg' }, { name: 'Mys' }];

/**
 * The west's jeeps (the owner, 2026-10-18: "the west side of the map is lacking vehicle spawns completely", "add some
 * more roads around kalat and some vehicle spawns that resapawn"): one by the road at each of WEST_CARS, at the
 * nearest point of a road to its middle where the verge is level and clear, as the road's jeeps stand (at the way in,
 * not in the middle of a hamlet); off every road's asphalt, out of the water, clear of walls, posts, trees and rocks.
 * Numbered after every other car (PARKS), so none of those moves. The same on every game and on the server.
 * @param taken where cars stand already: none is stood within 40 m of those
 */
export function westSpots(world: World, taken: { x: number; z: number }[] = []): { x: number; y: number; z: number; yaw: number }[] {
  const H = world.heights, ground = (x: number, z: number) => heightAt(H, x, z);
  const roads = [world.road, ...world.roads.filter((r) => !r.bridge)];
  const out: { x: number; y: number; z: number; yaw: number }[] = [];
  /** how far a spot is from the edge of the nearest road's asphalt */
  const offRoad = (x: number, z: number) => {
    let d = Infinity;
    for (const r of roads) {
      const p = r.points;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const ax = p[i], az = p[i + 2], ex = p[i + 3] - ax, ez = p[i + 5] - az;
        if (Math.abs(x - ax) > 60 || Math.abs(z - az) > 60) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1e-9)));
        d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t) - r.width / 2);
      }
    }
    return d;
  };
  const clear = (x: number, z: number) => {
    const y = ground(x, z);
    for (const [dx, dz] of [[2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]]) if (Math.abs(ground(x + dx, z + dz) - y) > 0.4) return false;
    if (y < SEA_LEVEL + 1 || (world.water && waterAt(world.water, x, z, ground))) return false;
    // (a car is two metres wide: its side a metre and more off the asphalt, of this road or any other it is near)
    if (offRoad(x, z) < 2) return false;
    if (world.buildings.some((b) => {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
      return Math.abs(dx * c - dz * s) < w / 2 + 3.5 && Math.abs(dx * s + dz * c) < d / 2 + 3.5;
    })) return false;
    if (world.walls.some((w) => Math.hypot(w.x - x, w.z - z) < w.long / 2 + 3) || world.solids.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 4)) return false;
    if (world.posts?.some((p) => Math.hypot(p.x - x, p.z - z) < 14)) return false;
    if ([...taken, ...out].some((o) => Math.hypot(o.x - x, o.z - z) < 40)) return false;
    return !world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2) && !world.rocks.some((t) => Math.hypot(t.x - x, t.z - z) < 3.4 * Math.max(1, t.scale)) && !world.props.some((t) => Math.hypot(t.x - x, t.z - z) < 3);
  };
  for (const { name, from } of WEST_CARS) {
    const q = world.pois.find((o) => o.name === name);
    if (!q) continue;
    // every point of a road within reach, nearest first: of the place's middle (but 25 m out of it), or where it says
    const [fx, fz] = from ?? [q.x, q.z], inner = from ? 0 : 25, reach = from ? 80 : q.radius + 60;
    const near: { p: Float32Array; i: number; w: number; d: number }[] = [];
    for (const r of roads) {
      const p = r.points, n = p.length / 3;
      for (let i = 1; i < n - 1; i++) {
        const d = Math.hypot(p[i * 3] - fx, p[i * 3 + 2] - fz);
        if (d >= inner && d < reach) near.push({ p, i, w: r.width, d });
      }
    }
    near.sort((a, b) => a.d - b.d);
    place: for (const { p, i, w } of near) {
      const tx = p[(i + 1) * 3] - p[(i - 1) * 3], tz = p[(i + 1) * 3 + 2] - p[(i - 1) * 3 + 2], tl = Math.hypot(tx, tz) || 1;
      // (on the place's own side of the road first)
      const toward = Math.sign((-tz / tl) * (q.x - p[i * 3]) + (tx / tl) * (q.z - p[i * 3 + 2])) || 1;
      for (const side of [toward, -toward]) {
        const d = w / 2 + 2.4, x = p[i * 3] + (-tz / tl) * d * side, z = p[i * 3 + 2] + (tx / tl) * d * side;
        if (!clear(x, z)) continue;
        // nose along the road, as the road's jeeps stand (yaw 0 looks down -z)
        out.push({ x, y: ground(x, z), z, yaw: Math.atan2(-tx, -tz) + (side > 0 ? 0 : Math.PI) });
        break place;
      }
    }
  }
  return out;
}
