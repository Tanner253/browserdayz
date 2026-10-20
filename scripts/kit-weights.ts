// What each admin kit weighs as carried (npx tsx scripts/kit-weights.ts): none may slow the legs (LOAD.slowsFrom, test/load.test.ts)
import { KITS } from '../src/sim/kits';
import { makeItem } from '../src/sim/items';
import { PlayerInventory } from '../src/sim/inventory';

for (const k of KITS.filter((kit) => !kit.adds)) {
  const inv = new PlayerInventory();
  for (const t of k.things) {
    const it = makeItem(t.id, t.qty);
    if (t.mag !== undefined) it.mag = t.mag;
    if (t.loaded !== undefined) it.loaded = t.loaded;
    if (t.rounds !== undefined) it.rounds = t.rounds;
    if (t.mods) it.mods = [...t.mods];
    inv.add(it);
  }
  console.log(`${k.name.padEnd(10)} ${inv.weight().toFixed(1)} kg`);
}
