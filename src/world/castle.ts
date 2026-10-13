// The fort on the mountain, as it is drawn and as it stops a body. What it is and where everything in it lies is
// in src/sim/castle.ts (the server knows it too); its shapes are worked out in src/world/castle-shape.ts, as plain
// numbers, and its pictures are chosen there (PICTURES); here they are given their stone and timber, stood in the
// world and made solid.
//
// WHAT IT COSTS, AND WHEN. Nobody pays for a fort they never go to (2026-10-13: "make sure those new textures we
// downloaded wont cause major performance issues"):
//   - from further off than NEAR it is one thing to draw, a lighter shape of the same broken outline with no
//     picture on it at all, each corner coloured as what it stands for. That, and what stops a body, is all that
//     is made when the fort is stood in the world;
//   - its pictures (two sets of stone, and the rock's) are asked for the first time an eye comes within ASK of
//     it, long before they are wanted, with nothing waiting on them. They are put on the card as they come, in
//     spare time (see `texture` in src/core/assets.ts). Until every one has come, the far shape goes on being drawn;
//   - its walls, the feet of its towers and its gatehouse are the fort kit's pieces, and its gate the castle
//     door's (src/world/kit.ts): those two models are asked for at the same time, and not before;
//   - then its own shapes are made and got ready ahead of being seen (shaders written, each part drawn once off
//     the picture: the renderer's `ready`, handed in), and only then put in the world: six things to draw, one for
//     each sheet of stuff, and a seventh drawn only into the sun's shadow maps;
//   - what is under the terrace is another few, drawn only while an eye is within UNDER_SEEN of the fort's middle.

import * as THREE from 'three';
import { GLASS_GROUPS, WORLD_GROUPS, physics } from '../core/physics';
import { assets } from '../core/assets';
import { SHADOW_FRUSTA, type Atmosphere } from './atmosphere';
import { LAMPS, castleAt, castleDoor, castleKit, castleLoose, castleRocks, looseLocal, type GroundAt, type Loose, type Place } from '../sim/castle';
import { PICTURES, SHEETS, castleShape, castleSky, type Sheet, type Skin, type Solid } from './castle-shape';
import { kitMeshes, stoneLook, type StoneLook } from './kit';

/** how far from its middle the eye may be, over the ground, for the fort's own shapes to be drawn: beyond, the lighter ones */
const NEAR = 330;
/** and how far off its pictures are sent for: they have the time it takes to walk from here to NEAR to come */
const ASK = 380;
/** how near its middle an eye must be for what is under the terrace to be drawn (on it, in it, or at the foot of its walls) */
const UNDER_SEEN = 32;
/** how much snow lies on it where nobody has said: the mountain it is made for is over the snow line, and not at its top */
export const SNOW_ON_THE_MOUNTAIN = 0.7;
/** a cresset's fire: the colour of its light, how far that carries, and how big its flames are beside a campfire's */
export const CRESSET = { colour: new THREE.Color(1, 0.62, 0.3), reach: 11, size: 0.26 };

/**
 * THE KIT'S STONE, AS THIS FORT HAS IT: the one place its colour is said. The kit comes as warm brown stone; this
 * fort stands on a grey mountain over the snow line, so so much of the stone's own colour is taken out (`keep`)
 * and what is left is turned a little cold (`tint`). The fort's own stone (PICTURES, in castle-shape.ts) is graded
 * to sit beside it.
 */
export const KIT_STONE: Record<string, StoneLook> = {
  fort_wall: { keep: 0.6, tint: [1.02, 1.02, 1.03] },
  fort_trim: { keep: 0.5, tint: [0.97, 0.98, 1.0] },
  fort_plaster: { keep: 0.45, tint: [0.9, 0.93, 0.98] },
};
/** the scanned rock: as it came it is rust and green; on this mountain it is grey */
const ROCK_STONE: StoneLook = { keep: 0.45, tint: [0.92, 0.95, 1.0] };
/** the fort's own sheets in the same look: the picture's colour kept so much, raised, and evened toward the stone's own (see PICTURES) */
const own = (p: { keep: number; lift: number; own: [number, number, number]; even: number }): StoneLook => ({ keep: p.keep, tint: [p.lift, p.lift, p.lift], own: p.own, even: p.even, damp: 0.22 });

