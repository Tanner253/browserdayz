// Wager matches (2026-10-14), their rules shared by the game and the arena server (server/arena.ts). The owner: "a
// new game mode called wagers ... run 1v1's like cs:go where after each kill the players restart the round. the
// person making the wager can set the wager amount and the amount of kills to win"; and "i think we should use the
// castle as its own wager map ... it has everything we need for a CODstyled map". Round 1 is the mode with no money;
// the stake is shown and nothing is paid. The server decides every hit and every health point: no game's word on
// either is taken, so a changed game cannot win a match.
import { castleHomes, castleLoose, type FortPlace } from './castle';
import type { HitZone } from './combat';
import { F_CROUCH, F_PRONE, type Pose } from '../net/protocol';
import { heightAt, type World } from '../world/worldgen';

export const ARENA = {
  /** kills to win, as the host may choose */
  kills: [3, 5, 10],
  /** the loadouts the host may choose (KITS in src/sim/kits.ts): both players get the same one, and again every round */
  loadouts: ['assault', 'heavy', 'marksman', 'breacher'],
  /** seconds between a kill and the next round, when both are set down again at their own ends */
  roundGap: 3,
  /** seconds a player who drops may take to come back before the match is the other's */
  grace: 30,
  /** seconds a lobby waits for a challenger before it is taken off the list */
  wait: 15 * 60,
  /** how far out past the two ends the arena reaches, metres: further and they are put back at their own end */
  margin: 45,
  /** the most matches the server runs at once */
  most: 40,
  /** SOL a stake may be (shown only, in round 1) */
  stake: [0.02, 0.25] as [number, number],
} as const;

export interface LobbyInfo {
  id: string;
  host: string;
  kills: number;
  loadout: string;
  stake: number;
  /** 'open': waiting for a challenger; 'match': being fought */
  state: 'open' | 'match';
  /** seconds since it was opened */
  age: number;
  /** players a side, and how many are in so far */
  size: number;
  have: number;
}

/**
 * The two ends of the fort's arena, in the world: the apron before the fort's gate, at the foot of its ramp, and
 * the ruined village by the hatch's head, the furthest house from the gate. The fort, its walls and its passage
 * under the ground are between them. Each faces the other.
 */
export function arenaEnds(world: World): { x: number; y: number; z: number; yaw: number }[] {
  const P = world.castle as FortPlace;
  const homes = castleHomes(P, castleLoose(P));
  const gate = homes[homes.length - 1];
  const village = homes.slice(0, -1).sort((a, b) => Math.hypot(b.x - gate.x, b.z - gate.z) - Math.hypot(a.x - gate.x, a.z - gate.z))[0];
  const ground = (x: number, z: number) => heightAt(world.surface, x, z);
  const face = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
  return [
    { x: gate.x, y: ground(gate.x, gate.z), z: gate.z, yaw: face(gate, village) },
    { x: village.x, y: ground(village.x, village.z), z: village.z, yaw: face(village, gate) },
  ];
}

/** the arena's middle and how far it reaches from it */
export function arenaBounds(ends: { x: number; z: number }[]): { x: number; z: number; r: number } {
  const x = (ends[0].x + ends[1].x) / 2, z = (ends[0].z + ends[1].z) / 2;
  return { x, z, r: Math.hypot(ends[0].x - x, ends[0].z - z) + ARENA.margin };
}

/**
 * Where a body standing (or crouched, or lying) as `pose` says can be hit, as the arena server judges a shot: the
 * head a ball, the chest and the legs rods (each [from, to, radius]; a ball is a rod of no length). `pose` is a
 * player's own word on where their feet are and which way they face: [x, y, z, yaw, pitch, flags].
 */
export function hitShapes(pose: Pose): { zone: HitZone; a: [number, number, number]; b: [number, number, number]; r: number }[] {
  const [x, y, z, yaw, , f] = pose;
  if (f & F_PRONE) {
    // lying along the way they face: the head at the front, the legs behind
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), at = (d: number, h: number): [number, number, number] => [x + fx * d, y + h, z + fz * d];
    return [
      { zone: 'head', a: at(0.85, 0.22), b: at(0.85, 0.22), r: 0.14 },
      { zone: 'torso', a: at(0.55, 0.2), b: at(0.05, 0.2), r: 0.2 },
      { zone: 'legs', a: at(-0.05, 0.14), b: at(-0.95, 0.12), r: 0.16 },
    ];
  }
  const k = f & F_CROUCH ? 0.66 : 1, up = (h: number): [number, number, number] => [x, y + h * k, z];
  return [
    { zone: 'head', a: up(1.62), b: up(1.62), r: 0.14 },
    { zone: 'torso', a: up(1.0), b: up(1.42), r: 0.22 },
    { zone: 'legs', a: up(0.1), b: up(0.92), r: 0.17 },
  ];
}

/** where a ray from `o` along `d` (of length one) first meets a rod [a, b] of radius r, as a distance along it; null if it misses */
export function rayRod(o: number[], d: number[], a: number[], b: number[], r: number): number | null {
  // (sampled: the rod's nearest point to the ray, by solving for the closest approach of two lines, clamped to the rod)
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const A = dot(u, u), B = dot(u, d), C = dot(d, d), D = dot(u, w), E = dot(d, w);
  const den = A * C - B * B;
  let s = A > 1e-9 && den > 1e-9 ? (B * E - C * D) / -den : 0;
  s = Math.max(0, Math.min(1, A > 1e-9 ? s : 0));
  // the nearest point of the rod to the ray, and of the ray to it
  const p = [a[0] + u[0] * s, a[1] + u[1] * s, a[2] + u[2] * s];
  const t = Math.max(0, dot([p[0] - o[0], p[1] - o[1], p[2] - o[2]], d) / C);
  const q = [o[0] + d[0] * t - p[0], o[1] + d[1] * t - p[1], o[2] + d[2] * t - p[2]];
  const miss = dot(q, q);
  if (miss > r * r) return null;
  // (back along the ray to where it enters the rod's skin)
  return Math.max(0, t - Math.sqrt(r * r - miss));
}
