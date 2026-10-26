// The portraits a list of people shows (src/ui/icons.ts renderDoll, `face`: the admin panel, the player list, the kill
// feed), on the sandbox (src/dev/sandbox.ts `&ui=heads`): a row for each of the four bodies, a column for each thing
// worn, in what a new life wears besides, as Game.portrait draws them.
//   &ui=heads&items=patrol_cap,balaclava~1,gasmask-helmet_k63     a column for each, several joined by -

import * as THREE from 'three';
import { ItemModels } from '../game/loot';
import { lookFor } from '../game/look';
import { renderDoll } from '../ui/icons';
import { BODIES } from '../game/survivors';
import { atmosphereOf } from './sandbox-body';

export async function stageHeads(q: URLSearchParams, renderer: THREE.WebGLRenderer, env: THREE.Texture, ui: HTMLElement): Promise<Record<string, unknown>> {
  const items = (q.get('items') ?? '').split(',').filter(Boolean), base = ['tshirt', 'jeans', 'trainers'];
  const scene = new THREE.Scene();
  scene.environment = env;
  const models = new ItemModels(atmosphereOf(scene, new THREE.DirectionalLight()));
  const grid = document.createElement('div');
  grid.style.cssText = `position:fixed;left:0;top:0;display:grid;grid-template-columns:repeat(${items.length},144px);gap:4px;background:#222;padding:4px`;
  ui.appendChild(grid);
  for (let b = 0; b < BODIES.length; b++) {
    for (const it of items) {
      const img = document.createElement('img');
      img.src = await renderDoll(renderer, env, lookFor('Stage'), [...base, ...it.split('-')], models, true, b);
      img.style.cssText = 'width:144px;height:144px;display:block;background:#556';
      grid.appendChild(img);
    }
  }
  await Promise.all([...grid.querySelectorAll('img')].map((i) => i.decode().catch(() => null)));
  return { heads: items.length * BODIES.length };
}
