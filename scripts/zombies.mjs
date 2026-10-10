// Builds the infected: public/assets/characters/zombie_{cop,male,female,hazmat}.glb
//
//   node scripts/build-character.mjs --infected     (once: the game's skeleton and movements, on the plain body)
//   node scripts/zombies.mjs
//
// Three downloads, unpacked into assets-src/models/ (gitignored), all CC BY 4.0 (CREDITS.md):
//   zombie_cop     "Animated Zombie Cop Running Loop" by LasquetiSpice: on a Mixamo skeleton,
//                  with two seconds of running
//   zombie_male    "Zombie (Male 1)" by LokitoBlu: a statue, arms out, on no skeleton at all
//   zombie_female  "Zombie (Female 1)" by LokitoBlu: the same
//   zombie_idle    "toxic Zombie 3 Idle (animated)" by vicente betoret ferrero: a body in an
//                  orange suit and a mask, on a Mixamo skeleton of its own (no fingers), with
//                  seven seconds of standing. Its standing is what all of them stand with, and
//                  its body is the fourth of them (`hazmat`): the ones of the gas and the bunker.
//
// The game has one skeleton and every movement it has is drawn for that. So:
//
//   1. The statues are given the cop's skeleton. Each is stood where the cop stands (the same
//      height, the same reach, crotch and shoulders at the same levels) and every point of it
//      takes the bones of the nearest point of the cop. They are the same kind of body in the
//      same pose, and what a point of a forearm hangs on is what a forearm hangs on.
//   2. All three are then carried from that skeleton to the game's, exactly as the tactical
//      suit is (scripts/suit.mjs).
//   3. The cop's running is brought across too, and is what they run with: each bone is
//      turned from how it stands at rest by what the cop's bone is turned by from how that
//      stands at rest. (Both rest arms-out, facing the same way.) Everything else they do is
//      the game's own movement, bent by the game (Avatar.sicken).

import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, mergeDocuments, unpartition, textureCompress, meshopt, metalRough, weld, simplify } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { wearSuit, fitSkeleton, ours } from './suit.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src', 'models');
const TEMPLATE = path.join(ROOT, 'assets-src', 'characters', 'plain.glb');
const OUT = path.join(ROOT, 'public', 'assets', 'characters');
/** the most a colour or normal map is across (they are kept as they came: the bodies' are this, the clothes' half of it) and a roughness map */
const TEX = 2048;
const TEX_ROUGH = 1024;
const FPS = 30;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const M4 = (a) => new THREE.Matrix4().fromArray(a);
const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

/** which of each one's shapes make which shape of the body in the game (see PIECES in suit.mjs): the first is `body`, where wounds are painted */
const ZOMBIES = [
  { id: 'cop', dir: 'zombie_cop', pieces: { body: [[/^FuzZombie_body/, null], [/^Eyes_body/, null]], hair: [[/^Hair_glass_hair/, null]], glass: [[/^Glass_glass_hair/, null]] } },
  { id: 'male', dir: 'zombie_male', statue: true, pieces: { body: [[/^z_Body$/, null]], bottom: [[/^z_Bottom$/, null]], hair: [[/^z_Hair$/, null]], rest: [[/^z_material$/, null]] } },
  { id: 'female', dir: 'zombie_female', statue: true, pieces: { body: [[/^z_Body$/, null]], bottom: [[/^z_Bottom$/, null]], hair: [[/^z_Hair$/, null]], rest: [[/^z_material$/, null]] } },
  // (on its own skeleton, not the cop's: `own` is how its bones are named)
  // (It came with fifty thousand triangles, three times what any of the others has, and there are twenty of them
  // about the bunker: it is brought down to `keep` of that, which at the distance they are seen from changes nothing.)
  { id: 'hazmat', dir: 'zombie_idle', own: 'mixamorig:', keep: 0.36, pieces: { body: [[/^model_default/, null]] } },
];
/** only these, if any are named on the command line (`node scripts/zombies.mjs hazmat`) */
const ONLY = process.argv.slice(2);

const readCop = async () => {
  const cop = await io.read(path.join(SRC, 'zombie_cop', 'scene.gltf'));
  // (its materials are written the old way, shine and gloss: three.js no longer reads that)
  await cop.transform(metalRough());
  return cop;
};

// ---------------------------------------------------------------- the cop's skeleton, as it was bound

function rigOf(doc, prefix = '') {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const bind = joints.map((_, k) => M4(ibm.getElement(k, [])).invert());
  const index = new Map(joints.map((j, k) => [j, k]));
  const parent = joints.map((j) => {
    for (let n = j.getParentNode(); n; n = n.getParentNode()) if (index.has(n)) return index.get(n);
    return -1;
  });
  const name = joints.map((j) => ours(j.getName(), prefix));
  const at = (n) => new THREE.Vector3().setFromMatrixPosition(bind[name.indexOf(n)]);
  return { skin, joints, bind, index, parent, name, at };
}

/** every point of a document's skinned shapes, where it was bound, with the bones it hangs on */
function boundPoints(doc) {
  const out = [];
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getMesh() || !n.getSkin()) continue;
    for (const prim of n.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0');
      for (let i = 0; i < pos.getCount(); i++) out.push({ p: new THREE.Vector3().fromArray(pos.getElement(i, [])), j: ji.getElement(i, []), w: jw.getElement(i, []) });
    }
  }
  return out;
}

/** the places on a body standing arms-out that mean the same on any such body (y up, x along the arms) */
function landmarks(points) {
  let top = -Infinity, floor = Infinity, tip = 0;
  for (const p of points) {
    top = Math.max(top, p.y);
    floor = Math.min(floor, p.y);
    tip = Math.max(tip, Math.abs(p.x));
  }
  const tall = top - floor;
  let crotch = Infinity, armY = 0, arms = 0, chestZ = 0, chest = 0;
  for (const p of points) {
    const h = (p.y - floor) / tall, ax = Math.abs(p.x);
    // the lowest of it that is on the middle line and above the knees: between the legs
    if (ax < tall * 0.012 && h > 0.3 && h < 0.62) crotch = Math.min(crotch, p.y);
    if (ax > tip * 0.6) {
      armY += p.y;
      arms++;
    }
    if (ax < tall * 0.08 && h > 0.6 && h < 0.8) {
      chestZ += p.z;
      chest++;
    }
  }
  return { top, floor, tip, crotch, armY: armY / arms, chestZ: chestZ / chest };
}

