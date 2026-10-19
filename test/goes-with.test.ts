// What the inventory lights up beside a chosen thing: a gun, its rounds and its magazines, each way round.
import { ITEMS, magFits } from '../src/sim/items';
import { goesWith } from '../src/ui/inv-piles';

let bad = 0;
const ok = (c: boolean, m: string) => { if (!c) { bad++; console.error('FAIL', m); } };

const ids = Object.keys(ITEMS);
for (const g of ids.filter((i) => ITEMS[i].weapon)) {
  const w = ITEMS[g].weapon!;
  if (ITEMS[w.ammo]?.category === 'ammo') ok(goesWith(g, w.ammo) && goesWith(w.ammo, g), `${g} <-> its rounds ${w.ammo}`);
  if (w.mag) ok(goesWith(g, w.mag) && goesWith(w.mag, g), `${g} <-> its magazine ${w.mag}`);
  for (const m of ids.filter((i) => ITEMS[i].mag)) ok(goesWith(g, m) === magFits(m, g), `${g} / ${m} as magFits says`);
}
for (const m of ids.filter((i) => ITEMS[i].mag)) ok(goesWith(m, ITEMS[m].mag!.ammo), `${m} <-> its rounds`);
// a sealed box of rounds counts as those rounds
for (const b of ids.filter((i) => ITEMS[i].open && ITEMS[ITEMS[i].open!.gives]?.category === 'ammo')) {
  const r = ITEMS[b].open!.gives;
  for (const x of ids) ok(goesWith(b, x) === goesWith(r, x) || x === r || x === b, `box ${b} as ${r}, with ${x}`);
}
// never itself, and nothing for things that are none of these
ok(!ids.some((i) => goesWith(i, i)), 'nothing goes with itself');
const food = ids.find((i) => ITEMS[i].category === 'food')!;
ok(!ids.some((i) => goesWith(food, i)), `${food} goes with nothing`);

console.log(bad ? `${bad} failed` : 'goes-with: ok');
process.exit(bad ? 1 : 0);
