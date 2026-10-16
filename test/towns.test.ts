// THE NEW TOWNS HOLD TOGETHER: `npx tsx test/towns.test.ts`. (2026-10-16, the towns' polish pass.) What is laid out
// by numbers and never looked at from every side: that a facade's letters, its panels and its building's openings
// agree; that the stairs outside come to a door and onto the roof through a gap; that the ground is raised where it
// is meant to be and nowhere else; that no building of a town stands in another, nor anything lying about in one; that
// the piers' decks are under their sections. Nothing here opens a port.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUILDING_FOOTPRINT } from '../src/world/worldgen/layout';
import { STOREY, facadeOpenings, facadePieces, facadeSize, movePieces, type FacadeSpec } from '../src/world/facade';
import { FACADES, flatsPlan, hallPlan } from '../src/world/zavod-plans';
import { TOWNS, moundAt, placedKits, placedSlabs, townBuildings, townPoint, townThings, type Town, type TownSpot } from '../src/sim/towns';
import { KNOLL } from '../src/sim/lipki';
import { POKROV_TERRACE } from '../src/sim/pokrov';
import { DECK, PIERS, SHORE } from '../src/sim/ozerki';
import { ZAVOD, ZAVOD_WALL } from '../src/sim/zavod';

const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8'));
let checks = 0;
const ok = (cond: boolean, what: string) => (assert.ok(cond, what), checks++);

// ---- facades: letters, panels, openings
for (const [type, spec] of Object.entries(FACADES) as [string, FacadeSpec][]) {
  const [w, d] = facadeSize(spec), pieces = manifest.models[spec.kit]?.pieces;
  ok(!!pieces, `${spec.kit} is in the manifest with its pieces`);
  ok(BUILDING_FOOTPRINT[type as keyof typeof BUILDING_FOOTPRINT][0] === w && BUILDING_FOOTPRINT[type as keyof typeof BUILDING_FOOTPRINT][1] === d, `${type}: its footprint is its facade's ${w} x ${d}`);
  for (const p of facadePieces(spec)) ok(p.id in pieces, `${type}: the kit has a piece ${p.id}`);
  for (const side of ['front', 'back', 'left', 'right'] as const) {
    ok(spec.sides[side].length === spec.floors, `${type} ${side}: a line for each of its ${spec.floors} floors`);
    const half = (side === 'front' || side === 'back' ? w : d) / 2;
    for (let f = 0; f < spec.floors; f++) {
      const open = facadeOpenings(spec, side, f).sort((a, b) => a.a - b.a);
      for (const o of open) ok(o.a > -half && o.b < half && o.a < o.b && o.top <= STOREY, `${type} ${side} floor ${f}: an opening ${o.a}..${o.b} within its wall`);
      for (let k = 1; k < open.length; k++) ok(open[k].a >= open[k - 1].b, `${type} ${side} floor ${f}: openings do not overlap`);
    }
  }
  // (the pieces moved where a building stands land where the building's own frame puts that corner)
  const [m] = movePieces([{ id: 'x', at: [w / 2, 0, d / 2] }], 100, 5, -40, 0.7), c = Math.cos(0.7), s = Math.sin(0.7);
  ok(Math.abs(m.at[0] - (100 + (w / 2) * c + (d / 2) * s)) < 1e-9 && Math.abs(m.at[2] - (-40 - (w / 2) * s + (d / 2) * c)) < 1e-9, `${type}: moved as a building is turned`);
}
// ---- the stairs outside: a door at every floor they stop at, the parapet open where they come onto the roof
for (const [type, plan] of [['works_hall', hallPlan()], ['zavod_flats', flatsPlan()]] as const) {
  const spec = FACADES[type]!;
  for (const es of plan.escapes ?? []) {
    for (let f = 1; f <= es.floors; f++) {
      const door = facadeOpenings(spec, es.side, f).find((o) => o.kind === 'door' && o.a < es.at && o.b > es.at);
      ok(!!door, `${type}: a door at the ${es.side} stairs' landing on floor ${f}`);
    }
    if (es.roof) ok(!!plan.deck?.open?.some((o) => o.side === es.side && o.a < es.at && o.b > es.at), `${type}: the roof's parapet open where the ${es.side} stairs come up`);
  }
}

