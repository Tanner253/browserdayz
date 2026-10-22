// The dog tag worn on the chest (2026-10-22), so that a tag is seen on everybody: steel, or gold on a VIP. The owner:
// "we should render the users dogtag on their player, so the gold and silver dogtags mean something visually. the
// togtag needs to render on top of whatever gear the player is wearing somehow". The game's own tag (the item's two
// plates on their ring, src/game/procedural.ts) hung at the breastbone on a chain round the neck, laid on whatever is
// worn there: a ray from in front of the body, at the tag's height, finds the front of the vest it is to lie on.
// Worn by every survivor alike, carrying a live tag or not: it says nothing about who is worth killing.

import * as THREE from 'three';
import { polished } from './finish';
import { proceduralParts } from './procedural';

/** where the tag hangs at rest, metres (x to the body's right, y up, z behind it); the chest's front is measured (`measure`) */
const AT = { y: 1.285 };
/** how far off what it lies on, and how big it is against life (a little over, to be seen at all across a field) */
const OFF = 0.005, SIZE = 1.25;
/** the heights below the hanging point where what it lies on is measured: down the plates' length, metres */
const DOWN = [0.005, 0.03, 0.06, 0.09, 0.115];

let steel: THREE.Material | null = null, gold: THREE.Material | null = null;
const measured = new Map<string, { chest: number; pieces: Map<string, number> }>();
// (both with the same shine as the gold Desert Eagle: src/game/finish.ts)
function materials() {
  steel ??= polished('nickel');
  gold ??= polished('gold');
  return { steel, gold };
}

/** the plates hung upright, faces forward, hole at the top; and the chain from it to either side of the collar */
function geometry() {
  const plates = proceduralParts('@dogtag')[0].geometry.clone();
  // (made lying flat, long side along x with the hole at -x: stood up, its face toward -z, the hole on top)
  plates.rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).scale(SIZE, SIZE, SIZE);
  plates.computeBoundingBox();
  const top = plates.boundingBox!.max.y;
  plates.translate(0, -top, 0);
  const side = (s: number) =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.022, 0.05, 0.012), new THREE.Vector3(s * 0.05, 0.1, 0.045), new THREE.Vector3(s * 0.062, 0.13, 0.09)]), 12, 0.0011, 4);
  return { plates, chain: [side(1), side(-1)] };
}

export class WornTag {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private chain: THREE.Mesh[];
  private kind: 'steel' | 'gold' | null = null;
  // (every layer: bodies and what they wear are drawn on the body's own, which a ray of its own would pass through)
  private ray = Object.assign(new THREE.Raycaster(), { layers: Object.assign(new THREE.Layers(), { mask: 0xffffffff }) });
  private restOf = new THREE.Matrix4();
  /** the front of the body's chest at the tag's height, and of each piece of the suit that may be worn over it (rest, metres) */
  private chest = -0.13;
  private pieceFront = new Map<string, number>();

  constructor(layerMask: number) {
    const g = geometry(), m = materials();
    this.mesh = new THREE.Mesh(g.plates, m.steel);
    this.chain = g.chain.map((c) => new THREE.Mesh(c, m.steel));
    for (const o of [this.mesh, ...this.chain]) {
      o.castShadow = true;
      o.layers.mask = layerMask;
      this.group.add(o);
    }
    this.group.layers.mask = layerMask;
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
  }

  /** steel, gold, or none at all (a body that is dead, or no body yet) */
  wear(kind: 'steel' | 'gold' | null) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.group.visible = !!kind;
    if (!kind) return;
    const m = materials()[kind];
    for (const o of [this.mesh, ...this.chain]) o.material = m;
  }

  /**
   * The nearest thing in front of the chest among these as they stand now (the body at rest), at each height down the
   * tag's length: a vest bulges below the breastbone, and the plates sank into it when it was measured at the top only.
   */
  private front(objs: THREE.Object3D[]): number {
    let z = NaN;
    for (const dy of DOWN) {
      this.ray.set(new THREE.Vector3(0, AT.y - dy, -1), new THREE.Vector3(0, 0, 1));
      this.ray.far = 2;
      const hit = this.ray.intersectObjects(objs, false)[0];
      if (hit && !(hit.point.z >= z)) z = hit.point.z;
    }
    return z;
  }

  /**
   * The body measured once, at rest, as it is made (each of its kind measured alike: cached by its shape): the front of
   * its chest, and of each piece of the suit worn over it (the plate carrier, which is part of the body, not a thing).
   */
  measure(body: THREE.Object3D, pieces: Map<string, THREE.Object3D>) {
    const skin: THREE.Object3D[] = [];
    body.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && ![...pieces.values()].includes(o) && skin.push(o));
    const key = skin.map((o) => (o as THREE.Mesh).geometry.uuid).join();
    let m = measured.get(key);
    if (!m) {
      body.updateMatrixWorld(true);
      m = { chest: this.front(skin), pieces: new Map([...pieces].map(([n, o]) => [n, this.front([o])])) };
      measured.set(key, m);
    }
    if (Number.isFinite(m.chest)) this.chest = m.chest;
    this.pieceFront = m.pieces;
  }

  /**
   * Hung on the chest bone, on whatever is worn over the chest: each worn thing as it sits at rest (`rest`: its
   * place on the body at rest, as GEAR puts it), a ray from in front at the tag's height, and the nearest hit is
   * what it lies on. `inv` takes the body at rest to the bone's own space.
   */
  fit(bone: THREE.Object3D, inv: THREE.Matrix4, worn: { obj: THREE.Object3D; rest: THREE.Matrix4 }[], shown: string[] = []) {
    // (`shown`: the pieces of the suit worn now, measured at rest with the body)
    let z = this.chest - OFF;
    for (const n of shown) {
      const f = this.pieceFront.get(n);
      if (f !== undefined && Number.isFinite(f)) z = Math.min(z, f - OFF);
    }
    for (const { obj, rest } of worn) {
      // (the thing hangs in a holder on the bone, the holder where `rest` puts it: what is below the holder is its own)
      const holder = obj.parent ?? obj;
      holder.updateWorldMatrix(true, true);
      const back = holder.matrixWorld.clone().invert();
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // (the mesh where it is with the body at rest: its place within the holder, under the thing's place on the body)
        const was = mesh.matrixWorld.clone();
        mesh.matrixWorld.copy(this.restOf.copy(rest).multiply(back).multiply(was));
        const f = this.front([mesh]);
        mesh.matrixWorld.copy(was);
        if (Number.isFinite(f)) z = Math.min(z, f - OFF);
      });
    }
    this.group.matrix.copy(inv).multiply(new THREE.Matrix4().makeTranslation(0, AT.y, z));
    if (this.group.parent !== bone) bone.add(this.group);
  }
}
