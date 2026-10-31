// What goes on behind the menu before a game is started: the Zone itself, with things happening in it. A survivor
// run down the village street by the infected; a case going under the ground in a wood; a rifle walked down the
// hospital's long ward; a light carried into the bunker; each of the guns close enough to be looked at. They are
// the game's own bodies in the game's own world, moved by a few lines each (nobody is playing them, and nothing
// they do counts): one scene is shown for a few seconds, then the next, with the view from the air over the
// village between rounds.
//
// THE TABLE. Every scene is one row of `MenuScenes.TABLE`, near the foot of this file, and one function that makes
// it. To add a scene:
//   1. write a function beside the others that returns a `Vignette` (or null where the map has not what it needs):
//      who is in it and where (`setup`), what they do (`tick`), where the lens is (`view`), and one caption that
//      says a plain thing about the game which can be checked;
//   2. add its row to the table: an `id` that is never changed afterwards (it is what a visitor's browser remembers
//      having been shown), `added`, the day what it shows came to the game (the changelog's date), and whether a
//      phone is shown it.
// Nothing else is touched: the order of showing, the "New" before a caption and the list a phone gets all come out
// of the table. Where a row stands in it is where the scene comes in an ordinary round, so put it between two that
// are not like it (a fight, then a place; no two guns seen close one after the other). A scene that shows a thing
// from a pace off names it in `close`, and one that wants smoke standing before it is cut to makes it in `early`.
// `bury` is one set where the map is searched for a place, `ward` one set in a room, `bunker` one with a lamp.
//
// NEW SINCE THE LAST VISIT. A browser keeps which scenes it has been shown and when it was last here. The scenes
// it has not been shown are played first, the newest first, and "New" is said before the caption of each that
// came to the game since that visit, or within the last fortnight; somebody who has seen them all has the ordinary
// round and no "New". The rule and the remembering are ./menu-order.ts (`menuOrder`, `KEPT`), which has nothing of
// the game in it and is tested by test/menu-order.test.ts. So the menu changes with the game: what an update adds
// is the first thing whoever comes back is shown.
//
// FULL QUALITY. All of it is played live. (Three recorded films used to take turns with the scenes: beside the
// game itself their compression showed, and they were taken out. 2026-10-13: "i want it to all be in game footage
// high quality".) And what a scene shows from close to is painted with its pictures at the size they came, as the
// gun in a player's own hands is (`Vignette.close`): the world's lighter copy of a gun, which is what everything
// not in somebody's hands is drawn with, was what made the scenes of the guns look worse than the game.
//
// A PLACE IS READ, NOT GUESSED. Where a scene is set is worked out from the world (its buildings and their plans,
// its fireplaces, its trees), and what a lens is carried along, or a body walked along, is asked of the game's own
// solid things before it is shown (`clear`, `room`): a scene whose way is not open is left out, and says why in a
// development console. In development `window.__menu` shows one scene by its id, or holds the lens at a place.
//
// Nothing here makes a sound (a browser plays none until it is clicked on, and a menu that fired rifles would not
// be thanked for it), and all of it is taken away when a game starts.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { breathe } from '../core/breathe';
import { TOUCH } from '../core/device';
import { SIGHT_GROUPS, physics } from '../core/physics';
import { BUNKER, bunkerAt, bunkerLocal } from '../sim/bunker';
import { fireSpots } from '../sim/fires';
import { GAS, gasZone } from '../sim/gas';
import { BURY, noBurying } from '../sim/stash';
import type { Atmosphere } from '../world/atmosphere';
import { hospitalPlan } from '../world/big-buildings';
import { SNOW, bunkerPlace, heightAt, idx, sampleOf, type BuildingPlot, type BuildingType, type World } from '../world/worldgen';
import { Avatar } from './avatar';
import type { Effects } from './effects';
import type { Grips } from './arms';
import { lookFor } from './look';
import { bodyOf, drawFar } from './infected-kinds';
import { infectedMoves } from './infected-moves';
import { infectedLook } from './infected-look';
import type { Stash } from './loot';
import { menuOrder, recall, remember, visit, type SceneRow } from './menu-order';
import { bearCharge, canyon, forge, fortFlight, raid, sawLogs, wolfPack } from './menu-scenes-new';
import { DAY } from '../sim/daynight';
import type { Base28 } from '../trailer/base28';

export interface MenuHost {
  world: World;
  atmo: Atmosphere;
  scene: THREE.Scene;
  effects: Effects;
  /** a weapon as it is seen in somebody's hands */
  held(id: string, mods: string[]): { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee' } | null;
  /** what a body has on: helmet, vest, pack, mask */
  wear(body: Avatar, ids: string[]): Promise<void>;
  /** a stash case, a suitcase or a bag stood on the ground as the game stands one (its `setBuried` puts it under; whoever asked for it takes it away again) */
  stash(item: string, x: number, z: number, rot: number): Promise<Stash>;
  /** a base laid by the game's own rules, for the scenes of one (nobody's: it is taken away with the menu) */
  base(): Base28;
  /** a lamp somebody carries, lit for this frame: where it is and which way it shines (see Lamps.beam) */
  beam(pos: THREE.Vector3, dir: THREE.Vector3, power: number, wide: number): void;
}

/** a scene has been shown to somebody once it has been on for this long, seconds */
const SHOWN_AFTER = 2;
/** said before the caption of a scene that is new to whoever is looking (the menu lights the line of a caption that begins so: `menuScene` in src/ui/hud.ts) */
const NEW = 'New · ';
/** what a scene shows close is asked for this long before it is cut to, seconds: its pictures are on by the cut, and two scenes' worth are held no longer than this */
const SHARP_AHEAD = 3.5;

// ------------------------------------------------------------ a scene

interface View { p: THREE.Vector3; l: THREE.Vector3; fov: number }
export interface Vignette {
  /** said in the corner of the menu while it is shown: a plain thing about the game, which can be checked */
  caption: string;
  seconds: number;
  setup(): void;
  tick(t: number, dt: number): void;
  view(t: number): View;
  /**
   * What it shows from so near that the world's lighter copy of a thing's pictures would be seen for what it is (a
   * gun across a third of the picture): painted with the pictures as they came from a few seconds before the scene
   * is cut to until it is over (Assets.sharpen). The things themselves, whoever's hands they are in or out of.
   */
  close?(): THREE.Object3D[];
  /** what has to be going before it is cut to (smoke takes its time to stand): done each frame for the last `lead` seconds of whatever is shown before it */
  early?(dt: number): void;
  lead?: number;
  /** the hour it is set at, a share of the day (src/sim/daynight.ts): the menu's own day, unless it says */
  hour?: number;
}
interface Row extends SceneRow {
  /** a phone is shown it too (a phone has the least room: the big buildings and the second rifles are left out there) */
  phone: boolean;
  make(m: MenuScenes): Vignette | null;
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
  /** what it can be given to hold, by name ('own': what it came with), and which of them it holds now ('none': nothing) */
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
/** how thick the floor between one storey of a building and the next is laid, metres (see SLAB in src/world/buildings.ts) */
const SLAB = 0.2;
/** how big the squares are that the wood is kept by, metres (see `index`) */
const SQUARE = 8;
const square = (x: number, z: number) => (Math.floor(x / SQUARE) + 512) * 1024 + Math.floor(z / SQUARE) + 512;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mix = THREE.MathUtils.lerp, ease = THREE.MathUtils.smoothstep;

export class MenuScenes {
  /** what is being shown, in words ('' while it is the view from the air) */
  caption = '';
  /** how far the picture is faded to black for a cut, 0..1 */
  fade = 0;
  private ready = false;
  gone = false;
  men: Extra[] = [];
  private sick: Extra[] = [];
  /** the bunker's own infected, in their suits */
  private suited: Extra[] = [];
  /** every scene this screen is shown, in the table's order */
  private rows: (SceneRow & { v: Vignette })[] = [];
  /** the round now being shown: the same scenes in the order this visitor is shown them, and which are new to them */
  private order: { id: string; fresh: boolean; v: Vignette }[] = [];
  private seen = new Set<string>();
  private last: number | null = null;
  private at = -1;
  private t = 0;
  /** the scene now on has been on long enough to count as shown */
  private noted = false;
  /** seconds of the view from the air still to run before the next round of scenes */
  private air = 3.5;
  private rp: Float32Array;
  private mid = 0;
  /** the letting go of whatever is painted sharp: for as long as the menu is up, for the scene now on, and for the one about to be cut to */
  private sharp: (() => void)[] = [];
  private near: (() => void)[] = [];
  private soon: { v: Vignette; drops: (() => void)[] } | null = null;
  /** the cases stood in the world for the scenes that have one */
  private stashes: Stash[] = [];
  /** what a scene stood in the world for itself, taken away with the menu */
  props: THREE.Object3D[] = [];
  /** and anything else to be undone then */
  undo: (() => void)[] = [];
  /** trunks, rocks and what else stands on the ground, by the square it stands on (see `index`) */
  private stood = new Map<number, { x: number; z: number; tree: boolean }[]>();
  /** development: a scene asked for by its id, and a lens held where it was put */
  private asked: string | null = null;
  private spy: View | null = null;

