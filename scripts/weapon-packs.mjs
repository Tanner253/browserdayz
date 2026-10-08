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

/** A skinned shape as it stands on its skeleton now: [positions, normals, tangents, the joint each point mostly follows], per primitive. */
function standSkin(node) {
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const J = joints.map((j, k) => mul(j.getWorldMatrix(), ibm.getElement(k, [])));
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
  const stamp = JSON.stringify({ ...settings, v: 7 });
  const metaPath = path.join(dir, '_meta.json');
  let meta;
  if (!FORCE && (await exists(dest)) && (!fp || (await exists(destFp))) && (await exists(metaPath))) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    if (meta.stamp !== stamp) meta = undefined;
  }
  if (!meta) {
    // ---- the gun alone, standing still
    const doc = await io.read(gltfPath);
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
    const stood = cfg.skinned ? standSkin(root.listNodes().find((n) => n.getSkin() && n.getMesh()?.getName().includes(cfg.skinned.mesh))) : null;
    if (stood) {
      for (const s of stood) {
        const of = s.lead.map((j) => (j in cfg.skinned.joints ? cfg.skinned.joints[j] : cfg.skinned.rest));
        pieces.push({ skin: s, of });
      }
    } else {
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
    const wristR = named(doc, cfg.wrists.right).getWorldTranslation(), wristL = named(doc, cfg.wrists.left).getWorldTranslation();
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
    const A = mul(move(-at[0], -at[1], -at[2]), B);
    holds ??= { right: point(A, wristR).map((v) => round(v)), left: point(A, wristL).map((v) => round(v)) };
    const set = Object.fromEntries([...pieceBox].map(([k, b]) => [k, { min: b.min.map((v, i) => round(v - at[i])), max: b.max.map((v, i) => round(v - at[i])) }]));

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
        transformMesh(pc.node.getMesh(), mul(A, pc.world));
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
    for (const a of root.listAnimations()) a.dispose();
    for (const child of scene.listChildren()) scene.removeChild(child);
    for (const n of root.listNodes()) if (!nodes.includes(n)) n.setMesh(null).setSkin(null);
    for (const sk of root.listSkins()) sk.dispose();
    for (const n of nodes) scene.addChild(n);
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
      const whole = await io.read(gltfPath);
      const all = countTris(whole);
      await whole.transform(
        dedup(),
        resample(),
        prune(),
        ...(cfg.armsTex ? [textureCompress({ encoder: sharp, targetFormat: 'webp', pattern: /arms/i, resize: [cfg.armsTex, cfg.armsTex], quality: 86 })] : []),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 88 }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
      await io.write(destFp, whole);
      // the pack's space -> the eye's: x to the right, y up, the muzzle away down -z, in metres
      const view = mul(scaleBy(s), [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1]);
      meta.rig = {
        tris: all,
        fps: cfg.fps,
        clips: cfg.clips,
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
