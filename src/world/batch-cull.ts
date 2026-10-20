import * as THREE from 'three';

/**
 * A BatchedMesh whose copies stand still, culled a copy at a time in every drawing of it (the view and each of the
 * sun's shadow maps) without anything sent to the graphics card for it (2026-10-20, found playing the game through:
 * the owner, "get in to the game and find out when lags spikes happen and why").
 *
 * three's own culling (`perObjectFrustumCulled`) makes a new list of what is drawn for every drawing, and with it a new
 * picture telling the card which copy each range is: a call to the card each time, about a sixth of a millisecond, some
 * twenty of them a frame for the furniture alone. Without it every copy within the draw distance went into every
 * drawing, the buildings' walls and roofs into all three shadow maps. Here the list is one range for each copy, in its
 * own place, always: that picture is sent once, and a copy out of a drawing is a range of nothing.
 * @param shadowOnly drawn into the shadow maps alone (the buildings' one shape for them): no view to be culled for
 */
export function cullBatch(mesh: THREE.BatchedMesh, shadowOnly = false) {
  type Inner = {
    _multiDrawStarts: Int32Array;
    _multiDrawCounts: Int32Array;
    _multiDrawCount: number;
    _multiDrawBytesPerElement: number;
    _geometryInfo: { start: number; count: number }[];
    _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
    _indirectTexture: THREE.DataTexture;
  };
  const m = mesh as unknown as Inner, n = m._instanceInfo.length;
  mesh.updateMatrixWorld(true);
  const at = new THREE.Matrix4();
  const balls = m._instanceInfo.map((it, i) => {
    const s = mesh.getBoundingSphereAt(it.geometryIndex, new THREE.Sphere()) ?? new THREE.Sphere(new THREE.Vector3(), Infinity);
    mesh.getMatrixAt(i, at);
    return s.applyMatrix4(at).applyMatrix4(mesh.matrixWorld);
  });
  const which = m._indirectTexture.image.data as unknown as Uint32Array;
  for (let k = 0; k < n; k++) which[k] = k;
  m._indirectTexture.needsUpdate = true;
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4();
  const fill = (camera: THREE.Camera, geometry: THREE.BufferGeometry) => {
    const index = geometry.getIndex(), step = index ? index.array.BYTES_PER_ELEMENT : 1;
    view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(view, camera.coordinateSystem);
    // (development: every copy in every drawing, as before, to measure the difference)
    const all = !!(globalThis as { __batchAll?: boolean }).__batchAll;
    for (let k = 0; k < n; k++) {
      const it = m._instanceInfo[k], g = m._geometryInfo[it.geometryIndex];
      m._multiDrawStarts[k] = g.start * step;
      m._multiDrawCounts[k] = it.visible && it.active && (all || frustum.intersectsSphere(balls[k])) ? g.count : 0;
    }
    m._multiDrawCount = n;
    m._multiDrawBytesPerElement = step;
  };
  // (and a drawing with none of its copies in it is not drawn at all: its one call with every range empty was still a
  // call, the batches' twelve of them in the nearest shadow map every frame, found counting its draws in the game)
  const base = mesh.intersectsFrustum;
  mesh.intersectsFrustum = function (this: THREE.BatchedMesh, f: THREE.Frustum) {
    if (!base.call(this, f)) return false;
    if ((globalThis as { __batchAll?: boolean }).__batchAll) return true;
    for (let k = 0; k < n; k++) {
      const it = m._instanceInfo[k];
      if (it.visible && it.active && f.intersectsSphere(balls[k])) return true;
    }
    return false;
  };
  mesh.onBeforeRender = (_renderer, _scene, camera, geometry) => {
    if (!shadowOnly) fill(camera, geometry);
  };
  mesh.onBeforeShadow = (_renderer, _object, _camera, shadowCamera, geometry) => fill(shadowCamera, geometry);
}