// ---- the ground raised where it is meant to be
const lipki = TOWNS.find((t) => t.name === 'Lipki')!, pokrov = TOWNS.find((t) => t.name === 'Pokrov')!;
ok(Math.abs(moundAt(lipki, KNOLL.x, KNOLL.z) - KNOLL.h) < 1e-9, 'the knoll is its full height at its middle');
ok(Math.abs(moundAt(lipki, KNOLL.x + KNOLL.top * 0.9, KNOLL.z) - KNOLL.h) < 1e-9, 'and level across its top');
ok(moundAt(lipki, KNOLL.x + KNOLL.r + 0.5, KNOLL.z) === 0 && moundAt(lipki, 0, -60) === 0, 'and nothing past its foot, nor in the lane');
ok(moundAt(pokrov, 10, -38) === POKROV_TERRACE.h, 'the monastery stands on the terrace');
ok(moundAt(pokrov, 5, 64) === 0, 'the market below it does not');
const bank = moundAt(pokrov, 5, 31 + POKROV_TERRACE.out / 2);
ok(bank > 0.5 && bank < POKROV_TERRACE.h - 0.5, `the terrace's bank falls between (${bank.toFixed(2)} m half way down)`);

// ---- no building of a town in another; nothing lying about inside a building
/** a rectangle turned: its corners, for a test of separating axes */
const corners = (x: number, z: number, w: number, d: number, rot: number) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
};
const overlap = (a: number[][], b: number[][], give: number) => {
  for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4], nx = z1 - z0, nz = x0 - x1, L = Math.hypot(nx, nz);
    const pa = a.map(([x, z]) => (x * nx + z * nz) / L), pb = b.map(([x, z]) => (x * nx + z * nz) / L);
    if (Math.max(...pa) - give <= Math.min(...pb) || Math.max(...pb) - give <= Math.min(...pa)) return false;
  }
  return true;
};
const box = (t: Town, s: TownSpot) => {
  const [x, z] = townPoint(t, s.x, s.z), [w, d] = BUILDING_FOOTPRINT[s.type];
  return corners(x, z, w, d, t.rot + s.rot);
};
/** the parts of one building of several stand against each other, and are let touch */
const PARTS = new Set(['cathedral', 'cathedral_arm', 'cathedral_apse']);
for (const t of TOWNS) {
  const spots = townBuildings(t);
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const give = PARTS.has(spots[i].type) && PARTS.has(spots[j].type) ? 0.05 : 0;
    ok(!overlap(box(t, spots[i]), box(t, spots[j]), give), `${t.name}: its ${spots[i].type} and ${spots[j].type} stand apart`);
  }
  for (const th of townThings(t)) {
    const [x, z] = townPoint(t, th.x, th.z);
    for (const s of spots) {
      if (s.up !== undefined) continue;
      const inside = !overlap(box(t, s), corners(x, z, 0.02, 0.02, 0), -0.3) ? false : true;
      ok(!inside, `${t.name}: its ${th.kind} at ${th.x.toFixed(1)}, ${th.z.toFixed(1)} is not inside its ${s.type}`);
    }
  }
}

// ---- Zavod's wall: moved with the town, the gate left open on the road
const slabs = placedSlabs(ZAVOD);
ok(slabs.length === ZAVOD_WALL.length, 'every run of the wall is laid');
ok(slabs.every((r, k) => r.a[0] === ZAVOD.x + ZAVOD_WALL[k].a[0] && r.b[1] === ZAVOD.z + ZAVOD_WALL[k].b[1]), 'at its place in the world');
const onSouth = ZAVOD_WALL.filter((r) => r.a[1] === 22 && r.b[1] === 22);
ok(!onSouth.some((r) => Math.min(r.a[0], r.b[0]) < 20 && Math.max(r.a[0], r.b[0]) > 20), 'no slab across the gate on the road');

// ---- Ozerki: a deck under every section of every pier, at the deck's height
const oz = TOWNS.find((t) => t.name === 'Ozerki')!, [kit] = placedKits({ town: oz, padY: 100 });
ok(kit.kit === 'pier_kit' && kit.boxes.length === PIERS.length, 'a deck for each pier');
for (const [n, p] of PIERS.entries()) {
  const b = kit.boxes[n], far = SHORE - p.n * 3.0;
  ok(Math.abs(b.c[1] + b.h[1] - (100 + DECK)) < 1e-9, `pier ${n}: its deck's top at the deck's height`);
  ok(b.c[2] + b.h[2] >= oz.z + SHORE && b.c[2] - b.h[2] <= oz.z + far, `pier ${n}: from the shore to its end`);
}
ok(townBuildings(oz).find((s) => s.type === 'boathouse')!.up === DECK, "the boathouse's floor is the pier's deck");

console.log(`towns: ${checks} checks passed`);
