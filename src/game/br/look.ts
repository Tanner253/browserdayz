// What the battle royale puts in the world to be seen (2026-10-21): a faint ring of its rarity's colour round a thing on
// the ground, which turns slowly; the circle's edge, a faint wall in the gas's colour; the plane (the airdrop's helicopter:
// no plane model has been brought in, docs/BATTLE-ROYALE.md) and the canopy (the airdrop's parachute). In the Zone's own
// look (the owner: "toooo arcadey"), and only what is near is built: a map holds two thousand things.
// (Plain see-through materials, as the game's own: a shader of light additive over everything blacked out the whole
// frame for an eye inside the waiting area's ring.)
import * as THREE from 'three';
import { assets } from '../../core/assets';
import { ITEMS, makeItem } from '../../sim/items';
import { RARITY, rarityOf, type Circle, type Ground } from '../../../arena/br/rules';
import type { Game } from '../game';

/** metres round the player within which things on the ground are built and drawn */
const NEAR = 70;
/** a canopy brought down to a body's size (its dome 12 m over its lines' meeting as the model is built), and where its lines meet over a body's feet */
const CANOPY = 0.42, SHOULDERS = 1.55;

const ringGeo = new THREE.RingGeometry(0.2, 0.28, 28).rotateX(-Math.PI / 2);
const RING: Record<number, THREE.Material> = {};
for (const [t, r] of Object.entries(RARITY)) RING[Number(t)] = new THREE.MeshBasicMaterial({ color: r.colour, transparent: true, opacity: 0.3 + 0.06 * Number(t), depthWrite: false, side: THREE.DoubleSide });

