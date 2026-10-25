// Blueprints in the game (2026-10-24, base building's fourth step; the rules src/sim/build/blueprints.ts). The owner:
// "small blueprint pieces that can be used as a build example or staritng spot for a base like a 1x1 with walls and a
// roof and a door". Chosen from the plan's wheel with the foundations, a blueprint's ghost stands whole where the aim
// meets the ground, turned as the player faces; the left button lays it, as far as what is carried pays. A base where
// one was laid and not finished (for half an hour after) shows the rest as its ghost, and the left button lays more.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Input } from '../../core/input';
import { audio } from '../../core/audio';
import { asksOf, layPrint, printCost, printOf } from '../../sim/build/blueprints';
import { costOf, laidAt } from '../../sim/build/pieces';
import { angleOf, type Base } from '../../sim/build/snap';
import type { Ask, Bases } from '../../sim/build/bases';
import type { ItemInstance } from '../../sim/items';
import type { C2S } from '../../net/protocol';
import { ghostGeometry } from './look';

export interface PrintHost {
  scene: THREE.Scene;
  input: Input;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  yaw: () => number;
  who: () => string;
  name: () => string;
  count: (id: string) => number;
  take: (id: string, n: number) => void;
  /** a base laid or added to, played alone (drawn, its stores and spots made again) */
  changed: (b: Base) => void;
  /** a cost said against what is carried */
  costHtml: (cost: Record<string, number>) => string;
}

/** how long a blueprint laid short is kept as a ghost on its base, ms (plan v2: "keeps the rest as a ghost for 30 min") */
const KEPT = 30 * 60_000;

const card = (head: string, line: string, keys: string, kbd?: string) => `<span class="bc">${kbd ? `<kbd>${kbd}</kbd>` : ''}<b>${head}</b>${line ? ` ${line}` : ''}<i>${keys}</i></span>`;

