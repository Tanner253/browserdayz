// Every jeep in this game, and the one the player is sitting in: getting in and out, the
// view from behind it, who it runs over, what it sounds like, how it burns, and keeping
// the server (and through it everybody else) told where the ones moved here have got to.
// How one jeep drives is in vehicle.ts; the rules are in src/sim/vehicles.ts.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { audio, type EngineVoice, type RotorVoice } from '../core/audio';
import { rotorAt } from '../sim/airdrop';
import type { Input, MoveInput } from '../core/input';
import { physics, SOLID_GROUPS } from '../core/physics';
import { flying, type Atmosphere, type ShaderPatch } from '../world/atmosphere';
import { WEAPON_RULES } from '../sim/combat';
import { JEEP, POLICE_CAR, RIDE_HEIGHT, SEATS, carDamage, crashDamage, jeepSpots, parkKind, policeSpots, restState, westSpots, type VehicleInfo, type VState } from '../sim/vehicles';
import { gasEdge, gasZone, type GasZone } from '../sim/gas';
import type { Net } from '../net/client';
import { roadLift } from '../world/road';
import { heightAt, type World } from '../world/worldgen';
import type { Terrain } from '../world/terrain';
import { CAR_SIT, type Avatar, type SeatPose } from './avatar';
import type { Effects } from './effects';
import type { Player } from './player';
import type { RemotePlayer } from './remote';
import { DRIVE, DRIVES, DRIVE_CAR, Jeep, groundOf, type Controls } from './vehicle';
import { Heli } from './heli';
import { Horns, NEAR_EARS } from './horns';
import { HELI, heliCrash, heliSpots, hpOf, seatsOf } from '../sim/heli';

/**
 * Where whoever sits in each seat has their feet, in the jeep's own frame (x to its right,
 * y up, z back): the driver on the left, then beside them, then the two behind.
 */
export const SEAT_AT: [number, number, number][] = [
  [-0.41, -0.34, 0.06],
  [0.41, -0.34, 0.06],
  [-0.41, -0.34, 1.0],
  [0.41, -0.34, 1.0],
];
/**
 * And in the police car, by its own seats, which were measured in the game by lines cast at the model (2026-10-10,
 * heights over the car's own middle, the road being 0.81 under it): the front cushion is at -0.35 from 0.35 ahead of
 * the middle to 0.05 behind it, its back rising from there; the back cushion is at -0.22 from 0.6 to 1.05 behind,
 * with a third of a metre of floor between it and the seat in front; the floor is at -0.56 and the roof's underside
 * at 0.6. The library's sitting has its hips 0.54 over the body's own origin and 0.32 BEHIND it, and the top of its
 * head 0.83 over its hips. So: in front the hips at -0.3 and at the middle of the car; behind, the hips at -0.2
 * and 0.88 back, and the body slouched under the roof (CAR_SIT in avatar.ts, where each seat's way of sitting is).
 * (Before this the origin was put where the hips should be: the driver sat a third of a metre behind the seat,
 * through its back, and whoever sat behind had their head through the roof.)
 */
const SEAT_CAR: [number, number, number][] = [
  [-0.4, -0.84, -0.32],
  [0.4, -0.84, -0.32],
  [-0.4, -0.74, 0.56],
  [0.4, -0.74, 0.56],
];
/**
 * And in the helicopter (src/game/heli.ts), as the MD-500 is built: the pilot on the left, the co-pilot on the right;
 * feet on its floor half a metre over the skids. (The pilot was on the right, as in a real one; the owner, 2026-10-14:
 * "the fly/get in (copilot) interaction positions seem to be backwards to me".)
 */
const SEAT_HELI: [number, number, number][] = [
  [-0.36, -0.28, -0.75],
  [0.36, -0.28, -0.75],
];
/** how whoever sits in each seat sits: as the library drew it on a jeep's bench (see CAR_SIT) */
export const SIT_OF: (SeatPose | null)[][] = [[null, null, null, null], [CAR_SIT.front, CAR_SIT.front, CAR_SIT.back, CAR_SIT.back], [null, null, null, null]];
/** the seats of each kind of car (the `k` of a VehicleInfo), and where its engine is, for the smoke */
export const SEATS_OF = [SEAT_AT, SEAT_CAR, SEAT_HELI];
const ENGINE_AT: [number, number, number][] = [[0, 0.5, -1.45], [0, 0.22, -1.9], [0, 1.3, 0.9]];
/** and what each is called, where a player is told what hurt them */
const CALLED = ['jeep', 'police car', 'helicopter'];
/** what each seat is called, on the panel that shows them (src/ui/hud.ts) */
const SEAT_NAMES = [['Driver', 'Passenger', 'Back left', 'Back right'], ['Driver', 'Passenger', 'Back left', 'Back right'], ['Pilot', 'Co-pilot']];
/** how bright the lamps burn while somebody is at the wheel */
const LAMPS = 1.8;
/** how much of the metal the model's paint is drawn with is kept (see fromModel) */
const PAINT_METAL = 0.25;
/** the view from behind it: how far back, how high the point it looks at is, and the widest it opens at speed (a helicopter's from further back and higher) */
const VIEW = { back: 7.4, up: 2.15, fov: 1.1 };
const VIEW_HELI = { back: 13, up: 3.2, fov: 1.12 };
const SEND_HZ = 15;

/** how far off a car that has a lighter copy is drawn with it, metres */
const FAR_CAR = 38;

