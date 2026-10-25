// The store (2026-10-22): what is for sale, and paying for it with no wallet connected. The owner: "there is no wallet
// connect or anything so well have to ask the user to validate the payment some how". So the site quotes a price in SOL
// with last digits of its own and a code a phone's wallet scans; the player sends it from any wallet and presses
// "I've paid", and the site finds the payment on chain (api/store.ts). The quote being paid is kept in this browser, so
// a reload or a closed tab loses nothing.

import './store.css';
import qrcode from 'qrcode-generator';
import { COFFEE, SHOP, type ItemId, type Perks } from '../../../api/_lib/shop-items';
import { playerName } from '../../net/client';
import { BOUGHT, bought, myAcct, myStore, setPerks, type StoreView } from './account';

/** (the same invite as the menu's, src/ui/hud.ts: that file is the whole HUD, too much to load for a link) */
const DISCORD = 'https://discord.com/invite/8ECdSH2vWE';
const PENDING = 'zona.store.pending';

interface Quote {
  token: string; item: ItemId; usd: number; rate: number; lamports: number; sol: string; wallet: string; reference: string; url: string; until: number;
  discord?: string; note?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (usd: number) => `$${usd % 1 ? usd.toFixed(2) : usd}`;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const daysLeft = (until: number) => Math.max(1, Math.ceil((until - Date.now()) / 86_400_000));

let el: HTMLElement | null = null;
let tick = 0;

function pending(): Quote | null {
  try {
    const q = JSON.parse(localStorage.getItem(PENDING) ?? 'null') as Quote | null;
    // (a quote a day old is no longer looked for: its payment, if any, is the admin's to find)
    return q && q.until > Date.now() - 86_400_000 ? q : null;
  } catch {
    return null;
  }
}
function keep(q: Quote | null) {
  try {
    if (q) localStorage.setItem(PENDING, JSON.stringify(q));
    else localStorage.removeItem(PENDING);
  } catch {
    /* no storage: the quote lives while the page does */
  }
}

export function closeStore() {
  clearInterval(tick);
  el?.remove();
  el = null;
}

export async function openStore() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'store';
  el.addEventListener('click', (e) => e.target === el && closeStore());
  document.body.appendChild(el);
  const q = pending();
  if (q) pay(q);
  else list(await myStore());
}

addEventListener('keydown', (e) => {
  if (el && e.key === 'Escape') closeStore();
});

function frame(inner: string, me = '') {
  el!.innerHTML = `<div class="st-in" role="dialog" aria-label="Store">
    <header class="st-top"><b>STORE</b>${me}<button type="button" class="st-x" aria-label="Close">&times;</button></header>
    ${inner}
    <footer class="st-foot">Priced in dollars, paid in SOL from any wallet. Payments are read on the Solana chain: nothing is connected to your wallet. Bought in this browser, for the character it plays<span class="st-acct"></span>. Trouble? <a href="${DISCORD}" target="_blank" rel="noopener noreferrer">Discord</a></footer>
  </div>`;
  (el!.querySelector('.st-x') as HTMLElement).onclick = closeStore;
  // (the account it is all kept under, for whoever asks on Discord: an admin moves a purchase by it)
  void myAcct().then((a) => el?.querySelector('.st-acct') && (el.querySelector('.st-acct')!.textContent = ` (account ${a})`));
}

