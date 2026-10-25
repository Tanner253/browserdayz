// The server: forges (2026-10-25, plan-crafting; the rules are src/sim/craft/forge.ts). Every forge there is runs here
// each second, whoever is near ("it smelts while it burns, even while you are away"): its store is a base box's, so
// what it burns and makes is changed in that box, told to whoever has it open, and kept with the base. Whether it burns
// is told to every game that knows its base, as it lights and goes out and every few seconds while it burns (a game that
// comes into sight of it learns within those few). A fire's seconds are not kept over a restart: a forge with wood and
// scrap lights again by itself.

import { PIECES } from '../src/sim/build/pieces';
import { cold, forgeStep, lit, type Fire } from '../src/sim/craft/forge';
import { clients, send } from './players';
import { boxes } from './index';
import { KEPT } from './keep';
import { bases, tellBase } from './build';
import { boxItems, openers } from './searched';

/** each forge's fire, by its box's id */
const fires = new Map<string, Fire>();
/** how often the forges run, s; and how often a burning one is told again */
const STEP = 1, RETELL = 5;
let since = 0;

export function runForges() {
  since += STEP;
  const retell = since >= RETELL;
  if (retell) since = 0;
  const seen = new Set<string>();
  for (const b of bases().bases.values()) {
    for (const p of b.pieces.values()) {
      if (p.k !== 'forge') continue;
      const cid = `bbox:${b.id}:${p.id}`, box = boxes.get(cid), size = PIECES.forge.store!;
      if (!box) continue;
      seen.add(cid);
      let f = fires.get(cid);
      if (!f) fires.set(cid, (f = cold()));
      const was = lit(f);
      if (forgeStep(f, box.items, size[0], size[1], STEP)) {
        KEPT.dirty = true;
        // (whoever has it open sees it change)
        for (const id of openers.get(cid) ?? []) {
          const c = clients.get(id);
          if (c) send(c, { t: 'cdata', cid, items: boxItems(box) });
        }
      }
      if (lit(f) !== was || (lit(f) && retell)) tellBase(b.id, { t: 'forge', b: b.id, p: p.id, lit: lit(f) });
    }
  }
  // (a forge taken down or broken: its fire forgotten)
  for (const cid of fires.keys()) if (!seen.has(cid)) fires.delete(cid);
}

setInterval(runForges, STEP * 1000);
