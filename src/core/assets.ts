import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export interface ModelEntry {
  url: string;
  tags: string[];
  bytes: number;
  tris: number;
  min: [number, number, number];
  max: [number, number, number];
  lods: { url: string; tris: number }[];
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
      p = this.track(this.gltf.loadAsync(this.url(url)), url.split('/').pop()!);
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
    t = this.tex.load(this.url(rel), () => resolve(), undefined, () => resolve());
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
