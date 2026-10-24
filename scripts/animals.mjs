// The animals' models (2026-10-23), brought in whole: skin, skeleton and the movements the game plays, which the props'
// way (scripts/props.mjs) throws away. `node scripts/animals.mjs <id> [<id> ...] [--force]`, then `node scripts/lean.mjs`.
//
// Each comes out standing on y = 0 about its own middle, nose toward -z (as a person faces), so many metres from nose
// to tail, its pictures at no more than 2048 a side (the owner: "2048 should be our max for new models"). Of the
// movements it came with, only those the game plays are kept, under the game's names for them (src/game/animals.ts:
// idle, graze, walk, trot, run, alert, rest, swipe, bite, roar, hit, death, drink); a download whose movements are one
// long take keeps the take, and the times it is cut at are written beside it in the manifest (`cuts`).
//
// Settings, ANIMAL_MODELS below:
//   dir    – its download, unpacked under assets-src/models/
//   len    – metres nose to tail
//   rot    – turns that put it upright and nose to -z, radians about x, then y, then z
//   clips  – { game name: what its own movement is called (a regular expression) }
//   cuts   – or: { game name: [from, to] seconds of its one take }
//   tex    – the most pixels a side of its pictures

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, textureCompress, meshopt, getBounds, metalRough, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { creditOf } from './props.mjs';

// (WildMesh's three, each with its own movements by name: the owner, 2026-10-23, "just make sure its high quality")
const WILDMESH_DEER = {
  idle: /^Stand_Breathing_01$/, graze: /^Stand_Eating_01$/, walk: /^Walk$/, trot: /^Trot$/, run: /^Run$/,
  rest: /^Lying_Breathing_01$/, hit: /^Hit_Stand_L01$/, death: /^Death_Stand_R01$/,
};
export const ANIMAL_MODELS = {
  animal_stag: { dir: 'animal_elk_wildmesh', len: 2.1, rot: [0, Math.PI, 0], clips: { ...WILDMESH_DEER, alert: /^Take 001$/ } },
  animal_doe: { dir: 'animal_doe_wildmesh', len: 1.8, rot: [0, Math.PI, 0], clips: { ...WILDMESH_DEER, alert: /^Stand_Idle_02$/ } },
  animal_bear: {
    dir: 'animal_bear_wildmesh', len: 2.3, rot: [0, Math.PI, 0],
    clips: {
      idle: /^Stand_Idle_01$/, graze: /^Stand_Eating_01$/, walk: /^Walk$/, trot: /^Trot$/, run: /^Run$/, alert: /^StandAngry_Breathing_01$/,
      rest: /^Lying_Idle_01$/, swipe: /^Attack_StandAngry_01_High$/, bite: /^Attack_StandAngry_01_Low$/, roar: /^Attack_StandAngry_02_High$/,
      hit: /^Hit_Stand_F01$/, death: /^Death_Stand_R01$/,
    },
  },
  // (five movements only: no gait, so a farm's cows stand in their yard, src/sim/animals.ts)
  animal_cow: { dir: 'animal_cow_rukh3d', len: 2.3, rot: [0, Math.PI, 0], clips: { idle: /idle1$/, graze: /idle2$/, death: /Death$/ } },
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = process.env.ASSETS_SRC ?? path.join(ROOT, 'assets-src'), OUT = path.join(ROOT, 'public', 'assets');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ids.length) throw new Error('name what to build: ' + Object.keys(ANIMAL_MODELS).join(', '));
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const countTris = (doc) => Math.round(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0));
const quat = ([x, y, z]) => {
  // (turns about x, then y, then z, as one quaternion)
  const q = (ax, a) => [ax[0] * Math.sin(a / 2), ax[1] * Math.sin(a / 2), ax[2] * Math.sin(a / 2), Math.cos(a / 2)];
  const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  return mul(q([0, 0, 1], z), mul(q([0, 1, 0], y), q([1, 0, 0], x)));
};

/**
 * Its bounds as it stands, skin and all: a skinned mesh's points are where its skeleton puts them (each point by the
 * joints that carry it, as the game draws it), not where the mesh's own numbers say; for the downloads whose skeleton
 * is scaled (WildMesh's), those numbers made a bear three centimetres long.
 */
