// Recyclers as the game has them (progression v3; the rules and the layer are src/sim/craft/recyclers.ts, the server's
// side server/recycle.ts): each machine's model where the layer laid it, solid; looked at from close by, F opens its
// store in the inventory, where a bar over the grid switches it on and off and says what it is doing. While one runs it
// is heard far off (src/core/audio.ts `machine`). Online, whether one runs is the server's word; played alone, this game
// runs its own on their stores.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { RECYCLE, recycleStep, recyclable, type Recycler, type Run } from '../sim/craft/recyclers';
import type { C2S, S2C, StoredItem } from '../net/protocol';
import { Stash } from './loot';
import { FACE_TURN } from '../sim/camp';
import type { Input } from '../core/input';

export interface RecyclerHost {
  scene: THREE.Scene;
  input: Input;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  /** a store opened in the inventory */
  open: (s: Stash) => void;
  /** played alone: a store changed (the screen drawn again if it is open) */
  changed: () => void;
}

/** how near, and how squarely looked at, one has to be to open it; how far off it is drawn */
const REACH = 2.9, FACING = 0.55, SEEN = 400;

const _to = new THREE.Vector3();

export class RecyclerView {
  readonly stores: Stash[];
  private runs: Run[];
  private roots: (THREE.Object3D | null)[];
  private model: THREE.Object3D | null = null;
  private t = 0;
  private tick = 0;

  constructor(private h: RecyclerHost, readonly spots: Recycler[]) {
    const [w, hh] = RECYCLE.store;
    this.stores = spots.map((r, i) => new Stash(`recy:${i}`, r.x, r.y + 1, r.z, 0, w, hh, `Recycler · ${r.at}`));
    this.runs = spots.map(() => ({ on: false, done: 0 }));
    this.roots = spots.map(() => null);
    void assets.model(RECYCLE.model).then((m) => (this.model = m)).catch(() => {});
    // (solid from the first: its box, as its model measures)
    const e = assets.manifest.models[RECYCLE.model];
    for (const r of spots) {
      const hx = e?.min && e.max ? (e.max[0] - e.min[0]) / 2 : RECYCLE.w / 2, hy = e?.min && e.max ? (e.max[1] - e.min[1]) / 2 : 0.9, hz = e?.min && e.max ? (e.max[2] - e.min[2]) / 2 : RECYCLE.l / 2;
      physics.addStatic(physics.R.ColliderDesc.cuboid(hx * 0.9, hy, hz * 0.9), 'metal', { x: r.x, y: r.y + hy, z: r.z }, r.rot + FACE_TURN);
    }
  }

  /** the one looked at from close by: what the corner says, and F opens its store */
  prompt(eye: THREE.Vector3, look: THREE.Vector3, free: boolean): string | null {
    for (let i = 0; i < this.spots.length; i++) {
      const r = this.spots[i];
      _to.set(r.x, r.y + 1, r.z).sub(eye);
      const d = Math.hypot(_to.x, _to.z);
      if (d > REACH || _to.normalize().dot(look) < FACING) continue;
      if (free && this.h.input.pressed('KeyF')) this.h.open(this.stores[i]);
      return `<kbd>F</kbd>Recycler${this.running(i) ? ' <small>· running</small>' : ''}`;
    }
    return null;
  }

  running(i: number) {
    return !!this.runs[i]?.on;
  }

  /** switched on or off by this player (from the bar over its store) */
  toggle(i: number) {
    const on = !this.running(i);
    if (on && !this.stores[i].container.items.some((p) => recyclable(p.item))) return void this.h.note('Nothing in it goes through a recycler: parts, tools, guns, fittings, clothes and armour do', 'info');
    if (this.h.online()) return void this.h.send({ t: 'recy', i, on });
    this.runs[i] = { on, done: 0 };
    this.h.changed();
  }

  onRun(m: Extract<S2C, { t: 'recy' }>) {
    if (!this.runs[m.i]) return;
    this.runs[m.i].on = m.on;
    this.h.changed();
  }

  /** the bar over a recycler's store in the inventory (null: the store is no recycler's) */
  bar(st: { uid: string }): { sig: string; el: () => HTMLElement } | null {
    if (!st.uid.startsWith('recy:')) return null;
    const i = Number(st.uid.slice(5)), on = this.running(i);
    return {
      sig: `recy${i}:${on}`,
      el: () => {
        const el = document.createElement('div');
        el.className = `inv-machine ${on ? 'on' : ''}`;
        el.innerHTML = `<span><b>${on ? 'Running' : 'Switched off'}</b><em>${on ? 'Breaking it down, a thing every few seconds · heard a long way off' : 'Put in parts, tools, guns, fittings, clothes or armour: out come fragments, scrap and rags'}</em></span><button>${on ? 'Switch off' : 'Switch on'}</button><i></i>`;
        el.querySelector('button')!.onclick = () => this.toggle(i);
        return el;
      },
    };
  }

  /** each frame: the machines near drawn (twice a second), the sound of the nearest running, and played alone, run */
  update(dt: number, me: THREE.Vector3) {
    if ((this.t -= dt) <= 0 && this.model) {
      this.t = 0.5;
      this.spots.forEach((r, i) => {
        const near = Math.hypot(r.x - me.x, r.z - me.z) < SEEN;
        if (near && !this.roots[i]) {
          const m = this.model!.clone();
          m.position.set(r.x, r.y, r.z);
          m.rotation.y = r.rot + FACE_TURN;
          this.h.scene.add(m);
          this.roots[i] = m;
        } else if (!near && this.roots[i]) {
          this.h.scene.remove(this.roots[i]!);
          this.roots[i] = null;
        }
      });
    }
    if (!this.h.online() && (this.tick += dt) >= 1) {
      this.tick -= 1;
      this.runOwn();
    }
  }

  /** metres to the nearest one running (-1: none) */
  loudest(me: THREE.Vector3) {
    let d = -1;
    this.spots.forEach((r, i) => {
      if (!this.running(i)) return;
      const k = Math.hypot(r.x - me.x, r.y - me.y, r.z - me.z);
      if (d < 0 || k < d) d = k;
    });
    return d;
  }

  /** played alone: every running recycler a second on, its store changed in place */
  private runOwn() {
    let changed = false;
    this.stores.forEach((st, i) => {
      const run = this.runs[i];
      if (!run.on) return;
      const items: StoredItem[] = st.container.items.map((q) => ({ ...q.item, x: q.x, y: q.y, rot: q.rot }));
      const was = run.on;
      if (!recycleStep(run, items, 1)) return;
      st.container.load({ items });
      changed = true;
      if (was && !run.on) this.h.note('The recycler has stopped: nothing left in it goes through, or no room for what comes out', 'info');
    });
    if (changed) this.h.changed();
  }

  /** a new server, or none: none is running until it says so */
  reset() {
    for (const r of this.runs) r.on = false;
  }
}
