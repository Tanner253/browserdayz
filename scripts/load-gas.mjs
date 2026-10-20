// The gas the mask on the loading screen breathes out (src/ui/style.css, src/ui/loading-fx.ts): four puffs of smoke
// out of Kenney's Particle Pack (CC0, as the game's own smoke is: scripts/fx.mjs), coloured the green of gas, their
// brightness made their cover, side by side in one small picture.
//
//   node scripts/load-gas.mjs      ->  public/brand/gas.webp (four tiles of 128 in a row)

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (assets-src lives only in the main checkout: from a worktree under .claude/worktrees, it is three up)
const SRC = ['', '../../..'].map((up) => path.join(ROOT, up, 'assets-src', 'kenney_particles', 'PNG (Black background)')).find((p) => fs.existsSync(p));
if (!SRC) throw new Error('assets-src/kenney_particles is not here');
const PUFFS = ['smoke_01', 'smoke_02', 'smoke_04', 'smoke_07'];
const PX = 128;
/** the green of it, lit (where the smoke is thickest) and in shade */
const LIT = [196, 240, 120], SHADE = [92, 150, 52];

const tiles = [];
for (const name of PUFFS) {
  const { data } = await sharp(path.join(SRC, `${name}.png`)).removeAlpha().greyscale().resize(PX, PX, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(PX * PX * 4);
  for (let i = 0; i < PX * PX; i++) {
    const v = data[i] / 255;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(SHADE[c] + (LIT[c] - SHADE[c]) * v);
    out[i * 4 + 3] = Math.round(255 * v ** 1.15);
  }
  tiles.push(await sharp(out, { raw: { width: PX, height: PX, channels: 4 } }).png().toBuffer());
}
await sharp({ create: { width: PX * PUFFS.length, height: PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(tiles.map((input, i) => ({ input, left: i * PX, top: 0 })))
  .webp({ quality: 82, alphaQuality: 80 })
  .toFile(path.join(ROOT, 'public', 'brand', 'gas.webp'));
console.log('public/brand/gas.webp');
