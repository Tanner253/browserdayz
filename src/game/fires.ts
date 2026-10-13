// Campfires as the game has them (the rules are in src/sim/fires.ts): which fireplaces are
// alight and for how long yet, the ring of stones and wood that stands at each (cold, or
// burning), the flames and the smoke of each, the light of the nearest, the sound of it, and
// whether the survivor is resting beside one.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { extractParts, groundParts, joinByPaint } from '../core/gltf-utils';
import { physics } from '../core/physics';
import { FIRE, fireSpots } from '../sim/fires';
import type { Atmosphere } from '../world/atmosphere';
import { foliagePatch, setLodFade } from '../world/foliage';
import { heightAt, type World } from '../world/worldgen';
import type { Effects } from './effects';

/** how far off a fire's flames are drawn, and its smoke, metres (the smoke is what is seen of it from across the map) */
const SEEN = { flames: 70, smoke: 420 };
/**
 * What is drawn at each fireplace (2026-10-13: "the assets I brought in look better than our hand made ones"): a
 * ring of stones with wood stood in it, cold while it is out, and the same with its embers painted in while it
 * burns. Where it stands is the map's own fireplace (FIRE.kind: the server counts those, and what stops a body
 * there is that prop's), which is not drawn any more: this is, at the same place and as wide. `seen`: how far off
 * it is drawn, as anything stood about the map is. `logs`: how wide and how high the wood stands in the middle of
 * it, which is solid too, so that nobody stands in it.
 */
const RING = { cold: 'campfire_ring_cold', lit: 'campfire_ring', seen: [128, 140] as [number, number], reach: 0.6, logs: { r: 0.3, h: 0.8 } };
/**
 * The wood stands a forearm high in the ring where the old pit's lay flat: the flames and the smoke begin that much
 * higher (among the tops of the logs and over them, not shut inside them), and the light of the fire is over the
 * wood, where it falls on the logs' own faces as well as on the ground. `embers`: how much of what is painted on the
 * burning ring gives light of its own, and in what colour (seen by night, the embers painted on it were black
 * wherever the lamp did not reach them: the logs' outer faces, which is all of them from outside). `byDay`: the
 * share of that it gives at noon, when the sun lights the same paint and the two together were pale and pink.
 */
const BURNS = { lift: 0.3, lamp: 1.0, embers: 0.5, ember: 0xffa066, byDay: 0.2 };
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
  /** the ring at each fireplace as it is drawn: cold, and alight (one of the two is shown) */
  private rings: { cold: THREE.Object3D; lit: THREE.Object3D }[] = [];
  /** where the flames of each begin (see BURNS) */
  private flames: THREE.Vector3[];
  /** what the burning ring is painted with: its embers give light, and are never still */
  private burning: THREE.MeshStandardMaterial[] = [];

  constructor(world: World, scene: THREE.Scene, private effects: Effects, private atmo: Atmosphere) {
    this.spots = fireSpots(world.props).map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.flames = this.spots.map((s) => new THREE.Vector3(s.x, s.y + BURNS.lift, s.z));
    // the ring at every fireplace, with its wood laid ready: a fireplace that can be lit looks like one
    void Promise.all([assets.model(RING.cold), assets.model(RING.lit)]).then((models) => {
      // (each of the two is one shape and one paint, whatever number of fireplaces there are: the paint fades it out with distance as it does everything stood about the map)
      const [cold, lit] = models.map((model, k) => {
        const parts = joinByPaint(extractParts(model));
        groundParts(parts);
        return parts.map((p) => {
          const paint = (p.material as THREE.MeshStandardMaterial).clone();
          // The burning one's own colours, given off as light: the glow painted into it is a glow. (The cold one
          // is painted the same way and gives off none: so that the two are drawn by one program, and the first
          // fire lit in a game is not a wait while the card is taught another.)
          paint.emissiveMap = paint.map;
          paint.emissive.setHex(k === 1 ? BURNS.ember : 0x000000);
          paint.emissiveIntensity = BURNS.embers;
          if (k === 1) this.burning.push(paint);
          const fp = foliagePatch({});
          setLodFade(fp.lod, null, RING.seen);
          atmo.register(paint, fp.patch, 'prop');
          return { geometry: p.geometry, paint };
        });
      });
      const stand = (parts: typeof cold, s: THREE.Vector3, y: number, turn: number) => {
        const ring = new THREE.Group();
        for (const p of parts) {
          const mesh = new THREE.Mesh(p.geometry, p.paint);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          ring.add(mesh);
        }
        ring.position.set(s.x, y, s.z);
        ring.rotation.y = turn;
        ring.matrixAutoUpdate = false;
        ring.updateMatrix();
        scene.add(ring);
        return ring;
      };
      this.rings = this.spots.map((s, i) => {
        // It stands on the lowest of the ground under it: on a slope its uphill stones are a little in the bank,
        // and no side of it hangs in the air. (The fireplace itself, for whoever lights it and for the flames, is
        // where it always was.)
        let y = s.y;
        for (let k = 0; k < 8; k++) y = Math.min(y, heightAt(world.heights, s.x + Math.cos((k * Math.PI) / 4) * RING.reach, s.z + Math.sin((k * Math.PI) / 4) * RING.reach));
        const ring = { cold: stand(cold, s, y, i * 1.9), lit: stand(lit, s, y, i * 1.9) };
        ring.lit.visible = false;
        // the wood stood in the middle of it stops a body, as the stones round it do already
        if (physics.world) physics.addStatic(physics.R.ColliderDesc.cylinder(RING.logs.h / 2, RING.logs.r), 'wood', { x: s.x, y: y + RING.logs.h / 2, z: s.z });
        return ring;
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
      const s = this.spots[i];
      const d = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z);
      // The ring as it is now: alight from the moment it is lit to the moment it is out, cold otherwise, and
      // neither from further off than it could be seen.
      const ring = this.rings[i];
      if (ring) {
        const seen = d < RING.seen[1], alight = this.left[i] > 0;
        ring.cold.visible = seen && !alight;
        ring.lit.visible = seen && alight;
      }
      if (this.left[i] <= 0) continue;
      this.left[i] = Math.max(0, this.left[i] - dt);
      if (d < nd) {
        nd = d;
        near = i;
      }
      // (it sinks in its last half minute: less flame, less smoke)
      const life = Math.min(1, this.left[i] / 30);
      if (d < SEEN.smoke) this.effects.campfire(this.flames[i], this.owed[i], dt, life, d < SEEN.flames);
    }
    const on = near >= 0 && nd < GLOW.from;
    if (on) {
      const s = this.spots[near], t = this.clock;
      // never still: two slow swells and a quick shiver
      const flick = 0.78 + 0.14 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.7) + 0.06 * Math.sin(t * 31 + 0.4);
      this.light.position.set(s.x + Math.sin(t * 5.1) * 0.05, s.y + BURNS.lamp, s.z + Math.cos(t * 4.3) * 0.05);
      this.light.intensity = GLOW.strength * flick * Math.min(1, this.left[near] / 30) * (1 - THREE.MathUtils.smoothstep(nd, GLOW.from * 0.7, GLOW.from));
      // (and the embers with it: every burning ring is painted with the one paint, so they shiver together;
      // and are brightest when the day is darkest)
      const day = this.atmo.daylight.value;
      for (const paint of this.burning) paint.emissiveIntensity = BURNS.embers * (0.85 + 0.6 * (flick - 0.78)) * (1 - (1 - BURNS.byDay) * day);
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
