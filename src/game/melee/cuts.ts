// Which captured blows each thing to hit with throws, one after another in a run (see fp.ts for how one is shown).
// Seconds are into the captured movement (scripts/melee-paths.mjs writes them down): drawn back from `from`, through the
// middle of the picture at `hit`, home by `to`. The game counts a blow landed 0.35 of the way through its swing, and the
// captured drawing back is played in that much of it.

import { hasCut, type Cut } from './fp';

/** a one-handed cut, right to left and down, the arm thrown out from the shoulder */
const SLASH: Cut = { clip: 'Right_Hand_Sword_Slash', from: 0.28, hit: 0.57, to: 0.95, lands: [0, 1.4, 0.3], reach: [0.38, 0.45] };

export const CUTS: Record<string, Cut[]> = {
  hatchet: [SLASH],
};

/** the captured blow a thing throws as the `n`th of a run, if it has any */
export function cutFor(id: string | undefined, n: number): Cut | null {
  const list = id ? CUTS[id] : undefined;
  const c = list?.[n % list.length];
  return hasCut(c) ? c : null;
}
