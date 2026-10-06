// Other players. Each one is a body driven by the poses the server relays: interpolated
// a little in the past so movement is smooth, with hit zones your bullets and fists can
// land on, the weapon they are holding in their hands, and footsteps you can hear.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, GLASS_GROUPS, HITBOX_GROUPS, SOLID_GROUPS, type Surface } from '../core/physics';
import { audio } from '../core/audio';
import type { Atmosphere } from '../world/atmosphere';
import { F_CROUCH, F_DEAD, F_GROUND, type Pose } from '../net/protocol';
import { Avatar } from './avatar';
import type { Damageable, HitZone } from './weapons';
import type { Grips } from './arms';

/** render other players this far in the past: long enough to always have two poses to blend between */
const INTERP_DELAY = 110;

interface Snap {
  t: number;
  p: Pose;
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export type HeldFactory = (id: string | null, mods: string[]) => { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee' } | null;

export class RemotePlayer implements Damageable {
  alive = true;
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouched = false;
  weapon: string | null = null;
  mods: string[] = [];
  private avatar = new Avatar();
  private body!: RAPIER.RigidBody;
  private stand: RAPIER.Collider[] = [];
  private crouch: RAPIER.Collider[] = [];
  private blocker!: RAPIER.Collider;
  private snaps: Snap[] = [];
  private vel = new THREE.Vector3();
  private stride = 0;
  private fall = 0;
  private grounded = true;
  private flinch = 0;
  private ready = false;
  private heldKey = '';

  constructor(public id: number, public name: string, private makeHeld: HeldFactory) {}

  async load(atmo: Atmosphere, scene: THREE.Scene, pose: Pose) {
    await this.avatar.load(atmo, 0);
    scene.add(this.avatar.root);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pose[0], pose[1], pose[2]));
    const zone = (list: RAPIER.Collider[], desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
      list.push(c);
    };
    zone(this.stand, R.ColliderDesc.ball(0.125).setTranslation(0, 1.67, -0.02), 'head');
    zone(this.stand, R.ColliderDesc.cuboid(0.25, 0.31, 0.14).setTranslation(0, 1.21, 0), 'torso');
    zone(this.stand, R.ColliderDesc.cuboid(0.18, 0.45, 0.13).setTranslation(0, 0.45, 0), 'legs');
    zone(this.crouch, R.ColliderDesc.ball(0.125).setTranslation(0, 1.0, -0.14), 'head');
    zone(this.crouch, R.ColliderDesc.cuboid(0.25, 0.22, 0.17).setTranslation(0, 0.65, -0.04), 'torso');
    zone(this.crouch, R.ColliderDesc.cuboid(0.21, 0.22, 0.27).setTranslation(0, 0.22, -0.2), 'legs');
    for (const c of this.crouch) c.setEnabled(false);
    // players can't walk through each other; shots are only stopped by the hit zones
    this.blocker = physics.world.createCollider(R.ColliderDesc.capsule(0.5, 0.27).setTranslation(0, 0.8, 0).setCollisionGroups(GLASS_GROUPS), this.body);
    this.pos.set(pose[0], pose[1], pose[2]);
    this.yaw = pose[3];
    this.ready = true;
    this.push(pose, performance.now());
    this.setAlive(!(pose[5] & F_DEAD));
  }

  /** a pose arrived from the server */
  push(p: Pose, now: number) {
    this.snaps.push({ t: now, p });
    if (this.snaps.length > 12) this.snaps.shift();
  }

  setWeapon(id: string | null, mods: string[]) {
    const key = `${id}|${mods.join(',')}`;
    if (key === this.heldKey || !this.ready) return;
    this.heldKey = key;
    this.weapon = id;
    this.mods = mods;
    const h = this.makeHeld(id, mods);
    this.avatar.setHeld(h?.obj ?? null, h?.grips ?? null, h?.kind);
  }

  setAlive(alive: boolean) {
    if (alive === this.alive) return;
    this.alive = alive;
    this.fall = 0;
    this.avatar.root.visible = true;
    this.applyZones();
    this.blocker.setEnabled(alive);
  }

