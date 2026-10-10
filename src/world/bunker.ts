// The bunker as it is built (see src/sim/bunker.ts for what and where): the pad over the
// hole, the hut, the stair, the first level with its passage, rooms and benches, the door a
// keycard opens, the sealed way down, and the lamps. Concrete and steel, made and painted
// here, and solid. Everything is laid out in the bunker's own measure and stood in the world
// by one turn about its middle.

import * as THREE from 'three';
import { physics } from '../core/physics';
import { assets } from '../core/assets';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Atmosphere } from './atmosphere';
import { bunkerPlace, type World } from './worldgen';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUNKER, bunkerAt, bunkerPlan, lampBurns, levelY, type Place } from '../sim/bunker';

function painted(w: number, h: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void, seed: number, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  draw(c.getContext('2d')!, rnd);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** poured concrete: the grey of it, the lines the boards left, damp and rust run down from the fixings */
function concretePaint(seed: number, tone: [number, number, number]) {
  return painted(512, 512, (g, rnd) => {
    g.fillStyle = `rgb(${tone[0]}, ${tone[1]}, ${tone[2]})`;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5200; i++) {
      const k = rnd();
      g.fillStyle = k < 0.5 ? `rgba(0, 0, 0, ${(0.02 + rnd() * 0.06).toFixed(3)})` : `rgba(255, 255, 255, ${(0.015 + rnd() * 0.04).toFixed(3)})`;
      g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 5, 1 + rnd() * 5);
    }
    // the boards of the shuttering, and the tie holes in them
    for (let y = 0; y < 512; y += 128) {
      g.fillStyle = 'rgba(0, 0, 0, 0.16)';
      g.fillRect(0, y, 512, 2);
      for (let x = 64; x < 512; x += 128) {
        g.fillStyle = 'rgba(0, 0, 0, 0.35)';
        g.beginPath();
        g.arc(x, y + 64, 4, 0, Math.PI * 2);
        g.fill();
        const run = g.createLinearGradient(0, y + 64, 0, y + 64 + 50 + rnd() * 60);
        run.addColorStop(0, `rgba(70, 44, 26, ${(0.18 + rnd() * 0.22).toFixed(2)})`);
        run.addColorStop(1, 'rgba(70, 44, 26, 0)');
        g.fillStyle = run;
        g.fillRect(x - 3, y + 64, 6, 120);
      }
    }
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 512, w = 10 + rnd() * 50, y = rnd() * 512, h = 60 + rnd() * 200;
      const damp = g.createLinearGradient(0, y, 0, y + h);
      damp.addColorStop(0, `rgba(20, 26, 22, ${(0.08 + rnd() * 0.16).toFixed(2)})`);
      damp.addColorStop(1, 'rgba(20, 26, 22, 0)');
      g.fillStyle = damp;
      g.fillRect(x, y, w, h);
    }
  }, seed);
}

/** a steel door: plate, rivets round it, a band of warning stripes, and what is stencilled on it */
function doorPaint(lines: string[], seed: number) {
  return painted(512, 512, (g, rnd) => {
    g.fillStyle = '#3d4640';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(0, 0, 0, ${(0.03 + rnd() * 0.08).toFixed(3)})` : `rgba(120, 72, 40, ${(0.03 + rnd() * 0.1).toFixed(3)})`;
      g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 7, 1 + rnd() * 9);
    }
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    for (let k = 0; k < 14; k++) {
      for (const [x, y] of [[20 + k * 36.3, 18], [20 + k * 36.3, 494], [18, 20 + k * 36.3], [494, 20 + k * 36.3]]) {
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // the stripes
    g.save();
    g.beginPath();
    g.rect(36, 356, 440, 60);
    g.clip();
    g.fillStyle = '#c9a227';
    g.fillRect(36, 356, 440, 60);
    g.fillStyle = '#16140f';
    for (let x = -60; x < 520; x += 56) {
      g.beginPath();
      g.moveTo(x, 416);
      g.lineTo(x + 28, 416);
      g.lineTo(x + 88, 356);
      g.lineTo(x + 60, 356);
      g.fill();
    }
    g.restore();
    g.fillStyle = 'rgba(226, 220, 200, 0.9)';
    g.textAlign = 'center';
    lines.forEach((t, k) => {
      g.font = `700 ${k === 0 ? 74 : 40}px "Arial Narrow", Arial, sans-serif`;
      g.fillText(t, 256, 130 + k * 78);
    });
    // worn
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(61, 70, 64, ${(0.3 + rnd() * 0.5).toFixed(2)})`;
      g.fillRect(40 + rnd() * 430, 60 + rnd() * 240, 2 + rnd() * 10, 1 + rnd() * 4);
    }
  }, seed, false);
}

