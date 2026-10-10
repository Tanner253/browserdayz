// The infected, as this game draws and (for the ones near its own player) moves them.
// The rules, and who decides what, are in src/sim/infected.ts.
//
// One that is this game's to move has a mind: it sees and hears the people about it, goes
// after them round whatever is in the way, and strikes when it has them. One that is some
// other game's is drawn where that game says it is, a moment in the past, like another player.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, GLASS_GROUPS, HITBOX_GROUPS, PLAYER_GROUPS, SIGHT_GROUPS } from '../core/physics';
import { audio } from '../core/audio';
import type { Atmosphere } from '../world/atmosphere';
import { BUILDING_FOOTPRINT, bunkerPlace, heightAt, type World } from '../world/worldgen';
import { bunkerAt, bunkerLocal, bunkerWays, type Place } from '../sim/bunker';
import type { Buildings } from '../world/buildings';
import { Director, INFECTED, I_ALERT, I_ATTACK, I_CHASE, I_DEAD, I_IDLE, I_WANDER, homeSpot, infectedDrop, infectedHomes, suited, type IState, type InfectedInfo } from '../sim/infected';
import type { C2S } from '../net/protocol';
import { Avatar } from './avatar';
import { ZOMBIES, lookFor } from './look';
import type { Damageable, HitZone } from './weapons';

/** somebody an infected might notice */
export interface Person {
  id: number;
  pos: THREE.Vector3;
  crouched: boolean;
  /** metres a second over the ground */
  speed: number;
  alive: boolean;
  /** in a jeep: heard, not seen, and not to be dragged out of it */
  seated: boolean;
}

export interface HordeHost {
  atmo(): Atmosphere;
  scene(): THREE.Scene;
  world(): World;
  buildings(): Buildings;
  /** this game's own player, and everybody else it knows of */
  me(): Person;
  others(): Iterable<Person>;
  online(): boolean;
  send(m: C2S): void;
  /** one of them has hit this game's own player (playing alone: online the server says so). False: their guard stopped it. */
  struck(amount: number, from: THREE.Vector3): boolean;
  /** this player's guard stopped a blow from there (online: the server has said so) */
  guarded(from: THREE.Vector3): void;
  /** one of them is dead, by this player's hand */
  killed(zone: HitZone, distance: number): void;
  /** playing alone: one went down with this on it (on a server the server puts it in the world) */
  dropped(id: string, qty: number, at: THREE.Vector3): void;
  /** the bunker's door stands open */
  bunkerOpen(): boolean;
}

const INTERP_DELAY = 150;
/** drawn and moved in full within this of the eye; past it they are not there to be seen */
const DRAWN = 150;
const _head = new THREE.Vector3(), _neck = new THREE.Vector3(), _pelvis = new THREE.Vector3();
const _v = new THREE.Vector3();
/** as near as two of them stand to each other, metres */
const APART = 0.62;
/** a way through a wall: the middle of a doorway, which way it faces (level), the door in it, and the building it belongs to */
interface Doorway {
  plot: string;
  mid: THREE.Vector3;
  n: THREE.Vector3;
  door: { open: boolean };
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const turnTo = (a: number, b: number, max: number) => a + THREE.MathUtils.clamp(Math.atan2(Math.sin(b - a), Math.cos(b - a)), -max, max);

export class Infected implements Damageable {
  readonly name = 'Infected';
  readonly avatar = new Avatar();
  pos = new THREE.Vector3();
  yaw = 0;
  mode = I_IDLE;
  /** who it is after (a player's number, 0 nobody) */
  after = 0;
  dead = false;
  /** this game moves it */
  mine = false;
  ready = false;
  private gone = false;
  private body!: RAPIER.RigidBody;
  private zones: RAPIER.Collider[] = [];
  private blocker!: RAPIER.Collider;
  private snaps: { t: number; s: IState }[] = [];
  private vel = new THREE.Vector3();
  private flinch = 0;
  private shape!: RAPIER.Cuboid;
  // --- its mind (only when it is this game's)
  private home = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private thinkT = Math.random() * 0.15;
  private waitT = 1 + Math.random() * 5;
  private seenAt = -1e9;
  private lastSeen = new THREE.Vector3();
  private strikeT = -1;
  private struck = false;
  /** stopped in its tracks for this much longer: struck, shot, or its blow turned aside */
  private stopT = 0;
  /** when it was last stopped, and when it may strike again (the game's clock, milliseconds) */
  private stoppedAt = -1e9;
  private strikeAt = 0;
  /** how fast it is going, metres a second: it gathers pace and loses it, it does not start and stop dead */
  private gait = 0;
  private stepped = false;
  /** how long it has been looking for somebody with nothing to go on */
  private alertT = 0;
  /** on its way back to where it lives */
  private returning = false;
  private side = Math.random() < 0.5 ? 1 : -1;
  private sideT = 0;
  private stuckT = 0;
  private groanT = 4 + Math.random() * 14;
  /** the doorway it is making for, which side of it it started on, how far through it has got, and how long it has been at it */
  private way: Doorway | null = null;
  private waySide = 1;
  private wayStage = 0;
  private wayT = 0;
  private poundT = 0;
  /** the flight of stairs it is making for or on, whether it is going up them, and whether it has reached their near end */
  private steps: { plot: string; way: THREE.Vector3[] } | null = null;
  private stepsUp = true;
  private stepsAt = 0;
  private onSteps = false;
  /** it has changed what it is doing since this game last said where it was */
  dirty = true;
  /** time its body has not been moved for (the far ones are posed every second or third frame) */
  private poseDt = 0;
  private frameNo = 0;
  private said: IState = [0, 0, 0, 0, -1, 0];

