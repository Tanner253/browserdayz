// Builds public/assets/characters/emotes.glb: the owner's chosen emotes from the "free fire all emotes fore male" pack
// (assets-src/models/emotes_ff, CC-BY-4.0, endlessinfinitydream on Sketchfab: see CREDITS.md) carried onto the
// player's skeleton, every bone turned from where it rests by what the pack's is turned by from where it rests (as
// scripts/mixamo.mjs does for the Mixamo movements). Nothing but the skeleton and the movements: the game loads it
// apart from survivor.glb, the first time an emote is wanted. The owner, 2026-10-14: "animations need to be rigged to
// the player body".
//   node scripts/emotes.mjs [--only name,name]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { giveRun } from './mixamo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'assets-src', 'models', 'emotes_ff', 'scene.gltf');
const OUT = path.join(ROOT, 'public', 'assets', 'characters', 'emotes.glb');
const FPS = 30;

/** the game's name for each emote, and its name in the pack (the owner's list of 2026-10-14, in their order) */
export const PICKED = {
  balloon: 'Emote_Ballon',
  bhangra: 'Emote_Bhangra',
  wiggle: 'Male_Wiggle_Walk',
  valentine: 'Male_Valentine02',
  sorrow: 'Male_Sorrow',
  shuffle: 'Male_Shuffle',
  shootdance: 'Male_shootdance',
  piratejig: 'Male_PirateJig',
  party: 'Male_PartyDance',
  provoke: 'Male_Provoke',
  loveheart: 'Male_Loveheart',
  lol: 'Male_LOL',
  groove: 'Male_LetsGroove',
  kickmoon: 'Male_Kickthemoon',
  jaguar: 'Male_Jaguar',
  hitdemfolks: 'Male_HitDemFolks',
  whirl: 'Male_HandsWhirlingMagic',
  chair: 'Male_GW02',
  poof: 'Male_Emote_Poof',
  book: 'Male_Emote_Rampage4_Book',
  mj: 'Male_Emote_MJDance',
  max: 'Male_Emote_Max',
  legguitar: 'Male_Emote_LegGuitar',
  poker: 'Male_Emote_Boyband_Poker',
  boybandak: 'Male_Emote_Boyband_AK',
  provocation: 'Male_Emote_Booyahday21_Provocation',
  egypt: 'Male_Egypt',
  dab: 'Male_DAB',
  clap: 'Male_Clap',
};

