// Inventory icons rendered from the real 3D models at startup (no hand-made sprites).
// Each item is framed to its grid footprint so the picture fills its cells.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../core/assets';
import { ITEMS } from '../sim/items';
import type { ItemModels } from '../game/loot';

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
    pivot.rotation.x += upright ? 0.15 : 0.55;
    scene.add(pivot);
    pivot.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(pivot);
    const c2 = b2.getCenter(new THREE.Vector3());
    const s2 = b2.getSize(new THREE.Vector3());
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
    scene.remove(pivot);
    rt.dispose();
  }
  renderer.setRenderTarget(prevTarget);
  return out;
}

/** Portrait of the survivor for the inventory screen's paper doll (transparent PNG data URL). */
export async function renderDoll(renderer: THREE.WebGLRenderer, env: THREE.Texture): Promise<string> {
  const gltf = await assets.loadGLTF('assets/characters/soldier.glb');
  const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    const c = (m.material as THREE.MeshStandardMaterial).clone();
    if (c.defines) {
      delete c.defines.USE_CSM;
      delete c.defines.CSM_CASCADES;
      delete c.defines.CSM_FADE;
    }
    const visor = m.name.toLowerCase().includes('visor');
    if (visor) c.color.set(0x1a1c1a);
    c.roughness = Math.max(0.7, c.roughness);
    c.metalness = 0;
    // same worn olive drab as the in-world body
    c.onBeforeCompile = (shader) => {
      if (visor) return;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 0.15) * vec3(0.5, 0.55, 0.4) * (0.35 + 0.5 * l);
}`,
      );
    };
    c.customProgramCacheKey = () => (visor ? 'doll-visor' : 'doll');
    m.material = c;
  });
  const idle = gltf.animations.find((a) => a.name === 'Idle');
  if (idle) {
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(idle).play();
    mixer.update(0.4);
  }
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(2.5, 3.5, -4);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 1.4);
  rim.position.set(-3, 2.5, 3);
  scene.add(key, rim, model);
  // the rig faces -Z: turn it a little so it reads as a figure, not a mugshot
  model.rotation.y = 0.35;
  model.updateMatrixWorld(true);
  const W = 420, H = 840;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const cam = new THREE.OrthographicCamera(-0.52, 0.52, 1.93, -0.15, 0.01, 50);
  cam.position.set(0, 0, -10);
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
  return canvas.toDataURL('image/png');
}
