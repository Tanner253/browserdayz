// What colour each survivor's own base layer is, by part of the body (2026-11-11): the shirt and the shorts painted on
// it, against its skin, as its picture has them at its points. node scripts/base-colours.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const REGION = ['scalp', 'face', 'neck', 'chest', 'belly', 'hips', 'shoulder', 'upperArm', 'forearm', 'hand', 'thigh', 'aboveKnee', 'shin', 'foot'];
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (let n = 0; n < 4; n++) {
  const doc = await io.read(`public/assets/characters/body_${n}.glb`);
  const by = REGION.map(() => []);
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const reg = prim.getAttribute('_REGION'), uv = prim.getAttribute('TEXCOORD_0'), tex = prim.getMaterial()?.getBaseColorTexture();
    if (!reg || !uv || !tex) continue;
    const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < reg.getCount(); i++) {
      const [s, t] = uv.getElement(i, []);
      const x = Math.min(info.width - 1, Math.max(0, Math.round(s * (info.width - 1)))), y = Math.min(info.height - 1, Math.max(0, Math.round(t * (info.height - 1))));
      const o = (y * info.width + x) * 3;
      const c = [lin(data[o] / 255), lin(data[o + 1] / 255), lin(data[o + 2] / 255)];
      const hi = Math.max(...c), lo = Math.min(...c);
      by[Math.round(reg.getScalar(i))]?.push({ L: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], sat: (hi - lo) / Math.max(hi, 1e-3) });
    }
  }
  console.log(`body ${n}`);
  for (const r of ['neck', 'chest', 'belly', 'hips', 'shoulder', 'upperArm', 'thigh']) {
    const v = by[REGION.indexOf(r)];
    if (!v.length) continue;
    const q = (k, p) => [...v].map((e) => e[k]).sort((a, b) => a - b)[Math.floor(v.length * p)].toFixed(3);
    // (grey: little colour; its share of the part, and how light the grey is)
    const grey = v.filter((e) => e.sat < 0.14), gq = (p) => (grey.length ? [...grey].map((e) => e.L).sort((a, b) => a - b)[Math.floor(grey.length * p)].toFixed(3) : '-');
    console.log(`  ${r.padEnd(9)} n ${String(v.length).padStart(5)}  light ${q('L', 0.1)} ${q('L', 0.5)} ${q('L', 0.9)}  colour ${q('sat', 0.1)} ${q('sat', 0.5)} ${q('sat', 0.9)}  grey ${(grey.length / v.length * 100).toFixed(0).padStart(3)}% light ${gq(0.1)} ${gq(0.5)} ${gq(0.9)}`);
  }
}
