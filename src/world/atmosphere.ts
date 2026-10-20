// Sky, sun, image-based lighting, cascaded shadows and height fog.
//
// The sun direction is recovered from the HDRI itself (brightest texel) so the
// directional light always lines up with the sun in the sky. The sun is then
// clamped out of the environment map before PMREM filtering so direct light is
// not counted twice (once by the light, once by the IBL).

import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { assets } from '../core/assets';
import { LEAN, TOUCH } from '../core/device';
import { GAS, type GasCloud, type GasZone } from '../sim/gas';

/**
 * The sharp sky put on the graphics card and made into the box of six sides it is drawn as, a little at a time
 * (2026-10-20, found playing the game through: the frame it came in was a second long, 139 MB sent in it). three does
 * all of it in the frame the sky is first drawn: the picture (67 MB) sent whole, then the six sides drawn from it at
 * once. Here the picture goes in strips (src/core/strips.ts) and the sides one a frame, each drawn as three draws
 * them (WebGLCubeRenderTarget.fromEquirectangularTexture: the same shader, the same size), and the box is what is
 * hung. (The picture is upside down as it is kept, and is turned the right way up as it is sent: sent in strips, each
 * strip was turned over on its own, and the sky came out in bands, the owner, "the sky was so ugly". It goes the way
 * it is kept, and is read turned over where the sides are drawn.)
 */
