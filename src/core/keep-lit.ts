// A phone or tablet in a game asks to keep its screen on (the owner, 2026-11-01: "it happens when i dont touch my screen for awhile, it goes in like super low fps and laggy mode"; "when i tap my
// screen its smooth again"). Nothing in the game changes when the screen goes untouched: a page that has not asked for this is an idle page to the device, which dims it and slows it down, and a
// tap wakes it. The device lets go of this by itself whenever the page is out of sight, so it is asked for again on the way back, and on any touch (some browsers grant it only on one).

/** what of the Screen Wake Lock is used here */
interface Held { release(): Promise<void>; addEventListener(kind: 'release', fn: () => void): void }
interface Asks { wakeLock?: { request(kind: 'screen'): Promise<Held> } }

/** @param wanted whether the player is in a game */
export function keepLit(wanted: () => boolean) {
  const lock = (navigator as Asks).wakeLock;
  if (!lock || !navigator.maxTouchPoints) return;
  let held: Held | null = null, asking = false;
  const look = async () => {
    if (!wanted()) {
      void held?.release();
      return;
    }
    if (held || asking || document.visibilityState !== 'visible') return;
    asking = true;
    try {
      held = await lock.request('screen');
      held.addEventListener('release', () => (held = null));
    } catch {
      // (the battery is low, or the browser will not: then the device does as it does)
    }
    asking = false;
  };
  document.addEventListener('visibilitychange', look);
  window.addEventListener('pointerup', look, { passive: true });
  window.addEventListener('touchend', look, { passive: true });
}
