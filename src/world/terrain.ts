import * as THREE from 'three';
import { caveMouths, inMouth } from '../sim/pass';
import { assets } from '../core/assets';
import { TOUCH } from '../core/device';
import { physics } from '../core/physics';
import { Simplex } from '../core/noise';
import { SHADOW_FRUSTA, type Atmosphere } from './atmosphere';
import { CRAG_MOSS, KINDS, KIND_AT, KIND_NAMES, SNOW_GROUND, layGround, type Ground, type Kind } from './ground';
import { BELT, FORT_SNOW, RUTS, SNOW_LIFT, snowNet, snowOn, snowPicture, snowThinsGrass, snowUniforms, tellSnow } from './snow';
import { CELL, SNOW, SQUARE_HALF, WORLD_NX, WORLD_NZ, WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1, groundField, heightAt, idx, seenGround, slopeAt, type World } from './worldgen';
import { frameToWorld, inWell, type Basement } from '../sim/basements';

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

/**
 * FAR GROUND DRAWN COARSER, in the west (2026-10-16). The ground west of the square is 288 tiles more, and looked at
 * from the village it was 0.9 million triangles more a frame, nearly all of them over a kilometre off, where a 2 m
 * square is a pixel. So each of its tiles is also laid with squares of 4 m and of 8 m (`COARSE_AT` says from how far),
 * its edges kept at 2 m whatever its middle is, so that tiles of any fineness meet without a crack. Its corners are
 * the net's own points and keep their normals: from far off it is lit as it was. The square's tiles are as they were.
 */
const COARSE_AT = [400, 800];

/**
 * A tile's triangles with squares of `s` samples (2 or 4) inside and the net's own along its four edges: the middle
 * in squares of `s`, and between it and each edge a strip zipped from the edge's points to the middle's. `v(i, j)` is
 * the net's number of the tile's point (i, j); each triangle goes to `put` turned as the fine ground's are.
 */
export function coarseTile(q: number, s: number, v: (i: number, j: number) => number, put: (a: number, b: number, c: number) => void) {
  const tri = (p: [number, number], r: [number, number], t: [number, number]) => {
    const area = (r[0] - p[0]) * (t[1] - p[1]) - (r[1] - p[1]) * (t[0] - p[0]);
    if (area === 0) return;
    // (the fine ground's (a, c, b) has a turn less than nothing in (i, j): every one is laid so)
    if (area < 0) put(v(...p), v(...r), v(...t));
    else put(v(...p), v(...t), v(...r));
  };
  for (let j = s; j < q - s; j += s) for (let i = s; i < q - s; i += s) {
    tri([i, j], [i, j + s], [i + s, j]);
    tri([i + s, j], [i, j + s], [i + s, j + s]);
  }
  // (each strip: the edge's points, and the middle's nearest row of them, both along the strip from one corner to the other)
  const zip = (outer: [number, number][], inner: [number, number][], along: (p: [number, number]) => number) => {
    let a = 0, b = 0;
    while (a < outer.length - 1 || b < inner.length - 1) {
      if (b === inner.length - 1 || (a < outer.length - 1 && along(outer[a + 1]) <= along(inner[b + 1]))) tri(outer[a], outer[++a], inner[b]);
      else tri(outer[a], inner[++b], inner[b - 1]);
    }
  };
  const line = (n: number, f: (k: number) => [number, number]) => Array.from({ length: n }, (_, k) => f(k));
  const fine = q + 1, mid = (q - 2 * s) / s + 1;
  zip(line(fine, (k) => [k, 0]), line(mid, (k) => [s + k * s, s]), (p) => p[0]);
  zip(line(fine, (k) => [k, q]), line(mid, (k) => [s + k * s, q - s]), (p) => p[0]);
  zip(line(fine, (k) => [0, k]), line(mid, (k) => [s, s + k * s]), (p) => p[1]);
  zip(line(fine, (k) => [q, k]), line(mid, (k) => [q - s, s + k * s]), (p) => p[1]);
}

/** a buffer's copy this side, let go once the card has it */
function letGo(this: THREE.BufferAttribute) {
  (this as unknown as { array: unknown }).array = null;
}

/** the world's net as the ground's shaders read it: its north-west corner and size in metres, its samples across and down */
export const worldUniforms = () => ({
  uWorld: { value: new THREE.Vector4(WORLD_X0, WORLD_Z0, WORLD_X1 - WORLD_X0, WORLD_Z1 - WORLD_Z0) },
  uWorldRes: { value: new THREE.Vector2(WORLD_NX, WORLD_NZ) },
});


/** tiles drawn at one go (see Terrain.update): the run's own mesh, its tiles, and the smaller runs inside it */
interface Run {
  mesh: THREE.Mesh;
  of: THREE.Mesh[];
  parts: Run[];
}
const _pv = new THREE.Matrix4(), _view = new THREE.Frustum(), _wide = new THREE.Frustum();

export class Terrain {
  /** the ground, as a group of tiles */
  mesh!: THREE.Group;
  /** which tiles are drawn, by their corners in the world (null: all of them): a game cut down to a wager's arena draws only those within sight of it (arena/rules.ts, cutToArena) */
  only: ((x0: number, z0: number, x1: number, z1: number) => boolean) | null = null;
  heightTex!: THREE.DataTexture;
  /** the ground's own paint, for a lid laid over a hole in the ground (see where it is made) */
  lid: THREE.MeshStandardMaterial | null = null;
  /**
   * Where a basement's steps go down (src/sim/basements.ts), the ground is not drawn: each opening a turned
   * rectangle, its middle and its turn in `uWellA` (x, z, cos, sin), its half sizes in `uWellB`. Said by `openWells`
   * once the houses have been planned, which is after the ground is made.
   */
  readonly wells = {
    uWellA: { value: Array.from({ length: MAX_WELLS }, () => new THREE.Vector4()) },
    uWellB: { value: Array.from({ length: MAX_WELLS }, () => new THREE.Vector4()) },
    uWells: { value: 0 },
  };

