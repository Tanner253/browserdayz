// A base's claim as the game has it (2026-10-24, base building's third step; the server's side server/claims.ts). Its
// store is a box opened with F and filled as a crate is (only with what a base is kept with); F held a moment joins the
// claim, or leaves it (Rust's: whoever reaches it may). Inside a claim's reach a chip at the top says whose it is and
// how long its store keeps it; run dry, it says so in red. Played alone, this game's own claims pay their upkeep from
// their stores and the bases rot as the server would have them.

import { ITEMS } from '../../sim/items';
import * as THREE from 'three';
import { Stash } from '../loot';
import { toWorld, type Base } from '../../sim/build/snap';
import { STORE, perDay, pay, pays, protectedFor, rot, saidTime, toward } from '../../sim/build/upkeep';
import type { Bases } from '../../sim/build/bases';
import type { S2C, C2S, StoredItem } from '../../net/protocol';
import type { Input } from '../../core/input';

export interface ClaimHost {
  input: Input;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  me: () => THREE.Vector3;
  /** who this player is to a base (their public id online, 'me' alone), and their name */
  who: () => string;
  name: () => string;
  /** a store opened in the inventory */
  open: (s: Stash) => void;
  /** the store open in the inventory now, if any, and the pictures of things */
  shown: () => Stash | null;
  icons: () => Record<string, string>;
  hud: () => HTMLElement;
  /** pieces lost to rot, played alone: drawn away */
  broke: (b: Base, ids: number[]) => void;
  changed: (b: Base) => void;
}

/** what the store holds (the server's word for it), and how long it keeps its base */
interface Kept {
  s: number;
  dry: boolean;
  day: [string, number][];
  /** when it was heard (performance.now): the time left counts down from it */
  at?: number;
}

/** the claim's screen, beside its store (the owner, 2026-10-25: "when I open my claim the ui is terrible, I have no idea
 * what resources I need, how much I need and what the upkeep cost of my base is or how long till my base starts to
 * decay, think like rust"): Rust's tool cupboard */
const PANEL_CSS = `
.cl-panel{position:fixed;left:16px;top:50%;transform:translateY(-50%);z-index:900;width:min(340px,calc(100vw - 32px));background:rgba(14,17,16,.96);color:#e8e6df;border:1px solid #2c332f;border-radius:6px;padding:16px;font:14px/1.4 inherit;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.cl-panel h4{margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a9b0ab}
.cl-left{font-size:24px;font-weight:700;margin:0 0 8px}
.cl-left.dry{color:#ff5a4a}.cl-left.low{color:#f0b44a}
.cl-panel p{margin:0 0 12px;color:#bfc4c0;font-size:13px}
.cl-row{display:grid;grid-template-columns:36px 1fr auto;gap:8px;align-items:center;padding:5px 0;border-top:1px solid #222826}
.cl-row i{width:36px;height:36px;background:#0b0c0c center/contain no-repeat;border-radius:3px}
.cl-row b{font-size:15px}.cl-row span{font-size:13px;color:#bfc4c0;text-align:right}
.cl-row span.short{color:#ff7a6a}
.cl-who{margin-top:12px;font-size:13px;color:#bfc4c0}
@media (max-width:700px){.cl-panel{top:16px;transform:none}}
`;

/** F held this long joins the claim or leaves it; let go before, it opens the store */
const HOLD = 0.8;

export class ClaimView {
  private stores = new Map<number, Stash>();
  private kept = new Map<number, Kept>();
  private chip: HTMLDivElement | null = null;
  private chipText = '';
  private fT = -1;
  private fDone = false;
  private aloneT = 0;

  constructor(private h: ClaimHost, private store: () => Bases) {}

  /** a base's store as its claim is now: made, moved or taken away */
  sync(b: Base) {
    const p = b.claim && b.pieces.get(b.claim.p), had = this.stores.get(b.id);
    if (!p) {
      if (had) this.stores.delete(b.id);
      return;
    }
    const [x, y, z] = toWorld(b, p.x, p.y, p.z);
    if (had && Math.hypot(had.x - x, had.z - z) < 0.05) return;
    const s = new Stash(`claim:${b.id}`, x, y + 0.4, z, 0, STORE.w, STORE.h, 'Claim');
    if (had) s.container.load({ items: had.container.serialize().items });
    this.stores.set(b.id, s);
  }
  forget(b: number) {
    this.stores.delete(b);
    this.kept.delete(b);
  }
  clear() {
    this.stores.clear();
    this.kept.clear();
  }
  all(): Stash[] {
    return [...this.stores.values()];
  }
  byCid(cid: string): Stash | undefined {
    return cid.startsWith('claim:') ? this.stores.get(Number(cid.slice(6))) : undefined;
  }

