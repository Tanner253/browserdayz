// Wounds on the body, and the infected's shared paints while they are unhurt.
// (Methods of Avatar cut out of avatar.ts whole on 2026-10-24, so that they can be read and worked on alone: put back on
// Avatar.prototype as the file loads. Nothing in them was changed but `this: Avatar` said as the first parameter.)

import * as THREE from 'three';
import { MAX_WOUNDS, stainPatch } from '../look';
import { BODY_SCALE, _a, _b, _m1, _m2, _w, type Avatar } from '../avatar';

export const woundsMethods = {
  /**
   * Blood on the body where it was hit: it soaks whatever is within `size` metres of the
   * point, and stays on that limb as it moves. A bullet leaves a second, bigger one where it
   * came out.
   * @param dir the way the bullet or blade was travelling (world)
   */
  wound(this: Avatar, point: THREE.Vector3, dir: THREE.Vector3, size = 0.08, through = false) {
    const skin = this.skin;
    if (!skin || !this.uniforms || !this.woundBones.length) return;
    this.own();
    const stain = (at: THREE.Vector3, r: number) => {
      // the nearest limb, measured to the line from its joint to the next
      let best = this.woundBones[0][0], bd = 1e9;
      for (const [i, child] of this.woundBones) {
        const a = _a.setFromMatrixPosition(skin.skeleton.bones[i].matrixWorld);
        let d = a.distanceTo(at);
        if (child) {
          const ab = _b.setFromMatrixPosition(child.matrixWorld).sub(a);
          const t = THREE.MathUtils.clamp(_w.copy(at).sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
          d = a.addScaledVector(ab, t).distanceTo(at);
        }
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      // world -> that bone -> where the bone stands at rest -> the body shape's own space
      const p = at.clone().applyMatrix4(_m1.copy(skin.skeleton.bones[best].matrixWorld).invert()).applyMatrix4(_m2.copy(skin.skeleton.boneInverses[best]).invert()).applyMatrix4(_m1.copy(skin.bindMatrix).invert());
      // the stain is measured in the mesh's units: the body is drawn a little smaller than it is modelled
      this.uniforms!.uWounds.value[this.woundN++ % MAX_WOUNDS].set(p.x, p.y, p.z, r / BODY_SCALE);
    };
    // the hit zones stand a little proud of the body: the wound is just inside them
    stain(point.clone().addScaledVector(dir, 0.05), size);
    if (through) stain(point.clone().addScaledVector(dir, 0.27), size * 1.35);
  },

  /** an infected's own paints, from its first wound: its blood is its own (the program is the shared one's: no shader is made) */
  own(this: Avatar) {
    const atmo = this.paintAtmo, uniforms = this.uniforms;
    if (this.owned || !atmo || !uniforms) return;
    this.owned = true;
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh, p = m.userData.paint as { src: THREE.Material; at: THREE.Matrix4 } | undefined;
      if (!m.isMesh || !p) return;
      const mat = p.src.clone();
      atmo.register(mat, (shader) => stainPatch(shader, uniforms, p.at), 'zombie');
      m.material = mat;
    });
  },

  /** a new life: clean clothes */
  clearWounds(this: Avatar) {
    this.woundN = 0;
    if (this.uniforms) for (const w of this.uniforms.uWounds.value) w.set(0, 0, 0, 0);
  },
};
