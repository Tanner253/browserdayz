// Beds and sleeping bags on the death screen (2026-10-24, base building's fourth step; the server's side
// server/beds.ts). The owner: "players can place a bed or bedroll in their base when they have a TC down like rust";
// and 2026-10-25, "when the player dies and goes to respawn we should show the map and their spawn locations/options
// like rust does so the player can pick their spawn". Dead, the player is shown the map with each bed of theirs on it
// and whether it is ready (src/ui/spawn-map.ts); the one picked is where Respawn wakes them, with nothing, as at the
// map's edge. How often each may be woken at is src/sim/build/beds.ts.

import type * as THREE from 'three';
import { PIECES } from '../../sim/build/pieces';
import { toWorld, worldYaw } from '../../sim/build/snap';
import { sleepOf, sleptAt } from '../../sim/build/beds';
import type { Bases } from '../../sim/build/bases';
import type { C2S, S2C } from '../../net/protocol';
import { SpawnMap } from '../../ui/spawn-map';

export interface BedHost {
  online: () => boolean;
  send: (m: C2S) => void;
  me: () => THREE.Vector3;
  who: () => string;
  hud: () => HTMLElement;
  /** played alone: woken at a place (the respawn, there) */
  wake: (x: number, y: number, z: number, yaw: number) => void;
}

interface Bed {
  b: number;
  p: number;
  k: string;
  x: number;
  z: number;
  /** when it gives wakes again (performance.now()), and how many it has now */
  ready: number;
  left: number;
}

export class BedsView {
  private list: Bed[] = [];
  private asked = false;
  private redrawT = 0;
  private map: SpawnMap | null = null;
  /** the map's sheet painted into the death screen's map (the game's: BigMap.paintSheet) */
  paint: ConstructorParameters<typeof SpawnMap>[0] = (g, W, H) => {
    g.fillStyle = '#15170f';
    g.fillRect(0, 0, W, H);
  };

  constructor(private h: BedHost, private store: () => Bases) {}

  onBeds(m: Extract<S2C, { t: 'beds' }>) {
    const now = performance.now();
    // (a server from before a bed had wakes says none: taken as one, if it is ready)
    this.list = m.list.map(([b, p, k, x, z, s, left]) => ({ b, p, k, x, z, ready: now + s * 1000, left: left ?? (s > 0 ? 0 : 1) }));
  }

  /** the next ready bed along, or the one before (A and D on the death screen) */
  step(by: 1 | -1) {
    this.map?.step(by);
  }

  /** the bed picked on the death screen's map, if any (null: the map's edge) */
  chosen(): { b: number; p: number } | null {
    const key = this.map?.picked;
    if (!key) return null;
    const [b, p] = key.split(':').map(Number);
    return { b, p };
  }

  /** played alone: where the picked bed wakes them, a wake of it spent (null: the map's edge) */
  wakeAlone(): { x: number; y: number; z: number; yaw: number } | null {
    const c = this.chosen(), base = c && this.store().bases.get(c.b), piece = c && base?.pieces.get(c.p);
    if (!base || !piece || !sleptAt(piece, Date.now())) return null;
    const [x, y, z] = toWorld(base, piece.x, piece.y + (piece.k === 'bed' ? 0.62 : 0.15), piece.z);
    return { x, y, z, yaw: worldYaw(base, piece.r) + Math.PI };
  }

  /** each frame: dead, the beds are asked for once and shown on the map; alive, the map goes */
  frame(dt: number, dead: boolean) {
    if (!dead) {
      if (this.asked) {
        this.asked = false;
        this.list = [];
        this.map?.root.remove();
        if (this.map) this.map.picked = '';
      }
      return;
    }
    if (!this.asked) {
      this.asked = true;
      if (this.h.online()) this.h.send({ t: 'mybeds' });
    }
    if (!this.h.online()) this.list = this.mine();
    if ((this.redrawT -= dt) > 0) return;
    this.redrawT = 0.5;
    this.draw();
  }

  /** played alone: the beds of the game's own bases */
  private mine(): Bed[] {
    const out: Bed[] = [], now = performance.now(), at = Date.now();
    for (const b of this.store().bases.values()) {
      for (const p of b.pieces.values()) {
        if (!PIECES[p.k].sleep || p.by !== this.h.who()) continue;
        const [x, , z] = toWorld(b, p.x, p.y, p.z), s = sleepOf(p, at);
        out.push({ b: b.id, p: p.id, k: p.k, x, z, ready: now + s.wait * 1000, left: s.left });
      }
    }
    return out;
  }

  private draw() {
    const dead = this.h.hud().querySelector('.hud-dead');
    if (!dead) return;
    this.map ??= new SpawnMap((...a) => this.paint(...a));
    if (!this.map.root.isConnected) dead.querySelector('.dead-btn')?.before(this.map.root);
    const me = this.h.me(), now = performance.now();
    this.map.draw(
      this.list.map((q) => {
        const wait = Math.max(0, Math.ceil((q.ready - now) / 1000)), ready = wait === 0 && q.left > 0;
        const state = ready ? (q.left > 1 ? `Ready · ${q.left} left` : 'Ready') : `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}`;
        return { key: `${q.b}:${q.p}`, x: q.x, z: q.z, name: PIECES[q.k].name, ready, state };
      }),
      { x: me.x, z: me.z },
    );
  }
}
