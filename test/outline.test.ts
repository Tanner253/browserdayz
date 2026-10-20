// The line round the Zona as the maps draw it (src/world/outline.ts): one closed line round each piece of it,
// the notches where two of its rounds meet rounded off. No network: `npx tsx test/outline.test.ts`.
//
// What was asked: "We also need to update the 'zona' edges on the map, i dont like the segmented circles". What
// is held to here: the line is a picture of the rule (`inPlay`) and may not lie about it. Its points are on the
// true edge everywhere but at the notches, never further from it there than three quarters of the fillet and none
// of them inside it, all of the edge is in it once, and it does not cross itself. The true edge is worked out
// here a second way (what is nearest on each round, and the places two rounds cross), not taken from the code
// that is being checked.

import assert from 'node:assert/strict';
import { playEdge, playRing, type Ring, type Round } from '../src/world/outline';
import { zonaDepth, zonaRings } from '../src/world/zona';
import { PLAY_AREAS, inPlay, playOutline } from '../src/world/worldgen';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const FILLET = 14, STEP = 4;
type Pt = { x: number; z: number };
const gap = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.z - q.z);
const lengthOf = (line: Pt[]) => line.slice(1).reduce((s, p, i) => s + gap(p, line[i]), 0);
/** is this place on a round's edge inside another round */
const under = (p: Pt, of: Round, areas: Round[]) => areas.some((b) => b !== of && gap(p, b) < b.r - 1e-9);

/** The notches of the true edge: where two rounds cross, inside no third. `open` is how wide the notch is there (radians). */
function notches(areas: Round[]): (Pt & { open: number })[] {
  const out: (Pt & { open: number })[] = [];
  for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
    const a = areas[i], b = areas[j], d = gap(a, b);
    if (d >= a.r + b.r || d <= Math.abs(a.r - b.r)) continue;
    const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d), up = Math.sqrt(a.r * a.r - along * along);
    const ux = (b.x - a.x) / d, uz = (b.z - a.z) / d;
    for (const s of [-1, 1]) {
      const p = { x: a.x + ux * along - uz * up * s, z: a.z + uz * along + ux * up * s };
      if (areas.some((c) => c !== a && c !== b && gap(p, c) < c.r - 1e-9)) continue;
      // (a half turn, less the angle between the two ways straight out of the rounds there)
      out.push({ ...p, open: Math.PI - Math.acos(((p.x - a.x) * (p.x - b.x) + (p.z - a.z) * (p.z - b.z)) / (a.r * b.r)) });
    }
  }
  return out;
}

/**
 * How far a place is from the true edge of the rounds laid together. The nearest of the edge is the nearest point
 * of some round, if that point is inside no other; and where it is, the nearest of that round's edge is where it
 * comes out from under the other, which is a notch.
 */
function off(p: Pt, areas: Round[], at: Pt[]): number {
  let best = Infinity;
  for (const c of areas) {
    const d = gap(p, c);
    if (d < 1e-9) continue;
    const q = { x: c.x + ((p.x - c.x) / d) * c.r, z: c.z + ((p.z - c.z) / d) * c.r };
    if (!under(q, c, areas)) best = Math.min(best, Math.abs(d - c.r));
  }
  for (const k of at) best = Math.min(best, gap(p, k));
  return best;
}

/** do two pieces of line cross */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * Everything a line round a set of rounds is held to, whatever the rounds. Gives back the stretches of it that
 * are off the true edge (one for each notch it rounds off): where each begins and ends in its ring.
 */
