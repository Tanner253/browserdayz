// Lamps: the lights people carry, the ones a jeep drives behind, and the ones that stand in
// the street. Each frame whoever has a lamp lit says so (a beam, or a glow all round); the
// few nearest the eye are given a real light, and every one of them is given its glare, the
// bright point a lit lamp is from far off. A light switched on in the dark is seen from
// across the valley: that is the price of seeing by it.
//
// The real lights are a fixed handful that are always there, lit or not: the shaders are
// written for however many lights the scene holds, and a light that came and went would have
// every one of them written again, a freeze each time. They are taken out of the scene
// altogether only while nothing anywhere is lit (by day, mostly), and both states are warmed
// when the game loads (see `warm`).

import * as THREE from 'three';
import { AIR, AIR_FALL } from '../world/atmosphere';

const SPOTS = 3;
const POINTS = 5;
/**
 * How long the real lights stay in the scene after the last lamp said went out of the reckoning, seconds. In or out, the
 * world's lights number differently, and every material in sight takes another shader for it: at 1.5 s, looking round
 * among lit lamps took them in and out every few seconds, five hundred materials changing shader each time (a frame of
 * 15 to 35 ms, and half a millisecond of every frame on average, 2026-10-18). Lit with nothing to light, they cost little.
 */
const KEEP = 30;
/** a real light given to another lamp fades out and in again over this, seconds; and it keeps its lamp while that is among
 * the nearest POINTS + KEEP_OVER */
const SWITCH = 0.35, KEEP_OVER = 2;
/** (every street lamp within LAMP_SEEN and the rest: at 96 the furthest were dropped, and came and went as the eye moved) */
const GLARES = 160;
/**
 * The glare far off (the owner, 2026-10-19: "the light emitted from vehicles and light posts from a distance looks
 * really bad. especially vehicles"). It grew with distance, to a disc 7 m across at 300 m and 18 m at 800 m: a car's
 * two lamps were one white ball, and the road in front cut its lower half off flat. Now, past NEAR metres it keeps
 * its size, seen smaller the further off, as the lamp is; never under FLOOR of the picture's height across, dimmer
 * by the FALLth power of how much it was grown to that; drawn PULL of its distance nearer the eye (half its size at
 * most), so that the lamp's own hood and the car's grille behind it neither cut it nor flicker with it far off.
 */
const FAR = { near: 25, floor: 1 / 260, fall: 0.5, pull: 0.004 };
const SHAFTS = 4;
/** how strong a beam of power 1 is (candela, as three counts it), how far it carries, and how wide it is (radians, half) */
const BEAM = { power: 170, reach: 75, half: 0.36, soft: 0.7 };

interface Beam { pos: THREE.Vector3; dir: THREE.Vector3; power: number; wide: number; glare: number; d2: number }
interface Glow { pos: THREE.Vector3; color: THREE.Color; power: number; reach: number; far: number; d2: number }
interface Flare { pos: THREE.Vector3; dir: THREE.Vector3; power: number }

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _px = new THREE.Vector2();

/**
 * How much of a lamp's light is left after the air between it and the eye: the fog's own reckoning (atmoFogAmount in
 * atmosphere.ts) and the haze that closes in over the last of the draw distance, as everything else seen is dimmed;
 * its square root, as a lamp shows through haze where what it lights is lost (the owner wants towns seen from across
 * the desert at night). The glare had no fog at all: lamps 1.5 km off as bright as at 300 m.
 */
function airLeft(eye: THREE.Vector3, at: THREE.Vector3, d: number, far: number) {
  const k = ((at.y - eye.y) / d) * AIR_FALL, a = AIR * Math.exp(-Math.max(eye.y, -50) * AIR_FALL);
  const amount = Math.abs(k) > 1e-4 ? (a * (1 - Math.exp(-d * k))) / k : a * d;
  return Math.sqrt(Math.min(Math.exp(-amount), 1 - THREE.MathUtils.smoothstep(d, far * 0.72, far * 0.97)));
}

