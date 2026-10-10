// The trader's counter: what you have that he will take, and what he has to sell.
// One click sells a thing or buys one. Everything it does it asks of the game (`ShopHost`):
// it holds nothing itself but what is on the screen.

import { ITEMS, itemName, type ItemInstance } from '../sim/items';

export interface ShopHost {
  /** what is written against your name in his book */
  credit(): number;
  /** what you carry that he will take, and what he pays for each */
  wares(): { item: ItemInstance; pays: number }[];
  /** what he sells, and what he asks */
  /** (`left`: how many more of it he will sell this player today) */
  stock(): { id: string; asks: number; left: number }[];
  /** the day's work: each job, how much of it is done, and whether it has been paid */
  jobs(): { id: string; text: string; n: number; have: number; pays: number; paid: boolean }[];
  /** null if it was paid; else why not */
  handIn(id: string): string | null;
  /** picture of a thing, if there is one yet */
  icon(id: string): string | undefined;
  sell(item: ItemInstance): void;
  /** false if it could not be bought (no credit, or nowhere to put it) */
  buy(id: string): string | null;
  closed(): void;
}

const CSS = `
.shop { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center; background: rgba(6, 8, 6, 0.72); font-family: 'Barlow Condensed', system-ui, sans-serif; color: #e9e4d8; }
.shop.on { display: flex; }
.shop-box { width: min(1040px, 94vw); max-height: 90vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; background: rgba(14, 17, 13, 0.96); border: 1px solid rgba(233, 228, 216, 0.16); box-shadow: 0 30px 90px #000; }
.shop-top { display: flex; align-items: baseline; gap: 18px; padding: 16px 22px 12px; border-bottom: 1px solid rgba(233, 228, 216, 0.14); }
.shop-top h2 { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.shop-top p { margin: 0; font-size: 17px; color: rgba(233, 228, 216, 0.6); }
.shop-credit { margin-left: auto; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(233, 228, 216, 0.6); }
.shop-credit b { margin-left: 8px; font-size: 22px; letter-spacing: 0.04em; color: #ffd35a; }
.shop-cols { display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
.shop-col { min-height: 0; overflow-y: auto; padding: 12px 16px 16px; }
.shop-col + .shop-col { border-left: 1px solid rgba(233, 228, 216, 0.14); }
.shop-col h3 { margin: 0 0 8px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(233, 228, 216, 0.5); }
.shop-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; padding: 5px 10px 5px 6px; margin: 0 0 4px; font: inherit; color: inherit; text-align: left; background: rgba(233, 228, 216, 0.04); border: 1px solid transparent; cursor: pointer; }
.shop-row:hover { border-color: #ffd35a; background: rgba(255, 211, 90, 0.07); }
.shop-row[disabled] { opacity: 0.38; cursor: default; }
.shop-row[disabled]:hover { border-color: transparent; background: rgba(233, 228, 216, 0.04); }
.shop-row i { width: 44px; height: 34px; background: center / contain no-repeat; }
.shop-row span { font-size: 19px; line-height: 1.1; }
.shop-row small { display: block; font-size: 14px; color: rgba(233, 228, 216, 0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shop-row b { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 15px; font-weight: 500; color: #ffd35a; }
.shop-jobs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px 16px; border-bottom: 1px solid rgba(233, 228, 216, 0.14); }
.shop-jobs h3 { grid-column: 1 / -1; margin: 0; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(233, 228, 216, 0.5); }
.shop-job { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 9px 12px 10px; background: rgba(233, 228, 216, 0.04); border-left: 3px solid rgba(233, 228, 216, 0.2); }
.shop-job.ready { border-left-color: #ffd35a; }
.shop-job.paid { opacity: 0.45; }
.shop-job span { font-size: 19px; line-height: 1.15; }
.shop-job em { grid-column: 1; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; font-style: normal; letter-spacing: 0.08em; color: rgba(233, 228, 216, 0.55); }
.shop-job em b { color: #ffd35a; font-weight: 500; }
.shop-job button { grid-column: 2; grid-row: 1 / 3; padding: 5px 12px 6px; font: inherit; font-size: 16px; letter-spacing: 0.06em; text-transform: uppercase; color: #14160f; background: #ffd35a; border: 0; cursor: pointer; }
.shop-job button[disabled] { color: rgba(233, 228, 216, 0.5); background: rgba(233, 228, 216, 0.1); cursor: default; }
.shop-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 10px; }
.shop-tabs button { padding: 4px 10px 5px; font: inherit; font-size: 16px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(233, 228, 216, 0.7); background: rgba(233, 228, 216, 0.05); border: 1px solid transparent; cursor: pointer; }
.shop-tabs button:hover { border-color: rgba(233, 228, 216, 0.4); }
.shop-tabs button.on { color: #14160f; background: #ffd35a; }
.shop-tabs button small { margin-left: 5px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; opacity: 0.7; }
.shop-none { padding: 18px 6px; font-size: 18px; color: rgba(233, 228, 216, 0.5); }
.shop-foot { display: flex; gap: 18px; align-items: center; padding: 10px 22px 12px; font-size: 16px; color: rgba(233, 228, 216, 0.55); border-top: 1px solid rgba(233, 228, 216, 0.14); }
.shop-say { color: #e9e4d8; }
.shop-foot kbd { padding: 1px 6px 2px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; border: 1px solid rgba(233, 228, 216, 0.3); }
.shop-foot button { margin-left: auto; padding: 5px 16px 6px; font: inherit; font-size: 17px; letter-spacing: 0.08em; text-transform: uppercase; color: #14160f; background: #ffd35a; border: 0; cursor: pointer; }
@media (max-width: 760px) { .shop-jobs { grid-template-columns: 1fr; } .shop-cols { grid-template-columns: 1fr; overflow-y: auto; } .shop-col { overflow: visible; } .shop-col + .shop-col { border-left: 0; border-top: 1px solid rgba(233, 228, 216, 0.14); } .shop-top p { display: none; } }
`;

