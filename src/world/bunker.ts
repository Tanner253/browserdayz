// The bunker as it is built (see src/sim/bunker.ts for what and where): the pad over the
// hole, the hut, the stair, the first level with its passage, rooms and benches, the door a
// keycard opens, the sealed way down, and the lamps. Concrete and steel, made and painted
// here, and solid. Everything is laid out in the bunker's own measure and stood in the world
// by one turn about its middle.

import * as THREE from 'three';
import { physics } from '../core/physics';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Atmosphere } from './atmosphere';
import { bunkerPlace, type World } from './worldgen';
import { BUNKER, bunkerAt, bunkerLamps, bunkerRooms, bunkerShelves, lampBurns, levelY, type Place } from '../sim/bunker';

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

/** a box whose faces carry the picture at one size whatever the box's own: so many metres to one turn of it */
function boxGeo(w: number, h: number, d: number, per = 2.6): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // (three's box: four corners a face, in the order +x, -x, +y, -y, +z, -z)
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, (uv.getX(f * 4 + k) * spans[f][0]) / per, (uv.getY(f * 4 + k) * spans[f][1]) / per);
  return g;
}

export class BunkerSite {
  /** where it stands: null in a world that has none (and then this does nothing) */
  readonly place: Place | null;
  /** the door at the foot of the stair: seconds it still stands open (0: shut) */
  openFor = 0;
  private door: { mesh: THREE.Mesh; collider: RAPIER.Collider; slide: number } | null = null;
  private fixtures: { mat: THREE.MeshStandardMaterial; pos: THREE.Vector3; how: number; burn: number }[] = [];
  private clock = 0;

