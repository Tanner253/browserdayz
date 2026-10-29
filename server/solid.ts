// A base's pieces as solid as the game has them, where the server judges (2026-10-24). The owner, via the navigator:
// "bases need full collision, also should be communicated to server so it cant be shot through or noclipped into
// somehow via relogging etc...". What a body or a thing lies on (server/world.ts `standAt`), what stops a round or a
// blast, a step through a wall refused and the body put back, and whoever comes back inside a piece, or shut in a base
// that is not theirs, set down clear of it, as Rust does with a sleeper. The shapes are src/sim/build/solid.ts.

import { BaseSolids } from '../src/sim/build/solid';
import type { Base } from '../src/sim/build/snap';
import type { Flown, Vec3 } from '../src/sim/grenades';
import { F_CROUCH, F_PRONE, F_SEAT, type Pose } from '../src/net/protocol';
import { bases } from './build';
import { baseGround } from './world';
import { send, type Client } from './players';
import { log, world } from './index';

export const solid = new BaseSolids(() => bases().bases.values());
// (a step up's height over a body's feet is still under them: a floor's top a hair over where their game has them)
baseGround((x, y, z) => solid.top(x, y + 0.35, z), (x, z) => solid.near(x, z, 6));

/** where a body's eye is over its feet, as it stands, crouches or lies */
const eyeOver = (f: number) => (f & F_PRONE ? 0.4 : f & F_CROUCH ? 1.1 : 1.6);
/** where on a body a hit lands, over its feet, standing (crouched it is two thirds of that, lying down all of it low) */
const ZONE: Record<string, number> = { head: 1.65, torso: 1.25, arms: 1.3, legs: 0.6 };
export const zoneAt = (p: Pose, zone: string): Vec3 => [p[0], p[1] + (p[5] & F_PRONE ? 0.3 : (ZONE[zone] ?? 1.2) * (p[5] & F_CROUCH ? 0.66 : 1)), p[2]];

/**
 * Whether a base stands between a shooter and where their round is said to have struck: every line from their eye
 * (and a lean's width to either side) to that place (and a hand round it) goes through a wall, a floor, a shut door.
 * A wall's edge peeked round is let go; a round through the middle of one is not. `clear` is what is traced through:
 * a base's pieces, or the map's own walls (server/walls.ts roundClear).
 */
export function walled(from: Pose, at: Vec3, clear: (a: Vec3, b: Vec3) => boolean = (a, b) => solid.clear(a, b)) {
  const eye: Vec3 = [from[0], from[1] + eyeOver(from[5]), from[2]];
  const dx = at[0] - eye[0], dz = at[2] - eye[2], l = Math.hypot(dx, dz) || 1, sx = -dz / l, sz = dx / l;
  const eyes: Vec3[] = [eye, [eye[0] + sx * 0.4, eye[1], eye[2] + sz * 0.4], [eye[0] - sx * 0.4, eye[1], eye[2] - sz * 0.4]];
  const aims: Vec3[] = [at, [at[0] + sx * 0.3, at[1], at[2] + sz * 0.3], [at[0] - sx * 0.3, at[1], at[2] - sz * 0.3], [at[0], at[1] + 0.3, at[2]], [at[0], at[1] - 0.3, at[2]]];
  for (const e of eyes) for (const a of aims) if (clear(e, a)) return false;
  return true;
}

/** whether a base stands between a blast and a body whose chest is at `chest` (its head and legs as well) */
export function blastWalled(from: Vec3, chest: Vec3) {
  const o: Vec3 = [from[0], from[1] + 0.3, from[2]];
  return [chest, [chest[0], chest[1] + 0.5, chest[2]], [chest[0], chest[1] - 0.7, chest[2]]].every((a) => !solid.clear(o, a as Vec3));
}

/**
 * About where a grenade went off: flown along its arc from the hand until it strikes a piece of a base or the ground,
 * or its fuse ends. (Where it rolled after is not followed: thrown at a wall, it went off on the thrower's side of it.)
 */
