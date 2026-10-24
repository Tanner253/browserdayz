// Gaits lent from one animal to another (2026-10-23): the owner's wolf came with no walk, trot or run (standing,
// eating, a snarl, asleep), and onboarding, for the owner: "Lend it the hind's walk, trot and run, mapped joint by
// joint ... match the rests first and correct per joint, with no fixed offsets laid on top." Used by
// scripts/animals.mjs (`borrow` in its settings).
//
// How: both stood as the game has them (turned, scaled). The hind's rest is her standing; the wolf's rest is its
// sleep, so its standing (its own `base` movement, at its start) is what its joints are matched to. Each frame, each
// mapped joint's turn away from the hind's rest, taken in the world, is laid on the wolf's joint as it stands, and
// the wolf's joints are worked down from its hips as turns of their own (a retarget carries each joint's turn from the
// source's rest: memory note hand-animation-lessons). A joint not mapped keeps its standing turn. A `gain` under one
// takes part of the hind's turn only (a dog's neck swings less than a deer's: its head stays low), over one more of it
// (a running wolf bends and stretches its back more than a deer does: onboarding, "the run pose is stiff ... like a
// rocking horse"), the turn's own angle scaled about its own axis; a gain may be said by movement, { walk, trot,
// run }. Its neck is carried lower than in its idle (`lower`: onboarding, "a wolf trots with its head level with or
// below its shoulders"). The hips' bob is scaled to the wolf's legs and softened (`bob`). Its pace is measured afterwards on its own
// feet (animals.mjs).

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';

const FPS = 30;

/** a turn made `k` times as great about its own axis (k < 1 part of it, k > 1 more) */
function scaled(q, k) {
  const w = Math.max(-1, Math.min(1, q.w)), half = Math.acos(w), s = Math.sin(half);
  if (s < 1e-6) return new THREE.Quaternion();
  const axis = new THREE.Vector3(q.x / s, q.y / s, q.z / s);
  return new THREE.Quaternion().setFromAxisAngle(axis, 2 * half * k);
}

/** a channel's value at a moment: linear, the short way round for turns; a step is held */
function sample(c, time) {
  const t = c.getSampler().getInput().getArray(), v = c.getSampler().getOutput().getArray(), path = c.getTargetPath();
  const n = path === 'rotation' ? 4 : 3, cubic = c.getSampler().getInterpolation() === 'CUBICSPLINE', w = cubic ? n * 3 : n, off = cubic ? n : 0;
  let i = t.findIndex((x) => x > time);
  if (i < 0) i = t.length;
  const i0 = Math.max(0, i - 1), i1 = Math.min(t.length - 1, i);
  const k = i1 > i0 && c.getSampler().getInterpolation() !== 'STEP' ? (time - t[i0]) / (t[i1] - t[i0]) : 0;
  const a = Array.from(v.slice(i0 * w + off, i0 * w + off + n)), b = Array.from(v.slice(i1 * w + off, i1 * w + off + n));
  if (n === 3) return a.map((x, j) => x + (b[j] - x) * k);
  return new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), k).toArray();
}

/** a doc's nodes set to a movement at a moment (and a way back to how they were) */
function poser(doc) {
  const keep = new Map(doc.getRoot().listNodes().map((n) => [n, [n.getTranslation(), n.getRotation(), n.getScale()]]));
  return {
    at(anim, time) {
      for (const c of anim?.listChannels() ?? []) {
        const v = sample(c, time), p = c.getTargetPath();
        if (p === 'translation') c.getTargetNode().setTranslation(v);
        else if (p === 'rotation') c.getTargetNode().setRotation(v);
        else if (p === 'scale') c.getTargetNode().setScale(v);
      }
    },
    back() {
      for (const [n, [t, r, s]] of keep) n.setTranslation(t).setRotation(r).setScale(s);
    },
  };
}

const worldOf = (node) => {
  const m = new THREE.Matrix4().fromArray(node.getWorldMatrix()), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q, s };
};

/**
 * Lends `src`'s movements `clips` to `dst` (a doc being made, stood as the game will have it).
 * @param srcFile the lender's own made file (public/assets/models/<id>.glb)
 * @param cfg { clips, base, map: [[src name, dst name, gain?]], hips: [src, dst], bob }
 */