export interface GarageHost {
  scene: THREE.Scene;
  atmo: Atmosphere;
  world: World;
  terrain: Terrain;
  player: Player;
  avatar: Avatar;
  net: Net;
  effects: Effects;
  input: Input;
  remotes: Map<number, RemotePlayer>;
  /** a car has been made: its own paints are met under each lighting before the lamps are first lit (Renderer.ready) */
  ready?: (parts: THREE.Object3D[]) => void;
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
  /** this jeep's own copies of whatever on it glows: its lamps are lit while somebody drives it */
  lamps: THREE.MeshStandardMaterial[];
  lit: boolean;
  smoke: { owed: number };
  dust: { owed: number };
  voice: EngineVoice | null;
  /** a helicopter's: the rotor's own sound (the supply drop's, src/sim/airdrop.ts), wound up and down with it */
  rotor: RotorVoice | null;
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
  /** the police car's model (see POLICE_CAR): without it, one is drawn as a jeep */
  private protoCar: { body: THREE.Object3D; wheels: THREE.Object3D[] } | null = null;
  /**
   * The police car's lighter copy (scripts/lods.mjs), drawn in its place from FAR_CAR metres off: the same car, its
   * wheels where the whole one's are, with a twentieth of the triangles. (The whole one is 256,000 of them, drawn
   * from any distance and again for every shadow: 2026-10-12.)
   */
  private protoCarFar: { body: THREE.Object3D; wheels: THREE.Object3D[] } | null = null;
  /** the helicopter's model (see HELI): its body, and its main and tail rotors as `wheels`. Without it there is no helicopter. */
  private protoHeli: { body: THREE.Object3D; wheels: THREE.Object3D[] } | null = null;
  private lods = new Map<Jeep, { near: THREE.Object3D[]; far: THREE.Object3D[]; isFar: boolean }>();
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

  /** horns and sirens (see horns.ts) */
  readonly horns: Horns;

  constructor(private h: GarageHost) {
    this.horns = new Horns(this.jeeps, (m) => {
      if (this.h.online()) this.h.net.send(m);
    });
  }

