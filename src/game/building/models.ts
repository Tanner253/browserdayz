// Base pieces drawn from models (2026-10-25: the navigator's queue, "Every Higgsfield model in: items, doors, furniture,
// palisade, gates"), in place of the boxes their solids are drawn as (src/sim/build/solids.ts). Each model is fitted into
// the box its piece's solids (or a leaf's) fill, so what is seen is what stops a body and a round; the solids are not
// changed by it. One geometry per kind (and per leaf), drawn instanced as every piece is (src/game/building/draw.ts).
// The palisade is built of one log, ten to a length and two laid across; the wooden gate is the one model cut down its
// middle, each log to the leaf its middle is on; the claim's flag waves (the owner's pirate flag, SusanKing's).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../../core/assets';
import type { Atmosphere } from '../../world/atmosphere';
import { shapeOf, type Solid } from '../../sim/build/solids';
import { FREE } from '../../sim/build/pieces';

type V3 = [number, number, number];
interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}
export interface Built {
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
}

/** a box's corners, of a piece's solid in its own frame */
function cornersOf(s: Solid): V3[] {
  if ('box' in s) {
    const [cx, cy, cz, sx, sy, sz] = s.box;
    return [[cx - sx / 2, cy - sy / 2, cz - sz / 2], [cx + sx / 2, cy + sy / 2, cz + sz / 2]];
  }
  if ('hull' in s) return s.hull;
  return s.prism.flatMap(([x, z]): V3[] => [[x, s.y0, z], [x, s.y1, z]]);
}
/** the box a list of solids fills */
export function boxOf(list: Solid[]): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of list) for (const c of cornersOf(s)) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], c[i]);
    hi[i] = Math.max(hi[i], c[i]);
  }
  return [lo, hi];
}

// ---- what is done to a model's parts

/** a model's meshes, each in the model's own frame, one to a paint (a paint of its own, put in the world's light) */
async function partsOf(id: string, atmo: Atmosphere | null): Promise<Part[]> {
  const root = await assets.model(id);
  root.updateMatrixWorld(true);
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const g = m.geometry.clone();
    // (each the same few things said of its points, so all of a kind's are drawn as one)
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    // (as plain numbers, before it is moved: a file packs its points and pictures' places as small whole numbers, which
    // hold nothing past a metre, one mesh one way and the next another)
    for (const k of Object.keys(g.attributes)) {
      const a = g.getAttribute(k) as THREE.BufferAttribute;
      if (a.array instanceof Float32Array && !a.normalized) continue;
      const out = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize));
    }
    g.applyMatrix4(m.matrixWorld);
    if (!by.has(m.material)) by.set(m.material, []);
    by.get(m.material)!.push(g.index ? g.toNonIndexed() : g);
  });
  return [...by].map(([src, list]) => {
    const mat = src.clone();
    if (atmo) atmo.register(mat);
    return { geo: list.length === 1 ? list[0] : mergeGeometries(list, false)!, mat };
  });
}
const clone = (parts: Part[]) => parts.map((p) => ({ geo: p.geo.clone(), mat: p.mat }));
const moved = (parts: Part[], m: THREE.Matrix4) => {
  for (const p of parts) p.geo.applyMatrix4(m);
  return parts;
};
function bounds(parts: Part[]) {
  const b = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    b.union(p.geo.boundingBox!);
  }
  return b;
}
/** stretched along each axis into a box */
function into(parts: Part[], [lo, hi]: [V3, V3]) {
  const b = bounds(parts), s = new THREE.Vector3(...hi).sub(new THREE.Vector3(...lo)).divide(b.getSize(new THREE.Vector3()));
  return moved(parts, new THREE.Matrix4().makeTranslation(...lo).multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z)).multiply(new THREE.Matrix4().makeTranslation(-b.min.x, -b.min.y, -b.min.z)));
}
/** mirrored across x = 0, its triangles turned to face out again */
function mirrored(parts: Part[]) {
  moved(parts, new THREE.Matrix4().makeScale(-1, 1, 1));
  for (const p of parts) {
    const P = p.geo.getAttribute('position') as THREE.BufferAttribute;
    for (const name of Object.keys(p.geo.attributes)) {
      const a = p.geo.getAttribute(name) as THREE.BufferAttribute, n = a.itemSize, arr = a.array as Float32Array;
      for (let i = 0; i < P.count; i += 3) for (let k = 0; k < n; k++) [arr[(i + 1) * n + k], arr[(i + 2) * n + k]] = [arr[(i + 2) * n + k], arr[(i + 1) * n + k]];
      a.needsUpdate = true;
    }
  }
  return parts;
}
const turnY = (a: number) => new THREE.Matrix4().makeRotationY(a);
/** the parts as one thing to draw: one geometry, a group to each paint */
function built(parts: Part[]): Built {
  const geo = parts.length === 1 ? parts[0].geo : mergeGeometries(parts.map((p) => p.geo), true)!;
  geo.computeBoundingSphere();
  return { geo, mat: parts.length === 1 ? parts[0].mat : parts.map((p) => p.mat) };
}

