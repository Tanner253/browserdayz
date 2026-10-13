// What a blast is drawn with that is not made in code: the puffs, clods, streaks and rings of it, and the ground it throws.
//
//   node scripts/blast.mjs            both
//   node scripts/blast.mjs sheet      the sheet alone
//   node scripts/blast.mjs burst      the thrown ground alone
//
// Two sources, both unpacked by hand under assets-src (gitignored), neither of them run: they are read as data.
//
// 1. Kenney's Particle Pack (CC0), assets-src/kenney_particles/. Sixteen of its pictures, each at the size it came
//    (512 a side), set in a grid four by four:
//
//      public/assets/fx/blast.webp     white where a thing is, black where it is not (one number a point: what
//                                      draws it gives it its colour). Which tile is which is SHEET below, and
//                                      src/game/blast.ts reads the same names from blast.json
//
// 2. "Bomb Crack_Ground_00 (Free)" by paulyang (CC BY 4.0, see CREDITS.md), assets-src/models/bomb_crack_ground/.
//    A slab of ground five metres square that bursts in its middle: 1,416 pieces, each a shape of its own, moved
//    by keys of its own for three and a third seconds (the first third of a second it lies whole). As it came it
//    is 3,551 things to place and 2,131 to draw. Here it is made ONE shape and one small table:
//
//      public/assets/fx/burst.bin      every triangle of every piece that flies, each point with the number of
//                                      its piece and whether it is of the ground's top or of what is under it;
//                                      and where each piece is, how it is turned and whether it is there, FPS
//                                      times a second, for what draws it to read between (see the layout below)
//      public/assets/fx/blast.json     the figures both are read by
//
//    What is left out: the slab while it is whole (one piece), the eleven pieces of it that never move (the game
//    has ground of its own, and a square of somebody else's laid on it is not that), and twenty-odd pieces that
//    are there for one thirtieth of a second before the pieces they break into. Nothing that flies is left out,
//    and no triangle of what flies. The pack's own pictures (a grey concrete and a pale rubble) are not used:
//    a blast throws the ground it is on, and is painted with that ground's pictures (src/game/blast.ts).
//
//    Its units are centimetres (its slab is 500 across and 10 thick) and it falls as things fall: what is thrown
//    four metres up is 0.9 s rising. Written here in metres, about the middle of the slab's top.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'public', 'assets', 'fx');
const KENNEY = path.join(ROOT, 'assets-src', 'kenney_particles', 'PNG (Black background)');
const BOMB = path.join(ROOT, 'assets-src', 'models', 'bomb_crack_ground');
const what = process.argv[2] ?? 'both';

/** the sheet: the pack's own names, in the order they are set out (left to right, top to bottom), and what each is for */
export const SHEET = {
  px: 512,
  cols: 4,
  tiles: [
    'smoke_04', 'smoke_05', 'smoke_06', 'smoke_07', // 0-3  puffs of smoke
    'smoke_08', 'smoke_02', 'dirt_01', 'dirt_02', //   4-5  puffs; 6-8 a spray of clods
    'dirt_03', 'trace_01', 'fire_01', 'scorch_03', //  9 a streak (a spark in flight); 10 a burst of embers; 11 a burnt patch
    'scorch_01', 'smoke_10', 'circle_05', 'circle_01', // 12 a star of rays (the flash, and the burn's fingers); 13 a ring of dust; 14 a soft round glow; 15 a thin ring
  ],
};
/**
 * The thrown ground: how many times a second its movement is written down. As it came, thirty: at fifteen the table
 * is half the size and a piece is 1.7 mm from its place on the whole, but one step in eighteen of a piece that
 * spins is then more than a quarter turn, and read between two such it would turn the wrong way.
 */
const FPS = 30;
/** the pack's own time its pieces first move at, and its last, seconds */
const SPAN = [1 / 3, 10 / 3];

const kb = async (f) => Math.round((await fs.stat(path.join(OUT, f))).size / 1024);
const exists = (p) => fs.access(p).then(() => true, () => false);
await fs.mkdir(OUT, { recursive: true });
const figures = (await exists(path.join(OUT, 'blast.json'))) ? JSON.parse(await fs.readFile(path.join(OUT, 'blast.json'), 'utf8')) : {};

