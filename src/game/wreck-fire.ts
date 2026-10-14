// The jeep that burns before the fort's gate, as the game has it (the rules are in src/sim/wreck-fire.ts, and where
// it stands is the fort's to say: src/sim/castle.ts). The jeep's own model, burned black as one that was blown up
// is (see Garage.char), standing where the world's list of things has it and stops a body; the fire a wreck keeps
// (Effects.engineSmoke), flames on its bonnet beside, and a wreck's black column over it (Effects.signal); and
// whether somebody is in its flames.
//
// Nothing of it is new to the card: its model is the jeeps', and its flames and its smoke are the fires'. Its light
// and its warmth are the fires' to give, as a campfire's are: its place and its lamp are told to them
// (`Fires.always`). The light is the one lamp the fires have always had in the scene, lit or not, which stands at
// whatever burns nearest the eye: no light is added to the world for it, none of the lamps' pool is taken (a fort's
// fire baskets and a street's lamps keep all five of theirs), and nothing is made when night comes.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { extractParts, groundParts, joinByPaint, type MeshPart } from '../core/gltf-utils';
import type { Place } from '../sim/castle';
import { JEEP_WRECK, WRECK_FIRE, burnedBy, wreckSpot, type WreckSpot } from '../sim/wreck-fire';
import type { Atmosphere } from '../world/atmosphere';
import type { Effects } from './effects';
import type { Fire } from './flames';

const UP = new THREE.Vector3(0, 1, 0);

export class WreckFire {
  readonly spot: WreckSpot;
  /** the heart of its fire */
  readonly heart: THREE.Vector3;
  /** the middle of its fire at the ground: where a campfire's place is, for whoever is warmed by it (see `Fires.always`) */
  readonly foot: THREE.Vector3;
  /** its lamp, as the fires are told it: over the heart, clear of the roof (see WRECK_FIRE.light) */
  readonly lamp: { at: THREE.Vector3; strength: number; reach: number; from: number; dusk: [number, number] };
  /** the wreck as it is drawn: not in the world until its model has come and is ready to be drawn */
  private root: THREE.Group | null = null;
  private quat: THREE.Quaternion;
  /** what its fire and its column are owed of smoke (each keeps its own pace: see Effects), and the flames each has while it is fed */
  private fire: { owed: number; fire?: Fire } = { owed: 0 };
  private column = { owed: 0 };
  /** the flames on its bonnet, and where their foot is */
  private engine: { fire?: Fire } = {};
  private bonnet: THREE.Vector3;
  /** where the column gathers: over the tops of the flames, clear of the roof */
  private top: THREE.Vector3;
  /** seconds since its flames last hurt whoever plays here */
  private since = Infinity;

  /**
   * @param ground the ground as the world has it (and as it is seen), for where the wreck sits: what whoever
   *   stood it in the world's list of things was told (Buildings.plan), so that it is drawn where it is solid
   * @param ready the renderer's way of getting a thing ready before it is shown (its shaders made off the frame)
   */
  constructor(place: Place, ground: (x: number, z: number) => number, scene: THREE.Scene, atmo: Atmosphere, private effects: Effects, ready?: (o: THREE.Object3D) => Promise<unknown>) {
    const w = (this.spot = wreckSpot(place, ground)), L = WRECK_FIRE.light;
    this.heart = new THREE.Vector3(...w.heart);
    this.foot = new THREE.Vector3(w.heart[0], w.y, w.heart[2]);
    this.lamp = { at: new THREE.Vector3(w.heart[0], w.heart[1] + L.up, w.heart[2]), strength: L.strength, reach: L.reach, from: L.from, dusk: L.dusk };
    this.top = new THREE.Vector3(w.heart[0], w.y + WRECK_FIRE.hull[1] + 0.4, w.heart[2]);
    this.quat = new THREE.Quaternion().setFromAxisAngle(UP, w.rot);
    this.bonnet = new THREE.Vector3(...WRECK_FIRE.bonnet.at).applyQuaternion(this.quat).add(new THREE.Vector3(w.x, w.y, w.z));
    void this.build(scene, atmo, ready).catch((e) => console.warn('the burning jeep', e));
  }

