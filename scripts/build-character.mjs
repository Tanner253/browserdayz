// Builds the player character: public/assets/characters/survivor.glb (+ survivor_mask.webp).
//
//   node scripts/build-character.mjs
//
// Sources, both CC0 by Quaternius (https://quaternius.com), unpacked into
// assets-src/characters/src/ (gitignored):
//   Universal Base Characters [Standard]  ->  Superhero_Male_FullBody.gltf + textures, hair/*.gltf
//   Universal Animation Library [Standard] -> animations.glb
//
// The base character is a body in underwear. This script dresses it: the torso and arms
// become a jacket, the hips and legs trousers, the feet and lower calves boots. Cloth is
// pushed out from the skin a little, painted over the skin texture (seams, zip, cuffs,
// pockets) in a neutral grey that the game tints per player, and the muscle detail in
// the normal map is flattened under it. Then the animation library, which is authored
// on a slightly different rest pose, is transferred onto this skeleton.

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, mergeDocuments, unpartition, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { wearSuit } from './suit.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src', 'characters', 'src');
const OUT = path.join(ROOT, 'public', 'assets', 'characters');
const TEX = 1024;

/**
 * game name -> clip in the animation library. The library's "jog" covers six metres a
 * second: here it is the run, and the game's jog is a blend of it with the walk.
 */
const CLIPS = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop',
  crouchIdle: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop',
  jumpStart: 'Jump_Start', jumpLoop: 'Jump_Loop', jumpLand: 'Jump_Land',
  death: 'Death01', hit: 'Hit_Chest', hitHead: 'Hit_Head',
  // from the wheel (src/sim/emotes.ts)
  dance: 'Dance_Loop',
  // in a jeep's seat (src/game/garage.ts)
  sit: 'Sitting_Idle_Loop',
};
/**
 * `--emotes`: the same body with a few more clips from the library, written to
 * trailer/emotes.glb for the trailer's "coming soon" scenes. The game's own file and its
 * mask are left exactly as they are.
 */
const EMOTES = process.argv.includes('--emotes');
/**
 * `--infected`: the plain body in its civilian's jacket, as it was before the suit, written to
 * infected.glb beside the survivor. It is what the infected are drawn with (src/game/infected.ts):
 * the game colours it sick and bloody. The survivor's file and the mask are left as they are
 * (the mask is the same painting either way).
 */
const INFECTED = process.argv.includes('--infected');
if (EMOTES) Object.assign(CLIPS, { talk: 'Idle_Talking_Loop', point: 'Spell_Simple_Shoot', hail: 'Spell_Simple_Idle_Loop', reach: 'Interact', sit: 'Sitting_Idle_Loop', sitTalk: 'Sitting_Talking_Loop' });
const HAIR = { hair_buzzed: 'Hair_Buzzed', hair_parted: 'Hair_SimpleParted', hair_long: 'Hair_Long', hair_beard: 'Hair_Beard' };
/** the long style is cut for the other body in the pack, whose head sits lower and a touch further forward */
const HAIR_SHIFT = { hair_long: [0, 0.045, -0.004] };

// ---------------------------------------------------------------- small maths
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qslerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) return qnorm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
};
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const hash = (x, y) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** smooth value noise, period-free, 0..1 */
const vnoise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

/** the animation library's bone names -> this character's */
const boneMap = (n) => {
  const side = n.endsWith('.L') ? '_l' : n.endsWith('.R') ? '_r' : '';
  const b = n.replace(/^DEF-/, '').replace(/\.[LR]$/, '');
  const t = {
    hips: 'pelvis', 'spine.001': 'spine_01', 'spine.002': 'spine_02', 'spine.003': 'spine_03', neck: 'neck_01', head: 'Head',
    shoulder: 'clavicle', upper_arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', thigh: 'thigh', shin: 'calf', foot: 'foot', toe: 'ball',
  }[b];
  if (t) return t + side;
  const f = b.match(/^(?:f_)?(index|middle|ring|pinky|thumb)\.0(\d)$/);
  return f ? `${f[1]}_0${f[2]}${side}` : null;
};

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(path.join(SRC, 'Superhero_Male_FullBody.gltf'));
const lib = await io.read(path.join(SRC, 'animations.glb'));
const root = doc.getRoot();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));

