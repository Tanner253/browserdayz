// The sandbox's base-building scenes (2026-10-24): each step of base building looked at on the plain floor before the
// world (the owner: "use the stage for all pictures and animations").
//   &bb=items   the things of gathering in a row as they lie on the ground, the survivor for size
//   &bb=fell    a pine felled: standing, then moments of its fall (src/world/felling.ts, its own clock), lying with its
//               logs by it, and the stump left

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../core/assets';
import { extractParts, type MeshPart } from '../core/gltf-utils';
import { ITEMS } from '../sim/items';
import { TREE_KINDS, treeOf } from '../sim/gather';
import { proceduralParts } from '../game/procedural';
import { Felling } from '../world/felling';
import type { Instance } from '../world/worldgen';
import '../ui/style.css';
import '../ui/hud.css';
import { Radial } from '../ui/radial';
import { Bases } from '../sim/build/bases';
import { PIECES, TIERS, type Tier } from '../sim/build/pieces';
import { blocked, nearestSpot, spots, toWorld, worldYaw, type Base } from '../sim/build/snap';
import { BaseDraw } from '../game/building/draw';
import { ghostGeometry } from '../game/building/look';
import { HAMMER_PER, PER, RINGS, hammerEntries, outerEntry, outerOf, planEntries } from '../game/building/wheel';

interface Stage {
  q: URLSearchParams;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  say: (i: number, text: string) => void;
}

/** the cells a scene draws (the page is laid out for them before it is begun) */
export const BUILD_CELLS: Record<string, number> = { items: 2, fell: 8, pieces: 4, base: 4, wheel: 1, doors: 6 };
/** and how many to a row */
export const BUILD_COLS: Record<string, number> = { fell: 4, doors: 3 };

/** a small base built by the rules on flat ground: two storeys, triangles, a doorway, a window, stairs, roofs, every tier */
function sampleBase() {
  const bs = new Bases({ ground: () => 0, why: () => null });
  const first = bs.lay({ k: 'foundation', x: 0, y: 0, z: 0, r: 0, yaw: 0 }, 'me', 0);
  if (typeof first === 'string') throw new Error(first);
  const b = first.base;
  const at = (k: string, x: number, y: number, z: number, turn = 0, t?: Tier) => {
    const s = nearestSpot(spots(b, k, turn), k, { x, y, z }, 4);
    if (!s) throw new Error(`no spot for ${k} at ${x} ${y} ${z}`);
    const r = bs.lay({ b: b.id, k, ...s }, 'me', 0);
    if (typeof r === 'string') throw new Error(`${k}: ${r}`);
    if (t) bs.upgrade(b.id, r.piece.id, t);
    return r.piece;
  };
  at('foundation', 3, 0, 0, 0, 2);
  at('foundation_tri', 5.5, 0, 0, 0, 2);
  at('foundation_steps', 0, -0.3, 2.3);
  // ground floor: stone round the outside, a metal doorway, a wooden window, a frame between the rooms
  at('wall', -1.5, 1.5, 0, 0, 2);
  at('wall', 0, 1.5, -1.5, 0, 2);
  at('wall', 3, 1.5, -1.5, 0, 2);
  at('window', 3, 1.5, 1.5, 0, 1);
  at('doorway', 0, 1.5, 1.5, 0, 3);
  at('wall', 1.5, 1.5, 0);
  // stairs in the first room, turned to come out at the top onto the second room's floor
  at('stairs_u', 0, 1.5, 0, 1, 1);
  // the triangle's two outer walls, wood
  for (const q of spots(b, 'wall').filter((w) => w.x > 5 && !blocked(b, 'wall', w))) {
    const r = bs.lay({ b: b.id, k: 'wall', ...q }, 'me', 0);
    if (typeof r !== 'string') bs.upgrade(b.id, r.piece.id, 1);
  }
  // upstairs: a floor over the second room, half walls and a low metal wall round it, a roof over the triangle
  at('floor', 3, 3, 0, 0, 1);
  at('wall_half', 3, 3.75, -1.5, 0, 1);
  at('wall_low', 3, 3.5, 1.5, 0, 3);
  at('roof_tri', 5.5, 3, 0, 0, 1);
  // a run of high wall off to the side
  const hw = bs.lay({ k: 'high_wall_wood', x: -8, y: 0, z: 6, r: 0, yaw: 0.2 }, 'me', 0);
  if (typeof hw !== 'string') {
    const s = spots(hw.base, 'high_wall_wood').find((q) => !blocked(hw.base, 'high_wall_wood', q));
    if (s) bs.lay({ b: hw.base.id, k: 'high_wall_wood', ...s }, 'me', 0);
  }
  return bs;
}