function skinnedBounds(doc, scene) {
  const skinned = doc.getRoot().listNodes().filter((n) => n.getMesh() && n.getSkin());
  if (!skinned.length) return getBounds(scene);
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of skinned) {
    const skin = node.getSkin(), ibm = skin.getInverseBindMatrices();
    const mats = skin.listJoints().map((j, i) => mul(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), js = prim.getAttribute('JOINTS_0'), ws = prim.getAttribute('WEIGHTS_0');
      if (!pos || !js || !ws) continue;
      const v = [], j = [], w = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        js.getElement(i, j);
        ws.getElement(i, w);
        const out = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          if (!w[k]) continue;
          const m = mats[j[k]];
          for (let r = 0; r < 3; r++) out[r] += w[k] * (m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
        }
        for (let r = 0; r < 3; r++) {
          min[r] = Math.min(min[r], out[r]);
          max[r] = Math.max(max[r], out[r]);
        }
      }
    }
  }
  return { min, max };
}

/**
 * How fast a gait goes over the ground, metres a second at the size it is made: its feet's own speed back under it
 * while they are down (a foot is down while it is at its lowest, and goes back as fast as the body goes on). The game
 * plays a gait at the animal's speed over this, so that no foot slides (src/game/animals.ts).
 */
/** where some joints are through a movement, `n` times a second: [joint][frame] = [x, y, z], and the frame's seconds */
function tracks(doc, anim, joints, n = 120) {
  const nodes = doc.getRoot().listNodes(), keep = new Map(nodes.map((nd) => [nd, [nd.getTranslation(), nd.getRotation(), nd.getScale()]]));
  const chans = anim.listChannels().map((c) => ({ node: c.getTargetNode(), path: c.getTargetPath(), t: c.getSampler().getInput().getArray(), v: c.getSampler().getOutput().getArray(), step: c.getSampler().getInterpolation() }));
  const end = Math.max(...chans.map((c) => c.t[c.t.length - 1]));
  const at = (c, time) => {
    const n = c.path === 'rotation' ? 4 : 3, cubic = c.step === 'CUBICSPLINE', w = cubic ? n * 3 : n, off = cubic ? n : 0;
    let i = c.t.findIndex((x) => x > time);
    if (i < 0) i = c.t.length;
    const i0 = Math.max(0, i - 1), i1 = Math.min(c.t.length - 1, i), k = i1 > i0 && c.step !== 'STEP' ? (time - c.t[i0]) / (c.t[i1] - c.t[i0]) : 0;
    const a = Array.from(c.v.slice(i0 * w + off, i0 * w + off + n)), b = Array.from(c.v.slice(i1 * w + off, i1 * w + off + n));
    if (n === 3) return a.map((x, j) => x + (b[j] - x) * k);
    // (rotations the short way round, renormalised)
    const dot = a.reduce((s2, x, j) => s2 + x * b[j], 0), sb = dot < 0 ? -1 : 1, q = a.map((x, j) => x + (sb * b[j] - x) * k), l = Math.hypot(...q);
    return q.map((x) => x / l);
  };
  const posed = (time) => {
    for (const c of chans) {
      const v = at(c, time);
      if (c.path === 'translation') c.node.setTranslation(v);
      else if (c.path === 'rotation') c.node.setRotation(v);
      else if (c.path === 'scale') c.node.setScale(v);
    }
  };
  const N = Math.max(30, Math.round(end * n)), out = joints.map(() => []);
  for (let f = 0; f <= N; f++) {
    posed((f / N) * end);
    joints.forEach((j, i) => out[i].push(j.getWorldTranslation()));
  }
  for (const [nd, [t, r, sc]] of keep) nd.setTranslation(t).setRotation(r).setScale(sc);
  return { out, dt: end / N };
}

