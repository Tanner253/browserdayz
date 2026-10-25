// The survivors a player can be, and what they wear over their own skin (the owner, 2026-10-24: "we should make a
// higher quality player model and perhaps even variations"; "those clothes items should be items we bring into the
// game"). Each body is its own file, on the game's skeleton (scripts/survivors.mjs), with no clips: it is put on a
// survivor's own bones by their names, under the suit the character file is drawn in, which is hidden while it is on.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assets } from '../core/assets';
import type { Atmosphere } from '../world/atmosphere';
import { stainPatch, type LookUniforms } from './look';
import { BODY_NAMES, VOICES, bodyFor, pickOf, voiceFor } from '../sim/survivor';

/** the survivors to be picked from, by the number a player's pick is sent as (as DayZ has a few faces to choose from) */
export const BODIES = BODY_NAMES.map((name, n) => ({ name, file: `body_${n}` }));
/** a pick as it may come from anybody: one of BODIES, or none (the suit the game had before them) */
export const bodyOf = (n: unknown): number | null => pickOf(n, BODIES.length);

const KEPT = 'zona.survivor';
/** what this browser keeps of the pick, read once */
let kept: { body?: unknown; voice?: unknown } | null = null;
/** this player's own pick, as this browser keeps it: until they pick, the body their name gives and its voice */
export function chosen(name: string): { body: number; voice: number } {
  if (!kept) {
    try {
      kept = JSON.parse(localStorage.getItem(KEPT) ?? '{}') ?? {};
    } catch {
      /* none kept, or not to be read */
    }
    kept ??= {};
  }
  const body = pickOf(kept.body, BODIES.length) ?? bodyFor(name);
  return { body, voice: pickOf(kept.voice, VOICES.length) ?? voiceFor(body) };
}
/** kept for the next time: a body or a voice picked */
export function choose(name: string, pick: { body?: number; voice?: number }) {
  const now = { ...chosen(name), ...pick };
  kept = now;
  try {
    localStorage.setItem(KEPT, JSON.stringify(now));
  } catch {
    /* not kept: it holds for this visit */
  }
  return now;
}

const files = new Map<string, Promise<GLTF>>();
/** a file read once and kept: every survivor that is that body, or wears that thing, draws the one shape and its pictures */
function load(url: string): Promise<GLTF> {
  let p = files.get(url);
  if (!p) files.set(url, (p = assets.loadGLTF(url)));
  return p;
}
const loadBody = (n: number) => load(`assets/characters/${BODIES[n].file}.glb`);

/**
 * A thing worn as it is drawn on the body (scripts/wear.mjs): its model, the parts of the body it hides (`hides` in
 * src/sim/survivor.ts), and the colour it is in: a colour laid on its cloth, or a camouflage (its tile, in
 * assets/tex/camo/), or neither, as it was drawn.
 */
export interface Worn {
  model: string;
  hides: number;
  /** the parts it is only partly over (a hip under a hem): drawn a little in from the skin, not hidden (see Hidden) */
  shrinks?: number;
  tint?: number;
  camo?: string;
}

/** the camouflages' tiles, each fetched once (mirrored where they repeat, so that no seam shows) */
const camos = new Map<string, THREE.Texture>();
function camoTile(name: string): THREE.Texture {
  let t = camos.get(name);
  if (!t) {
    t = assets.texture(`assets/tex/camo/${name}.webp`);
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    camos.set(name, t);
  }
  return t;
}

/**
 * A thing worn, in its colour. Its picture is made as dark or as light as it is drawn there against how light it is on
 * average (`light`, written by scripts/wear.mjs), times the colour: the folds, seams and wear stay, and the olive is
 * black or white. A camouflage is its tile in place of the one colour, laid on from three sides as the thing rests
 * (so that it lies the same way on every copy, and moves with the cloth).
 */
