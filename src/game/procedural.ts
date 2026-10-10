// The few meshes that have no scanned model: small machined parts built from a lathe
// profile, with a parkerised-steel material, and the stamped dog tag.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshPart } from '../core/gltf-utils';

let steel: THREE.MeshStandardMaterial | null = null;
function gunSteel() {
  if (!steel) {
    // faint machining rings + wear so it doesn't read as flat black plastic
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y++) {
      const v = 120 + Math.sin(y * 1.9) * 9 + (Math.random() - 0.5) * 26;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, 64, 1);
    }
    const rough = new THREE.CanvasTexture(c);
    rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
    steel = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.85, roughness: 0.62, roughnessMap: rough, name: 'gun-steel' });
  }
  return steel;
}

/** 9 mm suppressor: knurled rear collar, long body, stepped muzzle cap. Lies along +X, rear face at the origin. */
export function suppressorGeometry(): THREE.BufferGeometry {
  const R = 0.0165, L = 0.135;
  const pts: [number, number][] = [
    [0, 0], [0.0095, 0], [0.0095, 0.004], [R * 0.82, 0.006], [R * 0.82, 0.02], [R, 0.023],
    [R, L - 0.012], [R * 0.9, L - 0.009], [R * 0.9, L - 0.002], [R * 0.72, L], [0.0055, L], [0.0055, L - 0.006], [0, L - 0.006],
  ];
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  // lathe spins about Y: lay it along +X
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

let tagSteel: THREE.MeshStandardMaterial | null = null;
let keycardMat: THREE.MeshStandardMaterial | undefined;

/** the card's size (m): long, across, thick; and the sheet its two faces are painted on (each face so many dots long and across, a strip of bare plastic between them) */
const CARD = { L: 0.0856, W: 0.054, T: 0.001, PX: 1024, PY: 646, GAP: 20 };

/**
 * The pass card's two faces, painted one over the other on one sheet: its front above (the end
 * that is held on the left, the end that goes into the reader on the right), its back below.
 */
function keycardPaint(): THREE.CanvasTexture {
  const W = CARD.PX, H = CARD.PY, GAP = CARD.GAP;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * 2 + GAP;
  const g = c.getContext('2d')!;
  let s = 417;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  // (the plastic it is made of, where an edge shows it)
  g.fillStyle = '#d9d6ca';
  g.fillRect(0, 0, W, c.height);

  // ---- the front
  g.fillStyle = '#e7e4d8';
  g.fillRect(0, 0, W, H);
  // a green field: down the long edge at the top, and across the end that is held
  const green = '#1d6a3c';
  g.fillStyle = green;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W, 0);
  g.lineTo(W, 150);
  g.lineTo(700, 250);
  g.lineTo(250, 250);
  g.lineTo(170, H);
  g.lineTo(0, H);
  g.closePath();
  g.fill();
  // whose it is
  g.fillStyle = '#f0eee4';
  g.textBaseline = 'alphabetic';
  g.font = '900 150px "Arial Black", "Arial Narrow", Arial, sans-serif';
  g.fillText('BUNKER 17', 205, 148, 640);
  g.font = '700 50px "Arial Narrow", Arial, sans-serif';
  g.fillText('RESTRICTED ACCESS', 212, 212, 470);
  // what it opens
  g.fillStyle = '#1b3d28';
  g.font = '900 104px "Arial Black", Arial, sans-serif';
  g.fillText('LEVEL 1', 285, 420, 330);
  g.font = '700 38px "Courier New", monospace';
  g.fillText('No. 0417 - KEEP ON PERSON', 288, 492, 380);
  g.fillText('PROPERTY OF THE GARRISON', 288, 544, 380);
  // the bars of a number down in the corner
  for (let x = 290; x < 610; ) {
    const w = 3 + Math.floor(rnd() * 3) * 3;
    g.fillRect(x, 572, w, 44);
    x += w + 3 + Math.floor(rnd() * 3) * 3;
  }
  // which end goes in: an arrow, and the contacts it is read by
  g.fillStyle = '#16181a';
  g.beginPath();
  g.moveTo(985, 410);
  g.lineTo(915, 362);
  g.lineTo(915, 458);
  g.closePath();
  g.fill();
  {
    const x = 700, y = 330, w = 170, h = 150;
    const grad = g.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#d9bd6a');
    grad.addColorStop(0.5, '#f1e0a0');
    grad.addColorStop(1, '#b89845');
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(x, y, w, h, 16);
    g.fill();
    g.strokeStyle = 'rgba(92, 70, 20, 0.85)';
    g.lineWidth = 3;
    g.stroke();
    g.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      g.moveTo(x, y + h * k);
      g.lineTo(x + w * 0.34, y + h * k);
      g.moveTo(x + w * 0.66, y + h * k);
      g.lineTo(x + w, y + h * k);
    }
    g.moveTo(x + w * 0.34, y);
    g.lineTo(x + w * 0.34, y + h);
    g.moveTo(x + w * 0.66, y);
    g.lineTo(x + w * 0.66, y + h);
    g.stroke();
  }

  // ---- the back: green, a dark stripe the length of it, the lines of small print nobody reads
  const Y = H + GAP;
  g.fillStyle = green;
  g.fillRect(0, Y, W, H);
  g.fillStyle = '#15171a';
  g.fillRect(0, Y + 70, W, 120);
  g.fillStyle = 'rgba(240, 238, 228, 0.92)';
  g.fillRect(90, Y + 270, 620, 86);
  g.fillStyle = 'rgba(240, 238, 228, 0.55)';
  for (let k = 0; k < 5; k++) g.fillRect(90, Y + 410 + k * 38, 520 + rnd() * 300, 10);

  // ---- carried about for years: scratches, dirt rubbed in at the edges, the print worn off where a thumb goes
  for (const y0 of [0, Y]) {
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W, y = y0 + rnd() * H, len = 14 + rnd() * 120, a = rnd() * Math.PI;
      g.strokeStyle = rnd() < 0.6 ? `rgba(244, 242, 232, ${(0.08 + rnd() * 0.3).toFixed(2)})` : `rgba(24, 22, 16, ${(0.06 + rnd() * 0.2).toFixed(2)})`;
      g.lineWidth = 1 + rnd() * 2.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, Math.min(y0 + H, Math.max(y0, y + Math.sin(a) * len * 0.5)));
      g.stroke();
    }
    for (let i = 0; i < 1500; i++) {
      // (thickest toward the edges and the end that is held)
      const e = rnd() ** 2.2, side = rnd();
      const x = side < 0.4 ? e * W * 0.3 : side < 0.55 ? W - e * W * 0.2 : rnd() * W;
      const y = side >= 0.55 ? (rnd() < 0.5 ? y0 + e * H * 0.3 : y0 + H - e * H * 0.3) : y0 + rnd() * H;
      const r = 2 + rnd() * 13;
      g.fillStyle = `rgba(58, 46, 30, ${(0.03 + rnd() * 0.13).toFixed(3)})`;
      g.beginPath();
      g.arc(x, Math.min(y0 + H - r, Math.max(y0 + r, y)), r, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(231, 228, 216, ${(0.25 + rnd() * 0.5).toFixed(2)})`;
      g.beginPath();
      g.ellipse(rnd() * 190, y0 + 30 + rnd() * (H - 60), 6 + rnd() * 26, 3 + rnd() * 10, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * The pass card: a thin plastic card with rounded corners and a slot punched through the end it
 * is held by, lying flat with its front up. Its length is along x (the end that goes into the
 * reader at +x).
 */
export function keycardGeometry(): THREE.BufferGeometry {
  const { L, W, T } = CARD, R = 0.0034;
  const card = new THREE.Shape();
  card.moveTo(-L / 2 + R, -W / 2);
  card.lineTo(L / 2 - R, -W / 2);
  card.absarc(L / 2 - R, -W / 2 + R, R, -Math.PI / 2, 0, false);
  card.lineTo(L / 2, W / 2 - R);
  card.absarc(L / 2 - R, W / 2 - R, R, 0, Math.PI / 2, false);
  card.lineTo(-L / 2 + R, W / 2);
  card.absarc(-L / 2 + R, W / 2 - R, R, Math.PI / 2, Math.PI, false);
  card.lineTo(-L / 2, -W / 2 + R);
  card.absarc(-L / 2 + R, -W / 2 + R, R, Math.PI, Math.PI * 1.5, false);
  // the slot a lanyard goes through
  const sx = -L / 2 + 0.0062, sr = 0.0017, sh = 0.0075;
  const slot = new THREE.Path();
  slot.moveTo(sx + sr, -sh);
  slot.lineTo(sx + sr, sh);
  slot.absarc(sx, sh, sr, 0, Math.PI, false);
  slot.lineTo(sx - sr, -sh);
  slot.absarc(sx, -sh, sr, Math.PI, Math.PI * 2, false);
  card.holes.push(slot);
  const g = new THREE.ExtrudeGeometry(card, { depth: T, bevelEnabled: false, curveSegments: 5 });
  // each face is given its half of the sheet (see keycardPaint); the edge, the strip of bare plastic between them
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const H = CARD.PY, GAP = CARD.GAP, ALL = H * 2 + GAP;
  const lids = g.groups.find((q) => q.materialIndex === 0)!;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) + L / 2) / L, v = (pos.getY(i) + W / 2) / W;
    if (i < lids.start || i >= lids.start + lids.count) uv.setXY(i, 0.5, 1 - (H + GAP / 2) / ALL);
    else if (pos.getZ(i) > T / 2) uv.setXY(i, u, 1 - ((1 - v) * H) / ALL);
    else uv.setXY(i, u, 1 - (H + GAP + v * H) / ALL);
  }
  g.clearGroups();
  g.translate(0, 0, -T / 2).rotateX(-Math.PI / 2);
  return g;
}

/** Two stamped plates fanned on a ball chain, lying flat. */
export function dogTagGeometry(): THREE.BufferGeometry {
  const L = 0.05, W = 0.029, R = 0.009, T = 0.0012;
  const plate = new THREE.Shape();
  plate.moveTo(-L / 2 + R, -W / 2);
  plate.lineTo(L / 2 - R, -W / 2);
  plate.absarc(L / 2 - R, -W / 2 + R, R, -Math.PI / 2, 0, false);
  plate.lineTo(L / 2, W / 2 - R);
  plate.absarc(L / 2 - R, W / 2 - R, R, 0, Math.PI / 2, false);
  plate.lineTo(-L / 2 + R, W / 2);
  plate.absarc(-L / 2 + R, W / 2 - R, R, Math.PI / 2, Math.PI, false);
  plate.lineTo(-L / 2, -W / 2 + R);
  plate.absarc(-L / 2 + R, -W / 2 + R, R, Math.PI, Math.PI * 1.5, false);
  // the hole the chain runs through
  const hx = -L / 2 + 0.006;
  const hole = new THREE.Path();
  hole.absarc(hx, 0, 0.0022, 0, Math.PI * 2, true);
  plate.holes.push(hole);
  const flat = () => new THREE.ExtrudeGeometry(plate, { depth: T, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
  // the second plate swings out around the hole and rests on the first
  const lower = flat();
  const upper = flat().translate(-hx, T * 1.15, 0).rotateY(0.5).translate(hx, 0, 0);
  const chain = new THREE.TorusGeometry(0.016, 0.0009, 5, 30).rotateX(Math.PI / 2).translate(hx - 0.016, T * 1.2, 0).toNonIndexed();
  const g = mergeGeometries([lower, upper, chain], false)!;
  g.computeVertexNormals();
  return g;
}

export function proceduralParts(model: string): MeshPart[] {
  if (model === '@dogtag') {
    tagSteel ??= new THREE.MeshStandardMaterial({ color: 0xd2d0c8, metalness: 0.75, roughness: 0.48, name: 'tag-steel' });
    return [{ name: 'dogtag', geometry: dogTagGeometry(), material: tagSteel }];
  }
  if (model === '@suppressor') return [{ name: 'suppressor', geometry: suppressorGeometry(), material: gunSteel() }];
  if (model === '@keycard') {
    // a pass card: green and white plastic, printed, chipped, and carried about for years
    keycardMat ??= new THREE.MeshStandardMaterial({ map: keycardPaint(), roughness: 0.42, metalness: 0.05, name: 'keycard' });
    return [{ name: 'keycard', geometry: keycardGeometry(), material: keycardMat }];
  }
  throw new Error(`unknown procedural model ${model}`);
}
