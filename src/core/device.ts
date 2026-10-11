// What kind of device this is. Decided once at load.

/**
 * A phone or tablet: fingers on glass, no mouse to capture and no keyboard.
 * `?touch=1` forces it on a desktop, to try the touch controls with a mouse.
 */
export const TOUCH =
  typeof window !== 'undefined' &&
  typeof matchMedia === 'function' &&
  ((matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0) || new URLSearchParams(location.search).has('touch'));

// ------------------------------------------------------------------ how the last start went
//
// A phone that has not the memory for a page does not say so: it closes the page, and opens it again from the
// top. Nothing in the page is told. So each start leaves a note of how far it has got, and takes the note away
// when the game is up; a start that finds the last one's note still there knows that one never finished, and
// where it stopped.

const NOTE = 'zona.boot';
/** a note older than this is of some other day's visit, and says nothing about this one, milliseconds */
const FRESH = 30 * 60 * 1000;

interface Note { at: number; stage: string; left?: boolean; deaths: number }

function read(): Note | null {
  try {
    const n = JSON.parse(localStorage.getItem(NOTE) ?? 'null') as Note | null;
    return n && typeof n.at === 'number' && Date.now() - n.at < FRESH ? n : null;
  } catch {
    return null;
  }
}
function write(n: Note | null) {
  try {
    if (n) localStorage.setItem(NOTE, JSON.stringify(n));
    else localStorage.removeItem(NOTE);
  } catch {
    /* a browser that keeps nothing: every start is a first one */
  }
}

const last = typeof window !== 'undefined' ? read() : null;
/** the last start here never finished and was not walked away from: how far it had got ('' if it finished, or there was none) */
export const DIED_AT = last && !last.left ? last.stage : '';
/** how many starts in a row have ended that way */
export const DEATHS = last && !last.left ? last.deaths + 1 : 0;
/**
 * A phone the game has already failed to start on is given less to hold the next time: nothing is made sharper
 * when it is near, one file is unpacked at a time, and the picture is drawn smaller. It is a worse picture, and
 * it is a game that starts. (`?lean=1` forces it, to look at.)
 */
export const LEAN = typeof window !== 'undefined' && ((TOUCH && DEATHS > 0) || new URLSearchParams(location.search).has('lean'));

/** this start has got as far as `stage` */
export function bootStage(stage: string) {
  write({ at: Date.now(), stage, deaths: DEATHS });
}
/** the game is up: nothing is left to be found by the next start */
export function bootDone() {
  write(null);
}
if (typeof window !== 'undefined') {
  // (somebody who shuts the page while it loads has not been failed by it: the note says they left)
  window.addEventListener('pagehide', () => {
    const n = read();
    if (n) write({ ...n, left: true });
  });
}
