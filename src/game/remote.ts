// Other players. Each one is a body driven by the poses the server relays: interpolated
// a little in the past so movement is smooth, with hit zones your bullets and fists can
// land on, the weapon they are holding in their hands, and footsteps you can hear.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, FreeZone, GLASS_GROUPS, HITBOX_GROUPS, SOLID_GROUPS, type Surface } from '../core/physics';
import { audio } from '../core/audio';
import type { Atmosphere } from '../world/atmosphere';
import { EMOTE_BY_N, EMOTE_MASK, EMOTE_SHIFT } from '../sim/emotes';
import { F_AIM, F_BLEED, F_CROUCH, F_LIGHT, F_DANCE, F_DEAD, F_GROUND, F_GUARD, F_LEAN_L, F_LEAN_R, F_LIMP, F_PRONE, F_SIT, F_SURRENDER, type Act, type Pose } from '../net/protocol';
import { SHOUT_RANGE, voiceOf, type Emote } from '../sim/emotes';
import { ITEMS } from '../sim/items';
import { Avatar, type SeatPose } from './avatar';
import { lookFor } from './look';
import type { Damageable, HitZone } from './weapons';
import type { Grips } from './arms';
import type { Jeep } from './vehicle';
import { Timeline, between, caughtUp } from '../net/timeline';


interface Snap {
  t: number;
  p: Pose;
}

