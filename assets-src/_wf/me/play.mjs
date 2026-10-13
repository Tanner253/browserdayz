// The local game driven by a headless Chrome, with no pane open: the page is loaded, the game is waited for, and a
// script is run in it (with window.T, window.D and window.__game there, as in the pane). Pictures the script takes
// with D.eye and the like go where they always go (the small server on 127.0.0.1:5199). What the script returns is
// printed. `shot(name)` in the script is a picture of the whole page (the HUD with it), written into <out dir>.
//
//   node assets-src/_wf/me/play.mjs <script.js> <out dir> [width height] [address]
//
// The dev server must be running. The script is the body of an async function.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const [scriptFile, outDir, w = '1280', h = '720', address = 'http://localhost:5173/'] = process.argv.slice(2);
const script = fs.readFileSync(scriptFile, 'utf8');
fs.mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.PLAY_PORT) || 9338;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zona-play-'));
// (PLAY_GL=swiftshader: drawn by the processor, with nothing asked of the graphics card)
const GL = process.env.PLAY_GL === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'];
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, ...GL, '--enable-precise-memory-info', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
console.log('chrome pid', chrome.pid);
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
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params })); });
const shots = [];
const cpuBegan = new Map();
const traced = [];
let traceOver = null;
ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  if (m.id && waiting.has(m.id)) {
    const [res, rej] = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) rej(new Error(m.error.message)); else res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') console.log('  page error:', m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) console.log(`  page ${m.params.type}:`, m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  else if (m.method === 'Runtime.bindingCalled' && m.params.name === '__profile') {
    // (where the processor's time goes over so many milliseconds: asked for from inside the page)
    const [name, ms] = JSON.parse(m.params.payload);
    shots.push((async () => {
      await cdp('Profiler.enable');
      await cdp('Profiler.setSamplingInterval', { interval: 200 });
      await cdp('Profiler.start');
      await sleep(ms);
      const { profile } = await cdp('Profiler.stop');
      const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const dt = profile.timeDeltas, total = dt.reduce((a, b) => a + b, 0);
      profile.samples.forEach((id, i) => {
        const n = byId.get(id), f = n.callFrame;
        const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
      });
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${((v / total) * 100).toFixed(1).padStart(5)} %  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
      const NL = String.fromCharCode(10);
      fs.writeFileSync(path.join(outDir, `${name}.txt`), `${(total / 1000).toFixed(0)} ms sampled${NL}` + top.join(NL));
      console.log(`--- profile ${name}: ${(total / 1000).toFixed(0)} ms${NL}` + top.slice(0, 28).join(NL));
      return cdp('Runtime.evaluate', { expression: `window.__profileDone && window.__profileDone(${JSON.stringify(name)})` });
    })());
  }
  else if (m.method === 'Runtime.bindingCalled' && m.params.name === '__cpu') {
    // (a whole profile kept, sample by sample, between a 'start' and a 'stop' asked for from inside the page: written
    // to <name>.cpuprofile with `pageNow`, what performance.now() said in the page as it began, to lay its samples
    // beside what the page noted of its own frames)
    const [name, what] = JSON.parse(m.params.payload);
    shots.push((async () => {
      if (what === 'start') {
        await cdp('Profiler.enable');
        await cdp('Profiler.setSamplingInterval', { interval: 250 });
        const now = (await cdp('Runtime.evaluate', { expression: 'performance.now()', returnByValue: true })).result.value;
        await cdp('Profiler.start');
        cpuBegan.set(name, now);
      } else {
        const { profile } = await cdp('Profiler.stop');
        profile.pageNow = cpuBegan.get(name);
        fs.writeFileSync(path.join(outDir, `${name}.cpuprofile`), JSON.stringify(profile));
      }
      return cdp('Runtime.evaluate', { expression: `window.__cpuDone && window.__cpuDone(${JSON.stringify(name + ':' + what)})` });
    })());
  }
  else if (m.method === 'Tracing.dataCollected') traced.push(...m.params.value);
  else if (m.method === 'Tracing.tracingComplete') traceOver?.();
  else if (m.method === 'Runtime.bindingCalled' && m.params.name === '__trace') {
    // (The browser's own account of what every thread of it did, task by task, between a 'start' and a 'stop' asked
    // for from inside the page: written to <name>.trace.json. A mark the page makes with performance.mark() is in it
    // with the time it was made at, which is how its clock is laid beside the page's.)
    const [name, what] = JSON.parse(m.params.payload);
    shots.push((async () => {
      if (what === 'start') {
        traced.length = 0;
        await cdp('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordUntilFull', includedCategories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8', 'gpu', 'loading'] } });
      } else {
        const over = new Promise((r) => (traceOver = r));
        await cdp('Tracing.end');
        await over;
        fs.writeFileSync(path.join(outDir, `${name}.trace.json`), JSON.stringify(traced));
      }
      return cdp('Runtime.evaluate', { expression: `window.__traceDone && window.__traceDone(${JSON.stringify(name + ':' + what)})` });
    })());
  }
  else if (m.method === 'Runtime.bindingCalled' && m.params.name === '__input') {
    // (a real click, or real typing, asked for from inside the page: as a hand on the mouse and keyboard would do it)
    const [id, kind, a1, a2] = JSON.parse(m.params.payload);
    shots.push((async () => {
      if (kind === 'click') {
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a1, y: a2 });
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: a1, y: a2, button: 'left', clickCount: 1 });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a1, y: a2, button: 'left', clickCount: 1 });
      } else if (kind === 'type') {
        for (const ch of String(a1)) {
          await cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch, code: ch === ' ' ? 'Space' : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : '', windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
          await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: ch === ' ' ? 'Space' : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : '', windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
        }
      }
      return cdp('Runtime.evaluate', { expression: `window.__inputDone && window.__inputDone(${id})` });
    })());
  }
  else if (m.method === 'Runtime.bindingCalled' && m.params.name === '__shot') {
    // (a picture of the whole page, asked for from inside it)
    shots.push(cdp('Page.captureScreenshot', { format: 'png' }).then((r) => {
      fs.writeFileSync(path.join(outDir, `${m.params.payload}.png`), Buffer.from(r.data, 'base64'));
      return cdp('Runtime.evaluate', { expression: `window.__shotDone && window.__shotDone(${JSON.stringify(m.params.payload)})` });
    }));
  }
});
const run = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Runtime.addBinding', { name: '__shot' });
await cdp('Runtime.addBinding', { name: '__input' });
await cdp('Runtime.addBinding', { name: '__profile' });
await cdp('Runtime.addBinding', { name: '__cpu' });
await cdp('Runtime.addBinding', { name: '__trace' });
// (PLAY_PRE: a script run in the page before anything of the game's is: to count what it loads)
if (process.env.PLAY_PRE) await cdp('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(process.env.PLAY_PRE, 'utf8') });
await cdp('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: address });
let up = false;
for (let i = 0; i < 360 && !up; i++) {
  await sleep(500);
  // (PLAY_PROD: a built site, which has no test harness in it: the game alone is waited for)
  up = await run(`${process.env.PLAY_PROD ? '' : '!!window.T && '}!!window.__game && !document.querySelector('#loading:not(.done)')`).catch(() => false);
}
if (!up) throw new Error('the game did not come up');
await sleep(1500);
const out = await run(`(async () => {
  const shot = (name) => new Promise((res) => { window.__shotDone = (n) => { if (n === name) res(); }; window.__shot(name); });
  let inputSeq = 0; const real = (kind, a1, a2) => new Promise((res) => { const id = ++inputSeq; window.__inputDone = (n) => { if (n === id) res(); }; window.__input(JSON.stringify([id, kind, a1, a2])); });
  const click = (x, y) => real('click', x, y), type = (text) => real('type', text);
  const profile = (name, ms) => new Promise((res) => { window.__profileDone = (n) => { if (n === name) res(); }; window.__profile(JSON.stringify([name, ms])); });
  const cpu = (name, what) => new Promise((res) => { window.__cpuDone = (n) => { if (n === name + ':' + what) res(); }; window.__cpu(JSON.stringify([name, what])); });
  const trace = (name, what) => new Promise((res) => { window.__traceDone = (n) => { if (n === name + ':' + what) res(); }; window.__trace(JSON.stringify([name, what])); });
  ${script}
})()`);
await Promise.all(shots);
if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
ws.close();
quit();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still has it */ }
process.exit(0);
