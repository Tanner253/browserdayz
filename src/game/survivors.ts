// The survivors a player can be, and what they wear over their own skin (the owner, 2026-10-24: "we should make a
// higher quality player model and perhaps even variations"; "those clothes items should be items we bring into the
// game"). Each body is its own file, on the game's skeleton (scripts/survivors.mjs), with no clips: it is put on a
// survivor's own bones by their names, under the suit the character file is drawn in, which is hidden while it is on.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assets } from '../core/assets';
import type { Atmosphere } from '../world/atmosphere';
import { stainPatch, type LookUniforms } from './look';

/** the survivors to be picked from, by the number a player's pick is sent as (as DayZ has a few faces to choose from) */
export const BODIES = [
  { name: 'Mikhail', file: 'body_0' },
  { name: 'Pavel', file: 'body_1' },
  { name: 'Anya', file: 'body_2' },
  { name: 'Grigori', file: 'body_3' },
] as const;
/** a pick as it may come from anybody: one of BODIES, or none (the suit the game had before them) */
export const bodyOf = (n: unknown): number | null => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < BODIES.length ? (n as number) : null);

const files = new Map<string, Promise<GLTF>>();
/** a body's file, read once and kept: every survivor that is that body draws the one shape and its pictures */
function loadBody(n: number): Promise<GLTF> {
  const f = BODIES[n].file;
  let p = files.get(f);
  if (!p) files.set(f, (p = assets.loadGLTF(`assets/characters/${f}.glb`)));
  return p;
}

/** what a survivor is made of that the wardrobe works with (Avatar.make hands it over) */
export interface Frame {
  /** the skeleton that is drawn, and the copy that is the first-person body (headless), each by its bones' names */
  bones: Map<string, THREE.Bone>;
  fpBones: Map<string, THREE.Bone> | null;
  /** what is drawn of the suit (hidden while a body is on), in the drawn model and in the first-person copy */
  suit: THREE.Object3D[];
  /** the same, in the first-person copy (its body shape: nothing else of it is drawn) */
  fpSuit: THREE.Object3D[];
  /** where a body's shapes go: beside the suit's, in each */
  into: THREE.Object3D;
  fpInto: THREE.Object3D | null;
  atmo: Atmosphere;
  uniforms: LookUniforms;
  /** the suit's body shape, whose space the wounds are measured in */
  ref: THREE.SkinnedMesh;
  layers: () => number;
  fpLayer: number;
  /** whether a body is in sight, judged by a ball round its hips (see Avatar.make) */
  inSight: THREE.SkinnedMesh['intersectsFrustum'];
  /** told of what was put on, so that it is made ready before it is drawn (Avatar.onDressed) */
  dressed: (parts: THREE.Object3D[]) => void;
}

/** A shape of a body file, on another skeleton's bones of the same names, sharing its geometry and its paint. */
function onto(src: THREE.SkinnedMesh, bones: Map<string, THREE.Bone>, material: THREE.Material): THREE.SkinnedMesh {
  const list = src.skeleton.bones.map((b) => bones.get(b.name));
  if (list.some((b) => !b)) throw new Error(`survivors: ${src.name} hangs on a bone the survivor has not got`);
  const m = new THREE.SkinnedMesh(src.geometry, material);
  m.name = src.name;
  m.bind(new THREE.Skeleton(list as THREE.Bone[], src.skeleton.boneInverses), src.bindMatrix);
  return m;
}

/** the suit's shapes that make the person (what a body hides): not the pieces of it that are worn things (gear_*) */
export const SUIT = ['body', 'head', 'pads'];

/**
 * A copy of the character file shown as one of the bodies, with the body's own paint (the sandbox, and the figure a
 * player picks theirs by on the menu): the suit hidden and the body put on its bones.
 */
export async function wearBody(model: THREE.Object3D, n: number): Promise<THREE.SkinnedMesh[]> {
  const gltf = await loadBody(n);
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => void ((o as THREE.Bone).isBone && bones.set(o.name, o as THREE.Bone)));
  const into = model.getObjectByName('body')?.parent ?? model;
  for (const name of SUIT) {
    const o = model.getObjectByName(name);
    if (o) o.visible = false;
  }
  const out: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (s.isSkinnedMesh) out.push(onto(s, bones, s.material as THREE.Material));
  });
  for (const m of out) into.add(m);
  return out;
}

/**
 * Which body a survivor is, put on its bones. Made with the survivor, and told of its body whenever: what is asked for
 * before the survivor is made, or before the file has come, is put on when they are.
 */
export class Wardrobe {
  private frame: Frame | null = null;
  private want: number | null = null;
  private shown: number | null = null;
  private shapes: THREE.Object3D[] = [];
  /** the body's own shape, once one is on: wounds are measured in its space (see Avatar.wound) */
  skin: THREE.SkinnedMesh | null = null;

  attach(frame: Frame) {
    this.frame = frame;
    void this.apply();
  }

  /** @param n one of BODIES, or null for the suit */
  setBody(n: number | null) {
    this.want = bodyOf(n);
    void this.apply();
  }

  get body() {
    return this.want;
  }

  private async apply() {
    const f = this.frame, n = this.want;
    if (!f || n === this.shown) return;
    const gltf = n === null ? null : await loadBody(n).catch(() => null);
    // (asked for something else meanwhile: that is put on instead)
    if (this.want !== n || this.frame !== f) return;
    for (const s of this.shapes) s.removeFromParent();
    this.shapes = [];
    this.skin = null;
    this.shown = n;
    const src: THREE.SkinnedMesh[] = [];
    gltf?.scene.traverse((o) => void ((o as THREE.SkinnedMesh).isSkinnedMesh && src.push(o as THREE.SkinnedMesh)));
    for (const o of [...f.suit, ...f.fpSuit]) o.visible = !src.length;
    if (!src.length) return;
    for (const s of src) {
      // its own paint, stained where this survivor is hurt (measured in its own shape's space: see `rest`)
      const mat = (s.material as THREE.MeshStandardMaterial).clone();
      const at = new THREE.Matrix4();
      f.atmo.register(mat, (shader) => stainPatch(shader, f.uniforms, at), 'survivor-body');
      const m = onto(s, f.bones, mat);
      m.castShadow = m.receiveShadow = true;
      m.intersectsFrustum = f.inSight;
      m.layers.mask = f.layers();
      f.into.add(m);
      this.shapes.push(m);
      this.skin ??= m;
      at.identity();
      if (f.fpBones && f.fpInto) {
        const fp = onto(s, f.fpBones, mat);
        fp.castShadow = false;
        fp.receiveShadow = true;
        fp.frustumCulled = false;
        fp.layers.set(f.fpLayer);
        f.fpInto.add(fp);
        this.shapes.push(fp);
      }
    }
    f.dressed(this.shapes);
  }
}
