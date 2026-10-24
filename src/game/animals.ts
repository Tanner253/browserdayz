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
import { grassUniforms } from '../world/grass';
import { ANIMALS, CALLS, type Call, A_ALERT, A_BITE, A_DEAD, A_DRINK, A_GRAZE, A_HIT, A_IDLE, A_REST, A_ROAR, A_RUN, A_SWIPE, A_TROT, A_WALK, KINDS, ROW_BLEEDS, type AnimalRow, type Kind } from '../sim/animals';
import { Herd, type Seen, type Strike } from '../sim/animal-mind';
import { animalGround } from '../sim/animal-ground';
import type { RockPiece } from '../sim/pass';
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
  /** something of them is heard: a call (src/sim/animal-calls.ts) or a movement's own sound, from where it was */
  heard(name: string, at: THREE.Vector3): void;
}

/** the clip each mode plays, and what stands in for it in a model without it */
const CLIPS: Record<number, string[]> = {
  [A_IDLE]: ['idle'], [A_GRAZE]: ['graze', 'idle'], [A_WALK]: ['walk', 'trot'], [A_TROT]: ['trot', 'run', 'walk'], [A_RUN]: ['run', 'trot'],
  [A_ALERT]: ['alert', 'idle'], [A_REST]: ['rest', 'idle'], [A_SWIPE]: ['swipe', 'bite', 'idle'], [A_BITE]: ['bite', 'swipe', 'alert', 'idle'],
  [A_ROAR]: ['roar', 'alert', 'idle'], [A_HIT]: ['hit', 'idle'], [A_DEAD]: ['death'], [A_DRINK]: ['drink', 'graze', 'idle'],
};
/** the movements played once and held at their end, not looped */
const ONCE = new Set(['death', 'swipe', 'bite', 'roar', 'hit']);
/**
 * What is heard as a movement begins, by kind and what it is doing (the first of its CLIPS), and how near it has to
 * be, metres: a bear's roar as it charges, its growl and bite; a wolf's growl and snarl; hooves when deer break into a
 * run. The recordings: scripts/sounds.mjs.
 */
const SOUNDS: Record<string, Record<string, [name: string, reach: number]>> = {
  bear: { roar: ['bear_roar', 300], swipe: ['bear_growl', 90], bite: ['bear_bite', 90] },
  // (a wolf stood watching you from close growls; going in, it snarls)
  wolf: { alert: ['wolf_growl', 40], bite: ['wolf_snarl', 60] },
  stag: { run: ['hooves', 60] },
  doe: { run: ['hooves', 60] },
};
/**
 * some sounds at most this often, milliseconds, whoever makes them: a whole herd breaking into a run is one sound of
 * running, not five; a pack circling and snarling is a growl now and then, not one from every wolf at every turn
 */
const GAP: Record<string, number> = { hooves: 2000, wolf_growl: 1500 };
const saidAt = new Map<string, number>();
const DRAWN = 260;
const MOVED = 120;
/** how far behind the server's word it is drawn, so that there is always a word on either side of now, ms */
const BEHIND = 320;
/** one turn and one sphere, reused every frame */
const TURN = new THREE.Quaternion(), SEEN = new THREE.Sphere();
/**
 * Measuring what the animals cost (replay.mjs --flip __noAnimals): every half second they are taken out (not drawn,
 * not thought for) and put back; and meanwhile a kind with no model of its own yet is drawn as the stag is, so that
 * there is something to measure. Neither is so in play.
 */
const MEASURING = typeof location !== 'undefined' && new URLSearchParams(location.search).get('flip') === '__noAnimals';
const out = () => !!(globalThis as { __noAnimals?: boolean }).__noAnimals;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

interface Kit {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  /** each gait's own pace over the ground, metres a second (scripts/animals.mjs measures it) */
  paces: Record<string, number>;
  /** the moment each blow lands in its movement, seconds in (the same) */
  strikes: Record<string, number>;
  /** how far under the ground a movement puts its lowest, metres, where its rest is not standing (the same) */
  floors: Record<string, number>;
}
const kits = new Map<string, Promise<Kit | null>>();

