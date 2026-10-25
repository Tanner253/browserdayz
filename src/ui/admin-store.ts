// The admin panel's STORE tab (2026-10-22). The owner: "well need to log these payments in some sort of database and in
// the amdin ui so i can see and validate these things", then "admin should be able to see and manage all cosmetic states
// for users easily with good UX", and of the first try: "i want to be able to click on the numbered cell for a cosmetic
// then see who owns it and get to nav to their state for it. 'give by hand' makes no sense we have the player list
// there. i need a easier way to gift a cosmetic and maintain cosmetics. the dropdowns look ugly as well", "simple is
// better but want full functionality".
//
// So: Players, each with what they have as chips (a finish with its picture and number; VIP and no-ads with their days)
// and a Gift button; Payments, every payment, those that need a look first; Numbered, each numbered finish number by
// number. A finish's chip or a number opens what it is and how it came, and what can be done with it. Gifting is a
// sheet of picture cards. No dropdowns: the panel's own buttons. The book is the site's (api/_lib/shop.ts); every order
// goes through the game server (server/store-admin.ts), admins only.

import { ITEM_IDS, SHOP, type ItemId } from '../../api/_lib/shop-items';

interface Row {
  id: string; sig: string; item: ItemId; acct: string; name: string; usd: number; rate: number; quoted: number; paid: number; from: string;
  paidAt: number; at: string; how: 'ref' | 'amount' | 'sig' | 'hand'; status: 'ok' | 'look' | 'revoked' | 'refunded'; why?: string; days?: number;
  discord?: string; note?: string; role?: boolean; by?: string; moved?: string; serial?: number;
}
interface Owned { item: ItemId; serial?: number; id: string; how: Row['how']; by: string; at: string; sig: string; paid: string }
interface Player { acct: string; name: string; discord: string; usd: number; n: number; looks: number; last: string; vip: number; noads: number; cup: number; owned: Owned[] }
interface Sum { n: number; usd: number; sol: string }
export interface StoreView { rows: Row[]; month: Sum; all: Sum; looks: number; vips: { acct: string; until: number; name: string; discord: string; role: boolean; id: string }[]; players: Player[] }
type Who = { name: string; acct: string; online: boolean };

export interface StoreHands {
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K];
  button: (label: string, on: () => void, cls?: string, ic?: string) => HTMLButtonElement;
  grave: (key: string, label: string, on: () => void, ic?: string) => HTMLButtonElement;
  /** an order to the book, sent to the server */
  order: (act: unknown) => void;
  redraw: () => void;
}

const HOW: Record<Row['how'], string> = { ref: 'scanned', amount: 'by amount', sig: 'signature', hand: 'gifted' };
const sol = (lamports: number) => (lamports / 1e9).toFixed(4);
const short = (s: string, n = 6) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const daysLeft = (ms: number) => Math.max(1, Math.ceil((ms - Date.now()) / 86_400_000));
/** what can be gifted, in the order the store shows it (a coffee is not a gift) */
const GIFTS = ITEM_IDS.filter((id) => id !== 'coffee');
const SKINS = ITEM_IDS.filter((id) => SHOP[id].skin);
/** a finish's short name, for a chip */
const brief = (id: ItemId) => SHOP[id].name.replace('-plated', '').replace('Desert Eagle', 'Deagle');
/** how one came, in a line: bought (and the payment), or gifted (by whom) */
const came = (o: { how: Row['how']; by: string; at: string; paid: string }) => (o.how === 'hand' ? `Gifted${o.by ? ` by ${o.by}` : ''}, ${when(o.at)}` : `Bought ${when(o.at)}, ${o.paid} SOL`);

