import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  HueSaturationEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  NoiseEffect,
  BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export interface QualitySettings {
  renderScale: number;
  msaa: number;
  ao: boolean;
  aoHalfRes: boolean;
}

/**
 * Owns the WebGL renderer and the post-processing chain:
 *   world pass -> N8AO -> viewmodel pass (own FOV, depth cleared) -> bloom/tonemap/grade
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 1800);
  readonly vmScene = new THREE.Scene();
  readonly vmCamera = new THREE.PerspectiveCamera(48, 1, 0.01, 20);
  composer!: EffectComposer;
  ao!: N8AOPostPass;
  vignette!: VignetteEffect;
  chroma!: ChromaticAberrationEffect;
  grade!: HueSaturationEffect;
  contrast!: BrightnessContrastEffect;
  bloom!: BloomEffect;
  quality: QualitySettings;
  private vmPass!: RenderPass;

  constructor(canvas: HTMLCanvasElement, quality: Partial<QualitySettings> = {}) {
    this.quality = { renderScale: 1, msaa: 4, ao: true, aoHalfRes: false, ...quality };
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.vmCamera.layers.enableAll();
    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get maxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  private buildComposer() {
    const q = this.quality;
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: q.msaa,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
    const c = this.ao.configuration;
    c.aoRadius = 1.6;
    c.distanceFalloff = 0.6;
    c.intensity = 2.4;
    c.aoSamples = 8;
    c.denoiseSamples = 4;
    c.denoiseRadius = 10;
    c.halfRes = q.aoHalfRes;
    c.gammaCorrection = false;
    c.color = new THREE.Color(0.02, 0.025, 0.03);
    this.ao.enabled = q.ao;
    this.composer.addPass(this.ao);

    // Viewmodel: drawn after AO so the gun never gets world AO halos; depth is
    // cleared so it never clips into walls.
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clearPass.enabled = true;
    this.vmPass.clearPass.setClearFlags(false, true, false);
    this.vmPass.ignoreBackground = true;
    this.composer.addPass(this.vmPass);

    this.bloom = new BloomEffect({
      intensity: 0.5,
      luminanceThreshold: 1.35,
      luminanceSmoothing: 0.35,
      mipmapBlur: true,
      radius: 0.72,
    });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.3 });
    this.grade = new HueSaturationEffect({ saturation: -0.08, hue: 0 });
    this.contrast = new BrightnessContrastEffect({ contrast: 0.06, brightness: 0 });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.045;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.chroma));
    this.composer.addPass(new EffectPass(this.camera, tone, this.grade, this.contrast, this.vignette, grain));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // fixed full quality: always the screen's native pixels, never scaled down at runtime
    const pr = Math.min(window.devicePixelRatio, 2) * this.quality.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  render(dt: number) {
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