// ================================================================ 1. dress the body
const bodyNode = root.listNodes().find((n) => n.getMesh() && n.getName() === 'SuperHero_Male');
const prim = bodyNode.getMesh().listPrimitives()[0];
const joints = bodyNode.getSkin().listJoints().map((j) => j.getName());
const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), UV = prim.getAttribute('TEXCOORD_0');
const J = prim.getAttribute('JOINTS_0'), Wt = prim.getAttribute('WEIGHTS_0');
const count = P.getCount();
const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2);
const top = new Float32Array(count), legs = new Float32Array(count), boots = new Float32Array(count), gloves = new Float32Array(count);
const region = (name) =>
  /^(spine_|clavicle|upperarm|lowerarm)/.test(name) ? 0 : /^(pelvis|thigh|calf)/.test(name) ? 1 : /^(foot|ball)/.test(name) ? 2 : /^(hand|index|middle|ring|pinky|thumb)_/.test(name) ? 3 : 4;
{
  const v = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0], t = [0, 0];
  for (let i = 0; i < count; i++) {
    P.getElement(i, v); pos.set(v, i * 3);
    N.getElement(i, v); nrm.set(v, i * 3);
    UV.getElement(i, t); uv.set(t, i * 2);
    J.getElement(i, j); Wt.getElement(i, w);
    const sum = w[0] + w[1] + w[2] + w[3] || 1;
    let neck = 0;
    for (let k = 0; k < 4; k++) {
      const name = joints[j[k]];
      const r = region(name), x = w[k] / sum;
      if (r === 0) top[i] += x; else if (r === 1) legs[i] += x; else if (r === 2) boots[i] += x; else if (r === 3) gloves[i] += x;
      if (name === 'neck_01') neck += x;
    }
    const y = pos[i * 3 + 1];
    // a collar comes a little way up the neck; the jacket hangs over the hips to a hem
    top[i] = Math.min(1, top[i] + neck * smooth(1.565, 1.525, y));
    const hem = smooth(0.905, 0.955, y) * legs[i];
    top[i] = Math.min(1, top[i] + hem);
    legs[i] -= hem;
    // boots come up over the ankle
    const shaft = smooth(0.345, 0.295, y) * legs[i];
    boots[i] = Math.min(1, boots[i] + shaft);
    legs[i] -= shaft;
  }
}
// ---------------------------------------------------------------- an ordinary build
// The base body is a bodybuilder: shoulders a doorway wide, a waist half that, every muscle
// cut. Dressed as it stands it reads as a man in a wetsuit. So before the clothes go on the
// shoulders come in, the limbs lose their bulges and become sleeves and trouser legs, and
// the torso is pulled toward the plain barrel a jacket hangs as.
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const wpos = (name) => { const m = nodes.get(name).getWorldMatrix(); return [m[12], m[13], m[14]]; };
const weightOf = (re) => {
  const out = new Float32Array(count), j = [0, 0, 0, 0], w = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    J.getElement(i, j); Wt.getElement(i, w);
    const sum = w[0] + w[1] + w[2] + w[3] || 1;
    for (let k = 0; k < 4; k++) if (re.test(joints[j[k]])) out[i] += w[k] / sum;
  }
  return out;
};
// vertices split along texture seams share a position: they must move, and be lit, as one
const group = new Int32Array(count);
let groups = 0;
{
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
    let g = seen.get(key);
    if (g === undefined) seen.set(key, (g = groups++));
    group[i] = g;
  }
}
const tris = prim.getIndices().getArray();
const computeNormals = () => {
  const acc = new Float64Array(groups * 3);
  for (let f = 0; f < tris.length; f += 3) {
    const a = tris[f] * 3, b = tris[f + 1] * 3, c = tris[f + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; // length = twice the area: big faces count for more
    for (const v of [tris[f], tris[f + 1], tris[f + 2]]) for (let k = 0; k < 3; k++) acc[group[v] * 3 + k] += n[k];
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const g = group[i] * 3, l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1;
    out[i * 3] = acc[g] / l; out[i * 3 + 1] = acc[g + 1] / l; out[i * 3 + 2] = acc[g + 2] / l;
  }
  return out;
};

// ---- shoulders: the arm joints, and everything hanging off them, come in toward the neck
const NARROW = 0.028;
{
  const shoulderX = wpos('upperarm_l')[0];
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    pos[o] -= Math.sign(pos[o]) * NARROW * smooth(0.06, shoulderX, Math.abs(pos[o])) * smooth(1.2, 1.36, pos[o + 1]);
  }
  const skin = bodyNode.getSkin();
  const ibm = skin.getInverseBindMatrices().getArray().slice();
  const list = skin.listJoints();
  for (const side of ['l', 'r']) {
    const arm = nodes.get(`upperarm_${side}`);
    const dx = side === 'l' ? -NARROW : NARROW; // the left arm is on +x
    // the joint moves in the world; its stored offset is written in the collar bone's axes
    const pm = nodes.get(`clavicle_${side}`).getWorldMatrix();
    const t = arm.getTranslation();
    arm.setTranslation([t[0] + pm[0] * dx, t[1] + pm[4] * dx, t[2] + pm[8] * dx]);
    const moved = new Set();
    (function walk(n) { moved.add(n); n.listChildren().forEach(walk); })(arm);
    list.forEach((jn, k) => {
      if (!moved.has(jn)) return;
      const m = k * 16; // bind' = shift * bind, so its inverse is inverse * shift back
      ibm[m + 12] -= ibm[m] * dx; ibm[m + 13] -= ibm[m + 1] * dx; ibm[m + 14] -= ibm[m + 2] * dx;
    });
  }
  skin.setInverseBindMatrices(doc.createAccessor('bind').setType('MAT4').setArray(ibm));
}

// ---- limbs: toward a tube of the width the garment would be, keeping some of the shape
const disp = new Float32Array(count * 3);
const limb = (a, b, r0, r1, keep, fade = () => 1) => {
  const wt = weightOf(new RegExp(`^${a}$`));
  const A = wpos(a), B = wpos(b);
  const ax = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...ax), u = ax.map((c) => c / L);
  const polar = (i) => {
    const o = i * 3, d = [pos[o] - A[0], pos[o + 1] - A[1], pos[o + 2] - A[2]];
    const along = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const rad = [d[0] - u[0] * along, d[1] - u[1] * along, d[2] - u[2] * along];
    return { t: along / L, rad, r: Math.hypot(...rad) };
  };
  const BINS = 10, sum = new Float32Array(BINS), n = new Float32Array(BINS);
  for (let i = 0; i < count; i++) {
    if (wt[i] < 0.5) continue;
    const { t, r } = polar(i);
    if (t < 0 || t > 1) continue;
    const k = Math.min(BINS - 1, Math.floor(t * BINS));
    sum[k] += r; n[k]++;
  }
  const mean = (t) => {
    const x = clamp(t * BINS - 0.5, 0, BINS - 1), k0 = Math.floor(x), k1 = Math.min(BINS - 1, k0 + 1);
    const m0 = sum[k0] / (n[k0] || 1), m1 = sum[k1] / (n[k1] || 1);
    return m0 + (m1 - m0) * (x - k0);
  };
  for (let i = 0; i < count; i++) {
    if (wt[i] <= 0) continue;
    const { t, rad, r } = polar(i);
    if (r < 1e-5) continue;
    const tc = clamp(t, 0, 1), m = mean(tc) || r;
    const want = (r0 + (r1 - r0) * tc) * (1 + keep * (r / m - 1));
    const k = (wt[i] * fade(t, i) * (want - r)) / r;
    for (let c = 0; c < 3; c++) disp[i * 3 + c] += rad[c] * k;
  }
};
for (const s of ['l', 'r']) {
  limb(`upperarm_${s}`, `lowerarm_${s}`, 0.066, 0.057, 0.4);
  limb(`lowerarm_${s}`, `hand_${s}`, 0.056, 0.044, 0.4);
  // the top of the thigh is hip and seat: leave it to the torso
  limb(`thigh_${s}`, `calf_${s}`, 0.098, 0.079, 0.5, (t) => smooth(0.05, 0.3, t));
  // trouser legs fall straight to the boot; the boot keeps the leg's own shape
  limb(`calf_${s}`, `foot_${s}`, 0.077, 0.063, 0.45, (t, i) => 1 - boots[i]);
}

// ---- torso: toward an ellipse at each height. [height, half width, front, back]
const BARREL = [
  [0.88, 0.176, 0.104, -0.15], [1.0, 0.178, 0.108, -0.148], [1.1, 0.174, 0.11, -0.136], [1.2, 0.173, 0.112, -0.133],
  [1.3, 0.178, 0.116, -0.142], [1.4, 0.186, 0.118, -0.152], [1.52, 0.19, 0.11, -0.15],
];
{
  const wt = weightOf(/^(spine_|pelvis|thigh|clavicle)/);
  for (let i = 0; i < count; i++) {
    const o = i * 3, y = pos[o + 1];
    const k = 0.78 * wt[i] * smooth(0.88, 0.96, y) * smooth(1.5, 1.36, y);
    if (k <= 0) continue;
    let s = 0;
    while (s < BARREL.length - 2 && BARREL[s + 1][0] < y) s++;
    const p = BARREL[s], q = BARREL[s + 1], u = clamp((y - p[0]) / (q[0] - p[0]), 0, 1);
    const half = p[1] + (q[1] - p[1]) * u, front = p[2] + (q[2] - p[2]) * u, back = p[3] + (q[3] - p[3]) * u;
    const zc = (front + back) / 2, deep = (front - back) / 2;
    const x = pos[o], z = pos[o + 2] - zc, r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const cs = x / r, sn = z / r;
    const e = (half * deep) / Math.hypot(deep * cs, half * sn);
    disp[o] += cs * (e - r) * k; disp[o + 2] += sn * (e - r) * k;
  }
}
for (let i = 0; i < count * 3; i++) pos[i] += disp[i];

