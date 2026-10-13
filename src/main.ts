import './ui/style.css';
import './ui/hud.css';
import { Renderer } from './core/renderer';
import { assets } from './core/assets';
import { Strips } from './core/strips';
import { physics } from './core/physics';
import { DEATHS, DIED_AT, LEAN, TOUCH, bootDone, bootStage } from './core/device';
import { generateWorld } from './world/worldgen';
import { Atmosphere } from './world/atmosphere';
import { Terrain } from './world/terrain';
import { Vegetation } from './world/vegetation';
import { Grass } from './world/grass';
import { Buildings } from './world/buildings';
import { buildRoad } from './world/road';
import { Game } from './game/game';
import { initRotatePrompt } from './ui/rotate';
import { gasClouds } from './sim/gas';
import { buildWorks } from './world/works';
import { buildWells } from './world/wells';
import { wellSpots } from './sim/wells';

// before anything loads: a phone held upright needs a way forward straight away
initRotatePrompt();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const loading = document.getElementById('loading')!;
const fill = loading.querySelector('.load-fill') as HTMLElement;
const label = loading.querySelector('.load-label') as HTMLElement;
const frame = () => new Promise((res) => setTimeout(res, 0));

// ------------------------------------------------------------------ the watch on the start
//
// A start that goes wrong used to say nothing: the bar stopped and that was all anybody could tell anyone. Now
// it says what it can on the screen, with a way to try again; and it tells the site (one line, see api/boot.ts)
// how it went on this machine: on every phone, since that is where it goes wrong and where nobody can look, and
// on anything it fails on.

/** the page's own watch (a plain script in index.html sets it up, before any of this could run) */
interface Watch { t0: number; stage: string; errs: string[]; done: boolean; say?: (text: string) => void }
const B = ((window as unknown as { __boot?: Watch }).__boot ??= { t0: Date.now(), stage: 'page', errs: [], done: false });
let card = '';

function stage(name: string, say?: string) {
  B.stage = name;
  bootStage(name);
  if (say) label.textContent = say;
}

