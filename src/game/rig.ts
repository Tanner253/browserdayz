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
import { HandsOn } from './hands-on';

export interface RigInfo {
  fps: number;
  /** movement -> [first frame, last frame] of the long animation */
  clips: Record<string, [number, number]>;
  /** the pack's own space -> the eye's (x right, y up, the muzzle away down -z), metres */
  view: number[];
  /** the pack's own space -> the space of the gun-alone file (x along the barrel, y up, z to its right) */
  frame: number[];
  /**
   * Its gun is drawn on the skeleton with the arms. The gun alone was then made from the skeleton as the file
   * has it standing (not as its first movement begins), so what is hung on one of its joints is hung by where
   * that joint stands in the file.
   */
  skinned?: boolean;
  /** where the pack's own camera stands, if it came with one: the eye it was drawn for (the eye's space) */
  eye?: [number, number, number];
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
  } else if (/^Scene_-_Root$/.test(mat.name)) {
    // the Colt is painted as blued steel with its wear in the paint, and walnut on its grip: lifted like the dark
    // ones it was a pale grey pistol. As it came, with a little more of the sky on its steel.
    c.metalness = Math.min(c.metalness, 0.8);
    c.envMapIntensity = 1.25;
  } else if (/^Material_45[79]$/.test(mat.name)) {
    // the submachine gun is painted a mid olive, with its wear and its markings in the paint: lifted like the dark
    // ones it was a flat pale shape with nothing on it. As it came.
    c.envMapIntensity = 1.1;
  } else if (/^knife$/.test(mat.name)) {
    // The combat knife is pale bare steel on a black grip, one paint for both. Bare steel with nothing about it to
    // mirror is a black shape this close to the eye (as the axe's head was): its blade takes the light as worn
    // metal does. Its colour is left as it came: lifted as the dark guns are, pale steel is a white shape.
    c.metalness = Math.min(c.metalness, 0.45);
    c.roughness = Math.max(c.roughness, 0.5);
    c.envMapIntensity = 1.2;
  } else if (/^B_M3_/.test(mat.name)) {
    // and the shotgun is painted blacker than any of them: lifted further, or it is a cut-out
    c.metalness = Math.min(c.metalness, LOOK.shotgun.metal);
    c.color.setScalar(LOOK.shotgun.tint);
    c.envMapIntensity = LOOK.shotgun.sky;
  } else {
    c.metalness = Math.min(c.metalness, 0.6);
    // (A paint that is a picture is lifted by so much. One that is a bare colour and no picture keeps its colour,
    // lifted as much: set to the same number it was white, and a dark magazine hung on a black rifle like a sheet of paper.)
    if (c.map) c.color.setScalar(1.5);
    else c.color.multiplyScalar(1.5);
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
  /** where each piece stands as the file has it, before any movement is played, in the pack's own space (see `skinned`) */
  private asFiled = new Map<THREE.Object3D, THREE.Matrix4>();

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
    this.root.updateMatrixWorld(true);
    const out = new THREE.Matrix4().copy(this.scene.matrixWorld).invert();
    this.scene.traverse((o) => this.asFiled.set(o, new THREE.Matrix4().copy(out).multiply(o.matrixWorld)));
    this.mixer = new THREE.AnimationMixer(this.scene);
    const clip = gltf.animations[0];
    this.length = clip.duration;
    // (what the movements move: by the name of each track, and each thing once)
    for (const t of clip.tracks) this.tracked.add(t.name);
    this.scene.traverse((o) => {
      if (this.tracked.has(`${o.name}.position`) || this.tracked.has(`${o.name}.quaternion`)) this.moved.push({ n: o, p: new THREE.Vector3(), q: new THREE.Quaternion() });
    });
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
    this.unslide();
    const [a, b] = this.info.clips[clip] ?? [0, 0];
    this.mixer.setTime(Math.min(this.length - 1e-4, (a + (b - a) * THREE.MathUtils.clamp(k, 0, 1)) / this.info.fps));
  }

  /** the pose the gun is simply held in */
  rest() {
    this.unslide();
    this.mixer.setTime(0);
  }

  /**
   * What `slide` has added to each piece since it was last stood in a movement: taken off again before the next.
   * (A movement that leaves a piece where it was a moment ago does not put it there again: what plays them writes
   * only what has changed. So a slide held back on a gun standing still was pushed back again every frame, one
   * lock's length each time, until something moved it: an empty pistol's slide flew off backwards and snapped
   * home whenever its holder stopped walking. 2026-10-12.)
   */
  private slid = new Map<THREE.Object3D, THREE.Vector3>();
  private unslide() {
    if (!this.slid.size) return;
    for (const [n, by] of this.slid) n.position.sub(by);
    this.slid.clear();
  }

  private tracked = new Set<string>();
  private moved: { n: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[] = [];

  /**
   * The movement it stands in now, mixed with another: `w` of the way to `clip`, `k` of the way through that one
   * (a walk or a run over the standing still: the packs draw each by itself). Call after `pose`.
   */
  mix(clip: string, k: number, w: number, fast?: { body: string; to: string[] }) {
    if (w <= 0.001 || !(clip in this.info.clips)) return;
    for (const m of this.moved) {
      m.p.copy(m.n.position);
      m.q.copy(m.n.quaternion);
    }
    this.pose(clip, k);
    if (w >= 0.999) return;
    // What is fast to the gun in both movements (its magazine, the hand on its grip) is mixed as it stands ON the
    // gun, not by itself: each has a joint of its own beside the gun's, and two things mixed apart from one
    // another part company on the way (a pistol's magazine came out through its grip as the gun went up for a run).
    const body = fast ? this.moved.find((m) => m.n.name === fast.body) : undefined;
    const held: { m: { n: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }; rel: THREE.Matrix4 }[] = [];
    if (body && fast) {
      const A = _m1.compose(body.p, body.q, body.n.scale).invert(), B = _m2.compose(body.n.position, body.n.quaternion, body.n.scale).invert();
      for (const name of fast.to) {
        const m = this.moved.find((x) => x.n.name === name);
        if (!m || m.n.parent !== body.n.parent) continue;
        // (where it stands on the gun in the one movement and in the other, and between the two)
        _h.compose(m.p, m.q, m.n.scale).premultiply(A).decompose(_p, _q, _s);
        _g.compose(m.n.position, m.n.quaternion, m.n.scale).premultiply(B).decompose(_v1, _q2, _v2);
        held.push({ m, rel: new THREE.Matrix4().compose(_p.lerp(_v1, w), _q.slerp(_q2, w), _s) });
      }
    }
    for (const m of this.moved) {
      m.n.position.lerpVectors(m.p, m.n.position, w);
      m.n.quaternion.copy(m.q.slerp(m.n.quaternion, w));
    }
    if (body) {
      _m1.compose(body.n.position, body.n.quaternion, body.n.scale);
      for (const h of held) h.rel.premultiply(_m1).decompose(h.m.n.position, h.m.n.quaternion, _s);
    }
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

  private hands: HandsOn | null = null;
  /** Our own arms on this pack, posed after its own, which are no longer drawn (./hands-on.ts). */
  wear(arms: GLTF, info: RigInfo, shift: THREE.Vector3, shoulders: Record<'L' | 'R', THREE.Vector3>, hip: THREE.Vector3, paint: (m: THREE.Material) => THREE.Material) {
    this.rest();
    this.root.updateMatrixWorld(true);
    this.hands = new HandsOn(this.scene, this.root, arms, info, shift, shoulders, hip, paint);
  }

  /**
   * One movement played over another for what hangs under these nodes only, `k` of the way through it: one hand and
   * its gun firing while the other stands as it was (the akimbo packs draw both guns firing at once). Call after
   * `pose` and `mix`.
   */
  layer(clip: string, k: number, roots: string[]) {
    const keep = new Map<THREE.Object3D, [THREE.Vector3, THREE.Quaternion]>();
    this.scene.traverse((o) => void keep.set(o, [o.position.clone(), o.quaternion.clone()]));
    this.pose(clip, k);
    const under = new Set<THREE.Object3D>();
    for (const r of roots) this.node(r)?.traverse((o) => void under.add(o));
    for (const [o, [p, q]] of keep) {
      if (under.has(o)) continue;
      o.position.copy(p);
      o.quaternion.copy(q);
    }
  }

  /**
   * Several parts each in a movement of its own over the pack as it stands (a pair's two hands, each at its own moment
   * of its shot): every part's pose is taken in turn, and only then are they all put. One part laid and the next laid
   * after it, a pair fired on the same frame had its right hand in nothing: what plays the movements writes only what
   * has changed since it last wrote, and the right hand's moment was the left's (the owner, 2026-10-18: "when you shoot
   * both submachine guns at the same time the right hand bugs out").
   */
  layers(parts: { clip: string; k: number; roots: string[] }[]) {
    if (!parts.length) return;
    const keep = new Map<THREE.Object3D, [THREE.Vector3, THREE.Quaternion]>();
    this.scene.traverse((o) => void keep.set(o, [o.position.clone(), o.quaternion.clone()]));
    const took = new Map<THREE.Object3D, [THREE.Vector3, THREE.Quaternion]>();
    for (const p of parts) {
      this.pose(p.clip, p.k);
      for (const r of p.roots) this.node(r)?.traverse((o) => void took.set(o, [o.position.clone(), o.quaternion.clone()]));
    }
    for (const [o, [pos, q]] of keep) {
      const t = took.get(o);
      o.position.copy(t ? t[0] : pos);
      o.quaternion.copy(t ? t[1] : q);
    }
  }

  /** Our arms put after the pack's: once the frame's movement is set. */
  follow() {
    this.hands?.follow();
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
  /** @param as the piece whose place it is hung by, where that is not the one it is hung on (a second magazine, drawn as the first is about its own joint) */
  hang(obj: THREE.Object3D, name: string, as = name) {
    const n = this.node(name), by = this.node(as);
    if (!n || !by) return;
    this.rest();
    this.root.updateMatrixWorld(true);
    // the piece in the pack's space, and the gun-alone file's space in the pack's
    const piece = this.info.skinned ? this.asFiled.get(by)!.clone() : new THREE.Matrix4().copy(this.scene.matrixWorld).invert().multiply(by.matrixWorld);
    const gun = new THREE.Matrix4().fromArray(this.info.frame).invert();
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    const base = new THREE.Matrix4().copy(piece).invert().multiply(gun);
    holder.matrix.copy(base).multiply(this.seat);
    holder.add(obj);
    n.add(holder);
    this.hung.push({ holder, base });
  }
  private hung: { holder: THREE.Group; base: THREE.Matrix4 }[] = [];

  /**
   * Where a gun that is not the pack's own sits in the pack's hands: moved (and turned) from where the pack's gun
   * is, in the space of the gun-alone file. Everything hung after this is hung so. (A pistol in hands that were
   * drawn round a bigger gun: its grip is put where that gun's grip is.)
   */
  private seat = new THREE.Matrix4();
  /** @param size how big it is drawn in these hands, of its own size (hands drawn smaller than life hold a gun made the size that fits them) */
  seatAt(move: THREE.Vector3, turn?: THREE.Euler, size = 1) {
    this.seat.compose(move, new THREE.Quaternion().setFromEuler(turn ?? new THREE.Euler()), new THREE.Vector3(size, size, size));
    // (and whatever is hung already is moved with it: a seat is set by eye, with the gun in the hands)
    for (const h of this.hung) h.holder.matrix.copy(h.base).multiply(this.seat);
  }

  /** A piece pushed along the barrel from where the movement being played has it, metres (toward the muzzle: more). Call after `pose`. */
  slide(name: string, by: number) {
    const n = this.node(name);
    if (!n?.parent) return;
    // (along the barrel in the gun-alone file is x: which way that is for this piece's parent, as the file has it standing)
    const along = _v1.set(1, 0, 0).transformDirection(_m1.fromArray(this.info.frame).invert()).transformDirection(_m2.copy(this.asFiled.get(n.parent) ?? _m2.identity()).invert());
    const size = _v2.setFromMatrixScale(_m1.fromArray(this.info.frame)).x * _v3.setFromMatrixScale(this.asFiled.get(n.parent) ?? _m2.identity()).x;
    const add = along.clone().multiplyScalar(by / size);
    n.position.add(add);
    const had = this.slid.get(n);
    if (had) had.add(add);
    else this.slid.set(n, add);
  }

  /** a pack's arm, as its maker's skeleton has it: the upper arm, the forearm, and what the hand hangs on */
  private arm(side: 'L' | 'R') {
    let upper = this.node(side === 'L' ? 'UpArm_L_03' : 'UpArm_R_09'), fore = this.node(side === 'L' ? 'Forearm_L_04' : 'Forearm_R_010');
    let hand: THREE.Object3D | null = null;
    this.scene.traverse((o) => {
      if (!hand && new RegExp(`^IK_Hand_Cntrl_${side}`).test(o.name)) hand = o;
    });
    // (the sniper pack's: a plain chain, the wrist on the end of the forearm, its hand on the wrist: R_arm, R_elbow, R_wrist)
    if (!upper || !fore || !hand) {
      const find = (re: RegExp) => {
        let n: THREE.Object3D | null = null;
        this.scene.traverse((o) => {
          if (!n && re.test(o.name)) n = o;
        });
        return n as THREE.Object3D | null;
      };
      [upper, fore, hand] = [find(new RegExp(`^${side}_arm_\\d+$`)), find(new RegExp(`^${side}_elbow_\\d+$`)), find(new RegExp(`^${side}_wrist_\\d+$`))];
    }
    // (a joint well down the forearm: which way the forearm lies is said by it)
    const tip = this.node(side === 'L' ? 'BoneTwist_01.L_07' : 'BoneTwist_01.R_013') ?? this.node(side === 'L' ? 'BoneTwist_01L_07' : 'BoneTwist_01R_013');
    return upper && fore && hand ? { upper, fore, hand: hand as THREE.Object3D, tip } : null;
  }
  private armLen: Partial<Record<'L' | 'R', [number, number]>> = {};
  private arms: Partial<Record<'L' | 'R', ReturnType<WeaponRig['arm']>>> = {};
  private handAt = new Map<string, THREE.Vector3>();

  /** the gun-alone file's space as it stands in the world this frame, by the joint the gun's body follows */
  private gunSpace(body: THREE.Object3D, out: THREE.Matrix4) {
    return out.copy(body.matrixWorld).multiply(_m1.copy(this.asFiled.get(body) ?? _m1.identity()).invert()).multiply(_m2.fromArray(this.info.frame).invert());
  }

  /**
   * An arm of the pack's brought to where its hand, or its shoulder, is put, when that is not where its maker drew it.
   *
   * The hand: for a gun that is not the one these hands were drawn round (a pistol has nothing out in front for the
   * other hand to hold: it is brought back under the grip). `move` and `turn` are said in the gun's own space (x
   * toward the muzzle, y up, z to its right; metres), from where the hand is when the gun is simply held. The hand
   * is moved by all of that while it is where it rests on the gun, and by less of it the further the movement being
   * played takes it from there (a reload takes it to the magazine and back: it does that as it was drawn).
   *
   * The shoulder: `shoulder` is how far the top of the arm is moved, in the eye's space (x right, y up, -z away;
   * metres). The packs were drawn for a camera of their own; from where the game's eye is, the top of an arm may
   * stand in the corner of the picture. Let down and back, the arm comes up into the picture from under it.
   *
   * Call after `pose`, with the pack where it is drawn this frame.
   * @param body the joint the gun's body follows
   */
  reseat(side: 'L' | 'R', body: string, o: { move?: THREE.Vector3; turn?: THREE.Quaternion; shoulder?: THREE.Vector3; letGo?: [number, number] }) {
    const arm = (this.arms[side] ??= this.arm(side));
    const b = this.node(body);
    if (!arm || !b) return;
    const key = `${side}|${body}`;
    if (!this.handAt.has(key)) {
      // where the hand rests on the gun, in the gun's space (found with the gun simply held: the frame it is found on is drawn as it was)
      this.rest();
      this.root.updateWorldMatrix(true, true);
      this.handAt.set(key, new THREE.Vector3().setFromMatrixPosition(arm.hand.matrixWorld).applyMatrix4(this.gunSpace(b, new THREE.Matrix4()).invert()));
      // (and how long its two bones are: the hand is on the end of the forearm there)
      const s0 = _a.setFromMatrixPosition(arm.upper.matrixWorld), e0 = _b.setFromMatrixPosition(arm.fore.matrixWorld);
      this.armLen[side] = [e0.distanceTo(s0), _v1.setFromMatrixPosition(arm.hand.matrixWorld).distanceTo(e0)];
      return;
    }
    this.root.updateWorldMatrix(true, true);
    const was = _v1.setFromMatrixPosition(arm.hand.matrixWorld);
    const to = _v3.copy(was);
    if (o.move || o.turn) {
      const G = this.gunSpace(b, _g), Gi = _gi.copy(G).invert();
      const letGo = o.letGo ?? [0.03, 0.12];
      const w = 1 - THREE.MathUtils.smoothstep(_v2.copy(was).applyMatrix4(Gi).distanceTo(this.handAt.get(key)!), letGo[0], letGo[1]);
      if (w > 0.001) {
        // the hand, in the gun's space, moved and turned about itself
        const H = _h.copy(Gi).multiply(arm.hand.matrixWorld);
        H.decompose(_p, _q, _s);
        if (o.move) _p.addScaledVector(o.move, w);
        if (o.turn) _q.premultiply(_q2.identity().slerp(o.turn, w));
        H.compose(_p, _q, _s).premultiply(G);
        to.setFromMatrixPosition(H);
        // (set on what it hangs on, in that one's own space; a hand on the end of a plain chain is carried there by the forearm)
        if (arm.hand.parent !== arm.fore) _m1.copy(arm.hand.parent!.matrixWorld).invert().multiply(H).decompose(arm.hand.position, arm.hand.quaternion, arm.hand.scale);
      }
    }
    // the arm after it: the elbow kept to the side it was on, the two bones as long as they were
    const S = _a.setFromMatrixPosition(arm.upper.matrixWorld), E = _b.setFromMatrixPosition(arm.fore.matrixWorld);
    const [up, low] = this.armLen[side] ?? [E.distanceTo(S), was.distanceTo(E)];
    // (which way the forearm lies now: by a joint further down it, not by the hand, which is not on its end once the shoulder has been moved)
    const lies = arm.tip ? _l.setFromMatrixPosition(arm.tip.matrixWorld).sub(E).normalize() : _l.copy(was).sub(E).normalize();
    const S2 = _s2.copy(S);
    if (o.shoulder) {
      // (said in the eye's space, which is the space of `root`: how far that is in the world, and in the space of what the arm hangs on)
      const by = _d.copy(o.shoulder).transformDirection(this.root.matrixWorld).multiplyScalar(o.shoulder.length() * _s.setFromMatrixScale(this.root.matrixWorld).x);
      S2.add(by);
      const rest = this.atRest.get(arm.upper);
      const local = _e.copy(S2).applyMatrix4(_m1.copy(arm.upper.parent!.matrixWorld).invert());
      // (a joint no movement moves stays where it is put: it is put from where it stands at rest, not from where it was put last frame)
      if (rest && !this.tracked.has(`${arm.upper.name}.position`)) {
        const at = _f.copy(rest.p).applyMatrix4(arm.upper.parent!.matrixWorld);
        local.copy(at.add(by)).applyMatrix4(_m1);
        S2.copy(at);
      }
      arm.upper.position.copy(local);
      arm.upper.updateWorldMatrix(false, true);
    }
    const reach = _c.copy(to).sub(S2);
    const d = THREE.MathUtils.clamp(reach.length(), Math.abs(up - low) + 1e-4, up + low - 1e-4);
    reach.normalize();
    const along = (up * up - low * low + d * d) / (2 * d), out = Math.sqrt(Math.max(0, up * up - along * along));
    const pole = _d.copy(E).sub(S);
    pole.addScaledVector(reach, -pole.dot(reach)).normalize();
    const E2 = _e.copy(S2).addScaledVector(reach, along).addScaledVector(pole, out);
    const turnBone = (bone: THREE.Object3D, by: THREE.Quaternion) => {
      const world = bone.getWorldQuaternion(_q3), parent = bone.parent!.getWorldQuaternion(_q4);
      bone.quaternion.copy(parent.invert()).multiply(by).multiply(world);
      bone.updateWorldMatrix(false, true);
    };
    const q1 = _q5.setFromUnitVectors(_f.copy(E).sub(S).normalize(), _g2.copy(E2).sub(S2).normalize());
    // (which way the forearm lies with only the upper arm turned)
    const fore = lies.applyQuaternion(q1).normalize();
    turnBone(arm.upper, q1);
    const E3 = _b.setFromMatrixPosition(arm.fore.matrixWorld);
    turnBone(arm.fore, _q5.setFromUnitVectors(fore, _g2.copy(S2).addScaledVector(reach, d).sub(E3).normalize()));
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _s2 = new THREE.Vector3(), _l = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _g2 = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _g = new THREE.Matrix4(), _gi = new THREE.Matrix4(), _h = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion(), _q5 = new THREE.Quaternion();