function clothPatch(shader: Shader, light: number, worn: Worn, space: THREE.Matrix4) {
  if (worn.tint === undefined && !worn.camo) return;
  Object.assign(shader.uniforms, { uTint: { value: new THREE.Color(worn.tint ?? 0xffffff) }, uLight: { value: Math.max(0.02, light) }, tCamo: { value: worn.camo ? camoTile(worn.camo) : null }, uClothSpace: { value: space } });
  const camo = !!worn.camo;
  // (the camouflage laid on in metres, as the thing rests on its first bone: its points are packed, see unitOf)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform mat4 uClothSpace;\nvarying vec3 vCloth;\nvarying vec3 vClothN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = (uClothSpace * vec4(position, 1.0)).xyz;\nvClothN = normalize(mat3(uClothSpace) * normal);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform vec3 uTint;\nuniform float uLight;\n${camo ? 'uniform sampler2D tCamo;\n' : ''}varying vec3 vCloth;\nvarying vec3 vClothN;`)
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float lit = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / uLight;
        vec3 c = uTint;
        ${camo ? `vec3 w = abs(normalize(vClothN)); w = w * w * w; w /= w.x + w.y + w.z;
        vec3 p = vCloth * 2.2;
        c = texture2D(tCamo, p.zy).rgb * w.x + texture2D(tCamo, p.xz).rgb * w.y + texture2D(tCamo, p.xy).rgb * w.z;` : ''}
        diffuseColor.rgb = c * lit;
      }`,
    );
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

type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };
/**
 * A body's paint, told which of its parts are under what is worn (REGION in src/sim/survivor.ts, as one number:
 * `hides`): those are not drawn, so that no skin pokes through cloth however a limb bends.
 */
function regionPatch(shader: Shader, hide: Hidden) {
  Object.assign(shader.uniforms, { uHide: hide.hide, uShrink: hide.shrink, uShrinkBy: hide.by });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float _region;\nflat varying float vRegion;\nuniform int uShrink;\nuniform float uShrinkBy;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = _region;\nif (((uShrink >> int(_region + 0.5)) & 1) != 0) transformed -= normalize(normal) * uShrinkBy;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform int uHide;\nflat varying float vRegion;')
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (((uHide >> int(vRegion + 0.5)) & 1) != 0) discard;');
}

/**
 * What of a body is under what is worn: the parts hidden (`hides`), and the parts only partly under it and drawn a
 * little in from the skin (`shrinks`: a hip under a jacket's hem, which may be wider on another body than the one the
 * jacket was cut on, and would stand out through it), by `by` in the shape's own units (see unitOf).
 */
interface Hidden {
  hide: { value: number };
  shrink: { value: number };
  by: { value: number };
}
/** how far in a part only partly under something worn is drawn, metres */
const SHRINK = 0.022;
/** a shape's own unit, in metres: its points are packed (quantized), and unpacked by its first bone's binding */
const unitOf = (m: THREE.SkinnedMesh) => new THREE.Vector3().setFromMatrixColumn(new THREE.Matrix4().copy(m.skeleton.boneInverses[0]).multiply(m.bindMatrix), 0).length();

/** the suit's shapes that make the person (what a body hides): not the pieces of it that are worn things (gear_*) */
export const SUIT = ['body', 'head', 'pads'];

/**
 * A copy of the character file shown as one of the bodies, with the body's own paint (the sandbox, and the figure a
 * player picks theirs by on the menu): the suit hidden and the body put on its bones.
 */
export async function wearBody(model: THREE.Object3D, n: number, hide = 0): Promise<THREE.SkinnedMesh[]> {
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
    if (!s.isSkinnedMesh) return;
    const mat = (s.material as THREE.Material).clone();
    const m = onto(s, bones, mat);
    // (parts hidden, as if worn over: for looking at where each part ends)
    if (hide) mat.onBeforeCompile = (shader) => regionPatch(shader, { hide: { value: hide }, shrink: { value: 0 }, by: { value: SHRINK / unitOf(m) } });
    out.push(m);
  });
  for (const m of out) into.add(m);
  return out;
}

/** For the tools: things worn put on a copy dressed by wearBody, its skin under them hidden (see Wardrobe.setWorn). */
export async function wearOn(model: THREE.Object3D, body: THREE.SkinnedMesh[], worn: Worn[]) {
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => void ((o as THREE.Bone).isBone && bones.set(o.name, o as THREE.Bone)));
  const hide: Hidden = { hide: { value: worn.reduce((m, w) => m | w.hides, 0) }, shrink: { value: worn.reduce((m, w) => m | (w.shrinks ?? 0), 0) }, by: { value: SHRINK / unitOf(body[0]) } };
  for (const b of body) (b.material as THREE.Material).onBeforeCompile = (shader) => regionPatch(shader, hide);
  for (const w of worn) {
    const gltf = await load(`assets/characters/wear/${w.model}.glb`);
    gltf.scene.traverse((o) => {
      const s = o as THREE.SkinnedMesh;
      if (!s.isSkinnedMesh) return;
      const mat = (s.material as THREE.MeshStandardMaterial).clone();
      const light = (mat.userData.light as number | undefined) ?? 0.4;
      const m = onto(s, bones, mat);
      const space = new THREE.Matrix4().copy(s.skeleton.boneInverses[0]).multiply(s.bindMatrix);
      mat.onBeforeCompile = (shader) => clothPatch(shader, light, w, space);
      mat.customProgramCacheKey = () => `wear|${w.camo ?? w.tint ?? ''}`;
      body[0].parent?.add(m);
    });
    // (its camouflage's tile here before the one picture the tools draw)
    if (w.camo) camoTile(w.camo);
  }
  await assets.idle();
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
  /** which of its parts are under what is worn, not drawn or drawn in a little (see regionPatch) */
  private hide: Hidden = { hide: { value: 0 }, shrink: { value: 0 }, by: { value: 0 } };
  /** what is worn over the skin (see setWorn), as asked for and as drawn */
  private worn: Worn[] = [];
  private wornKey = '[]';
  private wornShown = '';
  private wornShapes: THREE.Object3D[] = [];

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

  /** What is worn over the skin, drawn on the body (a body must be on: on the suit nothing is). */
  setWorn(worn: Worn[]) {
    this.worn = worn;
    this.wornKey = JSON.stringify(worn);
    void this.dress();
  }

  private async dress() {
    const f = this.frame, key = this.wornKey, worn = this.worn, on = this.shown !== null;
    const now = on ? key : '';
    if (!f || now === this.wornShown) return;
    const got = on ? await Promise.all(worn.map((w) => load(`assets/characters/wear/${w.model}.glb`).catch(() => null))) : [];
    // (asked for something else meanwhile, or the body changed: that is seen to instead)
    if (key !== this.wornKey || this.frame !== f || (this.shown !== null) !== on) return;
    for (const s of this.wornShapes) s.removeFromParent();
    this.wornShapes = [];
    this.wornShown = now;
    this.hide.hide.value = this.hide.shrink.value = 0;
    const skin = this.skin;
    got.forEach((gltf, k) => {
      if (!gltf || !skin) return;
      const w = worn[k];
      this.hide.hide.value |= w.hides;
      this.hide.shrink.value |= w.shrinks ?? 0;
      gltf.scene.traverse((o) => {
        const s = o as THREE.SkinnedMesh;
        if (!s.isSkinnedMesh) return;
        const mat = (s.material as THREE.MeshStandardMaterial).clone();
        const light = (mat.userData.light as number | undefined) ?? 0.4;
        // (stained where the body under it is: its points brought into the body's own space, as the suit's pieces are in Avatar.make)
        const space = new THREE.Matrix4().copy(s.skeleton.boneInverses[0]).multiply(s.bindMatrix);
        const at = new THREE.Matrix4().copy(skin.skeleton.boneInverses[0]).multiply(skin.bindMatrix).invert().multiply(space);
        f.atmo.register(
          mat,
          (shader) => {
            stainPatch(shader, f.uniforms, at);
            clothPatch(shader, light, w, space);
          },
          `survivor-wear|${w.camo ? 'camo' : w.tint !== undefined ? 'tint' : 'own'}`,
        );
        const m = onto(s, f.bones, mat);
        m.castShadow = m.receiveShadow = true;
        m.intersectsFrustum = f.inSight;
        m.layers.mask = f.layers();
        f.into.add(m);
        this.wornShapes.push(m);
        if (f.fpBones && f.fpInto) {
          const fp = onto(s, f.fpBones, mat);
          fp.castShadow = false;
          fp.receiveShadow = true;
          fp.frustumCulled = false;
          fp.layers.set(f.fpLayer);
          f.fpInto.add(fp);
          this.wornShapes.push(fp);
        }
      });
    });
    if (this.wornShapes.length) f.dressed(this.wornShapes);
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
    if (!src.length) return void this.dress();
    for (const s of src) {
      // its own paint, stained where this survivor is hurt (measured in its own shape's space: see `rest`)
      const mat = (s.material as THREE.MeshStandardMaterial).clone();
      const at = new THREE.Matrix4();
      f.atmo.register(
        mat,
        (shader) => {
          stainPatch(shader, f.uniforms, at);
          regionPatch(shader, this.hide);
        },
        'survivor-body',
      );
      const m = onto(s, f.bones, mat);
      m.castShadow = m.receiveShadow = true;
      m.intersectsFrustum = f.inSight;
      m.layers.mask = f.layers();
      f.into.add(m);
      this.shapes.push(m);
      this.skin ??= m;
      this.hide.by.value = SHRINK / unitOf(m);
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
    // (what is worn is put on again over the new body: its stains are measured in that body's space)
    this.wornShown = '';
    void this.dress();
  }
}
