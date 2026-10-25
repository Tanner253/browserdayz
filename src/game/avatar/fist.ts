// A thing that is neither gun nor club, in the right fist: a bandage, a tin, a flask, a grenade, a torch, a magazine.
// Every body holds it so (the game's own, everybody else's, the inventory's figure): the way a thing to hit with is
// carried, the fist closed round the thing's length at its middle. What is too thick to close a fist round (a fuel
// can, a first aid kit) is carried from its top, hanging under the hand: hanging, so it is kept upright whichever way
// the hand is turned (`plumb`, levelled by whoever poses the body), as its own weight would keep it.

import * as THREE from 'three';
import type { Grips } from '../arms';

export interface InFist { obj: THREE.Object3D; grips: Grips; kind: 'melee'; plumb?: THREE.Object3D }

/** `model` (a copy of the thing's own, as it lies) taken into the right fist; null for one with nothing to it */
export function fistOf(model: THREE.Object3D): InFist | null {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return null;
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
    return { obj, grips: { right: fist(0.012 + thick / 2, THREE.MathUtils.clamp(1.2 - (thick - 0.03) * 9, 0.6, 1.3)), left: null }, kind: 'melee' };
  }
  // (Said in the body's own frame, which the part that hangs is kept to. Its thinnest way is across the leg, as a case
  // is carried. What stands upright as it comes, a fuel can, hangs upright; what lies flat as it comes, a first aid
  // kit, is stood on its edge, its longest side fore and aft. It is under the fist by half its height, and out from
  // the leg by as much of it as would have been inside the leg.)
  const thin = order[2], tall = thin === 1 ? order[1] : 1, long = 3 - thin - tall;
  lay(tall, long, thin, new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  turned.position.set(Math.max(0, size[thin] / 2 - 0.05), -(size[tall] / 2 + 0.02), 0);
  const plumb = new THREE.Group();
  plumb.add(turned);
  obj.add(plumb);
  // (and said on the thing too, for a body handed it as any other thing to hold: see Avatar.takeUp)
  obj.userData.plumb = plumb;
  return { obj, grips: { right: fist(0.03, 1.12), left: null }, kind: 'melee', plumb };
}
