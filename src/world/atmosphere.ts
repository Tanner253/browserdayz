// Sky, sun, image-based lighting, cascaded shadows and height fog.
//
// The sun direction is recovered from the HDRI itself (brightest texel) so the
// directional light always lines up with the sun in the sky. The sun is then
// clamped out of the environment map before PMREM filtering so direct light is
// not counted twice (once by the light, once by the IBL).

import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { assets } from '../core/assets';
import { GAS, type GasZone } from '../sim/gas';

/** the colour of the gas where the light is in it (linear, before the picture is finished) */
const GAS_COLOR = new THREE.Color(0.3, 0.36, 0.1);

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

const _dir = new THREE.Vector3();

/**
 * The frusta the sun's shadow maps are drawn through. Something meant to be drawn into the
 * shadow maps and nowhere else answers three's frustum test with "is it one of these?".
 * (Render layers cannot do it: the shadow pass tests an object's layers against the view
 * camera's, not the light's, so a layer the view leaves out is left out of the shadows too.)
 */
export const SHADOW_FRUSTA = new Set<THREE.Frustum | THREE.FrustumArray>();

export class Atmosphere {
  sunDir = new THREE.Vector3(0.4, 0.7, 0.3).normalize(); // points toward the sun
  sunColor = new THREE.Color(1, 0.95, 0.88);
  sunIntensity = 3.4;
  fogColor = new THREE.Color(0.62, 0.68, 0.74);
  /** Where the gas lies, if the world has any: said before init, which writes it into every shader that takes fog. */
  gas: GasZone | null = null;
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

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {}

  async init() {
    const m = assets.manifest.hdri;
    const [env, bg] = await Promise.all([assets.hdri(m.env), assets.hdri(m.background)]);

    this.analyseSky(env);
    this.clampSun(env);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    env.mapping = THREE.EquirectangularReflectionMapping;
    this.envMap = pmrem.fromEquirectangular(env).texture;
    pmrem.dispose();
    env.dispose();

    bg.mapping = THREE.EquirectangularReflectionMapping;
    bg.colorSpace = THREE.LinearSRGBColorSpace;
    // 4k half-float sky is ~67 MB on the JS heap; release it after upload
    bg.onUpdate = () => {
      (bg.image as { data: Uint16Array | Float32Array | null }).data = null;
    };
    this.background = bg;

    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.9;
    this.scene.background = bg;
    this.scene.backgroundIntensity = 1.0;
    this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.0011);
    (this.scene.fog as THREE.FogExp2).color.copy(this.fogColor);

