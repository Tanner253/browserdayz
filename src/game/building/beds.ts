// Beds and sleeping bags on the death screen (2026-10-24, base building's fourth step; the server's side
// server/beds.ts). The owner: "players can place a bed or bedroll in their base when they have a TC down like rust".
// Dead, the player is shown each bed of theirs under Respawn, how far it is and how soon it may be woken at; a click
// wakes them there, with nothing, as at the map's edge.

import type * as THREE from 'three';
import { PIECES } from '../../sim/build/pieces';
import { toWorld, worldYaw } from '../../sim/build/snap';
import type { Bases } from '../../sim/build/bases';
import type { C2S, S2C } from '../../net/protocol';

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
  /** when it may be woken at (performance.now()) */
  ready: number;
}

export class BedsView {
  private list: Bed[] = [];
  private asked = false;
  private shown = '';
  private redrawT = 0;
  /** played alone: when each bed was last woken at */
  private woke = new Map<string, number>();

  constructor(private h: BedHost, private store: () => Bases) {}

  onBeds(m: Extract<S2C, { t: 'beds' }>) {
    const now = performance.now();
    this.list = m.list.map(([b, p, k, x, z, s]) => ({ b, p, k, x, z, ready: now + s * 1000 }));
    this.shown = '';
  }

  /** each frame: dead, the beds are asked for once and listed under Respawn; alive, the list is cleared */
  frame(dt: number, dead: boolean) {
    if (!dead) {
      if (this.asked) {
        this.asked = false;
        this.list = [];
        this.draw();
      }
      return;
    }
    if (!this.asked) {
      this.asked = true;
      if (this.h.online()) this.h.send({ t: 'mybeds' });
      else this.list = this.mine();
    }
    if ((this.redrawT -= dt) > 0) return;
    this.redrawT = 0.5;
    this.draw();
  }

  /** played alone: the beds of the game's own bases */
  private mine(): Bed[] {
    const out: Bed[] = [];
    for (const b of this.store().bases.values()) {
      for (const p of b.pieces.values()) {
        const s = PIECES[p.k].sleep;
        if (!s || p.by !== this.h.who()) continue;
        const [x, , z] = toWorld(b, p.x, p.y, p.z);
        out.push({ b: b.id, p: p.id, k: p.k, x, z, ready: (this.woke.get(`${b.id}:${p.id}`) ?? -Infinity) + s * 1000 });
      }
    }
    return out;
  }

  private draw() {
    const dead = this.h.hud().querySelector('.hud-dead');
    if (!dead) return;
    let el = dead.querySelector('.dead-beds') as HTMLDivElement | null;
    if (!el) {
      el = document.createElement('div');
      el.className = 'dead-beds';
      dead.querySelector('.dead-btn')?.after(el);
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (b && !b.disabled) this.pick(Number(b.dataset.b), Number(b.dataset.p));
      });
    }
    const me = this.h.me(), now = performance.now();
    const html = this.list.map((q) => {
      const wait = Math.ceil((q.ready - now) / 1000), far = Math.round(Math.hypot(q.x - me.x, q.z - me.z));
      const when = wait > 0 ? `in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}` : 'ready';
      return `<button class="dead-bed" data-b="${q.b}" data-p="${q.p}"${wait > 0 ? ' disabled' : ''}>Wake at your ${PIECES[q.k].name.toLowerCase()} <small>${far >= 1000 ? `${(far / 1000).toFixed(1)} km` : `${far} m`} · ${when}</small></button>`;
    }).join('');
    if (html === this.shown) return;
    this.shown = html;
    el.innerHTML = html;
  }

  private pick(b: number, p: number) {
    if (this.h.online()) return void this.h.send({ t: 'respawn', bed: { b, p } });
    const base = this.store().bases.get(b), piece = base?.pieces.get(p);
    if (!base || !piece) return;
    this.woke.set(`${b}:${p}`, performance.now());
    const [x, y, z] = toWorld(base, piece.x, piece.y + (piece.k === 'bed' ? 0.62 : 0.15), piece.z);
    this.h.wake(x, y, z, worldYaw(base, piece.r) + Math.PI);
  }
}
