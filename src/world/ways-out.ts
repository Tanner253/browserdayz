// Nothing stands in a building's way out (the owner, 2026-10-19: "on the map cell AP has barrels blocking the door of
// the building", and of Zastava: "theres a lot of these issues"). What the yards, the sites, the village and the towns
// set about the buildings is laid by its own dice, round a building or a place, and knew nothing of where the doors
// were: a drum, a crate, a pair of bins or a car stood in a door's way or its leaf's swing. When everything is laid,
// each such thing is slid along the wall the door is in, as little as clears it, and whatever lay on it with it.
// Nothing is thrown for it, so nothing else on the map moves; the same here and on the server (Buildings.plan).

import type { Blueprint, LootPoint } from './buildings';
import { BUILDING_FOOTPRINT, heightAt, type BuildingPlot, type Instance, type World } from './worldgen';

type V = [number, number];
/** how far out from a door its way is kept clear, and how far either side of it */
const OUT = 1.5, SIDE = 0.25, T = 0.2;
type Box = { min: number[]; max: number[] };

/** A door's way out, in the world: where along its wall it is, which way is out, and its leaf if it has one. */
interface Way { a: V; u: V; n: V; L: number; leaf: number }

/** Every outer door and opening on the ground floor of each building, and each of a model's doors, toward the outside. */
export function waysOf(plot: BuildingPlot, bp: Blueprint): Way[] {
  const c = Math.cos(plot.rot), s = Math.sin(plot.rot);
  const W = (x: number, z: number): V => [plot.x + x * c + z * s, plot.z - x * s + z * c], R = (x: number, z: number): V => [x * c + z * s, -x * s + z * c];
  const hw = bp.w / 2, hd = bp.d / 2, joined = new Set(bp.joined ?? []), out: Way[] = [];
  for (const wd of bp.walls) {
    if (wd.side === 'inner' || joined.has(wd.side)) continue;
    let a: V, e: V;
    switch (wd.side) {
      case 'front': a = [-hw, hd - T / 2]; e = [hw, hd - T / 2]; break;
      case 'back': a = [hw, -hd + T / 2]; e = [-hw, -hd + T / 2]; break;
      case 'left': a = [-hw + T / 2, -hd]; e = [-hw + T / 2, hd]; break;
      default: a = [hw - T / 2, hd]; e = [hw - T / 2, -hd];
    }
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]), u: V = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const axis = (v: number) => (Math.abs(u[0]) > 0.5 ? (v - a[0]) * Math.sign(u[0]) : (v - a[1]) * Math.sign(u[1]));
    for (const o of wd.openings) {
      if (o.bottom > 0.3 || o.kind === 'window' || o.kind === 'grille' || o.join) continue;
      const t0 = Math.min(axis(o.a), axis(o.b)), t1 = Math.max(axis(o.a), axis(o.b));
      out.push({ a: W(a[0] + u[0] * t0, a[1] + u[1] * t0), u: R(...u), n: R(-u[1], u[0]), L: t1 - t0, leaf: o.kind === 'door' ? t1 - t0 - 0.14 : 0 });
    }
  }
  for (const d of bp.whole?.doors ?? []) {
    // (a model's door swings on its hinge along its own +x; the side away from the building's middle is out)
    const u: V = [Math.cos(d.rot), -Math.sin(d.rot)];
    let n: V = [Math.sin(d.rot), Math.cos(d.rot)];
    if ((d.x + n[0]) ** 2 + (d.z + n[1]) ** 2 < d.x ** 2 + d.z ** 2) n = [-n[0], -n[1]];
    out.push({ a: W(d.x, d.z), u: R(...u), n: R(...n), L: d.w, leaf: d.w });
  }
  return out;
}

/** how far a thing's foot reaches into a way: > 0 is in it (a thing is its box, turned) */
export function into(w: Way, p: Instance, b: Box): boolean {
  const k = p.scale ?? 1, c = Math.cos(p.rot), s = Math.sin(p.rot);
  for (let x = b.min[0] * k + 0.04; x <= b.max[0] * k - 0.04; x += 0.08) for (let z = b.min[2] * k + 0.04; z <= b.max[2] * k - 0.04; z += 0.08) {
    const dx = p.x + x * c + z * s - w.a[0], dz = p.z - x * s + z * c - w.a[1];
    const t = dx * w.u[0] + dz * w.u[1], o = dx * w.n[0] + dz * w.n[1];
    if (o < T / 2 || o > OUT) continue;
    if (t > -SIDE && t < w.L + SIDE) return true;
    // (the leaf, swung out to the square)
    if (w.leaf && Math.hypot(t - 0.07, o) < w.leaf) return true;
  }
  return false;
}

