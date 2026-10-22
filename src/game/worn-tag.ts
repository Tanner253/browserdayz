// The dog tag worn on the chest (2026-10-22), so that a tag is seen on everybody: steel, or gold on a VIP. The owner:
// "we should render the users dogtag on their player, so the gold and silver dogtags mean something visually. the
// togtag needs to render on top of whatever gear the player is wearing somehow". The game's own tag (the item's two
// plates on their ring, src/game/procedural.ts) hung at the breastbone on a chain round the neck, laid on whatever is
// worn there: a ray from in front of the body, at the tag's height, finds the front of the vest it is to lie on.
// Worn by every survivor alike, carrying a live tag or not: it says nothing about who is worth killing.

import * as THREE from 'three';
import { polished } from './finish';
import { proceduralParts } from './procedural';
import type { Atmosphere } from '../world/atmosphere';

/** where the tag hangs at rest, metres (x to the body's right, y up, z behind it), with nothing worn over the chest */
const AT = { y: 1.285, chest: -0.118 };
/** how far off what it lies on, and how big it is against life (a little over, to be seen at all across a field) */
const OFF = 0.005, SIZE = 1.25;

let steel: THREE.MeshStandardMaterial | null = null, gold: THREE.MeshStandardMaterial | null = null;
const registered = new WeakSet<Atmosphere>();
// (both polished metal under the store's own room, as the gold Desert Eagle is: under the world's sky alone, a tag
// facing the horizon mirrored the dark below it. Steel a little duller than gold.)
function materials(atmo: Atmosphere) {
  steel ??= polished('nickel', 0.3);
  gold ??= polished('gold', 0.14);
  if (!registered.has(atmo)) {
    registered.add(atmo);
    atmo.register(steel);
    atmo.register(gold);
  }
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
  private ray = new THREE.Raycaster();
  private restOf = new THREE.Matrix4();

  constructor(private atmo: Atmosphere, layerMask: number) {
    const g = geometry(), m = materials(atmo);
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
    const m = materials(this.atmo)[kind];
    for (const o of [this.mesh, ...this.chain]) o.material = m;
  }

  /**
   * Hung on the chest bone, on whatever is worn over the chest: each worn thing as it sits at rest (`rest`: its
   * place on the body at rest, as GEAR puts it), a ray from in front at the tag's height, and the nearest hit is
   * what it lies on. `inv` takes the body at rest to the bone's own space.
   */
  fit(bone: THREE.Object3D, inv: THREE.Matrix4, worn: { obj: THREE.Object3D; rest: THREE.Matrix4 }[], over = 0) {
    // (`over`: what is worn as part of the suit itself, the plate carrier, which is not a thing of its own to be measured)
    let z = AT.chest - over;
    this.ray.set(new THREE.Vector3(0, AT.y - 0.02, -1), new THREE.Vector3(0, 0, 1));
    this.ray.far = 2;
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
        const hit = this.ray.intersectObject(mesh, false)[0];
        mesh.matrixWorld.copy(was);
        if (hit) z = Math.min(z, hit.point.z - OFF);
      });
    }
    this.group.matrix.copy(inv).multiply(new THREE.Matrix4().makeTranslation(0, AT.y, z));
    if (this.group.parent !== bone) bone.add(this.group);
  }
}
