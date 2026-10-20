// Pictures taken off the graphics card that nothing in the world uses any more (2026-10-20, the owner: the card's
// memory at "7.4 of 8 GB — how do we reduce this?"). Every picture ever sent stayed there: 3.6 GB of them after a
// minute's flight east from the coast, a third of it the pictures of loot kinds readied as each came near (their
// models are kept, and nothing in the world draws with them once that loot is behind) and of things gone from the
// world. A picture is taken off when no thing in either scene has it (as of the last whole look over them, made a
// little every frame with Renderer.tend), nothing has drawn with it for a while, and the eye is far from where it was
// last drawn with. Taking off what the world still holds, only far behind, was tried: those were the near trees' and
// the like, with copies everywhere, sent again at once and drawn again in the frame (a flight east 70 -> 41 fps).
// Only a picture whose image the page still has is taken off (a big one's is let go once it is on the card: see `thin`
// in assets.ts), so that it can go back: by `ready` for whatever is readied (a loot kind's model: ItemModels.cold), by
// the look ahead for a thing put back in the world, or as it is first drawn again, as a thing new to the game is.

import * as THREE from 'three';

/** not drawn with for this long (ms), four times longer each time a picture has been taken off and has come back ... */
const IDLE_MS = 20_000;
/** ... and last drawn with this far from where the eye is now (metres) */
const FAR_M = 750;
/** nothing is taken off while the card holds less than this of pictures (MB): only a long way travelled takes any off */
const FLOOR_MB = 1024;
/** looked over this often (ms) */
const EVERY_MS = 1000;

type Seen = { last: number; at: number; x: number; z: number; textures: Set<THREE.Texture>; mb: number };
type Src = THREE.Texture['source'];
type Stamped = THREE.Texture & { _kf?: number };
type Painted = THREE.Material & { _kp?: number; _ks?: Src[] };
const _c = new THREE.Vector3();

/**
 * How near the eye anything of this thing is, metres, never more than it is: a set that knows where its copies are says
 * (LodSet.nearest); a list of copies that does not is taken to be here; anything else, by the ball round its shape.
 */