// ---- cloth does not show the muscle under it: relax what is left of the definition
const cover = new Float32Array(count);
for (let i = 0; i < count; i++) cover[i] = Math.min(1, top[i] + legs[i]);
{
  const near = Array.from({ length: groups }, () => new Set());
  for (let f = 0; f < tris.length; f += 3) {
    const g = [group[tris[f]], group[tris[f + 1]], group[tris[f + 2]]];
    for (let k = 0; k < 3; k++) { near[g[k]].add(g[(k + 1) % 3]); near[g[k]].add(g[(k + 2) % 3]); }
  }
  const first = new Int32Array(groups).fill(-1);
  for (let i = 0; i < count; i++) if (first[group[i]] < 0) first[group[i]] = i;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(groups * 3);
    for (let g = 0; g < groups; g++) {
      const i = first[g], k = 0.5 * smooth(0.3, 0.9, cover[i]);
      let n = 0;
      const avg = [0, 0, 0];
      for (const h of near[g]) { const j = first[h] * 3; avg[0] += pos[j]; avg[1] += pos[j + 1]; avg[2] += pos[j + 2]; n++; }
      for (let c = 0; c < 3; c++) next[g * 3 + c] = pos[i * 3 + c] + (n ? (avg[c] / n - pos[i * 3 + c]) * k : 0);
    }
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = next[group[i] * 3 + c];
  }
}

// ---- and it has thickness: out from the skin, most where a cuff, collar or boot ends
{
  const lit = computeNormals();
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const out = 0.008 * top[i] + 0.005 * legs[i] + 0.013 * boots[i] + 0.0025 * gloves[i];
    for (let c = 0; c < 3; c++) pos[o + c] += lit[o + c] * out;
  }
  const after = computeNormals();
  // skin that was never moved keeps the normals it was modelled with
  for (let i = 0; i < count; i++) {
    const o = i * 3, k = Math.min(1, cover[i] + boots[i] + gloves[i]);
    const n = [nrm[o] + (after[o] - nrm[o]) * k, nrm[o + 1] + (after[o + 1] - nrm[o + 1]) * k, nrm[o + 2] + (after[o + 2] - nrm[o + 2]) * k];
    const l = Math.hypot(...n) || 1;
    nrm[o] = n[0] / l; nrm[o + 1] = n[1] / l; nrm[o + 2] = n[2] / l;
  }
}
prim.setAttribute('NORMAL', doc.createAccessor('normal').setType('VEC3').setArray(nrm));
prim.setAttribute('POSITION', doc.createAccessor('position').setType('VEC3').setArray(pos));
for (const n of root.listNodes()) {
  for (const p of n.getMesh()?.listPrimitives() ?? []) {
    for (const s of ['COLOR_0', 'COLOR_1', 'TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3']) if (p.getAttribute(s)) p.setAttribute(s, null);
  }
}

// ---- rasterise the mesh into its own texture space: every texel learns where on the body it is
const idx = prim.getIndices().getArray();
const px = new Float32Array(TEX * TEX * 3);
const mk = new Float32Array(TEX * TEX * 3); // top, legs, boots
const cov = new Uint8Array(TEX * TEX);
for (let f = 0; f < idx.length; f += 3) {
  const a = idx[f], b = idx[f + 1], c = idx[f + 2];
  const ax = uv[a * 2] * TEX, ay = uv[a * 2 + 1] * TEX, bx = uv[b * 2] * TEX, by = uv[b * 2 + 1] * TEX, cx = uv[c * 2] * TEX, cy = uv[c * 2 + 1] * TEX;
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(den) < 1e-9) continue;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), x1 = Math.min(TEX - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), y1 = Math.min(TEX - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const sx = x + 0.5, sy = y + 0.5;
      const l0 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / den;
      const l1 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / den;
      const l2 = 1 - l0 - l1;
      const e = -0.08; // a little past the edge, so island borders are covered
      if (l0 < e || l1 < e || l2 < e) continue;
      const inside = l0 >= 0 && l1 >= 0 && l2 >= 0;
      const o = y * TEX + x;
      if (cov[o] === 2 || (cov[o] === 1 && !inside)) continue;
      cov[o] = inside ? 2 : 1;
      for (let k = 0; k < 3; k++) px[o * 3 + k] = pos[a * 3 + k] * l0 + pos[b * 3 + k] * l1 + pos[c * 3 + k] * l2;
      mk[o * 3] = top[a] * l0 + top[b] * l1 + top[c] * l2;
      mk[o * 3 + 1] = legs[a] * l0 + legs[b] * l1 + legs[c] * l2;
      mk[o * 3 + 2] = (boots[a] + gloves[a]) * l0 + (boots[b] + gloves[b]) * l1 + (boots[c] + gloves[c]) * l2;
    }
  }
}
// spread into the gutters between islands so texture filtering never pulls in skin
for (let pass = 0; pass < 8; pass++) {
  const add = [];
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const o = y * TEX + x;
      if (cov[o]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= TEX || ny >= TEX) continue;
        const q = ny * TEX + nx;
        if (cov[q]) { add.push(o, q); break; }
      }
    }
  }
  for (let i = 0; i < add.length; i += 2) {
    const o = add[i], q = add[i + 1];
    cov[o] = 1;
    for (let k = 0; k < 3; k++) { px[o * 3 + k] = px[q * 3 + k]; mk[o * 3 + k] = mk[q * 3 + k]; }
  }
}

