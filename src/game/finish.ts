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

// The knives' finishes (2026-10-25, the owner: "emerald blades and ruby etc.. cool stuff") are the same plate with a
// pattern in it, painted here too: no picture is downloaded. The pattern is laid on the thing's own shape from three
// sides (so a blade's flat takes it whole, whatever way its maker's UVs run), so many times along its length. Night camo
// is paint, not plate: matte, lit by the sky as the rest of the knife is.

import * as THREE from 'three';
import { lookOf, type Look } from '../../api/_lib/shop-items';

export type Finish = Look;

/** what this gun wears, by its own word (ItemInstance.finish, the server's) */
export const finishOn = (it: { finish?: string } | null | undefined): Finish | null => lookOf(it?.finish);

/** the polished ball, from its darkest rim to the highlight (sRGB); none for a matte paint */
const BALL: Record<Finish, string[] | null> = {
  gold: ['#3d2606', '#8a5c12', '#d99a1e', '#f5c842', '#ffe58a', '#fffbe6'],
  nickel: ['#2a2c30', '#5d6168', '#a3a8b0', '#d4d8de', '#eef1f5', '#ffffff'],
  emerald: ['#00140a', '#01522d', '#039a55', '#19d27c', '#86ffc6', '#eafff4'],
  ruby: ['#140003', '#4f000c', '#9c0016', '#e3102f', '#ff7088', '#ffe8ec'],
  damascus: ['#191b1e', '#3b3f45', '#767c85', '#b1b7bf', '#dce1e7', '#ffffff'],
  carbon: ['#060607', '#16171a', '#2c2f35', '#4d525a', '#80868f', '#c4c9d1'],
  nightcamo: null,
};
/** a pattern in the finish: how many times it goes along the thing's longest side, and how it is painted (see PAINT) */
const PATTERN: Partial<Record<Finish, number>> = { emerald: 2.2, ruby: 2.2, damascus: 1.2, carbon: 5, nightcamo: 1.4 };
/**
 * What of a gun is metal to be plated: what its metalness map says is, or, for the M9, whose map calls the whole of it
 * painted, what its roughness map says is smoother than its grips (`smooth`: the grips' roughness).
 */
const MASK: Record<string, { smooth: number } | undefined> = { m9: { smooth: 0.43 } };
/** the gun's own materials, by name: the hands and sights drawn with it are left as they are */
const PARTS: Record<string, RegExp> = { deagle: /^(Slide|MainBody|Magazine)$/, m9: /^beretta$/, colt: /^Scene_-_Root$/, knife: /knife/i, karambit: /./ };

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
  const x = c.getContext('2d')!, k = BALL[f]!;
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

/** value noise that repeats every `p` cells, so a pattern painted from it tiles; 0..1 */
function noise(x: number, y: number, p: number, seed: number) {
  const h = (i: number, j: number) => {
    const n = Math.sin(((((i % p) + p) % p) * 127.1 + (((j % p) + p) % p) * 311.7 + seed * 74.7)) * 43758.5453;
    return n - Math.floor(n);
  };
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
}
/** several of them, each twice as fine and half as strong, over one tile (`u`, `v` in 0..1); 0..1 */
function fbm(u: number, v: number, p: number, seed: number, octaves = 4) {
  let s = 0, a = 0.5, w = 0;
  for (let o = 0; o < octaves; o++, a *= 0.5, p *= 2) {
    s += a * noise(u * p, v * p, p, seed + o);
    w += a;
  }
  return s / w;
}
/**
 * Each pattern, a tile of it, as a brightness (or a colour, for the paint) at each point (`u`, `v` in 0..1):
 *   gems     – the light and dark of a polished stone swirled through the metal, as a knife "of" one is drawn
 *   damascus – layers of folded steel, bright and dark, waving along the blade
 *   carbon   – a two-by-two twill of black tows, each catching the light across its width
 *   camo     – four dark greens laid in blots, for night
 */
const PAINT: Partial<Record<Finish, (u: number, v: number) => [number, number, number]>> = {
  emerald: (u, v) => gem(u, v, 3),
  ruby: (u, v) => gem(u, v, 9),
  damascus: (u, v) => {
    const warp = fbm(u, v, 3, 5) * 3 + fbm(u, v, 8, 6) * 0.6;
    const band = 0.5 + 0.5 * Math.sin((v * 26 + warp * 2) * Math.PI * 2);
    const k = 0.3 + 0.2 * band + 0.55 * Math.pow(band, 12);
    return [k, k, k];
  },
  carbon: (u, v) => {
    const n = 16, x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y);
    const across = ((i + j) & 3) < 2, f = across ? y - j : x - i;
    const k = 0.25 + 0.75 * Math.pow(Math.sin(Math.PI * f), 0.7) * (0.85 + 0.15 * noise(x * 8, y * 8, n * 8, 2));
    return [k, k, k];
  },
  nightcamo: (u, v) => {
    const a = fbm(u, v, 3, 11), b = fbm(u, v, 4, 17);
    const c = a > 0.58 ? [0.07, 0.085, 0.06] : b > 0.55 ? [0.16, 0.2, 0.13] : a < 0.4 ? [0.24, 0.28, 0.19] : [0.11, 0.13, 0.09];
    return c as [number, number, number];
  },
};
function gem(u: number, v: number, seed: number): [number, number, number] {
  const swirl = fbm(u + 0.35 * fbm(u, v, 2, seed + 1), v + 0.35 * fbm(u, v, 2, seed + 2), 3, seed);
  // (deep where the stone is thick, bright where it is thin, and veined with light through it)
  const vein = Math.pow(Math.abs(Math.sin(swirl * 16)), 4);
  const k = (0.12 + 1.0 * THREE.MathUtils.smoothstep(swirl, 0.38, 0.66)) * (0.7 + 0.6 * vein);
  return [k, k, k];
}
const patterns = new Map<Finish, THREE.Texture>();
/** a finish's pattern, painted once (256 a side: it repeats) */
function pattern(f: Finish): THREE.Texture | null {
  const paint = PAINT[f];
  if (!paint) return null;
  let t = patterns.get(f);
  if (t) return t;
  const S = 256, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = paint(x / S, y / S), o = (y * S + x) * 4;
      // (a paint is a colour, sRGB; a plate's pattern a brightness, kept as it is)
      for (let k = 0; k < 3; k++) data[o + k] = Math.round(Math.min(1, c[k]) * 255);
      data[o + 3] = 255;
    }
  t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (!BALL[f]) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  patterns.set(f, t);
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