// ------------------------------------------------------------------ the sheet
if (what === 'both' || what === 'sheet') {
  if (!(await exists(KENNEY))) throw new Error('the particle pack is not in assets-src/kenney_particles/');
  const { px, cols, tiles } = SHEET, rows = Math.ceil(tiles.length / cols);
  const parts = [];
  for (const [i, name] of tiles.entries()) {
    const file = path.join(KENNEY, `${name}.png`);
    const meta = await sharp(file).metadata();
    if (meta.width !== px || meta.height !== px) throw new Error(`${name} is ${meta.width} x ${meta.height}, not ${px}`);
    parts.push({ input: await sharp(file).removeAlpha().greyscale().png().toBuffer(), left: (i % cols) * px, top: Math.floor(i / cols) * px });
  }
  await sharp({ create: { width: px * cols, height: px * rows, channels: 3, background: '#000' } }).composite(parts).greyscale().webp({ quality: 90, effort: 6 }).toFile(path.join(OUT, 'blast.webp'));
  figures.sheet = { from: 'Particle Pack by Kenney, CC0 (CREDITS.md)', px, cols, rows, tiles };
  console.log(`blast: the sheet, ${tiles.length} tiles of ${px}, ${px * cols} x ${px * rows}; blast.webp ${await kb('blast.webp')} KB`);
}