// ---------------------------------------------------------------- a statue's hands

const centre = (pts) => pts.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(pts.length);
/** how far a point is from a line drawn through `corners`, one after the other */
function fromLine(p, corners) {
  let best = Infinity;
  for (let i = 1; i < corners.length; i++) {
    const ab = corners[i].clone().sub(corners[i - 1]);
    const t = THREE.MathUtils.clamp(p.clone().sub(corners[i - 1]).dot(ab) / Math.max(1e-12, ab.lengthSq()), 0, 1);
    best = Math.min(best, corners[i - 1].clone().addScaledVector(ab, t).distanceTo(p));
  }
  return best;
}
/** where along a finger its joints are, from where the hand divides (0) to its tip (1): the knuckle is back inside the hand */
const KNUCKLE = -0.25, MIDDLE = 0.31, LAST = 0.65;
/** and a thumb's, from where it leaves the palm */
const T_KNUCKLE = -0.15, T_LAST = 0.45;

/** a shape's points, one for all that are at one place (it is cut along the seams of its picture), and which are joined to which */
function welded(shape, u) {
  const first = new Map(), one = new Int32Array(shape.P.length);
  shape.P.forEach((p, i) => {
    const k = `${Math.round((p.x / u) * 400)},${Math.round((p.y / u) * 400)},${Math.round((p.z / u) * 400)}`;
    if (!first.has(k)) first.set(k, i);
    one[i] = first.get(k);
  });
  const next = new Map();
  const link = (a, b) => {
    if (a === b) return;
    if (!next.has(a)) next.set(a, new Set());
    next.get(a).add(b);
  };
  for (let i = 0; i < shape.I.length; i += 3) {
    const t = [one[shape.I[i]], one[shape.I[i + 1]], one[shape.I[i + 2]]];
    for (let e = 0; e < 3; e++) {
      link(t[e], t[(e + 1) % 3]);
      link(t[(e + 1) % 3], t[e]);
    }
  }
  return { one, next, all: [...new Set(one)] };
}

/**
 * The end of one arm, and its four fingers: going out along the hand, the first place where
 * what lies beyond is four long pieces.
 * @param sg   +1 for the left arm (at +x), -1 for the right
 * @param from how far out the end of the arm is taken to begin
 */
function fingersOf(P, mesh, sg, from) {
  const X = (p) => sg * p.x;
  const ids = mesh.all.filter((i) => X(P[i]) > from);
  const mine = new Set(ids);
  const tipX = ids.reduce((m, i) => Math.max(m, X(P[i])), -Infinity);
  /** the pieces that what passes `keep` falls into; or the one that `start` is of */
  const pieces = (keep, start) => {
    const seen = new Set(), out = [];
    for (const i of start !== undefined ? [start] : ids) {
      if (seen.has(i) || !keep(i)) continue;
      const piece = [i];
      seen.add(i);
      for (let h = 0; h < piece.length; h++) {
        for (const j of mesh.next.get(piece[h]) ?? []) {
          if (seen.has(j) || !mine.has(j) || !keep(j)) continue;
          seen.add(j);
          piece.push(j);
        }
      }
      out.push(piece);
    }
    return out;
  };
  for (let k = 0; k <= 90; k++) {
    const web = from + (tipX - from) * (0.4 + (0.5 * k) / 90);
    const long = pieces((i) => X(P[i]) > web).filter((c) => {
      const lo = c.reduce((m, i) => Math.min(m, X(P[i])), Infinity), hi = c.reduce((m, i) => Math.max(m, X(P[i])), -Infinity);
      return c.length >= 8 && lo < web + (tipX - web) * 0.2 && hi > web + (tipX - web) * 0.5;
    });
    if (long.length >= 4) return { X, ids, mine, pieces, tipX, web, fingers: long.sort((a, b) => b.length - a.length).slice(0, 4) };
  }
  throw new Error(`zombies: no four fingers to be found on the ${sg > 0 ? 'left' : 'right'} hand`);
}

/**
 * How far out along each arm a statue's wrist is: where, going out, the arm stops being as
 * wide as a forearm and starts being as wide as a hand. (Cut through the edges of its
 * triangles, not picked from among its points: an arm has few points along it.)
 * @returns for +1 (the left) and -1, the distance out from the middle
 */
function wristsOf(shapes, rig, u) {
  const body = shapes.find((s) => s.name === 'Body'), P = body.P;
  const mesh = welded(body, u);
  const out = {};
  for (const sg of [1, -1]) {
    const h = fingersOf(P, mesh, sg, Math.abs(rig.at(sg > 0 ? 'lowerarm_l' : 'lowerarm_r').x));
    const edges = [];
    for (const a of h.ids) for (const b of mesh.next.get(a) ?? []) if (a < b && h.mine.has(b)) edges.push([P[a], P[b]]);
    const wide = (x) => {
      let lo = Infinity, hi = -Infinity;
      for (const [a, b] of edges) {
        const xa = h.X(a), xb = h.X(b);
        if (xa === xb || (xa - x) * (xb - x) > 0) continue;
        const z = a.z + ((b.z - a.z) * (x - xa)) / (xb - xa);
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      }
      return hi - lo;
    };
    const finger = h.tipX - h.web;
    const over = (a, b) => {
      const l = [];
      for (let x = h.web - a * finger; x <= h.web - b * finger; x += 0.1 * u) l.push(wide(x));
      return l.filter((v) => v > 0);
    };
    const forearm = over(2.6, 1.7).sort((a, b) => a - b), palm = Math.max(...over(1.3, 0.3));
    const mark = forearm[Math.floor(forearm.length / 2)] + (palm - forearm[Math.floor(forearm.length / 2)]) * 0.25;
    let x = h.web - 2.0 * finger;
    while (x < h.web - 0.6 * finger && wide(x) <= mark) x += 0.1 * u;
    // (the joint is a little before where the hand has begun to spread)
    out[sg] = x - 0.5 * u;
  }
  return out;
}