/** a skin as the card wants it: plain rows of numbers, and nothing kept that is not needed */
interface Packed { pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; snow: Float32Array }
const pack = (k: Skin): Packed => ({ pos: new Float32Array(k.pos), nrm: new Float32Array(k.nrm), uv: new Float32Array(k.uv), col: new Float32Array(k.col), snow: new Float32Array(k.snow) });
function geometry(k: Packed): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(k.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(k.nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(k.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(k.col, 3));
  g.setAttribute('aSnow', new THREE.BufferAttribute(k.snow, 2));
  g.computeBoundingSphere();
  return g;
}

export interface CastleOptions {
  /** how high the world's ground is at a spot (the loose pieces stand on it): unsaid, the ground the fort assumes */
  ground?: GroundAt;
  /** the loose pieces of its grounds, where each stands in the world: unsaid, where the real ones stand (see `castleLoose`) */
  loose?: Loose[];
  /** false where the mountain itself comes up to the foot of the ramp: the rock it leaves from is not made */
  rock?: boolean;
  /** how much snow lies on it, 0 none to 1 deep winter: unsaid, what the mountain it is made for has */
  snow?: number;
  /** what the world's ground is drawn with (the terrain's `lid`): the earth laid round the hatch, over the hole cut for its steps, is drawn with the same */
  earth?: THREE.Material;
  /** gets a thing ready to be drawn before it is put in the world (the renderer's `ready`): unsaid, its first frame pays for it */
  ready?: (o: THREE.Object3D) => Promise<unknown>;
  /** a fire in each cresset, of the game's own flames: where, and how big beside a campfire. What comes back has its `strength` set every frame. Unsaid: the light of them, and no flame */
  fire?: (at: THREE.Vector3, size: number) => { strength: number };
}

export class CastleSite {
  /** how much of it there is to draw and to run into: for whoever asks what it costs */
  readonly counts = { near: 0, under: 0, far: 0, kit: 0, draws: 0, solids: 0 };
  /** 'far': only its far shape is made; 'asked': its pictures are on their way; 'near': all of it is on the card */
  state: 'far' | 'asked' | 'near' = 'far';
  /** everything of it that is drawn */
  readonly group = new THREE.Group();
  private near = new THREE.Group();
  private under = new THREE.Group();
  private far: THREE.Mesh;
  private skins: { near: Record<Sheet, Packed>; under: Record<Sheet, Packed> } | null;
  private sets: (ReturnType<typeof assets.pbr> | null)[] = [];
  private fires: THREE.Vector3[];
  private flames: { strength: number }[] = [];
  private clock = 0;
  /** whether the kit's two models have come */
  private kitHere = false;
  /** the materials of the kit's pieces and the door, once made: theirs are the pictures that are sharper close to (see src/game/near.ts) */
  readonly sharp: THREE.Material[] = [];
  private snowU = { value: SNOW_ON_THE_MOUNTAIN };
  /** How much snow lies on it: 0 the bare fort, anywhere; 1 deep winter. (Colour only: it may be changed at any time, and costs nothing to change.) */
  get snow() {
    return this.snowU.value;
  }
  set snow(v: number) {
    this.snowU.value = Math.min(1, Math.max(0, v));
  }

  constructor(readonly place: Place, private atmo: Atmosphere, scene: THREE.Scene, private o: CastleOptions = {}) {
    const P = place, ground = o.ground;
    if (o.snow !== undefined) this.snow = o.snow;
    const shape = castleShape(
      ground ? (x, z) => { const [wx, , wz] = castleAt(P, x, z); return ground(wx, wz) - P.y; } : undefined,
      looseLocal(P, o.loose ?? castleLoose(P)),
      o.rock !== false,
    );
    const each = (of: Record<Sheet, Skin>) => Object.fromEntries(SHEETS.map((s) => [s, pack(of[s])])) as Record<Sheet, Packed>;
    this.skins = { near: each(shape.near), under: each(shape.under) };
    for (const s of SHEETS) {
      this.counts.near += shape.near[s].pos.length / 9;
      this.counts.under += shape.under[s].pos.length / 9;
    }
    this.counts.far = shape.far.pos.length / 9;

    const all = this.group;
    all.name = 'castle';
    all.position.set(P.x, P.y, P.z);
    all.rotation.y = P.rot;
    all.updateMatrix();
    all.matrixAutoUpdate = false;
    // from far off: one shape, no picture, coloured corner by corner; aged and snowed on as the near one is, so it is the same fort
    const plain = atmo.register(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true }), stoneLook({ snow: this.snowU, attr: 'aSnow' }), 'castle far');
    this.far = new THREE.Mesh(geometry(pack(shape.far)), plain);
    this.far.name = 'castle:far';
    this.far.matrixAutoUpdate = false;
    all.add(this.far);
    this.near.visible = this.under.visible = false;
    this.fires = LAMPS.map(([x, z, y]) => new THREE.Vector3(...castleAt(P, x, z, y - 0.26)));
    scene.add(all);
    all.updateMatrixWorld(true);

    // ---- what stops a body and a shot
    if (physics.world) for (const s of shape.solids) this.solid(s);
    this.counts.solids = shape.solids.length;
  }

  /** Its pictures are sent for. (Nothing waits on them: they come when they come.) */
  private ask() {
    this.state = 'asked';
    this.sets = SHEETS.map((s) => (PICTURES[s].tex && !(s === 'earth' && this.o.earth) ? assets.pbr(PICTURES[s].tex!) : null));
    void Promise.all([assets.model('fort_kit'), assets.model('large_castle_door'), assets.model('rock_face_01'), assets.model('rock_face_01', 1)]).then(() => void (this.kitHere = true));
  }

  /** Whether every picture sent for has come. */
  private come() {
    return this.kitHere && this.sets.every((t) => !t || (!!t.map.image && !!t.normalMap.image && !!t.armMap.image));
  }

  /** Its own shapes are made, got ready to be drawn, and put in the world. */
  private async build() {
    const k = this.skins!, mats = {} as Record<Sheet, THREE.Material>;
    this.skins = null;
    SHEETS.forEach((s, i) => {
      const t = this.sets[i];
      if (s === 'earth' && this.o.earth) return void (mats[s] = this.o.earth);
      const m = new THREE.MeshStandardMaterial(t ? { map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, roughness: 1, metalness: 0, vertexColors: true } : { color: 0x2a2826, roughness: 0.62, metalness: 0.6, vertexColors: true });
      mats[s] = this.atmo.register(m, stoneLook({ ...(t ? own(PICTURES[s]) : {}), snow: this.snowU, attr: 'aSnow', thin: s === 'timber' ? 0.3 : 0 }), `castle ${s}`);
    });
    const cast: THREE.BufferGeometry[] = [];
    const stand = (to: THREE.Group, name: string, of: Record<Sheet, Packed>) => {
      for (const s of SHEETS) {
        if (!of[s].pos.length) continue;
        const mesh = new THREE.Mesh(geometry(of[s]), mats[s]);
        mesh.name = `${name}:${s}`;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        to.add(mesh);
        if (to === this.near) cast.push(mesh.geometry);
        this.counts.draws++;
      }
    };
    stand(this.near, 'castle', k.near);
    stand(this.under, 'castle under', k.under);
    // the kit's pieces, each material of them one thing to draw; the snow lies on them as on the rest (each corner is asked whether the sky is over it)
    const kit = await kitMeshes('fort_kit', castleKit(), {
      attr: { name: 'aSnow', of: (p, n) => [castleSky(p, n), 9] },
      dress: (m, name) => this.atmo.register(m, stoneLook({ ...(KIT_STONE[name] ?? {}), snow: this.snowU, attr: 'aSnow' }), `castle kit ${name}`),
    });
    const door = await kitMeshes('large_castle_door', castleDoor(), { dress: (m, name) => this.atmo.register(m, undefined, `castle door ${name}`) });
    // scanned rock round the rock the ramp leaves from and under the walls: the far copy's few triangles, the model's own pictures
    const ground = this.o.ground, P = this.place;
    const rocks = await kitMeshes('rock_face_01', castleRocks(ground ? (x, z) => { const [wx, , wz] = castleAt(P, x, z); return ground(wx, wz) - P.y; } : undefined, this.o.rock !== false), {
      shapes: 1,
      attr: { name: 'aSnow', of: () => [1, 9] },
      dress: (m, name) => this.atmo.register(m, stoneLook({ ...ROCK_STONE, snow: this.snowU, attr: 'aSnow' }), `castle rock ${name}`),
    });
    for (const mesh of [...kit.meshes, ...door.meshes, ...rocks.meshes]) {
      this.near.add(mesh);
      cast.push(mesh.geometry);
      this.sharp.push(mesh.material as THREE.Material);
      this.counts.draws++;
    }
    this.counts.kit = kit.triangles + door.triangles + rocks.triangles;
    // One shape for the sun's shadow maps, as the buildings have: a shadow map takes no notice of stuff, and six
    // things drawn again into each of three maps is eighteen where three will do.
    {
      const n = cast.reduce((t, g) => t + g.getAttribute('position').count, 0), pos = new Float32Array(n * 3);
      let at = 0;
      for (const g of cast) {
        pos.set(g.getAttribute('position').array as Float32Array, at);
        at += g.getAttribute('position').count * 3;
      }
      const shadow = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
      shadow.computeBoundingSphere();
      const caster = new THREE.Mesh(shadow, new THREE.MeshBasicMaterial({ shadowSide: THREE.DoubleSide }));
      caster.castShadow = true;
      caster.matrixAutoUpdate = false;
      caster.intersectsFrustum = (f) => SHADOW_FRUSTA.has(f);
      caster.name = 'castle shadow';
      this.near.add(caster);
    }
    // (got ready where it will stand, but not yet in the world: its first frame there then costs what any other does)
    const hold = new THREE.Group();
    hold.applyMatrix4(this.group.matrixWorld);
    hold.add(this.near, this.under);
    hold.updateMatrixWorld(true);
    this.near.visible = this.under.visible = true;
    await this.o.ready?.(hold).catch(() => {});
    this.near.visible = this.under.visible = false;
    this.group.add(this.near, this.under);
    this.group.updateMatrixWorld(true);
    if (this.o.fire) this.flames = this.fires.map((at) => Object.assign(this.o.fire!(at, CRESSET.size), { strength: 0 }));
    this.state = 'near';
  }

  private solid(s: Solid) {
    const P = this.place, R = physics.R, turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.rot);
    const at = (x: number, y: number, z: number) => { const [wx, wy, wz] = castleAt(P, x, z, y); return { x: wx, y: wy, z: wz }; };
    if (s.t === 'box') {
      physics.addStaticQuat(R.ColliderDesc.cuboid(s.h[0], s.h[1], s.h[2]), s.surface, at(s.c[0], s.c[1], s.c[2]), turn.clone().multiply(new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3])), undefined, s.feet ? GLASS_GROUPS : WORLD_GROUPS);
    } else if (s.t === 'hull') {
      const pts = new Float32Array(s.pts.length);
      for (let i = 0; i < s.pts.length; i += 3) {
        const w = at(s.pts[i], s.pts[i + 1], s.pts[i + 2]);
        pts.set([w.x, w.y, w.z], i);
      }
      const desc = R.ColliderDesc.convexHull(pts);
      if (desc) physics.addStaticQuat(desc, s.surface, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, undefined, s.feet ? GLASS_GROUPS : WORLD_GROUPS);
    } else {
      // (ground, given as the ground itself is: so that the legs' rule for steep ground holds on it, as on any hillside)
      const W = s.nx + 1, hcm = new Float32Array(W * (s.nz + 1));
      for (let ix = 0; ix <= s.nx; ix++) for (let iz = 0; iz <= s.nz; iz++) hcm[iz + ix * (s.nz + 1)] = s.heights[iz * W + ix];
      physics.addStatic(R.ColliderDesc.heightfield(s.nz, s.nx, hcm, { x: s.nx * s.cell, y: 1, z: s.nz * s.cell }), s.surface, at(s.x0 + (s.nx * s.cell) / 2, 0, s.z0 + (s.nz * s.cell) / 2), P.rot);
    }
  }

  /**
   * Each frame: which shapes of it are drawn, and its fires.
   * @param night how dark it is, 0 by day to 1 at night
   * @param lit told of each fire that is alight now, and how brightly (0..1)
   */
  update(dt: number, eye: THREE.Vector3, night: number, lit: (pos: THREE.Vector3, burn: number) => void) {
    const P = this.place, off = Math.hypot(eye.x - P.x, eye.z - P.z);
    if (this.state === 'far' && off < ASK) this.ask();
    if (this.state === 'asked' && this.skins && this.come()) void this.build();
    const near = this.state === 'near' && off < NEAR;
    this.near.visible = near;
    this.far.visible = !near;
    this.under.visible = near && off < UNDER_SEEN;
    this.clock += dt;
    // (its fires are lit as the light goes; and those under the terrace burn by day as well: it is always night there)
    const dusk = Math.min(1, Math.max(0, (night - 0.3) / 0.3));
    this.fires.forEach((pos, k) => {
      const burn = near ? (pos.y < P.y - 0.5 ? 1 : dusk) : 0;
      if (this.flames[k]) this.flames[k].strength = burn;
      if (burn > 0 && off < 90) lit(pos, burn * (0.8 + 0.2 * Math.sin(this.clock * 9 + k * 2.1)));
    });
  }
}
