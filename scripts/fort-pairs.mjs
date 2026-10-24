// Before and after, side by side, each cropped to the middle of its picture (where the place looked at is):
//   node scripts/fort-pairs.mjs <dir> <out.jpg> <crop 0..1> <name> <name> ...   (reads <dir>/before-<name>.png and after-<name>.png)
import path from 'node:path';
import sharp from 'sharp';

const [dir, out, crop, ...names] = process.argv.slice(2);
const W = 640, H = 360, k = Number(crop);
const cell = async (file, label) => {
  const m = await sharp(file).metadata(), w = Math.round(m.width * k), h = Math.round(m.height * k);
  const svg = Buffer.from(`<svg width="${W}" height="24"><rect width="100%" height="100%" fill="black" opacity="0.6"/><text x="8" y="17" font-family="Arial" font-size="16" fill="white">${label}</text></svg>`);
  return sharp(file).extract({ left: Math.round((m.width - w) / 2), top: Math.round((m.height - h) / 2), width: w, height: h }).resize(W, H).composite([{ input: svg, top: 0, left: 0 }]).toBuffer();
};
const tiles = [];
for (const [i, n] of names.entries()) {
  tiles.push({ input: await cell(path.join(dir, `before-${n}.png`), `${n}: before`), left: 0, top: i * H });
  tiles.push({ input: await cell(path.join(dir, `after-${n}.png`), `${n}: after`), left: W, top: i * H });
}
await sharp({ create: { width: 2 * W, height: names.length * H, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 88 }).toFile(out);
console.log(out);
