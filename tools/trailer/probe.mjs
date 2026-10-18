// Reads an MP4's boxes and says what is in it: tracks, codecs, size, length. No ffmpeg needed.
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]);
const out = [];
function walk(start, end, depth, ctx) {
  for (let p = start; p + 8 <= end; ) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let head = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); head = 16; }
    if (size < 8) break;
    if (depth === 0) out.push(`${type} ${(size / 1048576).toFixed(2)} MB`);
    if (type === 'mvhd') { const v = buf[p + head]; const ts = buf.readUInt32BE(p + head + (v ? 20 : 12)); const d = v ? Number(buf.readBigUInt64BE(p + head + 24)) : buf.readUInt32BE(p + head + 16); out.push(`  length ${(d / ts).toFixed(3)} s`); }
    if (type === 'tkhd') { const v = buf[p + head]; const o = p + head + (v ? 88 : 76); out.push(`  track ${buf.readUInt32BE(o) / 65536}x${buf.readUInt32BE(o + 4) / 65536}`); }
    if (type === 'stsd') out.push(`  codec ${buf.toString('latin1', p + head + 12, p + head + 16)}`);
    if (type === 'stsz') out.push(`  samples ${buf.readUInt32BE(p + head + 8)}`);
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(p + head, p + size, depth + 1, ctx);
    p += size;
  }
}
walk(0, buf.length, 0, {});
console.log(out.join('\n'));