export class StoreTab {
  view: StoreView | null = null;
  /** what changes the tab's look: counted up whenever anything does */
  n = 0;
  private why = '';
  private said = '';
  private busy = false;
  private asked = 0;
  private page: 'players' | 'payments' | 'numbered' = 'players';
  /** what the lists are narrowed to: a name, an account, a Discord name or a signature */
  private find = '';
  /** the finish whose chip is open (its row), and the number open on the grid */
  private chip = '';
  private cell: { item: ItemId; n: number } | null = null;
  /** the gift being made: to whom, what, which number, how many days */
  private gift: { acct: string; name: string; item: ItemId | null; serial: number | null; picking: boolean; days: number } | null = null;
  /** a player being chosen: to gift (what, if already chosen), or to move a finish to */
  private choosing: { for: 'gift' | 'move'; id?: string; item?: ItemId; serial?: number; q: string } | null = null;
  private found: Who[] = [];
  private looking = 0;

  constructor(private h: StoreHands) {}

  /** the tab is shown: the book asked for, unless it came a moment ago */
  open() {
    if (!this.view || Date.now() - this.asked > 20_000) this.send({ act: 'list' });
  }

  private send(act: unknown) {
    this.asked = Date.now();
    this.busy = true;
    this.again();
    this.h.order(act);
  }

  private again() {
    this.n++;
    this.h.redraw();
  }

  /** the server's answer to an order */
  got(m: { ok: boolean; view?: unknown; why?: string; who?: Who[] }) {
    if (m.who) {
      this.found = m.who;
      return this.again();
    }
    if (m.view) this.view = m.view as StoreView;
    this.why = m.ok ? '' : m.why ?? 'It was not done.';
    if (!m.ok) this.said = '';
    this.busy = false;
    this.again();
  }

  body(): HTMLElement[] {
    const { el, button } = this.h;
    const v = this.view;
    const top = el('div', 'adm-store-top');
    top.append(el('span', '', v ? `This month $${v.month.usd} (${v.month.n}) · All time $${v.all.usd} from ${v.all.n}, ${v.all.sol} SOL` : this.busy ? 'Asking the site…' : 'Nothing yet.'));
    if (v?.looks) top.append(button(`${v.looks} need a look`, () => ((this.page = 'payments'), (this.gift = this.choosing = null), this.again()), 'small st-look'));
    top.append(button(this.busy ? 'Asking…' : 'Refresh', () => ((this.said = ''), this.send({ act: 'list' })), 'small', 'refill'));
    const out: HTMLElement[] = [top];
    if (this.why) out.push(el('div', 'adm-store-why', this.why));
    else if (this.said && !this.busy) out.push(el('div', 'adm-store-said', this.said));
    // (a gift or a choice of player is a sheet of its own over the tab: one thing at a time)
    if (this.gift) return [...out, this.giftSheet(this.gift)];
    if (this.choosing) return [...out, this.chooser(this.choosing)];
    const bar = el('div', 'adm-store-bar');
    for (const [id, label] of [['players', 'Players'], ['payments', 'Payments'], ['numbered', 'Numbered']] as const) {
      bar.append(button(label, () => ((this.page = id), this.again()), `small${this.page === id ? ' on' : ''}`));
    }
    const find = el('input');
    find.placeholder = 'Find a player: name, account, Discord, signature';
    find.value = this.find;
    find.dataset.k = 'store-find';
    find.oninput = () => ((this.find = find.value.trim().toLowerCase()), this.again());
    bar.append(find, button('Gift to someone new', () => this.choose({ for: 'gift', q: '' }), 'small st-gift', 'star'));
    out.push(bar);
    if (this.page === 'players') out.push(this.players(v));
    if (this.page === 'numbered') out.push(this.numbered(v));
    if (this.page === 'payments') {
      if (v?.vips.length) out.push(this.vips(v));
      out.push(this.payments(v));
    }
    return out;
  }

  private hit(...about: string[]) {
    return !this.find || about.some((a) => a.toLowerCase().includes(this.find));
  }

  // ---------------------------------------------------------------- players

