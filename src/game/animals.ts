// The animals as the game draws them (2026-10-23). Every one is moved by the server (src/sim/animal-mind.ts); this
// draws each where it is told, between one word of it and the next, sat to the slope it stands on, playing the movement
// for what it is doing (the clip for its mode, as fast as it goes), and gives it places to be shot in. Drawn within
// DRAWN metres of the eye, moving within MOVED; past that a still body, and further, nothing.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { physics, HITBOX_GROUPS } from '../core/physics';
import { assets } from '../core/assets';
import { breathe } from '../core/breathe';
import type { Atmosphere } from '../world/atmosphere';
import { heightAt, type World } from '../world/worldgen';
import { ANIMALS, A_ALERT, A_BITE, A_DEAD, A_DRINK, A_GRAZE, A_HIT, A_IDLE, A_REST, A_ROAR, A_RUN, A_SWIPE, A_TROT, A_WALK, KINDS, ROW_BLEEDS, type AnimalRow, type Kind } from '../sim/animals';
import { Herd, type Seen, type Strike } from '../sim/animal-mind';
import { animalGround } from '../sim/animal-ground';
import type { Damageable, HitZone } from './weapons';

export interface WildHost {
  atmo(): Atmosphere;
  scene(): THREE.Scene;
  world(): World;
  /** blood where a hurt one has gone */
  drip(at: THREE.Vector3): void;
  /** playing alone: this player as the animals know of them (null: dead, or not in the world yet) */
  me(): Seen | null;
  /** playing alone: the share of the day it is */
  hour(): number;
  /** playing alone: one of them has struck this player */
  struck(s: Strike, kind: Kind): void;
}

/** the clip each mode plays, and what stands in for it in a model without it */
const CLIPS: Record<number, string[]> = {
  [A_IDLE]: ['idle'], [A_GRAZE]: ['graze', 'idle'], [A_WALK]: ['walk', 'trot'], [A_TROT]: ['trot', 'run', 'walk'], [A_RUN]: ['run', 'trot'],
  [A_ALERT]: ['alert', 'idle'], [A_REST]: ['rest', 'idle'], [A_SWIPE]: ['swipe', 'bite', 'idle'], [A_BITE]: ['bite', 'swipe', 'idle'],
  [A_ROAR]: ['roar', 'alert', 'idle'], [A_HIT]: ['hit', 'idle'], [A_DEAD]: ['death'], [A_DRINK]: ['drink', 'graze', 'idle'],
};
/** the movements played once and held at their end, not looped */
const ONCE = new Set(['death', 'swipe', 'bite', 'roar', 'hit']);
const DRAWN = 260;
const MOVED = 120;
/** how far behind the server's word it is drawn, so that there is always a word on either side of now, ms */
const BEHIND = 320;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

interface Kit {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}
const kits = new Map<string, Promise<Kit | null>>();

/** a kind's model and its movements, cut and named (once a kind, shared by every one of it) */
function kitOf(kind: Kind): Promise<Kit | null> {
  let k = kits.get(kind.model);
  if (!k) {
    k = (async () => {
      const entry = assets.manifest.models[kind.model] as { cuts?: Record<string, [number, number]> } | undefined;
      if (!entry) return null;
      const gltf = await assets.gltfOf(kind.model);
      const clips = new Map<string, THREE.AnimationClip>();
      if (entry.cuts) {
        // (one long take, cut where its movements change: scripts/animals.mjs)
        const take = gltf.animations[0];
        for (const [name, [a, b]] of Object.entries(entry.cuts)) clips.set(name, THREE.AnimationUtils.subclip(take, name, Math.round(a * 30), Math.round(b * 30), 30));
      } else for (const c of gltf.animations) clips.set(c.name, c);
      return { scene: gltf.scene, clips };
    })().catch((e) => {
      console.warn(`animal ${kind.id}:`, e);
      return null;
    });
    kits.set(kind.model, k);
  }
  return k;
}

