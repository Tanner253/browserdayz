import * as THREE from 'three';
import { breathe } from './breathe';

export interface MeshPart {
  name: string;
  /** name of the model node the mesh belongs to (several meshes can share one) */
  owner?: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/**
 * Flattens a glTF scene graph into (geometry, material) pairs with node transforms
 * baked into the geometry. Optionally restricted to one child node by name suffix
 * (used to split multi-object packs such as rock sets into separate variants).
 */
export function extractParts(root: THREE.Object3D, only?: (name: string) => boolean): MeshPart[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: MeshPart[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // the named node is usually the mesh's parent for multi-primitive meshes
    const name = m.name || m.parent?.name || '';
    const owner = m.parent && m.parent !== root ? m.parent.name : m.name;
    if (only && !only(name) && !only(owner)) return;
    const g = dequantize(m.geometry.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    parts.push({ name, owner, geometry: g, material: m.material as THREE.Material });
  });
  return parts;
}

/** The same, a mesh at a time and no more of them in a frame than the frame can spare (see ./breathe.ts). */
export async function extractPartsSlowly(root: THREE.Object3D, only?: (name: string) => boolean): Promise<MeshPart[]> {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const parts: MeshPart[] = [];
  for (const m of meshes) {
    const name = m.name || m.parent?.name || '';
    const owner = m.parent && m.parent !== root ? m.parent.name : m.name;
    if (only && !only(name) && !only(owner)) continue;
    await breathe();
    const g = dequantize(m.geometry.clone());
    await breathe();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    parts.push({ name, owner, geometry: g, material: m.material as THREE.Material });
  }
  return parts;
}

/**
 * KHR_mesh_quantization stores positions/normals as normalized int16/int8 with the
 * dequantisation folded into the node transform. Baking a transform into such an
 * attribute would clamp it to [-1, 1], so expand to float32 first.
 */
export function dequantize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of ['position', 'normal', 'tangent']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    if (!a.normalized && a.array instanceof Float32Array && !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    // (Read straight out of what it is kept in, where that is one of the usual ways: the same numbers that asking
    // for each point's x, y and z gives, in a fraction of the time. A rifle is two hundred thousand points.)
    const lace = a as THREE.InterleavedBufferAttribute;
    const src = (lace.isInterleavedBufferAttribute ? lace.data.array : a.array) as ArrayLike<number>;
    const stride = lace.isInterleavedBufferAttribute ? lace.data.stride : a.itemSize, at = lace.isInterleavedBufferAttribute ? lace.offset : 0;
    const signed = src instanceof Int16Array ? 32767 : src instanceof Int8Array ? 127 : 0;
    const whole = src instanceof Uint16Array ? 65535 : src instanceof Uint8Array ? 255 : 0;
    const n = a.itemSize;
    if (!a.normalized) {
      for (let i = 0, o = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[o++] = src[i * stride + at + k];
    } else if (signed) {
      for (let i = 0, o = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[o++] = Math.max(src[i * stride + at + k] / signed, -1);
    } else if (whole) {
      for (let i = 0, o = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[o++] = src[i * stride + at + k] / whole;
    } else {
      for (let i = 0; i < a.count; i++) {
        out[i * n] = a.getX(i);
        if (n > 1) out[i * n + 1] = a.getY(i);
        if (n > 2) out[i * n + 2] = a.getZ(i);
        if (n > 3) out[i * n + 3] = a.getW(i);
      }
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}

/** Names of the top-level child nodes (one per object in a multi-object pack). */
export function topLevelNames(root: THREE.Object3D): string[] {
  return root.children.map((c) => c.name);
}

export function boundsOf(parts: MeshPart[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    b.union(p.geometry.boundingBox!);
  }
  return b;
}

/** Recentres parts so the bounding box sits on y=0 and is centred in xz. */
export function groundParts(parts: MeshPart[]): THREE.Box3 {
  const b = boundsOf(parts);
  const c = b.getCenter(new THREE.Vector3());
  const t = new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z);
  for (const p of parts) p.geometry.applyMatrix4(t);
  return boundsOf(parts);
}

/** The same, a part at a time (see ./breathe.ts). */
export async function groundPartsSlowly(parts: MeshPart[]): Promise<THREE.Box3> {
  const b = new THREE.Box3();
  for (const p of parts) {
    await breathe();
    p.geometry.computeBoundingBox();
    b.union(p.geometry.boundingBox!);
  }
  const c = b.getCenter(new THREE.Vector3());
  const t = new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z);
  const after = new THREE.Box3();
  for (const p of parts) {
    await breathe();
    p.geometry.applyMatrix4(t);
    p.geometry.computeBoundingBox();
    after.union(p.geometry.boundingBox!);
  }
  return after;
}

/**
 * A thing that is put out of sight costs nothing while it is: three works out where every thing in a scene is on
 * every frame, shown or not, piece by piece (a body is sixty-five joints; sixty-eight of the infected stood
 * hidden about the map, and every thing lying in every house). This one, and everything under it, is left as it
 * was for as long as it is hidden, and worked out again on the frame it is shown.
 */
export function restWhileHidden<T extends THREE.Object3D>(o: T): T {
  const work = THREE.Object3D.prototype.updateMatrixWorld;
  o.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    if (!this.visible) {
      // (it is to be worked out whole when it is next shown, whatever has moved meanwhile)
      this.matrixWorldNeedsUpdate = true;
      return;
    }
    work.call(this, force);
  };
  return o;
}
