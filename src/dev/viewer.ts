// A look at models as the game will load them, without starting the game: for whoever is
// fitting a new one. Not part of the built site (viewer.html is not in the build).
//   /viewer.html?m=plate_carrier,weapons_case        models by their id in the manifest
//   &yaw=0.6&pitch=0.3                               from where (radians)
// Each stands in its own square on a floor of 10 cm tiles, lit by a plain sky.

import * as THREE from 'three';
import { assets } from '../core/assets';

const q = new URLSearchParams(location.search);
const ids = (q.get('m') ?? '').split(',').filter(Boolean);
const yaw = +(q.get('yaw') ?? 0.7), pitch = +(q.get('pitch') ?? 0.35);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const label = document.createElement('div');
label.style.cssText = 'position:fixed;left:8px;top:6px;font:12px/1.5 monospace;color:#dfe6ea;white-space:pre';
document.body.appendChild(label);

await assets.init();
const cols = Math.ceil(Math.sqrt(ids.length)) || 1, rows = Math.ceil(ids.length / cols) || 1;
const views: { scene: THREE.Scene; camera: THREE.PerspectiveCamera }[] = [];
const lines: string[] = [];
for (const id of ids) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3138);
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x57503f, 2.4));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  // (`character`: the player's body as its file has it, standing as its skeleton rests; `character+` with what is worn)
  const model = id.startsWith('character') ? (await assets.loadGLTF('assets/characters/survivor.glb')).scene : await assets.model(id);
  if (id === 'character') model.traverse((o) => { if (o.name.startsWith('gear_')) o.visible = false; });
  model.updateMatrixWorld(true);
  model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) { (o as THREE.SkinnedMesh).frustumCulled = false; (o as THREE.SkinnedMesh).computeBoundingBox(); } });
  scene.add(model);
  const box = id.startsWith('character') ? new THREE.Box3(new THREE.Vector3(-0.9, 0, -0.3), new THREE.Vector3(0.9, 1.85, 0.3)) : new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  const grid = new THREE.GridHelper(Math.ceil(span * 20) / 10 + 0.2, Math.round((Math.ceil(span * 20) / 10 + 0.2) * 10), 0x8a949c, 0x4a535b);
  scene.add(grid);
  // (x red, y green, z blue: which way it faces)
  scene.add(new THREE.AxesHelper(span * 0.6));
  const camera = new THREE.PerspectiveCamera(30, innerWidth / cols / (innerHeight / rows), 0.01, 100);
  const d = span * 2.6;
  camera.position.set(mid.x + Math.sin(yaw) * Math.cos(pitch) * d, mid.y + Math.sin(pitch) * d, mid.z + Math.cos(yaw) * Math.cos(pitch) * d);
  camera.lookAt(mid);
  views.push({ scene, camera });
  let tris = 0;
  model.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  lines.push(`${id}: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m, ${tris} triangles`);
}
label.textContent = lines.join('\n');
renderer.setScissorTest(true);
views.forEach((v, i) => {
  const w = innerWidth / cols, h = innerHeight / rows;
  const x = (i % cols) * w, y = innerHeight - (Math.floor(i / cols) + 1) * h;
  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.render(v.scene, v.camera);
});
(window as unknown as { viewed: boolean }).viewed = true;
