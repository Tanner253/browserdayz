// The admin panel's STORE tab (2026-10-22): every purchase, what came in, the VIPs that run out soonest, and an admin's
// hand on the book: grant, revoke, refund, pass a payment that needs a look, move a purchase to the account a player
// has now, tick a Discord role as given. The owner: "well need to log these payments in some sort of database and in
// the amdin ui so i can see and validate these things", and "admin should be able to see and manage all cosmetic states
// for users easily with good UX": so it opens on the players, each with what they have now and a hand on each thing
// (Players), beside every payment (Purchases) and the numbered finishes, number by number (Numbered). The book is the
// site's (api/_lib/shop.ts); each order goes through the game server (server/store-admin.ts), admins only.

import { ITEM_IDS, SHOP, type ItemId } from '../../api/_lib/shop-items';

interface Row {
  id: string; sig: string; item: ItemId; acct: string; name: string; usd: number; rate: number; quoted: number; paid: number; from: string;
  paidAt: number; at: string; how: 'ref' | 'amount' | 'sig' | 'hand'; status: 'ok' | 'look' | 'revoked' | 'refunded'; why?: string; days?: number;
  discord?: string; note?: string; role?: boolean; by?: string; moved?: string; serial?: number;
}
interface Sum { n: number; usd: number; sol: string }
interface Player { acct: string; name: string; discord: string; usd: number; n: number; looks: number; last: string; vip: number; noads: number; cup: number; owned: { item: ItemId; serial?: number; id: string }[] }
export interface StoreView { rows: Row[]; month: Sum; all: Sum; looks: number; vips: { acct: string; until: number; name: string; discord: string; role: boolean; id: string }[]; players: Player[] }

export interface StoreHands {
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => HTMLElementTagNameMap[K];
  button: (label: string, on: () => void, cls?: string, ic?: string) => HTMLButtonElement;
  grave: (key: string, label: string, on: () => void, ic?: string) => HTMLButtonElement;
  /** an order to the book, sent to the server */
  order: (act: unknown) => void;
  redraw: () => void;
}

const HOW: Record<Row['how'], string> = { ref: 'scanned', amount: 'by amount', sig: 'signature', hand: 'by hand' };
const sol = (lamports: number) => (lamports / 1e9).toFixed(4);
const short = (s: string, n = 6) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const SKINS = ITEM_IDS.filter((id) => SHOP[id].skin);
/** a finish's short name, for a chip */
const brief = (id: ItemId) => SHOP[id].name.replace('-plated', '').replace('Desert Eagle', 'Deagle');

export class StoreTab {
  view: StoreView | null = null;
  private why = '';
  private busy = false;
  private asked = 0;
  /** what changes the tab's look: counted up whenever anything does */
  n = 0;
  private moving = '';
  private grant = { acct: '', item: 'vip' as ItemId, days: '30' };
  private page: 'players' | 'purchases' | 'numbered' = 'players';
  /** what the lists are narrowed to: a name, an account, a Discord name or a signature */
  private find = '';
  /** the player whose things are open to be managed */
  private managing = '';

  constructor(private h: StoreHands) {}

  /** the tab is shown: the book asked for, unless it came a moment ago */
  open() {
    if (!this.view || Date.now() - this.asked > 20_000) this.send({ act: 'list' });
  }

  private send(act: unknown) {
    this.asked = Date.now();
    this.busy = true;
    this.n++;
    this.h.order(act);
  }

  /** the server's answer to an order */
  got(m: { ok: boolean; view?: unknown; why?: string }) {
    if (m.view) this.view = m.view as StoreView;
    this.why = m.ok ? '' : m.why ?? 'It was not done.';
    this.busy = false;
    this.moving = '';
    this.n++;
    this.h.redraw();
  }

  body(): HTMLElement[] {
    const { el, button } = this.h;
    const v = this.view;
    const top = el('div', 'adm-store-top');
    top.append(el('span', '', v ? `This month $${v.month.usd} (${v.month.n}) · All time $${v.all.usd} from ${v.all.n}, ${v.all.sol} SOL` : this.busy ? 'Asking the site…' : 'Nothing yet.'));
    if (v?.looks) top.append(el('b', 'adm-store-look', `${v.looks} need a look`));
    top.append(button(this.busy ? 'Asking…' : 'Refresh', () => this.send({ act: 'list' }), 'small', 'refill'));
    const out: HTMLElement[] = [top];
    if (this.why) out.push(el('div', 'adm-store-why', this.why));
    // (the three ways of looking, and the search over all of them)
    const bar = el('div', 'adm-store-bar');
    for (const [id, label] of [['players', 'Players'], ['purchases', 'Purchases'], ['numbered', 'Numbered']] as const) {
      bar.append(button(label, () => ((this.page = id), this.n++, this.h.redraw()), `small${this.page === id ? ' on' : ''}`));
    }
    const find = el('input');
    find.placeholder = 'Find a name, account, Discord or signature';
    find.value = this.find;
    find.dataset.k = 'store-find';
    find.oninput = () => ((this.find = find.value.trim().toLowerCase()), this.n++, this.h.redraw());
    bar.append(find);
    out.push(bar);
    if (this.page === 'players') out.push(this.players(v));
    if (this.page === 'numbered') out.push(this.numbered(v));
    if (this.page === 'purchases') {
      out.push(this.grantForm());
      if (v?.vips.length) out.push(this.vips(v));
      out.push(this.rows((v?.rows ?? []).filter((r) => this.hit(r.name, r.acct, r.discord ?? '', r.sig, r.from))));
    }
    return out;
  }

