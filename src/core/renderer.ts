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
import { breathe } from './breathe';
import { oneDraw } from './one-draw';

/** a shader as the library keeps it: whether the card has finished making it, and how many materials are drawn with it */
interface Program { id: number; isReady(): boolean; usedTimes: number; getUniforms(): unknown; getAttributes(): unknown }

/** a part of a thing to be drawn once ahead of its being shown, as the world is lit or the other way, and what that is a first drawing with */
interface Ahead { o: THREE.Object3D; lit: boolean | null; keys: string[]; low: boolean }
/** what is got ready for later (the other lighting): this long between one piece of it and the next, ms */
const LATER_APART = 120;
/** the layer a thing is on while it is drawn ahead (see Renderer.drawAhead): nothing else is on it */
const AHEAD_LAYER = 29;
/** development: parts of getting a thing ready left out, to see what each costs (?try=noother,noahead,nolook) */
const TRY = new Set((import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('try') ?? '' : '').split(','));

const shapes = new WeakMap<THREE.BufferGeometry, string>();
/**
 * What kind of shape a thing is drawn from, as the card's driver tells kinds apart: which measures each point has
 * and what sort of number each is kept as, and whether it is one of a list or moved by bones. A shader is made
 * over by the driver for each kind it is first drawn with.
 */
function shapeOf(o: THREE.Object3D): string {
  const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  let s = g ? shapes.get(g) : '';
  if (g && s === undefined) {
    s = Object.keys(g.attributes)
      .sort()
      .map((k) => {
        const at = g.attributes[k] as THREE.BufferAttribute;
        return `${k}${at.itemSize}${at.array?.constructor.name.slice(0, 3) ?? ''}${at.normalized ? 'n' : ''}`;
      })
      .join(',');
    shapes.set(g, s);
  }
  return `${s}${(o as THREE.InstancedMesh).isInstancedMesh ? '|list' : ''}${(o as THREE.SkinnedMesh).isSkinnedMesh ? '|bones' : ''}`;
}

/** The shader each of these materials was last written with. */
export function programsOf(renderer: THREE.WebGLRenderer, materials: Iterable<THREE.Material>): Program[] {
  const out: Program[] = [];
  for (const m of materials) {
    // (Every shader the material has, not only the last made: a see-through thing seen from both sides has one for
    // its back faces and one for its front, and only the front was waited for. Its back faces were then drawn ahead
    // while the card was still making their shader, and the page stood still until it had: 250 to 400 ms, the
    // holographic sight's glass, on coming into the street with one lying there.)
    const props = renderer.properties.get(m) as { currentProgram?: Program; programs?: Map<string, Program> };
    if (props.programs?.size) for (const p of props.programs.values()) out.push(p);
    else if (props.currentProgram) out.push(props.currentProgram);
  }
  return out;
}

/**
 * Over when the card has made every one of these shaders (its own workers make them, where it has any, while the
 * game goes on). (The library's own waiting asks the card every hundredth of a second, of every material, whether
 * its shader is made; and each asking is a trip to the card and back, behind whatever the card is busy with: 17 ms
 * measured, with nothing drawn. Asked once now, and then a few times a good while apart. A dozen shaders asked for
 * together are four seconds in the making on a laptop: waited for as long as six, and then drawn as they are.)
 */
export async function made(programs: Iterable<Program>) {
  const done = () => {
    for (const p of programs) if (!p.isReady()) return false;
    return true;
  };
  for (let i = 0; i < 40 && !done(); i++) await new Promise((r) => setTimeout(r, i ? 150 : 250));
}

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
/** a picture of more points than this has its corners shaded at half size (see `resize`): 1920x1200 is under it, 2560x1440 over */
const AO_WHOLE_UP_TO = 3.0e6;

/**
 * The sun's shadow maps draw most things with one material of three's own, and three chooses that material's shader
 * again whenever the thing it is drawn on is of another sort than the last one was (one drawn many times over, one
 * with bones, one plain): eighteen times a frame in the street, each a sixtieth of a millisecond, and its program
 * swapped each time. Things drawn many times over, and things with bones, are each given one of their own: the same
 * material three's is, so nothing is drawn otherwise (see `sortShadows`).
 */
