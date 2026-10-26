// Blueprints in the game (2026-10-24, base building's fourth step; the rules src/sim/build/blueprints.ts). The owner:
// "small blueprint pieces that can be used as a build example or staritng spot for a base like a 1x1 with walls and a
// roof and a door". Chosen from the plan's wheel with the foundations, a blueprint's ghost stands whole where the aim
// meets the ground, turned as the player faces; the left button sets it down for nothing, its first piece a frame. Then
// it is a site kept with its base (the owner, 2026-10-25: "you set up the build shadow/blueprint, then bring the resources
// needed to the blueprint, then when they're all there you can build"): its rest a ghost, the next piece lit, and at it F
// puts in what is carried, building as far as it goes; held, F calls it off and gives back what was brought.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Input } from '../../core/input';
import { audio } from '../../core/audio';
import { asksOf, beginSite, fillSite, printCost, printOf, restOf, wantOf } from '../../sim/build/blueprints';
import { angleOf, type Base } from '../../sim/build/snap';
import type { Ask, Bases } from '../../sim/build/bases';
import { ITEMS, makeItem, type ItemInstance } from '../../sim/items';
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
  me: () => THREE.Vector3;
  /** things put into the pockets, played alone (what a blueprint called off had been given) */
  give: (items: ItemInstance[], gift: string) => void;
}


const card = (head: string, line: string, keys: string, kbd?: string) => `<span class="bc">${kbd ? `<kbd>${kbd}</kbd>` : ''}<b>${head}</b>${line ? ` ${line}` : ''}<i>${keys}</i></span>`;

export class PrintView {
  private ghost: THREE.Mesh | null = null;
  private ghostKey = '';
  private ok = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  private bad = new THREE.MeshBasicMaterial({ color: 0xee7a6e, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });

  constructor(private h: PrintHost, private store: () => Bases) {}

  hide() {
    if (this.ghost) this.ghost.visible = false;
  }

  /** the plan in the hands, a blueprint chosen (`id`), the aim meeting the ground at `at` (null: nowhere near) */
  frame(plan: ItemInstance, id: string, at: THREE.Vector3 | null): string {
    const P = printOf(id)!;
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
    return why ? card(P.name, `<span class="no">${why}</span>`, this.h.costHtml(cost)) : card(`Set down the ${P.name.toLowerCase()}`, this.h.costHtml(cost), 'for nothing: then bring it what it needs, a trip at a time', 'LMB');
  }

  private lay(plan: ItemInstance, id: string, at: { b?: number; x: number; z: number; yaw: number }) {
    audio.impact('wood', { x: at.x, y: this.ghost?.position.y ?? 0, z: at.z }, 1);
    if (this.h.online()) return void this.h.send({ t: 'bprint', id, ...at, u: plan.uid });
    // (alone: set down, and filled at once from what is carried, as the server does)
    const b = beginSite(this.store(), id, at, this.h.who(), Date.now(), this.h.name());
    if (typeof b === 'string') return void this.h.note(b, 'warn');
    this.fillAlone(b);
  }

  private fillAlone(b: Base) {
    const name = printOf(b.site!.print)?.name ?? 'Blueprint';
    const r = fillSite(this.store(), b, this.h.who(), Date.now(), this.h.name(), (k) => this.h.count(k), (k, n) => this.h.take(k, n));
    this.h.changed(b);
    const back = Object.entries(r.back);
    if (back.length) this.h.give(back.map(([k, n]) => makeItem(k, n)), back.map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', '));
    const still = Object.entries(wantOf(b)).map(([k, n]) => `${n} ${ITEMS[k]?.name.toLowerCase() ?? k}`).join(', ');
    this.h.note(r.done ? `${name}: built` : `${name}: ${r.laid.length} built${still ? `; it still needs ${still}` : ''}`, r.done ? 'good' : 'info');
  }

  // ---- sites: blueprints set down and being filled

  private sited = new Map<number, { rest: THREE.Mesh; next: THREE.Mesh; key: string }>();
  private fT = -1;
  private fDone = false;
  private nextMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });

  /** every frame: each site near drawn, its rest a ghost and its next piece lit; at one, what F does (the card) */
  sites(dt: number, ok: boolean): string | null {
    const me = this.h.me(), near = this.store().near(me.x, me.z, 60).filter((b) => b.site);
    for (const [id, g] of this.sited) {
      if (near.some((b) => b.id === id)) continue;
      g.rest.removeFromParent();
      g.next.removeFromParent();
      this.sited.delete(id);
    }
    let at: Base | null = null;
    for (const b of near) {
      const rest = restOf(b);
      const key = `${b.site!.print}:${rest.length}`;
      let g = this.sited.get(b.id);
      if (!g || g.key !== key) {
        g?.rest.removeFromParent();
        g?.next.removeFromParent();
        const geo = (list: Ask[]) => mergeGeometries(list.map((a) => ghostGeometry(a.k).clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(a.x, a.y, a.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleOf(a.r)), new THREE.Vector3(1, 1, 1)))), false)!;
        if (!rest.length) continue;
        g = { rest: new THREE.Mesh(geo(rest.slice(1).length ? rest.slice(1) : rest), this.ok), next: new THREE.Mesh(geo(rest.slice(0, 1)), this.nextMat), key };
        for (const m of [g.rest, g.next]) {
          m.renderOrder = 5;
          m.position.set(b.ox, b.oy, b.oz);
          m.rotation.set(0, b.yaw, 0);
          this.h.scene.add(m);
        }
        g.rest.visible = rest.length > 1;
        this.sited.set(b.id, g);
      }
      if (!at && Math.hypot(b.ox - me.x, b.oz - me.z) < 9) at = b;
    }
    if (!at || !ok) {
      this.fT = -1;
      return null;
    }
    const input = this.h.input, P = printOf(at.site!.print), want = wantOf(at);
    if (input.pressed('KeyF')) {
      this.fT = 0;
      this.fDone = false;
    }
    if (this.fT >= 0) {
      if (input.held('KeyF')) {
        this.fT += dt;
        if (this.fT >= 0.8 && !this.fDone) {
          this.fDone = true;
          this.cancel(at);
        }
      } else {
        if (!this.fDone) this.fill(at);
        this.fT = -1;
      }
    }
    const holding = this.fT > 0.15 && !this.fDone;
    return card(`Blueprint: ${P?.name ?? ''}`, Object.keys(want).length ? `needs ${this.h.costHtml(want)}` : 'has all it needs', holding ? 'calling it off…' : 'F puts in what you carry · hold F to call it off', 'F');
  }

  private fill(b: Base) {
    audio.ui('pickup');
    if (this.h.online()) return void this.h.send({ t: 'bfill', b: b.id });
    this.fillAlone(b);
  }

  private cancel(b: Base) {
    if (this.h.online()) return void this.h.send({ t: 'bfill', b: b.id, cancel: 1 });
    const back = Object.entries(b.site?.have ?? {});
    b.site = undefined;
    this.h.changed(b);
    if (back.length) this.h.give(back.map(([k, n]) => makeItem(k, n)), back.map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', '));
    this.h.note('The blueprint is called off: what was brought to it is back', 'info');
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


