// World items: the Central Economy decides *what* exists where; this module gives
// each entry a mesh + an interaction trigger, rests it properly on whatever it lies on
// (shelf, table, floor, sloped ground) and manages stash crates and searchable crates.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { physics, G_TRIGGER, groups, WORLD_GROUPS, SOLID_GROUPS } from '../core/physics';
import { extractParts, groundParts, restWhileHidden, type MeshPart } from '../core/gltf-utils';
import { ITEMS, type ItemInstance, pieceShown } from '../sim/items';
import { liftPack } from './rig';
import { fitsPoint } from '../sim/placement';
import { proceduralParts } from './procedural';
import { Container } from '../sim/inventory';
import type { WorldLoot } from '../sim/economy';
import type { Atmosphere } from '../world/atmosphere';
import type { LootPoint } from '../world/buildings';

export interface ItemTemplate {
  group: THREE.Group;
  size: THREE.Vector3;
  /** this is the lighter copy of it, drawn from a few metres off: the whole model is got with this, when the eye comes near */
  whole?: () => Promise<ItemTemplate>;
  /** when one of it was last near enough to be drawn, seconds of this game (see LootManager.update) */
  seen?: number;
  /** its pictures have been taken off the graphics card since: they go back on the next time one of it is drawn */
  cold?: boolean;
}

/** seconds a sort of thing has to have been out of sight before its pictures are taken off the card */
const COLD_AFTER = 15;
/**
 * How near the eye comes before a thing on the ground is drawn with its whole model in place of its lighter copy,
 * and how far it goes before the lighter copy comes back (metres). The copy is the same shape and the same paint
 * with a tenth or a fiftieth of the triangles (scripts/lods.mjs): at nine metres a box of rounds is twenty-five pixels
 * across. (2026-10-12: nineteen such boxes in sight were 1.7 million triangles a frame, and the first sight of
 * each sort of thing stopped the game while a hundred thousand triangles were laid out.)
 */
const WHOLE_WITHIN = 9, WHOLE_UNTIL = 11;

const TRIGGER_GROUPS = groups(G_TRIGGER, 0xffff);
const DOWN = { x: 0, y: -1, z: 0 };
const UP = new THREE.Vector3(0, 1, 0);

const repainted = new Map<string, THREE.Texture>();
/**
 * A model's colour picture with what is white on it painted another colour, and everything else as it was:
 * one model, two things told apart by the part of it that is plain (the injector's barrel is white, its caps
 * green, its tip red). A dye over the whole of it (`tint`) turns the caps and the tip too. Light and shade
 * are kept: each white point is given the colour at its own brightness, so the dirt on it is still there.
 */
function whiteTo(src: THREE.Texture, colour: number): THREE.Texture {
  const key = `${src.uuid}:${colour}`;
  const had = repainted.get(key);
  if (had) return had;
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const c = document.createElement('canvas');
  const g = img && img.width ? c.getContext('2d', { willReadFrequently: true }) : null;
  if (!img || !g) return src;
  c.width = img.width;
  c.height = img.height;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height), d = px.data;
  const to = new THREE.Color(colour).convertLinearToSRGB();
  const step = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);
  for (let i = 0; i < d.length; i += 4) {
    const hi = Math.max(d[i], d[i + 1], d[i + 2]), lo = Math.min(d[i], d[i + 1], d[i + 2]);
    // white: bright, and with next to no colour of its own
    const w = step(hi, 118, 172) * (1 - step(hi ? (hi - lo) / hi : 0, 0.14, 0.3));
    if (w <= 0) continue;
    const k = (hi / 232) * 255;
    d[i] += (Math.min(255, to.r * k) - d[i]) * w;
    d[i + 1] += (Math.min(255, to.g * k) - d[i + 1]) * w;
    d[i + 2] += (Math.min(255, to.b * k) - d[i + 2]) * w;
  }
  g.putImageData(px, 0, 0);
  const out = src.clone();
  // (its own picture: a clone shares the first one's)
  out.source = new THREE.Source(c);
  out.needsUpdate = true;
  repainted.set(key, out);
  return out;
}

