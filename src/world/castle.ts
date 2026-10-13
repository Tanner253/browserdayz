// The fort on the mountain, as it is drawn and as it stops a body. What it is and where everything in it lies is
// in src/sim/castle.ts (the server knows it too); its shapes are worked out in src/world/castle-shape.ts, as plain
// numbers; here they are given their stone and timber, stood in the world and made solid.
//
// It is drawn in seven things, one for each stuff it is made of (all of one stuff is one thing to draw, as the
// buildings are), and its shadow is thrown by an eighth that is drawn only into the shadow maps. From further off
// than NEAR it is one thing: lighter shapes of the same outline, all in the stone's picture, each coloured as what
// it stands for.
//
// The pictures are the game's own. The rubble limestone is `white_bricks`, whose courses are a hand tall, with
// most of its colour taken out and what is left raised to the pale grey of the real stone; the keep's squared
// blocks and the paving are both `concrete_tiles_02` (slabs with fine joints), the blocks with the picture turned
// on its side so that the slabs lie as courses; timber is `weathered_planks`; the living rock is `aerial_rocks_02`
// with its moss taken out; the rubble under the breach is `rocks_ground_02`.

import * as THREE from 'three';
import { GLASS_GROUPS, WORLD_GROUPS, physics } from '../core/physics';
import { assets } from '../core/assets';
import { SHADOW_FRUSTA, type Atmosphere, type ShaderPatch } from './atmosphere';
import { LAMPS, castleAt, castleLoose, looseLocal, type GroundAt, type Loose, type Paint, type Place } from '../sim/castle';
import { PAINTS, castleShape, type Skin, type Solid } from './castle-shape';

/** how far from its middle the eye may be, over the ground, for the fort's own shapes to be drawn: beyond, the lighter ones */
const NEAR = 190;
/** the colour of a cresset's fire, and how far its light carries */
export const CRESSET = { colour: new THREE.Color(1, 0.62, 0.3), reach: 11 };

/**
 * What is done to a picture to make it this stone. So much of its own colour is kept (0: grey, 1: as it came) and
 * it is raised by `lift`; then its light and its dark are drawn in toward the stone's own colour, by so much
 * (`even`: 0 leaves the picture as it is, 1 leaves none of it). Weathered limestone is pale all over: its joints
 * are grey, not black, and the picture's own are black. (The slow change of tone from one stretch of wall to the
 * next is not done here: it is in the shapes, as the lightness of each corner. See `clouds` in castle-shape.ts.)
 */
