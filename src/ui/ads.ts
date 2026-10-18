// Google Ads: its tag on the site, and its conversion sent once a page as the page is loaded (the owner, 2026-10-18,
// giving Google's own event snippet for the account's "Page view" conversion: "use this". Until then it was sent when a
// visitor first went into a game, under another number, and Google had seen nothing: "Unverified ... no activity").
// The account's tag and the conversion's label are not secrets: every page that carries them shows them.

/** the account's Google tag, 'AW-' and its number ('': nothing is loaded) */
const TAG = 'AW-6551556919';
/** the Page view conversion: the tag, a slash and its label, and what it is worth, as Google's event snippet says them */
const PLAY = 'AW-6551556919/f8gwCJrZ2JwdEP3O39A9';
const WORTH = { value: 1.0, currency: 'USD' };

type Gtag = (...a: unknown[]) => void;
const w = window as unknown as { dataLayer?: unknown[]; gtag?: Gtag };

/** only the live site counts: a development page, a film or a test is nobody's click */
const LIVE = location.hostname === 'www.zonapvp.fun' || location.hostname === 'zonapvp.fun';

/**
 * The tag, loaded once the page is up. Consent: in the EEA, the UK and Switzerland, where a site may not set ad
 * cookies unasked, they are denied and Google counts there without them (its consent mode); elsewhere granted.
 */
export function startAds() {
  if (!TAG || !LIVE || w.gtag) return;
  w.dataLayer = w.dataLayer ?? [];
  // (gtag hands its own arguments object to the layer: the library reads it so, not as an array)
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH'];
  const denied = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
  w.gtag('consent', 'default', { ...denied, region: EU });
  w.gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
  w.gtag('js', new Date());
  w.gtag('config', TAG);
  // (the Page view conversion, right after the tag, as Google's snippet has it)
  counted = true;
  w.gtag('event', 'conversion', { send_to: PLAY, ...WORTH });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${TAG}`;
  document.head.appendChild(s);
}

let counted = false;
/** somebody has gone into a game: the conversion, where the page's own has not been sent (it is sent as the page loads: once a page) */
export function playedAd() {
  if (counted || !PLAY || !w.gtag) return;
  counted = true;
  w.gtag('event', 'conversion', { send_to: PLAY, ...WORTH });
}
