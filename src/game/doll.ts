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
// outline and the word shown while a thing is dragged, a thing dragged across, lies over it as it did. Nothing is
// read back from the card, and nothing is drawn while the inventory is shut.
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
import { ITEMS } from '../sim/items';
import type { Atmosphere } from '../world/atmosphere';
import type { Grips } from './arms';
import { Avatar, GEAR, GEAR_SHOWN, facepiece } from './avatar';
import { lookFor, lookPatch, lookUniforms, setLookUniforms, suitPatch } from './look';
import type { ItemModels } from './loot';

/** a thing as it is seen in somebody's hands */
type Held = { obj: THREE.Object3D; grips: Grips; kind: 'rifle' | 'pistol' | 'auto' | 'melee' };

/** where the figure stands on the page, in the page's own pixels from its top left; and what of that is in sight (the column it is in scrolls) */
export interface DollBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  /** how much of the page's dark veil there is round it, 0..1: the floor it stands on fades to that at its edges */
  dim: number;
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
  /** whether it was drawn this frame: the page shows the still picture when it was not */
  shown(on: boolean): void;
}

/** how much of the room the picture takes in: this tall and at least this wide, metres, about a point this high */
const FRAME = { tall: 2.06, wide: 0.98, mid: 0.9 };
/** the lens: a long one from well back, so the figure is not bent by it, set a little over its middle and looking down at it */
const LENS = { fov: 17, lift: 0.34 };
/** where it is seen from at rest: a little to its right, where what is in its hands is seen along its side and not end on (radians round it) */
const REST = 0.52;
/** a drag turns it this far for each of the page's pixels, radians; let go, it turns on for about this long, seconds, and no faster than this */
const TURN = 0.0125, GLIDE = 0.32, SPIN_MOST = 11;
/** shut, what it wears and holds is asked after this often, ms */
const ASK_SHUT = 300;
/** the page's dark veil where the figure stands (the middle of the gradient in .inv, hud.css) */
const VEIL = [12 / 255, 15 / 255, 13 / 255];
/** the pictures a paint may have, each kept the same as the game's own */
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;
type Painted = THREE.Material & Partial<Record<(typeof MAPS)[number], THREE.Texture | null>>;

