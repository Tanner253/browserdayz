// A copy of every model file for a computer, its pictures already at the size a computer cuts them to as it loads
// (DESK_CAP in src/core/assets.ts: 256 a side for colour, 128 for the rest; the owner, 2026-10-21, "we can do C").
// Most of each file was pictures that were downloaded at up to 2048 and thrown away on arrival; the owner, on shrinking
// the files to match: "we should do this".
//
// The pixels are the game's own: each picture is unpacked and cut by Chrome with the very calls the game makes
// (`shrink` in assets.ts), read back off a WebGL texture, stored lossless (webp, colour under clear pixels kept), and
// unpacked again and compared before it is written. Shapes, movements and every other byte of the file are copied
// as they lie. A phone, the icon tool and the server go on using the files themselves.
//
// Each copy is named by the version of the file it was made from (the sha1 the build puts in assets/versions.json),
// so a model that is changed and not run through this again is loaded whole, never with an old copy.
//
//   node scripts/lean.mjs [--force]      after a model is brought in or changed (packs.mjs, tier-now.mjs, lods.mjs)
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import WebSocket from 'ws';

/** DESK_CAP in src/core/assets.ts, which looks for the copies under this name: the two out of step, the game loads the files whole */
const CAP = { colour: 256, other: 128 };
/** and DESK_UP there: the models a computer draws a size up (Kamenka's two downloaded buildings, the owner 2026-10-23) */
const UP = { colour: 512, other: 256 };
const UP_FILES = new Set(['models/house_interior.glb', 'models/shanty_mansion.glb']);
const ROOT = path.resolve('public/assets');
const dirOf = (cap) => path.join(ROOT, 'lean', `${cap.colour}-${cap.other}`);
const OUTS = [dirOf(CAP), dirOf(UP)];
const force = process.argv.includes('--force');

/** the version the build gives a file (vite.config.ts, assetVersions) */
const version = (bytes) => createHash('sha1').update(bytes).digest('hex').slice(0, 10);

function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('not a glb');
  const jl = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jl).toString('utf8'));
  const bin = bytes.length > 20 + jl ? bytes.subarray(28 + jl, 28 + jl + bytes.readUInt32LE(20 + jl)) : Buffer.alloc(0);
  return { json, bin };
}

/**
 * Which pictures a computer cuts, and to what: those three puts in the slots `shrink` is run on (map and emissiveMap
 * as colour; normal, roughness, metalness and occlusion as the rest). A picture only another slot uses (an
 * extension's) is left whole, as the game leaves it. Null: a file this does not copy (and the game loads whole).
 */
function cuts(json, cap) {
  if ((json.scenes?.length ?? 1) > 1) return null;
  const source = (ti) => {
    const t = json.textures?.[ti];
    return t?.extensions?.KHR_texture_basisu ? -1 : (t?.extensions?.EXT_texture_webp?.source ?? t?.source);
  };
  const kind = new Map();
  for (const m of json.materials ?? []) {
    for (const [info, k] of [[m.pbrMetallicRoughness?.baseColorTexture, 'colour'], [m.emissiveTexture, 'colour'], [m.normalTexture, 'other'], [m.occlusionTexture, 'other'], [m.pbrMetallicRoughness?.metallicRoughnessTexture, 'other']]) {
      if (!info) continue;
      const i = source(info.index);
      if (i === -1) return null;
      if (i === undefined) continue;
      // (the game caps a picture by the first slot it meets it in: one that is both would depend on that order)
      if (kind.has(i) && kind.get(i) !== k) return null;
      kind.set(i, k);
    }
  }
  const out = new Map();
  for (const [i, k] of kind) {
    const img = json.images?.[i];
    if (img?.bufferView === undefined) return null;
    out.set(i, cap[k]);
  }
  return out;
}