export class Beast implements Damageable {
  readonly name: string;
  readonly kind: Kind;
  readonly root = new THREE.Group();
  x = 0;
  z = 0;
  yaw = 0;
  mode = A_IDLE;
  dead = false;
  bleeds = false;
  /** the body is gone (gutted): it is taken away */
  gone = false;
  private snaps: { t: number; x: number; z: number; yaw: number; mode: number }[] = [];
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private playing: THREE.AnimationAction | null = null;
  private playingName = '';
  private body: RAPIER.RigidBody | null = null;
  private zones: RAPIER.Collider[] = [];
  private speed = 0;
  private fall = 0;
  private dripT = 0;
  private poseT = 0;
  private meshes: THREE.Mesh[] = [];
  private shadow = false;

  constructor(readonly i: number, k: number, private host: WildHost) {
    this.kind = KINDS[k];
    this.name = this.kind.name;
  }

  async load() {
    const kit = await kitOf(this.kind);
    if (!kit || this.gone) return;
    await breathe();
    const model = SkeletonUtils.clone(kit.scene);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.receiveShadow = true;
      this.meshes.push(m);
      // (a skinned body's bounds, worked out once in its rest pose and given room for its movements: worked out every
      // frame they would cost more than the body; and it is left out of the picture when it is out of view)
      const sk = m as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) {
        sk.computeBoundingSphere();
        sk.boundingSphere!.radius *= 1.6;
      }
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => this.host.atmo().register(mat));
    });
    this.model = model;
    this.root.add(model);
    this.root.rotation.order = 'YXZ';
    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, clip] of kit.clips) {
      const a = this.mixer.clipAction(clip);
      if (ONCE.has(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(name, a);
    }
    await breathe();
    this.host.scene().add(this.root);
    // where it can be hit: the body, the head before it, the legs under it (src/game/weapons.ts reads the zone)
    const R = physics.R, k = this.kind;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.x, heightAt(this.host.world().heights, this.x, this.z), this.z));
    const zone = (desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body!);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
      this.zones.push(c);
    };
    zone(R.ColliderDesc.cuboid(k.len * 0.16, k.tall * 0.24, k.len * 0.34).setTranslation(0, k.tall * 0.72, 0), 'torso');
    zone(R.ColliderDesc.ball(Math.max(0.08, k.tall * 0.15)).setTranslation(0, k.tall * 0.95, -k.len * 0.45), 'head');
    zone(R.ColliderDesc.cuboid(k.len * 0.14, k.tall * 0.24, k.len * 0.3).setTranslation(0, k.tall * 0.24, 0), 'legs');
    if (this.dead) this.die(true);
  }

  /** where the server says it is */
  push(r: AnimalRow, now: number) {
    const s = { t: now, x: r[2] / 10, z: r[3] / 10, yaw: r[4] / 100, mode: r[5] };
    if (!this.snaps.length) {
      this.x = s.x;
      this.z = s.z;
      this.yaw = s.yaw;
      this.mode = s.mode;
    }
    this.snaps.push(s);
    if (this.snaps.length > 10) this.snaps.shift();
    this.bleeds = !!(r[6] & ROW_BLEEDS);
    if (s.mode === A_DEAD && !this.dead) this.die();
  }

  /** a hit: what it did is the server's to say (`hp`, below) */
  damage(amount: number, _point: THREE.Vector3, _dir: THREE.Vector3, _zone: HitZone): boolean {
    // (on a server, what it did is the server's to say; alone, this game's own herds say it)
    return this.alone?.(amount) ?? false;
  }
  /** playing alone: a hit taken to this game's own herds, which say whether it died */
  alone: ((amount: number) => boolean) | null = null;

  /** it has died: down it goes, and nothing more is shot into it */
  die(already = false) {
    this.dead = true;
    this.mode = A_DEAD;
    for (const c of this.zones) physics.world.removeCollider(c, false);
    this.zones = [];
    if (already) this.fall = 1;
  }

  update(dt: number, now: number, eye: THREE.Vector3) {
    // where it was BEHIND ago, between the two words either side of then
    const t = now - BEHIND, s = this.snaps;
    let a = s[0], b = s[s.length - 1];
    for (let n = 1; n < s.length; n++) {
      if (s[n].t >= t) {
        a = s[n - 1];
        b = s[n];
        break;
      }
    }
    if (a && b) {
      const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
      const nx = a.x + (b.x - a.x) * k, nz = a.z + (b.z - a.z) * k;
      this.speed = dt > 0 ? THREE.MathUtils.lerp(this.speed, Math.hypot(nx - this.x, nz - this.z) / dt, Math.min(1, dt * 6)) : this.speed;
      this.x = nx;
      this.z = nz;
      this.yaw = lerpAngle(a.yaw, b.yaw, k);
      if (!this.dead) this.mode = k < 1 ? a.mode : b.mode;
    }
    const d = Math.hypot(this.x - eye.x, this.z - eye.z);
    this.root.visible = !!this.model && d < DRAWN;
    if (!this.model) return;
    // sat on the ground it stands on, nose up a slope and down one
    const w = this.host.world(), k = this.kind;
    const fx = -Math.sin(this.yaw) * k.len * 0.45, fz = -Math.cos(this.yaw) * k.len * 0.45;
    const hf = heightAt(w.heights, this.x + fx, this.z + fz), hb = heightAt(w.heights, this.x - fx, this.z - fz);
    const y = Math.min(hf, hb, heightAt(w.heights, this.x, this.z)) + 0.02;
    this.root.position.set(this.x, y, this.z);
    this.root.rotation.set(Math.atan2(hf - hb, k.len * 0.9), this.yaw, 0);
    if (this.body) {
      this.body.setNextKinematicTranslation({ x: this.x, y, z: this.z });
      this.body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(this.root.rotation));
    }
    if (this.bleeds && !this.dead && (this.dripT -= dt) <= 0) {
      this.dripT = 0.35 + Math.random() * 0.3;
      this.host.drip(new THREE.Vector3(this.x, y + k.tall * 0.6, this.z));
    }
    if (!this.root.visible) return;
    // (its shadow only near the eye, where it is seen)
    const shadow = d < 90;
    if (shadow !== this.shadow) {
      this.shadow = shadow;
      for (const m of this.meshes) m.castShadow = shadow;
    }
    this.play(dt);
    // (posed every frame near the eye; further off, a few times a second)
    this.poseT += dt;
    const every = d < MOVED ? 0 : 0.25;
    if (this.poseT >= every) {
      this.mixer!.update(this.poseT);
      this.poseT = 0;
    }
  }

  /** the movement for what it is doing, at the pace it is going */
  private play(dt: number) {
    const names = CLIPS[this.mode] ?? ['idle'];
    const name = names.find((n) => this.actions.has(n)) ?? '';
    const act = this.actions.get(name) ?? null;
    if (this.dead && !act) {
      // (A body with no movement of its dying goes over onto its side, faster as it goes, its legs as they were, and
      // lies flat where it stood: its middle comes down from where it was to half its girth over the ground.)
      if (this.playing) this.playing.paused = true;
      this.fall = Math.min(1, this.fall + dt * 2.4);
      const t = this.fall * this.fall, a = -t * Math.PI / 2, mid = this.kind.tall * 0.72, girth = this.kind.len * 0.11;
      this.model!.rotation.z = a;
      this.model!.position.set(mid * Math.sin(a), mid + (girth - mid) * t - mid * Math.cos(a), 0);
      return;
    }
    if (act && name !== this.playingName) {
      act.reset().play();
      if (this.playing) act.crossFadeFrom(this.playing, ONCE.has(name) ? 0.12 : 0.3, false);
      this.playing = act;
      this.playingName = name;
    }
    // (a gait played as fast as the animal is going, beside the pace it was drawn for)
    if (act && (name === 'walk' || name === 'trot' || name === 'run')) {
      const pace = name === 'walk' ? this.kind.walk : name === 'trot' ? this.kind.trot : this.kind.run;
      act.timeScale = THREE.MathUtils.clamp(this.speed / pace, 0.6, 1.6);
    } else if (act) act.timeScale = 1;
  }

  dispose() {
    this.gone = true;
    this.host.scene().remove(this.root);
    this.mixer?.stopAllAction();
    if (this.body) physics.world.removeRigidBody(this.body);
    this.body = null;
    this.zones = [];
  }
}

