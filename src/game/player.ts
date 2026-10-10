// First-person survivor: kinematic character controller (Rapier), movement model,
// stamina / vitals, camera feel (bob, lean, landing dip) and footsteps.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, PLAYER_GROUPS, SHOT_GROUPS, type Surface } from '../core/physics';
import type { Input, MoveInput } from '../core/input';
import { audio } from '../core/audio';
import type { Terrain } from '../world/terrain';
import { LEAN_REACH, MAX_STAMINA } from '../net/protocol';
import { LEG, breaksOnLanding } from '../sim/injury';

const STAND_HALF = 0.56;
const CROUCH_HALF = 0.26;
const RADIUS = 0.3;
const EYE_STAND = 1.64;
const EYE_CROUCH = 1.02;
/** how long an untreated wound bleeds, seconds */
const BLEED_TIME = 42;
/** the gap the character controller keeps from whatever it stands on or touches */
const SKIN = 0.03;
/** how hard the body is held to the ground, m/s: a fall starts from this too */
const PRESS = 1.5;
/** the steepest ground a step is laid along (46°); past it the controller's own slope rules decide */
const FOLLOW_MAX = 1.035;
const FOLLOW_NY = 0.69;
/** how far above its resting height the body is carried over level ground (see alongGround) */
const HOVER = 0.004;
/** stamina at which a sprint gives out, and how much has to come back before the next one */
const WINDED_AT = 4;
const WIND_BACK = 45;

export interface Vitals {
  health: number;
  energy: number;
  water: number;
  stamina: number;
  bleeding: boolean;
  /** a broken leg: no running and no jumping until it is set, or has knitted (see src/sim/injury.ts) */
  broken?: boolean;
}

