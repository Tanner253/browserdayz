// `?towns` on a development build: a new town (src/sim/towns.ts) stood on level ground of its own in the north-west
// corner of today's map, in the game as it is, to be walked and looked at before it has its place in the new land
// (`?towns=<name>`: lipki, zavod, ozerki, mokroye; Pokrov otherwise). Never loaded in a built site.
//
// The corner is levelled to the height it mostly was, its trees and rocks taken away, the town's buildings added
// to the world's as any building is (so their rooms, doors, stairs and places for things are the game's own), and
// the monastery's walls stood from the fort kit, re-skinned, with what stops a body.
//
// For whoever drives it by script: `window.TW` has the town, its buildings and the wall's pieces.

import * as THREE from 'three';
import type { Renderer } from '../core/renderer';
import type { Atmosphere } from '../world/atmosphere';
import type { Buildings } from '../world/buildings';
import { Towns } from '../world/towns';
import { CELL, WORLD_X0, WORLD_Z0, heightAt, idx, type World } from '../world/worldgen';
import { Waterways } from '../world/water';
import { BUILDING_FOOTPRINT } from '../world/worldgen/layout';
import type { KitPiece } from '../sim/kit';
import { POKROV, TOWNS, moundAt, placedSlabs, placedWalls, townBuildings, townGround, townPoint, townThings, type Town } from '../sim/towns';

const asked = (new URLSearchParams(location.search).get('towns') ?? '').toLowerCase();
/** where it is stood for looking at: the north-west corner, which nothing of today's map uses */
const HERE = { x: -448, z: -540 };
let town: Town = { ...(TOWNS.find((t) => t.name.toLowerCase() === asked) ?? POKROV), ...HERE };
let padY = 0;
let walls: KitPiece[] = [];
/** the world's buildings, the town's among them (those that wear a facade are dressed by the towns' module) */
let plots: World['buildings'] = [];
/** the world as laid (its ground, for the water drawn over a swamp's town) */
let laid: World | null = null;

