// The gas as the game has it. The rules are in src/sim/gas.ts and the look of the mass of it
// is in the world's fog (src/world/atmosphere.ts): this is what is left. The breathing of it,
// and the health that costs; the wisps of it that drift by close to; the daylight going down
// as the eye goes in under it; and what the survivor is told, on the screen and in their ears.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { audio } from '../core/audio';
import { TOUCH } from '../core/device';
import { GAS, breathe, cloudDepth, cloudEdge, freshLungs, type GasCloud, type GasZone } from '../sim/gas';
import type { Atmosphere } from '../world/atmosphere';
import { heightAt, type World } from '../world/worldgen';

export interface GasHost {
  /** something is worn on the face that keeps it out */
  masked(): boolean;
  /** health lost to it (quietly: it is not a blow) */
  hurt(amount: number): void;
  /** a cough shakes whatever is in the hands */
  cough(hard: number): void;
  note(text: string, kind: 'info' | 'warn' | 'good'): void;
}

/** how far from the eye a wisp is drawn, and how near it has faded away again (it is never walked through as a wall), metres */
const WISP = { far: 34, near: [1.6, 6] as [number, number], size: [5, 11] as [number, number], alpha: 0.17 };
/** how much of the daylight, and of the light of the sky, is lost at the eye in the thick of it */
const DIM = { sun: 0.42, sky: 0.3 };
/** the warning boards round it: how many, how far outside the rim they stand, and how big each is (across, up, and the height of its post), metres */
/**
 * The boards. Round each gas, `out` metres beyond the furthest it is seen and one to every `every` metres of the
 * way round (never fewer than `n`); and beside every road that leads to it, from `lead` metres off, one to every
 * `along` metres of road (2026-10-13: "I like those signs ... we should have those around the gas perimeter and
 * leading up to the gas here and there on the paths to them").
 */
const SIGNS = { n: 12, out: 5, every: 42, lead: 230, along: 58, board: [0.86, 0.6] as [number, number], post: 1.95 };