  onClaim(m: Extract<S2C, { t: 'bclaim' }>, b: Base | undefined, heard: (k: unknown) => Base['claim']) {
    if (!b) return;
    b.claim = m.c ? heard(m.c) : undefined;
    this.sync(b);
    this.h.changed(b);
  }
  onKeep(m: Extract<S2C, { t: 'bkeep' }>) {
    this.kept.set(m.b, { s: m.s, dry: m.dry, day: m.day, at: performance.now() });
  }

  private panel: HTMLDivElement | null = null;
  private panelT = 0;
  /** the claim's screen while its store is open: kept up to the second */
  private panelFrame(dt: number) {
    const open = this.h.shown(), b = open ? [...this.store().bases.values()].find((x) => this.stores.get(x.id) === open) : undefined;
    if (!b?.claim) {
      this.panel?.remove();
      this.panel = null;
      return;
    }
    if ((this.panelT -= dt) > 0 && this.panel) return;
    this.panelT = 0.5;
    if (!this.panel) {
      if (!document.getElementById('cl-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cl-css', textContent: PANEL_CSS }));
      this.panel = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'cl-panel' }));
    }
    const k = this.kept.get(b.id) ?? this.alonesKeep(b), icons = this.h.icons();
    const day = k ? k.day : Object.entries(perDay(b)), have = counts(open!.container.serialize().items);
    const left = !k ? null : k.s < 0 ? Infinity : Math.max(0, k.s - (k.at ? (performance.now() - k.at) / 1000 : 0));
    const dry = !!(k?.dry || b.claim.dry) || left === 0;
    const head = dry ? 'Decaying' : left === null ? '…' : left === Infinity ? 'No upkeep needed' : `Protected for ${saidTime(left)}`;
    const rows = day.filter(([, n]) => n > 0).map(([id, n]) => {
      const got = toward(have, id);
      return `<div class="cl-row"><i style="background-image:url(${icons[id] ?? ''})"></i><b>${ITEMS[id]?.name ?? id}</b><span class="${got < n ? 'short' : ''}">${Math.ceil(n)} a day · ${got} in store</span></div>`;
    }).join('');
    const names = b.claim.members.map((m) => m.name || 'someone');
    const on = b.claim.members.some((m) => m.pid === this.h.who());
    this.panel.innerHTML = `<h4>Claim · upkeep</h4><div class="cl-left ${dry ? 'dry' : left !== null && left < 12 * 3600 ? 'low' : ''}">${head}</div>
      <p>Every day each piece of the base takes its upkeep from this store, in what its tier is gathered as: planks for wood, stone for stone, metal fragments for metal, iron bars for armoured. The bigger the base, the more each piece takes. When it runs dry, the base decays.</p>
      ${rows || '<p>Nothing to pay: the base costs no upkeep.</p>'}
      <div class="cl-who"><b>Authorised:</b> ${names.length ? names.join(', ') : 'nobody'}<br>${on ? 'Hold <kbd>F</kbd> at the claim to leave it.' : 'Hold <kbd>F</kbd> at the claim to join it and build here.'}</div>`;
  }

  /** the player looks at a piece (`at`): if it is a claim within reach, what F does to it */
  frame(dt: number, ok: boolean, at: { base: Base; id: number } | null): string | null {
    this.chipFrame();
    this.panelFrame(dt);
    if (!this.h.online()) this.alone(dt);
    const b = at?.base, p = b?.pieces.get(at!.id);
    if (!ok || !b || !p || p.k !== 'claim' || !b.claim) {
      this.fT = -1;
      return null;
    }
    const on = b.claim.members.some((m) => m.pid === this.h.who()), input = this.h.input;
    if (input.pressed('KeyF')) {
      this.fT = 0;
      this.fDone = false;
    }
    if (this.fT >= 0) {
      if (input.held('KeyF')) {
        this.fT += dt;
        if (this.fT >= HOLD && !this.fDone) {
          this.fDone = true;
          this.toggle(b);
        }
      } else {
        if (!this.fDone && this.stores.get(b.id)) this.h.open(this.stores.get(b.id)!);
        this.fT = -1;
      }
    }
    const who = b.claim.members.map((m) => m.name || 'someone').slice(0, 3).join(', ') + (b.claim.members.length > 3 ? ` and ${b.claim.members.length - 3} more` : '');
    const holding = this.fT >= 0 && !this.fDone && this.fT > 0.15;
    return `<span class="bc"><kbd>F</kbd><b>Claim</b> ${on ? 'yours' : `${who || 'nobody'}'s`}<i>${holding ? (on ? 'leaving…' : 'joining…') : `F opens its store · hold F to ${on ? 'leave it' : 'join it'}`}</i></span>`;
  }

  /** a base's claim's store opened */
  openStore(b: Base) {
    const s = this.stores.get(b.id);
    if (s) this.h.open(s);
  }

  /** the player joins a claim, or leaves it */
  toggle(b: Base) {
    if (this.h.online()) return void this.h.send({ t: 'bjoin', b: b.id });
    const on = this.store().join(b, this.h.who(), this.h.name());
    this.h.note(on ? 'You are on this claim: you may build here' : 'You have left this claim', on ? 'good' : 'info');
    this.h.changed(b);
  }

  /** the chip at the top: inside a claim's reach, whose it is and how long it is kept */
  private chipFrame() {
    const me = this.h.me(), b = this.store().claimAt(me.x, me.z);
    let text = '', cls = '';
    if (b?.claim) {
      const on = b.claim.members.some((m) => m.pid === this.h.who());
      const k = this.kept.get(b.id) ?? this.alonesKeep(b);
      if (!on) {
        text = `${b.claim.members[0]?.name || 'Someone'}'s claim · you may not build here`;
        cls = 'theirs';
      } else if (k?.dry || b.claim.dry) {
        text = 'Your claim · no upkeep: the base is rotting';
        cls = 'dry';
      } else {
        text = k?.s === 0 ? 'Your claim · its store is empty: put materials in it' : `Your claim · protected ${k ? (k.s < 0 ? 'for ever' : saidTime(k.s)) : '…'}`;
        cls = k && k.s >= 0 && k.s < 12 * 3600 ? 'low' : 'ok';
      }
    }
    const key = `${cls}|${text}`;
    if (key === this.chipText) return;
    this.chipText = key;
    if (!this.chip) {
      this.chip = document.createElement('div');
      this.chip.className = 'hud-claim';
      this.h.hud().appendChild(this.chip);
    }
    this.chip.textContent = text;
    this.chip.className = `hud-claim ${cls}${text ? ' show' : ''}`;
  }

  /** played alone: what the store keeps, worked out from what is in it */
  private alonesKeep(b: Base): Kept | null {
    if (this.h.online()) return null;
    const s = this.stores.get(b.id);
    if (!s) return null;
    const day = perDay(b), have = counts(s.container.serialize().items);
    const left = protectedFor(have, day);
    return { s: Number.isFinite(left) ? left : -1, dry: !!b.claim?.dry, day: Object.entries(day) };
  }

  /** played alone, every minute: upkeep out of each claim's store, and rot where there is none to pay with */
  private alone(dt: number) {
    if ((this.aloneT += dt) < 60) return;
    this.aloneT = 0;
    const store = this.store(), now = Date.now();
    for (const b of [...store.bases.values()]) {
      if (b.claim) {
        const s = this.stores.get(b.id), items = s ? s.container.serialize().items : [];
        const have = counts(items), before = { ...have };
        b.claim.dry = !pay(perDay(b), 1 / 60, b.claim.due, have);
        if (s) for (const [id, n] of Object.entries(before)) if (n > (have[id] ?? 0)) s.container.take(id, n - (have[id] ?? 0));
        if (!b.claim.dry) continue;
      }
      const { broken } = rot(b, 1 / 60, now, !!b.claim);
      for (const id of broken) {
        if (!b.pieces.has(id)) continue;
        const gone = store.remove(b.id, id);
        this.h.broke(b, gone);
      }
      if (!b.claim) this.sync(b);
      this.h.changed(b);
    }
  }
}

/** counts of what a store holds of what a base is kept with */
function counts(items: StoredItem[]) {
  const n: Record<string, number> = {};
  for (const it of items) if (pays(it.id)) n[it.id] = (n[it.id] ?? 0) + it.qty;
  return n;
}

