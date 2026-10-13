// `?post` on a development build: the fort on the mountain (src/world/castle.ts, the fort lane's, as its own page
// `?castle` stands it: on a plain ridge under the game's own sky and sun) with the signals post stood on it
// (src/world/castle-post.ts, src/sim/castle-post.ts). For looking at the post until the fort itself brings it in.
// Not the game: no world, no server, no HUD, nobody to walk it.
//
// By script (window.C; the headless tool, assets-src/_wf/me/play.mjs, waits for it as it waits for the game):
//   C.cam([x, y, z], [x, y, z], fov)    an eye, and what it looks at, in the fort's own measure (y over the terrace)
//   C.hour(light)                       1 noon, 0 night;  C.frame(n) draws n frames;  C.settle() waits for what is on its way
//   C.cost()                            what a frame draws with the post, and without it
//   C.snow(v)                           how much snow lies, 0 none to 1 deep winter
//   C.show(false)                       the post put away (the fort as it was), and back

import * as THREE from 'three';
import { Renderer } from '../core/renderer';
import { assets } from '../core/assets';
import { Strips } from '../core/strips';
import { physics } from '../core/physics';
import { Atmosphere } from '../world/atmosphere';
import { Lamps } from '../game/lamps';
import { Flames } from '../game/flames';
import { CRESSET, CastleSite } from '../world/castle';
import { castleAt, castleGround, castleProps, type Place } from '../sim/castle';
import { PostSite } from '../world/castle-post';
import { postLoot, postProps } from '../sim/castle-post';

const P: Place = { x: 40, y: 120, z: -30, rot: 0.35 };
const HALF = 240, CELL = 2;

