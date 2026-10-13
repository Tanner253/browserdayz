// `?castle` on a development build: the fort by itself (src/world/castle.ts), stood on a plain ridge under the
// game's own sky, sun and shadows, with the game's own survivor to walk it. Not the game: no world, no server, no
// HUD. For whoever is building the fort, to look at it and to measure whether legs get everywhere in it.
//
// By hand: click to take the mouse; W A S D, Shift, C, Space as in the game.
// By script (window.C, and the headless tool, assets-src/_wf/me/play.mjs, waits for it as it waits for the game):
//   C.script()                          the page stops moving by itself: what follows moves it
//   C.cam([x, y, z], [x, y, z], fov)    a free eye, and what it looks at, in the fort's own measure
//   C.put(x, z, y, yaw)                 the survivor set down there; C.eyes() looks out of its head
//   C.walk([[x, z], ...], { sprint })   it walks to each spot in turn; what comes back says how far it got and how fast
//   C.hour(light)                       1 noon, 0 night;  C.frame(n) draws n frames;  C.cost() what a frame draws
//   C.snow(v)                           how much snow lies, 0 none to 1 deep winter

import * as THREE from 'three';
import { Renderer } from '../core/renderer';
import { assets } from '../core/assets';
import { Strips } from '../core/strips';
import { physics } from '../core/physics';
import { Input, type MoveInput } from '../core/input';
import { Atmosphere } from '../world/atmosphere';
import type { Terrain } from '../world/terrain';
import { Player } from '../game/player';
import { Lamps } from '../game/lamps';
import { Flames } from '../game/flames';
import { CRESSET, CastleSite } from '../world/castle';
import { castleAt, castleCuts, castleDark, castleGround, castleLocal, castleLoot, castleProps, squareTouches, type Place } from '../sim/castle';

/** where the fort stands on this page: turned a little, so that nothing in it is right only because it is square to the world */
const P: Place = { x: 40, y: 120, z: -30, rot: 0.35 };
/** the ridge it stands on: so far each way from the fort, in squares the size of the world's own */
const HALF = 240, CELL = 2;