  constructor(public i: number, private host: HordeHost, private horde: Horde) {}

  async load(info: InfectedInfo) {
    const [x, y, z, yaw] = info.s;
    this.pos.set(x, y, z);
    // (where it lives is where it first turned up, however far it has been led since)
    this.home.set(info.h?.[0] ?? x, y, info.h?.[1] ?? z);
    this.yaw = yaw;
    this.mode = info.s[4];
    this.after = info.s[5];
    this.fallTo = y;
    // (which of the three bodies it is goes by its number: every game draws the same one. The ones of the gas and of the bunker wear the orange suit.)
    await this.avatar.load(this.host.atmo(), 0, false, lookFor(''), suited(this.host.world(), this.home.x, this.home.z) ? 'zombie_hazmat' : ZOMBIES[this.i % ZOMBIES.length]);
    if (this.gone) return this.avatar.dispose();
    this.avatar.sick = { roused: 0, claw: -1, seed: (this.i * 7.31) % 20 };
    this.host.scene().add(this.avatar.root);
    const R = physics.R;
    this.shape = new R.Cuboid(0.24, 0.5, 0.24);
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const zone = (desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
      this.zones.push(c);
    };
    zone(R.ColliderDesc.ball(0.13).setTranslation(0, 1.6, -0.06), 'head');
    zone(R.ColliderDesc.cuboid(0.25, 0.31, 0.15).setTranslation(0, 1.18, -0.02), 'torso');
    zone(R.ColliderDesc.cuboid(0.18, 0.45, 0.14).setTranslation(0, 0.45, 0.03), 'legs');
    // nobody walks through one; shots are stopped only by the hit zones
    this.blocker = physics.world.createCollider(R.ColliderDesc.capsule(0.5, 0.27).setTranslation(0, 0.8, 0).setCollisionGroups(GLASS_GROUPS), this.body);
    this.ready = true;
    this.avatar.update(0, this.pos, this.vel, this.yaw, false, false);
    if (info.s[4] === I_DEAD || info.hp <= 0) this.die(0, true);
  }

  /** where its owner says it is */
  push(s: IState, now: number) {
    this.snaps.push({ t: now, s });
    if (this.snaps.length > 12) this.snaps.shift();
  }

  /** this game is to move it from here on, or no longer is */
  setMine(mine: boolean) {
    if (mine === this.mine) return;
    this.mine = mine;
    this.snaps.length = 0;
    this.strikeT = -1;
    if (!mine && !this.dead) {
      // nobody is moving it for the moment: it stands where it is, slack, not frozen in mid-stride with its arms out
      this.mode = I_IDLE;
      this.after = 0;
    }
    this.lost();
    if (mine) {
      this.fallTo = this.floor(this.pos.x, this.pos.z, this.pos.y);
      if (this.mode >= I_ALERT) this.mode = I_ALERT;
      this.goal.copy(this.pos);
      this.dirty = true;
    }
  }

  /** your shot or blow landed on it: the jolt, the blood and the noise (what it did to it, the director says) */
  damage(amount: number, _point: THREE.Vector3, dir: THREE.Vector3, zone: HitZone): boolean {
    if (this.dead) return false;
    this.flinch = 1;
    this.avatar.hit(zone === 'head');
    audio.infected('hurt', this.pos, this.pos.distanceTo(this.horde.eye), this.i);
    // whoever hit it has its attention, wherever they did it from
    if (this.mine) this.hearAt(this.horde.host.me().pos, true);
    return this.horde.hurt(this, amount, dir);
  }

  /** it is down for good: which way it falls (0 on its back, 1 on its face, 2 on its side) */
  die(variant: number, already = false) {
    if (this.dead) return;
    this.dead = true;
    this.mode = I_DEAD;
    this.after = 0;
    this.mine = false;
    this.vel.set(0, 0, 0);
    if (!this.ready) return;
    for (const c of this.zones) c.setEnabled(false);
    this.blocker.setEnabled(false);
    if (already) this.avatar.layDown(variant);
    else {
      this.avatar.setDeath(variant);
      audio.infected('die', this.pos, this.pos.distanceTo(this.horde.eye), this.i);
    }
  }

  /** a noise, or somebody it has just been hurt by: it goes to see (and if it was hurt, it knows who) */
  hearAt(at: THREE.Vector3, sure = false) {
    if (this.dead || !this.mine || this.mode >= I_CHASE) return;
    if (this.mode !== I_ALERT) this.lost();
    this.goal.copy(at);
    if (this.mode !== I_ALERT) this.dirty = true;
    this.mode = I_ALERT;
    this.waitT = INFECTED.search * 0.6;
    this.alertT = 0;
    if (sure) this.thinkT = 0;
  }

  /**
   * Stopped where it stands for a moment: it was struck or shot, or its blow was turned aside.
   * An arm that was on its way up never comes down: this is when to hit it.
   */
  stagger(seconds: number) {
    if (this.dead || !this.mine) return;
    // (a blow turned aside always tells; shots and blows only once in a while)
    const now = this.horde.clock;
    if (seconds < INFECTED.stopBlocked && now - this.stoppedAt < INFECTED.stopAgain * 1000) return;
    this.stoppedAt = now;
    this.stopT = Math.max(this.stopT, seconds);
    this.flinch = 1.2;
    if (this.mode === I_ATTACK && !this.struck) {
      this.mode = I_CHASE;
      this.avatar.sick!.claw = -1;
      this.dirty = true;
    }
  }

  // ------------------------------------------------------------ the mind

  /** whatever way it was making by a door or a flight of stairs is forgotten: it starts from where it stands */
  lost() {
    this.way = null;
    this.steps = null;
    this.onSteps = false;
  }

