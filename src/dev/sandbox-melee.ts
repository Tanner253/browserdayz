// The sandbox's melee view (2026-10-25, melee path): a survivor holding something to hit with, frozen at moments of
// one of its blows, each moment in its own cell. The body is the game's own (Avatar, as the lineup makes one), the thing
// in its fist the game's own (meleeHeld), and the blow laid on it by the game's own code (src/game/melee/body.ts).
//   &melee=hatchet&n=0                the hatchet's first blow of a run (src/game/melee/cuts.ts)
//   &blow=Right_Hand_Sword_Slash,0.15,0.57,0.95[,tip x,y,z,edge x,y,z]   a blow cut by hand instead: the movement, from,
//                                     hit, to (seconds), and how the thing is held as it lands (see Cut)
//   &strip=8&views=q                  eight moments, from three-quarters (side, front, q, back)
//   &guard=1                          on guard (the right button), held
//   &fp=1                             as its own eyes see it: the arms out of the packs and the thing, placed as the game
//                                     places them (meleeAt), through the hands' own lens (48 degrees)

import * as THREE from 'three';
import { Avatar } from '../game/avatar';
import { lookFor } from '../game/look';
import { meleeAt, meleeHeld } from '../game/weapons';
import { FPArms } from '../game/arms';
import { meleeClips } from '../game/melee/body';
import { cutFor } from '../game/melee/cuts';
import { fpPose, type Cut } from '../game/melee/fp';
import type { Atmosphere } from '../world/atmosphere';
import { ITEMS } from '../sim/items';

/** the world's lighting, as much of it as a body asks for: its own patches, and the hour (always day here) */
const atmo = {
  register(mat: THREE.Material, patch?: (s: THREE.WebGLProgramParametersWithUniforms) => void, key?: string) {
    if (!patch) return mat;
    mat.onBeforeCompile = (s) => {
      s.uniforms.uDaylight = { value: 1 };
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDaylight;');
      patch(s);
    };
    mat.customProgramCacheKey = () => `sandbox|${key ?? ''}`;
    return mat;
  },
} as unknown as Atmosphere;

export async function stageMelee(id: string, s: {
  q: URLSearchParams; scene: THREE.Scene; renderer: THREE.WebGLRenderer; sun: THREE.DirectionalLight;
  cw: number; ch: number; cols: number; rows: number; cells: number; say: (i: number, text: string) => void;
}) {
  const def = ITEMS[id];
  if (!def?.melee) throw new Error(`not something to hit with: ${id}`);
  const by = s.q.get('blow')?.split(',');
  const cut: Cut | null = by ? { clip: by[0], from: +by[1], hit: +by[2], to: +by[3], ...(by.length >= 10 ? { lands: { tip: [+by[4], +by[5], +by[6]] as [number, number, number], edge: [+by[7], +by[8], +by[9]] as [number, number, number] } } : {}) } : cutFor(id, +(s.q.get('n') ?? 0));
  if (!cut) throw new Error(`no captured blow for ${id}`);
  const dur = def.melee.rate * 0.9;
  if (s.q.get('fp') === '1') return firstPerson(id, cut, dur, s);
  await meleeClips();
  const body = new Avatar();
  await body.load(atmo, 0, false, lookFor('sandbox'));
  s.scene.add(body.root);
  const held = await meleeHeld(id);
  body.setHeld(held.root, held.grips, 'melee', true);
  const at = new THREE.Vector3(), still = new THREE.Vector3(), face = 0;
  for (let k = 0; k < 30; k++) body.update(0.05, at, still, face, false, false, false, 0, true, false);
  body.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
    }
  });
  // (&guard=1: on guard, held, from each of the views asked for)
  const guard = s.q.get('guard') === '1';
  if (guard) {
    body.guarding = true;
    for (let k = 0; k < 20; k++) body.update(0.05, at, still, face, false, false, false, 0, true, false);
  }
  const camera = new THREE.PerspectiveCamera(30, s.cw / s.ch, 0.05, 100);
  const view = s.q.get('views')?.split(',')[0] ?? 'q';
  const dir = ({ side: new THREE.Vector3(1, 0.12, 0), front: new THREE.Vector3(0, 0.12, -1), back: new THREE.Vector3(0, 0.25, 1), q: new THREE.Vector3(0.75, 0.3, -0.9) }[view] ?? new THREE.Vector3(0.75, 0.3, -0.9)).normalize();
  const mid = new THREE.Vector3(0, 1.15, 0);
  camera.position.copy(mid).addScaledVector(dir, 4.2);
  camera.lookAt(mid);
  s.sun.target.position.copy(mid);
  s.renderer.setScissorTest(true);
  const moments: number[] = [];
  for (let i = 0; i < s.cells; i++) {
    const u = s.cells === 1 ? 0.35 : i / (s.cells - 1);
    moments.push(u);
    // (the blow begun again and stood at its moment: the body's own update lays it over the rest)
    if (!guard) body.swing(false, dur, cut);
    const now = (body.blow as unknown as { now: { t: number } | null } | null)?.now;
    if (now) now.t = Math.min(u, 0.999) * dur;
    // (off the shoulder at once: in the game it is let down over the first tenth of a second)
    body.shoulderT = 0;
    body.update(0, at, still, face, false, false, false, 0, true, false);
    s.scene.updateMatrixWorld(true);
    const vx = (i % s.cols) * s.cw, vy = (s.rows - 1 - Math.floor(i / s.cols)) * s.ch;
    s.renderer.setViewport(vx, vy, s.cw, s.ch);
    s.renderer.setScissor(vx, vy, s.cw, s.ch);
    s.renderer.render(s.scene, camera);
    s.say(i, `${id} · ${cut.clip} · ${(u * 100).toFixed(0)}%${Math.abs(u - 0.35) < 0.5 / s.cells ? ' (lands)' : ''}`);
  }
  return { id, cut, dur, moments, blow: !!body.blow };
}