/** painted steel: a colour, scuffed, with rust at its edges */
function steelPaint(seed: number, tone: [number, number, number]) {
  return painted(256, 256, (g, rnd) => {
    g.fillStyle = `rgb(${tone[0]}, ${tone[1]}, ${tone[2]})`;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = rnd() < 0.55 ? `rgba(0, 0, 0, ${(0.03 + rnd() * 0.07).toFixed(3)})` : `rgba(255, 255, 255, ${(0.02 + rnd() * 0.05).toFixed(3)})`;
      g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 9, 1 + rnd() * 2);
    }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${(110 + rnd() * 40) | 0}, ${(60 + rnd() * 24) | 0}, 30, ${(0.12 + rnd() * 0.3).toFixed(2)})`;
      g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 8, 2 + rnd() * 6);
    }
  }, seed);
}

/** what a console's screen shows: lines of green on black, and a trace across it */
function screenPaint() {
  return painted(256, 128, (g, rnd) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#9dffb8';
    for (let y = 10; y < 80; y += 9) g.fillRect(10, y, 30 + rnd() * 150, 3);
    g.strokeStyle = '#9dffb8';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 8; x < 248; x += 6) g.lineTo(x, 104 + Math.sin(x * 0.11) * 9 * rnd());
    g.stroke();
    g.strokeRect(4, 4, 248, 120);
  }, 3, false);
}

/** a plate with a room's name on it, stencilled */
const signs = new Map<string, THREE.CanvasTexture>();
function signPaint(text: string) {
  if (!signs.has(text)) {
    signs.set(text, painted(512, 96, (g, rnd) => {
      g.fillStyle = '#262b27';
      g.fillRect(0, 0, 512, 96);
      g.strokeStyle = 'rgba(226, 220, 200, 0.75)';
      g.lineWidth = 4;
      g.strokeRect(6, 6, 500, 84);
      g.fillStyle = 'rgba(226, 220, 200, 0.92)';
      g.font = '700 58px "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText(text, 256, 68, 470);
      for (let i = 0; i < 120; i++) {
        g.fillStyle = `rgba(38, 43, 39, ${(0.3 + rnd() * 0.5).toFixed(2)})`;
        g.fillRect(rnd() * 512, rnd() * 96, 2 + rnd() * 9, 1 + rnd() * 3);
      }
    }, 7 + text.length, false));
  }
  return signs.get(text)!;
}

/** blood, long dry: a pool with what was thrown off it (even `v`), or what was dragged through one (odd) */
const stains = new Map<number, THREE.CanvasTexture>();
function stainPaint(v: number) {
  if (!stains.has(v)) {
    stains.set(v, painted(256, 256, (g, rnd) => {
      const blot = (x: number, y: number, r: number, a: number) => {
        const gr = g.createRadialGradient(x, y, r * 0.15, x, y, r);
        gr.addColorStop(0, `rgba(40, 7, 5, ${a})`);
        gr.addColorStop(0.72, `rgba(54, 11, 7, ${a * 0.9})`);
        gr.addColorStop(1, 'rgba(54, 11, 7, 0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      };
      if (v % 2 === 0) {
        for (let i = 0; i < 9; i++) blot(128 + (rnd() - 0.5) * 84, 128 + (rnd() - 0.5) * 84, 26 + rnd() * 40, 0.78);
        for (let i = 0; i < 30; i++) {
          const a = rnd() * Math.PI * 2, far = 62 + rnd() * 52;
          blot(128 + Math.cos(a) * far, 128 + Math.sin(a) * far, 1.5 + rnd() * 6.5, 0.72);
        }
      } else {
        g.lineCap = 'round';
        for (let i = 0; i < 18; i++) {
          const x = 78 + rnd() * 100;
          g.strokeStyle = `rgba(50, 10, 7, ${(0.2 + rnd() * 0.45).toFixed(2)})`;
          g.lineWidth = 3 + rnd() * 15;
          g.beginPath();
          g.moveTo(x, 22 + rnd() * 34);
          g.bezierCurveTo(x + (rnd() - 0.5) * 34, 90, x + (rnd() - 0.5) * 34, 168, x + (rnd() - 0.5) * 26, 232 - rnd() * 34);
          g.stroke();
        }
        for (let i = 0; i < 5; i++) blot(90 + rnd() * 76, 40 + rnd() * 176, 8 + rnd() * 14, 0.5);
      }
    }, 900 + v * 17, false));
  }
  return stains.get(v)!;
}

/** words put on a wall with a brush by somebody in a hurry: `|` breaks the line; v 0 is whitewash, 1 red */
const scrawls = new Map<string, THREE.CanvasTexture>();
function scrawlPaint(text: string, v: number) {
  const key = `${v}:${text}`;
  if (!scrawls.has(key)) {
    scrawls.set(key, painted(1024, 256, (g, rnd) => {
      const rows = text.split('|');
      const size = rows.length > 1 ? 104 : 136;
      g.font = `900 ${size}px Impact, "Arial Black", "Arial Narrow", Arial, sans-serif`;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      const ink = v === 1 ? '148, 24, 16' : '212, 206, 188';
      rows.forEach((row, li) => {
        const all = g.measureText(row).width, k = Math.min(1, 950 / all);
        let x = 512 - (all * k) / 2;
        const y = 132 + (li - (rows.length - 1) / 2) * size * 1.04;
        for (const ch of row) {
          const cw = g.measureText(ch).width * k;
          g.save();
          g.translate(x + cw / 2, y + (rnd() - 0.5) * size * 0.1);
          g.rotate((rnd() - 0.5) * 0.13);
          g.scale(k, 1 + (rnd() - 0.5) * 0.14);
          g.fillStyle = `rgba(${ink}, ${(0.7 + rnd() * 0.22).toFixed(2)})`;
          g.fillText(ch, 0, 0);
          g.restore();
          // (paint that ran)
          if (ch !== ' ' && rnd() < 0.3) {
            g.fillStyle = `rgba(${ink}, 0.55)`;
            g.fillRect(x + cw * (0.25 + rnd() * 0.5), y + size * 0.28, 3 + rnd() * 3, 12 + rnd() * 46);
          }
          x += cw;
        }
      });
      // (and what the years have taken off it)
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 1100; i++) {
        g.fillStyle = `rgba(0, 0, 0, ${(0.25 + rnd() * 0.6).toFixed(2)})`;
        g.fillRect(rnd() * 1024, rnd() * 256, 2 + rnd() * 11, 1 + rnd() * 3);
      }
      g.globalCompositeOperation = 'source-over';
    }, 77 + text.length * 13 + v, false));
  }
  return scrawls.get(key)!;
}

/** warning paint on a floor: yellow and black on the slant, scuffed by years of boots */
let hazardTex: THREE.CanvasTexture | null = null;
function hazardPaint() {
  return (hazardTex ??= painted(128, 128, (g, rnd) => {
    g.fillStyle = '#16170f';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#a8842a';
    for (let x = -128; x < 256; x += 64) {
      g.beginPath();
      g.moveTo(x, 128);
      g.lineTo(x + 32, 128);
      g.lineTo(x + 160, 0);
      g.lineTo(x + 128, 0);
      g.fill();
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(70, 72, 68, ${(0.2 + rnd() * 0.5).toFixed(2)})`;
      g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 9, 1 + rnd() * 3);
    }
  }, 4242));
}

