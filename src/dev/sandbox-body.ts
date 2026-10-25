// The game's own bodies on the sandbox floor (src/dev/sandbox.ts `&bodies=`): each one stood, crouched or lying,
// holding what it is told and going the way it is told, posed by the game's own Avatar (the motion capture's steps,
// the hands on the gun, the aim), with no world and no server (the owner, 2026-10-25: "why are sessions not using the
// stage as a default for testing? so they dont have ot build the whole world for every animation test"). Every body is
// a cell of the picture; `&frames=` draws them again at successive moments, a block of cells each, for a moving
// picture (progress/anim-tools/sheet-gif.mjs cuts the blocks apart).
//
//   &bodies=free.walk,ak.aim.crouch.walk.L,m9.aim,hatchet.jog.FL,ak.prone.walk,free.turn,bat.b2
//     each body's words, by dots: what is held (free, or an item: ak, m9, hatchet...), b0..b3 (a survivor's body, as
//     the game puts it on: none, the old suit), aim, crouch or prone, idle /
//     walk / jog / sprint / run (the hurried crouch) or a pace (v2.5, m/s), a way (F B L R FL FR BL BR), turn (on the
//     spot), up / down (the aim pitched), limp, swing (a blow with what is in the fist, the moments drawn across it)
//   &frames=12&fps=15&settle=1.2    moments drawn (after so many seconds of going), how many a second
//   &across=4                       moments to a row of blocks (a picture is drawn no more than 8192 a side)
//   &cols=4&view=q                  bodies across a block; the camera (q, side, front, back, top), framed on each body

import * as THREE from 'three';
import { Avatar } from '../game/avatar';
import { lookFor } from '../game/look';
import { Weapons } from '../game/weapons';
import { CLOTHES, ITEMS } from '../sim/items';
import { sortWorn } from '../game/survivors';
import { CRAWL, CROUCH_RUN, HANDS_FREE, AIM_SLOW } from '../game/player';
import type { Atmosphere } from '../world/atmosphere';

interface Stage {
  q: URLSearchParams;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  say: (i: number, text: string) => void;
}

/** the ways, radians to the body's left of ahead */
const WAYS: Record<string, number> = { F: 0, FL: 45, L: 90, BL: 135, B: 180, BR: -135, R: -90, FR: -45 };

export interface BodySpec { words: string; held: string | null; body: number | null; wear: string[] | null; aim: boolean; crouch: boolean; prone: boolean; speed: number; way: number; turn: boolean; pitch: number; limp: boolean; swing: boolean }

/** what a cell's words ask for, at the pace the game would go at (src/game/player.ts: 1.7 walking, 4.0 at a jog, 6.2 flat out, 1.9 crouched) */
export function specOf(words: string): BodySpec {
  const w = words.split('.');
  const has = (k: string) => w.includes(k);
  const held = w.find((k) => ITEMS[k]) ?? null;
  const aim = has('aim'), crouch = has('crouch'), prone = has('prone');
  const way = Object.keys(WAYS).find((k) => has(k));
  const pace = w.find((k) => /^v[\d.]+$/.test(k));
  let speed = 0;
  if (pace) speed = +pace.slice(1);
  else if (has('walk') || has('jog') || has('sprint') || has('run')) {
    speed = prone ? CRAWL : crouch ? (has('run') ? CROUCH_RUN : 1.9) : has('sprint') ? 6.2 : has('jog') ? 4.0 : 1.7;
    if (!has('sprint')) {
      if (!held) speed *= HANDS_FREE;
      if (aim) speed *= AIM_SLOW;
      if (way && Math.abs(WAYS[way]) > 90) speed *= 0.75;
    }
  }
  // (b0..b3: one of the survivors' bodies, as the game puts it on, in what a new life wears; none: the old suit)
  const body = w.find((k) => /^b\d$/.test(k));
  // (wear-parka-smock_pants: what it wears instead of a new life's clothes)
  const wear = w.find((k) => k.startsWith('wear-'))?.slice(5).split('-') ?? null;
  return { words, held, body: body ? +body.slice(1) : null, wear, aim, crouch, prone, speed, way: THREE.MathUtils.degToRad(WAYS[way ?? 'F']), turn: has('turn'), pitch: has('up') ? 0.45 : has('down') ? -0.45 : 0, limp: has('limp'), swing: has('swing') };
}