/** stable 0..1 pseudo-random numbers from an item uid, so placement survives reloads */
function hash01(s: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export class ItemModels {
  private cache = new Map<string, Promise<ItemTemplate>>();
  /** footprint of every item once preloaded (metres, scaled) */
  sizes = new Map<string, THREE.Vector3>();
  constructor(private atmo: Atmosphere) {}

  /** @param far its lighter copy, where it has one (see getFar): the model itself otherwise */
  get(id: string, mods: string[] = [], far = false): Promise<ItemTemplate> {
    const def = ITEMS[id];
    far &&= !def.model.startsWith('@') && !!assets.manifest.models[def.model]?.lods?.[0]?.far;
    const key = (mods.length ? `${id}+${[...mods].sort().join('+')}` : id) + (far ? '~far' : '');
    let p = this.cache.get(key);
    if (!p) {
      // (made, and then got ready to be drawn before anybody is handed it: see `onMade`)
      p = this.build(id, mods, far).then(async (tpl) => {
        if (far) tpl.whole = () => this.get(id, mods);
        await this.onMade(tpl).catch(() => {});
        return tpl;
      });
      this.cache.set(key, p);
      void p.then((tpl) => this.done.push(tpl), () => {});
    }
    return p;
  }

  /**
   * A model has just been made, and is not yet anybody's: what has to be done before it is first drawn is done
   * here (the game has its shaders made, off the frame). Every item's model used to be fetched and warmed before
   * the game could be played; now each is fetched when a thing of its kind is first near, and this is what keeps
   * the first sight of it from costing a frame.
   */
  onMade: (tpl: ItemTemplate) => Promise<void> = async () => {};

  /** every model made so far */
  made(): ItemTemplate[] {
    return this.done;
  }
  private done: ItemTemplate[] = [];

  /** the model for a specific item: a scoped, wrapped rifle looks the part on the ground too */
  getFor(item: ItemInstance): Promise<ItemTemplate> {
    return this.get(item.id, (item.mods ?? []).filter((m) => m === 'pu_scope' || m === 'rifle_wrap'));
  }

  /** The model a thing is laid on the ground with: its lighter copy where there is one (its `whole` gets the model itself). */
  getFar(item: ItemInstance): Promise<ItemTemplate> {
    return this.get(item.id, (item.mods ?? []).filter((m) => m === 'pu_scope' || m === 'rifle_wrap'), true);
  }

  private async build(id: string, mods: string[], far = false): Promise<ItemTemplate> {
    const def = ITEMS[id];
    let parts: MeshPart[];
    if (def.model.startsWith('@')) parts = proceduralParts(def.model);
    else {
      const scene = await assets.model(def.model, far ? 1 : 0);
      const re = def.nodeRe ? new RegExp(def.nodeRe) : null;
      parts = re ? extractParts(scene, (n) => re.test(n)) : def.node ? extractParts(scene, (n) => n === def.node) : extractParts(scene);
      // a gun lies there as it is: bare, or with whatever is fitted to it
      if (def.weapon) parts = parts.filter((p) => pieceShown(id, p.name.replace(/_\d+$/, ''), mods));
      // (what came out of a weapon pack is painted near black: lifted once, for the ground and the icon alike)
      if (assets.manifest.models[def.model]?.holds) {
        for (const p of parts) {
          if (!p.material.userData.lifted) liftPack(p.material).userData.lifted = true;
        }
      }
    }
    // (dyed: its own copy of each material, so that the other things made of the same model keep their colours)
    if (def.tint !== undefined) {
      const dye = new THREE.Color(def.tint);
      parts = parts.map((p) => {
        const m = (p.material as THREE.MeshStandardMaterial).clone();
        m.color.multiply(dye);
        return { ...p, material: m };
      });
    }
    if (def.paint !== undefined) {
      parts = parts.map((p) => {
        const m = (p.material as THREE.MeshStandardMaterial).clone();
        // (its own picture, made here: not changed for the model's as it came when the thing is close)
        delete m.userData.hi;
        if (m.map) m.map = whiteTo(m.map, def.paint!);
        return { ...p, material: m };
      });
    }
    // guns rest on their side when dropped, not balanced on the magazine
    if (def.category === 'weapon') {
      const lay = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      for (const p of parts) p.geometry = p.geometry.clone().applyMatrix4(lay);
    }
    let box = groundParts(parts);
    // Things the model stands on end or on a thin edge lie down in the world: bats,
    // crowbars, machetes, knives, stick grenades, magazines, a vest, upright cartridges.
    // Cans, bottles, boxes and boots stay standing.
    {
      const sz = box.getSize(new THREE.Vector3());
      const k = def.scale ?? 1;
      const minH = Math.min(sz.x, sz.z);
      const stick = sz.y > Math.max(sz.x, sz.z) * 2 && (sz.y * k > 0.34 || !!def.pile);
      const onEdge = sz.y > minH * 1.5 && (minH * k < 0.05 || (sz.y / minH > 4 && sz.y * k > 0.34));
      if (def.category !== 'weapon' && (stick || onEdge)) {
        // tip it over its thinnest side so it rests on its biggest face
        const lay = sz.x <= sz.z ? new THREE.Matrix4().makeRotationZ(Math.PI / 2) : new THREE.Matrix4().makeRotationX(-Math.PI / 2);
        for (const p of parts) p.geometry = p.geometry.clone().applyMatrix4(lay);
        box = groundParts(parts);
      }
    }
    if (def.pile) {
      // loose rounds: a small scatter of cartridges lying side by side
      const sz = box.getSize(new THREE.Vector3());
      const alongX = sz.x >= sz.z;
      const d = Math.min(sz.x, sz.z) * 1.25;
      for (const p of parts) {
        const copies: THREE.BufferGeometry[] = [];
        for (let i = 0; i < def.pile; i++) {
          const g = p.geometry.clone();
          const yaw = (hash01(id, i) - 0.5) * 0.9;
          const off = (i - (def.pile - 1) / 2) * d;
          const slide = (hash01(id, i + 31) - 0.5) * Math.max(sz.x, sz.z) * 0.35;
          g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(alongX ? slide : off, 0, alongX ? off : slide));
          copies.push(g);
        }
        p.geometry = mergeGeometries(copies, false)!;
      }
      box = groundParts(parts);
    }
    // The pieces of it that are painted with the one paint are made one piece: a box of rounds came as fifty-three
    // (every round of it its own), a rifle as twenty-nine, and each piece is a thing for the card to be told of
    // on every frame it is in sight, and again for every shadow it casts. (Pieces that cannot be made one, having
    // different things said of their points, are left as they were.)
    {
      const by = new Map<THREE.Material, MeshPart[]>();
      for (const p of parts) by.set(p.material, [...(by.get(p.material) ?? []), p]);
      const made: MeshPart[] = [];
      for (const [material, list] of by) {
        // (they can be made one if the same things are said of every point of each, and each says its triangles the same way)
        const said = (g: THREE.BufferGeometry) => `${!!g.index}|${Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}${g.attributes[k].array.constructor.name}${g.attributes[k].normalized}`).join()}|${Object.keys(g.morphAttributes).length}`;
        const alike = list.every((p) => said(p.geometry) === said(list[0].geometry));
        const one = list.length > 1 && alike ? mergeGeometries(list.map((p) => p.geometry), false) : null;
        if (one) made.push({ ...list[0], geometry: one, material });
        else made.push(...list);
      }
      parts = made;
    }
    const group = new THREE.Group();
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geometry, p.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.atmo.register(p.material);
      group.add(mesh);
    }
    const s = def.scale ?? 1;
    group.scale.setScalar(s);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(s);
    if (!mods.length && !far) this.sizes.set(id, size);
    return { group, size };
  }
}

export class WorldItem {
  obj: THREE.Object3D;
  collider: RAPIER.Collider;
  private meshes: THREE.Mesh[] = [];
  private shadows = true;
  constructor(public loot: WorldLoot, public tpl: ItemTemplate, scene: THREE.Scene, normal: THREE.Vector3 | null) {
    this.obj = tpl.group.clone();
    this.obj.position.set(loot.x, loot.y, loot.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, loot.rot);
    // on sloped ground the item lies flat on the slope
    if (normal && normal.y < 0.9995) q.premultiply(new THREE.Quaternion().setFromUnitVectors(UP, normal));
    this.obj.quaternion.copy(q);
    this.obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.meshes.push(o as THREE.Mesh);
      // (it lies where it lies: where it is, is worked out when it is put there, and not again on every frame)
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    restWhileHidden(this.obj);
    scene.add(this.obj);
    const hx = Math.max(0.08, tpl.size.x / 2 + 0.03);
    const hy = Math.max(0.06, tpl.size.y / 2 + 0.02);
    const hz = Math.max(0.08, tpl.size.z / 2 + 0.03);
    const desc = physics.R.ColliderDesc.cuboid(hx, hy, hz)
      .setSensor(true)
      .setTranslation(loot.x, loot.y + hy, loot.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCollisionGroups(TRIGGER_GROUPS);
    this.collider = physics.world.createCollider(desc);
    physics.tag(this.collider, { surface: 'cloth', owner: this });
  }

  // a dropped item leaves the hand, turns over in the air and comes to rest
  private toss: { from: THREE.Vector3; to: THREE.Vector3; rest: THREE.Quaternion; spin: THREE.Quaternion; t: number } | null = null;

  /** Dropped from `from` (the hands): fall to the resting place instead of appearing on it. */
  tossFrom(from: THREE.Vector3) {
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 2.4, Math.random() * 3, (Math.random() - 0.5) * 2.4));
    this.toss = { from: from.clone(), to: this.obj.position.clone(), rest: this.obj.quaternion.clone(), spin: spin.multiply(this.obj.quaternion), t: 0 };
    this.obj.position.copy(from);
    this.obj.quaternion.copy(this.toss.spin);
    this.obj.updateMatrix();
  }

  /** advance the fall; true once it has landed */
  private fly(dt: number) {
    const a = this.toss;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / 0.42);
    const k = a.t;
    // out and down like something let go of: steady sideways, speeding up as it falls
    this.obj.position.lerpVectors(a.from, a.to, k);
    this.obj.position.y = a.from.y + (a.to.y - a.from.y) * k * k + Math.sin(k * Math.PI) * 0.08;
    this.obj.quaternion.slerpQuaternions(a.spin, a.rest, 1 - (1 - k) * (1 - k));
    if (k >= 1) {
      this.obj.position.copy(a.to);
      this.obj.quaternion.copy(a.rest);
      this.toss = null;
    }
    this.obj.updateMatrix();
  }

  get flying() {
    return !!this.toss;
  }

  update(dt: number) {
    this.fly(dt);
  }

  /** it is drawn with its whole model now, not its lighter copy (see WHOLE_WITHIN) */
  whole = false;
  /** the whole model has been sent for */
  asked = false;

  /** Drawn with another model of the same thing: its whole one in place of its lighter copy, or back. */
  useModel(tpl: ItemTemplate, whole: boolean) {
    if (this.whole === whole) return;
    this.whole = whole;
    for (const m of this.meshes) this.obj.remove(m);
    this.meshes = [];
    for (const c of tpl.group.children) {
      if (!(c as THREE.Mesh).isMesh) continue;
      const m = (c as THREE.Mesh).clone();
      m.castShadow = this.shadows;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.obj.add(m);
      this.meshes.push(m);
    }
    this.obj.updateMatrixWorld(true);
  }

  /** each shadow-casting mesh is drawn once per shadow cascade: only worth it up close */
  setShadows(on: boolean) {
    if (on === this.shadows) return;
    this.shadows = on;
    for (const m of this.meshes) m.castShadow = on;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.obj);
    physics.tags.delete(this.collider.handle);
    physics.world.removeCollider(this.collider, false);
  }
}

/**
 * A container standing in the world. Either a stash crate the player put down (can be
 * packed up again when empty) or a crate that is part of the map (`fixed`, searched for loot).
 */
export class Stash {
  container: Container;
  obj?: THREE.Object3D;
  collider!: RAPIER.Collider;
  fixed = false;
  /** multiplayer: contents were fetched from the server at least once */
  known = false;
  /** a dead player's body: searched like a crate, gone once it despawns */
  corpse = false;
  /** prop kind of a map crate (selects its loot table) */
  kind = '';
  /** game time when a map crate was last found empty (drives restocking) */
  emptiedAt = -1;
  /** a stash somebody put down: what it is (the stash case, or a pack by its item) */
  item = 'stash_kit';
  /** it is under the ground: turned earth is all that is seen of it, and a shovel brings it up */
  buried = false;
  private scene?: THREE.Scene;
  /** how big what stands there is */
  private box?: THREE.Vector3;
  private mound?: THREE.Mesh;
  constructor(public uid: string, public x: number, public y: number, public z: number, public rot: number, w = 8, h = 6, public label = 'Stash Crate') {
    this.container = new Container(`stash:${uid}`, label, w, h, [], true);
  }

  spawn(tpl: ItemTemplate, scene: THREE.Scene) {
    this.obj = tpl.group.clone();
    // (it stands as big as it is, which is bigger than it is carried: see `place` in src/sim/items.ts)
    const def = ITEMS[this.item] ?? ITEMS.stash_kit, big = def.place ?? 1;
    this.obj.scale.setScalar(big);
    this.obj.position.set(this.x, this.y, this.z);
    this.obj.rotation.y = this.rot;
    scene.add(this.obj);
    this.scene = scene;
    this.box = tpl.size.clone().multiplyScalar(big / (def.scale ?? 1));
    this.stand();
    if (this.buried) this.setBuried(true);
  }

  /** what stands there is in the way of feet and of rounds */
  private stand() {
    const s = this.box!;
    const half = this.rot / 2;
    const desc = physics.R.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2)
      .setTranslation(this.x, this.y + s.y / 2, this.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setCollisionGroups(WORLD_GROUPS)
      .setSolverGroups(WORLD_GROUPS);
    this.collider = physics.world.createCollider(desc);
    physics.tag(this.collider, { surface: this.item === 'black_bag' ? 'cloth' : 'wood', owner: this });
  }

  /**
   * Under the ground, or up out of it. Buried, nothing of it is seen but a low heap of turned earth, which is
   * walked over, and looked at by whoever has a shovel.
   */
  setBuried(on: boolean) {
    this.buried = on;
    if (!this.obj || !this.scene || !this.box) return;
    this.obj.visible = !on;
    physics.tags.delete(this.collider.handle);
    physics.world.removeCollider(this.collider, false);
    if (!on) {
      this.stand();
      if (this.mound) this.scene.remove(this.mound);
      return;
    }
    const desc = physics.R.ColliderDesc.cuboid(0.6, 0.16, 0.6).setSensor(true).setTranslation(this.x, this.y + 0.1, this.z).setCollisionGroups(TRIGGER_GROUPS);
    this.collider = physics.world.createCollider(desc);
    physics.tag(this.collider, { surface: 'grass', owner: this });
    this.mound ??= turnedEarth();
    this.mound.position.set(this.x, this.y - 0.03, this.z);
    this.mound.rotation.y = this.rot;
    this.scene.add(this.mound);
  }

  /** interaction-only volume (bodies): you can look at it and search it, but walk through it */
  /** @param back how far behind the container's own position the middle of the box lies (a body falls backwards) */
  /** @param back how far behind where it stands the box sits (negative = ahead); @param left how far to its left */
  trigger(hx: number, hy: number, hz: number, back = 0, left = 0) {
    const half = this.rot / 2;
    const desc = physics.R.ColliderDesc.cuboid(hx, hy, hz)
      .setSensor(true)
      .setTranslation(this.x + Math.sin(this.rot) * back - Math.cos(this.rot) * left, this.y + hy, this.z + Math.cos(this.rot) * back + Math.sin(this.rot) * left)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setCollisionGroups(TRIGGER_GROUPS);
    this.collider = physics.world.createCollider(desc);
    this.fixed = true;
    physics.tag(this.collider, { surface: 'flesh', owner: this });
  }

  /** take over a crate prop that already stands in the world */
  adopt(collider: RAPIER.Collider) {
    this.collider = collider;
    this.fixed = true;
    physics.tag(collider, { surface: 'wood', owner: this });
  }

  dispose(scene: THREE.Scene) {
    if (this.obj) scene.remove(this.obj);
    if (this.mound) scene.remove(this.mound);
    physics.tags.delete(this.collider.handle);
    physics.world.removeCollider(this.collider, false);
  }

  serialize() {
    return { uid: this.uid, x: this.x, y: this.y, z: this.z, rot: this.rot, container: this.container.serialize(), ...(this.item !== 'stash_kit' ? { item: this.item } : {}), ...(this.buried ? { buried: true } : {}) };
  }
}

/** how near the eye a thing lying in the world is made, metres: well beyond the 55 at which it is first drawn, so that it is there by then */
const MAKE_WITHIN = 90;

/**
 * Where something has been buried: a low heap of the ground's own mud, a little uneven, as a spade leaves it.
 * (One of the ground's own pictures, so that it is earth of the place and not a thing set down on it.)
 */
let earth: THREE.MeshStandardMaterial | null = null;
function turnedEarth(): THREE.Mesh {
  if (!earth) {
    const t = assets.pbr('brown_mud_leaves_01');
    earth = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 1, metalness: 0, color: 0x74685a });
  }
  const g = new THREE.SphereGeometry(0.72, 22, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // (low, longer than it is wide, and lumpy: clods, not a dome)
    const lump = 1 + 0.16 * Math.sin(x * 9.1 + z * 4.3) * Math.cos(z * 7.7 - x * 2.9);
    p.setXYZ(i, x * 1.12 * lump, y * 0.2 * lump, z * 0.82 * lump);
    uv.setXY(i, x * 0.9 + 0.5, z * 0.9 + 0.5);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, earth);
  m.receiveShadow = true;
  return m;
}

export class LootManager {
  items = new Map<string, WorldItem>();
  stashes: Stash[] = [];
  /** searchable crates that are part of the map */
  crates: Stash[] = [];
  models: ItemModels;
  /** called once an item has been laid down at its final resting place */
  onPlaced: (l: WorldLoot) => void = () => {};
  private pending = new Set<string>();

  constructor(private scene: THREE.Scene, atmo: Atmosphere, private points: LootPoint[]) {
    this.models = new ItemModels(atmo);
    // (a thing repainted from its model's picture reads that picture when it is first made, whenever that is)
    for (const d of Object.values(ITEMS)) if (d.paint !== undefined && !d.model.startsWith('@')) assets.keepPictures(d.model);
  }

  /**
   * Things that lie too far off to be seen, waiting to be made. A thing is drawn within 55 m of the eye. Its
   * model is sent for, and it is laid on its place, when the eye first comes within MAKE_WITHIN of it: the models
   * of everything lying anywhere on the map (twenty-four megabytes of them) used to be fetched before the game
   * could be played, most of them for things at the far end of it.
   */
  private waiting = new Map<string, WorldLoot>();
  private eye: THREE.Vector3 | null = null;
  private looked = 0;

  /** every thing lying in the world, made or not (what looks for one of a kind anywhere on the map asks this) */
  lying(): WorldLoot[] {
    return [...[...this.items.values()].map((w) => w.loot), ...this.waiting.values()];
  }

  /** where each item about to appear was let go of (uid -> hand position): it falls from there */
  hands = new Map<string, THREE.Vector3>();
  private falling = new Set<WorldItem>();

  /** Can this item type lie at this loot point without hanging off or poking through it? */
  fits = fitsPoint;
  /** extra height of the visible surface over the ground that is collided with (the road's asphalt) */
  lift: (x: number, z: number) => number = () => 0;

  spawn(l: WorldLoot) {
    // (what a hand has just let go of is made at once, and so is anything near; the rest waits for the eye)
    const e = this.eye;
    if (this.hands.has(l.uid) || (e && (l.x - e.x) ** 2 + (l.z - e.z) ** 2 < MAKE_WITHIN * MAKE_WITHIN)) this.make(l);
    else this.waiting.set(l.uid, l);
  }

  private make(l: WorldLoot) {
    this.pending.add(l.uid);
    // (what a hand has just let go of is at arm's length: its whole model at once)
    void (this.hands.has(l.uid) ? this.models.getFor(l.item) : this.models.getFar(l.item)).then((tpl) => {
      if (!this.pending.has(l.uid)) return; // despawned before the model loaded
      this.pending.delete(l.uid);
      const normal = this.place(l, tpl);
      const w = new WorldItem(l, tpl, this.scene, normal);
      this.items.set(l.uid, w);
      const hand = this.hands.get(l.uid);
      if (hand) {
        this.hands.delete(l.uid);
        w.tossFrom(hand);
        this.falling.add(w);
      }
      this.onPlaced(l);
    });
  }

  // ------------------------------------------------------------ placement

  /**
   * Moves a loot entry to a spot where it rests on its surface without clipping into
   * walls, furniture or other props, and returns the ground normal if it lies on a slope.
   */
  private place(l: WorldLoot, tpl: ItemTemplate): THREE.Vector3 | null {
    const hx = tpl.size.x / 2, hy = tpl.size.y / 2, hz = tpl.size.z / 2;
    const pt = l.point >= 0 ? this.points[l.point] : undefined;
    if (pt?.surf) {
      this.placeOnSurface(l, pt, hx, hz);
      return null;
    }
    return this.settleOnGround(l, hx, hy, hz, pt ? 1.2 : 0.9);
  }

  /** Furniture tops and shelves: keep the whole footprint on the board, square to it unless there is room to turn. */
  private placeOnSurface(l: WorldLoot, pt: LootPoint, hx: number, hz: number) {
    const s = pt.surf!;
    const over = 0.03;
    const r0 = hash01(l.uid, 1), r1 = hash01(l.uid, 2), r2 = hash01(l.uid, 3);
    const fitA = hx <= s.hx + over && hz <= s.hz + over;
    const fitB = hz <= s.hx + over && hx <= s.hz + over;
    let rot = s.rot;
    let ax = hx, az = hz; // footprint half extents along the surface's own axes
    if ((!fitA && fitB) || (fitA && fitB && r0 < 0.35)) {
      rot = s.rot + Math.PI / 2;
      ax = hz;
      az = hx;
    }
    const diag = Math.hypot(hx, hz);
    if (diag <= Math.min(s.hx, s.hz)) {
      // small enough to lie at any angle
      rot = r0 * Math.PI * 2;
      ax = az = diag;
    } else {
      const slack = Math.min(s.hx - ax, s.hz - az);
      if (slack > 0.02) rot += (r1 - 0.5) * Math.min(0.5, slack * 4);
    }
    const lx = Math.max(0, s.hx - ax), lz = Math.max(0, s.hz - az);
    const ox = (r1 * 2 - 1) * lx * 0.8, oz = (r2 * 2 - 1) * lz * 0.8;
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    l.x = s.x + ox * c + oz * sn;
    l.z = s.z - ox * sn + oz * c;
    l.y = pt.y;
    l.rot = rot;
  }

  /**
   * Floor loot and dropped items: find the surface under the spot, then the nearest
   * position + heading where the item's box is clear of every solid collider and all
   * four corners are supported. Falls back to the plain drop position.
   */
  private settleOnGround(l: WorldLoot, hx: number, hy: number, hz: number, maxR: number): THREE.Vector3 | null {
    const probe = (x: number, z: number) => {
      const hit = physics.raycast({ x, y: l.y + 0.45, z }, DOWN, 2.5, SOLID_GROUPS);
      // a ray that starts inside a solid (table, crate) reports a hit at distance zero
      return hit && hit.toi > 1e-3 ? hit : null;
    };
    const base = l.rot;
    const a0 = hash01(l.uid, 4) * Math.PI * 2;
    const rings = [0, 0.15, 0.3, 0.5, 0.75, 1.0, 1.25].filter((r) => r <= maxR);
    for (const ring of rings) {
      const steps = ring === 0 ? 1 : 8;
      for (let k = 0; k < steps; k++) {
        const a = a0 + (k / steps) * Math.PI * 2;
        const x = l.x + Math.cos(a) * ring, z = l.z + Math.sin(a) * ring;
        const hit = probe(x, z);
        if (!hit) continue;
        const y = hit.point.y;
        // stay on the same level: never hop onto furniture or off a ledge
        if (ring > 0 && Math.abs(y - l.y) > 0.25) continue;
        const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        if (n.y < 0.75) continue;
        const slope = (Math.abs(n.x) + Math.abs(n.z)) / n.y;
        const lift = 0.04 + slope * Math.max(hx, hz);
        for (let j = 0; j < 6; j++) {
          const rot = base + (j * Math.PI) / 6;
          if (physics.boxOverlaps({ x, y: y + hy + lift, z }, rot, hx + 0.015, Math.max(0.01, hy), hz + 0.015)) continue;
          const c = Math.cos(rot), s = Math.sin(rot);
          let supported = true;
          for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const dx = sx * hx * 0.85 * c + sz * hz * 0.85 * s;
            const dz = -sx * hx * 0.85 * s + sz * hz * 0.85 * c;
            const h = probe(x + dx, z + dz);
            const expect = y - (n.x * dx + n.z * dz) / n.y;
            if (!h || Math.abs(h.point.y - expect) > 0.06) {
              supported = false;
              break;
            }
          }
          if (!supported) continue;
          l.x = x;
          l.y = y + 0.004 + this.lift(x, z);
          l.z = z;
          l.rot = rot;
          return n;
        }
      }
    }
    // nothing better found: at least rest on the surface directly below
    const hit = probe(l.x, l.z);
    if (hit) {
      l.y = hit.point.y + 0.004;
      return new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    }
    return null;
  }

  despawn(l: WorldLoot) {
    this.waiting.delete(l.uid);
    this.pending.delete(l.uid);
    const w = this.items.get(l.uid);
    if (w) {
      w.dispose(this.scene);
      this.items.delete(l.uid);
    }
  }

  async addStash(s: Stash) {
    const tpl = await this.models.get(ITEMS[s.item] ? s.item : 'stash_kit');
    s.spawn(tpl, this.scene);
    this.stashes.push(s);
  }

  /**
   * A supply drop: the crate a stash kit puts down, but nobody's own. It is not kept with the
   * player's stashes (those are saved, and can be packed up and carried off).
   */
  async addDrop(s: Stash) {
    const tpl = await this.models.get('stash_kit');
    s.spawn(tpl, this.scene);
    s.fixed = true;
  }

  removeStash(s: Stash) {
    s.dispose(this.scene);
    this.stashes = this.stashes.filter((x) => x !== s);
  }

  near(p: THREE.Vector3, r: number): WorldItem[] {
    const out: WorldItem[] = [];
    for (const w of this.items.values()) {
      const dx = w.loot.x - p.x, dy = w.loot.y - p.y, dz = w.loot.z - p.z;
      if (dx * dx + dz * dz < r * r && dy > -1 && dy < 2.2) out.push(w);
    }
    return out;
  }

  /** beyond this distance small items stop casting shadows (a graphics option shortens it) */
  shadowDist = 26;

  /**
   * Distance culling. Every item is its own draw call, and one more in each shadow
   * cascade: a tin of beans is a few pixels at 55 m and its shadow is less than one at 26.
   */
  update(cam: THREE.Vector3, dt = 0) {
    for (const w of this.falling) {
      w.update(dt);
      if (!w.flying) this.falling.delete(w);
    }
    this.clock += dt;
    // what the eye has come near enough to is made (looked for four times a second: there are a thousand and more)
    const first = !this.eye;
    (this.eye ??= new THREE.Vector3()).copy(cam);
    if (first || this.clock - this.looked > 0.25) {
      this.looked = this.clock;
      for (const l of this.waiting.values()) {
        if ((l.x - cam.x) ** 2 + (l.z - cam.z) ** 2 >= MAKE_WITHIN * MAKE_WITHIN) continue;
        this.waiting.delete(l.uid);
        this.make(l);
      }
    }
    const s2 = this.shadowDist * this.shadowDist;
    for (const w of this.items.values()) {
      const d2 = (w.loot.x - cam.x) ** 2 + (w.loot.z - cam.z) ** 2;
      const near = d2 < 55 * 55;
      w.obj.visible = near;
      w.setShadows(d2 < s2);
      if (near) {
        w.tpl.seen = this.clock;
        w.tpl.cold = false;
      }
      // its whole model when the eye is near it, its lighter copy again when the eye has gone
      const far = w.tpl.whole;
      if (!far) continue;
      if (d2 < WHOLE_WITHIN * WHOLE_WITHIN) {
        const had = this.wholes.get(w.tpl);
        if (had) {
          had.seen = this.clock;
          had.cold = false;
          w.useModel(had, true);
        } else if (!w.asked) {
          w.asked = true;
          void far().then((tpl) => {
            this.wholes.set(w.tpl, tpl);
            w.asked = false;
          }, () => {});
        }
      } else if (w.whole && d2 > WHOLE_UNTIL * WHOLE_UNTIL) w.useModel(w.tpl, false);
      else if (w.whole) {
        const had = this.wholes.get(w.tpl);
        if (had) had.seen = this.clock;
      }
    }
    // What has not been near for a while has its pictures taken off the graphics card: every sort of thing a walk
    // through a town had passed stayed there for good, a gigabyte of it by the far end of the street. They are
    // kept by the page (they are small: see scripts/tiers.mjs), and go back on the next time one of it is drawn.
    if (this.clock - this.swept > 3) {
      this.swept = this.clock;
      for (const p of this.models.made()) {
        if (p.cold || this.clock - (p.seen ?? -COLD_AFTER) < COLD_AFTER) continue;
        p.cold = true;
        p.group.traverse((o) => {
          const m = (o as THREE.Mesh).material as (THREE.MeshStandardMaterial & { userData: { hi?: unknown } }) | undefined;
          if (!m || Array.isArray(m)) return;
          for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap]) {
            // (only a picture the page still has, to put back: a big one is let go of once it is on the card, and is left there)
            const img = t?.image as { width: number; height: number } | undefined;
            if (t && img && img.width > 0 && Math.max(img.width, img.height) <= 1024) t.dispose();
          }
        });
      }
    }
  }
  private clock = 0;
  private swept = 0;
  /** the whole model of each lighter copy that has been needed so far */
  private wholes = new Map<ItemTemplate, ItemTemplate>();
}
