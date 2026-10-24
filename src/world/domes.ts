// Onion domes on drums, with a cross, for the new towns' churches (2026-10-16): what tells a church of these lands
// from a barn at a kilometre. A part of the building as its walls and roof are (src/world/buildings.ts makes those
// the same way, from numbers), stood on its roof's ridge; nothing reaches it, so nothing of it stops a body.

import * as THREE from 'three';
import type { Atmosphere } from './atmosphere';

/** the onion's outline, metres at size 1: [radius, height] from where it sits on the drum to its tip */
const ONION: [number, number][] = [
  [2.3, 0], [2.55, 0.35], [2.8, 0.95], [2.85, 1.45], [2.6, 2.1], [2.0, 2.75], [1.25, 3.35], [0.62, 3.9], [0.3, 4.35], [0.16, 4.8], [0, 5.0],
];
const DRUM = { r: 2.2, h: 3.2 };

let made: { white: THREE.Material; green: THREE.Material; gilt: THREE.Material } | null = null;
function paints(atmo: Atmosphere) {
  if (made) return made;
  const white = new THREE.MeshStandardMaterial({ color: 0xe7e2d2, roughness: 0.92 });
  const green = new THREE.MeshStandardMaterial({ color: 0x3f6b58, roughness: 0.48, metalness: 0.55 });
  // (gold that shows as gold under any sky: wholly metal, it was black wherever the sky it gave back was dull)
  const gilt = new THREE.MeshStandardMaterial({ color: 0xd9ac4e, roughness: 0.38, metalness: 0.45 });
  for (const m of [white, green, gilt]) atmo.register(m);
  return (made = { white, green, gilt });
}

/** A drum, its onion and its cross, its foot at `at`. @param gilt a gilt onion (a belfry's), else green iron */
export function onionDome(atmo: Atmosphere, at: THREE.Vector3, size: number, gilt: boolean): THREE.Group {
  const p = paints(atmo), g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.r * size, DRUM.r * size * 1.04, DRUM.h * size, 28), p.white);
  drum.position.y = (DRUM.h * size) / 2;
  const onion = new THREE.Mesh(new THREE.LatheGeometry(ONION.map(([r, y]) => new THREE.Vector2(r * size, y * size)), 32), gilt ? p.gilt : p.green);
  onion.position.y = DRUM.h * size;
  // (a ring of the drum's cornice under the onion, and the cross on its tip)
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.r * size * 1.1, DRUM.r * size * 1.1, 0.22 * size, 28), p.white);
  ring.position.y = DRUM.h * size;
  const tip = (DRUM.h + 5.0) * size, post = new THREE.Mesh(new THREE.BoxGeometry(0.12 * size, 2.0 * size, 0.12 * size), p.gilt);
  post.position.y = tip + 1.0 * size;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0 * size, 0.12 * size, 0.12 * size), p.gilt);
  bar.position.y = tip + 1.35 * size;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.62 * size, 0.1 * size, 0.1 * size), p.gilt);
  foot.position.y = tip + 0.55 * size;
  foot.rotation.z = -0.35;
  for (const m of [drum, onion, ring, post, bar, foot]) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  g.position.copy(at);
  return g;
}
