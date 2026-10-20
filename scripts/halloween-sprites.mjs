// The Halloween pumpkins round the title on the loading screen (src/ui/loading-fx.ts), drawn from a real model once,
// here, into small pictures, so that the screen itself draws no 3D. The owner, 2026-10-20: "its october halloween this
// month we should throw some pumpkins and jackolanterns ... around the zona title text make it look 3d almost", and of
// the three models they gave: "just use th epumpkins th eoptoer 2 look terrible". The one model, CC BY 4.0 (credited
// in CREDITS.md): assets-src/models/pumpkin_halloween_animation, "Pumpkin Halloween Animation" by fuckcomicsanss.
// Seen from in front it is a jack-o'-lantern, from behind a pumpkin with nothing cut in it; the lantern is drawn
// twice, dark and with a candle in it, for the screen to flicker the one over the other.
//
//   node scripts/halloween-sprites.mjs             -> public/brand/halloween-<name>.webp
//   node scripts/halloween-sprites.mjs --preview   all of them on the screen's dark -> progress/loading-anim/halloween.png
//
// A page with three.js on a server of its own, opened in the headless browser (assets-src/_wf/me/play.mjs), sends
// back each picture it draws; this keeps the ones asked for, trimmed to what is in them.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// (assets-src lives only in the main checkout: from a worktree under .claude/worktrees, it is three up)
const MAIN = ['', '../../..'].map((up) => path.join(ROOT, up)).find((p) => fs.existsSync(path.join(p, 'assets-src', 'models')));
if (!MAIN) throw new Error('assets-src/models is not here');
const PREVIEW = process.argv.includes('--preview');

/** each picture: the side it is seen from (radians round and down), whether a candle burns in it, and the size it
 * is kept at (px of its longer side, about twice what the screen shows it at) */
const DIR = 'pumpkin_halloween_animation';
const PIECES = [
  { name: 'lantern', yaw: 0.3, pitch: 0.14, px: 160 },
  { name: 'lantern-lit', yaw: 0.3, pitch: 0.14, candle: true, px: 160 },
  { name: 'pumpkin', yaw: 3.45, pitch: 0.3, px: 112 },
];

const page = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
const jobs = ${JSON.stringify(PIECES.map((p) => ({ ...p, dir: DIR, key: p.name })))};
const S = 512;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(S, S);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const loaded = {};
for (const job of jobs) {
  const gltf = (loaded[job.dir] ??= await new GLTFLoader().loadAsync('/m/' + job.dir + '/scene.gltf'));
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  // a cold key from above and to the left, a warm fill from below (the glow of a lantern), a rim behind
  const key = new THREE.DirectionalLight(0xdfe8ff, 2.2); key.position.set(-2, 3, 2.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffa04a, 0.9); fill.position.set(1.5, -1.5, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 2.4); rim.position.set(1, 1.5, -3); scene.add(rim);
  // (a rigged model's copy must have bones of its own: a plain copy's skin follows the first one's)
  const root = clone(gltf.scene);
  if (gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(root);
    // (its one animation holds it in its pose)
    mixer.clipAction(gltf.animations[0]).play();
    mixer.setTime(0);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  root.position.sub(mid);
  const turn = new THREE.Group(); turn.add(root); turn.rotation.y = job.yaw; scene.add(turn);
  const r = size.length() / 2;
  // the candle: a warm light in its middle, which reaches only the inside of the shell, seen through what is cut
  if (job.candle) { const c = new THREE.PointLight(0xff6a0a, 12 * r * r, r * 3, 2); c.position.set(0, -0.1 * size.y, 0); turn.add(c); }
  const camera = new THREE.PerspectiveCamera(30, 1, r / 20, r * 20);
  const d = r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
  camera.position.set(0, Math.sin(job.pitch) * d, Math.cos(job.pitch) * d);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL('image/png');
  await fetch('/save?key=' + job.key, { method: 'POST', body: png });
}
window.__done = jobs.length + ' drawn';
</script></body></html>`;

const got = new Map();
const types = { '.js': 'text/javascript', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/save') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      got.set(url.searchParams.get('key'), Buffer.from(Buffer.concat(parts).toString().split(',')[1], 'base64'));
      res.end('ok');
    });
    return;
  }
  const file = url.pathname === '/' ? null
    : url.pathname.startsWith('/three/') ? path.join(MAIN, 'node_modules', 'three', decodeURIComponent(url.pathname.slice(7)))
    : url.pathname.startsWith('/m/') ? path.join(MAIN, 'assets-src', 'models', decodeURIComponent(url.pathname.slice(3)))
    : '';
  if (file === null) return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  if (!file || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const address = `http://127.0.0.1:${server.address().port}/`;

// the headless browser, waiting its turn for the graphics card as every run does
const wait = path.join(MAIN, 'progress', 'loading-anim', '_wait-sprites.js');
fs.mkdirSync(path.dirname(wait), { recursive: true });
fs.writeFileSync(wait, 'for (let k = 0; k < 600 && !window.__done; k++) await new Promise((r) => setTimeout(r, 100));\nreturn window.__done || "never finished";');
await new Promise((ok, no) => {
  const p = spawn(process.execPath, [path.join(MAIN, 'assets-src', '_wf', 'me', 'play.mjs'), wait, path.join(MAIN, 'progress', 'loading-anim', '_shots'), '600', '600', address], {
    env: { ...process.env, PLAY_NOWAIT: '1', PLAY_PORT: process.env.PLAY_PORT || '9361' },
    stdio: 'inherit',
  });
  p.on('exit', (code) => (code ? no(new Error(`play.mjs ${code}`)) : ok()));
});
server.close();

const shots = PIECES.map((p) => {
  const b = got.get(p.name);
  if (!b) throw new Error(`${p.name} was not drawn`);
  return b;
});
if (PREVIEW) {
  const T = 384, out = path.join(MAIN, 'progress', 'loading-anim', 'halloween.png');
  await sharp({ create: { width: T * PIECES.length, height: T, channels: 4, background: '#151716' } })
    .composite(await Promise.all(shots.map(async (b, i) => ({ input: await sharp(b).resize(T, T).toBuffer(), left: i * T, top: 0 }))))
    .png()
    .toFile(out);
  console.log(out);
} else {
  // (the lantern's two pictures are trimmed alike, so the one lies exactly over the other)
  const box = await sharp(shots[0]).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  for (const [i, p] of PIECES.entries()) {
    const out = path.join(ROOT, 'public', 'brand', `halloween-${p.name}.webp`);
    const cut = p.name.startsWith('lantern')
      ? sharp(shots[i]).extract({ left: -box.info.trimOffsetLeft, top: -box.info.trimOffsetTop, width: box.info.width, height: box.info.height })
      : sharp(await sharp(shots[i]).trim({ threshold: 1 }).toBuffer());
    await sharp(await cut.toBuffer()).resize(p.px, p.px, { fit: 'inside' }).webp({ quality: 86, alphaQuality: 90 }).toFile(out);
    const m = await sharp(out).metadata();
    console.log(`${out} ${m.width}x${m.height} ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
  }
}