export class Wildlife {
  readonly beasts = new Map<number, Beast>();
  /** playing alone, the herds are this game's own (as the server keeps them online: src/sim/animal-mind.ts) */
  herd: Herd | null = null;
  private stepT = 0;

  constructor(private host: WildHost) {}

  /** Playing alone: the herds are stood a moment after the world is up (they take most of a second), away from the player. */
  alone() {
    this.clear();
    const world = this.host.world();
    window.setTimeout(() => {
      if (this.herd) return;
      const herd = new Herd(animalGround(world), (k) => !!assets.manifest.models[k.model], () => this.host.hour());
      const me = this.host.me();
      herd.populate(Date.now(), me ? [me] : []);
      this.herd = herd;
    }, 1500);
  }

  /** gone online: the server keeps them from here */
  leaveAlone() {
    this.herd = null;
    this.clear();
  }

  /** Playing alone, five times a second: the herds think, their blows land, and this game is told of them as a server would tell it. */
  tickAlone(dt: number) {
    if (!this.herd || (this.stepT -= dt) > 0) return;
    this.stepT = ANIMALS.step;
    const me = this.host.me(), now = Date.now();
    if (me) me.sheltered = this.herd.ground.roofed(me.x, me.z);
    const turn = this.herd.tick(now, me ? [me] : []);
    for (const s of turn.strikes) {
      const b = this.herd.beasts.get(s.i);
      if (b) this.host.struck(s, KINDS[b.k]);
    }
    const at = me ?? { x: 0, z: 0 };
    this.rows(this.herd.rows(at.x, at.z, ANIMALS.told), true, performance.now());
  }

