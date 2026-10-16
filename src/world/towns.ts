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
import { facadePieces, movePieces } from './facade';
import type { BuildingPlot } from './worldgen';
import { FACADES } from './zavod-plans';

const COME = 320, GO = 380;
/** a facade's frames are drawn within so many metres (its far copy, panels only, beyond): a frame is some 800 triangles of small parts that no thinning brings down, and at 80 m it is a few pixels */
const FACE_COME = 80, FACE_GO = 100;
/** and nothing of it is fetched until the eye is within this (past the longest draw distance, 1500 m): a player in the east never downloads it */
const FACE_FETCH = 1700;
/**
 * Old limewash on the walls' rubble, the brick showing where it has fallen; fresh white on their dressed stone
 * (pictures the buildings already use). The first pass had them the other way: from the road the walls were flat white.
 */
const LIME = 1.45;
const SKIN: KitOptions['sets'] = { fort_wall: { set: 'white_bricks', repeat: 3 }, fort_trim: { set: 'painted_plaster_wall', repeat: 3 } };

/** a building that wears a facade: its kit's pieces, near (with frames) and far (panels only), as the walls are */
interface Faced { kit: string; far: THREE.Group | null; near: THREE.Group | null; making: boolean; close: boolean; shown: boolean; x: number; z: number; r: number; plot: BuildingPlot }

interface Walled { far: THREE.Group; near: THREE.Group | null; making: boolean; close: boolean; shown: boolean; x: number; z: number; r: number; pieces: ReturnType<typeof placedWalls> }

export class Towns {
  private walled: Walled[] = [];
  private faced: Faced[] = [];
  /** triangles of each copy, for whoever measures */
  counts = { far: 0, near: 0, faceFar: 0, faceNear: 0 };

  constructor(
    private atmo: Atmosphere,
    private scene: THREE.Scene,
    private placed: PlacedTown[],
    private buildings: Buildings,
    private ready: (o: THREE.Object3D) => Promise<unknown> = async () => {},
    /** the world's buildings: those of a kind that wears a facade are dressed in it */
    private plots: BuildingPlot[] = [],
  ) {}

  private dress = (m: THREE.MeshStandardMaterial, name: string) => {
    // (the limewashed rubble lightened as the monastery's buildings are: see lime_brick in buildings.ts)
    if (name === 'fort_wall') m.color.multiplyScalar(LIME);
    return this.atmo.register(m, undefined, `town wall ${name}`) ?? m;
  };

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
    // the buildings that wear a facade: nothing of theirs is fetched until the eye comes within FACE_FETCH (see update)
    for (const plot of this.plots) {
      const spec = FACADES[plot.type];
      if (!spec) continue;
      const f: Faced = { kit: spec.kit, far: null, near: null, making: false, close: false, shown: true, x: plot.x, z: plot.z, r: Math.hypot(spec.bays[0], spec.bays[1]) * 1.5 + 2, plot };
      this.faced.push(f);
      this.buildings.keepFar((on) => ((f.shown = on), this.showFace(f)), f.x, f.z, f.r);
    }
  }

  private showFace(f: Faced) {
    if (f.far) f.far.visible = f.shown && !(f.close && f.near);
    if (f.near) f.near.visible = f.shown && f.close;
  }

  /** A facade's pieces as meshes, where its building stands: near, its frames and the world copy; far, its panels in the far copy. */
  private async face(f: Faced, near: boolean) {
    const spec = FACADES[f.plot.type]!, p = f.plot;
    const pieces = movePieces(facadePieces(spec, near), p.x, p.floorY, p.z, p.rot);
    const { meshes, triangles } = await kitMeshes(f.kit, pieces, { lod: near ? 0 : 1, dress: this.dress });
    const g = new THREE.Group();
    g.name = `${p.type} facade ${near ? 'near' : 'far'}`;
    // (the building's own walls behind it cast its shadow: the facade only takes the light)
    for (const m of meshes) {
      m.receiveShadow = true;
      g.add(m);
    }
    await this.ready(g).catch(() => {});
    this.counts[near ? 'faceNear' : 'faceFar'] += triangles;
    this.scene.add(g);
    return g;
  }

  /** Each frame or so: the near copy of a town's walls made when the eye first comes near, and swapped with the far. */
  update(eye: THREE.Vector3) {
    for (const f of this.faced) {
      const d = Math.hypot(eye.x - f.x, eye.z - f.z) - f.r;
      if (f.making) continue;
      const close = d < (f.close ? FACE_GO : FACE_COME);
      if (!f.far && d < FACE_FETCH) {
        f.making = true;
        void this.face(f, false).then((g) => ((f.far = g), (f.making = false), this.showFace(f)));
        continue;
      }
      if (close && !f.near && f.far) {
        f.making = true;
        void this.face(f, true).then((g) => ((f.near = g), (f.making = false), this.showFace(f)));
      }
      if (close !== f.close) {
        f.close = close;
        this.showFace(f);
      }
    }
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