  /** The model, if the game has one. Without it there are no jeeps (in development a plain stand-in is drawn instead). */
  async load() {
    if (assets.manifest.models[JEEP.model]) {
      const m = fromModel(await assets.model(JEEP.model));
      this.proto = m;
      // the springs stand where the model's wheels are, and its tyres are the size it is drawn with
      DRIVE.radius = m.radius;
      DRIVE.track = m.track;
      DRIVE.base = m.base;
    } else if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) this.proto = standIn();
    this.ready = !!this.proto;
    if (this.ready && assets.manifest.models[POLICE_CAR.model]) {
      const m = fromModel(await assets.model(POLICE_CAR.model), POLICE_CAR.kind);
      this.protoCar = m;
      DRIVE_CAR.radius = m.radius;
      DRIVE_CAR.track = m.track;
      DRIVE_CAR.base = m.base;
      if (assets.manifest.models[POLICE_CAR.model].lods?.[0]?.far) {
        // (if its lighter copy cannot be read as a car, the whole one is drawn at any distance, as it was)
        try {
          this.protoCarFar = fromModel(await assets.model(POLICE_CAR.model, 1), POLICE_CAR.kind);
        } catch {
          this.protoCarFar = null;
        }
      }
    }
    if (this.ready && assets.manifest.models[HELI.model]) this.protoHeli = fromHeli(await assets.model(HELI.model));
  }

  /** One jeep's worth of the model: the shapes are shared, the paint is its own (one burns black, another has its lamps on). */
  private make(kind = 0) {
    const p = (kind === HELI.kind && this.protoHeli) || (kind === POLICE_CAR.kind && this.protoCar) || this.proto!;
    let body = p.body.clone(true), wheels = p.wheels.map((w) => w.clone(true));
    // (with a lighter copy: each of its five pieces is the whole one and the lighter one together, one of them shown)
    const pf = kind === POLICE_CAR.kind && this.protoCar ? this.protoCarFar : null;
    let lod: { near: THREE.Object3D[]; far: THREE.Object3D[]; isFar: boolean } | undefined;
    if (pf) {
      const fb = pf.body.clone(true), fw = pf.wheels.map((w) => w.clone(true));
      lod = { near: [body, ...wheels], far: [fb, ...fw], isFar: false };
      for (const o of lod.far) o.visible = false;
      const both = (a: THREE.Object3D, b: THREE.Object3D) => new THREE.Group().add(a, b);
      wheels = wheels.map((w, i) => both(w, fw[i]));
      body = both(body, fb);
    }
    const own = new Map<THREE.Material, THREE.Material>();
    const lamps: THREE.MeshStandardMaterial[] = [];
    const paint = (src: THREE.Material) => {
      let mat = own.get(src);
      if (!mat) {
        mat = src.clone();
        // (polished paint is given the sky to show: see skySheen)
        if (src.userData.sheen) this.h.atmo.register(mat, skySheen, 'car-paint');
        else this.h.atmo.register(mat);
        own.set(src, mat);
        const std = mat as THREE.MeshStandardMaterial;
        if (std.emissiveMap) {
          std.emissiveIntensity = 0;
          lamps.push(std);
        }
      }
      return mat;
    };
    for (const o of [body, ...wheels]) {
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(paint) : paint(mesh.material);
      });
    }
    return { body, wheels, lamps, lod };
  }

  private groundAt = (x: number, z: number) => (roadLift(this.h.world, x, z) > 0 ? 'asphalt' : groundOf(this.h.terrain.surfaceAt(x, z)));

  /**
   * One of each car as it is drawn in the world (painted, lamps and all), in no place: for its shaders to be made
   * with the world's while the game loads. The first jeep and the first police car to be seen were nine shaders
   * made in the frame they were first drawn in: a second and a half in which nothing moved, on coming in.
   */
  warmers(): THREE.Object3D[] {
    if (!this.ready) return [];
    const out: THREE.Object3D[] = [];
    for (const kind of [0, ...(this.protoCar ? [POLICE_CAR.kind] : []), ...(this.protoHeli ? [HELI.kind] : [])]) {
      const made = this.make(kind);
      // (its lighter copy, where it has one, is in the same pieces)
      out.push(made.body, ...made.wheels);
    }
    return out;
  }

  /** the jeeps whose lamps are on (somebody is at the wheel): each throws its headlights when it is dark */
  *lit(): Iterable<Jeep> {
    for (const [j, x] of this.extra) if (x.lit && !j.wreck) yield j;
  }

  add(v: VehicleInfo) {
    if (!this.ready || this.jeeps.has(v.i)) return;
    // (a helicopter whose model this game cannot draw is not drawn as a jeep: it is left out)
    if (v.k === HELI.kind && !this.protoHeli) return;
    const kind = v.k === HELI.kind ? HELI.kind : v.k === POLICE_CAR.kind && this.protoCar ? POLICE_CAR.kind : 0;
    const j = kind === HELI.kind ? new Heli(v.i, this.groundAt) : new Jeep(v.i, this.groundAt, DRIVES[kind], kind);
    const made = this.make(kind);
    if (v.siren) this.horns.heard(v.i, undefined, true);
    j.build(this.h.scene, v.s, made);
    this.h.ready?.([made.body, ...made.wheels]);
    if (made.lod) this.lods.set(j, made.lod);
    j.hp = v.hp;
    j.fuel = v.fuel;
    this.jeeps.set(v.i, j);
    this.extra.set(j, { lamps: made.lamps, lit: false, smoke: { owed: 0 }, dust: { owed: 0 }, voice: null, rotor: null, rpm: 0, hitAt: new Map(), crashAt: 0, dryAt: 0 });
    j.onCrash = (hard) => this.crashed(j, hard);
    if (v.hp <= 0) this.char(j);
    this.seats(v.i, v.seats, v.sim);
  }

  remove(i: number) {
    const j = this.jeeps.get(i);
    if (!j) return;
    if (this.ride?.jeep === j) this.out(false);
    this.extra.get(j)?.voice?.stop();
    this.extra.get(j)?.rotor?.stop();
    this.extra.delete(j);
    this.lods.delete(j);
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
    this.parks().forEach((p, home) => this.standAlone(p, home));
  }

  private parked: { x: number; y: number; z: number; yaw: number; k: number; ks?: number[] }[] | null = null;
  /** where every car stands when the world is new: the jeeps, the police cars, the helicopters and the west's jeeps (as the server numbers them) */
  private parks() {
    // (Worked out once. It is a search of the whole map, every tree and wall of it, and it was asked for by every
    // car on every frame of a game played alone, once cars left under the gas were looked for: a hundred
    // milliseconds a frame, 2026-10-11.)
    if (this.parked) return this.parked;
    const jeeps = jeepSpots(this.h.world), police = policeSpots(this.h.world, jeeps);
    return (this.parked = [...jeeps.map((p) => ({ ...p, k: 0 })), ...police.map((p) => ({ ...p, k: POLICE_CAR.kind })), ...(this.protoHeli ? heliSpots(this.h.world).map((p) => ({ ...p, k: HELI.kind })) : []), ...westSpots(this.h.world, [...jeeps, ...police]).map((p) => ({ ...p, k: 0 }))]);
  }

  private standAlone(p: { x: number; y: number; z: number; yaw: number; k: number; ks?: number[] }, home: number) {
    const i = this.nextId++, k = parkKind(p);
    this.homes.set(i, home);
    this.add({ i, s: restState(p.x, p.y, p.z, p.yaw), hp: hpOf(k), fuel: Math.round(JEEP.tank * (0.3 + Math.random() * 0.45)), seats: Array(SEATS).fill(null), sim: null, ...(k ? { k } : {}) });
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
    net.on('vhorn', (m) => this.horns.heard(m.i, m.horn, m.siren));
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
        if (k >= 0) r.seat = { jeep: j, at: SEATS_OF[j.kind][k], how: SIT_OF[j.kind][k] };
      }
    }
  }

  /** who sits where in a jeep now, and whose game moves it */
  private seats(i: number, seats: (number | null)[], sim: number | null, rest?: VState) {
    const j = this.jeeps.get(i);
    if (!j) return;
    const me = this.h.net.id;
    const online = this.h.online();
    // (a seat taken or left is a door opened and shut: heard from where the car is)
    if (seats.some((s, k) => s !== j.seats[k])) audio.carDoor(j.pos);
    j.seats = seats.slice();
    // everybody else, into and out of their seats
    for (const r of this.h.remotes.values()) {
      const k = seats.indexOf(r.id);
      if (k >= 0) r.seat = { jeep: j, at: SEATS_OF[j.kind][k], how: SIT_OF[j.kind][k] };
      else if (r.seat?.jeep === j) r.seat = null;
    }
    const mine = online ? seats.indexOf(me) : this.ride?.jeep === j ? this.ride.seat : -1;
    if (mine >= 0 && this.ride?.jeep !== j) this.sit(j, mine);
    else if (mine < 0 && this.ride?.jeep === j) this.out(false);
    else if (mine >= 0 && this.ride) {
      this.ride.seat = mine;
      this.h.avatar.setSeat(true, SIT_OF[j.kind][mine]);
    }
    if (j.sim !== sim) {
      j.sim = sim;
      j.forget();
    }
    const here = online ? sim === me : j.mode === 'sim';
    if (here) {
      j.setMode('sim');
      // (a helicopter's wreck handed to this game to come down from where it went up: see Heli.fallApart. Set between
      // the `if` and its `else` on 2026-10-19, it took every car from its driver online: "vehicles have stopped working")
      if (j.wreck && j instanceof Heli) j.fallApart();
    } else {
      j.setMode(sim === null ? 'parked' : 'follow');
      if (rest) j.place(rest);
    }
  }

  // ------------------------------------------------------------------ in and out

  /** the seat a player standing here would take: the one whose door they are at, or the nearest free one */
  seatFor(j: Jeep, from: THREE.Vector3): number {
    let best = -1, bd = Infinity;
    for (let k = 0; k < seatsOf(j.kind); k++) {
      if (j.seats[k] !== null) continue;
      const s = SEATS_OF[j.kind][k];
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
      audio.carDoor(j.pos);
      this.sit(j, seat);
      if (seat === 0) j.setMode('sim');
    }
  }
  /**
   * Ctrl and a number, in a seat: into that seat of the same vehicle, if it is free (as in DayZ). Into the front
   * seat, this game drives it (or flies it) from now on; out of it, a helicopter has nobody at its controls.
   */
  swap(seat: number) {
    const r = this.ride;
    if (!r || seat === r.seat || seat < 0 || seat >= seatsOf(r.jeep.kind) || r.jeep.wreck) return;
    if (r.jeep.seats[seat] !== null) return this.h.note('That seat is taken', 'warn');
    if (this.h.online()) {
      if (performance.now() - this.asked < 300) return;
      this.asked = performance.now();
      this.h.net.send({ t: 'vswap', seat });
    } else {
      const j = r.jeep;
      j.seats[r.seat] = null;
      j.seats[seat] = 0;
      r.seat = seat;
      this.h.avatar.setSeat(true, SIT_OF[j.kind][seat]);
      if (seat === 0) j.setMode('sim');
    }
  }

  /** the seats of the vehicle this player is in, for the panel that shows them: what each is, who is in it */
  seatList(): { name: string; who: string | null; me: boolean }[] | null {
    const r = this.ride;
    if (!r) return null;
    const j = r.jeep, me = this.h.online() ? this.h.net.id : 0;
    return SEAT_NAMES[j.kind].slice(0, seatsOf(j.kind)).map((name, k) => {
      const id = j.seats[k], mine = k === r.seat || (id !== null && id === me && this.h.online());
      return { name, me: mine, who: mine ? 'you' : id === null ? null : this.h.remotes.get(id)?.name ?? 'somebody' };
    });
  }

  /** a jeep this game was asked to stand up, once it is this game's to move */
  private flipDue: Jeep | null = null;

  /** the words under the cross-hair when a jeep is looked at */
  prompt(j: Jeep, hasCan: boolean, tagged = false): string | null {
    if (j.wreck) return '<small>Burned out</small>';
    if (j.over) return j.seats.some((s) => s !== null) ? null : '<kbd>F</kbd>Turn it over';
    const seat = this.seatFor(j, this.h.player.pos);
    const fuel = hasCan && j.fuel < JEEP.tank - 0.5 ? ' <small>hold your jerrycan, and the left button, to pour it in</small>' : '';
    if (tagged) return `<small>${JEEP.noTag}</small>${fuel}`;
    if (seat < 0) return `<small>No free seat</small>${fuel}`;
    // (and which seat it is: in a helicopter, the pilot's or the co-pilot's)
    const which = j instanceof Heli ? ` <small>${SEAT_NAMES[j.kind][seat].toLowerCase()}</small>` : '';
    return `<kbd>F</kbd>${seat === 0 ? (j instanceof Heli ? 'Fly' : 'Drive') : 'Get in'}${which}${j.fuel <= 0 ? ' <small>the tank is empty</small>' : ''}${fuel}`;
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
    this.h.avatar.setSeat(true, SIT_OF[j.kind][seat]);
    // the view goes round behind it, looking the way it points
    this.lastYaw = j.yaw;
    p.yaw = j.yaw;
    p.pitch = -0.2;
    this.pivot.copy(j.pos).setY(j.pos.y + (j instanceof Heli ? VIEW_HELI : VIEW).up);
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
    const s = SEATS_OF[r.jeep.kind][r.seat];
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
    if (speed > 7 && !p.dead) this.h.hurt((speed - 7) * 5, `jumping from a moving ${CALLED[j.kind]}`);
    if (tell) {
      if (this.h.online()) this.h.net.send({ t: 'vout' });
      else {
        j.seats[r.seat] = null;
        audio.carDoor(j.pos);
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
        // (a helicopter's: Space up and C down, as crouching is (the owner, 2026-10-14: "spacebar is not giving me
        // throttle/lift"; "remove the ctrl key, use C like crouch now instead": Ctrl and W shuts the browser's tab).
        // Q and E lean it.)
        if (j instanceof Heli) {
          c.lift = (input.held('Space') ? 1 : 0) - (input.held('KeyC') ? 1 : 0);
          c.roll = (input.held('KeyE') ? 1 : 0) - (input.held('KeyQ') ? 1 : 0);
        }
      }
      j.step(h, c);
    }
    // (the horn at the wheel of a car: H held; and a police car's siren, J)
    const driving = r && r.seat === 0 && !(r.jeep instanceof Heli) && !this.h.player.dead ? r.jeep : null;
    this.horns.drive(driving, input.held('KeyH'), input.pressedFixed('KeyJ'));
  }

  /** where the ears are this frame (see `heardAt`) */
  private ear = new THREE.Vector3();
  /**
   * Where a car's or a helicopter's own sound is put: where it is, but at the ears for whoever is in it or at it.
   * Put at its middle, a metre or two from the head of whoever sat in it, every turn of the head swung it from one
   * ear to the other and back (players, 2026-10-16: the sound is "8D", "everywhere").
   */
  private heardAt(j: Jeep) {
    return j.pos.distanceTo(this.ear) < NEAR_EARS ? this.ear : j.pos;
  }

  frame(dt: number, now: number, alpha: number, listener: THREE.Vector3) {
    this.ear.copy(listener);
    const h = this.h, p = h.player, online = h.online();
    this.horns.frame(listener);
    if (this.flipDue?.mode === 'sim') {
      this.flipDue.flip();
      this.flipDue = null;
    }
    for (const j of this.jeeps.values()) {
      j.update(dt, now, alpha);
      // its lighter copy from FAR_CAR off, its whole self again a little nearer than that
      const lod = this.lods.get(j);
      if (lod) {
        const d2 = j.pos.distanceToSquared(listener), far = lod.isFar ? d2 > (FAR_CAR - 6) ** 2 : d2 > FAR_CAR ** 2;
        if (far !== lod.isFar) {
          lod.isFar = far;
          for (const o of lod.near) o.visible = !far;
          for (const o of lod.far) o.visible = far;
        }
      }
      const x = this.extra.get(j)!;
      const near = j.pos.distanceToSquared(listener) < 220 * 220;
      // (a helicopter up, or its rotor turning: its shadow drawn every frame, wherever it lies; see flying. Not one left
      // standing, rotor still: the one on Kamenka's roof is ten metres over the ground under it, and was both wider maps
      // of the sun drawn every frame within 220 m of it, found in the game 2026-10-20)
      if (j instanceof Heli && near && j.mode !== 'parked') {
        const ground = heightAt(h.world.heights, j.pos.x, j.pos.z);
        if (j.rpm > 0 || j.pos.y - ground > 3) flying(j.pos.x, j.pos.y, j.pos.z, ground);
      }
      this.sound(j, x, dt, near);
      if (near) this.looks(j, x, dt);
      // playing alone the jeep keeps its own count of what it has left
      if (!online && j.hp <= 0 && !j.wreck) this.blow(j, true);
      if (j.mode !== 'sim') continue;
      const driven = this.ride?.jeep === j && this.ride.seat === 0;
      if (driven) this.runDown(j, x, now);
      this.nudge(j, now);
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
      const j = r.jeep, s = SEATS_OF[r.jeep.kind][r.seat];
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
    const s = SEATS_OF[r.jeep.kind][r.seat];
    r.jeep.point(s[0], s[1], s[2], this.h.avatar.root.position);
    this.h.avatar.root.quaternion.copy(r.jeep.quat);
  }

  /** The view from behind the jeep the player is in. */
  view = (cam: THREE.PerspectiveCamera, dt: number) => {
    const r = this.ride;
    if (!r) return;
    const j = r.jeep, p = this.h.player, V = j instanceof Heli ? VIEW_HELI : VIEW;
    _a.copy(j.pos).setY(j.pos.y + V.up);
    if (this.pivot.distanceToSquared(_a) > 100) this.pivot.copy(_a);
    // it gets a little ahead of the view when it pulls away, and the view catches it up
    this.pivot.lerp(_a, 1 - Math.exp(-14 * dt));
    this.pivot.y = _a.y + (this.pivot.y - _a.y) * 0.5;
    _q.setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
    _b.set(0, 0, 1).applyQuaternion(_q);
    // never from the far side of a wall, a tree or a hill
    const hit = physics.world.castRay(new physics.R.Ray(this.pivot, _b), V.back + 0.4, true, undefined, SOLID_GROUPS, undefined, j.body);
    const want = hit ? Math.max(1.4, hit.timeOfImpact - 0.4) : V.back;
    this.viewDist = want < this.viewDist ? want : this.viewDist + (want - this.viewDist) * (1 - Math.exp(-5 * dt));
    cam.position.copy(this.pivot).addScaledVector(_b, this.viewDist);
    cam.quaternion.copy(_q);
    cam.updateMatrixWorld();
  };

  /** how much wider the view is for the speed it is going */
  get fov() {
    const r = this.ride;
    return r ? 1 + ((r.jeep instanceof Heli ? VIEW_HELI : VIEW).fov - 1) * THREE.MathUtils.smoothstep(Math.abs(r.jeep.speed), 6, r.jeep instanceof Heli ? 45 : 21) : 1;
  }

  // ------------------------------------------------------------------ what it does to things

  /** a round found it */
  struck(j: Jeep, weapon: string) {
    if (j.wreck) return;
    if (this.h.online()) this.h.net.send({ t: 'vhit', i: j.i, w: weapon });
    else {
      const rule = WEAPON_RULES[weapon];
      j.hp = Math.max(0, j.hp - (rule ? carDamage(rule) : 0));
    }
  }

  private crashed(j: Jeep, hard: number) {
    const x = this.extra.get(j)!;
    const now = performance.now();
    audio.crash(j.pos, Math.min(1, (hard - j.d.crash) / 10));
    if (now - x.crashAt < 350) return;
    x.crashAt = now;
    if (this.h.online()) this.h.net.send({ t: 'vcrash', i: j.i, n: Math.round(hard * 10) / 10 });
    else {
      const cost = j instanceof Heli ? heliCrash(hard) : crashDamage(hard);
      j.hp = Math.max(0, j.hp - cost.jeep);
      if (cost.people > 0 && this.ride?.jeep === j) this.h.hurt(cost.people, 'a crash');
    }
  }

  /**
   * A vehicle this game moves that runs into one standing parked, with nobody in it: that one is moved too, by this
   * game, until it is at rest again (the owner, 2026-10-14: "Vehicles should have physics even with no passengers").
   * Standing parked, a vehicle is a thing the world holds still for every game alike: one that was run into was a
   * wall. The server hands it to this game ('vtake'); it is handed back at rest as any other is ('vrest').
   */
  private nudge(j: Jeep, now: number) {
    if (j.vel.lengthSq() < 0.25) return;
    for (const c of j.colliders) {
      physics.world.contactPairsWith(c, (o) => {
        const other = physics.tagOf(o)?.owner;
        if (!(other instanceof Jeep) || other === j || other.mode !== 'parked' || other.wreck || other.seats.some((s) => s !== null)) return;
        if (now - (this.taken.get(other.i) ?? -1e9) < 1500) return;
        this.taken.set(other.i, now);
        if (this.h.online()) this.h.net.send({ t: 'vtake', i: other.i });
        else other.setMode('sim');
      });
    }
  }
  /** when this game last asked for each vehicle it ran into */
  private taken = new Map<number, number>();

  /** whoever is in the way of a jeep this player is driving */
  private runDown(j: Jeep, x: Extra, now: number) {
    const speed = j.vel.length();
    if (speed < JEEP.bumpFrom) return;
    const [hx, , hz] = j.d.hull;
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
    // (seen to go up, its wreck burns on for a while: one found already burned out is cold)
    const x = this.extra.get(j);
    if (x) this.h.effects.wrecked(x.smoke);
    this.h.boom(j.point(0, 0.3, -0.4, new THREE.Vector3()), mine);
    // (a helicopter this game moves comes down, tumbling: see Heli.fallApart; online the server hands it to a game to)
    if (j instanceof Heli && j.mode === 'sim') j.fallApart();
    if (!this.h.online()) {
      if (inside) this.h.hurt(400, `a burning ${CALLED[j.kind]}`);
      const home = this.homes.get(j.i);
      if (home !== undefined) this.due.push({ home, t: JEEP.respawn });
      setTimeout(() => this.remove(j.i), 120_000);
    }
  }

  /** burned out: black, its glass gone, and going nowhere */
  private char(j: Jeep) {
    j.wreck = true;
    this.extra.get(j)?.voice?.stop();
    const x = this.extra.get(j);
    if (x) x.voice = null;
    const burnt = new Map<THREE.Material, THREE.Material>();
    j.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name === 'glass' || m.parent?.name === 'glass') {
        m.visible = false;
        return;
      }
      const char = (mat: THREE.Material) => {
        let c = burnt.get(mat) as THREE.MeshStandardMaterial | undefined;
        if (!c) {
          c = (mat as THREE.MeshStandardMaterial).clone();
          c.color?.multiplyScalar(0.09);
          if ('roughness' in c) c.roughness = 1;
          if ('metalness' in c) c.metalness = 0;
          if ('emissiveIntensity' in c) c.emissiveIntensity = 0;
          this.h.atmo.register(c);
          burnt.set(mat, c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(char) : char(m.material);
    });
  }

  private gas: GasZone | null | undefined;
  /** playing alone: how long each car has stood empty under the gas with nobody near, seconds */
  private leftFor = new Map<number, number>();

  private aloneTick(dt: number) {
    for (let k = this.due.length - 1; k >= 0; k--) {
      const d = this.due[k];
      const p = this.parks()[d.home];
      if ((d.t -= dt) > 0 || !p || Math.hypot(p.x - this.h.player.pos.x, p.z - this.h.player.pos.z) < 25) continue;
      this.due.splice(k, 1);
      this.standAlone(p, d.home);
    }
    // a car left under the gas with nobody near is stood back where it first stood (see JEEP.gas)
    this.gas ??= gasZone(this.h.world.pois, (x, z) => heightAt(this.h.world.heights, x, z));
    for (const j of [...this.jeeps.values()]) {
      const home = this.homes.get(j.i), p = home === undefined ? null : this.parks()[home];
      const me = this.h.player.pos;
      const left = !!this.gas && !!p && !j.wreck && this.ride?.jeep !== j && gasEdge(this.gas, j.pos.x, j.pos.z) < 0 && Math.hypot(me.x - j.pos.x, me.z - j.pos.z) > JEEP.gas.clear;
      const t = left ? (this.leftFor.get(j.i) ?? 0) + dt : 0;
      this.leftFor.set(j.i, t);
      if (t > JEEP.gas.after && p && Math.hypot(p.x - me.x, p.z - me.z) > JEEP.respawnClear) {
        this.leftFor.delete(j.i);
        this.remove(j.i);
        this.standAlone(p, home!);
      }
    }
    for (const j of this.jeeps.values()) {
      const most = hpOf(j.kind);
      if (j.wreck || j.hp > most * JEEP.fireAt) continue;
      // alight: it goes up in a few seconds
      j.hp = Math.max(0, j.hp - (most * JEEP.fireAt * dt) / JEEP.fuse);
    }
  }

  // ------------------------------------------------------------------ how it looks and sounds

  private looks(j: Jeep, x: Extra, dt: number) {
    const fx = this.h.effects;
    // lamps on while somebody is at the wheel
    const lit = !j.wreck && j.seats[0] !== null;
    if (lit !== x.lit) {
      x.lit = lit;
      for (const m of x.lamps) m.emissiveIntensity = lit ? LAMPS : 0;
    }
    const left = j.hp / hpOf(j.kind);
    if (!j.wreck && left < JEEP.smokeAt) fx.engineSmoke(j.point(...ENGINE_AT[j.kind], _a), x.smoke, dt, left < JEEP.fireAt, 1 - left / JEEP.smokeAt, j.quat, j.vel);
    else if (j.wreck) fx.engineSmoke(j.point(0, ENGINE_AT[j.kind][1] + 0.1, -0.4, _a), x.smoke, dt * 0.5, false, 0.6, j.quat, undefined, true);
    // what the rear wheels throw up, off the road
    const fast = Math.abs(j.speed);
    if (j.grounded >= 2 && (fast > 5 || j.slide > 0.25) && j.ground !== 'rock') {
      const amount = j.ground === 'asphalt' ? j.slide * 0.5 : THREE.MathUtils.clamp(fast / 16, 0.2, 1) + j.slide;
      if (amount > 0.05) {
        fx.dust(j.point(-j.d.track, -0.7, j.d.base, _a), j.vel, j.ground, amount, x.dust, dt);
        fx.dust(j.point(j.d.track, -0.7, j.d.base, _a), j.vel, j.ground, amount, x.dust, dt);
      }
    }
  }

  private sound(j: Jeep, x: Extra, dt: number, near: boolean) {
    if (j instanceof Heli) return this.rotorSound(j, x);
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
    x.voice.set(this.heardAt(j), x.rpm, Math.abs(j.throttle), v, j.grounded ? j.slide : 0, j.ground === 'asphalt', this.ride?.jeep === j);
  }

  /** a helicopter's rotor, heard as the supply drop's is (by how far off it is, and coming or going), as loud and as high as it is turning fast */
  private rotorSound(j: Heli, x: Extra) {
    const rpm = j.mode === 'parked' ? 0 : j.steer, ear = this.h.player.pos;
    const away = j.pos.distanceTo(ear);
    if (j.wreck || rpm < 0.02 || away > 900) {
      x.rotor?.stop();
      x.rotor = null;
      return;
    }
    x.rotor ??= audio.rotor();
    if (!x.rotor) return;
    const closing = away > 1 ? -_a.copy(j.pos).sub(ear).dot(j.vel) / away : 0;
    const r = rotorAt(away, closing);
    x.rotor.set(this.heardAt(j), r.gain * rpm * (0.6 + 0.4 * j.throttle), r.rate * (0.5 + 0.5 * rpm), r.cutoff);
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
  const [hx, hy, hz, , D_UP] = DRIVE.hull;
  box(hx * 2, hy * 2 - 0.1, hz * 2, 0, -0.05, 0);
  box(hx * 2 - 0.16, 0.34, 1.25, 0, hy + 0.1, -hz + 0.72);
  box(hx * 2, 0.3, 2.5, 0, hy + 0.08, 0.72);
  box(DRIVE.roof[0] * 2, DRIVE.roof[1] * 2, DRIVE.roof[2] * 2, 0, DRIVE.roof[3], DRIVE.roof[4]);
  for (const x of [-DRIVE.roof[0] + 0.04, DRIVE.roof[0] - 0.04]) for (const z of [-0.36, 0.7, 1.8]) box(0.07, 0.62, 0.07, x, DRIVE.roof[3] - 0.34, z);
  box(0.5, 0.5, 0.2, 0, 0.3, hz + 0.08, dark);
  body.position.y = D_UP;
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
  return { body, wheels, radius: DRIVE.radius, track: DRIVE.track, base: DRIVE.base };
}

/**
 * The model as the asset pipeline writes a vehicle (scripts/assets.config.mjs): standing on
 * y = 0 with the middle of its wheelbase at the origin and its nose toward -z, in pieces
 * named `body`, `glass`, `helm` and `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`, each wheel
 * about its own middle. Here the wheels are lifted out to be moved by the springs, the rest
 * is set down where the simulation's body is, and the wheels are measured.
 */
/**
 * Polished paint shows the sky. What the engine itself gives a painted thing of the sky is four parts in a hundred
 * of it, which on black paint is nothing to see: the car was a black hole in the shape of a car. So what a clear
 * coat shows is said here: the sky by the way the surface throws the eye's line back (the ground's grey-green
 * under the horizon, haze at it, blue overhead), a little of it seen square on and most of it at a glance along
 * the surface, and as bright as the hour (uDaylight is the atmosphere's: see `register` there).
 */
const skySheen: ShaderPatch = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `{
      vec3 zEye = normalize(vViewPosition);
      vec3 zBack = inverseTransformDirection(reflect(-zEye, normal), viewMatrix);
      float zGlance = 0.035 + 0.965 * pow(1.0 - saturate(dot(normal, zEye)), 5.0);
      vec3 zSky = mix(vec3(0.34, 0.37, 0.31), vec3(0.74, 0.82, 0.92), smoothstep(-0.08, 0.22, zBack.y));
      zSky = mix(zSky, vec3(0.28, 0.48, 0.86), smoothstep(0.22, 1.0, zBack.y));
      outgoingLight += zSky * zGlance * 0.62 * uDaylight;
    }
    #include <opaque_fragment>`,
  );
};