// ---- paint
const raw = (file) => sharp(path.join(SRC, file)).resize(TEX, TEX).removeAlpha().raw().toBuffer();
const base = await raw('T_Superhero_Male_Dark.png');
const normal = await raw('T_Superhero_Male_Normal.png');
const rough = await sharp(path.join(SRC, 'T_Superhero_Male_Roughness.png')).resize(TEX, TEX).greyscale().raw().toBuffer();
const outBase = Buffer.alloc(TEX * TEX * 3), outNormal = Buffer.alloc(TEX * TEX * 3), outMR = Buffer.alloc(TEX * TEX * 3), outMask = Buffer.alloc(TEX * TEX * 3);
const band = (v, lo, hi, soft = 0.004) => smooth(lo - soft, lo + soft, v) * smooth(hi + soft, hi - soft, v);
const frame = (u, v, u0, u1, v0, v1, w = 0.0045) => {
  // outline of a rectangle (a pocket, a flap)
  const inside = u > u0 - w && u < u1 + w && v > v0 - w && v < v1 + w;
  const inner = u > u0 + w && u < u1 - w && v > v0 + w && v < v1 - w;
  return inside && !inner ? 1 : 0;
};
// Two passes. The first decides, for every texel, what is worn there and how far the cloth
// stands up or sinks at that point (seams, pocket patches, folds). The second colours it and
// turns the heights into the normal map.
const TEXELS = TEX * TEX;
const tx = { dressed: new Float32Array(TEXELS), jk: new Float32Array(TEXELS), tr: new Float32Array(TEXELS), bt: new Float32Array(TEXELS), dark: new Float32Array(TEXELS), zip: new Uint8Array(TEXELS), h: new Float32Array(TEXELS) };
const wave = (v, period) => Math.sin((v * 2 * Math.PI) / period);
const patch = (u, v, u0, u1, v0, v1, s = 0.003) => band(u, u0, u1, s) * band(v, v0, v1, s);
/** lumpy noise through space, so folds are not ruled lines */
const lumpy = (X, Y, Z) => vnoise(X * 30 + Z * 21 + 13.1, Y * 30 - Z * 12 + 7.7);
/** 0 over most of the cloth, rising to 1 in patches: where a fold happens to form */
const gathers = (X, Y, Z) => smooth(0.48, 0.7, vnoise(X * 9 + Z * 6 + 3.3, Y * 7 - Z * 5 + 1.9));
for (let o = 0; o < TEXELS; o++) {
  const o3 = o * 3;
  // how much of this texel is dressed at all, then which garment has it: where two meet
  // (hem over trousers, trousers over boots) one hands over to the other with no skin between
  const m0 = mk[o3], m1 = mk[o3 + 1], m2 = mk[o3 + 2], all = m0 + m1 + m2;
  const dressed = cov[o] ? smooth(0.4, 0.6, all) : 0;
  const bt = all > 1e-4 ? dressed * smooth(0.42, 0.58, m2 / all) : 0;
  const jk = m0 + m1 > 1e-4 ? (dressed - bt) * smooth(0.42, 0.58, m0 / (m0 + m1)) : 0;
  const tr = dressed - bt - jk;
  const X = px[o3], Y = px[o3 + 1], Z = px[o3 + 2];
  const ax = Math.abs(X);
  let dark = 1; // seams and trim, darker than the cloth around them
  let zip = 0, h = 0;
  if (jk > 0.5) {
    const front = Z > 0 ? 1 : 0;
    if (front && ax < 0.0065 && Y > 0.93 && Y < 1.52) zip = 1;
    else if (front && band(ax, 0.02, 0.0245, 0.0015) && Y > 0.93 && Y < 1.5) dark = 0.8; // placket stitching
    dark *= 1 - 0.24 * band(Y, 0.9, 0.945); // ribbed hem
    dark *= 1 - 0.22 * band(ax, 0.622, 0.682); // cuffs
    dark *= 1 - 0.2 * smooth(1.5, 1.52, Y); // collar
    if (Y > 1.36 && Y < 1.54 && band(ax, 0.184, 0.191, 0.0015) > 0.5) dark *= 0.82; // shoulder seam
    if (front && frame(ax, Y, 0.06, 0.15, 1.26, 1.345)) dark *= 0.78; // chest pockets
    if (front && Y > 1.318 && Y < 1.345 && ax > 0.06 && ax < 0.15) dark *= 0.9; // their flaps
    if (front && frame(ax, Y, 0.05, 0.16, 0.965, 1.06)) dark *= 0.8; // hand pockets
    // trim and patches stand proud of the cloth
    h += 0.0012 * band(Y, 0.9, 0.945) + 0.0012 * band(ax, 0.622, 0.682) + 0.0014 * smooth(1.5, 1.52, Y);
    if (Y > 1.36 && Y < 1.54) h += 0.0008 * band(ax, 0.182, 0.193, 0.002);
    if (front) {
      if (Y > 0.93 && Y < 1.5) h += 0.0009 * band(ax, 0.007, 0.0245, 0.002) - 0.001 * zip;
      h += 0.0009 * patch(ax, Y, 0.06, 0.15, 1.26, 1.345) + 0.0008 * patch(ax, Y, 0.06, 0.15, 1.318, 1.345);
      h += 0.0008 * patch(ax, Y, 0.05, 0.16, 0.965, 1.06);
    }
    // folds: where a sleeve bends, under the arm, and where the jacket sits on the hips
    const lumps = lumpy(X, Y, Z), some = gathers(X, Y, Z);
    if (ax > 0.25) h += 0.0014 * wave(ax + 0.014 * lumps, 0.04) * Math.exp(-(((ax - 0.435) / 0.04) ** 2));
    h += 0.001 * some * wave(Y - 0.55 * ax + 0.03 * lumps, 0.06) * band(ax, 0.13, 0.25, 0.03) * band(Y, 1.22, 1.4, 0.03);
    h += 0.0011 * some * wave(Y + 0.03 * lumps, 0.055) * band(Y, 0.97, 1.12, 0.03) * smooth(0.05, 0.15, ax);
    h += 0.0007 * (lumps - 0.5);
  }
  if (tr > 0.5) {
    const side = Math.abs(Z + 0.03) < 0.075 && ax > 0.15;
    if (side && frame(Z + 0.03, Y, -0.062, 0.062, 0.6, 0.76, 0.005)) dark *= 0.78; // cargo pockets
    dark *= 1 - 0.1 * band(Y, 0.49, 0.58) * (Z > 0 ? 1 : 0); // worn knees
    if (Z > 0 && ax < 0.006 && Y > 0.8) dark *= 0.8; // fly
    const lumps = lumpy(X, Y, Z);
    // behind the knee, stacked on the boot, and pulled from the crotch out to the hips
    const some = gathers(X, Y, Z);
    h += 0.0013 * wave(Y + 0.014 * lumps, 0.042) * Math.exp(-(((Y - 0.52) / 0.04) ** 2)) * (Z < -0.03 ? 1 : 0.3);
    h += 0.0014 * wave(Y + 0.012 * lumps, 0.04) * band(Y, 0.345, 0.42, 0.02);
    h += 0.001 * some * wave(Y - 0.6 * ax + 0.03 * lumps, 0.06) * band(Y, 0.76, 0.88, 0.03) * (Z > 0 ? 1 : 0.5);
    if (ax > 0.16) h += 0.0008 * band(Z + 0.03, -0.004, 0.004, 0.002); // outseam
    if (side) h += 0.0011 * patch(Z + 0.03, Y, -0.062, 0.062, 0.6, 0.76) + 0.0008 * patch(Z + 0.03, Y, -0.062, 0.062, 0.73, 0.76);
    h += 0.0008 * (lumps - 0.5);
  }
  tx.dressed[o] = dressed; tx.jk[o] = zip ? 0 : jk; tx.tr[o] = tr; tx.bt[o] = bt; tx.dark[o] = dark; tx.zip[o] = zip; tx.h[o] = h * (jk + tr);
}
/** slope of the cloth across a texel, in texture space; nothing across the gap between two islands */
const slope = (o, step) => {
  const a = o - step, b = o + step;
  if (a < 0 || b >= TEXELS || !cov[a] || !cov[b]) return 0;
  const d = Math.hypot(px[b * 3] - px[a * 3], px[b * 3 + 1] - px[a * 3 + 1], px[b * 3 + 2] - px[a * 3 + 2]);
  return d > 1e-5 && d < 0.02 ? (tx.h[b] - tx.h[a]) / d : 0;
};
for (let y = 0; y < TEX; y++) {
  for (let x = 0; x < TEX; x++) {
    const o = y * TEX + x, o3 = o * 3;
    const dressed = tx.dressed[o], bt = tx.bt[o], jk = tx.jk[o], tr = tx.tr[o], zip = tx.zip[o];
    const Y = px[o3 + 1], Z = px[o3 + 2], ax = Math.abs(px[o3]);
    // cloth: a woven grey the game multiplies by each player's colours
    const weave = 0.5 + 0.5 * Math.sin(x * 2.4) * Math.sin(y * 2.4);
    const worn = vnoise(x / 46, y / 46) * 0.6 + vnoise(x / 11, y / 11) * 0.4;
    let cloth = 0.8 * (0.9 + 0.08 * weave + 0.12 * (worn - 0.5) + 0.05 * (hash(x, y) - 0.5));
    if (tr > 0.5) cloth *= 0.97;
    // the bottom of a fold sits in its own shadow
    const shade = Math.min(1.04, Math.max(0.86, 1 + tx.h[o] * 32));
    const tint = jk + tr + (zip ? tx.dressed[o] - bt - tr : 0);
    let r = base[o3], g = base[o3 + 1], b = base[o3 + 2];
    const c = Math.round(255 * Math.min(1, cloth * tx.dark[o] * shade));
    // skin where nothing is worn, cloth where it is (boot leather is added below)
    r = r * (1 - dressed) + c * tint; g = g * (1 - dressed) + c * tint; b = b * (1 - dressed) + c * tint;
    let rgh = rough[o], nr = normal[o3], ng = normal[o3 + 1], nb = normal[o3 + 2];
    // under cloth the body's muscle definition is gone: the normal map there is the cloth's own
    // folds and seams, with the weave for a little tooth
    const flat = dressed * 0.93;
    const sx = slope(o, 1), sy = slope(o, TEX);
    const len = Math.hypot(sx, sy, 1);
    const fx = 128 + (127 * -sx) / len + (weave - 0.5) * 9, fy = 128 + (127 * sy) / len + (hash(y, x) - 0.5) * 7, fz = 128 + 127 / len;
    nr += (fx - nr) * flat; ng += (fy - ng) * flat; nb += (fz - nb) * flat;
    rgh = rgh * (1 - dressed) + 236 * tint;
    if (zip) { r = 44; g = 44; b = 46; rgh = 96; }
    if (bt > 0.001) {
      // leather. Boots: dark, a lighter cuff at the top, near-black soles. Work gloves (the
      // only leather above the knee): browner, scuffed paler across the knuckles and fingers.
      const glove = Y > 0.8 ? 1 : 0;
      const sole = smooth(0.04, 0.022, Y);
      const cuff = band(Y, 0.3, 0.335);
      const lace = Z > 0.0 && Y > 0.07 && Y < 0.3 && Math.abs(ax - 0.114) < 0.022 && Math.sin(Y * 190) > 0.55 ? 1 : 0;
      const scuff = glove * (0.05 + 0.05 * vnoise(x / 7, y / 7)) * smooth(0.72, 0.8, ax);
      const l = (0.115 + 0.03 * (worn - 0.5) + 0.03 * cuff + 0.1 * lace + 0.045 * glove + scuff) * (1 - 0.7 * sole);
      r += 255 * l * (glove ? 1.2 : 1.08) * bt; g += 255 * l * 0.96 * bt; b += 255 * l * (glove ? 0.74 : 0.84) * bt;
      rgh += (sole > 0.5 ? 230 : glove ? 185 : 150) * bt;
    }
    outBase[o3] = r; outBase[o3 + 1] = g; outBase[o3 + 2] = b;
    outNormal[o3] = nr; outNormal[o3 + 1] = ng; outNormal[o3 + 2] = nb;
    outMR[o3] = 255; outMR[o3 + 1] = rgh; outMR[o3 + 2] = 0;
    outMask[o3] = Math.round(255 * jk); outMask[o3 + 1] = Math.round(255 * tr); outMask[o3 + 2] = Math.round(255 * bt);
  }
}
const png = (buf) => sharp(buf, { raw: { width: TEX, height: TEX, channels: 3 } }).png().toBuffer();
const mat = prim.getMaterial();
mat.getBaseColorTexture().setImage(await png(outBase)).setMimeType('image/png').setURI('survivor_base.png');
mat.getNormalTexture().setImage(await png(outNormal)).setMimeType('image/png').setURI('survivor_normal.png');
mat.getMetallicRoughnessTexture().setImage(await png(outMR)).setMimeType('image/png').setURI('survivor_orm.png');
mat.setName('survivor_body').setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(false);
for (const m of root.listMaterials()) if (m !== mat) m.setDoubleSided(m.getName().includes('Hair'));
await fs.mkdir(OUT, { recursive: true });
// a look at what was painted, for whoever is tuning this (the folder is not shipped)
const PREVIEW = path.join(ROOT, 'assets-src', 'characters', 'preview');
await fs.mkdir(PREVIEW, { recursive: true });
await sharp(outBase, { raw: { width: TEX, height: TEX, channels: 3 } }).jpeg({ quality: 85 }).toFile(path.join(PREVIEW, 'survivor_base.jpg'));
if (!EMOTES && !INFECTED) await sharp(outMask, { raw: { width: TEX, height: TEX, channels: 3 } }).webp({ quality: 92, effort: 5 }).toFile(path.join(OUT, 'survivor_mask.webp'));

