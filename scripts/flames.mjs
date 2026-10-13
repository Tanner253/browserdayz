// The flames of a fire: the ones that came with the campfire, and the way they move.
//
//   node scripts/flames.mjs
//
// The source is "Campfire" by Zelad (CC BY 4.0, see CREDITS.md), unpacked by hand into
// assets-src/models/campfire/ (gitignored). Its ring of stones and its logs are in the game already
// (scripts/assets.config.mjs: campfire_ring). This is the rest of it: twenty-nine flat cards, each showing one
// photograph of a flame, a wisp of smoke or a run of embers cut from one sheet of them, and one movement that
// slides every card up out of the wood and shrinks it away.
//
//   public/assets/fx/flames.webp   the sheet, at the size it came (1024 a side), with its alpha. Its colour is
//                                  carried outward under what is clear: the download has white and red under some
//                                  of that, which a picture read softly, or from far off, drags in as a rim
//   public/assets/fx/flames.json   the cards: where on the sheet each one's picture is, the card itself (its
//                                  middle and the two half-sides of it, as the download's own shape has them), where
//                                  it rests, and every key of its place, its size and its turn, as they came.
//                                  Places are in metres from the middle of the ring at the ground, as the ring
//                                  stands in the game (1.45 m across); a size is what brings the card's own shape
//                                  to metres; times are frames, twenty-four to the second
//
// Nothing of the movement is mended here: what the download does is written out as it does it, and what plays it
// (src/game/flames.ts) says what it changes and why. Nothing in the download is run: it is read as data.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { LOCAL_MODELS } from './assets.config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'assets-src', 'models', 'campfire');
const OUT = path.join(ROOT, 'public', 'assets', 'fx');
/** how far the colour is carried under what is clear, pixels (a picture read at an eighth of its size reaches this far) */
const CARRY = 12;

const g = JSON.parse(await fs.readFile(path.join(SRC, 'scene.gltf'), 'utf8'));
const bin = await fs.readFile(path.join(SRC, g.buffers[0].uri));

// ---- reading it
const WIDE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
/** an accessor's numbers (floats, or whole numbers for the corners of triangles) */
function read(i) {
  const a = g.accessors[i], v = g.bufferViews[a.bufferView], n = WIDE[a.type];
  const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  if (!bytes) throw new Error(`a kind of number this does not read: ${a.componentType}`);
  const from = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), step = v.byteStride ?? bytes * n;
  const out = new Array(a.count * n);
  for (let k = 0; k < a.count; k++) {
    for (let e = 0; e < n; e++) {
      const at = from + k * step + e * bytes;
      out[k * n + e] = a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5125 ? bin.readUInt32LE(at) : a.componentType === 5123 ? bin.readUInt16LE(at) : bin.readUInt8(at);
    }
  }
  return out;
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// (4 x 4, written down the columns, as glTF writes them)
const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};
const turned = ([x, y, z, w], [a, b, c]) => {
  // a point turned by a quaternion
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
};
const trs = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const x = turned(q, [s[0], 0, 0]), y = turned(q, [0, s[1], 0]), z = turned(q, [0, 0, s[2]]);
  return [...x, 0, ...y, 0, ...z, 0, ...t, 1];
};
const own = (n) => n.matrix ?? trs(n.translation, n.rotation, n.scale);
const at = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const parent = new Map();
g.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
/** what stands a node's parent in the scene */
const above = (i) => {
  let m = I4;
  for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m = mul(own(g.nodes[p]), m);
  return m;
};

