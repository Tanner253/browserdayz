// The battle royale's map for a page (2026-10-21): which of the three it is on, and its edge. What stands off it is
// not drawn while it is played, src/game/modes.ts (it was once not built: another game was then another page).
import { arenaBase } from '../../net/client';
import { MAPS, type BrMap } from '../../../arena/br/rules';

/** The map this page is for: its address says (`kills`, as the arena's door carries it), else the server, else any. */
export async function brMapOfPage(): Promise<number> {
  const q = new URLSearchParams(location.search), said = q.get('kills');
  // (asked for the mode last played: the open lobby of that mode is the one to be cut for)
  let size = q.get('size') ?? '1';
  try {
    const m = localStorage.getItem('zona-br-mode');
    if (!q.get('size') && m) size = m === 'squad' ? '4' : m === 'duo' ? '2' : '1';
  } catch {
    /* not kept */
  }
  if (said !== null && Number.isInteger(Number(said)) && MAPS[Number(said)]) return Number(said);
  try {
    const r = await fetch(`${arenaBase()}/battleroyale/next?size=${size}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    const m = ((await r.json()) as { map?: number }).map;
    if (typeof m === 'number' && MAPS[m]) return m;
  } catch {
    /* the server asleep or away: any map, and the server opens a lobby on it */
  }
  return Math.floor(Math.random() * MAPS.length);
}

/** the map's edge, its four corners going round */
export const brCorners = (m: BrMap): [number, number][] => [[m.x0, m.z0], [m.x1, m.z0], [m.x1, m.z1], [m.x0, m.z1]];
