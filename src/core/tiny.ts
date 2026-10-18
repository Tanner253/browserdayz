import * as THREE from 'three';

/**
 * What would cover less than a couple of pixels is not drawn, nor drawn into the sun's shadows (2026-10-18). From the
 * helicopter every door, well, lamp and thing lying about in a town below was a draw of its own, and a draw costs the
 * processor the same whether it makes two pixels or two thousand: the frame was the processor's, not the card's, 9 to
 * 12 ms of it handing the world over (the owner: "the goal is 100+ avg fps", "the less we can give up visually
 * obviously the better"). A thing that small is a speck that flickers as it is: what is lost is that.
 *
 * Asked of every mesh, line and cloud of points by three.js before it is drawn (its own `intersectsFrustum`), and only
 * while the world is drawn by a camera with depth to it: not the gun in the hands, nor the passes over the picture.
 */
/** a thing's radius as it is seen, pixels, below which it is not drawn; and below which it casts no shadow (its shadow would be a smudge of a few pixels) */
const LEAST = 1, LEAST_SHADOW = 2;
const view = { on: false, eye: new THREE.Vector3(), k: 0 };
const c = new THREE.Vector3();

/** @param shadow whether a frustum is one of the sun's shadow maps */
export function installTiny(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadow: (f: THREE.Frustum) => boolean) {
  const size = new THREE.Vector2();
  const render = renderer.render.bind(renderer);
  renderer.render = (s: THREE.Object3D, cam: THREE.Camera) => {
    const p = cam as THREE.PerspectiveCamera;
    view.on = s === scene && !!p.isPerspectiveCamera && !(import.meta.env.DEV && (globalThis as { __noTiny?: boolean }).__noTiny);
    if (view.on) {
      view.eye.setFromMatrixPosition(p.matrixWorld);
      // (pixels across half the height of the picture, over the tangent of half the view: a radius at a distance, as seen)
      view.k = renderer.getDrawingBufferSize(size).y / 2 / Math.tan(THREE.MathUtils.degToRad(p.getEffectiveFOV()) / 2);
    }
    try {
      render(s, cam);
    } finally {
      view.on = false;
    }
  };
  for (const proto of [THREE.Mesh.prototype, THREE.Line.prototype, THREE.Points.prototype]) {
    const was = proto.intersectsFrustum;
    proto.intersectsFrustum = function (this: THREE.Mesh, frustum: THREE.Frustum) {
      if (view.on) {
        const own = (this as unknown as { boundingSphere?: THREE.Sphere | null }).boundingSphere;
        let s: THREE.Sphere | null;
        if (own !== undefined) {
          if (own === null) (this as unknown as THREE.InstancedMesh).computeBoundingSphere();
          s = (this as unknown as { boundingSphere: THREE.Sphere }).boundingSphere;
        } else {
          if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere();
          s = this.geometry.boundingSphere;
        }
        if (s && s.radius > 0) {
          const e = this.matrixWorld.elements;
          c.copy(s.center).applyMatrix4(this.matrixWorld);
          const r = s.radius * Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
          const d = c.distanceTo(view.eye);
          if (d > r && (r * view.k) / d < (shadow(frustum) && !(import.meta.env.DEV && (globalThis as { __shadowSpeck?: boolean }).__shadowSpeck) ? LEAST_SHADOW : LEAST)) return false;
        }
      }
      return was.call(this, frustum);
    };
  }
}
