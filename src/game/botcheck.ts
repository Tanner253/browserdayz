// The bot check, as the player meets it: a round yard high over the middle of the map, walls and a hut and a
// catwalk in it, and six figures about it that the server walks and the server shows (src/sim/course.ts: read that
// first). Here the yard is built as the server turned it, each figure is drawn where the server last said it was
// and only while the server says it is in sight, and the server is told where the player stands and looks and what
// they fire. A figure goes down when the server says it has counted it, and not before: what the player's own game
// thinks it hit is a flinch and no more.
//
// (Until 2026-10-15 this was a strip with figures walking behind walls, worked out here from one number: so was it
// worked out by the programs that walked through it. That strip is ./botcheck-strip.ts, kept for the ninth film.)

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets } from '../core/assets';
import { TOUCH } from '../core/device';
import { physics, HITBOX_GROUPS } from '../core/physics';
import type { Atmosphere } from '../world/atmosphere';
import type { C2S } from '../net/protocol';
import { BLOCKS, RAMP, YARD, fromPlan, type Sighting } from '../sim/course';
import { Avatar } from './avatar';
import { lookFor } from './look';
import type { Damageable, HitZone } from './weapons';

/** how often the server is told where the player stands and looks, a second */
const TOLD_HZ = 20;
/** a figure not heard of for this long is out of sight (ms) */
const UNSEEN = 400;
/** the ring wall's pieces */
const RING_PIECES = 36;

const _v = new THREE.Vector3();

/** A block of concrete, its picture laid at the same size on every face whatever the block's own. */
function slab(w: number, h: number, d: number, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // (the faces as the library makes them: right, left, top, bottom, front, back; four corners each)
  const size = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, (uv.getX(f * 4 + k) * size[f][0]) / tile, (uv.getY(f * 4 + k) * size[f][1]) / tile);
  return g;
}

/** One of the figures of the yard: a body, and the places a shot lands on it. It is hurt by nothing: the server says when it is down. */
class Figure implements Damageable {
  readonly name = 'Range figure';
  readonly avatar = new Avatar();
  readonly pos = new THREE.Vector3();
  ready = false;
  down = false;
  /** where the server last said it was, its pace, whether it is up, and when that was heard (performance.now) */
  said: { x: number; y: number; z: number; vx: number; vz: number; up: boolean; at: number } | null = null;
  private body!: RAPIER.RigidBody;
  private zones: RAPIER.Collider[] = [];
  private vel = new THREE.Vector3();
  private yaw = 0;

  constructor(private i: number) {}

  async load(atmo: Atmosphere, scene: THREE.Scene) {
    await this.avatar.load(atmo, 0, false, lookFor(`range figure ${this.i}`));
    this.avatar.root.visible = false;
    scene.add(this.avatar.root);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const zone = (desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
      c.setEnabled(false);
      this.zones.push(c);
    };
    zone(R.ColliderDesc.ball(0.14).setTranslation(0, 1.64, 0), 'head');
    zone(R.ColliderDesc.cuboid(0.26, 0.33, 0.2).setTranslation(0, 1.2, 0), 'torso');
    zone(R.ColliderDesc.cuboid(0.2, 0.45, 0.2).setTranslation(0, 0.45, 0), 'legs');
    this.ready = true;
  }

  /** a shot of the player's own landed, as their game reckons it: it flinches, and the server is the one to say whether it is down */
  damage(_amount: number, _point: THREE.Vector3, _dir: THREE.Vector3, zone: HitZone): boolean {
    if (!this.down) this.avatar.hit(zone === 'head');
    return false;
  }

  /** drawn where the server last said, carried on at its pace for a moment; out of sight when nothing has been said for a while */
  walk(floor: number, now: number, dt: number) {
    if (!this.ready) return;
    const s = this.said, shown = !!s && (this.down || now - s.at < UNSEEN);
    if (this.avatar.root.visible !== shown) {
      this.avatar.root.visible = shown;
      for (const c of this.zones) c.setEnabled(shown && !this.down);
    }
    if (!shown || !s) return;
    if (!this.down) {
      const ahead = Math.min(0.25, (now - s.at) / 1000);
      this.pos.set(s.x + s.vx * ahead, floor + s.y, s.z + s.vz * ahead);
      this.vel.set(s.vx, 0, s.vz);
      if (Math.hypot(s.vx, s.vz) > 0.05) this.yaw = Math.atan2(-s.vx, -s.vz);
      this.body.setNextKinematicTranslation(this.pos);
    } else this.vel.set(0, 0, 0);
    this.avatar.update(dt, this.pos, this.vel, this.yaw, !this.down && !s.up, this.down);
  }

  fall() {
    if (this.down || !this.ready) return;
    this.down = true;
    this.avatar.setDeath(1);
    for (const c of this.zones) c.setEnabled(false);
  }

