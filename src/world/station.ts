// A station of the line (src/sim/train-line.ts for where): a concrete hall dug round the end of the track, a platform level with the wagon's sides, a row of pillars to stand
// behind, a fence along the edge with a gate that runs back when the train stands and shuts before it goes. It is solid, unlike the tunnel, and drawn only with the eye in
// it or on the line. All of it is said in the station's own measure, and its own pieces merged by what they are made of.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { WORLD_GROUPS, physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import { painted } from './bunker';
import { BORE_ARCH } from './tunnel';
import { HALL, RIM, SHAFT, shaftFloor, type Station } from '../sim/train-line';

/** how far under the platform the rails lie, and the bed under them */
const RAILS = RIM + 1.4, BED = RAILS + 0.3;
const PILLAR_EVERY = 9, PILLAR_AT = 6.2, PILLAR = 0.42, LAMP_EVERY = 6;
const FENCE_HIGH = 1.1, FENCE_UP = 2.6, GATE_HALF = 1.2, GATE_TIME = 1.6, DOOR_TIME = 2.6;
/** the concourse behind the buffers at a station that has one: how deep, and out to where across */
export const COURT = { deep: 6.2, wide: 28.2 };

type Paint = 'wall' | 'floor' | 'tile' | 'steel' | 'yellow' | 'lamp';

export class StationHall {
  readonly group = new THREE.Group();
  private bins = new Map<Paint, THREE.BufferGeometry[]>();
  private yaw: number;
  private lamps: THREE.Vector3[] = [];
  private gateMesh = new THREE.Group();
  private gateBody;
  private shut = 0;
  private held = new THREE.Vector3();
  private top = new THREE.Vector3();
  /** the Kupol's door, between its platform and its stair: it rises into the wall over it */
  private door: { mesh: THREE.Group; body: ReturnType<typeof physics.world.createCollider>; up: number } | null = null;
  doorOpen = false;
  private doorWas = false;
  private gateWas = false;
  private buffers = false;
  get stop() {
    return this.t.stop;
  }

  /** @param court the concourse behind the buffers, with a door at this far across (Level 3's): without one the hall just ends */
  constructor(atmo: Atmosphere, scene: THREE.Scene, private t: Station, court: number | null) {
    this.yaw = Math.atan2(-t.uz, t.ux);
    this.top.set(...this.at(SHAFT.top, 6.5, SHAFT.high));
    const L = HALL.long, E = HALL.edge, B = HALL.back, F = HALL.far, T = HALL.tall, W = 0.6;
    const a0 = court === null ? -W : -COURT.deep, bMax = court === null ? B : COURT.wide;
    // (the platform, its walls, the track's bed and the roof)
    this.box(0, L, E, B, -BED, 0, 'floor');
    this.box(a0, 0, F, bMax, -BED, 0, 'floor');
    this.box(a0 - 0.3, L + W, F - W, bMax + W, T, T + 0.4, 'wall');
    this.box(0, L, F, E, -BED - 0.4, -BED, 'floor');
    this.box(0, L, B, B + W, 0, T, 'wall');
    this.box(a0, L, F - W, F, -BED - 0.4, T, 'wall');
    this.box(0, L, E, E + 0.3, -0.03, 0.004, 'yellow', false);
    // (the end of the hall at the tunnel, round the bore: solid beside it and over it)
    if (court !== null) this.box(L, L + W, E + 1.28, B, -BED, T, 'wall');
    else {
      // (with a way through it at the platform's end, to the stair)
      const S = SHAFT;
      this.box(L, L + W, E + 1.28, S.b0, -BED, T, 'wall');
      this.box(L, L + W, S.b1, B, -BED, T, 'wall');
      this.box(L, L + W, S.b0, S.b1, S.tall, T, 'wall');
      this.box(L, L + W, S.b0, S.b1, -BED, 0, 'floor');
      this.shaft();
    }
    this.box(L, L + W, F, -3, -BED, T, 'wall');
    this.box(L, L + W, -3, 3, -RAILS + 5.4, T, 'wall');
    // (the tiles to head height along both walls, and the pillars)
    for (const [b0, b1] of [[B - 0.03, B], [F, F + 0.03]]) this.box(0, L, b0, b1, b0 > 0 ? 0 : -BED, 2.3, 'tile', false);
    for (let a = 4; a < L - 2; a += PILLAR_EVERY) this.box(a - PILLAR, a + PILLAR, PILLAR_AT - PILLAR, PILLAR_AT + PILLAR, 0, T, 'wall');
    if (court !== null) {
      // (the concourse: the wall behind it, a door through to Level 3's lift, its far end and the wall over the buffers' end of the track)
      this.box(a0 - 0.3, a0, F, court - 1.1, 0, T, 'wall');
      this.box(a0 - 0.3, a0, court + 1.1, bMax, 0, T, 'wall');
      this.box(a0 - 0.3, a0, court - 1.1, court + 1.1, 2.4, T, 'wall');
      this.box(a0, 0, bMax, bMax + W, 0, T, 'wall');
      this.box(0, W, B + W, bMax + W, 0, T, 'wall');
    } else this.box(-W, 0, F, B, -BED, T, 'wall');
    for (let a = 3; a < L; a += LAMP_EVERY) {
      for (const b of [4.2, -0.2]) {
        this.box(a - 0.7, a + 0.7, b - 0.06, b + 0.06, T - 0.1, T, 'lamp', false);
        this.lamps.push(new THREE.Vector3(...this.at(a, b, T - 0.3)));
      }
    }
    if (court !== null) for (const b of [10, 18]) this.lamps.push(new THREE.Vector3(...this.at(-3, b, T - 0.3)));
    this.fence();
    this.gateBody = physics.world.createCollider(physics.R.ColliderDesc.cuboid(GATE_HALF, FENCE_UP / 2, 0.06).setTranslation(...this.at(t.gate, E + 0.08, FENCE_UP / 2)).setRotation(this.turn()).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS));
    physics.tag(this.gateBody, { surface: 'metal' });

