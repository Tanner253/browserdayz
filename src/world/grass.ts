// GPU grass. The field is tiled into 4 m patches; every patch shares one geometry of
// ~1000 randomly ordered blades. Blades are placed on the exact terrain triangles in
// the vertex shader (height texture), culled by the grass density map, bent by
// travelling wind gusts and pushed aside by the player. Distant patches draw only the
// first N blades (drawRange) with wider blades, so density falls off smoothly; past the
// nearest band each blade is one triangle. (2026-10-21, the owner, from a side-by-side,
// "is there a better fps solution for grass?": that, the grass to 50 m and not 72, and five
// blades in ten on high (Game.applyGraphics): 0.9 ms of its 2.0 in an open field at 2560x1440.)

import * as THREE from 'three';
import { RNG } from '../core/noise';
import type { Atmosphere } from './atmosphere';
import { wind } from './foliage';
import { worldUniforms, type Terrain } from './terrain';
import { CELL, WORLD_NX, WORLD_NZ, WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1 } from './worldgen';

const PATCH = 4;
const BLADES = 2400;
const SEGMENTS_NEAR = 4;

interface GrassLevel {
  mesh: THREE.InstancedMesh;
  maxDist: number;
  count: number;
  /** share of the patch's blades drawn at this distance */
  frac: number;
  /** index entries a blade of this band has */
  per: number;
}

export const grassUniforms = {
  uPlayer: { value: new THREE.Vector3(0, -1000, 0) },
};

/** index entries a blade of so many segments has */
const perBlade = (segments: number) => (segments * 2 - 1) * 3;

/** @param segments the same blades (the same random draws in the same order) with this many segments each */
function bladeGeometry(segments = SEGMENTS_NEAR): THREE.BufferGeometry {
  const rng = new RNG(777);
  const vertsPer = (segments + 1) * 2 - 1; // tip is a single vertex
  const pos = new Float32Array(BLADES * vertsPer * 3);
  const blade = new Float32Array(BLADES * vertsPer * 4);
  const index: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const bx = rng.next() * PATCH;
    const bz = rng.next() * PATCH;
    const rnd = rng.next();
    const ang = rng.next() * Math.PI * 2;
    const base = b * vertsPer;
    let v = 0;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const sides = s === segments ? [0] : [-0.5, 0.5];
      for (const side of sides) {
        const o = (base + v) * 3;
        pos[o] = side; // width coordinate
        pos[o + 1] = t; // height fraction
        pos[o + 2] = 0;
        const q = (base + v) * 4;
        blade[q] = bx;
        blade[q + 1] = bz;
        blade[q + 2] = rnd;
        blade[q + 3] = ang;
        v++;
      }
    }
    for (let s = 0; s < segments; s++) {
      const a = base + s * 2;
      if (s === segments - 1) {
        index.push(a, a + 1, a + 2);
      } else {
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.BufferAttribute(blade, 4));
  // real normals are computed in the shader; the attribute keeps three from compiling a flat-shaded variant
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(PATCH / 2, 0.5, PATCH / 2), PATCH);
  return g;
}

export class Grass {
  private levels: GrassLevel[] = [];
  private frustum = new THREE.Frustum();
  private sig = 0;
  private pv = new THREE.Matrix4();
  private box = new THREE.Box3();
  readonly radius = 50;
  private heights: Float32Array;

  constructor(private terrain: Terrain, private atmo: Atmosphere, heights: Float32Array) {
    this.heights = heights;
  }

