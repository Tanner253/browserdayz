// The survivor in the middle of the inventory, alive.
//
// It was a still picture of the character's file as it rests (see renderDoll in ../ui/icons.ts), drawn again every
// time something was put on. This is the game's own body (Avatar: the one every other player is drawn with), stood
// in a room of its own with three lamps, breathing and shifting its weight as anybody standing does, wearing what
// is worn, holding what is in the hands the way that kind of thing is held, with what is slung on its back, and
// turned by a drag.
//
// How it gets onto the page. The body's pictures are on the graphics card once, for the game; a second drawing
// surface would need them all again (a gun's alone are hundreds of megabytes, and the big ones are let go of by the
// page once the card has them: see Assets.thin). So it is drawn by the game's own renderer: into a small picture of
// its own (smoothed edges, and room over white for the lamps' glints), and that is laid onto the game's picture
// where the figure stands on the page, after the game's frame is done. The page's dark veil has a hole in it just
// there (the end of ../ui/hud.css), so the game's picture is what is seen in it; everything else of the page, the
// places beside the figure, the outline and the word shown while a thing is dragged, a thing dragged across, lies
// over it as it did. Nothing is read back from the card, and nothing is drawn while the inventory is shut.
//
// What is seen in the hole has to be what the veil would have shown there, or the hole is a box on the page. So
// the veil is made again in it: what of the world lies behind is copied (on the card) out of the game's finished
// picture, blurred as the veil blurs it and thinned of colour as the veil thins it, and the veil's own dark laid
// over it by the same rule the page lays it. The figure is put on that. With no figure in it the hole would not be
// seen at all: there is no box, only the survivor standing on the page.
//
// What it is painted with. Every lit material in the game is written for the sun's shadow maps and the hour
// (Atmosphere.register), and a body dropped into another room would be shaded by the world's shadows at wherever
// that room's middle happens to be. So each paint here is a plain copy of the game's, as the pictures of things
// are made with, kept one to each of the game's and following it: whatever picture the game's has on just now
// (the sharp one while the thing is in the hands, the world's when it is not) is the picture this one has.

import * as THREE from 'three';
import { breathe } from '../core/breathe';
import { LEAN } from '../core/device';
import { made, programsOf, type Renderer } from '../core/renderer';
import type { Emote } from '../sim/emotes';
import { ITEMS } from '../sim/items';
import type { Atmosphere } from '../world/atmosphere';
import { Avatar, GEAR, GEAR_SHOWN, facepiece } from './avatar';
import { lookFor, lookPatch, lookUniforms, setLookUniforms, suitPatch } from './look';
import type { ItemModels } from './loot';
import { inFist, type Held } from './in-fist';

/** a thing as it is seen in somebody's hands (`plumb`: the part of it that hangs from the hand, and is kept upright: see `inFist`) */

/** Where things are on the page, in the page's own pixels from its top left (asked of the inventory each frame). */
export interface DollBox {
  /** the figure's own place: it is stood in the middle of this, as tall as this */
  x: number;
  y: number;
  w: number;
  h: number;
  /** the hole in the veil: the figure's place and the places beside it, as much of them as is in sight (their column scrolls) */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  /**
   * The veil itself, to be made again in the hole: the box it covers; its two colours, at its middle and at its
   * far corner (red, green, blue to 255, and how much of it there is, 0..1); how far it blurs what is behind it
   * (the page's pixels; 0: it does not) and how much of that colour it leaves. And the band of it the page lays
   * round the inside of the hole's edge with no blur (see `laying`): how wide it is whole, and over how much more
   * it thins to nothing, in the page's pixels (0: the page lays none).
   */
  veil: { x: number; y: number; w: number; h: number; from: number[]; to: number[]; blur: number; sat: number; band: number; thins: number };
}

/** what the game tells it, asked each frame it is shown (and now and then while it is not, so that it is right the moment it is) */
export interface DollHost {
  /** whose figure it is: what a survivor looks like follows from their name */
  name(): string;
  /** what is worn that a body shows (see GEAR_SHOWN) */
  worn(): string[];
  /** what is in the hands, with what is fitted to it (null: nothing) */
  hands(): { id: string; mods: string[] } | null;
  /** a gun, or a thing to hit with, as it is seen in somebody's hands (null: it is neither) */
  held(id: string, mods: string[]): Held | null;
  /** what is slung on the back, said in a line that changes when it does; and the things themselves */
  back(): string;
  slung(): THREE.Object3D[];
  /** where it stands on the page (null: the inventory is shut, or the figure is scrolled out of sight) */
  box(): DollBox | null;
  /** whether it was drawn this frame: the hole in the page's veil is open for exactly as long as it is */
  shown(on: boolean): void;
}

/** how much of the room the figure's own place takes in: this tall and at least this wide, metres, about a point this high */
const FRAME = { tall: 1.98, wide: 0.92, mid: 0.9 };
/** the lens: a long one from well back, so the figure is not bent by it, set a little over its middle and looking down at it */
const LENS = { fov: 17, lift: 0.34 };
/** where it is seen from at rest: a little to its right, where what is in its hands is seen along its side and not end on (radians round it) */
const REST = 0.52;
/** a drag turns it this far for each of the page's pixels, radians; let go, it turns on for about this long, seconds, and no faster than this */
const TURN = 0.0125, GLIDE = 0.32, SPIN_MOST = 8;
/** shut, what it wears and holds is asked after this often, ms */
const ASK_SHUT = 300;
/** while it only stands there its own picture is drawn again this often, ms; and on every frame for this long after anything on it has changed */
const STANDING_EVERY = 1000 / 30, LIVELY = 2600;
/** the layer a thing is on while it is drawn ahead (see `prime`); the lamps are on it for good, for a shader is written for the lamps there are */
const AHEAD = 29;
/** a blur wider than this many of the game's own pixels is worked at half size (it is the same blur to the eye, at a quarter of the work) */
const BLUR_WHOLE = 9;
/** the pictures a paint may have, each kept the same as the game's own */
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;
type Painted = THREE.Material & Partial<Record<(typeof MAPS)[number], THREE.Texture | null>>;

