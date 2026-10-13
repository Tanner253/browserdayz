// `?ruins` on a development build: the ruined town (src/sim/ruins.ts) stood by itself on land of its own, in the
// game as it is, to be walked and looked at before it has a place on the map. Never loaded in a built site.
//
// A corner of the map nothing stands in (the north-west, 640 m by 512) is shaped to the land the town really
// stands on (`ruinsGround`: its top, its banks and moat, the river's flats and dry bed), its trees and rocks taken
// away, and the town set down on it as it stood (`ruinsPlan`). The ground is the game's own net of two metres, so
// what is seen here of ground against masonry is what the map will show. It is painted by what kind of ground
// each spot is (`GROUNDS` in src/world/ruins-shape.ts: sand, desert gravel, cracked silt), by this page's own
// paint: the map's ground is the terrain's to paint, and this is the brief for it. `?ruins=30` turns the whole
// town thirty degrees, to see that nothing depends on which way it faces.
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
/** the three pictures the ground is painted with here, in the order their shares are kept in */
const PICTURES = ['sand_01', 'sandy_gravel_02', 'mud_cracked_dry_riverbed_002'] as const;
/** a kind's colour is kept in bytes: this is what the brightest byte stands for */
const BRIGHT = 1.6;

let site: sim.Place = { x: -420, y: 0, z: -495, rot: 0 };
let plan: { piece: sim.Piece; place: sim.Place }[] = [];
/** at every point of the net across the patch: how much of each picture the ground is there, and the colour it is washed with */
let shares: Uint8Array | null = null, washes: Uint8Array | null = null;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The corner of the world made into the town's land: its heights, what it is painted with, and what stood on it. Before anything is built from the world. */
export function lay(world: World) {
  const turn = Number(new URLSearchParams(location.search).get('ruins') || 0);
  const half = WORLD_SIZE / 2, i0 = (PATCH.x0 + half) / CELL, i1 = (PATCH.x1 + half) / CELL, j0 = (PATCH.z0 + half) / CELL, j1 = (PATCH.z1 + half) / CELL;
  // the plain is at the height the corner mostly was, so that it meets what is round it without a cliff
  const was: number[] = [];
  for (let j = j0; j <= j1; j += 8) for (let i = i0; i <= i1; i += 8) was.push(world.heights[idx(i, j)]);
  was.sort((a, b) => a - b);
  site = { x: -420, y: Math.round(was[was.length >> 1]) - sim.LAND.plain, z: -495, rot: (turn * Math.PI) / 180 };
  plan = sim.ruinsPlan(site);
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  shares = new Uint8Array(w * h * 4);
  washes = new Uint8Array(w * h * 4);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -half + i * CELL, z = -half + j * CELL, [lx, lz] = sim.ruinLocal(site, x, 0, z), g = sim.ruinsGround(lx, lz);
    const k = idx(i, j), mix = smooth(0, PATCH.edge, Math.min(x - PATCH.x0, PATCH.x1 - x, z - PATCH.z0, PATCH.z1 - z));
    world.heights[k] = world.surface[k] = world.heights[k] * (1 - mix) + (site.y + g.y) * mix;
    world.splat.set([0, 0, 0, 255], k * 4);
    world.grass[k] = 0;
    const G = shape.GROUNDS[g.kind], n = ((j - j0) * w + (i - i0)) * 4, which = PICTURES.indexOf(G.tex);
    shares.set([which === 0 ? 255 : 0, which === 1 ? 255 : 0, which === 2 ? 255 : 0, 255], n);
    washes.set([Math.min(255, (G.tint[0] / BRIGHT) * 255), Math.min(255, (G.tint[1] / BRIGHT) * 255), Math.min(255, (G.tint[2] / BRIGHT) * 255), 255], n);
  }
  // nothing grows or lies on it; and the forest round it is thinned (this is looked at with the machine's card busy elsewhere)
  const off = (q: { x: number; z: number }) => q.x < PATCH.x0 - 6 || q.x > PATCH.x1 + 6 || q.z < PATCH.z0 - 6 || q.z > PATCH.z1 + 6;
  world.trees = world.trees.filter((q, n) => off(q) && n % 4 === 0);
  world.rocks = world.rocks.filter(off);
  world.props = world.props.filter(off);
  const ground: sim.GroundAt = (x, z) => heightAt(world.heights, x, z);
  for (const { piece, place } of plan) world.props.push(...sim.ruinProps(piece, place, ground));
}

