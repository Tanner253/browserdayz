// Every jeep in this game, and the one the player is sitting in: getting in and out, the
// view from behind it, who it runs over, what it sounds like, how it burns, and keeping
// the server (and through it everybody else) told where the ones moved here have got to.
// How one jeep drives is in vehicle.ts; the rules are in src/sim/vehicles.ts.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { audio, type EngineVoice } from '../core/audio';
import type { Input, MoveInput } from '../core/input';
import { physics, SOLID_GROUPS } from '../core/physics';
import { WEAPON_RULES } from '../sim/combat';
import { JEEP, SEATS, crashDamage, jeepSpots, restState, type VehicleInfo, type VState } from '../sim/vehicles';
import type { Net } from '../net/client';
import { roadLift } from '../world/road';
import type { World } from '../world/worldgen';
import type { Terrain } from '../world/terrain';
import type { Avatar } from './avatar';
import type { Effects } from './effects';
import type { Player } from './player';
import type { RemotePlayer } from './remote';
import { DRIVE, Jeep, groundOf, type Controls } from './vehicle';

/**
 * Where whoever sits in each seat has their feet, in the jeep's own frame (x to its right,
 * y up, z back): the driver on the left, then beside them, then the two behind.
 */
export const SEAT_AT: [number, number, number][] = [
  [-0.4, -0.36, 0.12],
  [0.4, -0.36, 0.12],
  [-0.4, -0.36, 1.08],
  [0.4, -0.36, 1.08],
];
/** the view from behind it: how far back, how high the point it looks at is, and the widest it opens at speed */
const VIEW = { back: 7.4, up: 2.15, fov: 1.1 };
const SEND_HZ = 15;

export interface GarageHost {
  scene: THREE.Scene;
  world: World;
  terrain: Terrain;
  player: Player;
  avatar: Avatar;
  net: Net;
  effects: Effects;
  input: Input;
  remotes: Map<number, RemotePlayer>;
  online: () => boolean;
  /** something to tell the player, in the corner */
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  /** a jeep went up here: the blast, and what it does to this player if this game set it off */
  boom: (at: THREE.Vector3, mine: boolean) => void;
  /** a jeep moved here ran somebody down at this speed: a dummy, when playing alone */
  bump: (at: THREE.Vector3, half: THREE.Vector3, quat: THREE.Quaternion, speed: number) => void;
  /** this player was hurt by the jeep they are in (a crash, when playing alone) */
  hurt: (amount: number, cause: string) => void;
}

interface Extra {
  smoke: { owed: number };
  dust: { owed: number };
  voice: EngineVoice | null;
  rpm: number;
  /** who this game has just run down with it, and when */
  hitAt: Map<number, number>;
  crashAt: number;
  /** when the tank was last heard to be empty by the one at the wheel */
  dryAt: number;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Garage {
  readonly jeeps = new Map<number, Jeep>();
  /** the jeep this player sits in, and where */
  ride: { jeep: Jeep; seat: number } | null = null;
  /** there is something to draw a jeep with (see load) */
  ready = false;
  private extra = new Map<Jeep, Extra>();
  private proto: { body: THREE.Object3D; wheels: THREE.Object3D[] } | null = null;
  private sendT = 0;
  /** a seat asked for and not yet given */
  private asked = 0;
  private pivot = new THREE.Vector3();
  private lastYaw = 0;
  private viewDist = VIEW.back;
  /** playing alone: the spots whose jeep burned, and how long until a new one stands there */
  private due: { home: number; t: number }[] = [];
  private homes = new Map<number, number>();
  private nextId = 1;

  constructor(private h: GarageHost) {}

  /** The model, if the game has one. Without it there are no jeeps (in development a plain stand-in is drawn instead). */
  async load() {
    if (assets.manifest.models[JEEP.model]) {
      const scene = await assets.model(JEEP.model);
      this.proto = fromModel(scene);
    } else if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) this.proto = standIn();
    this.ready = !!this.proto;
  }

  private make() {
    const p = this.proto!;
    return { body: p.body.clone(true), wheels: p.wheels.map((w) => w.clone(true)) };
  }

