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
// What is readied again every time it is shown (another player's gun: RemotePlayer.readyHeld) is taken off sooner, a
// minute after it was last drawn wherever the eye is: kept until the eye had gone far, every gun seen in somebody's
// hands stayed on the card for the session, a gigabyte and more of them (2026-10-21, the owner: "after playing for a
// little bit ... my vram got maxed and throttled again"). Never what the player carries (`wanted`).

import * as THREE from 'three';

/** not drawn with for this long (ms), four times longer each time a picture has been taken off and has come back ... */
const IDLE_MS = 20_000;
/** ... and last drawn with this far from where the eye is now (metres) */
const FAR_M = 750;
/** a picture that comes back by being readied, not drawn with for this long (ms), wherever the eye is (four times longer each time it has come back) */
const READIED_IDLE_MS = 60_000;
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

/**
 * Every part of a thing, but what is put away under something marked `onlyShown` (another player's gun: every part
 * that could be fitted hangs on it, put away, and the gun is made again for whatever is fitted, so what is put away is
 * never shown). The renderer's look ahead and this keep's look over the world go by it.
 */
export function walkShown(o: THREE.Object3D, fn: (o: THREE.Object3D) => void, only = false) {
  only ||= o.userData.onlyShown === true;
  if (only && !o.visible) return;
  fn(o);
  for (const c of o.children) walkShown(c, fn, only);
}

/** every picture a thing is painted with (`shown`: of what is shown of it) */
function picturesOf(root: THREE.Object3D, shown: boolean): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  root[shown ? 'traverseVisible' : 'traverse']((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) for (const v of Object.values(mat)) {
      const t = v as THREE.Texture | null;
      if (t && t.isTexture === true && !t.isRenderTargetTexture) out.push(t);
    }
  });
  return out;
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
  /** pictures that are readied (and so sent again) every time what has them is shown: see `comeBack` */
  private readied = new WeakSet<Src>();
  /** what must stay on the card whatever: set by the game (the guns the player carries, drawn at once when taken up) */
  wanted: () => Iterable<THREE.Object3D> = () => [];
  /** how what is wanted is put on the card ahead, when any of its pictures are not (set by the renderer: Renderer.send) */
  sendAhead: ((root: THREE.Object3D) => Promise<void>) | null = null;
  private sendingAhead = new WeakSet<THREE.Object3D>();
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
    walkShown(root, (o) => {
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
    const keep = new Set<Src>();
    for (const root of this.wanted()) {
      for (const t of picturesOf(root, false)) keep.add(t.source);
      // (a gun taken up is drawn at once: its pictures go on as soon as it is carried, not in the frame it comes up in)
      if (this.sendAhead && !this.sendingAhead.has(root) && this.offCard(root)) {
        this.sendingAhead.add(root);
        void this.sendAhead(root).finally(() => this.sendingAhead.delete(root));
      }
    }
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
      const back = 4 ** (this.offTimes.get(src) ?? 0), idle = now - s.at;
      const done = d > FAR_M ? idle > IDLE_MS * back : this.readied.has(src) && idle > READIED_IDLE_MS * back;
      if (done && this.nearestWith(src) === Infinity && !keep.has(src) && goesBack(src)) far.push([src, s, Math.max(d, FAR_M)]);
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

  /** a thing readied (and so its pictures sent again) every time it is shown: its pictures may go a minute after it is last drawn (`READIED_IDLE_MS`) */
  comeBack(root: THREE.Object3D) {
    for (const t of picturesOf(root, true)) this.readied.add(t.source);
  }

  /** whether any picture of this thing that could be on the card is not (taken off since it was readied) */
  offCard(root: THREE.Object3D): boolean {
    let off = false;
    walkShown(root, (o) => {
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
