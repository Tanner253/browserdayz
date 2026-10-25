// The trader camp as the game has it (progression v3; the rules are src/sim/camp.ts, the server's side server/camp.ts):
// its stalls drawn where the camp's layer lays them, each counter's trader (src/game/trader.ts), the counter's screen
// (src/ui/shop.ts) asked of here, and the safe zone round the yard. Online every trade is the server's to judge: asked,
// and answered; the day's record (what was bought, what was paid for things sold, the jobs, the infected put down) is
// the server's word. Played alone, the same rules on this game's own pockets, the day kept by the browser.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { CAMP, FACE_TURN, STALL, STALLS, bookScrap, campLayer, dayFor, inSafe, leftToday, maySell, mayBuy, pays, type Camp, type StallId } from '../sim/camp';
import { dayOf, jobsFor, mayHandIn, progress } from '../sim/jobs';
import { madeItems } from '../sim/craft/plan';
import { MAT } from '../sim/craft/materials';
import { ITEMS, itemName, type ItemInstance } from '../sim/items';
import type { C2S, S2C, TradeDay } from '../net/protocol';
import type { World } from '../world/worldgen';
import type { ShopHost } from '../ui/shop';

export interface CampHost {
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  scene: THREE.Scene;
  /** what is carried that may be sold: not in the hands, not worn, no bag with things in it */
  wares: () => ItemInstance[];
  count: (id: string) => number;
  icon: (id: string) => string | undefined;
  /** played alone: so many of a kind taken out of the pockets, a thing by its number, things put in */
  take: (id: string, n: number) => void;
  remove: (item: ItemInstance) => void;
  give: (items: ItemInstance[], gift: string) => void;
  hasRoom: (items: ItemInstance[]) => boolean;
  /** the counter's screen put away */
  closed: () => void;
}

/** where the browser keeps the day played alone, and whether the old book has been paid out */
const KEPT_DAY = 'zona.camp', KEPT_BOOK = 'zona.credit', BOOK_PAID = 'zona.credit.paid';
/** how long an answer from the server is waited for, ms */
const ANSWER = 4000;

export class TraderCamp {
  readonly camp: Camp | null;
  /** the stall whose counter is open */
  stall: StallId = 'building';
  private told: TradeDay | null = null;
  private own: TradeDay | null = null;
  private waiting: ((say: string | null) => void) | null = null;
  /** whether this player was within the safe zone last frame */
  private inside = false;
  /** redraws the counter's screen when the day changes (set by the screen's owner) */
  redraw: () => void = () => {};

  constructor(world: World, private h: CampHost) {
    this.camp = campLayer(world);
    try {
      this.own = JSON.parse(localStorage.getItem(KEPT_DAY) ?? 'null');
    } catch {}
    void this.draw();
  }

  /** the stalls' models where the layer laid them, solid (the shop is a building of the map's own) */
  private async draw() {
    const spots = this.camp?.stalls.filter((s) => s.id !== 'building') ?? [];
    if (!spots.length) return;
    const model = await assets.model(STALL.model).catch(() => null);
    const e = assets.manifest.models[STALL.model];
    if (!model) return;
    for (const s of spots) {
      const m = model.clone();
      m.position.set(s.x, s.y, s.z);
      m.rotation.y = s.rot + FACE_TURN;
      m.scale.setScalar(STALL.scale);
      this.h.scene.add(m);
      // (its back and sides stop a body; its counter is a body's height and stops it too)
      if (e?.min && e.max) {
        const k = STALL.scale, hx = ((e.max[0] - e.min[0]) / 2) * k, hy = ((e.max[1] - e.min[1]) / 2) * k, hz = ((e.max[2] - e.min[2]) / 2) * k * 0.9;
        physics.addStatic(physics.R.ColliderDesc.cuboid(hx * 0.9, Math.min(hy, 0.55), hz), 'wood', { x: s.x, y: s.y + 0.55, z: s.z }, s.rot + FACE_TURN);
      }
    }
  }

  /** the day as whoever judges has it */
  get today(): TradeDay {
    const day = dayOf(Date.now());
    return dayFor(day, this.h.online() ? this.told : this.own);
  }

  /** whether a place is within the camp's safe zone */
  safe(at: THREE.Vector3) {
    return inSafe(this.camp, at.x, at.z);
  }

  /** whether a place is within the safe zone, said once as it is walked into and out of */
  within(at: THREE.Vector3) {
    const now = this.safe(at);
    if (now !== this.inside) {
      this.inside = now;
      this.h.note(now ? 'The trader camp: nobody is hurt here, and guns stay down' : 'You have left the trader camp', 'info');
    }
    return now;
  }

  onDay(m: Extract<S2C, { t: 'tday' }>) {
    this.told = m.day;
    this.redraw();
  }

  onTrade(m: Extract<S2C, { t: 'trade' }>) {
    for (const uid of m.used ?? []) {
      const it = this.h.wares().find((x) => x.uid === uid);
      if (it) this.h.remove(it);
    }
    const w = this.waiting;
    this.waiting = null;
    w?.(m.ok ? m.say : m.say || 'No.');
  }

  /** online: a trade asked of the server, and its answer waited for */
  private ask(m: C2S): Promise<string | null> {
    this.waiting?.('');
    return new Promise((done) => {
      this.waiting = done;
      this.h.send(m);
      setTimeout(() => {
        if (this.waiting !== done) return;
        this.waiting = null;
        done('He does not answer. Try again.');
      }, ANSWER);
    });
  }

