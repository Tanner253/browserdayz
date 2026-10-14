// Things that stand on the ground are seated in it (src/world/seat.ts): A COUNT OVER EVERY TREE, BUSH, ROCK, STUMP
// AND FALLEN TRUNK ON THE MAP of how far the highest point of its drawn foot stands over the ground under that
// point, as the plan alone had it (how it was drawn until 14 October) and as it is seated now. None may stand over
// the ground. The feet are the models' own, read from the files the game draws.   npx tsx test/seat.test.ts
//
// The owner: "half floating disconnected from the ground oobjects dont look good."

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { SEAT, footOf, footOver, groundLine, seat, seatKind, type Foot, type Seating } from '../src/world/seat';
import { generateWorld, heightAt, slopeAt, type Instance } from '../src/world/worldgen';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8')) as { models: Record<string, { url: string }> };
const treeFiles = JSON.parse(fs.readFileSync('public/assets/trees/trees.json', 'utf8')) as Record<string, { url: string }>;

/** the points of a file as the game draws them: of the nodes named so (a tree's bark), or of the n-th thing of a set, or of all of it */
async function points(file: string, pick: { named?: string; nth?: number }): Promise<number[]> {
  const doc = await io.read(file), scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0], out: number[] = [];
  const walk = (node: Node) => {
    const mesh = node.getMesh(), m = node.getWorldMatrix();
    if (mesh && (!pick.named || node.getName() === pick.named)) for (const prim of mesh.listPrimitives()) {
      const acc = prim.getAttribute('POSITION')!;
      for (let i = 0; i < acc.getCount(); i++) {
        const [x, y, z] = acc.getElement(i, [0, 0, 0]);
        out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
    }
    for (const c of node.listChildren()) walk(c);
  };
  const tops = scene.listChildren();
  for (const n of pick.nth === undefined ? tops : [tops[pick.nth % tops.length]]) walk(n);
  return out;
}
/** a thing's foot as the game has it: stood on its lowest point, its middle over the origin (`groundParts`), what was under its own ground line told */
function footOfProp(pts: number[]): Foot {
  let lx = Infinity, hx = -Infinity, ly = Infinity, lz = Infinity, hz = -Infinity;
  for (let i = 0; i < pts.length; i += 3) { lx = Math.min(lx, pts[i]); hx = Math.max(hx, pts[i]); ly = Math.min(ly, pts[i + 1]); lz = Math.min(lz, pts[i + 2]); hz = Math.max(hz, pts[i + 2]); }
  for (let i = 0; i < pts.length; i += 3) { pts[i] -= (lx + hx) / 2; pts[i + 1] -= ly; pts[i + 2] -= (lz + hz) / 2; }
  return footOf(pts, Math.max(0, -ly));
}

const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.surface, x, z);
const degrees = (it: Instance) => (Math.atan(slopeAt(world.surface, it.x, it.z)) * 180) / Math.PI;

interface Row { n: number; wasOver: number; /** by more than a hand */ wasHand: number; wasWorst: number; over: number; worst: number; steepest: number; deepest: number; moved: number }
const rows = new Map<string, Row>();
const feet = new Map<string, { foot: Foot; how: Seating }>();
let levelTrees = 0;
async function count(list: Instance[], footFor: (kind: string) => Promise<{ foot: Foot; how: Seating } | null>, label: (kind: string) => string) {
  for (const it of list) {
    if (!feet.has(it.kind)) {
      const f = await footFor(it.kind);
      if (!f) continue;
      feet.set(it.kind, f);
    }
    const { foot, how } = feet.get(it.kind)!;
    const lean = seat(ground, it, foot, how);
    assert.ok(lean, `a ${it.kind} at ${it.x.toFixed(0)}, ${it.z.toFixed(0)} is not on the ground: ${(it.y - ground(it.x, it.z)).toFixed(2)} m off it`);
    const was = footOver(ground, it, foot), now = footOver(ground, it, foot, lean);
    const r = rows.get(label(it.kind)) ?? { n: 0, wasOver: 0, wasHand: 0, wasWorst: -Infinity, over: 0, worst: -Infinity, steepest: 0, deepest: 0, moved: 0 };
    rows.set(label(it.kind), r);
    r.n++;
    if (was > 0.005) r.wasOver++;
    if (was > 0.1) r.wasHand++;
    r.wasWorst = Math.max(r.wasWorst, was);
    if (now > 0) r.over++;
    r.worst = Math.max(r.worst, now);
    r.steepest = Math.max(r.steepest, degrees(it));
    r.deepest = Math.max(r.deepest, ground(it.x, it.z) - lean[2]);
    // NONE ABOVE THE GROUND: every point of its foot is on the ground under that point or in it
    assert.ok(now <= 0, `the foot of a ${it.kind} at ${it.x.toFixed(1)}, ${it.z.toFixed(1)} stands ${now.toFixed(3)} m over the ground`);
    // what stands is never tilted, and what lies is tilted no further than its kind may be
    assert.ok(Math.abs(lean[0]) <= how.lies + 1e-9 && Math.abs(lean[1]) <= how.lies + 1e-9, `a ${it.kind} is tilted further than its kind may be`);
    // and its lowest point is as deep under the ground at its middle as its kind is sunk
    assert.ok(ground(it.x, it.z) - lean[2] >= how.sunk(foot) * it.scale - 1e-9, `a ${it.kind} is not sunk`);
    // ON LEVEL GROUND A TREE STANDS WHERE IT STOOD, within a hand: where the ground under the ring its trunk ends
    // in is within two fingers of the ground at its middle all round
    if (how === SEAT.tree && foot.rim.every((p) => Math.abs(ground(it.x + p[0] * it.scale, it.z + p[2] * it.scale) - ground(it.x, it.z)) < 0.02)) {
      levelTrees++;
      r.moved = Math.max(r.moved, Math.abs(lean[2] - it.y));
      assert.ok(Math.abs(lean[2] - it.y) <= 0.1, `a ${it.kind} on level ground was moved ${(lean[2] - it.y).toFixed(3)} m (it stood ${(it.y - ground(it.x, it.z)).toFixed(3)} m off the ground, at ${it.scale.toFixed(2)} of its size)`);
    }
  }
}