// ---- each piece

/** a leaf's box, as its solids fill it in the leaf's own frame */
const leafBox = (kind: string, i: number) => boxOf(shapeOf(kind).leaves![i].solid);
/** whether a leaf reaches toward -x from its hinge (a right-hand leaf): its model is mirrored */
const leftward = (kind: string, i: number) => leafBox(kind, i)[1][0] <= 0.01;

/** a door's leaf from a model standing face to z, width along x, its hinges at -x (remade from three views, 2026-10-25):
 * its face to +z, where a lock is fitted (`lockAt`), fitted into the leaf, mirrored for a leaf that reaches -x from its hinge */
const doorLeaf = (id: string) => async (kind: string, i: number, atmo: Atmosphere | null) => {
  const p = await partsOf(id, atmo);
  return built(into(leftward(kind, i) ? mirrored(p) : p, leafBox(kind, i)));
};

/** the armoured tier's leaves: the metal door's model, its paint darkened to plate steel */
const armouredLeaf = (id: string) => async (kind: string, i: number, atmo: Atmosphere | null) => {
  const b = await doorLeaf(id)(kind, i, null);
  const mats = (Array.isArray(b.mat) ? b.mat : [b.mat]).map((m) => {
    const c = m.clone() as THREE.MeshStandardMaterial;
    c.color.setRGB(0.4, 0.43, 0.48);
    if (atmo) atmo.register(c);
    return c;
  });
  return { geo: b.geo, mat: mats.length === 1 ? mats[0] : mats };
};

/**
 * Half of the wooden gate's model, cut down the gap between its logs nearest its middle: the model is one welded mesh,
 * its logs and braces not told apart by what they share, so it is cut where fewest of its triangles reach across, and
 * each triangle goes to the side its middle is on (the braces are cut there, a leaf's to each).
 */
async function gateHalf(kind: string, i: number, atmo: Atmosphere | null): Promise<Built> {
  const parts = moved(await partsOf('bb_gate_wood', atmo), turnY(Math.PI / 2)), left = !leftward(kind, i);
  const b = bounds(parts), w = b.max.x - b.min.x, mid = (b.min.x + b.max.x) / 2;
  const bins = 41, count = new Array<number>(bins).fill(0), x0 = mid - w * 0.2, step = (w * 0.4) / (bins - 1);
  for (const p of parts) {
    const P = p.geo.getAttribute('position');
    for (let t = 0; t < P.count; t += 3) {
      const lo = Math.min(P.getX(t), P.getX(t + 1), P.getX(t + 2)), hi = Math.max(P.getX(t), P.getX(t + 1), P.getX(t + 2));
      for (let k = 0; k < bins; k++) if (x0 + k * step >= lo && x0 + k * step <= hi) count[k]++;
    }
  }
  let cut = mid, least = Infinity;
  count.forEach((c, k) => {
    // (the emptiest, and of those the nearest the middle)
    const score = c + Math.abs(k - (bins - 1) / 2) * 0.01;
    if (score < least) [least, cut] = [score, x0 + k * step];
  });
  for (const p of parts) {
    const P = p.geo.getAttribute('position'), n = P.count / 3, keep: number[] = [];
    for (let t = 0; t < n; t++) if ((P.getX(t * 3) + P.getX(t * 3 + 1) + P.getX(t * 3 + 2)) / 3 < cut === left) keep.push(t);
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(p.geo.attributes)) {
      const a = p.geo.getAttribute(name), k = a.itemSize, arr = new Float32Array(keep.length * 3 * k);
      keep.forEach((t, j) => {
        for (let v = 0; v < 3; v++) for (let q = 0; q < k; q++) arr[(j * 3 + v) * k + q] = a.getComponent(t * 3 + v, q);
      });
      // (a long triangle of a brace that reached across the cut is pinned to it: it would stretch the leaf's bounds,
      // and squeeze its logs into half the leaf)
      if (name === 'position') for (let j = 0; j < arr.length; j += 3) arr[j] = left ? Math.min(arr[j], cut) : Math.max(arr[j], cut);
      out.setAttribute(name, new THREE.BufferAttribute(arr, k));
    }
    p.geo = out;
  }
  return built(into(parts, leafBox(kind, i)));
}

