// The traders as they are seen: a body behind each counter of the trader camp, the shop at the trading post and the
// stalls before it (src/sim/camp.ts says where they stand, what each sells and for what). The same on everybody's screen
// without a word passing between them: where the camp stands is the map's, and they stand in it.

import * as THREE from 'three';
import { Avatar } from './avatar';
import { lookFor } from './look';
import type { Atmosphere } from '../world/atmosphere';
import { physics } from '../core/physics';
import type { StallId, StallSpot } from '../sim/camp';

/** how near, and how squarely looked at, one has to be to be spoken to */
const REACH = 3.2, FACING = 0.8;
/** each is posed only for somebody this near (a body standing still costs what a body costs) */
const SEEN = 45;
/** what each stall's trader wears */
const DRESS: Record<StallId, string[]> = {
  building: ['boonie_hat', 'life_vest', 'work_gloves'],
  weapons: ['patrol_cap', 'chest_rig', 'work_gloves'],
  medical: ['fishermans_hat', 'garden_gloves'],
  clothing: ['field_jacket', 'patrol_cap'],
};

interface Stand {
  stall: StallId;
  pos: THREE.Vector3;
  /** the way he faces when nobody is by */
  yaw: number;
  /** the way he is facing now */
  now: number;
  body: Avatar | null;
}

const _to = new THREE.Vector3();
const _still = new THREE.Vector3();

export class Traders {
  private stands: Stand[];

  constructor(spots: StallSpot[]) {
    this.stands = spots.map((s) => ({ stall: s.id, pos: new THREE.Vector3(...s.at), yaw: s.yaw, now: s.yaw, body: null }));
  }

  async load(scene: THREE.Scene, atmo: Atmosphere, wear: (body: Avatar, ids: string[]) => Promise<void>) {
    await Promise.all(
      this.stands.map(async (s, i) => {
        const body = new Avatar();
        await body.load(atmo, 0, false, lookFor(`trader ${i}`));
        await wear(body, DRESS[s.stall]);
        body.update(0, s.pos, _still, s.yaw, false, false);
        scene.add(body.root);
        // (he is solid: not walked through, and a shot at him stops at him. He is not hurt by it.)
        physics.addStatic(physics.R.ColliderDesc.capsule(0.55, 0.26), 'cloth', { x: s.pos.x, y: s.pos.y + 0.85, z: s.pos.z });
        s.body = body;
      }),
    );
  }

  update(dt: number, eye: THREE.Vector3) {
    for (const s of this.stands) {
      if (!s.body) continue;
      const d = _to.copy(eye).sub(s.pos).setY(0).length();
      s.body.root.visible = d < SEEN * 3;
      if (d > SEEN) continue;
      // he turns to whoever comes up to the counter, as far as a man turns without moving his feet
      let want = s.yaw;
      if (d < 7) want = s.yaw + THREE.MathUtils.clamp(wrap(Math.atan2(-_to.x, -_to.z) - s.yaw), -1.1, 1.1);
      s.now += wrap(want - s.now) * (1 - Math.exp(-4 * dt));
      s.body.update(dt, s.pos, _still, s.now, false, false);
    }
  }

  /** the one that is being looked at from close by, if any: his stall */
  at(eye: THREE.Vector3, look: THREE.Vector3): StallId | null {
    for (const s of this.stands) {
      if (!s.body) continue;
      _to.set(s.pos.x, s.pos.y + 1.3, s.pos.z).sub(eye);
      const d = _to.length();
      if (d < REACH && _to.multiplyScalar(1 / d).dot(look) > FACING) return s.stall;
    }
    return null;
  }

  /** whether a place is still within speaking distance of a stall's trader */
  by(p: THREE.Vector3, stall: StallId) {
    return this.stands.some((s) => s.stall === stall && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < REACH + 1.5);
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