const stoneOf = (keep: number, lift: number, own: [number, number, number], even: number): ShaderPatch => (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#include <map_fragment>
{
  float castleGrey = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
  diffuseColor.rgb = mix( mix( vec3( castleGrey ), diffuseColor.rgb, ${keep.toFixed(3)} ) * ${lift.toFixed(3)}, vec3( ${own.map((v) => v.toFixed(3)).join(', ')} ), ${even.toFixed(3)} );
}`,
  );
};

/** what each stuff is drawn with: which of the game's pictures, and what is done to it (see `stoneOf`) */
const STUFF: Record<Paint, { tex: string | null; keep: number; lift: number; own: [number, number, number]; even: number; /** the picture lies on its side */ turned?: boolean }> = {
  // (No paler than this: the game's noon sun on anything lighter is white, and a white wall has no stones in it.)
  stone: { tex: 'white_bricks', keep: 0.55, lift: 0.95, own: [0.52, 0.47, 0.375], even: 0.42 },
  ashlar: { tex: 'concrete_tiles_02', keep: 0.5, lift: 0.9, own: [0.5, 0.45, 0.36], even: 0.4, turned: true },
  paving: { tex: 'concrete_tiles_02', keep: 0.5, lift: 0.85, own: [0.4, 0.37, 0.31], even: 0.45 },
  timber: { tex: 'weathered_planks', keep: 0.8, lift: 1.7, own: [0.3, 0.24, 0.18], even: 0.3 },
  iron: { tex: null, keep: 1, lift: 1, own: [0, 0, 0], even: 0 },
  rock: { tex: 'aerial_rocks_02', keep: 0.12, lift: 1.25, own: [0.52, 0.52, 0.51], even: 0.35 },
  scree: { tex: 'rocks_ground_02', keep: 0.3, lift: 1.45, own: [0.6, 0.57, 0.5], even: 0.4 },
};

function geometry(k: Skin, turned = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(), uv = new Float32Array(k.uv);
  // (the picture on its side: across it is up the wall)
  if (turned) for (let i = 0; i < uv.length; i += 2) [uv[i], uv[i + 1]] = [uv[i + 1], uv[i]];
  g.setAttribute('position', new THREE.Float32BufferAttribute(k.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(k.nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(k.col, 3));
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
}

export class CastleSite {
  /** how much of it there is to draw and to run into: for whoever asks what it costs */
  readonly counts = { near: 0, far: 0, draws: 0, solids: 0 };
  private near = new THREE.Group();
  private far: THREE.Mesh;
  private flames: THREE.Mesh;
  private flame = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private fires: THREE.Vector3[];
  private clock = 0;

  constructor(readonly place: Place, atmo: Atmosphere, scene: THREE.Scene, o: CastleOptions = {}) {
    const P = place, ground = o.ground;
    const shape = castleShape(
      ground ? (x, z) => { const [wx, , wz] = castleAt(P, x, z); return ground(wx, wz) - P.y; } : undefined,
      looseLocal(P, o.loose ?? castleLoose(P)),
      o.rock !== false,
    );

    // ---- what is seen
    const mats = {} as Record<Paint, THREE.MeshStandardMaterial>;
    for (const p of PAINTS) {
      const s = STUFF[p], t = s.tex ? assets.pbr(s.tex) : null;
      const m = new THREE.MeshStandardMaterial(t ? { map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, roughness: 1, metalness: 0, vertexColors: true } : { color: 0x2a2826, roughness: 0.62, metalness: 0.6, vertexColors: true });
      mats[p] = atmo.register(m, t ? stoneOf(s.keep, s.lift, s.own, s.even) : undefined, `castle ${p}`) as THREE.MeshStandardMaterial;
    }
    const all = new THREE.Group();
    all.name = 'castle';
    all.position.set(P.x, P.y, P.z);
    all.rotation.y = P.rot;
    all.updateMatrix();
    all.matrixAutoUpdate = false;
    const stand = (mesh: THREE.Mesh, parent: THREE.Object3D) => {
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      return mesh;
    };
    const cast: THREE.BufferGeometry[] = [];
    for (const p of PAINTS) {
      const k = shape.near[p];
      if (!k.pos.length) continue;
      const mesh = stand(new THREE.Mesh(geometry(k, STUFF[p].turned), mats[p]), this.near);
      mesh.name = `castle:${p}`;
      mesh.receiveShadow = true;
      cast.push(mesh.geometry);
      this.counts.near += k.pos.length / 9;
      this.counts.draws++;
    }
    // One shape for the sun's shadow maps, as the buildings have: a shadow map takes no notice of stuff, and seven
    // things drawn again into each of three maps is twenty-one where three will do.
    {
      const n = cast.reduce((t, g) => t + g.getAttribute('position').count, 0), pos = new Float32Array(n * 3);
      let at = 0;
      for (const g of cast) {
        pos.set(g.getAttribute('position').array as Float32Array, at);
        at += g.getAttribute('position').count * 3;
      }
      const shadow = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
      shadow.computeBoundingSphere();
      const caster = stand(new THREE.Mesh(shadow, new THREE.MeshBasicMaterial({ shadowSide: THREE.DoubleSide })), this.near);
      caster.castShadow = true;
      caster.intersectsFrustum = (f) => SHADOW_FRUSTA.has(f);
      caster.name = 'castle shadow';
    }
    this.far = stand(new THREE.Mesh(geometry(shape.far), mats.stone), all);
    this.far.name = 'castle:far';
    this.far.visible = false;
    this.counts.far = shape.far.pos.length / 9;
    all.add(this.near);
    // the fire in each cresset: a few flat flames, alight when it is dark
    const tongue = new THREE.ConeGeometry(0.1, 0.34, 5).translate(0, 0.17, 0), flames: number[] = [];
    this.fires = LAMPS.map(([x, z, y]) => new THREE.Vector3(...castleAt(P, x, z, y)));
    for (const [x, z, y] of LAMPS) for (const [dx, dz, k] of [[0, 0, 1], [0.07, 0.03, 0.7], [-0.05, 0.06, 0.6], [-0.02, -0.07, 0.75]]) {
      const src = tongue.getAttribute('position'), ix = tongue.getIndex()!;
      for (let i = 0; i < ix.count; i++) flames.push(x + dx + src.getX(ix.getX(i)) * k, y - 0.08 + src.getY(ix.getX(i)) * k, z + dz + src.getZ(ix.getX(i)) * k);
    }
    const fg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(flames, 3));
    fg.computeBoundingSphere();
    this.flames = stand(new THREE.Mesh(fg, this.flame), this.near);
    this.flames.name = 'castle:fire';
    this.flames.visible = false;
    scene.add(all);
    all.updateMatrixWorld(true);

    // ---- what stops a body and a shot
    if (physics.world) for (const s of shape.solids) this.solid(s);
    this.counts.solids = shape.solids.length;
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
    this.near.visible = off < NEAR;
    this.far.visible = !this.near.visible;
    this.clock += dt;
    // (they are lit as the light goes, and are not looked at from across the map)
    const burn = Math.min(1, Math.max(0, (night - 0.3) / 0.3));
    this.flames.visible = burn > 0 && this.near.visible;
    if (!this.flames.visible) return;
    const flick = 0.8 + 0.2 * Math.sin(this.clock * 11) * Math.sin(this.clock * 4.3 + 1);
    this.flame.color.setRGB(1.5 * burn * flick, 0.62 * burn * flick, 0.12 * burn * flick);
    this.fires.forEach((pos, k) => lit(pos, burn * (0.8 + 0.2 * Math.sin(this.clock * 9 + k * 2.1))));
  }
}