  build(scene: THREE.Scene) {
    const base = bladeGeometry(), one = bladeGeometry(1);
    const lv: [number, number, number][] = [
      // max distance, blade fraction, width scale
      [22, 1.0, 1.0],
      [42, 0.32, 1.75],
      [this.radius, 0.09, 3.2],
    ];
    const maxPatches = Math.ceil(((this.radius * 2) / PATCH + 2) ** 2);
    for (const [maxDist, frac, widthScale] of lv) {
      // (past the nearest band, the same blades one triangle each: three points and not nine, every one of which
      // reads the ground, the grass map and the tint over again)
      const near = !this.levels.length, from = near ? base : one;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', from.getAttribute('position'));
      geo.setAttribute('aBlade', from.getAttribute('aBlade'));
      geo.setAttribute('normal', from.getAttribute('normal'));
      geo.setIndex(from.getIndex());
      geo.boundingSphere = base.boundingSphere;
      const mat = this.material(widthScale);
      const mesh = new THREE.InstancedMesh(geo, mat, maxPatches);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `grass:${this.levels.length}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.levels.push({ mesh, maxDist, count: 0, frac, per: perBlade(near ? SEGMENTS_NEAR : 1) });
    }
    this.setDensity(1);
  }

  /** Graphics option: how thick the grass is (1 = as built). */
  setDensity(k: number) {
    for (const l of this.levels) l.mesh.geometry.setDrawRange(0, Math.floor(BLADES * l.frac * k) * l.per);
  }

  private material(widthScale: number) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.7 });
    const t = this.terrain;
    const uniforms = {
      tHeight: { value: t.heightTex },
      tGrass: { value: t.grassTex },
      tMacro: { value: t.macroTex },
      ...worldUniforms(),
      uWidthScale: { value: widthScale },
      uRadius: { value: this.radius },
    };
    this.atmo.register(
      mat,
      (shader) => {
        Object.assign(shader.uniforms, uniforms, wind, grassUniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${GRASS_VERT_PARS}`)
          .replace('#include <beginnormal_vertex>', GRASS_NORMAL)
          .replace('#include <begin_vertex>', GRASS_BEGIN)
          .replace('#include <project_vertex>', GRASS_PROJECT)
          .replace('#include <worldpos_vertex>', GRASS_WORLDPOS)
          .replace('#include <fog_vertex>', GRASS_FOG);
        shader.fragmentShader = shader.fragmentShader
          // centroid: with MSAA, plain varyings are evaluated at the pixel centre even when it lies
          // outside a sliver triangle, extrapolating AO/colour far out of range -> white specks
          .replace('#include <common>', '#include <common>\ncentroid varying vec3 vGrassColor;\ncentroid varying float vGrassAO;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= clamp(vGrassColor, 0.0, 1.0);')
          // both faces share one (mostly upward) normal so blades shade like a canopy, not like cards
          .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, ''))
          .replace(
            '#include <aomap_fragment>',
            `#include <aomap_fragment>
float gAO = clamp(vGrassAO, 0.0, 1.0);
reflectedLight.indirectDiffuse *= gAO;
reflectedLight.directDiffuse *= mix(0.55, 1.0, gAO);`,
          )
          .replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