const _to = new THREE.Vector3();
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export type HeldFactory = (id: string | null, mods: string[]) => { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee' } | null;

const _along = new THREE.Vector3(), _legs = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _lie = new THREE.Quaternion();
const _head = new THREE.Vector3(), _neck = new THREE.Vector3(), _pelvis = new THREE.Vector3();

/** metres within which what somebody's hands are doing is heard: rounds into a magazine, a box torn open (eating and the like, three less) */
export const HANDS_HEARD = 11;
/** somebody going through what holds things: how long their hands are at it, and within how many metres it is heard
 * (the owner, 2026-10-17: "opening an inventory to loot it should make noise to nearby players") */
export const SEARCHED = { hands: 1.4, heard: 18 };

export class RemotePlayer implements Damageable {
  alive = true;
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  /** they have a light lit */
  lit = false;
  crouched = false;
  weapon: string | null = null;
  mods: string[] = [];
  readonly avatar = new Avatar();
  /** they have an open wound: it drips as they go */
  bleeding = false;
  dripT = 0;
  /** a vanished admin, seen by another admin: drawn faintly (see Avatar.setGhost) */
  ghost = false;
  private ghostT = 0;

  setGhost(on: boolean) {
    this.ghost = on;
    if (this.ready) this.avatar.setGhost(on);
  }
  private body!: RAPIER.RigidBody;
  private stand: RAPIER.Collider[] = [];
  private crouch: RAPIER.Collider[] = [];
  private blocker!: RAPIER.Collider;
  private snaps: Snap[] = [];
  /** when each of those was true, and how far in the past they are shown: see src/net/timeline.ts */
  private line = new Timeline();
  /** the time their game put to the last report of them */
  private stamped: number | undefined;
  private vel = new THREE.Vector3();
  private fall = 0;
  private grounded = true;
  private aiming = false;
  private flinch = 0;
  /** leaning out, -1 (left) .. 1 (right) */
  lean = 0;
  /** sitting in a jeep: which one, and where in it their feet are (in the jeep's own frame) */
  seat: { jeep: Jeep; at: [number, number, number]; how: SeatPose | null } | null = null;
  private sat = false;
  /** lying down (their game says so in its flags): the body lies, and so does what of it can be hit */
  private lying = false;
  private flat: RAPIER.Collider[] = [];
  /** the zones the body bends, by their colliders (see placeZones) */
  private loose = new Map<RAPIER.Collider, FreeZone>();
  /** the middle of the head, in the world, as of the last frame (null until the body has been seen) */
  private headAt: THREE.Vector3 | null = null;
  private ready = false;
  private heldKey = '';

  constructor(public id: number, public name: string, private makeHeld: HeldFactory) {}
  /**
   * A gun made ready to be drawn before it is put in somebody's hands: its shaders made and its pictures sent to the
   * card a frame's spare time at a time (see game.ts). Put in their hands at once, the first player seen with a gun
   * of a kind was that gun's shaders and its 2048 pictures in the one frame: the hitch of up to a fifth of a second
   * as an enemy came into sight (the owner: "when i get into a fight i lag a lot").
   */
  static readyHeld: (obj: THREE.Object3D) => Promise<void> = async () => {};
  /**
   * Gone (they left, or this game did) while the body was still being made: it is let go when it is done, and never
   * put in the world. It was put there all the same, posed by nothing and placed by nothing: a body standing in the
   * shape it was made in at the middle of the map, a hand over the ground, with a blocker and hit zones where they
   * had come in (a player saw one on 2026-10-15, after a restart had everybody coming in at once).
   */
  private gone = false;

  async load(atmo: Atmosphere, scene: THREE.Scene, pose: Pose) {
    await this.avatar.load(atmo, 0, false, lookFor(this.name));
    if (this.gone) return void this.avatar.dispose();
    scene.add(this.avatar.root);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pose[0], pose[1], pose[2]));
    const zone = (list: RAPIER.Collider[], desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
      list.push(c);
    };
    // (the ones the body bends, put where its joints have them each frame (see placeZones), are colliders of their own: see FreeZone)
    const bent = (list: RAPIER.Collider[], desc: RAPIER.ColliderDesc, at: { x: number; y: number; z: number }, z: HitZone) => {
      const f = new FreeZone(desc.setCollisionGroups(HITBOX_GROUPS), at);
      physics.tag(f.collider, { surface: 'flesh', owner: this, zone: z });
      f.place(pose[0], pose[1], pose[2], pose[3]);
      this.loose.set(f.collider, f);
      list.push(f.collider);
    };
    // measured on the body: x to its right, z behind it
    bent(this.stand, R.ColliderDesc.ball(0.125), { x: 0, y: 1.64, z: -0.02 }, 'head');
    // (the body's box took the arms in with it, and a round through a forearm was a round through the chest: the
    // box is the trunk's width now, and the arms hang either side of it as boxes of their own)
    bent(this.stand, R.ColliderDesc.cuboid(0.18, 0.31, 0.14), { x: 0, y: 1.21, z: 0 }, 'torso');
    zone(this.stand, R.ColliderDesc.cuboid(0.055, 0.3, 0.09).setTranslation(-0.24, 1.2, 0), 'arms');
    zone(this.stand, R.ColliderDesc.cuboid(0.055, 0.3, 0.09).setTranslation(0.24, 1.2, 0), 'arms');
    zone(this.stand, R.ColliderDesc.cuboid(0.18, 0.45, 0.14).setTranslation(0, 0.45, 0.03), 'legs');
    // crouched it leans forward over one knee, hips well behind the head
    bent(this.crouch, R.ColliderDesc.ball(0.125), { x: -0.07, y: 1.03, z: -0.12 }, 'head');
    bent(this.crouch, R.ColliderDesc.cuboid(0.17, 0.24, 0.2), { x: -0.07, y: 0.72, z: 0.1 }, 'torso');
    zone(this.crouch, R.ColliderDesc.cuboid(0.05, 0.22, 0.12).setTranslation(-0.29, 0.72, 0.06), 'arms');
    zone(this.crouch, R.ColliderDesc.cuboid(0.05, 0.22, 0.12).setTranslation(0.15, 0.72, 0.06), 'arms');
    zone(this.crouch, R.ColliderDesc.cuboid(0.25, 0.24, 0.3).setTranslation(-0.02, 0.24, 0.07), 'legs');
    // lying: put where the body lies each frame (see placeZones): the legs are behind the hips, not under them
    bent(this.flat, R.ColliderDesc.ball(0.125), { x: 0, y: 0, z: 0 }, 'head');
    bent(this.flat, R.ColliderDesc.cuboid(0.25, 0.31, 0.14), { x: 0, y: 0, z: 0 }, 'torso');
    bent(this.flat, R.ColliderDesc.cuboid(0.2, 0.45, 0.14), { x: 0, y: 0, z: 0 }, 'legs');
    for (const c of [...this.crouch, ...this.flat]) c.setEnabled(false);
    // players can't walk through each other; shots are only stopped by the hit zones
    this.blocker = physics.world.createCollider(R.ColliderDesc.capsule(0.5, 0.27).setTranslation(0, 0.8, 0).setCollisionGroups(GLASS_GROUPS), this.body);
    this.pos.set(pose[0], pose[1], pose[2]);
    this.yaw = pose[3];
    this.ready = true;
    // (where they are as the server first said: kept by no clock, and gone when their own first report comes)
    this.snaps.push({ t: 0, p: pose });
    this.setAlive(!(pose[5] & F_DEAD));
  }

  /**
   * A pose arrived from the server.
   * @param stamp when it was true by the clock of the game it is of, where the server passes that on (an older
   *   server does not: it is then kept by when it came, as all were)
   */
  push(p: Pose, now: number, stamp?: number) {
    let last: Snap | undefined = this.snaps[this.snaps.length - 1];
    let at: number;
    if (stamp !== undefined && stamp === this.stamped) {
      // Nothing new from their game since the server last said: it has passed the same report on again (its
      // fifteen a second and theirs are not in step). Taken for news, that was a runner stopped dead for a tick.
      if (last && last.p.every((v, i) => v === p[i])) return;
      // (what differs then is the server's own doing: they were killed, moved, brought back. True as of now.)
      at = this.line.theirs(now);
    } else {
      const epoch = this.line.epoch;
      at = this.line.place(stamp ?? now, now);
      if (this.line.epoch !== epoch) {
        this.snaps.length = 0;
        last = undefined;
      }
      this.stamped = stamp;
    }
    // (two with one time to them: the later is what is so)
    if (last && at <= last.t) last.p = p;
    else this.snaps.push({ t: at, p });
    if (this.snaps.length > 12) this.snaps.shift();
  }

  setWeapon(id: string | null, mods: string[]) {
    const key = `${id}|${mods.join(',')}`;
    if (key === this.heldKey || !this.ready) return;
    this.heldKey = key;
    this.weapon = id;
    this.mods = mods;
    const h = this.makeHeld(id, mods);
    const put = () => {
      if (this.heldKey === key) this.avatar.setHeld(h?.obj ?? null, h?.grips ?? null, h?.kind);
    };
    if (h?.obj) void RemotePlayer.readyHeld(h.obj).then(put, put);
    else put();
  }

  /** where the physics was last told they are, and which way they faced */
  private told = { x: NaN, y: NaN, z: NaN, yaw: NaN };

  /** when they were last told dead */
  private diedAt = 0;

  /**
   * A position of theirs that does not say they are dead. Just after a death that is no news: it was sent before
   * their own game knew, and reached the server after the server did. (Taken for a return to life, it stood them
   * up again on their own body, for as long as they stayed dead.)
   */
  seenAlive(now: number) {
    if (this.ready && !this.alive && now - this.diedAt > 3000) this.setAlive(true);
  }

  /** when they were last told alive */
  private aliveAt = 0;

  /**
   * A position of theirs that says they are dead, while this game has them alive. Whatever stood them up (a word
   * that they were back which their own game never acted on, one missed while their body was still being made
   * here), they are not drawn standing over their own body while they are lying dead: 2026-10-12, "their player
   * model spawned again over their dead body and was looking around but they couldn't move". Just after a return
   * to life it is no news: their game sends a position or two before it has heard.
   */
  seenDead(now: number) {
    if (this.ready && this.alive && now - this.aliveAt > 1500) this.setAlive(false);
  }

  /** out of sight at once, dead: their body is drawn elsewhere (sat in a helicopter: see riders.ts) */
  vanish() {
    this.fall = 4;
    this.avatar.root.visible = false;
  }

  setAlive(alive: boolean) {
    // (a body still being made here has nothing yet to stand up or lay down: what their positions say settles it when it is made)
    if (alive === this.alive || !this.ready) return;
    this.alive = alive;
    if (!alive) this.diedAt = performance.now();
    else this.aliveAt = performance.now();
    // (a body going down is heard from where it falls, by whoever is near)
    if (!alive) audio.bodyFall(this.pos, this.pos.distanceTo(this.heard));
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
    if (this.alive && this.avatar.frame(_head, _neck, _pelvis)) this.bendZones();
    // (the bent ones are colliders of their own: put where the body now is, bent this frame or not)
    for (const c of this.lying ? this.flat : this.crouched ? this.crouch : this.stand) this.loose.get(c)?.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
  }

  /** a bent zone's place (and turn) on the body, in the body's own frame */
  private bend(c: RAPIER.Collider, at: THREE.Vector3, turn?: { x: number; y: number; z: number; w: number }) {
    const f = this.loose.get(c)!;
    f.at.x = at.x;
    f.at.y = at.y;
    f.at.z = at.z;
    if (turn) Object.assign(f.turn, { x: turn.x, y: turn.y, z: turn.z, w: turn.w });
  }

  private bendZones() {
    (this.headAt ??= new THREE.Vector3()).copy(_head);
    // into the body's own frame: x to its right, z behind it
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const v of [_head, _neck, _pelvis]) {
      const x = v.x - this.pos.x, z = v.z - this.pos.z;
      v.set(x * c - z * s, v.y - this.pos.y, x * s + z * c);
    }
    if (this.lying) {
      // the chest along the line from the hips to the neck, whichever way that lies; the legs on the same line, behind the hips
      const along = _along.copy(_neck).sub(_pelvis).normalize();
      const q = _lie.setFromUnitVectors(_up, along);
      this.bend(this.flat[0], _head);
      this.bend(this.flat[2], _legs.copy(_pelvis).addScaledVector(along, -0.48), q);
      this.bend(this.flat[1], _pelvis.lerp(_neck, 0.54), q);
      return;
    }
    const set = this.crouched ? this.crouch : this.stand;
    this.bend(set[0], _head);
    // the chest: between the hips and the neck, and over to one side as far as the back is
    const roll = Math.atan2(_neck.x - _pelvis.x, _neck.y - _pelvis.y);
    this.bend(set[1], _pelvis.lerp(_neck, 0.54), { x: 0, y: 0, z: Math.sin(-roll / 2), w: Math.cos(-roll / 2) });
  }

  private applyZones() {
    for (const c of this.stand) c.setEnabled(this.alive && !this.crouched && !this.lying);
    for (const c of this.crouch) c.setEnabled(this.alive && this.crouched && !this.lying);
    for (const c of this.flat) c.setEnabled(this.alive && this.lying);
  }

  /**
   * The lamp they have lit, if they have: where it is and which way it throws. The one on their
   * gun if the gun has one (from the end of the barrel, along it); otherwise the flashlight
   * they carry, from the chest, the way they are looking.
   */
  lamp(pos: THREE.Vector3, dir: THREE.Vector3): { power: number; wide: number } | null {
    if (!this.lit || !this.ready || !this.alive) return null;
    const gun = this.mods.includes('gun_light') ? this.avatar.muzzle(pos, dir) : null;
    if (gun) return { power: 1.5, wide: 0.85 };
    const cp = Math.cos(this.pitch);
    dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    pos.set(this.pos.x + dir.x * 0.25, this.pos.y + (this.crouched ? 0.85 : 1.32), this.pos.z + dir.z * 0.25);
    return { power: 1, wide: 1.3 };
  }

  /** the end of the barrel they are holding, and which way it points, as they are seen now (null if they are not, or hold no gun) */
  muzzle() {
    return this.ready && this.alive ? this.avatar.muzzle() : null;
  }

  /** they threw a punch or swung what they are holding */
  swing() {
    if (!this.ready || !this.alive) return;
    const melee = this.weapon ? ITEMS[this.weapon]?.melee : undefined;
    this.avatar.swing(false, melee ? melee.rate * 0.9 : undefined);
    if (this.pos.distanceToSquared(this.heard) < 30 * 30) audio.whoosh(this.weapon ? 0.6 : 0, this.pos);
  }

  /** they are working the bolt, reloading, eating, dressing a wound: seen, and heard if close */
  /** @param searched hands opened at what holds things (see Game's `searched`): a crate's lid or a cupboard ('hard'), a body or a pack ('soft') */
  act(a: Act, dur: number, listener: THREE.Vector3, searched: 'hard' | 'soft' | null = null) {
    if (!this.ready || !this.alive) return;
    if (a === 'stop') return this.avatar.act(null);
    // (rounds going into a magazine and a box being torn open are hands at work in front of the body, as opening anything is)
    this.avatar.act(a === 'load' || a === 'unbox' ? 'open' : a, dur);
    if (searched) {
      if (this.pos.distanceToSquared(listener) < SEARCHED.heard * SEARCHED.heard) audio.rummage(this.pos, searched === 'hard');
      return;
    }
    // A magazine going in is heard only by whoever is close, and a bolt worked by whoever is closer still. And the
    // small things hands do are heard by whoever is within a room's length: rounds clicked into a magazine one by
    // one, a box torn open, somebody eating or drinking or seeing to a wound. It is how the one who is not seen is
    // found.
    const d2 = this.pos.distanceToSquared(listener);
    if (a === 'bolt' && d2 < 12 * 12) audio.boltCycle(0, this.pos, this.weapon === 'benelli' ? 'pump' : 'bolt');
    else if (a === 'reload' && d2 < 22 * 22) audio.reloadNear(this.pos, dur, ITEMS[this.weapon ?? '']?.weapon?.kind === 'pistol');
    else if (a === 'load' && d2 < HANDS_HEARD * HANDS_HEARD) audio.ui('round', this.pos);
    else if (a === 'unbox' && d2 < HANDS_HEARD * HANDS_HEARD) audio.ui('unbox', this.pos);
    else if ((a === 'eat' || a === 'drink' || a === 'bandage' || a === 'open') && d2 < (HANDS_HEARD - 3) * (HANDS_HEARD - 3)) audio.ui(a, this.pos);
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
    // --- between the two poses either side of the moment being shown: a little in the past, by their clock
    const t = this.line.at(now, dt);
    const span = between(this.snaps, t);
    if (span) {
      const { a, b, k } = span;
      const prev = this.pos.clone();
      // a jump of more than a few metres is a teleport (respawn), not a sprint
      const tele = Math.hypot(b.p[0] - this.pos.x, b.p[2] - this.pos.z) > 12;
      _to.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
      // (somebody a held-up report left behind makes the ground up at a run: see caughtUp)
      const secs = (b.t - a.t) / 1000;
      const going = secs > 0 ? Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) / secs : 0;
      if (tele) this.pos.copy(_to);
      else this.pos.lerp(_to, caughtUp(this.pos.distanceTo(_to), going, dt));
      this.yaw = lerpAngle(a.p[3], b.p[3], Math.min(1, k));
      this.pitch = a.p[4] + (b.p[4] - a.p[4]) * Math.min(1, k);
      this.grounded = !!(b.p[5] & F_GROUND);
      this.aiming = !!(b.p[5] & F_AIM);
      this.lit = !!(b.p[5] & F_LIGHT);
      this.avatar.guarding = this.alive && !!(b.p[5] & F_GUARD);
      this.avatar.limping = this.alive && !!(b.p[5] & F_LIMP);
      this.bleeding = !!(b.p[5] & F_BLEED);
      this.avatar.setHold(b.p[5] & F_DANCE ? 'dance' : b.p[5] & F_SURRENDER ? 'surrender' : b.p[5] & F_SIT ? 'sit' : null);
      // (and which of the emote pack's movements is danced, if one is: src/sim/emotes.ts)
      const danced = b.p[5] & F_DANCE ? EMOTE_BY_N[(b.p[5] & EMOTE_MASK) >> EMOTE_SHIFT] : undefined;
      this.avatar.setClip(danced?.clip ?? null, !!danced?.once);
      if (this.lying !== !!(b.p[5] & F_PRONE)) {
        this.lying = !this.lying;
        this.avatar.setProne(this.lying);
        this.applyZones();
      }
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
      this.avatar.setSeat(this.sat, seat?.how);
      this.blocker.setEnabled(this.alive && !this.sat);
    }

    // (the physics is told where they are when they have moved: somebody standing still is not a body to work out afresh every step)
    const was = this.told;
    if (this.pos.x !== was.x || this.pos.y !== was.y || this.pos.z !== was.z || this.yaw !== was.yaw) {
      was.x = this.pos.x;
      was.y = this.pos.y;
      was.z = this.pos.z;
      was.yaw = this.yaw;
      const half = this.yaw / 2;
      this.body.setNextKinematicTranslation(this.pos);
      this.body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    }

    // (faint, and whatever they have put on or taken up since is made faint with them)
    if (this.ghost && (this.ghostT += dt) > 0.6) {
      this.ghostT = 0;
      this.avatar.setGhost(true);
    }
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
    // --- and somebody crawling: quieter than a step, and heard less far ("they can snake around with no audio", the owner, 2026-10-14)
    if (this.alive && this.avatar.pull && this.pos.distanceTo(listener) < 30) {
      const hit = physics.raycast({ x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 1, SOLID_GROUPS);
      audio.crawl((hit?.tag?.surface ?? 'grass') as Surface, this.pos);
    }
  }

  dispose() {
    this.gone = true;
    this.avatar.dispose();
    if (this.ready) {
      for (const c of [...this.stand, ...this.crouch, ...this.flat, this.blocker]) physics.tags.delete(c.handle);
      // (the bent zones are on no body: see FreeZone)
      for (const c of this.loose.keys()) physics.world.removeCollider(c, false);
      physics.world.removeRigidBody(this.body);
    }
  }
}

