// The dead who ride on (2026-10-14). Somebody killed in a helicopter's seat stays sat in it until it is down (the
// owner: "their body should stay in the helicopter till it crashes then spawn on the ground with all the contents on
// the ground so they can be looted"): the server keeps their body with the helicopter (`riders` in server/acts.ts),
// and says 'corpse@' when it lays it on the ground beside it. Until then their body is drawn here, slumped in its seat.
import * as THREE from 'three';
import type { Atmosphere } from '../world/atmosphere';
import type { CorpseInfo } from '../net/protocol';
import { Avatar } from './avatar';
import { lookFor } from './look';
import { SEATS_OF, SIT_OF, type Garage } from './garage';

const _still = new THREE.Vector3(), _zero = new THREE.Vector3();

interface Rider {
  avatar: Avatar;
  i: number;
  seat: number;
  ready: boolean;
}

export class Riders {
  private all = new Map<string, Rider>();

  constructor(private atmo: Atmosphere, private scene: THREE.Scene, private garage: Garage) {}

  async add(c: CorpseInfo) {
    if (!c.ride || this.all.has(c.uid)) return;
    const r: Rider = { avatar: new Avatar(), i: c.ride.i, seat: c.ride.seat, ready: false };
    this.all.set(c.uid, r);
    await r.avatar.load(this.atmo, 0, false, lookFor(c.name));
    // (taken down while it was being made)
    if (this.all.get(c.uid) !== r) return r.avatar.dispose();
    this.scene.add(r.avatar.root);
    // slumped against their door: the pilot's is on the left
    r.avatar.setLean(r.seat === 0 ? -1 : 1);
    r.ready = true;
  }

  /** every one taken down (src/game/modes.ts) */
  clear() {
    for (const uid of [...this.all.keys()]) this.remove(uid);
  }

  remove(uid: string) {
    const r = this.all.get(uid);
    if (!r) return;
    this.all.delete(uid);
    if (r.ready) r.avatar.dispose();
  }

  /** each frame: every one in their seat, where the helicopter is now */
  update(dt: number) {
    for (const r of this.all.values()) {
      if (!r.ready) continue;
      const j = this.garage.jeeps.get(r.i), root = r.avatar.root;
      root.visible = !!j;
      if (!j) continue;
      const s = SEATS_OF[j.kind]?.[r.seat];
      if (!s) continue;
      r.avatar.setSeat(true, SIT_OF[j.kind]?.[r.seat] ?? null);
      j.point(s[0], s[1], s[2], _still.set(0, 0, 0));
      r.avatar.update(dt, _still, _zero, j.yaw, false, false);
      root.quaternion.copy(j.quat);
    }
  }
}
