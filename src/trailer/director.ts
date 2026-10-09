// The trailer's director. Loaded only by trailer.html, after trailer/clock.js has put the
// page on a virtual clock. It stages an offline match (the game's own single-player world,
// plus bodies that stand in for other players), plays the shot list in shots.ts one frame
// at a time when scripts/film.mjs asks, logs every sound the game would have played, and
// at the end renders the soundtrack and encodes picture and sound into an MP4.
//
// Nothing here is part of the game: it is never imported by src/main.ts.

import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { assets } from '../core/assets';
import { audio, AudioEngine, recordings } from '../core/audio';
import { physics, SHOT_GROUPS } from '../core/physics';
import { RemotePlayer } from '../game/remote';
import { heightAt } from '../world/worldgen';
import { wind } from '../world/foliage';
import { makeItem, type ItemInstance } from '../sim/items';
import { EMOTE } from '../sim/emotes';
import { WEAPON_RULES } from '../sim/combat';
import { F_DANCE, F_SURRENDER } from '../net/protocol';
import { setPlayerName } from '../net/client';
import { SECONDS } from './shots';
import { scoreMusic, type Arrangement } from './music';
import './trailer.css';

type Any = Record<string, any>;
interface Clock {
  real: { setTimeout: (fn: () => void, ms?: number) => number; now: () => number };
  now: number;
  reseed(n: number): void;
  sync(): void;
  advance(ms: number): void;
}
const clock = (window as unknown as { __clock: Clock }).__clock;
const realSleep = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));

export interface CamPose {
  p: THREE.Vector3;
  l: THREE.Vector3;
  fov?: number;
  roll?: number;
}
export interface Title {
  at: number;
  until: number;
  text: string;
  /** big (default), small, stat, soon, end */
  cls?: string;
}
export interface Shot {
  name: string;
  start: number;
  end: number;
  /** puts the game in the state the shot needs */
  setup?: (S: Stage) => void | Promise<void>;
  cues?: { at: number; fn: (S: Stage) => void | Promise<void>; done?: boolean }[];
  /** before the game moves, every frame (t = seconds into the shot, dt = seconds of game time this frame) */
  tick?: (t: number, S: Stage, dt: number) => void;
  /** after the game has moved, before the picture is taken */
  after?: (t: number, S: Stage) => void;
  /** how fast the game's clock runs (1 = real time) */
  rate?: (t: number, S: Stage) => number;
  /** a free camera; leave out for the game's own first-person view */
  cam?: (t: number, S: Stage) => CamPose | null;
  /** the game's own HUD on screen */
  hud?: boolean;
  /** carries on from the shot before it: its people, its place (a take that starts here is replayed from where the run of shots begins) */
  chain?: boolean;
  /** which throw of the film's dice it starts from, when that is not its place in this cut: a shot borrowed from another cut plays as it did there */
  seed?: number;
  /** letterbox bars (on by default for free cameras) */
  bars?: boolean;
  titles?: Title[];
}

const F_CROUCH = 1, F_SPRINT = 2, F_AIM = 4, F_GROUND = 8, F_BLEED = 32;
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** A body standing in for another player: the game's own RemotePlayer, fed poses by the director instead of a server. */
export class Actor {
  rp: RemotePlayer;
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouch = false;
  aim = false;
  sprint = false;
  bleeding = false;
  alive = true;
  hp = 100;
  weapon: string | null = null;
  /** simple fighting brain: who it shoots at, how often, and how well */
  foe: Actor | null = null;
  nextShot = 0;
  skill = 0.5;
  /** called when it goes down */
  onDeath: (() => void) | null = null;
  /** what the body keeps up, as a player sets it from the wheel: told in the pose, as it is to a server */
  dance = false;
  surrender = false;
  private corpse: string | null = null;
  /** a clip from trailer/emotes.glb laid over whatever the game is playing on this body */
  private emoting: { act: THREE.AnimationAction; dur: number; t0: number; loop: boolean; speed: number; phase: number } | null = null;

