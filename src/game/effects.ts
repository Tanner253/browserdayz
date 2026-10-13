// Impact / weapon effects: billboard particle pool (dust, debris, sparks, blood),
// bullet-hole decals, muzzle flash light. Smoke and dust are puffs out of Kenney's Particle Pack (see
// scripts/fx.mjs); the rest of the textures are made here. A blast is not made here any more: see blast.ts.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics, SOLID_GROUPS, type Surface } from '../core/physics';
import type { Atmosphere } from '../world/atmosphere';
import { roadLift } from '../world/road';
import { SNOW, type World } from '../world/worldgen';
import { AIR_AT, airGlsl, Blasts, type BlastKind } from './blast';
import { Flames, type Fire } from './flames';
import { MuzzleFlash, muzzleArt } from './muzzle';

const MAX_P = 600;
const MAX_DECALS = 160;
const MAX_BLOOD = 220;
const _Z = new THREE.Vector3(0, 0, 1);
const _DOWN = new THREE.Vector3(0, -1, 0);
const _UP = new THREE.Vector3(0, 1, 0);
const _UP_OF = new THREE.Vector3();

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
  /** which picture of the sheet it is drawn with (0 to 2 a puff of smoke, 3 a plain dot), how it is turned, and how fast it turns */
  cell: number;
  rot: number;
  spin: number;
  /** seconds it takes to come to its full strength (0: it is there at once). Smoke that gathers over a fire is not a puff that appears */
  soft: number;
}

/**
 * The wind a fire's smoke leans with (the signal smoke leans the same way), metres a second, and how far a
 * flame a metre high is pushed over by it.
 */
const WIND = { x: 0.45, z: 0.28, lean: 0.14 };
/**
 * A campfire's smoke. `from`: how high over the foot of the fire the column gathers, metres: over the tops of
 * the flames, where the wisps that rise through them thin out (the column and they are one smoke: it began at
 * the tops of the logs, as round grey puffs in among the flames). `soft`: seconds a puff takes to be seen.
 */
const COLUMN = { from: 1.1, soft: 1.0 };
/**
 * A car on fire. `engine`: how big its flames are while it is alight and not yet gone up (1 is a campfire's),
 * and `wreck`: after it has. `full`, `burns`: a wreck burns at its fiercest for this many seconds after it
 * blows, and has settled by this many to a steady fire, `steady` as hard and `low` as big, which it keeps for as
 * long as it stands (2026-10-13: "when the car is burned and destroyed it should remain on fire like a campfire
 * animation with black smoke until it despawns". It was down to grey smoke in seventy seconds, and one come upon
 * after it had gone up was cold.)
 */