/** the sorts his stock is shown under, and the kinds of thing each takes in */
const TABS: { key: string; name: string; has: string[] }[] = [
  { key: 'ammo', name: 'Ammo', has: ['ammo'] },
  { key: 'medical', name: 'Medical', has: ['medical'] },
  { key: 'food', name: 'Food & drink', has: ['food', 'drink'] },
  { key: 'gear', name: 'Gear', has: ['clothing', 'tool', 'attachment'] },
  { key: 'other', name: 'Other', has: ['misc', 'stash', 'weapon', 'melee'] },
];

export class ShopUI {
  isOpen = false;
  private el: HTMLElement;
  private said = '';
  private openedAt = 0;
  /** which sort of his stock is shown */
  private tab = 'all';

  constructor(private host: ShopHost) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'shop';
    document.body.appendChild(this.el);
    // (a click on the dark round it puts it away, as a click off any panel does)
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    // F and Tab put it away as they put the inventory away (not the press that opened it, held down)
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.repeat || performance.now() - this.openedAt < 250) return;
      if (e.code !== 'KeyF' && e.code !== 'Tab') return;
      e.preventDefault();
      this.close();
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.openedAt = performance.now();
    this.said = 'Put it on the counter. I pay what it is worth here, not what it cost you to get.';
    this.el.classList.add('on');
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on');
    this.host.closed();
  }

  private render() {
    const h = this.host, credit = h.credit();
    // (what is worth most to him first: it is what somebody came to sell)
    const wares = h.wares().sort((a, b) => b.pays - a.pays), stock = h.stock();
    const row = (kind: string, key: string, id: string, title: string, sub: string, price: string, off = false) =>
      `<button class="shop-row" data-${kind}="${key}"${off ? ' disabled' : ''}><i style="${h.icon(id) ? `background-image:url(${h.icon(id)})` : ''}"></i><span>${title}<small>${sub}</small></span><b>${price}</b></button>`;
    const mine = wares.length
      ? wares.map((w, i) => row('sell', String(i), w.item.id, itemName(w.item) + (ITEMS[w.item.id].stack ? ` ×${w.item.qty ?? 1}` : ''), ITEMS[w.item.id].category, `+${w.pays}`)).join('')
      : '<div class="shop-none">Nothing on you that he deals in.</div>';
    // his stock by sort: what somebody came for is one click away
    const sortOf = (id: string) => TABS.find((t) => t.has.includes(ITEMS[id].category))?.key ?? 'other';
    const tabs = [{ key: 'all', name: 'All', n: stock.length }, ...TABS.map((t) => ({ key: t.key, name: t.name, n: stock.filter((x) => sortOf(x.id) === t.key).length }))].filter((t) => t.n);
    if (!tabs.some((t) => t.key === this.tab)) this.tab = 'all';
    const tabRow = `<div class="shop-tabs">${tabs.map((t) => `<button data-sort="${t.key}"${t.key === this.tab ? ' class="on"' : ''}>${t.name}<small>${t.n}</small></button>`).join('')}</div>`;
    const his = tabRow + stock.filter((x) => this.tab === 'all' || sortOf(x.id) === this.tab).map((s) => row('buy', s.id, s.id, ITEMS[s.id].name + ((ITEMS[s.id].stack ?? 1) > 1 ? ` ×${ITEMS[s.id].stack}` : ''), s.left > 0 ? `${s.left} left today · ${ITEMS[s.id].desc ?? ''}` : 'None left today: he sells so many a day', String(s.asks), s.asks > credit || s.left <= 0)).join('');
    const jobs = h.jobs();
    const work = jobs
      .map((j) => {
        const ready = !j.paid && j.have >= j.n;
        return `<div class="shop-job${j.paid ? ' paid' : ready ? ' ready' : ''}"><span>${j.text}</span><em>${j.paid ? 'Paid' : `${j.have} of ${j.n}`} · pays <b>${j.pays}</b></em><button data-job="${j.id}"${ready ? '' : ' disabled'}>${j.paid ? 'Done' : 'Hand in'}</button></div>`;
      })
      .join('');
    this.el.innerHTML = `<div class="shop-box">
      <div class="shop-top"><h2>The trader</h2><p>He buys what you bring and sells what keeps you alive. No tags, no keycards.</p><div class="shop-credit">Your credit<b>${credit}</b></div></div>
      <div class="shop-jobs"><h3>Work he has today · the same for everybody, new at midnight UTC</h3>${work}</div>
      <div class="shop-cols"><div class="shop-col"><h3>You sell · click a thing to sell it</h3>${mine}</div><div class="shop-col"><h3>He sells · click to buy</h3>${his}</div></div>
      <div class="shop-foot"><span class="shop-say">“${this.said}”</span><span><kbd>F</kbd> or <kbd>Esc</kbd> to leave</span><button data-close>Done</button></div>
    </div>`;
    this.el.querySelectorAll<HTMLElement>('[data-sell]').forEach((b) => {
      b.onclick = () => {
        const w = wares[Number(b.dataset.sell)];
        if (!w) return;
        h.sell(w.item);
        this.said = `${w.pays} for the ${itemName(w.item).toLowerCase()}. It is in the book.`;
        this.render();
      };
    });
    this.el.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.buy!;
        const no = h.buy(id);
        this.said = no ?? `One ${ITEMS[id].name.toLowerCase()}. Mind how you go.`;
        this.render();
      };
    });
    this.el.querySelectorAll<HTMLElement>('[data-job]').forEach((b) => {
      b.onclick = () => {
        const job = jobs.find((j) => j.id === b.dataset.job);
        if (!job) return;
        const no = h.handIn(job.id);
        this.said = no ?? `That is the job done. ${job.pays} in the book.`;
        this.render();
      };
    });
    this.el.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.sort!;
        this.render();
      };
    });
    this.el.querySelector<HTMLElement>('[data-close]')!.onclick = () => this.close();
  }
}
