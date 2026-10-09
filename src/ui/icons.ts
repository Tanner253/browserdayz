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
    if (upright && iconLandscape && def.w > def.h) pivot.rotation.z = Math.PI / 2;
    if (!upright && !iconLandscape) pivot.rotation.x = Math.PI / 2;
    if (modelLong === 'z' && !upright) pivot.rotation.y = Math.PI / 2;
    pivot.rotation.y += 0.35;
    // something as flat as a dog tag is looked at from above, or it is only a sliver
    const flat = size.y < Math.min(size.x, size.z) * 0.1;
    pivot.rotation.x += upright ? 0.15 : flat ? 1.15 : 0.55;
    // (in a frame of its own, which is what is turned if the turns above left it across the picture)
    const frame = new THREE.Group();
    frame.add(pivot);
    scene.add(frame);
    frame.updateMatrixWorld(true);
    let b2 = new THREE.Box3().setFromObject(frame);
    let s2 = b2.getSize(new THREE.Vector3());
    // However the model lies as it comes, its long side goes along the picture's long side. (A
    // bat comes lying along x and is six cells tall: it was drawn across the middle of its
    // picture, a hair's width of it, and looked like no picture at all.)
    const across = s2.x > s2.y * 1.3, along = s2.y > s2.x * 1.3;
    if ((across && h > w) || (along && w > h)) {
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
