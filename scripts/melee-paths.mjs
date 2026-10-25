// The hands of a captured blow as its own eyes see them (the owner, 2026-10-25: "Make sure Melle weapons are properly
// rigged and animated"). First person throws the same blow the body throws in third person: each melee movement, as
// scripts/mocap.mjs carried it onto our skeleton (public/assets/characters/melee.glb), is stepped through frame by frame,
// and where each hand, elbow and shoulder is from the eyes, and which way each hand's fingers point and its palm faces,
// is written down. The game fits that into its picture (src/game/melee/fp.ts). The hand is measured as a body measures
// its own (src/game/avatar/make.ts, makeArm: fingers to the middle knuckle, the palm across the knuckles), so a thing
// laid in it by its grip is held the same way in both views.
// It is written as from eyes that keep looking the way the body faced as it began (a player keeps the aim on what they
// hit); how the head itself turns from the body's facing is written too, for the picture to lean with the blow.
//   node scripts/melee-paths.mjs [Clip ...]   -> src/game/melee/paths.json (the named ones, or every movement in the file)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'assets', 'characters', 'melee.glb');
const OUT = path.join(ROOT, 'src', 'game', 'melee', 'paths.json');
const FPS = 30;
/** the eyes from the head's joint, metres: ahead of it and above it */
const EYES = new THREE.Vector3(0, 0.07, 0.1);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const M4 = (a) => new THREE.Matrix4().fromArray(a);

const doc = await io.read(SRC);
const root = doc.getRoot();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const node = (n) => {
  const x = nodes.get(n);
  if (!x) throw new Error(`no ${n} in ${SRC}`);
  return x;
};
const rest = new Map(root.listNodes().map((n) => [n, [n.getTranslation(), n.getRotation(), n.getScale()]]));
const world = (n) => M4(node(n).getWorldMatrix());
const pos = (n) => new THREE.Vector3().setFromMatrixPosition(world(n));
const rot = (n) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(world(n)));

// how the body stands as it was bound: which way it faces (heels to toes), and its hands' fingers and palms in their own frames
const forward = pos('ball_l').add(pos('ball_r')).sub(pos('foot_l')).sub(pos('foot_r')).setY(0).normalize();
const up = new THREE.Vector3(0, 1, 0);
const eyeQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(forward, up), up, forward.clone().negate()));
const eyeInv = eyeQ.clone().invert();
const head0 = rot('Head');
const laid = Object.fromEntries(['r', 'l'].map((s) => {
  const into = rot(`hand_${s}`).invert();
  const fingers = pos(`middle_01_${s}`).sub(pos(`hand_${s}`)).normalize();
  const palm = new THREE.Vector3().crossVectors(fingers, pos(`pinky_01_${s}`).sub(pos(`index_01_${s}`))).normalize();
  if (s === 'l') palm.negate();
  return [s, { fingers: fingers.applyQuaternion(into), palm: palm.applyQuaternion(into) }];
}));

const table = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const wanted = process.argv.slice(2);
for (const anim of root.listAnimations()) {
  const name = anim.getName();
  if (wanted.length && !wanted.includes(name)) continue;
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
  const pose = (time) => {
    for (const [n, [t, r, s]] of rest) n.setTranslation(t).setRotation(r).setScale(s);
    for (const c of ch) {
      const v = at(c, time);
      if (c.path === 'rotation') c.node.setRotation(v);
      else if (c.path === 'translation') c.node.setTranslation(v);
      else c.node.setScale(v);
    }
  };
  const frames = Math.max(1, Math.round(dur * FPS));
  const out = { fps: FPS, dur: r4(dur), rh: [], re: [], rs: [], rf: [], lh: [], le: [], ls: [], lf: [], head: [] };
  for (let f = 0; f <= frames; f++) {
    pose((f / frames) * dur);
    // The eyes, where the head has put them, but looking where the body was facing as it began: a player keeps the
    // aim on what they hit, and the blow comes down across the picture (the head itself looks down with it).
    const turn = rot('Head').multiply(head0.clone().invert());
    const eyeP = pos('Head').add(EYES.clone().applyQuaternion(turn.clone().multiply(eyeQ)));
    const seen = (n) => pos(n).sub(eyeP).applyQuaternion(eyeInv).toArray().map(r4);
    for (const s of ['r', 'l']) {
      out[`${s}h`].push(seen(`hand_${s}`));
      out[`${s}e`].push(seen(`lowerarm_${s}`));
      out[`${s}s`].push(seen(`upperarm_${s}`));
      // (which way the hand's fingers point and its palm faces, from the eyes)
      const q = eyeInv.clone().multiply(rot(`hand_${s}`));
      out[`${s}f`].push([...laid[s].fingers.clone().applyQuaternion(q).toArray(), ...laid[s].palm.clone().applyQuaternion(q).toArray()].map(r4));
    }
    // (the head against the body's facing, as nose up, nose left, roll: radians)
    const e = new THREE.Euler().setFromQuaternion(eyeInv.clone().multiply(turn).multiply(eyeQ), 'YXZ');
    out.head.push([r4(e.x), r4(e.y), r4(e.z)]);
  }
  table[name] = out;
  console.log(`${name.padEnd(28)} ${dur.toFixed(2)} s, ${frames + 1} frames; right hand from the eyes at the start ${out.rh[0].join(', ')}`);
}
writeFileSync(OUT, JSON.stringify(table) + '\n');
console.log('wrote', path.relative(ROOT, OUT));