function paceOf(doc, anim) {
  // its feet: the joints lowest in its rest pose, under a fifth of its height
  const joints = [...new Set(doc.getRoot().listSkins().flatMap((sk) => sk.listJoints()))];
  const ys = joints.map((j) => j.getWorldTranslation()[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  const feet = joints.filter((j, i) => ys[i] < lo + (hi - lo) * 0.2);
  const { out: tr0, dt } = tracks(doc, anim, feet), speeds = [];
  for (const tr of tr0) {
    const low = Math.min(...tr.map((p) => p[1]));
    for (let f = 1; f < tr.length; f++) {
      // (down: within two centimetres of its lowest; it faces -z, so a planted foot goes toward +z)
      if (tr[f][1] < low + 0.02 && tr[f - 1][1] < low + 0.02) speeds.push((tr[f][2] - tr[f - 1][2]) / dt);
    }
  }
  speeds.sort((x, y) => x - y);
  return speeds.length ? +speeds[speeds.length >> 1].toFixed(2) : null;
}

/**
 * A movement that carries the whole body (WildMesh's gaits walk their root 168 units on in a stride) walks on the spot
 * here: the game moves the animal itself, and a body carried on by its clip as well crept ahead and snapped back each
 * time round. The root's steady travel is taken out, its bob and sway kept; how fast it went, metres a second at the
 * size it is made, is the gait's pace (null: it went nowhere). A death keeps its travel (it falls where it falls).
 */
function inPlace(doc, anim) {
  // (any joint carried steadily on: the skin's own top joint stands still in WildMesh's, the one under it walks)
  const joints = new Set(doc.getRoot().listSkins().flatMap((sk) => sk.listJoints()));
  let pace = null;
  for (const c of anim.listChannels()) {
    if (c.getTargetPath() !== 'translation' || !joints.has(c.getTargetNode())) continue;
    const smp = c.getSampler(), t = smp.getInput().getArray(), out = smp.getOutput(), v = out.getArray().slice();
    const n = t.length, T = t[n - 1] - t[0], w = smp.getInterpolation() === 'CUBICSPLINE' ? 9 : 3, off = w === 9 ? 3 : 0;
    if (n < 2 || T <= 0) continue;
    const d = [0, 1, 2].map((k) => v[(n - 1) * w + off + k] - v[off + k]);
    // (in metres as it now stands: through the turn and scale of all above it)
    const m = c.getTargetNode().getParentNode()?.getWorldMatrix() ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const wd = [0, 1, 2].map((r) => m[r] * d[0] + m[4 + r] * d[1] + m[8 + r] * d[2]);
    const metres = Math.hypot(wd[0], wd[2]);
    if (metres / T < 0.05) continue;
    pace = Math.max(pace ?? 0, +(metres / T).toFixed(2));
    for (let i = 0; i < n; i++) for (const k of [0, 2]) v[i * w + off + k] -= d[k] * ((t[i] - t[0]) / T);
    out.setArray(v);
  }
  return pace;
}

/**
 * The moment a blow lands in its movement, seconds in: where what strikes (the front paws for a swipe, the head and
 * jaws for a bite) is furthest forward (it faces -z). The game starts the movement that long before the blow is dealt,
 * less the wind-up, so that the paw arrives with the damage (src/game/animals.ts).
 */
function strikeOf(doc, anim, part) {
  const joints = doc.getRoot().listSkins().flatMap((sk) => sk.listJoints()).filter((j) => part.test(j.getName()));
  if (!joints.length) return null;
  const { out, dt } = tracks(doc, anim, joints, 60);
  let best = 0, at = 0;
  for (let f = 0; f < out[0].length; f++) {
    const front = Math.max(...out.map((tr) => -tr[f][2]));
    if (f === 0 || front > best) [best, at] = [front, f];
  }
  return +(at * dt).toFixed(2);
}
const STRIKES = { swipe: /FLegDigit/, bite: /Jaw|Head/ };

const entries = {}, credits = [];
for (const id of ids) {
  const cfg = ANIMAL_MODELS[id];
  if (!cfg) throw new Error(`${id} is not an animal: ${Object.keys(ANIMAL_MODELS).join(', ')}`);
  const dir = path.join(SRC, 'models', cfg.dir);
  const doc = await io.read(path.join(dir, cfg.file ?? 'scene.gltf'));
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
  const root = doc.getRoot(), scene = root.listScenes()[0];
  const srcTris = countTris(doc);
  // the movements the game plays, under its names; the rest thrown away (keys and all)
  const anims = root.listAnimations(), kept = new Set();
  const drop = (a) => {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  };
  let cuts;
  if (cfg.cuts) {
    if (!anims.length) throw new Error(`${id}: it has no movement to cut`);
    anims[0].setName('take');
    kept.add(anims[0]);
    cuts = cfg.cuts;
  } else {
    for (const [name, re] of Object.entries(cfg.clips ?? {})) {
      const a = anims.find((x) => !kept.has(x) && re.test(x.getName()));
      if (!a) throw new Error(`${id}: no movement of it is called ${re} (it has: ${anims.map((x) => x.getName()).join(', ')})`);
      a.setName(name);
      kept.add(a);
    }
  }
  for (const a of anims) if (!kept.has(a)) drop(a);
  // upright and nose to -z under one piece of its own, then to size and stood on the ground about its middle
  const top = doc.createNode(id);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    top.addChild(child);
  }
  scene.addChild(top);
  top.setRotation(quat(cfg.rot ?? [0, 0, 0]));
  let b = skinnedBounds(doc, scene);
  const s = cfg.len / (b.max[2] - b.min[2]);
  top.setScale([s, s, s]);
  b = skinnedBounds(doc, scene);
  top.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
  b = skinnedBounds(doc, scene);
  // (each gait's own pace over the ground, measured as it now stands, scaled and turned: by its root's travel where
  // it was carried on, else by its feet; and every movement but its death walked on the spot)
  const paces = {}, strikes = {};
  for (const a of root.listAnimations()) {
    const carried = a.getName() === 'death' ? null : inPlace(doc, a);
    if (['walk', 'trot', 'run'].includes(a.getName())) paces[a.getName()] = carried ?? paceOf(doc, a);
    if (STRIKES[a.getName()]) strikes[a.getName()] = strikeOf(doc, a, STRIKES[a.getName()]);
  }
  await doc.transform(dedup(), prune({ keepLeaves: false }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex ?? 2048, cfg.tex ?? 2048], quality: 88 }), ...(process.env.ANIMAL_PLAIN ? [] : [meshopt({ encoder: MeshoptEncoder, level: 'medium' })]));
  const dest = path.join(OUT, 'models', `${id}.glb`);
  await io.write(dest, doc);
  const st = await fs.stat(dest);
  const clips = root.listAnimations().map((a) => a.getName());
  console.log(`animal ${id.padEnd(16)} ${srcTris} tris  ${(st.size / 1024).toFixed(0)} KB  ${b.max.map((v, k) => (v - b.min[k]).toFixed(2)).join(' x ')} m  [${clips.join(' ')}]  paces ${JSON.stringify(paces)}  strikes ${JSON.stringify(strikes)}`);
  entries[id] = { url: `assets/models/${id}.glb`, tags: ['animal'], bytes: st.size, tris: srcTris, min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)), lods: [], clips, ...(cuts ? { cuts } : {}), ...(Object.keys(paces).length ? { paces } : {}), ...(Object.keys(strikes).length ? { strikes } : {}) };
  credits.push({ id, ...(await creditOf(dir)), changes: `Kept whole with its skeleton and ${cuts ? 'its one take of movement (the game cuts it where its movements change)' : `the movements the game plays (${clips.join(', ')}), the others left out`}; turned nose to -z, scaled to ${cfg.len} m nose to tail and stood on the ground; textures re-encoded as WebP at no more than ${cfg.tex ?? 2048} a side; geometry compressed.` });
}

const file = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
Object.assign(manifest.models, entries);
manifest.generated = new Date().toISOString();
await fs.writeFile(file, JSON.stringify(manifest, null, 1));
const creditsPath = path.join(ROOT, 'CREDITS.md');
let text = await fs.readFile(creditsPath, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';
for (const c of credits) {
  if (!c.line) throw new Error(`${c.id}: no credit line in its licence`);
  if (text.includes(c.line)) continue;
  const at = text.indexOf(`${nl}- "Uaz-469"`);
  if (at < 0) throw new Error('CREDITS.md is not laid out as expected: add the credit by hand');
  text = `${text.slice(0, at)}${nl}- ${c.line}${nl}  Changes made: ${c.changes}${text.slice(at)}`;
  console.log(`${c.id}: credited in CREDITS.md`);
}
await fs.writeFile(creditsPath, text);
