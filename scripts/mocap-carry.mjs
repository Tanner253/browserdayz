// Carrying a movement of Higgsfield's rigging library onto our survivor's skeleton (the owner, 2026-10-25: "i want to
// make use of their body rigging and animations so we can rehaul our body movement"). Each source is a plain copy of
// our survivor that Meshy rigged and played one movement of its library on (`3d_rigging`, one job per movement:
// assets-src/incoming/higgsfield/anim/mocap/<Name>.glb). Its skeleton is 22 bones with no fingers, Mixamo's names
// without the prefix, in centimetres under an Armature of a hundredth. Every bone of ours is turned from where it rests
// by what Meshy's is turned by from where it rests, as scripts/mixamo.mjs does for Mixamo's skeletons; the hips' travel
// is taken out and said, so the game can step each movement at the pace it was captured at. Meshy's hands have no
// fingers: ours are given the old idle's relaxed hand for the length of the movement (a pose of their own: our hand at
// rest is flat), and what is held curls them in the game (memory note hand-animation-lessons).
// Shared by every table of movements (scripts/mocap.mjs the survivors' steps and deeds; melee's and the infected's
// their own): importing this builds nothing.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOf, giveRun } from './mixamo.mjs';
import { skeleton } from './mocap-pose.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = process.env.ZONA_MAIN ?? ROOT;
/** the harvest's folder (in the main checkout's assets-src when run from a worktree: set ZONA_MAIN) */
export const SRC = [path.join(ROOT, 'assets-src', 'incoming', 'higgsfield', 'anim', 'mocap'), path.join(MAIN, 'assets-src', 'incoming', 'higgsfield', 'anim', 'mocap')].find(existsSync);
export const BODY = path.join(ROOT, 'public', 'assets', 'characters', 'survivor.glb');

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
/** glTF read and written with every extension our files use */
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** Meshy's joint -> ours (its spine counts down: Spine02 is the lowest) */
export function meshyBone(name) {
  const m = name.match(/^(Left|Right)?(.+)$/);
  const side = m[1] === 'Left' ? '_l' : m[1] === 'Right' ? '_r' : '';
  const t = { Hips: 'pelvis', Spine02: 'spine_01', Spine01: 'spine_02', Spine: 'spine_03', neck: 'neck_01', Head: 'Head', Shoulder: 'clavicle', Arm: 'upperarm', ForeArm: 'lowerarm', Hand: 'hand', UpLeg: 'thigh', Leg: 'calf', Foot: 'foot', ToeBase: 'ball' }[m[2]];
  return t ? t + side : null;
}

/**
 * A movement done the other way about: each bone takes its twin's turn, seen in a mirror across the body's middle
 * (Meshy's bodies face +z, x across them), and the hips go the other way across.
 */
export function mirrored(run) {
  const name = run.rig.name, twin = name.map((n) => (n ? name.indexOf(n.replace(/_([lr])$/, (_, s) => (s === 'l' ? '_r' : '_l'))) : -1));
  const flip = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
  return {
    ...run,
    turned: run.turned.map((qs) => qs.map((q, i) => flip(twin[i] >= 0 ? qs[twin[i]] : q))),
    moved: run.moved.map((m) => new THREE.Vector3(-m.x, m.y, m.z)),
    travel: new THREE.Vector3(-run.travel.x, run.travel.y, run.travel.z),
  };
}

/**
 * Our survivor's body to carry movements onto (survivor.glb unless another `file` is given): its document, its
 * skeleton (mocap-pose.mjs), how high its hips stand, and the relaxed hand of its old idle.
 */
export async function loadBody(file = BODY) {
  const doc = await io.read(file), root = doc.getRoot();
  // (the relaxed hand: each finger joint as the old idle has it at its start)
  const idle = root.listAnimations().find((a) => a.getName() === 'idle'), hand = [];
  for (const c of idle?.listChannels() ?? []) {
    if (c.getTargetPath() !== 'rotation' || !/^(thumb|index|middle|ring|pinky)_/.test(c.getTargetNode().getName())) continue;
    hand.push([c.getTargetNode(), Array.from(c.getSampler().getOutput().getArray().subarray(0, 4))]);
  }
  return { doc, sk: skeleton(doc), hand, scale: root.listNodes().find((n) => n.getName() === 'pelvis').getWorldMatrix()[13] };
}

/** every finger of `clip` held in the relaxed hand for `dur` seconds (one key at each end) */
function relax(body, clip, dur) {
  const { doc } = body, anim = doc.getRoot().listAnimations().find((a) => a.getName() === clip);
  const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, dur]));
  for (const [node, q] of body.hand) {
    const s = doc.createAnimationSampler().setInput(times).setOutput(doc.createAccessor().setType('VEC4').setArray(new Float32Array([...q, ...q]))).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(s));
  }
}

/**
 * A library movement (`file`, its name in `src`) carried onto `body` as an animation called `clip`. `mirror`: done the
 * other way about; `still`: a loop, its hips' travel taken out (else a movement done once, a fall, that starts where
 * the body stands and goes where it goes). @returns what was read of it: how long, its pace over the ground by the feet
 * and by the hips (m/s), the hips' whole travel (metres: ahead z, left x as the file stands), and what giveRun said
 */
export async function carry(body, file, clip, { mirror = false, still = true, src = SRC } = {}) {
  let run = runOf(await io.read(path.join(src, file + '.glb')), meshyBone, still);
  if (mirror) run = mirrored(run);
  if (!still) {
    const o = run.moved[0].clone();
    for (const m of run.moved) { m.x -= o.x; m.z -= o.z; }
  }
  const said = giveRun(body.doc, run, clip);
  relax(body, clip, run.dur);
  // Its pace on our body, metres a second along the ground. Many of the library's movements are drawn on the spot
  // whatever their name says, so it is read from the feet: whichever foot is down travels back under the body at the
  // pace the body goes over the ground, once the body's own travel is taken out of it (where there is any).
  const k = body.scale / run.hipsHigh, t = run.travel, n = run.frames, going = [];
  for (const foot of ['ball_l', 'ball_r']) {
    const i = run.rig.name.indexOf(foot);
    const at = run.where.map((w, f) => w[i].clone().addScaledVector(t, -f / n));
    const low = Math.min(...at.map((p) => p.y));
    for (let f = 0; f < n; f++) if (at[f].y < low + 0.02 * run.hipsHigh && at[f + 1].y < low + 0.02 * run.hipsHigh) going.push(at[f + 1].clone().sub(at[f]).setY(0).length() / (run.dur / n));
  }
  going.sort((a, b) => a - b);
  const feet = going.length ? going[Math.floor(going.length / 2)] * k : 0;
  const got = { from: file, mirror, dur: +run.dur.toFixed(3), pace: +feet.toFixed(3), hips: +((Math.hypot(t.x, t.z) * k) / run.dur).toFixed(3), along: [+(t.x * k).toFixed(3), +(t.y * k).toFixed(3), +(t.z * k).toFixed(3)], said };
  console.log(`${clip.padEnd(34)} ${said}  feet ${got.pace} m/s, hips ${got.hips} m/s`);
  return got;
}