function nearOf(m: THREE.Mesh, eye: THREE.Vector3): number {
  const knows = (m.userData as { nearest?: (eye: THREE.Vector3, within: number) => number }).nearest;
  if (knows) return knows(eye, 2000);
  if ((m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return 0;
  const g = m.geometry as THREE.BufferGeometry | undefined;
  if (!g) return 0;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const s = g.boundingSphere!;
  return Math.max(0, _c.copy(s.center).applyMatrix4(m.matrixWorld).distanceTo(eye) - s.radius * m.matrixWorld.getMaxScaleOnAxis());
}

/** what one picture holds on the card, mipmaps and all (MB) */
export function cardMb(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | null;
  const was = t.userData?.was as [number, number] | undefined;
  const w = img?.width || was?.[0] || 0, h = img?.height || was?.[1] || 0;
  return (w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3)) / 1e6;
}

/** a picture whose image the page still has, to be put on the card again */
const goesBack = (src: Src) => {
  const d = src.data as unknown;
  if (typeof ImageBitmap !== 'undefined' && d instanceof ImageBitmap) return d.width > 0;
  return typeof HTMLImageElement !== 'undefined' && d instanceof HTMLImageElement && d.complete && d.naturalWidth > 0;
};

export class CardKeep {
  /** every picture three has bound, by its source (copies of a picture are one picture on the card: three r186) */
  private seen = new Map<Src, Seen>();
  private frame = 0;
  private swept = 0;
  private sweptAt = 0;
  /** the pictures things in the scenes have: as of the last whole look over them, and so far in this one */
  private held = new Map<Src, number>();
  private holding = new Map<Src, number>();
  private pass = 0;
  /** how many times each picture has been taken off */
  private offTimes = new WeakMap<Src, number>();
  /** three's own look at a thing's state on the card, without counting it as drawn with */
  readonly peek: (o: object) => { __webglTexture?: unknown };
  /** what is on the card as of the last look, and what has been taken off since the game began (and come back) */
  readonly now = { pictures: 0, mb: 0 };
  readonly off = { pictures: 0, mb: 0, back: 0 };

  /** @param gone told of every picture taken off (its look ahead forgets it was sent) */
  constructor(renderer: THREE.WebGLRenderer, private eye: THREE.Vector3, private gone: (t: THREE.Texture) => void) {
    const props = renderer.properties as unknown as { get(o: object): Record<string, unknown> };
    const get = props.get;
    this.peek = get;
    // (Whatever three draws with or puts on the card it asks this for, once per picture per drawing at least: the
    // first ask in a frame marks the picture drawn with.)
    props.get = (o: object) => {
      const t = o as Stamped;
      if (t.isTexture === true && t._kf !== this.frame && t.isRenderTargetTexture !== true) this.saw(t);
      return get(o);
    };
  }

  private saw(t: Stamped) {
    t._kf = this.frame;
    let s = this.seen.get(t.source);
    if (!s) {
      this.seen.set(t.source, (s = { last: 0, at: performance.now(), x: this.eye.x, z: this.eye.z, textures: new Set(), mb: cardMb(t) }));
      if (this.offTimes.has(t.source)) this.off.back++;
    }
    s.textures.add(t);
    s.last = this.frame;
  }

  /** a part of a scene looked over (Renderer.tend): the pictures of what is in it are held, and how near the eye the nearest thing with each is */
  look(root: THREE.Object3D) {
    const pass = this.pass, eye = this.eye;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as Painted | Painted[] | undefined;
      if (!m) return;
      const d = nearOf(o as THREE.Mesh, eye);
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (mat._kp !== pass) {
          mat._kp = pass;
          mat._ks = [];
          for (const v of Object.values(mat)) {
            const t = v as THREE.Texture | null;
            if (t && t.isTexture === true) mat._ks.push(t.source);
          }
        }
        for (const src of mat._ks!) {
          const was = this.holding.get(src);
          if (was === undefined || d < was) this.holding.set(src, d);
        }
      }
    });
  }

  /** a whole look over the scenes is done */
  passed() {
    this.held = this.holding;
    this.holding = new Map();
    this.pass++;
  }

  /** how near the eye the nearest thing in the scenes with this picture is, as last looked (Infinity: nothing has it) */
  nearestWith(src: Src): number {
    return Math.min(this.held.get(src) ?? Infinity, this.holding.get(src) ?? Infinity);
  }

  /** once a frame, before it is drawn */
  tick() {
    this.frame++;
    const now = performance.now();
    if (now - this.sweptAt < EVERY_MS) return;
    this.sweptAt = now;
    const ex = this.eye.x, ez = this.eye.z;
    let total = 0, pictures = 0;
    const far: [Src, Seen, number][] = [];
    for (const [src, s] of this.seen) {
      // (drawn with since the last look: where the eye is now is where it was last wanted)
      if (s.last > this.swept) {
        s.at = now;
        s.x = ex;
        s.z = ez;
      }
      let on = false;
      for (const t of s.textures) if (this.peek(t).__webglTexture !== undefined) on = true;
      // (let go of by whoever had it: nothing to keep)
      if (!on) {
        this.seen.delete(src);
        continue;
      }
      total += s.mb;
      pictures++;
      const d = Math.hypot(ex - s.x, ez - s.z);
      if (d > FAR_M && this.nearestWith(src) === Infinity && now - s.at > IDLE_MS * 4 ** (this.offTimes.get(src) ?? 0) && goesBack(src)) far.push([src, s, d]);
    }
    this.swept = this.frame;
    this.now.pictures = pictures;
    this.now.mb = Math.round(total);
    if (import.meta.env.DEV && (globalThis as { __noKeep?: boolean }).__noKeep) return;
    // (the farthest first, until the card holds no more than the floor)
    if (total <= FLOOR_MB || !far.length) return;
    far.sort((a, b) => b[2] - a[2]);
    for (const [src, s] of far) {
      if (total <= FLOOR_MB) break;
      for (const t of s.textures) {
        t.dispose();
        this.gone(t);
      }
      this.seen.delete(src);
      this.offTimes.set(src, (this.offTimes.get(src) ?? 0) + 1);
      total -= s.mb;
      this.off.pictures++;
      this.off.mb += s.mb;
    }
    this.now.pictures = this.seen.size;
    this.now.mb = Math.round(total);
  }

  /** whether any picture of this thing that could be on the card is not (taken off since it was readied) */
  offCard(root: THREE.Object3D): boolean {
    let off = false;
    root.traverse((o) => {
      if (off) return;
      const m = (o as THREE.Mesh).material;
      for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) {
        for (const v of Object.values(mat)) {
          const t = v as THREE.Texture | null;
          if (t && t.isTexture && !t.isRenderTargetTexture && goesBack(t.source) && this.peek(t).__webglTexture === undefined) off = true;
        }
      }
    });
    return off;
  }
}