/**
 * What the police car is made of, by the names its maker gave its surfaces. As it came it was drawn for a studio:
 * its paint is bare metal polished to a mirror, which with black under it shows almost nothing; its tyres were metal as well; and its seats, its dashboard and its
 * light bar were see-through, which the game took for glass and drew as a ghost of an inside. Here the paint is
 * paint under a clear coat (it shows the sky: see skySheen), the tyres are rubber, the inside is solid, and the light bar is
 * coloured plastic that is lit while somebody drives (its picture is its own lamp: see `lamps` in Garage.make).
 */
function dressPoliceCar(m: THREE.Mesh, mat: THREE.MeshStandardMaterial) {
  const phys = mat as THREE.MeshPhysicalMaterial;
  if (phys.isMeshPhysicalMaterial) phys.transmission = 0;
  const solid = () => {
    mat.transparent = false;
    mat.opacity = 1;
    mat.alphaTest = 0.5;
    mat.depthWrite = true;
    mat.metalness = 0;
    mat.metalnessMap = null;
    m.castShadow = true;
    m.renderOrder = 0;
  };
  if (mat.name === 'body') {
    // Its white is all of white in its picture (255 of 255), and all of white is the one colour the engine cannot
    // light: its sum for what a surface throws back divides by nothing at exactly that, the answer is not a number,
    // and the game's own guard against such answers paints the place black. That is what its doors and its roof
    // were: black, with the letters on them showing lighter. A tenth off the white, and it is white paint.
    mat.color.setScalar(0.9);
    mat.metalness = 0;
    mat.metalnessMap = null;
    mat.roughness = 0.22;
    mat.roughnessMap = null;
    // (and it shows the sky: see `skySheen`, which Garage.make gives whatever is marked so)
    mat.userData.sheen = 1;
  } else if (mat.name === 'wheel') {
    mat.metalness = 0.1;
    mat.roughness = 0.82;
  } else if (mat.name === 'interior') {
    solid();
    mat.roughness = 0.9;
  } else if (mat.name === 'roof_light_bar') {
    solid();
    mat.roughness = 0.3;
    mat.roughnessMap = null;
    mat.emissiveMap = mat.map;
    mat.emissive.set(0xffffff);
  }
}

