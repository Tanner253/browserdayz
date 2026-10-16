// The new towns as they are drawn (2026-10-16): the monastery's walls, the fort kit's pieces re-skinned in white
// limewash, and the onion domes over the churches. Their buildings are the world's own (Buildings plans them from
// world.buildings like any other); this is what is not a building. Where things stand: src/sim/towns.ts.
//
// It costs little until somebody goes there:
//   - What stops a body is made at once: a shot from across the valley must stop on a wall.
//   - The kit's far copy (fewer triangles, small pictures) is drawn from the start, the near copy made the first
//     time the eye comes within COME metres, off the frame (`ready`), and swapped in; past GO the far copy again.
//   - Walls and domes are hidden past the player's draw distance as the buildings are (Buildings.keepFar), and
//     count as cover for whoever is behind them (Buildings.hides).

import * as THREE from 'three';
import { physics } from '../core/physics';
import { kitSolids } from '../sim/kit';
import { placedDomes, placedWalls, type PlacedTown } from '../sim/towns';
import type { Atmosphere } from './atmosphere';
import type { Buildings } from './buildings';
import { onionDome } from './domes';
import { kitMeshes, type KitOptions } from './kit';

const COME = 320, GO = 380;
/** white limewash on the walls' rubble, white brick on their dressed stone (pictures the buildings already use) */
const SKIN: KitOptions['sets'] = { fort_wall: { set: 'painted_plaster_wall', repeat: 3 }, fort_trim: { set: 'white_bricks', repeat: 3 } };

interface Walled { far: THREE.Group; near: THREE.Group | null; making: boolean; close: boolean; shown: boolean; x: number; z: number; r: number; pieces: ReturnType<typeof placedWalls> }

export class Towns {
  private walled: Walled[] = [];
  /** triangles of each copy, for whoever measures */
  counts = { far: 0, near: 0 };

  constructor(
    private atmo: Atmosphere,
    private scene: THREE.Scene,
    private placed: PlacedTown[],
    private buildings: Buildings,
    private ready: (o: THREE.Object3D) => Promise<unknown> = async () => {},
  ) {}

  private dress = (m: THREE.MeshStandardMaterial, name: string) => this.atmo.register(m, undefined, `town wall ${name}`) ?? m;

  private show(w: Walled) {
    w.far.visible = w.shown && !(w.close && w.near);
    if (w.near) w.near.visible = w.shown && w.close;
  }

  async build() {
    for (const t of this.placed) {
      const pieces = placedWalls(t);
      if (pieces.length) {
        for (const s of kitSolids(pieces)) {
          if (s.t === 'box') physics.addStaticQuat(physics.R.ColliderDesc.cuboid(s.h[0], s.h[1], s.h[2]), 'concrete', { x: s.c[0], y: s.c[1], z: s.c[2] }, { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] });
          else {
            const hull = physics.R.ColliderDesc.convexHull(new Float32Array(s.pts));
            if (hull) physics.addStatic(hull, 'concrete', { x: 0, y: 0, z: 0 });
          }
        }
        const { meshes, triangles } = await kitMeshes('fort_kit', pieces, { lod: 1, sets: SKIN, dress: this.dress });
        this.counts.far += triangles;
        const far = new THREE.Group();
        far.name = `${t.town.name} walls far`;
        for (const m of meshes) {
          m.castShadow = m.receiveShadow = true;
          far.add(m);
        }
        this.scene.add(far);
        const w: Walled = { far, near: null, making: false, close: false, shown: true, x: t.town.x, z: t.town.z, r: Math.hypot(...t.town.pad), pieces };
        this.walled.push(w);
        this.buildings.keepFar((on) => ((w.shown = on), this.show(w)), w.x, w.z, w.r);
      }
      for (const d of placedDomes(t)) {
        const g = onionDome(this.atmo, new THREE.Vector3(d.x, d.y, d.z), d.size, d.gilt);
        g.name = `${t.town.name} dome`;
        this.scene.add(g);
        this.buildings.keepFar((on) => (g.visible = on), d.x, d.z, 4 * d.size);
      }
    }
  }

  /** Each frame or so: the near copy of a town's walls made when the eye first comes near, and swapped with the far. */
  update(eye: THREE.Vector3) {
    for (const w of this.walled) {
      const d = Math.hypot(eye.x - w.x, eye.z - w.z) - w.r;
      const close = d < (w.close ? GO : COME);
      if (close && !w.near && !w.making) {
        w.making = true;
        void kitMeshes('fort_kit', w.pieces, { sets: SKIN, dress: this.dress }).then(async ({ meshes, triangles }) => {
          const near = new THREE.Group();
          near.name = 'town walls near';
          for (const m of meshes) {
            m.castShadow = m.receiveShadow = true;
            near.add(m);
          }
          await this.ready(near).catch(() => {});
          this.counts.near += triangles;
          this.scene.add(near);
          w.near = near;
          this.show(w);
        });
      }
      if (close !== w.close) {
        w.close = close;
        this.show(w);
      }
    }
  }
}