  /** shoved a little by another of them: only as far as there is room to go */
  nudge(dx: number, dz: number) {
    this.tryAt(this.pos.x + dx, this.pos.z + dz);
  }

  private sees(p: Person): boolean {
    const eye = _v.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
    const to = new THREE.Vector3(p.pos.x - eye.x, p.pos.y + (p.crouched ? 0.8 : 1.4) - eye.y, p.pos.z - eye.z);
    const d = to.length();
    if (d < 0.5) return true;
    return physics.raycast(eye, to.divideScalar(d), d - 0.3, SIGHT_GROUPS) === null;
  }

  private think(now: number) {
    const I = INFECTED;
    let best: Person | null = null, bd = Infinity;
    let heard: Person | null = null, hd = Infinity;
    const consider = (p: Person) => {
      if (!p.alive) return;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > I.hearJeep + 5 || Math.abs(p.pos.y - this.pos.y) > 9) return;
      if (p.seated && p.speed > 2.5) {
        // a jeep that is going is heard; one that has stopped is somebody sitting where they can be got at
        if (d < I.hearJeep && d < hd) [heard, hd] = [p, d];
        return;
      }
      // (in front of it is the way it faces: yaw 0 looks down -z)
      const ahead = Math.abs(Math.atan2(Math.sin(Math.atan2(-dx, -dz) - this.yaw), Math.cos(Math.atan2(-dx, -dz) - this.yaw))) < I.view;
      const near = d < I.sightAround && (!p.crouched || ahead);
      const inView = ahead && d < (p.crouched ? I.sightCrouched : I.sight);
      // (somebody it is already after is kept in sight a good deal further, and round behind it)
      const kept = this.after === p.id && d < I.sight * 1.7;
      if ((near || inView || kept) && d < bd && this.sees(p)) [best, bd] = [p, d];
      else if (!p.crouched && ((p.speed > 5.3 && d < I.hearSprint) || (p.speed > 3 && d < I.hearJog)) && d < hd) [heard, hd] = [p, d];
    };
    consider(this.host.me());
    for (const p of this.host.others()) consider(p);
    const seen = best as Person | null, noise = heard as Person | null;
    if (seen) {
      this.seenAt = now;
      this.lastSeen.copy(seen.pos);
      if (this.mode < I_CHASE) {
        // the moment it knows: it says so, and everything near it hears
        audio.infected('alert', this.pos, this.pos.distanceTo(this.horde.eye), this.i);
        this.horde.cry(this, seen.pos);
        this.mode = I_CHASE;
        this.dirty = true;
      }
      if (this.after !== seen.id) this.dirty = true;
      this.after = seen.id;
    } else if (this.mode === I_CHASE && now - this.seenAt > I.forget * 1000) {
      // lost them: to where they were last seen, and a look about
      this.mode = I_ALERT;
      this.after = 0;
      this.goal.copy(this.lastSeen);
      this.waitT = I.search;
      this.alertT = 0;
      this.dirty = true;
    } else if (noise && this.mode < I_CHASE) this.hearAt(noise.pos);
  }

  /** where the floor is at a spot, for something standing at `y` now (null: nothing to stand on within reach) */
  private floor(x: number, z: number, y: number): number {
    const ground = heightAt(this.host.world().heights, x, z);
    // (whatever a person's feet stand on: the slope laid over a flight of stairs is that and nothing else)
    const hit = physics.raycast({ x, y: y + 1.25, z }, { x: 0, y: -1, z: 0 }, 4.5, PLAYER_GROUPS, this.blocker);
    const f = hit ? y + 1.25 - hit.toi : -1e9;
    return f > ground + 0.04 ? f : ground;
  }

  /** go there if there is room to stand, up no more than a step */
  private tryAt(x: number, z: number): boolean {
    // (not into another of them: they go round each other, and wait their turn at a door)
    if (this.horde.crowded(this, x, z)) return false;
    const y = this.floor(x, z, this.pos.y);
    if (y - this.pos.y > 0.6) return false;
    if (physics.world.intersectionWithShape({ x, y: Math.max(y, this.pos.y - 0.3) + 1.02, z }, { x: 0, y: 0, z: 0, w: 1 }, this.shape, undefined, PLAYER_GROUPS, undefined, this.body) !== null) return false;
    this.pos.x = x;
    this.pos.z = z;
    // (down a drop it falls, it is not set down)
    this.pos.y = y < this.pos.y - 0.4 ? this.pos.y : y;
    this.fallTo = y;
    return true;
  }
  private fallTo = 0;

