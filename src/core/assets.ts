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
  /**
   * A small thing is shipped twice (scripts/tiers.mjs): `url` is what the world is drawn with, its pictures no
   * bigger than a thousand pixels a side; this is the model as it came, loaded when the thing is in the hands or
   * within arm's reach (see `sharpen`).
   */
  hi?: string;
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

/** the places on a material a picture goes */
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;
type Painted = Record<(typeof MAPS)[number], THREE.Texture | null> & { userData: { hi?: [string, number] } };
const paints = (o: THREE.Object3D): Painted[] => {
  const m = (o as THREE.Mesh).material;
  return (m ? (Array.isArray(m) ? m : [m]) : []) as unknown as Painted[];
};

/**
 * A picture that came with a model is let go of once it is on the graphics card: unpacked, a picture of four
 * thousand pixels a side is 64 MB of the page's own memory as well as 85 on the card, and the page's copy is never
 * looked at again. (All of them together were eight gigabytes.) A picture that is taken off the card afterwards
 * cannot be put back from here: it is fetched again (see `sharpen`), or it is never taken off. Only the big ones:
 * a picture of a thousand pixels a side or less is 4 MB, and is kept, so that it can be taken off the card and
 * put back (the inventory's pictures are drawn that way: see src/ui/icons.ts).
 */
const THIN_OVER = 1024;
function thin(t: THREE.Texture) {
  const was = t.onUpdate as ((tex: THREE.Texture) => void) | null;
  t.onUpdate = (tex: THREE.Texture) => {
    was?.(tex);
    tex.onUpdate = was as never;
    const img = tex.image as ImageBitmap | undefined;
    // (once the frame that put it there is over; how big it was is kept, for whoever counts what is on the card)
    if (img && typeof img.close === 'function' && Math.max(img.width, img.height) > THIN_OVER) {
      tex.userData.was = [img.width, img.height];
      setTimeout(() => img.close(), 0);
    }
  };
}

