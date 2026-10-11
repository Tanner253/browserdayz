// Inventory icons rendered from the real 3D models at startup (no hand-made sprites).
// Each item is framed to its grid footprint so the picture fills its cells.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ITEMS } from '../sim/items';
import type { ItemModels } from '../game/loot';
import { BEARD, HAIR_STYLES, loadCharacter, lookPatch, lookUniforms, setLookUniforms, suitPatch, type Look } from '../game/look';
import { BODY_SCALE, GEAR, WORN } from '../game/avatar';

const PX = 64; // pixels per grid cell

export async function renderIcons(renderer: THREE.WebGLRenderer, models: ItemModels, env: THREE.Texture): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.75;
  const key = new THREE.DirectionalLight(0xfff4e6, 1.8);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 0.9);
  rim.position.set(-3, 2, -2);
  scene.add(key, rim);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  const prevTarget = renderer.getRenderTarget();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  // Drawing a thing puts every picture it is painted with on the graphics card, and there they stay: the pictures
  // of every item in the game, most of which are never seen in a given hour, sat there from the first second (with
  // every model at the size it came, some gigabytes of them: more than many cards have). What was put there for
  // these pictures is taken off again when they are made, and goes back the first time the thing itself is drawn.
  const used = new Set<THREE.Texture>(), copies: THREE.Material[] = [];

  for (const [id, def] of Object.entries(ITEMS)) {
    const tpl = await models.get(id);
    const w = def.w * PX, h = def.h * PX;
    const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const obj = tpl.group.clone();
    obj.scale.setScalar(1);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // icon scene has no cascaded shadow lights: use plain material copies
      const src = m.material as THREE.MeshStandardMaterial;
      const c = src.clone();
      if (c.defines) {
        delete c.defines.USE_CSM;
        delete c.defines.CSM_CASCADES;
        delete c.defines.CSM_FADE;
      }
      c.onBeforeCompile = () => {};
      c.customProgramCacheKey = () => 'icon';
      // Loose rounds are brass, and brass is all shine: under this light it is a mirror of a dim sky, and the
      // pictures of every round were dark brown. In its picture a round is given less of the mirror and more of its
      // own colour, lit up: brass that reads as brass, and the bullet's tip to be told from its case.
      if (def.category === 'ammo' && def.stack) {
        c.metalness = Math.min(c.metalness, 0.5);
        c.metalnessMap = null;
        c.roughness = Math.max(c.roughness, 0.4);
        c.roughnessMap = null;
        c.envMapIntensity = 1.6;
      }
      for (const t of [src.map, src.normalMap, src.roughnessMap, src.metalnessMap, src.aoMap, src.emissiveMap, src.alphaMap]) if (t) used.add(t);
      copies.push(c);
      m.material = c;
    });
    const pivot = new THREE.Group();
    pivot.add(obj);
    // orient so the item's longest horizontal axis runs along the icon's long side
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const iconLandscape = def.w >= def.h;
    const modelLong = size.x >= size.z ? 'x' : 'z';
    const upright = size.y > Math.max(size.x, size.z) * 1.2;
    // What is worn stands as it is worn, whatever the shape of its place in a pocket: a vest three cells wide and
    // two tall was laid on its side to fill them, and was a vest on its side in the vest's own slot.
    const worn = def.category === 'clothing';
    if (def.mag) {
      // A magazine stands on its end, the end that goes into the gun uppermost, its broad side to the eye, whatever
      // the shape of its place in a pocket. It lies on its side in the world, and by the rules below was drawn on
      // its side, on its head, or across a tall picture, one magazine one way and the next another. Its longest
      // side is stood up, its thinnest turned to the eye. (As they are laid in the world the top of every one of
      // them is toward the low end of the axis it lies along: that end is put uppermost. Looked at, 2026-10-10: the
      // round in each is at the top.)
      const dims: [number, 'x' | 'y' | 'z'][] = [[size.x, 'x'], [size.y, 'y'], [size.z, 'z']];
      dims.sort((p, q) => q[0] - p[0]);
      const unit = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
      const up = unit[dims[0][1]].clone().multiplyScalar(dims[0][1] === 'y' ? 1 : -1), side = unit[dims[1][1]].clone();
      const out = new THREE.Vector3().crossVectors(side, up);
      // (what takes the model's own axes to the picture's: the inverse of the frame made of where each is to go)
      pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, out).invert());
    } else {
      if (upright && iconLandscape && def.w > def.h && !worn) pivot.rotation.z = Math.PI / 2;
      if (!upright && !iconLandscape) pivot.rotation.x = Math.PI / 2;
      if (modelLong === 'z' && !upright) pivot.rotation.y = Math.PI / 2;
      pivot.rotation.y += 0.35;
      // something as flat as a dog tag is looked at from above, or it is only a sliver
      const flat = size.y < Math.min(size.x, size.z) * 0.1;
      pivot.rotation.x += upright ? 0.15 : flat ? 1.15 : 0.55;
    }
    // (in a frame of its own, which is what is turned if the turns above left it across the picture)
    const frame = new THREE.Group();
    frame.add(pivot);
    // (a magazine is looked at a little from one side and a little from above, as a thing stood on a table is)
    if (def.mag) frame.rotation.set(0.12, 0.45, 0);
    scene.add(frame);
    frame.updateMatrixWorld(true);
    let b2 = new THREE.Box3().setFromObject(frame);
    let s2 = b2.getSize(new THREE.Vector3());
    // However the model lies as it comes, its long side goes along the picture's long side. (A
    // bat comes lying along x and is six cells tall: it was drawn across the middle of its
    // picture, a hair's width of it, and looked like no picture at all.)
    const across = s2.x > s2.y * 1.3, along = s2.y > s2.x * 1.3;
    if (!def.mag && ((across && h > w) || (along && w > h && !worn))) {
      frame.rotation.z = across ? Math.PI / 2 : -Math.PI / 2;
      frame.updateMatrixWorld(true);
      b2 = new THREE.Box3().setFromObject(frame);
      s2 = b2.getSize(new THREE.Vector3());
    }
    const c2 = b2.getCenter(new THREE.Vector3());
    const aspect = w / h;
    const half = Math.max(s2.x / 2, s2.y / 2 * aspect) * 1.08;
    cam.left = -half;
    cam.right = half;
    cam.top = half / aspect;
    cam.bottom = -half / aspect;
    cam.position.set(c2.x, c2.y, c2.z + 10);
    cam.lookAt(c2);
    cam.updateProjectionMatrix();

    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const buf = new Uint8Array(w * 2 * h * 2 * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, buf);
    canvas.width = w * 2;
    canvas.height = h * 2;
    const img = ctx.createImageData(w * 2, h * 2);
    // flip rows (GL origin is bottom-left)
    for (let y = 0; y < h * 2; y++) img.data.set(buf.subarray((h * 2 - 1 - y) * w * 2 * 4, (h * 2 - y) * w * 2 * 4), y * w * 2 * 4);
    ctx.putImageData(img, 0, 0);
    out[id] = canvas.toDataURL('image/png');
    scene.remove(frame);
    rt.dispose();
  }
  renderer.setRenderTarget(prevTarget);
  for (const t of used) t.dispose();
  for (const c of copies) c.dispose();
  return out;
}

