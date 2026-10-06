// Gunplay: viewmodel (own scene/camera), procedural animation (equip, bob, sway,
// recoil springs, bolt cycling, reloads), ballistics with gravity + drag simulated
// in sub-steps against the physics world, zeroing, scope + iron sights, melee.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics, SHOT_GROUPS, type Surface } from '../core/physics';
import { audio } from '../core/audio';
import type { Input } from '../core/input';
import { extractParts } from '../core/gltf-utils';
import { ITEMS, capacityOf, hasMod, type ItemInstance, type Slot } from '../sim/items';
import { suppressorGeometry } from './procedural';
import { SLOT_ORDER, type PlayerInventory } from '../sim/inventory';
import type { Atmosphere } from '../world/atmosphere';
import type { Player } from './player';
import type { Effects } from './effects';
import { flashTexture } from './effects';
import { FPArms, type Grips, type HandGrip } from './arms';
import type { Look } from './look';
import type { ItemModels } from './loot';

export type HitZone = 'head' | 'torso' | 'legs';
/** damage multiplier per hit zone: bullets / melee */
const ZONE_MULT: Record<HitZone, [number, number]> = { head: [3.2, 1.6], torso: [1, 1], legs: [0.6, 0.7] };
export type UseKind = 'eat' | 'drink' | 'bandage' | 'open';
const FIST = { damage: 14, range: 1.35, rate: 0.4, stamina: 5 };

export type FireMode = 'semi' | 'auto';
type GunKind = 'rifle' | 'pistol' | 'auto';

export interface Damageable {
  /** returns true if this hit killed the target */
  damage(amount: number, point: THREE.Vector3, dir: THREE.Vector3, zone: HitZone): boolean;
  readonly name: string;
}

/** a shot leaving the muzzle, for the network: other players hear it and see it land */
export interface ShotInfo {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  weapon: string;
  suppressed: boolean;
}

export interface HitInfo {
  /** the thing that was hit, so the game can report it to the server */
  victim: Damageable;
  weapon: string;
  target: string;
  zone: HitZone;
  damage: number;
  killed: boolean;
  distance: number;
  melee: boolean;
}

interface Ballistics {
  muzzleVel: number;
  drag: number; // quadratic drag coefficient (1/m)
  damage: number;
  zero: number; // metres
}

const BALLISTICS: Record<GunKind, Ballistics> = {
  rifle: { muzzleVel: 820, drag: 0.00072, damage: 95, zero: 100 },
  pistol: { muzzleVel: 350, drag: 0.0021, damage: 34, zero: 25 },
  auto: { muzzleVel: 715, drag: 0.0011, damage: 48, zero: 100 },
};

/** per-weapon handling: cyclic rate, recoil (camera kick in rad), hip spread */
const HANDLING: Record<GunKind, { interval: number; kickV: number; kickH: number; climb: number; spread: number; vmKick: number }> = {
  rifle: { interval: 0.2, kickV: 0.85, kickH: 0.35, climb: 0.012, spread: 0.022, vmKick: 3.2 },
  pistol: { interval: 0.13, kickV: 0.42, kickH: 0.2, climb: 0.006, spread: 0.03, vmKick: 1.6 },
  auto: { interval: 0.1, kickV: 0.3, kickH: 0.22, climb: 0.0062, spread: 0.035, vmKick: 1.35 },
};

interface Bullet {
  /** someone else's bullet has already been heard going past */
  heard?: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  drag: number;
  damage: number;
  life: number;
  travelled: number;
  weapon: string;
  /** someone else's bullet: flies and lands for show, the shooter's own game decides what it hit */
  ghost?: boolean;
}

const _toCam = new THREE.Vector3();

/** critically-damped-ish spring for procedural motion */
class Spring {
  v = new THREE.Vector3();
  x = new THREE.Vector3();
  constructor(public k = 160, public d = 16) {}
  step(dt: number, target = new THREE.Vector3()) {
    const a = target.clone().sub(this.x).multiplyScalar(this.k).addScaledVector(this.v, -this.d);
    this.v.addScaledVector(a, dt);
    this.x.addScaledVector(this.v, dt);
    return this.x;
  }
}

interface VmModel {
  root: THREE.Group;
  kind: GunKind | 'melee';
  hip: THREE.Vector3;
  /** hip-fire cant/convergence so the gun points in toward the crosshair */
  hipRot?: THREE.Euler;
  ads: THREE.Vector3;
  /** the object holding the weapon in its original model space (grip points live here) */
  body?: THREE.Object3D;
  grips?: Grips;
  muzzle: THREE.Vector3; // in root space
  bolt?: THREE.Group;
  boltSlide?: THREE.Group;
  slide?: THREE.Object3D;
  charging?: THREE.Object3D;
  selector?: THREE.Object3D;
  mag?: THREE.Object3D;
  round?: THREE.Object3D;
  flash: THREE.Sprite;
  /** attachment meshes, shown when the item has the mod */
  scope?: THREE.Object3D;
  wrap?: THREE.Object3D;
  suppressor?: THREE.Object3D;
  /** aim position without an optic */
  adsIron?: THREE.Vector3;
}

type Action = { name: 'equip' | 'unequip' | 'bolt' | 'reload' | 'swing' | 'magswap' | 'use' | 'punch'; t: number; dur: number; done?: () => void; data?: Record<string, number> };

/** Clone a glTF material for the viewmodel scene (no CSM, no shared shader hooks). */
function plainMaterial(m: THREE.Material): THREE.Material {
  const c = m.clone() as THREE.MeshStandardMaterial;
  if (c.defines) {
    delete c.defines.USE_CSM;
    delete c.defines.CSM_CASCADES;
    delete c.defines.CSM_FADE;
  }
  c.onBeforeCompile = () => {};
  c.customProgramCacheKey = () => 'vm';
  c.envMapIntensity = 1;
  return c;
}

export class Weapons {
  private vmRoot = new THREE.Group();
  private models = new Map<string, VmModel>();
  private current: VmModel | null = null;
  private currentItem: ItemInstance | null = null;
  private action: Action | null = null;
  private bullets: Bullet[] = [];
  private kick = new Spring(210, 19);
  private kickRot = new Spring(170, 15);
  private sway = new Spring(120, 14);
  private aimRecoil = new Spring(90, 13);
  private adsT = 0;
  private sprintT = 0;
  private airT = 0;
  private boltReady = true;
  private chamberEmpty = false;
  private fireCooldown = 0;
  private breath = { held: false, t: 0 };
  private time = 0;
  private sunLight: THREE.DirectionalLight;
  private sunVis = 1;
  private arms = new FPArms();
  private skyVis = 1;
  scoped = false;
  aiming = false;
  hitMarker = 0;
  /** the last hit marker was a kill (HUD draws it red) */
  killMarker = false;
  onHit: (info: HitInfo) => void = () => {};
  onShot: (info: ShotInfo) => void = () => {};
  /** loot models, so consumables can be shown in the hands while they are used */
  itemModels: ItemModels | null = null;
  // bare hands: fists come up to punch (LMB) or guard (RMB) and drop again after a moment
  private fistAnchor = new THREE.Object3D();
  private guardT = 0;
  private guardHold = 0;
  private punchHand = 0;
  // item being used in the hands (food, drink, bandage, ammo box)
  private held: { root: THREE.Group; kind: UseKind; t: number; dur: number; size: THREE.Vector3; ending: number } | null = null;
  private heldCache = new Map<string, { root: THREE.Group; size: THREE.Vector3 }>();
  private lowerT = 0;
  /** lets the game resolve a collider owner to a damageable entity */
  resolveTarget: (owner: unknown) => Damageable | null = () => null;
  onSlungChange: (obj: THREE.Object3D | null) => void = () => {};

