// Forges as the game draws them (2026-10-25, plan-crafting; the rules are src/sim/craft/forge.ts, the server's side
// server/forge.ts), and the other pieces of crafting drawn by a model of their own (the research table): each model where
// its piece stands (base building draws only their solids, src/sim/build/solids.ts `unseen`), and while a forge
// burns, a fire in its door and a warm light round it ("glowing at night: a light that gives your base away"),
// unseen from outside a room shut all round in stone or metal, as a torch is (src/sim/build/rooms.ts). Online, whether
// one burns is the server's word; played alone, this game runs its own forges on their stores.

import * as THREE from 'three';
import { assets } from '../core/assets';
import type { Flames, Fire } from './flames';
import type { Bases } from '../sim/build/bases';
import { PIECES } from '../sim/build/pieces';
import { toWorld, worldYaw } from '../sim/build/snap';
import { FORGE, cold, forgeStep, lit, type Fire as Burn } from '../sim/craft/forge';
import type { Container } from '../sim/inventory';
import type { StoredItem } from '../net/protocol';
import type { S2C } from '../net/protocol';

export interface ForgeHost {
  scene: THREE.Scene;
  online: () => boolean;
  /** the bases this game knows */
  bases: () => Bases;
  flames: () => Flames;
  glow: (at: THREE.Vector3, color: THREE.Color, power: number, reach: number) => void;
  /** a light there is shut in a stone room the eye is not in */
  shut: (at: THREE.Vector3) => boolean;
  me: () => THREE.Vector3;
  /** played alone: a forge's store, by its box's id */
  store: (cid: string) => Container | undefined;
  /** played alone: a store changed (the screen drawn again if it is open) */
  changed: () => void;
}

/** the model each of crafting's pieces is drawn with */
const MODEL: Record<string, string> = { forge: 'forge_hf', research_table: 'research_table' };
/** how far off a forge is drawn, and its fire seen */
const SEEN = { model: 160, fire: 90 };
/** its fire (of a campfire's 1) where its door is, and its light (of a street lamp's 1, and how far it reaches) */
export const FIRE = { size: 0.22, at: [0, 0.28, 0.3] as [number, number, number], power: 0.9, reach: 14 };
const WARM = new THREE.Color(1, 0.55, 0.22);
/** a forge the server last said burns is taken to be out this long after, s (it is told again every 5 s while it burns) */
const STALE = 12;

interface Drawn {
  root: THREE.Object3D;
  door: THREE.Vector3;
  fire: Fire | null;
  /** a forge (it has a fire); else only drawn */
  forge: boolean;
}

export class ForgeView {
  private models = new Map<string, THREE.Object3D>();
  private drawn = new Map<string, Drawn>();
  /** online: when each forge was last said to burn (performance.now, s) */
  private told = new Map<string, number>();
  /** played alone: each forge's own fire */
  private own = new Map<string, Burn>();
  private t = 0;
  private tick = 0;

  constructor(private h: ForgeHost) {
    for (const [k, id] of Object.entries(MODEL)) void assets.model(id).then((m) => this.models.set(k, m)).catch(() => {});
  }

  onForge(m: Extract<S2C, { t: 'forge' }>) {
    const key = `${m.b}:${m.p}`;
    if (m.lit) this.told.set(key, performance.now() / 1000);
    else this.told.delete(key);
  }

  /** whether a forge burns (by its base and piece) */
  burning(b: number, p: number) {
    const key = `${b}:${p}`;
    if (!this.h.online()) return lit(this.own.get(key) ?? cold());
    const at = this.told.get(key);
    return at !== undefined && performance.now() / 1000 - at < STALE;
  }