  private applyZones() {
    for (const c of this.stand) c.setEnabled(this.alive && !this.crouched);
    for (const c of this.crouch) c.setEnabled(this.alive && this.crouched);
  }

  /** your shot or blow landed on them: the server decides what it did, this is just the flinch */
  damage(): boolean {
    this.flinch = 1;
    return false;
  }

  /** chest position, for name tags and aim checks */
  chest(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + (this.crouched ? 0.68 : 1.25), this.pos.z);
  }

  update(dt: number, now: number, listener: THREE.Vector3) {
    if (!this.ready) return;
    // --- interpolate between the two poses around (now - delay)
    const t = now - INTERP_DELAY;
    const s = this.snaps;
    let a = s[0], b = s[s.length - 1];
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= t) {
        a = s[i - 1];
        b = s[i];
        break;
      }
    }
    if (a && b) {
      const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1.25) : 1;
      const prev = this.pos.clone();
      // a jump of more than a few metres is a teleport (respawn), not a sprint
      const tele = Math.hypot(b.p[0] - this.pos.x, b.p[2] - this.pos.z) > 12;
      this.pos.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
      this.yaw = lerpAngle(a.p[3], b.p[3], Math.min(1, k));
      this.pitch = a.p[4] + (b.p[4] - a.p[4]) * Math.min(1, k);
      this.grounded = !!(b.p[5] & F_GROUND);
      const crouched = !!(b.p[5] & F_CROUCH);
      if (crouched !== this.crouched) {
        this.crouched = crouched;
        this.applyZones();
      }
      if (dt > 0 && !tele) {
        const v = this.pos.clone().sub(prev).divideScalar(dt);
        this.vel.lerp(v, 1 - Math.exp(-12 * dt));
      } else this.vel.set(0, 0, 0);
    }

    const half = this.yaw / 2;
    this.body.setNextKinematicTranslation(this.pos);
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });

    this.flinch = Math.max(0, this.flinch - dt * 4);
    this.avatar.update(dt, this.pos, this.vel, this.yaw, this.crouched, !this.alive, false, this.pitch, this.grounded);
    const r = this.avatar.root;
    if (!this.alive) {
      // they go down, lie there for a moment, then the body on the ground takes over
      this.fall = Math.min(4, this.fall + dt * 2.6);
      if (this.fall >= 4) r.visible = false;
    } else if (this.flinch > 0) {
      r.rotation.x += this.flinch * 0.1;
      r.rotation.z += this.flinch * 0.08;
    }

    // --- footsteps you can hear coming
    if (this.alive) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0.6) {
        this.stride += speed * dt;
        const stepLen = speed > 4.8 ? 1.25 : 0.82;
        if (this.stride > stepLen) {
          this.stride = 0;
          const dist = this.pos.distanceTo(listener);
          if (dist < 45) {
            const hit = physics.raycast({ x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 1, SOLID_GROUPS);
            audio.footstep((hit?.tag?.surface ?? 'grass') as Surface, speed * (this.crouched ? 0.4 : 1), this.pos);
          }
        }
      }
    }
  }

  dispose() {
    this.avatar.dispose();
    if (this.ready) {
      for (const c of [...this.stand, ...this.crouch, this.blocker]) physics.tags.delete(c.handle);
      physics.world.removeRigidBody(this.body);
    }
  }
}

/** A dead player's body lying where they fell. Purely visual: the game pairs it with a searchable container. */
export class CorpseBody {
  private avatar = new Avatar();
  async load(atmo: Atmosphere, scene: THREE.Scene, x: number, y: number, z: number, yaw: number) {
    await this.avatar.load(atmo, 0);
    scene.add(this.avatar.root);
    this.avatar.layDown();
    this.avatar.update(0, new THREE.Vector3(x, y, z), new THREE.Vector3(), yaw, false, true);
  }
  dispose() {
    this.avatar.dispose();
  }
}
