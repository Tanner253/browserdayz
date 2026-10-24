// G, in the game: a tap puts what is in the hands down at the feet; held, a throw winds up, the bar filling with how long
// it is held, and letting go throws it along the way the player looks, as hard as the bar says (the owner, 2026-10-23:
// "press g to drop an item in my hands and hold G to throw an item in my hands with power depending on how long held,
// and a bar to indicate, like dayz. can cancel with scroll wheel or change slots with controller"). It flies through
// the same world in every game (src/sim/throw.ts) and lies where it comes to rest; the server believes it there only
// as far as that throw carries (server/throws.ts). Grenades keep their own throw.

import * as THREE from 'three';
import { physics, SOLID_GROUPS } from '../core/physics';
import { audio } from '../core/audio';
import type { C2S } from '../net/protocol';
import type { ItemInstance } from '../sim/items';
import { THROW, flightStep, powerOf, throwReach, throwSpeed, type Met, type V3 } from '../sim/throw';
import type { ItemModels } from './loot';

export interface ThrowHost {
  scene: THREE.Scene;
  models: ItemModels;
  /** what is in the hands to be thrown, if anything (not a grenade: it has its own throw) */
  throwable(): ItemInstance | null;
  /** a tap: what is in the hands put down at the feet, as G always did */
  drop(): void;
  /** it has left the hands: out of the inventory, as anything let go of is */
  letGo(item: ItemInstance): void;
  /** where the eye is and which way it looks */
  eye(): { pos: THREE.Vector3; dir: THREE.Vector3 };
  /** it came to rest there: laid in the world, and told to the server as a drop is */
  lay(item: ItemInstance, at: THREE.Vector3, rot: number): void;
  send(m: C2S): void;
  online(): boolean;
}

interface Flying {
  item: ItemInstance | null;
  obj: THREE.Group;
  pos: V3;
  vel: V3;
  from: V3;
  power: number;
  spin: THREE.Vector3;
  age: number;
}

const hit = (from: V3, dir: V3, len: number): Met => {
  const h = physics.raycast({ x: from[0], y: from[1], z: from[2] }, { x: dir[0], y: dir[1], z: dir[2] }, len, SOLID_GROUPS);
  return h ? { toi: h.toi, normal: [h.normal.x, h.normal.y, h.normal.z] } : null;
};

export class Throwing {
  /** how long G has been held; whether a throw is winding up; whether it was put off and G is still down */
  private held = 0;
  private winding = false;
  private off = false;
  private flying: Flying[] = [];

  constructor(private host: ThrowHost) {}

  /** a throw is being wound up: how hard it would go, 0 to 1 (null: none) */
  get power(): number | null {
    return this.winding ? powerOf(this.held) : null;
  }

  /**
   * Each frame that G may do anything: whether it is down. Let go of after a tap, what is held is put down; after
   * longer, thrown at the bar's power. (Nothing to throw, a grenade among them: held, it is put down when let go of.)
   */
  key(down: boolean, dt: number) {
    if (down) {
      if (this.off) return;
      this.held += dt;
      if (!this.winding && this.held >= THROW.tap && this.host.throwable()) this.winding = true;
      return;
    }
    if (!this.off && this.held > 0) {
      if (this.winding) this.release(powerOf(this.held));
      else this.host.drop();
    }
    this.held = 0;
    this.winding = false;
    this.off = false;
  }

  /** put off (the wheel, another slot, the hands taken up with something else): nothing more until G is let go of */
  cancel() {
    if (this.held <= 0 && !this.winding) return;
    this.off = true;
    this.winding = false;
    this.held = 0;
  }

  /** let go at this power: out of the hands, along the eye, and into the air */
  private release(power: number) {
    const item = this.host.throwable();
    if (!item) return;
    const { pos, dir } = this.host.eye();
    // (from the hand, a little ahead of the eye and below it: from the eye itself if a wall is that near)
    const near = physics.raycast(pos, dir, 0.55, SOLID_GROUPS);
    const o = near ? pos.clone() : pos.clone().addScaledVector(dir, 0.45).add(new THREE.Vector3(0, -0.22, 0));
    const v = dir.clone().multiplyScalar(throwSpeed(power)).add(new THREE.Vector3(0, THROW.lift, 0));
    this.host.letGo(item);
    audio.whoosh(0.4 + power * 0.6, o);
    const r = (n: number) => Math.round(n * 1000) / 1000;
    if (this.host.online()) this.host.send({ t: 'toss', uid: item.uid, id: item.id, o: [r(o.x), r(o.y), r(o.z)], v: [r(v.x), r(v.y), r(v.z)], pw: r(power) });
    this.fly(item, item.id, [o.x, o.y, o.z], [v.x, v.y, v.z], power);
  }

  /** somebody near threw something: it is flown here too, and goes when it lies still (the server says where it lies) */
  seen(id: string, o: V3, v: V3) {
    this.fly(null, id, [...o], [...v], 1);
  }

  private fly(item: ItemInstance | null, id: string, pos: V3, vel: V3, power: number) {
    const obj = new THREE.Group();
    obj.position.set(pos[0], pos[1], pos[2]);
    this.host.scene.add(obj);
    void (item ? this.host.models.getFor(item) : this.host.models.get(id)).then((tpl) => obj.add(tpl.group.clone()), () => {});
    this.flying.push({ item, obj, pos, vel, from: [...pos], power, spin: new THREE.Vector3(5 + Math.random() * 4, 2, 3), age: 0 });
  }

  update(dt: number) {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.age += dt;
      let still = f.age > THROW.most;
      for (let left = dt; left > 0 && !still; left -= 1 / 120) {
        still = flightStep(f.pos, f.vel, Math.min(left, 1 / 120), hit);
        // (no further than the server will believe it lies: down a slope, it stops there and does not tumble on)
        if (f.item && Math.hypot(f.pos[0] - f.from[0], f.pos[2] - f.from[2]) > throwReach(f.power, f.from[1] - f.pos[1]) - THROW.slack) still = true;
      }
      f.obj.position.set(f.pos[0], f.pos[1], f.pos[2]);
      if (!still) {
        f.obj.rotation.x += f.spin.x * dt;
        f.obj.rotation.y += f.spin.y * dt;
        f.obj.rotation.z += f.spin.z * dt;
        continue;
      }
      f.obj.removeFromParent();
      this.flying.splice(i, 1);
      audio.ui('drop', { x: f.pos[0], y: f.pos[1], z: f.pos[2] }, f.item?.id);
      if (f.item) this.host.lay(f.item, new THREE.Vector3(f.pos[0], f.pos[1], f.pos[2]), f.obj.rotation.y);
    }
  }

  /** everything in the air gone, and nothing wound up: the game is left (the world it was flying in goes with it) */
  clear() {
    for (const f of this.flying) f.obj.removeFromParent();
    this.flying = [];
    this.held = 0;
    this.winding = false;
  }
}