/**
 * Every fitting hung by the rules (the fourth step): a row of three rooms, an airlock's two doors, each window's
 * fitting, a garage door, a hatch over the first room, boxes and the bench; and high walls with their gates.
 */
function doorBase() {
  const bs = new Bases({ ground: () => 0, why: () => null });
  const first = bs.lay({ k: 'foundation', x: 0, y: 0, z: 0, r: 0, yaw: 0 }, 'me', 0);
  if (typeof first === 'string') throw new Error(first);
  const b = first.base;
  const at = (k: string, x: number, y: number, z: number, turn = 0, t?: Tier, open?: boolean) => {
    const s = nearestSpot(spots(b, k, turn), k, { x, y, z }, 4);
    if (!s) throw new Error(`no spot for ${k} at ${x} ${y} ${z}`);
    const r = bs.lay({ b: b.id, k, ...s }, 'me', 0);
    if (typeof r === 'string') throw new Error(`${k}: ${r}`);
    if (t) bs.upgrade(b.id, r.piece.id, t);
    if (open) r.piece.open = true;
    return r.piece;
  };
  at('foundation', 3, 0, 0, 0, 2);
  at('foundation', 6, 0, 0, 0, 2);
  at('foundation', -0.1, 0, 3, 0, 2);
  // (the bench first: the metal fittings need it near)
  const bench = bs.lay({ b: b.id, k: 'workbench', x: 3, y: 0, z: 0, r: 0 }, 'me', 0);
  if (typeof bench === 'string') throw new Error(`workbench: ${bench}`);
  for (const [k, x, z] of [['wall', -1.5, 0], ['wall', 7.5, 0], ['doorway', 0, 1.5], ['window', 3, 1.5], ['wall_frame', 6, 1.5], ['window', 0, -1.5], ['window', 3, -1.5], ['window', 6, -1.5], ['doorway', 1.5, 0], ['wall_frame', 4.5, 0], ['wall', -1.5, 3], ['wall', 1.5, 3], ['doorway', 0, 4.5]] as const) at(k, x, 1.5, z, 0, 2);
  // the airlock: the porch's outer door shut, the front room's door open, the inner metal one shut
  at('door_wood', 0, 1.2, 1.5, 0, undefined, true);
  at('door_wood', 0, 1.2, 4.5, 0);
  at('door_metal', 1.5, 1.2, 0, 1);
  at('double_door_metal', 4.5, 1.2, 0, 0, undefined, true);
  at('garage_door', 6, 1.2, 1.5, 1, undefined, true);
  at('shutters', 3, 1.6, 1.5, 0, undefined, true);
  at('bars_wood', 0, 1.6, -1.5);
  at('embrasure', 3, 1.6, -1.5);
  at('bars_metal', 6, 1.6, -1.5);
  at('floor_frame', 0, 3, 0, 0, 2);
  at('hatch', 0, 3, 0, 0, undefined, true);
  for (const [k, x, z, r] of [['box_small', -0.5, -0.5, 1], ['box_large', 6.5, -0.5, 0]] as const) {
    const q = bs.lay({ b: b.id, k, x, y: 0, z, r }, 'me', 0);
    if (typeof q === 'string') throw new Error(`${k}: ${q}`);
  }
  // high walls with a gate in each run, the wooden one open
  for (const [w, g, x, open] of [['high_wall_wood', 'gate_wood', 0, true], ['high_wall_stone', 'gate_stone', -12, false]] as const) {
    const hw = bs.lay({ k: w, x: 16, y: 0, z: x, r: 0, yaw: 0 }, 'me', 0);
    if (typeof hw === 'string') throw new Error(`${w}: ${hw}`);
    const nb = hw.base, put = (k: string) => {
      const s = spots(nb, k).filter((q) => !blocked(nb, k, q)).sort((a, c) => c.x - a.x)[0];
      const r = s && bs.lay({ b: nb.id, k, ...s }, 'me', 0);
      if (!r || typeof r === 'string') throw new Error(`${k}: ${r ?? 'no spot'}`);
      return r.piece;
    };
    const gate = put(g);
    if (open) gate.open = true;
    put(w);
  }
  return bs;
}