/**
 * A statue's fingers, found for what they are and given the cop's finger bones.
 *
 * The nearest point of the cop is no guide to a hand. The cop's fingers were bound curled
 * into claws and a statue's are held straight: a straight finger took the bones of curled
 * ones, and when those were straightened out it bent back over the hand. So each finger is
 * found (past where the hand divides each is a piece of its own; the thumb is what is thin
 * behind the foremost point of the rest), its joints are put along it where a finger's joints
 * are, and every point of the hand hangs on the bones it is beside. Then the bones are said
 * to have been bound THERE (their places in the cop's skin are moved): wearSuit lays the
 * game's fingers along them as it does any limb, whichever way they point.
 *
 * @param shapes with what the nearest points of the cop said each point hangs on (`W`), which is put right from the wrist out
 * @param u      a centimetre, in the cop's units
 */
function fitHands(shapes, rig, u) {
  const body = shapes.find((s) => s.name === 'Body');
  const P = body.P;
  const mesh = welded(body, u);
  const ibm = rig.skin.getInverseBindMatrices();
  const put = (name, at) => {
    const k = rig.name.indexOf(name);
    if (k < 0) return;
    rig.bind[k] = rig.bind[k].clone().setPosition(at);
    ibm.setElement(k, rig.bind[k].clone().invert().elements);
  };
  const told = [];
  for (const [side, sg] of [['_l', 1], ['_r', -1]]) {
    const J = (n) => rig.name.indexOf(n + side);
    const wrist = rig.at(`hand${side}`).clone();
    const { X, ids, pieces, tipX, web, fingers } = fingersOf(P, mesh, sg, sg * wrist.x - 2 * u);
    const Xw = X(wrist);
    const digits = fingers
      .map((c) => {
        const pts = c.map((i) => P[i]);
        const low = pts.reduce((m, p) => Math.min(m, X(p)), Infinity);
        const base = centre(pts.filter((p) => X(p) < low + (tipX - web) * 0.1));
        const far = pts.reduce((m, p) => (p.distanceToSquared(base) > m.distanceToSquared(base) ? p : m));
        const a = far.clone().sub(base).normalize();
        const s = (p) => p.clone().sub(base).dot(a);
        const L = pts.reduce((m, p) => Math.max(m, s(p)), 0);
        const off = (p) => p.clone().sub(base).addScaledVector(a, -s(p)).length();
        // (a joint is in the middle of the finger, wherever the finger has got to by there)
        const on = (t) => {
          const near = pts.filter((p) => Math.abs(s(p) - t * L) < L * 0.08);
          return near.length >= 4 ? centre(near) : base.clone().addScaledVector(a, t * L);
        };
        return { ids: new Set(c), base, a, L, s, off, joints: [base.clone().addScaledVector(a, KNUCKLE * L), on(MIDDLE), on(LAST), base.clone().addScaledVector(a, L)] };
      })
      // (the first finger is the one beside the thumb, and the thumb is in front)
      .sort((p, q) => q.base.z - p.base.z);
    digits.forEach((f, n) => (f.name = ['index', 'middle', 'ring', 'pinky'][n]));
    for (const f of digits) if (f.L * (1 - KNUCKLE) < 4.5 * u || f.L * (1 - KNUCKLE) > 13 * u) throw new Error(`zombies: hand${side}: a finger ${((f.L * (1 - KNUCKLE)) / u).toFixed(1)} cm long`);

    // ---- the thumb: the foremost point of the rest of the hand is its tip; back from there for as long as it is one thin thing
    const taken = new Set(fingers.flat());
    const tip = ids.filter((i) => !taken.has(i) && X(P[i]) > Xw).reduce((m, i) => (P[i].z > P[m].z ? i : m));
    let dir = rig.at(`thumb_03${side}`).clone().sub(rig.at(`thumb_02${side}`)).normalize();
    let thumb = null;
    for (let pass = 0; pass < 3; pass++) {
      const back = (i) => P[tip].clone().sub(P[i]).dot(dir);
      const upTo = (b) => pieces((i) => !taken.has(i) && back(i) < b, tip)[0];
      const round = [];
      let b = 1.25 * u, thin = 0;
      for (; b <= 11 * u; b += 0.25 * u) {
        const ring = upTo(b).filter((i) => back(i) > b - 0.5 * u).map((i) => P[i]);
        if (ring.length < 3) continue;
        const mid = centre(ring), wide = ring.reduce((m, p) => Math.max(m, p.distanceTo(mid)), 0);
        if (b <= 3 * u) {
          round.push(wide);
          thin = [...round].sort((x, y) => x - y)[Math.floor(round.length / 2)];
        } else if (wide > thin * 1.9) break;
      }
      const piece = upTo(b - 0.5 * u), pts = piece.map((i) => P[i]);
      const base = centre(pts.filter((p) => P[tip].clone().sub(p).dot(dir) > b - 1.0 * u));
      const a = P[tip].clone().sub(base).normalize();
      const s = (p) => p.clone().sub(base).dot(a);
      const L = s(P[tip]);
      const on = (t) => {
        const near = pts.filter((p) => Math.abs(s(p) - t * L) < L * 0.1);
        return near.length >= 4 ? centre(near) : base.clone().addScaledVector(a, t * L);
      };
      // (its first bone, in the ball of it, starts where the cop's does: beside the wrist)
      thumb = { ids: new Set(piece), base, a, L, s, thin, joints: [rig.at(`thumb_01${side}`).clone(), base.clone().addScaledVector(a, T_KNUCKLE * L), on(T_LAST), P[tip].clone()] };
      dir = a;
    }
    if (thumb.L < 2.5 * u || thumb.L > 9 * u) throw new Error(`zombies: hand${side}: a thumb ${(thumb.L / u).toFixed(1)} cm long`);

    // ---- what every point from the wrist out hangs on
    const bones = { lowerarm: J('lowerarm'), hand: J('hand'), thumb: [1, 2, 3].map((k) => J(`thumb_0${k}`)) };
    for (const f of digits) f.bones = [1, 2, 3].map((k) => J(`${f.name}_0${k}`));
    /** of the hand and its fingers: `own` is the point's number among the body's, when it is one of them */
    const share = (p, own) => {
      const D = new Map();
      const add = (j, v) => v > 1e-4 && j >= 0 && D.set(j, (D.get(j) ?? 0) + v);
      const finger = own >= 0 ? digits.findIndex((f) => f.ids.has(own)) : -1;
      const ofThumb = own >= 0 && thumb.ids.has(own);
      if (!ofThumb) {
        // between the fingers by how near their lines it is; a point of a finger is that finger's alone, once clear of the hand
        const near = digits.map((f) => 1 / (f.off(p) ** 2 + (0.2 * u) ** 2));
        const all = near.reduce((a, b) => a + b, 0);
        digits.forEach((f, n) => {
          const s = f.s(p), d = -KNUCKLE * f.L;
          let m = near[n] / all;
          if (finger >= 0) m = THREE.MathUtils.lerp(m, n === finger ? 1 : 0, smooth(s, 0, 0.5 * d));
          const w = m * smooth(s, -1.6 * d, -0.3 * d);
          const w2 = smooth(s, (MIDDLE - 0.07) * f.L, (MIDDLE + 0.07) * f.L), w3 = smooth(s, (LAST - 0.07) * f.L, (LAST + 0.07) * f.L);
          add(f.bones[0], w * (1 - w2));
          add(f.bones[1], w * w2 * (1 - w3));
          add(f.bones[2], w * w2 * w3);
        });
      }
      if (finger < 0) {
        const s = thumb.s(p);
        if (ofThumb) {
          const w3 = smooth(s, (T_LAST - 0.1) * thumb.L, (T_LAST + 0.1) * thumb.L);
          add(bones.thumb[1], 1 - w3);
          add(bones.thumb[2], w3);
        } else {
          // the ball of the thumb: what lies beside its bone from the wrist to where it leaves the palm
          const w = 1 - smooth(fromLine(p, [thumb.joints[0], thumb.joints[1], thumb.base]), 1.2 * thumb.thin, 2.6 * thumb.thin);
          const w2 = smooth(s, (T_KNUCKLE - 0.15) * thumb.L, (T_KNUCKLE + 0.15) * thumb.L);
          add(bones.thumb[0], w * (1 - w2));
          add(bones.thumb[1], w * w2);
        }
      }
      const sum = [...D.values()].reduce((a, b) => a + b, 0);
      if (sum > 1) for (const [j, v] of D) D.set(j, v / sum);
      else add(bones.hand, 1 - sum);
      return D;
    };
    for (const s of shapes) {
      s.P.forEach((p, i) => {
        if (X(p) < Xw - 4 * u) return;
        const hand = smooth(X(p), Xw - 1.3 * u, Xw + 1.3 * u), sure = smooth(X(p), Xw - 4 * u, Xw - 2.2 * u);
        const W = new Map();
        for (const [j, v] of s.W[i]) W.set(j, v * (1 - sure));
        W.set(bones.lowerarm, (W.get(bones.lowerarm) ?? 0) + (1 - hand) * sure);
        if (hand > 0) for (const [j, v] of share(p, s === body ? mesh.one[i] : -1)) W.set(j, (W.get(j) ?? 0) + v * hand * sure);
        s.W[i] = W;
      });
    }

    // ---- and where the bones are said to have been bound
    for (const f of digits) f.joints.forEach((at, k) => put(`${f.name}_0${k + 1}${k === 3 ? '_leaf' : ''}${side}`, at));
    thumb.joints.forEach((at, k) => put(`thumb_0${k + 1}${k === 3 ? '_leaf' : ''}${side}`, at));
    told.push(`${sg > 0 ? 'left' : 'right'}: fingers ${digits.map((f) => ((f.L * (1 - KNUCKLE)) / u).toFixed(1)).join(', ')} cm, thumb ${(thumb.L / u).toFixed(1)} cm clear of the palm, ${((tipX - Xw) / u).toFixed(1)} cm from wrist to fingertip`);
  }
  return told.join('; ');
}