/** metres a second hurrying in a crouch: creeping is 1.9, a jog upright 4, a sprint 6.2 */
const CROUCH_RUN = 3.3;
/** how much faster somebody moves with their hands empty: at a walk, in a crouch and at a run alike */
const HANDS_FREE = 1.2;
/** and how much slower with a gun held at the eye */
const AIM_SLOW = 0.8;

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
  /** hurrying along in a crouch (Shift held while crouched): faster than creeping, slower than a sprint */
  scurrying = false;
  moving = 0; // 0..1 horizontal speed fraction
  eye = EYE_STAND;
  lean = 0;
  vitals: Vitals = { health: 100, energy: 85, water: 85, stamina: MAX_STAMINA, bleeding: false };
  dead = false;
  /** sitting in a jeep: carried, not walking (see Garage) */
  seated = false;
  /** externally supplied (weapons): ADS + weapon weight slow the player */
  aiming = false;
  weightKg = 0;
  /** nothing is held: whatever is carried is holstered or slung, or is on its way there (said every frame: see Weapons.handsEmpty) */
  emptyHanded = false;
  /** how fast thirst grows, from headwear */
  thirstMult = 1;
  /** fall damage multiplier from footwear */
  fallMult = 1;
  /** how the last damage was dealt (shown on the death screen, sent to the server) */
  lastCause = '';
  sensitivity = 0.0021;
  /** recoil / sway offsets applied on top of yaw/pitch for the camera */
  aimOffset = new THREE.Vector2();

  /**
   * Where the legs are in their stride, as an angle that passes a multiple of π each time a
   * foot comes down. Set from the body (Avatar.stride): the view and the weapon bob to it, so
   * the step that is seen, the one that is felt and the one that is heard are the same step.
   */
  stride = 0;
  /** how fast it is really getting over the ground, m/s (up against a wall, less than it is trying to) */
  private groundSpeed = 0;
  // previous fixed-step values, so render frames can interpolate (no 60 Hz stepping on 144 Hz screens)
  private prevLean = 0;
  private prevMoving = 0;
  private alpha = 1;
  private bob = new THREE.Vector3();
  private landDip = 0;
  private landVel = 0;
  /** what the eye still has to make up after the body was set up or down a step in one go */
  private stepOff = 0;
  private prevStepOff = 0;
  private staminaDelay = 0;
  /** out of breath: no sprinting until some stamina is back (see step) */
  private winded = false;
  /**
   * Seconds for which the legs will not sprint, whatever is held: set by the gun (the trigger
   * pulled, the sights wanted). Nobody runs flat out and shoots: the run is what stops.
   */
  sprintLock = 0;
  private lastFallSpeed = 0;
  /** seconds since the feet last touched the ground, and since jump was last pressed */
  private airT = 0;
  private jumpWish = 1;
  /** a hard landing knocks the pace out of you for a moment */
  private stumble = 0;
  /** seconds this leg has been broken */
  private brokenT = 0;
  onBreak: () => void = () => {};
  onSet: (by: boolean) => void = () => {};
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
      this.kcc = physics.world.createCharacterController(SKIN);
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
    this.stepOff = this.prevStepOff = 0;
    this.winded = false;
    this.yaw = yaw;
    this.pitch = 0;
    this.dead = false;
  }

  /** into a seat, or out of one: sat down, nothing in the world runs into this body */
  seat(on: boolean) {
    this.seated = on;
    if (on && this.crouched) this.setCrouch(false);
    this.collider.setEnabled(!on);
    if (on) {
      this.grounded = true;
      this.moving = this.prevMoving = 0;
      this.lean = this.prevLean = 0;
    }
  }

  /** carried along: where the seat is this frame, and how fast it is going */
  ride(at: THREE.Vector3, vel: THREE.Vector3) {
    this.pos.copy(at);
    this.prevPos.copy(at);
    this.vel.copy(vel);
    this.body.setTranslation({ x: at.x, y: at.y + STAND_HALF + RADIUS, z: at.z }, false);
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
    this.prevLean = this.lean;
    this.prevMoving = this.moving;
    this.prevStepOff = this.stepOff;
    if (this.dead) return;
    const v = this.vitals;
    if (this.seated) {
      // carried: the legs get their breath back, and that is all they do
      this.sprinting = this.scurrying = false;
      this.staminaDelay = Math.max(0, this.staminaDelay - h);
      if (this.staminaDelay <= 0) v.stamina = Math.min(MAX_STAMINA, v.stamina + 14 * h);
      this.lean += (0 - this.lean) * (1 - Math.exp(-10 * h));
      return;
    }

    if (input.pressedFixed('KeyC') || input.pressedFixed('ControlLeft')) this.setCrouch(!this.crouched);

    const fwd = (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0);
    const str = (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0);
    const wantsSprint = input.held('ShiftLeft') && fwd > 0 && !this.aiming && !this.crouched;
    const walk = input.held('AltLeft');
    // Out of breath is a state, not a line to hover on. With only the line, a player who kept
    // Shift down after running dry sprinted for one step each second: the pace and the view
    // twitched every time, and because each of those steps put off the recovery, the stamina
    // never came back at all while the key was held.
    if (v.stamina <= WINDED_AT) this.winded = true;
    else if (v.stamina >= WIND_BACK) this.winded = false;
    this.sprintLock = Math.max(0, this.sprintLock - h);
    // (A sprint is begun on the ground and is not lost by leaving it: whoever jumps at a run comes down at a run.
    // It was lost: with the feet off the ground the pace fell toward a jog, a quarter of it gone by the landing.)
    const fit = !this.winded && !v.broken && this.sprintLock <= 0 && (this.grounded || this.sprinting);
    this.sprinting = wantsSprint && fit;
    // Shift while crouched: a hurried crouch, well short of a sprint and well over a creep.
    // It takes breath as a sprint does (less of it), and the trigger stops it as it stops one.
    this.scurrying = this.crouched && input.held('ShiftLeft') && fwd > 0 && !this.aiming && fit;

    const enc = Math.max(0, this.weightKg - 18) * 0.012; // encumbrance
    let speed = this.crouched ? (this.scurrying ? CROUCH_RUN : 1.9) : walk ? 1.7 : 4.0;
    if (this.sprinting) speed = 6.2;
    // With nothing in the hands, whatever was carried put away, everything is a fifth faster: the one rule, and
    // no exceptions to it. (It was only so upright and at a jog or a run, and what was asked was whether the
    // hands are empty.) With a gun at the eye, a fifth slower. (That was a creep, 1.9 m/s whatever the pace
    // had been. Aiming still ends a sprint: see wantsSprint.)
    if (this.emptyHanded) speed *= HANDS_FREE;
    if (this.aiming) speed *= AIM_SLOW;
    if (fwd < 0) speed *= 0.75;
    speed *= Math.max(0.55, 1 - enc) * (v.health < 30 ? 0.8 : 1);
    if (this.stumble > 0) {
      this.stumble = Math.max(0, this.stumble - h);
      speed *= 1 - Math.min(0.6, this.stumble * 1.6);
    }
    // on a broken leg it is a limp, whatever is asked of it
    if (v.broken) speed = Math.min(speed, LEG.limp);

    const wish = new THREE.Vector3(str, 0, -fwd);
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const target = wish.multiplyScalar(speed);
    const accel = this.grounded ? (wish.lengthSq() > 0 ? 11 : 13) : 1.6;
    const k = 1 - Math.exp(-accel * h);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;
    // Coming to rest is exact. The pace only ever halves its way toward nothing, and while any
    // of it was left pointing downhill the controller read it as meaning to go down and let the
    // press slide the body after it: a pace or two of drift after stopping on a slope.
    if (target.x === 0 && target.z === 0 && Math.hypot(this.vel.x, this.vel.z) < 0.12) this.vel.x = this.vel.z = 0;

    // Jumping forgives a little: pressed just before landing it still fires on touchdown,
    // and for a moment after running off an edge the ground still counts.
    this.airT = this.grounded ? 0 : this.airT + h;
    this.jumpWish = input.pressedFixed('Space') ? 0 : this.jumpWish + h;
    // (a jump costs stamina but never waits for it: feet that will not leave the ground read as a fault)
    if (this.jumpWish < 0.13 && (this.grounded || (this.airT < 0.11 && this.vel.y <= 0)) && !this.crouched && !v.broken) {
      this.vel.y = 4.4;
      v.stamina = Math.max(0, v.stamina - 14);
      this.staminaDelay = 1.2;
      this.grounded = false;
      this.jumpWish = 1;
      this.airT = 1;
      audio.jump();
    }
    this.vel.y -= 9.81 * 1.35 * h;
    if (this.grounded && this.vel.y < 0) this.vel.y = -PRESS;

    const desired = { x: this.vel.x * h, y: this.vel.y * h, z: this.vel.z * h };
    const laid = this.grounded && this.vel.y < 0 ? this.alongGround(desired, h) : 0;
    this.kcc.computeColliderMovement(this.collider, desired, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS);
    let mv = this.kcc.computedMovement();
    // Something stood in the way (a trunk, a wall, a crate). A step laid along a slope slides
    // round such things worse than a level one, and a rising one would carry the body up their
    // face: take the step again the plain way.
    if (laid > 0 && Math.hypot(mv.x, mv.z) < laid * 0.9) {
      desired.x = this.vel.x * h;
      desired.y = this.vel.y * h;
      desired.z = this.vel.z * h;
      this.kcc.computeColliderMovement(this.collider, desired, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS);
      mv = this.kcc.computedMovement();
    }
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    // velocity actually achieved (wall slides etc.)
    if (Math.abs(mv.y - desired.y) > 1e-4 && this.vel.y > 0 && mv.y < desired.y * 0.5) this.vel.y = 0;
    if (!wasGrounded && this.grounded) this.land(this.lastFallSpeed);
    if (!this.grounded) this.lastFallSpeed = this.vel.y;
    // A stump, a crate or a kerb is taken in one step of the simulation: the body is simply
    // set on top of it, or down off it. The eye is not. It stays where it was and makes the
    // height up over the next fifth of a second, the way a knee gives, so a low thing run
    // over is a step and not a jolt. (Whatever a step rises or falls beyond what a 35° bank
    // would is held back; ground that is merely steep is followed as it comes.)
    this.stepOff *= Math.exp(-10 * h);
    if (wasGrounded && this.grounded) {
      const over = Math.abs(mv.y) - (Math.hypot(mv.x, mv.z) * 0.7 + 0.012);
      if (over > 0) this.stepOff = THREE.MathUtils.clamp(this.stepOff - Math.sign(mv.y) * over, -0.5, 0.5);
    }

    this.pos.set(next.x, next.y - this.half() - RADIUS, next.z);
    const hs = Math.hypot(mv.x, mv.z) / h;
    this.moving = THREE.MathUtils.clamp(hs / 6.2, 0, 1);
    this.groundSpeed = hs;

    // stamina
    if (this.sprinting && hs > 1) {
      v.stamina = Math.max(0, v.stamina - 11 * h);
      this.staminaDelay = 1.0;
    } else if (this.scurrying && hs > 1) {
      v.stamina = Math.max(0, v.stamina - 6 * h);
      this.staminaDelay = 1.0;
    } else if (this.staminaDelay > 0) {
      this.staminaDelay -= h;
    } else {
      const regen = (v.energy < 20 || v.water < 20 ? 5 : 11) * (this.crouched ? 1.3 : 1);
      v.stamina = Math.min(MAX_STAMINA, v.stamina + regen * h);
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

  /** too spent to sprint (the stamina bar says so) */
  get outOfBreath() {
    return this.winded;
  }

  /** A foot of the body has come down (Avatar.footfall): the sound of it, if it is really getting anywhere. */
  footfall() {
    if (!this.grounded || this.dead || this.groundSpeed <= 0.5) return;
    const s = this.surface();
    audio.footstep(s as Surface, this.groundSpeed * (this.crouched ? 0.4 : 1), undefined, this.weightKg);
    this.onFootstep(s);
  }

  /** what the feet would stand on at a spot: anything that stops this body, from knee height down */
  private groundBelow(x: number, z: number) {
    const hit = physics.raycast({ x, y: this.pos.y + 0.5, z }, { x: 0, y: -1, z: 0 }, 1.1, PLAYER_GROUPS, this.collider);
    return hit ? { y: hit.point.y, n: hit.normal } : null;
  }

  /**
   * Lays a step along the ground it is about to cover. Left to itself the controller flattens
   * a level step onto the slope, and the press that holds the body down turns into a pull back
   * downhill: a 20° rise cost a quarter of the pace and 30° nearly half, which is what made
   * the hills feel like glue. The step is aimed at the ground ahead instead and the press made
   * square to the surface, so a climb costs only its own extra length. Anything but open
   * walkable ground under this step (a ledge, a sill, a crate, too steep a bank) is left to
   * the controller exactly as before.
   * @returns how far over the ground the laid step should carry, or 0 if the step was left
   * alone or the ground is level
   */
  private alongGround(d: { x: number; y: number; z: number }, h: number) {
    // (standing still the plain press does: one square to a slope lets the body creep on it)
    const run = Math.hypot(d.x, d.z);
    if (run < 0.002) return 0;
    const from = this.groundBelow(this.pos.x, this.pos.z);
    const to = this.groundBelow(this.pos.x + d.x, this.pos.z + d.z);
    if (!from || !to) return 0;
    const n = from.n;
    // resting on what lies under the middle of the body, not hung on an edge beside it
    if (n.y < FOLLOW_NY || Math.abs(this.pos.y - from.y - ((RADIUS + SKIN) / n.y - RADIUS)) > 0.06) return 0;
    const rise = to.y - from.y;
    // the same face carried on, near enough: not a step up and not a drop
    if (Math.abs(rise + (n.x * d.x + n.z * d.z) / n.y) > 0.03 || Math.abs(rise) > run * FOLLOW_MAX) return 0;
    // Level ground: a floor, a flat roof, the pad a building stands on. There is nothing to
    // follow and nothing to press against, and the press does harm here. The controller asks
    // of every step that touches the ground whether its downward part would slide the body
    // downhill, and stops the sliding if so. On a dead level slab "downhill" is rounding
    // error: whenever it came out the wrong way the whole step was thrown away, which on the
    // police station's floor was more than one step in five. With no downward part the
    // question has one answer, and the body stays down because the ground does not fall away.
    // It is carried a hair above where it would rest, too: a step along a wall is taken in
    // two parts, and the second must not graze the floor and have the question asked again.
    if (n.y > 0.99999 && Math.abs(rise) < 1e-5) {
      // (come off a lip a little high, it is let down to that height rather than left afloat)
      d.y = THREE.MathUtils.clamp(from.y + SKIN + HOVER - this.pos.y, -0.02, HOVER);
      return 0;
    }
    const k = rise > 0 ? run / Math.hypot(run, rise) : 1;
    const press = PRESS * h;
    d.x = d.x * k - n.x * press;
    d.y = rise * k - n.y * press;
    d.z = d.z * k - n.z * press;
    return run * k;
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
      // (boots that take a fall take it off the leg as well)
      if (breaksOnLanding(9.5 + (s - 9.5) * this.fallMult, Math.random())) this.breakLeg();
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
    const exertion = this.sprinting ? 2.4 : this.scurrying ? 1.8 : this.moving > 0.1 ? 1.3 : 1;
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
    // a broken leg knits by itself in the end: nobody is left a cripple for the want of a roll of tape
    if (v.broken) {
      this.brokenT += dt;
      if (this.brokenT > LEG.knits) this.setLeg();
    } else this.brokenT = 0;
  }

  /** a leg breaks (nothing happens to one already broken, or to the dead) */
  breakLeg() {
    if (this.dead || this.vitals.broken) return;
    this.vitals.broken = true;
    this.brokenT = 0;
    this.sprinting = false;
    this.onBreak();
  }

  /** it is set, or has knitted: `by` says which (true = somebody did something for it) */
  setLeg(by = false) {
    if (!this.vitals.broken) return;
    this.vitals.broken = false;
    this.brokenT = 0;
    this.onSet(by);
  }

  /** health put back by rest (beside a fire): not while a wound is open, and not on an empty stomach or a dry mouth */
  rest(amount: number): boolean {
    const v = this.vitals;
    if (this.dead || v.bleeding || v.energy <= 10 || v.water <= 10 || v.health >= 100) return false;
    v.health = Math.min(100, v.health + amount);
    return true;
  }

  /** health lost to something that is not a blow (bad air): no flinch and no cry, only the loss */
  sicken(amount: number, cause: string) {
    if (!this.dead) this.damageQuiet(amount, cause);
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
    // on a broken leg the head drops over it once a stride, and the view tips after it
    const lame = this.vitals.broken && this.grounded ? Math.max(0, Math.sin(ph)) * Math.min(1, moving * 5) : 0;
    const tb = new THREE.Vector3(Math.cos(ph) * 0.035 * amp, Math.abs(Math.sin(ph)) * 0.05 * amp - lame * 0.085, 0);
    this.bob.lerp(tb, 1 - Math.exp(-14 * dt));

    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const step = this.prevStepOff + (this.stepOff - this.prevStepOff) * alpha;
    cam.position.set(p.x, p.y + this.eye + this.landDip + this.bob.y + step, p.z);
    const reach = LEAN_REACH * THREE.MathUtils.lerp(1, 0.74, THREE.MathUtils.clamp((EYE_STAND - this.eye) / (EYE_STAND - EYE_CROUCH), 0, 1));
    cam.position.addScaledVector(side, this.bob.x + lean * reach);
    if (lean !== 0) cam.position.y -= Math.abs(lean) * 0.08;
    // sidestepping tips the view a touch into the movement
    const lateral = this.dead ? 0 : (this.vel.x * side.x + this.vel.z * side.z) / 6.2;
    this.strafeRoll += (THREE.MathUtils.clamp(lateral, -1, 1) * -0.022 - this.strafeRoll) * (1 - Math.exp(-9 * dt));
    const roll = -lean * 0.21 + (this.dead ? 1.2 : 0) + Math.cos(ph) * 0.004 * amp + this.strafeRoll - lame * 0.035;
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch + this.aimOffset.y, this.yaw + this.aimOffset.x, roll, 'YXZ'));
    cam.updateMatrixWorld();
  }

  /** sideways speed, -1 (left) .. 1 (right), for the weapon to lean with */
  get strafe() {
    return this.strafeRoll / -0.022;
  }

  /** Bob values the viewmodel follows */
  get bobPhase() {
    return this.stride;
  }

  /** interpolated horizontal speed fraction for render-rate effects */
  get movingSmooth() {
    return this.prevMoving + (this.moving - this.prevMoving) * this.alpha;
  }
}
