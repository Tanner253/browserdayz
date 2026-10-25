// Crafting as the game has it (2026-10-24, plan-crafting; the rules are src/sim/craft/, the server's side
// server/craft.ts). A hand craft is DayZ's: the hands at it for its time, standing still (the ring we have), the server
// asked first and told when it is done; it says what was used up and gives what was made. Played alone, the same rule
// on this game's own pockets.

import * as THREE from 'three';
import { RECIPE, STILL, type Recipe } from '../sim/craft/recipes';
import { plan, recipeName, recipesFor, type Pockets } from '../sim/craft/plan';
import { worn } from '../sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../sim/items';
import type { C2S, S2C } from '../net/protocol';

export interface CraftHost {
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  /** what is carried, as the rule reads it */
  pockets: () => Pockets;
  /** a thing carried, by its uid */
  find: (uid: string) => ItemInstance | null;
  me: () => THREE.Vector3;
  /** the hands at a thing for `dur` seconds (TimedAction): done unless `valid` stops being true */
  begin: (label: string, dur: number, valid: () => boolean, done: () => void, lost: string) => void;
  busy: () => boolean;
  breakOff: () => void;
  /** a thing used up by its number (a jacket cut into rags) */
  remove: (uid: string) => void;
  /** played alone: so many of a kind taken out of the pockets */
  take: (id: string, n: number) => void;
  /** played alone: things put into the pockets (what finds no room at the feet), with what to say of them */
  give: (items: ItemInstance[], gift: string) => void;
  /** the pockets have changed: the server is told, and the screens drawn again */
  changed: () => void;
}

export class Crafting {
  /** what the hands were last set to make (the Crafting tab's strip shows the hold while it is this) */
  label = '';
  constructor(private h: CraftHost) {}

  /** the hand recipes two carried things dragged onto each other go into */
  recipesFor(a: ItemInstance, b: ItemInstance): Recipe[] {
    const p = this.h.pockets();
    if (!p.free.some((it) => it.uid === a.uid) || !p.all.some((it) => it.uid === b.uid)) return [];
    return recipesFor(a, b);
  }

  /** `n` of recipe `rid` made by hand, the things in `u` used first: the hands at it, standing still */
  craft(rid: string, n = 1, u: string[] = []): boolean {
    const r = RECIPE[rid];
    if (!r) return false;
    if (r.at !== 'hand') return void this.h.note(r.at === 'bench' ? 'That is made at a workbench' : 'That is smelted at a forge', 'info'), false;
    if (this.h.busy()) return void this.h.note('Your hands are busy', 'info'), false;
    const q = plan(r, n, this.h.pockets(), u);
    if (typeof q === 'string') return void this.h.note(q, 'warn'), false;
    const from = this.h.me().clone();
    const still = () => Math.hypot(this.h.me().x - from.x, this.h.me().z - from.z) < STILL;
    if (this.h.online()) this.h.send({ t: 'craft', r: r.id, n: q.n, go: 1, u });
    const label = (this.label = r.id === 'rags' ? 'Cutting clothes into rags' : `Making ${q.n > 1 ? `${q.n} × ` : ''}${recipeName(r)}`);
    this.h.begin(label, q.time, still, () => {
      if (!still()) return;
      if (this.h.online()) return void this.h.send({ t: 'craft', r: r.id, n: q.n, go: 2, u });
      this.alone(r, q.n, u);
    }, 'You stopped: nothing was used up');
    return true;
  }

  onCraft(m: Extract<S2C, { t: 'craft' }>) {
    if (!m.ok) {
      this.h.breakOff();
      if (m.why) this.h.note(m.why, 'warn');
      return;
    }
    if (!m.done) return;
    for (const uid of m.used ?? []) this.h.remove(uid);
    this.h.changed();
  }

  /** played alone: the same rule, on this game's own pockets */
  private alone(r: Recipe, n: number, u: string[]) {
    const q = plan(r, n, this.h.pockets(), u);
    if (typeof q === 'string') return void this.h.note(q, 'warn');
    for (const [id, k] of Object.entries(q.pay)) this.h.take(id, k);
    for (const uid of q.uids) this.h.remove(uid);
    for (const uid of q.wear) {
      const it = this.h.find(uid);
      if (!it) continue;
      it.cond = worn(it.id, it.cond);
      if (it.cond <= 0) this.h.note(`Your ${ITEMS[it.id].name.toLowerCase()} is ruined`, 'warn');
    }
    this.h.changed();
    if (q.makes <= 0) return;
    const max = ITEMS[r.makes].stack ?? 1, items: ItemInstance[] = [];
    for (let left = q.makes; left > 0; left -= max) items.push(makeItem(r.makes, Math.min(max, left)));
    this.h.give(items, `${q.makes} ${ITEMS[r.makes].name}`);
  }
}
