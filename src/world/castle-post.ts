// The signals post on the fort (src/sim/castle-post.ts), as it is drawn and as it stops a body: what the game has
// no model for and is made here by hand. The lattice mast on the keep with its guys and its red light, sandbags,
// camouflage nets, tarpaulins and tents, duckboards, cables, the flagpole, floodlights, the generator, benches,
// bedrolls, a scope on its stand, graves. (What is off the shelf is the world's to draw: `postProps`.)
//
// WHAT IT COSTS, AND WHEN. From further off than POST.reach it is the mast alone: a plain banded pole of a few
// dozen triangles, and its light. Within that, everything else is made (from numbers: nothing is sent for, its two
// pictures are painted here) and put in the world as three things to draw: what is hard, what is cloth, and the
// nets, which are seen through; with one more drawn only into the sun's shadow maps, and one after dusk for the
// glass of its lamps. Snow lies on it where the fort's own snow says the sky is over a place (`castleSky`), and as
// much of it as lies on the fort.

import * as THREE from 'three';
import { GLASS_GROUPS, WORLD_GROUPS, physics, type Surface } from '../core/physics';
import { SHADOW_FRUSTA, type Atmosphere } from './atmosphere';
import { CASTLE_SCALE, castleAt, castleGround, castleLoose, looseLocal, type GroundAt, type Loose, type Place } from '../sim/castle';
import { POST, postLights, postMade, postModels, postSolids } from '../sim/castle-post';
import { assets } from '../core/assets';
import { Skin, farMast, postShape } from './castle-post-shape';
import { SNOW_ON_THE_MOUNTAIN } from './castle';
import { castleSky } from './castle-shape';
import { kitMeshes, stoneLook } from './kit';

function geometry(k: Skin): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(k.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(k.nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(k.uv), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(k.col), 3));
  g.setAttribute('aSnow', new THREE.BufferAttribute(new Float32Array(k.snow), 2));
  g.computeBoundingSphere();
  return g;
}