  stand() {
    if (!this.ready) return;
    this.down = false;
    this.said = null;
    this.avatar.root.visible = false;
    this.avatar.clearWounds();
    for (const c of this.zones) c.setEnabled(false);
  }

  dispose() {
    this.avatar.dispose();
    if (!this.ready) return;
    for (const c of this.zones) physics.tags.delete(c.handle);
    physics.world.removeRigidBody(this.body);
    this.ready = false;
  }
}

export interface BotCheckHost {
  scene: THREE.Scene;
  atmo: Atmosphere;
  camera: THREE.Camera;
  /** how high the yard's floor stands, in the world */
  floor: number;
  /** the player is put here, looking along `yaw` */
  place(x: number, y: number, z: number, yaw: number): void;
  where(): THREE.Vector3;
  send(m: C2S): void;
  /** a thing made ready to be drawn before it is shown (Renderer.ready) */
  ready(o: THREE.Object3D): Promise<void>;
  /** the player has their hands on the game: the mouse is taken, or it is a touch screen */
  playing(): boolean;
}

export class BotCheck {
  /** on the course now */
  active = false;
  private turn = 0;
  private need = 6;
  private secs = 60;
  private go = 0;
  private t0 = 0;
  private told = 0;
  /** the floor and the ring: built once */
  private yard: THREE.Group | null = null;
  /** the walls, the hut, the catwalk and the blocks, turned as the server turned them: built for each go */
  private lay: THREE.Group | null = null;
  private fixed: RAPIER.Collider[] = [];
  private laid: RAPIER.Collider[] = [];
  private figures: Figure[] = [];
  /** the figures the server has counted down this go (one may be counted before its body has been made here) */
  private fell = new Set<number>();
  /** the go's clock is running: the server has been told the course stands */
  private begun = false;
  private sign: HTMLElement | null = null;
  private mats: { wall: THREE.Material; floor: THREE.Material } | null = null;
  private saidEnv = false;

  constructor(private h: BotCheckHost) {}

  /** how long since this go began, as this game counts it (thousandths of a second) */
  private get ms() {
    return Math.round(performance.now() - this.t0);
  }