  constructor(world: World, atmo: Atmosphere, scene: THREE.Scene) {
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
    block(-B.pad.r, B.pad.r, B.pad.back, hole, under, top, outside, up);
    block(-B.pad.r, -B.stair.half, hole, B.pad.front, under, top, outside, up);
    block(B.stair.half, B.pad.r, hole, B.pad.front, under, top, outside, up);
    block(-B.stair.half, B.stair.half, head, B.pad.front, under, top, outside, up);
    // a kerb round it, and two air shafts standing on it
    for (const [r, f] of [[-9, -12], [8.5, -4]]) {
      block(r - 0.7, r + 0.7, f - 0.7, f + 0.7, top, top + 1.5, outside, up);
      block(r - 0.85, r + 0.85, f - 0.85, f + 0.85, top + 1.5, top + 1.65, steel, { ...up, surface: 'metal' });
    }

    // ---- the hut over the head of the stair: three walls and a roof, open to the front
    const H = B.hut, ht = top + H.tall;
    block(-H.half - 0.3, -H.half, H.back, H.front, top, ht, outside, up);
    block(H.half, H.half + 0.3, H.back, H.front, top, ht, outside, up);
    block(-H.half - 0.3, H.half + 0.3, H.back - 0.3, H.back, top, ht, outside, up);
    block(-H.half - 0.5, H.half + 0.5, H.back - 0.5, H.front + 0.4, ht, ht + 0.3, outside, up);
    // (the front: a doorway between two piers)
    block(-H.half, -0.95, H.front - 0.3, H.front, top, ht, outside, up);
    block(0.95, H.half, H.front - 0.3, H.front, top, ht, outside, up);
    block(-0.95, 0.95, H.front - 0.3, H.front, top + 2.15, ht, outside, up);

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

    // ---- the first level: floor, ceiling, and the walls round it
    const L = B.hall, T = Y + B.tall;
    block(-L.r - 0.5, L.r + 0.5, L.back - 0.5, L.front, Y - 0.3, Y, floor);
    block(-L.r - 0.5, L.r + 0.5, L.back - 0.5, L.front, T, T + 0.3, inside);
    block(-L.r - 0.5, -L.r, L.back - 0.5, L.front, Y, T, inside);
    block(L.r, L.r + 0.5, L.back - 0.5, L.front, Y, T, inside);
    block(-L.r, L.r, L.back - 0.5, L.back, Y, T, inside);
    // the wall the door is in
    const Dr = B.door;
    block(-L.r, -Dr.half, L.front - 0.4, L.front, Y, T, inside);
    block(Dr.half, L.r, L.front - 0.4, L.front, Y, T, inside);
    block(-Dr.half, Dr.half, L.front - 0.4, L.front, Y + Dr.tall, T, inside);

    // the passage's walls, with a way through into each room; and the walls between the rooms
    const gap = 0.95, thick = 0.25;
    for (const room of bunkerRooms()) {
      const r0 = room.side * B.passage, r1 = room.side * (B.passage + thick), mid = (room.back + room.front) / 2;
      block(r0, r1, room.back, mid - gap, Y, T, inside);
      block(r0, r1, mid + gap, room.front - (room.front === L.front ? 0.4 : 0), Y, T, inside);
      block(r0, r1, mid - gap, mid + gap, Y + 2.15, T, inside);
      if (room.sealed) {
        // the way down to the levels below: shut, for now
        const sealed = mat(new THREE.MeshStandardMaterial({ map: doorPaint(['SEALED', 'LEVEL 2 · LEVEL 3', 'NO ENTRY'], 73), roughness: 0.6, metalness: 0.55 }));
        block(r0 + room.side * 0.04, r1 - room.side * 0.04, mid - gap, mid + gap, Y, Y + 2.15, [sealed, sealed, steel, steel, steel, steel], { surface: 'metal', whole: true });
      }
    }
    for (const f of B.cross) for (const side of [-1, 1]) block(side * B.passage, side * L.r, f - thick / 2, f + thick / 2, Y, T, inside);

    // ---- the benches things are kept on
    for (const s of bunkerShelves()) {
      const hr = (s.turn ? s.deep : s.long) / 2, hf = (s.turn ? s.long : s.deep) / 2;
      block(s.r - hr, s.r + hr, s.f - hf, s.f + hf, Y + s.top - 0.06, Y + s.top, steel, { surface: 'metal' });
      // (legs, and a shelf under: drawn, and too slight to stand in anybody's way)
      for (const [dr, df] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(s.r + dr * (hr - 0.05) - 0.03, s.r + dr * (hr - 0.05) + 0.03, s.f + df * (hf - 0.05) - 0.03, s.f + df * (hf - 0.05) + 0.03, Y, Y + s.top - 0.06, steel, { solid: false });
      block(s.r - hr + 0.04, s.r + hr - 0.04, s.f - hf + 0.04, s.f + hf - 0.04, Y + 0.28, Y + 0.31, steel, { solid: false });
    }

    // ---- the door a keycard opens: steel, on a track, sliding aside into the wall
    {
      const face = mat(new THREE.MeshStandardMaterial({ map: doorPaint(['LEVEL 1', 'KEYCARD HOLDERS ONLY'], 31), roughness: 0.6, metalness: 0.55 }));
      const d = block(-Dr.half - 0.05, Dr.half + 0.05, L.front - 0.3, L.front - 0.08, Y, Y + Dr.tall + 0.05, [steel, steel, steel, steel, face, face], { surface: 'metal', whole: true });
      d.mesh.matrixAutoUpdate = true;
      this.door = { mesh: d.mesh, collider: d.collider!, slide: 0 };
      // the reader beside it: a small box with a light on it
      block(Dr.half + 0.35, Dr.half + 0.55, L.front, L.front + 0.06, Y + 1.15, Y + 1.4, steel, { solid: false });
    }

    // ---- the lamps: a fitting on the ceiling for each, lit as it burns
    bunkerLamps().forEach(([r, f, y, how]) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x2a2a26, emissive: new THREE.Color(1, 0.86, 0.6), emissiveIntensity: 0, roughness: 0.5 });
      block(r - 0.32, r + 0.32, f - 0.09, f + 0.09, y + 0.12, y + 0.2, atmo.register(m), { solid: false });
      const [x, wy, z] = bunkerAt(P, r, f, y);
      this.fixtures.push({ mat: m, pos: new THREE.Vector3(x, wy, z), how, burn: 0 });
    });

    // the name over the hut's doorway
    {
      const sign = painted(512, 128, (g) => {
        g.fillStyle = '#2f352f';
        g.fillRect(0, 0, 512, 128);
        g.fillStyle = 'rgba(226, 220, 200, 0.92)';
        g.font = '700 84px "Arial Narrow", Arial, sans-serif';
        g.textAlign = 'center';
        g.fillText(B.name.toUpperCase(), 256, 94);
      }, 5, false);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), mat(new THREE.MeshStandardMaterial({ map: sign, roughness: 0.7, metalness: 0.3 })));
      plate.position.set(0, top + 2.38, H.front + 0.01);
      group.add(plate);
    }
    scene.add(group);
  }

  /** The door: opened for so many seconds (0 shuts it). */
  setOpen(seconds: number) {
    this.openFor = Math.max(0, seconds);
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
    if (this.openFor > 0) this.openFor = Math.max(0, this.openFor - dt);
    const d = this.door;
    if (d) {
      const want = this.openFor > 0 ? 1 : 0;
      if (d.slide !== want) {
        d.slide = Math.min(1, Math.max(0, d.slide + (want ? dt : -dt) / 1.4));
        d.mesh.position.x = d.slide * (BUNKER.door.half * 2 + 0.15);
        // (nobody is shut in a doorway: it is a wall again only once it is nearly home)
        d.collider.setEnabled(d.slide < 0.25);
      }
    }
    // (the lamps are not looked at from across the map)
    if (Math.hypot(eye.x - P.x, eye.z - P.z) > 90) return;
    this.fixtures.forEach((x, k) => {
      x.burn = lampBurns(x.how, k, this.clock);
      x.mat.emissiveIntensity = x.burn * 3.2;
      if (x.burn > 0.2) lit(x.pos, x.burn);
    });
  }
}