  /**
   * Dance, talk with the hands, point: movements the game does not have yet, for the scenes
   * that say what is coming. Null goes back to the game's own animation.
   */
  emote(name: string | null, o: { loop?: boolean; speed?: number; phase?: number } = {}) {
    if (this.emoting) {
      this.emoting.act.stop();
      this.emoting = null;
    }
    const clip = name ? this.S.emotes.get(name) : null;
    if (!clip) return this;
    const act = ((this.rp.avatar as unknown as Any).mixer as THREE.AnimationMixer).clipAction(clip);
    act.reset().play();
    // the game sets its own clips' weights (they add up to one) every frame: this one outweighs them
    act.setEffectiveWeight(80);
    this.emoting = { act, dur: clip.duration, t0: performance.now(), loop: o.loop ?? true, speed: o.speed ?? 1, phase: o.phase ?? 0 };
    return this;
  }

  constructor(private S: Stage, public id: number, public name: string) {
    this.rp = new RemotePlayer(id, name, S.g.makeHeld);
  }
  /**
   * Calls something out, as a player does from the wheel (src/sim/emotes.ts): the game's own
   * voice from where the head is, the arms that go with it, and the words over the head.
   */
  call(id: string) {
    const e = EMOTE[id];
    if (!e?.say || !this.alive) return;
    this.aim = false;
    this.rp.call(e, this.S.g.s.r.camera.position);
    this.S.g.said.set(this.id, { text: e.say, at: performance.now() });
  }
  async load() {
    await this.rp.load(this.S.g.s.atmo, this.S.g.s.r.scene, [0, -200, 0, 0, 0, F_GROUND]);
    this.S.g.remotes.set(this.id, this.rp);
  }
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 1.02 : 1.64), this.pos.z); }
  chest() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 0.72 : 1.25), this.pos.z); }
  head() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 1.03 : 1.62), this.pos.z); }
  /** stand it somewhere, alive and clean, with nothing carried over from the last shot */
  place(x: number, z: number, yaw = 0, weapon: string | null = null, gear: string[] = []) {
    const S = this.S;
    if (this.corpse) {
      S.g.removeCorpse(this.corpse);
      this.corpse = null;
    }
    this.pos.set(x, S.ground(x, z), z);
    this.yaw = yaw;
    this.pitch = 0;
    this.crouch = this.aim = this.sprint = this.bleeding = this.dance = this.surrender = false;
    this.alive = true;
    this.hp = 100;
    this.foe = null;
    this.onDeath = null;
    this.emote(null);
    this.weapon = weapon;
    const rp = this.rp as unknown as Any;
    rp.snaps.length = 0;
    rp.vel.set(0, 0, 0);
    rp.flinch = 0;
    rp.dripT = 0;
    this.rp.pos.copy(this.pos);
    this.rp.setAlive(true);
    this.rp.avatar.root.visible = true;
    this.rp.avatar.act(null);
    this.rp.setWeapon(weapon, []);
    void S.g.wear(this.rp.avatar, gear);
    // every body starts its stride and its breathing from a fixed place, so a take repeats
    const av = this.rp.avatar as unknown as Any;
    av.phase = S.rnd();
    av.clock = S.rnd() * 10;
    this.push(-200);
    this.push(0);
    return this;
  }
  /** away from the set */
  hide() {
    this.place(0, 0, 0);
    this.pos.y = -300;
    this.push(-200);
    this.push(0);
  }
  face(at: THREE.Vector3) {
    const e = this.eye();
    this.yaw = Math.atan2(-(at.x - e.x), -(at.z - e.z));
    this.pitch = Math.atan2(at.y - e.y, Math.hypot(at.x - e.x, at.z - e.z));
  }
  /** walk toward a point at a speed (m/s); returns true once there */
  go(x: number, z: number, speed: number, dt: number, turn = true) {
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, speed * dt);
    if (d > 1e-3) {
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      if (turn) this.yaw = Math.atan2(-dx, -dz);
    }
    this.pos.y = this.S.ground(this.pos.x, this.pos.z);
    this.sprint = speed > 5;
    return d < 0.05;
  }
  push(ago = 0) {
    const e = this.emoting;
    if (e) {
      const t = ((performance.now() - e.t0) / 1000) * e.speed + e.phase * e.dur;
      e.act.time = e.loop ? t % e.dur : Math.min(e.dur - 1e-3, t);
    }
    const f = (this.crouch ? F_CROUCH : 0) | (this.sprint ? F_SPRINT : 0) | (this.aim ? F_AIM : 0) | F_GROUND | (this.bleeding ? F_BLEED : 0) | (this.dance ? F_DANCE : 0) | (this.surrender ? F_SURRENDER : 0);
    this.rp.push([this.pos.x, this.pos.y, this.pos.z, this.yaw, this.pitch, f], performance.now() + ago);
  }
  /** a shot at a point, off by up to `err` radians: a real bullet in the game's world, with everything that follows from it */
  fireAt(at: THREE.Vector3, err = 0) {
    if (!this.alive || !this.weapon) return;
    const o = this.eye();
    const dir = at.clone().sub(o).normalize();
    dir.x += (this.S.rnd() - 0.5) * err;
    dir.y += (this.S.rnd() - 0.5) * err * 0.6;
    dir.z += (this.S.rnd() - 0.5) * err;
    this.S.g.weapons.remoteShot(o, dir.normalize(), this.weapon, false);
    if (this.weapon === 'mosin') {
      // then the bolt, as a player would
      setTimeout(() => {
        if (!this.alive) return;
        this.rp.avatar.act('bolt', 0.78);
        audio.boltCycle(0, this.pos.clone() as never);
      }, 300);
    }
  }
  /** the fighting brain: face the foe, shoot when the weapon allows, miss about as often as people do */
  think(t: number) {
    const foe = this.foe;
    if (!this.alive || !foe) return;
    this.aim = true;
    this.face(foe.alive ? foe.chest() : foe.pos.clone().setY(foe.pos.y + 0.3));
    if (!foe.alive || t < this.nextShot) return;
    const rifle = this.weapon === 'mosin';
    this.nextShot = t + (rifle ? 1.5 + this.S.rnd() * 0.5 : 0.32 + this.S.rnd() * 0.45);
    const hit = this.S.rnd() < this.skill;
    this.fireAt(foe.chest(), hit ? 0.012 : 0.09);
  }
  /** something landed on it */
  hurt(amount: number, dir: THREE.Vector3, head = false) {
    if (!this.alive) return;
    this.hp -= head ? 200 : amount;
    this.bleeding = true;
    const rp = this.rp as unknown as Any;
    // the game has already flinched it if the hit was the local player's own
    if (rp.flinch < 0.9) this.rp.damage(amount, head ? this.head() : this.chest(), dir, head ? 'head' : 'torso');
    if (this.hp <= 0) this.die(dir);
  }
  die(dir = new THREE.Vector3(0, 0, 1)) {
    if (!this.alive) return;
    this.alive = false;
    const along = dir.x * -Math.sin(this.yaw) + dir.z * -Math.cos(this.yaw);
    const v = along > 0.4 ? 1 : along < -0.4 ? 0 : 2;
    this.rp.avatar.setDeath(v);
    this.rp.setAlive(false);
    this.corpse = `corpse_tr_${this.id}_${Math.round(performance.now())}`;
    void this.S.g.addCorpse({ uid: this.corpse, x: this.pos.x, y: this.pos.y, z: this.pos.z, rot: this.yaw, name: this.name, v });
    this.onDeath?.();
  }
  get corpseId() { return this.corpse; }
}