function held(areas: Round[], rings: Ring[], fillet = FILLET, step = STEP): { ring: Ring; from: number; to: number; at: Pt }[] {
  const at = notches(areas);
  const runs: { ring: Ring; from: number; to: number; at: Pt }[] = [];
  for (const ring of rings) {
    // closed, and no point of it twice running; its points about a step apart and never more
    assert.ok(ring.length >= 4, `a ring of ${ring.length} points`);
    assert.deepEqual(ring[ring.length - 1], ring[0], 'a ring does not end where it began');
    for (let i = 1; i < ring.length; i++) {
      const d = gap(ring[i], ring[i - 1]);
      assert.ok(d > 1e-6, `point ${i} of a ring is point ${i - 1} again`);
      assert.ok(d <= step + 1e-6, `${d.toFixed(2)} m between two points of a line asked for at every ${step} m`);
    }
    // never far from the true edge, and on it but for the notches
    const away = ring.map((p) => off(p, areas, at));
    ring.forEach((p, i) => {
      assert.ok(away[i] <= 0.75 * fillet, `a point of the line is ${away[i].toFixed(2)} m from the edge of the Zona (at ${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
      // (a fillet of that radius laid in a notch of straight sides touches them this far from its point; the sides bend away, so it is nearer)
      const near = at.some((k) => gap(p, k) <= fillet / Math.tan(k.open / 2) + step);
      if (!near) assert.ok(away[i] <= 0.5, `away from every notch, the line is ${away[i].toFixed(2)} m off the edge (at ${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
      // never inside: nobody who is in stands outside the line
      assert.ok(!areas.some((c) => gap(p, c) < c.r - 1e-6), `the line goes inside the Zona at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`);
    });
    // where it leaves the true edge and comes back to it
    assert.ok(away[0] < 1e-6, 'a ring begins off the edge');
    for (let i = 1; i < ring.length - 1; i++) {
      if (away[i] < 1e-6) continue;
      let to = i;
      while (away[to + 1] >= 1e-6) to++;
      const mid = ring[(i + to) >> 1];
      runs.push({ ring, from: i - 1, to: to + 1, at: at.reduce((best, k) => (gap(k, mid) < gap(best, mid) ? k : best), at[0]) });
      i = to;
    }
  }
  // one rounding for each notch, and each at a notch of its own
  assert.equal(runs.length, at.length, `${at.length} notches and ${runs.length} of them rounded off`);
  assert.equal(new Set(runs.map((r) => r.at)).size, at.length, 'two roundings at one notch');
  // it does not cross itself, nor one ring another
  const bits = rings.flatMap((ring) => ring.slice(1).map((p, i) => [ring[i], p] as [Pt, Pt]));
  for (let i = 0; i < bits.length; i++) for (let j = i + 1; j < bits.length; j++) {
    const [a, b] = bits[i], [c, d] = bits[j];
    if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) continue;
    assert.ok(!cross(a, b, c, d), `the line crosses itself near ${a.x.toFixed(0)}, ${a.z.toFixed(0)}`);
  }
  return runs;
}

ok('the Zona: one closed line, on its true edge but at the notches, never far from it there and never inside it', () => {
  const rings = playRing();
  assert.equal(rings.length, 1, `${rings.length} lines round a Zona that is all one piece`);
  const runs = held(PLAY_AREAS, rings);
  // (the works, the bunker and the way to Kamenka each join the valley at two notches, and Kamenka joins the way to it at two)
  // (and, since the road was made a loop, each round strung along it joins the next at a notch: see LOOP.zona in the generator)
  assert.ok(runs.length >= 8, `${runs.length} notches`);
  // and against the rounds themselves: no point of the line is in them, and none is further out of them than the promise
  // (the rounds the world was made by: the Zona's rule is the owner's drawing since 2026-10-18, see the next)
  const inRounds = (x: number, z: number, m = 0) => PLAY_AREAS.some((a) => Math.hypot(x - a.x, z - a.z) < a.r - m);
  for (const p of rings[0]) {
    assert.ok(!inRounds(p.x, p.z, 1e-6), `the line is inside the rounds at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`);
    assert.ok(inRounds(p.x, p.z, -0.75 * FILLET), `the line is far outside the rounds at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`);
  }
});

ok('the Zona as the owner drew it (src/world/zona.ts): one closed line, every point of it on the edge of the rule to within half its step', () => {
  const rings = zonaRings();
  assert.equal(rings.length, 1, `${rings.length} lines round a Zona that is all one piece`);
  // (since 2026-10-19 the Zona runs to the world's own edges east of its line: there the line is the world's edge, not the rule's)
  const edge = (p: { x: number; z: number }) => p.x >= 760 || Math.abs(p.z) >= 760 || p.x <= -3832;
  for (const p of rings[0]) if (!edge(p)) assert.ok(Math.abs(zonaDepth(p.x, p.z)) <= 4, `the line is ${zonaDepth(p.x, p.z).toFixed(1)} m off the edge of the rule at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`);
  // (Lipki, Kamenka, the swamp and Pokrov in it; the desert and Kalat out, since 2026-10-19: everything east of x -1950)
  assert.ok(inPlay(-1180, 350) && inPlay(625, 365) && inPlay(-1855, 585) && inPlay(-1915, 0) && !inPlay(-2200, 0) && !inPlay(-3200, 200), 'Lipki, Kamenka, the swamp or Pokrov is out of it, or the desert or Kalat is in it');
  // (the maps are handed the same line, worked out once)
  assert.equal(playEdge(), playEdge());
  assert.deepEqual(playEdge(), rings);
});

ok('all of the edge is in it once: as long as the arcs it was drawn as, less what the fillets cut, and every fillet 14 m', () => {
  const ring = playRing()[0], runs = held(PLAY_AREAS, [ring]);
  const arcs = playOutline();
  const drawn = arcs.reduce((s, a) => s + a.r * (a.to - a.from), 0);
  // what a fillet cuts: the true edge from where the line leaves it, into the notch and out to where the line is
  // back on it, less the way the line goes instead
  let cut = 0, full = 0;
  for (const run of runs) {
    const a = ring[run.from], b = ring[run.to];
    const round = (p: Pt) => PLAY_AREAS.find((c) => Math.abs(gap(p, c) - c.r) < 1e-6)!;
    const along = (p: Pt) => {
      const c = round(p);
      return c.r * Math.acos(Math.min(1, ((p.x - c.x) * (run.at.x - c.x) + (p.z - c.z) * (run.at.z - c.z)) / (c.r * c.r)));
    };
    assert.notEqual(round(a), round(b), 'a fillet between a round and itself');
    assert.ok(Math.abs(gap(run.at, round(a)) - round(a).r) < 1e-6 && Math.abs(gap(run.at, round(b)) - round(b).r) < 1e-6, 'a fillet that is not across the notch of the two rounds it joins');
    const edge = along(a) + along(b), instead = lengthOf(ring.slice(run.from, run.to + 1));
    assert.ok(instead < edge && instead < Math.PI * FILLET, `a fillet ${instead.toFixed(1)} m long across ${edge.toFixed(1)} m of edge`);
    cut += edge - instead;
    // and it is the fillet that was asked for (no notch of the Zona is too sharp for it): the round through its two ends and its middle
    const m = ring[(run.from + run.to) >> 1], ab = gap(a, b), bm = gap(b, m), ma = gap(m, a);
    const radius = (ab * bm * ma) / (2 * Math.abs((b.x - a.x) * (m.z - a.z) - (b.z - a.z) * (m.x - a.x)));
    // (Of the notches there were before the road was made a loop. A round strung along the new road may show only a
    // few metres of its edge between its neighbours, and the fillets at the two ends of such a stretch are as small
    // as will fit on it: never bigger than was asked.)
    assert.ok(radius < FILLET + 0.01, `a fillet of ${radius.toFixed(2)} m`);
    if (Math.abs(radius - FILLET) < 0.01) full++;
  }
  assert.ok(full >= 8, `only ${full} fillets of the ${FILLET} m asked for`);
  const length = lengthOf(ring);
  assert.ok(Math.abs(length - (drawn - cut)) <= 0.03 * (drawn - cut), `${length.toFixed(0)} m of line for ${drawn.toFixed(0)} m of arcs less ${cut.toFixed(0)} m`);
  console.log(`        (${length.toFixed(1)} m of line; ${drawn.toFixed(1)} m of arcs less ${cut.toFixed(1)} m cut at ${runs.length} notches is ${(drawn - cut).toFixed(1)} m)`);
});

ok('three rounds laid over one another: one line round the three', () => {
  const three: Round[] = [{ x: 0, z: 0, r: 100 }, { x: 120, z: 10, r: 70 }, { x: 60, z: 110, r: 60 }];
  const rings = playRing(three);
  assert.equal(rings.length, 1);
  // (each two of them cross twice, once out on the edge and once under the third)
  assert.equal(held(three, rings).length, 3);
  // a smaller fillet and a finer line, asked for: the same promises in their own measure
  const fine = playRing(three, 5, 1);
  assert.equal(held(three, fine, 5, 1).length, 3);
  assert.ok(lengthOf(fine[0]) > lengthOf(rings[0]), 'a smaller fillet did not cut less');
});

ok('two rounds that do not touch: a line round each, and each is its round', () => {
  const two: Round[] = [{ x: -200, z: 0, r: 90 }, { x: 150, z: 40, r: 60 }];
  const rings = playRing(two);
  assert.equal(rings.length, 2);
  assert.equal(held(two, rings).length, 0);
  for (const c of two) {
    const ring = rings.find((r) => Math.abs(gap(r[0], c) - c.r) < 1e-6);
    assert.ok(ring, 'no line round one of them');
    for (const p of ring) assert.ok(Math.abs(gap(p, c) - c.r) < 1e-6);
    assert.ok(Math.abs(lengthOf(ring) - Math.PI * 2 * c.r) < 0.01 * c.r, `${lengthOf(ring).toFixed(1)} m round a round of ${c.r} m`);
  }
});

ok('a round inside another adds nothing, and a notch too sharp for the fillet is given a smaller one', () => {
  const one: Round[] = [{ x: 0, z: 0, r: 100 }, { x: 20, z: -10, r: 40 }];
  assert.deepEqual(playRing(one), playRing([one[0]]));
  // (two great rounds that overlap by a metre: the notch between them is all but shut, and a fillet of the whole
  // 14 m laid in it would stand further off the edge than the promise)
  const sharp: Round[] = [{ x: 0, z: 0, r: 1500 }, { x: 2999, z: 0, r: 1500 }];
  const rings = playRing(sharp, FILLET, 10);
  assert.equal(rings.length, 1);
  assert.equal(held(sharp, rings, FILLET, 10).length, 2);
});

console.log(`\n${n} checks passed`);