const ORIGIN = new THREE.Vector3(), STILL = new THREE.Vector3();
const _eye = new THREE.Vector3(), _size = new THREE.Vector2(), _at = new THREE.Vector2(), _clear = new THREE.Color();
const _view = new THREE.Vector4(), _cut = new THREE.Vector4(), _turn = new THREE.Quaternion();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** a flat sheet over the whole of whatever is drawn into: every pass here that is not the room itself is one */
const SHEET = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }`;

/** one such pass: its sheet, and the lens that three asks for and the sheet does not use */
function pass(mat: THREE.ShaderMaterial) {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return { scene, camera: new THREE.Camera(), u: mat.uniforms };
}

/** where on the game's picture things are, for one box of the page: worked out when the page says the box has moved */
interface Plan {
  /** what is drawn over, in the game's own pixels: from its left, from its top, across, down */
  x: number;
  y: number;
  w: number;
  h: number;
  /** what of the game's picture is copied to be blurred: the same, and as far past it as the blur reaches */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** how far the veil blurs, in the game's own pixels (0: not at all), and the size it is worked at (1, or half: 2) */
  sigma: number;
  k: number;
  /** how big the game's picture was when this was worked out, in its own pixels, and how many of those the renderer has to one of its own measure */
  wide: number;
  high: number;
  pr: number;
}

export class Doll {
  /** made, and fit to be drawn: until then, and if making it fails, the page keeps its still picture */
  alive = false;
  private readonly scene = new THREE.Scene();
  /** the lens and the lamps: they go round the figure together, which stands still (its arms are worked out for a body that faces the way it thinks it does) */
  private readonly rig = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera(LENS.fov, 0.46, 1, 40);
  private readonly body = new Avatar();
  /** the dog tag at the breastbone, as the body in the world wears it (src/game/worn-tag.ts) */
  wearTag(kind: 'steel' | 'gold' | null) {
    this.body.wearTag(kind);
  }
  private readonly uniforms = lookUniforms();
  private hair: THREE.MeshStandardMaterial[] = [];
  private readonly ground: THREE.Mesh;
  /** the figure's own picture: half-float, so a glint off a barrel is rolled off toward white and not cut at it */
  private readonly target = new THREE.WebGLRenderTarget(64, 128, { samples: 4, type: THREE.HalfFloatType, depthBuffer: true });
  /** four pixels of the same kind as the figure's picture, never shown: what is new is drawn into them once before it is drawn in earnest (see `prime`) */
  private readonly ahead = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType, depthBuffer: true });
  /** what of the game's picture lies behind the hole, copied from it each frame; and the two small pictures it is blurred through, across and then down */
  private world: THREE.FramebufferTexture | null = null;
  private readonly soft = [0, 1].map(() => new THREE.WebGLRenderTarget(8, 8, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
  private readonly blur: ReturnType<typeof pass>;
  private readonly lay: ReturnType<typeof pass>;
  /** this game's paint for each of the game's own, and the same pairs as a list to go down each frame */
  private paints = new Map<THREE.Material, THREE.Material>();
  private pairs: [Painted, Painted][] = [];
  private mine = new WeakSet<THREE.Material>();
  private looked = new WeakSet<object>();
  /** the paints that have been got ready for this room already (see `warm`) */
  private met = new WeakSet<THREE.Material>();
  // what it was last told, and which asking each kind of thing is on (a later one overtakes an earlier)
  private name = '\u0000';
  private wornKey = '\u0000';
  private handKey = '\u0000';
  private backKey = '\u0000';
  private wearN = 0;
  private holdN = 0;
  private slingN = 0;
  /** drawn in the last frame; and when it was last asked what it wears */
  private showing = false;
  private askedAt = 0;
  /** when its own picture was last drawn, and how much time the body is owed since; it is drawn on every frame until `livelyTill`, and at once while `stale` */
  private drawnAt = 0;
  private owed = 0;
  private livelyTill = 0;
  private stale = true;
  // the turn: where it is seen from, how fast that is changing, whether a hand is on it, and where it is going back to
  private angle = REST;
  private vel = 0;
  private gripped = false;
  private movedAt = 0;
  private goal: number | null = null;
  /** seconds until a gun newly in the hands is looked over (-1: none is waiting to be) */
  private lookOver = -1;
  /** an emote being shown (Emotes): what, how long since it was begun, how long since one played once ended */
  private performing: { e: Emote; t: number; over: number } | null = null;
  /** what hangs from the hand just now and is kept upright (null: nothing does) */
  private plumb: THREE.Object3D | null = null;
  /** what the figure has on that is hung on the body, and whether anything is in its hands (or on its way into them) */
  private worn: { id: string; obj: THREE.Object3D }[] = [];
  private holding = false;
  /** the page's box it was last drawn for, and what was worked out for it */
  private box: DollBox | null = null;
  private plan: Plan | null = null;
  /** where the game's picture is on the page (null: to be measured: see `draw`) */
  private on: DOMRect | null = null;
  /** the passes that lay the picture on have been drawn once ahead (see `layAhead`) */
  private laidAhead = false;
  /** pictures are on their way back to the card (see `tend`) */
  private tending = false;

  constructor(private r: Renderer, private atmo: Atmosphere, private models: ItemModels, private h: DollHost) {
    // The room. The sky's own picture is what steel and glass have to shine with, at a strength of this room's
    // own: it does not go dark with the hour. Three lamps: a warm one from the front and over the left, a low cool
    // one from the right for what that leaves in shadow, and a strong one from behind that picks the figure's edge
    // out of the dark it stands in.
    this.scene.environment = atmo.envMap;
    this.scene.environmentIntensity = 0.5;
    const key = new THREE.DirectionalLight(0xfff1de, 3.1), fill = new THREE.DirectionalLight(0xa9bddb, 0.75), rim = new THREE.DirectionalLight(0xc3d6ff, 2.9);
    // (in the rig the lens is at -z, looking at +z: the picture's left is +x)
    key.position.set(2.7, 3.3, -4.2);
    fill.position.set(-3.4, 1.1, -3.4);
    rim.position.set(-2.4, 3.1, 3.9);
    this.camera.rotation.order = 'YXZ';
    for (const lamp of [key, fill, rim]) lamp.layers.enable(AHEAD);
    this.rig.add(this.camera, key, fill, rim);
    this.ground = this.floor();
    this.scene.add(this.rig, this.ground);
    this.blur = this.blurring();
    this.lay = this.laying();
    window.addEventListener('resize', () => (this.on = null));
    // (a phone the game has already failed to start on is given nothing more to hold: it keeps the still picture)
    if (!LEAN) void this.make();
  }

  // ------------------------------------------------------------ making it

  private async make() {
    // (A body is got ready for the world before whoever asked for it has it: Avatar.onMade. This one is never in
    // the world, and what is got ready there for the lamps' lighting, a while after, would by then be these paints
    // written for a lighting they are never drawn under. So that is passed over for this body, and for no other.)
    const ready = Avatar.onMade;
    const mine: typeof Avatar.onMade = (parts, kind) => (parts[0] === this.body.root ? Promise.resolve() : ready(parts, kind));
    Avatar.onMade = mine;
    try {
      this.name = this.h.name();
      await this.body.load(this.atmo, 0, false, lookFor(this.name));
      this.repaint();
      this.scene.add(this.body.root);
      this.stand(0.05);
      await this.warm([this.body.root, this.ground], true);
      // (and the passes that lay its picture onto the game's, each written for what it is drawn into)
      const R = this.r.renderer, prev = R.getRenderTarget(), flat = new Set<ReturnType<typeof programsOf>[number]>();
      for (const [p, into] of [[this.blur, this.soft[0]], [this.lay, null]] as const) {
        R.setRenderTarget(into);
        for (const q of programsOf(R, R.compile(p.scene, p.camera) as unknown as Set<THREE.Material>)) flat.add(q);
      }
      R.setRenderTarget(prev);
      await made(flat);
      // (dressed, and with its hands full, before it is ever shown: it is not seen bare first)
      await Promise.all(this.ask());
      this.alive = true;
    } catch (e) {
      if (import.meta.env.DEV) console.warn('the figure in the inventory could not be made: the still picture stays', e);
    } finally {
      if (Avatar.onMade === mine) Avatar.onMade = ready;
    }
  }

  /** The body's own paints, as its still picture has them: its cloth in this survivor's colours, and nothing of the world's lighting. */
  private repaint() {
    const suit = !!this.body.root.getObjectByName('pads');
    this.body.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const c = this.plain(m.material as THREE.MeshStandardMaterial);
      if (suit && m.isSkinnedMesh) {
        c.onBeforeCompile = (shader) => suitPatch(shader, this.uniforms);
        c.customProgramCacheKey = () => 'doll-suit';
      } else if (m.name === 'body') {
        c.onBeforeCompile = (shader) => lookPatch(shader, this.uniforms);
        c.customProgramCacheKey = () => 'doll';
      } else if (c.name.includes('Hair')) this.hair.push(c);
      m.material = c;
    });
    this.dress();
  }

  /** jacket, trousers, skin and hair: this survivor's own */
  private dress() {
    const look = lookFor(this.name);
    this.body.setLook(look);
    setLookUniforms(this.uniforms, look);
    for (const m of this.hair) m.color.copy(look.hairColor);
  }

  /** a copy of one of the game's paints that is written for this room and no other, and is kept the same as it from here on */
  private plain<T extends THREE.Material>(src: T): T {
    const c = src.clone() as T & { defines?: Record<string, unknown> };
    if (c.defines) {
      delete c.defines.USE_CSM;
      delete c.defines.CSM_CASCADES;
      delete c.defines.CSM_FADE;
    }
    const lit = c as unknown as { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean };
    if (lit.isMeshStandardMaterial || lit.isMeshLambertMaterial || lit.isMeshPhongMaterial) {
      c.onBeforeCompile = () => {};
      c.customProgramCacheKey = () => 'icon';
    }
    this.mine.add(c);
    this.pairs.push([src as unknown as Painted, c as unknown as Painted]);
    return c;
  }

  /** Everything under this is painted with this room's paints: one to each of the game's, however many things wear it. */
  private paint(root: THREE.Object3D) {
    const own = (src: THREE.Material) => {
      if (this.mine.has(src)) return src;
      let c = this.paints.get(src);
      if (!c) this.paints.set(src, (c = this.plain(src)));
      return c;
    };
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
    });
  }

  /**
   * These are got ready to be drawn in this room before they are put on the figure: their shaders written, made by
   * the card's own workers and looked over, their pictures put on the card, and each piece drawn once where nobody
   * sees it (see Renderer.ready, which does as much for what comes into the world, and why each is needed).
   * What is painted with nothing new (a thing worn or held before, or made of what such a thing is made of) has
   * nothing to be got ready: it is passed over without a frame's wait, and the figure has it on the next frame.
   * @param whole what of these is out of sight is got ready as well (the body's own pieces that are there only when what they are is worn)
   */
  private async warm(parts: THREE.Object3D[], whole = false) {
    const paints = (o: THREE.Object3D) => {
      const all: THREE.Material[] = [];
      o.traverse((c) => {
        const m = (c as THREE.Mesh).material;
        if (m) all.push(...(Array.isArray(m) ? m : [m]));
      });
      return all;
    };
    parts = parts.filter((o) => paints(o).some((m) => !this.met.has(m)));
    if (!parts.length) return;
    const R = this.r.renderer, programs = new Set<ReturnType<typeof programsOf>[number]>();
    for (const o of parts) {
      await breathe();
      // (a shader is written for the kind of picture it is drawn into: this room's own)
      const prev = R.getRenderTarget();
      R.setRenderTarget(this.target);
      for (const p of programsOf(R, R.compile(o, this.camera, this.scene) as unknown as Set<THREE.Material>)) programs.add(p);
      R.setRenderTarget(prev);
    }
    // (asked every twentieth of a second whether the card has made them, for two seconds; after that, as the game waits: see `made`)
    const ready = () => [...programs].every((p) => p.isReady());
    for (let i = 0; i < 40 && !ready(); i++) await new Promise((r) => setTimeout(r, 50));
    await made(programs);
    for (const p of programs) {
      if (this.looked.has(p) || !p.isReady()) continue;
      await breathe();
      this.looked.add(p);
      p.getUniforms();
      p.getAttributes();
    }
    for (const o of parts) await this.send(o, whole);
    await this.prime(parts, whole);
    for (const o of parts) for (const m of paints(o)) this.met.add(m);
  }

  /**
   * The pictures of what is to be seen of a thing are put on the card, one to a frame's spare time: those that are
   * not there. (Not the pictures of what is put away on it: a gun has hung on it every part that can be fitted to
   * it, and the sight that is not on it is not sent for the figure's sake. And only a picture the card has nothing
   * of: one the game is itself sending there a strip at a time is the game's to finish.)
   */
  private async send(o: THREE.Object3D, whole = false) {
    const R = this.r.renderer, pictures = new Set<THREE.Texture>();
    const look = (c: THREE.Object3D) => {
      const m = (c as THREE.Mesh).material as Painted | Painted[] | undefined;
      for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) {
        for (const k of MAPS) {
          const t = mat[k];
          if (t && t.image && !t.isRenderTargetTexture && (R.properties.get(t) as { __webglTexture?: unknown }).__webglTexture === undefined) pictures.add(t);
        }
      }
    };
    if (whole) o.traverse(look);
    else o.traverseVisible(look);
    for (const t of pictures) {
      await breathe();
      R.initTexture(t);
    }
  }

  /**
   * Each piece of these is drawn once into four pixels that are never shown, one piece to a frame's spare time. The
   * first time anything is drawn with a shader the card's driver has work of its own to do for it, which cannot be
   * asked for except by drawing, and nothing is shown until it is done (see Renderer.drawAhead, where it was
   * measured). Left to the first frame the figure was shown in, that frame was a second long: timed, 979 ms the
   * first time the inventory was opened, and 70 the first time a pistol was taken into the figure's hands.
   */
  private async prime(parts: THREE.Object3D[], whole = false) {
    const R = this.r.renderer;
    for (const part of parts) {
      const pieces: THREE.Mesh[] = [];
      const take = (o: THREE.Object3D) => {
        if ((o as THREE.Mesh).isMesh) pieces.push(o as THREE.Mesh);
      };
      if (whole) part.traverse(take);
      else part.traverseVisible(take);
      for (const m of pieces) {
        await breathe();
        // (what is not on the figure yet is stood in the room for the drawing, and taken out again; what is out of sight is shown for it, with all it hangs from)
        const hidden: THREE.Object3D[] = [];
        let top: THREE.Object3D = m;
        for (let o: THREE.Object3D | null = m; o; o = o.parent) {
          if (!o.visible) hidden.push(o);
          top = o;
        }
        for (const o of hidden) o.visible = true;
        if (top !== this.scene) this.scene.add(top);
        const layers = m.layers.mask, culled = m.frustumCulled, lens = this.camera.layers.mask;
        m.layers.enable(AHEAD);
        m.frustumCulled = false;
        this.camera.layers.set(AHEAD);
        const prev = R.getRenderTarget();
        try {
          R.setRenderTarget(this.ahead);
          R.clear(false, true, false);
          R.render(this.scene, this.camera);
        } finally {
          R.setRenderTarget(prev);
          this.camera.layers.mask = lens;
          m.layers.mask = layers;
          m.frustumCulled = culled;
          if (top !== this.scene) this.scene.remove(top);
          for (const o of hidden) o.visible = false;
        }
      }
    }
  }

  /** The floor it stands on: its own shadow under its feet, and the pool of the lamps' light round that. */
  private floor() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec2 vAt;
        void main() {
          vAt = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vAt;
        void main() {
          float d2 = dot( vAt, vAt );
          float shade = 0.66 * exp( -d2 / 0.115 );
          float pool = 0.085 * exp( -d2 / 0.8 );
          gl_FragColor = vec4( vec3( 0.62, 0.66, 0.64 ) * pool * ( 1.0 - shade ), shade + pool * ( 1.0 - shade ) );
        }`,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.renderOrder = -1;
    return floor;
  }

  /** The blur of the page's veil, one way at a time: so many steps either side, each weighed by how far off it is. */
  private blurring() {
    return pass(new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() }, uSigma: { value: 1 } },
      vertexShader: SHEET,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uStep;
        uniform float uSigma;
        varying vec2 vUv;
        void main() {
          vec3 sum = vec3( 0.0 );
          float all = 0.0;
          int reach = int( ceil( uSigma * 2.6 ) );
          for ( int i = - reach; i <= reach; i ++ ) {
            float w = exp( - float( i * i ) / ( 2.0 * uSigma * uSigma ) );
            sum += texture2D( tSrc, vUv + uStep * float( i ) ).rgb * w;
            all += w;
          }
          gl_FragColor = vec4( sum / all, 1.0 );
        }`,
    }));
  }

  /**
   * What is drawn into the hole: the veil made again (what of the world is behind, blurred already, with its
   * colour thinned and the veil's dark over it, by the page's own rule: a round gradient from the veil's middle to
   * its far corner), a little light on the wall behind the figure, and the figure. The lamps' glints are rolled off
   * toward white here, and the figure is written as a screen shows it.
   *
   * Round the hole's edge the page lays the veil's dark itself, on a band with no blur to it (hud.css), and what is
   * drawn under that band is the blurred world with no dark on it. That is for the veil outside the hole: its blur
   * reaches into the hole, and what it found there, drawn dark, it spread outward as a dark line all round the
   * hole's edge. It finds the world as bright as it is everywhere else, and there is no line. Where the band thins
   * out toward the middle, what is drawn is whatever the band laid over it comes to the veil.
   */
  private laying() {
    const v4 = () => ({ value: new THREE.Vector4() });
    return pass(new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { tFig: { value: this.target.texture }, tWorld: { value: null }, uDrawn: v4(), uSeen: v4(), uHole: v4(), uFig: v4(), uPage: v4(), uFrom: v4(), uTo: v4(), uSat: { value: 1 }, uBand: { value: new THREE.Vector2() } },
      vertexShader: SHEET,
      fragmentShader: /* glsl */ `
        uniform sampler2D tFig;
        uniform sampler2D tWorld;
        uniform vec4 uDrawn;
        uniform vec4 uSeen;
        uniform vec4 uHole;
        uniform vec4 uFig;
        uniform vec4 uPage;
        uniform vec4 uFrom;
        uniform vec4 uTo;
        uniform float uSat;
        // (the page's band: how wide it is all of the veil's dark, and over how much more it thins to none)
        uniform vec2 uBand;
        varying vec2 vUv;
        // (where the veil's gradient has its middle, as a share of its box: "at 50% 35%" in hud.css)
        const vec2 MID = vec2( 0.5, 0.35 );
        void main() {
          vec2 page = uDrawn.xy + vec2( vUv.x, 1.0 - vUv.y ) * uDrawn.zw;
          vec2 at = ( page - uSeen.xy ) / uSeen.zw;
          vec3 behind = texture2D( tWorld, vec2( at.x, 1.0 - at.y ) ).rgb;
          behind = mix( vec3( dot( behind, vec3( 0.213, 0.715, 0.072 ) ) ), behind, uSat );
          // (the gradient reaches its far corner, and is as much wider than tall as its box is on its longer sides)
          vec2 reach = uPage.zw * max( MID, 1.0 - MID ) * 1.41421356;
          float t = clamp( length( ( page - uPage.xy - uPage.zw * MID ) / reach ), 0.0, 1.0 );
          vec4 veil = mix( vec4( uFrom.rgb * uFrom.a, uFrom.a ), vec4( uTo.rgb * uTo.a, uTo.a ), t );
          vec3 col = behind * ( 1.0 - veil.a ) + veil.rgb;
          // how far in from the hole's edge, across and down; and how much of the page's band lies over this point
          vec2 inside = min( page - uHole.xy, uHole.xy + uHole.zw - page );
          // (past the hole's edge, where a little is drawn over for good measure, the veil itself lies over it: all of its dark is the page's there)
          float band = min( inside.x, inside.y ) < 0.0 ? 1.0 : 0.0;
          if ( uBand.x > 0.0 ) {
            vec2 clear = clamp( ( inside - uBand.x ) / uBand.y, 0.0, 1.0 );
            band = 1.0 - clear.x * clear.y;
          }
          // (the figure, and the light behind it, are not begun until the band has ended: they come in over a few pixels past it)
          float shown = smoothstep( 0.0, 12.0, min( inside.x, inside.y ) - uBand.x - uBand.y );
          vec2 q = ( page - uFig.xy - uFig.zw * vec2( 0.5, 0.42 ) ) / uFig.w;
          col += vec3( 0.046, 0.054, 0.05 ) * exp( - dot( q, q ) / 0.07 ) * shown;
          vec4 fig = texture2D( tFig, vUv ) * shown;
          vec3 lit = fig.a > 0.0005 ? fig.rgb / fig.a : vec3( 0.0 );
          // (as it is up to three quarters of white, and from there bent over so that it comes to white and never past it)
          lit = mix( lit, 0.75 + 0.25 * tanh( ( lit - 0.75 ) / 0.25 ), step( vec3( 0.75 ), lit ) );
          lit = mix( lit * 12.92, 1.055 * pow( max( lit, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), lit ) );
          col = col * ( 1.0 - fig.a ) + lit * fig.a;
          // (a grain of noise: the dark is a slow slope from one shade to the next, and shows its steps without)
          col += ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5 ) / 255.0;
          gl_FragColor = vec4( ( col - band * veil.rgb ) / ( 1.0 - band * veil.a ), 1.0 );
        }`,
    }));
  }

  // ------------------------------------------------------------ what it wears and holds

  /**
   * What the game says of the survivor now is set beside what the figure was last told, and what has changed is seen to.
   * @returns what was begun, each over when the figure has it
   */
  private ask(): Promise<void>[] {
    const h = this.h, begun: Promise<void>[] = [];
    const name = h.name();
    if (name !== this.name) {
      this.name = name;
      this.dress();
    }
    const worn = h.worn(), wornKey = worn.join(',');
    if (wornKey !== this.wornKey) {
      this.wornKey = wornKey;
      begun.push(this.wear(worn));
    }
    const hands = h.hands(), handKey = hands ? `${hands.id}|${hands.mods.join(',')}` : '';
    if (handKey !== this.handKey) {
      this.handKey = handKey;
      begun.push(this.hold(hands));
    }
    const back = h.back();
    if (back !== this.backKey) {
      this.backKey = back;
      begun.push(this.sling());
    }
    return begun;
  }

  /**
   * Hat, mask, vest, pack. What is no longer worn comes off at once. What is newly worn is fetched, painted and got
   * ready first, and then all of it is put on in one go: a thing that has been worn before, or has lain near, is
   * ready already, and is on before the next frame is drawn, so that one hat changed for another is never a bare
   * head between. (A thing whose model has never been made in this game, one handed out and not picked up, takes
   * as long to come as its model does: the figure is without it until then, and is not left wearing what was taken
   * off meanwhile. It was: a whole kit handed out at once left the old helmet and mask on the figure for eleven
   * seconds, beside places that said otherwise.)
   */
  private async wear(ids: string[]) {
    const n = ++this.wearN;
    try {
      const kept = this.worn.filter((i) => ids.includes(i.id));
      if (kept.length !== this.worn.length) {
        this.body.setGear((this.worn = kept));
        this.livelyTill = performance.now() + LIVELY;
      }
      const items: { id: string; obj: THREE.Object3D }[] = [];
      for (const id of ids) {
        if (!GEAR_SHOWN.has(id)) continue;
        // (what is on already stays as it is; a thing that is a piece of the suit itself has no model to hang on the body: it is there or not)
        const on = kept.find((i) => i.id === id);
        if (on || !GEAR[id]) {
          items.push(on ?? { id, obj: new THREE.Group() });
          continue;
        }
        const model = (await this.models.get(id)).group.clone();
        const obj = id === 'gasmask' ? facepiece(model) : model;
        this.paint(obj);
        items.push({ id, obj });
      }
      await this.warm(items.map((i) => i.obj));
      if (n !== this.wearN) return;
      this.body.setGear((this.worn = items));
      this.livelyTill = performance.now() + LIVELY;
    } catch {
      /* a model that will not come: the figure is without it */
    }
  }

  /**
   * What is in the hands. A gun or a thing to hit with is held as anybody is seen holding it; anything else, in the
   * right fist. What was in them is on its way out of them from the moment they change, however long what is to
   * come is in coming (which is no time, for anything that has been held before).
   */
  private async hold(hands: { id: string; mods: string[] } | null) {
    const n = ++this.holdN;
    try {
      // (seen, one thing is lowered and the next brought up, as the game's bodies do it; unseen, it is simply there or gone)
      if (this.holding) this.body.setHeld(null, null, 'rifle', !this.showing);
      this.holding = false;
      this.plumb = null;
      this.lookOver = -1;
      this.livelyTill = performance.now() + LIVELY;
      const held = hands ? (this.h.held(hands.id, hands.mods) ?? (await this.inFist(hands.id))) : null;
      if (!held) return;
      this.paint(held.obj);
      await this.warm([held.obj]);
      if (n !== this.holdN) return;
      this.body.setHeld(held.obj, held.grips, held.kind, !this.showing);
      this.holding = true;
      this.plumb = held.plumb ?? null;
      this.lookOver = held.kind !== 'melee' && this.showing ? 0.55 : -1;
      this.livelyTill = performance.now() + LIVELY;
    } catch {
      /* as above */
    }
  }

  /** What is slung on the back, as the game's bodies carry it. */
  private async sling() {
    const n = ++this.slingN;
    try {
      // (the game hands over the guns themselves, which the body copies: copied here first, so that it is the copies that are painted)
      const objs = this.h.slung().map((o) => o.clone());
      for (const o of objs) this.paint(o);
      await this.warm(objs);
      if (n !== this.slingN) return;
      this.body.setSlung(objs);
      this.livelyTill = performance.now() + LIVELY;
    } catch {
      /* as above */
    }
  }

  /** A thing that is neither gun nor club, in the right fist (src/game/in-fist.ts): a bandage, a tin, a flask, a magazine. */
  private async inFist(id: string): Promise<Held | null> {
    if (!ITEMS[id]) return null;
    return inFist((await this.models.get(id)).group.clone(), id);
  }

  // ------------------------------------------------------------ the turn

  /** a hand is on it */
  grab() {
    this.gripped = true;
    this.vel = 0;
    this.goal = null;
    this.movedAt = performance.now();
  }

  /** dragged this many of the page's pixels to the right */
  turn(by: number) {
    if (!this.gripped) return;
    const now = performance.now(), a = by * TURN;
    this.angle = wrap(this.angle + a);
    // (how fast, for when it is let go: over the last few moves, not the last one alone)
    const dt = Math.max(4, now - this.movedAt) / 1000;
    this.vel = THREE.MathUtils.clamp(this.vel + (a / dt - this.vel) * 0.55, -SPIN_MOST, SPIN_MOST);
    this.movedAt = now;
  }

  /** let go: it turns on a little, as a thing with weight does, and stays where it comes to rest */
  drop() {
    if (!this.gripped) return;
    this.gripped = false;
    // (held still before it was let go, it was put there: it stays)
    if (performance.now() - this.movedAt > 90) this.vel = 0;
  }

  /** back to where it is seen from at rest */
  front() {
    this.goal = REST;
    this.vel = 0;
  }

  private spin(dt: number) {
    if (this.gripped) return;
    if (this.goal !== null) {
      const left = wrap(this.goal - this.angle);
      this.angle = Math.abs(left) < 0.004 ? this.goal : wrap(this.angle + left * (1 - Math.exp(-7 * dt)));
      if (this.angle === this.goal) this.goal = null;
    } else if (this.vel) {
      this.angle = wrap(this.angle + this.vel * dt);
      this.vel *= Math.exp(-dt / GLIDE);
      if (Math.abs(this.vel) < 0.03) this.vel = 0;
    }
  }

  // ------------------------------------------------------------ each frame

  /** the body as it stands this moment: the game's own standing, with what is in its hands */
  /**
   * Shown doing an emote, over and over, for as long as it is shown (Emotes, src/ui/emotes-menu.ts): a
   * call's gesture again after a breath, a movement played once again after a moment, a dance kept up. null: none.
   */
  perform(e: Emote | null) {
    if (this.performing?.e === e) return;
    this.performing = e ? { e, t: 0, over: 0 } : null;
    this.body.setHold(e?.hold ?? null);
    this.body.setClip(e?.clip ?? null, !!e?.once);
    this.body.emote(e?.move ?? null, e?.dur);
  }

  private stand(dt: number) {
    if (this.lookOver >= 0 && (this.lookOver -= dt) < 0) this.body.act('check', 1.7);
    const p = this.performing;
    if (p) {
      p.t += dt;
      if (p.e.move && p.t >= (p.e.dur ?? 1.5) + 0.9) {
        p.t = 0;
        this.body.emote(p.e.move, p.e.dur);
      }
      if (p.e.clip && p.e.once && this.body.emoteOver && (p.over += dt) > 0.7) {
        p.over = 0;
        this.body.setClip(null);
        this.body.setClip(p.e.clip, true);
      }
    }
    // (a thumb is laid for a body near the eye, and this one is as near as any: the game's eye is put at its feet for the asking)
    _eye.copy(Avatar.eye);
    Avatar.eye.copy(ORIGIN);
    this.body.update(dt, ORIGIN, STILL, 0, false, false, false, 0, true, false);
    Avatar.eye.copy(_eye);
    // (what hangs from the hand hangs straight down: the room's own up, whichever way the hand has turned)
    const hung = this.plumb;
    if (hung?.parent) hung.quaternion.copy(hung.parent.getWorldQuaternion(_turn)).invert();
  }

  /**
   * The pictures of what is on the figure are kept on the card while the inventory is shut. The game takes the
   * pictures of a sort of thing off the card when none of that sort has lain near for a quarter of a minute (see
   * LootManager.update), which is so of everything a survivor has on a quarter of a minute after picking it up;
   * and the figure's next frame, the first of the inventory opening, was all of them going back at once (sixteen
   * of a kit's, 28 ms, timed). They go back one to a frame's spare time, here, when they are found gone. It is
   * what is worn, held and slung, at the size the world is drawn with: some tens of megabytes at the most.
   */
  private tend() {
    if (this.tending) return;
    this.tending = true;
    void this.send(this.body.root).then(
      () => (this.tending = false),
      () => (this.tending = false),
    );
  }

  /** Every paint here has the pictures the game's own has now (see the top of this file). */
  private follow() {
    for (const [src, c] of this.pairs) {
      for (const k of MAPS) {
        const now = src[k];
        if (now === undefined || c[k] === now) continue;
        // (one where there was none, or none where there was one, is another shader)
        if (!c[k] !== !now) c.needsUpdate = true;
        c[k] = now;
      }
    }
  }

  /**
   * Once a frame, after the game's own picture is drawn. Shut, it costs the asking of what is worn, a few times a
   * second, so that the figure is as the survivor is on the first frame the inventory is open.
   */
  draw(dt: number) {
    if (!this.alive) return this.h.shown(false);
    // (Where the game's picture is on the page: measured before the inventory is asked where the figure is, and
    // kept until the window is another size. The inventory's answer moves the hole, and a measuring after that
    // had the page laid out a second time in the one frame: 120 ms the first time the inventory was opened.)
    if (!this.on && this.alive) this.on = this.r.renderer.domElement.getBoundingClientRect();
    const box = this.h.box(), now = performance.now();
    // (worked out afresh when the page has measured again; and when the game's picture is another size under the same page, as when its sharpness is changed in the options)
    const size = this.r.renderer.getDrawingBufferSize(_size);
    if (box && (box !== this.box || !this.plan || size.x !== this.plan.wide || size.y !== this.plan.high || this.r.renderer.getPixelRatio() !== this.plan.pr)) this.plan = this.layOut(box);
    this.box = box;
    if (!box || !this.plan) {
      this.showing = false;
      if (!this.laidAhead) this.layAhead();
      if (now - this.askedAt > ASK_SHUT) {
        this.askedAt = now;
        this.ask();
        this.tend();
      }
      return this.h.shown(false);
    }
    if (!this.showing) {
      // (opened: seen from the front again, and standing still)
      this.angle = REST;
      this.vel = 0;
      this.goal = null;
      this.gripped = false;
      this.stale = true;
    }
    this.ask();
    this.showing = true;
    this.spin(dt);
    // The figure's own picture is what this costs: a body with a full kit on it, a rifle in its hands and another
    // on its back is fifty things to draw (counted). While it only stands there it is drawn again thirty times a
    // second, which is as often as breathing shows; turned, or with its hands or its clothes changing, on every
    // frame. What lays the picture onto the page is three more, and those are drawn every frame either way, for the
    // world behind the veil does not stand still.
    this.owed += dt;
    const again = this.stale || this.gripped || this.vel !== 0 || this.goal !== null || now < this.livelyTill || !!this.performing || now - this.drawnAt >= STANDING_EVERY - 1;
    if (again) {
      this.follow();
      this.stand(Math.min(this.owed, 0.1));
      this.owed = 0;
      this.drawnAt = now;
      this.stale = false;
    }
    this.picture(this.plan, again);
    this.h.shown(true);
  }

  /**
   * The passes that lay the figure's picture on the page are drawn once ahead as well, for the same reason as the
   * figure's own pieces are (see `prime`): the blur into one of its own small pictures, and the last of them into
   * one pixel in a corner of the game's picture. Once, on the first frame the figure is made and the inventory is
   * shut: this is called when the game's frame has been drawn, and the next frame is drawn over that pixel.
   */
  private layAhead() {
    this.laidAhead = true;
    const R = this.r.renderer;
    const prev = R.getRenderTarget(), auto = R.autoClear, cutting = R.getScissorTest();
    R.getViewport(_view);
    R.getScissor(_cut);
    R.autoClear = false;
    this.blur.u.tSrc.value = this.soft[0].texture;
    R.setRenderTarget(this.soft[1]);
    R.render(this.blur.scene, this.blur.camera);
    R.setRenderTarget(null);
    R.setViewport(0, 0, 1, 1);
    R.setScissor(0, 0, 1, 1);
    R.setScissorTest(true);
    R.render(this.lay.scene, this.lay.camera);
    R.autoClear = auto;
    R.setScissorTest(cutting);
    R.setScissor(_cut);
    R.setViewport(_view);
    R.setRenderTarget(prev);
  }

  /**
   * The page has measured again: where its hole is on the game's picture, in that picture's own pixels; how the
   * lens is to take the room in; how big each of the small pictures is to be; and what the passes are told.
   */
  private layOut(box: DollBox): Plan | null {
    const R = this.r.renderer, on = this.on ?? R.domElement.getBoundingClientRect(), pr = R.getPixelRatio();
    R.getDrawingBufferSize(_size);
    const W = _size.x, H = _size.y;
    if (!on.width || !on.height || !W || !H) return null;
    // (the game's own pixels to one of the page's)
    const kx = W / on.width, ky = H / on.height;
    // (the hole, and a pixel past its edge all round: under the veil, a gap would be a line of the bare world)
    const x = Math.max(0, Math.floor((box.cx - 1 - on.left) * kx)), x1 = Math.min(W, Math.ceil((box.cx + box.cw + 1 - on.left) * kx));
    const y = Math.max(0, Math.floor((box.cy - 1 - on.top) * ky)), y1 = Math.min(H, Math.ceil((box.cy + box.ch + 1 - on.top) * ky));
    const w = x1 - x, h = y1 - y;
    if (w < 8 || h < 8) return null;
    const sigma = box.veil.blur * (kx + ky) * 0.5, k = sigma > BLUR_WHOLE ? 2 : 1;
    // (what is copied to be blurred reaches as far past the hole as the blur does; worked at half size, it is an even number of pixels each way)
    const past = sigma > 0 ? Math.ceil(sigma * 2.6) + 2 : 0;
    let sx = Math.max(0, x - past), sx1 = Math.min(W, x1 + past), sy = Math.max(0, y - past), sy1 = Math.min(H, y1 + past);
    if (k === 2) {
      if ((sx1 - sx) % 2) {
        if (sx1 < W) sx1++;
        else sx++;
      }
      if ((sy1 - sy) % 2) {
        if (sy1 < H) sy1++;
        else sy++;
      }
    }
    const sw = sx1 - sx, sh = sy1 - sy;
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    // (another size, another place or another lens: the figure's picture is drawn afresh for it)
    this.stale = true;
    if (!this.world || this.world.image.width !== sw || this.world.image.height !== sh) {
      this.world?.dispose();
      // (The game's picture has no see-through to it, and a copy of it may not be asked to have one. Read between
      // its pixels: the blur at half size takes four of them at each step.)
      this.world = new THREE.FramebufferTexture(sw, sh);
      this.world.format = THREE.RGBFormat;
      this.world.internalFormat = 'RGB8';
      this.world.minFilter = this.world.magFilter = THREE.LinearFilter;
    }
    for (const t of this.soft) if (sigma > 0 && (t.width !== sw / k || t.height !== sh / k)) t.setSize(sw / k, sh / k);
    // the lens: the figure's own place is the whole of what it takes in, and what is drawn is that and more, to either side
    const fw = box.w * kx, fh = box.h * ky, aspect = fw / fh, tall = Math.max(FRAME.tall, FRAME.wide / aspect);
    const back = tall / 2 / Math.tan(THREE.MathUtils.degToRad(LENS.fov / 2));
    this.camera.aspect = aspect;
    this.camera.position.set(0, FRAME.mid + LENS.lift, -back);
    this.camera.rotation.set(-Math.atan2(LENS.lift, back), Math.PI, 0);
    this.camera.setViewOffset(fw, fh, x - (box.x - on.left) * kx, y - (box.y - on.top) * ky, w, h);
    const u = this.lay.u, v = box.veil;
    u.uDrawn.value.set(on.left + x / kx, on.top + y / ky, w / kx, h / ky);
    u.uSeen.value.set(on.left + sx / kx, on.top + sy / ky, sw / kx, sh / ky);
    u.uFig.value.set(box.x, box.y, box.w, box.h);
    u.uPage.value.set(v.x, v.y, v.w, v.h);
    u.uFrom.value.set(v.from[0] / 255, v.from[1] / 255, v.from[2] / 255, v.from[3]);
    u.uTo.value.set(v.to[0] / 255, v.to[1] / 255, v.to[2] / 255, v.to[3]);
    u.uSat.value = v.sat;
    u.uHole.value.set(box.cx, box.cy, box.cw, box.ch);
    u.uBand.value.set(v.band, v.band > 0 ? Math.max(1, v.thins) : 0);
    u.tWorld.value = sigma > 0 ? this.soft[0].texture : this.world;
    return { x, y, w, h, sx, sy, sw, sh, sigma, k, wide: W, high: H, pr };
  }

  /** @param again the figure's own picture is drawn afresh: without, it is laid on as it last was */
  private picture(p: Plan, again: boolean) {
    const R = this.r.renderer, world = this.world!;
    const prev = R.getRenderTarget(), auto = R.autoClear, alpha = R.getClearAlpha(), cutting = R.getScissorTest();
    R.getClearColor(_clear);
    R.getViewport(_view);
    R.getScissor(_cut);
    R.autoClear = false;
    if (again) {
      // the figure, in its room
      this.rig.rotation.y = -this.angle;
      // (what shines in steel goes round with the lamps: the figure is what is being turned, not the room)
      this.scene.environmentRotation.y = -this.angle;
      R.setRenderTarget(this.target);
      R.setClearColor(0x000000, 0);
      R.clear(true, true, false);
      R.render(this.scene, this.camera);
    }
    // what of the game's picture is behind the hole, copied on the card; and blurred as the veil blurs it, across and then down
    R.setRenderTarget(null);
    R.copyFramebufferToTexture(world, _at.set(p.sx, p.high - p.sy - p.sh));
    if (p.sigma > 0) {
      const b = this.blur.u;
      b.uSigma.value = p.sigma / p.k;
      b.tSrc.value = world;
      b.uStep.value.set(p.k / p.sw, 0);
      R.setRenderTarget(this.soft[1]);
      R.render(this.blur.scene, this.blur.camera);
      b.tSrc.value = this.soft[1].texture;
      b.uStep.value.set(0, p.k / p.sh);
      R.setRenderTarget(this.soft[0]);
      R.render(this.blur.scene, this.blur.camera);
      R.setRenderTarget(null);
    }
    // and all of it into the hole
    R.setViewport(p.x / p.pr, (p.high - p.y - p.h) / p.pr, p.w / p.pr, p.h / p.pr);
    R.setScissor(p.x / p.pr, (p.high - p.y - p.h) / p.pr, p.w / p.pr, p.h / p.pr);
    R.setScissorTest(true);
    R.render(this.lay.scene, this.lay.camera);
    R.autoClear = auto;
    R.setScissorTest(cutting);
    R.setScissor(_cut);
    R.setViewport(_view);
    R.setClearColor(_clear, alpha);
    R.setRenderTarget(prev);
  }
}