/** Everything a shot can reach for. */
export class Stage {
  g!: Any;
  actors: Actor[] = [];
  cam: CamPose | null = null;
  /** the game's world, for placing things */
  world!: Any;
  bullet!: THREE.Group;
  trail!: THREE.Mesh;
  /** a shot's setup can run the clock on unseen (smoke building, a body settling): what the game plays meanwhile is not for the soundtrack */
  mute = false;
  /** clips for Actor.emote, by name (empty when trailer/emotes.glb has not been built) */
  emotes = new Map<string, THREE.AnimationClip>();

  private seed = 1;
  /** start the film's own dice again from a known place */
  reseed(n: number) {
    this.seed = n | 0;
  }
  /**
   * The film's own dice, kept apart from Math.random: the game throws those for its own
   * reasons (particles, loot restocking), and how many it has thrown by a given frame is
   * not something a shot should depend on.
   */
  rnd() {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let x = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }
  v(x: number, y: number, z: number) { return new THREE.Vector3(x, y, z); }
  ground(x: number, z: number) { return heightAt(this.world.heights, x, z); }
  /** a point at ground level plus a height */
  at(x: number, z: number, up = 0) { return new THREE.Vector3(x, this.ground(x, z) + up, z); }
  clearLine(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a), len = d.length();
    return !physics.raycast(a, d.normalize(), len - 0.3, SHOT_GROUPS);
  }
  /** the local player: where they stand and which way they look (first person) */
  me(x: number, z: number, yaw: number, pitch = 0, y?: number) {
    const p = this.g.player;
    p.spawn(x, (y ?? this.ground(x, z)) + 0.05, z, yaw);
    p.pitch = pitch;
    p.vitals.health = 100;
    p.vitals.energy = 80;
    p.vitals.water = 80;
    p.vitals.stamina = 300;
    p.vitals.bleeding = false;
    if (p.crouched) p.setCrouch(false);
    this.g.avatar.clearWounds();
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2', 'AltLeft']) this.g.input.simulate(k, false);
  }
  /** out of every picture */
  parkMe() {
    this.me(-380, -380, 0);
  }
  key(code: string, down: boolean) { this.g.input.simulate(code, down); }
  /** press and let go */
  tap(code: string, ms = 70) {
    this.g.input.simulate(code, true);
    setTimeout(() => this.g.input.simulate(code, false), ms);
  }
  /** turn the first-person view toward a world point (all at once: ease it yourself in tick) */
  aimAt(at: THREE.Vector3) {
    const c = this.g.s.r.camera.position;
    this.g.player.yaw = Math.atan2(-(at.x - c.x), -(at.z - c.z));
    this.g.player.pitch = Math.atan2(at.y - c.y, Math.hypot(at.x - c.x, at.z - c.z));
  }
  /** empty the pockets and hands, then carry exactly these (weapons loaded) */
  kit(ids: (string | [string, number])[], mods: Record<string, string[]> = {}) {
    const g = this.g;
    g.inv.clear();
    g.quick = [null, null, null, null];
    for (const e of ids) {
      const [id, qty] = Array.isArray(e) ? e : [e, undefined];
      const it = makeItem(id, qty) as ItemInstance;
      if (mods[id]) it.mods = mods[id];
      if (it.loaded !== undefined || id === 'mosin' || id === 'p38') it.loaded = id === 'mosin' ? 5 : 8;
      g.inv.add(it);
    }
    g.inventoryChanged();
  }
  /** what is in the hands, at once (no put-away animation left over from the last shot) */
  hold(slot: string | null, rise = false) {
    const w = this.g.weapons;
    w.action = null;
    this.g.inv.active = slot;
    w.validate();
    w.boltReady = true;
    w.chamberEmpty = false;
    if (slot && rise) w.start('equip', 0.45);
  }
  /** scrub the set: blood, holes, loose particles, bullets in the air */
  clean() {
    const fx = this.g.effects;
    fx.blood.count = 0;
    fx.bloodIdx = 0;
    for (const d of fx.decals.values()) {
      d.mesh.count = 0;
      d.idx = 0;
    }
    for (const p of fx.particles) p.alive = false;
    this.g.weapons.bullets.length = 0;
    this.bullet.visible = this.trail.visible = false;
  }
  actor(i: number) { return this.actors[i]; }
  /** the local player's own grenade in the air or on the ground, if there is one */
  myNade(): { pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; resting: boolean } | null {
    return this.g.grenades.list.find((n: Any) => n.mine) ?? null;
  }
  /** a line in the kill feed, worded as the game words it */
  feedKill(by: string, name: string, weapon: string, dist = 0, mine = true) {
    this.g.hud.feed(`${by} killed ${name} · ${weapon}${dist > 3 ? ` · ${Math.round(dist)} m` : ''}`, mine);
  }
  /** the local player's own bullet in flight, if there is one */
  myBullet(): { pos: THREE.Vector3; vel: THREE.Vector3; travelled: number } | null {
    return this.g.weapons.bullets.find((b: Any) => !b.ghost) ?? null;
  }
}

