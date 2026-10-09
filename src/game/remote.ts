// Other players. Each one is a body driven by the poses the server relays: interpolated
// a little in the past so movement is smooth, with hit zones your bullets and fists can
// land on, the weapon they are holding in their hands, and footsteps you can hear.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, GLASS_GROUPS, HITBOX_GROUPS, SOLID_GROUPS, type Surface } from '../core/physics';
import { audio } from '../core/audio';
import type { Atmosphere } from '../world/atmosphere';
import { F_AIM, F_BLEED, F_CROUCH, F_DANCE, F_DEAD, F_GROUND, F_LEAN_L, F_LEAN_R, F_SURRENDER, type Act, type Pose } from '../net/protocol';
import { SHOUT_RANGE, voiceOf, type Emote } from '../sim/emotes';
import { ITEMS } from '../sim/items';
import { Avatar } from './avatar';
import { lookFor } from './look';
import type { Damageable, HitZone } from './weapons';
import type { Grips } from './arms';
import type { Jeep } from './vehicle';

/** render other players this far in the past: long enough to always have two poses to blend between */
const INTERP_DELAY = 110;

interface Snap {
  t: number;
  p: Pose;
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export type HeldFactory = (id: string | null, mods: string[]) => { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee' } | null;

const _head = new THREE.Vector3(), _neck = new THREE.Vector3(), _pelvis = new THREE.Vector3();

export class RemotePlayer implements Damageable {
  alive = true;
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouched = false;
  weapon: string | null = null;
  mods: string[] = [];
  readonly avatar = new Avatar();
  /** they have an open wound: it drips as they go */
  bleeding = false;
  dripT = 0;
  private body!: RAPIER.RigidBody;
  private stand: RAPIER.Collider[] = [];
  private crouch: RAPIER.Collider[] = [];
  private blocker!: RAPIER.Collider;
  private snaps: Snap[] = [];
  private vel = new THREE.Vector3();
  private fall = 0;
  private grounded = true;
  private aiming = false;
  private flinch = 0;
  /** leaning out, -1 (left) .. 1 (right) */
  lean = 0;
  /** sitting in a jeep: which one, and where in it their feet are (in the jeep's own frame) */
  seat: { jeep: Jeep; at: [number, number, number] } | null = null;
  private sat = false;
  /** the middle of the head, in the world, as of the last frame (null until the body has been seen) */
  private headAt: THREE.Vector3 | null = null;
  private ready = false;
  private heldKey = '';

  constructor(public id: number, public name: string, private makeHeld: HeldFactory) {}

  async load(atmo: Atmosphere, scene: THREE.Scene, pose: Pose) {
    await this.avatar.load(atmo, 0, false, lookFor(this.name));
    scene.add(this.avatar.root);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pose[0], pose[1], pose[2]));
    const zone = (list: RAPIER.Collider[], desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
      list.push(c);
    };
    // measured on the body: x to its right, z behind it
    zone(this.stand, R.ColliderDesc.ball(0.125).setTranslation(0, 1.64, -0.02), 'head');
    zone(this.stand, R.ColliderDesc.cuboid(0.25, 0.31, 0.14).setTranslation(0, 1.21, 0), 'torso');
    zone(this.stand, R.ColliderDesc.cuboid(0.18, 0.45, 0.14).setTranslation(0, 0.45, 0.03), 'legs');
    // crouched it leans forward over one knee, hips well behind the head
    zone(this.crouch, R.ColliderDesc.ball(0.125).setTranslation(-0.07, 1.03, -0.12), 'head');
    zone(this.crouch, R.ColliderDesc.cuboid(0.24, 0.24, 0.2).setTranslation(-0.07, 0.72, 0.1), 'torso');
    zone(this.crouch, R.ColliderDesc.cuboid(0.25, 0.24, 0.3).setTranslation(-0.02, 0.24, 0.07), 'legs');
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
    // back from the dead is a new life in clean clothes
    if (alive) this.avatar.clearWounds();
    this.fall = 0;
    this.avatar.root.visible = true;
    this.applyZones();
    this.blocker.setEnabled(alive && !this.sat);
  }