  /**
   * Toward a point, by the doors if a wall is in the way: when the point is in a building
   * and it is not (or the other way about, or they are in two), it goes up to a door of that
   * building on its own side, square on, and straight through. A door that is shut it beats
   * on, which everything near can hear. False when it could not move.
   */
  private goTo(at: THREE.Vector3, speed: number, dt: number): boolean {
    // In the bunker, or on the way into it or out of it: by its doorways, one after another (see bunkerWays).
    const leg = this.horde.bunkerLeg(this.pos, at);
    if (leg) {
      if (!leg.shut) return this.walk(leg.x, leg.z, speed, dt);
      // its door is shut, and it is at it: it beats on the steel, which everything near can hear
      this.yaw = turnTo(this.yaw, Math.atan2(-(leg.dx - this.pos.x), -(leg.dz - this.pos.z)), dt * 5);
      if ((this.poundT -= dt) <= 0) {
        this.poundT = 1.5 + Math.random() * 0.8;
        this.avatar.claw();
        _v.set(leg.dx, this.pos.y + 1.2, leg.dz);
        audio.impact('metal', _v, _v.distanceTo(this.horde.eye));
        this.dirty = true;
      }
      return true;
    }
    const there = this.horde.plotAt(at.x, at.z), here = this.horde.plotAt(this.pos.x, this.pos.z);
    // On another floor of the building it is in: by the stairs, to their near end and then along them.
    // (And upstairs with somewhere to be that is not in this building at all: down them first.)
    const dy = (here === there ? at.y : heightAt(this.host.world().heights, this.pos.x, this.pos.z)) - this.pos.y;
    const other = !!here && Math.abs(dy) > 1.5 && (here === there || dy < 0);
    if (other && !this.onSteps && (!this.steps || this.steps.plot !== here || this.stepsUp !== dy > 0)) {
      const f = this.horde.flight(here, this.pos, dy > 0);
      // the way by it: to its near end, along it, and (at the top) clear of the well it comes up through
      this.steps = f && { plot: f.plot, way: dy > 0 ? [f.foot, f.head, f.off] : [f.off, f.head, f.foot] };
      this.stepsUp = dy > 0;
      this.stepsAt = 0;
    }
    // (once on a flight it goes to the end of it: half way up, whoever it is after is no longer "a floor away")
    if (!other && !this.onSteps) this.steps = null;
    const s = this.steps;
    if (s) {
      const to = s.way[this.stepsAt];
      if (Math.hypot(to.x - this.pos.x, to.z - this.pos.z) < 0.5 && Math.abs(to.y - this.pos.y) < 1) {
        this.stepsAt++;
        this.onSteps = this.stepsAt < s.way.length;
        if (!this.onSteps) this.steps = null;
        return true;
      }
      return this.walk(to.x, to.z, speed, dt);
    }
    this.onSteps = false;
    if (there === here) this.way = null;
    else {
      const plot = (there ?? here)!;
      this.wayT += dt;
      if (!this.way || this.way.plot !== plot || (this.wayStage === 0 && this.wayT > 5)) {
        this.way = this.horde.doorway(plot, this.pos, at);
        this.wayStage = 0;
        this.wayT = 0;
        if (this.way) this.waySide = Math.sign((this.pos.x - this.way.mid.x) * this.way.n.x + (this.pos.z - this.way.mid.z) * this.way.n.z) || 1;
      }
    }
    const w = this.way;
    if (!w) return this.walk(at.x, at.z, speed, dt);
    const k = this.wayStage === 0 ? 1.15 : -1.25;
    const tx = w.mid.x + w.n.x * this.waySide * k, tz = w.mid.z + w.n.z * this.waySide * k;
    const left = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (this.wayStage === 0 && left < 0.45) {
      if (w.door.open) this.wayStage = 1;
      else {
        this.yaw = turnTo(this.yaw, Math.atan2(w.n.x * this.waySide, w.n.z * this.waySide), dt * 5);
        if ((this.poundT -= dt) <= 0) {
          this.poundT = 1.5 + Math.random() * 0.8;
          this.avatar.claw();
          audio.impact('wood', w.mid, w.mid.distanceTo(this.horde.eye));
          this.dirty = true;
        }
      }
      return true;
    }
    if (this.wayStage === 1 && left < 0.5) {
      this.way = null;
      return true;
    }
    return this.walk(tx, tz, speed, dt);
  }

