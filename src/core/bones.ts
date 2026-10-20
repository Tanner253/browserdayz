import * as THREE from 'three';

/**
 * A bone's place in the world is worked out again only when it, or what it hangs from, has changed since it last was:
 * the same sums, done once. Found posing twenty players in Kamenka in the game (2026-10-20: the owner, "get in the game
 * yourself ... run real data, fix real problems"): each body worked out its joints some six hundred times a frame for
 * eighty-five of them, every ask for where a hand or the chest is in the world going up the whole chain to the root
 * and putting every joint on it together again, and every turn given to a joint putting together everything below it
 * (each finger again for every bend of the spine), then the scene doing all of them once more before drawing.
 *
 * Each bone keeps the position, turn and size it was last put together from, and what it hung from then: the version
 * of its parent bone, or the parent's own matrix by value for the bone at the top of a skeleton. Asked again with
 * nothing changed, it is as it was; changed, it is put together exactly as three does it. Anything under a bone that is
 * not a bone (worn gear, a held gun) is worked out as three always did, whenever its bone is.
 */
type Kept = THREE.Bone & { _k?: Float64Array; _v?: number; _pv?: number };

let stamp = 0;
const std = { umw: THREE.Object3D.prototype.updateMatrixWorld, uwm: THREE.Object3D.prototype.updateWorldMatrix };

/** this bone's matrices made current; whether they had to be worked out */
function refresh(b: Kept): boolean {
  const parent = b.parent as Kept | null;
  if (!b.matrixAutoUpdate || !b.matrixWorldAutoUpdate || b.pivot !== null) {
    // (not a bone as the game's are: as three does it)
    if (b.matrixAutoUpdate) b.updateMatrix();
    if (b.matrixWorldAutoUpdate) {
      if (parent === null) b.matrixWorld.copy(b.matrix);
      else b.matrixWorld.multiplyMatrices(parent.matrixWorld, b.matrix);
    }
    b.matrixWorldNeedsUpdate = false;
    b._v = ++stamp;
    b._k = undefined;
    return true;
  }
  const p = b.position, q = b.quaternion, s = b.scale;
  let k = b._k;
  if (k !== undefined && !b.matrixWorldNeedsUpdate && k[0] === p.x && k[1] === p.y && k[2] === p.z && k[3] === q.x && k[4] === q.y && k[5] === q.z && k[6] === q.w && k[7] === s.x && k[8] === s.y && k[9] === s.z) {
    if (parent === null) return false;
    if ((parent as THREE.Bone).isBone) {
      if (b._pv === parent._v) return false;
    } else {
      const e = parent.matrixWorld.elements;
      let same = true;
      for (let i = 0; i < 16; i++) {
        if (k[10 + i] !== e[i]) {
          same = false;
          break;
        }
      }
      if (same) return false;
    }
  }
  if (k === undefined) k = b._k = new Float64Array(26);
  k[0] = p.x;
  k[1] = p.y;
  k[2] = p.z;
  k[3] = q.x;
  k[4] = q.y;
  k[5] = q.z;
  k[6] = q.w;
  k[7] = s.x;
  k[8] = s.y;
  k[9] = s.z;
  b.matrix.compose(p, q, s);
  if (parent === null) b.matrixWorld.copy(b.matrix);
  else {
    b.matrixWorld.multiplyMatrices(parent.matrixWorld, b.matrix);
    if ((parent as THREE.Bone).isBone) b._pv = parent._v;
    else k.set(parent.matrixWorld.elements, 10);
  }
  b.matrixWorldNeedsUpdate = false;
  b._v = ++stamp;
  return true;
}

/**
 * A skeleton's branches with nothing on them are left out of what three goes through to draw: a bone draws nothing, and
 * three went through every body's sixty-five of them looking for something to draw, in the view and in each of the
 * sun's three maps, every frame (twenty players and the infected near them: a millisecond of the frame, found in the
 * game 2026-10-20). Hidden, a bone is still worked out and still moves the skin. A branch with anything hung on it
 * (hair, a helmet, the gun slung on the back, a knife in the hand) is gone through as before, and so is one that
 * anything is hung on later (see keepBones).
 */
export function restBones(root: THREE.Object3D) {
  const holds = (b: THREE.Object3D): boolean => {
    let any = false;
    for (const c of b.children) if (!(c as THREE.Bone).isBone || holds(c)) any = true;
    b.visible = any;
    return any;
  };
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && !(o.parent as THREE.Bone | null)?.isBone) holds(o);
  });
}

export function keepBones() {
  const P = THREE.Bone.prototype as Kept;
  if (Object.prototype.hasOwnProperty.call(P, 'updateMatrixWorld')) return;
  // (whatever is hung on a bone is drawn: the bones it hangs from are gone through again, see restBones)
  const shown = (bone: THREE.Bone) => {
    for (let b: THREE.Object3D | null = bone; b && (b as THREE.Bone).isBone; b = b.parent) b.visible = true;
  };
  const { add, attach } = THREE.Object3D.prototype;
  P.add = function (this: Kept, ...objects: THREE.Object3D[]) {
    shown(this);
    return add.apply(this, objects) as Kept;
  };
  P.attach = function (this: Kept, object: THREE.Object3D) {
    shown(this);
    return attach.call(this, object) as Kept;
  };
  // (development: every bone worked out every time again, as three does, to measure the difference)
  const asWere = () => import.meta.env.DEV && (globalThis as { __bonesAsWere?: boolean }).__bonesAsWere;
  P.updateMatrixWorld = function (this: Kept, force?: boolean) {
    if (asWere()) return std.umw.call(this, force);
    refresh(this);
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) {
      const c = children[i];
      c.updateMatrixWorld((c as THREE.Bone).isBone ? false : true);
    }
  };
  P.updateWorldMatrix = function (this: Kept, updateParents: boolean, updateChildren: boolean, force = false) {
    if (asWere()) return std.uwm.call(this, updateParents, updateChildren, force);
    if (updateParents === true && this.parent !== null) this.parent.updateWorldMatrix(true, false);
    refresh(this);
    if (updateChildren === true) {
      const children = this.children;
      for (let i = 0, l = children.length; i < l; i++) {
        const c = children[i];
        c.updateWorldMatrix(false, true, (c as THREE.Bone).isBone ? false : true);
      }
    }
  };
}