  private players(v: StoreView | null) {
    const { el, button } = this.h;
    const box = el('div', 'adm-store-list');
    const list = (v?.players ?? []).filter((p) => this.hit(p.name, p.acct, p.discord, ...p.owned.map((o) => o.sig)));
    for (const p of list) {
      const r = el('div', 'st-player');
      const who = el('div', 'st-who');
      who.append(el('b', '', p.name || 'No name'), el('small', '', `${short(p.acct, 4)}${p.discord ? ` · ${p.discord}` : ''}${p.usd ? ` · paid $${p.usd}` : ''}`));
      who.title = `Account ${p.acct}`;
      const chips = el('div', 'st-chips');
      for (const kind of ['vip', 'noads'] as const) if (p[kind] > Date.now()) chips.append(this.timeChip(p, kind));
      for (const o of p.owned) chips.append(this.finishChip(o));
      if (p.cup > Date.now()) chips.append(el('span', 'st-chip cup', 'Coffee this week'));
      if (!chips.children.length) chips.append(el('span', 'st-none', 'Nothing now'));
      r.append(who, chips, button('Gift', () => this.startGift(p.acct, p.name), 'small st-gift', 'star'));
      box.append(r);
      // (an open finish: what it is, how it came, and what can be done with it)
      const open = p.owned.find((o) => o.id === this.chip);
      if (open) box.append(this.finishCard(p, open));
    }
    if (!list.length) box.append(el('div', 'adm-none', this.view ? (this.find ? 'Nobody matches. Gift to someone new finds players who have bought nothing.' : 'Nobody has bought anything yet.') : ''));
    return box;
  }

  /** VIP or no-ads: the days left, more of them, or an end */
  private timeChip(p: Player, kind: 'vip' | 'noads') {
    const { el, button, grave } = this.h;
    const c = el('span', `st-chip ${kind}`);
    c.append(el('b', '', `${kind === 'vip' ? 'VIP' : 'No ads'} · ${daysLeft(p[kind])} d`));
    c.title = `To ${day(p[kind])}`;
    c.append(
      button('+7 d', () => this.send({ act: 'grant', acct: p.acct, item: kind, days: 7, name: p.name }), 'tiny'),
      button('+30 d', () => this.send({ act: 'grant', acct: p.acct, item: kind, days: 30, name: p.name }), 'tiny'),
      grave(`end:${kind}:${p.acct}`, 'End', () => this.send({ act: 'end', acct: p.acct, item: kind })),
    );
    return c;
  }

  /** a finish: its picture, its name and number; clicked, it opens */
  private finishChip(o: Owned) {
    const { el } = this.h;
    const c = el('button', `st-chip finish ${SHOP[o.item].skin?.finish ?? SHOP[o.item].skin?.form ?? ''}${this.chip === o.id ? ' open' : ''}`);
    c.type = 'button';
    c.dataset.k = `chip:${o.id}`;
    const img = el('img');
    img.src = `/shop/${o.item}.jpg`;
    img.alt = '';
    c.append(img, el('b', '', `${brief(o.item)}${o.serial ? ` No. ${o.serial}` : ''}`));
    c.onclick = () => ((this.chip = this.chip === o.id ? '' : o.id), this.again());
    c.title = came(o);
    return c;
  }

