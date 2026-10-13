import * as THREE from 'three';
import { assets } from '../core/assets';
import { TOUCH } from '../core/device';
import { physics } from '../core/physics';
import { Simplex } from '../core/noise';
import type { Atmosphere } from './atmosphere';
import { CELL, SNOW, WORLD_RES, WORLD_SIZE, idx, type World } from './worldgen';

// layer order matches the splat channels: grass, forest floor, rock, gravel
const LAYERS = ['leafy_grass', 'brown_mud_leaves_01', 'aerial_rocks_02', 'rocks_ground_02'];
/** metres per texture repeat for each layer, in the paint as it was */
const TILE = [3.2, 3.0, 6.0, 2.6];
/**
 * Metres per repeat in the paint as it is now: the size each picture is in life (the grass, the forest's mud and the
 * gravel were laid a third to more than twice too large, which is half of why a stone in them was so easy to find
 * again). The rock is an air photograph of fifty metres and stays as it was laid until the steep ground has its own.
 */
const SIZE = [2.0, 1.3, 6.0, 2.0];
const ARRAY_RES = 1024;
/**
 * The paint as it was before 2026-10-13 ("its very noticable its tiled an dugly and we need natural ground"): on a
 * development build with `?ground=old`, to photograph and to time the new against from the same eye. A phone is
 * given the old paint until the new has a lighter path of its own for it.
 */
const OLD_PAINT = TOUCH || (!!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('ground') === 'old');

function arrayOf(data: Uint8Array, layers: number, srgb: boolean): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, ARRAY_RES, ARRAY_RES, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = assets.maxAnisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  // (the copy this side of the card is let go once the card has it: a smaller heap is a cheaper one to tidy)
  tex.onUpdate = () => {
    (tex.image as { data: Uint8Array | null }).data = null;
  };
  return tex;
}

/**
 * The ground's pictures as the new paint holds them: two arrays where there were three, so that a look at a layer is
 * two fetches and not three (which is what pays for looking at each layer twice: see groundTap).
 *   colour  its colour, and in the fourth place how proud of the ground each point stands (the shade map: bright on
 *           what is open to the sky, dark in the cracks), which is what layers and copies are joined by
 *   relief  the two slopes of its normal, and its roughness
 * And of each layer what a tap is told so as not to be made: its mean colour (as light, not as the file's numbers),
 * its mean roughness and its mean height. Far off a picture is its mean; and two copies half and half are flatter
 * than either, which is put right about the mean.
 */
async function buildGround(sets: { diff: string; nor: string; arm: string }[]) {
  const S = ARRAY_RES, px = S * S, n = sets.length;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const asLight = new Float32Array(256);
  for (let v = 0; v < 256; v++) asLight[v] = v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4);
  const colour = new Uint8Array(px * 4 * n), relief = new Uint8Array(px * 4 * n);
  const mean: THREE.Vector3[] = [], flat: THREE.Vector2[] = [];
  // (the files are asked for together and unpacked one layer at a time: one canvas is all that is held)
  const files = sets.map((s) => [assets.image(s.diff), assets.image(s.nor), assets.image(s.arm)]);
  for (const f of files) for (const p of f) p.catch(() => undefined);
  for (let l = 0; l < n; l++) {
    const o = l * px * 4;
    const draw = async (which: number) => {
      const img = await files[l][which];
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(img, 0, 0, S, S);
      img.close();
      return ctx.getImageData(0, 0, S, S).data;
    };
    const diff = await draw(0);
    colour.set(diff, o);
    const nor = await draw(1);
    const arm = await draw(2);
    let r = 0, g = 0, b = 0, rough = 0, high = 0;
    for (let i = 0; i < px * 4; i += 4) {
      colour[o + i + 3] = arm[i];
      relief[o + i] = nor[i];
      relief[o + i + 1] = nor[i + 1];
      relief[o + i + 2] = arm[i + 1];
      relief[o + i + 3] = 255;
      r += asLight[diff[i]];
      g += asLight[diff[i + 1]];
      b += asLight[diff[i + 2]];
      rough += arm[i + 1];
      high += arm[i];
    }
    mean.push(new THREE.Vector3(r / px, g / px, b / px));
    flat.push(new THREE.Vector2(rough / px / 255, high / px / 255));
  }
  return { colour: arrayOf(colour, n, true), relief: arrayOf(relief, n, false), mean, flat };
}