/** the palisade: the one sharpened log, ten to the length, each a little turned and set higher or lower, two across it inside */
async function palisade(atmo: Atmosphere | null): Promise<Built> {
  const log = await partsOf('bb_palisade_log', atmo), size = bounds(log).getSize(new THREE.Vector3());
  const [lo, hi] = boxOf(shapeOf('high_wall_wood').solid), long = hi[0] - lo[0], n = 10, girth = long / n + 0.02;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const all: Part[][] = [];
  for (let k = 0; k < n; k++) {
    const m = new THREE.Matrix4()
      .makeTranslation(lo[0] + (k + 0.5) * (long / n), -FREE.skirt + (rnd() - 0.6) * 0.12, (rnd() - 0.5) * 0.04)
      .multiply(turnY(rnd() * Math.PI * 2))
      .multiply(new THREE.Matrix4().makeScale(girth / size.x, (6.5 + FREE.skirt + rnd() * 0.25) / size.y, girth / size.z));
    all.push(moved(clone(log), m));
  }
  // (and two logs laid across its inside face, a man's height up and near its top: what holds them together)
  for (const y of [1.3, 4.6]) {
    const m = new THREE.Matrix4()
      .makeTranslation(0, y, lo[2] - 0.08)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeScale(0.2 / size.x, (long + 0.2) / size.y, 0.2 / size.z))
      .multiply(new THREE.Matrix4().makeTranslation(0, -size.y / 2, 0));
    all.push(moved(clone(log), m));
  }
  // (all of it one geometry to each paint the log has)
  const out: Part[] = [];
  for (const p of all.flat()) {
    const same = out.find((q) => q.mat === p.mat);
    if (same) same.geo = mergeGeometries([same.geo, p.geo], false)!;
    else out.push(p);
  }
  return built(out);
}

/**
 * The claim: its strongbox, the post it came with cut off at the lid; and its flag apart, waving (a shader of its own,
 * shared by every claim), flown on each claim's own pole (src/game/building/flags.ts).
 */