  /**
   * The jeep's model, burned out: black, its glass gone, its lamps dead (as Garage.char paints a car that has gone
   * up). Its shapes and pictures are the jeeps' own; only the paint is this wreck's. Drawn a paint at a time, as the
   * things stood about the map are, and stood as they are (its lowest point on its foot, its box's middle over its
   * place): so that it is drawn exactly where the box that stops a body at it stands (src/world/vegetation.ts).
   */
  private async build(scene: THREE.Scene, atmo: Atmosphere, ready?: (o: THREE.Object3D) => Promise<unknown>) {
    const w = this.spot, root = new THREE.Group();
    const all = extractParts(await assets.model(JEEP_WRECK.kind));
    groundParts(all);
    const glass = (p: MeshPart) => /glass/i.test(p.name) || /glass/i.test(p.owner ?? '') || p.material.transparent || /glass/i.test(p.material.name);
    // (Its body, its four wheels and its steering wheel are of one paint and were six things to draw, and each again
    // into the sun's shadow maps: sixteen draws a frame. They are made alike, of what all of them have, as plain
    // numbers, and joined: one thing.)
    const solid = all.filter((q) => !glass(q)), names = Object.keys(solid[0]?.geometry.attributes ?? {}).filter((k) => solid.every((q) => q.geometry.getAttribute(k)));
    const indexed = solid.every((q) => !!q.geometry.index);
    for (const q of solid) {
      let g = q.geometry;
      if (!indexed && g.index) g = q.geometry = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!names.includes(k)) g.deleteAttribute(k);
      for (const k of names) {
        const a = g.getAttribute(k), n = a.itemSize, f = new Float32Array(a.count * n), get = [a.getX, a.getY, a.getZ, a.getW];
        for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) f[i * n + c] = get[c].call(a, i);
        g.setAttribute(k, new THREE.BufferAttribute(f, n));
      }
    }
    for (const p of joinByPaint(solid)) {
      const c = (p.material as THREE.MeshStandardMaterial).clone();
      c.color?.multiplyScalar(0.09);
      if ('roughness' in c) c.roughness = 1;
      if ('metalness' in c) c.metalness = 0;
      if ('emissiveIntensity' in c) c.emissiveIntensity = 0;
      atmo.register(c);
      const mesh = new THREE.Mesh(p.geometry, c);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
    root.name = 'castle:burning jeep';
    root.position.set(w.x, w.y, w.z);
    root.rotation.y = w.rot;
    root.updateMatrixWorld(true);
    root.traverse((o) => void (o.matrixAutoUpdate = false));
    await ready?.(root).catch(() => {});
    scene.add(root);
    this.root = root;
  }

  /** Each frame: it burns and it smokes. (Its light is the fires' lamp: they are told where it hangs: see `lamp`.) */
  update(dt: number, eye: THREE.Vector3) {
    const W = WRECK_FIRE, d = this.heart.distanceTo(eye);
    if (this.root) this.root.visible = d < W.seen.model;
    // The fire a wreck keeps for as long as it stands, and a wreck's own smoke off the top of it: said every frame,
    // exactly as the garage says a burned-out car's. (Its flames are drawn from as near as flames are seen: see Flames.)
    if (d < W.seen.fire) {
      this.effects.engineSmoke(this.heart, this.fire, dt * 0.5, false, 0.6, this.quat, undefined, true);
      // (and the flames on its bonnet: the same flames, fed the same way, leaning as the fire in the cabin leans)
      const f = this.effects.fire.feed(this.engine, this.bonnet);
      f.size = W.bonnet.size;
      f.strength = Math.min(W.bonnet.strength, f.strength + dt * 0.6);
      f.smoke = 0.5;
      if (this.fire.fire) f.lean.copy(this.fire.fire.lean);
    }
    // and the black column of a wreck over it, which is what is seen of it from the road by day
    if (d < W.seen.column) this.effects.signal(this.top, this.column, dt * 0.55, true);
  }

  /**
   * Somebody standing at `pos` (their feet), this frame: the health its flames take off them now. Nothing, most
   * frames: it is taken as a hurt is, at the first touch and then every so often, and never oftener than that
   * however they step in and out of it.
   */
  burn(dt: number, pos: THREE.Vector3): number {
    const B = WRECK_FIRE.burn;
    this.since += dt;
    if (this.since < B.every || !burnedBy(this.spot, pos.x, pos.y, pos.z)) return 0;
    this.since = 0;
    return B.harm * B.every;
  }
}
