// The bot check, as the player meets it: a walled yard with a firing line, walls of cover down it, and figures
// walking to and fro behind them. The server deals it and the server judges it (src/sim/range.ts: read that first).
// Here it is built from the number the server sent, the figures are walked by the same reckoning the judge uses,
// and the server is told where the player stands and looks and what they fire. A figure goes down when the server
// says it has counted it, and not before: what the player's own game thinks it hit is a flinch and no more.
//
// The yard stands by itself high over the middle of the map, where nothing of the world is in the way. The player
// is alone in it: they are not in the world, and nobody is told of them, until the server says they have passed.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets } from '../core/assets';
import { physics, GLASS_GROUPS, HITBOX_GROUPS } from '../core/physics';
import type { Atmosphere } from '../world/atmosphere';
import type { C2S } from '../net/protocol';
import { BACK, STRIP, figureAt, rangeOf, type RangeSpec } from '../sim/range';
import { Avatar } from './avatar';
import { lookFor } from './look';
import type { Damageable, HitZone } from './weapons';

/** how far the yard reaches to either side and behind the player, and how high its walls stand */
const SIDE = STRIP.half + 1, BEHIND = STRIP.deep + 0.9, WALL = 4.2;
/** how often the server is told where the player stands and looks, a second */
const TOLD_HZ = 20;

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

/** One of the figures that walk the range: a body, and the places a shot lands on it. It is hurt by nothing: the server says when it is down. */
class Figure implements Damageable {
  readonly name = 'Range figure';
  readonly avatar = new Avatar();
  readonly pos = new THREE.Vector3();
  ready = false;
  down = false;
  private body!: RAPIER.RigidBody;
  private zones: RAPIER.Collider[] = [];
  private vel = new THREE.Vector3();
  private yaw = 0;

  constructor(private i: number) {}