function patchOf(f: Finish, mask?: { smooth: number }, lit = shine, scale = 1) {
  const which = mask ? `1.0 - smoothstep(${(mask.smooth - 0.04).toFixed(3)}, ${(mask.smooth + 0.04).toFixed(3)}, roughnessFactor / max(roughness, 0.001))` : 'smoothstep(0.3, 0.6, metalnessFactor / max(metalness, 0.001))';
  const tex = BALL[f] ? ball(f) : null, pat = pattern(f);
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.uniforms.uPlateShine = lit;
    let head = 'uniform float uPlateShine;\nfloat plate = 0.0;';
    if (tex) {
      s.uniforms.uPlateBall = { value: tex };
      head += '\nuniform sampler2D uPlateBall;';
    }
    if (pat) {
      // (the pattern on the thing's own shape, from whichever side faces most this way: a blade's flat takes it whole)
      s.uniforms.uPlatePat = { value: pat };
      s.uniforms.uPlateScale = { value: scale };
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uPlateScale;\nvarying vec3 vPlateP;\nvarying vec3 vPlateN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlateP = position * uPlateScale;\nvPlateN = normal;');
      head += `
        uniform sampler2D uPlatePat;
        varying vec3 vPlateP;
        varying vec3 vPlateN;
        vec3 platePat() {
          vec3 w = pow(abs(normalize(vPlateN)), vec3(4.0));
          w /= w.x + w.y + w.z + 1e-5;
          return texture2D(uPlatePat, vPlateP.zy).rgb * w.x + texture2D(uPlatePat, vPlateP.xz).rgb * w.y + texture2D(uPlatePat, vPlateP.xy).rgb * w.z;
        }`;
    }
    // (a paint goes on as the maps say what is metal, and is lit as the rest is: no plate over it)
    const paint = tex ? '' : '\ndiffuseColor.rgb = mix(diffuseColor.rgb, platePat(), plate);\nmetalnessFactor *= 1.0 - plate;\nroughnessFactor = mix(roughnessFactor, 0.78, plate);';
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${head}`)
      // (the maps' own word on what is metal, before the material's own numbers scale them)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nplate = ${which};${paint}`);
    if (tex)
      s.fragmentShader = s.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
        // (the ball looked up by the way this point faces the eye, the model's own bumps in it)
        vec3 seen = texture2D(uPlateBall, normalize(normal).xy * 0.495 + 0.5).rgb${pat ? ' * platePat()' : ''};
        outgoingLight = mix(outgoingLight, seen * uPlateShine, plate * 0.92);
      }
      #include <opaque_fragment>`,
      );
  };
}

const made = new Map<string, THREE.Material>();

/** a material plated: one copy for each material and finish, shared by every gun that wears it */
function plated(m: THREE.Material, f: Finish, gun: string, picture = false, scale = 1): THREE.Material {
  const key = `${m.uuid}|${f}${picture ? '|picture' : ''}|${scale.toPrecision(3)}`;
  let p = made.get(key);
  if (p) return p;
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || !PARTS[gun]?.test(s.name)) return m;
  const c = s.clone();
  c.name = `${s.name}|${f}`;
  const patch = patchOf(f, MASK[gun], picture ? FULL : shine, scale), tag = `${f}|${gun}${picture ? '|picture' : ''}`;
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
const _size = new THREE.Vector3();

/** Plate a gun (null: as it came), so that a finish can be taken off again. @param picture for its picture: as bright by night */
export function wearFinish(root: THREE.Object3D, gun: string, f: Finish | null, picture = false) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let bare = bareOf.get(mesh);
    if (!bare) bareOf.set(mesh, (bare = mesh.material));
    // (a pattern goes so many times along the thing's longest side, in whatever units its maker drew it in)
    let scale = 1;
    if (f && PATTERN[f]) {
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const d = g.boundingBox!.getSize(_size);
      scale = PATTERN[f]! / Math.max(d.x, d.y, d.z, 1e-6);
    }
    mesh.material = f ? (Array.isArray(bare) ? bare.map((m) => plated(m, f, gun, picture, scale)) : plated(bare, f, gun, picture, scale)) : bare;
  });
}