// ------------------------------------------------------------------------------------------ runtime

const S = new Stage();
/** which trailer: trailer.html?cut=2 is the second one (shots2.ts), ?cut=3 the third (shots3.ts); anything else the first */
const CUT = Number(new URLSearchParams(location.search).get('cut')) || 1;
let arrangement: Arrangement | undefined;
/** how long this cut runs, and (for a cut that brings its own) its score */
let seconds = SECONDS;
let ownScore: ((ctx: BaseAudioContext, out: AudioNode) => void) | undefined;
let shots: Shot[] = [];
let current: Shot | null = null;
let fps = 60;
let frameIndex = 0;
let logging = false;
const soundLog: { t: number; n: string; a: unknown[] }[] = [];
const overlay = document.getElementById('tr-overlay')!;
const titleEls = new Map<Title, HTMLElement>();

// S: the stage, for scripts that pose a single picture (scripts/stills.mjs)
const tr: Any = { ready: false, failed: '', S };
(window as unknown as Any).tr = tr;

/** While the game boots and the set is dressed nobody is filming: time simply runs. */
let pumping = true;
(function pump() {
  if (!pumping) return;
  clock.advance(1000 / 60);
  clock.real.setTimeout(pump, 0);
})();

/** Every sound the game asks for is written down instead of played; the soundtrack is rendered from the list afterwards. */
function hookAudio() {
  const plain = (v: unknown): unknown => (v && typeof v === 'object' && 'x' in (v as Any) ? { x: (v as Any).x, y: (v as Any).y, z: (v as Any).z } : v);
  const names = ['gunshot', 'dryFire', 'click', 'boltCycle', 'reloadNear', 'roundInsert', 'magOut', 'magIn', 'slideRack', 'shellDrop', 'whiz', 'hitTick', 'equip', 'jump', 'land', 'death', 'body', 'door', 'impact', 'footstep', 'whoosh', 'explosion', 'ui', 'hurt', 'shout', 'infected', 'setListener', 'updateAmbience'];
  for (const n of names) {
    (audio as unknown as Any)[n] = (...a: unknown[]) => {
      if (logging && !S.mute) soundLog.push({ t: frameIndex / fps, n, a: a.map(plain) });
    };
  }
}

