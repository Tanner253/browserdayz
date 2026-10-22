// A finish bought at the store (2026-10-22): the gun's own model, its metal plated in gold or nickel and buffed. The
// owner: "a gold plated desert eagle ... and any other cosmetic ideas you come up with while keeping it realistic", then
// of the first tries, "the gold deagle should be flashier and more golden", "it needs to look like buffed shiny metal"
// and "how can you not make a shiny gold texture i think youre over complicating this".
//
// So it is a shiny gold texture: a picture of a polished ball of the metal (a matcap, painted here), looked up by which
// way each point of the gun faces the eye, laid over the gun's metal. It shines the same under any sky. (Made truly
// metal instead, the guns mirrored the world's reflections, which in the hands' own scene are nothing: they drew black.)
// Only what the model's own maps say is metal is plated, so a grip stays rubber or walnut; the model's own bumps and
// edges still turn the shine. Dimmed with the day, so it does not glow at night. Since PROTOCOL 59 a finish is put on
// one gun and goes with it, Rust's way (server/plates.ts): the gun's own `finish` says what it wears.

import * as THREE from 'three';
import { lookOf } from '../../api/_lib/shop-items';

export type Finish = 'gold' | 'nickel';

/** what this gun wears, by its own word (ItemInstance.finish, the server's) */
export const finishOn = (it: { finish?: string } | null | undefined): Finish | null => lookOf(it?.finish);

/** the polished ball, from its darkest rim to the highlight (sRGB) */
const BALL: Record<Finish, string[]> = {
  gold: ['#3d2606', '#8a5c12', '#d99a1e', '#f5c842', '#ffe58a', '#fffbe6'],
  nickel: ['#2a2c30', '#5d6168', '#a3a8b0', '#d4d8de', '#eef1f5', '#ffffff'],
};
/**
 * What of a gun is metal to be plated: what its metalness map says is, or, for the M9, whose map calls the whole of it
 * painted, what its roughness map says is smoother than its grips (`smooth`: the grips' roughness).
 */
const MASK: Record<string, { smooth: number } | undefined> = { m9: { smooth: 0.43 } };
/** the gun's own materials, by name: the hands and sights drawn with it are left as they are */
const PARTS: Record<string, RegExp> = { deagle: /^(Slide|MainBody|Magazine)$/, m9: /^beretta$/, colt: /^Scene_-_Root$/, knife: /knife/i };

type Register = (m: THREE.Material, patch: (s: THREE.WebGLProgramParametersWithUniforms) => void, key: string) => void;
let world: { register: Register; daylight: { value: number } } | null = null;
/** the world's lighting, which a material lit by its cascaded shadows is registered with (src/world/atmosphere.ts), and how light the day is */
export const finishLighting = (w: NonNullable<typeof world>) => void (world = w);

const balls = new Map<Finish, THREE.Texture>();
/** the polished ball, painted: a dark rim, the metal's colour, a broad light from above left and a hot spot in it */
function ball(f: Finish): THREE.Texture {
  let t = balls.get(f);
  if (t) return t;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!, k = BALL[f];
  x.fillStyle = k[0];
  x.fillRect(0, 0, S, S);
  const body = x.createRadialGradient(S * 0.42, S * 0.36, S * 0.04, S / 2, S / 2, S / 2);
  body.addColorStop(0, k[4]);
  body.addColorStop(0.35, k[3]);
  body.addColorStop(0.7, k[2]);
  body.addColorStop(0.9, k[1]);
  body.addColorStop(1, k[0]);
  x.fillStyle = body;
  x.beginPath();
  x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  x.fill();
  // (a light from below right, as off the ground, and the hot spot of the one above)
  const rim = x.createRadialGradient(S * 0.7, S * 0.78, 0, S * 0.7, S * 0.78, S * 0.22);
  rim.addColorStop(0, k[3]);
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = rim;
  x.fill();
  const hot = x.createRadialGradient(S * 0.36, S * 0.3, 0, S * 0.36, S * 0.3, S * 0.1);
  hot.addColorStop(0, k[5]);
  hot.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = hot;
  x.fill();
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  balls.set(f, t);
  return t;
}

/** from a fifth at night to all of it by day: the shine, as the uniform every plated material shares */
const shine = { value: 1 };
/** a picture's: all of it, whatever the hour (src/ui/icons.ts) */
const FULL = { value: 1 };
/** each frame: the shine kept to the hour */
export function finishDay() {
  shine.value = 0.2 + 0.8 * Math.min(1, Math.max(0, world?.daylight.value ?? 1));
}

function patchOf(f: Finish, mask?: { smooth: number }, lit = shine) {
  const which = mask ? `1.0 - smoothstep(${(mask.smooth - 0.04).toFixed(3)}, ${(mask.smooth + 0.04).toFixed(3)}, roughnessFactor / max(roughness, 0.001))` : 'smoothstep(0.3, 0.6, metalnessFactor / max(metalness, 0.001))';
  const tex = ball(f);
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.uniforms.uPlateBall = { value: tex };
    s.uniforms.uPlateShine = lit;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uPlateBall;\nuniform float uPlateShine;\nfloat plate = 0.0;')
      // (the maps' own word on what is metal, before the material's own numbers scale them)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nplate = ${which};`)
      .replace('#include <opaque_fragment>', `{
        // (the ball looked up by the way this point faces the eye, the model's own bumps in it)
        vec3 seen = texture2D(uPlateBall, normalize(normal).xy * 0.495 + 0.5).rgb;
        outgoingLight = mix(outgoingLight, seen * uPlateShine, plate * 0.92);
      }
      #include <opaque_fragment>`);
  };
}

const made = new Map<string, THREE.Material>();

/** a material plated: one copy for each material and finish, shared by every gun that wears it */
function plated(m: THREE.Material, f: Finish, gun: string, picture = false): THREE.Material {
  const key = `${m.uuid}|${f}${picture ? '|picture' : ''}`;
  let p = made.get(key);
  if (p) return p;
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || !PARTS[gun]?.test(s.name)) return m;
  const c = s.clone();
  c.name = `${s.name}|${f}`;
  const patch = patchOf(f, MASK[gun], picture ? FULL : shine), tag = `${f}|${gun}${picture ? '|picture' : ''}`;
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

/** A whole thing of polished metal, the same shine (the dog tag worn on the chest: src/game/worn-tag.ts). */
export function polished(f: Finish): THREE.MeshMatcapMaterial {
  const m = new THREE.MeshMatcapMaterial({ matcap: ball(f), name: `polished-${f}` });
  m.onBeforeCompile = (s) => {
    s.uniforms.uPlateShine = shine;
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uPlateShine;').replace('#include <opaque_fragment>', 'outgoingLight *= uPlateShine;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'polished';
  return m;
}

/** what each mesh wore before it was plated (not in its userData: a copy of the gun copies that as text) */
const bareOf = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

/** Plate a gun (null: as it came), so that a finish can be taken off again. @param picture for its picture: as bright by night */
export function wearFinish(root: THREE.Object3D, gun: string, f: Finish | null, picture = false) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let bare = bareOf.get(mesh);
    if (!bare) bareOf.set(mesh, (bare = mesh.material));
    mesh.material = f ? (Array.isArray(bare) ? bare.map((m) => plated(m, f, gun, picture)) : plated(bare, f, gun, picture)) : bare;
  });
}