export async function skyBox(renderer: THREE.WebGLRenderer, eq: THREE.DataTexture): Promise<THREE.Texture> {
  const turned = eq.flipY;
  eq.flipY = false;
  const onCard = (await assets.strips?.put(eq, 1, () => true)) ?? eq;
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  const rt = new THREE.WebGLCubeRenderTarget((eq.image as { height: number }).height, { type: eq.type, colorSpace: eq.colorSpace as THREE.ColorSpace, magFilter: eq.magFilter });
  rt.texture.minFilter = eq.minFilter;
  rt.texture.generateMipmaps = false;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(5, 5, 5),
    new THREE.ShaderMaterial({
      name: 'CubemapFromEquirect',
      uniforms: { tEquirect: { value: onCard } },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDirection;
        vec3 transformDirection( in vec3 dir, in mat4 matrix ) { return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz ); }
        void main() {
          vWorldDirection = transformDirection( position, modelMatrix );
          #include <begin_vertex>
          #include <project_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tEquirect;
        varying vec3 vWorldDirection;
        #include <common>
        void main() {
          vec2 uv = equirectUv( normalize( vWorldDirection ) );
          ${turned ? 'uv.y = 1.0 - uv.y;' : ''}
          gl_FragColor = texture2D( tEquirect, uv );
        }`,
      side: THREE.BackSide,
      blending: THREE.NoBlending,
    }),
  );
  const cam = new THREE.CubeCamera(1, 10, rt);
  cam.coordinateSystem = renderer.coordinateSystem;
  cam.updateCoordinateSystem();
  cam.updateMatrixWorld(true);
  for (let side = 0; side < 6; side++) {
    await frame();
    const was = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(rt, side);
    renderer.render(box, cam.children[side] as THREE.Camera);
    renderer.setRenderTarget(was, face, level);
  }
  box.geometry.dispose();
  box.material.dispose();
  if (onCard !== eq) onCard.dispose();
  eq.dispose();
  (eq.image as { data: unknown }).data = null;
  return rt.texture;
}

/**
 * A sky picture made half the size each way: every four of its points made one, their light averaged. A few rows
 * at a time, so that the menu it is done under does not stop while it is.
 */
async function halve(sky: THREE.DataTexture) {
  const { data, width, height } = sky.image as { data: Uint16Array; width: number; height: number };
  if (!(data instanceof Uint16Array) || width < 2048) return;
  const w = width >> 1, h = height >> 1, out = new Uint16Array(w * h * 4);
  const light = THREE.DataUtils.fromHalfFloat, half = THREE.DataUtils.toHalfFloat;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = (y * 2 * width + x * 2) * 4, b = a + 4, c = a + width * 4, d = c + 4, o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) out[o + k] = half((light(data[a + k]) + light(data[b + k]) + light(data[c + k]) + light(data[d + k])) / 4);
      out[o + 3] = data[a + 3];
    }
    if (y % 64 === 63) await new Promise((r) => setTimeout(r, 0));
  }
  sky.image = { data: out, width: w, height: h } as never;
  sky.needsUpdate = true;
}

/** how thick the air itself is, to look through: three.js's own measure of it (what `FogExp2` is made with) */
export const AIR = 0.0011;
/** how fast the air thins with height (per metre): what the fog's lines are written with, and the lamps' glare (Lamps) */
export const AIR_FALL = 0.012;
/** the colour of the gas where the light is in it (linear, before the picture is finished) */
const GAS_COLOR = new THREE.Color(0.3, 0.36, 0.1);

/**
 * Night, as shares of what the day has: the moon for the sun (it stands where the sun stood:
 * the sky is a photograph, and the brightest thing in it is the one place a light can come
 * from), the sky's own light, the sky as it is seen, and the light that grass, leaves and
 * smoke carry baked into them. And the colours: of moonlight, of the low sun, of the air at night.
 */
const NIGHT = { sun: 0.1, sky: 0.09, back: 0.06, amb: 0.085 };
const MOON = new THREE.Color(0.6, 0.72, 1.0);
const LOW_SUN = new THREE.Color(1.0, 0.56, 0.3);
const NIGHT_AIR = new THREE.Color(0.018, 0.026, 0.046);

export type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/**
 * Anti-firefly: near-mirror surfaces (plastic bags, paint, glass, thin blades) turn
 * the HDR sun into sub-pixel specular spikes that bloom into flashes. A roughness
 * floor plus a cap on direct specular keeps highlights but kills the sparkle.
 */
export const antiFirefly: ShaderPatch = (shader) => {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.3);')
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(0.9));')
    // A single NaN/Inf MSAA sample (e.g. degenerate sub-pixel grass slivers) is
    // invisible on its own but the bloom mip chain smears it into a glowing orb.
    .replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\nif (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\ngl_FragColor.rgb = clamp(gl_FragColor.rgb, vec3(0.0), vec3(32.0));',
    );
};

// (the sun's own turn, as three's cascades take it, and the eye seen from the sun: see Atmosphere.update)
const _orient = new THREE.Matrix4(), _orientInv = new THREE.Matrix4();
const _ORIGIN = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0), _eye = new THREE.Vector3(), _place = new THREE.Vector3(), _dir = new THREE.Vector3();

/**
 * The frusta the sun's shadow maps are drawn through. Something meant to be drawn into the
 * shadow maps and nowhere else answers three's frustum test with "is it one of these?".
 * (Render layers cannot do it: the shadow pass tests an object's layers against the view
 * camera's, not the light's, so a layer the view leaves out is left out of the shadows too.)
 */
export const SHADOW_FRUSTA = new Set<THREE.Frustum | THREE.FrustumArray>();
/** which of the sun's cascades each of SHADOW_FRUSTA is (see castsInto) */
const CASCADE_OF = new Map<THREE.Frustum | THREE.FrustumArray, number>();
/** the eye, the way it looks, how long the shadow of a man's height is now, and the depths each cascade is read at: kept by Atmosphere.update */
const SEEN = { eye: new THREE.Vector3(), fwd: new THREE.Vector3(), long: 10, lo: [] as number[], hi: [] as number[],
  /** toward the sun; how far across from the eye the widest map reaches (square to the sun), and how far toward and away from the sun its box goes */
  sun: new THREE.Vector3(0, 1, 0), across: Infinity, toward: Infinity, away: Infinity };
const _cast = new THREE.Vector3();

/** what flies, this frame: x, y, z and the ground's height under it, four numbers each (see flying) */
const FLYING: number[] = [];
/**
 * Something in the air at (x, y, z), the ground at `ground` under it: the cascade its shadow lies in is drawn this frame,
 * not in its turn. A helicopter's shadow lies far below and off to one side of it, in a wider cascade drawn every
 * second or fourth frame, and stepped as it flew (the owner, 2026-10-19: "the car shadows have been smoothed and fixed
 * but not the helicopter shadows"). Said every frame by whatever moves it.
 */
export function flying(x: number, y: number, z: number, ground: number) {
  FLYING.push(x, y, z, ground);
}

/**
 * Whether a thing `r` round `at` is to be drawn into this map of the sun's shadow: true for anything that is not one
 * of the cascades; for a cascade, whether it is read anywhere the thing or its shadow can lie (the depths in the
 * view the cascade is read at, its fade into the next included, as the shader reads them: CSMShader). The wider
 * cascades are round the eye and hold what is near as well, and every body was drawn into all three: a body beside
 * the eye is read from the nearest only (2026-10-15).
 */
export function castsInto(f: THREE.Frustum | THREE.FrustumArray, at: THREE.Vector3, r: number): boolean {
  const i = CASCADE_OF.get(f);
  if (i === undefined || !SEEN.hi.length) return true;
  const z = (at.x - SEEN.eye.x) * SEEN.fwd.x + (at.y - SEEN.eye.y) * SEEN.fwd.y + (at.z - SEEN.eye.z) * SEEN.fwd.z, reach = r + SEEN.long;
  return z + reach >= SEEN.lo[i] && z - reach <= SEEN.hi[i];
}

/**
 * Whether something round `at`, `r` across, can throw a shadow into any of the sun's maps now: inside the widest one's
 * box, seen along the sun's line (a shadow lands straight along that line, so nothing to one side of the box falls in
 * it, however tall). True until the first frame. (2026-10-20: the ground's four hundred tiles were each tested against
 * every map drawn, every frame, wherever on the map they lay.)
 */
export function castsAnywhere(at: THREE.Vector3, r: number): boolean {
  if (!SEEN.hi.length) return true;
  _cast.subVectors(at, SEEN.eye);
  // (and ten metres more: a wider map is moved on by a few metres at a time, and its box is known as it was last drawn)
  const along = _cast.dot(SEEN.sun), across = SEEN.across + r + 10;
  return _cast.lengthSq() - along * along <= across * across && along <= SEEN.toward + r + 10 && along >= -(SEEN.away + r + 10);
}

/**
 * The way shadows fall across the ground from what throws them (level, of length one), and how far the shadow of a
 * man's height reaches that way now, metres: Infinity until the first frame.
 */
export function shadowFall(out: THREE.Vector3): number {
  out.set(-SEEN.sun.x, 0, -SEEN.sun.z);
  const l = out.length();
  if (l < 1e-6) out.set(0, 0, 0);
  else out.divideScalar(l);
  return SEEN.hi.length ? SEEN.long : Infinity;
}

/** how far from the eye a shadow can be seen, metres: the furthest cascade with its fade, and the longest shadow of a man's height now (until the first frame, everywhere) */
export const shadowsReach = () => (SEEN.hi.length ? SEEN.hi[SEEN.hi.length - 1] + SEEN.long : Infinity);

export class Atmosphere {
  sunDir =new THREE.Vector3(0.4, 0.7, 0.3).normalize(); // points toward the sun
  sunColor = new THREE.Color(1, 0.95, 0.88);
  sunIntensity = 3.4;
  fogColor = new THREE.Color(0.62, 0.68, 0.74);
  /**
   * How much of the day's own light there is at this hour (1 by day, a few hundredths at
   * night). One object, handed as a uniform (`uDaylight`) to every shader that has light of
   * its own written into it and takes none from the lamps of the scene: the glow through
   * grass and leaves, the far trees' cards, smoke.
   */
  readonly daylight = { value: 1 };
  /** how far into the night it is: 0 by day, 1 at night */
  night = 0;
  /**
   * A light from nowhere, on everything alike and out unless something turns it up: an admin's night sight indoors
   * (see Game). It is no part of the hour's light and nothing that dims the hour dims it. (An ambient light is not
   * counted among the lights a shader is written for: turning it up makes no shader anew.)
   */
  readonly fill = new THREE.AmbientLight(0xffffff, 0);
  /**
   * What is left of the hour's light where the eye is, by what is over it: the gas, the
   * ground. Each that dims sets its own entry (1 and 1 when it does not).
   */
  cover: Record<string, { sun: number; sky: number }> = {};
  /** the sun's strength and colour and the sky's light as they are now, the hour and the cover both counted (the hands and the gun are lit by the same) */
  sunNow = 3.4;
  skyNow = 0.9;
  readonly sunTint = new THREE.Color(1, 0.95, 0.88);
  /** what the hour alone leaves: of the sun, the sky's light, the sky as seen, and the air's colour */
  private hour = { sun: 1, sky: 1, back: 1, air: new THREE.Color() };
  /** how low the sun stands (0..1): what the glow along the horizon is drawn by */
  private low = 0;
  private glow: THREE.Mesh | null = null;
  private stars: THREE.Points | null = null;
  /** Every gas the world has: said before init, which writes them into every shader that takes fog. Each is drawn by the same lines. */
  gases: GasCloud[] = [];
  /**
   * The seconds gone by, as every shader that takes fog is told them: the gas drifts by them. They ride in on the
   * one number three.js hands to every such shader each frame by itself, the fog's `density`: the air's own
   * thickness never changes, so that is written into the shaders as a figure (AIR) and the number is free to
   * carry the time. A material that takes the fog's lines without being a fog material of three.js's own (the far
   * trees' cards) is handed this same object. Nothing else may read `scene.fog.density` as a thickness.
   */
  readonly seconds = { value: 0 };
  /** the works' gas (the first of them), for what asks only about that one: its loot, a trailer's shot of it */
  get gas(): GasZone | null {
    return this.gases[0] ?? null;
  }
  /** the gas seen against the sky, where there is nothing behind it to be dimmed by it */
  gasDome: THREE.Mesh | null = null;
  envMap!: THREE.Texture;
  background!: THREE.Texture;
  csm!: CSM;
  private registered = new WeakSet<THREE.Material>();
  private frame = 0;
  /** the shape of the view the cascades were last cut for (width over height) */
  private aspect = 0;
  /** where the camera was, and which way it faced, when each cascade was last drawn */
  private drawn: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  /** the two wider cascades, round the eye: how far each reaches, and how far the eye may go before it is drawn again (see padCascades) */
  private round: ({ reach: number; pad: number } | undefined)[] = [];
  /** where each of those is now, seen from the sun (its middle, on whole texels) */
  private sunAt: THREE.Vector3[] = [];
  /** (development: the cascades fitted to the view as three fits them, as they were, to draw the same frame both ways: assets-src/_wf/me/shadow-ab.js) */
  fitToView = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {}

  /** what of the sky is sent for only once the game is up: the sharp picture of it (null: nothing, or it has been) */
  private later: (() => void) | null = null;
  /** The game is up: what was not worth making anybody wait for is sent for now. */
  afterBoot() {
    this.later?.();
    this.later = null;
  }

  async init() {
    const m = assets.manifest.hdri;
    const env = await assets.hdri(m.env);

    this.analyseSky(env);
    this.clampSun(env);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    env.mapping = THREE.EquirectangularReflectionMapping;
    this.envMap = pmrem.fromEquirectangular(env).texture;
    pmrem.dispose();
    env.dispose();

    // The sky that is looked at is a file of twenty megabytes, a seventh of everything the game fetches before it
    // can be played, and nothing waits on it but the sky: the game starts under the small sky its light is taken
    // from (soft, and the right colours), and the sharp one takes its place when it has come. It is not even
    // sent for until the game is up (see `later`, and main.ts): asked for here, it came down beside everything
    // the game does wait on, and took a sixth of the line from it.
    this.background = this.envMap;
    // (a phone the game has already failed to start on keeps the small sky: see LEAN)
    this.later = () => void assets.hdri(m.background, false).then(
      async (bg) => {
        // (A phone has it at half the size each way. Drawn, the sky is laid out as the six sides of a box, each as
        // tall as the picture: 270 MB on the card for the whole one, a quarter of everything a phone can be asked
        // to hold, for the one thing in the game that is never looked at closely.)
        if (TOUCH) await halve(bg);
        bg.mapping = THREE.EquirectangularReflectionMapping;
        bg.colorSpace = THREE.LinearSRGBColorSpace;
        // (on the card a little at a time, and its 67 MB on the page let go after: see skyBox. Drawn both ways in one
        // look, three's and this, they differ by at most 2 in 255 at any point of the picture.)
        const sky = await skyBox(this.renderer, bg);
        // (whatever has put another sky up meanwhile keeps its own: only the stand-in is changed for this)
        if (this.scene.background === this.background) this.scene.background = sky;
        this.background = sky;
      },
      () => {},
    );
    if (LEAN) this.later = null;

    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.9;
    this.scene.background = this.background;
    this.scene.backgroundIntensity = 1.0;
    this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), AIR);
    (this.scene.fog as THREE.FogExp2).color.copy(this.fogColor);

    this.installFogChunks();
    this.buildGasDome();
    this.buildStars();
    this.scene.add(this.fill);
    this.setHour(1, 0);

    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: 3,
      maxFar: 160,
      mode: 'practical',
      shadowMapSize: 2048,
      lightDirection: this.sunDir.clone().negate(),
      lightIntensity: this.sunIntensity,
      lightNear: 1,
      lightFar: 900,
      lightMargin: 160,
      shadowBias: -0.00012,
    });
    this.csm.fade = true;
    this.csm.lights.forEach((l, i) => {
      l.color.copy(this.sunColor);
      l.shadow.camera.layers.enable(2);
      l.shadow.normalBias = 0.035;
      SHADOW_FRUSTA.add(l.shadow.getFrustum());
      CASCADE_OF.set(l.shadow.getFrustum(), i);
    });
    this.padCascades();
  }

  /**
   * The two wider cascades are centred on the eye, not on the slice of the view each covers (as three fits them):
   * square to the sun, each reaches round the eye as far as its slice does at its furthest corner, whichever way the
   * eye looks, and a few metres more. A map of one is as good after a turn as before it, and is drawn again only when
   * the eye has gone those few metres, or in its turn for what moves (see update). Fitted to the slice, a turn of a
   * few degrees left the map behind, so that in play, the view always turning, both were drawn every frame: 2 to 3 ms
   * of the card's frame at the crossroads (2026-10-15, frozen against drawn, the view turning). The view being wide,
   * the slice's own box was nearly as wide already: these are a few per cent wider, and the maps no softer to the eye.
   */
  private padCascades() {
    const csm = this.csm, cam = this.camera;
    csm.lights.forEach((l, i) => {
      if (i === 0) return;
      if (this.fitToView) {
        const c = l.shadow.camera;
        if (l.shadow.mapSize.x !== csm.shadowMapSize) {
          l.shadow.mapSize.set(csm.shadowMapSize, csm.shadowMapSize);
          l.shadow.map?.dispose();
          l.shadow.map = null;
        }
        c.left *= 1.08;
        c.right *= 1.08;
        c.top *= 1.08;
        c.bottom *= 1.08;
        c.updateProjectionMatrix();
        this.round[i] = undefined;
        return;
      }
      const v = csm.frustums[i].vertices;
      const reach = Math.max(...v.near.map((p) => p.length()), ...v.far.map((p) => p.length()));
      // (the margin three adds to a cascade for the fade between cascades, as it works it out)
      const far = Math.max(cam.far, csm.maxFar), depth = v.far[0].z / (far - cam.near);
      const margin = csm.fade ? 0.25 * depth * depth * (far - cam.near) : 0;
      const pad = i === 1 ? 1.5 : 4;
      const half = reach + margin / 2 + pad;
      const c = l.shadow.camera;
      // (wider than the slice's own box by about a fifth, the map is drawn bigger by as much: each of its texels is the
      // ground one was, and the shadows no softer; measured both ways, the same frozen frame, shadow-ab.js)
      const fitted = (c.right - c.left) * 1.08;
      const size = Math.min(4096, Math.ceil((csm.shadowMapSize * (2 * half)) / fitted / 16) * 16);
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
      c.left = c.bottom = -half;
      c.right = c.top = half;
      // (deep enough for everything within reach below the eye, with the sun's margin above it)
      c.far = Math.max(900, 2 * reach + csm.lightMargin + 50);
      c.updateProjectionMatrix();
      this.round[i] = { reach, pad };
    });
    this.drawn.length = 0;
  }

  /** Graphics option: shadow map resolution (per cascade) and how far from the camera shadows reach. */
  setShadows(size: number, far: number) {
    const csm = this.csm;
    if (csm.shadowMapSize !== size) {
      csm.shadowMapSize = size;
      for (const l of csm.lights) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
    // (the wider cascades' own sizes follow from it: see padCascades)
    csm.maxFar = far;
    csm.updateFrustums();
    this.padCascades();
  }

  /** Brightest texel = sun. Also averages the horizon band for the fog colour. */
  private analyseSky(tex: THREE.DataTexture) {
    const { data, width, height } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
    const half = data instanceof Uint16Array;
    const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i] as number) : (data[i] as number));
    let best = -1;
    let bx = 0;
    let by = 0;
    const horizon = new THREE.Color(0, 0, 0);
    let hCount = 0;
    for (let y = 0; y < height; y++) {
      const v = 1 - (y + 0.5) / height;
      const lat = (v - 0.5) * Math.PI;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = read(i), g = read(i + 1), b = read(i + 2);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum > best) {
          best = lum;
          bx = x;
          by = y;
        }
        if (lat > 0.01 && lat < 0.09 && lum < 4) {
          horizon.r += r;
          horizon.g += g;
          horizon.b += b;
          hCount++;
        }
      }
    }
    const u = (bx + 0.5) / width;
    const v = 1 - (by + 0.5) / height;
    const az = (u - 0.5) * Math.PI * 2;
    const lat = (v - 0.5) * Math.PI;
    this.sunDir.set(Math.cos(az) * Math.cos(lat), Math.sin(lat), Math.sin(az) * Math.cos(lat)).normalize();
    if (hCount) this.fogColor.setRGB(horizon.r / hCount, horizon.g / hCount, horizon.b / hCount).multiplyScalar(0.92);
  }

  private clampSun(tex: THREE.DataTexture) {
    const { data } = tex.image as { data: Uint16Array | Float32Array };
    const half = data instanceof Uint16Array;
    const MAX = 12;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = half ? THREE.DataUtils.fromHalfFloat(data[i + c] as number) : (data[i + c] as number);
        if (v > MAX) data[i + c] = half ? THREE.DataUtils.toHalfFloat(MAX) : MAX;
      }
    }
    tex.needsUpdate = true;
  }

  /**
   * Replaces three's distance fog with exponential height fog plus forward
   * in-scattering toward the sun (cheap aerial perspective).
   */
  private installFogChunks() {
    const s = this.sunDir;
    const sc = this.sunColor;
    const vec3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(5)}, ${y.toFixed(5)}, ${z.toFixed(5)})`;
    THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;
    THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vec4 fogWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    fogWorld = batchingMatrix * fogWorld;
  #endif
  #ifdef USE_INSTANCING
    fogWorld = instanceMatrix * fogWorld;
  #endif
  fogWorld = modelMatrix * fogWorld;
  vFogWorldPos = fogWorld.xyz;
#endif`;
    const gas = this.gasGlsl();
    THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorldPos;
  // (the camera's own, for where it stops drawing: see fog_fragment)
  uniform mat4 projectionMatrix;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  #define ATMO_SUN_DIR ${vec3(s.x, s.y, s.z)}
  #define ATMO_SUN_COLOR ${vec3(sc.r * 1.15, sc.g * 1.05, sc.b * 0.85)}
  #define ATMO_FALLOFF ${AIR_FALL}
  float atmoFogAmount( vec3 ro, vec3 rd, float dist ) {
    #ifdef FOG_EXP2
      // (not fogDensity: that number carries the seconds gone by, see Atmosphere.seconds)
      float a = ${AIR.toFixed(6)};
    #else
      float a = 1.0 / max( fogFar, 1.0 );
    #endif
    float b = ATMO_FALLOFF;
    float h = max( ro.y, -50.0 );
    float k = rd.y * b;
    float amount = abs( k ) > 1e-4
      ? a * exp( -h * b ) * ( 1.0 - exp( -dist * k ) ) / k
      : a * exp( -h * b ) * dist;
    return 1.0 - exp( -max( amount, 0.0 ) );
  }
  vec3 atmoFogColor( vec3 rd ) {
    float sunAmt = pow( max( dot( rd, ATMO_SUN_DIR ), 0.0 ), 6.0 );
    return mix( fogColor, fogColor * ATMO_SUN_COLOR * 1.6, sunAmt * 0.55 );
  }
  ${gas}
#endif`;
    THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 fogRay = vFogWorldPos - cameraPosition;
    float fogDist = length( fogRay );
    vec3 fogDir = fogRay / max( fogDist, 1e-4 );
    float fogAmt = atmoFogAmount( cameraPosition, fogDir, fogDist );
    // (the draw distance, which is the camera's far: the last quarter of the way to it closes in haze, so that where
    // nothing more is drawn there is no edge)
    if ( projectionMatrix[ 3 ][ 3 ] < 0.5 ) {
      float drawFar = projectionMatrix[ 3 ][ 2 ] / ( projectionMatrix[ 2 ][ 2 ] + 1.0 );
      fogAmt = max( fogAmt, smoothstep( drawFar * 0.72, drawFar * 0.97, fogDist ) );
    }
    gl_FragColor.rgb = mix( gl_FragColor.rgb, atmoFogColor( fogDir ), fogAmt );
    #ifdef GAS_ZONE
      // (what is seen through the gas is lost to it, by as much of it as lies in the way)
      vec3 gasIs = gasAmount( cameraPosition, fogDir, fogDist );
      gl_FragColor.rgb = mix( gl_FragColor.rgb, gasColor( fogDir, gasIs.y, gasIs.z ), gasIs.x );
    #endif
  }
#endif`;
  }

  /**
   * The gas, as the shaders know it: a bank of it over a place. It is one thing wherever it lies, with one set of
   * figures (GAS in src/sim/gas.ts, where the user's words on how it should look are): every gas in `gases` is
   * drawn by these lines and no others.
   *
   * Each is a low dome of it, reaching GAS.skirt further than it is breathed. How thick it is at a point: nothing
   * at the dome's edge, rising (slowly, then fast) to its thickest where the breathing begins and the same from
   * there in; thinned away above GAS.top of its height; and in the skirt broken into puffs and gaps by a slow
   * pattern fixed in the world. How much of it lies along a line of sight is counted in ten steps along the part
   * of the line that is in the dome, each line starting its steps a different fraction of a step along (by where
   * its pixel is), so that ten steps show as a fine grain and not as bands. Only a pixel that is looking through
   * a dome pays for it.
   *
   * Seen from outside it is a thick bank with a soft, broken edge, and whoever is in it is hidden by a few metres
   * of it. To an eye that is in it, it is all but gone (GAS.within of it is left), over the way in through the
   * skirt. The shader knows where the eye is and not what is on the face under it: an eye with no mask sees the
   * air clear as well, for the seconds it lasts, through the green that closes in from the edges of the screen as
   * the lungs fill (src/game/gas.ts).
   *
   * @param only one of them alone, by its number (what its own dome against the sky is drawn with)
   */
  private gasGlsl(only = -1) {
    const all = this.gases;
    if (!all.length) return '';
    const s = this.sunDir, out = 1 + GAS.skirt;
    const vec3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(5)}, ${y.toFixed(5)}, ${z.toFixed(5)})`;
    const through = all
      .map((g, i) => (only >= 0 && i !== only ? '' : `gasThrough( ro, rd, dist, ${vec3(g.x, g.y, g.z)}, ${vec3(1 / (g.r * out), 1 / (g.h * out), 1 / (g.r * out))}, ${g.floor.toFixed(2)}, got );`))
      .join('\n    ');
    return /* glsl */ `
  #define GAS_ZONE
  #define GAS_STEPS ${TOUCH ? 5 : 10}
  #define GAS_THICK ${GAS.thick.toFixed(5)}
  // (one over how deep in the edge of what is breathed lies, depth being 0 at the dome's edge and 1 at its middle)
  #define GAS_FULL ${(1 / (1 - 1 / (out * out))).toFixed(5)}
  #define GAS_TOP ${GAS.top.toFixed(5)}
  #define GAS_PUFFS ${GAS.puffs.toFixed(5)}
  #define GAS_WITHIN ${GAS.within.toFixed(5)}
  #define GAS_COLOR ${vec3(GAS_COLOR.r, GAS_COLOR.g, GAS_COLOR.b)}
  #define GAS_SUN ${vec3(s.x, s.y, s.z)}
  #define GAS_DAY_AIR ${(this.fogColor.r + this.fogColor.g + this.fogColor.b).toFixed(5)}
  // (the seconds gone by: see Atmosphere.seconds)
  #define GAS_NOW fogDensity
  // the way it drifts, metres a second
  #define GAS_WIND vec3( 0.55, 0.03, 0.3 )
  // A slow pattern fixed in the world: three waves, each bent by another, no two of them lined up, so that nothing
  // in it repeats that an eye can find. About -1 to 1; its broadest swells are some 45 m across.
  float gasNoise( vec3 w ) {
    float n = sin( dot( w, vec3( 0.061, 0.113, 0.047 ) ) + 1.9 * sin( dot( w, vec3( -0.039, 0.021, 0.071 ) ) ) );
    n += 0.6 * sin( dot( w, vec3( -0.127, 0.093, 0.149 ) ) + 1.5 * sin( dot( w, vec3( 0.083, -0.057, 0.031 ) ) ) + 2.1 );
    n += 0.35 * sin( dot( w, vec3( 0.31, 0.19, -0.27 ) ) + 1.2 * sin( dot( w, vec3( -0.21, 0.13, 0.17 ) ) ) + 4.3 );
    return n / 1.95;
  }
  // how thick it is at a point: where in its dome (the middle 0, the edge 1 out), and where in the world
  float gasAt( vec3 p, vec3 w ) {
    float full = clamp( ( 1.0 - dot( p, p ) ) * GAS_FULL, 0.0, 1.0 );
    float d = full * full;
    if ( full <= 0.0 ) return 0.0;
    // (Only its skirt is broken into puffs, and only its top is ragged: low down, from where it is breathed in, it
    // is whole, and costs nothing to know.)
    bool whole = full > 0.999 && p.y < GAS_TOP - 0.3;
    float n = whole ? 0.0 : gasNoise( w - GAS_WIND * GAS_NOW );
    d = clamp( d + GAS_PUFFS * n * ( 1.0 - full ) * min( full * 6.0, 1.0 ), 0.0, 1.0 );
    return d * ( 1.0 - smoothstep( GAS_TOP + 0.26 * n - 0.1, 1.0 + 0.12 * n, p.y ) );
  }
  // How much of one of them lies along a line of sight: the middle of it, one over its reach each way, and the
  // height it has none under. Added to got: x, metres of it at its thickest; y, the same weighed by how high in
  // it each metre was; z, how lit the face of it is that the line of sight comes to, weighed by w, how much of a
  // face there is (none, to an eye that sees through it).
  void gasThrough( vec3 ro, vec3 rd, float dist, vec3 mid, vec3 inv, float low, inout vec4 got ) {
    vec3 q = ( ro - mid ) * inv;
    vec3 d = rd * inv;
    float a = dot( d, d ), b = dot( q, d ), c = dot( q, q ) - 1.0;
    float h = b * b - a * c;
    if ( h <= 0.0 ) return;
    h = sqrt( h );
    float t1 = max( ( -b - h ) / a, 0.0 ), t2 = min( ( -b + h ) / a, dist );
    float over = ro.y - low;
    if ( abs( rd.y ) > 1e-5 ) {
      float tp = -over / rd.y;
      if ( rd.y > 0.0 ) t1 = max( t1, tp ); else t2 = min( t2, tp );
    } else if ( over < 0.0 ) return;
    if ( t2 <= t1 ) return;
    // (how far in the eye is: nothing outside it, one from where it is breathed. An eye that is in it sees through it.)
    float thin = mix( 1.0, GAS_WITHIN, smoothstep( 0.15, 0.75, clamp( -c * GAS_FULL, 0.0, 1.0 ) ) );
    float dt = ( t2 - t1 ) / float( GAS_STEPS );
    float t = t1 + dt * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
    vec2 sum = vec2( 0.0 );
    // where the line of sight is stopped by it: each step's place, weighed by how much is first lost there
    vec3 face = vec3( 0.0 );
    float faces = 0.0, seen = 1.0;
    for ( int i = 0; i < GAS_STEPS; i++ ) {
      vec3 p = q + d * t, w = ro + rd * t;
      float k = gasAt( p, w );
      float lost = seen * ( 1.0 - exp( -GAS_THICK * k * dt * thin ) );
      face += lost * w;
      faces += lost;
      seen -= lost;
      sum += vec2( k, k * p.y );
      t += dt;
    }
    got.xy += sum * dt * thin;
    if ( faces > 1e-4 ) {
      // How lit that face is: by how much of the gas lies between it and the sun (a few metres toward the sun
      // from it: in the open there, it is a lit crest; deep in it there, a shaded hollow), and by a finer run of
      // the same pattern, drifting with it, which is the billows on it.
      vec3 at = face / faces, sunward = at + GAS_SUN * 9.0;
      float shaded = gasAt( ( sunward - mid ) * inv, sunward );
      float billow = gasNoise( ( at - GAS_WIND * GAS_NOW ) * 2.6 );
      got.z += faces * exp( -1.4 * shaded ) * ( 1.0 + 0.38 * billow );
      got.w += faces;
    }
  }
  // what the gas does to a line of sight: x, how much of what is seen along it is lost; y, how high in it, on the
  // whole, the gas on that line was (0 its foot, 1 its top); z, how lit its face is there (about 0.2 to 1.2)
  vec3 gasAmount( vec3 ro, vec3 rd, float dist ) {
    vec4 got = vec4( 0.0 );
    ${through}
    return vec3( 1.0 - exp( -GAS_THICK * got.x ), got.y / max( got.x, 1e-4 ), got.w > 1e-4 ? got.z / got.w : 1.0 );
  }
  vec3 gasColor( vec3 rd, float high, float light ) {
    // A little lit through, looking toward the sun; no brighter than the air is at this hour; darker at its foot
    // than toward its top; and its face lit and shaded as a bank of anything is that stands in the sun, paler
    // where it is lit: so that it is seen as a thing with depth to it and not as a colour laid over the view.
    float lit = clamp( dot( fogColor, vec3( 1.0 ) ) / GAS_DAY_AIR, 0.0, 1.0 );
    vec3 col = GAS_COLOR * ( 1.0 + 0.45 * pow( max( dot( rd, GAS_SUN ), 0.0 ), 4.0 ) ) * mix( 0.78, 1.15, smoothstep( 0.0, 0.5, high ) ) * mix( 0.42, 1.36, light );
    col = mix( col, vec3( dot( col, vec3( 0.36 ) ) ) * 1.08, 0.3 * smoothstep( 0.55, 1.15, light ) );
    return col * lit;
  }`;
  }

  /**
   * Where there is ground or a wall behind the gas, that is dimmed by it in its own shader.
   * Where there is only sky there is nothing to dim: the far side of the dome is drawn, and
   * coloured by as much gas as lies between the eye and it.
   */
  private buildGasDome() {
    this.gases.forEach((g, i) => this.gasDomeOf(g, i));
  }

  private gasDomeOf(g: GasCloud, i: number) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      // (the air's colour, which the gas is no brighter than: the same object the fog has, so it is the hour's)
      uniforms: { fogColor: { value: (this.scene.fog as THREE.FogExp2).color }, fogDensity: this.seconds },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4( position, 1.0 );
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 fogColor;
        uniform float fogDensity;
        varying vec3 vWorld;
        ${this.gasGlsl(i)}
        void main() {
          vec3 ray = vWorld - cameraPosition;
          float dist = length( ray );
          vec3 rd = ray / max( dist, 1e-4 );
          vec3 gasIs = gasAmount( cameraPosition, rd, dist + 1.0 );
          gl_FragColor = vec4( gasColor( rd, gasIs.y, gasIs.z ), gasIs.x );
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    dome.scale.set(g.r, g.h, g.r).multiplyScalar(1 + GAS.skirt + 0.02);
    dome.position.set(g.x, g.y, g.z);
    dome.frustumCulled = false;
    // (before anything else that is seen through: smoke and glass inside it are drawn over it)
    dome.renderOrder = -5;
    dome.matrixAutoUpdate = false;
    dome.updateMatrix();
    this.scene.add(dome);
    this.gasDome ??= dome;
  }

  /**
   * Every lit material must go through here: CSM needs per-material uniforms and
   * custom shader patches must compose with it.
   */
  register(mat: THREE.Material, patch?: ShaderPatch, cacheKey?: string) {
    if (this.registered.has(mat)) return mat;
    this.registered.add(mat);
    if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial && !(mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && !(mat as THREE.MeshLambertMaterial).isMeshLambertMaterial && !(mat as THREE.MeshPhongMaterial).isMeshPhongMaterial) {
      return mat;
    }
    this.csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      csmHook.call(mat, shader, r);
      // (the hour, for whatever a patch writes into the shader that is light of its own)
      shader.uniforms.uDaylight = this.daylight;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDaylight;');
      patch?.(shader);
      antiFirefly(shader);
    };
    mat.customProgramCacheKey = () => 'csm|' + (cacheKey ?? '');
    return mat;
  }

  registerObject(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => this.register(m));
    });
  }

  /**
   * The hour.
   * @param light how much of the day's light there is: 1 by day, 0 at night
   * @param low how low the sun stands: 0 by day and by night, up to 1 in the middle of first light and of dusk
   */
  setHour(light: number, low: number) {
    const h = this.hour, L = THREE.MathUtils.lerp;
    this.night = 1 - light;
    // (the low sun is weaker as well as redder)
    h.sun = L(NIGHT.sun, 1, light) * (1 - 0.4 * low);
    h.sky = L(NIGHT.sky, 1, light);
    // (the sky goes sooner than the ground does: a bright noon sky over dim ground is no evening)
    h.back = L(NIGHT.back, 1, Math.pow(light, 2.4));
    this.low = low;
    this.daylight.value = L(NIGHT.amb, 1, light);
    this.sunTint.copy(MOON).lerp(this.sunColor, light).lerp(LOW_SUN, low * 0.75);
    h.air.copy(NIGHT_AIR).lerp(this.fogColor, light);
    // (and the air takes a little of the low sun's colour)
    h.air.r *= 1 + 0.22 * low;
    h.air.b *= 1 - 0.18 * low;
  }

  /** Puts the hour's light, less what is over the eye, on everything that carries it. */
  private applyLight() {
    const h = this.hour;
    let sun = h.sun, sky = h.sky;
    for (const k in this.cover) {
      sun *= this.cover[k].sun;
      sky *= this.cover[k].sky;
    }
    this.sunNow = this.sunIntensity * sun;
    this.skyNow = 0.9 * sky;
    for (const l of this.csm.lights) {
      l.intensity = this.sunNow;
      l.color.copy(this.sunTint);
    }
    this.scene.environmentIntensity = this.skyNow;
    this.scene.backgroundIntensity = h.back;
    (this.scene.fog as THREE.FogExp2).color.copy(h.air);
    if (this.glow) {
      this.glow.position.copy(this.camera.position);
      // (inside the draw distance, or the camera's far cuts it away)
      this.glow.scale.setScalar(Math.min(1, (this.camera.far * 0.9) / 1400));
      this.glow.visible = this.low > 0.01;
      (this.glow.material as THREE.ShaderMaterial).uniforms.uLow.value = this.low;
    }
    if (this.stars) {
      this.stars.position.copy(this.camera.position);
      this.stars.scale.setScalar(Math.min(1, (this.camera.far * 0.9) / 1500));
      const seen = Math.max(0, this.night - 0.5) / 0.5;
      this.stars.visible = seen > 0.01;
      (this.stars.material as THREE.PointsMaterial).opacity = seen * seen;
    }
  }

  /** The stars: seen at night, where the sky is. (The sky itself is a photograph of a day, turned down.) */
  private buildStars() {
    const N = 1400;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    let s = 20261009;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    for (let i = 0; i < N; i++) {
      // evenly over the upper sky, none down at the hills
      const y = 0.08 + rnd() * 0.92, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 1500, y * 1500, Math.sin(a) * r * 1500], i * 3);
      // most are faint; a few are bright, and a few of those are a little blue or a little yellow
      const b = 0.25 + Math.pow(rnd(), 5) * 1.6, t = rnd();
      col.set([b * (t > 0.8 ? 1 : 0.9), b * 0.92, b * (t < 0.2 ? 1.1 : 0.95)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    stars.frustumCulled = false;
    stars.renderOrder = -10;
    stars.visible = false;
    this.scene.add(stars);
    this.stars = stars;

    // The low sun's colour along the horizon, strongest toward where the sun is. (The sky is a
    // photograph and cannot be tinted: this is laid over it, behind everything else.)
    const sx = this.sunDir.x, sz = this.sunDir.z, sl = Math.hypot(sx, sz) || 1;
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uLow: { value: 0 }, uSun: { value: new THREE.Vector2(sx / sl, sz / sl) } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }`,
        fragmentShader: /* glsl */ `
          uniform float uLow;
          uniform vec2 uSun;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize( vDir );
            float toward = max( dot( normalize( d.xz + 1e-5 ), uSun ), 0.0 );
            float band = smoothstep( 0.42, 0.0, d.y ) * smoothstep( -0.12, 0.0, d.y );
            float a = uLow * band * ( 0.3 + 0.7 * toward * toward );
            vec3 c = mix( vec3( 1.0, 0.42, 0.14 ), vec3( 0.9, 0.5, 0.42 ), clamp( d.y * 3.0, 0.0, 1.0 ) );
            gl_FragColor = vec4( c * 0.85, a * 0.8 );
          }`,
      }),
    );
    glow.frustumCulled = false;
    glow.renderOrder = -9;
    glow.visible = false;
    this.scene.add(glow);
    this.glow = glow;
  }

  update() {
    this.applyLight();
    this.seconds.value = performance.now() / 1000;
    (this.scene.fog as THREE.FogExp2).density = this.seconds.value;
    // The cascades are cut from the shape of the view, and were cut once, when the game
    // started. Resize the window or go full screen and they went on covering the old shape:
    // on a screen that had become wider, nothing off to the sides was shadowed. (And started
    // in a window with no size yet, they covered nothing at all.)
    const shape = this.camera.aspect;
    if (shape > 0 && shape !== this.aspect) {
      this.aspect = shape;
      this.csm.updateFrustums();
      this.padCascades();
    }
    const csm = this.csm;
    csm.update();
    const cam = this.camera;
    // (what castsInto reads: the depths are the shader's own, with the fade on either side of each and twice over)
    {
      cam.getWorldPosition(SEEN.eye);
      cam.getWorldDirection(SEEN.fwd);
      const d = csm.lightDirection, span = Math.min(cam.far, csm.maxFar) - cam.near;
      SEEN.long = Math.min(60, (2.2 * Math.hypot(d.x, d.z)) / Math.max(Math.abs(d.y), 0.04));
      for (let i = 0; i < csm.breaks.length; i++) {
        const a = csm.breaks[i - 1] ?? 0, b = csm.breaks[i], m = 0.25 * b * b;
        SEEN.lo[i] = (a - m) * span + cam.near;
        SEEN.hi[i] = (b + m) * span + cam.near;
      }
      // (each map's box: how far across from the eye it reaches at its corners, and along the sun's line toward it and away)
      SEEN.sun.copy(d).negate().normalize();
      SEEN.across = SEEN.toward = SEEN.away = 0;
      for (const l of csm.lights) {
        const c = l.shadow.camera;
        _cast.subVectors(c.position, SEEN.eye);
        const along = _cast.dot(SEEN.sun), off = Math.sqrt(Math.max(0, _cast.lengthSq() - along * along));
        SEEN.across = Math.max(SEEN.across, off + Math.SQRT2 * Math.max(Math.abs(c.left), Math.abs(c.right), Math.abs(c.top), Math.abs(c.bottom)));
        SEEN.toward = Math.max(SEEN.toward, along - c.near);
        SEEN.away = Math.max(SEEN.away, c.far - along);
      }
    }
    // (the two wider ones set round the eye, square to the sun, on whole texels of their maps so that what they
    // show does not crawl as the eye goes: see padCascades. Three's own sun turned as it turns it.)
    _orient.lookAt(_ORIGIN, csm.lightDirection, _UP);
    _orientInv.copy(_orient).invert();
    _eye.copy(cam.position).applyMatrix4(_orientInv);
    for (let i = 1; i < csm.lights.length && !this.fitToView; i++) {
      const l = csm.lights[i], c = l.shadow.camera, r = this.round[i];
      if (!r) continue;
      const texel = (c.right - c.left) / l.shadow.mapSize.x;
      const at = (this.sunAt[i] ??= new THREE.Vector3());
      at.set(Math.floor(_eye.x / texel) * texel, Math.floor(_eye.y / texel) * texel, _eye.z + r.reach + csm.lightMargin);
      _place.copy(at).applyMatrix4(_orient);
      l.position.copy(_place);
      l.target.position.copy(_place).add(csm.lightDirection);
    }
    // Shadows are the most expensive thing drawn: every caster again, once per cascade.
    // The nearest cascade is redrawn every frame. The two wider ones cover ground further
    // off, where a shadow a few frames old cannot be told from a fresh one, so they take
    // turns (for what moves in them): unless the eye has gone far enough to need them now.
    // Turning never needs them: they are round the eye.
    this.frame++;
    if (this.fitToView) cam.getWorldDirection(_dir);
    // (the cascades a flying thing's shadow lies in: where a line from it along the sun meets the ground under it, by
    // its depth in the view as the shader reads it)
    const ld = csm.lightDirection;
    let due = 0;
    // (development: as it was, for an A/B of what it costs: assets-src/_wf/me/replay.mjs --flip __noFlying)
    if ((globalThis as { __noFlying?: boolean }).__noFlying) FLYING.length = 0;
    for (let k = 0; k < FLYING.length; k += 4) {
      const up = FLYING[k + 1] - FLYING[k + 3], t = ld.y < -0.05 ? Math.max(0, up) / -ld.y : 0;
      const z = (FLYING[k] + ld.x * t - SEEN.eye.x) * SEEN.fwd.x + (FLYING[k + 3] - SEEN.eye.y) * SEEN.fwd.y + (FLYING[k + 2] + ld.z * t - SEEN.eye.z) * SEEN.fwd.z;
      for (let i = 0; i < SEEN.lo.length; i++) if (z + 12 >= SEEN.lo[i] && z - 12 <= SEEN.hi[i]) due |= 1 << i;
    }
    FLYING.length = 0;
    csm.lights.forEach((l, i) => {
      const s = l.shadow;
      s.autoUpdate = false;
      const drawn = (this.drawn[i] ??= { pos: new THREE.Vector3(Infinity, 0, 0), dir: new THREE.Vector3() });
      // (The nearest every frame. Drawn every other frame from 2026-10-18 for the frames it saved, everything that moved
      // near the eye, the eye's own body first, cast a shadow that stepped instead of moving: the owner, 2026-10-19,
      // "shadows now stutter really bad and no longer move smoothly. this change is not worht the save".)
      const near = false;
      const turn = i === 0 ? this.frame % 2 === 1 : i === 1 ? this.frame % 2 === 0 : this.frame % 4 === 1;
      const now = this.sunAt[i], r = this.round[i];
      // (development, as it was: fitted to the view, a turn of three or four degrees needed them drawn again)
      const gone = near
        ? drawn.pos.distanceToSquared(cam.position) > 1
        : this.fitToView
          ? drawn.pos.distanceToSquared(cam.position) > (i === 1 ? 0.5 : 4) || drawn.dir.dot(_dir) < (i === 1 ? 0.9986 : 0.9976)
          : !now || !r || Math.hypot(now.x - drawn.pos.x, now.y - drawn.pos.y) > r.pad * 0.9;
      if ((i === 0 && !near) || turn || gone || due & (1 << i) || !s.map) {
        s.needsUpdate = true;
        if (near || this.fitToView) {
          drawn.pos.copy(cam.position);
          drawn.dir.copy(_dir);
        } else if (now) drawn.pos.copy(now);
      }
    });
  }
}
