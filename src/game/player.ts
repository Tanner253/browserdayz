// First-person survivor: kinematic character controller (Rapier), movement model,
// stamina / vitals, camera feel (bob, lean, landing dip) and footsteps.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, PLAYER_GROUPS, SHOT_GROUPS, type Surface } from '../core/physics';
import type { Input, MoveInput } from '../core/input';
import { audio } from '../core/audio';
import type { Terrain } from '../world/terrain';
import { MAX_STAMINA } from '../net/protocol';

const STAND_HALF = 0.56;
const CROUCH_HALF = 0.26;
const RADIUS = 0.3;
const EYE_STAND = 1.64;
const EYE_CROUCH = 1.02;
/** how long an untreated wound bleeds, seconds */
const BLEED_TIME = 42;

export interface Vitals {
  health: number;
  energy: number;
  water: number;
  stamina: number;
  bleeding: boolean;
}

export class Player {
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  kcc!: RAPIER.KinematicCharacterController;
  /** feet position (physics state) */
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouched = false;
  grounded = false;
  sprinting = false;
  moving = 0; // 0..1 horizontal speed fraction
  eye = EYE_STAND;
  lean = 0;
  vitals: Vitals = { health: 100, energy: 85, water: 85, stamina: MAX_STAMINA, bleeding: false };
  dead = false;
  /** externally supplied (weapons): ADS + weapon weight slow the player */
  aiming = false;
  weightKg = 0;
  /** how fast thirst grows, from headwear */
  thirstMult = 1;
  /** fall damage multiplier from footwear */
  fallMult = 1;
  /** how the last damage was dealt (shown on the death screen, sent to the server) */
  lastCause = '';
  sensitivity = 0.0021;
  /** recoil / sway offsets applied on top of yaw/pitch for the camera */
  aimOffset = new THREE.Vector2();

  private stepPhase = 0;
  // previous fixed-step values, so render frames can interpolate (no 60 Hz stepping on 144 Hz screens)
  private prevStepPhase = 0;
  private prevLean = 0;
  private prevMoving = 0;
  private alpha = 1;
  private bob = new THREE.Vector3();
  private landDip = 0;
  private landVel = 0;
  private staminaDelay = 0;
  private lastFallSpeed = 0;
  /** seconds since the feet last touched the ground, and since jump was last pressed */
  private airT = 0;
  private jumpWish = 1;
  /** a hard landing knocks the pace out of you for a moment */
  private stumble = 0;
  /** camera roll from sidestepping */
  private strafeRoll = 0;
  private hurtTimer = 0;
  /** seconds the current wound has been open */
  private bleedT = 0;
  /** an untreated wound closed by itself */
  onClot: () => void = () => {};
  onDamage: (amount: number, cause: string) => void = () => {};
  onFootstep: (surface: string) => void = () => {};
  /** touched down after a fall or a jump, at this speed (m/s) */
  onLand: (speed: number) => void = () => {};

  constructor(private terrain: Terrain) {}