/** a thing as it lies on the ground: its model (or the stand-in made in code), sized and dyed as its item says */
async function itemModel(id: string): Promise<THREE.Object3D> {
  const d = ITEMS[id];
  const parts: MeshPart[] = d.model.startsWith('@') ? proceduralParts(d.model) : extractParts(await assets.model(d.model));
  const g = new THREE.Group();
  for (const p of parts) {
    let mat = p.material;
    if (d.tint !== undefined) {
      mat = (p.material as THREE.MeshStandardMaterial).clone();
      (mat as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(d.tint));
    }
    const m = new THREE.Mesh(p.geometry, mat);
    m.castShadow = true;
    g.add(m);
  }
  g.scale.setScalar(d.scale ?? 1);
  return g;
}

const survivor = async () => {
  const b = cloneSkinned((await assets.loadGLTF('assets/characters/survivor.glb')).scene) as THREE.Group;
  b.traverse((o) => {
    if (o.name.startsWith('gear_')) o.visible = false;
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return b;
};

/** the paints' pictures come a moment after they are made: waited for, or they are drawn black */
const settle = () => new Promise((r) => setTimeout(r, 3000));

function shoot(s: Stage, camera: THREE.PerspectiveCamera, i: number, text: string) {
  const vx = (i % s.cols) * s.cw, vy = (s.rows - 1 - Math.floor(i / s.cols)) * s.ch;
  s.renderer.setViewport(vx, vy, s.cw, s.ch);
  s.renderer.setScissor(vx, vy, s.cw, s.ch);
  s.renderer.render(s.scene, camera);
  s.say(i, text);
}

export async function stageBuild(name: string, s: Stage): Promise<unknown> {
  s.renderer.setScissorTest(true);
  const camera = new THREE.PerspectiveCamera(30, s.cw / s.ch, 0.05, 800);
  if (name === 'items') {
    const ids = (s.q.get('items') ?? 'log,planks,stone,nails,sheet_metal,hand_saw,felling_axe,pickaxe,hatchet').split(',');
    let x = 0;
    const info: Record<string, unknown>[] = [];
    for (const id of ids) {
      const o = await itemModel(id);
      o.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
      o.position.set(x - box.min.x, -box.min.y, -(box.min.z + box.max.z) / 2);
      x += size.x + 0.35;
      s.scene.add(o);
      info.push({ id, size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)] });
    }
    const body = await survivor();
    body.position.set(x + 0.4, 0, 0);
    s.scene.add(body);
    // (framed on the whole row and the survivor, from a little above, and from straight above)
    const wide = x + 1.2, mid = new THREE.Vector3(wide / 2 - 0.3, 0.4, 0);
    s.sun.target.position.copy(mid);
    const d = (wide * 0.52) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    camera.position.set(mid.x, 1.1, d);
    camera.lookAt(mid);
    shoot(s, camera, 0, `side · ${ids.join(', ')}`);
    camera.position.set(mid.x, d * 0.9, 0.01);
    camera.lookAt(mid.x, 0, 0);
    shoot(s, camera, 1, 'top');
    return { things: info };
  }
  if (name === 'fell') {
    const kind = s.q.get('tree') ?? 'pine_a', e = assets.trees[kind];
    const tree: Instance = { kind, x: 0, y: 0, z: 0, rot: 0.6, scale: 1 };
    const gl = await assets.loadGLTF(e.url);
    // (dressed as the forest dresses it, less its wind and its snow: Vegetation.treeMaterials)
    const bark = new THREE.MeshStandardMaterial({ color: e.bark === 'birch' ? 0xe8e6e0 : 0x6e5a46, roughness: 1, ...(e.bark === 'birch' ? { map: assets.texture('assets/trees/birch_color.webp', { srgb: true, repeat: true }) } : {}) });
    const leaves = new THREE.MeshStandardMaterial({ map: assets.texture(`assets/trees/leaf_${e.leaf}.webp`, { srgb: true }), color: e.leaf === 'pine' ? 0x8fa07a : 0x9aab80, alphaTest: Math.max(0.35, e.alphaTest), side: THREE.DoubleSide, roughness: 0.85 });
    const parts = extractParts(gl.scene).map((p) => ({ geometry: p.geometry, material: p.name.startsWith('leaves') ? leaves : bark }));
    const at = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.rot), new THREE.Vector3(1, 1, 1));
    // (the tree as the forest draws it, standing; taken out of the picture when it is felled, as Vegetation.fell does)
    const standing = new THREE.Group();
    for (const p of parts) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = true;
      standing.add(m);
    }
    standing.applyMatrix4(at);
    s.scene.add(standing);
    const felling = new Felling(s.scene, { fell: (_i, down) => void (standing.visible = !down), falling: () => ({ parts, matrix: at.clone() }) }, [tree]);
    const body = await survivor();
    body.position.set(-1.3, 0, 0.2);
    body.rotation.y = Math.PI / 2;
    s.scene.add(body);
    const k = treeOf(tree)!, h = TREE_KINDS[kind].height;
    s.sun.position.set(-10, 30, 18);
    s.sun.target.position.set(h * 0.45, 0, 0);
    s.sun.shadow.camera.left = s.sun.shadow.camera.bottom = -30;
    s.sun.shadow.camera.right = s.sun.shadow.camera.top = 30;
    s.sun.shadow.camera.updateProjectionMatrix();
    camera.fov = 40;
    camera.updateProjectionMatrix();
    camera.position.set(h * 0.42, h * 0.38, h * 1.55);
    camera.lookAt(h * 0.42, h * 0.3, 0);
    shoot(s, camera, 0, `standing · ${kind} · ${k.blows} hatchet blows, ${k.logs} logs`);
    // felled toward +x, the way the axe faces; then its own clock, as the game runs it
    await felling.down([]);
    felling.fell(0, Math.PI / 2, camera.position);
    const moments = [0.8, 1.6, 2.4, 3.0, 3.8, 9];
    let t = 0, cell = 1;
    const logs: THREE.Object3D[] = [];
    for (const m of moments) {
      while (t < m - 1e-6) {
        felling.update(1 / 60);
        t += 1 / 60;
      }
      // (its logs are laid when it is down: TREE.lands)
      if (t >= 3.8 && !logs.length) {
        for (let n = 0; n < k.logs; n++) {
          const o = await itemModel('log');
          o.position.set(1.4 + n * 2.3, 0, 0.5 * (n % 2 ? 1 : -1));
          logs.push(o);
          s.scene.add(o);
        }
        // (their bark's pictures come a moment after: waited for, or they are drawn black)
        await new Promise((r) => setTimeout(r, 2500));
      }
      shoot(s, camera, cell++, `${t.toFixed(1)} s${t >= 8.9 ? ' · gone: the stump and its logs' : t >= 3.7 ? ' · down: its logs laid' : ''}`);
    }
    // (and close: the stump, and the logs to be sawn)
    camera.position.set(2.2, 2.6, 7);
    camera.lookAt(2.2, 0.2, 0);
    shoot(s, camera, cell, 'the stump and the logs, close');
    return { tree: kind, blows: k.blows, logs: k.logs };
  }
  if (name === 'pieces') {
    // every kind in each tier: a row of them on the floor, a cell to a tier
    const kinds = Object.keys(PIECES);
    const draw = new BaseDraw(s.scene, null);
    const far = new THREE.Vector3(1e6, 0, 1e6);
    const shows = kinds.map((k, i) => ({ k, x: (i % 7) * 4.6, z: Math.floor(i / 7) * 5.2 }));
    s.sun.position.set(30, 40, 30);
    s.sun.target.position.set(14, 0, 5);
    s.sun.shadow.camera.left = s.sun.shadow.camera.bottom = -30;
    s.sun.shadow.camera.right = s.sun.shadow.camera.top = 30;
    s.sun.shadow.camera.updateProjectionMatrix();
    for (const t of [0, 1, 2, 3] as Tier[]) {
      draw.clear();
      shows.forEach((q, i) => {
        const base: Base = { id: i + 1, ox: q.x, oy: PIECES[q.k].ground ? 0.6 : PIECES[q.k].role === 'floor' ? 0.25 : PIECES[q.k].role === 'steps' ? 1.4 : 0, oz: q.z, yaw: 0.5, owner: '', pieces: new Map(), next: 2 };
        const p = { id: 1, k: q.k, t, x: 0, y: 0, z: 0, r: 0, hp: 1, at: 0, by: '', on: [] };
        base.pieces.set(1, p);
        draw.put(base, p);
      });
      draw.update(0, far);
      if (t === 0) await settle();
      camera.fov = 34;
      camera.updateProjectionMatrix();
      camera.position.set(13.8, 15, 24);
      camera.lookAt(13.8, 0.5, 5.2);
      shoot(s, camera, t, `${TIERS[t]} · all ${kinds.length} pieces (the high walls come in one tier)`);
    }
    return { kinds: kinds.length };
  }
  if (name === 'base' || name === 'wheel') {
    const bs = sampleBase();
    const draw = new BaseDraw(s.scene, null);
    for (const b of bs.bases.values()) draw.setBase(b);
    draw.update(0, new THREE.Vector3(1e6, 0, 1e6));
    await settle();
    const body = await survivor();
    body.position.set(0.6, 0.25, 3.6);
    s.scene.add(body);
    s.sun.position.set(14, 22, 16);
    s.sun.target.position.set(1, 0, 1);
    s.sun.shadow.camera.left = s.sun.shadow.camera.bottom = -18;
    s.sun.shadow.camera.right = s.sun.shadow.camera.top = 18;
    s.sun.shadow.camera.updateProjectionMatrix();
    camera.fov = 38;
    camera.updateProjectionMatrix();
    const views: [string, [number, number, number], [number, number, number]][] = [
      ['front', [1.5, 3.2, 15], [1.5, 2, 0]],
      ['three-quarter', [13, 8, 12], [1.5, 1.5, 0]],
      ['back', [-6, 6, -12], [1.5, 1.5, 0]],
      ['top', [1.5, 22, 0.5], [1.5, 0, 0]],
    ];
    if (name === 'base') {
      views.forEach(([v, p, l], i) => {
        camera.position.set(...p);
        camera.lookAt(...l);
        shoot(s, camera, i, `${v} · ${[...bs.bases.values()].reduce((n, b) => n + b.pieces.size, 0)} pieces, laid by the rules`);
      });
      return { pieces: [...bs.bases.values()].map((b) => b.pieces.size) };
    }
    // the two wheels over the base: the plan's open on Walls with the doorway lit, the hammer's on a stone wall
    camera.position.set(...views[1][1]);
    camera.lookAt(...views[1][2]);
    shoot(s, camera, 0, 'the wheels: the plan (right button held), the hammer at a stone wall');
    const ui = document.createElement('div');
    ui.style.cssText = `position:fixed;left:0;top:0;width:${s.cw}px;height:${s.ch}px;display:flex;pointer-events:none`;
    document.body.appendChild(ui);
    const wall = [...[...bs.bases.values()][0].pieces.values()].find((p) => p.k === 'wall' && p.t === 2)!;
    for (const [entries, lit, hub] of [[planEntries(1, 'doorway'), outerEntry(outerOf(1).indexOf('doorway')), ['Doorway', '4 planks (23)']], [hammerEntries(wall), 2, ['Metal', '4 sheet metal (6) · 24 nails (40)']]] as const) {
      const half = document.createElement('div');
      half.id = 'hud';
      half.style.cssText = 'position:relative;flex:1;height:100%';
      ui.appendChild(half);
      const r = new Radial({ rings: RINGS, per: entries.length > 16 ? PER : HAMMER_PER, className: 'hud-wheel' });
      r.set([...entries]);
      half.appendChild(r.el);
      r.open();
      r.hub(hub[0], '');
      r.el.appendChild(Object.assign(document.createElement('div'), { className: 'radial-foot', textContent: hub[1] }));
      r.point(lit, [0.3, -0.6]);
    }
    await new Promise((r) => setTimeout(r, 900));
    return { wheels: 2 };
  }
  if (name === 'doors') {
    const bs = doorBase();
    const draw = new BaseDraw(s.scene, null);
    // (and a door's ghost, as the plan shows it, in a doorway of its own: its swing drawn on the floor)
    const g = bs.lay({ k: 'foundation', x: -12, y: 0, z: 1, r: 0, yaw: 0 }, 'me', 0);
    if (typeof g === 'string') throw new Error(g);
    const dw = spots(g.base, 'doorway').find((q) => q.z > 1)!, way = bs.lay({ b: g.base.id, k: 'doorway', ...dw }, 'me', 0);
    if (typeof way === 'string') throw new Error(way);
    bs.upgrade(g.base.id, way.piece.id, 1);
    for (const b of bs.bases.values()) draw.setBase(b);
    draw.update(0, new THREE.Vector3(1e6, 0, 1e6));
    const ghost = new THREE.Mesh(ghostGeometry('door_wood'), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }));
    ghost.position.set(...toWorld(g.base, way.piece.x, way.piece.y, way.piece.z));
    ghost.rotation.y = worldYaw(g.base, way.piece.r);
    s.scene.add(ghost);
    await settle();
    const body = await survivor();
    body.position.set(-0.9, 0.25, 6.2);
    s.scene.add(body);
    s.sun.position.set(12, 24, 18);
    s.sun.target.position.set(2, 0, 3);
    s.sun.shadow.camera.left = s.sun.shadow.camera.bottom = -22;
    s.sun.shadow.camera.right = s.sun.shadow.camera.top = 22;
    s.sun.shadow.camera.updateProjectionMatrix();
    camera.fov = 40;
    camera.updateProjectionMatrix();
    const views: [string, [number, number, number], [number, number, number]][] = [
      ['front: the porch door shut, the room door open, shutters open, a garage door up', [3, 4.2, 15], [3, 1.4, 1.5]],
      ['back: wooden bars, an embrasure, metal bars', [3, 3, -11], [3, 1.6, -1.5]],
      ['from above: the inner metal door shut, a double door open, the hatch up, two boxes and the bench', [3, 17, 4], [3, 0, 0.5]],
      ["inside the middle room, at the airlock's metal door", [4.8, 1.7, -0.6], [0.5, 1.2, 0.4]],
      ['high walls: the wooden gate open, the stone gate shut', [19, 10, 17], [19, 2.5, -6]],
      ["a door's ghost in a doorway: its swing drawn on the floor", [-10.6, 4.6, 6.4], [-12, 0.3, 3]],
    ];
    views.forEach(([v, p, l], i) => {
      camera.position.set(...p);
      camera.lookAt(...l);
      shoot(s, camera, i, v);
    });
    return { pieces: [...bs.bases.values()].map((b) => [...b.pieces.values()].map((p) => `${p.k}${p.open ? '(open)' : ''}`)) };
  }
  throw new Error(`no such base-building scene: ${name}`);
}
