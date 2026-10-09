// Marketing stills: a profile picture and a banner, photographed from the real game on the
// trailer's stage (same page, same clock, the game's own character, weapon, world and light).
//
//   node scripts/stills.mjs              both, into marketing/
//   node scripts/stills.mjs --only pfp   just one (pfp | banner)
//
// The dev server must be running (npm run dev). Do not run it during a trailer take.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'marketing');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const PORT = 9334;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-stills-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio', '--hide-scrollbars', '--window-size=1500,1000', 'about:blank'], { stdio: 'ignore' });
const quit = () => { try { chrome.kill(); } catch { /* gone */ } };
process.on('exit', quit);

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
let seq = 0;
const waiting = new Map();
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.id && waiting.has(m.id)) {
    const [res, rej] = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) rej(new Error(m.error.message)); else res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') console.log('  page error:', m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
});
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: 'http://localhost:5173/trailer.html?cut=5' });
process.stdout.write('loading the game');
for (let i = 0; ; i++) {
  await sleep(1000);
  const state = await run('window.tr ? (window.tr.failed || (window.tr.ready ? "ready" : "staging")) : "booting"').catch(() => 'booting');
  if (state === 'ready') break;
  if (state !== 'booting' && state !== 'staging') throw new Error(`staging failed: ${state}`);
  process.stdout.write('.');
  if (i > 240) throw new Error('the game did not come up');
}
console.log('');


/**
 * The picture, as code run in the page. One survivor (the man in the hat from the trailer),
 * stood where the sun is on his face. The camera is given from his eyes: how far in front
 * of him it stands, how far to his left, how high; and where it looks.
 */
