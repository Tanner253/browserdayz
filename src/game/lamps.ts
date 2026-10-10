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

const SPOTS = 3;
const POINTS = 5;
/** over how many metres the furthest of the real lights dims before it is given to a nearer lamp */
const FADE = 3;
const GLARES = 96;
/** how strong a beam of power 1 is (candela, as three counts it), how far it carries, and how wide it is (radians, half) */
const BEAM = { power: 170, reach: 75, half: 0.36, soft: 0.7 };

interface Beam { pos: THREE.Vector3; dir: THREE.Vector3; power: number; wide: number; d2: number }
interface Glow { pos: THREE.Vector3; color: THREE.Color; power: number; reach: number; d2: number }

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class Lamps {
  /** the real lights: in the scene only while something is lit */
  readonly pool = new THREE.Group();
  private spots: THREE.SpotLight[] = [];
  private points: THREE.PointLight[] = [];
  private beams: Beam[] = [];
  private glows: Glow[] = [];
  private nBeams = 0;
  private nGlows = 0;
  private glare: THREE.InstancedMesh;
  private glareColor: THREE.InstancedBufferAttribute;
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
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: tex } },
      vertexShader: /* glsl */ `
        attribute vec3 iColor;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vColor = iColor;
          gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4( position, 1.0 );
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
    scene.add(this.glare);
  }

  /**
   * The shaders are written once with the lamps in the scene and once without, while the game
   * loads: neither the first nightfall nor the first light switched on is then a freeze.
   * @param compile writes the shaders for the scene as it stands
   */
  warm(compile: () => void) {
    this.pool.visible = true;
    compile();
    this.pool.visible = false;
  }

  /** This frame, a lamp that throws a beam: a flashlight, a headlight. @param power 1 is a flashlight @param wide 1 is a flashlight's cone */
  beam(pos: THREE.Vector3, dir: THREE.Vector3, power = 1, wide = 1) {
    const b = (this.beams[this.nBeams] ??= { pos: new THREE.Vector3(), dir: new THREE.Vector3(), power: 1, wide: 1, d2: 0 });
    b.pos.copy(pos);
    b.dir.copy(dir).normalize();
    b.power = power;
    b.wide = wide;
    this.nBeams++;
  }

  /** This frame, a lamp that shines all round: a street lamp, a bulb on a wall. @param power 1 is a street lamp */
  glow(pos: THREE.Vector3, color: THREE.Color, power = 1, reach = 20) {
    const w = (this.glows[this.nGlows] ??= { pos: new THREE.Vector3(), color: new THREE.Color(), power: 1, reach: 20, d2: 0 });
    w.pos.copy(pos);
    w.color.copy(color);
    w.power = power;
    w.reach = reach;
    this.nGlows++;
  }

  /** When every lamp lit this frame has been said: the nearest are given the real lights, and all of them their glare. */
  update(cam: THREE.Camera, dt: number) {
    const eye = cam.position;
    const lit = this.nBeams + this.nGlows > 0;
    this.keep = lit ? 1.5 : Math.max(0, this.keep - dt);
    this.pool.visible = this.keep > 0;

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
    // (a lamp is not put out the moment a nearer one is found: it dims as it falls back toward the first that has no real light,
    // so that walking down a row of them none is seen to go out)
    const next = glows[POINTS], edge = next && next.d2 < 70 * 70 ? Math.sqrt(next.d2) : Infinity;
    this.points.forEach((l, i) => {
      const w = glows[i];
      // (only a lamp near enough to light what the eye can see of the ground about it)
      if (!w || w.d2 > 70 * 70) return void (l.intensity = 0);
      l.position.copy(w.pos);
      l.color.copy(w.color);
      l.intensity = 42 * w.power * (edge === Infinity ? 1 : Math.min(1, Math.max(0, (edge - Math.sqrt(w.d2)) / FADE)));
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

    // the glare of each, facing the eye: bigger from further off (a lamp is a point of light at any distance), and a beam's only from in front of it
    let n = 0;
    const col = this.glareColor.array as Float32Array;
    cam.getWorldQuaternion(_q);
    const put = (pos: THREE.Vector3, d2: number, r: number, g: number, b: number, k: number) => {
      if (n >= GLARES || k <= 0.01) return;
      const d = Math.sqrt(d2);
      // (not the lamp in one's own hand: it is behind the picture)
      if (d < 0.6) return;
      const size = (0.22 + d * 0.016) * (0.7 + 0.5 * k);
      _m.compose(pos, _q, _s.set(size, size, size));
      this.glare.setMatrixAt(n, _m);
      col[n * 3] = r * k;
      col[n * 3 + 1] = g * k;
      col[n * 3 + 2] = b * k;
      n++;
    };
    for (const b of beams) {
      const facing = _v.copy(eye).sub(b.pos).normalize().dot(b.dir);
      put(b.pos, b.d2, 1, 0.94, 0.8, Math.max(0, (facing - 0.25) / 0.75) * Math.min(1.6, b.power) * 1.3);
    }
    for (const w of glows) put(w.pos, w.d2, w.color.r, w.color.g, w.color.b, 0.55 * w.power);
    this.glare.count = n;
    this.glare.instanceMatrix.needsUpdate = true;
    this.glareColor.needsUpdate = true;

    this.nBeams = this.nGlows = 0;
  }
}
