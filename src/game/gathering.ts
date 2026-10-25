// Gathering as the game has it (2026-10-24, base building's first step; the rules are src/sim/gather.ts, the server's
// side server/gather.ts). A swing of an axe that lands on a trunk, or of a pickaxe on a boulder, is told to the server,
// which fells the tree, gives the stone and wears the tool; a saw on a log lying on the ground saws it into planks.
// Played alone, this game's own `Woods` says the same. How far through a tree or a rock the work is shows in the ring
// round the crosshair a moment after each blow.

import * as THREE from 'three';
import { CHOPS, MINES, SAW, SAWS, TREE, TREE_KINDS, Woods, condition, rockOf, rockReach, treeOf, treeReach, worn } from '../sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../sim/items';
import type { WorldLoot } from '../sim/economy';
import type { C2S, S2C } from '../net/protocol';
import { Felling, RockRef, TreeRef } from '../world/felling';
import type { World } from '../world/worldgen';
import { audio } from '../core/audio';

export interface GatherHost {
  scene: THREE.Scene;
  forest: ConstructorParameters<typeof Felling>[1];
  world: World;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  /** what is in the hands */
  held: () => ItemInstance | null;
  /** where the player stands, and the eye */
  me: () => THREE.Vector3;
  eye: () => THREE.Vector3;
  /** a thing carried, by its uid */
  find: (uid: string) => ItemInstance | null;
  /** played alone: things put into the pockets (what finds no room at the feet), with what to say of them */
  give: (items: ItemInstance[], gift: string) => void;
  /** played alone: a thing laid on the ground */
  lay: (item: ItemInstance, at: THREE.Vector3, rot: number) => void;
  /** played alone: a thing on the ground taken away (the log that was sawn) */
  takeUp: (uid: string) => boolean;
  /** the pockets have changed (a tool worn): the server is told, and the screens drawn again */
  changed: () => void;
  /** the hands at a thing for `dur` seconds (TimedAction): done unless `valid` stops being true */
  begin: (label: string, dur: number, valid: () => boolean, done: () => void, lost: string) => void;
  /** the hands put off what they were at */
  breakOff: () => void;
}

/** seconds the ring shows how far through a tree or a rock the work is, after a blow */
const SHOWN = 1.8;

export class Gathering {
  readonly felling: Felling;
  /** played alone: this game's own trees and rocks */
  private woods: Woods;
  private blowAt = 0;
  /** the tree (k 0) or rock (k 1) last worked, how far through it, and when (performance.now) */
  private work: { k: 0 | 1; i: number; done: number; at: number } | null = null;

  constructor(private h: GatherHost) {
    this.felling = new Felling(h.scene, h.forest, h.world.trees);
    this.felling.onSound = (at, land) => audio.timber(at, land);
    this.woods = new Woods(h.world.trees, h.world.rocks);
  }

  /** a swing that landed on the world (Weapons.onWhack): a tree or a rock, with something that works it */
  whack(owner: unknown, weapon: string) {
    const it = this.h.held();
    if (!it || it.id !== weapon) return;
    if (owner instanceof TreeRef) {
      if (!CHOPS[weapon]) return;
      if (this.ruined(it)) return;
      if (this.h.online()) return void this.h.send({ t: 'chop', i: owner.i, u: it.uid });
      this.chopAlone(owner.i, it);
    } else if (owner instanceof RockRef) {
      if (!MINES[weapon]) return void (CHOPS[weapon] && this.h.note('An axe is no use on stone: a pickaxe breaks it', 'info'));
      if (this.ruined(it)) return;
      if (this.h.online()) return void this.h.send({ t: 'mine', i: owner.i, u: it.uid });
      this.mineAlone(owner.i, it);
    }
  }

  private ruined(it: ItemInstance) {
    if (!condition(it.cond).ruined) return false;
    this.h.note(`Your ${ITEMS[it.id].name.toLowerCase()} is ruined: it is no use for work`, 'warn');
    return true;
  }

  // ---- what the server says

  onFell(m: Extract<S2C, { t: 'fell' }>) {
    this.felling.fell(m.i, m.a, this.h.eye());
    if (this.work?.k === 0 && this.work.i === m.i) this.work = null;
  }
  onGrow(m: Extract<S2C, { t: 'grow' }>) {
    for (const i of m.i) this.felling.grow(i);
  }
  onWork(m: Extract<S2C, { t: 'work' }>) {
    this.work = m.done >= 1 && m.k === 0 ? null : { k: m.k, i: m.i, done: m.done, at: performance.now() };
  }
  onWear(m: Extract<S2C, { t: 'wear' }>) {
    const it = this.h.find(m.u);
    if (!it) return;
    it.cond = m.c;
    this.h.changed();
  }
  /** the trees that are down as this game comes in (the welcome), the forest made whole first */
  welcome(felled: number[] | undefined) {
    this.felling.reset();
    this.felling.down(felled ?? []);
  }

