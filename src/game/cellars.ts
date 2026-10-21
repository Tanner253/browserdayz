// The basements as the game has them (src/sim/basements.ts): a bulb hung in each of their rooms and over the foot of
// their steps, lit for whoever is near enough to see by it, and how dark it is down there for the eye.

import * as THREE from 'three';
import { basementDark, frameToWorld, type Basement } from '../sim/basements';
import type { Lamps } from './lamps';

/** a bulb's light: warm, and weaker than the bunker's caged lamps */
const COLOUR = new THREE.Color(1, 0.82, 0.58);
/** how near the eye a bulb must be to be lit at all (they are under the earth: from further than this, nothing of one is seen) */
const NEAR = 26;

export class Cellars {
  private bulbs: THREE.Vector3[] = [];
  private meshes: THREE.InstancedMesh[] = [];

  constructor(scene: THREE.Scene, private list: Basement[]) {
    for (const b of list) for (const [x, y, z] of b.lamps) {
      const [wx, wz] = frameToWorld(b, x, z);
      this.bulbs.push(new THREE.Vector3(wx, y, wz));
    }
    const n = this.bulbs.length;
    if (!n) return;
    // each a bare bulb under a dark shade, on a short flex from the ceiling
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2a2a26, emissive: COLOUR, emissiveIntensity: 3, roughness: 0.4 });
    const shade = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.15, 0.09, 12, 1, true), dark, n);
    const flex = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4), dark, n);
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 10, 8), glass, n);
    const m = new THREE.Matrix4();
    this.bulbs.forEach((p, i) => {
      flex.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.08, p.z));
      shade.setMatrixAt(i, m.makeTranslation(p.x, p.y - 0.02, p.z));
      bulb.setMatrixAt(i, m.makeTranslation(p.x, p.y - 0.06, p.z));
    });
    shade.material.side = THREE.DoubleSide;
    this.meshes = [flex, shade, bulb];
    for (const mesh of [shade, flex, bulb]) {
      mesh.frustumCulled = false;
      mesh.name = 'cellar-bulbs';
      scene.add(mesh);
    }
  }

  /** only the bulbs where `area` says are drawn (null: all of them): a game played on part of the map, src/game/modes.ts */
  only(area: ((x: number, z: number) => boolean) | null) {
    const kept = area ? this.bulbs.filter((p) => area(p.x, p.z)) : this.bulbs, m = new THREE.Matrix4();
    const [flex, shade, bulb] = this.meshes;
    if (!flex) return;
    kept.forEach((p, i) => {
      flex.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.08, p.z));
      shade.setMatrixAt(i, m.makeTranslation(p.x, p.y - 0.02, p.z));
      bulb.setMatrixAt(i, m.makeTranslation(p.x, p.y - 0.06, p.z));
    });
    for (const mesh of this.meshes) {
      mesh.count = kept.length;
      mesh.visible = kept.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** this frame's lit bulbs: those near the eye */
  update(eye: THREE.Vector3, lamps: Lamps) {
    for (const p of this.bulbs) if (p.distanceToSquared(eye) < NEAR * NEAR) lamps.glow(p, COLOUR, 0.5, 8);
  }

  /** how dark it is at a place for being down a basement (1 in its rooms; less down its steps, the nearer their head) */
  dark(x: number, y: number, z: number) {
    return basementDark(this.list, x, y, z);
  }
}
