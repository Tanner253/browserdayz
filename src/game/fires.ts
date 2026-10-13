// Campfires as the game has them (the rules are in src/sim/fires.ts): which fireplaces are
// alight and for how long yet, the ring of stones and wood that stands at each (cold, or
// burning), the flames and the smoke of each, the light of the nearest, the sound of it, and
// whether the survivor is resting beside one.
//
// The flames are the ones the ring came with (src/game/flames.ts), stood in its wood and turned as it is
// turned; the wood itself is painted charred while it burns, and glows only where its own picture is hot.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { extractParts, groundParts, joinByPaint } from '../core/gltf-utils';
import { physics } from '../core/physics';
import { FIRE, fireSpots } from '../sim/fires';
import type { Atmosphere, ShaderPatch } from '../world/atmosphere';
import { foliagePatch, setLodFade } from '../world/foliage';
import { heightAt, type World } from '../world/worldgen';
import type { Effects } from './effects';
import type { Fire } from './flames';

/**
 * How far off a fire's flames are drawn, and its smoke, metres (the smoke is what is seen of it from across the
 * map). The flames were not drawn past 70 m, when each was a heap of puffs made one at a time: a fire seen from a
 * hillside by night was smoke nobody could see, and no light at all. Every flame of every fire is one draw now.
 */
const SEEN = { flames: 190, smoke: 420 };
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
 * The burning ring. `lamp`: how high over the ground the light of the fire is, metres: in the flames over the
 * wood, well clear of it. (It was a hand's breadth over the tops of the logs, to light their faces when the
 * embers painted on them were black wherever it did not reach: so near, it lit the wood itself brighter than
 * anything else in the picture, by day as well, and charred logs were terracotta.) `catches`: seconds a fire takes
 * to come to its full height once it is lit.
 *
 * Its paint. The ring came with its glow painted into its colour picture, and the whole picture was given off as
 * light: by day the sun lit the same paint and the logs were salmon pink. Now the picture is read for what is HOT
 * in it, by how far its red stands above its blue (`hot`: from where that begins to count, to where it counts in
 * full; its orange is hot, its brown wood and its grey stone are not): what is hot gives light, in an ember's
 * colour, and everything else is the same picture charred (`char`: how much of its own colour the wood keeps,
 * and how dark it is). `embers`: how bright the hot parts are by night; `byDay`: the share of that at noon;
 * `breath`: how much they rise and fall with the flicker of the fire's lamp.
 */
const BURNS = { lamp: 1.5, catches: 3, embers: 1.15, byDay: 0.45, breath: 0.6, hot: [0.27, 0.66], char: [0.2, 0.22] };
/** the light of a fire: its colour, how strong, and how far it reaches, metres */
const GLOW = { color: 0xff8f3a, strength: 9, reach: 9, from: 48 };

export class Fires {
  /** where each fireplace is: the middle of its ring, at the ground */
  readonly spots: THREE.Vector3[];
  /** seconds each has left to burn (0 = out) */
  readonly left: number[];
  /** what each is owed of smoke and of sparks, and the flames it has while it is near enough to be seen burning */
  private owed: { flame: number; smoke: number; fire?: Fire }[];
  /** seconds each has been alight (a fire catches: see BURNS) */
  private lit: number[];
  private light: THREE.PointLight;
  private heardT = 0;
  private clock = 0;
  /** the ring at each fireplace as it is drawn: cold, and alight (one of the two is shown) */
  private rings: { cold: THREE.Object3D; lit: THREE.Object3D }[] = [];
  /** the foot of each fire: the middle of its ring, as low as the ring stands (nothing of a flame is drawn below it) */
  private feet: THREE.Vector3[];
  /** what the burning ring is painted with: its embers give light, and are never still */
  private burning: THREE.MeshStandardMaterial[] = [];
  /** for the burning ring's paint: that it burns, and the time (its embers breathe) */
  private ember = { value: new THREE.Vector2(1, 0) };

