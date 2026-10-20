// See-through things seen from both sides, drawn in one go and not two.
//
// three draws a see-through material that shows both its faces in two passes, its back faces and then its front ones,
// and marks the material changed before each: its shader is chosen again twice a frame, for every such thing in sight
// (eyeglasses on the infected, a jeep's windows, a lamp's glass, the lens of a sight: twenty times a frame at the
// village crossroads with the horde about, 0.8 ms of the frame). The same picture in one draw: the shape is given a
// copy of every triangle turned the other way, laid before its own, and the thing is drawn with its front faces only.
// A triangle seen from behind is drawn as its copy, in the copies' run; one seen from in front as itself, in the
// run after: every back face and then every front face, each in its own order, as three's two passes have them. The
// copies are lit as three lights a back face (its FLIP_SIDED shader turns the normal, and the bitangent with it):
// their normals turned, and the tangent's sign with them.
//
// Not for a batch of many shapes (each part's two runs would be drawn part by part), nor for shapes that change (morph
// targets), nor where a back face is lit otherwise (a normal map in the object's own frame, flat shading). A thing
// drawn many times over (an InstancedMesh: the glass of every stove, of every street lamp) is drawn copy by copy, each
// copy's back faces and then its front; its copies were drawn nearest first in three's two passes too, so between two
// copies nothing changes, and within one nothing does. (Left out until 2026-10-20, they were still chosen again twice a
// frame each: found counting what makes three choose a shader again, the stoves' glass and the lamps' the most.)

import * as THREE from 'three';

const shapes = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** the shapes made here (each with its copies laid before it), and what each was made from */
const made = new WeakSet<THREE.BufferGeometry>();
const origin = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
const paints = new WeakMap<THREE.Material, THREE.Material>();

/** the shape with every triangle laid twice: turned the other way, with its normal turned, and then as it was */
function bothWays(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = shapes.get(src);
  if (out) return out;
  const n = src.attributes.position.count;
  out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes) as [string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute][]) {
    // (each number as it is stored, in its own kind of array, so that the card reads the copy as it reads the shape:
    // a weight of 8 bits made a float is not always the float the card makes of it)
    const size = a.itemSize;
    const inter = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute) : null;
    const from = inter ? inter.data.array : (a as THREE.BufferAttribute).array, stride = inter ? inter.data.stride : size, off = inter ? inter.offset : 0;
    const Kind = from.constructor as new (n: number) => THREE.TypedArray;
    const arr = new Kind(n * 2 * size);
    // (the most a signed whole number of this kind holds: its least, turned, is held as this)
    const top = from instanceof Int8Array ? 127 : from instanceof Int16Array ? 32767 : from instanceof Int32Array ? 2147483647 : Infinity;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < size; c++) {
        const v = from[i * stride + off + c];
        // (the copy's normal turned; of its tangent, only the sign that makes the bitangent: see the head of the file)
        arr[i * size + c] = name === 'normal' || (name === 'tangent' && c === 3) ? Math.min(-v, top) : v;
        arr[(n + i) * size + c] = v;
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  }
  const idx = src.index;
  const count = idx ? idx.count : n, tri = count / 3;
  const at = (k: number) => (idx ? idx.getX(k) : k);
  const index = n * 2 > 65535 ? new Uint32Array(count * 2) : new Uint16Array(count * 2);
  for (let t = 0; t < tri; t++) {
    const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2);
    index[t * 3] = a;
    index[t * 3 + 1] = c;
    index[t * 3 + 2] = b;
    index[count + t * 3] = n + a;
    index[count + t * 3 + 1] = n + b;
    index[count + t * 3 + 2] = n + c;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  if (src.boundingBox) out.boundingBox = src.boundingBox.clone();
  if (src.boundingSphere) out.boundingSphere = src.boundingSphere.clone();
  out.name = src.name;
  out.userData = src.userData;
  shapes.set(src, out);
  made.add(out);
  origin.set(out, src);
  return out;
}

/**
 * The same paint showing its front faces only: everything else read through from the paint itself, as it is now and
 * as it is changed (one made from it with `Object.create`, which has of its own only what makes it a paint apart).
 */
function frontOf(m: THREE.Material): THREE.Material {
  let f = paints.get(m);
  if (f) return f;
  f = Object.create(m) as THREE.Material;
  Object.defineProperty(f, 'id', { value: (new THREE.Material() as unknown as { id: number }).id });
  Object.defineProperty(f, 'uuid', { value: THREE.MathUtils.generateUUID(), writable: true });
  f.side = THREE.FrontSide;
  (f as unknown as { _listeners: unknown })._listeners = undefined;
  paints.set(m, f);
  return f;
}

/** whether three would draw this thing in two passes, and it can be drawn in one as it is (see the head of the file) */
function fits(o: THREE.Mesh): boolean {
  const m = o.material;
  if (Array.isArray(m) || !m.transparent || m.side !== THREE.DoubleSide || m.forceSinglePass) return false;
  if ((o as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false;
  const g = o.geometry, s = m as THREE.MeshStandardMaterial;
  if (!g.attributes.position || g.morphAttributes.position || g.groups.length > 1) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  if (s.flatShading || s.normalMapType === THREE.ObjectSpaceNormalMap) return false;
  return true;
}

/** (for checking it: every such thing under `root` drawn in two passes again, as three would, until the next look) */
export function twoPasses(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !made.has(m.geometry) || Array.isArray(m.material)) return;
    m.geometry = origin.get(m.geometry)!;
    m.material = Object.getPrototypeOf(m.material) as THREE.Material;
  });
}

/** every such thing under `root` that has come since the last look, drawn in one go from now on */
export function oneDraw(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.material;
    // (a shape made here given a paint of both sides since, by whatever: drawn both sides of its copies too, it
    // would be twice as thick, so its paint is the front of that one)
    if (made.has(m.geometry)) {
      if (!Array.isArray(p) && p.side === THREE.DoubleSide && !p.forceSinglePass) m.material = frontOf(p);
      return;
    }
    if (!fits(m)) return;
    m.geometry = bothWays(m.geometry);
    m.material = frontOf(p as THREE.Material);
  });
}
