// Traps on the ground, as this game has them (the rules are src/sim/traps.ts, and the server keeps them: server/traps.ts).
// Drawn as the server says they are near; held F takes one up. An item leaves the pockets only when the server has said
// the trap is set, so one refused is not lost.

import * as THREE from 'three';
import { physics, SOLID_GROUPS } from '../core/physics';
import type { C2S, S2C } from '../net/protocol';
import { ITEMS, type ItemInstance } from '../sim/items';
import { TRAPS, isTrap, type TrapKind } from '../sim/traps';
import type { ItemModels } from './loot';

export interface TrapHost {
  scene: THREE.Scene;
  models: ItemModels;
  online(): boolean;
  send(m: C2S): void;
  /** a key has just gone down */
  pressed(code: string): boolean;
  note(text: string): void;
  /** the hands at it for so long, and then `done` */
  work(label: string, seconds: number, item: string, done: () => void): void;
  /** where the player stands and which way they look along the ground */
  feet(): THREE.Vector3;
  facing(): THREE.Vector3;
}

/** how near to one the prompt to take it up comes, metres */
const NEAR = 1.7;
/** how far before the feet one is set, metres */
const AHEAD = 1.1;
/** what a mine is let into the ground by, metres: the top of it shows */
const SUNK: Record<TrapKind, number> = { bear_trap: 0, land_mine: 0.02 };

const _ray = new THREE.Vector3(), _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _tilt = new THREE.Quaternion();

export class Traps {
  private here = new Map<number, { k: TrapKind; root: THREE.Group; x: number; y: number; z: number }>();
  private waiting = new Map<string, ItemInstance>();

  constructor(private h: TrapHost) {}

  /** what the server says lies near */
  onNear(near: Extract<S2C, { t: 'traps' }>['near']) {
    const now = new Set(near.map((n) => n[0]));
    for (const i of [...this.here.keys()]) if (!now.has(i)) this.gone(i);
    for (const [i, k, x, y, z, yaw] of near) {
      if (this.here.has(i) || !isTrap(k)) continue;
      const root = new THREE.Group();
      root.position.set(x, y - SUNK[k], z);
      root.rotation.y = yaw;
      // (lying with the ground under it, and not flat in the air off a slope)
      const hit = physics.raycast(_ray.set(x, y + 0.8, z), { x: 0, y: -1, z: 0 }, 2, SOLID_GROUPS);
      if (hit?.normal) root.quaternion.premultiply(_tilt.setFromUnitVectors(_up, _n.set(hit.normal.x, hit.normal.y, hit.normal.z).normalize()));
      this.h.scene.add(root);
      this.here.set(i, { k, root, x, y, z });
      void this.h.models.get(k).then((tpl) => root.add(tpl.group.clone()), () => {});
    }
  }

  gone(i: number) {
    const t = this.here.get(i);
    if (!t) return;
    t.root.removeFromParent();
    this.here.delete(i);
  }

  /** the prompt, if one is near enough; and it is taken up if F has just gone down. */
  prompt(free: boolean): string | null {
    const me = this.h.feet();
    let best: number | null = null, top = NEAR;
    for (const [i, t] of this.here) {
      const d = Math.hypot(t.x - me.x, t.z - me.z);
      if (d < top && Math.abs(t.y - me.y) < 1.6) {
        top = d;
        best = i;
      }
    }
    if (best === null) return null;
    const t = this.here.get(best)!, name = ITEMS[t.k].name.toLowerCase(), i = best;
    if (free && this.h.pressed('KeyF')) this.h.work(`Taking up the ${name}`, TRAPS[t.k].take, t.k, () => this.h.send({ t: 'untrap', i }));
    return `<kbd>F</kbd>Take up the ${name}`;
  }

  /** the hands set one down before the feet */
  begin(item: ItemInstance) {
    if (!this.h.online()) return this.h.note('Traps are set on a server: join a game to set one');
    const def = ITEMS[item.id];
    this.h.work(`Setting the ${def.name.toLowerCase()}`, def.use?.time ?? 3, item.id, () => {
      const me = this.h.feet(), f = this.h.facing(), x = me.x + f.x * AHEAD, z = me.z + f.z * AHEAD;
      // (on whatever is under that place: the ground, a floor, a road)
      const hit = physics.raycast(_ray.set(x, me.y + 1.2, z), { x: 0, y: -1, z: 0 }, 3, SOLID_GROUPS);
      const y = hit ? me.y + 1.2 - hit.toi : me.y;
      this.waiting.set(item.uid, item);
      this.h.send({ t: 'trap', k: item.id, uid: item.uid, o: [x, y, z], yaw: Math.atan2(f.x, f.z) });
    });
  }

  /** the server has set it: what left the hands */
  set(uid: string): ItemInstance | null {
    const it = this.waiting.get(uid) ?? null;
    this.waiting.delete(uid);
    return it;
  }

  reset() {
    for (const i of [...this.here.keys()]) this.gone(i);
    this.waiting.clear();
  }
}