/**
 * A statue, given the cop's skeleton: returns the cop's document with the statue's shapes on
 * its bones in place of its own.
 */
async function likeTheCop(cop, statue) {
  const rig = rigOf(cop);
  const donor = boundPoints(cop);
  const C = landmarks(donor.map((d) => d.p));
  const shoulderC = Math.abs(rig.at('upperarm_l').x);

  // ---- the statue's points, standing up (its own file has it lying along z)
  const shapes = [];
  for (const n of statue.getRoot().listNodes()) {
    if (!n.getMesh()) continue;
    const world = M4(n.getWorldMatrix()), linear = new THREE.Matrix3().setFromMatrix4(world);
    for (const prim of n.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
      const P = [], N = [], UV = [];
      for (let i = 0; i < pos.getCount(); i++) {
        P.push(new THREE.Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(world));
        N.push(new THREE.Vector3().fromArray(nor.getElement(i, [])).applyMatrix3(linear).normalize());
        UV.push(uv.getElement(i, []));
      }
      const I = [];
      for (let i = 0; i < (idx ? idx.getCount() : P.length); i++) I.push(idx ? idx.getScalar(i) : i);
      shapes.push({ name: prim.getMaterial().getName(), P, N, UV, I });
    }
  }
  const all = shapes.flatMap((s) => s.P);
  let S = landmarks(all);
  // which way it faces: a foot lies in front of its ankle (not of the body's middle: these
  // slouch, and their middle is further forward than their toes). It must face the way the cop
  // does, whose toe bones say which that is.
  const ahead = (points, L) => {
    const band = (a, b) => points.filter((p) => (p.y - L.floor) / (L.top - L.floor) >= a && (p.y - L.floor) / (L.top - L.floor) < b);
    const mid = (l) => (l.reduce((z, p) => Math.max(z, p.z), -Infinity) + l.reduce((z, p) => Math.min(z, p.z), Infinity)) / 2;
    return mid(band(0, 0.03)) - mid(band(0.07, 0.11));
  };
  const copAhead = rig.at('ball_l').z - rig.at('foot_l').z;
  if (Math.sign(copAhead) !== Math.sign(ahead(donor.map((d) => d.p), C))) throw new Error('the cop: its feet and its toe bones point different ways');
  const was = ahead(all, S);
  if (Math.sign(was) !== Math.sign(copAhead)) {
    for (const s of shapes) for (const list of [s.P, s.N]) for (const v of list) v.set(-v.x, v.y, -v.z);
    S = landmarks(all);
  }
  const faces = `feet ${(Math.abs(was) / (S.top - S.floor) * 180).toFixed(1)} cm ahead of the ankles${Math.sign(was) !== Math.sign(copAhead) ? ' (turned round to face the way the cop does)' : ''}`;
  // ---- stood where the cop stands
  const u = (C.top - C.floor) / 180;
  const shoulderS = S.tip * (shoulderC / C.tip);
  const k = (C.top - C.floor) / (S.top - S.floor);
  const steps = (v, from, to) => {
    for (let i = 1; i < from.length; i++) if (v <= from[i] || i === from.length - 1) return to[i - 1] + ((v - from[i - 1]) / (from[i] - from[i - 1])) * (to[i] - to[i - 1]);
    return to[to.length - 1];
  };
  const ys = [S.floor, S.crotch, S.armY, S.top], yc = [C.floor, C.crotch, C.armY, C.top];
  const as = all.map((p) => p.clone());
  /** @param wrists how far out each of its wrists is, and the cop's; or nothing, and its arms are laid fingertip to fingertip with the cop's */
  /** where a place on the statue is when it is stood to the cop */
  const laid = (o, wrists, out = new THREE.Vector3()) => {
    const ax = Math.abs(o.x), sg = o.x < 0 ? -1 : 1;
    let x = steps(ax, [0, shoulderS, S.tip], [0, shoulderC, C.tip]);
    if (wrists) {
      // (the arm from shoulder to wrist is laid on the cop's; the hand beyond keeps its own shape, at the size of the rest of the body)
      const [its, cops] = wrists[sg];
      x = ax <= its ? steps(ax, [0, shoulderS, its], [0, shoulderC, cops]) : cops + (ax - its) * k;
    }
    // (an arm is not stretched up and down with the trunk it hangs beside: it is moved to the cop's arm, whole)
    const arm = smooth(ax, shoulderS * 1.05, shoulderS * 1.4);
    const y = THREE.MathUtils.lerp(steps(o.y, ys, yc), C.armY + (o.y - S.armY) * k, arm);
    return out.set(sg * x, y, C.chestZ + (o.z - S.chestZ) * k);
  };
  const stand = (wrists) => all.forEach((p, i) => laid(as[i], wrists, p));
  // Fingertip to fingertip first, to find its wrists by; then with its wrists at the cop's.
  // (The cop's hands are claws a hand and a half long: laid tip to tip, a statue's wrist was
  // most of the way up the cop's forearm, and its arm bent there.)
  stand(null);
  const found = wristsOf(shapes, rig, u);
  const wrists = {};
  for (const sg of [1, -1]) wrists[sg] = [shoulderS + ((found[sg] - shoulderC) * (S.tip - shoulderS)) / (C.tip - shoulderC), Math.abs(rig.at(sg > 0 ? 'hand_l' : 'hand_r').x)];
  stand(wrists);
  const arms = [1, -1].map((sg) => `${(((found[sg] - wrists[sg][1]) / u)).toFixed(1)} cm`).join(' and ');

  // ---- every point takes the bones of the nearest point of the cop
  const CELL = (C.top - C.floor) / 40;
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  donor.forEach((d, i) => {
    const kk = key(d.p.x, d.p.y, d.p.z);
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk).push(i);
  });
  const nearest = (p) => {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 6 && best < 0; r++) {
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        for (const i of grid.get(`${x},${y},${z}`) ?? []) {
          const d = donor[i].p.distanceToSquared(p);
          if (d < bd) [best, bd] = [i, d];
        }
      }
    }
    if (best < 0) for (let i = 0; i < donor.length; i++) {
      const d = donor[i].p.distanceToSquared(p);
      if (d < bd) [best, bd] = [i, d];
    }
    return best;
  };
  let far = 0;
  for (const s of shapes) {
    // what each point hangs on, as bone -> share
    s.W = s.P.map((p) => {
      const d = donor[nearest(p)];
      far = Math.max(far, d.p.distanceTo(p));
      const m = new Map();
      for (let c = 0; c < 4; c++) if (d.w[c] > 0) m.set(d.j[c], (m.get(d.j[c]) ?? 0) + d.w[c]);
      return m;
    });
    // and is evened out with its neighbours along the surface, twice: the nearest point of another body is a rough guide
    const near = s.P.map(() => new Set());
    for (let i = 0; i < s.I.length; i += 3) {
      const [a, b, c] = [s.I[i], s.I[i + 1], s.I[i + 2]];
      near[a].add(b).add(c);
      near[b].add(a).add(c);
      near[c].add(a).add(b);
    }
    for (let pass = 0; pass < 2; pass++) {
      s.W = s.W.map((own, i) => {
        const m = new Map();
        for (const [j, w] of own) m.set(j, w * 0.5);
        for (const o of near[i]) for (const [j, w] of s.W[o]) m.set(j, (m.get(j) ?? 0) + (w * 0.5) / near[i].size);
        return near[i].size ? m : own;
      });
    }
  }
  // (all but the hands: see fitHands)
  const hands = `${fitHands(shapes, rig, u)}; its wrists were ${arms} out along the cop's arms, laid fingertip to fingertip`;

  // ---- and back into its own shape, with the cop's skeleton brought to IT
  // It was stood to the cop only to learn from him which bones each point hangs on. Left
  // like that it would wear his proportions, pulled a little longer here and shorter there,
  // and what is painted on it pulled with it. So every point goes back where the statue has
  // it (at the cop's size, and nothing else done to it), and each joint of the skeleton goes
  // to the place on the statue that was laid where that joint is.
  const own = (o) => new THREE.Vector3(o.x * k, C.floor + (o.y - S.floor) * k, C.chestZ + (o.z - S.chestZ) * k);
  const back = (at) => {
    const o = new THREE.Vector3(at.x / k, S.floor + (at.y - C.floor) / k, S.chestZ + (at.z - C.chestZ) / k), w = new THREE.Vector3();
    for (let n = 0; n < 60; n++) {
      laid(o, wrists, w);
      o.x += ((at.x - w.x) / k) * 0.7;
      o.y += ((at.y - w.y) / k) * 0.7;
      o.z += (at.z - w.z) / k;
    }
    return o;
  };
  let slack = 0;
  {
    const ibm = rig.skin.getInverseBindMatrices();
    rig.joints.forEach((_, j) => {
      const was = new THREE.Vector3().setFromMatrixPosition(rig.bind[j]);
      const o = back(was);
      slack = Math.max(slack, laid(o, wrists).distanceTo(was));
      rig.bind[j] = rig.bind[j].clone().setPosition(own(o));
      ibm.setElement(j, rig.bind[j].clone().invert().elements);
    });
  }
  all.forEach((p, i) => p.copy(own(as[i])));
  if (slack > u * 0.5) throw new Error(`zombies: a joint could not be found again on the statue (out by ${(slack / u).toFixed(1)} cm)`);

  // ---- the cop's document, with these shapes on its bones in place of its own
  const root = cop.getRoot();
  const had = new Set(root.listMaterials());
  const before = { nodes: new Set(root.listNodes()), meshes: new Set(root.listMeshes()), scenes: new Set(root.listScenes()) };
  mergeDocuments(cop, statue);
  const mats = new Map(root.listMaterials().filter((m) => !had.has(m)).map((m) => [m.getName(), m]));
  for (const n of root.listNodes()) {
    if (before.nodes.has(n) ? !!n.getMesh() : true) {
      if (before.nodes.has(n)) n.setMesh(null);
      else n.dispose();
    }
  }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listScenes()) if (!before.scenes.has(s)) s.dispose();
  const home = root.listScenes()[0];
  for (const s of shapes) {
    const JI = [], JW = [];
    for (const m of s.W) {
      const four = [...m].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = four.reduce((t, x) => t + x[1], 0);
      for (let c = 0; c < 4; c++) {
        JI.push(four[c]?.[0] ?? 0);
        JW.push(four[c] ? four[c][1] / sum : 0);
      }
    }
    const prim = cop.createPrimitive()
      .setMaterial(mats.get(s.name))
      .setIndices(cop.createAccessor().setType('SCALAR').setArray(new Uint32Array(s.I)))
      .setAttribute('POSITION', cop.createAccessor().setType('VEC3').setArray(new Float32Array(s.P.flatMap((p) => [p.x, p.y, p.z]))))
      .setAttribute('NORMAL', cop.createAccessor().setType('VEC3').setArray(new Float32Array(s.N.flatMap((p) => [p.x, p.y, p.z]))))
      .setAttribute('TEXCOORD_0', cop.createAccessor().setType('VEC2').setArray(new Float32Array(s.UV.flat())))
      .setAttribute('JOINTS_0', cop.createAccessor().setType('VEC4').setArray(new Uint8Array(JI)))
      .setAttribute('WEIGHTS_0', cop.createAccessor().setType('VEC4').setArray(new Float32Array(JW)));
    home.addChild(cop.createNode(`z_${s.name}`).setMesh(cop.createMesh(`z_${s.name}`).addPrimitive(prim)).setSkin(rig.skin));
  }
  const pct = (a, b) => `${((a / b) * 100).toFixed(0)}%`;
  return { doc: cop, hands, told: `stood to the cop: ${faces}, x${k.toFixed(3)} of its size, crotch at ${pct(S.crotch - S.floor, S.top - S.floor)} (the cop's ${pct(C.crotch - C.floor, C.top - C.floor)}), arms at ${pct(S.armY - S.floor, S.top - S.floor)} (${pct(C.armY - C.floor, C.top - C.floor)}), furthest point from one of the cop's ${(far / (C.top - C.floor) * 180).toFixed(1)} cm` };
}

