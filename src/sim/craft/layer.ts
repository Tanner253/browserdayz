// Room on the map for crafting's layers of their own (2026-10-25: the wrecks, the recyclers, the trader camp's stalls).
// Each is laid after everything else, with a seed of its own, so that nothing the map already has moves (the navigator:
// "New wrecks are allowed only in a layer of their own: own seed, placed after everything else, so nothing existing
// moves"). What may stand where: open, level ground, clear of every building, road, water, tree, rock and thing already
// there, and sunk a little into it where it meets it.

import { heightAt } from '../../world/worldgen/ground';
import { BUILDING_FOOTPRINT } from '../../world/worldgen/layout';
import type { World } from '../../world/worldgen';
import { wetAt } from '../build/land';

export type LayerWorld = Pick<World, 'heights' | 'buildings' | 'roads' | 'props' | 'trees' | 'rocks' | 'water'>;

export interface Fit {
  /** how far clear of a building's walls, m (over its half-width) */
  margin?: number;
  /** how far clear of a road's edge, m */
  road?: number;
  /** the most its corners' ground may differ, m */
  level?: number;
  /** how far it sinks into the ground at its lowest corner, m */
  sink?: number;
}

export interface Room {
  /** where a thing `l` long (along its own z) and `w` wide, turned `rot`, may lie at x, z: its foot's height, or null */
  fit(x: number, z: number, l: number, w: number, rot: number, o?: Fit): number | null;
  /** something now stands there: nothing else is laid within `r` of it */
  stand(x: number, z: number, r: number): void;
  ground(x: number, z: number): number;
}

export function roomOn(world: LayerWorld): Room {
  const ground = (x: number, z: number) => heightAt(world.heights, x, z), wet = wetAt(world.water, ground);
  // (what stands already, in cells of 8 m)
  const CELL = 8, cells = new Map<string, { x: number; z: number; r: number }[]>();
  const stand = (x: number, z: number, r: number) => {
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push({ x, z, r });
  };
  for (const list of [world.props, world.trees, world.rocks]) for (const t of list) stand(t.x, t.z, 0.6 + 0.6 * (t.scale ?? 1));
  const clear = (x: number, z: number, r: number) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (const s of cells.get(`${Math.floor(x / CELL) + dx},${Math.floor(z / CELL) + dz}`) ?? []) if (Math.hypot(s.x - x, s.z - z) < r + s.r) return false;
    }
    return true;
  };
  const inBuilding = (x: number, z: number, margin: number) =>
    world.buildings.some((b) => {
      const [fw, fd] = BUILDING_FOOTPRINT[b.type] ?? [10, 10], dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < fw / 2 + margin && Math.abs(lz) < fd / 2 + margin;
    });
  const nearRoad = (x: number, z: number, r: number) =>
    world.roads.some((road) => {
      const p = road.points, half = road.width / 2 + r;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
        if (Math.hypot(ax + vx * t - x, az + vz * t - z) < half) return true;
      }
      return false;
    });
  return {
    ground,
    stand,
    fit(x, z, l, w, rot, o = {}) {
      const r = Math.hypot(l, w) / 2;
      if (inBuilding(x, z, r + (o.margin ?? 1.5)) || nearRoad(x, z, r + (o.road ?? 1)) || wet(x, z) || !clear(x, z, r)) return null;
      // (on level ground, seated: its lowest corner taken, and a hand's breadth into it)
      const c = Math.cos(rot), s = Math.sin(rot), corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => ground(x + (u * w * c) / 2 + (v * l * s) / 2, z - (u * w * s) / 2 + (v * l * c) / 2));
      if (Math.max(...corners) - Math.min(...corners) > (o.level ?? 0.7)) return null;
      return Math.min(...corners) - (o.sink ?? 0.1);
    },
  };
}