  private groundAt = (x: number, z: number) => (roadLift(this.h.world, x, z) > 0 ? 'asphalt' : groundOf(this.h.terrain.surfaceAt(x, z)));

  add(v: VehicleInfo) {
    if (!this.ready || this.jeeps.has(v.i)) return;
    const j = new Jeep(v.i, this.groundAt);
    j.build(this.h.scene, v.s, this.make());
    j.hp = v.hp;
    j.fuel = v.fuel;
    this.jeeps.set(v.i, j);
    this.extra.set(j, { smoke: { owed: 0 }, dust: { owed: 0 }, voice: null, rpm: 0, hitAt: new Map(), crashAt: 0, dryAt: 0 });
    j.onCrash = (hard) => this.crashed(j, hard);
    if (v.hp <= 0) this.char(j);
    this.seats(v.i, v.seats, v.sim);
  }

  remove(i: number) {
    const j = this.jeeps.get(i);
    if (!j) return;
    if (this.ride?.jeep === j) this.out(false);
    this.extra.get(j)?.voice?.stop();
    this.extra.delete(j);
    this.jeeps.delete(i);
    j.dispose(this.h.scene);
  }

  clear() {
    for (const i of [...this.jeeps.keys()]) this.remove(i);
    this.due.length = 0;
    this.homes.clear();
  }

  /** playing alone: this game stands them where the server would */
  startAlone() {
    this.clear();
    if (!this.ready) return;
    jeepSpots(this.h.world).forEach((p, home) => this.standAlone(p, home));
  }

  private standAlone(p: { x: number; y: number; z: number; yaw: number }, home: number) {
    const i = this.nextId++;
    this.homes.set(i, home);
    this.add({ i, s: restState(p.x, p.y, p.z, p.yaw), hp: JEEP.hp, fuel: Math.round(JEEP.tank * (0.3 + Math.random() * 0.45)), seats: Array(SEATS).fill(null), sim: null });
  }

  /** what the server sends about them, wired to what is done about it here */
  bind() {
    const net = this.h.net;
    net.on('vs', (m) => {
      const now = performance.now();
      for (const s of m.s) this.jeeps.get(s[0])?.push(s.slice(2) as VState, s[1], now);
    });
    net.on('vseat', (m) => this.seats(m.i, m.seats, m.sim, m.s));
    net.on('vhp', (m) => {
      const j = this.jeeps.get(m.i);
      if (j) j.hp = m.hp;
    });
    net.on('vfuel', (m) => {
      const j = this.jeeps.get(m.i);
      // (the one at the wheel counts it down themselves between the server's words on it)
      if (j && (this.ride?.jeep !== j || this.ride.seat !== 0 || Math.abs(j.fuel - m.fuel) > 1.5 || m.fuel <= 0)) j.fuel = m.fuel;
    });
    net.on('vboom', (m) => {
      const j = this.jeeps.get(m.i);
      if (j) this.blow(j, m.by === net.id);
    });
    net.on('v-', (m) => this.remove(m.i));
    net.on('v+', (m) => this.add(m.v));
  }

  /** everybody put (back) in the seat the jeeps say they are in */
  reseat() {
    for (const j of this.jeeps.values()) {
      for (const r of this.h.remotes.values()) {
        const k = j.seats.indexOf(r.id);
        if (k >= 0) r.seat = { jeep: j, at: SEAT_AT[k] };
      }
    }
  }

  /** who sits where in a jeep now, and whose game moves it */
  private seats(i: number, seats: (number | null)[], sim: number | null, rest?: VState) {
    const j = this.jeeps.get(i);
    if (!j) return;
    const me = this.h.net.id;
    const online = this.h.online();
    j.seats = seats.slice();
    // everybody else, into and out of their seats
    for (const r of this.h.remotes.values()) {
      const k = seats.indexOf(r.id);
      if (k >= 0) r.seat = { jeep: j, at: SEAT_AT[k] };
      else if (r.seat?.jeep === j) r.seat = null;
    }
    const mine = online ? seats.indexOf(me) : this.ride?.jeep === j ? this.ride.seat : -1;
    if (mine >= 0 && this.ride?.jeep !== j) this.sit(j, mine);
    else if (mine < 0 && this.ride?.jeep === j) this.out(false);
    else if (mine >= 0 && this.ride) this.ride.seat = mine;
    if (j.sim !== sim) {
      j.sim = sim;
      j.forget();
    }
    const here = online ? sim === me : j.mode === 'sim';
    if (here) j.setMode('sim');
    else {
      j.setMode(sim === null ? 'parked' : 'follow');
      if (rest) j.place(rest);
    }
  }