  constructor(world: World, scene: THREE.Scene, private effects: Effects, private atmo: Atmosphere) {
    this.spots = fireSpots(world.props).map((p) => new THREE.Vector3(p.x, p.y, p.z));
    // A ring stands on the lowest of the ground under it: on a slope its uphill stones are a little in the bank,
    // and no side of it hangs in the air. (The fireplace itself, for whoever lights it, is where it always was.)
    this.feet = this.spots.map((s) => {
      let y = s.y;
      for (let k = 0; k < 8; k++) y = Math.min(y, heightAt(world.heights, s.x + Math.cos((k * Math.PI) / 4) * RING.reach, s.z + Math.sin((k * Math.PI) / 4) * RING.reach));
      return new THREE.Vector3(s.x, y, s.z);
    });
    // the ring at every fireplace, with its wood laid ready: a fireplace that can be lit looks like one
    void Promise.all([assets.model(RING.cold), assets.model(RING.lit)]).then((models) => {
      // (each of the two is one shape and one paint, whatever number of fireplaces there are: the paint fades it out with distance as it does everything stood about the map)
      const [cold, lit] = models.map((model, k) => {
        const parts = joinByPaint(extractParts(model));
        groundParts(parts);
        return parts.map((p) => {
          const paint = (p.material as THREE.MeshStandardMaterial).clone();
          // What is hot in the burning one's picture gives light, and the rest of it is charred (see BURNS). The
          // cold one goes through the same shader told that it does not burn, and is painted as it always was: so
          // that the two are drawn by one program, and the first fire lit in a game is not a wait while the card
          // is taught another.
          paint.emissive.setHex(k === 1 ? 0xffffff : 0x000000);
          paint.emissiveIntensity = BURNS.embers;
          if (k === 1) this.burning.push(paint);
          const fp = foliagePatch({});
          setLodFade(fp.lod, null, RING.seen);
          const ember = k === 1 ? this.ember : { value: new THREE.Vector2(0, 0) };
          const charred: ShaderPatch = (shader) => {
            fp.patch(shader);
            shader.uniforms.uEmber = ember;
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', '#include <common>\nuniform vec2 uEmber;\nfloat emberHot = 0.0;')
              .replace(
                '#include <map_fragment>',
                /* glsl */ `#include <map_fragment>
{
  vec3 own = diffuseColor.rgb;
  float over = own.r - own.b;
  emberHot = smoothstep( ${BURNS.hot[0].toFixed(3)}, ${BURNS.hot[1].toFixed(3)}, over );
  vec3 charred = mix( vec3( dot( own, vec3( 0.3, 0.5, 0.2 ) ) ), own, ${BURNS.char[0].toFixed(3)} ) * ${BURNS.char[1].toFixed(3)};
  // (what is hot is an ember, and an ember is dark but for its own light)
  diffuseColor.rgb = mix( own, mix( charred, own * 0.14, emberHot ), uEmber.x );
  // (and what is only warm, the red cracks in the scorched ground, glows a little)
  emberHot += 0.12 * smoothstep( 0.06, 0.26, over ) * ( 1.0 - emberHot );
}`,
              )
              .replace(
                '#include <emissivemap_fragment>',
                /* glsl */ `{
  // no two embers rise and fall together
  float breath = 0.84 + 0.16 * sin( uEmber.y * 2.3 + dot( vMapUv, vec2( 41.0, 67.0 ) ) );
  // (an ember's colours, from a dull red to an orange. Their blue is less than nothing: see LOOK in flames.ts)
  totalEmissiveRadiance = emissive * mix( vec3( 0.7, 0.03, -0.07 ), vec3( 1.5, 0.28, -0.16 ), emberHot ) * emberHot * breath;
}`,
              );
          };
          atmo.register(paint, charred, 'fire-ring');
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
        const y = this.feet[i].y;
        const ring = { cold: stand(cold, s, y, this.turn(i)), lit: stand(lit, s, y, this.turn(i)) };
        ring.lit.visible = false;
        // the wood stood in the middle of it stops a body, as the stones round it do already
        if (physics.world) physics.addStatic(physics.R.ColliderDesc.cylinder(RING.logs.h / 2, RING.logs.r), 'wood', { x: s.x, y: y + RING.logs.h / 2, z: s.z });
        return ring;
      });
    });
    this.left = this.spots.map(() => 0);
    this.lit = this.spots.map(() => 0);
    this.owed = this.spots.map(() => ({ flame: 0, smoke: 0 }));
    // (one lamp, moved to whichever fire is nearest the eye, a campfire or anything else alight: it is always in
    // the scene, lit or not, so that lighting a fire never changes how many lights the world is drawn with)
    this.light = new THREE.PointLight(GLOW.color, 0, GLOW.reach, 1.7);
    scene.add(this.light);
  }

  /** how the ring at each fireplace is turned, radians (no two alike: and its flames are turned with it) */
  private turn(i: number) {
    return i * 1.9;
  }

  /** how bright a fire is at a moment, about 0.78: never still (two slow swells and a quick shiver), and no two fires together (`i`: any number of its own) */
  private flick(i: number) {
    const t = this.clock + i * 3.1;
    return 0.78 + 0.14 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.7) + 0.06 * Math.sin(t * 31 + 0.4);
  }

  /** told (by the server, or by the game itself alone) that one is alight, and for how long yet; 0 puts it out */
  set(i: number, left: number) {
    if (i < 0 || i >= this.left.length) return;
    // (one told of with all its time before it has just been lit, and catches; any other was burning already)
    if (this.left[i] <= 0 && left > 0) this.lit[i] = left >= FIRE.burns - 2 ? 0 : BURNS.catches;
    this.left[i] = Math.max(0, left);
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
    let near = -1, nd = Infinity, glowing = -1;
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const d = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z);
      // The ring as it is now: alight from the moment it is lit to the moment it is out, cold otherwise, and
      // neither from further off than it could be seen. (And alight while flames stand in it that nobody lit: the
      // main menu's scene of a fire lights none, so that a game then starting finds none alight, and stood its
      // flames in cold grey wood.)
      const ring = this.rings[i];
      if (ring) {
        const seen = d < RING.seen[1], alight = this.left[i] > 0 || (seen && !!this.effects.fire.nearest(s, 0.8));
        ring.cold.visible = seen && !alight;
        ring.lit.visible = seen && alight;
        if (seen && alight && glowing < 0) glowing = i;
      }
      if (this.left[i] <= 0) continue;
      this.left[i] = Math.max(0, this.left[i] - dt);
      this.lit[i] += dt;
      if (d < nd) {
        nd = d;
        near = i;
      }
      // (it catches over its first seconds, and sinks in its last half minute: less flame, less smoke)
      const life = Math.min(1, this.left[i] / 30) * Math.min(1, 0.12 + this.lit[i] / BURNS.catches);
      // (the flames are as bright as the lamp is at the moment: the light on the ground and the fire agree)
      if (d < SEEN.smoke) this.effects.campfire(this.feet[i], this.owed[i], dt, life, d < SEEN.flames, this.turn(i), 1 + 0.45 * (this.flick(i) - 0.78));
    }
    const on = near >= 0 && nd < GLOW.from;
    if (glowing >= 0) {
      // The embers breathe with a fire's flicker (the nearest one's, where one is lit: every burning ring is
      // painted with the one paint, so they all do), and are brightest when the day is darkest.
      const day = this.atmo.daylight.value;
      this.ember.value.y = this.clock % 1000;
      for (const paint of this.burning) paint.emissiveIntensity = BURNS.embers * (1 + BURNS.breath * (this.flick(near >= 0 ? near : glowing) - 0.78)) * (1 - (1 - BURNS.byDay) * day);
    }
    // The lamp is at whatever burns nearest the eye: a campfire, or anything else that has been given the same
    // flames (a car alight, a wreck burning out). It is as strong as that fire is, and as big.
    const by = this.effects.fire.nearest(eye, GLOW.from);
    if (by) {
      const f = by.fire, t = this.clock, big = Math.min(f.size, 1.6);
      const mine = this.owed.findIndex((o) => o.fire === f);
      const flick = this.flick(mine >= 0 ? mine : 20 + f.own * 9);
      // (a fire that is not a campfire is told how bright it is here, as the campfires are above)
      if (mine < 0) f.glow = 1 + 0.45 * (flick - 0.78);
      this.light.position.set(f.at.x + Math.sin(t * 5.1) * 0.05, f.at.y + BURNS.lamp * big, f.at.z + Math.cos(t * 4.3) * 0.05);
      this.light.distance = GLOW.reach * big;
      this.light.intensity = GLOW.strength * flick * f.strength * big * (1 - THREE.MathUtils.smoothstep(by.far, GLOW.from * 0.7, GLOW.from));
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
