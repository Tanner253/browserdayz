import * as THREE from 'three';
import { assets } from '../core/assets';
import { TOUCH } from '../core/device';
import { physics } from '../core/physics';
import { Simplex } from '../core/noise';
import type { Atmosphere } from './atmosphere';
import { CRAG_MOSS, KINDS, KIND_AT, KIND_NAMES, SNOW_GROUND, layGround, type Ground, type Kind } from './ground';
import { CELL, SNOW, WORLD_RES, WORLD_SIZE, idx, type World } from './worldgen';

// The paint as it was: four layers, in the order of the splat's channels (grass, forest floor, rock, gravel), and
// the metres each was laid to a repeat. The paint as it is now has the kinds of src/world/ground.ts, each at the
// size its picture is in life (these four were laid a third to more than twice too large, which is half of why a
// stone in them was so easy to find again).
const LAYERS = ['leafy_grass', 'brown_mud_leaves_01', 'aerial_rocks_02', 'rocks_ground_02'];
const TILE = [3.2, 3.0, 6.0, 2.6];
const ARRAY_RES = 1024;
/**
 * The paint as it was before 2026-10-13 ("its very noticable its tiled an dugly and we need natural ground"): on a
 * development build with `?ground=old`, to photograph and to time the new against from the same eye. A phone is
 * given the old paint until the new has a lighter path of its own for it.
 */
const OLD_PAINT = TOUCH || (!!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('ground') === 'old');

function arrayOf(data: Uint8Array, res: number, layers: number, srgb: boolean): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, res, res, layers);
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
 * One layer of an array sent to the card by itself, the rest of the array left as it is there. (The renderer sends a
 * layer by taking that layer's part out of the whole array's data. The whole is not kept this side of the card, so
 * it is handed the one layer whichever part it asks for: one layer at a time, the next when this one has gone.)
 */
function sendLayer(tex: THREE.DataArrayTexture, layer: number, data: Uint8Array): Promise<void> {
  return new Promise((sent) => {
    (tex.image as unknown as { data: unknown }).data = { BYTES_PER_ELEMENT: 1, subarray: () => data };
    tex.addLayerUpdate(layer);
    tex.onUpdate = () => {
      (tex.image as { data: Uint8Array | null }).data = null;
      sent();
    };
    tex.needsUpdate = true;
  });
}

/** the size the soft kinds' relief is held at (a `quiet` kind of src/world/ground.ts) */
const QUIET_RES = 512;
/** `?relief=full` on a development build: every kind's relief at full size, to photograph the half-size ones against */
const FULL_RELIEF = !!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('relief') === 'full';

/**
 * The ground's pictures as the paint holds them.
 *   colour  every kind's colour, and in the fourth place how proud of the ground each point stands (the shade map:
 *           bright on what is open to the sky, dark in the cracks), which is what layers and copies are joined by
 *   relief  the two slopes of its normal, and its roughness: in two arrays, the kinds whose relief is soft and fine
 *           at half the size (a quarter of the memory, and not seen: grass, needles, moss)
 * So a look at a layer is two fetches where the paint as it was made three, which is what pays for looking at each
 * layer twice (see groundTap).
 *
 * Before the game is up only the colour and the shade maps are fetched: the ground is drawn at once, its relief
 * flat. `sharpen` fetches the normal maps and sends them a layer at a time; it is called when the first frame has
 * been drawn (nine megabytes fewer to wait for before play).
 *
 * And of each layer what a tap is told so as not to be made: its mean colour (as light, not as the file's numbers),
 * its mean roughness and its mean height. Far off a picture is its mean; and two copies half and half are flatter
 * than either, which is put right about the mean.
 */
