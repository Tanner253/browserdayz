// Wager matches (2026-10-14), their rules shared by the game and the arena server (arena/match.ts). The owner: "a
// new game mode called wagers ... run 1v1's like cs:go where after each kill the players restart the round. the
// person making the wager can set the wager amount and the amount of kills to win"; and "i think we should use the
// castle as its own wager map ... it has everything we need for a CODstyled map". Round 1 is the mode with no money;
// the stake is shown and nothing is paid. The server decides every hit and every health point: no game's word on
// either is taken, so a changed game cannot win a match.
import { CASTLE_SCALE, castleAt, castleLocal, type FortPlace } from '../src/sim/castle';
import type { HitZone } from '../src/sim/combat';
import { ITEMS, capacityOf, makeItem, type ItemInstance } from '../src/sim/items';
import { KITS } from '../src/sim/kits';
import { F_CROUCH, F_PRONE, type Pose } from '../src/net/protocol';
import { heightAt, type World } from '../src/world/worldgen';

/**
 * An Arena loadout: the guns of the kit (KITS, src/sim/kits.ts) and nothing else, each loaded, with what is fitted to
 * it, less what the Arena leaves off (the owner, 2026-10-14: "for the loadout, no suppressors, no 60rnd mags"): no
 * suppressor, and the gun's own magazine, full, in place of a drum or a long one. The arena server gives it to every
 * player each round (arena/match.ts); the Arena's menu says what is in it. The Zone's kits are not touched.
 */
export function arenaLoadout(id: string): { name: string; items: ItemInstance[] } {
  const kit = KITS.find((k) => k.id === id) ?? KITS[0];
  const items = kit.things.filter((th) => ITEMS[th.id]?.category === 'weapon').map((th) => {
    const it = makeItem(th.id, th.qty);
    const own = ITEMS[th.id].weapon?.mag;
    if (own) it.mag = own;
    if (th.mods) it.mods = th.mods.filter((m) => !m.startsWith('suppressor'));
    it.loaded = capacityOf(it);
    return it;
  });
  return { name: kit.name, items };
}

/** what an Arena loadout is, in words: each gun, and what is fitted to it */
export function arenaLoadoutSays(id: string): string {
  return arenaLoadout(id).items.map((it) => `${ITEMS[it.id].name}${it.mods?.length ? ` with ${it.mods.map((m) => (ITEMS[m]?.name ?? m).toLowerCase()).join(', ')}` : ''}`).join('; ');
}

export const ARENA = {
  /** kills to win, as the host may choose */
  kills: [3, 5, 10],
  /** the loadouts the host may choose (KITS in src/sim/kits.ts): both players get the same one, and again every round */
  loadouts: ['assault', 'heavy', 'marksman', 'breacher'],
  /** seconds between a kill and the next round, when both are set down again at their own ends */
  roundGap: 3,
  /** seconds a player who drops may take to come back before the match is the other's */
  grace: 30,
  /** seconds everybody stands about once the match is won, before each is let go with the result (arena/match.ts, matchOver) */
  endFor: 12,
  /** seconds a lobby waits for a challenger before it is taken off the list */
  wait: 15 * 60,
  /** the arena: a box about the fort, metres from its middle as the fort is turned (x toward the gate, z across).
   * First a 100 m square; then the owner: "the map is far too big ... the boundaries of the map should be where the
   * cliff is and the mountain is, and then some space in front and behind the castle for spawns of opposing teams..
   * like a normal CS:GO map". So its sides are the land's (assets-src/_wf/me/arena-profile.ts): the shelf the fort
   * stands on runs level to the cliff's edge, 60 m out, and the mountain stands up steeply from 38 m out the other
   * way; and its ends leave room before the gate and behind the back wall. The ruined houses and the hatch (65 m
   * out) are outside it. Out of it, a player is put back at their own end. */
  box: { x0: -34, x1: 40, z0: -38, z1: 60 },
  /** the two ends, metres out from the fort's middle along x: before its gate, on the flat apron past the burning
   * jeep; and behind it, below its back wall, on flat ground clear of trees (arena-box.ts, arena-profile.ts) */
  ends: [34, -28] as [number, number],
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
  /** a match being played: its score (the host's side first), and how many are watching it */
  score?: [number, number];
  watching?: number;
}

