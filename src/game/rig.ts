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
  } else {
    c.metalness = Math.min(c.metalness, 0.6);
    c.color.setScalar(1.5);
    c.envMapIntensity = 1.5;
    // (night sights are a dull dot in daylight, not a lamp)
    if (c.emissiveMap) c.emissiveIntensity = 0.22;
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