/** The town stood on its land, the land painted as desert, and the places things lie added to the world's. After the ground and the buildings are built, before the game is. */
export function stand(world: World, atmo: Atmosphere, r: Renderer, terrain: Terrain, buildings: Buildings) {
  // (got ready as the game gets anything ready that comes while it is played: off the picture, in the spare of frames)
  const ruins = new Ruins(atmo, r.scene, plan, (o) => r.ready(o).then(() => r.send(o)));
  const ground: sim.GroundAt = (x, z) => heightAt(world.heights, x, z);
  for (const { piece, place } of plan) buildings.lootPoints.push(...sim.ruinLoot(piece, place, ground));

  // the land's own paint: three pictures, each laid by whichever way the ground faces (so that a bank is not a
  // smear), as much of each as the kind of ground at a spot says, washed with that kind's colour
  const w = (PATCH.x1 - PATCH.x0) / CELL + 1, h = (PATCH.z1 - PATCH.z0) / CELL + 1;
  const data = (bytes: Uint8Array) => {
    const t = new THREE.DataTexture(bytes, w, h, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const pictures = PICTURES.map((id) => assets.texture(assets.manifest.textures[id].diff, { srgb: true, repeat: true }));
  const tiles = PICTURES.map((id) => Object.values(shape.GROUNDS).find((q) => q.tex === id)!.tile);
  const desert = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  atmo.register(desert, (shader) => {
    Object.assign(shader.uniforms, {
      tSand: { value: pictures[0] }, tGravel: { value: pictures[1] }, tSilt: { value: pictures[2] }, tShares: { value: data(shares!) }, tWashes: { value: data(washes!) },
      uPatch: { value: new THREE.Vector4(PATCH.x0 - CELL / 2, PATCH.z0 - CELL / 2, 1 / (w * CELL), 1 / (h * CELL)) }, uTiles: { value: new THREE.Vector3(...tiles) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDesert;\nvarying vec3 vDesertN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDesert = (modelMatrix * vec4(position, 1.0)).xyz;\nvDesertN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vDesert;
varying vec3 vDesertN;
uniform sampler2D tSand;
uniform sampler2D tGravel;
uniform sampler2D tSilt;
uniform sampler2D tShares;
uniform sampler2D tWashes;
uniform vec4 uPatch;
uniform vec3 uTiles;
float desertHash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
float desertNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( desertHash( i ), desertHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( desertHash( i + vec3( 0.0, 1.0, 0.0 ) ), desertHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
    mix( mix( desertHash( i + vec3( 0.0, 0.0, 1.0 ) ), desertHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( desertHash( i + vec3( 0.0, 1.0, 1.0 ) ), desertHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ),
    f.z );
}
// a picture laid three ways, most of whichever way the ground faces
vec3 desertLaid( sampler2D t, float tile, vec3 by ) {
  return texture2D( t, vDesert.xz / tile ).rgb * by.y + texture2D( t, vDesert.zy / tile ).rgb * by.x + texture2D( t, vDesert.xy / tile ).rgb * by.z;
}`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  vec2 at = ( vDesert.xz - uPatch.xy ) * uPatch.zw;
  vec3 share = texture2D( tShares, at ).rgb;
  share /= share.r + share.g + share.b + 0.0001;
  vec3 by = pow( abs( normalize( vDesertN ) ), vec3( 6.0 ) );
  by /= by.x + by.y + by.z;
  vec3 laid = desertLaid( tSand, uTiles.x, by ) * share.r + desertLaid( tGravel, uTiles.y, by ) * share.g + desertLaid( tSilt, uTiles.z, by ) * share.b;
  // (a slow change of tone over the whole of it, and long pale streaks the way the wind goes: no stretch of sand is one colour)
  float slow = 0.84 + 0.3 * ( desertNoise( vDesert * 0.019 ) * 0.6 + desertNoise( vDesert * 0.083 + 5.0 ) * 0.4 );
  float drift = 0.94 + 0.12 * desertNoise( vec3( vDesert.x * 0.035 + vDesert.z * 0.012, 3.0, vDesert.z * 0.31 - vDesert.x * 0.11 ) );
  diffuseColor.rgb *= laid * texture2D( tWashes, at ).rgb * ${BRIGHT.toFixed(1)} * slow * drift;
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