  /** a step toward a point at a speed; false when it could not move at all */
  private walk(tx: number, tz: number, speed: number, dt: number): boolean {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const want = Math.atan2(-dx, -dz);
    this.yaw = turnTo(this.yaw, want, dt * (speed > 3 ? 7 : 3.2));
    // (it gathers pace over the first second and a bit: from standing to a run is not one step)
    this.stepped = true;
    this.gait += THREE.MathUtils.clamp(speed - this.gait, -8 * dt, 3.2 * dt);
    // (it goes the way it faces, not sideways: it has to come round first, and it does not overshoot)
    const off = Math.abs(Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)));
    const step = Math.min(d, this.gait * dt * Math.max(0.15, 1 - off / 1.6));
    this.sideT -= dt;
    const dirs = this.sideT > 0 ? [this.side * 1.0, 0, this.side * 1.7, -this.side * 1.0, this.side * 2.4] : [0, this.side * 0.95, -this.side * 0.95, this.side * 1.7, -this.side * 1.7];
    for (const a of dirs) {
      const h = this.yaw + a;
      if (!this.tryAt(this.pos.x - Math.sin(h) * step, this.pos.z - Math.cos(h) * step)) continue;
      if (a !== 0 && this.sideT <= 0) {
        // round an obstacle: keep to the side that worked for a moment, or it dithers in front of it
        this.side = Math.sign(a) || this.side;
        this.sideT = 0.7;
      }
      this.stuckT = 0;
      return true;
    }
    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      this.side = -this.side;
      this.sideT = 0;
      this.stuckT = 0.3;
    }
    return false;
  }

  private act(dt: number, now: number) {
    const I = INFECTED;
    if ((this.thinkT -= dt) <= 0) {
      this.thinkT = 0.13;
      this.think(now);
    }
    const quarry = this.after ? this.horde.person(this.after) : null;
    // (whatever it does not walk this frame, it loses pace)
    if (!this.stepped) this.gait = Math.max(0, this.gait - 8 * dt);
    this.stepped = false;
    if (this.stopT > 0) {
      // stopped: it does nothing until it has its feet again (but it can still fall)
      this.stopT -= dt;
      if (this.pos.y > this.fallTo + 0.02) this.pos.y = Math.max(this.fallTo, this.pos.y - 7 * dt);
      return;
    }
    switch (this.mode) {
      case I_IDLE:
        if ((this.waitT -= dt) <= 0) {
          // Led off somewhere, it walks back to where it lives; there, it drifts about the place.
          const away = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) > I.stray;
          const a = Math.random() * Math.PI * 2, r = away ? 2 + Math.random() * 5 : 3 + Math.random() * 12;
          const gx = this.home.x + Math.cos(a) * r, gz = this.home.z + Math.sin(a) * r;
          this.goal.set(gx, heightAt(this.host.world().heights, gx, gz), gz);
          this.returning = away;
          this.mode = I_WANDER;
          this.waitT = away ? 120 : 14;
          this.dirty = true;
          this.lost();
        }
        break;
      case I_WANDER:
        this.waitT -= dt;
        // (the way home may be out of a house and across the village: by the doors. A drift about the place is just a few steps.)
        // (and one that lives down the bunker drifts from room to room by their doors: a straight line there is a wall)
        if (!(this.returning ? this.goTo(this.goal, I.back, dt) : this.horde.below(this.pos) ? this.goTo(this.goal, I.wander, dt) : this.walk(this.goal.x, this.goal.z, I.wander, dt))) this.waitT -= dt * 4;
        if (this.waitT <= 0 || Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < (this.returning ? 2 : 0.8)) {
          this.mode = I_IDLE;
          this.waitT = this.returning && this.waitT > 0 ? 1 + Math.random() * 3 : 2 + Math.random() * 7;
          this.returning = false;
          this.dirty = true;
        }
        break;
      case I_ALERT:
        // It looks for only so long with nothing new to go on: at a door it cannot open, at a
        // wall, up a blind alley. Then it gives up, and goes home.
        this.alertT += dt;
        if (Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) > 1.2 || Math.abs(this.goal.y - this.pos.y) > 1.5 || this.onSteps) {
          if (!this.goTo(this.goal, I.look, dt)) this.waitT -= dt;
        } else {
          // there: a look about, then it loses interest
          this.yaw += dt * 0.9 * this.side;
          this.waitT -= dt;
        }
        if (this.waitT <= 0 || this.alertT > I.patience) {
          this.mode = I_IDLE;
          this.waitT = 1 + Math.random() * 3;
          this.lost();
          this.dirty = true;
        }
        break;
      case I_CHASE: {
        const at = quarry?.alive && now - this.seenAt < 900 ? quarry.pos : this.lastSeen;
        const d = Math.hypot(at.x - this.pos.x, at.z - this.pos.z);
        // (it strikes what it can see: not through a wall it happens to be standing against)
        if (quarry?.alive && now - this.seenAt < 500 && !(quarry.seated && quarry.speed > 2.5) && d < I.reach * 0.82 && Math.abs(quarry.pos.y - this.pos.y) < 1.4) {
          if (now >= this.strikeAt) {
            this.mode = I_ATTACK;
            this.strikeT = 0;
            this.strikeAt = now + I.swing * 1000;
            this.struck = false;
            this.way = null;
            this.avatar.claw();
            audio.infected('attack', this.pos, this.pos.distanceTo(this.horde.eye), this.i);
            this.dirty = true;
            break;
          }
          // between one blow and the next it does not stand like a post: it keeps its face to them, and keeps at them
          this.yaw = turnTo(this.yaw, Math.atan2(-(quarry.pos.x - this.pos.x), -(quarry.pos.z - this.pos.z)), dt * 5);
          if (d > 1.0) this.walk(quarry.pos.x, quarry.pos.z, I.wander, dt);
          break;
        }
        if (d > 0.4) this.goTo(at, I.chase, dt);
        break;
      }
      case I_ATTACK: {
        if (quarry) {
          this.yaw = turnTo(this.yaw, Math.atan2(-(quarry.pos.x - this.pos.x), -(quarry.pos.z - this.pos.z)), dt * 5);
          // (it throws itself the last of the way: whatever pace it had carries it in as the arm goes up)
          if (this.strikeT < I.windup && Math.hypot(quarry.pos.x - this.pos.x, quarry.pos.z - this.pos.z) > 1.0) this.walk(quarry.pos.x, quarry.pos.z, this.gait * 0.5, dt);
        }
        this.strikeT += dt;
        if (!this.struck && this.strikeT >= I.windup) {
          this.struck = true;
          // it lands on whoever is still inside its arms when they come down
          if (quarry?.alive && Math.hypot(quarry.pos.x - this.pos.x, quarry.pos.z - this.pos.z) < I.reach + 0.3 && Math.abs(quarry.pos.y - this.pos.y) < 1.6) this.horde.strike(this, quarry);
        }
        // (the lunge over, it is after them again at once: when it may strike next is another matter)
        if (this.strikeT >= I.lunge) {
          this.mode = I_CHASE;
          this.dirty = true;
        }
        break;
      }
    }
    // a drop: it falls
    if (this.pos.y > this.fallTo + 0.02) this.pos.y = Math.max(this.fallTo, this.pos.y - 7 * dt);
  }

  // ------------------------------------------------------------ every frame

  /** what this game says of it to the director, if anything has changed worth saying */
  report(force: boolean): [number, ...IState] | null {
    const s: IState = [Math.round(this.pos.x * 100) / 100, Math.round(this.pos.y * 100) / 100, Math.round(this.pos.z * 100) / 100, Math.round(this.yaw * 100) / 100, this.mode, this.after];
    const o = this.said;
    if (!force && !this.dirty && Math.abs(s[0] - o[0]) + Math.abs(s[2] - o[2]) < 0.03 && Math.abs(s[3] - o[3]) < 0.05) return null;
    this.said = s;
    this.dirty = false;
    return [this.i, ...s];
  }

  update(dt: number, now: number, eye: THREE.Vector3) {
    if (!this.ready) return;
    const before = _v.copy(this.pos);
    const px = before.x, py = before.y, pz = before.z;
    if (this.dead) {
      // (nothing more happens to it)
    } else if (this.mine) this.act(dt, now);
    else if (this.snaps.length) {
      const t = now - INTERP_DELAY;
      let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
      for (let k = this.snaps.length - 1; k > 0; k--) {
        if (this.snaps[k - 1].t <= t) {
          a = this.snaps[k - 1];
          b = this.snaps[k];
          break;
        }
      }
      const u = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
      this.pos.set(a.s[0] + (b.s[0] - a.s[0]) * u, a.s[1] + (b.s[1] - a.s[1]) * u, a.s[2] + (b.s[2] - a.s[2]) * u);
      this.yaw = lerpAngle(a.s[3], b.s[3], u);
      const mode = b.s[4];
      if (mode !== this.mode) {
        const d = this.pos.distanceTo(eye);
        if (mode === I_ATTACK) {
          this.avatar.claw();
          audio.infected('attack', this.pos, d, this.i);
        } else if (mode === I_CHASE && this.mode < I_CHASE) audio.infected('alert', this.pos, d, this.i);
        this.mode = mode;
      }
      this.after = b.s[5];
    }
    const off = this.pos.distanceToSquared(eye);
    const far = off > DRAWN * DRAWN;
    this.avatar.root.visible = !far;
    if (dt > 0) {
      const k = 1 - Math.exp(-14 * dt);
      this.vel.x += ((this.pos.x - px) / dt - this.vel.x) * k;
      this.vel.z += ((this.pos.z - pz) / dt - this.vel.z) * k;
      this.vel.y = (this.pos.y - py) / dt;
    }
    this.body.setNextKinematicTranslation(this.pos);
    const half = this.yaw / 2;
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    if (far) return;
    // (where it is, is said every frame: only its pose is done less often. Moved with the pose, one across the
    // street went in steps of two or three frames.)
    this.avatar.root.position.x = this.pos.x;
    this.avatar.root.position.z = this.pos.z;
    // posing a body is most of what one of them costs: across the street it is done every other frame, further off every third
    this.poseDt += dt;
    if ((this.frameNo++ + this.i) % (off > 70 * 70 ? 3 : off > 30 * 30 ? 2 : 1) !== 0) return;
    dt = this.poseDt;
    this.poseDt = 0;
    const sick = this.avatar.sick!;
    const roused = this.dead ? 0 : this.mode >= I_CHASE ? 1 : this.mode === I_ALERT ? 0.45 : 0;
    sick.roused += (roused - sick.roused) * (1 - Math.exp(-5 * dt));
    this.avatar.update(dt, this.pos, this.vel, this.yaw, false, this.dead, false, 0, true, false);
    if (!this.dead) {
      // the head and the chest that count are where the bent body has them
      if (this.avatar.frame(_head, _neck, _pelvis)) {
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        for (const v of [_head, _neck, _pelvis]) {
          const x = v.x - this.pos.x, z = v.z - this.pos.z;
          v.set(x * c - z * s, v.y - this.pos.y, x * s + z * c);
        }
        this.zones[0].setTranslationWrtParent(_head);
        this.zones[1].setTranslationWrtParent(_pelvis.lerp(_neck, 0.54));
      }
      this.flinch = Math.max(0, this.flinch - dt * 4);
      if (this.flinch > 0) this.avatar.root.rotation.x += this.flinch * 0.06;
      // the noises they make when nothing is happening: only the near ones, and not all at once
      if ((this.groanT -= dt) <= 0) {
        this.groanT = 7 + Math.random() * 16;
        const d = this.pos.distanceTo(eye);
        if (d < 45) audio.infected(this.mode >= I_CHASE ? 'growl' : 'groan', this.pos, d, this.i);
      }
    }
  }

  dispose() {
    this.gone = true;
    if (!this.ready) return;
    this.ready = false;
    this.avatar.dispose();
    for (const c of [...this.zones, this.blocker]) {
      physics.tags.delete(c.handle);
      physics.world.removeCollider(c, false);
    }
    physics.world.removeRigidBody(this.body);
  }
}