// ---------------------------------------------------------------- the cop's running, and another's standing, on the game's skeleton

/**
 * How every bone of a body with one movement in its file is turned from where it was bound,
 * frame by frame, and where its hips go.
 * @param prefix what stands before every joint's name in the file (see ours)
 * @param onTheSpot a run: whatever way it drifts over its length is taken out, so it loops where it stands
 */
function runOf(cop, prefix = '', onTheSpot = true) {
  const rig = rigOf(cop, prefix);
  const { joints, bind, parent } = rig;
  const n = joints.length;
  const order = joints.map((_, i) => i).sort((a, b) => depth(a) - depth(b));
  function depth(i) {
    let d = 0;
    for (let a = parent[i]; a >= 0; a = parent[a]) d++;
    return d;
  }
  const restT = joints.map((j) => new THREE.Vector3(...j.getTranslation())), restQ = joints.map((j) => new THREE.Quaternion(...j.getRotation())), restS = joints.map((j) => new THREE.Vector3(...j.getScale()));
  const top = order[0];
  // What stands above the skeleton in the file: whatever leaves its first bone where that was
  // bound, or (a file whose first "bone" is a bare knot bound nowhere) what the file itself
  // has above it. Whichever of the two stands the rest of it where it was bound.
  const aboves = [bind[top].clone().multiply(new THREE.Matrix4().compose(restT[top], restQ[top], restS[top]).invert())];
  if (joints[top].getParentNode()) aboves.push(M4(joints[top].getParentNode().getWorldMatrix()));
  let above = aboves[0];
  // (a file may hang a bone on its parent bone by way of something that is no bone: an
  // "armature" a hundredth the size, say. Whatever stands between the two is counted in.)
  const between = joints.map((j, i) => {
    const m = new THREE.Matrix4();
    if (parent[i] < 0) return m;
    for (let a = j.getParentNode(); a && a !== joints[parent[i]]; a = a.getParentNode()) m.premultiply(M4(a.getMatrix()));
    return m;
  });
  const pose = (Q, T) => {
    const W = new Array(n);
    for (const i of order) {
      const local = new THREE.Matrix4().compose(T[i], Q[i], restS[i]);
      W[i] = (parent[i] < 0 ? above.clone() : W[parent[i]].clone().multiply(between[i])).multiply(local);
    }
    return W;
  };
  // is the pose in the file the pose it was bound in? (It has to be, for "turned from where it was bound" to mean anything.)
  const tall = new THREE.Vector3().setFromMatrixPosition(bind[rig.name.indexOf('Head')]).y;
  let off = Infinity;
  for (const candidate of aboves) {
    above = candidate;
    const still = pose(restQ, restT);
    let worst = 0;
    // (the ends of the fingers and the top of the head carry nothing and were bound nowhere in particular: they are not asked)
    for (let i = 0; i < n; i++) if (rig.name[i] && !rig.name[i].includes('_leaf')) worst = Math.max(worst, new THREE.Vector3().setFromMatrixPosition(still[i]).distanceTo(new THREE.Vector3().setFromMatrixPosition(bind[i])));
    if (worst < off) off = worst;
    if (worst <= tall * 0.02) break;
  }
  if (off > tall * 0.02) throw new Error(`zombies: a body does not stand in its file as it was bound (out by ${((off / tall) * 100).toFixed(1)}% of its height)`);

  const anim = cop.getRoot().listAnimations()[0];
  const tracks = new Map();
  let dur = 0;
  for (const ch of anim.listChannels()) {
    const i = rig.index.get(ch.getTargetNode());
    if (i === undefined) continue;
    const s = ch.getSampler(), t = s.getInput().getArray(), v = s.getOutput().getArray();
    dur = Math.max(dur, t[t.length - 1]);
    tracks.set(`${i}:${ch.getTargetPath()}`, { t, v });
  }
  const sample = (tr, time, size) => {
    const { t, v } = tr;
    let k = 0;
    while (k < t.length - 2 && t[k + 1] <= time) k++;
    const u = THREE.MathUtils.clamp((time - t[k]) / Math.max(1e-6, t[k + 1] - t[k]), 0, 1);
    const a = Array.from(v.subarray(k * size, k * size + size)), b = Array.from(v.subarray((k + 1) * size, (k + 1) * size + size));
    return size === 4 ? new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), u) : new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), u);
  };
  const frames = Math.round(dur * FPS);
  const hips = rig.name.indexOf('pelvis');
  const turned = [], moved = [];
  const _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const rot = (m) => {
    const q = new THREE.Quaternion();
    m.decompose(_p, q, _s);
    return q;
  };
  const boundQ = bind.map(rot), hipsAt = new THREE.Vector3().setFromMatrixPosition(bind[hips]);
  for (let f = 0; f <= frames; f++) {
    const time = (f / frames) * dur;
    const Q = restQ.map((q, i) => (tracks.has(`${i}:rotation`) ? sample(tracks.get(`${i}:rotation`), time, 4) : q));
    const T = restT.map((p, i) => (i === hips && tracks.has(`${i}:translation`) ? sample(tracks.get(`${i}:translation`), time, 3) : p));
    const W = pose(Q, T);
    turned.push(W.map((m, i) => rot(m).multiply(boundQ[i].clone().invert())));
    moved.push(new THREE.Vector3().setFromMatrixPosition(W[hips]).sub(hipsAt));
  }
  // (it runs on the spot: whatever way it drifts over the two seconds is taken out)
  const drift = onTheSpot ? moved[frames].clone().sub(moved[0]) : new THREE.Vector3();
  moved.forEach((m, f) => m.addScaledVector(drift, -f / frames));
  const mean = moved.reduce((s, m) => s.add(m), new THREE.Vector3()).divideScalar(moved.length);
  for (const m of moved) {
    m.x -= mean.x;
    m.z -= mean.z;
  }
  return { rig, dur, frames, turned, moved, hipsHigh: hipsAt.y };
}