  // ---- sawing

  /** a saw in the hands, fit to work: a log lying here can be sawn */
  canSaw() {
    const it = this.h.held();
    return !!it && !!SAWS[it.id] && !condition(it.cond).ruined;
  }

  /** the log `l` sawn into planks: the hands at it SAW.time, the server asked first and told when it is done */
  saw(l: WorldLoot) {
    const it = this.h.held();
    if (!it || !SAWS[it.id]) return;
    const near = () => this.h.held()?.uid === it.uid && Math.hypot(l.x - this.h.me().x, l.z - this.h.me().z) < SAW.reach;
    if (this.h.online()) this.h.send({ t: 'saw', l: l.uid, u: it.uid, go: 1 });
    this.h.begin('Sawing the log into planks', SAW.time, near, () => {
      if (!near()) return;
      if (this.h.online()) return void this.h.send({ t: 'saw', l: l.uid, u: it.uid, go: 2 });
      if (!this.h.takeUp(l.uid)) return;
      this.wearAlone(it);
      this.h.give([makeItem('planks', SAW.planks)], `${SAW.planks} Planks`);
    }, 'You stopped sawing: the log is where you left it');
  }

  onSaw(m: Extract<S2C, { t: 'saw' }>) {
    if (m.ok) return;
    this.h.breakOff();
    if (m.why) this.h.note(m.why, 'warn');
  }

  // ---- the ring

  /** what the ring round the crosshair says, a moment after a blow: how far through the tree or the rock the work is */
  shown(): { label: string; t: number } | null {
    const w = this.work;
    if (!w || performance.now() - w.at > SHOWN * 1000) return null;
    if (w.k === 1) return { label: w.done >= 1 ? 'Nothing more breaks off this rock' : 'Breaking stone', t: w.done };
    return { label: `Felling the ${treeName(this.h.world.trees[w.i]?.kind ?? '')}`, t: w.done };
  }

  private regrowT = 0;
  update(dt: number) {
    this.felling.update(dt);
    // (played alone, the felled trees whose time is up stand again: the server does it otherwise)
    if (!this.h.online() && (this.regrowT += dt) > 30) {
      this.regrowT = 0;
      this.regrow();
    }
  }

  // ---- played alone: the same rules, by this game's own woods

  private inTime(it: ItemInstance) {
    const now = performance.now(), gap = (ITEMS[it.id].melee?.rate ?? 0.75) * 750;
    if (now - this.blowAt < gap) return false;
    this.blowAt = now;
    return true;
  }

  private wearAlone(it: ItemInstance) {
    it.cond = worn(it.id, it.cond);
    if (it.cond <= 0) this.h.note(`Your ${ITEMS[it.id].name.toLowerCase()} is ruined`, 'warn');
    this.h.changed();
  }

  private chopAlone(i: number, it: ItemInstance) {
    const t = this.h.world.trees[i], me = this.h.me();
    if (!t || !treeOf(t) || Math.hypot(t.x - me.x, t.z - me.z) > treeReach(t) || !this.inTime(it)) return;
    const r = this.woods.chop(i, CHOPS[it.id], Date.now());
    if (!r) return;
    this.wearAlone(it);
    this.onWork({ t: 'work', k: 0, i, done: r.fell ? 1 : 1 - r.left / treeOf(t)!.blows });
    if (!r.fell) return;
    const a = Math.atan2(t.x - me.x, t.z - me.z);
    this.onFell({ t: 'fell', i, a, by: 0 });
    setTimeout(() => {
      for (let n = 0; n < r.logs; n++) {
        const d = 2.2 + n * 2.1 * t.scale;
        this.h.lay(makeItem('log', 1), new THREE.Vector3(t.x + Math.sin(a) * d, t.y + 2, t.z + Math.cos(a) * d), a);
      }
    }, TREE.lands);
  }

  private mineAlone(i: number, it: ItemInstance) {
    const r = this.h.world.rocks[i], me = this.h.me();
    if (!r || !rockOf(r) || Math.hypot(r.x - me.x, r.z - me.z) > rockReach(r) || !this.inTime(it)) return;
    const got = this.woods.mine(i, MINES[it.id], Date.now());
    if (!got) return;
    if (!got.give) return void this.h.note('Nothing more breaks off this rock: come back to it later', 'info');
    this.wearAlone(it);
    this.onWork({ t: 'work', k: 1, i, done: got.done });
    this.h.give([makeItem('stone', got.give)], `${got.give} Stone`);
  }

  /** played alone, every so often: trees whose time is up stand again, out of sight */
  regrow(now = Date.now()) {
    const me = this.h.me();
    for (const i of this.woods.regrow(now, (x, z, within) => Math.hypot(me.x - x, me.z - z) < within)) this.felling.grow(i);
  }
}

/** a tree's kind, said plainly (the ring's words) */
export const treeName = (kind: string) => (TREE_KINDS[kind] ? kind.split('_')[0] : 'tree');