/** Slide what stands in a way out clear of it. Returns how many were moved. */
export function clearWaysOut(world: World, planOf: (plot: BuildingPlot) => Blueprint, boxes: Record<string, Box>, points: LootPoint[]): number {
  const ways: Way[] = [];
  for (const plot of world.buildings) if (plot.type !== 'tower') ways.push(...waysOf(plot, planOf(plot)));
  const inBuilding = (x: number, z: number, m = -0.05) => world.buildings.some((o) => {
    const [w, d] = BUILDING_FOOTPRINT[o.type] ?? [0, 0], dx = x - o.x, dz = z - o.z, c = Math.cos(o.rot), s = Math.sin(o.rot);
    return Math.abs(dx * c - dz * s) < w / 2 + m && Math.abs(dx * s + dz * c) < d / 2 + m;
  });
  // (by cells of 8 m: the ways near a thing)
  const grid = new Map<string, Way[]>(), key = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
  for (const w of ways) {
    const cx = w.a[0] + w.u[0] * w.L / 2 + w.n[0] * OUT / 2, cz = w.a[1] + w.u[1] * w.L / 2 + w.n[1] * OUT / 2;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const k = key(cx + i * 8, cz + j * 8); (grid.get(k) ?? grid.set(k, []).get(k)!).push(w); }
  }
  const blocked = (p: Instance, b: Box) => (grid.get(key(p.x, p.z)) ?? []).find((w) => into(w, p, b));
  let moved = 0;
  for (const p of world.props) {
    const b = boxes[p.kind.split(/[#@]/)[0]];
    // (what stands in a room is the room's: see the plans; and what is low enough to step over is left)
    if (!b || (b.max[1] - b.min[1]) * (p.scale ?? 1) < 0.25 || (p.far !== undefined && p.far < 50) || inBuilding(p.x, p.z)) continue;
    const w = blocked(p, b);
    if (!w) continue;
    // along the wall, the nearer way round the door first, a little further each time; out from it last
    const r = Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) * (p.scale ?? 1) / 2;
    const t = (p.x - w.a[0]) * w.u[0] + (p.z - w.a[1]) * w.u[1];
    const ends = t < w.L / 2 ? [-SIDE - r - 0.1 - t, w.L + SIDE + r + 0.1 - t] : [w.L + SIDE + r + 0.1 - t, -SIDE - r - 0.1 - t];
    const tries: V[] = [];
    for (const extra of [0, 0.6, 1.2, 2.0, 3.0, 4.5]) for (const d of ends) tries.push([w.u[0] * (d + Math.sign(d) * extra), w.u[1] * (d + Math.sign(d) * extra)]);
    const o = (p.x - w.a[0]) * w.n[0] + (p.z - w.a[1]) * w.n[1];
    for (const extra of [0, 1, 2]) tries.push([w.n[0] * (OUT + r + 0.1 + extra - o), w.n[1] * (OUT + r + 0.1 + extra - o)]);
    const was = { x: p.x, z: p.z };
    const fits = (q: Instance) => !blocked(q, b) && !inBuilding(q.x, q.z, Math.min(r, 0.4)) && !world.props.some((o2) => o2 !== p && (o2.far === undefined || o2.far >= 50) && Math.hypot(o2.x - q.x, o2.z - q.z) < r + 0.3);
    const step = tries.find(([dx, dz]) => fits({ ...p, x: was.x + dx, z: was.z + dz }));
    if (!step) continue;
    const ground = (x: number, z: number) => heightAt(world.heights, x, z);
    const rise = ground(was.x + step[0], was.z + step[1]) - ground(was.x, was.z);
    p.x += step[0];
    p.z += step[1];
    p.y += rise;
    // (what was left lying on it goes with it: a water barrel's lid)
    for (const q of points) if (!q.floor && Math.abs(q.x - was.x) < 0.01 && Math.abs(q.z - was.z) < 0.01) {
      q.x += step[0];
      q.z += step[1];
      q.y += rise;
      if (q.surf) { q.surf.x += step[0]; q.surf.z += step[1]; }
    }
    moved++;
  }
  return moved;
}

/** how far round a basement's open steps nothing may stand, metres */
const KERB = 0.6;

/**
 * Nothing on, over or before the way down to a basement (the owner, 2026-10-23: "make sure no ground lootable
 * containers are blocking basement entrances. currently some entrances have a cardboard box floating above the
 * entrance"). The steps' opening and a pace round it are kept clear of everything that stands out of doors, however
 * low: over the open steps a thing stands on nothing. The basements are planned clear of what stands, but a town's
 * things are laid after them (Buildings.plan). Each is slid out across the nearer edge, as little as clears it, and
 * whatever lay on it with it; a place for a thing lying there by itself is moved the same way. Returns how many.
 */
export function clearWells(world: World, boxes: Record<string, Box>, points: LootPoint[]): number {
  const wells = world.basements ?? [];
  if (!wells.length) return 0;
  const frame = (b: (typeof wells)[number], x: number, z: number): V => { const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
  const back = (b: (typeof wells)[number], lx: number, lz: number): V => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [lx * c + lz * s, -lx * s + lz * c]; };
  const inBuilding = (x: number, z: number) => world.buildings.some((o) => {
    const [w, d] = BUILDING_FOOTPRINT[o.type] ?? [0, 0], dx = x - o.x, dz = z - o.z, c = Math.cos(o.rot), s = Math.sin(o.rot);
    return Math.abs(dx * c - dz * s) < w / 2 && Math.abs(dx * s + dz * c) < d / 2;
  });
  /** the well a thing of reach r at a place is in (out of doors and at the ground, not down in a cellar), if any */
  const wellAt = (x: number, y: number, z: number, r: number) => wells.find((b) => {
    if (Math.abs(x - b.x) > 30 || Math.abs(z - b.z) > 30 || y < b.well.top - 1) return false;
    const [lx, lz] = frame(b, x, z), W = b.well;
    return lx > W.x0 - KERB - r && lx < W.x1 + KERB + r && lz > W.z0 - KERB - r && lz < W.z1 + KERB + r;
  });
  const ground = (x: number, z: number) => heightAt(world.heights, x, z);
  let moved = 0;
  const slide = (x: number, y: number, z: number, r: number, free: (x: number, z: number) => boolean): V | null => {
    const b = wellAt(x, y, z, r);
    if (!b) return null;
    const [lx, lz] = frame(b, x, z), W = b.well, edge = KERB + r + 0.1;
    // (across the nearer edge first, a little further each time)
    const outs: [number, number][] = [[W.x0 - edge - lx, 0], [W.x1 + edge - lx, 0], [0, W.z0 - edge - lz], [0, W.z1 + edge - lz]].sort((p, q) => Math.hypot(...p) - Math.hypot(...q)) as [number, number][];
    for (const extra of [0, 0.5, 1, 2, 3]) for (const [ox, oz] of outs) {
      const [dx, dz] = back(b, ox + Math.sign(ox) * extra, oz + Math.sign(oz) * extra);
      if (!wellAt(x + dx, y, z + dz, r) && free(x + dx, z + dz)) return [dx, dz];
    }
    return null;
  };
  for (const p of world.props) {
    if (inBuilding(p.x, p.z)) continue;
    const bx = boxes[p.kind.split(/[#@]/)[0]], r = bx ? (Math.min(bx.max[0] - bx.min[0], bx.max[2] - bx.min[2]) * (p.scale ?? 1)) / 2 : 0.3;
    const step = slide(p.x, p.y, p.z, r, (x, z) => !inBuilding(x, z) && !world.props.some((o) => o !== p && (o.far === undefined || o.far >= 50) && Math.hypot(o.x - x, o.z - z) < r + 0.3));
    if (!step) continue;
    const was = { x: p.x, z: p.z }, rise = ground(was.x + step[0], was.z + step[1]) - ground(was.x, was.z);
    p.x += step[0];
    p.z += step[1];
    p.y += rise;
    for (const q of points) if (!q.floor && Math.abs(q.x - was.x) < 0.01 && Math.abs(q.z - was.z) < 0.01) {
      q.x += step[0];
      q.z += step[1];
      q.y += rise;
      if (q.surf) { q.surf.x += step[0]; q.surf.z += step[1]; }
    }
    moved++;
  }
  for (const q of points) {
    if (q.floor || inBuilding(q.x, q.z)) continue;
    const step = slide(q.x, q.y, q.z, 0.2, (x, z) => !inBuilding(x, z));
    if (!step) continue;
    const rise = ground(q.x + step[0], q.z + step[1]) - ground(q.x, q.z);
    q.x += step[0];
    q.z += step[1];
    q.y += rise;
    if (q.surf) { q.surf.x += step[0]; q.surf.z += step[1]; }
    moved++;
  }
  return moved;
}
