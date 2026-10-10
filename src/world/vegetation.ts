// Instanced vegetation + scatter props with distance LODs, dithered transitions,
// baked tree impostors for the far field, and physics colliders.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CRATE_KINDS } from './buildings';
import { spotKey } from './bunker';
import { assets, type TreeEntry } from '../core/assets';
import { physics, type Surface } from '../core/physics';
import { extractParts, groundParts, type MeshPart } from '../core/gltf-utils';
import { antiFirefly, SHADOW_FRUSTA, type Atmosphere } from './atmosphere';
import { foliagePatch, setLodFade, wind } from './foliage';
import type { Instance, World } from './worldgen';
import { BARREL } from '../sim/barrels';

interface Level {
  meshes: THREE.InstancedMesh[];
  near: number; // fade-in starts
  nearFull: number; // fully visible
  farFull: number; // starts fading out
  far: number; // gone
  count: number;
}

interface LodSetOpts {
  cullRadius: number;
  shadowRadius: number;
}

/**
 * Some Poly Haven files ship several versions of a prop side by side (a clean and a
 * rusty trash can, crate A and crate B). Kinds written as "id@n" pick one version.
 */
const VARIANTS: Record<string, ((node: string) => boolean)[]> = {
  metal_trash_can: [(n) => !n.includes('rust'), (n) => n.includes('rust')],
  old_military_crate: [(n) => /_a$/.test(n), (n) => /_b$/.test(n)],
};

/** how high a bed is to stand on: the top of its mattress (see BED in buildings.ts) */
const BED_TOP = 0.6;
/** props that block movement and bullets: surface type + footprint shrink factor */
const SOLID: Record<string, [Surface, number]> = {
  tree_stump_01: ['wood', 0.8],
  dead_tree_trunk: ['wood', 0.8],
  Barrel_01: ['metal', 0.9],
  barrel_03: ['metal', 0.9],
  wooden_crate_01: ['wood', 0.95],
  cardboard_box_01: ['cloth', 0.9],
  metal_trash_can: ['metal', 0.9],
  utility_box_01: ['metal', 0.95],
  covered_car: ['metal', 0.92],
  concrete_road_barrier: ['concrete', 0.95],
  wooden_military_crate: ['wood', 0.95],
  old_military_crate: ['wood', 0.95],
  weapons_case: ['metal', 0.95],
  stone_fire_pit: ['rock', 0.85],
  street_lamp_01: ['metal', 0.25],
  old_bed_frame: ['metal', 0.95],
  WoodenTable_01: ['wood', 0.95],
  painted_wooden_table: ['wood', 0.95],
  Shelf_01: ['wood', 0.95],
  steel_frame_shelves_01: ['metal', 0.95],
  wooden_bookshelf_worn: ['wood', 0.95],
  painted_wooden_cabinet: ['wood', 0.95],
  scandinavian_masonry_heater: ['metal', 0.9],
  metal_office_desk: ['metal', 0.95],
  electric_stove: ['metal', 0.95],
  Television_01: ['metal', 0.9],
  bunker_terminal: ['metal', 0.92],
  bunker_machine: ['metal', 0.95],
  bunker_pipe: ['metal', 0.7],
  bunker_pipes: ['metal', 0.95],
};

/**
 * Where a tree's simpler model gives way to its baked card, metres. It was 115-130, which from
 * a yard in the woods kept five or six hundred models on screen, over a million triangles
 * most of them smaller than a pixel. Past 85 m a card cannot be told from the model, and
 * handing over there took 3-11 % off the frame wherever a wood is in view.
 */
const HANDOVER: [number, number] = [85, 100];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const UP = new THREE.Vector3(0, 1, 0);

/** One kind of object (tree variant, rock, prop) drawn as instanced LOD levels. */
/**
 * Things whose model stands on edge and which lie flat in the world: a tyre left in a yard
 * lies on its side. (They were always set down at half a tyre's thickness above the ground,
 * which is where one lying down has its middle, and then drawn standing up, half sunk.)
 */
const LAID_FLAT = new Set(['old_tyre']);
const _onItsSide = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

class LodSet {
  levels: Level[] = [];
  matrices: Float32Array;
  pos: Float32Array;
  scale: Float32Array;
  n: number;

