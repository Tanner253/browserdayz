// The hands of a captured swing as its own eyes see them (the owner, 2026-10-25: "Make sure Melle weapons are properly
// rigged and animated"). First person throws the same blow the body throws in third person: each movement of
// Higgsfield's library, played on a plain copy of our survivor (assets-src/incoming/higgsfield/anim/mocap/<Name>.glb, as
// scripts/mocap.mjs reads them), is stepped through frame by frame, and where each hand and elbow is from the eyes, and
// which way each hand is turned, is written down. The game fits that path into its picture (src/game/melee/fp.ts).
// It is written as from eyes that keep looking the way the body faced as it began (a player keeps the aim on what they
// hit); how the head itself turns from the body's facing is written too, for the picture to lean with the blow.
//   node scripts/melee-paths.mjs Charged_Axe_Chop Heavy_Hammer_Swing ...   -> src/game/melee/paths.json (added to what is there)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = process.env.ZONA_MAIN ?? path.resolve(ROOT, '../../..');
const SRC = [ROOT, MAIN].map((r) => path.join(r, 'assets-src', 'incoming', 'higgsfield', 'anim', 'mocap')).find(existsSync);
const OUT = path.join(ROOT, 'src', 'game', 'melee', 'paths.json');
const FPS = 30;
/** the eyes from the head's joint, metres on a 1.8 m body: ahead of it and above it */
const EYES = new THREE.Vector3(0, 0.07, 0.1);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const M4 = (a) => new THREE.Matrix4().fromArray(a);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

const table = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
for (const name of process.argv.slice(2)) {
  const doc = await io.read(path.join(SRC, `${name}.glb`));
  const nodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
  const need = ['Head', 'Hips', 'RightHand', 'RightForeArm', 'LeftHand', 'LeftForeArm', 'head_end'];
  for (const n of need) if (!nodes.has(n)) throw new Error(`${name}: no ${n}`);
  const anim = doc.getRoot().listAnimations()[0];
  let dur = 0;
  const ch = anim.listChannels().map((c) => {
    const s = c.getSampler(), t = s.getInput().getArray(), v = s.getOutput().getArray();
    dur = Math.max(dur, t[t.length - 1]);
    return { node: c.getTargetNode(), path: c.getTargetPath(), t, v, size: c.getTargetPath() === 'rotation' ? 4 : 3 };
  });
  const at = (c, time) => {
    let k = 0;
    while (k < c.t.length - 2 && c.t[k + 1] <= time) k++;
    const u = THREE.MathUtils.clamp((time - c.t[k]) / Math.max(1e-6, c.t[k + 1] - c.t[k]), 0, 1);
    const a = Array.from(c.v.subarray(k * c.size, (k + 1) * c.size)), b = Array.from(c.v.subarray((k + 1) * c.size, (k + 2) * c.size));
    return c.size === 4 ? new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), u).toArray() : a.map((x, i) => x + (b[i] - x) * u);
  };
  const world = (n) => M4(nodes.get(n).getWorldMatrix());
  const pos = (m) => new THREE.Vector3().setFromMatrixPosition(m);
  const rot = (m) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
  // (the body's height, head top over the floor as it was bound, makes every length one on a 1.8 m body)
  const pose = (time) => {
    for (const c of ch) {
      const v = at(c, time);
      if (c.path === 'rotation') c.node.setRotation(v);
      else if (c.path === 'translation') c.node.setTranslation(v);
      else c.node.setScale(v);
    }
  };
  const k = 1.8 / pos(world('head_end')).y;
  pose(0);
  // Meshy's bodies face +z: the eyes' own right is -x, up +y, behind -z (the game's: x right, y up, z behind)
  const restEye = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)));
  const head0 = rot(world('Head'));
  const frames = Math.max(1, Math.round(dur * FPS));
  const out = { fps: FPS, dur: r4(dur), rh: [], re: [], lh: [], le: [], head: [] };
  for (let f = 0; f <= frames; f++) {
    pose((f / frames) * dur);
    const H = world('Head');
    // The eyes, where the head has put them, but looking where the body was facing as it began: a player keeps the
    // aim on what they hit, and the blow comes down across the picture (the head itself looks down with it).
    const turn = rot(H).multiply(head0.clone().invert());
    const eyeQ = restEye, eyeInv = eyeQ.clone().invert();
    const eyeP = pos(H).multiplyScalar(k).add(EYES.clone().applyQuaternion(turn.clone().multiply(restEye)));
    const seen = (n) => pos(world(n)).multiplyScalar(k).sub(eyeP).applyQuaternion(eyeInv);
    const hand = (n) => [...seen(n).toArray().map(r4), ...eyeInv.clone().multiply(rot(world(n))).toArray().map(r4)];
    out.rh.push(hand('RightHand'));
    out.lh.push(hand('LeftHand'));
    out.re.push(seen('RightForeArm').toArray().map(r4));
    out.le.push(seen('LeftForeArm').toArray().map(r4));
    // (the head against the hips' facing, as nose up, nose left, roll: radians)
    const hipsYaw = new THREE.Euler().setFromQuaternion(rot(world('Hips')), 'YXZ').y;
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hipsYaw, 0)).multiply(turn), 'YXZ');
    out.head.push([r4(e.x), r4(e.y), r4(e.z)]);
  }
  table[name] = out;
  console.log(`${name.padEnd(28)} ${dur.toFixed(2)} s, ${frames + 1} frames; right hand from the eyes at the start ${out.rh[0].slice(0, 3).join(', ')}`);
}
writeFileSync(OUT, JSON.stringify(table) + '\n');
console.log('wrote', path.relative(ROOT, OUT));
