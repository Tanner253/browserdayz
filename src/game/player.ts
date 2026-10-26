// First-person survivor: kinematic character controller (Rapier), movement model,
// stamina / vitals, camera feel (bob, lean, landing dip) and footsteps.

import * as THREE from 'three';
import { NEED, stage } from '../sim/wells';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G_GLASS, groups, physics, PLAYER_GROUPS, SHOT_GROUPS, type Surface } from '../core/physics';
import type { Input, MoveInput } from '../core/input';
import { audio } from '../core/audio';
import type { Terrain } from '../world/terrain';
import { LEAN_REACH, MAX_STAMINA } from '../net/protocol';
import { BLOOD, bloodBack, greyOf, mendsOn, withWound, woundOf } from '../sim/blood';
import { POISON, illFor } from '../sim/sickness';
import { LEG, breaksOnLanding } from '../sim/injury';
import { paceOf, runCost } from '../sim/load';
import { LEGS, SLIDE, SLOPE, degOf, legs, riseOf, slideFall, slideGoesOn, slideJolt, slideOn, type Footing, type Legs } from '../sim/slopes';
import { WADE, tooDeep, wading, type WaterHere } from '../sim/water';

const STAND_HALF = 0.56;
const CROUCH_HALF = 0.26;
/** lying down: as low as the body's own thickness lets it be */
const PRONE_HALF = 0.03;
/** and at a crawl, metres a second */
export const CRAWL = 1.05;
/**
 * Kilograms that were carried for nothing when every one more slowed the legs. No rule of the legs reads it now:
 * on the level and on steep ground alike a load takes breath, and pace only when it is past all running with
 * (src/sim/load.ts, which src/sim/slopes.ts reads as well). It is kept for the inventory screen, which is still
 * handed it.
 */
export const CARRY_LIMIT = 18;
const RADIUS = 0.3;
const EYE_STAND = 1.64;
/** how far under a ceiling the eye is kept (the picture is drawn from eight centimetres in front of it, in every direction it may be turned) */
const HEADROOM = 0.15;
const EYE_CROUCH = 1.02;
/** sat on the ground (the wheel) */
const EYE_SAT = 0.86;
/** lying down, the chin just off the ground */
const EYE_PRONE = 0.36;
/** the gap the character controller keeps from whatever it stands on or touches */
const SKIN = 0.03;
/** finds what stops only a body: the others' bodies, and glass (see Player.apart) */
const BODIES = groups(0xffff, G_GLASS);
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
/** how hard the body is held to the ground, m/s: a fall starts from this too */
const PRESS = 1.5;
/** the steepest ground a step is laid along (46°); past it the controller's own slope rules decide */
const FOLLOW_MAX = 1.035;
const FOLLOW_NY = 0.69;
/** how far above its resting height the body is carried over level ground (see alongGround) */
const HOVER = 0.004;
/** how high over level ground the body's place is, and so its drawn feet: the controller's gap and the hover */
export const STANDS_OVER = SKIN + HOVER;
/** what pulls a body down (m/s²): more than the world's, as every game's is, or a jump hangs in the air */
const GRAVITY = 9.81 * 1.35;
/** stamina at which a sprint gives out, and how much has to come back before the next one */
const WINDED_AT = 4;
const WIND_BACK = 45;
/** ground as steep as an ordinary hillside is at its steepest, rise over run: from here on src/sim/slopes.ts says what the legs can do */
const STEEP = riseOf(SLOPE.steep);
/** what the controller is told it may climb, and stand on without slipping, where nothing is steep: its settings as they have always been (degrees) */
const CLIMB_MAX = 50;
/** up or down a ladder, m/s */
const CLIMB_SPEED = 2.1;
const SLIP_MIN = 58;
/** what it steps up onto without being asked: how high, how deep a tread it needs, and that things that can be pushed count */
const AUTOSTEP: [number, number, boolean] = [0.42, 0.22, true];
/** how hard the body is held to steep open ground, m/s: little, for it is laid along it to the millimetre */
const STEEP_PRESS = 0.3;
/** going down steep ground faster than this over the ground, a body is being carried by it (m/s) */
const RUNS_ON = 0.8;
/** coming down on a steep face faster than this (m/s: a drop of half a metre), a body has fallen onto it and does not keep its feet */
const FELL = 4;
/** a slide has hit something when it makes less than this share of a step; and it is felt when that takes this much of its pace (m/s) */
const STRUCK = 0.5;
const STRUCK_AT = 2.5;
/** what the legs can do on ground that is not steep: everything */
const FIRM: Legs = legs(0, 0);

export interface Vitals {
  health: number;
  energy: number;
  water: number;
  stamina: number;
  /** a wound is open (it is `bleed` that says how fast it runs: this is that being more than nothing) */
  bleeding: boolean;
  /** blood, ml: five litres, and dead at half of it. It is not health: see src/sim/blood.ts */
  blood: number;
  /** what every open wound together is costing, ml a second */
  bleed: number;
  /** a broken leg: no running and no jumping until it is set, or has knitted (see src/sim/injury.ts) */
  broken?: boolean;
  /** seconds of food poisoning left, and of a vitamins' guard (src/sim/sickness.ts) */
  ill?: number;
  guard?: number;
}

/** somebody whole: what a new life starts with */
export const freshVitals = (): Vitals => ({ health: 100, energy: 80, water: 80, stamina: MAX_STAMINA, bleeding: false, blood: BLOOD.full, bleed: 0 });

