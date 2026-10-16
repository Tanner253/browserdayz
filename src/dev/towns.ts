// `?towns` on a development build: a new town (src/sim/towns.ts) stood on level ground of its own in the north-west
// corner of today's map, in the game as it is, to be walked and looked at before it has its place in the new land
// (`?towns=lipki` for the hamlet; Pokrov otherwise). Never loaded in a built site.
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
import { CELL, WORLD_SIZE, idx, type World } from '../world/worldgen';
import { BUILDING_FOOTPRINT } from '../world/worldgen/layout';
import type { KitPiece } from '../sim/kit';
import { LIPKI, POKROV, placedWalls, townBuildings, townPoint, type Town } from '../sim/towns';

const which = new URLSearchParams(location.search).get('towns') === 'lipki' ? 'lipki' : 'pokrov';
/** where it is stood for looking at: the north-west corner, which nothing of today's map uses */
const HERE = { x: -448, z: -540 };
let town: Town = { ...(which === 'lipki' ? LIPKI : POKROV), ...HERE };
let padY = 0;
let walls: KitPiece[] = [];

/** The corner levelled and cleared, and the town's buildings added. Before anything is built from the world. */
export function lay(world: World) {
  const half = WORLD_SIZE / 2, [px, pz] = town.pad, edge = 40;
  const i0 = Math.max(0, Math.floor((town.x - px - edge + half) / CELL)), i1 = Math.ceil((town.x + px + edge + half) / CELL);
  const j0 = Math.max(0, Math.floor((town.z - pz - edge + half) / CELL)), j1 = Math.ceil((town.z + pz + edge + half) / CELL);
  const was: number[] = [];
  for (let j = j0; j <= j1; j += 6) for (let i = i0; i <= i1; i += 6) was.push(world.heights[idx(i, j)]);
  was.sort((a, b) => a - b);
  padY = was[was.length >> 1];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -half + i * CELL, z = -half + j * CELL;
    const out = Math.max(Math.abs(x - town.x) - px, Math.abs(z - town.z) - pz, 0);
    const t = Math.min(1, out / edge), mix = 1 - t * t * (3 - 2 * t);
    const k = idx(i, j);
    world.heights[k] = world.surface[k] = world.heights[k] * (1 - mix) + padY * mix;
  }
  const off = (q: { x: number; z: number }) => Math.abs(q.x - town.x) > px + 8 || Math.abs(q.z - town.z) > pz + 8;
  world.trees = world.trees.filter(off);
  world.rocks = world.rocks.filter(off);
  world.props = world.props.filter(off);
  const spots = townBuildings(town);
  spots.forEach((s, n) => {
    const [x, z] = townPoint(town, s.x, s.z);
    world.buildings.push({ id: `${town.name.toLowerCase()}_${n}`, type: s.type, x, z, rot: town.rot + s.rot, floorY: padY + 0.3, seed: 9100 + n * 37, ...(s.arms ? { arms: s.arms } : {}) });
    // (no grass through its floors: what the map's own planning does for every building)
    const [fw, fd] = BUILDING_FOOTPRINT[s.type], c = Math.cos(town.rot + s.rot), sn = Math.sin(town.rot + s.rot), reach = Math.hypot(fw, fd) / 2 + 2;
    for (let j = Math.floor((z - reach + half) / CELL); j <= Math.ceil((z + reach + half) / CELL); j++) for (let i = Math.floor((x - reach + half) / CELL); i <= Math.ceil((x + reach + half) / CELL); i++) {
      const dx = -half + i * CELL - x, dz = -half + j * CELL - z;
      if (Math.abs(dx * c - dz * sn) < fw / 2 + 1.5 && Math.abs(dx * sn + dz * c) < fd / 2 + 1.5) world.grass[idx(i, j)] = 0;
    }
  });
  walls = placedWalls({ town, padY });
}

/** The town's walls and domes, drawn by the game's own module (src/world/towns.ts). After the ground and the buildings are built. */
export async function stand(atmo: Atmosphere, r: Renderer, buildings: Buildings) {
  const towns = new Towns(atmo, r.scene, [{ town, padY }], buildings, (o) => r.ready(o).then(() => r.send(o)));
  await towns.build();
  // (the game has no hook for it yet: it is told where the eye is from here, as ?ruins does)
  setInterval(() => {
    const g = (window as unknown as { __game?: { s: { r: { camera: THREE.Camera } } } }).__game;
    if (g) towns.update(g.s.r.camera.position);
  }, 400);
  console.info(`[towns] ${town.name}: ${walls.length} wall pieces, far copy ${towns.counts.far} triangles`);
  (window as unknown as Record<string, unknown>).TW = { town, padY, walls, towns };
}