  /**
   * The head and the chest that count are the head and the chest that are seen: each frame
   * they are put where the body's own joints are, so they are right standing, crouched over a
   * rifle, leaning out round a corner, and in whatever the body learns to do next. (The legs
   * stay under the hips: they do not go anywhere the feet do not.)
   */
  private placeZones() {
    if (!this.alive || !this.avatar.frame(_head, _neck, _pelvis)) return;
    (this.headAt ??= new THREE.Vector3()).copy(_head);
    // into the body's own frame: x to its right, z behind it
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const v of [_head, _neck, _pelvis]) {
      const x = v.x - this.pos.x, z = v.z - this.pos.z;
      v.set(x * c - z * s, v.y - this.pos.y, x * s + z * c);
    }
    const set = this.crouched ? this.crouch : this.stand;
    set[0].setTranslationWrtParent(_head);
    // the chest: between the hips and the neck, and over to one side as far as the back is
    const roll = Math.atan2(_neck.x - _pelvis.x, _neck.y - _pelvis.y);
    set[1].setTranslationWrtParent(_pelvis.lerp(_neck, 0.54));
    set[1].setRotationWrtParent({ x: 0, y: 0, z: Math.sin(-roll / 2), w: Math.cos(-roll / 2) });
  }

  private applyZones() {
    for (const c of this.stand) c.setEnabled(this.alive && !this.crouched);
    for (const c of this.crouch) c.setEnabled(this.alive && this.crouched);
  }

  /** they threw a punch or swung what they are holding */
  swing() {
    if (!this.ready || !this.alive) return;
    this.avatar.swing();
    if (this.pos.distanceToSquared(this.heard) < 30 * 30) audio.whoosh(this.weapon ? 0.6 : 0, this.pos);
  }

  /** they are working the bolt, reloading, eating, dressing a wound: seen, and heard if close */
  act(a: Act, dur: number, listener: THREE.Vector3) {
    if (!this.ready || !this.alive) return;
    if (a === 'stop') return this.avatar.act(null);
    this.avatar.act(a, dur);
    if (this.pos.distanceToSquared(listener) > 40 * 40) return;
    if (a === 'bolt') audio.boltCycle(0, this.pos);
    else if (a === 'reload') audio.reloadNear(this.pos, dur, ITEMS[this.weapon ?? '']?.weapon?.kind === 'pistol');
  }

  /** they called something out (see src/sim/emotes.ts): heard from where their head is, and the arms go with it */
  call(e: Emote, listener: THREE.Vector3) {
    if (!this.ready || !this.alive) return;
    if (e.move) this.avatar.emote(e.move, e.dur);
    const head = this.head(new THREE.Vector3());
    const d = head.distanceTo(listener);
    if (d < SHOUT_RANGE) audio.shout(e.id, head, d, voiceOf(this.name));
  }

  /** your shot or blow landed on them: the server decides what it did, this is the flinch and the grunt */
  damage(_amount: number, point: THREE.Vector3, _dir: THREE.Vector3, zone: HitZone): boolean {
    this.flinch = 1;
    this.avatar.hit(zone === 'head');
    audio.hurt(point, point.distanceTo(this.heard));
    return false;
  }
  /** where the local player is listening from (kept by update) */
  private heard = new THREE.Vector3();

  /** metres a second over the ground, and whether they are sitting in a jeep (what the infected go by: src/game/infected.ts) */
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get seated() {
    return !!this.seat;
  }

  /** chest position, for name tags and aim checks */
  chest(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + (this.crouched ? 0.68 : 1.25), this.pos.z);
  }

  /** where the mouth is, near enough */
  head(out: THREE.Vector3) {
    return this.headAt && this.alive ? out.copy(this.headAt) : out.set(this.pos.x, this.pos.y + (this.crouched ? 1.02 : 1.62), this.pos.z);
  }

  update(dt: number, now: number, listener: THREE.Vector3) {
    if (!this.ready) return;
    this.heard.copy(listener);
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
      this.aiming = !!(b.p[5] & F_AIM);
      this.bleeding = !!(b.p[5] & F_BLEED);
      this.avatar.setHold(b.p[5] & F_DANCE ? 'dance' : b.p[5] & F_SURRENDER ? 'surrender' : null);
      // (a weapon coming up to the eye is the end of a wave)
      if (this.aiming) this.avatar.emote(null);
      const out = !this.alive ? 0 : b.p[5] & F_LEAN_R ? 1 : b.p[5] & F_LEAN_L ? -1 : 0;
      this.lean += (out - this.lean) * (1 - Math.exp(-10 * dt));
      if (Math.abs(this.lean) < 0.002 && !out) this.lean = 0;
      this.avatar.setLean(this.lean);
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
    // In a jeep they are wherever their seat is: the jeep is drawn from its own reports, and
    // a body placed from other ones would slide about in it.
    const seat = this.alive ? this.seat : null;
    if (seat) {
      seat.jeep.point(seat.at[0], seat.at[1], seat.at[2], this.pos);
      this.yaw = seat.jeep.yaw;
      this.pitch = 0;
      this.vel.set(0, 0, 0);
      this.grounded = true;
      this.aiming = false;
      if (this.crouched) {
        this.crouched = false;
        this.applyZones();
      }
    }
    if (!!seat !== this.sat) {
      this.sat = !!seat;
      this.avatar.setSeat(this.sat);
      this.blocker.setEnabled(this.alive && !this.sat);
    }

    const half = this.yaw / 2;
    this.body.setNextKinematicTranslation(this.pos);
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });

    this.flinch = Math.max(0, this.flinch - dt * 4);
    this.avatar.update(dt, this.pos, this.vel, this.yaw, this.crouched, !this.alive, false, this.pitch, this.grounded, this.aiming);
    // (sat in it, they lean and tip as it does)
    if (seat) this.avatar.root.quaternion.copy(seat.jeep.quat);
    this.placeZones();
    const r = this.avatar.root;
    if (!this.alive) {
      // they go down, lie there for a moment, then the body on the ground takes over
      this.fall = Math.min(4, this.fall + dt * 2.1);
      if (this.fall >= 4) r.visible = false;
    } else if (this.flinch > 0) {
      r.rotation.x += this.flinch * 0.05;
      r.rotation.z += this.flinch * 0.04;
    }

    // --- footsteps you can hear coming
    if (this.alive && this.avatar.footfall) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0.6 && this.pos.distanceTo(listener) < 45) {
        const hit = physics.raycast({ x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 1, SOLID_GROUPS);
        audio.footstep((hit?.tag?.surface ?? 'grass') as Surface, speed * (this.crouched ? 0.4 : 1), this.pos);
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
  /** @param name whose body it is: it is dressed the way they were */
  async load(atmo: Atmosphere, scene: THREE.Scene, x: number, y: number, z: number, yaw: number, name: string, variant = 0) {
    await this.avatar.load(atmo, 0, false, lookFor(name));
    scene.add(this.avatar.root);
    this.avatar.layDown(variant);
    this.avatar.update(0, new THREE.Vector3(x, y, z), new THREE.Vector3(), yaw, false, true);
  }
  dispose() {
    this.avatar.dispose();
  }
}
