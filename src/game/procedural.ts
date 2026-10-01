// The few meshes that have no scanned model: small machined parts built from a lathe
// profile, with a parkerised-steel material.

import * as THREE from 'three';
import type { MeshPart } from '../core/gltf-utils';

let steel: THREE.MeshStandardMaterial | null = null;
function gunSteel() {
  if (!steel) {
    // faint machining rings + wear so it doesn't read as flat black plastic
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y++) {
      const v = 120 + Math.sin(y * 1.9) * 9 + (Math.random() - 0.5) * 26;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, 64, 1);
    }
    const rough = new THREE.CanvasTexture(c);
    rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
    steel = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.85, roughness: 0.62, roughnessMap: rough, name: 'gun-steel' });
  }
  return steel;
}

/** 9 mm suppressor: knurled rear collar, long body, stepped muzzle cap. Lies along +X, rear face at the origin. */
export function suppressorGeometry(): THREE.BufferGeometry {
  const R = 0.0165, L = 0.135;
  const pts: [number, number][] = [
    [0, 0], [0.0095, 0], [0.0095, 0.004], [R * 0.82, 0.006], [R * 0.82, 0.02], [R, 0.023],
    [R, L - 0.012], [R * 0.9, L - 0.009], [R * 0.9, L - 0.002], [R * 0.72, L], [0.0055, L], [0.0055, L - 0.006], [0, L - 0.006],
  ];
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  // lathe spins about Y: lay it along +X
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function proceduralParts(model: string): MeshPart[] {
  if (model === '@suppressor') return [{ name: 'suppressor', geometry: suppressorGeometry(), material: gunSteel() }];
  throw new Error(`unknown procedural model ${model}`);
}