const ID = new THREE.Quaternion();
/** one of the character's movements (`run`, unless another is named) made the one that was read */
function giveRun(doc, run, clip = 'run') {
  const root = doc.getRoot();
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const mine = run.rig.name.map((nm, k) => [k, nm && !nm.includes('_leaf') && nodes.get(nm)]).filter(([, node]) => node);
  const depth = (n) => {
    let d = 0;
    for (let p = parentOf.get(n); p; p = parentOf.get(p)) d++;
    return d;
  };
  mine.sort((a, b) => depth(a[1]) - depth(b[1]));
  const restQ = (n) => new THREE.Quaternion(...n.getRotation());
  const restWorld = new Map();
  const worldRest = (n) => {
    if (!n) return new THREE.Quaternion();
    if (!restWorld.has(n)) restWorld.set(n, worldRest(parentOf.get(n)).clone().multiply(restQ(n)));
    return restWorld.get(n);
  };
  const mapped = new Map(mine.map(([k, node]) => [node, k]));
  const out = new Map(mine.map(([, node]) => [node, new Float32Array((run.frames + 1) * 4)]));
  // "Turned from where it was bound" carries a movement between two bodies that were bound
  // standing the SAME way. One bound with its arms hanging (most are) on this skeleton, which
  // rests with them straight out, would hold them out sideways all through. So each limb bone
  // is first laid the way the other body's lay when it was bound: along the same line.
  const NEXT = { clavicle: 'upperarm', upperarm: 'lowerarm', lowerarm: 'hand', thigh: 'calf', calf: 'foot' };
  const at = (n) => new THREE.Vector3().setFromMatrixPosition(M4(n.getWorldMatrix()));
  const laid = new Map();
  for (const [, node] of mine) {
    const m = node.getName().match(/^(.+?)(_[lr])$/);
    const next = m && NEXT[m[1]] && m[1] + m[2] && NEXT[m[1]] + m[2];
    const to = next && nodes.get(next);
    if (!to || !run.rig.name.includes(next)) continue;
    const here = at(to).sub(at(node)).normalize(), there = run.rig.at(next).sub(run.rig.at(node.getName())).normalize();
    // (a few degrees is the two riggers' taste, and is left alone)
    if (here.angleTo(there) > 0.14) laid.set(node, new THREE.Quaternion().setFromUnitVectors(here, there));
  }
  // (a hand lies as its forearm does)
  for (const s of ['_l', '_r']) if (laid.has(nodes.get(`lowerarm${s}`)) && nodes.get(`hand${s}`)) laid.set(nodes.get(`hand${s}`), laid.get(nodes.get(`lowerarm${s}`)));
  const pelvis = nodes.get('pelvis');
  const hip = new Float32Array((run.frames + 1) * 3);
  const scale = (pelvis.getWorldMatrix()[13]) / run.hipsHigh;
  const aboveHips = worldRest(parentOf.get(pelvis)).clone().invert();
  for (let f = 0; f <= run.frames; f++) {
    const now = new Map();
    const world = (n) => {
      if (!n) return new THREE.Quaternion();
      if (now.has(n)) return now.get(n);
      const k = mapped.get(n);
      // a bone the cop has: turned from its rest by what the cop's is turned by. One it has not: as it rests on the bone above.
      const q = k !== undefined ? run.turned[f][k].clone().multiply(laid.get(n) ?? ID).multiply(worldRest(n)) : world(parentOf.get(n)).clone().multiply(restQ(n));
      now.set(n, q);
      return q;
    };
    for (const [, node] of mine) {
      const local = world(parentOf.get(node)).clone().invert().multiply(world(node)).normalize();
      out.get(node).set([local.x, local.y, local.z, local.w], f * 4);
    }
    const d = run.moved[f].clone().multiplyScalar(scale).applyQuaternion(aboveHips);
    const t = pelvis.getTranslation();
    hip.set([t[0] + d.x, t[1] + d.y, t[2] + d.z], f * 3);
  }
  for (const a of root.listAnimations()) {
    if (a.getName() !== clip) continue;
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  const anim = doc.createAnimation(clip);
  const times = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from({ length: run.frames + 1 }, (_, f) => (f / run.frames) * run.dur));
  const add = (node, what, type, values) => {
    const s = doc.createAnimationSampler().setInput(times).setOutput(doc.createAccessor().setType(type).setArray(values)).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(what).setSampler(s));
  };
  for (const [node, values] of out) add(node, 'rotation', 'VEC4', values);
  add(pelvis, 'translation', 'VEC3', hip);
  return `${mine.length} bones, ${run.dur.toFixed(2)} s`;
}