export class Lamps {
  /** the real lights: in the scene only while something is lit */
  readonly pool = new THREE.Group();
  /** whether the world may be lit so (the real lights in it, or out) without a shader made in the frame: the renderer's to say (Renderer.readyToLight) */
  canLight: (lit: boolean) => boolean = () => true;
  /** whether it must wait however long, past the usual two and a half seconds (Renderer.warming) */
  held: (lit: boolean) => boolean = () => false;
  /** how long the real lights have waited to go in or out (see `update`) */
  private waited = 0;
  private spots: THREE.SpotLight[] = [];
  private points: THREE.PointLight[] = [];
  /** each real light's lamp (where it stood last frame), and how far up it is faded (0..1): see `update` */
  private kept: (THREE.Vector3 | null)[] = [];
  private keptPower: number[] = [];
  private faded: number[] = [];
  private beams: Beam[] = [];
  private glows: Glow[] = [];
  private flares: Flare[] = [];
  private nBeams = 0;
  private nGlows = 0;
  private nFlares = 0;
  private glare: THREE.InstancedMesh;
  private glareColor: THREE.InstancedBufferAttribute;
  private shafts: THREE.InstancedMesh;
  private shaftPower: THREE.InstancedBufferAttribute;
  private nShafts = 0;
  /** seconds the real lights are still kept in the scene after the last lamp went out (so that one flickering does not take them in and out) */
  private keep = 0;
  /** the light of all the lamps on what is at the eye itself: the hands and the gun are lit by it (they are drawn apart from the world) */
  readonly spill = new THREE.Color();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < SPOTS; i++) {
      const l = new THREE.SpotLight(0xfff0d8, 0, BEAM.reach, BEAM.half, BEAM.soft, 2);
      l.castShadow = false;
      this.pool.add(l, l.target);
      this.spots.push(l);
    }
    for (let i = 0; i < POINTS; i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 20, 2);
      l.castShadow = false;
      this.pool.add(l);
      this.points.push(l);
    }
    this.pool.visible = false;
    scene.add(this.pool);

    // the glare: a soft disc, drawn facing the eye at every lit lamp
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.glareColor = new THREE.InstancedBufferAttribute(new Float32Array(GLARES * 3), 3);
    this.glareColor.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iColor', this.glareColor);
    // (each glare's place and size are its matrix's; it is turned to the eye here, and sized for the picture: see FAR)
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: tex }, uHeight: { value: 720 } },
      vertexShader: /* glsl */ `
        attribute vec3 iColor;
        uniform float uHeight;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          float size = length( instanceMatrix[ 0 ].xyz );
          vec4 at = viewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
          float d = max( length( at.xyz ), 1e-3 );
          float px = size * projectionMatrix[ 1 ][ 1 ] * 0.5 * uHeight / max( -at.z, 1e-3 );
          float grow = max( 1.0, ${FAR.floor.toFixed(6)} * uHeight / px );
          vColor = iColor * pow( grow, -${FAR.fall.toFixed(3)} );
          float near = max( 0.0, d - min( ${FAR.pull.toFixed(4)} * d, 0.5 * size * grow ) ) / d;
          at.xyz *= near;
          at.xy += position.xy * size * grow * near;
          gl_Position = projectionMatrix * at;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4( vColor * texture2D( tMap, vUv ).a, 1.0 );
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.glare = new THREE.InstancedMesh(geo, mat, GLARES);
    this.glare.count = 0;
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 8;
    // (the height of what it is drawn into, which is the picture's at its render scale)
    this.glare.onBeforeRender = (r) => {
      mat.uniforms.uHeight.value = r.getRenderTarget()?.height ?? r.getDrawingBufferSize(_px).y;
    };
    scene.add(this.glare);

    // the shafts: an open cone from the lamp to where its beam lands (point at the origin, mouth at y -1), brightest
    // seen through its middle and near the lamp, and gone before its mouth so that no line is cut where it meets the ground
    const cone = new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0);
    const shaftMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float iPower;
        varying float vAlong;
        varying float vPower;
        varying vec3 vSide;
        varying vec3 vView;
        void main() {
          vAlong = -position.y;
          vPower = iPower;
          mat3 m = mat3( instanceMatrix );
          vSide = m * vec3( position.x, 0.0, position.z );
          vec4 world = instanceMatrix * vec4( position, 1.0 );
          vView = world.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlong;
        varying float vPower;
        varying vec3 vSide;
        varying vec3 vView;
        void main() {
          float through = abs( dot( normalize( vSide ), normalize( vView ) ) );
          float k = vPower * through * through * ( 0.15 + 0.85 * ( 1.0 - vAlong ) * ( 1.0 - vAlong ) );
          k *= smoothstep( 0.0, 0.04, vAlong ) * smoothstep( 1.0, 0.8, vAlong );
          gl_FragColor = vec4( vec3( 1.0, 0.96, 0.88 ) * k, 1.0 );
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this.shaftPower = new THREE.InstancedBufferAttribute(new Float32Array(SHAFTS), 1);
    this.shaftPower.setUsage(THREE.DynamicDrawUsage);
    cone.setAttribute('iPower', this.shaftPower);
    this.shafts = new THREE.InstancedMesh(cone, shaftMat, SHAFTS);
    this.shafts.count = 0;
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 7;
    scene.add(this.shafts);
  }

  /**
   * The world lit as asked for a moment (the real lights in it, or out of it), with the way back: so that the
   * shaders of a thing that comes after the game has loaded are written under both lightings (Renderer.ready),
   * as the world's own were (`warm`).
   */
  as(lit: boolean): () => void {
    const was = this.pool.visible;
    this.pool.visible = lit;
    return () => {
      this.pool.visible = was;
    };
  }

  /**
   * This frame, a lamp that throws a beam: a flashlight, a headlight.
   * @param power 1 is a flashlight @param wide 1 is a flashlight's cone
   * @param glare how much of a bright disc it is to whoever looks into it (1: a headlight; 0: none, which is a lamp in
   *   somebody's hand: the disc sat on their chest like a ball of white light, and they are lit by the beam they throw)
   */
  beam(pos: THREE.Vector3, dir: THREE.Vector3, power = 1, wide = 1, glare = 1) {
    const b = (this.beams[this.nBeams] ??= { pos: new THREE.Vector3(), dir: new THREE.Vector3(), power: 1, wide: 1, glare: 1, d2: 0 });
    b.glare = glare;
    b.pos.copy(pos);
    b.dir.copy(dir).normalize();
    b.power = power;
    b.wide = wide;
    this.nBeams++;
  }

  /**
   * This frame, the lens of a lamp as it is seen from in front and from some way off: a point of light, and no
   * light thrown (the beam is said by itself). A headlamp: from near to there is the lit lens and nothing else
   * (a disc of white the size of a football sat on the bonnet), from down the road there are two bright points.
   */
  flare(pos: THREE.Vector3, dir: THREE.Vector3, power = 1) {
    const f = (this.flares[this.nFlares] ??= { pos: new THREE.Vector3(), dir: new THREE.Vector3(), power: 1 });
    f.pos.copy(pos);
    f.dir.copy(dir).normalize();
    f.power = power;
    this.nFlares++;
  }

  /**
   * This frame, the beam itself as it is seen in the air, from the lamp to where it lands: a searchlight's, which is
   * seen across the valley as a pale shaft (night air is never quite clear). @param wide as `beam`'s
   * @param power how bright it is seen through its middle at the lamp's end
   */
  shaft(pos: THREE.Vector3, dir: THREE.Vector3, length: number, wide: number, power: number) {
    if (this.nShafts >= SHAFTS) return;
    const r = length * Math.tan(Math.min(1.2, BEAM.half * wide));
    _q.setFromUnitVectors(_down, _v.copy(dir).normalize());
    this.shafts.setMatrixAt(this.nShafts, _m.compose(pos, _q, _s.set(r, length, r)));
    (this.shaftPower.array as Float32Array)[this.nShafts++] = power;
  }

  /** This frame, a lamp that shines all round: a street lamp, a bulb on a wall. @param power 1 is a street lamp */
  glow(pos: THREE.Vector3, color: THREE.Color, power = 1, reach = 20, far = 0) {
    const w = (this.glows[this.nGlows] ??= { pos: new THREE.Vector3(), color: new THREE.Color(), power: 1, reach: 20, far: 0, d2: 0 });
    w.pos.copy(pos);
    w.color.copy(color);
    w.power = power;
    w.reach = reach;
    w.far = far;
    this.nGlows++;
  }

  /** When every lamp lit this frame has been said: the nearest are given the real lights, and all of them their glare. */
  update(cam: THREE.Camera, dt: number) {
    const eye = cam.position;
    const lit = this.nBeams + this.nGlows + this.nFlares > 0;
    this.keep = lit ? KEEP : Math.max(0, this.keep - dt);
    // (the real lights go in or out of the world when its shaders for that are made: see Renderer.readyToLight)
    // (and two and a half seconds late at most once nothing is being got ready for it: see Renderer.warming)
    const want = this.keep > 0;
    if (want === this.pool.visible) this.waited = 0;
    else if (this.canLight(want) || ((this.waited += dt) > 2.5 && !this.held(want))) {
      this.pool.visible = want;
      this.waited = 0;
    }

    const beams = this.beams.slice(0, this.nBeams), glows = this.glows.slice(0, this.nGlows);
    for (const b of beams) b.d2 = b.pos.distanceToSquared(eye);
    for (const w of glows) w.d2 = w.pos.distanceToSquared(eye);
    beams.sort((a, b) => a.d2 - b.d2);
    glows.sort((a, b) => a.d2 - b.d2);

    this.spots.forEach((l, i) => {
      const b = beams[i];
      if (!b) return void (l.intensity = 0);
      l.position.copy(b.pos);
      l.target.position.copy(b.pos).add(b.dir);
      l.target.updateMatrixWorld();
      l.intensity = BEAM.power * b.power;
      l.angle = Math.min(1.2, BEAM.half * b.wide);
      l.distance = BEAM.reach * Math.sqrt(b.power);
    });
    // Each real light keeps the lamp it has (found again where it stood, as a carried one moves) while that lamp is
    // among the nearest few, and the rest go to the nearest without one; a light given to another lamp fades out first
    // and in again, so walking about a base its torches' lights never jump from one to another (the owner, 2026-10-25:
    // "when I move around my base the torch lighting is really inconsistent, I think we need simpler lighting").
    const near = glows.filter((w) => w.d2 < Math.max(70, w.reach) ** 2).slice(0, POINTS + KEEP_OVER), mine: (Glow | null)[] = this.points.map(() => null), taken = new Set<Glow>();
    this.points.forEach((_, i) => {
      const was = this.kept[i];
      const w = was ? near.find((q) => !taken.has(q) && q.pos.distanceToSquared(was) < 0.25) : undefined;
      if (w) {
        mine[i] = w;
        taken.add(w);
      }
    });
    for (const w of near.slice(0, POINTS)) {
      if (taken.has(w)) continue;
      const i = mine.findIndex((m) => !m);
      if (i < 0) break;
      mine[i] = w;
      taken.add(w);
    }
    this.points.forEach((l, i) => {
      const w = mine[i], was = this.kept[i];
      const same = !!w && !!was && w.pos.distanceToSquared(was) < 0.25;
      if (!same && was && (this.faded[i] ?? 0) > 0.02) {
        // (going to another lamp, or to none: out first, where it was)
        this.faded[i] = Math.max(0, (this.faded[i] ?? 0) - dt / SWITCH);
        l.intensity = 42 * (this.keptPower[i] ?? 1) * this.faded[i];
        return;
      }
      if (!w) {
        this.kept[i] = null;
        this.faded[i] = 0;
        return void (l.intensity = 0);
      }
      if (!same) this.faded[i] = 0;
      this.kept[i] = (this.kept[i] ?? new THREE.Vector3()).copy(w.pos);
      this.keptPower[i] = w.power;
      this.faded[i] = Math.min(1, (this.faded[i] ?? 0) + dt / SWITCH);
      l.position.copy(w.pos);
      l.color.copy(w.color);
      l.intensity = 42 * w.power * this.faded[i];
      l.distance = w.reach;
    });

    // what of it all falls on the eye's own hands: a lamp overhead by how near it is, a beam shone in the face, and a little of one's own lamp come back off the walls
    this.spill.setRGB(0, 0, 0);
    for (const w of glows) {
      const k = w.power * Math.max(0, 1 - Math.sqrt(w.d2) / w.reach) ** 2;
      if (k > 0) this.spill.r += w.color.r * k, this.spill.g += w.color.g * k, this.spill.b += w.color.b * k;
    }
    for (const b of beams) {
      const d = Math.sqrt(b.d2);
      const k = d < 0.6 ? 0.12 * Math.min(1.5, b.power) : 0.5 * Math.max(0, (_v.copy(eye).sub(b.pos).normalize().dot(b.dir) - 0.8) / 0.2) * Math.max(0, 1 - d / 30);
      if (k > 0) this.spill.r += k, this.spill.g += 0.94 * k, this.spill.b += 0.8 * k;
    }

    // the glare of each, facing the eye (see FAR for how it is seen far off), and a beam's only from in front of it
    let n = 0;
    const col = this.glareColor.array as Float32Array;
    const far = (cam as THREE.PerspectiveCamera).far ?? 1800;
    const put = (pos: THREE.Vector3, d2: number, r: number, g: number, b: number, k: number) => {
      if (n >= GLARES || k <= 0.01) return;
      const d = Math.sqrt(d2);
      // (not the lamp in one's own hand: it is behind the picture)
      if (d < 0.6) return;
      const size = (0.22 + Math.min(d, FAR.near) * 0.016) * (0.7 + 0.5 * k);
      k *= airLeft(eye, pos, d, far);
      _m.makeScale(size, size, size).setPosition(pos);
      this.glare.setMatrixAt(n, _m);
      col[n * 3] = r * k;
      col[n * 3 + 1] = g * k;
      col[n * 3 + 2] = b * k;
      n++;
    };
    for (const b of beams) {
      const facing = _v.copy(eye).sub(b.pos).normalize().dot(b.dir);
      put(b.pos, b.d2, 1, 0.94, 0.8, b.glare * Math.max(0, (facing - 0.25) / 0.75) * Math.min(1.6, b.power) * 1.3);
    }
    for (let i = 0; i < this.nFlares; i++) {
      const f = this.flares[i], d2 = f.pos.distanceToSquared(eye), d = Math.sqrt(d2);
      const facing = _v.copy(eye).sub(f.pos).normalize().dot(f.dir);
      put(f.pos, d2, 1, 0.94, 0.8, f.power * Math.max(0, (facing - 0.3) / 0.7) * Math.min(1, Math.max(0, (d - 7) / 18)) * 1.5);
    }
    // (a street lamp's the brighter the further off, to two and a half times from 450 m: what a town is seen by at night from
    // across the desert, the owner, 2026-10-19, "at night you cant really tell where to go especially as a fresh spawn")
    for (const w of glows) put(w.pos, w.d2, w.color.r, w.color.g, w.color.b, 0.55 * w.power * (1 + w.far * Math.min(1.6, Math.max(0, (Math.sqrt(w.d2) - 60) / 250))));
    this.glare.count = n;
    this.glare.instanceMatrix.needsUpdate = true;
    this.glareColor.needsUpdate = true;
    this.shafts.count = this.nShafts;
    if (this.nShafts) {
      this.shafts.instanceMatrix.needsUpdate = true;
      this.shaftPower.needsUpdate = true;
    }

    this.nBeams = this.nGlows = this.nFlares = this.nShafts = 0;
  }
}
