// The languages the game speaks (2026-10-30, the owner: "we need to have language support people really complain about
// not being able to change the laguage for the game"). Who plays is on record nowhere (no analytics, and a device is only
// a hash), so the first set is DayZ's and the browser and Solana crowds' biggest: add a line here and a src/i18n/lang/*.json
// for another (no right-to-left yet: the HUD is laid out for left-to-right).
export const LANGS = [
  ['en', 'English'],
  ['es', 'Español'],
  ['pt', 'Português (Brasil)'],
  ['ru', 'Русский'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['tr', 'Türkçe'],
  ['zh', '简体中文'],
] as const;
export type Lang = (typeof LANGS)[number][0];

/** a language someone says they read: anything else is English */
export const langOf = (s: unknown): Lang => (LANGS.some(([c]) => c === s) ? (s as Lang) : 'en');
