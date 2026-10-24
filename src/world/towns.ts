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
//   - A near copy is let go of once the eye is LET_GO past where it is shown, a far one past FAR_LET_GO: its shapes
//     off the graphics card, its paints with them, its pictures left to CardKeep; made again on the way back as the
//     first time. Kept for good, a session's walk round the west filled the card (2026-10-21, the owner: "after playing
//     for a little bit ... my vram got maxed and throttled again").

import * as THREE from 'three';
import { physics } from '../core/physics';
import { kitSolids, type KitPiece } from '../sim/kit';
import { placedDomes, placedKits, placedTowers, placedWalls, type PlacedTown } from '../sim/towns';
import { stairRailSolids, tentSolids, towerSolids } from '../sim/pokrov-towers';
import { stairRails, towerInsides } from './pokrov-towers';
import type { Atmosphere } from './atmosphere';
import type { Buildings } from './buildings';
import { onionDomes } from './domes';
import { tentOnions, tentRoofs } from './pokrov-tents';
import { kitMeshes, stoneLook, type KitOptions } from './kit';
import { facadePieces, movePieces } from './facade';
import type { BuildingPlot } from './worldgen';
import { FACADES } from './zavod-plans';

const COME = 320, GO = 380;
/** a facade's frames are drawn within so many metres (its far copy, panels only, beyond): a frame is some 800 triangles of small parts that no thinning brings down, and at 80 m it is a few pixels */
const FACE_COME = 80, FACE_GO = 100;
/** and nothing of it is fetched until the eye is within this (past the longest draw distance, 1500 m): a player in the east never downloads it */
const FACE_FETCH = 1700;
/** a run of a walkway is drawn near within so many metres */
const WALK_COME = 60, WALK_GO = 80;
/** a near copy let go of this far past where it is shown, metres; a far one past this (no draw distance reaches it) */
const LET_GO = 400, FAR_LET_GO = 2000;
/**
 * Old limewash on the walls, the brick showing where it has fallen (the monastery's buildings wear the same: lime_brick
 * in buildings.ts); their copings and merlons weathered grey by the rain that stands on them. Pictures the game already
 * has. Before 2026-10-23 they were small grey bricks and flat plaster (the owner: "its ugly its textures around the
 * walls dont look good"); the first pass of all had them flat white.
 */
const LIME = 1.3;
const SKIN: KitOptions['sets'] = { fort_wall: { set: 'damaged_plaster', repeat: 2 }, fort_trim: { set: 'worn_mossy_plasterwall', repeat: 2 } };
/** and their foot dark with the wet thrown up off the ground, as the fort's is: two numbers a corner, the sky over it and how high it is over the walls' foot */
const FOOT = stoneLook({ damp: 0.42, attr: 'aFoot', wash: { colour: [0.86, 0.83, 0.76], size: 9 } });
const footOf = (foot: number): KitOptions['attr'] => ({ name: 'aFoot', of: (p) => [1, p[1] - foot] });

/**
 * What is fetched only when the eye comes near (a building's facade, a village's piers): its far copy within
 * FACE_FETCH, its near one within `come` (and kept until `go`), each made by `make`.
 */
interface Lazy { make: (near: boolean) => Promise<THREE.Group>; come: number; go: number; far: THREE.Group | null; near: THREE.Group | null; making: boolean; close: boolean; shown: boolean; x: number; z: number; r: number }

interface Walled { foot: number; far: THREE.Group; near: THREE.Group | null; making: boolean; close: boolean; shown: boolean; x: number; z: number; r: number; pieces: ReturnType<typeof placedWalls>; add: KitOptions['add'] }

export class Towns {
  private walled: Walled[] = [];
  private lazy: Lazy[] = [];
  /** triangles of each copy, for whoever measures */
  counts = { far: 0, near: 0, faceFar: 0, faceNear: 0, kitFar: 0, kitNear: 0 };

  constructor(
    private atmo: Atmosphere,
    private scene: THREE.Scene,
    private placed: PlacedTown[],
    private buildings: Buildings,
    private ready: (o: THREE.Object3D) => Promise<unknown> = async () => {},
    /** the world's buildings: those of a kind that wears a facade are dressed in it */
    private plots: BuildingPlot[] = [],
  ) {}

