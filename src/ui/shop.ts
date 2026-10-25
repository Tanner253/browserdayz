// A stall's counter at the trader camp (progression v3: "a trader camp with four stalls ... Paid in scrap"): what you
// carry that it will take, and what it has to sell, for scrap, so many a day; at the shop, the day's work. One click
// sells a thing or buys one. Everything it does it asks of the camp (`ShopHost`, src/game/camp.ts), whose answer may
// come from the server: the screen waits for it, and holds nothing itself but what is on it.

import { ITEMS, itemName, type ItemInstance } from '../sim/items';

type Answer = string | null | Promise<string | null>;

export interface ShopHost {
  /** the stall whose counter this is */
  stall(): { id: string; name: string; hello: string };
  /** the scrap carried */
  scrap(): number;
  /** what you carry that this stall takes, and what it pays for each */
  wares(): { item: ItemInstance; pays: number }[];
  /** how much more scrap it will pay out today, over every stall */
  soldLeft(): number;
  /** what it sells: how many a sale hands over, the price, and how many more sales of it today */
  stock(): { id: string; n: number; price: number; left: number }[];
  /** the day's work (the shop's): each job, how much of it is done, and whether it has been paid */
  jobs(): { id: string; text: string; n: number; have: number; pays: number; paid: boolean }[];
  /** picture of a thing, if there is one yet */
  icon(id: string): string | undefined;
  /** each: null if it was done (or what the trader says), else why not */
  buy(id: string): Answer;
  sell(item: ItemInstance): Answer;
  handIn(id: string): Answer;
  closed(): void;
}

const CSS = `
.shop { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center; background: rgba(6, 8, 6, 0.72); font-family: 'Barlow Condensed', system-ui, sans-serif; color: #e9e4d8; }
.shop.on { display: flex; }
.shop-box { width: min(1040px, 94vw); max-height: 90vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; background: rgba(14, 17, 13, 0.96); border: 1px solid rgba(233, 228, 216, 0.16); box-shadow: 0 30px 90px #000; }
.shop-top { display: flex; align-items: baseline; gap: 18px; padding: 16px 22px 12px; border-bottom: 1px solid rgba(233, 228, 216, 0.14); }
.shop-top h2 { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.shop-top p { margin: 0; font-size: 17px; color: rgba(233, 228, 216, 0.6); }
.shop-credit { margin-left: auto; display: flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(233, 228, 216, 0.6); }
.shop-credit b { margin-left: 2px; font-size: 22px; letter-spacing: 0.04em; color: #ffd35a; }
.shop-credit i, .shop-row b i { display: inline-block; width: 18px; height: 18px; vertical-align: -3px; margin-right: 3px; background: center / contain no-repeat; }
.shop-row b i { width: 15px; height: 15px; }
.shop.busy .shop-row, .shop.busy .shop-job button { pointer-events: none; opacity: 0.6; }
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
.shop-none { padding: 18px 6px; font-size: 18px; color: rgba(233, 228, 216, 0.5); }
.shop-foot { display: flex; gap: 18px; align-items: center; padding: 10px 22px 12px; font-size: 16px; color: rgba(233, 228, 216, 0.55); border-top: 1px solid rgba(233, 228, 216, 0.14); }
.shop-say { color: #e9e4d8; }
.shop-foot kbd { padding: 1px 6px 2px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; border: 1px solid rgba(233, 228, 216, 0.3); }
.shop-foot button { margin-left: auto; padding: 5px 16px 6px; font: inherit; font-size: 17px; letter-spacing: 0.08em; text-transform: uppercase; color: #14160f; background: #ffd35a; border: 0; cursor: pointer; }
@media (max-width: 760px) { .shop-jobs { grid-template-columns: 1fr; } .shop-cols { grid-template-columns: 1fr; overflow-y: auto; } .shop-col { overflow: visible; } .shop-col + .shop-col { border-left: 0; border-top: 1px solid rgba(233, 228, 216, 0.14); } .shop-top p { display: none; } }
`;

