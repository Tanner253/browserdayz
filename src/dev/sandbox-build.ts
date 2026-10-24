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
export const BUILD_CELLS: Record<string, number> = { items: 2, fell: 8 };

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
  throw new Error(`no such base-building scene: ${name}`);
}
