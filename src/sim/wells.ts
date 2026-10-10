// Wells, and what hunger and thirst do before they kill. A well stands in each of the two towns: whoever
// stands at one drinks their fill and fills every bottle they carry. Bottles hold more than one drink and are
// kept when they are empty, so water is a thing carried and come back for, not a thing found and gone.
// Rules and places only: the game draws the well and does the drinking (src/world/wells.ts, src/game/game.ts).

import { BUILDING_FOOTPRINT, TOWN, heightAt, type World } from '../world/worldgen';

export const WELL = {
  /** how near its middle somebody has to stand to drink at it, metres */
  reach: 2.7,
  /** seconds a drink at it takes */
  drink: 3.6,
  /** how far out its wall is, and how high */
  ring: 0.95,
  wall: 0.9,
};

export interface Well {
  x: number;
  y: number;
  z: number;
  /** which way it is turned (the beam its bucket hangs from runs across this) */
  rot: number;
  /** the town it is the well of */
  town: string;
}

/**
 * How hungry and how thirsty: 0 neither, 1 wanting (under a quarter left), 2 in a bad way (under a tenth).
 * Thirst takes the legs first, hunger the hands. With nothing left at all, health goes (Player.tickVitals).
 */
export const NEED = {
  wanting: 25,
  bad: 10,
  /** a sprint by somebody parched goes this much slower */
  slow: 0.88,
  /** breath comes back this much slower for either want, and this much for either in a bad way */
  breath: [1, 0.6, 0.4],
  /** a gun held by somebody hungry wanders this much more */
  shake: [1, 1.2, 1.55],
};
export const stage = (v: number): 0 | 1 | 2 => (v < NEED.bad ? 2 : v < NEED.wanting ? 1 : 0);

/**
 * Where the wells stand: one by the middle of the village and one by the middle of Kamenka, each at the nearest
 * place to it that is level, off the road, and clear of every building, tree and thing lying about. Found from
 * the map as it is, the same in every game: nothing of the map is moved to make room for one.
 */
export function wellSpots(world: World): Well[] {
  const H = world.heights;
  const lines = [world.road.points, ...world.roads.map((r) => r.points)];
  const offRoad = (x: number, z: number) => {
    let best = 1e9;
    for (const p of lines) {
      for (let i = 0; i + 5 < p.length; i += 3) {
        const ax = p[i], az = p[i + 2], dx = p[i + 3] - ax, dz = p[i + 5] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
    }
    return best;
  };
  const built = (x: number, z: number, margin: number) =>
    world.buildings.some((b) => {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
      return Math.abs(dx * c - dz * s) < w / 2 + margin && Math.abs(dx * s + dz * c) < d / 2 + margin;
    });
  const near = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  const level = (x: number, z: number) => {
    const y = heightAt(H, x, z);
    for (let k = 0; k < 8; k++) if (Math.abs(heightAt(H, x + Math.cos(k * 0.785) * 1.7, z + Math.sin(k * 0.785) * 1.7) - y) > 0.2) return false;
    return true;
  };
  const village = world.pois[0];
  const out: Well[] = [];
  for (const town of [{ name: village.name, x: village.x, z: village.z }, { name: TOWN.name, x: TOWN.x, z: TOWN.z }]) {
    search: for (let r = 9; r <= 70; r += 3) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + r * 0.37, x = town.x + Math.cos(a) * r, z = town.z + Math.sin(a) * r;
        if (built(x, z, 3.4) || offRoad(x, z) < 6.5 || near(world.trees, x, z, 4.5) || near(world.props, x, z, 2.8) || near(world.rocks, x, z, 3) || !level(x, z)) continue;
        // (turned to face the middle of its town)
        out.push({ x, y: heightAt(H, x, z), z, rot: Math.atan2(town.x - x, town.z - z), town: town.name });
        break search;
      }
    }
  }
  return out;
}
