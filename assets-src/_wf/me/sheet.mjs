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


const [out, ...models] = process.argv.slice(2);
if (!out || !models.length) throw new Error('node assets-src/_wf/me/sheet.mjs <out.jpg> <model> [<model> ...]');
const cols = Math.min(models.length, 6), rows = Math.ceil(models.length / cols), W = 300, H = 300, PORT = 9339;
const V = ['sheet'];
const three = pathToFileURL(path.resolve('node_modules/three')).href;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-sheet-'));
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
  const models = ${JSON.stringify(models.map((m) => pathToFileURL(path.resolve(m)).href))};
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (let i = 0; i < models.length; i++) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9aa0a8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(2, 6, 5);
    scene.add(sun);
    const g = await loader.loadAsync(models[i]);
    scene.add(g.scene);
    g.scene.traverse((o) => { if (o.material) { o.material.side = THREE.DoubleSide; o.material.metalness = Math.min(o.material.metalness ?? 0, 0.3); } });
    const box = new THREE.Box3().setFromObject(g.scene), mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), rad = size.length() / 2;
    // +z, along the ground: red; +x: green
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(mid.x, 0.01, box.max.z), rad * 0.45, 0xff2020, rad * 0.15, rad * 0.1));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(box.max.x, 0.01, mid.z), rad * 0.45, 0x20c020, rad * 0.15, rad * 0.1));
    const cam = new THREE.PerspectiveCamera(36, 1, rad / 100, rad * 40);
    const az = 0.5, el = 0.6;
    cam.position.copy(mid).add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(rad * 3.6));
    cam.lookAt(mid);
    const x = (i % ${cols}) * ${W}, y = (${rows} - 1 - Math.floor(i / ${cols})) * ${H};
    r.setViewport(x, y, ${W}, ${H});
    r.setScissor(x, y, ${W}, ${H});
    r.render(scene, cam);
  }
  return { png: r.domElement.toDataURL('image/jpeg', 0.88).split(',')[1], size: [0, 0, 0], min: [0, 0, 0] };
})();
</script>`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(dir, 'p')}`, '--allow-file-access-from-files', '--enable-unsafe-swiftshader', `--window-size=${W * cols},${H * rows}`, pathToFileURL(path.join(dir, 'look.html')).href], { stdio: 'ignore' });
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
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '(async () => { for (let k = 0; k < 600 && !window.shot; k++) await new Promise((r) => setTimeout(r, 100)); return window.shot; })()', awaitPromise: true, returnByValue: true } }));
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
