// A computer's copy of every model file with its pictures packed as the graphics card keeps them (KTX2, UASTC),
// beside the copies scripts/lean.mjs makes. The owner, 2026-11-14, on memory ("the memory load is already super
// rough"), of packed pictures: "yes if it doesnt degrade quality super bad". A picture unpacked is four bytes a point
// on the card and four more in the page; packed it is one, and the page keeps no second copy. At the spawn the models'
// pictures were 600 MB of the 730 the scene is painted with (progress/polish-pass/tex-census.js).
//
// Made from the lean copy where there is one (pictures already at the size a computer draws them), else from the file
// itself where every picture in it is that small already. Shapes, movements and every other byte are copied as they
// lie. Named by the version of the file it was made from, as the lean copies are, in assets/lean/512-256k/.
//
//   node scripts/lean-ktx.mjs [--force] [part of a path ...]      after scripts/lean.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
import { readGlb, rebuild } from './glb-pictures.mjs';

/** DESK_CAP in src/core/assets.ts */
const DESK = { colour: 512, other: 256 };
const ROOT = path.resolve('public/assets');
const LEAN = path.join(ROOT, 'lean', `${DESK.colour}-${DESK.other}`), OUT = `${LEAN}k`;
const force = process.argv.includes('--force'), only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const version = (bytes) => createHash('sha1').update(bytes).digest('hex').slice(0, 10);

const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

/** which pictures hold colour as the eye sees it, and which a surface's lean: the rest are plain numbers */
function kinds(json) {
  const srgb = new Set(), normal = new Set();
  const img = (info) => {
    const t = info && json.textures?.[info.index];
    return t ? (t.extensions?.EXT_texture_webp?.source ?? t.source) : undefined;
  };
  for (const m of json.materials ?? []) {
    for (const info of [m.pbrMetallicRoughness?.baseColorTexture, m.emissiveTexture, m.extensions?.KHR_materials_specular?.specularColorTexture, m.extensions?.KHR_materials_sheen?.sheenColorTexture]) {
      const i = img(info);
      if (i !== undefined) srgb.add(i);
    }
    const n = img(m.normalTexture);
    if (n !== undefined) normal.add(n);
  }
  return { srgb, normal };
}

const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== 'hi' && file !== path.join(ROOT, 'lean')) walk(file);
    } else if (f.name.endsWith('.glb')) files.push(file);
  }
};
walk(ROOT);

const made = new Set();
let was = 0, now = 0, done = 0, left = 0, pictures = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (only.length && !only.some((o) => rel.includes(o))) continue;
  const bytes = fs.readFileSync(file), name = `${rel.slice(0, -4)}.${version(bytes)}.glb`;
  const lean = path.join(LEAN, name), dest = path.join(OUT, name);
  const src = fs.existsSync(lean) ? fs.readFileSync(lean) : bytes;
  if (!force && fs.existsSync(dest)) {
    made.add(path.resolve(dest));
    continue;
  }
  let json, bin;
  try {
    ({ json, bin } = readGlb(src));
  } catch {
    left++;
    continue;
  }
  if (!json.images?.length || (json.scenes?.length ?? 1) > 1 || json.extensionsUsed?.includes('KHR_texture_basisu')) {
    left++;
    continue;
  }
  const { srgb, normal } = kinds(json), replaced = new Map();
  let ok = true;
  for (let i = 0; i < json.images.length && ok; i++) {
    const img = json.images[i], view = img.bufferView !== undefined ? json.bufferViews[img.bufferView] : null;
    if (!view) {
      ok = false;
      break;
    }
    const own = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const meta = await sharp(own).metadata();
    // (a picture a computer would still cut on arrival: this file has no lean copy, and is left to be loaded as it is)
    if (Math.max(meta.width, meta.height) > (srgb.has(i) ? DESK.colour : DESK.other) && !fs.existsSync(lean)) {
      ok = false;
      break;
    }
    const ktx = await encodeToKTX2(new Uint8Array(own), { isUASTC: true, isKTX2File: true, uastcLDRQualityLevel: 2, enableRDO: false, needSupercompression: true, generateMipmap: true, isPerceptual: srgb.has(i), isSetKTX2SRGBTransferFunc: srgb.has(i), isNormalMap: normal.has(i), imageDecoder });
    replaced.set(view, Buffer.from(ktx));
    img.mimeType = 'image/ktx2';
    pictures++;
  }
  if (!ok) {
    left++;
    continue;
  }
  for (const t of json.textures ?? []) {
    const i = t.extensions?.EXT_texture_webp?.source ?? t.source;
    if (i === undefined) continue;
    delete t.source;
    if (t.extensions) delete t.extensions.EXT_texture_webp;
    t.extensions = { ...t.extensions, KHR_texture_basisu: { source: i } };
  }
  const drop = (l) => (l ?? []).filter((e) => e !== 'EXT_texture_webp');
  json.extensionsUsed = [...drop(json.extensionsUsed), 'KHR_texture_basisu'];
  json.extensionsRequired = [...drop(json.extensionsRequired), 'KHR_texture_basisu'];
  const out = rebuild(json, bin, replaced);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  made.add(path.resolve(dest));
  was += src.length;
  now += out.length;
  done++;
  console.log(`  ${rel}: ${(src.length / 1048576).toFixed(2)} -> ${(out.length / 1048576).toFixed(2)} MB`);
}

// (copies of files that have since changed or gone: only when every file was gone over)
let stale = 0;
const sweep = (dir) => {
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const file = path.join(dir, f.name);
    if (f.isDirectory()) sweep(file);
    else if (!made.has(path.resolve(file))) {
      fs.rmSync(file);
      stale++;
    }
  }
};
if (!only.length) sweep(OUT);
console.log(`${done} copies made now (${pictures} pictures), ${made.size} in all, ${stale} old ones taken away, ${left} files left as they are: ${(was / 1048576).toFixed(1)} -> ${(now / 1048576).toFixed(1)} MB`);
