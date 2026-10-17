// THE GROUND'S LARGE NOISE: a tileable picture of slow noise (three of its places fbm at three sizes, the fourth a
// smoother noise that deals out the ground pictures' copies), read by the terrain, the grass and whatever lays the
// canyon's beds on its own rock (src/world/canyon-beds.ts). Made once and shared: the same numbers on every reader.

import * as THREE from 'three';
import { Simplex } from '../core/noise';

let made: THREE.DataTexture | null = null;
/** the one copy */
export const macroTexture = () => (made ??= macroNoiseTexture());

function macroNoiseTexture(): THREE.DataTexture {
  const S = 256;
  const n = new Simplex(4242), patch = new Simplex(9117);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // tileable via 4D-ish torus mapping in 2D simplex
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      const nx = Math.cos(a) * 2, ny = Math.sin(a) * 2, nz = Math.cos(b) * 2, nw = Math.sin(b) * 2;
      const v1 = n.fbm(nx + nz * 0.7, ny + nw * 0.7, 4);
      const v2 = n.fbm(nx * 3 + 11 + nw, ny * 3 - 7 + nz, 4);
      const v3 = n.fbm(nz * 5 - 3 + nx, nw * 5 + 9 + ny, 3);
      const i = (y * S + x) * 4;
      data[i] = Math.round((v1 * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((v2 * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((v3 * 0.5 + 0.5) * 255);
      // In the fourth place, a pattern of another kind: slow and smooth, of one size. It is what deals out a ground
      // picture's shifted copies (see groundTap), and the patches it marks out must be about a picture wide and not
      // a speckle. (Nothing else reads this place.)
      const pu = Math.cos(a) * 1.7 + Math.cos(b) * 1.2, pv = Math.sin(a) * 1.7 + Math.sin(b) * 1.2;
      const deal = (patch.noise(pu, pv) + 0.35 * patch.noise(pu * 2.1 + 5.3, pv * 2.1 - 3.1)) / 1.35;
      data[i + 3] = Math.round(Math.min(1, Math.max(0, deal * 0.5 + 0.5)) * 255);
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
