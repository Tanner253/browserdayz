// three.js hands every scene and renderer it makes to window.__THREE_DEVTOOLS__ when a page has one (its inspector's
// hook): a script that sets it before the game loads is given the whole world, and can draw everybody through walls
// (the owner, 2026-10-27: "someone is cheating running code in the browser to get ESP hacks on"). Nothing of ours sets
// it, so one found here is a script's, and the server is told as for window.__game (src/net/bait.ts). It is then taken
// away before three loads, so three finds none: this file is main.ts's first import for that.
import { spring } from './bait';

const NAME = '__THREE_DEVTOOLS__';

if (!import.meta.env.DEV || new URLSearchParams(location.search).has('bait')) {
  // (set at the page's start, before any of the game ran)
  if (NAME in window) spring(NAME);
  try {
    Object.defineProperty(window, NAME, { configurable: false, enumerable: false, get: () => undefined, set: () => spring(NAME) });
  } catch {
    // (one laid so that it cannot be taken away: three is handed the world all the same, and the server was told)
  }
}