  // scratch space for sorting the visible instances nearest-first
  private order: Uint32Array;
  private dist: Float32Array;
  /** per-instance draw distance */
  private far: Float32Array;
  // what is on the GPU now: which instances at which level, how many, and where the camera was
  private sig = 0;
  private shown = 0;
  private at = new THREE.Vector3(Infinity, 0, 0);

  /** @param name what this is (tree or prop kind): shows up in profiles */
  constructor(public instances: Instance[], private opts: LodSetOpts, public name = '') {
    this.n = instances.length;
    this.order = new Uint32Array(this.n);
    this.dist = new Float32Array(this.n);
    this.matrices = new Float32Array(this.n * 16);
    this.pos = new Float32Array(this.n * 3);
    this.scale = new Float32Array(this.n);
    this.far = new Float32Array(this.n);
    const flat = LAID_FLAT.has(name.split(/[#@]/)[0]);
    instances.forEach((it, i) => {
      this.far[i] = it.far ?? Infinity;
      _q.setFromAxisAngle(UP, it.rot);
      if (flat) _q.multiply(_onItsSide);
      _s.setScalar(it.scale);
      _p.set(it.x, it.y, it.z);
      _m.compose(_p, _q, _s);
      _m.toArray(this.matrices, i * 16);
      this.pos.set([it.x, it.y, it.z], i * 3);
      this.scale[i] = it.scale;
    });
  }

  addLevel(scene: THREE.Scene, parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[], near: number, nearFull: number, farFull: number, far: number, castShadow: boolean, shadowOnly = false) {
    const meshes = parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, this.n));
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = castShadow;
      if (shadowOnly) {
        // in the shadow maps and not in the view: three asks this of every pass it draws
        im.frustumCulled = true;
        im.intersectsFrustum = (f) => SHADOW_FRUSTA.has(f);
      }
      im.receiveShadow = true;
      im.matrixAutoUpdate = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Nearest detail level is drawn first, the terrain last: whatever ends up hidden behind
      // closer trees is rejected by the depth test before its (expensive) shading runs.
      im.renderOrder = -10 + this.levels.length;
      im.name = `${this.name}:${this.levels.length}${shadowOnly ? 's' : ''}`;
      scene.add(im);
      return im;
    });
    this.levels.push({ meshes, near, nearFull, farFull, far, count: 0 });
  }

  /** level distances changed (graphics option): redo the buffers on the next update */
  invalidate() {
    this.at.x = Infinity;
  }

  /** take one of them out of the world, or put it back */
  show(i: number, on: boolean) {
    this.far[i] = on ? this.instances[i].far ?? Infinity : -1;
    this.invalidate();
  }

  update(cam: THREE.Vector3, frustum: THREE.Frustum) {
    const { cullRadius, shadowRadius } = this.opts;
    const { order, dist, levels } = this;
    let m = 0;
    let sig = 0;
    for (let i = 0; i < this.n; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > this.far[i]) continue;
      let mask = 0;
      for (let l = 0; l < levels.length; l++) if (d >= levels[l].near && d <= levels[l].far) mask |= 1 << l;
      if (!mask) continue;
      if (d > shadowRadius) {
        _sphere.center.set(x, y + cullRadius * this.scale[i] * 0.5, z);
        _sphere.radius = cullRadius * this.scale[i];
        if (!frustum.intersectsSphere(_sphere)) continue;
      }
      dist[i] = d;
      order[m++] = i;
      sig = (Math.imul(sig, 31) + i * 8 + mask) | 0;
    }
    // The same instances at the same detail levels as last time, and the camera has barely
    // moved: what is on the GPU is still right, so nothing is sorted, copied or uploaded.
    if (sig === this.sig && m === this.shown && this.at.distanceToSquared(cam) < 6.25) return;
    this.sig = sig;
    this.shown = m;
    this.at.copy(cam);
    for (const l of levels) l.count = 0;
    // nearest first: each instance's leaves hide the ones drawn after it (see renderOrder above)
    if (m > 1) order.subarray(0, m).sort((a, b) => dist[a] - dist[b]);
    for (let k0 = 0; k0 < m; k0++) {
      const i = order[k0];
      const d = dist[i];
      for (const l of this.levels) {
        if (d < l.near || d > l.far) continue;
        const off = l.count * 16;
        const src = this.matrices;
        const so = i * 16;
        for (const m of l.meshes) {
          const dst = m.instanceMatrix.array as Float32Array;
          for (let k = 0; k < 16; k++) dst[off + k] = src[so + k];
        }
        l.count++;
      }
    }
    for (const l of this.levels) {
      for (const m of l.meshes) {
        m.count = l.count;
        if (l.count) {
          m.instanceMatrix.clearUpdateRanges();
          m.instanceMatrix.addUpdateRange(0, l.count * 16);
          m.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ impostors

const FRAMES = 8;
const FRAME_W = 256;
const FRAME_H = 384;

interface ImpostorVariant {
  row: number;
  w: number;
  h: number;
}

class Impostors {
  mesh!: THREE.Mesh;
  geo!: THREE.InstancedBufferGeometry;
  iPos!: THREE.InstancedBufferAttribute;
  iVar!: THREE.InstancedBufferAttribute;
  variants = new Map<string, ImpostorVariant>();
  atlas!: THREE.WebGLRenderTarget;
  private all: { x: number; y: number; z: number; s: number; v: number; r: number }[] = [];
  material!: THREE.ShaderMaterial;
  /** how much of the day's light there is (the atmosphere's own figure, once the cards have been photographed) */
  private daylight: { value: number } = { value: 1 };

  bake(renderer: THREE.WebGLRenderer, atmo: Atmosphere, kinds: { name: string; parts: MeshPart[]; entry: TreeEntry }[]) {
    this.daylight = atmo.daylight;
    const rows = kinds.length;
    this.atlas = new THREE.WebGLRenderTarget(FRAME_W * FRAMES, FRAME_H * rows, {
      type: THREE.HalfFloatType,
      samples: 4,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const scene = new THREE.Scene();
    scene.environment = atmo.envMap;
    scene.environmentIntensity = 0.9;
    const sun = new THREE.DirectionalLight(atmo.sunColor, atmo.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.atlas);
    renderer.setClearColor(0x1b2416, 0);
    renderer.clear(true, true, true);

    kinds.forEach((k, row) => {
      const meshes = k.parts.map((p) => new THREE.Mesh(p.geometry, p.material));
      meshes.forEach((m) => {
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
      });
      const aspect = FRAME_W / FRAME_H;
      const w = Math.max(k.entry.radius * 2.1, k.entry.height * 1.04 * aspect);
      const h = w / aspect;
      this.variants.set(k.name, { row, w, h });
      // light shadow frustum around this tree
      const R = Math.max(k.entry.radius, k.entry.height) * 1.2;
      sun.position.copy(atmo.sunDir).multiplyScalar(R * 3).add(new THREE.Vector3(0, k.entry.height / 2, 0));
      sun.target.position.set(0, k.entry.height / 2, 0);
      Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 0.1, far: R * 6 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.needsUpdate = true;

      for (let f = 0; f < FRAMES; f++) {
        const a = (f / FRAMES) * Math.PI * 2;
        cam.left = -w / 2;
        cam.right = w / 2;
        cam.top = h / 2;
        cam.bottom = -h / 2;
        cam.position.set(Math.sin(a) * 60, h / 2, Math.cos(a) * 60);
        cam.lookAt(0, h / 2, 0);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        const vx = f * FRAME_W;
        const vy = (rows - 1 - row) * FRAME_H;
        this.atlas.viewport.set(vx, vy, FRAME_W, FRAME_H);
        this.atlas.scissor.set(vx, vy, FRAME_W, FRAME_H);
        this.atlas.scissorTest = true;
        renderer.setRenderTarget(this.atlas);
        renderer.render(scene, cam);
      }
      meshes.forEach((m) => scene.remove(m));
    });
    this.atlas.scissorTest = false;
    this.atlas.viewport.set(0, 0, this.atlas.width, this.atlas.height);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    sun.shadow.dispose();
  }

  build(scene: THREE.Scene, trees: Instance[], rows: number) {
    for (const t of trees) {
      const v = this.variants.get(t.kind);
      if (!v) continue;
      this.all.push({ x: t.x, y: t.y, z: t.z, s: t.scale, v: v.row, r: t.rot });
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(this.all.length * 4), 4);
    this.iVar = new THREE.InstancedBufferAttribute(new Float32Array(this.all.length), 1);
    this.iPos.setUsage(THREE.DynamicDrawUsage);
    this.iVar.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iVar', this.iVar);
    this.geo.instanceCount = 0;

    const info: THREE.Vector4[] = [];
    for (const v of this.variants.values()) info[v.row] = new THREE.Vector4(v.w, v.h, v.row, 0);
    const fog = scene.fog as THREE.FogExp2;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tAtlas: { value: this.atlas.texture },
        uInfo: { value: info },
        uRows: { value: rows },
        uFade: { value: new THREE.Vector2(...HANDOVER) },
        fogColor: { value: fog.color },
        fogDensity: { value: fog.density },
        // (the cards were photographed by day: at night they are turned down with the rest)
        uDaylight: this.daylight,
      },
      defines: { NV: rows, USE_FOG: '', FOG_EXP2: '' },
      vertexShader: IMPOSTOR_VS,
      fragmentShader: IMPOSTOR_FS,
      alphaToCoverage: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  private sig = 0;

  /** from how far off the cards are drawn (they come in between the two) */
  reach(from: number, full: number) {
    (this.material.uniforms.uFade.value as THREE.Vector2).set(from, full);
  }

  update(cam: THREE.Vector3, frustum: THREE.Frustum, near: number) {
    let n = 0;
    let sig = 0;
    const p = this.iPos.array as Float32Array;
    const v = this.iVar.array as Float32Array;
    const all = this.all;
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      // (the same measure the model fades by: from the eye to the foot of the tree)
      const dx = t.x - cam.x, dy = t.y - cam.y, dz = t.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < near * near) continue;
      _sphere.center.set(t.x, t.y + 8, t.z);
      _sphere.radius = 14 * t.s;
      if (!frustum.intersectsSphere(_sphere)) continue;
      p[n * 4] = t.x;
      p[n * 4 + 1] = t.y;
      p[n * 4 + 2] = t.z;
      p[n * 4 + 3] = t.s;
      v[n] = t.v;
      n++;
      sig = (Math.imul(sig, 31) + i) | 0;
    }
    // the same trees as last frame, in the same order: the buffers are already right
    if (sig === this.sig && n === this.geo.instanceCount) return;
    this.sig = sig;
    this.geo.instanceCount = n;
    this.iPos.clearUpdateRanges();
    this.iPos.addUpdateRange(0, n * 4);
    this.iPos.needsUpdate = true;
    this.iVar.clearUpdateRanges();
    this.iVar.addUpdateRange(0, n);
    this.iVar.needsUpdate = true;
  }
}

const IMPOSTOR_VS = /* glsl */ `
attribute vec4 iPos;
attribute float iVar;
uniform vec4 uInfo[NV];
uniform float uRows;
varying vec2 vUv;
varying float vFrame;
varying float vRow;
varying float vDist;
varying vec3 vFogWorldPos;
void main() {
  vec4 info = uInfo[int(iVar + 0.5)];
  vec3 base = iPos.xyz;
  vec3 toCam = cameraPosition - base;
  vec3 flatDir = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-5, 0.0, 0.0));
  vec3 right = vec3(flatDir.z, 0.0, -flatDir.x);
  float ang = atan(flatDir.x, flatDir.z);
  vFrame = mod(ang / 6.2831853 * ${FRAMES}.0 + ${FRAMES}.0, ${FRAMES}.0);
  vec3 wp = base + right * position.x * info.x * iPos.w + vec3(0.0, position.y * info.y * iPos.w, 0.0);
  // nudge toward the camera so the card doesn't sink into slopes
  wp += flatDir * 1.5;
  vUv = uv;
  vRow = info.z;
  vDist = length(toCam);
  vFogWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const IMPOSTOR_FS = /* glsl */ `
uniform sampler2D tAtlas;
uniform float uRows;
uniform vec2 uFade;
uniform float uDaylight;
varying vec2 vUv;
varying float vFrame;
varying float vRow;
varying float vDist;
#include <fog_pars_fragment>
vec4 frameSample(float f) {
  float fi = mod(floor(f), ${FRAMES}.0);
  vec2 uv = vec2((fi + clamp(vUv.x, 0.004, 0.996)) / ${FRAMES}.0, (uRows - 1.0 - vRow + vUv.y) / uRows);
  return texture2D(tAtlas, uv);
}
void main() {
  float t = fract(vFrame);
  vec4 a = frameSample(vFrame);
  vec4 b = frameSample(vFrame + 1.0);
  vec4 c = mix(a, b, smoothstep(0.25, 0.75, t));
  float fade = smoothstep(uFade.x, uFade.y, vDist);
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // the model dissolves over the same stretch by the same pattern (see foliagePatch): the card
  // takes just the pixels it gives up, so the two never leave a hole or draw twice
  if (c.a < 0.45 || (fade < 0.999 && ign < 1.0 - fade)) discard;
  gl_FragColor = vec4(c.rgb * uDaylight, 1.0);
  #include <fog_fragment>
}`;

// ------------------------------------------------------------------ system

/** A fuel drum (see src/sim/barrels.ts): the red barrel that goes up when a bullet finds it. */
export class Barrel {
  /** false from going up until a new one is stood in its place */
  there = true;
  collider!: RAPIER.Collider;

  /** @param i its number: the same drum has the same one in every game and on the server */
  constructor(readonly i: number, readonly x: number, readonly y: number, readonly z: number, private set: LodSet) {}

  setThere(on: boolean) {
    this.there = on;
    this.set.show(this.i, on);
    this.collider.setEnabled(on);
  }
}

export class Vegetation {
  private sets: LodSet[] = [];
  /** trees and bushes: the range of the full-detail model, which the foliage option scales */
  private detail: { set: LodSet; full: { value: THREE.Vector4 }[]; simple: { value: THREE.Vector4 }[]; base: [number, number]; mid: [number, number] }[] = [];
  private impostors = new Impostors();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  barkMats = new Map<string, THREE.MeshStandardMaterial>();
  /** crate props (with their colliders) that the game turns into searchable containers */
  crates: { kind: string; x: number; y: number; z: number; rot: number; collider: RAPIER.Collider }[] = [];
  /** what stops a body, for each solid thing stood in the world: by where it stands (see spotKey) */
  readonly solidAt = new Map<string, RAPIER.Collider>();
  /** the fuel drums, by number */
  barrels: Barrel[] = [];

  constructor(private world: World, private atmo: Atmosphere) {}

  private barkTextures(type: 'pine' | 'birch' | 'oak') {
    if (type === 'birch') {
      return {
        map: assets.texture('assets/trees/birch_color.webp', { srgb: true, repeat: true }),
        normalMap: assets.texture('assets/trees/birch_normal.webp', { repeat: true }),
        roughnessMap: assets.texture('assets/trees/birch_roughness.webp', { repeat: true }),
        aoMap: assets.texture('assets/trees/birch_ao.webp', { repeat: true }),
      };
    }
    const set = assets.pbr(type === 'pine' ? 'pine_bark' : 'bark_brown_02');
    return { map: set.map, normalMap: set.normalMap, roughnessMap: set.armMap, aoMap: set.armMap };
  }

  private treeMaterials(entry: TreeEntry, withCsm: boolean, sway: number) {
    const barkT = this.barkTextures(entry.bark);
    const bark = new THREE.MeshStandardMaterial({ ...barkT, roughness: 1, metalness: 0, color: entry.bark === 'birch' ? 0xe8e6e0 : 0xb8aea0 });
    const leafTex = assets.texture(`assets/trees/leaf_${entry.leaf}.webp`, { srgb: true });
    const leafTint = entry.leaf === 'pine' ? 0x8fa07a : entry.leaf === 'aspen' ? 0xa8b88a : 0x9aab80;
    const leaves = new THREE.MeshStandardMaterial({
      map: leafTex,
      color: leafTint,
      alphaTest: Math.max(0.35, entry.alphaTest),
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
      alphaToCoverage: true,
    });
    const barkP = foliagePatch({ height: entry.height, sway: sway * 0.6 });
    const leafP = foliagePatch({
      height: entry.height,
      sway,
      flutter: entry.leaf === 'pine' ? 0.012 : 0.03,
      translucency: 0.32,
      sunDir: this.atmo.sunDir,
      sunColor: this.atmo.sunColor,
    });
    if (withCsm) {
      this.atmo.register(bark, barkP.patch, `bark-${sway}`);
      this.atmo.register(leaves, leafP.patch, `leaves-${sway}`);
    } else {
      // (The light that comes through a leaf is told the hour by a number every lit thing is handed when it is
      // registered. These two are not registered: they are what a tree is photographed in for its far-off card.
      // Without that number the leaves' shader did not compile, nothing of them was drawn, and every tree past
      // the handover was a card of bare branches. The card is a picture of the tree at noon: the number is one.)
      const noon = (sh: Parameters<THREE.Material['onBeforeCompile']>[0]) => {
        sh.uniforms.uDaylight = { value: 1 };
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDaylight;');
      };
      bark.onBeforeCompile = (sh) => { noon(sh); barkP.patch(sh); antiFirefly(sh); };
      leaves.onBeforeCompile = (sh) => { noon(sh); leafP.patch(sh); antiFirefly(sh); };
      bark.customProgramCacheKey = () => 'bake-bark';
      leaves.customProgramCacheKey = () => 'bake-leaves';
    }
    return { bark, leaves, barkLod: barkP.lod, leafLod: leafP.lod };
  }

  async build(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const byKind = new Map<string, Instance[]>();
    const add = (list: Instance[]) => {
      for (const it of list) {
        if (!byKind.has(it.kind)) byKind.set(it.kind, []);
        byKind.get(it.kind)!.push(it);
      }
    };
    add(this.world.trees);
    add(this.world.rocks);
    add(this.world.props);

    // ---- trees
    const treeKinds = Object.keys(assets.trees);
    const loaded = await Promise.all(
      treeKinds.map(async (k) => {
        const e = assets.trees[k];
        const [g0, g1] = await Promise.all([assets.loadGLTF(e.url), assets.loadGLTF(e.lod1)]);
        return { k, e, g0, g1 };
      }),
    );
    const bakeKinds: { name: string; parts: MeshPart[]; entry: TreeEntry }[] = [];
    for (const { k, e, g0, g1 } of loaded) {
      const isBush = k.startsWith('bush');
      const sway = isBush ? 0.05 : e.height * 0.012;
      const geo = (g: typeof g0, name: string) => extractParts(g.scene, (n) => n === name)[0].geometry;
      const lod0 = { bark: geo(g0, 'bark'), leaves: geo(g0, 'leaves') };
      const lod1 = { bark: geo(g1, 'bark'), leaves: geo(g1, 'leaves') };
      for (const g of [lod0.bark, lod0.leaves, lod1.bark, lod1.leaves]) g.computeBoundingSphere();

      const m0 = this.treeMaterials(e, true, sway);
      const m1 = this.treeMaterials(e, true, sway);
      const instances = byKind.get(k) ?? [];
      const set = new LodSet(instances, { cullRadius: Math.max(e.radius, e.height) * 0.8, shadowRadius: 34 }, k);
      // full-detail model up close, the simpler one beyond; a tree is then handed over to its
      // baked card (a bush has none, and is simply gone past 110 m)
      const base: [number, number] = isBush ? [32, 40] : [40, 50];
      const out: [number, number] = isBush ? [95, 110] : [115, 130];
      const mid = isBush ? out : HANDOVER;
      setLodFade(m0.barkLod, null, base);
      setLodFade(m0.leafLod, null, base);
      setLodFade(m1.barkLod, base, mid);
      setLodFade(m1.leafLod, base, mid);
      const simple = [{ geometry: lod1.bark, material: m1.bark }, { geometry: lod1.leaves, material: m1.leaves }];
      // Shadows come from the simpler model, drawn into the shadow maps and nowhere else: from
      // the foot of the tree (the full-detail canopy would cost several times as much to draw
      // there a second time) out to 130 m, well past where a tree has become its card, so the
      // ground under a far wood stays shaded.
      set.addLevel(scene, [{ geometry: lod0.bark, material: m0.bark }, { geometry: lod0.leaves, material: m0.leaves }], 0, 0, base[0], base[1], false);
      set.addLevel(scene, simple, base[0], base[1], mid[0], mid[1], false);
      set.addLevel(scene, simple, 0, 0, out[0], out[1], true, true);
      this.detail.push({ set, full: [m0.barkLod, m0.leafLod], simple: [m1.barkLod, m1.leafLod], base, mid });
      if (!isBush) {
        const bm = this.treeMaterials(e, false, 0);
        bakeKinds.push({ name: k, parts: [{ name: 'bark', geometry: lod0.bark, material: bm.bark }, { name: 'leaves', geometry: lod0.leaves, material: bm.leaves }], entry: e });
        // trunk colliders
        for (const t of instances) {
          // (one young pine is measured across its lowest boughs, not its trunk: without the cap
          // every one of them stood inside an unseen pillar four metres across)
          const r = Math.max(0.12, Math.min(e.trunkRadius, 0.5) * t.scale * 0.9);
          const h = Math.min(8, e.height * t.scale * 0.5);
          physics.addStatic(physics.R.ColliderDesc.cylinder(h / 2, r), 'wood', { x: t.x, y: t.y + h / 2, z: t.z });
        }
      }
      this.sets.push(set);
    }

    // ---- rocks and scatter props from Poly Haven
    const propKinds = [...byKind.keys()].filter((k) => !assets.trees[k]);
    const groups = new Map<string, string[]>(); // model id -> kinds
    for (const k of propKinds) {
      const id = k.split(/[#@]/)[0];
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(k);
    }
    await Promise.all(
      [...groups.entries()].map(async ([id, kinds]) => {
        const entry = assets.manifest.models[id];
        const [s0, s1] = await Promise.all([assets.model(id, 0), entry.lods.length ? assets.model(id, 1) : Promise.resolve(null)]);
        for (const kind of kinds) {
          const sub = kind.includes('#') ? Number(kind.split('#')[1]) : -1;
          const variant = kind.includes('@') ? VARIANTS[id]?.[Number(kind.split('@')[1])] : undefined;
          const pick = (scene: THREE.Group) => {
            if (variant) return extractParts(scene, variant);
            if (sub < 0) return extractParts(scene);
            const name = scene.children[sub % scene.children.length].name;
            return extractParts(scene, (n) => n === name);
          };
          const p0 = pick(s0);
          const box = groundParts(p0);
          const p1 = s1 ? pick(s1) : null;
          if (p1) {
            // align LOD1 to the same origin as LOD0
            const b1 = new THREE.Box3();
            p1.forEach((p) => { p.geometry.computeBoundingBox(); b1.union(p.geometry.boundingBox!); });
            const c1 = b1.getCenter(new THREE.Vector3());
            p1.forEach((p) => p.geometry.translate(-c1.x, -b1.min.y, -c1.z));
          }
          const instances = byKind.get(kind)!;
          const size = box.getSize(new THREE.Vector3());
          const isRock = id.startsWith('rock') || id.startsWith('boulder');
          const isFern = id.startsWith('fern') || id.startsWith('dry_branches');
          const set = new LodSet(instances, { cullRadius: Math.max(size.x, size.y, size.z), shadowRadius: 20 }, kind);
          const mats = (parts: MeshPart[], fadeIn: [number, number] | null, fadeOut: [number, number] | null) =>
            parts.map((p) => {
              const m = (p.material as THREE.MeshStandardMaterial).clone();
              if (isFern) {
                m.side = THREE.DoubleSide;
                m.alphaToCoverage = true;
              }
              const fp = foliagePatch(isFern ? { height: 1, sway: 0.05, flutter: 0.01, translucency: 0.25, sunDir: this.atmo.sunDir, sunColor: this.atmo.sunColor } : {});
              setLodFade(fp.lod, fadeIn, fadeOut);
              this.atmo.register(m, fp.patch, `${isFern ? 'fern' : 'prop'}`);
              return { geometry: p.geometry, material: m as THREE.Material };
            });
          // Full detail up close, the far version (a few hundred triangles) beyond. How soon
          // depends on how big the thing is: a crate can swap at 18 m, a car not before 60.
          const biggest = instances.reduce((a, it) => Math.max(a, it.scale), 0) || 1;
          const swap = THREE.MathUtils.clamp(Math.max(size.x, size.y, size.z) * biggest * 20, 18, 60);
          const fade: [number, number] = [swap, swap + Math.max(4, swap * 0.18)];
          const out: [number, number] = isRock ? [330, 350] : isFern ? [58, 70] : [128, 140];
          if (p1) {
            set.addLevel(scene, mats(p0, null, fade), 0, 0, fade[0], fade[1], !isFern);
            set.addLevel(scene, mats(p1, fade, out), fade[0], fade[1], out[0], out[1], !isFern);
          } else {
            set.addLevel(scene, mats(p0, null, out), 0, 0, out[0], out[1], !isFern);
          }
          this.sets.push(set);

          // colliders
          if (isRock) {
            const src = (p1 ?? p0)[0].geometry;
            const posAttr = src.getAttribute('position');
            const idxAttr = src.getIndex();
            for (const it of instances) {
              if (it.scale * size.y < 0.35) continue;
              const verts = new Float32Array(posAttr.count * 3);
              for (let v = 0; v < posAttr.count; v++) {
                verts[v * 3] = posAttr.getX(v) * it.scale;
                verts[v * 3 + 1] = posAttr.getY(v) * it.scale;
                verts[v * 3 + 2] = posAttr.getZ(v) * it.scale;
              }
              const indices = idxAttr ? new Uint32Array(idxAttr.array) : new Uint32Array(posAttr.count).map((_, i) => i);
              physics.addStatic(physics.R.ColliderDesc.trimesh(verts, indices), 'rock', { x: it.x, y: it.y, z: it.z }, it.rot);
            }
          } else if (SOLID[id]) {
            const [surface, shrink] = SOLID[id];
            instances.forEach((it, n) => {
              const hx = (size.x * it.scale) / 2, hy = (size.y * it.scale) / 2, hz = (size.z * it.scale) / 2;
              // a bullet that lands on a fuel drum has to know which one it was
              const drum = kind === BARREL.kind ? (this.barrels[n] = new Barrel(n, it.x, it.y, it.z, set)) : undefined;
              // (A bed is solid as high as its mattress, so that it can be got up on, and its head and its foot stand
              // up from that as boards of their own: as one box the height of its head, it was a wall a bed long.)
              const low = id === 'old_bed_frame' ? (BED_TOP * it.scale) / 2 : hy;
              const col = physics.addStatic(physics.R.ColliderDesc.cuboid(hx * shrink, low, hz * shrink), surface, { x: it.x, y: it.y + low, z: it.z }, it.rot, drum);
              if (low < hy) {
                for (const [end, tall] of [[-1, size.y], [1, size.y * 0.68]] as const) {
                  const dz = end * (hz - 0.03), half = (tall * it.scale) / 2;
                  physics.addStatic(physics.R.ColliderDesc.cuboid(hx * shrink, half, 0.03), surface, { x: it.x + Math.sin(it.rot) * dz, y: it.y + half, z: it.z + Math.cos(it.rot) * dz }, it.rot);
                }
              }
              if (drum) drum.collider = col;
              this.solidAt.set(spotKey(it.x, it.z), col);
              if (CRATE_KINDS.has(id)) this.crates.push({ kind: id, x: it.x, y: it.y, z: it.z, rot: it.rot, collider: col });
            });
          }
        }
      }),
    );

    // ---- impostors for the far forest (baked under the real sun + sky)
    this.impostors.bake(renderer, this.atmo, bakeKinds);
    this.impostors.build(scene, this.world.trees, bakeKinds.length);
  }

  private detailK = 1;
  private reachK = 1;

  /** Graphics option: how far the full-detail trees and bushes reach (1 = as built). */
  setDetail(k: number) {
    this.detailK = k;
    this.applyLods();
  }

  /**
   * How many times further than built every tree is drawn as itself before its card takes over. A long lens
   * brings far trees as near as near ones: through the menu's (30 to 45 degrees, against the game's 62) the wood
   * on the far hill was a stand of cards, and a card of a tree at that size is bare poles. With this at the
   * lens's own magnification they are trees, in leaf, as far as the lens makes them large.
   */
  setReach(k: number) {
    if (Math.abs(k - this.reachK) < 0.03) return;
    this.reachK = k;
    this.applyLods();
  }

  private applyLods() {
    const k = this.detailK * this.reachK, r = this.reachK;
    for (const d of this.detail) {
      const fade: [number, number] = [d.base[0] * k, d.base[1] * k], mid: [number, number] = [d.mid[0] * r, d.mid[1] * r];
      for (const u of d.full) setLodFade(u, null, fade);
      for (const u of d.simple) setLodFade(u, fade, mid);
      const [full, simple] = d.set.levels;
      full.farFull = simple.near = fade[0];
      full.far = simple.nearFull = fade[1];
      simple.farFull = mid[0];
      simple.far = mid[1];
      d.set.invalidate();
    }
    this.impostors.reach(HANDOVER[0] * r, HANDOVER[1] * r);
  }

  update(dt: number, camera: THREE.Camera) {
    wind.uTime.value += dt;
    const cam = camera.position;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const s of this.sets) s.update(cam, this.frustum);
    this.impostors.update(cam, this.frustum, HANDOVER[0] * this.reachK);
  }
}