export async function borrow(dst, srcFile, cfg) {
  await MeshoptDecoder.ready;
  const src = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(srcFile);
  const sJoints = src.getRoot().listSkins().flatMap((s) => s.listJoints()), dJoints = [...new Set(dst.getRoot().listSkins().flatMap((s) => s.listJoints()))];
  const find = (list, re, who) => {
    const n = list.find((j) => new RegExp(re).test(j.getName()));
    if (!n) throw new Error(`borrow: no ${who} joint ${re} (it has: ${list.map((j) => j.getName()).join(' ')})`);
    return n;
  };
  const pairs = cfg.map.map(([s, d, gain = 1]) => ({ s: find(sJoints, s, 'lending'), d: find(dJoints, d, 'borrowing'), gain }));
  const sHips = find(sJoints, cfg.hips[0], 'lending'), dHips = find(dJoints, cfg.hips[1], 'borrowing');
  // the lender's rest: as it stands
  const sRest = new Map(pairs.map(({ s }) => [s, worldOf(s).q]));
  const sHipsRest = worldOf(sHips).p, sFeet = Math.min(...sJoints.map((j) => worldOf(j).p.y));
  // the borrower standing: its `base` movement at its start; each joint's turn of its own then, and in the world
  const dPose = poser(dst), base = dst.getRoot().listAnimations().find((a) => a.getName() === cfg.base);
  dPose.at(base, 0);
  // (its standing as the gaits' starting pose, with its neck carried lower first, `lower`: [joint, degrees down], as a
  // dog trots with its head level with its back; its idle is alert, head up. Down is about its own side to side: it
  // faces -z, so about x)
  if (cfg.lower) {
    const [re, deg] = cfg.lower, neck = find(dJoints, re, 'borrowing'), parent = neck.getParentNode();
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-deg * Math.PI) / 180).multiply(worldOf(neck).q);
    neck.setRotation((parent ? worldOf(parent).q.invert() : new THREE.Quaternion()).multiply(want).toArray());
  }
  const dLocal = new Map(dJoints.map((j) => [j, { t: j.getTranslation(), r: new THREE.Quaternion(...j.getRotation()) }]));
  const dWorld = new Map(dJoints.map((j) => [j, worldOf(j).q]));
  const dHipsBase = worldOf(dHips).p, dFeet = Math.min(...dJoints.map((j) => worldOf(j).p.y));
  const hipsParent = dHips.getParentNode() ? worldOf(dHips.getParentNode()) : { q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) };
  dPose.back();
  // (the bob scaled to its legs: hips over feet, the one's against the other's)
  const legs = (dHipsBase.y - dFeet) / Math.max(0.01, sHipsRest.y - sFeet);
  // its joints from the hips out, parents first
  const order = [];
  const walk = (n) => {
    if (dJoints.includes(n)) order.push(n);
    for (const c of n.listChildren()) walk(c);
  };
  for (const j of dJoints) if (!dJoints.includes(j.getParentNode())) walk(j);
  const sPose = poser(src), made = [];
  for (const name of cfg.clips) {
    const anim = src.getRoot().listAnimations().find((a) => a.getName() === name);
    if (!anim) throw new Error(`borrow: the lender has no ${name}`);
    const end = Math.max(...anim.listChannels().map((c) => { const t = c.getSampler().getInput().getArray(); return t[t.length - 1]; }));
    const frames = Math.max(2, Math.round(end * FPS) + 1), times = Float32Array.from({ length: frames }, (_, f) => (f / (frames - 1)) * end);
    const rot = new Map(order.map((j) => [j, new Float32Array(frames * 4)])), hipsAt = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      sPose.at(anim, times[f]);
      const want = new Map();
      for (const { s, d, gain } of pairs) {
        // (its turn away from rest, in the world; the gain's share of it, for this movement)
        const turn = worldOf(s).q.multiply(sRest.get(s).clone().invert()), k = typeof gain === 'number' ? gain : (gain[name] ?? 1);
        want.set(d, scaled(turn.w < 0 ? turn.set(-turn.x, -turn.y, -turn.z, -turn.w) : turn, k).multiply(dWorld.get(d)));
      }
      const sHipsNow = worldOf(sHips).p;
      sPose.back();
      const world = new Map();
      for (const j of order) {
        const parent = j.getParentNode(), pq = world.get(parent) ?? (parent ? worldOf(parent).q : new THREE.Quaternion());
        const local = want.has(j) ? pq.clone().invert().multiply(want.get(j)) : dLocal.get(j).r.clone();
        world.set(j, pq.clone().multiply(local));
        local.toArray(rot.get(j), f * 4);
      }
      // the hips: its standing place, moved as the lender's hips moved (in the world, to its legs, softened), told in its parent's terms
      const d = sHipsNow.clone().sub(sHipsRest).multiplyScalar(legs * cfg.bob);
      d.applyQuaternion(hipsParent.q.clone().invert()).divide(hipsParent.s);
      const t0 = dLocal.get(dHips).t;
      hipsAt.set([t0[0] + d.x, t0[1] + d.y, t0[2] + d.z], f * 3);
    }
    // written as a movement of the borrower's own
    const a = dst.createAnimation(name), buf = dst.getRoot().listBuffers()[0];
    const input = dst.createAccessor().setType('SCALAR').setArray(times).setBuffer(buf);
    for (const j of order) {
      const out = dst.createAccessor().setType('VEC4').setArray(rot.get(j)).setBuffer(buf), smp = dst.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');
      a.addSampler(smp).addChannel(dst.createAnimationChannel().setTargetNode(j).setTargetPath('rotation').setSampler(smp));
    }
    for (const j of order) {
      // (every joint's place as it stands; the hips', moving)
      const arr = j === dHips ? hipsAt : Float32Array.from({ length: frames * 3 }, (_, i) => dLocal.get(j).t[i % 3]);
      const out = dst.createAccessor().setType('VEC3').setArray(arr).setBuffer(buf), smp = dst.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');
      a.addSampler(smp).addChannel(dst.createAnimationChannel().setTargetNode(j).setTargetPath('translation').setSampler(smp));
    }
    made.push(`${name} ${end.toFixed(2)} s`);
  }
  return made;
}
