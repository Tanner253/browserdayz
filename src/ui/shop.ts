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
  stock(): { id: string; asks: number }[];
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
.shop-box { width: min(1040px, 94vw); max-height: 88vh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: rgba(14, 17, 13, 0.96); border: 1px solid rgba(233, 228, 216, 0.16); box-shadow: 0 30px 90px #000; }
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
.shop-none { padding: 18px 6px; font-size: 18px; color: rgba(233, 228, 216, 0.5); }
.shop-foot { display: flex; gap: 18px; align-items: center; padding: 10px 22px 12px; font-size: 16px; color: rgba(233, 228, 216, 0.55); border-top: 1px solid rgba(233, 228, 216, 0.14); }
.shop-say { color: #e9e4d8; }
.shop-foot kbd { padding: 1px 6px 2px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; border: 1px solid rgba(233, 228, 216, 0.3); }
.shop-foot button { margin-left: auto; padding: 5px 16px 6px; font: inherit; font-size: 17px; letter-spacing: 0.08em; text-transform: uppercase; color: #14160f; background: #ffd35a; border: 0; cursor: pointer; }
@media (max-width: 760px) { .shop-cols { grid-template-columns: 1fr; overflow-y: auto; } .shop-col { overflow: visible; } .shop-col + .shop-col { border-left: 0; border-top: 1px solid rgba(233, 228, 216, 0.14); } .shop-top p { display: none; } }
`;

export class ShopUI {
  isOpen = false;
  private el: HTMLElement;
  private said = '';

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
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
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
    const wares = h.wares(), stock = h.stock();
    const row = (kind: string, key: string, id: string, title: string, sub: string, price: string, off = false) =>
      `<button class="shop-row" data-${kind}="${key}"${off ? ' disabled' : ''}><i style="${h.icon(id) ? `background-image:url(${h.icon(id)})` : ''}"></i><span>${title}<small>${sub}</small></span><b>${price}</b></button>`;
    const mine = wares.length
      ? wares.map((w, i) => row('sell', String(i), w.item.id, itemName(w.item) + (ITEMS[w.item.id].stack ? ` ×${w.item.qty ?? 1}` : ''), ITEMS[w.item.id].category, `+${w.pays}`)).join('')
      : '<div class="shop-none">Nothing on you that he deals in.</div>';
    const his = stock.map((s) => row('buy', s.id, s.id, ITEMS[s.id].name + ((ITEMS[s.id].stack ?? 1) > 1 ? ` ×${ITEMS[s.id].stack}` : ''), ITEMS[s.id].desc ?? '', String(s.asks), s.asks > credit)).join('');
    this.el.innerHTML = `<div class="shop-box">
      <div class="shop-top"><h2>The trader</h2><p>He buys what you bring and sells what keeps you alive. No tags, no keycards.</p><div class="shop-credit">Your credit<b>${credit}</b></div></div>
      <div class="shop-cols"><div class="shop-col"><h3>You sell · click a thing to sell it</h3>${mine}</div><div class="shop-col"><h3>He sells · click to buy</h3>${his}</div></div>
      <div class="shop-foot"><span class="shop-say">“${this.said}”</span><button data-close>Done</button></div>
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
    this.el.querySelector<HTMLElement>('[data-close]')!.onclick = () => this.close();
  }
}
