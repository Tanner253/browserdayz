// `?ruins` on a development build: the ruined town (src/sim/ruins.ts) stood by itself on a plain of its own, in
// the game as it is, to be walked and looked at before it has a place on the map. Never loaded in a built site.
//
// A corner of the map nothing stands in (the north-west, 640 m by 512) is levelled and shaped to the ground the
// town assumes (`ruinsGround`), its trees and rocks taken away, and the town set down on it as it really stood
// (`ruinsPlan`). The ground is the game's own net of two metres, so what is seen here of ground against masonry
// is what the map will show. `?ruins=30` turns the whole town thirty degrees, to see that nothing depends on
// which way it faces.
//
// For whoever drives it by script: `window.RU` has the town's place, each piece's place, and the modules.

import * as THREE from 'three';
import { assets } from '../core/assets';
import type { Renderer } from '../core/renderer';
import type { Atmosphere } from '../world/atmosphere';
import type { Buildings } from '../world/buildings';
import type { Terrain } from '../world/terrain';
import { CELL, WORLD_SIZE, heightAt, idx, type World } from '../world/worldgen';
import { Ruins } from '../world/ruins';
import * as shape from '../world/ruins-shape';
import * as sim from '../sim/ruins';

/** the corner that is given over to it: whole tiles of the ground (128 m each), so that they can be painted as desert */
const PATCH = { x0: -768, x1: -128, z0: -768, z1: -256, edge: 44 };
/** the colours of the ground by what it is, as the sun shows them */
const TINT: Record<sim.GroundKind | 'path', [number, number, number]> = {
  top: [0.74, 0.68, 0.57], court: [0.66, 0.6, 0.5], dug: [0.6, 0.55, 0.46], scarp: [0.7, 0.62, 0.48], berm: [0.72, 0.65, 0.52], moat: [0.62, 0.57, 0.47], plain: [0.83, 0.74, 0.56], path: [0.8, 0.77, 0.7],
};

