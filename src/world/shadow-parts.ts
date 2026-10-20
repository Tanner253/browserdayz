import * as THREE from 'three';

/**
 * A BatchedMesh drawn only into the sun's shadow maps (the buildings' one shape for them), each map given only the
 * parts that lie in it (2026-10-20, the owner: "we're gonna have to think a little harder or dig a little deeper to
 * figure out how to maximize performance").
 *
 * Every part within the draw distance went into every cascade: the nearest, a few tens of metres across, drew the
 * whole town's walls and roofs with the widest, some 650 thousand triangles three times a frame (measured in the
 * owner's flight). three's own test of each part (`perObjectFrustumCulled`) sends the list of what is drawn to the
 * graphics card as a picture on every drawing, and cost more than it saved (2026-10-18); here only the list of ranges
 * handed to the one multi-draw call is cut, which the card is never sent. That holds because every part of the shape
 * is in the world's own frame (no part has a matrix of its own) and none has a colour: whichever part a range is
 * taken for, it is drawn as itself.
 */
export function partsPerShadowMap(mesh: THREE.BatchedMesh) {
  type Inner = {
    _multiDrawStarts: Int32Array;
    _multiDrawCounts: Int32Array;
    _multiDrawCount: number;
    _geometryInfo: { start: number; count: number }[];
    _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  };
  const m = mesh as unknown as Inner;
  const balls = m._instanceInfo.map((it) => mesh.getBoundingSphereAt(it.geometryIndex, new THREE.Sphere()) ?? new THREE.Sphere(new THREE.Vector3(), Infinity));
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4();
  mesh.onBeforeShadow = (_renderer, _object, _camera, shadowCamera, geometry) => {
    // (unindexed: a range is counted in points)
    const step = geometry.getIndex() ? geometry.getIndex()!.array.BYTES_PER_ELEMENT : 1;
    view.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(view, shadowCamera.coordinateSystem);
    // (development: every part in every map again, as it was, to measure the difference)
    const all = !!(globalThis as { __casterAll?: boolean }).__casterAll;
    let n = 0;
    for (let i = 0; i < m._instanceInfo.length; i++) {
      const it = m._instanceInfo[i];
      if (!it.visible || !it.active || (!all && !frustum.intersectsSphere(balls[i]))) continue;
      const g = m._geometryInfo[it.geometryIndex];
      m._multiDrawStarts[n] = g.start * step;
      m._multiDrawCounts[n] = g.count;
      n++;
    }
    m._multiDrawCount = n;
  };
}