async function buildGround(kinds: Kind[], sets: { diff: string; nor: string; arm: string }[]) {
  const S = ARRAY_RES, px = S * S, n = kinds.length;
  const canvasOf = (res: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    return c.getContext('2d', { willReadFrequently: true })!;
  };
  const big = canvasOf(S), small = canvasOf(QUIET_RES);
  const draw = (img: ImageBitmap, ctx: CanvasRenderingContext2D) => {
    const res = ctx.canvas.width;
    ctx.clearRect(0, 0, res, res);
    ctx.drawImage(img, 0, 0, res, res);
    return ctx.getImageData(0, 0, res, res).data;
  };
  const asLight = new Float32Array(256);
  for (let v = 0; v < 256; v++) asLight[v] = v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4);
  // (each kind's place in the array its relief is in)
  const quiet = kinds.map((k) => !!k.quiet && !FULL_RELIEF);
  let loudN = 0, quietN = 0;
  const place = kinds.map((_, l) => (quiet[l] ? quietN++ : loudN++));
  const colour = new Uint8Array(px * 4 * n), loud = new Uint8Array(px * 4 * Math.max(1, loudN)), soft = new Uint8Array(QUIET_RES * QUIET_RES * 4 * Math.max(1, quietN));
  const mean: THREE.Vector3[] = [], flat: THREE.Vector2[] = [];
  /** each kind's roughness, kept until its normal map has come to be laid beside it */
  const roughs: Uint8Array[] = [];
  // (the files are asked for together and unpacked one layer at a time: one canvas is all that is held)
  const files = sets.map((s) => [assets.image(s.diff), assets.image(s.arm)]);
  for (const f of files) for (const p of f) p.catch(() => undefined);
  for (let l = 0; l < n; l++) {
    const o = l * px * 4;
    const diffImg = await files[l][0], armImg = await files[l][1];
    const diff = draw(diffImg, big);
    colour.set(diff, o);
    const arm = draw(armImg, big);
    let r = 0, g = 0, b = 0, rough = 0, high = 0;
    for (let i = 0; i < px * 4; i += 4) {
      colour[o + i + 3] = arm[i];
      r += asLight[diff[i]];
      g += asLight[diff[i + 1]];
      b += asLight[diff[i + 2]];
      rough += arm[i + 1];
      high += arm[i];
    }
    mean.push(new THREE.Vector3(r / px, g / px, b / px));
    flat.push(new THREE.Vector2(rough / px / 255, high / px / 255));
    // its relief, flat for now: its roughness is in the shade map's second place
    const res = quiet[l] ? QUIET_RES : S, into = quiet[l] ? soft : loud, at = place[l] * res * res * 4;
    const own = quiet[l] ? draw(armImg, small) : arm, kept = new Uint8Array(res * res);
    for (let i = 0, k = 0; k < res * res; i += 4, k++) {
      into[at + i] = into[at + i + 1] = 128;
      into[at + i + 2] = kept[k] = own[i + 1];
      into[at + i + 3] = 255;
    }
    roughs.push(kept);
    diffImg.close();
    armImg.close();
  }
  const loudTex = arrayOf(loud, S, Math.max(1, loudN), false), softTex = arrayOf(soft, QUIET_RES, Math.max(1, quietN), false);
  const sharpen = async () => {
    const nors = sets.map((s) => assets.image(s.nor));
    for (const p of nors) p.catch(() => undefined);
    for (let l = 0; l < n; l++) {
      const img = await nors[l];
      const res = quiet[l] ? QUIET_RES : S, nor = draw(img, quiet[l] ? small : big), layer = new Uint8Array(res * res * 4), kept = roughs[l];
      img.close();
      for (let i = 0, k = 0; k < res * res; i += 4, k++) {
        layer[i] = nor[i];
        layer[i + 1] = nor[i + 1];
        layer[i + 2] = kept[k];
        layer[i + 3] = 255;
      }
      await sendLayer(quiet[l] ? softTex : loudTex, place[l], layer);
    }
    roughs.length = 0;
  };
  return { colour: arrayOf(colour, S, n, true), loud: loudTex, soft: softTex, mean, flat, quiet, place, sharpen };
}

/**
 * Snow's picture, for where snow lies close to (SNOW_GROUND in src/world/ground.ts): one picture, made of the
 * set's three when somebody first goes near any snow, and not before. The two slopes of its relief; how bright each
 * point is against the picture's own mean (snow is given its colour by the ground's paint: this is only its
 * mottle); how open to the sky.
 */