const pose = (o) => `(async () => {
  const S = window.tr.S, g = S.g, clock = window.__clock;
  const wait = (ms) => new Promise((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-hud-off');
  document.body.classList.remove('tr-bars');
  for (const c of [...document.body.classList]) if (c.startsWith('tr-g-')) document.body.classList.remove(c);
  document.getElementById('tr-overlay').innerHTML = '';
  document.getElementById('game').style.visibility = '';
  for (const a of S.actors) a.hide();
  S.parkMe();
  S.clean();
  const sun = g.s.atmo.sunDir;
  const lit = Math.atan2(-sun.x, -sun.z);
  const a = S.actors[0].place(${o.x}, ${o.z}, lit + ${o.turn}, ${JSON.stringify(o.weapon)}, ${JSON.stringify(o.gear)});
  a.rp.avatar.setSlung(${o.slung ? `g.weapons.worldModel(${JSON.stringify(o.slung)})` : 'null'});
  // (what is fitted to what he holds: a rifle's scope)
  ${o.mods ? `a.rp.setWeapon(${JSON.stringify(o.weapon)}, ${JSON.stringify(o.mods)});` : ''}
  a.aim = ${!!o.aim};
  const fwd = S.v(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)), left = S.v(-Math.cos(a.yaw), 0, Math.sin(a.yaw));
  const eye = a.eye();
  // he looks (and points the rifle) past the lens, not into it
  const mark = eye.clone().addScaledVector(fwd, 20).addScaledVector(left, ${o.gaze ?? 0} * 20);
  mark.y = eye.y + ${o.gazeUp ?? 0} * 20;
  a.face(mark);
  const p = eye.clone().addScaledVector(fwd, ${o.cam[0]}).addScaledVector(left, ${o.cam[1]});
  p.y = eye.y + ${o.cam[2]};
  const l = eye.clone().addScaledVector(left, ${o.look[0]});
  l.y = eye.y + ${o.look[1]};
  S.cam = { p, l, fov: ${o.fov} };
  // a reflector held low in front of him: it lifts the shadow the brim of the hat throws
  const lamp = g.effects.flashLight;
  const fill = () => {
    lamp.position.copy(eye).addScaledVector(fwd, 1.5).addScaledVector(left, ${o.fillSide ?? -0.5});
    lamp.position.y = eye.y - 0.45;
    lamp.color.setRGB(1, 0.92, 0.8);
    lamp.intensity = ${o.fill ?? 0};
    lamp.distance = 7;
  };
  fill();
  // The infected, if the picture has any: the game's own, with their own minds. Each is put
  // where it is wanted IN THE PICTURE (how far across it, -1 the left edge to 1 the right, and
  // how far from the lens), a few paces further off than that, and let run at the man.
  const wanted = ${JSON.stringify(o.zombies ?? [])};
  const zeds = [];
  if (wanted.length) {
    const horde = g.horde, dir = horde.director;
    horde.clear();
    dir.bodies.clear();
    dir.due = [];
    dir.tick = () => ({ added: [], gone: [], owned: [] });
    const me = horde.host.me().id;
    wanted.forEach((w, n) => {
      const i = 3000 + (w[2] ?? n);
      const info = { i, s: [0, -300, 0, 0, 0, 0], hp: 90, own: me, h: [0, 0] };
      dir.bodies.set(i, { ...info, home: 0, diedAt: 0, heard: 0, struck: 0 });
      horde.add(info);
      zeds.push(horde.all.get(i));
    });
    for (let k = 0; k < 600 && zeds.some((z) => !z.ready || !z.mine); k++) await wait(25);
    const view = l.clone().sub(p).normalize(), right = S.v(0, 0, 0).crossVectors(view, S.v(0, 1, 0)).normalize();
    const across = Math.tan((${o.fov} * Math.PI) / 360) * (innerWidth / innerHeight);
    zeds.forEach((z, n) => {
      const [sx, depth] = wanted[n];
      const at = p.clone().addScaledVector(view, depth).addScaledVector(right, sx * across * depth);
      // (back along the line it will come in by)
      const from = at.clone().sub(a.pos).setY(0).normalize();
      at.addScaledVector(from, ${o.run ?? 3.2});
      const y = S.ground(at.x, at.z);
      z.pos.set(at.x, y, at.z);
      z.fallTo = y;
      z.home.set(at.x, y, at.z);
      const body = dir.bodies.get(z.i);
      body.s[0] = at.x; body.s[1] = y; body.s[2] = at.z;
      body.heard = performance.now();
      z.mode = 0; z.after = 0; z.waitT = 999; z.gait = 0; z.stopT = 0; z.strikeAt = 0; z.seenAt = -1e9;
      z.yaw = Math.atan2(-(a.pos.x - at.x), -(a.pos.z - at.z));
      z.lost();
      z._think ??= z.think;
      z.think = () => {};
    });
  }
  for (let i = 0; i < 150; i++) {
    a.push();
    clock.advance(1000 / 60);
    fill();
    if (i % 15 === 14) await wait(40);
  }
  if (zeds.length) {
    for (const z of zeds) z.think = z._think;
    for (let i = 0; i < ${o.runFrames ?? 80}; i++) {
      a.push();
      clock.advance(1000 / 60);
      fill();
      if (i % 15 === 14) await wait(40);
    }
  }
  // the same frame again, on request, three ways: as it is; with the man lit up alone (to
  // find where he is in the picture); and without him (the background, to be put out of focus)
  const bloom = g.s.r.bloom.intensity;
  window.__still = {
    plain() { fill(); g.s.r.bloom.intensity = bloom; a.rp.avatar.root.visible = true; g.s.r.render(0); },
    // the two pictures that are compared: no glow (it would spill his light over everything), a coloured lamp on him alone
    matte() { lamp.position.copy(a.chest()).lerp(p, 0.22); lamp.color.setRGB(1, 0.1, 1); lamp.intensity = 70; lamp.distance = 3.6; g.s.r.bloom.intensity = 0; a.rp.avatar.root.visible = true; g.s.r.render(0); },
    bare() { fill(); g.s.r.bloom.intensity = 0; a.rp.avatar.root.visible = false; g.s.r.render(0); },
    empty() { fill(); g.s.r.bloom.intensity = bloom; a.rp.avatar.root.visible = false; g.s.r.render(0); },
    words(html) { document.getElementById('game').style.visibility = html ? 'hidden' : ''; document.getElementById('tr-overlay').innerHTML = html || ''; document.documentElement.style.background = document.body.style.background = html ? 'transparent' : ''; },
  };
  window.__still.plain();
  // (said back, to be printed: how far apart his hands are on what he holds)
  const av = a.rp.avatar;
  const hands = av.armL && av.armR ? av.armL.hand.getWorldPosition(S.v(0, 0, 0)).distanceTo(av.armR.hand.getWorldPosition(S.v(0, 0, 0))) : 0;
  return 'hands ' + hands.toFixed(3) + ' m apart';
})()`;