export async function postPage() {
  const canvas = document.getElementById('game') as HTMLCanvasElement, loading = document.getElementById('loading')!;
  const r = new Renderer(canvas);
  assets.maxAnisotropy = Math.min(16, r.maxAnisotropy);
  assets.strips = new Strips(r.renderer);
  await Promise.all([physics.init(), assets.init()]);
  const atmo = new Atmosphere(r.renderer, r.scene, r.camera);
  atmo.gases = [];
  await atmo.init();
  const flames = new Flames(r.scene, atmo), groundSnow = { value: 0 };

  // ---- the ridge the fort assumes (as the fort's own page lays it)
  const N = (HALF * 2) / CELL + 1, pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), index: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const lx = -HALF + i * CELL, lz = -HALF + j * CELL, [x, , z] = castleAt(P, lx, lz);
    pos.set([x, P.y + castleGround(lx, lz), z], (j * N + i) * 3);
    uv.set([(i * CELL) / 5, (j * CELL) / 5], (j * N + i) * 2);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const t = assets.pbr('rocks_ground_02');
  const earth = atmo.register(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, roughness: 1, color: 0xd9c690 }), (shader) => {
    shader.uniforms.uSnow = groundSnow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.80, 0.83, 0.88 ), uSnow * smoothstep( 0.45, 0.8, dot( normalize( vNormal ), normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) ) );');
  }, 'post page ground');
  const ground = new THREE.Mesh(geo, earth);
  ground.receiveShadow = true;
  r.scene.add(ground);

  // ---- the fort, the post on it, and what stands in both off the shelf
  const site = new CastleSite(P, atmo, r.scene, { earth, ready: (o) => r.ready(o), fire: (at, size) => flames.add(at, { size, smoke: 0.12 }) });
  groundSnow.value = site.snow;
  const snow = { value: site.snow };
  const post = new PostSite(P, atmo, r.scene, { snow, ready: (o) => r.ready(o) });
  const stood = new THREE.Group(), mine = new THREE.Group();
  r.scene.add(stood, mine);
  const stand = (to: THREE.Group, it: { kind: string; x: number; y: number; z: number; rot: number }) => void assets.model(it.kind).then((model) => {
    const m = new THREE.Group();
    m.add(model.clone());
    m.position.set(it.x, it.y, it.z);
    m.rotation.y = it.rot;
    m.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = o.receiveShadow = true)));
    atmo.registerObject(m);
    to.add(m);
  }).catch((e) => console.warn('no model', it.kind, e));
  for (const it of castleProps(P)) stand(stood, it);
  for (const it of postProps(P)) stand(mine, it);
  // (where the post's things lie: a small bright mark at each, to see that none is in the air)
  const marks = new THREE.Group();
  for (const l of postLoot(P)) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.1), new THREE.MeshBasicMaterial({ color: l.arms ? 0xff3c2c : l.tier === 4 ? 0xb061ff : 0xffd23c }));
    m.position.set(l.x, l.y + 0.015, l.z);
    marks.add(m);
  }
  marks.visible = false;
  r.scene.add(marks);

  const lamps = new Lamps(r.scene);
  r.camera.position.set(...castleAt(P, 60, -3, 6));
  r.camera.lookAt(new THREE.Vector3(...castleAt(P, 0, 0, 4)));
  let manual = false, last = performance.now();
  const draw = (dt: number) => {
    const cam = r.camera;
    site.update(dt, cam.position, atmo.night, (at, burn) => lamps.glow(at, CRESSET.colour, burn * 0.8, CRESSET.reach));
    if (post.group.visible) post.update(dt, cam.position, atmo.night, (at, burn, colour = CRESSET.colour, reach = CRESSET.reach) => lamps.glow(at, colour, burn, reach));
    lamps.update(cam, dt);
    flames.update(dt, cam.position);
    atmo.update();
    r.render(dt);
  };
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!manual) draw(dt);
  };

  const C = {
    P, site, post, atmo, marks, r,
    script() { manual = true; },
    cam(eye: [number, number, number], at: [number, number, number], fov = 70) {
      manual = true;
      const cam = r.camera;
      cam.position.set(...castleAt(P, eye[0], eye[2], eye[1]));
      cam.fov = fov;
      cam.updateProjectionMatrix();
      cam.lookAt(new THREE.Vector3(...castleAt(P, at[0], at[2], at[1])));
    },
    hour(light: number, low = 0) { atmo.setHour(light, low); },
    snow(v: number) { site.snow = v; snow.value = groundSnow.value = site.snow; },
    show(on: boolean) { post.group.visible = mine.visible = on; },
    frame(n = 1) { for (let i = 0; i < n; i++) draw(1 / 60); },
    async settle() {
      await assets.idle();
      C.frame(3);
      await new Promise((res) => setTimeout(res, 150));
      C.frame(3);
    },
    /** what a frame draws from where the eye is: with the post, and with it put away (the things off the shelf are apart: `props`) */
    cost() {
      const read = () => { C.frame(2); const i = r.renderer.info.render; return { calls: i.calls, triangles: i.triangles }; };
      const all = read();
      post.group.visible = false;
      const bare = read();
      mine.visible = false;
      const none = read();
      post.group.visible = mine.visible = true;
      C.frame(1);
      return { state: post.state, counts: post.counts, made: { calls: all.calls - bare.calls, triangles: all.triangles - bare.triangles }, props: { calls: bare.calls - none.calls, triangles: bare.triangles - none.triangles } };
    },
    async near(secs = 60) {
      for (let k = 0; k < secs * 20 && (site.state !== 'near' || post.state !== 'near'); k++) {
        C.frame(1);
        await new Promise((res) => setTimeout(res, 50));
      }
      return [site.state, post.state];
    },
  };
  const w = window as unknown as Record<string, unknown>;
  w.C = w.T = C;
  w.__game = C;
  draw(1 / 60);
  await C.near();
  await assets.idle();
  r.precompile(r.scene, r.camera);
  draw(1 / 60);
  loading.classList.add('done');
  requestAnimationFrame(loop);
}