// ---------------------------------------------------------------- build

await fs.access(TEMPLATE).catch(() => {
  throw new Error('zombies: run "node scripts/build-character.mjs --infected" first (it makes assets-src/characters/plain.glb)');
});
const run = runOf(await readCop());
// how they stand when they are going nowhere: "toxic Zombie 3 Idle (animated)" by vicente betoret
// ferrero, seven seconds of it. Only its movement is used, on these bodies.
const idle = runOf(await io.read(path.join(SRC, 'zombie_idle', 'scene.gltf')), 'mixamorig:', false);
for (const z of ZOMBIES) {
  if (ONLY.length && !ONLY.includes(z.id)) continue;
  const doc = await io.read(TEMPLATE);
  const root = doc.getRoot();
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const old = ['eyes', 'eyebrows', 'hair_buzzed', 'hair_parted', 'hair_long', 'hair_beard'].map((n) => nodes.get(n)).filter(Boolean);
  let suit = z.own ? await io.read(path.join(SRC, z.dir, 'scene.gltf')) : await readCop(), told = '';
  let hands = '';
  if (z.statue) ({ doc: suit, told, hands } = await likeTheCop(suit, await io.read(path.join(SRC, z.dir, 'scene.gltf'))));
  // (the skeleton to the body, not the body to the skeleton: see fitSkeleton)
  const fitted = fitSkeleton({ doc, bodyNode: nodes.get('body'), suit, prefix: z.own ?? '' });
  const worn = await wearSuit({ doc, io, bodyNode: nodes.get('body'), old, suit, pieces: z.pieces, moved: {}, prefix: z.own ?? '' });
  // what it is painted with: all that it came with (colour, the lie of the surface, how rough
  // it is) but the map of its glints, which wants a costlier kind of material than anything
  // else in the game is made of
  // (and none of it is metal, whatever the packs' conversion from their old kind of material says)
  for (const m of root.listMaterials()) m.setExtension('KHR_materials_specular', null).setExtension('KHR_materials_ior', null).setMetallicFactor(0);
  for (const e of root.listExtensionsUsed()) if (/^KHR_materials_(specular|ior)$/.test(e.extensionName)) e.dispose();
  // (the glint maps themselves, which nothing points at any more, are not to be shipped)
  for (const t of root.listTextures()) if (t.listParents().every((p) => p === root)) t.dispose();
  // Skin, cloth and hair that come as "see-through, blended" are cut out instead: a thing is
  // there or it is not. (Blended, nothing writes how far away it is, and the bare leg under a
  // trouser leg is drawn over it. Only the lenses of the cop's glasses are truly seen through.)
  for (const n of root.listNodes()) {
    if (n.getName() === 'glass') continue;
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      const m = prim.getMaterial();
      if (m?.getAlphaMode() === 'BLEND') m.setAlphaMode('MASK').setAlphaCutoff(n.getName() === 'hair' ? 0.4 : 0.5);
    }
  }
  const ran = giveRun(doc, run);
  const stood = giveRun(doc, idle, 'idle');
  await MeshoptSimplifier.ready;
  if (z.keep) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: z.keep, error: 0.0015 }));
  await doc.transform(
    unpartition(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(baseColor|normal|emissive)Texture$/, resize: [TEX, TEX], quality: 92 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(metallicRoughness|occlusion)Texture$/, resize: [TEX_ROUGH, TEX_ROUGH], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const dest = path.join(OUT, `zombie_${z.id}.glb`);
  await io.write(dest, doc);
  const st = await fs.stat(dest);
  const triangles = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log(`${path.basename(dest)}  ${(st.size / 1048576).toFixed(2)} MB  ${Math.round(triangles)} triangles  run: ${ran}  idle: ${stood}`);
  if (told) console.log(`  ${told}`);
  if (hands) console.log(`  hands: ${hands}`);
  console.log(`  ${fitted}`);
  console.log(`  ${worn}`);
}