const bursts = new WeakMap<Flown, Vec3>();
function burstOf(f: Flown): Vec3 {
  let at = bursts.get(f);
  if (at) return at;
  at = f.from;
  if (!f.hand && f.v) {
    const end = Math.max(0, (f.due - f.thrownAt) / 1000), dt = 0.05, v = [...f.v];
    let p: Vec3 = [...f.from];
    for (let t = 0; t < end; t += dt) {
      const q: Vec3 = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
      v[1] -= 9.81 * dt;
      const hit = solid.hit(p, q, 'shot');
      // (stopped a hand short of what it struck)
      if (hit !== null) {
        const k = Math.max(0, hit - 0.1 / Math.max(0.01, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])));
        p = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
        break;
      }
      const ground = world.groundAt(q[0], q[2]);
      if (q[1] <= ground) {
        p = [q[0], ground + 0.1, q[2]];
        break;
      }
      p = q;
    }
    at = p;
  }
  bursts.set(f, at);
  return at;
}
/** a grenade's blast walled off from a body (src/sim/grenades.ts `judge`) */
export const blastFrom = (chest: Vec3) => (f: Flown) => blastWalled(burstOf(f), chest);

/** the last time each player was put back from a wall (they are told once in a while, not every step) */
const putBack = new WeakMap<Client, number>();

/**
 * A step a player's game says it took, refused if it goes through a wall, a floor, a shut door or a fitting of a base
 * (their knees and their chest, as they stand, crouch or lie): they are kept where they were and their game is put
 * back there, as one is that went under the ground. Noclip (an admin's) and a seat go anywhere.
 */
export function stepWalled(c: Client, was: Pose, to: Pose): boolean {
  if (!c.alive || c.seatAt || c.power.clip || to[5] & F_SEAT) return false;
  const lows = to[5] & F_PRONE ? [0.25] : to[5] & F_CROUCH ? [0.45, 0.95] : [0.45, 1.35];
  if (!lows.some((h) => solid.crosses([was[0], was[1] + h, was[2]], [to[0], to[1] + h, to[2]]))) return false;
  const now = Date.now();
  if (now - (putBack.get(c) ?? 0) > 500) {
    putBack.set(c, now);
    send(c, { t: 'put', x: was[0], y: was[1], z: was[2] });
  }
  return true;
}

/** whose a base is: its owner's, and whoever is on its claim */
const theirs = (b: Base, pid: string) => b.owner === pid || !!b.claim?.members.some((m) => m.pid === pid);
/** a body standing at a place is in a piece (its feet, middle or head) */
const stuck = (x: number, y: number, z: number) => [0.3, 0.9, 1.5].some((h) => solid.within(x, y + h, z));

/**
 * Where somebody coming back to the world at `at` is set down instead (null: where they were). In a piece of a base
 * (somebody built through where they lay), at the nearest place clear of it; shut in a room of a base that is not
 * theirs, out of that base altogether, past its outline, as Rust puts out a sleeper who wakes in somebody's base.
 */
export function wakeClear(pid: string, at: Vec3, name = ''): Vec3 | null {
  const [x, y, z] = at;
  if (!solid.near(x, z, 2)) return null;
  const room = solid.roomOf(x, y, z), shut = room && !theirs(room, pid) ? room : null;
  if (!shut && !stuck(x, y, z)) return null;
  const strange = [...bases().bases.values()].filter((b) => !theirs(b, pid) && solid.within2(b, x, z, 60));
  for (let r = 1; r <= 80; r += r < 6 ? 0.75 : 2) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      // (on what is there at their height or under it: a floor of their own base, or the ground outside)
      const py = world.standAt(px, y + 0.6, pz);
      if (stuck(px, py, pz)) continue;
      if (strange.some((b) => solid.within2(b, px, pz, 1.5))) continue;
      const in2 = solid.roomOf(px, py, pz);
      if (in2 && !theirs(in2, pid)) continue;
      log(`${name || pid} came back ${shut ? `shut in base ${shut.id}, not theirs` : 'inside a piece of a base'}: set down ${r.toFixed(1)} m off`);
      return [px, py, pz];
    }
  }
  return null;
}

/**
 * Whether somebody reaches a base's box or claim from where they stand: nothing of any base that stops a body (a wall,
 * a floor, a shut door or shutters) between their eye and its middle or its top. Its distance and lock alone were asked,
 * and its things were taken through the wall it stood behind (the owner, 2026-10-29: "i can loot containers of peoples
 * bases through their walls... fix asap").
 */
export function reaches(from: Pose, at: Vec3) {
  const eye: Vec3 = [from[0], from[1] + eyeOver(from[5]), from[2]];
  return [at, [at[0], at[1] + 0.35, at[2]] as Vec3].some((a) => !solid.first(eye, a, 'move'));
}
