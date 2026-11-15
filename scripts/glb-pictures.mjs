// A model's file taken apart and put together again with some of its pictures' bytes replaced, every other byte as it
// lay: what scripts/lean.mjs (pictures cut to size) and scripts/lean-ktx.mjs (pictures packed for the card) share.

export function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('not a glb');
  const jl = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jl).toString('utf8'));
  const bin = bytes.length > 20 + jl ? bytes.subarray(28 + jl, 28 + jl + bytes.readUInt32LE(20 + jl)) : Buffer.alloc(0);
  return { json, bin };
}

/** The file again with some of its pictures' bytes replaced: every other range of its buffer copied as it was, in order. */
export function rebuild(json, bin, replaced) {
  const refs = [];
  for (const v of json.bufferViews ?? []) {
    if (v.buffer === 0) refs.push(v);
    for (const ext of Object.values(v.extensions ?? {})) if (ext && ext.buffer === 0 && typeof ext.byteLength === 'number') refs.push(ext);
  }
  const ranges = new Map();
  for (const r of refs) {
    const key = `${r.byteOffset ?? 0}:${r.byteLength}`;
    if (!ranges.has(key)) ranges.set(key, { at: r.byteOffset ?? 0, len: r.byteLength, refs: [] });
    ranges.get(key).refs.push(r);
  }
  const sorted = [...ranges.values()].sort((a, b) => a.at - b.at);
  for (let k = 1; k < sorted.length; k++) if (sorted[k].at < sorted[k - 1].at + sorted[k - 1].len) throw new Error('ranges overlap');
  const parts = [];
  let cursor = 0;
  for (const r of sorted) {
    const pad = (16 - (cursor % 16)) % 16;
    if (pad) parts.push(Buffer.alloc(pad));
    cursor += pad;
    const bytes = r.refs.map((ref) => replaced.get(ref)).find(Boolean) ?? bin.subarray(r.at, r.at + r.len);
    for (const ref of r.refs) {
      ref.byteOffset = cursor;
      ref.byteLength = bytes.length;
    }
    parts.push(bytes);
    cursor += bytes.length;
  }
  json.buffers[0].byteLength = cursor;
  const body = Buffer.concat(parts);
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binChunk = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (n, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(n, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([head, chunk(jsonChunk.length, 0x4e4f534a), jsonChunk, chunk(binChunk.length, 0x004e4942), binChunk]);
}