/** the board itself, painted: what is on every one of them */
function signPaint(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 358;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d2ae1c';
  g.fillRect(0, 0, 512, 358);
  g.strokeStyle = '#16140f';
  g.lineWidth = 12;
  g.strokeRect(14, 14, 484, 330);
  g.fillStyle = '#16140f';
  g.textAlign = 'center';
  g.font = '700 30px Arial, sans-serif';
  g.fillText('ОПАСНО', 256, 66);
  g.font = '700 132px "Arial Narrow", Arial, sans-serif';
  g.fillText('ГАЗЫ', 256, 190);
  g.fillRect(60, 214, 392, 6);
  g.font = '700 44px "Arial Narrow", Arial, sans-serif';
  g.fillText('DANGER · GAS', 256, 268);
  g.font = '700 28px Arial, sans-serif';
  g.fillText('NO ENTRY WITHOUT A MASK', 256, 312);
  // years of weather: streaks run down it, and the paint has gone from the corners
  let s = 4211;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(${(60 + rnd() * 50) | 0}, ${(44 + rnd() * 34) | 0}, 22, ${(rnd() * 0.17).toFixed(3)})`;
    const w = 2 + rnd() * 9;
    g.fillRect(rnd() * 512, rnd() * 358, w, w * (1 + rnd() * 16));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Gas {
  /** how deep in it the eye is, 0..1 */
  depth = 0;
  private lungs = freshLungs();
  private mesh: THREE.InstancedMesh | null = null;
  private at: Float32Array;
  private fade: Float32Array;
  private seeds: { x: number; z: number; up: number; size: number; ph: number; vx: number; vz: number }[] = [];
  /** what is being breathed: gas with nothing over the face, gas through a mask, or clean air (null). The HUD has a badge for it, where a word at the top of the screen was */
  air: 'bare' | 'masked' | null = null;
  private veil: HTMLDivElement;
  /** what is seen of the mask from inside it: the rims of its two eyepieces */
  private lens: HTMLDivElement;
  private coughT = 0;
  private wasIn = false;
  private wasMasked = false;
  private warned = false;
  private dimmed = 0;
  private clock = 0;
  private ground: (x: number, z: number) => number;

  /**
   * @param zones every gas the world has (`gasClouds`): each has its boards round it, its wisps, its dimmed day and
   * its warning, and is breathed, by the same lines
   */
  /** the boards round every gas: out of sight where no gas is (src/game/modes.ts) */
  readonly signGroup = new THREE.Group();

  constructor(
    private zones: GasCloud[],
    private atmo: Atmosphere,
    scene: THREE.Scene,
    private host: GasHost,
    hud: HTMLElement,
    world: World,
  ) {
    this.ground = (x, z) => heightAt(world.heights, x, z);
    this.signGroup.name = 'gas signs';
    scene.add(this.signGroup);
    for (const zone of zones) this.signs(zone, world);
    this.veil = document.createElement('div');
    this.veil.className = 'hud-gas';
    this.lens = document.createElement('div');
    this.lens.className = 'hud-mask';
    hud.prepend(this.lens);
    hud.append(this.veil);
    const n = zones.length ? (TOUCH ? 14 : 40) : 0;
    this.at = new Float32Array(n * 4);
    this.fade = new Float32Array(n);
    if (!n) return;
    // (the film's dice are not wanted here, nor anybody's: where the wisps are is nobody's business but the eye's)
    let s = 9173;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) {
      this.seeds.push({ x: rnd() * WISP.far * 2, z: rnd() * WISP.far * 2, up: 0.2 + rnd() * rnd() * 3.2, size: WISP.size[0] + rnd() * (WISP.size[1] - WISP.size[0]), ph: rnd() * 6.283, vx: 0.25 + rnd() * 0.3, vz: (rnd() - 0.5) * 0.3 });
    }
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    geo.setAttribute('aWisp', new THREE.InstancedBufferAttribute(this.at, 4));
    geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(this.fade, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uColor: { value: new THREE.Color(0.46, 0.54, 0.17) }, uDaylight: atmo.daylight },
      vertexShader: /* glsl */ `
        attribute vec4 aWisp;
        attribute float aFade;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vUv = uv;
          vFade = aFade;
          // (always face on to the eye: it has no sides)
          vec4 mv = viewMatrix * vec4( aWisp.xyz, 1.0 );
          mv.xy += position.xy * aWisp.w;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uDaylight;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float r = length( vUv - 0.5 ) * 2.0;
          float a = smoothstep( 1.0, 0.0, r );
          gl_FragColor = vec4( uColor * uDaylight, a * a * vFade );
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    scene.add(mesh);
    this.mesh = mesh;
  }

  /**
   * Boards on posts all round it, a few metres outside the rim and facing out: what is read
   * by whoever walks up to it from any side. One is left out where a tree, a rock or a wall
   * stands in its place, or where the ground falls away.
   */
  private signs(z: GasZone, world: World) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4d3c2a, roughness: 0.92 });
    const face = new THREE.MeshStandardMaterial({ map: signPaint(), roughness: 0.6, metalness: 0.15 });
    const back = new THREE.MeshStandardMaterial({ color: 0x6b5a2a, roughness: 0.8, metalness: 0.15 });
    for (const m of [wood, face, back]) this.atmo.register(m);
    const [bw, bh] = SIGNS.board;
    const post = new THREE.BoxGeometry(0.07, SIGNS.post, 0.07), board = new THREE.BoxGeometry(bw, bh, 0.025);
    const near = (list: { x: number; z: number }[], x: number, zz: number, r: number) => list.some((o) => Math.abs(o.x - x) < r && Math.abs(o.z - zz) < r);
    // (Every post, every board's edge and every board's face, each made one thing where they stand: thirty-five
    // signs were seven things each to draw (a box of six faces is six), up to a hundred and fifty of a frame's draws
    // for eight hundred triangles, and again in every shadow map.)
    const posts: THREE.BufferGeometry[] = [], edges: THREE.BufferGeometry[] = [], faces: THREE.BufferGeometry[] = [];
    // (the board's six faces in the box's own order: the fifth, looking down +z, is the one painted)
    const ix = Array.from(board.index!.array), faceIx = ix.slice(24, 30), edgeIx = [...ix.slice(0, 24), ...ix.slice(30)];
    const placed = (geo: THREE.BufferGeometry, m: THREE.Matrix4, index?: number[]) => {
      const out = geo.clone().applyMatrix4(m);
      if (index) out.setIndex(index);
      return out;
    };
    let made = 0;
    /** one of them stood at a place, its face turned the way `a` says (0 looks south, down +z): left out where something stands there already, or the ground falls away */
    const stand = (x: number, zz: number, a: number, clear = 9) => {
      const k = made++;
      const y = this.ground(x, zz);
      if (near(world.trees, x, zz, 1.6) || near(world.rocks, x, zz, 2.2) || near(world.props, x, zz, 1.6) || near(world.buildings, x, zz, clear)) return;
      if (Math.abs(this.ground(x + 1, zz) - y) + Math.abs(this.ground(x, zz + 1) - y) > 0.7) return;
      const sign = new THREE.Object3D();
      // (none of them quite straight)
      sign.position.set(x, y, zz);
      sign.rotation.set(Math.sin(k * 7.3) * 0.035, a + Math.sin(k * 3.1) * 0.12, Math.cos(k * 5.7) * 0.045, 'YXZ');
      sign.updateMatrix();
      const p = new THREE.Matrix4().makeTranslation(0, SIGNS.post / 2 - 0.25, 0).premultiply(sign.matrix);
      const b = new THREE.Matrix4().makeTranslation(0, SIGNS.post - 0.25 - bh / 2 - 0.04, 0.05).premultiply(sign.matrix);
      posts.push(placed(post, p));
      edges.push(placed(board, b, edgeIx));
      faces.push(placed(board, b, faceIx));
    };
    // round it, beyond the furthest it is seen, and facing out
    const edge = z.r * (1 + GAS.skirt), ring = edge + SIGNS.out;
    const n = Math.max(SIGNS.n, Math.round((2 * Math.PI * ring) / SIGNS.every));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.2;
      stand(z.x + Math.sin(a) * ring, z.z + Math.cos(a) * ring, a);
    }
    // beside every road on the way to it: on one side and then the other, each turned to whoever is coming
    for (const road of [world.road, ...world.roads]) {
      const pts = road.points;
      let since = SIGNS.along * 0.6, side = 1;
      for (let i = 1; i < pts.length / 3; i++) {
        const x = pts[i * 3], zz = pts[i * 3 + 2], px = pts[i * 3 - 3], pz = pts[i * 3 - 1];
        const step = Math.hypot(x - px, zz - pz), off = Math.hypot(x - z.x, zz - z.z) - edge;
        if (off < 14 || off > SIGNS.lead || step < 1e-3) {
          since = Math.min(since + step, SIGNS.along);
          continue;
        }
        since += step;
        if (since < SIGNS.along) continue;
        since = 0;
        // (off the asphalt by a stride, and facing away from the gas along the road: toward whoever walks in)
        const nx = -(zz - pz) / step, nz = (x - px) / step, w = road.width / 2 + 1.5;
        const sx = x + nx * w * side, sz = zz + nz * w * side;
        stand(sx, sz, Math.atan2(sx - z.x, sz - z.z), 5);
        side = -side;
      }
    }
    for (const [list, mat] of [[posts, wood], [edges, back], [faces, face]] as const) {
      const all = list.length ? mergeGeometries(list, false) : null;
      if (!all) continue;
      const mesh = new THREE.Mesh(all, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'gas signs';
      this.signGroup.add(mesh);
    }
  }

  /**
   * @param eye where the game's camera is
   * @param head where the survivor's own head is (in a jeep's chase view the two are not one place)
   * @param alive false once dead, and before the game has begun: nothing is breathed then
   */
  /** gas that is breathed and not seen: how deep in it a point is (under the ground in the bunker, where it is all through the place) */
  under: ((x: number, y: number, z: number) => number) | null = null;

  update(dt: number, eye: THREE.Vector3, head: THREE.Vector3, alive: boolean) {
    const zones = this.zones;
    if (!zones.length) return;
    this.clock += dt;
    this.depth = cloudDepth(zones, eye.x, eye.y, eye.z);
    // (what is breathed and not seen is a faint dulling and no more: under the ground, what lights the place is its own lamps)
    const faint = this.under ? this.under(eye.x, eye.y, eye.z) : 0;
    // (Behind a mask the gas is all but out of the way: the cloud itself thins for an eye that is in it, in the fog
    // every shader has, and what is the eye's own, the day dimmed under it and the wisps going by, is turned down
    // with it. 2026-10-13: "once inside the gas and not dying bc of equipped gas mask the fog should go away".)
    const masked = this.host.masked();
    const clear = masked ? 0.3 : 1;

    // --- the daylight, under it
    const dim = Math.min(1, this.depth * 1.6 * clear + faint * 0.14);
    if (Math.abs(dim - this.dimmed) > 0.002 || (dim === 0 && this.dimmed !== 0)) {
      this.dimmed = dim;
      this.atmo.cover.gas = { sun: 1 - DIM.sun * dim, sky: 1 - DIM.sky * dim };
    }

    // --- the wisps of it near the eye
    const m = this.mesh;
    if (m) {
      m.visible = cloudEdge(zones, eye.x, eye.z) < WISP.far;
      if (m.visible) {
        const span = WISP.far * 2;
        for (let i = 0; i < this.seeds.length; i++) {
          const w = this.seeds[i];
          // each drifts down the wind, and comes round again on the far side of the eye's own patch of it
          const wx = w.x + w.vx * this.clock, wz = w.z + w.vz * this.clock;
          const x = eye.x + ((((wx - eye.x) % span) + span) % span) - WISP.far;
          const zz = eye.z + ((((wz - eye.z) % span) + span) % span) - WISP.far;
          const y = this.ground(x, zz) + w.up + w.size * 0.3;
          const d = Math.hypot(x - eye.x, y - eye.y, zz - eye.z);
          const thick = Math.min(1, cloudDepth(zones, x, y, zz) * 3) * clear;
          const near = THREE.MathUtils.smoothstep(d, WISP.near[0], WISP.near[1]), far = 1 - THREE.MathUtils.smoothstep(d, WISP.far * 0.6, WISP.far);
          this.at[i * 4] = x;
          this.at[i * 4 + 1] = y;
          this.at[i * 4 + 2] = zz;
          this.at[i * 4 + 3] = w.size * (0.85 + 0.15 * Math.sin(this.clock * 0.35 + w.ph));
          this.fade[i] = WISP.alpha * thick * near * far * (0.7 + 0.3 * Math.sin(this.clock * 0.22 + w.ph * 1.7));
        }
        (m.geometry.getAttribute('aWisp') as THREE.InstancedBufferAttribute).needsUpdate = true;
        (m.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
    }

    // --- the breathing of it
    const deep = alive ? Math.max(cloudDepth(zones, head.x, head.y, head.z), this.under ? this.under(head.x, head.y, head.z) : 0) : 0;
    const breathing = deep >= GAS.breathe;
    if (alive) {
      const r = breathe(this.lungs, deep, masked, dt);
      if (r.hurt > 0) this.host.hurt(r.hurt);
      if (r.cough) {
        this.coughT = 1;
        audio.cough(0.6 + deep * 0.4);
        this.host.cough(0.45 + deep * 0.5);
      }
      audio.mask(dt, masked && breathing);
    } else {
      this.lungs = freshLungs();
      audio.mask(dt, false);
    }
    this.coughT = Math.max(0, this.coughT - dt * 2.2);

    // --- what is said
    if (alive && breathing && !this.wasIn) this.host.note(masked ? 'Gas mask on: you can breathe in here' : 'You are breathing gas: get out, or put on a gas mask', masked ? 'good' : 'warn');
    else if (alive && breathing && masked && !this.wasMasked) this.host.note('Gas mask on: you can breathe in here', 'good');
    else if (alive && breathing && !masked && this.wasMasked) this.host.note('Your mask is off: you are breathing gas', 'warn');
    if (alive && !breathing && this.wasIn && !masked) this.host.note('Clean air', 'good');
    this.wasIn = breathing;
    this.wasMasked = masked;
    const off = cloudEdge(zones, head.x, head.z);
    if (alive && !masked && !breathing && off < 22 && !this.warned) {
      this.warned = true;
      this.host.note('Gas ahead: do not go in without a gas mask', 'warn');
    }
    if (off > 60) this.warned = false;
    const choke = alive && !masked ? Math.min(1, this.lungs.held / GAS.hold) : 0;
    this.veil.style.opacity = (choke * (0.55 + 0.45 * this.coughT)).toFixed(3);
    this.lens.classList.toggle('on', alive && masked);
    this.air = alive && breathing ? (masked ? 'masked' : 'bare') : null;
  }
}