const png = async () => Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64');

/**
 * @param o.blur how far out of focus the background is (0 = as the game drew it)
 * @param o.overlay words and shading laid over the finished picture (html)
 */
async function shoot(name, width, height, o, sizes) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  console.log(`  ${await run(pose(o))}`);
  await sleep(120);
  let out = sharp(await png()).removeAlpha();
  if (o.blur) {
    // Depth of field, made afterwards: the man is found by lighting him alone and seeing what
    // changed, the picture without him is blurred, and he is laid back over it sharp.
    const A = await out.raw().toBuffer();
    await run('window.__still.matte()');
    await sleep(120);
    const M = await sharp(await png()).removeAlpha().raw().toBuffer();
    await run('window.__still.bare()');
    await sleep(120);
    const B = await sharp(await png()).removeAlpha().raw().toBuffer();
    await run('window.__still.empty()');
    await sleep(120);
    const emptyPng = await png();
    await run('window.__still.plain()');
    const mask = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
      const d = Math.max(Math.abs(M[i * 3] - B[i * 3]), Math.abs(M[i * 3 + 1] - B[i * 3 + 1]), Math.abs(M[i * 3 + 2] - B[i * 3 + 2]));
      mask[i] = d > 22 ? 255 : 0;
    }
    // close pinholes, then a soft edge
    const soft = await sharp(mask, { raw: { width, height, channels: 1 } }).blur(2.2).threshold(96).blur(1.3).raw().toBuffer({ resolveWithObject: true });
    const step = soft.info.channels;
    const man = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      man[i * 4] = A[i * 3];
      man[i * 4 + 1] = A[i * 3 + 1];
      man[i * 4 + 2] = A[i * 3 + 2];
      man[i * 4 + 3] = soft.data[i * step];
    }
    const back = await sharp(emptyPng).removeAlpha().blur(o.blur).modulate({ brightness: o.dim ?? 0.82, saturation: 0.9 }).png().toBuffer();
    out = sharp(back).composite([{ input: await sharp(man, { raw: { width, height, channels: 4 } }).png().toBuffer() }]);
  }
  let buf = await out.png().toBuffer();
  // a little more contrast and colour than the game's own grade, for a picture seen small
  buf = await sharp(buf).modulate({ saturation: 1.12 }).linear(1.08, -8).png().toBuffer();
  if (o.overlay) {
    await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await run(`window.__still.words(${JSON.stringify(o.overlay)})`);
    await sleep(200);
    const words = Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    await run('window.__still.words("")');
    await cdp('Emulation.setDefaultBackgroundColorOverride', {});
    buf = await sharp(buf).composite([{ input: words }]).png().toBuffer();
  }
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, buf);
  console.log(`${file}  ${width}x${height}`);
  for (const [w, h] of sizes) await sharp(buf).resize(w, h).jpeg({ quality: 93 }).toFile(path.join(OUT, `${name}-${w}x${h}.jpg`));
}

const FONT = "font-family:'Bahnschrift','Arial Narrow',sans-serif;font-stretch:condensed;text-transform:uppercase;";
const SPOT = { x: 103, z: -36 };
const VIGNETTE = `<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 44%, transparent 42%, rgba(4,6,4,0.62) 100%)"></div>`;
const want = (k) => !only || only === k || (only === 'pfp' && k.startsWith('pfp'));

// Three profile pictures to choose from.
// 1: a portrait. Long lens, rifle on his back, looking past you.
if (want('pfp-1')) await shoot('zona-pfp-1', 1000, 1000, { ...SPOT, turn: 0.5, weapon: null, slung: 'mosin', gear: ['boonie_hat'], gaze: 0.0, cam: [4.7, 2.5, -0.1], look: [0.0, -0.075], fov: 7.4, fill: 5, blur: 18, overlay: VIGNETTE }, [[500, 500], [400, 400]]);
// 2: down the barrel. He is aiming at you.
if (want('pfp-2')) await shoot('zona-pfp-2', 1000, 1000, { ...SPOT, turn: 0.2, weapon: 'mosin', gear: ['boonie_hat'], aim: true, gaze: 0.03, cam: [3.6, 0.05, 0.1], look: [0.02, -0.11], fov: 10.5, fill: 4, fillSide: 0.5, blur: 18, overlay: VIGNETTE }, [[500, 500], [400, 400]]);
// 3: side on, rifle up.
if (want('pfp-3')) await shoot('zona-pfp-3', 1000, 1000, { ...SPOT, turn: 0.35, weapon: 'mosin', gear: ['boonie_hat'], aim: true, gaze: 0.3, cam: [2.9, -1.5, 0.02], look: [0.42, -0.1], fov: 17, fill: 4, blur: 14, overlay: VIGNETTE }, [[500, 500], [400, 400]]);

