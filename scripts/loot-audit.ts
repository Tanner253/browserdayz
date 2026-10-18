// What the loot tables come to on the map as it is: how many places there are to put things
// in each kind of building, what the first stocking of the world leaves where, which things
// have no rule at all, and which rules cannot be kept (nowhere they fit).
// npx tsx scripts/loot-audit.ts
import { buildWorldData } from '../server/world';
import { Economy, TYPES, apartOf } from '../src/sim/economy';
import { ITEMS } from '../src/sim/items';
import { CRATE_SPECS, fillCrate } from '../src/sim/crates';
import type { Container } from '../src/sim/inventory';

const world = buildWorldData(process.cwd());
const points = world.lootPoints;

const byUsage = new Map<string, number>();
let armed = 0;
for (const p of points) {
  if (p.arms) armed++;
  for (const u of p.usage) byUsage.set(u, (byUsage.get(u) ?? 0) + 1);
}
console.log(`${points.length} loot points (${armed} armed), ${world.crates.length} crates`);
console.log('  by kind of building: ' + [...byUsage].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${u} ${n}`).join(', '));

const eco = new Economy(points, { spawn() {}, despawn() {} });
eco.populate();
const got = new Map<string, number>();
const where = new Map<string, Map<string, number>>();
for (const l of eco.loot.values()) {
  got.set(l.item.id, (got.get(l.item.id) ?? 0) + 1);
  const u = l.point >= 0 ? points[l.point].usage.join('+') : 'ground';
  const m = where.get(l.item.id) ?? new Map<string, number>();
  m.set(u, (m.get(u) ?? 0) + 1);
  where.set(l.item.id, m);
}
const total = [...got.values()].reduce((a, b) => a + b, 0);
console.log(`\nfirst stocking: ${total} things on ${points.length} points (${((total / points.length) * 100).toFixed(0)}% of them full)`);
const cat = new Map<string, number>();
for (const [id, n] of got) cat.set(ITEMS[id].category, (cat.get(ITEMS[id].category) ?? 0) + n);
console.log('  by sort: ' + [...cat].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', '));
const gasPlaces = points.filter((p) => p.usage.includes('Gas') && !p.arms).length;
const gasThings = [...eco.loot.values()].filter((l) => l.point >= 0 && points[l.point].usage.includes('Gas') && !points[l.point].arms).length;
console.log(`  under the gas: ${gasThings} things on ${gasPlaces} places (${((gasThings / gasPlaces) * 100).toFixed(0)}% of them full)`);
// each step of the map (src/sim/tiers.ts): how many places it has, how many are full, and of each sort how many are wanted there and how many it got
const tierOf = (i: number) => points[i].tier ?? 1;
for (let t = 1; t <= 5; t++) {
  const places = points.filter((p, i) => tierOf(i) === t && !p.arms).length;
  const things = [...eco.loot.values()].filter((l) => l.point >= 0 && tierOf(l.point) === t && !points[l.point].arms).length;
  console.log(`  step ${t}: ${things} things on ${places} places (${((things / places) * 100).toFixed(0)}% full)`);
}
// (what each step keeps of a sort, as the economy has it: a step asked for more than it holds is cut to fit, see
// Economy.fit; and what lies there of it, on the map's own places and its armed ones: a place apart is stocked on top)
console.log('\n  id                 kept (steps 1 to 5)     got                  where it lay');
for (const id of Object.keys(TYPES)) {
  const want = [1, 2, 3, 4, 5].map((t) => eco.kept(id, t as 1));
  const per = [1, 2, 3, 4, 5].map((t) => [...eco.loot.values()].filter((l) => l.item.id === id && l.point >= 0 && !points[l.point].keeps && !apartOf(points[l.point].building) && tierOf(l.point) === t).length);
  const short = per.some((n, k) => n < want[k]);
  const w = [...(where.get(id) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([u, k]) => `${u} ${k}`).join(', ');
  console.log(`  ${id.padEnd(18)} ${want.map((n) => String(n).padStart(3)).join(' ')}   ${per.map((n) => String(n).padStart(3)).join(' ')}${short ? ' SHORT' : '      '} ${w}`);
}

const unruled = Object.keys(ITEMS).filter((id) => !TYPES[id]);
console.log(`\nthings with no rule (never put in a building): ${unruled.join(', ') || 'none'}`);
const unknown = Object.keys(TYPES).filter((id) => !ITEMS[id]);
if (unknown.length) console.log(`RULES FOR THINGS THAT DO NOT EXIST: ${unknown.join(', ')}`);

// what the crates give, over many openings
console.log('\ncrates:');
const kinds = new Map<string, number>();
for (const c of world.crates) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
for (const [kind, n] of kinds) {
  const def = CRATE_SPECS[kind];
  if (!def) {
    console.log(`  ${kind}: ${n} on the map, NO TABLE`);
    continue;
  }
  const seen = new Map<string, number>();
  let count = 0;
  const N = 400;
  for (let k = 0; k < N; k++) {
    let s = k * 7919 + 13;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    // (a box that takes whatever it is given: only what is put in it is of interest here)
    const box = { add: (it: { id: string }) => (seen.set(it.id, (seen.get(it.id) ?? 0) + 1), count++, true) };
    fillCrate(box as unknown as Container, kind, rnd);
  }
  console.log(`  ${kind}: ${n} on the map, ${(count / N).toFixed(1)} things a time: ` + [...seen].sort((a, b) => b[1] - a[1]).map(([id, k]) => `${id} ${((k / N) * 100).toFixed(0)}%`).join(', '));
}
