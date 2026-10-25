// A thing that is neither gun nor club, in a body's right fist (2026-10-24, moved here out of src/game/doll.ts, where
// the inventory's figure holds a bandage, a tin, a flask or a magazine so): the way a thing to hit with is carried,
// the fist closed round the thing's length. What is too thick to close a fist round (a fuel can, a first aid kit) is
// carried from its top, hanging under the hand: hanging, so it is kept upright whichever way the hand is turned, as its
// own weight would keep it. Everybody else's body holds a torch so too (the navigator: "A lit torch must be seen in
// someone's hands by everyone near, flame and light; at night it's the biggest tell there is").

import * as THREE from 'three';
import type { Grips } from './arms';
import { HELD_FIT } from './held-size';
import { proceduralParts } from './procedural';

export type Held = { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee'; plumb?: THREE.Object3D };

/** where along its length the fist closes round a thing held so, from its foot (its middle, unless said) */
const GRIPPED_AT: Record<string, number> = { torch: 0.22 };

/** `model` (the thing as it lies, a copy the hand may keep) held in the right fist, in the hand's own frame */
export function inFist(model: THREE.Object3D, id: string): Held | null {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return null;
  // (a building material at a tin's size, as the hands hold it in first person: src/game/held-size.ts)
  const fit = HELD_FIT[id];
  if (fit) {
    const s = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(fit / Math.max(s.x, s.y, s.z));
    model.updateMatrixWorld(true);
    box.setFromObject(model);
  }
  const size = box.getSize(new THREE.Vector3()).toArray();
  model.position.sub(box.getCenter(new THREE.Vector3()));
  // (the hand's own frame, as a club's is said: the handle along y, the fingers toward -z, the palm facing -x)
  const turned = new THREE.Group();
  turned.add(model);
  /** the thing's own three ways are laid along the hand's: `along` the handle, `through` the fist, `across` the fingers */
  const lay = (along: number, across: number, through: number, up: THREE.Vector3, out: THREE.Vector3) => {
    const to: THREE.Vector3[] = [];
    to[along] = up;
    to[through] = out;
    to[across] = up.clone().cross(out);
    // (turned, and not turned inside out)
    if (to[0].clone().cross(to[1]).dot(to[2]) < 0) to[across].negate();
    turned.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(to[0], to[1], to[2]));
  };
  const obj = new THREE.Group();
  obj.add(turned);
  const fist = (x: number, curl: number) => ({ pos: new THREE.Vector3(x, 0, 0.05), fingers: new THREE.Vector3(-0.2, -0.3, -1), palm: new THREE.Vector3(-1, 0, 0), curl: [curl, curl + 0.04, curl + 0.08, curl + 0.1] as [number, number, number, number], thumb: 0.9, tuck: 0.8 });
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]), thick = size[order[2]];
  if (thick <= 0.095) {
    lay(order[0], order[1], order[2], new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    // (held low on its length where it is held so: a torch by its stick, its head up out of the fist)
    turned.position.y = (0.5 - (GRIPPED_AT[id] ?? 0.5)) * size[order[0]];
    return { obj, grips: { right: fist(0.012 + thick / 2, THREE.MathUtils.clamp(1.2 - (thick - 0.03) * 9, 0.6, 1.3)), left: null }, kind: 'melee' };
  }
  // (Said in the room's own frame, which the part that hangs is kept to. Its thinnest way is across the leg, as
  // a case is carried. What stands upright as it comes, a fuel can, hangs upright; what lies flat as it comes, a
  // first aid kit, is stood on its edge, its longest side fore and aft. It is under the fist by half its height,
  // and out from the leg by as much of it as would have been inside the leg.)
  const thin = order[2], tall = thin === 1 ? order[1] : 1, long = 3 - thin - tall;
  lay(tall, long, thin, new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  turned.position.set(Math.max(0, size[thin] / 2 - 0.05), -(size[tall] / 2 + 0.02), 0);
  const plumb = new THREE.Group();
  plumb.add(turned);
  obj.add(plumb);
  return { obj, grips: { right: fist(0.03, 1.12), left: null }, kind: 'melee', plumb };
}

/** a torch in somebody's fist, made at once (its model is the game's own: src/game/procedural.ts), its head named so */
export function torchInFist(): Held | null {
  const g = new THREE.Group();
  for (const p of proceduralParts('@torch')) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.name = p.name;
    g.add(m);
  }
  return inFist(g, 'torch');
}

/** where the head of a torch held so is in the world: the top of its part named `head` (null: none in it) */
export function torchHead(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 | null {
  const head = obj.getObjectByName('head');
  if (!head) return null;
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(head);
  return box.isEmpty() ? null : box.getCenter(out).setY(box.max.y);
}
