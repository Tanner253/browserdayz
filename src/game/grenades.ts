// Thrown grenades. A grenade is a point flying under gravity that bounces off the world
// and goes off when its fuse runs out. Everyone is told where it left the hand and how fast
// (see the 'nade' message), and every game flies it through the same world, so it lands in
// the same place for all of them.
//
// Its fuse does not begin here: it runs from when its pin came out, in the hand (see `cook` in
// game.ts and src/sim/grenades.ts), and what is flown here is what was left of it at the throw.

import * as THREE from 'three';
import { physics, SOLID_GROUPS } from '../core/physics';
import type { Surface } from '../core/physics';
import { audio } from '../core/audio';
import { NADE } from '../sim/grenades';
import type { ItemModels } from './loot';

interface Flying {
  /** which grenade it is: its item (the stick grenade, the frag) */
  id: string;
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  fuse: number;
  /** thrown by this player: its damage to others is this game's to report */
  mine: boolean;
  resting: boolean;
  /** fired from a launcher: it goes off where it first strikes */
  impact: boolean;
}

const RADIUS = 0.06;

export class Grenades {
  private list: Flying[] = [];
  /** it went off: where, whether it was the local player's, and which grenade it was */
  onExplode: (at: THREE.Vector3, mine: boolean, id: string) => void = () => {};

  constructor(private scene: THREE.Scene, private models: ItemModels) {}

  /** (the stick grenade's model is had before anybody throws one; the frag's is fetched when one is first near, as any thing's is) */
  async preload() {
    await this.models.get('grenade');
  }

  /**
   * @param fuse seconds until it goes off: what is left of its fuse as it leaves the hand
   * @param id which grenade (the stick grenade, where it is not said)
   */
  throw(origin: THREE.Vector3, velocity: THREE.Vector3, fuse: number, mine: boolean, id = 'grenade', impact = false) {
    // (It is in the air from this moment whether or not its model has come: whoever threw it has had it in the
    // hand, and has the model; anybody else may see nothing of it for the moment its file takes.)
    const obj = new THREE.Group();
    obj.position.copy(origin);
    this.scene.add(obj);
    // (a launcher's grenade is a streak at seventy-six metres a second: no model is drawn for it)
    if (!impact) void this.models.get(id).then((tpl) => obj.add(tpl.group.clone()), () => {});
    this.list.push({ id, obj, pos: origin.clone(), vel: velocity.clone(), spin: new THREE.Vector3(9, 3, 6), fuse, mine, resting: false, impact });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      // (a launcher's: flown first, and it goes off the moment it strikes something)
      if (g.impact && g.fuse > 0) {
        let left = dt;
        while (left > 0 && g.fuse > 0) {
          const h = Math.min(left, 1 / 240);
          left -= h;
          g.vel.y -= NADE.fall * h;
          const step = g.vel.clone().multiplyScalar(h), len = step.length(), dir = step.clone().divideScalar(len || 1);
          const hit = physics.raycast(g.pos, dir, len + RADIUS, SOLID_GROUPS);
          if (hit) {
            g.pos.addScaledVector(dir, Math.max(0, hit.toi - RADIUS)).add(new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).multiplyScalar(0.1));
            g.fuse = 0;
          } else g.pos.add(step);
        }
        g.obj.position.copy(g.pos);
      }
      if (g.fuse <= 0) {
        g.obj.removeFromParent();
        this.list.splice(i, 1);
        this.onExplode(g.pos.clone().setY(g.pos.y + 0.1), g.mine, g.id);
        continue;
      }
      if (g.resting) continue;
      // small steps: it must not pass through a wall between two frames
      let left = dt;
      while (left > 0 && !g.resting) {
        const h = Math.min(left, 1 / 120);
        left -= h;
        g.vel.y -= NADE.fall * h;
        const step = g.vel.clone().multiplyScalar(h);
        const len = step.length();
        if (len < 1e-6) break;
        const dir = step.clone().divideScalar(len);
        const hit = physics.raycast(g.pos, dir, len + RADIUS, SOLID_GROUPS);
        if (hit) {
          const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          g.pos.addScaledVector(dir, Math.max(0, hit.toi - RADIUS));
          // (a launcher's goes off where it strikes, a hand's breadth off the surface)
          if (g.impact) {
            g.fuse = 0;
            g.pos.addScaledVector(n, 0.1);
            break;
          }
          // off the surface: most of the speed along it kept, a third of the speed into it returned
          // (it never comes off anything faster than it struck it: what the server believes of how far a grenade
          // can have gone rests on that. See `travel` in src/sim/grenades.ts.)
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