    this.installFogChunks();
    this.buildGasDome();

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
    for (const l of this.csm.lights) {
      l.color.copy(this.sunColor);
      l.shadow.camera.layers.enable(2);
      l.shadow.normalBias = 0.035;
      SHADOW_FRUSTA.add(l.shadow.getFrustum());
    }
    this.padCascades();
  }

  /**
   * The two wider cascades are not redrawn every frame (see update), so each covers a
   * little more ground than its slice of the view needs: a map that is a frame or two old
   * still reaches the edges of the screen after the camera has moved on.
   */
  private padCascades() {
    this.csm.lights.forEach((l, i) => {
      if (i === 0) return;
      const c = l.shadow.camera;
      const k = 1.08;
      c.left *= k;
      c.right *= k;
      c.top *= k;
      c.bottom *= k;
      c.updateProjectionMatrix();
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
    if (csm.maxFar !== far) {
      csm.maxFar = far;
      csm.updateFrustums();
      this.padCascades();
    }
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
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  #define ATMO_SUN_DIR ${vec3(s.x, s.y, s.z)}
  #define ATMO_SUN_COLOR ${vec3(sc.r * 1.15, sc.g * 1.05, sc.b * 0.85)}
  #define ATMO_FALLOFF 0.012
  float atmoFogAmount( vec3 ro, vec3 rd, float dist ) {
    #ifdef FOG_EXP2
      float a = fogDensity;
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
    gl_FragColor.rgb = mix( gl_FragColor.rgb, atmoFogColor( fogDir ), fogAmt );
    #ifdef GAS_ZONE
      // (what is seen through the gas is lost to it, by as much of it as lies in the way)
      gl_FragColor.rgb = mix( gl_FragColor.rgb, gasColor( fogDir ), gasAmount( cameraPosition, fogDir, fogDist ) );
    #endif
  }
#endif`;
  }

  /**
   * The gas, as the shaders know it: a low dome over one place, thickest at the middle and
   * thinning to nothing at the rim. How much of it lies along a line of sight has an exact
   * answer (the thickness is 1 - r squared, r being how far out toward the rim a point is),
   * so it costs each pixel a square root and is right from outside, from inside and across
   * the rim alike. Empty when the world has none.
   */
  private gasGlsl() {
    const g = this.gas;
    if (!g) return '';
    const s = this.sunDir;
    const vec3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(5)}, ${y.toFixed(5)}, ${z.toFixed(5)})`;
    return /* glsl */ `
  #define GAS_ZONE
  #define GAS_C ${vec3(g.x, g.y, g.z)}
  #define GAS_INV ${vec3(1 / g.r, 1 / g.h, 1 / g.r)}
  #define GAS_THICK ${GAS.thick.toFixed(5)}
  #define GAS_COLOR ${vec3(GAS_COLOR.r, GAS_COLOR.g, GAS_COLOR.b)}
  #define GAS_SUN ${vec3(s.x, s.y, s.z)}
  float gasAmount( vec3 ro, vec3 rd, float dist ) {
    vec3 q = ( ro - GAS_C ) * GAS_INV;
    vec3 d = rd * GAS_INV;
    float a = dot( d, d ), b = dot( q, d ), c = dot( q, q ) - 1.0;
    float h = b * b - a * c;
    if ( h <= 0.0 ) return 0.0;
    h = sqrt( h );
    float t1 = max( ( -b - h ) / a, 0.0 ), t2 = min( ( -b + h ) / a, dist );
    if ( t2 <= t1 ) return 0.0;
    float i1 = c * t1 + b * t1 * t1 + a * t1 * t1 * t1 / 3.0;
    float i2 = c * t2 + b * t2 * t2 + a * t2 * t2 * t2 / 3.0;
    return 1.0 - exp( -GAS_THICK * max( i1 - i2, 0.0 ) );
  }
  vec3 gasColor( vec3 rd ) {
    // a little lit through, looking toward the sun
    return GAS_COLOR * ( 1.0 + 0.45 * pow( max( dot( rd, GAS_SUN ), 0.0 ), 4.0 ) );
  }`;
  }

  /**
   * Where there is ground or a wall behind the gas, that is dimmed by it in its own shader.
   * Where there is only sky there is nothing to dim: the far side of the dome is drawn, and
   * coloured by as much gas as lies between the eye and it.
   */
  private buildGasDome() {
    const g = this.gas;
    if (!g) return;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4( position, 1.0 );
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        ${this.gasGlsl()}
        void main() {
          vec3 ray = vWorld - cameraPosition;
          float dist = length( ray );
          vec3 rd = ray / max( dist, 1e-4 );
          gl_FragColor = vec4( gasColor( rd ), gasAmount( cameraPosition, rd, dist + 1.0 ) );
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    dome.scale.set(g.r, g.h, g.r);
    dome.position.set(g.x, g.y, g.z);
    dome.frustumCulled = false;
    // (before anything else that is seen through: smoke and glass inside it are drawn over it)
    dome.renderOrder = -5;
    dome.matrixAutoUpdate = false;
    dome.updateMatrix();
    this.scene.add(dome);
    this.gasDome = dome;
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

  update() {
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
    this.csm.update();
    // Shadows are the most expensive thing drawn: every caster again, once per cascade.
    // The nearest cascade is redrawn every frame. The two wider ones cover ground further
    // off, where a shadow a few frames old cannot be told from a fresh one, so they take
    // turns: unless the camera has moved or turned enough to need them straight away.
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    this.frame++;
    this.csm.lights.forEach((l, i) => {
      const s = l.shadow;
      s.autoUpdate = false;
      const at = (this.drawn[i] ??= { pos: new THREE.Vector3(Infinity, 0, 0), dir: new THREE.Vector3() });
      const turn = i === 1 ? this.frame % 2 === 0 : this.frame % 4 === 1;
      const moved = at.pos.distanceToSquared(cam.position) > (i === 1 ? 0.5 : 4) || at.dir.dot(_dir) < (i === 1 ? 0.9986 : 0.9976);
      if (i === 0 || turn || moved || !s.map) {
        s.needsUpdate = true;
        at.pos.copy(cam.position);
        at.dir.copy(_dir);
      }
    });
  }
}