/** how far off the mast's lattice can still be seen as a lattice: beyond, the plain pole is drawn (in it, while it is still made) */
const LATTICE_SEEN = 110;
const rnd = (i: number, j = 0) => { let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + 974711) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** the weave of sacking and canvas: a small picture, painted here, that its colour is laid over */
function weave(): THREE.Texture {
  const c = document.createElement('canvas'), S = 128;
  c.width = c.height = S;
  const x = c.getContext('2d')!, img = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const over = (Math.floor(i / 2) + Math.floor(j / 2)) % 2, v = 200 + over * 26 + rnd(i, j) * 26;
    img.data.set([v, v, v, 255], (j * S + i) * 4);
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** a camouflage net: knotted cord, and strips of cloth tied into it in the colours of a hillside in winter; seen through where there is neither */
function netting(): THREE.Texture {
  const c = document.createElement('canvas'), S = 512;
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, S, S);
  x.strokeStyle = '#3a3d30';
  x.lineWidth = 2.2;
  for (let k = -S; k < S * 2; k += 32) {
    x.beginPath(); x.moveTo(k, 0); x.lineTo(k + S, S); x.stroke();
    x.beginPath(); x.moveTo(k, 0); x.lineTo(k - S, S); x.stroke();
  }
  const cols = ['#5c6444', '#6d735a', '#474d36', '#74694e', '#8a8872', '#a7aaa0', '#c2c4bd', '#5f5843', '#9a9d92'];
  for (let k = 0; k < 430; k++) {
    const px = rnd(k, 1) * S, py = rnd(k, 2) * S, w = 16 + rnd(k, 3) * 46, h = 7 + rnd(k, 4) * 13, a = rnd(k, 5) * Math.PI;
    x.fillStyle = cols[Math.floor(rnd(k, 6) * cols.length)];
    // (drawn again off each edge it crosses: the picture is laid side by side with itself)
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      x.save();
      x.translate(px + ox, py + oy);
      x.rotate(a);
      x.beginPath();
      x.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      x.fill();
      x.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a soft round of light: the mast's lamp as it is seen from the valley */
function halo(): THREE.Texture {
  const c = document.createElement('canvas'), S = 64;
  c.width = c.height = S;
  const x = c.getContext('2d')!, g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface PostOptions {
  /** how high the world's ground is at a spot (what is in the village stands on it): unsaid, the ground the fort assumes */
  ground?: GroundAt;
  /** the fort's loose pieces, where each stands in the world: unsaid, where the fort's own list has them */
  loose?: Loose[];
  /** how much snow lies: the fort's own number, shared (it may be changed at any time). Unsaid: what the mountain has */
  snow?: { value: number };
  /** gets a thing ready to be drawn before it is put in the world (the renderer's `ready`) */
  ready?: (o: THREE.Object3D) => Promise<unknown>;
}

/** told of a lamp that is alight now: where, how brightly (0..1), its colour, and how far its light carries */
export type PostLit = (pos: THREE.Vector3, burn: number, colour?: THREE.Color, reach?: number) => void;

export class PostSite {
  /** how much of it there is to draw and to run into */
  readonly counts = { near: 0, far: 0, draws: 0, solids: 0 };
  /** 'far': the mast alone; 'making': the rest is being got ready; 'near': all of it is in the world */
  state: 'far' | 'making' | 'near' = 'far';
  readonly group = new THREE.Group();
  private near = new THREE.Group();
  private far: THREE.Mesh;
  private beacon: THREE.Sprite;
  private glow: THREE.Mesh | null = null;
  private glowPaint = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private snowU: { value: number };
  private hardPaint: THREE.Material;
  private lamps: { pos: THREE.Vector3; kind: 'flood' | 'bulb' | 'beacon'; colour: THREE.Color; reach: number }[];
  private clock = 0;
  private loose: Loose[];
  private ground: (x: number, z: number) => number;

  constructor(readonly place: Place, private atmo: Atmosphere, scene: THREE.Scene, private o: PostOptions = {}) {
    const P = place, world = o.ground;
    this.snowU = o.snow ?? { value: SNOW_ON_THE_MOUNTAIN };
    this.loose = looseLocal(P, o.loose ?? castleLoose(P));
    this.ground = world ? (x, z) => { const [wx, , wz] = castleAt(P, x, z); return (world(wx, wz) - P.y) / CASTLE_SCALE; } : castleGround;
    const all = this.group;
    all.name = 'castle post';
    all.position.set(P.x, P.y, P.z);
    all.rotation.y = P.rot;
    // (a fifth bigger than its own measure, with the fort it stands in: see CASTLE_SCALE)
    all.scale.setScalar(CASTLE_SCALE);
    all.updateMatrix();
    all.matrixAutoUpdate = false;
    this.hardPaint = atmo.register(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 }), stoneLook({ snow: this.snowU, attr: 'aSnow' }), 'castle post hard');
    // from far off: the mast, a plain banded pole
    const mast = postMade(this.loose).find((m) => m.t === 'mast'), far = new Skin();
    if (mast && mast.t === 'mast') farMast(far, mast.at, mast.h);
    this.far = new THREE.Mesh(geometry(far), this.hardPaint);
    this.far.name = 'castle post:far';
    this.far.matrixAutoUpdate = false;
    this.counts.far = far.triangles;
    all.add(this.far);
    // its lamps; and the mast's, which is seen from the valley: a round of red light that is as big on the eye however far off it is
    const colour = (c: [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);
    this.lamps = postLights().map((l) => ({ pos: new THREE.Vector3(...castleAt(P, l.at[0], l.at[2], l.at[1])), kind: l.kind, colour: colour(l.kind === 'flood' ? POST.flood.colour : l.kind === 'bulb' ? POST.bulb.colour : POST.beacon.colour), reach: l.kind === 'flood' ? POST.flood.reach : l.kind === 'bulb' ? POST.bulb.reach : 12 }));
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: colour(POST.beacon.colour), blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false, transparent: true }));
    this.beacon.name = 'castle post:beacon';
    const at = this.lamps.find((l) => l.kind === 'beacon');
    if (at) this.beacon.position.copy(at.pos);
    this.beacon.scale.setScalar(0.02);
    this.beacon.renderOrder = 5;
    scene.add(all, this.beacon);
    all.updateMatrixWorld(true);
    this.near.visible = false;

    // ---- what stops a body and a shot (cloth stops a body and not a shot)
    const solids = postSolids(this.loose);
    if (physics.world) for (const s of solids) {
      const y = s.sits ? this.ground(s.c[0], s.c[2]) : 0, [wx, wy, wz] = castleAt(P, s.c[0], s.c[2], s.c[1] + y);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.rot + s.yaw);
      physics.addStaticQuat(physics.R.ColliderDesc.cuboid(s.h[0] * CASTLE_SCALE, s.h[1] * CASTLE_SCALE, s.h[2] * CASTLE_SCALE), s.surface as Surface, { x: wx, y: wy, z: wz }, q, undefined, s.feet ? GLASS_GROUPS : WORLD_GROUPS);
    }
    this.counts.solids = solids.length;
  }

  /** Everything but the mast is made, got ready to be drawn, and put in the world. */
  private async make() {
    this.state = 'making';
    const k = postShape(postMade(this.loose), this.ground), snow = this.snowU;
    const cloth = this.atmo.register(new THREE.MeshStandardMaterial({ map: weave(), vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide }), stoneLook({ snow, attr: 'aSnow', thin: 0.12 }), 'castle post cloth');
    const net = this.atmo.register(new THREE.MeshStandardMaterial({ map: netting(), vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.35 }), stoneLook({ snow, attr: 'aSnow', thin: 0.4 }), 'castle post net');
    const cast: Skin[] = [];
    for (const [name, skin, paint] of [['hard', k.hard, this.hardPaint], ['cloth', k.cloth, cloth], ['net', k.net, net]] as [string, Skin, THREE.Material][]) {
      if (!skin.triangles) continue;
      const mesh = new THREE.Mesh(geometry(skin), paint);
      mesh.name = `castle post:${name}`;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.near.add(mesh);
      this.counts.near += skin.triangles;
      this.counts.draws++;
      if (name !== 'net') cast.push(skin);
    }
    // THE MODELS IT STANDS ITSELF (the army's tents): the model's own triangles and pictures, with the fort's snow on
    // what of them the sky is over, as on the fort's own kit. (Their windows' glass was the kind that is seen through,
    // which costs a second drawing of everything behind it whenever it is in sight: here it is a dull pane.)
    const models = postModels(this.loose);
    for (const model of new Set(models.map((m) => m.model))) {
      try {
        const root = await assets.model(model), id = root.name || (root.name = model);
        const kit = await kitMeshes(model, models.filter((m) => m.model === model).map((m) => ({ id, at: m.at, turn: m.yaw, scale: m.scale / CASTLE_SCALE, body: false })), {
          attr: { name: 'aSnow', of: (p, n) => [castleSky(p, n), 9] },
          dress: (m, name) => (/glass/i.test(name) ? new THREE.MeshStandardMaterial({ color: 0x3b4140, roughness: 0.35, metalness: 0.05 }) : this.atmo.register(m, stoneLook({ snow, attr: 'aSnow', thin: 0.12 }), `castle post ${model} ${name}`)),
        });
        for (const mesh of kit.meshes) {
          this.near.add(mesh);
          mesh.castShadow = true;
          this.counts.draws++;
        }
        this.counts.near += kit.triangles;
      } catch {
        // (a model that does not come is not drawn: what stops a body at it is the post's own, and stands)
      }
    }
    // the glass of its lamps: drawn only after dusk, as bright as they burn
    this.glow = new THREE.Mesh(geometry(k.glow), this.glowPaint);
    this.glow.name = 'castle post:glow';
    this.glow.matrixAutoUpdate = false;
    this.glow.visible = false;
    this.near.add(this.glow);
    this.counts.near += k.glow.triangles;
    this.counts.draws++;
    // one shape for the sun's shadow maps, as the fort has: the hard and the cloth (a net's shade is no shade)
    {
      const pos = new Float32Array(cast.reduce((t, s) => t + s.pos.length, 0));
      let at = 0;
      for (const s of cast) { pos.set(s.pos, at); at += s.pos.length; }
      const shadow = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
      shadow.computeBoundingSphere();
      const caster = new THREE.Mesh(shadow, new THREE.MeshBasicMaterial({ shadowSide: THREE.DoubleSide }));
      caster.castShadow = true;
      caster.matrixAutoUpdate = false;
      caster.intersectsFrustum = (f) => SHADOW_FRUSTA.has(f);
      caster.name = 'castle post shadow';
      this.near.add(caster);
    }
    // (got ready where it will stand, but not yet in the world: its first frame there then costs what any other does)
    const hold = new THREE.Group();
    hold.applyMatrix4(this.group.matrixWorld);
    hold.add(this.near);
    hold.updateMatrixWorld(true);
    this.near.visible = true;
    await this.o.ready?.(hold).catch(() => {});
    this.near.visible = false;
    this.group.add(this.near);
    this.group.updateMatrixWorld(true);
    this.state = 'near';
  }

  /**
   * Each frame: what of it is drawn, and its lamps.
   * @param night how dark it is, 0 by day to 1 at night
   * @param lit told of each lamp that is alight now (see PostLit: a caller that takes only where and how brightly gets its own colour of light)
   */
  update(dt: number, eye: THREE.Vector3, night: number, lit: PostLit) {
    const P = this.place, off = Math.hypot(eye.x - P.x, eye.z - P.z);
    if (this.state === 'far' && off < POST.reach) void this.make();
    const near = this.state === 'near' && off < POST.reach;
    this.near.visible = near;
    // (the plain pole is drawn from further off than a lattice of thin bars can be seen as anything: inside it, from there)
    this.far.visible = !near || off > LATTICE_SEEN;
    this.clock += dt;
    // (the generator's lamps come on as the light goes; the mast's burns day and night, and is not much by day)
    const dusk = Math.min(1, Math.max(0, (night - 0.3) / 0.3)), B = POST.beacon, t = this.clock % (B.on + B.off), on = Math.min(1, Math.max(0, Math.min(t, B.on - t) / 0.12));
    if (this.glow) {
      this.glow.visible = near && dusk > 0.01;
      this.glowPaint.color.setScalar(dusk);
    }
    this.beacon.visible = off < 2600;
    (this.beacon.material as THREE.SpriteMaterial).opacity = on * (0.3 + 0.7 * dusk);
    this.beacon.scale.setScalar(0.011 + 0.012 * dusk);
    for (const l of this.lamps) {
      if (l.kind === 'beacon') {
        if (near && off < 60 && dusk > 0) lit(l.pos, on * dusk * 0.5, l.colour, l.reach);
      } else if (near && dusk > 0 && off < 120) lit(l.pos, dusk * (l.kind === 'flood' ? 1 : 0.55), l.colour, l.reach);
    }
  }
}
