// The chimney and the tanks of the Chemical Works (see EXPANSION in worldgen.ts). They are not
// buildings to go into nor props off a shelf: each is a round thing of brick or steel, made
// here, painted here, and solid. Where they stand is the world's to say (`world.solids`), so
// that everything that asks whether ground is open knows of them.

import * as THREE from 'three';
import { physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import type { Solid, World } from './worldgen';

/** a picture to wrap round one of them, made once */
function painted(w: number, h: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  draw(c.getContext('2d')!, rnd);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** brick, in courses, with the two white bands a works chimney is known by and the soot of its years below them */
function stackPaint() {
  return painted(512, 2048, (g, rnd) => {
    const W = 512, H = 2048, course = 16, brick = 42;
    g.fillStyle = '#5b3a2e';
    g.fillRect(0, 0, W, H);
    for (let y = 0, row = 0; y < H; y += course, row++) {
      for (let x = -(row % 2) * (brick / 2); x < W; x += brick) {
        const k = 0.78 + rnd() * 0.36;
        g.fillStyle = `rgb(${(118 * k) | 0}, ${(62 * k) | 0}, ${(46 * k) | 0})`;
        g.fillRect(x + 1, y + 1, brick - 2, course - 2);
      }
    }
    // the bands: paint over brick, worn through
    for (const [top, tall] of [[70, 150], [300, 150]] as [number, number][]) {
      g.fillStyle = 'rgba(214, 208, 192, 0.86)';
      g.fillRect(0, top, W, tall);
      for (let i = 0; i < 420; i++) {
        g.fillStyle = `rgba(${(96 + rnd() * 40) | 0}, ${(54 + rnd() * 20) | 0}, 40, ${(0.25 + rnd() * 0.5).toFixed(2)})`;
        g.fillRect(rnd() * W, top + rnd() * tall, 3 + rnd() * 14, 2 + rnd() * 9);
      }
    }
    // soot from the lip, and the damp that has come up from the ground
    const soot = g.createLinearGradient(0, 0, 0, 520);
    soot.addColorStop(0, 'rgba(12, 10, 9, 0.85)');
    soot.addColorStop(1, 'rgba(12, 10, 9, 0)');
    g.fillStyle = soot;
    g.fillRect(0, 0, W, 520);
    const damp = g.createLinearGradient(0, H - 260, 0, H);
    damp.addColorStop(0, 'rgba(30, 38, 24, 0)');
    damp.addColorStop(1, 'rgba(30, 38, 24, 0.7)');
    g.fillStyle = damp;
    g.fillRect(0, H - 260, W, 260);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(14, 12, 10, ${(0.08 + rnd() * 0.2).toFixed(2)})`;
      g.fillRect(rnd() * W, rnd() * H * 0.5, 3 + rnd() * 9, 60 + rnd() * 420);
    }
  }, 7717);
}

/** painted steel plate in rings, a hazard band, and rust run down from every seam */
function tankPaint(seed: number) {
  return painted(1024, 512, (g, rnd) => {
    const W = 1024, H = 512;
    g.fillStyle = '#a9ab9c';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      const k = 150 + rnd() * 40;
      g.fillStyle = `rgba(${k | 0}, ${(k + 2) | 0}, ${(k - 12) | 0}, 0.12)`;
      g.fillRect(rnd() * W, rnd() * H, 4 + rnd() * 30, 2 + rnd() * 10);
    }
    // the band round it: yellow and black, most of the yellow gone
    const top = 150, tall = 56;
    g.fillStyle = '#b8981f';
    g.fillRect(0, top, W, tall);
    g.fillStyle = '#17150f';
    for (let x = -tall; x < W; x += 64) {
      g.beginPath();
      g.moveTo(x, top + tall);
      g.lineTo(x + 32, top + tall);
      g.lineTo(x + 32 + tall, top);
      g.lineTo(x + tall, top);
      g.fill();
    }
    // the rings it is made in, and the plates in each
    g.fillStyle = 'rgba(40, 40, 36, 0.55)';
    for (const y of [4, 128, 256, 384, 506]) g.fillRect(0, y, W, 3);
    for (let ring = 0; ring < 4; ring++) for (let x = (ring % 2) * 64; x < W; x += 128) g.fillRect(x, ring * 128, 2, 128);
    // rust
    for (let i = 0; i < 150; i++) {
      const x = rnd() * W, y = [8, 132, 260, 388][(rnd() * 4) | 0] + rnd() * 8, len = 30 + rnd() * rnd() * 220, w = 2 + rnd() * 12;
      const run = g.createLinearGradient(0, y, 0, y + len);
      run.addColorStop(0, `rgba(${(112 + rnd() * 40) | 0}, ${(52 + rnd() * 22) | 0}, 22, ${(0.35 + rnd() * 0.4).toFixed(2)})`);
      run.addColorStop(1, 'rgba(120, 60, 24, 0)');
      g.fillStyle = run;
      g.fillRect(x, y, w, len);
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${(92 + rnd() * 40) | 0}, ${(44 + rnd() * 20) | 0}, 20, ${(0.3 + rnd() * 0.4).toFixed(2)})`;
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, 4 + rnd() * 26, 3 + rnd() * 14, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }, seed);
}

export function buildWorks(world: World, atmo: Atmosphere, scene: THREE.Scene) {
  if (!world.solids.length) return;
  const mat = (m: THREE.MeshStandardMaterial) => atmo.register(m) as THREE.MeshStandardMaterial;
  const brick = mat(new THREE.MeshStandardMaterial({ map: stackPaint(), roughness: 0.93, metalness: 0 }));
  const concrete = mat(new THREE.MeshStandardMaterial({ color: 0x7d7a70, roughness: 0.95 }));
  const dark = mat(new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 0.9 }));
  const steel = [tankPaint(31), tankPaint(977)].map((map) => mat(new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.35 })));
  const lid = mat(new THREE.MeshStandardMaterial({ color: 0x8d8f82, roughness: 0.7, metalness: 0.3 }));
  const rail = mat(new THREE.MeshStandardMaterial({ color: 0x3a3b36, roughness: 0.6, metalness: 0.6 }));
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    return mesh;
  };
  world.solids.forEach((s: Solid, n) => {
    // (it stands on ground that is not quite level: its foot goes a little way down into it)
    const y0 = s.y - 0.6;
    if (s.kind === 'stack') {
      // a square plinth, and the shaft tapering to a lip
      const plinth = 3.2;
      add(new THREE.BoxGeometry(s.r * 2.9, plinth + 0.6, s.r * 2.9), concrete, s.x, y0 + (plinth + 0.6) / 2, s.z);
      const shaft = new THREE.CylinderGeometry(s.r * 0.62, s.r, s.h - plinth, 28, 1, true);
      add(shaft, brick, s.x, s.y + plinth + (s.h - plinth) / 2, s.z);
      add(new THREE.CylinderGeometry(s.r * 0.7, s.r * 0.66, 0.9, 28, 1, true), concrete, s.x, s.y + s.h - 0.2, s.z);
      // (looked down into, or up at from under the lip, it is black inside)
      const inside = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.56, s.r * 0.56, 6, 20, 1, true), dark);
      (inside.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
      inside.position.set(s.x, s.y + s.h - 3, s.z);
      group.add(inside);
      physics.addStatic(physics.R.ColliderDesc.cylinder(s.h / 2, s.r * 1.2), 'concrete', { x: s.x, y: s.y + s.h / 2, z: s.z });
    } else {
      const m = steel[n % steel.length];
      // the picture goes once round it, however big it is
      add(new THREE.CylinderGeometry(s.r, s.r, s.h + 0.6, 40, 1, true), m, s.x, y0 + (s.h + 0.6) / 2, s.z);
      // a shallow cone of a roof, a rail round the top of it, and a ring of concrete to stand on
      const roof = new THREE.ConeGeometry(s.r * 1.01, s.r * 0.22, 40, 1, false);
      add(roof, lid, s.x, s.y + s.h + s.r * 0.11, s.z);
      add(new THREE.TorusGeometry(s.r * 0.97, 0.035, 6, 40).rotateX(Math.PI / 2), rail, s.x, s.y + s.h + 0.95, s.z);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        add(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 5), rail, s.x + Math.cos(a) * s.r * 0.97, s.y + s.h + 0.475, s.z + Math.sin(a) * s.r * 0.97);
      }
      add(new THREE.CylinderGeometry(s.r + 0.45, s.r + 0.45, 0.5, 40), concrete, s.x, s.y - 0.1, s.z);
      physics.addStatic(physics.R.ColliderDesc.cylinder((s.h + 1) / 2, s.r), 'metal', { x: s.x, y: s.y + (s.h - 1) / 2, z: s.z });
    }
  });
  scene.add(group);
}