export class Horde {
  readonly all = new Map<number, Infected>();
  /** where the bunker stands (null: this world has none; undefined: not looked for yet) */
  private bunkerAt_: Place | null | undefined;
  private get bunker(): Place | null {
    return this.bunkerAt_ === undefined ? (this.bunkerAt_ = bunkerPlace(this.host.world())) : this.bunkerAt_;
  }

  /** whether a spot is down in the bunker (or on its stair) */
  below(at: THREE.Vector3): boolean {
    const P = this.bunker;
    if (!P) return false;
    const [r, f, h] = bunkerLocal(P, at.x, at.y + 1, at.z);
    return bunkerWays().part(r, f, h) !== bunkerWays().world;
  }

  /**
   * The next stretch of the way between two spots when either of them is in the bunker:
   * where to walk to now (square on to the next doorway, then through it), or null when the
   * bunker has nothing to do with it (or they are in one part of it, and the way is straight).
   * `shut`: the way is by the bunker's door, it is shut, and whoever asks is standing at it
   * (`dx, dz`: the middle of the door).
   */
  bunkerLeg(from: THREE.Vector3, to: THREE.Vector3): { x: number; z: number; shut: boolean; dx: number; dz: number } | null {
    const P = this.bunker;
    if (!P) return null;
    const W = bunkerWays();
    const [r, f, h] = bunkerLocal(P, from.x, from.y + 1, from.z), [tr, tf, th] = bunkerLocal(P, to.x, to.y + 1, to.z);
    const a = W.part(r, f, h), b = W.part(tr, tf, th);
    if (a === b) return null;
    const step = W.next(a, b);
    if (!step) return null;
    const { way, dir } = step, nr = way.nr * dir, nf = way.nf * dir;
    // how far short of it (or through it) it stands, and how far to one side of the line through its middle
    const along = (r - way.r) * nr + (f - way.f) * nf, off = Math.abs((r - way.r) * nf - (f - way.f) * nr);
    const shut = !!way.gate && !this.host.bunkerOpen();
    const lined = off < 0.45 && along > -2.4;
    const k = shut ? -1.0 : lined ? 1.3 : -1.1;
    const [x, , z] = bunkerAt(P, way.r + nr * k, way.f + nf * k);
    const [dx, , dz] = bunkerAt(P, way.r, way.f);
    return { x, z, shut: shut && off < 0.7 && along > -1.6, dx, dz };
  }
  /** where this game's player is listening and looking from */
  readonly eye = new THREE.Vector3();
  /** playing alone: this game is the director too */
  private director: Director | null = null;
  private dirT = 0;
  private sayT = 0;
  private keepT = 0;
  private people = new Map<number, Person>();
  /** the game's clock, milliseconds, as of this frame */
  private now = 0;
  get clock() {
    return this.now;
  }