// ================================================================ 2. what it wears
// The body dressed above is not what is drawn any more: a suit made for another skeleton is
// brought onto this one (scripts/suit.mjs), head and all. The body is still built, because
// its skeleton is this character's and every movement below is fitted to it. (`--plain`
// keeps the old body and its hair, for looking at the two side by side.)
const PLAIN = process.argv.includes('--plain') || INFECTED;
let worn = '';
if (PLAIN) {
  for (const [name, file] of Object.entries(HAIR)) {
    const h = await io.read(path.join(SRC, 'hair', `${file}.gltf`));
    const before = new Set(root.listNodes());
    mergeDocuments(doc, h);
    for (const n of root.listNodes()) {
      if (before.has(n)) continue;
      if (n.getMesh()) {
        n.setName(name);
        if (HAIR_SHIFT[name]) n.setTranslation(HAIR_SHIFT[name]);
        for (const p of n.getMesh().listPrimitives()) for (const s of p.listSemantics()) if (/^(COLOR_|TEXCOORD_[1-9])/.test(s)) p.setAttribute(s, null);
        root.listScenes()[0].addChild(n);
      }
    }
  }
  // everything ended up in one scene; drop the extra ones the merge brought along
  for (const s of root.listScenes().slice(1)) s.dispose();
  nodes.get('Eyebrows')?.setName('eyebrows');
  nodes.get('Eyes')?.setName('eyes');
  bodyNode.setName('body');
} else {
  worn = await wearSuit({ doc, io, bodyNode, dir: path.join(ROOT, 'assets-src', 'models', 'tactical_suit'), old: [nodes.get('Eyebrows'), nodes.get('Eyes')] });
}