function fromModel(scene: THREE.Group, kind = 0) {
  const root = scene.clone(true);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), at = new THREE.Vector3(), size = new THREE.Vector3();
  let radius = 0, track = 0, base = 0;
  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((name) => {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`the jeep's model has no ${name}`);
    box.setFromObject(o).getCenter(at);
    box.getSize(size);
    radius += size.y / 8;
    track += Math.abs(at.x) / 4;
    base += Math.abs(at.z) / 4;
    const g = new THREE.Group();
    o.removeFromParent();
    o.position.sub(at);
    g.add(o);
    return g;
  });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.transparent || /glass/i.test(mat.name)) {
      // glass that can be seen through: whoever sits behind it is there to be shot at
      mat.transparent = true;
      mat.opacity = 0.3;
      mat.depthWrite = false;
      mat.roughness = 0.08;
      mat.metalness = 0;
      m.castShadow = false;
      m.renderOrder = 2;
    } else if (mat.metalnessMap) {
      // Its paint is drawn as bare metal, which under a studio's lamps is olive and under this
      // sky is black (metal shows only what it reflects). Mostly paint, with a little of the sheen.
      mat.metalness = PAINT_METAL;
    }
    if (kind === POLICE_CAR.kind) dressPoliceCar(m, mat);
  });
  for (const w of wheels) {
    w.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      // (the wheels are taken off the body before its surfaces are gone through: theirs are seen to here)
      if (kind === POLICE_CAR.kind) dressPoliceCar(m, m.material as THREE.MeshStandardMaterial);
    });
  }
  // (the simulation's body has its middle RIDE_HEIGHT above the ground it stands on)
  root.position.y = -RIDE_HEIGHT;
  const body = new THREE.Group();
  body.add(root);
  return { body, wheels, radius, track, base };
}

/**
 * The helicopter's model as the asset pipeline writes it (scripts/assets.config.mjs, `md500`): standing on the bottom
 * of its skids at y = 0, the main rotor's hub over the origin, nose toward -z, its rotors pieces of their own
 * (`md500_rotor`, `md500_tail`) each about its hub. They are lifted out to be turned; its glass is made glass, as a
 * car's is. (Heli.build sets it down where the simulation's body is.)
 */
function fromHeli(scene: THREE.Group) {
  const root = scene.clone(true);
  const wheels = ['md500_rotor', 'md500_tail'].map((name) => {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`the helicopter's model has no ${name}`);
    o.removeFromParent();
    return o;
  });
  for (const part of [root, ...wheels]) {
    part.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.transparent || /glass/i.test(mat.name)) {
        mat.transparent = true;
        mat.opacity = 0.3;
        mat.depthWrite = false;
        mat.roughness = 0.08;
        mat.metalness = 0;
        m.castShadow = false;
        m.renderOrder = 2;
      }
    });
  }
  const body = new THREE.Group();
  body.add(root);
  return { body, wheels };
}