  constructor(readonly h: MenuHost) {
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
      // (two of them are also handed the big pistol, which takes nothing on it but a longer magazine, and the shotgun
      // with its sight and its light, for the scenes that show them; and the first of them a shovel, for the one
      // that puts a case under the ground)
      const also = name === 'Volkov' ? this.h.held('deagle', []) : name === 'Kestrel' ? this.h.held('benelli', ['red_dot', 'gun_light']) : null;
      if (also) man.kits.set(name === 'Volkov' ? 'deagle' : 'benelli', { ...also, quiet: false });
      const spade = name === 'Volkov' ? this.h.held('shovel', []) : null;
      if (spade) man.kits.set('shovel', { ...spade, quiet: false });
      // (And the other two are handed the rifles: the AK with its magazine in, and the AR-15 with its sight, its
      // foregrip and its light. Not on a phone, where each gun is one more set of sharp pictures to be kept: there
      // the menu has the guns it had.)
      const long = TOUCH ? null : name === 'Mira' ? this.h.held('ak', ['mag_ak']) : name === 'Sable' ? this.h.held('ar15', ['mag_ar', 'red_dot', 'foregrip', 'gun_light']) : null;
      if (long) man.kits.set(name === 'Mira' ? 'ak' : 'ar15', { ...long, quiet: false });
      // (On a phone a thing is drawn with very small pictures until it is near or in the hands: these are neither,
      // and some of the scenes are of nothing but a gun. They are asked for by name, for as long as the menu is up.
      // On a desk's screen a gun's own pictures are up to three quarters of a gigabyte of the graphics card: there
      // each is asked for by the scene that shows it close, for as long as that scene is on. See Vignette.close.)
      if (TOUCH) for (const k of man.kits.values()) this.sharp.push(assets.sharpen(k.obj));
      this.arm(man);
      this.men.push(man);
    }
    for (let k = 0; k < (TOUCH ? 3 : 5); k++) {
      const body = new Avatar();
      // (the townsfolk and a worker: the menu's scenes are of the open country)
      const kind = (['villager', 'babushka', 'worker', 'oldman', 'conscript'] as const)[k];
      body.zombieMoves = await infectedMoves(kind, k);
      body.zombieLook = infectedLook(kind, k);
      await body.load(atmo, 0, false, lookFor(''), `zombie_${bodyOf(kind, k).body}`);
      if (this.gone) return body.dispose();
      drawFar(body.root, false);
      body.sick = { roused: 1, claw: -1, seed: (k * 7.31) % 20 };
      body.root.visible = false;
      scene.add(body.root);
      this.sick.push(new Extra(body, null, true));
    }
    // (and three of those the bunker keeps, in their suits: not on a phone, which is not shown the bunker)
    for (let k = 0; k < (TOUCH ? 0 : 3); k++) {
      const body = new Avatar();
      body.zombieMoves = await infectedMoves('hazmat', k + 5);
      body.zombieLook = infectedLook('hazmat', k + 5);
      await body.load(atmo, 0, false, lookFor(''), 'zombie_hazmat');
      if (this.gone) return body.dispose();
      drawFar(body.root, false);
      body.sick = { roused: 1, claw: -1, seed: (k * 5.17 + 3) % 20 };
      body.root.visible = false;
      scene.add(body.root);
      this.suited.push(new Extra(body, null, true));
    }
    // (A place is looked for over the whole map for some of the scenes, a glade or a meadow, and each such looking
    // is some milliseconds of arithmetic: every scene is made in a frame's spare time, and none of it is a catch in
    // the view from the air. See ../core/breathe.ts.)
    await breathe();
    this.index();
    for (const row of MenuScenes.TABLE) {
      if (TOUCH && !row.phone) continue;
      await breathe();
      if (this.gone) return;
      const v = row.make(this);
      if (v) this.rows.push({ id: row.id, added: row.added, v });
    }
    // what this visitor has been shown before, and when they were last here: read, and this visit written down
    const kept = recall();
    this.seen = kept.seen;
    this.last = kept.last;
    visit(Date.now());
    this.round();
    this.ready = this.rows.length > 0;
    if (import.meta.env.DEV) this.dev();
  }

  /** A game is starting: everybody off. */
  dispose() {
    this.gone = true;
    this.ready = false;
    this.caption = '';
    this.fade = 0;
    for (const e of this.cast()) e.body.dispose();
    this.men = [];
    this.sick = [];
    this.suited = [];
    for (const drop of [...this.sharp, ...this.near, ...(this.soon?.drops ?? [])]) drop();
    this.sharp = [];
    this.near = [];
    this.soon = null;
    for (const st of this.stashes) st.dispose(this.h.scene);
    this.stashes = [];
    for (const o of this.props.splice(0)) this.h.scene.remove(o);
    for (const f of this.undo.splice(0)) f();
    if (import.meta.env.DEV) delete (window as unknown as { __menu?: unknown }).__menu;
  }

  private cast() {
    return [...this.men, ...this.sick, ...this.suited];
  }

  /**
   * Development: `__menu.ids()` lists the scenes this screen is shown; `__menu.show(id)` cuts to one of them at once
   * (the round goes on from there), to be looked at or photographed; `__menu.look([x, y, z], [x, y, z], fov)` holds
   * the lens at a place, looking at another, with nobody about (a place for a new scene is found so), and
   * `__menu.look()` lets it go; `__menu.now()` says what is on, how far into it, and the round's order (a star by
   * what is called new); `__menu.as(seen, last)` begins the round again as it is for a visitor who has been shown
   * those scenes and was last here then (ms; null: never).
   */
  private dev() {
    (window as unknown as { __menu?: unknown }).__menu = {
      ids: () => this.rows.map((r) => r.id),
      show: (id: string) => {
        if (!this.rows.some((r) => r.id === id)) return false;
        this.asked = id;
        this.spy = null;
        return true;
      },
      look: (p?: number[], l?: number[], fov = 50) => {
        this.spy = p && l ? { p: V(p[0], p[1], p[2]), l: V(l[0], l[1], l[2]), fov } : null;
      },
      now: () => ({ id: this.order[this.at]?.id ?? '', t: this.t, fresh: this.order[this.at]?.fresh ?? false, order: this.order.map((o) => (o.fresh ? `${o.id}*` : o.id)) }),
      as: (seen: string[], last: number | null) => {
        this.seen = new Set(seen);
        this.last = last;
        this.over();
        this.spy = null;
        this.at = -1;
        this.air = 0.6;
        this.round();
      },
    };
  }
  /** development: why a scene is not among those shown */
  no(id: string, why: string): null {
    if (import.meta.env.DEV) console.warn(`menu: the scene '${id}' is left out: ${why}`);
    return null;
  }

  // ------------------------------------------------------------ places