  private hit(...about: string[]) {
    return !this.find || about.some((a) => a.toLowerCase().includes(this.find));
  }

  /** every player who has bought or been given anything: what they have now, and a hand on each thing */
  private players(v: StoreView | null) {
    const { el, button, grave } = this.h;
    const now = Date.now();
    const t = el('div', 'adm-table store-players');
    const head = el('div', 'adm-tr head');
    for (const x of ['Player', 'VIP', 'No ads', 'Finishes', 'Paid', '']) head.append(el('span', '', x));
    t.append(head);
    const list = (v?.players ?? []).filter((p) => this.hit(p.name, p.acct, p.discord));
    for (const p of list) {
      const r = el('div', `adm-tr${this.managing === p.acct ? ' open' : ''}`);
      const who = el('span', 'adm-store-who', p.name || '—');
      who.append(el('small', '', ` ${short(p.acct, 4)}${p.discord ? ` · ${p.discord}` : ''}`));
      who.title = `Account ${p.acct}`;
      const vip = el('span', p.vip > now ? 'adm-store-vip' : 'adm-store-dim', p.vip > now ? `to ${day(p.vip)} (${Math.ceil((p.vip - now) / 86_400_000)} d)` : '—');
      const noads = el('span', p.noads > now ? '' : 'adm-store-dim', p.noads > now ? `to ${day(p.noads)}` : '—');
      const fin = el('span', 'adm-store-chips');
      for (const o of p.owned) fin.append(el('em', `chip ${SHOP[o.item].skin?.finish ?? ''}`, `${brief(o.item)}${o.serial ? ` No. ${o.serial}` : ''}`));
      if (!p.owned.length) fin.append(el('i', 'adm-store-dim', '—'));
      const paid = el('span', '', `$${p.usd}${p.looks ? ` · ${p.looks} to look at` : ''}`);
      const act = el('span', 'adm-acts');
      act.append(button(this.managing === p.acct ? 'Close' : 'Manage', () => ((this.managing = this.managing === p.acct ? '' : p.acct), this.n++, this.h.redraw()), 'small'));
      r.append(who, vip, noads, fin, paid, act);
      t.append(r);
      if (this.managing !== p.acct) continue;
      // (their things, one click each: what they have can be taken back, what they have not given; time added or ended)
      const m = el('div', 'adm-store-manage');
      const line = (label: string, kids: HTMLElement[]) => {
        const row = el('div', 'adm-store-mline');
        row.append(el('b', '', label), ...kids);
        m.append(row);
      };
      line('Finishes', SKINS.map((id) => {
        const o = p.owned.find((x) => x.item === id);
        return o
          ? grave(`take:${o.id}`, `${brief(id)}${o.serial ? ` No. ${o.serial}` : ''}: take back`, () => this.send({ act: 'set', id: o.id, status: 'revoked' }))
          : button(`+ ${brief(id)}`, () => this.send({ act: 'grant', acct: p.acct, item: id, name: p.name }), 'small good');
      }));
      for (const [id, until] of [['vip', p.vip], ['noads', p.noads]] as const) {
        const kids = [button('+ 30 days', () => this.send({ act: 'grant', acct: p.acct, item: id, days: 30, name: p.name }), 'small good'), button('+ 7 days', () => this.send({ act: 'grant', acct: p.acct, item: id, days: 7, name: p.name }), 'small')];
        if (until > now) kids.push(grave(`end:${id}:${p.acct}`, `End ${SHOP[id].name}`, () => this.send({ act: 'end', acct: p.acct, item: id })));
        line(SHOP[id].name, kids);
      }
      line('Their purchases', [button('Show them', () => ((this.page = 'purchases'), (this.find = p.acct), this.n++, this.h.redraw()), 'small')]);
      t.append(m);
    }
    if (!list.length) t.append(el('div', 'adm-none', this.view ? (this.find ? 'Nobody matches.' : 'Nobody has bought anything yet.') : ''));
    return t;
  }

