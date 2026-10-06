// A character other than the local player: body, hit zones (head / torso / legs) and
// health. Today these are training dummies to shoot and punch; a networked player is
// the same thing with its position and state driven by the server.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, GLASS_GROUPS, HITBOX_GROUPS } from '../core/physics';
import type { Atmosphere } from '../world/atmosphere';
import { Avatar } from './avatar';
import type { Damageable, HitZone } from './weapons';

const ZERO = new THREE.Vector3();
const RESPAWN_AFTER = 7;

export class Dummy implements Damageable {
  readonly name = 'Training dummy';
  health = 100;
  dead = false;
  private avatar = new Avatar();
  private body!: RAPIER.RigidBody;
  private colliders: RAPIER.Collider[] = [];
  private down = 0;
  private flinch = 0;
  private flinchSide = 0;

  constructor(public pos: THREE.Vector3, public yaw: number) {}

  async load(atmo: Atmosphere, scene: THREE.Scene) {
    await this.avatar.load(atmo, 0);
    scene.add(this.avatar.root);
    const R = physics.R;
    const half = this.yaw / 2;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(this.pos.x, this.pos.y, this.pos.z).setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    const zone = (desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
      this.colliders.push(c);
    };
    zone(R.ColliderDesc.ball(0.125).setTranslation(0, 1.67, -0.02), 'head');
    zone(R.ColliderDesc.cuboid(0.25, 0.31, 0.14).setTranslation(0, 1.21, 0), 'torso');
    zone(R.ColliderDesc.cuboid(0.18, 0.45, 0.13).setTranslation(0, 0.45, 0), 'legs');
    // you can't walk through it, but shots are only stopped by the hit zones
    this.colliders.push(physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.27).setTranslation(0, 0.83, 0).setCollisionGroups(GLASS_GROUPS), this.body));
    this.update(0);
  }

  damage(amount: number, _point: THREE.Vector3, dir: THREE.Vector3, _zone: HitZone): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.flinch = 1;
    // lean away from where the hit came from
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.flinchSide = Math.sign(dir.dot(side)) || 1;
    if (this.health <= 0) {
      this.dead = true;
      this.down = RESPAWN_AFTER;
      for (const c of this.colliders) c.setEnabled(false);
      return true;
    }
    return false;
  }

  update(dt: number) {
    this.avatar.update(dt, this.pos, ZERO, this.yaw, false, this.dead);
    this.flinch = Math.max(0, this.flinch - dt * 4);
    if (this.dead) {
      this.down -= dt;
      if (this.down <= 0) {
        this.dead = false;
        this.health = 100;
        for (const c of this.colliders) c.setEnabled(true);
      }
    } else if (this.flinch > 0) {
      // rock back from the hit, away from where it came from
      const r = this.avatar.root;
      r.rotation.x += this.flinch * 0.12;
      r.rotation.z += this.flinch * 0.1 * this.flinchSide;
    }
  }
}
