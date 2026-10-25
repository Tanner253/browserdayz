// Each claim's pole and its flag. The owner, 2026-10-25: "the flag pole should be skinnier and it will be tall ... past
// the top floor of the base if the user puts more stories on their base then it will increase the height of the flag";
// "do 2 stories over the roof not 1 because the flag should lower on the pole indicating its decay state when theflag
// reaches the ground of the base then it will start decaying". So a steel pipe from the strongbox's lid to two storeys
// over the base's highest point, and the flag up it as far as the claim's store keeps the base: at the top for two days
// or more, at its foot when the store has run dry and the base rots. Everybody sees it, raiders too.

import * as THREE from 'three';
import type { Atmosphere } from '../../world/atmosphere';
import { PIECES, STOREY } from '../../sim/build/pieces';
import { shapeOf } from '../../sim/build/solids';
import { toWorld, worldYaw, type Base, type Claim } from '../../sim/build/snap';
import { FLAG_SIZE, boxOf, flagOf, type Built } from './models';

/** the pole: its foot on the lid beside the strongbox's hasp, how thick, how many storeys over the base it stands; the flag right up for this long kept (ms) */
const POLE = { foot: [0.07, 0.45, -0.05] as const, r: 0.028, over: 2, full: 48 * 3600_000 };
/** which way the wind blows the flags, the world over (radians about up, from +x) */
const WIND = 0.8;

/** how far up its pole a claim's flag flies: 0 at its foot (the store dry, the base rotting) to 1 at its top */
export function flagUp(c: Claim, now: number): number {
  if (c.dry) return 0;
  if (c.until === undefined || c.until < 0) return 1;
  return THREE.MathUtils.clamp((c.until - now) / POLE.full, 0, 1);
}

/** how high a kind stands over its own foot, metres */
const tall = new Map<string, number>();
const tallOf = (k: string) => tall.get(k) ?? (tall.set(k, boxOf([...shapeOf(k).solid])[1][1]), tall.get(k)!);

interface Pole {
  base: Base;
  group: THREE.Group;
  pole: THREE.Mesh;
  flag: THREE.Mesh | null;
  /** its length, and how high the flag flies, in the claim's own frame */
  long: number;
  y: number;
}

export class ClaimFlags {
  private poles = new Map<number, Pole>();
  private steel = new THREE.MeshStandardMaterial({ color: 0x8b8f93, metalness: 0.7, roughness: 0.38, name: 'claim-pole' });
  private cloth: Built | null = null;

  constructor(private scene: THREE.Scene, atmo: Atmosphere | null) {
    if (atmo) atmo.register(this.steel);
    void flagOf(atmo).then((f) => {
      this.cloth = f;
      for (const p of this.poles.values()) this.hoist(p);
    });
  }

  /** the bases with a claim drawn now: each pole stood, made as long as its base is tall, or taken down */
  sync(bases: Iterable<Base>) {
    const seen = new Set<number>();
    for (const base of bases) {
      const cp = base.claim && base.pieces.get(base.claim.p);
      if (!cp) continue;
      seen.add(base.id);
      let top = 0;
      for (const q of base.pieces.values()) if (PIECES[q.k].role !== 'deploy') top = Math.max(top, q.y + tallOf(q.k));
      const long = Math.max(STOREY, top + POLE.over * STOREY - cp.y - POLE.foot[1]);
      let p = this.poles.get(base.id);
      if (!p) {
        const group = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.BufferGeometry(), this.steel);
        pole.castShadow = true;
        group.add(pole);
        this.scene.add(group);
        p = { base, group, pole, flag: null, long: 0, y: -1 };
        this.poles.set(base.id, p);
        this.hoist(p);
      }
      p.base = base;
      p.group.position.set(...toWorld(base, cp.x, cp.y, cp.z));
      p.group.rotation.y = worldYaw(base, cp.r);
      if (Math.abs(p.long - long) > 0.01) {
        p.long = long;
        p.pole.geometry.dispose();
        // (a pipe a little narrower at its top, and a cap on it)
        const g = new THREE.CylinderGeometry(POLE.r * 0.8, POLE.r, long, 10).translate(POLE.foot[0], POLE.foot[1] + long / 2, POLE.foot[2]);
        const cap = new THREE.SphereGeometry(POLE.r * 1.6, 10, 6).translate(POLE.foot[0], POLE.foot[1] + long + POLE.r, POLE.foot[2]);
        p.pole.geometry = mergeTwo(g, cap);
      }
      if (p.flag) p.flag.rotation.y = WIND - p.group.rotation.y;
    }
    for (const [id, p] of [...this.poles]) if (!seen.has(id)) this.drop(id, p);
  }

  /** the flags run up or down their poles, a little at a time */
  update(dt: number, now = Date.now()) {
    for (const p of this.poles.values()) {
      if (!p.flag || !p.base.claim) continue;
      const half = FLAG_SIZE[1] / 2, want = POLE.foot[1] + half + flagUp(p.base.claim, now) * (p.long - FLAG_SIZE[1] - 0.05);
      p.y = p.y < 0 ? want : p.y + (want - p.y) * Math.min(1, dt * 0.6);
      p.flag.position.set(POLE.foot[0], p.y, POLE.foot[2]);
    }
  }

  clear() {
    for (const [id, p] of [...this.poles]) this.drop(id, p);
  }

  private hoist(p: Pole) {
    if (!this.cloth || p.flag) return;
    p.flag = new THREE.Mesh(this.cloth.geo, this.cloth.mat);
    p.flag.castShadow = true;
    p.flag.rotation.y = WIND - p.group.rotation.y;
    p.group.add(p.flag);
  }

  private drop(id: number, p: Pole) {
    p.group.removeFromParent();
    p.pole.geometry.dispose();
    this.poles.delete(id);
  }
}

/** two geometries of the same attributes made one */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.toNonIndexed(), B = b.toNonIndexed(), out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = A.getAttribute(name) as THREE.BufferAttribute, y = B.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return out;
}