// ------------------------------------------------------------------ the thrown ground
if (what === 'both' || what === 'burst') {
  if (!(await exists(path.join(BOMB, 'scene.gltf')))) throw new Error('the ground burst is not in assets-src/models/bomb_crack_ground/');
  const g = JSON.parse(await fs.readFile(path.join(BOMB, 'scene.gltf'), 'utf8'));
  const bin = await fs.readFile(path.join(BOMB, g.buffers[0].uri));
  const WIDE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  /** an accessor's numbers */
  const read = (i) => {
    const a = g.accessors[i], v = g.bufferViews[a.bufferView], n = WIDE[a.type];
    const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    if (!bytes) throw new Error(`a kind of number this does not read: ${a.componentType}`);
    const from = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), step = v.byteStride ?? bytes * n;
    const out = a.componentType === 5126 ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
    for (let k = 0; k < a.count; k++) {
      for (let e = 0; e < n; e++) {
        const at = from + k * step + e * bytes;
        out[k * n + e] = a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5125 ? bin.readUInt32LE(at) : a.componentType === 5123 ? bin.readUInt16LE(at) : bin.readUInt8(at);
      }
    }
    return out;
  };
  const root = g.nodes.findIndex((n) => n.name === 'RootNode');
  // (nothing above the pieces turns or sizes them: the two turns the download wraps them in undo each other)
  const parent = new Map();
  g.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  for (let p = parent.get(root), turn = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; ; p = parent.get(p)) {
    if (p === undefined) {
      if (turn.some((v, k) => Math.abs(v - (k % 5 === 0 ? 1 : 0)) > 1e-6)) throw new Error('the pieces stand under something that moves them: this does not allow for that');
      break;
    }
    const m = g.nodes[p].matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = m[r] * turn[c * 4] + m[4 + r] * turn[c * 4 + 1] + m[8 + r] * turn[c * 4 + 2] + m[12 + r] * turn[c * 4 + 3];
    turn = o;
  }
  const moves = g.animations[0], tracks = new Map();
  for (const ch of moves.channels) {
    const s = moves.samplers[ch.sampler];
    if (s.interpolation !== 'LINEAR') throw new Error('keys that are not joined by straight lines');
    const t = tracks.get(ch.target.node) ?? tracks.set(ch.target.node, {}).get(ch.target.node);
    t[ch.target.path] = { t: read(s.input), v: read(s.output) };
  }
  /** a run of keys at a time: straight lines between keys, held before the first and after the last */
  const key = (tr, rest, time, wide) => {
    if (!tr) return rest;
    const { t, v } = tr, n = t.length;
    if (time <= t[0]) return Array.from(v.slice(0, wide));
    if (time >= t[n - 1]) return Array.from(v.slice((n - 1) * wide, n * wide));
    let k = 0;
    while (t[k + 1] < time) k++;
    const u = (time - t[k]) / (t[k + 1] - t[k]);
    const o = [];
    for (let e = 0; e < wide; e++) o.push(v[k * wide + e] + (v[(k + 1) * wide + e] - v[k * wide + e]) * u);
    if (wide === 4) {
      const l = Math.hypot(...o) || 1;
      return o.map((x) => x / l);
    }
    return o;
  };
  const CM = 0.01;
  const pose = (f, time) => {
    const n = g.nodes[f], tr = tracks.get(f) ?? {};
    return { p: key(tr.translation, n.translation ?? [0, 0, 0], time, 3).map((x) => x * CM), q: key(tr.rotation, n.rotation ?? [0, 0, 0, 1], time, 4), s: key(tr.scale, n.scale ?? [1, 1, 1], time, 3)[0] };
  };

  // ---- which pieces: the ones that fly, and are still there at the end
  let pieces = g.nodes[root].children.filter((f) => tracks.get(f)?.translation && pose(f, SPAN[1]).s > 0.5).map((f) => {
    const meshes = (g.nodes[f].children ?? []).map((c) => {
      if (g.nodes[c].matrix || g.nodes[c].translation || g.nodes[c].rotation || g.nodes[c].scale) throw new Error(`${g.nodes[c].name} is moved within its piece: this does not allow for that`);
      const p = g.meshes[g.nodes[c].mesh].primitives[0];
      return { pos: read(p.attributes.POSITION), uv: read(p.attributes.TEXCOORD_0), idx: read(p.indices), side: g.materials[p.material].name === 'Side' ? 1 : 0 };
    });
    let big = 0;
    for (const m of meshes) for (let k = 0; k < m.pos.length; k += 3) big = Math.max(big, Math.hypot(m.pos[k], m.pos[k + 1], m.pos[k + 2]) * CM);
    return { f, meshes, big };
  });
  // (the biggest first: what draws fewer of them, for a blast far off, draws the ones that are seen)
  pieces.sort((a, b) => b.big - a.big);
  const F = pieces.length;
  const frames = Math.round((SPAN[1] - SPAN[0]) * FPS) + 1;

  // ---- the movement: for every piece a row, for every frame two places in it (where and whether; how turned)
  const motion = new Float32Array(F * frames * 8);
  let out = 0, up = 0, off = 0, offMost = 0, swing = 0;
  pieces.forEach((pc, i) => {
    let last = null;
    for (let k = 0; k < frames; k++) {
      const P = pose(pc.f, SPAN[0] + k / FPS);
      // (the same turn can be written two ways round: each frame is written the way nearest the one before, so that what is read between two frames goes the short way)
      if (last && last[0] * P.q[0] + last[1] * P.q[1] + last[2] * P.q[2] + last[3] * P.q[3] < 0) P.q = P.q.map((x) => -x);
      if (last) swing = Math.max(swing, 2 * Math.acos(Math.min(1, Math.abs(last[0] * P.q[0] + last[1] * P.q[1] + last[2] * P.q[2] + last[3] * P.q[3]))));
      last = P.q;
      motion.set([P.p[0], P.p[1], P.p[2], P.s > 0.5 ? 1 : 0, ...P.q], (i * frames + k) * 8);
      out = Math.max(out, Math.hypot(P.p[0], P.p[2]));
      up = Math.max(up, P.p[1]);
    }
    // how far what is read between two frames is from where the download has the piece, looked at sixty times a second
    const looks = Math.round((SPAN[1] - SPAN[0]) * 60);
    for (let k = 0; k < looks; k++) {
      const time = SPAN[0] + k / 60, x = (time - SPAN[0]) * FPS, a = Math.min(frames - 2, Math.floor(x)), w = x - a;
      const A = motion.subarray((i * frames + a) * 8, (i * frames + a) * 8 + 3), B = motion.subarray((i * frames + a + 1) * 8, (i * frames + a + 1) * 8 + 3), T = pose(pc.f, time);
      if (T.s < 0.5 || motion[(i * frames + a) * 8 + 3] < 0.5) continue;
      const d = Math.hypot(A[0] + (B[0] - A[0]) * w - T.p[0], A[1] + (B[1] - A[1]) * w - T.p[1], A[2] + (B[2] - A[2]) * w - T.p[2]);
      off += d / (looks * F);
      offMost = Math.max(offMost, d);
    }
  });

  // ---- the shape: every piece's triangles, its points in its own space
  let V = 0, T = 0, big = 0, uvLo = Infinity, uvHi = -Infinity;
  for (const pc of pieces) {
    for (const m of pc.meshes) {
      V += m.pos.length / 3;
      T += m.idx.length / 3;
      for (const v of m.uv) {
        uvLo = Math.min(uvLo, v);
        uvHi = Math.max(uvHi, v);
      }
    }
    big = Math.max(big, pc.big);
  }
  if (V > 65535) throw new Error(`${V} points: more than a short count holds`);
  const pos = new Int16Array(V * 3), uv = new Uint16Array(V * 2), who = new Uint16Array(V * 2), index = new Uint16Array(T * 3);
  let v0 = 0, t0 = 0;
  pieces.forEach((pc, i) => {
    for (const m of pc.meshes) {
      const n = m.pos.length / 3;
      for (let k = 0; k < n; k++) {
        for (let e = 0; e < 3; e++) pos[(v0 + k) * 3 + e] = Math.round(((m.pos[k * 3 + e] * CM) / big) * 32767);
        for (let e = 0; e < 2; e++) uv[(v0 + k) * 2 + e] = Math.round(((m.uv[k * 2 + e] - uvLo) / (uvHi - uvLo)) * 65535);
        who[(v0 + k) * 2] = i;
        who[(v0 + k) * 2 + 1] = m.side;
      }
      for (let k = 0; k < m.idx.length; k++) index[t0 + k] = v0 + m.idx[k];
      v0 += n;
      t0 += m.idx.length;
    }
  });

  // ---- written: the four lists of the shape, then the movement as half-size numbers
  const half = (() => {
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    return (x) => {
      f32[0] = x;
      const b = u32[0], sign = (b >>> 16) & 0x8000, exp = ((b >>> 23) & 0xff) - 127 + 15, man = b & 0x7fffff;
      if (exp <= 0) return exp < -10 ? sign : sign | (((man | 0x800000) >> (1 - exp)) + 0x1000) >> 13;
      if (exp >= 31) return sign | 0x7c00;
      const r = sign | (exp << 10) | (man >> 13);
      return r + ((man >> 12) & 1);
    };
  })();
  const moved = new Uint16Array(motion.length);
  for (let k = 0; k < motion.length; k++) moved[k] = half(motion[k]);
  const lists = { pos, uv, who, index, motion: moved }, at = {};
  let bytes = 0;
  for (const [name, a] of Object.entries(lists)) {
    at[name] = [bytes, a.length];
    bytes += a.byteLength;
  }
  const file = Buffer.alloc(bytes);
  for (const [name, a] of Object.entries(lists)) Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(file, at[name][0]);
  await fs.writeFile(path.join(OUT, 'burst.bin'), file);
  figures.burst = {
    from: 'Bomb Crack_Ground_00 (Free) by paulyang, CC BY 4.0 (CREDITS.md)',
    pieces: F, points: V, triangles: T, frames, fps: FPS, seconds: (frames - 1) / FPS,
    // a point of the shape is its short number times this, metres; a place on its picture is its number over 65535 of the way from the first of these to the second
    big, uv: [uvLo, uvHi],
    // how far out the furthest piece gets, and how high the highest, metres
    out: Math.round(out * 100) / 100, up: Math.round(up * 100) / 100,
    // where each list is in burst.bin: the byte it starts at, and how many numbers (shorts, all of them)
    at,
  };
  console.log(`blast: the thrown ground, ${F} pieces of ${g.nodes[root].children.length}, ${V} points, ${T} triangles, ${frames} frames at ${FPS} a second; burst.bin ${await kb('burst.bin')} KB`);
  console.log(`  thrown ${out.toFixed(2)} m out and ${up.toFixed(2)} m up; the biggest piece ${(big * 2).toFixed(2)} m across`);
  console.log(`  read between frames it is ${(off * 1000).toFixed(1)} mm from the download's own place on the whole, ${(offMost * 100).toFixed(1)} cm at worst; the most a piece turns between two frames is ${((swing * 180) / Math.PI).toFixed(0)} degrees`);
}
await fs.writeFile(path.join(OUT, 'blast.json'), JSON.stringify(figures));
console.log(`blast.json ${await kb('blast.json')} KB`);