async function stage() {
  for (let i = 0; i < 2400 && !(window as unknown as Any).__game; i++) await realSleep(100);
  const g = (S.g = (window as unknown as Any).__game);
  if (!g) throw new Error('the game never came up');
  S.world = g.s.world;
  hookAudio();
  // a page with no window has no mouse to capture: the game is told it has one
  g.input.locked = true;
  g.input.lock = () => {};
  g.input.unlock = () => {};
  // (the third cut's hero has a name, and the voice that goes with it)
  if (CUT === 3 || CUT === 4) setPlayerName('Sable');
  // the world: the game's own single-player one, from the same seed every take
  clock.reseed(7001);
  await g.enterOffline();
  g.started = true;
  g.paused = false;
  g.joining = false;
  g.hud.showStart(false);
  g.director.t = 1;
  g.entryModal = () => {};
  // the game's own hint about a slow frame rate measures a clock that is not running at real speed here
  g.slowHinted = true;
  document.getElementById('loading')?.classList.add('done');
  // supply drops come when the film asks for one, not when the game's own clock says
  g.nextDrop = 1e12;
  // The infected are in one film only (the fifth, which stands its own: see shots5.ts). The
  // others were made before there were any, and are played as they were made.
  if (CUT !== 5) {
    g.horde.clear();
    g.horde.director = null;
  }
  // a grenade's blast reaches the stand-in players as it would real ones: the game draws it, this keeps the score
  const explode = g.explode.bind(g);
  g.grenades.onExplode = (at: THREE.Vector3, mine: boolean) => {
    explode(at, mine);
    for (const a of S.actors) {
      if (!a.alive) continue;
      const chest = a.chest(), d = chest.distanceTo(at);
      if (d > 9 || !S.clearLine(at, chest)) continue;
      a.hurt(150 * Math.pow(1 - d / 9, 1.3), chest.clone().sub(at).normalize());
    }
  };
  // a fuel drum going up reaches them too (the game draws it and throws the blood: this keeps the score)
  const boom = g.explode.bind(g);
  g.explode = (at: THREE.Vector3, mine: boolean, what?: string, skip?: unknown) => {
    boom(at, mine, what, skip);
    if (what !== 'barrel') return;
    const rule = WEAPON_RULES.barrel;
    for (const a of S.actors) {
      if (!a.alive) continue;
      const chest = a.chest(), d = chest.distanceTo(at);
      if (d > rule.blast! || !S.clearLine(at.clone().setY(at.y + 0.5), chest)) continue;
      a.hurt(rule.damage * Math.pow(1 - d / rule.blast!, 1.3), chest.clone().sub(at).normalize());
    }
  };
  // the training dummies are not in this film
  for (const d of g.dummies) {
    d.avatar.root.visible = false;
    for (const c of d.colliders) c.setEnabled(false);
  }
  g.dummies.length = 0;

  // a camera of the director's own, laid over the game's
  const dir = g.director;
  const update = dir.update.bind(dir);
  dir.update = (dt: number) => {
    update(dt);
    const c = S.cam;
    if (!c) return;
    const cam = g.s.r.camera as THREE.PerspectiveCamera;
    cam.position.copy(c.p);
    cam.up.set(0, 1, 0);
    cam.lookAt(c.l);
    if (c.roll) cam.rotateZ(c.roll);
    cam.fov = c.fov ?? 50;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  };
  Object.defineProperty(dir, 'viewmodelVisible', { get: () => !S.cam && dir.blend > 0.92 });
  Object.defineProperty(dir, 'avatarVisible', { get: () => !!S.cam || dir.blend < 0.8 });

  // hits on the stand-in players count: the game draws the blood, this keeps the score
  const flesh = g.weapons.onFlesh;
  g.weapons.onFlesh = (owner: unknown, pt: THREE.Vector3, d: THREE.Vector3, power: number) => {
    flesh(owner, pt, d, power);
    const a = S.actors.find((x) => x.rp === owner);
    if (a) a.hurt(power >= 1 ? 95 : power > 0.58 ? 34 : power > 0.4 ? 50 : 14, d, pt.y - a.pos.y > (a.crouch ? 0.92 : 1.5));
  };

  // movements for the "coming soon" scenes (npm run character -- --emotes)
  if (CUT === 2) {
    try {
      const em = await assets.gltf.loadAsync('/trailer/emotes.glb');
      for (const clip of em.animations) S.emotes.set(clip.name, clip);
    } catch {
      console.log('[tr] trailer/emotes.glb is missing: run "npm run character -- --emotes"');
    }
  }

  // the cast
  // (the fourth cut borrows shots from the second, which counts on its six in their order, and has one more behind them)
  const names = CUT === 3 ? ['Sable', 'Mira', 'Volkov', 'Kestrel', 'Dmitri', 'Oksana', 'Bear'] : CUT === 4 ? ['Volkov', 'Mira', 'Kestrel', 'Dmitri', 'Oksana', 'Bear', 'Sable'] : ['Volkov', 'Mira', 'Kestrel', 'Dmitri', 'Oksana', 'Bear'];
  for (let i = 0; i < names.length; i++) {
    const a = new Actor(S, 900 + i, names[i]);
    await a.load();
    a.hide();
    S.actors.push(a);
  }

  // a bullet you can see, for the one shot that follows it (the game's own bullets are not drawn)
  S.bullet = new THREE.Group();
  const brass = new THREE.MeshBasicMaterial({ color: 0xd9a35a });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0039, 0.0039, 0.02, 10), brass);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.0039, 0.012, 10), brass);
  body.rotation.x = nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.016;
  S.bullet.add(body, nose);
  S.bullet.scale.setScalar(3.2);
  S.trail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0005, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  S.trail.geometry.rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  S.bullet.visible = S.trail.visible = false;
  g.s.r.scene.add(S.bullet, S.trail);

  if (CUT === 5) {
    const cut = await import('./shots5');
    shots = cut.buildShots(S);
    arrangement = cut.ARRANGEMENT;
    seconds = cut.SECONDS5;
  } else if (CUT === 4) {
    const cut = await import('./shots4');
    shots = cut.buildShots(S);
    arrangement = cut.ARRANGEMENT;
    seconds = cut.SECONDS4;
  } else if (CUT === 3) {
    const cut = await import('./shots3');
    shots = cut.buildShots(S);
    seconds = cut.SECONDS3;
    ownScore = cut.score;
  } else if (CUT === 2) {
    const cut = await import('./shots2');
    shots = cut.buildShots(S);
    arrangement = cut.ARRANGEMENT;
  } else shots = (await import('./shots')).buildShots(S);
  // let everything that was asked for arrive (models, the cast's clothes), then stop the clock
  for (let i = 0; i < 40; i++) await realSleep(50);
  pumping = false;
  tr.ready = true;
}