const ORIGIN = new THREE.Vector3(), STILL = new THREE.Vector3();
const _eye = new THREE.Vector3(), _size = new THREE.Vector2(), _clear = new THREE.Color();
const _view = new THREE.Vector4(), _cut = new THREE.Vector4();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Doll {
  /** made, and fit to be drawn: until then, and if making it fails, the page keeps its still picture */
  alive = false;
  private readonly scene = new THREE.Scene();
  /** the lens and the lamps: they go round the figure together, which stands still (its arms are worked out for a body that faces the way it thinks it does) */
  private readonly rig = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera(LENS.fov, 0.46, 1, 40);
  private readonly body = new Avatar();
  private readonly uniforms = lookUniforms();
  private hair: THREE.MeshStandardMaterial[] = [];
  /** the figure's own picture: half-float, so a glint off a barrel is rolled off toward white and not cut at it */
  private readonly target = new THREE.WebGLRenderTarget(64, 128, { samples: 4, type: THREE.HalfFloatType, depthBuffer: true });
  private readonly lay: { scene: THREE.Scene; camera: THREE.Camera; size: THREE.Vector2; veil: THREE.Vector4 };
  private readonly ground: THREE.Mesh;
  /** this game's paint for each of the game's own, and the same pairs as a list to go down each frame */
  private paints = new Map<THREE.Material, THREE.Material>();
  private pairs: [Painted, Painted][] = [];
  private mine = new WeakSet<THREE.Material>();
  private looked = new WeakSet<object>();
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
  // the turn: where it is seen from, how fast that is changing, whether a hand is on it, and where it is going back to
  private angle = REST;
  private vel = 0;
  private gripped = false;
  private movedAt = 0;
  private goal: number | null = null;
  /** seconds until a gun newly in the hands is looked over (-1: none is waiting to be) */
  private lookOver = -1;
  /** the page's box it was last drawn for, and where the game's picture is on the page */
  private box: DollBox | null = null;
  private canvas = { x: 0, y: 0, sx: 1, sy: 1 };

  constructor(private r: Renderer, private atmo: Atmosphere, private models: ItemModels, private h: DollHost) {
    // The room. The sky's own picture is what steel and glass have to shine with, at a strength of this room's
    // own: it does not go dark with the hour. Three lamps: a warm one from the front and over the left, a low cool
    // one from the right for what that leaves in shadow, and a strong one from behind that picks the figure's edge
    // out of the dark it stands in.
    this.scene.environment = atmo.envMap;
    this.scene.environmentIntensity = 0.42;
    const key = new THREE.DirectionalLight(0xfff1de, 2.7), fill = new THREE.DirectionalLight(0xa9bddb, 0.6), rim = new THREE.DirectionalLight(0xc3d6ff, 2.6);
    // (in the rig the lens is at -z, looking at +z: the picture's left is +x)
    key.position.set(2.7, 3.3, -4.2);
    fill.position.set(-3.4, 1.1, -3.4);
    rim.position.set(-2.4, 3.1, 3.9);
    this.camera.rotation.order = 'YXZ';
    this.rig.add(this.camera, key, fill, rim);
    this.ground = this.floor();
    this.scene.add(this.rig, this.ground);
    this.lay = this.layer();
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
      await this.warm([this.body.root, this.ground]);
      // (and what lays its picture onto the game's, which is drawn onto the screen itself)
      const R = this.r.renderer, prev = R.getRenderTarget();
      R.setRenderTarget(null);
      const laying = programsOf(R, R.compile(this.lay.scene, this.lay.camera) as unknown as Set<THREE.Material>);
      R.setRenderTarget(prev);
      await made(laying);
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
      const src = m.material as THREE.MeshStandardMaterial, c = this.plain(src);
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
   * the card's own workers, and looked over (see Renderer.ready, which does as much for what comes into the world).
   * What has been worn or held before is ready already, and this is over at once.
   */
  private async warm(parts: THREE.Object3D[]) {
    const R = this.r.renderer, programs = new Set<ReturnType<typeof programsOf>[number]>();
    for (const o of parts) {
      await breathe();
      // (a shader is written for the kind of picture it is drawn into: this room's own)
      const prev = R.getRenderTarget();
      R.setRenderTarget(this.target);
      for (const p of programsOf(R, R.compile(o, this.camera, this.scene) as unknown as Set<THREE.Material>)) programs.add(p);
      R.setRenderTarget(prev);
    }
    await made(programs);
    for (const p of programs) {
      if (this.looked.has(p) || !p.isReady()) continue;
      await breathe();
      this.looked.add(p);
      p.getUniforms();
      p.getAttributes();
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
          float pool = 0.085 * exp( -d2 / 0.95 );
          gl_FragColor = vec4( vec3( 0.62, 0.66, 0.64 ) * pool * ( 1.0 - shade ), shade + pool * ( 1.0 - shade ) );
        }`,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.renderOrder = -1;
    return floor;
  }

  /**
   * What lays the figure's picture onto the game's: the dark it stands in (as much of it at the edges as the page's
   * own veil, so that the two meet without a line, and all of it within), a little light on the wall behind, and
   * the figure over that. The lamps' glints are rolled off toward white here, and the whole is written as a screen
   * shows it.
   */
  private layer() {
    const size = new THREE.Vector2(1, 1), veil = new THREE.Vector4(VEIL[0], VEIL[1], VEIL[2], 0.8);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { tFig: { value: this.target.texture }, uSize: { value: size }, uVeil: { value: veil } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position.xy, 0.0, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tFig;
        uniform vec2 uSize;
        uniform vec4 uVeil;
        varying vec2 vUv;
        void main() {
          vec4 fig = texture2D( tFig, vUv );
          vec3 lit = fig.a > 0.0005 ? fig.rgb / fig.a : vec3( 0.0 );
          // (as it is up to three quarters of white, and from there bent over so that it comes to white and never past it)
          vec3 over = 0.75 + 0.25 * tanh( ( lit - 0.75 ) / 0.25 );
          lit = mix( lit, over, step( vec3( 0.75 ), lit ) );
          vec3 col = mix( lit * 12.92, 1.055 * pow( max( lit, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), lit ) );
          vec2 px = vUv * uSize;
          float edge = min( min( px.x, uSize.x - px.x ), min( px.y, uSize.y - px.y ) );
          float within = smoothstep( 0.0, 16.0, edge );
          vec2 q = ( vUv - vec2( 0.5, 0.6 ) ) * vec2( uSize.x / uSize.y, 1.0 );
          float glow = exp( -dot( q, q ) / 0.075 ) * within;
          vec3 back = uVeil.rgb + vec3( 0.07, 0.082, 0.076 ) * glow;
          float dark = mix( uVeil.a, 1.0, within );
          // (a grain of noise: the dark is a slow slope from one shade to the next, and shows its steps without)
          float grain = ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5 ) / 255.0;
          gl_FragColor = vec4( col * fig.a + back * dark * ( 1.0 - fig.a ) + grain, fig.a + dark * ( 1.0 - fig.a ) );
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return { scene, camera: new THREE.Camera(), size, veil };
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
   * Hat, mask, vest, pack. All of it is fetched, painted and got ready first, and then put on in one go: what was
   * worn stays on until what is worn now is there to take its place, and the body is never seen bare between.
   */
  private async wear(ids: string[]) {
    const n = ++this.wearN;
    try {
      const items: { id: string; obj: THREE.Object3D }[] = [];
      for (const id of ids) {
        if (!GEAR_SHOWN.has(id)) continue;
        // (a thing that is a piece of the suit itself has no model to hang on the body: it is there or not)
        if (!GEAR[id]) {
          items.push({ id, obj: new THREE.Group() });
          continue;
        }
        const model = (await this.models.get(id)).group.clone();
        const obj = id === 'gasmask' ? facepiece(model) : model;
        this.paint(obj);
        items.push({ id, obj });
      }
      await this.warm(items.map((i) => i.obj));
      if (n === this.wearN) this.body.setGear(items);
    } catch {
      /* a model that will not come: the figure stays as it was */
    }
  }

  /** What is in the hands. A gun or a thing to hit with is held as anybody is seen holding it; anything else, in the right fist. */
  private async hold(hands: { id: string; mods: string[] } | null) {
    const n = ++this.holdN;
    try {
      const held = hands ? (this.h.held(hands.id, hands.mods) ?? (await this.inFist(hands.id))) : null;
      if (held) {
        this.paint(held.obj);
        await this.warm([held.obj]);
      }
      if (n !== this.holdN) return;
      // (seen, one thing is lowered and the next brought up, as the game's bodies do it; unseen, it is simply there)
      this.body.setHeld(held?.obj ?? null, held?.grips ?? null, held?.kind, !this.showing);
      this.lookOver = held && held.kind !== 'melee' && this.showing ? 0.55 : -1;
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
      if (n === this.slingN) this.body.setSlung(objs);
    } catch {
      /* as above */
    }
  }

  /**
   * A thing that is neither gun nor club, in the right fist: a bandage, a tin, a flask, a magazine. The game's
   * bodies have no way of holding such a thing (nobody else is shown it), so this is the one hold here that is not
   * theirs: the way a thing to hit with is carried, the fist closed round the thing's length at its middle. What is
   * too thick to close a fist round (a fuel can, a first aid kit) is carried from its top, hanging under the hand.
   */
  private async inFist(id: string): Promise<Held | null> {
    if (!ITEMS[id]) return null;
    const model = (await this.models.get(id)).group.clone();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3()).toArray(), mid = box.getCenter(new THREE.Vector3());
    model.position.sub(mid);
    // (the hand's own frame, as a club's is said: the handle along y, the fingers toward -z, the palm facing -x)
    const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
    const thick = size[order[2]];
    const turned = new THREE.Group();
    turned.add(model);
    const to: THREE.Vector3[] = [];
    const lay = (long: number, across: number, through: number) => {
      to[long] = new THREE.Vector3(0, 1, 0);
      to[through] = new THREE.Vector3(1, 0, 0);
      to[across] = new THREE.Vector3(0, 0, 1);
      // (turned, not turned inside out)
      if (to[0].clone().cross(to[1]).dot(to[2]) < 0) to[across].negate();
      turned.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(to[0], to[1], to[2]));
    };
    const obj = new THREE.Group();
    obj.add(turned);
    const fist =(x: number, curl: number) => ({ pos: new THREE.Vector3(x, 0, 0.05), fingers: new THREE.Vector3(-0.2, -0.3, -1), palm: new THREE.Vector3(-1, 0, 0), curl: [curl, curl + 0.04, curl + 0.08, curl + 0.1] as [number, number, number, number], thumb: 0.9, tuck: 0.8 });
    if (thick <= 0.095) {
      lay(order[0], order[1], order[2]);
      return { obj, grips: { right: fist(0.012 + thick / 2, THREE.MathUtils.clamp(1.2 - (thick - 0.03) * 9, 0.6, 1.3)), left: null }, kind: 'melee' };
    }
    // (Its own top toward the wrist, the longer of its other two sides along the fist; it hangs under the fingers
    // and stands out from the leg by as much of it as would have been inside the leg.)
    const [a, b] = size[0] >= size[2] ? [0, 2] : [2, 0];
    to[1] = new THREE.Vector3(0, 0, 1);
    to[a] = new THREE.Vector3(0, 1, 0);
    to[b] = new THREE.Vector3(1, 0, 0);
    if (to[0].clone().cross(to[1]).dot(to[2]) < 0) to[b].negate();
    turned.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(to[0], to[1], to[2]));
    turned.position.set(Math.max(0, size[b] / 2 - 0.06), 0, -(size[1] / 2 + 0.012));
    return { obj, grips: { right: fist(0.03, 1.12), left: null }, kind: 'melee' };
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
  private stand(dt: number) {
    if (this.lookOver >= 0 && (this.lookOver -= dt) < 0) this.body.act('check', 1.7);
    // (a thumb is laid for a body near the eye, and this one is as near as any: the game's eye is put at its feet for the asking)
    _eye.copy(Avatar.eye);
    Avatar.eye.copy(ORIGIN);
    this.body.update(dt, ORIGIN, STILL, 0, false, false, false, 0, true, false);
    Avatar.eye.copy(_eye);
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
    const box = this.h.box(), now = performance.now();
    if (!box) {
      this.showing = false;
      if (now - this.askedAt > ASK_SHUT) {
        this.askedAt = now;
        this.ask();
      }
      return this.h.shown(false);
    }
    if (!this.showing) {
      // (opened: seen from the front again, and standing still)
      this.angle = REST;
      this.vel = 0;
      this.goal = null;
      this.gripped = false;
    }
    this.ask();
    this.showing = true;
    this.follow();
    this.spin(dt);
    this.stand(Math.min(dt, 0.1));
    this.picture(box);
    this.h.shown(true);
  }

  private picture(box: DollBox) {
    const R = this.r.renderer, cv = R.domElement;
    R.getSize(_size);
    if (box !== this.box) {
      // (the page has measured again: where the game's picture is on it, and how the lens is to take the room in)
      this.box = box;
      const at = cv.getBoundingClientRect();
      this.canvas = { x: at.left, y: at.top, sx: at.width ? _size.x / at.width : 1, sy: at.height ? _size.y / at.height : 1 };
      const pr = R.getPixelRatio(), w = Math.max(2, Math.round(box.w * this.canvas.sx * pr)), h = Math.max(2, Math.round(box.h * this.canvas.sy * pr));
      if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
      const aspect = box.w / box.h, tall = Math.max(FRAME.tall, FRAME.wide / aspect);
      const back = tall / 2 / Math.tan(THREE.MathUtils.degToRad(LENS.fov / 2));
      this.camera.aspect = aspect;
      this.camera.position.set(0, FRAME.mid + LENS.lift, -back);
      this.camera.rotation.set(-Math.atan2(LENS.lift, back), Math.PI, 0);
      this.camera.updateProjectionMatrix();
      this.lay.size.set(box.w, box.h);
      this.lay.veil.w = box.dim;
    }
    this.rig.rotation.y = -this.angle;
    // (what shines in steel goes round with the lamps: the figure is what is being turned, not the room)
    this.scene.environmentRotation.y = -this.angle;
    const c = this.canvas;
    const prev = R.getRenderTarget(), auto = R.autoClear, alpha = R.getClearAlpha(), cutting = R.getScissorTest();
    R.getClearColor(_clear);
    R.getViewport(_view);
    R.getScissor(_cut);
    R.setRenderTarget(this.target);
    R.setClearColor(0x000000, 0);
    R.clear(true, true, false);
    R.render(this.scene, this.camera);
    R.setRenderTarget(null);
    // (laid onto the game's picture where the page has its hole, and a little past the hole's edge all round: under the veil, a gap would be a line of the world)
    R.setViewport((box.x - c.x) * c.sx, _size.y - (box.y + box.h - c.y) * c.sy, box.w * c.sx, box.h * c.sy);
    R.setScissor((box.cx - c.x) * c.sx - 2, _size.y - (box.cy + box.ch - c.y) * c.sy - 2, box.cw * c.sx + 4, box.ch * c.sy + 4);
    R.setScissorTest(true);
    R.autoClear = false;
    R.render(this.lay.scene, this.lay.camera);
    R.autoClear = auto;
    R.setScissorTest(cutting);
    R.setScissor(_cut);
    R.setViewport(_view);
    R.setClearColor(_clear, alpha);
    R.setRenderTarget(prev);
  }
}
