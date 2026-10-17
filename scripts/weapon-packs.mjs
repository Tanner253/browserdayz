// First-person weapon packs (see WEAPON_PACKS in assets.config.mjs): each download is
// written out as the pack itself, for the hands of whoever holds the gun, and as the gun
// alone, standing still, for everywhere else it is seen.

import fs from 'node:fs/promises';
import path from 'node:path';
import { prune, weld, dedup, resample, textureCompress, meshopt, getBounds, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

// 4x4 matrices as glTF has them: sixteen numbers, a column at a time
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const move = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scaleBy = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
/**
 * `rename`: joints named in a way nothing here can read (the shotgun set's are Russian, written in a Windows code
 * page, not UTF-8) given names by how their names end: { '_049$': 'stock_049' }.
 */
const renamed = (doc, cfg) => {
  for (const [end, name] of Object.entries(cfg.rename ?? {})) for (const n of doc.getRoot().listNodes()) if (new RegExp(end).test(n.getName())) n.setName(name);
  return doc;
};
const point = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
const turn = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const round = (v, k = 1e5) => Math.round(v * k) / k;

/** Every animated node put where the pack's (first) animation has it on its first frame: the pose the gun is held in. */
function restPose(doc) {
  const anim = doc.getRoot().listAnimations()[0];
  if (!anim) return;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), out = ch.getSampler()?.getOutput();
    if (!node || !out) continue;
    const v = out.getElement(0, []);
    if (ch.getTargetPath() === 'translation') node.setTranslation(v);
    else if (ch.getTargetPath() === 'rotation') node.setRotation(v);
    else if (ch.getTargetPath() === 'scale') node.setScale(v);
  }
}

const named = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name);

/**
 * A pack that came with a movement to an animation (an idle, a shot, a reload, each its own) is made into what
 * the game plays: one long animation with every movement in it one after another, and where each begins and
 * ends. (See src/game/rig.ts.) A joint that one movement moves and another does not is held, through the other,
 * where the file has it standing. Keys are taken as they are (straight lines between them: what these were made
 * with), and a breath of nothing is left between one movement and the next so that neither is seen in the other.
 * @param order [what the game calls a movement, the animation's name in the file] in the order they are laid
 * @returns movement -> [first frame, last frame] at `fps`
 */
function joinAnimations(doc, order, fps) {
  const root = doc.getRoot();
  const byName = new Map(root.listAnimations().map((a) => [a.getName(), a]));
  const width = { translation: 3, rotation: 4, scale: 3 };
  const tracks = new Map();
  const clips = [];
  let t0 = 0;
  for (const [as, name] of order) {
    const a = byName.get(name);
    if (!a) throw new Error(`no animation called ${name} in the pack (it has: ${[...byName.keys()].join(', ')})`);
    let dur = 0;
    for (const ch of a.listChannels()) dur = Math.max(dur, ch.getSampler().getInput().getMax([])[0]);
    const here = new Map();
    for (const ch of a.listChannels()) {
      const node = ch.getTargetNode(), path = ch.getTargetPath(), sm = ch.getSampler();
      if (!node || !(path in width)) continue;
      if (sm.getInterpolation() === 'CUBICSPLINE') throw new Error(`${name}: its keys are curves, which this does not join`);
      const key = `${root.listNodes().indexOf(node)}|${path}`;
      if (!tracks.has(key)) tracks.set(key, { node, path, times: [], values: [] });
      here.set(key, { t: sm.getInput().getArray(), v: sm.getOutput().getArray() });
    }
    clips.push({ as, t0, dur, here });
    t0 += dur + 2 / fps;
  }
  const ranges = {};
  for (const c of clips) ranges[c.as] = [round(c.t0 * fps, 1e4), round((c.t0 + c.dur) * fps, 1e4)];
  for (const [key, tr] of tracks) {
    const n = width[tr.path];
    const still = tr.path === 'translation' ? tr.node.getTranslation() : tr.path === 'rotation' ? tr.node.getRotation() : tr.node.getScale();
    const push = (t, v, at) => {
      tr.times.push(t);
      for (let k = 0; k < n; k++) tr.values.push(v[at + k]);
    };
    for (const c of clips) {
      const h = c.here.get(key);
      if (!h) {
        push(c.t0, still, 0);
        push(c.t0 + c.dur, still, 0);
        continue;
      }
      const last = h.t.length - 1;
      if (h.t[0] > 1e-5) push(c.t0, h.v, 0);
      for (let i = 0; i <= last; i++) push(c.t0 + h.t[i], h.v, i * n);
      if (h.t[last] < c.dur - 1e-5) push(c.t0 + c.dur, h.v, last * n);
    }
  }
  for (const a of root.listAnimations()) {
    for (const ch of a.listChannels()) ch.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
  const buffer = root.listBuffers()[0];
  const all = doc.createAnimation('all');
  for (const tr of tracks.values()) {
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(tr.times)).setBuffer(buffer);
    const output = doc.createAccessor().setType(width[tr.path] === 4 ? 'VEC4' : 'VEC3').setArray(new Float32Array(tr.values)).setBuffer(buffer);
    const sm = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    all.addSampler(sm).addChannel(doc.createAnimationChannel().setTargetNode(tr.node).setTargetPath(tr.path).setSampler(sm));
  }
  return ranges;
}

