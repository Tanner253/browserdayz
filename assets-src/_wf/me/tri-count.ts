// How many triangles the hand-made buildings are, by paint: every one of them is in one mesh per paint for the
// whole map (Buildings.build), so all of this is handed to the card every frame and again for every shadow.
import fs from 'node:fs';
import * as THREE from 'three';
import { assets } from '../../../src/core/assets';
import { generateWorld } from '../../../src/world/worldgen';
import { Buildings } from '../../../src/world/buildings';
(assets as { manifest: unknown }).manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8'));
const world = generateWorld();
const gen = new Buildings(world, null as never);
const by = new Map<string, number>();
const G = gen as unknown as { push: (key: string, g: THREE.BufferGeometry) => void };
const push = G.push.bind(gen);
G.push = (key, g) => {
  by.set(key, (by.get(key) ?? 0) + (g.index ? g.index.count : g.getAttribute('position').count) / 3);
  push(key, g);
};
gen.plan();
const rows = [...by].sort((a, b) => b[1] - a[1]);
let all = 0;
for (const [k, n] of rows) all += n;
console.log(rows.map(([k, n]) => `${k} ${Math.round(n)}`).join(', '));
console.log(`${rows.length} paints (one draw each, never culled), ${Math.round(all)} triangles in all; ${world.buildings.length} buildings, ${world.props.length} things, ${world.trees.length} trees`);
