import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { LEAN, TOUCH } from './device';
import { STRIP_OVER, Strips } from './strips';
import { breathe } from './breathe';

export interface ModelEntry {
  url: string;
  tags: string[];
  bytes: number;
  tris: number;
  min: [number, number, number];
  max: [number, number, number];
  /** lighter copies of it, for further off. `far`: one made by scripts/lods.mjs, for a thing on the ground or a car (see ItemModels.getFar) */
  lods: { url: string; tris: number; far?: number }[];
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
  /** what that copy's pictures weigh on the graphics card once unpacked there, megabytes (scripts/hi-card.mjs) */
  hiCard?: number;
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
/**
 * And that was still more than an iPhone allows a page, by a long way: every picture in the game at that size is
 * 1.7 GB on the card, and as much again held in the page, and a page there is closed at about one. So on a phone a
 * thing is drawn with pictures this small until the eye is near it, or it is in the hands, and then with the ones
 * above (see `sharpen`: it is what a computer does with the pictures at the size they came, a size down). From as
 * far as this is seen from, on a screen that size, it is what the screen has pixels for.
 */
const PHONE_FAR = { colour: 256, other: 128 };
/**
 * And on a computer every model is drawn so as well, near or far, with no copy as it came for what is close (2026-10-21,
 * the owner, shown each thing at three sizes: "we can do C"). Six minutes online had put 1.3 GB of models' pictures on
 * an 8 GB card, and every copy as it came was 22 to 405 MB more each time somebody walked up to the thing.
 */
const DESK = !TOUCH;
const DESK_CAP = PHONE_FAR;
/**
 * Each model's file made at DESK_CAP already, for a computer (scripts/lean.mjs): the files carried their pictures at up
 * to 2048 and a computer threw most of every one away on arrival (the owner: "we should do this"). The pixels are the
 * ones the game would have cut (Chrome's own cut, stored lossless). A copy is named by the version of the file it was
 * made from: a file changed since is loaded whole. A phone loads the files themselves (its near pictures come from them).
 */
const LEAN_DIR = `assets/lean/${DESK_CAP.colour}-${DESK_CAP.other}/`;
/** somebody's body, on a phone: it is not one of the things made sharper when near, and is never far when it matters */
const PHONE_BODY = { colour: 512, other: 256 };
type Cap = typeof PHONE_CAP;
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
function thin(t: THREE.Texture, over = THIN_OVER) {
  const was = t.onUpdate as ((tex: THREE.Texture) => void) | null;
  t.onUpdate = (tex: THREE.Texture) => {
    was?.(tex);
    tex.onUpdate = was as never;
    const img = tex.image as ImageBitmap | undefined;
    // (once the frame that put it there is over; how big it was is kept, for whoever counts what is on the card)
    if (img && typeof img.close === 'function' && Math.max(img.width, img.height) > over) {
      tex.userData.was = [img.width, img.height];
      setTimeout(() => img.close(), 0);
    }
  };
}

/** how long the pictures of a thing as it came are kept after the last thing that wanted them has let go, seconds */
const KEEP_SHARP = 10;
/** one picture goes onto the card at a time, this many milliseconds apart: each is a frame's worth of work for it, and a gun's nine at once were half a second of nothing */
const SHARPEN_EVERY = 45;

/** as many pictures waiting to go on as this, and the next model's are not unpacked yet: each one waiting is up to 64 MB of the page's memory */
const SHARP_BACKLOG = 3;

/**
 * Whether a picture's file is nothing but an opaque picture: a webp with no alpha in it, no colour profile, and no
 * note of which way up it is. Nine in ten of the pictures a model comes with are.
 */
async function plainPicture(file: Blob) {
  const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const tag = (at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  if (b.length < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return false;
  const kind = tag(12);
  // (the plain lossy kind has no room for any of them)
  if (kind === 'VP8 ') return true;
  if (kind === 'VP8L') return b[20] === 0x2f && !((b[24] >> 4) & 1);
  // (the extended kind says what it carries: a colour profile 0x20, alpha 0x10, EXIF 0x08, more frames than one 0x02)
  if (kind === 'VP8X') return !(b[20] & 0x3a);
  return false;
}

/**
 * What unpacks a full-size model's pictures, in place of the model loader's own (2026-10-12). The loader's asks the
 * browser for each with two wishes (alpha left as it is, colours left as they are), and a picture asked for with
 * any wish at all is copied whole by the browser, on the page's own thread, as it is handed over: 18 ms for one of
 * four thousand pixels a side, after the unpacking itself was done elsewhere, and two or three of those between two
 * frames was a frame lost. Asked for with no wish it is handed over as it was unpacked, in half a millisecond. For
 * a picture that has no alpha and no colour profile the wishes change nothing (measured: the same bytes on the
 * card), so those are asked for plainly; the few that have either are asked for as before.
 */
/** as much of the model loader's workings as is reached into (three r186: GLTFParser) */
type SharpParser = {
  textureLoader: unknown;
  json: { images?: { bufferView?: number; mimeType?: string; extras?: unknown }[]; bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; extensions?: unknown }[] };
  sourceCache: Record<number, Promise<THREE.Texture> | undefined>;
  getDependency(kind: 'buffer', index: number): Promise<ArrayBuffer>;
  loadImageSource(index: number, loader: unknown): Promise<THREE.Texture>;
};

const sharpPictures = {
  isImageBitmapLoader: true,
  load(url: string, onLoad: (picture: ImageBitmap) => void, _onProgress: unknown, onError: (err: unknown) => void) {
    fetch(url)
      .then((r) => r.blob())
      .then(async (file) => ((await plainPicture(file)) ? createImageBitmap(file) : createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })))
      .then(onLoad, onError);
  },
};