/** a kind's model and its movements, cut and named (once a kind, shared by every one of it) */
function kitOf(kind: Kind): Promise<Kit | null> {
  let k = kits.get(kind.model);
  if (!k) {
    k = (async () => {
      const model = assets.manifest.models[kind.model] ? kind.model : MEASURING ? 'animal_stag' : null;
      const entry = model ? (assets.manifest.models[model] as { cuts?: Record<string, [number, number]>; paces?: Record<string, number>; strikes?: Record<string, number>; floors?: Record<string, number> } | undefined) : undefined;
      if (!entry || !model) return null;
      const gltf = await assets.gltfOf(model);
      const clips = new Map<string, THREE.AnimationClip>();
      if (entry.cuts) {
        // (one long take, cut where its movements change: scripts/animals.mjs)
        const take = gltf.animations[0];
        for (const [name, [a, b]] of Object.entries(entry.cuts)) clips.set(name, THREE.AnimationUtils.subclip(take, name, Math.round(a * 30), Math.round(b * 30), 30));
      } else for (const c of gltf.animations) clips.set(c.name, c);
      return { scene: gltf.scene, clips, paces: entry.paces ?? {}, strikes: entry.strikes ?? {}, floors: entry.floors ?? {} };
    })().catch((e) => {
      console.warn(`animal ${kind.id}:`, e);
      return null;
    });
    kits.set(kind.model, k);
  }
  return k;
}

/** what each kind does, by name, for the stage's `&mode=` */
export const MODES: Record<string, number> = {
  idle: A_IDLE, graze: A_GRAZE, walk: A_WALK, trot: A_TROT, run: A_RUN, alert: A_ALERT, rest: A_REST, swipe: A_SWIPE, bite: A_BITE,
  roar: A_ROAR, hit: A_HIT, death: A_DEAD, drink: A_DRINK,
};

/**
 * One of a kind as the game draws it, for the stage (src/dev/stage.ts; onboarding, for the owner: "the stage shows
 * exactly what the game draws"): its own model and movements as `Beast` has them, the movement it plays doing `mode`
 * (or what stands in for it), lifted to that movement's floor. Its root stands on the ground, as a Beast's does.
 */