/** A skinned shape as it stands on its skeleton now: [positions, normals, tangents, the joint each point mostly follows], per primitive. */
function standSkin(node, meshSpace = false) {
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  // (`meshSpace`: the shape's own node is laid on it first, as three.js lays it: the shotgun set's shapes are in
  // centimetres on a node a sixtieth of that, and stood without it the gun was 142 metres long)
  const J = joints.map((j, k) => {
    const m = mul(j.getWorldMatrix(), ibm.getElement(k, []));
    return meshSpace ? mul(m, node.getWorldMatrix()) : m;
  });
  return node.getMesh().listPrimitives().map((prim) => {
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT');
    const ji = prim.getAttribute('JOINTS_0'), jw = prim.getAttribute('WEIGHTS_0');
    const n = pos.getCount();
    const P = new Float32Array(n * 3), N = nor ? new Float32Array(n * 3) : null, T = tan ? new Float32Array(n * 4) : null;
    const lead = new Array(n);
    const a = [], b = [], w = [], q = [];
    for (let i = 0; i < n; i++) {
      ji.getElement(i, a);
      jw.getElement(i, w);
      const m = new Array(16).fill(0);
      let best = 0;
      for (let k = 0; k < 4; k++) {
        if (w[k] > w[best]) best = k;
        if (w[k] > 0) for (let e = 0; e < 16; e++) m[e] += J[a[k]][e] * w[k];
      }
      lead[i] = joints[a[best]].getName();
      P.set(point(m, pos.getElement(i, b)), i * 3);
      if (N) {
        const v = turn(m, nor.getElement(i, b)), l = Math.hypot(...v) || 1;
        N.set(v.map((x) => x / l), i * 3);
      }
      if (T) {
        tan.getElement(i, q);
        const v = turn(m, q), l = Math.hypot(...v) || 1;
        T.set([v[0] / l, v[1] / l, v[2] / l, q[3]], i * 4);
      }
    }
    return { prim, P, N, T, lead };
  });
}

export { standSkin, mul, move, scaleBy, point };

/**
 * @returns the manifest entries this pack makes ({ id: entry }), and its credit
 */
const boxes = new Map();