/** the cover of a mattress: pale ticking with a blue stripe in it, and what years of use have left on that */
let tickTex: THREE.CanvasTexture | null = null;
function tickPaint() {
  return (tickTex ??= painted(256, 256, (g, rnd) => {
    g.fillStyle = '#8f8a78';
    g.fillRect(0, 0, 256, 256);
    for (let x = 6; x < 256; x += 32) {
      g.fillStyle = 'rgba(52, 62, 84, 0.75)';
      g.fillRect(x, 0, 5, 256);
      g.fillStyle = 'rgba(52, 62, 84, 0.4)';
      g.fillRect(x + 9, 0, 1.5, 256);
    }
    for (let i = 0; i < 14; i++) {
      const x = rnd() * 256, y = rnd() * 256, r = 18 + rnd() * 46;
      const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
      gr.addColorStop(0, `rgba(58, 44, 26, ${(0.2 + rnd() * 0.3).toFixed(2)})`);
      gr.addColorStop(1, 'rgba(58, 44, 26, 0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, 5151));
}

/** a box whose faces carry the picture at one size whatever the box's own: so many metres to one turn of it */
function boxGeo(w: number, h: number, d: number, per = 2.6): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // (three's box: four corners a face, in the order +x, -x, +y, -y, +z, -z)
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, (uv.getX(f * 4 + k) * spans[f][0]) / per, (uv.getY(f * 4 + k) * spans[f][1]) / per);
  return g;
}

/** the light a steady lamp is painted as throwing on the level's plan: how far it reaches (m), and how strong it is */
const LAMP_POOL = 7.5;
const LAMP_GLOW = 1.6;

/**
 * The door model in its doorway, metres (it is drawn at nine tenths of the size it came, to stand under the lintel):
 * half its frame's width; how far forward of the middle of the wall the frame's own middle is; where the hinge is
 * (to the right of the doorway's middle, and forward of the wall's); where the leaf's own middle is from the hinge
 * (right, up from the floor, forward); and how far round it swings (toward the stair).
 */
const GATE = { half: 0.72, frame: 0.1125, hinge: [0.512, 0.2097], leaf: [-0.4698, 0.207, 0.1179], swing: 1.66 };

/**
 * A model's shape as it stands in its own file, in metres. (The models are packed small: their
 * points are whole numbers in a box, and the shape's own place in the file says how big the box
 * is. Moved about as they are, the points stay whole numbers in that box, and the thing comes
 * out the size of a shoebox: so they are written out as plain numbers first.)
 */
function inMetres(mesh: THREE.Mesh): THREE.BufferGeometry {
  const from = mesh.geometry, geo = new THREE.BufferGeometry();
  for (const name of Object.keys(from.attributes)) {
    const a = from.getAttribute(name), out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (from.index) geo.setIndex(Array.from(from.index.array));
  return geo.applyMatrix4(mesh.matrixWorld);
}

/** a place on the ground, to the nearest hand's breadth: what a thing standing there is known by */
export const spotKey = (x: number, z: number) => `${Math.round(x * 10)}_${Math.round(z * 10)}`;

export class BunkerSite {
  /** where it stands: null in a world that has none (and then this does nothing) */
  readonly place: Place | null;
  /** the door at the foot of the stair stands open */
  open = false;
  /** told when it starts to open or to shut (it is loud) */
  onMove: (opening: boolean) => void = () => {};
  private door: { mesh: THREE.Mesh; collider: RAPIER.Collider; slide: number; /** where its middle is when shut, in the bunker's own measure */ at: [number, number, number]; /** the model's leaf, on its hinge (null until it has loaded) */ leaf: THREE.Object3D | null } | null = null;
  /** the door's leaf where it is on its track: what stops a body is where what is seen is */
  private doorSet() {
    const d = this.door, P = this.place;
    if (!d || !P) return;
    // (the leaf swings out on its hinge; the plain slab that stands for it until it has loaded slides, as it did)
    if (d.leaf) d.leaf.rotation.y = d.slide * GATE.swing;
    else d.mesh.position.x = d.slide * (BUNKER.door.half * 2 + 0.15);
    // (what stops a body is the doorway shut: it is there while the door is shut or all but, and not while it moves)
    d.collider.setEnabled(d.slide < 0.12);
  }
  private fixtures: { mat: THREE.MeshStandardMaterial; pos: THREE.Vector3; how: number; burn: number }[] = [];
  /** the light on the card reader beside the door */
  private readerLamp: THREE.MeshStandardMaterial | null = null;
  private clock = 0;
  /** what stops a body, for each thing made here that does: by where it stands (see spotKey) */
  readonly solidAt = new Map<string, RAPIER.Collider>();

  /** @param ground what the ground is drawn with: the bunker's roof is drawn with the same, where it lies under the open sky */
  constructor(world: World, atmo: Atmosphere, scene: THREE.Scene, ground: THREE.Material | null = null) {
    this.place = bunkerPlace(world);
    const P = this.place;
    if (!P) return;
    const B = BUNKER, D = B.depth, Y = levelY();
    const mat = (m: THREE.MeshStandardMaterial) => atmo.register(m) as THREE.MeshStandardMaterial;
    const outside = mat(new THREE.MeshStandardMaterial({ map: concretePaint(17, [128, 126, 116]), roughness: 0.94, metalness: 0 }));
    const inside = mat(new THREE.MeshStandardMaterial({ map: concretePaint(4711, [112, 114, 106]), roughness: 0.9, metalness: 0 }));
    const floor = mat(new THREE.MeshStandardMaterial({ map: concretePaint(909, [86, 88, 84]), roughness: 0.8, metalness: 0 }));
    const steel = mat(new THREE.MeshStandardMaterial({ color: 0x4a504b, roughness: 0.55, metalness: 0.7 }));
    const group = new THREE.Group();
    group.position.set(P.x, P.y, P.z);
    group.rotation.y = P.rot;

    /** a block, from corner to corner in the bunker's own measure: drawn, and solid unless told not to be */
    const block = (r0: number, r1: number, f0: number, f1: number, y0: number, y1: number, m: THREE.Material | THREE.Material[], o: { solid?: boolean; shadow?: boolean; surface?: 'concrete' | 'metal'; /** its picture is painted for it: once across each face, whatever its size */ whole?: boolean } = {}) => {
      const w = Math.abs(r1 - r0), h = Math.abs(y1 - y0), d = Math.abs(f1 - f0);
      const mesh = new THREE.Mesh(o.whole ? new THREE.BoxGeometry(w, h, d) : boxGeo(w, h, d), m);
      mesh.position.set((r0 + r1) / 2, (y0 + y1) / 2, (f0 + f1) / 2);
      mesh.castShadow = o.shadow ?? false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      let collider: RAPIER.Collider | null = null;
      if (o.solid !== false) {
        const [x, y, z] = bunkerAt(P, (r0 + r1) / 2, (f0 + f1) / 2, (y0 + y1) / 2);
        collider = physics.addStatic(physics.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2), o.surface ?? 'concrete', { x, y, z }, P.rot);
      }
      return { mesh, collider };
    };

    // ---- the pad over the hole, open only where the stair comes up inside the hut
    const top = B.pad.top, under = top - 0.45, hole = B.hut.back + 0.5, head = B.stair.foot + B.stair.run + 0.5;
    const up = { shadow: true };
    // (Nothing of it is seen from above but the house: the roof of the place lies level with the ground and is drawn
    // with the ground's own paint, which goes by where a thing is in the world: grass where the hillside is grass,
    // the floor of a wood where it is that. Grass grows on it and trees stand on it: see `surface` in worldgen.)
    const earth = ground ?? outside;
    const roof = [outside, outside, earth, outside, outside, outside];
    block(-B.pad.r, B.pad.r, B.pad.back, hole, under, top, roof, up);
    block(-B.pad.r, -B.stair.half, hole, B.pad.front, under, top, roof, up);
    block(B.stair.half, B.pad.r, hole, B.pad.front, under, top, roof, up);
    block(-B.stair.half, B.stair.half, head, B.pad.front, under, top, roof, up);
    // the floor of the house's one room, round the well the stair comes up in
    for (const [r0, r1, f0, f1] of [[-2.2, -B.stair.half, hole - 0.5, B.hut.front - 0.1], [B.stair.half, 2.9, hole - 0.5, B.hut.front - 0.1], [-B.stair.half, B.stair.half, head, B.hut.front - 0.1]]) block(r0, r1, f0, f1, top, top + 0.02, floor, { solid: false });

    // ---- the house over the head of the stair: a model ("WW2 Field Bunker" by Golden), stood so that the stair comes up
    // inside its one room and its door is ahead of whoever climbs it. It is turned about (its door was at its back),
    // its room's floor is taken out (the pad is the floor, with the stair's well in it), and what stops a body is the
    // model's own walls, triangle for triangle.
    void assets.model('bunker_house').then((scene) => {
      scene.updateMatrixWorld(true);
      const kept = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      const about = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, -B.house.sunk, B.house.f);
      const v = new THREE.Vector3();
      scene.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const from = src.material as THREE.MeshStandardMaterial;
        let geo = inMetres(src);
        geo = geo.index ? geo.toNonIndexed() : geo;
        {
          // (its own floor, the room's and the slab the whole of it stands on: every triangle that lies flat and low.
          // The stair comes up through there.)
          const P = geo.getAttribute('position'), keep: number[] = [];
          for (let t = 0; t < P.count; t += 3) if (!(P.getY(t) < 0.45 && P.getY(t + 1) < 0.45 && P.getY(t + 2) < 0.45)) keep.push(t, t + 1, t + 2);
          const cutGeo = new THREE.BufferGeometry();
          for (const name of Object.keys(geo.attributes)) {
            const a = geo.getAttribute(name), out = new Float32Array(keep.length * a.itemSize);
            keep.forEach((k, n) => { for (let c = 0; c < a.itemSize; c++) out[n * a.itemSize + c] = a.getComponent(k, c); });
            cutGeo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
          }
          geo = cutGeo;
        }
        geo.applyMatrix4(about);
        if (!kept.has(from)) {
          const m = mat(from.clone() as THREE.MeshStandardMaterial);
          m.side = THREE.DoubleSide;
          kept.set(from, m);
        }
        const mesh = new THREE.Mesh(geo, kept.get(from)!);
        mesh.castShadow = !/interior/i.test(from.name);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
        // what stops a body and a bullet: the same triangles, where they stand in the world
        const P = geo.getAttribute('position'), verts = new Float32Array(P.count * 3), tris = new Uint32Array(P.count);
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i);
          const [x, y, z] = bunkerAt(this.place!, v.x, v.z, v.y);
          verts.set([x, y, z], i * 3);
          tris[i] = i;
        }
        physics.addStatic(physics.R.ColliderDesc.trimesh(verts, tris), 'concrete', { x: 0, y: 0, z: 0 });
      });
    }).catch(() => {});

    // ---- the stair: a solid flight from the level's floor up to the pad, between two walls
    const S = B.stair, rise = D + top, steps = 28;
    for (let k = 0; k < steps; k++) {
      const f0 = S.foot + (k / steps) * S.run, f1 = S.foot + ((k + 1) / steps) * S.run;
      block(-S.half, S.half, f0, f1, Y - 0.3, Y + ((k + 1) / steps) * rise, floor, { solid: false });
    }
    {
      // what is walked on: one slope under the treads (a foot does not catch on twenty-eight edges)
      const len = Math.hypot(S.run, rise), tilt = Math.atan2(rise, S.run);
      const mid = bunkerAt(P, 0, S.foot + S.run / 2, Y + rise / 2 - 0.16 / Math.cos(tilt));
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.rot).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -tilt));
      physics.addStaticQuat(physics.R.ColliderDesc.cuboid(S.half, 0.16, len / 2 + 0.2), 'concrete', { x: mid[0], y: mid[1], z: mid[2] }, q);
    }
    block(-S.half - 0.3, -S.half, B.hall.front, head, Y - 0.3, under, inside);
    block(S.half, S.half + 0.3, B.hall.front, head, Y - 0.3, under, inside);
    block(-S.half - 0.3, S.half + 0.3, head, head + 0.3, Y - 0.3, under, inside);
    // the landing at its foot
    block(-S.half - 0.3, S.half + 0.3, B.hall.front, S.foot, Y - 0.3, Y, floor);

    // ---- the first level: floor, ceiling, and its walls as they are laid out (see bunkerPlan)
    const L = B.hall, T = Y + B.tall, plan = bunkerPlan();
    block(-L.r - 0.5, L.r + 0.5, L.back - 0.5, L.front, Y - 0.3, Y, floor);
    block(-L.r - 0.5, L.r + 0.5, L.back - 0.5, L.front, T, T + 0.3, inside);
    for (const w of plan.walls) block(w.r0, w.r1, w.f0, w.f1, Y + (w.y0 ?? 0), T, inside);
    // a dado round the passages: the lower third of the walls painted, as such places are
    const Dr = B.door;

    // ---- what was made for it. Each is built about its own middle, facing forward, and stood where the plan says.
    const olive = mat(new THREE.MeshStandardMaterial({ map: steelPaint(11, [70, 82, 62]), roughness: 0.6, metalness: 0.45 }));
    const grey = mat(new THREE.MeshStandardMaterial({ map: steelPaint(29, [96, 100, 98]), roughness: 0.5, metalness: 0.6 }));
    const dark = mat(new THREE.MeshStandardMaterial({ color: 0x191a18, roughness: 0.7, metalness: 0.4 }));
    const cloth = mat(new THREE.MeshStandardMaterial({ color: 0x4d4a3a, roughness: 0.97 }));
    const hazard = mat(new THREE.MeshStandardMaterial({ color: 0xb8922a, roughness: 0.6, metalness: 0.3 }));
    const ticking = mat(new THREE.MeshStandardMaterial({ map: tickPaint(), roughness: 0.96, metalness: 0 }));
    const linePaint = mat(new THREE.MeshStandardMaterial({ color: 0x9c7c24, roughness: 0.8, metalness: 0 }));
    const warnPaint = mat(new THREE.MeshStandardMaterial({ map: hazardPaint(), roughness: 0.8, metalness: 0 }));
    // (paint and blood lie ON the floor and the walls: seen through where there is none, and never in front of what stands on them)
    const laid = new Map<string, THREE.MeshStandardMaterial>();
    const onIt = (key: string, map: THREE.Texture, rough: number) => {
      if (!laid.has(key)) laid.set(key, mat(new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: rough, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
      return laid.get(key)!;
    };
    const screen = new THREE.MeshStandardMaterial({ color: 0x0b120c, emissive: new THREE.Color(0.25, 1, 0.45), emissiveMap: screenPaint(), emissiveIntensity: 1.6, roughness: 0.3 });
    atmo.register(screen);
    /** shapes waiting to be drawn, by what they are made of: all of one stuff is one thing to draw */
    const heap = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
    for (const m of plan.made) {
      const base = new THREE.Matrix4().compose(new THREE.Vector3(m.r, Y + (m.y ?? 0), m.f), Q.setFromAxisAngle(UP, m.rot), ONE);
      /** a piece of it: a shape, set down in the thing's own measure (x across, y up from its foot, z to its front) */
      const part = (geo: THREE.BufferGeometry, stuff: THREE.Material, x: number, y: number, z: number, turn?: THREE.Euler) => {
        M.compose(new THREE.Vector3(x, y, z), turn ? new THREE.Quaternion().setFromEuler(turn) : new THREE.Quaternion(), ONE);
        geo.applyMatrix4(M).applyMatrix4(base);
        (heap.get(stuff) ?? heap.set(stuff, []).get(stuff)!).push(geo);
      };
      const slab = (stuff: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => part(boxGeo(w, h, d, 1.4), stuff, x, y + h / 2, z);
      /** it stops a body and a bullet: a box of its own size (or the size given), where it stands */
      const solid = (surface: 'concrete' | 'metal', w = m.w, h = m.h, d = m.d, lift = 0) => {
        const [x, y, z] = bunkerAt(P, m.r, m.f, Y + (m.y ?? 0) + lift + h / 2);
        const c = physics.addStatic(physics.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2), surface, { x, y, z }, P.rot + m.rot);
        // (the first of its boxes is the thing itself, for whoever looks at it and means to open it)
        const key = spotKey(x, z);
        if (!this.solidAt.has(key)) this.solidAt.set(key, c);
      };
      const { w, d, h } = m;
      switch (m.kind) {
        case 'locker': {
          slab(olive, w - 0.02, h, d, 0, 0, 0);
          // the door's edge, its vents and its handle
          slab(dark, 0.012, h - 0.12, 0.012, w / 2 - 0.05, 0.06, d / 2 + 0.004);
          for (const y of [h - 0.22, h - 0.3, h - 0.38]) slab(dark, w * 0.5, 0.02, 0.01, -0.04, y, d / 2 + 0.004);
          slab(grey, 0.03, 0.12, 0.03, w / 2 - 0.12, h * 0.52, d / 2 + 0.012);
          solid('metal');
          break;
        }
        case 'generator': {
          slab(dark, w, 0.18, d, 0, 0, 0);
          slab(olive, w * 0.62, h - 0.4, d * 0.86, -w * 0.17, 0.18, 0);
          slab(grey, w * 0.3, h - 0.62, d * 0.7, w * 0.32, 0.18, 0);
          slab(hazard, w * 0.62 + 0.01, 0.08, d * 0.86 + 0.01, -w * 0.17, h - 0.45, 0);
          // the exhaust, up to the ceiling; a filler cap; the panel it is worked from
          part(new THREE.CylinderGeometry(0.09, 0.09, B.tall - h + 0.25, 10), dark, -w * 0.38, h - 0.22 + (B.tall - h + 0.25) / 2, -d * 0.2);
          part(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), grey, -w * 0.05, h - 0.18, d * 0.2);
          slab(dark, w * 0.24, 0.3, 0.03, w * 0.32, h - 0.82, d * 0.35 + 0.012);
          part(new THREE.PlaneGeometry(w * 0.2, 0.22), screen, w * 0.32, h - 0.67, d * 0.35 + 0.03);
          solid('metal', w, h - 0.2, d);
          break;
        }
        case 'tank': {
          part(new THREE.CylinderGeometry(w / 2, w / 2, h - 0.25, 20), grey, 0, 0.2 + (h - 0.25) / 2, 0);
          part(new THREE.SphereGeometry(w / 2, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), grey, 0, h - 0.05, 0);
          for (const y of [0.55, h - 0.5]) part(new THREE.CylinderGeometry(w / 2 + 0.012, w / 2 + 0.012, 0.06, 20), dark, 0, y, 0);
          for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) slab(dark, 0.08, 0.22, 0.08, x * w * 0.3, 0, z * w * 0.3);
          // a pipe off the top of it into the wall behind
          part(new THREE.CylinderGeometry(0.045, 0.045, w * 0.7, 8), dark, 0, h - 0.3, -w * 0.45, new THREE.Euler(Math.PI / 2, 0, 0));
          const [x, y, z] = bunkerAt(P, m.r, m.f, Y + h / 2);
          physics.addStatic(physics.R.ColliderDesc.cylinder(h / 2, w / 2), 'metal', { x, y, z });
          break;
        }
        case 'console': {
          slab(grey, w, h * 0.62, d, 0, 0, 0);
          // a sloped desk of switches, and the screens over it
          part(boxGeo(w, 0.06, d * 0.6, 1.4), dark, 0, h * 0.62 + 0.09, d * 0.16, new THREE.Euler(0.38, 0, 0));
          slab(dark, w, h * 0.38, d * 0.3, 0, h * 0.62, -d * 0.35);
          for (const x of [-w * 0.27, w * 0.27]) part(new THREE.PlaneGeometry(w * 0.42, h * 0.28), screen, x, h * 0.81, -d * 0.2 + 0.006);
          solid('metal');
          break;
        }
        case 'rack': {
          // two ends, a back, and two rails the long guns lean in
          for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) slab(grey, 0.06, h, d, x, 0, 0);
          slab(olive, w, h, 0.03, 0, 0, -d / 2 + 0.015);
          for (const y of [0.35, 1.25]) slab(grey, w - 0.1, 0.04, 0.05, 0, y, d / 2 - 0.05);
          slab(grey, w, 0.06, d, 0, 0, 0);
          solid('metal');
          break;
        }
        case 'bench': {
          slab(grey, w, 0.05, d, 0, h - 0.05, 0);
          slab(grey, w - 0.1, 0.03, d - 0.1, 0, 0.28, 0);
          for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) slab(grey, 0.05, h - 0.05, 0.05, x * (w / 2 - 0.05), 0, z * (d / 2 - 0.05));
          solid('metal', w, 0.08, d, h - 0.08);
          break;
        }
        case 'pillar': {
          slab(outside, w, h, d, 0, 0, 0);
          slab(hazard, w + 0.01, 0.9, d + 0.01, 0, 0.05, 0);
          solid('concrete');
          break;
        }
        case 'bunk': {
          // (it lies across: its head and foot to either side, a bed below and a bed above)
          for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) slab(grey, 0.05, h, 0.05, x * (w / 2 - 0.03), 0, z * (d / 2 - 0.03));
          for (const y of [0.42, 1.32]) {
            slab(grey, w, 0.04, d, 0, y, 0);
            slab(cloth, w - 0.1, 0.12, d - 0.08, 0, y + 0.04, 0);
            slab(inside, 0.42, 0.1, d - 0.2, -w / 2 + 0.3, y + 0.16, 0);
          }
          for (const y of [0.55, 0.85, 1.15]) slab(grey, 0.03, 0.03, 0.4, w / 2 - 0.02, y, d / 2 - 0.25);
          solid('metal', w, h, d);
          break;
        }
        case 'pipe': {
          part(new THREE.CylinderGeometry(w / 2, w / 2, d, 10), m.w > 0.12 ? olive : grey, 0, 0, 0, new THREE.Euler(Math.PI / 2, 0, 0));
          for (let z = -d / 2 + 1.5; z < d / 2; z += 3.2) slab(dark, w + 0.06, 0.05 + w, 0.05, 0, -w / 2, z);
          break;
        }
        case 'duct': {
          slab(grey, w, h, d, 0, 0, 0);
          for (let z = -d / 2 + 1; z < d / 2; z += 2.4) slab(dark, w + 0.02, h + 0.02, 0.04, 0, -0.01, z);
          break;
        }
        case 'mattress': {
          slab(ticking, w, h, d, 0, 0, 0);
          break;
        }
        case 'stripe': {
          // a line of paint, or (text: 'hazard') a patch of warning paint, a carpet's thickness over the floor
          if (m.text === 'hazard') {
            const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
            const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
            for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 0.9), uv.getY(i) * (d / 0.9));
            part(geo, warnPaint, 0, 0.004, 0);
          } else slab(linePaint, w, h, d, 0, 0.001, 0);
          break;
        }
        case 'stain': {
          part(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), onIt(`stain${m.v ?? 0}`, stainPaint(m.v ?? 0), 0.45), 0, 0.009, 0);
          break;
        }
        case 'scrawl': {
          part(new THREE.PlaneGeometry(w, h), onIt(`scrawl${m.v ?? 0}:${m.text ?? ''}`, scrawlPaint(m.text ?? '', m.v ?? 0), 0.9), 0, h / 2, 0.006);
          break;
        }
        case 'grate': {
          slab(dark, w, h, d, 0, 0.002, 0);
          for (let x = -w / 2 + 0.1; x < w / 2; x += 0.2) slab(grey, 0.03, h + 0.006, d - 0.06, x, 0.002, 0);
          break;
        }
        case 'cell': {
          // bars across its front (with a gap for the gate, which stands open) and down its open side
          for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.14) if (Math.abs(x) > 0.42) part(new THREE.CylinderGeometry(0.018, 0.018, h, 6), dark, x, h / 2, d / 2);
          for (const y of [0.1, h - 0.1, 1.2]) slab(dark, w, 0.04, 0.04, 0, y, d / 2);
          for (let z = -d / 2; z <= d / 2; z += 0.14) part(new THREE.CylinderGeometry(0.018, 0.018, h, 6), dark, w / 2, h / 2, z);
          slab(grey, 0.75, 0.05, 1.9, -w / 2 + 0.45, 0.4, -d / 2 + 1.0);
          slab(cloth, 0.7, 0.08, 1.8, -w / 2 + 0.45, 0.45, -d / 2 + 1.0);
          const side = (x0: number, x1: number, z0: number, z1: number) => {
            const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, c = Math.cos(m.rot), sn = Math.sin(m.rot);
            const [x, y, z] = bunkerAt(P, m.r + cx * c + cz * sn, m.f - cx * sn + cz * c, Y + h / 2);
            physics.addStatic(physics.R.ColliderDesc.cuboid(Math.abs(x1 - x0) / 2 + 0.02, h / 2, Math.abs(z1 - z0) / 2 + 0.02), 'metal', { x, y, z }, P.rot + m.rot);
          };
          side(-w / 2, -0.42, d / 2, d / 2);
          side(0.42, w / 2, d / 2, d / 2);
          side(w / 2, w / 2, -d / 2, d / 2);
          break;
        }
        case 'sign': {
          const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(new THREE.MeshStandardMaterial({ map: signPaint(m.text ?? ''), roughness: 0.75, metalness: 0.2 })));
          plate.applyMatrix4(new THREE.Matrix4().makeTranslation(0, h / 2, 0.012));
          plate.applyMatrix4(base);
          plate.matrixAutoUpdate = false;
          plate.updateMatrix();
          group.add(plate);
          break;
        }
      }
    }
    for (const [stuff, geos] of heap) {
      const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false), stuff);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }

    // ---- the door a keycard opens: steel, on a track, sliding aside into the wall
    {
      const face = mat(new THREE.MeshStandardMaterial({ map: doorPaint(['LEVEL 1', 'KEYCARD HOLDERS ONLY'], 31), roughness: 0.6, metalness: 0.55 }));
      const d = block(-Dr.half - 0.05, Dr.half + 0.05, L.front - 0.3, L.front - 0.08, Y, Y + Dr.tall + 0.05, [steel, steel, steel, steel, face, face], { surface: 'metal', whole: true });
      d.mesh.matrixAutoUpdate = true;
      this.door = { mesh: d.mesh, collider: d.collider!, slide: 0, at: [0, L.front - 0.19, Y + (Dr.tall + 0.05) / 2], leaf: null };
      // The door itself is a model ("Old metal bunker door" by rakutin), taken apart into its frame and its leaf
      // (scripts/split-door.mjs): the frame is set in the wall, which is filled in round it, and the leaf hangs on
      // its hinge and swings out over the landing. Until they have come there is the plain slab; once they have,
      // the slab is not drawn (it is still what stops a body while the door is shut).
      // (exactly the gap the wall leaves, side to side and up to its lintel: laid over the wall's own ends by a finger's
      // width, the two were drawn turn and turn about and the wall flickered beside the door)
      block(-Dr.half, -GATE.half, L.front - 0.3, L.front, Y, Y + Dr.tall, inside);
      block(GATE.half, Dr.half, L.front - 0.3, L.front, Y, Y + Dr.tall, inside);
      void Promise.all([assets.model('bunker_gate_frame'), assets.model('bunker_gate_leaf')]).then(([frame, leaf]) => {
        const stuff = new Map<THREE.Material, THREE.MeshStandardMaterial>();
        const take = (scene: THREE.Object3D, into: THREE.Object3D, x: number, y: number, z: number) => {
          scene.updateMatrixWorld(true);
          scene.traverse((o) => {
            const src = o as THREE.Mesh;
            if (!src.isMesh) return;
            const from = src.material as THREE.MeshStandardMaterial;
            if (!stuff.has(from)) stuff.set(from, mat(from.clone() as THREE.MeshStandardMaterial));
            const mesh = new THREE.Mesh(inMetres(src), stuff.get(from)!);
            mesh.position.set(x, y, z);
            mesh.receiveShadow = true;
            into.add(mesh);
          });
        };
        take(frame, group, 0, Y, L.front - 0.15 + GATE.frame);
        const pivot = new THREE.Group();
        pivot.position.set(GATE.hinge[0], Y, L.front - 0.15 + GATE.hinge[1]);
        take(leaf, pivot, GATE.leaf[0], GATE.leaf[1], GATE.leaf[2]);
        group.add(pivot);
        d.mesh.visible = false;
        if (this.door) this.door.leaf = pivot;
        this.doorSet();
      }).catch(() => {});
      // the reader: a small box on the wall of the stair, at the right hand of whoever comes down to the door, and the light on it (red: shut; green: open)
      block(S.half - 0.07, S.half, L.front + 0.28, L.front + 0.56, Y + 1.08, Y + 1.44, steel, { solid: false });
      this.readerLamp = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1, 0.1, 0.05), emissiveIntensity: 2.2 });
      block(S.half - 0.08, S.half - 0.07, L.front + 0.38, L.front + 0.46, Y + 1.34, Y + 1.39, atmo.register(this.readerLamp), { solid: false });
      // the slot the card goes into
      block(S.half - 0.078, S.half - 0.07, L.front + 0.35, L.front + 0.49, Y + 1.2, Y + 1.216, dark, { solid: false });
      // The wall the door is in goes on up to the ceiling of the stair's shaft: the level's own wall stops at the
      // level's ceiling, and over it there was a window on to the sky and the top of the bunker's roof.
      // (from the top of the level's ceiling slab, not through it: the same flicker)
      block(-S.half - 0.3, S.half + 0.3, L.front - 0.4, L.front, T + 0.3, under, inside);
    }
    // ---- and the way down to the levels below, at the far end of the passage: shut, for now
    {
      const sealed = mat(new THREE.MeshStandardMaterial({ map: doorPaint(['LEVEL 2', 'LEVEL 2 KEYCARD REQUIRED', 'COMING SOON'], 73), roughness: 0.6, metalness: 0.55 }));
      block(-Dr.half, Dr.half, L.back - 0.32, L.back - 0.1, Y, Y + Dr.tall, [steel, steel, steel, steel, sealed, sealed], { surface: 'metal', whole: true });
      // its reader, on the passage's wall beside it: red, and it stays red
      block(Dr.half + 0.18, Dr.half + 0.46, L.back, L.back + 0.07, Y + 1.08, Y + 1.44, steel, { solid: false });
      block(Dr.half + 0.28, Dr.half + 0.36, L.back + 0.07, L.back + 0.08, Y + 1.34, Y + 1.39, atmo.register(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1, 0.1, 0.05), emissiveIntensity: 2.2 })), { solid: false });
    }

    // ---- the lamps: a caged fitting on the ceiling for each, lit as it burns (the ones that burn steadily share one glow)
    const fittings: { at: [number, number, number]; glow: THREE.Material; made: THREE.Mesh[] }[] = [];
    const steady = new THREE.MeshStandardMaterial({ color: 0x2a2a26, emissive: new THREE.Color(1, 0.86, 0.6), emissiveIntensity: 3.2, roughness: 0.5 });
    atmo.register(steady);
    plan.lamps.forEach(([r, f, y, how]) => {
      const m = how >= 1 ? steady : (atmo.register(new THREE.MeshStandardMaterial({ color: 0x2a2a26, emissive: new THREE.Color(1, 0.86, 0.6), emissiveIntensity: 0, roughness: 0.5 })) as THREE.MeshStandardMaterial);
      const made = [block(r - 0.3, r + 0.3, f - 0.08, f + 0.08, y + 0.13, y + 0.2, m, { solid: false }).mesh, block(r - 0.36, r + 0.36, f - 0.12, f + 0.12, y + 0.2, y + 0.25, dark, { solid: false }).mesh];
      const [x, wy, z] = bunkerAt(P, r, f, y);
      this.fixtures.push({ mat: m, pos: new THREE.Vector3(x, wy, z), how, burn: 0 });
      fittings.push({ at: [r, y + 0.25, f], glow: m, made });
    });
    // The fittings themselves are a model (a caged lamp out of the bunker pack), hung from the
    // ceiling upside down as it was made to stand; the boxes above are what is there until it has
    // come, and if it never does. Its glass is each lamp's own glow; the rest of it is one stuff.
    void assets.model('bunker_light').then((scene) => {
      const parts: { geo: THREE.BufferGeometry; glass: boolean; stuff: THREE.Material }[] = [];
      const kept = new Map<THREE.Material, THREE.Material>();
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial, glass = /glow/i.test(src.name);
        if (!glass && !kept.has(src)) kept.set(src, mat(src.clone() as THREE.MeshStandardMaterial));
        parts.push({ geo: inMetres(mesh), glass, stuff: kept.get(src) ?? src });
      });
      if (!parts.length) return;
      for (const ft of fittings) {
        for (const old of ft.made) group.remove(old);
        for (const p of parts) {
          const mesh = new THREE.Mesh(p.geo, p.glass ? ft.glow : p.stuff);
          mesh.position.set(ft.at[0], ft.at[1], ft.at[2]);
          mesh.rotation.x = Math.PI;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          group.add(mesh);
        }
      }
    }).catch(() => {});

    // ---- the light the steady lamps throw, painted once on a plan of the level and laid over all that is built down here.
    // Only the few lamps nearest the eye are real lights (see Lamps): without this a lamp at the far end of a passage would
    // be a bright point lighting nothing. Each lights the room or the passage it hangs in, and not the next through the wall.
    {
      const N = 512, R0 = -L.r - 3, span = 2 * L.r + 6, F0 = L.back - 1.5;
      const px = (r: number) => ((r - R0) / span) * N, py = (f: number) => (1 - (f - F0) / span) * N;
      const glow = painted(N, N, (g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, N, N);
        g.globalCompositeOperation = 'lighter';
        for (const [r, f, , how] of plan.lamps) {
          if (how < 1) continue;
          const q = plan.rooms.find((q) => r > q.r0 && r < q.r1 && f > q.f0 && f < q.f1);
          const [r0, r1, f0, f1] = q ? [q.r0, q.r1, q.f0, q.f1] : f > L.front ? [-S.half, S.half, L.front - 0.3, head] : Math.abs(r) > B.passage ? [-L.r, L.r, plan.cross - B.across, plan.cross + B.across] : [-B.passage, B.passage, L.back, L.front];
          g.save();
          g.beginPath();
          g.rect(px(r0), py(f1), px(r1) - px(r0), py(f0) - py(f1));
          g.clip();
          const grad = g.createRadialGradient(px(r), py(f), 0, px(r), py(f), (LAMP_POOL / span) * N);
          grad.addColorStop(0, 'rgb(255, 222, 164)');
          grad.addColorStop(0.22, 'rgb(170, 140, 96)');
          grad.addColorStop(0.55, 'rgb(74, 60, 40)');
          grad.addColorStop(1, 'rgb(0, 0, 0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, N, N);
          g.restore();
        }
      }, 1, false);
      glow.channel = 1;
      const v = new THREE.Vector3(), stuffs = new Set<THREE.Material>();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.updateMatrix();
        const geo = mesh.geometry, pos = geo.getAttribute('position'), uv1 = new Float32Array(pos.count * 2);
        // (what stands above the ground is lit by the sky, not by these: it is all laid on a corner of the plan where nothing burns)
        let high = -Infinity;
        for (let i = 0; i < pos.count; i++) high = Math.max(high, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix).y);
        if (high <= under + 0.01) {
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
            uv1[i * 2] = (v.x - R0) / span;
            uv1[i * 2 + 1] = (v.z - F0) / span;
          }
        }
        geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) stuffs.add(m);
      });
      for (const m of stuffs) {
        const s = m as THREE.MeshStandardMaterial;
        // (not the ground's own paint: that is every hill's, and no lamp of the bunker's shines on those)
        if (!s.isMeshStandardMaterial || m === ground) continue;
        s.lightMap = glow;
        s.lightMapIntensity = LAMP_GLOW;
      }
    }
    scene.add(group);
  }

  /** The door: open, or shut. @param quiet it is found so (on joining), not seen and heard to move */
  setOpen(open: boolean, quiet = false) {
    if (open === this.open) return;
    this.open = open;
    if (this.readerLamp) this.readerLamp.emissive.setRGB(open ? 0.1 : 1, open ? 1 : 0.1, 0.05);
    const d = this.door;
    if (quiet && d) {
      d.slide = open ? 1 : 0;
      this.doorSet();
    } else if (this.place) this.onMove(open);
  }

  /** Where the middle of the way down to the second level is, in the world (it is shut, and says why to whoever looks at it). */
  sealedAt(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.place) return null;
    const [x, y, z] = bunkerAt(this.place, 0, BUNKER.hall.back, levelY() + 1.2);
    return out.set(x, y, z);
  }

  /** Where the middle of the door is, in the world: what a keycard is held up to. */
  doorAt(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.place) return null;
    const [x, y, z] = bunkerAt(this.place, 0, BUNKER.hall.front, levelY() + 1.2);
    return out.set(x, y, z);
  }

  /**
   * Each frame: the door slides, and the lamps burn or do not.
   * @param lit told of each lamp that is alight now, and how brightly (0..1)
   */
  update(dt: number, eye: THREE.Vector3, lit: (pos: THREE.Vector3, burn: number) => void) {
    const P = this.place;
    if (!P) return;
    this.clock += dt;
    const d = this.door;
    if (d) {
      const want = this.open ? 1 : 0;
      if (d.slide !== want) {
        // (a heavy door: three seconds from one end of its track to the other)
        d.slide = Math.min(1, Math.max(0, d.slide + (want ? dt : -dt) / 3));
        this.doorSet();
      }
    }
    // (the lamps are not looked at from across the map)
    if (Math.hypot(eye.x - P.x, eye.z - P.z) > 90) return;
    this.fixtures.forEach((x, k) => {
      // (a dead one is a fitting on the ceiling and no more)
      if (x.how <= 0) return;
      x.burn = lampBurns(x.how, k, this.clock);
      x.mat.emissiveIntensity = x.burn * 3.2;
      // (said whether it burns this instant or not: which lamps are given the real lights must not change with every flicker)
      lit(x.pos, x.burn > 0.2 ? x.burn : 0);
    });
  }
}