/** how long the pictures of a thing as it came are kept after the last thing that wanted them has let go, seconds */
const KEEP_SHARP = 10;
/** one picture goes onto the card at a time, this many milliseconds apart: each is a frame's worth of work for it, and a gun's nine at once were half a second of nothing */
const SHARPEN_EVERY = 45;

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
      const file = this.gltf.loadAsync(this.url(url)).then((g) => {
        // (its pictures are let go of here once they are on the card: see `thin`)
        if (!TOUCH && !this.kept.has(url)) g.scene.traverse((o) => paints(o).forEach((mat) => MAPS.forEach((slot) => mat[slot] && thin(mat[slot]!))));
        return g;
      });
      p = this.track(TOUCH ? file.then(shrinkModel) : file, url.split('/').pop()!);
      this.models.set(url, p);
    }
    return p;
  }

  /** a model whose pictures are read again after they have been drawn with (one that is repainted for another thing made of it): they are not let go of */
  keepPictures(id: string) {
    const e = this.manifest.models[id];
    if (e) this.kept.add(e.url);
  }
  private kept = new Set<string>();

  // ------------------------------------------------------------------ pictures at the size they came, for what is close

  private sharp = new Map<string, { users: number; mats: Promise<Painted[]>; pictures: Set<THREE.Texture>; drop: ReturnType<typeof setTimeout> | null }>();
  private swaps: (() => boolean)[] = [];
  private swapping = false;
  private queued = new WeakSet<THREE.Texture>();
  private marked = new WeakSet<object>();
  /** development: every model is loaded as it came, whatever it is for (the inventory's pictures are made so: see scripts/icons.mjs) */
  allSharp = false;

  /** every material of a model that has a copy as it came says which model that is, and which of its materials it is */
  private mark(id: string, g: GLTF): GLTF {
    if (this.marked.has(g) || !this.manifest.models[id]?.hi || this.allSharp) return g;
    this.marked.add(g);
    g.scene.traverse((o) => {
      for (const mat of paints(o)) {
        const at = g.parser.associations.get(mat as never)?.materials;
        if (at !== undefined) mat.userData.hi = [id, at];
      }
    });
    return g;
  }

  /**
   * Whatever is under `root` is painted with its pictures at the size they came, for as long as it is close: in the
   * hands of whoever is playing, or within arm's reach. They are fetched if they are not here (the world's own
   * copy is what is seen until they are, a moment the first time), put on one at a time, and taken off and let go
   * of a little while after the last thing that wanted them has let go. A material keeps what it was painted with:
   * every copy of it in the world is sharp while this one is, at no cost.
   * @returns the letting go
   */
  sharpen(root: THREE.Object3D | THREE.Material[]): () => void {
    if (TOUCH || this.allSharp) return () => {};
    const want = new Map<string, Painted[]>();
    // (or the materials themselves, where whoever asks knows them: see src/game/near.ts)
    if (Array.isArray(root)) {
      for (const mat of root as unknown as Painted[]) {
        const tag = mat.userData?.hi;
        if (!tag) continue;
        if (!want.has(tag[0])) want.set(tag[0], []);
        if (!want.get(tag[0])!.includes(mat)) want.get(tag[0])!.push(mat);
      }
    }
    // (Only what is there to be seen: a gun has hung on it every part that can be fitted to it, most of them put
    // away, and a sight that is not on the gun is not fetched for it. Whether `root` itself is shown is not asked:
    // a gun is put out of sight for a moment as it comes up.)
    const walk = (o: THREE.Object3D, top: boolean) => {
      if (!top && !o.visible) return;
      for (const mat of paints(o)) {
        const tag = mat.userData?.hi;
        if (!tag) continue;
        if (!want.has(tag[0])) want.set(tag[0], []);
        if (!want.get(tag[0])!.includes(mat)) want.get(tag[0])!.push(mat);
      }
      for (const c of o.children) walk(c, false);
    };
    if (!Array.isArray(root)) walk(root, true);
    if (!want.size) return () => {};
    let live = true;
    // (A material may be wanted sharp by more than one thing at once, the gun in the hands and the same gun lying
    // by: it is counted, and goes back to the world's pictures when the last of them has let go.)
    for (const mats of want.values()) for (const mat of mats) {
      const w = this.worn.get(mat) ?? { n: 0, lo: {} };
      w.n++;
      this.worn.set(mat, w);
    }
    for (const [id, mats] of want) {
      void this.holdSharp(id).then((full) => {
        if (!live) return;
        for (const mat of mats) {
          const f = full[mat.userData.hi![1]];
          if (!f) continue;
          for (const slot of MAPS) {
            const hi = f[slot];
            if (!mat[slot] || !hi) continue;
            this.swaps.push(() => {
              const w = this.worn.get(mat);
              if (!w || w.n <= 0 || !mat[slot] || mat[slot] === hi) return false;
              if (!(slot in w.lo)) w.lo[slot] = mat[slot]!;
              // (seen at a slant as the one it takes the place of is)
              if (!this.queued.has(hi)) hi.anisotropy = mat[slot]!.anisotropy;
              mat[slot] = hi;
              // (a picture that is on its way to the card already costs this one nothing)
              const fresh = !this.queued.has(hi);
              this.queued.add(hi);
              return fresh;
            });
          }
        }
        this.pump();
      }, () => {});
    }
    return () => {
      if (!live) return;
      live = false;
      for (const mats of want.values()) for (const mat of mats) {
        const w = this.worn.get(mat);
        if (!w || --w.n > 0) continue;
        for (const slot of MAPS) if (w.lo[slot]) mat[slot] = w.lo[slot]!;
        w.lo = {};
      }
      for (const id of want.keys()) this.letGoSharp(id);
    };
  }
  private worn = new WeakMap<Painted, { n: number; lo: Partial<Record<(typeof MAPS)[number], THREE.Texture>> }>();

  /** the next picture put on, and the one after it a moment later */
  private pump() {
    if (this.swapping) return;
    this.swapping = true;
    const next = () => {
      while (this.swaps.length) if (this.swaps.shift()!()) break;
      if (this.swaps.length) setTimeout(next, SHARPEN_EVERY);
      else this.swapping = false;
    };
    next();
  }

  private holdSharp(id: string): Promise<Painted[]> {
    let s = this.sharp.get(id);
    if (!s) {
      const pictures = new Set<THREE.Texture>();
      const mats = this.gltf.loadAsync(this.url(this.manifest.models[id].hi!)).then(async (g) => {
        const list = (await g.parser.getDependencies('material')) as unknown as Painted[];
        for (const m of list) for (const slot of MAPS) if (m[slot]) {
          pictures.add(m[slot]!);
          thin(m[slot]!);
        }
        return list;
      });
      this.sharp.set(id, (s = { users: 0, mats, pictures, drop: null }));
      // (one that could not be fetched is asked for again the next time it is wanted)
      mats.catch(() => this.sharp.get(id) === s && this.sharp.delete(id));
    }
    s.users++;
    if (s.drop) {
      clearTimeout(s.drop);
      s.drop = null;
    }
    return s.mats;
  }

  private letGoSharp(id: string) {
    const s = this.sharp.get(id);
    if (!s || --s.users > 0) return;
    s.drop = setTimeout(() => {
      this.sharp.delete(id);
      // (when they have come, if they are still on their way)
      const gone = () => {
        for (const t of s.pictures) {
          t.dispose();
          (t.image as ImageBitmap | undefined)?.close?.();
        }
      };
      void s.mats.then(gone, gone);
    }, KEEP_SHARP * 1000);
  }

  /** the pictures of a thing as it came, fetched and kept by the browser against the moment they are wanted (what is carried: see `sharpen`) */
  warm(id: string) {
    const hi = this.manifest.models[id]?.hi;
    if (!hi || TOUCH || this.warmed.has(id)) return;
    this.warmed.add(id);
    void fetch(this.url(hi)).then((r) => r.arrayBuffer()).catch(() => this.warmed.delete(id));
  }
  private warmed = new Set<string>();

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
    return this.mark(id, await this.loadGLTF(this.allSharp && entry.hi ? entry.hi : entry.url));
  }

  /** Loads a Poly Haven model by id and returns its (shared) scene graph. */
  async model(id: string, lod = 0): Promise<THREE.Group> {
    const entry = this.manifest.models[id];
    if (!entry) throw new Error(`unknown model ${id}`);
    const url = lod > 0 && entry.lods[lod - 1] ? entry.lods[lod - 1].url : this.allSharp && entry.hi ? entry.hi : entry.url;
    const g = await this.loadGLTF(url);
    return (lod > 0 ? g : this.mark(id, g)).scene;
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