export async function castlePage() {
  const canvas = document.getElementById('game') as HTMLCanvasElement, loading = document.getElementById('loading')!;
  const r = new Renderer(canvas);
  assets.maxAnisotropy = Math.min(16, r.maxAnisotropy);
  assets.strips = new Strips(r.renderer);
  await Promise.all([physics.init(), assets.init()]);
  const atmo = new Atmosphere(r.renderer, r.scene, r.camera);
  atmo.gases = [];
  await atmo.init();

  const groundSnow = { value: 0 };
  let earth: THREE.Material | undefined;
  const flames = new Flames(r.scene, atmo);
  // ---- the ridge: the ground the fort assumes, drawn and made solid as the world's ground is
  const N = (HALF * 2) / CELL + 1, heights = new Float32Array(N * N);
  const world = (i: number, j: number) => castleAt(P, -HALF + i * CELL, -HALF + j * CELL);
  // (laid out square to the fort, not to the world: the page's own ground, turned with it)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = castleGround(-HALF + i * CELL, -HALF + j * CELL);
  // (what the world would do to its ground for the hatch: every corner of every square its stairwell touches is lowered, and nothing else: see `castleCuts`)
  for (const cut of castleCuts(P)) for (let j = 0; j + 1 < N; j++) for (let i = 0; i + 1 < N; i++) {
    // (this page's ground is turned with the fort: its squares are asked about in the fort's own measure)
    const well = cut.well.map(([x, z]): [number, number] => [castleLocal(P, x, 0, z)[0], castleLocal(P, x, 0, z)[1]]);
    if (!squareTouches(well, -HALF + i * CELL, -HALF + j * CELL, CELL)) continue;
    for (const k of [j * N + i, j * N + i + 1, (j + 1) * N + i, (j + 1) * N + i + 1]) heights[k] = Math.min(heights[k], cut.to - P.y);
  }
  {
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), index: number[] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const [x, , z] = world(i, j);
      pos.set([x, P.y + heights[j * N + i], z], (j * N + i) * 3);
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
    // (snow on it as on the fort, so that a white fort is not photographed on a brown hill: the world's own ground has its own)
    earth = atmo.register(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, roughness: 1, color: 0xd9c690 }), (shader) => {
      shader.uniforms.uSnow = groundSnow;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSnow;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.80, 0.83, 0.88 ), uSnow * smoothstep( 0.45, 0.8, dot( normalize( vNormal ), normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) ) );');
    }, 'castle page ground');
    const ground = new THREE.Mesh(geo, earth);
    ground.receiveShadow = true;
    r.scene.add(ground);
    const hcm = new Float32Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) hcm[j + i * N] = heights[j * N + i];
    const [cx, , cz] = castleAt(P, 0, 0);
    physics.addStatic(physics.R.ColliderDesc.heightfield(N - 1, N - 1, hcm, { x: HALF * 2, y: 1, z: HALF * 2 }), 'grass', { x: cx, y: P.y, z: cz }, P.rot);
  }

  // ---- the fort, and what stands in it off the shelf
  // (as the game would stand it: the ground's own paint for the earth round the hatch, the renderer's way of
  // getting a thing ready ahead, and the game's own flames for its cressets)
  const site = new CastleSite(P, atmo, r.scene, { earth, ready: (o) => r.ready(o), fire: (at, size) => flames.add(at, { size, smoke: 0.12 }) });
  groundSnow.value = site.snow;
  for (const it of castleProps(P)) {
    void assets.model(it.kind).then((model) => {
      // (stood by a holder of its own: a model's own turn is whatever its maker left it, and turning that about one
      // way of three leaves a crate tilted in the air)
      const m = new THREE.Group();
      m.add(model.clone());
      m.position.set(it.x, it.y, it.z);
      m.rotation.y = it.rot;
      m.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = o.receiveShadow = true)));
      atmo.registerObject(m);
      r.scene.add(m);
      const e = assets.manifest.models[it.kind], h = [0, 1, 2].map((k) => (e.max[k] - e.min[k]) / 2);
      const mid = new THREE.Vector3((e.max[0] + e.min[0]) / 2, (e.max[1] + e.min[1]) / 2, (e.max[2] + e.min[2]) / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
      physics.addStatic(physics.R.ColliderDesc.cuboid(h[0], h[1], h[2]), 'wood', { x: it.x + mid.x, y: it.y + mid.y, z: it.z + mid.z }, it.rot);
    }).catch(() => {});
  }
  // (where things lie: a small bright mark at each, to see that none is in a wall or in the air)
  const marks = new THREE.Group();
  for (const l of castleLoot(P)) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.12), new THREE.MeshBasicMaterial({ color: l.usage[0] === 'Hunting' ? 0x4fd06a : l.arms ? 0xff5a3c : 0xffd23c }));
    m.position.set(l.x, l.y + 0.02, l.z);
    marks.add(m);
  }
  marks.visible = false;
  r.scene.add(marks);

  const lamps = new Lamps(r.scene);
  const player = new Player({ surfaceAt: () => 'rock' } as unknown as Terrain);
  const put = (x: number, z: number, y: number, yawDeg = 0) => {
    const [wx, wy, wz] = castleAt(P, x, z, y);
    player.spawn(wx, wy, wz, (yawDeg * Math.PI) / 180 + P.rot);
    player.vitals.stamina = 100;
  };
  put(21, -1.6, -1.3, 90);
  physics.step(physics.fixedDt);

  const input = new Input(canvas);
  canvas.addEventListener('click', () => input.lock());
  let manual = false, eyes = true, last = performance.now();
  const draw = (dt: number) => {
    const cam = r.camera;
    if (eyes) player.updateCamera(cam, dt, 1);
    site.update(dt, cam.position, atmo.night, (pos, burn) => lamps.glow(pos, CRESSET.colour, burn * 0.8, CRESSET.reach));
    lamps.update(cam, dt);
    flames.update(dt, cam.position);
    // (under the terrace it is dark, as it is down the bunker: so much of the sun and the sky put out for an eye that is there)
    const dark = castleDark(P, cam.position.x, cam.position.y, cam.position.z);
    atmo.cover.castle = { sun: 1 - dark, sky: 1 - 0.99 * dark };
    atmo.update();
    r.render(dt);
  };
  const stepOnce = (inp: MoveInput) => {
    physics.step(physics.fixedDt, (h) => player.step(h, inp));
    physics.world.propagateModifiedBodyPositionsToColliders();
  };
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (manual) return;
    player.look(input);
    physics.step(dt, (h) => {
      player.step(h, input);
      input.consumeFixed();
    });
    physics.world.propagateModifiedBodyPositionsToColliders();
    draw(dt);
    input.endFrame();
  };

  const local = () => castleLocal(P, player.pos.x, player.pos.y, player.pos.z).map((v) => Math.round(v * 100) / 100);
  const C = {
    P, site, player, atmo, marks, r,
    script() { manual = true; },
    eyes() { eyes = true; },
    cam(eye: [number, number, number], at: [number, number, number], fov = 70) {
      eyes = false;
      const cam = r.camera;
      cam.position.set(...castleAt(P, eye[0], eye[2], eye[1]));
      cam.fov = fov;
      cam.updateProjectionMatrix();
      cam.lookAt(new THREE.Vector3(...castleAt(P, at[0], at[2], at[1])));
    },
    hour(light: number, low = 0) { atmo.setHour(light, low); },
    /** how much snow lies: 0 none, 1 deep winter (on the fort, and on this page's hill with it) */
    snow(v: number) { site.snow = v; groundSnow.value = site.snow; },
    frame(n = 1) { for (let i = 0; i < n; i++) draw(1 / 60); },
    /** everything that is still on its way has come, and is drawn */
    async settle() {
      await assets.idle();
      C.frame(3);
      await new Promise((res) => setTimeout(res, 120));
      C.frame(2);
    },
    cost() {
      C.frame(1);
      const i = r.renderer.info.render, m = r.renderer.info.memory;
      return { state: site.state, calls: i.calls, triangles: i.triangles, textures: m.textures, geometries: m.geometries, ...site.counts };
    },
    /** the kit's and the door's pictures at the size they came, as the game gives them to whoever is close (it is the game's own to do: src/game/near.ts; this page has none of that) */
    sharp() {
      return assets.sharpen(site.sharp);
    },
    /** waits until the fort's own shapes are in the world (its pictures have come and it has been got ready) */
    async near(secs = 60) {
      for (let t = 0; t < secs * 20 && site.state !== 'near'; t++) {
        C.frame(1);
        await new Promise((res) => setTimeout(res, 50));
      }
      return site.state;
    },
    /**
     * What a frame costs with the fort and without it, from where the eye is: `n` pairs of frames, the fort drawn
     * in one of each pair and hidden in the other, turn about. Milliseconds: the middle one of each, and the
     * spread of the pairs' differences (which is the noise).
     */
    bench(n = 60) {
      const gl = r.renderer.getContext(), time = (on: boolean) => {
        site.group.visible = on;
        const t0 = performance.now();
        draw(1 / 60);
        gl.finish();
        return performance.now() - t0;
      };
      const withIt: number[] = [], without: number[] = [], diff: number[] = [];
      for (let k = 0; k < 6; k++) time(k % 2 === 0);
      for (let k = 0; k < n; k++) {
        const a = k % 2 ? time(false) : time(true), b = k % 2 ? time(true) : time(false), on = k % 2 ? b : a, off = k % 2 ? a : b;
        withIt.push(on);
        without.push(off);
        diff.push(on - off);
      }
      site.group.visible = true;
      const mid = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)], round = (v: number) => Math.round(v * 100) / 100;
      const sorted = [...diff].sort((p, q) => p - q);
      return { with: round(mid(withIt)), without: round(mid(without)), adds: round(mid(diff)), noise: round((sorted[Math.floor(n * 0.84)] - sorted[Math.floor(n * 0.16)]) / 2) };
    },
    put,
    /** stands still so long, for a body to come to rest */
    rest(secs = 0.5) {
      for (let t = 0; t < secs; t += physics.fixedDt) stepOnce({ held: () => false, pressedFixed: () => false });
      return local();
    },
    /**
     * Walks from where it stands to each spot in turn (x, z in the fort's own measure), as a player holding W would.
     * For each: whether it got there, how long it took, how far over the ground it went and so how fast, where it
     * is, and how many steps it made nothing of (a body held by something).
     */
    walk(spots: [number, number][], o: { sprint?: boolean; crouch?: boolean; secs?: number } = {}) {
      const held = new Set(['KeyW', ...(o.sprint ? ['ShiftLeft'] : [])]);
      const inp: MoveInput = { held: (c) => held.has(c), pressedFixed: () => false };
      if (!!o.crouch !== player.crouched) player.setCrouch(!!o.crouch);
      return spots.map(([x, z]) => {
        const [wx, , wz] = castleAt(P, x, z);
        let t = 0, went = 0, lost = 0, d = Infinity;
        while (t < (o.secs ?? 15)) {
          const dx = wx - player.pos.x, dz = wz - player.pos.z;
          d = Math.hypot(dx, dz);
          if (d < 0.25) break;
          player.yaw = Math.atan2(-dx, -dz);
          const was = player.pos.clone();
          stepOnce(inp);
          const made = Math.hypot(player.pos.x - was.x, player.pos.z - was.z);
          went += made;
          if (made < 0.2 * physics.fixedDt) lost++;
          t += physics.fixedDt;
        }
        return { to: [x, z], got: d < 0.25, secs: Math.round(t * 100) / 100, pace: Math.round((went / Math.max(t, 1e-6)) * 100) / 100, at: local(), lost, grounded: player.grounded };
      });
    },
    /** what a shot from one spot toward another first meets, and how far off (the fort's own measure) */
    ray(from: [number, number, number], to: [number, number, number]) {
      const a = new THREE.Vector3(...castleAt(P, from[0], from[2], from[1])), b = new THREE.Vector3(...castleAt(P, to[0], to[2], to[1])), d = b.clone().sub(a), len = d.length();
      const hit = physics.raycast(a, d.normalize(), len);
      return hit ? Math.round(hit.toi * 100) / 100 : null;
    },
  };
  const w = window as unknown as Record<string, unknown>;
  w.C = w.T = C;
  w.__game = C;
  // (the fort's own shapes come when its pictures have: the page waits for them, as nobody playing would have to)
  draw(1 / 60);
  await C.near();
  await assets.idle();
  r.precompile(r.scene, r.camera);
  draw(1 / 60);
  loading.classList.add('done');
  requestAnimationFrame(loop);
}