function showTitles(shot: Shot, t: number) {
  for (const ti of shot.titles ?? []) {
    let el = titleEls.get(ti);
    const on = t >= ti.at && t < ti.until;
    if (!on) {
      if (el) el.style.display = 'none';
      continue;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = `tr-title ${ti.cls ?? 'big'}`;
      el.innerHTML = ti.text;
      overlay.appendChild(el);
      titleEls.set(ti, el);
    }
    // slammed in, held, cut out
    const a = ease((t - ti.at) / 0.14), b = ease((ti.until - t) / 0.1);
    el.style.display = '';
    el.style.opacity = String(Math.min(a, b));
    el.style.setProperty('--k', String(1 + (1 - a) * 0.35 + (t - ti.at) * 0.012));
  }
}

async function enter(shot: Shot) {
  if (current) for (const ti of current.titles ?? []) titleEls.get(ti)?.remove();
  current = shot;
  overlay.querySelectorAll('.tr-cursor').forEach((e) => ((e as HTMLElement).style.display = 'none'));
  const dice = shot.seed ?? shots.indexOf(shot);
  clock.reseed(9000 + dice * 131);
  if (!shot.chain) S.reseed(5000 + dice * 977);
  // the world's slow housekeeping (restocking loot, saving) has no part in a film
  S.g.econT = -1e9;
  S.g.saveT = -1e9;
  wind.uTime.value = 40 + dice * 7;
  if (!shot.chain) {
    // clocks the game keeps for itself (the sway of the weapon, the local body's breathing, whose turn it
    // is among the shadow maps) start each run of shots from the same place
    S.g.weapons.time = 0;
    S.g.avatar.clock = 3;
    S.g.avatar.phase = 0.25;
    S.g.s.atmo.frame = 0;
  }
  for (const c of shot.cues ?? []) c.done = false;
  S.cam = null;
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2']) S.g.input.simulate(k, false);
  if (S.g.invUI.isOpen) S.g.toggleInventory(false);
  await shot.setup?.(S);
  document.body.classList.toggle('tr-hud-off', !shot.hud);
  document.body.classList.toggle('tr-bars', shot.bars ?? !!shot.cam);
  // a few frames nobody sees, so the first one filmed is fully dressed
  const was = logging;
  logging = false;
  for (let i = 0; i < 24; i++) {
    if (shot.cam) S.cam = shot.cam(0, S);
    for (const a of S.actors) a.push();
    clock.advance(1000 / 60);
    if (i % 6 === 5) await settle();
  }
  logging = was;
}