export class ShopUI {
  isOpen = false;
  private el: HTMLElement;
  private said = '';
  private openedAt = 0;
  /** waiting for the server's answer to a trade */
  private busy = false;

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
    this.said = this.host.stall().hello;
    this.el.classList.add('on');
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on');
    this.host.closed();
  }

  /** drawn again (the day told, the pockets changed) */
  refresh() {
    if (this.isOpen) this.render();
  }

  /** a trade asked: the screen waits for the answer, says it, and is drawn again */
  private act(answer: Answer, done: (no: string | null) => string) {
    if (this.busy) return;
    if (!(answer instanceof Promise)) {
      this.said = done(answer);
      return this.render();
    }
    this.busy = true;
    this.el.classList.add('busy');
    void answer.then((no) => {
      this.busy = false;
      this.el.classList.remove('busy');
      this.said = done(no);
      this.render();
    });
  }

  private render() {
    const h = this.host, scrap = h.scrap(), st = h.stall(), coin = `<i style="background-image:url(${h.icon('scrap') ?? ''})"></i>`;
    // (what is worth most to it first: it is what somebody came to sell)
    const wares = h.wares().sort((a, b) => b.pays - a.pays), stock = h.stock(), left = h.soldLeft();
    const row = (kind: string, key: string, id: string, title: string, sub: string, price: string, off = false) =>
      `<button class="shop-row" data-${kind}="${key}"${off ? ' disabled' : ''}><i style="${h.icon(id) ? `background-image:url(${h.icon(id)})` : ''}"></i><span>${title}<small>${sub}</small></span><b>${price}</b></button>`;
    const mine = wares.length
      ? wares.map((w, i) => row('sell', String(i), w.item.id, itemName(w.item) + (ITEMS[w.item.id].stack ? ` ×${w.item.qty ?? 1}` : ''), ITEMS[w.item.id].category, `+${coin}${Math.min(w.pays, left)}`, left <= 0)).join('')
      : '<div class="shop-none">Nothing on you that this stall deals in.</div>';
    const his = stock.map((s) => row('buy', s.id, s.id, ITEMS[s.id].name + (s.n > 1 ? ` ×${s.n}` : ''), s.left > 0 ? `${s.left} left today · ${ITEMS[s.id].desc ?? ''}` : 'None left today: so many a day', `${coin}${s.price}`, s.price > scrap || s.left <= 0)).join('');
    const jobs = h.jobs();
    const work = jobs
      .map((j) => {
        const ready = !j.paid && j.have >= j.n;
        return `<div class="shop-job${j.paid ? ' paid' : ready ? ' ready' : ''}"><span>${j.text}</span><em>${j.paid ? 'Paid' : `${j.have} of ${j.n}`} · pays <b>${j.pays}</b> scrap</em><button data-job="${j.id}"${ready ? '' : ' disabled'}>${j.paid ? 'Done' : 'Hand in'}</button></div>`;
      })
      .join('');
    this.el.innerHTML = `<div class="shop-box">
      <div class="shop-top"><h2>${st.name}</h2><p>The trader camp · no shooting here</p><div class="shop-credit">Your scrap ${coin}<b>${scrap}</b></div></div>
      ${jobs.length ? `<div class="shop-jobs"><h3>Work today · the same for everybody, new at midnight UTC · paid in scrap</h3>${work}</div>` : ''}
      <div class="shop-cols"><div class="shop-col"><h3>You sell · ${left > 0 ? `he pays out ${left} more scrap today` : 'he pays out no more today'}</h3>${mine}</div><div class="shop-col"><h3>He sells · for scrap, so many a day</h3>${his}</div></div>
      <div class="shop-foot"><span class="shop-say">“${this.said}”</span><span><kbd>F</kbd> or <kbd>Esc</kbd> to leave</span><button data-close>Done</button></div>
    </div>`;
    this.el.querySelectorAll<HTMLElement>('[data-sell]').forEach((b) => {
      b.onclick = () => {
        const w = wares[Number(b.dataset.sell)];
        if (w) this.act(h.sell(w.item), (no) => no ?? `${Math.min(w.pays, left)} for the ${itemName(w.item).toLowerCase()}.`);
      };
    });
    this.el.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.buy!;
        this.act(h.buy(id), (no) => no ?? `${ITEMS[id].name}. Mind how you go.`);
      };
    });
    this.el.querySelectorAll<HTMLElement>('[data-job]').forEach((b) => {
      b.onclick = () => {
        const job = jobs.find((j) => j.id === b.dataset.job);
        if (job) this.act(h.handIn(job.id), (no) => no ?? `That is the job done. ${job.pays} scrap.`);
      };
    });
    this.el.querySelector<HTMLElement>('[data-close]')!.onclick = () => this.close();
  }
}