/**
 * Which of a picture's shifted copies a place is given (see groundTap): a slow, smooth noise, so that the patches it
 * marks out are about a picture wide and not a speckle. It repeats, and is laid many pictures wide.
 */
function patchNoiseTexture(): THREE.DataTexture {
  const S = 128;
  const n = new Simplex(9117);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
      const u = Math.cos(a) * 1.7 + Math.cos(b) * 1.2, v = Math.sin(a) * 1.7 + Math.sin(b) * 1.2;
      const k = (n.noise(u, v) + 0.35 * n.noise(u * 2.1 + 5.3, v * 2.1 - 3.1)) / 1.35;
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(Math.min(1, Math.max(0, k * 0.5 + 0.5)) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

async function buildArray(urls: string[], srgb: boolean): Promise<THREE.DataArrayTexture> {
  const imgs = await Promise.all(urls.map((u) => assets.image(u)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ARRAY_RES;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(ARRAY_RES * ARRAY_RES * 4 * imgs.length);
  imgs.forEach((img, i) => {
    ctx.clearRect(0, 0, ARRAY_RES, ARRAY_RES);
    ctx.drawImage(img, 0, 0, ARRAY_RES, ARRAY_RES);
    data.set(ctx.getImageData(0, 0, ARRAY_RES, ARRAY_RES).data, i * ARRAY_RES * ARRAY_RES * 4);
    img.close();
  });
  const tex = new THREE.DataArrayTexture(data, ARRAY_RES, ARRAY_RES, imgs.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = assets.maxAnisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  // 16 MB per array: drop the CPU copy once it is on the GPU (smaller heap = cheaper GC)
  tex.onUpdate = () => {
    (tex.image as { data: Uint8Array | null }).data = null;
  };
  return tex;
}

function macroNoiseTexture(): THREE.DataTexture {
  const S = 256;
  const n = new Simplex(4242);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // tileable via 4D-ish torus mapping in 2D simplex
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      const nx = Math.cos(a) * 2, ny = Math.sin(a) * 2, nz = Math.cos(b) * 2, nw = Math.sin(b) * 2;
      const v1 = n.fbm(nx + nz * 0.7, ny + nw * 0.7, 4);
      const v2 = n.fbm(nx * 3 + 11 + nw, ny * 3 - 7 + nz, 4);
      const v3 = n.fbm(nz * 5 - 3 + nx, nw * 5 + 9 + ny, 3);
      const i = (y * S + x) * 4;
      data[i] = Math.round((v1 * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((v2 * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((v3 * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** quads along one side of a ground tile */
const TILE_QUADS = 64;

export class Terrain {
  /** the ground, as a group of tiles */
  mesh!: THREE.Group;
  heightTex!: THREE.DataTexture;
  /** the ground's own paint, for a lid laid over a hole in the ground (see where it is made) */
  lid: THREE.MeshStandardMaterial | null = null;
  splatTex!: THREE.DataTexture;
  grassTex!: THREE.DataTexture;
  macroTex!: THREE.DataTexture;

  constructor(private world: World, private atmo: Atmosphere) {}

  async build(scene: THREE.Scene) {
    const N = WORLD_RES;
    const half = WORLD_SIZE / 2;
    const { heights, splat, grass } = this.world;

    // --- geometry (diagonal matches parry's heightfield triangulation)
    const pos = new Float32Array(N * N * 3);
    const nrm = new Float32Array(N * N * 3);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = idx(ix, iz);
        pos[i * 3] = -half + ix * CELL;
        pos[i * 3 + 1] = heights[i];
        pos[i * 3 + 2] = -half + iz * CELL;
        const hl = heights[idx(Math.max(ix - 1, 0), iz)];
        const hr = heights[idx(Math.min(ix + 1, N - 1), iz)];
        const hd = heights[idx(ix, Math.max(iz - 1, 0))];
        const hu = heights[idx(ix, Math.min(iz + 1, N - 1))];
        const nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        nrm[i * 3] = nx / l;
        nrm[i * 3 + 1] = ny / l;
        nrm[i * 3 + 2] = nz / l;
      }
    }
    // The ground is cut into tiles that share one set of vertices. Each tile is culled on
    // its own, by the camera and by every shadow cascade. As a single piece all 524 000
    // triangles were drawn four times a frame, whichever way you looked.
    const posAttr = new THREE.BufferAttribute(pos, 3);
    const nrmAttr = new THREE.BufferAttribute(nrm, 3);
    const tiles: THREE.BufferGeometry[] = [];
    for (let tz = 0; tz < N - 1; tz += TILE_QUADS) {
      for (let tx = 0; tx < N - 1; tx += TILE_QUADS) {
        const x1 = Math.min(tx + TILE_QUADS, N - 1), z1 = Math.min(tz + TILE_QUADS, N - 1);
        const index = new Uint32Array((x1 - tx) * (z1 - tz) * 6);
        let k = 0;
        let lo = Infinity, hi = -Infinity;
        for (let iz = tz; iz < z1; iz++) {
          for (let ix = tx; ix < x1; ix++) {
            const a = idx(ix, iz), b = idx(ix + 1, iz), c = idx(ix, iz + 1), d = idx(ix + 1, iz + 1);
            // triangles (a, c, b) and (b, c, d): diagonal b-c, counter-clockwise from above
            index[k++] = a; index[k++] = c; index[k++] = b;
            index[k++] = b; index[k++] = c; index[k++] = d;
            lo = Math.min(lo, heights[a], heights[b], heights[c], heights[d]);
            hi = Math.max(hi, heights[a], heights[b], heights[c], heights[d]);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', posAttr);
        geo.setAttribute('normal', nrmAttr);
        geo.setIndex(new THREE.BufferAttribute(index, 1));
        geo.boundingBox = new THREE.Box3(
          new THREE.Vector3(-half + tx * CELL, lo, -half + tz * CELL),
          new THREE.Vector3(-half + x1 * CELL, hi, -half + z1 * CELL),
        );
        geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
        tiles.push(geo);
      }
    }

    // --- data textures shared with grass / vegetation shaders
    const hf = new Float32Array(N * N);
    hf.set(this.world.surface);
    this.heightTex = new THREE.DataTexture(hf, N, N, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;
    this.splatTex = new THREE.DataTexture(splat, N, N, THREE.RGBAFormat);
    this.splatTex.magFilter = this.splatTex.minFilter = THREE.LinearFilter;
    this.splatTex.needsUpdate = true;
    this.grassTex = new THREE.DataTexture(grass, N, N, THREE.RedFormat);
    this.grassTex.magFilter = this.grassTex.minFilter = THREE.LinearFilter;
    this.grassTex.needsUpdate = true;
    this.macroTex = macroNoiseTexture();

    const t = assets.manifest.textures;
    const tint = [new THREE.Vector3(0.78, 0.96, 0.62), new THREE.Vector3(0.9, 0.92, 0.85), new THREE.Vector3(0.95, 0.97, 0.93), new THREE.Vector3(0.86, 0.84, 0.8)];
    let uniforms: Record<string, THREE.IUniform>;
    if (OLD_PAINT) {
      const [albedo, normals, arm] = await Promise.all([
        buildArray(LAYERS.map((l) => t[l].diff), true),
        buildArray(LAYERS.map((l) => t[l].nor), false),
        buildArray(LAYERS.map((l) => t[l].arm), false),
      ]);
      uniforms = {
        tAlbedo: { value: albedo },
        tNormal: { value: normals },
        tArm: { value: arm },
        tSplat: { value: this.splatTex },
        tMacro: { value: this.macroTex },
        uTile: { value: new THREE.Vector4(...TILE.map((v) => 1 / v)) },
        uWorld: { value: new THREE.Vector2(WORLD_SIZE, WORLD_RES) },
        uTint: { value: tint },
      };
    } else {
      const made = await buildGround(LAYERS.map((l) => t[l]));
      uniforms = {
        tColour: { value: made.colour },
        tRelief: { value: made.relief },
        tPatch: { value: patchNoiseTexture() },
        tSplat: { value: this.splatTex },
        tMacro: { value: this.macroTex },
        uTile: { value: SIZE.map((v) => 1 / v) },
        uWorld: { value: new THREE.Vector2(WORLD_SIZE, WORLD_RES) },
        uTint: { value: tint },
        uMean: { value: made.mean },
        uFlat: { value: made.flat },
      };
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const paint = (shader: Parameters<Parameters<Atmosphere['register']>[1] & {}>[0]) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvTerrainNormal = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${OLD_PAINT ? TERRAIN_PARS : GROUND_PARS}`)
        .replace('#include <map_fragment>', OLD_PAINT ? TERRAIN_SAMPLE : GROUND_SAMPLE)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL)
        .replace('#include <aomap_fragment>', TERRAIN_AO);
    };
    this.atmo.register(mat, paint, 'terrain');
    // The same paint for something laid level with the ground over a hole in it (the bunker's roof): drawn a hair
    // nearer the eye than it is, so that where the ground itself lies a finger under it the two do not flicker.
    this.lid = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    this.atmo.register(this.lid, paint, 'terrain-lid');

    this.mesh = new THREE.Group();
    this.mesh.name = 'terrain';
    for (const geo of tiles) {
      const tile = new THREE.Mesh(geo, mat);
      tile.receiveShadow = true;
      tile.castShadow = true;
      tile.name = 'terrain';
      tile.matrixAutoUpdate = false;
      // drawn after everything else that is opaque: in a forest most of the ground is hidden behind
      // trunks, leaves and grass, and those pixels then skip the terrain's heavy shader entirely
      tile.renderOrder = 5;
      this.mesh.add(tile);
    }
    scene.add(this.mesh);

    // --- physics heightfield (column-major, rows along Z)
    const R = physics.R;
    const hcm = new Float32Array(N * N);
    for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) hcm[iz + ix * N] = heights[idx(ix, iz)];
    const desc = R.ColliderDesc.heightfield(N - 1, N - 1, hcm, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE });
    physics.addStatic(desc, 'grass', { x: 0, y: 0, z: 0 });
  }

  /** dominant surface for footsteps / bullet impacts */
  surfaceAt(x: number, z: number): 'grass' | 'dirt' | 'rock' | 'gravel' {
    const half = WORLD_SIZE / 2;
    const ix = Math.round((x + half) / CELL);
    const iz = Math.round((z + half) / CELL);
    if (ix < 0 || iz < 0 || ix >= WORLD_RES || iz >= WORLD_RES) return 'grass';
    const i = idx(ix, iz) * 4;
    const s = this.world.splat;
    let best = 0;
    for (let c = 1; c < 4; c++) if (s[i + c] > s[i + best]) best = c;
    return (['grass', 'dirt', 'rock', 'gravel'] as const)[best];
  }
}

const TERRAIN_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform sampler2DArray tNormal;
uniform sampler2DArray tArm;
uniform sampler2D tSplat;
uniform sampler2D tMacro;
uniform vec4 uTile;
uniform vec2 uWorld;
uniform vec3 uTint[4];
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
#define SNOW_FROM ${SNOW.from.toFixed(1)}
#define SNOW_FULL ${SNOW.full.toFixed(1)}
// (the upward part of the ground's normal on the steepest slope snow lies on)
#define SNOW_STEEP ${(1 / Math.hypot(1, SNOW.slope)).toFixed(3)}

// rotate uv by a per-cell random angle; two overlapping cells are blended to kill tiling
vec2 tRot(vec2 uv, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * uv; }
`;

// Height-blended splat with dual-scale sampling to hide repetition.
const TERRAIN_SAMPLE = /* glsl */ `
vec2 splatUv = (vTerrainPos.xz + uWorld.x * 0.5) / uWorld.x;
splatUv = splatUv * (uWorld.y - 1.0) / uWorld.y + 0.5 / uWorld.y;
vec4 macro = texture2D(tMacro, vTerrainPos.xz / 190.0);
vec4 macro2 = texture2D(tMacro, vTerrainPos.xz / 37.0);
// jitter the splat lookup so layer boundaries are organic instead of grid-aligned
vec2 jitter = (macro2.rg - 0.5) * (2.6 / uWorld.x);
vec4 w = texture2D(tSplat, splatUv + jitter);

float camDist = length(vTerrainPos - cameraPosition);
vec2 dPx = dFdx(vTerrainPos.xz);
vec2 dPy = dFdy(vTerrainPos.xz);
float farBlend = smoothstep(18.0, 70.0, camDist);

vec4 tAlb = vec4(0.0);
vec3 tNrm = vec3(0.0);
vec3 tArmV = vec3(0.0);
float layerW[4];
layerW[0] = w.r; layerW[1] = w.g; layerW[2] = w.b; layerW[3] = w.a;

// height-based blending: AO channel acts as a height proxy
float hts[4];
vec4 albs[4]; vec3 nrms[4]; vec3 arms[4];
float maxH = 0.0;
for (int i = 0; i < 4; i++) {
  hts[i] = -1.0;
  if (layerW[i] < 0.004) continue;
  float tile = uTile[i];
  vec2 uv = vTerrainPos.xz * tile;
  vec2 uvFar = tRot(vTerrainPos.xz * tile * 0.27, 0.9);
  vec2 gx = dPx * tile, gy = dPy * tile;
  vec4 a = textureGrad(tAlbedo, vec3(uv, float(i)), gx, gy);
  vec3 n = textureGrad(tNormal, vec3(uv, float(i)), gx, gy).xyz;
  vec3 r = textureGrad(tArm, vec3(uv, float(i)), gx, gy).xyz;
  if (farBlend > 0.0) {
    vec2 gxF = tRot(gx * 0.27, 0.9), gyF = tRot(gy * 0.27, 0.9);
    vec4 aF = textureGrad(tAlbedo, vec3(uvFar, float(i)), gxF, gyF);
    vec3 rF = textureGrad(tArm, vec3(uvFar, float(i)), gxF, gyF).xyz;
    a = mix(a, mix(a, aF, 0.55), farBlend);
    r = mix(r, mix(r, rF, 0.55), farBlend);
  }
  a.rgb *= uTint[i];
  albs[i] = a; nrms[i] = n; arms[i] = r;
  hts[i] = layerW[i] + r.r * 0.55;
  maxH = max(maxH, hts[i]);
}
float wsum = 0.0;
float bw[4];
for (int i = 0; i < 4; i++) {
  bw[i] = hts[i] < 0.0 ? 0.0 : max(hts[i] - (maxH - 0.22), 0.0);
  wsum += bw[i];
}
for (int i = 0; i < 4; i++) {
  if (bw[i] <= 0.0) continue;
  float k = bw[i] / wsum;
  tAlb += albs[i] * k;
  tNrm += (nrms[i] * 2.0 - 1.0) * k;
  tArmV += arms[i] * k;
}
// large-scale colour variation (patchy dry grass, damp soil)
vec3 dry = vec3(1.06, 1.02, 0.86);
vec3 lush = vec3(0.84, 1.0, 0.86);
tAlb.rgb *= mix(lush, dry, smoothstep(0.25, 0.85, macro.r)) * (0.88 + 0.24 * macro.g);
tAlb.rgb *= mix(1.0, 0.92 + 0.16 * macro2.b, 0.7);
// photoscans bake in near-white pebbles; real ground albedo tops out ~0.45. Soft-knee
// compression stops sunlit pebbles blooming into sparkles that flicker with motion.
{
  float lumA = dot(tAlb.rgb, vec3(0.299, 0.587, 0.114));
  float knee = 0.34;
  float target = lumA < knee ? lumA : knee + (lumA - knee) * 0.22;
  tAlb.rgb *= target / max(lumA, 1e-4);
}
diffuseColor.rgb *= tAlb.rgb;
float tRough = clamp(tArmV.g * 1.05, 0.35, 1.0);
float tAO = tArmV.r;
// Snow, where the ground is high enough for it to lie and level enough to hold it (SNOW in the world's generator;
// 2026-10-13: "i want high elevation mountains to be snowcapped, and the surrounding area snowcapped"). Laid over
// whatever the ground is, after its own colour has been reckoned and held down: held down with it, snow is grey.
// Its line is ragged by the same slow pattern the grass is patched by, the stones still show through it a little
// where it begins, and its own small relief is flattened as it thickens: a drift has none.
{
  float up = normalize(vTerrainNormal).y;
  float ragged = (macro.r - 0.5) * 16.0 + (macro2.b - 0.5) * 5.0;
  float lies = smoothstep(SNOW_FROM, SNOW_FULL, vTerrainPos.y + ragged) * smoothstep(SNOW_STEEP - 0.07, SNOW_STEEP + 0.05, up);
  float thin = lies * (0.82 + 0.18 * smoothstep(0.0, 0.5, lies) * (1.0 - 0.5 * tArmV.r * (1.0 - lies)));
  vec3 snow = vec3(0.80, 0.83, 0.88) * (0.94 + 0.08 * macro2.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, snow, thin);
  tNrm = mix(tNrm, vec3(0.0, 0.0, 1.0), thin * 0.8);
  tRough = mix(tRough, 0.62, thin);
  tAO = mix(tAO, 1.0, thin * 0.6);
}
`;

// ------------------------------------------------------------------ the paint as it is now
//
// What made the ground look laid in tiles (2026-10-13: "it doesnt look like shit is copy and pasted like our dirt
// texture is. its very noticable its tiled an dugly and we need natural ground"): up close each layer was one
// picture laid over and over on a square net, so that a white stone in the gravel came round again every 2.6 m in
// every direction, in rows to the horizon. Now no layer is laid on a net at all: see groundTap.

const GROUND_PARS = /* glsl */ `
precision highp sampler2DArray;
#define GROUND_LAYERS ${LAYERS.length}
uniform sampler2DArray tColour;
uniform sampler2DArray tRelief;
uniform sampler2D tPatch;
uniform sampler2D tSplat;
uniform sampler2D tMacro;
uniform float uTile[GROUND_LAYERS];
uniform vec2 uWorld;
uniform vec3 uTint[GROUND_LAYERS];
uniform vec3 uMean[GROUND_LAYERS];
uniform vec2 uFlat[GROUND_LAYERS];
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
#define SNOW_FROM ${SNOW.from.toFixed(1)}
#define SNOW_FULL ${SNOW.full.toFixed(1)}
// (the upward part of the ground's normal on the steepest slope snow lies on)
#define SNOW_STEEP ${(1 / Math.hypot(1, SNOW.slope)).toFixed(3)}
// (the noise that deals out a picture's copies is laid this many of the picture wide: its patches are then about one wide)
#define GROUND_PATCH ${(1 / 60).toFixed(5)}

vec2 tRot(vec2 uv, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * uv; }

// One look at one layer, with its repeat broken. The picture is thought of as laid eight times over, each time
// shifted by an amount of its own. A slow noise says which two of the eight a place lies between, and so the ground
// is cut into patches about a picture wide, no two neighbours shifted alike: nowhere is the picture laid twice running,
// and there is no net for the eye to find. Where two patches meet they are not faded into one another (half of each
// is mud): the seam follows the picture's own bumps, whichever stands prouder there showing, as a stone lies on
// earth; and what fading there is has its contrast put back about the layer's mean colour.
// Away from a seam only one copy is read, so that a look is three fetches on the whole and not four.
// uv: where in the picture; gx, gy: how fast that changes across the screen; form: its relief is wanted too.
void groundTap(int i, vec2 uv, vec2 gx, vec2 gy, bool form, out vec4 colour, out vec3 relief) {
  float layer = float(i);
  float l = textureGrad(tPatch, uv * GROUND_PATCH + layer * 0.173, gx * GROUND_PATCH, gy * GROUND_PATCH).r * 8.0;
  float n = floor(l), f = l - n;
  vec2 oa = sin(vec2(3.0, 7.0) * n + layer * 1.7);
  vec2 ob = sin(vec2(3.0, 7.0) * (n + 1.0) + layer * 1.7);
  // (how far across the seam this is by the noise alone, -1 to 1: the seam is the middle half of the way from one patch to the next)
  float e = (f - 0.5) * 4.0;
  float t = step(0.0, e);
  if (abs(e) < 1.0) {
    vec4 a = textureGrad(tColour, vec3(uv + oa, layer), gx, gy);
    vec4 b = textureGrad(tColour, vec3(uv + ob, layer), gx, gy);
    t = smoothstep(0.3, 0.7, 0.5 + 0.5 * e + (b.a - a.a) * (1.0 - e * e));
    colour = mix(a, b, t);
    colour.rgb = max(uMean[i] + (colour.rgb - uMean[i]) * inversesqrt(t * t + (1.0 - t) * (1.0 - t)), 0.0);
  } else {
    colour = textureGrad(tColour, vec3(uv + mix(oa, ob, t), layer), gx, gy);
  }
  relief = vec3(0.5, 0.5, uFlat[i].x);
  if (form) {
    if (t < 0.999) relief = textureGrad(tRelief, vec3(uv + oa, layer), gx, gy).xyz;
    if (t > 0.001) {
      vec3 rb = textureGrad(tRelief, vec3(uv + ob, layer), gx, gy).xyz;
      relief = t < 0.999 ? mix(relief, rb, t) : rb;
    }
  }
}
`;

const GROUND_SAMPLE = /* glsl */ `
vec2 splatUv = (vTerrainPos.xz + uWorld.x * 0.5) / uWorld.x;
splatUv = splatUv * (uWorld.y - 1.0) / uWorld.y + 0.5 / uWorld.y;
vec4 macro = texture2D(tMacro, vTerrainPos.xz / 190.0);
vec4 macro2 = texture2D(tMacro, vTerrainPos.xz / 37.0);
vec4 macro3 = texture2D(tMacro, vTerrainPos.zx / 410.0 + 0.31);
// jitter the splat lookup so layer boundaries are organic instead of grid-aligned
vec2 jitter = (macro2.rg - 0.5) * (2.6 / uWorld.x);
vec4 w = texture2D(tSplat, splatUv + jitter);

float camDist = length(vTerrainPos - cameraPosition);
vec2 dPx = dFdx(vTerrainPos.xz);
vec2 dPy = dFdy(vTerrainPos.xz);
// Each layer is looked at twice: at its own size, and (from 18 m, growing to 70 m) laid nearly four times as large
// and turned, which is what gives the ground a grain from far off, where at its own size a picture has shrunk to
// its mean colour. Beyond 170 m it is given as that mean and not looked at: the fetches go where they show.
float farBlend = smoothstep(18.0, 70.0, camDist);
float nearKeep = 1.0 - smoothstep(100.0, 170.0, camDist);

float layerW[GROUND_LAYERS];
layerW[0] = w.r; layerW[1] = w.g; layerW[2] = w.b; layerW[3] = w.a;

// height-based blending between the layers: the shade map stands for height
float hts[GROUND_LAYERS];
vec4 cols[GROUND_LAYERS]; vec3 rels[GROUND_LAYERS];
float maxH = 0.0;
for (int i = 0; i < GROUND_LAYERS; i++) {
  hts[i] = -1.0;
  if (layerW[i] < 0.004) continue;
  float tile = uTile[i];
  vec4 c = vec4(uMean[i], uFlat[i].y);
  vec3 r = vec3(0.5, 0.5, uFlat[i].x);
  if (nearKeep > 0.0) {
    vec4 nc; vec3 nr;
    groundTap(i, vTerrainPos.xz * tile, dPx * tile, dPy * tile, true, nc, nr);
    c = mix(c, nc, nearKeep);
    r = mix(r, nr, nearKeep);
  }
  if (farBlend > 0.0) {
    float wide = tile * 0.27;
    vec4 fc; vec3 fr;
    groundTap(i, tRot(vTerrainPos.xz * wide, 0.9), tRot(dPx * wide, 0.9), tRot(dPy * wide, 0.9), false, fc, fr);
    c = mix(c, mix(c, fc, 0.55), farBlend);
  }
  c.rgb *= uTint[i];
  cols[i] = c; rels[i] = r;
  hts[i] = layerW[i] + c.a * 0.55;
  maxH = max(maxH, hts[i]);
}
float wsum = 0.0;
float bw[GROUND_LAYERS];
for (int i = 0; i < GROUND_LAYERS; i++) {
  bw[i] = hts[i] < 0.0 ? 0.0 : max(hts[i] - (maxH - 0.22), 0.0);
  wsum += bw[i];
}
vec4 tAlb = vec4(0.0);
vec3 tRel = vec3(0.0);
for (int i = 0; i < GROUND_LAYERS; i++) {
  if (bw[i] <= 0.0) continue;
  float k = bw[i] / wsum;
  tAlb += cols[i] * k;
  tRel += rels[i] * k;
}
vec3 tNrm = vec3(tRel.xy * 2.0 - 1.0, 0.0);
tNrm.z = sqrt(max(1.0 - dot(tNrm.xy, tNrm.xy), 0.04));
// large-scale colour variation (patchy dry grass, damp soil)
vec3 dry = vec3(1.06, 1.02, 0.86);
vec3 lush = vec3(0.84, 1.0, 0.86);
tAlb.rgb *= mix(lush, dry, smoothstep(0.25, 0.85, macro.r)) * (0.88 + 0.24 * macro.g);
tAlb.rgb *= mix(1.0, 0.92 + 0.16 * macro2.b, 0.7);
// and slower and of another kind, so that no two stretches of one ground match: warmer and cooler over tens of
// metres, and damp places a dozen metres across that are darker and less dull than the dry ground about them
tAlb.rgb *= mix(vec3(0.95, 0.98, 1.04), vec3(1.05, 1.01, 0.94), macro3.r);
float damp = smoothstep(0.5, 0.76, macro3.g * 0.65 + macro.b * 0.35);
tAlb.rgb *= 1.0 - 0.2 * damp;
// photoscans bake in near-white pebbles; real ground albedo tops out ~0.45. Soft-knee
// compression stops sunlit pebbles blooming into sparkles that flicker with motion.
{
  float lumA = dot(tAlb.rgb, vec3(0.299, 0.587, 0.114));
  float knee = 0.34;
  float target = lumA < knee ? lumA : knee + (lumA - knee) * 0.22;
  tAlb.rgb *= target / max(lumA, 1e-4);
}
diffuseColor.rgb *= tAlb.rgb;
float tRough = clamp(tRel.z * 1.05, 0.35, 1.0) * (1.0 - 0.18 * damp);
float tAO = tAlb.a;
// Snow, where the ground is high enough for it to lie and level enough to hold it (SNOW in the world's generator;
// 2026-10-13: "i want high elevation mountains to be snowcapped, and the surrounding area snowcapped"). Laid over
// whatever the ground is, after its own colour has been reckoned and held down: held down with it, snow is grey.
// Its line is ragged by the same slow pattern the grass is patched by, the stones still show through it a little
// where it begins, and its own small relief is flattened as it thickens: a drift has none.
{
  float up = normalize(vTerrainNormal).y;
  float ragged = (macro.r - 0.5) * 16.0 + (macro2.b - 0.5) * 5.0;
  float lies = smoothstep(SNOW_FROM, SNOW_FULL, vTerrainPos.y + ragged) * smoothstep(SNOW_STEEP - 0.07, SNOW_STEEP + 0.05, up);
  float thin = lies * (0.82 + 0.18 * smoothstep(0.0, 0.5, lies) * (1.0 - 0.5 * tAO * (1.0 - lies)));
  vec3 snow = vec3(0.80, 0.83, 0.88) * (0.94 + 0.08 * macro2.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, snow, thin);
  tNrm = mix(tNrm, vec3(0.0, 0.0, 1.0), thin * 0.8);
  tRough = mix(tRough, 0.62, thin);
  tAO = mix(tAO, 1.0, thin * 0.6);
}
`;

// planar mapping: tangent = +X, bitangent = image-up = -Z (see notes in terrain.ts)
const TERRAIN_NORMAL = /* glsl */ `
{
  vec3 Nw = normalize(vTerrainNormal);
  vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
  vec3 Bw = cross(Nw, Tw);
  vec3 tn = normalize(vec3(tNrm.xy * mix(1.0, 0.6, farBlend), max(tNrm.z, 0.2)));
  vec3 nW = normalize(Tw * tn.x + Bw * tn.y + Nw * tn.z);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

const TERRAIN_AO = /* glsl */ `
{
  // natural ground is a poor specular reflector; keep only a hint of sheen
  reflectedLight.directSpecular *= 0.25;
  float ambientOcclusion = mix(1.0, tAO, 0.85);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}
`;