  private finishCard(p: Player, o: Owned) {
    const { el, button, grave } = this.h;
    const card = el('div', 'st-card');
    const text = el('div', 'st-card-text');
    text.append(el('b', '', `${SHOP[o.item].name}${o.serial ? ` No. ${o.serial}${SHOP[o.item].limit ? ` of ${SHOP[o.item].limit}` : ''}` : ''} · ${p.name || short(p.acct, 4)}`));
    const line = el('span', '', came(o));
    if (o.sig) {
      const a = el('a', '', 'the payment');
      a.href = `https://solscan.io/tx/${o.sig}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      line.append(' · ', a);
    }
    text.append(line);
    const acts = el('div', 'st-acts');
    acts.append(
      grave(`take:${o.id}`, 'Take back', () => ((this.chip = ''), this.send({ act: 'set', id: o.id, status: 'revoked' }))),
      button('Move to another player…', () => this.choose({ for: 'move', id: o.id, q: '' }), 'small'),
    );
    if (o.serial && SHOP[o.item].limit) acts.append(button('See in Numbered', () => ((this.page = 'numbered'), (this.cell = { item: o.item, n: o.serial! }), this.again()), 'small'));
    acts.append(button('', () => ((this.chip = ''), this.again()), 'small', 'x'));
    card.append(text, acts);
    return card;
  }

  // ---------------------------------------------------------------- gifting

  private startGift(acct: string, name: string, item: ItemId | null = null, serial: number | null = null) {
    this.choosing = null;
    this.gift = { acct, name, item, serial, picking: false, days: 30 };
    this.again();
  }

  /** who holds each number of a finish now (a payment waiting for a look holds its number too) */
  private heldOf(item: ItemId) {
    const held = new Map<number, Player | null>();
    for (const r of this.view?.rows ?? []) if (r.item === item && r.serial && (r.status === 'ok' || r.status === 'look')) held.set(r.serial, null);
    for (const p of this.view?.players ?? []) for (const o of p.owned) if (o.item === item && o.serial) held.set(o.serial, p);
    return held;
  }
  private nextFree(item: ItemId) {
    const held = this.heldOf(item), limit = SHOP[item].limit ?? Infinity;
    for (let n = 1; n <= limit; n++) if (!held.has(n)) return n;
    return null;
  }

  private giftSheet(g: NonNullable<StoreTab['gift']>) {
    const { el, button } = this.h;
    const sheet = el('div', 'st-sheet');
    const head = el('div', 'st-sheet-head');
    head.append(el('b', '', `Gift to ${g.name || short(g.acct, 4)}`), el('small', '', short(g.acct, 4)), button('Cancel', () => ((this.gift = null), this.again()), 'small'));
    sheet.append(head);
    const owner = this.view?.players.find((p) => p.acct === g.acct);
    const cards = el('div', 'st-cards');
    for (const id of GIFTS) {
      const it = SHOP[id], has = !!owner?.owned.some((o) => o.item === id), free = it.limit ? it.limit - this.heldOf(id).size : null;
      const off = (!!it.skin && has) || free === 0;
      const c = el('button', `st-pick${g.item === id ? ' on' : ''}${off ? ' off' : ''}`);
      c.type = 'button';
      c.dataset.k = `gift:${id}`;
      if (it.skin) {
        const img = el('img');
        img.src = `/shop/${id}.jpg`;
        img.alt = '';
        c.append(img);
      } else c.append(el('i', `st-art ${id}`, id === 'vip' ? 'VIP' : 'NO ADS'));
      const sub = it.skin && has ? 'Has it' : free === 0 ? 'Sold out' : free !== null ? `${free} left` : it.days ? 'days' : 'numbered';
      c.append(el('span', '', brief(id)), el('small', '', sub));
      if (!off) c.onclick = () => ((g.item = id), (g.serial = null), (g.picking = false), this.again());
      cards.append(c);
    }
    sheet.append(cards);
    const it = g.item ? SHOP[g.item] : null;
    if (g.item && it?.skin) {
      const next = this.nextFree(g.item), item = g.item;
      const row = el('div', 'st-choose');
      row.append(el('span', '', 'Number'),
        button(`Next free${next ? ` · No. ${next}` : ''}`, () => ((g.serial = null), (g.picking = false), this.again()), `small${!g.serial && !g.picking ? ' on' : ''}`),
        button(g.serial ? `No. ${g.serial}` : 'Pick a number', () => ((g.picking = !g.picking), this.again()), `small${g.serial || g.picking ? ' on' : ''}`));
      sheet.append(row);
      if (g.picking) sheet.append(this.grid(item, (n, holder) => void (holder === undefined && ((g.serial = n), (g.picking = false), this.again())), g.serial));
    }
    if (g.item && it?.days) {
      const row = el('div', 'st-choose');
      row.append(el('span', '', 'Days'));
      for (const d of [7, 30, 90]) row.append(button(`${d} days`, () => ((g.days = d), this.again()), `small${g.days === d ? ' on' : ''}`));
      sheet.append(row);
    }
    const num = g.item && it?.skin ? g.serial ?? this.nextFree(g.item) : null;
    const what = g.item ? `${brief(g.item)}${num ? ` No. ${num}` : ''}${it?.days ? `, ${g.days} days` : ''}` : '';
    const go = button(g.item ? `Gift ${what} to ${g.name || short(g.acct, 4)}` : 'Pick what to gift', () => {
      if (!g.item) return;
      this.said = `Gifted ${what} to ${g.name || short(g.acct, 4)}.`;
      this.gift = null;
      this.page = 'players';
      this.find = g.acct;
      this.send({ act: 'grant', acct: g.acct, item: g.item, name: g.name, ...(it?.days ? { days: g.days } : {}), ...(g.serial ? { serial: g.serial } : {}) });
    }, `st-confirm${g.item ? ' good' : ''}`, 'star');
    go.disabled = !g.item;
    sheet.append(go);
    return sheet;
  }

  // ---------------------------------------------------------------- choosing a player

  private choose(c: NonNullable<StoreTab['choosing']>) {
    this.choosing = c;
    this.found = [];
    this.ask('');
    this.again();
  }

  /** the server's players by name (a moment after the typing stops) */
  private ask(q: string) {
    clearTimeout(this.looking);
    this.looking = window.setTimeout(() => this.h.order({ act: 'who', q }), q ? 250 : 0);
  }

  private chooser(c: NonNullable<StoreTab['choosing']>) {
    const { el, button } = this.h;
    const sheet = el('div', 'st-sheet');
    const head = el('div', 'st-sheet-head');
    const moving = c.for === 'move' ? (this.view?.players.flatMap((p) => p.owned).find((o) => o.id === c.id) ?? this.view?.rows.find((r) => r.id === c.id)) : null;
    const title = c.for === 'move'
      ? `Move ${moving ? `${brief(moving.item)}${moving.serial ? ` No. ${moving.serial}` : ''}` : 'it'} to…`
      : c.item ? `Gift ${brief(c.item)}${c.serial ? ` No. ${c.serial}` : ''} to…` : 'Gift to…';
    head.append(el('b', '', title), button('Cancel', () => ((this.choosing = null), this.again()), 'small'));
    sheet.append(head);
    const q = el('input');
    q.placeholder = 'A name, or an account';
    q.value = c.q;
    q.dataset.k = 'store-choose';
    q.oninput = () => ((c.q = q.value.trim()), this.ask(c.q.toLowerCase()), this.again());
    sheet.append(q);
    // (the server's players and the store's, one list: those online first)
    const s = c.q.toLowerCase(), seen = new Set<string>(), rows: Who[] = [];
    for (const w of this.found) if (!seen.has(w.acct)) seen.add(w.acct), rows.push(w);
    for (const p of this.view?.players ?? []) if (!seen.has(p.acct) && (!s || p.name.toLowerCase().includes(s) || p.acct.includes(s))) seen.add(p.acct), rows.push({ name: p.name, acct: p.acct, online: false });
    if (/^[0-9a-f]{24}$/.test(s) && !seen.has(s)) rows.push({ name: '', acct: s, online: false });
    const list = el('div', 'st-whos');
    for (const w of rows.sort((a, b) => Number(b.online) - Number(a.online)).slice(0, 14)) {
      const b = button('', () => {
        if (c.for === 'move' && c.id) {
          this.choosing = null;
          this.chip = '';
          this.said = `Moved to ${w.name || short(w.acct, 4)}.`;
          return this.send({ act: 'move', id: c.id, acct: w.acct });
        }
        this.startGift(w.acct, w.name, c.item ?? null, c.serial ?? null);
      }, 'st-whorow');
      b.dataset.k = `who:${w.acct}`;
      b.append(el('b', '', w.name || 'No name'), el('small', '', `${short(w.acct, 4)}${w.online ? ' · online' : ''}`));
      list.append(b);
    }
    if (!rows.length) list.append(el('div', 'adm-none', c.q ? 'Nobody by that name: they need to have played since the server started, or to have bought something.' : 'Looking…'));
    sheet.append(list);
    return sheet;
  }

  // ---------------------------------------------------------------- numbered

  /** a finish's numbers as buttons: held ones lit, the chosen one ringed; `pick` is told which is clicked and who holds it */
  private grid(item: ItemId, pick: (n: number, holder: Player | null | undefined) => void, ring: number | null = null) {
    const { el } = this.h;
    const held = this.heldOf(item), limit = SHOP[item].limit ?? Math.max(20, Math.ceil((Math.max(0, ...held.keys()) + 1) / 20) * 20);
    const grid = el('div', 'adm-store-grid');
    for (let n = 1; n <= limit; n++) {
      const has = held.has(n), p = held.get(n);
      const c = el('button', `${has ? `held ${SHOP[item].skin!.finish ?? SHOP[item].skin!.form}` : 'free'}${ring === n ? ' ring' : ''}`, String(n));
      c.type = 'button';
      c.title = has ? `No. ${n}: ${p ? p.name || p.acct : 'a payment waiting for a look'}` : `No. ${n}: free`;
      c.onclick = () => pick(n, has ? p : undefined);
      grid.append(c);
    }
    return grid;
  }

  private numbered(v: StoreView | null) {
    const { el, button, grave } = this.h;
    const box = el('div', 'adm-store-numbered');
    for (const id of SKINS) {
      const held = this.heldOf(id), limit = SHOP[id].limit;
      box.append(el('h4', '', `${SHOP[id].name}: ${held.size} held${limit ? `, ${limit - held.size} of ${limit} left` : ''}`));
      box.append(this.grid(id, (n) => ((this.cell = this.cell?.item === id && this.cell.n === n ? null : { item: id, n }), this.again()), this.cell?.item === id ? this.cell.n : null));
      if (this.cell?.item !== id) continue;
      // (the number opened: who holds it and how it came, or nobody, and a gift)
      const n = this.cell.n, p = held.get(n), o = p?.owned.find((x) => x.item === id && x.serial === n);
      const card = el('div', 'st-card');
      const text = el('div', 'st-card-text'), acts = el('div', 'st-acts');
      if (p && o) {
        text.append(el('b', '', `No. ${n} · ${p.name || 'No name'}`), el('span', '', `${came(o)} · ${short(p.acct, 4)}`));
        acts.append(
          button(`Go to ${p.name || 'them'}`, () => ((this.page = 'players'), (this.find = p.acct), (this.chip = o.id), (this.cell = null), this.again()), 'small st-gift'),
          grave(`take:${o.id}`, 'Take back', () => ((this.cell = null), this.send({ act: 'set', id: o.id, status: 'revoked' }))),
          button('Move to…', () => this.choose({ for: 'move', id: o.id, q: '' }), 'small'),
        );
      } else if (held.has(n)) {
        text.append(el('b', '', `No. ${n}`), el('span', '', 'Held by a payment waiting for a look: see Payments.'));
        acts.append(button('Payments', () => ((this.page = 'payments'), (this.cell = null), this.again()), 'small'));
      } else {
        text.append(el('b', '', `No. ${n} · free`));
        acts.append(button('Gift this number to…', () => this.choose({ for: 'gift', item: id, serial: n, q: '' }), 'small st-gift', 'star'));
      }
      acts.append(button('', () => ((this.cell = null), this.again()), 'small', 'x'));
      card.append(text, acts);
      box.append(card);
    }
    if (!v) box.append(el('div', 'adm-none', ''));
    return box;
  }

  // ---------------------------------------------------------------- payments

  private vips(v: StoreView) {
    const { el, button } = this.h;
    const t = el('div', 'adm-table store-vips');
    const head = el('div', 'adm-tr head');
    for (const x of ['VIP', 'Discord', 'Until', 'Role']) head.append(el('span', '', x));
    t.append(head);
    for (const p of v.vips.filter((x) => this.hit(x.name, x.acct, x.discord))) {
      const r = el('div', 'adm-tr');
      const left = daysLeft(p.until);
      r.append(el('span', '', p.name || short(p.acct)), el('span', '', p.discord || '—'), el('span', left <= 3 ? 'adm-store-soon' : '', `${day(p.until)} (${left} d)`));
      const role = el('span');
      if (p.id) role.append(button(p.role ? 'Given' : 'Not yet', () => this.send({ act: 'role', id: p.id, on: !p.role }), `small${p.role ? ' good' : ''}`));
      r.append(role);
      t.append(r);
    }
    return t;
  }

  private payments(v: StoreView | null) {
    const { el, button, grave } = this.h;
    const t = el('div', 'adm-table store-rows');
    const head = el('div', 'adm-tr head');
    for (const x of ['When', 'Player', 'What', 'Paid', 'From', 'How', 'Status', '']) head.append(el('span', '', x));
    t.append(head);
    // (those that need a look first)
    const rows = (v?.rows ?? []).filter((r) => this.hit(r.name, r.acct, r.discord ?? '', r.sig, r.from)).sort((a, b) => Number(b.status === 'look') - Number(a.status === 'look'));
    for (const p of rows) {
      const r = el('div', `adm-tr st-${p.status}`);
      const who = el('span', '', p.name || '—');
      who.title = `Account ${p.acct}${p.moved ? ` (moved from ${p.moved})` : ''}${p.discord ? `\nDiscord: ${p.discord}` : ''}${p.note ? `\nNote: ${p.note}` : ''}`;
      who.append(el('small', '', ` ${short(p.acct, 4)}`));
      const what = el('span', '', `${p.serial ? `No. ${p.serial} · ` : ''}${SHOP[p.item]?.name ?? p.item}${p.days && p.item !== 'coffee' ? ` · ${p.days} d` : ''}`);
      const paid = el('span', '', p.how === 'hand' ? '—' : `$${p.usd} · ${sol(p.paid)} SOL`);
      if (p.how !== 'hand') paid.title = `Asked ${sol(p.quoted)} SOL at $${p.rate.toFixed(2)} a SOL`;
      const from = el('span');
      if (p.sig) {
        const a = el('a', '', short(p.from || p.sig, 4));
        a.href = `https://solscan.io/tx/${p.sig}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = `Paid from ${p.from}\nThe payment on Solscan`;
        from.append(a);
      } else from.textContent = p.by ? `by ${p.by}` : '—';
      const status = el('span', `adm-store-st ${p.status}`, p.status === 'look' ? `look: ${p.why ?? ''}` : p.status);
      const acts = el('span', 'adm-acts');
      if (p.status === 'look') acts.append(button('Pass', () => this.send({ act: 'set', id: p.id, status: 'ok' }), 'small good'));
      if (p.status === 'ok') acts.append(grave(`revoke:${p.id}`, 'Revoke', () => this.send({ act: 'set', id: p.id, status: 'revoked' })));
      if (p.status === 'ok' || p.status === 'look') acts.append(grave(`refund:${p.id}`, 'Refunded', () => this.send({ act: 'set', id: p.id, status: 'refunded' })));
      if (p.status === 'revoked' || p.status === 'refunded') acts.append(button('Restore', () => this.send({ act: 'set', id: p.id, status: 'ok' }), 'small'));
      acts.append(button('Move…', () => this.choose({ for: 'move', id: p.id, q: '' }), 'small'));
      for (const b of acts.children) b.classList.add('small');
      r.append(el('span', '', when(p.at)), who, what, paid, from, el('span', '', HOW[p.how]), status, acts);
      t.append(r);
    }
    if (!rows.length) t.append(el('div', 'adm-none', this.view ? 'No payments yet.' : ''));
    return t;
  }
}