/** The corner levelled and cleared, and the town's buildings added. Before anything is built from the world. */
export function lay(world: World) {
  const [px, pz] = town.pad, edge = 40;
  const i0 = Math.max(0, Math.floor((town.x - px - edge - WORLD_X0) / CELL)), i1 = Math.ceil((town.x + px + edge - WORLD_X0) / CELL);
  const j0 = Math.max(0, Math.floor((town.z - pz - edge - WORLD_Z0) / CELL)), j1 = Math.ceil((town.z + pz + edge - WORLD_Z0) / CELL);
  const was: number[] = [];
  for (let j = j0; j <= j1; j += 6) for (let i = i0; i <= i1; i += 6) was.push(world.heights[idx(i, j)]);
  /** a point of the world in the town's own frame */
  const local = (x: number, z: number): [number, number] => {
    const c = Math.cos(town.rot), s = Math.sin(town.rot), dx = x - town.x, dz = z - town.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  was.sort((a, b) => a - b);
  padY = was[was.length >> 1];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = WORLD_X0 + i * CELL, z = WORLD_Z0 + j * CELL;
    const out = Math.max(Math.abs(x - town.x) - px, Math.abs(z - town.z) - pz, 0);
    const t = Math.min(1, out / edge), mix = 1 - t * t * (3 - 2 * t);
    const k = idx(i, j), [lx, lz] = local(x, z);
    world.heights[k] = world.surface[k] = world.heights[k] * (1 - mix) + (padY + moundAt(town, lx, lz)) * mix;
  }
  const off = (q: { x: number; z: number }) => Math.abs(q.x - town.x) > px + 8 || Math.abs(q.z - town.z) > pz + 8;
  world.trees = world.trees.filter(off);
  world.rocks = world.rocks.filter(off);
  world.props = world.props.filter(off);
  const spots = townBuildings(town);
  spots.forEach((s, n) => {
    const [x, z] = townPoint(town, s.x, s.z);
    world.buildings.push({ id: `${town.name.toLowerCase()}_${n}`, type: s.type, x, z, rot: town.rot + s.rot, floorY: padY + (s.up ?? moundAt(town, s.x, s.z) + 0.3), seed: 9100 + n * 37, ...(s.arms ? { arms: s.arms } : {}) });
    // (no grass through its floors: what the map's own planning does for every building)
    const [fw, fd] = BUILDING_FOOTPRINT[s.type], c = Math.cos(town.rot + s.rot), sn = Math.sin(town.rot + s.rot), reach = Math.hypot(fw, fd) / 2 + 2;
    for (let j = Math.floor((z - reach - WORLD_Z0) / CELL); j <= Math.ceil((z + reach - WORLD_Z0) / CELL); j++) for (let i = Math.floor((x - reach - WORLD_X0) / CELL); i <= Math.ceil((x + reach - WORLD_X0) / CELL); i++) {
      const dx = WORLD_X0 + i * CELL - x, dz = WORLD_Z0 + j * CELL - z;
      if (Math.abs(dx * c - dz * sn) < fw / 2 + 1.5 && Math.abs(dx * sn + dz * c) < fd / 2 + 1.5) world.grass[idx(i, j)] = 0;
    }
  });
  // its yards gravelled and its lanes trodden (the world's own paint: grass, forest floor, rock, gravel), no blades on them
  const ground = townGround(town), c = Math.cos(town.rot), s = Math.sin(town.rot);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const wx = WORLD_X0 + i * CELL - town.x, wz = WORLD_Z0 + j * CELL - town.z, lx = wx * c - wz * s, lz = wx * s + wz * c;
    let out = 1e9;
    for (const [x0, z0, x1, z1] of [...ground.yards, ...(ground.beds ?? [])]) out = Math.min(out, Math.max(x0 - lx, lx - x1, z0 - lz, lz - z1));
    for (const { line, w } of ground.lanes) for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k], [bx, bz] = line[k + 1], ex = bx - ax, ez = bz - az;
      const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (lz - az) * ez) / (ex * ex + ez * ez)));
      out = Math.min(out, Math.hypot(lx - ax - ex * t, lz - az - ez * t) - w / 2);
    }
    // (the edge ragged over a metre and a half)
    const wob = Math.sin(lx * 0.7 + lz * 0.3) * 0.5 + Math.sin(lz * 1.3 - lx * 0.4) * 0.4;
    const bare = 1 - Math.min(1, Math.max(0, (out + wob + 0.5) / 1.6));
    if (bare <= 0) continue;
    const k = idx(i, j), sp = world.splat;
    // (a garden's bed is dug earth, the forest floor's paint; the rest gravel)
    const dug = (ground.beds ?? []).some(([x0, z0, x1, z1]) => lx > x0 && lx < x1 && lz > z0 && lz < z1), to = dug ? 1 : 3;
    for (let ch = 0; ch < 4; ch++) sp[k * 4 + ch] = Math.round(sp[k * 4 + ch] * (1 - bare) + (ch === to ? 255 * bare : 0));
    world.grass[k] = Math.round(world.grass[k] * (1 - bare));
  }
  // what lies about it (a container stacked on another stands on it: the planning of the buildings stands each)
  for (const t of townThings(town)) {
    const [x, z] = townPoint(town, t.x, t.z);
    // (what grows in a garden is drawn only from near, a stack of logs from no farther than a street's length)
    const near = t.kind === 'pumpkin' || t.kind === 'cabbage' ? { far: 40 } : t.kind === 'log_pile' ? { far: 150 } : {};
    world.props.push({ kind: t.kind, x, y: padY + moundAt(town, t.x, t.z) + (t.up ?? 0), z, rot: town.rot + t.rot, scale: 1, ...near });
  }
  (world.slabs ??= []).push(...placedSlabs(town));
  walls = placedWalls({ town, padY });
  plots = world.buildings;
  laid = world;
}

/** The town's walls and domes, drawn by the game's own module (src/world/towns.ts). After the ground and the buildings are built. */
export async function stand(atmo: Atmosphere, r: Renderer, buildings: Buildings) {
  const towns = new Towns(atmo, r.scene, [{ town, padY }], buildings, (o) => r.ready(o).then(() => r.send(o)), plots);
  await towns.build();
  // (the game has no hook for it yet: it is told where the eye is from here, as ?ruins does)
  setInterval(() => {
    const g = (window as unknown as { __game?: { s: { r: { camera: THREE.Camera } } } }).__game;
    if (g) towns.update(g.s.r.camera.position);
  }, 400);
  // (a town in water: its water drawn over it as the world will draw the swamp's, until the world's own is hooked in)
  const wet = townGround(town).water;
  let water: Waterways | null = null;
  if (wet && laid) {
    const ground = laid.heights, outline = wet.outline.map(([x, z]) => townPoint(town, x, z));
    water = new Waterways(r.scene, atmo, { lakes: [{ name: town.name, level: padY + wet.level, outline, swamp: wet.swamp }], rivers: [] }, (x, z) => heightAt(ground, x, z));
    let last = performance.now();
    const tick = () => {
      const g = (window as unknown as { __game?: { s: { r: { camera: THREE.Camera } } } }).__game, now = performance.now();
      if (g) water!.update((now - last) / 1000, g.s.r.camera.position, g.s.r.camera);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  console.info(`[towns] ${town.name}: ${walls.length} wall pieces, far copy ${towns.counts.far} triangles`);
  (window as unknown as Record<string, unknown>).TW = { town, padY, walls, towns, water };
}