async function buildSnow(set: { diff: string; nor: string; arm: string }): Promise<THREE.DataTexture> {
  const S = ARRAY_RES, canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const read = async (url: string) => {
    const img = await assets.image(url);
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(img, 0, 0, S, S);
    img.close();
    return ctx.getImageData(0, 0, S, S).data;
  };
  const data = new Uint8Array(S * S * 4);
  const diff = await read(set.diff);
  let mean = 0;
  for (let i = 0; i < S * S * 4; i += 4) mean += diff[i] * 0.3 + diff[i + 1] * 0.59 + diff[i + 2] * 0.11;
  mean /= S * S;
  for (let i = 0; i < S * S * 4; i += 4) data[i + 2] = Math.min(255, Math.max(0, 128 + (diff[i] * 0.3 + diff[i + 1] * 0.59 + diff[i + 2] * 0.11 - mean) * 4));
  const nor = await read(set.nor);
  for (let i = 0; i < S * S * 4; i += 4) {
    data[i] = nor[i];
    data[i + 1] = nor[i + 1];
  }
  const arm = await read(set.arm);
  for (let i = 0; i < S * S * 4; i += 4) data[i + 3] = arm[i];
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = assets.maxAnisotropy;
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
  const n = new Simplex(4242), patch = new Simplex(9117);
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
      // In the fourth place, a pattern of another kind: slow and smooth, of one size. It is what deals out a ground
      // picture's shifted copies (see groundTap), and the patches it marks out must be about a picture wide and not
      // a speckle. (Nothing else reads this place.)
      const pu = Math.cos(a) * 1.7 + Math.cos(b) * 1.2, pv = Math.sin(a) * 1.7 + Math.sin(b) * 1.2;
      const deal = (patch.noise(pu, pv) + 0.35 * patch.noise(pu * 2.1 + 5.3, pv * 2.1 - 3.1)) / 1.35;
      data[i + 3] = Math.round(Math.min(1, Math.max(0, deal * 0.5 + 0.5)) * 255);
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
  /** what the ground is at each point of the net (src/world/ground.ts): reckoned when the ground is built */
  ground: Ground | null = null;
  /** the relief of the ground's pictures comes after the game is up: 'flat' until it has */
  relief: 'flat' | 'sharp' = 'flat';
  /** what a tile being drawn sets going, of the things that are not waited for before play */
  private later: ((tile: THREE.Mesh, camera: THREE.Camera) => void) | null = null;

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
    // (what the ground is, place by place: the paint is laid by it, and a footstep is told by it whatever the paint)
    this.ground = layGround(this.world);
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
      // (the kinds of ground, and after them the one picture that is not a kind: the moss on the bank's slabs)
      if (KIND_NAMES.length !== 12) throw new Error('the paint reads twelve kinds of ground, four to a picture of weights');
      const kinds: Kind[] = [...KIND_NAMES.map((k) => KINDS[k]), CRAG_MOSS];
      const made = await buildGround(kinds, kinds.map((k) => t[k.tex]));
      const weights = this.ground.weights.map((w) => {
        const tex = new THREE.DataTexture(w, N, N, THREE.RGBAFormat);
        tex.magFilter = tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        return tex;
      });
      const snowIs = new THREE.Vector4(...SNOW_GROUND.colour, 0);
      uniforms = {
        tColour: { value: made.colour },
        tRelief: { value: made.loud },
        tReliefQuiet: { value: made.soft },
        tKindsA: { value: weights[0] },
        tKindsB: { value: weights[1] },
        tKindsC: { value: weights[2] },
        tMacro: { value: this.macroTex },
        tSnow: { value: null },
        uSnowIs: { value: snowIs },
        uLay: { value: kinds.map((k, l) => new THREE.Vector4(1 / k.size, k.far ?? 0.27, (k.sided ? 1 : 0) + (made.quiet[l] ? 2 : 0), made.place[l])) },
        uWorld: { value: new THREE.Vector2(WORLD_SIZE, WORLD_RES) },
        uTint: { value: kinds.map((k) => new THREE.Vector3(...k.tint)) },
        uMean: { value: made.mean },
        uFlat: { value: made.flat },
      };
      // What is not waited for before play. The relief of the ground's pictures: sent for when the first frame has
      // been drawn, and laid in a layer at a time. And snow's own picture: sent for when the eye first comes within
      // 140 m of ground high enough for snow to lie on (most who play never climb to it).
      let begun = false, snowAsked = false;
      this.later = (tile, camera) => {
        if (!begun) {
          begun = true;
          setTimeout(() => void made.sharpen().then(() => (this.relief = 'sharp'), (e) => console.warn('ground relief', e)), 1200);
        }
        const box = tile.geometry.boundingBox;
        if (snowAsked || !box || box.max.y < SNOW.from - 12 || box.distanceToPoint(camera.position) > 140) return;
        snowAsked = true;
        void buildSnow(t[SNOW_GROUND.tex]).then((tex) => {
          uniforms.tSnow.value = tex;
          snowIs.w = 1;
        }, (e) => console.warn('snow picture', e));
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
        .replace('#include <normal_fragment_maps>', OLD_PAINT ? TERRAIN_NORMAL : GROUND_NORMAL)
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
      if (this.later) tile.onBeforeRender = (_r, _s, camera) => this.later?.(tile, camera);
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
    // (by the kind of ground there is most of there: each kind answers as one of the four the game has sounds for)
    if (this.ground) return KINDS[KIND_NAMES[this.ground.top[idx(ix, iz)]]].sound;
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
// (the kinds of ground; and the pictures held, which are those and the moss on the bank's slabs after them)
#define GROUND_KINDS ${KIND_NAMES.length}
#define GROUND_LAYERS ${KIND_NAMES.length + 1}
#define GROUND_TRODDEN ${KIND_AT.trodden}
#define GROUND_CRAG ${KIND_AT.crag}
#define GROUND_CRAG_MOSS ${KIND_NAMES.length}
uniform sampler2DArray tColour;
uniform sampler2DArray tRelief;
uniform sampler2DArray tReliefQuiet;
uniform sampler2D tKindsA;
uniform sampler2D tKindsB;
uniform sampler2D tKindsC;
uniform sampler2D tMacro;
uniform sampler2D tSnow;
// (snow: its colour from far off; and whether its picture has come, which it does when somebody first goes near any)
uniform vec4 uSnowIs;
// (of each kind: one over its size in metres; how large its far copy is laid, as a share; 1 if it is laid by a steep
// face's own direction, and 2 more if its relief is in the small array; its place in the array its relief is in)
uniform vec4 uLay[GROUND_LAYERS];
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
#define SNOW_TILE ${(1 / SNOW_GROUND.size).toFixed(4)}
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
  float l = textureGrad(tMacro, uv * GROUND_PATCH + layer * 0.173, gx * GROUND_PATCH, gy * GROUND_PATCH).a * 8.0;
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
    float at = uLay[i].w;
    vec3 ra = relief, rb = relief;
    if (uLay[i].z > 1.5) {
      if (t < 0.999) ra = textureGrad(tReliefQuiet, vec3(uv + oa, at), gx, gy).xyz;
      if (t > 0.001) rb = textureGrad(tReliefQuiet, vec3(uv + ob, at), gx, gy).xyz;
    } else {
      if (t < 0.999) ra = textureGrad(tRelief, vec3(uv + oa, at), gx, gy).xyz;
      if (t > 0.001) rb = textureGrad(tRelief, vec3(uv + ob, at), gx, gy).xyz;
    }
    relief = t < 0.001 ? ra : (t > 0.999 ? rb : mix(ra, rb, t));
  }
}

