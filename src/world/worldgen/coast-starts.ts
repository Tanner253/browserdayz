// Where anybody starts: on the beach of the far west coast (the owner, 2026-10-18: "move all player spawns to the far
// west coast like DAYZ does"), facing inland. The coast has its first step to walk to since (src/sim/desert.ts: Peski,
// Bereg and Mys on the shore, a store at Peski and Karavan), and the best of everything is the whole map away east.
// (On 2026-10-17 starts on the beach were taken back to the old valley, "people are complaining on the server about
// spawning too far": there was nothing on the coast then.)

import { PLACED, PLAN } from './west-plan';
import { SEA_LEVEL } from './places';
import { heightAt } from './ground';
import { offPad } from './west-towns';

interface Spot { x: number; z: number }

/** how deep inland of the barrier starts are spread, and how far apart down the coast and across it (metres) */
const BAND = { from: 30, to: 210, down: 20, across: 36 };

/** a number in [0, 1) from two (the same in the game and on the server) */
const jitter = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Starts spread over the beach and the dunes behind it, the whole coast down (2026-10-23, the owner of the desert's
 * plan, "Starts spread over the beach AND the dunes behind it": "Everything looks good"; one line down the beach was
 * the same few places), each on level dry sand, clear of whatever stands there and off the desert's places' ground.
 */
export function coastStarts(heights: Float32Array, stand: { trees: Spot[]; rocks: Spot[]; props: Spot[]; buildings: Spot[] }): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  // (facing east, along +x: see the ring's own yaw, atan2 of the way to face)
  const yaw = Math.atan2(-1, 0);
  for (let z0 = -740; z0 <= 740; z0 += BAND.down) {
    for (let d = BAND.from; d <= BAND.to; d += BAND.across) {
      // (a little off the grid each, so that no two rows of them line up)
      const x = PLAN.barrier + d + (jitter(z0, d) - 0.5) * 20, z = z0 + (jitter(d, z0) - 0.5) * 10;
      const h0 = heightAt(heights, x, z);
      if (h0 < SEA_LEVEL + 0.6) continue;
      const steep = Math.max(...[[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => Math.abs(heightAt(heights, x + dx, z + dz) - h0)));
      if (steep > 0.8) continue;
      if (stand.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3) || stand.rocks.some((t) => Math.hypot(t.x - x, t.z - z) < 4) || stand.props.some((t) => Math.hypot(t.x - x, t.z - z) < 3) || stand.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < 25)) continue;
      if (PLACED.some((t) => offPad(t, x, z) < 20)) continue;
      out.push({ x, z, yaw });
    }
  }
  return out;
}
