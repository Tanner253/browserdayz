// World items: the Central Economy decides *what* exists where; this module gives
// each entry a mesh + an interaction trigger, rests it properly on whatever it lies on
// (shelf, table, floor, sloped ground) and manages stash crates and searchable crates.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { physics, G_TRIGGER, groups, WORLD_GROUPS, SOLID_GROUPS } from '../core/physics';
import { extractParts, groundParts, type MeshPart } from '../core/gltf-utils';
import { ITEMS, type ItemInstance } from '../sim/items';
import { fitsPoint } from '../sim/placement';
import { proceduralParts } from './procedural';
import { Container } from '../sim/inventory';
import type { WorldLoot } from '../sim/economy';
import type { Atmosphere } from '../world/atmosphere';
import type { LootPoint } from '../world/buildings';

export interface ItemTemplate {
  group: THREE.Group;
  size: THREE.Vector3;
}

const TRIGGER_GROUPS = groups(G_TRIGGER, 0xffff);
const DOWN = { x: 0, y: -1, z: 0 };
const UP = new THREE.Vector3(0, 1, 0);

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

  get(id: string, mods: string[] = []): Promise<ItemTemplate> {
    const key = mods.length ? `${id}+${[...mods].sort().join('+')}` : id;
    let p = this.cache.get(key);
    if (!p) {
      p = this.build(id, mods);
      this.cache.set(key, p);
    }
    return p;
  }

  /** the model for a specific item: a scoped, wrapped rifle looks the part on the ground too */
  getFor(item: ItemInstance): Promise<ItemTemplate> {
    return this.get(item.id, (item.mods ?? []).filter((m) => m === 'pu_scope' || m === 'rifle_wrap'));
  }

  private async build(id: string, mods: string[]): Promise<ItemTemplate> {
    const def = ITEMS[id];
    let parts: MeshPart[];
    if (def.model.startsWith('@')) parts = proceduralParts(def.model);
    else {
      const scene = await assets.model(def.model);
      const re = def.nodeRe ? new RegExp(def.nodeRe) : null;
      parts = re ? extractParts(scene, (n) => re.test(n)) : def.node ? extractParts(scene, (n) => n === def.node) : extractParts(scene);
      // the file shows the magazine beside the pistol as a display piece; the seated one is inside the grip
      if (id === 'p38') parts = extractParts(scene, (n) => /_a$/.test(n));
      // bare rifle: the scope and the wrap are attachments
      if (id === 'mosin') {
        parts = extractParts(scene).filter((p) => {
          const n = p.owner ?? p.name;
          return !n.includes('bullet') && (mods.includes('pu_scope') || !n.includes('scope')) && (mods.includes('rifle_wrap') || !n.includes('wrap'));
        });
      }
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
    if (!mods.length) this.sizes.set(id, size);
    return { group, size };
  }
}

export class WorldItem {
  obj: THREE.Object3D;
  collider: RAPIER.Collider;
  private meshes: THREE.Mesh[] = [];
  private shadows = true;
  constructor(public loot: WorldLoot, tpl: ItemTemplate, scene: THREE.Scene, normal: THREE.Vector3 | null) {
    this.obj = tpl.group.clone();
    this.obj.position.set(loot.x, loot.y, loot.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, loot.rot);
    // on sloped ground the item lies flat on the slope
    if (normal && normal.y < 0.9995) q.premultiply(new THREE.Quaternion().setFromUnitVectors(UP, normal));
    this.obj.quaternion.copy(q);
    this.obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.meshes.push(o as THREE.Mesh);
    });
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
  constructor(public uid: string, public x: number, public y: number, public z: number, public rot: number, w = 8, h = 6, public label = 'Stash Crate') {
    this.container = new Container(`stash:${uid}`, label, w, h, [], true);
  }

  spawn(tpl: ItemTemplate, scene: THREE.Scene) {
    this.obj = tpl.group.clone();
    this.obj.scale.setScalar(1);
    this.obj.position.set(this.x, this.y, this.z);
    this.obj.rotation.y = this.rot;
    scene.add(this.obj);
    const s = tpl.size.clone().divideScalar(ITEMS.stash_kit.scale ?? 1);
    const half = this.rot / 2;
    const desc = physics.R.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2)
      .setTranslation(this.x, this.y + s.y / 2, this.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setCollisionGroups(WORLD_GROUPS)
      .setSolverGroups(WORLD_GROUPS);
    this.collider = physics.world.createCollider(desc);
    physics.tag(this.collider, { surface: 'wood', owner: this });
  }

  /** interaction-only volume (bodies): you can look at it and search it, but walk through it */
  trigger(hx: number, hy: number, hz: number) {
    const half = this.rot / 2;
    const desc = physics.R.ColliderDesc.cuboid(hx, hy, hz)
      .setSensor(true)
      .setTranslation(this.x, this.y + hy, this.z)
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
    physics.tags.delete(this.collider.handle);
    physics.world.removeCollider(this.collider, false);
  }

  serialize() {
    return { uid: this.uid, x: this.x, y: this.y, z: this.z, rot: this.rot, container: this.container.serialize() };
  }
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
  }

  async preload() {
    await Promise.all(Object.keys(ITEMS).map((id) => this.models.get(id)));
  }

  /** Can this item type lie at this loot point without hanging off or poking through it? */
  fits = fitsPoint;

  spawn(l: WorldLoot) {
    this.pending.add(l.uid);
    void this.models.getFor(l.item).then((tpl) => {
      if (!this.pending.has(l.uid)) return; // despawned before the model loaded
      this.pending.delete(l.uid);
      const normal = this.place(l, tpl);
      this.items.set(l.uid, new WorldItem(l, tpl, this.scene, normal));
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
          l.y = y + 0.004;
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
    this.pending.delete(l.uid);
    const w = this.items.get(l.uid);
    if (w) {
      w.dispose(this.scene);
      this.items.delete(l.uid);
    }
  }

  async addStash(s: Stash) {
    const tpl = await this.models.get('stash_kit');
    s.spawn(tpl, this.scene);
    this.stashes.push(s);
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

  /** graphics option: beyond this distance small items stop casting shadows */
  shadowDist = Infinity;

  /** distance culling: tiny items vanish past 70 m */
  update(cam: THREE.Vector3) {
    const s2 = this.shadowDist * this.shadowDist;
    for (const w of this.items.values()) {
      const d2 = (w.loot.x - cam.x) ** 2 + (w.loot.z - cam.z) ** 2;
      w.obj.visible = d2 < 70 * 70;
      w.setShadows(d2 < s2);
    }
  }
}