/** a wall that fades out going up: the circle's edge and the waiting area's */
const fade = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const x = c.getContext('2d')!, g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#000');
  g.addColorStop(1, '#fff');
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
})();
const wallMat = (colour: string, opacity: number) => new THREE.MeshBasicMaterial({ color: colour, alphaMap: fade, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

interface Shown { g: Ground; root: THREE.Group; model: THREE.Object3D | null }

export class BrLook {
  private scene: THREE.Scene;
  private shown = new Map<number, Shown>();
  private wall: THREE.Mesh;
  private waitWall: THREE.Mesh;
  plane: THREE.Object3D | null = null;
  private rotor: THREE.Object3D | null = null;
  canopy: THREE.Object3D | null = null;
  private canopies = new Map<number, THREE.Object3D>();
  private sweep = 0;

  constructor(private game: Game) {
    this.scene = game.s.r.scene;
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true).translate(0, 0.5, 0);
    // (the circle's edge in the gas's own colour, faint: the gas is what is outside it)
    this.wall = new THREE.Mesh(cyl, wallMat('#a8b07a', 0.35));
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    this.waitWall = new THREE.Mesh(cyl, wallMat('#c9b27c', 0.25));
    this.waitWall.frustumCulled = false;
    this.waitWall.visible = false;
    this.scene.add(this.wall, this.waitWall);
    void assets.model('apache').then((m) => {
      this.plane = m.clone();
      this.rotor = this.plane.getObjectByName('apache_rotor') ?? null;
      this.plane.visible = false;
      this.scene.add(this.plane);
    }).catch(() => {});
    void assets.model('parachute').then((m) => {
      this.canopy = this.canopyOf(m);
      this.scene.add(this.canopy);
    }).catch(() => {});
  }

  /** the circle's wall at `c` (null: none); the waiting area's ring at `w` (null: none) */
  zone(c: Circle | null, w: Circle | null, floor: number) {
    for (const [m, at, high] of [[this.wall, c, 900], [this.waitWall, w, 14]] as const) {
      m.visible = !!at && at.r > 0.5;
      if (!at) continue;
      m.position.set(at.x, floor - 40, at.z);
      m.scale.set(Math.max(0.5, at.r), high + 40, Math.max(0.5, at.r));
    }
  }

  /** the things on the ground near `at`, built as they come near and let go as they go */
  ground(things: Map<number, Ground>, at: THREE.Vector3, dt: number) {
    for (const s of this.shown.values()) if (s.model) s.model.rotation.y += dt * 0.9;
    // (who is near is looked at again a few times a second, not every frame)
    this.sweep -= dt;
    if (this.sweep > 0) return;
    this.sweep = 0.35;
    for (const [id, s] of this.shown) if (!things.has(id) || Math.hypot(s.g.x - at.x, s.g.z - at.z) > NEAR + 8) this.drop(id);
    for (const g of things.values()) if (!this.shown.has(g.id) && Math.abs(g.x - at.x) < NEAR && Math.abs(g.z - at.z) < NEAR && Math.hypot(g.x - at.x, g.z - at.z) < NEAR) this.build(g);
  }

  private build(g: Ground) {
    const id = g.item?.id ?? (g.ammo ? `box_${g.ammo.slice(5)}` : ''), tier = g.item ? rarityOf(g.item.id) : 1;
    const root = new THREE.Group();
    root.position.set(g.x, g.y, g.z);
    // (its rarity a thin ring on the ground round it, and nothing more: the owner, 2026-10-21, "toooo arcadey")
    root.add(new THREE.Mesh(ringGeo, RING[tier]));
    (root.children[0] as THREE.Mesh).position.y = 0.03;
    const s: Shown = { g, root, model: null };
    this.shown.set(g.id, s);
    this.scene.add(root);
    if (!ITEMS[id]) return;
    void this.game.loot.models.getFor(g.item ?? makeItem(id)).then((tpl) => {
      if (this.shown.get(g.id) !== s) return;
      const o = tpl.group.clone();
      o.scale.multiplyScalar(ITEMS[id].place ?? 1);
      // (stood up off the floor a little, so that it turns clear of it)
      o.position.y = 0.12;
      this.game.s.atmo.registerObject(o);
      s.model = o;
      root.add(o);
    }).catch(() => {});
  }

  private drop(id: number) {
    const s = this.shown.get(id);
    if (!s) return;
    this.scene.remove(s.root);
    this.shown.delete(id);
  }

  clear() {
    for (const id of [...this.shown.keys()]) this.drop(id);
  }

  /** the plane where it is, heading `yaw` (null: put away) */
  flyPlane(at: THREE.Vector3 | null, yaw: number, dt: number) {
    if (!this.plane) return;
    this.plane.visible = !!at;
    if (!at) return;
    this.plane.position.copy(at);
    this.plane.rotation.set(0, yaw, 0);
    if (this.rotor) this.rotor.rotation.y += dt * 28;
  }

  /**
   * A canopy for a body, made as the airdrop makes its own (src/game/airdrop.ts, hang): the model's origin is where its
   * lines meet and its dome stands 12 m over that, wide and thin: never culled by its measure as built, and brought down
   * to a body's size, its lines meeting at the shoulders.
   */
  private canopyOf(m: THREE.Object3D): THREE.Object3D {
    const o = m.clone();
    o.traverse((x) => {
      const mesh = x as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    });
    o.scale.setScalar(CANOPY);
    o.visible = false;
    this.game.s.atmo.registerObject(o);
    return o;
  }

  /** this player's own canopy over `at` (null: none), and those over others who are coming down under one */
  chute(at: THREE.Vector3 | null, yaw: number, others: { id: number; pos: THREE.Vector3; yaw: number }[]) {
    if (this.canopy) {
      this.canopy.visible = !!at;
      if (at) {
        this.canopy.position.set(at.x, at.y + SHOULDERS, at.z);
        this.canopy.rotation.set(0, yaw, 0);
      }
    }
    const seen = new Set<number>();
    for (const o of others) {
      seen.add(o.id);
      let c = this.canopies.get(o.id);
      if (!c && this.canopy) {
        c = this.canopy.clone();
        this.game.s.atmo.registerObject(c);
        this.scene.add(c);
        this.canopies.set(o.id, c);
      }
      if (!c) continue;
      c.visible = true;
      c.position.set(o.pos.x, o.pos.y + SHOULDERS, o.pos.z);
      c.rotation.set(0, o.yaw, 0);
    }
    for (const [id, c] of this.canopies) if (!seen.has(id)) c.visible = false;
  }
}