const before = { trees: world.trees.length, rocks: world.rocks.length, props: world.props.length, sum: [world.trees, world.rocks, world.props].flat().reduce((s, t) => s + t.x * 3 + t.y * 5 + t.z * 7, 0) };
await count(world.trees, async (kind) => ({ foot: footOf(await points('public/' + treeFiles[kind].url, { named: 'bark' }), 0, true), how: SEAT.tree }), (k) => (k.startsWith('bush') ? 'bush' : 'tree'));
const propFoot = async (kind: string) => {
  const id = kind.split(/[#@]/)[0], how = seatKind(id);
  if (!how) return null;
  return { foot: footOfProp(await points('public/' + manifest.models[id].url, kind.includes('#') ? { nth: Number(kind.split('#')[1]) } : {})), how: SEAT[how] };
};
const named = (kind: string) => (kind.startsWith('boulder') ? 'boulder' : kind.startsWith('rock') ? 'rock' : kind.startsWith('tree_stump') ? 'stump' : 'fallen trunk');
await count(world.rocks, propFoot, named);
await count(world.props, propFoot, named);

// the plan is as it was: seating a thing is how it is drawn and collided, and moves nothing in the world
assert.deepEqual({ trees: world.trees.length, rocks: world.rocks.length, props: world.props.length, sum: [world.trees, world.rocks, world.props].flat().reduce((s, t) => s + t.x * 3 + t.y * 5 + t.z * 7, 0) }, before, 'seating a thing moved it in the plan');
// every kind the rule names is on the map and was counted
for (const k of ['tree', 'bush', 'rock', 'boulder', 'stump', 'fallen trunk']) assert.ok((rows.get(k)?.n ?? 0) > 50, `no ${k} was counted`);
assert.ok(levelTrees > 500, `only ${levelTrees} trees stand on level ground`);
// where the ground is reckoned to meet a thing (for the damp and the drift painted at its foot) is no higher than a third of it, and never under its foot
for (const [kind, { foot, how }] of feet) {
  const line = groundLine(foot, how);
  assert.ok(line >= how.more && line <= Math.max(0.55 * foot.h, 0.1), `the ground meets a ${kind} ${line.toFixed(2)} up its ${foot.h.toFixed(2)} m`);
}

console.log('kind           count   WAS: foot over the ground / by over a hand / worst    NOW: over / worst    steepest ground   deepest seat');
let all = 0, wasOver = 0, wasHand = 0, over = 0;
for (const [k, r] of rows) {
  all += r.n; wasOver += r.wasOver; wasHand += r.wasHand; over += r.over;
  console.log(`${k.padEnd(13)} ${String(r.n).padStart(6)}   ${String(r.wasOver).padStart(6)} / ${String(r.wasHand).padStart(6)} / ${r.wasWorst.toFixed(2).padStart(5)} m                       ${String(r.over).padStart(4)} / ${r.worst.toFixed(2).padStart(5)} m   ${r.steepest.toFixed(0).padStart(6)} degrees    ${r.deepest.toFixed(2).padStart(5)} m`);
}
console.log(`ok: ${all} things counted; a foot over the ground WAS ${wasOver} (${wasHand} by more than a hand), NOW ${over}; ${levelTrees} trees on level ground moved ${Math.max(...[...rows.values()].map((r) => r.moved)).toFixed(2)} m at the most`);