// ================================================================ 3. animations
const libNodes = new Map(lib.getRoot().listNodes().map((n) => [n.getName(), n]));
const libJoints = lib.getRoot().listSkins()[0].listJoints();
const parentOf = (docRoot) => { const m = new Map(); for (const n of docRoot.listNodes()) for (const c of n.listChildren()) m.set(c, n); return m; };
const libParent = parentOf(lib.getRoot()), myParent = parentOf(root);
/** world rotation of every joint given local rotations (a Map node -> quat); anything not given is at rest */
const worldRot = (list, parent, local) => {
  const out = new Map();
  const get = (n) => {
    if (out.has(n)) return out.get(n);
    const p = parent.get(n);
    const q = local.get(n) ?? n.getRotation();
    const w = p ? qmul(get(p), q) : q;
    out.set(n, w);
    return w;
  };
  for (const n of list) get(n);
  return out;
};
const pairs = libJoints.map((j) => [j, nodes.get(boneMap(j.getName()) ?? '')]).filter(([, t]) => t);
const libRest = worldRot(libJoints, libParent, new Map());
const myRest = worldRot(pairs.map(([, t]) => t), myParent, new Map());
const hipsA = libNodes.get('DEF-hips'), hipsB = nodes.get('pelvis');
const legScale = hipsB.getTranslation()[2] / hipsA.getTranslation()[2];
// children after parents, so a parent's new world rotation exists when its child needs it
const depth = (n) => { let d = 0; for (let p = myParent.get(n); p; p = myParent.get(p)) d++; return d; };
pairs.sort((a, b) => depth(a[1]) - depth(b[1]));
const mine = pairs.map(([, b]) => b);
const under = new Map(mine.map((n) => [n, mine.filter((m) => { for (let p = m; p; p = myParent.get(p)) if (p === n) return true; return false; })]));

// ---- small vector helpers for posing
const qrot = (q, v) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const vnorm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** the shortest turn that takes unit vector a to unit vector b */
const qbetween = (a, b) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 0.999999) return [0, 0, 0, 1];
  return qnorm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + d]);
};
const rootQ = myRest.get(myParent.get(hipsB)) ?? worldRot([myParent.get(hipsB)], myParent, new Map()).get(myParent.get(hipsB));
const B = (name) => nodes.get(name);
const FINGERS = mine.filter((n) => /^(index|middle|ring|pinky|thumb)_/.test(n.getName()));
const restFootY = wpos('foot_l')[1];

/**
 * The library's poses are drawn for a brawler: a wide, staggered stance, arms held off the
 * body, fists. These ease a pose (world rotations in `wb`, hip position in `hip`) toward
 * how an ordinary person carries themselves.
 */