let site: sim.Place = { x: -420, y: 0, z: -495, rot: 0 };
let plan: { piece: sim.Piece; place: sim.Place }[] = [];
/** the ground's colour at every point of the net across the patch */
let tint: Uint8Array | null = null;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The corner of the world made into the town's plain: its heights, what it is painted with, and what stood on it. Before anything is built from the world. */
export function lay(world: World) {
  const turn = Number(new URLSearchParams(location.search).get('ruins') || 0);
  const half = WORLD_SIZE / 2, i0 = (PATCH.x0 + half) / CELL, i1 = (PATCH.x1 + half) / CELL, j0 = (PATCH.z0 + half) / CELL, j1 = (PATCH.z1 + half) / CELL;
  // the plain is at the height the corner mostly was, so that it meets what is round it without a cliff
  const was: number[] = [];
  for (let j = j0; j <= j1; j += 8) for (let i = i0; i <= i1; i += 8) was.push(world.heights[idx(i, j)]);
  was.sort((a, b) => a - b);
  site = { x: -420, y: Math.round(was[was.length >> 1]) - sim.MOAT.plain, z: -495, rot: (turn * Math.PI) / 180 };
  plan = sim.ruinsPlan(site);
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  tint = new Uint8Array(w * h * 4);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -half + i * CELL, z = -half + j * CELL, [lx, lz] = sim.ruinLocal(site, x, 0, z), g = sim.ruinsGround(lx, lz);
    const k = idx(i, j), mix = smooth(0, PATCH.edge, Math.min(x - PATCH.x0, PATCH.x1 - x, z - PATCH.z0, PATCH.z1 - z));
    // (a little unevenness, off the masonry: nothing in a desert is laid with a level)
    const wild = g.hold ? 0 : (sim.rough(x * 0.07, z * 0.07, 5) - 0.5) * 0.7 + (sim.rough(x * 0.31, z * 0.31, 6) - 0.5) * 0.16;
    world.heights[k] = world.surface[k] = world.heights[k] * (1 - mix) + (site.y + g.y + wild) * mix;
    world.splat.set([0, 0, 0, 255], k * 4);
    world.grass[k] = 0;
    const onPath = g.kind === 'top' && sim.PATHS.some((p) => p.some((a, n) => n + 1 < p.length && toLine(lx, lz, a, p[n + 1]) < 1.9));
    const c = TINT[onPath ? 'path' : g.kind], v = 0.9 + 0.2 * sim.rough(x * 0.045, z * 0.045, 7);
    tint.set([c[0] * v * 255, c[1] * v * 255, c[2] * v * 255, 255], ((j - j0) * w + (i - i0)) * 4);
  }
  // nothing grows or lies on it; and the forest round it is thinned (this is looked at with the machine's card busy elsewhere)
  const off = (q: { x: number; z: number }) => q.x < PATCH.x0 - 6 || q.x > PATCH.x1 + 6 || q.z < PATCH.z0 - 6 || q.z > PATCH.z1 + 6;
  world.trees = world.trees.filter((q, n) => off(q) && n % 4 === 0);
  world.rocks = world.rocks.filter(off);
  world.props = world.props.filter(off);
  const ground: sim.GroundAt = (x, z) => heightAt(world.heights, x, z);
  for (const { piece, place } of plan) world.props.push(...sim.ruinProps(piece, place, ground));
}
function toLine(x: number, z: number, a: sim.V2, b: sim.V2) {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** The town stood on its plain, the plain painted as desert, and the places things lie added to the world's. After the ground and the buildings are built, before the game is. */
export function stand(world: World, atmo: Atmosphere, r: Renderer, terrain: Terrain, buildings: Buildings) {
  // (got ready as the game gets anything ready that comes while it is played: off the picture, in the spare of frames)
  const ruins = new Ruins(atmo, r.scene, plan, (o) => r.ready(o).then(() => r.send(o)));
  const ground: sim.GroundAt = (x, z) => heightAt(world.heights, x, z);
  for (const { piece, place } of plan) buildings.lootPoints.push(...sim.ruinLoot(piece, place, ground));

  // the plain's own paint: stony ground, washed with the colour of what it is (sand, bare earth, the gravel of a path)
  const t = assets.pbr('rocks_ground_02'), w = (PATCH.x1 - PATCH.x0) / CELL + 1, h = (PATCH.z1 - PATCH.z0) / CELL + 1;
  const kinds = new THREE.DataTexture(tint!, w, h, THREE.RGBAFormat);
  kinds.magFilter = kinds.minFilter = THREE.LinearFilter;
  kinds.colorSpace = THREE.SRGBColorSpace;
  kinds.needsUpdate = true;
  const desert = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  atmo.register(desert, (shader) => {
    Object.assign(shader.uniforms, { tStones: { value: t.map }, tKinds: { value: kinds }, uPatch: { value: new THREE.Vector4(PATCH.x0 - CELL / 2, PATCH.z0 - CELL / 2, 1 / (w * CELL), 1 / (h * CELL)) } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDesert;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDesert = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDesert;\nuniform sampler2D tStones;\nuniform sampler2D tKinds;\nuniform vec4 uPatch;')
      .replace(
        '#include <map_fragment>',
        `{
  // (from far off the stones are too small to see, and their picture laid over and over is all that is: there it gives way to itself laid large)
  vec3 near = texture2D(tStones, vDesert.xz / 2.8).rgb, far = texture2D(tStones, vDesert.xz / 37.0).rgb;
  vec3 stones = mix(near, far, 0.3 + 0.62 * smoothstep(25.0, 140.0, distance(vDesert, cameraPosition)));
  // (half its own colour kept: sand is not brown gravel, but it is not paint either)
  stones = mix(vec3(dot(stones, vec3(0.3, 0.59, 0.11))), stones, 0.5) * 2.6;
  diffuseColor.rgb *= stones * texture2D(tKinds, (vDesert.xz - uPatch.xy) * uPatch.zw).rgb;
}`,
      );
  }, 'ruins-desert');
  for (const tile of terrain.mesh.children as THREE.Mesh[]) {
    const c = tile.geometry.boundingBox!.getCenter(new THREE.Vector3());
    if (c.x > PATCH.x0 && c.x < PATCH.x1 && c.z > PATCH.z0 && c.z < PATCH.z1) tile.material = desert;
  }

  // (the game has no hook for it yet: it is told where the eye is from here. `&hold` leaves that to whoever drives
  // the page by script, so that what it costs to come to can be measured from the first step)
  if (!new URLSearchParams(location.search).has('hold')) {
    setInterval(() => {
      const g = (window as unknown as { __game?: { s: { r: { camera: THREE.Camera } } } }).__game;
      if (g) ruins.update(g.s.r.camera.position);
    }, 400);
  }
  const at = (piece: sim.Piece, x: number, z: number, y = 0, n = 0) => sim.ruinAt(plan.filter((q) => q.piece === piece)[n].place, x, z, y);
  (window as unknown as Record<string, unknown>).RU = { site, plan, ruins, sim, shape, at, ground, PATCH };
}
