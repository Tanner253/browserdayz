// The sandbox (the stage until 2026-10-24, the owner: "lets rename this to the sanbox"): a plain place to look at one
// thing at a time, the same way every time (2026-10-24, the owner: "think when you make a new project on unity, youre in
// a plain environment i would expect that to be our test environment"; sessions were losing hours retaking pictures in
// the world, where ground, light, weather and camera all moved).
// A flat floor with a 1 m grid, a fixed sun and the game's own sky light, a survivor beside the thing for its size, and
// fixed cameras framed on it: one picture holds every view, in one pass. No world, no server, no weather.
// Not part of the built site (tools/sandbox.html is not in the build).
//
//   /tools/sandbox.html?m=plate_carrier          models by their manifest id (as the game loads them)
//   &g=assets/animals/wolf.glb                  a glTF file by its path, with its animations
//   &clip=run&t=0.25                            that animation (name or number) at that share of its length; with
//                                               several files, one each (clip=walk,mc_walk: the old beside the new)
//   &survivor=0,1,2,3&clip=walk&t=0.3          the survivors' bodies (src/game/survivors.ts) on the game's skeleton, playing
//                                               one of its clips; today's survivor beside them plays it too
//   &hide=chest,belly                           (and those parts of them not drawn, as under clothes: REGION in src/sim/survivor.ts)
//   &wear=m65~2a2a2a,jeans~woodland             (and things worn over them, src/game/survivors.ts: a colour or a camouflage after a ~;
//   &shrink=hips,thigh                           the parts only partly under them drawn a little in)
//   &animal=wolf&mode=run                       an animal as the game draws it (src/game/animals.ts, stageAnimal):
//                                               its model, the movement it plays doing that, lifted as in the game
//   &sim=wolves-vs-deer | lockon                the animals' own minds run on the floor, their moments in one
//                                               picture (src/dev/sandbox-sim.ts)
//   &strip=8                                    eight moments across the clip instead, from the first view
//   &views=side,front,back,top,q                which cameras (q: three-quarter); default side,front,q,top
//   &near=0.4,1.1,0,0.6                         every camera on that point (x, y, z in metres) from that far: a hand, a face
//   &yaw=90                                     the thing turned, degrees
//   &sun=day|dusk                               default day
//   &bg=20231f&floor=0                          a plain backdrop of that colour and no floor (pictures for the page)
//   &person=0                                   no survivor beside it; &body=2 which survivor (src/game/survivors.ts BODIES)
//   &cell=640x360                               each view's size; the page is laid out to hold them all
//   &ui=inventory&kit=heavy, &ui=hud, &touch=1  a screen of the game over it (src/dev/sandbox-inventory.ts)
//   &bb=items | fell                            base building's scenes (src/dev/sandbox-build.ts)
// When the picture is drawn, window.staged is true and window.stageInfo says what was drawn (size, triangles, clips).
// Headless, in one pass and off the graphics card's queue:
//   PLAY_NOWAIT=1 PLAY_GL=swiftshader node assets-src/_wf/me/play.mjs assets-src/_wf/me/stage-shot.js <out> 1280 720 "http://localhost:5173/tools/sandbox.html?..."

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../core/assets';

const q = new URLSearchParams(location.search);
const list = (k: string) => (q.get(k) ?? '').split(',').filter(Boolean);
const files = list('g'), animal = q.get('animal'), survivors = list('survivor').map(Number);
// (a screen of the game with nothing named to stand behind it: a pack on the floor, so there is something)
const ids = list('m').length || files.length || animal || survivors.length || !q.get('ui') ? list('m') : ['military_backpack'];
const views = list('views').length ? list('views') : ['side', 'front', 'q', 'top'];
const strip = Math.max(0, Math.floor(+(q.get('strip') ?? 0)));
// (an animal faces -z, as the game has them: turned a quarter by default, so that 'side' sees its side)
const yaw = (+(q.get('yaw') ?? (q.get('animal') ? 90 : 0)) * Math.PI) / 180;
const dusk = q.get('sun') === 'dusk', person = q.get('person') !== '0';
const [cw, ch] = (q.get('cell') ?? '640x360').split('x').map(Number);

const sim = q.get('sim'), bb = q.get('bb');
const { BUILD_CELLS, BUILD_COLS } = bb ? await import('./sandbox-build') : { BUILD_CELLS: {} as Record<string, number>, BUILD_COLS: {} as Record<string, number> };
const cells = bb ? BUILD_CELLS[bb] ?? 1 : sim ? 8 : strip > 0 ? strip : views.length;
const cols = Math.min(cells, bb ? BUILD_COLS[bb] ?? 2 : strip > 0 || sim ? 4 : 2), rows = Math.ceil(cells / cols);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(cw * cols, ch * rows);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.style.cssText = 'margin:0;background:#000';
document.body.appendChild(renderer.domElement);

