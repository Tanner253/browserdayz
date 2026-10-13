// A model looked at by itself, without the game: drawn from several sides by a headless Chrome and three.js, the
// views side by side in one picture.
//
//   node assets-src/_wf/me/look.mjs <model.gltf|.glb> <out.jpg> [view ...]
//
// A view is "az,el[,dist]" (degrees round it and up from level; how far off, in its own sizes, 1.6 if not said), or
// "in:az[,el]" for a look from its middle, a man's height over its foot. Without any: four from outside.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const [model, out, ...views] = process.argv.slice(2);
if (!model || !out) throw new Error('node assets-src/_wf/me/look.mjs <model> <out.jpg> [views]');
const V = views.length ? views : ['35,18', '215,18', '125,50', '0,88'];
const cols = Math.min(V.length, V.length > 4 ? 3 : 2), rows = Math.ceil(V.length / cols), W = 640, H = 480, PORT = 9337;
const three = pathToFileURL(path.resolve('node_modules/three')).href;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-look-'));
fs.writeFileSync(path.join(dir, 'look.html'), `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"${three}/build/three.module.js","three/addons/":"${three}/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
window.shot = (async () => {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(${W * cols}, ${H * rows});
  r.setScissorTest(true);
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8b9199);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5346, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(${JSON.stringify(pathToFileURL(path.resolve(model)).href)});
  scene.add(g.scene);
  g.scene.traverse((o) => { if (o.material) o.material.side = THREE.DoubleSide; });
  const box = new THREE.Box3().setFromObject(g.scene), mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), rad = size.length() / 2;
  const grid = new THREE.GridHelper(Math.ceil(rad * 4), Math.ceil(rad * 4), 0x333333, 0x555555);
  grid.position.set(mid.x, box.min.y, mid.z);
  scene.add(grid);
  const views = ${JSON.stringify(V)};
  views.forEach((v, i) => {
    const inside = v.startsWith('in:'), n = v.replace('in:', '').split(',').map(Number);
    const az = n[0] * Math.PI / 180, el = (n[1] ?? (inside ? 0 : 18)) * Math.PI / 180;
    const cam = new THREE.PerspectiveCamera(inside ? 75 : 40, ${W} / ${H}, rad / 200, rad * 40);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    if (inside) {
      cam.position.set(mid.x, box.min.y + Math.min(1.6, size.y * 0.5), mid.z);
      cam.lookAt(cam.position.clone().add(dir));
    } else {
      cam.position.copy(mid).addScaledVector(dir, rad * (n[2] ?? 1.6) * 1.9);
      cam.lookAt(mid);
    }
    const x = (i % ${cols}) * ${W}, y = (${rows} - 1 - Math.floor(i / ${cols})) * ${H};
    r.setViewport(x, y, ${W}, ${H});
    r.setScissor(x, y, ${W}, ${H});
    r.render(scene, cam);
  });
  return { png: r.domElement.toDataURL('image/jpeg', 0.85).split(',')[1], size: size.toArray().map((s) => +s.toFixed(3)), min: box.min.toArray().map((s) => +s.toFixed(3)) };
})();
</script>`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(dir, 'p')}`, '--allow-file-access-from-files', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-compositing', `--window-size=${W * cols},${H * rows}`, pathToFileURL(path.join(dir, 'look.html')).href], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let page = null;
  for (let k = 0; k < 60 && !page; k++) {
    await sleep(250);
    try {
      page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.endsWith('look.html'));
    } catch {
      // not up yet
    }
  }
  if (!page) throw new Error('Chrome did not open the page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  await new Promise((ok, no) => (ws.once('open', ok), ws.once('error', no)));
  const r = await new Promise((ok, no) => {
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.id !== 1) return;
      if (m.error || m.result?.exceptionDetails) no(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails).slice(0, 500)));
      else ok(m.result.result.value);
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '(async () => { for (let k = 0; k < 200 && !window.shot; k++) await new Promise((r) => setTimeout(r, 100)); return window.shot; })()', awaitPromise: true, returnByValue: true } }));
  });
  fs.writeFileSync(out, Buffer.from(r.png, 'base64'));
  console.log(`${out}: ${V.join(' | ')}; size ${r.size.join(' x ')}, lowest corner ${r.min.join(', ')}`);
  ws.close();
} finally {
  chrome.kill();
  await sleep(400);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Chrome still letting go
  }
}
