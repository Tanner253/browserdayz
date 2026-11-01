// Shut in under the ground (the owner, 2026-11-01: "when in the bunker only the bunker level needs and what the user can actually see"). Down the bunker or the mine nothing of the surface
// can be seen, and it was all still gone through and drawn behind the rock: the sun's three shadow maps, the terrain, the grass, the trees. Here it is let go of while the eye is shut
// in, on the one frame that changes, and down the bunker so is whatever stands on a floor the eye is not on: its furniture and the infected on it.

import * as THREE from 'three';
import { BUNKER_FAR, bunkerSealed, type Place } from '../sim/bunker';
import { MINE, inMine } from '../sim/mine';
import { inTunnel, stationAt } from '../sim/train-line';
import type { Atmosphere } from '../world/atmosphere';
import { selfLit } from '../world/bunker';
import type { Terrain } from '../world/terrain';
import type { Vegetation } from '../world/vegetation';

/** how near a mine's entrance the eye may be and still see out of it, metres */
const MOUTH = 30;

export interface UndergroundHost {
  place: () => Place | null;
  /** the floors of the bunker in sight of the eye */
  floors: (eye: THREE.Vector3) => [number, number];
  scene: THREE.Scene;
  terrain: Terrain;
  veg: Vegetation;
  atmo: Atmosphere;
  /** who else wants to know which floors are in sight (null: the eye is not down there) */
  told: (floors: [number, number] | null) => void;
}

/** dust hanging in the air round the eye: how many motes, and how far off they go */
const MOTES = 150, DUST = 9;

export class Underground {
  /** nothing of the surface can be seen from where the eye is */
  shut = false;
  /** how far the world goes while it is (src/game/game/frame.ts) */
  readonly far = BUNKER_FAR;
  private seen = '';

  constructor(private h: UndergroundHost) {
    // (a gun rack is dark steel: down the bunker it stood as a black block, and what was on it with it)
    for (const o of h.scene.children) if (/^(gun_rack|bunker_machine|bunker_terminal|breaker_box|bunker_pipes?|utility_box_01|valve_stand):/.test(o.name)) selfLit((o as THREE.Mesh).material as THREE.MeshStandardMaterial, o.name.startsWith('gun_rack') ? 0.45 : 0.3);
  }

  /** a mote's drift, as the eye moves through a box of them that goes with it */
  private dust() {
    const pos = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES * 3; i++) pos[i] = Math.random() * DUST * 2 - DUST;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xc8bca0, size: 0.018, transparent: true, opacity: 0.32, depthWrite: false });
    const dots = new THREE.Points(g, m);
    dots.frustumCulled = false;
    dots.visible = false;
    this.h.scene.add(dots);
    return dots;
  }
  private motes: THREE.Points | null = null;
  private clock = 0;

  /** Once a frame. @param eye where it looks from */
  update(eye: THREE.Vector3, dt = 0) {
    this.clock += dt;
    const dots = (this.motes ??= this.dust());
    dots.visible = this.shut;
    if (this.shut) {
      const p = dots.geometry.getAttribute('position') as THREE.BufferAttribute, a = p.array as Float32Array, span = DUST * 2;
      for (let i = 0; i < MOTES; i++) {
        const x = i * 3;
        a[x] += Math.sin(this.clock * 0.3 + i) * dt * 0.06;
        a[x + 1] -= dt * 0.03;
        if (a[x + 1] < -DUST) a[x + 1] += span;
      }
      p.needsUpdate = true;
      dots.position.set(Math.floor(eye.x / span) * span, Math.floor(eye.y / span) * span, Math.floor(eye.z / span) * span);
    }
    const h = this.h, down = bunkerSealed(h.place(), eye.x, eye.y, eye.z);
    const mined = !down && inMine(eye.x, eye.y, eye.z) && Math.min(Math.abs(eye.x - MINE.west.x), Math.abs(eye.x - MINE.east.x)) > MOUTH;
    const at = stationAt(eye.x, eye.y, eye.z), ridden = !down && !mined && (inTunnel(eye.x, eye.y, eye.z) || (!!at && eye.y < at.y + 6));
    const shut = down || mined || ridden;
    if (shut !== this.shut) {
      this.shut = shut;
      h.terrain.mesh.visible = !shut;
      for (const o of h.scene.children) if (o.name.startsWith('grass:')) o.visible = !shut;
      h.atmo.sunShadows(!shut);
    }
    const floors = down ? h.floors(eye) : null, key = floors ? floors.join() : '';
    if (key === this.seen) return;
    this.seen = key;
    // (the mine's own timbers and carts are the same lists as the trees: only down the bunker do those go)
    h.veg.under(floors && ((n) => n === floors[0] || n === floors[1]));
    h.told(floors);
  }
}