/** A dead player's body lying where they fell. Purely visual: the game pairs it with a searchable container. */
export class CorpseBody {
  private avatar = new Avatar();
  /** taken away while it was still being made (see RemotePlayer.gone) */
  private gone = false;
  /** @param name whose body it is: it is dressed the way they were */
  /** @param slope which way is up out of what it lies on (on a hillside it lies along the hill, not level in the air over it) */
  async load(atmo: Atmosphere, scene: THREE.Scene, x: number, y: number, z: number, yaw: number, name: string, variant = 0, slope?: THREE.Vector3) {
    await this.avatar.load(atmo, 0, false, lookFor(name));
    if (this.gone) return void this.avatar.dispose();
    scene.add(this.avatar.root);
    this.avatar.layDown(variant);
    this.avatar.update(0, new THREE.Vector3(x, y, z), new THREE.Vector3(), yaw, false, true);
    if (slope && slope.y > 0.6 && slope.y < 0.9995) this.avatar.root.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), slope));
    // (A body never moves again: its pose is worked out once, and its skeleton sent to the card once. Worked out anew
    // every frame, forty bodies cost 9 ms of every frame, and since bodies lie an hour there are that many: 2026-10-18,
    // "after the most recent update fps has tanked".)
    const root = this.avatar.root;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.skeleton.update();
      m.skeleton.update = () => {};
    });
    root.matrixAutoUpdate = false;
    root.matrixWorldAutoUpdate = false;
  }
  dispose() {
    this.gone = true;
    this.avatar.dispose();
  }
}
