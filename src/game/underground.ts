// Shut in under the ground (the owner, 2026-11-01: "when in the bunker only the bunker level needs and what the user can actually see"). Down the bunker or the mine nothing of the surface
// can be seen, and it was all still gone through and drawn behind the rock: the sun's three shadow maps, the terrain, the grass, the trees. Here it is let go of while the eye is shut
// in, on the one frame that changes, and down the bunker so is whatever stands on a floor the eye is not on: its furniture and the infected on it.

import * as THREE from 'three';
import { BUNKER_FAR, bunkerSealed, type Place } from '../sim/bunker';
import { MINE, inMine } from '../sim/mine';
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

export class Underground {
  /** nothing of the surface can be seen from where the eye is */
  shut = false;
  /** how far the world goes while it is (src/game/game/frame.ts) */
  readonly far = BUNKER_FAR;
  private seen = '';

  constructor(private h: UndergroundHost) {
    // (a gun rack is dark steel: down the bunker it stood as a black block, and what was on it with it)
    for (const o of h.scene.children) if (o.name.startsWith('gun_rack:')) selfLit((o as THREE.Mesh).material as THREE.MeshStandardMaterial, 0.45);
  }

  update(eye: THREE.Vector3) {
    const h = this.h, down = bunkerSealed(h.place(), eye.x, eye.y, eye.z);
    const mined = !down && inMine(eye.x, eye.y, eye.z) && Math.min(Math.abs(eye.x - MINE.west.x), Math.abs(eye.x - MINE.east.x)) > MOUTH;
    const shut = down || mined;
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
