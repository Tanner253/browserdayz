// Thrown grenades. A grenade is a point flying under gravity that bounces off the world
// and goes off when its fuse runs out. Everyone is told where it left the hand and how fast
// (see the 'nade' message), and every game flies it through the same world, so it lands in
// the same place for all of them.

import * as THREE from 'three';
import { physics, SOLID_GROUPS } from '../core/physics';
import type { Surface } from '../core/physics';
import { audio } from '../core/audio';
import type { ItemModels } from './loot';

interface Flying {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  fuse: number;
  /** thrown by this player: its damage to others is this game's to report */
  mine: boolean;
  resting: boolean;
}

const RADIUS = 0.06;

export class Grenades {
  private list: Flying[] = [];
  private template: THREE.Object3D | null = null;
  /** it went off: where, and whether it was the local player's */
  onExplode: (at: THREE.Vector3, mine: boolean) => void = () => {};

  constructor(private scene: THREE.Scene, private models: ItemModels) {}

  async preload() {
    this.template = (await this.models.get('grenade')).group;
  }

  /** @param fuse seconds until it goes off, counted from the throw */
  throw(origin: THREE.Vector3, velocity: THREE.Vector3, fuse: number, mine: boolean) {
    if (!this.template) return;
    const obj = this.template.clone();
    obj.position.copy(origin);
    this.scene.add(obj);
    this.list.push({ obj, pos: origin.clone(), vel: velocity.clone(), spin: new THREE.Vector3(9, 3, 6), fuse, mine, resting: false });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.obj.removeFromParent();
        this.list.splice(i, 1);
        this.onExplode(g.pos.clone().setY(g.pos.y + 0.1), g.mine);
        continue;
      }
      if (g.resting) continue;
      // small steps: it must not pass through a wall between two frames
      let left = dt;
      while (left > 0 && !g.resting) {
        const h = Math.min(left, 1 / 120);
        left -= h;
        g.vel.y -= 9.81 * h;
        const step = g.vel.clone().multiplyScalar(h);
        const len = step.length();
        if (len < 1e-6) break;
        const dir = step.clone().divideScalar(len);
        const hit = physics.raycast(g.pos, dir, len + RADIUS, SOLID_GROUPS);
        if (hit) {
          const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          g.pos.addScaledVector(dir, Math.max(0, hit.toi - RADIUS));
          // off the surface: most of the speed along it kept, a third of the speed into it returned
          const into = g.vel.dot(n);
          const speed = g.vel.length();
          g.vel.addScaledVector(n, -into).multiplyScalar(0.62).addScaledVector(n, -into * 0.32);
          g.spin.multiplyScalar(0.5);
          if (speed > 2.2) audio.impact((hit.tag?.surface ?? 'dirt') as Surface, g.pos, 0);
          if (g.vel.length() < 0.7 && n.y > 0.6) {
            g.resting = true;
            g.vel.set(0, 0, 0);
          }
        } else g.pos.add(step);
      }
      g.obj.position.copy(g.pos);
      if (!g.resting) {
        g.obj.rotation.x += g.spin.x * dt;
        g.obj.rotation.y += g.spin.y * dt;
        g.obj.rotation.z += g.spin.z * dt;
      }
    }
  }
}