/** The file again with some of its pictures' bytes replaced: every other range of its buffer copied as it was, in order. */
function rebuild(json, bin, replaced) {
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

// ------------------------------------------------------------------ Chrome, to cut the pictures as the game does

/** run in the page: `cut` is the game's own unpacking (three's ImageBitmapLoader) and `shrink`; `back` unpacks a copy to check it */
const PAGE = `
const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
const pixels = (bmp) => {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const out = new Uint8Array(bmp.width * bmp.height * 4);
  gl.readPixels(0, 0, bmp.width, bmp.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(t);
  let s = '';
  for (let k = 0; k < out.length; k += 0x8000) s += String.fromCharCode.apply(null, out.subarray(k, k + 0x8000));
  return btoa(s);
};
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const unpack = (b64, mime) => createImageBitmap(new Blob([bytes(b64)], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
window.cut = async (b64, mime, cap) => {
  const img = await unpack(b64, mime);
  const w = img.width, h = img.height;
  if (Math.max(w, h) <= cap) return null;
  const k = cap / Math.max(w, h);
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  const small = await createImageBitmap(img, { resizeWidth: sw, resizeHeight: sh, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  img.close();
  if (small.width !== sw || small.height !== sh) throw new Error('not resized');
  const raw = pixels(small);
  small.close();
  return { w: sw, h: sh, raw };
};
window.back = async (b64, mime) => {
  const img = await unpack(b64, mime);
  const raw = pixels(img);
  img.close();
  return raw;
};
`;

async function chrome() {
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
  if (!exe) throw new Error('no Chrome found');
  const port = 9300 + Math.floor(Math.random() * 60);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-lean-'));
  // (drawn by the processor: nothing is asked of the graphics card, and the pictures are cut on the processor either way)
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let k = 0; k < 80 && !target; k++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not come up');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 1024 * 1024 * 1024 });
  await new Promise((r) => ws.once('open', r));
  let seq = 0;
  const waiting = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w[1](new Error(m.error.message));
    else if (m.result.exceptionDetails) w[1](new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text));
    else w[0](m.result.result.value);
  });
  const call = (expression) => new Promise((res, rej) => {
    const id = ++seq;
    waiting.set(id, [res, rej]);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  await call(PAGE);
  return {
    cut: (bytes, mime, cap) => call(`cut(${JSON.stringify(bytes.toString('base64'))}, ${JSON.stringify(mime)}, ${cap})`),
    back: (bytes, mime) => call(`back(${JSON.stringify(bytes.toString('base64'))}, ${JSON.stringify(mime)})`),
    async close() {
      ws.close();
      proc.kill();
      for (let k = 0; k < 20; k++) {
        try {
          fs.rmSync(profile, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    },
  };
}

// ------------------------------------------------------------------ every model file a computer loads

const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, f.name);
    if (f.isDirectory()) {
      // (the copies as they came, which only the icon tool loads; and these copies themselves)
      if (f.name !== 'hi' && file !== path.join(ROOT, 'lean')) walk(file);
    } else if (f.name.endsWith('.glb')) files.push(file);
  }
};
walk(ROOT);
for (const out of OUTS) fs.mkdirSync(out, { recursive: true });

const page = await chrome();
const made = new Set();
let was = 0, now = 0, copied = 0, skipped = 0, whole = 0;
try {
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const bytes = fs.readFileSync(file);
    const name = `${rel.slice(0, -4)}.${version(bytes)}.glb`;
    // (every file at CAP, which a phone loads too for what it draws far; the few a computer draws a size up, at UP as well)
    for (const cap of UP_FILES.has(rel) ? [CAP, UP] : [CAP]) {
      const dest = path.join(dirOf(cap), name);
      const { json, bin } = readGlb(bytes);
      const caps = cuts(json, cap);
      if (!caps) {
        console.log(`  ${rel}: left whole (a picture used two ways, or not in the file)`);
        skipped++;
        continue;
      }
      // (made already from this very file)
      if (!force && fs.existsSync(dest) && fs.statSync(dest).size < bytes.length) {
        made.add(path.resolve(dest));
        was += bytes.length;
        now += fs.statSync(dest).size;
        continue;
      }
      const replaced = new Map();
      for (const [i, cap] of caps) {
        const img = json.images[i];
        const view = json.bufferViews[img.bufferView];
        const own = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        const small = await page.cut(own, img.mimeType, cap);
        if (!small) continue;
        const raw = Buffer.from(small.raw, 'base64');
        const webp = await sharp(raw, { raw: { width: small.w, height: small.h, channels: 4 } }).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
        // (unpacked again as the game unpacks it: the very pixels, or nothing is written)
        if ((await page.back(webp, 'image/webp')) !== small.raw) throw new Error(`${rel}: picture ${i} did not come back the same`);
        // (lossless at 256 can outweigh lossy at 512: then the picture stays as it came, and is cut on arrival as before)
        if (webp.length >= own.length) continue;
        replaced.set(view, webp);
        img.mimeType = 'image/webp';
      }
      if (!replaced.size) {
        whole++;
        continue;
      }
      const out = rebuild(json, bin, replaced);
      if (out.length >= bytes.length) {
        whole++;
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, out);
      made.add(path.resolve(dest));
      was += bytes.length;
      now += out.length;
      copied++;
      console.log(`  ${rel}: ${(bytes.length / 1048576).toFixed(2)} -> ${(out.length / 1048576).toFixed(2)} MB`);
    }
  }
} finally {
  await page.close();
}

// (copies of files that have since changed or gone)
let stale = 0;
const sweep = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, f.name);
    if (f.isDirectory()) sweep(file);
    else if (!made.has(path.resolve(file))) {
      fs.rmSync(file);
      stale++;
    }
  }
};
for (const out of OUTS) sweep(out);
console.log(`${made.size} copies (${copied} made now, ${stale} old ones taken away), ${whole} files small enough as they are, ${skipped} left whole: ${(was / 1048576).toFixed(1)} -> ${(now / 1048576).toFixed(1)} MB`);
