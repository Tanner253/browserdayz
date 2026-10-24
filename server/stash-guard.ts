// The players' stashes against what this release changed on the map (2026-10-23, the owner: "we cannot change the map
// around user stashes, or risk making them unreachable"). scripts/stash-guard.ts, run before a deploy, writes every
// 8 m square where the ground moved or anything stands otherwise than in the build that was live
// (server/changed-cells.json). When the stashes it keeps are back, the server counts how many lie within 15 m of such
// a square, says so in its log and on /healthz (`stashGuard`), loudly if any do. Counts only, never where: where a
// stash lies is its owner's alone (stash-sight.ts).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { boxes, log } from './index';

/** how near a change a stash counts as touched by it, metres */
const NEAR = 15;

export const STASH_GUARD = { base: '', checked: 0, near: 0 };

let cells: { size: number; set: Set<string> } | null | undefined;
function changed() {
  if (cells !== undefined) return cells;
  const file = path.join(process.cwd(), 'server', 'changed-cells.json');
  if (!existsSync(file)) return (cells = null);
  const data = JSON.parse(readFileSync(file, 'utf8')) as { base: string; size: number; cells: [number, number][] };
  STASH_GUARD.base = data.base;
  return (cells = { size: data.size, set: new Set(data.cells.map(([i, j]) => `${i},${j}`)) });
}

/** Count the buried stashes kept near a change of this release, and say so. */
export function guardStashes() {
  const c = changed();
  if (!c) return;
  const S = c.size, reach = Math.ceil(NEAR / S) + 1;
  let checked = 0, near = 0;
  for (const b of boxes.values()) {
    if (b.kind !== 'stash' || !b.buried) continue;
    checked++;
    const i0 = Math.floor(b.x / S), j0 = Math.floor(b.z / S);
    let hit = false;
    for (let i = i0 - reach; i <= i0 + reach && !hit; i++) for (let j = j0 - reach; j <= j0 + reach && !hit; j++) {
      if (!c.set.has(`${i},${j}`)) continue;
      // (the nearest point of the square)
      const dx = Math.max(i * S - b.x, 0, b.x - (i + 1) * S), dz = Math.max(j * S - b.z, 0, b.z - (j + 1) * S);
      hit = Math.hypot(dx, dz) < NEAR;
    }
    if (hit) near++;
  }
  Object.assign(STASH_GUARD, { checked, near });
  log(near ? `[stash-guard] !!! ${near} of the ${checked} buried stashes kept lie within ${NEAR} m of what this release changed on the map (against ${STASH_GUARD.base})` : `[stash-guard] none of the ${checked} buried stashes kept lies within ${NEAR} m of what this release changed (against ${STASH_GUARD.base})`);
}
