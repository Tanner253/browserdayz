// Pictures for effects that are not made in code: the flash at a muzzle.
//
// From the side it is one of five flames out of Kenney's Particle Pack (CC0), white, to be
// coloured where it is drawn. From in front it is one of eighteen frames of "Machine Gun
// Muzzle Flash Test effect" by maxi.ariani (CC BY 4.0), which come as one picture with the
// frames set about it unevenly: where each is, is read out of the model the picture came
// with, and they are set out again in an even grid.
//
//   public/assets/fx/muzzle_side.webp    five tiles in a row, the flame running to the right,
//                                        its muzzle 0.22 of the way along each tile
//   public/assets/fx/muzzle_front.webp   six by three tiles
//
// The sources are unpacked by hand into assets-src/kenney_particles/ and
// assets-src/models/muzzle_flash_fx/. Run by scripts/fetch-assets.mjs (npm run assets).

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { creditOf } from './props.mjs';

/** where along a side tile the muzzle is (see src/game/muzzle.ts, which must agree) */
export const SIDE = { tiles: 5, px: 256, muzzle: 0.22 };
export const FRONT = { cols: 6, rows: 3, px: 128 };

export async function buildFx({ SRC, OUT, exists }) {
  const kenney = path.join(SRC, 'kenney_particles', 'PNG (Black background)');
  const flash = path.join(SRC, 'models', 'muzzle_flash_fx');
  if (!(await exists(kenney)) || !(await exists(path.join(flash, 'scene.gltf')))) {
    console.log('fx: the muzzle flash pictures are not in assets-src (kenney_particles/, models/muzzle_flash_fx/): left as they are');
    return [];
  }
  const out = path.join(OUT, 'fx');
  await fs.mkdir(out, { recursive: true });

  // ---- from the side
  const tiles = [];
  for (let i = 1; i <= SIDE.tiles; i++) {
    const src = sharp(path.join(kenney, `muzzle_0${i}.png`)).removeAlpha().greyscale();
    const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    // its hottest row is the mouth of the barrel: every tile is cut so that row falls in the same place
    let hot = 0, best = -1;
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let x = 0; x < W; x++) sum += data[y * W + x];
      if (sum > best) {
        best = sum;
        hot = y;
      }
    }
    const want = Math.round(H * (1 - SIDE.muzzle));
    const shift = want - hot;
    // (moved up or down by whole rows, black where there was nothing)
    const cut = Buffer.alloc(W * H);
    for (let y = 0; y < H; y++) {
      const from = y - shift;
      if (from >= 0 && from < H) data.copy(cut, y * W, from * W, from * W + W);
    }
    // the flame stands up in the pack: laid over, it runs to the right
    const moved = await sharp(cut, { raw: { width: W, height: H, channels: 1 } }).rotate(90).resize(SIDE.px, SIDE.px).png().toBuffer();
    tiles.push(moved);
  }
  await sharp({ create: { width: SIDE.px * SIDE.tiles, height: SIDE.px, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: i * SIDE.px, top: 0 })))
    .webp({ quality: 90 })
    .toFile(path.join(out, 'muzzle_side.webp'));

  // ---- from in front
  const g = JSON.parse(await fs.readFile(path.join(flash, 'scene.gltf'), 'utf8'));
  const bin = await fs.readFile(path.join(flash, g.buffers[0].uri));
  const seen = new Map();
  for (const m of g.meshes) {
    const a = g.accessors[m.primitives[0].attributes.TEXCOORD_0], v = g.bufferViews[a.bufferView];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? 8;
    let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
    for (let k = 0; k < a.count; k++) {
      const u = bin.readFloatLE(off + k * stride), w = bin.readFloatLE(off + k * stride + 4);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, w);
      v1 = Math.max(v1, w);
    }
    // (two of its sheets show the same frame a hair apart: one is enough)
    seen.set(`${Math.round(u0 * 50)} ${Math.round(v0 * 50)}`, [u0, v0, u1, v1]);
  }
  const frames = [...seen.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const sheet = sharp(path.join(flash, 'textures', '01___Default_emissive.png')).removeAlpha();
  const meta = await sheet.metadata();
  const cut = [];
  for (const [u0, v0, u1, v1] of frames) {
    const left = Math.max(0, Math.round(u0 * meta.width)), top = Math.max(0, Math.round(v0 * meta.height));
    const width = Math.min(meta.width - left, Math.round((u1 - u0) * meta.width)), height = Math.min(meta.height - top, Math.round((v1 - v0) * meta.height));
    const tile = sheet.clone().extract({ left, top, width, height }).resize(FRONT.px, FRONT.px, { kernel: 'cubic' });
    // (one of its sheets looks at a part of the picture with nothing in it)
    if ((await tile.clone().stats()).channels[0].mean > 3) cut.push(await tile.png().toBuffer());
  }
  // the grid is filled: the first frames are used again for what is short
  for (let i = 0; cut.length < FRONT.cols * FRONT.rows; i++) cut.push(cut[i]);
  await sharp({ create: { width: FRONT.px * FRONT.cols, height: FRONT.px * FRONT.rows, channels: 3, background: '#000' } })
    .composite(cut.map((input, i) => ({ input, left: (i % FRONT.cols) * FRONT.px, top: Math.floor(i / FRONT.cols) * FRONT.px })))
    .webp({ quality: 92 })
    .toFile(path.join(out, 'muzzle_front.webp'));

  const sizes = await Promise.all(['muzzle_side.webp', 'muzzle_front.webp'].map(async (f) => `${f} ${((await fs.stat(path.join(out, f))).size / 1024).toFixed(0)} KB`));
  console.log(`fx    ${sizes.join(', ')}  (Kenney; maxi.ariani)`);
  return [{ id: 'muzzle_flash_fx', ...(await creditOf(flash)), changes: 'Only its picture is used: the eighteen frames are cut out of it and set in an even grid; the planes it came on and their animation are not. Re-encoded as WebP.' }];
}
