// Whether a player's own dog tag is round their neck, one a killer could take: what every game is told of each player,
// so that the tag is drawn on them only then (src/game/worn-tag.ts). The owner, 2026-10-22: "dogtags shouldnt render on
// the player until they can drop a tag". The same rule their body is judged by when they die (acts.ts): alive TAG_FRESH,
// inside the Zona, not an admin who leaves none. Worked out here, never taken from the player's own game.

import { ZONA_VOID } from '../src/sim/items';
import { inPlay } from '../src/world/worldgen';
import { tagLock } from './gate';
import { broadcast, clients, type Client } from './players';
import { TAG_FRESH_MS, tagTime } from './tags';

export function wearsTag(c: Client): boolean {
  if (!c.alive || c.inv?.slots?.neck?.id !== 'dogtag' || tagTime(c) < TAG_FRESH_MS) return false;
  if (ZONA_VOID && !inPlay(c.pose[0], c.pose[2])) return false;
  const lock = tagLock(c.key);
  return lock === undefined ? !c.power.voidTag : lock;
}

/** each second: whoever's tag has come or gone is told to everybody (a death, the twentieth minute, the Zona's line) */
export function tagsWorn() {
  for (const c of clients.values()) {
    const on = wearsTag(c);
    if (on === !!c.tagWorn) continue;
    c.tagWorn = on;
    broadcast({ t: 'tagged', id: c.id, on });
  }
}
