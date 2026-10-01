import * as THREE from 'three';

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
    for (let i = 0; i < a.count; i++) {
      out[i * a.itemSize] = a.getX(i);
      if (a.itemSize > 1) out[i * a.itemSize + 1] = a.getY(i);
      if (a.itemSize > 2) out[i * a.itemSize + 2] = a.getZ(i);
      if (a.itemSize > 3) out[i * a.itemSize + 3] = a.getW(i);
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