const SHADOW_OWN = { many: new THREE.MeshDepthMaterial(), boned: new THREE.MeshDepthMaterial() };
/**
 * three works a skeleton's bones out once for each of its own frames, and counts a frame on between its walk over
 * the scene and its drawing of the shadow maps: every body that casts a shadow had its bones worked out twice in the
 * one drawing (127 skeletons a frame for 64 bodies' parts, with the horde about). Once a drawing (a call of three's
 * render: nothing of the game's own runs between the two), and again for the next.
 */
let draws = 0;
const skeletonUpdate = THREE.Skeleton.prototype.update;
THREE.Skeleton.prototype.update = function onceADraw(this: THREE.Skeleton & { drawn?: number }) {
  if (this.drawn === draws) return;
  this.drawn = draws;
  skeletonUpdate.call(this);
};
/** three gives a material that is seen through where its picture is (and the like) a shadow material of its own: those are left to it */
const shadowOfItsOwn = (m: THREE.Material) => {
  const s = m as THREE.MeshStandardMaterial;
  return !!((s.clipShadows && s.clippingPlanes?.length) || (s.displacementMap && s.displacementScale !== 0) || (s.alphaMap && s.alphaTest > 0) || (s.map && s.alphaTest > 0) || s.alphaToCoverage);
};

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
    // (Neither scene is ever moved. Each was made again every frame all the same, and a thing made again tells all it
    // holds to make their places in the world again: three thousand things a frame, still or not, a tenth of the
    // processor's time. Now only what moves makes its own again; whatever sets its own by hand says so as it does.)
    this.scene.matrixAutoUpdate = false;
    this.vmScene.matrixAutoUpdate = false;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    // (The first time a shader is drawn with, three asks the card what it had to say of it, three questions, and
    // each waits for everything the card has been told to do before it: a few milliseconds with the card at rest,
    // a third of a second measured with it busy. Asked while the game is being made, where a broken shader is
    // wanted known; not of somebody playing. `?shaderlog` asks anyway.)
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV ? !new URLSearchParams(location.search).has('asplayed') : new URLSearchParams(location.search).has('shaderlog');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    // (see onceADraw)
    const render = this.renderer.render.bind(this.renderer);
    this.renderer.render = (scene, camera) => {
      draws++;
      render(scene, camera);
    };
    this.vmCamera.layers.enableAll();
    this.buildComposer();
    this.resize();
    // a phone changes size on rotation, on entering full screen and when its address bar hides,
    // and not every browser reports all of those as a plain resize
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    document.addEventListener('fullscreenchange', () => setTimeout(onResize, 250));
    window.visualViewport?.addEventListener('resize', onResize);
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
    // Left to itself this pass looks through the scene every frame for anything see-through, and finding one (a
    // pane of glass is enough) draws the whole scene twice more, to keep its shading off such things: measured
    // 2026-10-12 at 3 to 5 ms of a frame of 18 on the card (2560x1440), and a walk over all eleven thousand
    // things in the scene four times a frame besides. The picture with and without was the same to the eye: what
    // is see-through here is glass, and the shade of a corner behind a pane belongs there.
    // (Said to the pass itself as well: its setting only stops the looking when it CHANGES, and off is what it
    // starts at, so setting it off alone left the pass to turn it on again by itself.)
    (this.ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
    c.transparencyAware = false;
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

  /** The player changed a graphics option (Esc menu). */
  applyQuality(q: Partial<QualitySettings>) {
    Object.assign(this.quality, q);
    this.composer.multisampling = this.quality.msaa;
    this.ao.enabled = this.quality.ao;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // the screen's own pixels times the share the player chose: never changed behind their back
    const pr = Math.min(window.devicePixelRatio, 2) * this.quality.renderScale;
    // The shading of corners is worked out at half the picture's size each way, and spread back over it by depth,
    // once the picture is a big one (2026-10-12). It looks, for each point, at eight places within a metre and a
    // half of it, and for whatever is near the eye those are spread over half the screen: at 5120x1440 it was 6 to
    // 10 ms of the graphics card's 20 to 30 a frame, and 49 of 69 in the hospital's long ward (fourteen frames a
    // second, for that alone). At half size it is 4. Laid over one another with the game held still, at that
    // screen's own size, the two pictures are 0.4 to 1.3 apart in 255 on average, and ninety-nine points in a
    // hundred within 3 to 14: what differs is the edges of grass. A small picture keeps it at its own size, where
    // it costs little and half of it is coarse.
    const half = this.quality.aoHalfRes || w * h * pr * pr > AO_WHOLE_UP_TO;
    if (this.ao.configuration.halfRes !== half) this.ao.configuration.halfRes = half;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  /**
   * Build a scene's shader programs ahead of time. Everything is drawn into the composer's
   * linear buffer rather than straight to the canvas, and three builds a different program
   * for each of the two. Warming up against the canvas builds a set that is never used and
   * leaves the real ones to be compiled, one freeze at a time, as things first come into view.
   */
  precompile(scene: THREE.Scene, camera: THREE.Camera) {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.inputBuffer);
    this.renderer.compile(scene, camera);
    this.renderer.setRenderTarget(prev);
  }

  /**
   * How the world is lit: with the lamps' real lights in it, or without (see Lamps); and a way to have it lit
   * either way for a moment, with the way back. A shader is written for the lights there are; a thing got ready
   * under the one lighting only was a freeze the first time it was drawn under the other. Measured 2026-10-12,
   * with a jeep, a pack and three bodies in sight that had come since the game loaded: 4.6 seconds in which
   * nothing moved, the first time the player switched on the lamp on their own gun; and four more at nightfall,
   * for what was in sight then.
   */
  lighting: { lit(): boolean; as(lit: boolean): () => void } | null = null;
  /** shaders that are kept whatever becomes of the things first drawn with them (see `keep`) */
  private kept = new Set<Program>();
  /** how many things are being got ready to be shown just now: what is for later waits on them */
  private readying = 0;

  /**
   * A thing that has just come is got ready to be drawn in the world, and this is over when it is. The thing is
   * put into the world after: its first frame then costs what any other does. Four things are done ahead that
   * were all done in the frame a thing was first drawn in:
   *   - its shaders are written, and made by the graphics card's own workers where it has them (a part of the
   *     thing at a time, each in a frame's spare time: a shader asked for is a millisecond or several of writing
   *     before the card has it);
   *   - each shader is looked over (see `lookOver`);
   *   - its pictures are put on the card, one to a frame's spare time (see `send`);
   *   - and each part is drawn once, off the picture (see `drawAhead`).
   * That is for the world as it is lit now. The same is then done for the other lighting, behind everything else
   * and a little at a time (see `workLater`): nobody waits for that.
   */
  async ready(obj: THREE.Object3D | THREE.Object3D[]) {
    const list = Array.isArray(obj) ? obj : [obj];
    const drawn: THREE.Object3D[] = [];
    for (const o of list) {
      o.traverse((c) => {
        const d = c as THREE.Mesh & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
        if (d.isMesh || d.isPoints || d.isLine || d.isSprite) drawn.push(c);
      });
    }
    this.readying++;
    try {
      const { programs, entries } = await this.write(drawn, null);
      await made(programs);
      if (!TRY.has('nolook')) await this.lookOver(programs);
      for (const o of list) await this.send(o);
      if (!TRY.has('noahead')) await this.drawAhead(entries);
    } finally {
      this.readying--;
    }
    if (this.lighting && !TRY.has('noother')) {
      this.later.push({ drawn, lit: !this.lighting.lit() });
      void this.workLater();
    }
  }

  /**
   * The shaders of these parts written, as the world is lit (null) or as it would be lit the other way; and what
   * there then is to draw ahead with them.
   * @param slowly for later: a shader newly asked for is not followed at once by another
   */
  private async write(drawn: THREE.Object3D[], lit: boolean | null, slowly = false) {
    const programs = new Set<Program>(), entries: Ahead[] = [];
    // (the one part and nothing under it: each is come to in its turn)
    const only = (o: THREE.Object3D) => ({ traverse: (f: (x: THREE.Object3D) => void) => f(o), traverseVisible: (f: (x: THREE.Object3D) => void) => f(o) }) as unknown as THREE.Object3D;
    const count = () => (this.renderer.info.programs as unknown[] | null)?.length ?? 0;
    for (const o of drawn) {
      await breathe();
      const had = count();
      const back = lit === null ? null : (this.lighting?.as(lit) ?? null);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.composer.inputBuffer);
      const ps = programsOf(this.renderer, this.renderer.compile(only(o), this.camera, this.scene) as unknown as Set<THREE.Material>);
      this.renderer.setRenderTarget(prev);
      back?.();
      const shape = shapeOf(o);
      const keys = ps.map((p) => `${p.id}|${shape}`);
      for (const p of ps) programs.add(p);
      if (keys.some((k) => !this.drawnWith.has(k))) entries.push({ o, lit, keys, low: slowly });
      // (A shader newly asked for is the card's one thread busy for a moment, before its workers have it: two
      // asked for on each other's heels are a frame half as long again. For later, they are asked for apart.)
      if (slowly && count() > had) await new Promise((r) => setTimeout(r, LATER_APART));
    }
    // (The library throws a shader away when the last thing drawn with it is: the last of the infected of a kind
    // to be cleared off, somebody who left; and the next of them was a shader made in the frame again. Counted
    // as used once more than it is, it is kept.)
    for (const p of programs) {
      if (this.kept.has(p)) continue;
      this.kept.add(p);
      p.usedTimes++;
    }
    return { programs, entries };
  }

  private later: { drawn: THREE.Object3D[]; lit: boolean }[] = [];
  private working = false;
  /**
   * What has been got ready for the world as it is lit is got ready for the other lighting as well: when nothing
   * is waiting to be shown, one part at a time, the shaders asked for well apart, and each part drawn ahead a
   * tenth of a second after the last. Done with the rest, in the moment a thing came, it was all of it twice over
   * at the busiest time there is (coming into the game, with every kind of thing arriving at once): counted over
   * the first forty seconds of a session, four times the frames over a thirtieth of a second.
   */
  private async workLater() {
    if (this.working) return;
    this.working = true;
    try {
      for (let job; (job = this.later.shift()); ) {
        this.laterNow = job.lit;
        // (Behind what somebody waits to be shown, but not for ever: online something is always arriving, and the
        // other lighting's shaders went unmade for minutes, to be made all at once, the whole world standing still,
        // the first time a lamp came on: 5 to 7 seconds measured, passing a cellar's bulbs by day.)
        const since = performance.now();
        while (this.readying > 0 && !this.rushing && performance.now() - since < 1500) await new Promise((r) => setTimeout(r, LATER_APART));
        const { programs, entries } = await this.write(job.drawn, job.lit, !this.rushing);
        await made(programs);
        if (!TRY.has('nolook')) await this.lookOver(programs);
        if (!TRY.has('noahead')) await this.drawAhead(this.rushing ? entries.map((e) => ({ ...e, low: false })) : entries);
      }
    } finally {
      this.working = false;
      this.laterNow = null;
      this.rushing = false;
    }
  }
  /** the lighting the job in hand is being got ready for (null: none in hand) */
  private laterNow: boolean | null = null;
  /** what is waiting for the other lighting is being got ready at once (see `readyToLight`) */
  private rushing = false;

  /**
   * Whether the world can be drawn lit so (the lamps' real lights in it or not) without a shader being made in the
   * frame: nothing that has come is still waiting to be got ready for that lighting. If something is, it is got
   * ready now, ahead of everything and no longer spaced out, and the answer is yes when it is. (Lamps.update holds
   * the real lights back until then: a lamp's light falls on things a moment late, where the world stood still.)
   */
  readyToLight(lit: boolean): boolean {
    if (!this.lighting || (this.laterNow !== lit && !this.later.some((j) => j.lit === lit))) return true;
    this.rushing = true;
    void this.workLater();
    return false;
  }

  /** what has been drawn with already: a shader, and the kind of shape it was drawn with (see `drawAhead`) */
  private drawnWith = new Set<string>();
  private aheadQueue: (Ahead & { job: { left: number; done: () => void } })[] = [];
  private aheadLow: (Ahead & { job: { left: number; done: () => void } })[] = [];
  private aheadLowAt = 0;
  private aheadTarget: THREE.WebGLRenderTarget | null = null;
  private drawingAhead = false;

  /**
   * Each of these is drawn once, off the picture, in the spare of a frame: one to a frame.
   *
   * The first time anything is DRAWN with a shader, the card's driver has work of its own to do for it, however
   * little is drawn: the shader is made over for the kind of shape it is given and the kind of picture it is
   * drawn into, and nothing is shown until that is done. It cannot be asked for ahead except by drawing. Measured
   * 2026-10-12, with every shader already written, made and looked over: the first frame the lamps' lights were in
   * the world (the player's own gun lamp switched on, by day) was 640 to 700 ms, none of it the game's; with the
   * world drawn once off the picture before, under that lighting, into four pixels, it was 15 to 17, a frame like
   * any other. So: four pixels of the same kind as the game's own picture, and each new thing drawn into them
   * once under each lighting before it is ever shown.
   *
   * It is drawn from inside the game's own drawing of the world, when that is done (`scene.onAfterRender`): the
   * library then keeps what it knows of the lights for this drawing apart from what it knows for the game's, and
   * the lamps can be put in or taken out for it without every material in sight being looked up afresh in the
   * frame after.
   */
  private drawAhead(entries: Ahead[]): Promise<void> {
    const fresh = entries.filter((e) => e.keys.some((k) => !this.drawnWith.has(k)));
    // (nothing is drawn while the page is hidden: what is asked for then is drawn in its first frames, as it was)
    if (!fresh.length || (typeof document !== 'undefined' && document.hidden)) return Promise.resolve();
    this.scene.onAfterRender = this.aheadSlice;
    return new Promise<void>((done) => {
      const job = { left: fresh.length, done };
      for (const e of fresh) (e.low ? this.aheadLow : this.aheadQueue).push({ ...e, job });
      // (and never waited on for long, if frames are not coming: it is drawn when they do)
      setTimeout(done, 5000);
    });
  }

  private aheadSlice = () => {
    if (this.drawingAhead || (!this.aheadQueue.length && !this.aheadLow.length)) return;
    // (in the game's own frame, and not in some other drawing of the world)
    if (this.renderer.getRenderTarget() !== this.composer.inputBuffer) return;
    // (what somebody is waiting to be shown first; what is for the other lighting after, and well apart)
    const now = performance.now();
    const from = this.aheadQueue.length ? this.aheadQueue : now - this.aheadLowAt >= LATER_APART ? this.aheadLow : null;
    if (!from) return;
    for (let skipped = 0; skipped < 400; skipped++) {
      const e = from.shift();
      if (!e) return;
      const fresh = e.keys.some((k) => !this.drawnWith.has(k));
      if (fresh) {
        this.drawingAhead = true;
        try {
          this.drawOnce([e.o], e.lit);
        } finally {
          this.drawingAhead = false;
        }
        for (const k of e.keys) this.drawnWith.add(k);
        if (e.low) this.aheadLowAt = now;
      }
      if (--e.job.left === 0) e.job.done();
      if (fresh) return;
    }
  };

  /** These, drawn once into four pixels that are never shown: as the world is lit (null), or lit as asked. */
  private drawOnce(list: THREE.Object3D[], lit: boolean | null, all = false) {
    const R = this.renderer, scene = this.scene, cam = this.camera, inBuf = this.composer.inputBuffer;
    const target = (this.aheadTarget ??= new THREE.WebGLRenderTarget(4, 4, {
      samples: inBuf.samples,
      type: inBuf.texture.type,
      format: inBuf.texture.format as THREE.PixelFormat,
      colorSpace: inBuf.texture.colorSpace as THREE.ColorSpace,
      depthBuffer: true,
    }));
    const undo: (() => void)[] = [];
    const lights: THREE.Object3D[] = [];
    if (!all) {
      for (const o of list) {
        // shown, with all it hangs from; in the world, if it is not yet; on the one layer that is drawn; and not asked whether it is in sight
        let top: THREE.Object3D = o;
        for (let t: THREE.Object3D | null = o; t; t = t.parent) {
          if (!t.visible) {
            const hidden = t;
            hidden.visible = true;
            undo.push(() => (hidden.visible = false));
          }
          top = t;
        }
        if (top !== scene) {
          const loose = top;
          scene.add(loose);
          loose.updateMatrixWorld(true);
          undo.push(() => scene.remove(loose));
        }
        const mask = o.layers.mask, culled = o.frustumCulled;
        o.layers.enable(AHEAD_LAYER);
        o.frustumCulled = false;
        undo.push(() => {
          o.layers.mask = mask;
          o.frustumCulled = culled;
        });
        const many = o as THREE.InstancedMesh;
        if (many.isInstancedMesh && many.count === 0) {
          many.count = 1;
          undo.push(() => (many.count = 0));
        }
      }
      // (every light there is counts for this drawing as it does for the game's: a shader is written for how many there are)
      scene.traverse((o) => {
        if (!(o as THREE.Light).isLight || o.layers.isEnabled(AHEAD_LAYER)) return;
        o.layers.enable(AHEAD_LAYER);
        lights.push(o);
      });
    } else {
      // (The whole world as it stands, whether or not it is in sight. Not what has nothing in it yet, a list of
      // some furniture none of which is near: to draw one of each would be to put every picture in the game on
      // the card at once, which is what the game was changed not to do.)
      scene.traverse((o) => {
        if (!o.frustumCulled) return;
        o.frustumCulled = false;
        undo.push(() => (o.frustumCulled = true));
      });
    }
    const prev = R.getRenderTarget(), layers = cam.layers.mask, auto = scene.matrixWorldAutoUpdate;
    const shadows = [R.shadowMap.autoUpdate, R.shadowMap.needsUpdate];
    if (!all) {
      cam.layers.set(AHEAD_LAYER);
      // (Where everything is has just been worked out, for the frame this is in. And the sun's shadow maps are
      // left as they are. Drawing the thing into them as well was tried, for the shaders shadows are drawn with:
      // the three maps cleared and drawn whole again the frame after, every frame something was drawn ahead, and
      // the frame the lamps are first lit in no shorter for it.)
      scene.matrixWorldAutoUpdate = false;
      R.shadowMap.autoUpdate = false;
      R.shadowMap.needsUpdate = false;
    }
    const back = lit === null ? null : (this.lighting?.as(lit) ?? null);
    try {
      R.setRenderTarget(target);
      R.render(scene, cam);
    } finally {
      R.setRenderTarget(prev);
      back?.();
      cam.layers.mask = layers;
      scene.matrixWorldAutoUpdate = auto;
      R.shadowMap.autoUpdate = shadows[0];
      R.shadowMap.needsUpdate = shadows[1];
      for (const l of lights) l.layers.disable(AHEAD_LAYER);
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
    }
  }

  /**
   * While the game loads, with the screen that says so up: the whole world drawn once off the picture under each
   * lighting (see `drawAhead` for why). What it costs was being paid in the first frames of the menu for the one
   * lighting, and in the frame the first lamp was lit for the other.
   */
  drawWorldAhead() {
    this.drawingAhead = true;
    try {
      if (this.lighting) this.drawOnce([], !this.lighting.lit(), true);
      this.drawOnce([], null, true);
    } finally {
      this.drawingAhead = false;
    }
    // (and what was drawn with is known for drawn with: nothing of the world as it stood is drawn ahead again)
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m || !o.visible) return;
      const shape = shapeOf(o);
      for (const x of Array.isArray(m) ? m : [m]) {
        if (seen.has(x)) continue;
        seen.add(x);
        const ps = (this.renderer.properties.get(x) as { programs?: Map<string, Program> }).programs;
        for (const p of ps?.values() ?? []) this.drawnWith.add(`${p.id}|${shape}`);
      }
    });
  }

  private looked = new WeakSet<Program>();
  /**
   * A shader that is made is looked over before anything is drawn with it. The first time the library draws with
   * one it asks the card for the name and the place of every setting in it, a trip to the card and back for each:
   * hundreds, for a shader written for the sun's three shadow maps and eight lamps, three to six milliseconds of
   * it a shader. Left to the frame, the first frame the lamps were lit in had that to do for every shader in
   * sight, none of which had been drawn with before: 620 to 670 ms measured, with nothing being made. One shader
   * to a frame's spare time, here.
   */
  private async lookOver(programs: Iterable<Program>) {
    for (const p of programs) {
      if (this.looked.has(p) || !p.isReady()) continue;
      await breathe();
      this.looked.add(p);
      p.getUniforms();
      p.getAttributes();
    }
  }

  /** Every shader there is, looked over (see `lookOver`): asked for when the game has loaded, for all that were written while it did. */
  async lookOverAll() {
    const all = this.renderer.info.programs as unknown as Program[] | null;
    if (!all) return;
    await made([...all]);
    await this.lookOver([...all]);
  }

  /**
   * A thing's pictures are put on the graphics card before it is first drawn, one to a frame's spare time. Left to
   * the frame it is first drawn in, a thing with seven pictures was seven of them sent in that one frame.
   */
  async send(obj: THREE.Object3D) {
    const pictures = new Set<THREE.Texture>();
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) {
        for (const v of Object.values(mat)) {
          const t = v as THREE.Texture | null;
          if (t && t.isTexture && !t.isRenderTargetTexture && t.image) pictures.add(t);
        }
      }
    });
    for (const t of pictures) {
      await breathe();
      this.renderer.initTexture(t);
    }
  }

  render(dt: number) {
    if (!this.tendHeld) this.tend();
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  /** (for checking things: the look over the scene that `tend` does, held) */
  tendHeld = false;
  /** where in each scene's groups the look has got to */
  private tendAt = [0, 0];
  /**
   * What has come into the world since is looked at, a little every frame: the scenes' groups in turn, the whole of
   * each in about half a second. (All at once every second, it was two to six milliseconds of the one frame online,
   * with every body's bones to go through.) Each thing: drawn in one go if it is seen through from both sides (see
   * src/core/one-draw.ts), and given its shadow material (SHADOW_OWN).
   */
  private tend() {
    [this.scene, this.vmScene].forEach((scene, s) => {
      const kids = scene.children, n = kids.length;
      if (!n) return;
      const per = Math.ceil(n / 30);
      for (let k = 0; k < per; k++) {
        const o = kids[(this.tendAt[s] + k) % n];
        oneDraw(o);
        if (scene === this.scene) this.sortShadows(o);
      }
      this.tendAt[s] = (this.tendAt[s] + per) % n;
    });
  }

  private sortShadows(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      const had = m.customDepthMaterial;
      // (a shadow material the game gave a thing for itself is its own)
      if (had !== undefined && had !== SHADOW_OWN.many && had !== SHADOW_OWN.boned) return;
      const own = (m as THREE.InstancedMesh).isInstancedMesh ? SHADOW_OWN.many : (m as THREE.SkinnedMesh).isSkinnedMesh ? SHADOW_OWN.boned : undefined;
      m.customDepthMaterial = own && !Array.isArray(m.material) && !shadowOfItsOwn(m.material) ? own : undefined;
    });
  }
}
