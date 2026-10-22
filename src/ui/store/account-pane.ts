// The store's part of Settings' Account page (2026-10-22): what this browser's account has (VIP and its days, no ads,
// the finishes), the account it is all kept under, and the way to the store. Drawn afresh each time the page is turned to.

import { SHOP, type Perks } from '../../../api/_lib/shop-items';
import { myAcct, myPerks } from './account';

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export async function drawStoreAccount(host: HTMLElement) {
  let box = host.querySelector<HTMLElement>('.acct-store');
  if (!box) {
    box = document.createElement('section');
    box.className = 'acct-store';
    host.append(box);
  }
  const [p, acct]: [Perks, string] = await Promise.all([myPerks(true), myAcct()]);
  const now = Date.now(), lines: string[] = [];
  if (p.vip > now) lines.push(`<li><b class="vip">VIP</b> to ${day(p.vip)}</li>`);
  else if (p.noads > now) lines.push(`<li><b>No ads</b> to ${day(p.noads)}</li>`);
  for (const id of p.skins) lines.push(`<li>${SHOP[id]?.name ?? id}</li>`);
  if (p.cup > now) lines.push('<li>A coffee bought this week: thank you</li>');
  box.innerHTML = `<h4 class="set-h">Store</h4>
    ${lines.length ? `<ul class="acct-store-has">${lines.join('')}</ul>` : '<p class="acct-store-none">Nothing bought yet: VIP, finishes for your guns, no ads.</p>'}
    <button type="button" class="store-btn${p.vip > now ? ' vip' : ''}">Open the store</button>
    <p class="acct-store-id">Account <code>${acct}</code>: what is bought is kept under it, in this browser. Give it on Discord if you play from another.</p>`;
  (box.querySelector('.store-btn') as HTMLElement).onclick = () => void import('./panel').then((m) => m.openStore());
}
