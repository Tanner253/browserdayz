// The few meshes that have no scanned model: small machined parts built from a lathe
// profile, with a parkerised-steel material, and the stamped dog tag.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

let tagSteel: THREE.MeshStandardMaterial | null = null;
let keycardMat: THREE.MeshStandardMaterial[] | undefined;

/** Two stamped plates fanned on a ball chain, lying flat. */
export function dogTagGeometry(): THREE.BufferGeometry {
  const L = 0.05, W = 0.029, R = 0.009, T = 0.0012;
  const plate = new THREE.Shape();
  plate.moveTo(-L / 2 + R, -W / 2);
  plate.lineTo(L / 2 - R, -W / 2);
  plate.absarc(L / 2 - R, -W / 2 + R, R, -Math.PI / 2, 0, false);
  plate.lineTo(L / 2, W / 2 - R);
  plate.absarc(L / 2 - R, W / 2 - R, R, 0, Math.PI / 2, false);
  plate.lineTo(-L / 2 + R, W / 2);
  plate.absarc(-L / 2 + R, W / 2 - R, R, Math.PI / 2, Math.PI, false);
  plate.lineTo(-L / 2, -W / 2 + R);
  plate.absarc(-L / 2 + R, -W / 2 + R, R, Math.PI, Math.PI * 1.5, false);
  // the hole the chain runs through
  const hx = -L / 2 + 0.006;
  const hole = new THREE.Path();
  hole.absarc(hx, 0, 0.0022, 0, Math.PI * 2, true);
  plate.holes.push(hole);
  const flat = () => new THREE.ExtrudeGeometry(plate, { depth: T, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
  // the second plate swings out around the hole and rests on the first
  const lower = flat();
  const upper = flat().translate(-hx, T * 1.15, 0).rotateY(0.5).translate(hx, 0, 0);
  const chain = new THREE.TorusGeometry(0.016, 0.0009, 5, 30).rotateX(Math.PI / 2).translate(hx - 0.016, T * 1.2, 0).toNonIndexed();
  const g = mergeGeometries([lower, upper, chain], false)!;
  g.computeVertexNormals();
  return g;
}

export function proceduralParts(model: string): MeshPart[] {
  if (model === '@dogtag') {
    tagSteel ??= new THREE.MeshStandardMaterial({ color: 0xd2d0c8, metalness: 0.75, roughness: 0.48, name: 'tag-steel' });
    return [{ name: 'dogtag', geometry: dogTagGeometry(), material: tagSteel }];
  }
  if (model === '@suppressor') return [{ name: 'suppressor', geometry: suppressorGeometry(), material: gunSteel() }];
  if (model === '@keycard') {
    // a pass card: red plastic with a white band across it
    keycardMat ??= [new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, name: 'card-red' }), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.5, name: 'card-band' })];
    const card = new THREE.BoxGeometry(0.086, 0.003, 0.054), band = new THREE.BoxGeometry(0.0865, 0.0034, 0.014);
    band.translate(0, 0, -0.012);
    return [{ name: 'keycard', geometry: card, material: keycardMat[0] }, { name: 'keycard_band', geometry: band, material: keycardMat[1] }];
  }
  throw new Error(`unknown procedural model ${model}`);
}
