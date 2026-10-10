// Jeeps. A handful stand along the road and a few more out at the edge of the map, behind
// the outlying places; anybody can get in one and drive it, three more
// can ride, and it can be shot until it burns. It is the fast way across the map and the
// loud one: everybody hears it coming.
//
// Rules and data only, shared by the game and the server. How it drives is in
// src/game/vehicle.ts. The server keeps count of where each one stands, who sits in it and
// what state it is in; whoever is driving works out how it moves (as each player does for
// their own two feet) and the server passes that on.

import { BUILDING_FOOTPRINT, PLAY_RADIUS, heightAt, type World } from '../world/worldgen';

export const JEEP = {
  /** the model it is drawn with (see scripts/assets.config.mjs): without it there are no jeeps */
  model: 'uaz_469',
  /** how many stand along the road */
  count: 5,
  /** and how many more out at the edge of the map, away from the road, each behind one of the outlying places */
  outlying: 3,
  /** what it takes before it burns: a rifle round takes 95 of it, a pistol round 34 */
  hp: 600,
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
  noTag: 'Not while you carry a tag you took, or a keycard: they go on foot.',
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
}

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
export function jeepSpots(world: World, count = JEEP.count, outlying = JEEP.outlying): { x: number; y: number; z: number; yaw: number }[] {
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
    search: for (let off = 0; off < n / count / 2; off++) {
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
  return out;
}