await assets.init();
const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('bg') ? Number(`0x${q.get('bg')}`) : dusk ? 0x4a4f63 : 0xb9c7d6);
// (the game's own sky for light, so a material that is wrong in the game is wrong here too: the wolf's pale coat was)
const env = await assets.hdri(assets.manifest.hdri.env);
env.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(env).texture;
scene.environmentIntensity = dusk ? 0.35 : 0.9;
const sun = new THREE.DirectionalLight(dusk ? 0xffb27a : 0xfff1dc, dusk ? 1.2 : 2.8);
sun.position.set(6, dusk ? 2.5 : 9, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xdfe8f2, 0x6b6656, dusk ? 0.25 : 0.6));

// (the floor: mid grey, a line every metre, a darker one every ten, as a new project's plain ground)
const tile = document.createElement('canvas');
tile.width = tile.height = 256;
const t2 = tile.getContext('2d')!;
t2.fillStyle = '#8d9089';
t2.fillRect(0, 0, 256, 256);
t2.strokeStyle = '#767971';
t2.lineWidth = 2;
for (let i = 0; i <= 10; i++) {
  t2.lineWidth = i % 10 === 0 ? 4 : 1.5;
  t2.beginPath(); t2.moveTo(i * 25.6, 0); t2.lineTo(i * 25.6, 256); t2.stroke();
  t2.beginPath(); t2.moveTo(0, i * 25.6); t2.lineTo(256, i * 25.6); t2.stroke();
}
const floorTex = new THREE.CanvasTexture(tile);
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(20, 20);
floorTex.colorSpace = THREE.SRGBColorSpace;
floorTex.anisotropy = 8;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.visible = q.get('floor') !== '0';
scene.add(floor);

// (the words on each view: which camera, and the moment of the clip)
const words = document.createElement('canvas');
words.width = cw * cols;
words.height = ch * rows;
words.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none';
document.body.appendChild(words);
const w2 = words.getContext('2d')!;
w2.font = '14px monospace';
const say = (i: number, text: string) => {
  const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
  w2.fillStyle = 'rgba(0,0,0,0.55)';
  w2.fillRect(cx, cy, w2.measureText(text).width + 12, 22);
  w2.fillStyle = '#fff';
  w2.fillText(text, cx + 6, cy + 16);
};