/**
 * The world's own pictures (its ground, walls, bark, leaves) unpacked as they arrive, not as they are first drawn
 * (2026-10-12). They came as image elements, and an image element is unpacked by the browser at the moment it is
 * first put on the graphics card, on the page's own thread: 15 to 45 ms for each, three to a surface, so the first
 * sight of every kind of wall and ground in the game was a frame or two lost. Unpacked beforehand on another
 * thread, each is a millisecond and a half to put on. The same bytes reach the card (read back and compared, the
 * leaves with their alpha among them): the picture is turned over as it is unpacked instead of as it is put on.
 * Only where that has been measured: the Chrome family, on a computer.
 */
const UNPACK_AHEAD = !TOUCH && typeof createImageBitmap === 'function' && typeof navigator !== 'undefined' && /Chrome\//.test(navigator.userAgent);

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

/** every picture these materials are painted with, capped */
async function shrinkPaints(mats: Iterable<unknown>, cap: Cap) {
  const seen = new Set<unknown>();
  const jobs: Promise<void>[] = [];
  for (const mat of mats) {
    for (const [slot, kind] of SLOTS) {
      const t = (mat as Record<string, THREE.Texture | null>)[slot];
      if (!t || seen.has(t.source)) continue;
      seen.add(t.source);
      jobs.push(shrink(t, cap[kind]));
    }
  }
  await Promise.all(jobs);
}

/** every picture a model came with, capped (see PHONE_CAP) */
async function shrinkModel<T extends { scene: THREE.Object3D }>(g: T, cap: Cap): Promise<T> {
  const mats: unknown[] = [];
  g.scene.traverse((o) => mats.push(...paints(o)));
  await shrinkPaints(mats, cap);
  return g;
}

/** how many times a file is asked for before it is given up */
const TRIES = 4;
/** a file that has sent nothing for this long is asked for afresh, milliseconds: a phone's line goes quiet without ever saying it has dropped */
const QUIET = 25000;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// (the server imports this module too, where there is no Vite environment)
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

