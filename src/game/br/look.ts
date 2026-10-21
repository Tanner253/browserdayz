// What the battle royale puts in the world to be seen (2026-10-21), the owner: "we should have fortnite like glows and
// animations". Things on the ground stand in a beam of their rarity's colour and turn slowly; the circle is a wall of
// light round the map; the plane is the airdrop's helicopter (no plane model has been brought in: docs/BATTLE-ROYALE.md);
// the canopy is the airdrop's parachute. Only what is near is built: a map holds two thousand things.
import * as THREE from 'three';
import { assets } from '../../core/assets';
import { ITEMS, makeItem } from '../../sim/items';
import { RARITY, rarityOf, type Circle, type Ground } from '../../../arena/br/rules';
import type { Game } from '../game';

/** metres round the player within which things on the ground are built and drawn */
const NEAR = 70;

const beamGeo = new THREE.CylinderGeometry(0.035, 0.09, 3, 10, 1, true).translate(0, 1.5, 0);
const ringGeo = new THREE.RingGeometry(0.18, 0.3, 28).rotateX(-Math.PI / 2);
/** a soft light: fading up a beam (v: 0 at its foot), or out across a ring; brighter the rarer */
const glow = (c: string, o: number, up: boolean) => new THREE.ShaderMaterial({
  uniforms: { c: { value: new THREE.Color(c) }, o: { value: o } },
  vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: up
    ? 'uniform vec3 c; uniform float o; varying vec2 v; void main(){ float a = o * pow(1.0 - v.y, 2.2) * (0.55 + 0.45 * sin(v.x * 6.2832) * sin(v.x * 6.2832)); gl_FragColor = vec4(c * a, a); }'
    : 'uniform vec3 c; uniform float o; varying vec2 v; void main(){ float d = length(v - 0.5) * 2.0; float a = o * max(0.0, 1.0 - abs(d - 0.8) / 0.2); gl_FragColor = vec4(c * a, a); }',
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});
const BEAM: Record<number, THREE.Material> = {}, RING: Record<number, THREE.Material> = {};
for (const [t, r] of Object.entries(RARITY)) {
  const k = Number(t);
  BEAM[k] = glow(r.colour, 0.16 + 0.1 * k, true);
  RING[k] = glow(r.colour, 0.3 + 0.1 * k, false);
}

/** a wall of light, its alpha fading to nothing at its top: the circle's, and the waiting area's */
function wallMat(colour: string, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(colour) }, t: { value: 0 }, k: { value: strength } },
    vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 c; uniform float t; uniform float k; varying vec2 v; void main(){ float bands = 0.75 + 0.25 * sin(v.y * 90.0 - t * 2.0 + v.x * 40.0); float a = k * pow(1.0 - v.y, 1.6) * bands; gl_FragColor = vec4(c * (0.8 + 0.4 * bands), a); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
  });
}

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
  private t = 0;
  private sweep = 0;

  constructor(private game: Game) {
    this.scene = game.s.r.scene;
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true).translate(0, 0.5, 0);
    this.wall = new THREE.Mesh(cyl, wallMat('#7a4dff', 0.85));
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    this.waitWall = new THREE.Mesh(cyl, wallMat('#4cc3ff', 0.7));
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
      this.canopy = m.clone();
      this.canopy.visible = false;
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
    this.t += dt;
    for (const m of [this.wall, this.waitWall]) (m.material as THREE.ShaderMaterial).uniforms.t.value = this.t;
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
    root.add(new THREE.Mesh(beamGeo, BEAM[tier]), new THREE.Mesh(ringGeo, RING[tier]));
    (root.children[1] as THREE.Mesh).position.y = 0.03;
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

  /** this player's own canopy over `at` (null: none), and those over others who are coming down under one */
  chute(at: THREE.Vector3 | null, yaw: number, others: { id: number; pos: THREE.Vector3; yaw: number }[]) {
    if (this.canopy) {
      this.canopy.visible = !!at;
      if (at) {
        this.canopy.position.set(at.x, at.y + 3.2, at.z);
        this.canopy.rotation.set(0, yaw, 0);
      }
    }
    const seen = new Set<number>();
    for (const o of others) {
      seen.add(o.id);
      let c = this.canopies.get(o.id);
      if (!c && this.canopy) {
        c = this.canopy.clone();
        this.scene.add(c);
        this.canopies.set(o.id, c);
      }
      if (!c) continue;
      c.visible = true;
      c.position.set(o.pos.x, o.pos.y + 4.8, o.pos.z);
      c.rotation.set(0, o.yaw, 0);
    }
    for (const [id, c] of this.canopies) if (!seen.has(id)) c.visible = false;
  }
}