// soft transmission so backlit grass glows
reflectedLight.directDiffuse += diffuseColor.rgb * ${this.atmo.sunColor.r.toFixed(3)} * 0.18 * clamp(vGrassAO, 0.0, 1.0) * uDaylight;
// thin blades at grazing angles produce sub-pixel sun glints (Fresnel -> 1) that
// sparkle through bloom; grass is effectively a diffuse canopy at this scale
reflectedLight.directSpecular = min(reflectedLight.directSpecular * 0.12, vec3(0.08));
reflectedLight.indirectSpecular *= 0.35;`,
          );
      },
      `grass-${widthScale}`,
    );
    return mat;
  }

  private shown = true;
  /** Graphics option: grass drawn at all (the owner, 2026-10-21: "make it a graphics ssetting to enable or disable it") */
  setShown(on: boolean) {
    this.shown = on;
    for (const l of this.levels) l.mesh.visible = on;
  }

  update(camera: THREE.Camera, player?: THREE.Vector3) {
    if (!this.shown) return;
    if (player) grassUniforms.uPlayer.value.copy(player);
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    for (const l of this.levels) l.count = 0;
    let sig = 0;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const r = this.radius;
    const x0 = Math.floor((cx - r) / PATCH) * PATCH;
    const z0 = Math.floor((cz - r) / PATCH) * PATCH;
    for (let pz = z0; pz <= cz + r; pz += PATCH) {
      for (let px = x0; px <= cx + r; px += PATCH) {
        const dx = Math.max(Math.abs(px + PATCH / 2 - cx) - PATCH / 2, 0);
        const dz = Math.max(Math.abs(pz + PATCH / 2 - cz) - PATCH / 2, 0);
        if (Math.hypot(dx, dz) > r) continue;
        if (px < WORLD_X0 || pz < WORLD_Z0 || px > WORLD_X1 - PATCH || pz > WORLD_Z1 - PATCH) continue;
        const h = this.sampleH(px + PATCH / 2, pz + PATCH / 2);
        // (How far it is from the eye, up included: from a helicopter the grass under it was drawn as thick as round
        // a pair of feet, 3 to 5 ms of the card's frame at 140 m (2026-10-15). Standing, the eye's height moves each
        // band out by a centimetre.)
        const d = Math.hypot(dx, dz, Math.max(0, Math.abs(cy - h) - 1));
        if (d > r) continue;
        // (and none where none grows: a road, a yard, rock, snow. Every blade there was worked out all the same, to
        // be drawn no taller than nothing)
        if (this.bare(px, pz)) continue;
        this.box.min.set(px, h - 2, pz);
        this.box.max.set(px + PATCH, h + 2, pz + PATCH);
        if (!this.frustum.intersectsBox(this.box)) continue;
        let lvl = this.levels[this.levels.length - 1];
        for (const l of this.levels) {
          if (d <= l.maxDist) {
            lvl = l;
            break;
          }
        }
        const arr = lvl.mesh.instanceMatrix.array as Float32Array;
        const o = lvl.count * 16;
        arr[o] = 1; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
        arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 1; arr[o + 11] = 0;
        arr[o + 12] = px; arr[o + 13] = 0; arr[o + 14] = pz; arr[o + 15] = 1;
        lvl.count++;
        sig = (Math.imul(sig, 31) + Math.imul(px, 73) + Math.imul(pz, 19) + this.levels.indexOf(lvl)) | 0;
      }
    }
    // the same patches at the same detail as last frame: nothing to send to the GPU
    if (sig === this.sig) return;
    this.sig = sig;
    for (const l of this.levels) {
      l.mesh.count = l.count;
      l.mesh.instanceMatrix.clearUpdateRanges();
      l.mesh.instanceMatrix.addUpdateRange(0, l.count * 16);
      l.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Whether no blade of the patch can stand: the grass map, read as the shader reads it (blended between its
   * points), is under the least that grows (the shader's smoothstep(0.05, ...)) at every point it is read between.
   */
  private bare(px: number, pz: number) {
    const g = this.terrain.grassTex.image.data as Uint8Array;
    const i0 = Math.max(0, Math.floor((px - WORLD_X0) / CELL)), i1 = Math.min(WORLD_NX - 1, Math.ceil((px + PATCH - WORLD_X0) / CELL));
    const j0 = Math.max(0, Math.floor((pz - WORLD_Z0) / CELL)), j1 = Math.min(WORLD_NZ - 1, Math.ceil((pz + PATCH - WORLD_Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (g[j * WORLD_NX + i] > 12) return false;
    return true;
  }

  private sampleH(x: number, z: number) {
    const ix = Math.min(WORLD_NX - 1, Math.max(0, Math.round((x - WORLD_X0) / CELL)));
    const iz = Math.min(WORLD_NZ - 1, Math.max(0, Math.round((z - WORLD_Z0) / CELL)));
    return this.heights[iz * WORLD_NX + ix];
  }
}

const GRASS_VERT_PARS = /* glsl */ `
attribute vec4 aBlade;
uniform sampler2D tHeight;
uniform sampler2D tGrass;
uniform sampler2D tMacro;
// (the world's north-west corner and size in metres; its samples across and down; metres between samples)
uniform vec4 uWorld;
uniform vec2 uWorldRes;
#define GRASS_CELL ${CELL.toFixed(1)}
uniform float uWidthScale;
uniform float uRadius;
uniform float uTime;
uniform vec3 uWindDir;
uniform float uWindStrength;
uniform vec3 uPlayer;
centroid varying vec3 vGrassColor;
centroid varying float vGrassAO;
vec3 gWorld;
vec3 gNormal;

