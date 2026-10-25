// Which model files a computer draws with their pictures at 1024 while they are close (DESK_NEAR and `sharpen` in
// src/core/assets.ts), where everything is drawn at 512. The owner, 2026-10-25: "1024 should be used on the player
// model zombies and hand held models we brought in then 512 should be used for things that arent righht in the users
// face all the time or in their hands".
import { ITEMS, type Category } from '../sim/items';

/** what is held in the hands or worn: guns and what goes on them, things to hit with, tools, clothes */
const HELD = new Set<Category>(['weapon', 'magazine', 'attachment', 'melee', 'tool', 'clothing']);

/** every body (survivors, their clothes, the infected) is under here */
const BODIES = 'assets/characters/';

/** the manifest's model files drawn at 1024 when close: the items held or worn, and the first-person guns */
export function nearModels(models: Record<string, { url: string; tags: string[] }>): Set<string> {
  const near = new Set<string>();
  for (const d of Object.values(ITEMS)) {
    // (a grenade is held before it is thrown, a syringe until it is used)
    if (!HELD.has(d.category) && !d.throw && !d.use?.hold) continue;
    const e = models[d.model];
    if (e) near.add(e.url);
  }
  for (const e of Object.values(models)) if (e.tags.includes('viewmodel')) near.add(e.url);
  return near;
}

/** whether a file (as the game asks for it: `assets/...`) is drawn at 1024 when close */
export const drawnNear = (url: string, near: Set<string>) => url.startsWith(BODIES) || near.has(url);
