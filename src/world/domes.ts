// Onion domes on drums, with a cross, for the new towns' churches (2026-10-16): what tells a church of these lands
// from a barn at a kilometre. A part of the building as its walls and roof are (src/world/buildings.ts makes those
// the same way, from numbers), stood on its roof's ridge; nothing reaches it, so nothing of it stops a body.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

/** a dome to be stood: the foot of its drum, how big, whether its onion is gilt (a belfry's) or green iron */
export interface Dome { at: THREE.Vector3; size: number; gilt: boolean }

/**
 * Domes, each a drum, its onion and its cross, all of them in one shape for each paint: three things to draw for a
 * town's every dome. (Each was six of its own: Pokrov's church and towers came to sixty-six, 2026-10-23.)
 */
export function onionDomes(atmo: Atmosphere, list: Dome[]): THREE.Group {
  const p = paints(atmo), g = new THREE.Group(), parts = { white: [] as THREE.BufferGeometry[], green: [] as THREE.BufferGeometry[], gilt: [] as THREE.BufferGeometry[] };
  const put = (geo: THREE.BufferGeometry, paint: keyof typeof parts, at: THREE.Vector3, y: number, turn = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(turn).setPosition(at.x, at.y + y, at.z));
    parts[paint].push(geo);
  };
  for (const { at, size, gilt } of list) {
    put(new THREE.CylinderGeometry(DRUM.r * size, DRUM.r * size * 1.04, DRUM.h * size, 28), 'white', at, (DRUM.h * size) / 2);
    put(new THREE.LatheGeometry(ONION.map(([r, y]) => new THREE.Vector2(r * size, y * size)), 32), gilt ? 'gilt' : 'green', at, DRUM.h * size);
    // (a ring of the drum's cornice under the onion, and the cross on its tip)
    put(new THREE.CylinderGeometry(DRUM.r * size * 1.1, DRUM.r * size * 1.1, 0.22 * size, 28), 'white', at, DRUM.h * size);
    const tip = (DRUM.h + 5.0) * size;
    put(new THREE.BoxGeometry(0.12 * size, 2.0 * size, 0.12 * size), 'gilt', at, tip + 1.0 * size);
    put(new THREE.BoxGeometry(1.0 * size, 0.12 * size, 0.12 * size), 'gilt', at, tip + 1.35 * size);
    put(new THREE.BoxGeometry(0.62 * size, 0.1 * size, 0.1 * size), 'gilt', at, tip + 0.55 * size, -0.35);
  }
  for (const [paint, geos] of Object.entries(parts) as [keyof typeof parts, THREE.BufferGeometry[]][]) {
    if (!geos.length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos, false), p[paint]);
    for (const q of geos) q.dispose();
    m.name = `domes ${paint}`;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