    const c = assets.pbr('dirty_concrete'), f = assets.pbr('concrete_floor_worn_001');
    const tile = painted(512, 512, (g, rnd) => {
      g.fillStyle = '#23302a';
      g.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = 150 + Math.floor(rnd() * 34);
        g.fillStyle = `rgb(${v - 34}, ${v}, ${v - 22})`;
        g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      }
    }, 5, true);
    const paints: Record<Paint, THREE.Material> = {
      wall: atmo.register(new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, roughnessMap: c.armMap, roughness: 1, metalness: 0 })),
      floor: atmo.register(new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normalMap, roughnessMap: f.armMap, roughness: 1, metalness: 0 })),
      tile: atmo.register(new THREE.MeshStandardMaterial({ map: tile, roughness: 0.45, metalness: 0 })),
      steel: atmo.register(new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.55, metalness: 0.6 })),
      yellow: atmo.register(new THREE.MeshStandardMaterial({ color: 0xc69a1f, roughness: 0.7 })),
      lamp: atmo.register(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.93, 0.78), emissiveIntensity: 3 })),
    };
    for (const [k, list] of this.bins) {
      const m = new THREE.Mesh(mergeGeometries(list, false), paints[k]);
      m.receiveShadow = true;
      // (the roofs stop the sun: the ground overhead casts no shadow down here)
      m.castShadow = k === 'wall';
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    // (seen from the hall whichever way its triangles came out)
    const mouth = new THREE.Mesh(this.mouth(), atmo.register(new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, roughnessMap: c.armMap, roughness: 1, metalness: 0, side: THREE.DoubleSide })));
    mouth.matrixAutoUpdate = false;
    this.group.add(mouth);
    this.signs(atmo);
    this.gate(paints.steel);
    if (court === null) this.hang(paints.steel, paints.yellow);
    this.group.visible = false;
    scene.add(this.group);
  }

  private at(a: number, b: number, y: number): [number, number, number] {
    const t = this.t;
    return [t.x + t.ux * a + t.vx * b, t.y + y, t.z + t.uz * a + t.vz * b];
  }

  private turn() {
    const h = this.yaw / 2;
    return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
  }

  /** a block of it, from corner to corner in the station's measure, tiled by its size in metres */
  private box(a0: number, a1: number, b0: number, b1: number, y0: number, y1: number, paint: Paint, solid = true) {
    const w = a1 - a0, d = b1 - b0, h = y1 - y0, g = new THREE.BoxGeometry(w, h, d), pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv'), tile = paint === 'tile' ? 1.5 : 3;
    const [cx, cy, cz] = this.at((a0 + a1) / 2, (b0 + b1) / 2, (y0 + y1) / 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz;
      if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, x / tile, z / tile);
      else if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, z / tile, y / tile);
      else uv.setXY(i, x / tile, y / tile);
    }
    g.rotateY(this.yaw);
    g.translate(cx, cy, cz);
    if (!this.bins.has(paint)) this.bins.set(paint, []);
    this.bins.get(paint)!.push(g);
    if (solid) physics.addStatic(physics.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2), paint === 'steel' ? 'metal' : 'concrete', { x: cx, y: cy, z: cz }, this.yaw);
  }

  /** a flat piece of it through four corners in the station's measure, facing the point given, tiled by its size in metres */
  private quad(paint: Paint, corners: [number, number, number][], toward: [number, number, number]) {
    const w = corners.map((c) => new THREE.Vector3(...this.at(...c))), t = new THREE.Vector3(...this.at(...toward)), mid = w[0].clone().add(w[2]).multiplyScalar(0.5);
    let n = w[1].clone().sub(w[0]).cross(w[3].clone().sub(w[0])).normalize();
    if (n.dot(t.sub(mid)) < 0) {
      w.reverse();
      n = n.negate();
    }
    const tile = paint === 'tile' ? 1.5 : 3, long = w[0].distanceTo(w[1]) / tile, high = w[0].distanceTo(w[3]) / tile, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(w.flatMap((v) => [v.x, v.y, v.z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(w.flatMap(() => [n.x, n.y, n.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, long, 0, long, high, 0, high], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    if (!this.bins.has(paint)) this.bins.set(paint, []);
    this.bins.get(paint)!.push(g);
  }

  /** something solid that is not square to the station: all its corners, in the station's measure */
  private hull(corners: [number, number, number][]) {
    physics.addStatic(physics.R.ColliderDesc.convexHull(new Float32Array(corners.flatMap((c) => this.at(...c))))!, 'concrete', { x: 0, y: 0, z: 0 }, 0);
  }

  /** the long stair up to the ground, with lamps down a rail along its middle as a deep metro has: see SHAFT */
  private shaft() {
    const S = SHAFT, W = 0.3, F = shaftFloor, mid = (S.b0 + S.b1) / 2, n = 104, rise = S.high / n, run = (S.top - S.a0) / n, axis = (a: number): [number, number, number] => [a, mid, F(a) + 1.6];
    // (the landing at its foot)
    this.box(HALL.long + 0.6, S.a0, S.b0, S.b1, -0.4, 0, 'floor');
    this.box(HALL.long + 0.6, S.a0, S.b0, S.b1, S.tall, S.tall + 0.3, 'wall');
    for (const b of [S.b0 - W, S.b1]) this.box(HALL.long + 0.6, S.a0, b, b + W, 0, S.tall, 'tile');
    // (its treads and risers, one ramp to walk on)
    for (let k = 0; k < n; k++) {
      const a = S.a0 + k * run, y = k * rise;
      this.quad('floor', [[a, S.b0, y], [a, S.b1, y], [a, S.b1, y + rise], [a, S.b0, y + rise]], [a - 1, mid, y]);
      this.quad('floor', [[a, S.b0, y + rise], [a, S.b1, y + rise], [a + run, S.b1, y + rise], [a + run, S.b0, y + rise]], [a, mid, y + 2]);
    }
    const under: [number, number, number][] = [[S.a0, S.b0, -1], [S.a0, S.b1, -1], [S.top + 0.5, S.b0, S.high - 1], [S.top + 0.5, S.b1, S.high - 1]];
    this.hull([...under, [S.a0, S.b0, 0], [S.a0, S.b1, 0], [S.top + 0.5, S.b0, S.high], [S.top + 0.5, S.b1, S.high]]);
    // (the rail down its middle, and its side walls: tiled to the height of a hand, plain over that, on up past the ground where the roof stops)
    const a0 = S.a0, a1 = S.open, a2 = S.top, f1 = F(a1), top = S.high + 0.9;
    for (const b of [S.b0, S.b1]) {
      this.quad('tile', [[a0, b, 0], [a1, b, f1], [a1, b, f1 + 1.3], [a0, b, 1.3]], axis(50));
      this.quad('wall', [[a0, b, 1.3], [a1, b, f1 + 1.3], [a1, b, f1 + S.tall], [a0, b, S.tall]], axis(50));
      this.quad('tile', [[a1, b, f1], [a2, b, S.high], [a2, b, top], [a1, b, top]], axis(70));
      const out = b === S.b0 ? b - W - 0.1 : b, wide = W + 0.1;
      this.box(a0, a2 + 0.3, out, out + wide, -1, top, 'wall', true);
    }
    this.quad('wall', [[a0, S.b0, S.tall], [a1, S.b0, f1 + S.tall], [a1, S.b1, f1 + S.tall], [a0, S.b1, S.tall]], axis(50));
    this.hull([[a0, S.b0, S.tall], [a0, S.b1, S.tall], [a1, S.b0, f1 + S.tall], [a1, S.b1, f1 + S.tall], [a0, S.b0, S.tall + 0.5], [a0, S.b1, S.tall + 0.5], [a1, S.b0, f1 + S.tall + 0.5], [a1, S.b1, f1 + S.tall + 0.5]]);
    // (the end of its roof, standing out of the ground over the stair's mouth)
    this.box(a1 - 1, a1, S.b0 - W - 0.1, S.b1 + W + 0.1, f1 + S.tall, S.high + 2.7, 'wall');
    const rail: [number, number][] = [[-0.04, 0.05], [0.04, 0.05]];
    for (const r of [0.95, 0.5]) for (const [d] of rail) this.quad('steel', [[a0, mid + d, r], [a2, mid + d, S.high + r], [a2, mid + d, S.high + r + 0.05], [a0, mid + d, r + 0.05]], [a0, d > 0 ? mid + 1 : mid - 1, r]);
    this.hull([[a0, mid - 0.07, 0], [a0, mid + 0.07, 0], [a2, mid - 0.07, S.high], [a2, mid + 0.07, S.high], [a0, mid - 0.07, 1], [a0, mid + 0.07, 1], [a2, mid - 0.07, S.high + 1], [a2, mid + 0.07, S.high + 1]]);
    for (let a = a0 + 2; a < a2; a += 4.5) {
      const y = F(a);
      this.box(a - 0.03, a + 0.03, mid - 0.03, mid + 0.03, y, y + 1.5, 'steel', false);
      this.box(a - 0.1, a + 0.1, mid - 0.1, mid + 0.1, y + 1.5, y + 1.72, 'lamp', false);
      this.lamps.push(new THREE.Vector3(...this.at(a, mid, y + 1.7)));
    }
  }

  /** the wall round the tunnel's mouth, its opening the bore's own shape */
  private mouth(): THREE.BufferGeometry {
    const shape = new THREE.Shape(), low = -BED - 0.4, top = -RAILS + 5.45;
    shape.moveTo(-3.6, low).lineTo(3.6, low).lineTo(3.6, top).lineTo(-3.6, top).closePath();
    const hole = new THREE.Path();
    BORE_ARCH.forEach(([x, y], i) => (i ? hole.lineTo(x, y - RAILS) : hole.moveTo(x, y - RAILS)));
    hole.closePath();
    shape.holes.push(hole);
    const g = new THREE.ShapeGeometry(shape), pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const b = pos.getX(i), y = pos.getY(i), [px, h, pz] = this.at(HALL.long - 0.02, b, y);
      pos.setXYZ(i, px, h, pz);
      uv.setXY(i, b / 3, y / 3);
    }
    g.computeVertexNormals();
    return g;
  }

  /** the fence along the platform's edge, stopping a body up to well over its head (nothing to see past its top rail), with its gap for the gate */
  private fence() {
    const L = HALL.long, E = HALL.edge + 0.08, g = this.t.gate, spans = [[0.2, g - GATE_HALF], [g + GATE_HALF, L - 0.2]];
    for (const [a0, a1] of spans) {
      for (const y of [FENCE_HIGH, FENCE_HIGH * 0.55]) this.box(a0, a1, E - 0.03, E + 0.03, y - 0.03, y + 0.03, 'steel', false);
      for (let a = a0; a <= a1 + 0.01; a += (a1 - a0) / Math.max(1, Math.round((a1 - a0) / 3))) this.box(a - 0.04, a + 0.04, E - 0.04, E + 0.04, 0, FENCE_HIGH, 'steel', false);
      const [x, y, z] = this.at((a0 + a1) / 2, E, FENCE_UP / 2);
      physics.addStatic(physics.R.ColliderDesc.cuboid((a1 - a0) / 2, FENCE_UP / 2, 0.06), 'metal', { x, y, z }, this.yaw);
    }
  }

  /** the gate's leaf: a frame of the fence's own bars, that runs back along it */
  private gate(steel: THREE.Material) {
    const parts: THREE.BufferGeometry[] = [], H = GATE_HALF, bar = (w: number, h: number, a: number, y: number) => parts.push(new THREE.BoxGeometry(w, h, 0.05).translate(a, y, 0));
    for (const y of [0.1, FENCE_HIGH]) bar(H * 2, 0.07, 0, y);
    for (const a of [-H, H]) bar(0.07, FENCE_HIGH, a, FENCE_HIGH / 2);
    for (let a = -H + 0.3; a < H; a += 0.3) bar(0.03, FENCE_HIGH, a, FENCE_HIGH / 2);
    const m = new THREE.Mesh(mergeGeometries(parts, false), steel);
    this.gateMesh.add(m);
    this.gateMesh.rotation.y = this.yaw;
    this.gateMesh.position.set(...this.at(this.t.gate, HALL.edge + 0.16, 0));
    this.group.add(this.gateMesh);
  }

  /** the door at the foot of the stair: a plate of steel banded in yellow, shut until the purple pass is shown to the reader beside it */
  private hang(steel: THREE.Material, yellow: THREE.Material) {
    const S = SHAFT, mid = (S.b0 + S.b1) / 2, half = (S.b1 - S.b0) / 2, mesh = new THREE.Group(), [x, y, z] = this.at(HALL.long + 0.3, mid, S.tall / 2);
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, S.tall, half * 2), steel));
    for (const h of [-0.9, 0.9]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, half * 2), yellow);
      band.position.y = h;
      mesh.add(band);
    }
    mesh.position.set(x, y, z);
    mesh.rotation.y = this.yaw;
    this.group.add(mesh);
    const c = physics.R.ColliderDesc.cuboid(0.13, S.tall / 2, half).setTranslation(x, y, z).setRotation(this.turn()).setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS);
    const body = physics.world.createCollider(c);
    physics.tag(body, { surface: 'metal' });
    this.door = { mesh, body, up: 0 };
    // (and the reader's foot, which stops a body as the post does)
    const [rx, ry, rz] = this.at(35.2, 4.35, 0.6);
    physics.addStatic(physics.R.ColliderDesc.cuboid(0.16, 0.6, 0.2), 'metal', { x: rx, y: ry, z: rz }, this.yaw);
  }

  /** the station's name in enamel, along both walls */
  private signs(atmo: Atmosphere) {
    const name = this.t.stop ? 'БУНКЕР 17' : 'КУПОЛ', sub = this.t.stop ? 'BUNKER 17 · TERMINUS' : 'KUPOL · TERMINUS';
    const tex = painted(1024, 256, (g) => {
      g.fillStyle = '#16284a';
      g.fillRect(0, 0, 1024, 256);
      g.strokeStyle = '#e8e4d8';
      g.lineWidth = 8;
      g.strokeRect(14, 14, 996, 228);
      g.fillStyle = '#e8e4d8';
      g.textAlign = 'center';
      g.font = '700 118px "Arial Narrow", Arial, sans-serif';
      g.fillText(name, 512, 130);
      g.font = '500 44px "Arial Narrow", Arial, sans-serif';
      g.fillText(sub, 512, 200);
    }, 1, false);
    const mat = atmo.register(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1 })), geo = new THREE.PlaneGeometry(3.2, 0.8);
    if (!this.t.stop) {
      // (and over the stair's mouth, for whoever comes across the hill)
      const s = new THREE.Mesh(geo, mat), [x, h, z] = this.at(SHAFT.open + 0.02, (SHAFT.b0 + SHAFT.b1) / 2, SHAFT.high + 1.7);
      s.position.set(x, h, z);
      s.rotation.y = Math.atan2(-this.t.ux, -this.t.uz);
      s.scale.setScalar(1.3);
      this.group.add(s);
    }
    for (let a = 8.5; a < HALL.long - 2; a += 2 * PILLAR_EVERY) {
      for (const [b, y, face] of [[HALL.back - 0.05, 3, 1], [HALL.far + 0.05, 3, -1]] as const) {
        const s = new THREE.Mesh(geo, mat), [x, h, z] = this.at(a, b, y);
        s.position.set(x, h, z);
        // (a plane looks along its own +z: here, back into the hall)
        s.rotation.y = Math.atan2(-this.t.vx * face, -this.t.vz * face);
        this.group.add(s);
      }
    }
  }

  /** @param dt seconds @param open the train stands here, with time left to board */
  update(dt: number, eye: THREE.Vector3, on: boolean, open: boolean, lit: (pos: THREE.Vector3, burn: number) => void) {
    // (the gate and the door are heard as they start to move)
    const heard = (at: [number, number, number], opening: boolean) => {
      const [x, y, z] = at, far = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
      if (far < 70) audio.blastDoor({ x, y, z }, far, opening);
    };
    if (open !== this.gateWas) {
      this.gateWas = open;
      heard(this.at(this.t.gate, HALL.edge, 1), open);
    }
    this.shut = THREE.MathUtils.clamp(this.shut + (open ? dt : -dt) / GATE_TIME, 0, 1);
    this.gateBody.setEnabled(this.shut < 0.6);
    if (this.door) {
      const d = this.door;
      if (this.doorOpen !== this.doorWas) {
        this.doorWas = this.doorOpen;
        heard(this.at(HALL.long + 0.3, 6.5, 1.7), this.doorOpen);
      }
      d.up = THREE.MathUtils.clamp(d.up + (this.doorOpen ? dt : -dt) / DOOR_TIME, 0, 1);
      d.body.setEnabled(d.up < 0.7);
      d.mesh.position.y = this.t.y + SHAFT.tall / 2 + d.up * (SHAFT.tall - 0.1);
    }
    // (the Kupol's stair is seen from the ground, down its open cut)
    const up = !this.t.stop && Math.hypot(eye.x - this.top.x, eye.z - this.top.z) < 110;
    this.group.visible = on || up;
    if (!on && !up) return;
    if (!this.buffers) {
      this.buffers = true;
      // (its buffers look along its +z, here out along the track)
      if (!this.t.stop) {
        // (its panel, its +x, looks out across the landing)
        void assets.model('card_reader').then((m) => {
          const r = m.clone();
          r.position.set(...this.at(35.2, 4.35, 0));
          r.rotation.y = Math.atan2(-this.t.vz, this.t.vx);
          this.group.add(r);
        });
      }
      void assets.model('buffer_stop').then((m) => {
        const b = m.clone();
        b.position.set(...this.at(0.93, 0, -RAILS));
        b.rotation.y = Math.atan2(this.t.ux, this.t.uz);
        this.group.add(b);
      });
    }
    this.gateMesh.position.set(...this.at(this.t.gate + this.shut * GATE_HALF * 1.9, HALL.edge + 0.16, 0));
    for (const l of this.lamps) if (l.distanceToSquared(eye) < 26 * 26) lit(this.held.copy(l), 1);
  }
}