/** Central loader with caching + progress reporting for the loading screen. */
/**
 * One sharp picture put in its place a frame (see `sharpen`). Each was put in as its last strip went in, and a thing's
 * pictures finish together: the fort's thirteen were first drawn with in one frame, each a picture the card had to make
 * ready for its first use, 106 ms of the card's in that frame (2026-10-18, the research session's fourth round).
 */
const swaps: (() => void)[] = [];
let swapping = false;
function oneAFrame(): Promise<void> {
  return new Promise((done) => {
    swaps.push(done);
    if (swapping) return;
    swapping = true;
    const tick = () => {
      swaps.shift()?.();
      if (swaps.length) requestAnimationFrame(tick);
      else swapping = false;
    };
    requestAnimationFrame(tick);
  });
}

export class Assets {
  manifest!: Manifest;
  trees!: Record<string, TreeEntry>;
  readonly gltf = new GLTFLoader();
  /** reads a model's file for what it is painted with and nothing else: its shapes and its movements are left packed (see `holdSharp`) */
  private paint = new GLTFLoader();
  private img = new THREE.ImageLoader();
  readonly hdr = new HDRLoader();
  private models = new Map<string, Promise<GLTF>>();
  private textures = new Map<string, THREE.Texture>();
  private pending = 0;
  private done = 0;
  onProgress: Progress = () => {};
  maxAnisotropy = 8;

  constructor() {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.paint.setMeshoptDecoder(MeshoptDecoder);
    this.paint.register((parser) => {
      // (on a phone the pictures are made smaller as they are read, which is its own asking: left as it was)
      if (TOUCH) return { name: 'ZONA_sharp_pictures' };
      const p = parser as unknown as SharpParser;
      p.textureLoader = sharpPictures;
      // The loader's own way to a picture inside a model's file is: copy its bytes out of the file, wrap the copy
      // as a file of its own (a second copy), give that an address, and fetch the address (a third, and a trip
      // through the browser's network code). For a model of fifteen megabytes that was 25 to 45 ms in one go, on
      // the page's own thread. Here the bytes are wrapped where they lie, once, a picture to a frame's spare time.
      const itsOwn = p.loadImageSource.bind(p);
      p.loadImageSource = (index, loader) => {
        const def = p.json.images?.[index];
        const view = def?.bufferView !== undefined ? p.json.bufferViews?.[def.bufferView] : undefined;
        // (bytes that are packed some way of their own are left to the loader, which knows how)
        if (!def || !view || view.extensions) return itsOwn(index, loader);
        const had = p.sourceCache[index];
        if (had !== undefined) return had.then((t) => t.clone());
        const made = p.getDependency('buffer', view.buffer).then(async (bin) => {
          await breathe();
          const file = new Blob([new Uint8Array(bin, view.byteOffset ?? 0, view.byteLength)], { type: def.mimeType });
          const picture = (await plainPicture(file)) ? await createImageBitmap(file) : await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          const t = new THREE.Texture(picture);
          t.needsUpdate = true;
          if (def.extras && typeof def.extras === 'object') Object.assign(t.userData, def.extras);
          t.userData.mimeType = def.mimeType;
          return t;
        });
        p.sourceCache[index] = made;
        return made;
      };
      return { name: 'ZONA_sharp_pictures' };
    });
    this.paint.register(() => ({ name: 'ZONA_paint_only', loadMesh: () => Promise.resolve(new THREE.Group()), loadAnimation: () => Promise.resolve(new THREE.AnimationClip('', 0, [])) }) as never);
  }