// One kind of ground at a place: its colour and how proud it stands, which way its relief leans the ground's normal
// (as a lean in the world, to be added to the normal), and its roughness.
// Most kinds are laid from above. Rock and the stones under it are laid by the face's own direction where the ground
// is steep (side: how much of the face looks along x, up, and along z; nothing for a share too small to show), so
// that a bank or a scarp is rock seen square on and not a picture smeared down it.
void groundKind(int i, vec3 P, vec3 dx, vec3 dy, vec3 N, vec3 side, float nearKeep, float farBlend, float farShare, out vec4 colour, out vec3 lean, out float rough) {
  vec4 lay = uLay[i];
  vec3 pw = mod(lay.z, 2.0) > 0.5 ? side : vec3(0.0, 1.0, 0.0);
  colour = vec4(0.0);
  lean = vec3(0.0);
  rough = 0.0;
  for (int p = 0; p < 3; p++) {
    float k = p == 0 ? pw.y : (p == 1 ? pw.x : pw.z);
    if (k <= 0.0) continue;
    // (where in the picture, and which ways in the world its across and its up run: from above up is north, on a face it is up)
    vec2 uv, gx, gy;
    vec3 T, B;
    if (p == 0) { uv = P.xz; gx = dx.xz; gy = dy.xz; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, -1.0); }
    else if (p == 1) { uv = vec2(P.z, -P.y); gx = vec2(dx.z, -dx.y); gy = vec2(dy.z, -dy.y); T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0); }
    else { uv = vec2(P.x, -P.y); gx = vec2(dx.x, -dx.y); gy = vec2(dy.x, -dy.y); T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); }
    vec4 c = vec4(uMean[i], uFlat[i].y);
    vec3 r = vec3(0.5, 0.5, uFlat[i].x);
    if (nearKeep > 0.0) {
      vec4 nc; vec3 nr;
      groundTap(i, uv * lay.x, gx * lay.x, gy * lay.x, true, nc, nr);
      c = mix(c, nc, nearKeep);
      r = mix(r, nr, nearKeep);
    }
    if (farBlend > 0.0) {
      float wide = lay.x * lay.y;
      vec4 fc; vec3 fr;
      groundTap(i, tRot(uv * wide, 0.9), tRot(gx * wide, 0.9), tRot(gy * wide, 0.9), false, fc, fr);
      // (a face from across the valley is its crags: what is laid by the face has the large copy's light and dark drawn out)
      fc.rgb = max(uMean[i] + (fc.rgb - uMean[i]) * (1.0 + 0.8 * step(0.5, mod(lay.z, 2.0))), 0.0);
      c = mix(c, fc, farShare);
    }
    vec2 n = r.xy * 2.0 - 1.0;
    if (i == GROUND_CRAG) {
      // The slabs of a bank, and the moss grown on them. Their relief is given more than its due, so that a ledge
      // catches the light as a ledge. Moss: in the joints (where the slabs' own picture is low), on what faces up
      // (on a face, what the relief tips toward the sky: the tops of ledges), and more of it all over on the side of
      // a hill the sun does not reach; its edge follows the moss picture's own lumps.
      n *= 1.6;
      float mt = uLay[GROUND_CRAG_MOSS].x;
      // (far off the moss is its mean colour, as every picture is: it is not looked at there)
      vec4 mc = vec4(uMean[GROUND_CRAG_MOSS], uFlat[GROUND_CRAG_MOSS].y); vec3 mr;
      if (nearKeep > 0.0) { vec4 near; groundTap(GROUND_CRAG_MOSS, uv * mt, gx * mt, gy * mt, false, near, mr); mc = mix(mc, near, nearKeep); }
      float joints = 1.0 - smoothstep(0.4, 0.8, c.a);
      float up = clamp(N.y + (p == 0 ? 0.0 : n.y * 0.6), 0.0, 1.0);
      float shaded = clamp(-(N.x * 0.8 + N.z * 0.6) * 1.6, 0.0, 1.0);
      float grown = smoothstep(0.4, 0.6, joints * 0.8 + smoothstep(0.5, 0.92, up) * 0.4 + shaded * 0.22 + (mc.a - 0.5) * 0.35 - 0.1);
      c.rgb = mix(c.rgb, mc.rgb * uTint[GROUND_CRAG_MOSS] / uTint[i], grown);
      n *= 1.0 - 0.6 * grown;
      r.z = mix(r.z, 0.96, grown);
    }
    T -= N * dot(N, T);
    B -= N * dot(N, B);
    colour += c * k;
    lean += (T / max(length(T), 0.001) * n.x + B / max(length(B), 0.001) * n.y) * k;
    rough += r.z * k;
  }
  colour.rgb *= uTint[i];
}
`;

const GROUND_SAMPLE = /* glsl */ `
vec2 splatUv = (vTerrainPos.xz + uWorld.x * 0.5) / uWorld.x;
splatUv = splatUv * (uWorld.y - 1.0) / uWorld.y + 0.5 / uWorld.y;
vec4 macro = texture2D(tMacro, vTerrainPos.xz / 190.0);
vec4 macro2 = texture2D(tMacro, vTerrainPos.xz / 37.0);
vec4 macro3 = texture2D(tMacro, vTerrainPos.zx / 410.0 + 0.31);
// jitter the lookup of what the ground is, so that the edges between kinds are organic instead of grid-aligned
vec2 jitter = (macro2.rg - 0.5) * (2.6 / uWorld.x);
vec4 wA = texture2D(tKindsA, splatUv + jitter);
vec4 wB = texture2D(tKindsB, splatUv + jitter);
vec4 wC = texture2D(tKindsC, splatUv + jitter);

