// A finish bought at the store (2026-10-22): the gun's own model, its metal plated in gold or nickel and buffed. The
// owner: "a gold plated desert eagle ... and any other cosmetic ideas you come up with while keeping it realistic", then
// of the first tries, "the gold deagle should be flashier and more golden" and "it needs to look like buffed shiny
// metal". Plated as a real one is: only what the model's own maps say is metal takes the plate, so a grip stays rubber
// or walnut. No texture of its own: the model's are used as they are.
//
// Buffed metal is a mirror, and a mirror is what it reflects. The world's sky, which every other metal reflects, is
// dark below its horizon: a gun made wholly metal against it mirrored that, and was black; less metal, it was a matt
// tan. So the plate reflects a lit room of its own (three's RoomEnvironment: a lighting set, not a model), the way a
// polished thing is seen at its best, and that reflection is turned down as the day goes, so it never glows at night.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Finish = 'gold' | 'nickel';

/** the plate's colour as metal reflects it (linear light: polished gold, and nickel) */
const PLATE: Record<Finish, THREE.Color> = { gold: new THREE.Color(1, 0.7, 0.26), nickel: new THREE.Color(0.78, 0.78, 0.8) };
/** how much of the room it reflects, at noon */
const SHINE: Record<Finish, number> = { gold: 1.15, nickel: 1.0 };
/**
 * What of a gun is metal to be plated: what its metalness map says is, or, for the M9, whose map calls the whole of it
 * painted, what its roughness map says is smoother than its grips (`smooth`: the grips' roughness).
 */
const MASK: Record<string, { smooth: number } | undefined> = { m9: { smooth: 0.43 } };
/** the gun's own materials, by name: the hands and sights drawn with it are left as they are */
const PARTS: Record<string, RegExp> = { deagle: /^(Slide|MainBody|Magazine)$/, m9: /^beretta$/, colt: /^Scene_-_Root$/, knife: /knife/i };

type Register = (m: THREE.Material, patch: (s: THREE.WebGLProgramParametersWithUniforms) => void, key: string) => void;
let world: { register: Register; renderer: THREE.WebGLRenderer; daylight: { value: number } } | null = null;
let room: THREE.Texture | null = null;
/** the world's lighting, which a material lit by its cascaded shadows is registered with (src/world/atmosphere.ts), and how light the day is */
export function finishLighting(w: NonNullable<typeof world>) {
  world = w;
  // (anything polished before there was a renderer to make the room with: the tags on bodies made before the guns)
  for (const [m] of shining) {
    if (m.envMap) continue;
    m.envMap = roomMap();
    m.needsUpdate = true;
  }
}

function roomMap() {
  if (!room && world) {
    const pmrem = new THREE.PMREMGenerator(world.renderer);
    room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return room;
}

function patchOf(f: Finish, mask?: { smooth: number }) {
  const c = PLATE[f];
  const which = mask ? `1.0 - smoothstep(${(mask.smooth - 0.04).toFixed(3)}, ${(mask.smooth + 0.04).toFixed(3)}, roughnessFactor / max(roughness, 0.001))` : 'smoothstep(0.3, 0.6, metalnessFactor / max(metalness, 0.001))';
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.fragmentShader = s.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      {
        // (the maps' own word on what is metal, before the material's own numbers scale them)
        float plate = ${which};
        // (the paint's marks still in it, faintly: wear, edges, the stamping)
        float paint = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 3.0, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}) * mix(0.82, 1.0, paint), plate);
        metalnessFactor = mix(metalnessFactor, 1.0, plate);
        // (buffed: near a mirror, a little of the map's own roughness left in it)
        roughnessFactor = mix(roughnessFactor, 0.07 + 0.18 * roughnessFactor / max(roughness, 0.001), plate);
      }`);
  };
}

const made = new Map<string, THREE.Material>();
/** each plated material and how much of the room it reflects at noon: turned down as the day goes (finishDay) */
const shining: [THREE.MeshStandardMaterial, number][] = [];

/** a material plated: one copy for each material and finish, shared by every gun that wears it */
function plated(m: THREE.Material, f: Finish, gun: string): THREE.Material {
  const key = `${m.uuid}|${f}`;
  let p = made.get(key);
  if (p) return p;
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || !PARTS[gun]?.test(s.name)) return m;
  const c = s.clone();
  c.name = `${s.name}|${f}`;
  c.envMap = roomMap();
  c.envMapIntensity = SHINE[f] * dayShine();
  shining.push([c, SHINE[f]]);
  const patch = patchOf(f, MASK[gun]), tag = `${f}|${gun}`;
  // (lit in the world under cascaded shadows: the lighting composes its own hook with the plate's; in the hands' own
  // scene, plain: see plainMaterial in weapons.ts)
  if (s.defines?.USE_CSM && world) world.register(c, patch, tag);
  else {
    const was = s.customProgramCacheKey();
    c.onBeforeCompile = patch;
    c.customProgramCacheKey = () => `${was}|${tag}`;
  }
  made.set(key, (p = c));
  return p;
}

/** from a fifth of it at night to all of it by day */
const dayShine = () => 0.2 + 0.8 * Math.min(1, Math.max(0, world?.daylight.value ?? 1));
let lastDay = -1;
/** each frame: the plate's reflection kept to the hour */
export function finishDay() {
  const d = dayShine();
  if (Math.abs(d - lastDay) < 0.01) return;
  lastDay = d;
  for (const [m, at] of shining) m.envMapIntensity = at * d;
}

/**
 * A whole thing of polished metal, under the same room as the plate (the dog tag worn on the chest: src/game/worn-tag.ts).
 * Registered with the world's lighting by whoever uses it.
 */
export function polished(f: Finish, roughness: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: PLATE[f], metalness: 1, roughness, envMap: roomMap(), envMapIntensity: SHINE[f] * dayShine(), name: `polished-${f}` });
  shining.push([m, SHINE[f]]);
  return m;
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