const CAR = { engine: 1.25, wreck: 2.1, full: 18, burns: 70, steady: 0.8, low: 1.35 };

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
  private lookAttr: THREE.InstancedBufferAttribute;
  private addLookAttr: THREE.InstancedBufferAttribute;
  private decals = new Map<HoleKind, { mesh: THREE.InstancedMesh; idx: number }>();
  private decalMats = new Map<HoleKind, THREE.Material>();
  private attached: THREE.Mesh[] = [];
  private holeGeo = new THREE.PlaneGeometry(1, 1);
  private blood!: THREE.InstancedMesh;
  private bloodCell!: THREE.InstancedBufferAttribute;
  private bloodIdx = 0;
  /** where the player is looking from: far-off blood is drawn bigger so a hit still reads */
  eye = new THREE.Vector3();
  /**
   * The one lamp for whatever flashes: a shot, and a blast. The brighter of the two has it (see `update`): it was
   * whoever asked last, so a shot fired as a drum went up put the drum's light out, and a blast's light was full
   * on for a tenth of a second and then gone between one frame and the next.
   */
  flashLight: THREE.PointLight;
  private flashT = 0;
  /** who has the lamp */
  private lampIs: 'shot' | 'blast' | null = null;
  /** grenades, drums of fuel and cars going up: everything of a blast (see blast.ts) */
  readonly blasts: Blasts;
  /** when a car was last said to have gone up (see `wrecked`): the blast that comes with that word is the car's */
  private carWent = -1e9;
  /** the flames at other people's muzzles: a few, used in turn */
  private flames: MuzzleFlash[] = [];
  private flame = 0;
  /** whatever is on fire: a campfire, a car (and whatever else is given flames: see Flames) */
  readonly fire: Flames;
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3();

  constructor(scene: THREE.Scene, atmo: Atmosphere) {
    this.fire = new Flames(scene, atmo);
    this.blasts = new Blasts(scene, atmo, this.fire);
    for (let i = 0; i < MAX_P; i++) {
      this.particles.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 0, color: new THREE.Color(), alpha: 1, gravity: 0, drag: 0, additive: false, cell: 3, rot: 0, spin: 0, soft: 0 });
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    // What everything is drawn with until the sheet of puffs has come (and for good, if it never does): the
    // made-up blob. Then the sheet: two tiles by two, a particle's own tile, turned its own way.
    const smoke = { value: smokeTexture() as THREE.Texture }, sheet = { value: 0 };
    // (by its address with its version in it, as every other file is asked for: asked for bare, a new sheet was never fetched by anybody who had the old one)
    new THREE.TextureLoader().load(assets.url('assets/fx/smoke.webp'), (t) => {
      t.colorSpace = THREE.NoColorSpace;
      smoke.value = t;
      sheet.value = 1;
    }, undefined, () => {});
    const fog = scene.fog as THREE.FogExp2 | null;
    const mk = (additive: boolean) => {
      const mat = new THREE.ShaderMaterial({
        // (smoke and dust have no light of their own: they are as bright as the hour. Flame and sparks are their own light.)
        // (And the air between has them, as it has everything else: a column of smoke across the valley stood as
        // sharp and as dark as one at arm's length, and one in the gas was drawn as if the gas were not there.
        // Reckoned at each puff's middle: see `airGlsl` in blast.ts.)
        uniforms: { tMap: smoke, uSheet: sheet, uLight: additive ? { value: 1 } : atmo.daylight, fogColor: { value: fog ? fog.color : new THREE.Color() }, fogDensity: atmo.seconds },
        defines: fog ? { USE_FOG: '', FOG_EXP2: '' } : {},
        vertexShader: /* glsl */ `
          attribute vec4 iColor;
          attribute vec2 iLook;
          uniform float uSheet;
          varying vec4 vColor;
          varying vec2 vUv;
          varying vec4 vAir;
          ${airGlsl()}
          void main() {
            // (the sheet is laid out from its top; a picture is read from its foot)
            vUv = mix(uv, (uv + vec2(mod(iLook.x, 2.0), 1.0 - floor(iLook.x * 0.5))) * 0.5, uSheet);
            vColor = iColor;
            vec3 c = instanceMatrix[3].xyz;
            float s = length(instanceMatrix[0].xyz);
            vec4 mv = viewMatrix * vec4(c, 1.0);
            float co = cos(iLook.y), si = sin(iLook.y);
            mv.xy += vec2(position.x * co - position.y * si, position.x * si + position.y * co) * s;
            vec3 world = c;
            ${AIR_AT}
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tMap;
          uniform float uLight;
          uniform float uSheet;
          varying vec4 vColor;
          varying vec2 vUv;
          varying vec4 vAir;
          void main() {
            vec4 t = texture2D(tMap, vUv);
            float a = mix(t.a, t.r, uSheet) * vColor.a;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor.rgb * uLight * vAir.a${additive ? '' : ' + vAir.rgb'}, a);
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
      const look = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 2), 2);
      look.setUsage(THREE.DynamicDrawUsage);
      m.geometry = quad.clone();
      m.geometry.setAttribute('iColor', attr);
      m.geometry.setAttribute('iLook', look);
      scene.add(m);
      return { m, attr, look };
    };
    const a = mk(false);
    const b = mk(true);
    this.mesh = a.m;
    this.colorAttr = a.attr;
    this.lookAttr = a.look;
    this.addMesh = b.m;
    this.addColorAttr = b.attr;
    this.addLookAttr = b.look;

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
    // (once their pictures are here: nobody shoots before that)
    void muzzleArt().then((art) => {
      for (let i = 0; i < 6; i++) {
        const f = new MuzzleFlash(art);
        scene.add(f.root);
        this.flames.push(f);
      }
    });
  }

  private spawn(o: Partial<Particle> & { p: THREE.Vector3 }) {
    let pt = this.particles.find((x) => !x.alive);
    if (!pt) {
      // (None left: the one nearest its end, which is all but faded out, gives up its place. A thing asked for
      // while every place was taken was simply not made, and nothing said so.)
      let least = Infinity;
      for (const x of this.particles) {
        if (x.life < least) {
          least = x.life;
          pt = x;
        }
      }
    }
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
    pt.soft = o.soft ?? 0;
    // What swells as it goes is smoke or dust, and is drawn as a puff, each its own and turned its own way; what
    // does not (a spark, a chip of stone, a drop) is a dot. A light that swells (a flash) is a dot as well.
    const puff = pt.grow > 0 && !pt.additive;
    pt.cell = puff ? Math.floor(Math.random() * 3) : 3;
    pt.rot = puff ? Math.random() * Math.PI * 2 : 0;
    pt.spin = puff ? (Math.random() - 0.5) * 0.7 : 0;
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

  /**
   * Something has gone off: a grenade, a drum of fuel, a car. All of it is made in blast.ts.
   * @param what which; or, as it used to be asked, whether it was fuel (true: a drum, or a car if one has just
   *   been said to have gone up: see `wrecked`)
   */
  explode(at: THREE.Vector3, what: boolean | BlastKind = false) {
    const kind: BlastKind = typeof what === 'string' ? what : !what ? 'grenade' : performance.now() - this.carWent < 150 ? 'vehicle' : 'drum';
    this.carWent = -1e9;
    this.blasts.go(at, kind, this.eye);
  }

  /**
   * Told once, by whoever made the world: what the ground is anywhere on it. A blast throws the ground it is on
   * and raises its dust, and what stops a body knows the open ground only as one thing: the road, the four
   * grounds the land is painted with and the snow on the heights are the world's to say (the same way a footstep
   * and a tyre are told: the road first, then the land's own).
   */
  world(terrain: { surfaceAt(x: number, z: number): 'grass' | 'dirt' | 'rock' | 'gravel' }, world: World) {
    const snowUp = 1 / Math.hypot(1, SNOW.slope);
    this.blasts.groundAt = (x, y, z, up) => (roadLift(world, x, z) > 0 ? 'asphalt' : y > (SNOW.from + SNOW.full) / 2 && up > snowUp ? 'snow' : terrain.surfaceAt(x, z));
    // (and how far the road's own surface stands over the ground that stops a body under it)
    this.blasts.liftAt = (x, z) => roadLift(world, x, z);
  }

  /** how far the view is thrown off by blasts just now (radians), for whoever holds the camera: see Blasts.shake */
  get shake() {
    return this.blasts.shake;
  }

  /**
   * A jeep that has been shot up: smoke off the bonnet, thicker the less it has left, and
   * flames in it once it is alight. Call every frame it should burn. A wreck that was seen to go up (see
   * `wrecked`) burns on for a while where it stands, and dies down to the smoke of a wreck.
   * @param fire it is alight, and about to go up
   * @param tilt how the car lies: its flames lean the way it leans
   * @param vel how it is moving: and trail behind it as it goes
   */
  engineSmoke(at: THREE.Vector3, state: { owed: number; fire?: Fire; blown?: number }, dt: number, fire: boolean, amount: number, tilt?: THREE.Quaternion, vel?: THREE.Vector3, burnt = false) {
    const since = state.blown === undefined ? Infinity : (performance.now() - state.blown) / 1000;
    // (how far a wreck's fire has settled from its fiercest to the steady one it keeps: one found burned already has)
    const settled = THREE.MathUtils.smoothstep(Math.min(since, CAR.burns), CAR.full, CAR.burns);
    // (how hard a wreck burns: all of it at first, then steadily for as long as it stands)
    const wreck = fire || !burnt ? 0 : THREE.MathUtils.lerp(1, CAR.steady, settled);
    if (fire || wreck > 0) {
      const f = this.fire.feed(state, at);
      // (alight, it burns the harder the nearer it is to going up; and whatever burns, catches over a second, not in a frame)
      const want = fire ? 0.55 + 0.45 * THREE.MathUtils.clamp((amount - 0.7) / 0.3, 0, 1) : wreck;
      f.strength = Math.min(want, f.strength + dt * 1.2);
      f.size = fire ? CAR.engine : THREE.MathUtils.lerp(CAR.wreck, CAR.low, settled);
      // (the black smoke of it is made below: of the flames' own smoke, only the wisps among them)
      f.smoke = 0.5;
      const up = _UP_OF.set(0, 1, 0);
      if (tilt) up.applyQuaternion(tilt);
      f.lean.set(up.x * 0.6 + WIND.x * WIND.lean, 0, up.z * 0.6 + WIND.z * WIND.lean);
      if (vel) f.lean.addScaledVector(vel, -0.06).setY(0);
      f.lean.clampLength(0, 0.9);
    }
    const burning = fire || wreck > 0.05;
    state.owed = Math.min(4, state.owed + dt * (4 + amount * 9) * (1 + wreck * 2));
    while (state.owed >= 1) {
      state.owed -= 1;
      const k = burning ? 0.05 + Math.random() * 0.06 : 0.16 + Math.random() * 0.12 - amount * 0.08;
      this.spawn({
        // (over the flames, where there are flames: the smoke of a burning car comes off the top of the fire, not out of the middle of it)
        p: new THREE.Vector3(at.x + (Math.random() - 0.5) * 0.5, at.y + (burning ? 0.5 + wreck * 0.7 : 0), at.z + (Math.random() - 0.5) * 0.5),
        v: new THREE.Vector3((Math.random() - 0.5) * 0.6 + 0.3, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6 + 0.2),
        max: 2 + Math.random() * 1.6 + amount * 1.5,
        size: 0.35,
        grow: 1.6 + amount * 1.6,
        color: new THREE.Color(k, k, k),
        alpha: 0.35 + amount * 0.35,
        gravity: -0.9,
        drag: 0.9,
        soft: burning ? 0.5 : 0,
      });
    }
  }

  /** A car has just gone up, and was seen to: its wreck burns from now (see `engineSmoke`). One found already burned out is cold. */
  wrecked(state: { owed: number; blown?: number }) {
    state.blown = performance.now();
    this.carWent = state.blown;
  }

  /**
   * A campfire: the flames that came with it, stood in the wood (see Flames); a spark now and then; and grey
   * smoke standing over it to be seen from a long way off. Call every frame it burns.
   * @param at the foot of the fire: the middle of its ring, at the ground
   * @param state the caller's own count of what is owed (each fire keeps its own pace), and its flames
   * @param life 1 burning well, down to 0 as it sinks to ash (or as it catches)
   * @param close near enough for its flames to be seen (far off, only its smoke is made)
   * @param turn how its ring is turned, radians: the flames that run along the logs lie along them
   * @param glow how bright it is at this moment, about 1 (whoever lights the ground from it says how its lamp flickers)
   */
  campfire(at: THREE.Vector3, state: { flame: number; smoke: number; fire?: Fire }, dt: number, life: number, close: boolean, turn = 0, glow = 1) {
    state.smoke = Math.min(3, state.smoke + dt * (1.6 + 3.2 * life));
    while (state.smoke >= 1) {
      state.smoke -= 1;
      const k = 0.1 + Math.random() * 0.08;
      this.spawn({
        p: new THREE.Vector3(at.x + (Math.random() - 0.5) * 0.3, at.y + COLUMN.from + Math.random() * 0.3, at.z + (Math.random() - 0.5) * 0.3),
        // it climbs, and leans with the same wind the signal smoke leans with
        v: new THREE.Vector3(WIND.x + (Math.random() - 0.5) * 0.4, 1.3, WIND.z + (Math.random() - 0.5) * 0.4),
        max: 9 + Math.random() * 3,
        size: 0.45,
        grow: 9,
        color: new THREE.Color(k, k, k * 1.05),
        alpha: 0.42 + 0.26 * life,
        gravity: -2.2,
        drag: 0.6,
        soft: COLUMN.soft,
      });
    }
    if (!close) return;
    const f = this.fire.feed(state, at);
    f.strength = life;
    f.turn = turn;
    f.glow = glow;
    f.lean.set(WIND.x * WIND.lean, 0, WIND.z * WIND.lean);
    // a spark now and then, thrown up out of the wood
    state.flame = Math.min(2, state.flame + dt * 2.2 * life);
    while (state.flame >= 1) {
      state.flame -= 1;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.2;
      this.spawn({
        p: new THREE.Vector3(at.x + Math.cos(a) * r, at.y + 0.5 + Math.random() * 0.4, at.z + Math.sin(a) * r),
        v: new THREE.Vector3((Math.random() - 0.5) * 1.1, 1.8 + Math.random() * 1.8, (Math.random() - 0.5) * 1.1),
        max: 0.7 + Math.random() * 0.8,
        size: 0.022,
        color: new THREE.Color(3, 1.4, 0.3),
        alpha: 1,
        gravity: 1.4,
        drag: 0.7,
        additive: true,
      });
    }
  }

  /** What a tyre throws up behind it: the colour of what it is on, more of it the faster it goes. */
  dust(at: THREE.Vector3, vel: THREE.Vector3, surface: string, amount: number, state: { owed: number }, dt: number) {
    state.owed = Math.min(3, state.owed + dt * amount * 11);
    while (state.owed >= 1) {
      state.owed -= 1;
      const c = new THREE.Color(SURF_DUST[surface as Surface] ?? 0x6f6448).multiplyScalar(0.9 + Math.random() * 0.25);
      this.spawn({
        p: new THREE.Vector3(at.x + (Math.random() - 0.5) * 0.3, at.y + 0.1, at.z + (Math.random() - 0.5) * 0.3),
        v: new THREE.Vector3(vel.x * 0.25 + (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.9, vel.z * 0.25 + (Math.random() - 0.5) * 1.2),
        max: 0.9 + Math.random() * 0.9,
        size: 0.4,
        grow: 2.2,
        color: c,
        alpha: surface === 'asphalt' ? 0.16 : 0.3,
        gravity: -0.2,
        drag: 1.6,
      });
    }
  }

  /**
   * Signal smoke: an orange column standing forty metres over a supply drop, to be seen
   * from across a valley. Call every frame it should burn.
   * @param state the caller's own count of how much smoke is owed (so each column keeps its own pace)
   */
  /** @param burning it is what burns that smokes (a wreck), not a flare: black, thicker, and it stands higher */
  signal(at: THREE.Vector3, state: { owed: number }, dt: number, burning = false) {
    state.owed = Math.min(3, state.owed + dt * (burning ? 7 : 5));
    while (state.owed >= 1) {
      state.owed -= 1;
      const k = 0.85 + Math.random() * 0.3;
      this.spawn({
        p: new THREE.Vector3(at.x + (Math.random() - 0.5) * 0.3, at.y + 0.9, at.z + (Math.random() - 0.5) * 0.3),
        // it climbs, and leans a little with the wind as it goes
        v: new THREE.Vector3(0.5 + (Math.random() - 0.5) * 0.5, 1.4, 0.3 + (Math.random() - 0.5) * 0.5),
        max: (burning ? 10 : 7) + Math.random() * 2.5,
        size: burning ? 1.3 : 0.9,
        grow: burning ? 8 : 6.5,
        color: burning ? new THREE.Color(0.075 * k, 0.07 * k, 0.065 * k) : new THREE.Color(1.05 * k, 0.4 * k, 0.1 * k),
        alpha: burning ? 0.8 : 0.7,
        gravity: -3.3,
        drag: 0.58,
      });
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
    // (on what is under the place, however far down that is: with nothing found near, it was drawn where it was asked for, in the air)
    const g = physics.raycast({ x, y: y + 0.6, z }, _DOWN, 60, SOLID_GROUPS);
    if (!g || g.toi <= 0.02) return;
    this.bloodDecal(new THREE.Vector3(g.point.x, g.point.y, g.point.z), new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z), 1, 0.95 + Math.random() * 0.3);
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

  /** A thread of smoke off something that smoulders. */
  wisp(p: THREE.Vector3) {
    this.spawn({ p, v: new THREE.Vector3((Math.random() - 0.5) * 0.03, 0.14 + Math.random() * 0.06, (Math.random() - 0.5) * 0.03), max: 1.2 + Math.random() * 0.5, size: 0.01, grow: 0.06, color: new THREE.Color(0.8, 0.8, 0.8), alpha: 0.14, gravity: -0.04, drag: 0.7 });
  }

  /** @param flame the flame is drawn here too, this long (somebody else's shot: the player's own gun carries its own) */
  /** @param smoke how much smoke, of what a shot seen from outside gives (1): the one firing is given a good deal less (see tryFire) */
  muzzle(worldPos: THREE.Vector3, dir: THREE.Vector3, big: boolean, suppressed = false, flame = 0, smoke = 1) {
    if (!suppressed && flame > 0) {
      const f = this.flames[this.flame++ % this.flames.length];
      if (!f) return;
      f.root.position.copy(worldPos);
      f.root.lookAt(worldPos.x + dir.x, worldPos.y + dir.y, worldPos.z + dir.z);
      // (lookAt points +z at it; the flame goes down -z)
      f.root.rotateY(Math.PI);
      f.fire(flame);
    }
    // (the lamp, unless a blast brighter than a shot has it)
    if (!suppressed && this.blasts.glow.strength < (big ? 45 : 25)) {
      this.flashLight.position.copy(worldPos);
      this.flashLight.color.set(0xffb060);
      this.flashLight.distance = 14;
      this.flashLight.intensity = big ? 45 : 25;
      this.flashT = 0.055;
      this.lampIs = 'shot';
    }
    // a little smoke drifting from the muzzle
    // (thinner: fewer puffs, fainter, shorter lived, and thrown further and faster from the barrel, up out of its line)
    const n = smoke <= 0 ? 0 : Math.max(1, Math.round((big ? 5 : 3) * smoke)), k = Math.min(1, Math.max(0, smoke));
    for (let i = 0; i < n; i++) {
      this.spawn({
        p: worldPos.clone().addScaledVector(dir, 0.1 + (1 - k) * 0.3),
        v: dir.clone().multiplyScalar((0.6 + Math.random()) * (1 + (1 - k) * 1.6)).add(new THREE.Vector3(0, 0.25 + (1 - k) * 0.35, 0)),
        max: (1.2 + Math.random()) * (0.4 + 0.6 * k), size: 0.06, grow: 0.35 * (0.55 + 0.45 * k), color: new THREE.Color(0.75, 0.74, 0.72), alpha: 0.22 * (0.4 + 0.6 * k), gravity: -0.3, drag: 1.8,
      });
    }
  }

  update(dt: number) {
    this.blasts.update(dt, this.eye);
    this.fire.update(dt, this.eye);
    for (const f of this.flames) f.update(dt);
    // The lamp. A shot has it for a twentieth of a second; a blast for as long as it is brighter than a shot is,
    // dying away as the blast says, and no shot takes it from a blast that is brighter than the shot.
    const glow = this.blasts.glow, lamp = this.flashLight;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0 && this.lampIs === 'shot') this.lampIs = null;
    if (glow.strength > (this.lampIs === 'shot' ? lamp.intensity : 0)) {
      this.lampIs = 'blast';
      this.flashT = 0;
      lamp.position.copy(glow.at);
      lamp.color.copy(glow.color);
      lamp.distance = glow.reach;
      lamp.intensity = glow.strength;
    } else if (this.lampIs === 'blast') this.lampIs = null;
    if (!this.lampIs && lamp.intensity !== 0) {
      lamp.intensity = 0;
      lamp.distance = 14;
      lamp.color.set(0xffb060);
    }
    let n = 0, na = 0;
    const ca = this.colorAttr.array as Float32Array;
    const cb = this.addColorAttr.array as Float32Array;
    const la = this.lookAttr.array as Float32Array;
    const lb = this.addLookAttr.array as Float32Array;
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
      const fade = Math.min(1, k * 2.5) * pt.alpha * (pt.soft > 0 ? Math.min(1, (pt.max - pt.life) / pt.soft) : 1);
      if (pt.additive) {
        this.addMesh.setMatrixAt(na, this._m);
        cb[na * 4] = pt.color.r; cb[na * 4 + 1] = pt.color.g; cb[na * 4 + 2] = pt.color.b; cb[na * 4 + 3] = fade;
        lb[na * 2] = pt.cell; lb[na * 2 + 1] = pt.rot + pt.spin * (pt.max - pt.life);
        na++;
      } else {
        this.mesh.setMatrixAt(n, this._m);
        ca[n * 4] = pt.color.r; ca[n * 4 + 1] = pt.color.g; ca[n * 4 + 2] = pt.color.b; ca[n * 4 + 3] = fade;
        la[n * 2] = pt.cell; la[n * 2 + 1] = pt.rot + pt.spin * (pt.max - pt.life);
        n++;
      }
    }
    // upload only the live particles (nothing at all when none are alive)
    const upload = (mesh: THREE.InstancedMesh, color: THREE.InstancedBufferAttribute, look: THREE.InstancedBufferAttribute, count: number) => {
      const was = mesh.count;
      mesh.count = count;
      if (!count && !was) return;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      color.clearUpdateRanges();
      color.addUpdateRange(0, count * 4);
      color.needsUpdate = true;
      look.clearUpdateRanges();
      look.addUpdateRange(0, count * 2);
      look.needsUpdate = true;
    };
    upload(this.mesh, this.colorAttr, this.lookAttr, n);
    upload(this.addMesh, this.addColorAttr, this.addLookAttr, na);
  }
}