  constructor(readonly host: HordeHost) {}

  /** Playing alone: the infected of the whole map are this game's to keep and to move. */
  alone() {
    this.clear();
    const world = this.host.world();
    this.director = new Director(infectedHomes(world), (h) => homeSpot(world, h, Math.random));
  }

  /** On a server: what it says is standing in the world now. */
  online(list: InfectedInfo[]) {
    this.clear();
    this.director = null;
    for (const b of list) this.add(b);
  }

  clear() {
    for (const b of this.all.values()) b.dispose();
    this.all.clear();
  }

  add(info: InfectedInfo) {
    if (this.all.has(info.i)) return;
    const b = new Infected(info.i, this.host, this);
    this.all.set(info.i, b);
    void b.load(info).then(() => {
      if (info.own !== null && info.own === this.host.me().id) b.setMine(true);
    });
  }

  remove(i: number) {
    this.all.get(i)?.dispose();
    this.all.delete(i);
  }

  own(i: number, to: number | null) {
    this.all.get(i)?.setMine(to !== null && to === this.host.me().id);
  }

  /** where the games that move the others say they are */
  states(rows: [number, ...IState][], now: number) {
    for (const [i, ...s] of rows) {
      const b = this.all.get(i);
      if (b && !b.mine && !b.dead) b.push(s as IState, now);
    }
  }

  /** the director says what a hit left one with */
  hp(i: number, dead: boolean, by: number, zone: HitZone, dir: [number, number], melee = false) {
    const b = this.all.get(i);
    if (!b) return;
    const mine = by === this.host.me().id;
    if (!mine && !dead && b.ready) b.avatar.hit(zone === 'head');
    if (!dead) b.stagger(melee ? INFECTED.stopStruck : INFECTED.stopShot);
    if (dead && !b.dead) {
      // away from the blow: onto its back from the front, onto its face from behind
      const along = -Math.sin(b.yaw) * dir[0] - Math.cos(b.yaw) * dir[1];
      b.die(along > 0.4 ? 1 : along < -0.4 ? 0 : 2);
      if (mine) this.host.killed(zone, b.pos.distanceTo(this.eye));
    }
  }

  person(id: number): Person | null {
    return this.people.get(id) ?? null;
  }

  // --- walls and the ways through them
  private plots: { id: string; x: number; z: number; c: number; s: number; hw: number; hd: number }[] | null = null;
  private ways: Doorway[] | null = null;

  /** which building a spot is inside (its id), or null for out of doors */
  plotAt(x: number, z: number): string | null {
    this.plots ??= this.host.world().buildings.map((b) => {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      return { id: b.id, x: b.x, z: b.z, c: Math.cos(b.rot), s: Math.sin(b.rot), hw: w / 2, hd: d / 2 };
    });
    for (const p of this.plots) {
      const dx = x - p.x, dz = z - p.z;
      if (Math.abs(dx) > p.hw + p.hd || Math.abs(dz) > p.hw + p.hd) continue;
      if (Math.abs(dx * p.c - dz * p.s) < p.hw - 0.1 && Math.abs(dx * p.s + dz * p.c) < p.hd - 0.1) return p.id;
    }
    return null;
  }

  /** the stairs of a building to take from where something stands: the flight whose near end is at its own height, and the nearest of those */
  flight(plot: string, from: THREE.Vector3, up: boolean) {
    let best: Buildings['flights'][number] | null = null, bd = Infinity;
    for (const f of this.host.buildings().flights) {
      if (f.plot !== plot) continue;
      const near = up ? f.foot : f.off;
      if (Math.abs(near.y - from.y) > 1.2) continue;
      const d = Math.hypot(near.x - from.x, near.z - from.z);
      if (d < bd) [best, bd] = [f, d];
    }
    return best;
  }

  /** the door of a building to go by, from one spot to another: an open one if there is one, and the least far round */
  doorway(plot: string, from: THREE.Vector3, to: THREE.Vector3): Doorway | null {
    if (!this.ways) {
      const b = this.host.buildings();
      this.plotAt(0, 0);
      this.ways = [];
      b.doorSpecs.forEach((s, k) => {
        const mid = new THREE.Vector3(s.w / 2, 0, 0).applyMatrix4(s.m);
        const n = new THREE.Vector3(0, 0, 1).transformDirection(s.m).setY(0).normalize();
        const plot = s.id.slice(0, s.id.lastIndexOf('_door'));
        // (only the doors in the outside walls: one between two rooms leads nowhere but the next room)
        const p = this.plots!.find((q) => q.id === plot);
        if (!p || !b.doors[k]) return;
        const dx = mid.x - p.x, dz = mid.z - p.z;
        if (p.hw - Math.abs(dx * p.c - dz * p.s) > 0.6 && p.hd - Math.abs(dx * p.s + dz * p.c) > 0.6) return;
        this.ways!.push({ plot, mid, n, door: b.doors[k] });
      });
    }
    let best: Doorway | null = null, bd = Infinity;
    for (const w of this.ways) {
      if (w.plot !== plot || !w.door) continue;
      const d = Math.hypot(w.mid.x - from.x, w.mid.z - from.z) + Math.hypot(w.mid.x - to.x, w.mid.z - to.z) + (w.door.open ? 0 : 40);
      if (d < bd) [best, bd] = [w, d];
    }
    return best;
  }

