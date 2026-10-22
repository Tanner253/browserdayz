// Ads in the game's page (2026-10-22), through public/ads.js, on the live site only and never for a VIP or a no-ads
// buyer (what this browser has bought, asked of the site afresh, at most an hour old). The owner: "when a player dies
// we should serve the highest paying ad type from adsense. no popup ads during gameplay ... and during death/respawn
// loops. we can serve 1 popup ad before the bot check starts as well so any stale session starts with an ad for us."
// So: a break (AdSense's ads for HTML5 games) once a visit on the way in, before the check that it is a person; one at
// each death in ZONA; and the "Death" unit on the death screen when no break was shown there. Never during play.

import { adFree } from '../../api/_lib/shop-items';
import { audio } from '../core/audio';
import { myPerks } from './store/account';

const LIVE = /(^|\.)zonapvp\.fun$/.test(location.hostname);
type Ads = { zonaAd?: (el: HTMLElement, kind?: string) => boolean; zonaBreak?: (type: string, name: string, before?: () => void, after?: () => void) => Promise<string> };
const w = window as unknown as Ads;

let script: Promise<void> | null = null;
const loaded = () =>
  (script ??= new Promise<void>((done) => {
    const s = document.createElement('script');
    s.src = '/ads.js';
    s.onload = s.onerror = () => done();
    document.head.appendChild(s);
  }));

/** whether an ad may be shown to this browser now (and the script that shows them is there) */
async function may(): Promise<boolean> {
  if (!LIVE || adFree(await myPerks())) return false;
  await loaded();
  return true;
}

/** the death screen's display unit, filled once a page */
export async function adBox(host: HTMLElement) {
  try {
    if (await may()) w.zonaAd?.(host, 'death');
  } catch {
    /* no ad: nothing else waits on it */
  }
}

let started = false;
/**
 * A break: 'start' (once a visit, on the way in) or 'next' (at a death). Resolves with what became of it ('viewed',
 * 'notReady', 'frequencyCapped', ... or 'none') once the screen is the game's again; the game is silent while an ad
 * has it.
 */
export async function adBreak(type: 'start' | 'next', name: string): Promise<string> {
  if (type === 'start') {
    if (started) return 'none';
    started = true;
  }
  try {
    if (!(await may()) || !w.zonaBreak) return 'none';
    return await w.zonaBreak(type, name, () => audio.quiet(true), () => audio.quiet(false));
  } catch {
    audio.quiet(false);
    return 'none';
  }
}