/**
 * Portrait of the survivor for the inventory screen's paper doll (transparent PNG data URL).
 * @param worn what is in the slots that show on a body (head, vest, back): the portrait wears it
 * @param models where a pack's own model comes from (the cap, the headset and the plate carrier are pieces of the body itself)
 */
export async function renderDoll(renderer: THREE.WebGLRenderer, env: THREE.Texture, look: Look, worn: string[] = [], models?: ItemModels): Promise<string> {
  const gltf = await loadCharacter();
  const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
  model.updateMatrixWorld(true);
  const suit = !!model.getObjectByName('pads');
  const shown = new Set(worn.flatMap((id) => WORN[id] ?? []));
  // a pack hangs where it hangs on a body in the world: set on the body as it stands at rest, and carried by the spine from there
  const carried: THREE.Object3D[] = [];
  if (models) {
    for (const id of worn) {
      const g = GEAR[id], bone = g && model.getObjectByName(g.bone);
      if (!g || !bone) continue;
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      // (GEAR is written for a body in the world: turned to face the way the game faces, and at the game's size. This one is as its file has it.)
      const place = new THREE.Matrix4().compose(new THREE.Vector3(...g.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(g.r[0], g.r[1], g.r[2], 'XYZ')), new THREE.Vector3(...g.s));
      const toFile = new THREE.Matrix4().makeScale(1 / BODY_SCALE, 1 / BODY_SCALE, 1 / BODY_SCALE).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      holder.matrix.copy(bone.matrixWorld).invert().multiply(toFile).multiply(place);
      holder.add((await models.get(id)).group.clone());
      bone.add(holder);
      carried.push(holder);
    }
  }
  // one hair style (and maybe a beard), carried by the head
  const head = model.getObjectByName('Head');
  [...HAIR_STYLES, BEARD].forEach((name, i) => {
    const o = model.getObjectByName(name);
    if (!o) return;
    head?.attach(o);
    o.visible = name === BEARD ? look.beard : i === look.hair;
  });
  const uniforms = lookUniforms();
  setLookUniforms(uniforms, look);
  const own: THREE.Material[] = [];
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    // (the pieces of the suit that are worn or not: only what is worn)
    if (m.name.startsWith('gear_') && !shown.has(m.name)) m.visible = false;
    const c = (m.material as THREE.MeshStandardMaterial).clone();
    if (c.defines) {
      delete c.defines.USE_CSM;
      delete c.defines.CSM_CASCADES;
      delete c.defines.CSM_FADE;
    }
    if (suit && m.isSkinnedMesh) {
      c.onBeforeCompile = (shader) => suitPatch(shader, uniforms);
      c.customProgramCacheKey = () => 'doll-suit';
    } else if (m.name === 'body') {
      c.onBeforeCompile = (shader) => lookPatch(shader, uniforms);
      c.customProgramCacheKey = () => 'doll';
    } else if (c.name.includes('Hair')) c.color.copy(look.hairColor);
    else {
      c.onBeforeCompile = () => {};
      c.customProgramCacheKey = () => 'icon';
    }
    m.material = c;
    own.push(c);
  });
  const idle = gltf.animations.find((a) => a.name === 'idle');
  if (idle) {
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(idle).play();
    mixer.update(0.4);
  }
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(2.5, 3.5, 4);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 1.4);
  rim.position.set(-3, 2.5, -3);
  scene.add(key, rim, model);
  // the model faces +Z: turn it a little so it reads as a figure, not a mugshot
  model.rotation.y = -0.35;
  model.updateMatrixWorld(true);
  const W = 420, H = 840;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const cam = new THREE.OrthographicCamera(-0.52, 0.52, 1.93, -0.15, 0.01, 50);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.setRenderTarget(prev);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  ctx.putImageData(img, 0, 0);
  rt.dispose();
  for (const m of own) m.dispose();
  return canvas.toDataURL('image/png');
}