if (want('banner')) {
  const mark = fs.readFileSync(path.join(ROOT, 'public', 'brand', 'zona-mark-plain.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
  await shoot('zona-banner', 1500, 500, {
    ...SPOT, turn: 0.35, weapon: 'mosin', mods: ['pu_scope'], gear: ['boonie_hat', 'life_vest', 'sack_pack'], aim: true, gaze: 0.3, gazeUp: 0.0,
    cam: [1.75, -0.6, -0.02], look: [1.42, -0.1], fov: 30, fill: 2.5, blur: 2.2, dim: 0.98,
    // three of them coming up behind him, under the rifle: two near, one further back between them
    zombies: [[-0.37, 5.4, 2], [-0.1, 6.3, 0], [-0.24, 10.5, 1]], run: 3.4, runFrames: 84,
    overlay: `
      <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgba(6,8,6,0) 45%, rgba(6,8,6,0.74) 59%, rgba(6,8,6,0.9) 100%)"></div>
      <div style="position:absolute;inset:0;box-shadow:inset 0 0 120px rgba(0,0,0,0.75)"></div>
      <div style="position:absolute;left:52%;right:2.5%;top:50%;transform:translateY(-50%);text-align:center;${FONT}color:#f3efe6;">
        <div style="display:flex;align-items:center;justify-content:center;gap:26px">
          <div style="width:150px;height:150px;flex:none;filter:drop-shadow(0 6px 22px rgba(0,0,0,0.8))">${mark.replace('width="512" height="512"', 'width="150" height="150"')}</div>
          <div style="font-size:186px;font-weight:700;line-height:0.86;letter-spacing:0.14em;margin-right:-0.14em;text-shadow:0 8px 40px rgba(0,0,0,0.8)">ZONA</div>
        </div>
        <div style="margin-top:20px;display:flex;align-items:center;justify-content:center;gap:18px;font-size:25px;font-weight:600;letter-spacing:0.24em;white-space:nowrap">
          <span style="color:#ffd35a;text-shadow:0 2px 8px #000">PVP SURVIVAL SHOOTER</span>
          <span style="padding:5px 12px 5px 16px;color:#14110b;background:#ffd35a;font-weight:700">PLAY TO EARN</span>
        </div>
        <div style="margin-top:13px;font-size:19px;font-weight:600;letter-spacing:0.3em;margin-right:-0.3em;color:#f3efe6;text-shadow:0 2px 8px #000;white-space:nowrap">PLAYERS HUNT YOU · SO DO THE INFECTED</div>
        <div style="margin-top:12px;font-size:19px;font-weight:500;letter-spacing:0.5em;margin-right:-0.5em;color:#cfc7b2;opacity:0.85">WWW.ZONAPVP.FUN</div>
      </div>`,
  }, [[600, 200]]);
  // what a link to the site shows (1200x630): the banner, whole, on the page's own dark, with the hazard yellow ruled above and below it
  const brand = path.join(ROOT, 'public', 'brand');
  fs.mkdirSync(brand, { recursive: true });
  const strip = await sharp(path.join(OUT, 'zona-banner.png')).resize(1200, 400).toBuffer();
  const rule = await sharp({ create: { width: 1200, height: 5, channels: 3, background: '#ffd35a' } }).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#0d100c' } })
    .composite([{ input: strip, left: 0, top: 115 }, { input: rule, left: 0, top: 104 }, { input: rule, left: 0, top: 521 }])
    .jpeg({ quality: 90 })
    .toFile(path.join(brand, 'og.jpg'));
  console.log(`${path.join(brand, 'og.jpg')}  1200x630`);
}
ws.close();
quit();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still letting go */ }
process.exit(0);