  ground(x: number, z: number) {
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
  /** a place by a building, in its own measure: so far to its right, so far to its front (its doors are at its front), so far above its floor */
  private spot(b: BuildingPlot, right: number, front: number, up = 0) {
    const co = Math.cos(b.rot), si = Math.sin(b.rot);
    return new THREE.Vector3(b.x + right * co + front * si, b.floorY + up, b.z - right * si + front * co);
  }
  /** the first building of a kind there is on the map */
  private building(type: BuildingType) {
    return this.h.world.buildings.find((q) => q.type === type) ?? null;
  }
  /** a place on the ground, at the ground's own height */
  on(x: number, z: number) {
    return V(x, this.ground(x, z), z);
  }

  /**
   * What stands on the ground is put by the square it stands on: the trees (not the bushes, which a body goes
   * through and a lens looks over), the rocks, and whatever has been set down. How much of it is near a place is
   * asked some thousands of times while a glade or a meadow is looked for.
   */
  private index() {
    const w = this.h.world;
    const add = (o: { x: number; z: number }, tree: boolean) => {
      const k = square(o.x, o.z);
      if (!this.stood.has(k)) this.stood.set(k, []);
      this.stood.get(k)!.push({ x: o.x, z: o.z, tree });
    };
    for (const t of w.trees) if (!t.kind.startsWith('bush')) add(t, true);
    for (const r of w.rocks) add(r, false);
    for (const p of w.props) add(p, false);
  }
  /** how many trees stand within so far of a place (`all`: and the rocks and the rest with them) */
  count(x: number, z: number, r: number, all = false) {
    let n = 0;
    for (let qx = Math.floor((x - r) / SQUARE); qx <= Math.floor((x + r) / SQUARE); qx++) {
      for (let qz = Math.floor((z - r) / SQUARE); qz <= Math.floor((z + r) / SQUARE); qz++) {
        for (const o of this.stood.get((qx + 512) * 1024 + qz + 512) ?? []) if ((all || o.tree) && Math.hypot(o.x - x, o.z - z) < r) n++;
      }
    }
    return n;
  }
  /** nothing stands within so far of the straight line from one place to another */
  open(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / r));
    for (let k = 0; k <= n; k++) if (this.count(mix(a.x, b.x, k / n), mix(a.z, b.z, k / n), r, true)) return false;
    return true;
  }
  /** how far the ground rises and falls within a few steps of a place, metres */
  rough(x: number, z: number, r: number) {
    let lo = this.ground(x, z), hi = lo;
    for (let k = 0; k < 8; k++) {
      const h = this.ground(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return hi - lo;
  }
  /** how thick the grass is at a place, 0..1 (a case lying in a meadow's grass is not seen from beside it) */
  private grass(x: number, z: number) {
    return this.h.world.grass[idx(...sampleOf(x, z))] / 255;
  }
  /** a road within so far of a place */
  private byRoad(x: number, z: number, r: number) {
    for (const line of [this.h.world.road, ...this.h.world.roads]) {
      const p = line.points;
      for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - x, p[i + 2] - z) < r) return true;
    }
    return false;
  }
  /**
   * Nothing solid between two places: no wall, no shut door, no cupboard, no trunk, no rise of the ground. A lens
   * is not carried through one, nor a body walked through it. @param short metres at the far end that are not asked about
   */
  clear(a: THREE.Vector3, b: THREE.Vector3, short = 0) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length() - short;
    return len <= 0 || !physics.raycast(a, d.normalize(), len, SIGHT_GROUPS);
  }
  /** a line of places, each so high above the last-named height, with nothing solid between one and the next */
  private way(pts: THREE.Vector3[], up = 0) {
    for (let k = 0; k + 1 < pts.length; k++) if (!this.clear(pts[k].clone().setY(pts[k].y + up), pts[k + 1].clone().setY(pts[k + 1].y + up))) return false;
    return true;
  }
  /** room for a body to stand at a place: nothing solid where it would be, from the shins up */
  private room(p: THREE.Vector3) {
    return !physics.boxOverlaps({ x: p.x, y: p.y + 0.95, z: p.z }, 0, 0.27, 0.65, 0.27);
  }

  // ------------------------------------------------------------ people

  /** what it holds: its own, unless a scene hands it something else ('none': nothing) */
  arm(e: Extra, key = 'own') {
    if (e.kit === key) return;
    if (key === 'none') {
      e.body.setHeld(null, null, 'rifle', true);
      e.kit = key;
      return;
    }
    const k = e.kits.get(key);
    if (!k) return;
    // (at once: each of these scenes is cut to)
    e.body.setHeld(k.obj, k.grips, k.kind, true);
    e.kit = key;
    e.weapon = k.kind === 'pistol' ? 'pistol' : 'rifle';
    e.quiet = k.quiet;
  }
  put(e: Extra, x: number, z: number, yaw: number) {
    this.arm(e);
    e.pos.set(x, this.ground(x, z), z);
    e.vel.set(0, 0, 0);
    e.yaw = yaw;
    e.pitch = 0;
    e.crouch = e.aim = e.dead = false;
    e.on = true;
    e.nextShot = 0;
    e.body.clearWounds();
    e.body.setHold(null);
    // (one of the infected is after somebody unless a scene says it has seen nobody)
    if (e.body.sick) Object.assign(e.body.sick, { claw: -1, roused: 1 });
    // (a body that fell in the last scene is stood up before it is seen again)
    e.body.update(0.05, e.pos, e.vel, e.yaw, false, false);
  }
  /** as `put`, on a floor that is not the ground's: a ward a storey up, a passage under the ground */
  private set(e: Extra, at: THREE.Vector3, yaw: number) {
    this.put(e, at.x, at.z, yaw);
    e.pos.y = at.y;
    e.body.update(0.05, e.pos, e.vel, e.yaw, false, false);
  }
  /** on its feet toward a place at so many metres a second */
  go(e: Extra, x: number, z: number, speed: number, dt: number) {
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
  /**
   * How fast somebody goes who is to stop at a place: at their own pace until the last steps, and slower over
   * those, down to all but nothing as they arrive. (Told to go at one speed until they are there, a body stops
   * dead from a walk, and a lens that goes with it stops dead too.)
   */
  pace(e: Extra, to: THREE.Vector3, speed: number) {
    return Math.min(speed, 0.25 + Math.hypot(to.x - e.pos.x, to.z - e.pos.z) * 1.5);
  }
  /** as `go`, across a floor that is not the ground's: it keeps the height it stands at */
  private walk(e: Extra, x: number, z: number, speed: number, dt: number) {
    const y = e.pos.y;
    this.go(e, x, z, speed, dt);
    e.pos.y = y;
  }
  /** a shot: the flash of it, and (if it is meant to land) what it does to whoever it is at */
  fire(from: Extra, at: Extra | null) {
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
  lens(p: THREE.Vector3, subject: THREE.Vector3, fov: number, right = 0.3): View {
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
      caption: 'Desert Eagle .50 · the hardest-hitting pistol in the Zone',
      seconds: 7.5,
      // (the gun has a third of the picture to itself, from a pace off)
      close: () => [man.kits.get('deagle')!.obj],
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
      caption: 'Benelli M3 · holographic sight, and a light under the barrel',
      seconds: 8,
      close: () => [man.kits.get('benelli')!.obj],
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

  /**
   * One of the two rifles, shown as the shotgun is: from his right, side on, the length of it across the right of
   * the picture, and the infected coming up the road at him. (Each used to be a film of the gun on a table.)
   * @param from where on the road he is, in metres from the middle of the village
   * @param burst how many rounds go each time he fires: it is the last of them that lands
   * @param kneel down on one knee, and the lens down with him
   */
  private rifle(man: Extra, key: 'ak' | 'ar15', caption: string, from: number, burst: number, kneel = false): Vignette | null {
    if (!man.kits.has(key)) return null;
    const here = this.road(from);
    const three = this.sick.slice(0, 3);
    // (how high the gun is held: at the shoulder, which is lower on one knee)
    const up = kneel ? 1 : 1.42;
    let last = -9, left = 0, gap = 0;
    return {
      caption,
      seconds: 8,
      close: () => [man.kits.get(key)!.obj],
      setup: () => {
        last = -9;
        left = 0;
        this.put(man, here.at.x, here.at.z, Math.atan2(-here.t.x, -here.t.z));
        this.arm(man, key);
        man.aim = true;
        man.crouch = kneel;
        three.forEach((z, k) => {
          const b = this.road(from + 15 + k * 5.5);
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
        if (left > 0) {
          // (the trigger is down: a round every tenth of a second, the last of them into the nearest)
          gap -= dt;
          if (gap > 0) return;
          gap = 0.1;
          left--;
          this.fire(man, left ? null : next);
        } else if (t > 1.5 && t - last > 1.2 && next.pos.distanceTo(man.pos) < 10) {
          last = t;
          left = burst;
          gap = 0;
        }
      },
      view: (t) => {
        // where the shotgun's lens is, and at the height of the gun
        const f = new THREE.Vector3(here.t.x, 0, here.t.z), r = new THREE.Vector3(-f.z, 0, f.x);
        const p = man.pos.clone().addScaledVector(r, 2.5).addScaledVector(f, 1.3 - t * 0.04).setY(man.pos.y + up);
        return this.lens(p, man.pos.clone().addScaledVector(f, 0.75).setY(man.pos.y + up - 0.06), 36, 0.36);
      },
    };
  }

  /**
   * The village street from the height of its roofs: the lens goes slowly up the middle of it, and two survivors
   * come walking down it. Nothing happens. (A place, between the fights: the road is clear of everything for its
   * whole width, and at this height so is the air over it.)
   */
  private street(): Vignette {
    const from = -92, pace = 1.7, high = 8;
    const two = [this.men[1], this.men[3]];
    let gone = 0;
    // (where each of them is on the road after so long: a few paces apart, one either side of the middle)
    const place = (k: number, ahead = 0) => {
      const p = this.road(from + 46 + k * 3.5 - gone * 1.4 - ahead);
      const off = k ? -1.3 : 1.1;
      return { x: p.at.x + p.n.x * off, z: p.at.z + p.n.z * off, yaw: Math.atan2(p.t.x, p.t.z) };
    };
    return {
      caption: 'Zelenaya Dolina · the main street, from its roofs',
      seconds: 9,
      setup: () => {
        gone = 0;
        two.forEach((m, k) => {
          const at = place(k);
          this.put(m, at.x, at.z, at.yaw);
        });
      },
      tick: (_t, dt) => {
        gone += dt;
        two.forEach((m, k) => {
          const to = place(k, 2);
          this.go(m, to.x, to.z, 1.4, dt);
        });
      },
      view: (t) => {
        // over the middle of the road, looking down it at where it is forty metres on: that is kept to the right
        // of the picture, as whatever is looked at is
        const p = this.road(from + t * pace).at, far = this.road(from + t * pace + 40).at;
        p.y += high;
        far.y += 1.5;
        return this.lens(p, far, 50, 0.24);
      },
    };
  }

  /**
   * Up the drive to the hospital in Kamenka, at a walk, with nobody about. It was a stretch of the ninth film
   * here; this is the line the lens was carried along for that film (src/trailer/shots9.ts, 'hospital'), gone
   * over by the game itself. (Not on a phone: it is the biggest building there is, and a phone has the least room.)
   */
  private hospital(): Vignette | null {
    const b = this.building('hospital');
    if (!b) return null;
    const line = new THREE.CatmullRomCurve3([this.spot(b, 0.4, 43, 1.7), this.spot(b, 0.1, 37, 2), this.spot(b, -0.6, 30, 2.8), this.spot(b, -1.6, 24, 3.6)], false, 'centripetal');
    const seconds = 8;
    return {
      caption: 'Kamenka · the hospital: three floors and a roof',
      seconds,
      setup: () => {},
      tick: () => {},
      view: (t) => {
        // what is looked at is its front, over its doors and rising a little: kept to the right of the picture
        const k = Math.min(1, t / seconds);
        return this.lens(line.getPointAt(k * 0.999), this.spot(b, 0, 8, 4.2 + 1.4 * k), 40, 0.22);
      },
    };
  }

  /**
   * The hospital's long ward, a storey up: the lens is carried down it from its west end, along the row of beds
   * under the front windows, and ahead of it somebody goes down that row with her rifle up, to where one of those
   * who never left is standing among the beds.
   */
  private ward(): Vignette | null {
    const b = this.building('hospital');
    const who = this.men[1], it = this.sick[1];
    if (!b || !it || !who.kits.has('ak')) return null;
    // (the first floor: the height of the ground floor's rooms, and the slab over them)
    const up = hospitalPlan().h + SLAB;
    const P = (right: number, front: number, high = 0) => this.spot(b, right, front, up + high);
    // her way, between the beds and the pillars that stand down the middle of the ward; and where the other is
    const from = P(-17.2, 3.5), halt = P(-11.4, 3.5), there = P(-6.2, 4.2);
    // (the lens stops short of the first pillar, which stands a pace to the left of its line)
    const pts = [P(-21.4, 2.3, 1.6), P(-18, 2.2, 1.6), P(-14.6, 2.1, 1.6)];
    if (!this.room(from) || !this.room(halt) || !this.room(there) || !this.way([from, halt, there], 1.2)) return this.no('ward', 'her way down the ward is not open');
    if (!this.way(pts) || !this.clear(pts[0], from.clone().setY(from.y + 1.2)) || !this.clear(pts[2], there.clone().setY(there.y + 1.2))) return this.no('ward', 'the lens has not a clear way down it');
    const line = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const seconds = 8.5, east = Math.atan2(-(halt.x - from.x), -(halt.z - from.z));
    let left = 0, gap = 0, fired = false;
    return {
      caption: 'Kamenka hospital · the long ward, a floor up',
      seconds,
      setup: () => {
        left = 0;
        fired = false;
        this.set(who, from, east);
        this.arm(who, 'ak');
        who.aim = true;
        // (its back to her, at the window: it has not heard her yet)
        this.set(it, there, east + 0.5);
        it.body.sick!.roused = 0;
      },
      tick: (t, dt) => {
        // (at a careful walk, which keeps her no further ahead of the lens than it can make her out; and slower
        // over her last step: nobody on their feet stops dead)
        this.walk(who, halt.x, halt.z, this.pace(who, halt, 1.0), dt);
        if (left > 0) {
          gap -= dt;
          if (gap > 0) return;
          gap = 0.1;
          left--;
          this.fire(who, left ? null : it);
        } else if (!fired && t > 6.3) {
          fired = true;
          left = 3;
          gap = 0;
        }
      },
      view: (t) => {
        // what is looked at is the row of beds ahead of her: the side the windows are on is kept to the right
        const k = Math.min(1, t / seconds);
        return this.lens(line.getPointAt(k * 0.999), who.chest(new THREE.Vector3()).lerp(P(-6.5, 4.6, 1.1), 0.4), 52, 0.2);
      },
    };
  }

  /**
   * The morgue, on the hospital's ground floor: across its three tables to the cold chambers in the far wall (the
   * line the ninth film took, 'morgue'), and one of the infected going slowly down between two of the tables.
   */
  private morgue(): Vignette | null {
    const b = this.building('hospital');
    const it = this.sick[0];
    if (!b || !it) return null;
    const P = (right: number, front: number, high = 0) => this.spot(b, right, front, high);
    const pts = [P(2.1, -2.5, 1.55), P(0.9, -3.3, 1.5), P(-0.3, -4.3, 1.45)];
    // (between the first table and the second, from the end the door is at toward the wall the windows are in)
    const from = P(-3.1, -3.35), to = P(-3.1, -6.3);
    if (!this.room(from) || !this.way([from, to], 1.2)) return this.no('morgue', 'there is not room between its tables');
    if (!this.way(pts) || !this.clear(pts[0], from.clone().setY(from.y + 1.3)) || !this.clear(pts[2], P(-6.6, -4.9, 1.3))) return this.no('morgue', 'the lens has not a clear way across it');
    const line = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const seconds = 8;
    return {
      caption: 'Kamenka hospital · the morgue and its cold chambers',
      seconds,
      setup: () => {
        this.set(it, from, Math.atan2(-(to.x - from.x), -(to.z - from.z)));
        it.body.sick!.roused = 0;
      },
      tick: (_t, dt) => this.walk(it, to.x, to.z, 0.32, dt),
      view: (t) => {
        const k = Math.min(1, t / seconds);
        return this.lens(line.getPointAt(k * 0.999), P(-6.4, -4.9, 1.0), 50, 0.2);
      },
    };
  }

  /**
   * The cells of the police headquarters, from inside one: a policeman who never left is at its bars, and through
   * them three go down the passage in file, weapons up, and do not stop. (At a wary pace, and three of them: what
   * is seen of the passage through one cell's bars is two steps of it, and one man at a walk is across that in a
   * moment. He stands at the end of the bars they come from, and reaches after each as he goes by.)
   */
  private cells(): Vignette | null {
    const b = this.building('police_cells');
    const file = [this.men[0], this.men[3], this.men[2]], it = this.sick[2];
    if (!b || !it) return null;
    const P = (right: number, front: number, high = 0) => this.spot(b, right, front, high);
    // (the second cell from the back: its bars are in the passage's wall between -1.6 and -0.3 along it)
    const eye = [P(-3.5, -2.62, 1.52), P(-3.32, -2.45, 1.5)], bars = P(-1.3, -0.95, 1.3), held = P(-2.05, -0.62);
    // (down the passage from its front door, a step and a half apart: the first of them is level with the bars as the scene opens)
    const from = [P(0.45, 1.4), P(0.45, 3.0), P(0.45, 4.6)], to = P(0.45, -5.4), pace = 0.8;
    if (!this.room(held) || from.some((p) => !this.room(p)) || !this.way([from[2], to], 1.2)) return this.no('cells', 'the passage past the cells is not open');
    if (!this.way(eye) || !this.clear(eye[0], held.clone().setY(held.y + 1.3))) return this.no('cells', 'the lens has not room in the cell');
    const seconds = 8.5;
    let clawed = 0;
    return {
      caption: 'The police headquarters · four cells, and bars on each',
      seconds,
      setup: () => {
        clawed = 0;
        this.set(it, held, Math.atan2(-(bars.x - held.x), -(bars.z - held.z)));
        file.forEach((m, k) => {
          this.set(m, from[k], Math.atan2(-(to.x - from[k].x), -(to.z - from[k].z)));
          m.aim = true;
        });
      },
      tick: (t, dt) => {
        for (const m of file) this.walk(m, to.x, to.z, pace, dt);
        // (it goes for each of them through the bars as he comes level with it)
        if (clawed < file.length && t > 1.2 + clawed * 2) {
          clawed++;
          it.body.claw();
        }
      },
      view: (t) => {
        const k = Math.min(1, t / seconds);
        return this.lens(eye[0].clone().lerp(eye[1], k), bars, 58, 0.24);
      },
    };
  }

  /**
   * The police headquarters from the air, the lens coming down and round toward its gate: three of them on its
   * roofs and its terrace, and one walking in at the gate with all three turned to him. (A stretch of the ninth
   * film here until the films went: the line of the lens and the places they stand are that film's, 'hq'.)
   */
  private headquarters(): Vignette | null {
    const b = this.building('police_hq');
    if (!b) return null;
    const ROOF = 6.4, TERRACE = 3.4;
    const gate = this.spot(b, -1.2, 24), yard = this.spot(b, 0.5, 14);
    const walker = this.men[0];
    const up: [Extra, THREE.Vector3, boolean][] = [
      [this.men[1], this.spot(b, -6, 5.7, ROOF), true],
      [this.men[3], this.spot(b, 8, 4.5, ROOF), false],
      [this.men[2], this.spot(b, 9.8, 11, TERRACE), true],
    ];
    const seconds = 9;
    return {
      caption: 'Zelenaya Dolina · the police headquarters, round its yard',
      seconds,
      setup: () => {
        for (const [m, at, aims] of up) {
          this.put(m, at.x, at.z, 0);
          // (on a roof, which is not the ground: whoever is up here turns where he stands and is not walked anywhere)
          m.pos.y = at.y;
          m.face(gate.x, gate.z);
          m.aim = aims;
        }
        this.put(walker, gate.x, gate.z, 0);
        walker.face(yard.x, yard.z);
      },
      tick: (_t, dt) => {
        this.go(walker, yard.x, yard.z, 1.7, dt);
        for (const [m] of up) m.face(walker.pos.x, walker.pos.z);
      },
      view: (t) => {
        const k = Math.min(1, t / seconds), e = k * k * (3 - 2 * k);
        const a = -0.75 + 0.65 * e, r = 52 - 12 * k;
        return this.lens(this.spot(b, Math.sin(a) * r, 8 + Math.cos(a) * r, 31 - 12 * k), this.spot(b, 0, 7, 3), 34, 0.2);
      },
    };
  }

  /**
   * In along the track to the works, under the gas, with a mask on: over his shoulder, looking in. He walks into the
   * green with the pistol low, stops, brings it up, and drops two of the infected who have not seen him with a
   * quiet shot each; the rest go on as they were. (It was shot from inside the gate looking out, the gas and the
   * works behind the lens and only trees in the picture, and him a speck and then a back. The owner, 2026-10-14: the
   * scene "when the guy with pistol walks into the gas and shoots a zombie" did not look good.)
   */
  private works(): Vignette | null {
    const z = gasZone(this.h.world.pois, (x, zz) => this.ground(x, zz));
    const site = this.h.world.sites.find((s) => s.name === GAS.place);
    if (!z || !site) return null;
    // (the site's own "forward" is the way in: back out along the track)
    const f = new THREE.Vector3(Math.sin(site.rot), 0, Math.cos(site.rot)), r = new THREE.Vector3(Math.cos(site.rot), 0, -Math.sin(site.rot));
    const at = (right: number, fwd: number) => new THREE.Vector3(site.x + r.x * right + f.x * fwd, 0, site.z + r.z * right + f.z * fwd);
    const man = this.men[2];
    /** where he comes from, where he stops, metres out along the track */
    const FROM = 69, STOP = 59.5;
    // [right, forward] of each of the infected: in the yard ahead of him, in the gas, not facing him
    const STOOD: [number, number][] = [[0.8, 52], [-3, 49.5], [3.6, 47], [-1.2, 43], [5.2, 41.5]];
    /** when he has it up, and when each shot is (at the first two of them) */
    const UP = 4.6, SHOTS = [5.5, 6.7];
    let fired = 0;
    const stop = at(0, STOP);
    return {
      caption: 'The Chemical Works · gas: nobody goes in without a mask',
      seconds: 9,
      close: () => [man.kits.get('own')!.obj],
      setup: () => {
        fired = 0;
        const a = at(0, FROM);
        this.put(man, a.x, a.z, Math.atan2(f.x, f.z));
        this.sick.forEach((s, k) => {
          const b = at(STOOD[k][0], STOOD[k][1]);
          this.put(s, b.x, b.z, Math.atan2(f.x, f.z) + 0.9 * (((k * 1.7) % 1) - 0.5) + Math.PI * (k % 2));
          s.body.sick!.roused = 0;
        });
      },
      tick: (t, dt) => {
        // in at a careful walk, slowing to where he stops; the gun low until then
        if (t < UP) this.go(man, stop.x, stop.z, this.pace(man, stop, 1.35), dt);
        else man.vel.set(0, 0, 0);
        man.aim = t > UP - 0.35;
        // they have not seen him: they wander the yard, slowly, each its own way
        this.sick.forEach((s, k) => {
          const b = at(STOOD[k][0] + Math.sin(k * 2.1) * 4, STOOD[k][1] - 6 + (k % 2) * 9);
          this.go(s, b.x, b.z, 0.32, dt);
        });
        if (fired < SHOTS.length && t > SHOTS[fired]) {
          const near = this.sick[fired];
          if (near && !near.dead) {
            man.face(near.pos.x, near.pos.z);
            this.fire(man, near);
          }
          fired++;
        } else if (t > UP - 0.35 && fired < SHOTS.length) {
          // (the gun comes round onto the next of them before it goes off)
          const next = this.sick[fired];
          if (next && !next.dead) {
            const want = Math.atan2(-(next.pos.x - man.pos.x), -(next.pos.z - man.pos.z));
            man.yaw += Math.atan2(Math.sin(want - man.yaw), Math.cos(want - man.yaw)) * Math.min(1, dt * 5);
          }
        }
      },
      view: (t) => {
        // over his left shoulder, a pace behind, looking in along the track at the yard ahead: he stands in the right
        // of the picture, the gas and the works before him; it drifts in closer as he stops
        const k = THREE.MathUtils.smoothstep(t, 0, 6);
        const back = THREE.MathUtils.lerp(3.4, 2.5, k), left = THREE.MathUtils.lerp(1.5, 1.15, k);
        const p = man.pos.clone().addScaledVector(f, back).addScaledVector(r, -left);
        p.y = this.ground(p.x, p.z) + 1.62;
        const ahead = man.pos.clone().addScaledVector(f, -9);
        ahead.y = this.ground(ahead.x, ahead.z) + 1.25;
        return this.lens(p, ahead, 46, 0.08);
      },
    };
  }

  /**
   * Where the lens is while a case is buried, for a man stood at a place and facing a way: before him and to his
   * left, low, looking back at him over the case (the ninth film's 'bury-near'). @param k how far through the scene, 0..1
   */
  private spadeLens(at: THREE.Vector3, yaw: number, k: number) {
    const f = _a.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    return at.clone().addScaledVector(f, 0.9 + mix(2.4, 2.0, k)).add(_b.set(f.z, 0, -f.x).multiplyScalar(mix(3.0, 2.6, k)));
  }
  /**
   * A place to bury something: out in the country where the game lets a spade be put in (`noBurying`), in a wood but
   * with nothing standing on it for a step or two round, near enough level, and not deep in grass. And which way
   * the man who digs there faces, so that neither he nor the lens that watches him has a tree in the way.
   */
  private glade(): { at: THREE.Vector3; yaw: number } | null {
    const w = this.h.world, c = w.pois[0];
    let best: { at: THREE.Vector3; yaw: number } | null = null, top = -1e9;
    for (let R = 150; R <= 330; R += 12) {
      for (let a = 0; a < Math.PI * 2; a += 0.11) {
        const at = this.on(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R);
        if (this.count(at.x, at.z, 2.6, true) || noBurying(at.x, at.y, at.z, at.y, w.pois, w.buildings) || this.byRoad(at.x, at.z, 25)) continue;
        const rough = this.rough(at.x, at.z, 3), wood = this.count(at.x, at.z, 22);
        const score = Math.min(wood, 16) - rough * 10 - this.grass(at.x, at.z) * 8;
        if (rough > 0.5 || wood < 6 || score <= top) continue;
        for (let k = 0; k < 8; k++) {
          const yaw = k * 0.785 + 0.3;
          const eyes = [this.spadeLens(at, yaw, 0), this.spadeLens(at, yaw, 1)];
          if (eyes.some((p) => Math.abs(this.ground(p.x, p.z) - at.y) > 0.45 || this.count(p.x, p.z, 1.3, true) || !this.open(p, at, 0.8))) continue;
          best = { at, yaw };
          top = score;
          break;
        }
      }
    }
    return best;
  }

  /**
   * A case goes under the ground. He is at it with the shovel as the scene opens, one stroke after another for as
   * long as the game makes anybody dig; then the case is gone and there is turned earth where it lay, and he
   * straightens and looks about him. Somebody keeps watch a few steps off with her back to him.
   */
  private bury(): Vignette | null {
    const man = this.men[0], watch = this.men[1];
    // (it is asked for again here: its model may not have come when the cast was made, and the scene was being lost)
    const spade = this.h.held('shovel', []);
    if (spade && !man.kits.has('shovel')) man.kits.set('shovel', { ...spade, quiet: false });
    if (!man.kits.has('shovel')) return this.no('bury', 'there is no shovel to be held');
    const g = this.glade();
    if (!g) return this.no('bury', 'no glade was found to bury anything in');
    const { at, yaw } = g;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const box = this.on(at.x + f.x * 0.9, at.z + f.z * 0.9);
    // (The watcher: beyond him from where the lens is, and to the right of him in the picture. The first of three
    // places that has no tree standing on it; in a glade where all three have, he digs alone.)
    const eye0 = this.spadeLens(at, yaw, 0), to = at.clone().sub(eye0).setY(0).normalize();
    const POSTS: [number, number][] = [[3.2, 1.7], [4.4, 0.6], [3.6, 2.8]];
    const post = POSTS.map(([far, right]) => this.on(at.x + to.x * far - to.z * right, at.z + to.z * far + to.x * right)).find((p) => !this.count(p.x, p.z, 0.9, true)) ?? null;
    const away = post ? Math.atan2(-(post.x - at.x), -(post.z - at.z)) : 0;
    let lain: Stash | null = null;
    void this.h.stash('stash_kit', box.x, box.z, yaw + 0.5).then((st) => {
      if (this.gone) return st.dispose(this.h.scene);
      this.stashes.push((lain = st));
    }, () => {});
    // (A stroke of the spade is what the game gives whoever digs, and what everybody near sees of it: the swing of
    // the thing in the fist, 1.15 s of it, and the next when that one is done. See DIG_STROKE in src/game/weapons.ts.)
    const STROKE = 1.15, done = 0.2 + BURY.seconds, seconds = 9;
    let struck = -1, under = false;
    return {
      caption: `Out in the country · a shovel buries a stash in ${BURY.seconds} seconds`,
      seconds,
      close: () => [man.kits.get('shovel')!.obj],
      setup: () => {
        struck = -1;
        under = false;
        this.put(man, at.x, at.z, yaw);
        this.arm(man, 'shovel');
        man.pitch = -0.5;
        if (post) this.put(watch, post.x, post.z, away);
        lain?.setBuried(false);
      },
      tick: (t) => {
        const n = Math.floor((t - 0.2) / STROKE);
        if (t >= 0.2 && t < done - 0.3 && n > struck) {
          struck = n;
          man.body.swing(false, STROKE);
        }
        if (t >= done && !under) {
          under = true;
          lain?.setBuried(true);
        }
        // (he straightens, and looks over his shoulder at the wood and back: a look, with his feet where they were)
        man.pitch = -0.5 * (1 - ease(t, done + 0.2, done + 0.9));
        man.yaw = yaw - 0.6 * Math.sin(Math.PI * ease(t, done + 0.8, seconds));
        watch.yaw = away + 0.3 * Math.sin(t * 0.7);
      },
      view: (t) => {
        const k = Math.min(1, t / seconds), p = this.spadeLens(at, yaw, k);
        p.y = this.ground(p.x, p.z) + mix(0.95, 0.82, k);
        return this.lens(p, at.clone().lerp(box, 0.6).setY(at.y + mix(0.95, 0.72, k)), 44, 0.26);
      },
    };
  }

  /**
   * A fire in one of the map's stone rings, and three of them sat round it. The flames and the smoke are the
   * game's own (what it draws over a ring that somebody has lit: Effects.campfire), said straight to it, so that
   * nothing is lit that a game then starting would find alight, and none of it is heard.
   */
  private campfire(): Vignette | null {
    const three = [this.men[1], this.men[3], this.men[0]];
    // (where each sits, from the fire: so far beyond it from the lens, so far to the right. Two across the fire and
    // one at the near side of it, all of them in the part of the picture the menu leaves.)
    const SEATS: [number, number][] = [[1.5, -1.0], [1.35, 1.25], [0.1, 2.0]], OFF = 4.5;
    let best: { fire: THREE.Vector3; to: THREE.Vector3; side: THREE.Vector3 } | null = null, top = -1e9;
    for (const s of fireSpots(this.h.world.props)) {
      const fire = V(s.x, s.y, s.z);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const to = V(Math.cos(a), 0, Math.sin(a)), side = V(-to.z, 0, to.x);
        const eye = fire.clone().addScaledVector(to, -OFF).setY(0);
        eye.y = this.ground(eye.x, eye.z) + 1.05;
        if (Math.abs(eye.y - 1.05 - fire.y) > 0.6 || this.count(eye.x, eye.z, 1.2, true) || !this.clear(eye, fire.clone().setY(fire.y + 0.7), 0.9)) continue;
        const seats = SEATS.map(([far, right]) => fire.clone().addScaledVector(to, far).addScaledVector(side, right));
        if (seats.some((p) => Math.abs(this.ground(p.x, p.z) - fire.y) > 0.3 || !this.room(p.setY(this.ground(p.x, p.z))) || !this.clear(eye, p.clone().setY(p.y + 0.8)))) continue;
        // (a wood behind them, and nothing close in front of the lens)
        const score = Math.min(this.count(fire.x + to.x * 22, fire.z + to.z * 22, 18), 14) - this.count(eye.x, eye.z, 4, true) * 2;
        if (score > top) {
          top = score;
          best = { fire, to, side };
        }
      }
    }
    if (!best) return this.no('campfire', 'no fireplace has room round it for three and a lens');
    const { fire, to, side } = best;
    const seats = SEATS.map(([far, right]) => this.on(fire.x + to.x * far + side.x * right, fire.z + to.z * far + side.z * right));
    const owed = { flame: 0, smoke: 0 };
    const seconds = 8.5;
    return {
      caption: 'A fire in a stone ring · rest by it and it mends you',
      seconds,
      // (the smoke is let stand before the scene is cut to: a column takes ten seconds to be one)
      lead: 9,
      early: (dt) => this.h.effects.campfire(fire, owed, dt, 1, false),
      setup: () => {
        three.forEach((m, k) => {
          this.put(m, seats[k].x, seats[k].z, 0);
          m.face(fire.x, fire.z);
          // (sat down, with nothing in the hands)
          this.arm(m, 'none');
          m.body.setHold('sit');
        });
      },
      tick: (_t, dt) => this.h.effects.campfire(fire, owed, dt, 1, true),
      view: (t) => {
        // (it goes a step sideways and no nearer: any nearer, and whoever sits at the near side is out of the picture)
        const k = Math.min(1, t / seconds);
        const p = fire.clone().addScaledVector(to, -OFF).addScaledVector(side, mix(-0.4, 0.1, k));
        p.y = this.ground(p.x, p.z) + 1.05;
        return this.lens(p, fire.clone().setY(fire.y + 0.75), 40, 0.16);
      },
    };
  }

  /**
   * A supply drop in the open: the case under its orange smoke, and two coming for it at a run from the way the
   * village lies. The smoke is the game's own (Effects.signal), and is let stand before the scene is cut to.
   */
  private drop(): Vignette | null {
    const w = this.h.world, c = w.pois[0];
    const two = [this.men[0], this.men[3]];
    let best: { at: THREE.Vector3; to: THREE.Vector3 } | null = null, top = -1e9;
    for (let R = 110; R <= 270; R += 10) {
      for (let a = 0; a < Math.PI * 2; a += 0.1) {
        const at = this.on(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R);
        if (this.count(at.x, at.z, 13, true) || this.rough(at.x, at.z, 5) > 0.7 || w.pois.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < p.radius + 10)) continue;
        // (they come from the way the village lies, and the lens is on the far side of the case from them)
        const to = V(c.x - at.x, 0, c.z - at.z).normalize();
        const far = this.on(at.x + to.x * 34, at.z + to.z * 34), eye = this.on(at.x - to.x * 5, at.z - to.z * 5);
        if (!this.open(at, far, 3.2) || Math.abs(far.y - at.y) > 2.5 || Math.abs(eye.y - at.y) > 0.5 || this.count(eye.x, eye.z, 2.5, true) || !this.clear(eye.clone().setY(eye.y + 1.25), far.clone().setY(far.y + 1.3))) continue;
        const score = Math.min(this.count(at.x + to.x * 55, at.z + to.z * 55, 30), 20) * 0.3 - this.grass(at.x, at.z) * 10 - this.rough(at.x, at.z, 5) * 4;
        if (score > top) {
          top = score;
          best = { at, to };
        }
      }
    }
    if (!best) return this.no('drop', 'no open ground was found for a drop to lie on');
    const { at, to } = best, side = V(-to.z, 0, to.x);
    const P = (far: number, right: number) => this.on(at.x + to.x * far + side.x * right, at.z + to.z * far + side.z * right);
    // (one either side of the smoke, which stands over the case)
    const starts = [P(27, -2.6), P(33, 3.6)], ends = [P(1.25, -0.9), P(1.35, 1.9)];
    let lain: Stash | null = null;
    void this.h.stash('stash_kit', at.x, at.z, Math.atan2(to.x, to.z) + 0.5).then((st) => {
      if (this.gone) return st.dispose(this.h.scene);
      this.stashes.push((lain = st));
    }, () => {});
    const smoke = { owed: 0 };
    const seconds = 9;
    return {
      caption: 'A supply drop · orange smoke, and a mark on every map',
      seconds,
      lead: 8,
      early: (dt) => this.h.effects.signal(at, smoke, dt),
      setup: () => {
        two.forEach((m, k) => {
          this.put(m, starts[k].x, starts[k].z, 0);
          m.face(ends[k].x, ends[k].z);
        });
        lain?.setBuried(false);
      },
      tick: (_t, dt) => {
        this.h.effects.signal(at, smoke, dt);
        two.forEach((m, k) => {
          // (flat out until the last few steps, then down to a walk, and onto one knee by it)
          this.go(m, ends[k].x, ends[k].z, this.pace(m, ends[k], 5.6), dt);
          m.crouch = Math.hypot(ends[k].x - m.pos.x, ends[k].z - m.pos.z) < 0.5;
        });
      },
      view: (t) => {
        const k = Math.min(1, t / seconds);
        const p = P(-mix(5.0, 4.4, k), -0.5);
        p.y += 1.25;
        return this.lens(p, at.clone().setY(at.y + 0.85), 42, 0.22);
      },
    };
  }

  /**
   * The snow on the mountain in the north-east, as it is seen from the village: the lens rises over the roofs and
   * goes a little way toward it, with nobody about. (A place, as the hospital up its drive is. The snow itself
   * lies on ground too steep to stand a scene on: of the wooded ground it lies whole on, four fifths climbs more
   * than one in two. What is shown is what the mountain is for, which is to be seen from everywhere and steered by.)
   */
  private snow(): Vignette | null {
    const c = this.h.world.pois[0];
    // the top of it: the highest ground of that quarter of the map, where the snow is
    const peak = V(0, -1e9, 0);
    for (let x = 240; x <= 752; x += 16) {
      for (let z = -752; z <= -240; z += 16) {
        const y = this.ground(x, z);
        if (y > peak.y) peak.set(x, y, z);
      }
    }
    if (peak.y < SNOW.full + 20) return this.no('snow', 'no ground in the north-east stands far enough above the snow line');
    const to = V(peak.x - c.x, 0, peak.z - c.z).normalize();
    // (above anything that stands in the village: its roofs are ten metres up and its pines twenty-five)
    const P = (far: number, up: number) => V(c.x + to.x * far, this.ground(c.x, c.z) + up, c.z + to.z * far);
    const seconds = 9;
    return {
      caption: 'The north-east mountain · snow on the high ground',
      seconds,
      setup: () => {},
      tick: () => {},
      view: (t) => {
        const k = Math.min(1, t / seconds);
        return this.lens(P(mix(0, 16, k), mix(27, 32, k)), peak.clone().setY(peak.y - 45), 38, 0.2);
      },
    };
  }

  /**
   * The gas over the bunker, from the air on the side its way out is: a green bank lying in the hollow among the
   * pines, the lens coming slowly down toward it, and a man with his mask on going into it at a run until it has
   * him. The gas is the game's own, drawn as the works' is (Atmosphere.gases). (From the ground beside it there is
   * nothing to be seen of it but green: it is a bank only from above, or from far off.)
   */
  private gasbank(): Vignette | null {
    const P = bunkerPlace(this.h.world), man = this.men[2];
    const g = P && this.h.atmo.gases.find((c) => Math.hypot(c.x - P.x, c.z - P.z) < c.r);
    if (!P || !g) return null;
    // (the way out of the bunker, along the ground, and what is to the right of somebody looking back in along it)
    const out = V(Math.sin(P.rot), 0, Math.cos(P.rot)), side = V(out.z, 0, -out.x);
    // his way in: the first line, of a few either side of the way out, that no tree stands on
    const way = [3, -4, 9, -11, 16, -18].map((off) => [g.r + 20, g.r - 16].map((far) => this.on(g.x + out.x * far + side.x * off, g.z + out.z * far + side.z * off))).find(([a, b]) => this.open(a, b, 1.3) && Math.abs(a.y - b.y) < 8) ?? null;
    const eye = (far: number, up: number) => {
      const p = V(g.x + out.x * far - side.x * 12, 0, g.z + out.z * far - side.z * 12);
      // (well over the trees between it and the bank)
      return p.setY(Math.max(g.y + up, this.ground(p.x, p.z) + 28));
    };
    const seconds = 9;
    return {
      caption: 'Bunker 17 · gas stands over it, and hides whoever is in it',
      seconds,
      setup: () => {
        if (!way) return;
        this.put(man, way[0].x, way[0].z, 0);
        man.face(way[1].x, way[1].z);
      },
      tick: (_t, dt) => way && this.go(man, way[1].x, way[1].z, 4, dt),
      view: (t) => {
        // (what is looked at is the near side of the bank, where he goes into it: looked at in its middle, he is at the foot of the picture)
        const k = Math.min(1, t / seconds);
        return this.lens(eye(mix(126, 108, k), mix(46, 38, k)), V(g.x + out.x * 26, g.y + 5, g.z + out.z * 26), 40, 0.16);
      },
    };
  }

  /**
   * The army's camp: up the lane between its four tents toward the watchtower at the end of it, with one of them
   * walking the lane ahead of the lens and one coming back down it from the tower.
   */
  private camp(): Vignette | null {
    const site = this.h.world.sites.find((s) => s.kind === 'tents');
    if (!site) return null;
    // (the site's own "forward" is the way the lane runs, to the tower: see LAYOUT in src/world/worldgen.ts)
    const f = V(Math.sin(site.rot), 0, Math.cos(site.rot)), r = V(Math.cos(site.rot), 0, -Math.sin(site.rot));
    const P = (right: number, fwd: number, high = 0) => this.on(site.x + r.x * right + f.x * fwd, site.z + r.z * right + f.z * fwd).add(_c.set(0, high, 0));
    const tents = this.h.world.buildings.filter((q) => q.type === 'tent' && Math.hypot(q.x - site.x, q.z - site.z) < 30).length;
    const ways: [Extra, THREE.Vector3, THREE.Vector3][] = [[this.men[1], P(1.0, -9), P(1.0, 15)], [this.men[3], P(-1.3, 20), P(-1.3, -4)]];
    const eyes = [P(-0.7, -23, 1.7), P(-0.7, -15.5, 1.7)], tower = P(0, 25, 4.6);
    if (tents < 4 || ways.some(([, a, b]) => !this.room(a) || !this.way([a, b], 1.2)) || !this.way(eyes) || !this.clear(eyes[1], P(0, 14, 1.7))) return this.no('camp', 'the lane between the tents is not open');
    const seconds = 8.5;
    return {
      caption: 'The Army Camp · four tents and a watchtower',
      seconds,
      setup: () => {
        for (const [m, a, b] of ways) {
          this.put(m, a.x, a.z, 0);
          m.face(b.x, b.z);
        }
      },
      tick: (_t, dt) => {
        for (const [m, , b] of ways) this.go(m, b.x, b.z, 1.4, dt);
      },
      view: (t) => {
        const k = Math.min(1, t / seconds);
        return this.lens(eyes[0].clone().lerp(eyes[1], k), tower, 46, 0.2);
      },
    };
  }

  /**
   * Into the bunker with a light. Down its main passage from inside the door: no daylight comes down here, and what
   * is seen is what the lamp on his rifle falls on, which is the lamp the game gives a player (MenuHost.beam). The
   * bunker's own come up the passage at him out of the dark, in their suits. (He has his mask on: the game has gas
   * down here.)
   */
  private bunker(): Vignette | null {
    const P = bunkerPlace(this.h.world);
    const man = this.men[2], three = this.suited;
    if (!P || three.length < 3 || !man.kits.has('ar15')) return null;
    // (in the bunker's own measure: right of its middle, forward of it (forward is the way out), above its floor)
    const B = (right: number, fwd: number, up = 0) => V(...bunkerAt(P, right, fwd, -BUNKER.depth + up));
    const from = B(0.4, 2.4), halt = B(0.4, -2.9), far = B(0.1, -17);
    if (!this.room(from) || !this.way([B(-0.7, 5.2), from, halt, far], 1.3)) return this.no('bunker', 'its main passage is not open from the door');
    // (in: the way he faces, which is away from the way out)
    const inward = P.rot, STOOD: [number, number][] = [[0.5, -11], [-0.7, -13.6], [0.1, -16.6]];
    const seconds = 8.5;
    let last = -9, left = 0, gap = 0;
    // behind his left shoulder, going down the passage with him: where the lens is, and where down the passage it looks
    const eye = () => {
      const fwd = bunkerLocal(P, man.pos.x, man.pos.y, man.pos.z)[1];
      return { p: B(-0.65, fwd + 2.7, 1.6), l: B(0.2, fwd - 12, 1.2) };
    };
    return {
      caption: 'Bunker 17 · no daylight reaches it: bring a light',
      seconds,
      setup: () => {
        last = -9;
        left = 0;
        this.set(man, from, inward);
        this.arm(man, 'ar15');
        man.aim = true;
        three.forEach((z, k) => this.set(z, B(STOOD[k][0], STOOD[k][1]), inward + Math.PI));
      },
      tick: (t, dt) => {
        this.walk(man, halt.x, halt.z, this.pace(man, halt, 1.3), dt);
        const coming = three.filter((z) => !z.dead).sort((p, q) => p.pos.distanceToSquared(man.pos) - q.pos.distanceToSquared(man.pos));
        for (const z of coming) this.walk(z, man.pos.x, man.pos.z, 1.05, dt);
        // his light: from the end of the barrel, the way the barrel points
        const lamp = man.body.muzzle(_a, _b);
        if (lamp) this.h.beam(lamp.pos, lamp.dir, 1.5, 0.85);
        // (And a second, where the lens is: whoever comes down behind him has a flashlight of their own, the wide
        // one the game gives a hand. By his light alone he is a black shape against a lit ring of the passage, and
        // nine tenths of the picture is nothing.)
        const { p, l } = eye();
        this.h.beam(p.setY(p.y - 0.3), l.sub(p), 1, 1.3);
        const next = coming[0];
        if (!next) return;
        if (left > 0) {
          gap -= dt;
          if (gap > 0) return;
          gap = 0.1;
          left--;
          this.fire(man, left ? null : next);
        } else if (t > 3.6 && t - last > 1.7 && next.pos.distanceTo(man.pos) < 6.5) {
          last = t;
          left = 3;
          gap = 0;
        }
      },
      view: () => {
        // (he has the right of the picture, and the passage runs away down the middle of it)
        const { p, l } = eye();
        return this.lens(p, l, 50, 0.2);
      },
    };
  }

  /**
   * Every scene there is. A row is all that has to be added for a new one, beside the function that makes it: see
   * the head of this file. The order here is the order of an ordinary round: a fight and then something to look at,
   * turn about, no two of the guns seen close one after the other, and no two rooms. (Scenes of one day are shown
   * to somebody new in this order too: so a building is seen from outside before the room in it is.)
   *
   * `added` is the day of the changelog's entry (public/changelog/index.html): first playable on the 1st of October
   * 2026; supply drops on the 6th; the infected on the 8th; the gas, the campfires, the bunker and its two guns on
   * the 9th; the army's camp on the 10th; the AK, the AR-15 and burying on the 11th; the hospital, the police
   * headquarters and the village's streets on the 12th; the snow on the mountain and the gas over the bunker on
   * the 13th.
   *
   * (Each row is written the one way, on a line of its own beginning `{ id: '…', added: '…', phone: …, make:`. The
   * test reads the table as it is written, since this file cannot be run without the game: test/menu-order.test.ts.)
   */
  private static readonly TABLE: Row[] = [
    { id: 'raid', added: '2026-10-25', phone: false, make: raid },
    { id: 'chase', added: '2026-10-08', phone: true, make: (m) => m.chase() },
    { id: 'headquarters', added: '2026-10-12', phone: false, make: (m) => m.headquarters() },
    { id: 'ak', added: '2026-10-11', phone: false, make: (m) => m.rifle(m.men[1], 'ak', 'The AK · thirty rounds, for as long as the trigger is held', -176, 4) },
    { id: 'wolves', added: '2026-10-24', phone: false, make: wolfPack },
    { id: 'bury', added: '2026-10-11', phone: true, make: (m) => m.bury() },
    { id: 'firefight', added: '2026-10-01', phone: true, make: (m) => m.firefight() },
    { id: 'snow', added: '2026-10-13', phone: false, make: (m) => m.snow() },
    { id: 'felling', added: '2026-10-25', phone: false, make: sawLogs },
    { id: 'cells', added: '2026-10-12', phone: false, make: (m) => m.cells() },
    { id: 'deagle', added: '2026-10-09', phone: true, make: (m) => m.sidearm() },
    { id: 'campfire', added: '2026-10-09', phone: true, make: (m) => m.campfire() },
    { id: 'canyon', added: '2026-10-17', phone: false, make: canyon },
    { id: 'stand', added: '2026-10-08', phone: true, make: (m) => m.stand() },
    { id: 'bear', added: '2026-10-24', phone: false, make: bearCharge },
    { id: 'hospital', added: '2026-10-12', phone: false, make: (m) => m.hospital() },
    { id: 'ar15', added: '2026-10-11', phone: false, make: (m) => m.rifle(m.men[2], 'ar15', 'The AR-15 · holographic sight, foregrip and a light', 14, 2, true) },
    { id: 'forge', added: '2026-10-25', phone: false, make: forge },
    { id: 'gasbank', added: '2026-10-13', phone: false, make: (m) => m.gasbank() },
    { id: 'ward', added: '2026-10-12', phone: false, make: (m) => m.ward() },
    { id: 'drop', added: '2026-10-06', phone: true, make: (m) => m.drop() },
    { id: 'benelli', added: '2026-10-09', phone: true, make: (m) => m.shotgun() },
    { id: 'fort', added: '2026-10-14', phone: false, make: fortFlight },
    { id: 'street', added: '2026-10-12', phone: true, make: (m) => m.street() },
    { id: 'morgue', added: '2026-10-12', phone: false, make: (m) => m.morgue() },
    { id: 'works', added: '2026-10-09', phone: true, make: (m) => m.works() },
    { id: 'camp', added: '2026-10-10', phone: false, make: (m) => m.camp() },
    { id: 'bunker', added: '2026-10-09', phone: false, make: (m) => m.bunker() },
  ];

  // ------------------------------------------------------------ each frame

  /** the hour behind the menu now: the scene's own, or the menu's day */
  get hour() {
    return (this.ready && this.at >= 0 ? this.order[this.at]?.v.hour : undefined) ?? DAY.menu;
  }

  /** the round that is shown next: what this visitor has not been shown first (see `menuOrder`) */
  private round() {
    this.order = menuOrder(this.rows, this.seen, this.last, Date.now()).map((o) => ({ ...o, v: this.rows.find((r) => r.id === o.id)!.v }));
  }
  /** a scene has been on long enough to count as shown: it is written down as one this visitor has seen */
  private note(id: string) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    // (and whatever another window of the game has written down since: both are this visitor's)
    for (const s of remember(id, MenuScenes.TABLE)) this.seen.add(s);
  }
  /**
   * What the scene that comes next wants before it is cut to, with so long left of what is on now: whatever of its
   * own has to be going by then (see Vignette.early), and the pictures of what it shows close (Vignette.close).
   */
  private ahead(next: Vignette | undefined, left: number, dt: number) {
    if (next?.early && left <= (next.lead ?? 0)) next.early(dt);
    if (next?.close && left <= SHARP_AHEAD && this.soon?.v !== next) {
      for (const drop of this.soon?.drops ?? []) drop();
      this.soon = { v: next, drops: next.close().map((o) => assets.sharpen(o, true)) };
    }
  }

  /**
   * @returns whether a scene has the camera (if not, it is the caller's: the view from the air)
   */
  update(dt: number, cam: THREE.PerspectiveCamera): boolean {
    if (!this.ready) return false;
    dt = Math.min(dt, 0.05);
    if (this.asked) {
      // (development: a scene asked for by its id is cut to at once)
      const k = this.order.findIndex((o) => o.id === this.asked);
      this.asked = null;
      if (k >= 0) {
        this.over();
        this.begin(k);
      }
    }
    if (this.spy) {
      // (development: the lens held where it was put, with nobody about)
      this.over();
      this.at = -1;
      this.air = 0.5;
      this.caption = '';
      this.fade = 0;
      return this.aim(cam, this.spy);
    }
    if (this.at < 0) {
      // between rounds: the air, then into the first scene through a cut
      this.air -= dt;
      this.caption = '';
      this.fade = this.air < CUT.out ? 1 - Math.max(0, this.air) / CUT.out : Math.max(0, this.fade - dt / CUT.in);
      this.ahead(this.order[0]?.v, this.air, dt);
      if (this.air > 0) return false;
      this.begin(0);
    }
    this.t += dt;
    if (this.t >= this.order[this.at].v.seconds) {
      this.over();
      if (this.at + 1 < this.order.length) this.begin(this.at + 1);
      else {
        // the round is done: back up into the air for a while, and the next round is as this visitor now stands
        this.at = -1;
        this.air = 7;
        this.fade = 1;
        for (const drop of this.near.splice(0)) drop();
        this.round();
        return false;
      }
    }
    const on = this.order[this.at], now = on.v;
    if (!this.noted && this.t >= SHOWN_AFTER) {
      this.noted = true;
      this.note(on.id);
    }
    this.ahead(this.order[this.at + 1]?.v, now.seconds - this.t, dt);
    this.caption = (on.fresh ? NEW : '') + now.caption;
    this.fade = Math.max(1 - this.t / CUT.in, (this.t - (now.seconds - CUT.out)) / CUT.out, 0);
    now.tick(this.t, dt);
    for (const e of this.cast()) {
      e.body.root.visible = e.on;
      if (e.on) e.body.update(dt, e.pos, e.vel, e.yaw, e.crouch, e.dead, false, e.pitch, true, e.aim && !e.dead);
    }
    return this.aim(cam, now.view(this.t));
  }

  private aim(cam: THREE.PerspectiveCamera, view: View) {
    cam.position.copy(view.p);
    cam.up.set(0, 1, 0);
    cam.lookAt(view.l);
    cam.fov = view.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return true;
  }

  /** the scene that was on is over: everybody out of sight */
  private over() {
    for (const e of this.cast()) {
      e.on = false;
      e.body.root.visible = false;
    }
  }

  private begin(k: number) {
    this.at = k;
    this.t = 0;
    this.noted = false;
    for (const e of this.cast()) e.on = false;
    const v = this.order[k].v;
    v.setup();
    // (What this one shows close has been asked for already, a few seconds back, unless it was cut to out of turn;
    // and it is asked for before what the last one showed is let go of: a thing in both is never without its pictures.)
    const was = [...this.near, ...(this.soon && this.soon.v !== v ? this.soon.drops : [])];
    this.near = this.soon?.v === v ? this.soon.drops : (v.close?.() ?? []).map((o) => assets.sharpen(o, true));
    this.soon = null;
    for (const drop of was) drop();
  }
}
