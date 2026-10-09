// Campfires as the game has them (the rules are in src/sim/fires.ts): which fireplaces are
// alight and for how long yet, the flames and the smoke of each, the light of the nearest, the
// sound of it, and whether the survivor is resting beside one.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { FIRE, fireSpots } from '../sim/fires';
import type { Atmosphere } from '../world/atmosphere';
import type { World } from '../world/worldgen';
import type { Effects } from './effects';

/** how far off a fire's flames are drawn, and its smoke, metres (the smoke is what is seen of it from across the map) */
const SEEN = { flames: 70, smoke: 420 };
/** the wood laid in each ring: which model it is, and how wide and how high it lies, metres */
const WOOD = { model: 'dry_branches_medium_01', across: 0.78, high: 0.3 };
/** the light of a fire: its colour, how strong, and how far it reaches, metres */
const GLOW = { color: 0xff8f3a, strength: 7, reach: 9, from: 48 };

export class Fires {
  /** where each fireplace is: the middle of its ring, at the ground */
  readonly spots: THREE.Vector3[];
  /** seconds each has left to burn (0 = out) */
  readonly left: number[];
  private owed: { flame: number; smoke: number }[];
  private light: THREE.PointLight;
  private heardT = 0;
  private clock = 0;

  constructor(world: World, scene: THREE.Scene, private effects: Effects, atmo: Atmosphere) {
    this.spots = fireSpots(world.props).map((p) => new THREE.Vector3(p.x, p.y, p.z));
    // wood laid ready in every ring: a fireplace that can be lit looks like one
    void assets.model(WOOD.model).then((tpl) => {
      const box = new THREE.Box3().setFromObject(tpl), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
      const k = WOOD.across / Math.max(size.x, size.z, 1e-3);
      this.spots.forEach((s, i) => {
        const wood = tpl.clone();
        const pile = new THREE.Group();
        wood.position.set(-mid.x, -box.min.y, -mid.z);
        pile.add(wood);
        pile.scale.set(k, Math.min(k * 1.4, WOOD.high / Math.max(size.y, 1e-3)), k);
        pile.position.set(s.x, s.y + 0.04, s.z);
        pile.rotation.y = i * 1.9;
        pile.traverse((o) => {
          o.castShadow = o.receiveShadow = true;
        });
        atmo.registerObject(pile);
        scene.add(pile);
      });
    });
    this.left = this.spots.map(() => 0);
    this.owed = this.spots.map(() => ({ flame: 0, smoke: 0 }));
    // (one lamp, moved to whichever fire is nearest the eye: it is always in the scene, lit or
    // not, so that lighting a fire never changes how many lights the world is drawn with)
    this.light = new THREE.PointLight(GLOW.color, 0, GLOW.reach, 1.7);
    scene.add(this.light);
  }

  /** told (by the server, or by the game itself alone) that one is alight, and for how long yet; 0 puts it out */
  set(i: number, left: number) {
    if (i >= 0 && i < this.left.length) this.left[i] = Math.max(0, left);
  }

  /** everything put out (a new world, or a new connection to one) */
  clear() {
    this.left.fill(0);
  }

  /** the fireplace within reach of somebody standing at `pos` (the nearest, if there are two), or -1 */
  at(pos: THREE.Vector3, reach = FIRE.reach): number {
    let best = -1, bd = reach;
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const d = Math.hypot(s.x - pos.x, s.z - pos.z);
      if (d < bd && Math.abs(s.y - pos.y) < 2.5) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** is somebody at `pos` resting by a fire that is alight */
  warm(pos: THREE.Vector3): boolean {
    const i = this.at(pos, FIRE.warm);
    return i >= 0 && this.left[i] > 0;
  }

  /**
   * @returns the fires that crackled just now loud enough for the infected to have heard (see FIRE.heard): where each is
   */
  update(dt: number, eye: THREE.Vector3): THREE.Vector3[] {
    this.clock += dt;
    let near = -1, nd = Infinity;
    for (let i = 0; i < this.spots.length; i++) {
      if (this.left[i] <= 0) continue;
      this.left[i] = Math.max(0, this.left[i] - dt);
      const s = this.spots[i];
      const d = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z);
      if (d < nd) {
        nd = d;
        near = i;
      }
      // (it sinks in its last half minute: less flame, less smoke)
      const life = Math.min(1, this.left[i] / 30);
      if (d < SEEN.smoke) this.effects.campfire(s, this.owed[i], dt, life, d < SEEN.flames);
    }
    const on = near >= 0 && nd < GLOW.from;
    if (on) {
      const s = this.spots[near], t = this.clock;
      // never still: two slow swells and a quick shiver
      const flick = 0.78 + 0.14 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.7) + 0.06 * Math.sin(t * 31 + 0.4);
      this.light.position.set(s.x + Math.sin(t * 5.1) * 0.05, s.y + 0.55, s.z + Math.cos(t * 4.3) * 0.05);
      this.light.intensity = GLOW.strength * flick * Math.min(1, this.left[near] / 30) * (1 - THREE.MathUtils.smoothstep(nd, GLOW.from * 0.7, GLOW.from));
    } else this.light.intensity = 0;
    audio.fire(dt, on ? nd : -1);
    const heard: THREE.Vector3[] = [];
    this.heardT -= dt;
    if (this.heardT <= 0) {
      this.heardT = FIRE.crackle;
      for (let i = 0; i < this.spots.length; i++) if (this.left[i] > 0) heard.push(this.spots[i]);
    }
    return heard;
  }
}
