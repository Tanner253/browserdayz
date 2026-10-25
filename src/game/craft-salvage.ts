// Salvage as the game has it (2026-10-25, plan-crafting; the rules are src/sim/craft/salvage.ts, the server's side
// server/salvage.ts). A swing of a hammer, a pickaxe or a sledgehammer that lands on a wreck, a drum or a heap of junk
// is told to the server, which gives the scrap and wears the tool; how far through the thing the work is shows in the
// ring round the crosshair a moment after each blow, as at a tree. Played alone, this game's own scrapyard says the same.

import * as THREE from 'three';
import { SALVAGE, Scrapyard, spotAt, type SalvageSpot } from '../sim/craft/salvage';
import { condition, worn } from '../sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../sim/items';
import type { C2S, S2C } from '../net/protocol';

export interface SalvageHost {
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  /** what is in the hands */
  held: () => ItemInstance | null;
  me: () => THREE.Vector3;
  /** played alone: things put into the pockets, with what to say of them; the pockets changed */
  give: (items: ItemInstance[], gift: string) => void;
  changed: () => void;
}

/** seconds the ring shows how far through a spot the work is, after a blow */
const SHOWN = 1.8;

export class Salvage {
  /** played alone: this game's own spots' scrap */
  private yard: Scrapyard;
  private blowAt = 0;
  private rustT = 0;
  private work: { i: number; done: number; at: number } | null = null;

  constructor(private h: SalvageHost, readonly spots: SalvageSpot[]) {
    this.yard = new Scrapyard(spots);
  }

  /** a swing that landed at a point (Weapons.onWhack), with something that knocks scrap off */
  whack(at: THREE.Vector3, weapon: string) {
    const it = this.h.held();
    if (!it || it.id !== weapon || !SALVAGE.tools[weapon]) return;
    const i = spotAt(this.spots, at.x, at.y, at.z);
    if (i < 0) return;
    if (condition(it.cond).ruined) return void this.h.note(`Your ${ITEMS[it.id].name.toLowerCase()} is ruined: it is no use for work`, 'warn');
    if (this.h.online()) return void this.h.send({ t: 'salvage', i, u: it.uid });
    // (played alone: the same rules, by this game's own yard)
    const now = performance.now();
    if (now - this.blowAt < (ITEMS[it.id].melee?.rate ?? 0.75) * 750) return;
    this.blowAt = now;
    const r = this.yard.blow(i, SALVAGE.tools[it.id], Date.now());
    if (!r) return;
    if (!r.give) return void this.h.note(`Nothing more comes off this ${this.spots[i].name}: come back to it later`, 'info');
    it.cond = worn(it.id, it.cond);
    if (it.cond <= 0) this.h.note(`Your ${ITEMS[it.id].name.toLowerCase()} is ruined`, 'warn');
    this.h.changed();
    this.onSalvage({ t: 'salvage', i, done: r.done });
    this.h.give([makeItem('scrap', r.give)], `${r.give} Scrap Metal`);
  }

  onSalvage(m: Extract<S2C, { t: 'salvage' }>) {
    this.work = { i: m.i, done: m.done, at: performance.now() };
  }

  /** what the ring round the crosshair says, a moment after a blow */
  shown(): { label: string; t: number } | null {
    const w = this.work;
    if (!w || performance.now() - w.at > SHOWN * 1000) return null;
    const s = this.spots[w.i];
    return { label: w.done >= 1 ? `Nothing more comes off this ${s.name}` : `Knocking scrap off the ${s.name}`, t: w.done };
  }

  /** played alone, every half minute: the spots whose time is up have their scrap again */
  update(dt: number) {
    if (this.h.online() || (this.rustT += dt) < 30) return;
    this.rustT = 0;
    const me = this.h.me();
    this.yard.rust(Date.now(), (x, z, within) => Math.hypot(me.x - x, me.z - z) < within);
  }
}
