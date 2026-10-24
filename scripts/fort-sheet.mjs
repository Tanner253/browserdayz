// A sheet of pictures, each with its name on it: node scripts/fort-sheet.mjs <out.jpg> <cell px> <columns> <a.png> <b.png> ...
// (for looking over the fort's gaps a dozen at a time: scripts/fort-gaps.ts --view)
import path from 'node:path';
import sharp from 'sharp';

const [out, size, cols, ...files] = process.argv.slice(2);
const S = Number(size), C = Number(cols), rows = Math.ceil(files.length / C);
const tiles = await Promise.all(files.map(async (f, i) => {
  const label = path.basename(f).replace(/\.(png|jpg)$/, '');
  const svg = Buffer.from(`<svg width="${S}" height="22"><rect width="100%" height="100%" fill="black" opacity="0.6"/><text x="6" y="16" font-family="Arial" font-size="15" fill="white">${label}</text></svg>`);
  const img = await sharp(f).resize(S, S, { fit: 'cover' }).composite([{ input: svg, top: 0, left: 0 }]).toBuffer();
  return { input: img, left: (i % C) * S, top: Math.floor(i / C) * S };
}));
await sharp({ create: { width: C * S, height: rows * S, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 88 }).toFile(out);
console.log(out);
