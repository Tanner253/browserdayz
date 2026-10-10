// The traders as they are seen: a body behind the counter of every shop (see src/sim/trade.ts
// for what he pays and asks). The same on everybody's screen without a word passing between
// them: where a shop stands is the map's, and he stands in it.

import * as THREE from 'three';
import { Avatar } from './avatar';
import { lookFor } from './look';
import type { Atmosphere } from '../world/atmosphere';
import type { World } from '../world/worldgen';
import { physics } from '../core/physics';

/** where he stands in a shop, in the shop's own measure: behind the counter, between it and the shelves, facing the door */
const BEHIND = { x: -0.9, z: -0.45 };
/** how near, and how squarely looked at, he has to be to be spoken to */
const REACH = 3.2, FACING = 0.8;
/** he is posed only for somebody this near (a body standing still costs what a body costs) */
const SEEN = 45;

interface Stand {
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
  private stands: Stand[] = [];

  constructor(world: World) {
    for (const b of world.buildings) {
      if (b.type !== 'store') continue;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const yaw = b.rot + Math.PI;
      this.stands.push({ pos: new THREE.Vector3(b.x + BEHIND.x * c + BEHIND.z * s, b.floorY, b.z - BEHIND.x * s + BEHIND.z * c), yaw, now: yaw, body: null });
    }
  }

  /** where they all are (for the map) */
  get places() {
    return this.stands.map((s) => s.pos);
  }

  async load(scene: THREE.Scene, atmo: Atmosphere, wear: (body: Avatar, ids: string[]) => Promise<void>) {
    await Promise.all(
      this.stands.map(async (s, i) => {
        const body = new Avatar();
        await body.load(atmo, 0, false, lookFor(`trader ${i}`));
        await wear(body, ['boonie_hat', 'life_vest', 'work_gloves']);
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

  /** the one that is being looked at from close by, if any: where his chest is */
  at(eye: THREE.Vector3, look: THREE.Vector3): THREE.Vector3 | null {
    for (const s of this.stands) {
      if (!s.body) continue;
      _to.set(s.pos.x, s.pos.y + 1.3, s.pos.z).sub(eye);
      const d = _to.length();
      if (d < REACH && _to.multiplyScalar(1 / d).dot(look) > FACING) return s.pos;
    }
    return null;
  }

  /** whether a place is still within speaking distance of one of them */
  by(p: THREE.Vector3) {
    return this.stands.some((s) => Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < REACH + 1.5);
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