  /** each numbered finish, number by number: who holds which, and how many are left */
  private numbered(v: StoreView | null) {
    const { el } = this.h;
    const box = el('div', 'adm-store-numbered');
    for (const id of SKINS.filter((x) => SHOP[x].limit)) {
      const limit = SHOP[id].limit!, held = new Map<number, Player>();
      for (const p of v?.players ?? []) for (const o of p.owned) if (o.item === id && o.serial) held.set(o.serial, p);
      box.append(el('h4', '', `${SHOP[id].name}: ${held.size} of ${limit} held, ${limit - held.size} left`));
      const grid = el('div', 'adm-store-grid');
      for (let n = 1; n <= limit; n++) {
        const p = held.get(n), c = el('button', p ? `held ${SHOP[id].skin!.finish}` : '', String(n));
        c.type = 'button';
        c.title = p ? `No. ${n}: ${p.name || 'no name'} (${p.acct})` : `No. ${n}: free`;
        if (p) c.onclick = () => ((this.page = 'players'), (this.find = p.acct), (this.managing = p.acct), this.n++, this.h.redraw());
        grid.append(c);
      }
      box.append(grid);
    }
    return box;
  }

  /** a purchase given by hand: to a player online by their number (#12), or to an account */
  private grantForm() {
    const { el, button } = this.h;
    const f = el('div', 'adm-store-grant');
    const who = el('input');
    who.placeholder = '#12, or an account';
    who.value = this.grant.acct;
    who.dataset.k = 'store-who';
    who.oninput = () => (this.grant.acct = who.value.trim());
    const what = el('select');
    for (const id of ITEM_IDS) {
      const o = el('option', '', SHOP[id].name);
      o.value = id;
      o.selected = id === this.grant.item;
      what.append(o);
    }
    what.onchange = () => ((this.grant.item = what.value as ItemId), this.n++, this.h.redraw());
    f.append(el('span', '', 'Give by hand'), who, what);
    if (SHOP[this.grant.item].days) {
      const days = el('input');
      days.type = 'number';
      days.min = '1';
      days.value = this.grant.days;
      days.dataset.k = 'store-days';
      days.oninput = () => (this.grant.days = days.value);
      f.append(days, el('span', '', 'days'));
    }
    f.append(button('Give', () => {
      if (!/^(#\d+|[0-9a-f]{24})$/.test(this.grant.acct)) return void ((this.why = 'Give it to #their number, or to an account (24 letters and numbers, from a purchase).'), this.n++, this.h.redraw());
      this.send({ act: 'grant', acct: this.grant.acct, item: this.grant.item, ...(SHOP[this.grant.item].days ? { days: Number(this.grant.days) || 30 } : {}) });
    }, 'small good', 'star'));
    return f;
  }

  private vips(v: StoreView) {
    const { el, button } = this.h;
    const t = el('div', 'adm-table store-vips');
    const head = el('div', 'adm-tr head');
    for (const x of ['VIP', 'Discord', 'Until', 'Role']) head.append(el('span', '', x));
    t.append(head);
    for (const p of v.vips) {
      const r = el('div', 'adm-tr');
      const left = Math.ceil((p.until - Date.now()) / 86_400_000);
      r.append(el('span', '', p.name || short(p.acct)), el('span', '', p.discord || '—'), el('span', left <= 3 ? 'adm-store-soon' : '', `${new Date(p.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} (${left} d)`));
      const role = el('span');
      if (p.id) role.append(button(p.role ? 'Given' : 'Not yet', () => this.send({ act: 'role', id: p.id, on: !p.role }), `small${p.role ? ' good' : ''}`));
      r.append(role);
      t.append(r);
    }
    return t;
  }

  private rows(rows: Row[]) {
    const { el, button, grave } = this.h;
    const t = el('div', 'adm-table store-rows');
    const head = el('div', 'adm-tr head');
    for (const x of ['When', 'Player', 'What', 'Paid', 'From', 'How', 'Status', '']) head.append(el('span', '', x));
    t.append(head);
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
      if (this.moving === p.id) {
        const to = el('input');
        to.placeholder = '#12, or an account';
        to.dataset.k = `move:${p.id}`;
        acts.append(to, button('Move', () => this.send({ act: 'move', id: p.id, acct: to.value.trim() }), 'small'), button('', () => ((this.moving = ''), this.n++, this.h.redraw()), 'small', 'x'));
      } else {
        if (p.status === 'look') acts.append(button('Pass', () => this.send({ act: 'set', id: p.id, status: 'ok' }), 'small good'));
        if (p.status === 'ok') acts.append(grave(`revoke:${p.id}`, 'Revoke', () => this.send({ act: 'set', id: p.id, status: 'revoked' })));
        if (p.status === 'ok' || p.status === 'look') acts.append(grave(`refund:${p.id}`, 'Refunded', () => this.send({ act: 'set', id: p.id, status: 'refunded' })));
        if (p.status === 'revoked' || p.status === 'refunded') acts.append(button('Restore', () => this.send({ act: 'set', id: p.id, status: 'ok' }), 'small'));
        acts.append(button('Move', () => ((this.moving = p.id), this.n++, this.h.redraw()), 'small'));
        for (const b of acts.children) b.classList.add('small');
      }
      r.append(el('span', '', when(p.at)), who, what, paid, from, el('span', '', HOW[p.how]), status, acts);
      t.append(r);
    }
    if (!rows.length) t.append(el('div', 'adm-none', this.view ? 'Nothing bought yet.' : ''));
    return t;
  }
}