  async init() {
    // Always ask the server for the current asset list: a browser holding last week's copy
    // would not know about models added since, and the game would fail to start.
    const list = (name: string) => this.again(() => fetch(`${BASE}assets/${name}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} for ${name}`)))));
    const [m, t, v] = await Promise.all([
      list('manifest.json'),
      list('trees/trees.json'),
      // (which version of each file this is: a build that has none is as it was, every file marked with the day the lot was made)
      list('versions.json').catch(() => ({})),
    ]);
    this.manifest = m;
    this.trees = t;
    this.versions = v;
    this.version = String(m.generated ?? '').replace(/\D/g, '').slice(0, 14);
    for (const e of Object.values(this.manifest.models)) {
      this.far.add(e.url);
      for (const l of e.lods) this.far.add(l.url);
    }
  }
  /** the files of the things that are made sharper when they are near (see PHONE_FAR) */
  private far = new Set<string>();

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

  /** what is sent for when the game is up, and not before (see `later`); null once it is up */
  private putOff: (() => void)[] | null = [];

  /**
   * A thing nobody needs at the loading screen, because it stands where nobody starts, is sent for when the game is
   * up (at once, if it is up already): so the loading screen neither waits for it nor shares the line with it.
   */
  later(job: () => void) {
    if (this.putOff) this.putOff.push(job);
    else job();
  }

  /** The game is up: what was put off is sent for now. */
  up() {
    const jobs = this.putOff ?? [];
    this.putOff = null;
    for (const job of jobs) job();
  }

  /** Resolves once every request issued so far has finished. */
  idle(): Promise<void> {
    if (this.done === this.pending) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  /** changes whenever the assets are rebuilt: what a file is marked with if nothing says which version of it this is */
  private version = '';
  /**
   * Which version of each file this is, by what is in it (the build works it out: see vite.config.ts). A file is
   * kept by the browser for a year under its address, and its address has its version in it: so a file that has
   * not changed since the last time somebody played is not fetched again, and one that has is. (Every file used to
   * be marked with the day the lot was last made, and every update that touched one model had everybody fetch all
   * of them again.)
   */
  private versions: Record<string, string> = {};

  url(rel: string) {
    const v = this.versions[rel] ?? this.version;
    return `${BASE}${rel}${v ? `?v=${v}` : ''}`;
  }

  /** which version of a file this is, by what is in it ('' where the build did not say: then nothing made from it can be told to be current) */
  stamp(rel: string) {
    return this.versions[rel] ?? '';
  }

  /** bytes that have come over the wire so far (whoever watches the loading asks: it is how a slow line is told from a dead one) */
  received = 0;

  /** something asked for again if it fails: a phone's line drops a request now and then, and one file not had was the whole game not started */
  private async again<T>(ask: () => Promise<T>): Promise<T> {
    for (let go = 0; ; go++) {
      try {
        return await ask();
      } catch (e) {
        if (go >= TRIES - 1) throw e;
        await pause(700 * (go + 1));
      }
    }
  }

  /** A file's bytes. Asked for again if the line drops, or if it goes quiet for a long while without saying so. */
  private bytes(rel: string): Promise<ArrayBuffer> {
    return this.again(async () => {
      const stop = new AbortController();
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const alive = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => stop.abort(), QUIET);
      };
      try {
        alive();
        const res = await fetch(this.url(rel), { signal: stop.signal });
        if (!res.ok) throw new Error(`${res.status} for ${rel}`);
        if (!res.body) {
          const all = await res.arrayBuffer();
          this.received += all.byteLength;
          return all;
        }
        const from = res.body.getReader();
        const parts: Uint8Array[] = [];
        let n = 0;
        for (;;) {
          const { done, value } = await from.read();
          if (done) break;
          alive();
          parts.push(value);
          n += value.byteLength;
          this.received += value.byteLength;
        }
        const all = new Uint8Array(n);
        let at = 0;
        for (const p of parts) {
          all.set(p, at);
          at += p.byteLength;
        }
        return all.buffer;
      } finally {
        clearTimeout(quiet);
      }
    });
  }

  /**
   * On a phone, so many model files are unpacked at a time and no more. Unpacked, a file's pictures are many times
   * the size of the file, and they are all there at once until they have been made smaller: every file in the game
   * unpacked together was more than the page was allowed, before a single thing had been drawn.
   */
  private free = TOUCH ? (LEAN ? 1 : 2) : 1e9;
  private line: (() => void)[] = [];
  private async turn<T>(work: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((go) => this.line.push(go));
    try {
      return await work();
    } finally {
      const next = this.line.shift();
      if (next) next();
      else this.free++;
    }
  }

  loadGLTF(url: string): Promise<GLTF> {
    let p = this.models.get(url);
    if (!p) {
      const file = this.bytes(this.leanOf(url)).then((data) =>
        this.turn(async () => {
          const g = await this.gltf.parseAsync(data, '');
          // (on a phone its pictures are made small before anything is drawn with them: see PHONE_FAR)
          if (TOUCH) return shrinkModel(g, this.far.has(url) ? PHONE_FAR : PHONE_BODY);
          // (and on a computer to DESK_CAP: kept small in the page, so that a picture taken off the card can be put back)
          if (DESK && !this.allSharp) return shrinkModel(g, DESK_CAP);
          // (its pictures are let go of here once they are on the card: see `thin`)
          if (!this.kept.has(url)) g.scene.traverse((o) => paints(o).forEach((mat) => MAPS.forEach((slot) => mat[slot] && thin(mat[slot]!))));
          return g;
        }),
      );
      p = this.track(file, url.split('/').pop()!);
      this.models.set(url, p);
    }
    return p;
  }

  /** development: the files themselves, as before the copies, to compare (`?whole`; progress/lean/proof.js) */
  whole = typeof location !== 'undefined' && new URLSearchParams(location.search).has('whole');

  /** a computer's copy of a model's file, where there is one made from the file as it is now (see LEAN_DIR) */
  private leanOf(url: string) {
    const v = this.versions[url];
    if (!DESK || this.allSharp || this.whole || !v || !url.startsWith('assets/') || !url.endsWith('.glb')) return url;
    const lean = `${LEAN_DIR}${url.slice('assets/'.length, -'.glb'.length)}.${v}.glb`;
    return this.versions[lean] ? lean : url;
  }

  /** a model whose pictures are read again after they have been drawn with (one that is repainted for another thing made of it): they are not let go of */
  keepPictures(id: string) {
    const e = this.manifest.models[id];
    if (e) this.kept.add(e.url);
  }
  private kept = new Set<string>();

  // ------------------------------------------------------------------ pictures at the size they came, for what is close

  private sharp = new Map<string, { users: number; mats: Promise<Painted[]>; pictures: Set<THREE.Texture>; drop: ReturnType<typeof setTimeout> | null }>();
  private swaps: (() => boolean | Promise<boolean>)[] = [];
  /** the same for what is in the hands or looked at: put on before what is only walked past */
  private firsts: (() => boolean | Promise<boolean>)[] = [];
  private swapping = false;
  /** what puts the big ones on the card a strip at a time: the game's own renderer, once there is one (src/main.ts) */
  strips: Strips | null = null;
  /** a big picture as it came, and the copy of it on the card that is painted with (or that is on its way there) */
  private onCard = new Map<THREE.Texture, Promise<THREE.Texture | null>>();
  private queued = new WeakSet<THREE.Texture>();
  private marked = new WeakSet<object>();
  /** development: every model is loaded as it came, whatever it is for (the inventory's pictures are made so: see scripts/icons.mjs) */
  allSharp = false;

  /** every material of a model that has a copy as it came says which model that is, and which of its materials it is */
  private mark(id: string, g: GLTF): GLTF {
    // (on a phone every model has a sharper copy of itself: its own file, whose pictures were made small as it was read)
    if (this.marked.has(g) || !(TOUCH || this.manifest.models[id]?.hi) || this.allSharp || DESK) return g;
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
   *
   * On a phone the same is done a size down: what is far is drawn with very small pictures (PHONE_FAR), and what
   * is close with the world's own (PHONE_CAP), read again out of the file the browser already has.
   * @param first it is in the hands or being looked at: its pictures go on before those of what is walked past
   * @returns the letting go
   */
  sharpen(root: THREE.Object3D | THREE.Material[], first = false): () => void {
    // (a phone the game has already failed to start on is asked for nothing more than the small pictures: see LEAN)
    if (this.allSharp || LEAN || DESK) return () => {};
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
      void this.holdSharp(id, first).then((full) => {
        if (!live) return;
        for (const mat of mats) {
          const f = full[mat.userData.hi![1]];
          if (!f) continue;
          for (const slot of MAPS) {
            const hi = f[slot];
            if (!mat[slot] || !hi) continue;
            (first ? this.firsts : this.swaps).push(() => {
              const w = this.worn.get(mat);
              if (!w || w.n <= 0 || !mat[slot] || mat[slot] === hi) return false;
              const size = hi.image as { width: number; height: number } | undefined;
              if (this.onCard.has(hi) || (this.strips && size && Math.max(size.width, size.height) > STRIP_OVER)) {
                // (A big one: sent to the card over as many frames as it takes, and painted with when the whole of
                // it is there. Whatever else is painted with the same picture waits for the same sending.)
                let on = this.onCard.get(hi);
                if (!on) {
                  const wanted = () => !hi.userData.gone && (this.worn.get(mat)?.n ?? 0) > 0;
                  on = this.strips!.put(hi, mat[slot]!.anisotropy, wanted).then((card) => {
                    // (the page's copy goes as soon as the card has it; one that was dropped part way is begun again by whoever wants it next)
                    // (not in the frame its last strip went in: giving 64 MB back is four milliseconds of its own)
                    if (card) void Promise.resolve(breathe()).then(() => (hi.image as ImageBitmap | undefined)?.close?.());
                    else if (this.onCard.get(hi) === on) this.onCard.delete(hi);
                    return card;
                  });
                  this.onCard.set(hi, on);
                }
                return on.then(async (card) => {
                  if (!card) return false;
                  await oneAFrame();
                  const w = this.worn.get(mat);
                  if (!w || w.n <= 0 || !mat[slot] || mat[slot] === card) return false;
                  if (!(slot in w.lo)) w.lo[slot] = mat[slot]!;
                  mat[slot] = card;
                  return false;
                });
              }
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
    const next = async () => {
      let wait = false;
      try {
        for (let f; !wait && (f = this.firsts.shift() ?? this.swaps.shift()); ) wait = await f();
      } catch {
        /* one that could not be put on: the world's own is what is seen */
      }
      if (this.firsts.length || this.swaps.length) setTimeout(next, wait ? SHARPEN_EVERY : 0);
      else this.swapping = false;
    };
    void next();
  }

  /**
   * One model's pictures as they came are unpacked at a time, and the next model's not until most of the last one's
   * are on the card. All of a room's at once was every spare thread of the processor unpacking for a second, and a
   * gigabyte of pictures in the page waiting their turn to go on. What is in the hands does not wait behind what is
   * walked past.
   */
  private sharpLine: { first: boolean; go: () => void }[] = [];
  private sharpBusy = false;
  private sharpPoll: ReturnType<typeof setTimeout> | null = null;
  private sharpNext() {
    if (this.sharpBusy || !this.sharpLine.length) return;
    let i = this.sharpLine.findIndex((q) => q.first);
    if (i < 0) {
      if (this.firsts.length + this.swaps.length > SHARP_BACKLOG) {
        this.sharpPoll ??= setTimeout(() => {
          this.sharpPoll = null;
          this.sharpNext();
        }, 60);
        return;
      }
      i = 0;
    }
    this.sharpBusy = true;
    this.sharpLine.splice(i, 1)[0].go();
  }
  private async sharpTurn<T>(first: boolean, work: () => Promise<T>): Promise<T> {
    await new Promise<void>((go) => {
      this.sharpLine.push({ first, go });
      this.sharpNext();
    });
    try {
      return await work();
    } finally {
      this.sharpBusy = false;
      // (a moment on: whoever asked for these has by then put them in the line to go on)
      setTimeout(() => this.sharpNext(), 0);
    }
  }

  /** what a model's own pictures weigh on the graphics card, megabytes */
  sharpCost(id: string) {
    return this.manifest.models[id]?.hiCard ?? 64;
  }

  /** megabytes of the card that everything sharp now has, is about to have, or has not yet given back */
  get sharpMB() {
    let mb = 0;
    for (const id of this.sharp.keys()) mb += this.sharpCost(id);
    return mb;
  }

  private holdSharp(id: string, first = false): Promise<Painted[]> {
    let s = this.sharp.get(id);
    if (!s) {
      const pictures = new Set<THREE.Texture>();
      const entry = this.manifest.models[id];
      const mats = this.bytes(TOUCH ? entry.url : entry.hi!).then((data) =>
        this.sharpTurn(first, () => this.turn(async () => {
          // (only what it is painted with is unpacked: its shapes are in the world already)
          const g = await this.paint.parseAsync(data, '');
          const list = (await g.parser.getDependencies('material')) as unknown as Painted[];
          if (TOUCH) await shrinkPaints(list, PHONE_CAP);
          for (const m of list) for (const slot of MAPS) if (m[slot]) {
            pictures.add(m[slot]!);
            // (these are never taken off the card and put back, only thrown away: the page's copy of each goes as soon as the card has it, whatever its size)
            thin(m[slot]!, 0);
          }
          return list;
        })),
      );
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
      const gone = async () => {
        for (const t of s.pictures) {
          // (and its copy on the card, if it was a big one: when that has come, if it is still on its way)
          t.userData.gone = true;
          const on = this.onCard.get(t);
          this.onCard.delete(t);
          void on?.then((card) => card?.dispose());
          t.dispose();
        }
        // (A picture that was unpacked and never put on is still whole in the page, 64 MB of it, and giving that
        // back is four milliseconds: one to a frame's spare time. A model's ten at once was 45 ms of nothing drawn.)
        for (const t of s.pictures) {
          const img = t.image as ImageBitmap | undefined;
          if (!img?.close || !img.width) continue;
          await breathe();
          img.close();
        }
      };
      void s.mats.then(gone, gone);
    }, KEEP_SHARP * 1000);
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
    const made = (t = new THREE.Texture());
    const again = (go: number) => void (go < TRIES - 1 ? setTimeout(() => ask(go + 1), 700 * (go + 1)) : resolve());
    const ask = (go: number): unknown =>
      UNPACK_AHEAD
        ? fetch(this.url(rel))
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
            // (turned over here if whoever asked for it has not said it is to go on as it lies: see src/game/look.ts)
            .then((file) => createImageBitmap(file, { ...(made.flipY ? { imageOrientation: 'flipY' as const } : {}), premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
            .then(
              (picture) => {
                made.image = picture;
                made.flipY = false;
                // (the page's copy goes when the card has it: nothing puts one of these on a second time)
                thin(made, 0);
                made.needsUpdate = true;
                // (and the card has it now, not in the frame it is first seen in)
                this.strips?.whole(made);
                resolve();
              },
              () => again(go),
            )
        : this.img.load(
        this.url(rel),
        (image) => {
          made.image = image;
          made.needsUpdate = true;
          // (on a phone it is made smaller before it is ever drawn with: see PHONE_CAP)
          void (TOUCH ? shrink(made, PHONE_CAP[opts.srgb ? 'colour' : 'other']).then(resolve, resolve) : resolve());
        },
        undefined,
        // (asked for again before the ground is left without its picture)
        () => void (go < TRIES - 1 ? setTimeout(() => ask(go + 1), 700 * (go + 1)) : resolve()),
      );
    ask(0);
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
      this.bytes(rel).then((b) => createImageBitmap(new Blob([b]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })),
      rel.split('/').pop()!,
    );
  }

  /** @param wait whether the loading screen waits for it (the sky itself is not waited for: see Atmosphere.init) */
  async hdri(rel: string, wait = true): Promise<THREE.DataTexture> {
    const got = this.again(() => this.hdr.loadAsync(this.url(rel)));
    return wait ? this.track(got, rel.split('/').pop()!) : got;
  }
}

export const assets = new Assets();