const poser = (wb, hip) => {
  const turn = (node, q) => { for (const d of under.get(node)) wb.set(d, qnorm(qmul(q, wb.get(d)))); };
  const P = {
    /** this bone, and everything hanging off it, part of the way back to how it stands at rest */
    toRest(name, k) {
      const n = B(name), cur = wb.get(n);
      turn(n, qmul(qslerp(cur, myRest.get(n), k), qinv(cur)));
    },
    /** part of the way back to its rest angle against its parent (a finger uncurling) */
    uncurl(n, k) {
      const pw = wb.get(myParent.get(n)), cur = wb.get(n);
      const local = qmul(qinv(pw), cur);
      turn(n, qmul(qmul(pw, qslerp(local, n.getRotation(), k)), qinv(cur)));
    },
    /** swing a bone so it points more nearly along `dir` (the bone runs toward `child`) */
    point(name, child, dir, k) {
      const n = B(name), along = vnorm(B(child).getTranslation());
      const cur = qrot(wb.get(n), along), want = vnorm(dir);
      turn(n, qbetween(cur, vnorm([cur[0] + (want[0] - cur[0]) * k, cur[1] + (want[1] - cur[1]) * k, cur[2] + (want[2] - cur[2]) * k])));
    },
    openHands(k) {
      for (const f of FINGERS) P.uncurl(f, k);
    },
    /**
     * Arms hanging at the sides, a little bend at the elbow. They hang off the body, not down
     * it: what is worn is a padded jacket over baggy trousers, a hand's breadth wider than the
     * body under it, and an arm let straight down from the shoulder hangs inside the cloth.
     */
    hangArms(k) {
      for (const [s, sx] of [['l', 1], ['r', -1]]) {
        P.toRest(`clavicle_${s}`, k * 0.6);
        P.point(`upperarm_${s}`, `lowerarm_${s}`, [0.27 * sx, -0.96, 0.03], k);
        P.point(`lowerarm_${s}`, `hand_${s}`, [0.1 * sx, -0.96, 0.24], k);
        P.uncurl(B(`hand_${s}`), k * 0.6);
      }
    },
    /** arms closer to the ribs without changing how they swing */
    tuckArms(angle) {
      for (const [s, sx] of [['l', 1], ['r', -1]]) {
        const h = -angle * sx * 0.5;
        turn(B(`upperarm_${s}`), [0, 0, Math.sin(h), Math.cos(h)]); // about the way the body faces
      }
    },
    /** elbows less bent: the forearm part of the way back into line with the upper arm */
    unbend(k) {
      for (const s of ['l', 'r']) P.point(`lowerarm_${s}`, `hand_${s}`, qrot(wb.get(B(`upperarm_${s}`)), vnorm(B(`lowerarm_${s}`).getTranslation())), k);
    },
    /** feet under the hips, legs nearly straight, and the hips at the height that leaves the feet on the ground */
    stand(k) {
      P.toRest('pelvis', k);
      for (const s of ['l', 'r']) for (const b of ['thigh', 'calf', 'foot', 'ball']) P.toRest(`${b}_${s}`, k);
      const w = qrot(rootQ, hip), rest = qrot(rootQ, hipsB.getTranslation());
      w[0] += (rest[0] - w[0]) * k; w[2] += (rest[2] - w[2]) * k;
      const footY = (s) => {
        let p = [0, w[1], 0];
        for (const [bone, child] of [['pelvis', 'thigh'], ['thigh', 'calf'], ['calf', 'foot']]) {
          const d = qrot(wb.get(B(bone === 'pelvis' ? 'pelvis' : `${bone}_${s}`)), B(`${child}_${s}`).getTranslation());
          p = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        }
        return p[1];
      };
      w[1] += restFootY - (footY('l') + footY('r')) / 2;
      const back = qrot(qinv(rootQ), w);
      hip[0] = back[0]; hip[1] = back[1]; hip[2] = back[2];
    },
    /** turn a bone, and everything hanging off it, by a rotation given in the world */
    spin(name, q) {
      turn(B(name), q);
    },
    /** the hips part of the way to the height they stand at */
    hipHeight(k) {
      const w = qrot(rootQ, hip), rest = qrot(rootQ, hipsB.getTranslation());
      w[1] += (rest[1] - w[1]) * k;
      const back = qrot(qinv(rootQ), w);
      hip[0] = back[0]; hip[1] = back[1]; hip[2] = back[2];
    },
    /** a straighter back and a level head */
    upright(k) {
      for (const b of ['spine_01', 'spine_02', 'spine_03']) P.toRest(b, k);
      P.toRest('neck_01', k * 0.7);
      P.toRest('Head', k * 0.7);
    },
  };
  return P;
};
/** what is done to each clip after it is transferred */
const TOUCH_UP = {
  // (Walking and running, the arms were tucked in to the ribs by a fifth of a radian: that was
  // for a body in a shirt, and in this jacket they swung through it. They are left nearly as
  // the library drew them, which is clear of it.)
  idle: (p) => { p.stand(0.72); p.upright(0.8); p.hangArms(0.9); p.openHands(0.6); },
  walk: (p) => { p.tuckArms(0.04); p.upright(0.35); p.unbend(0.4); p.openHands(0.55); },
  run: (p) => { p.tuckArms(0.04); p.openHands(0.4); },
  crouchIdle: (p) => { p.openHands(0.5); },
  crouchWalk: (p) => { p.openHands(0.5); },
  // the game lifts the body through a jump: here the hips stay at standing height and the legs come up under them
  jumpStart: (p, t) => { p.openHands(0.5); p.hipHeight(smooth(0.02, 0.2, t)); },
  jumpLoop: (p) => { p.openHands(0.5); },
  jumpLand: (p) => { p.openHands(0.5); },
  death: (p) => { p.openHands(0.6); },
  hit: (p) => { p.openHands(0.5); },
  hitHead: (p) => { p.openHands(0.5); },
};

const FPS = 30;
let total = 0;
/** how each clip stands on its first frame: the poses the made-up clips below are built from */
const firstPose = {};
/** world rotations of one frame -> each bone's rotation against its parent, into the clip's tracks */
const toLocal = (wb, rot, f) => {
  for (const b of mine) {
    const p = myParent.get(b);
    const pw = p ? wb.get(p) ?? worldRot([p], myParent, new Map()).get(p) : [0, 0, 0, 1];
    rot.get(b).set(qnorm(qmul(qinv(pw), wb.get(b))), f * 4);
  }
};
const writeClip = (name, times, rot, hip, dur) => {
  const frames = times.length;
  // keep each quaternion on the same side as the one before it, or interpolation takes the long way round
  for (const arr of rot.values()) {
    for (let f = 1; f < frames; f++) {
      const o = f * 4, q = o - 4;
      if (arr[o] * arr[q] + arr[o + 1] * arr[q + 1] + arr[o + 2] * arr[q + 2] + arr[o + 3] * arr[q + 3] < 0) for (let k = 0; k < 4; k++) arr[o + k] = -arr[o + k];
    }
  }
  const anim = doc.createAnimation(name);
  const input = doc.createAccessor(`${name}_t`).setType('SCALAR').setArray(times);
  const add = (node, pathName, type, array) => {
    const s = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType(type).setArray(array)).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(s));
  };
  for (const [node, arr] of rot) add(node, 'rotation', 'VEC4', arr);
  add(hipsB, 'translation', 'VEC3', hip);
  total += dur;
};
for (const [name, source] of Object.entries(CLIPS)) {
  const clip = lib.getRoot().listAnimations().find((a) => a.getName() === source);
  if (!clip) { console.log('missing clip', source); continue; }
  const tracks = clip.listChannels().map((ch) => {
    const s = ch.getSampler();
    return { node: ch.getTargetNode(), path: ch.getTargetPath(), t: s.getInput().getArray(), v: s.getOutput().getArray(), size: s.getOutput().getElementSize() };
  }).filter((tr) => tr.node && (tr.path === 'rotation' || (tr.path === 'translation' && tr.node === hipsA)));
  const dur = Math.max(...tracks.map((tr) => tr.t[tr.t.length - 1]));
  const frames = Math.max(2, Math.round(dur * FPS) + 1);
  const times = new Float32Array(frames);
  const rot = new Map(mine.map((t) => [t, new Float32Array(frames * 4)]));
  const hip = new Float32Array(frames * 3);
  const sample = (tr, time) => {
    const { t, v, size } = tr;
    let i = 0;
    while (i < t.length - 2 && t[i + 1] < time) i++;
    const span = t[i + 1] - t[i];
    const k = t.length < 2 ? 0 : Math.min(1, Math.max(0, span > 0 ? (time - t[i]) / span : 0));
    const a = Array.from(v.subarray(i * size, i * size + size));
    if (t.length < 2) return a;
    const b = Array.from(v.subarray((i + 1) * size, (i + 1) * size + size));
    return size === 4 ? qslerp(a, b, k) : a.map((x, j) => x + (b[j] - x) * k);
  };
  for (let f = 0; f < frames; f++) {
    const time = (times[f] = Math.min(dur, f / FPS));
    const local = new Map();
    let hipT = hipsA.getTranslation();
    for (const tr of tracks) {
      if (tr.path === 'rotation') local.set(tr.node, sample(tr, time));
      else hipT = sample(tr, time);
    }
    // The same turn away from rest, measured in the world, applied to this skeleton's rest:
    // limbs end up pointing where the library's do even though the two rest poses differ.
    const wa = worldRot(libJoints, libParent, local);
    const wb = new Map();
    for (const [a, b] of pairs) wb.set(b, qnorm(qmul(qmul(wa.get(a), qinv(libRest.get(a))), myRest.get(b))));
    const r0 = hipsA.getTranslation(), b0 = hipsB.getTranslation();
    const at = [0, 0, 0];
    for (let k = 0; k < 3; k++) at[k] = b0[k] + (hipT[k] - r0[k]) * legScale;
    TOUCH_UP[name]?.(poser(wb, at), time);
    if (f === 0) firstPose[name] = { wb: new Map(wb), at: [...at] };
    toLocal(wb, rot, f);
    hip.set(at, f * 3);
  }
  writeClip(name, times, rot, hip, dur);
}

