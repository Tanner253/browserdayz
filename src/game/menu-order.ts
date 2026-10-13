// Which of the menu's scenes are shown first, which are said to be new, and what a browser remembers of having been
// shown. Nothing here draws anything or knows what a scene is: to this file a scene is an id and the day it was
// added. (The table of them, and everything that is seen, is ./menu-scenes.ts.) It is kept apart so that it can be
// tested with no game and no browser: test/menu-order.test.ts.

/** one line of the table of scenes, as far as the order of showing is concerned */
export interface SceneRow {
  /** what it is known by, for good: it is what a browser remembers having been shown */
  id: string;
  /** the day what it shows came to the game (the changelog's date), as YYYY-MM-DD */
  added: string;
}

/** how many days a scene is new for, to somebody it has not been shown to */
export const FRESH_DAYS = 14;
const DAY = 86_400_000;

/**
 * The order one round of scenes is shown in, and which of them are said to be new.
 *
 * What this visitor has not been shown comes first, the newest first (two of one day in the table's order); then
 * what they have, in the table's order, which is the ordinary round. A scene is new if it has not been shown and
 * either came to the game within the last fortnight or has come since the visitor was last here. So somebody here
 * for the first time is not told that everything is new, only what lately is; somebody back after two months is
 * told of all that was added in them; and somebody who has seen it all is told of nothing.
 * @param seen the ids this browser has been shown  @param last when it was last here, ms (null: never, or it keeps nothing)
 */
export function menuOrder(table: readonly SceneRow[], seen: ReadonlySet<string>, last: number | null, now: number): { id: string; fresh: boolean }[] {
  const day = (r: SceneRow) => Date.parse(`${r.added}T00:00:00Z`);
  // (a sort leaves what it cannot tell apart as it found it: two scenes of one day stay in the table's order)
  const unseen = table.filter((r) => !seen.has(r.id)).sort((a, b) => day(b) - day(a));
  // (the whole of the day it was added counts as after a visit made that day)
  const fresh = (r: SceneRow) => now - day(r) < FRESH_DAYS * DAY || (last !== null && day(r) + DAY > last);
  return [...unseen.map((r) => ({ id: r.id, fresh: fresh(r) })), ...table.filter((r) => seen.has(r.id)).map((r) => ({ id: r.id, fresh: false }))];
}

// ------------------------------------------------------------ what is remembered

/** where a browser keeps what it has been shown, and when it was last here */
export const KEPT = { seen: 'zona.menu.seen', visit: 'zona.menu.visit' };

/** somewhere things are kept between one visit and the next: the browser's own, unless a test hands in another */
export interface Keeper {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** the browser's own (none where there is no browser, or where it will not be asked) */
function browsers(): Keeper | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
function put(box: Keeper | null, key: string, value: string) {
  try {
    box?.setItem(key, value);
  } catch {
    /* not kept: the menu is then as it is on a first visit, every time */
  }
}

/** What is remembered of the menu: the scenes shown, and when the last visit was. (A browser that keeps nothing remembers nothing: every visit is a first one.) */
export function recall(box: Keeper | null = browsers()): { seen: Set<string>; last: number | null } {
  try {
    const ids = JSON.parse(box?.getItem(KEPT.seen) ?? '[]') as unknown, at = Number(box?.getItem(KEPT.visit));
    return { seen: new Set(Array.isArray(ids) ? ids.filter((s): s is string => typeof s === 'string') : []), last: Number.isFinite(at) && at > 0 ? at : null };
  } catch {
    return { seen: new Set(), last: null };
  }
}

/** This visit is written down: the next one is counted from it. */
export function visit(now: number, box: Keeper | null = browsers()) {
  put(box, KEPT.visit, String(now));
}

/**
 * A scene has been shown: it is written down with the rest. Whatever another window of the game has written since
 * is kept with it (both are this visitor's), and what the table no longer has is forgotten.
 * @returns everything now remembered as shown (the one scene, where nothing is kept)
 */
export function remember(id: string, table: readonly SceneRow[], box: Keeper | null = browsers()): Set<string> {
  const seen = recall(box).seen;
  seen.add(id);
  const kept = [...seen].filter((s) => table.some((r) => r.id === s));
  put(box, KEPT.seen, JSON.stringify(kept));
  return new Set(kept);
}