/** real time: let promises, fetches and decoding that the last frame started come home */
async function settle() {
  await realSleep(0);
  await realSleep(0);
}

async function step(i: number) {
  frameIndex = i;
  const T = i / fps;
  const shot = shots.find((s) => T >= s.start && T < s.end) ?? shots[shots.length - 1];
  if (shot !== current) await enter(shot);
  const t = T - shot.start;
  for (const cue of shot.cues ?? []) {
    if (!cue.done && cue.at <= t) {
      cue.done = true;
      await cue.fn(S);
    }
  }
  const rate = shot.rate?.(t, S) ?? 1;
  const dt = rate / fps;
  shot.tick?.(t, S, dt);
  for (const a of S.actors) a.push();
  if (shot.cam) S.cam = shot.cam(t, S);
  clock.advance(1000 * dt);
  shot.after?.(t, S);
  showTitles(shot, t);
  await settle();
  clock.sync();
}

// ------------------------------------------------------------------------------------------ film script interface

let muxer: Muxer<ArrayBufferTarget> | null = null;
let venc: VideoEncoder | null = null;
let take = { first: 0, last: 0, width: 1920, height: 1080 };
let pieces: string[] = [];

tr.info = () => {
  const gl = S.g.s.r.renderer.getContext() as WebGLRenderingContext;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', seconds, shots: shots.map((s) => [s.name, s.start, s.end]) };
};

tr.begin = async (o: { fps: number; first: number; last: number; width: number; height: number; video: boolean }) => {
  fps = o.fps;
  take = o;
  soundLog.length = 0;
  current = null;
  pieces = [];
  muxer = null;
  venc = null;
  if (o.video) {
    muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: o.width, height: o.height, frameRate: fps }, audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 }, fastStart: 'in-memory' });
    venc = new VideoEncoder({ output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta), error: (e) => console.error('[tr] video encoder', e.message) });
    venc.configure({ codec: 'avc1.64002A', width: o.width, height: o.height, bitrate: o.width >= 1900 ? 14_000_000 : 5_000_000, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });
  }
  // a stretch from the middle: replay its shot from the top, unseen, so it arrives in the right state
  const T = o.first / fps;
  let k = Math.max(0, shots.findIndex((s) => T >= s.start && T < s.end));
  while (k > 0 && shots[k].chain) k--;
  logging = false;
  for (let i = Math.round(shots[k].start * fps); i < o.first; i++) await step(i);
  logging = true;
};

