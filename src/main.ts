import './ui/style.css';
import './ui/hud.css';
import * as THREE from 'three';
import { Renderer } from './core/renderer';
import { assets } from './core/assets';
import { Strips } from './core/strips';
import { physics, GLASS_GROUPS } from './core/physics';
import { arenaCorners, cutToArena, nearArena } from '../arena/rules';
import { wagerQuery } from './net/client';
import { modeOf, openDoor } from './ui/door';
import { startAds } from './ui/ads';
import { ArenaMenu } from './ui/arena-menu';
import { DEATHS, DIED_AT, LEAN, TOUCH, bootDone, bootStage } from './core/device';
import { SEA_LEVEL, WORLD_X0, WORLD_Z0, WORLD_Z1, heightAt } from './world/worldgen';
import { Towns } from './world/towns';
import { Ruins } from './world/ruins';
import { ruinLoot, ruinsPlan } from './sim/ruins';
import { Ocean } from './world/ocean';
import { Waterways } from './world/water';
import { waterAt } from './sim/water';
import { caveMouths } from './sim/pass';
import { caveLootPoints, inCave } from './world/caves-carved';
import { PassCaves } from './world/caves';
import { RockField } from './world/rock-field';
import { CANYON_ROCK_TINT } from './world/ground';
import { outcropPieces } from './world/outcrops';
import { passPlan } from './world/worldgen';
import { loadWorld } from './world/load-world';
import { Atmosphere, SHADOW_FRUSTA } from './world/atmosphere';
import { installTiny } from './core/tiny';
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
    // (reported, and no longer said on the screen: the owner, of its "Still loading ... Reload", "we need to get rid of this")
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
  // (`?post`: the same fort with the army's signals post stood on it, to be looked at)
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('post')) return (await import('./dev/castle-post')).postPage();
  // (Google Ads' tag, on the live site only: src/ui/ads.ts)
  startAds();
  // the door: which game, asked before anything is built (src/ui/door.ts); an address that says goes straight in
  let mode = modeOf(!!wagerQuery());
  if (!mode) {
    stage('door');
    mode = await openDoor();
    history.replaceState(null, '', `/${mode}${location.hash}`);
  }
  // (the loading screen is the game's own: the Arena's says so)
  if (mode === 'arena') {
    (loading.querySelector('.load-title') as HTMLElement).textContent = 'ARENA';
    (loading.querySelector('.load-sub') as HTMLElement).textContent = 'team matches at the fort · zona pvp';
    loading.classList.add('arena');
  }
  // The map, made on a worker of its own while everything else is fetched, and kept in the browser for the next
  // visit (src/world/load-world.ts; from the performance branch of 2026-10-15). Where a worker cannot be had, the
  // page makes it a stage at a time, as it did.
  const worldReady = loadWorld();
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
  const world = await worldReady;
  // (`?ruins`: the ruined town stood on a plain of its own in a corner of the map, to be looked at and walked in the game as it is)
  const ruins = import.meta.env.DEV && new URLSearchParams(location.search).has('ruins') ? await import('./dev/ruins') : null;
  ruins?.lay(world);
  // (`?towns`: a new town of the map three times over stood on level ground in a corner of today's map: src/dev/towns.ts)
  const towns = import.meta.env.DEV && new URLSearchParams(location.search).has('towns') ? await import('./dev/towns') : null;
  towns?.lay(world);
  // (the Arena's page builds the arena and what is seen over its wall, and nothing else: arena/rules.ts)
  const arena = mode === 'arena' && !!world.castle;
  if (arena) cutToArena(world);
  console.log(`worldgen ${(performance.now() - t0).toFixed(0)}ms, trees ${world.trees.length}, buildings ${world.buildings.length}${arena ? ' (cut to the arena)' : ''}`);

  stage('sky');
  const atmo = new Atmosphere(r.renderer, r.scene, r.camera);
  installTiny(r.scene, r.renderer, (f) => SHADOW_FRUSTA.has(f));
  // (`?nogas` on a development build leaves it out of the shaders, to measure what it costs)
  // (and in a wager's arena there is none: the works are far off)
  atmo.gases = arena || (import.meta.env.DEV && new URLSearchParams(location.search).has('nogas')) ? [] : gasClouds(world);
  await atmo.init();
  stage('ground');
  const terrain = new Terrain(world, atmo);
  // (the ground's tiles about the arena, out to the hills round it: bare ground is cheap, and cut off at the wall it
  // hung in the sky in pieces. A tile is kept if its middle is within 300 m and half its own breadth of the square.)
  if (arena) terrain.only = (x0, z0, x1, z1) => nearArena(world, (x0 + x1) / 2, (z0 + z1) / 2, 300 + Math.hypot(x1 - x0, z1 - z0) / 2);
  await terrain.build(r.scene);
  stage('buildings');
  const buildings = new Buildings(world, atmo);
  buildings.plan();
  // (the basements' steps are open in the ground: the houses are planned after the ground is made; the caves' mouths
  // once the caves stand, below)
  terrain.openWells(world.basements ?? []);
  // (?nobatch: the walls drawn as before 2026-10-16, to compare the two)
  buildings.multiDraw = r.renderer.extensions.has('WEBGL_multi_draw') && !new URLSearchParams(location.search).has('nobatch');
  buildings.build(r.scene);
  ruins?.stand(world, atmo, r, terrain, buildings);
  void towns?.stand(atmo, r, buildings);
  // THE WEST (plan v5): the towns' walls, domes, facades and piers (src/world/towns.ts); Kalat's ruins
  // (src/world/ruins.ts), and its places for things after every other one, so that nothing is renumbered; the sea and
  // the lakes and the river (src/world/ocean.ts, water.ts). Each told every frame where the eye is (Game.beside).
  const ready = (o: THREE.Object3D) => r.ready(o).then(() => r.send(o));
  const ground = (x: number, z: number) => heightAt(world.heights, x, z);
  const westTowns = !arena && world.towns?.length ? new Towns(atmo, r.scene, world.towns, buildings, ready, world.buildings) : null;
  void westTowns?.build();
  const kalat = !arena && world.kalat ? ruinsPlan(world.kalat) : [];
  const kalatRuins = kalat.length ? new Ruins(atmo, r.scene, kalat, ready) : null;
  for (const { piece, place } of kalat) buildings.lootPoints.push(...ruinLoot(piece, place, ground));
  // (the pass's caves, carved where the world was made (World.caves), dressed with the coast kit's rock; their places
  // for things after Kalat's, as the server lays them)
  const caves = arena ? null : new PassCaves(r.scene, atmo, passPlan, ground);
  // (the mouths opened in the ground once the caves are built and solid: opened first, a body at a mouth, or one come
  // back to a cave, had no floor until the rock models had loaded)
  if (caves) {
    await caves.build({ carved: world.caves, heightTex: terrain.heightTex });
    terrain.openWells(world.basements ?? [], caveMouths(passPlan));
  }
  // (the canyon country's outcrops, read off its ground: src/world/outcrops.ts)
  const outcrops = arena ? null : new RockField(r.scene, atmo, outcropPieces(world, passPlan), { name: 'outcrops', near: 40, solid: 50, heightTex: terrain.heightTex, flat: 'grit', tint: CANYON_ROCK_TINT });
  if (outcrops) void outcrops.build().then(() => ready(outcrops.group));
  if (caves) buildings.lootPoints.push(...caveLootPoints());
  // (the sea's, the lakes' and the river's water and the swamp's mist got ready as they are made: hidden at the start
  // (the mist by day) they were a shader made in the frame they were first shown. Only these few: everything the west
  // made, got ready at once, held the loot's own getting ready past its six seconds, and each new thing of loot was
  // half a second in the frame it was first drawn.)
  const beforeWater = new Set(r.scene.children);
  const sea = arena ? null : new Ocean(r.scene, atmo, {
    seaLevel: SEA_LEVEL, x0: WORLD_X0 - 300, x1: -3560, z0: WORLD_Z0, z1: WORLD_Z1, beyond: { west: 16000, north: 6000, south: 6000 },
    depthAt: (x, z) => SEA_LEVEL - heightAt(world.heights, Math.max(x, WORLD_X0), Math.min(WORLD_Z1, Math.max(WORLD_Z0, z))),
  });
  const waters = !arena && world.water ? new Waterways(r.scene, atmo, world.water, ground, { seaLevel: SEA_LEVEL }) : null;
  void r.ready(r.scene.children.filter((o) => !beforeWater.has(o)));
  // (the road and the works are far outside the fort's arena: not built for a wager)
  if (!arena) buildRoad(world, atmo, r.scene, (o) => r.ready(o));
  if (!arena) buildWorks(world, atmo, r.scene);
  buildWells(arena ? wellSpots(world).filter((w) => nearArena(world, w.x, w.z)) : wellSpots(world), atmo, r.scene);
  if (arena) {
    // what stops a body at the arena's edge, over its low wall: as a pane of glass does, a body and not a shot
    const c = arenaCorners(world);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4], yaw = Math.atan2(-(bz - az), bx - ax), y = Math.max(...[[ax, az], [bx, bz]].map(([x, z]) => heightAt(world.heights, x, z)));
      physics.addStaticQuat(physics.R.ColliderDesc.cuboid(Math.hypot(bx - ax, bz - az) / 2, 40, 0.3), 'concrete', { x: (ax + bx) / 2, y, z: (az + bz) / 2 }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, undefined, GLASS_GROUPS);
    }
  }
  // (a stash in a cave stands on the carved rock, whose floor is the plan's give or take most of a metre: measured once
  // the caves are solid and before what stands is drawn. The server keeps the plan's height, which opens it as well.
  // A ray finds only what a step of the world has taken in: one is taken first.)
  if (caves) physics.step(1 / 30);
  if (caves) for (const q of world.props) {
    if (q.kind !== 'weapons_case' || !inCave(q.x, q.y + 0.5, q.z)) continue;
    const hit = physics.raycast({ x: q.x, y: q.y + 1.6, z: q.z }, { x: 0, y: -1, z: 0 }, 4);
    if (hit) q.y = hit.point.y;
  }
  stage('forest', 'growing forest');
  await frame();
  const veg = new Vegetation(world, atmo, terrain.heightTex);
  await veg.build(r.renderer, r.scene);
  const grass = new Grass(terrain, atmo, world.surface);
  grass.build(r.scene);

  stage('game');
  const game = new Game({ r, world, atmo, terrain, veg, grass, buildings });
  if (westTowns) game.beside.push((_dt, eye) => westTowns.update(eye));
  if (kalatRuins) game.beside.push((_dt, eye) => kalatRuins.update(eye));
  if (caves) game.beside.push((_dt, eye) => caves.update(eye));
  if (outcrops) game.beside.push((_dt, eye) => outcrops.update(eye));
  if (caves) game.darkBeside.push((x, y, z) => caves.dark(x, y, z));
  if (sea) game.beside.push((dt, eye, camera) => sea.update(dt, eye, camera));
  if (waters) {
    game.beside.push((dt, eye, camera) => waters.update(dt, eye, camera));
    const W = world.water!;
    game.player.water = (x, z) => waterAt(W, x, z, ground);
    game.player.onWade = (x, y, z, depth) => game.effects?.splash(new THREE.Vector3(x, y, z), depth);
  }
  await game.init((l) => stage(l, l));
  // (a wager's arena: its fort made whole now, not as somebody comes near it; and the Arena's own menu over it)
  if (arena && game.castle) {
    stage('fort', 'building the fort');
    await game.castle.whole();
  }
  // (out of the wait for a match: still loading, the Deploy that waits for it is let go; connected, the place given up)
  if (arena) new ArenaMenu(game.hud).onLeave = (waiting) => (!waiting ? game.toArena() : game.wantIn ? ((game.wantIn = false), game.hud.showStart(true)) : game.net.leaveQueue());
  stage('last files');
  await assets.idle();
  // warm up shader programs before revealing the world
  stage('shaders');
  await r.compileSoftly(null);
  await r.settle();
  // (the models are let go once the guns are built too: Game.loaded)
  (window as unknown as Record<string, unknown>).__game = game;
  if (import.meta.env.DEV) (await import('./dev/harness')).installHarness(game);
  // (F8: a flight recorded for the tests to fly again: src/dev/flight-record.ts)
  if (import.meta.env.DEV) (await import('./dev/flight-record')).installFlightRecorder(game);
  game.start();
  // the guns, built behind the menu now it is up (Game.loaded), before the menu's own extras (the sky, the films);
  // and how far that has got, said on the way in for whoever has pressed Deploy and waits for it (Game.wantIn)
  game.buildBehind();
  assets.onProgress = (d, t) => {
    if (game.wantIn) game.hud.showStart(true, false, `Loading ${Math.min(99, Math.round((d / Math.max(t, 1)) * 100))}%`);
  };
  game.afterBoot();
  // (the Zone's how to play, once, on a browser's first visit; never on this machine's own runs, where every fresh
  // headless browser is a first visit: the owner, "when running locally simply disable the how to play modal")
  if (!arena && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) game.hud.howTo(false);
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