function list(v: StoreView) {
  clearInterval(tick);
  const p = v.perks;
  const now = Date.now(), vip = p.vip > now;
  const me = vip ? `<span class="st-vip">VIP · ${daysLeft(p.vip)} days left</span>` : '';
  const owned = (id: ItemId) => p.skins.includes(id);
  // (each finish sold is numbered, to be minted as its own later; the gold ones are a hundred each and no more)
  const serial = (id: ItemId) => v.rows.find((r) => r.item === id && r.status === 'ok')?.serial;
  const left = (id: ItemId) => v.stock[id];
  const skin = (id: ItemId) => {
    const it = SHOP[id], n = serial(id), l = left(id);
    const act = owned(id) ? `<span class="st-owned">Yours${n ? ` · No. ${n}` : ''}</span>` : l === 0 ? '<span class="st-sold">Sold out</span>' : `<button type="button" class="st-buy" data-buy="${id}">Buy</button>`;
    return `<article class="st-card skin ${it.skin!.finish}">
      <img src="/shop/${id}.jpg" alt="" loading="lazy" onerror="this.remove()"><i class="st-swatch"></i>
      <h3>${it.name}</h3><p>${it.say}</p>
      ${it.limit ? `<p class="st-limit">Limited: ${l === undefined ? it.limit : l} of ${it.limit} left${n ? '' : ', each numbered'}</p>` : ''}
      <div class="st-row"><b class="st-price">${money(it.usd)}</b>${act}</div>
    </article>`;
  };
  frame(`
    <p class="st-lead">Cosmetic and convenience only: nothing here helps anybody win a fight.</p>
    <div class="st-grid">
      <article class="st-card vip">
        <h3>VIP <em>30 days</em></h3>
        <ul>
          <li><b>Queue pass:</b> to the front of the line when the server is full</li>
          <li><b class="st-purple">[VIP]</b> in purple by your name in chat and on the board</li>
          <li><b>Discord:</b> the VIP role and channel</li>
          <li><b>No ads</b> on the site or in the game's menus</li>
          <li><b>Gold dog tag:</b> the tag a killer takes from you is gold-plated (only its look changes)</li>
        </ul>
        <label class="st-field">Your Discord name, for the role <input name="discord" maxlength="40" placeholder="optional" autocomplete="off"></label>
        <figure class="st-tagpic"><img src="/shop/vip_tag.jpg" alt="A survivor wearing the gold dog tag on the chest, over a vest" loading="lazy" onerror="this.parentElement.remove()"><figcaption>The gold dog tag, as others see you wear it</figcaption></figure>
        <div class="st-row"><b class="st-price">${money(SHOP.vip.usd)}<small> / 30 days</small></b><button type="button" class="st-buy" data-buy="vip">${vip ? 'Add 30 days' : 'Buy VIP'}</button></div>
        ${vip ? `<p class="st-small">Runs to ${day(p.vip)}. Each payment adds 30 days; nothing renews by itself.</p>` : '<p class="st-small">Not a subscription: each payment adds 30 days.</p>'}
      </article>
      ${skin('deagle_gold')}
      <div class="st-more">${(['m9_nickel', 'colt_nickel'] as ItemId[]).map(skin).join('')}</div>
      <h2 class="st-head">Knives <em>a finish goes on any knife you carry</em></h2>
      <div class="st-more">${(['knife_emerald', 'knife_ruby', 'knife_gold', 'knife_damascus', 'knife_carbon', 'knife_nightcamo'] as ItemId[]).map(skin).join('')}</div>
      <article class="st-card noads">
        <h3>No ads <em>30 days</em></h3><p>${SHOP.noads.say}</p>
        <div class="st-row"><b class="st-price">${money(SHOP.noads.usd)}</b>${vip ? '<span class="st-owned">With VIP</span>' : `<button type="button" class="st-buy" data-buy="noads">${p.noads > now ? 'Add 30 days' : 'Buy'}</button>`}</div>
      </article>
      <article class="st-card coffee">
        <h3>Buy the dev a coffee</h3><p>${SHOP.coffee.say}</p>
        <div class="st-chips">${COFFEE.picks.map((n, i) => `<button type="button" data-usd="${n}"${i === 1 ? ' class="on"' : ''}>$${n}</button>`).join('')}<label>$<input name="usd" type="number" min="${COFFEE.min}" max="${COFFEE.max}" step="1" placeholder="other"></label></div>
        <input class="st-note" name="note" maxlength="120" placeholder="A note for the dev (optional)">
        <div class="st-row"><span></span><button type="button" class="st-buy" data-buy="coffee">Buy a coffee</button></div>
      </article>
    </div>`, me);
  let usd = COFFEE.picks[1];
  const chips = el!.querySelectorAll<HTMLButtonElement>('[data-usd]'), own = el!.querySelector('input[name="usd"]') as HTMLInputElement;
  chips.forEach((c) => (c.onclick = () => (chips.forEach((x) => x.classList.toggle('on', x === c)), (own.value = ''), (usd = Number(c.dataset.usd)))));
  own.oninput = () => (chips.forEach((x) => x.classList.remove('on')), (usd = Number(own.value) || COFFEE.picks[1]));
  el!.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
    b.onclick = async () => {
      const item = b.dataset.buy as ItemId;
      b.disabled = true;
      b.textContent = 'Pricing…';
      try {
        const r = await fetch('/api/store', { method: 'POST', body: JSON.stringify({ op: 'quote', item, acct: await myAcct(), usd: item === 'coffee' ? usd : undefined }) });
        const q = (await r.json()) as Quote & { ok: boolean; why?: string };
        if (!q.ok) throw new Error(q.why ?? 'The store could not be reached.');
        if (item === 'vip') q.discord = (el!.querySelector('input[name="discord"]') as HTMLInputElement).value.trim();
        if (item === 'coffee') q.note = (el!.querySelector('input[name="note"]') as HTMLInputElement).value.trim();
        keep(q);
        pay(q);
      } catch (e) {
        b.disabled = false;
        b.textContent = (e as Error).message.slice(0, 60) || 'Try again';
      }
    };
  });
}

