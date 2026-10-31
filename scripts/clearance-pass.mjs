// The clearance pass: the badge holder from Higgsfield with a printed pass laid in its window, a QR pattern on it to be scanned
// (the owner, 2026-10-31: "more like an ID card with a QR code on it or somethjing to scan for access"). One model for all five:
// its two bands are pure white, and each item's `paint` turns them its own colour, so the rest must stay off white (see whiteTo in
// src/game/loot.ts). The holder faces +x with its clip up; it is laid down on its back, face up, clip to -z, as a card lies.
//   node scripts/clearance-pass.mjs
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const DIR = 'assets-src/incoming/higgsfield/toys';
/** the window in the holder, metres: how high its foot and head stand and half its width, a little under the frame all round */
const WINDOW = { y0: 0.0035, y1: 0.0905, half: 0.034 };
const W = 512, H = Math.round((W * (WINDOW.y1 - WINDOW.y0)) / (WINDOW.half * 2));
const CREAM = '#e8d09a', INK = '#17181a';

/** a QR's look: its three finders, its timing lines and its alignment mark, the rest by a fixed lot */
function qr(x0, y0, size) {
  const n = 29, cell = size / n;
  let s = 2917;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const on = Array.from({ length: n }, () => Array.from({ length: n }, () => rnd() < 0.5));
  const square = (cx, cy, r, v) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (on[y]?.[x] !== undefined) on[y][x] = v(Math.max(Math.abs(x - cx), Math.abs(y - cy)));
  };
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) square(cx, cy, 4, (d) => d !== 2 && d !== 4);
  square(n - 7, n - 7, 2, (d) => d !== 1);
  for (let k = 8; k < n - 8; k++) on[6][k] = on[k][6] = k % 2 === 0;
  let out = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (on[y][x]) out += `<rect x="${(x0 + x * cell).toFixed(2)}" y="${(y0 + y * cell).toFixed(2)}" width="${(cell + 0.4).toFixed(2)}" height="${(cell + 0.4).toFixed(2)}"/>`;
  return out;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <rect width="${W}" height="84" fill="#fff"/>
  <rect y="${H - 42}" width="${W}" height="42" fill="#fff"/>
  <g fill="${INK}" font-family="Arial, Helvetica, sans-serif">
    <text x="28" y="132" font-size="42" font-weight="900" textLength="456" lengthAdjust="spacingAndGlyphs">CLEARANCE PASS</text>
    <text x="28" y="162" font-size="19" font-weight="700" textLength="456" lengthAdjust="spacingAndGlyphs">RANGE CONTROL · BUNKER 17 GARRISON</text>
    <rect x="28" y="182" width="156" height="196" fill="#3a3a38"/>
    <circle cx="106" cy="254" r="40" fill="#6f6a5e"/>
    <path d="M44 378 C44 318 168 318 168 378 Z" fill="#6f6a5e"/>
    <text x="28" y="412" font-size="21" font-family="Courier New, monospace" font-weight="700">NO. 0417-C</text>
    <text x="28" y="440" font-size="21" font-family="Courier New, monospace" font-weight="700">KEEP ON PERSON</text>
    <g>${qr(204, 182, 280)}</g>
    <text x="28" y="${H - 66}" font-size="36" font-weight="900" textLength="456" lengthAdjust="spacingAndGlyphs">SCAN AT THE READER</text>
  </g>
</svg>`;
const print = await sharp(Buffer.from(svg)).png().toBuffer();

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(`${DIR}/pass_holder_sized.glb`);
const root = doc.getRoot(), scene = root.listScenes()[0], buffer = root.listBuffers()[0];
const holder = scene.listChildren();

// (the pass stands in the middle of the frame's own thickness, whatever the clip does to the model's box)
const box = getBounds(scene), xs = [];
for (const n of holder) {
  const m = n.getMesh(), k = n.getScale(), t = n.getTranslation();
  for (const p of m.listPrimitives()) {
    const a = p.getAttribute('POSITION'), v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      if (v[1] * k[1] + t[1] < WINDOW.y1) xs.push(v[0] * k[0] + t[0]);
    }
  }
}
xs.sort((a, b) => a - b);
const mid = xs[xs.length >> 1];

// (the generator left the frame stuck with pins, a few millimetres each: drawn back into the frame's own thickness and width)
const FRAME = { x: 0.0042, z: 0.0398 };
for (const n of holder) {
  const m = n.getMesh(), k = n.getScale(), t = n.getTranslation();
  for (const p of m.listPrimitives()) {
    const a = p.getAttribute('POSITION'), v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      if (v[1] * k[1] + t[1] > 0.105) continue;
      const x = v[0] * k[0] + t[0], z = v[2] * k[2] + t[2];
      v[0] = (Math.max(mid - FRAME.x, Math.min(mid + FRAME.x, x)) - t[0]) / k[0];
      v[2] = (Math.max(-FRAME.z, Math.min(FRAME.z, z)) - t[2]) / k[2];
      a.setElement(i, v);
    }
  }
}

const side = (name, x, normal, uvs, material) => {
  const { y0, y1, half } = WINDOW;
  const pos = doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([x, y1, half, x, y1, -half, x, y0, -half, x, y0, half]));
  const nor = doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([normal, 0, 0, normal, 0, 0, normal, 0, 0, normal, 0, 0]));
  const uv = doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(new Float32Array(uvs));
  const idx = doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array(normal > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]));
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(material);
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
};
const face = doc.createMaterial('pass print').setBaseColorTexture(doc.createTexture('pass print').setImage(new Uint8Array(print)).setMimeType('image/png')).setRoughnessFactor(0.55).setMetallicFactor(0);
const back = doc.createMaterial('pass back').setBaseColorFactor([0.1, 0.1, 0.11, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);

// (seen from +x with y up, the picture's right is -z)
const turned = doc.createNode('clearance pass').setRotation([-0.5, -0.5, 0.5, 0.5]);
for (const n of holder) {
  scene.removeChild(n);
  turned.addChild(n);
}
turned.addChild(side('pass front', mid + 0.0004, 1, [0, 0, 1, 0, 1, 1, 0, 1], face));
turned.addChild(side('pass back', mid - 0.0004, -1, [0, 0, 1, 0, 1, 1, 0, 1], back));
scene.addChild(turned);
const now = getBounds(scene);
turned.setTranslation([-(now.max[0] + now.min[0]) / 2, -now.min[1], -(now.max[2] + now.min[2]) / 2]);
await io.write(`${DIR}/clearance_pass.glb`, doc);
const end = getBounds(scene);
console.log('clearance pass', end.max.map((v, i) => +(v - end.min[i]).toFixed(3)), 'print', W, H, 'frame at x', +mid.toFixed(4), 'of', box.min[0].toFixed(3), box.max[0].toFixed(3));
