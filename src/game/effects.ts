// Impact / weapon effects: billboard particle pool (dust, debris, sparks, blood),
// bullet-hole decals, muzzle flash light. Textures are generated procedurally.

import * as THREE from 'three';
import { physics, SOLID_GROUPS, type Surface } from '../core/physics';
import type { Atmosphere } from '../world/atmosphere';

const MAX_P = 600;
const MAX_DECALS = 160;
const MAX_BLOOD = 220;
const _Z = new THREE.Vector3(0, 0, 1);
const _DOWN = new THREE.Vector3(0, -1, 0);
const _UP = new THREE.Vector3(0, 1, 0);

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokeTexture() {
  return canvasTex(128, (g, s) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (x - s / 2) / (s / 2), dy = (y - s / 2) / (s / 2);
        const r = Math.hypot(dx, dy);
        const n = 0.65 + 0.35 * Math.sin(x * 0.31 + Math.sin(y * 0.17) * 3) * Math.cos(y * 0.23 + Math.sin(x * 0.11) * 2);
        const a = Math.max(0, 1 - r) ** 1.6 * n;
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

export type HoleKind = 'masonry' | 'wood' | 'metal' | 'soil';

/**
 * Blood on a surface, four to a sheet: a thrown spatter with fingers running one way, a
 * round splash, a scatter of drops, and the single drops a wound leaves as its owner walks.
 */
function bloodTexture() {
  return canvasTex(512, (g, s) => {
    const cell = s / 2;
    const blot = (x: number, y: number, r: number, a: number) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(70,3,2,${a})`);
      grd.addColorStop(0.72, `rgba(88,5,3,${a * 0.94})`);
      grd.addColorStop(1, 'rgba(96,6,4,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    // 0: spatter thrown upward in the cell (the decal is turned so "up" is the way the bullet went)
    {
      const cx = cell * 0.5, cy = cell * 0.68;
      for (let i = 0; i < 9; i++) blot(cx + (Math.random() - 0.5) * 46, cy + (Math.random() - 0.5) * 40, 18 + Math.random() * 22, 0.95);
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
        const len = 30 + Math.random() * 105;
        // a streak: drops getting smaller the further they flew
        for (let k = 0; k < 7; k++) {
          const t = k / 6;
          blot(cx + Math.cos(a) * len * t, cy + Math.sin(a) * len * t, Math.max(1.4, (1 - t) * (5 + Math.random() * 5)), 0.9);
        }
        blot(cx + Math.cos(a) * len * 1.06, cy + Math.sin(a) * len * 1.06, 2 + Math.random() * 4.5, 0.95);
      }
    }
    // 1: a splash where it landed square on
    {
      const cx = cell * 1.5, cy = cell * 0.5;
      for (let i = 0; i < 12; i++) blot(cx + (Math.random() - 0.5) * 70, cy + (Math.random() - 0.5) * 70, 20 + Math.random() * 30, 0.95);
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * Math.PI * 2, r = 55 + Math.random() * 62;
        blot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5 + Math.random() * 6, 0.92);
      }
    }
    // 2: a scatter of drops
    {
      const cx = cell * 0.5, cy = cell * 1.5;
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.7) * 108;
        blot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + Math.random() * Math.random() * 15, 0.93);
      }
    }
    // 3: two or three drops fallen straight down
    {
      const cx = cell * 1.5, cy = cell * 1.5;
      blot(cx, cy, 34, 0.96);
      blot(cx + 52, cy - 34, 15, 0.95);
      blot(cx - 44, cy + 50, 11, 0.95);
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2, r = 38 + Math.random() * 30;
        blot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + Math.random() * 3, 0.9);
      }
    }
  });
}
/** which quarter of the blood sheet: [u, v] of its corner */
const BLOOD_CELL: [number, number][] = [[0, 0.5], [0.5, 0.5], [0, 0], [0.5, 0]];
export type BloodKind = 0 | 1 | 2 | 3;

/** Procedurally drawn bullet holes, one texture per material family. */
function holeTexture(kind: HoleKind) {
  return canvasTex(128, (g, s) => {
    const c = s / 2;
    const jag = (r: number, n: number, amp: number) => {
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (1 + (Math.random() - 0.5) * amp);
        if (i === 0) g.moveTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
        else g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
      }
      g.closePath();
    };
    if (kind === 'masonry') {
      // chipped crater: pale exposed material ring, dark ragged core, hairline cracks
      jag(s * 0.42, 22, 0.45);
      g.fillStyle = 'rgba(190,182,166,0.55)';
      g.fill();
      jag(s * 0.3, 18, 0.4);
      g.fillStyle = 'rgba(120,112,100,0.85)';
      g.fill();
      jag(s * 0.13, 12, 0.35);
      g.fillStyle = 'rgba(10,9,8,1)';
      g.fill();
      g.strokeStyle = 'rgba(40,36,32,0.7)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        let a = Math.random() * Math.PI * 2, r = s * 0.14;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
        for (let k = 0; k < 4; k++) {
          a += (Math.random() - 0.5) * 0.5;
          r += s * 0.07;
          g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
        }
        g.stroke();
      }
    } else if (kind === 'wood') {
      // splintered: torn fibres along the grain (vertical), dark punched core
      for (let i = 0; i < 26; i++) {
        const x = c + (Math.random() - 0.5) * s * 0.32;
        const len = s * (0.12 + Math.random() * 0.3);
        g.strokeStyle = `rgba(${200 + Math.random() * 40},${160 + Math.random() * 30},${110 + Math.random() * 30},${0.4 + Math.random() * 0.4})`;
        g.lineWidth = 1 + Math.random() * 2.5;
        g.beginPath();
        g.moveTo(x, c);
        g.lineTo(x + (Math.random() - 0.5) * 6, c + (Math.random() < 0.5 ? -len : len));
        g.stroke();
      }
      jag(s * 0.11, 12, 0.3);
      g.fillStyle = 'rgba(14,10,6,1)';
      g.fill();
    } else if (kind === 'metal') {
      // dent with a bright scraped rim and a dark puncture
      const grd = g.createRadialGradient(c, c, s * 0.05, c, c, s * 0.34);
      grd.addColorStop(0, 'rgba(20,20,22,1)');
      grd.addColorStop(0.3, 'rgba(60,60,64,0.95)');
      grd.addColorStop(0.55, 'rgba(225,225,228,0.85)');
      grd.addColorStop(0.75, 'rgba(150,150,155,0.45)');
      grd.addColorStop(1, 'rgba(120,120,125,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    } else {
      // soil: dark disturbed blotch with thrown-out clods
      const grd = g.createRadialGradient(c, c, 0, c, c, s / 2);
      grd.addColorStop(0, 'rgba(18,14,10,0.95)');
      grd.addColorStop(0.35, 'rgba(40,32,22,0.7)');
      grd.addColorStop(1, 'rgba(50,40,28,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, r = s * (0.2 + Math.random() * 0.25);
        g.fillStyle = 'rgba(30,24,16,0.7)';
        g.beginPath();
        g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.5 + Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

const HOLE_OF: Record<string, HoleKind> = {
  plaster: 'masonry', concrete: 'masonry', rock: 'masonry', asphalt: 'masonry', glass: 'masonry',
  wood: 'wood', cloth: 'wood', metal: 'metal', grass: 'soil', dirt: 'soil', gravel: 'soil', foliage: 'soil',
};
const HOLE_SIZE: Record<HoleKind, number> = { masonry: 0.085, wood: 0.07, metal: 0.05, soil: 0.13 };

export function flashTexture() {
  return canvasTex(128, (g, s) => {
    g.translate(s / 2, s / 2);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    grd.addColorStop(0, 'rgba(255,250,235,1)');
    grd.addColorStop(0.15, 'rgba(255,210,120,0.95)');
    grd.addColorStop(0.45, 'rgba(255,140,40,0.35)');
    grd.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = grd;
    for (let i = 0; i < 9; i++) {
      g.rotate((Math.PI * 2) / 9 + Math.random() * 0.2);
      g.beginPath();
      g.moveTo(-6, 0);
      g.lineTo(0, -s / 2 * (0.5 + Math.random() * 0.5));
      g.lineTo(6, 0);
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, s * 0.2, 0, Math.PI * 2);
    g.fill();
  });
}

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: THREE.Color;
  alpha: number;
  gravity: number;
  drag: number;
  additive: boolean;
}

const SURF_DUST: Partial<Record<Surface | 'dirt' | 'gravel', number>> = {
  grass: 0x6f6448, dirt: 0x6a5a44, gravel: 0x8a8070, rock: 0x8d877c, concrete: 0xa09a90, plaster: 0xb8b0a0,
  asphalt: 0x5a5856, wood: 0x8a6a48, metal: 0x707070, glass: 0xc8d0d0, cloth: 0x606050, foliage: 0x4a5a30, flesh: 0x5a0a08,
};

export class Effects {
  private particles: Particle[] = [];
  private mesh: THREE.InstancedMesh;
  private addMesh: THREE.InstancedMesh;
  private colorAttr: THREE.InstancedBufferAttribute;
  private addColorAttr: THREE.InstancedBufferAttribute;
  private decals = new Map<HoleKind, { mesh: THREE.InstancedMesh; idx: number }>();
  private decalMats = new Map<HoleKind, THREE.Material>();
  private attached: THREE.Mesh[] = [];
  private holeGeo = new THREE.PlaneGeometry(1, 1);
  private blood!: THREE.InstancedMesh;
  private bloodCell!: THREE.InstancedBufferAttribute;
  private bloodIdx = 0;
  /** where the player is looking from: far-off blood is drawn bigger so a hit still reads */
  eye = new THREE.Vector3();
  flashLight: THREE.PointLight;
  private flashT = 0;
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3();

  constructor(scene: THREE.Scene, atmo: Atmosphere) {
    for (let i = 0; i < MAX_P; i++) {
      this.particles.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 0, color: new THREE.Color(), alpha: 1, gravity: 0, drag: 0, additive: false });
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const smoke = smokeTexture();
    const mk = (additive: boolean) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { tMap: { value: smoke } },
        vertexShader: /* glsl */ `
          attribute vec4 iColor;
          varying vec4 vColor;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vColor = iColor;
            vec3 c = instanceMatrix[3].xyz;
            float s = length(instanceMatrix[0].xyz);
            vec4 mv = viewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * s;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tMap;
          varying vec4 vColor;
          varying vec2 vUv;
          void main() {
            float a = texture2D(tMap, vUv).a * vColor.a;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor.rgb, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const m = new THREE.InstancedMesh(quad, mat, MAX_P);
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 5;
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      m.geometry = quad.clone();
      m.geometry.setAttribute('iColor', attr);
      scene.add(m);
      return { m, attr };
    };
    const a = mk(false);
    const b = mk(true);
    this.mesh = a.m;
    this.colorAttr = a.attr;
    this.addMesh = b.m;
    this.addColorAttr = b.attr;

    for (const kind of ['masonry', 'wood', 'metal', 'soil'] as HoleKind[]) {
      const dmat = new THREE.MeshStandardMaterial({
        map: holeTexture(kind),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        roughness: kind === 'metal' ? 0.35 : 0.95,
        metalness: kind === 'metal' ? 0.8 : 0,
      });
      atmo.register(dmat);
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dmat, MAX_DECALS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.decals.set(kind, { mesh, idx: 0 });
      this.decalMats.set(kind, dmat);
    }

    // blood on the ground and the walls: one sheet of four shapes, each decal shows one
    {
      const bmat = new THREE.MeshStandardMaterial({
        map: bloodTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
        roughness: 0.32,
        metalness: 0,
      });
      atmo.register(bmat, (shader: { vertexShader: string }) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 iCell;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = uv * 0.5 + iCell;\n#endif');
      }, 'blood');
      const geo = new THREE.PlaneGeometry(1, 1);
      this.bloodCell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOOD * 2), 2);
      geo.setAttribute('iCell', this.bloodCell);
      this.blood = new THREE.InstancedMesh(geo, bmat, MAX_BLOOD);
      this.blood.count = 0;
      this.blood.frustumCulled = false;
      this.blood.receiveShadow = true;
      this.blood.renderOrder = 3;
      scene.add(this.blood);
    }

    this.flashLight = new THREE.PointLight(0xffb060, 0, 14, 2);
    scene.add(this.flashLight);
  }

  private spawn(o: Partial<Particle> & { p: THREE.Vector3 }) {
    const pt = this.particles.find((x) => !x.alive);
    if (!pt) return;
    pt.alive = true;
    pt.p.copy(o.p);
    pt.v.copy(o.v ?? new THREE.Vector3());
    pt.max = o.max ?? 1;
    pt.life = pt.max;
    pt.size = o.size ?? 0.2;
    pt.grow = o.grow ?? 0;
    pt.color.copy(o.color ?? new THREE.Color(1, 1, 1));
    pt.alpha = o.alpha ?? 1;
    pt.gravity = o.gravity ?? 0;
    pt.drag = o.drag ?? 1;
    pt.additive = o.additive ?? false;
  }

  /** attachTo: moving objects (doors) get their holes parented so they move with them */
  impact(surface: Surface | string, point: THREE.Vector3, normal: THREE.Vector3, decal = true, attachTo?: THREE.Object3D) {
    const col = new THREE.Color(SURF_DUST[surface as Surface] ?? 0x777060);
    const n = normal.clone().normalize();
    const rand = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (surface === 'flesh') {
      // called with a bare surface and no bullet direction: a burst straight off the body
      this.bleed(point, n.clone().negate(), 0.6);
      return;
    }
    // dust plume
    for (let i = 0; i < 6; i++) {
      this.spawn({ p: point.clone().addScaledVector(n, 0.05), v: n.clone().multiplyScalar(0.8 + Math.random() * 1.6).add(rand().multiplyScalar(0.9)), max: 1.4 + Math.random() * 1.2, size: 0.12, grow: 0.55, color: col.clone().multiplyScalar(1.1), alpha: 0.55, gravity: -0.15, drag: 2.6 });
    }
    // debris chips
    const chips = surface === 'grass' ? 4 : 9;
    for (let i = 0; i < chips; i++) {
      this.spawn({ p: point, v: n.clone().multiplyScalar(2 + Math.random() * 3).add(rand().multiplyScalar(3.5)), max: 0.6 + Math.random() * 0.5, size: 0.025, grow: 0, color: col.clone().multiplyScalar(0.55), alpha: 1, gravity: 9.8, drag: 0.4 });
    }
    if (surface === 'metal' || surface === 'rock' || surface === 'concrete') {
      for (let i = 0; i < (surface === 'metal' ? 14 : 5); i++) {
        this.spawn({ p: point, v: n.clone().multiplyScalar(2).add(rand().multiplyScalar(7)), max: 0.18 + Math.random() * 0.2, size: 0.02, color: new THREE.Color(3.5, 2.0, 0.7), alpha: 1, gravity: 9.8, drag: 0.2, additive: true });
      }
    }
    if (decal && surface !== 'foliage' && surface !== 'glass') this.decal(point, n, HOLE_OF[surface] ?? 'masonry', attachTo);
  }

  /**
   * A body was hit. A puff of red at the wound, drops thrown on through with the bullet and
   * a few back toward the shooter, and whatever was behind (and the ground underneath) spattered.
   * @param dir the way the bullet or the blow was travelling
   * @param power 1 = a rifle round, less for a pistol, a blade or a fist
   * @param self it is the player's own body: no cloud of it in front of the eyes
   */
  bleed(point: THREE.Vector3, dir: THREE.Vector3, power = 1, self = false) {
    const d = dir.clone().normalize();
    const far = THREE.MathUtils.clamp(point.distanceTo(this.eye) / 22, 1, 4);
    const rand = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    const red = () => new THREE.Color(0.5 + Math.random() * 0.14, 0.012, 0.008);
    // the puff: hangs at the wound for a moment, then thins
    const mist = self ? 0 : Math.round(3 + power * 4);
    for (let i = 0; i < mist; i++) {
      const out = i % 3 === 0 ? -0.9 : 1.2;
      this.spawn({ p: point.clone().addScaledVector(d, out > 0 ? 0.12 : -0.05), v: d.clone().multiplyScalar(out * (0.5 + Math.random())).add(rand().multiplyScalar(0.9)), max: 0.42 + Math.random() * 0.28, size: 0.13 * far, grow: (0.4 + power * 0.3) * far, color: red(), alpha: 0.9, gravity: 1.2, drag: 3.2 });
    }
    // drops: most carry on with the bullet, some come back out of the entry
    const drops = Math.round(8 + power * 12);
    for (let i = 0; i < drops; i++) {
      const back = i % 4 === 0;
      const v = d.clone().multiplyScalar(back ? -(1 + Math.random() * 2) : 2 + Math.random() * 5.5 * power).add(rand().multiplyScalar(back ? 2.4 : 3));
      v.y += 0.8 + Math.random() * 1.4;
      this.spawn({ p: point.clone().addScaledVector(d, back ? -0.04 : 0.14), v, max: 0.5 + Math.random() * 0.4, size: (0.022 + Math.random() * 0.03) * Math.sqrt(far), grow: 0, color: red().multiplyScalar(0.8), alpha: 1, gravity: 9.8, drag: 0.5 });
    }
    // a fist draws a little blood, not a spray of it
    if (power < 0.4) return;
    // what was behind them
    const through = d.clone();
    through.y -= 0.12;
    through.normalize();
    const wall = physics.raycast(point.clone().addScaledVector(d, 0.3), through, 2.6 + power * 1.6, SOLID_GROUPS);
    if (wall && wall.toi > 0.02) {
      const n = new THREE.Vector3(wall.normal.x, wall.normal.y, wall.normal.z);
      const upright = Math.abs(n.y) < 0.6;
      this.bloodDecal(new THREE.Vector3(wall.point.x, wall.point.y, wall.point.z), n, upright ? 0 : 1, (0.4 + Math.random() * 0.3) * (0.7 + power * 0.5), upright ? _UP : through);
    }
    // and the ground under and beyond them
    const n0 = Math.round(1 + power * 2);
    for (let i = 0; i < n0; i++) {
      const reach = i === 0 ? 0.15 : 0.5 + Math.random() * (0.8 + power * 1.4);
      const from = point.clone().addScaledVector(d, reach).add(rand().multiplyScalar(i === 0 ? 0.2 : 0.5));
      from.y = point.y + 0.1;
      const g = physics.raycast(from, _DOWN, 3, SOLID_GROUPS);
      if (!g || g.toi < 0.02) continue;
      const gn = new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z);
      if (gn.y < 0.5) continue;
      this.bloodDecal(new THREE.Vector3(g.point.x, g.point.y, g.point.z), gn, i === 0 ? 2 : 0, (i === 0 ? 0.3 : 0.38) + Math.random() * 0.26 * power, d);
    }
  }

  /** A grenade: a flash, a ball of fire that is smoke a moment later, earth thrown up, and the ground left black. */
  explode(at: THREE.Vector3) {
    this.flashLight.position.copy(at).setY(at.y + 0.6);
    this.flashLight.color.setRGB(1, 0.72, 0.4);
    this.flashLight.intensity = 260;
    this.flashLight.distance = 30;
    this.flashT = 0.11;
    const far = THREE.MathUtils.clamp(at.distanceTo(this.eye) / 40, 1, 2.5);
    const rand = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    // the fire: a moment, but long enough to see
    for (let i = 0; i < 22; i++) {
      this.spawn({ p: at.clone().add(rand().multiplyScalar(0.7)), v: rand().multiplyScalar(6).setY(1.5 + Math.random() * 5), max: 0.34 + Math.random() * 0.3, size: 1.0 * far, grow: 3.4, color: new THREE.Color(5, 2.4, 0.6), alpha: 0.95, gravity: -1.5, drag: 2.6, additive: true });
    }
    // the smoke it turns into: dark, tall, and there for a while
    for (let i = 0; i < 44; i++) {
      const out = rand().multiplyScalar(6);
      out.y = Math.abs(out.y) * 1.3 + 1.2;
      const k = 0.07 + Math.random() * 0.1;
      this.spawn({ p: at.clone().add(rand().multiplyScalar(0.9)), v: out, max: 3 + Math.random() * 3.2, size: 1.2, grow: 4.5 + Math.random() * 2.6, color: new THREE.Color(k, k, k * 0.95), alpha: 0.82, gravity: -0.7, drag: 2 });
    }
    // dust rolling out along the ground
    for (let i = 0; i < 24; i++) {
      const a2 = (i / 24) * Math.PI * 2 + Math.random() * 0.3;
      this.spawn({ p: at.clone(), v: new THREE.Vector3(Math.cos(a2) * (7 + Math.random() * 4), 0.6 + Math.random(), Math.sin(a2) * (7 + Math.random() * 4)), max: 1.6 + Math.random() * 1.2, size: 0.8, grow: 3.2, color: new THREE.Color(0.42, 0.36, 0.28), alpha: 0.5, gravity: 0, drag: 2.8 });
    }
    for (let i = 0; i < 46; i++) {
      const out = rand().multiplyScalar(15);
      out.y = Math.abs(out.y) + 2.5;
      this.spawn({ p: at.clone(), v: out, max: 0.9 + Math.random() * 0.9, size: 0.045 + Math.random() * 0.05, grow: 0, color: new THREE.Color(0.2, 0.16, 0.11), alpha: 1, gravity: 9.8, drag: 0.35 });
    }
    for (let i = 0; i < 26; i++) {
      this.spawn({ p: at.clone(), v: rand().multiplyScalar(22).setY(Math.random() * 11), max: 0.25 + Math.random() * 0.3, size: 0.03, color: new THREE.Color(4, 2.2, 0.8), alpha: 1, gravity: 9.8, drag: 0.6, additive: true });
    }
    // the ground it leaves behind
    const g = physics.raycast(at.clone().setY(at.y + 0.5), _DOWN, 3, SOLID_GROUPS);
    if (g && g.toi > 0.02) {
      const n = new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z);
      for (let i = 0; i < 5; i++) {
        const p = new THREE.Vector3(g.point.x + (Math.random() - 0.5) * 1.4, g.point.y, g.point.z + (Math.random() - 0.5) * 1.4);
        this.decal(p, n, 'soil', undefined, 5 + Math.random() * 4);
      }
    }
  }

  /** drops off an open wound: a few fall, and one lands */
  drip(from: THREE.Vector3) {
    for (let i = 0; i < 2; i++) {
      this.spawn({ p: from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.1)), v: new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.4, (Math.random() - 0.5) * 0.3), max: 0.55, size: 0.028, grow: 0, color: new THREE.Color(0.5, 0.012, 0.008), alpha: 1, gravity: 9.8, drag: 0.2 });
    }
    const g = physics.raycast(from, _DOWN, 2.5, SOLID_GROUPS);
    if (!g || g.toi < 0.02) return;
    const gn = new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z);
    if (gn.y > 0.5) this.bloodDecal(new THREE.Vector3(g.point.x + (Math.random() - 0.5) * 0.16, g.point.y, g.point.z + (Math.random() - 0.5) * 0.16), gn, 3, 0.15 + Math.random() * 0.13);
  }

  /** a pool spreading under a body */
  pool(x: number, y: number, z: number) {
    const g = physics.raycast({ x, y: y + 0.6, z }, _DOWN, 2, SOLID_GROUPS);
    const at = g && g.toi > 0.02 ? new THREE.Vector3(g.point.x, g.point.y, g.point.z) : new THREE.Vector3(x, y, z);
    const n = g ? new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z) : new THREE.Vector3(0, 1, 0);
    this.bloodDecal(at, n, 1, 0.95 + Math.random() * 0.3);
  }

  /**
   * @param along world direction the shape's "up" is turned toward (the way the blood was thrown); random if not given
   */
  private bloodDecal(point: THREE.Vector3, normal: THREE.Vector3, kind: BloodKind, size: number, along?: THREE.Vector3) {
    this._q.setFromUnitVectors(_Z, normal);
    let spin = Math.random() * Math.PI * 2;
    if (along) {
      // the plane's +Y after facing the normal, and where the throw direction falls on the surface
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this._q);
      const flat = along.clone().addScaledVector(normal, -along.dot(normal));
      if (flat.lengthSq() > 1e-4) {
        flat.normalize();
        spin = Math.atan2(new THREE.Vector3().crossVectors(up, flat).dot(normal), up.dot(flat)) + (Math.random() - 0.5) * 0.5;
      }
    }
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(_Z, spin));
    this._s.setScalar(size);
    this._m.compose(point.clone().addScaledVector(normal, 0.006), this._q, this._s);
    const i = this.bloodIdx;
    this.bloodIdx = (i + 1) % MAX_BLOOD;
    this.blood.setMatrixAt(i, this._m);
    this.bloodCell.setXY(i, BLOOD_CELL[kind][0], BLOOD_CELL[kind][1]);
    this.blood.count = Math.min(MAX_BLOOD, this.blood.count + 1);
    this.blood.instanceMatrix.needsUpdate = true;
    this.bloodCell.needsUpdate = true;
  }

  decal(point: THREE.Vector3, normal: THREE.Vector3, kind: HoleKind, attachTo?: THREE.Object3D, scale = 1) {
    const size = HOLE_SIZE[kind] * (0.85 + Math.random() * 0.35) * scale;
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    // wood splinters follow the (vertical) grain; others get a random spin
    const spin = kind === 'wood' ? 0 : Math.random() * Math.PI * 2;
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin));
    this._s.setScalar(size);
    this._m.compose(point.clone().addScaledVector(normal, 0.004), this._q, this._s);
    if (attachTo) {
      const hole = new THREE.Mesh(this.holeGeo, this.decalMats.get(kind)!);
      attachTo.updateMatrixWorld(true);
      hole.applyMatrix4(new THREE.Matrix4().copy(attachTo.matrixWorld).invert().multiply(this._m));
      hole.renderOrder = 3;
      attachTo.add(hole);
      this.attached.push(hole);
      if (this.attached.length > 60) this.attached.shift()!.removeFromParent();
      return;
    }
    const d = this.decals.get(kind)!;
    d.mesh.setMatrixAt(d.idx, this._m);
    d.idx = (d.idx + 1) % MAX_DECALS;
    d.mesh.count = Math.min(MAX_DECALS, d.mesh.count + 1);
    d.mesh.instanceMatrix.needsUpdate = true;
  }

  muzzle(worldPos: THREE.Vector3, dir: THREE.Vector3, big: boolean, suppressed = false) {
    if (!suppressed) {
      this.flashLight.position.copy(worldPos);
      this.flashLight.color.set(0xffb060);
      this.flashLight.distance = 14;
      this.flashLight.intensity = big ? 45 : 25;
      this.flashT = 0.055;
    }
    // a little smoke drifting from the muzzle
    for (let i = 0; i < (big ? 5 : 3); i++) {
      this.spawn({ p: worldPos.clone().addScaledVector(dir, 0.1), v: dir.clone().multiplyScalar(0.6 + Math.random()).add(new THREE.Vector3(0, 0.25, 0)), max: 1.2 + Math.random(), size: 0.06, grow: 0.35, color: new THREE.Color(0.75, 0.74, 0.72), alpha: 0.22, gravity: -0.3, drag: 1.8 });
    }
  }

  update(dt: number) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flashLight.intensity = 0;
        this.flashLight.distance = 14;
        this.flashLight.color.set(0xffb060);
      }
    }
    let n = 0, na = 0;
    const ca = this.colorAttr.array as Float32Array;
    const cb = this.addColorAttr.array as Float32Array;
    for (const pt of this.particles) {
      if (!pt.alive) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.alive = false;
        continue;
      }
      pt.v.y -= pt.gravity * dt;
      pt.v.multiplyScalar(Math.exp(-pt.drag * dt));
      pt.p.addScaledVector(pt.v, dt);
      const k = pt.life / pt.max;
      const size = pt.size + pt.grow * (1 - k);
      this._m.makeScale(size, size, size).setPosition(pt.p);
      const fade = Math.min(1, k * 2.5) * pt.alpha;
      if (pt.additive) {
        this.addMesh.setMatrixAt(na, this._m);
        cb[na * 4] = pt.color.r; cb[na * 4 + 1] = pt.color.g; cb[na * 4 + 2] = pt.color.b; cb[na * 4 + 3] = fade;
        na++;
      } else {
        this.mesh.setMatrixAt(n, this._m);
        ca[n * 4] = pt.color.r; ca[n * 4 + 1] = pt.color.g; ca[n * 4 + 2] = pt.color.b; ca[n * 4 + 3] = fade;
        n++;
      }
    }
    // upload only the live particles (nothing at all when none are alive)
    const upload = (mesh: THREE.InstancedMesh, color: THREE.InstancedBufferAttribute, count: number) => {
      const was = mesh.count;
      mesh.count = count;
      if (!count && !was) return;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      color.clearUpdateRanges();
      color.addUpdateRange(0, count * 4);
      color.needsUpdate = true;
    };
    upload(this.mesh, this.colorAttr, n);
    upload(this.addMesh, this.addColorAttr, na);
  }
}