float camDist = length(vTerrainPos - cameraPosition);
vec3 dP3x = dFdx(vTerrainPos);
vec3 dP3y = dFdy(vTerrainPos);
vec2 dPx = dP3x.xz;
vec2 dPy = dP3y.xz;
// Each layer is looked at twice: at its own size, and (from 18 m, growing to 70 m) laid several times as large
// and turned, which is what gives the ground a grain from far off, where at its own size a picture has shrunk to
// its mean colour. Beyond 170 m it is given as that mean and not looked at, and the large copy is most of what is
// seen: the fetches go where they show.
float farBlend = smoothstep(18.0, 70.0, camDist);
float nearKeep = 1.0 - smoothstep(100.0, 170.0, camDist);
float farShare = 0.55 * farBlend + 0.3 * (1.0 - nearKeep);
// (how a steep face is looked at: by which way it faces. Level ground is all "up" and is laid from above as ever.)
vec3 gN = normalize(vTerrainNormal);
vec3 side = pow(abs(gN), vec3(6.0));
side = max(side / (side.x + side.y + side.z) - 0.1, 0.0);
side /= side.x + side.y + side.z;

// There are a dozen kinds of ground and a pixel is of one, two or three of them: the three there is most of are
// looked at (the second if there is any of it to speak of, the third only if there is a good deal), the rest not.
float kindW[GROUND_KINDS];
kindW[0] = wA.r; kindW[1] = wA.g; kindW[2] = wA.b; kindW[3] = wA.a;
kindW[4] = wB.r; kindW[5] = wB.g; kindW[6] = wB.b; kindW[7] = wB.a;
kindW[8] = wC.r; kindW[9] = wC.g; kindW[10] = wC.b; kindW[11] = wC.a;
int pick[3];
float layerW[3];
pick[0] = 0; pick[1] = 0; pick[2] = 0;
layerW[0] = -1.0; layerW[1] = -1.0; layerW[2] = -1.0;
for (int k = 0; k < GROUND_KINDS; k++) {
  float v = kindW[k];
  if (v > layerW[0]) { layerW[2] = layerW[1]; pick[2] = pick[1]; layerW[1] = layerW[0]; pick[1] = pick[0]; layerW[0] = v; pick[0] = k; }
  else if (v > layerW[1]) { layerW[2] = layerW[1]; pick[2] = pick[1]; layerW[1] = v; pick[1] = k; }
  else if (v > layerW[2]) { layerW[2] = v; pick[2] = k; }
}
if (layerW[1] < 0.02) layerW[1] = 0.0;
if (layerW[2] < 0.08) layerW[2] = 0.0;