if (bb) {
  // (base building's scenes: src/dev/sandbox-build.ts)
  const { stageBuild } = await import('./sandbox-build');
  const out = window as unknown as { staged: boolean; stageInfo: unknown };
  out.stageInfo = await stageBuild(bb, { q, scene, renderer, sun, cw, ch, cols, rows, say });
  out.staged = true;
} else if (sim) {
  // (the animals' own minds on the floor, their moments in one picture: src/dev/sandbox-sim.ts)
  const { stageSim } = await import('./sandbox-sim');
  const body = async () => {
    const b = (await assets.loadGLTF('assets/characters/survivor.glb')).scene;
    b.traverse((o) => { if (o.name.startsWith('gear_')) o.visible = false; });
    return b;
  };
  const out = window as unknown as { staged: boolean; stageInfo: unknown };
  out.stageInfo = await stageSim(sim, { q, scene, renderer, sun, floor, cw, ch, cols, rows, say, body });
  out.staged = true;
} else {
  // ---- the thing(s): side by side along x, each standing on the floor
  const thing = new THREE.Group();
  scene.add(thing);
  const info: Record<string, unknown>[] = [];
  let mixer: THREE.AnimationMixer | null = null, action: THREE.AnimationAction | null = null;
  // (every file's own, side by side: each is stepped across a strip by its own length)
  const played: THREE.AnimationAction[] = [];
  const shadowed = (o: THREE.Object3D) => o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
    }
  });
  const triangles = (o: THREE.Object3D) => {
    let n = 0;
    o.traverse((m) => {
      const g = (m as THREE.Mesh).geometry;
      if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return n;
  };
  /** the biggest colour picture it is drawn with, as the game cut it (see DESK_NEAR in src/core/assets.ts) */
  const picture = (o: THREE.Object3D) => {
    let n = 0;
    o.traverse((m) => {
      for (const mat of ([] as THREE.Material[]).concat((m as THREE.Mesh).material ?? [])) {
        const img = (mat as THREE.MeshStandardMaterial).map?.image as { width?: number; height?: number } | undefined;
        if (img?.width) n = Math.max(n, img.width, img.height ?? 0);
      }
    });
    return n;
  };
  let x = 0;
  const place = (o: THREE.Object3D, name: string, extra: Record<string, unknown> = {}, asIs = false) => {
    o.rotation.y = yaw;
    shadowed(o);
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    // (a skinned body whose bones are not yet worked out gives no box: a metre cube, so it is still framed)
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.y)) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const size = box.getSize(new THREE.Vector3());
    // (stood on the floor and laid next to the one before, half a metre apart)
    o.position.x += x - box.min.x;
    // (an animal stands where the game stands it, its root on the ground, and is not set down by its box)
    if (!asIs) o.position.y -= box.min.y;
    o.position.z -= (box.min.z + box.max.z) / 2;
    x += size.x + 0.5;
    thing.add(o);
    info.push({ name, size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)], triangles: triangles(o), picture: picture(o), ...extra });
  };
  for (const id of ids) place(await assets.model(id), id);
  for (const [k, f] of files.entries()) {
    const gltf = await assets.loadGLTF(f);
    const o = gltf.animations.length ? cloneSkinned(gltf.scene) : gltf.scene;
    const clips = gltf.animations.map((c) => `${c.name} (${c.duration.toFixed(2)} s)`);
    // (placed and framed as it rests, before any clip moves it: the cameras then hold still across a strip)
    const want = list('clip')[k] ?? list('clip')[0] ?? null;
    const clip = !gltf.animations.length ? null : want === null ? gltf.animations[0] : gltf.animations.find((c) => c.name === want) ?? gltf.animations[+want] ?? gltf.animations[0];
    place(o, f, { clips: k ? undefined : clips, playing: clip?.name ?? null });
    if (clip) {
      const m = new THREE.AnimationMixer(o), a = m.clipAction(clip);
      a.play();
      m.setTime(clip.duration * +(q.get('t') ?? 0));
      mixer ??= m;
      action ??= a;
      played.push(a);
    }
  }
  // (every survivor, and today's beside them, in one clip at one moment: see `played`)
  const playOn = (o: THREE.Object3D, clips: THREE.AnimationClip[]) => {
    const want = q.get('clip');
    const clip = want === null ? null : clips.find((c) => c.name === want) ?? clips[+want];
    if (!clip) return null;
    const m = new THREE.AnimationMixer(o), a = m.clipAction(clip);
    a.play();
    m.setTime(clip.duration * +(q.get('t') ?? 0));
    played.push(a);
    return clip.name;
  };
  if (survivors.length) {
    const { wearBody, wearOn, BODIES } = await import('../game/survivors');
    const { hides } = await import('../sim/survivor');
    const { ITEMS } = await import('../sim/items');
    const hide = hides(list('hide') as Parameters<typeof hides>[0]);
    // (what a piece hides and draws in is its item's, src/sim/items/wear.ts, unless &hide or &shrink says)
    const dressOf = (model: string) => Object.values(ITEMS).find((d) => d.dress?.model === model)?.dress;
    const gltf = await assets.loadGLTF('assets/characters/survivor.glb');
    for (const n of survivors) {
      const o = cloneSkinned(gltf.scene) as THREE.Group;
      o.traverse((m) => { if (m.name.startsWith('gear_')) m.visible = false; });
      const body = await wearBody(o, n, list('wear').length ? 0 : hide);
      // (things worn over it: a model, and a colour (rrggbb) or a camouflage after a ~)
      const worn = list('wear').map((w) => {
        const [model, c] = w.split('~');
        const own = dressOf(model);
        return { model, hides: q.has('hide') || !own ? hide : hides(own.hides), shrinks: hides((q.has('shrink') || !own ? list('shrink') : own.shrinks ?? []) as Parameters<typeof hides>[0]), ...(c && /^[0-9a-f]{6}$/i.test(c) ? { tint: Number(`0x${c}`) } : c ? { camo: c } : {}) };
      });
      if (worn.length) await wearOn(o, body, worn);
      const playing = playOn(o, gltf.animations);
      place(o, BODIES[n]?.name ?? String(n), { playing });
    }
  }
  if (animal) {
    const { MODES, stageAnimal } = await import('../game/animals');
    const mode = q.get('mode') ?? 'idle', a = await stageAnimal(animal, MODES[mode] ?? +mode);
    if (!a) throw new Error(`no such animal: ${animal}`);
    if (a.action) {
      mixer = a.mixer;
      action = a.action;
      mixer.setTime(a.action.getClip().duration * +(q.get('t') ?? 0));
    }
    place(a.root, animal, { mode, playing: a.clip }, true);
  }
  if (!thing.children.length) throw new Error('nothing to stage: give m=, g= or animal=');

  // (the survivor for size: a new life's body in what it begins in, T-shirt, jeans and trainers, standing to one side,
  // facing the camera. The owner, 2026-10-25, of the old suit beside every path's work: "why are our sub agents not
  // using our new player models?")
  const subject = new THREE.Box3().setFromObject(thing);
  if (person) {
    // (a copy: the file's own is the one the game's pictures of the survivor are made from, and it is moved aside here)
    const gltf = await assets.loadGLTF('assets/characters/survivor.glb');
    const body = cloneSkinned(gltf.scene) as THREE.Group;
    body.traverse((o) => { if (o.name.startsWith('gear_')) o.visible = false; });
    const { wearBody, wearOn } = await import('../game/survivors');
    const { hides } = await import('../sim/survivor');
    const { ITEMS, CLOTHES } = await import('../sim/items');
    const skin = await wearBody(body, +(q.get('body') ?? 0));
    const dress = CLOTHES.flatMap(([, id]) => (ITEMS[id]?.dress ? [ITEMS[id].dress!] : []));
    await wearOn(body, skin, dress.map((d) => ({ model: d.model, hides: hides(d.hides), shrinks: hides(d.shrinks ?? []) })));
    // (at rest when no clip is asked of it, not in the pose its file was made in: a T-shirt flares under arms held out)
    const idle = gltf.animations.find((c) => /^idle/i.test(c.name));
    if (!(survivors.length && playOn(body, gltf.animations)) && idle) new THREE.AnimationMixer(body).clipAction(idle).play().getMixer().setTime(0);
    shadowed(body);
    body.position.set(subject.max.x + 0.9, 0, 0);
    scene.add(body);
  }
  const all = new THREE.Box3().setFromObject(thing);
  if (person) all.expandByPoint(new THREE.Vector3(subject.max.x + 1.3, 1.85, 0));
  const mid = all.getCenter(new THREE.Vector3()), span = all.getSize(new THREE.Vector3());
  sun.target.position.copy(mid);
  const reach = Math.max(span.x, span.y, span.z) * 0.75 + 0.5;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -reach * 2;
  sun.shadow.camera.right = sun.shadow.camera.top = reach * 2;
  sun.shadow.camera.updateProjectionMatrix();

  // ---- the cameras: each framed on everything staged, the same way every time
  const camera = new THREE.PerspectiveCamera(30, cw / ch, 0.05, 500);
  const frame = (view: string) => {
    const dir = {
      side: new THREE.Vector3(0, 0.18, 1), front: new THREE.Vector3(1, 0.18, 0), back: new THREE.Vector3(-1, 0.18, 0),
      q: new THREE.Vector3(0.75, 0.45, 1), top: new THREE.Vector3(0.001, 1, 0.02),
    }[view] ?? new THREE.Vector3(0, 0.18, 1);
    dir.normalize();
    const fit = Math.max(span.x / camera.aspect, span.y, span.z * (view === 'top' ? 1 / camera.aspect : 0.6));
    const d = (fit * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + Math.max(span.x, span.z) * 0.5;
    const near = q.get('near')?.split(',').map(Number);
    const at = near?.length === 4 ? new THREE.Vector3(near[0], near[1], near[2]) : mid;
    camera.position.copy(at).addScaledVector(dir, near?.length === 4 ? near[3] : d);
    camera.lookAt(at);
  };


  renderer.setScissorTest(true);
  for (let i = 0; i < cells; i++) {
    const view = strip > 0 ? views[0] : views[i];
    if (strip > 0 && mixer && action) mixer.setTime(action.getClip().duration * (i / strip));
    if (strip > 0) for (const a of played) if (a !== action) a.getMixer().setTime(a.getClip().duration * (i / strip));
    thing.updateMatrixWorld(true);
    frame(view);
    const vx = (i % cols) * cw, vy = (rows - 1 - Math.floor(i / cols)) * ch;
    renderer.setViewport(vx, vy, cw, ch);
    renderer.setScissor(vx, vy, cw, ch);
    renderer.render(scene, camera);
    say(i, strip > 0 && action ? `${view} · ${played.length > 1 ? played.map((a) => a.getClip().name).join(' | ') : action.getClip().name} ${(i / strip).toFixed(2)}` : view);
  }
  const out = window as unknown as { staged: boolean; stageInfo: unknown };
  // (and a screen of the game over it, asked for: the inventory with a kit on, or the hot bar)
  const screen = q.get('ui') ? await (await import('./sandbox-inventory')).stageScreen(q, renderer, scene.environment) : undefined;
  out.stageInfo = { things: info, views: strip > 0 ? [views[0]] : views, strip, sun: dusk ? 'dusk' : 'day', person, ...(screen ? { screen } : {}) };
  out.staged = true;
}
