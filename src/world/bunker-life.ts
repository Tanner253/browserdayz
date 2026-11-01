// What moves down the bunker with nobody there (the owner, 2026-11-01: "add more life to the rooms and environment"): flies over what was left, water coming through the roof, sparks from what
// still has current in it, steam off the pipes. Only the nearest few of each are alive at a time, and each is a sum of the clock and its own number, so there is nothing to keep and no pool
// to fill: three sets of dots, written each frame the eye is down there.

import * as THREE from 'three';
import { audio } from '../core/audio';
import { bunkerAt, type Place } from '../sim/bunker';
import type { Life } from './bunker-dress';

const fract = (v: number) => v - Math.floor(v);
const rnd = (a: number, b: number) => fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);

/** how many of each are alive at once, and how many dots each is */
const SWARMS = 6, FLIES = 7, RAINS = 6, DROPS = 3, ARCS = 3, SPARKS = 14, VENTS = 4, PUFFS = 8;
/** how far off they are alive, metres; how often that is looked at again, seconds; and how far a body is heard */
const NEAR = 24, LOOK = 0.4, BUZZ = 5, HEARD = 14;
const GRAVITY = 9.8;

interface Source { r: number; f: number; y: number; top: number; k: number; heard: number }

class Dots {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private n = 0;
  constructor(private max: number, m: THREE.PointsMaterial, parent: THREE.Object3D) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.visible = false;
    parent.add(this.points);
  }
  put(x: number, y: number, z: number, r: number, g: number, b: number, a: number) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.col.set([r, g, b, a], i * 4);
  }
  done() {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
    this.points.visible = this.n > 0;
    this.n = 0;
  }
}

/** a soft round puff, for the steam */
function puff() {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d')!, r = g.createRadialGradient(24, 24, 2, 24, 24, 24);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 48, 48);
  return new THREE.CanvasTexture(c);
}

export class BunkerLife {
  private all = new Map<number, { flies: Source[]; drips: Source[]; arcs: Source[]; vents: Source[] }>();
  private on = { flies: [] as Source[], drips: [] as Source[], arcs: [] as Source[], vents: [] as Source[] };
  private specks: Dots;
  private sparks: Dots;
  private steam: Dots;
  private clock = 0;
  private wait = 0;
  private buzzing = false;