/** metres a second hurrying in a crouch: creeping is 1.9, a jog upright 4, a sprint 6.2 */
export const CROUCH_RUN = 3.3;
/** how much faster somebody moves with their hands empty: at a walk, in a crouch and at a run alike */
export const HANDS_FREE = 1.2;
/** and how much slower with a gun held at the eye */
export const AIM_SLOW = 0.8;

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
  /** sat down on the ground: the eyes are where a sitting head is (the game says when: see `hold` there) */
  sat = false;
  /** lying down (Z): low, slow, steady, and hard to see */
  prone = false;
  lean = 0;
  vitals: Vitals = { ...freshVitals(), energy: 85, water: 85 };
  /** blood on its way in from a bag: how much is left to come, ml, and how fast */
  drip = { left: 0, rate: 0 };
  dead = false;
  /** sitting in a jeep: carried, not walking (see Garage) */
  seated = false;
  /** in a wager the server alone says when somebody dies (server/arena.ts): this game never lets its own health or blood go below the last of it */
  keepAlive = false;
  /**
   * The battle royale's: health, and nothing else to keep (the owner: "i mspawning in with food and water this doesnt
   * make sense"). No hunger, thirst or blood to lose, no wounds that bleed, no leg broken, no fall hurting this game
   * alone: the server holds the health, and says so.
   */
  arcade = false;
  /** externally supplied (weapons): ADS + weapon weight slow the player */
  aiming = false;
  /** lying on a bipod and aimed (set by the weapons): held where it lies until off the scope */
  braced = false;
  weightKg = 0;
  /** nothing is held: whatever is carried is holstered or slung, or is on its way there (said every frame: see Weapons.handsEmpty) */
  emptyHanded = false;
  /** how fast thirst grows, from headwear */
  thirstMult = 1;
  /** fall damage multiplier from footwear */
  fallMult = 1;
  /**
   * How a landing at this place is felt, as a share of the speed it came down at (1: as it is). The fort is built
   * a fifth bigger than its plan, and what is sized to a body in it stays at a body's size: a drop inside it, down
   * the grate into the cistern or off a wall walk, hurts as the plan's drop did and not a fifth more. Set by the game.
   */
  landsAs: (x: number, y: number, z: number) => number = () => 1;
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
  /** seconds left in which nothing costs any breath (the adrenaline injector) */
  boost = 0;
  /** seconds to the next bout of throwing up, while ill; and what the game does at one */
  private boutT = POISON.every[0];
  onBout: () => void = () => {};
  /** out of breath: no sprinting until some stamina is back (see step) */
  private winded = false;
  /**
   * Seconds for which the legs will not sprint, whatever is held: set by the gun (the trigger
   * pulled, the sights wanted). Nobody runs flat out and shoots: the run is what stops.
   */
  sprintLock = 0;
  /**
   * How the body stands on the ground under it (src/sim/slopes.ts): on its feet, as nearly always; on hands and
   * feet, up or across a face too steep to walk; or not at all, and sliding down one. Nothing on the screen says
   * so yet: it is here for whatever is to.
   */
  footing: Footing = 'firm';
  /** on hands and feet and using them: nothing is held up to aim, as nothing is at a sprint (the weapon reads it) */
  handsBusy = false;
  /** a slide: how fast along the slope (m/s), how fast it is being worked sideways, when it was last going (this body's seconds), how much of its fall the ground has lately taken off it at a blow (m/s: see `jolted`), and when it last struck something that stood in its way and how much of that blow is still to be felt */
  private slide = { v: 0, side: 0, at: -9, took: 0, struck: -9, owed: 0 };
  /** came off a climb for want of breath, and has not half of it back yet: see `step` */
  private spent = false;
  /** the last step pressed down on something that is not the land itself: the body is not standing on open ground (see `step`) */
  private built = false;
  /** how fast the feet came down in the last step, m/s, on the ground (walking down a slope is coming down it) */
  private sink = 0;
  /** the controller's settings as they were last given it: see `slopes` */
  private kccSlopes: [number, number, boolean] = [CLIMB_MAX, SLIP_MIN, true];
  /** seconds this body has been moved for; how long until hands or heels are next heard on steep ground, and how many times they have been */
  private clock = 0;
  private scrabbleT = 0;
  private scrabbles = 0;
  /** how hard the going is underfoot, and how fast a slide, each 0 to 1 and eased: the view shows both */
  private toil = 0;
  private skid = 0;
  /** where a body hauling itself up steep ground is in its reach, as an angle (the view heaves to it), and the view's own seconds (it rattles to them in a slide) */
  private haul = 0;
  private viewT = 0;
  private lastFallSpeed = 0;
  /** the highest the feet have been since they last stood on anything: a fall is measured from there */
  private fallTop = 0;
  /** the last fall that hurt: how far down it was (metres) and how fast at the end of it (said when it kills) */
  lastFall = { drop: 0, speed: 0 };
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
  /**
   * The water over a point, if any (src/sim/water.ts): given by whoever lays the world's waters in. In it the body
   * goes slower the deeper it is, its feet are heard in water, and deep water it does not go into at all.
   */
  water: (x: number, z: number) => WaterHere | null = () => null;
  /** a foot has come down in water (the splash: the game gives it to the effects) */
  onWade: (x: number, y: number, z: number, depth: number) => void = () => {};
  /** how deep the water is where the body stands (0: dry) */
  wet = 0;
  /** touched down after a fall or a jump, at this speed (m/s) */
  onLand: (speed: number) => void = () => {};

  constructor(private terrain: Terrain) {}

  // ---- an admin's powers (the server says who has them: see `setPower` in server/index.ts)

  /** nothing hurts this body, and it neither hungers nor thirsts */
  god = false;
  /** it flies, and through anything: see `flyStep` */
  fly = false;
  /** on a ladder: its line in the world, the way out from its rungs to whoever climbs it, its foot and its top (null: on none) */
  climb: { x: number; z: number; nx: number; nz: number; y0: number; y1: number } | null = null;
  /** the next landing costs nothing (flying was stopped in the air) */
  private softLanding = false;

  setFly(on: boolean) {
    if (on === this.fly || !this.body) return;
    if (on) {
      if (this.prone) this.setProne(false);
      if (this.crouched) this.setCrouch(false);
    }
    this.fly = on;
    // (flying, the body is not moved with the eye: see flyStep; out of it, it is put where the eye has got to)
    if (!on) this.body.setTranslation({ x: this.pos.x, y: this.pos.y + this.half() + RADIUS, z: this.pos.z }, true);
    this.collider.setEnabled(!on && !this.seated);
    this.vel.set(0, 0, 0);
    this.lastFallSpeed = 0;
    this.fallTop = this.pos.y;
    this.softLanding = !on;
    this.sprinting = this.scurrying = false;
    this.steady();
  }

  /** On its feet, whatever the ground was doing with it: set down somewhere, taken into a seat, lifted off to fly. */
  private steady() {
    this.footing = 'firm';
    this.handsBusy = false;
    this.slide.v = this.slide.side = this.slide.took = 0;
    this.spent = false;
    // (set down somewhere, it is not known to stand on open ground until a step has shown what it stands on)
    this.built = true;
  }

  /** Set down in the air by an admin: the landing that follows costs nothing. */
  landSoft() {
    this.softLanding = true;
  }

  /** Flying: where the eyes point is forward, Space is up and Ctrl down, Shift is fast and Alt slow. Nothing is run into. */
  /**
   * On a ladder (src/game/building/ladders.ts, 2026-10-24): W climbs and S goes down it, the body hung off its rungs;
   * at the top it steps off forward onto what the ladder leans on, at the foot it lets go; Space jumps off backward.
   * What is overhead (a hatch shut) stops it, as anything stops a body.
   */
  /**
   * Pushed along the ground by something moving into the body (a door's leaf: src/game/building/draw.ts), through the
   * character controller, so that walls and foundations stop it as they stop a step: what of the push was had (0 to 1).
   * `past`: colliders that do the pushing, and so are not what stops it.
   */
  shove(dx: number, dz: number, past?: ReadonlySet<number>): number {
    const want = Math.hypot(dx, dz);
    if (!this.kcc || this.dead || want < 1e-6) return want < 1e-6 ? 1 : 0;
    const t = this.body.translation();
    this.kcc.computeColliderMovement(this.collider, { x: dx, y: 0, z: dz }, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS, past ? (c) => !past.has(c.handle) : undefined);
    const mv = this.kcc.computedMovement(), next = { x: t.x + mv.x, y: t.y, z: t.z + mv.z };
    this.body.setTranslation(next, true);
    this.pos.set(next.x, this.pos.y, next.z);
    return Math.hypot(mv.x, mv.z) / want;
  }

  private climbStep(h: number, input: MoveInput) {
    const c = this.climb!, t = this.body.translation(), feet = t.y - this.half() - RADIUS;
    const up = (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0);
    const off = (vx: number, vy: number, vz: number) => {
      this.climb = null;
      this.vel.set(vx, vy, vz);
    };
    if (input.pressedFixed('Space')) return off(c.nx * 2.2, 2.4, c.nz * 2.2);
    if (up < 0 && feet <= c.y0 + 0.02) return off(0, 0, 0);
    // (over the top: forward onto it, a little up, and let go there)
    const top = up > 0 && feet >= c.y1 + 0.06;
    const hx = c.x + c.nx * (RADIUS + 0.14), hz = c.z + c.nz * (RADIUS + 0.14), k = Math.min(1, 12 * h);
    const desired = top ? { x: -c.nx * 3 * h, y: 0.5 * h, z: -c.nz * 3 * h } : { x: (hx - t.x) * k, y: up * CLIMB_SPEED * h, z: (hz - t.z) * k };
    this.kcc.computeColliderMovement(this.collider, desired, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS);
    const mv = this.kcc.computedMovement(), next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    this.pos.set(next.x, next.y - this.half() - RADIUS, next.z);
    if (top && Math.hypot(next.x - hx, next.z - hz) > RADIUS + 0.45) off(0, 0, 0);
    this.grounded = false;
    this.moving = up ? 1 : 0;
    this.vel.set(0, up * CLIMB_SPEED, 0);
    this.lastFallSpeed = 0;
    this.fallTop = this.pos.y;
    this.lean += (0 - this.lean) * (1 - Math.exp(-10 * h));
  }

  /** put on a ladder's rungs (from its top, going down it): the body moved there as it stands */
  hang(x: number, y: number, z: number) {
    this.body.setTranslation({ x, y: y + this.half() + RADIUS, z }, true);
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
  }

  private flyStep(h: number, input: MoveInput) {
    const fwd = (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0);
    const str = (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0);
    const up = (input.held('Space') ? 1 : 0) - (input.held('ControlLeft') || input.held('KeyC') ? 1 : 0);
    const speed = input.held('ShiftLeft') ? 48 : input.held('AltLeft') ? 3 : 12;
    const cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const d = new THREE.Vector3(-sy * cp * fwd + cy * str, Math.sin(this.pitch) * fwd + up, -cy * cp * fwd - sy * str);
    if (d.lengthSq() > 1) d.normalize();
    this.vel.copy(d).multiplyScalar(speed);
    this.pos.addScaledVector(this.vel, h);
    // (The body is left where flying began: its collider is off, and moved every step at a flier's speed, Rapier went
    // through all 66,000 of the world's colliders each time, 2.5 to 3.5 ms a step, a fifth of the processor in a
    // flight across the map; 2026-10-20, its own timings. setFly puts it back under the eye. `__flyBody`: as it was.)
    if (import.meta.env.DEV && (globalThis as { __flyBody?: boolean }).__flyBody) this.body.setTranslation({ x: this.pos.x, y: this.pos.y + this.half() + RADIUS, z: this.pos.z }, true);
    this.grounded = false;
    this.moving = 0;
    this.lean += (0 - this.lean) * (1 - Math.exp(-10 * h));
    this.lastFallSpeed = 0;
    this.fallTop = this.pos.y;
    this.stepOff = 0;
    this.vitals.stamina = Math.min(MAX_STAMINA, this.vitals.stamina + 14 * h);
  }

  spawn(x: number, y: number, z: number, yaw: number) {
    this.climb = null;
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
      this.kcc.setMaxSlopeClimbAngle((CLIMB_MAX * Math.PI) / 180);
      this.kcc.setMinSlopeSlideAngle((SLIP_MIN * Math.PI) / 180);
      this.kcc.enableAutostep(...AUTOSTEP);
      this.kcc.enableSnapToGround(0.45);
      this.kcc.setSlideEnabled(true);
      this.kcc.setApplyImpulsesToDynamicBodies(true);
    } else {
      // (on their feet, however they went down: the owner, 2026-10-20, "when a user is respawned they should be
      // standing even if they die crouched")
      if (this.crouched || this.prone) {
        this.crouched = this.prone = false;
        this.collider.setShape(new R.Capsule(STAND_HALF, RADIUS));
      }
      this.body.setTranslation({ x, y: y + STAND_HALF + RADIUS, z }, true);
    }
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    // (set down, not dropped: whatever fall was being counted before is not this body's any more)
    this.lastFallSpeed = 0;
    this.fallTop = y;
    this.stepOff = this.prevStepOff = 0;
    this.winded = false;
    this.steady();
    this.yaw = yaw;
    this.pitch = 0;
    this.dead = false;
  }

  /** into a seat, or out of one: sat down, nothing in the world runs into this body */
  seat(on: boolean) {
    this.seated = on;
    if (on && this.crouched) this.setCrouch(false);
    if (!on) this.body.setTranslation({ x: this.pos.x, y: this.pos.y + this.half() + RADIUS, z: this.pos.z }, true);
    this.collider.setEnabled(!on);
    if (on) {
      this.steady();
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
    this.lastFallSpeed = 0;
    this.fallTop = at.y;
    // (The body is not carried along: its collider is off in a seat (see seat), and nothing asks where it is. Moved every
    // frame, it cost the physics' next step 4 ms of every frame in a helicopter, 0.5 without (2026-10-19, on the owner's
    // flight). Put where the player is on getting out.)
  }

  private half() {
    return this.prone ? PRONE_HALF : this.crouched ? CROUCH_HALF : STAND_HALF;
  }

  /** Down onto the belly, or up off it (to a crouch, if that is how the body was before it lay down). @returns whether it could */
  setProne(on: boolean): boolean {
    if (on === this.prone) return true;
    if (!on) {
      // need head room for what is got up to
      const t = this.body.translation();
      const feet = t.y - this.half() - RADIUS, up = (this.crouched ? CROUCH_HALF : STAND_HALF) * 2 + RADIUS * 2;
      if (physics.raycast({ x: t.x, y: feet + 0.45, z: t.z }, { x: 0, y: 1, z: 0 }, up - 0.55, SHOT_GROUPS, this.collider)) return false;
    }
    const feet = this.body.translation().y - this.half() - RADIUS;
    this.prone = on;
    this.collider.setShape(new physics.R.Capsule(this.half(), RADIUS));
    this.body.setTranslation({ x: this.pos.x, y: feet + this.half() + RADIUS, z: this.pos.z }, true);
    physics.world.propagateModifiedBodyPositionsToColliders();
    return true;
  }

  setCrouch(c: boolean) {
    if (c === this.crouched) return;
    // (lying down, how the body will be when it gets up is all that changes)
    if (this.prone) return void (this.crouched = c);
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
    if (this.dead) {
      // (Whoever dies in the air comes down: jumping, falling, or shot off a roof, the body was left hanging where
      // it died, and the body everybody else was shown lay in the air with it.)
      if (this.body && !this.seated && !this.fly) {
        const under = physics.raycast({ x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 150, SHOT_GROUPS, this.collider);
        const floor = under && under.toi > 0.02 ? under.point.y : this.pos.y;
        if (this.pos.y > floor + 0.01) {
          this.vel.set(0, Math.min(this.vel.y, 0) - GRAVITY * h, 0);
          this.pos.y = Math.max(floor, this.pos.y + this.vel.y * h);
          this.body.setTranslation({ x: this.pos.x, y: this.pos.y + this.half() + RADIUS, z: this.pos.z }, true);
        } else this.vel.set(0, 0, 0);
      }
      return;
    }
    const v = this.vitals;
    // (adrenaline: whatever was spent since the last step is given back, and nobody on it is out of breath)
    if (this.boost > 0) {
      this.boost = Math.max(0, this.boost - h);
      v.stamina = MAX_STAMINA;
      this.winded = false;
    }
    if (this.fly) return void this.flyStep(h, input);
    if (this.climb && !this.seated) return void this.climbStep(h, input);
    if (this.seated) {
      // carried: the legs get their breath back, and that is all they do
      this.sprinting = this.scurrying = false;
      this.staminaDelay = Math.max(0, this.staminaDelay - h);
      if (this.staminaDelay <= 0) v.stamina = Math.min(MAX_STAMINA, v.stamina + 14 * h);
      this.lean += (0 - this.lean) * (1 - Math.exp(-10 * h));
      return;
    }

    // Z: down onto the belly, and up again. Lying down, C gets up as far as a crouch and Space all the way.
    let rose = false;
    if (input.pressedFixed('KeyZ') && this.grounded && !v.broken) this.setProne(!this.prone);
    else if (this.prone && input.pressedFixed('KeyC')) {
      this.crouched = true;
      if (!this.setProne(false)) this.crouched = false;
    } else if (this.prone && input.pressedFixed('Space')) {
      this.crouched = false;
      // (Space gets up: it does not also jump)
      rose = this.setProne(false);
    // (C, and only C: Ctrl with a key is the browser's, and a crouch on it was a tab shut by a sprint)
    } else if (input.pressedFixed('KeyC')) this.setCrouch(!this.crouched);
    // Space from a crouch on the ground stands the body up, and it jumps as from standing (the owner, 2026-10-20:
    // "jumping when crouched should stand the user up"; nothing happened, and players did not know they were crouched).
    // Only pressed on the ground: a crouch taken in the air, to tuck the legs over a ledge, is as it was, and Space
    // pressed in the air and kept for the landing does not stand up a body that lands crouched ("dont change how
    // crouch jumping works, its necessary for some jump spots").
    else if (this.crouched && this.grounded && input.pressedFixed('Space')) this.setCrouch(false);

    const fwd = this.braced ? 0 : (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0);
    const str = this.braced ? 0 : (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0);
    const wantsSprint = input.held('ShiftLeft') && fwd > 0 && !this.aiming && !this.crouched && !this.prone;
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
    // (and nobody runs on the blood of a head that swims: see src/sim/blood.ts)
    const fit = !this.winded && !v.broken && !this.faint && this.sprintLock <= 0 && (this.grounded || this.sprinting);

    // Which way is asked, and what the ground has to say about it (src/sim/slopes.ts). Nearly always nothing:
    // `on` is null on a floor, on a stair, on anything that is not the open ground, and on ground no steeper than
    // a hillside, and then every line from here down does what it did before there was any such rule.
    const wish = new THREE.Vector3(str, 0, -fwd);
    const going = wish.lengthSq() > 0;
    if (going) wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    // (Open ground, and stood on: a body whose last step pressed down on anything that is not the land is on that,
    // whatever lies under its middle. At the head of the bunker's stair there is a slot between the pad and the top
    // step, and what is first under a body astride it is the side of the pit a metre down, at seventy degrees: by
    // that alone it was "sliding" on a floor, and took two seconds to get onto the stair.)
    const under = this.grounded && !this.built ? this.openGround(this.pos.x, this.pos.z, this.pos.y) : null;
    let on = under && under.rise >= STEEP ? under : null;
    // (At the foot of a steep face the ground under the middle of the body is still the gentle ground it is
    // leaving, and a round foot is already against the face: so the face a body is walking up into counts from
    // the moment it is touched. Otherwise the controller's own limit stood it dead at the foot of every bank.)
    if (!on && under && going && this.footing !== 'slide') {
      const ahead = this.openGround(this.pos.x + wish.x * (RADIUS + 0.12), this.pos.z + wish.z * (RADIUS + 0.12), this.pos.y);
      if (ahead && ahead.rise >= STEEP && wish.x * ahead.x + wish.z * ahead.z < 0) on = ahead;
    }
    const stands = on === under;
    // (how much of the way asked is up the fall line, and how fast the body is going down it now)
    const up = on ? -(wish.x * on.x + wish.z * on.z) : 0, downhill = on ? this.vel.x * on.x + this.vel.z * on.z : 0;
    // (Whoever has come off a climb for want of breath does not go at one again until half of it is back. With
    // only the breath that ends being winded, a body held at a cliff went up it a yard and slid back every few
    // seconds for as long as the key was down: to and fro on the spot, which is also what the server's check on
    // bodies walked by a program looks for.)
    if (this.spent && v.stamina >= MAX_STAMINA / 2) this.spent = false;
    const lg = on ? legs(on.rise, up, { low: this.crouched || this.prone, broken: !!v.broken, kg: this.weightKg, winded: this.winded || this.spent }) : FIRM;
    // A slide ends where the ground eases, as a fall ends: at whatever speed it was coming down. It begins
    // where there is no footing: going down what is a scramble going up, carried onto such ground from above
    // already going, or out of breath on a climb.
    if (this.slide.took > 0) this.slide.took = Math.max(0, this.slide.took - SLIDE.absorb * h);
    if (this.footing === 'slide' && (!on || !slideGoesOn(this.slide.v, on.rise))) this.endSlide();
    // (at the pace it has along the slope already: what it has over the ground, and what it was coming down at)
    else if (this.footing !== 'slide' && on && stands && degOf(on.rise) >= SLOPE.scramble && (lg.slides || downhill > SLIDE.begins)) {
      if (lg.slides && up >= LEGS.letGo) this.spent = true;
      this.beginSlide((downhill + Math.max(0, this.sink) * on.rise) / Math.hypot(1, on.rise), on.rise);
    }
    const sliding = this.footing === 'slide' && !!on;

    this.sprinting = wantsSprint && fit && lg.sprint && !sliding;
    // Shift while crouched: a hurried crouch, well short of a sprint and well over a creep.
    // It takes breath as a sprint does (less of it), and the trigger stops it as it stops one.
    this.scurrying = this.crouched && !this.prone && input.held('ShiftLeft') && fwd > 0 && !this.aiming && fit && lg.sprint && !sliding;

    let speed = this.prone ? CRAWL : this.crouched ? (this.scurrying ? CROUCH_RUN : 1.9) : walk ? 1.7 : 4.0;
    // (parched, nobody runs flat out)
    if (this.sprinting) speed = 6.2 * (stage(v.water) === 2 ? NEED.slow : 1);
    // With nothing in the hands, whatever was carried put away, everything is a fifth faster: the one rule, and
    // no exceptions to it. (It was only so upright and at a jog or a run, and what was asked was whether the
    // hands are empty.) With a gun at the eye, a fifth slower. (That was a creep, 1.9 m/s whatever the pace
    // had been. Aiming still ends a sprint: see wantsSprint.)
    if (this.emptyHanded) speed *= HANDS_FREE;
    if (this.aiming) speed *= AIM_SLOW;
    if (fwd < 0) speed *= 0.75;
    // (on the level what is carried takes breath, not pace, until it is past all running with: src/sim/load.ts)
    speed *= paceOf(this.weightKg) * (v.health < 30 ? 0.8 : 1);
    // (in water, slower the deeper: under half at the waist, as in DayZ)
    this.wet = this.water(this.pos.x, this.pos.z)?.depth ?? 0;
    speed *= wading(this.wet);
    if (this.stumble > 0) {
      this.stumble = Math.max(0, this.stumble - h);
      speed *= 1 - Math.min(0.6, this.stumble * 1.6);
    }
    // on a broken leg it is a limp, whatever is asked of it
    if (v.broken) speed = Math.min(speed, LEG.limp);
    if (on) {
      // Steep ground. Up it or across it the pace is held to what the way allows; down it the body is carried,
      // faster than it walks but never faster than it sprints on the level (nor than the server lets anybody go).
      if (lg.pace < speed) speed = lg.pace;
      else if (up < 0 && lg.carried > 1) speed = Math.min(speed * lg.carried, Math.max(speed, 6.2 * (this.emptyHanded ? HANDS_FREE : 1) * paceOf(this.weightKg)));
      // (a climb there is no breath for is not begun: the body stands at the foot of it)
      if (lg.slides && !stands) speed = 0;
      // (a scramble stops for the gun as a sprint does: the hands cannot do both. Not on a climb, where they cannot be spared.)
      if (lg.hands && lg.cling <= 0 && this.sprintLock > 0) speed = 0;
    }

    if (sliding && on) {
      // Sliding, the legs decide nothing: down the fall line, as fast as the drop has made it and the ground lets
      // it, and worked a little to one side or the other by the way asked.
      const low = this.crouched || this.prone, run = Math.hypot(1, on.rise), ax = -on.z, az = on.x;
      // (Where the ground eases under it, the ground takes some of its fall off it at a blow: felt as a landing
      // at that speed is. Left its pace along the slope, it went over gentler ground half as fast again as anybody runs.)
      this.jolted(slideJolt(-this.lastFallSpeed, this.slide.v, on.rise));
      this.slide.v = slideOn(this.slide.v, on.rise, h, low, GRAVITY);
      // (where the ground rubs too hard to carry a body, dug in on a face only just too steep to walk, it can still push itself down it)
      if (going && up < LEGS.letGo && this.slide.v < SLIDE.push) this.slide.v = Math.min(SLIDE.push, this.slide.v + 6 * h);
      this.slide.side += ((wish.x * ax + wish.z * az) * SLIDE.steer * (low ? SLIDE.low : 1) - this.slide.side) * (1 - Math.exp(-SLIDE.turn * h));
      this.vel.x = (on.x * this.slide.v) / run + ax * this.slide.side;
      this.vel.z = (on.z * this.slide.v) / run + az * this.slide.side;
    } else {
      const target = wish.clone().multiplyScalar(speed);
      // (going across a steep face the body is carried down it a little with every step)
      if (on && going) {
        target.x += on.x * lg.drift;
        target.z += on.z * lg.drift;
      }
      const accel = this.grounded ? (target.lengthSq() > 0 ? 11 : 13) : 1.6;
      const k = 1 - Math.exp(-accel * h);
      // Once going down steep ground the legs cannot stop the body as they do on the level, and past a point
      // cannot stop it at all: it runs on until it is turned across the slope or up it, or goes down on a knee.
      const runsOn = !!on && lg.runsOn > 0 && downhill > RUNS_ON && (!going || up < -0.2);
      if (on && (lg.brake < 1 || runsOn)) {
        const want = target.x * on.x + target.z * on.z, to = runsOn ? Math.max(want, lg.runsOn) : want;
        // (the part of the pace that is down the fall line is slowed by what is left of the brake; the rest as ever)
        const px = this.vel.x - on.x * downhill, pz = this.vel.z - on.z * downhill, d = downhill + (to - downhill) * (downhill > 0 && to < downhill ? 1 - Math.exp(-accel * lg.brake * h) : k);
        this.vel.x = px + (target.x - on.x * want - px) * k + on.x * d;
        this.vel.z = pz + (target.z - on.z * want - pz) * k + on.z * d;
      } else {
        this.vel.x += (target.x - this.vel.x) * k;
        this.vel.z += (target.z - this.vel.z) * k;
      }
      // Coming to rest is exact. The pace only ever halves its way toward nothing, and while any
      // of it was left pointing downhill the controller read it as meaning to go down and let the
      // press slide the body after it: a pace or two of drift after stopping on a slope.
      if (target.x === 0 && target.z === 0 && !runsOn && Math.hypot(this.vel.x, this.vel.z) < 0.12) this.vel.x = this.vel.z = 0;
    }

    // Jumping forgives a little: pressed just before landing it still fires on touchdown,
    // and for a moment after running off an edge the ground still counts.
    this.airT = this.grounded ? 0 : this.airT + h;
    this.jumpWish = input.pressedFixed('Space') && !rose ? 0 : this.jumpWish + h;
    // (a jump costs stamina but never waits for it: feet that will not leave the ground read as a fault)
    // (and there is no jumping up a scramble, or out of a slide: the feet have nothing to push off)
    if (this.jumpWish < 0.13 && (this.grounded || (this.airT < 0.11 && this.vel.y <= 0)) && !this.crouched && !this.prone && !v.broken && lg.jump && !sliding) {
      this.vel.y = 4.4;
      v.stamina = Math.max(0, v.stamina - 14);
      this.staminaDelay = 1.2;
      this.grounded = false;
      this.jumpWish = 1;
      this.airT = 1;
      audio.jump(this.surface() as Surface);
    }
    this.vel.y -= GRAVITY * h;
    if (this.grounded && this.vel.y < 0) this.vel.y = -PRESS;

    const pace = { x: this.vel.x * h, z: this.vel.z * h }, wasOnGround = this.grounded;
    // (over a basement's open steps the ground is not there: see physics.through; and somebody already standing in
    // this body is not there either: see apart)
    const at = this.collider.translation(), through = this.apart(at, physics.through(at.x, at.z));
    // (Deep water is not gone into: a step that would take the body into it is not taken, along whichever way it
    // would, so that it slides along the edge. From deep water, as a body put down in it would be, it walks out and
    // never further in.)
    const here = this.water(at.x, at.z)?.depth ?? 0;
    const deeper = (x: number, z: number) => {
      const d = this.water(x, z)?.depth ?? 0;
      return tooDeep(d) && d > here;
    };
    if (deeper(at.x + pace.x, at.z)) pace.x = 0;
    if (deeper(at.x, at.z + pace.z)) pace.z = 0;
    const desired = { x: pace.x, y: this.vel.y * h, z: pace.z };
    // On steep open ground the controller is told it may climb what is under the feet and stand on it without
    // slipping: its own two limits are what made a wall of fifty degrees and a chute of fifty-eight, and what the
    // legs can do there is decided above. Everywhere else they are what they have always been.
    this.slopes(on ? Math.min(85, Math.max(CLIMB_MAX, degOf(on.rise) + 8)) : CLIMB_MAX, on ? 86 : SLIP_MIN, !on);
    const laid = this.grounded && this.vel.y < 0 ? (on ? this.alongSteep(desired, h, on) : this.alongGround(desired, h)) : 0;
    this.kcc.computeColliderMovement(this.collider, desired, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS, through);
    let mv = this.kcc.computedMovement();
    // Something stood in the way (a trunk, a wall, a crate). A step laid along a slope slides
    // round such things worse than a level one, and a rising one would carry the body up their
    // face: take the step again the plain way.
    let landed = this.kcc.computedGrounded();
    if (laid > 0 && Math.hypot(mv.x, mv.z) < laid * 0.9) {
      const first = { x: mv.x, y: mv.y, z: mv.z };
      desired.x = pace.x;
      desired.y = this.vel.y * h;
      desired.z = pace.z;
      this.kcc.computeColliderMovement(this.collider, desired, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS, through);
      mv = this.kcc.computedMovement();
      // (On steep ground the plain step is as often the worse of the two: its press, straight down, is a pull
      // back down the hill that a slow climb cannot make head against. Whichever got further is kept.)
      if (on && Math.hypot(first.x, first.z) >= Math.hypot(mv.x, mv.z)) mv = first;
      else landed = this.kcc.computedGrounded();
      // Where neither gets anywhere on a steep face, the step is taken a third way: straight along the face under
      // the middle of the body and a hair clear of it, which is the simplest thing it could be. Open ground is
      // never left standing in front of a body as a wall.
      if (on && Math.hypot(mv.x, mv.z) < laid * 0.5) {
        const n = on.n, len = Math.hypot(pace.x, pace.z), rise = -(n.x * pace.x + n.z * pace.z) / n.y, k = rise > 0 ? len / Math.hypot(len, rise) : 1;
        this.kcc.computeColliderMovement(this.collider, { x: pace.x * k + n.x * 0.002, y: rise * k + n.y * 0.002, z: pace.z * k + n.z * 0.002 }, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS, through);
        const m = this.kcc.computedMovement();
        if (Math.hypot(m.x, m.z) > Math.hypot(mv.x, mv.z)) {
          mv = m;
          landed = true;
        }
      }
    }
    // A step that leans on a wall is taken along the wall. ("when i walk up stairs and my shoulder rubs against
    // the side of the wall my character gets stuck in the kamenka 2 story buildings", 2026-10-12. Measured on that
    // stair with the body's own physics: straight up it, 53 steps and none lost; with A or D held as well, 420
    // steps and still not at the top, on every leg of it.) The controller climbs a step only if the way on from
    // the top of it is clear in the direction the body is going; a step that goes partly into the wall or the rail
    // beside the stair is not clear that way, so the stair was not climbed: the body slid along the riser into the
    // wall and stood there. So where a step comes to little and something upright stopped it, it is taken again
    // two other ways for each such thing, along it and straight at it, and whichever gets furthest is kept. (Along
    // the wall it runs up the stair; straight at the wall it goes nowhere and is not kept; straight at the riser
    // it is climbed. Nothing is guessed about which is which.)
    // (And a step that only slides along something upright is tried straight at it as well, and that is kept if
    // it climbs: a stair that begins in a doorway is got onto by somebody who comes at it along the wall, who
    // otherwise slid on past it.)
    // (a step laid up steep ground covers less of the ground than its pace by its own nature: it is asked only whether it covered what it was laid to)
    const want = on && laid > 0 ? laid : Math.hypot(pace.x, pace.z), got = Math.hypot(mv.x, mv.z);
    if (wasOnGround && want > 1e-4 && got < want * 0.9) {
      const hard = got < want * 0.55;
      const uprights: [number, number][] = [];
      for (let i = 0; i < this.kcc.numComputedCollisions() && uprights.length < 3; i++) {
        const n = this.kcc.computedCollision(i)?.normal1;
        if (!n || Math.abs(n.y) > 0.3) continue;
        const l = Math.hypot(n.x, n.z) || 1, nx = n.x / l, nz = n.z / l;
        if (pace.x * nx + pace.z * nz < -want * 0.05 && !uprights.some(([ux, uz]) => ux * nx + uz * nz > 0.97)) uprights.push([nx, nz]);
      }
      let best = got, climbed = false;
      let kept = { x: mv.x, y: mv.y, z: mv.z };
      for (const [nx, nz] of uprights) {
        const into = pace.x * nx + pace.z * nz;
        const ways = [{ x: nx * into, z: nz * into, at: true }, ...(hard ? [{ x: pace.x - nx * into, z: pace.z - nz * into, at: false }] : [])];
        for (const go of ways) {
          if (climbed || Math.hypot(go.x, go.z) < want * 0.15) continue;
          this.kcc.computeColliderMovement(this.collider, { x: go.x, y: this.vel.y * h, z: go.z }, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS, through);
          const m = this.kcc.computedMovement(), far = Math.hypot(m.x, m.z);
          // (straight at it and up onto it; or, where the step came to nothing, whichever way gets furthest)
          const up = go.at && m.y > 0.03 && far > want * 0.2;
          if (up || (hard && far > best * 1.25 + 1e-4)) {
            best = far;
            climbed = up;
            kept = { x: m.x, y: m.y, z: m.z };
            landed = this.kcc.computedGrounded();
          }
        }
      }
      mv = kept;
      // A step on open ground that came to nothing, and went into nothing upright, is taken again without the press
      // down. Within the controller's skin of a face, a step away from it that also pressed down was met by the face
      // at once, left with only its press, and the ground stopped that; and a body pressed a hair into the land
      // against a car met the land at once with every pressing step, whichever way. On level floors there is no press
      // (alongGround), but a car stands on the land: a body that had walked into one could not walk away (the owner,
      // 2026-10-20: "when you walk up against vehicles the player gets stuck, like the walls fix in kamenka").
      if (!on && !uprights.length && Math.hypot(mv.x, mv.z) < want * 0.5 && desired.y < 0) {
        this.kcc.computeColliderMovement(this.collider, { x: pace.x, y: 0, z: pace.z }, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS, through);
        const m = this.kcc.computedMovement();
        if (Math.hypot(m.x, m.z) > Math.hypot(mv.x, mv.z)) mv = { x: m.x, y: m.y, z: m.z };
      }
    }
    // What the body pressed down on in this step, for the next. On the land and on nothing else, it stands on
    // open ground; on anything that is not the land itself (a floor, a stair, a rock, a roof), it does not; and a
    // step that pressed on nothing at all leaves that as it was.
    let land = false, other = false;
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const c = this.kcc.computedCollision(i);
      if (!c?.collider || c.normal1.y <= 0.1) continue;
      if (c.collider.shapeType() === physics.R.ShapeType.HeightField) land = true;
      else if (c.normal1.y > 0.3) other = true;
    }
    if (land || other) this.built = other;
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    // (and whatever moved it, a step or the slope of the bed under it, it is not taken further into deep water)
    const after = this.water(next.x, next.z)?.depth ?? 0;
    if (tooDeep(after) && after > here) {
      next.x = t.x;
      next.z = t.z;
    }
    this.body.setNextKinematicTranslation(next);
    const wasGrounded = this.grounded;
    this.grounded = landed;
    // velocity actually achieved (wall slides etc.)
    if (Math.abs(mv.y - desired.y) > 1e-4 && this.vel.y > 0 && mv.y < desired.y * 0.5) this.vel.y = 0;
    // A fall is measured by how far the body really came down, and it lands no faster than a fall of that
    // height makes it. (It was measured by the speed alone, and that is only a number kept from step to step:
    // whatever left it too large (the body held where it could not get down, or the number carried over from
    // before a new start) was a landing at that speed the next time the feet touched ground, and a death by
    // a fall of no height at all.)
    const feet = next.y - this.half() - RADIUS;
    if (!wasGrounded && this.grounded) {
      const drop = Math.max(0, this.fallTop - feet), fall = Math.max(this.lastFallSpeed, -(Math.sqrt(2 * GRAVITY * drop) + 1));
      // Coming down on open ground too steep to stand on is not the end of a fall. The slope takes what came
      // square at it, by the same rule as any landing, and the rest goes on down it as a slide.
      const face = this.built ? null : this.openGround(next.x, next.z, feet);
      // (A fall, not a hop: a body climbing leaves the face by a centimetre now and then, where one face of the hill
      // meets the next, and is back on it a step later at the pace it is pressed to the ground with. Taken for a
      // fall, that threw a climber off the hill.)
      if (face && degOf(face.rise) >= SLOPE.scramble && -fall > FELL) {
        const run = Math.hypot(1, face.rise), out = this.vel.x * face.x + this.vel.z * face.z;
        this.land(-Math.max(0, (-fall - out * face.rise) / run), drop);
        this.beginSlide((out - fall * face.rise) / run, face.rise);
      } else this.land(fall, drop);
    }
    if (this.grounded) this.fallTop = feet;
    else {
      this.lastFallSpeed = this.vel.y;
      this.fallTop = Math.max(this.fallTop, feet);
    }
    if (on && sliding && this.footing === 'slide') {
      if (!this.grounded) {
        // Carried off an edge. It is a fall now, already coming down as fast as the slide was.
        this.vel.y = Math.min(this.vel.y, -slideFall(this.slide.v, on.rise));
        this.footing = 'firm';
        this.slide.v = this.slide.side = 0;
      } else {
        // Stopped short by something that stands in the way (a trunk, a rock, a wall): what it took of the
        // slide's pace is a blow, reckoned as a landing at that speed is.
        const run = Math.hypot(pace.x, pace.z), made = run > 1e-4 ? Math.max(0, mv.x * pace.x + mv.z * pace.z) / (run * run) : 1;
        // (a slide barely begun has nothing to lose, and a step of a millimetre says nothing either way)
        if (made < STRUCK && this.slide.v > 1) {
          // (One blow, however many steps the body is held against the thing: no more is felt of it than the pace
          // the slide had when it struck. Pinned on a trunk with the hill still pulling, it was paid for half as much again.)
          if (this.clock - this.slide.struck > 0.5) this.slide.owed = this.slide.v;
          this.slide.struck = this.clock;
          const lost = this.slide.v * (1 - made), felt = Math.min(lost, this.slide.owed);
          this.slide.v -= lost;
          this.slide.owed -= felt;
          this.jolted(felt);
        }
      }
      // A slide is a fall that the ground is rubbing on. Should it end at an edge, or where the ground eases, it
      // ends as a fall from as high as would have made it this fast.
      const down = this.grounded ? slideFall(this.slide.v, on.rise) : -this.vel.y;
      this.lastFallSpeed = -down;
      this.fallTop = feet + (down * down) / (2 * GRAVITY);
    }
    // A stump, a crate or a kerb is taken in one step of the simulation: the body is simply
    // set on top of it, or down off it. The eye is not. It stays where it was and makes the
    // height up over the next fifth of a second, the way a knee gives, so a low thing run
    // over is a step and not a jolt. (Whatever a step rises or falls beyond what a 35° bank
    // would is held back; ground that is merely steep is followed as it comes.)
    this.stepOff *= Math.exp(-10 * h);
    // (on steep open ground every step rises or falls more than that, and none of it is a kerb)
    if (wasGrounded && this.grounded && !on) {
      const over = Math.abs(mv.y) - (Math.hypot(mv.x, mv.z) * 0.7 + 0.012);
      if (over > 0) this.stepOff = THREE.MathUtils.clamp(this.stepOff - Math.sign(mv.y) * over, -0.5, 0.5);
    }

    this.pos.set(next.x, next.y - this.half() - RADIUS, next.z);
    const hs = Math.hypot(mv.x, mv.z) / h;
    this.moving = THREE.MathUtils.clamp(hs / 6.2, 0, 1);
    this.groundSpeed = hs;

    // How the body stands, for whatever shows or sounds it. On hands and feet wherever the ground asks for them
    // and they are being used: going anywhere on a scramble, and even hanging still on a climb.
    const along = Math.hypot(mv.x, mv.y, mv.z) / h;
    this.sink = this.grounded ? -mv.y / h : 0;
    // (Once on hands and feet a body stays on them until the ground is plainly easier: a face that is fifty degrees
    // here and forty-eight there is not got up by standing and stooping at every yard of it.)
    const hands = lg.hands || (this.handsBusy && !!on && degOf(on.rise) >= SLOPE.scramble - 4);
    this.handsBusy = this.footing !== 'slide' && this.grounded && hands && (lg.cling > 0 || (going && speed > 0));
    if (this.footing !== 'slide') this.footing = this.handsBusy ? 'scramble' : 'firm';
    // What steep ground costs in breath: the climb, by how much of the pace it allows is being made; or the hanging on.
    const toil = this.footing === 'slide' || !this.grounded ? 0 : lg.cost > 0 && going && along > 0.15 ? lg.cost * Math.min(1, along / Math.max(lg.pace, 0.1)) : lg.cling;
    this.heard(h, along, toil);

    // stamina
    // (running costs more of it the more is carried: a full breath runs as far as src/sim/load.ts says that load leaves)
    const spent = (this.sprinting && hs > 1 ? 11 : this.scurrying && hs > 1 ? 6 : 0) * runCost(this.weightKg) + toil;
    if (spent > 0) {
      v.stamina = Math.max(0, v.stamina - spent * h);
      this.staminaDelay = 1.0;
    } else if (this.staminaDelay > 0) {
      this.staminaDelay -= h;
    } else {
      // (breath comes back slower to whoever wants food or water, and slower still to whoever is in a bad way for either)
      const regen = 11 * NEED.breath[Math.max(stage(v.energy), stage(v.water))] * (this.crouched ? 1.3 : 1);
      // (and it comes back as much faster as running spent it: a loaded man's shorter run is had again as soon as a
      // bare man's longer one, as in DayZ, where the bar itself is the shorter and so the sooner full)
      v.stamina = Math.min(MAX_STAMINA, v.stamina + regen * (this.faint ? 0.5 : 1) * runCost(this.weightKg) * h);
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

  /** how much more a gun wanders in these hands for want of food (1: not at all) */
  get shake() {
    // (an empty stomach, and little blood: by 3500 ml the hands are half as unsteady again, and below what a head
    // can work on, twice)
    return NEED.shake[stage(this.vitals.energy)] * (1 + greyOf(this.vitals.blood) * 0.5 + (this.faint ? 0.5 : 0));
  }

  /** too spent to sprint (the stamina bar says so) */
  get outOfBreath() {
    return this.winded;
  }

  /** A foot of the body has come down (Avatar.footfall): the sound of it, if it is really getting anywhere. */
  footfall() {
    // (on hands and feet, or sliding, what is heard is not steps: see `heard`)
    if (!this.grounded || this.dead || this.groundSpeed <= 0.5 || this.footing !== 'firm') return;
    if (this.wet > WADE.ankle * 0.3) {
      audio.footstep('water', this.groundSpeed * (this.crouched ? 0.4 : 1), undefined, this.weightKg);
      this.onWade(this.pos.x, this.pos.y + this.wet, this.pos.z, this.wet);
      this.onFootstep('water');
      return;
    }
    const s = this.surface();
    audio.footstep(s as Surface, this.groundSpeed * (this.crouched ? 0.4 : 1), undefined, this.weightKg);
    this.onFootstep(s);
  }

  /** An arm of the body has pulled it along, crawling (Avatar.pull): the sound of it. */
  pulled() {
    if (this.dead || this.groundSpeed <= 0.15) return;
    audio.crawl(this.surface() as Surface);
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

  /**
   * The open ground under a spot, if open ground is what is there: its height, its normal, how steep it is (rise
   * over run) and which way over the ground is down it. Null over a floor, a stair, a rock, a roof: anything that
   * is not the land itself. (Looked for further down than `groundBelow` looks: a round foot rests on a steep face
   * up the hill from its own middle, and on the steepest the ground straight under it is a metre below.)
   */
  private openGround(x: number, z: number, y: number) {
    const hit = physics.raycast({ x, y: y + 0.5, z }, { x: 0, y: -1, z: 0 }, 2.4, PLAYER_GROUPS, this.collider);
    if (!hit || hit.collider.shapeType() !== physics.R.ShapeType.HeightField) return null;
    const n = hit.normal, flat = Math.hypot(n.x, n.z);
    return { y: hit.point.y, n, rise: flat / Math.max(n.y, 1e-3), x: flat > 1e-6 ? n.x / flat : 0, z: flat > 1e-6 ? n.z / flat : 0 };
  }

  /**
   * `alongGround` for steep open ground, which that one leaves to the controller. The step is laid along the
   * hill as a round foot goes over it, pressed square to the face it is on; uphill it is cut to its own length,
   * so the pace asked for is the pace made along the way. Over a drop, or with anything but open ground where it
   * ends, it is left as it came.
   *
   * A round foot on a hillside is held up by whichever face of the hill stands highest under it, and that is not
   * always the face under its middle: coming up to where a steep face eases it is still on the steep one, and at
   * the foot of a bank it is against the bank before its middle has left the level. So the faces under its middle,
   * under its leading edge and under its uphill edge are found, where the step begins and where it ends, and the
   * feet rest at each end over the highest of ALL of them there. (Reckoned from the face under the middle alone,
   * or from different faces at the two ends, a step up to the brow of a steep face was laid level, into the hill,
   * and the body stood there for good.) What is laid is the difference between the two ends, not a height to be
   * at: where the controller holds the body over a face is a centimetre or two off any reckoning.
   * @returns how far over the ground the laid step should carry, or 0 if it was left alone
   */
  private alongSteep(d: { x: number; y: number; z: number }, h: number, on: { n: { x: number; y: number; z: number }; x: number; z: number }) {
    const run = Math.hypot(d.x, d.z);
    // (standing, the plain press does: the controller has been told this ground is not to be slipped on)
    if (run < 0.0005) return 0;
    const ux = d.x / run, uz = d.z / run, n = on.n, x0 = this.pos.x, z0 = this.pos.z;
    const faces: { x: number; z: number; y: number; nx: number; ny: number; nz: number }[] = [];
    for (const [bx, bz] of [[x0, z0], [x0 + d.x, z0 + d.z]]) {
      for (const [ox, oz] of [[0, 0], [ux * RADIUS, uz * RADIUS], [-on.x * RADIUS, -on.z * RADIUS]]) {
        const g = this.openGround(bx + ox, bz + oz, this.pos.y);
        if (g) faces.push({ x: bx + ox, z: bz + oz, y: g.y, nx: g.n.x, ny: Math.max(g.n.y, 0.2), nz: g.n.z });
        else if (ox === 0 && oz === 0) return 0;
      }
    }
    // (a face carried to a spot; and a round foot rests a little over a face, more the steeper it is: it is touched up the hill from its middle)
    const rest = (x: number, z: number) => faces.reduce((high, f) => Math.max(high, f.y - (f.nx * (x - f.x) + f.nz * (z - f.z)) / f.ny + (RADIUS + SKIN) / f.ny - RADIUS), -Infinity);
    const rise = rest(x0 + d.x, z0 + d.z) - rest(x0, z0);
    if (Math.abs(rise) > run * 6 + 0.05) return 0;
    const k = rise > 0 ? run / Math.hypot(run, rise) : 1;
    // Pressed square to the face going up it or along it, so the press takes nothing off the climb; straight
    // down, and lightly, when the step goes down the hill at all. (A press square to a steep face points into
    // the hill, and the controller reads which way a step means to go off its level part: a slow step down,
    // pressed that way, read as a step uphill that was slipping, and the slip was stopped. A slide could not
    // begin. And a hard press straight down is a push down the fall line, which a slide does not need.)
    const square = d.x * n.x + d.z * n.z <= 0, press = (square ? PRESS : STEEP_PRESS) * h;
    d.x = d.x * k - (square ? n.x * press : 0);
    d.y = rise * k - (square ? n.y * press : press);
    d.z = d.z * k - (square ? n.z * press : 0);
    return run * k;
  }

  /**
   * The controller's settings for the step about to be taken, given it only when they change: the steepest ground
   * it climbs, the least steep it lets a body slip down (degrees), and whether it steps up onto things. On steep
   * open ground it does not: allowed to climb the hill, it takes the hill for a stair as well, and goes up it a
   * third of a metre at a bound.
   */
  /**
   * The bodies of others (players, the infected) already standing in this one, within the controller's skin, are left
   * out of this step's moves: another body pressed into this one is a wall the controller meets at once whichever way
   * it goes, and it went at it twenty times over in every move, each time with every wall and floor about (1.1 ms a
   * move standing still, 1.9 walking, in a house in Kamenka with one of the infected at its arms' length: found
   * fighting the infected in the game, 2026-10-20). Out of it again, a body stops this one as before.
   */
  private apart(at: RAPIER.Vector, through: ((c: RAPIER.Collider) => boolean) | undefined) {
    const shape = this.collider.shape as RAPIER.Capsule;
    const near = (this.near ??= new physics.R.Capsule(shape.halfHeight, shape.radius + SKIN + 0.01));
    near.halfHeight = shape.halfHeight;
    near.radius = shape.radius + SKIN + 0.01;
    let inside: Set<number> | null = null;
    physics.world.intersectionsWithShape(at, IDENTITY, near, (c) => {
      // (a body is a capsule moved about with it; a pane of glass, the other thing that stops only a body, is not)
      if (c.handle !== this.collider.handle && c.shapeType() === physics.R.ShapeType.Capsule && c.parent()?.isKinematic()) (inside ??= new Set()).add(c.handle);
      return true;
    }, physics.R.QueryFilterFlags.EXCLUDE_SENSORS, BODIES);
    if (!inside) return through;
    const out = inside as Set<number>;
    return (c: RAPIER.Collider) => !out.has(c.handle) && (!through || through(c));
  }
  private near: RAPIER.Capsule | null = null;

  private slopes(climb: number, slip: number, steps: boolean) {
    const was = this.kccSlopes;
    if (climb !== was[0]) this.kcc.setMaxSlopeClimbAngle((climb * Math.PI) / 180);
    if (slip !== was[1]) this.kcc.setMinSlopeSlideAngle((slip * Math.PI) / 180);
    if (steps !== was[2]) {
      if (steps) this.kcc.enableAutostep(...AUTOSTEP);
      else this.kcc.disableAutostep();
    }
    this.kccSlopes = [climb, slip, steps];
  }

  /** The feet have gone: a slide, begun at whatever pace the body already had down the slope (m/s along it). */
  private beginSlide(v: number, rise: number) {
    this.footing = 'slide';
    this.handsBusy = false;
    this.slide.v = Math.max(0, v);
    this.slide.side = 0;
    this.sprinting = this.scurrying = false;
    this.lastFallSpeed = -slideFall(this.slide.v, rise);
    // (the scuff of feet going out from under, once: not again when a slide leaves the ground for a moment and comes back to it)
    if (this.clock - this.slide.at > 0.8) audio.jump();
    this.slide.at = this.clock;
  }

  /**
   * A slide is over: the ground has eased under it until feet hold on it, or it has rubbed to a stop. It ends as
   * a fall ends: the feet come down at whatever speed the body was coming down the step before. (Nothing, where a
   * slide has run out; a hard landing, where a cliff meets a floor.)
   */
  private endSlide() {
    this.footing = 'firm';
    this.slide.v = this.slide.side = 0;
    this.jolted(Math.max(0, -this.lastFallSpeed), true);
  }

  /**
   * The ground has taken so much of a slide's fall off it at a blow (m/s): where it eased, where the slide ended,
   * or where something stood in the way. It is felt as a landing at that speed is, by the same rule. Blows that
   * come one on another add up, less what a body takes up in between (SLIDE.absorb): what was already felt of
   * them is not paid for twice.
   * @param ended the slide is over: the feet are heard coming down however light the blow
   */
  private jolted(jolt: number, ended = false) {
    const had = this.slide.took;
    this.slide.took += jolt;
    if (this.slide.took > STRUCK_AT && (jolt > 0 || ended)) this.land(-this.slide.took, (this.slide.took * this.slide.took) / (2 * GRAVITY), had);
    else if (ended) this.land(-this.slide.took);
  }

  /**
   * What steep ground sounds like, and how hard the going is, kept for the view. A scramble is a hand and then
   * a foot, slower than steps; a slide is heels in the scree, quicker the faster it goes. (They are the
   * footstep's own sounds on whatever the ground is: there is no recording of either.)
   * @param along metres a second the body made this step @param toil what the ground is costing it in breath
   */
  private heard(h: number, along: number, toil: number) {
    this.clock += h;
    const sliding = this.footing === 'slide', hauling = this.footing === 'scramble' && along > 0.15;
    if (sliding) this.slide.at = this.clock;
    this.toil += ((hauling ? 1 : Math.min(1, toil / 12)) - this.toil) * (1 - Math.exp(-4 * h));
    this.skid += ((sliding ? THREE.MathUtils.clamp(this.slide.v / 9, 0.3, 1) : 0) - this.skid) * (1 - Math.exp(-7 * h));
    this.haul += h * (2.2 + along * 2.4);
    this.scrabbleT -= h;
    if (this.scrabbleT > 0 || !(sliding || hauling)) return;
    const s = this.surface() as Surface, odd = this.scrabbles++ % 2 === 1;
    if (sliding) {
      this.scrabbleT = 0.05 + 0.45 / (2 + this.slide.v);
      audio.footstep(s === 'grass' && odd ? 'dirt' : s, 1.5 + this.slide.v * 0.6, undefined, this.weightKg);
    } else {
      this.scrabbleT = THREE.MathUtils.clamp(0.42 / (along + 0.35), 0.28, 0.62);
      audio.footstep(s, odd ? 1.6 : 3, undefined, this.weightKg);
    }
  }

  /**
   * The feet have come down at this speed (m/s, downward: so `vy` is less than nothing).
   * @param drop how far down it was, for whoever is told of a death by it
   * @param had how much of this blow has been felt already, m/s (a slide's end can come in two or three blows: see `jolted`)
   */
  private land(vy: number, drop = 0, had = 0) {
    if (this.softLanding) {
      this.softLanding = false;
      vy = Math.max(vy, -2);
    }
    const s = Math.max(0, -vy) * this.landsAs(this.pos.x, this.pos.y, this.pos.z);
    this.landVel = -Math.min(s * 0.035, 0.22);
    if (s > 2.5) audio.land(this.surface() as Surface, s);
    // from a height your legs take the fall before you can run on
    if (s > 6.5) this.stumble = Math.min(0.5, (s - 6.5) * 0.09);
    this.onLand(s);
    if (s > 9.5 && (had <= 0 || s > had + 0.1) && !this.arcade) {
      const dmg = (s - Math.max(9.5, had)) * 14 * this.fallMult;
      this.lastFall = { drop, speed: s };
      this.damage(dmg, 'fall');
      if (s > 13 && had <= 13) this.bleed(woundOf('fall'));
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
    if (this.dead || this.god) return;
    this.vitals.health = Math.max(0, this.vitals.health - amount);
    this.hurtTimer = 0.4;
    this.lastCause = cause;
    audio.hurt();
    this.onDamage(amount, cause);
    if (this.vitals.health <= 0) {
      if (this.keepAlive) this.vitals.health = 1;
      else this.dead = true;
    }
  }

  /** Slow vitals simulation (seconds). */
  tickVitals(dt: number) {
    const v = this.vitals;
    if (this.dead) return;
    if (this.arcade) {
      // (and a sprint that never gives out: as PUBG, with no bar to say otherwise)
      v.stamina = MAX_STAMINA;
      v.energy = v.water = 100;
      v.blood = BLOOD.full;
      v.bleeding = false;
      v.bleed = 0;
      if (this.hurtTimer > 0) this.hurtTimer -= dt;
      return;
    }
    const exertion = this.god ? 0 : this.sprinting ? 2.4 : this.scurrying ? 1.8 : this.moving > 0.1 ? 1.3 : 1;
    v.energy = Math.max(0, v.energy - NEED.hunger * exertion * dt);
    v.water = Math.max(0, v.water - NEED.thirst * exertion * this.thirstMult * dt);
    // An open wound costs blood, and no health: the two are two things (src/sim/blood.ts). Left alone it closes
    // in the end, five minutes on; a dressing closes it there and then.
    if (v.bleeding) {
      if (!this.god) v.blood = Math.max(0, v.blood - v.bleed * dt);
      this.bleedT += dt;
      if (this.bleedT > BLOOD.clots) {
        this.staunch();
        this.onClot();
      }
    } else this.bleedT = 0;
    if (v.blood <= BLOOD.dead && !this.god && !this.keepAlive) {
      this.lastCause = 'blood loss';
      this.dead = true;
      return;
    }
    // what a bag gives, as it runs in; and what comes back by itself to whoever is fed and watered
    if (this.drip.left > 0) {
      const got = Math.min(this.drip.left, this.drip.rate * dt);
      this.drip.left -= got;
      v.blood = Math.min(BLOOD.full, v.blood + got);
    }
    v.blood = Math.min(BLOOD.full, v.blood + bloodBack(v.energy, v.water, v.bleeding) * dt);
    if (v.energy <= 0 || v.water <= 0) this.damageQuiet(0.35 * dt, v.water <= 0 ? 'thirst' : 'hunger');
    // (health mends on good blood, at half on poor, and not at all on bad)
    else if (v.energy > 60 && v.water > 60 && !v.bleeding && !v.ill && v.health < 100) v.health = Math.min(100, v.health + 0.12 * mendsOn(v.blood) * dt);
    if (this.hurtTimer > 0) this.hurtTimer -= dt;
    // a broken leg knits by itself in the end: nobody is left a cripple for the want of a roll of tape
    if (v.broken) {
      this.brokenT += dt;
      if (this.brokenT > LEG.knits) this.setLeg();
    } else this.brokenT = 0;
    // food poisoning: bouts of throwing up, and nothing mends until it passes (src/sim/sickness.ts)
    if (v.ill || v.guard) {
      const r = illFor(v, this.boutT, dt, Math.random);
      v.ill = r.ill || undefined;
      v.guard = r.guard || undefined;
      this.boutT = r.bout;
      for (let n = 0; n < r.bouts && !this.god; n++) {
        v.water = Math.max(0, v.water - POISON.water);
        v.energy = Math.max(0, v.energy - POISON.energy);
        this.onBout();
      }
    }
  }

  /** a leg breaks (nothing happens to one already broken, or to the dead) */
  breakLeg() {
    // (nor to an admin in god mode: nothing takes hold of one)
    if (this.dead || this.vitals.broken || this.god || this.arcade) return;
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

  /** Made whole (by an admin): health, food, water, the wound and the leg. */
  mend() {
    if (this.dead) return;
    const v = this.vitals;
    v.health = 100;
    v.energy = 100;
    v.water = 100;
    v.stamina = MAX_STAMINA;
    v.blood = BLOOD.full;
    this.drip.left = 0;
    this.staunch();
    this.setLeg(true);
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
    if (this.god) return;
    this.vitals.health = Math.max(this.keepAlive ? 1 : 0, this.vitals.health - a);
    if (this.vitals.health <= 0 && !this.dead) {
      this.lastCause = cause;
      this.dead = true;
    }
  }

  /**
   * A fresh wound, beside whatever others there are: together they bleed faster, and the clock on their closing
   * starts again.
   * @param rate what this one costs, ml a second (src/sim/blood.ts: `woundOf`)
   * @param spilt what it took as it was made (a round takes a hundred going in)
   */
  bleed(rate = BLOOD.wound.torso, spilt = 0) {
    const v = this.vitals;
    if (this.god || this.arcade) return;
    v.bleed = withWound(v.bleed, rate);
    v.bleeding = v.bleed > 0;
    v.blood = Math.max(0, v.blood - spilt);
    this.bleedT = 0;
  }

  /** blood lost at a stroke, with or without a wound left open (a round takes a hundred going in) */
  spill(ml: number) {
    if (!this.god && !this.dead && !this.arcade) this.vitals.blood = Math.max(0, this.vitals.blood - ml);
  }

  /** every wound closed (a dressing, or time) */
  staunch() {
    this.vitals.bleed = 0;
    this.vitals.bleeding = false;
    this.bleedT = 0;
  }

  /** a bag hung and running in: so much blood, over so many seconds (a second bag begun while one runs adds to it) */
  transfuse(ml: number, over: number) {
    this.drip.left += ml;
    this.drip.rate = Math.max(this.drip.rate, ml / Math.max(1, over));
  }

  /** the head swims: too little blood to run on */
  get faint() {
    return !this.dead && this.vitals.blood < BLOOD.faint;
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
    // (bent to the slope on hands and feet, and sat back on the heels in a slide, the head is lower than it stands)
    const bent = this.dead || this.prone || this.sat ? 0 : this.footing === 'slide' ? (this.crouched ? 0.15 : 0.5) : this.footing === 'scramble' ? (this.crouched ? 0.1 : 0.34) : 0;
    const targetEye = (this.dead ? 0.35 : this.prone ? EYE_PRONE : this.sat ? EYE_SAT : this.crouched ? EYE_CROUCH : EYE_STAND) - bent;
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
    // Steep going is seen where no pace is made: the head works from side to side and up and down with every
    // reach, more the harder the ground. And in a slide the view rattles, harder the faster it goes.
    const heave = this.dead || !this.grounded ? 0 : this.toil, rattle = this.dead ? 0 : this.skid;
    tb.x += Math.cos(this.haul) * 0.03 * heave;
    tb.y += Math.abs(Math.sin(this.haul)) * 0.045 * heave;
    this.viewT += dt;
    const shake = Math.sin(this.viewT * 43) * Math.sin(this.viewT * 11.3) * rattle;
    this.bob.lerp(tb, 1 - Math.exp(-14 * dt));

    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const step = this.prevStepOff + (this.stepOff - this.prevStepOff) * alpha;
    // The eye is kept clear of whatever is over the head. The top of the body stops at a ceiling and the eye is
    // eight centimetres under that, which is as near a thing as the picture is drawn from: looked up at from a
    // jump, or from under a stair, the ceiling was looked through. One look upward a frame.
    let eyeY = p.y + this.eye + this.landDip + this.bob.y + step + shake * 0.022;
    const over = this.dead ? null : physics.raycast({ x: p.x, y: p.y + 0.5, z: p.z }, { x: 0, y: 1, z: 0 }, 1.5, SHOT_GROUPS, this.collider);
    if (over) eyeY = Math.min(eyeY, Math.max(p.y + 0.3, p.y + 0.5 + over.toi - HEADROOM));
    cam.position.set(p.x, eyeY, p.z);
    const reach = LEAN_REACH * THREE.MathUtils.lerp(1, 0.74, THREE.MathUtils.clamp((EYE_STAND - this.eye) / (EYE_STAND - EYE_CROUCH), 0, 1));
    cam.position.addScaledVector(side, this.bob.x + lean * reach);
    if (lean !== 0) cam.position.y -= Math.abs(lean) * 0.08;
    // sidestepping tips the view a touch into the movement
    const lateral = this.dead ? 0 : (this.vel.x * side.x + this.vel.z * side.z) / 6.2;
    this.strafeRoll += (THREE.MathUtils.clamp(lateral, -1, 1) * -0.022 - this.strafeRoll) * (1 - Math.exp(-9 * dt));
    const roll = -lean * 0.21 + (this.dead ? 1.2 : 0) + Math.cos(ph) * 0.004 * amp + this.strafeRoll - lame * 0.035 + Math.cos(this.haul) * 0.014 * heave + Math.sin(this.viewT * 29 + 1.3) * Math.sin(this.viewT * 7.1) * 0.02 * rattle;
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch + this.aimOffset.y + shake * 0.007, this.yaw + this.aimOffset.x, roll, 'YXZ'));
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