  /** the monastery's walls: the limewash lightened as its buildings' is (see lime_brick in buildings.ts), the foot damp */
  private dressWall = (m: THREE.MeshStandardMaterial, name: string) => {
    if (name === 'fort_wall' || name === 'fort_trim') m.color.multiplyScalar(LIME);
    return this.atmo.register(m, FOOT, `town wall ${name}`) ?? m;
  };

  private dress = (m: THREE.MeshStandardMaterial, name: string) => {
    // (the pier's planks came with colours at their corners, which the loader paints with; the layout's meshes keep no
    // such colours, and painted with none they were black. And they are marked as metal: wood is not.)
    m.vertexColors = false;
    if (name.startsWith('pier_')) (m.metalness = 0), (m.metalnessMap = null);
    return this.atmo.register(m, undefined, `town wall ${name}`) ?? m;
  };

  /** a copy let go of: out of the world, and its shapes and paints (made for it alone: kitMeshes) off the card */
  private drop(g: THREE.Group) {
    this.scene.remove(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
  }

  private show(w: Walled) {
    w.far.visible = w.shown && !(w.close && w.near);
    if (w.near) w.near.visible = w.shown && w.close;
  }

  async build() {
    for (const t of this.placed) {
      const pieces = placedWalls(t);
      if (pieces.length) {
        // (the corner towers are hollow: what stops a body in them, and what is drawn inside them, is their own plan's;
        // and the walls' stairs have a parapet up their open side)
        const towers = placedTowers(t), add = towerInsides(towers), stairs = pieces.filter((k) => k.id === 'fort_wall_stairs_straight_01');
        add.fort_trim.push(...stairRails(stairs));
        for (const s of [...kitSolids(pieces), ...towers.flatMap(towerSolids), ...towers.flatMap(tentSolids), ...stairs.flatMap(stairRailSolids)]) {
          if (s.t === 'box') physics.addStaticQuat(physics.R.ColliderDesc.cuboid(s.h[0], s.h[1], s.h[2]), 'concrete', { x: s.c[0], y: s.c[1], z: s.c[2] }, { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] });
          else {
            const hull = physics.R.ColliderDesc.convexHull(new Float32Array(s.pts));
            if (hull) physics.addStatic(hull, 'concrete', { x: 0, y: 0, z: 0 });
          }
        }
        const foot = towers[0]?.foot ?? t.padY;
        const { meshes, triangles } = await kitMeshes('fort_kit', pieces, { lod: 1, sets: SKIN, dress: this.dressWall, add, attr: footOf(foot) });
        this.counts.far += triangles;
        const far = new THREE.Group();
        far.name = `${t.town.name} walls far`;
        for (const m of meshes) {
          m.castShadow = m.receiveShadow = true;
          far.add(m);
        }
        this.scene.add(far);
        // (the towers' tents: a few hundred triangles, one copy near and far)
        if (towers.length) {
          const tents = tentRoofs(towers, this.buildings.paintOf('roof_green_paint'), this.buildings.paintOf('boards_pale'));
          tents.name = `${t.town.name} tower tents`;
          this.scene.add(tents);
          this.buildings.keepFar((on) => (tents.visible = on), t.town.x, t.town.z, Math.hypot(...t.town.pad));
        }
        const w: Walled = { foot, far, near: null, making: false, close: false, shown: true, x: t.town.x, z: t.town.z, r: Math.hypot(...t.town.pad), pieces, add };
        this.walled.push(w);
        this.buildings.keepFar((on) => ((w.shown = on), this.show(w)), w.x, w.z, w.r);
      }
      // (a town's domes, its towers' onions among them, are three things to draw: src/world/domes.ts)
      const domes = [...placedDomes(t).map((d) => ({ at: new THREE.Vector3(d.x, d.y, d.z), size: d.size, gilt: d.gilt })), ...tentOnions(placedTowers(t))];
      if (domes.length) {
        const g = onionDomes(this.atmo, domes);
        g.name = `${t.town.name} domes`;
        this.scene.add(g);
        this.buildings.keepFar((on) => (g.visible = on), t.town.x, t.town.z, Math.hypot(...t.town.pad));
      }
    }
    // the buildings that wear a facade, and the towns' other kits (piers): nothing of theirs is fetched until the eye comes within FACE_FETCH (see update)
    const later = (make: Lazy['make'], come: number, go: number, x: number, z: number, r: number) => {
      const f: Lazy = { make, come, go, far: null, near: null, making: false, close: false, shown: true, x, z, r };
      this.lazy.push(f);
      this.buildings.keepFar((on) => ((f.shown = on), this.showFace(f)), x, z, r);
    };
    for (const plot of this.plots) {
      const spec = FACADES[plot.type];
      if (spec) later((near) => this.face(plot, near), FACE_COME, FACE_GO, plot.x, plot.z, Math.hypot(spec.bays[0], spec.bays[1]) * 1.5 + 2);
    }
    for (const t of this.placed) for (const k of placedKits(t)) {
      // (what stops a body is there from the start, as the walls')
      for (const b of k.boxes) physics.addStaticQuat(physics.R.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2]), 'wood', { x: b.c[0], y: b.c[1], z: b.c[2] }, { x: 0, y: Math.sin(b.rot / 2), z: 0, w: Math.cos(b.rot / 2) });
      // (each run of a walkway by itself: a section of boards is some 2,000 triangles near, 600 far, and a swamp has eighty of them)
      later((near) => this.pieces(k.kit, k.pieces, near, `${t.town.name} ${k.kit}`), WALK_COME, WALK_GO, k.x, k.z, k.r);
    }
  }

  /** A town's pieces of a kit as meshes: near, the world copy; far, the far copy. They cast their own shadows. */
  private async pieces(kit: string, pieces: KitPiece[], near: boolean, name: string) {
    const { meshes, triangles } = await kitMeshes(kit, pieces, { lod: near ? 0 : 1, dress: this.dress });
    const g = new THREE.Group();
    g.name = `${name} ${near ? 'near' : 'far'}`;
    for (const m of meshes) {
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    await this.ready(g).catch(() => {});
    this.counts[near ? 'kitNear' : 'kitFar'] += triangles;
    this.scene.add(g);
    return g;
  }

  private showFace(f: Lazy) {
    if (f.far) f.far.visible = f.shown && !(f.close && f.near);
    if (f.near) f.near.visible = f.shown && f.close;
  }

  /** A facade's pieces as meshes, where its building stands: near, its frames and the world copy; far, its panels in the far copy. */
  private async face(p: BuildingPlot, near: boolean) {
    const spec = FACADES[p.type]!;
    const pieces = movePieces(facadePieces(spec, near), p.x, p.floorY, p.z, p.rot);
    const { meshes, triangles } = await kitMeshes(spec.kit, pieces, { lod: near ? 0 : 1, dress: this.dress });
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
    for (const f of this.lazy) {
      const d = Math.hypot(eye.x - f.x, eye.z - f.z) - f.r;
      if (f.making) continue;
      const close = d < (f.close ? f.go : f.come);
      if (!f.far && d < FACE_FETCH) {
        f.making = true;
        void f.make(false).then((g) => ((f.far = g), (f.making = false), this.showFace(f)));
        continue;
      }
      if (close && !f.near && f.far) {
        f.making = true;
        void f.make(true).then((g) => ((f.near = g), (f.making = false), this.showFace(f)));
      }
      if (close !== f.close) {
        f.close = close;
        this.showFace(f);
      }
      if (f.near && d > f.go + LET_GO) {
        this.drop(f.near);
        f.near = null;
      }
      if (f.far && d > FAR_LET_GO) {
        this.drop(f.far);
        f.far = null;
      }
    }
    for (const w of this.walled) {
      const d = Math.hypot(eye.x - w.x, eye.z - w.z) - w.r;
      const close = d < (w.close ? GO : COME);
      if (close && !w.near && !w.making) {
        w.making = true;
        void kitMeshes('fort_kit', w.pieces, { sets: SKIN, dress: this.dressWall, add: w.add, attr: footOf(w.foot) }).then(async ({ meshes, triangles }) => {
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
          w.making = false;
          this.show(w);
        });
      }
      if (w.near && d > GO + LET_GO) {
        this.drop(w.near);
        w.near = null;
        this.show(w);
      }
      if (close !== w.close) {
        w.close = close;
        this.show(w);
      }
    }
  }
}