/** a stand-in for the game's sky and sun: what a body and a gun ask of it */
function atmosphereOf(scene: THREE.Scene, sun: THREE.DirectionalLight): Atmosphere {
  const daylight = { value: 1 };
  const register = (mat: THREE.Material, patch?: (s: THREE.WebGLProgramParametersWithUniforms) => void, key?: string) => {
    if (!patch) return mat;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDaylight = daylight;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDaylight;');
      patch(shader);
    };
    mat.customProgramCacheKey = () => 'sandbox|' + (key ?? '');
    return mat;
  };
  return {
    envMap: scene.environment, sunColor: sun.color, sunIntensity: sun.intensity, sunDir: sun.position.clone().normalize(),
    register, registerObject: (o: THREE.Object3D) => o.traverse((m) => ([] as THREE.Material[]).concat((m as THREE.Mesh).material ?? []).forEach((x) => register(x))),
  } as unknown as Atmosphere;
}

export async function stageBodies(o: Stage) {
  const { q, scene, renderer, sun, cw, ch, cols, say } = o;
  const specs = (q.get('bodies') ?? '').split(',').filter(Boolean).map(specOf);
  const frames = Math.max(1, Math.floor(+(q.get('frames') ?? 1))), fps = +(q.get('fps') ?? 15), settle = +(q.get('settle') ?? 1.2);
  const view = q.get('view') ?? 'q';
  const atmo = atmosphereOf(scene, sun);
  Avatar.ground = () => 0;
  // (the guns as the game makes them for somebody's hands: its own loader, every gun)
  const guns = specs.some((s) => s.held);
  const weapons = guns ? new Weapons(new THREE.Scene(), new THREE.PerspectiveCamera(), atmo, {} as never, {} as never, {} as never) : null;
  if (weapons) await weapons.load();
  const held = (id: string) => {
    const def = ITEMS[id], obj = weapons!.worldModel(id, []), grips = weapons!.gripsOf(id, []);
    if (!obj || !grips) return null;
    if (def?.weapon) return { obj, grips, kind: def.weapon.akimbo ? ('pistol' as const) : def.weapon.kind };
    return def?.melee ? { obj, grips, kind: 'melee' as const } : null;
  };
  // (each body on a spot of its own, far enough apart that one is not in another's picture)
  const bodies = await Promise.all(specs.map(async (s, i) => {
    const a = new Avatar();
    await a.load(atmo, 0, false, lookFor('Sable'));
    if (s.body !== null) {
      a.wardrobe.setBody(s.body);
      await a.wardrobe.ready();
      a.wardrobe.setWorn(sortWorn(s.wear ?? CLOTHES.map(([, id]) => id)).worn);
      await a.wardrobe.dressed();
    }
    scene.add(a.root);
    a.root.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    if (s.held) {
      const h = held(s.held);
      if (h) a.setHeld(h.obj, h.grips, h.kind, true);
    }
    a.prone = s.prone;
    a.limping = s.limp;
    // (every body from the same moment of its stride, so that two builds drawn side by side step together)
    (a as unknown as { phase: number }).phase = 0;
    if ((a as { gait?: { phase: number } }).gait) (a as unknown as { gait: { phase: number } }).gait.phase = 0;
    return { a, s, pos: new THREE.Vector3((i % 8) * 12, 0, Math.floor(i / 8) * 12), face: 0 };
  }));
  const vel = new THREE.Vector3();
  const step = (dt: number) => {
    for (const b of bodies) {
      const { a, s } = b;
      if (s.turn) b.face += dt * 1.6;
      vel.set(-Math.sin(b.face + s.way) * s.speed, 0, -Math.cos(b.face + s.way) * s.speed);
      b.pos.addScaledVector(vel, dt);
      a.update(dt, b.pos, vel, b.face, s.crouch, false, false, s.pitch, true, s.aim);
    }
  };
  // (gone on a while first, so what is shown is the going and not the start of it, at most a sixtieth at a step)
  const sub = (t: number) => { for (let k = Math.ceil(t * 60); k > 0; k--) step(t / Math.ceil(t * 60)); };
  sub(settle);
  // (a blow begun as the first moment is drawn: the moments are across it)
  for (const b of bodies) if (b.s.swing) b.a.swing();
  const camera = new THREE.PerspectiveCamera(30, cw / ch, 0.05, 200);
  // (each moment a block of `per` bodies across: the blocks `across` to a row)
  const across = Math.min(frames, Math.max(1, Math.floor(+(q.get('across') ?? 1)))), per = cols / across, blockRows = Math.ceil(bodies.length / per);
  const cellOf = (f: number, i: number) => (Math.floor(f / across) * blockRows + Math.floor(i / per)) * cols + (f % across) * per + (i % per);
  const at = new THREE.Vector3(), ahead = new THREE.Vector3(), left = new THREE.Vector3();
  sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
  sun.shadow.camera.right = sun.shadow.camera.top = 60;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  // (how high each head is drawn, over the moments: what is shot at, against the eye the game sees from)
  const heads = bodies.map(() => [Infinity, -Infinity, 0]);
  for (let f = 0; f < frames; f++) {
    if (f) sub(1 / fps);
    bodies.forEach((b, i) => {
      const y = b.a.joints.head?.getWorldPosition(at).y ?? 0, h = heads[i];
      h[0] = Math.min(h[0], y); h[1] = Math.max(h[1], y); h[2] += y / frames;
    });
    for (const [i, b] of bodies.entries()) {
      const cell = cellOf(f, i);
      // framed on the body as it goes: the grid under it shows a foot that slides
      const low = b.s.prone ? 0.35 : b.s.crouch ? 0.65 : 0.95, d = b.s.prone ? 4.2 : 4.6;
      ahead.set(-Math.sin(b.face), 0, -Math.cos(b.face));
      left.set(-Math.cos(b.face), 0, Math.sin(b.face));
      const dir = { q: ahead.clone().multiplyScalar(0.8).addScaledVector(left, -0.6), side: left.clone().negate(), front: ahead.clone(), back: ahead.clone().negate(), top: ahead.clone().multiplyScalar(0.2) }[view] ?? ahead.clone();
      at.copy(b.pos).setY(low);
      camera.position.copy(at).addScaledVector(dir.normalize(), d).setY(low + (view === 'top' ? 6 : 0.35));
      camera.lookAt(at);
      sun.position.copy(b.pos).add(new THREE.Vector3(6, 9, 4));
      sun.target.position.copy(b.pos);
      sun.target.updateMatrixWorld();
      const vx = (cell % cols) * cw, vy = (o.rows - 1 - Math.floor(cell / cols)) * ch;
      renderer.setViewport(vx, vy, cw, ch);
      renderer.setScissor(vx, vy, cw, ch);
      renderer.render(scene, camera);
      say(cell, frames > 1 ? `${b.s.words} ${(f / fps).toFixed(2)} s` : b.s.words);
    }
  }
  // (and how low its skin comes over the floor (0), and its left toe joint: the soles, or a body that floats over it)
  const v = new THREE.Vector3();
  const sole = bodies.map(({ a }) => {
    let low = Infinity;
    a.root.updateMatrixWorld(true);
    a.root.traverse((m) => {
      const s = m as THREE.SkinnedMesh;
      if (!s.isSkinnedMesh || !s.visible || !s.geometry.attributes.position) return;
      for (let k = 0; k < s.geometry.attributes.position.count; k += 3) low = Math.min(low, s.localToWorld(s.getVertexPosition(k, v)).y);
    });
    // (and the left leg's joints as posed, cm, against the hip: forward, then up)
    const hip = a.root.getObjectByName('thigh_l')?.getWorldPosition(new THREE.Vector3());
    const leg = ['calf_l', 'foot_l', 'ball_l'].map((n) => {
      const p = a.root.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
      return p && hip ? `${n} ${(-(p.z - hip.z) * 100).toFixed(1)},${((p.y - hip.y) * 100).toFixed(1)} at ${(p.y * 100).toFixed(1)}` : n;
    });
    return [+low.toFixed(3), leg.join(' ')];
  });
  return { bodies: specs.map((s, i) => ({ words: s.words, speed: +s.speed.toFixed(2), head: heads[i].map((v) => +v.toFixed(3)), sole: sole[i] })), frames, fps, across, block: [per * cw, blockRows * ch] };
}