  // ------------------------------------------------------------------ in and out

  /** the seat a player standing here would take: the one whose door they are at, or the nearest free one */
  seatFor(j: Jeep, from: THREE.Vector3): number {
    let best = -1, bd = Infinity;
    for (let k = 0; k < SEATS; k++) {
      if (j.seats[k] !== null) continue;
      const s = SEAT_AT[k];
      const d = j.point(s[0] * 2.6, 0, s[2], _a).distanceTo(from) - (k === 0 ? 0.35 : 0);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  /**
   * F on a jeep: get in it (or stand it back up).
   * @param tagged the player carries a tag they took off somebody: they go on foot
   */
  use(j: Jeep, tagged = false) {
    if (this.ride || j.wreck) return;
    const p = this.h.player;
    if (j.over) {
      if (j.seats.some((s) => s !== null)) return;
      if (this.h.online()) this.h.net.send({ t: 'vflip', i: j.i });
      else j.setMode('sim');
      this.flipDue = j;
      return;
    }
    if (tagged) return this.h.note(JEEP.noTag, 'warn');
    const seat = this.seatFor(j, p.pos);
    if (seat < 0) return this.h.note('No free seat', 'warn');
    if (this.h.online()) {
      if (performance.now() - this.asked < 600) return;
      this.asked = performance.now();
      this.h.net.send({ t: 'vin', i: j.i, seat });
    } else {
      j.seats[seat] = 0;
      this.sit(j, seat);
      if (seat === 0) j.setMode('sim');
    }
  }
  /** a jeep this game was asked to stand up, once it is this game's to move */
  private flipDue: Jeep | null = null;

  /** the words under the cross-hair when a jeep is looked at */
  prompt(j: Jeep, hasCan: boolean, tagged = false): string | null {
    if (j.wreck) return '<small>Burned out</small>';
    if (j.over) return j.seats.some((s) => s !== null) ? null : '<kbd>F</kbd>Turn it over';
    const seat = this.seatFor(j, this.h.player.pos);
    const fuel = hasCan && j.fuel < JEEP.tank - 0.5 ? ' <small>G to pour in a jerrycan</small>' : '';
    if (tagged) return `<small>${JEEP.noTag}</small>${fuel}`;
    if (seat < 0) return `<small>No free seat</small>${fuel}`;
    return `<kbd>F</kbd>${seat === 0 ? 'Drive' : 'Get in'}${j.fuel <= 0 ? ' <small>the tank is empty</small>' : ''}${fuel}`;
  }

  /** ten litres into the tank (the can has already left the pockets) */
  refuel(j: Jeep) {
    if (this.h.online()) this.h.net.send({ t: 'vfuel', i: j.i });
    else j.fuel = Math.min(JEEP.tank, j.fuel + JEEP.can);
  }

  private sit(j: Jeep, seat: number) {
    const p = this.h.player;
    this.ride = { jeep: j, seat };
    p.seat(true);
    this.h.avatar.setSeat(true);
    // the view goes round behind it, looking the way it points
    this.lastYaw = j.yaw;
    p.yaw = j.yaw;
    p.pitch = -0.2;
    this.pivot.copy(j.pos).setY(j.pos.y + VIEW.up);
    this.viewDist = 2.5;
  }

  /** out of the seat, onto the ground beside the door (or wherever there is room) */
  out(tell = true) {
    const r = this.ride;
    if (!r) return;
    const p = this.h.player, j = r.jeep;
    this.ride = null;
    p.seat(false);
    this.h.avatar.setSeat(false);
    const s = SEAT_AT[r.seat];
    const side = Math.sign(s[0]);
    // beside their own door, then the other side, then behind it, then in front, then on top of it
    const tries: [number, number][] = [[side * 1.75, s[2]], [-side * 1.75, s[2]], [side * 1.75, s[2] + 1], [0, 3.1], [0, -3.1]];
    let spot: THREE.Vector3 | null = null;
    for (const [x, z] of tries) {
      j.point(x, 0.6, z, _a);
      const hit = physics.world.castRay(new physics.R.Ray(_a, { x: 0, y: -1, z: 0 }), 4, true, undefined, SOLID_GROUPS, undefined, j.body);
      if (!hit) continue;
      const y = _a.y - hit.timeOfImpact;
      if (physics.boxOverlaps({ x: _a.x, y: y + 1.0, z: _a.z }, 0, 0.3, 0.8, 0.3)) continue;
      spot = new THREE.Vector3(_a.x, y, _a.z);
      break;
    }
    spot ??= j.point(0, 1.5, 0.7, new THREE.Vector3());
    // (set down like a fresh arrival, but no more alive than they were: somebody shot in their seat falls out of it dead)
    const look = p.yaw, dead = p.dead;
    p.spawn(spot.x, spot.y + 0.05, spot.z, look);
    p.dead = dead;
    // jumping from a jeep that is moving: it is the ground that hurts
    const speed = j.vel.length();
    p.vel.copy(j.vel).multiplyScalar(0.6);
    if (speed > 7 && !p.dead) this.h.hurt((speed - 7) * 5, 'jumping from a moving jeep');
    if (tell) {
      if (this.h.online()) this.h.net.send({ t: 'vout' });
      else {
        j.seats[r.seat] = null;
        // (it rolls on until it stops: see frame)
      }
    }
  }

  // ------------------------------------------------------------------ every step, every frame

  /** one step of the simulation: before the world's own */
  step(h: number, input: MoveInput) {
    const r = this.ride;
    for (const j of this.jeeps.values()) {
      let c: Controls | null = null;
      if (r?.jeep === j && r.seat === 0 && j.mode === 'sim' && !this.h.player.dead) {
        c = {
          throttle: (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0),
          steer: (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0),
          hand: input.held('Space'),
        };
      }
      j.step(h, c);
    }
  }

  frame(dt: number, now: number, alpha: number, listener: THREE.Vector3) {
    const h = this.h, p = h.player, online = h.online();
    if (this.flipDue?.mode === 'sim') {
      this.flipDue.flip();
      this.flipDue = null;
    }
    for (const j of this.jeeps.values()) {
      j.update(dt, now, alpha);
      const x = this.extra.get(j)!;
      const near = j.pos.distanceToSquared(listener) < 220 * 220;
      this.sound(j, x, dt, near);
      if (near) this.looks(j, x, dt);
      // playing alone the jeep keeps its own count of what it has left
      if (!online && j.hp <= 0 && !j.wreck) this.blow(j, true);
      if (j.mode !== 'sim') continue;
      const driven = this.ride?.jeep === j && this.ride.seat === 0;
      if (driven) this.runDown(j, x, now);
      // let go of, and stopped: it is nobody's to move any more
      if (!driven && j.atRest && !(online ? j.seats[0] !== null : false)) {
        if (online) h.net.send({ t: 'vrest', i: j.i, s: j.state() });
        j.setMode('parked');
      }
    }
    // what this game moves, told to the server as often as this player's own steps are
    this.sendT += dt;
    if (online && this.sendT >= 1 / SEND_HZ) {
      this.sendT = 0;
      // (what is sent is where the last step of the simulation left it: a part of a step ahead of what this frame draws)
      const at = Math.round(now + (1 - alpha) * physics.fixedDt * 1000);
      for (const j of this.jeeps.values()) if (j.mode === 'sim') h.net.send({ t: 'v', i: j.i, s: j.state(), at });
    }
    if (!online) this.aloneTick(dt);

    const r = this.ride;
    if (r) {
      const j = r.jeep, s = SEAT_AT[r.seat];
      p.ride(j.point(s[0], s[1], s[2], _a), j.vel);
      // the view turns with the jeep; the mouse turns it round the jeep
      const yaw = j.yaw;
      p.yaw += wrap(yaw - this.lastYaw);
      this.lastYaw = yaw;
      p.pitch = THREE.MathUtils.clamp(p.pitch, -1.1, 0.5);
      const x = this.extra.get(j)!;
      if (r.seat === 0 && j.fuel <= 0 && now - x.dryAt > 20_000 && h.input.held('KeyW')) {
        x.dryAt = now;
        h.note('The tank is empty: it wants a jerrycan', 'warn');
      }
      if (p.dead) this.out();
    }
  }

  /** the player's own body, sat in its seat (after the body has been posed for this frame) */
  seatBody() {
    const r = this.ride;
    if (!r) return;
    const s = SEAT_AT[r.seat];
    r.jeep.point(s[0], s[1], s[2], this.h.avatar.root.position);
    this.h.avatar.root.quaternion.copy(r.jeep.quat);
  }

  /** The view from behind the jeep the player is in. */
  view = (cam: THREE.PerspectiveCamera, dt: number) => {
    const r = this.ride;
    if (!r) return;
    const j = r.jeep, p = this.h.player;
    _a.copy(j.pos).setY(j.pos.y + VIEW.up);
    if (this.pivot.distanceToSquared(_a) > 100) this.pivot.copy(_a);
    // it gets a little ahead of the view when it pulls away, and the view catches it up
    this.pivot.lerp(_a, 1 - Math.exp(-14 * dt));
    this.pivot.y = _a.y + (this.pivot.y - _a.y) * 0.5;
    _q.setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
    _b.set(0, 0, 1).applyQuaternion(_q);
    // never from the far side of a wall, a tree or a hill
    const hit = physics.world.castRay(new physics.R.Ray(this.pivot, _b), VIEW.back + 0.4, true, undefined, SOLID_GROUPS, undefined, j.body);
    const want = hit ? Math.max(1.4, hit.timeOfImpact - 0.4) : VIEW.back;
    this.viewDist = want < this.viewDist ? want : this.viewDist + (want - this.viewDist) * (1 - Math.exp(-5 * dt));
    cam.position.copy(this.pivot).addScaledVector(_b, this.viewDist);
    cam.quaternion.copy(_q);
    cam.updateMatrixWorld();
  };

  /** how much wider the view is for the speed it is going */
  get fov() {
    const r = this.ride;
    return r ? 1 + (VIEW.fov - 1) * THREE.MathUtils.smoothstep(Math.abs(r.jeep.speed), 6, 21) : 1;
  }

  // ------------------------------------------------------------------ what it does to things

  /** a round found it */
  struck(j: Jeep, weapon: string) {
    if (j.wreck) return;
    if (this.h.online()) this.h.net.send({ t: 'vhit', i: j.i, w: weapon });
    else {
      const rule = WEAPON_RULES[weapon];
      j.hp = Math.max(0, j.hp - (rule ? rule.damage * (rule.blast ? 2 : 1) : 0));
    }
  }

  private crashed(j: Jeep, hard: number) {
    const x = this.extra.get(j)!;
    const now = performance.now();
    audio.crash(j.pos, Math.min(1, (hard - DRIVE.crash) / 10));
    if (now - x.crashAt < 350) return;
    x.crashAt = now;
    if (this.h.online()) this.h.net.send({ t: 'vcrash', i: j.i, n: Math.round(hard * 10) / 10 });
    else {
      const cost = crashDamage(hard);
      j.hp = Math.max(0, j.hp - cost.jeep);
      if (cost.people > 0 && this.ride?.jeep === j) this.h.hurt(cost.people, 'a crash');
    }
  }

  /** whoever is in the way of a jeep this player is driving */
  private runDown(j: Jeep, x: Extra, now: number) {
    const speed = j.vel.length();
    if (speed < JEEP.bumpFrom) return;
    const [hx, , hz] = DRIVE.hull;
    _q.copy(j.quat).invert();
    for (const r of this.h.remotes.values()) {
      if (!r.alive || r.seat || now - (x.hitAt.get(r.id) ?? -1e9) < 700) continue;
      _a.copy(r.pos).sub(j.pos).applyQuaternion(_q);
      if (Math.abs(_a.x) > hx + 0.3 || Math.abs(_a.z) > hz + 0.3 || _a.y > 0.6 || _a.y < -2.6) continue;
      // (only what it is going toward: nobody is run down by a jeep that is leaving them)
      _b.copy(j.vel).applyQuaternion(_q);
      if (_b.x * _a.x + _b.z * _a.z < 0) continue;
      x.hitAt.set(r.id, now);
      const chest = r.chest(_c);
      r.damage(0, chest, j.vel.clone().normalize(), 'torso');
      this.h.effects.bleed(chest, j.vel.clone().normalize(), 0.8);
      this.h.net.send({ t: 'hit', to: r.id, zone: 'torso', w: 'jeep', dist: Math.round(speed * 10) / 10, sup: false, bonus: 0 });
    }
    if (now - (x.hitAt.get(-1) ?? -1e9) > 250) {
      x.hitAt.set(-1, now);
      this.h.bump(j.pos, _a.set(hx + 0.3, 1.6, hz + 0.3), j.quat, speed);
    }
  }

  private blow(j: Jeep, mine: boolean) {
    if (j.wreck) return;
    j.hp = 0;
    const inside = this.ride?.jeep === j;
    if (inside) this.out(false);
    j.seats = Array(SEATS).fill(null);
    this.char(j);
    this.h.boom(j.point(0, 0.3, -0.4, new THREE.Vector3()), mine);
    if (!this.h.online()) {
      if (inside) this.h.hurt(400, 'a burning jeep');
      const home = this.homes.get(j.i);
      if (home !== undefined) this.due.push({ home, t: JEEP.respawn });
      setTimeout(() => this.remove(j.i), 120_000);
    }
  }

  /** burned out: black, and going nowhere */
  private char(j: Jeep) {
    j.wreck = true;
    this.extra.get(j)?.voice?.stop();
    const x = this.extra.get(j);
    if (x) x.voice = null;
    j.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
        const c = (mat as THREE.MeshStandardMaterial).clone();
        c.color?.multiplyScalar(0.09);
        if ('roughness' in c) c.roughness = 1;
        if ('metalness' in c) c.metalness = 0;
        return c;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
  }

  private aloneTick(dt: number) {
    for (let k = this.due.length - 1; k >= 0; k--) {
      const d = this.due[k];
      const p = jeepSpots(this.h.world)[d.home];
      if ((d.t -= dt) > 0 || !p || Math.hypot(p.x - this.h.player.pos.x, p.z - this.h.player.pos.z) < 25) continue;
      this.due.splice(k, 1);
      this.standAlone(p, d.home);
    }
    for (const j of this.jeeps.values()) {
      if (j.wreck || j.hp > JEEP.hp * JEEP.fireAt) continue;
      // alight: it goes up in a few seconds
      j.hp = Math.max(0, j.hp - (JEEP.hp * JEEP.fireAt * dt) / JEEP.fuse);
    }
  }

  // ------------------------------------------------------------------ how it looks and sounds

  private looks(j: Jeep, x: Extra, dt: number) {
    const fx = this.h.effects;
    const left = j.hp / JEEP.hp;
    if (!j.wreck && left < JEEP.smokeAt) fx.engineSmoke(j.point(0, 0.5, -1.45, _a), x.smoke, dt, left < JEEP.fireAt, 1 - left / JEEP.smokeAt);
    else if (j.wreck) fx.engineSmoke(j.point(0, 0.6, -0.4, _a), x.smoke, dt * 0.5, false, 0.6);
    // what the rear wheels throw up, off the road
    const fast = Math.abs(j.speed);
    if (j.grounded >= 2 && (fast > 5 || j.slide > 0.25) && j.ground !== 'rock') {
      const amount = j.ground === 'asphalt' ? j.slide * 0.5 : THREE.MathUtils.clamp(fast / 16, 0.2, 1) + j.slide;
      if (amount > 0.05) {
        fx.dust(j.point(-DRIVE.track, -0.7, DRIVE.base, _a), j.vel, j.ground, amount, x.dust, dt);
        fx.dust(j.point(DRIVE.track, -0.7, DRIVE.base, _a), j.vel, j.ground, amount, x.dust, dt);
      }
    }
  }

  private sound(j: Jeep, x: Extra, dt: number, near: boolean) {
    const running = !j.wreck && near && (j.seats[0] !== null || Math.abs(j.speed) > 0.5) && j.fuel > 0;
    if (!running) {
      if (x.voice) {
        x.voice.stop();
        x.voice = null;
      }
      return;
    }
    x.voice ??= audio.engine();
    if (!x.voice) return;
    // three gears, each run up and dropped into the next
    const v = Math.abs(j.speed);
    const [lo, hi] = v < 7.5 ? [0, 9] : v < 14 ? [5, 16.5] : [10.5, 24];
    const rpm = 850 + 3300 * THREE.MathUtils.clamp((v - lo) / (hi - lo), 0, 1) + Math.abs(j.throttle) * (j.grounded ? 250 : 1400);
    x.rpm += (rpm - x.rpm) * (1 - Math.exp(-(rpm > x.rpm ? 6 : 3.5) * dt));
    x.voice.set(j.pos, x.rpm, Math.abs(j.throttle), v, j.grounded ? j.slide : 0, j.ground === 'asphalt', this.ride?.jeep === j);
  }
}

/**
 * A plain olive box on four dark drums: something to look at while the jeep is being built,
 * in development only. The game is never shipped drawing this (see load).
 */
function standIn() {
  const paint = new THREE.MeshStandardMaterial({ color: 0x4b5334, roughness: 0.85, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.95 });
  const hub = new THREE.MeshStandardMaterial({ color: 0x777a70, roughness: 0.6, metalness: 0.4 });
  const body = new THREE.Group();
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material = paint) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    body.add(mesh);
  };
  const [hx, hy, hz] = DRIVE.hull;
  box(hx * 2, hy * 2 - 0.1, hz * 2, 0, -0.05, 0);
  box(hx * 2 - 0.16, 0.34, 1.25, 0, hy + 0.1, -hz + 0.72);
  box(hx * 2, 0.3, 2.5, 0, hy + 0.08, 0.72);
  box(DRIVE.roof[0] * 2, DRIVE.roof[1] * 2, DRIVE.roof[2] * 2, 0, DRIVE.roof[3], DRIVE.roof[4]);
  for (const x of [-DRIVE.roof[0] + 0.04, DRIVE.roof[0] - 0.04]) for (const z of [-0.36, 0.7, 1.8]) box(0.07, 0.62, 0.07, x, DRIVE.roof[3] - 0.34, z);
  box(0.5, 0.5, 0.2, 0, 0.3, hz + 0.08, dark);
  const wheels: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(DRIVE.radius, DRIVE.radius, 0.26, 20), dark);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.09), hub);
    w.add(tyre, cap);
    wheels.push(w);
  }
  return { body, wheels };
}

