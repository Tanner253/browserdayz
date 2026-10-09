import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { TOUCH } from './device';

export interface ModelEntry {
  url: string;
  tags: string[];
  bytes: number;
  tris: number;
  min: [number, number, number];
  max: [number, number, number];
  lods: { url: string; tris: number }[];
  /** a gun out of a weapon pack: where the two wrists of whoever holds it are, in the model's own space */
  holds?: { right: [number, number, number]; left: [number, number, number] };
  /** a weapon pack whole (arms, gun and its movements): see src/game/rig.ts */
  rig?: { fps: number; clips: Record<string, [number, number]>; view: number[]; frame: number[] };
}

export interface Manifest {
  /** when the asset pipeline last ran: used to version every asset URL */
  generated?: string;
  hdri: { background: string; env: string };
  textures: Record<string, { diff: string; nor: string; arm: string }>;
  models: Record<string, ModelEntry>;
}

export interface TreeEntry {
  url: string;
  lod1: string;
  height: number;
  radius: number;
  trunkRadius: number;
  center: [number, number, number];
  bark: 'pine' | 'birch' | 'oak';
  leaf: 'pine' | 'aspen' | 'oak' | 'ash';
  alphaTest: number;
  tris: { lod0: number; lod1: number };
}

type Progress = (loaded: number, total: number, label: string) => void;

/**
 * On a phone no picture is bigger than this on a side: [what is seen as colour, what only
 * shapes the light (normals, roughness and the rest)]. Unpacked on the graphics card the
 * game's pictures come to 1.7 GB, which is more than a phone's browser lets one page have;
 * capped like this they are under half of it. What is given up is the fine grain of the
 * light on a surface, at a size nobody sees on a screen that small: the colour of a wall is
 * as sharp as it was. (A computer keeps every picture whole.)
 */
const PHONE_CAP = { colour: 1024, other: 512 };
const SLOTS: [string, keyof typeof PHONE_CAP][] = [['map', 'colour'], ['emissiveMap', 'colour'], ['normalMap', 'other'], ['roughnessMap', 'other'], ['metalnessMap', 'other'], ['aoMap', 'other'], ['alphaMap', 'other']];

type Picture = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

/** A texture's picture made no bigger than `cap` on a side, before it has gone to the graphics card. */
async function shrink(t: THREE.Texture, cap: number) {
  const img = t.image as Picture | undefined;
  const w = img?.width ?? 0, h = img?.height ?? 0;
  if (!img || Math.max(w, h) <= cap || (t as THREE.Texture & { isCompressedTexture?: boolean; isDataTexture?: boolean }).isCompressedTexture || (t as THREE.Texture & { isDataTexture?: boolean }).isDataTexture) return;
  const k = cap / Math.max(w, h);
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  let small: Picture | null = null;
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    try {
      small = await createImageBitmap(img, { resizeWidth: sw, resizeHeight: sh, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      // (a browser that takes no notice of the sizes hands the picture back as it was)
      if (small.width > sw) small = null;
    } catch {
      small = null;
    }
  }
  if (!small) {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, sw, sh);
    small = c;
  }
  (img as ImageBitmap).close?.();
  t.image = small;
  t.needsUpdate = true;
}

/** every picture a model came with, capped (see PHONE_CAP) */
async function shrinkModel<T extends { scene: THREE.Object3D }>(g: T): Promise<T> {
  const seen = new Set<unknown>();
  const jobs: Promise<void>[] = [];
  g.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) {
      for (const [slot, kind] of SLOTS) {
        const t = (mat as unknown as Record<string, THREE.Texture | null>)[slot];
        if (!t || seen.has(t.source)) continue;
        seen.add(t.source);
        jobs.push(shrink(t, PHONE_CAP[kind]));
      }
    }
  });
  await Promise.all(jobs);
  return g;
}

// (the server imports this module too, where there is no Vite environment)
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

/** Central loader with caching + progress reporting for the loading screen. */
export class Assets {
  manifest!: Manifest;
  trees!: Record<string, TreeEntry>;
  readonly gltf = new GLTFLoader();
  readonly tex = new THREE.TextureLoader();
  readonly hdr = new HDRLoader();
  private models = new Map<string, Promise<GLTF>>();
  private textures = new Map<string, THREE.Texture>();
  private pending = 0;
  private done = 0;
  onProgress: Progress = () => {};
  maxAnisotropy = 8;

