// Google Ads: its tag on the site, and one conversion when a visitor first goes into a game, the Zone or the Arena
// (the owner, 2026-10-14: "we should setup conversion measurment for google ads on pla[y]"). A page view would count
// everybody who looks at the door and leaves; going in is what an ad is for.
// The account's tag and the Play conversion's label are not secrets: every page that carries them shows them.

/** the account's Google tag, 'AW-' and its number ('' until the owner gives it: nothing is loaded) */
const TAG = 'AW-16543901565';
/** the Play conversion: the tag, a slash and its label, as the conversion's event snippet says it */
const PLAY = '';

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
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${TAG}`;
  document.head.appendChild(s);
}

let counted = false;
/** somebody has gone into a game: counted once a page (Google counts one a click besides, as the conversion is set) */
export function playedAd() {
  if (counted || !PLAY || !w.gtag) return;
  counted = true;
  w.gtag('event', 'conversion', { send_to: PLAY });
}