/**
 * The two ends of the fort's arena, in the world: before the fort's gate and behind its back wall (ARENA.ends), the
 * fort between them. Each faces the other.
 */
export function arenaEnds(world: World): { x: number; y: number; z: number; yaw: number }[] {
  const P = world.castle as FortPlace;
  const at = ARENA.ends.map((m) => castleAt(P, m / CASTLE_SCALE, 0));
  const face = (a: number[], b: number[]) => Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));
  return at.map((p, i) => ({ x: p[0], y: heightAt(world.surface, p[0], p[2]), z: p[2], yaw: face(p, at[1 - i]) }));
}

/** whether this page's world was cut down to the arena (`cutToArena`): it is no world to go into the open one with */
export const CUT = { arena: false };

/** how far past the box's edge a game cut down to the arena still draws the world, metres (`cutToArena`): the edge's wall, and what is seen over it, then fog */
export const ARENA_SEE = 40;

/** whether a place is within `out` metres of the arena's box, each way */
export function nearArena(world: World, x: number, z: number, out = ARENA_SEE): boolean {
  const [lx, lz] = castleLocal(world.castle as FortPlace, x, 0, z), B = ARENA.box, mx = lx * CASTLE_SCALE, mz = lz * CASTLE_SCALE;
  return mx >= B.x0 - out && mx <= B.x1 + out && mz >= B.z0 - out && mz <= B.z1 + out;
}

/** the arena's box in the world, its four corners going round */
function corners(world: World): number[][] {
  const P = world.castle as FortPlace, B = ARENA.box, s = 1 / CASTLE_SCALE;
  return [[B.x1, B.z1], [B.x1, B.z0], [B.x0, B.z0], [B.x0, B.z1]].map(([x, z]) => castleAt(P, x * s, z * s, 0));
}

/**
 * The world cut down to the arena, for a game that is only to play a wager in it (the owner, 2026-10-14: "these new
 * wager match maps wont need to render anything besides the playable area, fences around the outside and a very
 * basic ground mesh like the old COD's"; for frames, as the old ones did it: a small playable space, a wall round
 * it, and nothing built past what is seen over the wall). What stands within ARENA_SEE of the square is kept and
 * the rest is not built at all (the ground's own tiles likewise: see Terrain.only); and a low dry-stone wall, the
 * map's own, is laid round the square's edge, with what stops a body over it (src/main.ts).
 */
export function cutToArena(world: World): void {
  CUT.arena = true;
  // (what stands is kept only within the square, and a few metres past its wall: past that, the ground alone is seen,
  // as an old map's backdrop is. The snow-laden pines were most of what was drawn: 3.2 million triangles a frame
  // toward the fort with those of the margin kept, as against 6.3 million in the open world.)
  const near = (o: { x: number; z: number }) => nearArena(world, o.x, o.z, 4);
  world.trees = world.trees.filter(near);
  world.rocks = world.rocks.filter(near);
  world.props = world.props.filter(near);
  world.buildings = world.buildings.filter(near);
  world.walls = world.walls.filter(near);
  // (the places and their names are kept: they are not drawn, and the buildings' plan looks some of them up by name)
  // the edge: a dry-stone wall along each side, in lengths of about four metres lying to the ground
  const c = corners(world);
  const ground = (x: number, z: number) => heightAt(world.surface, x, z);
  for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4], len = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.round(len / 4);
    const dx = (b[0] - a[0]) / n, dz = (b[2] - a[2]) / n, yaw = Math.atan2(-dz, dx);
    for (let i = 0; i < n; i++) {
      const x0 = a[0] + dx * i, z0 = a[2] + dz * i, x1 = x0 + dx, z1 = z0 + dz, y0 = ground(x0, z0), y1 = ground(x1, z1);
      world.walls.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, yaw, long: len / n, high: 1.1, thick: 0.6, rise: y1 - y0 });
    }
  }
}

/** the arena's box in the world, its four corners going round (for what stops a body at its edge) */
export function arenaCorners(world: World): [number, number][] {
  return corners(world).map((p) => [p[0], p[2]]);
}

/** whether a place is in the arena's box */
export function inArena(world: World, x: number, z: number): boolean {
  return nearArena(world, x, z, 0);
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