  /** played alone: the day changed, and kept */
  private keep(d: TradeDay) {
    this.own = d;
    try {
      localStorage.setItem(KEPT_DAY, JSON.stringify(d));
    } catch {}
  }

  /** an infected put down: counted toward the day's jobs (online the server counts it; this says how far a job has come) */
  killed(head: boolean): string {
    const d = this.today;
    if (!this.h.online()) {
      d.kills++;
      if (head) d.heads++;
      this.keep(d);
    } else {
      // (the server's count comes after: shown one ahead until it does)
      d.kills++;
      if (head) d.heads++;
    }
    const job = jobsFor(d.day).find((j) => (j.kind === 'cull' || (j.kind === 'heads' && head)) && !d.done.includes(j.id));
    if (!job) return '';
    const done = progress(job, d, () => 0);
    return done >= job.n ? ` · the trader's job is done: ${job.pays} ${ITEMS[MAT.scrap].name.toLowerCase()} to collect` : ` · trader's job ${done}/${job.n}`;
  }

  /** whether a job of today's is ready to be handed in (the prompt at a counter says so) */
  owed() {
    const d = this.today;
    return jobsFor(d.day).some((j) => !d.done.includes(j.id) && progress(j, d, (id) => this.h.count(id)) >= j.n);
  }

  /** the old trader's book: what this browser had in it, paid out in scrap once (online by the server, once a player) */
  payBook() {
    let credit = 0;
    try {
      if (localStorage.getItem(BOOK_PAID)) return;
      credit = Math.floor(Number(localStorage.getItem(KEPT_BOOK)) || 0);
    } catch {
      return;
    }
    const n = bookScrap(credit);
    const paid = () => {
      try {
        localStorage.setItem(BOOK_PAID, '1');
        localStorage.removeItem(KEPT_BOOK);
      } catch {}
    };
    if (n <= 0) return paid();
    if (this.h.online()) this.h.send({ t: 'book', n: credit });
    else this.h.give(madeItems(MAT.scrap, n), `${n} ${ITEMS[MAT.scrap].name}`);
    paid();
  }

  // ---- the counter

  buy(id: string): Promise<string | null> | string | null {
    if (this.h.online()) return this.ask({ t: 'trade', s: this.stall, op: 'buy', id });
    const d = this.today, good = mayBuy(this.stall, id, d, this.h.count(MAT.scrap));
    if (typeof good === 'string') return good;
    const items = madeItems(id, good.n);
    if (!this.h.hasRoom(items)) return 'You have nowhere to put it. Sell me something first.';
    this.h.take(MAT.scrap, good.price);
    this.h.give(items, `${good.n > 1 ? `${good.n} ` : ''}${ITEMS[id].name}`);
    d.bought[id] = (d.bought[id] ?? 0) + 1;
    this.keep(d);
    return null;
  }

  sell(item: ItemInstance): Promise<string | null> | string | null {
    if (this.h.online()) return this.ask({ t: 'trade', s: this.stall, op: 'sell', u: item.uid });
    const d = this.today, got = maySell(this.stall, item, d);
    if (typeof got === 'string') return got;
    this.h.remove(item);
    this.h.give(madeItems(MAT.scrap, got), `${got} ${ITEMS[MAT.scrap].name}`);
    d.sold += got;
    this.keep(d);
    return `${got} for the ${itemName(item).toLowerCase()}.`;
  }

  handIn(id: string): Promise<string | null> | string | null {
    if (this.h.online()) return this.ask({ t: 'trade', s: 'building', op: 'job', id });
    const d = this.today, job = mayHandIn(id, d, (x) => this.h.count(x));
    if (typeof job === 'string') return job;
    if (job.kind === 'bring') this.h.take(job.item!, job.n);
    d.done.push(job.id);
    this.keep(d);
    this.h.give(madeItems(MAT.scrap, job.pays), `${job.pays} ${ITEMS[MAT.scrap].name}`);
    return null;
  }

  /** what the counter's screen asks of the camp */
  shopHost(): ShopHost {
    return {
      stall: () => ({ id: this.stall, name: STALLS[this.stall].name, hello: STALLS[this.stall].hello }),
      scrap: () => this.h.count(MAT.scrap),
      wares: () => this.h.wares().map((item) => ({ item, pays: pays(this.stall, item) })).filter((w) => w.pays > 0),
      soldLeft: () => Math.max(0, CAMP.soldADay - this.today.sold),
      stock: () => STALLS[this.stall].sells.map((g) => ({ id: g.id, n: g.n, price: g.price, left: leftToday(g, this.today) })),
      // (the day's work is the shop's: the building stall's trader, who was the trader before the camp)
      jobs: () => {
        if (this.stall !== 'building') return [];
        const d = this.today;
        return jobsFor(d.day).map((j) => ({ id: j.id, text: j.text, n: j.n, pays: j.pays, have: progress(j, d, (x) => this.h.count(x)), paid: d.done.includes(j.id) }));
      },
      icon: (id) => this.h.icon(id),
      buy: (id) => this.buy(id),
      sell: (item) => this.sell(item),
      handIn: (id) => this.handIn(id),
      closed: () => this.h.closed(),
    };
  }
}
