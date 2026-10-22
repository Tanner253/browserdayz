// An ad box in the game's page (2026-10-22): the main menu's and the death screen's, filled by public/ads.js once this
// browser's account is known not to be VIP or no-ads (asked of the site afresh, at most an hour old). Never during play:
// the two places it is called from are not seen while playing.

import { adFree } from '../../api/_lib/shop-items';
import { myPerks } from './store/account';

let script: Promise<void> | null = null;
const loaded = () =>
  (script ??= new Promise<void>((done) => {
    const s = document.createElement('script');
    s.src = '/ads.js';
    s.onload = s.onerror = () => done();
    document.head.appendChild(s);
  }));

export async function adBox(host: HTMLElement) {
  try {
    if (adFree(await myPerks())) return;
    await loaded();
    (window as unknown as { zonaAd?: (el: HTMLElement) => boolean }).zonaAd?.(host);
  } catch {
    /* no ad: nothing else waits on it */
  }
}