  async load(atmo: Atmosphere, scene: THREE.Scene) {
    await this.avatar.load(atmo, 0, false, lookFor(`range figure ${this.i}`));
    scene.add(this.avatar.root);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const zone = (desc: RAPIER.ColliderDesc, z: HitZone) => {
      const c = physics.world.createCollider(desc.setCollisionGroups(HITBOX_GROUPS), this.body);
      physics.tag(c, { surface: 'flesh', owner: this, zone: z });
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

  walk(x: number, y: number, z: number, vx: number, dt: number) {
    if (!this.ready) return;
    if (!this.down) {
      this.pos.set(x, y, z);
      this.vel.set(vx, 0, 0);
      // (facing the way it walks: the game's own turn, where none is along -z)
      this.yaw = vx > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.body.setNextKinematicTranslation(this.pos);
    } else this.vel.set(0, 0, 0);
    this.avatar.update(dt, this.pos, this.vel, this.yaw, false, this.down);
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
    this.avatar.clearWounds();
    for (const c of this.zones) c.setEnabled(true);
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
  /** the player is put here, looking down the range */
  place(x: number, y: number, z: number): void;
  where(): THREE.Vector3;
  send(m: C2S): void;
  /** a thing made ready to be drawn before it is shown (Renderer.ready) */
  ready(o: THREE.Object3D): Promise<void>;
}

export class BotCheck {
  /** on the range now */
  active = false;
  private spec: RangeSpec | null = null;
  private go = 0;
  private t0 = 0;
  private told = 0;
  private yard: THREE.Group | null = null;
  private walls: THREE.Group | null = null;
  private fixed: RAPIER.Collider[] = [];
  private cover: RAPIER.Collider[] = [];
  private figures: Figure[] = [];
  /** the figures the server has counted down this go (one may be counted before its body has been made here) */
  private fell = new Set<number>();
  /** the go's clock is running: the server has been told the range stands */
  private begun = false;
  private sign: HTMLElement | null = null;
  private mats: { wall: THREE.Material; floor: THREE.Material } | null = null;
  private saidEnv = false;

  constructor(private h: BotCheckHost) {}

  /** how long since this range was dealt, as this game counts it (thousandths of a second) */
  private get ms() {
    return Math.round(performance.now() - this.t0);
  }

  private block(desc: RAPIER.ColliderDesc, x: number, y: number, z: number, into: RAPIER.Collider[], groups?: number) {
    const c = groups === undefined ? physics.addStatic(desc, 'concrete', { x, y: this.h.floor + y, z }) : physics.addStaticQuat(desc, 'concrete', { x, y: this.h.floor + y, z }, { x: 0, y: 0, z: 0, w: 1 }, undefined, groups);
    into.push(c);
  }

  /** The yard itself: its floor, the walls round it, and the line the player keeps behind. Built once. */
  private async build() {
    const R = physics.R, y0 = this.h.floor;
    const wall = assets.pbr('dirty_concrete'), floor = assets.pbr('concrete_floor_worn_001');
    const mat = (t: ReturnType<typeof assets.pbr>) => this.h.atmo.register(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, metalness: 0, roughness: 1 }));
    this.mats = { wall: mat(wall), floor: mat(floor) };
    const yard = new THREE.Group();
    const put = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(slab(w, h, d), m);
      mesh.position.set(x, y0 + y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      yard.add(mesh);
      this.block(R.ColliderDesc.cuboid(w / 2, h / 2, d / 2), x, y, z, this.fixed);
    };
    const deep = BACK + BEHIND, mid = (BEHIND - BACK) / 2;
    put(SIDE * 2 + 1, 1, deep + 1, 0, -0.5, mid, this.mats.floor);
    put(0.5, WALL, deep + 1, -SIDE - 0.25, WALL / 2, mid, this.mats.wall);
    put(0.5, WALL, deep + 1, SIDE + 0.25, WALL / 2, mid, this.mats.wall);
    put(SIDE * 2 + 1, WALL, 0.5, 0, WALL / 2, -BACK - 0.25, this.mats.wall);
    put(SIDE * 2 + 1, WALL, 0.5, 0, WALL / 2, BEHIND + 0.25, this.mats.wall);
    // (the line: a kerb to the knee, and over it nothing a shot is stopped by but that no player walks through)
    put(SIDE * 2, 0.55, 0.35, 0, 0.275, -0.75, this.mats.wall);
    this.block(R.ColliderDesc.cuboid(SIDE, WALL / 2, 0.1), 0, WALL / 2, -0.75, this.fixed, GLASS_GROUPS);
    await this.h.ready(yard).catch(() => {});
    this.h.scene.add(yard);
    this.yard = yard;
  }

  /** The walls of cover of the range that has been dealt, in place of the last one's. */
  private raise(spec: RangeSpec) {
    this.lower();
    const R = physics.R, walls = new THREE.Group();
    for (const c of spec.cover) {
      const mesh = new THREE.Mesh(slab(c.w, c.h, c.d), this.mats!.wall);
      mesh.position.set(c.x, this.h.floor + c.h / 2, c.z);
      mesh.castShadow = mesh.receiveShadow = true;
      walls.add(mesh);
      this.block(R.ColliderDesc.cuboid(c.w / 2, c.h / 2, c.d / 2), c.x, c.h / 2, c.z, this.cover);
    }
    this.h.scene.add(walls);
    this.walls = walls;
  }

  private lower() {
    for (const c of this.cover) {
      physics.tags.delete(c.handle);
      physics.world.removeCollider(c, false);
    }
    this.cover.length = 0;
    if (this.walls) {
      this.walls.removeFromParent();
      this.walls.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.walls = null;
    }
  }

  /** A range has been dealt by the server: it is built, the figures are stood up, and the player is put at its start. */
  async deal(seed: number, turn: number, go: number) {
    this.active = true;
    this.spec = rangeOf(seed, turn);
    this.go = go;
    this.fell.clear();
    this.begun = false;
    this.t0 = performance.now();
    this.told = 0;
    if (!this.saidEnv) {
      this.saidEnv = true;
      this.h.send({ t: 'renv', ...browserSays() });
    }
    this.h.place(STRIP.start[0], this.h.floor + 0.05, STRIP.start[1]);
    this.show();
    if (!this.yard) await this.build();
    if (!this.active || !this.spec || this.spec.seed !== seed) return;
    this.raise(this.spec);
    for (const f of this.figures) f.stand();
    // (the figures are made the first time, one after another)
    const made: Promise<void>[] = [];
    for (let i = this.figures.length; i < this.spec.figures.length; i++) {
      const f = new Figure(i);
      this.figures.push(f);
      made.push(
        f.load(this.h.atmo, this.h.scene).then(() => {
          if (!this.active) f.dispose();
          else if (this.fell.has(i)) f.fall();
        }),
      );
    }
    // (The go's clock starts when the range stands and the figures are on it, and the server is told so: on a
    // slow machine that is some seconds, which were coming off the forty. Not waited for longer than twelve.)
    await Promise.race([Promise.all(made), new Promise((r) => setTimeout(r, 12_000))]);
    if (!this.active || !this.spec || this.spec.seed !== seed || this.go !== go) return;
    this.t0 = performance.now();
    this.begun = true;
    this.h.send({ t: 'rgo', g: go });
  }

  /** Each frame on the range: the figures walked, the server told, the sign kept. */
  update(dt: number) {
    const spec = this.spec;
    if (!this.active || !spec) return;
    if (!this.begun) return void this.show();
    const ms = this.ms;
    spec.figures.forEach((f, i) => {
      const p = figureAt(f, ms);
      this.figures[i]?.walk(p.x, this.h.floor, p.z, p.vx, dt);
    });
    const at = this.h.where();
    // (off the yard, by whatever way: back at the start)
    if (at.y < this.h.floor - 3 || Math.abs(at.x) > SIDE + 2 || at.z < -BACK - 2 || at.z > BEHIND + 2) this.h.place(STRIP.start[0], this.h.floor + 0.05, STRIP.start[1]);
    const now = performance.now();
    if (now - this.told >= 1000 / TOLD_HZ) {
      this.told = now;
      this.tell(ms);
    }
    this.show();
  }

  /** where the player stands and looks, to the server */
  private tell(ms: number) {
    const at = this.h.where();
    this.h.camera.getWorldDirection(_v);
    this.h.send({ t: 'r', p: [+at.x.toFixed(3), +at.z.toFixed(3), +Math.atan2(-_v.x, -_v.z).toFixed(4), +Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1)).toFixed(4)], n: ms, g: this.go });
  }

  /** A shot the player fired: told to the server, from where and along what. */
  shot(origin: THREE.Vector3, dir: THREE.Vector3) {
    if (!this.active || !this.spec || !this.begun) return;
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

  /** what stands at the top of the screen while the range is on */
  private show(done = false) {
    const ui = document.getElementById('ui');
    if (!ui) return;
    if (!this.sign) {
      this.sign = document.createElement('div');
      this.sign.style.cssText =
        'position:absolute;left:50%;top:5.5vh;transform:translateX(-50%);z-index:40;padding:12px 22px;text-align:center;pointer-events:none;background:rgba(12,13,11,0.82);border:1px solid rgba(243,239,230,0.25);' +
        'color:#f3efe6;font-family:"Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:0.1em;';
      ui.appendChild(this.sign);
    }
    const need = this.spec?.need ?? 3, left = Math.max(0, Math.ceil((this.spec?.secs ?? 40) - this.ms / 1000));
    const head = done ? 'Bot check passed' : !this.begun ? 'Bot check · setting up the range' : `Bot check · ${this.fell.size} of ${need} down · ${left} s`;
    const sub = done ? 'Going in.' : this.go > 1 ? `Not passed. A new range: go ${this.go} of 4. Bring down ${need} of the figures that walk behind the walls: move along the line to find them.` : `Bring down ${need} of the figures that walk behind the walls. Move along the line to find them.`;
    const html = `<div style="font-size:24px;font-weight:700;color:${done ? '#9fe08a' : '#ffd35a'}">${head}</div><div style="margin-top:4px;font-size:15px;font-weight:500;color:#d8cfb8;letter-spacing:0.06em">${sub}</div>`;
    if (this.sign.dataset.said !== html) {
      this.sign.dataset.said = html;
      this.sign.innerHTML = html;
    }
  }

  /** Passed: said for a moment, as the range is taken away. */
  passed() {
    if (this.sign) this.show(true);
  }

  /** The range is over, passed or not: everything of it is taken out of the world. */
  end() {
    if (!this.active && !this.yard && !this.sign) return;
    this.active = false;
    this.spec = null;
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