tr.step = step;

tr.encodeFrame = async (b64: string, k: number) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
  const frame = new VideoFrame(bmp, { timestamp: Math.round((k * 1e6) / fps), duration: Math.round(1e6 / fps) });
  venc!.encode(frame, { keyFrame: k % (fps * 2) === 0 });
  frame.close();
  bmp.close();
  while (venc!.encodeQueueSize > 4) await realSleep(4);
};

/** The whole soundtrack in one go: the score, and every sound the game asked for at the moment it asked. */
async function renderSound(): Promise<AudioBuffer> {
  const SR = 48000;
  // (the shots, the bolt and the magazines are recordings now: they have to be here before any of them is asked for)
  await recordings();
  const off = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const Real = window.AudioContext;
  (window as unknown as Any).AudioContext = function () { return off; };
  const eng = new AudioEngine() as unknown as Any;
  try { eng.start(); } finally { (window as unknown as Any).AudioContext = Real; }
  eng.master.gain.value = 0.62;
  if (ownScore) ownScore(off, off.destination);
  else scoreMusic(off, off.destination, arrangement);
  const groups = new Map<number, typeof soundLog>();
  for (const ev of soundLog) {
    const q = Math.round((ev.t * SR) / 128);
    (groups.get(q) ?? groups.set(q, []).get(q)!).push(ev);
  }
  const play = (evs: typeof soundLog) => {
    for (const ev of evs) {
      try { eng[ev.n](...ev.a); } catch (e) { console.error('[tr] sound', ev.n, (e as Error).message); }
    }
  };
  for (const [q, evs] of groups) {
    if (q <= 0) play(evs);
    else if ((q * 128) / SR < seconds - 0.01) void off.suspend((q * 128) / SR).then(() => { play(evs); void off.resume(); });
  }
  const buf = await off.startRendering();
  let peak = 0, sum = 0;
  {
    const d0 = buf.getChannelData(0);
    for (let i = 0; i < d0.length; i++) {
      peak = Math.max(peak, Math.abs(d0[i]));
      sum += d0[i] * d0[i];
    }
  }
  console.log('[tr] soundtrack before the ceiling: peak ' + (20 * Math.log10(peak + 1e-9)).toFixed(1) + ' dB, rms ' + (20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9)).toFixed(1) + ' dB, ' + soundLog.length + ' logged calls');
  // a soft ceiling: the loudest moments lean into it instead of clipping
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * 1.15) * 0.97;
  }
  return buf;
}

tr.finish = async () => {
  await venc!.flush();
  const buf = await renderSound();
  const SR = 48000;
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer!.addAudioChunk(chunk, meta), error: (e) => console.error('[tr] audio encoder', e.message) });
  aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192_000 });
  const a = Math.round((take.first / fps) * SR), b = Math.min(buf.length, Math.round((take.last / fps) * SR));
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = a; i < b; i += 4800) {
    const n = Math.min(4800, b - i);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0);
    data.set(R.subarray(i, i + n), n);
    aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(((i - a) * 1e6) / SR), data }));
    while (aenc.encodeQueueSize > 8) await realSleep(2);
  }
  await aenc.flush();
  muxer!.finalize();
  const bytes = new Uint8Array(muxer!.target.buffer);
  const CH = 3 * 1024 * 1024;
  for (let i = 0; i < bytes.length; i += CH) {
    let s = '';
    const part = bytes.subarray(i, i + CH);
    for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode(...part.subarray(j, j + 0x8000));
    pieces.push(btoa(s));
  }
  return pieces.length;
};
tr.piece = (k: number) => pieces[k];
tr.soundLog = () => soundLog.filter((e) => e.n !== 'setListener' && e.n !== 'updateAmbience' && e.n !== 'body');

stage().catch((e) => {
  console.error('[tr] staging failed', e);
  tr.failed = String(e?.message ?? e);
});