  /**
   * Whether a step to there would bring one of them into another: closer than shoulder to
   * shoulder, and closer than it is now (stepping apart is always allowed).
   */
  crowded(b: Infected, x: number, z: number): boolean {
    for (const o of this.all.values()) {
      if (o === b || o.dead || !o.ready || Math.abs(o.pos.y - b.pos.y) > 1.2) continue;
      const dx = o.pos.x - x, dz = o.pos.z - z;
      if (Math.abs(dx) > APART || Math.abs(dz) > APART) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < APART * APART && d2 < (o.pos.x - b.pos.x) ** 2 + (o.pos.z - b.pos.z) ** 2 - 1e-5) return true;
    }
    return false;
  }

  /** the director (playing alone) or the server says a blow of one's was stopped by somebody's guard */
  blocked(i: number, to: number) {
    const b = this.all.get(i);
    if (!b) return;
    b.stagger(INFECTED.stopBlocked);
    audio.impact('flesh', b.pos, b.pos.distanceTo(this.eye));
    if (to === this.host.me().id) this.host.guarded(b.pos);
  }

  /** A noise at a place, heard this far off: the ones this game moves go to see. */
  noise(x: number, z: number, range: number) {
    const at = new THREE.Vector3(x, 0, z);
    for (const b of this.all.values()) {
      if (!b.mine || b.dead) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < range) b.hearAt(at.set(x, b.pos.y, z));
    }
  }

  /** one of them has seen somebody and said so: the others within earshot of it turn that way */
  cry(from: Infected, at: THREE.Vector3) {
    for (const b of this.all.values()) {
      if (b === from || !b.mine || b.dead) continue;
      if (b.pos.distanceToSquared(from.pos) < 28 * 28) b.hearAt(at);
    }
  }

  /** a shot or a blow of this player's landed on one: true if that was the end of it (known at once only when playing alone) */
  hurt(b: Infected, amount: number, dir: THREE.Vector3): boolean {
    if (!this.director) return false;
    const r = this.director.hurt(b.i, amount, this.now);
    if (!r?.dead) return false;
    const had = infectedDrop();
    if (had) this.host.dropped(had[0], had[1], b.pos);
    const along = -Math.sin(b.yaw) * dir.x - Math.cos(b.yaw) * dir.z;
    b.die(along > 0.4 ? 1 : along < -0.4 ? 0 : 2);
    return true;
  }

  /** one this game moves has brought its arms down on somebody */
  strike(b: Infected, on: Person) {
    if (this.director) {
      // (alone there is nobody else to hit)
      if (this.director.strikes(b.i, on.id, { id: on.id, x: on.pos.x, z: on.pos.z }, this.now) && !this.host.struck(INFECTED.damage + Math.round((Math.random() - 0.5) * 4), b.pos)) {
        b.stagger(INFECTED.stopBlocked);
        audio.impact('flesh', b.pos, b.pos.distanceTo(this.eye));
      }
      return;
    }
    this.host.send({ t: 'iatk', i: b.i, to: on.id });
  }

  update(dt: number, now: number, eye: THREE.Vector3) {
    this.eye.copy(eye);
    this.now = now;
    const me = this.host.me();
    this.people.clear();
    this.people.set(me.id, me);
    for (const p of this.host.others()) this.people.set(p.id, p);
    if (this.director) {
      this.dirT += dt;
      if (this.dirT > 1) {
        this.dirT = 0;
        const turn = this.director.tick(now, me.alive ? [{ id: me.id, x: me.pos.x, z: me.pos.z }] : []);
        for (const i of turn.gone) this.remove(i);
        for (const b of turn.added) this.add(b);
        for (const [i, to] of turn.owned) this.own(i, to);
      }
    }
    // the ones this game moves keep out of each other
    const mine: Infected[] = [];
    for (const b of this.all.values()) {
      b.update(dt, now, eye);
      if (b.mine && !b.dead && b.ready) mine.push(b);
    }
    for (let a = 0; a < mine.length; a++) {
      for (let c = a + 1; c < mine.length; c++) {
        const dx = mine[c].pos.x - mine[a].pos.x, dz = mine[c].pos.z - mine[a].pos.z;
        const d = Math.hypot(dx, dz);
        if (d > APART || d < 1e-3 || Math.abs(mine[c].pos.y - mine[a].pos.y) > 1.2) continue;
        const push = (APART - d) / 2 / d;
        mine[a].nudge(-dx * push, -dz * push);
        mine[c].nudge(dx * push, dz * push);
      }
    }
    // say where they are: eight times a second what has moved, all of them once a second
    this.sayT += dt;
    this.keepT += dt;
    if (this.sayT < 0.125) return;
    this.sayT = 0;
    const all = this.keepT > 1;
    if (all) this.keepT = 0;
    const rows: [number, ...IState][] = [];
    for (const b of mine) {
      const r = b.report(all);
      if (r) rows.push(r);
    }
    if (!rows.length) return;
    if (this.director) this.director.report(me.id, rows, now);
    else this.host.send({ t: 'is', s: rows });
  }
}
