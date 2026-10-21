// The world cut down to one battle royale map, for a page that is only to play on it (2026-10-21): as the Arena's page
// is cut to its fort (arena/rules.ts, cutToArena), what stands is built only on the map and a little past its edge, for
// frames (the owner: "we have smaller maps for performance"). The edge itself is held by what main.ts stands there.
import { arenaBase } from '../../net/client';
import { MAPS, type BrMap } from '../../../arena/br/rules';
import type { World } from '../../world/worldgen';

/** how far past the map's edge what stands is still built, metres: what is seen over the edge, then the ground alone */
const MARGIN = 60;

/** The map this page is for: its address says (`kills`, as the arena's door carries it), else the server, else any. */
export async function brMapOfPage(): Promise<number> {
  const q = new URLSearchParams(location.search), said = q.get('kills');
  if (said !== null && Number.isInteger(Number(said)) && MAPS[Number(said)]) return Number(said);
  try {
    const r = await fetch(`${arenaBase()}/br/next?size=${q.get('size') ?? 1}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    const m = ((await r.json()) as { map?: number }).map;
    if (typeof m === 'number' && MAPS[m]) return m;
  } catch {
    /* the server asleep or away: any map, and the server opens a lobby on it */
  }
  return Math.floor(Math.random() * MAPS.length);
}

export function cutToBr(world: World, m: BrMap): void {
  const near = (o: { x: number; z: number }) => o.x > m.x0 - MARGIN && o.x < m.x1 + MARGIN && o.z > m.z0 - MARGIN && o.z < m.z1 + MARGIN;
  world.trees = world.trees.filter(near);
  world.rocks = world.rocks.filter(near);
  world.props = world.props.filter(near);
  world.buildings = world.buildings.filter(near);
  world.walls = world.walls.filter(near);
}

/** the map's edge, its four corners going round */
export const brCorners = (m: BrMap): [number, number][] => [[m.x0, m.z0], [m.x1, m.z0], [m.x1, m.z1], [m.x0, m.z1]];