/**
 * The model, taken apart: its four wheels (whatever in it is named for one) each set to turn
 * about its own middle, and everything else as the body, with the body's own middle put
 * where the simulation's is.
 */
function fromModel(scene: THREE.Group) {
  const root = scene.clone(true);
  root.updateMatrixWorld(true);
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (/wheel|tyre|tire|koleso/i.test(o.name) && !found.some((f) => f === o.parent || isUnder(o, f))) found.push(o);
  });
  const wheels: THREE.Object3D[] = [];
  const centre = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  // front left, front right, rear left, rear right (the front is -z, its right is +x)
  const order = found
    .map((o) => ({ o, c: centre(o) }))
    .sort((a, b) => (Math.sign(a.c.z - b.c.z) || a.c.x - b.c.x))
    .slice(0, 4);
  order.sort((a, b) => (a.c.z < 0 === b.c.z < 0 ? a.c.x - b.c.x : a.c.z - b.c.z));
  for (const { o, c } of order) {
    const g = new THREE.Group();
    o.parent?.remove(o);
    o.position.sub(c);
    g.add(o);
    wheels.push(g);
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = m.receiveShadow = true;
  });
  const body = new THREE.Group();
  body.add(root);
  return { body, wheels };
}

function isUnder(o: THREE.Object3D, top: THREE.Object3D) {
  for (let p = o.parent; p; p = p.parent) if (p === top) return true;
  return false;
}