  /**
   * the basements' open steps, and the mouths of the pass's caves (src/sim/pass.ts): not drawn, no grass within a
   * metre of them, and the ground's collider open there (see physics.holes)
   */
  openWells(list: Basement[], mouths: ReturnType<typeof caveMouths> = []) {
    const n = Math.min(list.length, MAX_WELLS);
    for (let i = 0; i < n; i++) {
      const b = list[i], w = b.well, [cx, cz] = frameToWorld(b, (w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2);
      this.wells.uWellA.value[i].set(cx, cz, Math.cos(b.rot), Math.sin(b.rot));
      this.wells.uWellB.value[i].set((w.x1 - w.x0) / 2, (w.z1 - w.z0) / 2, 0, 0);
    }
    const m = Math.min(mouths.length, MAX_WELLS - n);
    for (let k = 0; k < m; k++) {
      const q = mouths[k];
      this.wells.uWellA.value[n + k].set(q.x, q.z, Math.cos(q.rot), Math.sin(q.rot));
      this.wells.uWellB.value[n + k].set(q.hx, q.hz, 0, 0);
    }
    this.wells.uWells.value = n + m;
    const g = this.grassTex.image.data as Uint8Array;
    for (const b of list) {
      const [x0, z0, x1, z1] = b.box;
      for (let iz = Math.max(0, Math.floor((z0 - WORLD_Z0) / CELL) - 1); iz <= Math.min(WORLD_NZ - 1, Math.ceil((z1 - WORLD_Z0) / CELL) + 1); iz++)
        for (let ix = Math.max(0, Math.floor((x0 - WORLD_X0) / CELL) - 1); ix <= Math.min(WORLD_NX - 1, Math.ceil((x1 - WORLD_X0) / CELL) + 1); ix++)
          if (inWell([b], WORLD_X0 + ix * CELL, WORLD_Z0 + iz * CELL, 1)) g[idx(ix, iz)] = 0;
    }
    for (const q of mouths) {
      const r = Math.hypot(q.hx, q.hz) + 2;
      for (let iz = Math.max(0, Math.floor((q.z - r - WORLD_Z0) / CELL)); iz <= Math.min(WORLD_NZ - 1, Math.ceil((q.z + r - WORLD_Z0) / CELL)); iz++)
        for (let ix = Math.max(0, Math.floor((q.x - r - WORLD_X0) / CELL)); ix <= Math.min(WORLD_NX - 1, Math.ceil((q.x + r - WORLD_X0) / CELL)); ix++)
          if (inMouth([{ ...q, hx: q.hx + 1, hz: q.hz + 1 }], WORLD_X0 + ix * CELL, WORLD_Z0 + iz * CELL)) g[idx(ix, iz)] = 0;
    }
    this.grassTex.needsUpdate = true;
    physics.holes = (x, z) => inWell(list, x, z) || (mouths.length > 0 && inMouth(mouths, x, z));
  }
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
    // (the world's net: NX samples across, west to east, and NZ down, north to south; X0 and Z0 its north-west corner)
    const NX = WORLD_NX, NZ = WORLD_NZ, X0 = WORLD_X0, Z0 = WORLD_Z0;
    const { heights, splat, grass } = this.world;
    // Where snow lies by place and not by height (src/world/snow.ts: about the fort and along its track, wherever
    // the world has them): told to every shader that asks where snow lies, before any of them is made; and no
    // grass stands through it there, as none does on the mountain. `lifted`: how much higher each point of the
    // net is reckoned to stand for it (nothing at all in a world with no such place).
    tellSnow(this.world);
    snowThinsGrass(this.world);
    const lifted = snowNet(this.world);

    // --- geometry (diagonal matches parry's heightfield triangulation)
    // What is DRAWN is not everywhere what is stood on (`heights`, which the collider below is made from): over
    // the fort's passage the ground is let down, and it is drawn where it was before that, with nothing laid over
    // it; and a few squares are not drawn at all (a hatch's stairwell opens in them, or they are inside the fort's
    // own stone). See `seenGround`.
    const { heights: drawn, open } = seenGround(this.world);
    const pos = new Float32Array(NX * NZ * 3);
    const nrm = new Float32Array(NX * NZ * 3);
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        const i = idx(ix, iz);
        pos[i * 3] = X0 + ix * CELL;
        pos[i * 3 + 1] = drawn[i];
        pos[i * 3 + 2] = Z0 + iz * CELL;
        const hl = drawn[idx(Math.max(ix - 1, 0), iz)];
        const hr = drawn[idx(Math.min(ix + 1, NX - 1), iz)];
        const hd = drawn[idx(ix, Math.max(iz - 1, 0))];
        const hu = drawn[idx(ix, Math.min(iz + 1, NZ - 1))];
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
    // (Every tile's triangles are in one list, laid so that each tile, each two by two of them and each four by four
    // is a run of it: a run is drawn at one go wherever all of it is in sight (see `update`), with nothing kept twice.)
    const sideX = Math.ceil((NX - 1) / TILE_QUADS), sideZ = Math.ceil((NZ - 1) / TILE_QUADS), laid: [number, number][] = [];
    for (let bz = 0; bz < sideZ; bz += 4) for (let bx = 0; bx < sideX; bx += 4)
      for (let sz = bz; sz < Math.min(bz + 4, sideZ); sz += 2) for (let sx = bx; sx < Math.min(bx + 4, sideX); sx += 2)
        for (let tz = sz; tz < Math.min(sz + 2, sideZ); tz++) for (let tx = sx; tx < Math.min(sx + 2, sideX); tx++) laid.push([tx, tz]);
    const index = new Uint32Array((NX - 1) * (NZ - 1) * 6);
    let k = 0;
    for (const [i, j] of laid) {
      const tx = i * TILE_QUADS, tz = j * TILE_QUADS;
      const x1 = Math.min(tx + TILE_QUADS, NX - 1), z1 = Math.min(tz + TILE_QUADS, NZ - 1);
      if (this.only && !this.only(X0 + tx * CELL, Z0 + tz * CELL, X0 + x1 * CELL, Z0 + z1 * CELL)) continue;
      const from = k;
      let lo = Infinity, hi = -Infinity, snowTop = -Infinity;
      for (let iz = tz; iz < z1; iz++) {
        for (let ix = tx; ix < x1; ix++) {
          const a = idx(ix, iz), b = idx(ix + 1, iz), c = idx(ix, iz + 1), d = idx(ix + 1, iz + 1);
          lo = Math.min(lo, drawn[a], drawn[b], drawn[c], drawn[d]);
          hi = Math.max(hi, drawn[a], drawn[b], drawn[c], drawn[d]);
          if (lifted) snowTop = Math.max(snowTop, drawn[a] + lifted[a], drawn[d] + lifted[d]);
          // (a square that is not the ground's to draw: see `seenGround`)
          if (open && open[a]) continue;
          // triangles (a, c, b) and (b, c, d): diagonal b-c, counter-clockwise from above
          index[k++] = a; index[k++] = c; index[k++] = b;
          index[k++] = b; index[k++] = c; index[k++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      // (the highest the tile is reckoned to stand by the snow: its own top, or more where snow lies by place)
      geo.userData.snowTop = Math.max(hi, snowTop);
      geo.userData.tile = [i, j];
      geo.setAttribute('position', posAttr);
      geo.setAttribute('normal', nrmAttr);
      geo.setDrawRange(from, k - from);
      geo.boundingBox = new THREE.Box3(
        new THREE.Vector3(X0 + tx * CELL, lo, Z0 + tz * CELL),
        new THREE.Vector3(X0 + x1 * CELL, hi, Z0 + z1 * CELL),
      );
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
      tiles.push(geo);
    }
    // (the west's tiles laid again, coarser, after all of them: see COARSE_AT. In the same order, so that a run of
    // them is a run of each; each tile's `lods` says where each of its three is)
    const west = tiles.filter((geo) => X0 + (geo.userData.tile[0] + 1) * TILE_QUADS * CELL <= -SQUARE_HALF);
    const per = (s: number) => { let n = 0; coarseTile(TILE_QUADS, s, () => 0, () => n++); return n * 3; };
    const all = new Uint32Array(k + west.length * (per(2) + per(4)));
    all.set(index.subarray(0, k));
    for (const geo of tiles) geo.userData.lods = [[geo.drawRange.start, geo.drawRange.count]];
    for (const s of [2, 4]) for (const geo of west) {
      const [i, j] = geo.userData.tile as [number, number], tx = i * TILE_QUADS, tz = j * TILE_QUADS, from = k;
      coarseTile(TILE_QUADS, s, (a, b) => idx(tx + a, tz + b), (a, b, c) => { all[k++] = a; all[k++] = b; all[k++] = c; });
      geo.userData.lods.push([from, k - from]);
    }
    const shared = new THREE.BufferAttribute(all, 1);
    for (const geo of tiles) geo.setIndex(shared);
    // (the ground's corners, normals and triangles are let go this side once the card has them: nothing reads them
    // again, and a lost picture is a reload. Three times the ground, they were 94 MB of the page's memory kept for nothing.)
    for (const a of [posAttr, nrmAttr, shared]) a.onUpload(letGo);

    // --- data textures shared with grass / vegetation shaders
    const hf = new Float32Array(NX * NZ);
    hf.set(this.world.surface);
    this.heightTex = new THREE.DataTexture(hf, NX, NZ, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;
    this.splatTex = new THREE.DataTexture(splat, NX, NZ, THREE.RGBAFormat);
    this.splatTex.magFilter = this.splatTex.minFilter = THREE.LinearFilter;
    this.splatTex.needsUpdate = true;
    this.grassTex = new THREE.DataTexture(grass, NX, NZ, THREE.RedFormat);
    this.grassTex.magFilter = this.grassTex.minFilter = THREE.LinearFilter;
    this.grassTex.needsUpdate = true;
    this.macroTex = macroNoiseTexture();

    const t = assets.manifest.textures;
    const tint = [new THREE.Vector3(0.78, 0.96, 0.62), new THREE.Vector3(0.9, 0.92, 0.85), new THREE.Vector3(0.95, 0.97, 0.93), new THREE.Vector3(0.86, 0.84, 0.8)];
    // (what the ground is, place by place: the paint is laid by it, and a footstep is told by it whatever the paint)
    this.ground = layGround(this.world);
    let uniforms: Record<string, THREE.IUniform>;
    if (OLD_PAINT) {
      // (the old paint draws with none of the pictures of weights: seven megabytes a phone has no room to keep. What
      // lies uppermost is kept, for the footsteps.)
      this.ground = { weights: [], top: this.ground.top };
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
        ...worldUniforms(),
        uTint: { value: tint },
        ...snowUniforms,
      };
    } else {
      // (the kinds of ground, and after them the one picture that is not a kind: the moss on the bank's slabs)
      if (KIND_NAMES.length !== 18) throw new Error('the paint reads eighteen kinds of ground, four to a picture of weights');
      const kinds: Kind[] = [...KIND_NAMES.map((k) => KINDS[k]), CRAG_MOSS];
      const made = await buildGround(kinds, kinds.map((k) => t[k.tex]));
      const weights = this.ground.weights.map((w) => {
        const tex = new THREE.DataTexture(w, NX, NZ, THREE.RGBAFormat);
        tex.magFilter = tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        return tex;
      });
      const snowIs = new THREE.Vector4(...SNOW_GROUND.colour, 0);
      // What a snowy place's snow is like (`snowPicture`, src/world/snow.ts): the ruts and trodden lines on the
      // ways to the fort, the fort's foot, the hollows of the ground. Three pictures in one, each over its own
      // ground, read between their points. None in a world with no such place: the paint is then told of grounds
      // no bigger than nothing, and never looks.
      const pic = snowPicture(this.world);
      let picTex: THREE.DataTexture | null = null;
      if (pic) {
        picTex = new THREE.DataTexture(pic.data, pic.w, pic.h, THREE.RGBAFormat);
        picTex.magFilter = picTex.minFilter = THREE.LinearFilter;
        picTex.needsUpdate = true;
      }
      uniforms = {
        ...snowUniforms,
        tRuts: { value: picTex },
        uSnowPicBox: { value: pic ? pic.box : new Float32Array(16) },
        uSnowPicAt: { value: pic ? pic.at : new Float32Array(16) },
        uSnowWind: { value: new THREE.Vector2(pic ? pic.wind[0] : 0, pic ? pic.wind[1] : 0) },
        tColour: { value: made.colour },
        tRelief: { value: made.loud },
        tReliefQuiet: { value: made.soft },
        tKindsA: { value: weights[0] },
        tKindsB: { value: weights[1] },
        tKindsC: { value: weights[2] },
        tKindsD: { value: weights[3] },
        tKindsE: { value: weights[4] },
        tMacro: { value: this.macroTex },
        tSnow: { value: null },
        uSnowIs: { value: snowIs },
        uLay: { value: kinds.map((k, l) => new THREE.Vector4(1 / k.size, k.far ?? 0.27, (k.sided ? 1 : 0) + (made.quiet[l] ? 2 : 0), made.place[l])) },
        ...worldUniforms(),
        uTint: { value: kinds.map((k) => new THREE.Vector3(...k.tint)) },
        uMean: { value: made.mean },
        uFlat: { value: made.flat },
      };
      // What is not waited for before play. The relief of the ground's pictures: sent for when the first frame has
      // been drawn, and laid in a layer at a time. And snow's own picture: sent for when the eye first comes within
      // 140 m of ground high enough for snow to lie on (most who play never climb to it), or of ground it lies on
      // by place: the fort's and its track's, which is reckoned as high as that.
      let begun = false, snowAsked = false;
      this.later = (tile, camera) => {
        if (!begun) {
          begun = true;
          setTimeout(() => void made.sharpen().then(() => (this.relief = 'sharp'), (e) => console.warn('ground relief', e)), 1200);
        }
        const box = tile.geometry.boundingBox;
        if (snowAsked || !box || (tile.geometry.userData.snowTop ?? box.max.y) < SNOW.from - 12 || box.distanceToPoint(camera.position) > 140) return;
        snowAsked = true;
        void buildSnow(t[SNOW_GROUND.tex]).then((tex) => {
          uniforms.tSnow.value = tex;
          snowIs.w = 1;
        }, (e) => console.warn('snow picture', e));
      };
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const paint = (shader: Parameters<Parameters<Atmosphere['register']>[1] & {}>[0]) => {
      Object.assign(shader.uniforms, uniforms, this.wells);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvTerrainNormal = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${OLD_PAINT ? TERRAIN_PARS : GROUND_PARS}\n${WELL_PARS}`)
        .replace('#include <clipping_planes_fragment>', `${WELL_CUT}\n#include <clipping_planes_fragment>`)
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
    const at = new Map<string, THREE.Mesh>();
    const piece = (geo: THREE.BufferGeometry) => {
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
      return tile;
    };
    for (const geo of tiles) {
      const tile = piece(geo);
      // (a tile drawn in a run is not drawn on its own in the view: the sun's shadow maps draw it as they did, see `update`)
      tile.intersectsFrustum = (f) => (!tile.userData.inRun || SHADOW_FRUSTA.has(f)) && f.intersectsObject(tile);
      at.set(String(geo.userData.tile), tile);
      if (geo.userData.lods.length > 1) this.far.push(tile);
    }
    // the runs: four by four, and two by two inside each, where every tile of one is there to draw
    const run = (i0: number, j0: number, n: number): Run | null => {
      const of: THREE.Mesh[] = [];
      for (let j = j0; j < j0 + n; j++) for (let i = i0; i < i0 + n; i++) {
        const t = at.get(`${i},${j}`);
        if (!t) return null;
        of.push(t);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', posAttr);
      geo.setAttribute('normal', nrmAttr);
      geo.setIndex(shared);
      // (each fineness of a run is a run of the index too: its tiles are laid one after another at each)
      const most = Math.min(...of.map((t) => (t.geometry.userData.lods as [number, number][]).length));
      const lods = Array.from({ length: most }, (_, L) => {
        const starts = of.map((t) => t.geometry.userData.lods[L][0] as number), ends = of.map((t) => (t.geometry.userData.lods[L][0] + t.geometry.userData.lods[L][1]) as number);
        return [Math.min(...starts), Math.max(...ends) - Math.min(...starts)];
      });
      geo.userData.lods = lods;
      geo.setDrawRange(lods[0][0], lods[0][1]);
      geo.boundingBox = new THREE.Box3();
      for (const t of of) geo.boundingBox.union(t.geometry.boundingBox!);
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
      geo.userData.snowTop = Math.max(...of.map((t) => t.geometry.userData.snowTop as number));
      const mesh = piece(geo);
      mesh.castShadow = false;
      mesh.visible = false;
      return { mesh, of, parts: [] };
    };
    for (let bj = 0; bj < sideZ; bj += 4) for (let bi = 0; bi < sideX; bi += 4) {
      const big = run(bi, bj, 4);
      for (let sj = bj; sj < bj + 4; sj += 2) for (let si = bi; si < bi + 4; si += 2) {
        const small = run(si, sj, 2);
        if (small) (big ? big.parts : this.runs).push(small);
      }
      if (big) this.runs.push(big);
    }
    scene.add(this.mesh);

    // --- physics heightfield (column-major, rows along Z)
    const R = physics.R;
    const f = groundField(heights);
    physics.ground = physics.addStatic(R.ColliderDesc.heightfield(f.rows, f.cols, f.heights, f.scale), 'grass', f.at);
  }

  /** runs of tiles drawn at one go (see `update`) */
  private runs: Run[] = [];
  /** the tiles that are also laid coarser (the west's: see COARSE_AT) */
  private far: THREE.Mesh[] = [];
  /** the west's far tiles drawn coarser (see COARSE_AT); false, every tile is drawn fine, as the square's are */
  coarse = true;

  /**
   * The ground is a hundred and forty-four tiles, each its own thing to draw: seventy-seven of a frame's draws in the
   * street. Where every tile of a run of them (two by two, four by four) is in sight, the run is drawn instead, at
   * one go: the same triangles in the same paint, since a tile in sight is drawn whole either way. The sun's shadow
   * maps go on drawing tile by tile. Not called (a page of its own that draws the world), the runs stay as they were
   * last chosen: a run drawn where a tile of it is now out of sight draws nothing more that is seen.
   */
  update(camera: THREE.Camera) {
    if (!this.runs.length) return;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _view.setFromProjectionMatrix(_pv);
    // (the view without its far end: a run of the west's tiles is drawn at one go wherever it is in sight but for
    // going on past the end of the view, which the card cuts off; from the square's east the end of the view ran
    // through the west's runs, and they were drawn tile by tile: 49 draws of the ground where there had been 16)
    _wide.copy(_view);
    _wide.planes[4].constant = Infinity;
    // (how fine each of the west's tiles is drawn, by how far its nearest point is from the eye)
    const c = camera.position;
    for (const t of this.far) {
      const b = t.geometry.boundingBox!;
      const d = Math.hypot(Math.max(b.min.x - c.x, 0, c.x - b.max.x), Math.max(b.min.y - c.y, 0, c.y - b.max.y), Math.max(b.min.z - c.z, 0, c.z - b.max.z));
      const L = !this.coarse ? 0 : d > COARSE_AT[1] ? 2 : d > COARSE_AT[0] ? 1 : 0;
      if (t.userData.lod === L) continue;
      t.userData.lod = L;
      const [from, n] = t.geometry.userData.lods[L];
      t.geometry.setDrawRange(from, n);
    }
    for (const r of this.runs) this.choose(r);
  }

  /** whether every tile of a run is in sight: then it is drawn at one go (and its parts and tiles not), else each part is chosen for itself */
  private choose(r: Run): boolean {
    // (far off in the west, a run is drawn whole wherever any of it is in sight: its tiles are at their coarsest, a
    // four by four of them is eleven thousand triangles, and a draw of its own for each costs more than that)
    if (this.coarse && r.of.every((t) => t.userData.lod === 2) && r.of.some((t) => _view.intersectsSphere(t.geometry.boundingSphere!))) {
      const [from, n] = r.mesh.geometry.userData.lods[2];
      r.mesh.geometry.setDrawRange(from, n);
      r.mesh.visible = true;
      for (const p of r.parts) p.mesh.visible = false;
      for (const t of r.of) t.userData.inRun = true;
      return true;
    }
    let all = true;
    if (r.parts.length) {
      for (const p of r.parts) if (!this.choose(p)) all = false;
    } else for (const t of r.of) if (!(t.geometry.userData.lods.length > 1 ? _wide : _view).intersectsSphere(t.geometry.boundingSphere!)) all = false;
    // (at one go, a run is drawn as fine as the finest of its tiles: their edges are all fine, so tiles of any
    // fineness meet, and it is one draw)
    let L = 2;
    for (const t of r.of) L = Math.min(L, (t.userData.lod as number | undefined) ?? 0);
    if (all) {
      const [from, n] = r.mesh.geometry.userData.lods[L];
      r.mesh.geometry.setDrawRange(from, n);
    }
    r.mesh.visible = all;
    if (all) for (const p of r.parts) p.mesh.visible = false;
    if (all || !r.parts.length) for (const t of r.of) t.userData.inRun = all;
    return all;
  }

  /** dominant surface for footsteps / bullet impacts */
  surfaceAt(x: number, z: number): 'grass' | 'dirt' | 'rock' | 'gravel' {
    const ix = Math.round((x - WORLD_X0) / CELL);
    const iz = Math.round((z - WORLD_Z0) / CELL);
    if (ix < 0 || iz < 0 || ix >= WORLD_NX || iz >= WORLD_NZ) return 'grass';
    // (by the kind of ground there is most of there: each kind answers as one of the four the game has sounds for)
    if (this.ground) return KINDS[KIND_NAMES[this.ground.top[idx(ix, iz)]]].sound;
    const i = idx(ix, iz) * 4;
    const s = this.world.splat;
    let best = 0;
    for (let c = 1; c < 4; c++) if (s[i + c] > s[i + best]) best = c;
    return (['grass', 'dirt', 'rock', 'gravel'] as const)[best];
  }

  /**
   * Whether snow lies on the ground at a spot: high enough or in a snowy place (src/world/snow.ts), and not on a
   * cliff. For whoever treads there. (Nothing asks yet: a footstep is told the ground under the snow, on the
   * mountain as at the fort, and the sound of a step in snow waits in src/core/audio.ts for somebody to say it.)
   */
  snowAt(x: number, z: number): boolean {
    const H = this.world.heights;
    return snowOn(this.world, x, heightAt(H, x, z), z) > 0.5 && slopeAt(H, x, z) <= SNOW.slope;
  }
}

/** how many basements' openings the ground's shader can leave undrawn */
const MAX_WELLS = 48;
const WELL_PARS = /* glsl */ `
uniform vec4 uWellA[${MAX_WELLS}];
uniform vec4 uWellB[${MAX_WELLS}];
uniform int uWells;
`;
/** (in the frame of each opening, as src/sim/basements.ts turns a point of the world: inside it, nothing is drawn) */
const WELL_CUT = /* glsl */ `
for (int i = 0; i < ${MAX_WELLS}; i++) {
  if (i >= uWells) break;
  vec2 d = vTerrainPos.xz - uWellA[i].xy;
  vec2 l = vec2(d.x * uWellA[i].z - d.y * uWellA[i].w, d.x * uWellA[i].w + d.y * uWellA[i].z);
  if (abs(l.x) < uWellB[i].x && abs(l.y) < uWellB[i].y) discard;
}
`;

const TERRAIN_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform sampler2DArray tNormal;
uniform sampler2DArray tArm;
uniform sampler2D tSplat;
uniform sampler2D tMacro;
uniform vec4 uTile;
// (the world's north-west corner and its size in metres; its samples across and down)
uniform vec4 uWorld;
uniform vec2 uWorldRes;
uniform vec3 uTint[4];
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
#define SNOW_FROM ${SNOW.from.toFixed(1)}
#define SNOW_FULL ${SNOW.full.toFixed(1)}
// (the upward part of the ground's normal on the steepest slope snow lies on)
#define SNOW_STEEP ${(1 / Math.hypot(1, SNOW.slope)).toFixed(3)}
// (where snow lies by place: how much higher a spot is reckoned to stand than it does)
${SNOW_LIFT}

// rotate uv by a per-cell random angle; two overlapping cells are blended to kill tiling
vec2 tRot(vec2 uv, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * uv; }
`;

// Height-blended splat with dual-scale sampling to hide repetition.
const TERRAIN_SAMPLE = /* glsl */ `
vec2 splatUv = (vTerrainPos.xz - uWorld.xy) / uWorld.zw;
splatUv = splatUv * (uWorldRes - 1.0) / uWorldRes + 0.5 / uWorldRes;
vec4 macro = texture2D(tMacro, vTerrainPos.xz / 190.0);
vec4 macro2 = texture2D(tMacro, vTerrainPos.xz / 37.0);
// jitter the splat lookup so layer boundaries are organic instead of grid-aligned
vec2 jitter = (macro2.rg - 0.5) * (2.6 / uWorld.zw);
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
// where it begins, and its own small relief is flattened as it thickens: a drift has none. (High enough, or in a
// snowy place: about the fort and along its ways the ground is reckoned higher than it stands, and on the hill
// behind it snow holds on steeper ground than it does elsewhere: see snowPlace. This paint has no more of a
// place's snow than that: no ruts, nothing at the fort's foot.)
{
  float up = normalize(vTerrainNormal).y;
  float ragged = (macro.r - 0.5) * 16.0 + (macro2.b - 0.5) * 5.0;
  vec2 place = snowPlace(vTerrainPos.xz);
  float lies = smoothstep(SNOW_FROM, SNOW_FULL, vTerrainPos.y + ragged + place.x) * smoothstep(SNOW_STEEP - 0.07 - place.y, SNOW_STEEP + 0.05 - place.y, up);
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
#define GROUND_DUNE ${KIND_AT.dune}
#define GROUND_CANYON ${KIND_AT.canyon}
#define GROUND_GRIT ${KIND_AT.grit}
#define GROUND_CRAG_MOSS ${KIND_NAMES.length}
uniform sampler2DArray tColour;
uniform sampler2DArray tRelief;
uniform sampler2DArray tReliefQuiet;
uniform sampler2D tKindsA;
uniform sampler2D tKindsB;
uniform sampler2D tKindsC;
uniform sampler2D tKindsD;
uniform sampler2D tKindsE;
uniform sampler2D tMacro;
uniform sampler2D tSnow;
// (snow: its colour from far off; and whether its picture has come, which it does when somebody first goes near any)
uniform vec4 uSnowIs;
// (of each kind: one over its size in metres; how large its far copy is laid, as a share; 1 if it is laid by a steep
// face's own direction, and 2 more if its relief is in the small array; its place in the array its relief is in)
uniform vec4 uLay[GROUND_LAYERS];
// (the world's north-west corner and its size in metres; its samples across and down)
uniform vec4 uWorld;
uniform vec2 uWorldRes;
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
// (where snow lies by place: how much higher a spot is reckoned to stand than it does)
${SNOW_LIFT}
// What a snowy place's snow is like (snowPicture in src/world/snow.ts, where each number is said): tRuts is four
// pictures in one, 0 the ways to the fort, 1 the fort's foot, 2 the hollows of the lifted ground, 3 the ground
// worn bare that is no way. Of each, uSnowPicBox says the ground it covers (its corner in x and z, and one over its
// size each way) and uSnowPicAt where in the whole picture it lies (its corner, and how much of the whole it is).
// uSnowWind: the way the wind blows at the fort.
uniform sampler2D tRuts;
uniform vec4 uSnowPicBox[4];
uniform vec4 uSnowPicAt[4];
uniform vec2 uSnowWind;
// (one of the four, read between its own points and never between one of its points and another picture's)
vec4 snowPic(int k, vec2 uv) {
  vec4 at = uSnowPicAt[k];
  vec2 inset = 0.5 / vec2(textureSize(tRuts, 0));
  return textureLod(tRuts, clamp(at.xy + uv * at.zw, at.xy + inset, at.xy + at.zw - inset), 0.0);
}
#define RUT_REACH ${RUTS.reach.toFixed(2)}
#define RUT_GAUGE ${RUTS.gauge.toFixed(3)}
#define RUT_OPEN ${RUTS.wide[0].toFixed(3)}
#define RUT_SHUT ${RUTS.wide[1].toFixed(3)}
#define RUT_SPLAY ${RUTS.splay[0].toFixed(3)}
#define TROD_DRIVEN ${RUTS.trod[0].toFixed(3)}
#define TROD_WALKED ${RUTS.trod[1].toFixed(3)}
#define WORN_FEET ${RUTS.worn.feet.toFixed(2)}
#define WORN_WHEELS ${RUTS.worn.wheels.toFixed(2)}
#define FOOT_REACH ${((FORT_SNOW.reach * 255) / 254).toFixed(4)}
#define FOOT_DAMP vec2(${FORT_SNOW.damp[0].toFixed(2)}, ${FORT_SNOW.damp[1].toFixed(2)})
#define FOOT_DRIFT vec2(${FORT_SNOW.drift[0].toFixed(2)}, ${FORT_SNOW.drift[1].toFixed(2)})
#define FOOT_SCOUR vec2(${FORT_SNOW.scour[0].toFixed(2)}, ${FORT_SNOW.scour[1].toFixed(2)})
#define BELT_HOLLOW ${BELT.hollow.toFixed(2)}
#define BELT_NORTH ${BELT.north.toFixed(2)}
#define BELT_PATCHY ${BELT.patchy.toFixed(2)}
// (the noise that deals out a picture's copies is laid this many of the picture wide: its patches are then about one wide)
#define GROUND_PATCH ${(1 / 60).toFixed(5)}

vec2 tRot(vec2 uv, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * uv; }

// THE CANYON'S BEDS (the owner: "like the grand canyon"; and of the first walls, "does not look natural"): its rock
// banded by height as sandstone lies, red, rust, buff and chocolate, each bed its own thickness and tone; the beds
// bowed by the large grain and the small, thicker in one stretch of wall than the next, so that no two cliffs show
// the same stripes and the rock's picture never reads as a wallpaper's repeat. A tint about 1 on the rock's own colour.
// The bow is the bowing, which the picture's own layers follow on a face. Fading out far off, where a bed is a pixel.
vec3 bedTone(float h) {
  return h < 0.3 ? vec3(1.14, 0.84, 0.72) : (h < 0.55 ? vec3(1.2, 1.0, 0.8) : (h < 0.78 ? vec3(1.16, 1.12, 1.04) : vec3(0.78, 0.66, 0.6)));
}
vec3 canyonBeds(vec3 P, out float bow) {
  // (the noise's slow swell only, read from its coarse copies: its finer octaves bent the rock picture's layers into
  // wood grain, a metre's bend every few metres)
  vec4 m1 = textureLod(tMacro, P.xz / 400.0 + 0.17, 4.0);
  float m2 = textureLod(tMacro, P.zx / 120.0 + 0.53, 3.0).r;
  bow = (m1.r - 0.5) * 18.0 + (m2 - 0.5) * 3.0 + P.x * 0.015;
  float thick = 2.6 + 3.6 * m1.g;
  float t = (P.y + bow) / thick, k = floor(t), f = t - k;
  vec3 a = bedTone(fract(sin(k * 12.9898) * 43758.5453)), b = bedTone(fract(sin((k + 1.0) * 12.9898) * 43758.5453));
  // (a bed's foot in the shade of the one over it, where a soft bed is worn back)
  vec3 c = mix(a, b, smoothstep(0.84, 1.0, f)) * (0.86 + 0.14 * smoothstep(0.0, 0.2, f));
  return mix(vec3(1.0), c, 1.0 - smoothstep(500.0, 1400.0, length(P - cameraPosition)));
}

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
  // (the canyon's rock is layered: its copies shifted along its beds only, or every seam breaks every bed in a swirl)
  if (i == GROUND_CANYON) { oa.y = 0.0; ob.y = 0.0; }
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
  float bow = 0.0;
  vec3 beds = i == GROUND_CANYON ? canyonBeds(P, bow) : vec3(1.0);
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
    if (p != 0) uv.y -= bow;
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
      // (turned, but the canyon's rock on a face: its beds turned would run aslant across every riser, in teeth)
      float turn = i == GROUND_CANYON && p != 0 ? 0.0 : 0.9;
      groundTap(i, tRot(uv * wide, turn), tRot(gx * wide, turn), tRot(gy * wide, turn), false, fc, fr);
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
  colour.rgb *= uTint[i] * beds;
}
`;

const GROUND_SAMPLE = /* glsl */ `
vec2 splatUv = (vTerrainPos.xz - uWorld.xy) / uWorld.zw;
splatUv = splatUv * (uWorldRes - 1.0) / uWorldRes + 0.5 / uWorldRes;
vec4 macro = texture2D(tMacro, vTerrainPos.xz / 190.0);
vec4 macro2 = texture2D(tMacro, vTerrainPos.xz / 37.0);
vec4 macro3 = texture2D(tMacro, vTerrainPos.zx / 410.0 + 0.31);
// jitter the lookup of what the ground is, so that the edges between kinds are organic instead of grid-aligned
vec2 jitter = (macro2.rg - 0.5) * (2.6 / uWorld.zw);
vec4 wA = texture2D(tKindsA, splatUv + jitter);
vec4 wB = texture2D(tKindsB, splatUv + jitter);
vec4 wC = texture2D(tKindsC, splatUv + jitter);
vec4 wD = texture2D(tKindsD, splatUv + jitter);
vec2 wE = texture2D(tKindsE, splatUv + jitter).rg;

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

// There are eighteen kinds of ground and a pixel is of one, two or three of them: the three there is most of are
// looked at (the second if there is any of it to speak of, the third only if there is a good deal), the rest not.
float kindW[GROUND_KINDS];
kindW[0] = wA.r; kindW[1] = wA.g; kindW[2] = wA.b; kindW[3] = wA.a;
kindW[4] = wB.r; kindW[5] = wB.g; kindW[6] = wB.b; kindW[7] = wB.a;
kindW[8] = wC.r; kindW[9] = wC.g; kindW[10] = wC.b; kindW[11] = wC.a;
kindW[12] = wD.r; kindW[13] = wD.g; kindW[14] = wD.b; kindW[15] = wD.a;
kindW[16] = wE.r; kindW[17] = wE.g;
// (THE DESERT BY ITS SLOPE: its paint is laid on a net of two metres, and along a shelf of the canyon its sand ran up
// the riser in pale teeth and its rock out over the shelf. So where any of the desert's kinds are, its rock and scree
// go by the pixel's own slope: rock from about 40 degrees, scree from about 20, on what is between that and the level (the
// rounded foot and lip of a riser, the fans under it), and what the net said was rock on level ground scree; the
// slopes they change at wandering with the large grain, so that no line of paint runs level along a shelf. The green
// land's faces are as they were.)
{
  float sandy = 0.0;
  for (int k = GROUND_DUNE; k < GROUND_KINDS; k++) sandy += kindW[k];
  float share = min(1.0, sandy * 4.0);
  if (share > 0.0) {
    // (where one gives way to the next drawn by the noise's grain, a metre and more across: the rock picture's own
    // relief, which drew it when the change was spread wide, repeats every few metres along a wall in teeth. All that
    // in the canyon country only, where the net laid rock or scree about: level ground and the dunes' sand as they were)
    float rocky = smoothstep(0.2, 0.6, kindW[GROUND_CANYON] + kindW[GROUND_GRIT]), s0 = 1.0 - gN.y;
    float steep = s0 + ((macro2.b - 0.5) * 0.34 + (macro.g - 0.5) * 0.14) * smoothstep(0.03, 0.12, s0) * rocky;
    float rockF = smoothstep(mix(0.28, 0.2, rocky), mix(0.4, 0.28, rocky), steep), screeF = smoothstep(0.04, 0.12, steep) * (1.0 - rockF) * rocky;
    float wasRock = kindW[GROUND_CANYON] * share * (1.0 - rockF) * rocky;
    kindW[GROUND_CANYON] -= wasRock;
    kindW[GROUND_GRIT] += wasRock;
    float rockW = rockF * share, screeW = screeF * share;
    for (int k = 0; k < GROUND_KINDS; k++) kindW[k] *= 1.0 - rockW - screeW;
    kindW[GROUND_CANYON] += rockW;
    kindW[GROUND_GRIT] += screeW;
  }
}
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
// High enough, or in a snowy place (2026-10-13, of the fort moved down to the valley's rim: "i want the area around
// the castle and leaidng up tot the castle snowy, even if its lower elevation than the snow cap elevation"): there
// the ground is reckoned higher than it stands, and on the hill behind the fort snow holds on steeper ground than
// it does elsewhere (snowPlace: the metres added, and how much steeper). All the rest is as it is on the mountain.
{
  float ragged = (macro.r - 0.5) * 16.0 + (macro2.b - 0.5) * 5.0;
  vec2 place = snowPlace(vTerrainPos.xz);
  float lifted = vTerrainPos.y + place.x;
  // THE LOWER EDGE OF A PLACE'S SNOW (BELT in src/world/snow.ts: "snow in hollows and on north-facing ground first,
  // thinning to nothing"). The ground is reckoned higher still where it lies in a hollow and where it faces north,
  // and lower on a knoll and facing south: so the white does not end on one line but breaks up over thirty or
  // forty metres, lying on in the low and the shaded places beyond it and gone from the humps short of it. Only
  // along a place's own edge: not in the middle of a place, where all is white, and not where there is no place.
  float belt = 0.0;
  if (place.x > 0.0 && lifted < SNOW_FULL + 12.0) {
    vec2 buv = clamp((vTerrainPos.xz - uSnowPicBox[2].xy) * uSnowPicBox[2].zw, 0.0, 1.0);
    float hollow = snowPic(2, buv).r * 2.0 - 1.0;
    belt = (hollow * BELT_HOLLOW - gN.z * BELT_NORTH + (macro2.r - 0.5) * BELT_PATCHY) * (1.0 - smoothstep(4.0, 12.0, lifted - SNOW_FULL)) * smoothstep(0.0, 10.0, place.x);
  }
  float lies = smoothstep(SNOW_FROM, SNOW_FULL, lifted + ragged + belt) * smoothstep(SNOW_STEEP - 0.07 - place.y, SNOW_STEEP + 0.05 - place.y, gN.y);
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
  // (what a place's snow has of its own: how its face leans, and how much of the ground shows dark and wet through it)
  vec3 placeLean = vec3(0.0);
  float wet = 0.0;
  // THE WAYS to the fort (RUTS in src/world/snow.ts). A way that is driven has two ruts: in each wheel's line the
  // snow is gone to the bed, more here and less there, and what shows is the bed's own earth, wet (not the grey of
  // a road: "as on asphalt, though the bed is earth"); their edges are ragged by a hand's width; they splay on a
  // bend; and they are drifted over for a few metres every so often (the picture says where). Between them, and
  // alone on a way that is only walked, is the line feet have trodden: broken, a step at a time. Only where a
  // pixel is finer than a rut: from far off a way is white.
  vec2 wuv = (vTerrainPos.xz - uSnowPicBox[0].xy) * uSnowPicBox[0].zw;
  if (lies > 0.0 && wuv.x > 0.0 && wuv.y > 0.0 && wuv.x < 1.0 && wuv.y < 1.0) {
    vec4 wt = snowPic(0, wuv);
    if (wt.a > 0.0) {
      // (which way is across the way here: the way the picture's first number grows, a pace off each way)
      vec2 st = 0.3 * uSnowPicBox[0].zw;
      vec2 across = vec2(snowPic(0, wuv + vec2(st.x, 0.0)).r, snowPic(0, wuv + vec2(0.0, st.y)).r) - wt.r;
      across /= max(length(across), 1e-4);
      // (how far across the way one pixel reaches here, metres)
      float px = abs(dot(dPx, across)) + abs(dot(dPy, across));
      float seen = wt.a * (1.0 - smoothstep(0.2, 0.5, px));
      if (seen > 0.0) {
        float s = (wt.r - 0.5) * 2.0 * RUT_REACH;
        // (the paint's pattern laid small: lumps of a pace down to a hand's width; and smaller, and turned, blots the
        // size of a boot. Its first number only: the others run in streaks one way, and a streak is not a footprint.
        // Read as finely as a pixel is and no finer: read at its finest from ten paces off, a pattern this small
        // comes out as ripples that are not in it.)
        vec4 fine = textureGrad(tMacro, vTerrainPos.xz / 2.3, dPx / 2.3, dPy / 2.3);
        float boot = textureGrad(tMacro, vTerrainPos.zx / 0.9 + 0.37, dPx.yx / 0.9, dPy.yx / 0.9).r;
        float rag = (fine.r - 0.5) * 0.22 + (boot - 0.5) * 0.12;
        float wide = 1.0 + RUT_SPLAY * wt.g;
        // (how far from the middle of the nearer wheel's line)
        float off = abs(abs(s) - RUT_GAUGE) + rag;
        float rut = (1.0 - smoothstep(RUT_OPEN * wide, RUT_SHUT * wide + px, off)) * seen * wt.b;
        float pressed = (1.0 - smoothstep(RUT_SHUT * wide, RUT_SHUT * wide + 0.3 + px, off)) * seen * wt.b;
        // (not of one depth all the way: here the wheels have gone through to the earth, there they have only
        // pressed the snow; by the slow pattern over tens of metres, and by the lumps over a pace or two)
        float worn = 0.2 + 0.8 * smoothstep(0.32, 0.68, macro2.r * 0.55 + fine.r * 0.45);
        // (the trodden line: it wanders a hand either way over some metres, and is there for a step and not for the next)
        float tw = mix(TROD_WALKED, TROD_DRIVEN, wt.b);
        float trod = (1.0 - smoothstep(tw, tw * 2.2 + px, abs(s + (macro2.g - 0.5) * 0.7))) * seen * mix(0.9, 0.7, wt.b) * smoothstep(0.4, 0.58, boot);
        vec3 bed = uMean[GROUND_TRODDEN] * uTint[GROUND_TRODDEN] * (0.3 + 0.24 * tAlb.a);
        diffuseColor.rgb = mix(diffuseColor.rgb, bed, max(rut, 0.7 * trod));
        thin *= 1.0 - max(rut * worn * (1.0 - 0.2 * smoothstep(0.75, 1.0, lies)), 0.5 * trod);
        // (what snow is left in a rut is slush the colour of the bed; beside it, and on the trodden line, it is pressed and grey)
        snow = mix(snow, snow * vec3(0.84, 0.78, 0.72), rut) * (1.0 - 0.1 * max(pressed, trod));
        wet = max(rut * worn, 0.5 * trod) * lies;
        // (a rut has sides: a little, with no ruled edge to them)
        float wall = clamp((off - RUT_OPEN * wide) / ((RUT_SHUT - RUT_OPEN) * wide), 0.0, 1.0);
        placeLean = vec3(across.x, 0.0, across.y) * (-sign(s) * sign(abs(s) - RUT_GAUGE) * 4.0 * wall * (1.0 - wall) * 0.3 * lies * seen * wt.b);
      }
    }
  }
  // GROUND WORN BARE that is no way of its own (where carts turned, the apron before the fort's ramp, the paces
  // from a door to the way past it: the world says where, the picture how much). Trampled snow: pressed and grey
  // all over, and the earth through it in blots the size of a boot, more of them where wheels turned than where
  // feet alone went. No line to it and no edge: it thins out into the snow about it.
  vec2 nuv = (vTerrainPos.xz - uSnowPicBox[3].xy) * uSnowPicBox[3].zw;
  if (lies > 0.0 && nuv.x > 0.0 && nuv.y > 0.0 && nuv.x < 1.0 && nuv.y < 1.0) {
    vec4 nt = snowPic(3, nuv);
    if (nt.r > 0.0) {
      // (blots of two sizes: a boot's, and a few paces across, so that it is patchy and not a speckled round)
      float blots = textureGrad(tMacro, vTerrainPos.zx / 1.3 + 0.19, dPx.yx / 1.3, dPy.yx / 1.3).r * 0.55 + macro2.r * 0.45;
      float through = nt.r * smoothstep(0.46, 0.66, blots + (nt.r - 0.6) * 0.25) * mix(WORN_FEET, WORN_WHEELS, nt.g);
      vec3 bed = uMean[GROUND_TRODDEN] * uTint[GROUND_TRODDEN] * (0.3 + 0.24 * tAlb.a);
      diffuseColor.rgb = mix(diffuseColor.rgb, bed, through);
      thin *= 1.0 - through;
      snow *= 1.0 - 0.1 * nt.r;
      snowLean *= 1.0 - 0.5 * nt.r;
      wet = max(wet, 0.6 * through * lies);
    }
  }
  // THE FORT'S FOOT (FORT_SNOW in src/world/snow.ts: "one even white to the very stone: no drift on the lee side,
  // no scoured strip on the valley side, no dark damp foot to a wall"). The picture says how far from the foot a
  // spot is, how much in the lee, and which way is out. At the stone the snow is gone and the ground dark and wet;
  // in the lee a drift is banked against the wall, smooth and a little brighter, its face tipped out from the
  // wall, and it covers the damp line; on the side the wind comes at, the ground shows through in streaks drawn
  // out down the wind.
  vec2 fuv = (vTerrainPos.xz - uSnowPicBox[1].xy) * uSnowPicBox[1].zw;
  if (lies > 0.0 && fuv.x > 0.0 && fuv.y > 0.0 && fuv.x < 1.0 && fuv.y < 1.0) {
    vec4 ft = snowPic(1, fuv);
    if (ft.r < 0.998) {
      float foot = ft.r * FOOT_REACH, lee = ft.g;
      vec2 outward = ft.ba * 2.0 - 1.0;
      // (the paint's slow pattern, drawn out half a dozen times as long down the wind as across it: tails some
      // metres long behind whatever stands a little proud, and not a comb's teeth)
      vec2 crossWind = vec2(-uSnowWind.y, uSnowWind.x);
      float streak = textureGrad(tMacro, vec2(dot(vTerrainPos.xz, uSnowWind) * 0.036, dot(vTerrainPos.xz, crossWind) * 0.21), vec2(dot(dPx, uSnowWind) * 0.036, dot(dPx, crossWind) * 0.21), vec2(dot(dPy, uSnowWind) * 0.036, dot(dPy, crossWind) * 0.21)).r;
      float drift = lee * (1.0 - smoothstep(FOOT_DRIFT.x, FOOT_DRIFT.y + 2.5 * (macro2.r - 0.5), foot));
      float damp = (1.0 - smoothstep(FOOT_DAMP.x, FOOT_DAMP.y + 0.7 * (macro2.g - 0.3), foot)) * (1.0 - 0.9 * drift);
      // (streaks, and not a comb's: broken by the paint's own blots, so that no two run on side by side for long)
      float scour = (1.0 - lee) * (1.0 - smoothstep(FOOT_SCOUR.x, FOOT_SCOUR.y + 4.0 * (macro.g - 0.5), foot)) * smoothstep(0.48, 0.7, streak * 0.7 + macro2.b * 0.3);
      diffuseColor.rgb *= 1.0 - 0.45 * damp;
      thin *= (1.0 - 0.94 * damp) * (1.0 - 0.6 * scour);
      snow *= 1.0 + 0.08 * drift - 0.06 * scour;
      snowLean *= 1.0 - 0.8 * drift;
      placeLean += vec3(outward.x, 0.0, outward.y) * (0.5 * drift * smoothstep(0.0, 1.0, foot) * lies);
      wet = max(wet, damp * lies);
    }
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, snow, thin);
  gLean = mix(gLean * (1.0 - 0.8 * thin), snowLean, thin) + placeLean;
  tRough = mix(mix(tRough, ${SNOW_GROUND.rough.toFixed(2)}, thin), 0.42, wet * 0.7);
  tAO = mix(tAO, 1.0, thin * 0.6) * (1.0 - 0.2 * wet);
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
