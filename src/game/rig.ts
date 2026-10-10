// A weapon pack in the hands of whoever holds the gun: the pack's own arms and its own gun,
// moved by its own animation. (Every other gun in the game is a still model with the arms
// reached out to it; these came with hands that already know what to do.)
//
// A pack has one long animation with every movement in it one after another. The asset
// pipeline says where each begins and ends (scripts/assets.config.mjs, WEAPON_PACKS); here a
// movement is asked for by name, and how far through it.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export interface RigInfo {
  fps: number;
  /** movement -> [first frame, last frame] of the long animation */
  clips: Record<string, [number, number]>;
  /** the pack's own space -> the eye's (x right, y up, the muzzle away down -z), metres */
  view: number[];
  /** the pack's own space -> the space of the gun-alone file (x along the barrel, y up, z to its right) */
  frame: number[];
}

/**
 * A weapon pack's material made fit to be seen here. The packs are painted for a studio:
 * gloves and gunmetal close to black, and one pack's arms marked as bare metal, which under
 * this sky is a black cut-out. Cloth and leather are no metal at all and are lifted to where
 * they can be read; steel keeps some of its metal and takes more of the sky. (Changes the
 * material it is given.)
 */
/** two guns that are not painted as the rest are: how much of their paint is kept, how much metal, and how much of the sky they take */
export const LOOK = { eagle: { tint: 0.62, metal: 0.8, sky: 0.85 }, shotgun: { tint: 1.9, metal: 0.5, sky: 1.6 }, sight: { tint: 2.6, metal: 0.4, sky: 1.6 } };

export function liftPack<T extends THREE.Material>(mat: T): T {
  const c = mat as unknown as THREE.MeshStandardMaterial;
  if (/lens/i.test(mat.name)) {
    // the glass of a scope: dark, and a mirror for the sky (it is drawn as a flat disc of putty)
    c.map = null;
    c.color.set(0x0a1016);
    c.metalness = 1;
    c.metalnessMap = null;
    c.roughness = 0.06;
    c.roughnessMap = null;
    c.envMapIntensity = 2.2;
  } else if (/arm/i.test(mat.name)) {
    c.metalness = 0;
    c.metalnessMap = null;
    c.color.setScalar(1.9);
    c.envMapIntensity = 0.7;
  } else if (/^(Slide|MainBody|Magazine)$/.test(mat.name)) {
    // the Desert Eagle is the other way about: bright brushed steel as it comes, which lifted
    // like the dark ones is a white shape. It is left as it was painted, a shade down.
    c.metalness = Math.min(c.metalness, LOOK.eagle.metal);
    c.color.setScalar(LOOK.eagle.tint);
    c.envMapIntensity = LOOK.eagle.sky;
  } else if (/^EOTECH/i.test(mat.name)) {
    // the holographic sight is painted as black as the shotgun: on a pistol it was a black box
    c.metalness = Math.min(c.metalness, LOOK.sight.metal);
    c.color.setScalar(LOOK.sight.tint);
    c.envMapIntensity = LOOK.sight.sky;
  } else if (/^B_M3_/.test(mat.name)) {
    // and the shotgun is painted blacker than any of them: lifted further, or it is a cut-out
    c.metalness = Math.min(c.metalness, LOOK.shotgun.metal);
    c.color.setScalar(LOOK.shotgun.tint);
    c.envMapIntensity = LOOK.shotgun.sky;
  } else {
    c.metalness = Math.min(c.metalness, 0.6);
    c.color.setScalar(1.5);
    c.envMapIntensity = 1.5;
    // (night sights are a dull dot in daylight, not a lamp)
    if (c.emissiveMap) c.emissiveIntensity = 0.22;
  }
  // A pack's paint that is marked as seen through (the shotgun's sight is, for its glass: and its suppressor
  // is painted with the same) is drawn after everything solid and, as it comes, without a word of how far off
  // it is: the suppressor was drawn through by its own barrel, and by any window behind it. It says how far
  // off it is like anything else; what is seen through is still seen through.
  if (c.transparent) {
    c.depthWrite = true;
    c.alphaTest = Math.max(c.alphaTest, 0.02);
  }
  return mat;
}

const _box = new THREE.Box3();

export class WeaponRig {
  /** in the eye's space: x right, y up, the muzzle away down -z, metres */
  readonly root = new THREE.Group();
  private scene: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private length: number;
  /** where each piece is when the gun is simply held */
  private atRest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();

