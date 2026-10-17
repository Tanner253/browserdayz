// Our own arms on a pack drawn round another maker's arms (2026-10-17). The owner: "the hand models we are using
// should not change, and should be applied to the animations of the new guns ... the hands should not change
// depending on the gun". The pack's skeleton is played as its maker animated it and its own arms are not drawn;
// ours (the pair the AK and the submachine gun are held in) are posed after it every frame:
// - each hand where the pack's is on the gun (the middle of our palm on the middle of its palm), turned as it is;
// - the arm reaching it with our two bones' lengths, the elbow out to the side the pack's is, the forearm's twist
//   shared down its twist joints;
// - every finger joint laid along the pack's. A turn is carried from where the pack's joint stands, ours first laid
//   along it there (memory note hand-animation-lessons): never a curl of our own on top.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { RigInfo } from './rig';

type Side = 'L' | 'R';
/** a joint of ours driven by one of the pack's: our world turn is the pack's times `off` */
interface Pair { ours: THREE.Object3D; theirs: THREE.Object3D; off: THREE.Quaternion }
interface Arm {
  upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D;
  /** the forearm's twist joints, elbow first, and how much of the hand's twist each takes */
  twist: { n: THREE.Object3D; w: number; q0: THREE.Quaternion }[];
  theirs: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D; middle: THREE.Object3D };
  handPair: Pair; fingers: Pair[];
  /** at rest: our shoulder (in what it hangs on, and in the space of the whole), the two bones' lengths, the world turns of upper arm, forearm, hand */
  shoulder: THREE.Vector3; shoulderAt: THREE.Vector3; up: number; low: number; qU: THREE.Quaternion; qF: THREE.Quaternion; qH: THREE.Quaternion;
  /** at rest: which way each bone lies and the side the elbow bends to */
  dU: THREE.Vector3; dF: THREE.Vector3; n: THREE.Vector3;
  /** the middle of our palm, in our hand's own space */
  palm: THREE.Vector3;
  /** the side our elbow stands out to as our submachine gun holds it (in the eye's space, off the line from shoulder to wrist) */
  pole: THREE.Vector3;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qI = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const at = (o: THREE.Object3D, v = new THREE.Vector3()) => v.setFromMatrixPosition(o.matrixWorld);