/** the pack's joint (its biped's name, without the number the file adds) -> the game's */
function ours(name) {
  const m = name.match(/^bone_(Left|Right)?_?(.+?)_\d+$/);
  if (!m) return null;
  const side = m[1] === 'Left' ? '_l' : m[1] === 'Right' ? '_r' : '';
  // (the biped's hips are two: `Hips` that legs and spine hang from, and `Hips_Dummy` beside them that the skin of
  // the hips hangs on. The skin's is the one that is seen. Its upper spine stands just over half way up to the neck:
  // where this skeleton's middle one does.)
  const t = { Hips_Dummy: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Neck: 'neck_01', Head: 'Head', Clav: 'clavicle', Arm: 'upperarm', ForeArm: 'lowerarm', Hand: 'hand', LegUpper: 'thigh', Leg: 'calf', Ankle: 'foot', Toe: 'ball' }[m[2]];
  if (t) return t + side;
  // (two joints to each finger: 0 the thumb, then index, middle, ring and little)
  const f = m[2].match(/^Finger([0-4])([12])$/);
  return f ? `${['thumb', 'index', 'middle', 'ring', 'pinky'][+f[1]]}_0${f[2]}${side}` : null;
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const pack = await io.read(PACK);

// ---------------------------------------------------------------- the pack's skeleton, at rest
// The pack's rest is its bind pose but for a scale of nearly four that its file puts on the bones (its own inverse
// binds are no help: bones with no skin are bound at the origin). So rest is where every bone is "bound".
const skin = pack.getRoot().listSkins()[0];
const joints = skin.listJoints();
const index = new Map(joints.map((j, k) => [j, k]));
const parent = joints.map((j) => (j.getParentNode() && index.has(j.getParentNode()) ? index.get(j.getParentNode()) : -1));
const name = joints.map((j) => ours(j.getName()));
const top = joints.findIndex((_, i) => parent[i] < 0);
const above = new THREE.Matrix4().fromArray(joints[top].getParentNode()?.getWorldMatrix() ?? new THREE.Matrix4().toArray());
const order = joints.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
function depth(i) {
  let d = 0;
  for (let a = parent[i]; a >= 0; a = parent[a]) d++;
  return d;
}
const restT = joints.map((j) => new THREE.Vector3(...j.getTranslation())), restQ = joints.map((j) => new THREE.Quaternion(...j.getRotation())), restS = joints.map((j) => new THREE.Vector3(...j.getScale()));
const pose = (Q, T, S) => {
  const W = new Array(joints.length);
  for (const i of order) W[i] = (parent[i] < 0 ? above.clone() : W[parent[i]].clone()).multiply(new THREE.Matrix4().compose(T[i], Q[i], S[i]));
  return W;
};
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const rot = (m) => {
  const q = new THREE.Quaternion();
  m.decompose(_p, q, _s);
  return q;
};
const still = pose(restQ, restT, restS);
const boundQ = still.map(rot);
const pelvis = name.indexOf('pelvis');
const hipsAt = new THREE.Vector3().setFromMatrixPosition(still[pelvis]);
const rig = { name, at: (n) => new THREE.Vector3().setFromMatrixPosition(still[name.indexOf(n)]) };

/** one of the pack's movements, read as scripts/mixamo.mjs's runOf reads one (what giveRun takes) */
function runOf(anim) {
  const tracks = new Map();
  let dur = 0;
  for (const ch of anim.listChannels()) {
    const i = index.get(ch.getTargetNode());
    if (i === undefined) continue;
    const s = ch.getSampler(), t = s.getInput().getArray(), v = s.getOutput().getArray();
    dur = Math.max(dur, t[t.length - 1]);
    tracks.set(`${i}:${ch.getTargetPath()}`, { t, v, step: s.getInterpolation() === 'STEP' });
  }
  const sample = (tr, time, size) => {
    const { t, v } = tr;
    let k = 0;
    while (k < t.length - 2 && t[k + 1] <= time) k++;
    const u = tr.step ? 0 : THREE.MathUtils.clamp((time - t[k]) / Math.max(1e-6, t[k + 1] - t[k]), 0, 1);
    const a = Array.from(v.subarray(k * size, k * size + size)), b = Array.from(v.subarray(Math.min(k + 1, t.length - 1) * size, Math.min(k + 1, t.length - 1) * size + size));
    return size === 4 ? new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), u) : new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), u);
  };
  const frames = Math.max(1, Math.round(dur * FPS));
  const turned = [], moved = [];
  for (let f = 0; f <= frames; f++) {
    const time = (f / frames) * dur;
    const at = (i, what, rest, size) => (tracks.has(`${i}:${what}`) ? sample(tracks.get(`${i}:${what}`), time, size) : rest);
    const W = pose(restQ.map((q, i) => at(i, 'rotation', q, 4)), restT.map((p, i) => at(i, 'translation', p, 3)), restS.map((s, i) => at(i, 'scale', s, 3)));
    turned.push(W.map((m, i) => rot(m).multiply(boundQ[i].clone().invert())));
    moved.push(new THREE.Vector3().setFromMatrixPosition(W[pelvis]).sub(hipsAt));
  }
  // (an emote is done on the spot: whatever way it drifts over its length is taken out, and it is centred on where it stands)
  const drift = moved[frames].clone().sub(moved[0]);
  moved.forEach((m, f) => m.addScaledVector(drift, -f / frames));
  const mean = moved.reduce((s, m) => s.add(m), new THREE.Vector3()).divideScalar(moved.length);
  for (const m of moved) {
    m.x -= mean.x;
    m.z -= mean.z;
  }
  return { rig, dur, frames, turned, moved, hipsHigh: hipsAt.y };
}

// ---------------------------------------------------------------- onto the player's skeleton
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const doc = await io.read(path.join(ROOT, 'public', 'assets', 'characters', 'survivor.glb'));
const root = doc.getRoot();
for (const a of root.listAnimations()) a.dispose();
const byName = new Map(pack.getRoot().listAnimations().map((a) => [a.getName(), a]));
for (const [game, theirs] of Object.entries(PICKED)) {
  if (only && !only.includes(game)) continue;
  const anim = byName.get(theirs);
  if (!anim) throw new Error(`emotes: the pack has no "${theirs}"`);
  console.log(`${game.padEnd(12)} ${giveRun(doc, runOf(anim), game)}`);
}
// (the skeleton and the movements, and nothing of the body)
for (const n of root.listNodes()) {
  n.setMesh(null);
  n.setSkin(null);
}
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
await doc.transform(prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
doc.createExtension(EXTMeshoptCompression).setRequired(true);
await io.write(OUT, doc);
console.log('wrote', path.relative(ROOT, OUT));