  constructor(private P: Place, group: THREE.Object3D) {
    this.specks = new Dots(SWARMS * FLIES + RAINS * DROPS, new THREE.PointsMaterial({ size: 0.016, vertexColors: true, transparent: true, depthWrite: false }), group);
    this.sparks = new Dots(ARCS * SPARKS, new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), group);
    this.steam = new Dots(VENTS * PUFFS, new THREE.PointsMaterial({ size: 0.9, map: puff(), vertexColors: true, transparent: true, depthWrite: false }), group);
  }

  /** what a level holds. @param Y its floor, in the bunker's own measure */
  add(level: number, Y: number, life: Life) {
    const to = this.all.get(level) ?? this.all.set(level, { flies: [], drips: [], arcs: [], vents: [] }).get(level)!;
    let k = to.flies.length + to.drips.length + to.arcs.length + to.vents.length;
    const of = (r: number, f: number, y: number, top = y): Source => ({ r, f, y: Y + y, top: Y + top, k: k++, heard: -1 });
    for (const [r, f, y] of life.flies) to.flies.push(of(r, f, y));
    for (const [r, f, y, top] of life.drips) to.drips.push(of(r, f, y, top));
    for (const [r, f, y] of life.sparks) to.arcs.push(of(r, f, y));
    for (const [r, f, y] of life.steam) to.vents.push(of(r, f, y));
  }

  /** the eye has left: nothing is written while it is gone, and nothing goes on buzzing */
  away() {
    if (!this.buzzing) return;
    this.buzzing = false;
    audio.flies(0);
    for (const d of [this.specks, this.sparks, this.steam]) d.points.visible = false;
  }

  private nearest(list: Source[] | undefined, r: number, f: number, h: number, most: number) {
    if (!list) return [];
    const by = (s: Source) => Math.hypot(s.r - r, s.f - f);
    return list.filter((s) => by(s) < NEAR && Math.abs(s.y - h) < 5).sort((a, b) => by(a) - by(b)).slice(0, most);
  }
  private heard(s: Source, h: number, r: number, f: number) {
    return Math.hypot(s.r - r, s.f - f, s.y - h) < HEARD;
  }
  private at(s: Source, y: number) {
    const [x, wy, z] = bunkerAt(this.P, s.r, s.f, y);
    return { x, y: wy, z };
  }

  /**
   * Once a frame, with the eye about the bunker.
   * @param here where it is, in the bunker's own measure @param level the level it is on @param power whether Level 2's plant is running
   */
  update(dt: number, here: [number, number, number], level: number, power: boolean) {
    const [r, f, h] = here, live = level === 1 || power;
    this.clock += dt;
    const t = this.clock;
    if ((this.wait -= dt) <= 0) {
      this.wait = LOOK;
      const L = this.all.get(level), on = this.on;
      on.flies = this.nearest(L?.flies, r, f, h, SWARMS);
      on.drips = this.nearest(L?.drips, r, f, h, RAINS);
      on.arcs = live ? this.nearest(L?.arcs, r, f, h, ARCS) : [];
      on.vents = live ? this.nearest(L?.vents, r, f, h, VENTS) : [];
      const fly = on.flies[0], d = fly ? Math.hypot(fly.r - r, fly.f - f, fly.y - h) : Infinity, near = Math.max(0, 1 - d / BUZZ);
      if (near > 0 || this.buzzing) audio.flies(near);
      this.buzzing = near > 0 || on.flies.length + on.drips.length + on.arcs.length + on.vents.length > 0;
    }
    for (const s of this.on.flies) for (let j = 0; j < FLIES; j++) {
      const a = t * (2.2 + rnd(s.k, j) * 2.4) + rnd(j, s.k) * 6.28, rad = 0.22 + rnd(j, 3) * 0.4 + 0.1 * Math.sin(t * 3.1 + j);
      this.specks.put(s.r + Math.cos(a) * rad + 0.07 * Math.sin(t * 9 + j), s.y + 0.28 * Math.sin(t * 1.7 + j * 2) + 0.15 * Math.sin(t * 5 + j), s.f + Math.sin(a * 1.13) * rad, 0.02, 0.02, 0.02, 0.95);
    }
    for (const s of this.on.drips) {
      const every = 2.6 + rnd(s.k, 1) * 4.4, at = t / every + rnd(s.k, 2), turn = Math.floor(at), age = (at - turn) * every, fall = Math.sqrt((2 * (s.top - s.y)) / GRAVITY);
      if (age < fall) this.specks.put(s.r, s.top - (GRAVITY / 2) * age * age, s.f, 0.62, 0.68, 0.72, 0.8);
      else {
        if (s.heard !== turn) {
          s.heard = turn;
          if (this.heard(s, h, r, f)) audio.drip(this.at(s, s.y));
        }
        // (what is thrown up off the floor)
        const off = age - fall;
        if (off < 0.26) for (let j = 0; j < DROPS; j++) {
          const a = rnd(j, turn) * 6.28, out = (0.3 + rnd(turn, j) * 0.3) * off;
          this.specks.put(s.r + Math.cos(a) * out, s.y + 0.01 + 1.1 * off - (GRAVITY / 2) * off * off, s.f + Math.sin(a) * out, 0.62, 0.68, 0.72, 0.6);
        }
      }
    }
    for (const s of this.on.arcs) {
      const every = 7 + rnd(s.k, 3) * 12, at = t / every + rnd(s.k, 4), turn = Math.floor(at), age = (at - turn) * every;
      if (age > 1) continue;
      if (s.heard !== turn) {
        s.heard = turn;
        if (this.heard(s, h, r, f)) audio.spark(this.at(s, s.y));
      }
      for (let j = 0; j < SPARKS; j++) {
        const life = 0.45 + rnd(j, turn) * 0.5;
        if (age > life) continue;
        const left = 1 - age / life, vx = (rnd(turn, j) - 0.5) * 1.5, vz = (rnd(j + 7, turn) - 0.5) * 1.5, vy = 0.2 + rnd(turn + 3, j) * 0.9;
        this.sparks.put(s.r + vx * age, Math.max(s.y - 1.3, s.y + vy * age - (GRAVITY / 2) * age * age), s.f + vz * age, 1.8 * left, 1.1 * left * left, 0.35 * left * left, 1);
      }
    }
    for (const s of this.on.vents) for (let j = 0; j < PUFFS; j++) {
      const age = fract(t * 0.3 + j / PUFFS + rnd(s.k, j)), a = j * 2.3 + t * 0.4;
      this.steam.put(s.r + 0.3 * age * Math.sin(a), s.y + age * 1.1, s.f + 0.3 * age * Math.cos(a), 0.78, 0.78, 0.76, 0.1 * Math.sin(age * Math.PI));
    }
    this.specks.done();
    this.sparks.done();
    this.steam.done();
  }
}
