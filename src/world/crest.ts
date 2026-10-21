// What is set down on the crest the fort stands on that is neither ground, rock nor the fort itself (MOUNTAIN.crest in
// src/world/worldgen.ts). So far one thing: the helicopter that was bringing the garrison its last load, in the hollow
// behind the fort under its two lee towers. It is the model the game lays where a helicopter comes down
// (`layWreck` in src/game/game.ts), laid the same way and solid as the same two boxes; this one has always been there.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { heightAt, type World } from './worldgen';

/** What stops a body of the wreck: its cabin and its tail boom, each a box [half its width, half its height, half its length, how far along the wreck from its middle, how high its middle]. */
export const WRECK_BOXES: [number, number, number, number, number][] = [[1.35, 1.2, 3.2, 1.6, 1.1], [0.5, 0.6, 3.4, -4, 1.0]];

/** Where the wreck lies on the ground it has: how high its middle is, and how far its nose is tipped up. */
export function wreckLie(world: Pick<World, 'heights'>, w: { x: number; z: number; rot: number }): { y: number; nose: number } {
  const ax = Math.sin(w.rot), az = Math.cos(w.rot), H = world.heights;
  const nose = heightAt(H, w.x + ax * 5, w.z + az * 5), tail = heightAt(H, w.x - ax * 5, w.z - az * 5);
  // (laid to the ground along its length, and let a hand's depth into it: it came down hard)
  return { y: (heightAt(H, w.x, w.z) + nose + tail) / 3 - 0.12, nose: Math.atan2(nose - tail, 10) };
}

/**
 * The wreck stood in the world: drawn when its model has come, solid at once. Its model is sent for when the game is
 * up and not at the loading screen (1.4 MB that everybody waited for, of a thing in a hollow on a mountain where
 * nobody starts: found by an independent reading, 2026-10-13). Got ready to be drawn before it is put in (Renderer.ready):
 * its shaders made in the frame it was first in sight were 720 ms of nothing moving, flying over the fort (2026-10-15).
 */
export function buildWreck(world: World, scene: THREE.Object3D, ready?: (o: THREE.Object3D) => Promise<void>): void {
  const w = world.wreck;
  if (!w) return;
  const { y, nose } = wreckLie(world, w), ax = Math.sin(w.rot), az = Math.cos(w.rot);
  assets.later(() => void assets.model('heli_wreck').then(async (got) => {
    const model = got.clone();
    model.position.set(w.x, y, w.z);
    model.rotation.set(-nose, w.rot, 0, 'YXZ');
    model.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      // (it is painted burnt black all over: lifted, so that it is a wreck and not a hole in the picture; and further
      // than one in a meadow is, since this one lies in the shade of two cliffs)
      const paint = (m.material as THREE.MeshStandardMaterial).clone();
      paint.color.multiplyScalar(4);
      m.material = paint;
    });
    model.name = 'crest:wreck';
    await ready?.(model).catch(() => {});
    scene.add(model);
  }, (e) => console.warn('the wreck on the crest', e)));
  if (!physics.world) return; // planning only: no collision world
  for (const [hx, hy, hz, along, up] of WRECK_BOXES) physics.addStatic(physics.R.ColliderDesc.cuboid(hx, hy, hz), 'metal', { x: w.x + ax * along, y: y + up, z: w.z + az * along }, w.rot);
}