export async function stageAnimal(kindId: string, mode: number): Promise<{ root: THREE.Group; mixer: THREE.AnimationMixer; action: THREE.AnimationAction | null; clip: string } | null> {
  const kind = KINDS.find((k) => k.id === kindId);
  const kit = kind ? await kitOf(kind) : null;
  if (!kit) return null;
  const root = new THREE.Group(), model = SkeletonUtils.clone(kit.scene);
  root.add(model);
  const clip = (CLIPS[mode] ?? ['idle']).find((n) => kit.clips.has(n)) ?? '';
  const mixer = new THREE.AnimationMixer(model), action = clip ? mixer.clipAction(kit.clips.get(clip)!) : null;
  action?.play();
  model.position.y = -(kit.floors[clip] ?? 0);
  return { root, mixer, action, clip };
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
  private paces: Record<string, number> = {};
  /** where its body was last set (x, y, z, turn, pitch), and whether it was in view last frame */
  private bodyAt = [NaN, NaN, NaN, NaN, NaN];
  private wasInView = false;
  private strikes: Record<string, number> = {};
  private floors: Record<string, number> = {};
  /** how high the model is lifted off its middle, for the movement it plays (see Kit.floors): and where it is going */
  private lift = 0;
  private liftTo = 0;
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
  /** its bounds are worked out (see `bounds`) */
  private bounded = false;
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
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => this.host.atmo().register(mat));
    });
    this.model = model;
    this.paces = kit.paces;
    this.strikes = kit.strikes;
    this.floors = kit.floors;
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

  /** how far it is from the eye, metres (as of its last frame) */
  private away = 0;
  /** where it lies once it has fallen (its body's middle as drawn: its fall may carry it from where it stood), and how far round it presses the grass */
  pressAt: THREE.Vector4 | null = null;
  private deadFor = 0;

  update(dt: number, now: number, eye: THREE.Vector3, view?: THREE.Frustum) {
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
    this.away = d;
    this.root.visible = !!this.model && d < DRAWN;
    if (!this.model) return;
    // sat on the ground it stands on, nose up a slope and down one
    const w = this.host.world(), k = this.kind;
    const fx = -Math.sin(this.yaw) * k.len * 0.45, fz = -Math.cos(this.yaw) * k.len * 0.45;
    const hf = heightAt(w.heights, this.x + fx, this.z + fz), hb = heightAt(w.heights, this.x - fx, this.z - fz);
    const y = Math.min(hf, hb, heightAt(w.heights, this.x, this.z)) + 0.02;
    this.root.position.set(this.x, y, this.z);
    this.root.rotation.set(Math.atan2(hf - hb, k.len * 0.9), this.yaw, 0);
    // (its body moved only when it has moved: forty still bodies set where they were every frame were work for nothing)
    if (this.body && (Math.abs(this.x - this.bodyAt[0]) + Math.abs(y - this.bodyAt[1]) + Math.abs(this.z - this.bodyAt[2]) > 0.005 || Math.abs(this.root.rotation.y - this.bodyAt[3]) + Math.abs(this.root.rotation.x - this.bodyAt[4]) > 0.002)) {
      this.bodyAt = [this.x, y, this.z, this.root.rotation.y, this.root.rotation.x];
      this.body.setNextKinematicTranslation({ x: this.x, y, z: this.z });
      this.body.setNextKinematicRotation(TURN.setFromEuler(this.root.rotation));
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
    // (once it has lain a moment, where its body lies: the grass under it pressed flat)
    if (this.dead && !this.pressAt && (this.deadFor += dt) > 2.5) {
      const mid = new THREE.Vector3();
      for (const m of this.meshes) {
        const sk = m as THREE.SkinnedMesh;
        if (!sk.isSkinnedMesh) continue;
        sk.computeBoundingSphere();
        mid.copy(sk.boundingSphere!.center).applyMatrix4(sk.matrixWorld);
      }
      this.pressAt = new THREE.Vector4(mid.x, y, mid.z, this.kind.len * 0.75);
    }
    // (posed every frame near the eye and in view; further off, or out of view, a few times a second, and at once on
    // coming into view. Out of view is with room for its shadow, which falls into view from beside it.)
    this.poseT += dt;
    SEEN.center.set(this.x, y + this.kind.tall * 0.5, this.z);
    SEEN.radius = this.kind.len + 12;
    const inView = !view || view.intersectsSphere(SEEN), every = d < MOVED && inView ? 0 : inView ? 0.25 : 0.5;
    if (this.poseT >= every || (inView && !this.wasInView)) {
      this.mixer!.update(this.poseT);
      this.poseT = 0;
      if (!this.bounded) this.bounds();
    }
    this.wasInView = inView;
  }

  /**
   * A skinned body's bounds, worked out once it stands posed in the world (worked out before its bones were, they lay
   * somewhere else, and it was left out of the picture as out of view), and given room for its movements: worked out
   * every frame they would cost more than the body. From then it is left out of the picture only when out of view.
   */
  private bounds() {
    this.bounded = true;
    this.root.updateMatrixWorld(true);
    for (const m of this.meshes) {
      const sk = m as THREE.SkinnedMesh;
      if (!sk.isSkinnedMesh) continue;
      sk.skeleton.update();
      sk.computeBoundingSphere();
      sk.boundingSphere!.radius *= 1.6;
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
    // (lifted to the floor of what it plays, over the cross-fade: a wolf rising from its sleep rises from the ground)
    this.lift += (this.liftTo - this.lift) * Math.min(1, dt * 6);
    this.model!.position.y = this.lift;
    if (act && name !== this.playingName) {
      this.liftTo = -(this.floors[name] ?? 0);
      act.reset().play();
      // (a blow begun where its paw or jaws are as far from landing as the wind-up is long: it lands with the damage)
      const move = this.kind.fight?.moves.find((m) => m.mode === this.mode), hit = this.strikes[name];
      if (move && hit !== undefined) act.time = Math.max(0, hit - move.windup);
      const sound = SOUNDS[this.kind.id]?.[CLIPS[this.mode]?.[0] ?? name], at = performance.now();
      if (sound && this.away < sound[1] && at - (saidAt.get(sound[0]) ?? -Infinity) > (GAP[sound[0]] ?? 0)) {
        saidAt.set(sound[0], at);
        this.host.heard(sound[0], this.root.position);
      }
      if (this.playing) act.crossFadeFrom(this.playing, ONCE.has(name) ? 0.12 : 0.3, false);
      this.playing = act;
      this.playingName = name;
    }
    // (a gait played as fast as the animal is going, beside the pace its feet go over the ground at in the clip: so
    // they stay where they are put down)
    if (act && (name === 'walk' || name === 'trot' || name === 'run')) {
      const pace = this.paces[name] ?? (name === 'walk' ? this.kind.walk : name === 'trot' ? this.kind.trot : this.kind.run);
      act.timeScale = THREE.MathUtils.clamp(this.speed / pace, 0.4, 2);
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
  /** the herds being stood, a little at a time */
  private standing: Herd | null = null;
  private stepT = 0;
  /** playing alone: when the last of the herds' calls was heard */
  private calledAt = 0;
  /** the canyon's rock the game has stood (main.ts hands it over): solid to the herds played alone, as to the server's */
  rocks: RockPiece[] = [];

  constructor(private host: WildHost) {}

  /** Playing alone: the herds are stood a moment after the world is up (they take most of a second), away from the player. */
  alone() {
    this.clear();
    const world = this.host.world();
    // (a few milliseconds a frame, a herd's ground at a time: all at once it was most of a second)
    const boxOf = (kind: string) => (assets.manifest.models[kind] as { min?: number[]; max?: number[] } | undefined)?.min ? (assets.manifest.models[kind] as unknown as { min: number[]; max: number[] }) : null;
    const herd = new Herd(animalGround(world, { rocks: this.rocks, boxOf }), (k) => MEASURING || !!assets.manifest.models[k.model], () => this.host.hour());
    const me = this.host.me(), steps = herd.populating(Date.now(), me ? [me] : []);
    this.standing = herd;
    const more = () => {
      if (this.standing !== herd) return;
      const until = performance.now() + 4;
      while (performance.now() < until) if (steps.next().done) return void ((this.herd = herd), (this.standing = null));
      window.setTimeout(more, 16);
    };
    window.setTimeout(more, 1500);
  }

  /** gone online: the server keeps them from here */
  leaveAlone() {
    this.herd = null;
    this.standing = null;
    this.clear();
  }

  /** Playing alone, five times a second: the herds think, their blows land, and this game is told of them as a server would tell it. */
  tickAlone(dt: number) {
    if (!this.herd || out() || (this.stepT -= dt) > 0) return;
    this.stepT = ANIMALS.step;
    const me = this.host.me(), now = Date.now();
    if (me) me.sheltered = this.herd.ground.roofed(me.x, me.z);
    const turn = this.herd.tick(now, me ? [me] : []);
    for (const s of turn.strikes) {
      const b = this.herd.beasts.get(s.i);
      if (b) this.host.struck(s, KINDS[b.k]);
    }
    // (what the server would tell this player of them: within its carry, and no two of the herds' calls close together)
    for (const k of turn.calls) {
      const reach = k.call === 'bark' ? CALLS.bark.heard : CALLS[k.call].heard;
      if (!me || Math.hypot(me.x - k.x, me.z - k.z) > reach) continue;
      const says = k.call === 'bark' || !!k.tell;
      if (!says && now - this.calledAt < CALLS.apart * 1000) continue;
      if (!says) this.calledAt = now;
      this.call(k.call, k.x, k.z);
    }
    const at = me ?? { x: 0, z: 0 };
    this.rows(this.herd.rows(at.x, at.z, ANIMALS.told), true, performance.now());
  }

  /** a call heard (online, the server's 'acall'): from where it was, at the height of the ground there */
  call(name: Call, x: number, z: number) {
    const w = this.host.world();
    this.host.heard(name, new THREE.Vector3(x, heightAt(w.heights, x, z) + 1.2, z));
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

  /** what the camera sees, worked out once a frame for all of them */
  private view = new THREE.Frustum();
  private viewing = new THREE.Matrix4();

  update(dt: number, now: number, eye: THREE.Vector3, camera?: THREE.Camera) {
    if (out()) {
      for (const b of this.beasts.values()) b.root.visible = false;
      return;
    }
    if (camera) this.view.setFromProjectionMatrix(this.viewing.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const b of this.beasts.values()) b.update(dt, now, eye, camera ? this.view : undefined);
    // (the grass pressed flat under the four dead nearest the eye)
    const far = (b: Beast) => (b.pressAt!.x - eye.x) ** 2 + (b.pressAt!.z - eye.z) ** 2;
    const lying = [...this.beasts.values()].filter((b) => b.pressAt && !b.gone).sort((a, b) => far(a) - far(b));
    grassUniforms.uPressed.value.forEach((v, k) => (lying[k] ? v.copy(lying[k].pressAt!) : v.set(0, -1000, 0, 0)));
  }

  /** everything gone (a new connection, or leaving the server) */
  clear() {
    for (const [i, b] of this.beasts) this.drop(i, b);
  }
}
