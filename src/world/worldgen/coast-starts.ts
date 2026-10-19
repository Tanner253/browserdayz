// Where anybody starts: on the beach of the far west coast (the owner, 2026-10-18: "move all player spawns to the far
// west coast like DAYZ does"), facing inland. The coast has its first step to walk to since (src/sim/desert.ts: Peski,
// Bereg and Mys on the shore, a store at Peski and Karavan), and the best of everything is the whole map away east.
// (On 2026-10-17 starts on the beach were taken back to the old valley, "people are complaining on the server about
// spawning too far": there was nothing on the coast then.)

import { PLAN } from './west-plan';
import { SEA_LEVEL } from './places';
import { heightAt } from './ground';

interface Spot { x: number; z: number }

/** a line of starts down the beach, a little inland of the barrier: each on level dry sand, clear of whatever stands there */
export function coastStarts(heights: Float32Array, stand: { trees: Spot[]; rocks: Spot[]; props: Spot[]; buildings: Spot[] }): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  // (facing east, along +x: see the ring's own yaw, atan2 of the way to face)
  const yaw = Math.atan2(-1, 0);
  // (every 20 m down the coast since 2026-10-19, where it was 60: "i get people complain they spawn same place on desert 3x in a row")
  for (let z = -660; z <= 660; z += 20) {
    for (const x of [PLAN.barrier + 40, PLAN.barrier + 55, PLAN.barrier + 30, PLAN.barrier + 70, PLAN.barrier + 90]) {
      const h0 = heightAt(heights, x, z);
      if (h0 < SEA_LEVEL + 0.6) continue;
      const steep = Math.max(...[[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => Math.abs(heightAt(heights, x + dx, z + dz) - h0)));
      if (steep > 0.8) continue;
      if (stand.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3) || stand.rocks.some((t) => Math.hypot(t.x - x, t.z - z) < 4) || stand.props.some((t) => Math.hypot(t.x - x, t.z - z) < 3) || stand.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < 25)) continue;
      out.push({ x, z, yaw });
      break;
    }
  }
  return out;
}