  /** each frame: the forges near drawn (found twice a second), their fires lit or put out; played alone, run once a second */
  update(dt: number) {
    const me = this.h.me();
    if ((this.t -= dt) <= 0 && this.models.size) {
      this.t = 0.5;
      const near = new Set<string>();
      for (const b of this.h.bases().near(me.x, me.z, SEEN.model)) {
        for (const p of b.pieces.values()) {
          const model = this.models.get(p.k);
          if (!model) continue;
          const key = `${b.id}:${p.id}`;
          near.add(key);
          if (this.drawn.has(key)) continue;
          const root = model.clone(), yaw = worldYaw(b, p.r);
          root.position.set(...toWorld(b, p.x, p.y, p.z));
          root.rotation.y = yaw;
          this.h.scene.add(root);
          const door = new THREE.Vector3(...FIRE.at).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(root.position);
          this.drawn.set(key, { root, door, fire: null, forge: p.k === 'forge' });
        }
      }
      for (const [key, d] of this.drawn) {
        if (near.has(key)) continue;
        this.h.scene.remove(d.root);
        if (d.fire) this.h.flames().remove(d.fire);
        this.drawn.delete(key);
      }
    }
    if (!this.h.online() && (this.tick += dt) >= 1) {
      this.tick -= 1;
      this.runOwn();
    }
    for (const [key, d] of this.drawn) {
      if (!d.forge) continue;
      const [b, p] = key.split(':').map(Number);
      const on = this.burning(b, p) && d.door.distanceTo(me) < SEEN.fire;
      if (on && !d.fire) {
        d.fire = this.h.flames().add(d.door, { size: FIRE.size, smoke: 0.3 });
        d.fire.strength = 1;
      } else if (!on && d.fire) {
        this.h.flames().remove(d.fire);
        d.fire = null;
      }
      if (on && !this.h.shut(d.door)) this.h.glow(d.door, WARM, FIRE.power, FIRE.reach);
    }
  }

  /** the bar over a forge's store in the inventory (null: the store is no forge's) */
  bar(st: { uid: string }): { sig: string; el: () => HTMLElement } | null {
    const m = /^bbox:(\d+):(\d+)$/.exec(st.uid), b = m && this.h.bases().bases.get(Number(m[1]));
    if (!m || b?.pieces.get(Number(m[2]))?.k !== 'forge') return null;
    const on = this.burning(Number(m[1]), Number(m[2]));
    return {
      sig: `forge:${on}`,
      el: () => {
        const el = document.createElement('div');
        el.className = `inv-machine forge ${on ? 'on' : ''}`;
        el.innerHTML = `<span><b>${on ? 'Burning' : 'Cold'}</b><em>${on ? `Smelting: ${FORGE.frags} fragments into a bar every ${FORGE.smelt} s, while its wood lasts` : `It lights itself with wood in it and ${FORGE.frags} metal fragments to smelt`}</em></span><i></i>`;
        return el;
      },
    };
  }

  /** played alone: every forge of this game's own run a second on, its store changed in place */
  private runOwn() {
    const size = PIECES.forge.store!;
    let changed = false;
    for (const b of this.h.bases().bases.values()) {
      for (const p of b.pieces.values()) {
        if (p.k !== 'forge') continue;
        const key = `${b.id}:${p.id}`, c = this.h.store(`bbox:${b.id}:${p.id}`);
        if (!c) continue;
        let f = this.own.get(key);
        if (!f) this.own.set(key, (f = cold()));
        const items: StoredItem[] = c.items.map((q) => ({ ...q.item, x: q.x, y: q.y, rot: q.rot }));
        if (!forgeStep(f, items, size[0], size[1], 1)) continue;
        c.load({ items });
        changed = true;
      }
    }
    if (changed) this.h.changed();
  }

  /** a new server, or none: what was drawn is drawn again as the bases come (this game's own forges burn on: their bases are kept) */
  reset() {
    for (const d of this.drawn.values()) {
      this.h.scene.remove(d.root);
      if (d.fire) this.h.flames().remove(d.fire);
    }
    this.drawn.clear();
    this.told.clear();
  }
}