  /** @param paint the material each of the pack's own is drawn with here */
  constructor(gltf: GLTF, private info: RigInfo, paint: (m: THREE.Material) => THREE.Material) {
    this.scene = SkeletonUtils.clone(gltf.scene);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.fromArray(info.view);
    holder.add(this.scene);
    this.root.add(holder);
    const own = new Map<THREE.Material, THREE.Material>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // (hands that swing through a reload leave the box they were measured in)
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      const src = mesh.material as THREE.Material;
      if (!own.has(src)) own.set(src, paint(src));
      mesh.material = own.get(src)!;
    });
    this.mixer = new THREE.AnimationMixer(this.scene);
    const clip = gltf.animations[0];
    this.length = clip.duration;
    this.mixer.clipAction(clip).play();
    this.rest();
    this.scene.traverse((o) => this.atRest.set(o, { p: o.position.clone(), q: o.quaternion.clone() }));
  }

  has(clip: string) {
    return clip in this.info.clips;
  }

  /** how long a movement takes as it was drawn, seconds */
  seconds(clip: string) {
    const [a, b] = this.info.clips[clip];
    return (b - a) / this.info.fps;
  }

  /** Stand in one movement, `k` of the way through it (0..1). */
  pose(clip: string, k: number) {
    const [a, b] = this.info.clips[clip] ?? [0, 0];
    this.mixer.setTime(Math.min(this.length - 1e-4, (a + (b - a) * THREE.MathUtils.clamp(k, 0, 1)) / this.info.fps));
  }

  /** the pose the gun is simply held in */
  rest() {
    this.mixer.setTime(0);
  }

  /** These pieces put back where they are at rest, whatever the movement being played does with them. Call after `pose`. */
  still(names: string[]) {
    for (const name of names) {
      const n = this.node(name);
      const r = n && this.atRest.get(n);
      if (!r) continue;
      n.position.copy(r.p);
      n.quaternion.copy(r.q);
    }
  }

  node(name: string): THREE.Object3D | null {
    return this.scene.getObjectByName(name) ?? null;
  }

  /** a piece and everything under it, there or not */
  show(name: string, on: boolean) {
    const n = this.node(name);
    if (n) n.visible = on;
  }

  /** The material of whatever in the pack is drawn with one whose name matches (its arms, say). */
  material(test: RegExp): THREE.Material | null {
    let found: THREE.Material | null = null;
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).material as THREE.Material) : null;
      if (mat && test.test(mat.name)) found = mat;
    });
    return found;
  }

  /** Everything drawn with a material whose name matches is drawn with this one instead: one pair of sleeves for every gun. */
  repaint(test: RegExp, mat: THREE.Material) {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && test.test((mesh.material as THREE.Material).name)) mesh.material = mat;
    });
  }

  /** The pack's own shapes under these pieces, taken out of the picture (what is hung on them later is not). */
  strip(names: string[]) {
    for (const name of names) {
      this.node(name)?.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.visible = false;
      });
    }
  }

  /**
   * Where a piece is at rest, as a box in the space of `root` (which must not have been moved
   * yet). Only what is seen of it: not the pack's own shape where another gun rides on it, nor
   * anything hung there that is not fitted.
   */
  box(name: string): THREE.Box3 {
    this.rest();
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.node(name)?.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(_box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
    });
    return box;
  }

  /**
   * The middle of a piece's foremost end, in the space box() speaks in: of a gun's body, the
   * mouth of its barrel. (The middle of the box's front face is not it: a rifle's box goes
   * down to the bottom of its grip, and the barrel lies along the top of it.)
   */
  front(name: string, within = 0.01): THREE.Vector3 | null {
    this.rest();
    this.root.updateMatrixWorld(true);
    const pts: number[] = [];
    let z0 = Infinity;
    const v = new THREE.Vector3();
    this.node(name)?.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const P = mesh.geometry.getAttribute('position');
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
        pts.push(v.x, v.y, v.z);
        z0 = Math.min(z0, v.z);
      }
    });
    if (!pts.length) return null;
    const ring = new THREE.Box3();
    for (let i = 0; i < pts.length; i += 3) if (pts[i + 2] < z0 + within) ring.expandByPoint(v.set(pts[i], pts[i + 1], pts[i + 2]));
    return ring.getCenter(new THREE.Vector3()).setZ(z0);
  }

  /**
   * Hang something on one of the pack's pieces, so that it moves as that piece does.
   * @param obj drawn in the space of the gun-alone file (x along the barrel, y up): another gun's slide, a suppressor
   */
  hang(obj: THREE.Object3D, name: string) {
    const n = this.node(name);
    if (!n) return;
    this.rest();
    this.root.updateMatrixWorld(true);
    // the piece in the pack's space, and the gun-alone file's space in the pack's
    const piece = new THREE.Matrix4().copy(this.scene.matrixWorld).invert().multiply(n.matrixWorld);
    const gun = new THREE.Matrix4().fromArray(this.info.frame).invert();
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(piece).invert().multiply(gun);
    holder.add(obj);
    n.add(holder);
  }
}
