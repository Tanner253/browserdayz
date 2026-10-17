// What is in a weapon pack as it came (node scripts/pack-look.mjs <dir under assets-src/models>): its meshes (and
// whether skinned), its skeleton's arm, hand and gun joints, any camera, and its animations with their lengths. All a
// WEAPON_PACKS entry in scripts/assets.config.mjs needs to be written.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const dir = process.argv[2];
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(`assets-src/models/${dir}/scene.gltf`);
const root = doc.getRoot();
console.log('meshes:');
for (const n of root.listNodes()) {
  const m = n.getMesh();
  if (m) console.log(`  node ${n.getName()} | mesh ${m.getName()} | ${m.listPrimitives().map((p) => `${p.getMaterial()?.getName()}:${p.getAttribute('POSITION').getCount()}`).join(',')}${n.getSkin() ? ' | skinned' : ''}`);
}
const skins = root.listSkins();
const joints = new Set(skins.flatMap((s) => s.listJoints()));
console.log(`skins ${skins.length}, joints ${joints.size}`);
// (the joints worth naming in the entry: arms, hands, a gun's moving parts, a camera; not every finger's joint)
const wanted = /arm|hand|wrist|cam|eye|head|weapon|gun|mag|bolt|slide|trigger|charg|safety|fire|hammer|stock|cock|grip|shell|round|bullet|barrel|spare|clip|pin|lever|^root/i;
for (const j of joints) if (wanted.test(j.getName()) && !/finger|thumb|index|middle|ring|pinky|_end/i.test(j.getName())) console.log(`  joint ${j.getName()} <- ${j.getParentNode?.()?.getName?.() ?? ''}`);
for (const n of root.listNodes()) if (n.getCamera()) console.log(`camera node ${n.getName()} at ${n.getWorldTranslation().map((v) => v.toFixed(3))}`);
console.log('animations:');
for (const a of root.listAnimations()) {
  let end = 0;
  for (const s of a.listSamplers()) end = Math.max(end, s.getInput()?.getMax([0])[0] ?? 0);
  console.log(`  ${a.getName()}  ${end.toFixed(2)} s  (${a.listChannels().length} channels)`);
}
console.log('licence:', (await import('node:fs')).readFileSync(`assets-src/models/${dir}/license.txt`, 'utf8').split('\n').filter((l) => /author|license|title|url|by /i.test(l)).slice(0, 6).join(' | '));
