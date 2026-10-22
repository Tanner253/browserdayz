// A finish bought at the store (2026-10-22): the gun's own model, its metal plated in gold or nickel. The owner: "a gold
// plated desert eagle ... and any other cosmetic ideas you come up with while keeping it realistic". Plated as a real
// one is: only what the model's own metalness map says is metal takes the plate, so a grip stays rubber or walnut, and
// the paint's marks and wear show through it (the plate's brightness follows the paint's). No texture of its own: the
// model's are used as they are.

import * as THREE from 'three';

export type Finish = 'gold' | 'nickel';

const PLATE: Record<Finish, THREE.Color> = { gold: new THREE.Color(1, 0.74, 0.3), nickel: new THREE.Color(0.9, 0.92, 0.95) };
/** how far each gun's paint is lifted under the plate: the Desert Eagle is painted bright steel, the rest near black */
const LIFT: Record<string, number> = { deagle: 2.1, m9: 5, colt: 4, knife: 2.4 };
const SMOOTH: Record<Finish, number> = { gold: 0.62, nickel: 0.5 };
/** the gun's own materials, by name: the hands and sights drawn with it are left as they are */
const PARTS: Record<string, RegExp> = { deagle: /^(Slide|MainBody|Magazine)$/, m9: /^beretta$/, colt: /^Scene_-_Root$/, knife: /knife/i };

type Register = (m: THREE.Material, patch: (s: THREE.WebGLProgramParametersWithUniforms) => void, key: string) => void;
let register: Register | null = null;
/** the world's lighting, which a material lit by its cascaded shadows must be registered with (src/world/atmosphere.ts) */
export const finishLighting = (r: Register) => void (register = r);

function patchOf(f: Finish, lift: number) {
  const c = PLATE[f];
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.fragmentShader = s.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      {
        // (the map's own word on what is metal, before the material's own number scales it)
        float plate = smoothstep(0.3, 0.6, metalnessFactor / max(metalness, 0.001));
        float paint = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}) * clamp(0.18 + ${lift.toFixed(2)} * paint, 0.0, 1.05), plate);
        // (as metal as it was painted, no more: made wholly metal it took its colour from the sky alone, which in the
        // hands' own scene and under the world's lamps is next to nothing, and was black)
        roughnessFactor = mix(roughnessFactor, roughnessFactor * ${SMOOTH[f].toFixed(2)}, plate);
      }`);
  };
}

const made = new Map<string, THREE.Material>();

/** a material plated: one copy for each material and finish, shared by every gun that wears it */
function plated(m: THREE.Material, f: Finish, gun: string): THREE.Material {
  const key = `${m.uuid}|${f}`;
  let p = made.get(key);
  if (p) return p;
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || !PARTS[gun]?.test(s.name)) return m;
  const c = s.clone();
  c.name = `${s.name}|${f}`;
  const patch = patchOf(f, LIFT[gun] ?? 3), tag = `${f}|${gun}`;
  // (lit in the world under cascaded shadows: the lighting composes its own hook with the plate's; in the hands' own
  // scene, plain: see plainMaterial in weapons.ts)
  if (s.defines?.USE_CSM && register) register(c, patch, tag);
  else {
    const was = s.customProgramCacheKey();
    c.onBeforeCompile = patch;
    c.customProgramCacheKey = () => `${was}|${tag}`;
  }
  made.set(key, (p = c));
  return p;
}

/** what each mesh wore before it was plated (not in its userData: a copy of the gun copies that as text) */
const bareOf = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

/** Plate a gun (null: as it came), so that a finish can be taken off again. */
export function wearFinish(root: THREE.Object3D, gun: string, f: Finish | null) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let bare = bareOf.get(mesh);
    if (!bare) bareOf.set(mesh, (bare = mesh.material));
    mesh.material = f ? (Array.isArray(bare) ? bare.map((m) => plated(m, f, gun)) : plated(bare, f, gun)) : bare;
  });
}