  constructor(
    private vmScene: THREE.Scene,
    private vmCamera: THREE.PerspectiveCamera,
    private atmo: Atmosphere,
    private player: Player,
    private inv: PlayerInventory,
    private fx: Effects,
  ) {
    vmScene.add(vmCamera);
    vmCamera.add(this.vmRoot);
    this.vmRoot.add(this.fistAnchor);
    vmScene.environment = atmo.envMap;
    this.sunLight = new THREE.DirectionalLight(atmo.sunColor, atmo.sunIntensity);
    this.sunLight.position.copy(atmo.sunDir).multiplyScalar(10);
    vmScene.add(this.sunLight);
  }

  /** sleeves and hands of the first-person arms */
  setLook(look: Look) {
    this.arms.setLook(look);
  }

  async load() {
    await this.arms.load();
    this.vmRoot.add(this.arms.root);
    const flashTex = flashTexture();
    const mkFlash = () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(4, 3, 2) }));
      s.visible = false;
      return s;
    };

    // ---- Mosin with PU scope (muzzle +X in model space)
    const rifleScene = await assets.model('bolt_action_rifle_7_62');
    {
      const root = new THREE.Group();
      const body = new THREE.Group();
      body.rotation.y = Math.PI / 2; // +X -> -Z
      root.add(body);
      const parts = extractParts(rifleScene);
      const bolt = new THREE.Group();
      const boltSlide = new THREE.Group();
      // bolt rotates about its own axis: pivot at the bolt body centre
      boltSlide.position.set(0, 0.0525, 0.0025);
      boltSlide.add(bolt);
      body.add(boltSlide);
      let round: THREE.Object3D | undefined;
      let wrap: THREE.Object3D | undefined;
      // the scope is two meshes under one node
      const scope = new THREE.Group();
      scope.visible = false;
      body.add(scope);
      for (const p of parts) {
        const mesh = new THREE.Mesh(p.geometry, plainMaterial(p.material));
        mesh.castShadow = false;
        // every node is called bolt_action_rifle_7_62_<part>: go by the part suffix
        const part = (p.owner ?? p.name).replace('bolt_action_rifle_7_62', '');
        if (part.startsWith('_bolt')) {
          mesh.position.set(0, -0.0525, -0.0025);
          bolt.add(mesh);
        } else if (part.startsWith('_bullet')) {
          mesh.visible = false;
          round = mesh;
          body.add(mesh);
        } else if (part.startsWith('_scope')) {
          scope.add(mesh);
        } else {
          if (part.startsWith('_wrap')) {
            wrap = mesh;
            mesh.visible = false;
          }
          body.add(mesh);
        }
      }
      const flash = mkFlash();
      flash.position.set(0, 0.035, -0.62);
      flash.scale.setScalar(0.32);
      root.add(flash);
      const m: VmModel = {
        root, kind: 'rifle', flash, bolt, boltSlide, round, body, scope, wrap,
        adsIron: new THREE.Vector3(0.0, -0.074, -0.52),
        hip: new THREE.Vector3(0.105, -0.135, -0.5),
        hipRot: new THREE.Euler(0.03, 0.06, -0.06),
        grips: {
          right: { pos: new THREE.Vector3(-0.425, 0.0, 0.034), fingers: new THREE.Vector3(0.75, -0.55, -0.3), palm: new THREE.Vector3(0.15, -0.1, -1), curl: [0.4, 1.2, 1.25, 1.3], thumb: 0.5 },
          left: { pos: new THREE.Vector3(0.0, -0.082, -0.038), fingers: new THREE.Vector3(0.35, 0.1, 0.93), palm: new THREE.Vector3(0, 1, 0.1), curl: [1.0, 1.05, 1.1, 1.15], thumb: 0.4 },
        },
        ads: new THREE.Vector3(0.007, -0.071, -0.33),
        muzzle: new THREE.Vector3(0, 0.035, -0.6),
      };
      this.models.set('mosin', m);
    }

    // ---- P38 (muzzle +X). Only the "_a" variant and the loaded magazine are used.
    const pistolScene = await assets.model('service_pistol');
    {
      const root = new THREE.Group();
      const body = new THREE.Group();
      body.rotation.y = Math.PI / 2;
      root.add(body);
      const parts = extractParts(pistolScene, (n) => /_a$|magazine_loaded|bullet/.test(n));
      let slide: THREE.Object3D | undefined;
      let mag: THREE.Object3D | undefined;
      for (const p of parts) {
        const mesh = new THREE.Mesh(p.geometry, plainMaterial(p.material));
        if (p.name.includes('bullet')) continue;
        body.add(mesh);
        if (p.name.includes('slide')) slide = mesh;
        if (p.name.includes('magazine')) {
          // the source file parks the magazine behind the grip; move it into the mag well
          mesh.position.set(0.075, -0.026, 0);
          mesh.visible = false;
          const holder = new THREE.Group();
          body.remove(mesh);
          holder.add(mesh);
          body.add(holder);
          mag = holder;
        }
      }
      const flash = mkFlash();
      flash.position.set(0, 0.06, -0.2);
      flash.scale.setScalar(0.2);
      root.add(flash);
      const suppressor = new THREE.Mesh(suppressorGeometry(), new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.85, roughness: 0.55 }));
      suppressor.position.set(0.168, 0.0605, 0);
      suppressor.visible = false;
      body.add(suppressor);
      this.models.set('p38', {
        root, kind: 'pistol', flash, slide, mag, body, suppressor,
        hip: new THREE.Vector3(0.075, -0.11, -0.38),
        hipRot: new THREE.Euler(0.02, 0.06, -0.03),
        grips: {
          right: { pos: new THREE.Vector3(-0.072, -0.018, 0.032), fingers: new THREE.Vector3(0.9, -0.15, -0.3), palm: new THREE.Vector3(0.3, 0, -1), curl: [0.35, 1.25, 1.3, 1.35], thumb: 0.6 },
          left: { pos: new THREE.Vector3(-0.065, -0.06, -0.055), fingers: new THREE.Vector3(0.85, -0.2, 0.35), palm: new THREE.Vector3(0, 0.4, 1), curl: [1.05, 1.1, 1.15, 1.2], thumb: 0.45 },
        },
        ads: new THREE.Vector3(0.0, -0.081, -0.34),
        muzzle: new THREE.Vector3(0, 0.06, -0.19),
      });
    }

    // ---- melee weapons: held upright in the right hand
    for (const id of ['hatchet', 'machete', 'crowbar', 'bat', 'knife']) {
      const def = ITEMS[id];
      const sc = await assets.model(def.model);
      const root = new THREE.Group();
      const body = new THREE.Group();
      const parts = extractParts(sc);
      const box = new THREE.Box3();
      for (const p of parts) {
        p.geometry.computeBoundingBox();
        box.union(p.geometry.boundingBox!);
      }
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const longAxis = size.y >= size.x && size.y >= size.z ? 'y' : size.x >= size.z ? 'x' : 'z';
      for (const p of parts) {
        const mesh = new THREE.Mesh(p.geometry, plainMaterial(p.material));
        mesh.position.set(-c.x, -box.min.y, -c.z);
        if (longAxis === 'x') {
          mesh.position.set(-box.min.x, -c.y, -c.z);
        }
        body.add(mesh);
      }
      if (longAxis === 'x') body.rotation.z = Math.PI / 2;
      if (longAxis === 'z') body.rotation.x = -Math.PI / 2;
      // grip near the bottom of the handle, tilted forward
      body.position.y = -Math.max(size.x, size.y, size.z) * 0.18;
      const holder = new THREE.Group();
      holder.add(body);
      holder.rotation.set(-0.55, 0.15, -0.2);
      root.add(holder);
      const flash = mkFlash();
      this.models.set(id, {
        root, kind: 'melee', flash, body,
        grips: {
          right: { pos: new THREE.Vector3(0.0, Math.max(size.x, size.y, size.z) * 0.12, 0.04), fingers: new THREE.Vector3(-0.2, -0.3, -1), palm: new THREE.Vector3(-1, 0, 0), curl: [1.1, 1.15, 1.2, 1.2], thumb: 0.6 },
          left: null,
        },
        hip: new THREE.Vector3(0.24, -0.3, -0.42),
        ads: new THREE.Vector3(0.18, -0.26, -0.42),
        muzzle: new THREE.Vector3(),
      });
    }
  }

  /** Compile every viewmodel shader up front so the first equip / first shot never stalls. */
  precompile(compile: (scene: THREE.Scene, camera: THREE.Camera) => void) {
    const added: THREE.Object3D[] = [];
    for (const m of this.models.values()) {
      if (!m.root.parent) {
        this.vmRoot.add(m.root);
        added.push(m.root);
      }
    }
    const hidden: THREE.Object3D[] = [];
    this.vmScene.traverse((o) => {
      if (!o.visible) {
        o.visible = true;
        hidden.push(o);
      }
    });
    compile(this.vmScene, this.vmCamera);
    hidden.forEach((o) => (o.visible = false));
    added.forEach((o) => this.vmRoot.remove(o));
  }

  /** world-space model of the long gun on the back (not in hands), for the avatar */
  slungModel(): THREE.Object3D | null {
    const it = [this.inv.slots.primary, this.inv.slots.secondary].find((i) => i && i !== this.currentItem);
    if (!it) return null;
    const m = this.models.get(it.id);
    return m ? m.root.children[0] : null;
  }

  /** a copy of a weapon's body for showing in someone's hands in the world (third person) */
  worldModel(id: string, mods: string[] = []): THREE.Object3D | null {
    const m = this.models.get(id);
    if (!m) return null;
    const src = m.body ?? m.root.children[0];
    const wasVisible = [m.scope, m.wrap, m.suppressor, m.mag].map((o) => o?.visible);
    if (m.scope) m.scope.visible = mods.includes('pu_scope');
    if (m.wrap) m.wrap.visible = mods.includes('rifle_wrap');
    if (m.suppressor) m.suppressor.visible = mods.includes('suppressor_9');
    if (m.mag) m.mag.visible = true;
    const c = src.clone();
    [m.scope, m.wrap, m.suppressor, m.mag].forEach((o, i) => o && (o.visible = !!wasVisible[i]));
    return c;
  }

  /** grip points of a weapon model (same ones the first-person arms use) */
  gripsOf(id: string): Grips | null {
    return this.models.get(id)?.grips ?? null;
  }

  private modes = new Map<string, FireMode>();
  fireMode(item: ItemInstance): FireMode {
    const def = ITEMS[item.id];
    return this.modes.get(item.uid) ?? def.weapon?.modes?.[0] ?? 'semi';
  }

  get busy() {
    return this.action !== null;
  }

  get equippedItem() {
    return this.currentItem;
  }

  /** current weapon status for the HUD */
  status() {
    const it = this.currentItem;
    if (!it) return { name: 'Fists', ammo: null as null | { loaded: number; reserve: number; cap: number }, action: this.action?.name ?? null, mode: null as FireMode | null };
    const def = ITEMS[it.id];
    if (!def.weapon) return { name: def.name, ammo: null as null | { loaded: number; reserve: number; cap: number }, action: this.action?.name ?? null, mode: null as FireMode | null };
    return {
      name: def.name,
      ammo: { loaded: it.loaded ?? 0, reserve: this.inv.count(def.weapon.ammo), cap: capacityOf(it) },
      action: this.action?.name ?? null,
      mode: def.weapon.modes ? this.fireMode(it) : null,
    };
  }

  private start(name: Action['name'], dur: number, done?: () => void, data?: Record<string, number>) {
    this.action = { name, t: 0, dur, done, data };
  }

  /** switch the item in hands (null = holster) */
  equip(slot: Slot | null) {
    if (this.action && this.action.name !== 'equip') return;
    const next = slot ? this.inv.slots[slot] : null;
    if (next === this.currentItem) return;
    const swap = () => {
      if (this.current) this.vmRoot.remove(this.current.root);
      this.currentItem = next;
      this.inv.active = next ? slot : null;
      this.current = next ? this.models.get(next.id) ?? null : null;
      if (this.current) {
        this.vmRoot.add(this.current.root);
        this.boltReady = true;
        audio.equip(ITEMS[next!.id].weapon ? 'gun' : 'melee');
        this.start('equip', 0.45);
      } else {
        this.action = null;
      }
      this.onSlungChange(this.slungModel());
    };
    if (this.current) this.start('unequip', 0.28, swap);
    else swap();
  }

  /** inventory changed under us (item dropped / moved) */
  validate() {
    const slot = this.inv.active;
    const item = slot ? this.inv.slots[slot] : null;
    if (item !== this.currentItem) {
      if (this.current) this.vmRoot.remove(this.current.root);
      this.current = item ? this.models.get(item.id) ?? null : null;
      this.currentItem = item;
      if (this.current) this.vmRoot.add(this.current.root);
      this.action = null;
    }
    this.onSlungChange(this.slungModel());
  }

  /** mouse wheel: next / previous occupied slot (wraps through empty hands) */
  cycle(dir: 1 | -1) {
    if (this.action && this.action.name !== 'equip') return;
    const order: (Slot | null)[] = [...SLOT_ORDER, null];
    const cur = order.indexOf(this.inv.active);
    for (let k = 1; k <= order.length; k++) {
      const s = order[(cur + dir * k + order.length * 2) % order.length];
      if (s === null || this.inv.slots[s]) {
        this.equip(s);
        return;
      }
    }
  }

  toggleMode(item: ItemInstance) {
    const modes = ITEMS[item.id].weapon?.modes;
    if (!modes || modes.length < 2) return;
    const next = modes[(modes.indexOf(this.fireMode(item)) + 1) % modes.length];
    this.modes.set(item.uid, next);
    audio.click(3600, 0.35, 0.015);
    audio.click(2400, 0.25, 0.02, 0.04);
    this.selectorT = 0.25;
  }

  private selectorT = 0;

  update(dt: number, input: Input, camera: THREE.PerspectiveCamera, enabled: boolean) {
    this.time += dt;
    this.selectorT = Math.max(0, this.selectorT - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.updateBullets(dt);

    if (enabled && !this.player.dead) {
      if (input.pressed('Digit1')) this.equip('primary');
      if (input.pressed('Digit2')) this.equip('secondary');
      if (input.pressed('Digit3')) this.equip('holster');
      if (input.pressed('Digit4')) this.equip('melee');
      if (input.pressed('KeyX')) this.equip(null);
      if (input.wheel !== 0 && !this.aiming) this.cycle(input.wheel > 0 ? 1 : -1);
      if (input.pressed('KeyB') && this.currentItem) this.toggleMode(this.currentItem);
    }

    const m = this.current;
    const item = this.currentItem;
    const def = item ? ITEMS[item.id] : null;
    const p = this.player;

    // ----- aiming
    const canAim = enabled && !!m && !p.sprinting && (!this.action || this.action.name === 'bolt') && !p.dead;
    this.aiming = canAim && input.held('Mouse2');
    p.aiming = this.aiming;
    this.adsT += ((this.aiming ? 1 : 0) - this.adsT) * (1 - Math.exp(-(this.aiming ? 14 : 11) * dt));
    this.scoped = !!m && m.kind === 'rifle' && hasMod(this.currentItem, 'pu_scope') && this.adsT > 0.9 && this.aiming;
    this.applyMods();
    this.sprintT += ((p.sprinting && p.moving > 0.4 ? 1 : 0) - this.sprintT) * (1 - Math.exp(-8 * dt));

    // ----- hold breath while scoped (Shift)
    const wantBreath = this.scoped && input.held('ShiftLeft') && p.vitals.stamina > 5;
    if (wantBreath) {
      this.breath.t += dt;
      p.vitals.stamina = Math.max(0, p.vitals.stamina - 9 * dt);
    } else this.breath.t = Math.max(0, this.breath.t - dt * 2);
    this.breath.held = wantBreath && this.breath.t < 6;

    // ----- trigger / actions
    if (enabled && m && item && def && !p.dead) {
      if (def.weapon) {
        const auto = this.fireMode(item) === 'auto';
        if (input.pressed('Mouse0')) {
          this.burst = 0;
          this.tryFire(m, item, camera, true);
        } else if (auto && input.held('Mouse0')) {
          this.tryFire(m, item, camera, false);
        }
        if (!input.held('Mouse0')) this.burst = 0;
        if (input.pressed('KeyR') && !this.action) this.reload(m, item);
      } else if (def.melee && input.pressed('Mouse0') && !this.action && this.fireCooldown <= 0) {
        this.swing(def.melee, camera);
      }
    } else if (enabled && !m && !p.dead && !this.held) {
      // bare hands
      if (input.held('Mouse2')) this.guardHold = 0.4;
      if (input.pressed('Mouse0') && !this.action && this.fireCooldown <= 0 && p.vitals.stamina > FIST.stamina) this.punch();
    }
    if (this.action && (input.pressed('Mouse0') || input.pressed('Mouse2')) && this.action.name === 'reload' && (this.action.data?.inserted ?? 0) > 0) {
      // interrupt rifle reload once at least one round is in
      this.action.data!.stop = 1;
    }

    // ----- action timeline
    const a = this.action;
    if (a) {
      a.t += dt;
      this.actionTick(a, m, item);
      if (a.t >= a.dur) {
        this.action = null;
        a.done?.();
      }
    }

    // ----- scope sway (applied to the aim, so bullets follow it)
    const tired = 1 + (1 - p.vitals.stamina / 100) * 2.5;
    const swayAmp = (this.scoped ? 0.0035 : this.aiming ? 0.0022 : 0.0012) * tired * (this.breath.held ? 0.15 : 1) * (p.crouched ? 0.6 : 1) * (hasMod(item, 'rifle_wrap') ? 0.75 : 1);
    const t = this.time;
    const breathSway = new THREE.Vector2(Math.sin(t * 0.9) * 0.7 + Math.sin(t * 2.1) * 0.3, Math.sin(t * 1.3 + 1) * 0.6 + Math.cos(t * 0.7) * 0.4).multiplyScalar(swayAmp);
    const rec = this.aimRecoil.step(dt);
    p.aimOffset.set(breathSway.x + rec.x, breathSway.y + rec.y);

    this.animate(dt, input, camera);
  }

  private burst = 0;

  private tryFire(m: VmModel, item: ItemInstance, camera: THREE.PerspectiveCamera, trigger: boolean) {
    if (this.action || this.fireCooldown > 0) return;
    const def = ITEMS[item.id];
    if (!def.weapon) return;
    if ((item.loaded ?? 0) <= 0 || !this.boltReady) {
      if (trigger) audio.dryFire();
      this.fireCooldown = 0.25;
      return;
    }
    item.loaded = (item.loaded ?? 0) - 1;
    const kind = def.weapon.kind;
    const b = BALLISTICS[kind];
    const hd = HANDLING[kind];
    this.burst++;
    // eye-origin shot with zeroing elevation (bullet crosses line of sight at the zero range)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const t0 = b.zero / b.muzzleVel;
    const elev = (0.5 * 9.81 * t0 * t0) / b.zero;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    dir.addScaledVector(up, elev).normalize();
    // hip fire is less precise
    // hip fire is less precise; sustained auto fire blooms
    const bloom = kind === 'auto' ? Math.min(this.burst - 1, 8) * 0.0025 : 0;
    const spread = (this.aiming ? 0.002 : hd.spread) + bloom;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const suppressed = hasMod(item, 'suppressor_9');
    this.onShot({ origin: camera.position.clone(), dir: dir.clone(), weapon: item.id, suppressed });
    this.bullets.push({ pos: camera.position.clone(), vel: dir.multiplyScalar(b.muzzleVel * (suppressed ? 0.9 : 1)), drag: b.drag, damage: b.damage * (suppressed ? 0.9 : 1), life: 4, travelled: 0, weapon: item.id });

    // feel: recoil springs, camera kick, flash, sound. Auto fire climbs up and
    // drifts right, sawing left/right after the first few rounds.
    const big = kind === 'rifle';
    const stance = (this.player.crouched ? 0.7 : 1) * (this.aiming ? 0.85 : 1);
    const drift = kind === 'auto' ? (this.burst < 4 ? 0.12 : Math.sin(this.burst * 1.7) * 0.28) : (Math.random() - 0.5);
    this.kick.v.z += hd.vmKick;
    this.kick.v.y += big ? 0.25 : 0.4;
    this.kickRot.v.x += big ? 9 : kind === 'auto' ? 5.5 : 7;
    this.kickRot.v.z += (Math.random() - 0.5) * (big ? 3 : 2);
    this.aimRecoil.v.y += hd.kickV * stance;
    this.aimRecoil.v.x += drift * hd.kickH * stance;
    this.player.pitch += hd.climb * stance; // part of the kick stays: you have to pull down
    this.player.yaw -= drift * hd.climb * 0.35 * stance;
    const muzzleWorld = camera.position.clone().add(new THREE.Vector3(0.12, -0.1, -0.9).applyQuaternion(camera.quaternion));
    if (!suppressed) {
      m.flash.visible = true;
      m.flash.material.rotation = Math.random() * Math.PI * 2;
      m.flash.scale.setScalar((kind === 'auto' ? 0.22 : big ? 0.32 : 0.2) * (0.8 + Math.random() * 0.4));
      setTimeout(() => (m.flash.visible = false), 40);
    }
    this.fx.muzzle(muzzleWorld, new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), big || kind === 'auto', suppressed);
    audio.gunshot(kind === 'auto' ? 'rifle' : kind, undefined, 0, kind === 'auto', suppressed);

    if (kind === 'rifle') {
      this.boltReady = false;
      this.fireCooldown = hd.interval;
      setTimeout(() => {
        if (this.current === m && !this.action) this.cycleBolt(m);
      }, 260);
    } else {
      this.fireCooldown = hd.interval;
      this.slideKick = 1;
      audio.shellDrop();
      if ((item.loaded ?? 0) === 0) this.chamberEmpty = true;
    }
  }

  private slideKick = 0;

  private cycleBolt(m: VmModel) {
    audio.boltCycle();
    audio.shellDrop(0.5);
    this.start('bolt', 0.78, () => {
      this.boltReady = true;
    });
    void m;
  }

  private reload(m: VmModel, item: ItemInstance) {
    const def = ITEMS[item.id];
    if (!def.weapon) return;
    const need = capacityOf(item) - (item.loaded ?? 0);
    const have = this.inv.count(def.weapon.ammo);
    if (need <= 0 || have <= 0) return;
    if (m.kind === 'rifle') {
      // open bolt, push rounds in one by one, close bolt
      const n = Math.min(need, have);
      audio.click(2400, 0.45, 0.025);
      audio.click(1700, 0.5, 0.06, 0.15);
      this.start('reload', 0.55 + n * 0.48 + 0.5, () => {
        audio.click(2000, 0.5, 0.05);
        audio.click(2800, 0.45, 0.025, 0.18);
        this.boltReady = true;
      }, { rounds: n, inserted: 0, stop: 0 });
    } else {
      const long = m.kind === 'auto';
      const locked = this.chamberEmpty;
      audio.magOut(long ? 0.25 : 0.1);
      audio.magIn(long ? 1.35 : 1.05);
      if (locked) {
        if (long) {
          audio.click(1500, 0.55, 0.05, 1.85);
          audio.click(2200, 0.6, 0.04, 2.0);
        } else audio.slideRack(1.55);
      }
      const dur = long ? (locked ? 2.35 : 1.9) : locked ? 1.95 : 1.55;
      this.start('magswap', dur, () => {
        const got = this.inv.take(def.weapon!.ammo, capacityOf(item) - (item.loaded ?? 0));
        item.loaded = (item.loaded ?? 0) + got;
        this.chamberEmpty = false;
      });
    }
  }

  private punch() {
    this.fireCooldown = FIST.rate;
    this.guardHold = 2.6;
    this.punchHand = 1 - this.punchHand;
    this.player.vitals.stamina = Math.max(0, this.player.vitals.stamina - FIST.stamina);
    audio.whoosh();
    const dmg = FIST.damage + this.inv.wear('fist').reduce((a, b) => a + b, 0);
    this.start('punch', FIST.rate * 0.95, undefined, { hit: 0, dmg, range: FIST.range, hand: this.punchHand });
  }

  /** Show an item in the hands while it is being used; the weapon drops out of the way. */
  beginUse(id: string, kind: UseKind, dur: number) {
    if (!this.itemModels) return;
    void this.itemModels.get(id).then((tpl) => {
      let h = this.heldCache.get(id);
      if (!h) {
        const root = new THREE.Group();
        const obj = tpl.group.clone();
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.material = plainMaterial(mesh.material as THREE.Material);
            mesh.castShadow = false;
          }
        });
        const size = tpl.size.clone();
        // long side points away from the camera so the hand wraps the narrow side
        if (size.x > size.z * 1.15) {
          obj.rotation.y = Math.PI / 2;
          size.set(size.z, size.y, size.x);
        }
        obj.position.y = -size.y / 2;
        root.add(obj);
        h = { root, size };
        this.heldCache.set(id, h);
      }
      if (this.held) this.vmRoot.remove(this.held.root);
      this.held = { root: h.root, kind, t: 0, dur, size: h.size, ending: 0 };
      this.vmRoot.add(h.root);
    });
  }

  endUse() {
    if (this.held && !this.held.ending) this.held.ending = 1e-4;
  }

  private swing(melee: NonNullable<(typeof ITEMS)[string]['melee']>, camera: THREE.PerspectiveCamera) {
    this.fireCooldown = melee.rate;
    this.player.vitals.stamina = Math.max(0, this.player.vitals.stamina - 6);
    audio.ui('move');
    this.start('swing', melee.rate * 0.9, undefined, { hit: 0, dmg: melee.damage, range: melee.range });
    void camera;
  }

  private actionTick(a: Action, m: VmModel | null, item: ItemInstance | null) {
    if (a.name === 'reload' && m && item && a.data) {
      const def = ITEMS[item.id];
      // insert one round every 0.48 s after the bolt opens
      const due = Math.min(a.data.rounds, Math.max(0, Math.floor((a.t - 0.55) / 0.48) + 1));
      while (a.data.inserted < due && !a.data.stop) {
        if (this.inv.take(def.weapon!.ammo, 1) === 1) {
          item.loaded = (item.loaded ?? 0) + 1;
          audio.roundInsert();
        }
        a.data.inserted++;
      }
      if (a.data.stop && a.t < a.dur - 0.5) a.t = a.dur - 0.5;
    }
    if ((a.name === 'swing' || a.name === 'punch') && a.data && !a.data.hit && a.t > a.dur * (a.name === 'punch' ? 0.28 : 0.35)) {
      a.data.hit = 1;
      const cam = this.vmCamera.parent ? this.mainCam : null;
      if (!cam) return;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const hit = physics.raycast(cam.position, dir, a.data.range, SHOT_GROUPS, this.player.collider);
      if (hit) {
        const pt = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
        const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        const target = this.resolveTarget(hit.tag?.owner);
        if (target) {
          const zone = hit.tag?.zone ?? 'torso';
          const dmg = a.data.dmg * ZONE_MULT[zone][1];
          const killed = target.damage(dmg, pt, dir, zone);
          this.markHit(killed);
          this.onHit({ victim: target, weapon: a.name === 'punch' ? 'fists' : this.currentItem?.id ?? 'fists', target: target.name, zone, damage: dmg, killed, distance: hit.toi, melee: true });
          this.fx.impact('flesh', pt, n, false);
          audio.impact('flesh', pt, 1);
        } else {
          const s = (hit.tag?.surface ?? 'dirt') as Surface;
          this.fx.impact(s, pt, n, false);
          audio.impact(s, pt, 1);
        }
        // the blow lands: the view jolts
        this.kickRot.v.x -= 6;
        this.aimRecoil.v.y += a.name === 'punch' ? 0.25 : 0.4;
        this.aimRecoil.v.x += (Math.random() - 0.5) * 0.3;
      }
    }
  }

  mainCam: THREE.PerspectiveCamera | null = null;

  /** show or hide attachment meshes to match the item in hand */
  private applyMods() {
    const m = this.current;
    if (!m) return;
    const it = this.currentItem;
    if (m.scope) m.scope.visible = hasMod(it, 'pu_scope');
    if (m.wrap) m.wrap.visible = hasMod(it, 'rifle_wrap');
    if (m.suppressor) m.suppressor.visible = hasMod(it, 'suppressor_9');
  }

  /** Another player fired: their bullet flies in this world too, so you see and hear where it lands. */
  remoteShot(origin: THREE.Vector3, dir: THREE.Vector3, weaponId: string, suppressed: boolean) {
    const kind = ITEMS[weaponId]?.weapon?.kind;
    if (!kind) return;
    const b = BALLISTICS[kind];
    this.bullets.push({ pos: origin.clone(), vel: dir.clone().normalize().multiplyScalar(b.muzzleVel), drag: b.drag, damage: 0, life: 4, travelled: 0, weapon: weaponId, ghost: true });
    const d = this.mainCam ? origin.distanceTo(this.mainCam.position) : 0;
    this.fx.muzzle(origin.clone().addScaledVector(dir, 0.6), dir, kind !== 'pistol', suppressed);
    audio.gunshot(kind === 'auto' ? 'rifle' : kind, origin, d, false, suppressed);
  }

  /** the server confirmed our hit killed someone */
  confirmKill() {
    this.hitMarker = 0.6;
    this.killMarker = true;
    audio.hitTick(true);
  }

  /** the ground came up: the weapon dips with the knees */
  landed(speed: number) {
    const k = Math.min(1, speed / 9);
    this.kick.v.y -= 0.9 + k * 2.6;
    this.kickRot.v.x -= 2 + k * 6;
  }

  /** we were hit: the view and the weapon jolt */
  flinch(k: number) {
    this.aimRecoil.v.y += 0.9 * k;
    this.aimRecoil.v.x += (Math.random() - 0.5) * 1.4 * k;
    this.kickRot.v.z += (Math.random() - 0.5) * 7 * k;
    this.kick.v.y -= 0.5 * k;
  }

  private markHit(killed: boolean) {
    this.hitMarker = killed ? 0.5 : 0.25;
    this.killMarker = killed;
    audio.hitTick(killed);
  }

  /**
   * Hands follow the work: during reloads and bolt cycles the base grips blend toward
   * the moving parts (magazine, bolt handle, slide), so the hands visibly do the action.
   */
  private actionGrips(m: VmModel): Grips | null {
    const g = m.grips;
    if (!g) return null;
    const a = this.action;
    if (!a) return g;
    const k = Math.min(1, a.t / a.dur);
    const smooth = (x0: number, x1: number) => THREE.MathUtils.smoothstep(k, x0, x1);
    const blend = (base: HandGrip, to: Partial<HandGrip>, w: number): HandGrip => ({
      pos: base.pos.clone().lerp(to.pos ?? base.pos, w),
      fingers: base.fingers.clone().lerp(to.fingers ?? base.fingers, w).normalize(),
      palm: base.palm.clone().lerp(to.palm ?? base.palm, w).normalize(),
      curl: base.curl.map((c, i) => THREE.MathUtils.lerp(c, to.curl?.[i] ?? c, w)) as HandGrip['curl'],
      thumb: THREE.MathUtils.lerp(base.thumb, to.thumb ?? base.thumb, w),
    });
    if (m.kind === 'pistol' && a.name === 'magswap' && g.left && m.mag) {
      // left hand strips the mag, drops out of view for a fresh one, seats it, re-grips
      const w = smooth(0.02, 0.18) * (1 - smooth(0.78, 0.95));
      const magPos = new THREE.Vector3(-0.035, -0.1 + m.mag.position.y, -0.01);
      const away = smooth(0.3, 0.42) * (1 - smooth(0.52, 0.66));
      magPos.y -= away * 0.25;
      magPos.z -= away * 0.08;
      const left = blend(g.left, { pos: magPos, fingers: new THREE.Vector3(0.2, 0.3, 0.93), palm: new THREE.Vector3(0, 1, 0), curl: [0.9, 0.95, 1, 1.05], thumb: 0.5 }, w);
      // empty gun: overhand rack of the slide at the end
      if (a.dur > 1.8) {
        const r = smooth(0.78, 0.86) * (1 - smooth(0.93, 1));
        const slidePos = new THREE.Vector3(-0.02 - 0.03 * smooth(0.84, 0.9), 0.1, 0.0);
        return { right: g.right, left: blend(left, { pos: slidePos, fingers: new THREE.Vector3(0.1, -0.3, 0.95), palm: new THREE.Vector3(0, -1, 0), curl: [1.0, 1.05, 1.1, 1.1], thumb: 0.7 }, r) };
      }
      return { right: g.right, left };
    }
    if (m.kind === 'rifle' && (a.name === 'bolt' || a.name === 'reload') && g.right && m.boltSlide && m.bolt) {
      // right hand leaves the grip to work the bolt handle (follows the animated bolt)
      const w = a.name === 'bolt' ? smooth(0.0, 0.14) * (1 - smooth(0.86, 1)) : smooth(0.0, 0.08) * (1 - smooth(0.94, 1));
      const handle = new THREE.Vector3(-0.235 + m.boltSlide.position.x, 0.04 + 0.02 * Math.sin(-m.bolt.rotation.x), 0.06 + 0.02 * Math.cos(-m.bolt.rotation.x));
      let pos = handle;
      if (a.name === 'reload' && a.data) {
        // between bolt open and close the thumb pushes rounds down into the magazine
        const feeding = a.t > 0.55 && a.t < a.dur - 0.5;
        if (feeding) {
          const local = ((a.t - 0.55) % 0.48) / 0.48;
          pos = new THREE.Vector3(-0.2, 0.09 - 0.03 * Math.sin(local * Math.PI), 0.035);
        }
      }
      const right = blend(g.right, { pos, fingers: new THREE.Vector3(0.6, -0.2, -0.75), palm: new THREE.Vector3(0, -0.4, -1), curl: [0.8, 0.9, 0.95, 1.0], thumb: 0.3 }, w);
      return { right, left: g.left };
    }
    return g;
  }

  private updateBullets(dt: number) {
    const g = 9.81;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let remaining = dt;
      let dead = false;
      while (remaining > 0 && !dead) {
        const h = Math.min(remaining, 1 / 240);
        remaining -= h;
        const speed = b.vel.length();
        b.vel.addScaledVector(b.vel, -b.drag * speed * h);
        b.vel.y -= g * h;
        const step = b.vel.clone().multiplyScalar(h);
        const len = step.length();
        const dir = step.clone().divideScalar(len);
        // other players' bullets pass through nothing special: they stop on the world and on bodies alike
        const hit = physics.raycast(b.pos, dir, len, SHOT_GROUPS, b.ghost ? undefined : this.player.collider);
        if (hit) {
          const pt = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
          const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          const target = this.resolveTarget(hit.tag?.owner);
          const dist = b.travelled + hit.toi;
          const energy = (speed * speed) / (BALLISTICS.rifle.muzzleVel * BALLISTICS.rifle.muzzleVel);
          if (target) {
            if (!b.ghost) {
              const zone = hit.tag?.zone ?? 'torso';
              const dmg = b.damage * Math.max(0.35, Math.min(1, energy * 1.6 + 0.4)) * ZONE_MULT[zone][0];
              const killed = target.damage(dmg, pt, dir, zone);
              this.markHit(killed);
              this.onHit({ victim: target, weapon: b.weapon, target: target.name, zone, damage: dmg, killed, distance: dist, melee: false });
            }
            this.fx.impact('flesh', pt, n, false);
            audio.impact('flesh', pt, b.ghost ? pt.distanceTo(this.mainCam?.position ?? pt) : dist);
          } else {
            const s = (hit.tag?.surface ?? 'dirt') as Surface;
            // doors swing: their holes are parented to the door
            const pivot = (hit.tag?.owner as { pivot?: THREE.Object3D } | undefined)?.pivot;
            this.fx.impact(s, pt, n, true, pivot);
            audio.impact(s, pt, b.ghost ? pt.distanceTo(this.mainCam?.position ?? pt) : dist);
          }
          dead = true;
          break;
        }
        // somebody else's bullet going past your head: you hear the crack before you know where from
        if (b.ghost && !b.heard && this.mainCam && b.travelled > 6) {
          const toCam = _toCam.copy(this.mainCam.position).sub(b.pos);
          const along = toCam.dot(dir);
          if (along <= len) {
            // the nearest point of this step's path
            b.heard = true;
            const miss = toCam.addScaledVector(dir, -Math.max(0, along)).length();
            if (miss < 5) audio.whiz(_toCam.copy(b.pos).addScaledVector(dir, Math.max(0, along)), miss, 0, speed > 343);
          }
        }
        b.pos.add(step);
        b.travelled += len;
      }
      b.life -= dt;
      if (dead || b.life <= 0 || b.pos.y < -200) this.bullets.splice(i, 1);
    }
  }

  private animate(dt: number, input: Input, camera: THREE.PerspectiveCamera) {
    const m = this.current;
    this.vmCamera.quaternion.copy(camera.quaternion);
    this.vmCamera.position.set(0, 0, 0);
    this.vmCamera.updateMatrixWorld();
    const p = this.player;

    // viewmodel lighting: is the camera in sun shadow / under a roof?
    const eye = camera.position;
    const sunBlocked = physics.raycast(eye, this.atmo.sunDir, 120, SHOT_GROUPS, p.collider) !== null;
    const roof = physics.raycast(eye, { x: 0, y: 1, z: 0 }, 30, SHOT_GROUPS, p.collider) !== null;
    this.sunVis += ((sunBlocked ? 0.06 : 1) - this.sunVis) * (1 - Math.exp(-8 * dt));
    this.skyVis += ((roof ? 0.35 : 1) - this.skyVis) * (1 - Math.exp(-4 * dt));
    this.sunLight.intensity = this.atmo.sunIntensity * this.sunVis;
    this.vmScene.environmentIntensity = 0.9 * this.skyVis;

    // an item in use takes over the hands; whatever was held drops out of view
    this.lowerT += ((this.held && !this.held.ending ? 1 : 0) - this.lowerT) * (1 - Math.exp(-10 * dt));
    if (this.held) {
      if (m) m.root.visible = false;
      this.animateHeld(dt);
      return;
    }
    if (!m) {
      this.animateFists(dt);
      return;
    }

    // springs
    const kick = this.kick.step(dt);
    const kr = this.kickRot.step(dt);
    // mouse sway: weapon lags behind the look direction
    const sw = this.sway.step(dt, new THREE.Vector3(input.mouseDX * 0.0009, input.mouseDY * 0.0009, 0).clampScalar(-0.06, 0.06));

    const ads = this.adsT;
    const adsPos = m.adsIron && !hasMod(this.currentItem, 'pu_scope') ? m.adsIron : m.ads;
    const pos = new THREE.Vector3().lerpVectors(m.hip, adsPos, ads);
    const rot = new THREE.Euler(0, 0, 0);

    // bob
    const amp = p.movingSmooth * (p.grounded ? 1 : 0) * (1 - ads * 0.8);
    const ph = p.bobPhase;
    pos.x += Math.cos(ph) * 0.012 * amp;
    pos.y += -Math.abs(Math.sin(ph)) * 0.014 * amp;
    rot.z += Math.cos(ph) * 0.02 * amp;
    // idle breathing
    pos.y += Math.sin(this.time * 1.6) * 0.0018 * (1 - ads);
    // sprint pose
    const sp = this.sprintT;
    pos.add(new THREE.Vector3(0.04, -0.06, 0.04).multiplyScalar(sp));
    rot.x += -0.25 * sp;
    rot.y += 0.65 * sp;
    rot.z += 0.35 * sp;
    // sway
    rot.y += sw.x * (1 - ads * 0.7) * 4;
    rot.x += sw.y * (1 - ads * 0.7) * 4;
    // sidestepping: the gun rolls and trails a little behind the move
    rot.z += p.strafe * -0.045 * (1 - ads * 0.6);
    pos.x += p.strafe * -0.006 * (1 - ads);
    // off the ground: it rides up a touch with the arms
    this.airT += ((p.grounded ? 0 : 1) - this.airT) * (1 - Math.exp(-7 * dt));
    pos.y += this.airT * 0.012 * (1 - ads);
    rot.x += this.airT * 0.05 * (1 - ads);

    // actions
    const a = this.action;
    if (a) {
      const k = Math.min(1, a.t / a.dur);
      const bell = Math.sin(k * Math.PI);
      if (a.name === 'equip') {
        const e = 1 - Math.pow(1 - k, 3);
        pos.y -= (1 - e) * 0.35;
        rot.x -= (1 - e) * 0.8;
      } else if (a.name === 'unequip') {
        pos.y -= k * k * 0.35;
        rot.x -= k * 0.8;
      } else if (a.name === 'bolt' && m.bolt && m.boltSlide) {
        // handle up (0-0.2), back (0.2-0.45), forward (0.45-0.7), down (0.7-0.9)
        const seg = (t0: number, t1: number) => THREE.MathUtils.smoothstep(k, t0, t1);
        const up = seg(0.05, 0.22) - seg(0.72, 0.9);
        const back = seg(0.22, 0.45) - seg(0.48, 0.7);
        m.bolt.rotation.x = -up * 1.25;
        m.boltSlide.position.x = -back * 0.075;
        rot.z += bell * 0.28 * (1 - ads * 0.5);
        rot.x += bell * 0.05;
        pos.y -= bell * 0.015;
      } else if (a.name === 'reload') {
        const open = THREE.MathUtils.smoothstep(a.t, 0.1, 0.45) * (1 - THREE.MathUtils.smoothstep(a.t, a.dur - 0.45, a.dur - 0.1));
        if (m.bolt && m.boltSlide) {
          m.bolt.rotation.x = -open * 1.25;
          m.boltSlide.position.x = -Math.min(1, open * 1.4) * 0.075 * open;
        }
        const tilt = THREE.MathUtils.smoothstep(a.t, 0, 0.35) * (1 - THREE.MathUtils.smoothstep(a.t, a.dur - 0.35, a.dur));
        rot.z += tilt * 0.55;
        rot.x += tilt * 0.22;
        pos.add(new THREE.Vector3(-0.06, 0.03, 0.05).multiplyScalar(tilt));
        // a round slides into the action every 0.48 s
        if (m.round) {
          const local = (a.t - 0.55) % 0.48;
          m.round.visible = a.t > 0.55 && a.t < a.dur - 0.5 && local < 0.3;
          m.round.position.y = 0.05 - (local / 0.3) * 0.05;
        }
      } else if (a.name === 'magswap') {
        const long = m.kind === 'auto';
        const tilt = THREE.MathUtils.smoothstep(a.t, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(a.t, a.dur - 0.3, a.dur));
        rot.z -= tilt * (long ? 0.6 : 0.45);
        rot.x += tilt * (long ? 0.18 : 0.3);
        pos.add(new THREE.Vector3(long ? -0.08 : -0.04, long ? 0.05 : 0.02, 0.06).multiplyScalar(tilt));
        if (m.mag) {
          const [o0, o1, i0, i1] = long ? [0.2, 0.55, 1.05, 1.35] : [0.1, 0.35, 0.75, 1.05];
          const out = THREE.MathUtils.smoothstep(a.t, o0, o1) * (1 - THREE.MathUtils.smoothstep(a.t, i0, i1));
          m.mag.position.y = -out * (long ? 0.24 : 0.18);
          // AK mags rock forward out of the well
          if (long && m.mag.children[0]) m.mag.children[0].rotation.z = out * 0.5;
          m.mag.visible = !(a.t > o1 && a.t < i0);
          if (!long && m.mag.children[0]) m.mag.children[0].visible = out > 0.04;
        }
        if (m.charging && long && a.dur > 2) {
          const pull = THREE.MathUtils.smoothstep(a.t, 1.8, 1.92) * (1 - THREE.MathUtils.smoothstep(a.t, 1.98, 2.08));
          m.charging.position.x = -pull * 0.085;
        }
      } else if (a.name === 'swing') {
        const wind = THREE.MathUtils.smoothstep(k, 0, 0.3);
        const strike = THREE.MathUtils.smoothstep(k, 0.3, 0.5);
        const recover = THREE.MathUtils.smoothstep(k, 0.55, 1);
        rot.x += (wind * 0.9 - strike * 2.0) * (1 - recover);
        rot.y += (wind * 0.4 - strike * 0.6) * (1 - recover);
        pos.add(new THREE.Vector3(-0.08 * strike, 0.08 * wind, -0.12 * strike).multiplyScalar(1 - recover));
      }
    } else {
      if (m.bolt) m.bolt.rotation.x = 0;
      if (m.boltSlide) m.boltSlide.position.x = 0;
      if (m.round) m.round.visible = false;
      if (m.mag) {
        m.mag.position.y = 0;
        if (m.mag.children[0] && m.kind === 'auto') m.mag.children[0].rotation.z = 0;
        m.mag.visible = true;
      }
    }

    // pistol slide: snaps back on fire, stays locked when empty
    this.slideKick = Math.max(0, this.slideKick - dt * 22);
    if (m.slide) {
      const back = this.chamberEmpty && (!a || a.name !== 'magswap' || a.t < a.dur - 0.35) ? 1 : this.slideKick;
      m.slide.position.x = -back * 0.028;
    }
    // AK bolt carrier: charging handle reciprocates with every shot
    if (m.charging && (!a || a.name !== 'magswap')) m.charging.position.x = -this.slideKick * 0.08;
    if (m.selector && this.currentItem) {
      const target = this.fireMode(this.currentItem) === 'auto' ? -0.012 : 0;
      m.selector.position.y += (target - m.selector.position.y) * (1 - Math.exp(-20 * dt));
    }

    if (m.hipRot) {
      rot.x += m.hipRot.x * (1 - ads);
      rot.y += m.hipRot.y * (1 - ads);
      rot.z += m.hipRot.z * (1 - ads);
    }

    // recoil
    pos.z += kick.z * 0.06;
    pos.y += kick.y * 0.02;
    rot.x += kr.x * 0.012;
    rot.z += kr.z * 0.01;

    // coming back up after using an item
    pos.y -= this.lowerT * 0.35;
    rot.x -= this.lowerT * 0.7;

    m.root.position.copy(pos);
    m.root.rotation.copy(rot);
    // scope view takes over once fully aimed down the PU scope
    m.root.visible = !this.scoped;
    this.arms.update(m.body ?? null, this.actionGrips(m), this.vmCamera.quaternion, !this.scoped);
  }

  /** Bare hands: a loose guard that comes up to punch or block, driven through the same arm IK as weapons. */
  private animateFists(dt: number) {
    const p = this.player;
    this.guardHold = Math.max(0, this.guardHold - dt);
    const want = this.guardHold > 0 && !p.dead ? 1 : 0;
    this.guardT += (want - this.guardT) * (1 - Math.exp(-(want ? 14 : 6) * dt));
    const g = this.guardT;
    if (g < 0.02) {
      this.arms.update(null, null, this.vmCamera.quaternion, false);
      return;
    }
    const bobA = p.movingSmooth * (p.grounded ? 1 : 0);
    const ph = p.bobPhase;
    const bob = new THREE.Vector3(Math.cos(ph) * 0.01 * bobA, -Math.abs(Math.sin(ph)) * 0.012 * bobA + Math.sin(this.time * 1.7) * 0.003, 0);
    const lerp3 = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
    const hand = (side: 1 | -1, strike: number): HandGrip => {
      const down = new THREE.Vector3(side * 0.23, -0.58, -0.22);
      // orthodox stance: left leads, right sits back by the chin
      const guard = side > 0 ? new THREE.Vector3(0.135, -0.16, -0.4) : new THREE.Vector3(-0.125, -0.14, -0.46);
      const out = new THREE.Vector3(side * 0.035, -0.085, -0.74);
      const pos = lerp3(lerp3(down, guard, g), out, strike).add(bob);
      // guard shows the backs of the fists, knuckles up; the fist turns over (palm down) as the punch extends
      const fingers = lerp3(new THREE.Vector3(-side * 0.2, 0.9, -0.35), new THREE.Vector3(-side * 0.08, 0.05, -1), strike).normalize();
      const palm = lerp3(new THREE.Vector3(-side * 0.45, -0.25, -1), new THREE.Vector3(-side * 0.15, -1, 0), strike).normalize();
      return { pos, fingers, palm, curl: [1.85, 1.9, 1.9, 1.9], thumb: 0.6, tuck: 1 };
    };
    let sr = 0, sl = 0;
    const a = this.action;
    if (a && a.name === 'punch' && a.data) {
      const k = Math.min(1, a.t / a.dur);
      // snap out, short hold, pull back
      const ext = THREE.MathUtils.smoothstep(k, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(k, 0.42, 1));
      if (a.data.hand) sr = ext;
      else sl = ext;
    }
    this.kick.step(dt);
    const kr = this.kickRot.step(dt);
    this.fistAnchor.position.set(0, 0, 0);
    this.fistAnchor.rotation.set(kr.x * 0.004, 0, 0);
    this.arms.update(this.fistAnchor, { right: hand(1, sr), left: hand(-1, sl) }, this.vmCamera.quaternion, true);
  }

  /** Item in use: brought up from below, worked on (bites, sips, wraps), then put away. */
  private animateHeld(dt: number) {
    const h = this.held!;
    h.t += dt;
    if (h.ending) h.ending += dt;
    const enter = THREE.MathUtils.smoothstep(h.t, 0, 0.3);
    const exit = h.ending ? THREE.MathUtils.smoothstep(h.ending, 0, 0.22) : 0;
    const up = enter * (1 - exit);
    if (h.ending > 0.24) {
      this.vmRoot.remove(h.root);
      this.held = null;
      this.arms.update(null, null, this.vmCamera.quaternion, false);
      return;
    }
    const t = h.t;
    // bigger things are held a little further out so the hand and the item both stay in frame
    const sy = h.size.y;
    const wide = Math.min(h.size.x, h.size.z);
    const pos = new THREE.Vector3(0.11 - wide * 0.3, -0.16 - sy * 0.25, -(0.36 + sy * 0.35));
    const rot = new THREE.Euler(0, 0, 0);
    const two = h.kind === 'bandage' || h.kind === 'open' || Math.min(h.size.x, h.size.z) > 0.16;
    if (h.kind === 'eat' || h.kind === 'drink') {
      // up to the mouth and back, once per bite / gulp
      const period = h.kind === 'eat' ? 0.95 : 1.25;
      const cyc = 0.5 - 0.5 * Math.cos((Math.max(0, t - 0.3) / period) * Math.PI * 2);
      const m = h.kind === 'drink' ? Math.pow(cyc, 0.6) : cyc;
      pos.lerp(new THREE.Vector3(0.03, -0.1 - sy * 0.3, -(0.24 + sy * 0.2)), m * 0.92);
      rot.x = (h.kind === 'drink' ? 0.95 : 0.35) * m;
      rot.z = -0.15 * m;
    } else if (h.kind === 'bandage') {
      pos.set(-0.02 + Math.cos(t * 5.5) * 0.035, -0.17 + Math.sin(t * 5.5) * 0.03, -0.38);
      rot.set(0.5, t * 5.5 * 0.15, 0.3);
    } else {
      pos.set(0, -0.17 - sy * 0.25 + Math.sin(t * 9) * 0.004, -(0.38 + sy * 0.3));
      rot.set(0.45, 0.25 + Math.sin(t * 4.5) * 0.05, 0);
    }
    pos.y -= (1 - up) * 0.4;
    h.root.position.copy(pos);
    h.root.rotation.copy(rot);
    h.root.visible = true;
    const half = Math.min(h.size.x, h.size.z) / 2;
    const reach = Math.min(1, half / 0.06);
    const curl = THREE.MathUtils.lerp(1.25, 0.75, reach);
    const grip = (side: 1 | -1): HandGrip => ({
      pos: new THREE.Vector3(side * (half + 0.035), -h.size.y * 0.15, 0.055),
      fingers: new THREE.Vector3(-side * 0.35, 0.2, -0.9),
      palm: new THREE.Vector3(-side, 0, 0),
      curl: [curl, curl + 0.05, curl + 0.1, curl + 0.15],
      thumb: 0.5,
    });
    let right = grip(1);
    let left: HandGrip | null = two ? grip(-1) : null;
    if (h.kind === 'open') {
      // left hand holds the box, right hand pries the latch on top
      const w = 0.5 + 0.5 * Math.sin(t * 6);
      right = {
        pos: new THREE.Vector3(half + 0.06, h.size.y * 0.5 + 0.035 + w * 0.02, 0.07),
        fingers: new THREE.Vector3(-0.75, -0.25, -0.6),
        palm: new THREE.Vector3(-0.2, -1, 0),
        curl: [0.5 + w * 0.3, 0.6 + w * 0.3, 0.9, 1.0],
        thumb: 0.4,
      };
    }
    this.arms.update(h.root, { right, left }, this.vmCamera.quaternion, true);
  }
}