float hAt(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uWorldRes) - 1);
  return texelFetch(tHeight, c, 0).r;
}
// same triangulation as the terrain mesh / physics heightfield
float terrainH(vec2 p) {
  vec2 g = (p - uWorld.xy) / GRASS_CELL;
  vec2 i = floor(g);
  vec2 f = g - i;
  ivec2 c = ivec2(i);
  float h00 = hAt(c), h10 = hAt(c + ivec2(1, 0)), h01 = hAt(c + ivec2(0, 1)), h11 = hAt(c + ivec2(1, 1));
  if (f.x + f.y <= 1.0) return h00 + (h10 - h00) * f.x + (h01 - h00) * f.y;
  return h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const GRASS_BEGIN = /* glsl */ `
vec3 transformed;
{
  vec2 patchO = instanceMatrix[3].xz;
  vec2 wp = patchO + aBlade.xy;
  // re-randomise per world position so neighbouring patches don't repeat
  float r1 = hash12(wp * 1.37 + aBlade.z * 17.0);
  float r2 = hash12(wp * 2.11 - 5.3);
  float ang = aBlade.w + r1 * 3.0;
  vec2 uvW = (wp - uWorld.xy) / uWorld.zw;
  uvW = uvW * (uWorldRes - 1.0) / uWorldRes + 0.5 / uWorldRes;
  float density = texture2D(tGrass, uvW).r;
  vec4 macro = texture2D(tMacro, wp / 190.0);
  vec4 macro2 = texture2D(tMacro, wp / 23.0);
  // (the ground under the blade, read once: it was read twice, four texels a time, for every point of every blade)
  float baseY = terrainH(wp);
  // (and how far it is from the eye up included, as the patches are chosen: see Grass.update)
  float dist = length(vec3(wp.x - cameraPosition.x, max(0.0, abs(cameraPosition.y - baseY) - 1.0), wp.y - cameraPosition.z));
  float edge = 1.0 - smoothstep(uRadius * 0.72, uRadius, dist);
  float keep = step(r2, density * 1.15);
  float tall = mix(0.35, 0.95, smoothstep(0.2, 0.9, macro2.g)) * mix(0.75, 1.15, macro.b);
  float hgt = (0.22 + 0.42 * r1 * r1) * tall * keep * edge * smoothstep(0.05, 0.4, density);
  float wid = (0.016 + 0.012 * r2) * uWidthScale * keep;
  float t = position.y;
  vec2 dir = vec2(cos(ang), sin(ang));
  // natural lean + wind gust waves travelling across the field
  float wave = sin(dot(wp, uWindDir.xz) * 0.21 - uTime * 1.9) * 0.5 + 0.5;
  float gust = sin(dot(wp, uWindDir.xz) * 0.043 - uTime * 0.7) * 0.5 + 0.5;
  float bendAmt = (0.12 + 0.35 * r2) + uWindStrength * (0.12 + 0.45 * wave * gust);
  vec2 bd0 = dir * 0.6 + uWindDir.xz * (0.4 + wave);
  vec2 bendDir = bd0 / max(length(bd0), 1e-3);
  // player pushes blades aside
  vec2 away = wp - uPlayer.xz;
  float pd = length(away);
  float push = (1.0 - smoothstep(0.25, 1.1, pd)) * step(abs(uPlayer.y - baseY), 2.5);
  vec2 bd1 = mix(bendDir, away / max(pd, 1e-3), push);
  bendDir = bd1 / max(length(bd1), 1e-3);
  bendAmt += push * 1.2;
  float bend = bendAmt * t * t;
  vec3 side = vec3(-dir.y, 0.0, dir.x);
  vec3 p = vec3(wp.x, baseY, wp.y);
  p += side * position.x * wid * (1.0 - t * 0.85);
  p.xz += bendDir * bend * hgt * 0.75;
  p.y += hgt * t * (1.0 - 0.35 * bend * bend);
  transformed = p;
  gWorld = p;
  // colour: dark damp base -> lighter tips, dry patches follow the terrain macro tint
  vec3 baseCol = vec3(0.12, 0.17, 0.06);
  vec3 tipLush = vec3(0.33, 0.44, 0.13);
  vec3 tipDry = vec3(0.55, 0.50, 0.24);
  vec3 tip = mix(tipLush, tipDry, smoothstep(0.35, 0.9, macro.r) * 0.8 + r1 * 0.15);
  vGrassColor = mix(baseCol, tip, smoothstep(0.0, 1.0, t)) * (0.85 + 0.3 * r2);
  vGrassAO = mix(0.55, 1.0, t);
  gNormal = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(side.z, 0.0, -side.x), 0.12));
}
`;

const GRASS_NORMAL = /* glsl */ `
vec3 objectNormal = vec3(0.0, 1.0, 0.0);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

// positions are already in world space; skip instanceMatrix
const GRASS_PROJECT = /* glsl */ `
vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
gl_Position = projectionMatrix * mvPosition;
vNormal = normalize((viewMatrix * vec4(gNormal, 0.0)).xyz);
`;

const GRASS_WORLDPOS = /* glsl */ `
vec4 worldPosition = vec4(transformed, 1.0);
`;

const GRASS_FOG = /* glsl */ `
#ifdef USE_FOG
  vFogWorldPos = transformed;
#endif
`;