function qrSvg(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function pay(q: Quote) {
  const it = SHOP[q.item];
  frame(`<div class="st-pay">
    <button type="button" class="st-back">&larr; Store</button>
    <h3>${it.name}${it.days ? ` <em>${it.days} days</em>` : ''} <b class="st-price">${money(q.usd)}</b></h3>
    <div class="st-paygrid">
      <div class="st-steps">
        <span class="st-label">1 · Send exactly</span>
        <button type="button" class="st-copy" data-copy="${q.sol}"><code>${q.sol}</code> SOL<i>Copy</i></button>
        <span class="st-label">2 · To the store's wallet</span>
        <button type="button" class="st-copy" data-copy="${q.wallet}"><code>${q.wallet}</code><i>Copy</i></button>
        <p class="st-small">At $${q.rate.toFixed(2)} a SOL, held for <b class="st-left"></b>. Send that amount <b>exactly</b>: its last digits are how this payment is known to be yours. Any wallet: Phantom, Solflare, an exchange.</p>
        <a class="st-open" href="${esc(q.url)}">Open in my wallet app</a>
      </div>
      <figure class="st-qr">${qrSvg(q.url)}<figcaption>On a phone: scan with your wallet</figcaption></figure>
    </div>
    <div class="st-check"><span class="st-label">3 ·</span><button type="button" class="st-paid">I've paid</button><span class="st-say" role="status"></span></div>
    <details class="st-sig"><summary>Sent another amount, or it is not found? Paste the transaction's signature</summary>
      <div class="st-row"><input name="sig" maxlength="100" placeholder="Transaction signature" autocomplete="off" spellcheck="false"><button type="button" class="st-sigb">Check</button></div></details>
    <button type="button" class="st-drop">Cancel this price</button>
  </div>`);
  const left = el!.querySelector('.st-left') as HTMLElement, say = el!.querySelector('.st-say') as HTMLElement;
  const count = () => {
    const s = Math.round((q.until - Date.now()) / 1000);
    left.textContent = s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'no longer (a payment sent now is checked by hand)';
  };
  count();
  clearInterval(tick);
  tick = window.setInterval(count, 1000);
  el!.querySelectorAll<HTMLButtonElement>('.st-copy').forEach((b) => {
    b.onclick = () => void navigator.clipboard?.writeText(b.dataset.copy!).then(() => ((b.querySelector('i')!.textContent = 'Copied'), setTimeout(() => b.isConnected && (b.querySelector('i')!.textContent = 'Copy'), 1500)));
  });
  (el!.querySelector('.st-back') as HTMLElement).onclick = async () => list(await myStore());
  (el!.querySelector('.st-drop') as HTMLElement).onclick = async () => (keep(null), list(await myStore()));
  const check = async (b: HTMLButtonElement, sig?: string) => {
    b.disabled = true;
    say.className = 'st-say';
    say.textContent = 'Looking on the chain…';
    try {
      const r = await fetch('/api/store', { method: 'POST', body: JSON.stringify({ op: 'claim', token: q.token, sig, name: playerName(), discord: q.discord, note: q.note }) });
      const j = (await r.json()) as { ok: boolean; why?: string; status?: 'ok' | 'look'; sig?: string; serial?: number; perks?: Perks };
      if (!j.ok) {
        say.className = 'st-say bad';
        say.textContent = j.why ?? 'The store could not be reached: try again.';
        return;
      }
      keep(null);
      try {
        localStorage.setItem(BOUGHT, String(Date.now()));
      } catch {
        /* the server learns it within five minutes anyway */
      }
      await setPerks(j.perks!);
      bought();
      done(q, j.status!, j.sig!, j.perks!, j.serial);
    } catch {
      say.className = 'st-say bad';
      say.textContent = 'The store could not be reached: try again.';
    } finally {
      b.disabled = false;
    }
  };
  const paid = el!.querySelector('.st-paid') as HTMLButtonElement;
  paid.onclick = () => void check(paid);
  const sigb = el!.querySelector('.st-sigb') as HTMLButtonElement;
  sigb.onclick = () => void check(sigb, (el!.querySelector('input[name="sig"]') as HTMLInputElement).value.trim());
}

function done(q: Quote, status: 'ok' | 'look', sig: string, p: Perks, serial?: number) {
  clearInterval(tick);
  const it = SHOP[q.item];
  const what = status === 'look'
    ? 'Your payment came, but not as quoted (short, or after the price ran out). The owner checks it by hand: say so on Discord with the link below.'
    : q.item === 'vip' ? `You are VIP to ${day(p.vip)}.${q.discord ? ' Your Discord role is given by hand, usually within a day.' : ' Say your Discord name on Discord for the VIP role.'}`
      : q.item === 'noads' ? `No ads to ${day(p.noads)}.`
        : q.item === 'coffee' ? 'Thank you. A cup is by your name in chat for a week.'
          : `${it.name}${serial ? `, No. ${serial}${it.limit ? ` of ${it.limit}` : ''}` : ''}: yours. Open your inventory and Apply it to any you carry: that gun keeps it, whoever holds it next.`;
  // (the moment it is theirs, shown as such: the thing itself, gold or nickel or VIP's purple, and its number if it has one)
  const look = it.skin ? it.skin.finish : q.item === 'vip' ? 'vip' : 'plain';
  const shown = status !== 'ok' ? '' : it.skin
    ? `<figure class="st-reveal ${look}"><img src="/shop/${q.item}.jpg" alt=""><i class="st-sheen"></i>${serial ? `<figcaption>No. ${serial}${it.limit ? `<small> of ${it.limit}</small>` : ''}</figcaption>` : ''}</figure>`
    : q.item === 'vip' ? '<figure class="st-reveal vip"><b>VIP</b><i class="st-sheen"></i></figure>' : '';
  frame(`<div class="st-done ${status}">
    ${shown}
    <h3>${status !== 'ok' ? 'Received' : it.skin ? 'Yours' : q.item === 'coffee' ? 'Thank you' : 'Paid'}</h3><p>${what}</p>
    <a class="st-tx" href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener noreferrer">The payment on Solscan</a>
    <button type="button" class="st-back">Back to the store</button>
  </div>`);
  (el!.querySelector('.st-back') as HTMLElement).onclick = async () => list(await myStore());
}
