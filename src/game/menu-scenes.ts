// What goes on behind the menu before a game is started: the Zone itself, with things
// happening in it. A survivor run down the village street by the infected; two pairs trading
// shots along the road; a rifleman holding a pack of them off; a masked man going in at the
// gate of the works; the big pistol and the shotgun, each close enough to be looked at; and between
// them, the squad's map on its table, a corner at a time (a film: see src/dev/poster.ts). They are the game's own bodies in the game's own world, moved by a few
// lines each (nobody is playing them, and nothing they do counts): one scene is shown for a
// few seconds, then the next, with the view from the air over the village between rounds.
//
// Nothing here makes a sound (a browser plays none until it is clicked on, and a menu that
// fired rifles would not be thanked for it), and all of it is taken away when a game starts.

import * as THREE from 'three';
import { TOUCH } from '../core/device';
import { GAS, gasZone } from '../sim/gas';
import type { Atmosphere } from '../world/atmosphere';
import { heightAt, type World } from '../world/worldgen';
import { Avatar } from './avatar';
import type { Effects } from './effects';
import type { Grips } from './arms';
import { ZOMBIES, lookFor } from './look';

export interface MenuHost {
  world: World;
  atmo: Atmosphere;
  scene: THREE.Scene;
  effects: Effects;
  /** a weapon as it is seen in somebody's hands */
  held(id: string, mods: string[]): { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee' } | null;
  /** what a body has on: helmet, vest, pack, mask */
  wear(body: Avatar, ids: string[]): Promise<void>;
  /** the film of the map is there to be shown (it comes over the wire like anything else) */
  filmReady(): boolean;
}

interface View { p: THREE.Vector3; l: THREE.Vector3; fov: number }
interface Vignette {
  /** said in the corner of the menu while it is shown */
  caption: string;
  seconds: number;
  setup(): void;
  tick(t: number, dt: number): void;
  view(t: number): View;
  /** not a scene in the world but a stretch of the film of the map: the second of it this one begins at */
  film?: number;
}

/** somebody in a scene: where they are, which way they face, and what they are doing */
class Extra {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouch = false;
  aim = false;
  dead = false;
  on = false;
  /** seconds until its next shot */
  nextShot = 0;
  /** a suppressor on it: no flash to speak of */
  quiet = false;
  /** what it can be given to hold, by name ('own': what it came with), and which of them it holds now */
  kits = new Map<string, { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee'; quiet: boolean }>();
  kit = '';
  constructor(readonly body: Avatar, public weapon: 'rifle' | 'pistol' | null, readonly sick: boolean) {}

  /** the way it faces, along the ground */
  fwd(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  face(x: number, z: number) {
    this.yaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
  }
  /** where the end of its barrel is */
  muzzle(out = new THREE.Vector3()) {
    const real = this.body.muzzle(out);
    if (real) return real.pos;
    const f = this.fwd(out);
    const up = this.crouch ? 1.02 : 1.5, reach = this.weapon === 'rifle' ? 0.95 : 0.62;
    return out.set(this.pos.x + f.x * reach - f.z * 0.08, this.pos.y + up, this.pos.z + f.z * reach + f.x * 0.08);
  }
  chest(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + (this.crouch ? 0.8 : 1.25), this.pos.z);
  }
}

const CUT = { out: 0.4, in: 0.55 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class MenuScenes {
  /** what is being shown, in words ('' while it is the view from the air) */
  caption = '';
  /** how far the picture is faded to black for a cut, 0..1 */
  fade = 0;
  /** the second of the film of the map that is to be on the screen (-1: none of it, the world is) */
  film = -1;
  private ready = false;
  private gone = false;
  private men: Extra[] = [];
  private sick: Extra[] = [];
  private list: Vignette[] = [];
  private at = -1;
  private t = 0;
  /** seconds of the view from the air still to run before the next round of scenes */
  private air = 3.5;
  private rp: Float32Array;
  private mid = 0;

  constructor(private h: MenuHost) {
    this.rp = h.world.road.points;
    const c = h.world.pois[0];
    for (let i = 0; i < this.rp.length / 3; i++) if (Math.hypot(this.rp[i * 3] - c.x, this.rp[i * 3 + 2] - c.z) < Math.hypot(this.rp[this.mid * 3] - c.x, this.rp[this.mid * 3 + 2] - c.z)) this.mid = i;
  }

  /** The cast is brought in (their bodies take a moment to arrive): until then the menu has the view from the air. */
  async load() {
    const { atmo, scene } = this.h;
    // four survivors, each kitted a little differently, and what they carry
    const kits: [string, 'rifle' | 'pistol', string, string[]][] = [
      ['Volkov', 'pistol', 'm9', ['sack_pack']],
      ['Mira', 'rifle', 'mosin', ['boonie_hat', 'life_vest']],
      ['Sable', 'pistol', 'm9', ['boonie_hat', 'life_vest', 'sack_pack', 'gasmask']],
      ['Kestrel', 'rifle', 'mosin', ['life_vest', 'sack_pack']],
    ];
    for (const [name, kind, weapon, gear] of kits) {
      const body = new Avatar();
      await body.load(atmo, 0, false, lookFor(name));
      if (this.gone) return body.dispose();
      await this.h.wear(body, gear);
      body.root.visible = false;
      scene.add(body.root);
      const man = new Extra(body, kind, false);
      // (the masked man's pistol carries all three of the things a pistol takes: the suppressor, the sight and the light)
      const own = this.h.held(weapon, weapon === 'mosin' ? ['pu_scope'] : gear.includes('gasmask') ? ['suppressor_9', 'red_dot', 'gun_light'] : []);
      if (own) man.kits.set('own', { ...own, quiet: gear.includes('gasmask') });
      // (two of them are also handed what is new, for the scenes that show it: the big pistol, which takes nothing
      // on it but a longer magazine, and the shotgun with its sight and its light)
      const also = name === 'Volkov' ? this.h.held('deagle', []) : name === 'Kestrel' ? this.h.held('benelli', ['red_dot', 'gun_light']) : null;
      if (also) man.kits.set(name === 'Volkov' ? 'deagle' : 'benelli', { ...also, quiet: false });
      this.arm(man);
      this.men.push(man);
    }
    for (let k = 0; k < (TOUCH ? 3 : 5); k++) {
      const body = new Avatar();
      await body.load(atmo, 0, false, lookFor(''), ZOMBIES[k % ZOMBIES.length]);
      if (this.gone) return body.dispose();
      body.sick = { roused: 1, claw: -1, seed: (k * 7.31) % 20 };
      body.root.visible = false;
      scene.add(body.root);
      this.sick.push(new Extra(body, null, true));
    }
    // (between the scenes, the map on its table: a corner of it at a time, as the film has them)
    const map = (caption: string, from: number, to: number): Vignette => ({ caption, seconds: to - from, film: from, setup: () => {}, tick: () => {}, view: () => ({ p: _a, l: _b, fov: 40 }) });
    this.list = [
      this.chase(),
      map('The squad’s map · what they are going on', 0.2, 3.75),
      this.firefight(),
      map('The squad’s map · the keycard is in the gas', 3.95, 7.5),
      this.sidearm(),
      map('The squad’s map · Bunker 17', 7.7, 11.25),
      this.stand(),
      this.shotgun(),
      map('The squad’s map · trust nobody at the door', 11.4, 13.1),
      this.works(),
    ].filter((v): v is Vignette => !!v);
    this.ready = this.list.length > 0;
  }

  /** A game is starting: everybody off. */
  dispose() {
    this.gone = true;
    this.ready = false;
    this.caption = '';
    this.fade = 0;
    this.film = -1;
    for (const e of [...this.men, ...this.sick]) e.body.dispose();
    this.men = [];
    this.sick = [];
  }

  // ------------------------------------------------------------ places

  private ground(x: number, z: number) {
    return heightAt(this.h.world.heights, x, z);
  }
  /** a place on the road so many metres along it from the middle of the village, and which way the road runs there */
  private road(metres: number) {
    const rp = this.rp, n = rp.length / 3;
    const P = (i: number, out: THREE.Vector3) => out.set(rp[i * 3], 0, rp[i * 3 + 2]);
    let i = this.mid, left = Math.abs(metres);
    const step = metres >= 0 ? 1 : -1;
    const at = new THREE.Vector3();
    P(i, at);
    while (left > 0 && i + step >= 0 && i + step < n) {
      const d = P(i, _a).distanceTo(P(i + step, _b));
      if (d >= left) {
        at.copy(_a).lerp(_b, left / d);
        break;
      }
      left -= d;
      i += step;
      at.copy(_b);
    }
    const t = P(Math.min(n - 1, i + 1), new THREE.Vector3()).sub(P(Math.max(0, i - 1), _a)).normalize();
    at.y = this.ground(at.x, at.z);
    return { at, t, n: new THREE.Vector3(t.z, 0, -t.x) };
  }
  /** what it holds: its own, unless a scene hands it something else */
  private arm(e: Extra, key = 'own') {
    const k = e.kits.get(key);
    if (!k || e.kit === key) return;
    // (at once: each of these scenes is cut to)
    e.body.setHeld(k.obj, k.grips, k.kind, true);
    e.kit = key;
    e.weapon = k.kind === 'pistol' ? 'pistol' : 'rifle';
    e.quiet = k.quiet;
  }
  private put(e: Extra, x: number, z: number, yaw: number) {
    this.arm(e);
    e.pos.set(x, this.ground(x, z), z);
    e.vel.set(0, 0, 0);
    e.yaw = yaw;
    e.pitch = 0;
    e.crouch = e.aim = e.dead = false;
    e.on = true;
    e.nextShot = 0;
    e.body.clearWounds();
    if (e.body.sick) e.body.sick.claw = -1;
    // (a body that fell in the last scene is stood up before it is seen again)
    e.body.update(0.05, e.pos, e.vel, e.yaw, false, false);
  }
  /** on its feet toward a place at so many metres a second */
  private go(e: Extra, x: number, z: number, speed: number, dt: number) {
    const dx = x - e.pos.x, dz = z - e.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05 || e.dead) return e.vel.set(0, 0, 0);
    const s = Math.min(speed, d / Math.max(dt, 1e-3));
    e.vel.set((dx / d) * s, 0, (dz / d) * s);
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    e.pos.y = this.ground(e.pos.x, e.pos.z);
    const want = Math.atan2(-dx, -dz);
    e.yaw += Math.atan2(Math.sin(want - e.yaw), Math.cos(want - e.yaw)) * Math.min(1, dt * 8);
  }
  /** a shot: the flash of it, and (if it is meant to land) what it does to whoever it is at */
  private fire(from: Extra, at: Extra | null) {
    const m = from.muzzle(_a);
    const dir = at ? at.chest(_b).sub(m).normalize() : from.fwd(_b);
    this.h.effects.muzzle(m, dir, from.weapon === 'rifle', from.quiet, from.quiet ? 0 : from.weapon === 'rifle' ? 0.42 : 0.2);
    if (!at || at.dead) return;
    const hit = at.chest(_c);
    hit.y += at.sick ? 0.3 : 0.1;
    this.h.effects.bleed(hit, dir, 1);
    at.body.wound(hit, dir, 0.07, true);
    at.body.setDeath(Math.abs(Math.sin(at.yaw) * dir.x + Math.cos(at.yaw) * dir.z) > 0.4 ? (-Math.sin(at.yaw) * dir.x - Math.cos(at.yaw) * dir.z > 0 ? 1 : 0) : 2);
    at.dead = true;
    at.vel.set(0, 0, 0);
  }
  /**
   * A lens that keeps what it is looking at in the right-hand part of the picture: the menu
   * has the left. (`right` is how far over, as a part of half the picture's width.)
   */
  private lens(p: THREE.Vector3, subject: THREE.Vector3, fov: number, right = 0.3): View {
    const to = _a.copy(subject).sub(p), dist = to.length();
    const side = _b.set(-to.z, 0, to.x).normalize();
    const half = Math.tan((fov * Math.PI) / 360) * (innerWidth / Math.max(1, innerHeight));
    return { p, l: subject.clone().addScaledVector(side, -right * dist * half), fov };
  }

  // ------------------------------------------------------------ the scenes

  /** Down the village street: one man running, and what is after him. */
  private chase(): Vignette {
    const from = 46;
    let run = 0;
    const man = this.men[0];
    return {
      caption: 'Zelenaya Dolina · the infected run a survivor down',
      seconds: 8.5,
      setup: () => {
        run = 0;
        const a = this.road(from);
        this.put(man, a.at.x, a.at.z, Math.atan2(-a.t.x, -a.t.z));
        this.sick.forEach((z, k) => {
          const b = this.road(from - 2.8 - k * 1.5);
          const off = ((k % 3) - 1) * 1.25;
          this.put(z, b.at.x + b.n.x * off, b.at.z + b.n.z * off, Math.atan2(-b.t.x, -b.t.z));
        });
      },
      tick: (_t, dt) => {
        run += 3.75 * dt;
        const a = this.road(from + run + 2);
        this.go(man, a.at.x, a.at.z, 3.75, dt);
        this.sick.forEach((z, k) => {
          const off = ((k % 3) - 1) * 0.9;
          this.go(z, man.pos.x + a.n.x * off, man.pos.z + a.n.z * off, 3.3, dt);
        });
      },
      view: () => {
        // ahead of him and a little off the road, going with him: he has the middle of the
        // picture, and what is behind him the right of it
        const a = this.road(from + run + 5);
        const p = a.at.clone().addScaledVector(a.n, 2.5);
        p.y = Math.max(a.at.y, this.ground(p.x, p.z)) + 1.2;
        return this.lens(p, man.pos.clone().setY(man.pos.y + 1.2), 44, 0.2);
      },
    };
  }

  /** Along the road out of the village: two against two, at forty metres. */
  private firefight(): Vignette {
    const here = this.road(-112), there = this.road(-140);
    const [a, b, c, d] = [this.men[1], this.men[0], this.men[3], this.men[2]];
    const order: [Extra, Extra][] = [[a, c], [c, a], [b, d], [d, b]];
    let down = false;
    return {
      caption: 'The west road · two against two',
      seconds: 9,
      setup: () => {
        down = false;
        const toThem = Math.atan2(-(there.at.x - here.at.x), -(there.at.z - here.at.z));
        // (the near pair to the right of the road as it is looked down; the far pair on it)
        this.put(a, here.at.x + here.n.x * 1.2, here.at.z + here.n.z * 1.2, toThem);
        this.put(b, here.at.x + here.n.x * 2.5 - here.t.x * 1.1, here.at.z + here.n.z * 2.5 - here.t.z * 1.1, toThem);
        this.put(c, there.at.x - there.n.x * 0.8, there.at.z - there.n.z * 0.8, toThem + Math.PI);
        this.put(d, there.at.x + there.n.x * 1.9, there.at.z + there.n.z * 1.9, toThem + Math.PI);
        a.crouch = c.crouch = true;
        order.forEach(([who], k) => {
          who.aim = true;
          who.nextShot = 0.5 + k * 0.37;
        });
      },
      tick: (t, dt) => {
        for (const [who, at] of order) {
          if (who.dead) continue;
          who.face(at.pos.x, at.pos.z);
          who.nextShot -= dt;
          if (who.nextShot > 0) continue;
          // (most of them miss: one of the far pair is hit two thirds of the way through)
          const kills = !down && t > 5.6 && who === a;
          this.fire(who, kills ? at : null);
          if (kills) down = true;
          who.nextShot = (who.weapon === 'rifle' ? 1.5 : 0.55) + ((t * 7.3 + who.pos.x) % 0.6);
        }
      },
      view: (t) => {
        // well behind the near pair, through a long lens: their backs at the right of the
        // picture, and the two they are shooting at down the road in the middle of it
        const k = t / 9;
        const p = here.at.clone().addScaledVector(here.t, 9 - k * 0.9).addScaledVector(here.n, 0.3 - k * 0.5);
        p.y = Math.max(here.at.y, this.ground(p.x, p.z)) + 1.62;
        return this.lens(p, there.at.clone().addScaledVector(there.n, 0.5).setY(there.at.y + 1.05), 30, 0.26);
      },
    };
  }

  /** One rifle against the pack: he holds his ground and they come on. */
  private stand(): Vignette {
    const here = this.road(118);
    const man = this.men[3];
    let last = -9;
    return {
      caption: 'The east road · one rifle, and the infected coming on',
      seconds: 9,
      setup: () => {
        last = -9;
        this.put(man, here.at.x, here.at.z, Math.atan2(-here.t.x, -here.t.z));
        man.aim = true;
        this.sick.forEach((z, k) => {
          const b = this.road(118 + 15 + k * 4.2);
          const off = ((k % 3) - 1) * 1.7;
          this.put(z, b.at.x + b.n.x * off, b.at.z + b.n.z * off, Math.atan2(b.t.x, b.t.z));
        });
      },
      tick: (t, dt) => {
        const coming = this.sick.filter((z) => !z.dead).sort((p, q) => p.pos.distanceToSquared(man.pos) - q.pos.distanceToSquared(man.pos));
        for (const z of coming) this.go(z, man.pos.x, man.pos.z, 3.3, dt);
        const next = coming[0];
        if (!next) return;
        man.face(next.pos.x, next.pos.z);
        // (the bolt has to be worked between shots: one every second and a bit, the nearest first)
        if (t > 0.9 && t - last > 1.35 && next.pos.distanceTo(man.pos) < 16) {
          last = t;
          this.fire(man, next);
          man.body.act('bolt', 0.95);
        }
      },
      view: (t) => {
        // behind his shoulder, down the road at them
        const k = t / 9;
        const p = here.at.clone().addScaledVector(here.t, -3.4 + k * 0.4).addScaledVector(here.n, 0.9);
        p.y = Math.max(here.at.y, this.ground(p.x, p.z)) + 1.72;
        return this.lens(p, here.at.clone().addScaledVector(here.t, 14).setY(here.at.y + 1.2), 44, 0.21);
      },
    };
  }

  /** The big pistol, close: one man on the street, and two of them coming. */
  private sidearm(): Vignette | null {
    const man = this.men[0];
    if (!man.kits.has('deagle')) return null;
    const here = this.road(-34);
    const two = this.sick.slice(0, 2);
    let last = -9;
    return {
      caption: 'New · Desert Eagle .50 · the hardest-hitting pistol in the Zone',
      seconds: 7.5,
      setup: () => {
        last = -9;
        this.put(man, here.at.x, here.at.z, Math.atan2(-here.t.x, -here.t.z));
        this.arm(man, 'deagle');
        man.aim = true;
        two.forEach((z, k) => {
          const b = this.road(-34 + 18 + k * 7);
          const off = k ? -1.2 : 1;
          this.put(z, b.at.x + b.n.x * off, b.at.z + b.n.z * off, Math.atan2(b.t.x, b.t.z));
        });
      },
      tick: (t, dt) => {
        const coming = two.filter((z) => !z.dead).sort((p, q) => p.pos.distanceToSquared(man.pos) - q.pos.distanceToSquared(man.pos));
        for (const z of coming) this.go(z, man.pos.x, man.pos.z, 2.9, dt);
        const next = coming[0];
        if (!next) return;
        man.face(next.pos.x, next.pos.z);
        if (t > 1.9 && t - last > 2 && next.pos.distanceTo(man.pos) < 13) {
          last = t;
          this.fire(man, next);
        }
      },
      view: (t) => {
        // a pace off his right hand and a little ahead of it, looking back along the gun: the pistol has the
        // right of the picture, and what he is shooting at is behind the menu
        const f = man.fwd(new THREE.Vector3()), r = new THREE.Vector3(-f.z, 0, f.x);
        const p = man.pos.clone().addScaledVector(r, 1.0 - t * 0.02).addScaledVector(f, 1.0).setY(man.pos.y + 1.56);
        return this.lens(p, man.pos.clone().addScaledVector(f, 0.52).setY(man.pos.y + 1.47), 34, 0.34);
      },
    };
  }

  /** The shotgun, from the side: he stands, they come, and it goes off as fast as he can pull. */
  private shotgun(): Vignette | null {
    const man = this.men[3];
    if (!man.kits.has('benelli')) return null;
    const here = this.road(64);
    const three = this.sick.slice(0, 3);
    let last = -9;
    return {
      caption: 'New · Benelli M3 · holographic sight, and a light under the barrel',
      seconds: 8,
      setup: () => {
        last = -9;
        this.put(man, here.at.x, here.at.z, Math.atan2(-here.t.x, -here.t.z));
        this.arm(man, 'benelli');
        man.aim = true;
        three.forEach((z, k) => {
          const b = this.road(64 + 15 + k * 5.5);
          const off = ((k % 3) - 1) * 1.3;
          this.put(z, b.at.x + b.n.x * off, b.at.z + b.n.z * off, Math.atan2(b.t.x, b.t.z));
        });
      },
      tick: (t, dt) => {
        const coming = three.filter((z) => !z.dead).sort((p, q) => p.pos.distanceToSquared(man.pos) - q.pos.distanceToSquared(man.pos));
        for (const z of coming) this.go(z, man.pos.x, man.pos.z, 3.2, dt);
        const next = coming[0];
        if (!next) return;
        man.face(next.pos.x, next.pos.z);
        // (it loads itself: a shot a second, and none of them thrown away at more than ten paces)
        if (t > 1.5 && t - last > 1.15 && next.pos.distanceTo(man.pos) < 9) {
          last = t;
          this.fire(man, next);
        }
      },
      view: (t) => {
        // from his right, side on: the length of the gun across the right of the picture
        const f = new THREE.Vector3(here.t.x, 0, here.t.z), r = new THREE.Vector3(-f.z, 0, f.x);
        const p = man.pos.clone().addScaledVector(r, 2.5).addScaledVector(f, 1.3 - t * 0.04).setY(man.pos.y + 1.42);
        return this.lens(p, man.pos.clone().addScaledVector(f, 0.75).setY(man.pos.y + 1.36), 36, 0.36);
      },
    };
  }

  /** In at the gate of the works, under the gas, with a mask on. */
  private works(): Vignette | null {
    const z = gasZone(this.h.world.pois, (x, zz) => this.ground(x, zz));
    const site = this.h.world.sites.find((s) => s.name === GAS.place);
    if (!z || !site) return null;
    // (the site's own "forward" is the way in: back out along the track)
    const f = new THREE.Vector3(Math.sin(site.rot), 0, Math.cos(site.rot)), r = new THREE.Vector3(Math.cos(site.rot), 0, -Math.sin(site.rot));
    const at = (right: number, fwd: number) => new THREE.Vector3(site.x + r.x * right + f.x * fwd, 0, site.z + r.z * right + f.z * fwd);
    const man = this.men[2];
    // [right, forward] of each of the infected: in from the gate, their backs to it
    const STOOD: [number, number][] = [[0.4, 60], [-1.6, 63.5], [5.5, 64], [-4.5, 69], [7, 70]];
    let shot = false;
    return {
      caption: 'The Chemical Works · gas: nobody goes in without a mask · suppressor, sight and light on his M9',
      seconds: 9,
      setup: () => {
        shot = false;
        const a = at(1.5, 67);
        this.put(man, a.x, a.z, Math.atan2(f.x, f.z));
        man.aim = true;
        this.sick.forEach((s, k) => {
          const b = at(STOOD[k][0], STOOD[k][1]);
          this.put(s, b.x, b.z, Math.atan2(f.x, f.z) + ((k * 1.7) % 1) - 0.5);
          s.body.sick!.roused = 0;
        });
      },
      tick: (t, dt) => {
        const a = at(1.5, 30);
        this.go(man, a.x, a.z, 1.5, dt);
        // they have not seen him: they shuffle on into the yard, the way they were facing
        this.sick.forEach((s, k) => {
          const b = at(STOOD[k][0], 20);
          this.go(s, b.x, b.z, 0.45, dt);
        });
        const near = this.sick[0];
        if (!shot && t > 5.4 && near && !near.dead) {
          shot = true;
          man.face(near.pos.x, near.pos.z);
          this.fire(man, near);
        }
      },
      view: (t) => {
        // inside the gate, low, looking back out at him as he comes up to it
        const p = at(2.1, 53 - t * 0.22);
        p.y = this.ground(p.x, p.z) + 1.3;
        return this.lens(p, man.pos.clone().setY(man.pos.y + 1.4), 36, 0.3);
      },
    };
  }

  // ------------------------------------------------------------ each frame

  /**
   * @returns whether a scene has the camera (if not, it is the caller's: the view from the air)
   */
  update(dt: number, cam: THREE.PerspectiveCamera): boolean {
    if (!this.ready) return false;
    dt = Math.min(dt, 0.05);
    if (this.at < 0) {
      // between rounds: the air, then into the first scene through a cut
      this.air -= dt;
      this.caption = '';
      this.fade = this.air < CUT.out ? 1 - Math.max(0, this.air) / CUT.out : Math.max(0, this.fade - dt / CUT.in);
      if (this.air > 0) return false;
      this.begin(0);
    }
    const v = this.list[this.at];
    this.t += dt;
    if (this.t >= v.seconds) {
      for (const e of [...this.men, ...this.sick]) {
        e.on = false;
        e.body.root.visible = false;
      }
      // (a stretch of the film that has not come over the wire yet is passed over)
      let k = this.at + 1;
      while (k < this.list.length && this.list[k].film !== undefined && !this.h.filmReady()) k++;
      if (k < this.list.length) this.begin(k);
      else {
        // the round is done: back up into the air for a while
        this.at = -1;
        this.air = 7;
        this.fade = 1;
        this.film = -1;
        return false;
      }
    }
    const now = this.list[this.at];
    this.caption = now.caption;
    this.fade = Math.max(1 - this.t / CUT.in, (this.t - (now.seconds - CUT.out)) / CUT.out, 0);
    if (now.film !== undefined) {
      // the film has the picture: nobody is on, and the camera stays where the last scene left it
      this.film = now.film + this.t;
      return true;
    }
    this.film = -1;
    now.tick(this.t, dt);
    for (const e of [...this.men, ...this.sick]) {
      e.body.root.visible = e.on;
      if (e.on) e.body.update(dt, e.pos, e.vel, e.yaw, e.crouch, e.dead, false, e.pitch, true, e.aim && !e.dead);
    }
    const view = now.view(this.t);
    cam.position.copy(view.p);
    cam.up.set(0, 1, 0);
    cam.lookAt(view.l);
    cam.fov = view.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return true;
  }

  private begin(k: number) {
    this.at = k;
    this.t = 0;
    for (const e of [...this.men, ...this.sick]) e.on = false;
    this.list[k].setup();
  }
}
