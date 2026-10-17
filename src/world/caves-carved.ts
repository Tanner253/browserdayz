// The pass's caves carved under the world's ground (coast-kit's src/world/cave-carve.ts, to its plan, src/sim/pass.ts),
// once, where the world is made for the game: plain typed arrays, kept in the world's cache and sent with it from the
// worker. The server needs none of it (it asks the plan: caveAt).

import { CAVES, CAVE_MARGIN, caveAt, caveLoot, galleries } from '../sim/pass';
import { carveCave } from './cave-carve';
import { heightAt, passPlan, type World } from './worldgen';

export function withCaves(world: World): World {
  world.caves = CAVES.map((_, ci) => carveCave(passPlan, ci, (x, z) => heightAt(world.heights, x, z)));
  return world;
}

/** the caves' places for things and the pass floor's cache, as loot points (after every other place, Kalat's too: game and server alike) */
export function caveLootPoints() {
  return caveLoot(passPlan).map((q) => ({ x: q.x, y: q.y, z: q.z, usage: ['Military', 'Hunting'] as ('Military' | 'Hunting')[], building: `cave_${q.where}`, floor: true, tier: q.tier }));
}

const gs = galleries(passPlan);
/** whether a point is in one of the pass's caves: under the ground by right, as a basement is */
export const inCave = (x: number, y: number, z: number) => !!caveAt(passPlan, x, y, z, gs, CAVE_MARGIN);
