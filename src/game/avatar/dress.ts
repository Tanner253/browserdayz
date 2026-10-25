// What the body wears and carries: slung guns, worn gear, the dog tag, and what is on the face that a stock goes round.
// (Methods of Avatar cut out of avatar.ts whole on 2026-10-24, so that they can be read and worked on alone: put back on
// Avatar.prototype as the file loads. Nothing in them was changed but `this: Avatar` said as the first parameter.)

import * as THREE from 'three';
import { POSE } from './pose';
import { WORN, GEAR, placeWorn } from './gear';
import { _k6, _m1, _m2, Avatar } from '../avatar';
import { proportion, type Lengths } from '../survivors';
import { BODY_SCALE } from '../avatar';

export const dressMethods = {
  /**
   * A survivor's own bone lengths (src/game/survivors.ts, proportion): on the skeleton the clips play on and the one
   * drawn, which takes its places from it; and the arms' reach, which their hold on a weapon is worked out by.
   */
  proportion(this: Avatar, lengths: Lengths | null, scale: number | null) {
    proportion(this.drive.flatMap(([from, to]) => [from, to]), lengths);
    // (and as tall as that survivor stands: the whole body drawn bigger or smaller, so that the clips' hips still stand
    // its feet on the ground; what is in its hands keeps its own size, see Avatar.hold)
    this.stature = (scale ?? BODY_SCALE) / BODY_SCALE;
    this.modelRoot?.parent?.scale.setScalar(BODY_SCALE * this.stature);
    for (const r of [this.armR, this.armL]) {
      if (!r) continue;
      const own = (b: THREE.Object3D) => (b.userData.ownPlace as THREE.Vector3 | undefined)?.length() ?? b.position.length();
      r.la0 ??= r.la;
      r.lb0 ??= r.lb;
      r.la = ((r.la0 * r.fore.position.length()) / own(r.fore)) * this.stature;
      r.lb = ((r.lb0 * r.hand.position.length()) / own(r.hand)) * this.stature;
    }
  },

  /**
   * Puts copies of what is slung on the back there: the first with its muzzle up over the left shoulder, flat
   * against the back, and a second crossing it, up over the right.
   */
  setSlung(this: Avatar, objs: THREE.Object3D[] | THREE.Object3D | null) {
    this.slung.clear();
    const list = !objs ? [] : Array.isArray(objs) ? objs : [objs];
    list.slice(0, 2).forEach((obj, k) => {
      const c = obj.clone();
      c.traverse((o) => (o.layers.mask = this.layerMask));
      c.rotation.set(0.25, -Math.PI / 2, Math.PI * (k ? 0.38 : 0.62));
      c.position.set(k ? -0.1 : 0.1, 0.04, 0.01 + this.packOut + k * 0.045);
      c.userData.over = k * 0.045;
      this.slung.add(c);
    });
    if (this.slung.children.length) Avatar.onDressed([...this.slung.children]);
  },

  /** Hat, vest, pack: whatever of it is drawn (see GEAR). The models are this body's to keep. */
  setGear(this: Avatar, items: { id: string; obj: THREE.Object3D }[]) {
    for (const o of this.gearObjs) o.removeFromParent();
    this.gearObjs = [];
    this.packOut = 0;
    for (const p of this.pieces.values()) p.visible = false;
    const ids = items.map(({ id }) => id);
    const chest: { obj: THREE.Object3D; rest: THREE.Matrix4 }[] = [];
    for (const { id, obj } of items) {
      for (const name of WORN[id] ?? []) {
        const p = this.pieces.get(name);
        if (p) p.visible = true;
      }
      const g = GEAR[id];
      const rest = g && this.gearRest.get(g.bone);
      if (!g || !rest) continue;
      obj.traverse((o) => {
        o.layers.mask = this.layerMask;
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      const holder = new THREE.Group();
      holder.layers.mask = this.layerMask;
      holder.matrixAutoUpdate = false;
      // (a helmet over a mask: the mask goes under it, cut where the helmet covers it, and the helmet may sit a
      // little otherwise for it: see OVER_MASK)
      placeWorn(id, obj, ids, _m1);
      holder.matrix.copy(rest.inv).multiply(_m1);
      holder.add(obj);
      if (g.bone === 'spine_03' && !g.pack) chest.push({ obj, rest: _m1.clone() });
      rest.bone.add(holder);
      this.gearObjs.push(holder);
      if (g.pack) this.packOut = 0.2;
    }
    for (const c of this.slung.children) c.position.z = 0.01 + this.packOut + (c.userData.over ?? 0);
    // (the tag laid on what is worn over the chest now: the vest hung on the body, or the suit's own plate carrier)
    const at = this.gearRest.get('spine_03');
    if (this.tag && at) this.tag.fit(at.bone, at.inv, chest, ids.flatMap((id) => WORN[id] ?? []));
    if (this.gearObjs.length) Avatar.onDressed(this.gearObjs);
  },

  wearTag(this: Avatar, kind: 'steel' | 'gold' | null) {
    this.tag?.wear(kind);
  },

  /**
   * Puts a weapon in the hands (null = empty hands). `obj` is the weapon body in its own
   * model space, the same space the grips are written in.
   */
  /**
   * Where the end of the barrel in its hands is, in the world, and which way the barrel
   * points: for the flash of a shot. Null if it holds no gun, or one whose barrel is not known.
   */
  muzzle(this: Avatar, pos = new THREE.Vector3(), dir = new THREE.Vector3()): { pos: THREE.Vector3; dir: THREE.Vector3 } | null {
    const obj = this.held?.obj, at = obj?.userData.muzzle as number[] | undefined;
    if (!obj || !at || !this.root.visible) return null;
    obj.updateWorldMatrix(true, false);
    pos.set(at[0], at[1], at[2]).applyMatrix4(obj.matrixWorld);
    // (the gun lies along its own x)
    dir.set(at[0] + 1, at[1], at[2]).applyMatrix4(obj.matrixWorld).sub(pos).normalize();
    return { pos, dir };
  },

  /**
   * What is worn on the head that a stock brought to the cheek has to go round, measured off the worn things
   * themselves in the body's resting frame as the head carries it (once for each change of gear):
   *   under: the lowest point of anything that stands off the face beside the cheek or out in front of it (a
   *          visor that is down, a filter at the cheek): a stock goes under that, and null if there is none;
   *   cheek: how far out anything lying ON the cheek comes (a mask's rubber): a stock goes beside that.
   * (Called with the body's places in the world up to date.)
   */
  faceGear(this: Avatar) {
    if (this.faceOf === this.gearObjs) return this.face;
    this.faceOf = this.gearObjs;
    const rest = this.gearRest.get('Head'), eye = POSE.hold.cheek.eye[1];
    let under = Infinity, cheek = 0;
    if (rest) {
      // (the head and what is on it made current first: see setWorldQuat)
      rest.bone.updateWorldMatrix(true, false);
      _m1.multiplyMatrices(rest.bone.matrixWorld, rest.inv).invert();
      for (const holder of this.gearObjs) {
        if (holder.parent !== rest.bone) continue;
        // (forced: a holder's own matrix is set once, and it is worked out only when told to be)
        holder.updateWorldMatrix(false, true, true);
        holder.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const P = m.geometry.getAttribute('position');
          _m2.multiplyMatrices(_m1, m.matrixWorld);
          for (let i = 0; i < P.count; i++) {
            const { x, y, z } = _k6.fromBufferAttribute(P, i).applyMatrix4(_m2);
            if (y > eye || y < eye - 0.2 || z > 0 || z < -0.25 || x < 0.045 || x > 0.2) continue;
            if (x > 0.1 || z < -0.135) under = Math.min(under, y);
            else if (y > eye - 0.12 && y < eye - 0.03 && z < -0.01) cheek = Math.max(cheek, x);
          }
        });
      }
    }
    this.face = { under: under < Infinity ? under : null, cheek };
    return this.face;
  },
};