// height-based blending between the layers: the shade map stands for height
float hts[3];
vec4 cols[3]; vec3 leans[3]; float roughs[3];
float maxH = 0.0;
for (int s = 0; s < 3; s++) {
  hts[s] = -1.0;
  if (layerW[s] <= 0.0) continue;
  groundKind(pick[s], vTerrainPos, dP3x, dP3y, gN, side, nearKeep, farBlend, farShare, cols[s], leans[s], roughs[s]);
  hts[s] = layerW[s] + cols[s].a * 0.55;
  maxH = max(maxH, hts[s]);
}
float wsum = 0.0;
float bw[3];
for (int s = 0; s < 3; s++) {
  bw[s] = hts[s] < 0.0 ? 0.0 : max(hts[s] - (maxH - 0.22), 0.0);
  wsum += bw[s];
}
vec4 tAlb = vec4(0.0);
vec3 gLean = vec3(0.0);
float tRough = 0.0;
for (int s = 0; s < 3; s++) {
  if (bw[s] <= 0.0) continue;
  float k = bw[s] / wsum;
  tAlb += cols[s] * k;
  gLean += leans[s] * k;
  tRough += roughs[s] * k;
}
// A track or a yard is worn palest where it is most trodden, and not evenly: in streaks and patches a few metres
// across, as feet and wheels have gone.
tAlb.rgb *= 1.0 + smoothstep(0.72, 1.0, kindW[GROUND_TRODDEN]) * (0.02 + 0.3 * smoothstep(0.3, 0.75, macro2.r * 0.6 + macro.g * 0.4));
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
tRough = clamp(tRough * 1.05, 0.35, 1.0) * (1.0 - 0.18 * damp);
float tAO = tAlb.a;
// Snow, where the ground is high enough for it to lie and level enough to hold it (SNOW in the world's generator;
// 2026-10-13: "i want high elevation mountains to be snowcapped, and the surrounding area snowcapped"). Laid over
// whatever the ground is, after its own colour has been reckoned and held down: held down with it, snow is grey.
// Its line is ragged by the same slow pattern the grass is patched by. From far off it is its colour and no more
// (it costs nothing there). Within sixty metres it has form: the soft dimpled relief of its own picture, its hollows
// bluer (they are lit by the sky and not the sun), and a broken edge where it thins: it lies in the ground's low
// places first, and what stands proud of the ground (a stone, a tuft) shows through it.
{
  float ragged = (macro.r - 0.5) * 16.0 + (macro2.b - 0.5) * 5.0;
  float lies = smoothstep(SNOW_FROM, SNOW_FULL, vTerrainPos.y + ragged) * smoothstep(SNOW_STEEP - 0.07, SNOW_STEEP + 0.05, gN.y);
  float thin = lies * (0.82 + 0.18 * smoothstep(0.0, 0.5, lies) * (1.0 - 0.5 * tAO * (1.0 - lies)));
  vec3 snow = uSnowIs.rgb * (0.94 + 0.08 * macro2.g);
  vec3 snowLean = vec3(0.0);
  float close = uSnowIs.a * (1.0 - smoothstep(28.0, 60.0, camDist));
  if (lies > 0.0 && close > 0.0) {
    vec2 uv = vTerrainPos.xz * SNOW_TILE, gx = dPx * SNOW_TILE, gy = dPy * SNOW_TILE;
    float l = textureGrad(tMacro, uv * GROUND_PATCH + 0.71, gx * GROUND_PATCH, gy * GROUND_PATCH).a * 8.0;
    float n = floor(l);
    // (its picture: the two slopes of its relief, how bright against its own mean, how open to the sky)
    vec4 sn = mix(textureGrad(tSnow, uv + sin(vec2(3.0, 7.0) * n + 4.1), gx, gy), textureGrad(tSnow, uv + sin(vec2(3.0, 7.0) * (n + 1.0) + 4.1), gx, gy), smoothstep(0.3, 0.7, l - n));
    float edge = smoothstep(0.0, 0.25, lies * 1.7 - (tAlb.a - 0.25) * 0.9 * (1.0 - lies) - 0.14 * (1.0 - sn.a)) * smoothstep(0.0, 0.06, lies);
    thin = mix(thin, edge, close);
    snow *= mix(1.0, 0.88 + 0.24 * sn.b, close);
    snow *= mix(vec3(1.0), mix(vec3(0.8, 0.88, 1.0), vec3(1.0), smoothstep(0.3, 0.8, sn.a)), close);
    vec3 T = vec3(1.0, 0.0, 0.0) - gN * gN.x, B = vec3(0.0, 0.0, -1.0) + gN * gN.z;
    snowLean = (normalize(T) * (sn.r * 2.0 - 1.0) + normalize(B) * (sn.g * 2.0 - 1.0)) * close * 0.7;
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, snow, thin);
  gLean = mix(gLean * (1.0 - 0.8 * thin), snowLean, thin);
  tRough = mix(tRough, ${SNOW_GROUND.rough.toFixed(2)}, thin);
  tAO = mix(tAO, 1.0, thin * 0.6);
}
`;

// (the ground's own normal, leaned by its pictures' relief: less from far off, where the relief is finer than a pixel)
const GROUND_NORMAL = /* glsl */ `
{
  vec3 lean = gLean * mix(1.0, 0.6, farBlend);
  vec3 nW = normalize(gN * sqrt(max(1.0 - dot(lean, lean), 0.04)) + lean);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
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