const turnOf = (o: THREE.Object3D, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
/** the turn whose x is `d` and whose y is `hint` as near as it can be */
const frame = (d: THREE.Vector3, hint: THREE.Vector3, q = new THREE.Quaternion()) => {
  const x = _a.copy(d).normalize(), y = _b.copy(hint).addScaledVector(x, -hint.dot(x)).normalize(), z = _c.crossVectors(x, y);
  return q.setFromRotationMatrix(_m.makeBasis(x, y, z));
};
/** set a joint's world turn (its parent's world matrix must be current), and bring its own up to date */
const setTurn = (o: THREE.Object3D, q: THREE.Quaternion) => {
  o.quaternion.copy(turnOf(o.parent!, _q3).invert().multiply(q));
  o.updateWorldMatrix(false, false);
};
const setAt = (o: THREE.Object3D, v: THREE.Vector3) => {
  o.position.copy(_e.copy(v).applyMatrix4(_m.copy(o.parent!.matrixWorld).invert()));
  o.updateWorldMatrix(false, false);
};
const kids = (o: THREE.Object3D) => o.children.filter((c) => (c as THREE.Bone).isBone);

export class HandsOn {
  private arms: Arm[] = [];
  private ours: THREE.Object3D;
  private all: THREE.Object3D;
  private hip: THREE.Vector3;
  /** the eye the gun is drawn for: our shoulders stand still in its space (see `follow`) */
  private eye: THREE.Object3D | null = null;

  /**
   * @param pack the pack's scene, posed as it stands at rest, its world matrices current
   * @param root what both are drawn under (the eye's space)
   * @param arms the file our arms are in, and its rig (how it is laid in the eye's space)
   * @param shift where ours are put from where this pack is (the eye's space): what puts our shoulders where our
   * submachine gun has them, wherever this pack holds its gun (the owner: "we have our own for our AR's and
   * submachine guns")
   * @param shoulders how far the tops of our arms are let down out of the picture, as on the submachine gun (the eye's space)
   * @param hip where `root` stands from the eye with the gun at the hip
   */
  constructor(pack: THREE.Object3D, root: THREE.Object3D, arms: GLTF, info: RigInfo, shift: THREE.Vector3, shoulders: Record<Side, THREE.Vector3>, hip: THREE.Vector3, paint: (m: THREE.Material) => THREE.Material) {
    this.all = root;
    this.hip = hip.clone();
    pack.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.visible = false;
    });
    this.ours = SkeletonUtils.clone(arms.scene);
    this.ours.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.material = paint(mesh.material as THREE.Material);
    });
    // (ours laid in the eye's space as their own pack lays them, and standing as it stands at rest: their shoulders,
    // collars and all where the submachine gun has them. Not as their file has them: there the left shoulder was
    // three quarters of a metre out in front of the eye.)
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.fromArray(info.view).premultiply(_m.makeTranslation(shift.x, shift.y, shift.z));
    holder.add(this.ours);
    root.add(holder);
    const still = new THREE.AnimationMixer(this.ours);
    still.clipAction(arms.animations[0]).play();
    // (and left so: a mixer stopped puts what it moved back as the file had it)
    still.setTime(0);
    root.updateMatrixWorld(true);
    const ours = (re: RegExp) => {
      let f: THREE.Object3D | null = null;
      this.ours.traverse((o) => {
        if (!f && re.test(o.name)) f = o;
      });
      return f as THREE.Object3D | null;
    };
    const theirs = (re: RegExp) => {
      let f: THREE.Object3D | null = null;
      pack.traverse((o) => {
        if (!f && re.test(o.name)) f = o;
      });
      return f as THREE.Object3D | null;
    };
    for (const s of ['L', 'R'] as Side[]) {
      const up = ours(new RegExp(`^UpArm_${s}_`));
      if (up) {
        setAt(up, at(up).add(_d.copy(shoulders[s]).transformDirection(root.matrixWorld).multiplyScalar(shoulders[s].length())));
        up.updateMatrixWorld(true);
      }
      const arm = this.arm(s, ours, theirs);
      if (arm) this.arms.push(arm);
    }
  }

  private arm(s: Side, ours: (re: RegExp) => THREE.Object3D | null, theirs: (re: RegExp) => THREE.Object3D | null): Arm | null {
    // (names as three.js has them: the dots of the files' names are taken out)
    const upper = ours(new RegExp(`^UpArm_${s}_`)), fore = ours(new RegExp(`^Forearm_${s}_`)), hand = ours(new RegExp(`^Hand_${s}_`));
    // The pack's skeleton as Blender's Rigify names it (DEF-hand.R, DEF-f_index.01.R), as Unreal's mannequin does
    // (hand_r, index_01_r), or by numbers (hand_r, palm_2_r, finger_21_r: the thumb the first, of two joints).
    const rigify = !!theirs(/^DEF-hand/), numbered = !rigify && !!theirs(new RegExp(`^palm_\\d_${s.toLowerCase()}_`));
    const T = (rig: string, ue: string) => theirs(new RegExp(rigify ? `^DEF-${rig}\\.?${s}_` : `^${ue}_${s.toLowerCase()}_\\d`));
    const N = (name: string) => theirs(new RegExp(`^${name}_${s.toLowerCase()}_\\d`));
    const tU = T('upper_arm', 'upperarm'), tF = numbered ? N('forearm') : T('forearm', 'lowerarm'), tH = T('hand', 'hand');
    // (numbered fingers: which is the first and which the little one by where their knuckles are, as ours below)
    let byNumber: (THREE.Object3D | null)[][] = [];
    const thumbAt = numbered ? N('finger_11') : null;
    if (numbered) byNumber = [2, 3, 4, 5].map((n) => [N(`palm_${n}`), N(`finger_${n}1`), N(`finger_${n}2`), N(`finger_${n}3`)]);
    if (thumbAt) byNumber.sort((x, y) => (x[1] && y[1] ? at(x[1], _d).distanceTo(at(thumbAt, _w)) - at(y[1], _e).distanceTo(at(thumbAt, _w)) : 0));
    const tM = numbered ? byNumber[1]?.[1] ?? null : T('f_middle\\.?01', 'middle_01');
    if (!upper || !fore || !hand || !tU || !tF || !tH || !tM) return null;
    const twist = [3, 2, 1].map((k) => ours(new RegExp(`^BoneTwist_0${k}\\.?${s}_\\d`))).filter((n): n is THREE.Object3D => !!n);
    const wristEnd = ours(new RegExp(`^BoneTwist_01\\.?${s}_end`)) ?? hand;
    // our fingers: four of four joints and a thumb of three, numbered as their maker numbered them; which is which by
    // where they are (the one whose knuckle is nearest the thumb is the first finger, and so on out)
    const chain = (from: number, n: number) => Array.from({ length: n }, (_, k) => ours(new RegExp(`^Bone_${s}\\.?0${String(from + k).padStart(2, '0')}_`)));
    const thumb = chain(20, 3);
    const four = [4, 8, 12, 16].map((k) => chain(k, 4));
    if ([...thumb, ...four.flat()].some((n) => !n)) return null;
    const base = at(thumb[0]!, new THREE.Vector3());
    four.sort((x, y) => at(x[1]!, _d).distanceTo(base) - at(y[1]!, _e).distanceTo(base));
    const names = ['index', 'middle', 'ring', 'pinky'];
    const theirsFingers = numbered ? byNumber : names.map((f, k) => [T(`palm\\.?0${k + 1}`, `${f}_metacarpal`), T(`f_${f}\\.?01`, `${f}_01`), T(`f_${f}\\.?02`, `${f}_02`), T(`f_${f}\\.?03`, `${f}_03`)]);
    const theirThumb = numbered ? [N('palm_1'), N('finger_11'), N('finger_12')] : [1, 2, 3].map((k) => T(`thumb\\.?0${k}`, `thumb_0${k}`));
    // the hand's breadth, ours and theirs, from the first finger's knuckle to the little one's: the second way each joint is laid by
    const latO = at(four[0][1]!, new THREE.Vector3()).sub(at(four[3][1]!, _d));
    const latT = at(theirsFingers[0][1]!, new THREE.Vector3()).sub(at(theirsFingers[3][1]!, _d));
    /** where a joint points: to its first child joint (a fingertip with none: on from the joint before it) */
    const lies = (o: THREE.Object3D, v: THREE.Vector3) => {
      const c = kids(o)[0];
      return c ? at(c, v).sub(at(o, _w)) : o.parent ? at(o, v).sub(at(o.parent, _w)) : null;
    };
    const pair = (o: THREE.Object3D, t: THREE.Object3D, dO: THREE.Vector3 | null, dT: THREE.Vector3 | null): Pair | null => {
      if (!dO || !dT) return null;
      // (ours laid along theirs where both stand at rest: then turned as theirs turns from there)
      const R = frame(dT, latT, new THREE.Quaternion()).multiply(frame(dO, latO, _q2).invert());
      const laid = R.multiply(turnOf(o, _q));
      return { ours: o, theirs: t, off: turnOf(t, new THREE.Quaternion()).invert().multiply(laid) };
    };
    const fingers: Pair[] = [];
    const link = (os: (THREE.Object3D | null)[], ts: (THREE.Object3D | null)[]) => {
      for (let k = 0; k < os.length; k++) {
        const o = os[k], t = ts[k];
        if (!o || !t) continue;
        const p = pair(o, t, lies(o, new THREE.Vector3()), lies(t, new THREE.Vector3()));
        if (p) fingers.push(p);
      }
    };
    four.forEach((f, k) => link(f, theirsFingers[k]));
    link(thumb, theirThumb);
    // the hand: from the wrist to the middle finger's knuckle
    const handPair = pair(hand, tH, at(four[1][1]!, new THREE.Vector3()).sub(at(hand, _d)), at(tM, new THREE.Vector3()).sub(at(tH, _d)))!;
    const S = at(upper), E = at(fore), W = at(wristEnd);
    const n = _n.crossVectors(_p.copy(W).sub(S), _w.copy(E).sub(S));
    const line = _p.copy(W).sub(S).normalize();
    const pole = E.clone().sub(S);
    pole.addScaledVector(line, -pole.dot(line)).transformDirection(_m.copy(this.all.matrixWorld).invert());
    // (a straight arm at rest says nothing of where its elbow bends: then the way its maker bent the hand back from it)
    if (n.lengthSq() < 1e-10) n.set(0, 0, 1).applyQuaternion(turnOf(upper, _q));
    return {
      upper, fore, hand, twist: twist.map((t, k) => ({ n: t, w: (k + 1) / twist.length, q0: turnOf(t) })),
      theirs: { upper: tU, fore: tF, hand: tH, middle: tM },
      handPair, fingers,
      shoulder: upper.position.clone(), shoulderAt: this.all.worldToLocal(S.clone()), up: E.distanceTo(S), low: W.distanceTo(E),
      qU: turnOf(upper), qF: turnOf(fore), qH: turnOf(hand),
      dU: E.clone().sub(S).normalize(), dF: W.clone().sub(E).normalize(), n: n.clone().normalize(),
      palm: hand.worldToLocal(at(hand, new THREE.Vector3()).lerp(at(four[1][1]!, _d), 0.5)),
      pole,
    };
  }

  /** Ours posed after the pack's as it stands this frame. Call once the frame's movement is set. */
  follow() {
    if (!this.arms.length) return;
    if (!this.eye) for (let p = this.all.parent; p && !this.eye; p = p.parent) if ((p as THREE.Camera).isCamera) this.eye = p;
    this.all.updateMatrixWorld(true);
    for (const a of this.arms) {
      // the hand: turned as theirs is, the middle of the palm on the middle of theirs
      const qH = turnOf(a.theirs.hand, new THREE.Quaternion()).multiply(a.handPair.off);
      setTurn(a.hand, qH);
      const palmTheirs = at(a.theirs.hand, _p).lerp(at(a.theirs.middle, _d), 0.5);
      const palmOurs = _d.copy(a.palm).applyMatrix4(a.hand.matrixWorld);
      setAt(a.hand, at(a.hand, _w).add(palmTheirs.sub(palmOurs)));
      a.hand.updateMatrixWorld(true);
      // the fingers, joint after joint from the knuckle out
      for (const f of a.fingers) setTurn(f.ours, turnOf(f.theirs, _q).multiply(f.off));
      // the arm: our shoulder where it rests, brought forward only as far as an arm too short to reach needs
      a.upper.position.copy(a.shoulder);
      a.upper.updateWorldMatrix(false, false);
      // (and where it rests with the gun at the hip it stays, in the eye's space, whatever the gun does: brought up to
      // the eye, the gun took our shoulders up with it into the picture. The arms reach for it from where they are.)
      if (this.eye) setAt(a.upper, _p.copy(a.shoulderAt).add(this.hip).applyMatrix4(this.eye.matrixWorld));
      const S = at(a.upper, new THREE.Vector3()), W = at(a.hand, new THREE.Vector3());
      const reach = _c.copy(W).sub(S);
      const long = a.up + a.low - 1e-4;
      const far = reach.length();
      if (far > long) {
        S.addScaledVector(reach.normalize(), far - long);
        setAt(a.upper, S);
        reach.copy(W).sub(S);
      }
      const d = THREE.MathUtils.clamp(reach.length(), Math.abs(a.up - a.low) + 1e-4, long);
      const r = reach.normalize();
      const along = (a.up * a.up - a.low * a.low + d * d) / (2 * d), out = Math.sqrt(Math.max(0, a.up * a.up - along * along));
      // (the elbow out to the side ours stands out to on the submachine gun, not theirs: their shoulders are a body's
      // width apart and ours are cut short under the picture, and an elbow out where theirs is swung the cut top of
      // our sleeve up into the corner of the picture)
      const pole = _n.copy(a.pole).transformDirection(this.all.matrixWorld);
      pole.addScaledVector(r, -pole.dot(r)).normalize();
      const E = S.clone().addScaledVector(r, along).addScaledVector(pole, out);
      const n = new THREE.Vector3().crossVectors(_p.copy(W).sub(S), _d.copy(E).sub(S)).normalize();
      // (each bone turned from how it lies at rest to how it lies now, its bend kept to the side it bends to)
      const Ru = frame(_a.copy(E).sub(S), n, new THREE.Quaternion()).multiply(frame(a.dU, a.n, _q2).invert());
      setTurn(a.upper, Ru.multiply(_q.copy(a.qU)));
      a.fore.updateWorldMatrix(false, false);
      const Rf = frame(_a.copy(W).sub(E), n, new THREE.Quaternion()).multiply(frame(a.dF, a.n, _q2).invert());
      setTurn(a.fore, _q.copy(Rf).multiply(a.qF));
      // the forearm's twist: how far the hand is turned about the forearm past where the forearm alone would have it
      const rel = _q2.copy(qH).multiply(_q.copy(Rf).multiply(a.qH).invert());
      const axis = _w.copy(W).sub(E).normalize();
      const v = axis.multiplyScalar(rel.x * axis.x + rel.y * axis.y + rel.z * axis.z);
      const tw = new THREE.Quaternion(v.x, v.y, v.z, rel.w).normalize();
      for (const t of a.twist) {
        t.n.updateWorldMatrix(false, false);
        setTurn(t.n, _qI.identity().slerp(tw, t.w).multiply(_q.copy(Rf).multiply(t.q0)));
      }
      a.upper.updateMatrixWorld(true);
    }
  }
}