// ---- where the ring is, and how big: the flames are written as the ring stands in the game
// (longest side brought to the size the game gives it, about its own middle, its lowest point on the ground: scripts/props.mjs)
const ringAt = g.nodes.findIndex((n) => n.mesh !== undefined && g.meshes[n.mesh].primitives.some((p) => g.materials[p.material].name === 'Campfire_MAT'));
if (ringAt < 0) throw new Error('the ring of the campfire is not in the download');
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
{
  const m = mul(above(ringAt), own(g.nodes[ringAt]));
  for (const prim of g.meshes[g.nodes[ringAt].mesh].primitives) {
    const p = read(prim.attributes.POSITION);
    for (let k = 0; k < p.length; k += 3) at(m, p.slice(k, k + 3)).forEach((v, e) => ((lo[e] = Math.min(lo[e], v)), (hi[e] = Math.max(hi[e], v))));
  }
}
const K = LOCAL_MODELS.campfire_ring.size / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
const MID = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
const place = (p) => p.map((v, e) => (v - MID[e]) * K);
const R = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---- the cards
const moves = g.animations[0];
const size = (await sharp(path.join(SRC, 'textures', 'Campfire_fire_MAT_baseColor.png')).metadata()).width;
const cards = [];
for (const [i, n] of g.nodes.entries()) {
  if (!/^fire_part_/.test(n.name ?? '')) continue;
  // (each is stood straight in the scene: what is above it turns nothing, so its own place and turn are the scene's)
  const up = above(i);
  if (up.some((v, k) => Math.abs(v - I4[k]) > 1e-6)) throw new Error(`${n.name} is under something that moves it: this does not allow for that`);
  const child = g.nodes[n.children[0]], prim = g.meshes[child.mesh].primitives[0];
  if (g.materials[prim.material].name !== 'Campfire_fire_MAT') continue;
  const inner = own(child), p = read(prim.attributes.POSITION), uv = read(prim.attributes.TEXCOORD_0);
  if (p.length !== 12) throw new Error(`${n.name} is not one card of four corners`);
  let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
  for (let k = 0; k < 4; k++) {
    u0 = Math.min(u0, uv[k * 2]); u1 = Math.max(u1, uv[k * 2]);
    v0 = Math.min(v0, uv[k * 2 + 1]); v1 = Math.max(v1, uv[k * 2 + 1]);
  }
  // The card as its middle and two half-sides: `ax` runs to the right of its picture, `ay` to the top of it.
  // (Each corner shows a corner of the picture's own rectangle, so the four of them say all three.)
  const c = [0, 0, 0], ax = [0, 0, 0], ay = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const corner = at(inner, p.slice(k * 3, k * 3 + 3));
    const a = uv[k * 2] > (u0 + u1) / 2 ? 1 : -1, b = uv[k * 2 + 1] < (v0 + v1) / 2 ? 1 : -1;
    for (let e = 0; e < 3; e++) {
      c[e] += corner[e] / 4;
      ax[e] += (a * corner[e]) / 4;
      ay[e] += (b * corner[e]) / 4;
    }
  }
  const keys = {};
  for (const ch of moves.channels) {
    if (ch.target.node !== i) continue;
    const s = moves.samplers[ch.sampler];
    if (s.interpolation !== 'LINEAR') throw new Error(`${n.name}: keys that are not joined by straight lines`);
    const t = read(s.input).map((x) => Math.round(x * 24)), v = read(s.output);
    const kind = { translation: 'p', rotation: 'q', scale: 's' }[ch.target.path];
    const w = kind === 'q' ? 4 : 3;
    keys[kind] = { t, v: t.flatMap((_, k) => (kind === 'p' ? place(v.slice(k * 3, k * 3 + 3)).map((x) => R(x, 4)) : kind === 's' ? v.slice(k * 3, k * 3 + 3).map((x) => R(x * K, 6)) : v.slice(k * w, k * w + w).map((x) => R(x, 5)))) };
  }
  cards.push({
    name: n.name.replace(/_\d+$/, ''),
    // (pixels from the left and from the top of the sheet: left, top, right, bottom)
    rect: [Math.round(u0 * size), Math.round(v0 * size), Math.round(u1 * size), Math.round(v1 * size)],
    c: c.map((x) => R(x, 3)), ax: ax.map((x) => R(x, 3)), ay: ay.map((x) => R(x, 3)),
    rest: { p: place(n.translation ?? [0, 0, 0]).map((x) => R(x, 4)), q: (n.rotation ?? [0, 0, 0, 1]).map((x) => R(x, 5)), s: (n.scale ?? [1, 1, 1]).map((x) => R(x * K, 6)) },
    keys,
  });
}
const frames = moves.channels.flatMap((ch) => read(moves.samplers[ch.sampler].input).map((x) => Math.round(x * 24)));
const data = { from: 'Campfire by Zelad, CC BY 4.0 (CREDITS.md)', size, fps: 24, frames: [Math.min(...frames), Math.max(...frames)], ring: LOCAL_MODELS.campfire_ring.size, cards };

// ---- the sheet
const { data: px, info } = await sharp(path.join(SRC, 'textures', 'Campfire_fire_MAT_baseColor.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
{
  // What is clear takes the colour of the nearest thing that is not, a ring of pixels at a time; what is further
  // than that from anything is black.
  let known = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    known[k] = px[k * 4 + 3] > 2 ? 1 : 0;
    if (!known[k]) px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = 0;
  }
  for (let pass = 0; pass < CARRY; pass++) {
    const next = known.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (known[k]) continue;
        let r = 0, gr = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H || !known[yy * W + xx]) continue;
            const j = (yy * W + xx) * 4;
            r += px[j]; gr += px[j + 1]; b += px[j + 2]; n++;
          }
        }
        if (!n) continue;
        px[k * 4] = r / n; px[k * 4 + 1] = gr / n; px[k * 4 + 2] = b / n;
        next[k] = 1;
      }
    }
    known = next;
  }
}
await fs.mkdir(OUT, { recursive: true });
// (`exact`: the colour under what is clear is kept as it was just made, not tidied away by the encoder)
await sharp(px, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 92, alphaQuality: 100, effort: 6, exact: true }).toFile(path.join(OUT, 'flames.webp'));
await fs.writeFile(path.join(OUT, 'flames.json'), JSON.stringify(data));
const kb = async (f) => Math.round((await fs.stat(path.join(OUT, f))).size / 1024);
console.log(`flames: ${cards.length} cards, frames ${data.frames.join(' to ')}; flames.webp ${W} x ${H}, ${await kb('flames.webp')} KB; flames.json ${await kb('flames.json')} KB`);
console.log(`  the ring: ${K.toFixed(4)} m to one of the download's units, its middle at ${MID.map((v) => v.toFixed(3)).join(', ')}`);