  private material() {
    if (this.mats) return this.mats;
    const wall = assets.pbr('dirty_concrete'), floor = assets.pbr('concrete_floor_worn_001');
    const mat = (t: ReturnType<typeof assets.pbr>) => this.h.atmo.register(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, metalness: 0, roughness: 1 }));
    return (this.mats = { wall: mat(wall), floor: mat(floor) });
  }

  /** a static box of the course, its middle at (x, y, z) of the yard (y from the floor), turned `q` */
  private solid(w: number, h: number, d: number, x: number, y: number, z: number, q: THREE.Quaternion, into: RAPIER.Collider[]) {
    into.push(physics.addStaticQuat(physics.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2), 'concrete', { x, y: this.h.floor + y, z }, { x: q.x, y: q.y, z: q.z, w: q.w }));
  }

  /** The yard itself: its floor and the ring wall round it. Built once. */
  private async build() {
    const m = this.material(), y0 = this.h.floor, yard = new THREE.Group(), none = new THREE.Quaternion();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(YARD.r + YARD.thick + 0.5, 72).rotateX(-Math.PI / 2), m.floor);
    const uv = floor.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 15, uv.getY(k) * 15);
    floor.position.y = y0;
    floor.receiveShadow = true;
    yard.add(floor);
    this.solid((YARD.r + 2) * 2, 1, (YARD.r + 2) * 2, 0, -0.5, 0, none, this.fixed);
    // (the ring: pieces of wall set round the yard, each a little longer than its share so that they meet)
    const mid = YARD.r + YARD.thick / 2, len = ((2 * Math.PI * mid) / RING_PIECES) * 1.04;
    for (let k = 0; k < RING_PIECES; k++) {
      const a = (k / RING_PIECES) * Math.PI * 2, x = Math.sin(a) * mid, z = Math.cos(a) * mid, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const piece = new THREE.Mesh(slab(len, YARD.ring, YARD.thick), m.wall);
      piece.position.set(x, y0 + YARD.ring / 2, z);
      piece.quaternion.copy(q);
      piece.castShadow = piece.receiveShadow = true;
      yard.add(piece);
      this.solid(len, YARD.ring, YARD.thick, x, YARD.ring / 2, z, q, this.fixed);
    }
    await this.h.ready(yard).catch(() => {});
    this.h.scene.add(yard);
    this.yard = yard;
  }

  /** The course's walls, hut, catwalk and blocks, turned as the server turned them, in place of the last go's. */
  private raise(turn: number) {
    this.lower();
    const m = this.material(), lay = new THREE.Group(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion().setFromAxisAngle(up, turn);
    lay.position.y = this.h.floor;
    lay.rotation.y = turn;
    for (const b of BLOCKS) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const mesh = new THREE.Mesh(slab(w, h, d), m.wall);
      mesh.position.set(cx, (b.y0 + b.y1) / 2, cz);
      mesh.castShadow = mesh.receiveShadow = true;
      lay.add(mesh);
      const [x, z] = fromPlan(turn, cx, cz);
      this.solid(w, h, d, x, (b.y0 + b.y1) / 2, z, q, this.laid);
    }
    // (the ramp: a slab whose top is the slope from the floor up to the catwalk's deck)
    const run = RAMP.x1 - RAMP.x0, slope = Math.atan2(RAMP.top, run), long = Math.hypot(run, RAMP.top), thick = 0.3, wide = RAMP.z1 - RAMP.z0;
    const nx = Math.sin(slope), ny = Math.cos(slope), cx = (RAMP.x0 + RAMP.x1) / 2 - nx * (thick / 2), cy = RAMP.top / 2 - ny * (thick / 2), cz = (RAMP.z0 + RAMP.z1) / 2;
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -slope);
    const ramp = new THREE.Mesh(slab(long, thick, wide), m.wall);
    ramp.position.set(cx, cy, cz);
    ramp.quaternion.copy(tilt);
    ramp.castShadow = ramp.receiveShadow = true;
    lay.add(ramp);
    const [rx, rz] = fromPlan(turn, cx, cz);
    this.solid(long, thick, wide, rx, cy, rz, q.clone().multiply(tilt), this.laid);
    this.h.scene.add(lay);
    this.lay = lay;
  }

  private lower() {
    for (const c of this.laid) {
      physics.tags.delete(c.handle);
      physics.world.removeCollider(c, false);
    }
    this.laid.length = 0;
    if (this.lay) {
      this.lay.removeFromParent();
      this.lay.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.lay = null;
    }
  }

  /** A go has been dealt by the server: the course is built as it is turned, the figures made ready, and the player put at its middle. */
  async deal(turn: number, go: number, need: number, secs: number) {
    this.active = true;
    this.turn = turn;
    this.need = need;
    this.secs = secs;
    this.go = go;
    this.fell.clear();
    this.begun = false;
    this.t0 = performance.now();
    this.told = 0;
    if (!this.saidEnv) {
      this.saidEnv = true;
      this.h.send({ t: 'renv', ...browserSays() });
    }
    this.h.place(0, this.h.floor + 0.05, 0, turn);
    this.show();
    if (!this.yard) await this.build();
    if (!this.active || this.go !== go) return;
    this.raise(turn);
    for (const f of this.figures) f.stand();
    // (the figures are made the first time, one after another)
    const made: Promise<void>[] = [];
    for (let i = this.figures.length; i < need; i++) {
      const f = new Figure(i);
      this.figures.push(f);
      made.push(
        f.load(this.h.atmo, this.h.scene).then(() => {
          if (!this.active) f.dispose();
          else if (this.fell.has(i)) f.fall();
        }),
      );
    }
    // (The go's clock starts when the course stands and the figures are ready, and the server is told so: on a slow
    // machine that is some seconds. Not waited for longer than twelve.)
    await Promise.race([Promise.all(made), new Promise((r) => setTimeout(r, 12_000))]);
    // (nor before the player has their hands on the game: the check before this one took the mouse from them, and
    // a click gives it back. Not waited for longer than six seconds more.)
    for (let k = 0; k < 60 && this.active && !this.h.playing(); k++) await new Promise((r) => setTimeout(r, 100));
    if (!this.active || this.go !== go) return;
    this.t0 = performance.now();
    this.begun = true;
    this.h.send({ t: 'rgo', g: go });
  }

  /** The server says what is in the player's sight, and where. */
  sighted(f: Sighting[]) {
    if (!this.active || !this.begun) return;
    const now = performance.now();
    for (const [i, x, y, z, vx, vz, up] of f) {
      const fig = this.figures[i];
      if (fig) fig.said = { x, y, z, vx, vz, up: up === 1, at: now };
    }
  }

  /** Each frame on the course: the figures drawn, the server told, the sign kept. */
  update(dt: number) {
    if (!this.active) return;
    if (!this.begun) return void this.show();
    const now = performance.now();
    for (const f of this.figures) f.walk(this.h.floor, now, dt);
    const at = this.h.where();
    // (off the yard, by whatever way: back at its middle)
    if (at.y < this.h.floor - 3 || Math.hypot(at.x, at.z) > YARD.r + 2) this.h.place(0, this.h.floor + 0.05, 0, this.turn);
    if (now - this.told >= 1000 / TOLD_HZ) {
      this.told = now;
      this.tell(this.ms);
    }
    this.show();
  }

  /** where the player stands and looks, to the server */
  private tell(ms: number) {
    const at = this.h.where();
    this.h.camera.getWorldDirection(_v);
    this.h.send({ t: 'r', p: [+at.x.toFixed(3), +(at.y - this.h.floor).toFixed(3), +at.z.toFixed(3), +Math.atan2(-_v.x, -_v.z).toFixed(4), +Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1)).toFixed(4)], n: ms, g: this.go });
  }

  /** A shot the player fired: told to the server, from where and along what. */
  shot(origin: THREE.Vector3, dir: THREE.Vector3) {
    if (!this.active || !this.begun) return;
    const ms = this.ms;
    this.tell(ms - 1);
    this.h.send({ t: 'rs', o: [+origin.x.toFixed(3), +(origin.y - this.h.floor).toFixed(3), +origin.z.toFixed(3)], d: [+dir.x.toFixed(5), +dir.y.toFixed(5), +dir.z.toFixed(5)], n: ms, g: this.go });
  }

  /** The server has counted this figure down. */
  hit(i: number) {
    if (!this.active || this.fell.has(i)) return;
    this.fell.add(i);
    this.figures[i]?.fall();
    this.show();
  }

  /** what stands at the top of the screen while the course is on */
  private show(done = false) {
    const ui = document.getElementById('ui');
    if (!ui) return;
    // (On a phone, or any short screen, small and high, and the way to pass said only for the first seconds of each go:
    // at full size it hid a third of a phone's screen, the owner, 2026-10-15: "the banner is so big on mobile you cant
    // even play".)
    const small = TOUCH || innerHeight < 520;
    if (!this.sign) {
      this.sign = document.createElement('div');
      this.sign.style.cssText =
        `position:absolute;left:50%;top:${small ? '1.5vh' : '5.5vh'};transform:translateX(-50%);z-index:40;padding:${small ? '5px 14px' : '12px 22px'};text-align:center;pointer-events:none;background:rgba(12,13,11,0.82);border:1px solid rgba(243,239,230,0.25);` +
        `color:#f3efe6;font-family:"Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:0.1em;max-width:${small ? 'min(62vw,520px)' : 'min(92vw,760px)'};`;
      ui.appendChild(this.sign);
    }
    const left = Math.max(0, Math.ceil(this.secs - this.ms / 1000));
    const head = done ? 'Bot check passed' : !this.begun ? (this.h.playing() ? 'Bot check · setting up the course' : 'Bot check · click to begin') : `Bot check · ${this.fell.size} of ${this.need} down · ${left} s`;
    const how = `Bring down all ${this.need} figures, all round you: behind the walls, in the hut, beyond the catwalk. Walk the yard to find them, and hold your sights on each before you fire.`;
    const sub = done ? 'Going in.' : this.go > 1 ? `Not passed. A new course: go ${this.go} of 4. ${how}` : how;
    const told = !small || done || !this.begun || this.ms < 6000;
    const html = `<div style="font-size:${small ? 15 : 24}px;font-weight:700;color:${done ? '#9fe08a' : '#ffd35a'}">${head}</div>${told ? `<div style="margin-top:${small ? 2 : 4}px;font-size:${small ? 11 : 15}px;font-weight:500;color:#d8cfb8;letter-spacing:0.06em;line-height:1.25">${sub}</div>` : ''}`;
    if (this.sign.dataset.said !== html) {
      this.sign.dataset.said = html;
      this.sign.innerHTML = html;
    }
  }

  /** Passed: said for a moment, as the course is taken away. */
  passed() {
    if (this.sign) this.show(true);
  }

  /** The course is over, passed or not: everything of it is taken out of the world. */
  end() {
    if (!this.active && !this.yard && !this.sign) return;
    this.active = false;
    this.lower();
    for (const c of this.fixed) {
      physics.tags.delete(c.handle);
      physics.world.removeCollider(c, false);
    }
    this.fixed.length = 0;
    if (this.yard) {
      this.yard.removeFromParent();
      this.yard.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.yard = null;
    }
    for (const f of this.figures) f.dispose();
    this.figures.length = 0;
    const sign = this.sign;
    this.sign = null;
    this.saidEnv = false;
    if (sign) setTimeout(() => sign.remove(), 1200);
  }
}

/** What this browser says of itself, for the server: whether a program is driving it, and what it draws with. */
function browserSays(): { wd: boolean; gl: string } {
  let gl = '';
  try {
    const c = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    gl = String((ext && c?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || c?.getParameter(c.RENDERER) || '').slice(0, 160);
  } catch {
    /* said as nothing */
  }
  return { wd: (navigator as unknown as { webdriver?: boolean }).webdriver === true, gl };
}
