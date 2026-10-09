import './ui/style.css';
import './ui/hud.css';
import { Renderer } from './core/renderer';
import { assets } from './core/assets';
import { physics } from './core/physics';
import { generateWorld, heightAt } from './world/worldgen';
import { Atmosphere } from './world/atmosphere';
import { Terrain } from './world/terrain';
import { Vegetation } from './world/vegetation';
import { Grass } from './world/grass';
import { Buildings } from './world/buildings';
import { buildRoad } from './world/road';
import { Game } from './game/game';
import { initRotatePrompt } from './ui/rotate';
import { gasZone } from './sim/gas';

// before anything loads: a phone held upright needs a way forward straight away
initRotatePrompt();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const loading = document.getElementById('loading')!;
const fill = loading.querySelector('.load-fill') as HTMLElement;
const label = loading.querySelector('.load-label') as HTMLElement;
const frame = () => new Promise((res) => setTimeout(res, 0));

async function boot() {
  const r = new Renderer(canvas);
  assets.maxAnisotropy = Math.min(16, r.maxAnisotropy);
  assets.onProgress = (d, t, l) => {
    fill.style.width = `${(d / Math.max(t, 1)) * 100}%`;
    label.textContent = l;
  };
  await Promise.all([physics.init(), assets.init()]);

  label.textContent = 'generating world';
  await frame();
  const t0 = performance.now();
  const world = generateWorld();
  console.log(`worldgen ${(performance.now() - t0).toFixed(0)}ms, trees ${world.trees.length}, buildings ${world.buildings.length}`);

  const atmo = new Atmosphere(r.renderer, r.scene, r.camera);
  // (`?nogas` on a development build leaves it out of the shaders, to measure what it costs)
  atmo.gas = import.meta.env.DEV && new URLSearchParams(location.search).has('nogas') ? null : gasZone(world.pois, (x, z) => heightAt(world.heights, x, z));
  await atmo.init();
  const terrain = new Terrain(world, atmo);
  await terrain.build(r.scene);
  const buildings = new Buildings(world, atmo);
  buildings.plan();
  buildings.build(r.scene);
  buildRoad(world, atmo, r.scene);
  label.textContent = 'growing forest';
  await frame();
  const veg = new Vegetation(world, atmo);
  await veg.build(r.renderer, r.scene);
  const grass = new Grass(terrain, atmo, world.heights);
  grass.build(r.scene);

  const game = new Game({ r, world, atmo, terrain, veg, grass, buildings });
  await game.init((l) => (label.textContent = l));
  await assets.idle();
  // warm up shader programs before revealing the world
  r.precompile(r.scene, r.camera);
  assets.releaseModels();
  (window as unknown as Record<string, unknown>).__game = game;
  if (import.meta.env.DEV) (await import('./dev/harness')).installHarness(game);
  game.start();
  setTimeout(() => loading.classList.add('done'), 300);
}

boot().catch((e) => {
  console.error(e);
  label.textContent = `error: ${e?.message ?? e}`;
});