type Stage = Parameters<typeof stageMelee>[1];

/** The same blow from the eyes: the view the game draws over the world, here over the sandbox's floor. */
async function firstPerson(id: string, cut: Cut, dur: number, s: Stage) {
  const held = await meleeHeld(id), st = held.melee!;
  const arms = new FPArms();
  await arms.load();
  const camera = new THREE.PerspectiveCamera(48, s.cw / s.ch, 0.01, 100);
  camera.position.set(0, 1.62, 0);
  camera.lookAt(0, 1.55, -5);
  const hands = new THREE.Group();
  camera.add(hands);
  hands.add(arms.root, held.root);
  s.scene.add(camera);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), elbow = new THREE.Vector3();
  const at = fpPose();
  const n = +(s.q.get('n') ?? 0);
  s.renderer.setScissorTest(true);
  const moments: number[] = [];
  for (let i = 0; i < s.cells; i++) {
    const u = s.cells === 1 ? 0.35 : i / (s.cells - 1);
    moments.push(u);
    meleeAt(st, u, n, cut, pos, quat, elbow, at);
    held.root.position.copy(pos);
    held.root.quaternion.copy(quat);
    camera.updateMatrixWorld(true);
    const grips = held.grips;
    if (grips.right && held.body) grips.right.elbow = held.body.worldToLocal(elbow.clone().applyMatrix4(camera.matrixWorld));
    arms.update(held.body ?? null, grips, camera.quaternion, true, true);
    s.scene.updateMatrixWorld(true);
    const vx = (i % s.cols) * s.cw, vy = (s.rows - 1 - Math.floor(i / s.cols)) * s.ch;
    s.renderer.setViewport(vx, vy, s.cw, s.ch);
    s.renderer.setScissor(vx, vy, s.cw, s.ch);
    s.renderer.render(s.scene, camera);
    s.say(i, `${id} · first person · ${cut.clip} · ${(u * 100).toFixed(0)}%${Math.abs(u - 0.35) < 0.5 / s.cells ? ' (lands)' : ''}`);
  }
  return { id, cut, dur, moments, fp: true };
}