  /** playing alone: a shot heard by everything within earshot */
  heard(x: number, z: number, range: [number, number]) {
    this.herd?.heard(x, z, range, Date.now());
  }

  /** what the server says of the animals near this player (all: everything within reach, so any other has gone) */
  rows(rows: AnimalRow[], all: boolean, now: number) {
    const seen = all ? new Set<number>() : null;
    for (const r of rows) {
      seen?.add(r[0]);
      let b = this.beasts.get(r[0]);
      if (!b) {
        if (!KINDS[r[1]]) continue;
        b = new Beast(r[0], r[1], this.host);
        if (this.herd) {
          const herd = this.herd, i = r[0], me = this.host.me();
          b.alone = (amount) => !!herd.hurt(i, amount, me, Date.now())?.dead;
        }
        this.beasts.set(r[0], b);
        b.push(r, now);
        void b.load();
        continue;
      }
      b.push(r, now);
    }
    if (seen) for (const [i, b] of this.beasts) if (!seen.has(i)) this.drop(i, b);
  }

  /** one was hit: whether it died of it */
  hp(i: number, dead: boolean) {
    const b = this.beasts.get(i);
    if (b && dead && !b.dead) b.die();
  }

  /** the body within reach of a place that has not been gutted (null: none) */
  bodyAt(pos: THREE.Vector3, reach: number): Beast | null {
    let best: Beast | null = null, bd = reach;
    for (const b of this.beasts.values()) {
      if (!b.dead || b.gone) continue;
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private drop(i: number, b: Beast) {
    b.dispose();
    this.beasts.delete(i);
  }

  update(dt: number, now: number, eye: THREE.Vector3) {
    for (const b of this.beasts.values()) b.update(dt, now, eye);
  }

  /** everything gone (a new connection, or leaving the server) */
  clear() {
    for (const [i, b] of this.beasts) this.drop(i, b);
  }
}
