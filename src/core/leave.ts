// Whether the page is being left on purpose (2026-10-14). Whoever is alive in the game is asked before the tab goes
// (Ctrl and W, and Ctrl, Shift and W, are the browser's own and no page can take them from it: and Ctrl is a
// helicopter's way down, W its way forward). When the game itself loads the page again (a new version, a restarted
// server, the error screen's button) nobody is asked: it says so here first.
export const leaving = { now: false };

/** the page loaded again by the game itself: not asked about */
export function reloadPage() {
  leaving.now = true;
  location.reload();
}

/**
 * In full screen a page may keep keys for itself (the Keyboard Lock API, Chrome and Edge): there, Ctrl and W, N, T
 * and Tab never reach the browser. Called once: it follows the page in and out of full screen.
 */
export function keepKeysInFullScreen() {
  const kb = (navigator as unknown as { keyboard?: { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
  if (!kb?.lock) return;
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) kb.lock!(['KeyW', 'KeyN', 'KeyT', 'Tab']).catch(() => {});
    else kb.unlock?.();
  });
}