  spawn(x: number, y: number, z: number, yaw: number) {
    const R = physics.R;
    if (!this.body) {
      this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + STAND_HALF + RADIUS, z));
      this.collider = physics.world.createCollider(
        R.ColliderDesc.capsule(STAND_HALF, RADIUS).setCollisionGroups(PLAYER_GROUPS).setSolverGroups(PLAYER_GROUPS),
        this.body,
      );
      physics.tag(this.collider, { surface: 'flesh', owner: this });
      this.kcc = physics.world.createCharacterController(0.03);
      this.kcc.setUp({ x: 0, y: 1, z: 0 });
      this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
      this.kcc.setMinSlopeSlideAngle((58 * Math.PI) / 180);
      this.kcc.enableAutostep(0.42, 0.22, true);
      this.kcc.enableSnapToGround(0.45);
      this.kcc.setSlideEnabled(true);
      this.kcc.setApplyImpulsesToDynamicBodies(true);
    } else {
      this.body.setTranslation({ x, y: y + STAND_HALF + RADIUS, z }, true);
    }
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.dead = false;
  }

  private half() {
    return this.crouched ? CROUCH_HALF : STAND_HALF;
  }

  private setCrouch(c: boolean) {
    if (c === this.crouched) return;
    if (!c) {
      // need head room to stand
      const t = this.body.translation();
      const top = t.y - this.half() - RADIUS;
      const hit = physics.raycast({ x: t.x, y: top + 0.5, z: t.z }, { x: 0, y: 1, z: 0 }, STAND_HALF * 2 + RADIUS - 0.4, SHOT_GROUPS, this.collider);
      if (hit) return;
    }
    const feet = this.body.translation().y - this.half() - RADIUS;
    this.crouched = c;
    this.collider.setShape(new physics.R.Capsule(this.half(), RADIUS));
    this.body.setTranslation({ x: this.pos.x, y: feet + this.half() + RADIUS, z: this.pos.z }, true);
    physics.world.propagateModifiedBodyPositionsToColliders();
  }

  /** Mouse look happens every render frame for responsiveness. */
  look(input: Input, sensMul = 1) {
    if (this.dead) return;
    this.yaw -= input.mouseDX * this.sensitivity * sensMul;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouseDY * this.sensitivity * sensMul, -1.5, 1.5);
  }

  /** Fixed-step movement. */
  step(h: number, input: MoveInput) {
    this.prevPos.copy(this.pos);
    this.prevStepPhase = this.stepPhase;
    this.prevLean = this.lean;
    this.prevMoving = this.moving;
    if (this.dead) return;
    const v = this.vitals;

    if (input.pressedFixed('KeyC') || input.pressedFixed('ControlLeft')) this.setCrouch(!this.crouched);

    const fwd = (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0);
    const str = (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0);
    const wantsSprint = input.held('ShiftLeft') && fwd > 0 && !this.aiming && !this.crouched;
    const walk = input.held('AltLeft');
    this.sprinting = wantsSprint && v.stamina > 4 && this.grounded;

    const enc = Math.max(0, this.weightKg - 18) * 0.012; // encumbrance
    let speed = this.crouched ? 1.9 : walk ? 1.7 : 4.0;
    if (this.sprinting) speed = 6.2;
    if (this.aiming) speed = Math.min(speed, this.crouched ? 1.2 : 1.9);
    if (fwd < 0) speed *= 0.75;
    speed *= Math.max(0.55, 1 - enc) * (v.health < 30 ? 0.8 : 1);
    if (this.stumble > 0) {
      this.stumble = Math.max(0, this.stumble - h);
      speed *= 1 - Math.min(0.6, this.stumble * 1.6);
    }

    const wish = new THREE.Vector3(str, 0, -fwd);
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const target = wish.multiplyScalar(speed);
    const accel = this.grounded ? (wish.lengthSq() > 0 ? 11 : 13) : 1.6;
    const k = 1 - Math.exp(-accel * h);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;

    // Jumping forgives a little: pressed just before landing it still fires on touchdown,
    // and for a moment after running off an edge the ground still counts.
    this.airT = this.grounded ? 0 : this.airT + h;
    this.jumpWish = input.pressedFixed('Space') ? 0 : this.jumpWish + h;
    if (this.jumpWish < 0.13 && (this.grounded || (this.airT < 0.11 && this.vel.y <= 0)) && v.stamina > 12 && !this.crouched) {
      this.vel.y = 4.4;
      v.stamina -= 14;
      this.staminaDelay = 1.2;
      this.grounded = false;
      this.jumpWish = 1;
      this.airT = 1;
      audio.jump();
    }
    this.vel.y -= 9.81 * 1.35 * h;
    if (this.grounded && this.vel.y < 0) this.vel.y = -1.5;

    const desired = { x: this.vel.x * h, y: this.vel.y * h, z: this.vel.z * h };
    this.kcc.computeColliderMovement(this.collider, desired, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS);
    const mv = this.kcc.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    // velocity actually achieved (wall slides etc.)
    if (Math.abs(mv.y - desired.y) > 1e-4 && this.vel.y > 0 && mv.y < desired.y * 0.5) this.vel.y = 0;
    if (!wasGrounded && this.grounded) this.land(this.lastFallSpeed);
    if (!this.grounded) this.lastFallSpeed = this.vel.y;

    this.pos.set(next.x, next.y - this.half() - RADIUS, next.z);
    const hs = Math.hypot(mv.x, mv.z) / h;
    this.moving = THREE.MathUtils.clamp(hs / 6.2, 0, 1);

    // stamina
    if (this.sprinting && hs > 1) {
      v.stamina = Math.max(0, v.stamina - 11 * h);
      this.staminaDelay = 1.0;
    } else if (this.staminaDelay > 0) {
      this.staminaDelay -= h;
    } else {
      const regen = (v.energy < 20 || v.water < 20 ? 5 : 11) * (this.crouched ? 1.3 : 1);
      v.stamina = Math.min(MAX_STAMINA, v.stamina + regen * h);
    }

    // footsteps
    if (this.grounded && hs > 0.5) {
      const prev = this.stepPhase;
      this.stepPhase += h * (hs * 1.65 + 1.2);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI)) {
        const s = this.surface();
        audio.footstep(s as Surface, hs * (this.crouched ? 0.4 : 1), undefined, this.weightKg);
        this.onFootstep(s);
      }
    }

    // leaning (Q/E), blocked by walls
    const leanTarget = (input.held('KeyE') ? 1 : 0) - (input.held('KeyQ') ? 1 : 0);
    let lt = leanTarget;
    if (lt !== 0) {
      const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(lt);
      const eyeP = { x: this.pos.x, y: this.pos.y + this.eye, z: this.pos.z };
      if (physics.raycast(eyeP, side, 0.55, SHOT_GROUPS, this.collider)) lt = 0;
    }
    this.lean += (lt - this.lean) * (1 - Math.exp(-10 * h));
  }

  private land(vy: number) {
    const s = Math.max(0, -vy);
    this.landVel = -Math.min(s * 0.035, 0.22);
    if (s > 2.5) audio.land(this.surface() as Surface, s);
    // from a height your legs take the fall before you can run on
    if (s > 6.5) this.stumble = Math.min(0.5, (s - 6.5) * 0.09);
    this.onLand(s);
    if (s > 9.5) {
      const dmg = (s - 9.5) * 14 * this.fallMult;
      this.damage(dmg, 'fall');
      if (s > 13) this.bleed();
    }
  }

  surface(): string {
    const hit = physics.raycast({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 0.8, SHOT_GROUPS, this.collider);
    if (hit?.tag && hit.tag.surface !== 'grass') return hit.tag.surface;
    if (hit && hit.tag?.surface === 'grass') return this.terrain.surfaceAt(this.pos.x, this.pos.z);
    return this.terrain.surfaceAt(this.pos.x, this.pos.z);
  }

  damage(amount: number, cause: string) {
    if (this.dead) return;
    this.vitals.health = Math.max(0, this.vitals.health - amount);
    this.hurtTimer = 0.4;
    this.lastCause = cause;
    audio.hurt();
    this.onDamage(amount, cause);
    if (this.vitals.health <= 0) this.dead = true;
  }

  /** Slow vitals simulation (seconds). */
  tickVitals(dt: number) {
    const v = this.vitals;
    if (this.dead) return;
    const exertion = this.sprinting ? 2.4 : this.moving > 0.1 ? 1.3 : 1;
    v.energy = Math.max(0, v.energy - 0.045 * exertion * dt);
    v.water = Math.max(0, v.water - 0.07 * exertion * this.thirstMult * dt);
    // An open wound costs about one health a second. Left alone it closes in the end, at a
    // price most of a bandage's worth of health; a bandage stops it there and then.
    if (v.bleeding) {
      this.damageQuiet(1.0 * dt, 'blood loss');
      this.bleedT += dt;
      if (this.bleedT > BLEED_TIME && !this.dead) {
        v.bleeding = false;
        this.onClot();
      }
    } else this.bleedT = 0;
    if (v.energy <= 0 || v.water <= 0) this.damageQuiet(0.35 * dt, v.water <= 0 ? 'thirst' : 'hunger');
    else if (v.energy > 60 && v.water > 60 && !v.bleeding && v.health < 100) v.health = Math.min(100, v.health + 0.12 * dt);
    if (this.hurtTimer > 0) this.hurtTimer -= dt;
  }

  private damageQuiet(a: number, cause: string) {
    this.vitals.health = Math.max(0, this.vitals.health - a);
    if (this.vitals.health <= 0 && !this.dead) {
      this.lastCause = cause;
      this.dead = true;
    }
  }

  /** a fresh wound (or a second one): the clock on it starts again */
  bleed() {
    this.vitals.bleeding = true;
    this.bleedT = 0;
  }

  get hurt() {
    return Math.max(0, this.hurtTimer / 0.4);
  }

  /** Camera transform with interpolation + procedural motion. */
  updateCamera(cam: THREE.PerspectiveCamera, dt: number, alpha: number) {
    const p = new THREE.Vector3().lerpVectors(this.prevPos, this.pos, alpha);
    this.alpha = alpha;
    const lean = this.prevLean + (this.lean - this.prevLean) * alpha;
    const moving = this.prevMoving + (this.moving - this.prevMoving) * alpha;
    const targetEye = this.dead ? 0.35 : this.crouched ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-(this.dead ? 3 : 12) * dt));

    // landing dip spring
    this.landVel += (-this.landDip * 120 - this.landVel * 14) * dt;
    this.landDip += this.landVel * dt;

    // head bob (figure-eight), scaled by speed; reduced while aiming
    const amp = moving * (this.aiming ? 0.25 : 1) * (this.grounded ? 1 : 0);
    const ph = this.bobPhase;
    const tb = new THREE.Vector3(Math.cos(ph) * 0.035 * amp, Math.abs(Math.sin(ph)) * 0.05 * amp, 0);
    this.bob.lerp(tb, 1 - Math.exp(-14 * dt));

    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(p.x, p.y + this.eye + this.landDip + this.bob.y, p.z);
    cam.position.addScaledVector(side, this.bob.x + lean * 0.42);
    if (lean !== 0) cam.position.y -= Math.abs(lean) * 0.08;
    // sidestepping tips the view a touch into the movement
    const lateral = this.dead ? 0 : (this.vel.x * side.x + this.vel.z * side.z) / 6.2;
    this.strafeRoll += (THREE.MathUtils.clamp(lateral, -1, 1) * -0.022 - this.strafeRoll) * (1 - Math.exp(-9 * dt));
    const roll = -lean * 0.21 + (this.dead ? 1.2 : 0) + Math.cos(ph) * 0.004 * amp + this.strafeRoll;
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch + this.aimOffset.y, this.yaw + this.aimOffset.x, roll, 'YXZ'));
    cam.updateMatrixWorld();
  }

  /** sideways speed, -1 (left) .. 1 (right), for the weapon to lean with */
  get strafe() {
    return this.strafeRoll / -0.022;
  }

  /** Bob values the viewmodel follows */
  get bobPhase() {
    return this.prevStepPhase + (this.stepPhase - this.prevStepPhase) * this.alpha;
  }

  /** interpolated horizontal speed fraction for render-rate effects */
  get movingSmooth() {
    return this.prevMoving + (this.moving - this.prevMoving) * this.alpha;
  }
}