// ---------------------------------------------------------------- deaths the library does not have
// It has one: thrown onto the back. These two are built from poses instead: the knees go
// (the crouch), and the body pitches onto its face, or folds over onto its side. The lying
// pose is the body as it stands at rest, laid over, with every limb then pointed where it
// should lie; all of that is in the plane of the ground, so nothing ends up under it.
{
  const axisQ = (ax, ang) => { const h = ang / 2, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
  const lying = (base, shape) => {
    const wb = new Map(mine.map((b) => [b, qnorm(qmul(base, myRest.get(b)))]));
    shape(poser(wb, [0, 0, 0]));
    return wb;
  };
  const limb = (P, part, next, dir) => P.point(part, next, dir, 1);
  const DEATHS = {
    // face down, head the way it was facing, one arm thrown up past the head and one down by the hip
    deathFront: {
      hip: [0, 0.12, 0.9],
      wb: lying(axisQ([1, 0, 0], Math.PI / 2), (P) => {
        limb(P, 'upperarm_l', 'lowerarm_l', [0.78, -0.1, 0.62]);
        limb(P, 'lowerarm_l', 'hand_l', [-0.25, -0.1, 0.96]);
        limb(P, 'upperarm_r', 'lowerarm_r', [-0.86, -0.1, -0.5]);
        limb(P, 'lowerarm_r', 'hand_r', [-0.4, -0.08, -0.91]);
        limb(P, 'thigh_l', 'calf_l', [0.17, 0, -0.985]);
        limb(P, 'calf_l', 'foot_l', [0.08, -0.04, -0.99]);
        limb(P, 'thigh_r', 'calf_r', [-0.36, 0, -0.93]);
        limb(P, 'calf_r', 'foot_r', [0.16, -0.04, -0.985]);
        limb(P, 'foot_l', 'ball_l', [0.25, 0.08, -0.96]);
        limb(P, 'foot_r', 'ball_r', [-0.3, 0.08, -0.95]);
        P.spin('Head', axisQ([0, 0, 1], 1.05));
        P.openHands(0.8);
      }),
      // how far into the crouch the knees get before the body is past saving, and when it lands
      buckle: 0.8, fall: [0.16, 0.74],
    },
    // on its left side, knees drawn up, the arms in front of the chest
    deathSide: {
      hip: [0.36, 0.17, 0.04],
      wb: lying(axisQ([0, 0, 1], -Math.PI / 2), (P) => {
        limb(P, 'thigh_l', 'calf_l', [-0.6, 0, 0.8]);
        limb(P, 'calf_l', 'foot_l', [-0.72, 0, -0.69]);
        limb(P, 'thigh_r', 'calf_r', [-0.8, -0.08, 0.6]);
        limb(P, 'calf_r', 'foot_r', [-0.86, -0.14, -0.49]);
        limb(P, 'upperarm_l', 'lowerarm_l', [0.12, -0.06, 0.99]);
        limb(P, 'lowerarm_l', 'hand_l', [0.72, 0, 0.69]);
        limb(P, 'upperarm_r', 'lowerarm_r', [-0.3, -0.46, 0.84]);
        limb(P, 'lowerarm_r', 'hand_r', [0.12, -0.6, 0.79]);
        P.spin('Head', axisQ([0, 0, 1], -0.38));
        P.spin('spine_02', axisQ([0, 1, 0], 0.16));
        P.openHands(0.7);
      }),
      buckle: 0.9, fall: [0.2, 0.82],
    },
  };
  const p0 = firstPose.idle, p1 = firstPose.crouchIdle;
  for (const [name, d] of Object.entries(DEATHS)) {
    const dur = 1.5;
    const frames = Math.round(dur * FPS) + 1;
    const times = new Float32Array(frames);
    const rot = new Map(mine.map((t) => [t, new Float32Array(frames * 4)]));
    const hip = new Float32Array(frames * 3);
    const end = qrot(qinv(rootQ), d.hip);
    for (let f = 0; f < frames; f++) {
      const t = (times[f] = f / FPS);
      const a = smooth(0, 0.3, t) * d.buckle;
      // it tips slowly and lands fast
      const b = Math.pow(Math.min(1, Math.max(0, (t - d.fall[0]) / (d.fall[1] - d.fall[0]))), 2.1);
      const wb = new Map();
      for (const bone of mine) wb.set(bone, qslerp(qslerp(p0.wb.get(bone), p1.wb.get(bone), a), d.wb.get(bone), b));
      toLocal(wb, rot, f);
      for (let k = 0; k < 3; k++) {
        const mid = p0.at[k] + (p1.at[k] - p0.at[k]) * a;
        hip[f * 3 + k] = mid + (end[k] - mid) * b;
      }
    }
    writeClip(name, times, rot, hip, dur);
  }
}

// ================================================================ 4. write
await doc.transform(
  unpartition(),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 90 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const dest = EMOTES ? path.join(ROOT, 'trailer', 'emotes.glb') : path.join(OUT, INFECTED ? 'infected.glb' : 'survivor.glb');
await io.write(dest, doc);
// asset addresses carry the manifest's date: move it on, so no browser keeps the old body
if (!EMOTES && !INFECTED) {
  const file = path.join(ROOT, 'public', 'assets', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.generated = new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(manifest, null, 1));
}
const st = await fs.stat(dest);
const triangles = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
if (worn) console.log(worn);
console.log(`${path.basename(dest)}  ${(st.size / 1048576).toFixed(2)} MB  ${Math.round(triangles)} triangles  ${root.listAnimations().length} clips (${total.toFixed(1)} s)  bones matched ${pairs.length}/${libJoints.length}`);