const FLAG = { time: { value: 0 }, at: { value: new THREE.Vector2(0, 1) } };
/** the flag's size flown, metres: a yard and a half by one, as a flag on a house's pole is */
export const FLAG_SIZE: readonly [number, number] = [1.1, 0.75];
/** how high the strongbox's lid is, as its solids have it: whatever of the model stands over it was its post */
const LID = 0.47;
let claimMade: Promise<{ box: Built; flag: Built | null }> | null = null;
function claimParts(atmo: Atmosphere | null) {
  return (claimMade ??= (async () => {
    const parts = await partsOf('bb_claim', atmo);
    const flag = parts.find((p) => p.mat.name === 'pirate_flag' || p.mat.side === THREE.DoubleSide);
    // (its strongbox's middle where the claim stands: the model came stood about the middle of all of it, flag and all)
    const body = parts.filter((p) => p !== flag);
    let x0 = Infinity, x1 = -Infinity;
    for (const b of body) {
      const P = b.geo.getAttribute('position');
      for (let i = 0; i < P.count; i++) if (P.getY(i) < 0.4) {
        x0 = Math.min(x0, P.getX(i));
        x1 = Math.max(x1, P.getX(i));
      }
    }
    if (Number.isFinite(x0)) moved(body, new THREE.Matrix4().makeTranslation(-(x0 + x1) / 2, 0, 0));
    const box = built(body.map((b) => ({ geo: under(b.geo, LID + 0.01), mat: b.mat })));
    if (!flag) return { box, flag: null };
    // (its hoist at x 0 and its middle at y 0, made FLAG_SIZE long, its folds kept as they are)
    flag.geo.computeBoundingBox();
    const fb = flag.geo.boundingBox!, k = FLAG_SIZE[0] / Math.max(0.01, fb.max.x - fb.min.x);
    flag.geo.applyMatrix4(new THREE.Matrix4().makeScale(k, (FLAG_SIZE[1] / Math.max(0.01, fb.max.y - fb.min.y)), k).multiply(new THREE.Matrix4().makeTranslation(-fb.min.x, -(fb.min.y + fb.max.y) / 2, -(fb.min.z + fb.max.z) / 2)));
    FLAG.at.value.set(0, FLAG_SIZE[0]);
    // (cloth hangs from its hoist: nothing moves there, more the further out; two waves and a slower roll through it,
    // each claim a little out of step with the next by where it stands)
    const wave = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uFlagTime = FLAG.time;
      shader.uniforms.uFlagAt = FLAG.at;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlagTime;\nuniform vec2 uFlagAt;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fk = clamp((transformed.x - uFlagAt.x) / uFlagAt.y, 0.0, 1.0);
        float fph = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.21;
        transformed.z += fk * (sin(uFlagTime * 3.1 - transformed.x * 6.0 + fph) * 0.07 + sin(uFlagTime * 1.7 - transformed.x * 2.5 + transformed.y * 3.0 + fph) * 0.04);
        transformed.y += fk * fk * (sin(uFlagTime * 2.3 - transformed.x * 4.0 + fph) * 0.015 - 0.05);`,
      );
    };
    const m = (flag.mat as THREE.MeshStandardMaterial).clone();
    m.side = THREE.DoubleSide;
    if (atmo) atmo.register(m, wave, 'flag-wave');
    else m.onBeforeCompile = wave;
    return { box, flag: { geo: flag.geo, mat: m } };
  })());
}
const claim = async (atmo: Atmosphere | null) => (await claimParts(atmo)).box;
/** the claim's flag, made once: flown by src/game/building/flags.ts */
export const flagOf = async (atmo: Atmosphere | null) => (await claimParts(atmo)).flag;

/** a geometry's triangles that lie wholly under a height (non-indexed: partsOf makes them so) */
function under(g: THREE.BufferGeometry, y: number): THREE.BufferGeometry {
  const P = g.getAttribute('position'), keep: number[] = [];
  for (let t = 0; t < P.count; t += 3) if (Math.max(P.getY(t), P.getY(t + 1), P.getY(t + 2)) < y) keep.push(t);
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    const arr = new Float32Array(keep.length * 3 * a.itemSize);
    keep.forEach((t, j) => arr.set((a.array as Float32Array).subarray(t * a.itemSize, (t + 3) * a.itemSize), j * 3 * a.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}

/** each kind drawn from a model: its body, and its leaves */
const BODY: Record<string, (atmo: Atmosphere | null) => Promise<Built>> = {
  box_small: async (atmo) => built(into(await partsOf('bb_small_box', atmo), boxOf([...shapeOf('box_small').solid]))),
  box_large: async (atmo) => built(into(await partsOf('bb_large_box', atmo), boxOf([...shapeOf('box_large').solid]))),
  // (its top at the solid top's height: the vice and the tools on it stand over that, three quarters of the model up)
  workbench: async (atmo) => built(into(moved(await partsOf('bb_workbench', atmo), turnY(Math.PI / 2)), [[-0.85, 0, -0.45], [0.85, 1.25, 0.45]])),
  // (its pallets the solid, its bedding over them: the model is the two)
  bed: async (atmo) => built(into(moved(await partsOf('bb_bed', atmo), turnY(Math.PI / 2)), [[-0.55, 0, -1.05], [0.55, 0.6, 1.05]])),
  // (a sleeping bag, opened out, its loft over the solid's ten centimetres: made along x)
  bedroll: async (atmo) => built(into(moved(await partsOf('bb_bedroll', atmo), turnY(Math.PI / 2)), [[-0.4, 0, -1], [0.4, 0.16, 1]])),
  // (the bracket's plate on the wall behind it, -z: the model has it at +z)
  torch_wall: async (atmo) => built(into(moved(await partsOf('bb_wall_torch', atmo), turnY(Math.PI)), [[-0.08, 1.62, -0.13], [0.08, 2.2, 0.17]])),
  ladder: async (atmo) => built(into(upright(await partsOf('bb_ladder', atmo)), boxOf(shapeOf('ladder').solid))),
  // (a hatch's own ladder, down the far side of its hole)
  hatch: async (atmo) => built(into(upright(await partsOf('bb_ladder', atmo)), boxOf(shapeOf('hatch').solid))),
  high_wall_wood: palisade,
  claim,
};
const LEAF: Record<string, (kind: string, i: number, atmo: Atmosphere | null) => Promise<Built>> = {
  door_wood: doorLeaf('bb_door_wood'),
  double_door_wood: doorLeaf('bb_door_wood'),
  door_metal: doorLeaf('bb_door_metal'),
  double_door_metal: doorLeaf('bb_door_metal'),
  door_armoured: armouredLeaf('bb_door_metal'),
  // (the garage door stands face to z already, width along x: fitted as it is)
  garage_door: async (kind, i, atmo) => built(into(await partsOf('bb_garage', atmo), leafBox(kind, i))),
  garage_door_armoured: async (kind, i, atmo) => {
    const b = await LEAF.garage_door(kind, i, null), m = (Array.isArray(b.mat) ? b.mat[0] : b.mat).clone() as THREE.MeshStandardMaterial;
    m.color.setRGB(0.42, 0.45, 0.5);
    if (atmo) atmo.register(m);
    return { geo: b.geo, mat: m };
  },
  // (a hatch's lid lies flat: its face, to z, turned up, and its hinges, at -x, to the hinge's edge at -z)
  hatch: async (kind, i, atmo) => built(into(moved(await partsOf('bb_hatch', atmo), new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2))), leafBox(kind, i))),
  gate_wood: gateHalf,
  // (timber bound in iron straps, as a gatehouse's leaves are)
  gate_stone: async (kind, i, atmo) => {
    const p = moved(await partsOf('bb_gate_steel', atmo), turnY(Math.PI));
    return built(into(leftward(kind, i) ? mirrored(p) : p, leafBox(kind, i)));
  },
};
/** what of a kind its model stands for, and is not drawn besides: the bed's bedding and the claim's cloth flag */
const CLOTH_GONE = new Set(['bed', 'claim']);

/** a model made to lie along its longest line, that line stood upright (a ladder modelled leant on a wall) */
function upright(parts: Part[]): Part[] {
  const pts: THREE.Vector3[] = [];
  for (const p of parts) {
    const P = p.geo.getAttribute('position');
    for (let i = 0; i < P.count; i += 3) pts.push(new THREE.Vector3().fromBufferAttribute(P, i));
  }
  const c = pts.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const v of pts) {
    const d = v.clone().sub(c).toArray();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j];
  }
  let axis = new THREE.Vector3(0.3, 1, 0.2).normalize();
  for (let k = 0; k < 50; k++) axis = new THREE.Vector3(C[0] * axis.x + C[1] * axis.y + C[2] * axis.z, C[3] * axis.x + C[4] * axis.y + C[5] * axis.z, C[6] * axis.x + C[7] * axis.y + C[8] * axis.z).normalize();
  if (axis.y < 0) axis.negate();
  moved(parts, new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0))));
  // (and its width turned to x: the line across it the widest way, now that it stands)
  const b = bounds(parts), s = b.getSize(new THREE.Vector3());
  return s.z > s.x ? moved(parts, turnY(Math.PI / 2)) : parts;
}

/**
 * The models of the pieces drawn from them, made once each, as they are first wanted. `get` says what to draw for a part
 * of a kind ('' its body, 'L0' a leaf, 'C' its cloth): the model, 'hide' (what a model stands in for), or null (none, or
 * not yet: drawn as its solids meanwhile, and `made` is told when it comes).
 */
export class PieceModels {
  private made = new Map<string, Built | null>();
  constructor(private atmo: Atmosphere | null, private ready: (kind: string) => void) {}

  get(kind: string, part: string): Built | 'hide' | null {
    if (part === 'C') return CLOTH_GONE.has(kind) && this.made.get(`${kind}:`) ? 'hide' : null;
    const make = part === '' ? BODY[kind] && (() => BODY[kind](this.atmo)) : part.startsWith('L') && LEAF[kind] ? () => LEAF[kind](kind, Number(part.slice(1)), this.atmo) : null;
    if (!make) return null;
    const key = `${kind}:${part}`;
    if (!this.made.has(key)) {
      this.made.set(key, null);
      void make().then((b) => {
        this.made.set(key, b);
        this.ready(kind);
      }, (e) => console.warn(`base model ${key}:`, e));
    }
    return this.made.get(key) ?? null;
  }

  /** every model asked for, made (the sandbox waits on it before its pictures) */
  async all(): Promise<void> {
    for (let k = 0; k < 200 && [...this.made.values()].some((b) => !b); k++) await new Promise((r) => setTimeout(r, 50));
  }

  /** the flags' wind */
  tick(dt: number) {
    FLAG.time.value += dt;
  }
}
