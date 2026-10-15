// How often a shooter's hits on one body are believed (server/tags.ts, mayHit): no oftener than the gun fires, over a
// run of them, with one allowed a gap early when the one before came late. (Rounds fired a tenth of a second apart
// arrive at the server as the line carries them, two together now and then, and the second was thrown away: hits from
// an automatic that "did not register". The run of them is held to the gun's pace all the same.) A shell that lands on
// two is two hits a moment apart, of two bodies (one clock a shooter, until 2026-10-13, threw the second away). No more
// than three bodies inside one gap: what a spread of shot could reach.

/** a shooter's hits: by what was hit ('p' + a player's id, 'i' + an infected's), when it was last hit and when the next is due */
export type Hits = Map<string, { due: number; at: number }>;

/** whether a hit on `target` at `now` is believed, the hits noted if it is; `gap` the least time between hits, ms */
export function paced(m: Hits, target: string, now: number, gap: number): boolean {
  const was = m.get(target);
  if (was && now < was.due - gap) return false;
  let lately = 0;
  for (const [k, t] of m) {
    if (now - t.at > 5000) m.delete(k);
    else if (k !== target && now - t.at < gap) lately++;
  }
  if (lately >= 3) return false;
  m.set(target, { due: Math.max(was?.due ?? now, now) + gap, at: now });
  return true;
}