  constructor() {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  async init() {
    // Always ask the server for the current asset list: a browser holding last week's copy
    // would not know about models added since, and the game would fail to start.
    const [m, t] = await Promise.all([
      fetch(`${BASE}assets/manifest.json`, { cache: 'no-cache' }).then((r) => r.json()),
      fetch(`${BASE}assets/trees/trees.json`, { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    this.manifest = m;
    this.trees = t;
    this.version = String(m.generated ?? '').replace(/\D/g, '').slice(0, 14);
  }

  private idleWaiters: (() => void)[] = [];

  private track<T>(p: Promise<T>, label: string): Promise<T> {
    this.pending++;
    this.onProgress(this.done, this.pending, label);
    return p.finally(() => {
      this.done++;
      this.onProgress(this.done, this.pending, label);
      if (this.done === this.pending) {
        const w = this.idleWaiters;
        this.idleWaiters = [];
        w.forEach((f) => f());
      }
    });
  }

  /** Resolves once every request issued so far has finished. */
  idle(): Promise<void> {
    if (this.done === this.pending) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  /** changes whenever the assets are rebuilt, so cached models and textures are never stale */
  private version = '';

  url(rel: string) {
    return `${BASE}${rel}${this.version ? `?v=${this.version}` : ''}`;
  }

  loadGLTF(url: string): Promise<GLTF> {
    let p = this.models.get(url);
    if (!p) {
      const file = this.gltf.loadAsync(this.url(url));
      p = this.track(TOUCH ? file.then(shrinkModel) : file, url.split('/').pop()!);
      this.models.set(url, p);
    }
    return p;
  }

  /**
   * Drop decoded glTF files once the world is built: every system works from its own
   * processed copies, and keeping the originals doubled the JS heap (longer GC pauses).
   */
  releaseModels() {
    this.models.clear();
  }

  /** A model file whole: its scene graph and whatever animation came with it. */
  async gltfOf(id: string): Promise<GLTF> {
    const entry = this.manifest.models[id];
    if (!entry) throw new Error(`unknown model ${id}`);
    return this.loadGLTF(entry.url);
  }

  /** Loads a Poly Haven model by id and returns its (shared) scene graph. */
  async model(id: string, lod = 0): Promise<THREE.Group> {
    const entry = this.manifest.models[id];
    if (!entry) throw new Error(`unknown model ${id}`);
    const url = lod > 0 && entry.lods[lod - 1] ? entry.lods[lod - 1].url : entry.url;
    const g = await this.loadGLTF(url);
    return g.scene;
  }

  texture(rel: string, opts: { srgb?: boolean; repeat?: boolean } = {}): THREE.Texture {
    const key = rel + (opts.srgb ? ':s' : '');
    let t = this.textures.get(key);
    if (t) return t;
    let resolve!: () => void;
    const loaded = new Promise<void>((r) => (resolve = r));
    const made = (t = this.tex.load(
      this.url(rel),
      // (on a phone it is made smaller before it is ever drawn with: see PHONE_CAP)
      () => void (TOUCH ? shrink(made, PHONE_CAP[opts.srgb ? 'colour' : 'other']).then(resolve, resolve) : resolve()),
      undefined,
      () => resolve(),
    ));
    this.track(loaded, rel.split('/').pop()!);
    if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.maxAnisotropy;
    this.textures.set(key, t);
    return t;
  }

  /** PBR set from the manifest: { map, normalMap, armMap } */
  pbr(id: string, repeat = true) {
    const e = this.manifest.textures[id];
    if (!e) throw new Error(`unknown texture set ${id}`);
    return {
      map: this.texture(e.diff, { srgb: true, repeat }),
      normalMap: this.texture(e.nor, { repeat }),
      armMap: this.texture(e.arm, { repeat }),
    };
  }

  async image(rel: string): Promise<ImageBitmap> {
    return this.track(
      fetch(this.url(rel))
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })),
      rel.split('/').pop()!,
    );
  }

  async hdri(rel: string): Promise<THREE.DataTexture> {
    return this.track(this.hdr.loadAsync(this.url(rel)), rel.split('/').pop()!);
  }
}

export const assets = new Assets();
