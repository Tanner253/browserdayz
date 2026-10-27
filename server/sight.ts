// Where everybody is, told only to those who could see them (the owner, 2026-10-27: "someone is cheating running code
// in the browser to get ESP hacks on"). Every player's position went to every page fifteen times a second, and a
// script in a page reads whatever it is sent; now a page hears of nobody further off than the furthest draw distance,
// but its own party (their marks on the map and the compass) and, for an admin, everybody (the far sight). One who
// goes out of reach is said to be ('out'), so the page stops drawing them where they were last.

/** metres: told of within `near` (src/core/settings.ts DRAWS, the furthest); one already told of is kept to `keep`, so nobody on the edge comes and goes */
export const SIGHT = { near: 1500, keep: 1600 };

/**
 * Of `rows`, those somebody at `me` is told of: themselves, their party, whoever is within reach, or all of them;
 * and who they were told of last time and are not now. `told` is what they were told of, and is made what they are.
 */
export function inSight<R extends { id: number; x: number; z: number }>(me: { id: number; x: number; z: number }, rows: R[], told: Set<number>, mates: ReadonlySet<number>, all = false): { see: R[]; out: number[] } {
  const see: R[] = [], was = new Set(told);
  told.clear();
  for (const r of rows) {
    const reach = was.has(r.id) ? SIGHT.keep : SIGHT.near;
    if (!all && r.id !== me.id && !mates.has(r.id) && (r.x - me.x) ** 2 + (r.z - me.z) ** 2 > reach * reach) continue;
    see.push(r);
    told.add(r.id);
  }
  const out: number[] = [];
  for (const id of was) if (!told.has(id)) out.push(id);
  return { see, out };
}