export async function processWeaponPack(id, cfg, { io, SRC, OUT, FORCE, exists, countTris }) {
  const dir = path.join(SRC, 'models', cfg.dir);
  const gltfPath = path.join(dir, cfg.file);
  if (!(await exists(gltfPath))) throw new Error(`${id}: put its glTF download in assets-src/models/${cfg.dir}/ (${cfg.file} is not there)`);
  const fp = cfg.fp !== false;
  const dest = path.join(OUT, 'models', `${id}.glb`), destFp = path.join(OUT, 'models', `${id}_fp.glb`);
  const { credit, ...settings } = cfg;
  const stamp = JSON.stringify({ ...settings, v: 9 });
  const metaPath = path.join(dir, '_meta.json');
  let meta;
  if (!FORCE && (await exists(dest)) && (!fp || (await exists(destFp))) && (await exists(metaPath))) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.stamp !== stamp) meta = undefined;
  }
  if (!meta) {
    // ---- the gun alone, standing still
    const doc = renamed(await io.read(gltfPath), cfg);
    await doc.transform(prune({ keepLeaves: true }), weld());
    // (a gun on a skeleton stands as its skeleton was bound: its first movement may begin with it half apart)
    if (!cfg.skinned) restPose(doc);
    const root = doc.getRoot(), scene = root.listScenes()[0];
    const partOf = (node) => {
      for (let n = node; n; n = n.getParentNode()) if (n.getName() in (cfg.parts ?? {})) return cfg.parts[n.getName()];
      return null;
    };
    // what the gun is made of, as points in the pack's own space: [piece, positions (flat xyz)]
    const pieces = [];
    // (the skinned shape hangs on a node of its own: found by what it draws)
    // (a gun may be drawn as more than one shape on the one skeleton: its body, and a magazine by itself)
    const shapes = cfg.skinned ? [].concat(cfg.skinned.mesh) : [];
    const stood = cfg.skinned ? root.listNodes().filter((n) => n.getSkin() && shapes.some((m) => n.getMesh()?.getName().includes(m))).flatMap((n) => standSkin(n, cfg.meshSpace)) : null;
    if (stood) {
      for (const s of stood) {
        const of = s.lead.map((j) => (j in cfg.skinned.joints ? cfg.skinned.joints[j] : cfg.skinned.rest));
        pieces.push({ skin: s, of });
      }
    }
    // (rigid pieces: all of a gun that is not skinned, or, said in `parts` beside `skinned`, what of it is not: the
    // Barrett's scope and magazine stand on nodes of their own beside its skinned body)
    if (!stood || cfg.parts) {
      for (const n of root.listNodes()) {
        if (!n.getMesh() || n.getSkin()) continue;
        const piece = partOf(n);
        if (piece) pieces.push({ node: n, piece, world: n.getWorldMatrix() });
      }
    }
    if (!pieces.length) throw new Error(`${id}: none of the pieces named in its settings were found`);
    // its box in the pack's space: the long way is the barrel, the next longest is its height
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const grow = (p) => {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    };
    for (const pc of pieces) {
      if (pc.skin) {
        for (let i = 0; i < pc.of.length; i++) if (pc.of[i]) grow([pc.skin.P[i * 3], pc.skin.P[i * 3 + 1], pc.skin.P[i * 3 + 2]]);
      } else {
        const v = [];
        for (const prim of pc.node.getMesh().listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          for (let i = 0; i < pos.getCount(); i++) grow(point(pc.world, pos.getElement(i, v)));
        }
      }
    }
    const size = hi.map((v, k) => v - lo[k]), mid = hi.map((v, k) => (v + lo[k]) / 2);
    // (a gun that came with no hands is held in another pack's: it says itself which way it points, and is fitted to that pack's gun)
    if (!cfg.wrists && !(cfg.fit && cfg.forward && cfg.up)) throw new Error(`${id}: with no hands of its own it has to say which way it points (forward, up) and what it is fitted to (fit)`);
    const wristR = cfg.wrists ? named(doc, cfg.wrists.right).getWorldTranslation() : [0, 0, 0], wristL = cfg.wrists ? named(doc, cfg.wrists.left).getWorldTranslation() : [0, 0, 0];
    const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
    const axis = (k, sign) => [0, 1, 2].map((i) => (i === k ? sign : 0));
    // the hand is at the back of the gun and under it
    const f = cfg.forward ?? axis(order[0], Math.sign(mid[order[0]] - wristR[order[0]]) || 1);
    const u = cfg.up ?? axis(order[1], Math.sign(mid[order[1]] - wristR[order[1]]) || 1);
    const r = cross(f, u);
    const s = cfg.scale ?? cfg.length / size[order[0]];
    // the pack's space -> the gun's own: x along the barrel, y up, z to its right, in metres
    let B = mul(scaleBy(s), [f[0], u[0], r[0], 0, f[1], u[1], r[1], 0, f[2], u[2], r[2], 0, 0, 0, 0, 1]);
    if (cfg.level) {
      // which way the piece is longest (the direction its points are most spread along), seen from the muzzle
      const pts = [];
      for (const pc of pieces) {
        if (pc.skin) {
          for (let i = 0; i < pc.of.length; i++) if (pc.of[i] === cfg.level) pts.push(point(B, [pc.skin.P[i * 3], pc.skin.P[i * 3 + 1], pc.skin.P[i * 3 + 2]]));
        } else if (pc.piece === cfg.level) {
          const v = [];
          for (const prim of pc.node.getMesh().listPrimitives()) {
            const pos = prim.getAttribute('POSITION');
            for (let i = 0; i < pos.getCount(); i++) pts.push(point(B, point(pc.world, pos.getElement(i, v))));
          }
        }
      }
      const mean = [0, 1, 2].map((k) => pts.reduce((a, p) => a + p[k], 0) / pts.length);
      const cov = [0, 1, 2].map((a) => [0, 1, 2].map((b) => pts.reduce((sum, p) => sum + (p[a] - mean[a]) * (p[b] - mean[b]), 0)));
      let d = [0.2, 1, 0.2];
      for (let it = 0; it < 60; it++) {
        d = cov.map((row) => row[0] * d[0] + row[1] * d[1] + row[2] * d[2]);
        const l = Math.hypot(...d);
        d = d.map((x) => x / l);
      }
      if (d[1] < 0) d = d.map((x) => -x);
      const roll = Math.atan2(d[2], d[1]);
      const c = Math.cos(-roll), sn = Math.sin(-roll);
      B = mul([1, 0, 0, 0, 0, c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1], B);
      console.log(`  ${id}: rolled ${((roll * 180) / Math.PI).toFixed(1)} degrees about its barrel to stand it up`);
    }
    if (cfg.trim) {
      // What is left once it stands: how its slide still lies, in degrees (nose to the right,
      // nose up, right side up). The slide's own length and its own right are made the gun's.
      const t = (deg) => Math.tan(((deg ?? 0) * Math.PI) / 180);
      const unit = (v) => v.map((x) => x / Math.hypot(...v));
      const e1 = unit([1, t(cfg.trim.pitch), t(cfg.trim.yaw)]);
      const b = [0, t(cfg.trim.roll), 1];
      const k = b[0] * e1[0] + b[1] * e1[1] + b[2] * e1[2];
      const e3 = unit(b.map((v, i) => v - k * e1[i]));
      const e2 = cross(e3, e1);
      B = mul([e1[0], e2[0], e3[0], 0, e1[1], e2[1], e3[1], 0, e1[2], e2[2], e3[2], 0, 0, 0, 0, 1], B);
    }
    // each piece's box along the gun's own axes (not yet set down anywhere)
    const pieceBox = new Map();
    const into = (piece, p) => {
      if (!pieceBox.has(piece)) pieceBox.set(piece, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      const b = pieceBox.get(piece), q = point(B, p);
      for (let k = 0; k < 3; k++) {
        b.min[k] = Math.min(b.min[k], q[k]);
        b.max[k] = Math.max(b.max[k], q[k]);
      }
    };
    for (const pc of pieces) {
      if (pc.skin) {
        for (let i = 0; i < pc.of.length; i++) if (pc.of[i]) into(pc.of[i], [pc.skin.P[i * 3], pc.skin.P[i * 3 + 1], pc.skin.P[i * 3 + 2]]);
      } else {
        const v = [];
        for (const prim of pc.node.getMesh().listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          for (let i = 0; i < pos.getCount(); i++) into(pc.piece, point(pc.world, pos.getElement(i, v)));
        }
      }
    }
    // A piece drawn lying beside the gun, for show (a brake under the muzzle its suppressor is on): put where the
    // piece that takes its place is, its back end on that one's and its middle on that one's.
    const shift = new Map();
    for (const [piece, onto] of Object.entries(cfg.put ?? {})) {
      const a = pieceBox.get(piece), b = pieceBox.get(onto);
      if (!a || !b) throw new Error(`${id}: ${piece} is to be put on ${onto}, and one of them is not there`);
      const d = [b.min[0] - a.min[0], (b.min[1] + b.max[1] - a.min[1] - a.max[1]) / 2, (b.min[2] + b.max[2] - a.min[2] - a.max[2]) / 2];
      shift.set(piece, d);
      for (let k = 0; k < 3; k++) {
        a.min[k] += d[k];
        a.max[k] += d[k];
      }
    }
    // the back of a piece, the top of it, the middle of its width
    const mark = (b) => [b.min[0], b.max[1], (b.min[2] + b.max[2]) / 2];
    let at, holds;
    if (cfg.fit) {
      const other = boxes.get(cfg.fit.to);
      if (!other) throw new Error(`${id}: it is fitted to ${cfg.fit.to}, which has to be made first`);
      const mine = mark(pieceBox.get(cfg.fit.piece)), theirs = mark(other.pieces[cfg.fit.piece]);
      at = mine.map((v, k) => v - theirs[k]);
      holds = other.holds;
    } else at = point(B, wristR).map((v, k) => v + cfg.origin[k]);
    // (A thing drawn over life-size, for a pack's hands that are over life-size too, is in those hands as it was
    // drawn. Alone, where it lies on the ground and is held in a fist of true size, it is made as long as such a
    // thing is: `aloneLength`, metres along its longest side.)
    let own = 1;
    if (cfg.aloneLength) {
      const all = [...pieceBox.values()];
      own = cfg.aloneLength / Math.max(...[0, 1, 2].map((k) => Math.max(...all.map((b) => b.max[k])) - Math.min(...all.map((b) => b.min[k]))));
    }
    const A = mul(scaleBy(own), mul(move(-at[0], -at[1], -at[2]), B));
    holds ??= { right: point(A, wristR).map((v) => round(v)), left: point(A, wristL).map((v) => round(v)) };
    const set = Object.fromEntries([...pieceBox].map(([k, b]) => [k, { min: b.min.map((v, i) => round((v - at[i]) * own)), max: b.max.map((v, i) => round((v - at[i]) * own)) }]));

    const made = new Map();
    const put = (name, mesh) => {
      mesh.setName(name);
      const n = doc.createNode(made.has(name) ? `${name}_${made.get(name)}` : name).setMesh(mesh);
      made.set(name, (made.get(name) ?? 1) + 1);
      return n;
    };
    const nodes = [];
    for (const pc of pieces) {
      if (pc.node) {
        const mesh = pc.node.getMesh();
        if (mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) pc.node.setMesh(mesh.clone());
        const to = mul(A, pc.world);
        transformMesh(pc.node.getMesh(), shift.has(pc.piece) ? mul(move(...shift.get(pc.piece)), to) : to);
        nodes.push(put(pc.piece, pc.node.getMesh()));
        continue;
      }
      // a skinned gun: each triangle goes to the piece its first corner follows
      const { prim, P, N, T } = pc.skin;
      const idx = prim.getIndices(), uv = prim.getAttribute('TEXCOORD_0');
      const count = idx ? idx.getCount() : P.length / 3;
      const byPiece = new Map();
      for (let t = 0; t < count; t += 3) {
        const tri = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        const piece = pc.of[tri[0]];
        if (!piece) continue;
        if (!byPiece.has(piece)) byPiece.set(piece, { remap: new Map(), order: [], index: [] });
        const b = byPiece.get(piece);
        for (const v of tri) {
          if (!b.remap.has(v)) {
            b.remap.set(v, b.order.length);
            b.order.push(v);
          }
          b.index.push(b.remap.get(v));
        }
      }
      const buffer = root.listBuffers()[0];
      // (B with the size taken out of it: what turns a normal)
      const R = [B[0] / s, B[1] / s, B[2] / s, 0, B[4] / s, B[5] / s, B[6] / s, 0, B[8] / s, B[9] / s, B[10] / s, 0, 0, 0, 0, 1];
      for (const [piece, b] of byPiece) {
        const n = b.order.length;
        const p2 = new Float32Array(n * 3), n2 = N ? new Float32Array(n * 3) : null, t2 = T ? new Float32Array(n * 4) : null, uv2 = uv ? new Float32Array(n * 2) : null;
        const e = [];
        b.order.forEach((v, i) => {
          p2.set(point(A, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]), i * 3);
          if (n2) n2.set(turn(R, [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]), i * 3);
          if (t2) t2.set([...turn(R, [T[v * 4], T[v * 4 + 1], T[v * 4 + 2]]), T[v * 4 + 3]], i * 4);
          if (uv2) uv2.set(uv.getElement(v, e).slice(0, 2), i * 2);
        });
        const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
        const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setAttribute('POSITION', acc('VEC3', p2)).setIndices(acc('SCALAR', n > 65535 ? new Uint32Array(b.index) : new Uint16Array(b.index)));
        if (n2) np.setAttribute('NORMAL', acc('VEC3', n2));
        if (t2) np.setAttribute('TANGENT', acc('VEC4', t2));
        if (uv2) np.setAttribute('TEXCOORD_0', acc('VEC2', uv2));
        nodes.push(put(piece, doc.createMesh(piece).addPrimitive(np)));
      }
    }
    // (an animation let go of keeps its samplers, and they the data: each let go of first)
    for (const a of root.listAnimations()) {
      for (const c of a.listChannels()) c.dispose();
      for (const sm of a.listSamplers()) sm.dispose();
      a.dispose();
    }
    for (const child of scene.listChildren()) scene.removeChild(child);
    for (const n of root.listNodes()) if (!nodes.includes(n)) n.setMesh(null).setSkin(null);
    for (const sk of root.listSkins()) sk.dispose();
    for (const n of nodes) scene.addChild(n);
    // (what the animations and the skeleton were made of, held by nothing now: the Scorpion's, 1,069 joints in nine
    // movements, were 13,000 pieces of data and 50 MB left in a gun of 13,500 points, which prune let stand)
    for (const a of root.listAccessors()) if (a.listParents().every((p) => p === root)) a.dispose();
    await doc.transform(prune());
    const bounds = getBounds(scene);
    const tris = countTris(doc);
    // (seen on the ground and in other people's hands, the gun alone does with smaller pictures)
    const side = cfg.aloneTex ?? cfg.tex;
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [side, side], quality: 88 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await io.write(dest, doc);
    meta = {
      stamp,
      gun: { tris, min: bounds.min.map((v) => +v.toFixed(4)), max: bounds.max.map((v) => +v.toFixed(4)), holds, pieces: set },
      found: { forward: f, up: u, scale: +s.toFixed(6) },
    };

    // ---- the pack as it came: arms, gun and every movement, for the one holding it
    if (fp) {
      const whole = renamed(await io.read(gltfPath), cfg);
      // (The pack's own drawing of its gun is left out where the game hangs the gun alone on the pack's joints
      // instead, piece by piece: it was never drawn, and its pictures were fetched and unpacked all the same,
      // some hundreds of megabytes of them.)
      for (const name of cfg.fpDrop ?? []) named(whole, name)?.setMesh(null).setSkin(null);
      // (`ourArms`: the pack is held in our own arms (src/game/hands-on.ts), its own are never drawn. Its skeleton and
      // movements are all that is kept, and of the movements only what moves the arms, the hands, the gun and the
      // camera, and what those hang from: the face and the legs of its maker's whole body moved too, 738 tracks of it.)
      if (cfg.ourArms) {
        for (const n of whole.getRoot().listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null);
        const keep = new Set();
        const wantNode = new RegExp(`upper_?arm|forearm|lower_?arm|hand|palm|thumb|index|middle|ring|pinky|^(${[...Object.keys(cfg.skinned?.joints ?? {}), ...Object.keys(cfg.parts ?? {}), cfg.eye].filter(Boolean).join('|')})$`, 'i');
        const parentOf = new Map();
        for (const n of whole.getRoot().listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
        for (const n of whole.getRoot().listNodes()) if (wantNode.test(n.getName())) for (let p = n; p; p = parentOf.get(p)) keep.add(p);
        let cut = 0;
        for (const a of whole.getRoot().listAnimations()) for (const c of a.listChannels()) if (!keep.has(c.getTargetNode())) { c.getSampler()?.dispose(); c.dispose(); cut++; }
        console.log(`  ${id}: held in our arms; its own arms left out, ${cut} tracks of what they do not need`);
      }
      // (Arms that the game paints with another pack's pictures, the one pair every pack of that maker's is drawn
      // in: their own pictures would be fetched with the pack and never drawn, and are not kept in it.)
      if (cfg.fpBare) {
        for (const mat of whole.getRoot().listMaterials()) {
          if (new RegExp(cfg.fpBare, 'i').test(mat.getName())) mat.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
        }
      }
      const all = countTris(whole);
      // (movements said by the names of the pack's own animations: joined into the one the game plays, and said as frames of it)
      const byName = Object.values(cfg.clips).some((c) => typeof c === 'string');
      const clips = byName ? joinAnimations(whole, Object.entries(cfg.clips), cfg.fps) : cfg.clips;
      await whole.transform(
        dedup(),
        resample(),
        // (arms left with no pictures of their own keep where each picture goes on them: it is another pack's that is drawn there)
        prune(cfg.fpBare ? { keepAttributes: true } : cfg.ourArms ? { keepLeaves: true } : {}),
        ...(cfg.armsTex ? [textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: /arms/i, resize: [cfg.armsTex, cfg.armsTex], quality: 86 })] : []),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 88 }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
      await io.write(destFp, whole);
      // the pack's space -> the eye's: x to the right, y up, the muzzle away down -z, in metres
      // (A thing held across the picture, a knife: which way it points is not which way whoever holds it looks.
      // `look` says the second by itself; `forward` and `up` are then only how the thing alone is laid.)
      const vf = cfg.look?.forward ?? f, vu = cfg.look?.up ?? u, vr = cross(vf, vu);
      const view = mul(scaleBy(s), [vr[0], vu[0], -vf[0], 0, vr[1], vu[1], -vf[1], 0, vr[2], vu[2], -vf[2], 0, 0, 0, 0, 1]);
      // (`atEye`: a pack whose camera stands where its maker's character's head was, a metre and a half up, is
      // moved so that camera is the eye. The AK's and the submachine gun's stand within a hand of it and are left.)
      if (cfg.atEye) {
        const e = point(view, named(whole, cfg.eye).getWorldTranslation());
        for (let k = 0; k < 3; k++) view[12 + k] -= e[k];
      }
      meta.rig = {
        tris: all,
        fps: cfg.fps,
        clips,
        // (a gun on a skeleton: what is hung on its joints is hung by where they stand as the file has them, which is how the gun alone was made)
        ...(cfg.skinned ? { skinned: true } : {}),
        // (where the pack's own camera stands, if it has one: the eye it was drawn for, in the eye's space)
        ...(cfg.eye ? { eye: point(view, named(whole, cfg.eye).getWorldTranslation()).map((v) => round(v)) } : {}),
        view: view.map((v) => round(v, 1e7)),
        /** the pack's space -> the space of the gun-alone file */
        frame: A.map((v) => round(v, 1e7)),
      };
    }
    await fs.writeFile(metaPath, JSON.stringify(meta));
  }
  boxes.set(id, meta.gun);
  const entries = {};
  const st = await fs.stat(dest);
  entries[id] = { url: `assets/models/${id}.glb`, tags: ['weapon'], bytes: st.size, srcTris: meta.gun.tris, tris: meta.gun.tris, min: meta.gun.min, max: meta.gun.max, lods: [], holds: meta.gun.holds };
  let line = `model ${id.padEnd(28)} ${String(meta.gun.tris).padStart(14)} tris             ${(st.size / 1024).toFixed(0).padStart(6)} KB  (${credit.author}; muzzle ${meta.found.forward.join(',')} up ${meta.found.up.join(',')} x${meta.found.scale})`;
  if (meta.rig) {
    const sf = await fs.stat(destFp);
    const { tris, ...rig } = meta.rig;
    entries[`${id}_fp`] = { url: `assets/models/${id}_fp.glb`, tags: ['viewmodel'], bytes: sf.size, srcTris: tris, tris, min: meta.gun.min, max: meta.gun.max, lods: [], rig };
    line += `\nmodel ${`${id}_fp`.padEnd(28)} ${String(tris).padStart(14)} tris             ${(sf.size / 1024).toFixed(0).padStart(6)} KB  (with arms and ${Object.keys(rig.clips).length} movements)`;
  }
  console.log(line);
  return { entries, credit: { id, ...credit } };
}