export class PrintView {
  private ghost: THREE.Mesh | null = null;
  private ghostKey = '';
  private ok = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  private bad = new THREE.MeshBasicMaterial({ color: 0xee7a6e, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  /** bases a blueprint was laid on short, and till when its rest is shown; online, by where it was begun until its base is told */
  private short = new Map<number, { id: string; until: number }>();
  private begun: { id: string; x: number; z: number; until: number } | null = null;

  constructor(private h: PrintHost, private store: () => Bases) {}

  hide() {
    if (this.ghost) this.ghost.visible = false;
  }

  /** the plan in the hands, a blueprint chosen (`id`), the aim meeting the ground at `at` (null: nowhere near) */
  frame(plan: ItemInstance, id: string, at: THREE.Vector3 | null): string {
    const P = printOf(id)!, now = performance.now();
    this.adopt(now);
    // (a base of the player's own with this blueprint's rest still to lay, near the aim)
    const on = at ? this.store().near(at.x, at.z, 12).find((b) => this.short.get(b.id)?.id === id && this.short.get(b.id)!.until > now) : undefined;
    if (on) {
      const rest = asksOf(id).filter((a) => ![...on.pieces.values()].some((p) => p.k === a.k && Math.abs(p.x - a.x) < 0.05 && Math.abs(p.y - a.y) < 0.05 && Math.abs(p.z - a.z) < 0.05));
      if (!rest.length) {
        this.short.delete(on.id);
        this.hide();
        return card(P.name, 'is laid whole', 'hammer it up a piece at a time');
      }
      this.show(`${id}:${rest.length}`, rest, on.ox, on.oy, on.oz, on.yaw, true);
      const cost = sum(rest);
      if (this.h.input.pressed('Mouse0')) this.lay(plan, id, { b: on.id, x: on.ox, z: on.oz, yaw: on.yaw });
      return card(`Lay the rest of the ${P.name.toLowerCase()}`, this.h.costHtml(cost), `${rest.length} pieces to come`, 'LMB');
    }
    if (!at) {
      this.hide();
      return card(P.name, 'aim at open ground', 'hold the right button for the pieces');
    }
    const yaw = this.h.yaw() + Math.PI, first = asksOf(id)[0];
    const c = this.store().check({ k: first.k, x: at.x, y: 0, z: at.z, r: 0, yaw }, this.h.who());
    const why = typeof c === 'string' ? c : null;
    this.show(id, asksOf(id), at.x, typeof c === 'string' ? at.y : c.base.oy, at.z, yaw, !why);
    const cost = printCost(id);
    if (this.h.input.pressed('Mouse0')) {
      if (why) {
        this.h.note(why, 'warn');
        audio.click(420, 0.12, 0.02);
      } else this.lay(plan, id, { x: at.x, z: at.z, yaw });
    }
    return why ? card(P.name, `<span class="no">${why}</span>`, this.h.costHtml(cost)) : card(`Lay the ${P.name.toLowerCase()}`, this.h.costHtml(cost), `${asksOf(id).length} frames at once · what you carry lays what it can`, 'LMB');
  }

  private lay(plan: ItemInstance, id: string, at: { b?: number; x: number; z: number; yaw: number }) {
    audio.impact('wood', { x: at.x, y: this.ghost?.position.y ?? 0, z: at.z }, 1);
    if (this.h.online()) {
      this.h.send({ t: 'bprint', id, ...at, u: plan.uid });
      if (at.b !== undefined) this.short.set(at.b, { id, until: performance.now() + KEPT });
      else this.begun = { id, x: at.x, z: at.z, until: performance.now() + KEPT };
      return;
    }
    // (alone: paid for out of the pockets, a piece at a time)
    const r = layPrint(this.store(), id, at, this.h.who(), Date.now(), this.h.name(), (cost) => {
      if (Object.entries(cost).some(([k, n]) => this.h.count(k) < n)) return false;
      for (const [k, n] of Object.entries(cost)) this.h.take(k, n);
      return true;
    });
    if (!r.base || !r.laid.length) return void this.h.note(r.need ? this.needs(r.need) : (r.why ?? 'Nothing more of it to lay'), 'warn');
    this.h.changed(r.base);
    const left = asksOf(id).length - r.base.pieces.size;
    if (left > 0) this.short.set(r.base.id, { id, until: performance.now() + KEPT });
    this.h.note(`${printOf(id)!.name}: ${r.laid.length} laid${left > 0 ? `; ${r.need ? this.needs(r.need).toLowerCase() : (r.why ?? '').toLowerCase()}` : ''}`, left > 0 ? 'info' : 'good');
  }

  /** what the next piece wants that is not carried */
  private needs(cost: Record<string, number>) {
    const short = Object.entries(cost).filter(([k, n]) => this.h.count(k) < n).map(([k, n]) => `${n - this.h.count(k)} more ${k === 'log' ? 'logs' : k.replace('_', ' ')}`);
    return short.length ? `The next piece needs ${short.join(' and ')}` : 'Short of materials for the rest';
  }

  /** online: the base a blueprint was begun on, once the server has told it, kept by its number */
  private adopt(now: number) {
    const g = this.begun;
    if (!g) return;
    if (now > g.until) return void (this.begun = null);
    const b = [...this.store().bases.values()].find((q) => Math.hypot(q.ox - g.x, q.oz - g.z) < 0.5);
    if (!b) return;
    this.begun = null;
    if (b.pieces.size < asksOf(g.id).length) this.short.set(b.id, { id: g.id, until: g.until });
  }

  /** the ghost: these pieces, in a base's frame at (x, y, z) turned `yaw` */
  private show(key: string, asks: Ask[], x: number, y: number, z: number, yaw: number, good: boolean) {
    if (!this.ghost || this.ghostKey !== key) {
      this.ghost?.removeFromParent();
      this.ghost = new THREE.Mesh(mergeGeometries(asks.map((a) => ghostGeometry(a.k).clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(a.x, a.y, a.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleOf(a.r)), new THREE.Vector3(1, 1, 1)))), false)!, this.ok);
      this.ghost.renderOrder = 5;
      this.ghostKey = key;
      this.h.scene.add(this.ghost);
    }
    this.ghost.material = good ? this.ok : this.bad;
    this.ghost.visible = true;
    this.ghost.position.set(x, y, z);
    this.ghost.rotation.set(0, yaw, 0);
  }
}

const sum = (asks: Ask[]) => {
  const out: Record<string, number> = {};
  for (const a of asks) for (const [k, n] of Object.entries(costOf(a.k, laidAt(a.k)))) out[k] = (out[k] ?? 0) + n;
  return out;
};

