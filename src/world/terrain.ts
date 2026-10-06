import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { Simplex } from '../core/noise';
import type { Atmosphere } from './atmosphere';
import { CELL, WORLD_RES, WORLD_SIZE, idx, type World } from './worldgen';

// layer order matches the splat channels: grass, forest floor, rock, gravel
const LAYERS = ['leafy_grass', 'brown_mud_leaves_01', 'aerial_rocks_02', 'rocks_ground_02'];
/** metres per texture repeat for each layer */
const TILE = [3.2, 3.0, 6.0, 2.6];
const ARRAY_RES = 1024;

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
    hf.set(heights);
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
    const [albedo, normals, arm] = await Promise.all([
      buildArray(LAYERS.map((l) => t[l].diff), true),
      buildArray(LAYERS.map((l) => t[l].nor), false),
      buildArray(LAYERS.map((l) => t[l].arm), false),
    ]);

    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const uniforms = {
      tAlbedo: { value: albedo },
      tNormal: { value: normals },
      tArm: { value: arm },
      tSplat: { value: this.splatTex },
      tMacro: { value: this.macroTex },
      uTile: { value: new THREE.Vector4(...TILE.map((v) => 1 / v)) },
      uWorld: { value: new THREE.Vector2(WORLD_SIZE, WORLD_RES) },
      uTint: { value: [new THREE.Vector3(0.78, 0.96, 0.62), new THREE.Vector3(0.9, 0.92, 0.85), new THREE.Vector3(0.95, 0.97, 0.93), new THREE.Vector3(0.86, 0.84, 0.8)] },
    };
    this.atmo.register(mat, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvTerrainNormal = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_PARS}`)
        .replace('#include <map_fragment>', TERRAIN_SAMPLE)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL)
        .replace('#include <aomap_fragment>', TERRAIN_AO);
    }, 'terrain');

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
