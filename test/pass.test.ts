// The pass and its caves as a plan (src/sim/pass.ts): the terraces' shape; every cave under the ground over it (never
// breaking a shelf above), its mouths at a riser's foot on the shelf before it, its climbs walkable; what stops a body
// there; the loot; how dark it is. No ports, no page.
//   npx tsx test/pass.test.ts

import assert from 'node:assert/strict';
import { CAVES, PASS_SHAPE, caveAt, caveDark, caveLoot, caveMouths, caveSolids, galleries, inMouth, passEdges, passOf, passProfile, passWorld, rockPieces } from '../src/sim/pass';

const pass = passOf(() => 40), E = passEdges();

// ---- the terraces
{
  assert.equal(passProfile(0), 0);
  assert.equal(passProfile(-PASS_SHAPE.floor), 0);
  for (const [i, sh] of PASS_SHAPE.shelves.entries()) {
    const mid = (E[i].top + E[i].back) / 2;
    assert.equal(passProfile(mid), sh.up, `shelf ${i + 1}`);
    assert.equal(passProfile(-mid), sh.up, `shelf ${i + 1}, the other wall`);
    assert.ok(E[i].back - E[i].top >= 4 && E[i].back - E[i].top <= 8, 'a shelf 4 to 8 m deep');
  }
  assert.ok(passProfile(200) === PASS_SHAPE.crest, 'the ridge tops out');
  console.log(`terraces: floor ${PASS_SHAPE.floor * 2} m wide, shelves at ${PASS_SHAPE.shelves.map((s) => s.up).join(', ')} m, ${E.map((e) => (e.back - e.top).toFixed(0)).join(', ')} m deep`);
}

// ---- the caves under the ground, their mouths, their climbs
{
  for (const [ci, c] of CAVES.entries()) {
    for (const [k, n] of c.nodes.entries()) {
      const mouth = (k === 0 && c.mouths.includes('first')) || (k === c.nodes.length - 1 && c.mouths.includes('last'));
      if (mouth) {
        // (in a riser at the foot of it, its floor the shelf's before it: or, past the last shelf, in the ridge's face)
        const e = E.findIndex((q) => Math.abs(Math.abs(n.t) - q.foot) < 1);
        if (e >= 0) assert.equal(n.y, e === 0 ? 0 : E[e - 1].to, `${c.name}: a mouth on the shelf before its riser`);
        continue;
      }
      // a node within the wall: the ground over it stands over its roof, with rock between
      const over = passProfile(n.t) - (n.y + n.h);
      assert.ok(over > 1.5, `${c.name}, node ${k}: ${over.toFixed(1)} m of rock over its roof`);
    }
    for (let k = 0; k + 1 < c.nodes.length; k++) {
      const a = c.nodes[k], b = c.nodes[k + 1], run = Math.hypot(b.s - a.s, b.t - a.t);
      assert.ok(Math.abs(b.y - a.y) / run < 0.62, `${c.name}: a climb of ${((Math.abs(b.y - a.y) / run) * 100).toFixed(0)} in 100`);
    }
    void ci;
  }
  const mouths = caveMouths(pass);
  assert.equal(mouths.length, CAVES.reduce((n, c) => n + c.mouths.length, 0));
  for (const m of mouths) {
    assert.ok(inMouth(mouths, m.x, m.z), 'a mouth is open at its middle');
    // (it opens a riser's face and a metre in front: never more than a few metres deep)
    assert.ok(m.hz * 2 < 4.5, 'a mouth opens only its riser');
  }
  console.log(`caves: ${CAVES.length} (${CAVES.map((c) => c.name).join(', ')}), ${galleries(pass).length} galleries, ${mouths.length} mouths, all under the ground`);
}

// ---- inside: in a cave or not, how dark
{
  const hall = CAVES[0].nodes[2], inHall = passWorld(pass, hall.s, hall.t, hall.y + 2);
  const c = caveAt(pass, inHall[0], inHall[1], inHall[2]);
  assert.ok(c && c.cave === 0, 'in the hall');
  assert.ok(caveDark(pass, inHall[0], inHall[1], inHall[2]) > 0.9, 'dark in the hall');
  const out = passWorld(pass, 240, 0, 1.7);
  assert.equal(caveAt(pass, out[0], out[1], out[2]), null, 'the pass floor is not a cave');
  const lip = passWorld(pass, CAVES[0].nodes[0].s, CAVES[0].nodes[0].t, 1.7);
  assert.ok(caveDark(pass, lip[0], lip[1], lip[2]) < 0.05, 'light at a mouth');
  console.log(`dark: ${caveDark(pass, inHall[0], inHall[1], inHall[2]).toFixed(2)} in the hall, ${caveDark(pass, lip[0], lip[1], lip[2]).toFixed(2)} at its mouth`);
}

// ---- what stops a body, the loot, the rocks
{
  const solids = caveSolids(pass);
  assert.ok(solids.length > 100 && solids.every((b) => b.c.every(Number.isFinite) && b.h.every((v) => v > 0)), 'solid boxes');
  const loot = caveLoot(pass);
  assert.ok(loot.filter((l) => l.tier === 5).length >= 4 && loot.filter((l) => l.tier === 4).length >= 12, 'loot in the caves and the best on the floor');
  for (const l of loot.filter((q) => q.tier === 4)) assert.ok(caveAt(pass, l.x, l.y + 0.5, l.z), `${l.where}: its loot in the cave`);
  const rocks = rockPieces(pass);
  assert.ok(rocks.filter((r) => !r.inside).length > 100 && rocks.some((r) => r.inside), 'the walls dressed and the caves lined');
  console.log(`solids ${solids.length}, loot ${loot.length} (${loot.filter((l) => l.tier === 5).length} of the fifth tier on the floor), rock pieces ${rocks.length} (${rocks.filter((r) => r.inside).length} lining caves)`);
}
console.log('pass: all good');