function tell(how: 'ok' | 'failed' | 'slow' | 'died' | 'lost', err = '') {
  if (!import.meta.env.PROD) return;
  try {
    const body = JSON.stringify({
      how,
      stage: B.stage,
      secs: Math.round((Date.now() - B.t0) / 1000),
      err: (err || B.errs.join(' | ')).slice(0, 300),
      died: DIED_AT,
      deaths: DEATHS,
      lean: LEAN ? 1 : 0,
      touch: TOUCH ? 1 : 0,
      got: Math.round(assets.received / 1048576),
      ua: navigator.userAgent.slice(0, 200),
      gl: card,
      screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      mem: (navigator as { deviceMemory?: number }).deviceMemory ?? 0,
    });
    if (!navigator.sendBeacon?.('/api/boot', new Blob([body], { type: 'application/json' }))) void fetch('/api/boot', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    /* it is only a report */
  }
}

// (the last start here never finished: said before this one has had the chance to go the same way)
if (DIED_AT) tell('died');

/** a start that has gone quiet: nothing fetched, nothing finished, nothing said for this long, seconds */
const QUIET = 45;
{
  let was = '', quiet = 0;
  const watch = setInterval(() => {
    if (B.done) return clearInterval(watch);
    const now = `${B.stage}|${assets.received}|${label.textContent}`;
    quiet = now === was ? quiet + 5 : 0;
    was = now;
    if (quiet !== QUIET) return;
    B.say?.('Still loading. A slow or patchy connection is the usual cause: it carries on by itself, or you can reload and it picks up what it already has.');
    tell('slow');
  }, 5000);
}

// (A phone that runs out of memory for the picture takes the picture away and leaves the page: a black screen
// that still hears every tap. It is said, with the way back.)
canvas.addEventListener('webglcontextlost', () => {
  setTimeout(() => {
    const gl = canvas.getContext('webgl2');
    if (gl && !gl.isContextLost()) return;
    tell('lost');
    label.textContent = 'the picture was shut down';
    B.say?.('Your device shut the game’s graphics down, which is nearly always for want of memory. Close other tabs and apps, then reload.');
    loading.classList.remove('done');
  }, 3000);
});

async function boot() {
  // (`?sounds` on a development build is not the game: it is the page its sounds are heard on, old beside new)
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('sounds')) return (await import('./dev/sounds')).soundsPage();
  // (`?castle`: the fort on the mountain by itself, on a plain ridge, to be looked at and walked)
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('castle')) return (await import('./dev/castle')).castlePage();
  stage('renderer');
  const r = new Renderer(canvas);
  try {
    const gl = r.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    card = `${ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unnamed'} · ${gl.getParameter(gl.MAX_TEXTURE_SIZE)} · ${gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)}`.slice(0, 160);
  } catch {
    /* a browser that will not say */
  }
  assets.maxAnisotropy = Math.min(16, r.maxAnisotropy);
  assets.strips = new Strips(r.renderer);
  assets.onProgress = (d, t, l) => {
    fill.style.width = `${(d / Math.max(t, 1)) * 100}%`;
    label.textContent = l;
  };
  stage('assets');
  await Promise.all([physics.init(), assets.init()]);

  stage('world', 'generating world');
  await frame();
  const t0 = performance.now();
  const world = generateWorld();
  // (`?ruins`: the ruined town stood on a plain of its own in a corner of the map, to be looked at and walked in the game as it is)
  const ruins = import.meta.env.DEV && new URLSearchParams(location.search).has('ruins') ? await import('./dev/ruins') : null;
  ruins?.lay(world);
  console.log(`worldgen ${(performance.now() - t0).toFixed(0)}ms, trees ${world.trees.length}, buildings ${world.buildings.length}`);

  stage('sky');
  const atmo = new Atmosphere(r.renderer, r.scene, r.camera);
  // (`?nogas` on a development build leaves it out of the shaders, to measure what it costs)
  atmo.gases = import.meta.env.DEV && new URLSearchParams(location.search).has('nogas') ? [] : gasClouds(world);
  await atmo.init();
  stage('ground');
  const terrain = new Terrain(world, atmo);
  await terrain.build(r.scene);
  stage('buildings');
  const buildings = new Buildings(world, atmo);
  buildings.plan();
  buildings.build(r.scene);
  ruins?.stand(world, atmo, r, terrain, buildings);
  buildRoad(world, atmo, r.scene);
  buildWorks(world, atmo, r.scene);
  buildWells(wellSpots(world), atmo, r.scene);
  stage('forest', 'growing forest');
  await frame();
  const veg = new Vegetation(world, atmo);
  await veg.build(r.renderer, r.scene);
  const grass = new Grass(terrain, atmo, world.surface);
  grass.build(r.scene);

  stage('game');
  const game = new Game({ r, world, atmo, terrain, veg, grass, buildings });
  await game.init((l) => stage(l, l));
  stage('last files');
  await assets.idle();
  // warm up shader programs before revealing the world
  stage('shaders');
  r.precompile(r.scene, r.camera);
  assets.releaseModels();
  (window as unknown as Record<string, unknown>).__game = game;
  if (import.meta.env.DEV) (await import('./dev/harness')).installHarness(game);
  game.start();
  game.afterBoot();
  B.done = true;
  B.stage = 'up';
  bootDone();
  if (TOUCH) tell('ok');
  setTimeout(() => loading.classList.add('done'), 300);
}

boot().catch((e) => {
  console.error(e);
  const what = String(e?.message ?? e);
  label.textContent = `error: ${what}`;
  B.say?.(`The game could not start (${what.slice(0, 120)}). Reload to try again: what has already come down is kept.`);
  tell('failed', what);
});
