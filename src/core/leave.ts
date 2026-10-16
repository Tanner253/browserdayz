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
 * Back in by itself after a connection that dropped (the owner, 2026-10-16: "random disconnects ... its bad UX to
 * randomly get disconnected"): the page is loaded again and goes straight in, to the body that was left standing (the
 * server keeps it five minutes). Three times in three minutes at most; after that it is the player's to press.
 * @returns whether it is to be done now
 */
const REJOIN = 'zona:rejoin';
export function rejoinSoon(): boolean {
  try {
    const times = (JSON.parse(sessionStorage.getItem(REJOIN) ?? '[]') as number[]).filter((t) => Date.now() - t < 180_000);
    if (times.length >= 3) return false;
    sessionStorage.setItem(REJOIN, JSON.stringify([...times, Date.now()]));
    sessionStorage.setItem(`${REJOIN}:now`, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
/** this page was loaded again to go straight back in (see rejoinSoon) */
export function rejoining(): boolean {
  try {
    const at = Number(sessionStorage.getItem(`${REJOIN}:now`) ?? 0);
    sessionStorage.removeItem(`${REJOIN}:now`);
    return Date.now() - at < 60_000;
  } catch {
    return false;
  }
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

const FULL = 'zona.fullscreen';

/** whether full screen is wanted (Settings, Game: off until somebody asks: the owner, "fullscreen might not be what the user wants by preference"), as this browser keeps it */
export function fullWanted(): boolean {
  try {
    return localStorage.getItem(FULL) === '1';
  } catch {
    return false;
  }
}

export function wantFull(on: boolean) {
  try {
    localStorage.setItem(FULL, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/** full screen, if it is wanted: asked in the click that goes into the game (a browser gives it to nothing else) */
export function fullIfWanted() {
  if (fullWanted() && !document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}
